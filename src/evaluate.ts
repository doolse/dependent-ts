/**
 * Pure interpreter with constraint checking.
 *
 * Evaluates expressions to values while tracking constraints.
 * Type errors are caught at evaluation time based on constraint requirements.
 */

import { Expr, BinOp, UnaryOp, RecFnExpr } from "./expr";
import { Value, numberVal, stringVal, boolVal, nullVal, objectVal, arrayVal, closureVal, constraintOf, valueToString, typeVal, valueSatisfies, ClosureValue } from "./value";
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, hasField, elements, length, elementAt, implies, simplify, constraintToString, unify, or, narrowOr, isType, isTypeC, extractAllFieldNames, extractFieldConstraint as extractFieldConstraintFromConstraint, fnType, instantiate, applySubstitution, solve } from "./constraint";
import { Env, Binding, RefinementContext } from "./env";
import { getBinaryOp, getUnaryOp, requireConstraint, TypeError, stringConcat, EvalResult } from "./builtins";
import { extractAllRefinements, negateRefinement } from "./refinement";
import { inferFunction, InferredFunction } from "./inference";

// ============================================================================
// Evaluation Result
// ============================================================================

export { EvalResult };

// ============================================================================
// Main Evaluation Function
// ============================================================================

/**
 * Evaluate an expression in an environment.
 * Returns both the value and its constraint.
 */
export function evaluate(expr: Expr, env: Env, ctx: RefinementContext = RefinementContext.empty()): EvalResult {
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
      // In pure evaluation, everything is evaluated - just evaluate the inner expression
      return evaluate(expr.expr, env, ctx);

    case "runtime":
      // In pure evaluation, runtime annotations are ignored - evaluate normally
      return evaluate(expr.expr, env, ctx);

    case "assert":
      return evalAssert(expr.expr, expr.constraint, expr.message, env, ctx);

    case "assertCond":
      return evalAssertCond(expr.condition, expr.message, env, ctx);

    case "trust":
      return evalTrust(expr.expr, expr.constraint, env, ctx);
  }
}

// ============================================================================
// Expression Evaluators
// ============================================================================

function evalLiteral(value: number | string | boolean | null): EvalResult {
  if (typeof value === "number") {
    const v = numberVal(value);
    return { value: v, constraint: constraintOf(v) };
  }
  if (typeof value === "string") {
    const v = stringVal(value);
    return { value: v, constraint: constraintOf(v) };
  }
  if (typeof value === "boolean") {
    const v = boolVal(value);
    return { value: v, constraint: constraintOf(v) };
  }
  if (value === null) {
    return { value: nullVal, constraint: isNull };
  }
  throw new Error(`Unknown literal: ${value}`);
}

function evalVariable(name: string, env: Env, ctx: RefinementContext): EvalResult {
  const binding = env.get(name);

  // Apply any refinements from control flow
  const refinement = ctx.get(name);
  if (refinement) {
    // Use narrowOr to properly eliminate contradictory branches in union types
    // e.g., if shape is Circle | Square, and we refine with hasField("kind", equals("circle")),
    // this will eliminate the Square branch
    const refined = narrowOr(binding.constraint, refinement);
    return { value: binding.value, constraint: refined };
  }

  return { value: binding.value, constraint: binding.constraint };
}

function evalBinaryOp(
  op: BinOp,
  leftExpr: Expr,
  rightExpr: Expr,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const left = evaluate(leftExpr, env, ctx);
  const right = evaluate(rightExpr, env, ctx);

  // Special case: + can be string concatenation
  if (op === "+") {
    const leftIsString = implies(left.constraint, isString);
    const rightIsString = implies(right.constraint, isString);

    if (leftIsString || rightIsString) {
      // String concatenation
      requireConstraint(left.constraint, isString, "left of string +");
      requireConstraint(right.constraint, isString, "right of string +");

      const result = stringConcat.impl([left.value, right.value]);
      const resultConstraint = stringConcat.result([left.constraint, right.constraint]);
      return { value: result, constraint: resultConstraint };
    }
  }

  const builtin = getBinaryOp(op);

  // Check constraints
  requireConstraint(left.constraint, builtin.params[0], `left of ${op}`);
  requireConstraint(right.constraint, builtin.params[1], `right of ${op}`);

  // Execute
  const result = builtin.impl([left.value, right.value]);
  const resultConstraint = builtin.result([left.constraint, right.constraint]);

  return { value: result, constraint: resultConstraint };
}

