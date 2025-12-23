# Constraints as Types: Design Exploration

## The Core Idea

Instead of types being structural things with refinements attached:
```typescript
{ type: "number", value?: 5, refinements: [...] }
```

Types ARE just sets of constraints:
```
[isNumber(x), x == 5, x > 0, ...]
```

Everything - primitive types, object types, literal types, refinements - is unified into a single constraint language.

## Current Implementation Analysis

Looking at `src/types.ts`, the existing approach has:
- Base types: `number`, `string`, `boolean`, `object`, `function`, `any`, `untyped`
- Optional literal values on primitives: `{ type: "number", value: 5 }`
- Refinements attached to any type: `type.refinements?: Refinement[]`
- A node graph where each node can be refined over time

The key functions:
- `isRefinementOf(source, refinement)` - checks if source satisfies refinement's constraints
- `refineType(source, refinement)` - narrows source with additional constraints
- Refinements track `original` node, `application` (the constraint), and `reduce` (how to check it)

So you're already treating refinements as constraints - the question is whether to unify this with the "base type" concept.

## Proposal: Unified Constraint Model

### Constraint Language

```typescript
type Constraint =
  // Classification constraints (what we now call "types")
  | { tag: "isNumber" }
  | { tag: "isString" }
  | { tag: "isBool" }
  | { tag: "isObject" }
  | { tag: "isArray" }
  // Note: isFunction is not a constraint in the traditional sense
  // See "Challenge 6: Functions as Constraint Inference" for the model

  // Value constraints
  | { tag: "equals", value: unknown }          // x == 5
  | { tag: "notEquals", value: unknown }       // x != 5

  // Comparison constraints (for numbers)
  | { tag: "lessThan", bound: ConstraintExpr }
  | { tag: "lessOrEqual", bound: ConstraintExpr }
  | { tag: "greaterThan", bound: ConstraintExpr }
  | { tag: "greaterOrEqual", bound: ConstraintExpr }

  // Object structure constraints
  | { tag: "hasField", name: string, fieldConstraint: Constraint }
  | { tag: "exactFields", fields: { name: string, constraint: Constraint }[] }

  // Array constraints (homogeneous)
  | { tag: "length", lengthConstraint: Constraint }
  | { tag: "elements", elementConstraint: Constraint }

  // Tuple constraints (heterogeneous - position-specific types)
  | { tag: "elementAt", index: number, constraint: Constraint }

  // Logical
  | { tag: "and", constraints: Constraint[] }
  | { tag: "or", constraints: Constraint[] }
  | { tag: "not", constraint: Constraint }

  // Inference variables
  | { tag: "variable", id: number }

// Expressions within constraints (for things like "x < y + 1")
type ConstraintExpr =
  | { tag: "literal", value: number }
  | { tag: "variable", id: number }
  | { tag: "add", left: ConstraintExpr, right: ConstraintExpr }
  | { tag: "sub", left: ConstraintExpr, right: ConstraintExpr }
  | { tag: "fieldOf", object: ConstraintExpr, field: string }
```

### What Traditional Types Become

```
// Primitive types
number      → { tag: "isNumber" }
string      → { tag: "isString" }
boolean     → { tag: "isBool" }

// Literal types
5           → { tag: "and", constraints: [{ tag: "isNumber" }, { tag: "equals", value: 5 }] }
"hello"     → { tag: "and", constraints: [{ tag: "isString" }, { tag: "equals", value: "hello" }] }
true        → { tag: "and", constraints: [{ tag: "isBool" }, { tag: "equals", value: true }] }

// Object types
{ name: string, age: number }
→ { tag: "and", constraints: [
    { tag: "isObject" },
    { tag: "hasField", name: "name", fieldConstraint: { tag: "isString" } },
    { tag: "hasField", name: "age", fieldConstraint: { tag: "isNumber" } }
  ]}

// Array types
Array<number, 5>
→ { tag: "and", constraints: [
    { tag: "isArray" },
    { tag: "elements", elementConstraint: { tag: "isNumber" } },
    { tag: "length", lengthConstraint: { tag: "equals", value: 5 } }
  ]}

// Refined types
number where x > 0
→ { tag: "and", constraints: [
    { tag: "isNumber" },
    { tag: "greaterThan", bound: { tag: "literal", value: 0 } }
  ]}

// Union types
string | number
→ { tag: "or", constraints: [{ tag: "isString" }, { tag: "isNumber" }] }

// Intersection types
A & B
→ { tag: "and", constraints: [A, B] }

// Tuples (heterogeneous arrays)
[string, number, boolean]
→ { tag: "and", constraints: [
    { tag: "isArray" },
    { tag: "length", lengthConstraint: { tag: "equals", value: 3 } },
    { tag: "elementAt", index: 0, constraint: { tag: "isString" } },
    { tag: "elementAt", index: 1, constraint: { tag: "isNumber" } },
    { tag: "elementAt", index: 2, constraint: { tag: "isBool" } }
  ]}
```

