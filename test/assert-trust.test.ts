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
  trustExpr,
  runtime,
  letExpr,
  add,

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
      const code = generateJS(result.svalue.residual);
      // Should contain some form of check
      expect(code).toContain("__value");
    }
  });

  it("trust disappears in generated code", () => {
    // trust is purely a type-level operation
    const expr = trustExpr(runtime(num(5), "x"), varRef("number"));
    const result = stage(expr);
    expect(isLater(result.svalue)).toBe(true);
    if (isLater(result.svalue)) {
      const code = generateJS(result.svalue.residual);
      // Should just be the variable
      expect(code).toBe("x");
    }
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
