# Staged Interpreter Architecture with Refinements and Reflection

## Overview

This document describes an architecture for an interpreted language that:
1. Accepts programs with some values known and some unknown
2. Tracks type constraints through execution
3. Produces specialized code parameterized by the unknown values
4. Supports compile-time reflection over types

The key insight is **staging**: separating what is known at specialization time ("now") from what must be computed at runtime ("later").

---

## Part 1: Core Staged Evaluation

### 1.1 The Stage Distinction

Every value in the system has a **stage**:

- **"now"**: The value is known at specialization time. We have its concrete value.
- **"later"**: The value is unknown. We generate code that will compute it at runtime.

```typescript
type Stage = "now" | "later"

type SValue =
  | { stage: "now", type: TypeValue, value: any }
  | { stage: "later", type: TypeValue, expr: JsExpr, constraints: Constraint[] }
```

Crucially, **the type is always known**, even for "later" values. We know the shape of data even when we don't know its contents.

### 1.2 Basic Evaluation Rules

The interpreter evaluates expressions, producing either concrete values or generated code:

```typescript
function evaluate(expr: Expr, env: Env): SValue {
  switch (expr.tag) {
    case "literal":
      // Literals are always "now"
      return {
        stage: "now",
        type: inferType(expr.value),
        value: expr.value
      };

    case "variable":
      // Variables come from environment - could be either stage
      return env.get(expr.name);

    case "binary_op":
      const left = evaluate(expr.left, env);
      const right = evaluate(expr.right, env);
      return evalBinaryOp(expr.op, left, right);

    case "field_access":
      const obj = evaluate(expr.object, env);
      return evalFieldAccess(obj, expr.field);

    case "if":
      return evalConditional(expr, env);

    case "function_call":
      return evalCall(expr, env);
  }
}
```

### 1.3 Stage Propagation

Operations combine stages according to simple rules:

```typescript
function evalBinaryOp(op: string, left: SValue, right: SValue): SValue {
  const resultType = inferBinaryOpType(op, left.type, right.type);

  // Both known -> compute the result
  if (left.stage === "now" && right.stage === "now") {
    return {
      stage: "now",
      type: resultType,
      value: applyOp(op, left.value, right.value)
    };
  }

  // At least one unknown -> generate code
  return {
    stage: "later",
    type: resultType,
    expr: jsBinaryOp(op, toExpr(left), toExpr(right)),
    constraints: mergeConstraints(left.constraints, right.constraints)
  };
}

// Convert any SValue to a JS expression
function toExpr(v: SValue): JsExpr {
  if (v.stage === "now") {
    return jsLiteral(v.value);  // Inline the known value
  } else {
    return v.expr;  // Use the generated expression
  }
}
```

### 1.4 Conditional Evaluation

Conditionals are where staging becomes powerful:

```typescript
function evalConditional(expr: IfExpr, env: Env): SValue {
  const condition = evaluate(expr.condition, env);

  if (condition.stage === "now") {
    // Condition is known! Only evaluate one branch.
    if (condition.value) {
      return evaluate(expr.thenBranch, env);
    } else {
      return evaluate(expr.elseBranch, env);
    }
  }

  // Condition is unknown - must generate conditional code
  // But we still evaluate both branches to know their types/code
  const thenVal = evaluate(expr.thenBranch, env);
  const elseVal = evaluate(expr.elseBranch, env);

  return {
    stage: "later",
    type: unifyTypes(thenVal.type, elseVal.type),
    expr: jsConditional(condition.expr, toExpr(thenVal), toExpr(elseVal)),
    constraints: []  // Constraints handled separately - see Part 2
  };
}
```

### 1.5 Specialization Entry Point

```typescript
function specialize(
  program: FunctionExpr,
  knownInputs: Record<string, any>,
  unknownInputs: Array<{ name: string, type: TypeValue }>
): JsFunction {

  const env = new Env();

  // Known inputs become "now" values
  for (const [name, value] of Object.entries(knownInputs)) {
    env.set(name, {
      stage: "now",
      type: inferType(value),
      value: value
    });
  }

  // Unknown inputs become "later" values referencing parameters
  for (const { name, type } of unknownInputs) {
    env.set(name, {
      stage: "later",
      type: type,
      expr: jsParameter(name),
      constraints: []
    });
  }

  const result = evaluate(program.body, env);

  // Generate the specialized function
  const paramNames = unknownInputs.map(i => i.name);

  if (result.stage === "now") {
    // Fully specialized - return constant
    return jsFunction(paramNames, jsReturn(jsLiteral(result.value)));
  } else {
    return jsFunction(paramNames, jsReturn(result.expr));
  }
}
```

### 1.6 Example: Partial Application

```typescript
// Source function
function add3(a, b, c) {
  return a + b + c;
}

// Specialize with b = 10
specialize(add3, { b: 10 }, [
  { name: "a", type: numberType },
  { name: "c", type: numberType }
])

// Evaluation trace:
// 1. a + b  ->  a + 10  ->  { stage: "later", expr: "a + 10" }
// 2. (a + 10) + c  ->  { stage: "later", expr: "(a + 10) + c" }

// Generated:
function(a, c) {
  return (a + 10) + c;
}
```

