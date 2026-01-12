# Desugaring

Desugaring transforms the Lezer tree (SurfaceAST) into CoreAST - a uniform representation with all syntax sugar removed.

## Input/Output

- **Input:** Lezer `Tree` + source string
- **Output:** `CoreAST` (array of `CoreDecl`)

See `core-ast.md` for complete CoreAST type definitions.

## Design Principles

1. **Types become expressions** - No separate type-level language; type syntax desugars to function calls
2. **Uniform representation** - CoreAST has fewer node kinds than surface syntax
3. **Preserve source locations** - Every CoreAST node carries its source location for error reporting
4. **Context-aware** - Type syntax vs expression syntax triggers different desugaring rules

## Desugaring Rules

### Type Declarations

#### `type` Declaration

```
type Foo = T;
```
Desugars to:
```
const Foo = WithMetadata(T, { name: "Foo" });
```

**With type parameters:**
```
type Container<T> = { value: T };
```
Desugars to:
```
const Container = (T: Type) => WithMetadata(
  RecordType([{ name: "value", type: T, optional: false, annotations: [] }]),
  { name: "Container", typeArgs: [T] }
);
```

**With annotations:**
```
@Deprecated type OldUser = { name: String };
```
Desugars to:
```
const OldUser = WithMetadata(
  RecordType([{ name: "name", type: String, optional: false, annotations: [] }]),
  { name: "OldUser", annotations: [Deprecated] }
);
```

#### `newtype` Declaration

```
newtype UserId = String;
```
Desugars to:
```
const UserId = Branded(String, "UserId");
```

### Type Syntax Transforms

These transforms apply when parsing type expressions (after `:` in annotations, inside `<>`, after `=` in type declarations).

#### Union Types

```
A | B | C
```
Desugars to:
```
Union(A, B, C)
```

#### Intersection Types

```
A & B & C
```
Desugars to:
```
Intersection(A, B, C)
```

#### Record Types

**Open record:**
```
{ name: String, age: Int }
```
Desugars to:
```
RecordType([
  { name: "name", type: String, optional: false, annotations: [] },
  { name: "age", type: Int, optional: false, annotations: [] }
])
```

**Closed record:**
```
{| name: String, age: Int |}
```
Desugars to:
```
RecordType([
  { name: "name", type: String, optional: false, annotations: [] },
  { name: "age", type: Int, optional: false, annotations: [] }
], Never)
```

**Indexed record:**
```
{ [key: String]: Int }
```
Desugars to:
```
RecordType([], Int)
```

**Optional fields:**
```
{ name: String, nickname?: String }
```
Desugars to:
```
RecordType([
  { name: "name", type: String, optional: false, annotations: [] },
  { name: "nickname", type: String, optional: true, annotations: [] }
])
```

**Field annotations:**
```
{ @JsonName("user_id") userId: String }
```
Desugars to:
```
RecordType([
  { name: "userId", type: String, optional: false, annotations: [JsonName("user_id")] }
])
```

#### Function Types

```
(x: A, y: B) => C
```
Desugars to:
```
FunctionType([A, B], C)
```

**With parameter annotations:**
```
(x: @NonEmpty String) => Int
```
Desugars to:
```
FunctionType([WithMetadata(String, { annotations: [NonEmpty] })], Int)
```

#### Array Types

**Variable-length array:**
```
Int[]
```
Desugars to:
```
Array(Int)
```

Note: `Array` is a variadic function. `Array(Int)` creates a variable-length array, while `Array(Int, String)` creates a fixed 2-element array.

**Fixed-length array (tuple):**
```
[Int, String]
```
Desugars to:
```
Array(Int, String)
```

**Labeled tuple:**
```
[x: Int, y: Int]
```
Desugars to:
```
Array({ type: Int, label: "x" }, { type: String, label: "y" })
```

**Variadic array:**
```
[Int, ...String]
```
Desugars to:
```
Array(Int, Spread(String))
```

#### Literal Types

Literals in type position stay as literals but are marked as types:
```
"foo"
42
true
```
These become literal expressions with type `Type` (the type checker handles this).

#### Type Application

```
Array<Int>
Map<String, Int>
```
Desugars to:
```
Array(Int)
Map(String, Int)
```

The `<>` syntax is sugar for calling a function with type-syntax arguments.

### Generic Functions

#### Type Parameters

```
<T>(x: T) => x
```
Desugars to:
```
(x: T, T: Type = typeOf(x)) => x
```

