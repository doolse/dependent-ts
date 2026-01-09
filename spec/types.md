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

// Type metadata wrapper
const WithMetadata: (baseType: Type, metadata: TypeMetadata) => Type;

// Self-referential type for fluent interfaces
const This: Type;  // Special type, only valid within record type definitions
```

#### WithMetadata and TypeMetadata

`WithMetadata` attaches metadata (name, type arguments, annotations) to a type. This is the underlying mechanism that powers parameterized type definitions and annotations.

**TypeMetadata type:**
```
type TypeMetadata = {
  name?: String;
  typeArgs?: Array<Type>;
  annotations?: Array<Unknown>;
};
```

**Basic usage:**
```
// Attaching a name to a type alias
const UserId: Type = WithMetadata(String, { name: "UserId" });
UserId.name  // "UserId"

// Parameterized type with typeArgs
const Container = (T: Type): Type => WithMetadata(
  RecordType([{ name: "value", type: T, optional: false }]),
  { name: "Container", typeArgs: [T] }
);
Container<String>.name      // "Container<String>"
Container<String>.baseName  // "Container"
Container<String>.typeArgs  // [String]

// With annotations
const DeprecatedUser: Type = WithMetadata(
  RecordType([{ name: "name", type: String, optional: false }]),
  { name: "DeprecatedUser", annotations: [Deprecated({ reason: "use User" })] }
);
DeprecatedUser.annotations  // [{ reason: "use User" }]
```

**Key property:** `WithMetadata` does not change type identity for subtyping purposes. A type with metadata is still structurally equivalent to the base type:

```
const AnnotatedString = WithMetadata(String, { annotations: [NonEmpty] });

// AnnotatedString is still assignable to/from String
const s: String = AnnotatedString.wrap("hello");  // ERROR - no wrap needed
const s: String = "hello";  // This works
const a: AnnotatedString = "hello";  // This also works - same underlying type
```

This contrasts with `Branded`, which *does* affect subtyping.

**Desugaring of `type` declarations:**

The `type` syntax desugars to functions using `WithMetadata`:

```
// Non-parameterized type alias
type UserId = String;
// desugars to:
const UserId: Type = WithMetadata(String, { name: "UserId" });

// Parameterized type
type Container<T> = { value: T };
// desugars to:
const Container = (T: Type): Type => WithMetadata(
  RecordType([{ name: "value", type: T, optional: false }]),
  { name: "Container", typeArgs: [T] }
);

// Type alias wrapping another parameterized type
type Wrapper<T> = Container<T>;
// desugars to:
const Wrapper = (T: Type): Type => WithMetadata(
  Container(T),
  { name: "Wrapper", typeArgs: [T] }
);

// With annotations
@Deprecated({ reason: "use NewContainer" })
type OldContainer<T> = { value: T };
// desugars to:
const OldContainer = (T: Type): Type => WithMetadata(
  RecordType([{ name: "value", type: T, optional: false }]),
  {
    name: "OldContainer",
    typeArgs: [T],
    annotations: [Deprecated({ reason: "use NewContainer" })]
  }
);

// With type parameter annotations
type Container<@Covariant T> = { value: T };
// desugars to:
const Container = (T: Type): Type => WithMetadata(
  RecordType([{ name: "value", type: T, optional: false }]),
  {
    name: "Container",
    typeArgs: [WithMetadata(T, { annotations: [Covariant] })]
  }
);

// Combined: type annotations + type parameter annotations
@Serializable
type Box<@Covariant T extends Showable> = { value: T };
// desugars to:
const Box = (T: Type<Showable>): Type => WithMetadata(
  RecordType([{ name: "value", type: T, optional: false }]),
  {
    name: "Box",
    typeArgs: [WithMetadata(T, { annotations: [Covariant] })],
    annotations: [Serializable]
  }
);
```

**Type parameter annotations** are accessed via the `typeArgs` entries:

```
Container<String>.typeArgs[0]              // String (structurally)
Container<String>.typeArgs[0].annotations  // [Covariant]
Container<String>.annotations              // [] (type-level annotations)

