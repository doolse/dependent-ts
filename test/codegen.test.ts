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
  compile,
  resetVarCounter,
} from "@dependent-ts/core";

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
  it("evaluates constant arithmetic at compile time", () => {
    expect(generateJS(add(num(1), num(2))).trim()).toBe("3");
    expect(generateJS(sub(num(5), num(3))).trim()).toBe("2");
    expect(generateJS(mul(num(4), num(5))).trim()).toBe("20");
    expect(generateJS(div(num(10), num(2))).trim()).toBe("5");
    expect(generateJS(mod(num(7), num(3))).trim()).toBe("1");
  });

  it("generates arithmetic operators with runtime values", () => {
    expect(generateJS(add(runtime(num(1), "a"), runtime(num(2), "b"))).trim()).toBe("a + b");
    expect(generateJS(sub(runtime(num(5), "a"), num(3))).trim()).toBe("a - 3");
  });

  it("generates comparison operators with ===", () => {
    expect(generateJS(eq(runtime(num(0), "x"), num(5))).trim()).toBe("x === 5");
    expect(generateJS(neq(runtime(num(0), "x"), num(5))).trim()).toBe("x !== 5");
  });

  it("generates relational operators", () => {
    expect(generateJS(ltExpr(runtime(num(0), "x"), num(5))).trim()).toBe("x < 5");
    expect(generateJS(gtExpr(runtime(num(0), "x"), num(5))).trim()).toBe("x > 5");
    expect(generateJS(lteExpr(runtime(num(0), "x"), num(5))).trim()).toBe("x <= 5");
    expect(generateJS(gteExpr(runtime(num(0), "x"), num(5))).trim()).toBe("x >= 5");
  });

  it("generates logical operators", () => {
    expect(generateJS(andExpr(runtime(bool(true), "a"), runtime(bool(true), "b"))).trim()).toBe("a && b");
    expect(generateJS(orExpr(runtime(bool(true), "a"), runtime(bool(true), "b"))).trim()).toBe("a || b");
  });

  it("generates unary operators", () => {
    expect(generateJS(neg(runtime(num(5), "x"))).trim()).toBe("-x");
    expect(generateJS(notExpr(runtime(bool(true), "x"))).trim()).toBe("!x");
  });

  it("evaluates constant expressions with precedence at compile time", () => {
    const expr = mul(add(num(1), num(2)), num(3));
    expect(generateJS(expr).trim()).toBe("9");
  });

  it("adds parentheses for precedence with runtime values", () => {
    const expr = mul(add(runtime(num(1), "a"), runtime(num(2), "b")), runtime(num(3), "c"));
    expect(generateJS(expr).trim()).toBe("(a + b) * c");
  });

  it("handles right-associativity with runtime values", () => {
    const expr = sub(runtime(num(1), "a"), sub(runtime(num(2), "b"), runtime(num(3), "c")));
    expect(generateJS(expr).trim()).toBe("a - (b - c)");
  });
});

describe("Control Flow Generation Tests", () => {
  it("generates ternary for if expressions with runtime condition", () => {
    const expr = ifExpr(runtime(bool(true), "cond"), num(1), num(2));
    expect(generateJS(expr).trim()).toBe("cond ? 1 : 2");
  });

  it("evaluates if with constant condition at compile time", () => {
    expect(generateJS(ifExpr(bool(true), num(1), num(2))).trim()).toBe("1");
    expect(generateJS(ifExpr(bool(false), num(1), num(2))).trim()).toBe("2");
  });

  it("generates nested ternaries with runtime conditions", () => {
    const expr = ifExpr(
      runtime(bool(true), "a"),
      num(1),
      ifExpr(runtime(bool(true), "b"), num(2), num(3))
    );
    expect(generateJS(expr).trim()).toBe("a ? 1 : b ? 2 : 3");
  });
});

