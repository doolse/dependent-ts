# Refactoring Plan: Body-Based Type Derivation

## Overview

This document outlines a proposed architectural simplification: **removing explicit function type declarations (`fnType`, `genericFnType`) in favor of deriving types from body analysis at call sites.**

The core insight is that the current system has two parallel mechanisms:
1. **Type inference** (`inference.ts`) - analyzes function bodies to produce `fnType`
2. **Staged evaluation** (`staged-evaluate.ts`) - analyzes function bodies when called with constraints

These are redundant. We can unify them by always using staged evaluation and deriving result constraints on-demand.

---

## Part 1: The Problem with Declared Function Types

### Current Architecture

When a function is defined:
```
let f = fn(x) => x + 1
```

1. `inferFunction()` analyzes the body with a fresh constraint variable for `x`
2. Discovers `x` must satisfy `isNumber` (because `+` requires it)
3. Produces `fnType([isNumber], isNumber)`
4. This constraint is stored with the closure

When called:
```
f(5)
```

1. Check that `and(isNumber, equals(5))` implies `isNumber` ✓
2. Result has constraint `isNumber`

### The Redundancy

The result constraint `isNumber` is **less precise** than what we could derive. If we analyzed the body with the actual argument constraint `and(isNumber, equals(5))`, we'd get `and(isNumber, equals(6))`.

The `fnType` is a **summary** that loses information. It answers "what happens with any number?" when we actually know we have `5`.

### What Staged Evaluation Already Does

When arguments are `Now`, the evaluator runs the body and produces exact results.

When arguments are `Later`, the evaluator analyzes the body with the argument constraints to determine the result constraint.

This is exactly what we need. The `fnType` is just memoization of a less-precise version.

---

## Part 2: The Proposed Model

### Functions Use Implicit `args` Array

A function value is simply:
```typescript
interface ClosureValue {
  tag: "closure";
  body: Expr;
  env: Env;
  name?: string;  // For recursion
}
```

No parameter list, no type attached. Every function body has an implicit `args` binding that contains all arguments as an array.

### Named Parameters Are Syntax Sugar

```
fn(x, y) => x + y
```

Desugars to:
```
fn => let [x, y] = args in x + y
```

This unifies the internal representation while keeping ergonomic syntax.

**Variadic functions** become natural:
```
fn(first, ...rest) => first + sum(rest)
```

Desugars to:
```
fn => let [first, ...rest] = args in first + sum(rest)
```

### Calling a Function

```typescript
function evalCall(fnExpr, argExprs, ctx) {
  const fn = eval(fnExpr);
  const argValues = argExprs.map(e => eval(e));

  if (fn.stage === "later") {
    // Can't analyze a body we don't have
    return { stage: "later", constraint: any, residual: callExpr(...) };
  }

  // fn is Now - we have the closure
  const closure = fn.value;

  // Bind args to array of argument staged values
  const argsConstraint = arrayConstraintFrom(argValues);
  const bodyEnv = bindVar("args", argsConstraint, closure.env);

  // Analyze/evaluate body - this IS the type derivation
  return evalExpr(closure.body, bodyEnv, ctx);
}
```

### What This Enables

**Per-call-site precision:**
```
let f = fn(x) => x + 1

f(5)        // Result: equals(6)
f(10)       // Result: equals(11)
f(runtime)  // Result: isNumber (only this case loses precision)
```

**Natural dependent types:**
```
let replicate = fn(n, x) => /* array of n copies of x */

replicate(3, "a")  // Result: and(isArray, length(equals(3)), elements(equals("a")))
```

The result constraint naturally depends on input values.

---

## Part 3: Trust, Assert, and Type Checking

### Clarifying `trust` vs `assert`

Both refine constraints, but differ in when checks occur:

| Operation | Compile-time | Runtime |
|-----------|-------------|---------|
| `assert(e, T)` | Emits check code | Verifies value satisfies T |
| `trust(e, T)` | Checks via `implies` | No check emitted |

**`trust` does compile-time verification but no runtime checking.**

