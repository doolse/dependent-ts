# Comptime as an Expression

## Core Concept

`comptime(expr)` is a compile-time evaluation boundary. It:
1. Forces `expr` to evaluate completely at compile time
2. Produces a `Now` value (error if the result would be `Later`)
3. Disappears from the residual output - only side effects (constraint refinements) remain

This is **not** a function-level concept. Residualizability is a property of the expression itself after comptime evaluations complete.

## Semantics

```
comptime(expr) → Now(value, constraint)
```

- The expression is evaluated in the current environment
- All captured values must be `Now` for the result to be `Now`
- Type operations (`assert`, type computations) work because types are `Now` values
- The resulting `Now` value can be used in the surrounding expression

## Basic Examples

### Example 1: Simple Comptime Value

```
let size = comptime(4 * 8) in
createBuffer(size)
```

**Evaluation:**
- `comptime(4 * 8)` → `Now(32, equals(32))`
- `size` bound to `Now(32)`
- Result: `createBuffer(32)` with literal inlined

**Residual:**
```javascript
createBuffer(32)
```

### Example 2: Comptime Type Refinement

```
fn(T) => fn(x) =>
  comptime(assert(x, T));
  x + 1
```

**Trace with `T = number`, `x = Later(any)`:**
1. `comptime(assert(x, T))` evaluates
2. `assert(x, T)` refines `x` from `Later(any)` to `Later(isNumber)`
3. Comptime block produces `Now(null)` and disappears
4. Body `x + 1` residualizes with `x: Later(isNumber)`

**Residual:**
```javascript
(x) => x + 1
```

### Example 3: Comptime Error

```
let x = runtime(y: 5) in
comptime(x + 1)  // ERROR: x is Later
```

**Evaluation:**
- `x` is `Later` (runtime value)
- `comptime(x + 1)` cannot produce `Now` result
- Compile-time error: "Cannot evaluate Later value at comptime"

## Type-Parameterized Functions

### Example 4: Generic Identity

```
let id = fn(T) => fn(x) =>
  comptime(assert(x, T));
  x
in
let idNum = id(number) in
idNum(runtime(n: 42))
```

**Trace:**
1. `id(number)` → `StagedClosure` with `T = Now(TypeValue(isNumber))`
2. `idNum(runtime(n: 42))` called with `x = Later(any, "n")`
3. `comptime(assert(x, T))`:
   - `T` is `Now(TypeValue(isNumber))`
   - `x` refined to `Later(isNumber)`
   - Comptime disappears
4. Body `x` residualizes

**Residual:**
```javascript
const idNum = (n) => n;
idNum(n)
```

### Example 5: Generic Pair

```
let pair = fn(T) => fn(x, y) =>
  comptime({ assert(x, T); assert(y, T) });
  [x, y]
in
pair(number)(runtime(a: 1), runtime(b: 2))
```

**Trace:**
1. `pair(number)` → closure with `T = Now(TypeValue(isNumber))`
2. Call with `x = Later(any, "a")`, `y = Later(any, "b")`
3. Comptime block executes:
   - `assert(x, T)` → `x` refined to `Later(isNumber)`
   - `assert(y, T)` → `y` refined to `Later(isNumber)`
   - Block returns `Now(null)`, disappears
4. `[x, y]` residualizes

**Residual:**
```javascript
const pair_number = (a, b) => [a, b];
pair_number(a, b)
```

## Comptime-Computed Values

### Example 6: Schema Processing

```
let processSchema = fn(Schema) =>
  let fields = comptime(extractFields(Schema)) in
  fn(data) => fields.map(fn(f) => data[f])
in
processSchema(UserSchema)
```

**Trace (assuming `UserSchema` defines fields `["name", "age"]`):**
1. `Schema = Now(TypeValue(...))`
2. `comptime(extractFields(Schema))` → `Now(["name", "age"])`
3. `fields` bound to `Now(["name", "age"])`
4. Inner function: `data` is parameter (Later when called)
5. `fields.map(...)` - fields is Now, so map can partially evaluate