**With constraints:**
```
<T extends Foo>(x: T) => x
```
Desugars to:
```
(x: T, T: Type<Foo> = typeOf(x)) => x
```

**Multiple type parameters:**
```
<T, U>(x: T, y: U) => [x, y]
```
Desugars to:
```
(x: T, y: U, T: Type = typeOf(x), U: Type = typeOf(y)) => [x, y]
```

**Type parameter annotations:**
```
<@Covariant T>(x: T) => x
```
Desugars to:
```
(x: T, T: Type = WithMetadata(typeOf(x), { annotations: [Covariant] })) => x
```

#### Type Application at Call Site

```
identity<Int>(42)
```
Desugars to:
```
identity(42, Int)
```

**Type-only application (no value args):**
```
makeDefault<Int>
```
Desugars to:
```
makeDefault(Int)
```

### Type Predicates

```
x is T
```
Desugars to:
```
typeOf(x).extends(T)
```

### Expression vs Type Context

The key distinction is which context we're in:

**Type context** (type syntax applies):
- After `:` in type annotations
- Inside `<>` for type arguments
- After `=` in `type` declarations
- Parameter types in function type expressions

**Expression context** (no type syntax sugar):
- Regular expressions
- Inside `()` for function arguments
- Object literals (values, not types)

**Example disambiguation:**
```
// Type context - { a: Int } is a record TYPE
const x: { a: Int } = { a: 1 };

// Expression context - { a: 1 } is a record VALUE
const y = { a: 1 };

// Type context inside <>
const arr: Array<{ a: Int }> = [{ a: 1 }];

// Expression context inside ()
const z = someFunc({ a: 1 });
```

### Match Expression

Match expressions desugar patterns but preserve the overall structure:

```
match (x) {
  case { kind: "a", value: v }: handleA(v);
  case { kind: "b" }: handleB();
  case _: handleDefault();
}
```

Desugars to CoreAST with:
- Destructure patterns for record matching
- Binding patterns for variable capture
- Wildcard pattern for `_`
- Type patterns for type-based matching

### Block Expressions

```
(x: Int) => {
  const y = x + 1;
  const z = y * 2;
  z
}
```

The block becomes a `block` expression with statements and an optional result expression.

### Import Declarations

Import declarations pass through mostly unchanged:

```
import { foo, bar as baz } from "module";
import lib from "module";
import * as utils from "module";
```

Become CoreAST import nodes with the appropriate clause type.

### Export Declarations

Exports are represented as a flag on const declarations:

```
export const x = 1;
export type Foo = Int;
```

Both become `CoreDecl` with `exported: true`. The type declaration also gets the standard `type` → `const` desugaring.

## Implementation

### Main Entry Point

```typescript
import { Tree, TreeCursor } from "@lezer/common";

export function desugar(tree: Tree, source: string): CoreDecl[] {
  const decls: CoreDecl[] = [];
  const cursor = tree.cursor();

  if (cursor.name === "Program" && cursor.firstChild()) {
    do {
      const decl = desugarStatement(cursor, source);
      if (decl) decls.push(decl);
    } while (cursor.nextSibling());
  }

  return decls;
}
```

### Statement Desugaring

```typescript
function desugarStatement(cursor: TreeCursor, source: string): CoreDecl | null {
  switch (cursor.name) {
    case "ConstDecl":
      return desugarConstDecl(cursor, source, false);

    case "TypeDecl":
      return desugarTypeDecl(cursor, source, false);

    case "NewtypeDecl":
      return desugarNewtypeDecl(cursor, source, false);

    case "ImportDecl":
      return desugarImportDecl(cursor, source);

    case "ExportDecl":
      return desugarExportDecl(cursor, source);

    case "ExpressionStatement":
      return desugarExprStatement(cursor, source);

    default:
      return null;
  }
}
```

### Type Declaration Desugaring

