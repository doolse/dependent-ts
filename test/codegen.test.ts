/**
 * Tests for JavaScript code generation.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  // Expressions
  num,
  str,
  bool,
  nil,
  varRef,
  add,
  sub,
  mul,
  div,
  mod,
  eq,
  neq,
  ltExpr,
  gtExpr,
  lteExpr,
  gteExpr,
  andExpr,
  orExpr,
  neg,
  notExpr,
  ifExpr,
  letExpr,
  fn,
  call,
  obj,
  field,
  array,
  index,
  block,
  comptime,
  runtime,

  // Code generation
  generateJS,
  generateModule,
  generateFunction,
  compile,
  resetVarCounter,
} from "../src/index";

beforeEach(() => {
  resetVarCounter();
});

describe("Literal Generation Tests", () => {
  it("generates number literals", () => {
    expect(generateJS(num(42)).trim()).toBe("42");
    expect(generateJS(num(3.14)).trim()).toBe("3.14");
    expect(generateJS(num(-7)).trim()).toBe("-7");
    expect(generateJS(num(0)).trim()).toBe("0");
  });

  it("generates string literals", () => {
    expect(generateJS(str("hello")).trim()).toBe('"hello"');
    expect(generateJS(str("")).trim()).toBe('""');
    expect(generateJS(str('with "quotes"')).trim()).toBe('"with \\"quotes\\""');
  });

  it("generates boolean literals", () => {
    expect(generateJS(bool(true)).trim()).toBe("true");
    expect(generateJS(bool(false)).trim()).toBe("false");
  });

  it("generates null literal", () => {
    expect(generateJS(nil).trim()).toBe("null");
  });
});

describe("Operator Generation Tests", () => {
  it("generates arithmetic operators", () => {
    expect(generateJS(add(num(1), num(2))).trim()).toBe("1 + 2");
    expect(generateJS(sub(num(5), num(3))).trim()).toBe("5 - 3");
    expect(generateJS(mul(num(4), num(5))).trim()).toBe("4 * 5");
    expect(generateJS(div(num(10), num(2))).trim()).toBe("10 / 2");
    expect(generateJS(mod(num(7), num(3))).trim()).toBe("7 % 3");
  });

  it("generates comparison operators with ===", () => {
    expect(generateJS(eq(varRef("x"), num(5))).trim()).toBe("x === 5");
    expect(generateJS(neq(varRef("x"), num(5))).trim()).toBe("x !== 5");
  });

  it("generates relational operators", () => {
    expect(generateJS(ltExpr(varRef("x"), num(5))).trim()).toBe("x < 5");
    expect(generateJS(gtExpr(varRef("x"), num(5))).trim()).toBe("x > 5");
    expect(generateJS(lteExpr(varRef("x"), num(5))).trim()).toBe("x <= 5");
    expect(generateJS(gteExpr(varRef("x"), num(5))).trim()).toBe("x >= 5");
  });

  it("generates logical operators", () => {
    expect(generateJS(andExpr(varRef("a"), varRef("b"))).trim()).toBe("a && b");
    expect(generateJS(orExpr(varRef("a"), varRef("b"))).trim()).toBe("a || b");
  });

  it("generates unary operators", () => {
    expect(generateJS(neg(num(5))).trim()).toBe("-5");
    expect(generateJS(notExpr(varRef("x"))).trim()).toBe("!x");
  });

  it("adds parentheses for precedence", () => {
    const expr = mul(add(num(1), num(2)), num(3));
    expect(generateJS(expr).trim()).toBe("(1 + 2) * 3");
  });

  it("handles right-associativity", () => {
    const expr = sub(num(1), sub(num(2), num(3)));
    expect(generateJS(expr).trim()).toBe("1 - (2 - 3)");
  });
});

describe("Control Flow Generation Tests", () => {
  it("generates ternary for if expressions", () => {
    const expr = ifExpr(varRef("cond"), num(1), num(2));
    expect(generateJS(expr).trim()).toBe("cond ? 1 : 2");
  });

  it("generates nested ternaries", () => {
    const expr = ifExpr(
      varRef("a"),
      num(1),
      ifExpr(varRef("b"), num(2), num(3))
    );
    expect(generateJS(expr).trim()).toBe("a ? 1 : b ? 2 : 3");
  });
});

describe("Let Binding Generation Tests", () => {
  it("generates IIFE for let bindings", () => {
    const expr = letExpr("x", num(5), add(varRef("x"), num(1)));
    const code = generateJS(expr);
    expect(code).toContain("const x = 5");
    expect(code).toContain("return x + 1");
  });

  it("let binding evaluates correctly", () => {
    const expr = letExpr("x", num(5), add(varRef("x"), num(1)));
    const code = generateJS(expr);
    expect(eval(code)).toBe(6);
  });

  it("nested let bindings work", () => {
    const expr = letExpr(
      "x",
      num(5),
      letExpr("y", num(3), add(varRef("x"), varRef("y")))
    );
    const code = generateJS(expr);
    expect(eval(code)).toBe(8);
  });
});

describe("Function Generation Tests", () => {
  it("generates arrow functions", () => {
    const expr = fn(["x"], add(varRef("x"), num(1)));
    expect(generateJS(expr).trim()).toBe("(x) => x + 1");
  });

  it("generates multi-param arrow functions", () => {
    const expr = fn(["x", "y"], add(varRef("x"), varRef("y")));
    expect(generateJS(expr).trim()).toBe("(x, y) => x + y");
  });

  it("generates function calls", () => {
    const expr = call(varRef("f"), num(1), num(2));
    expect(generateJS(expr).trim()).toBe("f(1, 2)");
  });

  it("wraps IIFE calls correctly", () => {
    const expr = call(fn(["x"], varRef("x")), num(42));
    const code = generateJS(expr);
    expect(code).toContain("((x) => x)(42)");
    expect(eval(code)).toBe(42);
  });

  it("generateFunction creates named function", () => {
    const expr = fn(["x", "y"], add(varRef("x"), varRef("y")));
    const code = generateFunction("add", expr);
    expect(code).toContain("function add(x, y)");
    expect(code).toContain("return x + y");
  });
});

describe("Object Generation Tests", () => {
  it("generates empty object", () => {
    const expr = obj({});
    expect(generateJS(expr).trim()).toBe("{}");
  });

  it("generates object literal", () => {
    const expr = obj({ x: num(1), y: num(2) });
    expect(generateJS(expr).trim()).toBe("{ x: 1, y: 2 }");
  });

  it("generates field access with dot notation", () => {
    const expr = field(varRef("obj"), "x");
    expect(generateJS(expr).trim()).toBe("obj.x");
  });

  it("generates chained field access", () => {
    const expr = field(field(varRef("a"), "b"), "c");
    expect(generateJS(expr).trim()).toBe("a.b.c");
  });

  it("object literal evaluates correctly", () => {
    const expr = obj({ x: num(1), y: num(2) });
    const code = generateJS(expr);
    expect(eval(`(${code})`)).toEqual({ x: 1, y: 2 });
  });
});

describe("Array Generation Tests", () => {
  it("generates empty array", () => {
    const expr = array();
    expect(generateJS(expr).trim()).toBe("[]");
  });

  it("generates array literal", () => {
    const expr = array(num(1), num(2), num(3));
    expect(generateJS(expr).trim()).toBe("[1, 2, 3]");
  });

  it("generates array index", () => {
    const expr = index(varRef("arr"), num(0));
    expect(generateJS(expr).trim()).toBe("arr[0]");
  });

  it("generates dynamic array index", () => {
    const expr = index(varRef("arr"), varRef("i"));
    expect(generateJS(expr).trim()).toBe("arr[i]");
  });

  it("array literal evaluates correctly", () => {
    const expr = array(num(1), num(2), num(3));
    const code = generateJS(expr);
    expect(eval(code)).toEqual([1, 2, 3]);
  });
});

describe("Block Generation Tests", () => {
  it("generates single expression block", () => {
    const expr = block(num(42));
    expect(generateJS(expr).trim()).toBe("42");
  });

  it("generates multi-expression block as IIFE", () => {
    const expr = block(num(1), num(2), num(3));
    const code = generateJS(expr);
    expect(code).toContain("return 3");
    expect(eval(code)).toBe(3);
  });
});

describe("Compilation Pipeline Tests", () => {
  it("compile fully evaluates constant expressions", () => {
    const code = compile(add(num(2), num(3)));
    expect(code.trim()).toBe("5");
  });

  it("compile generates residual for runtime values", () => {
    const expr = add(runtime(num(5), "x"), num(3));
    const code = compile(expr);
    expect(code).toContain("x + 3");
  });

  it("compile does constant folding in let", () => {
    const expr = letExpr(
      "a",
      num(2),
      letExpr("b", num(3), mul(varRef("a"), varRef("b")))
    );
    const code = compile(expr);
    expect(code.trim()).toBe("6");
  });

  it("compile partially evaluates with runtime input", () => {
    const expr = letExpr(
      "multiplier",
      num(2),
      letExpr(
        "x",
        runtime(num(5), "input"),
        mul(varRef("multiplier"), varRef("x"))
      )
    );
    const code = compile(expr);
    expect(code).toContain("2 * input");
  });

  it("compile eliminates dead branches", () => {
    const expr = ifExpr(bool(true), num(42), varRef("unused"));
    const code = compile(expr);
    expect(code.trim()).toBe("42");
  });

  it("compiled code is executable", () => {
    const expr = call(
      fn(["x"], add(mul(varRef("x"), num(2)), num(1))),
      num(5)
    );
    const code = compile(expr);
    expect(eval(code)).toBe(11);
  });
});

describe("Edge Cases", () => {
  it("handles reserved word identifiers", () => {
    const expr = varRef("class");
    expect(generateJS(expr).trim()).toBe("_class");
  });

  it("handles special property names", () => {
    const expr = obj({ "weird-name": num(1) });
    expect(generateJS(expr)).toContain('"weird-name"');
  });

  it("generateModule creates export", () => {
    const code = generateModule(num(42));
    expect(code.trim()).toBe("export default 42;");
  });

  it("wrapInIIFE option works", () => {
    const code = generateJS(num(42), { wrapInIIFE: true });
    expect(code).toContain("(() =>");
    expect(code).toContain("return 42");
    expect(eval(code)).toBe(42);
  });
});

describe("Integration Tests", () => {
  it("compiles discriminated union handling", () => {
    const expr = letExpr(
      "shape",
      obj({ kind: str("circle"), radius: num(5) }),
      ifExpr(
        eq(field(varRef("shape"), "kind"), str("circle")),
        field(varRef("shape"), "radius"),
        num(0)
      )
    );
    const code = compile(expr);
    expect(code.trim()).toBe("5");
  });

  it("compiles higher-order function", () => {
    const expr = letExpr(
      "f",
      fn(["x"], fn(["y"], add(varRef("x"), varRef("y")))),
      call(call(varRef("f"), num(3)), num(4))
    );
    const code = compile(expr);
    expect(code.trim()).toBe("7");
  });

  it("compiles array map-like operation", () => {
    const expr = letExpr(
      "arr",
      array(num(1), num(2), num(3)),
      index(varRef("arr"), num(1))
    );
    const code = compile(expr);
    expect(code.trim()).toBe("2");
  });
});
