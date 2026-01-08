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

### `<>` vs `()` for Function Calls

The key to disambiguation between type syntax and expression syntax is the choice of brackets for function/constructor calls:

- **`f<args>`** — arguments are parsed with **type syntax** (sugar applies)
- **`f(args)`** — arguments are parsed with **expression syntax** (no sugar)
- **`f<typeArgs>(valueArgs)`** — type syntax for type args, expression syntax for value args

This applies to **any function**, not just type constructors. Using `<>` triggers type syntax for the arguments.

**Examples:**
```
Array<Int>                  // Int is in type syntax (trivially the same)
Array<{ a: Int }>           // { a: Int } is a record TYPE
Array({ a: Int })           // { a: Int } is a record LITERAL - type error!

Union<{ a: Int }, { b: Int }>  // Both are record types
Union(A, B)                    // A and B are expressions (must be Type values)

// Passing inline record types to any function
processType<{ name: String }>;  // Works - type syntax
type T = { name: String };
processType(T);                 // Also works - T is a Type value
```

### Type Contexts

Type syntax is triggered in these positions:

1. **Type definitions:** `type Foo = <type-expr>`
2. **Type annotations:** `const x: <type-expr>` or `(x: <type-expr>) =>`
3. **Generic parameters:** `<T, U>` in definitions
4. **Angle bracket arguments:** `f<args>` — arguments inside `<>`

### Desugaring Rules

Within type syntax, the following sugar applies:

| Type Syntax | Desugars To |
|-------------|-------------|
| `A \| B` | `Union<A, B>` |
| `A & B` | `Intersection<A, B>` |
| `{ name: String }` | `RecordType([{ name: "name", type: String, optional: false }])` |
| `{ name?: String }` | `RecordType([{ name: "name", type: String, optional: true }])` |
| `{\| name: String \|}` | `RecordType([{ name: "name", type: String, optional: false }], Never)` |
| `{ [key: String]: Int }` | `RecordType([], Int)` |
| `(x: A) => B` | `FunctionType<[A], B>` |
| `type Foo = expr` | `const Foo: Type = expr` |

Note: `RecordType` uses `()` because it takes `Array<FieldInfo>` (value), not `Type` arguments.

### Operators in Expression Context

In expression syntax, `|` and `&` are **bitwise operators** (matching JavaScript):

```
// Type syntax - union/intersection
type X = Int | String;        // Union<Int, String>
type Y = Foo & Bar;           // Intersection<Foo, Bar>

// Expression syntax - bitwise
const a = 5 | 3;              // bitwise OR = 7
const b = 5 & 3;              // bitwise AND = 1
const c = 5 ^ 3;              // bitwise XOR = 6
const d = ~5;                 // bitwise NOT

// Creating unions in expression context - use function call
const Z = Union(Int, String);       // () with Type values
const W = Union<Int, String>;       // <> with type syntax
const V = Intersection(Foo, Bar);   // () with Type values
```

This matches JavaScript semantics and provides a clear mental model: the meaning of `|` and `&` depends on context.

**Record syntax:**
- `{ ... }` — Open record (extra fields allowed)
- `{| ... |}` — Closed record (no extra fields allowed)
- `{ [key: String]: T }` — Indexed record (any string key maps to T)

### Literal Types

Literal values can be used as types. A literal type matches only that exact value.

**String literals:**
```
type Yes = "yes";
type No = "no";
type Answer = "yes" | "no";

const a: "yes" = "yes";   // OK
const b: "yes" = "no";    // ERROR: "no" is not assignable to "yes"
```

**Number literals:**
```
type Zero = 0;
type One = 1;
type Bit = 0 | 1;
```

**Boolean literals:**
```
type True = true;
type False = false;
```

Literal types are essential for discriminated unions and type-safe APIs:

```
type Result<T, E> =
  | { kind: "ok", value: T }
  | { kind: "err", error: E };
```

#### Properties on Literal Types

Literal types have a `.value` property that returns the literal value (comptime, but the value itself is runtime-usable):

```
const T: Type = "hello";
T.value        // "hello" (String)
T.name         // "\"hello\"" (the type name)

const N: Type = 42;
N.value        // 42 (Int)

const B: Type = true;
B.value        // true (Boolean)
```

This is useful for constructing types dynamically:

```
// Create a Record type from a union of string literals
const Record = (K: Type, V: Type): Type => {
  const fields = K.variants.map(k => ({
    name: k.value,  // extract the string from the literal type
    type: V,
    optional: false
  }));
  return RecordType(fields);
};

type Keys = "a" | "b" | "c";
type MyRecord = Record(Keys, Int);  // { a: Int, b: Int, c: Int }
```

### Built-in Type Constructors

