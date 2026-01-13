/**
 * Compile-time Evaluator - fuel-limited interpreter for comptime execution.
 *
 * Evaluates expressions at compile time to compute Type values,
 * assert conditions, and other comptime computations.
 */

import { Type } from "../types/types";
import { isSubtype } from "../types/subtype";
import { formatType } from "../types/format";
import {
  CoreExpr,
  CoreDecl,
  CoreRecordField,
  CoreArrayElement,
  CoreCase,
  CoreTemplatePart,
  CorePattern,
  BinaryOp,
  UnaryOp,
  CompileError,
  SourceLocation,
} from "../ast/core-ast";
import { TypeEnv } from "./type-env";
import {
  ComptimeEnv,
  ComptimeValue,
  ComptimeRecord,
  ComptimeClosure,
  ComptimeBuiltin,
  ComptimeEvaluatorInterface,
  isTypeValue,
  isClosureValue,
  isBuiltinValue,
  isRecordValue,
} from "./comptime-env";
import { getTypeProperty } from "./type-properties";

/**
 * Fuel-limited compile-time evaluator.
 */
export class ComptimeEvaluator implements ComptimeEvaluatorInterface {
  private fuel: number;
  private readonly maxFuel: number;

  constructor(maxFuel: number = 10000) {
    this.maxFuel = maxFuel;
    this.fuel = maxFuel;
  }

