/**
 * Type inference from function bodies.
 *
 * Analyzes function bodies to infer parameter and return constraints
 * without requiring explicit type annotations.
 */

import { Expr } from "./expr";
import { Env, Binding } from "./env";
import { Value, nullVal } from "./value";
import {
  Constraint,
  isNumber,
  isString,
  isBool,
  isNull,
  isObject,
  isArray,
  isFunction,
  and,
  or,
  hasField,
  elements,
  fnType,
  freshCVar,
  Substitution,
  emptySubstitution,
  applySubstitution,
  solve,
  freeConstraintVars,
  ConstraintScheme,
  generalize,
  anyC,
} from "./constraint";
import { getBinaryOp, getUnaryOp } from "./builtins";

// ============================================================================
// Inference Types
// ============================================================================

export interface InferredFunction {
  paramConstraints: Constraint[];
  resultConstraint: Constraint;
  scheme: ConstraintScheme;
}

interface InferenceResult {
  constraint: Constraint;
  substitution: Substitution;
}

// ============================================================================
// Main Inference Function
// ============================================================================

/**
 * Infer the type of a function from its body.
 *
 * @param params - Parameter names
 * @param body - Function body expression
 * @param env - Environment (for free variables)
 * @returns Inferred parameter constraints, result constraint, and generalized scheme
 */
export function inferFunction(
  params: string[],
  body: Expr,
  env: Env
): InferredFunction {
  // 1. Create fresh constraint variable for each parameter
  const paramVars = params.map(() => freshCVar());

  // 2. Create inference environment binding params to fresh constraint vars
  let inferEnv = env;
  for (let i = 0; i < params.length; i++) {
    inferEnv = inferEnv.set(params[i], {
      value: nullVal, // Placeholder value - not used during inference
      constraint: paramVars[i],
    });
  }

  // 3. Analyze body to collect constraints
  const result = analyzeExpr(body, inferEnv);

  // 4. Apply substitution to get final param constraints
  const paramConstraints = paramVars.map(v =>
    applySubstitution(v, result.substitution)
  );
  const resultConstraint = applySubstitution(result.constraint, result.substitution);

  // 5. Generalize free variables for polymorphism
  const fnConstraint = fnType(paramConstraints, resultConstraint);
  const envVars = collectEnvConstraintVars(env);
  const scheme = generalize(fnConstraint, envVars);

  return { paramConstraints, resultConstraint, scheme };
}

/**
 * Collect all constraint variable IDs from an environment.
 */
function collectEnvConstraintVars(env: Env): Set<number> {
  const vars = new Set<number>();
  // Env is immutable, iterate over all bindings
  // For now, we'll assume env doesn't contain constraint vars
  // This is correct for top-level function inference
  return vars;
}

// ============================================================================
// Expression Analysis
// ============================================================================

/**
 * Analyze an expression to determine its constraint and learn about variables.
 */
function analyzeExpr(expr: Expr, env: Env): InferenceResult {
  switch (expr.tag) {
    case "lit":
      return analyzeLiteral(expr.value);

    case "var":
      return analyzeVariable(expr.name, env);

    case "binop":
      return analyzeBinaryOp(expr.op, expr.left, expr.right, env);

    case "unary":
      return analyzeUnaryOp(expr.op, expr.operand, env);

    case "if":
      return analyzeIf(expr.cond, expr.then, expr.else, env);

    case "let":
      return analyzeLet(expr.name, expr.value, expr.body, env);

    case "fn":
      return analyzeNestedFn(expr.params, expr.body, env);

    case "call":
      return analyzeCall(expr.func, expr.args, env);

    case "obj":
      return analyzeObject(expr.fields, env);

    case "field":
      return analyzeField(expr.object, expr.name, env);

    case "array":
      return analyzeArray(expr.elements, env);

    case "index":
      return analyzeIndex(expr.array, expr.index, env);

    case "block":
      return analyzeBlock(expr.exprs, env);

    case "comptime":
    case "runtime":
      return analyzeExpr(expr.expr, env);

    case "assert":
    case "trust":
      // For assert/trust, the constraint comes from the type argument
      // For inference, we analyze the expression
      return analyzeExpr(expr.expr, env);

    case "assertCond":
      // For condition-based assert, the result is always boolean
      return { constraint: isBool, substitution: emptySubstitution() };

    default:
      // For unknown expression types, return any with empty substitution
      return { constraint: anyC, substitution: emptySubstitution() };
  }
}

// ============================================================================
// Expression Analyzers
// ============================================================================

