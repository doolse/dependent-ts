/**
 * Dead Code Elimination Tests
 *
 * Tests for compile-time dead code elimination based on
 * comptime-known conditions and unused specializations.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Dead Code Elimination", () => {
  describe("Feature flag elimination", () => {
    it("eliminates disabled feature code", () => {
      const code = compile(parse(`
        let config = { enableLogging: false, enableMetrics: true } in
        let process = fn(x) =>
          let _ = if comptime(config.enableLogging) then print("log") else null in
          let _ = if comptime(config.enableMetrics) then print("metric") else null in
          x * 2
        in
        let val = trust(runtime(v: 21), number) in
        process(val)
      `));

      // Logging is disabled - should not appear
      expect(code).not.toContain('"log"');
      // Metrics is enabled - should appear
      expect(code).toContain('"metric"');
    });

    it("eliminates entire branches for false conditions", () => {
      const code = compile(parse(`
        let DEBUG = false in
        let result = fn(x) =>
          if comptime(DEBUG) then
            let _ = print("debug: " + x.toString()) in
            let _ = validateDebug(x) in
            x
          else
            x
        in
        let val = trust(runtime(v: 42), number) in
        result(val)
      `));

      // Debug branch should be completely eliminated
      expect(code).not.toContain("debug:");
      expect(code).not.toContain("validateDebug");
      // Should just have the value pass-through
      expect(code).toContain("v");
    });

    it("preserves enabled feature code only", () => {
      const code = compile(parse(`
        let features = {
          caching: true,
          compression: false,
          encryption: true
        } in
        let processData = fn(data) =>
          let _ = if comptime(features.caching) then cache(data) else null in
          let _ = if comptime(features.compression) then compress(data) else null in
          let _ = if comptime(features.encryption) then encrypt(data) else null in
          data
        in
        let d = trust(runtime(d: "secret"), string) in
        processData(d)
      `));

      // Caching and encryption enabled
      expect(code).toContain("cache");
      expect(code).toContain("encrypt");
      // Compression disabled
      expect(code).not.toContain("compress");
    });
  });

  describe("Environment-based elimination", () => {
    it("eliminates development-only code in production", () => {
      const code = compile(parse(`
        let ENV = "production" in
        let log = fn(msg) =>
          if comptime(ENV) == "development" then
            print(msg)
          else
            null
        in
        let process = fn(x) =>
          let _ = log("processing") in
          x + 1
        in
        let val = trust(runtime(v: 41), number) in
        process(val)
      `));

      // Production mode - no logging
      expect(code).not.toContain("processing");
    });

    it("includes development code in dev mode", () => {
      const code = compile(parse(`
        let ENV = "development" in
        let log = fn(msg) =>
          if comptime(ENV) == "development" then
            print(msg)
          else
            null
        in
        let process = fn(x) =>
          let _ = log("processing") in
          x + 1
        in
        let val = trust(runtime(v: 41), number) in
        process(val)
      `));

      // Development mode - includes logging
      expect(code).toContain("processing");
    });
  });

  describe("Unused function elimination", () => {
    it("eliminates uncalled specialized functions", () => {
      const code = compile(parse(`
        let format = fn(x) =>
          let T = typeOf(x) in
          if T == number then x.toFixed(2)
          else if T == string then x.toUpperCase()
          else x.toString()
        in
        let n = trust(runtime(n: 3.14), number) in
        format(n)
      `));

      // Only number specialization should be present
      expect(code).toContain("toFixed(2)");
      // String and default paths should not be generated
      expect(code).not.toContain("toUpperCase");
    });

    it("eliminates functions that only return compile-time values", () => {
      const code = compile(parse(`
        let getConfig = fn(key) =>
          let k = comptime(key) in
          if k == "maxSize" then 1000
          else if k == "timeout" then 5000
          else 0
        in
        let maxSize = getConfig("maxSize") in
        let val = trust(runtime(v: 500), number) in
        if val < maxSize then "ok" else "too big"
      `));

      // getConfig returns compile-time known value
      // The comparison should use literal 1000
      expect(code).toContain("1000");
      // No function definition needed
      expect(code).not.toContain("getConfig");
    });
  });

  describe("Conditional branch elimination", () => {
    it("eliminates impossible branches based on type", () => {
      const code = compile(parse(`
        let process = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else if T == string then x + "!"
          else if T == boolean then if x then 1 else 0
          else null
        in
        let n = trust(runtime(n: 21), number) in
        process(n)
      `));

      // Only number branch
      expect(code).toMatch(/\* 2/);
      // No string or boolean branches
      expect(code).not.toContain('+ "!"');
    });

    it("eliminates unreachable else branches", () => {
      const code = compile(parse(`
        let alwaysTrue = true in
        let result = fn(x) =>
          if comptime(alwaysTrue) then x * 2
          else x * 3
        in
        let val = trust(runtime(v: 10), number) in
        result(val)
      `));

      // Only true branch
      expect(code).toMatch(/\* 2/);
      // Else branch eliminated
      expect(code).not.toMatch(/\* 3/);
    });
  });

  describe("Constant folding and elimination", () => {
    it("folds and eliminates constant expressions", () => {
      const code = compile(parse(`
        let MULTIPLIER = 2 * 3 * 4 in
        let scale = fn(x) =>
          x * comptime(MULTIPLIER)
        in
        let val = trust(runtime(v: 5), number) in
        scale(val)
      `));

      // Should have folded 2 * 3 * 4 = 24
      expect(code).toContain("24");
      expect(code).not.toContain("2 * 3");
    });

    it("eliminates unnecessary intermediate bindings", () => {
      const code = compile(parse(`
        let a = 1 in
        let b = 2 in
        let c = comptime(a + b) in
        let result = fn(x) => x + c in
        let val = trust(runtime(v: 10), number) in
        result(val)
      `));

      // c should be folded to 3
      expect(code).toContain("3");
      // No intermediate variable definitions for a, b, c
    });
  });

  describe("Type-based elimination", () => {
    it("eliminates type checks that are always true", () => {
      const code = compile(parse(`
        let mustBeNumber = fn(x) =>
          let T = typeOf(x) in
          if T == number then x
          else 0
        in
        let n = trust(runtime(n: 42), number) in
        mustBeNumber(n)
      `));

      // With number input, the else branch is dead
      // Should just return x
      expect(code).not.toContain("=== 0");
    });

    it("eliminates runtime type checks for known types", () => {
      const code = compile(parse(`
        let validate = fn(x) =>
          let T = typeOf(x) in
          if T == number then
            if x >= 0 then { valid: true } else { valid: false }
          else
            { valid: false }
        in
        let n = trust(runtime(n: 5), number) in
        validate(n)
      `));

      // Only number validation path
      expect(code).toContain(">= 0");
      // No fallback path
    });
  });

  describe("Loop optimization", () => {
    it("eliminates empty loop bodies", () => {
      const code = compile(parse(`
        let DEBUG = false in
        let process = fn(arr) =>
          fold(arr, 0, fn(acc, x) =>
            let _ = if comptime(DEBUG) then print(x) else null in
            acc + x
          )
        in
        let nums = trust(runtime(nums: [1, 2, 3]), arrayOf(number)) in
        process(nums)
      `));

      // Debug print eliminated
      expect(code).not.toContain("print");
      // Sum logic preserved
      expect(code).toContain("acc + x");
    });
  });

  describe("Assert/check elimination", () => {
    it("eliminates asserts in production mode", () => {
      const code = compile(parse(`
        let PRODUCTION = true in
        let safeDiv = fn(a, b) =>
          let _ = if comptime(PRODUCTION) then null
                  else assert(b != 0, "Division by zero") in
          a / b
        in
        let x = trust(runtime(x: 10), number) in
        let y = trust(runtime(y: 2), number) in
        safeDiv(x, y)
      `));

      // Production mode - no assert
      expect(code).not.toContain("Division by zero");
      expect(code).toContain("/");
    });

    it("preserves asserts in development mode", () => {
      const code = compile(parse(`
        let PRODUCTION = false in
        let safeDiv = fn(a, b) =>
          let _ = if comptime(PRODUCTION) then null
                  else if b == 0 then error("Division by zero") else null in
          a / b
        in
        let x = trust(runtime(x: 10), number) in
        let y = trust(runtime(y: 2), number) in
        safeDiv(x, y)
      `));

      // Development mode - includes check
      expect(code).toContain("Division by zero");
    });
  });

  describe("Runtime correctness", () => {
    it("disabled feature returns correct result", () => {
      const result = parseAndRun(`
        let DEBUG = false in
        let process = fn(x) =>
          let _ = if DEBUG then print("debug") else null in
          x * 2
        in
        process(21)
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(42);
    });

    it("constant folding produces correct result", () => {
      const result = parseAndRun(`
        let FACTOR = 2 * 3 * 7 in
        42 / FACTOR
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(1);
    });

    it("type-based elimination still works correctly", () => {
      const result = parseAndRun(`
        let process = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else 0
        in
        process(21)
      `);

      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(42);
    });
  });

  describe("Complex elimination scenarios", () => {
    it("eliminates nested conditional dead code", () => {
      const code = compile(parse(`
        let config = {
          level: 1,
          verbose: false
        } in
        let process = fn(x) =>
          if comptime(config.level) >= 2 then
            if comptime(config.verbose) then
              print("verbose level 2+")
            else
              print("level 2+")
          else
            x
        in
        let val = trust(runtime(v: 42), number) in
        process(val)
      `));

      // level is 1, so the entire >= 2 branch is dead
      expect(code).not.toContain("level 2");
      expect(code).not.toContain("verbose");
    });

    it("eliminates code paths based on combined conditions", () => {
      const code = compile(parse(`
        let featureA = true in
        let featureB = false in
        let process = fn(x) =>
          if comptime(featureA && featureB) then
            x + 100
          else if comptime(featureA || featureB) then
            x + 10
          else
            x + 1
        in
        let val = trust(runtime(v: 0), number) in
        process(val)
      `));

      // A && B = false, A || B = true
      // Should only have + 10
      expect(code).toContain("+ 10");
      expect(code).not.toContain("+ 100");
      expect(code).not.toContain("+ 1");
    });
  });
});
