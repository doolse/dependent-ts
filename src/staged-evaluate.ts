/**
 * Staged Evaluator - Partial Evaluation with Now/Later staging.
 *
 * Evaluates expressions while tracking what's known at compile time (Now)
 * versus what's only known at runtime (Later).
 *
 * Key behaviors:
 * - Literals are Now (fully known)
 * - Operations on all-Now inputs compute immediately (Now result)
 * - Operations involving Later inputs produce residual code (Later result)
 * - `comptime` forces compile-time evaluation (errors if input is Later)
 * - `runtime` marks a value as runtime-only (Later)
 */

import { Expr, BinOp, UnaryOp, varRef, binop, unary, ifExpr, letExpr, letPatternExpr, call, obj, field, array, index, block, lit, fn, recfn, assertExpr, assertCondExpr, trustExpr, methodCall, importExpr, Pattern, patternVars } from "./expr";
import { TSDeclarationLoader, FunctionSignatureInfo, buildSyntheticBody, getRegisteredConstraint } from "./ts-loader";
import { lookupMethod } from "./methods";
import { Value, numberVal, stringVal, boolVal, nullVal, objectVal, arrayVal, closureVal, constraintOf, valueToString, typeVal, valueSatisfies, builtinVal } from "./value";
import { getBuiltin, getAllBuiltins, BuiltinDef, StagedBuiltinContext } from "./builtin-registry";
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, hasField, elements, length, elementAt, implies, simplify, or, narrowOr, isType, isTypeC, unify, constraintToString, tupleConstraint, arrayOfConstraint, anyC, neverC, indexSig } from "./constraint";
import { Env, Binding, RefinementContext } from "./env";
import { getBinaryOp, getUnaryOp, requireConstraint, TypeError, stringConcat, AssertionError, EvalResult } from "./builtins";
import { extractAllRefinements, negateRefinement } from "./refinement";
import { SValue, Now, Later, LaterArray, now, later, laterArray, isNow, isLater, isLaterArray, allNow } from "./svalue";

// ============================================================================
// Staged Environment
// ============================================================================

/**
 * Staged binding - value may be Now or Later.
 */
export interface SBinding {
  svalue: SValue;
}

/**
 * Staged environment maps names to staged bindings.
 */
export class SEnv {
  private constructor(private bindings: Map<string, SBinding>) {}

  static empty(): SEnv {
    return new SEnv(new Map());
  }

  get(name: string): SBinding {
    const binding = this.bindings.get(name);
    if (!binding) {
      throw new Error(`Unbound variable: ${name}`);
    }
    return binding;
  }

  set(name: string, binding: SBinding): SEnv {
    const newBindings = new Map(this.bindings);
    newBindings.set(name, binding);
    return new SEnv(newBindings);
  }

  has(name: string): boolean {
    return this.bindings.has(name);
  }

  entries(): IterableIterator<[string, SBinding]> {
    return this.bindings.entries();
  }
}

// ============================================================================
// Staged Closure
// ============================================================================

/**
 * A staged closure captures the staged environment.
 */
export interface SClosure {
  body: Expr;
  env: SEnv;
  name?: string;  // Optional name for recursive self-reference
  // Note: params have been removed - all functions use args array with desugaring
}

// ============================================================================
// Staging Errors
// ============================================================================

export class StagingError extends Error {
  constructor(message: string) {
    super(`Staging error: ${message}`);
    this.name = "StagingError";
  }
}

// ============================================================================
// Variable Counter for Residual Generation
// ============================================================================

let varCounter = 0;

export function freshVar(prefix: string = "v"): string {
  return `${prefix}${varCounter++}`;
}

export function resetVarCounter(): void {
  varCounter = 0;
}

// ============================================================================
// Main Staged Evaluation Function
// ============================================================================

/**
 * Staged evaluation result.
 */
export interface SEvalResult {
  svalue: SValue;
}

/**
 * Evaluate an expression in a staged manner.
 * Returns a staged value (Now or Later).
 */
export function stagingEvaluate(
  expr: Expr,
  env: SEnv,
  ctx: RefinementContext = RefinementContext.empty()
): SEvalResult {
  switch (expr.tag) {
    case "lit":
      return evalLiteral(expr.value);

    case "var":
      return evalVariable(expr.name, env, ctx);

    case "binop":
      return evalBinaryOp(expr.op, expr.left, expr.right, env, ctx);

    case "unary":
      return evalUnaryOp(expr.op, expr.operand, env, ctx);

    case "if":
      return evalIf(expr.cond, expr.then, expr.else, env, ctx);

    case "let":
      return evalLet(expr.name, expr.value, expr.body, env, ctx);

    case "letPattern":
      return evalLetPattern(expr.pattern, expr.value, expr.body, env, ctx);

    case "fn":
      return evalFn(expr.params, expr.body, env);

    case "recfn":
      return evalRecFn(expr.name, expr.params, expr.body, env);

    case "call":
      return evalCall(expr.func, expr.args, env, ctx);

    case "obj":
      return evalObject(expr.fields, env, ctx);

    case "field":
      return evalField(expr.object, expr.name, env, ctx);

    case "array":
      return evalArray(expr.elements, env, ctx);

    case "index":
      return evalIndex(expr.array, expr.index, env, ctx);

    case "block":
      return evalBlock(expr.exprs, env, ctx);

    case "comptime":
      return evalComptime(expr.expr, env, ctx);

    case "runtime":
      return evalRuntime(expr.expr, expr.name, env, ctx);

    case "assert":
      return evalAssert(expr.expr, expr.constraint, expr.message, env, ctx);

    case "assertCond":
      return evalAssertCond(expr.condition, expr.message, env, ctx);

    case "trust":
      return evalTrust(expr.expr, expr.constraint, env, ctx);

    case "methodCall":
      return evalMethodCall(expr.receiver, expr.method, expr.args, env, ctx);

    case "import":
      return evalImport(expr.names, expr.modulePath, expr.body, env, ctx);

    case "typeOf":
      return evalTypeOf(expr.expr, env, ctx);
  }
}

// ============================================================================
// Expression Evaluators
// ============================================================================

function evalLiteral(value: number | string | boolean | null): SEvalResult {
  if (typeof value === "number") {
    const v = numberVal(value);
    return { svalue: now(v, constraintOf(v)) };
  }
  if (typeof value === "string") {
    const v = stringVal(value);
    return { svalue: now(v, constraintOf(v)) };
  }
  if (typeof value === "boolean") {
    const v = boolVal(value);
    return { svalue: now(v, constraintOf(v)) };
  }
  if (value === null) {
    return { svalue: now(nullVal, isNull) };
  }
  throw new Error(`Unknown literal: ${value}`);
}

function evalVariable(name: string, env: SEnv, ctx: RefinementContext): SEvalResult {
  const binding = env.get(name);
  const sv = binding.svalue;

  // Apply refinements from control flow
  const refinement = ctx.get(name);
  if (refinement) {
    const refined = narrowOr(sv.constraint, refinement);
    if (isNow(sv)) {
      // Preserve residual if it exists, otherwise add variable reference for compounds
      const residual = sv.residual ?? (isCompoundValue(sv.value) ? varRef(name) : undefined);
      return { svalue: now(sv.value, refined, residual) };
    } else if (isLaterArray(sv)) {
      // Preserve LaterArray structure with refined constraint
      return { svalue: laterArray(sv.elements, refined) };
    } else {
      return { svalue: later(refined, sv.residual) };
    }
  }

  // For compound Now values without a residual, add the variable reference
  // This ensures variable references are preserved in generated code
  if (isNow(sv) && !sv.residual && isCompoundValue(sv.value)) {
    return { svalue: now(sv.value, sv.constraint, varRef(name)) };
  }

  return { svalue: sv };
}

