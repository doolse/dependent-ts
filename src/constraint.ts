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
  | { tag: "isUndefined" }
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
  | { tag: "index", constraint: Constraint }  // constraint for unlisted fields (like TS index signature)

  // Logical constraints
  | { tag: "and", constraints: Constraint[] }
  | { tag: "or", constraints: Constraint[] }
  | { tag: "not", constraint: Constraint }
  | { tag: "never" }  // bottom - no value satisfies this (contradiction)
  | { tag: "any" }    // top - all values satisfy this (unknown)

  // Inference variable (for type inference)
  | { tag: "var", id: number }

  // Meta-constraint: marks a value as being a type
  | { tag: "isType", constraint: Constraint }

  // Recursive types (μ types)
  | { tag: "rec", var: string, body: Constraint }    // μX. body (recursive type binder)
  | { tag: "recVar", var: string }

  // Predicate satisfaction (opaque function reference)
  // Used when a filter predicate can't be analyzed into constraints
  | { tag: "satisfies", predicate: unknown };

// ============================================================================
// Constructors
// ============================================================================

export const isNumber: Constraint = { tag: "isNumber" };
export const isString: Constraint = { tag: "isString" };
export const isBool: Constraint = { tag: "isBool" };
export const isNull: Constraint = { tag: "isNull" };
export const isUndefined: Constraint = { tag: "isUndefined" };
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

export const indexSig = (constraint: Constraint): Constraint =>
  ({ tag: "index", constraint });

/**
 * Create a tuple type constraint.
 * Combines isArray with element constraints at each position and length constraint.
 */
export const tupleConstraint = (elementConstraints: Constraint[]): Constraint => {
  const constraints: Constraint[] = [isArray];
  for (let i = 0; i < elementConstraints.length; i++) {
    constraints.push(elementAt(i, elementConstraints[i]));
  }
  constraints.push(length(equals(elementConstraints.length)));
  return and(...constraints);
};

/**
 * Create an array type constraint with a specific element type.
 */
export const arrayOfConstraint = (elementConstraint: Constraint): Constraint =>
  and(isArray, elements(elementConstraint));

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

// Meta-constraint: this value is a type representing the given constraint
export const isType = (constraint: Constraint): Constraint =>
  ({ tag: "isType", constraint });

// Simple "is some type" check (type representing any constraint)
export const isTypeC: Constraint = { tag: "isType", constraint: anyC };

// Recursive types
export const rec = (varName: string, body: Constraint): Constraint =>
  ({ tag: "rec", var: varName, body });

export const recVar = (varName: string): Constraint =>
  ({ tag: "recVar", var: varName });

// Predicate satisfaction (for opaque predicates)
export const satisfies = (predicate: unknown): Constraint =>
  ({ tag: "satisfies", predicate });

// ============================================================================
// Classification Helpers
// ============================================================================

const CLASSIFICATION_TAGS = ["isNumber", "isString", "isBool", "isNull", "isUndefined", "isObject", "isArray", "isFunction"] as const;
type ClassificationTag = typeof CLASSIFICATION_TAGS[number];

function isClassification(c: Constraint): c is Constraint & { tag: ClassificationTag } {
  return CLASSIFICATION_TAGS.includes(c.tag as ClassificationTag);
}

