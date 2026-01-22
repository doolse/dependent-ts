# CLAUDE.md

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

### Language Specification
- `spec/syntax.md` - Core syntax decisions (established)
- `spec/types.md` - Type system design (first-class types, properties, comptime)
- `spec/typescript-compat.md` - TypeScript type system compatibility mapping

### Implementation Specification
- `spec/impl/overview.md` - Pipeline overview, architecture
- `spec/impl/core-ast.md` - Shared AST types (CoreAST, Type, TypedAST, RuntimeAST)
- `spec/impl/lezer.md` - Lezer grammar, parsing, space-sensitive `<` handling
- `spec/impl/desugar.md` - Desugaring transforms (Lezer Tree → CoreAST)
- `spec/impl/typecheck.md` - Type checking + comptime eval
- `spec/impl/erasure.md` - Comptime elimination (TypedAST → RuntimeAST)
- `spec/impl/codegen.md` - JS output (RuntimeAST → JavaScript)

Create additional spec files as topics are discussed and decided. Don't create placeholder files with invented content.

## Decided

- **Base syntax**: JavaScript-like with curly braces, semicolons required
- **Functions**: Standard JS syntax (arrow functions, function declarations)
- **Type annotations**: TypeScript-style (colon after name)
- **Bindings**: `const` only (immutable)
- **Generics**: Angle brackets `<T>`
- **Comparison operators**: Space-sensitive disambiguation with `<` and `>`; `==` is strict equality (no loose equality)
- **Data types**: `type` keyword only (no `interface` - record types use `type`)
- **Sum types**: TypeScript-style discriminated unions
- **Pattern matching**: `match` expression with `case` clauses, semicolon separated (see Pattern Matching section)
- **Iteration**: Method chaining (map, filter, reduce, etc.)
- **Tail call optimization**: Compiler transforms tail-recursive functions to while loops (since JS engines don't implement TCO)
- **Modules**: ES modules
- **Compile-time assertions**: `assert` builtin function (see Compile-Time Assertions section)

### Compile-Time Execution Model

- **Fuel-based interpreter**: Compile-time evaluation has a max evaluation count to prevent infinite loops
- **Limited effects**: Some effects allowed at compile time (e.g., file reading for codegen), but kept simple
- **Reification via builtins**: Built-in functions extract type information (e.g., get all properties of a record type)
- **Demand-driven comptime**: Certain positions/builtins implicitly require compile-time evaluation (e.g., type annotations, `assert`). The compiler propagates these requirements backwards.
- **Explicit `comptime` keyword**: Programmers can optionally mark bindings as `comptime` to explicitly require compile-time evaluation
- **Comptime-only code cannot exist at runtime**: Code that uses comptime-only operations (e.g., `.fields`, `.variants`) can only be evaluated at compile time. If such code would need to run at runtime (e.g., escaping into a runtime context), it's a compile error.
- **`Comptime` namespace for effects**: Compile-time effect functions live under the `Comptime` namespace (e.g., `Comptime.readFile(path)`). Named with capital C to avoid conflict with the `comptime` keyword. This makes them discoverable and explicitly marks them as comptime-only.

### Reserved Keywords / Naming

- **`typeof`**: Reserved for JavaScript's runtime `typeof` operator only
- Use `typeOf(x)` (function call) for compile-time type introspection

### Space Sensitivity for Comparison Operators

- **`<` and `>` disambiguation**: Space determines meaning
  - `f<T>` (no space) → type argument application
  - `f < T` (space) → less-than comparison
- **Rule**: `<` immediately after identifier = type arguments; `<` after whitespace = comparison
- **Same for `>`**: closing type arguments vs greater-than
- **Example**:
  ```
  f<Int>(x)     // type argument call
  f < x         // comparison
  a < b && c > d  // two comparisons (spaces required)
  ```

### Equality Operators

- **`==` is strict equality**: Equivalent to JavaScript's `===` (type and value must match)
- **`!=` is strict inequality**: Equivalent to JavaScript's `!==`
- **No loose equality**: There is no equivalent to JavaScript's `==` or `!=` (loose equality)
- **Rationale**: Loose equality is universally considered a JavaScript design mistake. With DepJS's type system, you know types at compile time, so the "convenience" of loose equality is unnecessary. All major style guides enforce strict equality anyway.
- **Example**:
  ```
  5 == 5        // true
  5 == "5"      // false (and likely a type error)
  null == undefined  // false (strict comparison)
  ```

### First-Class Types

- **Types are opaque values**: Can be passed around but only inspected via properties
- **Properties over functions**: Use `T.name`, `T.fieldNames`, `T.fields` instead of `typeName(T)`, etc.
- **Runtime vs comptime properties**: Properties returning strings/primitives are runtime-usable; properties returning types are comptime-only
- **`Type` values are comptime-only**: `Type` has no runtime representation. To get type information at runtime, extract runtime-usable properties (e.g., `.name`, `.fieldNames`) at compile time.
- **Instantiated generic types**: Have `.name` (full name like `"Array<String>"`), `.baseName` (base name like `"Array"`), and `.typeArgs` (array of type arguments, comptime-only). Non-generic types have empty `.typeArgs`. Type-specific convenience properties like `.elementType` provide semantic access to type args.
- **Structural subtyping**: Record types are subtypes based on structure
- **`typeOf` uses declared type**: When a value has an explicit type annotation, `typeOf` returns the declared type, not the structural type of the initializer
- **No automatic type narrowing from type inspection**: Checking `typeOf(x).name == "Int"` does not narrow `x`'s type. Use pattern matching for type-based dispatch.

### Type Syntax as Sugar

- **Type syntax desugars to function calls**: There is no separate type-level language; type syntax is sugar for operations on `Type` values
- **`<>` vs `()` for function/constructor calls**:
  - `f<args>` — arguments are parsed with **type syntax** (sugar applies)
  - `f(args)` — arguments are parsed with **expression syntax** (no sugar)
  - `f<typeArgs>(valueArgs)` — type syntax for type args, expression syntax for value args
- **Type contexts**: Type syntax is triggered in:
  - `type X = <expr>` — the expression after `=`
  - `const x: <expr>` — the type annotation
  - `<T, U>` — generic parameter declarations
  - `f<args>` — arguments inside angle brackets
- **Desugaring rules** (in type syntax):
  - `A | B` → `Union<A, B>`
  - `A & B` → `Intersection<A, B>`
  - `{ name: String }` → `RecordType([{ name: "name", type: String, optional: false }])`
  - `{| name: String |}` → `RecordType([...], Never)` (closed record)
  - `{ [key: String]: T }` → `RecordType([], T)` (indexed record)
  - `(x: A) => B` → `FunctionType<[A], B>`
  - `type Foo = expr` → `const Foo: Type = expr`
  - `x is T` → `typeOf(x).extends(T)` (type predicate)
  - `"hello"` (literal in type context) → `LiteralType("hello")`
- **`<>` works on any function**: Not just type constructors. Allows passing inline record types to any function expecting `Type`
- **Built-in type constructors**: `RecordType`, `Union`, `Intersection`, `FunctionType`, `LiteralType`
- **Parameterized types are functions**: `Array`, `Map`, etc. are functions from Type to Type
- **`|` and `&` operators**:
  - In type syntax: `A | B` → `Union<A, B>`, `A & B` → `Intersection<A, B>`
  - In expression syntax: `|` is bitwise OR, `&` is bitwise AND (JavaScript semantics)
  - To create unions in expression context, use `Union(A, B)` or `Union<A, B>`
- **Example disambiguation**:
  ```
  Array<{ a: Int }>           // { a: Int } is a record TYPE (type syntax)
  Array({ a: Int })           // { a: Int } is a record LITERAL (expression syntax) - error!
  Union<{ a: Int }, { b: Int }>  // Both are record types
  RecordType([{ name: "a", type: Int, optional: false }])  // Record literal (FieldInfo)

  // Operators in different contexts
  type X = Int | String;      // Union (type syntax)
  const x = 5 | 3;            // Bitwise OR = 7 (expression syntax)
  const Y = Union(Int, String); // Union via function call (expression syntax)
  ```

### WithMetadata and Type Metadata

- **`WithMetadata` builtin**: `WithMetadata(baseType: Type, metadata: TypeMetadata) => Type`
- **TypeMetadata type**: `{ name?: String, typeArgs?: Array<Type>, annotations?: Array<Unknown> }`
- **Attaches metadata to types**: name, type arguments for parameterized types, annotations
- **Does not affect subtyping**: `WithMetadata(String, { annotations: [NonEmpty] })` is still assignable to `String`
- **Desugaring of `type` declarations**: `type Foo = T` desugars to `const Foo = WithMetadata(T, { name: "Foo" })`
- **Parameterized types**: `type Container<T> = { value: T }` desugars to function returning `WithMetadata(..., { name: "Container", typeArgs: [T] })`
- **Annotations desugar to WithMetadata**: `@Deprecated type X = T` → `WithMetadata(T, { name: "X", annotations: [Deprecated] })`

### Record Types and FieldInfo

- **FieldInfo type**: `{ name: String, type: Type, optional: Boolean, annotations: Array<Unknown> }`
- **RecordType constructor**: `RecordType(fields: Array<FieldInfo>, indexType?: Type)`
- **Record openness via indexType**:
  - `undefined` (default): Open record, extra fields allowed
  - `SomeType`: Indexed record, any string key maps to SomeType
  - `Never`: Closed record, no extra fields allowed
- **Closed record syntax**: `{| ... |}` for records that forbid extra fields
- **`T.keysType`**: Returns union of field name literal types (e.g., `"name" | "age"`) - comptime only
- **`T.fieldNames`**: Returns `Array<String>` of field names - runtime usable

### Numeric Types

- **`Int` and `Float`**: Separate primitive types for integers and floating-point numbers
- **`Number`**: Supertype of both (`Int <: Number`, `Float <: Number`)
- **Literal inference**: `42` is `Int`, `3.14` is `Float`
- **Array indexing**: Requires `Int` (Float index is an error)
- **TypeScript interop**: `number` maps to `Number`, accepting both `Int` and `Float`
- **Compile-time only**: At runtime, all are JS numbers
- **Conversion**: `toInt(3.14)` and `toFloat(42)` for explicit conversion

### Literal Types

- String, number, and boolean literals are valid types: `"foo"`, `42`, `true`
- Integer literals (`42`) have type that is a subtype of `Int`
- Float literals (`3.14`) have type that is a subtype of `Float`
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

### Array Types

- **No separate Tuple type**: Arrays handle both fixed and variable length
- **Two syntactic forms**:
  - `Int[]` — Variable-length array of Int (postfix syntax)
  - `[Int, String]` — Fixed 2-element array (bracket syntax)
  - `[Int]` — Fixed 1-element array
  - `[x: Int, y: Int]` — Fixed with labels
  - `[Int, ...String]` — Int followed by any number of Strings (variadic)
- **Desugaring**: `Int[]` → `Array(...Int)`, `[Int, String]` → `Array(Int, String)`
- **ArrayElementInfo**: `{ type: Type, label: String | Undefined }`
- **Properties**:
  - `.typeArgs` — Array of type arguments (comptime only)
  - `.elementType` — Union of all element types (comptime only)
  - `.elements` — `Array<ArrayElementInfo>` for fixed arrays, undefined for variable (comptime only)
  - `.length` — Number for fixed arrays, undefined for variable (runtime usable)
  - `.isFixed` — Boolean (runtime usable)
- **Indexed access**: Compile-time constant index gives specific type; runtime index gives elementType (union)
- **Subtyping**:
  - `[Int, Int, Int] <: Int[]` — Fixed subtypes variable
  - `[Int, String] <: (Int | String)[]` — Heterogeneous subtypes union
  - `[1, 2, 3] <: [Int, Int, Int]` — Literal subtypes widened
- **Generic patterns**: `<T>(arr: [T, ...])` extracts first element type; `<T>(arr: T[])` requires homogeneous

### Array Literal Inference

- **Length preserved**: `[1, 2, 3]` infers to `[1, 2, 3]` (fixed length)
- **Literal types preserved**: Each element retains its literal type
- **Structural subtyping handles widening**: `[1, 2, 3] <: [Int, Int, Int]` so assignment to wider types just works
- **Rationale**: In an immutable language with structural subtyping, preserving literal types provides strictly more information without problems
- **Explicit widening**: Use type annotation if wider type needed: `const x: Int[] = [1, 2, 3]`

### Record Literal Inference

- **Literal types preserved**: `{ a: 1, b: "hi" }` infers to `{ a: 1, b: "hi" }` (not `{ a: Int, b: String }`)
- **Structure preserved**: Field names and optionality preserved exactly
- **Nested preservation**: Applies recursively: `{ outer: { inner: 1 } }` → `{ outer: { inner: 1 } }`
- **Consistent with arrays**: Same literal preservation rules as array literal inference
- **Structural subtyping handles widening**: `{ a: 1 } <: { a: Int }` so assignment just works
- **Discriminated unions benefit**: Literal types preserved naturally for discriminant fields
- **Explicit widening**: Use type annotation if wider type needed: `const x: { a: Int } = { a: 1 }`

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

### Annotations

- **`@` syntax**: Attaches comptime values as metadata to types, fields, function parameter/return types, and type parameters
- **Placement**:
  - On type definitions: `@Deprecated type OldUser = ...` (before the name)
  - On record fields: `{ @JsonName("user_id") userId: String }` (before the field name)
  - On function params/returns: `(x: @NonEmpty String): @Valid User` (before the type)
  - On type parameters: `type Container<@Covariant T> = ...` (before the parameter name)
- **Any comptime value**: Annotations can be strings, records, or type instances—no special `Annotation` base type required
- **Access via properties**:
  - `T.annotations` — `Array<Unknown>` of all annotations (comptime only)
  - `T.annotation<A>` — First annotation of type A, returns `A | Undefined` (comptime only)
  - Type parameter annotations: Access via `T.typeArgs[i].annotations` (type args wrapped in `WithMetadata`)
- **FieldInfo extended**: `{ name, type, optional, annotations }` includes field annotations
- **No special semantics**: Annotations are purely metadata; they don't affect language behavior
- **Use cases**: Validation, serialization hints, documentation/deprecation, code generation, variance markers

### Function Return Type Inference

- **Return types inferred from body**: Non-recursive functions don't need return type annotations
- **Flow-based inference**: Types determined by forward analysis, one expression at a time
- **Recursive functions require annotation**: Cannot infer when the recursive call is encountered before the type is known
- **Mutually recursive functions also require annotations**: Same reason as direct recursion
- **Why not Hindley-Milner**: HM with subtyping is complex; flow-based gives predictable errors and matches TypeScript

### Generics as Type Parameters with Defaults

- **Type params come last**: `<T>(x: T)` desugars to `(x: T, T: Type = typeOf(x))`
- **Inference via defaults**: Type parameters have defaults that reference value parameters
- **Partial inference supported**: Unlike TypeScript, you can provide some type args and infer the rest
- **Unambiguous calls**: `identity("hello")` clearly passes to x; `identity("hello", String)` provides T explicitly

### Generic Constraints via Bounded Type

- **`Type<Bound>`**: Parameterized Type representing types that are subtypes of Bound
- **`Type` is shorthand for `Type<Unknown>`**: Unbounded type parameter
- **Constraint desugaring**: `<T extends Foo>(x: T)` desugars to `(x: T, T: Type<Foo> = typeOf(x))`
- **Consistent with other parameterized types**: Just as `Array<String>` means "arrays of strings", `Type<Foo>` means "types subtyping Foo"
- **Enables body usage**: When `T: Type<Foo>`, the type checker knows `x: T` has all properties of Foo

### Generic Type Inference

- **Literal types preserved**: `identity(42)` infers T = `42` (not `Int`)
- **Follows from desugaring**: `<T>(x: T)` desugars to `(x: T, T: Type = typeOf(x))`, and `typeOf(42)` returns `42`
- **Consistent with arrays/records**: Same literal preservation principle throughout the type system
- **Explicit widening**: Use `identity<Int>(42)` to get T = `Int`
- **Structural subtyping handles assignment**: Result type `42` is assignable to `Int` or `Number`
- **Multiple type params**: `pair(1, "hello")` infers T = `1`, U = `"hello"`

### Contextual Typing

- **Full contextual typing**: Expected type flows down into expressions (like TypeScript)
- **Lambda parameters**: `const f: (x: Int) => Int = x => x + 1` — x inferred as Int from annotation
- **Callback parameters**: `[1,2,3].map(x => x + 1)` — x inferred from Array<Int>.map signature
- **Array/record literals**: Expected type flows into elements/fields
- **Interaction with literal preservation**: Context can widen literal types: `const arr: Int[] = [1, 2, 3]` gives type `Int[]`, not `[1, 2, 3]`
- **No context = literal types preserved**: `const arr = [1, 2, 3]` gives type `[1, 2, 3]`

### Inference Failure

- **Error, not Unknown**: When inference cannot determine a type, it's a compile error (not fallback to `Unknown`)
- **Matches TypeScript's `noImplicitAny`**: Explicit is better than implicit
- **Annotations required**: Lambda params without context, recursive function returns, ambiguous expressions
- **Fix is explicit annotation**: `const f = (x: Int) => x + 1`

### Flow-Based Inference

- **Flow-based (local) inference**: Analyze code forward, one expression at a time (like TypeScript)
- **Left-to-right, top-to-bottom**: Each binding's type determined at declaration
- **Contextual typing flows downward**: Expected types flow into expressions
- **Not Hindley-Milner**: HM with subtyping is complex; flow-based gives predictable, localized errors
- **Trade-off**: Recursive functions need annotations, but errors are easier to understand

### Compile-Time AST Access (Expr Type)

- **`Expr<T>` type**: When parameter typed as `Expr<T>`, compiler captures AST instead of evaluating (like C# `Expression<T>`)
- **Comptime-only**: Contains `Type` values, so cannot exist at runtime without manual reification
- **Capture semantics**: Expression not evaluated; AST passed to function at compile time
- **AST as discriminated union**: `{ kind: "literal" | "binary" | "call" | ... , type: Type, ... }`
- **Use cases**: Query translation (LINQ-style), DSL construction, compile-time validation
- **Manual reification**: Extract runtime-usable data from AST at compile time if needed

### Pattern Matching

- **Syntax**: `match (expr) { case pattern: result; ... };`
- **Pattern types**: Literal, type, property (destructuring), nested, wildcard (`_`)
- **Binding**: Implicit (property name becomes variable), explicit rename (`value: v`)
- **Guards**: `when` clause for additional conditions: `case Int when x > 0: "positive"`
- **Type narrowing**: Inside case body, matched expression's type is narrowed
- **Exhaustiveness**: Compiler verifies all cases handled; wildcard satisfies exhaustiveness
- **Discriminant identification**: TypeScript approach - any property with distinct literal types across variants
- **Expression**: Returns a value; return type is union of branch types

### Error Handling

- **`throw` statement**: Throws exceptions (mirrors JS): `throw Error("message")`
- **`Try` builtin**: Catches exceptions, returns discriminated union
- **TryResult type**: `{ ok: true, value: T } | { ok: false, error: Error }`
- **Result in userland**: Users define their own Result types; keeps language simple
- **No checked exceptions**: Rely on explicit `Try` at JS interop boundaries

### Async/Await

- **1:1 JS mapping**: Direct output to JavaScript async/await
- **`async` keyword required**: Functions using `await` must be marked `async`
- **`await` keyword**: Unwraps `Promise<T>` to `T`; only valid on Promise types
- **`Promise<T>` built-in**: Parameterized type for async computations
- **Top-level await**: Supported at module level
- **`Try` integration**: `Try` with async thunk returns `Promise<TryResult<T>>`

### Rest Parameters

- **Syntax**: `...param: T[]` marks a rest parameter
- **Semantics**: Collects remaining arguments into an array
- **Position**: Rest parameter must be last, only one allowed
- **Type annotation**: Must be an array type (e.g., `Int[]`, `Array<String>`)
- **No default value**: Rest parameters cannot have default values
- **Spread at call sites**: `fn(...arr)` expands array as arguments
- **Variadic builtins**: `Union`, `Intersection`, `Array` accept rest parameters
- **Example**:
  ```
  const sum = (...nums: Int[]): Int => nums.reduce((a, b) => a + b, 0);
  sum(1, 2, 3);  // nums = [1, 2, 3]
  ```

### Compile-Time Assertions

- **`assert` is a builtin function**: `assert: (condition: Boolean, message?: String) => Void`
- **Comptime-only**: Condition must be evaluable at compile time
- **Failure = compile error**: If condition is `false`, compilation fails (with optional message)
- **No runtime code**: Assertions disappear after compilation
- **`is` sugar**: `x is T` desugars to `typeOf(x).extends(T)`

### Statement-Position Execution

- **Expressions in statement position are executed for effects**: Even if the result is unused
- **Ensures `assert(...)` runs**: The compiler evaluates statement-position expressions
- **Matches JavaScript semantics**: Intuitive for JS developers
- **No full effect system needed**: Simple rule covers the common cases

### Side Effects and Purity

- **Pure functional core**: DepJS code itself is pure and immutable
- **`const` only**: All bindings are immutable, no reassignment
- **Immutable data**: Record updates create new records (`{ ...person, age: 30 }`)
- **No effect tracking**: Effects are not tracked in the type system
- **JS interop is the effect boundary**: Calling JS functions can have side effects (console, DOM, network)
- **Statement-position execution**: Ensures effectful expressions run in order
- **Pragmatic approach**: "Pure functional core, impure JS shell"

**Runtime effects allowed via JS interop:**
- Console output (`console.log`)
- DOM manipulation
- Network requests (via async/await)
- Throwing exceptions

**Compile-time effects:**
- File reading (for codegen)
- Failing compilation (`assert`)

### JavaScript/TypeScript Interop

- **TypeScript-only interop**: All imported modules must have `.d.ts` type definitions
- **ES module syntax**: Standard `import { } from "module"` syntax
- **Named imports**: `import { foo, bar } from "module";`
- **Default imports**: `import lib from "module";`
- **Namespace imports**: `import * as lib from "module";`
- **Type-only imports**: `import type { SomeType } from "module";`
- **Node.js resolution**: Standard node_modules resolution for finding `.d.ts` files
- **No raw JS**: Importing modules without `.d.ts` is a compile error
- **Type mapping**: TypeScript types map to DepJS types (see typescript-compat.md)

**Current scope:**
- Single file compilation
- Importing from external modules with `.d.ts`

**Not yet supported:**
- Exporting from DepJS modules
- DepJS-to-DepJS imports
- Multi-file compilation

## Open Questions (Pre-Implementation)

These need to be resolved before or during implementation:

### Grammar / Syntax Formalization
- Reserved keywords list
- String interpolation / template literals syntax (template literals with `${...}` are implemented)

### Standard Library / Builtins
- Array methods: Which are built-in? (map, filter, reduce, forEach, find, findIndex, some, every, includes, indexOf, slice, concat, flat, flatMap, etc.)
- String methods: Which are built-in?
- Math functions: Built-in or imported?
- Console API: Built-in or imported?
- What's built-in vs imported from JS?

### Module System
- DepJS exports syntax and semantics
- DepJS-to-DepJS imports
- Multi-file compilation model
- Module resolution algorithm

### TypeScript Compatibility
- Full type mapping table (expand spec/typescript-compat.md)
- Handling unsupported TS features (classes, enums, namespaces, decorators)
- .d.ts parsing specifics

### Compile-Time Specifics
- Fuel limit configuration
- Allowed comptime effects (beyond file reading and assert)

## Not Yet Implemented (Documented Features)

These features are documented in the spec but not yet implemented in the codebase:

### Array Methods
Currently implemented: `map`, `filter`, `find`, `findIndex`, `some`, `every`, `reduce`, `flat`, `flatMap`, `concat`, `slice`, `indexOf`, `includes`, `join`

Not yet implemented:
- `forEach` - iterate with side effects

### String Methods
No string methods implemented yet. Need to decide which are built-in vs imported from JS.

### Block Expressions Outside Lambdas
Block expressions outside arrow function bodies require the `do` keyword for disambiguation from record literals:
```
// WORKS (arrow body - no keyword needed):
const f = () => { const x = 1; x + 1 };

// WORKS (standalone - requires 'do' keyword):
const x = do { const y = 1; y + 1 };
```

### Type Declarations in Blocks
Type declarations inside block expressions are not yet supported:
```
// NOT YET SUPPORTED:
const f = () => {
  type T = Int;
  const x: T = 42;
  x
};
```

## Examples Directory

- `examples/` - Working examples demonstrating current capabilities
- `examples/should-work/` - Examples demonstrating features that were previously broken but are now fixed

## Deferred to Future Versions

- **Refinement types**: Predicate-constrained types like `Int where this > 0`. Deferred due to complexity (decidability, runtime vs compile-time checking). Use branded types or runtime validation for now.