### Tuples and Heterogeneous Collections

Tuples are arrays with position-specific type constraints. The key insight is that **a tuple is a more refined array**:

```
[string, number] <: Array<string | number>

// Because:
[isArray, length == 2, elementAt(0, isString), elementAt(1, isNumber)]
  implies
[isArray, elements(isString OR isNumber)]
```

**Tuple access depends on index being compile-time known:**

```
let t: [string, number, boolean] = ["hello", 42, true]

t[0]        // index 0 known at compile time → isString
t[1]        // index 1 known at compile time → isNumber

let i = getIndex()
t[i]        // index unknown → isString OR isNumber OR isBool (union of all)
```

This connects to staging:
- **comptime index** → precise element type from `elementAt`
- **runtime index** → must use union of all element types

## Key Operations

### 1. Subtyping as Implication

`A <: B` means: every value satisfying A also satisfies B.

In constraint terms: `constraints(A) implies constraints(B)`

```
// { name: string, age: number } <: { name: string }
// Because having both fields implies having just name

[isObject, hasField("name", isString), hasField("age", isNumber)]
  implies
[isObject, hasField("name", isString)]
// TRUE - more constraints implies fewer
```

```
// 5 <: number
[isNumber, equals(5)] implies [isNumber]
// TRUE - literal is more constrained
```

```
// (number where x > 0) <: number
[isNumber, x > 0] implies [isNumber]
// TRUE
```

### 2. Unification

When we need two things to be the same type, we take the conjunction of their constraints:

```
unify(T, U) = and(constraints(T), constraints(U))
```

But we need to check for contradictions:
```
unify([isNumber], [isString]) = [isNumber, isString] = CONTRADICTION (empty set)
unify([isNumber, x > 0], [isNumber, x < 10]) = [isNumber, x > 0, x < 10] = OK
unify([equals(5)], [equals(6)]) = CONTRADICTION
```

### 3. Type Inference with Constraint Variables

```
let f = fn(x) => x + 1

// x has constraint variable ?A
// x + 1 requires isNumber(x), produces isNumber(result)
// So we learn: ?A = isNumber

// Result: f : (x: number) -> number
```

```
let g = fn(x) => x.name

// x has constraint variable ?A
// x.name requires hasField(x, "name", ?B)
// So we learn: ?A includes hasField("name", ?B)

// Result: g : (x: { name: ?B }) -> ?B
```

## Challenge 1: Representing "Unknown Structure"

In traditional types, we have type variables: `T`, `U`, etc.

In constraint land, a type variable is a constraint variable - we don't know what constraints it has yet.

```typescript
type ConstraintVar = { tag: "variable", id: number }
```

When we learn something about a variable, we add constraints to it:

```
// Initially: ?T = {} (no constraints known)
// After seeing x + 1 where x : ?T
// We learn: ?T = { isNumber }
```

This is essentially the substitution in traditional unification, but instead of substituting types, we're accumulating constraints.

## Challenge 2: Object Types - Open vs Closed

**Decision: Open by default, with ability to specify closed.**

**Open (structural)** - has AT LEAST these fields, extra fields allowed:
```
[isObject, hasField("name", isString), hasField("age", isNumber)]

// These all satisfy the constraint:
{ name: "Alice", age: 30 }           // exact match
{ name: "Bob", age: 25, role: "admin" }  // extra field OK
```

**Closed (exact)** - has EXACTLY these fields, nothing else:
```
[isObject, exactFields([("name", isString), ("age", isNumber)])]

// Only this satisfies:
{ name: "Alice", age: 30 }           // OK
{ name: "Bob", age: 25, role: "admin" }  // ERROR: extra field
```

