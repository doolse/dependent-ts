/**
 * Tests for staged evaluation (partial evaluation with Now/Later).
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isObject,
  and,
  equals,
  gt,
  hasField,
  implies,
  constraintToString,

  // Expressions
  num,
  str,
  bool,
  nil,
  varRef,
  add,
  sub,
  mul,
  ltExpr,
  gtExpr,
  eq,
  ifExpr,
  letExpr,
  fn,
  call,
  obj,
  field,
  array,
  index,
  comptime,
  runtime,
  exprToString,

  // Staged evaluation
  stage,
  stageToExpr,
  isNow,
  isLater,
  isLaterArray,
  isStagedClosure,
  StagingError,
  resetVarCounter,

  // Parser
  parse,
} from "@dependent-ts/core";

beforeEach(() => {
  resetVarCounter();
});

describe("Basic Staging Tests", () => {
  it("literals are Now", () => {
    const result = stage(num(42)).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result)) {
      expect(result.value.tag).toBe("number");
      if (result.value.tag === "number") {
        expect(result.value.value).toBe(42);
      }
    }
  });

  it("string literals are Now", () => {
    const result = stage(str("hello")).svalue;
    expect(isNow(result)).toBe(true);
  });

  it("boolean literals are Now", () => {
    const result = stage(bool(true)).svalue;
    expect(isNow(result)).toBe(true);
  });

  it("null literal is Now", () => {
    const result = stage(nil).svalue;
    expect(isNow(result)).toBe(true);
  });
});

describe("Arithmetic Staging Tests", () => {
  it("arithmetic on Now values computes immediately", () => {
    const result = stage(add(num(1), num(2))).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(3);
    }
  });

  it("complex arithmetic is fully computed when all Now", () => {
    const result = stage(mul(add(num(2), num(3)), num(4))).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(20);
    }
  });
});

describe("Runtime Annotation Tests", () => {
  it("runtime creates Later value", () => {
    const result = stage(runtime(num(5), "x")).svalue;
    expect(isLater(result)).toBe(true);
    if (isLater(result)) {
      expect(implies(result.constraint, isNumber)).toBe(true);
      expect(implies(result.constraint, equals(5))).toBe(true);
    }
  });

  it("runtime preserves constraint", () => {
    const result = stage(runtime(num(42), "x")).svalue;
    expect(isLater(result)).toBe(true);
    if (isLater(result)) {
      expect(implies(result.constraint, equals(42))).toBe(true);
    }
  });

  it("arithmetic with Later produces Later with residual", () => {
    const result = stage(add(runtime(num(5), "x"), num(3))).svalue;
    expect(isLater(result)).toBe(true);
    if (isLater(result)) {
      expect(implies(result.constraint, isNumber)).toBe(true);
      const residual = exprToString(result.residual);
      expect(residual.includes("x") && residual.includes("3")).toBe(true);
    }
  });

  it("stageToExpr returns literal for Now", () => {
    const expr = stageToExpr(add(num(2), num(3)));
    expect(exprToString(expr)).toBe("5");
  });

  it("stageToExpr returns residual for Later", () => {
    const expr = stageToExpr(add(runtime(num(5), "x"), num(3)));
    expect(exprToString(expr).includes("+")).toBe(true);
  });
});

describe("Comptime Tests", () => {
  it("comptime succeeds with Now value", () => {
    const result = stage(comptime(add(num(2), num(3)))).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
  });

  it("comptime fails with Later value", () => {
    expect(() => {
      stage(comptime(add(runtime(num(5), "x"), num(3))));
    }).toThrow(StagingError);
  });
});

describe("Let Binding Staging Tests", () => {
  it("let with Now value propagates Now", () => {
    const result = stage(
      letExpr("x", num(5), add(varRef("x"), num(1)))
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(6);
    }
  });

  it("let with Later value propagates Later", () => {
    const result = stage(
      letExpr("x", runtime(num(5), "input"), add(varRef("x"), num(1)))
    ).svalue;
    expect(isLater(result)).toBe(true);
  });

  it("let generates residual when needed", () => {
    const expr = stageToExpr(
      letExpr("x", runtime(num(5), "input"), add(varRef("x"), varRef("x")))
    );
    const s = exprToString(expr);
    expect(s.includes("let") && s.includes("input")).toBe(true);
  });
});

describe("If Expression Staging Tests", () => {
  it("if with Now condition evaluates only taken branch", () => {
    const result = stage(
      ifExpr(bool(true), num(1), varRef("undefined_var"))
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(1);
    }
  });

  it("if with Now false condition evaluates else branch", () => {
    const result = stage(
      ifExpr(bool(false), varRef("undefined"), num(2))
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(2);
    }
  });

  it("if with Later condition generates residual", () => {
    const result = stage(
      ifExpr(runtime(bool(true), "cond"), num(1), num(2))
    ).svalue;
    expect(isLater(result)).toBe(true);
    if (isLater(result)) {
      const residual = exprToString(result.residual);
      expect(residual.includes("if") && residual.includes("cond")).toBe(true);
    }
  });
});

describe("Function Staging Tests", () => {
  it("function definition is StagedClosure", () => {
    const result = stage(fn(["x"], add(varRef("x"), num(1)))).svalue;
    expect(isStagedClosure(result)).toBe(true);
  });

  it("function call with Now args evaluates fully", () => {
    const result = stage(
      call(fn(["x"], add(varRef("x"), num(1))), num(5))
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(6);
    }
  });

  it("function call with Later arg produces Later", () => {
    const result = stage(
      call(fn(["x"], add(varRef("x"), num(1))), runtime(num(5), "input"))
    ).svalue;
    expect(isLater(result)).toBe(true);
  });

  it("function can mix Now and Later args", () => {
    const result = stage(
      call(
        fn(["x", "y"], add(varRef("x"), varRef("y"))),
        num(5),
        runtime(num(3), "y")
      )
    ).svalue;
    expect(isLater(result)).toBe(true);
    if (isLater(result)) {
      const residual = exprToString(result.residual);
      expect(residual.includes("5") || residual.includes("y")).toBe(true);
    }
  });
});

describe("Object Staging Tests", () => {
  it("object with all Now fields is Now", () => {
    const result = stage(obj({ x: num(1), y: num(2) })).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result)) {
      expect(implies(result.constraint, isObject)).toBe(true);
      expect(
        implies(result.constraint, hasField("x", and(isNumber, equals(1))))
      ).toBe(true);
    }
  });

  it("object with Later field is Later", () => {
    const result = stage(obj({ x: num(1), y: runtime(num(2), "y") })).svalue;
    expect(isLater(result)).toBe(true);
  });

  it("field access on Now object is Now", () => {
    const result = stage(field(obj({ x: num(42) }), "x")).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
  });

  it("field access on Later object is Later", () => {
    const result = stage(
      field(runtime(obj({ x: num(42) }), "obj"), "x")
    ).svalue;
    expect(isLater(result)).toBe(true);
  });
});

describe("Array Staging Tests", () => {
  it("array with all Now elements is Now", () => {
    const result = stage(array(num(1), num(2), num(3))).svalue;
    expect(isNow(result)).toBe(true);
  });

  it("array with Later element is LaterArray", () => {
    const result = stage(array(num(1), runtime(num(2), "x"), num(3))).svalue;
    expect(isLaterArray(result)).toBe(true);
    if (isLaterArray(result)) {
      // LaterArray preserves element structure
      expect(result.elements.length).toBe(3);
      expect(isNow(result.elements[0])).toBe(true);
      expect(isLater(result.elements[1])).toBe(true);
      expect(isNow(result.elements[2])).toBe(true);
    }
  });

  it("index on Now array with Now index is Now", () => {
    const result = stage(index(array(num(10), num(20)), num(1))).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(20);
    }
  });

  it("index with Later index is Later", () => {
    const result = stage(
      index(array(num(10), num(20)), runtime(num(0), "i"))
    ).svalue;
    expect(isLater(result)).toBe(true);
  });
});

describe("Partial Evaluation Examples", () => {
  it("constant folding through let bindings", () => {
    const result = stage(
      letExpr(
        "a",
        num(2),
        letExpr("b", num(3), add(mul(varRef("a"), varRef("b")), num(1)))
      )
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(7);
    }
  });

  it("partial evaluation with runtime input", () => {
    const result = stage(
      letExpr(
        "multiplier",
        num(2),
        letExpr(
          "x",
          runtime(num(5), "input"),
          mul(varRef("multiplier"), varRef("x"))
        )
      )
    ).svalue;

    expect(isLater(result)).toBe(true);
    if (isLater(result)) {
      const residual = exprToString(result.residual);
      expect(residual.includes("2") && residual.includes("input")).toBe(true);
    }
  });

  it("dead code elimination via known condition", () => {
    const result = stage(
      letExpr(
        "debug",
        bool(false),
        ifExpr(varRef("debug"), varRef("expensive"), num(42))
      )
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
  });

  it("type-directed specialization", () => {
    const result = stage(
      letExpr(
        "shape",
        obj({ kind: str("circle"), radius: num(5) }),
        ifExpr(
          eq(field(varRef("shape"), "kind"), str("circle")),
          field(varRef("shape"), "radius"),
          num(0)
        )
      )
    ).svalue;
    expect(isNow(result)).toBe(true);
    if (isNow(result) && result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
  });
});

// ============================================================================
// Additional Staging Tests from Design Exploration
// ============================================================================

describe("Comptime Enforcement", () => {
  it("comptime on literal succeeds", () => {
    const expr = comptime(num(5));
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
  });

  it("comptime on pure computation succeeds", () => {
    const expr = comptime(add(num(2), num(3)));
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect((result.svalue.value as any).value).toBe(5);
    }
  });

  it("comptime on runtime value fails", () => {
    const expr = comptime(runtime(num(5), "x"));
    expect(() => stage(expr)).toThrow();
  });
});

describe("Staging Boundary Issues", () => {
  it("comptime field access on runtime object with known constraint succeeds", () => {
    // When the constraint has field info (from the literal), comptime can extract it
    const expr = letExpr("obj", runtime(obj({ x: num(5) }), "obj"),
      comptime(field(varRef("obj"), "x"))
    );
    const result = stage(expr);
    expect(result.svalue.stage).toBe("now");
    expect((result.svalue as any).value.value).toBe(5);
  });

  it("comptime field access on runtime object without constraint info fails", () => {
    // When the constraint doesn't have the field value, comptime fails
    // Use trust to give object type without specific field value
    const expr = parse(`
      let obj = trust(runtime(o: { x: 5 }), { x: number }) in
      comptime(obj.x)
    `);
    expect(() => stage(expr)).toThrow();
  });

  it("runtime nested in comptime fails", () => {
    const expr = comptime(add(runtime(num(1), "x"), num(2)));
    expect(() => stage(expr)).toThrow();
  });
});

describe("typeof Operator (not yet implemented)", () => {
  it("should have typeof builtin for getting type of expression", () => {
    expect(() => {
      stage(call(varRef("typeof"), num(5)));
    }).toThrow();
  });
});

// ============================================================================
// Args Array Binding (Body-Based Type Derivation Foundation)
// ============================================================================

describe("Args Array Binding", () => {
  it("can access args[0] to get first argument", () => {
    // fn(x, y) => args[0] should return first argument
    const expr = letExpr("f", fn(["x", "y"], index(varRef("args"), num(0))),
      call(varRef("f"), num(5), num(10))
    );
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect((result.svalue.value as any).value).toBe(5);
    }
  });

  it("can access args[1] to get second argument", () => {
    // fn(x, y) => args[1] should return second argument
    const expr = letExpr("f", fn(["x", "y"], index(varRef("args"), num(1))),
      call(varRef("f"), num(5), num(10))
    );
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect((result.svalue.value as any).value).toBe(10);
    }
  });

  it("args has correct length constraint", () => {
    // fn(x, y) => args should have length 2
    const expr = letExpr("f", fn(["x", "y"], varRef("args")),
      call(varRef("f"), num(5), num(10))
    );
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect((result.svalue.value as any).elements.length).toBe(2);
    }
  });

  it("args works with runtime arguments", () => {
    // fn(x) => args[0] with runtime argument should produce Later
    const expr = letExpr("f", fn(["x"], index(varRef("args"), num(0))),
      call(varRef("f"), runtime(num(5), "x"))
    );
    const result = stage(expr);
    // Result should be Later since argument is Later
    expect(isLater(result.svalue)).toBe(true);
  });

  it("args coexists with named parameters", () => {
    // fn(x) => x + args[0] should both work
    const expr = letExpr("f", fn(["x"], add(varRef("x"), index(varRef("args"), num(0)))),
      call(varRef("f"), num(5))
    );
    const result = stage(expr);
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      // x + args[0] = 5 + 5 = 10
      expect((result.svalue.value as any).value).toBe(10);
    }
  });
});
