/**
 * Compile-time Environment - tracks values for compile-time evaluation.
 *
 * Key features:
 * - Lazy evaluation: values are computed on first access
 * - Cycle detection: detects circular dependencies
 * - Caching: evaluated values are cached
 * - TypedComptimeValue: Every comptime value carries its type for easy type introspection
 */

import { Type, primitiveType } from "../types/types";
import { CoreExpr, CompileError, SourceLocation } from "../ast/core-ast";
import { TypeEnv } from "./type-env";

/**
 * Raw comptime values - the underlying value without type information.
 * Used internally; most code should work with TypedComptimeValue.
 */
export type RawComptimeValue =
  | Type // Type values (when the value IS a Type)
  | string
  | number
  | boolean
  | null
  | undefined
  | RawComptimeValue[] // Arrays
  | RawComptimeRecord // Records
  | ComptimeClosure // User-defined functions
  | ComptimeBuiltin; // Built-in functions

// Using a branded type pattern to distinguish plain records from Type values
export type RawComptimeRecord = { [key: string]: RawComptimeValue } & { __comptimeRecord?: true };

/**
 * TypedComptimeValue - a value paired with its type.
 * This is the main type used throughout the comptime evaluator.
 * Every comptime value knows its type, making typeOf trivial.
 */
export type TypedComptimeValue = {
  value: RawComptimeValue;
  type: Type;
};

/**
 * A closure captured during comptime evaluation.
 * The closure captures its lexical environment and knows its function type.
 */
export type ComptimeClosure = {
  kind: "closure";
  params: { name: string; type?: Type; defaultValue?: CoreExpr }[];
  body: CoreExpr;
  env: ComptimeEnv;
  typeEnv: TypeEnv;
  fnType: Type; // The function type of this closure
};

/**
 * A built-in function implemented in TypeScript.
 */
export type ComptimeBuiltin = {
  kind: "builtin";
  name: string;
  impl: BuiltinImpl;
  fnType?: Type; // Optional function type for the builtin
};

/**
 * Implementation of a built-in function.
 * Receives TypedComptimeValue arguments and returns a TypedComptimeValue.
 */
export type BuiltinImpl = (
  args: TypedComptimeValue[],
  evaluator: ComptimeEvaluatorInterface,
  loc?: SourceLocation
) => TypedComptimeValue;

/**
 * Interface for the comptime evaluator (to avoid circular deps).
 */
export interface ComptimeEvaluatorInterface {
  evaluate(
    expr: CoreExpr,
    comptimeEnv: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue;

  /**
   * Call a closure with pre-evaluated arguments.
   * Used by builtins (like array methods) that need to invoke user callbacks.
   */
  applyClosureWithValues(
    closure: ComptimeClosure,
    args: TypedComptimeValue[],
    loc?: SourceLocation
  ): TypedComptimeValue;
}

/**
 * Entry in the comptime environment.
 * Stores TypedComptimeValue when evaluated.
 */
export type ComptimeEntry =
  | { status: "unevaluated"; expr: CoreExpr; typeEnv: TypeEnv }
  | { status: "evaluating" } // For cycle detection
  | { status: "evaluated"; value: TypedComptimeValue }
  | { status: "unavailable" }; // Cannot be evaluated at comptime

/**
 * Compile-time environment with lazy evaluation and cycle detection.
 */
export class ComptimeEnv {
  private entries: Map<string, ComptimeEntry>;
  private parent: ComptimeEnv | null;

  constructor(parent: ComptimeEnv | null = null) {
    this.entries = new Map();
    this.parent = parent;
  }

  /**
   * Get a value, evaluating lazily if needed.
   * Returns TypedComptimeValue containing both the value and its type.
   */
  getValue(
    name: string,
    evaluator: ComptimeEvaluatorInterface,
    loc?: SourceLocation
  ): TypedComptimeValue {
    const entry = this.getEntry(name);

    if (!entry) {
      throw new CompileError(
        `'${name}' is not defined in comptime context`,
        "typecheck",
        loc
      );
    }

    switch (entry.status) {
      case "evaluated":
        return entry.value;

      case "evaluating":
        throw new CompileError(
          `Circular dependency detected when evaluating '${name}'`,
          "typecheck",
          loc
        );

      case "unavailable":
        throw new CompileError(
          `'${name}' is not available at compile time`,
          "typecheck",
          loc
        );

      case "unevaluated": {
        // Mark as evaluating (cycle detection)
        this.setEntryInOwner(name, { status: "evaluating" });

        try {
          const value = evaluator.evaluate(entry.expr, this, entry.typeEnv);
          this.setEntryInOwner(name, { status: "evaluated", value });
          return value;
        } catch (e) {
          // Mark as unavailable on failure
          this.setEntryInOwner(name, { status: "unavailable" });
          throw e;
        }
      }
    }
  }