---

## Part 2: Refinement System

Refinements track what we **know** about values based on control flow. They don't change staging, but they enable optimizations and provide safety guarantees.

### 2.1 Constraint Representation

```typescript
type Constraint =
  | { tag: "eq", left: ConstraintTerm, right: ConstraintTerm }
  | { tag: "neq", left: ConstraintTerm, right: ConstraintTerm }
  | { tag: "lt", left: ConstraintTerm, right: ConstraintTerm }
  | { tag: "lte", left: ConstraintTerm, right: ConstraintTerm }
  | { tag: "gt", left: ConstraintTerm, right: ConstraintTerm }
  | { tag: "gte", left: ConstraintTerm, right: ConstraintTerm }
  | { tag: "and", left: Constraint, right: Constraint }
  | { tag: "or", left: Constraint, right: Constraint }
  | { tag: "not", inner: Constraint }
  | { tag: "hasField", object: ConstraintTerm, field: string }
  | { tag: "instanceof", value: ConstraintTerm, type: TypeValue }

type ConstraintTerm =
  | { tag: "symbol", name: string }
  | { tag: "literal", value: any }
  | { tag: "field", object: ConstraintTerm, field: string }
```

### 2.2 Refinement Context

The refinement context tracks what we know at each point in execution:

```typescript
type RefinementContext = {
  // Constraints we know to be true
  facts: Constraint[],

  // Parent context (for lexical scoping)
  parent: RefinementContext | null,
}

function emptyContext(): RefinementContext {
  return { facts: [], parent: null };
}

function extendContext(
  parent: RefinementContext,
  newFacts: Constraint[]
): RefinementContext {
  return { facts: newFacts, parent };
}

// Gather all facts from this context and ancestors
function allFacts(ctx: RefinementContext): Constraint[] {
  const facts = [...ctx.facts];
  if (ctx.parent) {
    facts.push(...allFacts(ctx.parent));
  }
  return facts;
}
```

### 2.3 Integrating Refinements with Evaluation

The evaluator now takes a refinement context:

```typescript
function evaluate(expr: Expr, env: Env, ctx: RefinementContext): SValue {
  switch (expr.tag) {
    case "binary_op":
      const left = evaluate(expr.left, env, ctx);
      const right = evaluate(expr.right, env, ctx);
      return evalBinaryOp(expr.op, left, right, ctx);

    case "if":
      return evalConditionalWithRefinements(expr, env, ctx);

    // ... other cases pass ctx through
  }
}
```

### 2.4 Conditionals with Refinements

When we branch on a condition, we learn facts in each branch:

```typescript
function evalConditionalWithRefinements(
  expr: IfExpr,
  env: Env,
  ctx: RefinementContext
): SValue {
  const condition = evaluate(expr.condition, env, ctx);

  // Try to determine condition from existing facts
  if (condition.stage === "later") {
    const condConstraint = extractConstraint(condition);
    const proven = proveFromFacts(ctx, condConstraint);

    if (proven === true) {
      // Facts prove condition is true!
      return evaluate(expr.thenBranch, env, ctx);
    } else if (proven === false) {
      // Facts prove condition is false!
      return evaluate(expr.elseBranch, env, ctx);
    }
  }

  if (condition.stage === "now") {
    // Condition known - evaluate one branch
    if (condition.value) {
      return evaluate(expr.thenBranch, env, ctx);
    } else {
      return evaluate(expr.elseBranch, env, ctx);
    }
  }

  // Condition unknown - evaluate both branches with refined contexts
  const condConstraint = extractConstraint(condition);

  // In then-branch, we know condition is true
  const thenCtx = extendContext(ctx, [condConstraint]);
  const thenVal = evaluate(expr.thenBranch, env, thenCtx);

  // In else-branch, we know condition is false
  const elseCtx = extendContext(ctx, [{ tag: "not", inner: condConstraint }]);
  const elseVal = evaluate(expr.elseBranch, env, elseCtx);

  return {
    stage: "later",
    type: unifyTypes(thenVal.type, elseVal.type),
    expr: jsConditional(condition.expr, toExpr(thenVal), toExpr(elseVal)),
    constraints: [] // Result constraints would need to be conditional
  };
}
```

### 2.5 Extracting Constraints from Conditions

```typescript
function extractConstraint(condition: SValue): Constraint | null {
  // If the condition came from a comparison, extract it
  if (condition.sourceOp) {
    switch (condition.sourceOp.op) {
      case "==":
        return {
          tag: "eq",
          left: toConstraintTerm(condition.sourceOp.left),
          right: toConstraintTerm(condition.sourceOp.right)
        };
      case "<":
        return {
          tag: "lt",
          left: toConstraintTerm(condition.sourceOp.left),
          right: toConstraintTerm(condition.sourceOp.right)
        };
      // ... etc
    }
  }
  return null;
}

function toConstraintTerm(v: SValue): ConstraintTerm {
  if (v.stage === "now") {
    return { tag: "literal", value: v.value };
  } else if (v.sourceSymbol) {
    return { tag: "symbol", name: v.sourceSymbol };
  } else if (v.sourceField) {
    return {
      tag: "field",
      object: toConstraintTerm(v.sourceField.object),
      field: v.sourceField.field
    };
  }
  // Can't represent as constraint term
  return null;
}
```

