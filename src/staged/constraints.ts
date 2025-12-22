/**
 * Constraint representation for the refinement system.
 * Based on docs/staged-architecture.md Part 2.1
 */

/**
 * A constraint term - something we can reason about.
 */
export type ConstraintTerm =
  | { tag: "symbol"; name: string }
  | { tag: "literal"; value: unknown }
  | { tag: "field"; object: ConstraintTerm; field: string };

/**
 * A constraint - a fact we know to be true.
 */
export type Constraint =
  | { tag: "eq"; left: ConstraintTerm; right: ConstraintTerm }
  | { tag: "neq"; left: ConstraintTerm; right: ConstraintTerm }
  | { tag: "lt"; left: ConstraintTerm; right: ConstraintTerm }
  | { tag: "lte"; left: ConstraintTerm; right: ConstraintTerm }
  | { tag: "gt"; left: ConstraintTerm; right: ConstraintTerm }
  | { tag: "gte"; left: ConstraintTerm; right: ConstraintTerm }
  | { tag: "and"; left: Constraint; right: Constraint }
  | { tag: "or"; left: Constraint; right: Constraint }
  | { tag: "not"; inner: Constraint };

// Constraint term constructors
export const symTerm = (name: string): ConstraintTerm => ({ tag: "symbol", name });

export const litTerm = (value: unknown): ConstraintTerm => ({ tag: "literal", value });

export const fieldTerm = (object: ConstraintTerm, field: string): ConstraintTerm => ({
  tag: "field",
  object,
  field,
});

// Constraint constructors
export const eqConstraint = (left: ConstraintTerm, right: ConstraintTerm): Constraint => ({
  tag: "eq",
  left,
  right,
});

export const neqConstraint = (left: ConstraintTerm, right: ConstraintTerm): Constraint => ({
  tag: "neq",
  left,
  right,
});

export const ltConstraint = (left: ConstraintTerm, right: ConstraintTerm): Constraint => ({
  tag: "lt",
  left,
  right,
});

export const lteConstraint = (left: ConstraintTerm, right: ConstraintTerm): Constraint => ({
  tag: "lte",
  left,
  right,
});

export const gtConstraint = (left: ConstraintTerm, right: ConstraintTerm): Constraint => ({
  tag: "gt",
  left,
  right,
});

export const gteConstraint = (left: ConstraintTerm, right: ConstraintTerm): Constraint => ({
  tag: "gte",
  left,
  right,
});

export const andConstraint = (left: Constraint, right: Constraint): Constraint => ({
  tag: "and",
  left,
  right,
});

export const orConstraint = (left: Constraint, right: Constraint): Constraint => ({
  tag: "or",
  left,
  right,
});

export const notConstraint = (inner: Constraint): Constraint => ({ tag: "not", inner });

/**
 * Check if two constraint terms are structurally equal.
 */
export function termEquals(a: ConstraintTerm, b: ConstraintTerm): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    case "symbol":
      return a.name === (b as typeof a).name;
    case "literal":
      return a.value === (b as typeof a).value;
    case "field":
      return a.field === (b as typeof a).field && termEquals(a.object, (b as typeof a).object);
  }
}

/**
 * Check if two constraints are structurally equal.
 */
export function constraintEquals(a: Constraint, b: Constraint): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return (
        termEquals(a.left, (b as typeof a).left) && termEquals(a.right, (b as typeof a).right)
      );
    case "and":
    case "or":
      return (
        constraintEquals(a.left, (b as typeof a).left) &&
        constraintEquals(a.right, (b as typeof a).right)
      );
    case "not":
      return constraintEquals(a.inner, (b as typeof a).inner);
  }
}

/**
 * Negate a constraint (applying De Morgan's laws where applicable).
 */
export function negateConstraint(c: Constraint): Constraint {
  switch (c.tag) {
    case "not":
      return c.inner;
    case "eq":
      return { tag: "neq", left: c.left, right: c.right };
    case "neq":
      return { tag: "eq", left: c.left, right: c.right };
    case "lt":
      return { tag: "gte", left: c.left, right: c.right };
    case "lte":
      return { tag: "gt", left: c.left, right: c.right };
    case "gt":
      return { tag: "lte", left: c.left, right: c.right };
    case "gte":
      return { tag: "lt", left: c.left, right: c.right };
    case "and":
      // !(a && b) = !a || !b
      return { tag: "or", left: negateConstraint(c.left), right: negateConstraint(c.right) };
    case "or":
      // !(a || b) = !a && !b
      return { tag: "and", left: negateConstraint(c.left), right: negateConstraint(c.right) };
  }
}

/**
 * Convert constraint to string for debugging.
 */
export function constraintToString(c: Constraint): string {
  switch (c.tag) {
    case "eq":
      return `${termToString(c.left)} == ${termToString(c.right)}`;
    case "neq":
      return `${termToString(c.left)} != ${termToString(c.right)}`;
    case "lt":
      return `${termToString(c.left)} < ${termToString(c.right)}`;
    case "lte":
      return `${termToString(c.left)} <= ${termToString(c.right)}`;
    case "gt":
      return `${termToString(c.left)} > ${termToString(c.right)}`;
    case "gte":
      return `${termToString(c.left)} >= ${termToString(c.right)}`;
    case "and":
      return `(${constraintToString(c.left)} && ${constraintToString(c.right)})`;
    case "or":
      return `(${constraintToString(c.left)} || ${constraintToString(c.right)})`;
    case "not":
      return `!(${constraintToString(c.inner)})`;
  }
}

export function termToString(t: ConstraintTerm): string {
  switch (t.tag) {
    case "symbol":
      return t.name;
    case "literal":
      return JSON.stringify(t.value);
    case "field":
      return `${termToString(t.object)}.${t.field}`;
  }
}
