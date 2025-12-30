# Alpha-Equivalent Residuals: Specialization Deduplication

This document describes a principled approach to function specialization deduplication based on the concept of "alpha-equivalent residuals."

## The Problem

Consider the calculator example's `inputDigit` function:

```
let inputDigit = fn(digit) =>
  if waitingForOperand then
    { setDisplay(digit); setWaitingForOperand(false) }
  else
    setDisplay(if display == "0" then digit else display + digit)
```

Called 10 times: `inputDigit("0")`, `inputDigit("1")`, ... `inputDigit("9")`

The current system generates **10 specialized functions**:

```javascript
function inputDigit$0() {
  if (waitingForOperand) { setDisplay("0"); setWaitingForOperand(false); }
  else { setDisplay(display === "0" ? "0" : display + "0"); }
}
function inputDigit$1() {
  if (waitingForOperand) { setDisplay("1"); setWaitingForOperand(false); }
  else { setDisplay(display === "0" ? "1" : display + "1"); }
}
// ... 8 more identical structures
```

These are **structurally identical** - they differ only in the literal digit value. This is wasteful.

## Core Insight

The key observation is distinguishing between two ways a Now (compile-time known) argument can be used:

1. **Structural Position**: The value affects what code gets generated
2. **Value Position**: The value merely appears in the generated code

If a Now argument is only used in value positions, multiple call sites can share the same generated code by parameterizing over that value.

## Definitions

### Structural Position

A position where a Now value affects code generation structure:

| Usage | Example | Why Structural |
|-------|---------|----------------|
| Inside `comptime()` | `if comptime(x) == 1 then ...` | Determines which branch is taken at compile time |
| Argument to `typeOf()` | `let T = typeOf(x) in if T == number...` | Type inspection affects code path |
| Dynamic field name | `dynamicField(obj, fieldName)` | Field name determines property access |
| Iterable in `comptimeFold()` | `comptimeFold(fields(T), ...)` | Array length determines loop unrolling |
| Compile-time condition | `if comptime(config.debug) then ...` | Boolean determines dead code elimination |

### Value Position

A position where a Now value is merely present in output without affecting structure:

| Usage | Example | Why Value |
|-------|---------|-----------|
| Function argument | `setDisplay(digit)` | Value passed through unchanged |
| Arithmetic operand | `x + digit` | Value used in runtime computation |
| Object field value | `{ name: userName }` | Value stored in object |
| Array element | `[a, b, c]` | Value stored in array |
| Runtime comparison | `if display == digit then ...` | Comparison happens at runtime |

### Alpha-Equivalence

> Two residuals R1 and R2 are **alpha-equivalent** if and only if:
> 1. They have identical AST structure (same node types, operators, field names)
> 2. All differing leaf values are literals of the **same type**
> 3. Differing literals correspond to the **same parameter** in the original function

## Examples

### Example 1: Calculator (Alpha-Equivalent)

For `inputDigit("7")` vs `inputDigit("8")`:

```
Walk ASTs in parallel:
├── IfExpr
│   ├── condition: waitingForOperand     ✓ identical
│   ├── then: BlockExpr
│   │   ├── setDisplay(●)                ← "7" vs "8" (string, VARYING)
│   │   └── setWaitingForOperand(false)  ✓ identical
│   └── else: setDisplay(IfExpr)
│       ├── condition: display == "0"    ✓ identical
│       ├── then: ●                      ← "7" vs "8" (string, VARYING)
│       └── else: display + ●            ← "7" vs "8" (string, VARYING)

Result: ALPHA-EQUIVALENT
Varying positions: 3 (all string literals derived from `digit` parameter)
```

**Merged result:**
```javascript
function inputDigit(digit) {
  if (waitingForOperand) {
    setDisplay(digit);
    setWaitingForOperand(false);
  } else {
    setDisplay(display === "0" ? digit : display + digit);
  }
}

inputDigit("0");
inputDigit("1");
// ... etc
```

### Example 2: Type-Directed (NOT Alpha-Equivalent)

```
let format = fn(x) =>
  let T = typeOf(x) in
  if T == number then x * 2
  else x + x
```

For `format(numVar)` vs `format(strVar)`:

```
Walk ASTs in parallel:
├── BinOp
│   ├── operator: *        vs  +         ✗ DIFFERENT
│   └── ...

Result: NOT ALPHA-EQUIVALENT (structural difference)
```

These remain as separate specializations because `typeOf()` is a **structural observation** - it caused different code to be generated.

### Example 3: Same Structure, Different Types (NOT Alpha-Equivalent)

```
let identity = fn(x) => x
```

For `identity(42)` vs `identity("hello")`:

```
Residual 1: 42      (number literal)
Residual 2: "hello" (string literal)

Result: NOT ALPHA-EQUIVALENT (types differ)
```

Even though the structure is "just a literal," the types are different. A parameterized function would require `any` type, losing type safety.

### Example 4: Nested Varying Values (Alpha-Equivalent)

```
let makePoint = fn(x, y) => { x: x, y: y }
```

For `makePoint(1, 2)` vs `makePoint(3, 4)`:

```
Walk ASTs in parallel:
├── ObjectExpr
│   ├── field "x": ●     ← 1 vs 3 (number, VARYING)
│   └── field "y": ●     ← 2 vs 4 (number, VARYING)

Result: ALPHA-EQUIVALENT
Varying positions: 2 (both number literals)
```

**Merged result:**
```javascript
function makePoint(x, y) {
  return { x: x, y: y };
}
```

### Example 5: Partial Overlap (Multiple Clusters)

```
let format = fn(x) =>
  let T = typeOf(x) in
  if T == number then x * 2
  else x + x
```