Example:
```
let x = 5
trust(x, Number)  // OK: equals(5) implies isNumber ✓

let y = "hello"
trust(y, Number)  // Compile error: isString doesn't imply isNumber ✗
```

`trust` means "I know this is true, and the compiler should catch obvious contradictions, but don't emit runtime verification code."

This is similar to TypeScript's `as` - you're asserting knowledge, but provably wrong assertions still fail.

### When to Use Each

- **`assert`**: Validating external/untrusted data, runtime type guards
- **`trust`**: Internal invariants the compiler can't infer, type parameter constraints

---

## Part 4: Type Parameters and Generics

### Type Parameters Are Optional Arguments

Instead of implicit inference (Idris-style), type parameters are simply optional arguments with computed defaults:

```
let identity = fn(x, T?) =>
  let T = T ?? typeOf(x) in
  trust(x, T)
  x

identity(5)           // T computed as typeOf(5)
identity(5, Number)   // T explicitly Number
```

With syntax sugar:
```
fn(x, T: Type = typeOf(x)) => trust(x, T); x
```

No magic inference - just optional parameters with default expressions.

### Making Same-Type-ness Explicit

To enforce that two values have the same type:

```
let pair = fn(x, y) =>
  let _ = assert(y, typeOf(x)) in  // y must satisfy x's type
  [x, y]

pair(1, 2)      // OK: both numbers
pair(1, "hi")   // Error: "hi" doesn't satisfy typeOf(1)
```

Or with an explicit type parameter:
```
let pair = fn(T, x, y) =>
  let _ = trust(x, T) in
  let _ = trust(y, T) in
  [x, y]

pair(Number, 1, 2)      // OK
pair(Number, 1, "hi")   // Compile error
```

### Many "Generic" Functions Don't Need Type Parameters

```
// TypeScript needs <T, U>:
function map<T, U>(arr: T[], f: (x: T) => U): U[] {
  return arr.map(f);
}

// New model - just use the values:
let map = fn(arr, f) => arr.map(f)
```

Call:
```
map([1, 2, 3], fn(x) => x.toString())
```

1. `arr` has constraint `and(isArray, elements(isNumber))`
2. `f` is a closure
3. Body `arr.map(f)`:
   - For each element, call `f` with element constraint
   - Collect result constraints
4. Result: `and(isArray, elements(isString))`

The types are derived from the actual values - no `<T, U>` needed.

### When You DO Need Type Parameters

**1. The type isn't inferrable from values:**
```
let empty = fn(T) => trust([], and(isArray, elements(T)))
empty(Number)  // Need to specify element type
```

Note: An empty array `[]` has constraint `and(isArray, length(0))`. Elements are vacuously `any` - they get constrained by later usage (bidirectional typing).

**2. Constraining relationships:**
```
let pair = fn(T, x, y) =>
  let _ = trust(x, T) in
  let _ = trust(y, T) in
  [x, y]
```

**3. Bounded type parameters:**
```
let double = fn(T, x) =>
  let T = trust(T, isType(Addable)) in
  let x = trust(x, T) in
  x + x
```

---

## Part 5: Handling Recursion

### The Problem

```
fn fac(n) => if n == 0 then 1 else n * fac(n - 1)
```

With Later `n`:
1. Analyze body with n: `isNumber`
2. Hit `fac(n - 1)` - recursive call
3. Analyze body with n-1: `isNumber`
4. Infinite loop!

### The Solution: Widening

When we detect a cycle during analysis, we widen to a conservative constraint:

```typescript
const cycleKey = `${closureId}:${argConstraintsHash}`;

if (inProgressCalls.has(cycleKey)) {
  // Cycle detected - return widened constraint
  return {
    stage: "later",
    constraint: any,  // Or a configurable widening
    residual: callExpr(...)
  };
}

inProgressCalls.set(cycleKey, true);
try {
  // ... analyze body ...
} finally {
  inProgressCalls.delete(cycleKey);
}
```

