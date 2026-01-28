# TypeScript .d.ts Loader

This document specifies how the DepJS compiler loads and translates TypeScript `.d.ts` type definitions into DepJS types.

## Overview

The `.d.ts` loader:
1. Parses TypeScript declaration files using Lezer's TypeScript grammar
2. Translates TypeScript type constructs to DepJS `Type` values
3. Pattern-matches complex TypeScript idioms (conditional types, `infer`) into simpler DepJS equivalents

## Pipeline Integration

```
.d.ts file
    │
    ▼
┌─────────────────────────────────────┐
│    Lezer TypeScript Parser          │  Source → Lezer Tree
│    (@lezer/javascript dialect:ts)   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│    DTS Translator                   │  Lezer Tree → DepJS Types
│    (pattern matching + translation) │
└────────┬────────────────────────────┘
         │
         ▼
    Map<string, TypeBinding>
    (exported names → types)
```

The loader is invoked during type checking when an `import` declaration is encountered.

## Basic Type Mappings

### Primitives

| TypeScript | DepJS |
|------------|-------|
| `string` | `String` |
| `number` | `Number` |
| `boolean` | `Boolean` |
| `null` | `Null` |
| `undefined` | `Undefined` |
| `void` | `Void` |
| `never` | `Never` |
| `unknown` | `Unknown` |
| `any` | `Unknown` |
| `bigint` | `BigInt` |
| `symbol` | `Symbol` |

### Literal Types

| TypeScript | DepJS |
|------------|-------|
| `"hello"` | `LiteralType("hello")` |
| `42` | `LiteralType(42)` |
| `true` | `LiteralType(true)` |

### Composite Types

| TypeScript | DepJS |
|------------|-------|
| `A \| B` | `Union(A, B)` |
| `A & B` | `Intersection(A, B)` |
| `T[]` | `Array(T)` |
| `[A, B]` | `Array(A, B)` (fixed-length) |
| `{ a: T }` | `RecordType([{ name: "a", type: T, optional: false }])` |
| `{ a?: T }` | `RecordType([{ name: "a", type: T, optional: true }])` |
| `(x: A) => B` | `FunctionType([A], B)` |

## Pattern Matching for Conditional Types

TypeScript conditional types are translated to DepJS comptime functions. The translation depends on what patterns are present.

### Simple Conditional Types

**TypeScript:**
```typescript
type IsString<T> = T extends string ? true : false;
```

**DepJS translation:**
```
const IsString = (T: Type): Type => T.extends(String) ? true : false;
```

**Rule:** `T extends U ? X : Y` → `T.extends(U) ? X : Y`

### Distributive Conditional Types

When a conditional type's checked type is a naked type parameter, TypeScript distributes over unions.

**TypeScript:**
```typescript
type ToArray<T> = T extends any ? T[] : never;
// ToArray<A | B> = A[] | B[]
```

**DepJS translation:**
```
const ToArray = (T: Type): Type =>
  Union(...T.variants.map(v => Array(v)));
```

**Detection rule:** If the pattern is `T extends any ? ... : never` or `T extends unknown ? ... : never` where `T` is a naked type parameter, treat as distributive.

## Pattern Matching for `infer`

The `infer` keyword is translated by recognizing structural patterns and mapping them to DepJS type properties.

### Pattern 1: Function Return Type

**TypeScript:**
```typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
```

**DepJS translation:**
```
const ReturnType = (T: Type): Type => T.returnType;
```

**Recognition:**
- Condition: `T extends (...) => infer R`
- True branch: `R` (the inferred variable)
- False branch: `never`

**Rule:** Extract `.returnType` property.

### Pattern 2: Function Parameter Types

**TypeScript:**
```typescript
type Parameters<T> = T extends (...args: infer P) => any ? P : never;
```

**DepJS translation:**
```
const Parameters = (T: Type): Type => Array(...T.parameterTypes);
```

**Recognition:**
- Condition: `T extends (...args: infer P) => any`
- True branch: `P`
- False branch: `never`

**Rule:** Extract `.parameterTypes` property (returns array of types).

### Pattern 3: First Parameter Type

**TypeScript:**
```typescript
type FirstArg<T> = T extends (first: infer F, ...args: any[]) => any ? F : never;
```

**DepJS translation:**
```
const FirstArg = (T: Type): Type => T.parameterTypes[0] ?? Never;
```