### 2.6 Proving from Facts

A simple constraint solver (can be replaced with Z3 for more power):

```typescript
function proveFromFacts(
  ctx: RefinementContext,
  goal: Constraint
): boolean | undefined {
  const facts = allFacts(ctx);

  // Direct match
  if (facts.some(f => constraintEquals(f, goal))) {
    return true;
  }

  // Negation match
  if (facts.some(f => constraintEquals(f, { tag: "not", inner: goal }))) {
    return false;
  }

  // Transitivity for inequalities
  if (goal.tag === "lt") {
    // If we know a < b and b < c, then a < c
    // ... implementation
  }

  // Equality substitution
  if (goal.tag === "eq") {
    // If we know a == b and goal is a == c, check if b == c
    // ... implementation
  }

  // Can't prove or disprove
  return undefined;
}
```

### 2.7 Using Refinements for Optimization

Refinements can simplify generated code:

```typescript
function evalBinaryOp(
  op: string,
  left: SValue,
  right: SValue,
  ctx: RefinementContext
): SValue {
  // ... standard stage handling ...

  // Check if refinements tell us the result
  if (op === "==" || op === "<" || op === ">") {
    const constraint = makeConstraint(op, left, right);
    const proven = proveFromFacts(ctx, constraint);

    if (proven !== undefined) {
      // Refinements prove the result!
      return {
        stage: "now",
        type: boolType,
        value: proven
      };
    }
  }

  // ... generate code as normal
}
```

### 2.8 Example: Redundant Check Elimination

```typescript
// Source
function clamp(x: number, min: number, max: number) {
  if (x < min) {
    return min;
  } else if (x > max) {
    return max;
  } else {
    return x;
  }
}

// Specialize with min = 0, max = 100
specialize(clamp, { min: 0, max: 100 }, [{ name: "x", type: numberType }])

// In the second else-if, we know:
// - NOT (x < 0)  ->  x >= 0
// - We're checking x > 100
//
// In the final else, we know:
// - x >= 0
// - NOT (x > 100)  ->  x <= 100
// So x is in [0, 100]

// Generated (with refinement optimization):
function(x) {
  if (x < 0) {
    return 0;
  } else if (x > 100) {
    return 100;
  } else {
    return x;  // We know 0 <= x <= 100 here
  }
}
```

### 2.9 Bidirectional Refinement

When we know a result, we can sometimes infer facts about inputs:

```typescript
function evalBinaryOpWithBidirectional(
  op: string,
  left: SValue,
  right: SValue,
  ctx: RefinementContext,
  expectedResult?: boolean  // If we know what result should be
): SValue {

  if (expectedResult !== undefined && op === "==") {
    if (expectedResult === true) {
      // We know left == right, so unify their constraints
      // If left is known, right must equal it (and vice versa)
      if (left.stage === "now" && right.stage === "later") {
        // We can refine right's constraints to include == left.value
        return {
          ...right,
          constraints: [
            ...right.constraints,
            { tag: "eq", left: toConstraintTerm(right), right: { tag: "literal", value: left.value } }
          ]
        };
      }
    }
  }

  // ... standard handling
}
```

---

## Part 3: Type Representation and Reflection

### 3.1 Type Values

Types are first-class values, always known at specialization time:

```typescript
type TypeValue =
  | { tag: "primitive", name: "number" | "string" | "boolean" | "null" | "undefined" }
  | { tag: "object", fields: ObjectField[] }
  | { tag: "array", element: TypeValue }
  | { tag: "tuple", elements: TypeValue[] }
  | { tag: "function", params: TypeValue[], result: TypeValue }
  | { tag: "union", variants: TypeValue[] }
  | { tag: "intersection", parts: TypeValue[] }
  | { tag: "literal", value: string | number | boolean }  // Literal types
  | { tag: "unknown" }
  | { tag: "never" }

type ObjectField = {
  name: string,
  type: TypeValue,
  optional: boolean,
  readonly: boolean,
}
```

### 3.2 The "type" Type

To manipulate types as values, we need a meta-type:

```typescript
// A value that IS a type
type TypeAsValue = SValue & {
  stage: "now",
  type: { tag: "metatype" },  // The type of types
  value: TypeValue            // The actual type
}

function makeTypeValue(t: TypeValue): TypeAsValue {
  return {
    stage: "now",
    type: { tag: "metatype" },
    value: t
  };
}
```

### 3.3 Reflection Primitives

