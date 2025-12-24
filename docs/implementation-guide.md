# Dependent Type System Implementation Guide

This document provides a deep dive into implementing a dependent type system with **constraints-as-types**. It's aimed at developers who want to understand how this system works and potentially build something similar.

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Constraint System](#2-the-constraint-system)
3. [Values and Expressions](#3-values-and-expressions)
4. [Staged Evaluation](#4-staged-evaluation)
5. [Type Inference](#5-type-inference)
6. [Control Flow Refinement](#6-control-flow-refinement)
7. [Code Generation](#7-code-generation)
8. [Parser and Lexer](#8-parser-and-lexer)
9. [Known Issues and Limitations](#9-known-issues-and-limitations)
10. [Future Work](#10-future-work)

---

## 1. Architecture Overview

### Data Flow

The system processes code through a pipeline:

```
Source Code
    ↓ [Lexer]
Tokens
    ↓ [Parser]
Expression AST (Expr)
    ↓ [Staged Evaluator]
Staged Value (Now | Later)
    ↓ [Code Generator]
JavaScript
```

### Core Insight: Types Are Constraints

Traditional type systems separate "types" from "values". This system unifies them: **a type is a constraint (predicate) that values must satisfy**.

For example:
- `isNumber` is a constraint satisfied by any number
- `equals(5)` is a constraint satisfied only by the value 5
- `and(isNumber, gt(0))` is a constraint satisfied by positive numbers

This unification enables:
- Refinement types naturally (no separate syntax)
- First-class types (types are values)
- Subtyping via logical implication

### The Now/Later Distinction

The evaluator distinguishes between:
- **Now**: Value fully known at compile-time (can compute with it)
- **Later**: Only the constraint is known (generates residual code)

This enables partial evaluation: what can be computed at compile-time is computed; what can't generates efficient runtime code.

```typescript
// @run
import { stage, isNow, isLater, add, num, runtime, constraintToString } from "../src/index";

// All inputs known → result is Now
const allKnown = stage(add(num(2), num(3)));
console.log(isNow(allKnown.svalue));
// Output: true

// Mixed inputs → result is Later with residual code
const mixed = stage(add(num(5), runtime(num(0), "x")));
console.log(isLater(mixed.svalue));
// Output: true
// Constraint is the literal type (5 + 0 = 5)
console.log(constraintToString(mixed.svalue.constraint));
// Output: 5
```

---

## 2. The Constraint System

**File: `src/constraint.ts`**

Constraints are the type system's core. Every type is represented as a `Constraint`.

### Constraint Types

```typescript
type Constraint =
  // Classification (what kind of value)
  | { tag: "isNumber" }
  | { tag: "isString" }
  | { tag: "isBool" }
  | { tag: "isNull" }
  | { tag: "isObject" }
  | { tag: "isArray" }
  | { tag: "isFunction" }

  // Value constraints (refinements)
  | { tag: "equals"; value: unknown }
  | { tag: "gt"; bound: number }
  | { tag: "gte"; bound: number }
  | { tag: "lt"; bound: number }
  | { tag: "lte"; bound: number }

  // Structural constraints
  | { tag: "hasField"; name: string; constraint: Constraint }
  | { tag: "elements"; constraint: Constraint }
  | { tag: "length"; constraint: Constraint }
  | { tag: "elementAt"; index: number; constraint: Constraint }

  // Logical operators
  | { tag: "and"; constraints: Constraint[] }
  | { tag: "or"; constraints: Constraint[] }
  | { tag: "not"; constraint: Constraint }
  | { tag: "never" }  // Unsatisfiable
  | { tag: "any" }    // Always satisfied

  // Advanced
  | { tag: "isType"; constraint: Constraint }  // Meta: value IS a type
  | { tag: "fnType"; params: Constraint[]; result: Constraint }
  | { tag: "rec"; var: string; body: Constraint }  // Recursive types
  | { tag: "recVar"; var: string }
  | { tag: "var"; name: string }  // Constraint variable (for inference)
```

### Building Constraints

```typescript
// @run
import { isNumber, isString, and, or, gt, equals, hasField, constraintToString } from "../src/index";

// Positive number: number & x > 0
const positiveNumber = and(isNumber, gt(0));
console.log(constraintToString(positiveNumber));
// Output: number & > 0

// Literal type: exactly the value 5
const literalFive = and(isNumber, equals(5));
console.log(constraintToString(literalFive));
// Output: 5

// Object with specific field
const hasName = and(isObject, hasField("name", isString));
console.log(constraintToString(hasName));
// Output: { name: string }

// Union type: string | number
const stringOrNumber = or(isString, isNumber);
console.log(constraintToString(stringOrNumber));
// Output: string | number
```

### Subtyping via Implication

`implies(a, b)` returns true if every value satisfying `a` also satisfies `b`. This is the subtyping relation: `a <: b`.

```typescript
// @run
import { implies, isNumber, gt, gte, equals, and } from "../src/index";

// x > 5 implies x > 0 (narrower constraint implies broader)
console.log(implies(gt(5), gt(0)));
// Output: true

// equals(5) implies isNumber (literal type is subtype of base type)
console.log(implies(equals(5), isNumber));
// Output: true

// gt(0) does NOT imply gt(5) (broader does not imply narrower)
console.log(implies(gt(0), gt(5)));
// Output: false
```

### Simplification and Contradiction Detection

`simplify()` normalizes constraints and detects contradictions:

```typescript
// @run
import { simplify, and, or, isNumber, isString, gt, lt, constraintToString, isNever } from "../src/index";

// Flattens nested AND
const nested = and(and(isNumber, gt(0)), gt(5));
console.log(constraintToString(simplify(nested)));
// Output: number & > 0 & > 5

// Detects disjoint types → never
const contradiction = simplify(and(isNumber, isString));
console.log(isNever(contradiction));
// Output: true

// Detects impossible bounds → never
const impossibleBounds = simplify(and(gt(10), lt(5)));
console.log(isNever(impossibleBounds));
// Output: true
```

### Unification

`unify(a, b)` computes the intersection of two constraints:

```typescript
// @run
import { unify, isNumber, gt, constraintToString } from "../src/index";

// Unifying constraints intersects them
const unified = unify(isNumber, gt(0));
console.log(constraintToString(unified));
// Output: number & > 0
```

### Recursive Types

For recursive data structures (like JSON or linked lists), use `rec` and `recVar`:

```typescript
// @run
import { rec, recVar, or, isNull, isNumber, isString, isBool, isArray, isObject, hasField, elements, and, constraintToString } from "../src/index";

// JSON type: null | number | string | boolean | JSON[] | { [k]: JSON }
const jsonType = rec("JSON", or(
  isNull,
  isNumber,
  isString,
  isBool,
  and(isArray, elements(recVar("JSON"))),
  isObject  // Simplified - full impl would have field constraints
));

// The recursion is represented symbolically
console.log(jsonType.tag);
// Output: rec
```

---

## 3. Values and Expressions

### Values (`src/value.ts`)

Values are the runtime representation:

```typescript
type Value =
  | NumberValue    // { tag: "number", value: number }
  | StringValue    // { tag: "string", value: string }
  | BoolValue      // { tag: "bool", value: boolean }
  | NullValue      // { tag: "null" }
  | ObjectValue    // { tag: "object", fields: Map<string, Value> }
  | ArrayValue     // { tag: "array", elements: Value[] }
  | ClosureValue   // { tag: "closure", params, body, env, name? }
  | TypeValue      // { tag: "type", constraint: Constraint }
  | BuiltinValue   // { tag: "builtin", name: string }
```

### Deriving Constraints from Values

`constraintOf(value)` computes the most specific constraint for a value:

```typescript
// @run
import { constraintOf, numberVal, stringVal, objectVal, constraintToString } from "../src/index";

// Numbers get their literal type
const five = numberVal(5);
console.log(constraintToString(constraintOf(five)));
// Output: 5

// Objects get field constraints
const person = objectVal({ name: stringVal("Alice"), age: numberVal(30) });
console.log(constraintToString(constraintOf(person)));
// Output: { name: "Alice", age: 30 }
```

### Checking Value Satisfaction

`valueSatisfies(value, constraint)` checks if a value satisfies a constraint:

```typescript
// @run
import { valueSatisfies, numberVal, isNumber, gt, and } from "../src/index";

const five = numberVal(5);

console.log(valueSatisfies(five, isNumber));
// Output: true

console.log(valueSatisfies(five, and(isNumber, gt(0))));
// Output: true

console.log(valueSatisfies(five, gt(10)));
// Output: false
```

### Expressions (`src/expr.ts`)

Expressions are the AST:

```typescript
type Expr =
  | LitExpr           // 5, "hello", true, null
  | VarExpr           // x
  | BinOpExpr         // x + y, a == b
  | UnaryOpExpr       // -x, !b
  | IfExpr            // if cond then a else b
  | LetExpr           // let x = e1 in e2
  | LetPatternExpr    // let [a, b] = arr in body
  | FnExpr            // fn(x) => x + 1
  | RecFnExpr         // fn fac(n) => if n == 0 then 1 else n * fac(n-1)
  | CallExpr          // f(a, b)
  | ObjExpr           // { x: 1, y: 2 }
  | FieldExpr         // obj.field
  | ArrayExpr         // [1, 2, 3]
  | IndexExpr         // arr[0]
  | ComptimeExpr      // comptime(expr) - force compile-time
  | RuntimeExpr       // runtime(expr) - force runtime
  | AssertExpr        // assert(value, type) - runtime check
  | TrustExpr         // trust(value, type) - no check
  // ... and more
```

### Building Expressions

```typescript
// @run
import { letExpr, fn, add, varRef, call, num, exprToString } from "../src/index";

// Build: let double = fn(x) => x + x in double(5)
const expr = letExpr("double",
  fn(["x"], add(varRef("x"), varRef("x"))),
  call(varRef("double"), num(5))
);

console.log(exprToString(expr));
// Output: let double = fn(x) => (x + x) in double(5)
```

---

## 4. Staged Evaluation

**File: `src/staged-evaluate.ts`**

The staged evaluator is the heart of the system. It performs partial evaluation, distinguishing compile-time known values (Now) from runtime values (Later).

### The SValue Type (`src/svalue.ts`)

```typescript
interface Now {
  stage: "now";
  value: Value;           // The actual value
  constraint: Constraint; // Its type
}

interface Later {
  stage: "later";
  constraint: Constraint; // What we know about the type
  residual: Expr;         // Expression to compute it at runtime
}

type SValue = Now | Later;
```

### Evaluation Rules

**Literals are always Now:**

```typescript
// @run
import { stage, num, str, isNow } from "../src/index";

console.log(isNow(stage(num(42)).svalue));
// Output: true

console.log(isNow(stage(str("hello")).svalue));
// Output: true
```

**Operations on all-Now inputs compute immediately:**

```typescript
// @run
import { stage, add, num, isNow, valueToString } from "../src/index";

const result = stage(add(num(2), num(3)));
if (isNow(result.svalue)) {
  console.log(valueToString(result.svalue.value));
}
// Output: 5
```

**Operations with Later inputs generate residual code:**

```typescript
// @run
import { stage, add, num, runtime, isLater, exprToString } from "../src/index";

// runtime() marks a value as Later
const result = stage(add(runtime(num(0), "x"), num(5)));
if (isLater(result.svalue)) {
  console.log(exprToString(result.svalue.residual));
}
// Output: (x + 5)
```

### Comptime and Runtime Markers

`comptime(expr)` forces compile-time evaluation (errors if Later):

```typescript
// @run
import { stage, comptime, add, num, isNow } from "../src/index";

// This works - all inputs are known
const result = stage(comptime(add(num(2), num(3))));
console.log(isNow(result.svalue));
// Output: true
```

`runtime(expr, name)` forces a Later value with a named variable:

```typescript
// @run
import { stage, runtime, num, isLater, exprToString } from "../src/index";

const result = stage(runtime(num(0), "userInput"));
if (isLater(result.svalue)) {
  console.log(exprToString(result.svalue.residual));
}
// Output: userInput
```

### Control Flow with Later Conditions

When the condition of an `if` is Later, both branches are evaluated and the result constraint is the union:

```typescript
// @run
import { stage, ifExpr, gtExpr, varRef, num, runtime, letExpr, isLater, constraintToString, exprToString } from "../src/index";

// if x > 0 then x else 0, where x is runtime
const expr = letExpr("x", runtime(num(0), "x"),
  ifExpr(gtExpr(varRef("x"), num(0)), varRef("x"), num(0))
);

const result = stage(expr);
if (isLater(result.svalue)) {
  // Result could be the x branch or the 0 branch
  console.log(constraintToString(result.svalue.constraint));
  console.log(exprToString(result.svalue.residual));
}
// Output: 0
// Output: let x = x in if (x > 0) then x else 0
```

### Recursive Functions

Recursive functions with Later arguments use coinductive cycle detection:

```typescript
// @run
import { parse, stage, isLater, exprToString, constraintToString } from "../src/index";

const factorialExpr = parse(`
  let factorial = fn fac(n) =>
    if n == 0 then 1 else n * fac(n - 1)
  in factorial(runtime(n: 5))
`);

const result = stage(factorialExpr);
if (isLater(result.svalue)) {
  console.log(constraintToString(result.svalue.constraint));
}
// Output: 1 | number
```

---

## 5. Type Inference

**File: `src/constraint.ts` (constraint solving) and `src/inference.ts`**

### Constraint Variables

For type inference, we use constraint variables (`freshCVar()`) as placeholders:

```typescript
// @run
import { freshCVar, constraintToString, resetConstraintVarCounter } from "../src/index";

resetConstraintVarCounter();
const unknown = freshCVar();
console.log(constraintToString(unknown));
// Output: ?0
```

### Solving Constraints

`solve(a, b)` attempts to unify constraints, returning a substitution:

```typescript
// @run
import { solve, freshCVar, isNumber, gt, and, applySubstitution, constraintToString, resetConstraintVarCounter } from "../src/index";

resetConstraintVarCounter();
// Solve ?0 = number & (> 0)
const unknown = freshCVar();
const target = and(isNumber, gt(0));

const substitution = solve(unknown, target);
if (substitution) {
  const resolved = applySubstitution(unknown, substitution);
  console.log(constraintToString(resolved));
}
// Output: number & > 0
```

### Function Inference

`inferFunction` analyzes a function body to determine parameter and return types:

```typescript
// @run
import { inferFunction, add, varRef, Env, constraintToString } from "../src/index";

// Infer type of: fn(x, y) => x + y
const params = ["x", "y"];
const body = add(varRef("x"), varRef("y"));

const inferred = inferFunction(params, body, Env.empty());
console.log(inferred.paramConstraints.map(constraintToString).join(", "));
// Output: number, number
console.log(constraintToString(inferred.resultConstraint));
// Output: number
```

### Generalization and Instantiation

For let-polymorphism, constraint variables can be generalized:

```typescript
// @run
import { generalize, instantiate, freshCVar, constraintToString, resetConstraintVarCounter } from "../src/index";

resetConstraintVarCounter();
// Generalize a constraint with free variables
const scheme = generalize(freshCVar(), new Set());
console.log(scheme.quantified.length > 0);
// Output: true

// Instantiate creates fresh variables
const instance = instantiate(scheme);
console.log(constraintToString(instance));
// Output: ?1
```

---

## 6. Control Flow Refinement

**File: `src/refinement.ts`**

Control flow narrows types in branches. When you write `if x > 0 then ... else ...`, the then-branch knows `x` satisfies `gt(0)`.

### Extracting Refinements

`extractAllRefinements(expr)` analyzes a condition expression to extract what we learn:

```typescript
// @run
import { extractAllRefinements, gtExpr, varRef, num, constraintToString } from "../src/index";

// From condition: x > 5
const condition = gtExpr(varRef("x"), num(5));
const refinement = extractAllRefinements(condition);

// In the then-branch, x is refined to gt(5)
const xRefinement = refinement.constraints.get("x");
if (xRefinement) {
  console.log(constraintToString(xRefinement));
}
// Output: > 5
```

### Negating Refinements

For else-branches, refinements are negated:

```typescript
// @run
import { extractAllRefinements, negateRefinement, gtExpr, varRef, num, constraintToString } from "../src/index";

const condition = gtExpr(varRef("x"), num(5));
const refinement = extractAllRefinements(condition);
const negated = negateRefinement(refinement);

// In the else-branch, x is NOT > 5, so it's <= 5
const xRefinement = negated.constraints.get("x");
if (xRefinement) {
  console.log(constraintToString(xRefinement));
}
// Output: <= 5
```

### Discriminated Unions with narrowOr

`narrowOr` eliminates impossible branches from union types:

```typescript
// @run
import { narrowOr, or, and, isObject, hasField, isString, equals, constraintToString, isNever } from "../src/index";

// Type: { kind: "circle", radius: number } | { kind: "square", side: number }
const circleType = and(isObject, hasField("kind", equals("circle")));
const squareType = and(isObject, hasField("kind", equals("square")));
const shapeType = or(circleType, squareType);

// After checking kind == "circle", only circle branch remains
const narrowed = narrowOr(shapeType, hasField("kind", equals("circle")));
console.log(constraintToString(narrowed));
// Output: { kind: "circle" }
```

---

## 7. Code Generation

**File: `src/codegen.ts`**

The code generator converts expressions (typically residuals from staging) to JavaScript.

### Basic Generation

```typescript
// @run
import { generateJS, add, num, varRef, ifExpr, gtExpr } from "../src/index";

// Simple expression
console.log(generateJS(add(num(1), num(2))));
// Output: 1 + 2

// Conditional becomes ternary
const cond = ifExpr(gtExpr(varRef("x"), num(0)), varRef("x"), num(0));
console.log(generateJS(cond));
// Output: x > 0 ? x : 0
```

### The Compile Pipeline

`compile()` combines staging and code generation:

```typescript
// @run
import { compile, parse } from "../src/index";

// Fully known at compile time → just the result
console.log(compile(parse("2 + 3")));
// Output: 5

// Has runtime component → generates code
console.log(compile(parse("runtime(x: 0) + 5")));
// Output: x + 5
```

### Let Chain Optimization

Nested lets become sequential statements in functions:

```typescript
// @run
import { generateJS, fn, letExpr, add, varRef, num } from "../src/index";

const func = fn(["x"],
  letExpr("a", add(varRef("x"), num(1)),
    letExpr("b", add(varRef("a"), num(2)),
      add(varRef("a"), varRef("b"))
    )
  )
);

// Multi-line output - generates a proper function body
const code = generateJS(func);
console.log(code.includes("const a = x + 1"));
// Output: true
console.log(code.includes("const b = a + 2"));
// Output: true
console.log(code.includes("return a + b"));
// Output: true
```

### Special Desugaring

Some builtins are desugared to idiomatic JS:

```typescript
// @run
import { generateJS, call, varRef, fn, array, num } from "../src/index";

// print() becomes console.log()
console.log(generateJS(call(varRef("print"), num(42))));
// Output: console.log(42)

// map(fn, arr) becomes arr.map(fn)
const mapper = fn(["x"], varRef("x"));
const arr = array(num(1), num(2));
console.log(generateJS(call(varRef("map"), mapper, arr)));
// Output: [1, 2].map((x) => x)
```

---

## 8. Parser and Lexer

**Files: `src/lexer.ts`, `src/parser.ts`**

### Syntax Overview

```
// Literals
5, 3.14, "hello", true, false, null

// Operators
+, -, *, /, %           // Arithmetic
==, !=, <, >, <=, >=    // Comparison
&&, ||, !               // Logical

// Let bindings
let x = 5 in x + 1
let [a, b] = arr in a + b     // Destructuring
let { x, y } = obj in x + y

// Functions
fn(x) => x + 1
fn(x, y) => x + y
fn fac(n) => if n == 0 then 1 else n * fac(n-1)  // Named recursive

// Control flow
if cond then a else b

// Data structures
{ x: 1, y: 2 }    // Objects
obj.field         // Field access
[1, 2, 3]         // Arrays
arr[0]            // Index access

// Staging
comptime(expr)    // Force compile-time
runtime(expr)     // Force runtime
runtime(x: expr)  // Named runtime variable

// Type operations
assert(value, type)   // Runtime type check
trust(value, type)    // Type refinement without check
```

### Using the Parser

```typescript
// @run
import { parse, exprToString } from "../src/index";

const expr = parse("let x = 5 in x * 2");
console.log(exprToString(expr));
// Output: let x = 5 in (x * 2)

const fn = parse("fn(a, b) => a + b");
console.log(exprToString(fn));
// Output: fn(a, b) => (a + b)
```

### Full Evaluation

`parseAndRun` parses and evaluates, requiring all values to be compile-time known:

```typescript
// @run
import { parseAndRun, valueToString, constraintToString } from "../src/index";

const result = parseAndRun("let double = fn(x) => x * 2 in double(21)");
console.log(valueToString(result.value));
// Output: 42
console.log(constraintToString(result.constraint));
// Output: 42
```

### Compilation

`parseAndCompile` parses, stages, and generates JavaScript:

```typescript
// @run
import { parseAndCompile } from "../src/index";

console.log(parseAndCompile("1 + 2 * 3"));
// Output: 7

console.log(parseAndCompile("fn(x) => x * 2"));
// Output: (x) => x * 2
```

---

## 9. Known Issues and Limitations

This section documents discovered issues and limitations in the current implementation.

### 9.1 Global Mutable State

**Location:** `src/staged-evaluate.ts`, `src/constraint.ts`

The system uses global counters for generating fresh variable names:

```typescript
let varCounter = 0;
export function freshVar(prefix: string = "v"): string {
  return `${prefix}${varCounter++}`;
}

export function resetVarCounter(): void {
  varCounter = 0;
}
```

**Issue:** This requires calling `resetVarCounter()` between tests for reproducible output. In concurrent scenarios, this could cause issues.

**Workaround:** Always call `resetVarCounter()` before staging. The `stage()` function does this automatically.

### 9.2 Limited Arithmetic Constraint Simplification

**Current behavior:**
```typescript
// @run
import { simplify, and, gt, constraintToString } from "../src/index";

// These don't simplify to just gt(10)
const c = simplify(and(gt(5), gt(10)));
console.log(constraintToString(c));
// Output: > 5 & > 10
```

**Ideal behavior:** Should simplify to just `gt(10)` since `x > 10` implies `x > 5`.

**Impact:** Constraint strings are more verbose than necessary; subtyping checks still work correctly.

### 9.3 Import Code Generation is Incomplete

**Current behavior:** Import expressions generate commented-out import statements:

```typescript
// import { name } from "module";
return body;
```

**Issue:** Real ES modules require imports at the top level. The current approach won't work without a bundler.

**Workaround:** Use `generateModuleWithImports()` which hoists imports to the top level.

### 9.4 Assert Code Generation is Simplistic

**Current behavior:** Assert expressions generate null/undefined checks:

```typescript
if (__value === null || __value === undefined) {
  throw new Error("Assertion failed");
}
```

**Issue:** This doesn't check the full constraint, only null/undefined.

**Impact:** Runtime assertions don't provide full constraint checking.

### 9.5 extractRefinement Returns Empty for OR Conditions

**Current behavior:**

```typescript
// @run
import { extractAllRefinements, orExpr, gtExpr, ltExpr, varRef, num } from "../src/index";

// x > 5 || x < 0
const condition = orExpr(gtExpr(varRef("x"), num(5)), ltExpr(varRef("x"), num(0)));
const refinement = extractAllRefinements(condition);
console.log(refinement.constraints.size);
// Output: 0
```

**Issue:** OR conditions don't produce refinements, even though we could learn something (x is in one of the ranges).

**Impact:** Less precise type narrowing for disjunctive conditions.

### 9.6 Closure Environment Captures Everything

**Current behavior:** Closures capture the entire environment, not just free variables.

**Impact:** Memory overhead for closures in long-running programs.

### 9.7 No Tail Call Optimization

**Current behavior:** Recursive functions can stack overflow on deep recursion.

**Impact:** Large recursive computations may fail.

---

## 10. Future Work

This section lists features that could be added to extend the system.

### 10.1 Language Features Not Yet Implemented

**Pattern Matching / Match Expressions**
```
match x with
| s: string => "string: " ++ s
| n: number => "number: " ++ toString(n)
```
Currently only `if-then-else` is available for branching.

**Explicit Type Annotations**
```
fn add(a: number, b: number) -> number = a + b
```
The parser doesn't support type annotations on function parameters or return types.

**Where Clauses for Constraints**
```
fn sqrt(n: number) where n >= 0 -> number = ...
```
No syntax for specifying preconditions on functions.

**Custom Error Messages**
```
fn connect(port: number)
  where port >= 1 && port <= 65535
    else "Port must be between 1 and 65535, got ${port}"
```
API designers cannot provide custom error messages for constraint violations.

### 10.2 Type System Features Not Yet Implemented

**Polymorphic Type Inference (Let-Polymorphism)**
```
let id = fn(x) => x   // Should infer: forall T. T -> T
id(5)                 // T = number
id("hello")           // T = string
```
Basic inference exists but full Hindley-Milner polymorphism is incomplete.

**Nullable Types**
```
let maybeName: string? = null
```
No explicit nullable type syntax; nullability is tracked via constraints but not ergonomic.

**Exhaustiveness Checking**
```
fn describe(x: string | number) =
  match x with
  | s: string => ...
  // Should error: missing number case
```
No compile-time exhaustiveness checking for union types.

### 10.3 Compile-Time Features Not Yet Implemented

**Partial Evaluation with Placeholders**
```
comptime square = power(?, 2)  // ? is runtime placeholder
// Generates specialized: fn(base) => base * base
```
Current staging requires explicit `runtime()` markers; no placeholder syntax for partial application.

**Comptime Variable Declarations**
```
comptime fieldNames = fields(MyType)
comptime size = 10
```
The `comptime` keyword only works as an expression wrapper, not as a variable declaration modifier.

### 10.4 Optimization Features Not Yet Implemented

**Mutation Optimization**
```
// Source: immutable
fn incrementAge(person) = { ...person, age: person.age + 1 }

// Should generate: in-place mutation when safe
function incrementAge(person) { person.age += 1; return person; }
```
No alias analysis or mutation optimization; generated code is purely functional.

**Loop Optimization**
```
// Source: fold
fn sumList(xs) = fold(xs, 0, fn(acc, x) => acc + x)

// Should generate: mutable loop
function sumList(xs) { let acc = 0; for (...) acc += xs[i]; return acc; }
```
Higher-order functions are not optimized to loops.

**Collection Specialization**
```
let fixed = [1, 2, 3]       // Could use tuple representation
let growing = push(arr, x)  // Could use growable array
```
No automatic specialization based on usage patterns.

### 10.5 TypeScript Integration Not Yet Implemented

**Produce .d.ts Files**
```
// Our module
export fn add(a: number, b: number) -> number = a + b

// Should generate .d.ts:
export declare function add(a: number, b: number): number;
```
Can consume `.d.ts` files but cannot generate them.

**Full .d.ts Consumption**
Import loading exists (`ts-loader.ts`) but many TypeScript type features are not fully supported (generics with constraints, conditional types, mapped types, etc.).

### 10.6 Exploratory Ideas (From Goals)

**Implicit Environment for DSLs**
```
query {
  from(users)
  where(age > 18)
  select(name, email)
}
```
No implicit parameter mechanism for clean DSL syntax.

**Type Classes via Registries**
```
register Eq(number) = fn(a, b) => a == b
register Eq(Array<T>) where Eq(T) = ...

fn contains<T>(arr: Array<T>, item: T) where Eq(T) = ...
```
No type class or trait system; no global registry mechanism.

---

## Summary

This dependent type system demonstrates several key ideas:

1. **Types as Constraints:** Unifying types and refinements through logical predicates
2. **Subtyping as Implication:** Using logical implication for the subtyping relation
3. **Staged Evaluation:** Partial evaluation with Now/Later to separate compile-time from runtime
4. **Control Flow Refinement:** Narrowing types based on conditionals
5. **First-Class Types:** Types are values that can be passed around and computed

The implementation prioritizes simplicity and clarity over performance, making it suitable for understanding the concepts and as a foundation for more sophisticated systems.
