# Plan: Body-Based Function Specialization (Two-Pass)

## Goal

Generate specialized function versions based on the **output body**, not input constraints. Use the base name when there's only one version, suffixes only when multiple distinct bodies exist.

## Current State

The current implementation records specializations during staging based on **input constraints** (e.g., `isNumber`, `isString`). This has issues:
- Functions get suffixed names even when there's only one version (`fact$isNumber` instead of `fact`)
- Specializations are stored on `StagedClosure.specializations` mixing staging and codegen concerns
- Codegen re-stages the body, duplicating work

## Key Insight

During staging, we **already** evaluate the function body with the actual argument constraints. The result's residual IS the specialized body. We should:
1. Store the body directly (not re-stage in codegen)
2. Deduplicate by body content (not by input constraints)
3. Decide names in codegen after seeing all versions

## Two-Pass Approach

### Pass 1: Staging
- When calling a named function with Later result, emit a `specializedCall` node in the residual
- The node contains: closure reference, pre-staged body, and argument residuals
- Don't commit to a function name yet

### Pass 2: Codegen
- Collect all `specializedCall` nodes, group by closure identity
- Deduplicate bodies by content (using `exprToString`)
- If 1 unique body → use base name (`fact`)
- If N unique bodies → use suffixed names (`fact$0`, `fact$1`)
- Emit function definitions, then generate body with calls rewritten to use assigned names

## Implementation Details

### Step 1: Add SpecializedCallExpr to expr.ts

**File: `src/expr.ts`**

```typescript
// Add to Expr union type
export interface SpecializedCallExpr {
  tag: "specializedCall";
  closure: StagedClosure;  // Reference for grouping (uses object identity)
  body: Expr;              // Pre-staged body for this call variant
  args: Expr[];            // Argument residuals
}

// Add constructor
export function specializedCall(closure: StagedClosure, body: Expr, args: Expr[]): SpecializedCallExpr {
  return { tag: "specializedCall", closure, body, args };
}

// Update exprToString to handle it
case "specializedCall":
  return `specializedCall(${e.closure.name ?? "anon"}, ${exprToString(e.body)}, [${e.args.map(exprToString).join(", ")}])`;
```

### Step 2: Modify evalCall in staged-evaluate.ts

**File: `src/staged-evaluate.ts`**

When calling a named function and result is Later, emit `specializedCall` instead of recording to registry:

```typescript
// Current code (to remove):
const specializedName = recordSpecialization(func, argConstraints);
callResidual = call(varRef(specializedName), ...argResiduals);

// New code:
import { specializedCall } from "./expr";

// The body is already staged - result.svalue contains the residual
const bodyResidual = svalueToResidual(result.svalue);
callResidual = specializedCall(func, bodyResidual, argResiduals);
```

**Remove these functions:**
- `recordSpecialization`
- `normalizeConstraintForSpecialization`
- `constraintsToKey`

### Step 3: Remove specializations from svalue.ts

**File: `src/svalue.ts`**

```typescript
// Remove:
export interface Specialization { ... }

// Remove from StagedClosure:
specializations?: Map<string, Specialization>;
```

### Step 4: Two-pass codegen in svalue-module-generator.ts

**File: `src/svalue-module-generator.ts`**

#### 4a. Collection phase

```typescript
interface SpecializationInfo {
  closure: StagedClosure;
  bodyKey: string;      // exprToString(body) for deduplication
  body: Expr;
}

// Collect all specializedCall nodes from an expression tree
function collectSpecializations(expr: Expr): Map<StagedClosure, SpecializationInfo[]> {
  const result = new Map<StagedClosure, SpecializationInfo[]>();

  function walk(e: Expr): void {
    if (e.tag === "specializedCall") {
      const bodyKey = exprToString(e.body);
      const existing = result.get(e.closure) ?? [];
      // Only add if this body isn't already collected
      if (!existing.some(s => s.bodyKey === bodyKey)) {
        existing.push({ closure: e.closure, bodyKey, body: e.body });
        result.set(e.closure, existing);
      }
    }
    // Recursively walk children...
    // (similar to existing tree traversal patterns)
  }

  walk(expr);
  return result;
}
```

#### 4b. Name assignment phase

```typescript
// Returns: closure -> bodyKey -> functionName
function assignNames(
  specs: Map<StagedClosure, SpecializationInfo[]>
): Map<StagedClosure, Map<string, string>> {
  const result = new Map<StagedClosure, Map<string, string>>();

  for (const [closure, bodies] of specs) {
    const baseName = closure.name ?? "fn";
    const nameMap = new Map<string, string>();

    if (bodies.length === 1) {
      // Single version - use base name
      nameMap.set(bodies[0].bodyKey, baseName);
    } else {
      // Multiple versions - use suffixed names
      bodies.forEach((spec, i) => {
        nameMap.set(spec.bodyKey, `${baseName}$${i}`);
      });
    }

    result.set(closure, nameMap);
  }

  return result;
}
```