function evalBinaryOp(
  op: BinOp,
  leftExpr: Expr,
  rightExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const left = stagingEvaluate(leftExpr, env, ctx).svalue;
  const right = stagingEvaluate(rightExpr, env, ctx).svalue;

  // If both are Now, compute immediately
  if (isNow(left) && isNow(right)) {
    // Special case: + can be string concatenation
    if (op === "+") {
      const leftIsString = implies(left.constraint, isString);
      const rightIsString = implies(right.constraint, isString);

      if (leftIsString || rightIsString) {
        requireConstraint(left.constraint, isString, "left of string +");
        requireConstraint(right.constraint, isString, "right of string +");

        const result = stringConcat.impl([left.value, right.value]);
        const resultConstraint = stringConcat.result([left.constraint, right.constraint]);
        return { svalue: now(result, resultConstraint) };
      }
    }

    const builtin = getBinaryOp(op);
    requireConstraint(left.constraint, builtin.params[0], `left of ${op}`);
    requireConstraint(right.constraint, builtin.params[1], `right of ${op}`);

    const result = builtin.impl([left.value, right.value]);
    const resultConstraint = builtin.result([left.constraint, right.constraint]);
    return { svalue: now(result, resultConstraint) };
  }

  // At least one is Later - generate residual
  const leftResidual = svalueToResidual(left);
  const rightResidual = svalueToResidual(right);

  // Special case: + can be string concatenation
  if (op === "+") {
    const leftIsString = implies(left.constraint, isString);
    const rightIsString = implies(right.constraint, isString);

    if (leftIsString || rightIsString) {
      requireConstraint(left.constraint, isString, "left of string +");
      requireConstraint(right.constraint, isString, "right of string +");

      const resultConstraint = stringConcat.result([left.constraint, right.constraint]);
      return { svalue: later(resultConstraint, binop(op, leftResidual, rightResidual)) };
    }
  }

  const builtin = getBinaryOp(op);

  // Still check constraints for type safety
  requireConstraint(left.constraint, builtin.params[0], `left of ${op}`);
  requireConstraint(right.constraint, builtin.params[1], `right of ${op}`);

  const resultConstraint = builtin.result([left.constraint, right.constraint]);

  return { svalue: later(resultConstraint, binop(op, leftResidual, rightResidual)) };
}

function evalUnaryOp(
  op: UnaryOp,
  operandExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const operand = stagingEvaluate(operandExpr, env, ctx).svalue;

  if (isNow(operand)) {
    const builtin = getUnaryOp(op);
    requireConstraint(operand.constraint, builtin.params[0], `operand of ${op}`);

    const result = builtin.impl([operand.value]);
    const resultConstraint = builtin.result([operand.constraint]);
    return { svalue: now(result, resultConstraint) };
  }

  // Later/LaterArray - generate residual
  const builtin = getUnaryOp(op);
  requireConstraint(operand.constraint, builtin.params[0], `operand of ${op}`);

  const resultConstraint = builtin.result([operand.constraint]);
  return { svalue: later(resultConstraint, unary(op, svalueToResidual(operand))) };
}

function evalIf(
  condExpr: Expr,
  thenExpr: Expr,
  elseExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const cond = stagingEvaluate(condExpr, env, ctx).svalue;

  requireConstraint(cond.constraint, isBool, "if condition");

  if (isNow(cond)) {
    // Condition is known at compile time - evaluate only the taken branch
    if (cond.value.tag !== "bool") {
      throw new Error("if condition must be boolean");
    }

    const refinement = extractAllRefinements(condExpr);

    if (cond.value.value) {
      let thenCtx = ctx;
      for (const [varName, constraint] of refinement.constraints) {
        thenCtx = thenCtx.refine(varName, constraint);
      }
      return stagingEvaluate(thenExpr, env, thenCtx);
    } else {
      const negatedRefinement = negateRefinement(refinement);
      let elseCtx = ctx;
      for (const [varName, constraint] of negatedRefinement.constraints) {
        elseCtx = elseCtx.refine(varName, constraint);
      }
      return stagingEvaluate(elseExpr, env, elseCtx);
    }
  }

  // Condition is Later - must evaluate both branches and generate residual if
  // Both branches must be evaluated to determine result constraint (union of both)
  const refinement = extractAllRefinements(condExpr);

  let thenCtx = ctx;
  for (const [varName, constraint] of refinement.constraints) {
    thenCtx = thenCtx.refine(varName, constraint);
  }
  const thenResult = stagingEvaluate(thenExpr, env, thenCtx).svalue;

  const negatedRefinement = negateRefinement(refinement);
  let elseCtx = ctx;
  for (const [varName, constraint] of negatedRefinement.constraints) {
    elseCtx = elseCtx.refine(varName, constraint);
  }
  const elseResult = stagingEvaluate(elseExpr, env, elseCtx).svalue;

  // Result constraint is union of both branches
  const resultConstraint = simplify(or(thenResult.constraint, elseResult.constraint));

  const thenResidual = svalueToResidual(thenResult);
  const elseResidual = svalueToResidual(elseResult);

  return { svalue: later(resultConstraint, ifExpr(svalueToResidual(cond), thenResidual, elseResidual)) };
}

function evalLet(
  name: string,
  valueExpr: Expr,
  bodyExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const valueResult = stagingEvaluate(valueExpr, env, ctx).svalue;

  // For Later values with complex residuals, update to use varRef so subsequent
  // lookups reference the variable instead of duplicating the expression.
  // Simple residuals (varRef, lit) can be inlined safely.
  // For LaterArray, we keep the structure but may later need to emit a let binding.
  const boundValue = isLater(valueResult) && !isSimpleResidual(valueResult.residual)
    ? later(valueResult.constraint, varRef(name))
    : valueResult;

  const newEnv = env.set(name, { svalue: boundValue });

  const bodyResult = stagingEvaluate(bodyExpr, newEnv, ctx).svalue;

  // If the body is Now, return it directly even if the bound value was Later.
  // This handles cases like typeOf() which extract compile-time type info from Later values.
  if (isNow(bodyResult)) {
    return { svalue: bodyResult };
  }

  // Body is Later - decide whether to emit a let binding
  // For Later/LaterArray values: check original expression (to avoid duplicate evaluation of side effects)
  // For Now values with compound types (objects, arrays, closures): check original expression
  //   to preserve code structure and avoid duplicating large literals
  // For Now values with primitives: check residual (inlining is fine)
  const shouldEmitLet = isLater(valueResult) || isLaterArray(valueResult)
    ? usesVar(bodyExpr, name)
    : isCompoundValue(valueResult.value)
      ? usesVar(bodyExpr, name)
      : usesVar(svalueToResidual(bodyResult), name);

  if (shouldEmitLet) {
    // Variable is used in body - need to emit a let binding
    const valueResidual = isNow(valueResult)
      ? valueToExpr(valueResult.value)
      : svalueToResidual(valueResult);

    return {
      svalue: later(
        bodyResult.constraint,
        letExpr(name, valueResidual, svalueToResidual(bodyResult))
      )
    };
  }

  return { svalue: bodyResult };
}

/**
 * Extract a value from a pattern binding.
 * For Now values, extracts the actual value component.
 * For Later values, generates index/field access residuals.
 */
function extractFromPattern(
  pattern: Pattern,
  value: SValue,
  env: SEnv
): { env: SEnv; bindings: Array<{ name: string; svalue: SValue }> } {
  const bindings: Array<{ name: string; svalue: SValue }> = [];

  function extract(pat: Pattern, val: SValue, basePath: Expr): void {
    switch (pat.tag) {
      case "varPattern":
        if (isNow(val)) {
          bindings.push({ name: pat.name, svalue: val });
        } else {
          // Override residual to use the variable name - the letPattern will bind it
          bindings.push({ name: pat.name, svalue: later(val.constraint, varRef(pat.name)) });
        }
        break;

      case "arrayPattern": {
        for (let i = 0; i < pat.elements.length; i++) {
          const elemPat = pat.elements[i];
          if (isNow(val)) {
            // Extract element from Now array value
            const arrVal = val.value;
            if (arrVal.tag === "array" && i < arrVal.elements.length) {
              const elemVal = arrVal.elements[i];
              extract(elemPat, now(elemVal, constraintOf(elemVal)), index(basePath, lit(i)));
            } else {
              // Type error - but for now create a Later with any constraint
              extract(elemPat, later({ tag: "any" }, index(basePath, lit(i))), index(basePath, lit(i)));
            }
          } else if (isLaterArray(val)) {
            // LaterArray - extract element SValue directly
            if (i < val.elements.length) {
              extract(elemPat, val.elements[i], index(basePath, lit(i)));
            } else {
              extract(elemPat, later({ tag: "any" }, index(basePath, lit(i))), index(basePath, lit(i)));
            }
          } else {
            // Later value - extract constraint and generate residual
            const elemConstraint = extractElementAtConstraint(val.constraint, i);
            extract(elemPat, later(elemConstraint, index(basePath, lit(i))), index(basePath, lit(i)));
          }
        }
        break;
      }

      case "objectPattern": {
        for (const { key, pattern: fieldPat } of pat.fields) {
          if (isNow(val)) {
            // Extract field from Now object value
            const objVal = val.value;
            if (objVal.tag === "object") {
              const fieldVal = objVal.fields.get(key);
              if (fieldVal) {
                extract(fieldPat, now(fieldVal, constraintOf(fieldVal)), field(basePath, key));
              } else {
                extract(fieldPat, later({ tag: "any" }, field(basePath, key)), field(basePath, key));
              }
            } else {
              extract(fieldPat, later({ tag: "any" }, field(basePath, key)), field(basePath, key));
            }
          } else {
            // Later value - extract constraint and generate residual
            const fieldConstraint = extractFieldConstraintFromConstraint(val.constraint, key);
            extract(fieldPat, later(fieldConstraint, field(basePath, key)), field(basePath, key));
          }
        }
        break;
      }
    }
  }

  // Start extraction with a reference to a temporary variable
  const tempVar = freshVar("_tmp");
  const tempExpr = varRef(tempVar);
  extract(pattern, value, tempExpr);

  // Build the new environment with all bindings
  let newEnv = env;
  for (const { name, svalue } of bindings) {
    newEnv = newEnv.set(name, { svalue });
  }

  return { env: newEnv, bindings };
}

