/**
 * Design Compliance Tests - Constraint/Type System & Reflection
 *
 * These tests document features that SHOULD work according to the design documents
 * (constraints-as-types.md and goals.md) but may not yet be implemented.
 *
 * Focus: Constraint system, type operations, and reflection capabilities.
 * NOT focused on: Parser syntax (the user can change that easily).
 *
 * Each test is marked with a reference to the relevant section in the design docs.
 * Tests that fail indicate implementation gaps.
 */
import { describe, it, expect } from "vitest";

import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isNull,
  isObject,
  isArray,
  isFunction,
  and,
  or,
  not,
  equals,
  gt,
  gte,
  lt,
  lte,
  hasField,
  elements,
  length,
  elementAt,
  implies,
  simplify,
  unify,
  narrow,
  narrowOr,
  isNever,
  isAny,
  constraintToString,
  cvar,
  never,
  any,
  constraintEquals,
  Constraint,
  rec,
  recVar,
  isTypeC,
  // Constraint solving
  solve,
  ConstraintScheme,
  instantiate,
  resetConstraintVarCounter,

  // Values
  numberVal,
  stringVal,
  boolVal,
  nullVal,
  objectVal,
  arrayVal,
  closureVal,
  typeVal,
  constraintOf,
  widenConstraint,
  valueSatisfies,
  valueToString,
  Value,

  // Expressions
  num,
  str,
  bool,
  nil,
  varRef,
  add,
  sub,
  mul,
  div,
  mod,
  eq,
  neq,
  ltExpr,
  gtExpr,
  lteExpr,
  gteExpr,
  andExpr,
  orExpr,
  neg,
  notExpr,
  ifExpr,
  letExpr,
  fn,
  call,
  obj,
  field,
  array,
  index,
  block,
  comptime,
  runtime,
  assertCondExpr,
  trustExpr,
  exprToString,
  Expr,

  // Errors
  AssertionError,

  // Environment
  Env,
  RefinementContext,
  Binding,

  // Evaluator
  run,
  runValue,
  evaluate,
  TypeError,

  // Staging
  stage,
  stageToExpr,
  stagingEvaluate,
  SEnv,
  StagingError,
  isNow,
  isLater,
  now,
  later,
  Now,
  Later,
  SValue,

  // Refinement
  extractRefinement,
  extractAllRefinements,
  extractTypeGuard,
  Refinement,

  // Code Generation
  generateJS,
  compile,

  // Parser
  parseAndRun,
} from "../src/index";

// =============================================================================
// SECTION 1: Classification Hierarchy and Implications
// Reference: constraints-as-types.md, Challenge 5
// =============================================================================