**Recognition:**
- Condition: `T extends (first: infer F, ...) => any`
- Infer position: first parameter

**Rule:** Extract `.parameterTypes[0]`.

### Pattern 4: Array Element Type

**TypeScript:**
```typescript
type ElementType<T> = T extends (infer U)[] ? U : never;
// or
type ElementType<T> = T extends Array<infer U> ? U : never;
```

**DepJS translation:**
```
const ElementType = (T: Type): Type => T.elementType;
```

**Recognition:**
- Condition: `T extends X[]` or `T extends Array<infer U>`
- True branch: the inferred element type
- False branch: `never`

**Rule:** Extract `.elementType` property.

### Pattern 5: Generic Type Arguments

**TypeScript:**
```typescript
type ContextType<C> = C extends Context<infer T> ? T : never;
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
```

**DepJS translation:**
```
const ContextType = (C: Type): Type => C.typeArgs[0];
const UnwrapPromise = (T: Type): Type =>
  T.extends(Promise) ? T.typeArgs[0] : T;
```

**Recognition:**
- Condition: `T extends SomeGeneric<infer A, infer B, ...>`
- True branch uses the inferred variables

**Rule:** Extract `.typeArgs[n]` for position `n` of each `infer`.

### Pattern 6: Tuple Element Extraction

**TypeScript:**
```typescript
type First<T> = T extends [infer F, ...any[]] ? F : never;
type Rest<T> = T extends [any, ...infer R] ? R : never;
type Last<T> = T extends [...any[], infer L] ? L : never;
```

**DepJS translation:**
```
const First = (T: Type): Type => T.elements?.[0]?.type ?? Never;
const Rest = (T: Type): Type =>
  T.elements ? Array(...T.elements.slice(1).map(e => e.type)) : Never;
const Last = (T: Type): Type =>
  T.elements?.[T.elements.length - 1]?.type ?? Never;
```

**Recognition:**
- Condition: `T extends [infer X, ...]` pattern
- Position of `infer` determines which element

**Rule:** Extract from `.elements` array by position.

### Pattern 7: Record Property Extraction

**TypeScript:**
```typescript
type PropType<T, K> = T extends { [key in K]: infer V } ? V : never;
// Simpler form:
type RefType<T> = T extends { ref?: infer R } ? R : never;
```

**DepJS translation:**
```
const PropType = (T: Type, K: Type): Type => {
  const field = T.fields.find(f => f.name == K.value);
  return field?.type ?? Never;
};

const RefType = (T: Type): Type => {
  const field = T.fields.find(f => f.name == "ref");
  return field?.type ?? Never;
};
```

**Recognition:**
- Condition: `T extends { propName: infer X }` or `T extends { propName?: infer X }`
- Property name is literal

**Rule:** Look up property in `.fields` by name.

### Pattern 8: Constructor Instance Type

**TypeScript:**
```typescript
type InstanceType<T> = T extends abstract new (...args: any) => infer R ? R : any;
```

**DepJS translation:**
```
const InstanceType = (T: Type): Type => T.instanceType ?? Unknown;
```

**Recognition:**
- Condition: `T extends new (...) => infer R` or `T extends abstract new (...) => infer R`

**Rule:** Extract `.instanceType` property (for class types).

## Nested Conditional Types

When conditional types are nested, translate from outside-in:

**TypeScript:**
```typescript
type Deep<T> = T extends Promise<infer U>
  ? U extends Array<infer V>
    ? V
    : U
  : T;
```

**DepJS translation:**
```
const Deep = (T: Type): Type =>
  T.extends(Promise)
    ? (T.typeArgs[0].extends(Array)
        ? T.typeArgs[0].elementType
        : T.typeArgs[0])
    : T;
```

## Mapped Types

**TypeScript:**
```typescript
type Readonly<T> = { readonly [K in keyof T]: T[K] };
type Partial<T> = { [K in keyof T]?: T[K] };
```

**DepJS translation:**
```
const Readonly = (T: Type): Type => T;  // All properties readonly by default

const Partial = (T: Type): Type =>
  RecordType(T.fields.map(f => ({ ...f, optional: true })));
```

**Recognition:**
- `{ [K in keyof T]: ... }` pattern
- Iterate over `.fields` and transform

### Mapped Type with Conditional

**TypeScript:**
```typescript
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K]
};
```

