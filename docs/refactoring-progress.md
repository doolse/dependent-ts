# Refactoring Progress: Body-Based Type Derivation

## Status: Phases 1-5 Complete ✅

The core refactoring is done. Functions now use body-based type derivation at call sites instead of upfront inference. The `fnType` and `genericFnType` constraint types have been removed.

---

## What's Been Done

### Phase 1: Args Binding ✅

**Files changed:**
- `src/staged-evaluate.ts` - Added `createArraySValue()` helper and `args` binding in `evalCall()`

**Key changes:**
- All function bodies now have implicit `args` array binding
- `args[0]`, `args[1]`, etc. access individual arguments
- Works with both Now and Later arguments
- 5 new tests in `test/staging.test.ts` ("Args Array Binding" section)

### Phase 2: Remove fnType from Evaluation ✅

**Files changed:**
- `src/staged-evaluate.ts` - Simplified `evalFn()` and `evalRecFn()`
- `src/builtins.ts` - Made `requireConstraint()` lenient with `any`
- `test/function-inference.test.ts` - Updated test expectations

**Key changes:**
- Functions return `isFunction` constraint instead of `fnType`
- No upfront type inference when defining functions
- Types derived from body analysis at call sites
- Cycle detection uses `any` for recursive calls
- `requireConstraint()` allows `any` to pass (defers to runtime)

### Phase 3: Remove fnType from constraint.ts ✅

**Files changed:**
- `src/constraint.ts` - Removed fnType type, constructor, and all cases in implies/simplify/etc.
- `src/builtin-registry.ts` - Removed `functionType` builtin
- `src/repl.ts` - Removed functionType from help text
- `src/value.ts` - Removed fnType case from valueSatisfies
- `src/index.ts` - Removed fnType exports
- `test/function-inference.test.ts` - Removed tests that used fnType
- `test/types-as-values.test.ts` - Removed functionType test

**Key changes:**
- `fnType` no longer exists in the constraint system
- Functions have simple `isFunction` constraint
- Function types are derived from body analysis at call sites

### Phase 4: Delete inference.ts ✅

**Files changed:**
- `src/inference.ts` - DELETED
- `src/index.ts` - Removed inference exports

### Phase 5: Handle genericFnType and ts-loader ✅

**Files changed:**
- `src/generic-inference.ts` - DELETED
- `src/ts-loader.ts` - Simplified to return `isFunction` for all function signatures
- `src/constraint.ts` - Removed genericFnType, typeParam, TypeParam, and all related functions
- `src/index.ts` - Removed generic-inference exports
- `test/generics.test.ts` - Rewrote to test constraint operations only
- `test/ts-loader.test.ts` - Updated to expect `isFunction` for functions

**Key changes:**
- `genericFnType` and `typeParam` no longer exist in the constraint system
- TypeScript declarations for functions now return `isFunction`
- Type parameters in TS declarations resolve to `any` (body-based derivation handles types at call sites)
- Removed ~50 tests that relied on fnType/genericFnType, added ~20 constraint operation tests

---

## Test Status

Current: **693 tests pass** (2 pre-existing React import failures)

The test count decreased from 713 to 693 because we removed tests that specifically tested fnType/genericFnType constraints, which are no longer part of the system.

---

## Future Phases (from original plan)

### Phase 6: Add typeOf() Expression

For explicit same-type enforcement:
```
let pair = fn(x, y) =>
  let _ = assert(y, typeOf(x)) in
  [x, y]
```

Files to modify:
- `src/expr.ts` - Add TypeOfExpr
- `src/lexer.ts` - Add TYPEOF keyword
- `src/parser.ts` - Parse typeOf(expr)
- `src/staged-evaluate.ts` - Evaluate typeOf
- `src/codegen.ts` - Error if typeOf in residual

### Phase 7: Codegen Optimization

Generate normal JS params when possible:
```typescript
// Input: fn => let [x, y] = args in x + y
// Output: function(x, y) { return x + y; }
```

File to modify:
- `src/codegen.ts` - Add pattern detection

### Phase 8: Optional Cleanup

- Remove `params` from ClosureValue (src/value.ts)
- Parser-level desugaring of `fn(x, y) => E` to `fn => let [x, y] = args in E`
- Cache body analysis results

---

## Summary of Removed Code

| File | What was removed |
|------|------------------|
| `src/inference.ts` | Entire file (function type inference) |
| `src/generic-inference.ts` | Entire file (generic instantiation) |
| `src/constraint.ts` | fnType, genericFnType, typeParam, TypeParam, makeTypeParam, freshTypeParamId, resetTypeParamCounter |
| `src/builtin-registry.ts` | functionType builtin |
| `src/value.ts` | fnType, typeParam, genericFnType cases in valueSatisfies |

---

## Quick Reference: Key Code Locations

| Concept | File | Notes |
|---------|------|-------|
| Args binding | `src/staged-evaluate.ts` | evalCall binds `args` array |
| createArraySValue | `src/staged-evaluate.ts` | Helper for args array creation |
| evalFn (simplified) | `src/staged-evaluate.ts` | Returns isFunction, no inference |
| evalRecFn (simplified) | `src/staged-evaluate.ts` | Same as evalFn |
| Cycle detection | `src/staged-evaluate.ts` | Returns `any` for recursive calls |
| requireConstraint (lenient) | `src/builtins.ts` | Allows `any` to pass |
| Args tests | `test/staging.test.ts` | "Args Array Binding" section |
| Constraint tests | `test/generics.test.ts` | Constraint operations (no more generic types) |
