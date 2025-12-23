/**
 * Constraints as Types
 *
 * Types are represented as constraints - logical predicates that values must satisfy.
 * This unifies traditional types (isNumber, isString) with refinements (x > 0, x == 5).
 */

// ============================================================================
// Constraint Types
// ============================================================================

export type Constraint =
  // Classification constraints (what traditional "types" become)
  | { tag: "isNumber" }
  | { tag: "isString" }
  | { tag: "isBool" }
  | { tag: "isNull" }
  | { tag: "isObject" }
  | { tag: "isArray" }
  | { tag: "isFunction" }

  // Value constraints
  | { tag: "equals", value: unknown }

  // Comparison constraints (for number refinements)
  | { tag: "gt", bound: number }
  | { tag: "gte", bound: number }
  | { tag: "lt", bound: number }
  | { tag: "lte", bound: number }

  // Structure constraints
  | { tag: "hasField", name: string, constraint: Constraint }
  | { tag: "elements", constraint: Constraint }    // homogeneous array elements
  | { tag: "length", constraint: Constraint }      // array/string length
  | { tag: "elementAt", index: number, constraint: Constraint }  // tuple element

  // Logical constraints
  | { tag: "and", constraints: Constraint[] }
  | { tag: "or", constraints: Constraint[] }
  | { tag: "not", constraint: Constraint }
  | { tag: "never" }  // bottom - no value satisfies this (contradiction)
  | { tag: "any" }    // top - all values satisfy this (unknown)

  // Inference variable (for type inference)
  | { tag: "var", id: number };

// ============================================================================
// Constructors
// ============================================================================

export const isNumber: Constraint = { tag: "isNumber" };
export const isString: Constraint = { tag: "isString" };
export const isBool: Constraint = { tag: "isBool" };
export const isNull: Constraint = { tag: "isNull" };
export const isObject: Constraint = { tag: "isObject" };
export const isArray: Constraint = { tag: "isArray" };
export const isFunction: Constraint = { tag: "isFunction" };
export const neverC: Constraint = { tag: "never" };
export const anyC: Constraint = { tag: "any" };
// Aliases for cleaner code
export { neverC as never, anyC as any };

export const equals = (value: unknown): Constraint => ({ tag: "equals", value });
export const gt = (bound: number): Constraint => ({ tag: "gt", bound });
export const gte = (bound: number): Constraint => ({ tag: "gte", bound });
export const lt = (bound: number): Constraint => ({ tag: "lt", bound });
export const lte = (bound: number): Constraint => ({ tag: "lte", bound });

export const hasField = (name: string, constraint: Constraint): Constraint =>
  ({ tag: "hasField", name, constraint });

export const elements = (constraint: Constraint): Constraint =>
  ({ tag: "elements", constraint });

export const length = (constraint: Constraint): Constraint =>
  ({ tag: "length", constraint });

export const elementAt = (index: number, constraint: Constraint): Constraint =>
  ({ tag: "elementAt", index, constraint });

export const and = (...constraints: Constraint[]): Constraint => {
  if (constraints.length === 0) return anyC;
  if (constraints.length === 1) return constraints[0];
  return { tag: "and", constraints };
};

export const or = (...constraints: Constraint[]): Constraint => {
  if (constraints.length === 0) return neverC;
  if (constraints.length === 1) return constraints[0];
  return { tag: "or", constraints };
};

export const not = (constraint: Constraint): Constraint => ({ tag: "not", constraint });

export const cvar = (id: number): Constraint => ({ tag: "var", id });

// ============================================================================
// Classification Helpers
// ============================================================================

const CLASSIFICATION_TAGS = ["isNumber", "isString", "isBool", "isNull", "isObject", "isArray", "isFunction"] as const;
type ClassificationTag = typeof CLASSIFICATION_TAGS[number];

function isClassification(c: Constraint): c is Constraint & { tag: ClassificationTag } {
  return CLASSIFICATION_TAGS.includes(c.tag as ClassificationTag);
}

