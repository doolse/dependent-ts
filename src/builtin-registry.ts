/**
 * Builtin Registry
 *
 * Defines built-in functions that are bound in the initial environment.
 * Each builtin has a name, type signature, and evaluation handler.
 */

import { Constraint, isNumber, isString, isBool, isNull, isArray, isFunction, and, or, elements, fnType, isType, isTypeC } from "./constraint";
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

      // If both are Now, execute at compile time
      if (ctx.isNow(arr) && ctx.isNow(fn)) {
        const arrVal = arr.value as ArrayValue;
        const fnVal = fn.value as ClosureValue;

        const results: Value[] = [];
        for (const elem of arrVal.elements) {
          const elemSV = ctx.now(elem, constraintOf(elem));
          const result = ctx.invokeClosure(fnVal, [elemSV]);
          if (!ctx.isNow(result.svalue)) {
            throw new Error("map callback returned Later value on Now input");
          }
          results.push(result.svalue.value);
        }

        return { svalue: ctx.now(arrayVal(results), and(isArray, elements({ tag: "any" }))) };
      }

      // Generate residual
      const arrResidual = ctx.isNow(arr) ? ctx.valueToExpr(arr.value) : arr.residual;
      const fnResidual = ctx.isNow(fn) ? ctx.valueToExpr(fn.value) : fn.residual;

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

      // If both are Now, execute at compile time
      if (ctx.isNow(arr) && ctx.isNow(fn)) {
        const arrVal = arr.value as ArrayValue;
        const fnVal = fn.value as ClosureValue;

        const results: Value[] = [];
        for (const elem of arrVal.elements) {
          const elemSV = ctx.now(elem, constraintOf(elem));
          const result = ctx.invokeClosure(fnVal, [elemSV]);
          if (!ctx.isNow(result.svalue)) {
            throw new Error("filter callback returned Later value on Now input");
          }
          if (result.svalue.value.tag === "bool" && result.svalue.value.value) {
            results.push(elem);
          }
        }

        return { svalue: ctx.now(arrayVal(results), arr.constraint) };
      }

      // Generate residual
      const arrResidual = ctx.isNow(arr) ? ctx.valueToExpr(arr.value) : arr.residual;
      const fnResidual = ctx.isNow(fn) ? ctx.valueToExpr(fn.value) : fn.residual;

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
// Exported for initial environment setup
// ============================================================================

export { builtinRegistry };
