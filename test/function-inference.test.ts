/**
 * Tests for Challenge 6: Type Inference from Function Bodies
 */
import { describe, it, expect } from "vitest";

import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isFunction,
  fnType,
  and,
  implies,
  constraintToString,

  // Expressions
  num,
  str,
  varRef,
  add,
  mul,
  ltExpr,
  fn,
  call,
  letExpr,

  // Evaluator
  run,
  runValue,

  // Inference
  inferFunction,
} from "../src/index";

import { Env } from "../src/env";

describe("Function Type Inference", () => {
  describe("Basic Inference", () => {
    it("infers number -> number for fn(x) => x + 1", () => {
      const result = inferFunction(
        ["x"],
        add(varRef("x"), num(1)),
        Env.empty()
      );

      expect(implies(result.paramConstraints[0], isNumber)).toBe(true);
      expect(implies(result.resultConstraint, isNumber)).toBe(true);
    });

    it("infers (number, number) -> number for fn(x, y) => x + y", () => {
      const result = inferFunction(
        ["x", "y"],
        add(varRef("x"), varRef("y")),
        Env.empty()
      );

      expect(implies(result.paramConstraints[0], isNumber)).toBe(true);
      expect(implies(result.paramConstraints[1], isNumber)).toBe(true);
      expect(implies(result.resultConstraint, isNumber)).toBe(true);
    });

    it("infers number -> boolean for fn(x) => x < 10", () => {
      const result = inferFunction(
        ["x"],
        ltExpr(varRef("x"), num(10)),
        Env.empty()
      );

      expect(implies(result.paramConstraints[0], isNumber)).toBe(true);
      expect(implies(result.resultConstraint, isBool)).toBe(true);
    });
  });

  describe("Function Constraints", () => {
    it("function has fnType constraint", () => {
      const expr = fn(["x", "y"], add(varRef("x"), varRef("y")));
      const result = run(expr);

      // The constraint should be fnType, not just isFunction
      expect(result.constraint.tag).toBe("fnType");
      if (result.constraint.tag === "fnType") {
        expect(result.constraint.params.length).toBe(2);
      }
    });

    it("fnType implies isFunction", () => {
      const fnConstraint = fnType([isNumber], isNumber);
      expect(implies(fnConstraint, isFunction)).toBe(true);
    });

    it("fnType with matching params/result implies another fnType", () => {
      // (number) -> number implies (number) -> number
      const a = fnType([isNumber], isNumber);
      const b = fnType([isNumber], isNumber);
      expect(implies(a, b)).toBe(true);
    });

    it("fnType subtyping is contravariant in params", () => {
      // (any) -> number implies (number) -> number
      // because if a function accepts anything, it can accept numbers
      const acceptsAny = fnType([{ tag: "any" } as any], isNumber);
      const acceptsNumber = fnType([isNumber], isNumber);
      expect(implies(acceptsAny, acceptsNumber)).toBe(true);
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

  describe("Constraint String Representation", () => {
    it("fnType has readable string format", () => {
      const c = fnType([isNumber, isNumber], isNumber);
      const str = constraintToString(c);
      expect(str).toBe("(number, number) -> number");
    });

    it("fnType with single param", () => {
      const c = fnType([isString], isBool);
      const str = constraintToString(c);
      expect(str).toBe("(string) -> boolean");
    });

    it("fnType with no params", () => {
      const c = fnType([], isNumber);
      const str = constraintToString(c);
      expect(str).toBe("() -> number");
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