// Disjoint pairs - these classifications cannot both be true
const DISJOINT_PAIRS: [ClassificationTag, ClassificationTag][] = [
  ["isNumber", "isString"],
  ["isNumber", "isBool"],
  ["isNumber", "isNull"],
  ["isNumber", "isObject"],
  ["isNumber", "isArray"],
  ["isNumber", "isFunction"],
  ["isString", "isBool"],
  ["isString", "isNull"],
  ["isString", "isObject"],
  ["isString", "isArray"],
  ["isString", "isFunction"],
  ["isBool", "isNull"],
  ["isBool", "isObject"],
  ["isBool", "isArray"],
  ["isBool", "isFunction"],
  ["isNull", "isObject"],
  ["isNull", "isArray"],
  ["isNull", "isFunction"],
  // Note: isArray and isFunction are subtypes of isObject in JS
  // but we treat them as disjoint for simplicity
  ["isArray", "isFunction"],
];

function areDisjoint(a: ClassificationTag, b: ClassificationTag): boolean {
  return DISJOINT_PAIRS.some(([x, y]) =>
    (x === a && y === b) || (x === b && y === a)
  );
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Check if a constraint is definitely never (quick structural check).
 */
export function isNever(c: Constraint): boolean {
  return c.tag === "never";
}

/**
 * Check if a constraint is any (no information).
 */
export function isAny(c: Constraint): boolean {
  return c.tag === "any";
}

/**
 * Flatten nested ANDs into a single array.
 */
function flattenAnd(c: Constraint): Constraint[] {
  if (c.tag === "and") {
    return c.constraints.flatMap(flattenAnd);
  }
  return [c];
}

/**
 * Flatten nested ORs into a single array.
 */
function flattenOr(c: Constraint): Constraint[] {
  if (c.tag === "or") {
    return c.constraints.flatMap(flattenOr);
  }
  return [c];
}

/**
 * Check if two constraints are structurally equal.
 */
export function constraintEquals(a: Constraint, b: Constraint): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    case "isNumber":
    case "isString":
    case "isBool":
    case "isNull":
    case "isObject":
    case "isArray":
    case "isFunction":
    case "never":
    case "any":
      return true;

    case "equals":
      return a.value === (b as typeof a).value;

    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return a.bound === (b as typeof a).bound;

    case "hasField":
      return a.name === (b as typeof a).name &&
             constraintEquals(a.constraint, (b as typeof a).constraint);

    case "elements":
    case "length":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

    case "elementAt":
      return a.index === (b as typeof a).index &&
             constraintEquals(a.constraint, (b as typeof a).constraint);

    case "and":
    case "or": {
      const bConstraints = (b as typeof a).constraints;
      if (a.constraints.length !== bConstraints.length) return false;
      return a.constraints.every((c, i) => constraintEquals(c, bConstraints[i]));
    }

    case "not":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

    case "var":
      return a.id === (b as typeof a).id;
  }
}

/**
 * Remove duplicate constraints from an array.
 */
function dedupe(constraints: Constraint[]): Constraint[] {
  const result: Constraint[] = [];
  for (const c of constraints) {
    if (!result.some(r => constraintEquals(r, c))) {
      result.push(c);
    }
  }
  return result;
}

/**
 * Check for contradictions in a flat list of AND'd constraints.
 * Returns true if contradiction found.
 */
