# Implementation Guide

A high-level guide for implementing the constraint-based type system.

> **Prerequisites:** Read [goals.md](goals.md) for language goals and [constraints-as-types.md](constraints-as-types.md) for the type system design.

## Architecture Overview

```
Source Code
    │
    ▼
┌─────────┐
│  Parse  │  → AST (expressions, declarations)
└────┬────┘
     │
     ▼
┌─────────────────┐
│  Type Inference │  → Annotated AST with constraints
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│  Constraint Solving │  → Resolved constraints, errors
└────────┬────────────┘
         │
         ▼
┌─────────────┐
│  Code Gen   │  → JavaScript output
└─────────────┘
```

## Phase 1: Core Data Structures

### 1.1 Constraints

The fundamental representation. Start minimal and extend.

```typescript
// Core constraint types
type Constraint =
  // Classification (always decidable)
  | { tag: "isNumber" }
  | { tag: "isString" }
  | { tag: "isBool" }
  | { tag: "isNull" }
  | { tag: "isUndefined" }
  | { tag: "isObject" }
  | { tag: "isArray" }
  | { tag: "isType" }  // This value is a type

  // Literal equality
  | { tag: "equals", value: unknown }

  // Structure
  | { tag: "hasField", name: string, constraint: Constraint }
  | { tag: "elements", constraint: Constraint }      // Array element type
  | { tag: "length", constraint: Constraint }        // Array length
  | { tag: "elementAt", index: number, constraint: Constraint }  // Tuple position

  // Logical
  | { tag: "and", constraints: Constraint[] }
  | { tag: "or", constraints: Constraint[] }

  // Special
  | { tag: "never" }  // Bottom type (contradiction)
  | { tag: "variable", id: number }  // Inference variable

  // Recursive types (add in later phase)
  | { tag: "rec", var: string, body: Constraint }
  | { tag: "recVar", var: string }
```

### 1.2 Expressions (AST)

```typescript
type Expr =
  | { tag: "literal", value: unknown }           // 5, "hello", true
  | { tag: "variable", name: string }            // x
  | { tag: "lambda", params: string[], body: Expr }  // fn(x, y) => body
  | { tag: "apply", func: Expr, args: Expr[] }   // f(a, b)
  | { tag: "field", object: Expr, name: string } // obj.field
  | { tag: "index", array: Expr, index: Expr }   // arr[i]
  | { tag: "object", fields: { name: string, value: Expr }[] }  // { a: 1, b: 2 }
  | { tag: "array", elements: Expr[] }           // [1, 2, 3]
  | { tag: "if", cond: Expr, then: Expr, else: Expr }
  | { tag: "let", name: string, value: Expr, body: Expr }
  | { tag: "binary", op: BinaryOp, left: Expr, right: Expr }  // +, -, ==, etc.
  | { tag: "unary", op: UnaryOp, operand: Expr }  // !, -
  | { tag: "typeOf", expr: Expr }                // typeof x (comptime)
  | { tag: "assert", expr: Expr, constraint: Constraint }  // assert x > 0
  | { tag: "trust", expr: Expr }                 // trust x

type BinaryOp = "+" | "-" | "*" | "/" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "&&" | "||"
type UnaryOp = "!" | "-"
```

### 1.3 Inference State

```typescript
type InferenceState = {
  nextVarId: number,
  // Map from variable ID to its current constraints
  substitution: Map<number, Constraint>,
  // Errors accumulated during inference
  errors: TypeError[],
}

type TypeError = {
  message: string,
  location: SourceLocation,
  constraint?: Constraint,  // The failing constraint
}
```

## Phase 2: Core Algorithms

### 2.1 Fresh Variables

```typescript
function freshVar(state: InferenceState): Constraint {
  const id = state.nextVarId++
  return { tag: "variable", id }
}
```

### 2.2 Constraint Normalization

Simplify and detect contradictions. This is called frequently.

