/**
 * Tests for the pure interpreter with constraints-as-types.
 */
import { describe, it, expect } from "vitest";

import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isObject,
  isArray,
  isFunction,
  and,
  or,
  equals,
  gt,
  gte,
  lt,
  lte,
  hasField,
  implies,
  simplify,
  unify,
  narrowOr,
  isNever,
  constraintToString,

  // Values
  valueToString,
  constraintOf,
  numberVal,

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
  ltExpr,
  gtExpr,
  eq,
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
  exprToString,

  // Evaluator
  run,
  runValue,
  TypeError,
} from "../src/index";

describe("Constraint Tests", () => {
  it("simplify flattens nested ANDs", () => {
    const c = and(and(isNumber, gt(0)), gt(5));
    const s = simplify(c);
    expect(s.tag).toBe("and");
    if (s.tag === "and") {
      expect(s.constraints.length).toBe(3);
    }
  });

  it("simplify detects contradiction: isNumber AND isString", () => {
    const c = and(isNumber, isString);
    const s = simplify(c);
    expect(isNever(s)).toBe(true);
  });

  it("simplify detects contradiction: equals(5) AND equals(6)", () => {
    const c = and(equals(5), equals(6));
    const s = simplify(c);
    expect(isNever(s)).toBe(true);
  });

  it("simplify detects contradiction: equals(5) AND gt(10)", () => {
    const c = and(equals(5), gt(10));
    const s = simplify(c);
    expect(isNever(s)).toBe(true);
  });

  it("implies: equals(5) implies isNumber", () => {
    expect(implies(equals(5), isNumber)).toBe(true);
  });

  it("implies: and(isNumber, equals(5)) implies isNumber", () => {
    expect(implies(and(isNumber, equals(5)), isNumber)).toBe(true);
  });

  it("implies: isNumber does not imply equals(5)", () => {
    expect(implies(isNumber, equals(5))).toBe(false);
  });

  it("implies: and(isObject, hasField) implies isObject", () => {
    const objType = and(isObject, hasField("x", isNumber));
    expect(implies(objType, isObject)).toBe(true);
  });

  it("implies: gt(10) implies gt(5)", () => {
    expect(implies(gt(10), gt(5))).toBe(true);
  });

  it("implies: gt(5) does not imply gt(10)", () => {
    expect(implies(gt(5), gt(10))).toBe(false);
  });

  it("unify combines constraints", () => {
    const result = unify(isNumber, gt(0));
    expect(result.tag).toBe("and");
    if (result.tag === "and") {
      expect(result.constraints.some((c) => c.tag === "isNumber")).toBe(true);
      expect(
        result.constraints.some((c) => c.tag === "gt" && c.bound === 0)
      ).toBe(true);
    }
  });

  it("unify detects contradictions", () => {
    const result = unify(isNumber, isString);
    expect(isNever(result)).toBe(true);
  });
});

describe("Literal Evaluation Tests", () => {
  it("evaluate number literal", () => {
    const result = run(num(42));
    expect(result.value.tag).toBe("number");
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
    expect(implies(result.constraint, isNumber)).toBe(true);
    expect(implies(result.constraint, equals(42))).toBe(true);
  });

  it("evaluate string literal", () => {
    const result = run(str("hello"));
    expect(result.value.tag).toBe("string");
    if (result.value.tag === "string") {
      expect(result.value.value).toBe("hello");
    }
    expect(implies(result.constraint, isString)).toBe(true);
  });

  it("evaluate boolean literal", () => {
    const result = run(bool(true));
    expect(result.value.tag).toBe("bool");
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(true);
    }
    expect(implies(result.constraint, isBool)).toBe(true);
  });

  it("evaluate null literal", () => {
    const result = run(nil);
    expect(result.value.tag).toBe("null");
  });
});

