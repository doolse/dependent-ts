/**
 * Tests for JavaScript code generation.
 */

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
} from "./index";

// ============================================================================
// Test Helpers
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  resetVarCounter();
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

function assertEqual(actual: string, expected: string, message?: string): void {
  // Normalize whitespace for comparison
  const normalizedActual = actual.trim();
  const normalizedExpected = expected.trim();
  if (normalizedActual !== normalizedExpected) {
    throw new Error(
      `${message ? message + ":\n" : ""}Expected:\n${normalizedExpected}\n\nGot:\n${normalizedActual}`
    );
  }
}

function assertContains(actual: string, expected: string, message?: string): void {
  if (!actual.includes(expected)) {
    throw new Error(
      `${message ? message + ": " : ""}Expected to contain "${expected}", got:\n${actual}`
    );
  }
}

function assertEval(code: string, expected: unknown, message?: string): void {
  const actual = eval(code);
  if (actual !== expected) {
    throw new Error(
      `${message ? message + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\nCode: ${code}`
    );
  }
}

function assertDeepEval(code: string, expected: unknown, message?: string): void {
  const actual = eval(code);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message ? message + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\nCode: ${code}`
    );
  }
}

// ============================================================================
// Literal Generation Tests
// ============================================================================

console.log("\nLiteral Generation Tests:");

test("generates number literals", () => {
  assertEqual(generateJS(num(42)), "42");
  assertEqual(generateJS(num(3.14)), "3.14");
  assertEqual(generateJS(num(-7)), "-7");
  assertEqual(generateJS(num(0)), "0");
});

test("generates string literals", () => {
  assertEqual(generateJS(str("hello")), '"hello"');
  assertEqual(generateJS(str("")), '""');
  assertEqual(generateJS(str('with "quotes"')), '"with \\"quotes\\""');
});

test("generates boolean literals", () => {
  assertEqual(generateJS(bool(true)), "true");
  assertEqual(generateJS(bool(false)), "false");
});

test("generates null literal", () => {
  assertEqual(generateJS(nil), "null");
});

// ============================================================================
// Operator Generation Tests
// ============================================================================

console.log("\nOperator Generation Tests:");

test("generates arithmetic operators", () => {
  assertEqual(generateJS(add(num(1), num(2))), "1 + 2");
  assertEqual(generateJS(sub(num(5), num(3))), "5 - 3");
  assertEqual(generateJS(mul(num(4), num(5))), "4 * 5");
  assertEqual(generateJS(div(num(10), num(2))), "10 / 2");
  assertEqual(generateJS(mod(num(7), num(3))), "7 % 3");
});

test("generates comparison operators with ===", () => {
  assertEqual(generateJS(eq(varRef("x"), num(5))), "x === 5");
  assertEqual(generateJS(neq(varRef("x"), num(5))), "x !== 5");
});

test("generates relational operators", () => {
  assertEqual(generateJS(ltExpr(varRef("x"), num(5))), "x < 5");
  assertEqual(generateJS(gtExpr(varRef("x"), num(5))), "x > 5");
  assertEqual(generateJS(lteExpr(varRef("x"), num(5))), "x <= 5");
  assertEqual(generateJS(gteExpr(varRef("x"), num(5))), "x >= 5");
});

test("generates logical operators", () => {
  assertEqual(generateJS(andExpr(varRef("a"), varRef("b"))), "a && b");
  assertEqual(generateJS(orExpr(varRef("a"), varRef("b"))), "a || b");
});

test("generates unary operators", () => {
  assertEqual(generateJS(neg(num(5))), "-5");
  assertEqual(generateJS(notExpr(varRef("x"))), "!x");
});

test("adds parentheses for precedence", () => {
  // (1 + 2) * 3
  const expr = mul(add(num(1), num(2)), num(3));
  assertEqual(generateJS(expr), "(1 + 2) * 3");
});

test("handles right-associativity", () => {
  // 1 - (2 - 3)
  const expr = sub(num(1), sub(num(2), num(3)));
  assertEqual(generateJS(expr), "1 - (2 - 3)");
});

// ============================================================================
// Control Flow Generation Tests
// ============================================================================

console.log("\nControl Flow Generation Tests:");

test("generates ternary for if expressions", () => {
  const expr = ifExpr(varRef("cond"), num(1), num(2));
  assertEqual(generateJS(expr), "cond ? 1 : 2");
});

test("generates nested ternaries", () => {
  const expr = ifExpr(varRef("a"), num(1), ifExpr(varRef("b"), num(2), num(3)));
  assertEqual(generateJS(expr), "a ? 1 : b ? 2 : 3");
});

// ============================================================================
// Let Binding Generation Tests
// ============================================================================

console.log("\nLet Binding Generation Tests:");

test("generates IIFE for let bindings", () => {
  const expr = letExpr("x", num(5), add(varRef("x"), num(1)));
  const code = generateJS(expr);
  assertContains(code, "const x = 5");
  assertContains(code, "return x + 1");
});

test("let binding evaluates correctly", () => {
  const expr = letExpr("x", num(5), add(varRef("x"), num(1)));
  const code = generateJS(expr);
  assertEval(code, 6);
});

test("nested let bindings work", () => {
  const expr = letExpr("x", num(5),
    letExpr("y", num(3),
      add(varRef("x"), varRef("y"))
    )
  );
  const code = generateJS(expr);
  assertEval(code, 8);
});

// ============================================================================
// Function Generation Tests
// ============================================================================

console.log("\nFunction Generation Tests:");

test("generates arrow functions", () => {
  const expr = fn(["x"], add(varRef("x"), num(1)));
  assertEqual(generateJS(expr), "(x) => x + 1");
});

test("generates multi-param arrow functions", () => {
  const expr = fn(["x", "y"], add(varRef("x"), varRef("y")));
  assertEqual(generateJS(expr), "(x, y) => x + y");
});

test("generates function calls", () => {
  const expr = call(varRef("f"), num(1), num(2));
  assertEqual(generateJS(expr), "f(1, 2)");
});

test("wraps IIFE calls correctly", () => {
  const expr = call(fn(["x"], varRef("x")), num(42));
  const code = generateJS(expr);
  assertContains(code, "((x) => x)(42)");
  assertEval(code, 42);
});

test("generateFunction creates named function", () => {
  const expr = fn(["x", "y"], add(varRef("x"), varRef("y")));
  const code = generateFunction("add", expr);
  assertContains(code, "function add(x, y)");
  assertContains(code, "return x + y");
});

// ============================================================================
// Object Generation Tests
// ============================================================================

console.log("\nObject Generation Tests:");

test("generates empty object", () => {
  const expr = obj({});
  assertEqual(generateJS(expr), "{}");
});

test("generates object literal", () => {
  const expr = obj({ x: num(1), y: num(2) });
  assertEqual(generateJS(expr), "{ x: 1, y: 2 }");
});

test("generates field access with dot notation", () => {
  const expr = field(varRef("obj"), "x");
  assertEqual(generateJS(expr), "obj.x");
});

test("generates chained field access", () => {
  const expr = field(field(varRef("a"), "b"), "c");
  assertEqual(generateJS(expr), "a.b.c");
});

test("object literal evaluates correctly", () => {
  const expr = obj({ x: num(1), y: num(2) });
  const code = generateJS(expr);
  // Wrap in parens for eval (otherwise JS treats {} as block)
  assertDeepEval(`(${code})`, { x: 1, y: 2 });
});

// ============================================================================
// Array Generation Tests
// ============================================================================

console.log("\nArray Generation Tests:");

test("generates empty array", () => {
  const expr = array();
  assertEqual(generateJS(expr), "[]");
});

test("generates array literal", () => {
  const expr = array(num(1), num(2), num(3));
  assertEqual(generateJS(expr), "[1, 2, 3]");
});

test("generates array index", () => {
  const expr = index(varRef("arr"), num(0));
  assertEqual(generateJS(expr), "arr[0]");
});

test("generates dynamic array index", () => {
  const expr = index(varRef("arr"), varRef("i"));
  assertEqual(generateJS(expr), "arr[i]");
});

test("array literal evaluates correctly", () => {
  const expr = array(num(1), num(2), num(3));
  const code = generateJS(expr);
  assertDeepEval(code, [1, 2, 3]);
});

// ============================================================================
// Block Generation Tests
// ============================================================================

console.log("\nBlock Generation Tests:");

test("generates single expression block", () => {
  const expr = block(num(42));
  assertEqual(generateJS(expr), "42");
});

test("generates multi-expression block as IIFE", () => {
  const expr = block(num(1), num(2), num(3));
  const code = generateJS(expr);
  assertContains(code, "return 3");
  assertEval(code, 3);
});

// ============================================================================
// Compilation Pipeline Tests
// ============================================================================

console.log("\nCompilation Pipeline Tests:");

test("compile fully evaluates constant expressions", () => {
  const code = compile(add(num(2), num(3)));
  assertEqual(code, "5");
});

test("compile generates residual for runtime values", () => {
  const expr = add(runtime(num(5), "x"), num(3));
  const code = compile(expr);
  assertContains(code, "x + 3");
});

test("compile does constant folding in let", () => {
  const expr = letExpr("a", num(2),
    letExpr("b", num(3),
      mul(varRef("a"), varRef("b"))
    )
  );
  const code = compile(expr);
  assertEqual(code, "6");
});

test("compile partially evaluates with runtime input", () => {
  const expr = letExpr("multiplier", num(2),
    letExpr("x", runtime(num(5), "input"),
      mul(varRef("multiplier"), varRef("x"))
    )
  );
  const code = compile(expr);
  assertContains(code, "2 * input");
});

test("compile eliminates dead branches", () => {
  const expr = ifExpr(bool(true), num(42), varRef("unused"));
  const code = compile(expr);
  assertEqual(code, "42");
});

test("compiled code is executable", () => {
  // Complex example: (fn(x) => x * 2 + 1)(5)
  const expr = call(fn(["x"], add(mul(varRef("x"), num(2)), num(1))), num(5));
  const code = compile(expr);
  assertEval(code, 11);
});

// ============================================================================
// Edge Cases
// ============================================================================

console.log("\nEdge Cases:");

test("handles reserved word identifiers", () => {
  // 'class' is a reserved word
  const expr = varRef("class");
  assertEqual(generateJS(expr), "_class");
});

test("handles special property names", () => {
  const expr = obj({ "weird-name": num(1) });
  assertContains(generateJS(expr), '"weird-name"');
});

test("generateModule creates export", () => {
  const code = generateModule(num(42));
  assertEqual(code, "export default 42;");
});

test("wrapInIIFE option works", () => {
  const code = generateJS(num(42), { wrapInIIFE: true });
  assertContains(code, "(() =>");
  assertContains(code, "return 42");
  assertEval(code, 42);
});

// ============================================================================
// Integration Tests
// ============================================================================

console.log("\nIntegration Tests:");

test("compiles discriminated union handling", () => {
  // This should fully evaluate since shape is known
  const expr = letExpr("shape", obj({ kind: str("circle"), radius: num(5) }),
    ifExpr(
      eq(field(varRef("shape"), "kind"), str("circle")),
      field(varRef("shape"), "radius"),
      num(0)
    )
  );
  const code = compile(expr);
  assertEqual(code, "5");
});

test("compiles higher-order function", () => {
  // let f = (x) => (y) => x + y in f(3)(4)
  const expr = letExpr("f",
    fn(["x"], fn(["y"], add(varRef("x"), varRef("y")))),
    call(call(varRef("f"), num(3)), num(4))
  );
  const code = compile(expr);
  assertEqual(code, "7");
});

test("compiles array map-like operation", () => {
  // let arr = [1, 2, 3] in arr[1]
  const expr = letExpr("arr", array(num(1), num(2), num(3)),
    index(varRef("arr"), num(1))
  );
  const code = compile(expr);
  assertEqual(code, "2");
});

// ============================================================================
// Summary
// ============================================================================

console.log("\n" + "=".repeat(50));
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);

if (failed > 0) {
  throw new Error(`${failed} tests failed`);
}