The current system already has `inProgressRecursiveCalls` for this - it just needs to return `any` (or the bound from context) instead of the memoized `fnType`.

### Widening Strategies

1. **Return `any`** - Most conservative, always safe
2. **Return the parameter bound** - If `fac` has a declared return type annotation, use that
3. **Fixed-point iteration** - Analyze multiple times, widening until stable (more complex)

For the first implementation, returning `any` for recursive calls is sufficient and sound.

---

## Part 6: Later Functions

### The Edge Case

```
let f = runtime(someFunc)
f(5)
```

Here `f` is Later - we don't have its body to analyze.

### Options

**Option A: Require functions to be Now**
- Most cases work this way already
- Error if you try to call a Later function
- Simple but restrictive

**Option B: Result is `any`**
- Calling a Later function produces `any` constraint
- Sound but imprecise
- Allows more programs

**Option C: Minimal function annotation**
- Later functions can optionally carry a result constraint hint
- Best of both worlds but more complex

### Recommendation

Start with **Option B**. If a function is Later, we can't know its result statically. Returning `any` is honest about this limitation.

Users who need precision can ensure their functions are `comptime` or `Now`.

---

## Part 7: JavaScript Codegen Optimization

### The Problem

Internally all functions are `fn => body` with implicit `args`, but we want to generate idiomatic JavaScript:

```javascript
// Want this:
function(x, y) { return x + y; }

// Not this:
function(...args) { let [x, y] = args; return x + y; }
```

### Pattern Detection

Codegen recognizes common patterns and optimizes:

**Pattern 1: Fixed positional destructure**
```
fn => let [x, y] = args in x + y
```
Generates:
```javascript
function(x, y) { return x + y; }
```

**Pattern 2: Rest parameters**
```
fn => let [first, ...rest] = args in first + sum(rest)
```
Generates:
```javascript
function(first, ...rest) { return first + sum(rest); }
```

**Pattern 3: Dynamic access (no optimization possible)**
```
fn => args[n]  // n is Later
```
Generates:
```javascript
function(...args) { return args[n]; }
```

### Implementation

```typescript
function generateClosure(body: Expr): string {
  const extracted = extractParamPattern(body);

  if (extracted?.kind === 'fixed') {
    const params = extracted.params.join(', ');
    return `function(${params}) { return ${generate(extracted.body)}; }`;
  }

  if (extracted?.kind === 'rest') {
    const fixed = extracted.params.slice(0, -1).join(', ');
    const rest = extracted.params.at(-1);
    const sep = fixed ? ', ' : '';
    return `function(${fixed}${sep}...${rest}) { return ${generate(extracted.body)}; }`;
  }

  // Fallback: keep args array
  return `function(...args) { return ${generate(body)}; }`;
}

function extractParamPattern(body: Expr): ParamPattern | null {
  // Match: let [a, b, ...] = args in actualBody
  if (body.tag !== 'let') return null;
  if (body.value.tag !== 'varRef' || body.value.name !== 'args') return null;
  if (usesArgsElsewhere(body.body)) return null;

  const pattern = body.pattern;
  if (pattern.tag !== 'arrayDestructure') return null;

  const hasRest = pattern.elements.some(e => e.rest);
  return {
    kind: hasRest ? 'rest' : 'fixed',
    params: pattern.elements.map(e => e.name),
    body: body.body
  };
}
```

### What Blocks Optimization

- `args.length` used in body
- `args[i]` where `i` is not a literal
- `args` passed to another function
- Complex destructure patterns
- Conditional access to args

Most normal functions optimize to standard JS; dynamic patterns fall back to `...args`.

---

## Part 8: Constraint System Changes

### Remove These Constraints

```typescript
// DELETE:
fnType(params: Constraint[], result: Constraint)
genericFnType(typeParams: TypeParam[], params: Constraint[], result: Constraint)
typeParam(name: string, bound: Constraint, id: number)
```

### Keep/Modify These