/**
 * Extract the constraint for an array element at a given index.
 */
function extractElementAtConstraint(constraint: Constraint, idx: number): Constraint {
  if (constraint.tag === "elementAt" && constraint.index === idx) {
    return constraint.constraint;
  }
  if (constraint.tag === "and") {
    for (const c of constraint.constraints) {
      const found = extractElementAtConstraint(c, idx);
      if (found.tag !== "any") return found;
    }
    // Fall back to elements constraint if no elementAt found
    for (const c of constraint.constraints) {
      if (c.tag === "elements") return c.constraint;
    }
  }
  return { tag: "any" };
}

/**
 * Extract the constraint for an object field.
 */
function extractFieldConstraintFromConstraint(constraint: Constraint, fieldName: string): Constraint {
  if (constraint.tag === "hasField" && constraint.name === fieldName) {
    return constraint.constraint;
  }
  if (constraint.tag === "and") {
    for (const c of constraint.constraints) {
      const found = extractFieldConstraintFromConstraint(c, fieldName);
      if (found.tag !== "any") return found;
    }
  }
  return { tag: "any" };
}

function evalLetPattern(
  pattern: Pattern,
  valueExpr: Expr,
  bodyExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const valueResult = stagingEvaluate(valueExpr, env, ctx).svalue;

  // Extract bindings from the pattern
  const { env: newEnv, bindings } = extractFromPattern(pattern, valueResult, env);

  const bodyResult = stagingEvaluate(bodyExpr, newEnv, ctx).svalue;

  // If the body is Now, return it directly
  if (isNow(bodyResult)) {
    return { svalue: bodyResult };
  }

  // Check if any of the pattern variables are used in the body
  const patVars = patternVars(pattern);
  const anyVarUsed = patVars.some(name => usesVar(bodyExpr, name));

  // If value was Later/LaterArray and body uses pattern variables, we need residual let pattern
  if ((isLater(valueResult) || isLaterArray(valueResult)) && anyVarUsed) {
    return {
      svalue: later(
        bodyResult.constraint,
        letPatternExpr(pattern, svalueToResidual(valueResult), svalueToResidual(bodyResult))
      )
    };
  }

  return { svalue: bodyResult };
}

function evalFn(params: string[], body: Expr, env: SEnv): SEvalResult {
  // Functions are always Now (the closure itself is known)
  // The type emerges from body analysis at call sites - no upfront inference needed
  // Note: params is ignored here - body already contains let [params] = args in ... desugaring
  const closure = closureVal(body, Env.empty()); // Placeholder env

  // Store the staged env in a side channel for call-time evaluation
  stagedClosures.set(closure, { body, env });

  // Return function with simple isFunction constraint - types derived at call site
  return { svalue: now(closure, isFunction) };
}

/**
 * Evaluate a named recursive function in staged context.
 * The function can call itself by name within its body.
 */
function evalRecFn(name: string, params: string[], body: Expr, env: SEnv): SEvalResult {
  // Create a closure with the name for self-reference
  // Note: params is ignored here - body already contains let [params] = args in ... desugaring
  const closure = closureVal(body, Env.empty(), name); // Placeholder env

  // Store the staged env in a side channel with self-binding
  const selfSEnv = env.set(name, { svalue: now(closure, isFunction) });
  stagedClosures.set(closure, { body, env: selfSEnv, name });

  // Return function with simple isFunction constraint - types derived at call site
  return { svalue: now(closure, isFunction) };
}

// Side channel for staged closures (maps closure value to staged closure info)
const stagedClosures = new WeakMap<Value, SClosure>();

// Coinductive cycle detection: tracks recursive functions currently being evaluated
// Maps function name to the assumed result constraint (from type inference)
const inProgressRecursiveCalls = new Map<string, Constraint>();

/**
 * Evaluate a call to a builtin function.
 */
function evalBuiltinCall(
  builtinDef: BuiltinDef,
  argExprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Evaluate arguments
  const args = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);

  // Check argument count
  if (builtinDef.variadic) {
    if (args.length < builtinDef.params.length) {
      throw new Error(`${builtinDef.name}() requires at least ${builtinDef.params.length} arguments, got ${args.length}`);
    }
  } else {
    if (args.length !== builtinDef.params.length) {
      throw new Error(`${builtinDef.name}() requires exactly ${builtinDef.params.length} arguments, got ${args.length}`);
    }
  }

  // Check argument constraints (for defined params)
  for (let i = 0; i < builtinDef.params.length; i++) {
    requireConstraint(args[i].constraint, builtinDef.params[i].constraint, `argument ${i + 1} of ${builtinDef.name}()`);
  }

  if (builtinDef.evaluate.kind === "pure") {
    // Pure builtin - check if all args are Now
    if (args.every(isNow)) {
      const values = args.map(sv => (sv as Now).value);
      const result = builtinDef.evaluate.impl(values);
      const resultConstraint = builtinDef.resultType(args.map(sv => sv.constraint));
      return { svalue: now(result, and(resultConstraint, constraintOf(result))) };
    }

    // Generate residual for pure builtin with Later args
    // Use abstract function call - backend decides method vs function syntax
    const argResiduals = args.map(svalueToResidual);
    const resultConstraint = builtinDef.resultType(args.map(sv => sv.constraint));

    return {
      svalue: later(resultConstraint, call(varRef(builtinDef.name), ...argResiduals))
    };
  } else {
    // Staged builtin - create context and call handler
    const builtinCtx: StagedBuiltinContext = {
      env,
      refinementCtx: ctx,
      invokeClosure: (closure, closureArgs) => {
        const sclosure = stagedClosures.get(closure);
        if (!sclosure) {
          throw new Error("Staged closure info not found for builtin invocation");
        }
        let callEnv = sclosure.env;
        if (sclosure.name) {
          callEnv = callEnv.set(sclosure.name, { svalue: now(closure, isFunction) });
        }
        // All functions use args array (params are desugared at parse time)
        callEnv = callEnv.set("args", { svalue: createArraySValue(closureArgs) });
        return stagingEvaluate(sclosure.body, callEnv, RefinementContext.empty());
      },
      valueToExpr,
      svalueToResidual,
      now,
      later,
      laterArray,
      isNow,
      isLaterArray,
    };

    return builtinDef.evaluate.handler(args, argExprs, builtinCtx);
  }
}