**DepJS translation:**
```
const PickByType = (T: Type, U: Type): Type =>
  RecordType(T.fields.filter(f => f.type.extends(U)));
```

## Handling `keyof`

**TypeScript:**
```typescript
type Keys<T> = keyof T;
```

**DepJS translation:**
```
const Keys = (T: Type): Type => T.keysType;
```

The `.keysType` property returns a union of string literal types.

## Indexed Access Types

**TypeScript:**
```typescript
type PropType<T, K extends keyof T> = T[K];
```

**DepJS translation:**
```
const PropType = (T: Type, K: Type): Type => {
  // K is a literal type like "name"
  const field = T.fields.find(f => LiteralType(f.name).extends(K));
  return field?.type ?? Never;
};
```

For union keys:
```
const PropTypes<T, K extends keyof T> = T[K];
// When K is "a" | "b", returns T["a"] | T["b"]
```

**DepJS translation:**
```
const PropTypes = (T: Type, K: Type): Type =>
  Union(...K.variants.map(k => {
    const field = T.fields.find(f => f.name == k.value);
    return field?.type ?? Never;
  }));
```

## Namespaces

TypeScript namespaces are translated to record types with type properties:

**TypeScript:**
```typescript
declare namespace React {
  type ReactNode = ...;
  interface Component<P> { ... }
  function createElement(...): ReactElement;
}
```

**DepJS translation:**
```
const React = {
  ReactNode: ...,
  Component: (P: Type): Type => RecordType([...]),
  createElement: FunctionType([...], ReactElement),
};
```

Namespace members become properties of a record value.

## Classes

Classes are translated to a combination of:
1. Constructor function type
2. Instance type (record of methods/properties)
3. Static members

**TypeScript:**
```typescript
declare class Component<P, S> {
  props: P;
  state: S;
  setState(state: Partial<S>): void;
  render(): ReactNode;
}
```

**DepJS translation:**
```
// Instance type
type ComponentInstance<P, S> = {
  props: P;
  state: S;
  setState: (state: Partial<S>) => Void;
  render: () => ReactNode;
};

// Constructor type
const Component = (P: Type, S: Type): Type =>
  WithMetadata(
    ComponentInstance(P, S),
    {
      constructorType: FunctionType([P], ComponentInstance(P, S)),
      instanceType: ComponentInstance(P, S)
    }
  );
```

## Interface Merging

When multiple interfaces with the same name are encountered, merge their members:

**TypeScript:**
```typescript
interface A { x: number; }
interface A { y: string; }
// Merged: interface A { x: number; y: string; }
```

**Strategy:** During loading, accumulate all declarations for each name, then merge before producing the final type.

## Unsupported Features

The following TypeScript features produce compile errors when encountered:

| Feature | Error Message |
|---------|---------------|
| Template literal types | "Template literal types are not supported" |
| `enum` declarations | "Enums are not supported; use union of literals" |
| `declare module` augmentation | "Module augmentation is not supported" |
| Decorators | "Decorators are not supported" |

## Error Recovery

When an unsupported pattern is encountered within a supported construct, the loader:
1. Emits a warning
2. Substitutes `Unknown` for the unsupported portion
3. Continues processing

This allows partial use of `.d.ts` files that contain some unsupported features.

## Translation Algorithm

```
translateType(node: TSTypeNode): Type {
  switch (node.type) {
    case "TypeReference":
      return resolveTypeReference(node);

    case "UnionType":
      return Union(...node.members.map(translateType));

    case "IntersectionType":
      return Intersection(...node.members.map(translateType));

    case "ConditionalType":
      return translateConditionalType(node);

    case "MappedType":
      return translateMappedType(node);

    case "IndexedAccessType":
      return translateIndexedAccess(node);

    // ... other cases
  }
}

translateConditionalType(node: TSConditionalType): Type | ComptimeFunction {
  // Try pattern matching first
  const pattern = matchInferPattern(node);
  if (pattern) {
    return pattern.translation;
  }

  // Fall back to general conditional
  const check = translateType(node.checkType);
  const extend = translateType(node.extendsType);
  const trueType = translateType(node.trueType);
  const falseType = translateType(node.falseType);

  // If all parts are concrete types, evaluate now
  if (isConcrete(check)) {
    return isSubtype(check, extend) ? trueType : falseType;
  }

  // Otherwise, return a comptime function
  return (T: Type) => T.extends(extend) ? trueType : falseType;
}
```