These are built-in functions that construct Type values:

```
// Primitive types are Type values
const String: Type;
const Int: Type;
const Boolean: Type;
const Null: Type;
const Undefined: Type;
const Never: Type;

// Type constructors
const RecordType: (fields: Array<FieldInfo>, indexType?: Type) => Type;
const Union: (...types: Array<Type>) => Type;
const Intersection: (...types: Array<Type>) => Type;
const FunctionType: (params: Array<Type>, returnType: Type) => Type;

// Array type constructor (variadic)
const Array: (...elementTypes: Array<Type>) => Type;

// Branded/nominal types
const Branded: (baseType: Type, brand: String) => Type;

// Self-referential type for fluent interfaces
const This: Type;  // Special type, only valid within record type definitions
```

#### The `This` Type (Fluent Interfaces)

`This` is a special type that refers to the type of the receiver, enabling fluent method chaining that preserves subtypes.

**Basic usage:**
```
type Builder = {
  name: String;
  setName: (name: String) => This;
};

const builder: Builder = { name: "", setName: (name) => ({ ...builder, name }) };
builder.setName("Alice");  // returns Builder
```

**With subtypes:**
```
type Builder = {
  name: String;
  setName: (name: String) => This;
};

type AdvancedBuilder = Builder & {
  age: Int;
  setAge: (age: Int) => This;
};

const advanced: AdvancedBuilder = ...;

// setName's return type is This, substituted to AdvancedBuilder
advanced.setName("Alice").setAge(30);  // Works! Chaining preserves AdvancedBuilder
```

**How substitution works:**

When accessing a property on a value of type `T`, if the property's type contains `This`, replace `This` with `T`:

```
const x: AdvancedBuilder = ...;

// x.setName has declared type: (String) => This
// Receiver x has type: AdvancedBuilder
// After substitution: (String) => AdvancedBuilder
```

**Scope:**

`This` is lexically scoped to the innermost enclosing type definition:

```
type Outer = {
  inner: {
    foo: () => This;  // This refers to { foo: () => This }, not Outer
  };
  bar: () => This;    // This refers to Outer
};
```

**Valid positions:**

`This` can appear anywhere within a record type definition:

```
type Node = {
  clone: () => This;           // Method returning self
  parent: This | Undefined;    // Field of self type
  children: Array<This>;       // Collection of self type
};
```

**Constraints:**

- `This` is only valid within record type definitions
- Using `This` outside a type definition is a compile error
- `This` has no properties until substituted (accessing `This.name` is an error)

#### Branded Types (Nominal Typing)

Branded types provide nominal typing within DepJS's structural type system. A branded type wraps a base type with a unique tag that must match for type compatibility.

**Type constructor:**
```
const Branded: (baseType: Type, brand: String) => Type;

type UserId = Branded(String, "UserId");
type OrderId = Branded(String, "OrderId");
```

**Syntax sugar (`newtype`):**
```
// Sugar:
newtype UserId = String;

// Desugars to:
const UserId: Type = Branded(String, "UserId");
```

The brand is implicitly the type name when using `newtype`.

**Properties on branded types:**
```
UserId.baseType    // String
UserId.brand       // "UserId"
```

**Subtyping rules (strict nominal):**
```
type UserId = Branded(String, "UserId");
type OrderId = Branded(String, "OrderId");

// All of these are type errors:
const a: String = userId;     // ERROR: Branded(String, "UserId") is not String
const b: UserId = "hello";    // ERROR: String is not Branded(String, "UserId")
const c: OrderId = userId;    // ERROR: brands don't match
```

**Wrapping and unwrapping:**
```
type UserId = Branded(String, "UserId");

// Wrap a value (compile-time only, zero runtime cost)
const id: UserId = UserId.wrap("abc123");

// Unwrap a value (compile-time only, zero runtime cost)
const str: String = UserId.unwrap(id);
```

`wrap` and `unwrap` are identity functions at runtime - they only exist for type checking.

**Use cases:**
```
// Prevent mixing up IDs
newtype UserId = String;
newtype OrderId = String;

const getUser = (id: UserId) => ...;
const getOrder = (id: OrderId) => ...;

getUser(orderId);  // ERROR: OrderId is not UserId

// Type-safe units
newtype Meters = Number;
newtype Feet = Number;

const distance: Meters = Meters.wrap(100);
const height: Feet = Feet.wrap(6);

distance + height;  // ERROR: can't add Meters and Feet
```

#### RecordType and Openness

The `indexType` parameter controls record openness:

- **`indexType: undefined`** (default) — **Open record**: extra fields allowed (TypeScript behavior)
- **`indexType: SomeType`** — **Indexed record**: any string key maps to `SomeType`
- **`indexType: Never`** — **Closed record**: no extra fields allowed