function evalCall(
  funcExpr: Expr,
  argExprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const func = stagingEvaluate(funcExpr, env, ctx).svalue;

  // Check if it's a builtin function
  if (isNow(func) && func.value.tag === "builtin") {
    const builtinDef = getBuiltin(func.value.name);
    if (builtinDef) {
      return evalBuiltinCall(builtinDef, argExprs, env, ctx);
    }
    throw new Error(`Unknown builtin: ${func.value.name}`);
  }

  requireConstraint(func.constraint, isFunction, "function call");

  if (isLater(func) || isLaterArray(func)) {
    // Function itself is not known - generate residual call
    const argResults = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);
    const argResiduals = argResults.map(svalueToResidual);

    // We don't know the result constraint without knowing the function
    // Use 'any' as a conservative approximation
    return { svalue: later({ tag: "any" }, call(svalueToResidual(func), ...argResiduals)) };
  }

  // Function is Now
  if (func.value.tag !== "closure") {
    throw new Error("Cannot call non-function");
  }

  const sclosure = stagedClosures.get(func.value);
  if (!sclosure) {
    throw new Error("Staged closure info not found");
  }

  // With parser desugaring, all functions use args array - no param count check needed

  // Evaluate arguments
  const args = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);

  // Coinductive cycle detection for recursive functions with Later arguments
  // This prevents infinite recursion when a recursive function is called with runtime values
  if (sclosure.name && args.some(isLater)) {
    if (inProgressRecursiveCalls.has(sclosure.name)) {
      // Cycle detected! We're already evaluating this recursive function with Later args.
      // Use the pre-computed result constraint and emit residual code.
      const resultConstraint = inProgressRecursiveCalls.get(sclosure.name)!;
      const argResiduals = args.map(svalueToResidual);
      return {
        svalue: later(resultConstraint, call(varRef(sclosure.name), ...argResiduals))
      };
    }

    // Not in a cycle yet - mark as in-progress and evaluate body
    // Use 'any' as result constraint for cycle detection - types derived from body
    inProgressRecursiveCalls.set(sclosure.name, { tag: "any" });

    // Bind args array in the closure's environment
    let callEnv = sclosure.env;
    callEnv = callEnv.set(sclosure.name, { svalue: func });
    // All functions use args array (params are desugared at parse time)
    callEnv = callEnv.set("args", { svalue: createArraySValue(args) });

    try {
      const result = stagingEvaluate(sclosure.body, callEnv, RefinementContext.empty());

      // Always use call expression as residual for recursive functions with Later args
      // This ensures proper code generation instead of inlining the body
      const funcResidual = svalueToResidual(func);
      const argResiduals = args.map(svalueToResidual);
      const callResidual = call(funcResidual, ...argResiduals);

      if (isNow(result.svalue)) {
        return {
          svalue: now(result.svalue.value, result.svalue.constraint, callResidual)
        };
      } else {
        return {
          svalue: later(result.svalue.constraint, callResidual)
        };
      }
    } finally {
      inProgressRecursiveCalls.delete(sclosure.name);
    }
  }

  // Non-recursive function or all arguments are Now - evaluate normally
  let callEnv = sclosure.env;

  // Add self-binding for recursive functions
  if (sclosure.name) {
    callEnv = callEnv.set(sclosure.name, { svalue: func });
  }

  // All functions use args array (params are desugared at parse time)
  callEnv = callEnv.set("args", { svalue: createArraySValue(args) });

  // Evaluate body
  const result = stagingEvaluate(sclosure.body, callEnv, RefinementContext.empty());

  // If any argument was Later/LaterArray and function has a residual (variable reference),
  // emit a call expression instead of inlining the body.
  // This prevents closure bodies from being duplicated at each call site.
  const nowFunc = func as Now; // TypeScript doesn't track this narrowing through the control flow
  if (args.some(sv => isLater(sv) || isLaterArray(sv)) && nowFunc.residual) {
    const funcResidual = nowFunc.residual;
    const argResiduals = args.map(svalueToResidual);
    const callResidual = call(funcResidual, ...argResiduals);

    if (isNow(result.svalue)) {
      return { svalue: now(result.svalue.value, result.svalue.constraint, callResidual) };
    } else {
      return { svalue: later(result.svalue.constraint, callResidual) };
    }
  }

  return result;
}

/**
 * Evaluate a method call on a receiver.
 *
 * For builtins marked as methods (like map, filter), desugars to a function call
 * with receiver-first argument order: arr.map(fn) -> map(arr, fn)
 *
 * For pure methods in the method registry, executes directly.
 */
function evalMethodCall(
  receiverExpr: Expr,
  methodName: string,
  argExprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Evaluate the receiver
  const recv = stagingEvaluate(receiverExpr, env, ctx).svalue;

  // Check if this method is a builtin (like map, filter)
  const builtinDef = getBuiltin(methodName);
  if (builtinDef && builtinDef.isMethod) {
    // Verify receiver matches first param constraint
    requireConstraint(recv.constraint, builtinDef.params[0].constraint, `receiver of .${methodName}()`);

    // Desugar to builtin call with receiver-first argument order
    // arr.map(fn) -> evalBuiltinCall(map, [receiverExpr, ...argExprs])
    const allArgExprs = [receiverExpr, ...argExprs];
    return evalBuiltinCall(builtinDef, allArgExprs, env, ctx);
  }

  // Look up the method based on receiver constraint (pure methods)
  const methodDef = lookupMethod(recv.constraint, methodName);

  if (!methodDef) {
    throw new Error(`No method '${methodName}' on type ${constraintToString(recv.constraint)}`);
  }

  // Evaluate arguments
  const args = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);

  // Check argument constraints
  if (args.length !== methodDef.params.length) {
    throw new Error(`Method '${methodName}' expects ${methodDef.params.length} arguments, got ${args.length}`);
  }

  for (let i = 0; i < methodDef.params.length; i++) {
    requireConstraint(args[i].constraint, methodDef.params[i], `argument ${i + 1} of .${methodName}()`);
  }

  // If receiver or any argument is Later/LaterArray, generate residual
  const isRuntime = (sv: SValue) => isLater(sv) || isLaterArray(sv);
  if (isRuntime(recv) || args.some(isRuntime)) {
    const recvResidual = svalueToResidual(recv);
    const argResiduals = args.map(svalueToResidual);

    const resultConstraint = methodDef.result(recv.constraint, args.map(a => a.constraint));

    return {
      svalue: later(resultConstraint, methodCall(recvResidual, methodName, argResiduals))
    };
  }

  // All Now - execute at compile time
  const resultValue = methodDef.impl(recv.value, args.map(a => (a as Now).value));
  const resultConstraint = methodDef.result(recv.constraint, args.map(a => a.constraint));

  // Refine constraint with actual value if possible
  const refinedConstraint = and(resultConstraint, constraintOf(resultValue));

  return { svalue: now(resultValue, simplify(refinedConstraint)) };
}

