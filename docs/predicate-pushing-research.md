# Predicate Pushing Optimization Research

## Goal

Generate efficient JavaScript from filter expressions that avoid creating intermediate arrays.

### Input Pattern (dependent-ts)

```
let email = runtime("") in
let isEmpty = fn(s) => s.length == 0 in

[if isEmpty(email) then "Email required"
 else if !isValidEmail(email) then "Invalid email"
 else null,
 if isEmpty(password) then "Password required"
 else null
].filter(fn(x) => x != null)
```

### Current Output (naive)

```javascript
[email.length == 0 ? "Email required"
 : !isValidEmail(email) ? "Invalid email"
 : null,
 password.length == 0 ? "Password required" : null
].filter(x => x != null)
```

This creates an intermediate array containing nulls, then filters them out.

### Desired Output

```javascript
const _arr = [];
if (email.length == 0) {
  _arr.push("Email required");
} else if (!isValidEmail(email)) {
  _arr.push("Invalid email");
}
if (password.length == 0) {
  _arr.push("Password required");
}
return _arr;
```

No intermediate array, no nulls created, no filter pass.

## The Transformation

The key insight is that the filter predicate `fn(x) => x != null` can be **pushed into** each element's conditional structure.

For an element like:
```
if isEmpty(email) then "Email required" else null
```

With predicate `x != null`:
- When result is `"Email required"`: predicate evaluates to `true` → push
- When result is `null`: predicate evaluates to `false` → skip

The transformation rewrites:
```
if (predicate(if C then V else W)) then BODY else ALT
```

Into:
```
if C then
  (if predicate(V) then BODY else ALT)
else
  (if predicate(W) then BODY else ALT)
```

At leaf values (literals), the predicate can often be evaluated at compile time, eliminating branches entirely.

## Implementation Approach Attempted

### 1. Definition Tracking

Store the original expression that defined each variable in `SBinding`:

```typescript
interface SBinding {
  svalue: SValue;
  definition?: Expr;  // The expression that defined this variable
}
```

### 2. Predicate Detection

In `evalIf`, detect when the condition references a variable with a conditional definition:

```typescript
function findVarWithConditionalDef(expr: Expr, env: SEnv): { varName: string; definition: Expr } | null
```

### 3. Expression Substitution

Substitute variable occurrences with concrete values:

```typescript
function substituteVar(expr: Expr, varName: string, replacement: Expr): Expr
```

### 4. Predicate Pushing

Transform the if-expression by pushing the predicate into conditional leaves:

```typescript
function pushPredicateIntoConditional(
  condExpr: Expr,      // e.g., x != null
  xDef: Expr,          // e.g., if C then V else W
  thenExpr: Expr,      // e.g., push(x)
  elseExpr: Expr,      // e.g., null
  varName: string      // "x"
): Expr
```

### Issue Encountered

When substituting concrete values (like `"test"`) into predicates, the type system fails. For example:

```
isEmpty("test")  // where isEmpty = fn(s) => s.length == 0
```

The evaluator tries to access `.length` on the string value, but `evalField` requires `isObject` constraint. Strings have `.length` in JavaScript but our type system doesn't model this.

This is fixable, but the broader issue is that the substitution approach may need more sophisticated handling of:
- Type constraints during substitution
- Avoiding re-evaluation of complex expressions
- Termination guarantees

---

## Supercompilation Research

The transformation we're attempting is a well-studied technique called **supercompilation**, specifically the **driving** mechanism with **positive information propagation**.

### Key Concepts

#### Driving

The supercompiler builds a **process tree** exploring all execution paths:

1. **Known value**: Perform normal reduction
2. **Case/if on unknown variable**: Branch the tree for each possible value

#### Positive Information Propagation

When branching on a condition, substitute the assumed value into that branch:

```
if x then A else B
```

Becomes two branches:
- Branch 1: Evaluate `A` with `x := true` substituted
- Branch 2: Evaluate `B` with `x := false` substituted

This is exactly what we were trying to implement.

#### Example (from SAT solving)

Given `x AND (NOT x)` as nested ifs:

```
if(x, if(x, T, F), F)
```

Supercompilation with `x = true`:
- Outer branch: `if(true, T, F)` → `T`... wait, inner `if(x,...)` also has `x=true` substituted → `T`