**Object literals** know their exact fields but are assignable to open types:
```
let person = { name: "Alice", age: 30 }
// person has constraint: [isObject, hasField("name", isString AND equals("Alice")),
//                                   hasField("age", isNumber AND equals(30))]

let named: { name: string } = person   // OK: person's constraints imply hasField("name", isString)
```

**Subtyping:**
```
// More fields implies fewer (open objects)
{ name: string, age: number } <: { name: string }

// Exact is more restrictive
exactFields([name, age]) <: hasField("name") AND hasField("age")
// but NOT vice versa
```

## Challenge 3: Decidability and the Two-Layer System

### Key Insight: Classification is Always Decidable

Classification constraints form a **boolean algebra** over disjoint base types. This is always decidable because it's just propositional logic.

**Layer 1: Classification Constraints (always decidable, always compile-time)**
- Primitive classification: `isNumber`, `isString`, `isBool`, `isNull`, `isUndefined`
- Structural: `isObject`, `isArray`, `isFunction`
- Field presence: `hasField(name, constraint)`
- Tuple positions: `elementAt(index, constraint)`
- Logical combinations: `AND`, `OR`, `NOT`

**These support heterogeneous collections and type narrowing:**
```
// Union type (heterogeneous)
let items: (string | number)[] = [1, "hello", 2]

// Type narrowing via control flow
items.forEach(fn(x) =>
  if isString(x) then
    x.toUpperCase()      // x narrowed to string
  else
    x + 1                // x narrowed to number
)
```

This works because:
```
x : isString OR isNumber

// In the isString branch:
(isString OR isNumber) AND isString = isString

// In the else branch:
(isString OR isNumber) AND NOT isString = isNumber
```

### Layer 2: Value Refinements (may need runtime checks)

**Potentially expensive/undecidable:**
- Comparisons: `x > 0`, `x < 100`, `x == y`
- Arithmetic: `x + y < 100`, `length(a) + length(b) <= max`
- Complex predicates: custom validation functions

**The deal:**
- Compiler tries to prove these at compile time when values are known
- If it can't prove, require `assert` (runtime check) or `trust` (programmer promise)

```
fn processSmall<N>(arr: Array<Item, N>) where N < 100

// Proven at compile time:
processSmall([1, 2, 3])              // 3 < 100 ✓

// Cannot prove - needs assertion:
let data = fetchItems()
processSmall(data)                    // ERROR: can't prove length < 100
processSmall(assert data.length < 100) // OK: runtime check
processSmall(trust data)              // OK: no check, programmer promises
```

### Control Flow Refinement for Value Constraints

```
let arr = fetchItems()       // length unknown

if arr.length < 100 {
  // Compiler adds constraint: length < 100
  processSmall(arr)          // OK: proven by condition
}
```

### Arithmetic Propagation

When values are compile-time known, the compiler tracks arithmetic:

```
let n = 5
let m = n + 3                // Compiler knows: m == 8
let arr = makeArray(m, 0)    // Array with length == 8
processSmall(arr)            // OK: 8 < 100 provable
```

### Summary Table

| Constraint Type | Decidable | Compile-time | Runtime Check Allowed |
|-----------------|-----------|--------------|----------------------|
| isNumber, isString, etc. | Always | Always | No (must be static) |
| hasField, elementAt | Always | Always | No (must be static) |
| OR, AND, NOT of above | Always | Always | No (must be static) |
| equals(literal) | Always | Always | No |
| x > 0, x < n | Simple cases | When provable | Yes (via assert) |
| x + y < z | Harder | When values known | Yes (via assert) |
| Arbitrary predicates | Maybe not | Rarely | Yes (via assert) |

## Challenge 4: What is the "Type of Types"?

**Decision: Types are comptime values with `isType` constraint (Option B).**

Types are values like any other, but:
1. They have the `isType` constraint
2. They must be known at compile time (comptime)

```typescript
// Add to constraint language:
| { tag: "isType" }  // This value is a type (a constraint set)
```

**This unifies type-level and value-level:**
```
// These are all just values with different constraints:
5           // constraint: [isNumber, equals(5)]
"hello"     // constraint: [isString, equals("hello")]
number      // constraint: [isType, equals(numberConstraint)]
string      // constraint: [isType, equals(stringConstraint)]

// Type-level functions are just functions that operate on types:
fn nullable(T: Type) -> Type = T | null
fn arrayOf(T: Type, n: number) -> Type = Array<T, n>

// Reflection functions take types as normal (comptime) parameters:
fn fields(T: Type) -> Array<string>
fn fieldType(T: Type, name: string) -> Type
```