function evalObject(
  fields: { name: string; value: Expr }[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const evaluatedFields: { name: string; svalue: SValue }[] = [];

  for (const { name, value } of fields) {
    const result = stagingEvaluate(value, env, ctx).svalue;
    evaluatedFields.push({ name, svalue: result });
  }

  const allFieldsNow = evaluatedFields.every(f => isNow(f.svalue));

  if (allFieldsNow) {
    // All fields known - create Now object
    const objFields: Record<string, Value> = {};
    const fieldConstraints: Constraint[] = [isObject];

    for (const { name, svalue } of evaluatedFields) {
      const n = svalue as Now;
      objFields[name] = n.value;
      fieldConstraints.push(hasField(name, n.constraint));
    }

    const value = objectVal(objFields);
    // Mark as closed object - no unlisted fields allowed
    fieldConstraints.push(indexSig(neverC));
    const constraint = and(...fieldConstraints);

    // If any field has a residual (e.g., variable reference), generate a residual for the object
    // This preserves variable references in generated code instead of inlining
    const anyFieldHasResidual = evaluatedFields.some(f => (f.svalue as Now).residual !== undefined);
    if (anyFieldHasResidual) {
      const residualFields: { name: string; value: Expr }[] = [];
      for (const { name, svalue } of evaluatedFields) {
        residualFields.push({
          name,
          value: svalueToResidual(svalue)
        });
      }
      const residual = obj(Object.fromEntries(residualFields.map(f => [f.name, f.value])));
      return { svalue: now(value, constraint, residual) };
    }

    return { svalue: now(value, constraint) };
  }

  // At least one field is Later - generate residual
  const fieldConstraints: Constraint[] = [isObject];
  const residualFields: { name: string; value: Expr }[] = [];

  for (const { name, svalue } of evaluatedFields) {
    fieldConstraints.push(hasField(name, svalue.constraint));
    residualFields.push({
      name,
      value: svalueToResidual(svalue)
    });
  }

  // Mark as closed object - no unlisted fields allowed
  fieldConstraints.push(indexSig(neverC));
  const constraint = and(...fieldConstraints);
  return { svalue: later(constraint, obj(Object.fromEntries(residualFields.map(f => [f.name, f.value])))) };
}

function evalField(
  objectExpr: Expr,
  fieldName: string,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const objResult = stagingEvaluate(objectExpr, env, ctx).svalue;

  requireConstraint(objResult.constraint, isObject, `field access .${fieldName}`);

  if (isNow(objResult)) {
    if (objResult.value.tag !== "object") {
      throw new Error(`Cannot access field '${fieldName}' on non-object`);
    }

    const fieldValue = objResult.value.fields.get(fieldName);
    if (fieldValue === undefined) {
      throw new Error(`Object has no field '${fieldName}'`);
    }

    const fieldConstraint = extractFieldConstraint(objResult.constraint, fieldName);
    // fieldConstraint can't be null here since we just verified the field exists
    return { svalue: now(fieldValue, fieldConstraint!) };
  }

  // Object is Later - generate residual field access
  const fieldConstraint = extractFieldConstraint(objResult.constraint, fieldName);

  // If object has known fields but this field isn't among them, throw type error
  if (fieldConstraint === null) {
    throw new TypeError(
      hasField(fieldName, anyC),
      objResult.constraint,
      `field access .${fieldName}`
    );
  }

  return { svalue: later(fieldConstraint, field(svalueToResidual(objResult), fieldName)) };
}

/**
 * Create an array SValue from a list of SValues.
 * Used for creating the `args` array binding in function calls.
 */
function createArraySValue(elements: SValue[]): SValue {
  const allNow = elements.every(isNow);

  const constraints: Constraint[] = [isArray];
  constraints.push(length(and(isNumber, { tag: "equals", value: elements.length })));

  for (let i = 0; i < elements.length; i++) {
    constraints.push(elementAt(i, elements[i].constraint));
  }

  if (elements.length > 0) {
    const elementConstraints = elements.map(sv => sv.constraint);
    const unique = dedupeConstraints(elementConstraints);
    if (unique.length === 1) {
      constraints.push({ tag: "elements", constraint: unique[0] });
    } else {
      constraints.push({ tag: "elements", constraint: or(...unique) });
    }
  }

  if (allNow) {
    const values = elements.map(sv => (sv as Now).value);
    return now(arrayVal(values), and(...constraints));
  }

  // At least one element is Later - create LaterArray to preserve element structure
  return laterArray(elements, and(...constraints));
}

function evalArray(
  elementExprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const evaluatedElements = elementExprs.map(e => stagingEvaluate(e, env, ctx).svalue);
  const allElementsNow = evaluatedElements.every(isNow);

  if (allElementsNow) {
    const values = evaluatedElements.map(sv => (sv as Now).value);
    const constraints: Constraint[] = [isArray];

    constraints.push(length(and(isNumber, { tag: "equals", value: elementExprs.length })));

    for (let i = 0; i < evaluatedElements.length; i++) {
      constraints.push(elementAt(i, (evaluatedElements[i] as Now).constraint));
    }

    if (values.length > 0) {
      const elementConstraints = evaluatedElements.map(sv => (sv as Now).constraint);
      const unique = dedupeConstraints(elementConstraints);
      if (unique.length === 1) {
        constraints.push({ tag: "elements", constraint: unique[0] });
      } else {
        constraints.push({ tag: "elements", constraint: or(...unique) });
      }
    }

    // If any element has a residual (e.g., variable reference), generate a residual for the array
    const anyElementHasResidual = evaluatedElements.some(sv => (sv as Now).residual !== undefined);
    if (anyElementHasResidual) {
      const residualElements = evaluatedElements.map(svalueToResidual);
      const residual = array(...residualElements);
      return { svalue: now(arrayVal(values), and(...constraints), residual) };
    }

    return { svalue: now(arrayVal(values), and(...constraints)) };
  }

  // At least one element is Later - create LaterArray to preserve element structure
  const constraints: Constraint[] = [isArray];
  constraints.push(length(and(isNumber, { tag: "equals", value: elementExprs.length })));

  for (let i = 0; i < evaluatedElements.length; i++) {
    constraints.push(elementAt(i, evaluatedElements[i].constraint));
  }

  const elementConstraints = evaluatedElements.map(sv => sv.constraint);
  const unique = dedupeConstraints(elementConstraints);
  if (unique.length === 1) {
    constraints.push({ tag: "elements", constraint: unique[0] });
  } else {
    constraints.push({ tag: "elements", constraint: or(...unique) });
  }

  return { svalue: laterArray(evaluatedElements, and(...constraints)) };
}

function evalIndex(
  arrayExpr: Expr,
  indexExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const arr = stagingEvaluate(arrayExpr, env, ctx).svalue;
  const idx = stagingEvaluate(indexExpr, env, ctx).svalue;

  requireConstraint(arr.constraint, isArray, "array index");
  requireConstraint(idx.constraint, isNumber, "array index");

  if (isNow(arr) && isNow(idx)) {
    if (arr.value.tag !== "array") {
      throw new Error("Cannot index non-array");
    }
    if (idx.value.tag !== "number") {
      throw new Error("Array index must be a number");
    }

    const indexVal = idx.value.value;
    if (!Number.isInteger(indexVal) || indexVal < 0) {
      throw new Error(`Invalid array index: ${indexVal}`);
    }
    if (indexVal >= arr.value.elements.length) {
      throw new Error(`Array index out of bounds: ${indexVal} >= ${arr.value.elements.length}`);
    }

    const element = arr.value.elements[indexVal];
    const elementConstraint = extractElementConstraint(arr.constraint, indexVal);
    return { svalue: now(element, elementConstraint) };
  }

  // LaterArray with known index - extract element directly
  if (isLaterArray(arr) && isNow(idx) && idx.value.tag === "number") {
    const indexVal = idx.value.value;
    if (Number.isInteger(indexVal) && indexVal >= 0 && indexVal < arr.elements.length) {
      return { svalue: arr.elements[indexVal] };
    }
  }

  // At least one is Later
  let elementConstraint: Constraint;
  if (isNow(idx) && idx.value.tag === "number") {
    elementConstraint = extractElementConstraint(arr.constraint, idx.value.value);
  } else {
    elementConstraint = extractElementsConstraint(arr.constraint);
  }

  const arrResidual = svalueToResidual(arr);
  const idxResidual = svalueToResidual(idx);

  return { svalue: later(elementConstraint, index(arrResidual, idxResidual)) };
}

function evalBlock(
  exprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  if (exprs.length === 0) {
    return { svalue: now(nullVal, isNull) };
  }

  let lastResult: SValue = now(nullVal, isNull);
  for (const expr of exprs) {
    lastResult = stagingEvaluate(expr, env, ctx).svalue;
  }
  return { svalue: lastResult };
}

function evalComptime(
  expr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const result = stagingEvaluate(expr, env, ctx).svalue;

  if (isLater(result) || isLaterArray(result)) {
    throw new StagingError(
      `comptime expression evaluated to runtime value. ` +
      `Expression: ${exprToString(expr)}, ` +
      `Constraint: ${constraintToString(result.constraint)}`
    );
  }

  return { svalue: result };
}

function evalRuntime(
  expr: Expr,
  name: string | undefined,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Evaluate the expression to get its constraint
  const result = stagingEvaluate(expr, env, ctx).svalue;

  // Create a fresh variable for the residual
  const varName = name ?? freshVar("rt");

  // Return a Later with the constraint and a variable reference
  return { svalue: later(result.constraint, varRef(varName)) };
}

/**
 * Staged assertion - inserts runtime check if value is Later.
 * If value and constraint are both Now, checks immediately.
 */
function evalAssert(
  valueExpr: Expr,
  constraintExpr: Expr,
  message: string | undefined,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Evaluate the constraint expression - should be a Type value
  const constraintResult = stagingEvaluate(constraintExpr, env, ctx).svalue;

  if (isLater(constraintResult) || isLaterArray(constraintResult)) {
    throw new StagingError("assert requires a compile-time known type constraint");
  }

  if (constraintResult.value.tag !== "type") {
    throw new TypeError(isTypeC, constraintResult.constraint, "assert constraint");
  }

  const targetConstraint = constraintResult.value.constraint;

  // Evaluate the expression being asserted
  const valueResult = stagingEvaluate(valueExpr, env, ctx).svalue;

  if (isNow(valueResult)) {
    // Value is Now - check immediately at compile time
    if (!valueSatisfies(valueResult.value, targetConstraint)) {
      const errorMsg = message
        ? message
        : `Assertion failed: value ${valueToString(valueResult.value)} does not satisfy ${constraintToString(targetConstraint)}`;
      throw new AssertionError(errorMsg, valueResult.value, targetConstraint);
    }

    // Return the value with the refined constraint
    const refinedConstraint = unify(valueResult.constraint, targetConstraint);
    return { svalue: now(valueResult.value, refinedConstraint) };
  }

  // Value is Later/LaterArray - generate residual assertion
  // The residual will be: assert(value, type, message)
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);
  const residualAssert = assertExpr(svalueToResidual(valueResult), constraintExpr, message);

  return { svalue: later(refinedConstraint, residualAssert) };
}