```typescript
function normalize(c: Constraint): Constraint {
  switch (c.tag) {
    case "and": {
      // Flatten nested ANDs
      const flat = c.constraints.flatMap(x =>
        x.tag === "and" ? x.constraints : [x]
      )

      // Remove duplicates
      const unique = deduplicate(flat)

      // Check for contradictions
      if (hasContradiction(unique)) {
        return { tag: "never" }
      }

      // Simplify: equals(5) AND isNumber → equals(5)
      const simplified = applySimplifications(unique)

      if (simplified.length === 0) return { tag: "and", constraints: [] }  // unknown
      if (simplified.length === 1) return simplified[0]
      return { tag: "and", constraints: simplified }
    }

    case "or": {
      // Flatten nested ORs
      const flat = c.constraints.flatMap(x =>
        x.tag === "or" ? x.constraints : [x]
      )

      // Remove never branches
      const nonNever = flat.filter(x => x.tag !== "never")

      if (nonNever.length === 0) return { tag: "never" }
      if (nonNever.length === 1) return nonNever[0]
      return { tag: "or", constraints: nonNever }
    }

    default:
      return c
  }
}
```

### 2.3 Contradiction Detection

```typescript
// Top-level disjoint classifications
const DISJOINT_PRIMITIVES = ["isNumber", "isString", "isBool", "isNull", "isUndefined"]

function hasContradiction(constraints: Constraint[]): boolean {
  const classifications = new Set<string>()
  const literals: unknown[] = []

  for (const c of constraints) {
    // Check primitive disjointness
    if (DISJOINT_PRIMITIVES.includes(c.tag)) {
      if (classifications.has("isObject")) return true
      for (const p of DISJOINT_PRIMITIVES) {
        if (p !== c.tag && classifications.has(p)) return true
      }
      classifications.add(c.tag)
    }

    if (c.tag === "isObject") {
      for (const p of DISJOINT_PRIMITIVES) {
        if (classifications.has(p)) return true
      }
      classifications.add("isObject")
    }

    // Check literal conflicts
    if (c.tag === "equals") {
      for (const lit of literals) {
        if (lit !== c.value) return true  // Different literals
      }
      literals.push(c.value)

      // Check literal vs classification
      if (typeof c.value === "number" && classifications.has("isString")) return true
      if (typeof c.value === "string" && classifications.has("isNumber")) return true
      // ... more checks
    }

    // Never is always a contradiction
    if (c.tag === "never") return true
  }

  return false
}
```

### 2.4 Subtyping (Implication)

`A <: B` means constraints(A) implies constraints(B).

```typescript
function isSubtype(a: Constraint, b: Constraint): boolean {
  // never <: anything
  if (a.tag === "never") return true

  // anything <: unknown (empty constraint)
  if (b.tag === "and" && b.constraints.length === 0) return true

  // Same constraint
  if (constraintEquals(a, b)) return true

  // Literal implies classification
  if (a.tag === "equals" && b.tag === "isNumber" && typeof a.value === "number") return true
  if (a.tag === "equals" && b.tag === "isString" && typeof a.value === "string") return true
  if (a.tag === "equals" && b.tag === "isBool" && typeof a.value === "boolean") return true

  // Array implies object
  if (a.tag === "isArray" && b.tag === "isObject") return true

  // AND: a AND b <: c if a <: c OR b <: c (any component implies target)
  // AND: a <: b AND c if a <: b AND a <: c (must imply all)
  if (a.tag === "and") {
    if (b.tag === "and") {
      // All components of b must be implied by some component of a
      return b.constraints.every(bc =>
        a.constraints.some(ac => isSubtype(ac, bc))
      )
    }
    // At least one component must imply b
    return a.constraints.some(ac => isSubtype(ac, b))
  }

  if (b.tag === "and") {
    // a must imply all components of b
    return b.constraints.every(bc => isSubtype(a, bc))
  }

  // OR: a <: b OR c if a <: b OR a <: c
  // OR: a OR b <: c if a <: c AND b <: c
  if (b.tag === "or") {
    return b.constraints.some(bc => isSubtype(a, bc))
  }

  if (a.tag === "or") {
    return a.constraints.every(ac => isSubtype(ac, b))
  }

  // hasField: contravariant in field constraint for writes, covariant for reads
  // For now, treat as covariant (reads only)
  if (a.tag === "hasField" && b.tag === "hasField") {
    return a.name === b.name && isSubtype(a.constraint, b.constraint)
  }

  // More fields implies fewer (structural subtyping)
  // { a, b } <: { a } because hasField(a) AND hasField(b) implies hasField(a)

  return false
}
```