#### 4c. Generation phase

```typescript
// Extended context with specialization name mapping
interface ModuleGenContext {
  // ... existing fields ...
  specializationNames: Map<StagedClosure, Map<string, string>>;
}

// Handle specializedCall in generateFromExpr
case "specializedCall": {
  const bodyKey = exprToString(expr.body);
  const nameMap = ctx.specializationNames.get(expr.closure);
  const name = nameMap?.get(bodyKey) ?? expr.closure.name ?? "fn";
  return jsCall(jsVar(name), expr.args.map(a => generateFromExpr(a, ctx)));
}
```

#### 4d. Entry point modification

Modify `generateLet` (or add new function) to handle closures with specializations:

```typescript
function generateLet(name: string, value: Expr, body: Expr, ctx: ModuleGenContext): JSExpr {
  // If value is deferredClosure, collect specializations from body
  if (value.tag === "deferredClosure") {
    const specs = collectSpecializations(body);
    const closureSpecs = specs.get(value.closure);

    if (closureSpecs && closureSpecs.length > 0) {
      const names = assignNames(new Map([[value.closure, closureSpecs]]));
      const newCtx = { ...ctx, specializationNames: new Map([...ctx.specializationNames, ...names]) };

      // Emit function definitions
      const stmts: JSStmt[] = [];
      for (const spec of closureSpecs) {
        const fnName = names.get(value.closure)!.get(spec.bodyKey)!;
        const params = extractParamsFromBody(value.closure.body).params;
        stmts.push(jsConst(fnName, generateFnExpr(params, spec.body, newCtx)));
      }

      // Generate body with updated context
      if (body.tag === "let" || body.tag === "letPattern") {
        stmts.push(...collectLetChainStmtsFromMiddle(body, newCtx));
      } else {
        stmts.push(jsReturn(generateFromExpr(body, newCtx)));
      }

      return jsIIFE(stmts);
    }
  }

  // ... existing let handling ...
}
```

## Handling Recursive Functions

Self-calls within a function body also become `specializedCall` nodes. Since they reference the **same** closure object, they naturally group together:

```
let fact = fn(n) => if n == 0 then 1 else n * fact(n - 1)
fact(runtime(5))
```

The self-call `fact(n - 1)` produces a `specializedCall` with the same closure as the outer call. Both get grouped, deduplicated, and assigned the same name.

**Important**: The body of the self-call might differ from the outer call (e.g., different argument values lead to different staged bodies). They'll be deduplicated by body content, and if identical, share one function definition.

## Files to Modify

| File | Changes |
|------|---------|
| `src/expr.ts` | Add `SpecializedCallExpr`, constructor, update `exprToString` |
| `src/svalue.ts` | Remove `Specialization` interface and `specializations` field from `StagedClosure` |
| `src/staged-evaluate.ts` | Emit `specializedCall` instead of `call(varRef(specializedName), ...)`, remove specialization recording functions |
| `src/svalue-module-generator.ts` | Add collection/naming phases, handle `specializedCall` in `generateFromExpr`, modify `generateLet` |

## Example Walkthrough

### Input
```
let id = fn(x) => x in
{ a: id(runtime(n)), b: id(runtime(s)) }
```

### After Staging
```
{
  a: specializedCall(<id closure>, n, [n]),
  b: specializedCall(<id closure>, s, [s])
}
```

### Codegen Pass 1 - Collect
- closure `id` has specializations: `[{bodyKey: "n", body: n}, {bodyKey: "s", body: s}]`

### Codegen Pass 2 - Deduplicate & Name
- Both bodies are just variable references, but they're different (`n` vs `s`)
- Wait, actually for `fn(x) => x`, the body is just `x` regardless of what's passed!
- So both would have `bodyKey: "x"` and deduplicate to one entry
- Assigned name: `id` (base name, since only one unique body)

### Generated Output
```javascript
(() => {
  const id = (x) => x;
  return { a: id(n), b: id(s) };
})()
```

### If Bodies Were Different
If we had a type-dependent function where `typeOf(x)` produces different bodies:
```javascript
(() => {
  const withDefault$0 = (x) => x === null ? "" : x;  // string version
  const withDefault$1 = (x) => x === null ? 0 : x;   // number version
  return withDefault$0(s) + withDefault$1(n);
})()
```

## Edge Cases

1. **No specializedCall nodes**: Closure was never called with Later args, or all calls evaluated to Now. No function emitted (dead code elimination for free).

2. **Anonymous closures**: Use generated name like `fn$0`, `fn$1` for the base name.

3. **Nested specializations**: Inner closures get their own specialization collection/naming at their let binding scope.

4. **Curried functions**: Each level has its own closure and gets handled independently.