**Residual (when inner function called):**
```javascript
(data) => ["name", "age"].map((f) => data[f])
```

Or if further optimized:
```javascript
(data) => [data["name"], data["age"]]
```

### Example 7: Type-Computed Default Value

```
let withDefault = fn(T) =>
  let defaultVal = comptime(defaultFor(T)) in
  fn(x) =>
    if x == null then defaultVal else x
in
withDefault(number)(runtime(v: getValue()))
```

**Trace (assuming `defaultFor(number) = 0`):**
1. `T = Now(TypeValue(isNumber))`
2. `comptime(defaultFor(T))` → `Now(0)`
3. `defaultVal = Now(0)`
4. Inner function called with `x = Later(any)`
5. Condition `x == null` is Later, both branches evaluate
6. `defaultVal` inlines as literal `0`

**Residual:**
```javascript
(v) => v === null ? 0 : v
```

## Nested Comptime

### Example 8: Comptime Within Comptime

```
let outer = comptime(
  let inner = comptime(2 + 2) in
  inner * 10
) in
outer + 1
```

**Trace:**
1. Inner `comptime(2 + 2)` → `Now(4)`
2. Outer comptime: `4 * 10` → `Now(40)`
3. `outer = Now(40)`
4. `40 + 1` → `Now(41)`

**Residual:**
```javascript
41
```

### Example 9: Comptime in Higher-Order Function

```
let mapType = fn(F, T) =>
  comptime(F(T))
in
let ArrayOf = fn(T) => arrayOf(T) in
mapType(ArrayOf, number)
```

**Trace:**
1. `F = Now(StagedClosure for ArrayOf)`
2. `T = Now(TypeValue(isNumber))`
3. `comptime(F(T))`:
   - Calls `ArrayOf(number)`
   - Returns `Now(TypeValue(arrayOf(isNumber)))`
4. Result is the array-of-number type

**Residual:**
```javascript
// Nothing - result is a type, types don't residualize
```

## Mixed Comptime and Runtime Assertions

### Example 10: Compile-Time Type Check, Runtime Value Check

```
fn(T) => fn(x) =>
  comptime(assert(x, T));        // Compile-time type refinement
  assert(x, gt(0));              // Runtime check for positive
  x
```

**Trace with `T = number`, `x = Later(any)`:**
1. `comptime(assert(x, T))`:
   - Refines `x` to `Later(isNumber)`
   - Disappears from residual
2. `assert(x, gt(0))`:
   - NOT in comptime, generates runtime code
   - Refines `x` to `Later(and(isNumber, gt(0)))`
3. Body `x` residualizes

**Residual:**
```javascript
(x) => {
  if (!(x > 0)) throw new Error("Assertion failed: x > 0");
  return x;
}
```

### Example 11: Runtime Type Assertion

```
fn(data) =>
  assert(data, { name: string, age: number });
  "Hello " + data.name
```

**Trace with `data = Later(any)`:**
1. `assert` NOT in comptime → generates runtime check
2. Refines `data` to `Later(hasField("name", isString), hasField("age", isNumber))`
3. `data.name` is `Later(isString)`

**Residual:**
```javascript
(data) => {
  if (typeof data.name !== "string" || typeof data.age !== "number") {
    throw new Error("Assertion failed");
  }
  return "Hello " + data.name;
}
```

## Recursive Functions

### Example 12: Recursive with Type Parameter

```
let sumTree = fn(T) => fn rec(tree) =>
  comptime(assert(tree, treeOf(T)));
  if tree.isLeaf
    then tree.value
    else rec(tree.left) + rec(tree.right)
in
sumTree(number)(runtime(t: myTree))
```

**Trace:**
1. `T = Now(TypeValue(isNumber))`
2. `sumTree(number)` → `StagedClosure` for recursive function
3. When called with `tree = Later(any)`:
   - `comptime(assert(tree, treeOf(T)))` refines tree constraint
   - Comptime disappears
4. Recursive calls share the specialization

