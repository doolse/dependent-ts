# Type Checking + Compile-Time Evaluation

This is the most complex stage of the compiler. Type checking and compile-time evaluation are **interleaved**, not separate passes.

## Input/Output

- **Input:** `CoreAST` (desugared)
- **Output:** `TypedAST` (annotated with types, comptime values resolved)

## The Core Challenge: Interleaving

Type checking and comptime evaluation are **mutually dependent**:

```
const MyType = computeType(schema);   // Need to EVALUATE to get Type value
const x: MyType = { ... };            // Need the Type to TYPE-CHECK this
```

You can't do all type checking first, then all evaluation. They're interleaved.

## High-Level Algorithm

```
for each declaration in order:
    1. If it has a type annotation:
       - TYPE-CHECK the annotation expression (must be Type)
       - EVALUATE the annotation to get concrete Type value

    2. TYPE-CHECK the initializer:
       - If we have an expected type (from annotation), use contextual typing
       - Otherwise, infer the type

    3. If this is marked `comptime` or used in comptime context:
       - EVALUATE the initializer
       - Store the comptime value

    4. Record the binding in scope with its type (and comptime value if any)
```

## Demand-Driven Evaluation

Evaluation only happens when something *needs* a value at compile time.

```
const x = 1 + 2;              // No evaluation needed yet (just type-check)
const T = RecordType([...]);  // No evaluation yet
const y: T = { ... };         // NOW T must be evaluated - it's in type position
```

### Positions That Demand Comptime Evaluation

| Position | Example | Why |
|----------|---------|-----|
| Type annotation | `const x: T` | Need Type value to check against |
| Type definition | `type T = expr` | Desugars to const, used in type positions |
| Assert condition | `assert(cond)` | Must evaluate to check at compile time |
| Comptime-only property access | `T.fields` | Returns comptimeOnly value |
| Expr<T> parameter | `f(expr)` where param is `Expr<T>` | Capture AST instead of evaluate |

### Propagation

Comptime requirements propagate backwards through dependencies:

```
const a = 1;
const b = a + 1;
const c = b + 1;
const T = makeType(c);
const x: T = ...;  // T needs comptime → c needs comptime → b needs comptime → a needs comptime
```

**OPEN QUESTION:** How far do we propagate? Options:
1. **Eager:** Mark everything transitively depended on as comptime
2. **Lazy:** Only evaluate when actually needed, cache results
3. **Hybrid:** Mark as "potentially comptime", evaluate on demand

Current thinking: Option 2 (lazy) is simpler and matches "demand-driven" semantics.

## TypedComptimeValue: Values Carry Types

A key design decision: every compile-time value carries its type alongside the value.

### Motivation

The comptime evaluator needs to know types for operations like `typeOf`. Previously, this
required synchronizing two separate environments (TypeEnv for types, ComptimeEnv for values).
With TypedComptimeValue, each value is a `{ value, type }` pair, providing a single source
of truth.

### Type Definition

```typescript
// The raw value without type info (internal use)
type RawComptimeValue =
  | Type           // When the value IS a Type
  | string
  | number
  | boolean
  | null
  | undefined
  | RawComptimeValue[]      // Arrays
  | RawComptimeRecord       // Records
  | ComptimeClosure
  | ComptimeBuiltin;

// The main type: value + its type (always paired)
type TypedComptimeValue = {
  value: RawComptimeValue;
  type: Type;
};

// ComptimeEnv stores TypedComptimeValue
type ComptimeEntry =
  | { status: "evaluated"; value: TypedComptimeValue }
  | { status: "unevaluated"; expr: CoreExpr; typeEnv: TypeEnv }
  | { status: "evaluating" }
  | { status: "unavailable" };
```

### Examples