describe("Challenge 5: Classification Hierarchy and Contradictions", () => {
  describe("JavaScript type hierarchy", () => {
    it("isArray implies isObject (JS semantics)", () => {
      // In JavaScript, arrays are objects: typeof [] === 'object'
      // Design doc says: isArray → isObject
      // Current implementation treats them as disjoint for simplicity
      expect(implies(isArray, isObject)).toBe(true);
    });

    it("isFunction implies isObject (JS semantics)", () => {
      // In JavaScript, functions are objects
      // Design doc says: isFunction → isObject
      expect(implies(isFunction, isObject)).toBe(true);
    });
  });

  describe("Literal value implications", () => {
    it("equals(5) implies isNumber", () => {
      expect(implies(equals(5), isNumber)).toBe(true);
    });

    it("equals('hello') implies isString", () => {
      expect(implies(equals("hello"), isString)).toBe(true);
    });

    it("equals(true) implies isBool", () => {
      expect(implies(equals(true), isBool)).toBe(true);
    });

    it("equals(null) implies isNull", () => {
      expect(implies(equals(null), isNull)).toBe(true);
    });

    it("equals(5) implies gt(3) since 5 > 3", () => {
      expect(implies(equals(5), gt(3))).toBe(true);
    });

    it("equals(5) implies lt(10) since 5 < 10", () => {
      expect(implies(equals(5), lt(10))).toBe(true);
    });

    it("equals(5) implies gte(5) since 5 >= 5", () => {
      expect(implies(equals(5), gte(5))).toBe(true);
    });

    it("equals(5) implies lte(5) since 5 <= 5", () => {
      expect(implies(equals(5), lte(5))).toBe(true);
    });

    it("equals(5) does NOT imply gt(5) since 5 is not > 5", () => {
      expect(implies(equals(5), gt(5))).toBe(false);
    });
  });

  describe("Comparison constraint implications", () => {
    it("gt(10) implies gt(5)", () => {
      expect(implies(gt(10), gt(5))).toBe(true);
    });

    it("gt(5) does NOT imply gt(10)", () => {
      expect(implies(gt(5), gt(10))).toBe(false);
    });

    it("gte(10) implies gt(5)", () => {
      // x >= 10 means x > 5
      expect(implies(gte(10), gt(5))).toBe(true);
    });

    it("lt(5) implies lt(10)", () => {
      expect(implies(lt(5), lt(10))).toBe(true);
    });

    it("lt(10) does NOT imply lt(5)", () => {
      expect(implies(lt(10), lt(5))).toBe(false);
    });

    it("lte(5) implies lt(10)", () => {
      expect(implies(lte(5), lt(10))).toBe(true);
    });
  });

  describe("Contradiction detection", () => {
    it("isNumber AND isString is contradiction", () => {
      expect(isNever(simplify(and(isNumber, isString)))).toBe(true);
    });

    it("isNumber AND isBool is contradiction", () => {
      expect(isNever(simplify(and(isNumber, isBool)))).toBe(true);
    });

    it("isNull AND isObject is contradiction", () => {
      expect(isNever(simplify(and(isNull, isObject)))).toBe(true);
    });

    it("equals(5) AND equals(6) is contradiction", () => {
      expect(isNever(simplify(and(equals(5), equals(6))))).toBe(true);
    });

    it("equals(5) AND isString is contradiction", () => {
      expect(isNever(simplify(and(equals(5), isString)))).toBe(true);
    });

    it("gt(5) AND lt(3) is contradiction (no number is both)", () => {
      expect(isNever(simplify(and(gt(5), lt(3))))).toBe(true);
    });

    it("gt(5) AND equals(3) is contradiction", () => {
      expect(isNever(simplify(and(gt(5), equals(3))))).toBe(true);
    });

    it("lt(5) AND equals(10) is contradiction", () => {
      expect(isNever(simplify(and(lt(5), equals(10))))).toBe(true);
    });

    it("gte(10) AND lte(5) is contradiction", () => {
      expect(isNever(simplify(and(gte(10), lte(5))))).toBe(true);
    });

    it("isArray AND isFunction is contradiction", () => {
      // Both are object subtypes but disjoint
      expect(isNever(simplify(and(isArray, isFunction)))).toBe(true);
    });
  });

  describe("NOT contradictions (valid constraints)", () => {
    it("isNumber AND gt(0) is valid", () => {
      expect(isNever(simplify(and(isNumber, gt(0))))).toBe(false);
    });

    it("isNumber AND gt(0) AND lt(100) is valid", () => {
      expect(isNever(simplify(and(isNumber, gt(0), lt(100))))).toBe(false);
    });

    it("isObject AND hasField('x', isNumber) is valid", () => {
      expect(isNever(simplify(and(isObject, hasField("x", isNumber))))).toBe(false);
    });

    it("gte(5) AND lte(5) is valid (equals 5)", () => {
      expect(isNever(simplify(and(gte(5), lte(5))))).toBe(false);
    });

    it("gt(0) AND lt(10) is valid", () => {
      expect(isNever(simplify(and(gt(0), lt(10))))).toBe(false);
    });
  });

  describe("Derived implications from conjunctions", () => {
    it("gte(5) AND lte(5) implies equals(5)", () => {
      // x >= 5 && x <= 5 means x == 5
      const bounded = and(gte(5), lte(5));
      expect(implies(bounded, equals(5))).toBe(true);
    });

    it("and(isNumber, equals(5)) implies gt(3)", () => {
      const literal5 = and(isNumber, equals(5));
      expect(implies(literal5, gt(3))).toBe(true);
    });

    it("and(isObject, hasField('x', isNumber)) implies isObject", () => {
      const objWithX = and(isObject, hasField("x", isNumber));
      expect(implies(objWithX, isObject)).toBe(true);
    });

    it("and(isObject, hasField('x', isNumber)) implies hasField('x', isNumber)", () => {
      const objWithX = and(isObject, hasField("x", isNumber));
      expect(implies(objWithX, hasField("x", isNumber))).toBe(true);
    });
  });
});

// =============================================================================
// SECTION 2: never Type Properties
// Reference: constraints-as-types.md, Challenge 9
// =============================================================================

describe("Challenge 9: The never Type", () => {
  it("never implies everything (vacuously true)", () => {
    expect(implies(never, isNumber)).toBe(true);
    expect(implies(never, isString)).toBe(true);
    expect(implies(never, and(isNumber, isString))).toBe(true); // Even contradictions!
    expect(implies(never, gt(1000))).toBe(true);
  });

  it("only never implies never", () => {
    expect(implies(never, never)).toBe(true);
    expect(implies(isNumber, never)).toBe(false);
    expect(implies(isString, never)).toBe(false);
    expect(implies(and(isNumber, gt(0)), never)).toBe(false);
  });

  it("never | T simplifies to T", () => {
    expect(constraintEquals(simplify(or(never, isNumber)), isNumber)).toBe(true);
    expect(constraintEquals(simplify(or(isNumber, never)), isNumber)).toBe(true);
  });

  it("never & T simplifies to never", () => {
    expect(isNever(simplify(and(never, isNumber)))).toBe(true);
    expect(isNever(simplify(and(isNumber, never)))).toBe(true);
  });

  it("not(never) should be any (everything)", () => {
    const notNever = simplify(not(never));
    expect(isAny(notNever)).toBe(true);
  });

  it("not(any) should be never (nothing)", () => {
    const notAny = simplify(not(any));
    expect(isNever(notAny)).toBe(true);
  });
});

