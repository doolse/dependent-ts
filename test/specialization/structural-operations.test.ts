/**
 * Structural Operations Tests
 *
 * Tests for type-directed structural operations like deep equality,
 * and collection operations that specialize based on element types.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Structural Operations Specialization", () => {
  describe("Deep equality", () => {
    it("specializes equality check for primitives vs objects", () => {
      const code = compile(parse(`
        let isEqual = fn(a, b) =>
          let T = typeOf(a) in
          if T == number || T == string || T == boolean then
            a == b
          else
            false
        in
        let n1 = trust(runtime(n1: 42), number) in
        let n2 = trust(runtime(n2: 42), number) in
        let s1 = trust(runtime(s1: "hi"), string) in
        let s2 = trust(runtime(s2: "hi"), string) in
        [isEqual(n1, n2), isEqual(s1, s2)]
      `));

      // Number and string have same structure (a == b), should deduplicate
      expect(code).toContain("isEqual");
    });

    it("generates primitive equality for number types", () => {
      const code = compile(parse(`
        let eq = fn(a, b) =>
          let T = typeOf(a) in
          if T == number then a == b
          else a == b
        in
        let x = trust(runtime(x: 1), number) in
        let y = trust(runtime(y: 1), number) in
        eq(x, y)
      `));

      expect(code).toContain("===");
    });
  });

  describe("Type-directed map operations", () => {
    it("specializes map transformer based on element type", () => {
      const code = compile(parse(`
        let double = fn(arr) =>
          let T = typeOf(arr) in
          map(arr, fn(x) => x * 2)
        in
        let nums = trust(runtime(nums: [1, 2, 3]), arrayOf(number)) in
        double(nums)
      `));

      expect(code).toContain("double");
      expect(code).toContain("map");
    });

    it("specializes different operations for number vs string arrays", () => {
      const code = compile(parse(`
        let process = fn(arr) =>
          let T = typeOf(arr) in
          map(arr, fn(x) => x + x)
        in
        let nums = trust(runtime(nums: [1, 2, 3]), arrayOf(number)) in
        let strs = trust(runtime(strs: ["a", "b"]), arrayOf(string)) in
        [process(nums), process(strs)]
      `));

      // Both use x + x but with different types
      expect(code).toContain("process");
    });
  });

  describe("Filter specialization", () => {
    it("specializes filter predicate", () => {
      const code = compile(parse(`
        let filterPositive = fn(arr) =>
          filter(arr, fn(x) => x > 0)
        in
        let nums = trust(runtime(nums: [1, -2, 3]), arrayOf(number)) in
        filterPositive(nums)
      `));

      expect(code).toContain("filterPositive");
      expect(code).toContain("filter");
    });
  });

  describe("Compile-time iteration", () => {
    it("uses comptimeFold for compile-time array iteration", () => {
      const result = parseAndRun(`
        let sumFields = fn(T) =>
          comptimeFold(fields(T), "", fn(acc, f) =>
            if acc == "" then f else acc + ", " + f
          )
        in
        sumFields(objectType({ x: number, y: number, z: number }))
      `);

      expect(result.value.tag).toBe("string");
      const str = (result.value as any).value;
      expect(str).toContain("x");
      expect(str).toContain("y");
      expect(str).toContain("z");
    });

    it("specializes based on type fields via comptimeFold", () => {
      const code = compile(parse(`
        let countFields = fn(T) =>
          comptimeFold(fields(comptime(T)), 0, fn(acc, f) => acc + 1)
        in
        let User = objectType({ name: string, age: number }) in
        let Point = objectType({ x: number, y: number, z: number }) in
        [countFields(User), countFields(Point)]
      `));

      // Both produce constant numbers
      expect(code).toContain("2");  // User has 2 fields
      expect(code).toContain("3");  // Point has 3 fields
    });
  });

  describe("Map and filter builtins", () => {
    it("correctly maps and doubles", () => {
      const result = parseAndRun(`
        let double = fn(arr) =>
          map(arr, fn(x) => x * 2)
        in
        double([1, 2, 3])
      `);

      expect(result.value.tag).toBe("array");
      const arr = result.value as any;
      expect(arr.elements.map((e: any) => e.value)).toEqual([2, 4, 6]);
    });

    it("correctly filters positive numbers", () => {
      const result = parseAndRun(`
        let positive = fn(arr) =>
          filter(arr, fn(x) => x > 0)
        in
        positive([-1, 2, -3, 4, -5])
      `);

      expect(result.value.tag).toBe("array");
      const arr = result.value as any;
      expect(arr.elements.map((e: any) => e.value)).toEqual([2, 4]);
    });
  });

  describe("Nested structure operations", () => {
    it("handles operations on arrays of objects", () => {
      const code = compile(parse(`
        let extractNames = fn(arr) =>
          map(arr, fn(obj) => obj.name)
        in
        let people = trust(runtime(p: [{ name: "A" }, { name: "B" }]),
                          arrayOf(objectType({ name: string }))) in
        extractNames(people)
      `));

      expect(code).toContain("extractNames");
      expect(code).toContain("map");
    });
  });
});