```
// Open record (default) - allows extra fields
RecordType([
  { name: "id", type: Int, optional: false }
])

// Indexed record - any string key maps to Int
RecordType([], Int)

// Closed record - no extra fields allowed
RecordType([
  { name: "id", type: Int, optional: false }
], Never)
```

### Equivalence Examples

These pairs are equivalent:

```
// Sugar (type syntax):
type Person = { name: String, age: Int };

// Explicit (expression syntax):
const Person: Type = RecordType([
  { name: "name", type: String, optional: false },
  { name: "age", type: Int, optional: false }
]);
```

```
// Sugar (type syntax):
type ClosedPerson = {| name: String, age: Int |};

// Explicit (expression syntax):
const ClosedPerson: Type = RecordType([
  { name: "name", type: String, optional: false },
  { name: "age", type: Int, optional: false }
], Never);
```

```
// Sugar (type syntax):
type Scores = { [key: String]: Int };

// Explicit (expression syntax):
const Scores: Type = RecordType([], Int);
```

```
// Sugar (type syntax):
type StringOrInt = String | Int;

// Explicit (expression syntax) - both forms work:
const StringOrInt: Type = Union<String, Int>;  // <> for type syntax
const StringOrInt: Type = Union(String, Int);  // () works too since String/Int are Type values
```

```
// Sugar (type syntax):
type Result<T, E> = { kind: "ok", value: T } | { kind: "err", error: E };

// Explicit (expression syntax):
const Result = (T: Type, E: Type): Type =>
  Union(
    RecordType([{ name: "kind", type: "ok", optional: false }, { name: "value", type: T, optional: false }]),
    RecordType([{ name: "kind", type: "err", optional: false }, { name: "error", type: E, optional: false }])
  );
```

**Key insight:** For simple type identifiers like `String`, `Int`, etc., both `<>` and `()` work identically because the identifier evaluates to the same Type value either way. The distinction matters for:
- Inline record types: `Union<{ a: Int }, { b: Int }>` vs `Union({ a: Int }, { b: Int })` (error!)
- Inline function types: `Array<(x: Int) => String>` vs `Array((x: Int) => String)` (arrow function!)
- Union/intersection sugar: `A | B` only works in type syntax

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
| `<T extends Foo>(x: T)` | `(x: T, T: Type<Foo> = typeOf(x)) => x` |

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

### Generic Constraints via Bounded Type

Generic constraints use `Type<Bound>` — a parameterized version of `Type` that represents types which are subtypes of `Bound`.

**The `Type<Bound>` type:**

- `Type<Bound>` is the type of all `Type` values that are subtypes of `Bound`
- `Type` (without parameter) is shorthand for `Type<Unknown>` — any type
- `Type<Foo> <: Type<Bar>` when `Foo <: Bar` (covariant in the bound)

**Constraint desugaring:**

```
// Sugar:
const logLength = <T extends { length: Int }>(x: T) => console.log(x.length);

// Desugars to:
const logLength = (x: T, T: Type<{ length: Int }> = typeOf(x)) => console.log(x.length);
```

**How it enables body usage:**

When `T: Type<Foo>`, the type checker knows that any value `x: T` has all the properties of `Foo`. This is what allows `x.length` in the example above — the constraint guarantees `T` has a `length` property.

**Consistency with other parameterized types:**

This follows the same pattern as other parameterized types:

```
Array<String>    // values that are arrays of strings
Type<Foo>        // values that are types subtyping Foo
```

**Examples:**

```
// Constrained generic function
const first = <T extends Array<Unknown>>(arr: T) => arr[0];
// Desugars to:
const first = (arr: T, T: Type<Array<Unknown>> = typeOf(arr)) => arr[0];

// Multiple constraints via intersection
const process = <T extends Serializable & Comparable>(x: T) => ...;
// Desugars to:
const process = (x: T, T: Type<Serializable & Comparable> = typeOf(x)) => ...;
```

**Validation:**

When a generic function is called, the type checker verifies that the inferred or provided type argument satisfies the bound:

```
logLength("hello");     // OK: String <: { length: Int }
logLength([1, 2, 3]);   // OK: Array<Int> <: { length: Int }
logLength(42);          // ERROR: Int is not a subtype of { length: Int }
```

## Type Properties

Types expose information through properties rather than functions. Some properties return runtime-usable values (strings, booleans), others return types (comptime only).

### Properties on All Types

```
String.name          // "String" - runtime usable
Person.name          // "Person" - runtime usable (undefined for anonymous types)
String.baseName      // "String" - runtime usable (same as .name for non-generic types)
String.typeArgs      // [] - runtime usable (empty for non-generic types)
```

### Properties on Instantiated Generic Types