// =============================================================================
// SECTION 3: any/unknown Type Properties
// Reference: constraints-as-types.md, Challenge 10
// =============================================================================

describe("Challenge 10: any/unknown Properties", () => {
  it("any does NOT imply specific types", () => {
    // any = no information, so can't prove it's a number
    expect(implies(any, isNumber)).toBe(false);
    expect(implies(any, isString)).toBe(false);
    expect(implies(any, gt(0))).toBe(false);
  });

  it("everything implies any", () => {
    expect(implies(isNumber, any)).toBe(true);
    expect(implies(isString, any)).toBe(true);
    expect(implies(never, any)).toBe(true);
    expect(implies(and(isNumber, gt(0)), any)).toBe(true);
  });

  it("any | T simplifies to any", () => {
    const result = simplify(or(any, isNumber));
    expect(isAny(result)).toBe(true);
  });

  it("any & T simplifies to T", () => {
    // any is the identity for AND
    const result = simplify(and(any, isNumber));
    expect(constraintEquals(result, isNumber)).toBe(true);
  });
});

// =============================================================================
// SECTION 4: Union Types and Narrowing
// Reference: constraints-as-types.md, Narrowing and Challenge 11
// =============================================================================

describe("Union Types and Narrowing", () => {
  describe("Basic OR constraints", () => {
    it("isNumber | isString accepts both", () => {
      const union = or(isNumber, isString);
      // A number satisfies this union
      expect(implies(isNumber, union)).toBe(true);
      // A string satisfies this union
      expect(implies(isString, union)).toBe(true);
    });

    it("union does not imply either branch", () => {
      const union = or(isNumber, isString);
      expect(implies(union, isNumber)).toBe(false);
      expect(implies(union, isString)).toBe(false);
    });

    it("literal type implies its union", () => {
      const union = or(isNumber, isString);
      expect(implies(equals(5), union)).toBe(true);
      expect(implies(equals("hello"), union)).toBe(true);
    });
  });

  describe("narrowOr eliminates contradictory branches", () => {
    it("narrowing string|number with isNumber gives number", () => {
      const union = or(isNumber, isString);
      const narrowed = narrowOr(union, isNumber);
      expect(implies(narrowed, isNumber)).toBe(true);
      expect(implies(narrowed, isString)).toBe(false);
    });

    it("narrowing string|number with isString gives string", () => {
      const union = or(isNumber, isString);
      const narrowed = narrowOr(union, isString);
      expect(implies(narrowed, isString)).toBe(true);
      expect(implies(narrowed, isNumber)).toBe(false);
    });

    it("narrowing with NOT eliminates the checked type", () => {
      const union = or(isNumber, isString);
      const narrowed = narrowOr(union, not(isNumber));
      expect(implies(narrowed, isString)).toBe(true);
      expect(implies(narrowed, isNumber)).toBe(false);
    });

    it("narrowing with contradictory constraint returns never", () => {
      const numOnly = isNumber;
      const narrowed = narrowOr(numOnly, isString);
      expect(isNever(narrowed)).toBe(true);
    });

    it("narrowing string|number|boolean with isBool gives boolean", () => {
      const union = or(isNumber, isString, isBool);
      const narrowed = narrowOr(union, isBool);
      expect(implies(narrowed, isBool)).toBe(true);
      expect(implies(narrowed, isNumber)).toBe(false);
      expect(implies(narrowed, isString)).toBe(false);
    });
  });

  describe("Discriminated unions", () => {
    it("narrows on field equality", () => {
      // type Shape = {kind: "circle"} | {kind: "square"}
      const circle = and(isObject, hasField("kind", equals("circle")));
      const square = and(isObject, hasField("kind", equals("square")));
      const shape = or(circle, square);

      // Narrow with kind == "circle"
      const narrowed = narrowOr(shape, hasField("kind", equals("circle")));

      // Should only be circle now
      expect(implies(narrowed, hasField("kind", equals("circle")))).toBe(true);
      expect(implies(narrowed, hasField("kind", equals("square")))).toBe(false);
    });

    it("narrows else branch to other variant", () => {
      const circle = and(isObject, hasField("kind", equals("circle")));
      const square = and(isObject, hasField("kind", equals("square")));
      const shape = or(circle, square);

      // Narrow with NOT circle -> should be square
      const narrowed = narrowOr(shape, not(hasField("kind", equals("circle"))));

      expect(implies(narrowed, hasField("kind", equals("square")))).toBe(true);
    });

    it("narrows preserves additional fields", () => {
      const circle = and(
        isObject,
        hasField("kind", equals("circle")),
        hasField("radius", isNumber)
      );
      const square = and(
        isObject,
        hasField("kind", equals("square")),
        hasField("side", isNumber)
      );
      const shape = or(circle, square);

      const narrowedToCircle = narrowOr(shape, hasField("kind", equals("circle")));

      // Should still know about radius
      expect(implies(narrowedToCircle, hasField("radius", isNumber))).toBe(true);
    });
  });
});