## Caching

Parsed `.d.ts` files are cached by absolute path. The cache is invalidated when:
- The file's mtime changes
- The compiler is restarted

## Module Resolution

The loader uses Node.js-style module resolution:

1. Check for `.d.ts` file at exact path
2. Check `package.json` `types` or `typings` field
3. Check `@types/<package>` in node_modules
4. Check `index.d.ts` in package directory

## Appendix: React Types Translation Examples

This section shows how real patterns from `@types/react` translate.

### ContextType

**TypeScript:**
```typescript
type ContextType<C extends Context<any>> = C extends Context<infer T> ? T : never;
```

**Pattern:** Generic type argument extraction (Pattern 5)

**DepJS:**
```
const ContextType = (C: Type<Context<Unknown>>): Type => C.typeArgs[0];
```

### ComponentProps

**TypeScript:**
```typescript
type ComponentProps<T extends keyof JSX.IntrinsicElements | JSXElementConstructor<any>> =
  T extends JSXElementConstructor<infer Props> ? Props
  : T extends keyof JSX.IntrinsicElements ? JSX.IntrinsicElements[T]
  : {};
```

**Pattern:** Chained conditionals with generic type arg extraction + indexed access

**DepJS:**
```
const ComponentProps = (T: Type): Type =>
  T.extends(JSXElementConstructor)
    ? T.typeArgs[0]
    : LiteralType(T.value).extends(JSX.IntrinsicElements.keysType)
      ? JSX.IntrinsicElements.fields.find(f => f.name == T.value)?.type ?? RecordType([])
      : RecordType([]);
```

### ComponentRef

**TypeScript:**
```typescript
type ComponentRef<T extends ElementType> =
  ComponentPropsWithRef<T> extends RefAttributes<infer Method> ? Method : never;
```

**Pattern:** Generic type arg extraction from computed type

**DepJS:**
```
const ComponentRef = (T: Type): Type => {
  const propsWithRef = ComponentPropsWithRef(T);
  return propsWithRef.extends(RefAttributes)
    ? propsWithRef.typeArgs[0]
    : Never;
};
```

### ReducerState

**TypeScript:**
```typescript
type ReducerState<R extends Reducer<any, any>> = R extends Reducer<infer S, any> ? S : never;
```

**Pattern:** Generic type argument extraction (Pattern 5)

**DepJS:**
```
const ReducerState = (R: Type<Reducer<Unknown, Unknown>>): Type => R.typeArgs[0];
```

### FunctionComponentElement.ref (complex nested)

**TypeScript:**
```typescript
ref?: ("ref" extends keyof P ? P extends { ref?: infer R | undefined } ? R : never : never) | undefined;
```

**Pattern:** Nested conditional with `keyof` check + property extraction

**DepJS:**
```
const extractRef = (P: Type): Type => {
  const hasRefKey = LiteralType("ref").extends(P.keysType);
  if (!hasRefKey) return Never;
  const refField = P.fields.find(f => f.name == "ref");
  return refField?.type ?? Never;
};

// In the record type:
{ ref: Union(extractRef(P), Undefined), optional: true }
```

### ReactManagedAttributes

**TypeScript:**
```typescript
type ReactManagedAttributes<C, P> = C extends { defaultProps: infer D } ? Defaultize<P, D> : P;
```

**Pattern:** Property extraction (Pattern 7)

**DepJS:**
```
const ReactManagedAttributes = (C: Type, P: Type): Type => {
  const defaultPropsField = C.fields.find(f => f.name == "defaultProps");
  return defaultPropsField
    ? Defaultize(P, defaultPropsField.type)
    : P;
};
```

### LibraryManagedAttributes (deeply nested)

**TypeScript:**
```typescript
type LibraryManagedAttributes<C, P> = C extends
    React.MemoExoticComponent<infer T> | React.LazyExoticComponent<infer T>
    ? T extends React.MemoExoticComponent<infer U> | React.LazyExoticComponent<infer U>
        ? ReactManagedAttributes<U, P>
        : ReactManagedAttributes<T, P>
    : ReactManagedAttributes<C, P>;
```

**Pattern:** Union in extends position with nested unwrapping