function evalUnaryOp(
  op: UnaryOp,
  operandExpr: Expr,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const operand = evaluate(operandExpr, env, ctx);
  const builtin = getUnaryOp(op);

  // Check constraint
  requireConstraint(operand.constraint, builtin.params[0], `operand of ${op}`);

  // Execute
  const result = builtin.impl([operand.value]);
  const resultConstraint = builtin.result([operand.constraint]);

  return { value: result, constraint: resultConstraint };
}

function evalIf(
  condExpr: Expr,
  thenExpr: Expr,
  elseExpr: Expr,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const cond = evaluate(condExpr, env, ctx);

  // Condition must be boolean
  requireConstraint(cond.constraint, isBool, "if condition");

  if (cond.value.tag !== "bool") {
    throw new Error("if condition must be boolean");
  }

  // Extract refinements from the condition expression
  const refinement = extractAllRefinements(condExpr);

  // Evaluate the appropriate branch with refined context
  if (cond.value.value) {
    // Then branch: condition is true, apply positive refinements
    let thenCtx = ctx;
    for (const [varName, constraint] of refinement.constraints) {
      thenCtx = thenCtx.refine(varName, constraint);
    }
    return evaluate(thenExpr, env, thenCtx);
  } else {
    // Else branch: condition is false, apply negated refinements
    const negatedRefinement = negateRefinement(refinement);
    let elseCtx = ctx;
    for (const [varName, constraint] of negatedRefinement.constraints) {
      elseCtx = elseCtx.refine(varName, constraint);
    }
    return evaluate(elseExpr, env, elseCtx);
  }
}

function evalLet(
  name: string,
  valueExpr: Expr,
  bodyExpr: Expr,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const valueResult = evaluate(valueExpr, env, ctx);

  // Bind the value in a new environment
  const newEnv = env.set(name, {
    value: valueResult.value,
    constraint: valueResult.constraint,
  });

  return evaluate(bodyExpr, newEnv, ctx);
}

// Cache for inferred function types
const inferredTypes = new WeakMap<ClosureValue, InferredFunction>();

function evalFn(params: string[], body: Expr, env: Env): EvalResult {
  // Create a closure capturing the current environment
  const closure = closureVal(params, body, env);

  // Infer constraints from body
  const inferred = inferFunction(params, body, env);
  inferredTypes.set(closure, inferred);

  // Return function with proper fnType constraint
  const fnConstraint = fnType(inferred.paramConstraints, inferred.resultConstraint);
  return { value: closure, constraint: fnConstraint };
}

/**
 * Evaluate a named recursive function.
 * The function can call itself by name within its body.
 */
function evalRecFn(name: string, params: string[], body: Expr, env: Env): EvalResult {
  // Create a closure with the name for self-reference
  // The actual self-binding is added at call-time in evalCall
  const closure = closureVal(params, body, env, name);

  // For recursive type inference, we need to analyze the body
  // with an assumed type for the function itself.
  // Create an env with the function bound to a fresh function type
  const selfEnv = env.set(name, {
    value: closure,
    constraint: isFunction,  // Placeholder - will be refined
  });

  // Infer constraints from body with self-reference available
  const inferred = inferFunction(params, body, selfEnv);
  inferredTypes.set(closure, inferred);

  // Return function with proper fnType constraint
  const fnConstraint = fnType(inferred.paramConstraints, inferred.resultConstraint);
  return { value: closure, constraint: fnConstraint };
}

// Export for use in other modules
export function getInferredType(closure: ClosureValue): InferredFunction | undefined {
  return inferredTypes.get(closure);
}

