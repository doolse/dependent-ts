/**
 * Builtin operations with constraint signatures.
 *
 * Each builtin declares:
 * - params: constraints required on each argument
 * - result: function to compute result constraint from arg constraints
 * - impl: the actual implementation
 */

import { Constraint, isNumber, isString, isBool, and, equals, gt, gte, lt, lte, implies, constraintToString, constraintEquals } from "./constraint";
import { Value, numberVal, stringVal, boolVal, constraintOf } from "./value";
import type { BinOp, UnaryOp } from "./expr";

// ============================================================================
// Evaluation Result
// ============================================================================

export interface EvalResult {
  value: Value;
  constraint: Constraint;
}

// ============================================================================
// Builtin Signature
// ============================================================================

export interface BuiltinOp {
  // Constraints required on each argument
  params: Constraint[];

  // Compute the result constraint from argument constraints
  // This allows tracking refinements through operations
  result: (argConstraints: Constraint[]) => Constraint;

  // The actual implementation
  impl: (args: Value[]) => Value;
}

// ============================================================================
// Type Checking Helper
// ============================================================================

export class TypeError extends Error {
  constructor(
    public expected: Constraint,
    public got: Constraint,
    public context: string
  ) {
    super(`Type error in ${context}: expected ${constraintToString(expected)}, got ${constraintToString(got)}`);
    this.name = "TypeError";
  }
}

/**
 * Error thrown when a runtime assertion fails.
 */
export class AssertionError extends Error {
  constructor(
    message: string,
    public readonly value: Value,
    public readonly constraint: Constraint
  ) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Check that a constraint satisfies a requirement.
 * Throws TypeError if not.
 */
export function requireConstraint(
  got: Constraint,
  expected: Constraint,
  context: string
): void {
  if (!implies(got, expected)) {
    throw new TypeError(expected, got, context);
  }
}

// ============================================================================
// Binary Operators
// ============================================================================

const binaryOps: Record<BinOp, BuiltinOp> = {
  // Arithmetic
  "+": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      // If both are literal numbers, compute the result
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isNumber, equals(leftVal + rightVal));
      }
      return isNumber;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("+ requires numbers");
      }
      return numberVal(a.value + b.value);
    },
  },

  "-": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isNumber, equals(leftVal - rightVal));
      }
      return isNumber;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("- requires numbers");
      }
      return numberVal(a.value - b.value);
    },
  },

  "*": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isNumber, equals(leftVal * rightVal));
      }
      return isNumber;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("* requires numbers");
      }
      return numberVal(a.value * b.value);
    },
  },

  "/": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null && rightVal !== 0) {
        return and(isNumber, equals(leftVal / rightVal));
      }
      return isNumber;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("/ requires numbers");
      }
      return numberVal(a.value / b.value);
    },
  },

  "%": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null && rightVal !== 0) {
        return and(isNumber, equals(leftVal % rightVal));
      }
      return isNumber;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("% requires numbers");
      }
      return numberVal(a.value % b.value);
    },
  },

  // Comparison
  "==": {
    params: [{ tag: "any" }, { tag: "any" }],
    result: ([left, right]) => {
      // If both are literals, we can determine the result
      const leftVal = extractLiteral(left);
      const rightVal = extractLiteral(right);
      if (leftVal !== undefined && rightVal !== undefined) {
        return and(isBool, equals(leftVal === rightVal));
      }
      return isBool;
    },
    impl: ([a, b]) => {
      return boolVal(valueEquals(a, b));
    },
  },

  "!=": {
    params: [{ tag: "any" }, { tag: "any" }],
    result: ([left, right]) => {
      const leftVal = extractLiteral(left);
      const rightVal = extractLiteral(right);
      if (leftVal !== undefined && rightVal !== undefined) {
        return and(isBool, equals(leftVal !== rightVal));
      }
      return isBool;
    },
    impl: ([a, b]) => {
      return boolVal(!valueEquals(a, b));
    },
  },

  "<": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isBool, equals(leftVal < rightVal));
      }
      return isBool;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("< requires numbers");
      }
      return boolVal(a.value < b.value);
    },
  },

  ">": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isBool, equals(leftVal > rightVal));
      }
      return isBool;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("> requires numbers");
      }
      return boolVal(a.value > b.value);
    },
  },

  "<=": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isBool, equals(leftVal <= rightVal));
      }
      return isBool;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error("<= requires numbers");
      }
      return boolVal(a.value <= b.value);
    },
  },

  ">=": {
    params: [isNumber, isNumber],
    result: ([left, right]) => {
      const leftVal = extractLiteralNumber(left);
      const rightVal = extractLiteralNumber(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isBool, equals(leftVal >= rightVal));
      }
      return isBool;
    },
    impl: ([a, b]) => {
      if (a.tag !== "number" || b.tag !== "number") {
        throw new Error(">= requires numbers");
      }
      return boolVal(a.value >= b.value);
    },
  },

  // Logical
  "&&": {
    params: [isBool, isBool],
    result: ([left, right]) => {
      const leftVal = extractLiteralBool(left);
      const rightVal = extractLiteralBool(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isBool, equals(leftVal && rightVal));
      }
      // Short-circuit cases
      if (leftVal === false) return and(isBool, equals(false));
      if (rightVal === false) return and(isBool, equals(false));
      return isBool;
    },
    impl: ([a, b]) => {
      if (a.tag !== "bool" || b.tag !== "bool") {
        throw new Error("&& requires booleans");
      }
      return boolVal(a.value && b.value);
    },
  },

  "||": {
    params: [isBool, isBool],
    result: ([left, right]) => {
      const leftVal = extractLiteralBool(left);
      const rightVal = extractLiteralBool(right);
      if (leftVal !== null && rightVal !== null) {
        return and(isBool, equals(leftVal || rightVal));
      }
      // Short-circuit cases
      if (leftVal === true) return and(isBool, equals(true));
      if (rightVal === true) return and(isBool, equals(true));
      return isBool;
    },
    impl: ([a, b]) => {
      if (a.tag !== "bool" || b.tag !== "bool") {
        throw new Error("|| requires booleans");
      }
      return boolVal(a.value || b.value);
    },
  },
};

