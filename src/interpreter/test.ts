/**
 * Tests for the pure interpreter with constraints-as-types.
 */

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
} from "./index";

// ============================================================================
// Test Helpers
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message ? message + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message ?? "Expected true");
  }
}

function assertThrows(fn: () => void, expectedMessage?: string): void {
  try {
    fn();
    throw new Error("Expected function to throw");
  } catch (e) {
    if (expectedMessage && !(e as Error).message.includes(expectedMessage)) {
      throw new Error(
        `Expected error containing "${expectedMessage}", got "${(e as Error).message}"`
      );
    }
  }
}

// ============================================================================
// Constraint Tests
// ============================================================================

console.log("\nConstraint Tests:");

test("simplify flattens nested ANDs", () => {
  const c = and(and(isNumber, gt(0)), gt(5));
  const s = simplify(c);
  // Should be and(isNumber, gt(0), gt(5)) - flattened
  assertTrue(s.tag === "and");
  if (s.tag === "and") {
    assertEqual(s.constraints.length, 3);
  }
});

test("simplify detects contradiction: isNumber AND isString", () => {
  const c = and(isNumber, isString);
  const s = simplify(c);
  assertTrue(isNever(s), "should be never");
});

test("simplify detects contradiction: equals(5) AND equals(6)", () => {
  const c = and(equals(5), equals(6));
  const s = simplify(c);
  assertTrue(isNever(s), "should be never");
});

test("simplify detects contradiction: equals(5) AND gt(10)", () => {
  const c = and(equals(5), gt(10));
  const s = simplify(c);
  assertTrue(isNever(s), "should be never");
});

test("implies: equals(5) implies isNumber", () => {
  assertTrue(implies(equals(5), isNumber));
});

test("implies: and(isNumber, equals(5)) implies isNumber", () => {
  assertTrue(implies(and(isNumber, equals(5)), isNumber));
});

test("implies: isNumber does not imply equals(5)", () => {
  assertTrue(!implies(isNumber, equals(5)));
});

test("implies: and(isObject, hasField) implies isObject", () => {
  const objType = and(isObject, hasField("x", isNumber));
  assertTrue(implies(objType, isObject));
});

test("implies: gt(10) implies gt(5)", () => {
  assertTrue(implies(gt(10), gt(5)));
});

test("implies: gt(5) does not imply gt(10)", () => {
  assertTrue(!implies(gt(5), gt(10)));
});

test("unify combines constraints", () => {
  const result = unify(isNumber, gt(0));
  assertTrue(result.tag === "and");
  if (result.tag === "and") {
    assertTrue(result.constraints.some(c => c.tag === "isNumber"));
    assertTrue(result.constraints.some(c => c.tag === "gt" && c.bound === 0));
  }
});

test("unify detects contradictions", () => {
  const result = unify(isNumber, isString);
  assertTrue(isNever(result));
});

// ============================================================================
// Literal Evaluation Tests
// ============================================================================

console.log("\nLiteral Evaluation Tests:");

test("evaluate number literal", () => {
  const result = run(num(42));
  assertEqual(result.value.tag, "number");
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
  assertTrue(implies(result.constraint, isNumber));
  assertTrue(implies(result.constraint, equals(42)));
});

test("evaluate string literal", () => {
  const result = run(str("hello"));
  assertEqual(result.value.tag, "string");
  if (result.value.tag === "string") {
    assertEqual(result.value.value, "hello");
  }
  assertTrue(implies(result.constraint, isString));
});

test("evaluate boolean literal", () => {
  const result = run(bool(true));
  assertEqual(result.value.tag, "bool");
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, true);
  }
  assertTrue(implies(result.constraint, isBool));
});

test("evaluate null literal", () => {
  const result = run(nil);
  assertEqual(result.value.tag, "null");
});

// ============================================================================
// Arithmetic Tests
// ============================================================================

console.log("\nArithmetic Tests:");