**Residual:**
```javascript
const sumTree_number = function rec(t) {
  return t.isLeaf ? t.value : rec(t.left) + rec(t.right);
};
sumTree_number(myTree)
```

### Example 13: Type-Level Recursion

```
let JsonType = rec(J,
  or(isNumber, isString, isBool, isNull,
     arrayOf(J),
     objectOf(J))
) in
fn(x) =>
  comptime(assert(x, JsonType));
  JSON.stringify(x)
```

**Trace with `x = Later(any)`:**
1. `JsonType` is a recursive constraint (Now value)
2. `comptime(assert(x, JsonType))` refines x to the recursive type
3. Comptime disappears

**Residual:**
```javascript
(x) => JSON.stringify(x)
```

## Error Cases

### Example 14: Later Value in Comptime

```
fn(x) =>
  comptime(x + 1)  // ERROR if x is Later
```

**Error:** "Cannot evaluate comptime: 'x' is a runtime value"

### Example 15: Runtime Dependency in Type Computation

```
fn(n) =>
  let T = comptime(arrayOfLength(n)) in  // ERROR if n is Later
  createArray(T)
```

**Error:** "Cannot evaluate comptime: 'n' is a runtime value"

### Example 16: Using Comptime Result at Runtime

```
let validate = fn(T) =>
  let validator = comptime(buildValidator(T)) in
  fn(x) => validator(x)
in
validate(UserSchema)(runtime(data: input))
```

**Trace:**
1. `T = Now(TypeValue(UserSchema))`
2. `comptime(buildValidator(T))`:
   - `buildValidator` returns a function
   - Result is `Now(StagedClosure)`
3. `validator` bound to `Now(function)`
4. `validator(x)` - calling a Now function with Later arg
5. Function must be residualizable

**Residual (if buildValidator produces residualizable function):**
```javascript
const validate_User = (data) => {
  // Inlined validation logic
};
validate_User(input)
```

## Higher-Order with Types

### Example 17: Type as First-Class Value

```
let applyToType = fn(f, T) =>
  comptime(f(T))
in
let makeArray = fn(T) => arrayOf(T) in
applyToType(makeArray, number)
```

**Trace:**
1. `f = Now(StagedClosure for makeArray)`
2. `T = Now(TypeValue(isNumber))`
3. `comptime(f(T))`:
   - Calls `makeArray(number)`
   - Returns `Now(TypeValue(arrayOf(isNumber)))`

**Result:** Type value, no residual needed.

### Example 18: Function Returning Function with Type

```
let makeValidator = fn(T) =>
  comptime(
    fn(x) =>
      assert(x, T);
      x
  )
in
let validateNum = makeValidator(number) in
validateNum(runtime(n: input))
```

**Trace:**
1. `T = Now(TypeValue(isNumber))`
2. `comptime(fn(x) => ...)`:
   - Creates function where `T` is captured as Now
   - Function itself is Now (all captures Now)
3. `validateNum = Now(StagedClosure with T=number)`
4. `validateNum(runtime(n: input))`:
   - `x = Later(any)`
   - `assert(x, T)` is NOT in comptime → generates runtime check
   - Refines `x` to `Later(isNumber)`

**Residual:**
```javascript
const validateNum = (n) => {
  if (typeof n !== "number") throw new Error("Not a number");
  return n;
};
validateNum(input)
```

## Key Principles

1. **Comptime forces Now**: The result of `comptime(expr)` must be a Now value.

2. **Comptime disappears**: After evaluation, comptime blocks leave no trace in the residual (only their effects on constraints remain).

3. **Types are Now**: Type values (`TypeValue`) are always Now, so type computations work in comptime.

4. **Assert dual behavior**:
   - In comptime: `comptime(assert(x, T))` → refine constraint, no runtime code
   - Outside comptime: `assert(x, T)` → refine constraint AND generate runtime check

5. **Residualizability is expression-level**: A function is residualizable if its body (after comptimes evaluate) contains only residualizable expressions.

