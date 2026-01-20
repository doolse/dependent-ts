/**
 * JavaScript operator precedence constants.
 *
 * Higher numbers = higher precedence (binds tighter).
 * Used to determine when parentheses are needed in generated code.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence
 */

import { BinaryOp, UnaryOp } from "../ast/core-ast";

// Precedence levels (higher = tighter binding)
export const PREC = {
  COMMA: 1,
  ASSIGNMENT: 2,
  CONDITIONAL: 3,  // ternary ? :
  LOGICAL_OR: 4,   // ||
  LOGICAL_AND: 5,  // &&
  BITWISE_OR: 6,   // |
  BITWISE_XOR: 7,  // ^
  BITWISE_AND: 8,  // &
  EQUALITY: 9,     // == !=
  RELATIONAL: 10,  // < > <= >=
  SHIFT: 11,       // << >> >>>
  ADDITIVE: 12,    // + -
  MULTIPLICATIVE: 13,  // * / %
  UNARY: 14,       // ! - ~ typeof void delete
  POSTFIX: 15,     // ++ --
  CALL: 16,        // ()
  MEMBER: 17,      // . []
  PRIMARY: 18,     // literals, identifiers, grouping
} as const;

/**
 * Get the precedence of a binary operator.
 */
export function binaryPrecedence(op: BinaryOp): number {
  switch (op) {
    case "||":
      return PREC.LOGICAL_OR;
    case "&&":
      return PREC.LOGICAL_AND;
    case "|":
      return PREC.BITWISE_OR;
    case "^":
      return PREC.BITWISE_XOR;
    case "&":
      return PREC.BITWISE_AND;
    case "==":
    case "!=":
      return PREC.EQUALITY;
    case "<":
    case ">":
    case "<=":
    case ">=":
      return PREC.RELATIONAL;
    case "+":
    case "-":
      return PREC.ADDITIVE;
    case "*":
    case "/":
    case "%":
      return PREC.MULTIPLICATIVE;
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown binary operator: ${op}`);
    }
  }
}

/**
 * Get the precedence of a unary operator.
 */
export function unaryPrecedence(_op: UnaryOp): number {
  // All unary operators have the same precedence
  return PREC.UNARY;
}

/**
 * Check if an operator is right-associative.
 * Most JS operators are left-associative; assignment and conditional are right.
 */
export function isRightAssociative(op: BinaryOp): boolean {
  // All our binary operators are left-associative
  // Assignment operators would be right-associative, but DepJS is immutable
  return false;
}
