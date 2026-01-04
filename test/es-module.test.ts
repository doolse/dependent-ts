/**
 * Tests for the esModule builtin code generator.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  parse,
  runValue,
  resetVarCounter,
  StringValue,
} from "@dependent-ts/core";

beforeEach(() => {
  resetVarCounter();
});

describe("esModule builtin", () => {
  describe("basic generation", () => {
    it("exports simple Now value", () => {
      const result = runValue(parse("esModule(42)"));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toBe("export default 42;\n");
    });

    it("exports computed Now value", () => {
      const result = runValue(parse("esModule(10 + 20)"));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toBe("export default 30;\n");
    });

    it("exports object literal", () => {
      const result = runValue(parse("esModule({ x: 1, y: 2 })"));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toBe("export default { x: 1, y: 2 };\n");
    });

    it("exports computed object", () => {
      const result = runValue(parse(`
        esModule(
          let x = 10 in
          let y = 20 in
          { sum: x + y, product: x * y }
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toBe("export default { sum: 30, product: 200 };\n");
    });
  });

  describe("runtime parameters", () => {
    it("wraps in function when runtime params present", () => {
      const result = runValue(parse(`
        esModule(
          let userId = runtime(userId: "") in
          "/api/user/" + userId
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain("export default (userId) =>");
      expect(source).toContain('"/api/user/" + userId');
    });

    it("handles multiple runtime params", () => {
      const result = runValue(parse(`
        esModule(
          let a = runtime(a: "") in
          let b = runtime(b: "") in
          a + b
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      // Should have both parameters
      expect(source).toMatch(/export default \((a, b|b, a)\) =>/);
      expect(source).toContain("a + b");
    });
  });

  describe("imports", () => {
    it("collects single import", () => {
      const result = runValue(parse(`
        esModule(
          import { jsx } from "react/jsx-runtime" in
          jsx
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain('import { jsx } from "react/jsx-runtime"');
      expect(source).toContain("export default jsx");
    });

    it("groups multiple imports from same module", () => {
      const result = runValue(parse(`
        esModule(
          import { jsx } from "react/jsx-runtime" in
          import { jsxs } from "react/jsx-runtime" in
          [jsx, jsxs]
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      // Should have one import statement with both names
      expect(source).toMatch(/import \{.*jsx.*jsxs.*\} from "react\/jsx-runtime"/);
      expect(source).toContain("export default");
    });
  });

  describe("functions", () => {
    it("exports arrow function", () => {
      const result = runValue(parse(`
        esModule(fn(x) => x + 1)
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain("export default");
      expect(source).toContain("=>");
    });

    it("exports function with runtime capture", () => {
      const result = runValue(parse(`
        esModule(
          let multiplier = runtime(multiplier: 1) in
          fn(x) => x * multiplier
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain("(multiplier) =>");
      expect(source).toContain("x * multiplier");
    });
  });

  describe("method optimizations", () => {
    it("converts map to method call", () => {
      const result = runValue(parse(`
        esModule(
          let arr = runtime(arr: []) in
          map(arr, fn(x) => x * 2)
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain(".map(");
    });

    it("converts filter to method call", () => {
      const result = runValue(parse(`
        esModule(
          let arr = runtime(arr: []) in
          filter(arr, fn(x) => x > 0)
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain(".filter(");
    });

    it("converts print to console.log", () => {
      const result = runValue(parse(`
        esModule(
          let msg = runtime(msg: "") in
          print(msg)
        )
      `));
      expect(result.tag).toBe("string");
      const source = (result as StringValue).value;
      expect(source).toContain("console.log(");
    });
  });
});
