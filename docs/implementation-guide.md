# Dependent Type System Implementation Guide

This document provides a deep dive into implementing a dependent type system with **constraints-as-types**. It's aimed at developers who want to understand how this system works and potentially build something similar.

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Constraint System](#2-the-constraint-system)
3. [Values and Expressions](#3-values-and-expressions)
4. [Staged Evaluation](#4-staged-evaluation)
5. [Body-Based Type Derivation](#5-body-based-type-derivation)
6. [Control Flow Refinement](#6-control-flow-refinement)
7. [Code Generation](#7-code-generation)
8. [Specialization](#8-specialization)
9. [Parser and Lexer](#9-parser-and-lexer)
10. [Known Issues and Limitations](#10-known-issues-and-limitations)
11. [Future Work](#11-future-work)
12. [Design Decisions](#12-design-decisions)

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
import { stage, isNow, isLater, add, num, runtime, constraintToString } from "@dependent-ts/core";

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
  | { tag: "isUndefined" }
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
  | { tag: "elements"; constraint: Constraint }    // Homogeneous array elements
  | { tag: "length"; constraint: Constraint }      // Array/string length
  | { tag: "elementAt"; index: number; constraint: Constraint }  // Tuple element
  | { tag: "index"; constraint: Constraint }       // Index signature (unlisted fields)

  // Logical operators
  | { tag: "and"; constraints: Constraint[] }
  | { tag: "or"; constraints: Constraint[] }
  | { tag: "not"; constraint: Constraint }
  | { tag: "never" }  // Unsatisfiable
  | { tag: "any" }    // Always satisfied

  // Advanced
  | { tag: "isType"; constraint: Constraint }  // Meta: value IS a type
  | { tag: "rec"; var: string; body: Constraint }  // Recursive types
  | { tag: "recVar"; var: string }
  | { tag: "var"; id: number }  // Constraint variable (for inference)
```

### Building Constraints

```typescript
// @run
import { isNumber, isString, and, or, gt, equals, hasField, constraintToString } from "@dependent-ts/core";

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
import { implies, isNumber, gt, gte, equals, and } from "@dependent-ts/core";

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
import { simplify, and, or, isNumber, isString, gt, lt, constraintToString, isNever } from "@dependent-ts/core";

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
import { unify, isNumber, gt, constraintToString } from "@dependent-ts/core";

// Unifying constraints intersects them
const unified = unify(isNumber, gt(0));
console.log(constraintToString(unified));
// Output: number & > 0
```

### Recursive Types

For recursive data structures (like JSON or linked lists), use `rec` and `recVar`:

```typescript
// @run
import { rec, recVar, or, isNull, isNumber, isString, isBool, isArray, isObject, hasField, elements, and, constraintToString } from "@dependent-ts/core";

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
  | ClosureValue   // { tag: "closure", body, env, name? }
  | TypeValue      // { tag: "type", constraint: Constraint }
  | BuiltinValue   // { tag: "builtin", name: string }
```

**Note:** `ClosureValue` does not store `params` directly. All functions use an implicit `args` array binding, and named parameters are desugared to pattern matching on `args` (see Section 5).

### Deriving Constraints from Values

`constraintOf(value)` computes the most specific constraint for a value:

```typescript
// @run
import { constraintOf, numberVal, stringVal, objectVal, constraintToString } from "@dependent-ts/core";

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
import { valueSatisfies, numberVal, isNumber, gt, and } from "@dependent-ts/core";

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
  | BlockExpr         // { stmt1; stmt2; result }
  | ComptimeExpr      // comptime(expr) - force compile-time
  | RuntimeExpr       // runtime(expr) - force runtime
  | AssertExpr        // assert(value, type) - runtime check
  | AssertCondExpr    // assert(condition) - boolean condition check
  | TrustExpr         // trust(value, type) - no check
  | MethodCallExpr    // receiver.method(args)
  | ImportExpr        // import { x } from "module" in body
  | TypeOfExpr        // typeOf(expr) - get type as value
  | DeferredClosureExpr   // Internal: delayed staging for codegen
  | SpecializedCallExpr   // Internal: specialized function call for two-pass codegen
```

### Building Expressions

```typescript
// @run
import { letExpr, fn, add, varRef, call, num, exprToString } from "@dependent-ts/core";

// Build: let double = fn(x) => x + x in double(5)
const expr = letExpr("double",
  fn(["x"], add(varRef("x"), varRef("x"))),
  call(varRef("double"), num(5))
);

console.log(exprToString(expr));
// Output: let double = fn() => let [x] = args in (x + x) in double(5)
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
  residual?: Expr;        // Optional: expression to use in codegen (e.g., variable reference)
}

interface Later {
  stage: "later";
  constraint: Constraint;        // What we know about the type
  residual: Expr;                // Expression to compute it at runtime
  captures: Map<string, SValue>; // Explicit dependencies (free variables in residual)
  origin: LaterOrigin;           // Where this Later came from (runtime, import, or derived)
}

interface StagedClosure {
  stage: "closure";
  body: Expr;              // The function body
  params: string[];        // Parameter names (extracted from body)
  env: SEnv;               // Captured staged environment
  name?: string;           // For recursive self-reference
  constraint: Constraint;  // Always isFunction, but may have more info
  comptimeParams?: Set<string>;  // Params used inside comptime() - must be Now at call sites
}

interface LaterArray {
  stage: "later-array";
  elements: SValue[];      // Each element's SValue preserved
  constraint: Constraint;  // Overall array constraint
}

type SValue = Now | Later | StagedClosure | LaterArray;
```

The `StagedClosure` type represents functions with their captured environment, enabling inspection of the body and captures. The `LaterArray` type preserves individual element information for optimizations like predicate pushing.

### Evaluation Rules

**Literals are always Now:**

```typescript
// @run
import { stage, num, str, isNow } from "@dependent-ts/core";

console.log(isNow(stage(num(42)).svalue));
// Output: true

console.log(isNow(stage(str("hello")).svalue));
// Output: true
```

**Operations on all-Now inputs compute immediately:**

```typescript
// @run
import { stage, add, num, isNow, valueToString } from "@dependent-ts/core";

const result = stage(add(num(2), num(3)));
if (isNow(result.svalue)) {
  console.log(valueToString(result.svalue.value));
}
// Output: 5
```

**Operations with Later inputs generate residual code:**

```typescript
// @run
import { stage, add, num, runtime, isLater, exprToString } from "@dependent-ts/core";

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
import { stage, comptime, add, num, isNow } from "@dependent-ts/core";

// This works - all inputs are known
const result = stage(comptime(add(num(2), num(3))));
console.log(isNow(result.svalue));
// Output: true
```

`runtime(expr, name)` forces a Later value with a named variable:

```typescript
// @run
import { stage, runtime, num, isLater, exprToString } from "@dependent-ts/core";

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
import { stage, ifExpr, gtExpr, varRef, num, runtime, letExpr, isLater, constraintToString, exprToString } from "@dependent-ts/core";

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
import { parse, stage, isLater, exprToString, constraintToString } from "@dependent-ts/core";

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

## 5. Body-Based Type Derivation

**File: `src/staged-evaluate.ts`**

The system uses **body-based type derivation** rather than traditional function type inference. Function types are not declared or inferred upfront - instead, constraints are derived by analyzing the function body at each call site with the actual argument constraints.

### How It Works

When a function is called:
1. The function body is analyzed with the argument constraints bound to the implicit `args` array
2. Operations within the body constrain what types are valid (e.g., `+` requires numbers)
3. If constraints are violated, an error is raised at the point of use
4. The result constraint is derived from the body's evaluation

```typescript
// @run
import { parse, stage, constraintToString, isNow } from "@dependent-ts/core";

// Calling with a specific value gives precise result constraint
const precise = stage(parse("let f = fn(x) => x + 1 in f(5)"));
console.log(constraintToString(precise.svalue.constraint));
// Output: 6

// Calling with runtime value - still precise because runtime(n: 0) has constraint equals(0)
const general = stage(parse("let f = fn(x) => x + 1 in f(runtime(n: 0))"));
console.log(constraintToString(general.svalue.constraint));
// Output: 1
```

### Higher-Order Functions and Error Detection

Errors are caught when analyzing the body with actual argument types:

```typescript
// @run
import { parse, stage } from "@dependent-ts/core";

// This fails because toString returns string, but + 1 needs number
try {
  stage(parse(`
    let apply = fn(f, x) => f(x) + 1
    in apply(fn(x) => "hello", 5)
  `));
} catch (e: any) {
  console.log(e.message);
}
// Output: Type error in right of string +: expected string, got 1
```

### Benefits of Body-Based Derivation

1. **Per-call-site precision**: `f(5)` gives `equals(6)`, not just `isNumber`
2. **Natural dependent types**: Result constraints depend on input values
3. **Simpler architecture**: One mechanism (staged eval) instead of two
4. **No function type declarations needed**: Types flow from behavior

### The Implicit `args` Binding

Internally, all functions are represented as `fn => body` with an implicit `args` binding. Named parameters are syntax sugar:

```
fn(x, y) => x + y
```

Desugars to:
```
fn => let [x, y] = args in x + y
```

This enables variadic functions naturally:
```
fn(first, ...rest) => first + sum(rest)
```

---

## 6. Control Flow Refinement

**File: `src/refinement.ts`**

Control flow narrows types in branches. When you write `if x > 0 then ... else ...`, the then-branch knows `x` satisfies `gt(0)`.

### Extracting Refinements

`extractAllRefinements(expr)` analyzes a condition expression to extract what we learn:

```typescript
// @run
import { extractAllRefinements, gtExpr, varRef, num, constraintToString } from "@dependent-ts/core";

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
import { extractAllRefinements, negateRefinement, gtExpr, varRef, num, constraintToString } from "@dependent-ts/core";

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
import { narrowOr, or, and, isObject, hasField, isString, equals, constraintToString, isNever } from "@dependent-ts/core";

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
import { compile, parse } from "@dependent-ts/core";

// Fully known at compile time → evaluates to result
console.log(compile(parse("1 + 2")));
// Output: 3

// With runtime variable → generates code
console.log(compile(parse("runtime(x: 0) + 5")));
// Output: x + 5

// Conditional with runtime variable becomes ternary
// (runtime() binds the variable name directly)
console.log(compile(parse("if runtime(x: 0) > 0 then runtime(x: 0) else 0")));
// Output: x > 0 ? x : 0
```

### The Compile Pipeline

`compile()` combines staging and code generation:

```typescript
// @run
import { compile, parse } from "@dependent-ts/core";

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
import { generateJS, fn, letExpr, add, varRef, num } from "@dependent-ts/core";

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
import { compile, parse } from "@dependent-ts/core";

// print() becomes console.log()
console.log(compile(parse("print(42)")));
// Output: console.log(42)

// map() with all-known array evaluates at compile time
console.log(compile(parse("map([1, 2], fn(x) => x * 2)")));
// Output: [2, 4]

// map() with runtime array generates arr.map(fn)
console.log(compile(parse("map(runtime(arr: []), fn(x) => x * 2)")));
// Output: arr.map((x) => x * 2)
```

---

## 8. Specialization

**File: `src/staged-evaluate.ts`, `src/svalue-module-generator.ts`**

Specialization is the process of generating optimized, specialized versions of functions based on compile-time known values. This section documents the core principles.

### Core Principles

#### 1. Comptime is Explicit

The `comptime(...)` wrapper is the only way to force compile-time evaluation. Nothing happens automatically — if you want a value computed at compile time, wrap it.

```typescript
// Without comptime: field access generates residual code
fn(obj) => obj.kind  // Generates: (obj) => obj.kind

// With comptime: if constraint tells us the value, it's inlined
fn(obj) => comptime(obj.kind)  // If obj.kind is known to be "circle", generates: (obj) => "circle"
```

This explicit approach avoids surprising behavior and makes the staging boundary clear in the source code.

#### 2. Comptime Parameters Drive Specialization

When a function is defined, the system scans the body to find parameters used inside `comptime(...)` or `typeOf(...)`. These are tracked as "comptime parameters".

```
fn(x, y) => comptime(x) + y
// comptimeParams = {"x"} — x must be Now at call sites
```

At call sites:
- If a comptime parameter receives a `Later` value: throws `ComptimeRequiresNowError`
- If all comptime parameters are `Now`: the body is staged with those values computed, creating a specialized version

#### 3. Types Are Erased

Type values (`TypeValue`) exist only at compile time. They can be used inside `comptime(...)` but cannot appear in generated JavaScript.

```
// Generic function with type parameter
let id = fn(T) => fn(x) => {
  comptime(assert(x, T));  // T used in comptime context - OK
  x
}

// Call with type argument
id(number)  // Returns specialized fn(x) => x
            // The type 'number' is erased from output
```

If a type value would need to be residualized (used at runtime), an error is thrown.

#### 4. Assert Has Two Modes

The `assert(value, type)` expression behaves differently based on context:

**Inside `comptime(...)`:**
- Refines the type constraint on `value`
- Returns `null` and generates no runtime code
- Acts as a pure compile-time type refinement

**Outside `comptime(...)`:**
- Refines the type constraint AND generates runtime assertion code
- Returns the value with refined constraint

```
// Compile-time only refinement (no runtime code)
fn(x) => {
  comptime(assert(x, number));
  x + 1
}

// Runtime assertion (generates check)
fn(x) => {
  assert(x, number);  // Generates: if (typeof x !== 'number') throw ...
  x + 1
}
```

#### 5. Specializations Are Deduplicated

The code generator uses a two-pass approach:

**Pass 1 (Collection):** Walk the residual expression tree collecting all `specializedCall` nodes, grouped by closure identity.

**Pass 2 (Deduplication & Naming):**
- Single specialization → one function
- Multiple unique specializations → separate specialized functions or JS clustering

This ensures that calling the same function with the same comptime values doesn't generate duplicate code.

### How Specialization Works

When a function with comptime parameters is called, the system:

1. Evaluates arguments
2. Checks that all comptime parameters received `Now` values
3. Stages the function body with those values computed
4. Records the result in a `specializedCall` node containing:
   - The closure identity
   - The specialized body (result of staging)
   - The argument residuals

During code generation, `specializedCall` nodes are resolved to their specialized function names.

### Discriminant Optimization

A common use case for `comptime` is discriminant checking on tagged unions:

```
fn handleShape(shape) =>
  if comptime(shape.kind) == "circle" then
    computeCircleArea(shape)
  else
    computeSquareArea(shape)
```

When `shape`'s constraint tells us `kind` is exactly `"circle"`, `comptime(shape.kind)` evaluates to `Now("circle")`, and the entire `if` is eliminated at compile time — only the circle branch remains.

**Important:** This optimization only happens inside `comptime()`. Without it, `shape.kind` would be `Later` even if the constraint is precise.

---

## 9. Parser and Lexer

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
import { parse, exprToString } from "@dependent-ts/core";

const expr = parse("let x = 5 in x * 2");
console.log(exprToString(expr));
// Output: let x = 5 in (x * 2)

const fn = parse("fn(a, b) => a + b");
console.log(exprToString(fn));
// Output: fn() => let [a, b] = args in (a + b)
```

### Full Evaluation

`parseAndRun` parses and evaluates, requiring all values to be compile-time known:

```typescript
// @run
import { parseAndRun, valueToString, constraintToString } from "@dependent-ts/core";

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
import { parseAndCompile } from "@dependent-ts/core";

console.log(parseAndCompile("1 + 2 * 3"));
// Output: 7

console.log(parseAndCompile("fn(x) => x * 2"));
// Output: (x) => x * 2
```

---

## 10. Known Issues and Limitations

This section documents discovered issues and limitations in the current implementation.

### 10.1 Global Mutable State

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

### 10.2 Limited Arithmetic Constraint Simplification

**Current behavior:**
```typescript
// @run
import { simplify, and, gt, constraintToString } from "@dependent-ts/core";

// These don't simplify to just gt(10)
const c = simplify(and(gt(5), gt(10)));
console.log(constraintToString(c));
// Output: > 5 & > 10
```

**Ideal behavior:** Should simplify to just `gt(10)` since `x > 10` implies `x > 5`.

**Impact:** Constraint strings are more verbose than necessary; subtyping checks still work correctly.

### 10.3 Import Code Generation is Incomplete

**Current behavior:** Import expressions generate commented-out import statements:

```typescript
// import { name } from "module";
return body;
```

**Issue:** Real ES modules require imports at the top level. The current approach won't work without a bundler.

**Workaround:** Use `generateModuleWithImports()` which hoists imports to the top level.

### 10.4 Assert Code Generation is Simplistic

**Current behavior:** Assert expressions generate null/undefined checks:

```typescript
if (__value === null || __value === undefined) {
  throw new Error("Assertion failed");
}
```

**Issue:** This doesn't check the full constraint, only null/undefined.

**Impact:** Runtime assertions don't provide full constraint checking.

### 10.5 extractRefinement Returns Empty for OR Conditions

**Current behavior:**

```typescript
// @run
import { extractAllRefinements, orExpr, gtExpr, ltExpr, varRef, num } from "@dependent-ts/core";

// x > 5 || x < 0
const condition = orExpr(gtExpr(varRef("x"), num(5)), ltExpr(varRef("x"), num(0)));
const refinement = extractAllRefinements(condition);
console.log(refinement.constraints.size);
// Output: 0
```

**Issue:** OR conditions don't produce refinements, even though we could learn something (x is in one of the ranges).

**Impact:** Less precise type narrowing for disjunctive conditions.

### 10.6 Closure Environment Captures Everything

**Current behavior:** Closures capture the entire environment, not just free variables.

**Impact:** Memory overhead for closures in long-running programs.

### 10.7 No Tail Call Optimization

**Current behavior:** Recursive functions can stack overflow on deep recursion.

**Impact:** Large recursive computations may fail.

---

## 11. Future Work

This section lists features that could be added to extend the system.

### 11.1 Language Features Not Yet Implemented

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

### 11.2 Type System Features Not Yet Implemented

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

### 11.3 Compile-Time Features Not Yet Implemented

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

### 11.4 Optimization Features Not Yet Implemented

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

### 11.5 TypeScript Integration Not Yet Implemented

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

### 11.6 Exploratory Ideas (From Goals)

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

## 12. Design Decisions

This section documents key design decisions and their rationale.

### 12.1 Type Annotations as Syntax Sugar

**Decision:** Type annotations (when implemented) will be syntactic sugar, not stored declarations.

**Rationale:** With body-based type derivation, explicit type annotations like:
```
fn add(a: number, b: number) -> number = a + b
```

Will desugar to `trust` at the definition site:
```
fn add(a, b) =
  let _ = trust(a, number) in
  let _ = trust(b, number) in
  let result = a + b in
  trust(result, number)
```

This provides early error detection (via `implies` checks in `trust`) while keeping the core model simple. The syntax will likely be TypeScript-like when implemented.

### 12.2 Currying Should Be Explicit

**Decision:** Automatic currying will NOT be supported. If you want a curried function, define it explicitly.

**Rationale:** Implicit currying (Haskell-style) causes ambiguity with variadic functions and makes error messages harder to understand. Explicit currying is clearer:
```
// Explicit currying
let add = fn(x) => fn(y) => x + y
add(5)(3)  // 8

// NOT: add(5, 3) automatically becoming add(5)(3)
```

### 12.3 typeOf() Is Compile-Time Only

**Decision:** `typeOf(x)` returns the constraint of `x` as a type value. When `x` is Later, `typeOf(x)` returns `any`.

**Rationale:** Runtime type reflection would require values to carry constraint metadata at runtime, adding overhead. Most use cases for `typeOf` work at compile time:

```
// Works: x is Now, typeOf gives precise constraint
let x = 5
assert(y, typeOf(x))  // Checks y satisfies equals(5)

// Limited: x is Later, typeOf gives any
let x = runtime(n: 0)
assert(y, typeOf(x))  // Checks y satisfies any (always passes)
```

**Potential runtime use cases** (not currently supported):
- Same-type enforcement across runtime values: `assert(y, typeOf(x))` where both are runtime
- Type-indexed serialization: dispatch based on runtime type
- Homogeneous collections: ensure all elements match first element's type

These would require runtime type tags. For now, use `assert` with static types or JS `typeof` for basic runtime checks.

### 12.4 Performance Optimization Is Deferred

**Decision:** Body re-analysis on each call is accepted. Caching will be added if profiling shows it's needed.

**Rationale:** Premature optimization. The current approach:
- Analyzes function body each time it's called with different argument constraints
- May re-do work for identical constraint patterns

Potential optimization (not yet implemented):
- Cache results keyed by `(closureId, argConstraintsHash)`
- Only re-analyze if constraints differ from cached version

This will be revisited when we have real-world usage to profile.

### 12.5 Function Subtyping Is Behavioral

**Decision:** Function "subtyping" is behavioral, not structural.

**Rationale:** Without declared function types, we can't do traditional structural subtyping. Instead, to check "can f be used where g is expected":
1. Analyze f's body with g's expected input constraints
2. Check f's result implies g's expected result

This is more like "can f behave as g?" than "does f's declared type match g's declared type?"

---

## Summary

This dependent type system demonstrates several key ideas:

1. **Types as Constraints:** Unifying types and refinements through logical predicates
2. **Subtyping as Implication:** Using logical implication for the subtyping relation
3. **Staged Evaluation:** Partial evaluation with Now/Later to separate compile-time from runtime
4. **Control Flow Refinement:** Narrowing types based on conditionals
5. **First-Class Types:** Types are values that can be passed around and computed

The implementation prioritizes simplicity and clarity over performance, making it suitable for understanding the concepts and as a foundation for more sophisticated systems.