function analyzeLiteral(value: number | string | boolean | null): InferenceResult {
  let constraint: Constraint;

  if (typeof value === "number") {
    constraint = isNumber;
  } else if (typeof value === "string") {
    constraint = isString;
  } else if (typeof value === "boolean") {
    constraint = isBool;
  } else {
    constraint = isNull;
  }

  return { constraint, substitution: emptySubstitution() };
}

function analyzeVariable(name: string, env: Env): InferenceResult {
  const binding = env.get(name);
  return { constraint: binding.constraint, substitution: emptySubstitution() };
}

function analyzeBinaryOp(
  op: string,
  leftExpr: Expr,
  rightExpr: Expr,
  env: Env
): InferenceResult {
  const left = analyzeExpr(leftExpr, env);
  const right = analyzeExpr(rightExpr, env);

  // Merge substitutions from operands
  let sub = mergeSubstitutions(left.substitution, right.substitution);

  // Apply current substitution to operand constraints
  const leftC = applySubstitution(left.constraint, sub);
  const rightC = applySubstitution(right.constraint, sub);

  // Get builtin requirements
  const builtin = getBinaryOp(op as any);

  // Unify operand constraints with required constraints
  // This learns what constraint variables must be
  const leftSub = solve(leftC, builtin.params[0]);
  const rightSub = solve(rightC, builtin.params[1]);

  if (leftSub) sub = mergeSubstitutions(sub, leftSub);
  if (rightSub) sub = mergeSubstitutions(sub, rightSub);

  // Compute result constraint
  const resultConstraint = builtin.result([leftC, rightC]);

  return { constraint: resultConstraint, substitution: sub };
}

function analyzeUnaryOp(
  op: string,
  operandExpr: Expr,
  env: Env
): InferenceResult {
  const operand = analyzeExpr(operandExpr, env);
  let sub = operand.substitution;

  const operandC = applySubstitution(operand.constraint, sub);
  const builtin = getUnaryOp(op as any);

  const operandSub = solve(operandC, builtin.params[0]);
  if (operandSub) sub = mergeSubstitutions(sub, operandSub);

  const resultConstraint = builtin.result([operandC]);

  return { constraint: resultConstraint, substitution: sub };
}

function analyzeIf(
  condExpr: Expr,
  thenExpr: Expr,
  elseExpr: Expr,
  env: Env
): InferenceResult {
  const cond = analyzeExpr(condExpr, env);
  let sub = cond.substitution;

  // Condition must be boolean
  const condC = applySubstitution(cond.constraint, sub);
  const condSub = solve(condC, isBool);
  if (condSub) sub = mergeSubstitutions(sub, condSub);

  // Analyze both branches
  const thenResult = analyzeExpr(thenExpr, env);
  const elseResult = analyzeExpr(elseExpr, env);

  sub = mergeSubstitutions(sub, thenResult.substitution);
  sub = mergeSubstitutions(sub, elseResult.substitution);

  // Result is union of both branches
  const thenC = applySubstitution(thenResult.constraint, sub);
  const elseC = applySubstitution(elseResult.constraint, sub);

  return { constraint: or(thenC, elseC), substitution: sub };
}

function analyzeLet(
  name: string,
  valueExpr: Expr,
  bodyExpr: Expr,
  env: Env
): InferenceResult {
  const valueResult = analyzeExpr(valueExpr, env);
  let sub = valueResult.substitution;

  const valueC = applySubstitution(valueResult.constraint, sub);

  // Bind value in new environment
  const newEnv = env.set(name, {
    value: nullVal,
    constraint: valueC,
  });

  const bodyResult = analyzeExpr(bodyExpr, newEnv);
  sub = mergeSubstitutions(sub, bodyResult.substitution);

  return { constraint: bodyResult.constraint, substitution: sub };
}

function analyzeNestedFn(
  params: string[],
  body: Expr,
  env: Env
): InferenceResult {
  // Infer the nested function's type
  const inferred = inferFunction(params, body, env);

  return {
    constraint: fnType(inferred.paramConstraints, inferred.resultConstraint),
    substitution: emptySubstitution(),
  };
}