When a parameterized type is instantiated (e.g., `Array(String)`), the result is a `Type` with:

- `.name` - The full instantiated name (e.g., `"Array<String>"`)
- `.baseName` - The base type constructor name (e.g., `"Array"`)
- `.typeArgs` - Array of type arguments (comptime only, since it contains `Type` values)

```
Array(String).name             // "Array<String>"
Array(String).baseName         // "Array"
Array(String).typeArgs         // [String] - comptime only

Map(String, Int).name          // "Map<String, Int>"
Map(String, Int).baseName      // "Map"
Map(String, Int).typeArgs      // [String, Int] - comptime only
```

Additionally, instantiated types have **type-specific convenience properties**:

```
Array(String).elementType      // String (equivalent to .typeArgs[0])

Map(String, Int).keyType       // String (equivalent to .typeArgs[0])
Map(String, Int).valueType     // Int (equivalent to .typeArgs[1])
```

These convenience properties are defined by each parameterized type and provide semantic meaning to the type arguments.

### Properties on Function Types

```
type Fn = (x: Int, y: String) => Boolean;

Fn.parameterTypes    // [Int, String] - comptime only (Array<Type>)
Fn.returnType        // Boolean - comptime only
```

These enable implementing TypeScript's utility types:

```
// TypeScript: type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never
const ReturnType = (T: Type): Type => T.returnType;

// TypeScript: type Parameters<T> = T extends (...args: infer P) => any ? P : never
const Parameters = (T: Type): Array<Type> => T.parameterTypes;
```

### Intersection of Function Types (Overloaded Functions)

When function types are intersected, the result represents an overloaded function. This is used for importing TypeScript overloaded functions from `.d.ts` files.

```
type Parse = ((String) => Number) & ((Number) => String);
```

**Call semantics (order-dependent, first match wins):**

At a call site, signatures are checked in order. The first signature where the argument types are subtypes of the parameter types determines the return type.

```
parse("hello")     // First signature matches → Number
parse(42)          // Second signature matches → String
```

If the argument is a union type, the return type is the union of all matching signatures' return types:

```
const x: String | Number = ...;
parse(x)           // Returns Number | String
```

**Properties on intersection of function types:**

```
type Parse = ((String) => Number) & ((Number) => String);

Parse.signatures              // Array<FunctionType> - ordered list of signatures
Parse.signatures[0].parameterTypes  // [String]
Parse.signatures[0].returnType      // Number

// These are ambiguous and produce errors:
Parse.parameterTypes          // Error: ambiguous for overloaded functions
Parse.returnType              // Error: ambiguous for overloaded functions
```

**Note:** DepJS does not have syntax to declare overloaded functions. This representation exists only for `.d.ts` import compatibility. In DepJS code, use pattern matching to achieve similar effects:

```
const parse = (value: String | Number) => match (value) {
  case String: parseInt(value);
  case Number: value.toString();
};
```

### Array Types

Arrays in DepJS have two syntactic forms that correspond to variable-length and fixed-length arrays. There is no separate "Tuple" type.

**Syntax:**

```
// Variable-length arrays (postfix [])
Int[]                   // Variable-length array of Int
String[]                // Variable-length array of String
(Int | String)[]        // Array of union type

// Fixed-length arrays (bracket syntax)
[Int]                   // Fixed 1-element array
[Int, String]           // Fixed 2-element array
[Int, String, Bool]     // Fixed 3-element array
[x: Int, y: Int]        // Fixed with labels
[Int, ...String]        // Int followed by any number of Strings
```

**Desugaring:**

Both syntaxes desugar to the `Array` type constructor:

```
Int[]           → Array(...Int)              // Variable-length
[Int, String]   → Array(Int, String)         // Fixed-length
[Int, ...String] → Array(Int, ...String)     // Mixed (variadic)
```

**Labeled Elements:**

Fixed-length arrays can have optional labels for documentation (like TypeScript tuple labels):

```
type Point = [x: Int, y: Int];  // labeled
type Pair = [Int, String];       // unlabeled

// Mixed labels allowed
type Mixed = [Int, name: String, Boolean];
```

**ArrayElementInfo type:**
```
type ArrayElementInfo = {
  type: Type;
  label: String | Undefined;
};
```

**Properties on Array Types:**

```
// Fixed-length array
type Point = [Int, Int];

Point.typeArgs      // [Int, Int] - comptime only
Point.elementType   // Int (union of all element types) - comptime only
Point.elements      // Array<ArrayElementInfo> - comptime only (fixed arrays only)
Point.length        // 2 - runtime usable (fixed arrays only)
Point.isFixed       // true - runtime usable

// Variable-length array
type Ints = Int[];

Ints.typeArgs       // [Int] - comptime only
Ints.elementType    // Int - comptime only
Ints.elements       // undefined (unknown length)
Ints.length         // undefined (unknown length)
Ints.isFixed        // false - runtime usable
```