| Expression | TypedComptimeValue |
|------------|-------------------|
| `42` | `{ value: 42, type: literalType(42, "Int") }` |
| `"hello"` | `{ value: "hello", type: literalType("hello", "String") }` |
| `Int` | `{ value: primitiveType("Int"), type: primitiveType("Type") }` |
| `[1, 2]` | `{ value: [1, 2], type: arrayType([literalType(1), literalType(2)]) }` |
| `{ a: 1 }` | `{ value: { a: 1 }, type: recordType([{ name: "a", type: literalType(1), ... }]) }` |

### Type Values

When the value IS a Type (like `Int`), it gets wrapped:
```typescript
{ value: primitiveType("Int"), type: primitiveType("Type") }
```

`isTypeValue(tv)` checks if `tv.type.kind === "primitive" && tv.type.name === "Type"`.

### Benefits

1. **`typeOf` is trivial** - Just extract the type from the value
2. **Single source of truth** - No dual TypeEnv/ComptimeEnv synchronization needed
3. **Closure application is natural** - Arguments carry their types
4. **Generic inference works** - `(x: T, T: Type = typeOf(x))` just extracts type from bound `x`

## The `typeOf` Builtin

`typeOf(expr)` returns the compile-time type of an expression as a `Type` value.

### Semantics

- `typeOf(identifier)` → returns the **type** stored with the binding
- `typeOf(literal)` → returns the **literal type** (e.g., `typeOf(42)` → literal type `42`)
- `typeOf` is comptimeOnly - it only exists at compile time

### Implementation

With TypedComptimeValue, `typeOf` is trivial:

```typescript
const builtinTypeOf: ComptimeBuiltin = {
  kind: "builtin",
  name: "typeOf",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 1) {
      throw new CompileError("typeOf expects exactly 1 argument", loc);
    }
    // The type is right there on the argument!
    return { value: args[0].type, type: primitiveType("Type") };
  },
};
```

### Generic Inference with typeOf

For generic inference to work with `typeOf` in default parameters:

```
const id = (x: T, T: Type = typeOf(x)) => x;
id(42);  // T should be inferred as literal type 42
```

Since arguments are TypedComptimeValue, when `typeOf(x)` is evaluated:
1. Look up `x` in the comptime environment
2. Get the TypedComptimeValue `{ value: 42, type: literalType(42, "Int") }`
3. Return `{ value: literalType(42, "Int"), type: primitiveType("Type") }`

### Order of Parameter Binding

Parameters are bound left-to-right. When evaluating a default for parameter `i`,
parameters `0..i-1` are already bound. This allows:

```
(x: T, T: Type = typeOf(x)) => ...
```

When evaluating `typeOf(x)`, `x` is already bound with its type.

## Comptime-Only Tracking

Some values can **only exist at compile time**:

```typescript
type ComptimeStatus =
  | "runtime"      // Normal runtime value
  | "comptime"     // Evaluated at comptime, but CAN exist at runtime
  | "comptimeOnly" // CANNOT exist at runtime (Type, Expr<T>)
```

### What Is ComptimeOnly?

- `Type` values - no runtime representation
- `Expr<T>` values - AST with Type fields
- Results of comptime-only property access (`.fields`, `.variants`, `.typeArgs`)
- Functions that return comptimeOnly values

### What Is Comptime But Runtime-Usable?

- `.name` on Type - returns `String`
- `.fieldNames` on record Type - returns `Array<String>`
- `.length` on fixed array Type - returns `Int`
- Any primitive extracted from a Type at compile time

### Escape Analysis

**The rule:** If a comptimeOnly value would "escape" into runtime context, it's a compile error.

```
const T = typeOf(x);           // T is comptimeOnly (it's a Type)
const name = T.name;           // name is comptime, runtime-usable (String)
const fields = T.fields;       // fields is comptimeOnly (contains Types)

// ERROR: comptimeOnly escapes to runtime
const getFields = (x) => typeOf(x).fields;
```

**What counts as escaping?**
- Returned from a function that might be called at runtime
- Stored in a data structure that exists at runtime
- Passed to a function parameter that isn't `Expr<T>` or `Type`
- Captured in a closure that escapes to runtime

