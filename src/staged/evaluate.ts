/**
 * Main evaluation function with staging semantics, refinements, and reflection.
 * Based on docs/staged-architecture.md Parts 1.2, 2.3-2.4, and 3.5
 */

import { Expr, BinaryOp, ReflectExpr, TypeOpExpr, FunctionDef, LambdaExpr, LetExpr } from "./expr";
import { SValue, Env, nowValue, laterValue, isNow, withSource, isClosure, makeClosure, Closure } from "./svalue";

/**
 * Registry of user-defined functions.
 */
export type FunctionRegistry = Map<string, FunctionDef>;
import { inferType, objectType, ObjectField, widenType, functionType, numberType, TypeValue } from "./types";
import { jsCond, jsField, jsObj } from "./jsexpr";
import { builtins, toExpr, extractConstraint } from "./builtins";
import { RefinementContext, emptyContext, extendContext, proveFromFacts } from "./refinement";
import { negateConstraint } from "./constraints";
import {
  reflectTypeOf,
  reflectFields,
  reflectFieldType,
  reflectHasField,
  reflectIsSubtype,
  reflectTypeEquals,
  reflectTypeTag,
  reflectTypeToString,
  typeOpPick,
  typeOpOmit,
  typeOpPartial,
  typeOpRequired,
  typeOpMerge,
  typeOpElementType,
} from "./reflect";

/**
 * Map source binary operators to built-in function names.
 */
const binaryOpToBuiltin: Record<BinaryOp, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "==": "eq",
  "!=": "neq",
  "<": "lt",
  ">": "gt",
  "<=": "lte",
  ">=": "gte",
  "&&": "and",
  "||": "or",
};

// Module-level function registry for user-defined functions
let currentFunctionRegistry: FunctionRegistry = new Map();

/**
 * Set the function registry for user-defined functions.
 */
export function setFunctionRegistry(registry: FunctionRegistry): void {
  currentFunctionRegistry = registry;
}

/**
 * Get the current function registry.
 */
export function getFunctionRegistry(): FunctionRegistry {
  return currentFunctionRegistry;
}

/**
 * Main evaluation function.
 * Takes a RefinementContext for tracking known facts.
 */
export function evaluate(expr: Expr, env: Env, ctx: RefinementContext = emptyContext()): SValue {
  switch (expr.tag) {
    case "literal":
      // Literals are always "now"
      return nowValue(inferType(expr.value), expr.value);

    case "variable": {
      // Variables come from environment - could be either stage
      // Add source info for refinement tracking
      const v = env.get(expr.name);
      return withSource(v, { symbol: expr.name });
    }

    case "binary_op":
      return evalBinaryOp(expr.op, expr.left, expr.right, env, ctx);

    case "if":
      return evalConditional(expr.condition, expr.thenBranch, expr.elseBranch, env, ctx);

    case "object":
      return evalObject(expr.fields, env, ctx);

    case "field_access":
      return evalFieldAccess(expr.object, expr.field, env, ctx);

    case "call":
      return evalCall(expr.func, expr.args, env, ctx);

    case "reflect":
      return evalReflect(expr, env, ctx);

    case "type_op":
      return evalTypeOp(expr, env, ctx);

    case "lambda":
      return evalLambda(expr, env);

    case "let":
      return evalLet(expr, env, ctx);
  }
}

/**
 * Binary operations delegate to built-in functions.
 */
function evalBinaryOp(
  op: BinaryOp,
  left: Expr,
  right: Expr,
  env: Env,
  ctx: RefinementContext
): SValue {
  const leftVal = evaluate(left, env, ctx);
  const rightVal = evaluate(right, env, ctx);

  // Special case for string concatenation with +
  if (op === "+") {
    const leftIsString =
      (leftVal.type.tag === "primitive" && leftVal.type.name === "string") ||
      (leftVal.type.tag === "literal" && typeof leftVal.type.value === "string");
    const rightIsString =
      (rightVal.type.tag === "primitive" && rightVal.type.name === "string") ||
      (rightVal.type.tag === "literal" && typeof rightVal.type.value === "string");

    if (leftIsString || rightIsString) {
      return builtins.concat([leftVal, rightVal], ctx);
    }
  }

  const builtinName = binaryOpToBuiltin[op];
  const builtin = builtins[builtinName];
  if (!builtin) {
    throw new Error(`Unknown binary operator: ${op}`);
  }

  return builtin([leftVal, rightVal], ctx);
}

