/**
 * Refinement context and constraint proving.
 * Based on docs/staged-architecture.md Part 2.2 and 2.6
 */

import {
  Constraint,
  ConstraintTerm,
  constraintEquals,
  negateConstraint,
  termEquals,
  constraintToString,
} from "./constraints";

/**
 * The refinement context tracks what we know at each point in execution.
 */
export interface RefinementContext {
  // Constraints we know to be true
  facts: Constraint[];
  // Parent context (for lexical scoping)
  parent: RefinementContext | null;
}

/**
 * Create an empty refinement context.
 */
export function emptyContext(): RefinementContext {
  return { facts: [], parent: null };
}

/**
 * Extend a context with new facts.
 */
export function extendContext(parent: RefinementContext, newFacts: Constraint[]): RefinementContext {
  return { facts: newFacts, parent };
}

/**
 * Gather all facts from this context and ancestors.
 */
export function allFacts(ctx: RefinementContext): Constraint[] {
  const facts = [...ctx.facts];
  if (ctx.parent) {
    facts.push(...allFacts(ctx.parent));
  }
  return facts;
}

/**
 * Try to prove a goal from the known facts.
 * Returns:
 * - true if the goal is provably true
 * - false if the goal is provably false
 * - undefined if we can't determine
 */
export function proveFromFacts(ctx: RefinementContext, goal: Constraint | null): boolean | undefined {
  if (goal === null) return undefined;

  const facts = allFacts(ctx);

  // Direct match - goal is in facts
  if (facts.some((f) => constraintEquals(f, goal))) {
    return true;
  }

  // Negation is in facts - goal is provably false
  const negatedGoal = negateConstraint(goal);
  if (facts.some((f) => constraintEquals(f, negatedGoal))) {
    return false;
  }

  // Handle NOT goals - if we're trying to prove !(x), check if x is provably false
  if (goal.tag === "not") {
    const innerResult = proveFromFacts(ctx, goal.inner);
    if (innerResult === true) return false;
    if (innerResult === false) return true;
    return undefined;
  }

  // Try to prove using relationships between constraints
  // For equality: if we know a == b and a == c, then b == c
  if (goal.tag === "eq") {
    const result = proveEquality(facts, goal.left, goal.right);
    if (result !== undefined) return result;
  }

  // For inequality: use transitivity
  if (goal.tag === "lt") {
    const result = proveLessThan(facts, goal.left, goal.right);
    if (result !== undefined) return result;
  }

  if (goal.tag === "lte") {
    // a <= b is equivalent to a < b || a == b
    const ltResult = proveLessThan(facts, goal.left, goal.right);
    if (ltResult === true) return true;
    const eqResult = proveEquality(facts, goal.left, goal.right);
    if (eqResult === true) return true;
    // If we can prove a > b, then a <= b is false
    const gtResult = proveLessThan(facts, goal.right, goal.left);
    if (gtResult === true) return false;
    return undefined;
  }

  if (goal.tag === "gt") {
    // a > b is equivalent to b < a
    return proveLessThan(facts, goal.right, goal.left);
  }

  if (goal.tag === "gte") {
    // a >= b is equivalent to b <= a
    const ltResult = proveLessThan(facts, goal.right, goal.left);
    if (ltResult === true) return true;
    const eqResult = proveEquality(facts, goal.left, goal.right);
    if (eqResult === true) return true;
    const gtResult = proveLessThan(facts, goal.left, goal.right);
    if (gtResult === true) return false;
    return undefined;
  }

  if (goal.tag === "neq") {
    // a != b is true if we can prove a < b or a > b
    const ltResult = proveLessThan(facts, goal.left, goal.right);
    if (ltResult === true) return true;
    const gtResult = proveLessThan(facts, goal.right, goal.left);
    if (gtResult === true) return true;
    // a != b is false if we can prove a == b
    const eqResult = proveEquality(facts, goal.left, goal.right);
    if (eqResult === true) return false;
    return undefined;
  }

  // AND: both sides must be true
  if (goal.tag === "and") {
    const leftResult = proveFromFacts(ctx, goal.left);
    const rightResult = proveFromFacts(ctx, goal.right);
    if (leftResult === true && rightResult === true) return true;
    if (leftResult === false || rightResult === false) return false;
    return undefined;
  }

  // OR: at least one side must be true
  if (goal.tag === "or") {
    const leftResult = proveFromFacts(ctx, goal.left);
    const rightResult = proveFromFacts(ctx, goal.right);
    if (leftResult === true || rightResult === true) return true;
    if (leftResult === false && rightResult === false) return false;
    return undefined;
  }

  return undefined;
}