```typescript
const reflectionOps = {

  // Get the type of any value (always succeeds, always "now")
  typeOf(target: SValue): TypeAsValue {
    return makeTypeValue(target.type);
  },

  // Get field names from an object type
  fields(target: SValue): SValue {
    const type = target.type;
    if (type.tag !== "object") {
      throw new TypeError(`fields() requires object type, got ${type.tag}`);
    }

    return {
      stage: "now",
      type: { tag: "array", element: { tag: "primitive", name: "string" } },
      value: type.fields.map(f => f.name)
    };
  },

  // Get type of a specific field
  fieldType(target: SValue, fieldName: SValue): TypeAsValue {
    if (fieldName.stage !== "now") {
      throw new Error("Field name must be known at specialization time");
    }

    const type = target.type;
    if (type.tag !== "object") {
      throw new TypeError(`fieldType() requires object type`);
    }

    const field = type.fields.find(f => f.name === fieldName.value);
    if (!field) {
      throw new TypeError(`No field '${fieldName.value}' in type`);
    }

    return makeTypeValue(field.type);
  },

  // Check if type has a field
  hasField(target: SValue, fieldName: SValue): SValue {
    if (fieldName.stage !== "now") {
      throw new Error("Field name must be known at specialization time");
    }

    const type = target.type;
    if (type.tag !== "object") {
      return { stage: "now", type: boolType, value: false };
    }

    const has = type.fields.some(f => f.name === fieldName.value);
    return { stage: "now", type: boolType, value: has };
  },

  // Check if a type is a subtype of another
  isSubtype(subtype: TypeAsValue, supertype: TypeAsValue): SValue {
    const result = checkSubtype(subtype.value, supertype.value);
    return { stage: "now", type: boolType, value: result };
  },

  // Get variants of a union type
  unionVariants(target: TypeAsValue): SValue {
    if (target.value.tag !== "union") {
      throw new TypeError("unionVariants() requires union type");
    }

    return {
      stage: "now",
      type: { tag: "array", element: { tag: "metatype" } },
      value: target.value.variants
    };
  },

  // Construct a new object type
  makeObjectType(fields: SValue): TypeAsValue {
    if (fields.stage !== "now") {
      throw new Error("Type construction requires known values");
    }

    const objectFields: ObjectField[] = fields.value.map(f => ({
      name: f.name,
      type: f.type,
      optional: f.optional ?? false,
      readonly: f.readonly ?? false
    }));

    return makeTypeValue({ tag: "object", fields: objectFields });
  }
};
```

### 3.4 Type-Level Operations

Operations that compute new types from existing types:

```typescript
const typeOperations = {

  // Pick specific fields from an object type
  pick(objectType: TypeValue, fieldNames: string[]): TypeValue {
    if (objectType.tag !== "object") {
      throw new TypeError("pick() requires object type");
    }

    return {
      tag: "object",
      fields: objectType.fields.filter(f => fieldNames.includes(f.name))
    };
  },

  // Omit specific fields
  omit(objectType: TypeValue, fieldNames: string[]): TypeValue {
    if (objectType.tag !== "object") {
      throw new TypeError("omit() requires object type");
    }

    return {
      tag: "object",
      fields: objectType.fields.filter(f => !fieldNames.includes(f.name))
    };
  },

  // Make all fields optional
  partial(objectType: TypeValue): TypeValue {
    if (objectType.tag !== "object") {
      throw new TypeError("partial() requires object type");
    }

    return {
      tag: "object",
      fields: objectType.fields.map(f => ({ ...f, optional: true }))
    };
  },

  // Make all fields required
  required(objectType: TypeValue): TypeValue {
    if (objectType.tag !== "object") {
      throw new TypeError("required() requires object type");
    }

    return {
      tag: "object",
      fields: objectType.fields.map(f => ({ ...f, optional: false }))
    };
  },

  // Merge two object types
  merge(type1: TypeValue, type2: TypeValue): TypeValue {
    if (type1.tag !== "object" || type2.tag !== "object") {
      throw new TypeError("merge() requires object types");
    }

    const fields = [...type1.fields];
    for (const f2 of type2.fields) {
      const existing = fields.findIndex(f => f.name === f2.name);
      if (existing >= 0) {
        fields[existing] = f2;  // Override
      } else {
        fields.push(f2);
      }
    }

    return { tag: "object", fields };
  },

  // Get the return type of a function type
  returnType(funcType: TypeValue): TypeValue {
    if (funcType.tag !== "function") {
      throw new TypeError("returnType() requires function type");
    }
    return funcType.result;
  },

  // Get parameter types
  paramTypes(funcType: TypeValue): TypeValue[] {
    if (funcType.tag !== "function") {
      throw new TypeError("paramTypes() requires function type");
    }
    return funcType.params;
  }
};
```

### 3.5 Integrating Reflection into the Evaluator

