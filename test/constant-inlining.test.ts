/**
 * Tests to ensure compound values are not duplicated in generated code.
 *
 * The rules:
 * - Primitives CAN be inlined (they're small)
 * - Compound values (objects, arrays, closures) should be bound once and referenced
 *   to avoid duplicating large literals in generated code
 * - Compile-time computable values SHOULD be computed (optimal partial evaluation)
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  num,
  str,
  varRef,
  add,
  mul,
  letExpr,
  fn,
  call,
  obj,
  field,
  array,
  index,
  runtime,
  compile,
  stage,
  isNow,
  resetVarCounter,
} from "../src/index";

beforeEach(() => {
  resetVarCounter();
});

describe("Closure duplication bug fix", () => {
  it("closure called multiple times should not duplicate body", () => {
    const expr = letExpr(
      "double",
      fn(["x"], add(varRef("x"), varRef("x"))),
      letExpr(
        "a",
        runtime(num(0), "a"),
        add(call(varRef("double"), varRef("a")), call(varRef("double"), varRef("a")))
      )
    );
    const code = compile(expr);
    // Should call double(a) twice, not inline the body as IIFEs
    expect(code).toContain("double(a) + double(a)");
  });

  it("closure with complex body should not be duplicated", () => {
    const expr = letExpr(
      "transform",
      fn(["x"], mul(add(varRef("x"), num(1)), num(2))),
      letExpr(
        "input",
        runtime(num(0), "input"),
        add(
          call(varRef("transform"), varRef("input")),
          call(varRef("transform"), add(varRef("input"), num(1)))
        )
      )
    );
    const code = compile(expr);
    // Should have function calls, not inlined bodies
    expect(code).toContain("transform(input)");
    expect(code).toContain("transform(input + 1)");
  });
});

describe("Object and array regression tests", () => {
  it("object passed to Later function multiple times is not duplicated", () => {
    const expr = letExpr(
      "config",
      obj({ x: num(1), y: num(2), z: num(3), w: num(4) }),
      letExpr(
        "f",
        runtime(fn(["o"], field(varRef("o"), "x")), "runtimeFunc"),
        add(call(varRef("f"), varRef("config")), call(varRef("f"), varRef("config")))
      )
    );
    const code = compile(expr);
    // Object should be bound once
    expect(code).toContain("const config");
    // And referenced twice, not duplicated
    expect(code).toContain("runtimeFunc(config) + runtimeFunc(config)");
  });

  it("array with runtime index multiple times is not duplicated", () => {
    const expr = letExpr(
      "arr",
      array(num(10), num(20), num(30)),
      letExpr(
        "i",
        runtime(num(0), "i"),
        add(index(varRef("arr"), varRef("i")), index(varRef("arr"), varRef("i")))
      )
    );
    const code = compile(expr);
    // Array should be bound once
    expect(code).toContain("const arr");
    // And referenced twice
    expect(code).toContain("arr[i] + arr[i]");
  });
});

describe("Optimal inlining still works", () => {
  it("field access with known index is computed at compile time", () => {
    const expr = letExpr(
      "config",
      obj({ x: num(1), y: num(2) }),
      letExpr(
        "input",
        runtime(num(0), "input"),
        add(field(varRef("config"), "x"), varRef("input"))
      )
    );
    const code = compile(expr);
    // config.x = 1 should be computed at compile time
    // Result should be "1 + input", not "config.x + input"
    expect(code).toContain("1 + input");
  });

  it("function with all Now args is fully evaluated", () => {
    const expr = letExpr(
      "double",
      fn(["x"], mul(varRef("x"), num(2))),
      call(varRef("double"), num(5))
    );
    const result = stage(expr);
    // Should be fully evaluated at compile time
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue) && result.svalue.value.tag === "number") {
      expect(result.svalue.value.value).toBe(10);
    }
  });

  it("primitive constants can be inlined", () => {
    const expr = letExpr(
      "multiplier",
      num(3),
      letExpr(
        "input",
        runtime(num(0), "input"),
        mul(varRef("multiplier"), varRef("input"))
      )
    );
    const code = compile(expr);
    // The primitive 3 should be inlined, no let binding needed
    expect(code).toContain("3 * input");
    expect(code).not.toContain("const multiplier");
  });

  it("string constants can be inlined", () => {
    const expr = letExpr(
      "prefix",
      str("hello_"),
      letExpr(
        "input",
        runtime(str(""), "input"),
        add(varRef("prefix"), varRef("input"))
      )
    );
    const code = compile(expr);
    // The string should be inlined
    expect(code).toContain('"hello_" + input');
    expect(code).not.toContain("const prefix");
  });
});

describe("Edge cases", () => {
  it("unused compound values should not be emitted", () => {
    const expr = letExpr(
      "unused",
      obj({ x: num(1), y: num(2) }),
      letExpr(
        "input",
        runtime(num(0), "input"),
        add(varRef("input"), num(1))
      )
    );
    const code = compile(expr);
    // The unused object should not be in the output
    expect(code).not.toContain("const unused");
    expect(code).toContain("input + 1");
  });

  it("compound value only used at compile time should not be emitted", () => {
    const expr = letExpr(
      "config",
      obj({ x: num(5), y: num(10) }),
      add(field(varRef("config"), "x"), field(varRef("config"), "y"))
    );
    const result = stage(expr);
    // Should be fully evaluated to 15 at compile time
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue) && result.svalue.value.tag === "number") {
      expect(result.svalue.value.value).toBe(15);
    }
  });
});