**Indexed access:**
```
const point: [Int, String] = [1, "hello"];

point[0]            // type is Int (compile-time known index)
point[1]            // type is String

const i = computeIndex();
point[i]            // type is Int | String (elementType)

const arr: Int[] = [1, 2, 3];
arr[0]              // type is Int (same for any index)
```

**Subtyping:**

Fixed-length arrays are subtypes of variable-length arrays:

```
[Int, Int, Int] <: Int[]              // Fixed 3 <: variable
[Int, String] <: (Int | String)[]     // Heterogeneous fixed <: variable union
[1, 2, 3] <: [Int, Int, Int]          // Literal <: widened
[Int, Int] <: [Int, ...Int]           // Fixed 2 matches "1 or more"
```

This means fixed-length arrays can be passed where variable-length arrays are expected:

```
const sum = (numbers: Int[]) => numbers.reduce((a, b) => a + b, 0);

const triple: [Int, Int, Int] = [1, 2, 3];
sum(triple);  // OK - [Int, Int, Int] <: Int[]
```

**Variadic arrays:**

The `...` syntax allows expressing "fixed prefix followed by variable rest":

```
[Int, ...String]        // Int, then any number of Strings
[Int, String, ...Bool]  // Int, String, then any Bools
```

**Generic patterns:**

```
// Extract first element type
const first = <T>(arr: [T, ...]) => arr[0];
first([1, "hello", true]);  // T = Int, returns Int

// Require homogeneous variable-length array
const sum = <T>(arr: T[]) => arr.reduce((a, b) => a + b);
sum([1, 2, 3]);  // T = Int

// Head and tail pattern
const head = <H, ...T>(arr: [H, ...T]) => arr[0];
const tail = <H, ...T>(arr: [H, ...T]): [...T] => arr.slice(1);
```

**Runtime representation:** All arrays are JavaScript arrays at runtime. The fixed vs variable distinction is purely at the type level for compile-time checking.

### Array Literal Inference

When an array literal is written without a type annotation, the compiler infers a fixed-length array type with **widened element types**.

**Inference rules:**

```
const a = [1, 2, 3];        // [Int, Int, Int] (not [1, 2, 3])
const b = ["a", "b"];       // [String, String] (not ["a", "b"])
const c = [1, "hello"];     // [Int, String]
const d = [true, false];    // [Boolean, Boolean]
```

**Key decisions:**

1. **Length is preserved:** Array literals infer to fixed-length types, preserving the number of elements
2. **Literals are widened:** Numeric literals widen to `Int` or `Float`, string literals widen to `String`, boolean literals widen to `Boolean`
3. **Actual values available at comptime:** Even though the *type* is widened, the actual values are still known at compile time and can be accessed via `comptime`

**Rationale:**

Widening by default avoids the "too precise" problem where every array literal has a unique type. Since DepJS has `comptime`, you can always access actual values when needed:

```
const x = [1, 2, 3];  // Type: [Int, Int, Int]

// At comptime, actual values are still accessible
comptime {
  assert(x[0] == 1);    // Works - comptime knows the value
  assert(x.length == 3); // Works - length is known
}
```

**Explicit literal types:**

If you need literal types in an array, use explicit type annotation:

```
const status: ["pending", "active"] = ["pending", "active"];
```

**With type annotation widening:**

If you annotate with a variable-length type, the literal widens further:

```
const a: Int[] = [1, 2, 3];  // Type is Int[], length info lost
```

### Properties on Record Types

```
type Person = { name: String, age: Int };

Person.fieldNames    // ["name", "age"] - runtime usable
Person.fields        // Array<FieldInfo> - comptime only
Person.fields[0]     // { name: "name", type: String, optional: false }
Person.keysType      // "name" | "age" - comptime only (union of literal types)
Person.indexType     // undefined (open record)
```

The difference between `fieldNames` and `keysType`:
- `fieldNames` returns `Array<String>` - concrete values, runtime-usable
- `keysType` returns a union Type of string literals - comptime only, useful for type-safe APIs

```
type ClosedPerson = {| name: String |};

ClosedPerson.indexType   // Never (closed record)
```

```
type Scores = { [key: String]: Int };

Scores.fields        // [] (no named fields)
Scores.indexType     // Int (indexed record)
```

### Properties on Union Types

```
type Result = { kind: "ok", value: Int } | { kind: "err", message: String };

Result.variants      // array of variant types - comptime only
```

