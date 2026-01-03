/**
 * Tests to prevent regression of unwanted function specialization.
 *
 * The key invariant: specialization (creating multiple versions of a function or
 * inlining function bodies at call sites) should ONLY happen when comptimeParams
 * are involved (parameters used inside comptime() or typeOf()).
 *
 * Without comptimeParams:
 * - Function calls should generate call expressions (e.g., `f(x)`)
 * - Function bodies should NOT be inlined at call sites
 * - ONE generic function should be generated, not multiple specialized versions
 */

import { describe, it, expect } from "vitest";
import { parseAndCompile } from "../src/index";

describe("no unwanted specialization", () => {
  describe("helper functions should not be inlined", () => {
    it("generates call to helper function, not inlined body", () => {
      const code = parseAndCompile(`
        let isEmpty = fn(s) => s.length == 0
        in isEmpty(runtime(email: ""))
      `);

      // Should generate a call to isEmpty, NOT inline the body
      expect(code).toContain("const isEmpty = (s) => s.length === 0");
      expect(code).toContain("isEmpty(email)");
      // Should NOT have the body inlined (email.length === 0 outside the function)
      expect(code).not.toMatch(/return email\.length === 0/);
    });

    it("generates calls to multiple helper functions", () => {
      const code = parseAndCompile(`
        let isEmpty = fn(s) => s.length == 0
        in let isValid = fn(s) => s.length > 3
        in [isEmpty(runtime(x: "")), isValid(runtime(x: ""))]
      `);

      expect(code).toContain("isEmpty(x)");
      expect(code).toContain("isValid(x)");
      expect(code).not.toContain("x.length === 0"); // Not inlined
      expect(code).not.toContain("x.length > 3"); // Not inlined
    });

    it("does not duplicate validation logic", () => {
      const code = parseAndCompile(`
        let validate = fn(email, password) =>
          if email.length == 0 then "Email required"
          else if password.length < 8 then "Password too short"
          else "OK"
        in let handleSubmit = fn() => validate(runtime(e: ""), runtime(p: ""))
        in handleSubmit()
      `);

      // validate should be called, not have its body duplicated
      expect(code).toContain("validate(e, p)");
      // The condition logic should only appear once (in validate definition)
      const emailLengthMatches = code.match(/email\.length === 0/g) || [];
      expect(emailLengthMatches.length).toBe(1);
    });
  });

  describe("recursive functions should not create multiple specialized versions", () => {
    it("generates ONE generic sumField function with runtime branching", () => {
      const code = parseAndCompile(`
        let sumField = fn sumRec(arr, field, idx) =>
          if idx >= arr.length then 0
          else (
            let item = arr[idx]
            in let value = if field == "amount" then item.amount else item.quantity
            in value + sumRec(arr, field, idx + 1)
          )
        in let data = runtime(data: [])
        in [sumField(data, "amount", 0), sumField(data, "quantity", 0)]
      `);

      // Should have exactly ONE sumField function definition
      const sumFieldDefs = code.match(/const sumField = function/g) || [];
      expect(sumFieldDefs.length).toBe(1);

      // Should NOT have specialized versions like sumField$0, sumField$1
      expect(code).not.toMatch(/sumField\$\d/);

      // Should have runtime branching on field
      expect(code).toContain('field === "amount"');

      // Should call with both field values
      expect(code).toContain('sumField(data, "amount", 0)');
      expect(code).toContain('sumField(data, "quantity", 0)');
    });

    it("generates ONE generic recursive function for factorial-like pattern", () => {
      const code = parseAndCompile(`
        let factorial = fn fac(n) =>
          if n == 0 then 1
          else n * fac(n - 1)
        in factorial(runtime(x: 0))
      `);

      // Should have exactly ONE factorial function
      const factorialDefs = code.match(/const factorial = function/g) || [];
      expect(factorialDefs.length).toBe(1);

      // Should generate a call
      expect(code).toContain("factorial(x)");
    });

    it("uses correct index in recursive array processing", () => {
      const code = parseAndCompile(`
        let sum = fn sumRec(arr, idx) =>
          if idx >= arr.length then 0
          else arr[idx] + sumRec(arr, idx + 1)
        in sum(runtime(arr: []), 0)
      `);

      // Should use arr[idx], NOT arr[0]
      expect(code).toContain("arr[idx]");
      expect(code).not.toMatch(/arr\[0\]/);
    });
  });

  describe("curried functions should preserve call structure", () => {
    it("generates curried call for higher-order function", () => {
      const code = parseAndCompile(`
        let minLength = fn(n) => fn(s) => s.length >= n
        in minLength(8)(runtime(password: ""))
      `);

      // Should generate: minLength(8)(password)
      expect(code).toContain("minLength(8)(password)");
    });

    it("generates call for filterByCategory pattern", () => {
      const code = parseAndCompile(`
        let filterByCategory = fn(cat) => fn(item) =>
          if cat == "All" then true
          else item.category == cat
        in filterByCategory(runtime(category: ""))
      `);

      // Should generate a call, not inline the body
      expect(code).toContain("filterByCategory(category)");
    });
  });

  describe("compile-time values should still be computed", () => {
    it("computes result when all inputs are Now", () => {
      const code = parseAndCompile(`
        let add = fn(x, y) => x + y
        in add(2, 3)
      `);

      // All inputs known at compile time - result should be computed
      expect(code).toBe("5");
    });

    it("inlines value for pure function with literal args", () => {
      const code = parseAndCompile(`
        let double = fn(x) => x * 2
        in double(21)
      `);

      expect(code).toBe("42");
    });
  });

  describe("comptimeParams should trigger specialization", () => {
    it("specializes when typeOf is used on parameter", () => {
      const code = parseAndCompile(`
        let describe = fn(x) =>
          if typeOf(x) == number then "number"
          else "other"
        in describe(runtime(n: 0))
      `);

      // typeOf(x) uses x in comptime context, so specialization should occur
      // The if should be eliminated since typeOf can determine the branch
      expect(code).toContain('"number"');
      // The else branch should be eliminated
      expect(code).not.toContain('"other"');
    });

    it("specializes when comptime is used on parameter", () => {
      const code = parseAndCompile(`
        let makeAdder = fn(n) => fn(x) => comptime(n) + x
        in makeAdder(5)(runtime(y: 0))
      `);

      // comptime(n) requires n to be Now, so specialization occurs
      // The result should have 5 baked in to the inner function body
      // (uses inner param name 'x', not call site name 'y')
      expect(code).toContain("5 + x");
    });
  });

  describe("button click handlers should not be inlined", () => {
    it("generates call for click handler helper", () => {
      const code = parseAndCompile(`
        let inputDigit = fn(digit) =>
          if runtime(waiting: false) then digit
          else runtime(display: "") + digit
        in inputDigit("7")
      `);

      // Should generate call to inputDigit, not inline
      expect(code).toContain("inputDigit");
      expect(code).toContain('inputDigit("7")');
    });

    it("generates call for performOperation helper", () => {
      const code = parseAndCompile(`
        let performOp = fn(op) => [op, runtime(display: "")]
        in performOp("+")
      `);

      expect(code).toContain('performOp("+")');
    });
  });

  describe("full integration scenarios", () => {
    it("validator pattern: helpers called, not inlined", () => {
      const code = parseAndCompile(`
        let isEmpty = fn(s) => s.length == 0
        in let isValidEmail = fn(s) => s.includes("@")
        in let email = runtime(email: "")
        in if isEmpty(email) then "Required" else if isValidEmail(email) then "OK" else "Invalid"
      `);

      // Helpers should be defined and called
      expect(code).toContain("const isEmpty");
      expect(code).toContain("const isValidEmail");
      expect(code).toContain("isEmpty(email)");
      expect(code).toContain("isValidEmail(email)");

      // Bodies should not be duplicated in the conditional
      const lengthChecks = code.match(/\.length === 0/g) || [];
      expect(lengthChecks.length).toBe(1); // Only in isEmpty definition
    });

    it("dashboard pattern: one sumField, calls preserved", () => {
      const code = parseAndCompile(`
        let sumField = fn sumRec(arr, field, idx) =>
          if idx >= arr.length then 0
          else (
            let value = if field == "a" then arr[idx] * 2 else arr[idx]
            in value + sumRec(arr, field, idx + 1)
          )
        in let arr = runtime(arr: [])
        in let totalA = sumField(arr, "a", 0)
        in let totalB = sumField(arr, "b", 0)
        in [totalA, totalB]
      `);

      // ONE function definition
      const defs = code.match(/const sumField = function/g) || [];
      expect(defs.length).toBe(1);

      // Calls preserved
      expect(code).toContain('sumField(arr, "a", 0)');
      expect(code).toContain('sumField(arr, "b", 0)');

      // Runtime branching
      expect(code).toContain('field === "a"');
    });
  });
});