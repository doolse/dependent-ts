/**
 * Pattern Matching Tests
 *
 * Tests for specialization of discriminated union handling and
 * pattern matching based on compile-time known tags.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Pattern Matching Specialization", () => {
  describe("Discriminated union handlers", () => {
    it("specializes shape area calculation based on known kind", () => {
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

      // Different kinds = different specializations
      expect(code).toContain("area$0");
      expect(code).toContain("area$1");
    });

    it("uses base name for single shape kind", () => {
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

      // Single call site = base name
      expect(code).toContain("area");
      expect(code).not.toContain("area$");
    });
  });

  describe("Result/Either type handling", () => {
    it("specializes result type handling based on tag", () => {
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

      expect(code).toContain("handleResult$0");
      expect(code).toContain("handleResult$1");
    });

    it("specializes map on result type", () => {
      const code = compile(parse(`
        let mapResult = fn(result, f) =>
          if result.tag == "ok" then
            { tag: "ok", value: f(result.value) }
          else
            result
        in
        let ok = { tag: "ok", value: trust(runtime(v: 21), number) } in
        let err = { tag: "error", error: "fail" } in
        let double = fn(x) => x * 2 in
        [mapResult(ok, double), mapResult(err, double)]
      `));

      expect(code).toContain("mapResult$0");
      expect(code).toContain("mapResult$1");
    });
  });

  describe("Option/Maybe type handling", () => {
    it("specializes option type unwrapping", () => {
      const code = compile(parse(`
        let unwrap = fn(opt, default) =>
          if opt.tag == "some" then opt.value
          else default
        in
        let some = { tag: "some", value: trust(runtime(v: 42), number) } in
        let none = { tag: "none" } in
        [unwrap(some, 0), unwrap(none, 0)]
      `));

      expect(code).toContain("unwrap$0");
      expect(code).toContain("unwrap$1");
    });
  });

  describe("Message/Protocol handling", () => {
    it("specializes message handler based on message type", () => {
      const code = compile(parse(`
        let handleMessage = fn(msg) =>
          if msg.type == "request" then
            { response: "ack", id: msg.id }
          else if msg.type == "response" then
            { handled: true, data: msg.data }
          else
            { handled: false, error: "unknown" }
        in
        let req = { type: "request", id: trust(runtime(id: 123), number) } in
        let res = { type: "response", data: trust(runtime(d: "ok"), string) } in
        [handleMessage(req), handleMessage(res)]
      `));

      expect(code).toContain("handleMessage$0");
      expect(code).toContain("handleMessage$1");
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
