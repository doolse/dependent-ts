# Type System Specification

## Types as First-Class Values

Types in DepJS are first-class values that can be passed around, stored in variables, and manipulated at compile time. However, types are **opaque** - you cannot inspect their internal structure directly, only through built-in properties.

**Important:** `Type` values have no runtime representation. They exist only at compile time. To use type information at runtime, you must extract runtime-usable properties (like `.name` or `.fieldNames`) at compile time.

```
type Person = { name: String, age: Int };

// Types can be assigned to variables
const T = Person;

// Types can be passed to functions
const logTypeName = (T) => console.log(T.name);
logTypeName(Person);  // "Person"
```

## Type Syntax as Sugar

Type syntax is sugar for function calls on Type values. There is no separate "type-level language" - just expressions that evaluate to `Type` values with convenient syntax.

### Type Contexts

Certain syntactic positions trigger "type syntax" interpretation:

1. **Type definitions:** `type Foo = <type-expr>`
2. **Type annotations:** `const x: <type-expr>` or `(x: <type-expr>) =>`
3. **Generic parameters:** `<T, U>` in definitions
4. **Generic arguments:** `Array<String>` in type application

### Desugaring Rules

Within type contexts, the following sugar applies:

| Type Syntax | Desugars To |
|-------------|-------------|
| `A \| B` | `Union(A, B)` |
| `A & B` | `Intersection(A, B)` |
| `{ name: String }` | `RecordType({ name: String })` |
| `(x: A) => B` | `FunctionType([A], B)` |
| `Array<T>` | `Array(T)` |
| `type Foo = expr` | `const Foo: Type = expr` |

### Built-in Type Constructors

These are built-in functions that construct Type values:

```
// Primitive types are Type values
const String: Type;
const Int: Type;
const Boolean: Type;
const Null: Type;
const Undefined: Type;

// Type constructors
const RecordType: (fields: { [key: String]: Type }) => Type;
const Union: (...types: Array<Type>) => Type;
const Intersection: (...types: Array<Type>) => Type;
const FunctionType: (params: Array<Type>, returnType: Type) => Type;

// Parameterized types are functions
const Array: (elementType: Type) => Type;
```

### Equivalence Examples

These pairs are equivalent:

```
// Sugar:
type Person = { name: String, age: Int };

// Explicit:
const Person: Type = RecordType({ name: String, age: Int });
```

```
// Sugar:
type StringOrInt = String | Int;

// Explicit:
const StringOrInt: Type = Union(String, Int);
```

```
// Sugar:
type Result<T, E> = { kind: "ok", value: T } | { kind: "err", error: E };

// Explicit:
const Result = (T: Type, E: Type): Type =>
  Union(
    RecordType({ kind: "ok", value: T }),
    RecordType({ kind: "err", error: E })
  );
```

### Mixing Sugar and Explicit Forms

You can use explicit type constructors anywhere, including in type contexts:

```
// Use sugar for definition, explicit for manipulation
type Person = { name: String, age: Int };

const Nullable = (T: Type): Type => Union(T, Null);

// These are equivalent:
type MaybePerson = Nullable(Person);
type MaybePerson2 = Person | Null;
```

### Generics as Type Parameters with Defaults

Generic type parameters desugar to **Type parameters at the end of the argument list** with default values that express inference:

```
// Sugar:
const identity = <T>(x: T): T => x;

// Desugars to:
const identity = (x: T, T: Type = typeOf(x)): T => x;
```

**Key insight:** Type parameters come LAST, after value parameters. This makes inference unambiguous:

```
identity("hello");          // x = "hello", T inferred as String
identity("hello", String);  // x = "hello", T explicitly String
```

If type params came first, `identity("hello")` would be ambiguous - is "hello" the type or the value?

### How It Works

Arguments are treated as a group, so:
- `x: T` - T is in scope as a type parameter for the annotation
- `T: Type = typeOf(x)` - T's default references the call-site value of x