/**
 * Staged assert for condition - checks a boolean condition.
 * Throws at compile-time if Now and false, generates residual if Later.
 */
function evalAssertCond(
  conditionExpr: Expr,
  message: string | undefined,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Evaluate the condition
  const condResult = stagingEvaluate(conditionExpr, env, ctx).svalue;

  if (isNow(condResult)) {
    // Condition is Now - check immediately at compile time
    if (condResult.value.tag !== "bool") {
      throw new Error("assert condition must be boolean");
    }

    if (!condResult.value.value) {
      const errorMsg = message ?? "Assertion failed: condition is false";
      throw new AssertionError(errorMsg, condResult.value, isBool);
    }

    // Return true with boolean constraint
    return { svalue: now(boolVal(true), isBool) };
  }

  // Condition is Later - generate residual assertion
  const residualAssert = assertCondExpr(svalueToResidual(condResult), message);
  return { svalue: later(isBool, residualAssert) };
}

/**
 * Staged trust - refines type without runtime check.
 * Works even if value is Later.
 * If no constraint is provided, the value is returned unchanged.
 */
function evalTrust(
  valueExpr: Expr,
  constraintExpr: Expr | undefined,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Evaluate the expression being trusted
  const valueResult = stagingEvaluate(valueExpr, env, ctx).svalue;

  // If no constraint specified, just return the value unchanged
  if (!constraintExpr) {
    return { svalue: valueResult };
  }

  // Evaluate the constraint expression - should be a Type value
  const constraintResult = stagingEvaluate(constraintExpr, env, ctx).svalue;

  if (isLater(constraintResult) || isLaterArray(constraintResult)) {
    throw new StagingError("trust requires a compile-time known type constraint");
  }

  // Extract constraint from result - handles TypeValue, array (tuple), and object (__arrayOf)
  const targetConstraint = extractConstraintFromValue(constraintResult.value);

  // Refine the constraint based on trust (no runtime check)
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);

  if (isNow(valueResult)) {
    return { svalue: now(valueResult.value, refinedConstraint) };
  }

  // Value is Later/LaterArray - trust is purely a type-level operation, no residual
  // The trust "disappears" and just affects the constraint
  if (isLaterArray(valueResult)) {
    // Preserve LaterArray structure with refined constraint
    return { svalue: laterArray(valueResult.elements, refinedConstraint) };
  }
  return { svalue: later(refinedConstraint, valueResult.residual) };
}

/**
 * Extract a Constraint from a value used as a type annotation.
 * Handles:
 * - TypeValue: return its constraint directly
 * - Array of TypeValues: interpret as tuple type
 * - Object with __arrayOf: interpret as Array<T> type
 * - Object with __constraintId: look up registered constraint
 */
function extractConstraintFromValue(v: Value): Constraint {
  // Direct TypeValue
  if (v.tag === "type") {
    return v.constraint;
  }

  // Array of types -> tuple constraint
  if (v.tag === "array") {
    const elementConstraints: Constraint[] = [];
    for (const elem of v.elements) {
      elementConstraints.push(extractConstraintFromValue(elem));
    }
    return tupleConstraint(elementConstraints);
  }

  // Object markers
  if (v.tag === "object") {
    // Object with __constraintId -> look up registered constraint
    const constraintIdValue = v.fields.get("__constraintId");
    if (constraintIdValue !== undefined) {
      if (constraintIdValue.tag !== "number") {
        throw new Error("Invalid constraint ID");
      }
      const constraint = getRegisteredConstraint(constraintIdValue.value);
      if (!constraint) {
        throw new Error(`Constraint ID ${constraintIdValue.value} not found`);
      }
      return constraint;
    }

    // Object with __arrayOf -> Array<T> constraint
    const arrayOfValue = v.fields.get("__arrayOf");
    if (arrayOfValue !== undefined) {
      const elementConstraint = extractConstraintFromValue(arrayOfValue);
      return arrayOfConstraint(elementConstraint);
    }
  }

  throw new TypeError(isTypeC, constraintOf(v), "trust constraint");
}

/**
 * Evaluate typeOf expression.
 * Returns the constraint of the expression as a Type value.
 * When expr is Later, returns `any` (the constraint is unknown at runtime).
 */
function evalTypeOf(
  expr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const result = stagingEvaluate(expr, env, ctx).svalue;

  // Get the constraint and wrap it as a TypeValue
  const constraint = result.constraint;
  const typeValue = typeVal(constraint);

  // typeOf is always evaluated at compile time
  return { svalue: now(typeValue, isType(constraint)) };
}

// Cache for loaded module exports to avoid reloading
// Key: "module:export" -> Constraint
const exportCache = new Map<string, Constraint>();

// Cache for function signatures (for creating synthetic closures)
// Key: "module:export" -> FunctionSignatureInfo
const signatureCache = new Map<string, FunctionSignatureInfo>();

/**
 * Staged import - loads TypeScript declarations and creates bindings.
 *
 * For functions with type parameters, creates synthetic closures that
 * preserve type information. For other values, creates Later bindings
 * with constraints from the .d.ts type declarations.
 *
 * Syntax: import { name1, name2 } from "module" in body
 */
