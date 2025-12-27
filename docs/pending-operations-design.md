# Pending Operations Design: Filter as a Codegen Concern

## Motivation

The original predicate-pushing research (see `predicate-pushing-research.md`) attempted to optimize filter expressions during evaluation by pushing predicates into conditional structures. This ran into issues with type system constraints during value substitution.

**Alternative insight**: Instead of optimizing during evaluation, treat `.filter` (and similar array operations) as "pending operations" that the code generator handles in a target-specific way.

This separates concerns:
- **Evaluator**: Captures *what* (a filtered array with a predicate)
- **Codegen**: Decides *how* (imperative loop, SQL WHERE, naive `.filter()`, etc.)

---

## Running Example

```
let email = runtime("email": "") in
[if isEmpty(email) then "Email required"
 else if !isValidEmail(email) then "Invalid email"
 else null,
 if isEmpty(password) then "Password required"
 else null
].filter(fn(x) => x != null).filter(fn(x) => x != "Email required")
```

**Desired JS output:**
```javascript
const _arr = [];
if (email.length != 0 && !isValidEmail(email)) {
  _arr.push("Invalid email");
}
if (password.length == 0) {
  _arr.push("Password required");
}
```

---

## Three Alternatives Analyzed

### Alternative 1: New Constraint Variant

**Idea**: Add a constraint that captures the filtering operation semantically.

```typescript
filteredElements(
  sourceElements: Constraint,  // The original array structure
  predicate: Constraint        // What elements must satisfy
)
```

**Example representation:**
```typescript
{
  kind: "later",
  constraint: filteredElements(
    arrayLiteral([
      conditional(isEmpty(email), equals("Email required"),
        conditional(!isValidEmail(email), equals("Invalid email"), equals(null))),
      conditional(isEmpty(password), equals("Password required"), equals(null))
    ]),
    and(not(equals(null)), not(equals("Email required")))
  ),
  residual: /* minimal or original expression */
}
```

**Problems:**

1. **Category confusion**: Constraints describe *properties of values*, not *how values were computed*. Encoding `conditional(c, a, b)` inside a constraint is essentially an expression, not a property.

2. **Constraint operations break**: How do you compute `implies(filteredElements(...), elements(isString))`? Simplification, implication, and unification would need to understand operational structure.

3. **Duplication**: Codegen needs actual expressions to generate code, but constraints only have constraint-ified versions. You'd need to awkwardly pair constraint info with residual info.

**Verdict**: Poor fit. Overloads the type system with operational semantics.

---

### Alternative 2: Richer Residual Representation

**Idea**: Keep constraints pure (describing types), but make the residual more than just raw `Expr`. Create an intermediate representation that preserves semantic structure.

```typescript
type Residual =
  | Expr                    // fallback to raw expression
  | FilteredArrayIR
  | MappedArrayIR
  // ... other structured forms

interface FilteredArrayIR {
  kind: "filtered-array";
  elements: Array<{
    expr: Expr;             // The original expression
    svalue: SValue;         // What we know about it (Now or Later)
  }>;
  predicates: SValue[];     // The filter predicates (composed)
}
```

**Example representation:**
```typescript
{
  kind: "later",
  constraint: and(isArray, elements(and(isString, not(equals(null)), not(equals("Email required"))))),
  residual: {
    kind: "filtered-array",
    elements: [
      {
        expr: IfExpr(Call(isEmpty, [Var("email")]),
                     Literal("Email required"),
                     IfExpr(Not(Call(isValidEmail, [Var("email")])),
                            Literal("Invalid email"),
                            Literal(null))),
        svalue: Later {
          constraint: or(equals("Email required"), equals("Invalid email"), equals(null))
        }
      },
      {
        expr: IfExpr(Call(isEmpty, [Var("password")]),
                     Literal("Password required"),
                     Literal(null)),
        svalue: Later {
          constraint: or(equals("Password required"), equals(null))
        }
      }
    ],
    predicates: [
      Now(Closure(fn(x) => x != null)),
      Now(Closure(fn(x) => x != "Email required"))
    ]
  }
}
```

**Codegen process:**
```
For element 0:
  Path: isEmpty(email) -> "Email required"
    Check: "Email required" != null -> true
    Check: "Email required" != "Email required" -> false
    -> DEAD BRANCH (skip entirely)

  Path: !isEmpty(email) && !isValidEmail(email) -> "Invalid email"
    Check: "Invalid email" != null -> true
    Check: "Invalid email" != "Email required" -> true
    -> EMIT: if (!isEmpty(email) && !isValidEmail(email)) push("Invalid email")

  Path: !isEmpty(email) && isValidEmail(email) -> null
    Check: null != null -> false
    -> DEAD BRANCH

For element 1:
  Path: isEmpty(password) -> "Password required"
    Check: both predicates pass
    -> EMIT: if (isEmpty(password)) push("Password required")

  Path: !isEmpty(password) -> null
    Check: null != null -> false
    -> DEAD BRANCH
```