**OPEN QUESTION:** How do we determine if a function "might be called at runtime"?
- Option A: Conservative - assume all functions can be called at runtime unless proven otherwise
- Option B: Track "comptime functions" explicitly (functions only called from comptime contexts)
- Option C: Infer from usage - if a function is only ever called in comptime contexts, it's comptime

Current thinking: Option A (conservative) is safest for v1.

## The Comptime Interpreter

We need an interpreter that can evaluate DepJS at compile time. The interpreter returns
`TypedComptimeValue` pairs containing both the value and its type.

### Core Evaluation

```typescript
function comptimeEval(expr: CoreExpr, env: ComptimeEnv, typeEnv: TypeEnv): TypedComptimeValue {
  switch (expr.kind) {
    case "literal":
      // Return value + literal type
      return {
        value: expr.value,
        type: literalType(expr.value, expr.literalKind)
      };

    case "identifier":
      // ComptimeEnv stores TypedComptimeValue directly
      return env.getValue(expr.name);  // Already has { value, type }

    case "binary":
      const left = comptimeEval(expr.left, env, typeEnv);
      const right = comptimeEval(expr.right, env, typeEnv);
      // Compute result value AND result type
      const resultValue = applyBinaryOp(expr.op, left.value, right.value);
      const resultType = inferBinaryResultType(expr.op, left.type, right.type);
      return { value: resultValue, type: resultType };

    case "call":
      const fn = comptimeEval(expr.fn, env, typeEnv);
      const args = expr.args.map(a => comptimeEval(a, env, typeEnv));
      // Both closures and builtins receive and return TypedComptimeValue
      return applyFunction(fn, args, env, typeEnv);

    case "property":
      const obj = comptimeEval(expr.object, env, typeEnv);
      if (isTypeValue(obj)) {
        // Type property access returns TypedComptimeValue
        return getTypeProperty(obj.value as Type, expr.name);
      }
      // Record property: extract field type from object's type
      const fieldType = getFieldType(obj.type, expr.name);
      return { value: (obj.value as Record<string, unknown>)[expr.name], type: fieldType };

    case "lambda":
      // Compute the function type from params and infer return type
      const fnType = computeLambdaType(expr, env, typeEnv);
      return {
        value: { kind: "closure", params: expr.params, body: expr.body, env, typeEnv, fnType },
        type: fnType
      };

    case "conditional":
      const cond = comptimeEval(expr.condition, env, typeEnv);
      const result = cond.value
        ? comptimeEval(expr.then, env, typeEnv)
        : comptimeEval(expr.else, env, typeEnv);
      return result;

    case "record":
      // Build both the value record and the type record
      const fields: Record<string, unknown> = {};
      const fieldInfos: FieldInfo[] = [];
      for (const f of expr.fields) {
        const fieldVal = comptimeEval(f.value, env, typeEnv);
        fields[f.name] = fieldVal.value;
        fieldInfos.push({ name: f.name, type: fieldVal.type, optional: false, annotations: [] });
      }
      return { value: fields, type: recordType(fieldInfos) };

    case "array":
      const elements = expr.elements.map(e => comptimeEval(e, env, typeEnv));
      const elementTypes = elements.map(e => e.type);
      return {
        value: elements.map(e => e.value),
        type: arrayType(elementTypes, false)  // Fixed-length array
      };

    case "match":
      return evalMatch(expr, env, typeEnv);

    // ... etc
  }
}
```

### Fuel Limiting

Prevents infinite loops from hanging compilation:

```typescript
class ComptimeEvaluator {
  private fuel: number;
  private readonly maxFuel: number;

  constructor(maxFuel: number = 10000) {
    this.maxFuel = maxFuel;
    this.fuel = maxFuel;
  }

  eval(expr: TypedExpr, env: ComptimeEnv): ComptimeValue {
    if (--this.fuel <= 0) {
      throw new CompileError(
        "Compile-time evaluation exceeded fuel limit",
        expr.loc
      );
    }
    // ... actual evaluation
  }

  reset() {
    this.fuel = this.maxFuel;
  }
}
```