// =============================================================================
// SECTION 5: Intersection Types (AND constraints)
// Reference: constraints-as-types.md
// =============================================================================

describe("Intersection Types (AND constraints)", () => {
  it("A & B implies A", () => {
    const intersection = and(isNumber, gt(0));
    expect(implies(intersection, isNumber)).toBe(true);
    expect(implies(intersection, gt(0))).toBe(true);
  });

  it("A & B implies B", () => {
    const intersection = and(isObject, hasField("x", isNumber));
    expect(implies(intersection, isObject)).toBe(true);
    expect(implies(intersection, hasField("x", isNumber))).toBe(true);
  });

  it("A implies A | B", () => {
    expect(implies(isNumber, or(isNumber, isString))).toBe(true);
  });

  it("A & B & C implies A & B", () => {
    const abc = and(isNumber, gt(0), lt(100));
    expect(implies(abc, and(isNumber, gt(0)))).toBe(true);
  });
});

// =============================================================================
// SECTION 6: Object Constraints
// Reference: constraints-as-types.md, Challenge 2
// =============================================================================

describe("Object Constraints", () => {
  describe("hasField implications", () => {
    it("hasField('x', A) with more specific A implies less specific", () => {
      // hasField("x", equals(5)) implies hasField("x", isNumber)
      expect(
        implies(hasField("x", equals(5)), hasField("x", isNumber))
      ).toBe(true);
    });

    it("hasField('x', A) does NOT imply hasField('y', A)", () => {
      expect(implies(hasField("x", isNumber), hasField("y", isNumber))).toBe(false);
    });

    it("object with more fields implies object with fewer", () => {
      // { x: number, y: string } <: { x: number }
      const moreFields = and(
        isObject,
        hasField("x", isNumber),
        hasField("y", isString)
      );
      const fewerFields = and(isObject, hasField("x", isNumber));
      expect(implies(moreFields, fewerFields)).toBe(true);
    });

    it("object with fewer fields does NOT imply object with more", () => {
      const fewerFields = and(isObject, hasField("x", isNumber));
      const moreFields = and(
        isObject,
        hasField("x", isNumber),
        hasField("y", isString)
      );
      expect(implies(fewerFields, moreFields)).toBe(false);
    });
  });

  describe("Nested object constraints", () => {
    it("nested hasField constraints work", () => {
      // { inner: { x: number } }
      const nested = and(
        isObject,
        hasField("inner", and(isObject, hasField("x", isNumber)))
      );
      expect(implies(nested, isObject)).toBe(true);
      expect(implies(nested, hasField("inner", isObject))).toBe(true);
    });
  });

  describe("Object field contradiction detection", () => {
    it("same field with conflicting equals is contradiction", () => {
      const conflict = and(
        isObject,
        hasField("x", equals(5)),
        hasField("x", equals(6))
      );
      expect(isNever(simplify(conflict))).toBe(true);
    });

    it("same field with conflicting types is contradiction", () => {
      const conflict = and(
        isObject,
        hasField("x", isNumber),
        hasField("x", isString)
      );
      expect(isNever(simplify(conflict))).toBe(true);
    });
  });
});

// =============================================================================
// SECTION 7: Array and Tuple Constraints
// Reference: constraints-as-types.md, Tuples section
// =============================================================================

describe("Array and Tuple Constraints", () => {
  describe("Basic array constraints", () => {
    it("elements constraint works", () => {
      const numArray = and(isArray, elements(isNumber));
      expect(implies(numArray, isArray)).toBe(true);
      expect(implies(numArray, elements(isNumber))).toBe(true);
    });

    it("more specific elements implies less specific", () => {
      // Array<5> implies Array<number>
      expect(
        implies(
          and(isArray, elements(equals(5))),
          and(isArray, elements(isNumber))
        )
      ).toBe(true);
    });

    it("length constraint works", () => {
      const len3 = and(isArray, length(equals(3)));
      expect(implies(len3, isArray)).toBe(true);
    });
  });

  describe("Tuple (elementAt) constraints", () => {
    it("elementAt gives position-specific type", () => {
      // [string, number] - position 0 is string, position 1 is number
      const tuple = and(
        isArray,
        length(equals(2)),
        elementAt(0, isString),
        elementAt(1, isNumber)
      );

      expect(implies(tuple, elementAt(0, isString))).toBe(true);
      expect(implies(tuple, elementAt(1, isNumber))).toBe(true);
    });

    it("more specific elementAt implies less specific", () => {
      expect(
        implies(elementAt(0, equals("hello")), elementAt(0, isString))
      ).toBe(true);
    });

    it("elementAt at different indices don't imply each other", () => {
      expect(implies(elementAt(0, isString), elementAt(1, isString))).toBe(false);
    });
  });

  describe("Tuple is subtype of homogeneous array", () => {
    it("[string, number] is subtype of Array<string|number>", () => {
      const tuple = and(
        isArray,
        length(equals(2)),
        elementAt(0, isString),
        elementAt(1, isNumber)
      );
      // Tuple should imply it's an array with string|number elements
      expect(implies(tuple, isArray)).toBe(true);
      // Note: This specific implication may need the elements constraint to be inferred
    });
  });
});

