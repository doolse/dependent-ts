# Code Generation

Codegen transforms RuntimeAST into JavaScript source code.

## Input/Output

- **Input:** `RuntimeAST` (comptime-only code removed)
- **Output:** JavaScript string (ES module)

See `core-ast.md` for AST type definitions.

## Design Principles

1. **Readable output** - Generated JS should be readable and debuggable
2. **Minimal transformation** - DepJS is close to JS, so most constructs map directly
3. **ES modules** - Output is always ES module format
4. **Source maps** - Support source map generation for debugging

## Mapping Overview

| DepJS | JavaScript |
|-------|------------|
| `const x = ...` | `const x = ...` |
| `(x) => x + 1` | `(x) => x + 1` |
| `async (x) => await f(x)` | `async (x) => await f(x)` |
| `{ a: 1, b: 2 }` | `{ a: 1, b: 2 }` |
| `[1, 2, 3]` | `[1, 2, 3]` |
| `x.prop` | `x.prop` |
| `x[i]` | `x[i]` |
| `f(x, y)` | `f(x, y)` |
| `a + b` | `a + b` |
| `throw Error(...)` | `throw Error(...)` |
| `await promise` | `await promise` |
| `` `hello ${x}` `` | `` `hello ${x}` `` |
| `match (x) { ... }` | `(() => { if/switch chain })()` |
| `import { x } from "m"` | `import { x } from "m"` |
| `export const x = 1` | `export const x = 1` |

## Implementation

### Main Entry Point

```typescript
export function codegen(decls: RuntimeDecl[]): string {
  const output: string[] = [];

  for (const decl of decls) {
    output.push(genDecl(decl));
  }

  return output.join("\n\n");
}
```

### Declaration Generation

```typescript
function genDecl(decl: RuntimeDecl): string {
  switch (decl.kind) {
    case "const":
      const exportKw = decl.exported ? "export " : "";
      return `${exportKw}const ${decl.name} = ${genExpr(decl.init)};`;

    case "import":
      return genImport(decl);

    case "expr":
      return `${genExpr(decl.expr)};`;
  }
}
```

### Import Generation

```typescript
function genImport(decl: ImportDecl): string {
  const clause = genImportClause(decl.clause);
  return `import ${clause} from ${JSON.stringify(decl.source)};`;
}

function genImportClause(clause: RuntimeImportClause): string {
  switch (clause.kind) {
    case "default":
      return clause.name;

    case "named":
      const specs = clause.specifiers.map(s =>
        s.alias ? `${s.name} as ${s.alias}` : s.name
      );
      return `{ ${specs.join(", ")} }`;

    case "namespace":
      return `* as ${clause.name}`;

    case "defaultAndNamed":
      const namedSpecs = clause.specifiers.map(s =>
        s.alias ? `${s.name} as ${s.alias}` : s.name
      );
      return `${clause.defaultName}, { ${namedSpecs.join(", ")} }`;
  }
}
```

### Expression Generation

```typescript
function genExpr(expr: RuntimeExpr, precedence: number = 0): string {
  switch (expr.kind) {
    case "identifier":
      return expr.name;

    case "literal":
      return genLiteral(expr);

    case "binary":
      return genBinary(expr, precedence);

    case "unary":
      return genUnary(expr);

    case "call":
      return `${genExpr(expr.fn, PREC_CALL)}(${expr.args.map(a => genExpr(a)).join(", ")})`;

    case "property":
      return `${genExpr(expr.object, PREC_MEMBER)}.${expr.name}`;

    case "index":
      return `${genExpr(expr.object, PREC_MEMBER)}[${genExpr(expr.index)}]`;

    case "lambda":
      return genLambda(expr);

    case "match":
      return genMatch(expr);

    case "conditional":
      return genConditional(expr, precedence);

    case "record":
      return genRecord(expr);

    case "array":
      return genArray(expr);

    case "await":
      return `await ${genExpr(expr.expr, PREC_UNARY)}`;

    case "throw":
      return `throw ${genExpr(expr.expr)}`;

    case "template":
      return genTemplate(expr);

    case "block":
      return genBlock(expr);
  }
}
```

### Literal Generation

