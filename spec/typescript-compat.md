# TypeScript Type System Compatibility

This document systematically maps TypeScript type features to DepJS, showing how each can be encoded or whether it requires special handling.

## Goals

- Import types from `.d.ts` files
- Support as much of TypeScript's type system as possible
- Where TypeScript uses special syntax, show how DepJS encodes it with first-class types

## Primitive Types

### Basic Primitives

| TypeScript | DepJS | Notes |
|------------|-------|-------|
| `string` | `String` | Direct mapping |
| `number` | `Number` | Supertype of `Int` and `Float` |
| `boolean` | `Boolean` | Direct mapping |
| `null` | `Null` | Direct mapping |
| `undefined` | `Undefined` | Direct mapping |
| `void` | `Void` | For function returns |
| `never` | `Never` | Bottom type |
| `unknown` | `Unknown` | Top type |
| `any` | `Unknown` | Maps to `Unknown` on `.d.ts` import (preserves soundness) |

### Literal Types

```typescript
// TypeScript
type Direction = "north" | "south" | "east" | "west";
type One = 1;
type Yes = true;
```

```
// DepJS
type Direction = "north" | "south" | "east" | "west";
type One = 1;
type Yes = true;
```

**Status:** Direct mapping - literal types work the same way.

### Numeric Types

DepJS distinguishes between integers and floating-point numbers, unlike TypeScript which only has `number`.

```
// DepJS numeric type hierarchy
Int <: Number
Float <: Number
```

**Literal inference:**
```
const i = 42;       // type is Int (integer literal)
const f = 3.14;     // type is Float (floating-point literal)
const n: Number = i; // OK: Int <: Number
```

**TypeScript interop:**
- TypeScript `number` maps to DepJS `Number`
- Functions accepting `Number` can receive both `Int` and `Float`
- This is compile-time only; at runtime everything is JS numbers

**Array indexing:**
```
const arr = [1, 2, 3];
const i: Int = 0;
const f: Float = 0.5;

arr[i]    // OK: Int index
arr[f]    // ERROR: Float index not allowed
```

**Conversion:**
```
const i: Int = toInt(3.14);     // truncates to 3
const f: Float = toFloat(42);   // converts to 42.0
```

**Status:** Supported. `Int` and `Float` are separate primitive types that both subtype `Number`.

## Object Types

### Record Types

```typescript
// TypeScript
interface Person {
  name: string;
  age: number;
}

type PersonType = {
  name: string;
  age: number;
};
```

```
// DepJS (no interface keyword - use type only)
type Person = {
  name: String;
  age: Number;
};
```

**Status:** Direct mapping. DepJS uses `type` exclusively (no `interface` keyword).

### Optional Properties

```typescript
// TypeScript
interface Config {
  name: string;
  timeout?: number;
}
```

```
// DepJS
type Config = {
  name: String;
  timeout?: Number;
};
```

**Status:** Supported - same `?` syntax as TypeScript.

### Readonly Properties

```typescript
// TypeScript
interface Point {
  readonly x: number;
  readonly y: number;
}
```

```
// DepJS - all properties are implicitly readonly
type Point = {
  x: Number;
  y: Number;
};
```

**Status:** Supported - all properties are readonly by default in DepJS. No `readonly` keyword needed. (Note: escape hatches for mutability will be needed later for JS interop.)

### Index Signatures

```typescript
// TypeScript
interface StringMap {
  [key: string]: number;
}
```

```
// DepJS
type StringMap = { [key: String]: Number };

// Desugars to:
const StringMap: Type = RecordType([], Number);
```

**Status:** Supported. Index signatures use `RecordType` with an empty fields array and the value type as `indexType`.

## Union and Intersection Types

### Union Types

```typescript
// TypeScript
type StringOrNumber = string | number;
```

```
// DepJS
type StringOrNumber = String | Number;
```

**Status:** Direct mapping.

### Discriminated Unions

```typescript
// TypeScript
type Result =
  | { kind: "ok"; value: number }
  | { kind: "error"; message: string };
```