  /**
   * Check if a value is available without evaluating it.
   */
  hasValue(name: string): boolean {
    const entry = this.getEntry(name);
    return entry !== undefined && entry.status !== "unavailable";
  }

  /**
   * Get an already-evaluated value, or undefined if not evaluated yet.
   * Returns TypedComptimeValue containing both the value and its type.
   */
  getEvaluatedValue(name: string): TypedComptimeValue | undefined {
    const entry = this.getEntry(name);
    if (entry?.status === "evaluated") {
      return entry.value;
    }
    return undefined;
  }

  /**
   * Define a binding as unevaluated (lazy).
   */
  defineUnevaluated(name: string, expr: CoreExpr, typeEnv: TypeEnv): void {
    this.entries.set(name, { status: "unevaluated", expr, typeEnv });
  }

  /**
   * Define a binding with an already-evaluated typed value.
   */
  defineEvaluated(name: string, value: TypedComptimeValue): void {
    this.entries.set(name, { status: "evaluated", value });
  }

  /**
   * Mark a binding as unavailable at comptime.
   */
  defineUnavailable(name: string): void {
    this.entries.set(name, { status: "unavailable" });
  }

  /**
   * Create a child scope.
   */
  extend(): ComptimeEnv {
    return new ComptimeEnv(this);
  }

  /**
   * Get all entries in this scope (not including parent).
   */
  getOwnEntries(): Map<string, ComptimeEntry> {
    return new Map(this.entries);
  }

  /**
   * Get entry from this scope or parent.
   */
  private getEntry(name: string): ComptimeEntry | undefined {
    const entry = this.entries.get(name);
    if (entry) return entry;
    return this.parent?.getEntry(name);
  }

  /**
   * Set entry in the scope that owns it.
   */
  private setEntryInOwner(name: string, entry: ComptimeEntry): void {
    if (this.entries.has(name)) {
      this.entries.set(name, entry);
    } else if (this.parent) {
      this.parent.setEntryInOwner(name, entry);
    } else {
      // Shouldn't happen if getEntry found it
      this.entries.set(name, entry);
    }
  }
}

// ============================================
// Type guards for RawComptimeValue
// ============================================

/**
 * Check if a raw value is a Type.
 */
export function isRawTypeValue(value: unknown): value is Type {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    [
      "primitive",
      "literal",
      "record",
      "function",
      "array",
      "union",
      "intersection",
      "branded",
      "typeVar",
      "this",
      "withMetadata",
      "boundedType",
    ].includes(value.kind)
  );
}

/**
 * Check if a TypedComptimeValue holds a Type value.
 * The value's type will be Type (primitive).
 */
export function isTypeValue(tv: TypedComptimeValue): boolean {
  return (
    tv.type.kind === "primitive" &&
    tv.type.name === "Type"
  );
}

/**
 * Legacy alias for isRawTypeValue for backward compatibility.
 */
export const isTypeValueRaw = isRawTypeValue;

/**
 * Check if a raw value is a closure.
 */
export function isClosureValue(value: RawComptimeValue): value is ComptimeClosure {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "closure"
  );
}

/**
 * Check if a raw value is a builtin.
 */
export function isBuiltinValue(value: RawComptimeValue): value is ComptimeBuiltin {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "builtin"
  );
}

/**
 * Check if a raw value is a record (plain object, not a Type).
 */
export function isRecordValue(value: RawComptimeValue): value is RawComptimeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // Check it's not a Type (Type values have kind in a specific set)
  if ("kind" in value) {
    const kind = (value as { kind: string }).kind;
    if (
      [
        "primitive",
        "literal",
        "record",
        "function",
        "array",
        "union",
        "intersection",
        "branded",
        "typeVar",
        "this",
        "withMetadata",
        "closure",
        "builtin",
      ].includes(kind)
    ) {
      return false;
    }
  }
  return true;
}

// ============================================
// Helper functions for TypedComptimeValue
// ============================================

/**
 * Wrap a raw value with its type to create a TypedComptimeValue.
 */
export function wrapValue(value: RawComptimeValue, type: Type): TypedComptimeValue {
  return { value, type };
}

/**
 * Extract the raw value from a TypedComptimeValue.
 */
export function unwrapValue(tv: TypedComptimeValue): RawComptimeValue {
  return tv.value;
}

/**
 * Create a TypedComptimeValue for a Type value.
 * When the value IS a Type, its type is the primitive Type.
 */
export function wrapTypeValue(typeValue: Type): TypedComptimeValue {
  return { value: typeValue, type: primitiveType("Type") };
}
