/**
 * Builtin Registry
 *
 * Defines built-in functions that are bound in the initial environment.
 * Each builtin has a name, type signature, and evaluation handler.
 */

import { Constraint, isNumber, isString, isBool, isNull, isArray, isFunction, isObject, and, or, elements, isType, isTypeC, hasField, extractAllFieldNames, extractFieldConstraint, rec, recVar } from "./constraint";
import { Value, numberVal, stringVal, boolVal, nullVal, arrayVal, typeVal, BuiltinValue, StringValue, NumberValue, ArrayValue, ClosureValue, constraintOf, valueToString } from "./value";
import { Expr, methodCall, call, varRef } from "./expr";
import type { SValue, Now, Later } from "./svalue";
import type { RefinementContext } from "./env";

// Re-export for use by staged-evaluate
export type { SValue };

export type SEnv = { get(name: string): { svalue: SValue }; set(name: string, binding: { svalue: SValue }): SEnv };
export type SEvalResult = { svalue: SValue };

// ============================================================================
// Builtin Definition Interface
// ============================================================================

export interface BuiltinDef {
  /** Name of the builtin */
  name: string;

  /** Parameter constraints (receiver-first for methods used as functions) */
  params: ParamDef[];

  /** Compute result constraint from argument constraints */
  resultType: (argConstraints: Constraint[]) => Constraint;

  /**
   * Evaluate the builtin.
   *
   * For pure builtins: args are all Now values, return computed result.
   * For HOFs: has access to full evaluation machinery.
   */
  evaluate: BuiltinEvaluator;

  /** If true, can be used as a method (first param is receiver) */
  isMethod?: boolean;

  /** If true, accepts variable number of arguments (at least params.length) */
  variadic?: boolean;
}

export interface ParamDef {
  name: string;
  constraint: Constraint;
}

/**
 * Builtin evaluator - either pure (values only) or staged (full access).
 */
export type BuiltinEvaluator =
  | { kind: "pure"; impl: PureBuiltinImpl }
  | { kind: "staged"; handler: StagedBuiltinHandler };

/**
 * Pure builtin: takes values, returns value.
 * Used when all arguments are Now.
 */
export type PureBuiltinImpl = (args: Value[]) => Value;

/**
 * Staged builtin: has access to evaluation machinery.
 * Used for HOFs like map/filter that need to invoke closures.
 *
 * The handler receives:
 * - args: evaluated SValue arguments (Now or Later)
 * - argExprs: original argument expressions (for residual generation)
 * - evalClosure: function to invoke a closure value
 * - ctx: evaluation context
 */
export type StagedBuiltinHandler = (
  args: SValue[],
  argExprs: Expr[],
  ctx: StagedBuiltinContext
) => SEvalResult;

export interface StagedBuiltinContext {
  env: SEnv;
  refinementCtx: RefinementContext;
  /** Invoke a closure on arguments, returning staged result */
  invokeClosure: (closure: ClosureValue, args: SValue[]) => SEvalResult;
  /** Convert a Now value to an expression for residual */
  valueToExpr: (value: Value) => Expr;
  /** Create a Now SValue */
  now: (value: Value, constraint: Constraint) => Now;
  /** Create a Later SValue */
  later: (constraint: Constraint, residual: Expr) => Later;
  /** Check if SValue is Now */
  isNow: (sv: SValue) => sv is Now;
}

// ============================================================================
// Builtin Registry
// ============================================================================

const builtinRegistry: Map<string, BuiltinDef> = new Map();

export function registerBuiltin(def: BuiltinDef): void {
  builtinRegistry.set(def.name, def);
}

export function getBuiltin(name: string): BuiltinDef | undefined {
  return builtinRegistry.get(name);
}

export function getAllBuiltins(): BuiltinDef[] {
  return Array.from(builtinRegistry.values());
}

export function hasBuiltin(name: string): boolean {
  return builtinRegistry.has(name);
}

// ============================================================================
// Core Builtins: Reflection
// ============================================================================

registerBuiltin({
  name: "typeOf",
  params: [{ name: "value", constraint: { tag: "any" } }],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      // typeOf returns the constraint of the value, always at compile time
      const arg = args[0];
      const constraint = arg.constraint;
      return { svalue: ctx.now(typeVal(constraint), isType(constraint)) };
    }
  }
});

