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

import { Expr, BinOp, UnaryOp, varRef, binop, unary, ifExpr, letExpr, letPatternExpr, call, obj, field, array, index, block, lit, fn, recfn, assertExpr, assertCondExpr, trustExpr, methodCall, importExpr, Pattern, patternVars, specializedCall, deferredClosure } from "./expr";
import { TSDeclarationLoader, FunctionSignatureInfo, buildSyntheticBody, getRegisteredConstraint } from "./ts-loader";
import { lookupMethod } from "./methods";
import { Value, numberVal, stringVal, boolVal, nullVal, objectVal, arrayVal, closureVal, constraintOf, valueToString, typeVal, valueSatisfies, builtinVal } from "./value";
import { getBuiltin, getAllBuiltins, BuiltinDef, StagedBuiltinContext } from "./builtin-registry";
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, hasField, elements, length, elementAt, implies, simplify, or, narrowOr, isType, isTypeC, unify, constraintToString, tupleConstraint, arrayOfConstraint, anyC, neverC, indexSig } from "./constraint";
import { Env, Binding, RefinementContext } from "./env";
import { getBinaryOp, getUnaryOp, requireConstraint, TypeError, stringConcat, AssertionError, EvalResult } from "./builtins";
import { extractAllRefinements, negateRefinement } from "./refinement";
import {
  SValue, Now, Later, LaterArray, StagedClosure, SEnv, SBinding,
  now, later, laterArray, laterRuntime, laterImport, stagedClosure, mergeCaptures,
  isNow, isLater, isLaterArray, isStagedClosure, isRuntime, allNow
} from "./svalue";

// ============================================================================
// Staging Errors
// ============================================================================

export class StagingError extends Error {
  constructor(message: string) {
    super(`Staging error: ${message}`);
    this.name = "StagingError";
  }
}

/**
 * Error thrown when comptime evaluation requires a Now value but got Later.
 * Tracks which parameters (if any) caused the failure, enabling targeted specialization.
 */
export class ComptimeRequiresNowError extends StagingError {
  /** Parameters that were Later when they needed to be Now */
  readonly laterParams: Set<string>;