/**
 * Try to prove equality between two terms using known facts.
 */
function proveEquality(
  facts: Constraint[],
  left: ConstraintTerm,
  right: ConstraintTerm
): boolean | undefined {
  // Direct equality
  if (termEquals(left, right)) return true;

  // Check if both are literals with different values
  if (left.tag === "literal" && right.tag === "literal") {
    return left.value === right.value;
  }

  // Look for equality facts
  for (const fact of facts) {
    if (fact.tag === "eq") {
      // If we know left == X and right == X, then left == right
      if (termEquals(fact.left, left) && termEquals(fact.right, right)) return true;
      if (termEquals(fact.left, right) && termEquals(fact.right, left)) return true;

      // Transitivity: if left == X and X == right, then left == right
      if (termEquals(fact.left, left)) {
        const transResult = proveEquality(
          facts.filter((f) => f !== fact),
          fact.right,
          right
        );
        if (transResult === true) return true;
      }
      if (termEquals(fact.right, left)) {
        const transResult = proveEquality(
          facts.filter((f) => f !== fact),
          fact.left,
          right
        );
        if (transResult === true) return true;
      }
    }

    // If we know left != right, equality is false
    if (fact.tag === "neq") {
      if (
        (termEquals(fact.left, left) && termEquals(fact.right, right)) ||
        (termEquals(fact.left, right) && termEquals(fact.right, left))
      ) {
        return false;
      }
    }
  }

  return undefined;
}

/**
 * Try to prove left < right using known facts and transitivity.
 */
function proveLessThan(
  facts: Constraint[],
  left: ConstraintTerm,
  right: ConstraintTerm
): boolean | undefined {
  // Check literals directly
  if (left.tag === "literal" && right.tag === "literal") {
    if (typeof left.value === "number" && typeof right.value === "number") {
      return left.value < right.value;
    }
  }

  // Direct fact lookup
  for (const fact of facts) {
    if (fact.tag === "lt") {
      if (termEquals(fact.left, left) && termEquals(fact.right, right)) {
        return true;
      }
    }
    if (fact.tag === "lte") {
      // a <= b doesn't prove a < b by itself, but helps with transitivity
    }
    if (fact.tag === "gt") {
      // a > b means b < a
      if (termEquals(fact.left, right) && termEquals(fact.right, left)) {
        return true;
      }
    }
    if (fact.tag === "gte") {
      // a >= b means b <= a, which proves !(b > a), i.e., !(a < b) is not proven
      if (termEquals(fact.left, right) && termEquals(fact.right, left)) {
        // We know right >= left, so left < right could still be true or false
      }
      if (termEquals(fact.left, left) && termEquals(fact.right, right)) {
        // We know left >= right, so left < right is false
        return false;
      }
    }
  }

  // Transitivity: if left < X and X < right, then left < right
  // Or: if left < X and X <= right, then left < right
  // Or: if left <= X and X < right, then left < right
  for (const fact of facts) {
    if (fact.tag === "lt" && termEquals(fact.left, left)) {
      // We have left < fact.right, now check if fact.right <= right
      const middleLtRight = proveLessThan(
        facts.filter((f) => f !== fact),
        fact.right,
        right
      );
      if (middleLtRight === true) return true;

      // Check if fact.right == right
      const middleEqRight = proveEquality(facts, fact.right, right);
      if (middleEqRight === true) return true;
    }

    if (fact.tag === "lte" && termEquals(fact.left, left)) {
      // We have left <= fact.right, now check if fact.right < right
      const middleLtRight = proveLessThan(
        facts.filter((f) => f !== fact),
        fact.right,
        right
      );
      if (middleLtRight === true) return true;
    }
  }

  return undefined;
}

/**
 * Debug: print all facts in a context.
 */
export function debugContext(ctx: RefinementContext): string {
  const facts = allFacts(ctx);
  if (facts.length === 0) return "(no facts)";
  return facts.map(constraintToString).join(", ");
}