function hasContradiction(constraints: Constraint[]): boolean {
  const classifications: ClassificationTag[] = [];
  const equalsValues: unknown[] = [];
  let hasGt: number | null = null;
  let hasGte: number | null = null;
  let hasLt: number | null = null;
  let hasLte: number | null = null;
  // Track hasField constraints by field name for contradiction detection
  const fieldConstraints: Map<string, Constraint[]> = new Map();

  for (const c of constraints) {
    // Check for explicit never
    if (c.tag === "never") return true;

    // Check classification conflicts
    if (isClassification(c)) {
      for (const existing of classifications) {
        if (areDisjoint(existing, c.tag)) {
          return true;
        }
      }
      classifications.push(c.tag);
    }

    // Check equals conflicts
    if (c.tag === "equals") {
      for (const existing of equalsValues) {
        if (existing !== c.value) {
          return true;  // equals(5) AND equals(6) is contradiction
        }
      }
      equalsValues.push(c.value);

      // Check equals vs classification
      for (const cls of classifications) {
        if (!valueMatchesClassification(c.value, cls)) {
          return true;  // equals(5) AND isString is contradiction
        }
      }
    }

    // Track comparison bounds
    if (c.tag === "gt") hasGt = hasGt !== null ? Math.max(hasGt, c.bound) : c.bound;
    if (c.tag === "gte") hasGte = hasGte !== null ? Math.max(hasGte, c.bound) : c.bound;
    if (c.tag === "lt") hasLt = hasLt !== null ? Math.min(hasLt, c.bound) : c.bound;
    if (c.tag === "lte") hasLte = hasLte !== null ? Math.min(hasLte, c.bound) : c.bound;

    // Track hasField constraints for conflict detection
    if (c.tag === "hasField") {
      const existing = fieldConstraints.get(c.name) || [];
      existing.push(c.constraint);
      fieldConstraints.set(c.name, existing);
    }
  }

  // Check comparison contradictions
  const lowerBound = Math.max(hasGt ?? -Infinity, (hasGte ?? -Infinity) - 0.0001);
  const upperBound = Math.min(hasLt ?? Infinity, (hasLte ?? Infinity) + 0.0001);
  if (lowerBound >= upperBound && (hasGt !== null || hasGte !== null) && (hasLt !== null || hasLte !== null)) {
    // More precise check
    if (hasGt !== null && hasLt !== null && hasGt >= hasLt) return true;
    if (hasGt !== null && hasLte !== null && hasGt >= hasLte) return true;
    if (hasGte !== null && hasLt !== null && hasGte >= hasLt) return true;
    if (hasGte !== null && hasLte !== null && hasGte > hasLte) return true;
  }

  // Check equals vs comparison bounds
  for (const val of equalsValues) {
    if (typeof val === "number") {
      if (hasGt !== null && val <= hasGt) return true;
      if (hasGte !== null && val < hasGte) return true;
      if (hasLt !== null && val >= hasLt) return true;
      if (hasLte !== null && val > hasLte) return true;
    }
  }

  // Check hasField contradictions: same field with conflicting constraints
  for (const [, fieldVals] of fieldConstraints) {
    if (fieldVals.length > 1) {
      // Check if combining these field constraints creates a contradiction
      // Most common case: two equals() constraints with different values
      const equalsVals = fieldVals.filter(c => c.tag === "equals") as { tag: "equals", value: unknown }[];
      if (equalsVals.length > 1) {
        const firstVal = equalsVals[0].value;
        for (let i = 1; i < equalsVals.length; i++) {
          if (equalsVals[i].value !== firstVal) {
            return true;  // hasField("x", equals(1)) AND hasField("x", equals(2)) is contradiction
          }
        }
      }
      // Recursively check if field constraints are contradictory
      const unified = simplify(and(...fieldVals));
      if (isNever(unified)) return true;
    }
  }

  return false;
}

function valueMatchesClassification(value: unknown, cls: ClassificationTag): boolean {
  switch (cls) {
    case "isNumber": return typeof value === "number";
    case "isString": return typeof value === "string";
    case "isBool": return typeof value === "boolean";
    case "isNull": return value === null;
    case "isObject": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "isArray": return Array.isArray(value);
    case "isFunction": return typeof value === "function";
  }
}

/**
 * Simplify a constraint by:
 * - Flattening nested AND/OR
 * - Removing duplicates
 * - Detecting contradictions (→ never)
 * - Removing any from AND, never from OR
 */
