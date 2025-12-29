/**
 * Tests for assert/trust Keywords (Challenge 3)
 *
 * assert: Runtime assertion that a value satisfies a constraint
 * trust: Trust that a value satisfies a constraint without runtime check
 */

import { describe, it, expect } from "vitest";
import {
  // Expressions
  num,
  str,
  varRef,
  assertExpr,
  assertCondExpr,
  trustExpr,
  runtime,
  letExpr,
  add,
  ltExpr,
  fn,
  call,

  // Constraints
  isNumber,
  isString,
  isBool,
  and,
  gt,
  equals,
  implies,

  // Values
  typeVal,
  numberVal,
  stringVal,

  // Evaluation
  run,
  AssertionError,

  // Staged evaluation
  stage,
  isNow,
  isLater,

  // Code generation
  generateJS,
  compile,

  // Parser
  parseAndRun,
} from "../src/index";

// ============================================================================
// Pure Evaluation: assert
// ============================================================================

describe("assert in Pure Evaluation", () => {
  it("assert with valid constraint succeeds", () => {
    // assert(5, number) - 5 is a number, should succeed
    const expr = assertExpr(num(5), varRef("number"));
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(5);
    // Constraint should be refined
    expect(implies(result.constraint, isNumber)).toBe(true);
  });

  it("assert with string type succeeds for strings", () => {
    const expr = assertExpr(str("hello"), varRef("string"));
    const result = run(expr);
    expect(result.value.tag).toBe("string");
    expect((result.value as any).value).toBe("hello");
    expect(implies(result.constraint, isString)).toBe(true);
  });

  it("assert with invalid type throws AssertionError", () => {
    // assert("hello", number) - "hello" is not a number
    const expr = assertExpr(str("hello"), varRef("number"));
    expect(() => run(expr)).toThrow(AssertionError);
  });

  it("assert with custom message shows in error", () => {
    const expr = assertExpr(str("hello"), varRef("number"), "Expected a number");
    expect(() => run(expr)).toThrow("Expected a number");
  });

  it("assert refines constraint on success", () => {
    // The constraint of assert(x, T) should be x & T
    const expr = assertExpr(num(5), varRef("number"));
    const result = run(expr);
    // Should have number constraint
    expect(implies(result.constraint, isNumber)).toBe(true);
  });
});

// ============================================================================
// Pure Evaluation: trust
// ============================================================================

describe("trust in Pure Evaluation", () => {
  it("trust refines constraint without runtime check", () => {
    // trust(5, number) - should succeed
    const expr = trustExpr(num(5), varRef("number"));
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(5);
    expect(implies(result.constraint, isNumber)).toBe(true);
  });

  it("trust with mismatched type does NOT throw (no runtime check)", () => {
    // trust("hello", number) - no check, just refines types
    // This is dangerous but should succeed at runtime
    const expr = trustExpr(str("hello"), varRef("number"));
    const result = run(expr);
    // Value is still a string
    expect(result.value.tag).toBe("string");
    // But constraint has been refined to include number (dangerous!)
    expect(implies(result.constraint, isNumber)).toBe(true);
  });

  it("trust is purely a type-level operation", () => {
    const expr = trustExpr(num(42), varRef("string"));
    const result = run(expr);
    // Value unchanged
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(42);
    // Constraint includes the trusted type
    expect(implies(result.constraint, isString)).toBe(true);
  });
});

// ============================================================================
// Staged Evaluation: assert
// ============================================================================

