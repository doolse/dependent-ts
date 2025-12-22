/**
 * Built-in functions with staging semantics.
 * Based on docs/staged-architecture.md Part 1.3
 */

import { SValue, nowValue, laterValue, isNow } from "./svalue";
import { numberType, stringType, boolType, literalType } from "./types";
import { JsExpr, jsLit, jsBinOp } from "./jsexpr";
import { Constraint, ConstraintTerm, litTerm } from "./constraints";
import { RefinementContext, proveFromFacts } from "./refinement";

/**
 * A built-in function that operates on staged values.
 * Now takes a RefinementContext to enable proving from known facts.
 */
export type BuiltinFn = (args: SValue[], ctx: RefinementContext) => SValue;

/**
 * Convert SValue to JsExpr for code generation.
 * (Architecture doc section 1.3 - toExpr function)
 */
export function toExpr(v: SValue): JsExpr {
  if (isNow(v)) {
    return jsLit(v.value); // Inline the known value
  } else {
    return v.expr; // Use the generated expression
  }
}

/**
 * Convert an SValue to a ConstraintTerm for the refinement system.
 * (Architecture doc section 2.5 - toConstraintTerm)
 */
export function toConstraintTerm(v: SValue): ConstraintTerm | null {
  if (isNow(v)) {
    return litTerm(v.value);
  }
  if (v.source?.symbol) {
    return { tag: "symbol", name: v.source.symbol };
  }
  if (v.source?.field) {
    const objTerm = toConstraintTerm(v.source.field.object);
    if (objTerm) {
      return { tag: "field", object: objTerm, field: v.source.field.field };
    }
  }
  // Can't represent as constraint term
  return null;
}

/**
 * Extract a constraint from a boolean SValue (the result of a comparison).
 * (Architecture doc section 2.5 - extractConstraint)
 */
export function extractConstraint(condition: SValue): Constraint | null {
  if (!condition.source?.op) return null;

  const { op, left, right } = condition.source.op;
  const leftTerm = toConstraintTerm(left);
  const rightTerm = toConstraintTerm(right);

  if (!leftTerm || !rightTerm) return null;

  switch (op) {
    case "==":
    case "===":
      return { tag: "eq", left: leftTerm, right: rightTerm };
    case "!=":
    case "!==":
      return { tag: "neq", left: leftTerm, right: rightTerm };
    case "<":
      return { tag: "lt", left: leftTerm, right: rightTerm };
    case "<=":
      return { tag: "lte", left: leftTerm, right: rightTerm };
    case ">":
      return { tag: "gt", left: leftTerm, right: rightTerm };
    case ">=":
      return { tag: "gte", left: leftTerm, right: rightTerm };
    default:
      return null;
  }
}

/**
 * Create a binary numeric built-in (add, sub, mul, div).
 * Implements stage propagation: now + now = now, otherwise later
 */
function numericBinaryBuiltin(op: string, compute: (a: number, b: number) => number): BuiltinFn {
  return (args: SValue[], _ctx: RefinementContext): SValue => {
    const [left, right] = args;

    // Both known -> compute the result
    if (isNow(left) && isNow(right)) {
      const result = compute(left.value as number, right.value as number);
      return nowValue(literalType(result), result);
    }

    // At least one unknown -> generate code
    return laterValue(numberType, jsBinOp(op, toExpr(left), toExpr(right)));
  };
}

/**
 * Create a comparison built-in (eq, lt, gt, etc.).
 * Now uses refinement context to prove results from known facts.
 */
