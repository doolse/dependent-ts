/**
 * Test harness for staged interpreter.
 */

import {
  lit,
  varRef,
  binOp,
  ifExpr,
  obj,
  field,
  call,
  lambda,
  letExpr,
  FunctionDef,
  typeOf,
  fields,
  hasField,
  typeTag,
  typeToStringExpr,
  pick,
  omit,
  merge,
  fieldType,
  isSubtypeExpr,
  Expr,
} from "./expr";
import { specialize, evaluateFully } from "./specialize";
import { numberType, boolType, literalType, objectType, stringType, arrayType, functionType, typeVar, resetTypeVarCounter, TypeValue, typeToString } from "./types";
import { unify, applySubst, emptySubst, unifyAll } from "./unify";
import { getTypeValue } from "./reflect";
import { parse, parseFunction } from "./parser";
import { evaluate } from "./evaluate";
import { Env, nowValue, isNow, isClosure } from "./svalue";
import { emptyContext } from "./refinement";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertContains(actual: string, expected: string, msg: string) {
  if (!actual.includes(expected)) {
    throw new Error(`${msg}: expected to contain "${expected}", got "${actual}"`);
  }
}

function assertNotContains(actual: string, notExpected: string, msg: string) {
  if (actual.includes(notExpected)) {
    throw new Error(`${msg}: expected NOT to contain "${notExpected}", got "${actual}"`);
  }
}