```typescript
function genLiteral(expr: LiteralExpr): string {
  switch (expr.literalKind) {
    case "string":
      return JSON.stringify(expr.value);

    case "int":
    case "float":
      return String(expr.value);

    case "boolean":
      return expr.value ? "true" : "false";

    case "null":
      return "null";

    case "undefined":
      return "undefined";
  }
}
```

### Binary Expression Generation

Handle operator precedence to minimize parentheses:

```typescript
// Precedence levels (higher = tighter binding)
const PREC_COMMA = 1;
const PREC_TERNARY = 2;
const PREC_OR = 3;
const PREC_AND = 4;
const PREC_BIT_OR = 5;
const PREC_BIT_XOR = 6;
const PREC_BIT_AND = 7;
const PREC_EQUALITY = 8;
const PREC_COMPARISON = 9;
const PREC_ADDITIVE = 10;
const PREC_MULTIPLICATIVE = 11;
const PREC_UNARY = 12;
const PREC_CALL = 13;
const PREC_MEMBER = 14;

function getOpPrecedence(op: BinaryOp): number {
  switch (op) {
    case "||": return PREC_OR;
    case "&&": return PREC_AND;
    case "|": return PREC_BIT_OR;
    case "^": return PREC_BIT_XOR;
    case "&": return PREC_BIT_AND;
    case "==": case "!=": return PREC_EQUALITY;
    case "<": case ">": case "<=": case ">=": return PREC_COMPARISON;
    case "+": case "-": return PREC_ADDITIVE;
    case "*": case "/": case "%": return PREC_MULTIPLICATIVE;
  }
}

function genBinary(expr: BinaryExpr, parentPrecedence: number): string {
  const prec = getOpPrecedence(expr.op);
  const left = genExpr(expr.left, prec);
  const right = genExpr(expr.right, prec + 1);  // +1 for left-associativity
  const result = `${left} ${expr.op} ${right}`;

  // Parenthesize if parent has higher precedence
  return prec < parentPrecedence ? `(${result})` : result;
}
```

### Unary Expression Generation

```typescript
function genUnary(expr: UnaryExpr): string {
  const operand = genExpr(expr.operand, PREC_UNARY);
  return `${expr.op}${operand}`;
}
```

### Lambda Generation

```typescript
function genLambda(expr: LambdaExpr): string {
  const asyncKw = expr.async ? "async " : "";

  const params = expr.params.map(p => {
    if (p.defaultValue) {
      return `${p.name} = ${genExpr(p.defaultValue)}`;
    }
    return p.name;
  });

  const paramsStr = params.length === 1 && !expr.params[0].defaultValue
    ? params[0]
    : `(${params.join(", ")})`;

  const body = genExpr(expr.body);

  // Use concise form if body is a single expression
  if (expr.body.kind !== "block") {
    return `${asyncKw}${paramsStr} => ${body}`;
  }

  return `${asyncKw}${paramsStr} => ${body}`;
}
```

### Block Generation

```typescript
function genBlock(expr: BlockExpr): string {
  const statements = expr.statements.map(s => genDecl(s));

  if (expr.result) {
    statements.push(`return ${genExpr(expr.result)};`);
  }

  return `{\n  ${statements.join("\n  ")}\n}`;
}
```

### Record Generation

```typescript
function genRecord(expr: RecordExpr): string {
  const fields = expr.fields.map(f => {
    if (f.kind === "spread") {
      return `...${genExpr(f.expr)}`;
    }
    // Check for shorthand: { x } instead of { x: x }
    if (f.value.kind === "identifier" && f.value.name === f.name) {
      return f.name;
    }
    return `${f.name}: ${genExpr(f.value)}`;
  });

  if (fields.length === 0) {
    return "{}";
  }

  // Single line for short records
  if (fields.length <= 3 && fields.every(f => f.length < 20)) {
    return `{ ${fields.join(", ")} }`;
  }

  // Multi-line for longer records
  return `{\n  ${fields.join(",\n  ")}\n}`;
}
```

### Array Generation

