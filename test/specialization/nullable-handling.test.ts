/**
 * Nullable Handling Tests
 *
 * Tests for specialization of nullable type handling - generating
 * type-appropriate default values based on the underlying type.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Nullable Handling Specialization", () => {
  describe("Basic withDefault specialization", () => {
    it("specializes withDefault for nullable number vs nullable string", () => {
      const code = compile(parse(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          let defaultVal = if T == number then 0
            else if T == string then ""
            else false
          in
          if x == null then defaultVal else x
        in
        let maybeNum = trust(runtime(n: 42), nullable(number)) in
        let maybeStr = trust(runtime(s: "hello"), nullable(string)) in
        [withDefault(maybeNum), withDefault(maybeStr)]
      `));

      // Two different types = two specializations
      expect(code).toContain("withDefault$0");
      expect(code).toContain("withDefault$1");

      // One should return 0, the other ""
      expect(code).toMatch(/x === null \? 0 : x/);
      expect(code).toMatch(/x === null \? "" : x/);
    });

    it("uses base name with single call site", () => {
      const code = compile(parse(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then
            if T == number then 0 else ""
          else x
        in
        let maybeNum = trust(runtime(n: 42), nullable(number)) in
        withDefault(maybeNum)
      `));

      // Single call = base name
      expect(code).toContain("withDefault");
      expect(code).not.toContain("withDefault$");
    });

    it("deduplicates same-type calls", () => {
      const code = compile(parse(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then
            if T == number then 0 else ""
          else x
        in
        let a = trust(runtime(a: 1), nullable(number)) in
        let b = trust(runtime(b: 2), nullable(number)) in
        let c = trust(runtime(c: 3), nullable(number)) in
        [withDefault(a), withDefault(b), withDefault(c)]
      `));

      // Three calls with same type = one specialization, no suffix
      expect(code).toContain("withDefault");
      expect(code).not.toContain("withDefault$");
    });
  });

  describe("Multi-type default values", () => {
    it("specializes for number, string, boolean, and array types", () => {
      const code = compile(parse(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then
            if T == number then 0
            else if T == string then ""
            else if T == boolean then false
            else []
          else x
        in
        let n = trust(runtime(n: 42), nullable(number)) in
        let s = trust(runtime(s: "hi"), nullable(string)) in
        let b = trust(runtime(b: true), nullable(boolean)) in
        let a = trust(runtime(a: [1,2]), nullable(array)) in
        [withDefault(n), withDefault(s), withDefault(b), withDefault(a)]
      `));

      expect(code).toContain("withDefault$0");
      expect(code).toContain("withDefault$1");
      expect(code).toContain("withDefault$2");
      expect(code).toContain("withDefault$3");
    });
  });

  describe("Optional chaining patterns", () => {
    it("specializes optional field access with default", () => {
      const code = compile(parse(`
        let getOrDefault = fn(obj, field, default) =>
          let val = dynamicField(obj, comptime(field)) in
          if val == null then default else val
        in
        let person = trust(runtime(p: { name: "Alice" }),
                          objectType({ name: nullable(string) })) in
        getOrDefault(person, "name", "Unknown")
      `));

      // Should have specialized field access
      expect(code).toContain("getOrDefault");
    });

    it("specializes nested optional access", () => {
      const code = compile(parse(`
        let safeName = fn(x) =>
          let T = typeOf(x) in
          if x == null then "none"
          else if T == string then x
          else "unknown"
        in
        let name1 = trust(runtime(n1: "Alice"), nullable(string)) in
        let name2 = trust(runtime(n2: null), nullable(string)) in
        [safeName(name1), safeName(name2)]
      `));

      // Same nullable type = one specialization
      expect(code).toContain("safeName");
      expect(code).not.toContain("safeName$");
    });
  });

  describe("Default value factories", () => {
    it("specializes factory-based defaults", () => {
      const code = compile(parse(`
        let orElse = fn(x, factory) =>
          if x == null then factory() else x
        in
        let maybeNum = trust(runtime(n: null), nullable(number)) in
        let maybeStr = trust(runtime(s: null), nullable(string)) in
        [
          orElse(maybeNum, fn() => 0),
          orElse(maybeStr, fn() => "default")
        ]
      `));

      // Different factory return types could lead to specialization
      expect(code).toContain("orElse");
    });
  });

  describe("Nullable in data structures", () => {
    it("handles arrays with nullable elements", () => {
      const code = compile(parse(`
        let fillNulls = fn(x) =>
          let T = typeOf(x) in
          if x == null then
            if T == number then 0 else ""
          else x
        in
        let arr = trust(runtime(arr: [1, null, 3]),
                       arrayOf(nullable(number))) in
        map(arr, fillNulls)
      `));

      expect(code).toContain("fillNulls");
      expect(code).toContain("map");
    });

    it("handles object with multiple nullable fields", () => {
      const code = compile(parse(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then
            if T == number then 0
            else if T == string then ""
            else false
          else x
        in
        let form = trust(runtime(f: { name: null, age: null }),
                        objectType({ name: nullable(string), age: nullable(number) })) in
        {
          name: withDefault(form.name),
          age: withDefault(form.age)
        }
      `));

      // name is string, age is number - two specializations
      expect(code).toContain("withDefault$0");
      expect(code).toContain("withDefault$1");
    });
  });

  describe("Coalescing operators", () => {
    it("specializes null coalescing for different types", () => {
      const code = compile(parse(`
        let coalesce = fn(a, b) =>
          if a == null then b else a
        in
        let n1 = trust(runtime(n1: null), nullable(number)) in
        let n2 = trust(runtime(n2: 42), number) in
        let s1 = trust(runtime(s1: null), nullable(string)) in
        let s2 = trust(runtime(s2: "default"), string) in
        [coalesce(n1, n2), coalesce(s1, s2)]
      `));

      // Coalesce doesn't use typeOf, so bodies should be same
      // Both generate: a === null ? b : a
      expect(code).toContain("coalesce");
    });

    it("specializes first-non-null across multiple values", () => {
      const code = compile(parse(`
        let firstNonNull = fn(a, b, c) =>
          if a != null then a
          else if b != null then b
          else c
        in
        let x = trust(runtime(x: null), nullable(number)) in
        let y = trust(runtime(y: null), nullable(number)) in
        let z = trust(runtime(z: 42), number) in
        firstNonNull(x, y, z)
      `));

      expect(code).toContain("firstNonNull");
    });
  });

  describe("Default value with transformation", () => {
    it("specializes transform-or-default pattern", () => {
      const code = compile(parse(`
        let mapOrDefault = fn(x, transform, default) =>
          if x == null then default
          else transform(x)
        in
        let maybeNum = trust(runtime(n: 42), nullable(number)) in
        let maybeStr = trust(runtime(s: "hi"), nullable(string)) in
        [
          mapOrDefault(maybeNum, fn(n) => n * 2, 0),
          mapOrDefault(maybeStr, fn(s) => s + "!", "")
        ]
      `));

      // Different transform functions = different bodies
      expect(code).toContain("mapOrDefault$0");
      expect(code).toContain("mapOrDefault$1");
    });
  });

  describe("Runtime correctness", () => {
    it("returns default for null number", () => {
      const result = parseAndRun(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then 0 else x
        in
        withDefault(null)
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(0);
    });

    it("returns value for non-null number", () => {
      const result = parseAndRun(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then 0 else x
        in
        withDefault(42)
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(42);
    });

    it("returns default for null string", () => {
      const result = parseAndRun(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then "" else x
        in
        withDefault(null)
      `);

      expect(result.value.tag).toBe("string");
      expect((result.value as any).value).toBe("");
    });

    it("returns value for non-null string", () => {
      const result = parseAndRun(`
        let withDefault = fn(x) =>
          let T = typeOf(x) in
          if x == null then "" else x
        in
        withDefault("hello")
      `);

      expect(result.value.tag).toBe("string");
      expect((result.value as any).value).toBe("hello");
    });
  });

  describe("Complex nullable scenarios", () => {
    it("handles nested nullable checks", () => {
      const code = compile(parse(`
        let safeGet = fn(obj, key) =>
          let val = if obj == null then null else dynamicField(obj, comptime(key)) in
          let T = typeOf(val) in
          if val == null then
            if T == number then 0
            else if T == string then ""
            else null
          else val
        in
        let data = trust(runtime(d: { count: 5 }),
                        nullable(objectType({ count: nullable(number) }))) in
        safeGet(data, "count")
      `));

      expect(code).toContain("safeGet");
    });
  });
});