### 2.5 Unification

Combine constraints, detecting contradictions.

```typescript
function unify(a: Constraint, b: Constraint, state: InferenceState): Constraint {
  // Variable cases
  if (a.tag === "variable") {
    return unifyVar(a.id, b, state)
  }
  if (b.tag === "variable") {
    return unifyVar(b.id, a, state)
  }

  // Combine as AND and normalize
  const combined = normalize({
    tag: "and",
    constraints: [a, b]
  })

  return combined
}

function unifyVar(varId: number, constraint: Constraint, state: InferenceState): Constraint {
  // Check for existing substitution
  const existing = state.substitution.get(varId)

  if (existing) {
    // Unify new constraint with existing
    const unified = unify(existing, constraint, state)
    state.substitution.set(varId, unified)
    return unified
  }

  // Occurs check (prevent infinite types)
  if (occursIn(varId, constraint)) {
    // This creates a recursive type - handle with rec binder later
    state.errors.push({ message: "Infinite type detected", location: null })
    return { tag: "never" }
  }

  // Record the constraint
  state.substitution.set(varId, constraint)
  return constraint
}

function occursIn(varId: number, c: Constraint): boolean {
  switch (c.tag) {
    case "variable": return c.id === varId
    case "and":
    case "or":
      return c.constraints.some(x => occursIn(varId, x))
    case "hasField": return occursIn(varId, c.constraint)
    case "elements": return occursIn(varId, c.constraint)
    case "length": return occursIn(varId, c.constraint)
    case "elementAt": return occursIn(varId, c.constraint)
    default: return false
  }
}
```

## Phase 3: Type Inference

### 3.1 Environment

```typescript
type Env = Map<string, Constraint>

function extendEnv(env: Env, name: string, constraint: Constraint): Env {
  const newEnv = new Map(env)
  newEnv.set(name, constraint)
  return newEnv
}
```

### 3.2 Inference