Box<Int>.typeArgs[0].annotations           // [Covariant]
Box<Int>.annotations                       // [Serializable]
```

The annotation describes how the type is *used in that parameter position*, not an intrinsic property of the type argument itself. Since `WithMetadata` doesn't affect subtyping, `Container<String>.typeArgs[0]` is still structurally equivalent to `String`.

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
identity("hello");          // x = "hello", T inferred as "hello"
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

pair(1, "hello");  // T=1, U="hello" (both inferred)

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

### Function Return Type Inference

Function return types are inferred from the function body using **flow-based (local) inference**. This means types are determined by analyzing the body forward, one expression at a time.

**Basic inference:**

```
const double = (x: Int) => x * 2;           // Return type inferred as Int
const greet = (name: String) => `Hi ${name}`; // Return type inferred as String
const pair = (a: Int, b: String) => [a, b]; // Return type inferred as [Int, String]
```

**Explicit return types are optional but allowed:**

```
const double = (x: Int): Int => x * 2;      // Explicit annotation
const greet = (name: String): String => `Hi ${name}`;
```

**Recursive functions require explicit return type annotations:**

```
// ERROR: Cannot infer return type of recursive function
const factorial = (n: Int) => n === 0 ? 1 : n * factorial(n - 1);

// OK: Return type explicitly annotated
const factorial = (n: Int): Int => n === 0 ? 1 : n * factorial(n - 1);
```

This is because flow-based inference analyzes the function body left-to-right. When it encounters the recursive call `factorial(n - 1)`, it doesn't yet know `factorial`'s return type—that's what we're trying to determine. With an explicit annotation, the type checker knows the return type before analyzing the body.

**Mutually recursive functions also require annotations:**

```
// Both need annotations
const isEven = (n: Int): Boolean => n === 0 ? true : isOdd(n - 1);
const isOdd = (n: Int): Boolean => n === 0 ? false : isEven(n - 1);
```

**Why flow-based inference (not Hindley-Milner)?**

DepJS uses flow-based inference rather than Hindley-Milner (HM) because:

1. **Subtyping compatibility**: HM with subtyping is notoriously complex. DepJS has structural subtyping for records, which doesn't mix well with HM's unification-based approach.

2. **Predictable errors**: Flow-based inference produces errors at the point of inconsistency. HM can report errors far from the actual problem, making debugging harder.

3. **TypeScript familiarity**: Flow-based inference matches TypeScript's behavior, making the language more approachable.

The trade-off is requiring annotations on recursive functions, which is a reasonable cost for these benefits.

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
pair(1, "hello", Int);  // U inferred as "hello"
```

This maintains familiar TypeScript-style call syntax while desugaring to the type-params-at-end model.

### Generic Type Inference

When a generic function is called without explicit type arguments, the type parameter is inferred from `typeOf(x)` — the **literal type** of the argument, not a widened type.

**Literal types are preserved in generic inference:**

```
const identity = <T>(x: T): T => x;

identity(42);        // T = 42 (literal type), returns type 42
identity("hello");   // T = "hello" (literal type), returns type "hello"
identity(true);      // T = true (literal type), returns type true
```

**Rationale:**

This follows from the desugaring and literal type preservation:
1. `<T>(x: T)` desugars to `(x: T, T: Type = typeOf(x))`
2. `const y = 42` has type `42` (literal preservation)
3. Therefore `typeOf(42)` returns `42`
4. So T defaults to `42`

**Structural subtyping handles assignment:**

```
const result = identity(42);  // result: 42
const n: Int = result;        // OK, 42 <: Int
const m: Number = result;     // OK, 42 <: Number
```

**Explicit type arguments can widen:**

```
identity<Int>(42);     // T = Int (explicit), returns type Int
identity(42, Int);     // Same, using desugared form
```

**With multiple type parameters:**

```
const pair = <T, U>(a: T, b: U) => { fst: a, snd: b };

pair(1, "hello");              // T = 1, U = "hello"
                               // Returns { fst: 1, snd: "hello" }

pair<Int, String>(1, "hello"); // T = Int, U = String (explicit)
                               // Returns { fst: Int, snd: String }
```

**Consistency with arrays and records:**

This is consistent with array and record literal inference:
- `[1, 2, 3]` has type `[1, 2, 3]` (literal preservation)
- `{ a: 1 }` has type `{ a: 1 }` (literal preservation)
- `identity(42)` returns type `42` (literal preservation)

