/**
 * Refinement extraction from condition expressions.
 *
 * When we have `if (x > 0) { ... }`, we want to extract:
 * - In the then-branch: x has constraint gt(0)
 * - In the else-branch: x has constraint lte(0)
 */

import { Expr } from "./expr";
import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, or, not, equals, gt, gte, lt, lte, hasField, neverC } from "./constraint";

// ============================================================================
// Refinement Info
// ============================================================================

/**
 * A refinement extracted from a condition.
 * Maps variable names to the constraints we learn about them.
 */
export interface Refinement {
  // Variable name -> constraint learned
  constraints: Map<string, Constraint>;
}

export function emptyRefinement(): Refinement {
  return { constraints: new Map() };
}

export function singleRefinement(varName: string, constraint: Constraint): Refinement {
  return { constraints: new Map([[varName, constraint]]) };
}

export function mergeRefinements(a: Refinement, b: Refinement): Refinement {
  const result = new Map(a.constraints);
  for (const [name, constraint] of b.constraints) {
    const existing = result.get(name);
    if (existing) {
      result.set(name, and(existing, constraint));
    } else {
      result.set(name, constraint);
    }
  }
  return { constraints: result };
}

/**
 * Negate a refinement (for else branches).
 */
export function negateRefinement(r: Refinement): Refinement {
  const result = new Map<string, Constraint>();
  for (const [name, constraint] of r.constraints) {
    result.set(name, negateConstraint(constraint));
  }
  return { constraints: result };
}

/**
 * Negate a constraint using logical rules.
 */
function negateConstraint(c: Constraint): Constraint {
  switch (c.tag) {
    case "gt":
      return lte(c.bound);
    case "gte":
      return lt(c.bound);
    case "lt":
      return gte(c.bound);
    case "lte":
      return gt(c.bound);
    case "equals":
      return { tag: "not", constraint: c };
    case "not":
      return c.constraint;
    case "and":
      // De Morgan: not(A and B) = not(A) or not(B)
      return or(...c.constraints.map(negateConstraint));
    case "or":
      // De Morgan: not(A or B) = not(A) and not(B)
      return and(...c.constraints.map(negateConstraint));
    case "isNumber":
    case "isString":
    case "isBool":
    case "isNull":
    case "isObject":
    case "isArray":
    case "isFunction":
      return not(c);
    default:
      return not(c);
  }
}

// ============================================================================
// Refinement Extraction
// ============================================================================

/**
 * Extract refinement information from a condition expression.
 * Returns what we learn if the condition is TRUE.
 */
export function extractRefinement(expr: Expr): Refinement {
  switch (expr.tag) {
    case "var":
      // `if (x)` - x is truthy
      // For now, we can't express "truthy" precisely, so we just note it's not null/false
      // This is a simplification
      return emptyRefinement();

    case "binop":
      return extractBinaryRefinement(expr.op, expr.left, expr.right);

    case "unary":
      if (expr.op === "!") {
        // `if (!x)` means x is falsy in the then-branch
        // So we negate what we'd learn from x being truthy
        return negateRefinement(extractRefinement(expr.operand));
      }
      return emptyRefinement();

    default:
      return emptyRefinement();
  }
}

/**
 * Extract refinement from a binary operation condition.
 */
