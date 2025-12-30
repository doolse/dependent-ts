/**
 * Validation Combinators Tests
 *
 * Tests for specialization of validation functions - generating
 * optimized validators based on compile-time known schemas.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Validation Combinators Specialization", () => {
  describe("Basic validators", () => {
    it("specializes minLength validator with compile-time limit", () => {
      const code = compile(parse(`
        let minLength = fn(min) =>
          fn(s) =>
            let limit = comptime(min) in
            s.length >= limit
        in
        let validate5 = minLength(5) in
        let validate10 = minLength(10) in
        let input = trust(runtime(s: "hello"), string) in
        [validate5(input), validate10(input)]
      `));

      // Two different min values = two specializations
      expect(code).toContain("validate5");
      expect(code).toContain("validate10");
      // Should have the literal limits baked in
      expect(code).toMatch(/length >= 5/);
      expect(code).toMatch(/length >= 10/);
    });

    it("specializes maxLength validator", () => {
      const code = compile(parse(`
        let maxLength = fn(max) =>
          fn(s) =>
            let limit = comptime(max) in
            s.length <= limit
        in
        let validate100 = maxLength(100) in
        let input = trust(runtime(s: "test"), string) in
        validate100(input)
      `));

      expect(code).toContain("validate100");
      expect(code).toMatch(/length <= 100/);
    });

    it("specializes numeric range validator", () => {
      const code = compile(parse(`
        let inRange = fn(min, max) =>
          fn(n) =>
            let lo = comptime(min) in
            let hi = comptime(max) in
            n >= lo && n <= hi
        in
        let validateAge = inRange(0, 120) in
        let validatePercent = inRange(0, 100) in
        let age = trust(runtime(age: 25), number) in
        let pct = trust(runtime(pct: 50), number) in
        [validateAge(age), validatePercent(pct)]
      `));

      expect(code).toContain("validateAge");
      expect(code).toContain("validatePercent");
      expect(code).toMatch(/n >= 0 && n <= 120/);
      expect(code).toMatch(/n >= 0 && n <= 100/);
    });
  });

  describe("Composed validators", () => {
    it("specializes AND-composed validators", () => {
      const code = compile(parse(`
        let minLength = fn(min) =>
          fn(s) => s.length >= comptime(min)
        in
        let maxLength = fn(max) =>
          fn(s) => s.length <= comptime(max)
        in
        let both = fn(v1, v2) =>
          fn(x) => v1(x) && v2(x)
        in
        let validateUsername = both(minLength(3), maxLength(20)) in
        let input = trust(runtime(u: "alice"), string) in
        validateUsername(input)
      `));

      expect(code).toContain("validateUsername");
      // Should have both checks
      expect(code).toMatch(/length >= 3/);
      expect(code).toMatch(/length <= 20/);
    });

    it("specializes OR-composed validators", () => {
      const code = compile(parse(`
        let isEmpty = fn(s) => s.length == 0 in
        let minLength = fn(min) =>
          fn(s) => s.length >= comptime(min)
        in
        let either = fn(v1, v2) =>
          fn(x) => v1(x) || v2(x)
        in
        let validateOptional = either(isEmpty, minLength(5)) in
        let input = trust(runtime(s: "hello"), string) in
        validateOptional(input)
      `));

      expect(code).toContain("validateOptional");
    });
  });

  describe("Type-based validation", () => {
    it("specializes validator based on input type", () => {
      const code = compile(parse(`
        let isValid = fn(x) =>
          let T = typeOf(x) in
          if T == number then x >= 0
          else if T == string then x.length > 0
          else if T == boolean then x
          else false
        in
        let n = trust(runtime(n: 42), number) in
        let s = trust(runtime(s: "hi"), string) in
        let b = trust(runtime(b: true), boolean) in
        [isValid(n), isValid(s), isValid(b)]
      `));

      expect(code).toContain("isValid$0");
      expect(code).toContain("isValid$1");
      expect(code).toContain("isValid$2");
    });
  });

  describe("Validation with error messages", () => {
    it("specializes validation result with baked-in messages", () => {
      const code = compile(parse(`
        let validate = fn(rule, message) =>
          fn(x) =>
            let msg = comptime(message) in
            if rule(x) then { valid: true, error: null }
            else { valid: false, error: msg }
        in
        let notEmpty = validate(fn(s) => s.length > 0, "Must not be empty") in
        let input = trust(runtime(s: ""), string) in
        notEmpty(input)
      `));

      expect(code).toContain("notEmpty");
      expect(code).toContain("Must not be empty");
    });

    it("specializes multiple validators with different messages", () => {
      const code = compile(parse(`
        let required = fn(msg) =>
          fn(s) =>
            let m = comptime(msg) in
            if s.length > 0 then { valid: true, error: null }
            else { valid: false, error: m }
        in
        let validateName = required("Name is required") in
        let validateEmail = required("Email is required") in
        let name = trust(runtime(name: ""), string) in
        let email = trust(runtime(email: ""), string) in
        [validateName(name), validateEmail(email)]
      `));

      // Same structure but different messages - should still specialize
      expect(code).toContain("validateName");
      expect(code).toContain("validateEmail");
      expect(code).toContain("Name is required");
      expect(code).toContain("Email is required");
    });
  });

  describe("Pattern validation", () => {
    it("specializes regex-based validation", () => {
      const code = compile(parse(`
        let matches = fn(pattern) =>
          fn(s) =>
            let p = comptime(pattern) in
            s.includes(p)
        in
        let hasAt = matches("@") in
        let hasDot = matches(".") in
        let email = trust(runtime(e: "test@example.com"), string) in
        hasAt(email) && hasDot(email)
      `));

      expect(code).toContain("hasAt");
      expect(code).toContain("hasDot");
      expect(code).toMatch(/includes\("@"\)/);
      expect(code).toMatch(/includes\("\."\)/);
    });

    it("specializes prefix/suffix validation", () => {
      const code = compile(parse(`
        let startsWith = fn(prefix) =>
          fn(s) =>
            let p = comptime(prefix) in
            s.startsWith(p)
        in
        let endsWith = fn(suffix) =>
          fn(s) =>
            let suf = comptime(suffix) in
            s.endsWith(suf)
        in
        let isHttps = startsWith("https://") in
        let isHtml = endsWith(".html") in
        let url = trust(runtime(url: "https://example.com/page.html"), string) in
        isHttps(url) && isHtml(url)
      `));

      expect(code).toContain("isHttps");
      expect(code).toContain("isHtml");
      expect(code).toMatch(/startsWith\("https:\/\/"\)/);
      expect(code).toMatch(/endsWith\("\.html"\)/);
    });
  });

  describe("Object validation", () => {
    it("specializes field validation based on schema", () => {
      const code = compile(parse(`
        let validateField = fn(fieldName, validator) =>
          fn(obj) =>
            let f = comptime(fieldName) in
            validator(dynamicField(obj, f))
        in
        let nameNotEmpty = validateField("name", fn(s) => s.length > 0) in
        let agePositive = validateField("age", fn(n) => n > 0) in
        let person = trust(runtime(p: { name: "Alice", age: 30 }),
                          objectType({ name: string, age: number })) in
        nameNotEmpty(person) && agePositive(person)
      `));

      expect(code).toContain("nameNotEmpty");
      expect(code).toContain("agePositive");
    });
  });

  describe("Array validation", () => {
    it("specializes all-elements validator", () => {
      const code = compile(parse(`
        let allPass = fn(validator) =>
          fn(arr) =>
            fold(arr, true, fn(acc, x) => acc && validator(x))
        in
        let allPositive = allPass(fn(n) => n > 0) in
        let nums = trust(runtime(nums: [1, 2, 3]), arrayOf(number)) in
        allPositive(nums)
      `));

      expect(code).toContain("allPositive");
      expect(code).toMatch(/x > 0/);
    });

    it("specializes some-element validator", () => {
      const code = compile(parse(`
        let somePass = fn(validator) =>
          fn(arr) =>
            fold(arr, false, fn(acc, x) => acc || validator(x))
        in
        let hasNegative = somePass(fn(n) => n < 0) in
        let nums = trust(runtime(nums: [1, -2, 3]), arrayOf(number)) in
        hasNegative(nums)
      `));

      expect(code).toContain("hasNegative");
    });

    it("specializes length validation", () => {
      const code = compile(parse(`
        let hasLength = fn(len) =>
          fn(arr) =>
            let expected = comptime(len) in
            arr.length == expected
        in
        let hasTwoElements = hasLength(2) in
        let hasThreeElements = hasLength(3) in
        let arr = trust(runtime(arr: [1, 2]), arrayOf(number)) in
        [hasTwoElements(arr), hasThreeElements(arr)]
      `));

      expect(code).toContain("hasTwoElements");
      expect(code).toContain("hasThreeElements");
      expect(code).toMatch(/length === 2/);
      expect(code).toMatch(/length === 3/);
    });
  });

  describe("Conditional validation", () => {
    it("specializes validation based on type guard", () => {
      const code = compile(parse(`
        let validateIfNumber = fn(x) =>
          let T = typeOf(x) in
          if T == number then x >= 0 && x <= 100
          else true
        in
        let n = trust(runtime(n: 50), number) in
        let s = trust(runtime(s: "hi"), string) in
        [validateIfNumber(n), validateIfNumber(s)]
      `));

      expect(code).toContain("validateIfNumber$0");
      expect(code).toContain("validateIfNumber$1");
    });
  });

  describe("Runtime correctness", () => {
    it("minLength validates correctly", () => {
      const result = parseAndRun(`
        let minLength = fn(min) =>
          fn(s) => s.length >= min
        in
        let validate5 = minLength(5) in
        [validate5("hi"), validate5("hello"), validate5("hello world")]
      `);

      expect(result.value.tag).toBe("array");
      const arr = result.value as any;
      expect(arr.elements.map((e: any) => e.value)).toEqual([false, true, true]);
    });

    it("range validator works correctly", () => {
      const result = parseAndRun(`
        let inRange = fn(min, max) =>
          fn(n) => n >= min && n <= max
        in
        let validate = inRange(0, 100) in
        [validate(-1), validate(0), validate(50), validate(100), validate(101)]
      `);

      expect(result.value.tag).toBe("array");
      const arr = result.value as any;
      expect(arr.elements.map((e: any) => e.value)).toEqual([false, true, true, true, false]);
    });

    it("composed validators work correctly", () => {
      const result = parseAndRun(`
        let minLen = fn(min) => fn(s) => s.length >= min in
        let maxLen = fn(max) => fn(s) => s.length <= max in
        let both = fn(v1, v2) => fn(x) => v1(x) && v2(x) in
        let validate = both(minLen(3), maxLen(10)) in
        [validate("ab"), validate("abc"), validate("hello"), validate("hello world!")]
      `);

      expect(result.value.tag).toBe("array");
      const arr = result.value as any;
      expect(arr.elements.map((e: any) => e.value)).toEqual([false, true, true, false]);
    });
  });

  describe("Nested validation schemas", () => {
    it("handles deeply nested validators", () => {
      const code = compile(parse(`
        let required = fn(s) => s.length > 0 in
        let minLen = fn(min) => fn(s) => s.length >= comptime(min) in
        let maxLen = fn(max) => fn(s) => s.length <= comptime(max) in

        let validateUsername = fn(s) =>
          required(s) && minLen(3)(s) && maxLen(20)(s)
        in

        let input = trust(runtime(u: "alice"), string) in
        validateUsername(input)
      `));

      expect(code).toContain("validateUsername");
      expect(code).toContain(">= 3");
      expect(code).toContain("<= 20");
    });
  });
});