All follow the same principle: preserve literal types, let structural subtyping handle widening when needed.

### Contextual Typing

Contextual typing allows the **expected type** of an expression to flow downward, helping infer types that couldn't otherwise be determined. DepJS supports full contextual typing.

**Lambda parameter inference:**

The most important use case — lambda parameters are inferred from expected function type:

```
const f: (x: Int) => Int = x => x + 1;
//                         ^-- x inferred as Int from annotation

// Without contextual typing, this would require redundant annotation:
const f: (x: Int) => Int = (x: Int) => x + 1;
```

**Callback parameters:**

When passing lambdas to functions, parameter types are inferred from the expected signature:

```
const nums: Int[] = [1, 2, 3];
nums.map(x => x + 1);       // x inferred as Int from Array<Int>.map signature
nums.filter(x => x > 0);    // x inferred as Int

// Higher-order functions
const apply = (f: (Int) => Int, x: Int) => f(x);
apply(n => n * 2, 5);       // n inferred as Int
```

**Array literals:**

Expected array type flows into elements:

```
const names: String[] = ["alice", "bob"];
// Elements contextually typed as String

// Useful for ensuring compatibility:
const coords: [Int, Int] = [x, y];
// x and y must be Int-compatible
```

**Record literals:**

Expected record type flows into field values:

```
type Config = { timeout: Int, retries: Int };
const cfg: Config = { timeout: 5000, retries: 3 };
// Field values contextually typed
```

**Interaction with literal preservation:**

Contextual typing provides an expected type, but literal types are still preserved when compatible:

```
const f: (x: Int) => Int = x => x + 1;
// x has type Int (from context), not a literal type

const arr: Int[] = [1, 2, 3];
// Array has type Int[] (from annotation), not [1, 2, 3]
// The annotation "wins" — this is explicit widening
```

When there's no annotation, literal types are preserved:

```
const arr = [1, 2, 3];           // Type: [1, 2, 3] (no context, literal preserved)
const arr: Int[] = [1, 2, 3];   // Type: Int[] (context provides wider type)
```

**How it works:**

1. Before analyzing an expression, check if there's an expected type from context
2. If so, use it to fill in missing type information (lambda params, etc.)
3. Verify the expression's type is compatible with the expected type
4. The expected type can widen what would otherwise be inferred as literal types

This matches TypeScript's contextual typing behavior, making the language familiar and reducing annotation burden.

### Inference Failure

When the compiler cannot determine a type, it produces a **compile error** rather than silently falling back to `Unknown`.

**Examples of inference failure:**

```
// ERROR: Cannot infer type of parameter 'x'
const f = x => x + 1;

// ERROR: Cannot infer type - no contextual type and no annotation
const g = (x) => x;
```

**Why error instead of Unknown:**

1. **Explicit is better than implicit**: Falling back to `Unknown` would hide programmer mistakes
2. **Predictable behavior**: Errors point directly to where annotations are needed
3. **No runtime surprises**: `Unknown` would require runtime checks that might fail unexpectedly
4. **Matches TypeScript's `noImplicitAny`**: Familiar behavior for TypeScript users

**When annotations are required:**

- Lambda parameters without contextual typing
- Recursive function return types
- Ambiguous expressions where multiple types are valid

**The fix is always explicit annotation:**

```
const f = (x: Int) => x + 1;           // OK: parameter annotated
const g = <T>(x: T): T => x;           // OK: generic with annotation
```

### Flow-Based Inference

DepJS uses **flow-based (local) type inference**, analyzing code forward one expression at a time. This is the same approach as TypeScript.

**How it works:**

1. Analyze expressions left-to-right, top-to-bottom
2. Each binding's type is determined when it's declared
3. Types flow forward through the program
4. Contextual typing flows expected types downward into expressions

**Example:**

```
const x = 42;                    // x: 42 (inferred from literal)
const y = x + 1;                 // y: Int (inferred from + operation)
const z = [x, y];                // z: [42, Int] (inferred from elements)
const f = (a: Int) => a * 2;     // f: (Int) => Int (param annotated, return inferred)
```

**Why flow-based (not Hindley-Milner):**