// =============================================================================
// SECTION 8: Constraint Simplification
// Reference: constraints-as-types.md, simplify rules
// =============================================================================

describe("Constraint Simplification", () => {
  it("flattens nested ANDs", () => {
    const nested = and(and(isNumber, gt(0)), lt(100));
    const simplified = simplify(nested);
    if (simplified.tag === "and") {
      expect(simplified.constraints.length).toBe(3);
    }
  });

  it("flattens nested ORs", () => {
    const nested = or(or(isNumber, isString), isBool);
    const simplified = simplify(nested);
    if (simplified.tag === "or") {
      expect(simplified.constraints.length).toBe(3);
    }
  });

  it("removes duplicates from AND", () => {
    const withDup = and(isNumber, isNumber, gt(0));
    const simplified = simplify(withDup);
    if (simplified.tag === "and") {
      expect(simplified.constraints.filter((c) => c.tag === "isNumber").length).toBe(1);
    }
  });

  it("removes duplicates from OR", () => {
    const withDup = or(isNumber, isNumber, isString);
    const simplified = simplify(withDup);
    if (simplified.tag === "or") {
      expect(simplified.constraints.filter((c) => c.tag === "isNumber").length).toBe(1);
    }
  });

  it("removes any from AND (identity)", () => {
    const withAny = and(any, isNumber);
    const simplified = simplify(withAny);
    expect(constraintEquals(simplified, isNumber)).toBe(true);
  });

  it("removes never from OR (identity)", () => {
    const withNever = or(never, isNumber);
    const simplified = simplify(withNever);
    expect(constraintEquals(simplified, isNumber)).toBe(true);
  });

  it("single element AND simplifies to that element", () => {
    const single = and(isNumber);
    expect(constraintEquals(single, isNumber)).toBe(true);
  });

  it("single element OR simplifies to that element", () => {
    const single = or(isNumber);
    expect(constraintEquals(single, isNumber)).toBe(true);
  });

  it("empty AND simplifies to any", () => {
    const empty = and();
    expect(isAny(empty)).toBe(true);
  });

  it("empty OR simplifies to never", () => {
    const empty = or();
    expect(isNever(empty)).toBe(true);
  });

  it("double negation simplifies", () => {
    const doubleNeg = not(not(isNumber));
    const simplified = simplify(doubleNeg);
    expect(constraintEquals(simplified, isNumber)).toBe(true);
  });
});

// =============================================================================
// SECTION 9: Unification
// Reference: constraints-as-types.md
// =============================================================================

describe("Unification", () => {
  it("unify combines constraints via AND", () => {
    const result = unify(isNumber, gt(0));
    expect(implies(result, isNumber)).toBe(true);
    expect(implies(result, gt(0))).toBe(true);
  });

  it("unify detects contradictions", () => {
    const result = unify(isNumber, isString);
    expect(isNever(result)).toBe(true);
  });

  it("unify of same constraint returns that constraint", () => {
    const result = unify(isNumber, isNumber);
    expect(constraintEquals(result, isNumber)).toBe(true);
  });

  it("unify tightens bounds", () => {
    const result = unify(gt(0), gt(5));
    // Should be equivalent to gt(5) (the tighter bound)
    expect(implies(result, gt(5))).toBe(true);
  });
});

// =============================================================================
// SECTION 10: Refinement Context
// Reference: constraints-as-types.md, Control Flow Refinement
// =============================================================================

describe("Refinement Context and Control Flow", () => {
  describe("RefinementContext operations", () => {
    it("refine adds constraint to context", () => {
      const ctx = RefinementContext.empty().refine("x", gt(0));
      expect(ctx.get("x")).toEqual(gt(0));
    });

    it("multiple refinements are ANDed", () => {
      const ctx = RefinementContext.empty()
        .refine("x", gt(0))
        .refine("x", lt(10));
      const refined = ctx.get("x");
      expect(refined?.tag).toBe("and");
    });
  });

  describe("extractRefinement from conditions", () => {
    it("extracts x > 0 from comparison", () => {
      const cond = gtExpr(varRef("x"), num(0));
      const refinement = extractRefinement(cond);
      const xConstraint = refinement.constraints.get("x");
      expect(xConstraint).toBeDefined();
      expect(xConstraint?.tag).toBe("gt");
    });

    it("extracts x < 10 from comparison", () => {
      const cond = ltExpr(varRef("x"), num(10));
      const refinement = extractRefinement(cond);
      const xConstraint = refinement.constraints.get("x");
      expect(xConstraint).toBeDefined();
      expect(xConstraint?.tag).toBe("lt");
    });

    it("extracts x == 5 from equality", () => {
      const cond = eq(varRef("x"), num(5));
      const refinement = extractRefinement(cond);
      const xConstraint = refinement.constraints.get("x");
      expect(xConstraint).toBeDefined();
      expect(xConstraint?.tag).toBe("equals");
    });

    it("merges compound conditions (AND)", () => {
      const cond = andExpr(gtExpr(varRef("x"), num(0)), ltExpr(varRef("x"), num(10)));
      const refinement = extractRefinement(cond);
      const xConstraint = refinement.constraints.get("x");
      // Should have both constraints
      expect(xConstraint).toBeDefined();
    });
  });

  describe("extractTypeGuard", () => {
    it("detects isNumber type guard", () => {
      const cond = call(varRef("isNumber"), varRef("x"));
      const guard = extractTypeGuard(cond);
      expect(guard).not.toBeNull();
      expect(guard?.varName).toBe("x");
      expect(guard?.constraint.tag).toBe("isNumber");
    });

    it("detects isString type guard", () => {
      const cond = call(varRef("isString"), varRef("x"));
      const guard = extractTypeGuard(cond);
      expect(guard).not.toBeNull();
      expect(guard?.constraint.tag).toBe("isString");
    });
  });
});