function assertApproxEqual(actual: number, expected: number, epsilon: number, msg: string) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual}`);
  }
}

// ============================================================================
// Basic staging tests
// ============================================================================

/**
 * Example 1: Simple arithmetic with partial specialization
 * (Architecture doc section 1.6)
 */
function testAdd3() {
  const add3: FunctionDef = {
    name: "add3",
    params: ["a", "b", "c"],
    body: binOp("+", binOp("+", varRef("a"), varRef("b")), varRef("c")),
  };

  const result = specialize(add3, { b: 10 }, [
    { name: "a", type: numberType },
    { name: "c", type: numberType },
  ]);

  console.log("add3 specialized with b=10:");
  console.log(result);
  assertContains(result, "+ 10", "should inline b=10");
}

/**
 * Example 2: Conditional elimination
 */
function testConditionalElimination() {
  const maybeDouble: FunctionDef = {
    name: "maybeDouble",
    params: ["x", "flag"],
    body: ifExpr(varRef("flag"), binOp("*", varRef("x"), lit(2)), varRef("x")),
  };

  const result = specialize(maybeDouble, { flag: true }, [{ name: "x", type: numberType }]);

  console.log("maybeDouble specialized with flag=true:");
  console.log(result);
  assertNotContains(result, "?", "conditional should be eliminated");
  assertContains(result, "* 2", "should have x * 2");
}

/**
 * Example 3: Conditional NOT eliminated (flag unknown)
 */
function testConditionalPreserved() {
  const maybeDouble: FunctionDef = {
    name: "maybeDouble",
    params: ["x", "flag"],
    body: ifExpr(varRef("flag"), binOp("*", varRef("x"), lit(2)), varRef("x")),
  };

  const result = specialize(maybeDouble, {}, [
    { name: "x", type: numberType },
    { name: "flag", type: boolType },
  ]);

  console.log("maybeDouble with flag unknown:");
  console.log(result);
  assertContains(result, "?", "conditional should be preserved");
}

/**
 * Example 4: Full evaluation
 */
function testFullEvaluation() {
  const expr: FunctionDef = {
    name: "compute",
    params: ["x", "y"],
    body: binOp("+", binOp("*", varRef("x"), lit(2)), varRef("y")),
  };

  const result = evaluateFully(expr, { x: 5, y: 3 });
  console.log("Full evaluation: 5 * 2 + 3 =", result);
  assertEqual(result, 13, "5 * 2 + 3");
}

/**
 * Example 5: Object field access
 */
function testFieldAccess() {
  const getX: FunctionDef = {
    name: "getX",
    params: ["obj"],
    body: field(varRef("obj"), "x"),
  };

  const result = specialize(getX, {}, [
    {
      name: "obj",
      type: objectType([{ name: "x", type: numberType }]),
    },
  ]);

  console.log("getX specialized:");
  console.log(result);
  assertContains(result, "obj.x", "should access obj.x");
}

/**
 * Example 6: Nested conditional with known inner condition
 */
function testNestedConditional() {
  const nested: FunctionDef = {
    name: "nested",
    params: ["x", "outerFlag", "innerVal"],
    body: ifExpr(
      varRef("outerFlag"),
      ifExpr(binOp("==", varRef("innerVal"), lit(42)), binOp("*", varRef("x"), lit(2)), varRef("x")),
      lit(0)
    ),
  };

  const result = specialize(nested, { innerVal: 42 }, [
    { name: "x", type: numberType },
    { name: "outerFlag", type: boolType },
  ]);

  console.log("nested specialized with innerVal=42:");
  console.log(result);
  // Should have one conditional (outer) but inner should be eliminated
  const questionMarks = (result.match(/\?/g) || []).length;
  assertEqual(questionMarks, 1, "should have exactly one conditional");
}

/**
 * Example 7: Literal type enabling static comparison
 */
function testLiteralTypeComparison() {
  const handleMessage: FunctionDef = {
    name: "handleMessage",
    params: ["msg"],
    body: ifExpr(
      binOp("==", field(varRef("msg"), "type"), lit("greeting")),
      binOp("+", lit("Hello, "), field(varRef("msg"), "name")),
      lit("Unknown")
    ),
  };

  const result = specialize(handleMessage, {}, [
    {
      name: "msg",
      type: objectType([
        { name: "type", type: literalType("greeting") },
        { name: "name", type: { tag: "primitive", name: "string" } },
      ]),
    },
  ]);

  console.log("handleMessage with literal type 'greeting':");
  console.log(result);
  assertNotContains(result, "?", "conditional should be eliminated");
  assertContains(result, "Hello", "should have Hello greeting");
}

/**
 * Example 8: Object literal construction
 */
function testObjectConstruction() {
  const makePoint: FunctionDef = {
    name: "makePoint",
    params: ["x", "y"],
    body: obj([
      { name: "x", value: varRef("x") },
      { name: "y", value: varRef("y") },
    ]),
  };

  const result = specialize(makePoint, { y: 10 }, [{ name: "x", type: numberType }]);

  console.log("makePoint with y=10:");
  console.log(result);
  assertContains(result, "y: 10", "should inline y=10");
}

// ============================================================================
// Refinement tests
// ============================================================================

/**
 * Refinement test 1: Redundant check elimination
 * (Architecture doc section 2.8)
 *
 * if (x < 0) { 0 }
 * else if (x < 0) { 1 }  // This check is redundant! We know x >= 0 here
 * else { 2 }
 */
function testRedundantCheckElimination() {
  const redundant: FunctionDef = {
    name: "redundant",
    params: ["x"],
    body: ifExpr(
      binOp("<", varRef("x"), lit(0)),
      lit(0),
      ifExpr(
        binOp("<", varRef("x"), lit(0)), // Redundant! We know x >= 0 in else branch
        lit(1),
        lit(2)
      )
    ),
  };

  const result = specialize(redundant, {}, [{ name: "x", type: numberType }]);

  console.log("Redundant check elimination:");
  console.log(result);
  // The inner x < 0 check should be eliminated because we're in the else branch
  // where we know NOT (x < 0), i.e., x >= 0
  // So the result should be: (x < 0) ? 0 : 2
  assertNotContains(result, "1", "redundant branch returning 1 should be eliminated");
}

/**
 * Refinement test 2: Equality refinement
 *
 * if (x == 5) {
 *   if (x == 5) { "yes" } else { "no" }  // Inner check is always true!
 * } else { "other" }
 */
function testEqualityRefinement() {
  const eqRefine: FunctionDef = {
    name: "eqRefine",
    params: ["x"],
    body: ifExpr(
      binOp("==", varRef("x"), lit(5)),
      ifExpr(
        binOp("==", varRef("x"), lit(5)), // Redundant! We know x == 5 here
        lit("yes"),
        lit("no")
      ),
      lit("other")
    ),
  };

  const result = specialize(eqRefine, {}, [{ name: "x", type: numberType }]);

  console.log("Equality refinement:");
  console.log(result);
  // Inner conditional should be eliminated, leaving just "yes"
  assertNotContains(result, '"no"', 'unreachable "no" branch should be eliminated');
}

/**
 * Refinement test 3: Inequality transitivity
 *
 * if (x < 5) {
 *   if (x < 10) { "a" } else { "b" }  // We know x < 5, so x < 10 is true!
 * } else { "c" }
 */
function testInequalityTransitivity() {
  const ineqTrans: FunctionDef = {
    name: "ineqTrans",
    params: ["x"],
    body: ifExpr(
      binOp("<", varRef("x"), lit(5)),
      ifExpr(
        binOp("<", varRef("x"), lit(10)), // We know x < 5, so x < 10 is implied
        lit("a"),
        lit("b")
      ),
      lit("c")
    ),
  };

  const result = specialize(ineqTrans, {}, [{ name: "x", type: numberType }]);

  console.log("Inequality transitivity:");
  console.log(result);
  // Inner conditional should be eliminated because x < 5 implies x < 10
  assertNotContains(result, '"b"', 'unreachable "b" branch should be eliminated');
}

/**
 * Refinement test 4: Negation in else branch
 *
 * if (x >= 10) { "big" }
 * else {
 *   if (x < 10) { "small" } else { "medium" }  // x < 10 is always true here!
 * }
 */
function testNegationRefinement() {
  const negRefine: FunctionDef = {
    name: "negRefine",
    params: ["x"],
    body: ifExpr(
      binOp(">=", varRef("x"), lit(10)),
      lit("big"),
      ifExpr(
        binOp("<", varRef("x"), lit(10)), // We know NOT (x >= 10), i.e., x < 10
        lit("small"),
        lit("medium")
      )
    ),
  };

  const result = specialize(negRefine, {}, [{ name: "x", type: numberType }]);

  console.log("Negation refinement:");
  console.log(result);
  // In else branch, we know x < 10, so inner check is always true
  assertNotContains(result, '"medium"', 'unreachable "medium" branch should be eliminated');
}

/**
 * Refinement test 5: Chained comparisons (clamp pattern)
 * (Architecture doc section 2.8)
 */
function testClampPattern() {
  const clamp: FunctionDef = {
    name: "clamp",
    params: ["x", "min", "max"],
    body: ifExpr(
      binOp("<", varRef("x"), varRef("min")),
      varRef("min"),
      ifExpr(binOp(">", varRef("x"), varRef("max")), varRef("max"), varRef("x"))
    ),
  };

  // Specialize with min=0, max=100
  const result = specialize(clamp, { min: 0, max: 100 }, [{ name: "x", type: numberType }]);

  console.log("Clamp pattern with min=0, max=100:");
  console.log(result);
  // Both conditions should remain (we can't statically prove anything about x)
  // but the constants should be inlined
  assertContains(result, "0", "should inline min=0");
  assertContains(result, "100", "should inline max=100");
}

// ============================================================================
// Run all tests
// ============================================================================

console.log("=== Staged Interpreter Tests ===\n");
console.log("--- Basic Staging ---\n");

test("add3 partial specialization", testAdd3);
console.log();

test("conditional elimination", testConditionalElimination);
console.log();

test("conditional preserved", testConditionalPreserved);
console.log();

test("full evaluation", testFullEvaluation);
console.log();

test("field access", testFieldAccess);
console.log();

test("nested conditional", testNestedConditional);
console.log();

test("literal type comparison", testLiteralTypeComparison);
console.log();

test("object construction", testObjectConstruction);
console.log();

console.log("--- Refinement System ---\n");

test("redundant check elimination", testRedundantCheckElimination);
console.log();

test("equality refinement", testEqualityRefinement);
console.log();

test("inequality transitivity", testInequalityTransitivity);
console.log();

test("negation refinement", testNegationRefinement);
console.log();

test("clamp pattern", testClampPattern);
console.log();

console.log("--- Reflection System ---\n");

test("typeOf reflection", testTypeOf);
console.log();

test("fields reflection", testFields);
console.log();

test("hasField reflection", testHasField);
console.log();

test("hasField as type guard", testHasFieldTypeGuard);
console.log();

test("typeTag reflection", testTypeTag);
console.log();

test("typeToString reflection", testTypeToString);
console.log();

console.log("--- Parser ---\n");

test("parse: literals", testParseLiterals);
console.log();

test("parse: variables", testParseVariables);
console.log();

test("parse: binary ops", testParseBinaryOps);
console.log();

test("parse: precedence", testParsePrecedence);
console.log();

test("parse: ternary", testParseTernary);
console.log();

test("parse: objects", testParseObjects);
console.log();

test("parse: field access", testParseFieldAccess);
console.log();

test("parse: function calls", testParseFunctionCalls);
console.log();

test("parse: reflection", testParseReflection);
console.log();

test("parse: complex expression", testParseComplex);
console.log();

test("parse: function definition", testParseFunctionDef);
console.log();

test("parse: end-to-end", testParseEndToEnd);
console.log();

console.log("--- JavaScript Generation ---\n");

test("js gen: arithmetic execution", testJsGenArithmetic);
console.log();

test("js gen: conditional execution", testJsGenConditional);
console.log();

test("js gen: object construction", testJsGenObject);
console.log();

test("js gen: field access", testJsGenFieldAccess);
console.log();

test("js gen: string operations", testJsGenStrings);
console.log();

test("js gen: boolean logic", testJsGenBooleans);
console.log();

test("js gen: nested conditionals", testJsGenNestedConditionals);
console.log();

test("js gen: complex specialization", testJsGenComplexSpecialization);
console.log();

console.log("--- Advanced Tests ---\n");

test("nested object access", testNestedObjectAccess);
console.log();

test("mixed object construction", testMixedObjectConstruction);
console.log();

test("string concatenation", testStringConcatenation);
console.log();

test("boolean AND", testBooleanAnd);
console.log();

test("boolean OR", testBooleanOr);
console.log();

test("deep refinement", testDeepRefinement);
console.log();

test("combined refinements", testCombinedRefinements);
console.log();

test("all comparisons", testAllComparisons);
console.log();

test("arithmetic", testArithmetic);
console.log();

test("dispatch pattern", testDispatchPattern);
console.log();

test("type op pick", testTypeOpPick);
console.log();

test("type op omit", testTypeOpOmit);
console.log();

test("type op merge", testTypeOpMerge);
console.log();

test("fieldType reflection", testFieldType);
console.log();

test("isSubtype reflection", testIsSubtype);
console.log();

test("chained fields with guard", testChainedFieldsWithGuard);
console.log();

test("complex expression", testComplexExpression);
console.log();

test("full evaluation complex", testFullEvaluationComplex);
console.log();

// ============================================================================
// First-class function tests
// ============================================================================

console.log("--- First-class Functions ---");
console.log();

function testLambdaBasic() {
  // Create a lambda expression: (x) => x * 2
  const double = lambda(["x"], binOp("*", varRef("x"), lit(2)));

  // Evaluate the lambda - should return a closure
  const result = evaluate(double, new Env(), emptyContext());

  if (!isNow(result)) {
    throw new Error("Lambda should evaluate to now value");
  }

  if (!isClosure(result.value)) {
    throw new Error("Lambda should evaluate to closure");
  }

  console.log("  Lambda created: (x) => x * 2");
}

function testLambdaCall() {
  // Create and call: ((x) => x * 2)(5)
  const double = lambda(["x"], binOp("*", varRef("x"), lit(2)));
  const callExpr = call(double, lit(5));

  const result = evaluate(callExpr, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  ((x) => x * 2)(5) = 10");
}

function testLambdaAsValue() {
  // Store a lambda in a variable and call it
  // :def double = (x) => x * 2
  // double(5)
  const double = lambda(["x"], binOp("*", varRef("x"), lit(2)));
  const doubleVal = evaluate(double, new Env(), emptyContext());
  let env = new Env().set("double", doubleVal);

  const callExpr = call(varRef("double"), lit(7));
  const result = evaluate(callExpr, env, emptyContext());

  if (!isNow(result) || result.value !== 14) {
    throw new Error(`Expected 14, got ${(result as { value: unknown }).value}`);
  }

  console.log("  :def double = (x) => x * 2; double(7) = 14");
}

function testLambdaParsing() {
  // Parse a lambda expression
  const ast = parse("(x, y) => x + y");

  if (ast.tag !== "lambda") {
    throw new Error(`Expected lambda, got ${ast.tag}`);
  }

  const lambdaExpr = ast as { params: string[]; body: Expr; tag: "lambda" };
  if (lambdaExpr.params.length !== 2 || lambdaExpr.params[0] !== "x" || lambdaExpr.params[1] !== "y") {
    throw new Error(`Wrong params: ${lambdaExpr.params}`);
  }

  console.log("  Parsed: (x, y) => x + y");
}

function testLambdaParsingAndCall() {
  // Parse and evaluate: ((x) => x * 2)(5)
  const ast = parse("((x) => x * 2)(5)");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Parsed: ((x) => x * 2)(5) = 10");
}

function testLambdaDefAndCall() {
  // Simulate REPL session:
  // :def add = (a, b) => a + b
  // add(3, 4)
  const addLambda = parse("(a, b) => a + b");
  const addVal = evaluate(addLambda, new Env(), emptyContext());
  let env = new Env().set("add", addVal);

  const callAst = parse("add(3, 4)");
  const result = evaluate(callAst, env, emptyContext());

  if (!isNow(result) || result.value !== 7) {
    throw new Error(`Expected 7, got ${(result as { value: unknown }).value}`);
  }

  console.log("  :def add = (a, b) => a + b; add(3, 4) = 7");
}

function testClosureCapture() {
  // Test that closures capture their environment
  // :def x = 10
  // :def addX = (y) => x + y
  // addX(5) should equal 15
  let env = new Env().set("x", nowValue(numberType, 10));

  const addX = parse("(y) => x + y");
  const addXVal = evaluate(addX, env, emptyContext());
  env = env.set("addX", addXVal);

  const callAst = parse("addX(5)");
  const result = evaluate(callAst, env, emptyContext());

  if (!isNow(result) || result.value !== 15) {
    throw new Error(`Expected 15, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Closure captures x=10: addX(5) = 15");
}

