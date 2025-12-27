/**
 * Backend Interface
 *
 * Defines the interface for code generation backends.
 * Each backend transforms staged values (SValue) into target-specific AST.
 *
 * The key feature is that backends have access to the staging machinery,
 * allowing them to:
 * - Inspect constraints/types
 * - Stage sub-expressions on demand
 * - Make target-specific optimization decisions
 */

import { Expr } from "./expr";
import { Constraint } from "./constraint";
import { Value } from "./value";
import { SValue, Now, Later, LaterArray } from "./svalue";
import { SEnv, SEvalResult } from "./staged-evaluate";
import { JSExpr } from "./js-ast";

// ============================================================================
// Backend Context
// ============================================================================

/**
 * Context provided to backends during code generation.
 * Gives access to staging infrastructure for on-demand evaluation.
 */
export interface BackendContext {
  /**
   * Stage an expression to get its SValue.
   * Allows the backend to inspect sub-expressions.
   */
  stage(expr: Expr, env?: SEnv): SEvalResult;

  /**
   * The current staging environment.
   */
  env: SEnv;

  /**
   * Convert an SValue back to an expression (for inspection).
   */
  svalueToResidual(sv: SValue): Expr;

  /**
   * Recursively generate code for an SValue.
   * Calls back into the backend's generate method.
   */
  generate(sv: SValue): JSExpr;

  /**
   * Generate code from an expression (stages it first).
   */
  generateExpr(expr: Expr): JSExpr;

  /**
   * Convert a closure value to a residual expression.
   * Stages the closure body with parameters as Later values.
   */
  closureToResidual(closure: Value): Expr;
}

// ============================================================================
// Backend Interface
// ============================================================================

/**
 * A code generation backend.
 *
 * Backends are "interpreters" that traverse SValues and produce
 * target-specific code (currently JS AST, could be SQL, etc.).
 */
export interface Backend {
  /**
   * Backend name (e.g., "javascript", "sql").
   */
  name: string;

  /**
   * Generate target code from a staged value.
   *
   * @param sv - The staged value to generate code for
   * @param ctx - Context with access to staging machinery
   * @returns Target-specific AST (currently JSExpr)
   */
  generate(sv: SValue, ctx: BackendContext): JSExpr;
}

// ============================================================================
// Helpers for Backend Implementations
// ============================================================================

/**
 * Check if an SValue is fully known at compile time.
 */
export function isNowValue(sv: SValue): sv is Now {
  return sv.stage === "now";
}

/**
 * Check if an SValue is a runtime value.
 */
export function isLaterValue(sv: SValue): sv is Later {
  return sv.stage === "later";
}

/**
 * Check if an SValue is a mixed array.
 */
export function isLaterArrayValue(sv: SValue): sv is LaterArray {
  return sv.stage === "later-array";
}

/**
 * Get the constraint from any SValue.
 */
export function getConstraint(sv: SValue): Constraint {
  return sv.constraint;
}

/**
 * Check if a call expression is a call to a specific function.
 */
export function isCallTo(expr: Expr, name: string): boolean {
  return expr.tag === "call" &&
         expr.func.tag === "var" &&
         expr.func.name === name;
}

/**
 * Check if an expression is a method call.
 */
export function isMethodCall(expr: Expr): expr is Expr & { tag: "methodCall" } {
  return expr.tag === "methodCall";
}