Discriminant identification is covered in the Pattern Matching section.

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
  optional: Boolean;
};
```

**Property availability:**
- `field.name` - `String` (runtime-usable)
- `field.type` - `Type` (comptime-only)
- `field.optional` - `Boolean` (runtime-usable)

**Example:**

```
type Person = {
  id: Int;
  name: String;
  nickname?: String;
};

Person.fields[0]  // { name: "id", type: Int, optional: false }
Person.fields[1]  // { name: "name", type: String, optional: false }
Person.fields[2]  // { name: "nickname", type: String, optional: true }
```

## Structural Subtyping

DepJS uses structural subtyping for record types:

```
type Point2D = { x: Int, y: Int };
type Point3D = { x: Int, y: Int, z: Int };

const p3: Point3D = { x: 1, y: 2, z: 3 };
const p2: Point2D = p3;  // OK: Point3D has all fields of Point2D
```

### Closed Records and Subtyping

Closed records (`{| ... |}`) do not allow extra fields, which affects subtyping:

```
type OpenPoint = { x: Int, y: Int };
type ClosedPoint = {| x: Int, y: Int |};

const p3 = { x: 1, y: 2, z: 3 };

const open: OpenPoint = p3;      // OK: open records allow extra fields
const closed: ClosedPoint = p3;  // ERROR: closed records forbid extra fields
```

A closed record is only a subtype of another closed record with the exact same fields.

### Subtype Checking with `.extends()`

Types have an `.extends()` method that checks subtype relationships at compile time:

```
T.extends(U)  // Returns Boolean - true if T is a subtype of U
```

This enables conditional type logic using standard ternary expressions:

```
// TypeScript: type NonNullable<T> = T extends null | undefined ? never : T
const NonNullable = (T: Type): Type =>
  T.extends(Union(Null, Undefined)) ? Never : T;

// TypeScript: type Extract<T, U> = T extends U ? T : never
const Extract = (T: Type, U: Type): Type =>
  T.extends(U) ? T : Never;

// TypeScript: type Exclude<T, U> = T extends U ? never : T
const Exclude = (T: Type, U: Type): Type =>
  T.extends(U) ? Never : T;
```

The `.extends()` method returns a compile-time Boolean, so it can only be used in comptime contexts.

## Mapped Types as Functions

TypeScript's mapped types become regular compile-time functions in DepJS. Since types are first-class values with inspectable properties, type transformations are just functions.

### Common Type Utilities

```
// Make all fields optional
const Partial = (T: Type): Type => {
  const newFields = T.fields.map(f => ({ ...f, optional: true }));
  return RecordType(newFields, T.indexType);
};

// Make all fields required
const Required = (T: Type): Type => {
  const newFields = T.fields.map(f => ({ ...f, optional: false }));
  return RecordType(newFields, T.indexType);
};

// Pick specific fields (type-safe: keys must be valid field names)
const Pick = (T: Type, keys: Array<T.keysType>): Type => {
  const newFields = T.fields.filter(f => keys.includes(f.name));
  return RecordType(newFields, T.indexType);
};

// Omit specific fields
const Omit = (T: Type, keys: Array<T.keysType>): Type => {
  const newFields = T.fields.filter(f => !keys.includes(f.name));
  return RecordType(newFields, T.indexType);
};
```

### Usage Examples

```
type Person = { name: String, age: Int, email?: String };

type PartialPerson = Partial(Person);
// equivalent to: { name?: String, age?: Int, email?: String }

type NameOnly = Pick(Person, ["name"]);
// equivalent to: { name: String }

type WithoutEmail = Omit(Person, ["email"]);
// equivalent to: { name: String, age: Int }
```

### Type-Safe Key Constraints

Using `T.keysType` ensures compile-time errors for invalid keys:

```
type Person = { name: String, age: Int };

Pick(Person, ["name"]);        // OK
Pick(Person, ["name", "foo"]); // ERROR: "foo" is not in "name" | "age"
```

### Composing Type Functions

Type functions compose naturally:

```
// Pick fields and make them optional
const PartialPick = (T: Type, keys: Array<T.keysType>): Type =>
  Partial(Pick(T, keys));

// Omit fields and close the record
const StrictOmit = (T: Type, keys: Array<T.keysType>): Type =>
  RecordType(Omit(T, keys).fields, Never);
```

## Pattern Matching

DepJS uses `match` expressions for type-safe pattern matching with exhaustiveness checking.

### Basic Syntax

```
match (expr) {
  case pattern: result;
  case pattern: result;
};
```

The `match` expression evaluates `expr`, tests each pattern in order, and returns the result of the first matching case. Cases are separated by semicolons.

### Pattern Types

#### Literal Patterns

Match exact values:

```
match (x) {
  case 1: "one";
  case 2: "two";
  case _: "other";
};
```

#### Type Patterns

Match by type, narrowing the variable:

```
match (x) {
  case Int: x + 1;       // x narrowed to Int in this branch
  case String: x.length; // x narrowed to String
  case _: 0;
};
```

#### Property Patterns (Discriminated Unions)

Match record structure and bind properties:

```
type Result =
  | { kind: "ok", value: Int }
  | { kind: "err", message: String };