registerBuiltin({
  name: "print",
  params: [{ name: "value", constraint: { tag: "any" } }],
  resultType: () => isNull,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const arg = args[0];
      if (ctx.isNow(arg)) {
        // Print at compile time
        console.log(valueToString(arg.value));
        return { svalue: ctx.now(nullVal, isNull) };
      }
      // Generate residual print call
      return { svalue: ctx.later(isNull, call(varRef("print"), arg.residual)) };
    }
  }
});

// ============================================================================
// Core Builtins: String Operations
// ============================================================================

registerBuiltin({
  name: "startsWith",
  params: [
    { name: "str", constraint: isString },
    { name: "prefix", constraint: isString }
  ],
  resultType: () => isBool,
  isMethod: true,
  evaluate: {
    kind: "pure",
    impl: ([str, prefix]) => {
      const s = (str as StringValue).value;
      const p = (prefix as StringValue).value;
      return boolVal(s.startsWith(p));
    }
  }
});

registerBuiltin({
  name: "endsWith",
  params: [
    { name: "str", constraint: isString },
    { name: "suffix", constraint: isString }
  ],
  resultType: () => isBool,
  isMethod: true,
  evaluate: {
    kind: "pure",
    impl: ([str, suffix]) => {
      const s = (str as StringValue).value;
      const sfx = (suffix as StringValue).value;
      return boolVal(s.endsWith(sfx));
    }
  }
});

registerBuiltin({
  name: "contains",
  params: [
    { name: "str", constraint: isString },
    { name: "substr", constraint: isString }
  ],
  resultType: () => isBool,
  isMethod: true,
  evaluate: {
    kind: "pure",
    impl: ([str, substr]) => {
      const s = (str as StringValue).value;
      const sub = (substr as StringValue).value;
      return boolVal(s.includes(sub));
    }
  }
});

// ============================================================================
// Core Builtins: Array HOFs
// ============================================================================

registerBuiltin({
  name: "map",
  params: [
    { name: "arr", constraint: isArray },
    { name: "fn", constraint: isFunction }
  ],
  resultType: (argConstraints) => {
    // Result is array; element type would come from fn's return type
    // For now, just return isArray
    return isArray;
  },
  isMethod: true,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const arr = args[0];
      const fn = args[1];

      // If both are Now, try to execute at compile time
      if (ctx.isNow(arr) && ctx.isNow(fn)) {
        const arrVal = arr.value as ArrayValue;
        const fnVal = fn.value as ClosureValue;

        const results: Value[] = [];
        let allNow = true;
        for (const elem of arrVal.elements) {
          const elemSV = ctx.now(elem, constraintOf(elem));
          const result = ctx.invokeClosure(fnVal, [elemSV]);
          if (!ctx.isNow(result.svalue)) {
            // Callback returned Later - fall back to residual
            allNow = false;
            break;
          }
          results.push(result.svalue.value);
        }

        if (allNow) {
          return { svalue: ctx.now(arrayVal(results), and(isArray, elements({ tag: "any" }))) };
        }
        // Fall through to residual generation
      }

      // Generate residual - use existing residual if available to avoid inlining
      const arrResidual = ctx.isNow(arr)
        ? (arr.residual ?? ctx.valueToExpr(arr.value))
        : arr.residual;
      const fnResidual = ctx.isNow(fn)
        ? (fn.residual ?? ctx.valueToExpr(fn.value))
        : fn.residual;

      return {
        svalue: ctx.later(
          and(isArray, elements({ tag: "any" })),
          methodCall(arrResidual, "map", [fnResidual])
        )
      };
    }
  }
});