```
// DepJS
type Result =
  | { kind: "ok"; value: Number }
  | { kind: "error"; message: String };
```

**Status:** Supported - same syntax as TypeScript. Any property with literal types can serve as discriminant (how the compiler identifies this is TBD).

### Intersection Types

```typescript
// TypeScript
type Named = { name: string };
type Aged = { age: number };
type Person = Named & Aged;
```

```
// DepJS
type Named = { name: String };
type Aged = { age: Number };
type Person = Named & Aged;
```

**Status:** Supported - same `&` syntax as TypeScript.

## Generic Types

### Generic Types

```typescript
// TypeScript
interface Box<T> {
  value: T;
}
```

```
// DepJS
type Box<T> = {
  value: T;
};
```

**Status:** Direct mapping.

### Generic Constraints

```typescript
// TypeScript
interface Lengthwise {
  length: number;
}

function loggingIdentity<T extends Lengthwise>(arg: T): T {
  console.log(arg.length);
  return arg;
}
```

```
// DepJS
type Lengthwise = {
  length: Number;
};

const loggingIdentity = <T extends Lengthwise>(arg: T) => {
  console.log(arg.length);
  return arg;
};
```

**Status:** Supported. Constraints desugar using `Type<Bound>`:

```
// Desugars to:
const loggingIdentity = (arg: T, T: Type<Lengthwise> = typeOf(arg)) => {
  console.log(arg.length);
  return arg;
};
```

`Type<Bound>` is a parameterized type representing types that are subtypes of `Bound`. This enables the type checker to verify constraints and allow body usage of constrained properties.

### Default Type Parameters

```typescript
// TypeScript
interface Container<T = string> {
  value: T;
}
```

```
// DepJS
type Container<T = String> = {
  value: T;
};
```

**Status:** Supported - Generics desugar to type parameters with defaults:

```
// Sugar:
type Container<T = String> = { value: T };

// Desugars to:
const Container = (T: Type = String): Type => RecordType({ value: T });
```

## Utility Types

TypeScript provides built-in utility types. In DepJS, these are implemented as regular functions operating on first-class types.

### Partial<T>

```typescript
// TypeScript (built-in)
type Partial<T> = { [P in keyof T]?: T[P] };
```

```
// DepJS
const Partial = (T: Type): Type => {
  const newFields = T.fields.map(f => ({ ...f, optional: true }));
  return RecordType(newFields, T.indexType);
};
```

**Status:** Supported.

### Required<T>

```typescript
// TypeScript (built-in)
type Required<T> = { [P in keyof T]-?: T[P] };
```

```
// DepJS
const Required = (T: Type): Type => {
  const newFields = T.fields.map(f => ({ ...f, optional: false }));
  return RecordType(newFields, T.indexType);
};
```

**Status:** Supported.

### Pick<T, K>

```typescript
// TypeScript
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
```

```
// DepJS - type-safe via T.keysType
const Pick = (T: Type, keys: Array<T.keysType>): Type => {
  const newFields = T.fields.filter(f => keys.includes(f.name));
  return RecordType(newFields, T.indexType);
};
```

**Status:** Supported. Uses `T.keysType` for compile-time key validation.

### Omit<T, K>

```typescript
// TypeScript
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
```

```
// DepJS
const Omit = (T: Type, keys: Array<T.keysType>): Type => {
  const newFields = T.fields.filter(f => !keys.includes(f.name));
  return RecordType(newFields, T.indexType);
};
```

**Status:** Supported.

### Record<K, V>

```typescript
// TypeScript
type Record<K extends keyof any, T> = { [P in K]: T };
```

```
// DepJS - uses .value to extract literal values from union variants
const Record = (K: Type, V: Type): Type => {
  const fields = K.variants.map(k => ({
    name: k.value,  // extract string from literal type
    type: V,
    optional: false
  }));
  return RecordType(fields);
};

// Usage:
type Keys = "a" | "b" | "c";
type MyRecord = Record(Keys, Int);  // { a: Int, b: Int, c: Int }
```