test("evaluate addition", () => {
  const result = run(add(num(1), num(2)));
  assertEqual(result.value.tag, "number");
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 3);
  }
});

test("evaluate subtraction", () => {
  const result = run(sub(num(5), num(3)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 2);
  }
});

test("evaluate multiplication", () => {
  const result = run(mul(num(4), num(5)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 20);
  }
});

test("evaluate division", () => {
  const result = run(div(num(10), num(2)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
});

test("evaluate negation", () => {
  const result = run(neg(num(5)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, -5);
  }
});

test("constraint propagation for arithmetic", () => {
  // 2 + 3 should have constraint and(isNumber, equals(5))
  const result = run(add(num(2), num(3)));
  assertTrue(implies(result.constraint, equals(5)));
});

test("type error: add string to number", () => {
  assertThrows(() => run(add(num(1), str("hello"))), "Type error");
});

// ============================================================================
// Comparison Tests
// ============================================================================

console.log("\nComparison Tests:");

test("evaluate less than (true)", () => {
  const result = run(ltExpr(num(1), num(2)));
  assertEqual(result.value.tag, "bool");
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, true);
  }
});

test("evaluate less than (false)", () => {
  const result = run(ltExpr(num(3), num(2)));
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, false);
  }
});

test("evaluate equality", () => {
  const result = run(eq(num(5), num(5)));
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, true);
  }
});

// ============================================================================
// Logical Tests
// ============================================================================

console.log("\nLogical Tests:");

test("evaluate AND", () => {
  const result = run(andExpr(bool(true), bool(false)));
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, false);
  }
});

test("evaluate OR", () => {
  const result = run(orExpr(bool(true), bool(false)));
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, true);
  }
});

test("evaluate NOT", () => {
  const result = run(notExpr(bool(true)));
  if (result.value.tag === "bool") {
    assertEqual(result.value.value, false);
  }
});

// ============================================================================
// Control Flow Tests
// ============================================================================

console.log("\nControl Flow Tests:");

test("evaluate if (then branch)", () => {
  const result = run(ifExpr(bool(true), num(1), num(2)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 1);
  }
});

test("evaluate if (else branch)", () => {
  const result = run(ifExpr(bool(false), num(1), num(2)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 2);
  }
});

test("type error: non-boolean condition", () => {
  assertThrows(() => run(ifExpr(num(1), num(2), num(3))), "Type error");
});

// ============================================================================
// Let Binding Tests
// ============================================================================

console.log("\nLet Binding Tests:");

test("evaluate let binding", () => {
  // let x = 5 in x + 1
  const result = run(letExpr("x", num(5), add(varRef("x"), num(1))));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 6);
  }
});

test("evaluate nested let bindings", () => {
  // let x = 5 in let y = 3 in x + y
  const result = run(
    letExpr("x", num(5),
      letExpr("y", num(3),
        add(varRef("x"), varRef("y"))
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 8);
  }
});

test("let binding preserves constraint", () => {
  // let x = 5 in x
  const result = run(letExpr("x", num(5), varRef("x")));
  assertTrue(implies(result.constraint, equals(5)));
});

// ============================================================================
// Function Tests
// ============================================================================

console.log("\nFunction Tests:");

test("evaluate function definition", () => {
  // fn(x) => x
  const result = run(fn(["x"], varRef("x")));
  assertEqual(result.value.tag, "closure");
  assertTrue(implies(result.constraint, isFunction));
});

test("evaluate function call", () => {
  // (fn(x) => x + 1)(5)
  const result = run(call(fn(["x"], add(varRef("x"), num(1))), num(5)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 6);
  }
});

test("evaluate multi-argument function", () => {
  // (fn(x, y) => x + y)(3, 4)
  const result = run(
    call(fn(["x", "y"], add(varRef("x"), varRef("y"))), num(3), num(4))
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 7);
  }
});

