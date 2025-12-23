# Language Goals

A functional language which compiles to JavaScript and is compatible with TypeScript type definitions.

> **Design Document:** See [constraints-as-types.md](constraints-as-types.md) for the core type system design, where types are unified as constraint sets.

## Core Goals

### 1. TypeScript Type-Level Programming in Normal Syntax

Everything that can be done using TypeScript's type-level syntax should be expressible as normal function syntax.

**TypeScript today:**
```typescript
// Conditional types - weird ternary syntax at type level
type IsString<T> = T extends string ? true : false;

// Mapped types - special `in keyof` syntax
type Readonly<T> = { readonly [K in keyof T]: T[K] };

// Template literal types
type Greeting<N extends string> = `Hello, ${N}`;
```

**Our language:**
```
// Same logic, normal function syntax
fn isString(T: Type) -> Type =
  if T <: string then true else false

fn readonly(T: Type) -> Type =
  mapFields(T, fn(key, value) => { readonly: true, type: value })

fn greeting(N: string) -> Type =
  "Hello, " ++ N   // String concatenation works at type level too
```

The type-level language and value-level language are the same language.

> **Design:** See [Challenge 4: Type of Types](constraints-as-types.md#challenge-4-what-is-the-type-of-types) - types are comptime values with `isType` constraint, enabling unified syntax.

### 2. Staged Computation with Compile-Time Forcing

Expressions can be forced to be known at compile time. All compile-time reflection must operate on compile-time-known values.

**Explicit staging:**
```
// comptime forces evaluation at compile time
comptime fieldNames = fields(MyType)     // Must be known at compile time
comptime size = 10                        // Literal, trivially known

// Runtime values cannot be used where comptime is required
let n = parseInt(input)
comptime x = n                            // ERROR: n is not known at compile time
```

**Reflection requires compile-time values:**
```
fn printFields<T>(value: T) =
  // fields(T) works because T is a type parameter, known at compile time
  for field in fields(T) do
    print(field, getField(value, field))

let x = someRuntimeValue
fields(typeOf(x))                         // ERROR: typeOf(x) is not comptime
fields(typeof x)                          // OK if `typeof` is the comptime operator
```

> **Design:** See [Challenge 3: Decidability](constraints-as-types.md#challenge-3-decidability-and-the-two-layer-system) - the two-layer system separates always-decidable classification constraints from value refinements that may need runtime checks.

### 3. Type Inference

Hindley-Milner style type inference with extensions for refinements.

```
// Types inferred from usage
let x = 5                    // x: number (literal type 5? or widened to number?)
let y = [1, 2, 3]           // y: Array<number, 3>
let f = fn(a, b) => a + b   // f: (number, number) -> number

// Polymorphic functions inferred
let id = fn(x) => x         // id: forall T. T -> T
let first = fn(pair) => pair.0  // first: forall A, B. (A, B) -> A
```

> **Design:** See [Type Inference with Constraint Variables](constraints-as-types.md#3-type-inference-with-constraint-variables) and [Challenge 6: Functions as Constraint Inference](constraints-as-types.md#challenge-6-functions-as-constraint-inference) - constraints are inferred from function bodies, enabling maximum polymorphism without redundant annotations.

### 4. Compile-Time Reflection

Types are first-class values that can be inspected and manipulated at compile time.

```
// Get type of a value (comptime operation)
comptime T = typeof myValue

// Inspect type structure
fields(T)                    // Array of field names
fieldType(T, "name")        // Type of the "name" field
hasField(T, "age")          // Boolean

// Type predicates
isObject(T)
isArray(T)
isFunction(T)
isSubtype(A, B)             // A <: B

// Construct types programmatically
objectType({ name: string, age: number })
arrayType(string, 10)       // Array<string, 10>
unionType(string, number)   // string | number
```

> **Design:** See [Challenge 4: Type of Types](constraints-as-types.md#challenge-4-what-is-the-type-of-types) - types are comptime values that can be passed to reflection functions like `fields()`.

### 5. Type Safety

The type system should be sound - well-typed programs don't go wrong.

```
// No implicit any
let x                        // ERROR: cannot infer type

// Exhaustive pattern matching
fn describe(x: string | number) =
  match x with
  | s: string => "string: " ++ s
  // ERROR: non-exhaustive, missing number case

// Null safety
let name: string = null      // ERROR: string is not nullable
let maybeName: string? = null // OK: explicit nullable type
```

> **Design:** See [Challenge 10: unknown](constraints-as-types.md#challenge-10-unknown-no-any) - no `any` type for soundness, and [Challenge 9: never](constraints-as-types.md#challenge-9-the-never-type) - explicit bottom type for contradictions.

### 6. Refinement Types with Flexible Verification

Types can have constraints (refinements) that are verified either at compile time or runtime.

**API designer specifies constraints:**
```
fn processSmallBatch<N: number>(items: Array<Item, N>) where N < 100 =
  // ... implementation

fn sqrt(n: number) where n >= 0 -> number =
  // ... implementation
```

**Caller satisfies constraints in three ways:**

```
// 1. Compile-time proof (zero runtime cost)
let items = [a, b, c]        // Length 3, known at compile time
processSmallBatch(items)     // OK: compiler proves 3 < 100

// 2. Runtime assertion (explicit check)
let data = fetchItems()      // Length unknown at compile time
processSmallBatch(assert data.length < 100)
// Inserts runtime check, throws if false
// After assertion, compiler knows the constraint holds

// 3. Unsafe trust (escape hatch)
processSmallBatch(trust data)
// No runtime check, programmer takes responsibility
// Like Rust's `unsafe` - use sparingly
```

**Control flow refinement:**
```
let arr = fetchItems()       // Array<Item, ?>

if arr.length < 100 {
  // Inside this branch, compiler knows arr.length < 100
  processSmallBatch(arr)     // OK: proven by the condition
}
```

**Arithmetic propagation:**
```
let n = 5
let m = n + 3                // Compiler tracks: m = 8
let arr = makeArray(m, 0)    // Array<Int, 8>
processSmallBatch(arr)       // OK: compiler proves 8 < 100
```

**Assertion modes for builds:**
```
--assertions=all      // All runtime assertions active
--assertions=debug    // Debug assertions only, stripped in release
--assertions=none     // All assertions become trust (max performance)
```

> **Design:** See [Challenge 3: Decidability](constraints-as-types.md#challenge-3-decidability-and-the-two-layer-system) - classification constraints are always compile-time decidable, value refinements use `assert`/`trust` when not provable.

### 7. Good Error Messages for API Designers

API designers can provide custom error messages for constraint violations.

```
fn connect<Port: number>(port: Port)
  where Port >= 1 && Port <= 65535
    else "Port must be between 1 and 65535, got ${Port}"
  where Port != 80
    else "Port 80 is reserved for HTTP, use a different port"
=
  // ... implementation

connect(0)       // Error: Port must be between 1 and 65535, got 0
connect(80)      // Error: Port 80 is reserved for HTTP, use a different port
connect(70000)   // Error: Port must be between 1 and 65535, got 70000
```

> **Design:** See [Challenge 7: Error Messages](constraints-as-types.md#challenge-7-error-messages) - canonical forms for common constraint combinations enable natural error messages.

### 8. Immutable Source, Optimized Output

The source language is purely functional (no mutation), but the compiler can generate mutable code when it's safe and more efficient.

```
// Source: immutable operations
fn sumList(xs: Array<number>) =
  fold(xs, 0, fn(acc, x) => acc + x)

// Generated JS: uses mutation for efficiency
function sumList(xs) {
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i];
  }
  return acc;
}
```

```
// Source: immutable update
fn incrementAge(person: Person) =
  { ...person, age: person.age + 1 }

// Generated: in-place mutation when safe
function incrementAge(person) {
  person.age += 1;  // Safe if person is not aliased
  return person;
}
```

> **Design:** Code generation optimization - not covered in constraints-as-types.md. Requires separate design for alias analysis and mutation optimization.

### 9. Single Collection Type with Specialization

Use `Array<T, N?>` as the single collection primitive. The compiler specializes based on usage patterns.

```
// All of these are just Array with different known properties:
let fixed = [1, 2, 3]           // Array<number, 3> - length known
let dynamic = fetchItems()       // Array<Item, ?> - length unknown
let growing = []                 // Specialized to growable if push() used

// Operations determine specialization:
let a = push(arr, x)            // Needs growable backing
let b = arr[0]                  // Needs indexable
let c = map(arr, f)             // Can use any representation

// Generated code uses appropriate JS construct:
// - Fixed small: tuple/array literal
// - Growable: Array with push
// - Large fixed: TypedArray where applicable
```

> **Design:** See [Tuples and Heterogeneous Collections](constraints-as-types.md#tuples-and-heterogeneous-collections) - arrays and tuples unified as constraint sets with `isArray`, `elements`, `length`, and `elementAt` constraints.

### 10. Partial Evaluation and Specialization

When inputs are known at compile time, code is specialized and optimized.

```
fn power(base: number, exp: number) -> number =
  if exp == 0 then 1
  else base * power(base, exp - 1)

// Called with known exponent:
comptime square = power(?, 2)    // ? is placeholder for runtime value

// Generated specialized function:
function square(base) {
  return base * base;            // Loop unrolled, recursion eliminated
}
```

```
fn formatDate(date: Date, format: string) -> string =
  // ... parse format string and build result

// Format string known at compile time:
comptime isoFormat = formatDate(?, "YYYY-MM-DD")

// Generated: format string parsing done at compile time
function isoFormat(date) {
  return date.year + "-" + pad(date.month) + "-" + pad(date.day);
}
```

> **Design:** Code generation optimization. Relates to staging (comptime forcing) covered in [Challenge 4](constraints-as-types.md#challenge-4-what-is-the-type-of-types). Requires separate design for partial evaluation.

## Ideas (To Explore)

### Easy DSLs via Implicit Environment

An implicit environment parameter allows clean DSL syntax:

```
// SQL DSL - `query` provides an implicit environment
query {
  from(users)                    // users is from environment
  where(age > 18)               // age is a column reference
  select(name, email)
}

// Expands to something like:
query(fn(env) =>
  select(
    where(from(env.users), fn(row) => row.age > 18),
    ["name", "email"]
  )
)
```

### Type Classes via Reflection + Global Registries

Instead of special type class syntax, use compile-time reflection with a global registry:

```
// Register implementations at module level
register Eq(number) = fn(a, b) => a == b
register Eq(string) = fn(a, b) => a == b
register Eq(Array<T>) where Eq(T) = fn(a, b) =>
  a.length == b.length && zip(a, b).all(fn((x,y)) => eq(x, y))

// Usage - compiler looks up from registry at compile time
fn contains<T>(arr: Array<T>, item: T) where Eq(T) =
  arr.any(fn(x) => eq(x, item))
```

**Open question:** How to extend the registry in an immutable/composable way across modules?

## TypeScript Compatibility

The language should be able to consume `.d.ts` files:

```
// Import types from TS definitions
import { Request, Response } from "express"

// Use them as normal types
fn handler(req: Request, res: Response) =
  res.send("Hello")
```

And produce `.d.ts` files for its own exports:

```
// Our module
export fn add(a: number, b: number) -> number = a + b

// Generated .d.ts
export declare function add(a: number, b: number): number;
```

> **Design:** See [Challenge 10: unknown](constraints-as-types.md#challenge-10-unknown-no-any) for handling TypeScript's `any` type during import (treated as `unknown`).