  constructor(message: string, laterParams: Set<string> = new Set()) {
    super(message);
    this.name = "ComptimeRequiresNowError";
    this.laterParams = laterParams;
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

    case "deferredClosure":
      // deferredClosure is only used during code generation
      throw new Error("deferredClosure cannot be evaluated - it is only used during codegen");

    case "specializedCall":
      // specializedCall is only used in residuals during code generation
      throw new Error("specializedCall cannot be evaluated - it is only used in residuals during codegen");
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
    } else if (isStagedClosure(sv)) {
      // StagedClosure - update constraint
      return { svalue: stagedClosure(sv.body, sv.params, sv.env, refined, sv.name, sv.siblings) };
    } else {
      return { svalue: later(refined, sv.residual, sv.captures) };
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

  // Merge captures from both operands for derived Later
  const captures = mergeCaptures([left, right]);

  // Special case: + can be string concatenation
  if (op === "+") {
    const leftIsString = implies(left.constraint, isString);
    const rightIsString = implies(right.constraint, isString);

    if (leftIsString || rightIsString) {
      requireConstraint(left.constraint, isString, "left of string +");
      requireConstraint(right.constraint, isString, "right of string +");

      const resultConstraint = stringConcat.result([left.constraint, right.constraint]);
      return { svalue: later(resultConstraint, binop(op, leftResidual, rightResidual), captures) };
    }
  }

  const builtin = getBinaryOp(op);

  // Still check constraints for type safety
  requireConstraint(left.constraint, builtin.params[0], `left of ${op}`);
  requireConstraint(right.constraint, builtin.params[1], `right of ${op}`);

  const resultConstraint = builtin.result([left.constraint, right.constraint]);

  return { svalue: later(resultConstraint, binop(op, leftResidual, rightResidual), captures) };
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
  const captures = mergeCaptures([operand]);
  return { svalue: later(resultConstraint, unary(op, svalueToResidual(operand)), captures) };
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

  // Merge captures from condition and both branches
  const captures = mergeCaptures([cond, thenResult, elseResult]);

  return { svalue: later(resultConstraint, ifExpr(svalueToResidual(cond), thenResidual, elseResidual), captures) };
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
  // For StagedClosure, set residual to varRef so subsequent uses reference the variable.
  let boundValue: SValue;
  if (isLater(valueResult) && !isSimpleResidual(valueResult.residual)) {
    boundValue = later(valueResult.constraint, varRef(name), valueResult.captures, valueResult.origin);
  } else if (isStagedClosure(valueResult)) {
    // Bind closure with residual pointing to the variable name
    // Keep name only if it's a recursive function (has explicit name from fn name(...) syntax)
    // The binding name can be derived from residual.name when needed for codegen
    boundValue = { ...valueResult, residual: varRef(name) };
  } else {
    boundValue = valueResult;
  }

  const newEnv = env.set(name, { svalue: boundValue });

  const bodyResult = stagingEvaluate(bodyExpr, newEnv, ctx).svalue;

  // If the body is Now, return it directly even if the bound value was Later.
  // This handles cases like typeOf() which extract compile-time type info from Later values.
  if (isNow(bodyResult)) {
    return { svalue: bodyResult };
  }

  // Body is Later - decide whether to emit a let binding
  // For Later/LaterArray values: check original expression (to avoid duplicate evaluation of side effects)
  // For StagedClosure values: check the residual - if the closure was fully specialized at all
  //   call sites (e.g., generic functions like `id(number)`), its name won't appear in the residual
  //   and we can skip emitting it. This is critical for type erasure - generic closures can't be
  //   residualized because type parameters would become Later.
  //   With two-pass codegen, also check if body contains specializedCall nodes referencing this closure.
  // For Now values with compound types (objects, arrays, closures): check original expression
  //   to preserve code structure and avoid duplicating large literals
  // For Now values with primitives: check residual (inlining is fine)
  const shouldEmitLet = isLater(valueResult) || isLaterArray(valueResult)
    ? usesVar(bodyExpr, name)
    : isStagedClosure(valueResult)
      ? usesVar(svalueToResidual(bodyResult), name) || usesClosureByIdentity(svalueToResidual(bodyResult), boundValue as StagedClosure)
      : isCompoundValue(valueResult.value)
        ? usesVar(bodyExpr, name)
        : usesVar(svalueToResidual(bodyResult), name);

  if (shouldEmitLet) {
    // Variable is used in body - need to emit a let binding
    // For StagedClosure, emit a deferredClosure with boundValue (not valueResult)
    // so the closure object identity matches specializedCall nodes in the body.
    // We can't use svalueToResidual(boundValue) because boundValue has a varRef
    // residual which would just emit the variable reference, not the actual closure.
    // For non-closures, use valueResult which has the original expression residual.
    const valueResidual = isStagedClosure(boundValue)
      ? deferredClosure(boundValue)
      : svalueToResidual(valueResult);

    // Merge captures from both the value and body
    const captures = mergeCaptures([valueResult, bodyResult]);

    return {
      svalue: later(
        bodyResult.constraint,
        letExpr(name, valueResidual, svalueToResidual(bodyResult)),
        captures
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
        if (isNow(val) || isStagedClosure(val)) {
          // Preserve Now values and StagedClosures directly
          // StagedClosures are compile-time known and should be kept as-is
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

/**
 * Find parameters used inside comptime() expressions in a function body.
 * These parameters must be Now at call sites for specialization to occur.
 */
function findComptimeParams(body: Expr, params: Set<string>): Set<string> {
  const result = new Set<string>();

  function walk(expr: Expr, inComptime: boolean, localBindings: Set<string>): void {
    switch (expr.tag) {
      case "comptime":
        // Everything inside comptime that references params needs those params to be Now
        walk(expr.expr, true, localBindings);
        break;

      case "var":
        // Check if this var references a param (not shadowed by local binding)
        if (inComptime && params.has(expr.name) && !localBindings.has(expr.name)) {
          result.add(expr.name);
        }
        break;

      case "lit":
      case "runtime":
        break;

      case "binop":
        walk(expr.left, inComptime, localBindings);
        walk(expr.right, inComptime, localBindings);
        break;

      case "unary":
        walk(expr.operand, inComptime, localBindings);
        break;

      case "if":
        walk(expr.cond, inComptime, localBindings);
        walk(expr.then, inComptime, localBindings);
        walk(expr.else, inComptime, localBindings);
        break;

      case "let": {
        walk(expr.value, inComptime, localBindings);
        const newBindings = new Set(localBindings);
        newBindings.add(expr.name);
        walk(expr.body, inComptime, newBindings);
        break;
      }

      case "letPattern": {
        walk(expr.value, inComptime, localBindings);
        const newBindings = new Set(localBindings);
        for (const v of patternVars(expr.pattern)) {
          newBindings.add(v);
        }
        walk(expr.body, inComptime, newBindings);
        break;
      }

      case "fn": {
        // Recurse into nested function bodies to find comptime uses of outer params
        // The nested function's own params are local bindings
        const paramNames = extractParamsFromBody(expr.body);
        const newBindings = new Set(localBindings);
        for (const p of paramNames) {
          newBindings.add(p);
        }
        // Walk the full body - extractParamsFromBody only gets param names
        walk(expr.body, inComptime, newBindings);
        break;
      }

      case "recfn": {
        // Same for recursive functions
        const paramNames = extractParamsFromBody(expr.body);
        const newBindings = new Set(localBindings);
        newBindings.add(expr.name); // Self-reference
        for (const p of paramNames) {
          newBindings.add(p);
        }
        walk(expr.body, inComptime, newBindings);
        break;
      }

      case "call":
        walk(expr.func, inComptime, localBindings);
        for (const arg of expr.args) {
          walk(arg, inComptime, localBindings);
        }
        break;

      case "obj":
        for (const field of expr.fields) {
          walk(field.value, inComptime, localBindings);
        }
        break;

      case "field":
        walk(expr.object, inComptime, localBindings);
        break;

      case "array":
        for (const elem of expr.elements) {
          walk(elem, inComptime, localBindings);
        }
        break;

      case "index":
        walk(expr.array, inComptime, localBindings);
        walk(expr.index, inComptime, localBindings);
        break;

      case "block":
        for (const e of expr.exprs) {
          walk(e, inComptime, localBindings);
        }
        break;

      case "assert":
        walk(expr.expr, inComptime, localBindings);
        walk(expr.constraint, inComptime, localBindings);
        break;

      case "assertCond":
        walk(expr.condition, inComptime, localBindings);
        break;

      case "trust":
        walk(expr.expr, inComptime, localBindings);
        if (expr.constraint) walk(expr.constraint, inComptime, localBindings);
        break;

      case "methodCall":
        walk(expr.receiver, inComptime, localBindings);
        for (const arg of expr.args) {
          walk(arg, inComptime, localBindings);
        }
        break;

      case "import":
        walk(expr.body, inComptime, localBindings);
        break;

      case "typeOf":
        // typeOf returns a Type value which is comptime-only.
        // So variables used inside typeOf need to be known at comptime
        // for the type result to be meaningful/usable.
        walk(expr.expr, true, localBindings);
        break;

      case "deferredClosure":
      case "specializedCall":
        // These are codegen-only nodes, shouldn't appear during analysis
        break;
    }
  }

  walk(body, false, new Set<string>());
  return result;
}

function evalFn(params: string[], body: Expr, env: SEnv): SEvalResult {
  // Functions are StagedClosure - they carry their captured environment directly
  // The type emerges from body analysis at call sites - no upfront inference needed
  // Note: params is extracted from the desugared body pattern
  const extractedParams = extractParamsFromBody(body);

  // Find params used inside comptime() - these need specialization
  const paramSet = new Set(extractedParams);
  const comptimeParams = findComptimeParams(body, paramSet);

  // Return a StagedClosure with the captured environment
  return { svalue: stagedClosure(body, extractedParams, env, isFunction, undefined, undefined, comptimeParams) };
}

/**
 * Evaluate a named recursive function in staged context.
 * The function can call itself by name within its body.
 */
function evalRecFn(name: string, params: string[], body: Expr, env: SEnv): SEvalResult {
  // Create a StagedClosure with self-reference
  // Note: params is extracted from the desugared body pattern
  const extractedParams = extractParamsFromBody(body);

  // Find params used inside comptime() - these need specialization
  const paramSet = new Set(extractedParams);
  const comptimeParams = findComptimeParams(body, paramSet);

  // The closure will reference itself by name - we'll set up the self-binding at call time
  return { svalue: stagedClosure(body, extractedParams, env, isFunction, name, undefined, comptimeParams) };
}

/**
 * Extract parameter names from a desugared function body.
 * Body structure: let [param1, param2, ...] = args in actualBody
 */
function extractParamsFromBody(body: Expr): string[] {
  if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern") {
      const paramNames: string[] = [];
      for (const elem of pattern.elements) {
        if (elem.tag === "varPattern") {
          paramNames.push(elem.name);
        } else {
          // Complex pattern - can't extract simple param names
          return [];
        }
      }
      return paramNames;
    }
  }
  // No parameter destructuring found
  return [];
}

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
      invokeClosure: (closureSV, closureArgs) => {
        if (!isStagedClosure(closureSV)) {
          throw new Error("invokeClosure requires a StagedClosure");
        }
        let callEnv = closureSV.env;
        if (closureSV.name) {
          callEnv = callEnv.set(closureSV.name, { svalue: closureSV });
        }
        // All functions use args array (params are desugared at parse time)
        callEnv = callEnv.set("args", { svalue: createArraySValue(closureArgs) });
        return stagingEvaluate(closureSV.body, callEnv, RefinementContext.empty());
      },
      valueToExpr,
      svalueToResidual,
      now,
      later: (constraint, residual) => later(constraint, residual),
      laterArray,
      isNow,
      isLaterArray,
      isStagedClosure,
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

  // Handle Later functions (opaque - can't inspect body)
  if (isLater(func)) {
    const argResults = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);
    const argResiduals = argResults.map(svalueToResidual);
    const captures = mergeCaptures([func, ...argResults]);

    // We don't know the result constraint without knowing the function
    // Use 'any' as a conservative approximation
    return { svalue: later({ tag: "any" }, call(svalueToResidual(func), ...argResiduals), captures) };
  }

  // Handle StagedClosure - we can analyze and evaluate the body
  if (isStagedClosure(func)) {
    // Evaluate arguments
    const args = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);

    // Check if any arg requires residualization (Later or LaterArray)
    // This includes values from runtime(), import, AND derived operations
    const hasLaterArg = args.some(arg => isLater(arg) || isLaterArray(arg));

    // Coinductive cycle detection - check FIRST, for any Later arg
    // This prevents infinite recursion when analyzing recursive functions
    if (func.name && hasLaterArg && inProgressRecursiveCalls.has(func.name)) {
      // Cycle detected! We're already evaluating this recursive function with Later args.
      // Emit a specializedCall with func.body as a marker for self-recursive calls.
      // Codegen will recognize this and resolve to the appropriate function name.
      const resultConstraint = inProgressRecursiveCalls.get(func.name)!;
      const argResiduals = args.map(svalueToResidual);
      const captures = mergeCaptures(args);
      return {
        svalue: later(resultConstraint, specializedCall(func, func.body, argResiduals), captures)
      };
    }

    // If we have Later args and this is a named recursive function, enter analysis mode
    if (func.name && hasLaterArg) {
      // Mark as in-progress for cycle detection
      // Use 'any' as result constraint - types derived from body
      inProgressRecursiveCalls.set(func.name, { tag: "any" });

      // Bind args array in the closure's environment
      let callEnv = func.env;
      callEnv = callEnv.set(func.name, { svalue: func });
      // All functions use args array (params are desugared at parse time)
      callEnv = callEnv.set("args", { svalue: createArraySValue(args) });

      try {
        const result = stagingEvaluate(func.body, callEnv, RefinementContext.empty());

        // Always use call expression as residual for recursive functions with Later args
        // This ensures proper code generation instead of inlining the body
        const argResiduals = args.map(svalueToResidual);
        const captures = mergeCaptures(args);

        if (isNow(result.svalue)) {
          // Result is fully computed - use original call name (no specialization needed)
          const callName = funcExpr.tag === "var" ? funcExpr.name : func.name;
          const callResidual = call(varRef(callName), ...argResiduals);
          return {
            svalue: now(result.svalue.value, result.svalue.constraint, callResidual)
          };
        } else {
          // Result is Later - emit specializedCall with the staged body
          const bodyResidual = svalueToResidual(result.svalue);
          const callResidual = specializedCall(func, bodyResidual, argResiduals);
          return {
            svalue: later(result.svalue.constraint, callResidual, captures)
          };
        }
      } finally {
        inProgressRecursiveCalls.delete(func.name);
      }
    }

    // Non-recursive function or all arguments are Now/StagedClosure - evaluate normally
    let callEnv = func.env;

    // Add self-binding for recursive functions
    if (func.name) {
      callEnv = callEnv.set(func.name, { svalue: func });
    }

    // All functions use args array (params are desugared at parse time)
    callEnv = callEnv.set("args", { svalue: createArraySValue(args) });

    // Evaluate body
    const result = stagingEvaluate(func.body, callEnv, RefinementContext.empty());

    // Emit a call expression instead of inlining the body when:
    // 1. Function is called by name (funcExpr.tag === "var") OR has a residual (was bound to a name)
    // 2. AND either:
    //    a. Any argument was Later (hasLaterArg), OR
    //    b. The result is Later/LaterArray (body couldn't be fully evaluated due to captured Later vars)
    // This prevents closure bodies from being duplicated at each call site.
    const resultIsLater = isLater(result.svalue) || isLaterArray(result.svalue);
    const hasNameBinding = funcExpr.tag === "var" || func.residual;
    if (hasNameBinding && (hasLaterArg || resultIsLater)) {
      const argResiduals = args.map(svalueToResidual);
      const captures = mergeCaptures(args);

      if (isNow(result.svalue)) {
        // Result is fully computed - use original call residual (no specialization needed)
        const funcResidual = func.residual ?? varRef((funcExpr as { name: string }).name);
        const callResidual = call(funcResidual, ...argResiduals);
        return { svalue: now(result.svalue.value, result.svalue.constraint, callResidual) };
      } else if (isStagedClosure(result.svalue)) {
        // Result is a closure - return as-is (closures are compile-time known)
        return result;
      } else {
        // Result is Later - emit specializedCall with the staged body
        const bodyResidual = svalueToResidual(result.svalue);
        // Use specializedCall for bound closures (have a residual) that may need specialization
        // This includes both named recursive functions and anonymous closures bound via let
        // Also include closures with comptimeParams - these MUST be specialized to bake in comptime values
        const hasComptimeParams = func.comptimeParams && func.comptimeParams.size > 0;
        if (func.residual || func.name || hasComptimeParams) {
          const callResidual = specializedCall(func, bodyResidual, argResiduals);
          return { svalue: later(result.svalue.constraint, callResidual, captures) };
        } else {
          // Truly anonymous closure (e.g., synthetic import wrapper) - use original call expression
          const funcResidual = varRef((funcExpr as { name: string }).name);
          const callResidual = call(funcResidual, ...argResiduals);
          return { svalue: later(result.svalue.constraint, callResidual, captures) };
        }
      }
    }

    // If the function has a residual and returns a StagedClosure, propagate a residual
    // to the result. This ensures curried functions like `minLength(8)(password)` emit
    // `minLength(8)(password)` instead of inlining the body.
    // EXCEPTION: Skip if any argument is a TypeValue - types are erased and can't be residualized.
    // For generic functions like `fn(T) => fn(x) => ...`, the call `id(number)` should NOT
    // create a residual because `number` (a type) can't appear in generated JavaScript.
    const hasTypeArg = args.some(a => isNow(a) && a.value.tag === "type");
    if (hasNameBinding && isStagedClosure(result.svalue) && !result.svalue.residual && !hasTypeArg) {
      const argResiduals = args.map(svalueToResidual);
      // For functions with comptimeParams, use specializedCall so comptime values get baked in during codegen
      const hasComptimeParams = func.comptimeParams && func.comptimeParams.size > 0;
      if (hasComptimeParams) {
        // The result closure has comptime values captured - use specializedCall
        const bodyResidual = svalueToResidual(result.svalue);
        const callResidual = specializedCall(func, bodyResidual, argResiduals);
        return { svalue: { ...result.svalue, residual: callResidual } };
      } else {
        const funcResidual = func.residual ?? varRef((funcExpr as { name: string }).name);
        const callResidual = call(funcResidual, ...argResiduals);
        return { svalue: { ...result.svalue, residual: callResidual } };
      }
    }

    return result;
  }

  // Handle LaterArray (shouldn't happen, but handle for completeness)
  if (isLaterArray(func)) {
    throw new Error("Cannot call a LaterArray");
  }

  // Handle Now with closure Value (legacy path - shouldn't happen with new design)
  if (isNow(func) && func.value.tag === "closure") {
    throw new Error("Unexpected closure Value - should be StagedClosure");
  }

  throw new Error("Cannot call non-function");
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
  if (isRuntime(recv) || args.some(isRuntime)) {
    const recvResidual = svalueToResidual(recv);
    const argResiduals = args.map(svalueToResidual);

    const resultConstraint = methodDef.result(recv.constraint, args.map(a => a.constraint));

    return {
      svalue: later(resultConstraint, methodCall(recvResidual, methodName, argResiduals))
    };
  }

  // StagedClosure shouldn't have methods called on it
  if (isStagedClosure(recv)) {
    throw new Error(`Cannot call method '${methodName}' on a closure`);
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
  // Merge captures from all field values
  const captures = mergeCaptures(evaluatedFields.map(f => f.svalue));
  return { svalue: later(constraint, obj(Object.fromEntries(residualFields.map(f => [f.name, f.value]))), captures) };
}

function evalField(
  objectExpr: Expr,
  fieldName: string,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const objResult = stagingEvaluate(objectExpr, env, ctx).svalue;

  // Handle .length on strings and arrays
  if (fieldName === "length") {
    if (implies(objResult.constraint, isString) || implies(objResult.constraint, isArray)) {
      // For Now values, compute the actual length
      if (isNow(objResult)) {
        if (objResult.value.tag === "string") {
          const len = objResult.value.value.length;
          return { svalue: now(numberVal(len), and(isNumber, { tag: "equals", value: len })) };
        }
        if (objResult.value.tag === "array") {
          const len = objResult.value.elements.length;
          return { svalue: now(numberVal(len), and(isNumber, { tag: "equals", value: len })) };
        }
      }
      // For Later values, always return Later for length - the value could change at runtime
      // even if the initial constraint has a specific length
      const lengthConstraint = extractLengthConstraint(objResult.constraint);
      const captures = mergeCaptures([objResult]);
      return { svalue: later(lengthConstraint, field(svalueToResidual(objResult), "length"), captures) };
    }
  }

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

  const captures = mergeCaptures([objResult]);
  return { svalue: later(fieldConstraint, field(svalueToResidual(objResult), fieldName), captures) };
}

/**
 * Create an array SValue from a list of SValues.
 * Used for creating the `args` array binding in function calls.
 */
export function createArraySValue(elements: SValue[]): SValue {
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

  const captures = mergeCaptures([arr, idx]);
  return { svalue: later(elementConstraint, index(arrResidual, idxResidual), captures) };
}

/**
 * Extract refinement info from a comptime(assert(var, type)) pattern.
 * Returns the variable name and target constraint if the pattern matches.
 */
function extractComptimeAssertRefinement(
  expr: Expr,
  env: SEnv,
  ctx: RefinementContext
): { varName: string; constraint: Constraint } | null {
  // Pattern: comptime(assert(var, type))
  if (expr.tag !== "comptime") return null;

  const inner = expr.expr;
  if (inner.tag !== "assert") return null;

  // Get the variable name from the assert expression
  const valueExpr = inner.expr;
  if (valueExpr.tag !== "var") return null;
  const varName = valueExpr.name;

  // Evaluate the constraint expression to get the type
  const constraintExpr = inner.constraint;
  const constraintResult = stagingEvaluate(constraintExpr, env, ctx).svalue;

  if (!isNow(constraintResult)) return null;
  if (constraintResult.value.tag !== "type") return null;

  return { varName, constraint: constraintResult.value.constraint };
}

function evalBlock(
  exprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  if (exprs.length === 0) {
    return { svalue: now(nullVal, isNull) };
  }

  const results: SValue[] = [];
  let currentCtx = ctx;

  for (const expr of exprs) {
    // Check for comptime(assert(var, type)) pattern and extract refinement
    // This must be done BEFORE evaluating so the refinement flows to subsequent expressions
    const refinement = extractComptimeAssertRefinement(expr, env, currentCtx);
    if (refinement) {
      // Add refinement to context for this and subsequent expressions
      currentCtx = currentCtx.refine(refinement.varName, refinement.constraint);
    }

    results.push(stagingEvaluate(expr, env, currentCtx).svalue);
  }

  const lastResult = results[results.length - 1];

  // If all Now, just return last value
  if (results.every(isNow)) {
    return { svalue: lastResult };
  }

  // Build block residual from all expressions to preserve side effects
  // Filter out Now(null) values from comptime assertions - they disappear
  const filteredResults = results.filter((r, i) => {
    // Keep the last result always
    if (i === results.length - 1) return true;
    // Filter out comptime(assert(...)) results - they are Now(null) and disappear
    if (isNow(r) && r.value.tag === "null" && exprs[i].tag === "comptime") {
      return false;
    }
    return true;
  });

  if (filteredResults.length === 1) {
    return { svalue: filteredResults[0] };
  }

  const residuals = filteredResults.map(svalueToResidual);
  const captures = mergeCaptures(filteredResults);
  return { svalue: later(lastResult.constraint, block(...residuals), captures) };
}

function evalComptime(
  expr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  // Enter comptime mode - this affects how assert() behaves
  const comptimeCtx = ctx.enterComptime();
  const result = stagingEvaluate(expr, env, comptimeCtx).svalue;

  if (isLater(result) || isLaterArray(result)) {
    // Extract variable names from the Later residual - these are the params
    // that need to be Now for comptime to succeed
    const residual = isLater(result) ? result.residual : svalueToResidual(result);
    const laterVars = freeVars(residual);

    throw new ComptimeRequiresNowError(
      `comptime expression evaluated to runtime value. ` +
      `Expression: ${exprToString(expr)}, ` +
      `Constraint: ${constraintToString(result.constraint)}`,
      laterVars
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

  // If the expression evaluated to a TypeValue (e.g., runtime(string)),
  // use the inner constraint, not the Type wrapper
  let constraint = result.constraint;
  if (isNow(result) && result.value.tag === "type") {
    constraint = result.value.constraint;
  }

  // Return a Later with runtime origin - no captures (this IS the origin)
  return { svalue: laterRuntime(varName, constraint) };
}

/**
 * Staged assertion - inserts runtime check if value is Later.
 * If value and constraint are both Now, checks immediately.
 *
 * In comptime mode (inside comptime(...)):
 * - With Later value: refines constraint, returns Now(null), no runtime code
 * - The refinement is a compile-time side effect that affects subsequent expressions
 *
 * Outside comptime mode:
 * - With Later value: refines constraint AND generates runtime assertion code
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

  if (isLater(constraintResult) || isLaterArray(constraintResult) || isStagedClosure(constraintResult)) {
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

  // Value is Later/LaterArray
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);

  // In comptime mode: refine type without generating runtime code
  // The assertion "succeeds" at compile time (type is refined), returns null
  if (ctx.inComptime) {
    // Return Now(null) - the comptime assertion succeeded
    // The refinement will be captured and propagated by evalBlock
    return { svalue: now(nullVal, isNull) };
  }

  // Outside comptime: generate residual assertion
  // The residual will be: assert(value, type, message)
  const residualAssert = assertExpr(svalueToResidual(valueResult), constraintExpr, message);

  const captures = mergeCaptures([valueResult]);
  return { svalue: later(refinedConstraint, residualAssert, captures) };
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
  const captures = mergeCaptures([condResult]);
  return { svalue: later(isBool, residualAssert, captures) };
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

  if (isLater(constraintResult) || isLaterArray(constraintResult) || isStagedClosure(constraintResult)) {
    throw new StagingError("trust requires a compile-time known type constraint");
  }

  // Extract constraint from result - handles TypeValue, array (tuple), and object (__arrayOf)
  const targetConstraint = extractConstraintFromValue(constraintResult.value);

  // Refine the constraint based on trust (no runtime check)
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);

  if (isNow(valueResult)) {
    return { svalue: now(valueResult.value, refinedConstraint) };
  }

  // Value is Later/LaterArray/StagedClosure - trust is purely a type-level operation, no residual
  // The trust "disappears" and just affects the constraint
  if (isLaterArray(valueResult)) {
    // Preserve LaterArray structure with refined constraint
    return { svalue: laterArray(valueResult.elements, refinedConstraint) };
  }
  if (isStagedClosure(valueResult)) {
    // Preserve StagedClosure with refined constraint
    return { svalue: stagedClosure(valueResult.body, valueResult.params, valueResult.env, refinedConstraint, valueResult.name, valueResult.siblings) };
  }
  return { svalue: later(refinedConstraint, valueResult.residual, valueResult.captures) };
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
        svalue: laterImport(name, modulePath, isFunction)
      });

      // Create synthetic closure with type-preserving body
      const syntheticBody = buildSyntheticBody(sig, implName, sig.paramTypes.length);
      const extractedParams = extractParamsFromBody(syntheticBody);

      // Bind the name to a StagedClosure
      newEnv = newEnv.set(name, {
        svalue: stagedClosure(syntheticBody, extractedParams, newEnv, isFunction)
      });
    } else {
      // Non-generic imports: keep as Later binding with import origin
      newEnv = newEnv.set(name, { svalue: laterImport(name, modulePath, constraint) });
    }
  }

  // Evaluate the body with imports in scope
  const bodyResult = stagingEvaluate(bodyExpr, newEnv, ctx).svalue;

  // If body is Now (doesn't use any imported values), return it directly
  if (isNow(bodyResult)) {
    return { svalue: bodyResult };
  }

  // If body is a StagedClosure, return it directly
  if (isStagedClosure(bodyResult)) {
    return { svalue: bodyResult };
  }

  // Check if any imported names are actually used in the body
  const anyImportUsed = names.some(name => usesVar(bodyExpr, name));

  // If imports are used, wrap in residual import expression
  if (anyImportUsed) {
    // Collect captures from body for the wrapper Later
    // Use mergeCaptures to include the bodyResult itself if it has import origin
    const captures = mergeCaptures([bodyResult]);
    return {
      svalue: later(
        bodyResult.constraint,
        importExpr(names, modulePath, svalueToResidual(bodyResult)),
        captures
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
export function freeVars(expr: Expr, bound: Set<string> = new Set()): Set<string> {
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
 * Convert a StagedClosure to a residual function expression.
 * This stages the body with parameters bound as Later values.
 */
function stagedClosureToResidual(sc: StagedClosure): Expr {
  // Extract parameter names from the desugared body pattern
  // Body structure: let [param1, param2, ...] = args in actualBody
  const { paramNames, innerBody } = extractParamsFromBodyInternal(sc.body);

  // Create an environment with parameters as Later values
  let bodyEnv = sc.env;

  // TYPE ERASURE: Mark Now(TypeValue) bindings with a special residual.
  // These bindings remain available for comptime operations (which look up
  // the value directly), but if staging tries to residualize them, the
  // error from valueToExpr will be triggered with a clear message.
  // This enables generic functions like fn(T) => fn(x) => { comptime(assert(x, T)); x }
  for (const [name, binding] of bodyEnv.entries()) {
    const sv = binding.svalue;
    if (isNow(sv) && sv.value.tag === "type" && !sv.residual) {
      // Keep the type value for comptime lookups, but mark it
      // so any attempt to residualize produces a clear error
      bodyEnv = bodyEnv.set(name, {
        svalue: now(sv.value, sv.constraint, varRef(`__erased_type_${name}__`))
      });
    }
  }

  // Add self-reference for recursive functions
  if (sc.name) {
    bodyEnv = bodyEnv.set(sc.name, { svalue: sc });
  }

  // Create Later bindings for each parameter
  const paramSValues: SValue[] = [];
  for (const paramName of paramNames) {
    const paramSValue = laterRuntime(paramName, anyC);
    paramSValues.push(paramSValue);
    bodyEnv = bodyEnv.set(paramName, { svalue: paramSValue });
  }

  // Also bind args array as Later
  bodyEnv = bodyEnv.set("args", { svalue: createArraySValue(paramSValues) });

  // Find free variables in the inner body that aren't bound in the environment
  // These are external references (globals, imports, etc.) - treat as Later
  const boundVars = new Set<string>(["args", ...paramNames]);
  if (sc.name) boundVars.add(sc.name);
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

  // For recursive functions, set up cycle detection during body staging
  // This prevents infinite recursion when the body calls itself
  if (sc.name) {
    inProgressRecursiveCalls.set(sc.name, anyC);
  }

  try {
    // Stage the inner body (after parameter destructuring)
    const bodyResult = stagingEvaluate(innerBody, bodyEnv, RefinementContext.empty()).svalue;

    // Build the residual function
    const residualBody = svalueToResidual(bodyResult);

    if (sc.name) {
      return { tag: "recfn", name: sc.name, params: paramNames, body: residualBody };
    }
    return { tag: "fn", params: paramNames, body: residualBody };
  } finally {
    if (sc.name) {
      inProgressRecursiveCalls.delete(sc.name);
    }
  }
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
 * For StagedClosure, converts to a function expression.
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
  if (isStagedClosure(sv)) {
    // If closure has a residual (e.g., was bound to a name), use it
    if (sv.residual) {
      return sv.residual;
    }
    // Defer staging to codegen - enables specialization at call sites
    return { tag: "deferredClosure", closure: sv };
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
      // Types are compile-time only and cannot appear in generated JavaScript.
      // If this error is reached, a type value is being used at runtime
      // (e.g., returned from a function, used in a non-comptime context).
      throw new StagingError(
        `Type "${constraintToString(v.constraint)}" cannot be used at runtime. ` +
        `Types are compile-time only and are erased from generated code. ` +
        `Use comptime(assert(x, T)) for type refinement without runtime code.`
      );
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
    case "deferredClosure":
      // Check if variable is used in the closure body
      // The closure may also capture the variable from its environment
      return usesVar(expr.closure.body, name);
    case "specializedCall":
      // Check if the closure is the variable we're looking for (by name)
      // Also check args and body
      if (expr.closure.name === name) return true;
      return expr.args.some(a => usesVar(a, name)) || usesVar(expr.body, name);
  }
}

/**
 * Check if an expression contains specializedCall nodes that reference a specific closure.
 * Uses object identity to match closures (for two-pass specialization).
 */
function usesClosureByIdentity(expr: Expr, closure: StagedClosure): boolean {
  switch (expr.tag) {
    case "specializedCall":
      // Check if this specializedCall references our closure
      if (expr.closure === closure) return true;
      // Also check args and body
      return expr.args.some(a => usesClosureByIdentity(a, closure)) || usesClosureByIdentity(expr.body, closure);
    case "lit":
    case "var":
    case "runtime":
      return false;
    case "binop":
      return usesClosureByIdentity(expr.left, closure) || usesClosureByIdentity(expr.right, closure);
    case "unary":
      return usesClosureByIdentity(expr.operand, closure);
    case "if":
      return usesClosureByIdentity(expr.cond, closure) || usesClosureByIdentity(expr.then, closure) || usesClosureByIdentity(expr.else, closure);
    case "let":
      return usesClosureByIdentity(expr.value, closure) || usesClosureByIdentity(expr.body, closure);
    case "letPattern":
      return usesClosureByIdentity(expr.value, closure) || usesClosureByIdentity(expr.body, closure);
    case "fn":
      return usesClosureByIdentity(expr.body, closure);
    case "recfn":
      return usesClosureByIdentity(expr.body, closure);
    case "call":
      return usesClosureByIdentity(expr.func, closure) || expr.args.some(a => usesClosureByIdentity(a, closure));
    case "obj":
      return expr.fields.some(f => usesClosureByIdentity(f.value, closure));
    case "field":
      return usesClosureByIdentity(expr.object, closure);
    case "array":
      return expr.elements.some(e => usesClosureByIdentity(e, closure));
    case "index":
      return usesClosureByIdentity(expr.array, closure) || usesClosureByIdentity(expr.index, closure);
    case "block":
      return expr.exprs.some(e => usesClosureByIdentity(e, closure));
    case "comptime":
      return usesClosureByIdentity(expr.expr, closure);
    case "assert":
      return usesClosureByIdentity(expr.expr, closure) || usesClosureByIdentity(expr.constraint, closure);
    case "assertCond":
      return usesClosureByIdentity(expr.condition, closure);
    case "trust":
      return usesClosureByIdentity(expr.expr, closure) || (expr.constraint ? usesClosureByIdentity(expr.constraint, closure) : false);
    case "methodCall":
      return usesClosureByIdentity(expr.receiver, closure) || expr.args.some(a => usesClosureByIdentity(a, closure));
    case "import":
      return usesClosureByIdentity(expr.body, closure);
    case "typeOf":
      return usesClosureByIdentity(expr.expr, closure);
    case "deferredClosure":
      return expr.closure === closure || usesClosureByIdentity(expr.closure.body, closure);
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

/**
 * Extract length constraint from an array or string constraint.
 * Returns isNumber if no length constraint is found.
 */
function extractLengthConstraint(constraint: Constraint): Constraint {
  if (constraint.tag === "length") {
    return constraint.constraint;
  }
  if (constraint.tag === "and") {
    for (const c of constraint.constraints) {
      if (c.tag === "length") {
        return c.constraint;
      }
    }
  }
  return isNumber;
}

/**
 * Extract a known equals value from a constraint.
 * Returns the value if the constraint is equals(v) or and(isNumber, equals(v)), else null.
 */
function extractEqualsValue(constraint: Constraint): unknown {
  if (constraint.tag === "equals") {
    return constraint.value;
  }
  if (constraint.tag === "and") {
    for (const c of constraint.constraints) {
      if (c.tag === "equals") {
        return c.value;
      }
    }
  }
  return null;
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
 * Convert a StagedClosure to a ClosureValue for use in run() results.
 * Requires all captured bindings to be Now values.
 */
function stagedClosureToValue(sc: StagedClosure): Value {
  // Convert SEnv to Env by extracting Now values
  let env = new Env();
  for (const [name, binding] of sc.env.entries()) {
    if (isNow(binding.svalue)) {
      env = env.set(name, { value: binding.svalue.value, constraint: binding.svalue.constraint });
    } else if (isStagedClosure(binding.svalue)) {
      // Recursively convert nested closures
      env = env.set(name, { value: stagedClosureToValue(binding.svalue), constraint: binding.svalue.constraint });
    } else {
      throw new Error(`StagedClosure has runtime dependency in captured variable '${name}' - use stage() for partial evaluation`);
    }
  }
  return closureVal(sc.body, env, sc.name);
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

  if (isNow(result.svalue)) {
    return { value: result.svalue.value, constraint: result.svalue.constraint };
  }

  if (isStagedClosure(result.svalue)) {
    // Convert StagedClosure to ClosureValue
    return { value: stagedClosureToValue(result.svalue), constraint: result.svalue.constraint };
  }

  throw new Error("Expression has runtime dependencies - use stage() for partial evaluation");
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
 * Convert a StagedClosure to a residual function expression.
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
export function closureToResidual(closure: StagedClosure): Expr {
  return stagedClosureToResidual(closure);
}