/**
 * Conditional evaluation with staging and refinements.
 * (Architecture doc section 2.4)
 */
function evalConditional(
  condition: Expr,
  thenBranch: Expr,
  elseBranch: Expr,
  env: Env,
  ctx: RefinementContext
): SValue {
  const condVal = evaluate(condition, env, ctx);

  // If condition is known at this stage, only evaluate one branch
  if (isNow(condVal)) {
    if (condVal.value) {
      return evaluate(thenBranch, env, ctx);
    } else {
      return evaluate(elseBranch, env, ctx);
    }
  }

  // Try to determine condition from existing facts (refinement proving)
  const condConstraint = extractConstraint(condVal);
  if (condConstraint) {
    const proven = proveFromFacts(ctx, condConstraint);

    if (proven === true) {
      // Facts prove condition is true!
      return evaluate(thenBranch, env, ctx);
    } else if (proven === false) {
      // Facts prove condition is false!
      return evaluate(elseBranch, env, ctx);
    }
  }

  // Condition is unknown - evaluate both branches with refined contexts
  // In then-branch, we know condition is true
  const thenCtx = condConstraint ? extendContext(ctx, [condConstraint]) : ctx;
  const thenVal = evaluate(thenBranch, env, thenCtx);

  // In else-branch, we know condition is false
  const elseCtx = condConstraint ? extendContext(ctx, [negateConstraint(condConstraint)]) : ctx;
  const elseVal = evaluate(elseBranch, env, elseCtx);

  // Compute result type (simplified: use then-branch type, widened)
  const resultType = widenType(thenVal.type);

  // If both branches are "now" with same value, result is "now"
  if (isNow(thenVal) && isNow(elseVal) && thenVal.value === elseVal.value) {
    return thenVal;
  }

  return laterValue(resultType, jsCond(condVal.expr, toExpr(thenVal), toExpr(elseVal)));
}

/**
 * Object literal evaluation.
 */
function evalObject(
  fields: { name: string; value: Expr }[],
  env: Env,
  ctx: RefinementContext
): SValue {
  const evaluatedFields: { name: string; svalue: SValue }[] = fields.map((f) => ({
    name: f.name,
    svalue: evaluate(f.value, env, ctx),
  }));

  const typeFields: ObjectField[] = evaluatedFields.map((f) => ({
    name: f.name,
    type: f.svalue.type,
  }));
  const objType = objectType(typeFields);

  // If all fields are "now", result is "now"
  const allNow = evaluatedFields.every((f) => isNow(f.svalue));

  if (allNow) {
    const value: Record<string, unknown> = {};
    for (const f of evaluatedFields) {
      value[f.name] = (f.svalue as { value: unknown }).value;
    }
    return nowValue(objType, value);
  }

  // Some fields are "later", generate object expression
  const jsFields = evaluatedFields.map((f) => ({
    name: f.name,
    value: toExpr(f.svalue),
  }));

  return laterValue(objType, jsObj(jsFields));
}

/**
 * Field access evaluation.
 * Tracks source info for refinement.
 */
function evalFieldAccess(
  objectExpr: Expr,
  fieldName: string,
  env: Env,
  ctx: RefinementContext
): SValue {
  const objVal = evaluate(objectExpr, env, ctx);

  if (objVal.type.tag !== "object") {
    throw new Error(`Cannot access field '${fieldName}' on non-object type`);
  }

  const fieldDef = objVal.type.fields.find((f) => f.name === fieldName);
  if (!fieldDef) {
    throw new Error(`No field '${fieldName}' on object type`);
  }

  if (isNow(objVal)) {
    const value = (objVal.value as Record<string, unknown>)[fieldName];
    return nowValue(fieldDef.type, value, { field: { object: objVal, field: fieldName } });
  }

  return laterValue(fieldDef.type, jsField(objVal.expr, fieldName), {
    field: { object: objVal, field: fieldName },
  });
}