registerBuiltin({
  name: "filter",
  params: [
    { name: "arr", constraint: isArray },
    { name: "fn", constraint: isFunction }
  ],
  resultType: (argConstraints) => {
    // Filter preserves element type
    return argConstraints[0]; // Same as input array constraint
  },
  isMethod: true,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const arr = args[0];
      const fn = args[1];

      // If both are Now, try to execute at compile time
      if (ctx.isNow(arr) && ctx.isNow(fn)) {
        const arrVal = arr.value as ArrayValue;
        const fnVal = fn.value as ClosureValue;

        const results: Value[] = [];
        let allNow = true;
        for (const elem of arrVal.elements) {
          const elemSV = ctx.now(elem, constraintOf(elem));
          const result = ctx.invokeClosure(fnVal, [elemSV]);
          if (!ctx.isNow(result.svalue)) {
            // Callback returned Later - fall back to residual
            allNow = false;
            break;
          }
          if (result.svalue.value.tag === "bool" && result.svalue.value.value) {
            results.push(elem);
          }
        }

        if (allNow) {
          return { svalue: ctx.now(arrayVal(results), arr.constraint) };
        }
        // Fall through to residual generation
      }

      // Generate residual - use existing residual if available to avoid inlining
      const arrResidual = ctx.isNow(arr)
        ? (arr.residual ?? ctx.valueToExpr(arr.value))
        : arr.residual;
      const fnResidual = ctx.isNow(fn)
        ? (fn.residual ?? ctx.valueToExpr(fn.value))
        : fn.residual;

      return {
        svalue: ctx.later(
          arr.constraint,
          methodCall(arrResidual, "filter", [fnResidual])
        )
      };
    }
  }
});

// ============================================================================
// Core Builtins: Type Reflection
// ============================================================================

registerBuiltin({
  name: "fields",
  params: [{ name: "type", constraint: isTypeC }],
  resultType: () => and(isArray, elements(isString)),
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const typeArg = args[0];
      if (!ctx.isNow(typeArg)) {
        throw new Error("fields() requires a compile-time known type");
      }
      if (typeArg.value.tag !== "type") {
        throw new Error("fields() argument must be a type");
      }
      const fieldNames = extractAllFieldNames(typeArg.value.constraint);
      const fieldValues = fieldNames.map(stringVal);
      return { svalue: ctx.now(arrayVal(fieldValues), and(isArray, elements(isString))) };
    }
  }
});

registerBuiltin({
  name: "fieldType",
  params: [
    { name: "type", constraint: isTypeC },
    { name: "name", constraint: isString }
  ],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const typeArg = args[0];
      const nameArg = args[1];
      if (!ctx.isNow(typeArg)) {
        throw new Error("fieldType() requires a compile-time known type");
      }
      if (!ctx.isNow(nameArg)) {
        throw new Error("fieldType() requires a compile-time known field name");
      }
      if (typeArg.value.tag !== "type") {
        throw new Error("fieldType() first argument must be a type");
      }
      if (nameArg.value.tag !== "string") {
        throw new Error("fieldType() second argument must be a string");
      }
      const fieldConstraint = extractFieldConstraint(typeArg.value.constraint, nameArg.value.value);
      if (!fieldConstraint) {
        throw new Error(`Type has no field '${nameArg.value.value}'`);
      }
      return { svalue: ctx.now(typeVal(fieldConstraint), isType(fieldConstraint)) };
    }
  }
});

// ============================================================================
// Core Builtins: Type Constructors
// ============================================================================