```typescript
function evaluate(expr: Expr, env: Env, ctx: RefinementContext): SValue {
  switch (expr.tag) {
    // ... other cases ...

    case "reflect":
      const target = evaluate(expr.target, env, ctx);
      const op = expr.operation;

      switch (op) {
        case "typeOf":
          return reflectionOps.typeOf(target);

        case "fields":
          return reflectionOps.fields(target);

        case "fieldType":
          const fieldName = evaluate(expr.fieldName, env, ctx);
          return reflectionOps.fieldType(target, fieldName);

        case "hasField":
          const field = evaluate(expr.field, env, ctx);
          return reflectionOps.hasField(target, field);
      }
      break;

    case "type_op":
      const typeArg = evaluate(expr.typeArg, env, ctx);
      if (typeArg.type.tag !== "metatype") {
        throw new TypeError("Type operation requires type argument");
      }

      switch (expr.operation) {
        case "partial":
          return makeTypeValue(typeOperations.partial(typeArg.value));
        case "required":
          return makeTypeValue(typeOperations.required(typeArg.value));
        // ... etc
      }
      break;
  }
}
```

---

## Part 4: Reflection and Refinements Together

### 4.1 Type Narrowing from Control Flow

Reflection and refinements interact when type checks affect control flow:

```typescript
// Source
function process(value: unknown) {
  if (typeOf(value) == NumberType) {
    return value * 2;  // Here we know value is a number
  } else {
    return 0;
  }
}
```

The evaluator handles this:

```typescript
function evalConditionalWithTypeRefinement(
  expr: IfExpr,
  env: Env,
  ctx: RefinementContext
): SValue {
  const condition = evaluate(expr.condition, env, ctx);

  // Check if condition is a type check
  const typeCheck = extractTypeCheck(condition);

  if (typeCheck && condition.stage === "now") {
    // Static type check - only evaluate matching branch
    if (condition.value) {
      // Narrow the type in the then-branch environment
      const narrowedEnv = narrowType(env, typeCheck.symbol, typeCheck.type);
      return evaluate(expr.thenBranch, narrowedEnv, ctx);
    } else {
      // Narrow to exclude the type in else-branch
      const narrowedEnv = excludeType(env, typeCheck.symbol, typeCheck.type);
      return evaluate(expr.elseBranch, narrowedEnv, ctx);
    }
  }

  // ... rest of conditional handling
}

function narrowType(env: Env, symbol: string, toType: TypeValue): Env {
  const current = env.get(symbol);
  return env.set(symbol, {
    ...current,
    type: intersectTypes(current.type, toType)
  });
}

function excludeType(env: Env, symbol: string, excludedType: TypeValue): Env {
  const current = env.get(symbol);
  return env.set(symbol, {
    ...current,
    type: subtractType(current.type, excludedType)
  });
}
```

### 4.2 hasField as Type Guard

```typescript
// Source
function getValue(obj: unknown) {
  if (hasField(obj, "value")) {
    return obj.value;  // Type narrowed: obj has .value
  }
  return null;
}

// Specialize with obj: { name: string, value: number }
// hasField returns true (known at specialization time)
// Generated:
function(obj) {
  return obj.value;
}

// Specialize with obj: { name: string }
// hasField returns false
// Generated:
function(obj) {
  return null;
}
```

Implementation:

```typescript
function extractTypeCheck(condition: SValue): TypeCheck | null {
  if (condition.sourceOp?.op === "hasField") {
    return {
      kind: "hasField",
      symbol: condition.sourceOp.object.sourceSymbol,
      field: condition.sourceOp.field.value
    };
  }
  if (condition.sourceOp?.op === "typeEquals") {
    return {
      kind: "typeEquals",
      symbol: condition.sourceOp.target.sourceSymbol,
      type: condition.sourceOp.expectedType.value
    };
  }
  return null;
}
```

### 4.3 Refinement-Aware Field Access

When accessing a field, check refinements for type information:

```typescript
function evalFieldAccess(
  obj: SValue,
  fieldName: string,
  ctx: RefinementContext
): SValue {
  // Check if refinements tell us about this field's type
  const refinedType = lookupRefinedFieldType(ctx, obj, fieldName);

  if (obj.type.tag === "object") {
    const field = obj.type.fields.find(f => f.name === fieldName);

    if (!field) {
      throw new TypeError(`No field '${fieldName}' on type`);
    }

    // Use refined type if available, otherwise field's declared type
    const resultType = refinedType ?? field.type;

    if (obj.stage === "now") {
      return {
        stage: "now",
        type: resultType,
        value: obj.value[fieldName]
      };
    } else {
      return {
        stage: "later",
        type: resultType,
        expr: jsFieldAccess(obj.expr, fieldName),
        constraints: [],
        sourceField: { object: obj, field: fieldName }
      };
    }
  }

  throw new TypeError(`Cannot access field '${fieldName}' on ${obj.type.tag}`);
}

function lookupRefinedFieldType(
  ctx: RefinementContext,
  obj: SValue,
  fieldName: string
): TypeValue | null {
  const facts = allFacts(ctx);

  for (const fact of facts) {
    // Look for facts like "obj.field instanceof SomeType"
    if (fact.tag === "instanceof" &&
        fact.value.tag === "field" &&
        fact.value.field === fieldName &&
        termMatchesValue(fact.value.object, obj)) {
      return fact.type;
    }
  }

  return null;
}
```

### 4.4 Reflection in Loops (Unrolling)

