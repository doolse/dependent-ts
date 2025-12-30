/**
 * Pattern Matching Tests
 *
 * Tests for specialization of discriminated union handling.
 * NOTE: Specialization requires explicit comptime() - automatic specialization
 * based on discriminant values is NOT supported.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Pattern Matching Specialization", () => {
  describe("Without comptime - no specialization", () => {
    it("generates single function without specialization when comptime not used", () => {
      const code = compile(parse(`
        let area = fn(shape) =>
          if shape.kind == "circle" then
            3.14159 * shape.radius * shape.radius
          else if shape.kind == "rectangle" then
            shape.width * shape.height
          else
            0
        in
        let circle = { kind: "circle", radius: trust(runtime(r: 5), number) } in
        let rect = { kind: "rectangle",
                    width: trust(runtime(w: 4), number),
                    height: trust(runtime(h: 3), number) } in
        [area(circle), area(rect)]
      `));

      // No specialization - single function
      expect(code).toContain("area");
      expect(code).not.toContain("area$");
      // Should still have the runtime condition check
      expect(code).toContain('kind');
    });

    it("uses base name for single call site without specialization", () => {
      const code = compile(parse(`
        let area = fn(shape) =>
          if shape.kind == "circle" then
            3.14159 * shape.radius * shape.radius
          else
            0
        in
        let circle = { kind: "circle", radius: trust(runtime(r: 5), number) } in
        area(circle)
      `));

      // Single call site = base name, no specialization
      expect(code).toContain("area");
      expect(code).not.toContain("area$");
    });

    it("preserves runtime discriminant checks without comptime", () => {
      const code = compile(parse(`
        let handleResult = fn(result) =>
          if result.tag == "ok" then
            { success: true, value: result.value }
          else
            { success: false, error: result.error }
        in
        let okResult = { tag: "ok",
                        value: trust(runtime(v: 42), number) } in
        let errResult = { tag: "error",
                         error: trust(runtime(e: "failed"), string) } in
        [handleResult(okResult), handleResult(errResult)]
      `));

      // No specialization
      expect(code).not.toContain("handleResult$");
      // Condition should be preserved
      expect(code).toContain('tag');
    });
  });

  describe("With comptime - specialization works", () => {
    it("specializes shape area calculation with explicit comptime on discriminant", () => {
      const code = compile(parse(`
        let area = fn(shape) =>
          if comptime(shape.kind) == "circle" then
            3.14159 * shape.radius * shape.radius
          else if comptime(shape.kind) == "rectangle" then
            shape.width * shape.height
          else
            0
        in
        let circle = { kind: "circle", radius: trust(runtime(r: 5), number) } in
        let rect = { kind: "rectangle",
                    width: trust(runtime(w: 4), number),
                    height: trust(runtime(h: 3), number) } in
        [area(circle), area(rect)]
      `));

      // Different kinds = different specializations
      expect(code).toContain("area$0");
      expect(code).toContain("area$1");
      // Branches should be eliminated
      expect(code).not.toContain("===");
    });

    it("uses base name with comptime for single call site", () => {
      const code = compile(parse(`
        let area = fn(shape) =>
          if comptime(shape.kind) == "circle" then
            3.14159 * shape.radius * shape.radius
          else
            0
        in
        let circle = { kind: "circle", radius: trust(runtime(r: 5), number) } in
        area(circle)
      `));

      // Single call site = base name
      expect(code).toContain("area");
      expect(code).not.toContain("area$");
      // Branch should be eliminated
      expect(code).not.toContain("===");
    });

    it("specializes result type handling with explicit comptime", () => {
      const code = compile(parse(`
        let handleResult = fn(result) =>
          if comptime(result.tag) == "ok" then
            { success: true, value: result.value }
          else
            { success: false, error: result.error }
        in
        let okResult = { tag: "ok",
                        value: trust(runtime(v: 42), number) } in
        let errResult = { tag: "error",
                         error: trust(runtime(e: "failed"), string) } in
        [handleResult(okResult), handleResult(errResult)]
      `));

      expect(code).toContain("handleResult$0");
      expect(code).toContain("handleResult$1");
    });
  });

  describe("Runtime correctness", () => {
    it("correctly calculates circle area", () => {
      const result = parseAndRun(`
        let area = fn(shape) =>
          if shape.kind == "circle" then
            3.14159 * shape.radius * shape.radius
          else
            0
        in
        area({ kind: "circle", radius: 10 })
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBeCloseTo(314.159, 2);
    });

    it("correctly calculates rectangle area", () => {
      const result = parseAndRun(`
        let area = fn(shape) =>
          if shape.kind == "rectangle" then
            shape.width * shape.height
          else
            0
        in
        area({ kind: "rectangle", width: 4, height: 5 })
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(20);
    });

    it("correctly handles result type ok case", () => {
      const result = parseAndRun(`
        let handleResult = fn(r) =>
          if r.tag == "ok" then r.value * 2
          else 0
        in
        handleResult({ tag: "ok", value: 21 })
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(42);
    });

    it("correctly handles result type error case", () => {
      const result = parseAndRun(`
        let handleResult = fn(r) =>
          if r.tag == "ok" then r.value
          else -1
        in
        handleResult({ tag: "error", message: "fail" })
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(-1);
    });
  });
});
