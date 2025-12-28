# What we have

Expressions and a parser:

```typescript
export type Expr =
  | LitExpr
  | VarExpr
  | BinOpExpr
  | UnaryOpExpr
  | IfExpr
  | LetExpr
  // ... etc
```

A "staged" interpreter:

SValue which is either:
- a compile time value and constraint - Value, Constraint
- a value that can be computed later but has compile time constraints - Expr, Constraint
- a later array value which has an array of SValues and an array constraint - SValue[], Constraint

The interpreter function:
```typescript
stagingEvaluate(expr: Expr, env: SEnv, ctx: RefinementContext = RefinementContext.empty()): SEvalResult
```

Which simply returns an SValue.

# Builtins

There is a bunch of builtin functions which collect and check constraints, also calculate Now results given the right arguments.

# Compiling as an interpreter

So the end goal is to have compiler builtins which can do their own compiling using the staged interpreter as a client when needed.

## Example Use Cases

### esModule - Generate ES modules

Simply emits the expression as `export default`, collecting imports at the top.

```
esModule(
  import { fetch } from "node-fetch" in
  fn(userId) => fetch("/api/user/" + userId)
)
```

Output:
```javascript
import { fetch } from "node-fetch";
export default (userId) => fetch("/api/user/" + userId);
```

If you want a plain value:
```
esModule(
  let x = 10 in
  let y = 20 in
  { sum: x + y, product: x * y }
)
```

Output:
```javascript
export default { sum: 30, product: 200 };
```

The user controls the structure - `esModule` just handles import collection and JS emission.

### sql - Generate parameterized SQL

```
sql(
  let userId = runtime("userId") in
  let minAge = 18 in
  select(users, where(id == userId && age >= minAge))
)
```

Output:
```sql
SELECT * FROM users WHERE id = $1 AND age >= 18
-- params: [userId]
```

### wasm - Compile to WebAssembly

```
wasm(
  fn fib(n: i32): i32 =>
    if n <= 1 then n else fib(n-1) + fib(n-2)
)
```

## What Compiler Builtins Need

All these backends need to **analyze** the staged result:

| Need | esModule | sql | wasm |
|------|----------|-----|------|
| Collect Later vars | → params | → $1, $2 | → func args |
| Collect imports | → import {} | → (N/A) | → imports |
| Inspect Now values | → inline | → inline | → const |
| Walk residual tree | → JS codegen | → SQL codegen | → bytecode |
| Type info | → TypeScript | → column types | → i32/f64 |

# Problem: Hidden Environment

## Current Design Issues

1. **Closures use a global WeakMap** to store their captured environment:
   ```typescript
   const stagedClosures = new WeakMap<Value, SClosure>();
   ```
   This is implicit, fragile, and prevents inspection.

2. **Later values rely on implicit emission context** - the residual contains variable references that assume surrounding let bindings will exist.

3. **Compiler builtins can't inspect dependencies** - they can invoke closures but can't see what they capture.

## Proposed Design: Self-Describing SValues

### New SValue Types

```typescript
type LaterOrigin =
  | { kind: "runtime"; name: string }      // From runtime("name")
  | { kind: "import"; module: string }     // From import { x } from "mod"
  | { kind: "derived" };                   // Computed from other values

interface Now {
  stage: "now";
  value: Value;
  constraint: Constraint;
}

interface Later {
  stage: "later";
  constraint: Constraint;
  residual: Expr;
  captures: Map<string, SValue>;  // Explicit dependencies
  origin: LaterOrigin;
}

interface StagedClosure {
  stage: "closure";
  body: Expr;
  params: string[];
  env: SEnv;
  name?: string;                  // For recursive self-reference
  constraint: Constraint;
}

interface LaterArray {
  stage: "later-array";
  elements: SValue[];
  constraint: Constraint;
  // Elements carry their own captures
}

type SValue = Now | Later | StagedClosure | LaterArray;
```

### Benefits

1. **No global WeakMap** - closures carry their env directly
2. **Explicit dependencies** - Later values know what they capture
3. **Origin tracking** - distinguish runtime inputs vs imports vs derived
4. **Inspectable closures** - builtins can analyze body and captures
5. **Self-contained** - any SValue can be emitted in any context

