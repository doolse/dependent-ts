# Erasure

Erasure removes compile-time-only code from the TypedAST, producing RuntimeAST that contains only code needed at runtime.

## Input/Output

- **Input:** `TypedAST` (type-checked, comptime values resolved)
- **Output:** `RuntimeAST` (comptime-only code removed)

See `core-ast.md` for AST type definitions.

## What Gets Erased

### 1. Type Values

`Type` has no runtime representation. Any binding whose value is a `Type` is removed.

```
// Before erasure
const MyType = RecordType([...]);  // comptimeOnly = true
const x: MyType = { a: 1 };

// After erasure
const x = { a: 1 };
```

### 2. Type Parameters

Type parameters (desugared to trailing `Type` arguments) are removed from function calls.

```
// Before erasure (after desugar)
identity(42, Int);  // Int is a Type argument

// After erasure
identity(42);
```

And from function definitions:

```
// Before erasure (after desugar)
const identity = (x, T = typeOf(x)) => x;

// After erasure
const identity = (x) => x;
```

### 3. Assert Statements

`assert(...)` calls are evaluated at compile time and removed.

```
// Before erasure
assert(x is Int);
const y = x + 1;

// After erasure
const y = x + 1;
```

### 4. Comptime Bindings

Bindings marked `comptime` that aren't used at runtime are removed.

```
// Before erasure
comptime const schema = loadSchema("./schema.json");
const MyType = schemaToType(schema);  // comptimeOnly
const validator = schemaToValidator(schema);  // runtime function

// After erasure
const validator = /* inlined result */;
```

### 5. Type Annotations