```typescript
function desugarTypeDecl(
  cursor: TreeCursor,
  source: string,
  exported: boolean
): CoreDecl {
  const loc = toLoc(cursor);
  let name = "";
  let typeParams: TypeParamInfo[] = [];
  let body: CoreExpr | null = null;
  let annotations: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Annotation":
          annotations.push(desugarAnnotation(cursor, source));
          break;
        case "TypeName":
          name = source.slice(cursor.from, cursor.to);
          break;
        case "TypeParams":
          typeParams = desugarTypeParams(cursor, source);
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            body = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // Build the desugared expression
  let init: CoreExpr;

  if (typeParams.length > 0) {
    // Parameterized type becomes a function
    // type Foo<T> = { value: T }
    // => const Foo = (T: Type) => WithMetadata(RecordType([...]), { name: "Foo", typeArgs: [T] })
    const params: CoreParam[] = typeParams.map(tp => ({
      name: tp.name,
      type: tp.constraint
        ? call("Type", [tp.constraint], loc)
        : ident("Type", loc),
      annotations: tp.annotations
    }));

    const metadata = buildTypeMetadata(name, typeParams.map(tp => ident(tp.name, loc)), annotations, loc);
    const wrappedBody = call("WithMetadata", [body!, metadata], loc);

    init = {
      kind: "lambda",
      params,
      body: wrappedBody,
      async: false,
      loc
    };
  } else {
    // Simple type alias
    // type Foo = T  =>  const Foo = WithMetadata(T, { name: "Foo" })
    const metadata = buildTypeMetadata(name, [], annotations, loc);
    init = call("WithMetadata", [body!, metadata], loc);
  }

  return {
    kind: "const",
    name,
    init,
    comptime: true,  // Type declarations are always comptime
    exported,
    loc
  };
}
```

### Type Expression Desugaring

```typescript
function desugarTypeExpr(cursor: TreeCursor, source: string): CoreExpr {
  switch (cursor.name) {
    case "UnionType":
      return desugarUnionType(cursor, source);

    case "IntersectionType":
      return desugarIntersectionType(cursor, source);

    case "TypeName":
      return ident(source.slice(cursor.from, cursor.to), toLoc(cursor));

    case "TypeArguments":
      // Handled by parent (type application)
      throw new Error("TypeArguments should not be desugared directly");

    case "RecordTypeExpression":
      return desugarRecordType(cursor, source);

    case "TupleTypeExpression":
      return desugarTupleType(cursor, source);

    case "FunctionTypeExpression":
      return desugarFunctionType(cursor, source);

    case "ParenthesizedTypeExpression":
      // Unwrap and desugar inner
      if (cursor.firstChild()) {
        cursor.nextSibling(); // skip (
        const inner = desugarTypeExpr(cursor, source);
        cursor.parent();
        return inner;
      }
      throw new Error("Empty parenthesized type");

    case "LiteralType":
      return desugarLiteralType(cursor, source);

    case "PrimaryTypeExpression":
      return desugarPrimaryTypeExpr(cursor, source);

    default:
      throw new Error(`Unknown type expression: ${cursor.name}`);
  }
}

function desugarUnionType(cursor: TreeCursor, source: string): CoreExpr {
  const loc = toLoc(cursor);
  const types: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (cursor.name !== "|") {
        types.push(desugarTypeExpr(cursor, source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (types.length === 1) return types[0];
  return call("Union", types, loc);
}

function desugarIntersectionType(cursor: TreeCursor, source: string): CoreExpr {
  const loc = toLoc(cursor);
  const types: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (cursor.name !== "&") {
        types.push(desugarTypeExpr(cursor, source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (types.length === 1) return types[0];
  return call("Intersection", types, loc);
}

function desugarRecordType(cursor: TreeCursor, source: string): CoreExpr {
  const loc = toLoc(cursor);
  const fields: CoreExpr[] = [];
  let indexType: CoreExpr | undefined;
  let closed = false;

  // Check for closed record syntax {| |}
  const text = source.slice(cursor.from, cursor.to);
  if (text.startsWith("{|")) {
    closed = true;
  }

  if (cursor.firstChild()) {
    do {
      if (cursor.name === "TypeField") {
        fields.push(desugarTypeField(cursor, source));
      } else if (cursor.name === "IndexSignature") {
        indexType = desugarIndexSignature(cursor, source);
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  const fieldsArray: CoreExpr = { kind: "array", elements: fields.map(f => ({ kind: "element", value: f })), loc };

  if (indexType) {
    return call("RecordType", [fieldsArray, indexType], loc);
  } else if (closed) {
    return call("RecordType", [fieldsArray, ident("Never", loc)], loc);
  } else {
    return call("RecordType", [fieldsArray], loc);
  }
}

function desugarTypeField(cursor: TreeCursor, source: string): CoreExpr {
  const loc = toLoc(cursor);
  let name = "";
  let type: CoreExpr | null = null;
  let optional = false;
  let annotations: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Annotation":
          annotations.push(desugarAnnotation(cursor, source));
          break;
        case "PropertyName":
          name = source.slice(cursor.from, cursor.to);
          break;
        case "?":
          optional = true;
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            type = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // Build FieldInfo record
  return {
    kind: "record",
    fields: [
      { kind: "field", name: "name", value: { kind: "literal", value: name, literalKind: "string", loc } },
      { kind: "field", name: "type", value: type! },
      { kind: "field", name: "optional", value: { kind: "literal", value: optional, literalKind: "boolean", loc } },
      { kind: "field", name: "annotations", value: { kind: "array", elements: annotations.map(a => ({ kind: "element", value: a })), loc } }
    ],
    loc
  };
}
```