// Disjoint pairs - these classifications cannot both be true
const DISJOINT_PAIRS: [ClassificationTag, ClassificationTag][] = [
  ["isNumber", "isString"],
  ["isNumber", "isBool"],
  ["isNumber", "isNull"],
  ["isNumber", "isUndefined"],
  ["isNumber", "isObject"],
  ["isNumber", "isArray"],
  ["isNumber", "isFunction"],
  ["isString", "isBool"],
  ["isString", "isNull"],
  ["isString", "isUndefined"],
  ["isString", "isObject"],
  ["isString", "isArray"],
  ["isString", "isFunction"],
  ["isBool", "isNull"],
  ["isBool", "isUndefined"],
  ["isBool", "isObject"],
  ["isBool", "isArray"],
  ["isBool", "isFunction"],
  ["isNull", "isUndefined"],
  ["isNull", "isObject"],
  ["isNull", "isArray"],
  ["isNull", "isFunction"],
  ["isUndefined", "isObject"],
  ["isUndefined", "isArray"],
  ["isUndefined", "isFunction"],
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
    case "isUndefined":
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

    case "index":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

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

    case "isType":
      return constraintEquals(a.constraint, (b as typeof a).constraint);

    case "rec":
      return a.var === (b as typeof a).var &&
             constraintEquals(a.body, (b as typeof a).body);

    case "recVar":
      return a.var === (b as typeof a).var;

    case "satisfies":
      // Reference equality for predicates
      return a.predicate === (b as typeof a).predicate;
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
      // Also check: if we see a classification, check against existing equals values
      for (const existingVal of equalsValues) {
        if (!valueMatchesClassification(existingVal, c.tag)) {
          return true;  // isString after seeing equals(5) is contradiction
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
    case "isUndefined": return value === undefined;
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
    case "isUndefined":
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
    case "satisfies":
      return c;

    case "hasField":
      return hasField(c.name, simplify(c.constraint));

    case "elements":
      return elements(simplify(c.constraint));

    case "length":
      return length(simplify(c.constraint));

    case "elementAt":
      return elementAt(c.index, simplify(c.constraint));

    case "index":
      return indexSig(simplify(c.constraint));

    case "isType":
      return isType(simplify(c.constraint));

    case "rec":
      return rec(c.var, simplify(c.body));

    case "recVar":
      return c;  // recVar is already simple

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

  // JS hierarchy: arrays and functions are objects
  if (sa.tag === "isArray" && sb.tag === "isObject") return true;
  if (sa.tag === "isFunction" && sb.tag === "isObject") return true;

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
  // gte(n) implies gt(m) if n > m (x >= 10 means x > 5)
  if (sa.tag === "gte" && sb.tag === "gt") return sa.bound > sb.bound;
  // lte(n) implies lt(m) if n < m (x <= 5 means x < 10)
  if (sa.tag === "lte" && sb.tag === "lt") return sa.bound < sb.bound;

  // and(A, B) implies A, and(A, B) implies B
  if (sa.tag === "and") {
    // If any conjunct implies b, then a implies b
    if (sa.constraints.some(c => implies(c, sb))) return true;

    // Check if AND contains gte(n) and lte(n) which implies equals(n)
    if (sb.tag === "equals" && typeof sb.value === "number") {
      let hasGte: number | null = null;
      let hasLte: number | null = null;
      for (const c of sa.constraints) {
        if (c.tag === "gte") hasGte = c.bound;
        if (c.tag === "lte") hasLte = c.bound;
      }
      if (hasGte !== null && hasLte !== null && hasGte === hasLte && hasGte === sb.value) {
        return true;  // gte(5) AND lte(5) implies equals(5)
      }
    }
  }

  // or(A, B) implies C if ALL alternatives imply C
  if (sa.tag === "or") {
    return sa.constraints.every(c => implies(c, sb));
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

  // index implication: index(A) implies index(B) if A implies B
  if (sa.tag === "index" && sb.tag === "index") {
    return implies(sa.constraint, sb.constraint);
  }

  // isType implication: isType(A) implies isType(B) if A implies B
  if (sa.tag === "isType" && sb.tag === "isType") {
    return implies(sa.constraint, sb.constraint);
  }

  // Recursive type implication using coinductive reasoning
  // rec X. A implies rec Y. B if A[X := rec X. A] implies B[Y := rec Y. B]
  if (sa.tag === "rec" && sb.tag === "rec") {
    // Check with assumption: use structural equality up to variable renaming
    // For a simple approach, we check if they are alpha-equivalent
    return impliesRec(sa, sb, new Set());
  }

  // When checking A implies rec X. B (where A is not rec), unroll: A implies B[X := rec X. B]
  // Example: isNull implies rec("List", or(isNull, ...)) unrolls to isNull implies or(isNull, ...)
  if (sb.tag === "rec") {
    const unrolled = substituteRecVar(sb.body, sb.var, sb);
    return implies(sa, unrolled);
  }

  // When checking rec X. A implies B (where B is not rec), unroll: A[X := rec X. A] implies B
  if (sa.tag === "rec") {
    const unrolled = substituteRecVar(sa.body, sa.var, sa);
    return implies(unrolled, sb);
  }

  // recVar only implies itself (handled by constraintEquals above)

  // satisfies(f) only implies satisfies(g) if f === g (handled by constraintEquals above)
  // Different predicates are treated as unrelated (can't prove implication)

  return false;
}

/**
 * Check if two recursive types are related using coinductive reasoning.
 * The 'assumptions' set tracks pairs we've already assumed to avoid infinite loops.
 */
function impliesRec(
  a: { tag: "rec"; var: string; body: Constraint },
  b: { tag: "rec"; var: string; body: Constraint },
  assumptions: Set<string>
): boolean {
  // Create a key for this assumption
  const key = `${a.var}:${b.var}`;

  // If we've already assumed this, it's true (coinductive)
  if (assumptions.has(key)) return true;

  // Add assumption and check body
  const newAssumptions = new Set(assumptions);
  newAssumptions.add(key);

  // Substitute recursive references and check
  // For simplicity, we'll check structural equality with variable renaming
  const aBody = substituteRecVar(a.body, a.var, recVar(b.var));
  return impliesWithAssumptions(aBody, b.body, newAssumptions);
}

/**
 * Substitute a recVar with another constraint.
 */
function substituteRecVar(c: Constraint, varName: string, replacement: Constraint): Constraint {
  switch (c.tag) {
    case "recVar":
      return c.var === varName ? replacement : c;

    case "rec":
      // Don't substitute inside a binding with the same name (shadowing)
      if (c.var === varName) return c;
      return rec(c.var, substituteRecVar(c.body, varName, replacement));

    case "and":
      return and(...c.constraints.map(x => substituteRecVar(x, varName, replacement)));

    case "or":
      return or(...c.constraints.map(x => substituteRecVar(x, varName, replacement)));

    case "not":
      return not(substituteRecVar(c.constraint, varName, replacement));

    case "hasField":
      return hasField(c.name, substituteRecVar(c.constraint, varName, replacement));

    case "elements":
      return elements(substituteRecVar(c.constraint, varName, replacement));

    case "length":
      return length(substituteRecVar(c.constraint, varName, replacement));

    case "elementAt":
      return elementAt(c.index, substituteRecVar(c.constraint, varName, replacement));

    case "index":
      return indexSig(substituteRecVar(c.constraint, varName, replacement));

    case "isType":
      return isType(substituteRecVar(c.constraint, varName, replacement));

    default:
      return c;
  }
}

/**
 * Check implication with assumptions for coinductive reasoning.
 */
function impliesWithAssumptions(a: Constraint, b: Constraint, assumptions: Set<string>): boolean {
  const sa = simplify(a);
  const sb = simplify(b);

  // If both are recVar and we have an assumption for them, use it
  if (sa.tag === "recVar" && sb.tag === "recVar") {
    return sa.var === sb.var || assumptions.has(`${sa.var}:${sb.var}`);
  }

  // For rec types, use coinductive check
  if (sa.tag === "rec" && sb.tag === "rec") {
    return impliesRec(sa, sb, assumptions);
  }

  // Otherwise, fall back to regular implies
  return implies(sa, sb);
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
  // Handle NOT refinement specially
  if (refinement.tag === "not") {
    const negated = refinement.constraint;
    // If base implies the negated constraint, it's a contradiction
    if (implies(base, negated)) {
      return neverC;
    }
    // Otherwise, keep base (we can't prove contradiction)
    return base;
  }
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
    case "isUndefined": return "undefined";
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

    case "index":
      return `[string]: ${constraintToString(c.constraint)}`;

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
      const indexConstraint = parts.find(p => p.tag === "index") as { tag: "index", constraint: Constraint } | undefined;
      const isClosedEmpty = indexConstraint && indexConstraint.constraint.tag === "never";

      // Object with fields (possibly with index(never) for closed objects)
      if (hasObject && fields.length > 0) {
        const expectedParts = 1 + fields.length + (indexConstraint ? 1 : 0);
        if (parts.length === expectedParts) {
          const fieldStrs = fields.map(f => `${f.name}: ${constraintToString(f.constraint)}`);
          if (indexConstraint && !isClosedEmpty) {
            fieldStrs.push(`[string]: ${constraintToString(indexConstraint.constraint)}`);
          }
          return `{ ${fieldStrs.join(", ")} }`;
        }
      }

      // Empty closed object: { }
      if (hasObject && fields.length === 0 && isClosedEmpty && parts.length === 2) {
        return "{ }";
      }

      return parts.map(constraintToString).join(" & ");
    }

    case "or":
      return c.constraints.map(constraintToString).join(" | ");

    case "not":
      return `not(${constraintToString(c.constraint)})`;

    case "var":
      return `?${c.id}`;

    case "isType":
      return `Type<${constraintToString(c.constraint)}>`;

    case "rec":
      return `μ${c.var}. ${constraintToString(c.body)}`;

    case "recVar":
      return c.var;

    case "satisfies": {
      // Try to get a meaningful name from the predicate
      const pred = c.predicate as { tag?: string; name?: string };
      if (pred && typeof pred === "object") {
        if (pred.tag === "closure" && pred.name) {
          return `satisfies(${pred.name})`;
        }
        if (pred.tag === "builtin" && pred.name) {
          return `satisfies(${pred.name})`;
        }
      }
      return `satisfies(<fn>)`;
    }
  }
}

// ============================================================================
// Constraint Solving (for type inference)
// ============================================================================

/**
 * A substitution maps constraint variable IDs to constraints.
 */
export type Substitution = Map<number, Constraint>;

/**
 * Create an empty substitution.
 */
export function emptySubstitution(): Substitution {
  return new Map();
}

/**
 * Apply a substitution to a constraint, replacing variables with their bindings.
 */
export function applySubstitution(c: Constraint, sub: Substitution): Constraint {
  return applySubstitutionImpl(c, sub, new Set());
}

function applySubstitutionImpl(c: Constraint, sub: Substitution, seen: Set<number>): Constraint {
  switch (c.tag) {
    case "var":
      if (sub.has(c.id)) {
        // Avoid infinite loops when variable maps to itself or creates a cycle
        if (seen.has(c.id)) {
          return c;
        }
        seen.add(c.id);
        // Recursively apply in case the substitution contains more variables
        return applySubstitutionImpl(sub.get(c.id)!, sub, seen);
      }
      return c;

    case "and":
      return and(...c.constraints.map(x => applySubstitutionImpl(x, sub, seen)));

    case "or":
      return or(...c.constraints.map(x => applySubstitutionImpl(x, sub, seen)));

    case "not":
      return not(applySubstitutionImpl(c.constraint, sub, seen));

    case "hasField":
      return hasField(c.name, applySubstitutionImpl(c.constraint, sub, seen));

    case "elements":
      return elements(applySubstitutionImpl(c.constraint, sub, seen));

    case "length":
      return length(applySubstitutionImpl(c.constraint, sub, seen));

    case "elementAt":
      return elementAt(c.index, applySubstitutionImpl(c.constraint, sub, seen));

    case "index":
      return indexSig(applySubstitutionImpl(c.constraint, sub, seen));

    case "isType":
      return isType(applySubstitutionImpl(c.constraint, sub, seen));

    case "rec":
      return rec(c.var, applySubstitutionImpl(c.body, sub, seen));

    default:
      return c;
  }
}

/**
 * Get all free constraint variable IDs in a constraint.
 */
export function freeConstraintVars(c: Constraint): Set<number> {
  const vars = new Set<number>();

  function collect(c: Constraint): void {
    switch (c.tag) {
      case "var":
        vars.add(c.id);
        break;
      case "and":
      case "or":
        for (const child of c.constraints) collect(child);
        break;
      case "not":
      case "elements":
      case "length":
      case "isType":
      case "index":
        collect(c.constraint);
        break;
      case "hasField":
        collect(c.constraint);
        break;
      case "elementAt":
        collect(c.constraint);
        break;
      case "rec":
        collect(c.body);
        break;
    }
  }

  collect(c);
  return vars;
}

/**
 * Solve/unify two constraints, returning a substitution if successful.
 * Returns null if the constraints are inconsistent.
 */
export function solve(a: Constraint, b: Constraint): Substitution | null {
  const sub = emptySubstitution();
  if (solveInto(a, b, sub)) {
    return sub;
  }
  return null;
}

/**
 * Internal helper: solve and accumulate into existing substitution.
 */
function solveInto(a: Constraint, b: Constraint, sub: Substitution): boolean {
  // Apply current substitution first
  a = applySubstitution(a, sub);
  b = applySubstitution(b, sub);

  // Trivial cases
  if (constraintEquals(a, b)) return true;
  if (a.tag === "any" || b.tag === "any") return true;
  if (a.tag === "never" || b.tag === "never") return false;

  // Variable cases - this is the core of unification
  if (a.tag === "var") {
    // Occurs check: don't allow ?A = ... ?A ...
    if (freeConstraintVars(b).has(a.id)) {
      return false;  // Would create infinite type
    }
    sub.set(a.id, b);
    return true;
  }

  if (b.tag === "var") {
    if (freeConstraintVars(a).has(b.id)) {
      return false;
    }
    sub.set(b.id, a);
    return true;
  }

  // Same tag cases
  if (a.tag === b.tag) {
    switch (a.tag) {
      case "isNumber":
      case "isString":
      case "isBool":
      case "isNull":
      case "isUndefined":
      case "isObject":
      case "isArray":
      case "isFunction":
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
               solveInto(a.constraint, (b as typeof a).constraint, sub);

      case "elements":
        return solveInto(a.constraint, (b as typeof a).constraint, sub);

      case "length":
        return solveInto(a.constraint, (b as typeof a).constraint, sub);

      case "elementAt":
        return a.index === (b as typeof a).index &&
               solveInto(a.constraint, (b as typeof a).constraint, sub);

      case "index":
        return solveInto(a.constraint, (b as typeof a).constraint, sub);

      case "isType":
        return solveInto(a.constraint, (b as typeof a).constraint, sub);

      case "rec":
        // For recursive types, check body with var renaming
        return a.var === (b as typeof a).var &&
               solveInto(a.body, (b as typeof a).body, sub);

      case "recVar":
        return a.var === (b as typeof a).var;

      case "satisfies":
        // Reference equality for predicates
        return a.predicate === (b as typeof a).predicate;

      case "and": {
        const aConstraints = a.constraints;
        const bConstraints = (b as typeof a).constraints;

        // For each constraint in b (the pattern), find a matching constraint in a
        // This allows a to have extra constraints (subtyping: more constraints = more specific)
        for (const bC of bConstraints) {
          const bCSub = applySubstitution(bC, sub);

          // Try to find a constraint in a that matches/solves with this one from b
          let found = false;
          for (const aC of aConstraints) {
            const aCsub = applySubstitution(aC, sub);

            // Create a temporary substitution to test
            const tempSub = new Map(sub);
            if (solveInto(aCsub, bCSub, tempSub)) {
              // Merge temp substitution into main substitution
              for (const [id, c] of tempSub) {
                sub.set(id, c);
              }
              found = true;
              break;
            }
          }
          if (!found) return false;
        }
        return true;
      }

      case "or": {
        const aConstraints = a.constraints;
        const bConstraints = (b as typeof a).constraints;
        if (aConstraints.length !== bConstraints.length) return false;
        for (let i = 0; i < aConstraints.length; i++) {
          if (!solveInto(aConstraints[i], bConstraints[i], sub)) return false;
        }
        return true;
      }

      case "not":
        return solveInto(a.constraint, (b as typeof a).constraint, sub);
    }
  }

  // Handle and(A, B, ...) solving with a single constraint C
  // If any constraint in the AND matches C, we can unify
  if (a.tag === "and" && b.tag !== "and") {
    for (const aC of a.constraints) {
      const tempSub = new Map(sub);
      if (solveInto(aC, b, tempSub)) {
        for (const [id, c] of tempSub) {
          sub.set(id, c);
        }
        return true;
      }
    }
    return false;
  }

  // Different tags that might still unify
  // e.g., ?A could unify with isNumber, but isNumber can't unify with isString
  return false;
}

/**
 * Counter for generating fresh constraint variable IDs.
 */
let constraintVarCounter = 0;

/**
 * Reset the constraint variable counter (for testing).
 */
export function resetConstraintVarCounter(): void {
  constraintVarCounter = 0;
}

/**
 * Create a fresh constraint variable.
 */
export function freshCVar(): Constraint {
  return cvar(constraintVarCounter++);
}

/**
 * A constraint scheme: a constraint with universally quantified variables.
 * Used for let-polymorphism.
 */
export interface ConstraintScheme {
  quantified: number[];  // IDs of quantified variables
  constraint: Constraint;
}

/**
 * Generalize a constraint over free variables not in the environment.
 * Returns a constraint scheme.
 */
export function generalize(c: Constraint, envVars: Set<number>): ConstraintScheme {
  const freeVars = freeConstraintVars(c);
  const quantified: number[] = [];

  for (const v of freeVars) {
    if (!envVars.has(v)) {
      quantified.push(v);
    }
  }

  return { quantified, constraint: c };
}

/**
 * Instantiate a constraint scheme with fresh variables.
 */
export function instantiate(scheme: ConstraintScheme): Constraint {
  if (scheme.quantified.length === 0) {
    return scheme.constraint;
  }

  const sub = emptySubstitution();
  for (const v of scheme.quantified) {
    sub.set(v, freshCVar());
  }

  return applySubstitution(scheme.constraint, sub);
}

// ============================================================================
// Field Extraction Helpers (for reflection)
// ============================================================================

/**
 * Extract all field names from a constraint.
 * Returns an array of field names found in hasField constraints.
 * Handles recursive types (rec/recVar) and unions (or).
 * For unions, returns all fields that COULD exist (union of fields from all branches).
 */
export function extractAllFieldNames(constraint: Constraint): string[] {
  const fields = new Set<string>();

  function extract(c: Constraint): void {
    switch (c.tag) {
      case "hasField":
        fields.add(c.name);
        break;
      case "and":
        for (const sub of c.constraints) {
          extract(sub);
        }
        break;
      case "or":
        // For unions, collect fields from all branches
        for (const sub of c.constraints) {
          extract(sub);
        }
        break;
      case "rec":
        // Unwrap recursive type and look at the body
        extract(c.body);
        break;
      case "recVar":
        // Recursive variable reference - no fields here, don't recurse
        break;
      // Other constraint types don't contain field information
    }
  }

  extract(constraint);
  return Array.from(fields);
}

/**
 * Extract the constraint for a specific field from an object constraint.
 * Returns null if the field is not found.
 * Handles recursive types (rec/recVar) and unions (or).
 * For unions, returns a union of the field constraints from branches that have the field.
 */
export function extractFieldConstraint(constraint: Constraint, name: string): Constraint | null {
  function extract(c: Constraint): Constraint | null {
    switch (c.tag) {
      case "hasField":
        if (c.name === name) {
          return c.constraint;
        }
        return null;
      case "and":
        for (const sub of c.constraints) {
          const result = extract(sub);
          if (result !== null) {
            return result;
          }
        }
        return null;
      case "or": {
        // For unions, collect field constraints from all branches that have the field
        const fieldConstraints: Constraint[] = [];
        for (const sub of c.constraints) {
          const result = extract(sub);
          if (result !== null) {
            fieldConstraints.push(result);
          }
        }
        if (fieldConstraints.length === 0) {
          return null;
        }
        if (fieldConstraints.length === 1) {
          return fieldConstraints[0];
        }
        // Return union of all field constraints
        return or(...fieldConstraints);
      }
      case "rec":
        // Unwrap recursive type and look at the body
        return extract(c.body);
      case "recVar":
        // Recursive variable reference - no field info here
        return null;
      default:
        return null;
    }
  }

  return extract(constraint);
}