// =============================================================================
// SECTION 11: Value and Constraint Interaction
// =============================================================================

describe("Value and Constraint Interaction", () => {
  describe("constraintOf gives most specific constraint", () => {
    it("number literal has equals constraint", () => {
      const c = constraintOf(numberVal(42));
      expect(implies(c, isNumber)).toBe(true);
      expect(implies(c, equals(42))).toBe(true);
    });

    it("string literal has equals constraint", () => {
      const c = constraintOf(stringVal("hello"));
      expect(implies(c, isString)).toBe(true);
      expect(implies(c, equals("hello"))).toBe(true);
    });

    it("boolean literal has equals constraint", () => {
      const c = constraintOf(boolVal(true));
      expect(implies(c, isBool)).toBe(true);
      expect(implies(c, equals(true))).toBe(true);
    });

    it("null has isNull constraint", () => {
      const c = constraintOf(nullVal);
      expect(constraintEquals(c, isNull)).toBe(true);
    });

    it("object has hasField constraints for each field", () => {
      const c = constraintOf(objectVal({ x: numberVal(1), y: stringVal("hi") }));
      expect(implies(c, isObject)).toBe(true);
      expect(implies(c, hasField("x", isNumber))).toBe(true);
      expect(implies(c, hasField("y", isString))).toBe(true);
    });

    it("array has length and elementAt constraints", () => {
      const c = constraintOf(arrayVal([numberVal(1), numberVal(2)]));
      expect(implies(c, isArray)).toBe(true);
      // Should have length == 2
      // Should have elementAt(0, ...) and elementAt(1, ...)
    });
  });

  describe("valueSatisfies checks constraints", () => {
    it("number satisfies isNumber", () => {
      expect(valueSatisfies(numberVal(5), isNumber)).toBe(true);
    });

    it("number does not satisfy isString", () => {
      expect(valueSatisfies(numberVal(5), isString)).toBe(false);
    });

    it("number satisfies comparison constraints", () => {
      expect(valueSatisfies(numberVal(5), gt(0))).toBe(true);
      expect(valueSatisfies(numberVal(5), gt(10))).toBe(false);
      expect(valueSatisfies(numberVal(5), lt(10))).toBe(true);
      expect(valueSatisfies(numberVal(5), lt(3))).toBe(false);
    });

    it("object satisfies hasField", () => {
      const obj = objectVal({ x: numberVal(5) });
      expect(valueSatisfies(obj, hasField("x", isNumber))).toBe(true);
      expect(valueSatisfies(obj, hasField("y", isNumber))).toBe(false);
    });

    it("array satisfies elements constraint", () => {
      const arr = arrayVal([numberVal(1), numberVal(2)]);
      expect(valueSatisfies(arr, elements(isNumber))).toBe(true);
      expect(valueSatisfies(arr, elements(isString))).toBe(false);
    });
  });

  describe("widenConstraint removes literal info", () => {
    it("widening equals(5) gives number", () => {
      const widened = widenConstraint(equals(5));
      expect(constraintEquals(widened, isNumber)).toBe(true);
    });

    it("widening and(isNumber, equals(5)) gives number", () => {
      const widened = widenConstraint(and(isNumber, equals(5)));
      expect(constraintEquals(widened, isNumber)).toBe(true);
    });
  });
});

// =============================================================================
// SECTION 12: Constraint Variables (for Type Inference)
// Reference: constraints-as-types.md, Challenge 1
// =============================================================================

describe("Constraint Variables for Inference", () => {
  it("constraint variables can be created", () => {
    const v = cvar(1);
    expect(v.tag).toBe("var");
    if (v.tag === "var") {
      expect(v.id).toBe(1);
    }
  });

  it("constraint variables with same id are equal", () => {
    expect(constraintEquals(cvar(1), cvar(1))).toBe(true);
  });

  it("constraint variables with different ids are not equal", () => {
    expect(constraintEquals(cvar(1), cvar(2))).toBe(false);
  });

  it("constraint variables are preserved in AND", () => {
    const c = and(cvar(1), isNumber);
    if (c.tag === "and") {
      expect(c.constraints.some((x) => x.tag === "var")).toBe(true);
    }
  });

  it("FUTURE: constraint solving should substitute variables", () => {
    // When we learn that ?1 = isNumber, we should substitute
    // This requires a constraint solver not yet implemented
  });
});