### Expression Desugaring

Most expressions pass through with minimal changes. The main transforms are for type applications:

```typescript
function desugarExpr(cursor: TreeCursor, source: string): CoreExpr {
  switch (cursor.name) {
    case "VariableName":
      return ident(source.slice(cursor.from, cursor.to), toLoc(cursor));

    case "Literal":
      return desugarLiteral(cursor, source);

    case "PostfixExpression":
      return desugarPostfixExpr(cursor, source);

    case "BinaryExpression":
      // Note: Binary expressions in type context are handled by desugarTypeExpr
      return desugarBinaryExpr(cursor, source);

    case "ConditionalExpression":
      return desugarConditionalExpr(cursor, source);

    case "LambdaExpression":
      return desugarLambdaExpr(cursor, source);

    case "MatchExpression":
      return desugarMatchExpr(cursor, source);

    case "ArrayExpression":
      return desugarArrayExpr(cursor, source);

    case "RecordExpression":
      return desugarRecordExpr(cursor, source);

    case "ParenthesizedExpression":
      if (cursor.firstChild()) {
        cursor.nextSibling(); // skip (
        const inner = desugarExpr(cursor, source);
        cursor.parent();
        return inner;
      }
      throw new Error("Empty parenthesized expression");

    case "ThrowExpression":
      return desugarThrowExpr(cursor, source);

    case "AwaitExpression":
      return desugarAwaitExpr(cursor, source);

    default:
      throw new Error(`Unknown expression: ${cursor.name}`);
  }
}
```

### Type Application Desugaring

```typescript
function desugarPostfixExpr(cursor: TreeCursor, source: string): CoreExpr {
  const loc = toLoc(cursor);
  let expr: CoreExpr | null = null;

  if (cursor.firstChild()) {
    // First child is the primary expression
    expr = desugarExpr(cursor, source);

    // Process postfix operations
    while (cursor.nextSibling()) {
      switch (cursor.name) {
        case "CallExpression":
          expr = desugarCallExpr(expr!, cursor, source);
          break;

        case "TypeCallExpression":
          // f<T, U>(args) or f<T, U>
          expr = desugarTypeCallExpr(expr!, cursor, source);
          break;

        case "PropertyAccess":
          expr = desugarPropertyAccess(expr!, cursor, source);
          break;

        case "IndexAccess":
          expr = desugarIndexAccess(expr!, cursor, source);
          break;
      }
    }
    cursor.parent();
  }

  return expr!;
}

function desugarTypeCallExpr(
  fn: CoreExpr,
  cursor: TreeCursor,
  source: string
): CoreExpr {
  const loc = toLoc(cursor);
  const typeArgs: CoreExpr[] = [];
  let valueArgs: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (isTypeExpression(cursor.name)) {
        // Type arguments are desugared using type syntax
        typeArgs.push(desugarTypeExpr(cursor, source));
      } else if (cursor.name === "Argument") {
        // Value arguments following the type args
        valueArgs.push(desugarArgument(cursor, source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // f<T, U>(x, y) desugars to f(x, y, T, U)
  // f<T, U> desugars to f(T, U)
  const allArgs = [...valueArgs, ...typeArgs];

  return {
    kind: "call",
    fn,
    args: allArgs,
    loc
  };
}
```

### Lambda Desugaring with Type Parameters

