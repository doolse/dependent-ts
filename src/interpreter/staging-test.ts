/**
 * Tests for staged evaluation (partial evaluation with Now/Later).
 */

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
} from "./index";

// ============================================================================
// Test Helpers
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  resetVarCounter(); // Reset for each test
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

function assertThrows(fn: () => void, expectedType?: new (...args: any[]) => Error): void {
  try {
    fn();
    throw new Error("Expected function to throw");
  } catch (e) {
    if (expectedType && !(e instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, got ${(e as Error).constructor.name}`);
    }
  }
}

// ============================================================================
// Basic Staging Tests
// ============================================================================

console.log("\nBasic Staging Tests:");

test("literals are Now", () => {
  const result = stage(num(42)).svalue;
  assertTrue(isNow(result), "number should be Now");
  if (isNow(result)) {
    assertEqual(result.value.tag, "number");
    if (result.value.tag === "number") {
      assertEqual(result.value.value, 42);
    }
  }
});

test("string literals are Now", () => {
  const result = stage(str("hello")).svalue;
  assertTrue(isNow(result), "string should be Now");
});

test("boolean literals are Now", () => {
  const result = stage(bool(true)).svalue;
  assertTrue(isNow(result), "bool should be Now");
});

test("null literal is Now", () => {
  const result = stage(nil).svalue;
  assertTrue(isNow(result), "null should be Now");
});

// ============================================================================
// Arithmetic Staging Tests
// ============================================================================

console.log("\nArithmetic Staging Tests:");

test("arithmetic on Now values computes immediately", () => {
  const result = stage(add(num(1), num(2))).svalue;
  assertTrue(isNow(result), "result should be Now");
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 3);
  }
});

test("complex arithmetic is fully computed when all Now", () => {
  // (2 + 3) * 4 = 20
  const result = stage(mul(add(num(2), num(3)), num(4))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 20);
  }
});

// ============================================================================
// Runtime Annotation Tests
// ============================================================================

console.log("\nRuntime Annotation Tests:");

test("runtime creates Later value", () => {
  // runtime(5) - mark as runtime even though it's a literal
  const result = stage(runtime(num(5), "x")).svalue;
  assertTrue(isLater(result), "runtime should produce Later");
  if (isLater(result)) {
    assertTrue(implies(result.constraint, isNumber));
    assertTrue(implies(result.constraint, equals(5)));
  }
});

test("runtime preserves constraint", () => {
  const result = stage(runtime(num(42), "x")).svalue;
  assertTrue(isLater(result));
  if (isLater(result)) {
    assertTrue(implies(result.constraint, equals(42)));
  }
});

test("arithmetic with Later produces Later with residual", () => {
  // runtime(x: 5) + 3 -> Later with residual (x + 3)
  const result = stage(add(runtime(num(5), "x"), num(3))).svalue;
  assertTrue(isLater(result), "result should be Later");
  if (isLater(result)) {
    assertTrue(implies(result.constraint, isNumber));
    // Check residual is generated
    const residual = exprToString(result.residual);
    assertTrue(residual.includes("x") && residual.includes("3"));
  }
});

test("stageToExpr returns literal for Now", () => {
  const expr = stageToExpr(add(num(2), num(3)));
  assertEqual(exprToString(expr), "5");
});

test("stageToExpr returns residual for Later", () => {
  const expr = stageToExpr(add(runtime(num(5), "x"), num(3)));
  assertTrue(exprToString(expr).includes("+"));
});

// ============================================================================
// Comptime Tests
// ============================================================================

console.log("\nComptime Tests:");

test("comptime succeeds with Now value", () => {
  const result = stage(comptime(add(num(2), num(3)))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 5);
  }
});

test("comptime fails with Later value", () => {
  assertThrows(() => {
    stage(comptime(add(runtime(num(5), "x"), num(3))));
  }, StagingError);
});

// ============================================================================
// Let Binding Staging Tests
// ============================================================================

console.log("\nLet Binding Staging Tests:");

test("let with Now value propagates Now", () => {
  // let x = 5 in x + 1
  const result = stage(letExpr("x", num(5), add(varRef("x"), num(1)))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 6);
  }
});

test("let with Later value propagates Later", () => {
  // let x = runtime(5) in x + 1
  const result = stage(letExpr("x", runtime(num(5), "input"), add(varRef("x"), num(1)))).svalue;
  assertTrue(isLater(result));
});

test("let generates residual when needed", () => {
  // let x = runtime(5) in x + x
  const expr = stageToExpr(letExpr("x", runtime(num(5), "input"), add(varRef("x"), varRef("x"))));
  const str = exprToString(expr);
  assertTrue(str.includes("let") && str.includes("input"));
});

// ============================================================================
// If Expression Staging Tests
// ============================================================================

console.log("\nIf Expression Staging Tests:");

test("if with Now condition evaluates only taken branch", () => {
  // if (true) then 1 else error
  const result = stage(ifExpr(bool(true), num(1), varRef("undefined_var"))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 1);
  }
});

test("if with Now false condition evaluates else branch", () => {
  const result = stage(ifExpr(bool(false), varRef("undefined"), num(2))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 2);
  }
});

test("if with Later condition generates residual", () => {
  // if (runtime(true)) then 1 else 2
  const result = stage(ifExpr(runtime(bool(true), "cond"), num(1), num(2))).svalue;
  assertTrue(isLater(result));
  if (isLater(result)) {
    const residual = exprToString(result.residual);
    assertTrue(residual.includes("if") && residual.includes("cond"));
  }
});

// ============================================================================
// Function Staging Tests
// ============================================================================

console.log("\nFunction Staging Tests:");

test("function definition is Now", () => {
  const result = stage(fn(["x"], add(varRef("x"), num(1)))).svalue;
  assertTrue(isNow(result));
});

test("function call with Now args evaluates fully", () => {
  // (fn(x) => x + 1)(5)
  const result = stage(call(fn(["x"], add(varRef("x"), num(1))), num(5))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 6);
  }
});

test("function call with Later arg produces Later", () => {
  // (fn(x) => x + 1)(runtime(5))
  const result = stage(call(fn(["x"], add(varRef("x"), num(1))), runtime(num(5), "input"))).svalue;
  assertTrue(isLater(result));
});

test("function can mix Now and Later args", () => {
  // (fn(x, y) => x + y)(5, runtime(3))
  const result = stage(
    call(fn(["x", "y"], add(varRef("x"), varRef("y"))), num(5), runtime(num(3), "y"))
  ).svalue;
  assertTrue(isLater(result));
  if (isLater(result)) {
    // x should be inlined as 5
    const residual = exprToString(result.residual);
    assertTrue(residual.includes("5") || residual.includes("y"));
  }
});

// ============================================================================
// Object Staging Tests
// ============================================================================

console.log("\nObject Staging Tests:");

test("object with all Now fields is Now", () => {
  const result = stage(obj({ x: num(1), y: num(2) })).svalue;
  assertTrue(isNow(result));
  if (isNow(result)) {
    assertTrue(implies(result.constraint, isObject));
    assertTrue(implies(result.constraint, hasField("x", and(isNumber, equals(1)))));
  }
});

test("object with Later field is Later", () => {
  const result = stage(obj({ x: num(1), y: runtime(num(2), "y") })).svalue;
  assertTrue(isLater(result));
});

test("field access on Now object is Now", () => {
  const result = stage(field(obj({ x: num(42) }), "x")).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
});

test("field access on Later object is Later", () => {
  const result = stage(field(runtime(obj({ x: num(42) }), "obj"), "x")).svalue;
  assertTrue(isLater(result));
});

// ============================================================================
// Array Staging Tests
// ============================================================================

console.log("\nArray Staging Tests:");

test("array with all Now elements is Now", () => {
  const result = stage(array(num(1), num(2), num(3))).svalue;
  assertTrue(isNow(result));
});

test("array with Later element is Later", () => {
  const result = stage(array(num(1), runtime(num(2), "x"), num(3))).svalue;
  assertTrue(isLater(result));
});

test("index on Now array with Now index is Now", () => {
  const result = stage(index(array(num(10), num(20)), num(1))).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 20);
  }
});

test("index with Later index is Later", () => {
  const result = stage(index(array(num(10), num(20)), runtime(num(0), "i"))).svalue;
  assertTrue(isLater(result));
});

// ============================================================================
// Partial Evaluation Examples
// ============================================================================

console.log("\nPartial Evaluation Examples:");

test("constant folding through let bindings", () => {
  // let a = 2 in let b = 3 in a * b + 1
  const result = stage(
    letExpr("a", num(2),
      letExpr("b", num(3),
        add(mul(varRef("a"), varRef("b")), num(1))
      )
    )
  ).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 7); // 2 * 3 + 1
  }
});

test("partial evaluation with runtime input", () => {
  // let multiplier = 2 in let x = runtime(input) in multiplier * x
  // Should partially evaluate to: 2 * input
  const result = stage(
    letExpr("multiplier", num(2),
      letExpr("x", runtime(num(5), "input"),
        mul(varRef("multiplier"), varRef("x"))
      )
    )
  ).svalue;

  assertTrue(isLater(result));
  if (isLater(result)) {
    const residual = exprToString(result.residual);
    // The 2 should be inlined
    assertTrue(residual.includes("2") && residual.includes("input"));
  }
});

test("dead code elimination via known condition", () => {
  // let debug = false in if (debug) then expensiveOp else 42
  // Should evaluate to just 42
  const result = stage(
    letExpr("debug", bool(false),
      ifExpr(varRef("debug"), varRef("expensive"), num(42))
    )
  ).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 42);
  }
});

test("type-directed specialization", () => {
  // When we know the discriminant, we can specialize
  // let shape = { kind: "circle", radius: 5 } in
  // if (shape.kind == "circle") then shape.radius else 0
  const result = stage(
    letExpr("shape", obj({ kind: str("circle"), radius: num(5) }),
      ifExpr(
        eq(field(varRef("shape"), "kind"), str("circle")),
        field(varRef("shape"), "radius"),
        num(0)
      )
    )
  ).svalue;
  assertTrue(isNow(result));
  if (isNow(result) && result.value.tag === "number") {
    assertEqual(result.value.value, 5);
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