```
// Multiple type parameters
const pair = (
  a: T,
  b: U,
  T: Type = typeOf(a),
  U: Type = typeOf(b)
) => { fst: a, snd: b };

pair(1, "hello");  // T=Int, U=String (both inferred)

// With array/function types - need type properties
const map = (
  arr: Array<A>,
  f: (a: A) => B,
  A: Type = typeOf(arr).elementType,
  B: Type = typeOf(f).returnType
): Array<B> => arr.map(f);

map([1,2,3], x => x.toString());  // A=Int, B=String
```

### Partial Inference

Unlike TypeScript where you must provide all type arguments or none, this model supports **partial inference**:

```
const foo = (
  x: T,
  y: U,
  T: Type = typeOf(x),
  U: Type = typeOf(y)
) => ...;

// All inferred
foo(1, "hello");  // T=Int, U=String

// Partially explicit - provide T, infer U
foo(1, "hello", Number);  // T=Number, U=String (inferred)

// All explicit
foo(1, "hello", Number, String);
```

Since type parameters are just optional arguments with defaults, you can provide any prefix and let the rest be inferred.

### Sugar Desugaring

| Sugar | Desugars To |
|-------|-------------|
| `<T>(x: T) => x` | `(x: T, T: Type = typeOf(x)) => x` |
| `<T, U>(x: T, y: U)` | `(x: T, y: U, T: Type = typeOf(x), U: Type = typeOf(y))` |
| `<T extends Foo>(x: T)` | TODO: Constraints need design |

### Call-Site Type Argument Sugar

When calling a generic function, angle bracket syntax is sugar for passing type arguments at the end:

```
// These are equivalent:
identity<String>("hello");
identity("hello", String);

// With multiple type args:
pair<Int, String>(1, "hello");
pair(1, "hello", Int, String);

// Partial application - provide first type, infer second:
pair<Int>(1, "hello");
pair(1, "hello", Int);  // U inferred as String
```

This maintains familiar TypeScript-style call syntax while desugaring to the type-params-at-end model.

### Open Questions

- **Constraints**: How does `<T extends Foo>` desugar? Perhaps `T: Type = typeOf(x) & Foo` or a separate constraint mechanism?
- **Type properties needed**: `typeOf(x).elementType`, `typeOf(f).returnType`, etc.

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
type Result = { kind: "ok", value: Int } | { kind: "err", message: String };

Result.variants      // array of variant types - comptime only
```

TODO: How does the compiler identify the discriminant property? TypeScript allows any property with literal types. Need to decide how to expose discriminant values (previously `.tags` was suggested but this assumed a specific property name).

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

### Comptime-Only Code Cannot Escape to Runtime

Code that uses comptime-only operations (like `.fields` or `.variants`) can only be evaluated at compile time. If such code would need to run at runtime, it's a compile error:

```
// This is fine - fully evaluated at compile time
const personFields = Person.fields;  // comptime const

// This is an error - closure would escape to runtime
const makeGetter = (x) => {
  const T = typeOf(x);
  return () => T.fields;  // ERROR: comptime-only code cannot exist at runtime
};
const getter = makeGetter({ a: 1 });
someRuntimeArray.push(getter);  // getter escapes to runtime context
```

If the compiler can fully evaluate the closure at compile time (i.e., it never escapes), it's allowed. The error only occurs when comptime-only code would need to exist at runtime.

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

### `typeOf` Uses Declared Type

When a value has an explicit type annotation, `typeOf` returns the **declared type**, not the structural type of the initializer:

```
const wide = { a: 1, b: 2 };           // Type: { a: Int, b: Int }
const narrow: { a: Int } = wide;       // Type: { a: Int }

typeOf(wide).fieldNames;    // ["a", "b"]
typeOf(narrow).fieldNames;  // ["a"] - uses declared type, not actual value's type
```

This matches standard type system behavior - the annotation is a deliberate choice to view the value through a narrower lens.

### No Automatic Type Narrowing

Checking type properties does **not** narrow the original value's type:

```
const func = (x) => {
  const T = typeOf(x);
  if (T.name === "Int") {
    return x + 1;  // ERROR: x is still unknown type, not narrowed to Int
  }
  return x;
};
```

For type-based dispatch, use pattern matching instead:

```
const func = (x) => match (x) {
  case Int: x + 1;
  case _: x;
};
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
type FieldInfo = {
  name: String;
  type: Type;
};
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