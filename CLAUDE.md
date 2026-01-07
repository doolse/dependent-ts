I # CLAUDE.md

This file provides guidance to Claude Code when working on this language specification project.

## Project Overview

DepJS is a new programming language with these known design goals (from initial-ideas.txt):

- **Functional JavaScript subset**: No explicit loops
- **Target language**: JavaScript
- **Implementation language**: TypeScript
- **Type system**: As powerful as TypeScript, with:
  - First-class types that can be manipulated in the language
  - Types erased at runtime unless explicitly reified
- **TypeScript compatibility**: Compatible with as much of TypeScript's type system as possible, with the ability to import types from `.d.ts` files
- **Simple type annotation syntax**: e.g., `const x : Int = 1`
- **Compile-time assertions**: Must be checkable at compile time

## Working on the Specification

### Principles

1. **Under-specify rather than over-specify**: If something hasn't been decided, mark it as TODO rather than inventing details
2. **Ask before assuming**: When a design decision is unclear, ask the user rather than guessing
3. **Show examples**: Use concrete code examples to illustrate features
4. **Track unknowns**: Clearly mark open questions and unresolved decisions

### When Writing Spec Sections

- Only document what has been explicitly decided
- Use `TODO:` markers for undecided details
- Use `OPEN QUESTION:` for decisions that need user input
- Include rationale for decisions when known

## Spec Files

- `spec/syntax.md` - Core syntax decisions (established)
- `spec/types.md` - Type system design (first-class types, properties, comptime)
- `spec/typescript-compat.md` - TypeScript type system compatibility mapping

Create additional spec files as topics are discussed and decided. Don't create placeholder files with invented content.

## Decided

- **Base syntax**: JavaScript-like with curly braces, semicolons required
- **Functions**: Standard JS syntax (arrow functions, function declarations)
- **Type annotations**: TypeScript-style (colon after name)
- **Bindings**: `const` only (immutable)
- **Generics**: Angle brackets `<T>`
- **Data types**: `type` keyword only (no `interface` - record types use `type`)
- **Sum types**: TypeScript-style discriminated unions
- **Pattern matching**: `match` expression with `case` clauses, semicolon separated (see Pattern Matching section)
- **Iteration**: Method chaining (map, filter, reduce, etc.)
- **Modules**: ES modules
- **Compile-time assertions**: `assert` keyword

### Compile-Time Execution Model

- **Fuel-based interpreter**: Compile-time evaluation has a max evaluation count to prevent infinite loops
- **Limited effects**: Some effects allowed at compile time (e.g., file reading for codegen), but kept simple
- **Reification via builtins**: Built-in functions extract type information (e.g., get all properties of a record type)
- **Demand-driven comptime**: Certain positions/builtins implicitly require compile-time evaluation (e.g., type annotations, `assert`). The compiler propagates these requirements backwards.
- **Explicit `comptime` keyword**: Programmers can optionally mark bindings as `comptime` to explicitly require compile-time evaluation
- **Comptime-only code cannot exist at runtime**: Code that uses comptime-only operations (e.g., `.fields`, `.variants`) can only be evaluated at compile time. If such code would need to run at runtime (e.g., escaping into a runtime context), it's a compile error.

### Reserved Keywords / Naming

- **`typeof`**: Reserved for JavaScript's runtime `typeof` operator only
- Use `typeOf(x)` (function call) for compile-time type introspection

### First-Class Types

- **Types are opaque values**: Can be passed around but only inspected via properties
- **Properties over functions**: Use `T.name`, `T.fieldNames`, `T.fields` instead of `typeName(T)`, etc.
- **Runtime vs comptime properties**: Properties returning strings/primitives are runtime-usable; properties returning types are comptime-only
- **`Type` values are comptime-only**: `Type` has no runtime representation. To get type information at runtime, extract runtime-usable properties (e.g., `.name`, `.fieldNames`) at compile time.
- **Instantiated generic types**: Have `.name` (full name like `"Array<String>"`), `.baseName` (base name like `"Array"`), and `.typeArgs` (array of type arguments, comptime-only). Non-generic types have empty `.typeArgs`. Type-specific convenience properties like `.elementType` provide semantic access to type args.
- **Structural subtyping**: Record types are subtypes based on structure
- **`typeOf` uses declared type**: When a value has an explicit type annotation, `typeOf` returns the declared type, not the structural type of the initializer
- **No automatic type narrowing from type inspection**: Checking `typeOf(x).name === "Int"` does not narrow `x`'s type. Use pattern matching for type-based dispatch.

### Type Syntax as Sugar

- **Type syntax desugars to function calls**: There is no separate type-level language; type syntax is sugar for operations on `Type` values
- **Type contexts**: Type syntax is triggered in: `type X = <expr>`, `const x: <expr>`, `<T, U>` generic params/args
- **Desugaring rules**:
  - `A | B` → `Union(A, B)`
  - `A & B` → `Intersection(A, B)`
  - `{ name: String }` → `RecordType([{ name: "name", type: String, optional: false }])`
  - `{| name: String |}` → `RecordType([...], Never)` (closed record)
  - `{ [key: String]: T }` → `RecordType([], T)` (indexed record)
  - `(x: A) => B` → `FunctionType([A], B)`
  - `Array<T>` → `Array(T)` (type application becomes function application)
  - `type Foo = expr` → `const Foo: Type = expr`