export function simplify(c: Constraint): Constraint {
  switch (c.tag) {
    case "isNumber":
    case "isString":
    case "isBool":
    case "isNull":
    case "isObject":
    case "isArray":
    case "isFunction":
    case "equals":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "never":
    case "any":
    case "var":
      return c;

    case "hasField":
      return hasField(c.name, simplify(c.constraint));

    case "elements":
      return elements(simplify(c.constraint));

    case "length":
      return length(simplify(c.constraint));

    case "elementAt":
      return elementAt(c.index, simplify(c.constraint));

    case "not": {
      const inner = simplify(c.constraint);
      if (inner.tag === "never") return anyC;
      if (inner.tag === "any") return neverC;
      if (inner.tag === "not") return inner.constraint;
      return not(inner);
    }

    case "and": {
      let flat = flattenAnd(c).map(simplify);

      // Remove any (identity for AND)
      flat = flat.filter(x => x.tag !== "any");

      // If any is never, result is never
      if (flat.some(isNever)) return neverC;

      // Dedupe
      flat = dedupe(flat);

      // Check for contradictions
      if (hasContradiction(flat)) return neverC;

      if (flat.length === 0) return anyC;
      if (flat.length === 1) return flat[0];
      return { tag: "and", constraints: flat };
    }

    case "or": {
      let flat = flattenOr(c).map(simplify);

      // Remove never (identity for OR)
      flat = flat.filter(x => x.tag !== "never");

      // If any is any, result is any
      if (flat.some(isAny)) return anyC;

      // Dedupe
      flat = dedupe(flat);

      if (flat.length === 0) return neverC;
      if (flat.length === 1) return flat[0];
      return { tag: "or", constraints: flat };
    }
  }
}

/**
 * Check if constraint `a` implies constraint `b`.
 * This is the subtyping relation: a <: b means every value satisfying a also satisfies b.
 */
export function implies(a: Constraint, b: Constraint): boolean {
  // Simplify first
  const sa = simplify(a);
  const sb = simplify(b);

  // Handle special cases - use string comparison to avoid TypeScript narrowing issues
  const aTag = sa.tag as string;
  const bTag = sb.tag as string;

  // never implies everything
  if (aTag === "never") return true;

  // everything implies any
  if (bTag === "any") return true;

  // any only implies any
  if (aTag === "any") return bTag === "any";

  // nothing implies never (except never)
  if (bTag === "never") return aTag === "never";

  // Same constraint
  if (constraintEquals(sa, sb)) return true;

  // equals(v) implies classification if v matches
  if (sa.tag === "equals" && isClassification(sb)) {
    return valueMatchesClassification(sa.value, sb.tag);
  }

  // equals(5) implies gt(3) if 5 > 3
  if (sa.tag === "equals" && typeof sa.value === "number") {
    if (sb.tag === "gt") return sa.value > sb.bound;
    if (sb.tag === "gte") return sa.value >= sb.bound;
    if (sb.tag === "lt") return sa.value < sb.bound;
    if (sb.tag === "lte") return sa.value <= sb.bound;
  }

  // gt(5) implies gt(3)
  if (sa.tag === "gt" && sb.tag === "gt") return sa.bound >= sb.bound;
  if (sa.tag === "gt" && sb.tag === "gte") return sa.bound >= sb.bound;
  if (sa.tag === "gte" && sb.tag === "gte") return sa.bound >= sb.bound;
  if (sa.tag === "lt" && sb.tag === "lt") return sa.bound <= sb.bound;
  if (sa.tag === "lt" && sb.tag === "lte") return sa.bound <= sb.bound;
  if (sa.tag === "lte" && sb.tag === "lte") return sa.bound <= sb.bound;

  // and(A, B) implies A, and(A, B) implies B
  if (sa.tag === "and") {
    // If any conjunct implies b, then a implies b
    if (sa.constraints.some(c => implies(c, sb))) return true;
  }

  // A implies or(A, B)
  if (sb.tag === "or") {
    if (sb.constraints.some(c => implies(sa, c))) return true;
  }

  // and(A, B) implies and(C, D) if we can match each of C, D
  if (sa.tag === "and" && sb.tag === "and") {
    return sb.constraints.every(bc =>
      sa.constraints.some(ac => implies(ac, bc))
    );
  }

  // hasField implication: hasField(n, A) implies hasField(n, B) if A implies B
  if (sa.tag === "hasField" && sb.tag === "hasField") {
    return sa.name === sb.name && implies(sa.constraint, sb.constraint);
  }

  // elements implication
  if (sa.tag === "elements" && sb.tag === "elements") {
    return implies(sa.constraint, sb.constraint);
  }

  // length implication
  if (sa.tag === "length" && sb.tag === "length") {
    return implies(sa.constraint, sb.constraint);
  }

  // elementAt implication
  if (sa.tag === "elementAt" && sb.tag === "elementAt") {
    return sa.index === sb.index && implies(sa.constraint, sb.constraint);
  }

  return false;
}