```typescript
function desugarLambdaExpr(cursor: TreeCursor, source: string): CoreExpr {
  const loc = toLoc(cursor);
  let isAsync = false;
  let typeParams: TypeParamInfo[] = [];
  let params: CoreParam[] = [];
  let returnType: CoreExpr | undefined;
  let body: CoreExpr | null = null;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "async":
          isAsync = true;
          break;

        case "TypeParams":
          typeParams = desugarTypeParams(cursor, source);
          break;

        case "VariableName":
          // Single param without parens: x => x + 1
          params.push({
            name: source.slice(cursor.from, cursor.to),
            annotations: []
          });
          break;

        case "LambdaParam":
          params.push(desugarLambdaParam(cursor, source));
          break;

        case "TypeAnnotation":
          // Return type annotation
          if (cursor.firstChild()) {
            cursor.nextSibling(); // skip :
            returnType = desugarTypeExpr(cursor, source);
            cursor.parent();
          }
          break;

        case "Block":
          body = desugarBlock(cursor, source);
          break;

        default:
          if (isExpression(cursor.name)) {
            body = desugarExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // If there are type parameters, append them as Type parameters with defaults
  // <T>(x: T) => ... becomes (x: T, T: Type = typeOf(x)) => ...
  if (typeParams.length > 0) {
    const typeParamDecls: CoreParam[] = typeParams.map(tp => ({
      name: tp.name,
      type: tp.constraint
        ? call("Type", [tp.constraint], loc)
        : ident("Type", loc),
      defaultValue: call("typeOf", [ident(findParamUsingType(params, tp.name) ?? tp.name, loc)], loc),
      annotations: tp.annotations
    }));
    params = [...params, ...typeParamDecls];
  }

  return {
    kind: "lambda",
    params,
    body: body!,
    returnType,
    async: isAsync,
    loc
  };
}

// Find a parameter that uses the given type variable
function findParamUsingType(params: CoreParam[], typeName: string): string | null {
  for (const param of params) {
    if (param.type && usesTypeVar(param.type, typeName)) {
      return param.name;
    }
  }
  return null;
}

function usesTypeVar(expr: CoreExpr, name: string): boolean {
  if (expr.kind === "identifier" && expr.name === name) return true;
  // Recursively check sub-expressions...
  return false;
}
```

## Helper Functions

```typescript
function toLoc(cursor: TreeCursor): SourceLocation {
  return { from: cursor.from, to: cursor.to };
}

function ident(name: string, loc: SourceLocation): CoreExpr {
  return { kind: "identifier", name, loc };
}

function call(fn: string, args: CoreExpr[], loc: SourceLocation): CoreExpr {
  return {
    kind: "call",
    fn: { kind: "identifier", name: fn, loc },
    args,
    loc
  };
}

function buildTypeMetadata(
  name: string,
  typeArgs: CoreExpr[],
  annotations: CoreExpr[],
  loc: SourceLocation
): CoreExpr {
  const fields: CoreRecordField[] = [
    { kind: "field", name: "name", value: { kind: "literal", value: name, literalKind: "string", loc } }
  ];

  if (typeArgs.length > 0) {
    fields.push({
      kind: "field",
      name: "typeArgs",
      value: { kind: "array", elements: typeArgs.map(t => ({ kind: "element", value: t })), loc }
    });
  }

  if (annotations.length > 0) {
    fields.push({
      kind: "field",
      name: "annotations",
      value: { kind: "array", elements: annotations.map(a => ({ kind: "element", value: a })), loc }
    });
  }

  return { kind: "record", fields, loc };
}

function isTypeExpression(nodeName: string): boolean {
  return [
    "UnionType", "IntersectionType", "TypeName", "TypeArguments",
    "RecordTypeExpression", "TupleTypeExpression", "FunctionTypeExpression",
    "ParenthesizedTypeExpression", "LiteralType", "PrimaryTypeExpression"
  ].includes(nodeName);
}

function isExpression(nodeName: string): boolean {
  return [
    "VariableName", "Literal", "PostfixExpression", "BinaryExpression",
    "ConditionalExpression", "LambdaExpression", "MatchExpression",
    "ArrayExpression", "RecordExpression", "ParenthesizedExpression",
    "ThrowExpression", "AwaitExpression", "UnaryExpression"
  ].includes(nodeName);
}
```

## Open Questions

| Question | Options | Notes |
|----------|---------|-------|
| Error recovery | Skip bad nodes / Fail fast | Fail fast for v1 |
| Source map granularity | Node-level / Token-level | Node-level sufficient |
| Whitespace in locations | Include / Trim | Trim to meaningful content |

## Testing Strategy

Test cases should cover:

1. **Type declarations** - Simple aliases, parameterized types, with annotations
2. **Record types** - Open, closed, indexed, with optional fields, with annotations
3. **Function types** - Basic, with type params, with param annotations
4. **Array types** - Variable, fixed, labeled, variadic
5. **Union/intersection** - Two types, multiple types, nested
6. **Type application** - Single arg, multiple args, with value args
7. **Lambda type params** - Single, multiple, with constraints
8. **Match expressions** - All pattern types
9. **Imports/exports** - All clause types

Each test should verify both the structure and source locations of the output.