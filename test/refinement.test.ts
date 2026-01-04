/**
 * Refinement Tests
 *
 * Tests for control flow refinement and type narrowing:
 * - RefinementContext operations
 * - Extracting refinements from conditions
 * - Type guards
 * - Evaluation with control flow refinement
 */
import { describe, it, expect } from "vitest";

import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isObject,
  and,
  equals,
  gt,
  lt,
  lte,
  hasField,
  implies,

  // Expressions
  num,
  str,
  varRef,
  eq,
  gtExpr,
  ltExpr,
  andExpr,
  ifExpr,
  letExpr,
  fn,
  call,
  obj,
  field,

  // Environment
  RefinementContext,

  // Evaluator
  run,

  // Refinement
  extractRefinement,
  extractTypeGuard,
} from "@dependent-ts/core";

// =============================================================================
// Refinement Context
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
// Evaluation with Refinement
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

// ============================================================================
// Advanced Control Flow Refinement
// ============================================================================

import { or, simplify } from "@dependent-ts/core";

describe("Advanced Control Flow Refinement", () => {
  describe("OR elimination", () => {
    it("if branch eliminates one side of OR", () => {
      const circleOrSquare = or(
        and(isObject, hasField("kind", equals("circle"))),
        and(isObject, hasField("kind", equals("square")))
      );

      const refined = simplify(and(circleOrSquare, hasField("kind", equals("circle"))));
      expect(implies(refined, hasField("kind", equals("circle")))).toBe(true);
      expect(implies(refined, hasField("kind", equals("square")))).toBe(false);
    });
  });

  describe("Nested refinement preservation", () => {
    it("nested if preserves outer refinements", () => {
      const expr = letExpr("x", num(5),
        ifExpr(
          gtExpr(varRef("x"), num(0)),
          ifExpr(
            ltExpr(varRef("x"), num(10)),
            varRef("x"),
            num(0)
          ),
          num(0)
        )
      );
      const result = run(expr);
      expect(implies(result.constraint, gt(0))).toBe(true);
      expect(implies(result.constraint, lt(10))).toBe(true);
    });
  });
});

describe("Type Guards (not yet implemented)", () => {
  describe("isNumber/isString as type guards", () => {
    it("should have isNumber builtin that narrows types", () => {
      expect(() => {
        run(call(varRef("isNumber"), num(5)));
      }).toThrow();
    });

    it("can manually simulate type guard with typeof-like check", () => {
      const expr = letExpr("x", num(5),
        ifExpr(
          gtExpr(varRef("x"), num(0)),
          varRef("x"),
          num(0)
        )
      );
      const result = run(expr);
      expect(result.value.tag).toBe("number");
    });
  });
});
