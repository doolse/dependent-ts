# Dead-on-Arrival Consistency Checking

This document captures design thoughts for adding internal consistency checking to functions at definition time. This is a future enhancement to catch functions that can never be called successfully.

## Motivation

The current system uses **body-based type derivation** - function types are derived by analyzing the body at each call site with concrete argument constraints. This means errors only surface when you actually call a function with incompatible arguments.

The proposed enhancement adds a **consistency check at definition time** to detect functions that are "dead on arrival" - they have internal contradictions that make them impossible to call with ANY inputs.

### Two-Level Checking Model

| Check | When | Question |
|-------|------|----------|
| **Consistency** | Definition time | "Can this function EVER succeed?" |
| **Call-site** | Call time | "Does it succeed with THESE inputs?" |

A consistent function might still fail at specific call sites (e.g., calling `fn(x) => x + 1` with a string). But an inconsistent function will ALWAYS fail regardless of inputs - it represents dead code or a logic error.

## What Consistency Checking Would Catch

### Contradictory Operations on Parameters

```
fn(x) => x + 1 + x.length
```

- `x + 1` imposes constraint `isNumber` on `x`
- `x.length` imposes constraint `isString | isArray` on `x`
- Combined: `and(isNumber, or(isString, isArray))` → `never`
- **Verdict: Inconsistent** - no value for `x` can satisfy both operations

### Branch-Induced Contradictions

```
fn(x) => if x > 0 then x else x.length
```

- `x > 0` requires `isNumber` for the comparison
- `x.length` in else branch requires `isString | isArray`
- Since `x` must work in both the condition AND whichever branch executes, and the condition uses `x` as a number, the else branch's `x.length` creates a contradiction
- **Verdict: Inconsistent**

### Unreachable Code Due to Types

```
fn(x) => {
  assert(x, number);
  if isString(x) then x.length else 0
}
```

- After `assert(x, number)`, `x` has constraint `isNumber`
- The condition `isString(x)` can never be true
- The then-branch is unreachable
- **Verdict: Potentially warn** (not strictly inconsistent, but suspicious)

### Higher-Order Function Constraints

```
fn(f, x) => f(x) + f(x).length
```

- `f(x) + ...` requires `f(x)` returns `isNumber`
- `f(x).length` requires `f(x)` returns `isString | isArray`
- These contradict
- **Verdict: Inconsistent**

## What Remains Deferred to Call Site

### Parameter Type Mismatches

```
fn(x) => x + 1
```

- Consistent: `x: isNumber` makes this work
- But calling with a string still fails at call site
- This is correct - the function IS consistent, just not universally applicable

### Refinement Violations

```
fn(x) => {
  assert(x, and(isNumber, gt(0)));
  sqrt(x)
}
```

- Consistent: `x: and(isNumber, gt(0))` works
- Calling with `-5` fails at call site (assertion fails)
- Correct - there exist valid inputs

## Implementation Approach

### Core Idea: Constraint Collection Mode

Instead of the current fail-fast behavior in `requireConstraint`, add an alternative mode that **collects** constraints on parameters rather than immediately checking them.

```typescript
interface ConsistencyChecker {
  // Map from parameter name to collected constraints
  parameterConstraints: Map<string, Constraint[]>;

  // Record that parameter `name` must satisfy `constraint`
  require(name: string, constraint: Constraint): void;

  // Check if all collected constraints are satisfiable
  checkSatisfiability(): ConsistencyResult;
}

interface ConsistencyResult {
  consistent: boolean;
  // If inconsistent, which parameter and why
  violations?: Array<{
    parameter: string;
    collectedConstraints: Constraint[];
    simplified: Constraint; // Will be `never`
  }>;
}
```

### Algorithm Sketch

```typescript
function checkFunctionConsistency(
  params: string[],
  body: Expr
): ConsistencyResult {
  // 1. Create fresh constraint variables for each parameter
  const paramVars = new Map<string, Constraint>();
  for (const param of params) {
    paramVars.set(param, freshCVar());
  }

  // 2. Create environment with parameters bound to their variables
  const env = createEnvWithConstraintVars(paramVars);

  // 3. Analyze body in "collection mode"
  //    - Don't fail on requireConstraint
  //    - Instead, record what constraints are imposed
  const collector = new ConstraintCollector();
  analyzeForConsistency(body, env, collector);

  // 4. For each parameter, unify all collected constraints
  for (const [param, constraints] of collector.parameterConstraints) {
    const unified = simplify(and(...constraints));
    if (isNever(unified)) {
      return {
        consistent: false,
        violations: [{ parameter: param, collectedConstraints: constraints, simplified: unified }]
      };
    }
  }

  return { consistent: true };
}
```