function testHigherOrderFunction() {
  // Test a function that takes a function as argument
  // :def apply = (f, x) => f(x)
  // :def double = (x) => x * 2
  // apply(double, 5) should equal 10
  let env = new Env();

  const double = parse("(x) => x * 2");
  const doubleVal = evaluate(double, env, emptyContext());
  env = env.set("double", doubleVal);

  const apply = parse("(f, x) => f(x)");
  const applyVal = evaluate(apply, env, emptyContext());
  env = env.set("apply", applyVal);

  const callAst = parse("apply(double, 5)");
  const result = evaluate(callAst, env, emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Higher-order: apply(double, 5) = 10");
}

function testLambdaWithLater() {
  // Test lambda with "later" argument
  // :def double = (x) => x * 2
  // We specialize with x unknown
  const fn: FunctionDef = {
    name: "useDouble",
    params: ["double", "x"],
    body: call(varRef("double"), varRef("x")),
  };

  // Create a double function and specialize
  const double = lambda(["y"], binOp("*", varRef("y"), lit(2)));
  const doubleVal = evaluate(double, new Env(), emptyContext());

  const code = specialize(fn, { double: doubleVal.value }, [{ name: "x", type: numberType }]);

  console.log("  Specialized with double closure:");
  console.log("  ", code);

  // The generated code should apply the closure logic
  assertContains(code, "x", "should have x in output");
}

function testImmediatelyInvokedLambda() {
  // Test IIFE-style: ((x) => x + 1)(10)
  const ast = parse("((x) => x + 1)(10)");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 11) {
    throw new Error(`Expected 11, got ${(result as { value: unknown }).value}`);
  }

  console.log("  IIFE: ((x) => x + 1)(10) = 11");
}

test("lambda basic", testLambdaBasic);
test("lambda call", testLambdaCall);
test("lambda as value", testLambdaAsValue);
test("lambda parsing", testLambdaParsing);
test("lambda parsing and call", testLambdaParsingAndCall);
test("lambda def and call", testLambdaDefAndCall);
test("closure capture", testClosureCapture);
test("higher order function", testHigherOrderFunction);
test("lambda with later", testLambdaWithLater);
test("immediately invoked lambda", testImmediatelyInvokedLambda);
console.log();

// ============================================================================
// Let binding tests
// ============================================================================

console.log("--- Let Bindings ---");
console.log();