match (result) {
  case { kind: "ok", value }: value * 2;      // binds 'value', type narrowed
  case { kind: "err", message }: log(message); // binds 'message'
};
```

#### Nested Patterns

Patterns can nest arbitrarily:

```
type Response = {
  status: "ok" | "error";
  data: { items: Array<Item> } | Undefined;
};

match (response) {
  case { status: "ok", data: { items } }: items.length;
  case { status: "ok", data: Undefined }: 0;
  case { status: "error" }: -1;
};
```

#### Wildcard Pattern

`_` matches anything and binds nothing:

```
match (x) {
  case 0: "zero";
  case _: "non-zero";
};
```

### Binding Syntax

**Implicit binding:** Property name becomes the variable name:

```
case { kind: "ok", value }: value + 1;  // 'value' bound
```

**Explicit binding (rename):** Use `property: bindingName` to rename:

```
case { kind: "ok", value: v }: v + 1;   // 'v' bound to the value property
```

**No binding:** Just match without binding using a literal or nested pattern:

```
case { kind: "ok" }: doSomething();     // matches but doesn't bind value
```

### Guards (`when` clause)

Add conditions to patterns with `when`:

```
match (x) {
  case Int when x > 0: "positive";
  case Int when x < 0: "negative";
  case Int: "zero";
};
```

Guards are evaluated after the pattern matches. If the guard is false, matching continues to the next case.

```
type User = { name: String, age: Int };

match (user) {
  case { age } when age >= 18: "adult";
  case { age } when age >= 13: "teenager";
  case _: "child";
};
```

### Type Narrowing

Inside a case body, the matched expression's type is narrowed based on the pattern:

```
const describe = (x: Int | String | Boolean) => match (x) {
  case Int: x.toString();     // x: Int here
  case String: x.toUpperCase(); // x: String here
  case Boolean: x ? "yes" : "no"; // x: Boolean here
};
```

For discriminated unions, the type narrows to the matching variant:

```
type Result<T, E> =
  | { kind: "ok", value: T }
  | { kind: "err", error: E };

const unwrap = <T, E>(r: Result<T, E>) => match (r) {
  case { kind: "ok", value }: value;  // r: { kind: "ok", value: T }
  case { kind: "err", error }: throw error;
};
```

### Exhaustiveness Checking

The compiler verifies all possible cases are handled:

```
type Status = "pending" | "active" | "done";

match (status) {
  case "pending": 0;
  case "active": 1;
};  // ERROR: Pattern matching not exhaustive - missing: "done"
```

**Wildcard satisfies exhaustiveness:**

```
match (status) {
  case "pending": 0;
  case _: 1;  // OK: covers "active" and "done"
};
```

**For discriminated unions:**

```
type Shape =
  | { kind: "circle", radius: Int }
  | { kind: "rect", width: Int, height: Int }
  | { kind: "point" };

match (shape) {
  case { kind: "circle", radius }: 3.14 * radius * radius;
  case { kind: "rect", width, height }: width * height;
};  // ERROR: Pattern matching not exhaustive - missing: { kind: "point" }
```

### Discriminant Identification

The compiler identifies discriminant properties using TypeScript's approach: any property whose type is a union of literals across variants.

```
type Event =
  | { type: "click", x: Int, y: Int }
  | { type: "keypress", key: String }
  | { type: "scroll", delta: Int };
```

Here `type` is identified as a discriminant because:
1. It exists in all variants
2. Each variant has a distinct literal type for it

Multiple discriminants are allowed:

```
type Message =
  | { channel: "email", format: "html", body: String }
  | { channel: "email", format: "text", body: String }
  | { channel: "sms", body: String };
```

Both `channel` and `format` can serve as discriminants (though `format` only discriminates within `channel: "email"`).

### Match Expression Returns a Value

`match` is an expression that returns a value. All branches must have compatible types:

```
const result: String = match (x) {
  case 1: "one";
  case 2: "two";
  case _: "other";
};
```

The return type is the union of all branch types (simplified if identical):

```
const mixed = match (x) {
  case Int: x;           // Int
  case String: x.length; // Int
};  // type: Int