  /**
   * Evaluate an expression at compile time.
   */
  evaluate(
    expr: CoreExpr,
    comptimeEnv: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeValue {
    if (--this.fuel <= 0) {
      throw new CompileError(
        "Compile-time evaluation exceeded fuel limit. " +
          "This may indicate an infinite loop or overly complex computation.",
        "typecheck",
        expr.loc
      );
    }

    switch (expr.kind) {
      case "literal":
        return expr.value;

      case "identifier":
        return comptimeEnv.getValue(expr.name, this, expr.loc);

      case "binary":
        return this.evalBinary(expr.op, expr.left, expr.right, comptimeEnv, typeEnv, expr.loc);

      case "unary":
        return this.evalUnary(expr.op, expr.operand, comptimeEnv, typeEnv, expr.loc);

      case "call":
        return this.evalCall(expr.fn, expr.args, comptimeEnv, typeEnv, expr.loc);

      case "property":
        return this.evalProperty(expr.object, expr.name, comptimeEnv, typeEnv, expr.loc);

      case "index":
        return this.evalIndex(expr.object, expr.index, comptimeEnv, typeEnv, expr.loc);

      case "lambda":
        return this.evalLambda(expr, comptimeEnv, typeEnv);

      case "conditional":
        return this.evalConditional(
          expr.condition,
          expr.then,
          expr.else,
          comptimeEnv,
          typeEnv
        );

      case "record":
        return this.evalRecord(expr.fields, comptimeEnv, typeEnv);

      case "array":
        return this.evalArray(expr.elements, comptimeEnv, typeEnv);

      case "block":
        return this.evalBlock(expr.statements, expr.result, comptimeEnv, typeEnv);

      case "match":
        return this.evalMatch(expr.expr, expr.cases, comptimeEnv, typeEnv, expr.loc);

      case "throw":
        throw new CompileError(
          `Uncaught exception at compile time: ${this.evaluate(expr.expr, comptimeEnv, typeEnv)}`,
          "typecheck",
          expr.loc
        );

      case "await":
        throw new CompileError(
          "Cannot use 'await' in compile-time evaluation",
          "typecheck",
          expr.loc
        );

      case "template":
        return this.evalTemplate(expr.parts, comptimeEnv, typeEnv);
    }
  }

  /**
   * Reset fuel for a new evaluation.
   */
  reset(): void {
    this.fuel = this.maxFuel;
  }

  /**
   * Get remaining fuel.
   */
  getRemainingFuel(): number {
    return this.fuel;
  }

  // ============================================
  // Private evaluation methods
  // ============================================

  private evalBinary(
    op: BinaryOp,
    left: CoreExpr,
    right: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const l = this.evaluate(left, env, typeEnv);
    const r = this.evaluate(right, env, typeEnv);

    // Type coercion helpers
    const asNum = (v: ComptimeValue): number => {
      if (typeof v !== "number") {
        throw new CompileError(
          `Expected number in binary operation, got ${typeof v}`,
          "typecheck",
          loc
        );
      }
      return v;
    };

    switch (op) {
      case "+":
        if (typeof l === "string" || typeof r === "string") {
          return String(l) + String(r);
        }
        return asNum(l) + asNum(r);
      case "-":
        return asNum(l) - asNum(r);
      case "*":
        return asNum(l) * asNum(r);
      case "/":
        return asNum(l) / asNum(r);
      case "%":
        return asNum(l) % asNum(r);
      case "==":
        return comptimeEquals(l, r);
      case "!=":
        return !comptimeEquals(l, r);
      case "<":
        return asNum(l) < asNum(r);
      case ">":
        return asNum(l) > asNum(r);
      case "<=":
        return asNum(l) <= asNum(r);
      case ">=":
        return asNum(l) >= asNum(r);
      case "&&":
        return l && r;
      case "||":
        return l || r;
      case "|":
        return asNum(l) | asNum(r);
      case "&":
        return asNum(l) & asNum(r);
      case "^":
        return asNum(l) ^ asNum(r);
    }
  }

  private evalUnary(
    op: UnaryOp,
    operand: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const v = this.evaluate(operand, env, typeEnv);

    switch (op) {
      case "!":
        return !v;
      case "-":
        if (typeof v !== "number") {
          throw new CompileError(
            `Cannot negate non-number at compile time`,
            "typecheck",
            loc
          );
        }
        return -v;
      case "~":
        if (typeof v !== "number") {
          throw new CompileError(
            `Cannot bitwise-not non-number at compile time`,
            "typecheck",
            loc
          );
        }
        return ~v;
    }
  }

  private evalCall(
    fnExpr: CoreExpr,
    args: CoreExpr[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const fn = this.evaluate(fnExpr, env, typeEnv);

    if (isClosureValue(fn)) {
      return this.applyClosure(fn, args, env, typeEnv, loc);
    }

    if (isBuiltinValue(fn)) {
      const evaluatedArgs = args.map((a) => this.evaluate(a, env, typeEnv));
      return fn.impl(evaluatedArgs, this, loc);
    }

    // Special case: Type(Bound) creates a bounded type constraint
    // Type is the primitive type, but can be "called" to create Type<Bound>
    if (
      isTypeValue(fn) &&
      fn.kind === "primitive" &&
      fn.name === "Type"
    ) {
      if (args.length === 0) {
        // Type() with no args returns unbounded Type
        return fn;
      }
      const bound = this.evaluate(args[0], env, typeEnv);
      if (!isTypeValue(bound)) {
        throw new CompileError(
          "Type argument must be a Type",
          "typecheck",
          loc
        );
      }
      // Return a boundedType
      return { kind: "boundedType", bound: bound as Type };
    }

    throw new CompileError(
      `Cannot call non-function at compile time`,
      "typecheck",
      loc
    );
  }

  private applyClosure(
    closure: ComptimeClosure,
    args: CoreExpr[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const newEnv = closure.env.extend();
    const newTypeEnv = closure.typeEnv.extend();

    for (let i = 0; i < closure.params.length; i++) {
      const param = closure.params[i];
      let argValue: ComptimeValue;

      if (i < args.length) {
        argValue = this.evaluate(args[i], env, typeEnv);
      } else if (param.defaultValue) {
        argValue = this.evaluate(param.defaultValue, closure.env, closure.typeEnv);
      } else {
        throw new CompileError(
          `Missing argument for parameter '${param.name}'`,
          "typecheck",
          loc
        );
      }

      // Check bounded type constraints (generic constraints)
      // If param has type Type<Bound> and argValue is a Type, check constraint
      if (param.type?.kind === "boundedType" && isTypeValue(argValue)) {
        const argType = argValue as Type;
        if (!isSubtype(argType, param.type.bound)) {
          throw new CompileError(
            `Type '${formatType(argType)}' does not satisfy constraint '${formatType(param.type.bound)}'`,
            "typecheck",
            loc
          );
        }
      }

      newEnv.defineEvaluated(param.name, argValue);
    }

    return this.evaluate(closure.body, newEnv, newTypeEnv);
  }

  /**
   * Call a closure with pre-evaluated arguments.
   * Used by builtins (like array methods) that need to invoke user callbacks.
   */
  applyClosureWithValues(
    closure: ComptimeClosure,
    args: ComptimeValue[],
    loc?: SourceLocation
  ): ComptimeValue {
    const newEnv = closure.env.extend();
    const newTypeEnv = closure.typeEnv.extend();

    for (let i = 0; i < closure.params.length; i++) {
      const param = closure.params[i];
      let argValue: ComptimeValue;

      if (i < args.length) {
        argValue = args[i];
      } else if (param.defaultValue) {
        argValue = this.evaluate(param.defaultValue, closure.env, closure.typeEnv);
      } else {
        throw new CompileError(
          `Missing argument for parameter '${param.name}'`,
          "typecheck",
          loc
        );
      }

      // Check bounded type constraints (generic constraints)
      if (param.type?.kind === "boundedType" && isTypeValue(argValue)) {
        const argType = argValue as Type;
        if (!isSubtype(argType, param.type.bound)) {
          throw new CompileError(
            `Type '${formatType(argType)}' does not satisfy constraint '${formatType(param.type.bound)}'`,
            "typecheck",
            loc
          );
        }
      }

      newEnv.defineEvaluated(param.name, argValue);
    }

    return this.evaluate(closure.body, newEnv, newTypeEnv);
  }

  private evalProperty(
    objectExpr: CoreExpr,
    name: string,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const obj = this.evaluate(objectExpr, env, typeEnv);

    // Type property access
    if (isTypeValue(obj)) {
      return getTypeProperty(obj, name, this, loc);
    }

    // Array properties and methods
    if (Array.isArray(obj)) {
      if (name === "length") {
        return obj.length;
      }
      const method = getArrayMethod(obj, name, loc);
      if (method) return method;
    }

    // Record property access
    if (isRecordValue(obj)) {
      const value = obj[name];
      if (value === undefined && !(name in obj)) {
        throw new CompileError(
          `Property '${name}' does not exist`,
          "typecheck",
          loc
        );
      }
      return value;
    }

    // String length
    if (typeof obj === "string" && name === "length") {
      return obj.length;
    }

    throw new CompileError(
      `Cannot access property '${name}' on ${typeof obj} at compile time`,
      "typecheck",
      loc
    );
  }

  private evalIndex(
    objectExpr: CoreExpr,
    indexExpr: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const obj = this.evaluate(objectExpr, env, typeEnv);
    const index = this.evaluate(indexExpr, env, typeEnv);

    if (Array.isArray(obj)) {
      if (typeof index !== "number") {
        throw new CompileError(
          `Array index must be a number`,
          "typecheck",
          loc
        );
      }
      return obj[index];
    }

    if (typeof obj === "string") {
      if (typeof index !== "number") {
        throw new CompileError(
          `String index must be a number`,
          "typecheck",
          loc
        );
      }
      return obj[index];
    }

    if (isRecordValue(obj)) {
      if (typeof index !== "string") {
        throw new CompileError(
          `Record index must be a string`,
          "typecheck",
          loc
        );
      }
      return obj[index];
    }

    throw new CompileError(
      `Cannot index into ${typeof obj} at compile time`,
      "typecheck",
      loc
    );
  }

  private evalLambda(
    expr: CoreExpr & { kind: "lambda" },
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeClosure {
    return {
      kind: "closure",
      params: expr.params.map((p) => ({
        name: p.name,
        // Evaluate type annotation if present to get the Type value (for constraint checking)
        type: p.type ? (this.evaluate(p.type, env, typeEnv) as Type) : undefined,
        defaultValue: p.defaultValue,
      })),
      body: expr.body,
      env,
      typeEnv,
    };
  }

  private evalConditional(
    condition: CoreExpr,
    thenExpr: CoreExpr,
    elseExpr: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeValue {
    const cond = this.evaluate(condition, env, typeEnv);
    return cond
      ? this.evaluate(thenExpr, env, typeEnv)
      : this.evaluate(elseExpr, env, typeEnv);
  }

  private evalRecord(
    fields: CoreRecordField[],
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeRecord {
    const result: ComptimeRecord = {};

    for (const field of fields) {
      if (field.kind === "field") {
        result[field.name] = this.evaluate(field.value, env, typeEnv);
      } else if (field.kind === "spread") {
        const spreadObj = this.evaluate(field.expr, env, typeEnv);
        if (!isRecordValue(spreadObj)) {
          throw new CompileError(
            `Cannot spread non-record in compile-time evaluation`,
            "typecheck",
            field.expr.loc
          );
        }
        Object.assign(result, spreadObj);
      }
    }

    return result;
  }

  private evalArray(
    elements: CoreArrayElement[],
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeValue[] {
    const result: ComptimeValue[] = [];

    for (const element of elements) {
      if (element.kind === "element") {
        result.push(this.evaluate(element.value, env, typeEnv));
      } else if (element.kind === "spread") {
        const spreadArr = this.evaluate(element.expr, env, typeEnv);
        if (!Array.isArray(spreadArr)) {
          throw new CompileError(
            `Cannot spread non-array in compile-time evaluation`,
            "typecheck",
            element.expr.loc
          );
        }
        result.push(...spreadArr);
      }
    }

    return result;
  }

  private evalBlock(
    statements: CoreDecl[],
    result: CoreExpr | undefined,
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeValue {
    const blockEnv = env.extend();
    const blockTypeEnv = typeEnv.extend();

    for (const stmt of statements) {
      if (stmt.kind === "const") {
        const value = this.evaluate(stmt.init, blockEnv, blockTypeEnv);
        blockEnv.defineEvaluated(stmt.name, value);
      } else if (stmt.kind === "expr") {
        // Execute for side effects
        this.evaluate(stmt.expr, blockEnv, blockTypeEnv);
      }
      // Ignore imports in comptime blocks
    }

    if (result) {
      return this.evaluate(result, blockEnv, blockTypeEnv);
    }

    return undefined;
  }

  private evalMatch(
    exprToMatch: CoreExpr,
    cases: CoreCase[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): ComptimeValue {
    const value = this.evaluate(exprToMatch, env, typeEnv);

    for (const c of cases) {
      const bindings = matchPattern(c.pattern, value);
      if (bindings !== null) {
        // Check guard if present
        if (c.guard) {
          const guardEnv = env.extend();
          for (const [name, val] of Object.entries(bindings)) {
            guardEnv.defineEvaluated(name, val);
          }
          const guardResult = this.evaluate(c.guard, guardEnv, typeEnv);
          if (!guardResult) continue;
        }

        // Pattern matched - evaluate body with bindings
        const bodyEnv = env.extend();
        for (const [name, val] of Object.entries(bindings)) {
          bodyEnv.defineEvaluated(name, val);
        }
        return this.evaluate(c.body, bodyEnv, typeEnv);
      }
    }

    throw new CompileError(
      `No pattern matched in compile-time match expression`,
      "typecheck",
      loc
    );
  }

  private evalTemplate(
    parts: CoreTemplatePart[],
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): string {
    let result = "";

    for (const part of parts) {
      if (part.kind === "string") {
        result += part.value;
      } else {
        const value = this.evaluate(part.expr, env, typeEnv);
        result += String(value);
      }
    }

    return result;
  }
}

// ============================================
// Array method factories
// ============================================

/**
 * Call a callback function (closure or builtin) with arguments.
 */
function callCallback(
  fn: ComptimeValue,
  args: ComptimeValue[],
  evaluator: ComptimeEvaluatorInterface,
  loc?: SourceLocation
): ComptimeValue {
  if (isClosureValue(fn)) {
    return evaluator.applyClosureWithValues(fn, args, loc);
  }
  if (isBuiltinValue(fn)) {
    return fn.impl(args, evaluator, loc);
  }
  throw new CompileError(
    `Expected function in array method callback, got ${typeof fn}`,
    "typecheck",
    loc
  );
}

/**
 * Get an array method as a builtin function.
 */
function getArrayMethod(
  arr: ComptimeValue[],
  name: string,
  loc?: SourceLocation
): ComptimeBuiltin | undefined {
  switch (name) {
    case "map":
      return {
        kind: "builtin",
        name: "Array.map",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.map requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          return arr.map((element, index) =>
            callCallback(fn, [element, index, arr], evaluator, callLoc ?? loc)
          );
        },
      };

    case "filter":
      return {
        kind: "builtin",
        name: "Array.filter",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.filter requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          return arr.filter((element, index) => {
            const result = callCallback(fn, [element, index, arr], evaluator, callLoc ?? loc);
            return !!result;
          });
        },
      };

    case "includes":
      return {
        kind: "builtin",
        name: "Array.includes",
        impl: (args, _evaluator, callLoc) => {
          const searchElement = args[0];
          return arr.some((element) => comptimeEquals(element, searchElement));
        },
      };

    case "find":
      return {
        kind: "builtin",
        name: "Array.find",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.find requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          for (let i = 0; i < arr.length; i++) {
            const element = arr[i];
            const result = callCallback(fn, [element, i, arr], evaluator, callLoc ?? loc);
            if (result) return element;
          }
          return undefined;
        },
      };

    case "findIndex":
      return {
        kind: "builtin",
        name: "Array.findIndex",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.findIndex requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          for (let i = 0; i < arr.length; i++) {
            const result = callCallback(fn, [arr[i], i, arr], evaluator, callLoc ?? loc);
            if (result) return i;
          }
          return -1;
        },
      };

    case "some":
      return {
        kind: "builtin",
        name: "Array.some",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.some requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          return arr.some((element, index) => {
            const result = callCallback(fn, [element, index, arr], evaluator, callLoc ?? loc);
            return !!result;
          });
        },
      };

    case "every":
      return {
        kind: "builtin",
        name: "Array.every",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.every requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          return arr.every((element, index) => {
            const result = callCallback(fn, [element, index, arr], evaluator, callLoc ?? loc);
            return !!result;
          });
        },
      };

    case "reduce":
      return {
        kind: "builtin",
        name: "Array.reduce",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.reduce requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          let accumulator: ComptimeValue;
          let startIndex: number;
          if (args.length > 1) {
            accumulator = args[1];
            startIndex = 0;
          } else {
            if (arr.length === 0) {
              throw new CompileError(
                "Array.reduce on empty array requires initial value",
                "typecheck",
                callLoc ?? loc
              );
            }
            accumulator = arr[0];
            startIndex = 1;
          }
          for (let i = startIndex; i < arr.length; i++) {
            accumulator = callCallback(
              fn,
              [accumulator, arr[i], i, arr],
              evaluator,
              callLoc ?? loc
            );
          }
          return accumulator;
        },
      };

    case "concat":
      return {
        kind: "builtin",
        name: "Array.concat",
        impl: (args, _evaluator, _callLoc) => {
          const result = [...arr];
          for (const arg of args) {
            if (Array.isArray(arg)) {
              result.push(...arg);
            } else {
              result.push(arg);
            }
          }
          return result;
        },
      };

    case "slice":
      return {
        kind: "builtin",
        name: "Array.slice",
        impl: (args, _evaluator, callLoc) => {
          const start = args[0] as number | undefined;
          const end = args[1] as number | undefined;
          return arr.slice(start, end);
        },
      };

    case "indexOf":
      return {
        kind: "builtin",
        name: "Array.indexOf",
        impl: (args, _evaluator, _callLoc) => {
          const searchElement = args[0];
          const fromIndex = (args[1] as number | undefined) ?? 0;
          for (let i = fromIndex; i < arr.length; i++) {
            if (comptimeEquals(arr[i], searchElement)) {
              return i;
            }
          }
          return -1;
        },
      };

    case "join":
      return {
        kind: "builtin",
        name: "Array.join",
        impl: (args, _evaluator, _callLoc) => {
          const separator = (args[0] as string | undefined) ?? ",";
          return arr.map((v) => String(v)).join(separator);
        },
      };

    case "flat":
      return {
        kind: "builtin",
        name: "Array.flat",
        impl: (args, _evaluator, _callLoc) => {
          const depth = (args[0] as number | undefined) ?? 1;
          const flatten = (arr: ComptimeValue[], d: number): ComptimeValue[] => {
            if (d <= 0) return arr;
            const result: ComptimeValue[] = [];
            for (const item of arr) {
              if (Array.isArray(item)) {
                result.push(...flatten(item, d - 1));
              } else {
                result.push(item);
              }
            }
            return result;
          };
          return flatten(arr, depth);
        },
      };

    case "flatMap":
      return {
        kind: "builtin",
        name: "Array.flatMap",
        impl: (args, evaluator, callLoc) => {
          const fn = args[0];
          if (fn === undefined) {
            throw new CompileError(
              "Array.flatMap requires a callback function",
              "typecheck",
              callLoc ?? loc
            );
          }
          const result: ComptimeValue[] = [];
          for (let i = 0; i < arr.length; i++) {
            const mapped = callCallback(fn, [arr[i], i, arr], evaluator, callLoc ?? loc);
            if (Array.isArray(mapped)) {
              result.push(...mapped);
            } else {
              result.push(mapped);
            }
          }
          return result;
        },
      };

    default:
      return undefined;
  }
}

/**
 * Check equality of comptime values.
 */
export function comptimeEquals(a: ComptimeValue, b: ComptimeValue): boolean {
  // Primitives
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => comptimeEquals(v, b[i]));
  }