1. **Subtyping compatibility**: HM with subtyping is notoriously complex. DepJS has structural subtyping for records, which doesn't mix well with HM's unification-based approach.

2. **Predictable errors**: Flow-based inference produces errors at the point of inconsistency. HM can report errors far from the actual problem, making debugging harder.

3. **TypeScript familiarity**: Flow-based inference matches TypeScript's behavior, making the language more approachable.

4. **Simpler mental model**: Programmers can trace type inference by reading code top-to-bottom.

**Trade-offs:**

- Recursive functions require explicit return type annotations
- Some programs that would type-check under HM need annotations in flow-based
- But: errors are more localized and easier to understand

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

When an array literal is written without a type annotation, the compiler infers a fixed-length array type with **literal element types preserved**.

**Inference rules:**

```
const a = [1, 2, 3];        // [1, 2, 3]
const b = ["a", "b"];       // ["a", "b"]
const c = [1, "hello"];     // [1, "hello"]
const d = [true, false];    // [true, false]
```

**Key decisions:**

1. **Length is preserved:** Array literals infer to fixed-length types, preserving the number of elements
2. **Literal types preserved:** Each element retains its literal type (`1`, `"hello"`, `true`)
3. **Subtyping handles compatibility:** `[1, 2, 3] <: [Int, Int, Int] <: Int[]`, so literal-typed arrays work anywhere wider types are expected

**Rationale:**

In an immutable language with structural subtyping, preserving literal types provides strictly more information without causing problems:

```
const x = [1, 2, 3];  // Type: [1, 2, 3]

// Still works everywhere Int[] is expected (subtyping)
const sum = (nums: Int[]) => nums.reduce((a, b) => a + b, 0);
sum(x);  // OK: [1, 2, 3] <: Int[]

// But you get precise type info when you want it
const first: 1 = x[0];  // OK: first element is known to be 1
```

**Explicit widening:**

If you want a wider type, use explicit annotation:

```
const a: [Int, Int, Int] = [1, 2, 3];  // Widened to [Int, Int, Int]
const b: Int[] = [1, 2, 3];            // Widened to Int[], length info lost
```

### Record Literal Inference

When a record literal is written without a type annotation, the compiler infers a record type with **literal field types preserved**.

**Inference rules:**

```
const x = { a: 1, b: "hi" };     // { a: 1, b: "hi" }
const y = { name: "Alice" };     // { name: "Alice" }
const z = { flag: true, n: 42 }; // { flag: true, n: 42 }
```

**Key decisions:**

1. **Literal types preserved:** Each field retains its literal type (`1`, `"hi"`, `true`)
2. **Structure is preserved:** The set of field names and their optionality is preserved exactly
3. **Subtyping handles compatibility:** `{ a: 1 } <: { a: Int }`, so literal-typed records work anywhere wider types are expected

**Rationale:**

In an immutable language with structural subtyping, preserving literal types provides strictly more information without causing problems:

```
const config = { port: 8080, debug: true };  // Type: { port: 8080, debug: true }

// Still works everywhere { port: Int, debug: Boolean } is expected (subtyping)
const startServer = (c: { port: Int, debug: Boolean }) => ...;
startServer(config);  // OK: { port: 8080, debug: true } <: { port: Int, debug: Boolean }

// But you get precise type info - discriminants work naturally
const result = { kind: "ok", value: 42 };  // Type: { kind: "ok", value: 42 }
// No annotation needed for discriminated unions!
```

**Explicit widening:**

If you want a wider type, use explicit annotation:

```
const config: { port: Int, debug: Boolean } = { port: 8080, debug: true };
```

**Nested records:**

Literal type preservation applies recursively to nested structures:

```
const nested = { outer: { inner: 1 } };  // { outer: { inner: 1 } }
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

## Annotations

Annotations attach compile-time metadata to types and fields. They have no special semantics in the language itself—they are simply comptime-available data that can be inspected via type properties.

### Syntax

The `@` prefix attaches a comptime value as an annotation:

**On type definitions** (before the name):
```
@Deprecated({ reason: "use NewUser" })
type OldUser = { name: String };

