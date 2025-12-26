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

export type SValue = Now | Later;

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

// ============================================================================
// Predicates
// ============================================================================

export function isNow(sv: SValue): sv is Now {
  return sv.stage === "now";
}

export function isLater(sv: SValue): sv is Later {
  return sv.stage === "later";
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
 */
export function getResidual(sv: SValue): Expr | undefined {
  if (isLater(sv)) {
    return sv.residual;
  }
  return sv.residual;
}

/**
 * Map over a Now value, keeping Later unchanged.
 */
export function mapNow<T>(sv: SValue, f: (n: Now) => T, g: (l: Later) => T): T {
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
  } else {
    return `later(${exprToString(sv.residual)} : ${constraintToString(sv.constraint)})`;
  }
}
