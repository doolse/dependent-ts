/**
 * JavaScript Code Generator
 *
 * Converts expressions (typically residual expressions from staged evaluation)
 * into JavaScript code strings that can be executed.
 *
 * Pipeline:
 * 1. Stage the expression to get SValue
 * 2. Generate JS AST from SValue
 * 3. Print JS AST to string
 */

import { Expr } from "./expr";
import { stage } from "./staged-evaluate";
import { SValue } from "./svalue";
import { printExpr, printModule } from "./js-printer";
import { generateExpression, generateESModule } from "./svalue-module-generator";

// ============================================================================
// Code Generation Options
// ============================================================================

export interface CodeGenOptions {
  /** Indentation string (default: "  ") */
  indent?: string;
  /** Whether to generate TypeScript (adds type annotations where possible) */
  typescript?: boolean;
  /** Whether to wrap in an IIFE for immediate execution */
  wrapInIIFE?: boolean;
  /** Whether to use expression form (ternaries) vs statement form (if/else) */
  preferExpressions?: boolean;
}

// ============================================================================
// Compilation Pipeline
// ============================================================================

/**
 * Full compilation pipeline: stage + codegen.
 * Takes an expression, partially evaluates it, and generates JavaScript.
 */
export function compile(expr: Expr, options: CodeGenOptions = {}): string {
  const result = stage(expr);
  return compileFromSValue(result.svalue, options);
}

/**
 * Alias for compile() - stages the expression and generates JavaScript.
 */
export const generateJS = compile;

/**
 * Compile from an already-staged value.
 */
export function compileFromSValue(sv: SValue, options: CodeGenOptions = {}): string {
  const jsAst = generateExpression(sv);
  return printExpr(jsAst, options.indent ? { indent: options.indent } : {});
}

// ============================================================================
// Module Generation with Imports
// ============================================================================

/**
 * Generate JavaScript with top-level imports.
 * This is for generating complete modules with proper ES imports.
 *
 * Uses generateESModule internally, which collects imports from
 * Later value origin tracking during staging.
 */
export function generateModuleWithImports(expr: Expr, options: CodeGenOptions = {}): string {
  const result = stage(expr);
  const jsModule = generateESModule(result.svalue);
  return printModule(jsModule, options.indent ? { indent: options.indent } : {});
}
