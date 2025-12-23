/**
 * Tests for Recursive Types (Challenge 8)
 *
 * Recursive types use the μ (mu) binder for cyclic type definitions.
 * Example: List<T> = null | { head: T, tail: List<T> }
 */

import { describe, it, expect } from "vitest";
import {
  // Constraints
  isNumber,
  isString,
  isNull,
  isObject,
  hasField,
  and,
  or,
  implies,
  constraintEquals,
  constraintToString,
  simplify,
  rec,
  recVar,
} from "../src/index";

// ============================================================================
// Basic rec/recVar Construction
// ============================================================================

describe("Recursive Types Construction", () => {
  it("creates a rec constraint", () => {
    // μX. (null | { head: number, tail: X })
    const listNum = rec("X", or(
      isNull,
      and(isObject, hasField("head", isNumber), hasField("tail", recVar("X")))
    ));

    expect(listNum.tag).toBe("rec");
    expect((listNum as any).var).toBe("X");
    expect((listNum as any).body.tag).toBe("or");
  });

  it("creates a recVar reference", () => {
    const x = recVar("X");
    expect(x.tag).toBe("recVar");
    expect((x as any).var).toBe("X");
  });

  it("constraintToString formats rec correctly", () => {
    const listNum = rec("X", or(isNull, recVar("X")));
    const str = constraintToString(listNum);
    expect(str).toContain("μX.");
    expect(str).toContain("null");
    expect(str).toContain("X");
  });
});

// ============================================================================
// Constraint Equality for Recursive Types
// ============================================================================

describe("Recursive Type Equality", () => {
  it("equal rec types with same structure are equal", () => {
    const list1 = rec("X", or(isNull, hasField("tail", recVar("X"))));
    const list2 = rec("X", or(isNull, hasField("tail", recVar("X"))));
    expect(constraintEquals(list1, list2)).toBe(true);
  });

  it("different rec bodies are not equal", () => {
    const list1 = rec("X", or(isNull, hasField("tail", recVar("X"))));
    const list2 = rec("X", or(isNull, hasField("next", recVar("X"))));
    expect(constraintEquals(list1, list2)).toBe(false);
  });

  it("different rec variable names make them not structurally equal", () => {
    // Note: In a full implementation, these would be alpha-equivalent
    // but our simple structural equality treats them as different
    const list1 = rec("X", or(isNull, recVar("X")));
    const list2 = rec("Y", or(isNull, recVar("Y")));
    // Structural equality says they're different (different var names)
    expect(constraintEquals(list1, list2)).toBe(false);
  });
});

// ============================================================================
// Implication for Recursive Types
// ============================================================================

describe("Recursive Type Implication", () => {
  it("identical rec types imply each other", () => {
    const list = rec("X", or(isNull, and(isObject, hasField("tail", recVar("X")))));
    expect(implies(list, list)).toBe(true);
  });

  it("rec types with same structure but different var names are related", () => {
    // μX. (null | { tail: X }) should imply μY. (null | { tail: Y })
    const list1 = rec("X", or(isNull, hasField("tail", recVar("X"))));
    const list2 = rec("Y", or(isNull, hasField("tail", recVar("Y"))));
    expect(implies(list1, list2)).toBe(true);
  });

  it("rec type implies its unrolled form (one level)", () => {
    // This tests that rec X. (null | { tail: X })
    // implies null | { tail: rec X. (null | { tail: X }) }
    // This is a more advanced test - may need work
  });
});

// ============================================================================
// Simplification of Recursive Types
// ============================================================================

describe("Recursive Type Simplification", () => {
  it("simplify preserves rec structure", () => {
    const list = rec("X", or(isNull, and(isObject, hasField("tail", recVar("X")))));
    const simplified = simplify(list);
    expect(simplified.tag).toBe("rec");
  });

  it("simplify simplifies the body", () => {
    // rec X. (never | X) should simplify to rec X. X
    const list = rec("X", or({ tag: "never" }, recVar("X")));
    const simplified = simplify(list);
    expect(simplified.tag).toBe("rec");
    // Body should be simplified (never removed from or)
    expect((simplified as any).body.tag).toBe("recVar");
  });
});

// ============================================================================
// Practical Examples
// ============================================================================

