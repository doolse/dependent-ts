/**
 * Pure interpreter with constraint checking.
 *
 * Evaluates expressions to values while tracking constraints.
 * Type errors are caught at evaluation time based on constraint requirements.
 */

import { Expr, BinOp, UnaryOp } from "./expr";
import { Value, numberVal, stringVal, boolVal, nullVal, objectVal, arrayVal, closureVal, constraintOf, valueToString } from "./value";
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, hasField, elements, length, elementAt, implies, simplify, constraintToString, unify, or, narrowOr } from "./constraint";
import { Env, Binding, RefinementContext } from "./env";
import { getBinaryOp, getUnaryOp, requireConstraint, TypeError, stringConcat, EvalResult } from "./builtins";
import { extractAllRefinements, negateRefinement } from "./refinement";

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

function evalFn(params: string[], body: Expr, env: Env): EvalResult {
  // Create a closure capturing the current environment
  const closure = closureVal(params, body, env);
  return { value: closure, constraint: isFunction };
}

function evalCall(
  funcExpr: Expr,
  argExprs: Expr[],
  env: Env,
  ctx: RefinementContext
): EvalResult {
  const func = evaluate(funcExpr, env, ctx);

  // Function must be a closure
  requireConstraint(func.constraint, isFunction, "function call");

  if (func.value.tag !== "closure") {
    throw new Error("Cannot call non-function");
  }

  const closure = func.value;

  // Check arity
  if (argExprs.length !== closure.params.length) {
    throw new Error(
      `Expected ${closure.params.length} arguments, got ${argExprs.length}`
    );
  }

  // Evaluate arguments
  const args = argExprs.map(arg => evaluate(arg, env, ctx));

  // Bind arguments to parameters in the closure's environment
  let callEnv = closure.env;
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
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Evaluate an expression with an initial environment.
 */
export function run(expr: Expr, initialBindings?: Record<string, { value: Value; constraint: Constraint }>): EvalResult {
  let env = Env.empty();

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
