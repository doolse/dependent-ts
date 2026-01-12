/**
 * Type Environment - tracks type bindings during type checking.
 */

import { Type } from "../types/types.js";
import { CompileError, SourceLocation } from "../ast/core-ast.js";

/**
 * Comptime status of a binding.
 */
export type ComptimeStatus =
  | "runtime" // Normal runtime value
  | "comptime" // Evaluated at comptime, but value CAN exist at runtime
  | "comptimeOnly"; // CANNOT exist at runtime (Type values, Expr<T>)

/**
 * A type binding in the environment.
 */
export type TypeBinding = {
  type: Type;
  comptimeStatus: ComptimeStatus;
  mutable: false; // Always false in DepJS (const only)
};

/**
 * Type environment - maps names to their types.
 * Supports lexical scoping via parent chain.
 */
export class TypeEnv {
  private bindings: Map<string, TypeBinding>;
  private parent: TypeEnv | null;

  constructor(parent: TypeEnv | null = null) {
    this.bindings = new Map();
    this.parent = parent;
  }

  /**
   * Look up a binding by name.
   */
  lookup(name: string): TypeBinding | undefined {
    const binding = this.bindings.get(name);
    if (binding) return binding;
    return this.parent?.lookup(name);
  }

  /**
   * Look up a binding, throwing if not found.
   */
  lookupOrThrow(name: string, loc?: SourceLocation): TypeBinding {
    const binding = this.lookup(name);
    if (!binding) {
      throw new CompileError(`'${name}' is not defined`, "typecheck", loc);
    }
    return binding;
  }

  /**
   * Define a new binding in this scope.
   */
  define(name: string, binding: TypeBinding): void {
    if (this.bindings.has(name)) {
      throw new CompileError(`'${name}' is already defined in this scope`);
    }
    this.bindings.set(name, binding);
  }

  /**
   * Check if a name is defined in this exact scope (not parent).
   */
  hasOwn(name: string): boolean {
    return this.bindings.has(name);
  }

  /**
   * Check if a name is defined anywhere in scope.
   */
  has(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  /**
   * Create a child scope.
   */
  extend(): TypeEnv {
    return new TypeEnv(this);
  }

  /**
   * Get all bindings in this scope (not including parent).
   */
  getOwnBindings(): Map<string, TypeBinding> {
    return new Map(this.bindings);
  }
}
