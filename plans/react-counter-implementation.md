# Plan: Make react-counter.djs Compile and Run

## Context

The react-counter example (`examples/react-counter.djs`) imports `useState` from React and `jsx`/`jsxs` from `react/jsx-runtime`. It's blocked by:
- The DTS translator produces `Type` values directly, requiring parallel inference machinery for generics
- No array destructuring support (`const [count, setCount] = useState(0)`)
- Literal type inference is too precise for generic defaults (`typeOf(0)` → `0` not `Int`)

The fix: rewrite the DTS translator to produce `CoreDecl[]` (same AST as native DepJS), add `wideTypeOf` for generic defaults, and add array destructuring. The current DTS translator is being thrown away — only features needed for the react-counter are implemented.

## Implementation Steps

### Step 1: `wideTypeOf` builtin + desugar update

**`src/typecheck/builtins.ts`**:
- Add `widenType(t: Type): Type` helper — maps `literal` → `primitiveType(baseType)`, recurses into arrays/records, passes through everything else
- Add `builtinWideTypeOf` builtin that calls `widenType(args[0].type)`
- Register in both `createInitialComptimeEnv` and `createInitialTypeEnv`

**`src/parser/desugar.ts`** (line 773):
- Change type param default from `typeOf` to `wideTypeOf`

**`src/typecheck/typecheck.ts`** (`isTypeParam`, line 1844):
- Recognize both `typeOf` and `wideTypeOf` as valid type param default markers

### Step 2: Array destructuring

**`src/parser/depjs.grammar`** (line 24-26):
- Add `ArrayPattern` to `ConstDecl`: `kw<"const"> (identifierOrTypeName | ArrayPattern) ...`
- Define `ArrayPattern { "[" ListOf<identifierOrTypeName> "]" }`
- Run `npm run build:parser` to regenerate

**`src/parser/desugar.ts`**:
- Change `desugarStatement` return type to `CoreDecl[]` (from `CoreDecl | null`)
- Update `desugar()` to `flatMap` instead of `push`
- When `desugarConstDecl` encounters `ArrayPattern`, emit:
  ```
  const _destruct_0 = <init>;
  const a = _destruct_0[0];
  const b = _destruct_0[1];
  ```
  Each element access uses `{ kind: "index", object: id("_destruct_0"), index: literal(i) }`

No type checker changes — the existing index-on-array logic gives `Int` for `tuple[0]` on `[Int, Dispatch<...>]`.

### Step 3: Rewrite DTS translator to produce `CoreDecl[]`

**`src/dts-loader/dts-translator.ts`** — focused rewrite.

New output:
```typescript
export interface DTSLoadResult {
  decls: CoreDecl[];
  errors: string[];
}
```

Add CoreExpr builder helpers: `coreId`, `coreLit`, `coreCall`, `coreRecord`, `coreArray`, `coreLambda`, `coreThrow`, `coreConst`, `coreProperty`.

Keep the existing `dts-parser.ts` (Lezer parser for .d.ts files) unchanged.

**Type translation** (`translateType` → `CoreExpr`):
- Primitives: `string`→`coreId("String")`, `number`→`coreId("Number")`, etc.
- Union: `A | B` → `coreCall("Union", A', B')`
- Function: `(x: A) => B` → `coreCall("FunctionType", coreArray([paramInfo]), B')`
- Array: `T[]` → `coreCall("Array", T')`, `[A, B]` → `coreCall("Array", A', B')`
- Record/interface: `{ x: T }` → `coreCall("RecordType", coreArray([fieldInfo]))`
- Type ref: `Foo` → `coreId("Foo")`, `Foo<A>` → `coreCall("Foo", A')`
- Namespace member: `React.Key` → `coreProperty("React", "Key")`
- Untranslatable (conditional types, mapped types, etc.) → `coreId("Unknown")`

**Declaration translation** (each → `CoreDecl[]`):
- `type Alias = T` → `coreConst("Alias", coreCall("WithMetadata", T', nameMetadata))`
- `type Alias<A> = T` → `coreConst("Alias", coreLambda([{name:"A", type:Type}], coreCall("WithMetadata", T', metadata), coreId("Type")))`
- `interface Foo { x: T }` → same as type alias with RecordType body
- Generic function `function foo<S>(x: S): T` → `coreConst("foo", coreLambda([{name:"x", type:S'}, {name:"S", type:Type, default:wideTypeOf(x)}], coreThrow(), T'))`
- Non-generic function `function foo(x: A): B` → `coreConst("foo", coreLambda([params], coreThrow(), B'))`
- `import * as React from "./"` → `CoreDecl { kind: "import", clause: {kind:"namespace", name:"React"}, source: "./" }`
- `declare namespace Ns { ... }` → flatten members as top-level CoreDecls (since `export = Ns` makes namespace members the module exports)
- Variable declaration `declare const x: T` → `coreConst("x", coreThrow(), {type: T'})`

