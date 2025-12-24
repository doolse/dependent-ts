# CLAUDE.md

## Project Overview

This is a TypeScript implementation of a dependent type system with **constraints-as-types**. Types are represented as logical predicates (constraints) that values must satisfy, unifying traditional types with refinement types.

The system includes:
- A staged evaluator (partial evaluation with Now/Later staging)
- A JavaScript code generator for residual expressions
- A lexer and parser for the expression language
- Type inference with constraint solving

## Build & Test Commands

```bash
npm test           # Run vitest tests
npm run tsc        # Type-check with TypeScript
npm run repl       # Start the interactive REPL
npm run docs:verify  # Verify documentation examples are up-to-date
```

## Architecture

### Core Modules (in `src/`)

| File | Purpose |
|------|---------|
| `constraint.ts` | Constraint types and operations (the type system core) |
| `value.ts` | Runtime values (number, string, bool, object, array, closure, type) |
| `expr.ts` | Expression AST and constructors |
| `staged-evaluate.ts` | Staged evaluator with Now/Later partial evaluation |
| `svalue.ts` | Staged values (Now = compile-time known, Later = runtime) |
| `codegen.ts` | JavaScript code generator |
| `env.ts` | Environment and refinement context |
| `builtins.ts` | Built-in operations (+, -, *, /, ==, etc.) |
| `refinement.ts` | Control flow refinement extraction |
| `inference.ts` | Type inference for functions |
| `lexer.ts` | Tokenizer for the expression language |
| `parser.ts` | Recursive descent parser |
| `index.ts` | Public API exports |

### Key Concepts

**Constraints** represent types as predicates:
- Classification: `isNumber`, `isString`, `isBool`, `isNull`, `isObject`, `isArray`, `isFunction`
- Value constraints: `equals(v)`, `gt(n)`, `gte(n)`, `lt(n)`, `lte(n)`
- Structural: `hasField(name, constraint)`, `elements(constraint)`, `length(constraint)`
- Logical: `and(...)`, `or(...)`, `not(...)`, `never`, `any`
- Meta: `isType(constraint)` - marks a value as being a type
- Recursive: `rec(var, body)`, `recVar(var)` - for recursive types

**Staged Evaluation** distinguishes:
- `Now`: Value fully known at compile-time
- `Later`: Only constraint known, generates residual code

**Special Expressions**:
- `comptime(expr)`: Force compile-time evaluation, error if Later
- `runtime(expr)`: Mark as runtime-only, always becomes Later
- `assert(expr, type)`: Runtime type check, refines constraint
- `trust(expr, type)`: Type refinement without runtime check

## Expression Language Syntax

```
let x = 5 in x + 1
let [a, b] = arr in a + b        // Destructuring
fn(x, y) => x + y
fn fac(n) => if n == 0 then 1 else n * fac(n-1)  // Named recursive
if cond then a else b
{ field: value }
obj.field
[1, 2, 3]
arr[0]
comptime(expr)
runtime(expr)
runtime(name: expr)              // Named runtime variable
assert(value, type)
trust(value, type)
```

## Code Patterns

### Creating and evaluating expressions programmatically

```typescript
import { run, num, add, letExpr, varRef, implies, isNumber, equals } from "./src/index";

const expr = letExpr("x", num(5), add(varRef("x"), num(1)));
const result = run(expr);
// result.value = NumberValue(6)
// result.constraint = and(isNumber, equals(6))
```

### Working with constraints

```typescript
import { and, isNumber, gt, implies, simplify, unify } from "./src/index";

// Create refined type: number > 0
const positiveNumber = and(isNumber, gt(0));

// Check subtyping
implies(gt(5), gt(0)); // true - x > 5 implies x > 0

// Unify constraints (intersection)
const result = unify(positiveNumber, gt(10));
// result = and(isNumber, gt(0), gt(10))

// Simplify detects contradictions
const contradiction = simplify(and(isNumber, isString));
// contradiction = never
```

### Staged evaluation

```typescript
import { stage, stageToExpr, runtime, num, add, varRef, isNow } from "./src/index";

// runtime() marks a value as Later
const expr = add(runtime(num(0), "x"), num(5));
const result = stage(expr);

if (isNow(result.svalue)) {
  // Fully evaluated at compile time
} else {
  // result.svalue.residual contains the residual expression
  // result.svalue.constraint contains the inferred type
}
```

### Code generation

```typescript
import { compile, generateJS } from "./src/index";

const code = compile(expr); // stage + codegen pipeline
```

## Type System Design

- Types are first-class values (`TypeValue` wrapping a `Constraint`)
- `implies(a, b)` checks subtyping (a <: b)
- Control flow narrows types via refinement contexts
- Discriminated unions work via `narrowOr` eliminating contradictory branches
- Recursive types use `rec`/`recVar` with coinductive reasoning for subtyping

## Documentation

See `docs/implementation-guide.md` for a comprehensive deep dive into the implementation, including executable code examples.