**Status:** Supported. Requires `.value` property on literal types.

## Mapped Types

```typescript
// TypeScript
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Nullable<T> = { [P in keyof T]: T[P] | null };
```

**Status:** Supported via first-class type functions:

```
// DepJS encoding
const Nullable = (T: Type): Type => {
  const newFields = T.fields.map(f => ({
    ...f,
    type: Union(f.type, Null)
  }));
  return RecordType(newFields, T.indexType);
};
```

Note: All properties in DepJS are readonly by default, so `Readonly<T>` is a no-op.

## Conditional Types

```typescript
// TypeScript
type IsString<T> = T extends string ? true : false;
type NonNullable<T> = T extends null | undefined ? never : T;
```

**Status:** Supported via `.extends()` method and ternary expressions:

```
// DepJS
const IsString = (T: Type): Type => T.extends(String) ? true : false;

const NonNullable = (T: Type): Type =>
  T.extends(Union(Null, Undefined)) ? Never : T;

const Extract = (T: Type, U: Type): Type => T.extends(U) ? T : Never;
const Exclude = (T: Type, U: Type): Type => T.extends(U) ? Never : T;
```

### Distributive Conditional Types

In TypeScript, conditional types distribute over unions when the checked type is a naked type parameter:

```typescript
// TypeScript - distributes over union
type ToArray<T> = T extends any ? T[] : never;
ToArray<string | number>  // string[] | number[]
```

In DepJS, distribution is **explicit** via `.variants.map()`:

```
// DepJS - explicit distribution
const ToArray = (T: Type): Type =>
  Union(...T.variants.map(v => Array(v)));

ToArray(Union(String, Number));  // Array<String> | Array<Number>
```

The `.d.ts` reader translates TypeScript's implicit distribution to explicit DepJS mapping.

## Template Literal Types

```typescript
// TypeScript
type Greeting = `Hello, ${string}`;
type EmailLocaleIDs = `${string}_email_id`;
type EventHandlers = `on${Capitalize<Events>}`;
```

**Status:** Out of scope. Template literal types are essentially string refinement types with pattern constraints. They could potentially be expressed via DepJS's refinement type system once that's designed:

```
// Potential future DepJS equivalent via refinements
type Greeting = String where this.startsWith("Hello, ");
```

If encountered in `.d.ts` imports, produces a compile error. The combinatorial expansion feature (`${A}${B}` producing unions) would need additional design work.

## Type Inference Features

### `infer` Keyword

```typescript
// TypeScript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
type ElementType<T> = T extends (infer U)[] ? U : never;
```

**Status:** Supported via type properties. Function and array types expose properties for extracting component types:

```
// DepJS encoding
const ReturnType = (T: Type): Type => T.returnType;
const ElementType = (T: Type): Type => T.elementType;

// Usage in generic inference:
const map = (
  arr: Array<A>,
  f: (a: A) => B,
  A: Type = typeOf(arr).elementType,
  B: Type = typeOf(f).returnType
): Array<B> => arr.map(f);
```

Type properties are comptime-only since they return `Type` values.

### `keyof` Operator

```typescript
// TypeScript
type PersonKeys = keyof Person;  // "name" | "age"
```

```
// DepJS
type PersonKeys = Person.keysType;  // "name" | "age" (union of literal types)

// Also available:
Person.fieldNames;  // ["name", "age"] (Array<String> at runtime)
```

**Status:** Supported via `.keysType` property which returns a union of string literal types (comptime only). For runtime access, use `.fieldNames` which returns `Array<String>`.

### `typeof` Type Operator

```typescript
// TypeScript
const point = { x: 10, y: 20 };
type PointType = typeof point;
```

```
// DepJS
const point = { x: 10, y: 20 };
type PointType = typeOf(point);  // Uses typeOf function
```

**Status:** Direct mapping via `typeOf()` function.

## Function Types

### Basic Function Types

```typescript
// TypeScript
type Fn = (x: number, y: number) => number;
```

```
// DepJS
type Fn = (x: Number, y: Number) => Number;
```

