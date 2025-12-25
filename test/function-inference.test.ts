/**
 * Tests for Function Type Behavior
 *
 * Note: With body-based type derivation, function types are derived at call sites,
 * not from upfront inference. Functions have simple `isFunction` constraint.
 */
import { describe, it, expect } from "vitest";

import {
  // Constraints
  isFunction,
  implies,

  // Expressions
  num,
  str,
  varRef,
  add,
  mul,
  fn,
  call,
  letExpr,

  // Evaluator
  run,
} from "../src/index";

describe("Function Type Inference", () => {
  describe("Function Constraints", () => {
    it("function has isFunction constraint (types derived at call site)", () => {
      const expr = fn(["x", "y"], add(varRef("x"), varRef("y")));
      const result = run(expr);

      // With body-based type derivation, functions have simple isFunction constraint
      // Types are derived from body analysis at call sites
      expect(result.constraint.tag).toBe("isFunction");
    });
  });

  describe("Function Execution", () => {
    it("evaluates function with correct constraint", () => {
      // let double = fn(x) => x * 2 in double(5)
      const expr = letExpr(
        "double",
        fn(["x"], mul(varRef("x"), num(2))),
        call(varRef("double"), num(5))
      );

      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(10);
    });

    it("inferred function works with multiple calls", () => {
      // let f = fn(x) => x + 1 in f(1) + f(2)
      const expr = letExpr(
        "f",
        fn(["x"], add(varRef("x"), num(1))),
        add(
          call(varRef("f"), num(1)),
          call(varRef("f"), num(2))
        )
      );

      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(5); // (1+1) + (2+1) = 5
    });
  });

  describe("Inference with existing scope", () => {
    it("function can use variables from outer scope", () => {
      // let y = 10 in let f = fn(x) => x + y in f(5)
      const expr = letExpr(
        "y",
        num(10),
        letExpr(
          "f",
          fn(["x"], add(varRef("x"), varRef("y"))),
          call(varRef("f"), num(5))
        )
      );

      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(15);
    });
  });
});

// ============================================================================
// Polymorphic Type Inference
// Goal: "let id = fn(x) => x" should infer "forall T. T -> T"
// ============================================================================

import { equals, array, index } from "../src/index";

describe("Polymorphic Type Inference", () => {
  describe("Identity function polymorphism", () => {
    it("identity function works with numbers", () => {
      const expr = letExpr("id", fn(["x"], varRef("x")),
        call(varRef("id"), num(42))
      );
      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(42);
    });

    it("identity function works with strings", () => {
      const expr = letExpr("id", fn(["x"], varRef("x")),
        call(varRef("id"), str("hello"))
      );
      const result = run(expr);
      expect(result.value.tag).toBe("string");
      expect((result.value as any).value).toBe("hello");
    });

    it("identity function preserves constraint through calls", () => {
      const expr = letExpr("id", fn(["x"], varRef("x")),
        call(varRef("id"), num(5))
      );
      const result = run(expr);
      expect(implies(result.constraint, equals(5))).toBe(true);
    });

    it("identity function should work with different types in same scope", () => {
      const expr = letExpr("id", fn(["x"], varRef("x")),
        array(
          call(varRef("id"), num(5)),
          call(varRef("id"), str("hello"))
        )
      );
      const result = run(expr);
      expect(result.value.tag).toBe("array");
      const arr = result.value as { tag: "array"; elements: any[] };
      expect(arr.elements[0].tag).toBe("number");
      expect(arr.elements[1].tag).toBe("string");
    });
  });

  describe("First/second function polymorphism", () => {
    it("first on tuple-like object preserves type - polymorphic inference works", () => {
      const expr = letExpr("first", fn(["arr"], index(varRef("arr"), num(0))),
        call(varRef("first"), array(num(1), str("two")))
      );
      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as { value: number }).value).toBe(1);
    });
  });
});