6. **Captures matter**: A value can only be Now if all its captured values are Now. A closure capturing Later values is itself Later.

7. **Staged closures preserve comptime**: When a `StagedClosure` is called, its comptime expressions re-evaluate in the new environment with fresh argument bindings.

## Interaction with Inlining

### Current Inlining Rules

A function call is **inlined** (no named JS function emitted) when:
- The function is NOT called by a name reference, OR
- All arguments are Now AND the result is Now

A function call **emits a named function** when:
- Called by name AND (has Later args OR result is Later)

### How Comptime Affects Inlining

Comptime does NOT directly affect the inlining decision. Rather:

1. **Comptime evaluates first** - before any inlining decision
2. **Body after comptime** determines residualizability
3. **Inlining decision** based on the post-comptime body

### Example: Comptime Enables Full Inlining

```
let double = fn(T) =>
  let factor = comptime(sizeOf(T)) in
  fn(x) => x * factor
in
double(int32)(5)
```

**Trace:**
1. `comptime(sizeOf(int32))` → `Now(4)`
2. `factor = Now(4)`
3. Inner function called with `Now(5)`
4. `5 * 4` → `Now(20)`
5. All Now → fully inlined

**Residual:**
```javascript
20
```

### Example: Comptime with Later Args

```
let double = fn(T) =>
  let factor = comptime(sizeOf(T)) in
  fn(x) => x * factor
in
let doubleInt = double(int32) in
doubleInt(runtime(n: input))
```

**Trace:**
1. `comptime(sizeOf(int32))` → `Now(4)`
2. `factor = Now(4)` captured in closure
3. `doubleInt` called with `Later(any, "n")`
4. Result is `Later` → emit named function
5. `factor` (Now) inlines as literal `4`

**Residual:**
```javascript
const doubleInt = (n) => n * 4;
doubleInt(input)
```

### Example: Comptime Refinement Doesn't Affect Inlining

```
let process = fn(T) => fn(x) =>
  comptime(assert(x, T));
  x + 1
in
process(number)(runtime(n: 5))
```

The comptime refines `x`'s constraint but doesn't change the inlining decision:
- `x` is Later → result is Later → emit function

**Residual:**
```javascript
const process_number = (n) => n + 1;
process_number(5)
```

### Inlining and Type Erasure

After comptime evaluation, types are erased. Two specializations may produce identical code:

```
pair(number)(a, b)  // → [a, b]
pair(string)(a, b)  // → [a, b]  (identical!)
```

The inlining system doesn't distinguish these - both inline to `[a, b]` or both emit separate functions depending on call context.

## Function Specialization Strategies

When type-parameterized functions are called with Later arguments, we need to emit JavaScript functions. Several strategies exist for managing these specializations.

### Strategy A: Always Inline

Each call site gets its own inlined code. No named functions created for specializations.

```
// Source:
let id = fn(T) => fn(x) => comptime(assert(x, T)); x in
id(number)(a); id(number)(b); id(string)(c)

// Residual:
a; b; c
```

**Pros:**
- Simplest implementation
- No function overhead for simple bodies
- Types fully erased

**Cons:**
- Code duplication for complex bodies
- No function reuse across call sites

### Strategy B: Named Functions per Specialization Point

When a specialized function is bound to a name, emit a named JS function.

```
// Source:
let id = fn(T) => fn(x) => comptime(assert(x, T)); x in
let idNum = id(number) in
idNum(a); idNum(b)

// Residual:
const idNum = (x) => x;
idNum(a); idNum(b)
```

**Key insight:** The `let idNum = ...` binding triggers function emission. Anonymous uses inline.

```
// Source:
id(number)(a); id(number)(b)  // No binding

// Residual:
a; b  // Inlined, no function
```

**Pros:**
- User controls where functions are created
- Natural mapping to JS semantics
- Matches current implementation

**Cons:**
- Duplicate code for `id(number)(a); id(number)(b)` without binding

### Strategy C: Memoized Specialization

Hash the post-comptime body + captured Now values. Reuse identical specializations.