```typescript
function genArray(expr: ArrayExpr): string {
  const elements = expr.elements.map(e => {
    if (e.kind === "spread") {
      return `...${genExpr(e.expr)}`;
    }
    return genExpr(e.value);
  });

  if (elements.length === 0) {
    return "[]";
  }

  // Single line for short arrays
  const joined = elements.join(", ");
  if (joined.length < 60) {
    return `[${joined}]`;
  }

  // Multi-line for longer arrays
  return `[\n  ${elements.join(",\n  ")}\n]`;
}
```

### Template Literal Generation

```typescript
function genTemplate(expr: TemplateExpr): string {
  let result = "`";

  for (const part of expr.parts) {
    if (part.kind === "string") {
      // Escape backticks and ${
      result += part.value
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$\{/g, "\\${");
    } else {
      result += `\${${genExpr(part.expr)}}`;
    }
  }

  result += "`";
  return result;
}
```

### Conditional Generation

```typescript
function genConditional(expr: ConditionalExpr, parentPrecedence: number): string {
  const cond = genExpr(expr.condition, PREC_TERNARY);
  const then = genExpr(expr.then, PREC_TERNARY);
  const els = genExpr(expr.else, PREC_TERNARY);
  const result = `${cond} ? ${then} : ${els}`;

  return PREC_TERNARY < parentPrecedence ? `(${result})` : result;
}
```

### Match Expression Generation

Match expressions are the most complex to translate. They become immediately-invoked functions with if/switch chains.

```typescript
function genMatch(expr: MatchExpr): string {
  const scrutinee = genExpr(expr.expr);
  const scrutineeVar = "_match";  // Temp variable for the matched value

  const cases = expr.cases.map(c => genCase(c, scrutineeVar));

  // Wrap in IIFE
  return `(() => {
  const ${scrutineeVar} = ${scrutinee};
${cases.join("\n")}
  throw new Error("Non-exhaustive match");
})()`;
}

function genCase(c: RuntimeCase, scrutineeVar: string): string {
  const { condition, bindings } = genPatternCondition(c.pattern, scrutineeVar);

  let body = genExpr(c.body);

  // Add bindings
  const bindingDecls = bindings.map(b => `const ${b.name} = ${b.expr};`);

  // Add guard if present
  let fullCondition = condition;
  if (c.guard) {
    fullCondition = condition
      ? `${condition} && ${genExpr(c.guard)}`
      : genExpr(c.guard);
  }

  const bindingsStr = bindingDecls.length > 0
    ? `\n    ${bindingDecls.join("\n    ")}`
    : "";

  if (fullCondition) {
    return `  if (${fullCondition}) {${bindingsStr}
    return ${body};
  }`;
  } else {
    // Wildcard or binding-only pattern - always matches
    return `  {${bindingsStr}
    return ${body};
  }`;
  }
}

type PatternResult = {
  condition: string | null;  // null means always matches
  bindings: { name: string; expr: string }[];
};

function genPatternCondition(pattern: RuntimePattern, expr: string): PatternResult {
  switch (pattern.kind) {
    case "wildcard":
      return { condition: null, bindings: [] };

    case "literal":
      const litVal = genLiteral({
        kind: "literal",
        value: pattern.value,
        literalKind: pattern.literalKind,
        loc: pattern.loc
      });
      return { condition: `${expr} === ${litVal}`, bindings: [] };

    case "binding":
      if (pattern.pattern) {
        // Binding with nested pattern: `x @ SomePattern`
        const nested = genPatternCondition(pattern.pattern, expr);
        return {
          condition: nested.condition,
          bindings: [{ name: pattern.name, expr }, ...nested.bindings]
        };
      }
      // Simple binding
      return { condition: null, bindings: [{ name: pattern.name, expr }] };

    case "type":
      // Type patterns check a discriminant or use typeof
      return genTypePatternCondition(pattern, expr);

    case "destructure":
      return genDestructureCondition(pattern, expr);
  }
}