const varied = match (x) {
  case Int: x;
  case String: x;
};  // type: Int | String
```

## Error Handling

DepJS supports exceptions for JavaScript interop, with a `Try` builtin to convert exceptions to values for functional-style error handling.

### `throw` Statement

Throws an exception (mirrors JavaScript):

```
throw Error("something went wrong");
throw "simple string error";  // JS allows any value
```

Exceptions propagate up the call stack until caught.

### `Try` Builtin

`Try` takes a thunk (zero-argument function) and catches any exception, returning a discriminated union:

```
const result = Try(() => JSON.parse(input));
// result: { ok: true, value: Json } | { ok: false, error: Error }
```

**Return type:**

```
type TryResult<T> = { ok: true, value: T } | { ok: false, error: Error };
```

The `ok` property is the discriminant:
- `ok: true` — the thunk succeeded, `value` contains the result
- `ok: false` — the thunk threw, `error` contains the caught exception

### Usage with Pattern Matching

```
match (Try(() => JSON.parse(input))) {
  case { ok: true, value }: processJson(value);
  case { ok: false, error }: log(error.message);
};
```

### Chaining Try Operations

```
const parseConfig = (path: String) => {
  const fileResult = Try(() => readFile(path));
  match (fileResult) {
    case { ok: false, error }: { ok: false, error };
    case { ok: true, value: content }: Try(() => JSON.parse(content));
  };
};
```

### Userland Result Type

For more expressive error handling, users can define their own Result type:

```
type Result<T, E> = { kind: "ok", value: T } | { kind: "err", error: E };

const Ok = <T>(value: T): Result<T, Never> => ({ kind: "ok", value });
const Err = <E>(error: E): Result<Never, E> => ({ kind: "err", error });

// Convert Try's output to Result
const tryToResult = <T>(tried: TryResult<T>): Result<T, Error> =>
  tried.ok ? Ok(tried.value) : Err(tried.error);

// Usage
const safeParseJson = (s: String): Result<Json, Error> =>
  tryToResult(Try(() => JSON.parse(s)));
```

### Design Rationale

- **Exceptions exist** because JavaScript has them — needed for interop
- **`Try` builtin** converts exceptions to values for functional composition
- **Result in userland** keeps the language simple; users can define Result types that fit their needs
- **No checked exceptions** — keep it simple, rely on explicit `Try` at boundaries

## Async/Await

DepJS supports async/await with direct 1:1 mapping to JavaScript output.

### Basic Syntax

```
const fetchUser = async (id: String): Promise<User> => {
  const response = await fetch(`/users/${id}`);
  return await response.json();
};
```

**Output (JavaScript):**
```javascript
const fetchUser = async (id) => {
  const response = await fetch(`/users/${id}`);
  return await response.json();
};
```

### The `async` Keyword

Functions that use `await` must be marked `async`:

```
// OK
const getData = async (): Promise<Data> => {
  const result = await fetchData();
  return result;
};

// ERROR: await used outside async function
const getData = (): Data => {
  const result = await fetchData();  // Error!
  return result;
};
```

### The `await` Keyword

`await` unwraps a `Promise<T>` to get the value `T`:

```
const promise: Promise<Int> = fetchNumber();
const value: Int = await promise;
```

The type checker ensures:
- `await` is only used on expressions of type `Promise<T>`
- The result type is `T`

### Return Type

Async functions return `Promise<T>`:

```
const fetchNumber = async (): Promise<Int> => {
  return 42;  // implicitly wrapped in Promise
};
```

### Promise Type

`Promise<T>` is a built-in parameterized type representing an async computation that will produce a value of type `T`.

```
Promise(String).name         // "Promise<String>"
Promise(String).elementType  // String (the resolved type)
```

### Top-Level Await

`await` is allowed at module top level:

```
// module.dep
const config = await loadConfig("./config.json");
export { config };
```

This outputs ES module top-level await (supported in modern JS).

### Async with Error Handling

`Try` works with async thunks:

```
// Catching async errors
const result = await Try(async () => {
  const response = await fetch(url);
  return await response.json();
});

match (result) {
  case { ok: true, value }: processData(value);
  case { ok: false, error }: log(error.message);
};
```

Note: `Try` with an async thunk returns `Promise<TryResult<T>>`, so you need to `await` the result.

### Promise Combinators

Standard Promise methods are available:

```
// Parallel execution
const results = await Promise.all([fetchA(), fetchB(), fetchC()]);

// Race
const first = await Promise.race([slow(), fast()]);

// Chaining (functional style alternative to await)
const result = fetchUser(id)
  .then(user => user.name)
  .then(name => name.toUpperCase());
```

### Design Rationale

- **1:1 JS mapping** — simple implementation, outputs JS async/await directly
- **Explicit `async` keyword** — clear which functions are async (no inference)
- **Top-level await** — supported for convenience, mirrors modern JS
- **`Try` integration** — existing error handling works with async code

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