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
  StagingError,
  resetVarCounter,
} from "../src/index";

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
  it("function definition is Now", () => {
    const result = stage(fn(["x"], add(varRef("x"), num(1)))).svalue;
    expect(isNow(result)).toBe(true);
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

  it("array with Later element is Later", () => {
    const result = stage(array(num(1), runtime(num(2), "x"), num(3))).svalue;
    expect(isLater(result)).toBe(true);
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