```typescript
// KEEP:
isFunction  // Simple classification - "this is callable"

// KEEP:
isType(bound: Constraint)  // For type-valued parameters

// ADD:
typeOf(expr)  // Returns the constraint of expr as a Type value
// Used for: assert(y, typeOf(x)) to enforce same-type-ness
```

### Implication Changes

`implies()` currently has special cases for function subtyping:
- Contravariance in parameters
- Covariance in results
- Generic instantiation checks

These become **unnecessary**. Function "subtyping" becomes:
- "Can I call function A where function B is expected?"
- Analyze A's body with B's expected parameter constraints
- Check result implies expected result

This is more like behavioral subtyping than structural.

---

## Part 9: Implementation Steps

### Phase 1: Unified Function Representation

1. **Add implicit `args` binding**
   - Modify closure creation to not store params
   - Bind `args` in function body environment
   - Parser desugars `fn(x, y) => E` to `fn => let [x, y] = args in E`

2. **Update `evalCall` to use `args`**
   - Create array constraint from arguments
   - Bind `args` instead of individual params
   - Analyze body with this binding

3. **Test basic function calls**
   - Simple functions work as before
   - Variadic functions work naturally

### Phase 2: Remove fnType

1. **Remove `fnType` from constraint.ts**
   - Delete the type and related functions
   - Update `simplify`, `implies`, `unify` to remove function cases

2. **Delete inference.ts (mostly)**
   - Move any needed utilities to staged-evaluate.ts
   - Remove `inferFunction` and `analyzeExpr`

3. **Delete generic-inference.ts entirely**
   - No more generic instantiation - it's just function calls

4. **Update tests**
   - Remove tests that check for `fnType` constraints
   - Add tests for body-derived constraints

### Phase 3: Add `typeOf` and Related

1. **Implement `typeOf(expr)`**
   - Returns the constraint of expr wrapped as a TypeValue
   - Used for explicit same-type enforcement

2. **Update trust/assert semantics**
   - `trust` does compile-time `implies` check
   - `assert` emits runtime check code

3. **Add optional parameter syntax**
   - `fn(x, T = typeOf(x))` for optional type params
   - Desugar to body-computed defaults

### Phase 4: Codegen Optimization

1. **Implement pattern extraction**
   - Detect `let [...] = args in body` patterns
   - Classify as fixed, rest, or dynamic

2. **Generate optimized JS**
   - Fixed params: `function(a, b, c)`
   - Rest params: `function(a, ...rest)`
   - Dynamic: `function(...args)`

3. **Test generated code**
   - Ensure correct behavior
   - Check performance matches hand-written

### Phase 5: Clean Up

1. **Remove dead code**
   - Any remaining fnType references
   - Generic instantiation logic
   - Unused inference utilities

2. **Update documentation**
   - Explain the new model
   - Document trust/assert/typeOf
   - Update examples

---

## Part 10: Migration Examples

### Before: Current Code

```typescript
// inference.ts
function inferFunction(params, body, env) {
  const paramVars = params.map(() => freshConstraintVar());
  const result = analyzeExpr(body, bindParams(params, paramVars, env));
  return fnType(
    paramVars.map(v => applySubstitution(v, result.substitution)),
    applySubstitution(result.constraint, result.substitution)
  );
}

// staged-evaluate.ts
function evalFn(params, body, env) {
  const fnConstraint = inferFunction(params, body, env);
  return now(closureValue(params, body, env), fnConstraint);
}

function evalCall(fn, args) {
  // Check args satisfy fn.constraint.params
  // Return fn.constraint.result
}
```

### After: New Code

```typescript
// staged-evaluate.ts (inference.ts deleted)
function evalFn(body, env) {
  // Just create the closure - no type inference, no params
  return now(closureValue(body, env), isFunction);
}

function evalCall(fnExpr, argExprs, ctx) {
  const fn = eval(fnExpr);
  const argValues = argExprs.map(e => eval(e));

  if (fn.stage === "later") {
    return later(any, residualCall(fn.residual, argValues));
  }

  const closure = fn.value;

  // Create args array binding
  const argsValue = createArrayValue(argValues);
  const bodyEnv = bind("args", argsValue, closure.env);

  // Cycle detection for recursion
  const cycleKey = getCycleKey(closure, argValues);
  if (inProgress.has(cycleKey)) {
    return later(any, residualCall(...));
  }

  inProgress.add(cycleKey);
  try {
    return evalExpr(closure.body, bodyEnv, ctx);
  } finally {
    inProgress.delete(cycleKey);
  }
}
```