test("evaluate higher-order function", () => {
  // let add = fn(x) => fn(y) => x + y in add(3)(4)
  const result = run(
    letExpr("add",
      fn(["x"], fn(["y"], add(varRef("x"), varRef("y")))),
      call(call(varRef("add"), num(3)), num(4))
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 7);
  }
});

test("closure captures environment", () => {
  // let x = 10 in let f = fn(y) => x + y in f(5)
  const result = run(
    letExpr("x", num(10),
      letExpr("f", fn(["y"], add(varRef("x"), varRef("y"))),
        call(varRef("f"), num(5))
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 15);
  }
});

// ============================================================================
// Object Tests
// ============================================================================

console.log("\nObject Tests:");

test("evaluate object literal", () => {
  const result = run(obj({ x: num(1), y: num(2) }));
  assertEqual(result.value.tag, "object");
  assertTrue(implies(result.constraint, isObject));
  assertTrue(implies(result.constraint, hasField("x", isNumber)));
  assertTrue(implies(result.constraint, hasField("y", isNumber)));
});

test("evaluate field access", () => {
  const result = run(field(obj({ x: num(42), y: num(10) }), "x"));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
});

test("field access preserves constraint", () => {
  const result = run(field(obj({ x: num(42) }), "x"));
  assertTrue(implies(result.constraint, equals(42)));
});

test("error on missing field", () => {
  assertThrows(() => run(field(obj({ x: num(1) }), "y")), "no field");
});

// ============================================================================
// Array Tests
// ============================================================================

console.log("\nArray Tests:");

test("evaluate array literal", () => {
  const result = run(array(num(1), num(2), num(3)));
  assertEqual(result.value.tag, "array");
  assertTrue(implies(result.constraint, isArray));
});

test("evaluate array index", () => {
  const result = run(index(array(num(10), num(20), num(30)), num(1)));
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 20);
  }
});

test("array index preserves element constraint", () => {
  const result = run(index(array(num(42)), num(0)));
  assertTrue(implies(result.constraint, equals(42)));
});

test("error on out of bounds index", () => {
  assertThrows(() => run(index(array(num(1)), num(5))), "out of bounds");
});

// ============================================================================
// Complex Expression Tests
// ============================================================================

console.log("\nComplex Expression Tests:");

