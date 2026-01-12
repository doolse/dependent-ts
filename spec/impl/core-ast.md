# Core AST Types

This document defines the shared AST types used throughout the compiler pipeline.

## Source Locations

All AST nodes carry source location for error reporting:

```typescript
type SourceLocation = {
  from: number;  // Start offset in source
  to: number;    // End offset in source
};

type Located<T> = T & { loc: SourceLocation };
```

## CoreAST

The CoreAST is the uniform representation produced by desugaring. All syntax sugar has been removed.

### Expressions

```typescript
type CoreExpr = Located<
  | { kind: "identifier"; name: string }
  | { kind: "literal"; value: unknown; literalKind: LiteralKind }
  | { kind: "binary"; op: BinaryOp; left: CoreExpr; right: CoreExpr }
  | { kind: "unary"; op: UnaryOp; operand: CoreExpr }
  | { kind: "call"; fn: CoreExpr; args: CoreExpr[] }
  | { kind: "property"; object: CoreExpr; name: string }
  | { kind: "index"; object: CoreExpr; index: CoreExpr }
  | { kind: "lambda"; params: CoreParam[]; body: CoreExpr; returnType?: CoreExpr; async: boolean }
  | { kind: "match"; expr: CoreExpr; cases: CoreCase[] }
  | { kind: "conditional"; condition: CoreExpr; then: CoreExpr; else: CoreExpr }
  | { kind: "record"; fields: CoreRecordField[] }
  | { kind: "array"; elements: CoreArrayElement[] }
  | { kind: "await"; expr: CoreExpr }
  | { kind: "throw"; expr: CoreExpr }
  | { kind: "template"; parts: CoreTemplatePart[] }
  | { kind: "block"; statements: CoreDecl[]; result?: CoreExpr }
>;

type LiteralKind = "int" | "float" | "string" | "boolean" | "null" | "undefined";

type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!="
  | "<" | ">" | "<=" | ">="
  | "&&" | "||"
  | "|" | "&" | "^";

type UnaryOp = "!" | "-" | "~";

type CoreParam = {
  name: string;
  type?: CoreExpr;         // Type annotation (desugared to expression)
  defaultValue?: CoreExpr;
  annotations: CoreExpr[];
};

type CoreCase = {
  pattern: CorePattern;
  guard?: CoreExpr;
  body: CoreExpr;
  loc: SourceLocation;
};

type CoreRecordField =
  | { kind: "field"; name: string; value: CoreExpr }
  | { kind: "spread"; expr: CoreExpr };

type CoreArrayElement =
  | { kind: "element"; value: CoreExpr }
  | { kind: "spread"; expr: CoreExpr };

type CoreTemplatePart =
  | { kind: "string"; value: string }
  | { kind: "expr"; expr: CoreExpr };
```

**Key properties:**
- No separate "type" expressions - types are just expressions that evaluate to `Type` values
- No `typeCall` - desugared to regular `call` with type arguments appended
- No union/intersection syntax - desugared to `Union(...)`/`Intersection(...)` calls

### Patterns

```typescript
type CorePattern = Located<
  | { kind: "wildcard" }
  | { kind: "literal"; value: unknown; literalKind: LiteralKind }
  | { kind: "type"; typeExpr: CoreExpr }  // Type pattern - expression evaluating to Type
  | { kind: "binding"; name: string; pattern?: CorePattern }
  | { kind: "destructure"; fields: CorePatternField[] }
>;

type CorePatternField = {
  name: string;           // Field name to match
  binding?: string;       // Variable to bind to (defaults to name)
  pattern?: CorePattern;  // Nested pattern
};
```

### Declarations

```typescript
type CoreDecl = Located<
  | { kind: "const"; name: string; type?: CoreExpr; init: CoreExpr; comptime: boolean; exported: boolean }
  | { kind: "import"; clause: CoreImportClause; source: string }
  | { kind: "expr"; expr: CoreExpr }  // Expression statement (for effects like assert)
>;

type CoreImportClause =
  | { kind: "default"; name: string }
  | { kind: "named"; specifiers: CoreImportSpecifier[] }
  | { kind: "namespace"; name: string }
  | { kind: "defaultAndNamed"; defaultName: string; specifiers: CoreImportSpecifier[] };

type CoreImportSpecifier = {
  name: string;
  alias?: string;
};
```

**Note:** There is no `type` or `newtype` declaration - they desugar to `const` declarations.

## Type Representation

Internal representation of types during type checking. These are the *values* that `Type` expressions evaluate to.

```typescript
type Type =
  | { kind: "primitive"; name: PrimitiveName }
  | { kind: "literal"; value: unknown; baseType: "Int" | "Float" | "String" | "Boolean" }
  | { kind: "record"; fields: FieldInfo[]; indexType?: Type; closed: boolean }
  | { kind: "function"; params: ParamInfo[]; returnType: Type; async: boolean }
  | { kind: "array"; elementTypes: Type[]; variadic: boolean }
  | { kind: "union"; types: Type[] }
  | { kind: "intersection"; types: Type[] }
  | { kind: "branded"; baseType: Type; brand: string; name: string }
  | { kind: "typeVar"; name: string; bound?: Type }
  | { kind: "this" }
  | { kind: "withMetadata"; baseType: Type; metadata: TypeMetadata };

type PrimitiveName =
  | "Int" | "Float" | "Number"
  | "String" | "Boolean"
  | "Null" | "Undefined"
  | "Never" | "Unknown" | "Void";

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

## TypedAST

After type checking, the CoreAST is annotated with types:

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

## RuntimeAST

After erasure, comptime-only code is removed. The RuntimeAST is a subset of TypedAST where:
- All `comptimeOnly` declarations are removed
- All `Type` values are removed (or replaced with extracted runtime data)
- `assert(...)` statements are removed
- `Expr<T>` captures have been processed

```typescript
// RuntimeAST uses the same node types as CoreAST/TypedAST,
// but with comptimeOnly nodes removed
type RuntimeDecl = CoreDecl;  // Subset - no comptimeOnly bindings
type RuntimeExpr = CoreExpr;  // Subset - no Type values
```

## Compiler Errors

```typescript
type CompilerError = {
  stage: "parse" | "desugar" | "typecheck" | "erasure" | "codegen";
  message: string;
  loc: SourceLocation;
  notes?: CompilerNote[];
};

type CompilerNote = {
  message: string;
  loc?: SourceLocation;
};
```