// ============================================================================
// Reflection Builtins
// ============================================================================

/**
 * Try to handle a reflection builtin call.
 * Returns null if the call is not a reflection builtin.
 */
function tryReflectionBuiltin(
  funcExpr: Expr,
  args: EvalResult[],
  env: Env
): EvalResult | null {
  if (funcExpr.tag !== "var") return null;

  if (funcExpr.name === "fields") {
    // fields(T) - returns array of field names from a type
    if (args.length !== 1) {
      throw new Error("fields() requires exactly 1 argument");
    }

    const typeArg = args[0];
    if (typeArg.value.tag !== "type") {
      throw new TypeError(isTypeC, typeArg.constraint, "fields() argument");
    }

    const fieldNames = extractAllFieldNames(typeArg.value.constraint);
    const fieldValues = fieldNames.map(stringVal);

    return {
      value: arrayVal(fieldValues),
      constraint: and(isArray, elements(isString))
    };
  }

  if (funcExpr.name === "print") {
    // print(value) - prints value to stdout, returns null
    if (args.length !== 1) {
      throw new Error("print() requires exactly 1 argument");
    }

    const value = args[0].value;
    console.log(valueToString(value));

    return {
      value: nullVal,
      constraint: isNull
    };
  }

  if (funcExpr.name === "fieldType") {
    // fieldType(T, name) - returns the type of a field
    if (args.length !== 2) {
      throw new Error("fieldType() requires exactly 2 arguments");
    }

    const typeArg = args[0];
    const nameArg = args[1];

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
      value: typeVal(fieldConstraint),
      constraint: isType(fieldConstraint)
    };
  }

  return null;
}

function evalCall(
  funcExpr: Expr,
  argExprs: Expr[],
  env: Env,
  ctx: RefinementContext
): EvalResult {
  // Evaluate arguments first for reflection builtins
  const args = argExprs.map(arg => evaluate(arg, env, ctx));

  // Try reflection builtins first
  const reflectionResult = tryReflectionBuiltin(funcExpr, args, env);
  if (reflectionResult !== null) {
    return reflectionResult;
  }

  const func = evaluate(funcExpr, env, ctx);

  // Function must be a closure
  requireConstraint(func.constraint, isFunction, "function call");

  if (func.value.tag !== "closure") {
    throw new Error("Cannot call non-function");
  }

  const closure = func.value;

  // Check arity
  if (args.length !== closure.params.length) {
    throw new Error(
      `Expected ${closure.params.length} arguments, got ${args.length}`
    );
  }

  // Get inferred type and check arguments at call site
  const inferred = inferredTypes.get(closure);
  if (inferred) {
    // Instantiate the scheme for this call (fresh variables for polymorphism)
    const instantiated = instantiate(inferred.scheme);

    // Extract param constraints from instantiated fnType
    if (instantiated.tag === "fnType") {
      const minLen = Math.min(args.length, instantiated.params.length);

      // Build up a substitution by unifying each argument with its parameter
      let callSubstitution: Map<number, Constraint> = new Map();

      for (let i = 0; i < minLen; i++) {
        const paramConstraint = instantiated.params[i];
        const arg = args[i];
        if (!paramConstraint || !arg) continue;

        // Apply current substitution to the parameter constraint
        const resolvedParam = applySubstitution(paramConstraint, callSubstitution);

        // For constraint variables, unify to learn what type the variable should be
        // For concrete constraints (after substitution), check implication
        if (resolvedParam.tag === "var") {
          // Polymorphic parameter - bind the variable to the argument type
          callSubstitution.set(resolvedParam.id, arg.constraint);
          continue;
        }

        // Try to solve/unify the argument with the parameter
        // This handles cases like and(isArray, elements(?2)) where ?2 needs to be inferred
        const solution = solve(arg.constraint, resolvedParam);
        if (solution) {
          // Merge the solution into our substitution
          for (const [id, c] of solution) {
            callSubstitution.set(id, c);
          }
          continue;
        }

        // If solve fails, fall back to implication check (for non-variable constraints)
        if (!implies(arg.constraint, resolvedParam)) {
          throw new TypeError(
            resolvedParam,
            arg.constraint,
            `argument ${i + 1} to ${closure.params[i]}`
          );
        }
      }
    }
  }

  // Bind arguments to parameters in the closure's environment
  let callEnv = closure.env;

  // Add self-binding for recursive functions
  if (closure.name) {
    callEnv = callEnv.set(closure.name, {
      value: closure,
      constraint: func.constraint,
    });
  }

  for (let i = 0; i < closure.params.length; i++) {
    callEnv = callEnv.set(closure.params[i], {
      value: args[i].value,
      constraint: args[i].constraint,
    });
  }

  // Evaluate body in the extended environment
  return evaluate(closure.body, callEnv, RefinementContext.empty());
}