test("factorial-like computation", () => {
  // Using let bindings to simulate: 5 * 4 * 3 * 2 * 1
  const result = run(
    letExpr("a", num(5),
      letExpr("b", num(4),
        letExpr("c", num(3),
          letExpr("d", num(2),
            letExpr("e", num(1),
              mul(varRef("a"),
                mul(varRef("b"),
                  mul(varRef("c"),
                    mul(varRef("d"), varRef("e"))
                  )
                )
              )
            )
          )
        )
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 120);
  }
});

test("nested object access", () => {
  // { inner: { x: 42 } }.inner.x
  const result = run(
    field(
      field(
        obj({ inner: obj({ x: num(42) }) }),
        "inner"
      ),
      "x"
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
});

test("function returning object", () => {
  // (fn(x) => { value: x })(42).value
  const result = run(
    field(
      call(fn(["x"], obj({ value: varRef("x") })), num(42)),
      "value"
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
});

// ============================================================================
// Control Flow Refinement Tests
// ============================================================================

console.log("\nControl Flow Refinement Tests:");

test("refinement: x > 0 in then branch", () => {
  // let x = 5 in if (x > 0) then x else 0
  // In the then branch, x should have constraint gt(0) added
  const result = run(
    letExpr("x", num(5),
      ifExpr(
        gtExpr(varRef("x"), num(0)),
        varRef("x"),  // then: x has gt(0)
        num(0)        // else
      )
    )
  );
  // Result is 5, and constraint should include gt(0)
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
  assertTrue(implies(result.constraint, gt(0)), "should have gt(0) constraint");
});

test("refinement: x <= 0 in else branch", () => {
  // let x = -5 in if (x > 0) then 0 else x
  // In the else branch, x should have constraint lte(0)
  const result = run(
    letExpr("x", num(-5),
      ifExpr(
        gtExpr(varRef("x"), num(0)),
        num(0),       // then
        varRef("x")   // else: x has lte(0)
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, -5);
  }
  assertTrue(implies(result.constraint, lte(0)), "should have lte(0) constraint");
});

test("refinement: x == 5 narrows to literal", () => {
  // let x = 5 in if (x == 5) then x else 0
  const result = run(
    letExpr("x", num(5),
      ifExpr(
        eq(varRef("x"), num(5)),
        varRef("x"),  // then: x has equals(5)
        num(0)
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
  assertTrue(implies(result.constraint, equals(5)), "should have equals(5) constraint");
});

test("refinement: compound condition (x > 0 && x < 10)", () => {
  // let x = 5 in if (x > 0 && x < 10) then x else 0
  const result = run(
    letExpr("x", num(5),
      ifExpr(
        andExpr(gtExpr(varRef("x"), num(0)), ltExpr(varRef("x"), num(10))),
        varRef("x"),  // then: x has gt(0) AND lt(10)
        num(0)
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
  assertTrue(implies(result.constraint, gt(0)), "should have gt(0)");
  assertTrue(implies(result.constraint, lt(10)), "should have lt(10)");
});

test("refinement: negation (!condition) in else acts like then", () => {
  // Testing that !(x > 0) in then branch means x <= 0
  // let x = -1 in if (!(x > 0)) then x else 0
  const result = run(
    letExpr("x", num(-1),
      ifExpr(
        notExpr(gtExpr(varRef("x"), num(0))),
        varRef("x"),  // then: !(x > 0) means x <= 0
        num(0)
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, -1);
  }
  assertTrue(implies(result.constraint, lte(0)), "should have lte(0) from negated condition");
});

test("refinement: nested if maintains outer refinements", () => {
  // let x = 5 in if (x > 0) then (if (x < 10) then x else 0) else 0
  const result = run(
    letExpr("x", num(5),
      ifExpr(
        gtExpr(varRef("x"), num(0)),
        ifExpr(
          ltExpr(varRef("x"), num(10)),
          varRef("x"),  // x has gt(0) from outer, lt(10) from inner
          num(0)
        ),
        num(0)
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
  assertTrue(implies(result.constraint, gt(0)), "should have gt(0) from outer if");
  assertTrue(implies(result.constraint, lt(10)), "should have lt(10) from inner if");
});

test("refinement preserved through function call", () => {
  // let f = fn(x) => x in let y = 5 in if (y > 0) then f(y) else 0
  // The refinement on y should be passed to f and preserved
  const result = run(
    letExpr("f", fn(["x"], varRef("x")),
      letExpr("y", num(5),
        ifExpr(
          gtExpr(varRef("y"), num(0)),
          call(varRef("f"), varRef("y")),
          num(0)
        )
      )
    )
  );
  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
  // The identity function preserves its input constraint
  assertTrue(implies(result.constraint, gt(0)), "refinement should pass through identity function");
});

// ============================================================================
// Discriminated Union Tests
// ============================================================================

console.log("\nDiscriminated Union Tests:");

test("discriminated union: field equality narrows type", () => {
  // Circle type: { kind: "circle", radius: number }
  // Square type: { kind: "square", side: number }
  // Shape = Circle | Square
  const circleType = and(isObject, hasField("kind", equals("circle")), hasField("radius", isNumber));
  const squareType = and(isObject, hasField("kind", equals("square")), hasField("side", isNumber));
  const shapeType = or(circleType, squareType);

  // let shape = { kind: "circle", radius: 5 } in
  // if (shape.kind == "circle") then shape.radius else 0
  const result = run(
    letExpr("shape", obj({ kind: str("circle"), radius: num(5) }),
      ifExpr(
        eq(field(varRef("shape"), "kind"), str("circle")),
        field(varRef("shape"), "radius"),  // should have radius since we know it's a circle
        num(0)
      )
    )
  );

  if (result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
  assertTrue(implies(result.constraint, equals(5)), "should know radius is 5");
});

test("discriminated union: narrowOr eliminates contradictory branches", () => {
  // Circle: hasField("kind", equals("circle"))
  // Square: hasField("kind", equals("square"))
  const circle = and(isObject, hasField("kind", equals("circle")));
  const square = and(isObject, hasField("kind", equals("square")));
  const union = or(circle, square);

  // Narrow with hasField("kind", equals("circle")) should eliminate square branch
  const narrowed = narrowOr(union, hasField("kind", equals("circle")));

  // Result should NOT imply hasField("kind", equals("square"))
  assertTrue(!implies(narrowed, hasField("kind", equals("square"))),
    "should not have square after narrowing to circle");
  // Result SHOULD imply hasField("kind", equals("circle"))
  assertTrue(implies(narrowed, hasField("kind", equals("circle"))),
    "should have circle after narrowing");
});

test("discriminated union: else branch narrows to other variant", () => {
  // let shape = { kind: "square", side: 10 } in
  // if (shape.kind == "circle") then 0 else shape.side
  const result = run(
    letExpr("shape", obj({ kind: str("square"), side: num(10) }),
      ifExpr(
        eq(field(varRef("shape"), "kind"), str("circle")),
        num(0),  // then: shape is circle (but we won't take this branch)
        field(varRef("shape"), "side")  // else: shape is NOT circle (so square)
      )
    )
  );

  if (result.value.tag === "number") {
    assertEqual(result.value.value, 10);
  }
});

test("discriminated union: access correct field after narrowing", () => {
  // Complex example with different fields per variant
  // let shape = { kind: "circle", radius: 7 } in
  // if (shape.kind == "circle") then shape.radius * 2 else 0
  const result = run(
    letExpr("shape", obj({ kind: str("circle"), radius: num(7) }),
      ifExpr(
        eq(field(varRef("shape"), "kind"), str("circle")),
        mul(field(varRef("shape"), "radius"), num(2)),
        num(0)
      )
    )
  );

  if (result.value.tag === "number") {
    assertEqual(result.value.value, 14);
  }
});

test("discriminated union: nested field access with narrowing", () => {
  // let data = { type: "success", value: { x: 42 } } in
  // if (data.type == "success") then data.value.x else 0
  const result = run(
    letExpr("data", obj({ type: str("success"), value: obj({ x: num(42) }) }),
      ifExpr(
        eq(field(varRef("data"), "type"), str("success")),
        field(field(varRef("data"), "value"), "x"),
        num(0)
      )
    )
  );

  if (result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
});

test("discriminated union: boolean discriminant", () => {
  // let result = { ok: true, data: 100 } in
  // if (result.ok == true) then result.data else 0
  const result = run(
    letExpr("result", obj({ ok: bool(true), data: num(100) }),
      ifExpr(
        eq(field(varRef("result"), "ok"), bool(true)),
        field(varRef("result"), "data"),
        num(0)
      )
    )
  );

  if (result.value.tag === "number") {
    assertEqual(result.value.value, 100);
  }
});

test("discriminated union: number discriminant", () => {
  // let msg = { code: 200, body: "ok" } in
  // if (msg.code == 200) then msg.body else "error"
  const result = run(
    letExpr("msg", obj({ code: num(200), body: str("ok") }),
      ifExpr(
        eq(field(varRef("msg"), "code"), num(200)),
        field(varRef("msg"), "body"),
        str("error")
      )
    )
  );

  if (result.value.tag === "string") {
    assertEqual(result.value.value, "ok");
  }
});

// ============================================================================
// Summary
// ============================================================================

console.log("\n" + "=".repeat(50));
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);

if (failed > 0) {
  throw new Error(`${failed} tests failed`);
}