// ============================================================================
// Unary Operators
// ============================================================================

const unaryOps: Record<UnaryOp, BuiltinOp> = {
  "-": {
    params: [isNumber],
    result: ([operand]) => {
      const val = extractLiteralNumber(operand);
      if (val !== null) {
        return and(isNumber, equals(-val));
      }
      return isNumber;
    },
    impl: ([a]) => {
      if (a.tag !== "number") {
        throw new Error("unary - requires number");
      }
      return numberVal(-a.value);
    },
  },

  "!": {
    params: [isBool],
    result: ([operand]) => {
      const val = extractLiteralBool(operand);
      if (val !== null) {
        return and(isBool, equals(!val));
      }
      return isBool;
    },
    impl: ([a]) => {
      if (a.tag !== "bool") {
        throw new Error("! requires boolean");
      }
      return boolVal(!a.value);
    },
  },
};

// ============================================================================
// String Operations (for + overloading)
// ============================================================================

export const stringConcat: BuiltinOp = {
  params: [isString, isString],
  result: ([left, right]) => {
    const leftVal = extractLiteralString(left);
    const rightVal = extractLiteralString(right);
    if (leftVal !== null && rightVal !== null) {
      return and(isString, equals(leftVal + rightVal));
    }
    return isString;
  },
  impl: ([a, b]) => {
    if (a.tag !== "string" || b.tag !== "string") {
      throw new Error("concat requires strings");
    }
    return stringVal(a.value + b.value);
  },
};

// ============================================================================
// Exports
// ============================================================================

export function getBinaryOp(op: BinOp): BuiltinOp {
  return binaryOps[op];
}

export function getUnaryOp(op: UnaryOp): BuiltinOp {
  return unaryOps[op];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract a literal number from a constraint if it's of the form and(isNumber, equals(n)).
 */
function extractLiteralNumber(c: Constraint): number | null {
  if (c.tag === "equals" && typeof c.value === "number") {
    return c.value;
  }
  if (c.tag === "and") {
    for (const sub of c.constraints) {
      if (sub.tag === "equals" && typeof sub.value === "number") {
        return sub.value;
      }
    }
  }
  return null;
}

/**
 * Extract a literal string from a constraint.
 */
function extractLiteralString(c: Constraint): string | null {
  if (c.tag === "equals" && typeof c.value === "string") {
    return c.value;
  }
  if (c.tag === "and") {
    for (const sub of c.constraints) {
      if (sub.tag === "equals" && typeof sub.value === "string") {
        return sub.value;
      }
    }
  }
  return null;
}

/**
 * Extract a literal boolean from a constraint.
 */
function extractLiteralBool(c: Constraint): boolean | null {
  if (c.tag === "equals" && typeof c.value === "boolean") {
    return c.value;
  }
  if (c.tag === "and") {
    for (const sub of c.constraints) {
      if (sub.tag === "equals" && typeof sub.value === "boolean") {
        return sub.value;
      }
    }
  }
  return null;
}

/**
 * Extract any literal value from a constraint.
 */
function extractLiteral(c: Constraint): unknown | undefined {
  if (c.tag === "equals") {
    return c.value;
  }
  if (c.tag === "and") {
    for (const sub of c.constraints) {
      if (sub.tag === "equals") {
        return sub.value;
      }
    }
  }
  return undefined;
}

/**
 * Check if two values are equal.
 */
function valueEquals(a: Value, b: Value): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    case "number":
      return a.value === (b as typeof a).value;
    case "string":
      return a.value === (b as typeof a).value;
    case "bool":
      return a.value === (b as typeof a).value;
    case "null":
      return true;
    case "object":
      // Shallow reference equality for objects
      return a === b;
    case "array":
      // Shallow reference equality for arrays
      return a === b;
    case "closure":
      // Closures are never equal
      return false;
    case "type":
      // Compare types by structural equality of their constraints
      return constraintEquals(a.constraint, (b as typeof a).constraint);
  }
}