**Comptime requirement:**
```
fn printFields<T>(value: T) =
  // T is comptime-known (it's a type parameter)
  for field in fields(T) do          // OK: fields() requires comptime Type
    print(field)

let MyType = { name: string, age: number }   // MyType is comptime
fields(MyType)                                // OK

let runtimeType = getTypeFromSomewhere()     // NOT comptime
fields(runtimeType)                           // ERROR: fields requires comptime
```

**Type constructors are just functions:**
```
// Array<T, N> is really:
fn Array(T: Type, N: number) -> Type =
  [isArray, elements(T), length(equals(N))]

// Nullable<T> is:
fn Nullable(T: Type) -> Type = T | null
```

This achieves the goal: **type-level programming uses the same syntax as value-level programming.**

## Challenge 6: Functions as Constraint Inference

**Decision: Functions don't store explicit param/result constraints. Constraints are inferred from the body.**

### The Insight

Why store constraints separately when the body already defines them?

```
fn add(x, y) = x + y

// Don't store: params are number, result is number
// Just store: params are [x, y], body is "x + y"

// When type-checking a call:
add(1, 2)

// 1. Bind x = 1, y = 2 (with their constraints)
// 2. Analyze body: 1 + 2
// 3. The + operation requires isNumber on both operands
// 4. 1 satisfies isNumber ✓, 2 satisfies isNumber ✓
// 5. Result: isNumber (and equals(3) if values known)
```

### Minimal Function Representation

```typescript
type Function = {
  params: string[],       // just parameter names
  body: Expression,       // the computation
  where?: Constraint,     // optional EXTRA constraints (beyond body)
  errorMessage?: string   // optional custom error for where clause
}
```

### Constraints Come From Two Sources

1. **Inferred from body** - what the body's operations require
2. **Explicit `where` clause** - additional constraints the API designer wants

```
// Inferred only:
fn add(x, y) = x + y
// Body requires: isNumber(x), isNumber(y)
// Result: isNumber

// With explicit constraint:
fn safeDiv(x, y) where y != 0 = x / y
// Body requires: isNumber(x), isNumber(y)
// Where adds: y != 0
// Combined: isNumber(x), isNumber(y), y != 0

// With custom error message:
fn processSmall(arr) where length(arr) < 100 else "Array too large" =
  arr.map(process)
// Body might not require length < 100
// But API designer enforces it with helpful message
```

### Polymorphism Falls Out Naturally

```
fn id(x) = x
// Body: return x
// x bound to ?A (fresh variable)
// Result: ?A
// No constraints learned - works for ANY type

fn first(pair) = pair[0]
// Body: index into pair
// pair must satisfy: isArray AND length > 0
// Result: elementAt(0) of pair
// Polymorphic in element type
```

### How Application Works

```
fn add(x, y) = x + y

add(1, 2)
// 1. Create fresh variables for params: x -> ?1, y -> ?2
// 2. Unify ?1 with constraints of 1: ?1 = [isNumber, equals(1)]
// 3. Unify ?2 with constraints of 2: ?2 = [isNumber, equals(2)]
// 4. Analyze body with these bindings: ?1 + ?2
// 5. + requires isNumber - satisfied ✓
// 6. Result: [isNumber, equals(3)]

add("hello", "world")
// 1. x -> ?1 = [isString, equals("hello")]
// 2. y -> ?2 = [isString, equals("world")]
// 3. Analyze body: ?1 + ?2
// 4. + requires isNumber
// 5. isString AND isNumber = CONTRADICTION
// 6. Type error!
```

### Recursive Functions

Standard fixed-point approach:
```
fn length(list) = if isEmpty(list) then 0 else 1 + length(tail(list))

// 1. Assume length : ?A -> ?B (fresh variables)
// 2. Analyze body:
//    - isEmpty(list) requires list is array-like
//    - tail(list) returns array-like
//    - 1 + recursive call requires result is number
// 3. Learn: ?A = isArray, ?B = isNumber
// 4. Check consistency with assumption ✓
```

### Caching Inferred Constraints