**Status:** Direct mapping.

### Overloaded Functions

```typescript
// TypeScript
function parse(value: string): number;
function parse(value: number): string;

interface Overloaded {
  (x: string): string;
  (x: number): number;
}
```

**Status:** Supported for `.d.ts` import via intersection of function types.

```
// Imported as DepJS
const parse: ((String) => Number) & ((Number) => String);
```

**Call semantics (order-dependent, first match wins):**
```
parse("hello")     // First signature matches → Number
parse(42)          // Second signature matches → String

const x: String | Number = ...;
parse(x)           // Returns Number | String (union of matching return types)
```

**Overlapping signatures:**
```
type F = ((String) => Number) & ((String | Number) => Boolean);

f("hello")  // First matches exactly → Number
f(42)       // Only second matches → Boolean
```

More specific signatures should come first.

**Type properties:**
```
type Parse = ((String) => Number) & ((Number) => String);

Parse.signatures              // [FunctionType([String], Number), FunctionType([Number], String)]
Parse.signatures[0].returnType // Number
Parse.parameterTypes          // Error: ambiguous for overloaded functions
Parse.returnType              // Error: ambiguous for overloaded functions
```

**Writing overloads in DepJS:** Not supported as language syntax. Use pattern matching instead:
```
// DepJS approach - pattern matching with flow typing
const parse = (value: String | Number) => match (value) {
  case String: parseInt(value);   // returns Number
  case Number: value.toString();  // returns String
};
```

**Subtyping:**
```
type Overloaded = ((String) => Number) & ((Number) => String);
type Single = (String) => Number;
type Union = (String | Number) => Number | String;

Overloaded <: Single  // Yes - can handle String → Number calls
Overloaded <: Union   // Yes - can handle any String|Number call
Union <: Overloaded   // No - doesn't guarantee precise return types
```

### Generic Functions

```typescript
// TypeScript
type Identity = <T>(x: T) => T;
```

```
// DepJS
type Identity = <T>(x: T) => T;
```

**Status:** Direct mapping.

## Array and Tuple Types

DepJS unifies arrays and tuples into a single type system with two syntactic forms. There is no separate Tuple type.

```typescript
// TypeScript
type Point = [number, number];
type NamedPoint = [x: number, y: number];  // Labeled tuple
type Numbers = number[];
type VarArgs = [string, ...number[]];  // Variadic tuple
```

```
// DepJS - two syntactic forms for arrays
type Point = [Int, Int];                // Fixed 2-element array (bracket syntax)
type NamedPoint = [x: Int, y: Int];     // Labeled fixed array
type Numbers = Int[];                   // Variable-length array (postfix syntax)
type VarArgs = [String, ...Int];        // String followed by any Ints
type Mixed = [Int, name: String];       // Mixed labels allowed
```

**Status:** Supported. Two syntaxes handle fixed-length (TypeScript tuples) and variable-length arrays.

**Core syntax:**
- `Int[]` — Variable-length array of Int (postfix syntax)
- `[Int, String]` — Fixed 2-element array (bracket syntax)
- `[Int]` — Fixed 1-element array
- `[x: Int, y: Int]` — Fixed with labels
- `[Int, ...String]` — Int followed by any number of Strings

**Desugaring:**
```
Int[]            → Array(...Int)           // Variable-length
[Int, String]    → Array(Int, String)      // Fixed-length
[Int, ...String] → Array(Int, ...String)   // Mixed (variadic)
```

**Properties:**
```
// Fixed-length array
type Point = [Int, Int];

Point.typeArgs      // [Int, Int] - comptime only
Point.elementType   // Int (union of typeArgs) - comptime only
Point.elements      // Array<ArrayElementInfo> - comptime only
Point.length        // 2 - runtime usable
Point.isFixed       // true - runtime usable

// Variable-length array
type Ints = Int[];

Ints.typeArgs       // [Int] - comptime only
Ints.elementType    // Int - comptime only
Ints.elements       // undefined (unknown length)
Ints.length         // undefined (unknown length)
Ints.isFixed        // false - runtime usable
```