---

## Part 11: What We Gain

### Simplicity
- One mechanism (staged eval) instead of two (inference + eval)
- ~200-400 lines of code removed
- Fewer concepts to understand
- Uniform function representation (just body + env)

### Precision
- Result constraints are call-site specific
- `f(5)` gives `equals(6)`, not just `isNumber`
- Natural dependent types without special handling

### Uniformity
- Types are always derived from behavior
- No declared vs. inferred type distinction
- Generic functions are just functions with optional type arguments
- Variadic functions work naturally

### Alignment
- Fits "constraints as types" philosophy
- Types are observations, not declarations
- Staging determines what's known, not what's declared

---

## Part 12: What We Lose

### Early Error Detection
- Errors found at call sites, not definitions
- A function with a bug might not error until called with specific args
- Mitigation: Users can call with `any` to check general behavior

### Display/Documentation
- Can't easily show "this function has type X"
- Need to describe behavior rather than type
- User said they don't care about this

### Memoization
- Re-analyze body on each call (with different args)
- May be slower for heavily-called functions
- Mitigation: Cache results keyed by argument constraint patterns

### Separate Compilation
- Need function body to type-check calls
- Can't type-check against an interface alone
- May need minimal annotations for module boundaries

---

## Part 13: Open Questions

### Q1: Should we keep any function type annotation?

For module boundaries and documentation, we might want:
```
let f: fn(Number) -> Number = fn(x) => x + 1
```

This could be a `trust` at the definition site rather than stored in the constraint.

### Q2: How to handle function equality/subtyping?

If someone asks "is f assignable to g?", we need to compare behaviors:
- Analyze f with g's expected inputs
- Check f's output implies g's expected output

This is semantic/behavioral, not structural.

### Q3: What about currying?

```
let add = fn(x) => fn(y) => x + y
add(5)  // Returns a function - what's its "type"?
```

The returned closure captures x=5. When called, we analyze its body with that binding. Works naturally.

### Q4: Performance concerns?

Re-analyzing on each call could be slow. Options:
- Cache results by (closureId, argConstraintHash)
- Only re-analyze if arg constraints differ from cached
- Profile and optimize hot paths

### Q5: How does `typeOf` work at runtime?

`typeOf(x)` needs to return the constraint of x as a TypeValue. Options:
- Compile-time only: `typeOf` is evaluated during staging, result is a literal Type
- Runtime reflection: Values carry their constraints at runtime
- Hybrid: Use compile-time when possible, runtime otherwise

For now, compile-time only is simplest - `typeOf(x)` where x is Later returns `any`.

---

## Summary

This refactoring removes the `fnType`/`genericFnType` abstraction in favor of deriving function behavior from body analysis at call sites.

**Core changes:**
1. Functions are just closures with body + env (no param list, no type)
2. All function bodies have implicit `args` binding
3. Named parameters are syntax sugar for destructuring `args`
4. Calling a function analyzes its body with `args` bound to argument constraints
5. Type parameters are optional arguments with computed defaults
6. Same-type constraints use explicit `typeOf()` and `trust`/`assert`
7. Codegen optimizes to normal JS parameters when possible

**Benefits:**
- Simpler architecture (one mechanism, not two)
- More precise results (call-site specific)
- Natural dependent types
- Natural variadic functions
- Uniform "constraints as types" philosophy
- Idiomatic JS output

**Costs:**
- Errors at call sites, not definitions
- No easy function type display
- Potential performance overhead (cacheable)

The system becomes more like an abstract interpreter than a traditional type checker - which aligns with its partial evaluation / staging design.