@JsonName("user_record")
@Versioned(2)
type User = { name: String, age: Int };
```

**On record fields** (before the field name):
```
type User = {
  @JsonName("user_id") userId: String;
  @Min(0) @Max(150) age: Int;
  @NonEmpty name: String;
};
```

**On function parameters and return types** (before the type):
```
const validate = (name: @NonEmpty String, age: @Positive Int): @Valid User => {
  // ...
};

const parse = (input: String): @Validated Config => {
  // ...
};
```

**On type parameters** (before the parameter name):
```
type Container<@Covariant T> = { value: T };
type Function<@Contravariant A, @Covariant B> = (a: A) => B;
type Box<@Covariant T extends Showable> = { value: T };
```

### Annotation Values

Any comptime-evaluable expression can be an annotation:

```
// String annotation
@"deprecated" type OldApi = { ... };

// Record annotation
@{ author: "Alice", version: 1 } type MyType = { ... };

// Type instance annotation (most common)
@Deprecated({ reason: "use v2", since: "1.0" })
type OldUser = { ... };
```

Annotation types are just regular types—there is no special `Annotation` base type required:

```
type Deprecated = { reason: String, since?: String };
type JsonName = String;
type Min = { value: Int };
type Max = { value: Int };
type NonEmpty = { kind: "NonEmpty" };
type Positive = { kind: "Positive" };
```

### Accessing Annotations

#### On Types

Types have two annotation-related properties:

```
T.annotations           // Array<Unknown> - all annotations (comptime only)
T.annotation<A>         // A | Undefined - first annotation of type A (comptime only)
```

**Example:**

```
@Deprecated({ reason: "use NewUser" })
@JsonName("old_user")
type OldUser = { name: String };

OldUser.annotations;              // [{ reason: "use NewUser" }, "old_user"]
OldUser.annotation<Deprecated>;   // { reason: "use NewUser" }
OldUser.annotation<JsonName>;     // "old_user"
OldUser.annotation<Min>;          // undefined
```

#### On Fields

The `FieldInfo` type is extended to include annotations:

```
type FieldInfo = {
  name: String;
  type: Type;
  optional: Boolean;
  annotations: Array<Unknown>;  // annotations on this field
};
```

**Example:**

```
type User = {
  @JsonName("user_id") userId: String;
  @Min(0) @Max(150) age: Int;
};

User.fields[0].annotations;  // ["user_id"]
User.fields[1].annotations;  // [{ value: 0 }, { value: 150 }]
```

#### On Function Parameter Types

For function types, annotations on parameter types are accessible via the type's annotation properties:

```
type Validator = (name: @NonEmpty String, age: @Positive Int) => Boolean;

Validator.parameterTypes[0].annotation<NonEmpty>;   // { kind: "NonEmpty" }
Validator.parameterTypes[1].annotation<Positive>;   // { kind: "Positive" }
```

### Use Cases

Annotations are purely compile-time metadata. Common use cases include:

**Validation code generation:**
```
const withValidation = <F extends Function>(f: F): F => {
  const params = F.parameters;

  const validators = params.map(p => {
    const nonEmpty = p.type.annotation<NonEmpty>;
    const positive = p.type.annotation<Positive>;

    match (true) {
      case _ when nonEmpty != undefined:
        (value: Unknown) => {
          if ((value as String).length === 0) {
            throw Error(`${p.name} cannot be empty`);
          };
        };
      case _ when positive != undefined:
        (value: Unknown) => {
          if ((value as Int) <= 0) {
            throw Error(`${p.name} must be positive`);
          };
        };
      case _: (_: Unknown) => {};
    };
  });

  (...args: F.parameterTypes) => {
    validators.forEach((v, i) => v(args[i]));
    f(...args);
  };
};
```

**Serialization hints:**
```
type ApiResponse = {
  @JsonName("user_id") userId: String;
  @JsonName("created_at") createdAt: String;
};

// Generate serialization code at compile time
const serializer = generateSerializer(ApiResponse);
```

**Documentation/deprecation:**
```
@Deprecated({ reason: "use fetchUserV2", since: "2.0" })
const fetchUser = (id: String): Promise<User> => { ... };