Call sites:
- `format(num1)` where num1: number
- `format(num2)` where num2: number
- `format(str1)` where str1: string

```
Cluster 1: {format(num1), format(num2)}
  - Both produce: x * 2
  - Alpha-equivalent (same structure)

Cluster 2: {format(str1)}
  - Produces: x + x
  - Different structure from Cluster 1
```

**Result:** 2 specialized functions instead of 3.

## Algorithm

### Phase 1: Collect Specializations

Gather all `SpecializedCall` nodes for each function, as currently done during staging.

### Phase 2: Cluster by Alpha-Equivalence

```typescript
function clusterSpecializations(specs: SpecializedCall[]): Cluster[] {
  const clusters: Cluster[] = [];

  for (const spec of specs) {
    let merged = false;

    for (const cluster of clusters) {
      const diff = computeAlphaDiff(spec.body, cluster.representative.body);
      if (diff !== null) {
        // Alpha-equivalent - can merge
        cluster.add(spec, diff);
        merged = true;
        break;
      }
    }

    if (!merged) {
      // New cluster needed
      clusters.push(new Cluster(spec));
    }
  }

  return clusters;
}
```

### Phase 3: Code Generation

For each cluster:

**Single-member cluster:**
- Emit as currently done (inline or named function)

**Multi-member cluster:**
1. Generate ONE parameterized function
2. Parameters correspond to varying positions
3. Replace each call site with a call passing specific literal values

### Computing Alpha-Diff

```typescript
type ASTPath = (string | number)[];
type AlphaDiff = Map<ASTPath, { type: Type; values: Value[] }>;

function computeAlphaDiff(e1: Expr, e2: Expr, path: ASTPath = []): AlphaDiff | null {
  // Different node types = structural mismatch
  if (e1.tag !== e2.tag) return null;

  // Both are literals
  if (e1.tag === 'literal') {
    const t1 = typeOf(e1.value);
    const t2 = typeOf(e2.value);

    // Different types = not alpha-equivalent
    if (t1 !== t2) return null;

    // Same value = no diff at this position
    if (e1.value === e2.value) return new Map();

    // Different values of same type = varying position
    return new Map([[path, { type: t1, values: [e1.value, e2.value] }]]);
  }

  // Recursively compare children, merge diffs
  const diff = new Map();
  for (const [key, child1, child2] of zipChildren(e1, e2)) {
    const childDiff = computeAlphaDiff(child1, child2, [...path, key]);

    // Propagate structural mismatch
    if (childDiff === null) return null;

    // Merge child diffs
    for (const [p, v] of childDiff) {
      diff.set(p, v);
    }
  }

  return diff;
}
```

## Tracking Parameter Provenance

To know which original parameter each varying position came from, we can use symbolic tracking:

```typescript
interface SymbolicNow {
  tag: 'symbolic';
  paramIndex: number;    // Which parameter this came from
  paramName: string;     // Original parameter name
  actualValue: Value;    // The concrete value
}
```

During staging:
1. Wrap Now arguments in `SymbolicNow` wrappers
2. When building residuals, if a `SymbolicNow` flows to a value position unchanged, record its provenance
3. Use provenance to determine parameter ordering in merged functions

This enables consistent parameter ordering across all call sites in a cluster.

## Benefits

1. **No semantic changes** - Pure code generation optimization, staging semantics unchanged
2. **Preserves necessary specialization** - Type-directed code still generates different functions
3. **Eliminates unnecessary duplication** - When Now values don't affect structure
4. **Significant code size reduction** - Calculator goes from 10 functions to 1
5. **Generalizes naturally** - Works for any function, any number of Now arguments
6. **Principled decision making** - Clear criteria for when to specialize vs share

## Edge Cases

### Varying values at different depths

```
f({x: {y: 1}}) vs f({x: {y: 2}})
```

Alpha-equivalent - the varying position is nested but still just a literal value.

### Varying in one branch only

```
let g = fn(x, flag) =>
  if flag then x else 0
```

For `g(1, true)` vs `g(2, true)`:
- Both take the `then` branch (flag is true)
- Residuals: `1` vs `2`
- Alpha-equivalent

For `g(1, true)` vs `g(2, false)`:
- Different branches taken
- Residuals: `1` vs `0`
- Still alpha-equivalent! (both are number literals)

But wait - the `0` doesn't come from `x`. This is where provenance tracking matters. If we require varying positions to come from the SAME parameter, then `g(1, true)` and `g(2, false)` would NOT be merged (different provenance).

### Function values in varying positions

```
let apply = fn(f, x) => f(x)
```

If `f` is a Now closure, the residual includes the closure's code. Two different closures would have different residual structures, so NOT alpha-equivalent (correctly).

## Relationship to Existing System

The current system uses `comptimeParams` to track which parameters are used in `comptime()` expressions. This is a conservative approximation:

- **Current**: Specialize if ANY comptime param differs
- **Proposed**: Specialize only if structural positions differ

The proposed approach is strictly more permissive - it will share code in cases where the current system creates duplicates.

## Implementation Path

1. **Add provenance tracking** to Now values during staging
2. **Implement `computeAlphaDiff`** for comparing residual ASTs
3. **Modify code generation** to cluster before emitting
4. **Generate parameterized functions** for multi-member clusters
5. **Update call sites** to pass varying values as arguments

## Summary

The key insight: **specialize based on structural observations, deduplicate based on alpha-equivalence of residuals**.

A function call should generate a new specialization only if the Now arguments cause structurally different code to be emitted. When the code structure is the same and only literal values differ, those call sites should share one implementation with the varying values passed as parameters.
