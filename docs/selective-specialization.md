# Selective Specialization

This document describes an alternative approach to function specialization that avoids the need for post-hoc JS clustering by only specializing when compile-time knowledge provides meaningful optimization benefits.

## The Problem

When a function has `comptime` parameters, the current system creates a specialized version for each unique set of compile-time argument values:

```
let greet = fn(greeting) => fn(name) => greeting + ", " + name

let hello = greet(comptime("Hello"))
let hi = greet(comptime("Hi"))

hello(runtime("name"))
hi(runtime("name"))
```

This generates specialized versions for each greeting:

```javascript
const hello = (name) => "Hello, " + name;
const hi = (name) => "Hi, " + name;
```

But this specialization provides **no optimization benefit** — we've just inlined a constant. The same result could be achieved with closure capture:

```javascript
const greet = (greeting) => (name) => greeting + ", " + name;
const hello = greet("Hello");
const hi = greet("Hi");
```

Contrast with:

```
let process = fn(op) => if op == "add" then a + b else a - b

process(comptime("add"))  // Specialization eliminates the branch
process(comptime("sub"))  // Different branch eliminated
```

Here specialization **does** help — the conditional is eliminated at compile time.

## Core Principle

**Only specialize when compile-time knowledge enables optimization beyond simple constant substitution.**

Specifically, specialize when the comptime parameter:

1. **Controls branching** — appears in conditionals
2. **Discriminates types** — used for type narrowing/assertion
3. **Determines structure** — affects object shape or array length
4. **Enables loop optimization** — known iteration count

If the parameter just becomes a literal in the output, pass it at runtime instead.

## Classification of Comptime Parameter Usage

### Interesting Uses (Worth Specializing)

#### 1. Conditional Control

```
let factorial = fn(n) =>
  if n == 0 then 1
  else n * factorial(comptime(n - 1))
```

The comptime `n` controls which branch executes. Specializing for `n=5` completely unrolls the recursion:

```javascript
const factorial$5 = () => 5 * 4 * 3 * 2 * 1 * 1;  // Fully evaluated
```

#### 2. Type Discrimination

```
let handle = fn(tag) =>
  if tag == "number" then assert(x, Number) + 1
  else if tag == "string" then assert(x, String).length
  else 0
```

When `tag` is comptime-known, dead branches are eliminated and type assertions can be optimized.

#### 3. Property Access Patterns

```
let getter = fn(field) => fn(obj) => obj[field]

let getName = getter(comptime("name"))
let getAge = getter(comptime("age"))
```

Specializing allows:
- Static property access instead of dynamic
- Better type inference for the return type
- JS engine hidden class optimization

#### 4. Array/Loop Bounds

```
let sumN = fn(n) => fn(arr) =>
  let loop = fn(i, acc) =>
    if i >= n then acc
    else loop(comptime(i + 1), acc + arr[i])
  in loop(comptime(0), 0)
```

Known bounds enable loop unrolling:

```javascript
const sum3 = (arr) => arr[0] + arr[1] + arr[2];
```

### Uninteresting Uses (Don't Specialize)

#### 1. Simple Literal Substitution

```
let greet = fn(name) => "Hello, " + name

greet(comptime("Alice"))
greet(comptime("Bob"))
```

The parameter just becomes a string literal. No optimization benefit.

**Better approach:** Keep as runtime parameter.

```javascript
const greet = (name) => "Hello, " + name;
greet("Alice");
greet("Bob");
```

#### 2. Pass-Through to Other Functions

```
let log = fn(level) => fn(msg) => console.log(level + ": " + msg)

let info = log(comptime("INFO"))
let warn = log(comptime("WARN"))
```

The `level` parameter is just passed to `console.log`. No control flow depends on it.

**Better approach:**

```javascript
const log = (level) => (msg) => console.log(level + ": " + msg);
const info = log("INFO");
const warn = log("WARN");
```

Or even simpler — don't partially apply at all.

#### 3. Object Field Values

```
let makePoint = fn(x, y) => { x: x, y: y }

makePoint(comptime(0), comptime(0))
makePoint(comptime(1), comptime(1))
```

The comptime values just become literals in object fields.

**Better approach:**

```javascript
const makePoint = (x, y) => ({ x, y });
makePoint(0, 0);
makePoint(1, 1);
```

#### 4. Arithmetic on Constants

```
let scale = fn(factor) => fn(x) => x * factor

let double = scale(comptime(2))
let triple = scale(comptime(3))
```

Multiplying by a constant vs a variable has negligible performance difference in JS.

**Better approach:**

```javascript
const scale = (factor) => (x) => x * factor;
const double = scale(2);
const triple = scale(3);
```

## Implementation Strategy

### Phase 1: Usage Analysis

During staging, track how each comptime parameter is used:

```typescript
type ParamUsage = {
  inConditional: boolean;      // Used in if/match condition
  inTypeAssertion: boolean;    // Used in assert/trust
  inPropertyAccess: boolean;   // Used as property key
  inLoopBound: boolean;        // Used in loop termination
  literalOnly: boolean;        // Only appears as literal value
};

function analyzeComptimeUsage(param: string, body: Expr): ParamUsage {
  // Walk the expression tree, tracking where param appears
}
```

### Phase 2: Specialization Decision

```typescript
function shouldSpecialize(usage: ParamUsage): boolean {
  // Specialize if used in "interesting" positions
  if (usage.inConditional) return true;
  if (usage.inTypeAssertion) return true;
  if (usage.inPropertyAccess) return true;
  if (usage.inLoopBound) return true;

  // Don't specialize for mere literal substitution
  return false;
}
```

### Phase 3: Parameter Promotion

For comptime params that shouldn't specialize, convert them to runtime params:

```
// Original
let greet = fn(name) => "Hello, " + name
greet(comptime("Alice"))

// After analysis: name is literalOnly, don't specialize
// Transformed to:
let greet = fn(name) => "Hello, " + name
greet("Alice")  // Runtime parameter
```

### Phase 4: Selective Code Generation

Only generate specialized variants for functions where specialization was deemed worthwhile:

```typescript
function generateFunction(closure: Closure, specs: Specialization[]): JSStmt[] {
  const usage = analyzeComptimeUsage(closure);

  if (!shouldSpecialize(usage)) {
    // Generate single generic function
    return [generateGenericFunction(closure)];
  }

  // Generate specialized variants (current behavior)
  return specs.map(spec => generateSpecialization(spec));
}
```

## Examples

### Example 1: Calculator Operations

```
let calc = fn(op) => fn(a, b) =>
  if op == "add" then a + b
  else if op == "sub" then a - b
  else if op == "mul" then a * b
  else a / b

let add = calc(comptime("add"))
let sub = calc(comptime("sub"))
```

**Analysis:** `op` is used in conditionals → **specialize**

**Output:**

```javascript
const add = (a, b) => a + b;
const sub = (a, b) => a - b;
```

### Example 2: Logger

```
let makeLogger = fn(prefix) => fn(msg) => console.log(prefix + ": " + msg)

let info = makeLogger(comptime("INFO"))
let warn = makeLogger(comptime("WARN"))
```

**Analysis:** `prefix` is only used in string concatenation → **don't specialize**

**Output:**

```javascript
const makeLogger = (prefix) => (msg) => console.log(prefix + ": " + msg);
const info = makeLogger("INFO");
const warn = makeLogger("WARN");
```

### Example 3: Type-Safe Getter

```
let prop = fn(key) => fn(obj) =>
  if key == "name" then assert(obj.name, String)
  else if key == "age" then assert(obj.age, Number)
  else null

let getName = prop(comptime("name"))
let getAge = prop(comptime("age"))
```

**Analysis:** `key` is used in conditionals and affects type assertions → **specialize**

**Output:**

```javascript
const getName = (obj) => assertString(obj.name);
const getAge = (obj) => assertNumber(obj.age);
```

### Example 4: Vector Operations

```
let dot = fn(n) => fn(a, b) =>
  let loop = fn(i, sum) =>
    if i >= n then sum
    else loop(comptime(i + 1), sum + a[i] * b[i])
  in loop(comptime(0), 0)

let dot3 = dot(comptime(3))
let dot4 = dot(comptime(4))
```

**Analysis:** `n` controls loop termination → **specialize**

**Output:**

```javascript
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const dot4 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
```

### Example 5: Mixed Usage

```
let process = fn(tag, label) =>
  if tag == "double" then
    { label: label, value: x * 2 }
  else
    { label: label, value: x + 1 }

process(comptime("double"), comptime("Result"))
```

**Analysis:**
- `tag` is used in conditional → specialize for tag
- `label` is only used as literal → don't specialize for label

**Output:**

```javascript
const process$double = (label) => ({ label, value: x * 2 });

// Call site:
process$double("Result");
```

## Comparison with JS Clustering

| Aspect | JS Clustering | Selective Specialization |
|--------|---------------|-------------------------|
| When analysis happens | After JS generation | During staging |
| Information available | Only JS structure | Types, constraints, control flow |
| Wasted work | Generates JS then discards | Avoids generation |
| Runtime overhead | Extra parameters for holes | No overhead for unspecialized |
| Code quality | May lose optimizations | Preserves optimizations |
| Implementation complexity | ~800 lines JS comparison | Usage analysis pass |

## Conclusion

Selective specialization front-loads the decision about whether to specialize, using semantic information that's available during staging but lost after JS generation. This approach:

1. **Avoids unnecessary work** — doesn't generate code that will be merged away
2. **Preserves optimization benefits** — specializes when it helps
3. **Reduces runtime overhead** — no extra parameters for clustering
4. **Simplifies the compiler** — no JS AST comparison needed

The key insight is that **not all compile-time knowledge is equally valuable**. Specialization should be reserved for cases where it enables meaningful optimization, not just constant substitution.