// Compile-time warning generation
const checkDeprecations = (module: Module) => {
  module.exports.forEach(e => {
    const dep = typeOf(e).annotation<Deprecated>;
    if (dep != undefined) {
      warn(`${e.name} is deprecated: ${dep.reason}`);
    };
  });
};
```

### Desugaring

Annotations desugar to `WithMetadata` calls (see [WithMetadata and TypeMetadata](#withmetadata-and-typemetadata)):

**Type annotations:**
```
@Deprecated({ reason: "use NewUser" })
type OldUser = { name: String };

// desugars to:
const OldUser: Type = WithMetadata(
  RecordType([{ name: "name", type: String, optional: false }]),
  { name: "OldUser", annotations: [Deprecated({ reason: "use NewUser" })] }
);
```

**Multiple annotations:**
```
@Serializable
@Versioned(2)
type User = { name: String };

// desugars to:
const User: Type = WithMetadata(
  RecordType([{ name: "name", type: String, optional: false }]),
  { name: "User", annotations: [Serializable, Versioned(2)] }
);
```

**Field annotations** are included in `FieldInfo`:
```
type User = {
  @JsonName("user_id") userId: String;
};

// desugars to:
const User: Type = WithMetadata(
  RecordType([
    { name: "userId", type: String, optional: false, annotations: [JsonName("user_id")] }
  ]),
  { name: "User" }
);
```

**Annotated parameter/return types** use `WithMetadata` on the type:
```
const validate = (name: @NonEmpty String): @Valid User => { ... };

// The parameter type @NonEmpty String desugars to:
WithMetadata(String, { annotations: [NonEmpty] })

// The return type @Valid User desugars to:
WithMetadata(User, { annotations: [Valid] })
```

### Design Notes

- Annotations are **comptime only**—they have no runtime representation
- The `@` syntax is sugar for `WithMetadata` with the `annotations` field
- Multiple annotations are allowed on the same target
- Annotation order is preserved in the `annotations` array
- There is no special `Annotation` base type—any value can be an annotation
- `WithMetadata` does not affect subtyping—`@NonEmpty String` is still assignable to `String`

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

## Compile-Time AST Access (Expr Type)

DepJS supports compile-time access to expression ASTs via the `Expr<T>` type, similar to C#'s `Expression<T>`. When a function parameter is typed as `Expr<T>`, the compiler captures the argument's AST rather than evaluating it.

### Basic Usage

```
const logQuery = (filter: Expr<(User) => Boolean>) => {
  console.log("Filter AST:", filter);
  // filter is the AST representation, not a function
};

logQuery(u => u.age > 18);  // Captures AST, doesn't evaluate
```

The `Expr<T>` type is **comptime-only** because it contains `Type` values. If you need runtime AST access, you must manually extract the information you need into runtime-usable structures.

### The Expr Type

`Expr<T>` is a parameterized type where `T` is the type of the expression if it were evaluated. The AST is represented as a discriminated union:

```
type Expr<T> =
  | { kind: "literal", value: Unknown, type: Type }
  | { kind: "identifier", name: String, type: Type }
  | { kind: "binary", op: BinaryOp, left: Expr<Unknown>, right: Expr<Unknown>, type: Type }
  | { kind: "unary", op: UnaryOp, operand: Expr<Unknown>, type: Type }
  | { kind: "call", fn: Expr<Unknown>, args: Array<Expr<Unknown>>, type: Type }
  | { kind: "lambda", params: Array<ParamInfo>, body: Expr<Unknown>, type: Type }
  | { kind: "property", object: Expr<Unknown>, name: String, type: Type }
  | { kind: "index", object: Expr<Unknown>, index: Expr<Unknown>, type: Type }
  | { kind: "conditional", condition: Expr<Boolean>, then: Expr<Unknown>, else: Expr<Unknown>, type: Type }
  | { kind: "record", fields: Array<{ name: String, value: Expr<Unknown> }>, type: Type }
  | { kind: "array", elements: Array<Expr<Unknown>>, type: Type }
  | { kind: "spread", expr: Expr<Unknown>, type: Type };

type BinaryOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "&&" | "||" | "|" | "&" | "^";
type UnaryOp = "-" | "!" | "~";