function comparisonBuiltin(
  op: string,
  constraintTag: Constraint["tag"],
  compute: (a: unknown, b: unknown) => boolean
): BuiltinFn {
  return (args: SValue[], ctx: RefinementContext): SValue => {
    const [left, right] = args;

    // Both known -> compute the result directly
    if (isNow(left) && isNow(right)) {
      const result = compute(left.value, right.value);
      return nowValue(literalType(result), result, { op: { op, left, right } });
    }

    // Special case: if comparing literal types, we may know the result
    if (op === "===" || op === "==") {
      if (left.type.tag === "literal" && right.type.tag === "literal") {
        const result = left.type.value === right.type.value;
        return nowValue(literalType(result), result, { op: { op, left, right } });
      }
      if (left.type.tag === "literal" && isNow(right)) {
        const result = left.type.value === right.value;
        return nowValue(literalType(result), result, { op: { op, left, right } });
      }
      if (right.type.tag === "literal" && isNow(left)) {
        const result = left.value === right.type.value;
        return nowValue(literalType(result), result, { op: { op, left, right } });
      }
    }

    // Try to prove from refinement context
    const leftTerm = toConstraintTerm(left);
    const rightTerm = toConstraintTerm(right);

    if (leftTerm && rightTerm) {
      const constraint: Constraint = { tag: constraintTag, left: leftTerm, right: rightTerm } as Constraint;
      const proven = proveFromFacts(ctx, constraint);

      if (proven !== undefined) {
        // Refinements prove the result!
        return nowValue(literalType(proven), proven, { op: { op, left, right } });
      }
    }

    // Generate code with source info for later constraint extraction
    return laterValue(boolType, jsBinOp(op, toExpr(left), toExpr(right)), {
      op: { op, left, right },
    });
  };
}

/**
 * Logical AND with short-circuit semantics.
 */
const andBuiltin: BuiltinFn = (args: SValue[], _ctx: RefinementContext): SValue => {
  const [left, right] = args;

  if (isNow(left)) {
    if (left.value === false) {
      return nowValue(literalType(false), false);
    }
    if (left.value === true) {
      return right;
    }
  }

  if (isNow(right)) {
    if (right.value === false) {
      return nowValue(literalType(false), false);
    }
  }

  return laterValue(boolType, jsBinOp("&&", toExpr(left), toExpr(right)));
};

/**
 * Logical OR with short-circuit semantics.
 */
const orBuiltin: BuiltinFn = (args: SValue[], _ctx: RefinementContext): SValue => {
  const [left, right] = args;

  if (isNow(left)) {
    if (left.value === true) {
      return nowValue(literalType(true), true);
    }
    if (left.value === false) {
      return right;
    }
  }

  if (isNow(right)) {
    if (right.value === true) {
      return nowValue(literalType(true), true);
    }
  }

  return laterValue(boolType, jsBinOp("||", toExpr(left), toExpr(right)));
};

/**
 * String concatenation.
 */
const concatBuiltin: BuiltinFn = (args: SValue[], _ctx: RefinementContext): SValue => {
  const [left, right] = args;

  if (isNow(left) && isNow(right)) {
    const result = String(left.value) + String(right.value);
    return nowValue(literalType(result), result);
  }

  return laterValue(stringType, jsBinOp("+", toExpr(left), toExpr(right)));
};

/**
 * Registry of all built-in functions.
 */
export const builtins: Record<string, BuiltinFn> = {
  // Arithmetic
  add: numericBinaryBuiltin("+", (a, b) => a + b),
  sub: numericBinaryBuiltin("-", (a, b) => a - b),
  mul: numericBinaryBuiltin("*", (a, b) => a * b),
  div: numericBinaryBuiltin("/", (a, b) => a / b),

  // Comparison - now with constraint tags for refinement proving
  eq: comparisonBuiltin("===", "eq", (a, b) => a === b),
  neq: comparisonBuiltin("!==", "neq", (a, b) => a !== b),
  lt: comparisonBuiltin("<", "lt", (a, b) => (a as number) < (b as number)),
  gt: comparisonBuiltin(">", "gt", (a, b) => (a as number) > (b as number)),
  lte: comparisonBuiltin("<=", "lte", (a, b) => (a as number) <= (b as number)),
  gte: comparisonBuiltin(">=", "gte", (a, b) => (a as number) >= (b as number)),

  // Logical
  and: andBuiltin,
  or: orBuiltin,

  // String
  concat: concatBuiltin,
};