describe("Practical Recursive Type Examples", () => {
  it("List<number> type", () => {
    // type List<T> = null | { head: T, tail: List<T> }
    // List<number> = μX. (null | { head: number, tail: X })
    const listNumber = rec("List", or(
      isNull,
      and(
        isObject,
        hasField("head", isNumber),
        hasField("tail", recVar("List"))
      )
    ));

    expect(listNumber.tag).toBe("rec");
    const str = constraintToString(listNumber);
    expect(str).toContain("μList.");
    expect(str).toContain("null");
    expect(str).toContain("number");
  });

  it("Tree<T> type", () => {
    // type Tree<T> = { value: T, left: Tree<T> | null, right: Tree<T> | null }
    // Tree<number> = μX. { value: number, left: X | null, right: X | null }
    const treeNumber = rec("Tree", and(
      isObject,
      hasField("value", isNumber),
      hasField("left", or(recVar("Tree"), isNull)),
      hasField("right", or(recVar("Tree"), isNull))
    ));

    expect(treeNumber.tag).toBe("rec");
  });

  it("JSON type (mutually recursive approximation)", () => {
    // JSON = null | boolean | number | string | JSON[] | { [key: string]: JSON }
    // Simplified: μJ. (null | number | string | { value: J })
    const jsonType = rec("J", or(
      isNull,
      isNumber,
      isString,
      hasField("value", recVar("J"))
    ));

    expect(jsonType.tag).toBe("rec");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Recursive Type Edge Cases", () => {
  it("directly recursive type (μX. X)", () => {
    // μX. X is a degenerate type - represents an infinite loop
    const infinite = rec("X", recVar("X"));
    expect(infinite.tag).toBe("rec");
    // Should not crash when simplified
    const simplified = simplify(infinite);
    expect(simplified.tag).toBe("rec");
  });

  it("nested rec types", () => {
    // μX. { inner: μY. (null | { x: X, y: Y }) }
    const nested = rec("X", hasField("inner", rec("Y", or(
      isNull,
      and(hasField("x", recVar("X")), hasField("y", recVar("Y")))
    ))));

    expect(nested.tag).toBe("rec");
    const str = constraintToString(nested);
    expect(str).toContain("μX.");
    expect(str).toContain("μY.");
  });
});

// ============================================================================
// Recursive Type Evaluation and Construction
// From docs/constraints-as-types.md: List, Tree types
// ============================================================================

import { run, obj, nil, num, ifExpr, eq, varRef, letExpr, fn, call } from "../src/index";

describe("Recursive Type Construction", () => {
  describe("List type construction", () => {
    it("can construct list-like values that match recursive type", () => {
      // List<number> = null | { head: number, tail: List }
      // null (empty list)
      const emptyResult = run(nil);
      expect(emptyResult.value.tag).toBe("null");

      // { head: 1, tail: null } (single element)
      const single = obj({ head: num(1), tail: nil });
      const singleResult = run(single);
      expect(singleResult.value.tag).toBe("object");

      // { head: 1, tail: { head: 2, tail: null } } (two elements)
      const two = obj({
        head: num(1),
        tail: obj({ head: num(2), tail: nil })
      });
      const twoResult = run(two);
      expect(twoResult.value.tag).toBe("object");
    });

    it("recursive type constraint matches list structure", () => {
      const listNum = rec("List", or(
        isNull,
        and(
          isObject,
          hasField("head", isNumber),
          hasField("tail", recVar("List"))
        )
      ));

      // null should satisfy this - rec type gets unrolled to check branches
      expect(implies(isNull, listNum)).toBe(true);
    });
  });

  describe("Recursive type unrolling", () => {
    it("unrolled recursive type should match its components", () => {
      const listType = rec("X", or(isNull, hasField("tail", recVar("X"))));
      const unrolled = or(isNull, hasField("tail", listType));

      expect(implies(isNull, unrolled)).toBe(true);
      expect(implies(isNull, listType)).toBe(true);
    });

    it("object matching recursive type works with unrolling", () => {
      const listType = rec("X", or(isNull, and(isObject, hasField("tail", recVar("X")))));
      const singleNode = and(isObject, hasField("tail", isNull));

      expect(implies(singleNode, listType)).toBe(true);
    });
  });

  describe("Recursive function types (not yet working)", () => {
    it("length function on list should be typeable", () => {
      // For now, just test non-recursive version
      const listLength = fn(["list"],
        ifExpr(
          eq(varRef("list"), nil),
          num(0),
          num(1) // Placeholder - should be 1 + recursive call
        )
      );

      const result = run(call(listLength, nil));
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(0);
    });
  });
});