# Edge Cases

## 1. Recursive Functions

```
fn fac(n) => if n == 0 then 1 else n * fac(n-1)
```

The closure references itself. Use `name?: string` for self-reference:

```typescript
StagedClosure {
  name: "fac",
  body: ...,
  env: { /* doesn't include fac */ }
}
```

When evaluating the body, bind `name` to the closure itself.

**Mutual recursion via grouped let bindings:**

```
let
  isEven = fn(n) => if n == 0 then true else isOdd(n-1),
  isOdd = fn(n) => if n == 0 then false else isEven(n-1)
in
isEven(10)
```

Extend `LetExpr` to have multiple bindings that are all in scope for each other:

```typescript
interface LetExpr {
  tag: "let";
  bindings: Array<{ name: string; value: Expr }>;
  body: Expr;
}
```

**Staged evaluation for mutual let:**
1. Create all closures with placeholder env
2. Build complete env with all bindings (closures reference each other)
3. Update each closure's captured env to include all siblings
4. Evaluate body with complete env

This works for closures because they don't evaluate their body until called.

**Non-closure values** evaluate left-to-right and cannot reference later bindings

## 2. Nested Closures

```
let x = runtime(1) in
let f = fn(y) =>
  let g = fn(z) => x + y + z in
  g
in
f(2)(3)
```

- `f` captures `{x: Later}`
- `g` (when `f(2)` called) captures `{x: Later, y: Now(2)}`
- `g` (when `f(runtime(0))` called) captures `{x: Later, y: Later}`

Each closure captures what it needs at creation time. Works naturally.

**Inner closure calling outer function:**

```
fn outer(x) =>
  let inner = fn(y) => if y == 0 then x else outer(y) in
  inner(x)
```

Works because `name` is bound before body evaluation - `inner` sees `outer` in its captured env.

## 3. Later Functions (Opaque)

```
let f = runtime(someFn) in
f(5)
```

`f` is `Later` with `constraint: isFunction`. Can't inspect body - just emit call.

**Wrapping a Later function:**

```
let f = runtime(someFn) in
let wrap = fn(g) => fn(x) => g(x) in
wrap(f)
```

Returns a StagedClosure that captures `g: Later`. When emitting, the builtin traces captures to find the runtime dependency on `f`.

## 4. Origin vs Captures

`origin` = WHERE this Later came from
`captures` = WHAT this Later depends on

```
let x = runtime("x") in
let y = runtime("y") in
x + y
```

Result:
```typescript
Later {
  origin: { kind: "derived" },
  residual: binop("+", varRef("x"), varRef("y")),
  captures: Map {
    "x": Later { origin: { kind: "runtime", name: "x" }, ... },
    "y": Later { origin: { kind: "runtime", name: "y" }, ... }
  }
}
```

Builtins walk `captures` transitively to find all runtime inputs and imports.

## 5. Captures vs Bound Variables

`captures` contains only FREE variables in the residual, not variables bound within it:

```
let x = runtime(0) in
let y = x + 1 in
y + 2
```

Residual: `let y = x + 1 in y + 2`
Captures: `{ x: Later(origin: runtime) }` — NOT `y`, which is bound in residual.

## 6. Closures Capturing Later (Runtime Dependencies)

```
let userId = runtime("userId") in
let fetchUser = fn() => fetch("/api/user/" + userId) in
fetchUser
```

`fetchUser` = StagedClosure with env: `{ userId: Later(origin: runtime) }`

When emitting for esModule, the builtin must decide how to provide `userId`:
```javascript
// Option 1: Wrapper function
export default (userId) => () => fetch("/api/user/" + userId);

// Option 2: Assume userId in scope (depends on context)
export default () => fetch("/api/user/" + userId);
```

The builtin inspects the closure's env to find Later captures and their origins.

## 7. Diamond Dependencies

```
let a = fn(x) => x + 1 in
let b = fn(y) => a(y) + 1 in
let c = fn(z) => a(z) + 2 in
let d = fn(w) => b(w) + c(w) in
d
```

`d` captures `b` and `c`, both capture `a`.

**Builtins must deduplicate:** Walk captures recursively, collect unique closures, emit each once in dependency order.

