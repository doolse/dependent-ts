/**
 * Complex Example: What this language can currently do
 *
 * This demonstrates the most sophisticated program we can write
 * with the current feature set.
 */

import {
  parseAndRun,
  parse,
  stage,
  compile,
  constraintToString,
  valueToString,
  isNow,
  isLater,
  exprToString,
} from "../src/index";

// ============================================================================
// Example 1: Higher-Order Functions with Type Inference
// ============================================================================

console.log("=== Example 1: Higher-Order Functions ===\n");

// A combinator library
const combinators = `
let compose = fn(f, g) => fn(x) => f(g(x)) in
let twice = fn(f) => fn(x) => f(f(x)) in
let add1 = fn(x) => x + 1 in
let mul2 = fn(x) => x * 2 in

let add2 = twice(add1) in
let add4 = twice(add2) in

[add4(0), compose(mul2, add1)(5), twice(mul2)(3)]
`;

const result1 = parseAndRun(combinators);
console.log("Combinators result:", valueToString(result1.value));
console.log("Type:", constraintToString(result1.constraint));
console.log();

// ============================================================================
// Example 2: Control Flow Refinement
// ============================================================================

console.log("=== Example 2: Control Flow Refinement ===\n");

// Demonstrate type narrowing through control flow
const refinement = `
let clamp = fn(x, lo, hi) =>
  if x < lo then lo
  else if x > hi then hi
  else x
in
let abs = fn(x) =>
  if x < 0 then -x else x
in
let sign = fn(x) =>
  if x > 0 then 1
  else if x < 0 then -1
  else 0
in

{ clamped: clamp(15, 0, 10), absolute: abs(-42), sign: sign(-5) }
`;

const result2 = parseAndRun(refinement);
console.log("Refinement result:", valueToString(result2.value));
console.log("Type:", constraintToString(result2.constraint));
console.log();

// ============================================================================
// Example 3: Staged Computation (Partial Evaluation)
// ============================================================================

console.log("=== Example 3: Staged Computation ===\n");

// Show how staging works - some computation at compile time, some at runtime
const staging = `
let square = fn(x) => x * x in
let cube = fn(x) => x * x * x in

let compiletimeValue = comptime(square(5) + cube(3)) in
let runtimeValue = runtime(n: 10) in

compiletimeValue + runtimeValue
`;

const stageResult = stage(parse(staging));
if (isNow(stageResult.svalue)) {
  console.log("Fully evaluated at compile time:", valueToString(stageResult.svalue.value));
} else {
  console.log("Residual code:", exprToString(stageResult.svalue.residual));
  console.log("Inferred type:", constraintToString(stageResult.svalue.constraint));

  // Generate JavaScript
  const jsCode = compile(parse(staging));
  console.log("Generated JS:", jsCode);
}
console.log();

// ============================================================================
// Example 4: Object Operations
// ============================================================================

console.log("=== Example 4: Object Operations ===\n");

const objects = `
let person = { name: "Alice", age: 30, active: true } in

{
  extractedName: person.name,
  extractedAge: person.age,
  adultCheck: person.age >= 18,
  nested: { inner: { value: person.age * 2 } }
}
`;

const result4 = parseAndRun(objects);
console.log("Objects result:", valueToString(result4.value));
console.log("Type:", constraintToString(result4.constraint));
console.log();

// ============================================================================
// Example 5: Array Operations (Functional Style)
// ============================================================================

console.log("=== Example 5: Array-like Operations ===\n");

const arrays = `
let arr = [10, 20, 30, 40, 50] in

{
  original: arr,
  firstElement: arr[0],
  lastElement: arr[4],
  sumOfFirstTwo: arr[0] + arr[1],
  pairExtract: [arr[0], arr[4]]
}
`;

const result5 = parseAndRun(arrays);
console.log("Arrays result:", valueToString(result5.value));
console.log("Type:", constraintToString(result5.constraint));
console.log();

// ============================================================================
// Example 6: Recursive Functions
// ============================================================================

console.log("=== Example 6: Recursive Functions ===\n");