function extractBinaryRefinement(op: string, left: Expr, right: Expr): Refinement {
  // Pattern 1: x < 5, x > 0, x == "hello", etc. (simple variable)
  // Pattern 2: obj.kind == "circle" (field access for discriminated unions)

  const leftVar = extractVariable(left);
  const rightVar = extractVariable(right);
  const leftField = extractFieldAccess(left);
  const rightField = extractFieldAccess(right);
  const leftLit = extractLiteral(right); // Note: swapped - if left is var/field, right is lit
  const rightLit = extractLiteral(left); // Note: swapped - if right is var/field, left is lit

  switch (op) {
    case "<":
      if (leftVar && typeof leftLit === "number") {
        // x < 5 → x has constraint lt(5)
        return singleRefinement(leftVar, lt(leftLit));
      }
      if (rightVar && typeof rightLit === "number") {
        // 5 < x → x has constraint gt(5)
        return singleRefinement(rightVar, gt(rightLit));
      }
      break;

    case "<=":
      if (leftVar && typeof leftLit === "number") {
        return singleRefinement(leftVar, lte(leftLit));
      }
      if (rightVar && typeof rightLit === "number") {
        return singleRefinement(rightVar, gte(rightLit));
      }
      break;

    case ">":
      if (leftVar && typeof leftLit === "number") {
        return singleRefinement(leftVar, gt(leftLit));
      }
      if (rightVar && typeof rightLit === "number") {
        return singleRefinement(rightVar, lt(rightLit));
      }
      break;

    case ">=":
      if (leftVar && typeof leftLit === "number") {
        return singleRefinement(leftVar, gte(leftLit));
      }
      if (rightVar && typeof rightLit === "number") {
        return singleRefinement(rightVar, lte(rightLit));
      }
      break;

    case "==":
      // Simple variable: x == 5
      if (leftVar && leftLit !== undefined) {
        return singleRefinement(leftVar, equals(leftLit));
      }
      if (rightVar && rightLit !== undefined) {
        return singleRefinement(rightVar, equals(rightLit));
      }
      // Field access: obj.kind == "circle"
      if (leftField && leftLit !== undefined) {
        // obj.kind == "circle" → obj has hasField("kind", equals("circle"))
        return singleRefinement(leftField.varName, hasField(leftField.fieldName, equals(leftLit)));
      }
      if (rightField && rightLit !== undefined) {
        return singleRefinement(rightField.varName, hasField(rightField.fieldName, equals(rightLit)));
      }
      break;

    case "!=":
      // Simple variable: x != 5
      if (leftVar && leftLit !== undefined) {
        return singleRefinement(leftVar, not(equals(leftLit)));
      }
      if (rightVar && rightLit !== undefined) {
        return singleRefinement(rightVar, not(equals(rightLit)));
      }
      // Field access: obj.kind != "circle"
      if (leftField && leftLit !== undefined) {
        return singleRefinement(leftField.varName, hasField(leftField.fieldName, not(equals(leftLit))));
      }
      if (rightField && rightLit !== undefined) {
        return singleRefinement(rightField.varName, hasField(rightField.fieldName, not(equals(rightLit))));
      }
      break;

    case "&&":
      // Both conditions must be true
      const leftRef = extractRefinement(left);
      const rightRef = extractRefinement(right);
      return mergeRefinements(leftRef, rightRef);

    case "||":
      // At least one condition is true - harder to refine
      // For now, don't extract refinements from OR
      return emptyRefinement();
  }

  return emptyRefinement();
}

/**
 * Extract variable name from a simple variable expression.
 */
function extractVariable(expr: Expr): string | null {
  if (expr.tag === "var") {
    return expr.name;
  }
  return null;
}

/**
 * Extract field access info: { object variable, field name }
 */
function extractFieldAccess(expr: Expr): { varName: string; fieldName: string } | null {
  if (expr.tag === "field" && expr.object.tag === "var") {
    return { varName: expr.object.name, fieldName: expr.name };
  }
  return null;
}

/**
 * Extract literal value from a literal expression.
 */
function extractLiteral(expr: Expr): unknown | undefined {
  if (expr.tag === "lit") {
    return expr.value;
  }
  return undefined;
}

// ============================================================================
// Type Guard Detection
// ============================================================================

/**
 * Detect type guard patterns like isNumber(x), isString(x), etc.
 * Returns the variable name and classification constraint if detected.
 */
export function extractTypeGuard(expr: Expr): { varName: string; constraint: Constraint } | null {
  // Pattern: call(varRef("isNumber"), varRef("x"))
  if (expr.tag !== "call") return null;
  if (expr.func.tag !== "var") return null;
  if (expr.args.length !== 1) return null;
  if (expr.args[0].tag !== "var") return null;

  const funcName = expr.func.name;
  const argName = expr.args[0].name;

  switch (funcName) {
    case "isNumber":
      return { varName: argName, constraint: isNumber };
    case "isString":
      return { varName: argName, constraint: isString };
    case "isBool":
    case "isBoolean":
      return { varName: argName, constraint: isBool };
    case "isNull":
      return { varName: argName, constraint: isNull };
    case "isObject":
      return { varName: argName, constraint: isObject };
    case "isArray":
      return { varName: argName, constraint: isArray };
    case "isFunction":
      return { varName: argName, constraint: isFunction };
    default:
      return null;
  }
}

/**
 * Extract all refinements from a condition, including type guards.
 */
export function extractAllRefinements(expr: Expr): Refinement {
  // First check for type guard
  const typeGuard = extractTypeGuard(expr);
  if (typeGuard) {
    return singleRefinement(typeGuard.varName, typeGuard.constraint);
  }

  // Otherwise use standard refinement extraction
  return extractRefinement(expr);
}
