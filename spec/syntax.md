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

Angle bracket syntax:

```
function identity<T>(x: T): T { return x; }
const nums: Array<Int> = [1, 2, 3];
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
type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };
type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };
```

TODO: How the compiler identifies the discriminant property is not yet decided.

## Pattern Matching

`match` expression with `case` clauses separated by semicolons:

```
const describe = (x: Int): String => match(x) {
  case 0: "zero";
  case 1: "one";
  case _: "many";
};
```

TODO: Syntax for matching on sum types/tagged unions

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
const describeType = (T) => T.name;
describeType(Person);  // "Person"

// Type introspection via properties
Person.name          // "Person"
Person.fieldNames    // ["name", "age"]
Person.fields        // { name: { type: String }, age: { type: Int } }
```

See `spec/types.md` for full type system specification.

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

- How pattern matching works with discriminated unions