**DepJS:**
```
const LibraryManagedAttributes = (C: Type, P: Type): Type => {
  // Check if C is MemoExoticComponent or LazyExoticComponent
  const isMemoOrLazy = C.extends(MemoExoticComponent) || C.extends(LazyExoticComponent);

  if (isMemoOrLazy) {
    const T = C.typeArgs[0];
    // Check if T is also wrapped
    const tIsMemoOrLazy = T.extends(MemoExoticComponent) || T.extends(LazyExoticComponent);
    if (tIsMemoOrLazy) {
      const U = T.typeArgs[0];
      return ReactManagedAttributes(U, P);
    }
    return ReactManagedAttributes(T, P);
  }

  return ReactManagedAttributes(C, P);
};
```

### Key JSX Types for Component Usage

For basic JSX support, the critical types are:

```
// Core types needed for <div onClick={...}>
JSX.IntrinsicElements.div  // → DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>

// Which expands to (simplified):
{
  onClick?: (event: MouseEvent) => Void;
  className?: String;
  style?: CSSProperties;
  children?: ReactNode;
  // ... ~200 more HTML attributes
}
```

The loader can pre-expand these for common elements to avoid runtime expansion cost.

## Implementation Status

**Location:** `src/dts-loader/`

### Completed (Prototype)

| Feature | File | Notes |
|---------|------|-------|
| Lezer TypeScript parser setup | `dts-parser.ts` | Uses `@lezer/javascript` with `dialect: "ts"` |
| Tree traversal utilities | `dts-parser.ts` | `printTree`, `getText`, `findChild`, `getChildren` |
| Basic type translation | `dts-translator.ts` | Translates Lezer AST → DepJS `Type` values |
| Primitive types | `dts-translator.ts` | `string` → `String`, `number` → `Number`, etc. |
| Literal types | `dts-translator.ts` | `true`, `"hello"`, `42` |
| Union/intersection types | `dts-translator.ts` | `A \| B`, `A & B` |
| Object/interface types | `dts-translator.ts` | Properties, optional fields |
| Function types | `dts-translator.ts` | Parameters, return types, rest params |
| Array types | `dts-translator.ts` | `T[]`, `Array<T>` |
| Tuple types | `dts-translator.ts` | `[A, B, C]` |
| Type parameters | `dts-translator.ts` | Tracked in scope, stored as `TypeVarType` |
| `declare function` | `dts-translator.ts` | Stored in `values` map |
| `declare class` | `dts-translator.ts` | Instance type stored in `types` map |
| `declare namespace` | `dts-translator.ts` | Members prefixed and merged |
| Tests | `*.test.ts` | 30 tests total (15 parser, 15 translator) |

### Not Yet Implemented

| Feature | Priority | Notes |
|---------|----------|-------|
| Conditional types | High | Implemented - returns union of true/false branches, extraction patterns handled |
| `infer` keyword | High | Implemented - inferred types tracked in scope |
| `keyof` operator | Done | Inline records resolve immediately; type references create deferred `KeyofType` |
| Indexed access `T[K]` | Done | Inline records with literal keys resolve immediately; others create `IndexedAccessType` |
| Mapped types | Medium | Not translated |
| Type resolution | High | Cross-references not resolved at translation time; deferred to type checking |
| Module resolution | Done | Node.js style resolution from `node_modules` including `@types/*` |
| Interface merging | Medium | Not implemented |
| Generic type instantiation | Medium | Parameterized types stored as placeholders |
| Overloaded functions | Done | Handled as intersection of function types |

### Suggested Next Step

**Load React types** to identify gaps:

```typescript
import { loadDTS } from "./dts-loader";
import * as fs from "fs";

const reactTypes = fs.readFileSync("node_modules/@types/react/index.d.ts", "utf-8");
const result = loadDTS(reactTypes);

console.log("Types loaded:", result.types.size);
console.log("Values loaded:", result.values.size);
console.log("Errors:", result.errors.length);
```

This will reveal:
1. Which TypeScript constructs are missing
2. How many conditional types / `infer` patterns need handling
3. Whether the namespace handling works for the `React` namespace
4. Performance characteristics (4000+ lines)

## Open Questions

1. **Cross-file references:** How to handle `/// <reference path="..." />`?
2. **Recursive types:** How to handle types that reference themselves?
3. **Overloaded functions:** Current spec says intersection - confirm this works for all cases?
4. **Generic defaults:** How to handle `type Foo<T = string>`?
5. **Pre-expansion:** Should we pre-expand utility types like `DetailedHTMLProps` during loading, or keep them as function calls?
