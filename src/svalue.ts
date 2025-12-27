/**
 * Staged Values - Now vs Later
 *
 * The core of staging: values are either known at compile time (Now)
 * or only known at runtime (Later).
 *
 * - Now: Value is fully known, can be used in type computations
 * - Later: Only the constraint is known, generates residual code
 */

import { Value, valueToString } from "./value";
import { Constraint, constraintToString } from "./constraint";
import { Expr, exprToString } from "./expr";

// ============================================================================
// Staged Value Type
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
}

/**
 * An array with known structure but some runtime elements.
 * Preserves individual element SValues for optimizations like predicate pushing.
 * Created when any element is Later.
 */
export interface LaterArray {
  stage: "later-array";
  elements: SValue[];      // Each element's SValue preserved (can be Now or Later)
  constraint: Constraint;  // Overall array constraint (isArray, length, elementAt, etc.)
}

export type SValue = Now | Later | LaterArray;

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
 */
export function later(constraint: Constraint, residual: Expr): Later {
  return { stage: "later", constraint, residual };
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

export function isLaterArray(sv: SValue): sv is LaterArray {
  return sv.stage === "later-array";
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Get the constraint from a staged value (works for both Now and Later).
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
 */
export function getResidual(sv: SValue): Expr | undefined {
  if (isLater(sv)) {
    return sv.residual;
  }
  if (isLaterArray(sv)) {
    return undefined; // Computed on-demand from elements
  }
  return sv.residual;
}

/**
 * Map over a Now value, keeping Later/LaterArray unchanged.
 */
export function mapNow<T>(sv: SValue, f: (n: Now) => T, g: (l: Later | LaterArray) => T): T {
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

// ============================================================================
// Pretty Printing
// ============================================================================

export function svalueToString(sv: SValue): string {
  if (isNow(sv)) {
    return `now(${valueToString(sv.value)} : ${constraintToString(sv.constraint)})`;
  } else if (isLaterArray(sv)) {
    const elemStrs = sv.elements.map(svalueToString).join(", ");
    return `laterArray([${elemStrs}] : ${constraintToString(sv.constraint)})`;
  } else {
    return `later(${exprToString(sv.residual)} : ${constraintToString(sv.constraint)})`;
  }
}