**OPEN QUESTION:** What should the default fuel limit be?
- Too low: Legitimate programs fail
- Too high: Slow compilation on buggy programs
- Configurable via compiler flag?

Current thinking: Default 10,000, configurable via `--comptime-fuel` flag.

### Type Value Properties

Type values have special property access semantics. Each property returns a
`TypedComptimeValue` with both the value and its type:

```typescript
function getTypeProperty(type: Type, prop: string): TypedComptimeValue {
  switch (prop) {
    // Runtime-usable properties
    case "name":
      const name = getTypeName(type);
      return { value: name, type: unionType([primitiveType("String"), primitiveType("Undefined")]) };
    case "baseName":
      const baseName = getTypeBaseName(type);
      return { value: baseName, type: unionType([primitiveType("String"), primitiveType("Undefined")]) };
    case "fieldNames":
      assertRecordType(type);
      const fieldNames = type.fields.map(f => f.name);
      return { value: fieldNames, type: arrayType([primitiveType("String")], true) };
    case "length":
      assertArrayType(type);
      const length = type.isFixed ? type.elementTypes.length : undefined;
      return { value: length, type: unionType([primitiveType("Int"), primitiveType("Undefined")]) };
    case "isFixed":
      assertArrayType(type);
      return { value: type.isFixed, type: primitiveType("Boolean") };

    // ComptimeOnly properties (return Type values)
    case "fields":
      assertRecordType(type);
      return { value: type.fields, type: arrayType([FieldInfoType], true) };
    case "variants":
      assertUnionType(type);
      return { value: type.types, type: arrayType([primitiveType("Type")], true) };
    case "typeArgs":
      const typeArgs = type.metadata?.typeArgs ?? [];
      return { value: typeArgs, type: arrayType([primitiveType("Type")], true) };
    case "elementType":
      assertArrayType(type);
      const elemType = unionOf(type.elementTypes);
      return { value: elemType, type: primitiveType("Type") };
    case "returnType":
      assertFunctionType(type);
      return { value: type.returnType, type: primitiveType("Type") };
    case "parameterTypes":
      assertFunctionType(type);
      const paramTypes = type.params.map(p => p.type);
      return { value: paramTypes, type: arrayType([primitiveType("Type")], true) };

    // Methods (return function values)
    case "extends":
      const extendsFn = createExtendsMethod(type);
      return { value: extendsFn, type: functionType([{ name: "other", type: primitiveType("Type") }], primitiveType("Boolean")) };

    default:
      throw new CompileError(`Type has no property '${prop}'`);
  }
}
```

## Flow-Based Type Inference

Types are inferred by analyzing code forward, left-to-right, top-to-bottom.

### Basic Inference

```typescript
function infer(expr: CoreExpr, env: TypeEnv): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr.value, expr.literalKind);

    case "identifier":
      return env.lookup(expr.name).type;

    case "binary":
      const leftType = infer(expr.left, env);
      const rightType = infer(expr.right, env);
      return inferBinaryResultType(expr.op, leftType, rightType);

    case "call":
      const fnType = infer(expr.fn, env);
      const argTypes = expr.args.map(a => infer(a, env));
      return inferCallResultType(fnType, argTypes);

    case "property":
      const objType = infer(expr.object, env);
      return getPropertyType(objType, expr.name);

    case "lambda":
      // Parameters must have types (from annotation or context)
      const paramTypes = expr.params.map(p => {
        if (p.typeAnnotation) {
          return evalTypeAnnotation(p.typeAnnotation, env);
        }
        throw new CompileError(`Cannot infer type of parameter '${p.name}'`);
      });
      const bodyEnv = env.extend(expr.params.map((p, i) => [p.name, paramTypes[i]]));
      const returnType = infer(expr.body, bodyEnv);
      return { kind: "function", params: paramTypes, returnType };

    case "record":
      const fields = expr.fields.map(f => ({
        name: f.name,
        type: infer(f.value, env),
        optional: false
      }));
      return { kind: "record", fields, closed: false };

    case "array":
      const elementTypes = expr.elements.map(e => infer(e, env));
      return { kind: "array", elementTypes, variadic: false };

    // ... etc
  }
}
```

