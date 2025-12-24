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

import { Expr, BinOp, UnaryOp, varRef, binop, unary, ifExpr, letExpr, call, obj, field, array, index, block, lit, fn, recfn, assertExpr, assertCondExpr, trustExpr, methodCall } from "./expr";
import { lookupMethod } from "./methods";
import { Value, numberVal, stringVal, boolVal, nullVal, objectVal, arrayVal, closureVal, constraintOf, valueToString, typeVal, valueSatisfies, builtinVal } from "./value";
import { getBuiltin, getAllBuiltins, BuiltinDef, StagedBuiltinContext } from "./builtin-registry";
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, hasField, elements, length, elementAt, implies, simplify, or, narrowOr, isType, isTypeC, extractAllFieldNames, extractFieldConstraint as extractFieldConstraintFromConstraint, unify, fnType, instantiate, equals, rec, recVar, constraintToString } from "./constraint";
import { inferFunction, InferredFunction } from "./inference";
import { Env, Binding, RefinementContext } from "./env";
import { getBinaryOp, getUnaryOp, requireConstraint, TypeError, stringConcat, AssertionError, EvalResult } from "./builtins";
import { extractAllRefinements, negateRefinement } from "./refinement";
import { SValue, Now, Later, now, later, isNow, isLater, allNow, constraintOfSV } from "./svalue";

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
  params: string[];
  body: Expr;
  env: SEnv;
  name?: string;  // Optional name for recursive self-reference
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
      return { svalue: now(sv.value, refined) };
    } else {
      return { svalue: later(refined, sv.residual) };
    }
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
  const builtin = getBinaryOp(op);

  // Still check constraints for type safety
  requireConstraint(left.constraint, builtin.params[0], `left of ${op}`);
  requireConstraint(right.constraint, builtin.params[1], `right of ${op}`);

  const resultConstraint = builtin.result([left.constraint, right.constraint]);
  const leftResidual = isNow(left) ? valueToExpr(left.value) : left.residual;
  const rightResidual = isNow(right) ? valueToExpr(right.value) : right.residual;

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

  // Later - generate residual
  const builtin = getUnaryOp(op);
  requireConstraint(operand.constraint, builtin.params[0], `operand of ${op}`);

  const resultConstraint = builtin.result([operand.constraint]);
  return { svalue: later(resultConstraint, unary(op, operand.residual)) };
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

  const thenResidual = isNow(thenResult) ? valueToExpr(thenResult.value) : thenResult.residual;
  const elseResidual = isNow(elseResult) ? valueToExpr(elseResult.value) : elseResult.residual;

  return { svalue: later(resultConstraint, ifExpr(cond.residual, thenResidual, elseResidual)) };
}

function evalLet(
  name: string,
  valueExpr: Expr,
  bodyExpr: Expr,
  env: SEnv,
  ctx: RefinementContext
): SEvalResult {
  const valueResult = stagingEvaluate(valueExpr, env, ctx).svalue;

  const newEnv = env.set(name, { svalue: valueResult });

  const bodyResult = stagingEvaluate(bodyExpr, newEnv, ctx).svalue;

  // If the body is Now, return it directly even if the bound value was Later.
  // This handles cases like typeOf() which extract compile-time type info from Later values.
  if (isNow(bodyResult)) {
    return { svalue: bodyResult };
  }

  // If value was Later and body uses it, we need residual let
  if (isLater(valueResult) && usesVar(bodyExpr, name)) {
    return {
      svalue: later(
        bodyResult.constraint,
        letExpr(name, valueResult.residual, bodyResult.residual)
      )
    };
  }

  return { svalue: bodyResult };
}

// Cache for inferred types in staged evaluation
const stagedInferredTypes = new WeakMap<Value, InferredFunction>();

function evalFn(params: string[], body: Expr, env: SEnv): SEvalResult {
  // Functions are always Now (the closure itself is known)
  // But they may contain Later values when called
  // We represent closures as Now values with fnType constraint
  // The actual staged behavior happens at call time

  // For staged evaluation, we need to track that this is a staged closure
  // For now, we'll use a special representation
  const closure = closureVal(params, body, Env.empty()); // Placeholder env

  // Infer constraints from body
  // Convert staged env to regular env for inference (use Now values, any for Later)
  const regularEnv = stagedEnvToEnv(env);
  const inferred = inferFunction(params, body, regularEnv);
  stagedInferredTypes.set(closure, inferred);

  // Store the staged env in a side channel (simplified approach)
  stagedClosures.set(closure, { params, body, env });

  // Return function with proper fnType constraint
  const fnConstraint = fnType(inferred.paramConstraints, inferred.resultConstraint);
  return { svalue: now(closure, fnConstraint) };
}

/**
 * Evaluate a named recursive function in staged context.
 * The function can call itself by name within its body.
 */
function evalRecFn(name: string, params: string[], body: Expr, env: SEnv): SEvalResult {
  // Create a closure with the name for self-reference
  const closure = closureVal(params, body, Env.empty(), name); // Placeholder env

  // For type inference, create env with function bound to itself
  const regularEnv = stagedEnvToEnv(env);
  const selfEnv = regularEnv.set(name, {
    value: closure,
    constraint: isFunction,  // Placeholder - will be refined
  });

  // Infer constraints from body with self-reference available
  const inferred = inferFunction(params, body, selfEnv);
  stagedInferredTypes.set(closure, inferred);

  // Store the staged env in a side channel (with self-binding)
  const fnConstraint = fnType(inferred.paramConstraints, inferred.resultConstraint);
  const selfSEnv = env.set(name, { svalue: now(closure, fnConstraint) });
  stagedClosures.set(closure, { params, body, env: selfSEnv, name });

  return { svalue: now(closure, fnConstraint) };
}