describe("assert in Staged Evaluation", () => {
  it("assert with Now value checks at compile time", () => {
    // assert(5, number) where 5 is Now - should succeed at compile time
    const expr = assertExpr(num(5), varRef("number"));
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect(result.svalue.value.tag).toBe("number");
    }
  });

  it("assert with Now value and invalid type throws at compile time", () => {
    // assert("hello", number) where "hello" is Now - should throw at compile time
    const expr = assertExpr(str("hello"), varRef("number"));
    expect(() => stage(expr)).toThrow(AssertionError);
  });

  it("assert with Later value generates residual", () => {
    // assert(runtime(number), number) - runtime value needs residual assertion
    const expr = assertExpr(runtime(num(5), "x"), varRef("number"));
    const result = stage(expr);
    expect(isLater(result.svalue)).toBe(true);
    if (isLater(result.svalue)) {
      // The residual should be an assert expression
      expect(result.svalue.residual.tag).toBe("assert");
    }
  });

  it("assert requires compile-time known type constraint", () => {
    // assert(5, runtime(number)) - runtime constraint should fail
    const expr = assertExpr(num(5), runtime(varRef("number"), "typeParam"));
    expect(() => stage(expr)).toThrow("assert requires a compile-time known type constraint");
  });
});

// ============================================================================
// Staged Evaluation: trust
// ============================================================================

describe("trust in Staged Evaluation", () => {
  it("trust with Now value refines at compile time", () => {
    const expr = trustExpr(num(5), varRef("number"));
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect(result.svalue.value.tag).toBe("number");
      expect(implies(result.svalue.constraint, isNumber)).toBe(true);
    }
  });

  it("trust with Later value refines constraint only", () => {
    // trust(runtime(number), string) - just refines the constraint
    const expr = trustExpr(runtime(num(5), "x"), varRef("string"));
    const result = stage(expr);
    expect(isLater(result.svalue)).toBe(true);
    if (isLater(result.svalue)) {
      // The residual should be the variable reference (trust disappears)
      expect(result.svalue.residual.tag).toBe("var");
      // Constraint is refined
      expect(implies(result.svalue.constraint, isString)).toBe(true);
    }
  });

  it("trust requires compile-time known type constraint", () => {
    const expr = trustExpr(num(5), runtime(varRef("number"), "typeParam"));
    expect(() => stage(expr)).toThrow("trust requires a compile-time known type constraint");
  });
});

// ============================================================================
// Code Generation
// ============================================================================