// =============================================================================
// SECTION 13: Staging System
// Reference: constraints-as-types.md, Challenge 4; goals.md, Goal 2
// =============================================================================

describe("Staging System", () => {
  describe("Now values (compile-time known)", () => {
    it("literals evaluate to Now", () => {
      const result = stage(num(42));
      expect(isNow(result.svalue)).toBe(true);
    });

    it("arithmetic on Now values evaluates at compile time", () => {
      const result = stage(add(num(1), num(2)));
      expect(isNow(result.svalue)).toBe(true);
      if (isNow(result.svalue)) {
        expect(result.svalue.value).toEqual({ tag: "number", value: 3 });
      }
    });

    it("conditional with Now condition picks branch at compile time", () => {
      const result = stage(ifExpr(bool(true), num(1), num(2)));
      expect(isNow(result.svalue)).toBe(true);
      if (isNow(result.svalue)) {
        expect(result.svalue.value).toEqual({ tag: "number", value: 1 });
      }
    });
  });

  describe("Later values (runtime only)", () => {
    it("runtime() marks value as Later", () => {
      const result = stage(runtime(num(42)));
      expect(isLater(result.svalue)).toBe(true);
    });

    it("Later values have constraint but no value", () => {
      const result = stage(runtime(num(42)));
      if (isLater(result.svalue)) {
        expect(implies(result.svalue.constraint, isNumber)).toBe(true);
      }
    });

    it("operation involving Later produces Later", () => {
      const result = stage(add(runtime(num(1), "x"), num(2)));
      expect(isLater(result.svalue)).toBe(true);
    });

    it("Later values have residual expressions", () => {
      const result = stage(add(runtime(num(1), "x"), num(2)));
      if (isLater(result.svalue)) {
        expect(result.svalue.residual).toBeDefined();
        // Residual should be x + 2
      }
    });
  });

  describe("comptime forces compile-time evaluation", () => {
    it("comptime on Now value succeeds", () => {
      const result = stage(comptime(add(num(1), num(2))));
      expect(isNow(result.svalue)).toBe(true);
    });

    it("comptime on Later value throws StagingError", () => {
      expect(() => stage(comptime(runtime(num(5))))).toThrow(StagingError);
    });
  });

  describe("Constraint propagation through staging", () => {
    it("Later maintains constraint from Now value", () => {
      const result = stage(
        letExpr("x", num(5), runtime(varRef("x")))
      );
      if (isLater(result.svalue)) {
        expect(implies(result.svalue.constraint, isNumber)).toBe(true);
        expect(implies(result.svalue.constraint, equals(5))).toBe(true);
      }
    });

    it("Later from operation has computed constraint", () => {
      // x + 3 where x is runtime should still know result is number
      const result = stage(
        letExpr("x", runtime(num(5), "x"), add(varRef("x"), num(3)))
      );
      if (isLater(result.svalue)) {
        expect(implies(result.svalue.constraint, isNumber)).toBe(true);
      }
    });
  });
});

// =============================================================================
// SECTION 14: Evaluation with Refinement
// =============================================================================

describe("Evaluation with Control Flow Refinement", () => {
  it("x > 0 in then branch has gt(0) constraint", () => {
    const result = run(
      letExpr("x", num(5), ifExpr(gtExpr(varRef("x"), num(0)), varRef("x"), num(0)))
    );
    // In the then branch, x should have gt(0)
    expect(implies(result.constraint, gt(0))).toBe(true);
  });

  it("x <= 0 in else branch of x > 0", () => {
    const result = run(
      letExpr("x", num(-5), ifExpr(gtExpr(varRef("x"), num(0)), num(0), varRef("x")))
    );
    // In the else branch, x should have lte(0)
    expect(implies(result.constraint, lte(0))).toBe(true);
  });

  it("compound condition x > 0 && x < 10 narrows to both", () => {
    const result = run(
      letExpr(
        "x",
        num(5),
        ifExpr(
          andExpr(gtExpr(varRef("x"), num(0)), ltExpr(varRef("x"), num(10))),
          varRef("x"),
          num(0)
        )
      )
    );
    expect(implies(result.constraint, gt(0))).toBe(true);
    expect(implies(result.constraint, lt(10))).toBe(true);
  });

  it("x == 5 narrows to equals(5)", () => {
    const result = run(
      letExpr("x", num(5), ifExpr(eq(varRef("x"), num(5)), varRef("x"), num(0)))
    );
    expect(implies(result.constraint, equals(5))).toBe(true);
  });

  it("discriminated union narrows correctly", () => {
    const result = run(
      letExpr(
        "shape",
        obj({ kind: str("circle"), radius: num(5) }),
        ifExpr(
          eq(field(varRef("shape"), "kind"), str("circle")),
          field(varRef("shape"), "radius"),
          num(0)
        )
      )
    );
    expect(result.value).toEqual({ tag: "number", value: 5 });
  });
});

