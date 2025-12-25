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

### Functions Are Just Closures

A function value is:
```typescript
interface ClosureValue {
  tag: "closure";
  params: string[];
  body: Expr;
  env: Env;
  name?: string;  // For recursion
}
```

No type attached. The "type" emerges from calling it.

### Calling a Function

```typescript
function evalCall(fnExpr, argExprs, ctx) {
  const fn = eval(fnExpr);
  const args = argExprs.map(e => eval(e));

  if (fn.stage === "later") {
    // Can't analyze a body we don't have
    return { stage: "later", constraint: any, residual: callExpr(...) };
  }

  // fn is Now - we have the closure
  const closure = fn.value;

  // Bind params to argument constraints
  const bodyEnv = bindParams(closure.params, args, closure.env);

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

## Part 3: TypeScript-Style Generics Under This Model

### Type Parameters Become Regular Parameters

Instead of special `<T>` syntax, type parameters are just parameters with constraint `isType(...)`:

**TypeScript:**
```typescript
function identity<T>(x: T): T {
  return x;
}
```

**New model:**
```
let identity = fn(T, x) => x
```

Where `T` is expected to be a `TypeValue`.

### The `: T` Annotation

To express "x must satisfy type T", we use `trust`:

```
let identity = fn(T, x) => trust(x, T)
```

Or with syntax sugar:
```
fn(T: Type, x: T) => x
```

Which desugars to:
```
fn(T, x) =>
  let T = trust(T, isType(any)) in
  let x = trust(x, T) in
  x
```

### How Calls Work

```
identity(Number, 5)
```

1. Bind `T` → `TypeValue(isNumber)`, Now
2. Bind `x` → `5`, constraint `and(isNumber, equals(5))`
3. Body: `trust(x, T)`
   - T is Now, extract inner constraint: `isNumber`
   - Check: `and(isNumber, equals(5))` implies `isNumber`? ✓
   - Result: `x` with constraint `and(isNumber, equals(5))`
4. Return constraint: `and(isNumber, equals(5))`

### Type Mismatch Detection

```
identity(Number, "hello")
```

1. Bind `T` → `TypeValue(isNumber)`
2. Bind `x` → `"hello"`, constraint `and(isString, equals("hello"))`
3. Body: `trust(x, T)`
   - Check: `isString` implies `isNumber`? ✗
   - **Error!**

The trust check catches the mismatch - no declared parameter types needed.

### When Type Parameters Are Optional

Many "generic" functions don't need explicit type parameters at all:

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

Type parameters are still useful when:

**1. The type isn't inferrable from values:**
```
let empty = fn(T) => []  // Returns T[], but no T values to analyze
empty(Number)  // Need to specify
```

**2. Constraining relationships:**
```
let pair = fn(T: Type, x: T, y: T) => [x, y]
pair(Number, 5, 6)      // OK
pair(Number, 5, "hi")   // Error: "hi" doesn't satisfy Number
```

**3. Bounded type parameters:**
```
let double = fn(T: Addable, x: T) => x + x
```

Where `Addable` is a type that constrains what T can be.

---

## Part 4: Handling Recursion

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

## Part 5: Later Functions

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

## Part 6: Constraint System Changes

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

// MAYBE ADD:
satisfiesParam(paramRef: string | number)  // Reference another param's type
// (Only needed if we want declared dependencies, may not be necessary)
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

## Part 7: Implementation Steps

### Phase 1: Parallel Implementation

Keep existing `fnType` working while adding body-based derivation:

1. **Modify `evalCall` to derive results from body**
   - When closure is Now, analyze body with argument constraints
   - Compare results with `fnType`-based approach (for validation)
   - Flag any discrepancies

2. **Add cycle detection for recursive calls**
   - Extend `inProgressRecursiveCalls` to return `any` instead of cached type
   - Test with recursive functions

3. **Handle Later functions**
   - Return `any` constraint when calling Later functions
   - Add tests for this case

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

### Phase 3: Add Type Parameter Syntax

1. **Parser changes**
   - Add `: T` syntax for parameter annotations
   - Desugar to `trust` calls in the body

2. **Add `T: Type` shorthand**
   - `fn(T: Type, x: T)` means T has constraint `isType(any)`

3. **Test TypeScript-style patterns**
   - Identity, map, filter, reduce
   - Bounded type parameters
   - Multiple type parameters

### Phase 4: Clean Up

1. **Remove dead code**
   - Any remaining fnType references
   - Generic instantiation logic
   - Unused inference utilities

2. **Update documentation**
   - Explain the new model
   - Document trust/assert for type parameters
   - Update examples

---

## Part 8: Migration Examples

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
function evalFn(params, body, env) {
  // Just create the closure - no type inference
  return now(closureValue(params, body, env), isFunction);
}

function evalCall(fnExpr, argExprs, ctx) {
  const fn = eval(fnExpr);
  const args = argExprs.map(e => eval(e));

  if (fn.stage === "later") {
    return later(any, residualCall(fn.residual, args));
  }

  const closure = fn.value;
  const bodyEnv = bindParams(closure.params, args, closure.env);

  // Cycle detection for recursion
  const cycleKey = getCycleKey(closure, args);
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

## Part 9: What We Gain

### Simplicity
- One mechanism (staged eval) instead of two (inference + eval)
- ~200-400 lines of code removed
- Fewer concepts to understand

### Precision
- Result constraints are call-site specific
- `f(5)` gives `equals(6)`, not just `isNumber`
- Natural dependent types without special handling

### Uniformity
- Types are always derived from behavior
- No declared vs. inferred type distinction
- Generic functions are just functions taking type arguments

### Alignment
- Fits "constraints as types" philosophy
- Types are observations, not declarations
- Staging determines what's known, not what's declared

---

## Part 10: What We Lose

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

## Part 11: Open Questions

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

---

## Summary

This refactoring removes the `fnType`/`genericFnType` abstraction in favor of deriving function behavior from body analysis at call sites.

**Core changes:**
1. Functions are just closures (no type attached)
2. Calling a function analyzes its body with argument constraints
3. Type parameters become regular parameters with `isType` constraint
4. Parameter annotations (`: T`) desugar to `trust` calls

**Benefits:**
- Simpler architecture (one mechanism, not two)
- More precise results (call-site specific)
- Natural dependent types
- Uniform "constraints as types" philosophy

**Costs:**
- Errors at call sites, not definitions
- No easy function type display
- Potential performance overhead (cacheable)

The system becomes more like an abstract interpreter than a traditional type checker - which aligns with its partial evaluation / staging design.