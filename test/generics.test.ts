/**
 * Tests for Type Constraint Operations
 *
 * Note: With body-based type derivation, generic function types (genericFnType) and
 * type parameters (typeParam) are no longer part of the constraint system.
 * Function types are derived at call sites from body analysis.
 *
 * These tests focus on the remaining constraint operations.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  isNumber,
  isString,
  isArray,
  anyC,
  constraintToString,
  constraintEquals,
  simplify,
  implies,
  solve,
  resetConstraintVarCounter,
  isUndefined,
  or,
  and,
  elementAt,
  length,
  equals,
  elements,
  isFunction,
} from "../src/index";

describe("Constraint Operations", () => {
  beforeEach(() => {
    resetConstraintVarCounter();
  });

  describe("isUndefined constraint", () => {
    it("is disjoint from other types", () => {
      // and(isUndefined, isNumber) simplifies to never since they're disjoint
      expect(simplify(and(isUndefined, isNumber)).tag).toBe("never");
      expect(simplify(and(isUndefined, isString)).tag).toBe("never");
    });

    it("can form nullable type", () => {
      const nullable = or(isNumber, isUndefined);
      expect(constraintToString(nullable)).toBe("number | undefined");
    });
  });

  describe("isFunction constraint", () => {
    it("isFunction is a valid constraint", () => {
      expect(isFunction.tag).toBe("isFunction");
    });

    it("isFunction implies itself", () => {
      expect(implies(isFunction, isFunction)).toBe(true);
    });

    it("isFunction is disjoint from primitives", () => {
      expect(simplify(and(isFunction, isNumber)).tag).toBe("never");
      expect(simplify(and(isFunction, isString)).tag).toBe("never");
    });
  });

  describe("constraint equality", () => {
    it("simple constraints are equal", () => {
      expect(constraintEquals(isNumber, isNumber)).toBe(true);
      expect(constraintEquals(isString, isString)).toBe(true);
    });

    it("different constraints are not equal", () => {
      expect(constraintEquals(isNumber, isString)).toBe(false);
    });

    it("compound constraints are equal", () => {
      const a = and(isArray, elements(isNumber));
      const b = and(isArray, elements(isNumber));
      expect(constraintEquals(a, b)).toBe(true);
    });
  });

  describe("implication", () => {
    it("concrete implies general", () => {
      expect(implies(equals(5), isNumber)).toBe(true);
      expect(implies(equals("hello"), isString)).toBe(true);
    });

    it("and implies its parts", () => {
      const conj = and(isArray, elements(isNumber));
      expect(implies(conj, isArray)).toBe(true);
    });
  });

  describe("solve", () => {
    it("solves identical constraints", () => {
      const sub = solve(isNumber, isNumber);
      expect(sub).not.toBeNull();
    });

    it("solves array element constraints", () => {
      const arrNum = and(isArray, elements(isNumber));
      const sub = solve(arrNum, arrNum);
      expect(sub).not.toBeNull();
    });
  });

  describe("simplify", () => {
    it("simplifies redundant ands", () => {
      const redundant = and(isNumber, isNumber);
      const simplified = simplify(redundant);
      expect(simplified.tag).toBe("isNumber");
    });

    it("detects contradictions", () => {
      const contradiction = and(isNumber, isString);
      expect(simplify(contradiction).tag).toBe("never");
    });
  });

  describe("tuple constraints", () => {
    it("can express tuple types", () => {
      // [number, string] as constraint
      const tuple = and(
        isArray,
        elementAt(0, isNumber),
        elementAt(1, isString),
        length(equals(2))
      );
      expect(tuple.tag).toBe("and");
    });

    it("tuple implication works", () => {
      const tuple = and(
        isArray,
        elementAt(0, isNumber),
        length(equals(1))
      );
      expect(implies(tuple, isArray)).toBe(true);
    });
  });
});