### Literal Type Preservation

Literals infer to their literal type, not widened:

```typescript
function literalType(value: unknown, kind: LiteralKind): Type {
  switch (kind) {
    case "int":
      return { kind: "literal", value, baseType: "Int" };  // Type is 42, not Int
    case "float":
      return { kind: "literal", value, baseType: "Float" };
    case "string":
      return { kind: "literal", value, baseType: "String" };
    case "boolean":
      return { kind: "literal", value, baseType: "Boolean" };
    case "null":
      return { kind: "primitive", name: "Null" };
    case "undefined":
      return { kind: "primitive", name: "Undefined" };
  }
}
```

## Contextual Typing

Expected types flow **downward** into expressions.

```typescript
function typeCheck(expr: CoreExpr, expectedType: Type | undefined, env: TypeEnv): Type {
  // Special case: lambda with expected function type
  if (expectedType && expr.kind === "lambda" && expectedType.kind === "function") {
    return typeCheckLambdaWithContext(expr, expectedType, env);
  }

  // Special case: array/record with expected type
  if (expectedType && expr.kind === "array" && expectedType.kind === "array") {
    return typeCheckArrayWithContext(expr, expectedType, env);
  }
  if (expectedType && expr.kind === "record" && expectedType.kind === "record") {
    return typeCheckRecordWithContext(expr, expectedType, env);
  }

  // Default: infer, then check compatibility
  const inferredType = infer(expr, env);

  if (expectedType) {
    if (!isSubtype(inferredType, expectedType)) {
      throw new CompileError(
        `Type '${formatType(inferredType)}' is not assignable to '${formatType(expectedType)}'`
      );
    }
    return expectedType;  // Contextual type "wins" (widening effect)
  }

  return inferredType;
}

function typeCheckLambdaWithContext(
  expr: LambdaExpr,
  expectedType: FunctionType,
  env: TypeEnv
): Type {
  // Use expected param types for unannotated parameters
  const paramTypes = expr.params.map((p, i) => {
    if (p.typeAnnotation) {
      const annotated = evalTypeAnnotation(p.typeAnnotation, env);
      // Check annotation is compatible with expected
      if (!isSubtype(expectedType.params[i].type, annotated)) {
        throw new CompileError(`Parameter type mismatch`);
      }
      return annotated;
    }
    // No annotation - use expected type (contextual typing!)
    return expectedType.params[i].type;
  });

  const bodyEnv = env.extend(expr.params.map((p, i) => [p.name, paramTypes[i]]));
  const returnType = typeCheck(expr.body, expectedType.returnType, bodyEnv);

  return { kind: "function", params: paramTypes, returnType, async: expr.async };
}
```

## Generic Instantiation

When calling a generic function, type parameters are instantiated.

### Desugared Form

Remember: `<T>(x: T)` desugars to `(x: T, T: Type = typeOf(x))`

### At Call Site

```typescript
function inferCallResultType(fnType: FunctionType, argTypes: Type[]): Type {
  // Check if this is a generic function (has Type parameters at the end)
  const typeParams = getTypeParameters(fnType);

  if (typeParams.length > 0) {
    // Separate value args from type args
    const valueArgCount = fnType.params.length - typeParams.length;
    const valueArgTypes = argTypes.slice(0, valueArgCount);
    const explicitTypeArgs = argTypes.slice(valueArgCount);

    // Infer missing type args from defaults
    const typeArgs = typeParams.map((param, i) => {
      if (i < explicitTypeArgs.length) {
        return explicitTypeArgs[i];  // Explicitly provided
      }
      // Use default (e.g., typeOf(x))
      return evalTypeParamDefault(param.default, valueArgTypes);
    });

    // Substitute type args into return type
    return substituteTypeVars(fnType.returnType, typeParams, typeArgs);
  }

  return fnType.returnType;
}
```

