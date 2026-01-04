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
} from "@dependent-ts/core";
import { isNow, isLater } from "@dependent-ts/core";

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
        // With desugaring, params is always empty - args are destructured in body
        expect(expr.params).toEqual([]);
        // Body should be a letPattern destructuring args
        expect(expr.body.tag).toBe("letPattern");
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
      // With desugaring, the format is: fn fact() => let [n] = args in ...
      expect(str).toContain("fn fact()");
      expect(str).toContain("let [n] = args in");
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

    it("recursive function with runtime input produces residual code", () => {
      const source = `
        let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
        factorial(runtime(5))
      `;
      const result = stage(parse(source));
      // Should be Later (runtime value) not infinite loop
      expect(isLater(result.svalue)).toBe(true);
      if (isLater(result.svalue)) {
        // The residual contains a deferred closure (staging happens during codegen)
        const residual = exprToString(result.svalue.residual);
        // With deferred staging, the residual shows the deferred closure
        expect(residual).toContain("deferred");
        expect(residual).toContain("fact");
      }
    });

    it("fibonacci with runtime input terminates", () => {
      const source = `
        let fib = fn fib(n) => if n <= 1 then n else fib(n - 1) + fib(n - 2) in
        fib(runtime(10))
      `;
      const result = stage(parse(source));
      expect(isLater(result.svalue)).toBe(true);
      if (isLater(result.svalue)) {
        const residual = exprToString(result.svalue.residual);
        expect(residual).toContain("fib");
      }
    });

    it("compile produces valid JavaScript for recursive function with runtime input", () => {
      const source = `
        let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
        factorial(runtime(5))
      `;
      const code = compile(parse(source));
      // Should produce valid code without infinite loop during compilation
      // Code generator uses ternary operator (? :) instead of if/else
      expect(code).toContain("fact");
      expect(code).toContain("?");  // ternary operator
    });

    it("nested recursive calls with runtime input terminate", () => {
      // f(f(runtime(n))) - inner call completes before outer
      const source = `
        let double = fn dbl(n) => if n == 0 then 0 else 2 + dbl(n - 1) in
        double(double(runtime(3)))
      `;
      const result = stage(parse(source));
      expect(isLater(result.svalue)).toBe(true);
    });

    it("mixed compile-time and runtime recursive calls in sequence", () => {
      // First call is compile-time, second is runtime - both should work
      const source1 = `
        let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
        factorial(5)
      `;
      const result1 = stage(parse(source1));
      expect(isNow(result1.svalue)).toBe(true);
      if (isNow(result1.svalue)) {
        expect((result1.svalue.value as any).value).toBe(120);
      }

      const source2 = `
        let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
        factorial(runtime(3))
      `;
      const result2 = stage(parse(source2));
      expect(isLater(result2.svalue)).toBe(true);
    });
  });
});