/**
 * Unify two constraints by taking their conjunction.
 * Returns simplified result (may be `never` if contradictory).
 */
export function unify(a: Constraint, b: Constraint): Constraint {
  return simplify(and(a, b));
}

/**
 * Narrow a constraint by intersecting with additional information.
 * Same as unify but semantically for control flow refinement.
 */
export function narrow(base: Constraint, refinement: Constraint): Constraint {
  return unify(base, refinement);
}

/**
 * Narrow an OR constraint by filtering out branches that contradict the refinement.
 */
export function narrowOr(c: Constraint, refinement: Constraint): Constraint {
  if (c.tag !== "or") {
    return narrow(c, refinement);
  }

  const surviving = c.constraints
    .map(branch => narrow(branch, refinement))
    .filter(branch => !isNever(branch));

  if (surviving.length === 0) return neverC;
  if (surviving.length === 1) return surviving[0];
  return simplify(or(...surviving));
}

// ============================================================================
// Pretty Printing
// ============================================================================

export function constraintToString(c: Constraint): string {
  switch (c.tag) {
    case "isNumber": return "number";
    case "isString": return "string";
    case "isBool": return "boolean";
    case "isNull": return "null";
    case "isObject": return "object";
    case "isArray": return "array";
    case "isFunction": return "function";
    case "never": return "never";
    case "any": return "any";

    case "equals":
      return JSON.stringify(c.value);

    case "gt": return `> ${c.bound}`;
    case "gte": return `>= ${c.bound}`;
    case "lt": return `< ${c.bound}`;
    case "lte": return `<= ${c.bound}`;

    case "hasField":
      return `{ ${c.name}: ${constraintToString(c.constraint)} }`;

    case "elements":
      return `${constraintToString(c.constraint)}[]`;

    case "length":
      return `length(${constraintToString(c.constraint)})`;

    case "elementAt":
      return `[${c.index}]: ${constraintToString(c.constraint)}`;

    case "and": {
      // Try to format nicely for common cases
      const parts = c.constraints;

      // Check if it's a literal type: and(isNumber, equals(5)) -> "5"
      if (parts.length === 2) {
        const hasClassification = parts.find(p => isClassification(p));
        const hasEquals = parts.find(p => p.tag === "equals") as { tag: "equals", value: unknown } | undefined;
        if (hasClassification && hasEquals) {
          return JSON.stringify(hasEquals.value);
        }
      }

      // Check if it's an object type
      const hasObject = parts.find(p => p.tag === "isObject");
      const fields = parts.filter(p => p.tag === "hasField") as { tag: "hasField", name: string, constraint: Constraint }[];
      if (hasObject && fields.length > 0 && fields.length === parts.length - 1) {
        const fieldStrs = fields.map(f => `${f.name}: ${constraintToString(f.constraint)}`);
        return `{ ${fieldStrs.join(", ")} }`;
      }

      return parts.map(constraintToString).join(" & ");
    }

    case "or":
      return c.constraints.map(constraintToString).join(" | ");

    case "not":
      return `not(${constraintToString(c.constraint)})`;

    case "var":
      return `?${c.id}`;
  }
}