/**
 * Convert a staged environment to a regular environment for inference.
 * Now values keep their value and constraint, Later values use placeholder with constraint.
 */
function stagedEnvToEnv(senv: SEnv): Env {
  let env = Env.empty();
  for (const [name, binding] of senv.entries()) {
    const sv = binding.svalue;
    if (isNow(sv)) {
      env = env.set(name, { value: sv.value, constraint: sv.constraint });
    } else {
      // Later - use placeholder value with the constraint
      env = env.set(name, { value: nullVal, constraint: sv.constraint });
    }
  }
  return env;
}

// Side channel for staged closures (maps closure value to staged closure info)
const stagedClosures = new WeakMap<Value, SClosure>();

// Coinductive cycle detection: tracks recursive functions currently being evaluated
// Maps function name to the assumed result constraint (from type inference)
const inProgressRecursiveCalls = new Map<string, Constraint>();

// ============================================================================
// Reflection Builtins (with comptime enforcement)
// ============================================================================

/**
 * Try to handle a reflection builtin call.
 * Returns null if the call is not a reflection builtin.
 * Throws StagingError if arguments are not compile-time known.
 */
function tryStagedReflectionBuiltin(
  funcExpr: Expr,
  argExprs: Expr[],
  env: SEnv,
  ctx: RefinementContext
): SEvalResult | null {
  if (funcExpr.tag !== "var") return null;

  if (funcExpr.name === "typeOf") {
    // typeOf(value) - returns the compile-time known type/constraint of a value
    // Works even if the value itself is Later, because constraints are tracked at compile time
    if (argExprs.length !== 1) {
      throw new Error("typeOf() requires exactly 1 argument");
    }

    const arg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const constraint = constraintOfSV(arg);

    // Return the constraint as a TypeValue - always Now since constraints are compile-time
    return {
      svalue: now(typeVal(constraint), isType(constraint))
    };
  }

  if (funcExpr.name === "fields") {
    // fields(T) - returns array of field names from a type
    if (argExprs.length !== 1) {
      throw new Error("fields() requires exactly 1 argument");
    }

    const typeArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    // Comptime enforcement: type must be known at compile time
    if (isLater(typeArg)) {
      throw new StagingError("fields() requires a compile-time known type");
    }

    if (typeArg.value.tag !== "type") {
      throw new TypeError(isTypeC, typeArg.constraint, "fields() argument");
    }

    const fieldNames = extractAllFieldNames(typeArg.value.constraint);
    const fieldValues = fieldNames.map(stringVal);

    return {
      svalue: now(arrayVal(fieldValues), and(isArray, elements(isString)))
    };
  }

  if (funcExpr.name === "print") {
    // print(value) - prints value to stdout, returns null
    if (argExprs.length !== 1) {
      throw new Error("print() requires exactly 1 argument");
    }

    const arg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isNow(arg)) {
      // Value known at compile time - print now
      console.log(valueToString(arg.value));
      return { svalue: now(nullVal, isNull) };
    } else {
      // Value not known - generate residual print call
      // later(constraint, residual) - print returns null
      return {
        svalue: later(isNull, call(varRef("print"), arg.residual))
      };
    }
  }

  // ============================================================================
  // String Operations
  // ============================================================================

  if (funcExpr.name === "startsWith") {
    // startsWith(str, prefix) - check if string starts with prefix
    if (argExprs.length !== 2) {
      throw new Error("startsWith() requires exactly 2 arguments (str, prefix)");
    }

    const strArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const prefixArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    // Both Later -> runtime
    if (isLater(strArg) || isLater(prefixArg)) {
      const strResidual = isNow(strArg) ? valueToExpr(strArg.value) : strArg.residual;
      const prefixResidual = isNow(prefixArg) ? valueToExpr(prefixArg.value) : prefixArg.residual;
      return {
        svalue: later(isBool, call(varRef("startsWith"), strResidual, prefixResidual))
      };
    }

    if (strArg.value.tag !== "string") {
      throw new TypeError(isString, strArg.constraint, "startsWith() first argument");
    }
    if (prefixArg.value.tag !== "string") {
      throw new TypeError(isString, prefixArg.constraint, "startsWith() second argument");
    }

    const result = strArg.value.value.startsWith(prefixArg.value.value);
    return { svalue: now(boolVal(result), and(isBool, equals(result))) };
  }

  if (funcExpr.name === "endsWith") {
    // endsWith(str, suffix) - check if string ends with suffix
    if (argExprs.length !== 2) {
      throw new Error("endsWith() requires exactly 2 arguments (str, suffix)");
    }

    const strArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const suffixArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    if (isLater(strArg) || isLater(suffixArg)) {
      const strResidual = isNow(strArg) ? valueToExpr(strArg.value) : strArg.residual;
      const suffixResidual = isNow(suffixArg) ? valueToExpr(suffixArg.value) : suffixArg.residual;
      return {
        svalue: later(isBool, call(varRef("endsWith"), strResidual, suffixResidual))
      };
    }

    if (strArg.value.tag !== "string") {
      throw new TypeError(isString, strArg.constraint, "endsWith() first argument");
    }
    if (suffixArg.value.tag !== "string") {
      throw new TypeError(isString, suffixArg.constraint, "endsWith() second argument");
    }

    const result = strArg.value.value.endsWith(suffixArg.value.value);
    return { svalue: now(boolVal(result), and(isBool, equals(result))) };
  }

  if (funcExpr.name === "contains") {
    // contains(str, substr) - check if string contains substring
    if (argExprs.length !== 2) {
      throw new Error("contains() requires exactly 2 arguments (str, substr)");
    }

    const strArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const substrArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    if (isLater(strArg) || isLater(substrArg)) {
      const strResidual = isNow(strArg) ? valueToExpr(strArg.value) : strArg.residual;
      const substrResidual = isNow(substrArg) ? valueToExpr(substrArg.value) : substrArg.residual;
      return {
        svalue: later(isBool, call(varRef("contains"), strResidual, substrResidual))
      };
    }

    if (strArg.value.tag !== "string") {
      throw new TypeError(isString, strArg.constraint, "contains() first argument");
    }
    if (substrArg.value.tag !== "string") {
      throw new TypeError(isString, substrArg.constraint, "contains() second argument");
    }

    const result = strArg.value.value.includes(substrArg.value.value);
    return { svalue: now(boolVal(result), and(isBool, equals(result))) };
  }

  if (funcExpr.name === "fieldType") {
    // fieldType(T, name) - returns the type of a field
    if (argExprs.length !== 2) {
      throw new Error("fieldType() requires exactly 2 arguments");
    }

    const typeArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const nameArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    // Comptime enforcement: both args must be known at compile time
    if (isLater(typeArg)) {
      throw new StagingError("fieldType() requires a compile-time known type");
    }
    if (isLater(nameArg)) {
      throw new StagingError("fieldType() requires a compile-time known field name");
    }

    if (typeArg.value.tag !== "type") {
      throw new TypeError(isTypeC, typeArg.constraint, "fieldType() first argument");
    }

    if (nameArg.value.tag !== "string") {
      throw new TypeError(isString, nameArg.constraint, "fieldType() second argument");
    }

    const fieldConstraint = extractFieldConstraintFromConstraint(
      typeArg.value.constraint,
      nameArg.value.value
    );

    if (!fieldConstraint) {
      throw new Error(`Type has no field '${nameArg.value.value}'`);
    }

    return {
      svalue: now(typeVal(fieldConstraint), isType(fieldConstraint))
    };
  }

  if (funcExpr.name === "comptimeFold") {
    // comptimeFold(array, init, fn) - compile-time fold over array
    // array must be compile-time known, fn is called at compile time for each element
    if (argExprs.length !== 3) {
      throw new Error("comptimeFold() requires exactly 3 arguments (array, init, fn)");
    }

    const arrArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const initArg = stagingEvaluate(argExprs[1], env, ctx).svalue;
    const fnArg = stagingEvaluate(argExprs[2], env, ctx).svalue;

    // Array must be compile-time known
    if (isLater(arrArg)) {
      throw new StagingError("comptimeFold() requires a compile-time known array");
    }

    if (arrArg.value.tag !== "array") {
      throw new TypeError(isArray, arrArg.constraint, "comptimeFold() first argument");
    }

    // Function must be compile-time known closure
    if (isLater(fnArg)) {
      throw new StagingError("comptimeFold() requires a compile-time known function");
    }

    if (fnArg.value.tag !== "closure") {
      throw new TypeError(isFunction, fnArg.constraint, "comptimeFold() third argument");
    }

    const arr = arrArg.value;
    const fn = fnArg.value;

    // Verify function has 2 parameters (acc, elem)
    if (fn.params.length !== 2) {
      throw new Error("comptimeFold() function must have exactly 2 parameters (acc, elem)");
    }

    // Get the staged closure info
    const sclosure = stagedClosures.get(fn);
    if (!sclosure) {
      throw new Error("comptimeFold() function closure not properly staged");
    }

    // Iterate and fold
    let acc: SValue = initArg;

    for (const elem of arr.elements) {
      // Create environment with acc and elem bound
      let callEnv = sclosure.env;

      // Bind acc (may be Now or Later)
      callEnv = callEnv.set(fn.params[0], { svalue: acc });

      // Bind elem (always Now since array is compile-time known)
      const elemSValue = now(elem, constraintOf(elem));
      callEnv = callEnv.set(fn.params[1], { svalue: elemSValue });

      // Evaluate function body
      const result = stagingEvaluate(fn.body, callEnv, RefinementContext.empty());
      acc = result.svalue;
    }

    return { svalue: acc };
  }

  if (funcExpr.name === "objectFromEntries") {
    // objectFromEntries(entries) - build object from [[key, value], ...] array
    // Keys must be compile-time known strings, values can be Now or Later
    if (argExprs.length !== 1) {
      throw new Error("objectFromEntries() requires exactly 1 argument");
    }

    const entriesArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    // Entries array must be compile-time known
    if (isLater(entriesArg)) {
      throw new StagingError("objectFromEntries() requires a compile-time known entries array");
    }

    if (entriesArg.value.tag !== "array") {
      throw new TypeError(isArray, entriesArg.constraint, "objectFromEntries() argument");
    }

    const entries = entriesArg.value.elements;
    const fieldConstraints: Constraint[] = [isObject];
    const fields: Map<string, Value> = new Map();
    const residualFields: { name: string; value: Expr }[] = [];
    let hasLater = false;

    for (const entry of entries) {
      // Each entry should be a [key, value] tuple (array of 2 elements)
      if (entry.tag !== "array" || entry.elements.length !== 2) {
        throw new Error("objectFromEntries() entries must be [key, value] pairs");
      }

      const keyVal = entry.elements[0];
      const valueVal = entry.elements[1];

      // Key must be a string
      if (keyVal.tag !== "string") {
        throw new Error("objectFromEntries() keys must be strings");
      }

      const key = keyVal.value;

      // Value can be a regular Value or an SValue stored in the array
      // For our purposes, we need to check if it's a Later value
      // Since the entries array is Now, all values inside are also Values
      // But during comptimeFold, we might have accumulated Later values

      // Check if this is a special wrapper for SValue
      if (valueVal.tag === "object" && valueVal.fields.has("__svalue__")) {
        // This is a wrapped SValue from comptimeFold
        const svalueMarker = valueVal.fields.get("__svalue__")!;
        if (svalueMarker.tag === "string" && svalueMarker.value === "later") {
          hasLater = true;
          const residualField = valueVal.fields.get("residual");
          // We'll need to reconstruct the residual - for now just mark as later
          fieldConstraints.push(hasField(key, { tag: "any" }));
          residualFields.push({ name: key, value: varRef(key) }); // placeholder
        } else {
          const actualValue = valueVal.fields.get("value")!;
          fields.set(key, actualValue);
          fieldConstraints.push(hasField(key, constraintOf(actualValue)));
        }
      } else {
        // Regular value
        fields.set(key, valueVal);
        fieldConstraints.push(hasField(key, constraintOf(valueVal)));
      }
    }

    const constraint = and(...fieldConstraints);

    if (hasLater) {
      // Generate residual object expression
      const objFields = residualFields.map(f => ({ name: f.name, value: f.value }));
      return { svalue: later(constraint, { tag: "obj" as const, fields: objFields }) };
    } else {
      // Fully evaluated at compile time
      return { svalue: now(objectVal(Object.fromEntries(fields)), constraint) };
    }
  }

  if (funcExpr.name === "dynamicField") {
    // dynamicField(obj, fieldName) - access field with compile-time known name
    // fieldName must be Now, obj can be Now or Later
    if (argExprs.length !== 2) {
      throw new Error("dynamicField() requires exactly 2 arguments");
    }

    const objArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const nameArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    // Field name must be compile-time known
    if (isLater(nameArg)) {
      throw new StagingError("dynamicField() requires a compile-time known field name");
    }

    if (nameArg.value.tag !== "string") {
      throw new TypeError(isString, nameArg.constraint, "dynamicField() second argument");
    }

    const fieldName = nameArg.value.value;

    if (isNow(objArg)) {
      // Object is known - extract field directly
      if (objArg.value.tag !== "object") {
        throw new TypeError(isObject, objArg.constraint, "dynamicField() first argument");
      }

      const fieldValue = objArg.value.fields.get(fieldName);
      if (fieldValue === undefined) {
        throw new Error(`Object has no field '${fieldName}'`);
      }

      return { svalue: now(fieldValue, constraintOf(fieldValue)) };
    } else {
      // Object is Later - generate residual field access
      const fieldConstraint = extractFieldConstraintFromConstraint(objArg.constraint, fieldName) || { tag: "any" as const };
      return {
        svalue: later(fieldConstraint, { tag: "field" as const, object: objArg.residual, name: fieldName })
      };
    }
  }

  if (funcExpr.name === "append") {
    // append(array, elem) - immutable array append
    if (argExprs.length !== 2) {
      throw new Error("append() requires exactly 2 arguments");
    }

    const arrArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const elemArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    // Both must be Now for compile-time array building
    if (isLater(arrArg)) {
      throw new StagingError("append() requires a compile-time known array");
    }

    if (arrArg.value.tag !== "array") {
      throw new TypeError(isArray, arrArg.constraint, "append() first argument");
    }

    // Create new array with element appended
    const newElements = [...arrArg.value.elements];

    if (isNow(elemArg)) {
      newElements.push(elemArg.value);
    } else {
      // If element is Later, we need to handle this differently
      // For now, require compile-time known elements
      throw new StagingError("append() requires a compile-time known element");
    }

    // Compute the result constraint
    const elemConstraint = elemArg.constraint;
    const resultConstraint = and(isArray, elements(elemConstraint));

    return {
      svalue: now(arrayVal(newElements), resultConstraint)
    };
  }

  if (funcExpr.name === "map") {
    // map(fn, array) - transform each element
    // Comptime if both are known, runtime otherwise
    if (argExprs.length !== 2) {
      throw new Error("map() requires exactly 2 arguments (fn, array)");
    }

    const fnArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const arrArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    // If array is Later, generate runtime code
    if (isLater(arrArg)) {
      // Generate residual: arr.map(fn)
      const fnResidual = isNow(fnArg) ? valueToExpr(fnArg.value) : fnArg.residual;
      const resultConstraint = and(isArray, elements({ tag: "any" }));
      return {
        svalue: later(resultConstraint, call(varRef("map"), fnResidual, arrArg.residual))
      };
    }

    if (arrArg.value.tag !== "array") {
      throw new TypeError(isArray, arrArg.constraint, "map() second argument");
    }

    // Function must be Now for compile-time mapping
    if (isLater(fnArg)) {
      // Array is known but function is not - generate runtime code
      const arrResidual = valueToExpr(arrArg.value);
      const resultConstraint = and(isArray, elements({ tag: "any" }));
      return {
        svalue: later(resultConstraint, call(varRef("map"), fnArg.residual, arrResidual))
      };
    }

    if (fnArg.value.tag !== "closure") {
      throw new TypeError(isFunction, fnArg.constraint, "map() first argument");
    }

    const fn = fnArg.value;
    if (fn.params.length !== 1) {
      throw new Error("map() function must have exactly 1 parameter");
    }

    const sclosure = stagedClosures.get(fn);
    if (!sclosure) {
      throw new Error("map() function closure not properly staged");
    }

    // Map over array at compile time
    const resultElements: Value[] = [];
    let resultElemConstraint: Constraint = { tag: "never" };

    for (const elem of arrArg.value.elements) {
      let callEnv = sclosure.env;
      const elemSValue = now(elem, constraintOf(elem));
      callEnv = callEnv.set(fn.params[0], { svalue: elemSValue });

      const result = stagingEvaluate(fn.body, callEnv, RefinementContext.empty());

      if (isLater(result.svalue)) {
        // If any result is Later, we need to generate runtime code
        const arrResidual = valueToExpr(arrArg.value);
        const fnResidual = valueToExpr(fnArg.value);
        return {
          svalue: later(and(isArray, elements({ tag: "any" })), call(varRef("map"), fnResidual, arrResidual))
        };
      }

      resultElements.push(result.svalue.value);
      resultElemConstraint = resultElemConstraint.tag === "never"
        ? result.svalue.constraint
        : or(resultElemConstraint, result.svalue.constraint);
    }

    const resultConstraint = and(isArray, elements(resultElemConstraint));
    return { svalue: now(arrayVal(resultElements), resultConstraint) };
  }

  if (funcExpr.name === "filter") {
    // filter(fn, array) - keep elements where fn returns true
    // Comptime if both are known, runtime otherwise
    if (argExprs.length !== 2) {
      throw new Error("filter() requires exactly 2 arguments (fn, array)");
    }

    const fnArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const arrArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    // If array is Later, generate runtime code
    if (isLater(arrArg)) {
      const fnResidual = isNow(fnArg) ? valueToExpr(fnArg.value) : fnArg.residual;
      // Filter preserves element type
      const elemConstraint = extractElementsConstraint(arrArg.constraint);
      const resultConstraint = and(isArray, elements(elemConstraint));
      return {
        svalue: later(resultConstraint, call(varRef("filter"), fnResidual, arrArg.residual))
      };
    }

    if (arrArg.value.tag !== "array") {
      throw new TypeError(isArray, arrArg.constraint, "filter() second argument");
    }

    // Function must be Now for compile-time filtering
    if (isLater(fnArg)) {
      const arrResidual = valueToExpr(arrArg.value);
      const elemConstraint = extractElementsConstraint(arrArg.constraint);
      const resultConstraint = and(isArray, elements(elemConstraint));
      return {
        svalue: later(resultConstraint, call(varRef("filter"), fnArg.residual, arrResidual))
      };
    }

    if (fnArg.value.tag !== "closure") {
      throw new TypeError(isFunction, fnArg.constraint, "filter() first argument");
    }

    const fn = fnArg.value;
    if (fn.params.length !== 1) {
      throw new Error("filter() function must have exactly 1 parameter");
    }

    const sclosure = stagedClosures.get(fn);
    if (!sclosure) {
      throw new Error("filter() function closure not properly staged");
    }

    // Filter array at compile time
    const resultElements: Value[] = [];
    let resultElemConstraint: Constraint = { tag: "never" };

    for (const elem of arrArg.value.elements) {
      let callEnv = sclosure.env;
      const elemSValue = now(elem, constraintOf(elem));
      callEnv = callEnv.set(fn.params[0], { svalue: elemSValue });

      const result = stagingEvaluate(fn.body, callEnv, RefinementContext.empty());

      if (isLater(result.svalue)) {
        // If predicate result is Later, generate runtime code
        const arrResidual = valueToExpr(arrArg.value);
        const fnResidual = valueToExpr(fnArg.value);
        const elemConstraint = extractElementsConstraint(arrArg.constraint);
        return {
          svalue: later(and(isArray, elements(elemConstraint)), call(varRef("filter"), fnResidual, arrResidual))
        };
      }

      if (result.svalue.value.tag !== "bool") {
        throw new TypeError(isBool, result.svalue.constraint, "filter() predicate return value");
      }

      if (result.svalue.value.value) {
        resultElements.push(elem);
        const elemC = constraintOf(elem);
        resultElemConstraint = resultElemConstraint.tag === "never"
          ? elemC
          : or(resultElemConstraint, elemC);
      }
    }

    const resultConstraint = resultElemConstraint.tag === "never"
      ? and(isArray, elements({ tag: "any" }))
      : and(isArray, elements(resultElemConstraint));
    return { svalue: now(arrayVal(resultElements), resultConstraint) };
  }

  // ============================================================================
  // Type Constructor Builtins
  // ============================================================================

  if (funcExpr.name === "objectType") {
    // objectType({ field1: Type1, field2: Type2, ... }) - creates an object type
    if (argExprs.length !== 1) {
      throw new Error("objectType() requires exactly 1 argument (an object of field types)");
    }

    const objArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isLater(objArg)) {
      throw new StagingError("objectType() requires a compile-time known object");
    }

    if (objArg.value.tag !== "object") {
      throw new TypeError(isObject, objArg.constraint, "objectType() argument");
    }

    // Build constraint from object fields
    const constraints: Constraint[] = [isObject];
    for (const [fieldName, fieldVal] of objArg.value.fields) {
      if (fieldVal.tag !== "type") {
        throw new Error(`objectType() field '${fieldName}' must be a type, got ${fieldVal.tag}`);
      }
      constraints.push(hasField(fieldName, fieldVal.constraint));
    }

    const resultConstraint = and(...constraints);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "arrayType") {
    // arrayType(ElementType) - creates an array type
    if (argExprs.length !== 1) {
      throw new Error("arrayType() requires exactly 1 argument");
    }

    const elemArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isLater(elemArg)) {
      throw new StagingError("arrayType() requires a compile-time known type");
    }

    if (elemArg.value.tag !== "type") {
      throw new TypeError(isTypeC, elemArg.constraint, "arrayType() argument");
    }

    const resultConstraint = and(isArray, elements(elemArg.value.constraint));
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "unionType") {
    // unionType(Type1, Type2, ...) - creates a union type (or)
    if (argExprs.length < 2) {
      throw new Error("unionType() requires at least 2 arguments");
    }

    const constraints: Constraint[] = [];
    for (let i = 0; i < argExprs.length; i++) {
      const typeArg = stagingEvaluate(argExprs[i], env, ctx).svalue;

      if (isLater(typeArg)) {
        throw new StagingError(`unionType() argument ${i + 1} must be compile-time known`);
      }

      if (typeArg.value.tag !== "type") {
        throw new TypeError(isTypeC, typeArg.constraint, `unionType() argument ${i + 1}`);
      }

      constraints.push(typeArg.value.constraint);
    }

    const resultConstraint = or(...constraints);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "intersectionType") {
    // intersectionType(Type1, Type2, ...) - creates an intersection type (and)
    if (argExprs.length < 2) {
      throw new Error("intersectionType() requires at least 2 arguments");
    }

    const constraints: Constraint[] = [];
    for (let i = 0; i < argExprs.length; i++) {
      const typeArg = stagingEvaluate(argExprs[i], env, ctx).svalue;

      if (isLater(typeArg)) {
        throw new StagingError(`intersectionType() argument ${i + 1} must be compile-time known`);
      }

      if (typeArg.value.tag !== "type") {
        throw new TypeError(isTypeC, typeArg.constraint, `intersectionType() argument ${i + 1}`);
      }

      constraints.push(typeArg.value.constraint);
    }

    const resultConstraint = and(...constraints);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "nullable") {
    // nullable(Type) - creates a union of type with null
    if (argExprs.length !== 1) {
      throw new Error("nullable() requires exactly 1 argument");
    }

    const typeArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isLater(typeArg)) {
      throw new StagingError("nullable() requires a compile-time known type");
    }

    if (typeArg.value.tag !== "type") {
      throw new TypeError(isTypeC, typeArg.constraint, "nullable() argument");
    }

    const resultConstraint = or(typeArg.value.constraint, isNull);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "objectTypeFromEntries") {
    // objectTypeFromEntries([[name1, Type1], [name2, Type2], ...]) - creates object type from entries
    if (argExprs.length !== 1) {
      throw new Error("objectTypeFromEntries() requires exactly 1 argument (array of [name, type] pairs)");
    }

    const entriesArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isLater(entriesArg)) {
      throw new StagingError("objectTypeFromEntries() requires a compile-time known entries array");
    }

    if (entriesArg.value.tag !== "array") {
      throw new TypeError(isArray, entriesArg.constraint, "objectTypeFromEntries() argument");
    }

    const entries = entriesArg.value.elements;
    const constraints: Constraint[] = [isObject];

    for (const entry of entries) {
      // Each entry should be a [name, type] tuple
      if (entry.tag !== "array" || entry.elements.length !== 2) {
        throw new Error("objectTypeFromEntries() entries must be [name, type] pairs");
      }

      const nameVal = entry.elements[0];
      const typeVal = entry.elements[1];

      if (nameVal.tag !== "string") {
        throw new Error("objectTypeFromEntries() field names must be strings");
      }

      if (typeVal.tag !== "type") {
        throw new Error(`objectTypeFromEntries() field '${nameVal.value}' must have a type value, got ${typeVal.tag}`);
      }

      constraints.push(hasField(nameVal.value, typeVal.constraint));
    }

    const resultConstraint = and(...constraints);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "functionType") {
    // functionType(paramTypes, resultType) - creates a function type
    // paramTypes is an array of types
    if (argExprs.length !== 2) {
      throw new Error("functionType() requires exactly 2 arguments (paramTypes array, resultType)");
    }

    const paramsArg = stagingEvaluate(argExprs[0], env, ctx).svalue;
    const resultArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    if (isLater(paramsArg)) {
      throw new StagingError("functionType() requires compile-time known param types");
    }
    if (isLater(resultArg)) {
      throw new StagingError("functionType() requires a compile-time known result type");
    }

    if (paramsArg.value.tag !== "array") {
      throw new TypeError(isArray, paramsArg.constraint, "functionType() first argument");
    }
    if (resultArg.value.tag !== "type") {
      throw new TypeError(isTypeC, resultArg.constraint, "functionType() second argument");
    }

    const paramConstraints: Constraint[] = [];
    for (let i = 0; i < paramsArg.value.elements.length; i++) {
      const param = paramsArg.value.elements[i];
      if (param.tag !== "type") {
        throw new Error(`functionType() param ${i + 1} must be a type`);
      }
      paramConstraints.push(param.constraint);
    }

    const resultConstraint = fnType(paramConstraints, resultArg.value.constraint);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "recType") {
    // recType(varName, bodyType) - creates a recursive type
    // The bodyType can reference the recursive variable using recVarType(varName)
    if (argExprs.length !== 2) {
      throw new Error("recType() requires exactly 2 arguments (varName, bodyType)");
    }

    const nameArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isLater(nameArg)) {
      throw new StagingError("recType() requires a compile-time known variable name");
    }

    if (nameArg.value.tag !== "string") {
      throw new TypeError(isString, nameArg.constraint, "recType() first argument");
    }

    const varName = nameArg.value.value;

    // Evaluate the body type expression
    const bodyArg = stagingEvaluate(argExprs[1], env, ctx).svalue;

    if (isLater(bodyArg)) {
      throw new StagingError("recType() requires a compile-time known body type");
    }

    if (bodyArg.value.tag !== "type") {
      throw new TypeError(isTypeC, bodyArg.constraint, "recType() second argument");
    }

    const resultConstraint = rec(varName, bodyArg.value.constraint);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  if (funcExpr.name === "recVarType") {
    // recVarType(varName) - creates a reference to a recursive type variable
    // Must be used inside a recType() body
    if (argExprs.length !== 1) {
      throw new Error("recVarType() requires exactly 1 argument (varName)");
    }

    const nameArg = stagingEvaluate(argExprs[0], env, ctx).svalue;

    if (isLater(nameArg)) {
      throw new StagingError("recVarType() requires a compile-time known variable name");
    }

    if (nameArg.value.tag !== "string") {
      throw new TypeError(isString, nameArg.constraint, "recVarType() argument");
    }

    const varName = nameArg.value.value;
    const resultConstraint = recVar(varName);
    return { svalue: now(typeVal(resultConstraint), isType(resultConstraint)) };
  }

  return null;
}

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
  if (args.length !== builtinDef.params.length) {
    throw new Error(`${builtinDef.name}() requires exactly ${builtinDef.params.length} arguments, got ${args.length}`);
  }

  // Check argument constraints
  for (let i = 0; i < args.length; i++) {
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
    const argResiduals = args.map(sv => isNow(sv) ? valueToExpr(sv.value) : sv.residual);
    const resultConstraint = builtinDef.resultType(args.map(sv => sv.constraint));

    // If it's a method-style builtin, generate method call syntax
    if (builtinDef.isMethod && args.length >= 1) {
      return {
        svalue: later(resultConstraint, methodCall(argResiduals[0], builtinDef.name, argResiduals.slice(1)))
      };
    }

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
        for (let i = 0; i < sclosure.params.length; i++) {
          callEnv = callEnv.set(sclosure.params[i], { svalue: closureArgs[i] });
        }
        return stagingEvaluate(sclosure.body, callEnv, RefinementContext.empty());
      },
      valueToExpr,
      now,
      later,
      isNow,
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
  // Try reflection builtins first (legacy - will be removed)
  const reflectionResult = tryStagedReflectionBuiltin(funcExpr, argExprs, env, ctx);
  if (reflectionResult !== null) {
    return reflectionResult;
  }

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

  if (isLater(func)) {
    // Function itself is not known - generate residual call
    const argResults = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);
    const argResiduals = argResults.map(sv => isNow(sv) ? valueToExpr(sv.value) : sv.residual);

    // We don't know the result constraint without knowing the function
    // Use 'any' as a conservative approximation
    return { svalue: later({ tag: "any" }, call(func.residual, ...argResiduals)) };
  }

  // Function is Now
  if (func.value.tag !== "closure") {
    throw new Error("Cannot call non-function");
  }

  const sclosure = stagedClosures.get(func.value);
  if (!sclosure) {
    throw new Error("Staged closure info not found");
  }

  if (argExprs.length !== sclosure.params.length) {
    throw new Error(`Expected ${sclosure.params.length} arguments, got ${argExprs.length}`);
  }

  // Evaluate arguments
  const args = argExprs.map(arg => stagingEvaluate(arg, env, ctx).svalue);

  // Coinductive cycle detection for recursive functions with Later arguments
  // This prevents infinite recursion when a recursive function is called with runtime values
  if (sclosure.name && args.some(isLater)) {
    if (inProgressRecursiveCalls.has(sclosure.name)) {
      // Cycle detected! We're already evaluating this recursive function with Later args.
      // Use the pre-computed result constraint and emit residual code.
      const resultConstraint = inProgressRecursiveCalls.get(sclosure.name)!;
      const argResiduals = args.map(sv =>
        isNow(sv) ? valueToExpr(sv.value) : sv.residual
      );
      return {
        svalue: later(resultConstraint, call(varRef(sclosure.name), ...argResiduals))
      };
    }

    // Not in a cycle yet - mark as in-progress and evaluate body
    const inferred = stagedInferredTypes.get(func.value);
    const resultConstraint = inferred?.resultConstraint ?? { tag: "any" };
    inProgressRecursiveCalls.set(sclosure.name, resultConstraint);

    // Bind arguments to parameters in the closure's environment
    let callEnv = sclosure.env;
    callEnv = callEnv.set(sclosure.name, { svalue: func });
    for (let i = 0; i < sclosure.params.length; i++) {
      callEnv = callEnv.set(sclosure.params[i], { svalue: args[i] });
    }

    try {
      return stagingEvaluate(sclosure.body, callEnv, RefinementContext.empty());
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

  for (let i = 0; i < sclosure.params.length; i++) {
    callEnv = callEnv.set(sclosure.params[i], { svalue: args[i] });
  }

  // Evaluate body
  return stagingEvaluate(sclosure.body, callEnv, RefinementContext.empty());
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

  // If receiver or any argument is Later, generate residual
  if (isLater(recv) || args.some(isLater)) {
    const recvResidual = isNow(recv) ? valueToExpr(recv.value) : recv.residual;
    const argResiduals = args.map(sv => isNow(sv) ? valueToExpr(sv.value) : sv.residual);

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
    const constraint = and(...fieldConstraints);
    return { svalue: now(value, constraint) };
  }

  // At least one field is Later - generate residual
  const fieldConstraints: Constraint[] = [isObject];
  const residualFields: { name: string; value: Expr }[] = [];

  for (const { name, svalue } of evaluatedFields) {
    fieldConstraints.push(hasField(name, svalue.constraint));
    residualFields.push({
      name,
      value: isNow(svalue) ? valueToExpr(svalue.value) : svalue.residual
    });
  }

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
    return { svalue: now(fieldValue, fieldConstraint) };
  }

  // Object is Later - generate residual field access
  const fieldConstraint = extractFieldConstraint(objResult.constraint, fieldName);
  return { svalue: later(fieldConstraint, field(objResult.residual, fieldName)) };
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

    return { svalue: now(arrayVal(values), and(...constraints)) };
  }

  // At least one element is Later
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

  const residualElements = evaluatedElements.map(sv =>
    isNow(sv) ? valueToExpr(sv.value) : sv.residual
  );

  return { svalue: later(and(...constraints), array(...residualElements)) };
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

  // At least one is Later
  let elementConstraint: Constraint;
  if (isNow(idx) && idx.value.tag === "number") {
    elementConstraint = extractElementConstraint(arr.constraint, idx.value.value);
  } else {
    elementConstraint = extractElementsConstraint(arr.constraint);
  }

  const arrResidual = isNow(arr) ? valueToExpr(arr.value) : arr.residual;
  const idxResidual = isNow(idx) ? valueToExpr(idx.value) : idx.residual;

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

  if (isLater(result)) {
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

  if (isLater(constraintResult)) {
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

  // Value is Later - generate residual assertion
  // The residual will be: assert(value, type, message)
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);
  const residualAssert = assertExpr(valueResult.residual, constraintExpr, message);

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
  const residualAssert = assertCondExpr(condResult.residual, message);
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

  if (isLater(constraintResult)) {
    throw new StagingError("trust requires a compile-time known type constraint");
  }

  if (constraintResult.value.tag !== "type") {
    throw new TypeError(isTypeC, constraintResult.constraint, "trust constraint");
  }

  const targetConstraint = constraintResult.value.constraint;

  // Refine the constraint based on trust (no runtime check)
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);

  if (isNow(valueResult)) {
    return { svalue: now(valueResult.value, refinedConstraint) };
  }

  // Value is Later - trust is purely a type-level operation, no residual
  // The trust "disappears" and just affects the constraint
  return { svalue: later(refinedConstraint, valueResult.residual) };
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
    }
  }

  visit(expr, bound);
  return free;
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
      // Convert closure back to expression by wrapping captured variables in let bindings
      const funcExpr = fn(v.params, v.body);

      // Find free variables in the body that need to be captured
      const paramSet = new Set(v.params);
      const freeInBody = freeVars(v.body, paramSet);

      // Build let bindings for captured variables from the closure's environment
      let result: Expr = funcExpr;
      for (const varName of freeInBody) {
        if (v.env.has(varName)) {
          const binding = v.env.get(varName);
          const valueExpr = valueToExpr(binding.value);
          result = letExpr(varName, valueExpr, result);
        }
      }

      return result;
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
  }
}

