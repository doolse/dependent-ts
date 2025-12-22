/**
 * Complex example demonstrating the staged interpreter's capabilities:
 * - Let polymorphism (generics)
 * - Higher-order functions
 * - Type reflection
 * - Partial evaluation / specialization
 * - Code generation
 */

import {
  parse,
  parseFunction,
  specialize,
  evaluate,
  infer,
  typeToString,
  numberType,
  stringType,
  boolType,
  objectType,
  arrayType,
  FunctionDef,
  Env,
  emptyContext,
  isNow,
} from "./index";

// Helper to evaluate an expression and get the value
function evalExpr(code: string): unknown {
  const result = evaluate(parse(code), new Env(), emptyContext());
  if (!isNow(result)) {
    throw new Error("Expected fully evaluated result");
  }
  return result.value;
}

console.log("=".repeat(70));
console.log("Complex Staged Interpreter Example");
console.log("=".repeat(70));
console.log();

// ============================================================================
// Part 1: Polymorphic Functions
// ============================================================================
console.log("--- Part 1: Polymorphic Functions ---\n");

// Identity function used at multiple types
const polyExample1 = `
let id = (x) => x in
let twice = (f, x) => f(f(x)) in
{
  num: twice((n) => n + 1, 5),
  str: id("hello"),
  bool: id(true),
  composed: twice(id, 42)
}
`;

console.log("Expression:");
console.log(polyExample1.trim());
console.log();

const polyResult1 = infer(parse(polyExample1));
if (polyResult1.success) {
  console.log("Inferred type:", typeToString(polyResult1.type));
}

const polyValue1 = evalExpr(polyExample1);
console.log("Evaluated:", JSON.stringify(polyValue1));
console.log();

// ============================================================================
// Part 2: Higher-Order Function Combinators
// ============================================================================
console.log("--- Part 2: Higher-Order Function Combinators ---\n");

const combinatorExample = `
let compose = (f, g, x) => f(g(x)) in
let flip = (f, a, b) => f(b, a) in
let const = (x, y) => x in
let apply = (f, x) => f(x) in
{
  composed: compose((x) => x * 2, (x) => x + 1, 5),
  flipped: flip((a, b) => a - b, 3, 10),
  constant: const("always this", 999),
  applied: apply((x) => x * x, 7)
}
`;

console.log("Expression:");
console.log(combinatorExample.trim());
console.log();

const combResult = infer(parse(combinatorExample));
if (combResult.success) {
  console.log("Inferred type:", typeToString(combResult.type));
}

const combValue = evalExpr(combinatorExample);
console.log("Evaluated:", JSON.stringify(combValue));
console.log();

// ============================================================================
// Part 3: Partial Evaluation / Specialization
// ============================================================================
console.log("--- Part 3: Partial Evaluation (Specialization) ---\n");

// A function that does different things based on a config
const configDrivenFn = parseFunction(`
(config, data) =>
  config.mode == "double" ? data * 2 :
  config.mode == "triple" ? data * 3 :
  config.mode == "square" ? data * data :
  data
`);

const processFn: FunctionDef = {
  name: "process",
  params: configDrivenFn.params,
  body: configDrivenFn.body,
};

console.log("Original function:");
console.log('  (config, data) => config.mode == "double" ? data * 2 : ...');
console.log();

// Specialize for different configs
const configs = [
  { mode: "double" },
  { mode: "triple" },
  { mode: "square" },
  { mode: "unknown" },
];

for (const config of configs) {
  const specialized = specialize(
    processFn,
    { config },
    [{ name: "data", type: numberType }]
  );
  console.log(`Specialized with config.mode="${config.mode}":`);
  console.log(`  ${specialized}`);
}
console.log();

// ============================================================================
// Part 4: Type-Directed Code Generation
// ============================================================================
console.log("--- Part 4: Type-Directed Code Generation ---\n");

// A function that generates different code based on the type it receives
// Note: typeTag returns the tag ("primitive", "object", "array", etc.)
// For primitives, we need to check the actual type differently
const typeDirectedFn = parseFunction(`
(inputType, value) =>
  typeTag(inputType) == "primitive" ? value * 2 :
  typeTag(inputType) == "object" ? value.x :
  typeTag(inputType) == "array" ? 0 :
  value
`);

const typeProcessFn: FunctionDef = {
  name: "typeProcess",
  params: typeDirectedFn.params,
  body: typeDirectedFn.body,
};

console.log("Type-directed function:");
console.log('  typeTag(inputType) == "primitive" ? value * 2 : ...');
console.log();

// Specialize for different type tags
const typeConfigs: Array<{ type: any; valueType: any; desc: string }> = [
  { type: numberType, valueType: numberType, desc: "primitive (number)" },
  { type: objectType([{name: "x", type: numberType}]), valueType: objectType([{name: "x", type: numberType}]), desc: "object" },
  { type: arrayType(numberType), valueType: arrayType(numberType), desc: "array" },
];

for (const { type, valueType, desc } of typeConfigs) {
  const specialized = specialize(
    typeProcessFn,
    { inputType: type },
    [{ name: "value", type: valueType }]
  );
  console.log(`Specialized for ${desc}:`);
  console.log(`  ${specialized}`);
}
console.log();

// ============================================================================
// Part 5: Complex Nested Expressions with Closures
// ============================================================================
console.log("--- Part 5: Complex Nested Expressions ---\n");

const nestedExample = `
let makeAdder = (n) => (x) => x + n in
let makeMult = (n) => (x) => x * n in
let pipe2 = (f, g, x) => g(f(x)) in
let add5 = makeAdder(5) in
let mult3 = makeMult(3) in
{
  simple: add5(10),
  piped: pipe2(add5, mult3, 10),
  nested: pipe2(makeAdder(1), makeAdder(2), 0),
  complex: pipe2(makeMult(2), makeAdder(10), 5)
}
`;

