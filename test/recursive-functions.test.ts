/**
 * Tests for recursive functions.
 */

import { describe, it, expect } from "vitest";
import {
  recfn,
  varRef,
  ifExpr,
  eq,
  num,
  mul,
  sub,
  add,
  call,
  letExpr,
  lteExpr,
  parse,
  parseAndRun,
  run,
  stage,
  compile,
  exprToString,
} from "../src/index";
import { isNow, isLater } from "../src/svalue";

describe("Recursive Functions", () => {
  describe("Basic Recursion", () => {
    it("factorial function works with programmatic construction", () => {
      // fn factorial(n) => if n == 0 then 1 else n * factorial(n - 1)
      const factorial = recfn("factorial", ["n"],
        ifExpr(
          eq(varRef("n"), num(0)),
          num(1),
          mul(varRef("n"), call(varRef("factorial"), sub(varRef("n"), num(1))))
        )
      );

      const expr = letExpr("factorial", factorial, call(varRef("factorial"), num(5)));
      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(120);
    });

    it("factorial(0) = 1", () => {
      const factorial = recfn("factorial", ["n"],
        ifExpr(
          eq(varRef("n"), num(0)),
          num(1),
          mul(varRef("n"), call(varRef("factorial"), sub(varRef("n"), num(1))))
        )
      );

      const expr = letExpr("factorial", factorial, call(varRef("factorial"), num(0)));
      const result = run(expr);
      expect((result.value as any).value).toBe(1);
    });

    it("factorial(1) = 1", () => {
      const factorial = recfn("factorial", ["n"],
        ifExpr(
          eq(varRef("n"), num(0)),
          num(1),
          mul(varRef("n"), call(varRef("factorial"), sub(varRef("n"), num(1))))
        )
      );

      const expr = letExpr("factorial", factorial, call(varRef("factorial"), num(1)));
      const result = run(expr);
      expect((result.value as any).value).toBe(1);
    });

    it("fibonacci function works", () => {
      // fn fib(n) => if n <= 1 then n else fib(n-1) + fib(n-2)
      const fib = recfn("fib", ["n"],
        ifExpr(
          lteExpr(varRef("n"), num(1)),
          varRef("n"),
          add(
            call(varRef("fib"), sub(varRef("n"), num(1))),
            call(varRef("fib"), sub(varRef("n"), num(2)))
          )
        )
      );

      const expr = letExpr("fib", fib, call(varRef("fib"), num(10)));
      const result = run(expr);
      expect((result.value as any).value).toBe(55);
    });
  });

  describe("Parser Integration", () => {
    it("parses named function syntax", () => {
      const source = "fn factorial(n) => if n == 0 then 1 else n * factorial(n - 1)";
      const expr = parse(source);
      expect(expr.tag).toBe("recfn");
      if (expr.tag === "recfn") {
        expect(expr.name).toBe("factorial");
        expect(expr.params).toEqual(["n"]);
      }
    });

    it("parses and runs factorial", () => {
      const source = `
        let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
        factorial(5)
      `;
      const result = parseAndRun(source);
      expect((result.value as any).value).toBe(120);
    });

    it("parses and runs fibonacci", () => {
      const source = `
        let fib = fn fib(n) => if n <= 1 then n else fib(n - 1) + fib(n - 2) in
        fib(10)
      `;
      const result = parseAndRun(source);
      expect((result.value as any).value).toBe(55);
    });

    it("anonymous functions still work", () => {
      const source = `
        let double = fn(x) => x * 2 in
        double(21)
      `;
      const result = parseAndRun(source);
      expect((result.value as any).value).toBe(42);
    });
  });

  describe("Pretty Printing", () => {
    it("pretty prints recursive function", () => {
      const factorial = recfn("fact", ["n"],
        ifExpr(
          eq(varRef("n"), num(0)),
          num(1),
          mul(varRef("n"), call(varRef("fact"), sub(varRef("n"), num(1))))
        )
      );
      const str = exprToString(factorial);
      expect(str).toContain("fn fact(n)");
    });
  });

  describe("Staged Evaluation", () => {
    it("recursive function with known input computes at compile time", () => {
      const source = `
        let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
        factorial(5)
      `;
      const result = stage(parse(source));
      expect(isNow(result.svalue)).toBe(true);
      if (isNow(result.svalue)) {
        expect((result.svalue.value as any).value).toBe(120);
      }
    });

    // Note: Recursive functions with runtime input currently cause infinite recursion
    // in the staged evaluator. This would require more sophisticated handling
    // (e.g., termination checking, fuel-based evaluation, or lazy residualization).
  });
});