**ArrayElementInfo:**
```
type ArrayElementInfo = {
  type: Type;
  label: String | Undefined;
};
```

**Indexed access:**
```
const point: [Int, String] = [1, "hello"];

point[0]            // type is Int (compile-time known index)
point[1]            // type is String

const i = computeIndex();
point[i]            // type is Int | String (elementType)
```

**Subtyping:**
```
[Int, Int, Int] <: Int[]              // Fixed subtypes variable
[Int, String] <: (Int | String)[]     // Heterogeneous subtypes union
```

Fixed-length arrays can be passed where variable-length arrays are expected:
```
const processList = (items: (Int | String)[]) => items.map(x => x);
const pair: [Int, String] = [1, "hello"];
processList(pair);  // OK - [Int, String] <: (Int | String)[]
```

**Variadic arrays:** Supported via `...` syntax:
```
[Int, ...String]   // Int followed by any number of Strings
```

**TypeScript variadic tuples:** `[T, ...U[]]` maps to `[T, ...U]` on `.d.ts` import.

## Special Types

### `this` Type

```typescript
// TypeScript
interface Builder {
  setName(name: string): this;
}
```

**Status:** Supported via `This` type with substitution at property access.

```
// DepJS
type Builder = {
  name: String;
  setName: (name: String) => This;
};

// When accessing setName on a subtype, This is substituted:
type AdvancedBuilder = {
  name: String;
  config: Config;
  setName: (name: String) => This;
  setConfig: (config: Config) => This;
};

const builder: AdvancedBuilder = ...;
builder.setName("x")  // returns AdvancedBuilder, not Builder
```

**Semantics:**
- `This` is substituted with the receiver's type at property access
- Lexically scoped to the innermost enclosing type definition
- Only valid within record type definitions (error elsewhere)
- Enables fluent interfaces and the builder pattern with full type safety

### Branded/Nominal Types

```typescript
// TypeScript (common pattern)
type UserId = string & { readonly __brand: unique symbol };
type OrderId = string & { readonly __brand: unique symbol };
```

**Status:** Supported via `Branded` type constructor with `newtype` syntax sugar.

```
// DepJS - explicit
type UserId = Branded(String, "UserId");
type OrderId = Branded(String, "OrderId");

// DepJS - syntax sugar
newtype UserId = String;
newtype OrderId = String;
```

**Properties:**
```
UserId.baseType    // String
UserId.brand       // "UserId"
```

**Subtyping (strict nominal):**
```
// All type errors:
const a: String = userId;     // ERROR: need explicit unwrap
const b: UserId = "hello";    // ERROR: need explicit wrap
const c: OrderId = userId;    // ERROR: brands don't match
```

**Wrapping/unwrapping (zero runtime cost):**
```
const id: UserId = UserId.wrap("abc123");
const str: String = UserId.unwrap(id);
```

**Importing TypeScript branded types:** The `.d.ts` reader recognizes the `& { readonly __brand: ... }` pattern and converts to `Branded(baseType, brandName)`.

## Importing from .d.ts

DepJS uses standard ES module syntax to import from TypeScript-typed modules. All imported modules **must** have `.d.ts` type definitions.

### Syntax

```
// Named imports
import { readFile, writeFile } from "fs";

// Default imports
import express from "express";

// Namespace imports
import * as path from "path";

// Type-only imports
import type { Request, Response } from "express";

// Mixed
import express, { Router, type Request } from "express";
```

### Resolution

- Standard Node.js module resolution
- Compiler reads `.d.ts` files from `node_modules/@types/*` or bundled declarations
- If no `.d.ts` exists, the import is a compile error

### Type Mapping

TypeScript types in `.d.ts` are mapped to DepJS types per this document:
- `any` → `Unknown`
- `number` → `Number` (supertype of `Int` and `Float`)
- Tuples `[T, U]` → `[T, U]` (fixed-length array, bracket syntax)
- Arrays `T[]` → `T[]` (variable-length array, postfix syntax)
- Variadic tuples `[T, ...U[]]` → `[T, ...U]`
- Unsupported features (template literals) → compile error
- `interface` → record type
- Overloaded functions → intersection of function types

