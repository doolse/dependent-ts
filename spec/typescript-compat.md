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
| `number` | `Number` | TODO: Do we distinguish Int/Float? |
| `boolean` | `Boolean` | Direct mapping |
| `null` | `Null` | Direct mapping |
| `undefined` | `Undefined` | Direct mapping |
| `void` | `Void` | For function returns |
| `never` | `Never` | Bottom type |
| `unknown` | `Unknown` | Top type |
| `any` | TODO | Do we support `any`? Contradicts type safety goals |

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

**Status:** TODO - Index signature support not yet decided.

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

**Status:** Syntax supported, but exact desugaring TBD. The `<T extends Foo>` syntax is recognized, but how it desugars to the type-params-at-end model needs design work (see types.md).

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

TypeScript provides built-in utility types. In DepJS, many of these can be implemented as functions operating on first-class types.

### Partial<T>

```typescript
// TypeScript (built-in)
type Partial<T> = { [P in keyof T]?: T[P] };
```

```
// DepJS - as a function using type properties
const Partial = (T: Type): Type => {
  // T.fields returns { fieldName: { type: Type }, ... }
  const newFields = T.fields.map((field) => ({
    name: field.name,
    type: field.type,
    optional: true
  }));
  return RecordType(newFields);
};
```

**Status:** TODO - The type properties (`.fields` returning `Array<FieldInfo>`) are defined. Need to finalize `RecordType` construction API to accept optional fields.

### Required<T>

```typescript
// TypeScript (built-in)
type Required<T> = { [P in keyof T]-?: T[P] };
```

**Status:** TODO - Same as Partial.

### Pick<T, K>

```typescript
// TypeScript
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
```

**Status:** TODO - Depends on mapped type support.

### Omit<T, K>

```typescript
// TypeScript
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
```

**Status:** TODO - Depends on mapped type support.

### Record<K, V>

```typescript
// TypeScript
type Record<K extends keyof any, T> = { [P in K]: T };
```

**Status:** TODO - Depends on mapped type support.

## Mapped Types

```typescript
// TypeScript
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Nullable<T> = { [P in keyof T]: T[P] | null };
```

**Status:** TODO - DepJS uses first-class type functions instead of special mapped type syntax:

```
// DepJS encoding using type properties
const Nullable = (T: Type): Type => {
  // T.fields returns Array<FieldInfo> where FieldInfo = { name: String, type: Type }
  const newFields = T.fields.map((field) => ({
    name: field.name,
    type: Union(field.type, Null)
  }));
  return RecordType(newFields);
};
```

Note: All properties in DepJS are readonly by default, so `Readonly<T>` is a no-op.

OPEN QUESTION: Exact signature for `RecordType` when constructing from field arrays vs object literals.

## Conditional Types

```typescript
// TypeScript
type IsString<T> = T extends string ? true : false;
type Flatten<T> = T extends Array<infer U> ? U : T;
```

**Status:** TODO - Conditional types in TypeScript are very powerful. In DepJS, these could be regular functions with pattern matching:

```
// DepJS potential encoding
const IsString = (T) => match (T) {
  case String: true;
  case _: false;
};

const Flatten = (T) => match (T) {
  case Array<U>: U;  // TODO: How does pattern matching on types work?
  case _: T;
};
```

OPEN QUESTION: Can we pattern match on types? How do we extract type parameters?

## Template Literal Types

```typescript
// TypeScript
type Greeting = `Hello, ${string}`;
type EmailLocaleIDs = `${string}_email_id`;
```

**Status:** TODO - Template literal types not yet decided.

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
const PersonKeys = Person.fieldNames;  // ["name", "age"] at runtime
// But as a type: ???
```

**Status:** TODO - `keyof` produces a union of literal types. We have `.fieldNames` which returns `Array<String>`. Need to decide if there's a way to get a union type.

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
interface Overloaded {
  (x: string): string;
  (x: number): number;
}
```

**Status:** TODO - Function overloading not yet decided.

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

## Tuple Types

```typescript
// TypeScript
type Point = [number, number];
type NamedPoint = [x: number, y: number];  // Labeled tuple
type VarArgs = [string, ...number[]];  // Variadic tuple
```

**Status:** TODO - Tuple type support not yet decided.

## Special Types

### `this` Type

```typescript
// TypeScript
interface Builder {
  setName(name: string): this;
}
```

**Status:** TODO - `this` type for fluent interfaces not yet decided.

### Branded/Nominal Types

```typescript
// TypeScript (common pattern)
type UserId = string & { readonly __brand: unique symbol };
```

**Status:** TODO - DepJS uses structural typing. Nominal typing pattern not yet decided.

## Importing from .d.ts

OPEN QUESTION: How does DepJS import types from `.d.ts` files?

```
// Potential syntax
import type { SomeType } from "some-library";
```

Considerations:
- Which TypeScript features must be supported for practical .d.ts compatibility?
- How do we handle features DepJS doesn't support (e.g., `any`)?
- Do we need a subset of .d.ts or full compatibility?

## Summary Table

| Feature | Status | Notes |
|---------|--------|-------|
| Primitive types | Supported | Direct mapping |
| Literal types | Supported | Direct mapping |
| Object types | Supported | Use `type` only (no `interface`) |
| Optional properties | Supported | Same `?` syntax |
| Readonly properties | Supported | All properties readonly by default |
| Index signatures | TODO | Not decided |
| Union types | Supported | Direct mapping |
| Intersection types | Supported | Same `&` syntax |
| Generic types | Supported | Direct mapping |
| Generic constraints | Partial | Syntax recognized, desugaring TBD |
| Default type params | Supported | Via generics desugaring |
| Mapped types | TODO | Use first-class type functions |
| Conditional types | TODO | Use pattern matching on types |
| Template literals | TODO | Not decided |
| `infer` keyword | Supported | Via `.returnType`, `.elementType` properties |
| `keyof` operator | Partial | Have `.fieldNames`, need union |
| `typeof` operator | Supported | Via `typeOf()` function |
| Function types | Supported | Direct mapping |
| Overloaded functions | TODO | Not decided |
| Tuple types | TODO | Not decided |
| `this` type | TODO | Not decided |
| Branded types | TODO | Structural typing only |
| .d.ts imports | TODO | Critical for interop |