Output order: `a`, then `b` and `c`, then `d`.

## 8. Now Compounds (Reference vs Inline)

```
let obj = { a: 1, b: 2 } in
fn(x) => obj.a + x
```

Captures include Now values. Builtin decides:
- Primitives: inline as literals
- Compounds: emit let binding, reference by name

## 9. Closures as Object Fields

```
let x = runtime("userId") in
let handlers = {
  fetch: fn() => getUser(x)
} in
handlers
```

`handlers` is Now (object value), but `handlers.fetch` is a StagedClosure that captures Later `x`.

When emitting `handlers`, must also handle the runtime dependency in the nested closure.

## 10. LaterArray Elements

```
[1, runtime("x"), 3]
```

Results in:
```typescript
LaterArray {
  elements: [Now(1), Later(origin: runtime), Now(3)],
  constraint: ...
}
```

Walk elements to collect captures from any Later elements.

# Implications of Mutual Let for Builtins

## Siblings vs Captures

Closures that mutually reference each other form a cycle - these are "siblings":

```
let
  isEven = fn(n) => ... isOdd(n-1),
  isOdd = fn(n) => ... isEven(n-1)
in isEven
```

If `captures` included siblings, we'd have circular references:
- `isEven.captures = { isOdd: ... }`
- `isOdd.captures = { isEven: ... }`

**Important:** Grouped bindings that don't reference each other are NOT siblings:

```
let
  a = 10,           // references: none → independent
  b = a + 1,        // references: a → depends on a
  isEven = fn(n) => ... isOdd(n-1),  // references: isOdd ↔
  isOdd = fn(n) => ... isEven(n-1),  // references: isEven ↔ mutual!
  c = 30            // references: none → independent
in ...
```

Only `{isEven, isOdd}` are true siblings (strongly connected component).
`a`, `b`, `c` can be emitted independently in dependency order.

**Solution:** `siblings` only includes bindings in the same cycle:

```typescript
interface StagedClosure {
  stage: "closure";
  body: Expr;
  params: string[];
  env: SEnv;
  name?: string;
  siblings?: string[];  // Only bindings that form a mutual reference cycle
  constraint: Constraint;
}
```

Grouped let is syntactic convenience. Mutual groups are determined by reference analysis.

## Emitting Mutual Groups

When a builtin encounters a closure that has siblings, it must emit all of them together:

```
let
  isEven = fn(n) => ...,
  isOdd = fn(n) => ...
in
let wrapper = fn(x) => isEven(x) in
wrapper
```

`wrapper` captures `isEven`. Builtin must:
1. See `isEven` has sibling `isOdd`
2. Emit both together as a unit
3. Then emit `wrapper`

For `esModule`:
```javascript
// Mutual group emitted together
const isEven = (n) => n === 0 ? true : isOdd(n - 1);
const isOdd = (n) => n === 0 ? false : isEven(n - 1);
export default (x) => isEven(x);
```

## Residual Let Structure

The residual reflects grouping:

```typescript
// Single binding
{ tag: "let", bindings: [{ name: "x", value: ... }], body: ... }

// Mutual group
{ tag: "let", bindings: [
  { name: "isEven", value: ... },
  { name: "isOdd", value: ... }
], body: ... }
```

Builtins check `bindings.length > 1` to detect mutual groups.

# Compiler Builtin API

With the new design, builtins can:

```typescript
handler(args: SValue[], argExprs: Expr[], ctx: BuiltinContext): SEvalResult {
  const body = args[0];

  if (body.stage === "closure") {
    // Inspect closure structure
    const { body, params, env, name } = body;

    // Collect all runtime inputs from env
    const runtimeInputs = collectByOrigin(env, "runtime");

    // Collect imports
    const imports = collectByOrigin(env, "import");

    // Stage-evaluate body to get residual
    const result = ctx.stageBody(body);

    // Generate target code with full knowledge of dependencies
    return generateTargetCode(result, runtimeInputs, imports);
  }

  // Handle Later, Now, etc.
}
```

# Open Questions

1. Should `LaterArray` aggregate captures from elements, or just rely on walking elements?

2. How should imports be represented in captures vs as a separate structure?

3. Should there be a common "walk SValue tree" utility for builtins?