When iterating over reflection results, loops can be unrolled:

```typescript
// Source
function sumFields(obj: { x: number, y: number, z: number }) {
  let sum = 0;
  for (const field of fields(obj)) {
    sum += obj[field];
  }
  return sum;
}

// Since fields(obj) is known at specialization time: ["x", "y", "z"]
// The loop is unrolled:
function(obj) {
  let sum = 0;
  sum += obj.x;
  sum += obj.y;
  sum += obj.z;
  return sum;
}
```

Implementation:

```typescript
function evalForOf(expr: ForOfExpr, env: Env, ctx: RefinementContext): SValue {
  const collection = evaluate(expr.collection, env, ctx);

  // If collection is known, unroll the loop
  if (collection.stage === "now" && Array.isArray(collection.value)) {
    let result: SValue = { stage: "now", type: voidType, value: undefined };
    const statements: JsStatement[] = [];

    for (const item of collection.value) {
      const itemValue: SValue = {
        stage: "now",
        type: getElementType(collection.type),
        value: item
      };

      const bodyEnv = env.set(expr.binding, itemValue);
      result = evaluate(expr.body, bodyEnv, ctx);

      // Collect any generated statements
      if (result.stage === "later" && result.statements) {
        statements.push(...result.statements);
      }
    }

    // If body generated code, wrap in block
    if (statements.length > 0) {
      return {
        stage: "later",
        type: result.type,
        expr: jsBlock(statements),
        constraints: []
      };
    }

    return result;
  }

  // Collection not known - generate runtime loop
  // ...
}
```

### 4.5 Type-Driven Code Generation

Reflection enables generating different code based on types:

```typescript
// Source
function serialize(value: unknown): string {
  const t = typeOf(value);

  if (t.tag === "primitive" && t.name === "string") {
    return '"' + value + '"';
  } else if (t.tag === "primitive" && t.name === "number") {
    return String(value);
  } else if (t.tag === "object") {
    let result = "{";
    for (const field of fields(value)) {
      result += '"' + field + '":' + serialize(value[field]) + ",";
    }
    return result + "}";
  }
  return "null";
}

// Specialize for type { name: string, age: number }
function serialize(value) {
  let result = "{";
  result += '"name":' + '"' + value.name + '"' + ",";
  result += '"age":' + String(value.age) + ",";
  return result + "}";
}
```

---

## Part 5: Complex Type Operations

### 5.1 Conditional Types

Types that depend on conditions:

```typescript
// Type-level conditional
type Conditional = {
  tag: "conditional",
  condition: TypePredicate,
  thenType: TypeValue,
  elseType: TypeValue
}

type TypePredicate =
  | { tag: "extends", subject: TypeValue, constraint: TypeValue }
  | { tag: "hasField", objectType: TypeValue, fieldName: string }
  | { tag: "equals", left: TypeValue, right: TypeValue }

function evaluateConditionalType(cond: Conditional): TypeValue {
  const result = evaluateTypePredicate(cond.condition);

  if (result === true) {
    return cond.thenType;
  } else if (result === false) {
    return cond.elseType;
  } else {
    // Can't determine - return union of possibilities
    return { tag: "union", variants: [cond.thenType, cond.elseType] };
  }
}

function evaluateTypePredicate(pred: TypePredicate): boolean | undefined {
  switch (pred.tag) {
    case "extends":
      return checkSubtype(pred.subject, pred.constraint);

    case "hasField":
      if (pred.objectType.tag !== "object") return false;
      return pred.objectType.fields.some(f => f.name === pred.fieldName);

    case "equals":
      return typeEquals(pred.left, pred.right);
  }
}
```

### 5.2 Mapped Types

Transform each field of an object type:

```typescript
type MappedType = {
  tag: "mapped",
  source: TypeValue,
  keyVar: string,
  valueTransform: TypeValue,  // Can reference keyVar
}

function evaluateMappedType(mapped: MappedType): TypeValue {
  if (mapped.source.tag !== "object") {
    throw new TypeError("Mapped type requires object source");
  }

  const newFields = mapped.source.fields.map(field => {
    // Substitute key variable in the transform
    const transformedType = substituteTypeVar(
      mapped.valueTransform,
      mapped.keyVar,
      { tag: "literal", value: field.name }
    );

    return {
      ...field,
      type: evaluateType(transformedType)
    };
  });

  return { tag: "object", fields: newFields };
}

// Example: Make all fields return promises
// { [K in keyof T]: Promise<T[K]> }
const asyncify: MappedType = {
  tag: "mapped",
  source: originalType,
  keyVar: "K",
  valueTransform: {
    tag: "generic",
    name: "Promise",
    args: [{ tag: "index", object: originalType, key: { tag: "var", name: "K" } }]
  }
};
```

### 5.3 Indexed Access Types

Access a type by key:

```typescript
type IndexedAccess = {
  tag: "index",
  object: TypeValue,
  key: TypeValue  // Must be a literal or union of literals
}

function evaluateIndexedAccess(indexed: IndexedAccess): TypeValue {
  const objType = evaluateType(indexed.object);
  const keyType = evaluateType(indexed.key);

  if (objType.tag === "object") {
    if (keyType.tag === "literal" && typeof keyType.value === "string") {
      const field = objType.fields.find(f => f.name === keyType.value);
      if (field) return field.type;
      throw new TypeError(`No field '${keyType.value}'`);
    }

    if (keyType.tag === "union") {
      // T["a" | "b"] = T["a"] | T["b"]
      const variants = keyType.variants.map(v =>
        evaluateIndexedAccess({ tag: "index", object: objType, key: v })
      );
      return { tag: "union", variants };
    }
  }

  if (objType.tag === "array" || objType.tag === "tuple") {
    if (keyType.tag === "literal" && typeof keyType.value === "number") {
      if (objType.tag === "tuple") {
        return objType.elements[keyType.value];
      }
      return objType.element;
    }
  }

  throw new TypeError(`Cannot index ${objType.tag} with ${keyType.tag}`);
}
```

### 5.4 Template Literal Types

String types with interpolation:

```typescript
type TemplateLiteral = {
  tag: "template",
  parts: Array<string | TypeValue>
}

function evaluateTemplateLiteral(template: TemplateLiteral): TypeValue {
  // If all parts are concrete, produce literal type
  const allConcrete = template.parts.every(p =>
    typeof p === "string" || (p.tag === "literal")
  );

  if (allConcrete) {
    const value = template.parts
      .map(p => typeof p === "string" ? p : p.value)
      .join("");
    return { tag: "literal", value };
  }

  // If any part is a union, distribute
  const unionPart = template.parts.find(p =>
    typeof p !== "string" && p.tag === "union"
  );

  if (unionPart && typeof unionPart !== "string") {
    const variants = unionPart.variants.map(variant => {
      const newParts = template.parts.map(p =>
        p === unionPart ? variant : p
      );
      return evaluateTemplateLiteral({ tag: "template", parts: newParts });
    });
    return { tag: "union", variants };
  }

  // Otherwise, just string type
  return { tag: "primitive", name: "string" };
}

// Example: `on${Capitalize<EventName>}`
// If EventName = "click" | "hover"
// Result = "onClick" | "onHover"
```

### 5.5 Recursive Types

Types that reference themselves:

```typescript
type RecursiveType = {
  tag: "recursive",
  name: string,
  definition: TypeValue  // Can contain references to name
}

type TypeReference = {
  tag: "ref",
  name: string
}

// Example: JSON type
const jsonType: RecursiveType = {
  tag: "recursive",
  name: "JSON",
  definition: {
    tag: "union",
    variants: [
      { tag: "primitive", name: "string" },
      { tag: "primitive", name: "number" },
      { tag: "primitive", name: "boolean" },
      { tag: "literal", value: null },
      { tag: "array", element: { tag: "ref", name: "JSON" } },
      {
        tag: "object",
        fields: [{
          name: "__index__",  // Special: any string key
          type: { tag: "ref", name: "JSON" },
          optional: true,
          readonly: false
        }]
      }
    ]
  }
};
```

### 5.6 Type Inference from Values

Infer precise types from known values:

```typescript
function inferPreciseType(value: any): TypeValue {
  if (value === null) {
    return { tag: "literal", value: null };
  }

  if (typeof value === "string") {
    return { tag: "literal", value };
  }

  if (typeof value === "number") {
    return { tag: "literal", value };
  }

  if (typeof value === "boolean") {
    return { tag: "literal", value };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { tag: "array", element: { tag: "never" } };
    }
    // Infer tuple type for small arrays with different element types
    const elementTypes = value.map(inferPreciseType);
    const allSame = elementTypes.every(t => typeEquals(t, elementTypes[0]));

    if (allSame) {
      return { tag: "array", element: widenLiteralType(elementTypes[0]) };
    } else {
      return { tag: "tuple", elements: elementTypes };
    }
  }

  if (typeof value === "object") {
    const fields: ObjectField[] = [];
    for (const [key, val] of Object.entries(value)) {
      fields.push({
        name: key,
        type: inferPreciseType(val),
        optional: false,
        readonly: false
      });
    }
    return { tag: "object", fields };
  }

  return { tag: "unknown" };
}

// Widen literal types for array elements (usually desired)
function widenLiteralType(t: TypeValue): TypeValue {
  if (t.tag === "literal") {
    return { tag: "primitive", name: typeof t.value as any };
  }
  return t;
}
```

---

## Part 6: Complete Example

### 6.1 Source Program

```typescript
// A function that processes different message types
function handleMessage(msg: unknown) {
  if (hasField(msg, "type")) {
    const msgType = msg.type;

    if (msgType === "greeting") {
      return "Hello, " + msg.name;
    } else if (msgType === "farewell") {
      return "Goodbye, " + msg.name;
    } else {
      return "Unknown message type: " + msgType;
    }
  } else {
    return "Invalid message";
  }
}
```

### 6.2 Specialization for Greeting Type