type ParamInfo = { name: String, type: Type };
```

Every node includes a `type` field containing the compile-time type of that subexpression.

### Capture Semantics

When an argument position has type `Expr<T>`:

1. The argument expression is **not evaluated**
2. Instead, the compiler builds an AST representation
3. The AST is passed to the function at compile time
4. Type checking ensures the expression would have type `T` if evaluated

```
const inspect = (e: Expr<Int>) => {
  match (e) {
    case { kind: "binary", op: "+", left, right }:
      console.log("Addition of", left, "and", right);
    case { kind: "literal", value }:
      console.log("Literal:", value);
    case _:
      console.log("Other expression");
  };
};

inspect(1 + 2);      // Captures binary expression AST
inspect(42);         // Captures literal AST
inspect("hello");    // ERROR: String is not Int
```

### Use Cases

**Query Translation (LINQ-style):**

```
type Query<T> = { filter: Expr<(T) => Boolean> | Undefined, /* ... */ };

const where = <T>(q: Query<T>, predicate: Expr<(T) => Boolean>): Query<T> =>
  { ...q, filter: predicate };

const toSQL = <T>(q: Query<T>): String => {
  const filterSQL = q.filter ? exprToSQL(q.filter) : "1=1";
  return `SELECT * FROM ${T.name} WHERE ${filterSQL}`;
};

const exprToSQL = (e: Expr<Unknown>): String => match (e) {
  case { kind: "binary", op: ">", left: { kind: "property", name }, right: { kind: "literal", value } }:
    `${name} > ${value}`;
  case { kind: "binary", op: "==", left: { kind: "property", name }, right: { kind: "literal", value } }:
    `${name} = ${value}`;
  // ... more cases
  case _: throw Error("Unsupported expression");
};

// Usage
const query = where(from<User>(), u => u.age > 18);
const sql = toSQL(query);  // "SELECT * FROM User WHERE age > 18"
```

**Compile-Time Validation:**

```
const assertPure = (e: Expr<Unknown>): Void => {
  match (e) {
    case { kind: "call" }: throw Error("Calls not allowed in pure expression");
    case { kind: "binary", left, right }:
      assertPure(left);
      assertPure(right);
    // ... recursively check all nodes
    case _: {};
  };
};
```

**DSL Construction:**

```
const formula = (e: Expr<Number>): Formula => {
  match (e) {
    case { kind: "binary", op: "+", left, right }:
      Add(formula(left), formula(right));
    case { kind: "identifier", name }:
      Variable(name);
    case { kind: "literal", value }:
      Constant(value as Number);
    case _: throw Error("Unsupported formula syntax");
  };
};

const f = formula(x + y * 2);  // Builds Formula AST from expression
```

### Manual Reification

Since `Expr<T>` is comptime-only (contains `Type`), it cannot exist at runtime. If you need runtime AST access, manually extract the information:

```
// Runtime-usable AST (no Type fields)
type RuntimeExpr =
  | { kind: "literal", value: Unknown }
  | { kind: "binary", op: String, left: RuntimeExpr, right: RuntimeExpr }
  | { kind: "property", objectType: String, name: String }
  // ... etc

const reify = (e: Expr<Unknown>): RuntimeExpr => match (e) {
  case { kind: "literal", value }: { kind: "literal", value };
  case { kind: "binary", op, left, right }:
    { kind: "binary", op, left: reify(left), right: reify(right) };
  case { kind: "property", object, name, type }:
    { kind: "property", objectType: type.name, name };
  // ... etc
};

// At compile time, reify the Expr
comptime const runtimeAST = reify(someExpr);
// runtimeAST is now a regular value usable at runtime
```

### Limitations

- `Expr<T>` is **comptime-only** — cannot be stored in runtime data structures without reification
- Only expressions can be captured, not statements or declarations
- The captured AST reflects source syntax, not any transformations or optimizations
- Identifiers in the AST are names only — they don't carry scope/binding information

## Refinement Types (Future Version)

Refinement types are **deferred to a future version** of DepJS. The core type system is complete without them.

**Potential future syntax:**
```
type PosInt = Int where this > 0;
type NonEmpty<T> = Array<T> where this.length > 0;
```

This feature would require resolving:
- Syntax design (`where` clause vs alternatives)
- Compile-time vs runtime checking strategy
- Decidable predicate subset
- Subtyping rules for refinements

For now, use branded types or runtime validation for similar use cases.