```typescript
function infer(expr: Expr, env: Env, state: InferenceState): Constraint {
  switch (expr.tag) {
    case "literal": {
      const v = expr.value
      if (typeof v === "number") {
        return { tag: "and", constraints: [
          { tag: "isNumber" },
          { tag: "equals", value: v }
        ]}
      }
      if (typeof v === "string") {
        return { tag: "and", constraints: [
          { tag: "isString" },
          { tag: "equals", value: v }
        ]}
      }
      if (typeof v === "boolean") {
        return { tag: "and", constraints: [
          { tag: "isBool" },
          { tag: "equals", value: v }
        ]}
      }
      if (v === null) return { tag: "isNull" }
      if (v === undefined) return { tag: "isUndefined" }
      throw new Error("Unknown literal type")
    }

    case "variable": {
      const c = env.get(expr.name)
      if (!c) {
        state.errors.push({ message: `Unknown variable: ${expr.name}`, location: null })
        return { tag: "never" }
      }
      return c
    }

    case "lambda": {
      // Create fresh variables for parameters
      const paramConstraints: Constraint[] = expr.params.map(() => freshVar(state))

      // Extend environment with parameter bindings
      let bodyEnv = env
      for (let i = 0; i < expr.params.length; i++) {
        bodyEnv = extendEnv(bodyEnv, expr.params[i], paramConstraints[i])
      }

      // Infer body - this will add constraints to the parameter variables
      const bodyConstraint = infer(expr.body, bodyEnv, state)

      // The function's constraint is structural:
      // "is a function from params to result"
      // For now, represent as a special constraint
      return {
        tag: "and",
        constraints: [
          { tag: "isFunction", params: paramConstraints, result: bodyConstraint }
        ]
      }
    }

    case "apply": {
      const funcConstraint = infer(expr.func, env, state)
      const argConstraints = expr.args.map(a => infer(a, env, state))

      // funcConstraint should be a function
      // Unify argument constraints with parameter constraints
      // Return the result constraint

      // This requires extracting function shape from funcConstraint
      // For now, simplified version:
      const resultVar = freshVar(state)

      // Add constraint: func must be applicable to args
      // This is where we'd check that funcConstraint is a function
      // and unify arg types with param types

      return resultVar
    }

    case "field": {
      const objConstraint = infer(expr.object, env, state)
      const fieldVar = freshVar(state)

      // Object must have this field
      const required = { tag: "hasField" as const, name: expr.name, constraint: fieldVar }
      unify(objConstraint, required, state)

      return fieldVar
    }

    case "binary": {
      const left = infer(expr.left, env, state)
      const right = infer(expr.right, env, state)

      switch (expr.op) {
        case "+":
        case "-":
        case "*":
        case "/":
          // Require numbers, produce number
          unify(left, { tag: "isNumber" }, state)
          unify(right, { tag: "isNumber" }, state)
          return { tag: "isNumber" }

        case "==":
        case "!=":
          // Any types, produce boolean
          return { tag: "isBool" }

        case "<":
        case ">":
        case "<=":
        case ">=":
          // Require comparable (numbers for now), produce boolean
          unify(left, { tag: "isNumber" }, state)
          unify(right, { tag: "isNumber" }, state)
          return { tag: "isBool" }

        case "&&":
        case "||":
          // Require booleans, produce boolean
          unify(left, { tag: "isBool" }, state)
          unify(right, { tag: "isBool" }, state)
          return { tag: "isBool" }
      }
    }

    case "if": {
      const condConstraint = infer(expr.cond, env, state)
      unify(condConstraint, { tag: "isBool" }, state)

      // TODO: Narrow environment in branches based on condition
      const thenConstraint = infer(expr.then, env, state)
      const elseConstraint = infer(expr.else, env, state)

      // Result is union of both branches
      return { tag: "or", constraints: [thenConstraint, elseConstraint] }
    }

    case "let": {
      const valueConstraint = infer(expr.value, env, state)
      const bodyEnv = extendEnv(env, expr.name, valueConstraint)
      return infer(expr.body, bodyEnv, state)
    }

    case "object": {
      const fieldConstraints = expr.fields.map(f => ({
        tag: "hasField" as const,
        name: f.name,
        constraint: infer(f.value, env, state)
      }))

      return {
        tag: "and",
        constraints: [
          { tag: "isObject" },
          ...fieldConstraints
        ]
      }
    }

    case "array": {
      if (expr.elements.length === 0) {
        // Empty array - unknown element type
        return {
          tag: "and",
          constraints: [
            { tag: "isArray" },
            { tag: "length", constraint: { tag: "equals", value: 0 } }
          ]
        }
      }

      // Infer each element, unify to get common type (or union)
      const elemConstraints = expr.elements.map(e => infer(e, env, state))

      // For homogeneous array: unify all elements
      // For tuple: keep position-specific constraints
      // Decision: infer as tuple (more precise)
      const positionConstraints = elemConstraints.map((c, i) => ({
        tag: "elementAt" as const,
        index: i,
        constraint: c
      }))

      return {
        tag: "and",
        constraints: [
          { tag: "isArray" },
          { tag: "length", constraint: { tag: "equals", value: expr.elements.length } },
          ...positionConstraints
        ]
      }
    }

    // ... other cases
  }
}
```