describe("Arithmetic Tests", () => {
  it("evaluate addition", () => {
    const result = run(add(num(1), num(2)));
    expect(result.value.tag).toBe("number");
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(3);
    }
  });

  it("evaluate subtraction", () => {
    const result = run(sub(num(5), num(3)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(2);
    }
  });

  it("evaluate multiplication", () => {
    const result = run(mul(num(4), num(5)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(20);
    }
  });

  it("evaluate division", () => {
    const result = run(div(num(10), num(2)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
  });

  it("evaluate negation", () => {
    const result = run(neg(num(5)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(-5);
    }
  });

  it("constraint propagation for arithmetic", () => {
    const result = run(add(num(2), num(3)));
    expect(implies(result.constraint, equals(5))).toBe(true);
  });

  it("type error: add string to number", () => {
    expect(() => run(add(num(1), str("hello")))).toThrow("Type error");
  });
});

describe("Comparison Tests", () => {
  it("evaluate less than (true)", () => {
    const result = run(ltExpr(num(1), num(2)));
    expect(result.value.tag).toBe("bool");
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(true);
    }
  });

  it("evaluate less than (false)", () => {
    const result = run(ltExpr(num(3), num(2)));
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(false);
    }
  });

  it("evaluate equality", () => {
    const result = run(eq(num(5), num(5)));
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(true);
    }
  });
});

describe("Logical Tests", () => {
  it("evaluate AND", () => {
    const result = run(andExpr(bool(true), bool(false)));
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(false);
    }
  });

  it("evaluate OR", () => {
    const result = run(orExpr(bool(true), bool(false)));
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(true);
    }
  });

  it("evaluate NOT", () => {
    const result = run(notExpr(bool(true)));
    if (result.value.tag === "bool") {
      expect(result.value.value).toBe(false);
    }
  });
});