## Expr<T> Capture

When a parameter has type `Expr<T>`, capture AST instead of evaluating.

```typescript
function typeCheckCall(call: CallExpr, fnType: FunctionType, env: TypeEnv): Type {
  const typedArgs: TypedExpr[] = [];

  for (let i = 0; i < call.args.length; i++) {
    const paramType = fnType.params[i].type;
    const arg = call.args[i];

    if (isExprType(paramType)) {
      // Expr<T> parameter - capture AST, don't evaluate
      const innerType = getExprInnerType(paramType);  // The T in Expr<T>
      const argType = typeCheck(arg, innerType, env);

      typedArgs.push({
        ...arg,
        type: argType,
        captureAsExpr: true  // Mark for special handling
      });
    } else {
      // Normal parameter
      const argType = typeCheck(arg, paramType, env);
      typedArgs.push({ ...arg, type: argType });
    }
  }

  return { ...call, args: typedArgs, type: fnType.returnType };
}
```

**OPEN QUESTION:** How do we represent captured AST at comptime?
- Option A: Use the TypedAST directly as the Expr value
- Option B: Convert to a separate ExprValue representation
- Option C: Use the CoreAST with type annotations attached

Current thinking: Option A - TypedAST is already the right shape, just mark it as captured.

## Subtype Checking

Structural subtyping for records, literal subtypes of primitives, etc.

```typescript
function isSubtype(sub: Type, sup: Type): boolean {
  // Same type
  if (typesEqual(sub, sup)) return true;

  // Never is subtype of everything
  if (sub.kind === "primitive" && sub.name === "Never") return true;

  // Everything is subtype of Unknown
  if (sup.kind === "primitive" && sup.name === "Unknown") return true;

  // Literal subtype of primitive
  if (sub.kind === "literal" && sup.kind === "primitive") {
    return sub.baseType === sup.name ||
           (sub.baseType === "Int" && sup.name === "Number") ||
           (sub.baseType === "Float" && sup.name === "Number");
  }

  // Int/Float subtype of Number
  if (sub.kind === "primitive" && sup.kind === "primitive") {
    if (sup.name === "Number" && (sub.name === "Int" || sub.name === "Float")) {
      return true;
    }
  }

  // Record subtyping (structural)
  if (sub.kind === "record" && sup.kind === "record") {
    return isRecordSubtype(sub, sup);
  }

  // Array subtyping
  if (sub.kind === "array" && sup.kind === "array") {
    return isArraySubtype(sub, sup);
  }

  // Function subtyping (contravariant params, covariant return)
  if (sub.kind === "function" && sup.kind === "function") {
    return isFunctionSubtype(sub, sup);
  }

  // Union: sub is subtype if ALL variants are subtypes
  if (sub.kind === "union") {
    return sub.types.every(t => isSubtype(t, sup));
  }

  // Union: sup is supertype if sub is subtype of ANY variant
  if (sup.kind === "union") {
    return sup.types.some(t => isSubtype(sub, t));
  }

  // Branded types: must match exactly
  if (sub.kind === "branded" || sup.kind === "branded") {
    return sub.kind === "branded" && sup.kind === "branded" &&
           sub.brand === sup.brand && typesEqual(sub.baseType, sup.baseType);
  }

  return false;
}

function isRecordSubtype(sub: RecordType, sup: RecordType): boolean {
  // Sub must have all fields of sup
  for (const supField of sup.fields) {
    const subField = sub.fields.find(f => f.name === supField.name);
    if (!subField) {
      if (!supField.optional) return false;  // Missing required field
      continue;
    }
    if (!isSubtype(subField.type, supField.type)) return false;
    if (supField.optional && !subField.optional) {
      // OK: sub has required, sup has optional
    }
    if (!supField.optional && subField.optional) {
      return false;  // Sub has optional, sup requires it
    }
  }

  // Check closed record constraints
  if (sup.closed) {
    // Sub cannot have extra fields
    for (const subField of sub.fields) {
      if (!sup.fields.some(f => f.name === subField.name)) {
        return false;
      }
    }
  }

  return true;
}
```

