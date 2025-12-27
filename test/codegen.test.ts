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

// ============================================================================
// Args Destructuring Optimization
// ============================================================================

import { letPatternExpr, arrayPattern, varPattern, recfn } from "../src/index";

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
    const expr = fn(
      [],
      letPatternExpr(
        arrayPattern(varPattern("x"), varPattern("y")),
        varRef("someArray"),
        add(varRef("x"), varRef("y"))
      )
    );
    const code = generateJS(expr);
    expect(code).toContain("const [x, y] = someArray");
    expect(code).not.toMatch(/^\(x, y\)/);
  });

  it("does not transform if params are already specified", () => {
    // fn(a) => let [x, y] = args in x + y
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
    expect(code).toContain("const [x, y] = args");
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
    expect(code).toContain("function fac(n)");
    expect(code).not.toContain("args");
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

import { stage, isLater, assertExpr, methodCall } from "../src/index";

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
});

// ============================================================================
// Optimized Filter Code Generation (ifChain)
// ============================================================================

describe("Optimized Filter Code Generation", () => {
  // Test the code generator directly by creating method call expressions
  // and passing them to generateJS (bypassing the type-checking stage evaluator)

  // Helper: create x != null predicate function (the filter predicate)
  const notNullPredicate = fn([], letPatternExpr(
    arrayPattern(varPattern("x")),
    varRef("args"),
    neq(varRef("x"), nil)
  ));

  describe("if-else-if-else null chains", () => {
    it("generates if-else-if for simple validation pattern", () => {
      // [if cond1 then "error1" else if cond2 then "error2" else null].filter(x => x != null)
      const expr = methodCall(
        array(
          ifExpr(
            varRef("isEmpty"),
            str("Email is required"),
            ifExpr(
              varRef("isInvalid"),
              str("Email is invalid"),
              nil
            )
          )
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Should generate if-else-if, not complex conditions
      expect(code).toContain("if (isEmpty)");
      expect(code).toContain("else if (isInvalid)");
      expect(code).toContain('_result.push("Email is required")');
      expect(code).toContain('_result.push("Email is invalid")');

      // Should NOT contain redundant conditions or dead ternaries
      expect(code).not.toContain("? null");
      expect(code).not.toContain(": null");
      expect(code).not.toContain("isEmpty || !isEmpty");
    });

    it("generates if-else-if for three-level chain", () => {
      // if a then "A" else if b then "B" else if c then "C" else null
      const expr = methodCall(
        array(
          ifExpr(
            varRef("a"),
            str("A"),
            ifExpr(
              varRef("b"),
              str("B"),
              ifExpr(
                varRef("c"),
                str("C"),
                nil
              )
            )
          )
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      expect(code).toContain("if (a)");
      expect(code).toContain("} else if (b)");
      expect(code).toContain("} else if (c)");
      expect(code).not.toContain(": null");
    });

    it("handles multiple elements with different patterns", () => {
      // [if a then "A" else null, if b then "B" else if c then "C" else null].filter(...)
      const expr = methodCall(
        array(
          ifExpr(varRef("a"), str("A"), nil),
          ifExpr(
            varRef("b"),
            str("B"),
            ifExpr(varRef("c"), str("C"), nil)
          )
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // First element: simple conditional
      expect(code).toContain("if (a)");
      expect(code).toContain('_result.push("A")');

      // Second element: if-else-if chain
      expect(code).toContain("if (b)");
      expect(code).toContain("} else if (c)");
    });
  });

  describe("always and never branch elimination", () => {
    it("eliminates never branches entirely", () => {
      // [if cond then "value" else null].filter(x => x != null)
      // The null branch is "never" so only the conditional remains
      const expr = methodCall(
        array(
          ifExpr(varRef("cond"), str("value"), nil)
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      expect(code).toContain("if (cond)");
      expect(code).toContain('_result.push("value")');
      // The null literal should not appear in the output (it's pruned)
      expect(code).not.toMatch(/\bnull\b/);
    });

    it("keeps always branches unconditionally", () => {
      // ["always included", if cond then "maybe" else null].filter(x => x != null)
      const expr = methodCall(
        array(
          str("always included"),
          ifExpr(varRef("cond"), str("maybe"), nil)
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // First element: always included, no condition
      expect(code).toContain('_result.push("always included")');

      // Second element: conditional
      expect(code).toContain("if (cond)");
      expect(code).toContain('_result.push("maybe")');
    });

    it("prunes elements that are always null", () => {
      // [null, if cond then "value" else null].filter(x => x != null)
      const expr = methodCall(
        array(
          nil,
          ifExpr(varRef("cond"), str("value"), nil)
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Should have a comment about pruning
      expect(code).toContain("pruned");
      // Should only have one push
      expect(code.match(/_result\.push/g)?.length).toBe(1);
    });
  });

  describe("condition evaluation efficiency", () => {
    it("evaluates each condition exactly once", () => {
      // if isEmpty(x) then "required" else if !isValid(x) then "invalid" else null
      const expr = methodCall(
        array(
          ifExpr(
            call(varRef("isEmpty"), varRef("x")),
            str("required"),
            ifExpr(
              notExpr(call(varRef("isValid"), varRef("x"))),
              str("invalid"),
              nil
            )
          )
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // isEmpty(x) should appear exactly once (in the if condition)
      const isEmptyMatches = code.match(/isEmpty\(x\)/g);
      expect(isEmptyMatches?.length).toBe(1);

      // isValid(x) should appear exactly once (in the else if condition)
      const isValidMatches = code.match(/isValid\(x\)/g);
      expect(isValidMatches?.length).toBe(1);
    });

    it("does not generate redundant boolean expressions", () => {
      const expr = methodCall(
        array(
          ifExpr(
            varRef("a"),
            str("A"),
            ifExpr(varRef("b"), str("B"), nil)
          )
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Should NOT have patterns like "a || !a && b"
      expect(code).not.toMatch(/a \|\| !a/);
      expect(code).not.toMatch(/!a && b/);
    });
  });

  describe("complex nested structures", () => {
    it("handles validator-style multiple field validation", () => {
      // Simulates the validator.dep pattern
      const emailValidation = ifExpr(
        call(varRef("isEmpty"), varRef("email")),
        str("Email is required"),
        ifExpr(
          notExpr(call(varRef("isValidEmail"), varRef("email"))),
          str("Email must contain @ and ."),
          nil
        )
      );

      const passwordValidation = ifExpr(
        call(varRef("isEmpty"), varRef("password")),
        str("Password is required"),
        ifExpr(
          notExpr(call(call(varRef("minLength"), num(8)), varRef("password"))),
          str("Password must be at least 8 characters"),
          nil
        )
      );

      const expr = methodCall(
        array(emailValidation, passwordValidation),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Should have clean if-else-if for each validation
      expect(code).toContain("if (isEmpty(email))");
      expect(code).toContain("} else if (!isValidEmail(email))");
      expect(code).toContain("if (isEmpty(password))");
      expect(code).toContain("} else if (!minLength(8)(password))");

      // Each function should be called exactly once per field
      expect(code.match(/isEmpty\(email\)/g)?.length).toBe(1);
      expect(code.match(/isValidEmail\(email\)/g)?.length).toBe(1);
      expect(code.match(/isEmpty\(password\)/g)?.length).toBe(1);
    });

    it("handles inverted condition (then-never, else-always)", () => {
      // if cond then null else "value"  - should include when !cond
      const expr = methodCall(
        array(
          ifExpr(varRef("shouldSkip"), nil, str("included"))
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      expect(code).toContain("if (!shouldSkip)");
      expect(code).toContain('_result.push("included")');
    });
  });

  describe("edge cases", () => {
    it("falls back to normal filter for unknown predicates", () => {
      // When predicate is too complex to analyze statically, it falls back to regular filter
      const complexPredicate = fn([], letPatternExpr(
        arrayPattern(varPattern("x")),
        varRef("args"),
        andExpr(neq(varRef("x"), nil), gtExpr(varRef("x"), num(0)))
      ));

      const expr = methodCall(
        array(
          ifExpr(varRef("cond"), varRef("dynamicValue"), nil)
        ),
        "filter",
        [complexPredicate]
      );
      const code = generateJS(expr);

      // When predicate can't be analyzed, falls back to regular filter call
      expect(code).toContain(".filter(");
    });

    it("handles empty array - no optimization without conditionals", () => {
      // Empty array without conditionals - optimization doesn't kick in
      const expr = methodCall(
        array(),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Should just call filter on empty array
      expect(code).toContain("[].filter");
    });

    it("handles array with all nulls and a conditional", () => {
      // Add a conditional element to trigger optimization
      const expr = methodCall(
        array(
          nil,
          nil,
          ifExpr(varRef("cond"), nil, nil)  // Always null but has conditional structure
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Elements should be pruned
      expect(code).toContain("pruned");
      expect(code).not.toMatch(/_result\.push\(/);
    });

    it("handles mixed always/conditional elements", () => {
      // Mix of always-included and conditional elements
      const expr = methodCall(
        array(
          str("always"),
          ifExpr(varRef("cond"), str("maybe"), nil)
        ),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // "always" is pushed unconditionally, "maybe" conditionally
      expect(code).toContain('_result.push("always")');
      expect(code).toContain("if (cond)");
      expect(code).toContain('_result.push("maybe")');
    });

    it("handles array with only literals - no optimization without conditionals", () => {
      // Array with only non-null literals - optimization not needed
      const expr = methodCall(
        array(str("a"), str("b"), str("c")),
        "filter",
        [notNullPredicate]
      );
      const code = generateJS(expr);

      // Should just call filter normally (no conditionals to optimize)
      expect(code).toContain('["a", "b", "c"].filter');
    });
  });

  describe("filter().map() fusion", () => {
    it("fuses toUpperCase into filter - evaluates at compile time", () => {
      // [if cond then "hello" else null].filter(x => x != null).map(x => x.toUpperCase())
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(varRef("cond"), str("hello"), nil)
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(varRef("x"), "toUpperCase", [])
        ))]
      );
      const code = generateJS(expr);

      // Method should be evaluated at compile time since receiver is a literal
      expect(code).toContain('"HELLO"');
      expect(code).not.toContain('.toUpperCase()');
      expect(code).not.toContain('.map(');
    });

    it("fuses any method call - toLowerCase evaluated at compile time", () => {
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(varRef("cond"), str("WORLD"), nil)
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(varRef("x"), "toLowerCase", [])
        ))]
      );
      const code = generateJS(expr);

      expect(code).toContain('"world"');
      expect(code).not.toContain('.toLowerCase()');
      expect(code).not.toContain('.map(');
    });

    it("applies transform to all branches with compile-time evaluation", () => {
      // Multiple branches with different string literals
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(
              varRef("a"),
              str("first"),
              ifExpr(varRef("b"), str("second"), nil)
            )
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(varRef("x"), "toUpperCase", [])
        ))]
      );
      const code = generateJS(expr);

      // Both literals should be uppercased at compile time
      expect(code).toContain('"FIRST"');
      expect(code).toContain('"SECOND"');
      expect(code).not.toContain('.toUpperCase()');
      expect(code).not.toContain('.map(');
    });

    it("falls back for non-literal values that cant be analyzed", () => {
      // When we can't statically determine if value passes the predicate,
      // fall back to runtime filter/map
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(varRef("cond"), varRef("dynamicValue"), nil)
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(varRef("x"), "toUpperCase", [])
        ))]
      );
      const code = generateJS(expr);

      // Can't optimize - falls back to runtime filter/map
      expect(code).toContain('.filter(');
      expect(code).toContain('.map(');
    });

    it("fuses binary operations - evaluated at compile time", () => {
      // Transform that adds a suffix: x + "!"
      // The generic stage() approach evaluates "hello" + "!" at compile time
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(varRef("cond"), str("hello"), nil)
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          add(varRef("x"), str("!"))
        ))]
      );
      const code = generateJS(expr);

      // Should evaluate the binary operation at compile time
      expect(code).toContain('"hello!"');
      expect(code).not.toContain('"hello" + "!"');
      expect(code).not.toContain('.map(');
    });

    it("handles trim with compile-time evaluation", () => {
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(varRef("cond"), str("  padded  "), nil)
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(varRef("x"), "trim", [])
        ))]
      );
      const code = generateJS(expr);

      // trim should be evaluated at compile time
      expect(code).toContain('"padded"');
      expect(code).not.toContain('.trim()');
      expect(code).not.toContain('.map(');
    });

    it("handles validator pattern with compile-time toUpperCase", () => {
      // Simulates the actual validator.dep pattern
      const emailValidation = ifExpr(
        call(varRef("isEmpty"), varRef("email")),
        str("Email is required"),
        ifExpr(
          notExpr(call(varRef("isValidEmail"), varRef("email"))),
          str("Invalid email"),
          nil
        )
      );

      const expr = methodCall(
        methodCall(
          array(emailValidation),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(varRef("x"), "toUpperCase", [])
        ))]
      );
      const code = generateJS(expr);

      // Transform should be evaluated at compile time
      expect(code).toContain('"EMAIL IS REQUIRED"');
      expect(code).toContain('"INVALID EMAIL"');
      expect(code).not.toContain('.toUpperCase()');
      expect(code).not.toContain('.map(');
      // Should still have the if-else-if structure
      expect(code).toContain("if (isEmpty(email))");
      expect(code).toContain("} else if (!isValidEmail(email))");
    });

    it("handles complex transforms with chained method calls - fully evaluated", () => {
      // Chain: x.trim().toUpperCase()
      // The generic approach using stage() evaluates the entire chain at compile time
      const expr = methodCall(
        methodCall(
          array(
            ifExpr(varRef("cond"), str("  hello  "), nil)
          ),
          "filter",
          [notNullPredicate]
        ),
        "map",
        [fn([], letPatternExpr(
          arrayPattern(varPattern("x")),
          varRef("args"),
          methodCall(methodCall(varRef("x"), "trim", []), "toUpperCase", [])
        ))]
      );
      const code = generateJS(expr);

      // Both chained methods should be evaluated at compile time
      expect(code).toContain('"HELLO"');
      expect(code).not.toContain('.trim()');
      expect(code).not.toContain('.toUpperCase()');
      expect(code).not.toContain('.map(');
    });
  });
});