With `x = false`:
- Outer branch goes to `F`

Result: Both paths don't satisfy, formula is unsatisfiable. The supercompiler proves this automatically via propagation.

### Termination & Generalization

Supercompilers must handle:

1. **Infinite trees**: Use homeomorphic embedding to detect when configurations are "growing" and generalize
2. **Code explosion**: Memoize/fold back to previous states
3. **Negative information**: Track what values are NOT possible (perfect supercompilation)

### Key Papers

| Paper | Authors | Year | Key Contribution |
|-------|---------|------|------------------|
| [The Concept of a Supercompiler](https://www.semanticscholar.org/paper/The-concept-of-a-supercompiler-Turchin/10b78c7fca62e5b2774411c7f053db9c2266d459) | Turchin | 1986 | Original concept |
| [A Positive Supercompiler](https://www.cambridge.org/core/journals/journal-of-functional-programming/article/positive-supercompiler/4EEE2EBC972AA2FDC861EF7A713EE898) | Sørensen, Glück, Jones | 1996 | Foundational formalization |
| [Turchin's Supercompiler Revisited](https://www.semanticscholar.org/paper/Turchin's-Supercompiler-Revisited-An-operational-of-S%C3%B8rensen/f83e9ce07ff507b38c2b79bc963ffcaa5b402148) | Sørensen | 1994 | Operational theory of positive information propagation |
| [On Perfect Supercompilation](https://link.springer.com/chapter/10.1007/3-540-46562-6_10) | Sørensen, Glück | 1998 | Negative information propagation |
| [Rethinking Supercompilation](https://dl.acm.org/doi/10.1145/1863543.1863588) | Mitchell, Runciman | 2010 | Practical Haskell implementation, 2x speedups |
| [A Supercompiler for Core Haskell](https://link.springer.com/chapter/10.1007/978-3-540-85373-2_9) | Mitchell, Runciman | 2008 | Let-binding handling, generalization |

### Blog Posts & Tutorials

- [Solving SAT via Positive Supercompilation](https://hirrolot.github.io/posts/sat-supercompilation.html) - Excellent intuitive explanation with concrete examples
- [Introduction to Supercompilation](https://link.springer.com/chapter/10.1007/3-540-47018-2_10) - Springer chapter overview

### Implementations

| Name | Language | Notes |
|------|----------|-------|
| **Supero** | Haskell | Neil Mitchell's implementation |
| **HOSC** | Haskell | Higher-order supercompiler by Klyuchnikov |
| **SPSC** | Scala | Simple supercompiler for educational purposes |

### Related Techniques

- **Partial Evaluation**: Specialize programs given partial inputs (less powerful than supercompilation)
- **Deforestation**: Eliminate intermediate data structures (Wadler) - supercompilation subsumes this
- **Stream Fusion**: Fuse array operations in Haskell's vector library
- **GPC (Generalized Partial Computation)**: Related metacomputation technique

---

## Potential Approaches for dependent-ts

### Option A: Full Supercompilation Pass

Implement a separate supercompilation phase after parsing but before staging. Would handle all optimizations uniformly but adds complexity.

### Option B: Targeted Transformation in Filter Builtin

The current approach in `builtin-registry.ts` handles the filter case specifically:
- Detect `Later` array with array literal residual
- Walk element expressions, pushing predicate into conditionals
- Generate imperative builder form

This worked for simple cases but struggled with the `isEmpty` function call.

### Option C: Symbolic Execution with Constraints

Instead of substituting concrete values, track symbolic constraints:
- `x := if C then V else W` means `x` has constraint `C => x=V, !C => x=W`
- When evaluating `predicate(x)`, branch symbolically
- Avoids type errors from premature concretization

### Option D: Two-Phase Approach

1. First pass: Identify filter patterns and mark elements for optimization
2. Second pass: During codegen, generate imperative form directly

---

## Open Questions

1. How do existing supercompilers handle typed languages where substitution might violate type constraints?

2. Is there a simpler approach that doesn't require full expression substitution? Perhaps pattern-matching on the predicate structure?

3. Could we leverage the existing refinement context to track "predicate assumptions" rather than substituting values?

4. How do we handle predicates that aren't simple null checks (e.g., `x > 0`, `x.startsWith("a")`)?