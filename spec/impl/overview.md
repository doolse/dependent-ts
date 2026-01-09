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

### Source Locations

All AST nodes carry source location for error reporting:

```typescript
type SourceLocation = {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

type Located<T> = T & { loc: SourceLocation };
```

### Lezer Tree (SurfaceAST)

The Lezer tree serves as our SurfaceAST. It's a concrete syntax tree that preserves all source information. We traverse it using Lezer's cursor API.

```typescript
import { Tree, TreeCursor } from "@lezer/common";

// Lezer provides the tree structure - we traverse it with cursors
// See lezer.md for node types and traversal patterns
```

### Surface AST Types (abbreviated)

These types represent the Lezer tree nodes in a more convenient form for complex operations. See `lezer.md` for full details.

```typescript
type SurfaceExpr =
  | { kind: "identifier"; name: string }
  | { kind: "literal"; value: unknown; literalKind: "int" | "float" | "string" | "boolean" | "null" | "undefined" }
  | { kind: "binary"; op: string; left: SurfaceExpr; right: SurfaceExpr }
  | { kind: "call"; fn: SurfaceExpr; args: SurfaceExpr[] }
  | { kind: "typeCall"; fn: SurfaceExpr; typeArgs: SurfaceTypeExpr[] }  // f<T, U>
  | { kind: "property"; object: SurfaceExpr; name: string }
  | { kind: "index"; object: SurfaceExpr; index: SurfaceExpr }
  | { kind: "lambda"; params: SurfaceParam[]; body: SurfaceExpr; async: boolean }
  | { kind: "match"; expr: SurfaceExpr; cases: SurfaceCase[] }
  | { kind: "conditional"; condition: SurfaceExpr; then: SurfaceExpr; else: SurfaceExpr }
  | { kind: "record"; fields: SurfaceRecordField[] }
  | { kind: "array"; elements: SurfaceArrayElement[] }
  | { kind: "await"; expr: SurfaceExpr }
  | { kind: "throw"; expr: SurfaceExpr }
  | { kind: "spread"; expr: SurfaceExpr }
  | { kind: "template"; parts: SurfaceTemplatePart[] }
  // ... more

type SurfaceTypeExpr =
  | { kind: "typeRef"; name: string }
  | { kind: "typeCall"; fn: SurfaceTypeExpr; args: SurfaceTypeExpr[] }  // Array<Int>
  | { kind: "union"; types: SurfaceTypeExpr[] }                         // A | B
  | { kind: "intersection"; types: SurfaceTypeExpr[] }                  // A & B
  | { kind: "recordType"; fields: SurfaceTypeField[]; closed: boolean; indexType?: SurfaceTypeExpr }
  | { kind: "functionType"; params: SurfaceTypeParam[]; returnType: SurfaceTypeExpr }
  | { kind: "arrayType"; elementType: SurfaceTypeExpr }                 // T[]
  | { kind: "tupleType"; elements: SurfaceTupleElement[] }              // [A, B]
  | { kind: "literal"; value: unknown }                                  // "foo", 42, true
  // ... more

type SurfaceDecl =
  | { kind: "const"; name: string; typeAnnotation?: SurfaceTypeExpr; init: SurfaceExpr; comptime: boolean }
  | { kind: "type"; name: string; typeParams: SurfaceTypeParam[]; body: SurfaceTypeExpr; annotations: SurfaceExpr[] }
  | { kind: "newtype"; name: string; baseType: SurfaceTypeExpr }
  | { kind: "import"; ... }
  | { kind: "export"; ... }
  // ... more
```

### Core AST (abbreviated)

The core AST is uniform - all sugar removed. Full definition in `desugar.md`.

```typescript
type CoreExpr =
  | { kind: "identifier"; name: string }
  | { kind: "literal"; value: unknown; literalKind: "int" | "float" | "string" | "boolean" | "null" | "undefined" }
  | { kind: "binary"; op: BinaryOp; left: CoreExpr; right: CoreExpr }
  | { kind: "unary"; op: UnaryOp; operand: CoreExpr }
  | { kind: "call"; fn: CoreExpr; args: CoreExpr[] }
  | { kind: "property"; object: CoreExpr; name: string }
  | { kind: "index"; object: CoreExpr; index: CoreExpr }
  | { kind: "lambda"; params: CoreParam[]; body: CoreExpr; async: boolean }
  | { kind: "match"; expr: CoreExpr; cases: CoreCase[] }
  | { kind: "conditional"; condition: CoreExpr; then: CoreExpr; else: CoreExpr }
  | { kind: "record"; fields: CoreRecordField[] }
  | { kind: "array"; elements: CoreExpr[] }
  | { kind: "spread"; expr: CoreExpr }
  | { kind: "await"; expr: CoreExpr }
  | { kind: "throw"; expr: CoreExpr }
  | { kind: "template"; parts: CoreTemplatePart[] }

// No separate "type" nodes - types are just expressions that evaluate to Type values
// No typeCall - desugared to regular call with type arguments appended
// No union/intersection syntax - desugared to Union(...)/Intersection(...) calls

type CoreDecl =
  | { kind: "const"; name: string; typeAnnotation?: CoreExpr; init: CoreExpr; comptime: boolean }
  | { kind: "import"; ... }
  | { kind: "export"; ... }
  // Note: no "type" or "newtype" - desugared to const declarations
```

### Type Representation

Internal representation of types during type checking:

```typescript
type Type =
  | { kind: "primitive"; name: "Int" | "Float" | "Number" | "String" | "Boolean" | "Null" | "Undefined" | "Never" | "Unknown" | "Void" }
  | { kind: "literal"; value: unknown; baseType: "Int" | "Float" | "String" | "Boolean" }
  | { kind: "record"; fields: FieldInfo[]; indexType?: Type; closed: boolean; name?: string }
  | { kind: "function"; params: ParamInfo[]; returnType: Type; async: boolean }
  | { kind: "array"; elementTypes: Type[]; variadic: boolean }  // [A, B] or T[]
  | { kind: "union"; types: Type[] }
  | { kind: "intersection"; types: Type[] }
  | { kind: "branded"; baseType: Type; brand: string; name: string }
  | { kind: "typeVar"; name: string; bound?: Type }
  | { kind: "this" }
  | { kind: "withMetadata"; baseType: Type; metadata: TypeMetadata }

type FieldInfo = {
  name: string;
  type: Type;
  optional: boolean;
  annotations: unknown[];
};

type ParamInfo = {
  name: string;
  type: Type;
  optional: boolean;
  defaultValue?: CoreExpr;
};

type TypeMetadata = {
  name?: string;
  typeArgs?: Type[];
  annotations?: unknown[];
};
```

### Typed AST

After type checking, the AST is annotated with types:

```typescript
type TypedExpr = CoreExpr & {
  type: Type;
  comptimeValue?: unknown;  // If expression was evaluated at comptime
};

type TypedDecl = CoreDecl & {
  type: Type;
  comptimeOnly: boolean;  // If this binding only exists at comptime
};
```

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