## Phase 4: Control Flow Narrowing

### 4.1 Narrowing in Branches

```typescript
function inferWithNarrowing(
  expr: Expr,
  env: Env,
  additionalConstraint: Constraint | null,
  state: InferenceState
): Constraint {
  if (additionalConstraint) {
    // Narrow relevant variables in env based on constraint
    env = narrowEnv(env, additionalConstraint, state)
  }
  return infer(expr, env, state)
}

function narrowEnv(env: Env, constraint: Constraint, state: InferenceState): Env {
  // For each variable mentioned in constraint, add the constraint
  // This is simplified - real version needs to extract variable references
  return env
}
```

### 4.2 Discriminated Union Narrowing

```typescript
function narrowUnion(union: Constraint, discriminant: Constraint): Constraint {
  if (union.tag !== "or") {
    return unify(union, discriminant, /* state */)
  }

  // Try adding discriminant to each branch, keep non-contradictory ones
  const surviving = union.constraints
    .map(branch => normalize({ tag: "and", constraints: [branch, discriminant] }))
    .filter(branch => branch.tag !== "never")

  if (surviving.length === 0) return { tag: "never" }
  if (surviving.length === 1) return surviving[0]
  return { tag: "or", constraints: surviving }
}
```

## Phase 5: Generalization (Polymorphism)

### 5.1 Let-Polymorphism

```typescript
function generalize(constraint: Constraint, env: Env, state: InferenceState): ConstraintScheme {
  // Find free variables in constraint that are NOT free in env
  const envFreeVars = freeVarsInEnv(env)
  const constraintFreeVars = freeVars(constraint)

  const quantified = constraintFreeVars.filter(v => !envFreeVars.has(v))

  return {
    quantifiedVars: quantified,
    constraint: constraint
  }
}

function instantiate(scheme: ConstraintScheme, state: InferenceState): Constraint {
  // Replace each quantified variable with a fresh variable
  const substitution = new Map<number, Constraint>()
  for (const v of scheme.quantifiedVars) {
    substitution.set(v, freshVar(state))
  }
  return applySubstitution(scheme.constraint, substitution)
}
```

## Phase 6: Refinement Constraints

### 6.1 Adding Comparison Constraints

```typescript
type Constraint =
  // ... existing ...
  | { tag: "lessThan", bound: ConstraintExpr }
  | { tag: "greaterThan", bound: ConstraintExpr }
  | { tag: "lessOrEqual", bound: ConstraintExpr }
  | { tag: "greaterOrEqual", bound: ConstraintExpr }

type ConstraintExpr =
  | { tag: "literal", value: number }
  | { tag: "variable", id: number }
  | { tag: "add", left: ConstraintExpr, right: ConstraintExpr }
  | { tag: "sub", left: ConstraintExpr, right: ConstraintExpr }
  | { tag: "field", object: ConstraintExpr, name: string }
```

### 6.2 Compile-Time vs Runtime Verification

```typescript
type VerificationResult =
  | { proven: true }
  | { proven: false, needsRuntimeCheck: Constraint }
  | { contradiction: true }

function verifyRefinement(
  valueConstraint: Constraint,
  required: Constraint,
  state: InferenceState
): VerificationResult {
  // Try to prove at compile time
  if (isSubtype(valueConstraint, required)) {
    return { proven: true }
  }

  // Check for contradiction
  const combined = normalize({ tag: "and", constraints: [valueConstraint, required] })
  if (combined.tag === "never") {
    return { contradiction: true }
  }

  // Cannot prove - need runtime check
  return { proven: false, needsRuntimeCheck: required }
}
```

### 6.3 Assert and Trust