// Real recursion using named functions: fn name(params) => body
const recursiveFunctions = `
let factorial = fn fact(n) => if n == 0 then 1 else n * fact(n - 1) in
let fibonacci = fn fib(n) => if n <= 1 then n else fib(n - 1) + fib(n - 2) in

{ factorial5: factorial(5), fibonacci10: fibonacci(10) }
`;

const result6 = parseAndRun(recursiveFunctions);
console.log("Factorial & Fibonacci:", valueToString(result6.value));
console.log("Type:", constraintToString(result6.constraint));
console.log();

// ============================================================================
// Example 7: Type-Level Programming (Reflection)
// ============================================================================

console.log("=== Example 7: Type Reflection ===\n");

// Types as first-class values - number, string, boolean are type values
const typeReflection = `
{
  numberType: number,
  stringType: string,
  typesAreValues: number == number,
  differentTypes: number == string
}
`;

const result7 = parseAndRun(typeReflection);
console.log("Type reflection result:", valueToString(result7.value));
console.log();

// ============================================================================
// Example 8: Assertions and Type Guards
// ============================================================================

console.log("=== Example 8: Assertions ===\n");

const assertions = `
let checkPositive = fn(x) =>
  if x > 0 then x else 0
in

let safeDiv = fn(a, b) =>
  if b != 0 then a / b else 0
in

let validated =
  let x = 42 in
  let y = assert(x < 100) in
  x
in

{
  positiveCheck: checkPositive(-5),
  safeDivision: safeDiv(10, 3),
  validated: validated
}
`;

const result8 = parseAndRun(assertions);
console.log("Assertions result:", valueToString(result8.value));
console.log("Type:", constraintToString(result8.constraint));
console.log();

// ============================================================================
// Example 9: String Operations
// ============================================================================

console.log("=== Example 9: String Concatenation ===\n");

const strings = `
let name = "World" in
let first = "John" in
let last = "Doe" in

{
  greeting: "Hello, " + name + "!",
  fullName: first + " " + last,
  concat: "a" + "b" + "c" + "d"
}
`;

const result9 = parseAndRun(strings);
console.log("Strings result:", valueToString(result9.value));
console.log("Type:", constraintToString(result9.constraint));
console.log();

// ============================================================================
// Example 10: The Most Complex Program
// ============================================================================

console.log("=== Example 10: Complex Combined Example ===\n");

// A mini "interpreter" for a simple expression language
// (as complex as we can get without recursion)
const complex = `
let makeOp = fn(op, a, b) =>
  { operation: op, left: a, right: b, result:
    if op == "add" then a + b
    else if op == "sub" then a - b
    else if op == "mul" then a * b
    else if op == "div" then if b != 0 then a / b else 0
    else 0
  }
in

let evalChain = fn(x) =>
  let step1 = makeOp("add", x, 10) in
  let step2 = makeOp("mul", step1.result, 2) in
  let step3 = makeOp("sub", step2.result, 5) in
  {
    input: x,
    steps: [step1, step2, step3],
    finalResult: step3.result
  }
in

let pipeline = evalChain(5) in

{
  pipelineResult: pipeline,
  explanation: "Computed: ((5 + 10) * 2) - 5 = 25"
}
`;

const result10 = parseAndRun(complex);
console.log("Complex result:", valueToString(result10.value));
console.log();

// ============================================================================
// Summary
// ============================================================================

console.log("=== Summary ===\n");
console.log("This language currently supports:");
console.log("  ✓ First-class functions with closures");
console.log("  ✓ Higher-order functions (compose, twice, etc.)");
console.log("  ✓ Recursive functions (fn name(params) => body)");
console.log("  ✓ Objects and arrays with type inference");
console.log("  ✓ Control flow with type refinement");
console.log("  ✓ Compile-time (comptime) vs runtime staging");
console.log("  ✓ JavaScript code generation");
console.log("  ✓ Types as first-class values");
console.log("  ✓ Type reflection (fields, fieldType)");
console.log("  ✓ Assertions (assert, trust)");
console.log("  ✓ String concatenation");
console.log();
console.log("Missing for practical use:");
console.log("  ✗ IO (print, input, files)");
console.log("  ✗ Array operations (map, filter, reduce)");
console.log("  ✗ Module system");
console.log("  ✗ Error handling (try/catch)");