```
// Source:
let f = fn(T) => fn(x) => comptime(assert(x, T)); [x, x] in
f(number)(a); f(string)(b)

// Analysis:
// f(number) body after comptime: [x, x] with x:Later(isNumber)
// f(string) body after comptime: [x, x] with x:Later(isString)
// Bodies are structurally identical (types erased) → share!

// Residual:
const f_specialized = (x) => [x, x];
f_specialized(a); f_specialized(b)
```

**Memoization key:** Hash of:
- AST structure of post-comptime body
- Values of captured Now bindings (not types, since erased)

**Pros:**
- Automatic code sharing
- Optimal output size

**Cons:**
- Implementation complexity
- Hashing overhead
- May share unexpectedly (debugging harder)

### Strategy D: Observable Difference Specialization

Only create separate functions when comptime produces different residuals.

```
// Source - comptime produces DIFFERENT runtime code:
let validate = fn(T) => fn(x) =>
  assert(x, T);  // Runtime assertion, differs by type!
  x
in
validate(number)(a); validate(string)(b)

// Residual:
const validate_number = (x) => {
  if (typeof x !== "number") throw ...;
  return x;
};
const validate_string = (x) => {
  if (typeof x !== "string") throw ...;
  return x;
};
validate_number(a); validate_string(b)
```

```
// Source - comptime produces SAME runtime code:
let id = fn(T) => fn(x) => comptime(assert(x, T)); x in
id(number)(a); id(string)(b)

// Residual (shared):
const id_any = (x) => x;
id_any(a); id_any(b)
```

**Pros:**
- Optimal: shares when safe, separates when needed
- Handles runtime assertions correctly

**Cons:**
- Must analyze whether specializations differ
- More complex than simple hashing

### Strategy E: Explicit Emit Annotation

User explicitly marks where functions should be emitted.

```
// Source:
let pair = fn(T) => emit fn(x, y) =>
  comptime({ assert(x, T); assert(y, T) });
  [x, y]
in
pair(number)(a, b); pair(number)(c, d)

// Residual:
const pair_number = (x, y) => [x, y];
pair_number(a, b); pair_number(c, d)
```

Without `emit`:
```
let pair = fn(T) => fn(x, y) => ...  // Always inline
```

**Pros:**
- Full user control
- Clear semantics
- Optimization hints

**Cons:**
- Extra syntax burden
- User must understand when to use

### Recommended Hybrid Approach

Combine strategies B and C:

1. **Named bindings trigger emission** (Strategy B)
   - `let f = specializedFn` → emit named function

2. **Anonymous calls inline** (Strategy A)
   - `genericFn(Type)(args)` → inline if simple

3. **Memoize when emitting** (Strategy C)
   - Multiple bindings to equivalent specializations share one function
   - Key: structural hash of post-comptime body + Now captures

```
// Source:
let pair = fn(T) => fn(x, y) => comptime({assert(x,T); assert(y,T)}); [x, y] in
let pairNum = pair(number) in
let pairInt = pair(number) in  // Same specialization!
pairNum(a, b); pairInt(c, d); pair(number)(e, f)

// Residual:
const pair_0 = (x, y) => [x, y];  // Shared by pairNum and pairInt
pair_0(a, b); pair_0(c, d); [e, f]  // Last one inlined (no binding)
```

### Implementation Sketch

```typescript
interface SpecializationKey {
  bodyHash: string;        // Structural hash of post-comptime AST
  nowCaptures: Map<string, Value>;  // Captured Now values (not types)
}

const specializationCache = new Map<string, string>();  // key → JS function name

function emitSpecialization(closure: StagedClosure, name: string): string {
  // 1. Evaluate comptime sections
  const postComptimeBody = evaluateComptimeSections(closure);

  // 2. Compute specialization key
  const key = computeSpecializationKey(postComptimeBody, closure.captures);
  const keyStr = JSON.stringify(key);

  // 3. Check cache
  if (specializationCache.has(keyStr)) {
    return specializationCache.get(keyStr)!;  // Reuse existing
  }

  // 4. Generate new function
  const fnName = generateUniqueName(name);
  const jsCode = residualizeFunction(postComptimeBody, closure.params);
  emit(`const ${fnName} = ${jsCode};`);

  // 5. Cache for future reuse
  specializationCache.set(keyStr, fnName);
  return fnName;
}
```

