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
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, hasField, elements, length, elementAt, implies, simplify, or, narrowOr, isType, isTypeC, unify, fnType, constraintToString } from "./constraint";
import { inferFunction, InferredFunction } from "./inference";
import { Env, Binding, RefinementContext } from "./env";
import { getBinaryOp, getUnaryOp, requireConstraint, TypeError, stringConcat, AssertionError, EvalResult } from "./builtins";
import { extractAllRefinements, negateRefinement } from "./refinement";
import { SValue, Now, Later, now, later, isNow, isLater, allNow } from "./svalue";

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