**Multi-target flexibility:**

SQL-like target:
```sql
SELECT value FROM (
  SELECT CASE
    WHEN NOT isEmpty(email) AND NOT isValidEmail(email) THEN 'Invalid email'
    ELSE NULL
  END AS value
  UNION ALL
  SELECT CASE
    WHEN isEmpty(password) THEN 'Password required'
    ELSE NULL
  END
) t WHERE value IS NOT NULL
```

**Advantages:**
- Clean separation: Constraint = type, Residual = computation structure
- Constraint operations unchanged
- Progressive enhancement: Unknown patterns fall back to `Expr`
- Target-flexible

**Disadvantages:**
- Two representations (both `Expr` and structured IR exist)
- Where to draw the line on which operations get special IR forms?
- Composition complexity for chains like `.filter(...).map(...).filter(...)`

---

### Alternative 3: SValue Variant

**Idea**: Add new kinds of `SValue` for deferred operations. These form a tree of pending computations.

```typescript
type SValue =
  | { kind: "now"; value: Value }
  | { kind: "later"; constraint: Constraint; residual: Expr }
  | { kind: "filtered-array"; base: SValue; predicate: SValue }
  | { kind: "mapped-array"; base: SValue; mapper: SValue }
  | { kind: "flat-mapped-array"; base: SValue; mapper: SValue }
```

**Example representation:**
```typescript
{
  kind: "filtered-array",
  base: {
    kind: "filtered-array",
    base: {
      kind: "later",
      constraint: and(isArray, elements(or(isString, equals(null)))),
      residual: ArrayLiteral([...])
    },
    predicate: { kind: "now", value: Closure(fn(x) => x != null) }
  },
  predicate: { kind: "now", value: Closure(fn(x) => x != "Email required") }
}
```

This is a tree: `FilteredArray(FilteredArray(ArrayLiteral, p1), p2)`

**Constraint computation on demand:**
```typescript
function constraintOf(sv: SValue): Constraint {
  switch (sv.kind) {
    case "now":
      return constraintFromValue(sv.value);
    case "later":
      return sv.constraint;
    case "filtered-array": {
      const baseConstr = constraintOf(sv.base);
      const elemConstr = extractElementConstraint(baseConstr);
      const predConstr = predicateToConstraint(sv.predicate);
      return and(isArray, elements(and(elemConstr, predConstr)));
    }
    case "mapped-array": {
      const baseConstr = constraintOf(sv.base);
      const mapperReturnConstr = inferMapperReturn(sv.mapper, extractElementConstraint(baseConstr));
      return and(isArray, elements(mapperReturnConstr));
    }
  }
}
```

**Codegen fusion:**
```typescript
interface FusedArrayOps {
  source: SValue;
  operations: ArrayOperation[];
}

type ArrayOperation =
  | { kind: "filter"; predicate: SValue }
  | { kind: "map"; mapper: SValue }
  | { kind: "flatMap"; mapper: SValue };

function fuseArrayOps(sv: SValue): FusedArrayOps {
  if (sv.kind === "filtered-array") {
    const inner = fuseArrayOps(sv.base);
    return {
      ...inner,
      operations: [...inner.operations, { kind: "filter", predicate: sv.predicate }]
    };
  }
  if (sv.kind === "mapped-array") {
    const inner = fuseArrayOps(sv.base);
    return {
      ...inner,
      operations: [...inner.operations, { kind: "map", mapper: sv.mapper }]
    };
  }
  return { source: sv, operations: [] };
}
```

**Example: Map + Filter Fusion**

Source:
```
[1, 2, 3].map(fn(x) => x * 2).filter(fn(x) => x > 3)
```

SValue tree:
```typescript
FilteredArray {
  base: MappedArray {
    base: Now([1, 2, 3]),
    mapper: Now(Closure(x => x * 2))
  },
  predicate: Now(Closure(x => x > 3))
}
```

Fused:
```typescript
{
  source: Now([1, 2, 3]),
  operations: [
    { kind: "map", mapper: Closure(x => x * 2) },
    { kind: "filter", predicate: Closure(x => x > 3) }
  ]
}
```