### Handling Different Expression Types

#### Binary Operations

```typescript
// For: left + right
// Collect: left must satisfy isNumber, right must satisfy isNumber
// (or string concat variant)
```

#### Field Access

```typescript
// For: obj.field
// Collect: obj must satisfy hasField("field", any)
```

#### Function Calls

```typescript
// For: f(arg)
// This is tricky - what constraint does f need?
// Need to track: "f must be callable with arg's constraint"
// This requires representing function constraints
```

#### Conditionals

```typescript
// For: if cond then a else b
// Collect constraints from cond (must be bool)
// Collect constraints from both branches
// Apply refinements appropriately
```

### The Higher-Order Function Challenge

The tricky part is handling function parameters. When we see:

```
fn(f) => f(5) + f("hello")
```

We need to track:
- `f` must accept `number` (from `f(5)`)
- `f` must accept `string` (from `f("hello")`)
- `f`'s return type must be `number` (from `+`)

This requires either:

1. **Arrow-type-like constraints**: Extend the constraint language with function type constraints
   ```typescript
   | { tag: "callable", param: Constraint, result: Constraint }
   ```

2. **Deferred analysis**: When `f` is called, record the call constraints and check them against each other
   ```typescript
   // f called with number, result used as number
   // f called with string, result used as number
   // Check: can same f satisfy both?
   // Yes if f: (number | string) -> number
   ```

3. **Existential approach**: "There exists some function type for f that satisfies all uses"

Option 2 is probably most aligned with the current architecture.

### Integration Points

1. **Where to run the check**: After parsing a function definition, before adding to environment

2. **Error reporting**:
   ```
   Inconsistent function definition:
     Parameter 'x' cannot satisfy all uses:
       - Line 3: x + 1 requires number
       - Line 4: x.length requires string | array
     These constraints are contradictory.
   ```

3. **Optional vs required**: Could be a lint-level warning initially, promoted to error once stable

## Edge Cases and Considerations

### Recursive Functions

```
fn fac(n) => if n == 0 then 1 else n * fac(n - 1)
```

- Need to handle the recursive call without infinite loops
- Similar to current coinductive approach for recursive types
- Assume consistency for recursive calls, verify the base case

### Closures and Captured Variables

```
let x = 5 in
fn(y) => x + y
```

- `x` is captured, not a parameter
- Its constraint is known (from outer scope)
- Only `y` needs consistency checking

### Generic/Polymorphic Intent

```
fn(x) => x
```

- This should be consistent (identity works for any type)
- The parameter `x` has no constraints imposed
- Constraint collection yields `any` which is satisfiable

### Conditional Constraint Application

```
fn(x) => if isNumber(x) then x + 1 else x.length
```

- In then-branch: `x` refined to `isNumber`, `x + 1` is fine
- In else-branch: `x` refined to `not(isNumber)`, `x.length` might be fine
- This IS consistent - the refinements partition the uses
- Need to track refinement contexts during collection

## Relationship to Other Features

### Comptime and Consistency

```
fn(T) => fn(x) => {
  comptime(assert(x, T));
  x
}
```

- The inner function's consistency depends on `T`
- Since `T` is a comptime parameter, we know it at specialization time
- Consistency of specialized versions can be checked separately

### Trust and Consistency

```
fn(x) => {
  let y = trust(x, number);
  y + 1
}
```

- `trust` introduces a constraint without checking
- For consistency purposes, `y` has `isNumber` after trust
- The function is consistent (assuming trust is honored)
- Runtime failure is possible if trust is violated, but that's expected

## Open Questions

1. **How to handle `any`?** If a parameter is used in a way that only constrains it to `any`, is that consistent? (Probably yes)

2. **Gradual consistency?** Should we allow "partially checked" functions where some paths are verified and others deferred?

3. **Performance**: Full body analysis on every function definition could be expensive. Caching? Lazy checking?

4. **Error messages**: How to explain WHY constraints conflict in terms the user understands?

5. **Interaction with staged evaluation**: Should consistency checking happen before or after staging? Probably before (on the raw AST).

## Summary

Consistency checking adds a safety net at function definition time without requiring declared signatures. It catches "impossible functions" while preserving the flexibility of body-based type derivation for functions that ARE consistent but require specific input types.

The implementation requires:
- Constraint collection mode in the evaluator
- Satisfiability checking (existing `simplify` detects `never`)
- Higher-order function constraint tracking (the main new complexity)
- Integration with refinement contexts for conditionals

This is a natural evolution of the current system that fills the gap between "no checking at definition" and "full declared signatures required."