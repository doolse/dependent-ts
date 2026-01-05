# Type System Specification

## Types as First-Class Values

Types in DepJS are first-class values that can be passed around, stored in variables, and manipulated. However, types are **opaque** - you cannot inspect their internal structure directly, only through built-in properties.

```
type Person = { name: String, age: Int };

// Types can be assigned to variables
const T = Person;

// Types can be passed to functions
const logTypeName = (T) => console.log(T.name);
logTypeName(Person);  // "Person"
```

## Type Properties

Types expose information through properties rather than functions. Some properties return runtime-usable values (strings, booleans), others return types (comptime only).

### Properties on All Types

```
String.name          // "String" - runtime usable
Person.name          // "Person" - runtime usable (undefined for anonymous types)
```

### Properties on Record Types

```
type Person = { name: String, age: Int };

Person.fieldNames    // ["name", "age"] - runtime usable (string[])
Person.fields        // { name: { type: String }, age: { type: Int } } - contains types, comptime only
Person.fields.name.type       // String - comptime only
Person.fields.name.type.name  // "String" - runtime usable
```

### Properties on Union Types

```
type Result = { tag: "ok", value: Int } | { tag: "err", message: String };

Result.tags          // ["ok", "err"] - runtime usable (string[])
Result.variants      // array of variant types - comptime only
```

### Anonymous Types

Anonymous types have `undefined` for their `.name` property:

```
const x: { a: Int } = { a: 1 };
typeOf(x).name       // undefined
typeOf(x).fieldNames // ["a"]
```

## Compile-Time Execution

### Demand-Driven Evaluation

Certain positions implicitly require compile-time evaluation. The compiler propagates these requirements backwards through the dependency graph.

**Positions that demand comptime:**
- Type annotations: `const x: expr = ...` - `expr` must be comptime
- Type definitions: `type T = expr` - `expr` must be comptime
- Assertions: `assert expr` - `expr` must be comptime-evaluable
- Type properties that return types: accessing `.fields` requires the type to be comptime

```
type Person = computeType(schema);  // computeType must be evaluable at compile time
const x: Person = { ... };          // Person must be known at compile time
```

### Explicit `comptime` Keyword

Programmers can explicitly require compile-time evaluation:

```
comptime const config = loadConfig("./config.json");
const timeout = config.timeout;  // timeout is also comptime (propagates)
```

If a `comptime` binding cannot be evaluated at compile time, it's a compile error (not a silent runtime fallback).

### Fuel-Based Interpreter

Compile-time evaluation uses a fuel-based interpreter with a maximum evaluation count. This prevents infinite loops from hanging compilation.

```
// This will exhaust fuel and produce a compile error
const loop = (x) => loop(x);
type Bad = loop(1);  // Error: compile-time evaluation exceeded fuel limit
```

## Type Introspection

### `typeOf(x)`

Returns the compile-time type of an expression. Note: this is different from JavaScript's `typeof` operator.

```
const x = 5;
typeOf(x)           // Int
typeOf(x).name      // "Int"

// typeof is reserved for JavaScript's runtime behavior
typeof x            // "number" (JavaScript semantics)
```

## Type Inference and Call-Site Instantiation

### How Type Inference Works with First-Class Types

Type-checking and compile-time evaluation are **interleaved on demand**, not separate passes. The key insight is that type-checking an expression doesn't require knowing its computed value — only its type.

```
const T = computeType(schema);  // Type-check: computeType returns Type
const x: T = { ... };           // NOW evaluate T to get the concrete type
```

The order is:
1. Type-check `computeType(schema)` → infer it returns `Type`
2. When `T` is used in a type position, **evaluate** it to get the concrete type
3. Check `{ ... }` against that concrete type

### Call-Site Instantiation

Polymorphic functions have their type parameters instantiated at each call site:

```
const getFields = (x) => {
  const T = typeOf(x);
  const prop = x.prop;    // constrains T <: { prop: unknown }
  return T.fields;
};

// Call site 1: T instantiated to { prop: Int, other: Int }
getFields({ prop: 1, other: 2 });  // returns fields for { prop: Int, other: Int }

// Call site 2: T instantiated to { prop: String, name: String }
getFields({ prop: "hi", name: "bob" });  // returns fields for { prop: String, name: String }
```

The function is implicitly polymorphic:
```
getFields : <T extends { prop: unknown }>(x: T) => Array<FieldInfo>
```

### Type Properties Have Fixed Types

A critical simplification: type introspection properties return **fixed types**, not dependent types.

```
T.fields      // Always Array<FieldInfo>, regardless of T
T.fieldNames  // Always Array<String>, regardless of T
T.name        // Always String | undefined, regardless of T
```

The **values** depend on T, but the **types** are known statically. This means functions using type introspection don't need dependent return types:

```
const getFields = (x) => typeOf(x).fields;
// Type: <T>(x: T) => Array<FieldInfo>
// NOT: <T>(x: T) => DependentOn<T>  (not needed!)
```

Compile-time evaluation of `T.fields` happens after T is instantiated at the call site, but the type checker knows the return type is `Array<FieldInfo>` without needing to evaluate anything.

### FieldInfo Type

Type field information is represented as:

```
interface FieldInfo {
  name: String;
  type: Type;
}
```

Accessing `field.name` returns `String` (runtime-usable), accessing `field.type` returns `Type` (comptime-only).

## Structural Subtyping

DepJS uses structural subtyping for record types:

```
type Point2D = { x: Int, y: Int };
type Point3D = { x: Int, y: Int, z: Int };

const p3: Point3D = { x: 1, y: 2, z: 3 };
const p2: Point2D = p3;  // OK: Point3D has all fields of Point2D
```

## Refinement Types (Work in Progress)

Refinement types constrain values with predicates:

```
type PosInt = Int where this > 0;
type NonEmpty<T> = Array<T> where this.length > 0;
```

**Open questions:**
- Syntax: `where` clause vs other options
- When should refinements be checked (compile-time vs runtime)?
- Need explicit control: if marked `comptime`, must not silently fall back to runtime
- What predicates can be proven at compile time?
- Subtyping rules: when does `A where p1` subtype `A where p2`?

TODO: Full refinement type design pending further discussion.