function testLetBasic() {
  // let x = 5 in x * 2
  const expr = letExpr("x", lit(5), binOp("*", varRef("x"), lit(2)));
  const result = evaluate(expr, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  let x = 5 in x * 2 = 10");
}

function testLetNested() {
  // let x = 5 in let y = 3 in x + y
  const expr = letExpr(
    "x", lit(5),
    letExpr("y", lit(3), binOp("+", varRef("x"), varRef("y")))
  );
  const result = evaluate(expr, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 8) {
    throw new Error(`Expected 8, got ${(result as { value: unknown }).value}`);
  }

  console.log("  let x = 5 in let y = 3 in x + y = 8");
}

function testLetShadowing() {
  // let x = 5 in let x = 10 in x
  // Inner x should shadow outer x
  const expr = letExpr(
    "x", lit(5),
    letExpr("x", lit(10), varRef("x"))
  );
  const result = evaluate(expr, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  let x = 5 in let x = 10 in x = 10 (shadowing)");
}

function testLetWithLambda() {
  // let double = (x) => x * 2 in double(5)
  const expr = letExpr(
    "double",
    lambda(["x"], binOp("*", varRef("x"), lit(2))),
    call(varRef("double"), lit(5))
  );
  const result = evaluate(expr, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  let double = (x) => x * 2 in double(5) = 10");
}

function testLetParsing() {
  // Parse: let x = 5 in x * 2
  const ast = parse("let x = 5 in x * 2");

  if (ast.tag !== "let") {
    throw new Error(`Expected let, got ${ast.tag}`);
  }

  console.log("  Parsed: let x = 5 in x * 2");
}

function testLetParsingAndEval() {
  // Parse and evaluate: let x = 5 in x * 2
  const ast = parse("let x = 5 in x * 2");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 10) {
    throw new Error(`Expected 10, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Parsed & evaluated: let x = 5 in x * 2 = 10");
}

function testLetNestedParsing() {
  // Parse: let x = 5 in let y = 3 in x + y
  const ast = parse("let x = 5 in let y = 3 in x + y");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 8) {
    throw new Error(`Expected 8, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Parsed: let x = 5 in let y = 3 in x + y = 8");
}

function testLetWithFunction() {
  // let add = (a, b) => a + b in add(3, 4)
  const ast = parse("let add = (a, b) => a + b in add(3, 4)");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 7) {
    throw new Error(`Expected 7, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Parsed: let add = (a, b) => a + b in add(3, 4) = 7");
}

function testLetComplex() {
  // let x = 10 in let f = (y) => x + y in f(5)
  // Tests closure capture within let
  const ast = parse("let x = 10 in let f = (y) => x + y in f(5)");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== 15) {
    throw new Error(`Expected 15, got ${(result as { value: unknown }).value}`);
  }

  console.log("  Parsed: let x = 10 in let f = (y) => x + y in f(5) = 15");
}

function testLetInConditional() {
  // (let x = 5 in x > 3) ? "yes" : "no"
  const ast = parse("(let x = 5 in x > 3) ? \"yes\" : \"no\"");
  const result = evaluate(ast, new Env(), emptyContext());

  if (!isNow(result) || result.value !== "yes") {
    throw new Error(`Expected "yes", got ${(result as { value: unknown }).value}`);
  }

  console.log("  Parsed: (let x = 5 in x > 3) ? \"yes\" : \"no\" = \"yes\"");
}

test("let basic", testLetBasic);
test("let nested", testLetNested);
test("let shadowing", testLetShadowing);
test("let with lambda", testLetWithLambda);
test("let parsing", testLetParsing);
test("let parsing and eval", testLetParsingAndEval);
test("let nested parsing", testLetNestedParsing);
test("let with function", testLetWithFunction);
test("let complex", testLetComplex);
test("let in conditional", testLetInConditional);
console.log();

// ============================================================================
// Unification tests
// ============================================================================

console.log("--- Unification ---");
console.log();

function testUnifyPrimitives() {
  // Same primitives unify
  const r1 = unify(numberType, numberType);
  if (!r1.success) throw new Error("number should unify with number");

  // Different primitives don't unify
  const r2 = unify(numberType, stringType);
  if (r2.success) throw new Error("number should not unify with string");

  console.log("  number ~ number ✓, number ~ string ✗");
}

function testUnifyTypeVar() {
  resetTypeVarCounter();
  const t = typeVar("T");

  // Type var unifies with anything
  const r1 = unify(t, numberType);
  if (!r1.success) throw new Error("T should unify with number");
  if (r1.subst.get(t.id)?.tag !== "primitive") {
    throw new Error("T should be bound to number");
  }

  console.log("  T ~ number => T = number");
}

function testUnifyTwoTypeVars() {
  resetTypeVarCounter();
  const t1 = typeVar("T");
  const t2 = typeVar("U");

  // Two type vars unify with each other
  const r = unify(t1, t2);
  if (!r.success) throw new Error("T should unify with U");

  // One should be bound to the other
  const bound = r.subst.get(t1.id) || r.subst.get(t2.id);
  if (!bound) throw new Error("One type var should be bound");

  console.log("  T ~ U => T = U (or U = T)");
}

function testUnifyFunction() {
  resetTypeVarCounter();
  const t = typeVar("T");
  const u = typeVar("U");

  // (T) => U  ~  (number) => string
  const fn1 = functionType([t], u);
  const fn2 = functionType([numberType], stringType);

  const r = unify(fn1, fn2);
  if (!r.success) throw new Error("Functions should unify");

  const resolvedT = applySubst(t, r.subst);
  const resolvedU = applySubst(u, r.subst);

  if (resolvedT.tag !== "primitive" || (resolvedT as any).name !== "number") {
    throw new Error(`T should be number, got ${typeToString(resolvedT)}`);
  }
  if (resolvedU.tag !== "primitive" || (resolvedU as any).name !== "string") {
    throw new Error(`U should be string, got ${typeToString(resolvedU)}`);
  }

  console.log("  (T) => U ~ (number) => string => T = number, U = string");
}

function testUnifyObject() {
  resetTypeVarCounter();
  const t = typeVar("T");

  // { x: T, y: number }  ~  { x: string, y: number }
  const obj1 = objectType([
    { name: "x", type: t },
    { name: "y", type: numberType },
  ]);
  const obj2 = objectType([
    { name: "x", type: stringType },
    { name: "y", type: numberType },
  ]);

  const r = unify(obj1, obj2);
  if (!r.success) throw new Error("Objects should unify");

  const resolvedT = applySubst(t, r.subst);
  if (resolvedT.tag !== "primitive" || (resolvedT as any).name !== "string") {
    throw new Error(`T should be string, got ${typeToString(resolvedT)}`);
  }

  console.log("  { x: T, y: number } ~ { x: string, y: number } => T = string");
}

function testUnifyArray() {
  resetTypeVarCounter();
  const t = typeVar("T");

  // T[]  ~  number[]
  const arr1 = arrayType(t);
  const arr2 = arrayType(numberType);

  const r = unify(arr1, arr2);
  if (!r.success) throw new Error("Arrays should unify");

  const resolvedT = applySubst(t, r.subst);
  if (resolvedT.tag !== "primitive" || (resolvedT as any).name !== "number") {
    throw new Error(`T should be number, got ${typeToString(resolvedT)}`);
  }

  console.log("  T[] ~ number[] => T = number");
}

function testUnifyLiteralWithPrimitive() {
  // Literal 5 should unify with number
  const r1 = unify(literalType(5), numberType);
  if (!r1.success) throw new Error("5 should unify with number");

  // Literal "hello" should unify with string
  const r2 = unify(literalType("hello"), stringType);
  if (!r2.success) throw new Error("'hello' should unify with string");

  // Literal 5 should NOT unify with string
  const r3 = unify(literalType(5), stringType);
  if (r3.success) throw new Error("5 should not unify with string");

  console.log("  5 ~ number ✓, 'hello' ~ string ✓, 5 ~ string ✗");
}

function testUnifyTransitive() {
  resetTypeVarCounter();
  const t = typeVar("T");
  const u = typeVar("U");

  // T ~ U, then U ~ number => T = number
  const pairs: Array<[TypeValue, TypeValue]> = [
    [t, u],
    [u, numberType],
  ];

  const r = unifyAll(pairs);
  if (!r.success) throw new Error("Transitive unification should succeed");

  const resolvedT = applySubst(t, r.subst);
  if (resolvedT.tag !== "primitive" || (resolvedT as any).name !== "number") {
    throw new Error(`T should be number, got ${typeToString(resolvedT)}`);
  }

  console.log("  T ~ U, U ~ number => T = number");
}

function testUnifyOccursCheck() {
  resetTypeVarCounter();
  const t = typeVar("T");

  // T  ~  T[]  should fail (infinite type)
  const arr = arrayType(t);
  const r = unify(t, arr);

  if (r.success) throw new Error("Occurs check should prevent infinite type");

  console.log("  T ~ T[] fails (infinite type)");
}

function testUnifyComplex() {
  resetTypeVarCounter();
  const t = typeVar("T");
  const u = typeVar("U");

  // ((T) => U, T)  ~  ((number) => string, number)
  const fn = functionType([t], u);
  const pair1 = objectType([
    { name: "f", type: fn },
    { name: "x", type: t },
  ]);
  const pair2 = objectType([
    { name: "f", type: functionType([numberType], stringType) },
    { name: "x", type: numberType },
  ]);

  const r = unify(pair1, pair2);
  if (!r.success) throw new Error("Complex unification should succeed");

  const resolvedT = applySubst(t, r.subst);
  const resolvedU = applySubst(u, r.subst);

  if (resolvedT.tag !== "primitive" || (resolvedT as any).name !== "number") {
    throw new Error(`T should be number`);
  }
  if (resolvedU.tag !== "primitive" || (resolvedU as any).name !== "string") {
    throw new Error(`U should be string`);
  }

  console.log("  { f: (T) => U, x: T } ~ { f: (number) => string, x: number } => T = number, U = string");
}

test("unify primitives", testUnifyPrimitives);
test("unify type var", testUnifyTypeVar);
test("unify two type vars", testUnifyTwoTypeVars);
test("unify function", testUnifyFunction);
test("unify object", testUnifyObject);
test("unify array", testUnifyArray);
test("unify literal with primitive", testUnifyLiteralWithPrimitive);
test("unify transitive", testUnifyTransitive);
test("unify occurs check", testUnifyOccursCheck);
test("unify complex", testUnifyComplex);
console.log();

console.log("=== Tests Complete ===");

// ============================================================================
// Reflection tests
// ============================================================================

/**
 * Reflection test 1: typeOf returns the type of a value
 */
function testTypeOf() {
  // Create an environment with an object
  const env = new Env().set(
    "obj",
    nowValue(
      objectType([
        { name: "x", type: numberType },
        { name: "y", type: stringType },
      ]),
      { x: 10, y: "hello" }
    )
  );

  // typeOf(obj) should return the type
  const result = evaluate(typeOf(varRef("obj")), env);

  console.log("typeOf(obj) result:");
  if (isNow(result)) {
    const typeVal = result.value as TypeValue;
    console.log("  Type tag:", typeVal.tag);
    if (typeVal.tag === "object") {
      console.log("  Fields:", typeVal.fields.map((f) => f.name).join(", "));
    }
  }

  // Result should be a metatype (type of types)
  assertEqual(result.type.tag, "metatype", "typeOf should return metatype");
  if (isNow(result)) {
    const typeVal = result.value as TypeValue;
    assertEqual(typeVal.tag, "object", "should be object type");
  }
}

/**
 * Reflection test 2: fields returns field names
 */
function testFields() {
  const env = new Env().set(
    "obj",
    nowValue(
      objectType([
        { name: "a", type: numberType },
        { name: "b", type: stringType },
        { name: "c", type: boolType },
      ]),
      { a: 1, b: "x", c: true }
    )
  );

  const result = evaluate(fields(varRef("obj")), env);

  console.log("fields(obj) result:");
  if (isNow(result)) {
    console.log("  Fields:", result.value);
  }

  // Result should be an array of field names
  assertEqual(result.type.tag, "array", "fields should return array");
  if (isNow(result)) {
    const fieldNames = result.value as string[];
    assertEqual(fieldNames.length, 3, "should have 3 fields");
    assertContains(fieldNames.join(","), "a", "should include 'a'");
    assertContains(fieldNames.join(","), "b", "should include 'b'");
    assertContains(fieldNames.join(","), "c", "should include 'c'");
  }
}

/**
 * Reflection test 3: hasField checks if type has a field
 */
function testHasField() {
  const env = new Env().set(
    "obj",
    nowValue(objectType([{ name: "x", type: numberType }]), { x: 10 })
  );

  const hasX = evaluate(hasField(varRef("obj"), lit("x")), env);
  const hasY = evaluate(hasField(varRef("obj"), lit("y")), env);

  console.log("hasField results:");
  console.log("  hasField(obj, 'x'):", isNow(hasX) ? hasX.value : "later");
  console.log("  hasField(obj, 'y'):", isNow(hasY) ? hasY.value : "later");

  assertEqual(isNow(hasX) && hasX.value, true, "should have field x");
  assertEqual(isNow(hasY) && hasY.value, false, "should not have field y");
}

/**
 * Reflection test 4: hasField as type guard for conditional elimination
 * (Architecture doc section 4.2)
 */
function testHasFieldTypeGuard() {
  // if (hasField(obj, "value")) { obj.value } else { 0 }
  // When obj type has "value", the condition is statically true
  const getValue: FunctionDef = {
    name: "getValue",
    params: ["obj"],
    body: ifExpr(hasField(varRef("obj"), lit("value")), field(varRef("obj"), "value"), lit(0)),
  };

  // Specialize with an object that HAS a value field
  const resultWithValue = specialize(getValue, {}, [
    {
      name: "obj",
      type: objectType([{ name: "value", type: numberType }]),
    },
  ]);

  console.log("getValue with value field:");
  console.log(resultWithValue);

  // Specialize with an object that does NOT have a value field
  const resultWithoutValue = specialize(getValue, {}, [
    {
      name: "obj",
      type: objectType([{ name: "other", type: numberType }]),
    },
  ]);

  console.log("getValue without value field:");
  console.log(resultWithoutValue);

  // With value field: should eliminate conditional
  assertNotContains(resultWithValue, "?", "conditional should be eliminated when field exists");
  assertContains(resultWithValue, "obj.value", "should access obj.value");

  // Without value field: should eliminate conditional to just return 0
  assertNotContains(resultWithoutValue, "?", "conditional should be eliminated when field missing");
  assertContains(resultWithoutValue, "0", "should return 0");
}

/**
 * Reflection test 5: typeTag returns the tag of a type
 */
function testTypeTag() {
  const env = new Env()
    .set("num", nowValue(numberType, 42))
    .set("obj", nowValue(objectType([{ name: "x", type: numberType }]), { x: 1 }));

  const numTag = evaluate(typeTag(typeOf(varRef("num"))), env);
  const objTag = evaluate(typeTag(typeOf(varRef("obj"))), env);

  console.log("typeTag results:");
  console.log("  typeTag(typeOf(num)):", isNow(numTag) ? numTag.value : "later");
  console.log("  typeTag(typeOf(obj)):", isNow(objTag) ? objTag.value : "later");

  assertEqual(isNow(numTag) && numTag.value, "primitive", "number should have primitive tag");
  assertEqual(isNow(objTag) && objTag.value, "object", "object should have object tag");
}

/**
 * Reflection test 6: typeToString converts type to string
 */
function testTypeToString() {
  const env = new Env().set(
    "obj",
    nowValue(
      objectType([
        { name: "x", type: numberType },
        { name: "name", type: stringType },
      ]),
      { x: 1, name: "test" }
    )
  );

  const result = evaluate(typeToStringExpr(typeOf(varRef("obj"))), env);

  console.log("typeToString(typeOf(obj)):");
  if (isNow(result)) {
    console.log(" ", result.value);
  }

  assertEqual(result.type.tag, "primitive", "should return string");
  if (isNow(result)) {
    assertContains(result.value as string, "x", "should include field x");
    assertContains(result.value as string, "name", "should include field name");
  }
}

// ============================================================================
// Advanced Tests
// ============================================================================

/**
 * Test nested object field access with partial specialization
 */
function testNestedObjectAccess() {
  // obj.user.profile.name where user and profile are known but name access is runtime
  const getProfileName: FunctionDef = {
    name: "getProfileName",
    params: ["obj"],
    body: field(field(field(varRef("obj"), "user"), "profile"), "name"),
  };

  const result = specialize(getProfileName, {}, [
    {
      name: "obj",
      type: objectType([
        {
          name: "user",
          type: objectType([
            {
              name: "profile",
              type: objectType([{ name: "name", type: stringType }]),
            },
          ]),
        },
      ]),
    },
  ]);

  console.log("Nested object access:");
  console.log(result);
  assertContains(result, "obj.user.profile.name", "should chain field access");
}

/**
 * Test object construction with mixed now/later fields
 */
function testMixedObjectConstruction() {
  const makeUser: FunctionDef = {
    name: "makeUser",
    params: ["id", "role", "timestamp"],
    body: obj([
      { name: "id", value: varRef("id") },
      { name: "role", value: varRef("role") },
      { name: "isAdmin", value: binOp("==", varRef("role"), lit("admin")) },
      { name: "createdAt", value: varRef("timestamp") },
    ]),
  };

  // role is known, id and timestamp are not
  const result = specialize(makeUser, { role: "admin" }, [
    { name: "id", type: numberType },
    { name: "timestamp", type: numberType },
  ]);

  console.log("Mixed object construction (role=admin):");
  console.log(result);
  assertContains(result, 'role: "admin"', "should inline role");
  assertContains(result, "isAdmin: true", "should compute isAdmin statically");
}

/**
 * Test string concatenation staging
 */
function testStringConcatenation() {
  const greet: FunctionDef = {
    name: "greet",
    params: ["prefix", "name", "suffix"],
    body: binOp("+", binOp("+", varRef("prefix"), varRef("name")), varRef("suffix")),
  };

  // prefix and suffix are known
  const result = specialize(greet, { prefix: "Hello, ", suffix: "!" }, [
    { name: "name", type: stringType },
  ]);

  console.log("String concatenation (prefix and suffix known):");
  console.log(result);
  assertContains(result, '"Hello, "', "should inline prefix");
  assertContains(result, '"!"', "should inline suffix");
}

/**
 * Test boolean AND with short-circuit elimination
 */
function testBooleanAnd() {
  // if (a && b) { 1 } else { 0 }
  // When a is known false, entire condition is false
  const checkBoth: FunctionDef = {
    name: "checkBoth",
    params: ["a", "b"],
    body: ifExpr(binOp("&&", varRef("a"), varRef("b")), lit(1), lit(0)),
  };

  const resultFalse = specialize(checkBoth, { a: false }, [{ name: "b", type: boolType }]);
  console.log("Boolean AND with a=false:");
  console.log(resultFalse);
  assertContains(resultFalse, "0", "should return 0 when a is false");
  assertNotContains(resultFalse, "?", "conditional should be eliminated");

  const resultTrue = specialize(checkBoth, { a: true }, [{ name: "b", type: boolType }]);
  console.log("Boolean AND with a=true:");
  console.log(resultTrue);
  assertContains(resultTrue, "b", "should depend on b when a is true");
}

/**
 * Test boolean OR with short-circuit elimination
 */
function testBooleanOr() {
  // if (a || b) { 1 } else { 0 }
  // When a is known true, entire condition is true
  const checkEither: FunctionDef = {
    name: "checkEither",
    params: ["a", "b"],
    body: ifExpr(binOp("||", varRef("a"), varRef("b")), lit(1), lit(0)),
  };

  const resultTrue = specialize(checkEither, { a: true }, [{ name: "b", type: boolType }]);
  console.log("Boolean OR with a=true:");
  console.log(resultTrue);
  assertContains(resultTrue, "1", "should return 1 when a is true");
  assertNotContains(resultTrue, "?", "conditional should be eliminated");

  const resultFalse = specialize(checkEither, { a: false }, [{ name: "b", type: boolType }]);
  console.log("Boolean OR with a=false:");
  console.log(resultFalse);
  assertContains(resultFalse, "b", "should depend on b when a is false");
}

/**
 * Test deeply nested conditionals with refinement propagation
 * Note: Current refinement system handles same-bound transitivity (x < 5 => x < 10)
 * but not cross-operator implications (x > 0 => x > -5)
 */
function testDeepRefinement() {
  // if (x < 5) {
  //   if (x < 10) {  // Always true! x < 5 implies x < 10
  //     if (x < 2) { "small" }
  //     else { "medium" }
  //   } else { "impossible" }
  // } else { "big" }
  const deepCheck: FunctionDef = {
    name: "deepCheck",
    params: ["x"],
    body: ifExpr(
      binOp("<", varRef("x"), lit(5)),
      ifExpr(
        binOp("<", varRef("x"), lit(10)), // x < 5 implies x < 10 (same direction transitivity)
        ifExpr(binOp("<", varRef("x"), lit(2)), lit("small"), lit("medium")),
        lit("impossible")
      ),
      lit("big")
    ),
  };

  const result = specialize(deepCheck, {}, [{ name: "x", type: numberType }]);

  console.log("Deep refinement:");
  console.log(result);
  assertNotContains(result, "impossible", "impossible branch should be eliminated");
}

/**
 * Test combining same-type refinements
 * Testing direct equality redundancy elimination
 */
function testCombinedRefinements() {
  // if (x == 5) {
  //   if (x == 5) { "a" }  // Redundant - we know x == 5
  //   else { "b" }
  // } else if (x != 5) {
  //   if (x == 5) { "c" }  // Contradicts outer condition
  //   else { "d" }
  // } else { "e" }
  const combined: FunctionDef = {
    name: "combined",
    params: ["x"],
    body: ifExpr(
      binOp("==", varRef("x"), lit(5)),
      ifExpr(binOp("==", varRef("x"), lit(5)), lit("a"), lit("b")), // Inner is redundant
      ifExpr(
        binOp("!=", varRef("x"), lit(5)),
        ifExpr(binOp("==", varRef("x"), lit(5)), lit("c"), lit("d")), // Inner contradicts outer
        lit("e")
      )
    ),
  };

  const result = specialize(combined, {}, [{ name: "x", type: numberType }]);

  console.log("Combined refinements:");
  console.log(result);
  assertNotContains(result, '"b"', 'unreachable "b" should be eliminated');
  assertNotContains(result, '"c"', 'unreachable "c" should be eliminated');
}

/**
 * Test comparison operators (<, <=, >, >=)
 */
function testAllComparisons() {
  const check: FunctionDef = {
    name: "check",
    params: ["x"],
    body: ifExpr(
      binOp("<=", varRef("x"), lit(5)),
      ifExpr(binOp(">=", varRef("x"), lit(0)), lit("valid"), lit("too_low")),
      lit("too_high")
    ),
  };

  const result = specialize(check, {}, [{ name: "x", type: numberType }]);

  console.log("All comparisons (<=, >=):");
  console.log(result);
  // Both conditionals should remain - we can't statically determine x
  const questionMarks = (result.match(/\?/g) || []).length;
  assertEqual(questionMarks, 2, "should have two conditionals");
}

/**
 * Test arithmetic operations with partial evaluation
 */
function testArithmetic() {
  // (a + 5) * (b - 3) / 2
  const compute: FunctionDef = {
    name: "compute",
    params: ["a", "b", "c"],
    body: binOp("/", binOp("*", binOp("+", varRef("a"), lit(5)), binOp("-", varRef("b"), varRef("c"))), lit(2)),
  };

  // c is known to be 3
  const result = specialize(compute, { c: 3 }, [
    { name: "a", type: numberType },
    { name: "b", type: numberType },
  ]);

  console.log("Arithmetic with c=3:");
  console.log(result);
  assertContains(result, "- 3", "should inline c=3");
}

/**
 * Test literal type with multiple possible values (dispatch pattern)
 */
function testDispatchPattern() {
  // Simulates a type-based dispatch
  const dispatch: FunctionDef = {
    name: "dispatch",
    params: ["action"],
    body: ifExpr(
      binOp("==", field(varRef("action"), "type"), lit("create")),
      lit("creating"),
      ifExpr(
        binOp("==", field(varRef("action"), "type"), lit("update")),
        lit("updating"),
        ifExpr(binOp("==", field(varRef("action"), "type"), lit("delete")), lit("deleting"), lit("unknown"))
      )
    ),
  };

  // Specialize for "update" action
  const result = specialize(dispatch, {}, [
    {
      name: "action",
      type: objectType([{ name: "type", type: literalType("update") }]),
    },
  ]);

  console.log("Dispatch pattern (type='update'):");
  console.log(result);
  assertContains(result, "updating", "should resolve to updating");
  assertNotContains(result, "?", "all conditionals should be eliminated");
}

/**
 * Test type operations: pick
 */
function testTypeOpPick() {
  const env = new Env()
    .set(
      "obj",
      nowValue(
        objectType([
          { name: "a", type: numberType },
          { name: "b", type: stringType },
          { name: "c", type: boolType },
        ]),
        { a: 1, b: "x", c: true }
      )
    )
    .set("fieldNames", nowValue(arrayType(stringType), ["a", "c"]));

  // pick(typeOf(obj), fieldNames)
  const result = evaluate(pick(typeOf(varRef("obj")), varRef("fieldNames")), env);

  console.log("pick(['a', 'c']) result:");
  if (isNow(result)) {
    const typeVal = getTypeValue(result);
    if (typeVal.tag === "object") {
      console.log("  Fields:", typeVal.fields.map((f) => f.name).join(", "));
    }
  }

  if (isNow(result)) {
    const typeVal = getTypeValue(result);
    assertEqual(typeVal.tag, "object", "should be object type");
    if (typeVal.tag === "object") {
      assertEqual(typeVal.fields.length, 2, "should have 2 fields");
      assertEqual(typeVal.fields[0].name, "a", "first field should be a");
      assertEqual(typeVal.fields[1].name, "c", "second field should be c");
    }
  }
}

/**
 * Test type operations: omit
 */
function testTypeOpOmit() {
  const env = new Env()
    .set(
      "obj",
      nowValue(
        objectType([
          { name: "a", type: numberType },
          { name: "b", type: stringType },
          { name: "c", type: boolType },
        ]),
        { a: 1, b: "x", c: true }
      )
    )
    .set("omitFields", nowValue(arrayType(stringType), ["b"]));

  // omit(typeOf(obj), omitFields)
  const result = evaluate(omit(typeOf(varRef("obj")), varRef("omitFields")), env);

  console.log("omit(['b']) result:");
  if (isNow(result)) {
    const typeVal = getTypeValue(result);
    if (typeVal.tag === "object") {
      console.log("  Fields:", typeVal.fields.map((f) => f.name).join(", "));
    }
  }

  if (isNow(result)) {
    const typeVal = getTypeValue(result);
    assertEqual(typeVal.tag, "object", "should be object type");
    if (typeVal.tag === "object") {
      assertEqual(typeVal.fields.length, 2, "should have 2 fields");
      const fNames = typeVal.fields.map((f) => f.name);
      assertEqual(fNames.includes("b"), false, "should not include b");
    }
  }
}

/**
 * Test type operations: merge
 */
function testTypeOpMerge() {
  const env = new Env()
    .set(
      "obj1",
      nowValue(
        objectType([
          { name: "a", type: numberType },
          { name: "b", type: stringType },
        ]),
        { a: 1, b: "x" }
      )
    )
    .set(
      "obj2",
      nowValue(
        objectType([
          { name: "b", type: numberType }, // Override b with different type
          { name: "c", type: boolType },
        ]),
        { b: 2, c: true }
      )
    );

  // merge(typeOf(obj1), typeOf(obj2))
  const result = evaluate(merge(typeOf(varRef("obj1")), typeOf(varRef("obj2"))), env);

  console.log("merge result:");
  if (isNow(result)) {
    const typeVal = getTypeValue(result);
    if (typeVal.tag === "object") {
      console.log(
        "  Fields:",
        typeVal.fields.map((f) => `${f.name}: ${f.type.tag === "primitive" ? f.type.name : f.type.tag}`).join(", ")
      );
    }
  }

  if (isNow(result)) {
    const typeVal = getTypeValue(result);
    assertEqual(typeVal.tag, "object", "should be object type");
    if (typeVal.tag === "object") {
      assertEqual(typeVal.fields.length, 3, "should have 3 fields");
      const bField = typeVal.fields.find((f) => f.name === "b");
      assertEqual(bField?.type.tag, "primitive", "b should be primitive");
      if (bField?.type.tag === "primitive") {
        assertEqual(bField.type.name, "number", "b should be number (overridden)");
      }
    }
  }
}

/**
 * Test fieldType reflection
 */
function testFieldType() {
  const env = new Env().set(
    "obj",
    nowValue(
      objectType([
        { name: "count", type: numberType },
        { name: "name", type: stringType },
        { name: "active", type: boolType },
      ]),
      { count: 5, name: "test", active: true }
    )
  );

  const countType = evaluate(fieldType(varRef("obj"), lit("count")), env);
  const nameType = evaluate(fieldType(varRef("obj"), lit("name")), env);

  console.log("fieldType results:");
  if (isNow(countType)) {
    const t = getTypeValue(countType);
    console.log("  fieldType(obj, 'count'):", t.tag === "primitive" ? t.name : t.tag);
  }
  if (isNow(nameType)) {
    const t = getTypeValue(nameType);
    console.log("  fieldType(obj, 'name'):", t.tag === "primitive" ? t.name : t.tag);
  }

  if (isNow(countType)) {
    const t = getTypeValue(countType);
    assertEqual(t.tag, "primitive", "count should be primitive");
    if (t.tag === "primitive") assertEqual(t.name, "number", "count should be number");
  }
  if (isNow(nameType)) {
    const t = getTypeValue(nameType);
    assertEqual(t.tag, "primitive", "name should be primitive");
    if (t.tag === "primitive") assertEqual(t.name, "string", "name should be string");
  }
}

/**
 * Test isSubtype reflection
 */
function testIsSubtype() {
  const env = new Env()
    .set(
      "wide",
      nowValue(objectType([{ name: "x", type: numberType }]), { x: 1 })
    )
    .set(
      "narrow",
      nowValue(
        objectType([
          { name: "x", type: numberType },
          { name: "y", type: stringType },
        ]),
        { x: 1, y: "test" }
      )
    );

  // narrow is subtype of wide (has all fields of wide plus more)
  const narrowSubWide = evaluate(isSubtypeExpr(typeOf(varRef("narrow")), typeOf(varRef("wide"))), env);
  // wide is NOT subtype of narrow (missing y field)
  const wideSubNarrow = evaluate(isSubtypeExpr(typeOf(varRef("wide")), typeOf(varRef("narrow"))), env);

  console.log("isSubtype results:");
  console.log("  narrow <: wide:", isNow(narrowSubWide) ? narrowSubWide.value : "later");
  console.log("  wide <: narrow:", isNow(wideSubNarrow) ? wideSubNarrow.value : "later");

  assertEqual(isNow(narrowSubWide) && narrowSubWide.value, true, "narrow should be subtype of wide");
  assertEqual(isNow(wideSubNarrow) && wideSubNarrow.value, false, "wide should not be subtype of narrow");
}

/**
 * Test chained field access with early termination
 */
function testChainedFieldsWithGuard() {
  // if (hasField(obj, "data")) { obj.data.value } else { 0 }
  // This tests combining hasField guard with nested access
  const safeAccess: FunctionDef = {
    name: "safeAccess",
    params: ["obj"],
    body: ifExpr(
      hasField(varRef("obj"), lit("data")),
      field(field(varRef("obj"), "data"), "value"),
      lit(0)
    ),
  };

  const resultWithData = specialize(safeAccess, {}, [
    {
      name: "obj",
      type: objectType([
        {
          name: "data",
          type: objectType([{ name: "value", type: numberType }]),
        },
      ]),
    },
  ]);

  console.log("Chained field access with hasField guard:");
  console.log(resultWithData);
  assertContains(resultWithData, "obj.data.value", "should access nested field");
  assertNotContains(resultWithData, "?", "conditional should be eliminated");
}

/**
 * Test complex expression with multiple operations
 */
function testComplexExpression() {
  // (a + b) * c > 10 && d == "active"
  const complex: FunctionDef = {
    name: "complex",
    params: ["a", "b", "c", "d"],
    body: binOp(
      "&&",
      binOp(">", binOp("*", binOp("+", varRef("a"), varRef("b")), varRef("c")), lit(10)),
      binOp("==", varRef("d"), lit("active"))
    ),
  };

  // Specialize with d="active" (partial match on &&)
  const result = specialize(complex, { d: "active" }, [
    { name: "a", type: numberType },
    { name: "b", type: numberType },
    { name: "c", type: numberType },
  ]);

  console.log("Complex expression (d='active'):");
  console.log(result);
  // The d == "active" part should be eliminated, leaving just the numeric comparison
  assertNotContains(result, '"active"', "active comparison should be eliminated");
}

/**
 * Test full evaluation with complex nested structure
 */
function testFullEvaluationComplex() {
  const expr: FunctionDef = {
    name: "calc",
    params: ["a", "b", "c", "flag"],
    body: ifExpr(
      varRef("flag"),
      binOp("+", binOp("*", varRef("a"), varRef("b")), varRef("c")),
      binOp("-", varRef("a"), binOp("/", varRef("b"), varRef("c")))
    ),
  };

  const resultTrue = evaluateFully(expr, { a: 10, b: 4, c: 2, flag: true });
  const resultFalse = evaluateFully(expr, { a: 10, b: 4, c: 2, flag: false });

  console.log("Full evaluation complex:");
  console.log("  flag=true: (10 * 4) + 2 =", resultTrue);
  console.log("  flag=false: 10 - (4 / 2) =", resultFalse);

  assertEqual(resultTrue, 42, "(10 * 4) + 2 = 42");
  assertEqual(resultFalse, 8, "10 - (4 / 2) = 8");
}

// ============================================================================
// JavaScript Generation Tests
// ============================================================================

/**
 * Helper to execute generated JavaScript and return result
 */
function executeGenerated(code: string, ...args: unknown[]): unknown {
  // Extract function name from generated code
  const match = code.match(/function\s+(\w+)/);
  if (!match) throw new Error("Could not find function name in generated code");
  const fnName = match[1];

  // Create function and execute
  const fn = new Function(`${code}; return ${fnName};`)();
  return fn(...args);
}

/**
 * Test: Generated arithmetic code executes correctly
 */
function testJsGenArithmetic() {
  const compute: FunctionDef = {
    name: "compute",
    params: ["a", "b", "multiplier"],
    body: binOp("*", binOp("+", varRef("a"), varRef("b")), varRef("multiplier")),
  };

  // Specialize with multiplier=10
  const code = specialize(compute, { multiplier: 10 }, [
    { name: "a", type: numberType },
    { name: "b", type: numberType },
  ]);

  console.log("Generated arithmetic:");
  console.log(code);

  // Execute the generated code
  const result = executeGenerated(code, 3, 7); // (3 + 7) * 10 = 100
  console.log("  execute(3, 7) =", result);

  assertEqual(result, 100, "(3 + 7) * 10 = 100");
}

/**
 * Test: Generated conditional code executes correctly
 */
function testJsGenConditional() {
  const max: FunctionDef = {
    name: "max",
    params: ["a", "b"],
    body: ifExpr(binOp(">", varRef("a"), varRef("b")), varRef("a"), varRef("b")),
  };

  const code = specialize(max, {}, [
    { name: "a", type: numberType },
    { name: "b", type: numberType },
  ]);

  console.log("Generated conditional:");
  console.log(code);

  // Test various inputs
  assertEqual(executeGenerated(code, 10, 5), 10, "max(10, 5) = 10");
  assertEqual(executeGenerated(code, 3, 8), 8, "max(3, 8) = 8");
  assertEqual(executeGenerated(code, 5, 5), 5, "max(5, 5) = 5");

  console.log("  max(10, 5) = 10, max(3, 8) = 8, max(5, 5) = 5");
}

/**
 * Test: Generated object construction code executes correctly
 */
function testJsGenObject() {
  const makePoint: FunctionDef = {
    name: "makePoint",
    params: ["x", "y", "label"],
    body: obj([
      { name: "x", value: varRef("x") },
      { name: "y", value: varRef("y") },
      { name: "label", value: varRef("label") },
      { name: "sum", value: binOp("+", varRef("x"), varRef("y")) },
    ]),
  };

  // Specialize with label known
  const code = specialize(makePoint, { label: "origin" }, [
    { name: "x", type: numberType },
    { name: "y", type: numberType },
  ]);

  console.log("Generated object:");
  console.log(code);

  const result = executeGenerated(code, 3, 4) as Record<string, unknown>;
  console.log("  execute(3, 4) =", result);

  assertEqual(result.x, 3, "x = 3");
  assertEqual(result.y, 4, "y = 4");
  assertEqual(result.label, "origin", "label = origin");
  assertEqual(result.sum, 7, "sum = 7");
}

/**
 * Test: Generated field access code executes correctly
 */
function testJsGenFieldAccess() {
  const getDistance: FunctionDef = {
    name: "getDistance",
    params: ["point"],
    body: binOp(
      "+",
      binOp("*", field(varRef("point"), "x"), field(varRef("point"), "x")),
      binOp("*", field(varRef("point"), "y"), field(varRef("point"), "y"))
    ),
  };

  const code = specialize(getDistance, {}, [
    {
      name: "point",
      type: objectType([
        { name: "x", type: numberType },
        { name: "y", type: numberType },
      ]),
    },
  ]);

  console.log("Generated field access:");
  console.log(code);

  // x² + y² for point (3, 4) = 9 + 16 = 25
  const result = executeGenerated(code, { x: 3, y: 4 });
  console.log("  execute({x: 3, y: 4}) =", result);

  assertEqual(result, 25, "3² + 4² = 25");
}

/**
 * Test: Generated string operations execute correctly
 */
function testJsGenStrings() {
  const greet: FunctionDef = {
    name: "greet",
    params: ["title", "name", "punctuation"],
    body: binOp("+", binOp("+", binOp("+", varRef("title"), lit(" ")), varRef("name")), varRef("punctuation")),
  };

  // Specialize with title and punctuation known
  const code = specialize(greet, { title: "Hello", punctuation: "!" }, [
    { name: "name", type: stringType },
  ]);

  console.log("Generated strings:");
  console.log(code);

  const result = executeGenerated(code, "World");
  console.log('  execute("World") =', result);

  assertEqual(result, "Hello World!", 'greet("World") = "Hello World!"');
}

/**
 * Test: Generated boolean logic executes correctly
 */
function testJsGenBooleans() {
  const inRange: FunctionDef = {
    name: "inRange",
    params: ["x", "min", "max"],
    body: binOp("&&", binOp(">=", varRef("x"), varRef("min")), binOp("<=", varRef("x"), varRef("max"))),
  };

  // Specialize with min=0, max=100
  const code = specialize(inRange, { min: 0, max: 100 }, [{ name: "x", type: numberType }]);

  console.log("Generated booleans:");
  console.log(code);

  assertEqual(executeGenerated(code, 50), true, "inRange(50) = true");
  assertEqual(executeGenerated(code, -1), false, "inRange(-1) = false");
  assertEqual(executeGenerated(code, 101), false, "inRange(101) = false");
  assertEqual(executeGenerated(code, 0), true, "inRange(0) = true");
  assertEqual(executeGenerated(code, 100), true, "inRange(100) = true");

  console.log("  inRange(50)=true, inRange(-1)=false, inRange(101)=false");
}

/**
 * Test: Generated nested conditionals execute correctly
 */
function testJsGenNestedConditionals() {
  const classify: FunctionDef = {
    name: "classify",
    params: ["score"],
    body: ifExpr(
      binOp(">=", varRef("score"), lit(90)),
      lit("A"),
      ifExpr(
        binOp(">=", varRef("score"), lit(80)),
        lit("B"),
        ifExpr(
          binOp(">=", varRef("score"), lit(70)),
          lit("C"),
          ifExpr(binOp(">=", varRef("score"), lit(60)), lit("D"), lit("F"))
        )
      )
    ),
  };

  const code = specialize(classify, {}, [{ name: "score", type: numberType }]);

  console.log("Generated nested conditionals:");
  console.log(code);

  assertEqual(executeGenerated(code, 95), "A", "classify(95) = A");
  assertEqual(executeGenerated(code, 85), "B", "classify(85) = B");
  assertEqual(executeGenerated(code, 75), "C", "classify(75) = C");
  assertEqual(executeGenerated(code, 65), "D", "classify(65) = D");
  assertEqual(executeGenerated(code, 55), "F", "classify(55) = F");

  console.log("  95=A, 85=B, 75=C, 65=D, 55=F");
}

/**
 * Test: Complex specialization generates correct executable code
 */
function testJsGenComplexSpecialization() {
  // A more realistic example: price calculator with discounts
  const calculatePrice: FunctionDef = {
    name: "calculatePrice",
    params: ["quantity", "unitPrice", "discountRate", "taxRate"],
    body: binOp(
      "*",
      binOp(
        "-",
        binOp("*", varRef("quantity"), varRef("unitPrice")),
        binOp("*", binOp("*", varRef("quantity"), varRef("unitPrice")), varRef("discountRate"))
      ),
      binOp("+", lit(1), varRef("taxRate"))
    ),
  };

  // Specialize for a specific discount (10%) and tax rate (8%)
  const code = specialize(calculatePrice, { discountRate: 0.1, taxRate: 0.08 }, [
    { name: "quantity", type: numberType },
    { name: "unitPrice", type: numberType },
  ]);

  console.log("Generated complex specialization:");
  console.log(code);

  // Calculate: (100 * 10 - 100 * 10 * 0.1) * 1.08
  //          = (1000 - 100) * 1.08
  //          = 900 * 1.08
  //          = 972
  const result = executeGenerated(code, 100, 10) as number;
  console.log("  execute(quantity=100, unitPrice=10) =", result);

  // Use approximate comparison due to floating-point precision
  assertApproxEqual(result, 972, 0.001, "100 items at $10 with 10% discount and 8% tax = $972");
}

// ============================================================================
// Parser Tests
// ============================================================================

/**
 * Helper to compare AST nodes
 */
function astEquals(a: Expr, b: Expr): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertAstEquals(actual: Expr, expected: Expr, msg: string) {
  if (!astEquals(actual, expected)) {
    throw new Error(`${msg}:\nExpected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(actual)}`);
  }
}

/**
 * Test parsing literals
 */
function testParseLiterals() {
  // Numbers
  assertAstEquals(parse("42"), lit(42), "integer");
  assertAstEquals(parse("3.14"), lit(3.14), "float");
  assertAstEquals(parse("-5"), lit(-5), "negative");

  // Strings
  assertAstEquals(parse('"hello"'), lit("hello"), "double quoted string");
  assertAstEquals(parse("'world'"), lit("world"), "single quoted string");
  assertAstEquals(parse('"say \\"hi\\""'), lit('say "hi"'), "escaped quotes");

  // Booleans
  assertAstEquals(parse("true"), lit(true), "true");
  assertAstEquals(parse("false"), lit(false), "false");

  console.log("  Parsed: 42, 3.14, -5, \"hello\", 'world', true, false");
}

/**
 * Test parsing variable references
 */
function testParseVariables() {
  assertAstEquals(parse("x"), varRef("x"), "single letter");
  assertAstEquals(parse("foo"), varRef("foo"), "word");
  assertAstEquals(parse("camelCase"), varRef("camelCase"), "camelCase");
  assertAstEquals(parse("_private"), varRef("_private"), "underscore prefix");
  assertAstEquals(parse("var123"), varRef("var123"), "with numbers");

  console.log("  Parsed: x, foo, camelCase, _private, var123");
}

/**
 * Test parsing binary operators
 */
function testParseBinaryOps() {
  // Arithmetic
  assertAstEquals(parse("a + b"), binOp("+", varRef("a"), varRef("b")), "addition");
  assertAstEquals(parse("a - b"), binOp("-", varRef("a"), varRef("b")), "subtraction");
  assertAstEquals(parse("a * b"), binOp("*", varRef("a"), varRef("b")), "multiplication");
  assertAstEquals(parse("a / b"), binOp("/", varRef("a"), varRef("b")), "division");

  // Comparison
  assertAstEquals(parse("a < b"), binOp("<", varRef("a"), varRef("b")), "less than");
  assertAstEquals(parse("a > b"), binOp(">", varRef("a"), varRef("b")), "greater than");
  assertAstEquals(parse("a <= b"), binOp("<=", varRef("a"), varRef("b")), "less or equal");
  assertAstEquals(parse("a >= b"), binOp(">=", varRef("a"), varRef("b")), "greater or equal");
  assertAstEquals(parse("a == b"), binOp("==", varRef("a"), varRef("b")), "equal");
  assertAstEquals(parse("a != b"), binOp("!=", varRef("a"), varRef("b")), "not equal");

  // Logical
  assertAstEquals(parse("a && b"), binOp("&&", varRef("a"), varRef("b")), "and");
  assertAstEquals(parse("a || b"), binOp("||", varRef("a"), varRef("b")), "or");

  console.log("  Parsed: +, -, *, /, <, >, <=, >=, ==, !=, &&, ||");
}

/**
 * Test operator precedence
 */
function testParsePrecedence() {
  // * binds tighter than +
  assertAstEquals(
    parse("a + b * c"),
    binOp("+", varRef("a"), binOp("*", varRef("b"), varRef("c"))),
    "multiplication before addition"
  );

  // Parentheses override precedence
  assertAstEquals(
    parse("(a + b) * c"),
    binOp("*", binOp("+", varRef("a"), varRef("b")), varRef("c")),
    "parentheses override"
  );

  // Comparison before logical
  assertAstEquals(
    parse("a < b && c > d"),
    binOp("&&", binOp("<", varRef("a"), varRef("b")), binOp(">", varRef("c"), varRef("d"))),
    "comparison before logical"
  );

  // Complex precedence
  assertAstEquals(
    parse("a + b * c < d - e"),
    binOp("<",
      binOp("+", varRef("a"), binOp("*", varRef("b"), varRef("c"))),
      binOp("-", varRef("d"), varRef("e"))
    ),
    "complex precedence"
  );

  console.log("  Verified: * > +, && after <, parentheses work");
}

/**
 * Test parsing ternary conditional
 */
function testParseTernary() {
  assertAstEquals(
    parse("a ? b : c"),
    ifExpr(varRef("a"), varRef("b"), varRef("c")),
    "simple ternary"
  );

  assertAstEquals(
    parse("x > 0 ? 1 : 0"),
    ifExpr(binOp(">", varRef("x"), lit(0)), lit(1), lit(0)),
    "ternary with comparison"
  );

  // Nested ternary (right associative)
  assertAstEquals(
    parse("a ? b : c ? d : e"),
    ifExpr(varRef("a"), varRef("b"), ifExpr(varRef("c"), varRef("d"), varRef("e"))),
    "nested ternary"
  );

  console.log("  Parsed: a ? b : c, nested ternary");
}

/**
 * Test parsing object literals
 */
function testParseObjects() {
  // Empty object
  assertAstEquals(parse("{}"), obj([]), "empty object");

  // Single field
  assertAstEquals(
    parse("{ x: 1 }"),
    obj([{ name: "x", value: lit(1) }]),
    "single field"
  );

  // Multiple fields
  assertAstEquals(
    parse('{ x: 1, y: "hello", z: true }'),
    obj([
      { name: "x", value: lit(1) },
      { name: "y", value: lit("hello") },
      { name: "z", value: lit(true) },
    ]),
    "multiple fields"
  );

  // Nested object
  assertAstEquals(
    parse("{ point: { x: 1, y: 2 } }"),
    obj([{ name: "point", value: obj([
      { name: "x", value: lit(1) },
      { name: "y", value: lit(2) },
    ])}]),
    "nested object"
  );

  // Expression values
  assertAstEquals(
    parse("{ sum: a + b }"),
    obj([{ name: "sum", value: binOp("+", varRef("a"), varRef("b")) }]),
    "expression value"
  );

  console.log("  Parsed: {}, {x:1}, {x:1,y:2}, nested, expressions");
}

/**
 * Test parsing field access
 */
function testParseFieldAccess() {
  assertAstEquals(parse("obj.x"), field(varRef("obj"), "x"), "simple field");
  assertAstEquals(
    parse("obj.x.y"),
    field(field(varRef("obj"), "x"), "y"),
    "chained field"
  );
  assertAstEquals(
    parse("a.b.c.d"),
    field(field(field(varRef("a"), "b"), "c"), "d"),
    "deep chain"
  );

  // Field access on expression
  assertAstEquals(
    parse("(a + b).result"),
    field(binOp("+", varRef("a"), varRef("b")), "result"),
    "field on expression"
  );

  console.log("  Parsed: obj.x, obj.x.y, a.b.c.d, (expr).field");
}

/**
 * Test parsing function calls
 */
function testParseFunctionCalls() {
  // No args
  assertAstEquals(parse("foo()"), call("foo"), "no args");

  // Single arg
  assertAstEquals(parse("foo(1)"), call("foo", lit(1)), "single arg");

  // Multiple args
  assertAstEquals(
    parse("foo(1, 2, 3)"),
    call("foo", lit(1), lit(2), lit(3)),
    "multiple args"
  );

  // Expression args
  assertAstEquals(
    parse("foo(a + b, c * d)"),
    call("foo", binOp("+", varRef("a"), varRef("b")), binOp("*", varRef("c"), varRef("d"))),
    "expression args"
  );

  console.log("  Parsed: foo(), foo(1), foo(1,2,3), foo(a+b)");
}

/**
 * Test parsing reflection built-ins
 */
function testParseReflection() {
  assertAstEquals(parse("typeOf(x)"), typeOf(varRef("x")), "typeOf");
  assertAstEquals(parse("fields(obj)"), fields(varRef("obj")), "fields");
  assertAstEquals(
    parse('hasField(obj, "x")'),
    hasField(varRef("obj"), lit("x")),
    "hasField"
  );
  assertAstEquals(
    parse('fieldType(obj, "name")'),
    fieldType(varRef("obj"), lit("name")),
    "fieldType"
  );
  assertAstEquals(parse("typeTag(typeOf(x))"), typeTag(typeOf(varRef("x"))), "typeTag");

  console.log("  Parsed: typeOf, fields, hasField, fieldType, typeTag");
}

/**
 * Test parsing complex expressions
 */
function testParseComplex() {
  // Real-world-ish expression
  const source = 'obj.type == "greeting" ? "Hello, " + obj.name : "Unknown"';
  const expected = ifExpr(
    binOp("==", field(varRef("obj"), "type"), lit("greeting")),
    binOp("+", lit("Hello, "), field(varRef("obj"), "name")),
    lit("Unknown")
  );

  assertAstEquals(parse(source), expected, "message handler");
  console.log("  Parsed:", source);

  // Nested calculation
  const calcSource = "(a + b) * c > 10 && d < 20";
  const calcExpected = binOp("&&",
    binOp(">", binOp("*", binOp("+", varRef("a"), varRef("b")), varRef("c")), lit(10)),
    binOp("<", varRef("d"), lit(20))
  );

  assertAstEquals(parse(calcSource), calcExpected, "nested calculation");
  console.log("  Parsed:", calcSource);
}

/**
 * Test parsing function definitions
 */
function testParseFunctionDef() {
  const result = parseFunction("(x, y) => x + y");
  assertEqual(result.params.length, 2, "param count");
  assertEqual(result.params[0], "x", "first param");
  assertEqual(result.params[1], "y", "second param");
  assertAstEquals(result.body, binOp("+", varRef("x"), varRef("y")), "body");
  console.log("  Parsed: (x, y) => x + y");

  const result2 = parseFunction("(a) => a * 2 + 1");
  assertEqual(result2.params.length, 1, "single param count");
  assertAstEquals(
    result2.body,
    binOp("+", binOp("*", varRef("a"), lit(2)), lit(1)),
    "single param body"
  );
  console.log("  Parsed: (a) => a * 2 + 1");

  const result3 = parseFunction("(obj) => obj.x > 0 ? obj.x : 0");
  assertAstEquals(
    result3.body,
    ifExpr(
      binOp(">", field(varRef("obj"), "x"), lit(0)),
      field(varRef("obj"), "x"),
      lit(0)
    ),
    "ternary body"
  );
  console.log("  Parsed: (obj) => obj.x > 0 ? obj.x : 0");
}

/**
 * Test end-to-end: parse, specialize, execute
 */
function testParseEndToEnd() {
  // Parse a function
  const { params, body } = parseFunction("(x, multiplier) => x * multiplier + 10");

  // Create a FunctionDef
  const fn: FunctionDef = {
    name: "compute",
    params,
    body,
  };

  // Specialize with multiplier=5
  const code = specialize(fn, { multiplier: 5 }, [{ name: "x", type: numberType }]);
  console.log("  Generated:", code);

  // Execute
  const result = executeGenerated(code, 7); // 7 * 5 + 10 = 45
  console.log("  execute(7) =", result);
  assertEqual(result, 45, "7 * 5 + 10 = 45");

  // Another example with ternary
  const { params: p2, body: b2 } = parseFunction("(x, threshold) => x > threshold ? x : threshold");
  const fn2: FunctionDef = { name: "clampMin", params: p2, body: b2 };
  const code2 = specialize(fn2, { threshold: 10 }, [{ name: "x", type: numberType }]);
  console.log("  Generated:", code2);

  assertEqual(executeGenerated(code2, 5), 10, "clampMin(5) = 10");
  assertEqual(executeGenerated(code2, 15), 15, "clampMin(15) = 15");
  console.log("  clampMin(5)=10, clampMin(15)=15");
}