registerBuiltin({
  name: "arrayType",
  params: [{ name: "elementType", constraint: isTypeC }],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const elemArg = args[0];
      if (!ctx.isNow(elemArg)) {
        throw new Error("arrayType() requires a compile-time known type");
      }
      if (elemArg.value.tag !== "type") {
        throw new Error("arrayType() argument must be a type");
      }
      const resultConstraint = and(isArray, elements(elemArg.value.constraint));
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "nullable",
  params: [{ name: "type", constraint: isTypeC }],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const typeArg = args[0];
      if (!ctx.isNow(typeArg)) {
        throw new Error("nullable() requires a compile-time known type");
      }
      if (typeArg.value.tag !== "type") {
        throw new Error("nullable() argument must be a type");
      }
      const resultConstraint = or(typeArg.value.constraint, isNull);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "objectType",
  params: [{ name: "fields", constraint: isObject }],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const objArg = args[0];
      if (!ctx.isNow(objArg)) {
        throw new Error("objectType() requires a compile-time known object");
      }
      if (objArg.value.tag !== "object") {
        throw new Error("objectType() argument must be an object");
      }
      const constraints: Constraint[] = [isObject];
      for (const [fieldName, fieldVal] of objArg.value.fields) {
        if (fieldVal.tag !== "type") {
          throw new Error(`objectType() field '${fieldName}' must be a type, got ${fieldVal.tag}`);
        }
        constraints.push(hasField(fieldName, fieldVal.constraint));
      }
      const resultConstraint = and(...constraints);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "recType",
  params: [
    { name: "varName", constraint: isString },
    { name: "bodyType", constraint: isTypeC }
  ],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const nameArg = args[0];
      const bodyArg = args[1];
      if (!ctx.isNow(nameArg)) {
        throw new Error("recType() requires a compile-time known variable name");
      }
      if (!ctx.isNow(bodyArg)) {
        throw new Error("recType() requires a compile-time known body type");
      }
      if (nameArg.value.tag !== "string") {
        throw new Error("recType() first argument must be a string");
      }
      if (bodyArg.value.tag !== "type") {
        throw new Error("recType() second argument must be a type");
      }
      const resultConstraint = rec(nameArg.value.value, bodyArg.value.constraint);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "recVarType",
  params: [{ name: "varName", constraint: isString }],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const nameArg = args[0];
      if (!ctx.isNow(nameArg)) {
        throw new Error("recVarType() requires a compile-time known variable name");
      }
      if (nameArg.value.tag !== "string") {
        throw new Error("recVarType() argument must be a string");
      }
      const resultConstraint = recVar(nameArg.value.value);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "objectTypeFromEntries",
  params: [{ name: "entries", constraint: isArray }],
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const entriesArg = args[0];
      if (!ctx.isNow(entriesArg)) {
        throw new Error("objectTypeFromEntries() requires a compile-time known entries array");
      }
      if (entriesArg.value.tag !== "array") {
        throw new Error("objectTypeFromEntries() argument must be an array");
      }
      const entries = entriesArg.value.elements;
      const constraints: Constraint[] = [isObject];
      for (const entry of entries) {
        if (entry.tag !== "array" || entry.elements.length !== 2) {
          throw new Error("objectTypeFromEntries() entries must be [name, type] pairs");
        }
        const nameVal = entry.elements[0];
        const typeValEntry = entry.elements[1];
        if (nameVal.tag !== "string") {
          throw new Error("objectTypeFromEntries() field names must be strings");
        }
        if (typeValEntry.tag !== "type") {
          throw new Error(`objectTypeFromEntries() field '${nameVal.value}' must have a type value`);
        }
        constraints.push(hasField(nameVal.value, typeValEntry.constraint));
      }
      const resultConstraint = and(...constraints);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

// ============================================================================
// Core Builtins: Array Operations
// ============================================================================

registerBuiltin({
  name: "append",
  params: [
    { name: "array", constraint: isArray },
    { name: "elem", constraint: { tag: "any" } }
  ],
  resultType: (argConstraints) => isArray,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const arrArg = args[0];
      const elemArg = args[1];
      if (!ctx.isNow(arrArg)) {
        throw new Error("append() requires a compile-time known array");
      }
      if (!ctx.isNow(elemArg)) {
        throw new Error("append() requires a compile-time known element");
      }
      if (arrArg.value.tag !== "array") {
        throw new Error("append() first argument must be an array");
      }
      const newElements = [...arrArg.value.elements, elemArg.value];
      const resultConstraint = and(isArray, elements(elemArg.constraint));
      return { svalue: ctx.now(arrayVal(newElements), resultConstraint) };
    }
  }
});

registerBuiltin({
  name: "comptimeFold",
  params: [
    { name: "array", constraint: isArray },
    { name: "init", constraint: { tag: "any" } },
    { name: "fn", constraint: isFunction }
  ],
  resultType: () => ({ tag: "any" }),
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const arrArg = args[0];
      const initArg = args[1];
      const fnArg = args[2];

      if (!ctx.isNow(arrArg)) {
        throw new Error("comptimeFold() requires a compile-time known array");
      }
      if (!ctx.isNow(fnArg)) {
        throw new Error("comptimeFold() requires a compile-time known function");
      }
      if (arrArg.value.tag !== "array") {
        throw new Error("comptimeFold() first argument must be an array");
      }
      if (fnArg.value.tag !== "closure") {
        throw new Error("comptimeFold() third argument must be a function");
      }

      const arr = arrArg.value;
      const fn = fnArg.value as ClosureValue;

      // With desugaring, all functions use args array - no param count check needed
      // The function should destructure args to get (acc, elem)

      // Iterate and fold
      let acc: SValue = initArg;

      for (const elem of arr.elements) {
        const elemSV = ctx.now(elem, constraintOf(elem));
        const result = ctx.invokeClosure(fn, [acc, elemSV]);
        acc = result.svalue;
      }

      return { svalue: acc };
    }
  }
});