/**
 * Lambda evaluation - creates a closure capturing the current environment.
 */
function evalLambda(expr: LambdaExpr, env: Env): SValue {
  // For now, use a generic function type (params are numberType by default)
  // A full type system would infer these from usage
  const paramTypes = expr.params.map(() => numberType);
  const fnType = functionType(paramTypes, numberType);

  const closure = makeClosure(expr.params, expr.body, env, fnType);
  return nowValue(fnType, closure);
}

/**
 * Let expression evaluation.
 * Evaluates the value, binds it to the name, then evaluates the body.
 */
function evalLet(expr: LetExpr, env: Env, ctx: RefinementContext): SValue {
  const valueResult = evaluate(expr.value, env, ctx);
  const newEnv = env.set(expr.name, valueResult);
  return evaluate(expr.body, newEnv, ctx);
}

/**
 * Function call evaluation.
 * Supports both built-in functions and user-defined closures.
 */
function evalCall(funcExpr: Expr, args: Expr[], env: Env, ctx: RefinementContext): SValue {
  // Evaluate the function expression
  const funcVal = evaluate(funcExpr, env, ctx);
  const argVals = args.map((arg) => evaluate(arg, env, ctx));

  // Check if it's a closure (user-defined function)
  if (isNow(funcVal) && isClosure(funcVal.value)) {
    return applyClosure(funcVal.value as Closure, argVals, ctx);
  }

  // Check if funcExpr is a variable reference to a built-in
  if (funcExpr.tag === "variable") {
    const builtin = builtins[funcExpr.name];
    if (builtin) {
      return builtin(argVals, ctx);
    }
  }

  throw new Error(`Cannot call non-function value`);
}

/**
 * Apply a closure to arguments.
 */
function applyClosure(closure: Closure, args: SValue[], ctx: RefinementContext): SValue {
  if (args.length !== closure.params.length) {
    throw new Error(`Expected ${closure.params.length} arguments, got ${args.length}`);
  }

  // Create new environment with parameters bound to arguments
  let newEnv = closure.env;
  for (let i = 0; i < closure.params.length; i++) {
    newEnv = newEnv.set(closure.params[i], args[i]);
  }

  // Evaluate body in the new environment
  return evaluate(closure.body, newEnv, ctx);
}

/**
 * Reflection expression evaluation.
 * All reflection operations return "now" values because types are always known.
 */
function evalReflect(expr: ReflectExpr, env: Env, ctx: RefinementContext): SValue {
  const target = evaluate(expr.target, env, ctx);
  const args = expr.args?.map((a) => evaluate(a, env, ctx)) ?? [];

  switch (expr.operation) {
    case "typeOf":
      return reflectTypeOf(target);

    case "fields":
      return reflectFields(target);

    case "fieldType":
      return reflectFieldType(target, args[0]);

    case "hasField":
      return reflectHasField(target, args[0]);

    case "isSubtype":
      return reflectIsSubtype(target, args[0]);

    case "typeEquals":
      return reflectTypeEquals(target, args[0]);

    case "typeTag":
      return reflectTypeTag(target);

    case "typeToString":
      return reflectTypeToString(target);
  }
}

/**
 * Type operation expression evaluation.
 * Type operations always return "now" type values.
 */
function evalTypeOp(expr: TypeOpExpr, env: Env, ctx: RefinementContext): SValue {
  const args = expr.args.map((a) => evaluate(a, env, ctx));

  switch (expr.operation) {
    case "pick":
      return typeOpPick(args[0], args[1]);

    case "omit":
      return typeOpOmit(args[0], args[1]);

    case "partial":
      return typeOpPartial(args[0]);

    case "required":
      return typeOpRequired(args[0]);

    case "merge":
      return typeOpMerge(args[0], args[1]);

    case "elementType":
      return typeOpElementType(args[0]);
  }
}