### Design Decisions

1. **Share identical implementations**: When `pair(number)` and `pair(string)` produce identical post-comptime bodies, they share a single JS function. Type erasure is embraced - types are for compile-time checking, not runtime identity.

2. **Naming convention**: Prefer type-based names when feasible (`pair_number`, `validate_string`). Fall back to sequential (`pair_0`) or hash-based (`pair_a1b2c3`) if type names are complex or unavailable.

### Future Work

- **Cross-module sharing**: Can specializations be shared across compilation units?
- **Debug info**: How to map specialized functions back to source for stack traces?

## Current Inlining Behavior Analysis

### Observed Issue

Looking at generated output (e.g., `calculator.js`):

```javascript
// Line 17-22: Function is defined
const clear = () => (() => {
  setDisplay("0");
  setMemory(0);
  setOperation(null);
  return setWaitingForOperand(false);
})();

// Line 130-136: Same body is INLINED instead of referencing `clear`
jsx("button", {
  style: opStyle,
  onClick: () => (() => {
    setDisplay("0");
    setMemory(0);
    setOperation(null);
    return setWaitingForOperand(false);
  })(),
  children: "C"
})
```

The source has `onClick={clear}` but the output has the full body inlined.

### Root Cause

When `StagedClosure` is bound to a name via `let clear = fn() => ...`:
1. A JS `const clear = ...` is emitted (correct)
2. The `StagedClosure` is stored in the environment
3. Later, when `clear` is used as a value (e.g., `onClick={clear}`), it's residualized
4. `svalueToResidual(StagedClosure)` calls `stagedClosureToResidual()` which **re-evaluates the body**
5. Result: full body inlined instead of variable reference

The `StagedClosure` doesn't track that it has been bound to a name.

### Current Inlining Rules (Actual)

**evalLet** (lines 392-412):
- Emits `let` binding if:
  - Value is Later/LaterArray/StagedClosure AND variable is used in body, OR
  - Value is Now with compound type AND variable is used in body

**evalCall** (lines 813-833):
- Emits call expression (not inlined) if:
  - Function is called by name (`funcExpr.tag === "var"`) AND
  - (any arg is Later OR result is Later)
- Otherwise: inlines the body

**svalueToResidual** for StagedClosure:
- Always calls `stagedClosureToResidual()` which re-evaluates the body
- **Missing**: Check for existing name binding

### Desired Behavior

| Source                       | Current Output                      | Desired Output                |
|------------------------------|-------------------------------------|-------------------------------|
| `let f = fn() => body`       | `const f = () => body;`             | `const f = () => body;`       |
| `onClick={f}`                | `onClick: () => body` (re-expanded) | `onClick: f` (reference)      |
| `onClick={fn() => f()}`      | `onClick: () => body` (inlined)     | `onClick: () => f()` (call)   |
| `g(1, 2)` where `g` is named | `g(1, 2)`                           | `g(1, 2)` (correct)           |
| `(fn(x) => x + 1)(5)`        | `5 + 1` or `6`                      | `6` (inline is fine)          |

### Fix Alternatives

#### Alternative A: Add `residual` Field to StagedClosure

Like `Later` has a `residual` field, add one to `StagedClosure`:

```typescript
export interface StagedClosure {
  stage: "closure";
  body: Expr;
  params: string[];
  env: SEnv;
  name?: string;
  constraint: Constraint;
  residual?: Expr;  // NEW: if set, use this instead of re-evaluating
}
```

When bound in a let:
```typescript
if (isStagedClosure(valueResult)) {
  const boundClosure = { ...valueResult, residual: varRef(name) };
  newEnv = newEnv.set(name, { svalue: boundClosure });
}
```