registerBuiltin({
  name: "unionType",
  params: [
    { name: "type1", constraint: isTypeC },
    { name: "type2", constraint: isTypeC }
  ],
  variadic: true,
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const constraints: Constraint[] = [];
      for (let i = 0; i < args.length; i++) {
        const typeArg = args[i];
        if (!ctx.isNow(typeArg)) {
          throw new Error(`unionType() argument ${i + 1} must be compile-time known`);
        }
        if (typeArg.value.tag !== "type") {
          throw new Error(`unionType() argument ${i + 1} must be a type`);
        }
        constraints.push(typeArg.value.constraint);
      }
      const resultConstraint = or(...constraints);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "intersectionType",
  params: [
    { name: "type1", constraint: isTypeC },
    { name: "type2", constraint: isTypeC }
  ],
  variadic: true,
  resultType: () => isTypeC,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const constraints: Constraint[] = [];
      for (let i = 0; i < args.length; i++) {
        const typeArg = args[i];
        if (!ctx.isNow(typeArg)) {
          throw new Error(`intersectionType() argument ${i + 1} must be compile-time known`);
        }
        if (typeArg.value.tag !== "type") {
          throw new Error(`intersectionType() argument ${i + 1} must be a type`);
        }
        constraints.push(typeArg.value.constraint);
      }
      const resultConstraint = and(...constraints);
      return { svalue: ctx.now(typeVal(resultConstraint), isType(resultConstraint)) };
    }
  }
});

registerBuiltin({
  name: "objectFromEntries",
  params: [{ name: "entries", constraint: isArray }],
  resultType: () => isObject,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const entriesArg = args[0];

      if (!ctx.isNow(entriesArg)) {
        throw new Error("objectFromEntries() requires a compile-time known entries array");
      }
      if (entriesArg.value.tag !== "array") {
        throw new Error("objectFromEntries() argument must be an array");
      }

      const entries = entriesArg.value.elements;
      const fieldConstraints: Constraint[] = [isObject];
      const fields: Map<string, Value> = new Map();

      for (const entry of entries) {
        if (entry.tag !== "array" || entry.elements.length !== 2) {
          throw new Error("objectFromEntries() entries must be [key, value] pairs");
        }

        const keyVal = entry.elements[0];
        const valueVal = entry.elements[1];

        if (keyVal.tag !== "string") {
          throw new Error("objectFromEntries() keys must be strings");
        }

        const key = keyVal.value;
        fields.set(key, valueVal);
        fieldConstraints.push(hasField(key, constraintOf(valueVal)));
      }

      const constraint = and(...fieldConstraints);
      const objValue: Value = { tag: "object", fields };
      return { svalue: ctx.now(objValue, constraint) };
    }
  }
});

// ============================================================================
// Core Builtins: Object Operations
// ============================================================================

registerBuiltin({
  name: "dynamicField",
  params: [
    { name: "obj", constraint: isObject },
    { name: "fieldName", constraint: isString }
  ],
  resultType: () => ({ tag: "any" }),
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const objArg = args[0];
      const nameArg = args[1];
      if (!ctx.isNow(nameArg)) {
        throw new Error("dynamicField() requires a compile-time known field name");
      }
      if (nameArg.value.tag !== "string") {
        throw new Error("dynamicField() second argument must be a string");
      }
      const fieldName = nameArg.value.value;
      if (ctx.isNow(objArg)) {
        if (objArg.value.tag !== "object") {
          throw new Error("dynamicField() first argument must be an object");
        }
        const fieldValue = objArg.value.fields.get(fieldName);
        if (fieldValue === undefined) {
          throw new Error(`Object has no field '${fieldName}'`);
        }
        return { svalue: ctx.now(fieldValue, constraintOf(fieldValue)) };
      } else {
        // Object is Later - generate residual field access
        const fieldConstraint = extractFieldConstraint(objArg.constraint, fieldName) || { tag: "any" as const };
        return {
          svalue: ctx.later(fieldConstraint, { tag: "field" as const, object: objArg.residual, name: fieldName } as Expr)
        };
      }
    }
  }
});

// ============================================================================
// Exported for initial environment setup
// ============================================================================

export { builtinRegistry };
