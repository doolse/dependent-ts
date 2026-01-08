# Syntax Specification

## Base Style

- JavaScript-like syntax with curly braces
- Semicolons required
- Standard JS function syntax (arrow functions and function declarations)

## Bindings

All bindings are immutable using `const`:

```
const x: Int = 1;
const add = (a: Int, b: Int): Int => a + b;
function add(a: Int, b: Int): Int { return a + b; }
```

## Type Annotations

TypeScript-style, colon after the name:

```
const x: Int = 1;
function greet(name: String): String { return "Hello " + name; }
const transform: (x: Int) => Int = (x) => x * 2;
```

## Generics

Angle bracket syntax for type parameters:

```
function identity<T>(x: T): T { return x; }
const nums: Array<Int> = [1, 2, 3];
```

**Call syntax:** Type arguments come BEFORE value arguments:
```
identity<Int>(5);
pair<Int, String>(1, "hello");
```

**Desugaring:** Type params become regular params at the END with defaults:
```
// Definition
const identity = <T>(x: T) => x;
// Desugars to:
const identity = (x: T, T: Type = typeOf(x)) => x;

// Call
identity<Int>(5);
// Desugars to:
identity(5, Int);
```

This allows partial inference — provide some type args, infer the rest:
```
pair<Int>(1, "hello");      // T=Int explicit, U=String inferred
pair(1, "hello", Int);      // equivalent desugared form
```

## Comparison Operators and Space Sensitivity

To disambiguate `<` and `>` between comparison operators and type arguments, **space sensitivity** applies:

- `f<T>` (no space) → type argument application
- `f < T` (space required) → comparison operator

```
// Type arguments (no space before <)
identity<Int>(5);
Array<String>;
process<{ name: String }>;

// Comparisons (space required before <)
x < y;
a < b && c > d;
count < limit;
```

**Rules:**
- `<` immediately following an identifier (no whitespace) starts a type argument list
- `<` preceded by whitespace is the less-than comparison operator
- Same logic applies to `>` for closing type arguments vs greater-than

```
// These are different:
f<T>(x)      // call f with type arg T, then value arg x
f < T        // compare f to T

// Complex expressions - use parentheses for clarity
(a < b) > c  // two comparisons
a < (b > c)  // two comparisons
```

## Data Types

Use `type` for record types (no `interface` keyword):

```
type Person = {
  name: String;
  age: Int;
};
```

## Sum Types

TypeScript-style discriminated unions:

```
type Result<T, E> = { kind: "ok", value: T } | { kind: "err", error: E };
type Option<T> = { kind: "some", value: T } | { kind: "none" };
```

**Discriminant identification:** The compiler uses the TypeScript approach — any property whose type is a union of distinct literals across variants serves as a discriminant.

```
type Event =
  | { type: "click", x: Int, y: Int }
  | { type: "keypress", key: String }
  | { type: "scroll", delta: Int };
// 'type' is a discriminant (distinct literal in each variant)
```

## Pattern Matching

`match` expression with `case` clauses separated by semicolons:

```
match (expr) {
  case pattern: result;
  case pattern: result;
};
```

**Pattern types:**

```
// Literal patterns
match (x) {
  case 0: "zero";
  case 1: "one";
  case _: "other";  // wildcard
};

// Type patterns (narrows the type)
match (x) {
  case Int: x + 1;
  case String: x.length;
  case _: 0;
};

// Property patterns (discriminated unions)
match (result) {
  case { kind: "ok", value }: value * 2;
  case { kind: "err", message }: log(message);
};

// Nested patterns
match (response) {
  case { status: "ok", data: { items } }: items.length;
  case { status: "error" }: -1;
};
```

**Binding syntax:**
- Implicit: `{ value }` binds `value`
- Explicit rename: `{ value: v }` binds `v`

**Guards with `when`:**
```
match (x) {
  case Int when x > 0: "positive";
  case Int when x < 0: "negative";
  case Int: "zero";
};
```

**Exhaustiveness:** The compiler verifies all cases are handled. Wildcard `_` satisfies exhaustiveness.

**Return type:** Union of all branch types.

## Iteration

Method chaining (no explicit loops):

```
const doubled = nums.map((x) => x * 2);
const sum = nums.reduce((acc, x) => acc + x, 0);
const evens = nums.filter((x) => x % 2 === 0);
```

## First-Class Types

Types are first-class values that can be assigned and passed around:

```
type Person = { name: String, age: Int };

// Types can be stored in variables
const T = Person;

// Types can be passed to functions
const describeType = (T: Type) => T.name;
describeType(Person);  // "Person"

// Type introspection via properties (runtime-usable)
Person.name          // "Person"
Person.fieldNames    // ["name", "age"]

// Type introspection (comptime-only)
Person.fields        // Array<FieldInfo>
Person.fields[0]     // { name: "name", type: String, optional: false }
```

**Note:** `Type` values exist only at compile time. Properties returning `Type` (like `.fields[n].type`) are comptime-only.

See `spec/types.md` for full type system specification.

## Type Syntax vs Expression Syntax

The `<>` vs `()` distinction controls how function arguments are parsed:

- `f<args>` — arguments parsed with **type syntax** (sugar applies)
- `f(args)` — arguments parsed with **expression syntax** (no sugar)
- `f<typeArgs>(valueArgs)` — both

```
// Type syntax (sugar applies)
Array<Int>
Array<{ name: String }>      // { } is record TYPE
Union<{ a: Int }, { b: Int }>
processType<(x: Int) => String>  // function TYPE

// Expression syntax (no sugar)
RecordType([{ name: "a", type: Int, optional: false }])  // { } is record literal
someFunc((x: Int) => x + 1)  // arrow function
```

**Type contexts** (where type syntax applies):
- `type X = <expr>` — after `=`
- `const x: <expr>` — type annotations
- `<T, U>` — generic parameter declarations
- `f<args>` — inside angle brackets

## Operators

**Arithmetic:** `+`, `-`, `*`, `/`, `%`

**Comparison:** `<`, `>`, `<=`, `>=`, `===`, `!==`
- Note: `<` and `>` require space before them (see Space Sensitivity section)

**Logical:** `&&`, `||`, `!`

**Bitwise:** `|`, `&`, `^`, `~`
- In **expression syntax**: bitwise operations (JavaScript semantics)
- In **type syntax**: `|` → Union, `&` → Intersection

```
// Type syntax
type X = Int | String;      // Union

// Expression syntax
const a = 5 | 3;            // Bitwise OR = 7
const b = 5 & 3;            // Bitwise AND = 1
```

## Primitive Types

- `Int` — integers
- `Float` — floating-point numbers
- `Number` — supertype of `Int` and `Float`
- `String` — strings
- `Boolean` — `true` or `false`
- `Null`, `Undefined` — null and undefined values
- `Never` — bottom type (no values)
- `Unknown` — top type (any value)

```
const i: Int = 42;
const f: Float = 3.14;
const n: Number = i;     // Int <: Number
```

## Error Handling

**throw statement:**
```
throw Error("something went wrong");
```

**Try builtin** (catches exceptions, returns union):
```
const result = Try(() => JSON.parse(input));
// result: { ok: true, value: Json } | { ok: false, error: Error }

match (result) {
  case { ok: true, value }: processJson(value);
  case { ok: false, error }: log(error.message);
};
```

## Async/Await

Direct 1:1 mapping to JavaScript:

```
const fetchUser = async (id: String): Promise<User> => {
  const response = await fetch(`/users/${id}`);
  return await response.json();
};
```

- `async` keyword required for functions using `await`
- `await` only valid on `Promise<T>` expressions
- Top-level await supported

## Compile-Time Assertions

`assert` is a comptime-only builtin function:

```
assert: (condition: Boolean, message?: String) => Void
```

**Basic usage:**
```
assert(T.fields.length > 0);
assert(config.version === 2, "Config must be version 2");
```

**Type checking with `is` sugar:**
```
assert(x is Int);
// desugars to:
assert(typeOf(x).extends(Int));
```

**Semantics:**
- The condition expression must be comptime-evaluable
- If condition is `false`, compilation fails with an error
- If message is provided, it's included in the compile error
- No runtime code is generated — assertions disappear after compilation

**Statement-position execution:**
Expressions in statement position (not used as a value) are always executed for their effects. This ensures `assert(...)` calls are evaluated even though they return `Void`.

```
const x = 5;
assert(x > 0);   // executed for effect, even though result is unused
const y = x + 1;
```

## Modules

ES module syntax:

```
import { foo, bar } from './utils';
export const myFunc = (x: Int): Int => x + 1;
export function helper(s: String): String { return s.toUpperCase(); }
```

## Open Questions

None currently — see CLAUDE.md for any remaining design decisions.