function analyzeCall(
  funcExpr: Expr,
  argExprs: Expr[],
  env: Env
): InferenceResult {
  const func = analyzeExpr(funcExpr, env);
  let sub = func.substitution;

  const args = argExprs.map(arg => {
    const result = analyzeExpr(arg, env);
    sub = mergeSubstitutions(sub, result.substitution);
    return result;
  });

  const funcC = applySubstitution(func.constraint, sub);

  // If function constraint is a fnType, use it
  if (funcC.tag === "fnType") {
    // Unify arguments with parameter constraints
    for (let i = 0; i < args.length && i < funcC.params.length; i++) {
      const argC = applySubstitution(args[i].constraint, sub);
      const argSub = solve(argC, funcC.params[i]);
      if (argSub) sub = mergeSubstitutions(sub, argSub);
    }

    return { constraint: funcC.result, substitution: sub };
  }

  // If function constraint is a variable, create a fresh fnType
  if (funcC.tag === "var") {
    const paramVars = args.map(() => freshCVar());
    const resultVar = freshCVar();
    const expectedFnType = fnType(paramVars, resultVar);

    const fnSub = solve(funcC, expectedFnType);
    if (fnSub) sub = mergeSubstitutions(sub, fnSub);

    // Unify arguments
    for (let i = 0; i < args.length; i++) {
      const argC = applySubstitution(args[i].constraint, sub);
      const argSub = solve(argC, paramVars[i]);
      if (argSub) sub = mergeSubstitutions(sub, argSub);
    }

    return { constraint: resultVar, substitution: sub };
  }

  // Otherwise, assume it's a function returning any
  return { constraint: anyC, substitution: sub };
}

function analyzeObject(
  fields: { name: string; value: Expr }[],
  env: Env
): InferenceResult {
  let sub = emptySubstitution();
  const fieldConstraints: Constraint[] = [isObject];

  for (const { name, value } of fields) {
    const result = analyzeExpr(value, env);
    sub = mergeSubstitutions(sub, result.substitution);
    const fieldC = applySubstitution(result.constraint, sub);
    fieldConstraints.push(hasField(name, fieldC));
  }

  return { constraint: and(...fieldConstraints), substitution: sub };
}

function analyzeField(
  objectExpr: Expr,
  fieldName: string,
  env: Env
): InferenceResult {
  const obj = analyzeExpr(objectExpr, env);
  let sub = obj.substitution;

  const objC = applySubstitution(obj.constraint, sub);

  // Create a fresh variable for the field type
  const fieldVar = freshCVar();

  // The object must have this field
  const objSub = solve(objC, hasField(fieldName, fieldVar));
  if (objSub) sub = mergeSubstitutions(sub, objSub);

  return { constraint: fieldVar, substitution: sub };
}

function analyzeArray(elemExprs: Expr[], env: Env): InferenceResult {
  let sub = emptySubstitution();

  if (elemExprs.length === 0) {
    return { constraint: and(isArray, elements(anyC)), substitution: sub };
  }

  // Analyze all elements
  const elemResults = elemExprs.map(e => {
    const result = analyzeExpr(e, env);
    sub = mergeSubstitutions(sub, result.substitution);
    return result;
  });

  // Union of all element types
  const elemConstraints = elemResults.map(r =>
    applySubstitution(r.constraint, sub)
  );
  const elemType = elemConstraints.length === 1
    ? elemConstraints[0]
    : or(...elemConstraints);

  return { constraint: and(isArray, elements(elemType)), substitution: sub };
}

function analyzeIndex(
  arrayExpr: Expr,
  indexExpr: Expr,
  env: Env
): InferenceResult {
  const arr = analyzeExpr(arrayExpr, env);
  const idx = analyzeExpr(indexExpr, env);

  let sub = mergeSubstitutions(arr.substitution, idx.substitution);

  // Index must be number
  const idxC = applySubstitution(idx.constraint, sub);
  const idxSub = solve(idxC, isNumber);
  if (idxSub) sub = mergeSubstitutions(sub, idxSub);

  // Array must have elements of some type
  const arrC = applySubstitution(arr.constraint, sub);
  const elemVar = freshCVar();
  const arrSub = solve(arrC, and(isArray, elements(elemVar)));
  if (arrSub) sub = mergeSubstitutions(sub, arrSub);

  return { constraint: elemVar, substitution: sub };
}

function analyzeBlock(exprs: Expr[], env: Env): InferenceResult {
  if (exprs.length === 0) {
    return { constraint: isNull, substitution: emptySubstitution() };
  }

  let sub = emptySubstitution();
  let lastConstraint: Constraint = isNull;

  for (const expr of exprs) {
    const result = analyzeExpr(expr, env);
    sub = mergeSubstitutions(sub, result.substitution);
    lastConstraint = result.constraint;
  }

  return { constraint: lastConstraint, substitution: sub };
}

// ============================================================================
// Substitution Helpers
// ============================================================================

/**
 * Merge two substitutions.
 * If both have a mapping for the same variable, the second takes precedence.
 */
function mergeSubstitutions(a: Substitution, b: Substitution): Substitution {
  const result = new Map(a);
  for (const [id, constraint] of b) {
    result.set(id, constraint);
  }
  return result;
}
