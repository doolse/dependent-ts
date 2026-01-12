/**
 * Compile-time Environment - tracks values for compile-time evaluation.
 *
 * Key features:
 * - Lazy evaluation: values are computed on first access
 * - Cycle detection: detects circular dependencies
 * - Caching: evaluated values are cached
 */

import { Type } from "../types/types.js";
import { CoreExpr, CompileError, SourceLocation } from "../ast/core-ast.js";
import { TypeEnv } from "./type-env.js";

/**
 * Comptime values that can exist during compile-time evaluation.
 */
export type ComptimeValue =
  | Type // Type values
  | string
  | number
  | boolean
  | null
  | undefined
  | ComptimeValue[] // Arrays
  | ComptimeRecord // Records
  | ComptimeClosure // User-defined functions
  | ComptimeBuiltin; // Built-in functions

// Using a branded type pattern to distinguish plain records from Type values
export type ComptimeRecord = { [key: string]: ComptimeValue } & { __comptimeRecord?: true };

/**
 * A closure captured during comptime evaluation.
 */
export type ComptimeClosure = {
  kind: "closure";
  params: { name: string; defaultValue?: CoreExpr }[];
  body: CoreExpr;
  env: ComptimeEnv;
  typeEnv: TypeEnv;
};

/**
 * A built-in function implemented in TypeScript.
 */
export type ComptimeBuiltin = {
  kind: "builtin";
  name: string;
  impl: BuiltinImpl;
};

/**
 * Implementation of a built-in function.
 * The evaluator is passed for recursive evaluation of arguments.
 */
export type BuiltinImpl = (
  args: ComptimeValue[],
  evaluator: ComptimeEvaluatorInterface,
  loc?: SourceLocation
) => ComptimeValue;

/**
 * Interface for the comptime evaluator (to avoid circular deps).
 */
export interface ComptimeEvaluatorInterface {
  evaluate(
    expr: CoreExpr,
    comptimeEnv: ComptimeEnv,
    typeEnv: TypeEnv
  ): ComptimeValue;
}

/**
 * Entry in the comptime environment.
 */
export type ComptimeEntry =
  | { status: "unevaluated"; expr: CoreExpr; typeEnv: TypeEnv }
  | { status: "evaluating" } // For cycle detection
  | { status: "evaluated"; value: ComptimeValue }
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
   */
  getValue(
    name: string,
    evaluator: ComptimeEvaluatorInterface,
    loc?: SourceLocation
  ): ComptimeValue {
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
   */
  getEvaluatedValue(name: string): ComptimeValue | undefined {
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
   * Define a binding with an already-evaluated value.
   */
  defineEvaluated(name: string, value: ComptimeValue): void {
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
// Type guards for ComptimeValue
// ============================================

/**
 * Check if a value is a Type.
 */
export function isTypeValue(value: ComptimeValue): value is Type {
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
    ].includes(value.kind)
  );
}

/**
 * Check if a value is a closure.
 */
export function isClosureValue(value: ComptimeValue): value is ComptimeClosure {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "closure"
  );
}

/**
 * Check if a value is a builtin.
 */
export function isBuiltinValue(value: ComptimeValue): value is ComptimeBuiltin {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "builtin"
  );
}

/**
 * Check if a value is a record (plain object, not a Type).
 */
export function isRecordValue(value: ComptimeValue): value is ComptimeRecord {
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