function genTypePatternCondition(pattern: TypePattern, expr: string): PatternResult {
  // Type patterns are typically used for discriminated unions
  // The type checker has determined the discriminant field

  // For primitive types, use typeof
  const typeName = getPatternTypeName(pattern);
  switch (typeName) {
    case "String":
      return { condition: `typeof ${expr} === "string"`, bindings: [] };
    case "Int":
    case "Float":
    case "Number":
      return { condition: `typeof ${expr} === "number"`, bindings: [] };
    case "Boolean":
      return { condition: `typeof ${expr} === "boolean"`, bindings: [] };
    case "Null":
      return { condition: `${expr} === null`, bindings: [] };
    case "Undefined":
      return { condition: `${expr} === undefined`, bindings: [] };
  }

  // For record types in discriminated unions, check the discriminant
  // This info should come from type checking
  if (pattern.discriminant) {
    const { field, value } = pattern.discriminant;
    return {
      condition: `${expr}.${field} === ${JSON.stringify(value)}`,
      bindings: []
    };
  }

  // Fallback: no condition (rely on exhaustiveness check)
  return { condition: null, bindings: [] };
}

function genDestructureCondition(pattern: DestructurePattern, expr: string): PatternResult {
  const conditions: string[] = [];
  const bindings: { name: string; expr: string }[] = [];

  for (const field of pattern.fields) {
    const fieldExpr = `${expr}.${field.name}`;
    const bindingName = field.binding ?? field.name;

    if (field.pattern) {
      // Nested pattern
      const nested = genPatternCondition(field.pattern, fieldExpr);
      if (nested.condition) {
        conditions.push(nested.condition);
      }
      bindings.push(...nested.bindings);
    } else {
      // Simple field binding
      bindings.push({ name: bindingName, expr: fieldExpr });
    }
  }

  return {
    condition: conditions.length > 0 ? conditions.join(" && ") : null,
    bindings
  };
}
```

## Output Formatting

### Indentation

Use consistent 2-space indentation:

```typescript
function indent(code: string, level: number): string {
  const spaces = "  ".repeat(level);
  return code.split("\n").map(line => spaces + line).join("\n");
}
```

### Line Length

Try to keep lines under 100 characters. Break long expressions:

```typescript
function maybeBreak(parts: string[], separator: string, maxLen: number = 100): string {
  const singleLine = parts.join(separator);
  if (singleLine.length <= maxLen) {
    return singleLine;
  }
  return parts.join(separator + "\n  ");
}
```

## Source Maps

For debugging support, generate source maps that map output positions to input positions.

```typescript
type SourceMapEntry = {
  generated: { line: number; column: number };
  original: { line: number; column: number };
  source: string;
};

class CodegenWithSourceMap {
  private output: string = "";
  private line: number = 1;
  private column: number = 0;
  private mappings: SourceMapEntry[] = [];
  private sourcePath: string;

  constructor(sourcePath: string) {
    this.sourcePath = sourcePath;
  }

  emit(code: string, loc?: SourceLocation): void {
    if (loc) {
      this.mappings.push({
        generated: { line: this.line, column: this.column },
        original: offsetToLineCol(loc.from),
        source: this.sourcePath
      });
    }

    this.output += code;

    // Update position
    for (const char of code) {
      if (char === "\n") {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }
    }
  }

  getOutput(): string {
    return this.output;
  }

  getSourceMap(): SourceMap {
    // Convert mappings to source map format
    // ...
  }
}
```

## Open Questions

| Question | Options | Notes |
|----------|---------|-------|
| Output style | Compact / Pretty / Configurable | Pretty by default |
| Source maps | Always / Optional / Off | Optional via flag |
| Module interop | ESM only / CommonJS option | ESM only for v1 |
| Minification | Built-in / External tool | External tool |

## Testing Strategy

Test cases should cover:

1. **Literals** - All types (string, int, float, bool, null, undefined)
2. **Operators** - Binary, unary, correct precedence/parenthesization
3. **Functions** - Sync, async, with defaults, arrow syntax
4. **Records** - Empty, shorthand, spread, multi-line
5. **Arrays** - Empty, spread, multi-line
6. **Templates** - Plain, with interpolation, with escapes
7. **Match** - All pattern types, guards, nested patterns
8. **Imports** - All clause types
9. **Exports** - Const exports
10. **Blocks** - Statements with result expression
11. **Source maps** - Verify mappings are correct

Each test should compare generated JS against expected output.