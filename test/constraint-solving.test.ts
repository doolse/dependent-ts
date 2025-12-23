/**
 * Tests for Constraint Solving & Inference (Challenge 6)
 *
 * Constraint solving enables type inference by unifying constraint variables
 * with concrete constraints.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isObject,
  isArray,
  and,
  or,
  hasField,
  elements,
  cvar,
  constraintEquals,
  constraintToString,

  // Solving
  Substitution,
  emptySubstitution,
  applySubstitution,
  freeConstraintVars,
  solve,
  freshCVar,
  resetConstraintVarCounter,
  ConstraintScheme,
  generalize,
  instantiate,
} from "../src/index";

// ============================================================================
// Substitution Application
// ============================================================================

describe("Substitution Application", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  it("applies substitution to constraint variable", () => {
    const sub = emptySubstitution();
    sub.set(0, isNumber);

    const result = applySubstitution(cvar(0), sub);
    expect(constraintEquals(result, isNumber)).toBe(true);
  });

  it("leaves unbound variables unchanged", () => {
    const sub = emptySubstitution();
    sub.set(0, isNumber);

    const result = applySubstitution(cvar(1), sub);
    expect(result.tag).toBe("var");
    expect((result as any).id).toBe(1);
  });

  it("applies substitution inside AND", () => {
    const sub = emptySubstitution();
    sub.set(0, isNumber);
    sub.set(1, isString);

    const result = applySubstitution(and(cvar(0), cvar(1)), sub);
    expect(result.tag).toBe("and");
    const parts = (result as any).constraints;
    expect(constraintEquals(parts[0], isNumber)).toBe(true);
    expect(constraintEquals(parts[1], isString)).toBe(true);
  });

  it("applies substitution inside hasField", () => {
    const sub = emptySubstitution();
    sub.set(0, isNumber);

    const result = applySubstitution(hasField("x", cvar(0)), sub);
    expect(result.tag).toBe("hasField");
    expect(constraintEquals((result as any).constraint, isNumber)).toBe(true);
  });

  it("chains substitutions correctly", () => {
    const sub = emptySubstitution();
    sub.set(0, cvar(1));  // ?0 -> ?1
    sub.set(1, isNumber); // ?1 -> isNumber

    // ?0 should resolve to isNumber through the chain
    const result = applySubstitution(cvar(0), sub);
    expect(constraintEquals(result, isNumber)).toBe(true);
  });
});

// ============================================================================
// Free Constraint Variables
// ============================================================================

describe("Free Constraint Variables", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  it("finds single variable", () => {
    const vars = freeConstraintVars(cvar(0));
    expect(vars.has(0)).toBe(true);
    expect(vars.size).toBe(1);
  });

  it("finds no variables in primitive constraint", () => {
    const vars = freeConstraintVars(isNumber);
    expect(vars.size).toBe(0);
  });

  it("finds multiple variables in AND", () => {
    const vars = freeConstraintVars(and(cvar(0), cvar(1), cvar(2)));
    expect(vars.size).toBe(3);
    expect(vars.has(0)).toBe(true);
    expect(vars.has(1)).toBe(true);
    expect(vars.has(2)).toBe(true);
  });

  it("finds variables in nested structures", () => {
    const c = hasField("x", elements(cvar(0)));
    const vars = freeConstraintVars(c);
    expect(vars.has(0)).toBe(true);
    expect(vars.size).toBe(1);
  });
});

// ============================================================================
// Constraint Solving (Unification)
// ============================================================================

describe("Constraint Solving", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  it("solves ?A = isNumber", () => {
    const sub = solve(cvar(0), isNumber);
    expect(sub).not.toBeNull();
    expect(sub!.get(0)).toEqual(isNumber);
  });

  it("solves isNumber = ?A", () => {
    const sub = solve(isNumber, cvar(0));
    expect(sub).not.toBeNull();
    expect(sub!.get(0)).toEqual(isNumber);
  });

  it("solves ?A = ?B (both unbound)", () => {
    const sub = solve(cvar(0), cvar(1));
    expect(sub).not.toBeNull();
    // One should point to the other
    expect(sub!.has(0) || sub!.has(1)).toBe(true);
  });

  it("solves hasField(x, ?A) = hasField(x, isNumber)", () => {
    const sub = solve(hasField("x", cvar(0)), hasField("x", isNumber));
    expect(sub).not.toBeNull();
    expect(sub!.get(0)).toEqual(isNumber);
  });

  it("fails to solve isNumber = isString", () => {
    const sub = solve(isNumber, isString);
    expect(sub).toBeNull();
  });

  it("fails on occurs check (?A = hasField(x, ?A))", () => {
    // This would create an infinite type
    const sub = solve(cvar(0), hasField("x", cvar(0)));
    expect(sub).toBeNull();
  });

  it("solves multiple variables in AND", () => {
    const a = and(cvar(0), cvar(1));
    const b = and(isNumber, isString);
    const sub = solve(a, b);
    expect(sub).not.toBeNull();
    expect(sub!.get(0)).toEqual(isNumber);
    expect(sub!.get(1)).toEqual(isString);
  });

  it("solves nested field constraints", () => {
    const a = hasField("person", hasField("name", cvar(0)));
    const b = hasField("person", hasField("name", isString));
    const sub = solve(a, b);
    expect(sub).not.toBeNull();
    expect(sub!.get(0)).toEqual(isString);
  });
});

// ============================================================================
// Fresh Variables
// ============================================================================

describe("Fresh Constraint Variables", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  it("generates fresh variables with unique IDs", () => {
    const v1 = freshCVar();
    const v2 = freshCVar();
    const v3 = freshCVar();

    expect(v1.tag).toBe("var");
    expect(v2.tag).toBe("var");
    expect(v3.tag).toBe("var");

    expect((v1 as any).id).toBe(0);
    expect((v2 as any).id).toBe(1);
    expect((v3 as any).id).toBe(2);
  });

  it("reset counter starts from 0 again", () => {
    freshCVar();
    freshCVar();
    resetConstraintVarCounter();

    const v = freshCVar();
    expect((v as any).id).toBe(0);
  });
});

// ============================================================================
// Generalization and Instantiation
// ============================================================================

describe("Generalization and Instantiation", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  it("generalizes free variables", () => {
    // Constraint with free variable ?0
    const c = hasField("x", cvar(0));
    const scheme = generalize(c, new Set());

    expect(scheme.quantified).toContain(0);
    expect(scheme.quantified.length).toBe(1);
  });

  it("does not generalize environment variables", () => {
    const c = hasField("x", cvar(0));
    const envVars = new Set([0]);  // ?0 is in environment
    const scheme = generalize(c, envVars);

    expect(scheme.quantified.length).toBe(0);
  });

  it("instantiates with fresh variables", () => {
    resetConstraintVarCounter();

    const scheme: ConstraintScheme = {
      quantified: [0],
      constraint: hasField("x", cvar(0))
    };

    // First instantiation
    const c1 = instantiate(scheme);
    expect(c1.tag).toBe("hasField");
    const inner1 = (c1 as any).constraint;
    expect(inner1.tag).toBe("var");

    // Second instantiation should get a different fresh variable
    const c2 = instantiate(scheme);
    const inner2 = (c2 as any).constraint;
    expect(inner2.tag).toBe("var");
    expect(inner1.id).not.toBe(inner2.id);
  });

  it("non-generalized scheme returns same constraint", () => {
    const scheme: ConstraintScheme = {
      quantified: [],
      constraint: isNumber
    };

    const result = instantiate(scheme);
    expect(constraintEquals(result, isNumber)).toBe(true);
  });
});

// ============================================================================
// Let-Polymorphism Scenario
// ============================================================================

describe("Let-Polymorphism Scenario", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  it("identity function can be used with different types", () => {
    // Simulate: let id = fn(x) => x
    // id has constraint: ?0 -> ?0 (input and output are the same)

    // For our constraint system, we represent this as a scheme
    // forall ?0. ?0 (the function returns what it receives)
    const idScheme: ConstraintScheme = {
      quantified: [0],
      constraint: cvar(0)
    };

    // Using id with number: instantiate and solve with isNumber
    resetConstraintVarCounter();
    const c1 = instantiate(idScheme);
    const sub1 = solve(c1, isNumber);
    expect(sub1).not.toBeNull();

    // Using id with string: instantiate fresh and solve with isString
    const c2 = instantiate(idScheme);
    const sub2 = solve(c2, isString);
    expect(sub2).not.toBeNull();

    // Both should succeed because id is polymorphic
  });

  it("pair function preserves types", () => {
    // Simulate: let pair = fn(a, b) => [a, b]
    // pair returns elements(?0) where ?0 is the type of elements

    // For a more complex scenario, pair might have:
    // forall ?0 ?1. [?0, ?1] (tuple of two types)

    const pairScheme: ConstraintScheme = {
      quantified: [0, 1],
      constraint: and(isArray, hasField("0", cvar(0)), hasField("1", cvar(1)))
    };

    // Using pair(number, string)
    const inst = instantiate(pairScheme);
    // The instantiated version has fresh variables

    expect(inst.tag).toBe("and");
  });
});