function evalObject(
  fields: { name: string; value: Expr }[],
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const evaluatedFields: Record<string, Value> = {};
  const fieldConstraints: Constraint[] = [isObject];

  for (const { name, value } of fields) {
    const result = evaluate(value, env, ctx);
    evaluatedFields[name] = result.value;
    fieldConstraints.push(hasField(name, result.constraint));
  }

  const value = objectVal(evaluatedFields);
  const constraint = and(...fieldConstraints);

  return { value, constraint };
}

function evalField(
  objectExpr: Expr,
  fieldName: string,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const obj = evaluate(objectExpr, env, ctx);

  // Must be an object with this field
  requireConstraint(obj.constraint, isObject, `field access .${fieldName}`);

  if (obj.value.tag !== "object") {
    throw new Error(`Cannot access field '${fieldName}' on non-object`);
  }

  const fieldValue = obj.value.fields.get(fieldName);
  if (fieldValue === undefined) {
    throw new Error(`Object has no field '${fieldName}'`);
  }

  // Extract field constraint from object constraint
  const fieldConstraint = extractFieldConstraint(obj.constraint, fieldName);

  return { value: fieldValue, constraint: fieldConstraint };
}

function evalArray(
  elementExprs: Expr[],
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const elements: Value[] = [];
  const constraints: Constraint[] = [isArray];

  // Add length constraint
  constraints.push(length(and(isNumber, { tag: "equals", value: elementExprs.length })));

  // Evaluate each element and track constraints
  for (let i = 0; i < elementExprs.length; i++) {
    const result = evaluate(elementExprs[i], env, ctx);
    elements.push(result.value);
    constraints.push(elementAt(i, result.constraint));
  }

  // Compute common element type (union of all element constraints)
  if (elements.length > 0) {
    // For homogeneous access, compute the union
    const elementConstraints = [];
    for (let i = 0; i < elementExprs.length; i++) {
      const result = evaluate(elementExprs[i], env, ctx);
      elementConstraints.push(result.constraint);
    }
    // Simplify: if all same, use that; otherwise use union
    const unique = dedupeConstraints(elementConstraints);
    if (unique.length === 1) {
      constraints.push({ tag: "elements", constraint: unique[0] });
    } else {
      constraints.push({ tag: "elements", constraint: or(...unique) });
    }
  }

  const value = arrayVal(elements);
  const constraint = and(...constraints);

  return { value, constraint };
}