function evalImport(
  names: string[],
  modulePath: string,
  bodyExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Load only the requested exports (lazy loading for efficiency)
  const uncachedNames = names.filter(name => !exportCache.has(`${modulePath}:${name}`));

  if (uncachedNames.length > 0) {
    const loader = new TSDeclarationLoader();
    const { constraints, signatures } = loader.loadExportsWithSignatures(modulePath, uncachedNames);

    // Cache the loaded exports and signatures
    for (const [name, constraint] of constraints) {
      exportCache.set(`${modulePath}:${name}`, constraint);
    }
    for (const [name, sig] of signatures) {
      signatureCache.set(`${modulePath}:${name}`, sig);
    }
  }

  // Create bindings for each imported name
  let newEnv = env;
  for (const name of names) {
    const constraint = exportCache.get(`${modulePath}:${name}`);
    if (!constraint) {
      throw new Error(`Module "${modulePath}" has no export named "${name}"`);
    }

    const sig = signatureCache.get(`${modulePath}:${name}`);

    // For functions with type parameters, create synthetic closures
    if (sig && sig.typeParamCount > 0) {
      // Create the impl binding (the actual imported function)
      const implName = `__${name}_impl`;
      newEnv = newEnv.set(implName, {
        svalue: later(isFunction, varRef(name))
      });

      // Create synthetic closure with type-preserving body
      const syntheticBody = buildSyntheticBody(sig, implName, sig.paramTypes.length);
      const closure = closureVal(syntheticBody, Env.empty());

      // Register with stagedClosures so it can be evaluated
      stagedClosures.set(closure, { body: syntheticBody, env: newEnv });

      // Bind the name to the synthetic closure (Now - closures are always Now)
      newEnv = newEnv.set(name, { svalue: now(closure, isFunction) });
    } else {
      // Non-generic imports: keep as Later binding
      newEnv = newEnv.set(name, { svalue: later(constraint, varRef(name)) });
    }
  }

  // Evaluate the body with imports in scope
  const bodyResult = stagingEvaluate(bodyExpr, newEnv, ctx).svalue;

  // If body is Now (doesn't use any imported values), return it directly
  if (isNow(bodyResult)) {
    return { svalue: bodyResult };
  }

  // Check if any imported names are actually used in the body
  const anyImportUsed = names.some(name => usesVar(bodyExpr, name));

  // If imports are used, wrap in residual import expression
  if (anyImportUsed) {
    return {
      svalue: later(
        bodyResult.constraint,
        importExpr(names, modulePath, svalueToResidual(bodyResult))
      )
    };
  }

  // No imports used - just return the body result
  return { svalue: bodyResult };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get free variables in an expression (variables not bound within the expression).
 */
function freeVars(expr: Expr, bound: Set<string> = new Set()): Set<string> {
  const free = new Set<string>();

  function visit(e: Expr, b: Set<string>): void {
    switch (e.tag) {
      case "lit":
        break;
      case "var":
        if (!b.has(e.name)) free.add(e.name);
        break;
      case "binop":
        visit(e.left, b);
        visit(e.right, b);
        break;
      case "unary":
        visit(e.operand, b);
        break;
      case "if":
        visit(e.cond, b);
        visit(e.then, b);
        visit(e.else, b);
        break;
      case "let": {
        visit(e.value, b);
        const newBound = new Set(b);
        newBound.add(e.name);
        visit(e.body, newBound);
        break;
      }
      case "letPattern": {
        visit(e.value, b);
        const newBound = new Set(b);
        for (const v of patternVars(e.pattern)) newBound.add(v);
        visit(e.body, newBound);
        break;
      }
      case "fn": {
        const newBound = new Set(b);
        for (const p of e.params) newBound.add(p);
        visit(e.body, newBound);
        break;
      }
      case "recfn": {
        const newBound = new Set(b);
        newBound.add(e.name);  // Name is bound for recursion
        for (const p of e.params) newBound.add(p);
        visit(e.body, newBound);
        break;
      }
      case "call":
        visit(e.func, b);
        for (const a of e.args) visit(a, b);
        break;
      case "obj":
        for (const f of e.fields) visit(f.value, b);
        break;
      case "field":
        visit(e.object, b);
        break;
      case "array":
        for (const el of e.elements) visit(el, b);
        break;
      case "index":
        visit(e.array, b);
        visit(e.index, b);
        break;
      case "block":
        for (const ex of e.exprs) visit(ex, b);
        break;
      case "comptime":
        visit(e.expr, b);
        break;
      case "runtime":
        visit(e.expr, b);
        break;
      case "assert":
        visit(e.expr, b);
        visit(e.constraint, b);
        break;
      case "assertCond":
        visit(e.condition, b);
        break;
      case "trust":
        visit(e.expr, b);
        if (e.constraint) visit(e.constraint, b);
        break;
      case "methodCall":
        visit(e.receiver, b);
        for (const a of e.args) visit(a, b);
        break;
      case "import": {
        // Import names are bound in the body
        const newBound = new Set(b);
        for (const name of e.names) newBound.add(name);
        visit(e.body, newBound);
        break;
      }
      case "typeOf":
        visit(e.expr, b);
        break;
    }
  }

  visit(expr, bound);
  return free;
}

/**
 * Internal implementation of closure to residual conversion.
 * Defined before valueToExpr so it can be called during value conversion.
 */
function closureToResidualInternal(closure: Value): Expr {
  if (closure.tag !== "closure") {
    throw new Error("closureToResidual requires a closure value");
  }

  const sclosure = stagedClosures.get(closure);
  if (!sclosure) {
    // Fallback: no staged info, emit body as-is
    return closure.name
      ? { tag: "recfn", name: closure.name, params: [], body: closure.body }
      : { tag: "fn", params: [], body: closure.body };
  }

  // Extract parameter names from the desugared body pattern
  // Body structure: let [param1, param2, ...] = args in actualBody
  const { paramNames, innerBody } = extractParamsFromBodyInternal(sclosure.body);

  // Create an environment with parameters as Later values
  let bodyEnv = sclosure.env;

  // Add self-reference for recursive functions
  if (sclosure.name) {
    bodyEnv = bodyEnv.set(sclosure.name, { svalue: now(closure, isFunction) });
  }

  // Create Later bindings for each parameter
  const paramSValues: SValue[] = [];
  for (const paramName of paramNames) {
    const paramSValue = later(anyC, varRef(paramName));
    paramSValues.push(paramSValue);
    bodyEnv = bodyEnv.set(paramName, { svalue: paramSValue });
  }

  // Also bind args array as Later
  bodyEnv = bodyEnv.set("args", { svalue: createArraySValue(paramSValues) });

  // Find free variables in the inner body that aren't bound in the environment
  // These are external references (globals, imports, etc.) - treat as Later
  const boundVars = new Set<string>(["args", ...paramNames]);
  if (sclosure.name) boundVars.add(sclosure.name);
  const freeInBody = freeVars(innerBody, boundVars);

  for (const freeVar of freeInBody) {
    if (!bodyEnv.has(freeVar)) {
      // External reference - bind as Later
      bodyEnv = bodyEnv.set(freeVar, { svalue: later(anyC, varRef(freeVar)) });
    } else {
      // Captured variable - ensure compound Now values have varRef residual
      // to avoid inlining large values
      const binding = bodyEnv.get(freeVar);
      const sv = binding.svalue;
      if (isNow(sv) && isCompoundValue(sv.value) && !sv.residual) {
        bodyEnv = bodyEnv.set(freeVar, {
          svalue: now(sv.value, sv.constraint, varRef(freeVar))
        });
      }
    }
  }

  // Stage the inner body (after parameter destructuring)
  const bodyResult = stagingEvaluate(innerBody, bodyEnv, RefinementContext.empty()).svalue;

  // Build the residual function
  const residualBody = svalueToResidual(bodyResult);

  if (closure.name) {
    return { tag: "recfn", name: closure.name, params: paramNames, body: residualBody };
  }
  return { tag: "fn", params: paramNames, body: residualBody };
}

/**
 * Extract parameter names and inner body from a desugared function body.
 * Internal version used before the public function is defined.
 */
function extractParamsFromBodyInternal(body: Expr): { paramNames: string[]; innerBody: Expr } {
  if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern") {
      const paramNames: string[] = [];
      for (const elem of pattern.elements) {
        if (elem.tag === "varPattern") {
          paramNames.push(elem.name);
        } else {
          // Complex pattern - can't extract simple param names
          return { paramNames: [], innerBody: body };
        }
      }
      return { paramNames, innerBody: body.body };
    }
  }
  // No parameter destructuring found - body is the actual body
  return { paramNames: [], innerBody: body };
}

/**
 * Get the residual expression from an SValue.
 * For Later values, returns the residual.
 * For Now values with a residual (e.g., variable reference), uses that.
 * For Now values without a residual, converts the value to an expression.
 */
export function svalueToResidual(sv: SValue): Expr {
  if (isLater(sv)) {
    return sv.residual;
  }
  if (isLaterArray(sv)) {
    // Compute array expression from elements
    return array(...sv.elements.map(svalueToResidual));
  }
  // Now value - use residual if present, otherwise convert value
  return sv.residual ?? valueToExpr(sv.value);
}

/**
 * Convert a value to an expression (for residual code generation).
 */
function valueToExpr(v: Value): Expr {
  switch (v.tag) {
    case "number":
      return lit(v.value);
    case "string":
      return lit(v.value);
    case "bool":
      return lit(v.value);
    case "null":
      return lit(null);
    case "object": {
      const fields: Record<string, Expr> = {};
      for (const [name, val] of v.fields) {
        fields[name] = valueToExpr(val);
      }
      return obj(fields);
    }
    case "array":
      return array(...v.elements.map(valueToExpr));
    case "closure": {
      // For nested closures (those being emitted as part of a let binding),
      // emit the body as-is. The staging of function bodies only happens
      // at the top level via closureToResidualInternal.
      // This avoids type errors when staging functions with typed parameters.
      const funcExpr: Expr = v.name
        ? { tag: "recfn", name: v.name, params: [], body: v.body }
        : { tag: "fn", params: [], body: v.body };
      return funcExpr;
    }
    case "type":
      // Types are referenced by their binding name in the environment
      // For now, just convert to the constraint representation
      // This is a simplified approach - could be improved
      throw new Error("Cannot convert type value to expression directly");
    case "builtin":
      // Builtins are referenced by name in the environment
      return varRef(v.name);
  }
}

/**
 * Check if an expression uses a variable.
 */