Analyzing the body for every call would be expensive. In practice:
1. Analyze function body once when defined
2. Cache the inferred constraint scheme (with quantified variables)
3. Instantiate cached scheme on each call

### Benefits

1. **No redundant annotations** - body defines the constraints
2. **Maximum polymorphism** - functions work for anything the body works for
3. **Explicit constraints only when needed** - use `where` for extra requirements
4. **Natural inference** - same mechanism as let bindings

## Challenge 7: Error Messages

Traditional: "Expected number, got string"
Constraints: "Constraint isNumber(x) not satisfied where x has constraint isString"

These are equivalent in meaning, but the constraint version could be verbose.

**Proposal:** Keep "canonical forms" for common constraint combinations:
```
[isNumber] → "number"
[isString] → "string"
[isNumber, equals(5)] → "5"
[isObject, hasField("name", isString)] → "{ name: string, ... }"
[isNumber, greaterThan(0)] → "number where > 0"
```

Then errors read naturally:
"Expected number where > 0, got -5"

## Proposed Implementation Path

### Phase 1: Core Constraint Types
- Implement constraint data structure
- Classification constraints only (isNumber, isString, etc.)
- Basic conjunction
- Subtyping as implication
- Unification with constraints

### Phase 2: Object and Array Constraints
- hasField constraint
- elements constraint
- length constraint (without arithmetic yet)

### Phase 3: Refinement Constraints
- Comparison operators (>, <, >=, <=)
- Simple arithmetic in bounds (x < n + 1)
- assert and trust syntax
- Runtime check generation

### Phase 4: Inference
- Constraint variables
- Constraint propagation
- Let-polymorphism with constraint generalization

### Phase 5: Advanced
- SMT integration for complex constraints
- Custom predicates
- Better error messages

## Example: Full Program

```
// Define a function with refinement
fn safeHead<N>(arr: Array<T, N>) where N > 0 -> T =
  arr[0]

// Usage
let items = [1, 2, 3]           // Constraint: isArray, length == 3, elements: isNumber
safeHead(items)                  // OK: 3 > 0 provable

let empty = []                   // Constraint: isArray, length == 0
safeHead(empty)                  // ERROR: cannot prove 0 > 0

let dynamic = fetchItems()       // Constraint: isArray, length == ?N
safeHead(dynamic)                // ERROR: cannot prove ?N > 0
safeHead(assert dynamic.length > 0)  // OK: runtime check inserted
```

## Challenge 5: Classification Hierarchy and Contradictions

**Decision: Model JavaScript/TypeScript's actual classification hierarchy.**

### Classification Hierarchy

```
             value
           /       \
      primitive    object
      /  |  \      /    \
   num str bool  array  function  (plain object)

   null, undefined - special, disjoint from everything
```

**Implication rules:**
```
isArray    → isObject    // arrays are objects
isFunction → isObject    // functions are objects
equals(5)  → isNumber    // literal implies classification
equals("x") → isString
equals(true) → isBool
```

### Disjoint Sets (Contradictions)

```
// Primitives are mutually exclusive
isNumber AND isString           → never
isNumber AND isBool             → never
isBool AND isString             → never

// null/undefined exclusive with everything
isNull AND isUndefined          → never
isNull AND isNumber             → never
isNull AND isObject             → never

// Primitives vs objects
isNumber AND isObject           → never
isString AND isArray            → never
isBool AND isFunction           → never

// Array vs function (both are objects, but disjoint)
isArray AND isFunction          → never

// Literal conflicts
equals(5) AND equals(6)         → never
equals("a") AND equals("b")     → never

// Literal vs incompatible classification
isString AND equals(5)          → never  // 5 is not a string
isNumber AND equals("hello")    → never
```

### NOT Contradictions

```
isArray AND isObject            → isArray  // array implies object, so just isArray
isObject AND hasField("x", _)   → OK       // objects can have fields
isNumber AND greaterThan(0)     → OK       // refinement on number
```

### Implementation: Contradiction Detection

