/**
 * Nullable Handling Tests
 *
 * Tests for specialization of nullable type handling - generating
 * type-appropriate default values based on the underlying type.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Nullable Handling Specialization", () => {
  describe("Basic withDefault behavior", () => {
    it("uses parameter lifting when only constant values differ", () => {
      // typeOf(x) IS compile-time, but when branch results are just different constants
      // with the same structure (x === null ? CONST : x), parameter lifting is used
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

      // Parameter lifting: one function with lifted constant parameter
      expect(code).toContain("withDefault");
      expect(code).toContain("0");
      expect(code).toContain('""');
      // Verify parameter lifting pattern
      expect(code).toMatch(/_p0/);
    });

    it("specializes when typeOf causes structurally different code", () => {
      // When typeOf(x) leads to different operations (not just constants),
      // proper function specialization occurs
      const code = compile(parse(`
        let process = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else if T == string then x + "!"
          else x
        in
        let n = trust(runtime(n: 42), number) in
        let s = trust(runtime(s: "hi"), string) in
        [process(n), process(s)]
      `));

      // Different operations = different specializations
      expect(code).toContain("process$0");
      expect(code).toContain("process$1");
      expect(code).toContain("* 2");
      expect(code).toContain('+ "!"');
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
    it("uses parameter lifting for primitives, separate function for arrays", () => {
      // Primitives (0, "", false) have same structure -> parameter lifting
      // Array ([]) has different structure -> separate function
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

      // Primitives share one function with parameter lifting
      // Array gets its own function (different structure)
      expect(code).toContain("withDefault$0"); // primitive version with lifted param
      expect(code).toContain("withDefault$1"); // array version
      expect(code).not.toContain("withDefault$2"); // only 2 structural variants
      expect(code).toContain("0");
      expect(code).toContain('""');
      expect(code).toContain("false");
      expect(code).toContain("[]");
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

    it("handles nested optional access without specialization", () => {
      const code = compile(parse(`
        let safeName = fn(x) =>
          if x == null then "none"
          else x
        in
        let name1 = trust(runtime(n1: "Alice"), nullable(string)) in
        let name2 = trust(runtime(n2: null), nullable(string)) in
        [safeName(name1), safeName(name2)]
      `));

      // Same nullable type = single function
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
    it("handles simple null checks in functions", () => {
      // Simple null check without typeOf for array mapping
      const code = compile(parse(`
        let fillNull = fn(x) =>
          if x == null then 0 else x
        in
        let arr = trust(runtime(arr: [1, 2, 3]),
                       array) in
        [fillNull(arr[0]), fillNull(arr[1])]
      `));

      expect(code).toContain("fillNull");
    });

    it("handles object with multiple nullable fields", () => {
      // typeOf doesn't differentiate field types at runtime without explicit info
      const code = compile(parse(`
        let withDefault = fn(x) =>
          if x == null then false else x
        in
        let form = trust(runtime(f: { name: null, age: null }),
                        objectType({ name: nullable(string), age: nullable(number) })) in
        {
          name: withDefault(form.name),
          age: withDefault(form.age)
        }
      `));

      // Same function used for both fields
      expect(code).toContain("withDefault");
      expect(code).not.toContain("withDefault$");
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
    it("handles transform-or-default pattern with different closures", () => {
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

      // Different transform functions passed as parameters
      expect(code).toContain("mapOrDefault");
      expect(code).toContain("0");
      expect(code).toContain('""');
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