function usesVar(expr: Expr, name: string): boolean {
  switch (expr.tag) {
    case "lit":
      return false;
    case "var":
      return expr.name === name;
    case "binop":
      return usesVar(expr.left, name) || usesVar(expr.right, name);
    case "unary":
      return usesVar(expr.operand, name);
    case "if":
      return usesVar(expr.cond, name) || usesVar(expr.then, name) || usesVar(expr.else, name);
    case "let":
      if (expr.name === name) {
        return usesVar(expr.value, name); // Body doesn't count - shadowed
      }
      return usesVar(expr.value, name) || usesVar(expr.body, name);
    case "letPattern": {
      const patVars = patternVars(expr.pattern);
      if (patVars.includes(name)) {
        return usesVar(expr.value, name); // Body doesn't count - shadowed
      }
      return usesVar(expr.value, name) || usesVar(expr.body, name);
    }
    case "fn":
      if (expr.params.includes(name)) return false; // Shadowed
      return usesVar(expr.body, name);
    case "recfn":
      if (expr.name === name || expr.params.includes(name)) return false; // Shadowed
      return usesVar(expr.body, name);
    case "call":
      return usesVar(expr.func, name) || expr.args.some(a => usesVar(a, name));
    case "obj":
      return expr.fields.some(f => usesVar(f.value, name));
    case "field":
      return usesVar(expr.object, name);
    case "array":
      return expr.elements.some(e => usesVar(e, name));
    case "index":
      return usesVar(expr.array, name) || usesVar(expr.index, name);
    case "block":
      return expr.exprs.some(e => usesVar(e, name));
    case "comptime":
      return usesVar(expr.expr, name);
    case "runtime":
      return usesVar(expr.expr, name);
    case "assert":
      return usesVar(expr.expr, name) || usesVar(expr.constraint, name);
    case "assertCond":
      return usesVar(expr.condition, name);
    case "trust":
      return usesVar(expr.expr, name) || (expr.constraint ? usesVar(expr.constraint, name) : false);
    case "methodCall":
      return usesVar(expr.receiver, name) || expr.args.some(a => usesVar(a, name));
    case "import":
      // Import names shadow variables in the body
      if (expr.names.includes(name)) return false;
      return usesVar(expr.body, name);
    case "typeOf":
      return usesVar(expr.expr, name);
  }
}

/**
 * Extract the index constraint from an object constraint.
 * Returns the constraint for unlisted fields, or null if no index constraint found.
 */
function extractIndexConstraint(c: Constraint): Constraint | null {
  if (c.tag === "index") return c.constraint;
  if (c.tag === "and") {
    for (const sub of c.constraints) {
      if (sub.tag === "index") return sub.constraint;
    }
  }
  return null;
}

/**
 * Extract the constraint for a specific field from an object constraint.
 * Returns null if the object is closed (has index(never)) but this field isn't among hasField.
 * Returns the index constraint if the field isn't in hasField but index exists.
 * Returns anyC if the object type is completely unknown (no index constraint).
 */
function extractFieldConstraint(objConstraint: Constraint, fieldName: string): Constraint | null {
  // First, look for an explicit hasField for this field
  if (objConstraint.tag === "hasField" && objConstraint.name === fieldName) {
    return objConstraint.constraint;
  }
  if (objConstraint.tag === "and") {
    for (const c of objConstraint.constraints) {
      if (c.tag === "hasField" && c.name === fieldName) {
        return c.constraint;
      }
    }
  }

  // Field not found in hasField constraints. Check for index constraint.
  const indexConstraint = extractIndexConstraint(objConstraint);
  if (indexConstraint !== null) {
    // If index is never, no unlisted fields are allowed - return null (error)
    if (indexConstraint.tag === "never") {
      return null;
    }
    // Otherwise, unlisted fields have this type
    return indexConstraint;
  }

  // No index constraint - object is "open" (unknown structure), allow any field
  return anyC;
}

function extractElementConstraint(arrConstraint: Constraint, idx: number): Constraint {
  if (arrConstraint.tag === "elementAt" && arrConstraint.index === idx) {
    return arrConstraint.constraint;
  }
  if (arrConstraint.tag === "and") {
    for (const c of arrConstraint.constraints) {
      if (c.tag === "elementAt" && c.index === idx) {
        return c.constraint;
      }
    }
    for (const c of arrConstraint.constraints) {
      if (c.tag === "elements") {
        return c.constraint;
      }
    }
  }
  return { tag: "any" };
}

function extractElementsConstraint(arrConstraint: Constraint): Constraint {
  if (arrConstraint.tag === "elements") {
    return arrConstraint.constraint;
  }
  if (arrConstraint.tag === "and") {
    for (const c of arrConstraint.constraints) {
      if (c.tag === "elements") {
        return c.constraint;
      }
    }
  }
  return { tag: "any" };
}

function dedupeConstraints(constraints: Constraint[]): Constraint[] {
  const result: Constraint[] = [];
  for (const c of constraints) {
    if (!result.some(r => constraintEquals(c, r))) {
      result.push(c);
    }
  }
  return result;
}

function constraintEquals(a: Constraint, b: Constraint): boolean {
  return JSON.stringify(a) === JSON.stringify(b); // Simple structural equality
}

/**
 * Check if a value is a compound type (object, array, closure).
 * These should not be inlined to avoid duplicating large literals.
 */
function isCompoundValue(v: Value): boolean {
  return v.tag === "object" || v.tag === "array" || v.tag === "closure";
}

/**
 * Check if a residual expression is "simple" and can be safely inlined.
 * Simple residuals are variable references and literals.
 * Complex residuals (calls, operations, etc.) should be bound to variables.
 */
function isSimpleResidual(expr: Expr): boolean {
  return expr.tag === "var" || expr.tag === "lit";
}

// Import for error messages
import { exprToString } from "./expr";

// ============================================================================
// Type Bindings
// ============================================================================

/**
 * Pre-bound type constants for the staged environment.
 * Types are Now values (known at compile time).
 */
const typeBindings: Record<string, SBinding> = {
  "number": { svalue: now(typeVal(isNumber), isType(isNumber)) },
  "string": { svalue: now(typeVal(isString), isType(isString)) },
  "boolean": { svalue: now(typeVal(isBool), isType(isBool)) },
  "null": { svalue: now(typeVal(isNull), isType(isNull)) },
  "object": { svalue: now(typeVal(isObject), isType(isObject)) },
  "array": { svalue: now(typeVal(isArray), isType(isArray)) },
  "function": { svalue: now(typeVal(isFunction), isType(isFunction)) },
};

/**
 * Create the initial staged environment with type and builtin bindings.
 */
function createInitialSEnv(): SEnv {
  let env = SEnv.empty();

  // Add type bindings
  for (const [name, binding] of Object.entries(typeBindings)) {
    env = env.set(name, binding);
  }

  // Add builtins from the registry as BuiltinValue
  // Use simple isFunction constraint - types derived at call site
  for (const builtin of getAllBuiltins()) {
    env = env.set(builtin.name, {
      svalue: now(builtinVal(builtin.name), isFunction)
    });
  }

  return env;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run staged evaluation on an expression.
 */
export function stage(expr: Expr): SEvalResult {
  resetVarCounter();
  return stagingEvaluate(expr, createInitialSEnv());
}

/**
 * Run staged evaluation and get the residual expression.
 * If result is Now, returns the literal expression.
 * If result is Later, returns the residual.
 */
export function stageToExpr(expr: Expr): Expr {
  const result = stage(expr).svalue;
  if (isNow(result)) {
    return valueToExpr(result.value);
  }
  return svalueToResidual(result);
}

/**
 * Evaluate an expression with an initial environment.
 * Uses staged evaluation internally but requires all values to be compile-time known.
 * This is the primary entry point for running expressions.
 */
export function run(expr: Expr, initialBindings?: Record<string, { value: Value; constraint: Constraint }>): EvalResult {
  resetVarCounter();
  let env = createInitialSEnv();

  if (initialBindings) {
    for (const [name, binding] of Object.entries(initialBindings)) {
      env = env.set(name, {
        svalue: now(binding.value, binding.constraint),
      });
    }
  }

  const result = stagingEvaluate(expr, env);

  if (!isNow(result.svalue)) {
    throw new Error("Expression has runtime dependencies - use stage() for partial evaluation");
  }

  return { value: result.svalue.value, constraint: result.svalue.constraint };
}

/**
 * Evaluate an expression and return just the value.
 */
export function runValue(expr: Expr): Value {
  return run(expr).value;
}

// ============================================================================
// Closure Residualization
// ============================================================================

/**
 * Convert a closure to a residual expression by staging its body.
 *
 * This is used when emitting a function that was created at compile time
 * but needs to be output as code (e.g., React components).
 *
 * The process:
 * 1. Extract parameter names from the desugared body (let [params] = args in ...)
 * 2. Create Later bindings for each parameter
 * 3. Stage the body with those bindings
 * 4. Return a function expression with the residual body
 */
export function closureToResidual(closure: Value): Expr {
  return closureToResidualInternal(closure);
}