function extractFieldConstraint(objConstraint: Constraint, fieldName: string): Constraint {
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
  return { tag: "any" };
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
 * Create a dummy closure value for builtin functions.
 * These are only used for type inference - actual calls are intercepted by tryStagedReflectionBuiltin.
 */
function builtinClosure(params: string[], resultConstraint: Constraint): SBinding {
  // Create a placeholder expression (varRef to itself) - will never be evaluated
  const dummyBody = varRef("__builtin__");
  const closure = closureVal(params, dummyBody, Env.empty());
  const paramConstraints = params.map(() => ({ tag: "any" as const }));
  const fnConstraint = fnType(paramConstraints, resultConstraint);
  return { svalue: now(closure, fnConstraint) };
}

/**
 * Pre-bound builtin functions for the staged environment.
 * These enable type inference to work on function bodies that call builtins.
 */
const builtinBindings: Record<string, SBinding> = {
  // typeOf(value) -> Type (returns the compile-time type of any value)
  "typeOf": builtinClosure(["value"], isTypeC),
  // print(value) -> null
  "print": builtinClosure(["value"], isNull),
  // fields(Type) -> array of strings
  "fields": builtinClosure(["type"], and(isArray, elements(isString))),
  // fieldType(Type, name) -> Type
  "fieldType": builtinClosure(["type", "name"], isTypeC),
  // append(array, elem) -> array
  "append": builtinClosure(["array", "elem"], isArray),
  // comptimeFold(array, init, fn) -> any
  "comptimeFold": builtinClosure(["array", "init", "fn"], { tag: "any" }),
  // objectFromEntries(entries) -> object
  "objectFromEntries": builtinClosure(["entries"], isObject),
  // dynamicField(obj, fieldName) -> any
  "dynamicField": builtinClosure(["obj", "fieldName"], { tag: "any" }),

  // Type constructor builtins
  // objectType({ field1: Type1, ... }) -> Type
  "objectType": builtinClosure(["fields"], isTypeC),
  // arrayType(ElementType) -> Type
  "arrayType": builtinClosure(["elementType"], isTypeC),
  // unionType(Type1, Type2, ...) -> Type (variadic, but we declare 2 params for inference)
  "unionType": builtinClosure(["type1", "type2"], isTypeC),
  // intersectionType(Type1, Type2, ...) -> Type
  "intersectionType": builtinClosure(["type1", "type2"], isTypeC),
  // nullable(Type) -> Type (union with null)
  "nullable": builtinClosure(["type"], isTypeC),
  // functionType([ParamTypes], ResultType) -> Type
  "functionType": builtinClosure(["paramTypes", "resultType"], isTypeC),
  // objectTypeFromEntries([[name, Type], ...]) -> Type
  "objectTypeFromEntries": builtinClosure(["entries"], isTypeC),
  // recType(varName, bodyType) -> Type (recursive type)
  "recType": builtinClosure(["varName", "bodyType"], isTypeC),
  // recVarType(varName) -> Type (reference to recursive type variable)
  "recVarType": builtinClosure(["varName"], isTypeC),

  // Array operations
  // map(fn, array) -> array
  "map": builtinClosure(["fn", "array"], isArray),
  // filter(fn, array) -> array
  "filter": builtinClosure(["fn", "array"], isArray),

  // String operations
  // startsWith(str, prefix) -> boolean
  "startsWith": builtinClosure(["str", "prefix"], isBool),
  // endsWith(str, suffix) -> boolean
  "endsWith": builtinClosure(["str", "suffix"], isBool),
  // contains(str, substr) -> boolean
  "contains": builtinClosure(["str", "substr"], isBool),
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
  for (const builtin of getAllBuiltins()) {
    const paramConstraints = builtin.params.map(p => p.constraint);
    // Use a placeholder result constraint - actual result type comes from resultType()
    const resultConstraint = builtin.resultType(paramConstraints);
    const builtinFnType = fnType(paramConstraints, resultConstraint);
    env = env.set(builtin.name, {
      svalue: now(builtinVal(builtin.name), builtinFnType)
    });
  }

  // Add legacy builtins (not yet migrated to registry)
  for (const [name, binding] of Object.entries(builtinBindings)) {
    // Only add if not already in environment (registry takes precedence)
    if (!env.has(name)) {
      env = env.set(name, binding);
    }
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
  return result.residual;
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
