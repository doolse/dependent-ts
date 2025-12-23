/**
 * Environment - maps variable names to bindings.
 * Immutable: set() returns a new Env.
 */

import { Value } from "./value";
import { Constraint } from "./constraint";

// ============================================================================
// Binding
// ============================================================================

/**
 * A binding associates a value with its constraint.
 * The constraint may be more general than what constraintOf(value) would give,
 * e.g., after widening or explicit annotation.
 */
export interface Binding {
  value: Value;
  constraint: Constraint;
}

// ============================================================================
// Environment
// ============================================================================

export class Env {
  private bindings: Map<string, Binding>;

  constructor(initial?: Map<string, Binding>) {
    this.bindings = initial ?? new Map();
  }

  /**
   * Look up a binding by name.
   * Throws if not found.
   */
  get(name: string): Binding {
    const binding = this.bindings.get(name);
    if (binding === undefined) {
      throw new Error(`Undefined variable: ${name}`);
    }
    return binding;
  }

  /**
   * Check if a name is bound.
   */
  has(name: string): boolean {
    return this.bindings.has(name);
  }

  /**
   * Create a new environment with an additional binding.
   * Does not mutate the current environment.
   */
  set(name: string, binding: Binding): Env {
    const newBindings = new Map(this.bindings);
    newBindings.set(name, binding);
    return new Env(newBindings);
  }

  /**
   * Create a new environment with multiple bindings.
   */
  setMany(bindings: [string, Binding][]): Env {
    const newBindings = new Map(this.bindings);
    for (const [name, binding] of bindings) {
      newBindings.set(name, binding);
    }
    return new Env(newBindings);
  }

  /**
   * Get all bindings as entries.
   */
  entries(): IterableIterator<[string, Binding]> {
    return this.bindings.entries();
  }

  /**
   * Get all variable names.
   */
  keys(): IterableIterator<string> {
    return this.bindings.keys();
  }

  /**
   * Get the number of bindings.
   */
  size(): number {
    return this.bindings.size;
  }

  /**
   * Create an empty environment.
   */
  static empty(): Env {
    return new Env();
  }

  /**
   * Create an environment from a record of bindings.
   */
  static fromRecord(record: Record<string, Binding>): Env {
    return new Env(new Map(Object.entries(record)));
  }
}

// ============================================================================
// Refinement Context
// ============================================================================

/**
 * RefinementContext tracks what we know about variables from control flow.
 * For example, after `if (x > 0)`, we know `x` satisfies `gt(0)` in the then-branch.
 *
 * This is separate from Env because:
 * - Env tracks variable bindings (what x IS)
 * - RefinementContext tracks learned facts (what we KNOW about x from control flow)
 */
export class RefinementContext {
  // Maps variable names to additional constraints learned from control flow
  private refinements: Map<string, Constraint>;

  constructor(initial?: Map<string, Constraint>) {
    this.refinements = initial ?? new Map();
  }

  /**
   * Get the refinement for a variable (if any).
   */
  get(name: string): Constraint | undefined {
    return this.refinements.get(name);
  }

  /**
   * Add a refinement for a variable.
   * If the variable already has a refinement, the new one is AND'd with it.
   */
  refine(name: string, constraint: Constraint): RefinementContext {
    const newRefinements = new Map(this.refinements);
    const existing = this.refinements.get(name);
    if (existing) {
      newRefinements.set(name, { tag: "and", constraints: [existing, constraint] });
    } else {
      newRefinements.set(name, constraint);
    }
    return new RefinementContext(newRefinements);
  }

  /**
   * Create an empty context.
   */
  static empty(): RefinementContext {
    return new RefinementContext();
  }
}