describe("Let Binding Generation Tests", () => {
  it("evaluates constant let bindings at compile time", () => {
    const expr = letExpr("x", num(5), add(varRef("x"), num(1)));
    expect(generateJS(expr).trim()).toBe("6");
  });

  it("generates IIFE for let bindings with runtime values", () => {
    const expr = letExpr("x", runtime(num(5), "input"), add(varRef("x"), num(1)));
    const code = generateJS(expr);
    expect(code).toContain("const x = input");
    // Staging inlines the variable, so we get input + 1 instead of x + 1
    expect(code).toContain("input + 1");
  });

  it("let binding with runtime value evaluates correctly", () => {
    const expr = letExpr("x", runtime(num(5), "input"), add(varRef("x"), num(1)));
    const code = generateJS(expr);
    const input = 5;
    expect(eval(code)).toBe(6);
  });

  it("nested let bindings with all constants evaluate at compile time", () => {
    const expr = letExpr(
      "x",
      num(5),
      letExpr("y", num(3), add(varRef("x"), varRef("y")))
    );
    expect(generateJS(expr).trim()).toBe("8");
  });

  it("nested let bindings with runtime values work", () => {
    const expr = letExpr(
      "x",
      runtime(num(5), "a"),
      letExpr("y", runtime(num(3), "b"), add(varRef("x"), varRef("y")))
    );
    const code = generateJS(expr);
    const a = 5, b = 3;
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

  it("generates function calls with runtime function", () => {
    const expr = call(runtime(fn(["x"], varRef("x")), "f"), num(1), num(2));
    expect(generateJS(expr).trim()).toBe("f(1, 2)");
  });

  it("evaluates function call with constant args at compile time", () => {
    const expr = call(fn(["x"], varRef("x")), num(42));
    expect(generateJS(expr).trim()).toBe("42");
  });

  it("generates IIFE for function with runtime arg", () => {
    const expr = call(fn(["x"], varRef("x")), runtime(num(42), "input"));
    const code = generateJS(expr);
    expect(code).toContain("input");
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

  it("generates field access with dot notation for runtime object", () => {
    const expr = field(runtime(obj({ x: num(1) }), "obj"), "x");
    expect(generateJS(expr).trim()).toBe("obj.x");
  });

  it("evaluates field access on constant object at compile time", () => {
    const expr = field(obj({ x: num(1), y: num(2) }), "x");
    expect(generateJS(expr).trim()).toBe("1");
  });

  it("generates chained field access for runtime object", () => {
    const expr = field(field(runtime(obj({ b: obj({ c: num(1) }) }), "a"), "b"), "c");
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

  it("generates array index for runtime array", () => {
    const expr = index(runtime(array(num(1), num(2)), "arr"), num(0));
    expect(generateJS(expr).trim()).toBe("arr[0]");
  });

  it("evaluates constant array index at compile time", () => {
    const expr = index(array(num(1), num(2), num(3)), num(1));
    expect(generateJS(expr).trim()).toBe("2");
  });

  it("generates dynamic array index for runtime values", () => {
    const expr = index(runtime(array(num(1), num(2)), "arr"), runtime(num(0), "i"));
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

  it("evaluates constant multi-expression block at compile time", () => {
    const expr = block(num(1), num(2), num(3));
    const code = generateJS(expr);
    // All constants - evaluated at compile time
    expect(code.trim()).toBe("3");
    expect(eval(code)).toBe(3);
  });

  it("generates IIFE for block with runtime values to preserve side effects", () => {
    const expr = block(runtime(num(1), "a"), runtime(num(2), "b"), runtime(num(3), "c"));
    const code = generateJS(expr);
    // Block preserves all expressions for side effects, returns last
    expect(code).toContain("a;");
    expect(code).toContain("b;");
    expect(code).toContain("return c;");
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
  it("handles reserved word identifiers in runtime", () => {
    const expr = runtime(num(0), "class");
    expect(generateJS(expr).trim()).toBe("_class");
  });

  it("handles special property names", () => {
    const expr = obj({ "weird-name": num(1) });
    expect(generateJS(expr)).toContain('"weird-name"');
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

// ============================================================================
// Args Destructuring Optimization
// ============================================================================

import { letPatternExpr, arrayPattern, varPattern, recfn } from "@dependent-ts/core";

describe("Args Destructuring Optimization", () => {
  it("transforms fn() with args destructuring to named params", () => {
    // fn() => let [x, y] = args in x + y
    // should generate (x, y) => x + y
    const expr = fn(
      [],
      letPatternExpr(
        arrayPattern(varPattern("x"), varPattern("y")),
        varRef("args"),
        add(varRef("x"), varRef("y"))
      )
    );
    expect(generateJS(expr).trim()).toBe("(x, y) => x + y");
  });

  it("transforms with more complex body", () => {
    // fn() => let [a, b] = args in let c = a + b in c * 2
    const expr = fn(
      [],
      letPatternExpr(
        arrayPattern(varPattern("a"), varPattern("b")),
        varRef("args"),
        letExpr("c", add(varRef("a"), varRef("b")), mul(varRef("c"), num(2)))
      )
    );
    const code = generateJS(expr);
    expect(code).toContain("(a, b)");
    expect(code).toContain("const c = a + b");
    expect(code).toContain("return c * 2");
  });

  it("does not transform if value is not args", () => {
    // fn() => let [x, y] = someArray in x + y
    // Use runtime to make someArray a Later value
    const expr = fn(
      [],
      letPatternExpr(
        arrayPattern(varPattern("x"), varPattern("y")),
        runtime(array(num(1), num(2)), "someArray"),
        add(varRef("x"), varRef("y"))
      )
    );
    const code = generateJS(expr);
    expect(code).toContain("const [x, y] = someArray");
    expect(code).not.toMatch(/^\(x, y\)/);
  });

  it("does not transform if params are already specified", () => {
    // fn(a) => let [x, y] = args in x + y
    // When a function has explicit params, args is the array of those params
    // So args becomes [a] since a is the only parameter
    const expr = fn(
      ["a"],
      letPatternExpr(
        arrayPattern(varPattern("x"), varPattern("y")),
        varRef("args"),
        add(varRef("x"), varRef("y"))
      )
    );
    const code = generateJS(expr);
    expect(code).toContain("(a)");
    // With proper staging, args is evaluated to [a]
    expect(code).toContain("const [x, y] = [a]");
  });

  it("transforms recursive functions", () => {
    // fn fac() => let [n] = args in if n == 0 then 1 else n * fac(n - 1)
    const expr = recfn(
      "fac",
      [],
      letPatternExpr(
        arrayPattern(varPattern("n")),
        varRef("args"),
        ifExpr(
          eq(varRef("n"), num(0)),
          num(1),
          mul(varRef("n"), call(varRef("fac"), sub(varRef("n"), num(1))))
        )
      )
    );
    const code = generateJS(expr);
    expect(code).toContain("fac");
    expect(code).toContain("n");
  });

  it("handles single param optimization", () => {
    // fn() => let [x] = args in x * 2
    const expr = fn(
      [],
      letPatternExpr(
        arrayPattern(varPattern("x")),
        varRef("args"),
        mul(varRef("x"), num(2))
      )
    );
    expect(generateJS(expr).trim()).toBe("(x) => x * 2");
  });
});

// ============================================================================
// Code Generation for Complex Cases
// ============================================================================

import { stage, isLater, assertExpr, parse } from "@dependent-ts/core";

describe("Code Generation for Complex Cases", () => {
  describe("Residual code for runtime assertions", () => {
    it("generates assertion code for runtime checks", () => {
      const expr = assertExpr(runtime(num(5), "x"), varRef("number"));
      const result = stage(expr);

      expect(isLater(result.svalue)).toBe(true);
      if (isLater(result.svalue)) {
        expect(result.svalue.residual.tag).toBe("assert");
      }
    });
  });

  describe("Mixed Now/Later function calls", () => {
    it("inlines Now results when function returns different types for different calls", () => {
      // When a function is called with different types and returns Now for some
      // and Later for others, the Now values should be inlined, not call the function
      const code = compile(parse(`
        let check = fn(x) =>
          let T = typeOf(x) in
          if T == number then x + 1
          else true
        in
        let n = trust(runtime(n: 50), number) in
        let s = trust(runtime(s: "hi"), string) in
        [check(n), check(s)]
      `));

      // Number call should use specialized function
      expect(code).toContain("check");
      // String call should be inlined as `true`, not `check(s)`
      expect(code).toContain("true");
      // The array should contain the function call and the inlined true
      expect(code).toMatch(/\[check\([^)]+\),\s*true]/);
    });

    it("correctly generates mixed Now/Later results", () => {
      // Verify code structure - number call produces Later (x * 2), string produces Now
      const code = compile(parse(`
        let process = fn(x) =>
          let T = typeOf(x) in
          if T == number then x * 2
          else "not a number"
        in
        let numVal = trust(runtime(numVal: 21), number) in
        let strVal = trust(runtime(strVal: "hi"), string) in
        [process(numVal), process(strVal)]
      `));

      // Number call uses specialized function with x * 2
      expect(code).toContain("process");
      expect(code).toContain("* 2");
      // String call is inlined as literal string
      expect(code).toContain('"not a number"');
      // The array should have function call and inlined string
      expect(code).toMatch(/\[process\([^)]+\),\s*"not a number"]/);
    });
  });
});

// ============================================================================
// Block Expression Parsing Tests
// ============================================================================

describe("Block Expression Parsing", () => {
  it("parses single expression block", () => {
    const code = compile(parse("{ 42 }"));
    expect(eval(code)).toBe(42);
  });

  it("parses multi-expression block", () => {
    const code = compile(parse("{ 1; 2; 3 }"));
    expect(eval(code)).toBe(3);
  });

  it("allows trailing semicolon", () => {
    const code = compile(parse("{ 1; 2; }"));
    expect(eval(code)).toBe(2);
  });

  it("preserves side effects with Later values", () => {
    const code = compile(parse(`
      let f = runtime(f: fn() => 1) in
      let g = runtime(g: fn() => 2) in
      { f(); g() }
    `));
    // Should generate IIFE that calls both f() and g()
    expect(code).toContain("f()");
    expect(code).toContain("g()");
  });

  it("distinguishes blocks from objects", () => {
    // Object - verify it parses as obj, not block
    const objExpr = parse("{ x: 1 }");
    expect(objExpr.tag).toBe("obj");
    const objCode = compile(objExpr);
    // Note: eval("{ x: 1 }") in JS is a labeled statement, need parens for object
    expect(eval("(" + objCode + ")")).toEqual({ x: 1 });

    // Block (single expression, no semicolon needed)
    const blockExpr = parse("{ 1 }");
    expect(blockExpr.tag).toBe("block");
    const blockCode = compile(blockExpr);
    expect(eval(blockCode)).toBe(1);
  });

  it("parses block with let expressions inside", () => {
    const code = compile(parse("{ let x = 1 in x; let y = 2 in y }"));
    expect(eval(code)).toBe(2);
  });

  it("empty braces parse as empty object", () => {
    const expr = parse("{}");
    expect(expr.tag).toBe("obj");
    const code = compile(expr);
    // Note: eval("{}") in JS is empty block, need parens for object
    expect(eval("(" + code + ")")).toEqual({});
  });
});
