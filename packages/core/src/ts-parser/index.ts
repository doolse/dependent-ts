/**
 * Lezer-based TypeScript/JSX Parser
 *
 * Alternative parser that uses @lezer/javascript to parse TypeScript/JSX
 * and converts to our Expr AST. Type annotations are converted to constraints.
 *
 * Usage:
 *   import { parseTS, parseTSExpr, parseTSType } from "./ts-parser";
 *
 *   // Parse a single expression
 *   const expr = parseTSExpr("x + 1");
 *
 *   // Parse statements with const/let declarations
 *   const expr = parseTS("const x = 5; const y = x + 1; x + y");
 *
 *   // Parse a TypeScript type to a Constraint
 *   const constraint = parseTSType("number | string");
 */

import { parser } from "@lezer/javascript";
import { Expr } from "../expr";
import { Constraint } from "../constraint";
import { convertNode, convertStatements, TSParseError } from "./convert";
import { convertTypeNode } from "./type-convert";

// Configure parser for TypeScript + JSX
const tsxParser = parser.configure({
  dialect: "ts jsx",
});

// Configure parser for single expression mode
const exprParser = parser.configure({
  dialect: "ts jsx",
  top: "SingleExpression",
});

/**
 * Parse a TypeScript/JSX expression string to our Expr AST.
 *
 * @param source - TypeScript/JSX expression code (single expression)
 * @returns Expr AST node
 * @throws TSParseError if parsing fails
 *
 * @example
 * parseTSExpr("1 + 2")           // num(1) + num(2)
 * parseTSExpr("(x) => x * 2")    // fn(["x"], mul(varRef("x"), num(2)))
 * parseTSExpr("<div>Hello</div>") // jsx call
 */
export function parseTSExpr(source: string): Expr {
  const tree = exprParser.parse(source);
  const topNode = tree.topNode;

  if (!topNode || !topNode.firstChild) {
    throw new TSParseError("Failed to parse expression", 0, source.length, "parse");
  }

  // The expression is wrapped in a SingleExpression node
  return convertNode(topNode.firstChild, source);
}

/**
 * Parse TypeScript statements (const/let declarations + expressions).
 * Converts to nested let-in expressions.
 *
 * @param source - TypeScript code with declarations
 * @returns Expr AST with let bindings
 * @throws TSParseError if parsing fails
 *
 * @example
 * parseTS("const x = 5; x + 1")
 * // => letExpr("x", num(5), add(varRef("x"), num(1)))
 *
 * parseTS("const x: number = getValue(); x * 2")
 * // => letExpr("x", comptime(assert(call(varRef("getValue")), Number)), ...)
 */
export function parseTS(source: string): Expr {
  const tree = tsxParser.parse(source);
  const topNode = tree.topNode;

  if (!topNode) {
    throw new TSParseError("Failed to parse", 0, source.length, "parse");
  }

  return convertNode(topNode, source);
}

/**
 * Parse a TypeScript type annotation string to a Constraint.
 *
 * @param source - TypeScript type syntax (e.g., "number | string")
 * @returns Constraint representing the type
 *
 * @example
 * parseTSType("number")           // isNumber
 * parseTSType("string | null")    // or(isString, isNull)
 * parseTSType("{ x: number }")    // and(isObject, hasField("x", isNumber))
 * parseTSType("[number, string]") // tupleConstraint([isNumber, isString])
 */
export function parseTSType(source: string): Constraint {
  // Wrap the type in a variable declaration to make it valid syntax
  const wrappedSource = `let _: ${source}`;
  const tree = tsxParser.parse(wrappedSource);
  const topNode = tree.topNode;

  if (!topNode) {
    throw new TSParseError("Failed to parse type", 0, source.length, "parseType");
  }

  // Find the TypeAnnotation node
  function findTypeAnnotation(node: any): any {
    if (node.type.name === "TypeAnnotation") {
      return node;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const found = findTypeAnnotation(child);
      if (found) return found;
    }
    return null;
  }

  const typeAnnotation = findTypeAnnotation(topNode);
  if (!typeAnnotation) {
    throw new TSParseError("Failed to find type in: " + source, 0, source.length, "parseType");
  }

  return convertTypeNode(typeAnnotation, wrappedSource);
}

// Re-export error class and types
export { TSParseError } from "./convert";
export { convertTypeNode, constraintToExpr } from "./type-convert";
