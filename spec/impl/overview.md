# Implementation Overview

This document describes the DepJS compiler architecture: the pipeline from source code to JavaScript output.

## Pipeline

```
Source Code (.dep)
       │
       ▼
┌─────────────────────────────────────┐
│         Lezer Parser                │  Source string → Lezer Tree
│  (lexing + parsing combined)        │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────┐
│    Desugar      │  Lezer Tree → CoreAST
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  TypeCheck + ComptimeEval   │  CoreAST → TypedAST
└────────┬────────────────────┘
         │
         ▼
┌─────────────────┐
│    Erasure      │  TypedAST → RuntimeAST
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Codegen      │  RuntimeAST → JavaScript string
└────────┬────────┘
         │
         ▼
   JavaScript (.js)
```

## Stage Responsibilities

### 1. Lezer Parser (`lezer.md`)

Lezer handles both lexing and parsing in one step, producing a concrete syntax tree (CST).

**Key responsibilities:**
- Tokenize and parse in one pass
- Handle space-sensitive `<`/`>` disambiguation via external tokenizer
- Track source positions for error reporting
- Handle string interpolation / template literals
- Error recovery - continue parsing after syntax errors

**Output:** Lezer `Tree` (serves as SurfaceAST)

### 2. Desugar (`desugar.md`)

Transforms surface AST into a simplified core AST.

**Key responsibilities:**
- `type Foo = X` → `const Foo = WithMetadata(X, { name: "Foo" })`
- `<T>(x: T)` → `(x: T, T: Type = typeOf(x))`
- `A | B` (in type context) → `Union(A, B)`
- `newtype Foo = T` → `const Foo = Branded(T, "Foo")`
- `@Ann type X = T` → `WithMetadata(T, { name: "X", annotations: [Ann] })`
- `{ a: Int }` (in type context) → `RecordType([...])`

**Output:** `CoreAST` - uniform representation, no syntax sugar

### 4. TypeCheck + ComptimeEval (`typecheck.md`)

Type checks the program and evaluates compile-time expressions. These are **interleaved**, not separate passes.

**Key responsibilities:**
- Flow-based type inference (forward, left-to-right)
- Contextual typing (expected types flow downward)
- Demand-driven compile-time evaluation
- Track comptime-only values (Type, Expr<T>)
- Ensure comptime-only code doesn't escape to runtime
- Pattern matching exhaustiveness checking
- Subtype checking
- Fuel-limited interpretation for comptime eval

**Output:** `TypedAST` - AST annotated with types, comptime values resolved

### 5. Erasure (`erasure.md`)

Removes compile-time-only code from the AST.

**Key responsibilities:**
- Remove `Type` values (no runtime representation)
- Remove `assert(...)` statements
- Remove `comptime` bindings that aren't used at runtime
- Process `Expr<T>` captures (already handled at comptime)
- Inline comptime-computed values where needed

**Output:** `RuntimeAST` - only runtime-relevant code remains

### 6. Codegen (`codegen.md`)

Generates JavaScript from the runtime AST.

**Key responsibilities:**
- Generate ES module output
- `match` expressions → `if`/`switch` chains
- Pattern matching → destructuring + conditions
- Preserve async/await
- Generate source maps (optional)

**Output:** JavaScript string (ES module)

## Shared Data Types

See `core-ast.md` for complete type definitions. Summary:

### Lezer Tree (SurfaceAST)

The Lezer tree serves as our SurfaceAST. We traverse it using Lezer's cursor API during desugaring. See `lezer.md` for node types.

### CoreAST

Uniform representation with all sugar removed. Key points:
- No separate "type" expressions - types are expressions evaluating to `Type` values
- No `typeCall` - desugared to regular `call` with type args appended
- No `type`/`newtype` declarations - desugared to `const` declarations

### Type

Internal representation of types during type checking (the values `Type` expressions evaluate to).

### TypedAST

CoreAST annotated with types and comptime values after type checking.

### RuntimeAST

TypedAST with comptime-only code removed after erasure.

## Interleaved Type Checking and Comptime Evaluation

This is the most complex part of the compiler. The key insight is that **type annotations are expressions** that must evaluate to `Type` values.

```
const x: computeType(schema) = { ... };
         ^^^^^^^^^^^^^^^^^
         This must be evaluated at compile time to get the Type
```

**Algorithm sketch:**

1. Process declarations top-to-bottom
2. For each declaration:
   a. If there's a type annotation, evaluate it (comptime) to get the Type
   b. Type-check the initializer against that Type (or infer if no annotation)
   c. Record the binding's type
3. When evaluating comptime expressions:
   a. Use the fuel-limited interpreter
   b. Handle Type values and their properties
   c. Track comptime-only values

**Demand-driven evaluation:**

Some positions implicitly require comptime evaluation:
- Type annotations: `const x: <expr>` - expr must be comptime
- Type definitions: `type T = <expr>` - expr must be comptime
- Assert conditions: `assert(<expr>)` - expr must be comptime
- Accessing `.fields`, `.variants`, etc. - requires Type value

## Error Handling Strategy

Each stage produces structured errors with source locations:

```typescript
type CompilerError = {
  stage: "lexer" | "parser" | "desugar" | "typecheck" | "codegen";
  message: string;
  loc: SourceLocation;
  notes?: { message: string; loc: SourceLocation }[];
};
```

The compiler should collect multiple errors where possible rather than failing on the first error.

## Implementation Language

The compiler is implemented in **TypeScript**, targeting Node.js. This gives us:
- Familiarity with JS semantics (our target)
- Good tooling and ecosystem
- Type safety during development

## File Organization

```
src/
├── parser/
│   ├── depjs.grammar      # Lezer grammar definition
│   ├── tokens.ts          # External tokenizer (space-sensitive <)
│   ├── highlight.ts       # Syntax highlighting (editor integration)
│   ├── index.ts           # Parser setup and exports
│   └── parser.test.ts
├── desugar/
│   ├── desugar.ts
│   ├── core-ast.ts
│   └── desugar.test.ts
├── typecheck/
│   ├── typecheck.ts
│   ├── types.ts
│   ├── comptime-eval.ts
│   ├── subtyping.ts
│   └── typecheck.test.ts
├── erasure/
│   ├── erasure.ts
│   └── erasure.test.ts
├── codegen/
│   ├── codegen.ts
│   └── codegen.test.ts
├── errors/
│   └── errors.ts
└── cli/
    └── main.ts
```

## Open Questions

### General
- Error recovery strategy: How much should we try to continue after errors?
- Incremental compilation: Is this a goal for v1?
- REPL support: Should we support interactive evaluation?

### Performance
- AST node allocation strategy: Immutable vs mutable during transforms?
- Source map generation: Inline or separate files?

### Testing
- Test format: Inline snapshots vs golden files?
- Integration tests: Compile and run, or just check output?

## Next Steps

1. Implement lexer (`lexer.md`)
2. Implement parser (`parser.md`)
3. Implement desugar (`desugar.md`)
4. Implement type checker + comptime eval (`typecheck.md`)
5. Implement erasure (`erasure.md`)
6. Implement codegen (`codegen.md`)

Each stage can be developed and tested somewhat independently.