```typescript
// Primitives + null/undefined + object are all mutually exclusive at top level
const TOP_LEVEL_DISJOINT = [
  "isNumber", "isString", "isBool", "isNull", "isUndefined", "isObject"
];

// Within isObject, these are disjoint
const OBJECT_SUBTYPES_DISJOINT = ["isArray", "isFunction"];

// Implication rules
const IMPLIES: Record<string, string> = {
  "isArray": "isObject",
  "isFunction": "isObject",
};

function isContradiction(constraints: Constraint[]): boolean {
  // 1. Normalize: apply implication rules
  // 2. Check for multiple top-level disjoint constraints
  // 3. Check for multiple object-subtype disjoint constraints
  // 4. Check for conflicting equals() values
  // 5. Check for equals() incompatible with classification
}
```

## Challenge 8: Recursive Types

**Decision: Use a `rec` binder (μ type) as the core representation.**

### The Problem

Recursive types like `List<T> = null | { head: T, tail: List<T> }` would cause infinite expansion if we tried to fully expand them as constraints.

### Solution: The `rec` Binder

Add recursive constraint constructs:

```typescript
type Constraint =
  // ... existing ...
  | { tag: "rec", var: string, body: Constraint }   // μX. body (recursive type)
  | { tag: "recVar", var: string }                   // X (reference to binding)
```

### Example: List Type

```
// User writes:
type List<T> = null | { head: T, tail: List<T> }

// Desugars to:
List = fn(T: Type) =>
  { tag: "rec", var: "X", body:
    or(isNull, and(isObject, hasField("head", T), hasField("tail", recVar("X"))))
  }

// List<number> is:
rec X. isNull OR (isObject AND hasField("head", isNumber) AND hasField("tail", X))
```

### Subtyping with Recursive Types

Use **coinductive reasoning** (the assume rule):

```
// Check: List<number> <: List<any>

// 1. Assume: List<number> <: List<any>
// 2. Expand both sides one level:
//    (null | {head: number, tail: List<number>}) <: (null | {head: any, tail: List<any>})
// 3. Check each branch:
//    - null <: null ✓
//    - {head: number, tail: List<number>} <: {head: any, tail: List<any>}
//      - head: number <: any ✓
//      - tail: List<number> <: List<any> -- use assumption! ✓
// 4. All branches verified, assumption holds ✓
```

If we encounter the same subtyping check we already assumed, we succeed (coinductive).

### Inference of Recursive Types

```
fn length(list) = if isNull(list) then 0 else 1 + length(list.tail)

// Analysis:
// - list : ?A (fresh variable)
// - isNull(list) means in else branch: NOT isNull(?A)
// - list.tail requires: hasField("tail", ?B)
// - recursive call length(list.tail) means ?B must satisfy same constraints as ?A
// - Constraint: ?B = ?A (same type for tail as for list)
//
// This creates a cycle: ?A = isObject AND hasField("tail", ?A) AND ...
// Generalize to: ?A = rec X. (isNull OR (isObject AND hasField("tail", X) AND hasField("head", ?C)))
```

When a constraint variable is constrained to equal itself through a cycle, we introduce a `rec` binder.

### Named Types as Sugar

Named type definitions desugar to `rec`:

```
// This:
type Tree<T> = { value: T, left: Tree<T>?, right: Tree<T>? }

// Becomes:
Tree = fn(T: Type) =>
  rec X. and(isObject,
    hasField("value", T),
    hasField("left", or(X, isNull)),
    hasField("right", or(X, isNull)))
```

### Equality of Recursive Types

Two recursive types are equal if they have the same structure up to renaming of the `rec` variable:

```
rec X. (A | {tail: X})  =  rec Y. (A | {tail: Y})   // Same structure, different var names
```

This is **equi-recursive** treatment - structural equality.

## Performance Considerations (Not a Priority Initially)

Some thoughts on performance, though not critical for initial implementation:

### Potential Issues

1. **Constraint set growth** - Conjunctions accumulate as we analyze code
2. **Subtyping checks** - Implication checking could be expensive for large constraints
3. **Recursive type traversal** - Need to detect cycles to avoid infinite loops

### Mitigation Strategies (for later)

**Simplification rules:**
```
isNumber AND isNumber       → isNumber       // Idempotent
isArray AND isObject        → isArray        // Subsumption (array implies object)
equals(5) AND isNumber      → equals(5)      // Literal implies classification
greaterThan(5) AND greaterThan(3) → greaterThan(5)  // Tighten bounds
```

**Hash consing:**
Share identical constraint objects in memory. If we see `isNumber` many times, there's only one instance.