**Overloaded functions**: Produce only the first overload. For the react-counter, `useState`'s first overload `useState<S>(initialState: S | (() => S))` is the one we use. Future work: proper overload representation.

**Scope for react-counter**: The translator handles these from `@types/react/index.d.ts`:
- `type SetStateAction<S>`, `type Dispatch<A>`, `type Key`, `interface ReactElement`
- `function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>]`
- `type ElementType` → degrades to `Unknown` (involves mapped+conditional types)

And from `@types/react/jsx-runtime.d.ts`:
- `import * as React from "./"` (cross-file import)
- `function jsx(type: React.ElementType, props: unknown, key?: React.Key): React.ReactElement`
- `function jsxs(...)` (same signature)

### Step 4: Update module resolver

**`src/typecheck/module-resolver.ts`**:
- Change `ResolvedModule` to `{ dtsPath: string; decls: CoreDecl[] }`
- `loadDTSFile` calls `loadDTS()` → gets `{ decls, errors }` → caches `{ dtsPath, decls }`
- Circular dependency: return `{ dtsPath, decls: [] }` (same pattern as today)
- `resolveForDTS` callback returns `DTSLoadResult` (now with `decls` field)

### Step 5: Rewrite `checkImportDecl`

**`src/typecheck/typecheck.ts`** (`checkImportDecl`, lines 398-528):

New flow:
1. Get `CoreDecl[]` from `moduleResolver.resolve(source)`
2. Create child type/comptime envs extending the current ones (builtins available)
3. Save current envs, swap to children
4. Process each CoreDecl via `checkDecl()` — this handles nested imports recursively
5. Restore envs
6. Extract imported names from child scope:
   - Named: `childTypeEnv.lookup(name)` → define in main scope
   - Namespace: build record type + comptime record from all child scope bindings
7. For namespace imports: define in **both** typeEnv and comptimeEnv (not `defineUnavailable`) so that `React.ElementType` can be evaluated at comptime

Key detail: namespace imports must be comptime-available because `.d.ts` type references like `React.ElementType` need to be evaluated by the comptime evaluator. This differs from the current code which marks all imports as `comptimeEnv.defineUnavailable`.

### Step 6: Remove parallel inference machinery

After everything works:
- Remove `typeParams?: string[]` from `FunctionType` in `src/types/types.ts`
- Remove `inferTypeArguments`, `inferFromTypes` from `src/typecheck/typecheck.ts`
- Remove inference call sites in `checkCall` (lines 992-1001), `tryMatchSignature` (1289-1295), `checkOverloadedCall` (1127-1131)
- Update `functionType()` constructor to drop typeParams parameter

### Step 7: Update tests and CLAUDE.md

- Rewrite `src/dts-loader/dts-translator.test.ts` for CoreDecl[] output
- Remove `inferTypeArguments` tests from `typecheck.test.ts`
- Add tests for `wideTypeOf`, array destructuring, and the new DTS translator
- Update CLAUDE.md: test counts, resolved issues, implementation status

## Verification

1. `npm test` — all tests pass
2. `npm run depjs -- examples/react-counter.djs` — compiles without errors
3. Output JS is valid and runnable with React loaded

## Key files

| File | Change |
|------|--------|
| `src/typecheck/builtins.ts` | Add `wideTypeOf` builtin |
| `src/parser/depjs.grammar` | Add `ArrayPattern` to `ConstDecl` |
| `src/parser/desugar.ts` | Array destructuring desugaring, `wideTypeOf` in defaults |
| `src/dts-loader/dts-translator.ts` | Full rewrite → `CoreDecl[]` output |
| `src/typecheck/module-resolver.ts` | `ResolvedModule` carries `CoreDecl[]` |
| `src/typecheck/typecheck.ts` | Rewrite `checkImportDecl`, remove inference code |
| `src/types/types.ts` | Remove `FunctionType.typeParams` |
| `src/dts-loader/dts-translator.test.ts` | Rewrite for new output |
| `src/typecheck/typecheck.test.ts` | Update tests |
