/**
 * Tests for the lexer and parser.
 */

import {
  tokenize,
  parse,
  parseAndRun,
  parseAndCompile,
  LexerError,
  ParseError,
  exprToString,
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

function assertThrows(fn: () => void, errorType?: new (...args: any[]) => Error): void {
  try {
    fn();
    throw new Error("Expected function to throw");
  } catch (e) {
    if (errorType && !(e instanceof errorType)) {
      throw new Error(`Expected ${errorType.name}, got ${(e as Error).constructor.name}`);
    }
  }
}

// Helper to run and get value
function evalTo(source: string): unknown {
  const result = parseAndRun(source);
  const v = result.value;
  switch (v.tag) {
    case "number": return v.value;
    case "string": return v.value;
    case "bool": return v.value;
    case "null": return null;
    default: return v;
  }
}

// ============================================================================
// Lexer Tests
// ============================================================================

console.log("\nLexer Tests:");

test("tokenizes numbers", () => {
  const tokens = tokenize("42 3.14 0");
  assertEqual(tokens[0].type, "NUMBER");
  assertEqual(tokens[0].value, "42");
  assertEqual(tokens[1].type, "NUMBER");
  assertEqual(tokens[1].value, "3.14");
  assertEqual(tokens[2].type, "NUMBER");
  assertEqual(tokens[2].value, "0");
});

test("tokenizes strings", () => {
  const tokens = tokenize('"hello" "world"');
  assertEqual(tokens[0].type, "STRING");
  assertEqual(tokens[0].value, "hello");
  assertEqual(tokens[1].type, "STRING");
  assertEqual(tokens[1].value, "world");
});

test("tokenizes string escapes", () => {
  const tokens = tokenize('"hello\\nworld" "tab\\there"');
  assertEqual(tokens[0].value, "hello\nworld");
  assertEqual(tokens[1].value, "tab\there");
});

test("tokenizes keywords", () => {
  const tokens = tokenize("let in if then else fn true false null comptime runtime");
  assertEqual(tokens[0].type, "LET");
  assertEqual(tokens[1].type, "IN");
  assertEqual(tokens[2].type, "IF");
  assertEqual(tokens[3].type, "THEN");
  assertEqual(tokens[4].type, "ELSE");
  assertEqual(tokens[5].type, "FN");
  assertEqual(tokens[6].type, "TRUE");
  assertEqual(tokens[7].type, "FALSE");
  assertEqual(tokens[8].type, "NULL");
  assertEqual(tokens[9].type, "COMPTIME");
  assertEqual(tokens[10].type, "RUNTIME");
});

test("tokenizes identifiers", () => {
  const tokens = tokenize("foo bar_baz x1 _private");
  assertEqual(tokens[0].type, "IDENT");
  assertEqual(tokens[0].value, "foo");
  assertEqual(tokens[1].value, "bar_baz");
  assertEqual(tokens[2].value, "x1");
  assertEqual(tokens[3].value, "_private");
});

test("tokenizes operators", () => {
  const tokens = tokenize("+ - * / % == != < > <= >= && || !");
  assertEqual(tokens[0].type, "PLUS");
  assertEqual(tokens[1].type, "MINUS");
  assertEqual(tokens[2].type, "STAR");
  assertEqual(tokens[3].type, "SLASH");
  assertEqual(tokens[4].type, "PERCENT");
  assertEqual(tokens[5].type, "EQ");
  assertEqual(tokens[6].type, "NEQ");
  assertEqual(tokens[7].type, "LT");
  assertEqual(tokens[8].type, "GT");
  assertEqual(tokens[9].type, "LTE");
  assertEqual(tokens[10].type, "GTE");
  assertEqual(tokens[11].type, "AND");
  assertEqual(tokens[12].type, "OR");
  assertEqual(tokens[13].type, "NOT");
});

test("tokenizes punctuation", () => {
  const tokens = tokenize("( ) { } [ ] , : . => =");
  assertEqual(tokens[0].type, "LPAREN");
  assertEqual(tokens[1].type, "RPAREN");
  assertEqual(tokens[2].type, "LBRACE");
  assertEqual(tokens[3].type, "RBRACE");
  assertEqual(tokens[4].type, "LBRACKET");
  assertEqual(tokens[5].type, "RBRACKET");
  assertEqual(tokens[6].type, "COMMA");
  assertEqual(tokens[7].type, "COLON");
  assertEqual(tokens[8].type, "DOT");
  assertEqual(tokens[9].type, "ARROW");
  assertEqual(tokens[10].type, "ASSIGN");
});

test("skips comments", () => {
  const tokens = tokenize("1 // this is a comment\n2");
  assertEqual(tokens[0].type, "NUMBER");
  assertEqual(tokens[0].value, "1");
  assertEqual(tokens[1].type, "NUMBER");
  assertEqual(tokens[1].value, "2");
});

test("tracks line and column", () => {
  const tokens = tokenize("a\nb c");
  assertEqual(tokens[0].line, 1);
  assertEqual(tokens[0].column, 1);
  assertEqual(tokens[1].line, 2);
  assertEqual(tokens[1].column, 1);
  assertEqual(tokens[2].line, 2);
  assertEqual(tokens[2].column, 3);
});

// ============================================================================
// Parser Tests - Literals
// ============================================================================

console.log("\nParser Tests - Literals:");

test("parses number", () => {
  assertEqual(evalTo("42"), 42);
  assertEqual(evalTo("3.14"), 3.14);
  assertEqual(evalTo("0"), 0);
});

test("parses string", () => {
  assertEqual(evalTo('"hello"'), "hello");
  assertEqual(evalTo('""'), "");
});

test("parses boolean", () => {
  assertEqual(evalTo("true"), true);
  assertEqual(evalTo("false"), false);
});

test("parses null", () => {
  assertEqual(evalTo("null"), null);
});

// ============================================================================
// Parser Tests - Arithmetic
// ============================================================================

console.log("\nParser Tests - Arithmetic:");

test("parses addition", () => {
  assertEqual(evalTo("1 + 2"), 3);
  assertEqual(evalTo("1 + 2 + 3"), 6);
});

test("parses subtraction", () => {
  assertEqual(evalTo("5 - 3"), 2);
  assertEqual(evalTo("10 - 3 - 2"), 5);
});

test("parses multiplication", () => {
  assertEqual(evalTo("4 * 5"), 20);
});

test("parses division", () => {
  assertEqual(evalTo("10 / 2"), 5);
});

test("parses modulo", () => {
  assertEqual(evalTo("7 % 3"), 1);
});

test("respects precedence (* before +)", () => {
  assertEqual(evalTo("1 + 2 * 3"), 7);
  assertEqual(evalTo("2 * 3 + 1"), 7);
});

test("respects parentheses", () => {
  assertEqual(evalTo("(1 + 2) * 3"), 9);
});

test("parses unary minus", () => {
  assertEqual(evalTo("-5"), -5);
  assertEqual(evalTo("--5"), 5);
  assertEqual(evalTo("1 + -2"), -1);
});

// ============================================================================
// Parser Tests - Comparison
// ============================================================================

console.log("\nParser Tests - Comparison:");

test("parses equality", () => {
  assertEqual(evalTo("1 == 1"), true);
  assertEqual(evalTo("1 == 2"), false);
  assertEqual(evalTo("1 != 2"), true);
  assertEqual(evalTo("1 != 1"), false);
});

test("parses relational", () => {
  assertEqual(evalTo("1 < 2"), true);
  assertEqual(evalTo("2 < 1"), false);
  assertEqual(evalTo("2 > 1"), true);
  assertEqual(evalTo("1 <= 1"), true);
  assertEqual(evalTo("1 >= 1"), true);
});

// ============================================================================
// Parser Tests - Logical
// ============================================================================

console.log("\nParser Tests - Logical:");

test("parses and", () => {
  assertEqual(evalTo("true && true"), true);
  assertEqual(evalTo("true && false"), false);
});

test("parses or", () => {
  assertEqual(evalTo("false || true"), true);
  assertEqual(evalTo("false || false"), false);
});

test("parses not", () => {
  assertEqual(evalTo("!true"), false);
  assertEqual(evalTo("!false"), true);
  assertEqual(evalTo("!!true"), true);
});

test("respects logical precedence", () => {
  assertEqual(evalTo("true || false && false"), true);  // && binds tighter
  assertEqual(evalTo("false && true || true"), true);
});

// ============================================================================
// Parser Tests - Let
// ============================================================================

console.log("\nParser Tests - Let:");

test("parses let binding", () => {
  assertEqual(evalTo("let x = 5 in x"), 5);
  assertEqual(evalTo("let x = 5 in x + 1"), 6);
});

test("parses nested let", () => {
  assertEqual(evalTo("let x = 5 in let y = 3 in x + y"), 8);
});

test("let shadows outer binding", () => {
  assertEqual(evalTo("let x = 5 in let x = 10 in x"), 10);
});

// ============================================================================
// Parser Tests - If
// ============================================================================

console.log("\nParser Tests - If:");

test("parses if expression", () => {
  assertEqual(evalTo("if true then 1 else 2"), 1);
  assertEqual(evalTo("if false then 1 else 2"), 2);
});

test("parses nested if", () => {
  assertEqual(evalTo("if true then if false then 1 else 2 else 3"), 2);
});

test("if with complex condition", () => {
  assertEqual(evalTo("if 1 < 2 then 10 else 20"), 10);
});

// ============================================================================
// Parser Tests - Functions
// ============================================================================

console.log("\nParser Tests - Functions:");

test("parses function definition", () => {
  const result = parseAndRun("fn(x) => x");
  assertEqual(result.value.tag, "closure");
});

test("parses function call", () => {
  assertEqual(evalTo("(fn(x) => x + 1)(5)"), 6);
});

test("parses multi-arg function", () => {
  assertEqual(evalTo("(fn(x, y) => x + y)(3, 4)"), 7);
});

test("parses no-arg function", () => {
  assertEqual(evalTo("(fn() => 42)()"), 42);
});

test("parses higher-order function", () => {
  assertEqual(evalTo("let f = fn(x) => fn(y) => x + y in f(3)(4)"), 7);
});

// ============================================================================
// Parser Tests - Objects
// ============================================================================

console.log("\nParser Tests - Objects:");

test("parses empty object", () => {
  const result = parseAndRun("{}");
  assertEqual(result.value.tag, "object");
});

test("parses object literal", () => {
  assertEqual(evalTo("{ x: 1, y: 2 }.x"), 1);
  assertEqual(evalTo("{ x: 1, y: 2 }.y"), 2);
});

test("parses nested field access", () => {
  assertEqual(evalTo("{ inner: { x: 42 } }.inner.x"), 42);
});

// ============================================================================
// Parser Tests - Arrays
// ============================================================================

console.log("\nParser Tests - Arrays:");

test("parses empty array", () => {
  const result = parseAndRun("[]");
  assertEqual(result.value.tag, "array");
});

test("parses array literal", () => {
  assertEqual(evalTo("[1, 2, 3][0]"), 1);
  assertEqual(evalTo("[1, 2, 3][1]"), 2);
  assertEqual(evalTo("[1, 2, 3][2]"), 3);
});

test("parses array with expressions", () => {
  assertEqual(evalTo("[1 + 1, 2 + 2][0]"), 2);
});

// ============================================================================
// Parser Tests - Staging
// ============================================================================

console.log("\nParser Tests - Staging:");

test("parses comptime", () => {
  assertEqual(evalTo("comptime(2 + 3)"), 5);
});

test("parses runtime", () => {
  // runtime just wraps expression in pure eval mode
  assertEqual(evalTo("runtime(42)"), 42);
});

test("parses named runtime", () => {
  assertEqual(evalTo("runtime(x: 42)"), 42);
});

// ============================================================================
// Parser Tests - Complex Expressions
// ============================================================================

console.log("\nParser Tests - Complex Expressions:");

test("complex arithmetic", () => {
  assertEqual(evalTo("(1 + 2) * (3 + 4) / 7"), 3);
});

test("let with function", () => {
  assertEqual(evalTo("let double = fn(x) => x * 2 in double(21)"), 42);
});

test("function returning object", () => {
  assertEqual(evalTo("(fn(x) => { value: x })(42).value"), 42);
});

test("conditional in function", () => {
  assertEqual(evalTo("let abs = fn(x) => if x < 0 then -x else x in abs(-5)"), 5);
});

test("array in let binding", () => {
  assertEqual(evalTo("let arr = [10, 20, 30] in arr[1]"), 20);
});

// ============================================================================
// Compilation Tests
// ============================================================================

console.log("\nCompilation Tests:");

test("compiles simple expression", () => {
  const code = parseAndCompile("1 + 2");
  assertEqual(code, "3");
});

test("compiles let binding", () => {
  const code = parseAndCompile("let x = 5 in x * 2");
  assertEqual(code, "10");
});

test("compiles with runtime values", () => {
  const code = parseAndCompile("runtime(x: 5) + 3");
  assertEqual(code.includes("x"), true);
  assertEqual(code.includes("3"), true);
});

// ============================================================================
// Error Tests
// ============================================================================

console.log("\nError Tests:");

test("lexer error on unknown character", () => {
  assertThrows(() => tokenize("@"), LexerError);
});

test("parse error on incomplete expression", () => {
  assertThrows(() => parse("1 +"), ParseError);
});

test("parse error on missing then", () => {
  assertThrows(() => parse("if true 1 else 2"), ParseError);
});

test("parse error on missing in", () => {
  assertThrows(() => parse("let x = 5 x"), ParseError);
});

// ============================================================================
// Summary
// ============================================================================

console.log("\n" + "=".repeat(50));
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);

if (failed > 0) {
  throw new Error(`${failed} tests failed`);
}
