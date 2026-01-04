/**
 * Type-Directed Formatting Tests
 *
 * Tests for specialization based on typeOf() - generating different code
 * for different types at compile time.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "@dependent-ts/core";

describe("Type-Directed Formatting", () => {
  describe("Basic format function specialization", () => {
    it("specializes format for number vs string types", () => {
      const code = compile(parse(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == number then "num:" + x.toString()
          else if T == string then "str:" + x
          else "other"
        in
        let n = trust(runtime(n: 42), number) in
        let s = trust(runtime(s: "hello"), string) in
        [format(n), format(s)]
      `));

      // Should have two specialized versions
      expect(code).toContain("format$0");
      expect(code).toContain("format$1");

      // Number version should use toString
      expect(code).toMatch(/\"num:\" \+ x\.toString\(\)/);

      // String version should concatenate directly
      expect(code).toMatch(/\"str:\" \+ x/);
    });

    it("uses base name when only one call site", () => {
      const code = compile(parse(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == number then x.toFixed(2)
          else x
        in
        let price = trust(runtime(p: 19.99), number) in
        format(price)
      `));

      // Single call site - should use base name
      expect(code).toContain("format");
      expect(code).not.toContain("format$");
      expect(code).toContain("toFixed(2)");
    });

    it("generates specialized functions with same body", () => {
      const code = compile(parse(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == number then x + 1
          else x + 1
        in
        let n = trust(runtime(n: 42), number) in
        let s = trust(runtime(s: 1), number) in
        [format(n), format(s)]
      `));

      // Both branches produce x + 1
      // Currently each call site gets its own specialization
      // (deduplication by body content is a potential future optimization)
      expect(code).toContain("format");
      expect(code).toContain("+ 1");
    });
  });

  describe("Multi-type formatting", () => {
    it("specializes for number, string, and boolean", () => {
      const code = compile(parse(`
        let stringify = fn(x) =>
          let T = typeOf(x) in
          if T == number then "N" + x.toString()
          else if T == string then "S" + x
          else if T == boolean then if x then "T" else "F"
          else "?"
        in
        let n = trust(runtime(n: 42), number) in
        let s = trust(runtime(s: "hi"), string) in
        let b = trust(runtime(b: true), boolean) in
        [stringify(n), stringify(s), stringify(b)]
      `));

      // Should have three specialized versions
      expect(code).toContain("stringify$0");
      expect(code).toContain("stringify$1");
      expect(code).toContain("stringify$2");
    });

    it("specializes separately for different types", () => {
      const code = compile(parse(`
        let display = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else x + x
        in
        let a = trust(runtime(a: 1), number) in
        let c = trust(runtime(c: "x"), string) in
        [display(a), display(c)]
      `));

      // Number and string produce different bodies - two specializations
      expect(code).toContain("display$0");
      expect(code).toContain("display$1");
      // One should have * 2, the other + x
      expect(code).toMatch(/x \* 2/);
      expect(code).toMatch(/x \+ x/);
    });
  });

  describe("Numeric formatting", () => {
    it("specializes toFixed precision based on type info", () => {
      const code = compile(parse(`
        let formatMoney = fn(x) =>
          let T = typeOf(x) in
          if T == number then "$" + x.toFixed(2)
          else x
        in
        let price = trust(runtime(p: 19.99), number) in
        formatMoney(price)
      `));

      expect(code).toContain('toFixed(2)');
      expect(code).toContain('"$"');
    });

    it("generates different precision for different contexts", () => {
      const code = compile(parse(`
        let formatNum = fn(x, precision) =>
          let p = comptime(precision) in
          if p == 0 then x + 0
          else if p == 2 then x.toFixed(2)
          else x.toFixed(4)
        in
        let val = trust(runtime(v: 3.14159), number) in
        [formatNum(val, 0), formatNum(val, 2), formatNum(val, 4)]
      `));

      // Two structural patterns: x + 0 and toFixed (with parameter lifting for precision)
      expect(code).toContain("formatNum$0");  // For x + 0
      expect(code).toContain("formatNum$1");  // For toFixed with lifted precision
      expect(code).toMatch(/x \+ 0/);
      expect(code).toMatch(/toFixed/);
    });
  });

  describe("String formatting", () => {
    it("specializes string quoting based on type", () => {
      const code = compile(parse(`
        let quote = fn(x) =>
          let T = typeOf(x) in
          if T == string then "'" + x + "'"
          else x.toString()
        in
        let s = trust(runtime(s: "hello"), string) in
        let n = trust(runtime(n: 42), number) in
        [quote(s), quote(n)]
      `));

      expect(code).toContain("quote$0");
      expect(code).toContain("quote$1");
      // String path wraps in quotes
      expect(code).toMatch(/"'" \+ x \+ "'"/);
      // Number path calls toString
      expect(code).toMatch(/x\.toString\(\)/);
    });

    it("handles escape sequences in format strings", () => {
      const code = compile(parse(`
        let escape = fn(x) =>
          let T = typeOf(x) in
          if T == string then x.replace("\\n", "\\\\n")
          else x.toString()
        in
        let s = trust(runtime(s: "hello\\nworld"), string) in
        escape(s)
      `));

      expect(code).toContain("replace");
    });
  });

  describe("Object formatting", () => {
    it("specializes based on object type structure", () => {
      const code = compile(parse(`
        let describe = fn(x) =>
          let T = typeOf(x) in
          if T == objectType({ x: number, y: number }) then
            x.x + x.y
          else
            x.a + x.b
        in
        let point = trust(runtime(p: { x: 1, y: 2 }), objectType({ x: number, y: number })) in
        let vec = trust(runtime(v: { a: 10, b: 20 }),
                          objectType({ a: number, b: number })) in
        [describe(point), describe(vec)]
      `));

      // Different object structures = different specializations
      expect(code).toContain("describe$0");
      expect(code).toContain("describe$1");
    });
  });

  describe("Conditional formatting chains", () => {
    it("specializes nested type checks", () => {
      const code = compile(parse(`
        let jsonValue = fn(x) =>
          let T = typeOf(x) in
          if T == null then "null"
          else if T == boolean then if x then "true" else "false"
          else if T == number then x + 0
          else if T == string then "s:" + x
          else "{}"
        in
        let b = trust(runtime(b: true), boolean) in
        let num = trust(runtime(num: 42), number) in
        let s = trust(runtime(s: "hi"), string) in
        [jsonValue(b), jsonValue(num), jsonValue(s)]
      `));

      // Three different types = three specializations
      expect(code).toContain("jsonValue$0");
      expect(code).toContain("jsonValue$1");
      expect(code).toContain("jsonValue$2");
    });
  });

  describe("Format with runtime configuration", () => {
    it("specializes format but preserves runtime values", () => {
      const code = compile(parse(`
        let formatWithPrefix = fn(prefix, x) =>
          let T = typeOf(x) in
          if T == number then prefix + x.toFixed(2)
          else prefix + x
        in
        let pre = trust(runtime(pre: "> "), string) in
        let n = trust(runtime(n: 42), number) in
        let s = trust(runtime(s: "hello"), string) in
        [formatWithPrefix(pre, n), formatWithPrefix(pre, s)]
      `));

      // prefix is runtime, x is specialized by type
      expect(code).toContain("formatWithPrefix$0");
      expect(code).toContain("formatWithPrefix$1");
      // Both should use prefix parameter
      expect(code).toMatch(/prefix \+/);
    });
  });

  describe("Correctness verification", () => {
    it("produces correct runtime results for number formatting", () => {
      const result = parseAndRun(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else 0
        in
        format(21)
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(42);
    });

    it("produces correct runtime results for string formatting", () => {
      const result = parseAndRun(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == string then x + "!"
          else ""
        in
        format("hello")
      `);

      expect(result.value.tag).toBe("string");
      expect((result.value as any).value).toBe("hello!");
    });

    it("type checking works at compile time even with runtime values", () => {
      const result = stage(parse(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else x + x
        in
        let n = trust(runtime(n: 21), number) in
        format(n)
      `));

      // Result should be Later (runtime computation) but type-correct
      expect(isLater(result.svalue)).toBe(true);
    });
  });
});