In `svalueToResidual`:
```typescript
if (isStagedClosure(sv)) {
  if (sv.residual) return sv.residual;
  return stagedClosureToResidual(sv);
}
```

**Pros:**
- Minimal change to existing types
- Consistent with how `Now` and `Later` use residuals

**Cons:**
- Requires immutable update of StagedClosure at binding time
- Must ensure all binding paths set the residual

#### Alternative B: Wrapper Type for Bound Closures

Create a new SValue variant for closures with known names:

```typescript
export interface BoundClosure {
  stage: "boundClosure";
  closure: StagedClosure;
  boundName: string;
}

export type SValue = Now | Later | StagedClosure | LaterArray | BoundClosure;
```

`svalueToResidual` for `BoundClosure`:
```typescript
if (sv.stage === "boundClosure") {
  return varRef(sv.boundName);
}
```

**Pros:**
- Explicit separation of bound vs unbound closures
- Clear semantics

**Cons:**
- Another SValue variant to handle everywhere
- More invasive change

#### Alternative C: Context-Based Binding Tracking

Maintain a `Map<StagedClosure, string>` during evaluation that tracks which closures have been bound to names.

**Pros:**
- No type changes needed

**Cons:**
- Requires identity comparison of closures (reference equality)
- Context must be threaded through evaluation

#### Alternative D: Never Re-evaluate, Always Store Residual

When creating a StagedClosure, immediately compute and store its residual form:

```typescript
function evalFn(params, body, env): SEvalResult {
  const closure = stagedClosure(body, params, env, isFunction);
  const residual = stagedClosureToResidual(closure);
  return { svalue: { ...closure, residual } };
}
```

Then `svalueToResidual` just returns the stored residual.

**Pros:**
- Simple, consistent

**Cons:**
- Computes residual even when not needed
- Can't optimize based on call-site context

### Implemented Fix: Alternative A

Added `residual` field to `StagedClosure`. When bound via let:

1. Compute the closure's residual (the function expression)
2. Emit `const name = <residual>;`
3. Store in environment with `residual: varRef(name)` override

This ensures:
- First use: full function expression emitted
- Subsequent uses: just the variable name

**Files changed:**
- `src/svalue.ts`: Added `residual?: Expr` field to `StagedClosure`
- `src/staged-evaluate.ts`:
  - `evalLet`: Sets `residual: varRef(name)` when binding a StagedClosure
  - `svalueToResidual`: Returns `sv.residual` if set, otherwise calls `stagedClosureToResidual`
  - `evalCall`: Uses `func.residual` when emitting call expressions
  - `evalCall`: Propagates residual to returned closures from partial application

### Also Fixed: Call Inlining

The same fix also addresses this case:

```
let f = fn() => body in
fn() => f()  // Now correctly emits () => f()
```

Because `f` has `residual: varRef("f")` from the binding, and `evalCall` checks for `func.residual`, calls to bound functions are now emitted as calls rather than inlined.

**Behavior:**
- If result is Later: emit `f()` (call)
- If result is Now: inline the value (optimization)

**Examples:**
```javascript
// Source: let f = fn() => runtime(x: 1) + 2 in fn() => f()
// Output: (() => { const f = () => x + 2; return () => f(); })()

// Source: let f = fn() => 1 + 2 in fn() => f()
// Output: (() => { const f = () => 3; return () => 3; })()  // Now result inlined
```

### Also Fixed: Curried Function Calls

When a bound function is partially applied, the resulting closure now carries a residual representing the partial application:

```
let minLength = fn(n) => fn(s) => s.length >= n in
minLength(8)(password)
```

**Before:** Inlined with weird destructuring:
```javascript
(() => { const [s] = [password]; return s.length >= 8; })()
```

**After:** Proper call chain:
```javascript
minLength(8)(password)
```

This works because when `minLength(8)` returns a closure, we set its residual to `minLength(8)`. When that closure is later called with `password`, we emit `minLength(8)(password)`.