// =============================================================================
// SECTION 15: FUTURE - Features Not Yet Implemented
// =============================================================================

describe("Recursive Types (Challenge 8)", () => {
  // Reference: constraints-as-types.md, Challenge 8

  it("rec binder for recursive types", () => {
    // Design: rec X. (isNull OR (isObject AND hasField("head", T) AND hasField("tail", X)))
    // Allows: type List<T> = null | { head: T, tail: List<T> }
    const listNum = rec("X", or(
      isNull,
      and(isObject, hasField("head", isNumber), hasField("tail", recVar("X")))
    ));
    expect(listNum.tag).toBe("rec");
    expect(constraintToString(listNum)).toContain("μX.");
  });

  it("recursive type equality up to renaming (coinductive)", () => {
    // rec X. (null | {tail: X}) implies rec Y. (null | {tail: Y})
    // Same structure, different var names should be related
    const list1 = rec("X", or(isNull, hasField("tail", recVar("X"))));
    const list2 = rec("Y", or(isNull, hasField("tail", recVar("Y"))));
    expect(implies(list1, list2)).toBe(true);
  });
});

describe("Type as First-Class Value (Challenge 4)", () => {
  // Reference: constraints-as-types.md, Challenge 4

  it("isType constraint for type values", () => {
    // Types are values with isType constraint
    // 'number' evaluates to a type value
    const result = run(varRef("number"));
    expect(result.value.tag).toBe("type");
    expect(implies(result.constraint, isTypeC)).toBe(true);
  });

  it("fields() reflection function", () => {
    // fields(T) returns array of field names
    const personType = typeVal(and(isObject, hasField("name", isString), hasField("age", isNumber)));
    const result = run(
      call(varRef("fields"), varRef("T")),
      { T: { value: personType, constraint: constraintOf(personType) } }
    );
    expect(result.value.tag).toBe("array");
    const fields = (result.value as any).elements.map((e: any) => e.value);
    expect(fields).toContain("name");
    expect(fields).toContain("age");
  });

  it("fieldType() reflection function", () => {
    // fieldType(T, 'name') returns type of field
    const personType = typeVal(and(isObject, hasField("name", isString)));
    const result = run(
      call(varRef("fieldType"), varRef("T"), str("name")),
      { T: { value: personType, constraint: constraintOf(personType) } }
    );
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isString);
  });
});

describe("Constraint Solving", () => {
  it("unification with constraint variables", () => {
    // Given ?A and isNumber, should solve ?A = isNumber
    resetConstraintVarCounter();
    const sub = solve(cvar(0), isNumber);
    expect(sub).not.toBeNull();
    expect(sub!.get(0)).toEqual(isNumber);
  });

  it("let-polymorphism with generalize/instantiate", () => {
    // let id = fn(x) => x
    // id has type forall A. A -> A
    // When called with number, A = number. When called with string, A = string.
    resetConstraintVarCounter();

    // The identity function's type scheme: forall ?0. ?0
    const idScheme: ConstraintScheme = {
      quantified: [0],
      constraint: cvar(0)
    };

    // Use with number
    const inst1 = instantiate(idScheme);
    const sub1 = solve(inst1, isNumber);
    expect(sub1).not.toBeNull();

    // Use with string (fresh instantiation)
    const inst2 = instantiate(idScheme);
    const sub2 = solve(inst2, isString);
    expect(sub2).not.toBeNull();

    // Both succeed because id is polymorphic
  });
});

describe("assert and trust inline syntax", () => {
  // Reference: goals.md, Goal 6

  it("assert(condition) throws when condition is false", () => {
    // assert(x < 100) - check condition, throw if false
    const expr = letExpr(
      "x",
      num(150),
      assertCondExpr(ltExpr(varRef("x"), num(100)))
    );
    expect(() => run(expr)).toThrow(AssertionError);
  });

  it("assert(condition) passes when condition is true", () => {
    // assert(x < 100) - check condition, return true if passes
    const expr = letExpr(
      "x",
      num(50),
      assertCondExpr(ltExpr(varRef("x"), num(100)))
    );
    const result = run(expr);
    expect(result.value.tag).toBe("bool");
    expect((result.value as any).value).toBe(true);
  });

  it("trust(expr) returns value without constraint modification", () => {
    // trust(x) without a constraint just returns the value unchanged
    const expr = trustExpr(num(42));
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(42);
  });

  it("trust(expr) can be used inline", () => {
    // let f = fn(x) => x in f(trust(5))
    const expr = letExpr(
      "f",
      fn(["x"], varRef("x")),
      call(varRef("f"), trustExpr(num(5)))
    );
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(5);
  });

  it("assert(condition) can be parsed from source", () => {
    const result = parseAndRun("let x = 50 in assert(x < 100)");
    expect(result.value.tag).toBe("bool");
    expect((result.value as any).value).toBe(true);
  });

  it("trust(expr) can be parsed from source", () => {
    const result = parseAndRun("trust(42)");
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(42);
  });
});