```typescript
case "assert": {
  const exprConstraint = infer(expr.expr, env, state)
  const required = expr.constraint

  const result = verifyRefinement(exprConstraint, required, state)

  if (result.contradiction) {
    state.errors.push({ message: "Assertion always fails", location: null })
    return { tag: "never" }
  }

  if (result.proven) {
    // No runtime check needed
    return normalize({ tag: "and", constraints: [exprConstraint, required] })
  }

  // Mark that runtime check is needed (for code gen)
  return {
    tag: "and",
    constraints: [exprConstraint, required],
    runtimeCheck: result.needsRuntimeCheck  // Metadata for codegen
  }
}

case "trust": {
  const exprConstraint = infer(expr.expr, env, state)
  // Trust adds no constraints at compile time
  // The programmer is responsible
  return exprConstraint
}
```

## Implementation Order

### Milestone 1: Basic Inference
1. Constraint data structure (classification + equals + and/or)
2. Normalization and contradiction detection
3. Subtyping for classification constraints
4. Inference for literals, variables, let bindings
5. Inference for binary operators (+, -, ==, etc.)
6. Basic error reporting

**Test:** Infer types for simple expressions like `let x = 5; x + 3`

### Milestone 2: Functions and Objects
1. Lambda inference with fresh variables
2. Application with argument unification
3. Object literals with hasField constraints
4. Field access
5. Occurs check (prevent infinite types)

**Test:** Infer types for `fn(x) => x.name` and `fn(x, y) => x + y`

### Milestone 3: Arrays and Tuples
1. Array literals with elementAt constraints
2. Index access (comptime vs runtime index)
3. Length constraints
4. Union types for heterogeneous access

**Test:** Infer types for `[1, "hello", true]` and access patterns

### Milestone 4: Control Flow
1. If-then-else with union results
2. Environment narrowing in branches
3. Discriminated union narrowing
4. Type guards

**Test:** Narrowing in `if isString(x) then x.length else x + 1`

### Milestone 5: Polymorphism
1. Generalization at let bindings
2. Instantiation at use sites
3. Constraint schemes

**Test:** `let id = fn(x) => x; id(5); id("hello")`

### Milestone 6: Refinements
1. Comparison constraints (>, <, etc.)
2. Constraint expressions (x + 1)
3. Verification (prove at compile time)
4. Assert and trust expressions
5. Runtime check generation

**Test:** `fn(arr) where length(arr) > 0 => arr[0]`

### Milestone 7: Recursive Types
1. Rec binder and recVar
2. Cycle detection in inference
3. Coinductive subtyping
4. Named type definitions as sugar

**Test:** `type List<T> = null | { head: T, tail: List<T> }`

### Milestone 8: TypeScript Interop
1. Parse .d.ts files (use existing parser)
2. Convert TS types to constraints
3. Handle `any` as `unknown`
4. Generate .d.ts from our types

## Testing Strategy

### Unit Tests
- Normalization: various constraint combinations
- Contradiction detection: all disjoint pairs
- Subtyping: known type relationships
- Unification: variable binding, occurs check

### Integration Tests
- End-to-end inference for sample programs
- Error messages for type mismatches
- Refinement verification (proven vs needs runtime)

### Property Tests
- Subtyping is reflexive: `A <: A`
- Subtyping is transitive: `A <: B && B <: C => A <: C`
- Normalization is idempotent: `normalize(normalize(c)) == normalize(c)`
- Unification is commutative: `unify(a, b) == unify(b, a)`

## Open Questions for Review

1. **Function representation:** The guide uses a simplified `isFunction` constraint. The design doc says constraints come from the body. Need to decide on exact representation.

2. **Comptime tracking:** How do we track which values are compile-time known vs runtime? Separate constraint? Metadata on expressions?

3. **Error locations:** The guide uses `null` for locations. Need source location tracking through inference.

4. **Caching:** When and how to cache inferred function types? Per-call instantiation vs memoization.

5. **Recursive types:** The occurs check currently errors. Need to actually implement `rec` binder creation when cycles are detected.

6. **Variance:** Object fields are treated as covariant (read-only). Need to handle mutable fields (invariant) for full TS compat.