### Calling Imported Functions

```
import { readFileSync } from "fs";

// readFileSync has type from .d.ts
// Call it like any other function
const content = readFileSync("file.txt", "utf-8");
```

Effects (file I/O, console, network) happen at runtime. DepJS treats imported functions as opaque — their implementations are JavaScript.

### Current Scope

**Supported:**
- Single file compilation
- Importing from external modules with `.d.ts`

**Not yet supported:**
- Exporting from DepJS modules
- DepJS-to-DepJS imports
- Multi-file compilation

## Summary Table

| Feature              | Status    | Notes                                          |
|----------------------|-----------|------------------------------------------------|
| Primitive types      | Supported | Direct mapping                                 |
| Numeric types        | Supported | `Int` and `Float` subtype `Number`; TS `number` → `Number` |
| `any` type           | Supported | Maps to `Unknown` on import (preserves soundness) |
| Literal types        | Supported | Direct mapping, `.value` extracts literal      |
| Object types         | Supported | Use `type` only (no `interface`)               |
| Optional properties  | Supported | Same `?` syntax                                |
| Readonly properties  | Supported | All properties readonly by default             |
| Index signatures     | Supported | Via `RecordType([], valueType)`                |
| Union types          | Supported | Direct mapping                                 |
| Intersection types   | Supported | Same `&` syntax                                |
| Generic types        | Partial   | DepJS-defined generics work; .d.ts generic function calls don't infer type arguments (see below) |
| Generic constraints  | Supported | Via `Type<Bound>` bounded type parameter       |
| Default type params  | Supported | Via generics desugaring                        |
| Mapped types         | Supported | Via first-class type functions                 |
| Conditional types    | Supported | Via `.extends()` and ternary                   |
| Distributive cond.   | Supported | Explicit via `.variants.map()`                 |
| Template literals    | Out of scope | String refinements; error on `.d.ts` import    |
| `infer` keyword      | Supported | Via `.returnType`, `.elementType`, `.parameterTypes` |
| `keyof` operator     | Supported | Via `.keysType` property                       |
| `typeof` operator    | Supported | Via `typeOf()` function; `.d.ts` `typeof` also supported |
| Function types       | Supported | Direct mapping                                 |
| Overloaded functions | Supported | Via intersection of function types (`.d.ts` import only) |
| Array/Tuple types    | Supported | `T[]` for variable, `[T, U]` for fixed         |
| Variadic tuples      | Supported | Maps to `[T, ...U]` syntax                     |
| `this` type          | Supported | Via `This` type with substitution at access    |
| Branded types        | Supported | Via `Branded()` constructor, `newtype` sugar   |
| .d.ts imports        | Supported | ES module syntax, Node.js resolution, `.d.ts` required |
| Generic .d.ts calls  | Not yet   | Type args not inferred, return types not instantiated |
| Type alias expansion | Not yet   | Parameterized type aliases from .d.ts not expanded |

### .d.ts Generic Function Calls — Known Gap

DepJS-defined generics work via desugaring: `<T>(x: T) => ...` becomes `(x: T, T: Type = typeOf(x)) => ...`, so type inference happens naturally through default parameter evaluation.

However, `.d.ts`-imported generic functions (e.g., `useState<S>`) use a different representation — `FunctionType` with `TypeVar` parameters — and the type checker currently:
1. Does not collect TypeVar→Type mappings during argument matching
2. Does not call `substituteTypeVars` on the return type
3. Does not preserve type parameter metadata on imported function types

This means `useState(0)` returns `[S, Dispatch<SetStateAction<S>>]` instead of `[Int, Dispatch<SetStateAction<Int>>]`. Additionally, parameterized type aliases like `Dispatch<SetStateAction<S>>` are stored as opaque typeVar strings rather than being expanded to their underlying types.

See CLAUDE.md "Blocking Issues for Working React Example" for the full gap analysis.