```typescript
specialize(handleMessage, {}, [{
  name: "msg",
  type: {
    tag: "object",
    fields: [
      { name: "type", type: { tag: "literal", value: "greeting" }, optional: false, readonly: false },
      { name: "name", type: { tag: "primitive", name: "string" }, optional: false, readonly: false }
    ]
  }
}])
```

### 6.3 Evaluation Trace

```
1. hasField(msg, "type")
   - msg.type is { tag: "object", fields: [...] }
   - Type HAS field "type"
   - Result: { stage: "now", value: true }

2. Enter then-branch
   - Refinement context now includes: hasField(msg, "type")

3. msg.type
   - Field access on "later" value
   - Result: { stage: "later", type: literal("greeting"), expr: msg.type }

4. msgType === "greeting"
   - Left: { stage: "later", type: literal("greeting"), expr: msg.type }
   - Right: { stage: "now", value: "greeting" }
   - Since left's type is literal("greeting"), we KNOW this is true!
   - Result: { stage: "now", value: true }

5. Enter msgType === "greeting" then-branch

6. "Hello, " + msg.name
   - Left: { stage: "now", value: "Hello, " }
   - Right: { stage: "later", type: string, expr: msg.name }
   - Result: { stage: "later", expr: "Hello, " + msg.name }

7. Return
```

### 6.4 Generated Code

```javascript
function handleMessage(msg) {
  return "Hello, " + msg.name;
}
```

All the conditionals were eliminated because:
1. `hasField` - resolved statically from type
2. `msgType === "greeting"` - resolved statically because type is literal

### 6.5 Specialization for Generic Message

```typescript
specialize(handleMessage, {}, [{
  name: "msg",
  type: {
    tag: "object",
    fields: [
      { name: "type", type: { tag: "primitive", name: "string" }, optional: false, readonly: false },
      { name: "name", type: { tag: "primitive", name: "string" }, optional: false, readonly: false }
    ]
  }
}])
```

### 6.6 Generated Code (Generic)

```javascript
function handleMessage(msg) {
  const msgType = msg.type;
  if (msgType === "greeting") {
    return "Hello, " + msg.name;
  } else if (msgType === "farewell") {
    return "Goodbye, " + msg.name;
  } else {
    return "Unknown message type: " + msgType;
  }
}
```

Here `msg.type` is just `string`, not a literal, so comparisons generate code.

---

## Part 7: Implementation Considerations

### 7.1 Data Structures Summary

```typescript
// Core value representation
type SValue = {
  stage: "now" | "later",
  type: TypeValue,
  value?: any,                    // If stage === "now"
  expr?: JsExpr,                  // If stage === "later"
  constraints?: Constraint[],
  sourceSymbol?: string,          // Track origin for refinements
  sourceField?: { object: SValue, field: string },
  sourceOp?: { op: string, left: SValue, right: SValue }
}

// Evaluation environment
type Env = Map<string, SValue>

// Refinement tracking
type RefinementContext = {
  facts: Constraint[],
  parent: RefinementContext | null
}

// Generated code
type JsExpr =
  | { tag: "literal", value: any }
  | { tag: "param", name: string }
  | { tag: "binary", op: string, left: JsExpr, right: JsExpr }
  | { tag: "field", object: JsExpr, field: string }
  | { tag: "call", func: JsExpr, args: JsExpr[] }
  | { tag: "conditional", cond: JsExpr, then: JsExpr, else: JsExpr }
  | { tag: "block", statements: JsStatement[], result: JsExpr }
```

### 7.2 Key Invariants

1. **Types are always known**: `SValue.type` is never undefined or "later"
2. **Reflection is always static**: Reflection ops always return `stage: "now"`
3. **Refinements don't change types**: They record facts, not mutate type structures
4. **Stage propagates upward**: If any input is "later", output is usually "later"
5. **No re-evaluation**: Unlike the original design, we don't re-trigger on refinement

### 7.3 Extension Points

The architecture is extensible at several points:

1. **New primitive types**: Add to `TypeValue` union, update reflection ops
2. **New type operations**: Add to `typeOperations` object
3. **Custom constraint domains**: Extend `Constraint` type, update solver
4. **Alternative backends**: Replace `JsExpr` with other target languages
5. **Pluggable solvers**: Replace `proveFromFacts` with Z3 or other solvers

### 7.4 Potential Optimizations

1. **Common subexpression elimination**: Track generated expressions
2. **Dead code elimination**: Remove unreachable branches
3. **Constant folding**: Already happens via staging
4. **Loop unrolling**: Already happens for known-length iterations
5. **Inlining**: Substitute known function bodies

---

## Summary

This architecture provides:

1. **Clear staging semantics**: "now" vs "later" is explicit and predictable
2. **Powerful specialization**: Known values inline, unknown values become parameters
3. **Type-safe reflection**: Types are always available for introspection
4. **Refinement tracking**: Control flow narrows what we know about values
5. **Composable type operations**: Build complex types from simple operations
6. **Predictable termination**: No re-evaluation cycles

The key insight is separating **what we know** (types, refinements) from **what we compute** (values, code generation), rather than interleaving them as in the original design.
