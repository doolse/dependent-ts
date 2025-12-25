# Refactoring Progress: Body-Based Type Derivation

## Status: Phases 1-2, 4 Complete

The core refactoring is done. Functions now use body-based type derivation at call sites instead of upfront inference.

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

### Phase 4: Delete inference.ts ✅

**Files changed:**
- `src/inference.ts` - DELETED
- `src/index.ts` - Removed inference exports

---

## What Remains

### Phase 3: Remove fnType from constraint.ts

The `fnType` constraint type still exists and is used by:

| File | Usage | Action Needed |
|------|-------|---------------|
| `src/constraint.ts` | Core definition, implies(), simplify(), etc. | Remove type and all cases |
| `src/builtin-registry.ts` | `functionType` builtin (line 542) | Remove or change to return `isFunction` |
| `src/index.ts` | Exports `fnType` | Remove export |
| `test/function-inference.test.ts` | 3 tests use fnType | Remove these tests |
| `test/generics.test.ts` | Uses fnType | Update or remove tests |
| `test/ts-loader.test.ts` | Expects fnType | Update expectations |
| `test/types-as-values.test.ts` | Uses fnType | Update or remove |

**Steps to complete Phase 3:**

1. **Update builtin-registry.ts** (line 542):
   ```typescript
   // OLD:
   const resultConstraint = fnType(paramConstraints, resultArg.value.constraint);

   // NEW: Either remove functionType builtin or return isFunction
   return { svalue: ctx.now(typeVal(isFunction), isType(isFunction)) };
   ```

2. **Update tests** that use `fnType`:
   - Remove tests that check for `fnType` constraints
   - Update tests that create `fnType` for testing

3. **Remove from constraint.ts**:
   - Delete type definition (line ~55-56)
   - Delete constructor (line ~139-140)
   - Delete `implies()` cases (lines ~740-757)
   - Delete `simplify()` case (line ~593-594)
   - Delete `applySubstitution()` case (lines ~1115-1119)
   - Delete `solveInto()` case (lines ~1325-1332)
   - Delete `constraintEquals()` case
   - Delete `constraintToString()` case (lines ~1030-1033)
   - Delete `freeConstraintVars()` case

4. **Update index.ts** - Remove `fnType` export

### Phase 5: Handle genericFnType and ts-loader

Similar to fnType, but for generic functions:

| File | Usage | Action Needed |
|------|-------|---------------|
| `src/constraint.ts` | `genericFnType` definition and cases | Remove entirely |
| `src/generic-inference.ts` | Generic instantiation | DELETE file |
| `src/ts-loader.ts` | Creates fnType/genericFnType | Return `isFunction` instead |
| `src/index.ts` | Exports generic-inference | Remove exports |
| `test/generics.test.ts` | Tests generic functions | Major rewrite |

**Steps to complete Phase 5:**

1. **Update ts-loader.ts**:
   - `convertSignature()` should return `isFunction` instead of `fnType`
   - Remove `fnType` and `genericFnType` imports

2. **Delete generic-inference.ts**

3. **Update index.ts** - Remove generic-inference exports

4. **Remove genericFnType from constraint.ts**:
   - Delete type definition
   - Delete all cases in implies, simplify, etc.

5. **Update/rewrite generics.test.ts**

---

## Test Status

Current: **713 tests pass** (2 pre-existing React import failures)

After removing fnType/genericFnType, expect to remove ~15-20 tests that specifically test function type constraints.

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

## Quick Reference: Key Code Locations

| Concept | File | Lines |
|---------|------|-------|
| Args binding | `src/staged-evaluate.ts` | 788-789, 809-810 |
| createArraySValue | `src/staged-evaluate.ts` | 965-994 |
| evalFn (simplified) | `src/staged-evaluate.ts` | 560-569 |
| evalRecFn (simplified) | `src/staged-evaluate.ts` | 576-585 |
| Cycle detection | `src/staged-evaluate.ts` | 735-756 |
| requireConstraint (lenient) | `src/builtins.ts` | 77-87 |
| Args tests | `test/staging.test.ts` | 436-495 |
| fnType definition | `src/constraint.ts` | ~55-56, ~139-140 |
| functionType builtin | `src/builtin-registry.ts` | ~530-545 |
