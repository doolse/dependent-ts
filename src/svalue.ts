/**
 * Staged Values - Now vs Later
 *
 * The core of staging: values are either known at compile time (Now)
 * or only known at runtime (Later).
 *
 * - Now: Value is fully known, can be used in type computations
 * - Later: Only the constraint is known, generates residual code
 * - StagedClosure: A function with its captured environment
 * - LaterArray: Array with known structure but some runtime elements
 */

import { Value, valueToString } from "./value";
import { Constraint, constraintToString } from "./constraint";
import { Expr, exprToString } from "./expr";

// ============================================================================
// Later Origin - Where a Later value came from
// ============================================================================

/**
 * Tracks the origin of a Later value for compiler builtins.
 * - runtime: From runtime("name") - becomes function parameters
 * - import: From import { x } from "mod" - becomes import statements
 * - derived: Computed from other Later values
 */
export type LaterOrigin =
  | { kind: "runtime"; name: string }
  | { kind: "import"; module: string; binding: string; isDefault?: boolean }
  | { kind: "derived" };

// ============================================================================
// Staged Value Types
// ============================================================================

/**
 * A compile-time known value.
 * The value is fully available and can be used in type-level computations.
 */
export interface Now {
  stage: "now";
  value: Value;
  constraint: Constraint;  // Precise constraint (often equals(value))
  residual?: Expr;         // Optional: expression to use in codegen (e.g., variable reference)
}

/**
 * A runtime-only value.
 * The actual value isn't known, but we know its constraint (type).
 * Carries a residual expression for code generation.
 */
export interface Later {
  stage: "later";
  constraint: Constraint;  // What we know about the value
  residual: Expr;          // The expression that computes this value at runtime
  captures: Map<string, SValue>;  // Explicit dependencies (free variables in residual)
  origin: LaterOrigin;     // Where this Later came from
}

/**
 * A staged closure - a function with its captured staged environment.
 * Unlike Later (which is opaque), we can inspect the body and captures.
 */
export interface StagedClosure {
  stage: "closure";
  body: Expr;              // The function body
  params: string[];        // Parameter names (extracted from body or explicit)
  env: SEnv;               // Captured staged environment
  name?: string;           // For recursive self-reference
  siblings?: string[];     // Names in the same mutual recursion group
  constraint: Constraint;  // Always isFunction, but may have more info
}

/**
 * An array with known structure but some runtime elements.
 * Preserves individual element SValues for optimizations like predicate pushing.
 * Created when any element is Later.
 */
export interface LaterArray {
  stage: "later-array";
  elements: SValue[];      // Each element's SValue preserved (can be Now, Later, or Closure)
  constraint: Constraint;  // Overall array constraint (isArray, length, elementAt, etc.)
}

export type SValue = Now | Later | StagedClosure | LaterArray;

// ============================================================================
// Staged Environment (forward declaration for StagedClosure)
// ============================================================================

/**
 * Staged binding - value may be Now, Later, Closure, or LaterArray.
 */
export interface SBinding {
  svalue: SValue;
}

/**
 * Staged environment maps names to staged bindings.
 */
export class SEnv {
  private constructor(private bindings: Map<string, SBinding>) {}

  static empty(): SEnv {
    return new SEnv(new Map());
  }

  get(name: string): SBinding {
    const binding = this.bindings.get(name);
    if (!binding) {
      throw new Error(`Unbound variable: ${name}`);
    }
    return binding;
  }

  tryGet(name: string): SBinding | undefined {
    return this.bindings.get(name);
  }

  set(name: string, binding: SBinding): SEnv {
    const newBindings = new Map(this.bindings);
    newBindings.set(name, binding);
    return new SEnv(newBindings);
  }

  has(name: string): boolean {
    return this.bindings.has(name);
  }

  entries(): IterableIterator<[string, SBinding]> {
    return this.bindings.entries();
  }

  keys(): IterableIterator<string> {
    return this.bindings.keys();
  }