## Pattern Matching Exhaustiveness

Check that match expressions cover all cases.

```typescript
function checkExhaustiveness(matchExpr: MatchExpr, env: TypeEnv): void {
  const exprType = matchExpr.expr.type;
  const patterns = matchExpr.cases.map(c => c.pattern);

  const uncovered = findUncoveredCases(exprType, patterns);

  if (uncovered.length > 0) {
    throw new CompileError(
      `Pattern matching not exhaustive. Missing cases: ${uncovered.map(formatType).join(", ")}`,
      matchExpr.loc
    );
  }
}

function findUncoveredCases(type: Type, patterns: Pattern[]): Type[] {
  // If any pattern is wildcard, everything is covered
  if (patterns.some(p => p.kind === "wildcard")) {
    return [];
  }

  // For union types, check each variant
  if (type.kind === "union") {
    const uncovered: Type[] = [];
    for (const variant of type.types) {
      if (!patterns.some(p => patternCovers(p, variant))) {
        uncovered.push(variant);
      }
    }
    return uncovered;
  }

  // For literal unions (e.g., "a" | "b" | "c")
  // Check each literal is covered

  // For other types, check if any pattern covers
  if (!patterns.some(p => patternCovers(p, type))) {
    return [type];
  }

  return [];
}
```

**OPEN QUESTION:** How sophisticated should exhaustiveness checking be?
- Basic: Just check union variants and literal patterns
- Advanced: Track nested patterns, guards, overlapping patterns
- Full: Compute exact coverage (complex, may be slow)

Current thinking: Start with basic for v1, enhance later.

## Error Handling

### Error Types

```typescript
type TypeError = {
  kind: "type-mismatch" | "not-callable" | "missing-property" |
        "not-comptime" | "comptime-escape" | "fuel-exhausted" |
        "non-exhaustive" | "inference-failed";
  message: string;
  loc: SourceLocation;
  notes?: { message: string; loc: SourceLocation }[];
};
```

### Error Recovery

**OPEN QUESTION:** How much error recovery should we do?
- Option A: Fail on first error
- Option B: Continue with "error" type, collect multiple errors
- Option C: Try to infer "best guess" type and continue

Current thinking: Option B for v1 - collect errors but don't guess.

## Open Questions Summary

| Question | Options | Current Thinking |
|----------|---------|------------------|
| Comptime propagation | Eager / Lazy / Hybrid | Lazy (evaluate on demand) |
| Escape analysis | Conservative / Track comptime fns / Infer | Conservative for v1 |
| Fuel limit default | Low / High / Configurable | 10,000, configurable |
| Expr<T> representation | TypedAST / ExprValue / CoreAST+types | TypedAST directly |
| Exhaustiveness depth | Basic / Advanced / Full | Basic for v1 |
| Error recovery | Fail first / Collect errors / Guess | Collect errors |

## Component Interactions

```
┌─────────────────────────────────────────────────────────────────┐
│                    TypeCheck + ComptimeEval                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Type       │◄──►│   Comptime   │◄──►│   Comptime   │       │
│  │   Checker    │    │   Evaluator  │    │   Env        │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Subtype    │    │   Type       │    │   Escape     │       │
│  │   Checker    │    │   Properties │    │   Analysis   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                       │               │
│         ▼                                       ▼               │
│  ┌──────────────┐                       ┌──────────────┐        │
│  │ Exhaustiveness│                       │   Error      │       │
│  │   Checker    │                       │   Collector  │        │
│  └──────────────┘                       └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

## Testing Strategy

- Unit tests for subtype checking with many edge cases
- Unit tests for comptime evaluation of Type properties
- Integration tests with small programs covering:
  - Basic type inference
  - Contextual typing
  - Generic instantiation
  - Comptime evaluation
  - Escape analysis errors
  - Exhaustiveness checking
- Fuel limit tests (infinite loops should fail gracefully)