Codegen (JS):
```javascript
const _arr = [];
for (const x of [1, 2, 3]) {
  const mapped = x * 2;
  if (mapped > 3) {
    _arr.push(mapped);
  }
}
```

Since source is literal with all-Now elements, full compile-time evaluation:
```
x=1: mapped=2, 2>3=false -> skip
x=2: mapped=4, 4>3=true -> include
x=3: mapped=6, 6>3=true -> include
```
Result: `[4, 6]`

**Advantages:**
- Natural composition: Chains build up as nested structures
- Lazy by design: Operations recorded, not executed
- Maximum optimization potential: Fusion sees whole chain
- Clean semantics: Each variant has clear meaning

**Disadvantages:**
- More SValue kinds needed
- Constraint computation overhead
- Evaluator complexity: Every array method needs special handling
- What about `reduce`, `find`, `some`, `every`, `indexOf`?

**Mitigation - Generic pending operation:**
```typescript
type SValue =
  | { kind: "now"; value: Value }
  | { kind: "later"; constraint: Constraint; residual: Expr }
  | { kind: "pending-array-op"; base: SValue; operation: ArrayOpKind; arg: SValue }

type ArrayOpKind = "filter" | "map" | "flatMap" | "find" | "some" | "every";
```

---

## Comparison Summary

| Aspect | Constraint Variant | Richer Residual | SValue Variant |
|--------|-------------------|-----------------|----------------|
| **Conceptual fit** | Poor (types != operations) | Good (residual = code) | Good (lazy ops) |
| **Constraint purity** | Polluted | Clean | Clean (computed) |
| **Composability** | Awkward | Good | Excellent |
| **Codegen info** | Incomplete | Complete | Complete |
| **Architecture impact** | High (constraint ops) | Medium (new IR) | Medium (new SValue) |
| **Extensibility** | Poor | Good | Excellent |
| **Multi-target** | Hard | Easy | Easy |

---

## Recommendation: Hybrid of 2 & 3

Use **SValue variants** for semantic structure, keeping each variant simple:

```typescript
type SValue =
  | { kind: "now"; value: Value }
  | { kind: "later"; constraint: Constraint; residual: Expr }
  | { kind: "pending-array-op";
      base: SValue;
      op: "filter" | "map" | "flatMap";
      fn: SValue;
      constraint?: Constraint;  // cached, computed lazily
    }
```

**Evaluator for `.filter()` becomes simple:**
```typescript
function evalFilter(arr: SValue, pred: SValue): SValue {
  // If arr is Now with literal array AND pred is Now,
  // we could evaluate eagerly or still defer for codegen optimization
  if (isNow(arr) && isNow(pred) && isArrayLiteral(arr.value)) {
    // Option: evaluate now, or defer for optimization
  }

  // Build pending operation
  return {
    kind: "pending-array-op",
    base: arr,
    op: "filter",
    fn: pred
  };
}
```

**Target-specific codegen:**
```typescript
function generateJS(sv: SValue): string {
  if (sv.kind === "pending-array-op") {
    const fused = fuseArrayOps(sv);
    return generateFusedArrayJS(fused);  // Imperative push loop
  }
  // ...
}

function generateSQL(sv: SValue): string {
  if (sv.kind === "pending-array-op") {
    const fused = fuseArrayOps(sv);
    return generateFusedArraySQL(fused);  // WHERE clauses
  }
  // ...
}
```

**Benefits of this approach:**
- Clean semantic representation (SValue tree of operations)
- Target flexibility (codegen decides optimization strategy)
- Composability (chains naturally nest)
- Constraint purity (computed from structure when needed)
- Future extensibility (add ops, add targets)

---

## Open Questions

1. **Eager vs lazy for Now values**: If the array and predicate are both fully known at compile time, should we evaluate immediately or still defer to codegen? (Probably evaluate, but codegen could handle it too)

2. **Constraint caching**: When/how to cache the computed constraint on pending operations to avoid recomputation?

3. **Operation coverage**: Which array operations get special treatment? Candidates:
   - `filter`, `map`, `flatMap` (definitely)
   - `find`, `some`, `every` (short-circuit semantics)
   - `reduce` (more complex, maybe later)
   - `slice`, `concat` (structural operations)

4. **Residual preservation**: For the base array, do we need to preserve the original expression structure (conditional elements) separately from the SValue, or is the Later residual sufficient?

5. **Predicate representation**: How do we convert predicates to constraints for the constraint computation? This is needed for `constraintOf(filtered-array)`.