  /**
   * Create a new environment with multiple bindings added.
   */
  setAll(bindings: Iterable<[string, SBinding]>): SEnv {
    const newBindings = new Map(this.bindings);
    for (const [name, binding] of bindings) {
      newBindings.set(name, binding);
    }
    return new SEnv(newBindings);
  }
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Now value from a known value and its constraint.
 * Optionally specify a residual expression for code generation.
 */
export function now(value: Value, constraint: Constraint, residual?: Expr): Now {
  return residual ? { stage: "now", value, constraint, residual } : { stage: "now", value, constraint };
}

/**
 * Create a Later value with a constraint and residual expression.
 * Captures and origin are explicitly specified.
 */
export function later(
  constraint: Constraint,
  residual: Expr,
  captures: Map<string, SValue> = new Map(),
  origin: LaterOrigin = { kind: "derived" }
): Later {
  return { stage: "later", constraint, residual, captures, origin };
}

/**
 * Create a Later value from a runtime("name") expression.
 */
export function laterRuntime(name: string, constraint: Constraint): Later {
  return {
    stage: "later",
    constraint,
    residual: { tag: "var", name },
    captures: new Map(),
    origin: { kind: "runtime", name }
  };
}

/**
 * Create a Later value from an import.
 */
export function laterImport(
  binding: string,
  module: string,
  constraint: Constraint,
  isDefault?: boolean
): Later {
  return {
    stage: "later",
    constraint,
    residual: { tag: "var", name: binding },
    captures: new Map(),
    origin: { kind: "import", module, binding, isDefault }
  };
}

/**
 * Create a StagedClosure value.
 */
export function stagedClosure(
  body: Expr,
  params: string[],
  env: SEnv,
  constraint: Constraint,
  name?: string,
  siblings?: string[]
): StagedClosure {
  const result: StagedClosure = { stage: "closure", body, params, env, constraint };
  if (name !== undefined) result.name = name;
  if (siblings !== undefined && siblings.length > 0) result.siblings = siblings;
  return result;
}

/**
 * Create a LaterArray value with known element structure.
 */
export function laterArray(elements: SValue[], constraint: Constraint): LaterArray {
  return { stage: "later-array", elements, constraint };
}

// ============================================================================
// Predicates
// ============================================================================

export function isNow(sv: SValue): sv is Now {
  return sv.stage === "now";
}

export function isLater(sv: SValue): sv is Later {
  return sv.stage === "later";
}

export function isStagedClosure(sv: SValue): sv is StagedClosure {
  return sv.stage === "closure";
}

export function isLaterArray(sv: SValue): sv is LaterArray {
  return sv.stage === "later-array";
}

/**
 * Check if an SValue is runtime (Later or LaterArray).
 * StagedClosures are NOT runtime - they are compile-time known functions.
 */
export function isRuntime(sv: SValue): sv is Later | LaterArray {
  return sv.stage === "later" || sv.stage === "later-array";
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Get the constraint from a staged value (works for all SValue types).
 */
export function constraintOfSV(sv: SValue): Constraint {
  return sv.constraint;
}

/**
 * Get the residual expression from a staged value.
 * For Later values, returns the residual.
 * For Now values with a residual, returns that residual.
 * For Now values without a residual, returns undefined (caller should use valueToExpr).
 * For LaterArray, returns undefined (caller should use svalueToResidual which computes it from elements).
 * For StagedClosure, returns undefined (caller should use closureToResidual).
 */
export function getResidual(sv: SValue): Expr | undefined {
  if (isLater(sv)) {
    return sv.residual;
  }
  if (isLaterArray(sv) || isStagedClosure(sv)) {
    return undefined; // Computed on-demand
  }
  return sv.residual;
}

/**
 * Map over a Now value, keeping Later/LaterArray/StagedClosure unchanged.
 */
export function mapNow<T>(sv: SValue, f: (n: Now) => T, g: (l: Later | LaterArray | StagedClosure) => T): T {
  if (isNow(sv)) {
    return f(sv);
  } else {
    return g(sv);
  }
}

/**
 * Check if all staged values are Now (all inputs known at compile time).
 */
export function allNow(svs: SValue[]): svs is Now[] {
  return svs.every(isNow);
}

/**
 * Check if any staged value is runtime (Later or LaterArray).
 * StagedClosures don't count as they are compile-time known.
 */
export function anyRuntime(svs: SValue[]): boolean {
  return svs.some(isRuntime);
}

// ============================================================================
// Capture Collection Utilities
// ============================================================================

/**
 * Collect all Later values with a specific origin kind from an SValue tree.
 */
export function collectByOrigin(
  root: SValue,
  kind: "runtime" | "import"
): Map<string, Later> {
  const result = new Map<string, Later>();
  const visited = new Set<SValue>();

  function walk(sv: SValue): void {
    if (visited.has(sv)) return;
    visited.add(sv);

    switch (sv.stage) {
      case "now":
        // Now values don't have captures
        break;

      case "later":
        // Check origin
        if (sv.origin.kind === kind) {
          const name = sv.origin.kind === "runtime" ? sv.origin.name : sv.origin.binding;
          result.set(name, sv);
        }
        // Walk captures
        for (const captured of sv.captures.values()) {
          walk(captured);
        }
        break;

      case "closure":
        // Walk the closure's captured environment
        for (const [, binding] of sv.env.entries()) {
          walk(binding.svalue);
        }
        break;

      case "later-array":
        // Walk elements
        for (const elem of sv.elements) {
          walk(elem);
        }
        break;
    }
  }

  walk(root);
  return result;
}

/**
 * Collect all StagedClosures from an SValue tree.
 */
export function collectClosures(root: SValue): StagedClosure[] {
  const result: StagedClosure[] = [];
  const visited = new Set<SValue>();

  function walk(sv: SValue): void {
    if (visited.has(sv)) return;
    visited.add(sv);

    switch (sv.stage) {
      case "now":
        break;

      case "later":
        for (const captured of sv.captures.values()) {
          walk(captured);
        }
        break;

      case "closure":
        result.push(sv);
        for (const [, binding] of sv.env.entries()) {
          walk(binding.svalue);
        }
        break;

      case "later-array":
        for (const elem of sv.elements) {
          walk(elem);
        }
        break;
    }
  }

  walk(root);
  return result;
}

/**
 * Merge captures from multiple SValues into a single captures map.
 * Used when creating derived Later values from operations on multiple inputs.
 */
export function mergeCaptures(svs: SValue[]): Map<string, SValue> {
  const result = new Map<string, SValue>();

  for (const sv of svs) {
    if (isLater(sv)) {
      // Add the Later value itself if it has a non-derived origin
      if (sv.origin.kind !== "derived") {
        const name = sv.origin.kind === "runtime" ? sv.origin.name : sv.origin.binding;
        result.set(name, sv);
      }
      // Add its captures
      for (const [name, captured] of sv.captures) {
        result.set(name, captured);
      }
    } else if (isLaterArray(sv)) {
      // Recurse into elements
      const elemCaptures = mergeCaptures(sv.elements);
      for (const [name, captured] of elemCaptures) {
        result.set(name, captured);
      }
    } else if (isStagedClosure(sv)) {
      // Closures carry their env - collect Later values from it
      for (const [name, binding] of sv.env.entries()) {
        if (isLater(binding.svalue) || isLaterArray(binding.svalue)) {
          result.set(name, binding.svalue);
        }
      }
    }
    // Now values don't contribute captures
  }

  return result;
}

// ============================================================================
// Pretty Printing
// ============================================================================

export function svalueToString(sv: SValue): string {
  switch (sv.stage) {
    case "now":
      return `now(${valueToString(sv.value)} : ${constraintToString(sv.constraint)})`;
    case "later": {
      const originStr = sv.origin.kind === "derived"
        ? ""
        : sv.origin.kind === "runtime"
          ? ` @runtime(${sv.origin.name})`
          : ` @import(${sv.origin.module}:${sv.origin.binding})`;
      return `later(${exprToString(sv.residual)} : ${constraintToString(sv.constraint)}${originStr})`;
    }
    case "closure": {
      const nameStr = sv.name ? ` ${sv.name}` : "";
      const siblingsStr = sv.siblings ? ` siblings:[${sv.siblings.join(",")}]` : "";
      return `closure${nameStr}(${sv.params.join(", ")})${siblingsStr}`;
    }
    case "later-array": {
      const elemStrs = sv.elements.map(svalueToString).join(", ");
      return `laterArray([${elemStrs}] : ${constraintToString(sv.constraint)})`;
    }
  }
}