describe("Control Flow Tests", () => {
  it("evaluate if (then branch)", () => {
    const result = run(ifExpr(bool(true), num(1), num(2)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(1);
    }
  });

  it("evaluate if (else branch)", () => {
    const result = run(ifExpr(bool(false), num(1), num(2)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(2);
    }
  });

  it("type error: non-boolean condition", () => {
    expect(() => run(ifExpr(num(1), num(2), num(3)))).toThrow("Type error");
  });
});

describe("Let Binding Tests", () => {
  it("evaluate let binding", () => {
    const result = run(letExpr("x", num(5), add(varRef("x"), num(1))));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(6);
    }
  });

  it("evaluate nested let bindings", () => {
    const result = run(
      letExpr(
        "x",
        num(5),
        letExpr("y", num(3), add(varRef("x"), varRef("y")))
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(8);
    }
  });

  it("let binding preserves constraint", () => {
    const result = run(letExpr("x", num(5), varRef("x")));
    expect(implies(result.constraint, equals(5))).toBe(true);
  });
});

describe("Function Tests", () => {
  it("evaluate function definition", () => {
    const result = run(fn(["x"], varRef("x")));
    expect(result.value.tag).toBe("closure");
    expect(implies(result.constraint, isFunction)).toBe(true);
  });

  it("evaluate function call", () => {
    const result = run(call(fn(["x"], add(varRef("x"), num(1))), num(5)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(6);
    }
  });

  it("evaluate multi-argument function", () => {
    const result = run(
      call(fn(["x", "y"], add(varRef("x"), varRef("y"))), num(3), num(4))
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(7);
    }
  });

  it("evaluate higher-order function", () => {
    const result = run(
      letExpr(
        "add",
        fn(["x"], fn(["y"], add(varRef("x"), varRef("y")))),
        call(call(varRef("add"), num(3)), num(4))
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(7);
    }
  });

  it("closure captures environment", () => {
    const result = run(
      letExpr(
        "x",
        num(10),
        letExpr(
          "f",
          fn(["y"], add(varRef("x"), varRef("y"))),
          call(varRef("f"), num(5))
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(15);
    }
  });
});

describe("Object Tests", () => {
  it("evaluate object literal", () => {
    const result = run(obj({ x: num(1), y: num(2) }));
    expect(result.value.tag).toBe("object");
    expect(implies(result.constraint, isObject)).toBe(true);
    expect(implies(result.constraint, hasField("x", isNumber))).toBe(true);
    expect(implies(result.constraint, hasField("y", isNumber))).toBe(true);
  });

  it("evaluate field access", () => {
    const result = run(field(obj({ x: num(42), y: num(10) }), "x"));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
  });

  it("field access preserves constraint", () => {
    const result = run(field(obj({ x: num(42) }), "x"));
    expect(implies(result.constraint, equals(42))).toBe(true);
  });

  it("error on missing field", () => {
    expect(() => run(field(obj({ x: num(1) }), "y"))).toThrow("no field");
  });
});

describe("Array Tests", () => {
  it("evaluate array literal", () => {
    const result = run(array(num(1), num(2), num(3)));
    expect(result.value.tag).toBe("array");
    expect(implies(result.constraint, isArray)).toBe(true);
  });

  it("evaluate array index", () => {
    const result = run(index(array(num(10), num(20), num(30)), num(1)));
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(20);
    }
  });

  it("array index preserves element constraint", () => {
    const result = run(index(array(num(42)), num(0)));
    expect(implies(result.constraint, equals(42))).toBe(true);
  });

  it("error on out of bounds index", () => {
    expect(() => run(index(array(num(1)), num(5)))).toThrow("out of bounds");
  });
});

describe("Complex Expression Tests", () => {
  it("factorial-like computation", () => {
    const result = run(
      letExpr(
        "a",
        num(5),
        letExpr(
          "b",
          num(4),
          letExpr(
            "c",
            num(3),
            letExpr(
              "d",
              num(2),
              letExpr(
                "e",
                num(1),
                mul(
                  varRef("a"),
                  mul(
                    varRef("b"),
                    mul(varRef("c"), mul(varRef("d"), varRef("e")))
                  )
                )
              )
            )
          )
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(120);
    }
  });

  it("nested object access", () => {
    const result = run(
      field(field(obj({ inner: obj({ x: num(42) }) }), "inner"), "x")
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
  });

  it("function returning object", () => {
    const result = run(
      field(call(fn(["x"], obj({ value: varRef("x") })), num(42)), "value")
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
  });
});

describe("Control Flow Refinement Tests", () => {
  it("refinement: x > 0 in then branch", () => {
    const result = run(
      letExpr(
        "x",
        num(5),
        ifExpr(gtExpr(varRef("x"), num(0)), varRef("x"), num(0))
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
    expect(implies(result.constraint, gt(0))).toBe(true);
  });

  it("refinement: x <= 0 in else branch", () => {
    const result = run(
      letExpr(
        "x",
        num(-5),
        ifExpr(gtExpr(varRef("x"), num(0)), num(0), varRef("x"))
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(-5);
    }
    expect(implies(result.constraint, lte(0))).toBe(true);
  });

  it("refinement: x == 5 narrows to literal", () => {
    const result = run(
      letExpr(
        "x",
        num(5),
        ifExpr(eq(varRef("x"), num(5)), varRef("x"), num(0))
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
    expect(implies(result.constraint, equals(5))).toBe(true);
  });

  it("refinement: compound condition (x > 0 && x < 10)", () => {
    const result = run(
      letExpr(
        "x",
        num(5),
        ifExpr(
          andExpr(gtExpr(varRef("x"), num(0)), ltExpr(varRef("x"), num(10))),
          varRef("x"),
          num(0)
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
    expect(implies(result.constraint, gt(0))).toBe(true);
    expect(implies(result.constraint, lt(10))).toBe(true);
  });

  it("refinement: negation (!condition) in else acts like then", () => {
    const result = run(
      letExpr(
        "x",
        num(-1),
        ifExpr(notExpr(gtExpr(varRef("x"), num(0))), varRef("x"), num(0))
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(-1);
    }
    expect(implies(result.constraint, lte(0))).toBe(true);
  });

  it("refinement: nested if maintains outer refinements", () => {
    const result = run(
      letExpr(
        "x",
        num(5),
        ifExpr(
          gtExpr(varRef("x"), num(0)),
          ifExpr(ltExpr(varRef("x"), num(10)), varRef("x"), num(0)),
          num(0)
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
    expect(implies(result.constraint, gt(0))).toBe(true);
    expect(implies(result.constraint, lt(10))).toBe(true);
  });

  it("refinement preserved through function call", () => {
    const result = run(
      letExpr(
        "f",
        fn(["x"], varRef("x")),
        letExpr(
          "y",
          num(5),
          ifExpr(
            gtExpr(varRef("y"), num(0)),
            call(varRef("f"), varRef("y")),
            num(0)
          )
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
    expect(implies(result.constraint, gt(0))).toBe(true);
  });
});

describe("Discriminated Union Tests", () => {
  it("discriminated union: field equality narrows type", () => {
    const result = run(
      letExpr(
        "shape",
        obj({ kind: str("circle"), radius: num(5) }),
        ifExpr(
          eq(field(varRef("shape"), "kind"), str("circle")),
          field(varRef("shape"), "radius"),
          num(0)
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(5);
    }
    expect(implies(result.constraint, equals(5))).toBe(true);
  });

  it("discriminated union: narrowOr eliminates contradictory branches", () => {
    const circle = and(isObject, hasField("kind", equals("circle")));
    const square = and(isObject, hasField("kind", equals("square")));
    const union = or(circle, square);
    const narrowed = narrowOr(union, hasField("kind", equals("circle")));

    expect(implies(narrowed, hasField("kind", equals("square")))).toBe(false);
    expect(implies(narrowed, hasField("kind", equals("circle")))).toBe(true);
  });

  it("discriminated union: else branch narrows to other variant", () => {
    const result = run(
      letExpr(
        "shape",
        obj({ kind: str("square"), side: num(10) }),
        ifExpr(
          eq(field(varRef("shape"), "kind"), str("circle")),
          num(0),
          field(varRef("shape"), "side")
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(10);
    }
  });

  it("discriminated union: access correct field after narrowing", () => {
    const result = run(
      letExpr(
        "shape",
        obj({ kind: str("circle"), radius: num(7) }),
        ifExpr(
          eq(field(varRef("shape"), "kind"), str("circle")),
          mul(field(varRef("shape"), "radius"), num(2)),
          num(0)
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(14);
    }
  });

  it("discriminated union: nested field access with narrowing", () => {
    const result = run(
      letExpr(
        "data",
        obj({ type: str("success"), value: obj({ x: num(42) }) }),
        ifExpr(
          eq(field(varRef("data"), "type"), str("success")),
          field(field(varRef("data"), "value"), "x"),
          num(0)
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(42);
    }
  });

  it("discriminated union: boolean discriminant", () => {
    const result = run(
      letExpr(
        "result",
        obj({ ok: bool(true), data: num(100) }),
        ifExpr(
          eq(field(varRef("result"), "ok"), bool(true)),
          field(varRef("result"), "data"),
          num(0)
        )
      )
    );
    if (result.value.tag === "number") {
      expect(result.value.value).toBe(100);
    }
  });

  it("discriminated union: number discriminant", () => {
    const result = run(
      letExpr(
        "msg",
        obj({ code: num(200), body: str("ok") }),
        ifExpr(
          eq(field(varRef("msg"), "code"), num(200)),
          field(varRef("msg"), "body"),
          str("error")
        )
      )
    );
    if (result.value.tag === "string") {
      expect(result.value.value).toBe("ok");
    }
  });
});

// ============================================================================
// Tuples and Element Access
// From docs/constraints-as-types.md: Tuples use elementAt for position-specific types
// ============================================================================

import { elementAt, length as lengthC, runtime } from "../src/index";
import { stage, isLater } from "../src/index";

describe("Tuples and Element Access", () => {
  describe("Tuple constraints", () => {
    it("array with mixed types has elementAt constraints", () => {
      const expr = array(str("hello"), num(42), bool(true));
      const result = run(expr);

      expect(implies(result.constraint, isArray)).toBe(true);
      expect(implies(result.constraint, elementAt(0, isString))).toBe(true);
      expect(implies(result.constraint, elementAt(1, isNumber))).toBe(true);
      expect(implies(result.constraint, elementAt(2, isBool))).toBe(true);
    });

    it("accessing tuple with known index gives precise type", () => {
      const expr = index(array(str("hello"), num(42)), num(0));
      const result = run(expr);
      expect(result.value.tag).toBe("string");
      expect(implies(result.constraint, isString)).toBe(true);
    });

    it("accessing tuple with unknown runtime index should give union", () => {
      const expr = letExpr("t", array(str("hello"), num(42)),
        index(varRef("t"), runtime(num(0), "i"))
      );
      const result = stage(expr);

      if (isLater(result.svalue)) {
        const constraint = result.svalue.constraint;
        expect(constraint).toBeDefined();
      }
    });
  });

  describe("Length constraints", () => {
    it("array literal has known length constraint", () => {
      const expr = array(num(1), num(2), num(3));
      const result = run(expr);
      expect(implies(result.constraint, lengthC(equals(3)))).toBe(true);
    });

    it("empty array has length 0", () => {
      const expr = array();
      const result = run(expr);
      expect(implies(result.constraint, lengthC(equals(0)))).toBe(true);
    });
  });
});

describe("String Concatenation", () => {
  it("string + string concatenation works (+ is polymorphic)", () => {
    const expr = add(str("hello"), str(" world"));
    const result = run(expr);
    expect(result.value.tag).toBe("string");
    expect((result.value as any).value).toBe("hello world");
  });
});