Type annotations on parameters and return types are removed (they're only for checking).

```
// Before erasure
const add = (a: Int, b: Int): Int => a + b;

// After erasure
const add = (a, b) => a + b;
```

### 6. Comptime-Only Property Access

Properties like `.fields`, `.variants`, `.typeArgs` that return comptime-only values have already been evaluated during type checking. Their results may need inlining.

```
// Before erasure
const fieldNames = MyType.fieldNames;  // ["a", "b"] computed at comptime

// After erasure
const fieldNames = ["a", "b"];  // Inlined value
```

## What Gets Preserved

### 1. Runtime Values

All non-comptime bindings with runtime values are preserved.

### 2. Runtime-Extracted Type Information

Values extracted from types at compile time that have runtime representations:

```
// .name, .fieldNames, .length, .isFixed are runtime-usable
const typeName = MyType.name;      // "MyRecord" - preserved as string
const fields = MyType.fieldNames;  // ["a", "b"] - preserved as array
```

### 3. Function Bodies (Minus Type Params)

Function bodies are preserved with type parameters removed.

### 4. Pattern Matching

Match expressions are preserved (codegen converts them to JS).

### 5. Async/Await

Preserved as-is for codegen.

## Algorithm

### Overview

```typescript
function erase(typedDecls: TypedDecl[]): RuntimeDecl[] {
  const result: RuntimeDecl[] = [];

  for (const decl of typedDecls) {
    if (decl.comptimeOnly) {
      // Skip comptime-only declarations entirely
      continue;
    }

    const erased = eraseDecl(decl);
    if (erased) {
      result.push(erased);
    }
  }

  return result;
}
```

### Declaration Erasure

```typescript
function eraseDecl(decl: TypedDecl): RuntimeDecl | null {
  switch (decl.kind) {
    case "const":
      if (decl.comptimeOnly) return null;
      return {
        kind: "const",
        name: decl.name,
        init: eraseExpr(decl.init),
        exported: decl.exported,
        loc: decl.loc
        // Note: type annotation removed
      };

    case "import":
      // Imports are preserved (they're runtime)
      return decl;

    case "expr":
      // Expression statements - check if comptime-only
      if (isComptimeOnlyExpr(decl.expr)) {
        // e.g., assert(...) - already evaluated, remove
        return null;
      }
      return {
        kind: "expr",
        expr: eraseExpr(decl.expr),
        loc: decl.loc
      };
  }
}
```

### Expression Erasure

```typescript
function eraseExpr(expr: TypedExpr): RuntimeExpr {
  // If this expression was evaluated at comptime and has a
  // runtime-usable value, inline it
  if (expr.comptimeValue !== undefined && isRuntimeUsable(expr.type)) {
    return inlineValue(expr.comptimeValue, expr.loc);
  }

  switch (expr.kind) {
    case "identifier":
      return expr;

    case "literal":
      return expr;

    case "binary":
      return {
        ...expr,
        left: eraseExpr(expr.left),
        right: eraseExpr(expr.right)
      };

    case "call":
      return eraseCall(expr);

    case "property":
      return eraseProperty(expr);

    case "lambda":
      return eraseLambda(expr);

    case "match":
      return {
        ...expr,
        expr: eraseExpr(expr.expr),
        cases: expr.cases.map(c => ({
          ...c,
          guard: c.guard ? eraseExpr(c.guard) : undefined,
          body: eraseExpr(c.body)
        }))
      };

    case "conditional":
      return {
        ...expr,
        condition: eraseExpr(expr.condition),
        then: eraseExpr(expr.then),
        else: eraseExpr(expr.else)
      };

    case "record":
      return {
        ...expr,
        fields: expr.fields.map(f =>
          f.kind === "spread"
            ? { ...f, expr: eraseExpr(f.expr) }
            : { ...f, value: eraseExpr(f.value) }
        )
      };

    case "array":
      return {
        ...expr,
        elements: expr.elements.map(e =>
          e.kind === "spread"
            ? { ...e, expr: eraseExpr(e.expr) }
            : { ...e, value: eraseExpr(e.value) }
        )
      };

    case "await":
      return { ...expr, expr: eraseExpr(expr.expr) };

    case "throw":
      return { ...expr, expr: eraseExpr(expr.expr) };

    case "template":
      return {
        ...expr,
        parts: expr.parts.map(p =>
          p.kind === "string" ? p : { ...p, expr: eraseExpr(p.expr) }
        )
      };

    case "block":
      const statements = expr.statements
        .map(s => eraseDecl(s))
        .filter((s): s is RuntimeDecl => s !== null);
      return {
        ...expr,
        statements,
        result: expr.result ? eraseExpr(expr.result) : undefined
      };
  }
}
```

### Call Erasure

Remove type arguments from function calls:

```typescript
function eraseCall(expr: TypedCallExpr): RuntimeExpr {
  const fn = eraseExpr(expr.fn);

  // Filter out Type arguments
  const args = expr.args
    .filter(arg => !isTypeValue(arg.type))
    .map(arg => eraseExpr(arg));

  return {
    kind: "call",
    fn,
    args,
    loc: expr.loc
  };
}
```

### Lambda Erasure

Remove type parameters and type annotations:

```typescript
function eraseLambda(expr: TypedLambdaExpr): RuntimeExpr {
  // Filter out Type parameters
  const params = expr.params
    .filter(p => !isTypeParam(p))
    .map(p => ({
      name: p.name,
      defaultValue: p.defaultValue ? eraseExpr(p.defaultValue) : undefined
      // Note: type annotation removed
    }));

  return {
    kind: "lambda",
    params,
    body: eraseExpr(expr.body),
    async: expr.async,
    loc: expr.loc
    // Note: returnType removed
  };
}

function isTypeParam(param: TypedParam): boolean {
  return param.type?.kind === "primitive" && param.type.name === "Type" ||
         param.type?.kind === "typeVar";
}
```

### Property Access Erasure

Handle comptime-evaluated property access:

```typescript
function eraseProperty(expr: TypedPropertyExpr): RuntimeExpr {
  // If this was a comptime property access on a Type, it's been evaluated
  if (expr.comptimeValue !== undefined && isRuntimeUsable(expr.type)) {
    return inlineValue(expr.comptimeValue, expr.loc);
  }

  // Otherwise, preserve the property access
  return {
    kind: "property",
    object: eraseExpr(expr.object),
    name: expr.name,
    loc: expr.loc
  };
}
```

### Value Inlining

Convert comptime values to AST nodes:

```typescript
function inlineValue(value: unknown, loc: SourceLocation): RuntimeExpr {
  if (value === null) {
    return { kind: "literal", value: null, literalKind: "null", loc };
  }
  if (value === undefined) {
    return { kind: "literal", value: undefined, literalKind: "undefined", loc };
  }
  if (typeof value === "boolean") {
    return { kind: "literal", value, literalKind: "boolean", loc };
  }
  if (typeof value === "number") {
    const literalKind = Number.isInteger(value) ? "int" : "float";
    return { kind: "literal", value, literalKind, loc };
  }
  if (typeof value === "string") {
    return { kind: "literal", value, literalKind: "string", loc };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      elements: value.map(v => ({ kind: "element", value: inlineValue(v, loc) })),
      loc
    };
  }
  if (typeof value === "object") {
    return {
      kind: "record",
      fields: Object.entries(value).map(([name, v]) => ({
        kind: "field",
        name,
        value: inlineValue(v, loc)
      })),
      loc
    };
  }

  throw new Error(`Cannot inline value of type ${typeof value}`);
}
```

### Runtime Usability Check

Determine if a type can exist at runtime:

```typescript
function isRuntimeUsable(type: Type): boolean {
  switch (type.kind) {
    case "primitive":
      // Type and Void have no runtime representation
      return type.name !== "Type" && type.name !== "Void";

    case "literal":
      return true;

    case "record":
      // Runtime usable if all fields are runtime usable
      return type.fields.every(f => isRuntimeUsable(f.type));

    case "array":
      return type.elementTypes.every(t => isRuntimeUsable(t));

    case "function":
      // Functions are runtime usable if params and return are
      return type.params.every(p => isRuntimeUsable(p.type)) &&
             isRuntimeUsable(type.returnType);

    case "union":
      return type.types.every(t => isRuntimeUsable(t));

    case "intersection":
      return type.types.every(t => isRuntimeUsable(t));

    case "branded":
      return isRuntimeUsable(type.baseType);

    case "typeVar":
      // Type variables themselves aren't runtime usable
      return false;

    case "this":
      // Resolved during type checking
      return true;

    case "withMetadata":
      return isRuntimeUsable(type.baseType);
  }
}

function isTypeValue(type: Type): boolean {
  return type.kind === "primitive" && type.name === "Type" ||
         type.kind === "typeVar";
}
```

## Edge Cases

### Partial Application with Type Args

When a generic function is partially applied with only type args:

```
const intIdentity = identity<Int>;  // identity(Int)
```

After erasure, this becomes a reference to the original function (the type arg is removed):

```
const intIdentity = identity;  // Just an alias
```

### Conditional with Type Branches

If a conditional has comptime-evaluated branches:

```
const result = T.extends(Int) ? handleInt() : handleOther();
```

The condition `T.extends(Int)` is evaluated at comptime. If the result is known:

```
// If T.extends(Int) is true at comptime:
const result = handleInt();

// If false:
const result = handleOther();
```

### Closures Capturing Type Info

If a closure captures runtime-usable type info:

```
const typeName = T.name;  // Evaluated at comptime to "MyType"
const f = () => console.log(typeName);
```

After erasure:

```
const typeName = "MyType";  // Inlined
const f = () => console.log(typeName);
```

### Expr<T> Captures

`Expr<T>` values have already been processed at comptime. Any runtime-usable data extracted from them should be inlined.

```
// If a function extracted field names from an Expr at comptime:
const fields = extractFields(expr);  // ["a", "b"] at comptime

// After erasure:
const fields = ["a", "b"];
```

## Validation

Before erasure, validate that no comptime-only values escape:

```typescript
function validateNoEscape(decl: TypedDecl): void {
  if (decl.comptimeOnly) return;  // Comptime-only decls can use comptime values

  // Check that initializer doesn't contain escaped comptime values
  validateExprNoEscape(decl.init);
}

function validateExprNoEscape(expr: TypedExpr): void {
  if (!isRuntimeUsable(expr.type) && expr.comptimeValue === undefined) {
    throw new CompileError(
      `Comptime-only value of type '${formatType(expr.type)}' cannot exist at runtime`,
      expr.loc
    );
  }

  // Recursively check sub-expressions
  // ...
}
```

This validation should happen during type checking, but erasure can double-check.

## Open Questions

| Question | Options | Notes |
|----------|---------|-------|
| Dead code elimination | During erasure / Separate pass / Defer to JS minifier | Defer for v1 |
| Inlining strategy | Inline all comptime / Only when needed | Inline all for simplicity |
| Source map preservation | Through erasure / Regenerate | Preserve through transforms |

## Testing Strategy

Test cases should cover:

1. **Type erasure** - Type bindings removed
2. **Type parameter erasure** - Trailing Type params removed from calls/lambdas
3. **Assert removal** - assert() statements removed
4. **Comptime binding removal** - Unused comptime bindings removed
5. **Value inlining** - Comptime values inlined correctly (primitives, arrays, records)
6. **Partial type application** - Becomes alias
7. **Conditional branch elimination** - When condition is comptime-known
8. **Mixed comptime/runtime** - Runtime parts preserved, comptime parts inlined/removed
9. **Nested structures** - Deep erasure works correctly