  // Records (plain objects)
  if (isRecordValue(a) && isRecordValue(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => comptimeEquals(a[k], b[k]));
  }

  // Types
  if (isTypeValue(a) && isTypeValue(b)) {
    // Use structural equality from subtype module
    // For now, simple comparison
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

/**
 * Match a pattern against a value, returning bindings or null if no match.
 */
function matchPattern(
  pattern: CorePattern,
  value: ComptimeValue
): Record<string, ComptimeValue> | null {
  switch (pattern.kind) {
    case "wildcard":
      return {};

    case "literal":
      if (comptimeEquals(value, pattern.value as ComptimeValue)) {
        return {};
      }
      return null;

    case "binding": {
      if (pattern.pattern) {
        const nestedBindings = matchPattern(pattern.pattern, value);
        if (nestedBindings === null) return null;
        return { [pattern.name]: value, ...nestedBindings };
      }
      return { [pattern.name]: value };
    }

    case "destructure": {
      if (!isRecordValue(value)) return null;
      const bindings: Record<string, ComptimeValue> = {};

      for (const field of pattern.fields) {
        const fieldValue = value[field.name];
        if (fieldValue === undefined && !(field.name in value)) {
          return null;
        }

        if (field.pattern) {
          const nestedBindings = matchPattern(field.pattern, fieldValue);
          if (nestedBindings === null) return null;
          Object.assign(bindings, nestedBindings);
        } else {
          const bindName = field.binding ?? field.name;
          bindings[bindName] = fieldValue;
        }
      }

      return bindings;
    }

    case "type":
      // Type patterns need type information - handled by type checker
      // For comptime eval, we can't easily check this
      return null;
  }
}