function evalIndex(
  arrayExpr: Expr,
  indexExpr: Expr,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const arr = evaluate(arrayExpr, env, ctx);
  const idx = evaluate(indexExpr, env, ctx);

  // Array must be an array
  requireConstraint(arr.constraint, isArray, "array index");
  // Index must be a number
  requireConstraint(idx.constraint, isNumber, "array index");

  if (arr.value.tag !== "array") {
    throw new Error("Cannot index non-array");
  }
  if (idx.value.tag !== "number") {
    throw new Error("Array index must be a number");
  }

  const index = idx.value.value;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid array index: ${index}`);
  }
  if (index >= arr.value.elements.length) {
    throw new Error(`Array index out of bounds: ${index} >= ${arr.value.elements.length}`);
  }

  const element = arr.value.elements[index];

  // Try to get precise element type if index is known
  const elementConstraint = extractElementConstraint(arr.constraint, index);

  return { value: element, constraint: elementConstraint };
}

function evalBlock(
  exprs: Expr[],
  env: Env,
  ctx: RefinementContext
): EvalResult {
  if (exprs.length === 0) {
    return { value: nullVal, constraint: isNull };
  }

  let result: EvalResult = { value: nullVal, constraint: isNull };
  for (const expr of exprs) {
    result = evaluate(expr, env, ctx);
  }
  return result;
}

/**
 * Runtime assertion that a value satisfies a constraint.
 * Throws an AssertionError if the check fails.
 */
function evalAssert(
  valueExpr: Expr,
  constraintExpr: Expr,
  message: string | undefined,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  // Evaluate the constraint expression - should be a Type value
  const constraintResult = evaluate(constraintExpr, env, ctx);
  if (constraintResult.value.tag !== "type") {
    throw new TypeError(isTypeC, constraintResult.constraint, "assert constraint");
  }

  const targetConstraint = constraintResult.value.constraint;

  // Evaluate the expression being asserted
  const valueResult = evaluate(valueExpr, env, ctx);

  // Runtime check: does the value satisfy the constraint?
  if (!valueSatisfies(valueResult.value, targetConstraint)) {
    const errorMsg = message
      ? message
      : `Assertion failed: value ${valueToString(valueResult.value)} does not satisfy ${constraintToString(targetConstraint)}`;
    throw new AssertionError(errorMsg, valueResult.value, targetConstraint);
  }

  // Return the value with the refined constraint (the intersection)
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);
  return { value: valueResult.value, constraint: refinedConstraint };
}

/**
 * Assert a boolean condition at runtime.
 * Throws AssertionError if condition is false, returns true if it passes.
 */
function evalAssertCond(
  conditionExpr: Expr,
  message: string | undefined,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  // Evaluate the condition
  const condResult = evaluate(conditionExpr, env, ctx);

  // Condition must be boolean
  requireConstraint(condResult.constraint, isBool, "assert condition");

  if (condResult.value.tag !== "bool") {
    throw new Error("assert condition must be boolean");
  }

  // Check the condition
  if (!condResult.value.value) {
    const errorMsg = message ?? "Assertion failed: condition is false";
    throw new AssertionError(errorMsg, condResult.value, isBool);
  }

  // Return true with boolean constraint
  return { value: boolVal(true), constraint: isBool };
}

/**
 * Trust that a value satisfies a constraint without runtime checking.
 * The programmer takes responsibility for the correctness.
 * If no constraint is provided, the value is returned unchanged.
 */
function evalTrust(
  valueExpr: Expr,
  constraintExpr: Expr | undefined,
  env: Env,
  ctx: RefinementContext
): EvalResult {
  // Evaluate the expression being trusted
  const valueResult = evaluate(valueExpr, env, ctx);

  // If no constraint specified, just return the value unchanged
  if (!constraintExpr) {
    return valueResult;
  }

  // Evaluate the constraint expression - should be a Type value
  const constraintResult = evaluate(constraintExpr, env, ctx);
  if (constraintResult.value.tag !== "type") {
    throw new TypeError(isTypeC, constraintResult.constraint, "trust constraint");
  }

  const targetConstraint = constraintResult.value.constraint;

  // No runtime check - just refine the constraint based on trust
  const refinedConstraint = unify(valueResult.constraint, targetConstraint);
  return { value: valueResult.value, constraint: refinedConstraint };
}

/**
 * Error thrown when a runtime assertion fails.
 */
export class AssertionError extends Error {
  constructor(
    message: string,
    public readonly value: Value,
    public readonly constraint: Constraint
  ) {
    super(message);
    this.name = "AssertionError";
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the constraint for a field from an object constraint.
 */
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
  // Fallback: unknown
  return { tag: "any" };
}

/**
 * Extract the constraint for an element at a known index.
 */
function extractElementConstraint(arrConstraint: Constraint, index: number): Constraint {
  if (arrConstraint.tag === "elementAt" && arrConstraint.index === index) {
    return arrConstraint.constraint;
  }
  if (arrConstraint.tag === "and") {
    for (const c of arrConstraint.constraints) {
      if (c.tag === "elementAt" && c.index === index) {
        return c.constraint;
      }
    }
    // Fall back to elements constraint
    for (const c of arrConstraint.constraints) {
      if (c.tag === "elements") {
        return c.constraint;
      }
    }
  }
  // Fallback: unknown
  return { tag: "any" };
}

/**
 * Remove duplicate constraints (by structural equality).
 */
function dedupeConstraints(constraints: Constraint[]): Constraint[] {
  const result: Constraint[] = [];
  outer: for (const c of constraints) {
    for (const r of result) {
      if (constraintEquals(c, r)) continue outer;
    }
    result.push(c);
  }
  return result;
}

/**
 * Simple structural equality check for constraints.
 */
function constraintEquals(a: Constraint, b: Constraint): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    case "isNumber":
    case "isString":
    case "isBool":
    case "isNull":
    case "isObject":
    case "isArray":
    case "isFunction":
    case "never":
    case "any":
      return true;

    case "equals":
      return a.value === (b as typeof a).value;

    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return a.bound === (b as typeof a).bound;

    case "hasField":
      return a.name === (b as typeof a).name &&
             constraintEquals(a.constraint, (b as typeof a).constraint);

    case "elements":
    case "length":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

    case "elementAt":
      return a.index === (b as typeof a).index &&
             constraintEquals(a.constraint, (b as typeof a).constraint);

    case "and":
    case "or": {
      const bArr = (b as typeof a).constraints;
      if (a.constraints.length !== bArr.length) return false;
      return a.constraints.every((c, i) => constraintEquals(c, bArr[i]));
    }

    case "not":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

    case "var":
      return a.id === (b as typeof a).id;

    case "isType":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

    case "fnType": {
      const bFn = b as typeof a;
      if (a.params.length !== bFn.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!constraintEquals(a.params[i], bFn.params[i])) return false;
      }
      return constraintEquals(a.result, bFn.result);
    }

    case "rec":
      return a.var === (b as typeof a).var &&
             constraintEquals(a.body, (b as typeof a).body);

    case "recVar":
      return a.var === (b as typeof a).var;
  }
}

// ============================================================================
// Type Bindings
// ============================================================================

/**
 * Pre-bound type constants available in the initial environment.
 * These allow types to be used as first-class values.
 */
const typeBindings: Record<string, Binding> = {
  "number": { value: typeVal(isNumber), constraint: isType(isNumber) },
  "string": { value: typeVal(isString), constraint: isType(isString) },
  "boolean": { value: typeVal(isBool), constraint: isType(isBool) },
  "null": { value: typeVal(isNull), constraint: isType(isNull) },
  "object": { value: typeVal(isObject), constraint: isType(isObject) },
  "array": { value: typeVal(isArray), constraint: isType(isArray) },
  "function": { value: typeVal(isFunction), constraint: isType(isFunction) },
};

/**
 * Create the initial environment with type bindings.
 */
function createInitialEnv(): Env {
  let env = Env.empty();
  for (const [name, binding] of Object.entries(typeBindings)) {
    env = env.set(name, binding);
  }
  return env;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Evaluate an expression with an initial environment.
 */
export function run(expr: Expr, initialBindings?: Record<string, { value: Value; constraint: Constraint }>): EvalResult {
  let env = createInitialEnv();

  if (initialBindings) {
    for (const [name, binding] of Object.entries(initialBindings)) {
      env = env.set(name, binding);
    }
  }

  return evaluate(expr, env);
}

/**
 * Evaluate an expression and return just the value.
 */
export function runValue(expr: Expr): Value {
  return run(expr).value;
}