**Caching:**
- Cache function constraint schemes after first analysis
- Cache subtyping check results (A <: B) for repeated queries
- Cache contradiction checks

**Lazy expansion:**
Don't fully expand recursive types or complex constraints until needed. Keep them as references.

**Normal forms:**
Keep constraints in a canonical form (e.g., sorted, flattened) to make comparison and simplification easier:
```
// Flatten nested ANDs:
and(and(A, B), C) → and(A, B, C)

// Sort by constraint type:
and(hasField("z"), isObject, hasField("a")) → and(isObject, hasField("a"), hasField("z"))
```

### When to Optimize

Start simple - just make it work. Profile actual usage to find real bottlenecks. Likely candidates:
- Programs with many type annotations
- Deep object nesting
- Complex generic functions with many instantiations
- Recursive types with deep nesting

## Challenge 9: The `never` Type

**Decision: Explicit `never` constraint, normalize to it when contradictions detected.**

```typescript
type Constraint =
  // ... existing ...
  | { tag: "never" }  // The bottom type - no values satisfy this
```

**When contradictions are detected, normalize to `never`:**
```
unify(isNumber, isString)
  → and(isNumber, isString)
  → detect contradiction
  → { tag: "never" }
```

**Properties of `never`:**
```
never <: T        // never is subtype of everything (vacuously true)
T <: never        // only never is subtype of never
never | T = T     // never disappears from unions
never & T = never // never absorbs intersections
```

**Why explicit `never`:**
- Avoids re-computing contradiction checks
- Makes subtyping checks simpler
- Clear representation in error messages

## Challenge 10: `unknown` (No `any`)

**Decision: Support `unknown`, don't support `any`.**

**`unknown`** = empty constraint set `[]` (no constraints known)

```
let x: unknown = getValue()

x + 1           // ERROR: x has no constraints, + requires isNumber
x.foo           // ERROR: x has no constraints, . requires hasField

if isNumber(x) {
  x + 1         // OK: x now has constraint isNumber in this branch
}
```

**Why no `any`:**
- `any` breaks soundness - it claims to satisfy all constraints
- With `unknown` + narrowing + `trust`, you can do everything `any` does but explicitly
- Keeps the type system sound

**For TypeScript interop:**
When importing `.d.ts` files, treat `any` as `unknown`. The user must narrow or `trust` before use.

```
// TypeScript .d.ts:
declare function getStuff(): any;

// In our language:
let x = getStuff()   // x : unknown
x + 1                // ERROR
(trust x) + 1        // OK, programmer takes responsibility
```

## Challenge 11: Discriminated Unions

**Decision: Narrowing eliminates contradictory branches from OR constraints.**

**The pattern:**
```
type Shape =
  | { kind: "circle", radius: number }
  | { kind: "square", side: number }

// In constraints:
Shape = or(
  and(isObject, hasField("kind", equals("circle")), hasField("radius", isNumber)),
  and(isObject, hasField("kind", equals("square")), hasField("side", isNumber))
)
```

**Narrowing on `s.kind === "circle"`:**
```
s : Shape

// Add constraint: hasField("kind", equals("circle"))
s AND hasField("kind", equals("circle"))

// Distribute AND over OR:
// Branch 1: circle branch AND equals("circle") → OK (consistent)
// Branch 2: square branch AND equals("circle") → contradiction! (equals("square") AND equals("circle"))

// Eliminate contradictory branches:
s : and(isObject, hasField("kind", equals("circle")), hasField("radius", isNumber))
```

**The key operation:**
```
(A OR B) AND C = (A AND C) OR (B AND C)
               = (filter out contradictory branches)
```

**Implementation:**
```typescript
function narrowOr(or: OrConstraint, additional: Constraint): Constraint {
  const survivingBranches = or.constraints
    .map(branch => and(branch, additional))
    .filter(branch => !isNever(branch));  // Remove contradictions

  if (survivingBranches.length === 0) return { tag: "never" };
  if (survivingBranches.length === 1) return survivingBranches[0];
  return { tag: "or", constraints: survivingBranches };
}
```

**This handles all narrowing patterns:**
- Literal discriminants: `kind === "circle"`
- Type guards: `isString(x)` narrows `string | number` to `string`
- Truthiness: `if (x)` eliminates `null`/`undefined`/`false`/`0`/`""`
- Equality: `x === y` unifies constraints