console.log("Expression:");
console.log(nestedExample.trim());
console.log();

const nestedResult = infer(parse(nestedExample));
if (nestedResult.success) {
  console.log("Inferred type:", typeToString(nestedResult.type));
}

const nestedValue = evalExpr(nestedExample);
console.log("Evaluated:", JSON.stringify(nestedValue));
console.log();

// ============================================================================
// Part 6: Conditional Elimination via Specialization
// ============================================================================
console.log("--- Part 6: Conditional Elimination ---\n");

const conditionalFn = parseFunction(`
(flags, x) =>
  flags.debug ? (
    flags.verbose ? x * 100 + 10 + 1 :
    x * 100 + 10
  ) : (
    flags.verbose ? x * 100 + 1 :
    x * 100
  )
`);

const debugFn: FunctionDef = {
  name: "debugProcess",
  params: conditionalFn.params,
  body: conditionalFn.body,
};

console.log("Original: Complex nested conditionals based on flags");
console.log();

const flagConfigs = [
  { debug: true, verbose: true },
  { debug: true, verbose: false },
  { debug: false, verbose: true },
  { debug: false, verbose: false },
];

for (const flags of flagConfigs) {
  const specialized = specialize(
    debugFn,
    { flags },
    [{ name: "x", type: numberType }]
  );
  console.log(`flags = ${JSON.stringify(flags)}:`);
  console.log(`  ${specialized}`);
}
console.log();

// ============================================================================
// Part 7: Object Field Operations with Type Reflection
// ============================================================================
console.log("--- Part 7: Object Field Operations ---\n");

const fieldOpsFn = parseFunction(`
(schema, data) =>
  hasField(schema, "id") ? (
    hasField(schema, "name") ? { id: data.id, name: data.name } :
    { id: data.id }
  ) : (
    hasField(schema, "name") ? { name: data.name } :
    { empty: true }
  )
`);

const extractFn: FunctionDef = {
  name: "extract",
  params: fieldOpsFn.params,
  body: fieldOpsFn.body,
};

console.log("Original: Extract fields based on schema");
console.log();

const schemas = [
  objectType([{ name: "id", type: numberType }, { name: "name", type: stringType }]),
  objectType([{ name: "id", type: numberType }]),
  objectType([{ name: "name", type: stringType }]),
  objectType([{ name: "other", type: numberType }]),
];

const schemaDescs = [
  "{ id: number, name: string }",
  "{ id: number }",
  "{ name: string }",
  "{ other: number }",
];

for (let i = 0; i < schemas.length; i++) {
  const dataType = objectType([
    { name: "id", type: numberType },
    { name: "name", type: stringType },
  ]);
  const specialized = specialize(
    extractFn,
    { schema: schemas[i] },
    [{ name: "data", type: dataType }]
  );
  console.log(`schema = ${schemaDescs[i]}:`);
  console.log(`  ${specialized}`);
}
console.log();

// ============================================================================
// Part 8: Full Pipeline Example
// ============================================================================
console.log("--- Part 8: Full Pipeline ---\n");

// This demonstrates a complete workflow:
// 1. Parse an expression
// 2. Infer its type
// 3. Partially evaluate with some known values
// 4. Generate specialized code

const pipelineExpr = `
let validate = (x, min, max) => x >= min && x <= max in
let clamp = (x, min, max) => x < min ? min : (x > max ? max : x) in
let process = (config, value) =>
  validate(value, config.min, config.max) ?
    clamp(value, config.min, config.max) * config.scale :
    0 in
process({ min: 0, max: 100, scale: 2 }, 75)
`;

console.log("Full expression:");
console.log(pipelineExpr.trim());
console.log();

// Infer type
const pipelineType = infer(parse(pipelineExpr));
if (pipelineType.success) {
  console.log("Inferred type:", typeToString(pipelineType.type));
}

// Evaluate
const pipelineValue = evalExpr(pipelineExpr);
console.log("Evaluated result:", pipelineValue);
console.log();

// Now specialize a version with config known
const pipelineFn = parseFunction(`
(config, value) =>
  (value >= config.min && value <= config.max) ?
    (value < config.min ? config.min : (value > config.max ? config.max : value)) * config.scale :
    0
`);

const processPipelineFn: FunctionDef = {
  name: "processPipeline",
  params: pipelineFn.params,
  body: pipelineFn.body,
};

const specializedPipeline = specialize(
  processPipelineFn,
  { config: { min: 0, max: 100, scale: 2 } },
  [{ name: "value", type: numberType }]
);

console.log("Specialized with config = { min: 0, max: 100, scale: 2 }:");
console.log(specializedPipeline);
console.log();

// Execute the specialized function
const specializedFn = new Function("value", specializedPipeline.replace(/^function.*?\{/, "").replace(/\}$/, ""));
console.log("Execution tests:");
console.log("  processPipeline(50) =", specializedFn(50));   // In range: 50 * 2 = 100
console.log("  processPipeline(-10) =", specializedFn(-10)); // Out of range: 0
console.log("  processPipeline(150) =", specializedFn(150)); // Out of range: 0
console.log("  processPipeline(0) =", specializedFn(0));     // Edge case: 0 * 2 = 0
console.log("  processPipeline(100) =", specializedFn(100)); // Edge case: 100 * 2 = 200

console.log();
console.log("=".repeat(70));
console.log("Example Complete!");
console.log("=".repeat(70));
