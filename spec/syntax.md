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

Use `interface` for record types:

```
interface Person {
  name: String;
  age: Int;
}
```

## Sum Types

TypeScript-style discriminated unions with a tag property:

```
type Result<T, E> = { tag: 'ok'; value: T } | { tag: 'err'; error: E };
type Option<T> = { tag: 'some'; value: T } | { tag: 'none' };
```

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

Use `assert` keyword:

```
assert x is Int;
```

TODO: Full assertion syntax and what can be asserted

## Modules

ES module syntax:

```
import { foo, bar } from './utils';
export const myFunc = (x: Int): Int => x + 1;
export function helper(s: String): String { return s.toUpperCase(); }
```

## Open Questions

- How pattern matching works with discriminated unions
- What assertions can be made with `assert`