- **Built-in type constructors**: `RecordType`, `Union`, `Intersection`, `FunctionType`
- **Parameterized types are functions**: `Array`, `Map`, etc. are functions from Type to Type

### Record Types and FieldInfo

- **FieldInfo type**: `{ name: String, type: Type, optional: Boolean }`
- **RecordType constructor**: `RecordType(fields: Array<FieldInfo>, indexType?: Type)`
- **Record openness via indexType**:
  - `undefined` (default): Open record, extra fields allowed
  - `SomeType`: Indexed record, any string key maps to SomeType
  - `Never`: Closed record, no extra fields allowed
- **Closed record syntax**: `{| ... |}` for records that forbid extra fields
- **`T.keysType`**: Returns union of field name literal types (e.g., `"name" | "age"`) - comptime only
- **`T.fieldNames`**: Returns `Array<String>` of field names - runtime usable

### Literal Types

- String, number, and boolean literals are valid types: `"foo"`, `42`, `true`
- Essential for discriminated unions and type-safe APIs
- `T.keysType` returns a union of string literal types

### Subtype Checking and Conditional Types

- **`T.extends(U)`**: Method returning Boolean - true if T is subtype of U (comptime only)
- **Conditional types**: Use ternary with `.extends()`: `T.extends(U) ? X : Y`

### Mapped Types as Functions

- TypeScript mapped types become regular comptime functions
- Use `T.fields.map()`, `T.fields.filter()`, and `RecordType()` to transform types
- `Pick`, `Omit`, `Partial`, `Required` are user-definable functions, not special syntax
- Type-safe key constraints via `Array<T.keysType>`

### Tuple Types

- **Separate `Tuple` type**: Distinct from Array but subtypes to it
- **Subtyping**: `Tuple(Int, String) <: Array(Int | String)`
- **Labeled tuples supported**: `[x: Int, y: Int]` with optional labels
- **Mixed labels allowed**: `[Int, name: String, Boolean]`
- **TupleElementInfo**: `{ type: Type, label: String | Undefined }`
- **Properties**: `.typeArgs`, `.elementType` (union), `.elements`, `.length` (minimum for variadic)
- **Indexed access**: Compile-time constant index gives specific type; runtime index gives union
- **Variadic tuples**: Out of scope - error on `.d.ts` import; could extend `TupleElementInfo` with `rest: Boolean` later

### Overloaded Functions

- **Import representation**: Intersection of function types: `((String) => Number) & ((Number) => String)`
- **Call semantics**: Order-dependent, first matching signature wins (matches TypeScript)
- **Union arguments**: Return union of all matching return types
- **Properties**: `.signatures` returns ordered array of function types; `.parameterTypes`/`.returnType` error for ambiguity
- **Writing overloads**: Not supported in DepJS - use pattern matching instead
- **Subtyping**: Overloaded function is subtype of each individual signature and of union covering all cases

### Branded/Nominal Types

- **`Branded` type constructor**: `Branded(baseType: Type, brand: String) => Type`
- **`newtype` syntax sugar**: `newtype UserId = String` desugars to `Branded(String, "UserId")`
- **Properties**: `.baseType`, `.brand`
- **Strict nominal subtyping**: No implicit conversion between branded type and base type, or between different brands
- **Wrap/unwrap**: `TypeName.wrap(value)` and `TypeName.unwrap(value)` - zero runtime cost, type-checking only
- **Use cases**: Preventing ID mixups, type-safe units, domain modeling

### This Type (Fluent Interfaces)

- **`This` is a special type**: Only valid within record type definitions
- **Substitution at property access**: When accessing a property that uses `This`, the receiver's type is substituted
- **Lexical scoping**: `This` refers to the innermost enclosing type definition
- **Use cases**: Fluent interfaces, builder pattern, method chaining with type preservation

### Generics as Type Parameters with Defaults

- **Type params come last**: `<T>(x: T)` desugars to `(x: T, T: Type = typeOf(x))`
- **Inference via defaults**: Type parameters have defaults that reference value parameters
- **Partial inference supported**: Unlike TypeScript, you can provide some type args and infer the rest
- **Unambiguous calls**: `identity("hello")` clearly passes to x; `identity("hello", String)` provides T explicitly

### Pattern Matching

- **Syntax**: `match (expr) { case pattern: result; ... };`
- **Pattern types**: Literal, type, property (destructuring), nested, wildcard (`_`)
- **Binding**: Implicit (property name becomes variable), explicit rename (`value: v`)
- **Guards**: `when` clause for additional conditions: `case Int when x > 0: "positive"`
- **Type narrowing**: Inside case body, matched expression's type is narrowed
- **Exhaustiveness**: Compiler verifies all cases handled; wildcard satisfies exhaustiveness
- **Discriminant identification**: TypeScript approach - any property with distinct literal types across variants
- **Expression**: Returns a value; return type is union of branch types

## Open Questions

These need to be resolved through discussion:
- TODO: What can be asserted with `assert`
- TODO: How to handle side effects (pure functional vs controlled effects)
- TODO: Error handling model
- TODO: JavaScript interop story
- TODO: Async handling
- TODO: Refinement types syntax and semantics (see spec/types.md for current thinking)