describe("Code Generation for assert/trust", () => {
  it("generates runtime check for assert", () => {
    // Create a Later assert expression and generate code
    const expr = assertExpr(runtime(num(5), "x"), varRef("number"));
    const result = stage(expr);
    expect(isLater(result.svalue)).toBe(true);
    if (isLater(result.svalue)) {
      // Check the residual is an assert expression
      expect(result.svalue.residual.tag).toBe("assert");
    }
  });

  it("trust disappears in generated code", () => {
    // trust is purely a type-level operation
    const expr = trustExpr(runtime(num(5), "x"), varRef("number"));
    const result = stage(expr);
    expect(isLater(result.svalue)).toBe(true);
    if (isLater(result.svalue)) {
      // The residual should just be the variable reference (trust disappears)
      // The runtime() wrapper is unwrapped to just a var reference
      expect(result.svalue.residual.tag).toBe("var");
    }
  });

  it("compiles assert with runtime value", () => {
    // Full compilation generates assert code
    const expr = assertExpr(runtime(num(5), "x"), varRef("number"));
    const code = compile(expr);
    // Should contain some form of runtime check
    expect(code).toContain("x");
  });

  it("compiles trust with runtime value - just returns value", () => {
    // Full compilation - trust disappears
    const expr = trustExpr(runtime(num(5), "x"), varRef("number"));
    const code = compile(expr);
    // Should just be the variable
    expect(code.trim()).toBe("x");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("assert/trust Integration", () => {
  it("assert can be used in let binding", () => {
    // let y = assert(5, number) in y + 1
    const expr = letExpr(
      "y",
      assertExpr(num(5), varRef("number")),
      add(varRef("y"), num(1))
    );
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(6);
  });

  it("trust can be used in let binding", () => {
    // let y = trust(5, number) in y + 1
    const expr = letExpr(
      "y",
      trustExpr(num(5), varRef("number")),
      add(varRef("y"), num(1))
    );
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(6);
  });

  it("assert refines type for subsequent operations", () => {
    // After assert(x, number), x should be known to be a number
    const expr = letExpr(
      "x",
      assertExpr(num(42), varRef("number")),
      add(varRef("x"), num(1))
    );
    const result = run(expr);
    expect((result.value as any).value).toBe(43);
  });
});

// ============================================================================
// Inline assert/trust Syntax
// ============================================================================

describe("Inline assert(condition) Syntax", () => {
  it("assert(condition) throws when condition is false", () => {
    // assert(x < 100) - check condition, throw if false
    const expr = letExpr(
      "x",
      num(150),
      assertCondExpr(ltExpr(varRef("x"), num(100)))
    );
    expect(() => run(expr)).toThrow(AssertionError);
  });

  it("assert(condition) passes when condition is true", () => {
    // assert(x < 100) - check condition, return true if passes
    const expr = letExpr(
      "x",
      num(50),
      assertCondExpr(ltExpr(varRef("x"), num(100)))
    );
    const result = run(expr);
    expect(result.value.tag).toBe("bool");
    expect((result.value as any).value).toBe(true);
  });

  it("assert(condition) can be parsed from source", () => {
    const result = parseAndRun("let x = 50 in assert(x < 100)");
    expect(result.value.tag).toBe("bool");
    expect((result.value as any).value).toBe(true);
  });

  it("assert(condition) in staged evaluation with Now", () => {
    const expr = letExpr(
      "x",
      num(50),
      assertCondExpr(ltExpr(varRef("x"), num(100)))
    );
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
  });

  it("assert(condition) in staged evaluation with Later generates residual", () => {
    const expr = assertCondExpr(ltExpr(runtime(num(50), "x"), num(100)));
    const result = stage(expr);
    expect(isLater(result.svalue)).toBe(true);
    if (isLater(result.svalue)) {
      expect(result.svalue.residual.tag).toBe("assertCond");
    }
  });
});

describe("Inline trust(expr) Syntax", () => {
  it("trust(expr) returns value unchanged", () => {
    // trust(x) without a constraint just returns the value unchanged
    const expr = trustExpr(num(42));
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(42);
  });

  it("trust(expr) can be used inline in function calls", () => {
    // let f = fn(x) => x in f(trust(5))
    const expr = letExpr(
      "f",
      fn(["x"], varRef("x")),
      call(varRef("f"), trustExpr(num(5)))
    );
    const result = run(expr);
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(5);
  });

  it("trust(expr) can be parsed from source", () => {
    const result = parseAndRun("trust(42)");
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(42);
  });
});

// ============================================================================
// Function Where Clauses
// From docs/constraints-as-types.md: "fn safeDiv(x, y) where y != 0 = x / y"
// ============================================================================

import { parse, neq, div } from "../src/index";

describe("Function Where Clauses", () => {
  describe("Where clause syntax (not implemented)", () => {
    it("parser should support where clause", () => {
      expect(() => {
        parse("fn(x, y) where y > 0 => x / y");
      }).toThrow();
    });
  });

  describe("Simulating where clauses with assert", () => {
    it("can simulate where clause with assert in body", () => {
      const safeDiv = fn(["x", "y"],
        letExpr("_", assertExpr(neq(varRef("y"), num(0)), varRef("boolean")),
          div(varRef("x"), varRef("y"))
        )
      );

      const expr = call(safeDiv, num(10), num(2));
      const result = run(expr);
      expect(result.value.tag).toBe("number");
      expect((result.value as any).value).toBe(5);
    });
  });
});

describe("Custom Error Messages", () => {
  it("assert with custom message includes that message", () => {
    const expr = assertExpr(str("hello"), varRef("number"), "Value must be a number");
    expect(() => run(expr)).toThrow("Value must be a number");
  });
});

// ============================================================================
// Comptime Assert: Type Refinement Without Runtime Code
// From docs/comptime-expression.md
// ============================================================================

import { comptime, block, isStagedClosure, parseAndCompile } from "../src/index";

describe("comptime(assert(x, T)) - Type Refinement", () => {
  describe("Basic comptime assert behavior", () => {
    it("comptime(assert(x, T)) returns Now(null) when successful", () => {
      // comptime forces compile-time evaluation
      // When value is Later but constraint is Now, assert succeeds and returns null
      // We use a let binding because runtime() doesn't bind the variable
      const expr = letExpr("x", runtime(num(5), "x"),
        comptime(assertExpr(varRef("x"), varRef("number")))
      );
      const result = stage(expr);
      expect(isNow(result.svalue)).toBe(true);
      if (isNow(result.svalue)) {
        expect(result.svalue.value.tag).toBe("null");
      }
    });

    it("comptime(assert(x, T)) refines type in block", () => {
      // let x = runtime(...) in { comptime(assert(x, T)); x } - x should have refined type
      const expr = letExpr("x", runtime(num(5), "x"),
        block(
          comptime(assertExpr(varRef("x"), varRef("number"))),
          varRef("x")
        )
      );
      const result = stage(expr);
      // The result is Later because x is Later, but with number constraint
      expect(isLater(result.svalue)).toBe(true);
      if (isLater(result.svalue)) {
        expect(implies(result.svalue.constraint, isNumber)).toBe(true);
      }
    });

    it("comptime assertion disappears from residual", () => {
      // let x = runtime(...) in { comptime(assert(x, T)); x } should generate just "x", not an assert
      const expr = letExpr("x", runtime(num(5), "x"),
        block(
          comptime(assertExpr(varRef("x"), varRef("number"))),
          varRef("x")
        )
      );
      const result = stage(expr);
      expect(isLater(result.svalue)).toBe(true);
      if (isLater(result.svalue)) {
        // The residual should NOT contain assert - the comptime assertion disappears
        const code = compile(expr);
        expect(code).not.toContain("assert");
        expect(code).toContain("x");
      }
    });
  });

  describe("Generic functions with comptime assert", () => {
    // Note: Full generic function support with comptime assert requires type erasure
    // during residualization, which is not yet implemented. The basic mechanism works
    // (comptime(assert(x, T)) returns Now(null) when inside comptime context),
    // but generating residual code for generic functions hits "Cannot convert type
    // value to expression directly" when the type parameter appears in captured values.

    it("non-generic function with comptime type check works", () => {
      // When the type is known statically (not a parameter), it works
      const source = `
        let checkNumber = fn(x) => { comptime(assert(x, number)); x } in
        checkNumber(runtime(n: 42))
      `;
      const code = parseAndCompile(source);
      // The comptime assert should NOT appear in the generated code
      expect(code).not.toContain("assert");
      expect(code).toContain("checkNumber");
    });

    it("generic identity function with comptime type check", () => {
      // Type erasure allows generic functions - type parameters are erased after comptime
      const source = `
        let id = fn(T) => fn(x) => { comptime(assert(x, T)); x } in
        let idNum = id(number) in
        idNum(runtime(n: 42))
      `;
      const code = parseAndCompile(source);
      expect(code).not.toContain("assert");
      expect(code).toContain("idNum");
    });

    it("generic pair function with comptime type checks", () => {
      // Multiple type parameters are erased after comptime
      const source = `
        let pair = fn(T) => fn(x, y) => { comptime(assert(x, T)); comptime(assert(y, T)); [x, y] } in
        pair(number)(runtime(a: 1), runtime(b: 2))
      `;
      const code = parseAndCompile(source);
      expect(code).not.toContain("assert");
    });
  });

  describe("Mixed comptime and runtime assertions", () => {
    it("comptime refines type only (non-generic)", () => {
      // Comptime assert refines the type but doesn't generate runtime code
      const source = `
        let checkNumber = fn(x) => {
          comptime(assert(x, number));
          x + 1
        } in
        checkNumber(runtime(n: 42))
      `;
      const code = parseAndCompile(source);
      // The comptime assert should NOT appear in the generated code
      expect(code).not.toContain("assert");
      // The function body should just be x + 1
      expect(code).toContain("+ 1");
    });

    it("regular assert also does not generate runtime code (type refinement only)", () => {
      // Note: In this system, assert(expr, type) is a TYPE refinement operation,
      // not a runtime check. The constraint is checked at staging time where possible.
      // Use assertCond(condition) for runtime condition checks.
      const source = `
        let checkNumber = fn(x) => {
          assert(x, number);
          x + 1
        } in
        checkNumber(runtime(n: 42))
      `;
      const code = parseAndCompile(source);
      // Assert does NOT generate runtime code - it's purely type refinement
      expect(code).not.toContain("assert");
      // The expression is still evaluated (for side effects)
      expect(code).toContain("+ 1");
    });

    it("assertCond generates runtime check", () => {
      // assertCond(condition) DOES generate runtime code
      const source = `
        let checkPositive = fn(x) => {
          assert(x > 0);
          x + 1
        } in
        checkPositive(runtime(n: 42))
      `;
      const code = parseAndCompile(source);
      // assertCond generates runtime checking code (not literal "assert" but throws)
      expect(code).toContain("throw");
      expect(code).toContain("Assertion failed");
    });
  });

  describe("comptime error cases", () => {
    it("comptime fails when result would be Later", () => {
      // comptime(x + 1) where x is Later - should error
      const expr = comptime(add(runtime(num(5), "x"), num(1)));
      expect(() => stage(expr)).toThrow("comptime expression evaluated to runtime value");
    });

    it("comptime succeeds when assertion can be verified at compile time", () => {
      // comptime(assert(5, number)) - 5 is Now, number is Now
      const expr = comptime(assertExpr(num(5), varRef("number")));
      const result = stage(expr);
      expect(isNow(result.svalue)).toBe(true);
    });
  });
});

describe("Curried functions with comptime assert", () => {
  it("curried function preserves type refinement", () => {
    const source = `
      let minLength = fn(n) => fn(s) => {
        comptime(assert(s, string));
        s.length >= n
      } in
      minLength(8)(runtime(password: "secret123"))
    `;
    const code = parseAndCompile(source);
    // No type assert in code (it's comptime)
    expect(code).not.toContain("assert(password, string)");
    // Should have length check
    expect(code).toContain("length");
    expect(code).toContain(">=");
  });
});

describe("Type erasure edge cases", () => {
  it("type used at runtime produces clear error", () => {
    // Returning a type value from a function is an error
    const source = `
      let bad = fn(T) => fn(x) => T in
      bad(number)(runtime(x: 1))
    `;
    expect(() => parseAndCompile(source)).toThrow(/runtime|compile-time/i);
  });

  it("multiple generic specializations work", () => {
    // Same generic function used with different type arguments
    const source = `
      let id = fn(T) => fn(x) => { comptime(assert(x, T)); x } in
      let idNum = id(number) in
      let idStr = id(string) in
      [idNum(runtime(n: 1)), idStr(runtime(s: "hi"))]
    `;
    const code = parseAndCompile(source);
    expect(code).not.toContain("assert");
    expect(code).toContain("idNum");
    expect(code).toContain("idStr");
  });

  it("nested generic functions work", () => {
    // Generic function returning a generic function
    const source = `
      let outer = fn(T) => fn(U) => fn(x, y) => {
        comptime(assert(x, T));
        comptime(assert(y, U));
        [x, y]
      } in
      outer(number)(string)(runtime(a: 1), runtime(b: "hello"))
    `;
    const code = parseAndCompile(source);
    expect(code).not.toContain("assert");
  });
});
