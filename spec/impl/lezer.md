# Lezer Grammar and Parsing

DepJS uses [Lezer](https://lezer.codemirror.net/) for lexing and parsing. Lezer is an incremental parser generator that produces a concrete syntax tree (CST).

## Why Lezer?

- **Incremental parsing** - Useful for future IDE integration
- **Error recovery** - Continues parsing after syntax errors
- **Fast** - Designed for real-time editor use
- **Well-maintained** - Powers CodeMirror 6
- **External tokenizers** - Can handle context-sensitive lexing (space-sensitive `<`/`>`)

## Input/Output

- **Input:** Source string
- **Output:** Lezer `Tree` (our SurfaceAST)

The Lezer tree serves as the SurfaceAST. We traverse it with cursors during desugaring to produce CoreAST directly.

## Architecture

```
Source Code
     │
     ▼
┌─────────────────────────────────────┐
│           Lezer Parser              │
│  ┌─────────────┐  ┌──────────────┐  │
│  │   Grammar   │  │   External   │  │
│  │   (.grammar)│  │   Tokenizer  │  │
│  └─────────────┘  └──────────────┘  │
└─────────────────────────────────────┘
     │
     ▼
  Lezer Tree (SurfaceAST)
     │
     ▼
  Desugar (traverse tree, produce CoreAST)
```

## Grammar File Structure

The grammar is defined in `src/parser/depjs.grammar`:

```lezer
@top Program { statement* }

@external tokens spaceTokens from "./tokens" {
  ltType    // < for type arguments (no preceding space)
  ltCompare // < for comparison (preceding space)
}

// ============================================
// Statements
// ============================================

statement {
  ConstDecl |
  TypeDecl |
  NewtypeDecl |
  ImportDecl |
  ExportDecl |
  ExpressionStatement
}

ConstDecl {
  kw<"comptime">? kw<"const"> VariableName TypeAnnotation? "=" expression ";"
}

TypeDecl {
  Annotation* kw<"type"> TypeName TypeParams? "=" typeExpression ";"
}

NewtypeDecl {
  kw<"newtype"> TypeName "=" typeExpression ";"
}

ImportDecl {
  kw<"import"> ImportClause kw<"from"> String ";"
}

ImportClause {
  ImportDefault |
  ImportNamed |
  ImportNamespace |
  ImportDefault "," ImportNamed
}

ImportDefault { VariableName }
ImportNamed { "{" commaSep<ImportSpecifier> "}" }
ImportNamespace { "*" kw<"as"> VariableName }
ImportSpecifier { VariableName (kw<"as"> VariableName)? }

ExportDecl {
  kw<"export"> (ConstDecl | TypeDecl | NewtypeDecl)
}

ExpressionStatement {
  expression ";"
}

// ============================================
// Expressions
// ============================================

expression {
  AssignmentExpression
}

AssignmentExpression {
  ConditionalExpression
}

ConditionalExpression {
  LogicalOrExpression ("?" expression ":" expression)?
}

LogicalOrExpression {
  LogicalAndExpression (("||") LogicalAndExpression)*
}

LogicalAndExpression {
  BitwiseOrExpression (("&&") BitwiseOrExpression)*
}

BitwiseOrExpression {
  BitwiseXorExpression (("|") BitwiseXorExpression)*
}

BitwiseXorExpression {
  BitwiseAndExpression (("^") BitwiseAndExpression)*
}

BitwiseAndExpression {
  EqualityExpression (("&") EqualityExpression)*
}

EqualityExpression {
  ComparisonExpression (("==" | "!=") ComparisonExpression)*
}

ComparisonExpression {
  AdditiveExpression ((ltCompare | ">" | "<=" | ">=") AdditiveExpression)*
}

AdditiveExpression {
  MultiplicativeExpression (("+" | "-") MultiplicativeExpression)*
}

MultiplicativeExpression {
  UnaryExpression (("*" | "/" | "%") UnaryExpression)*
}

UnaryExpression {
  ("!" | "-" | "~") UnaryExpression |
  AwaitExpression
}

AwaitExpression {
  kw<"await"> UnaryExpression |
  PostfixExpression
}

PostfixExpression {
  PrimaryExpression (
    CallExpression |
    TypeCallExpression |
    PropertyAccess |
    IndexAccess
  )*
}

CallExpression { "(" commaSep<Argument>? ")" }
TypeCallExpression { ltType commaSep1<typeExpression> ">" ("(" commaSep<Argument>? ")")? }
PropertyAccess { "." PropertyName }
IndexAccess { "[" expression "]" }

Argument { Spread? expression }
Spread { "..." }

PrimaryExpression {
  VariableName |
  Literal |
  ParenthesizedExpression |
  ArrayExpression |
  RecordExpression |
  LambdaExpression |
  MatchExpression |
  ThrowExpression
}

ParenthesizedExpression { "(" expression ")" }

ArrayExpression { "[" commaSep<ArrayElement>? "]" }
ArrayElement { Spread? expression }

RecordExpression { "{" commaSep<RecordField>? "}" }
RecordField {
  Spread |
  PropertyName (":" expression)?  // shorthand: { x } means { x: x }
}

LambdaExpression {
  kw<"async">? (
    VariableName |                           // x => x + 1
    "(" commaSep<LambdaParam>? ")"           // (x, y) => x + y
  ) TypeAnnotation? "=>" (expression | Block)
}

LambdaParam {
  Spread? VariableName TypeAnnotation? ("=" expression)?
}

Block { "{" statement* expression? "}" }

MatchExpression {
  kw<"match"> "(" expression ")" "{" MatchCase* "}"
}

MatchCase {
  kw<"case"> Pattern Guard? ":" expression ";"
}

Pattern {
  WildcardPattern |
  LiteralPattern |
  TypePattern |
  DestructurePattern |
  VariablePattern
}

WildcardPattern { "_" }
LiteralPattern { Literal }
TypePattern { TypeName }
DestructurePattern { "{" commaSep<PatternField> "}" }
PatternField { PropertyName (":" Pattern)? }
VariablePattern { VariableName }

Guard { kw<"when"> expression }

ThrowExpression { kw<"throw"> expression }

// ============================================
// Type Expressions (Type Syntax Context)
// ============================================

typeExpression {
  UnionType
}

UnionType {
  IntersectionType ("|" IntersectionType)*
}

IntersectionType {
  PrimaryTypeExpression ("&" PrimaryTypeExpression)*
}

PrimaryTypeExpression {
  TypeName TypeArguments? ArrayTypeSuffix* |
  RecordTypeExpression |
  TupleTypeExpression |
  FunctionTypeExpression |
  ParenthesizedTypeExpression |
  LiteralType
}

TypeArguments { ltType commaSep1<typeExpression> ">" }
ArrayTypeSuffix { "[" "]" }

RecordTypeExpression {
  "{" commaSep<TypeField>? "}" |
  "{|" commaSep<TypeField>? "|}" |  // closed record
  "{" IndexSignature "}"            // indexed record
}

TypeField {
  Annotation* PropertyName "?"? ":" typeExpression
}

IndexSignature {
  "[" VariableName ":" typeExpression "]" ":" typeExpression
}

TupleTypeExpression {
  "[" commaSep<TupleElement>? "]"
}

TupleElement {
  Spread? (VariableName ":")? typeExpression
}

FunctionTypeExpression {
  TypeParams? "(" commaSep<FunctionTypeParam>? ")" "=>" typeExpression
}

FunctionTypeParam {
  Annotation* Spread? VariableName "?"? ":" typeExpression
}

ParenthesizedTypeExpression { "(" typeExpression ")" }

LiteralType {
  String | Number | kw<"true"> | kw<"false">
}

// ============================================
// Type Parameters and Annotations
// ============================================

TypeParams {
  ltType commaSep1<TypeParam> ">"
}

TypeParam {
  Annotation* TypeName (kw<"extends"> typeExpression)?
}

TypeAnnotation { ":" typeExpression }

Annotation { "@" expression }

// ============================================
// Literals
// ============================================

Literal {
  String |
  Number |
  kw<"true"> |
  kw<"false"> |
  kw<"null"> |
  kw<"undefined">
}

// ============================================
// Tokens
// ============================================

@tokens {
  whitespace { @whitespace+ }

  LineComment { "//" ![\n]* }
  BlockComment { "/*" blockCommentContent* "*/" }
  blockCommentContent { ![*] | "*" ![/] }

  String {
    '"' (![\\\n"] | "\\" _)* '"' |
    "'" (![\\\n'] | "\\" _)* "'"
  }

  // Template literals need special handling
  TemplateStart { "`" templateContent* "${" }
  TemplateMiddle { "}" templateContent* "${" }
  TemplateEnd { "}" templateContent* "`" }
  TemplatePlain { "`" templateContent* "`" }
  templateContent { ![`$\\] | "\\" _ | "$" ![{] }

  Number {
    @digit+ ("." @digit+)? ([eE] [+-]? @digit+)? |
    "0x" @hexDigit+ |
    "0b" [01]+ |
    "0o" [0-7]+
  }

  VariableName { @asciiLetter (@asciiLetter | @digit | "_")* }
  TypeName { @asciiUppercase (@asciiLetter | @digit | "_")* }
  PropertyName { @asciiLetter (@asciiLetter | @digit | "_")* }

  "="
  ";"
  ","
  "."
  ":"
  "?"
  "@"
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "{|"
  "|}"
  "=>"
  "..."

  "+"
  "-"
  "*"
  "/"
  "%"

  "=="
  "!="
  "<="
  ">="
  ">"
  // Note: < handled by external tokenizer

  "&&"
  "||"
  "|"
  "&"
  "^"
  "!"
  "~"

  @precedence { BlockComment, LineComment, "/" }
  @precedence { Number, "." }
  @precedence { "{|", "{" }
  @precedence { "|}", "|" }
}

@skip { whitespace | LineComment | BlockComment }

// ============================================
// Keywords
// ============================================

kw<term> { @specialize[@name={term}]<VariableName, term> }

@external propSource highlighting from "./highlight"
```

## External Tokenizer for Space-Sensitive `<`

The key complexity is distinguishing `<` for type arguments vs comparison. We use an external tokenizer.

### `src/parser/tokens.ts`

```typescript
import { ExternalTokenizer, InputStream } from "@lezer/lr";
import { ltType, ltCompare } from "./depjs.grammar.terms";

// Characters
const LT = 60;        // <
const SPACE = 32;     // ' '
const TAB = 9;        // \t
const NEWLINE = 10;   // \n
const CR = 13;        // \r

function isWhitespace(ch: number): boolean {
  return ch === SPACE || ch === TAB || ch === NEWLINE || ch === CR;
}

function isIdentChar(ch: number): boolean {
  return (ch >= 65 && ch <= 90) ||   // A-Z
         (ch >= 97 && ch <= 122) ||  // a-z
         (ch >= 48 && ch <= 57) ||   // 0-9
         ch === 95;                   // _
}

export const spaceTokens = new ExternalTokenizer((input: InputStream) => {
  // Only handle <
  if (input.next !== LT) return;

  // Look backwards to determine context
  // We need to check if there's whitespace before the <

  // Get the character before current position
  // Note: input.pos is the position we're at (the <)
  // We need to look at what came before

  const hadWhitespaceBefore = checkWhitespaceBefore(input);

  if (hadWhitespaceBefore) {
    // Space before < means comparison: `a < b`
    input.advance();
    input.acceptToken(ltCompare);
  } else {
    // No space means type argument: `Array<Int>`
    input.advance();
    input.acceptToken(ltType);
  }
});

// Helper to check if there was whitespace before current position
// This is tricky because Lezer's InputStream doesn't give direct access to previous chars
// We may need to track this differently

// OPEN QUESTION: How to reliably detect preceding whitespace in Lezer?
// Options:
// 1. Use input.peek(-1) if available
// 2. Track in parser state
// 3. Use a different tokenization strategy

function checkWhitespaceBefore(input: InputStream): boolean {
  // Implementation depends on Lezer version and capabilities
  // For now, assume we can peek backwards
  const prevChar = input.peek(-1);
  return isWhitespace(prevChar) || prevChar === -1;  // -1 = start of input
}
```

**OPEN QUESTION:** Lezer's `InputStream` may not support `peek(-1)`. Alternative approaches:
1. **Post-process tokens:** Tokenize all `<` the same, then fix up in a post-pass based on positions
2. **Track state:** Keep track of whether we just saw whitespace
3. **Contextual parsing:** Use GLR-style ambiguity and resolve in tree

Current thinking: Option 1 (post-process) is most reliable.

### Alternative: Post-Process Token Stream

```typescript
import { Tree, TreeCursor } from "@lezer/common";

// After parsing, walk the tree and reclassify < tokens based on context
function fixupLtTokens(tree: Tree, source: string): void {
  const cursor = tree.cursor();

  do {
    if (cursor.name === "Lt") {  // Generic < token
      const pos = cursor.from;
      const charBefore = pos > 0 ? source.charCodeAt(pos - 1) : -1;

      if (isWhitespace(charBefore)) {
        // This is a comparison <
        // Mark it somehow (custom property, or transform tree)
      } else {
        // This is a type argument <
      }
    }
  } while (cursor.next());
}
```

## Node Types

The grammar produces these node types (partial list):

### Top-Level
- `Program` - root node containing statements

### Statements
- `ConstDecl` - `const x: T = expr;`
- `TypeDecl` - `type T = expr;`
- `NewtypeDecl` - `newtype T = Base;`
- `ImportDecl` - `import { x } from "module";`
- `ExportDecl` - `export const x = ...;`
- `ExpressionStatement` - `expr;`

### Expressions
- `VariableName` - identifier
- `Literal` - string, number, boolean, null, undefined
- `BinaryExpression` - `a + b`, `a < b`, etc.
- `ConditionalExpression` - `a ? b : c`
- `CallExpression` - `f(x, y)`
- `TypeCallExpression` - `f<T>(x)` or `f<T, U>`
- `PropertyAccess` - `obj.prop`
- `IndexAccess` - `arr[i]`
- `ArrayExpression` - `[a, b, c]`
- `RecordExpression` - `{ a: 1, b: 2 }`
- `LambdaExpression` - `(x) => x + 1`
- `MatchExpression` - `match (x) { ... }`
- `ThrowExpression` - `throw Error(...)`
- `AwaitExpression` - `await promise`

### Type Expressions
- `TypeName` - type identifier
- `TypeArguments` - `<T, U>`
- `UnionType` - `A | B`
- `IntersectionType` - `A & B`
- `RecordTypeExpression` - `{ a: Int }` or `{| a: Int |}`
- `TupleTypeExpression` - `[Int, String]`
- `FunctionTypeExpression` - `(x: A) => B`
- `ArrayTypeSuffix` - `[]` in `Int[]`
- `LiteralType` - `"foo"`, `42`, `true`

### Patterns
- `WildcardPattern` - `_`
- `LiteralPattern` - `42`, `"foo"`
- `TypePattern` - `Int`, `String`
- `DestructurePattern` - `{ a, b: renamed }`
- `VariablePattern` - `x` (binds the value)

### Other
- `TypeAnnotation` - `: Type`
- `TypeParams` - `<T, U extends Foo>`
- `Annotation` - `@Something`
- `Spread` - `...`
- `Guard` - `when condition`

## Tree Traversal

### Using Cursors

```typescript
import { Tree, TreeCursor } from "@lezer/common";

function processTree(tree: Tree, source: string) {
  const cursor = tree.cursor();

  do {
    const node = cursor.node;
    const text = source.slice(node.from, node.to);

    switch (cursor.name) {
      case "ConstDecl":
        processConstDecl(cursor, source);
        break;
      case "LambdaExpression":
        processLambda(cursor, source);
        break;
      // ... etc
    }
  } while (cursor.next());
}

function processConstDecl(cursor: TreeCursor, source: string) {
  // Navigate to children
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "VariableName") {
        const name = source.slice(cursor.from, cursor.to);
        console.log("Const name:", name);
      }
      if (cursor.name === "TypeAnnotation") {
        // Process type
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }
}
```

### Building CoreAST from Cursors

Desugaring traverses the Lezer tree and builds CoreAST nodes directly. Here's an example of converting a `ConstDecl` node:

```typescript
import { CoreDecl } from "./core-ast";

function desugarConstDecl(cursor: TreeCursor, source: string): CoreDecl {
  const loc = toLoc(cursor, source);
  let name = "";
  let typeAnnotation: CoreExpr | undefined;
  let init: CoreExpr | undefined;
  let comptime = false;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "comptime":
          comptime = true;
          break;
        case "VariableName":
          name = source.slice(cursor.from, cursor.to);
          break;
        case "TypeAnnotation":
          // Desugar the type expression (applies type syntax transforms)
          typeAnnotation = desugarTypeAnnotation(cursor, source);
          break;
        default:
          if (isExpression(cursor.name)) {
            init = desugarExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { kind: "const", name, typeAnnotation, init: init!, comptime, loc };
}
```

## Error Recovery

Lezer has built-in error recovery. When it encounters a syntax error:

1. It inserts an `⚠` (error) node
2. It tries to continue parsing
3. Multiple errors can be reported

```typescript
import { Tree } from "@lezer/common";

function collectErrors(tree: Tree, source: string): SyntaxError[] {
  const errors: SyntaxError[] = [];
  const cursor = tree.cursor();

  do {
    if (cursor.type.isError) {
      errors.push({
        message: "Syntax error",
        from: cursor.from,
        to: cursor.to,
        context: source.slice(
          Math.max(0, cursor.from - 20),
          Math.min(source.length, cursor.to + 20)
        )
      });
    }
  } while (cursor.next());

  return errors;
}
```

## Template Literals

Template literals need special handling for interpolation:

```
`Hello ${name}, you have ${count} messages`
```

Tokenizes as:
- `TemplateStart`: `` `Hello ${ ``
- Expression: `name`
- `TemplateMiddle`: `}, you have ${`
- Expression: `count`
- `TemplateEnd`: `} messages` ``

Simple templates without interpolation:
- `TemplatePlain`: `` `Hello world` ``

## Comments

Comments are skipped by default (`@skip`) but preserved in the tree for tooling:

```typescript
function extractComments(tree: Tree, source: string): Comment[] {
  const comments: Comment[] = [];
  // Lezer stores skipped tokens - access via tree iteration
  // Implementation depends on Lezer version
  return comments;
}
```

## Integration with Desugar

The desugar stage receives the Lezer tree and produces CoreAST:

```typescript
import { Tree } from "@lezer/common";
import { CoreDecl, CoreExpr } from "./core-ast";

function desugar(tree: Tree, source: string): CoreDecl[] {
  const decls: CoreDecl[] = [];
  const cursor = tree.cursor();

  // Skip to Program's children
  if (cursor.name === "Program" && cursor.firstChild()) {
    do {
      const decl = desugarStatement(cursor, source);
      if (decl) decls.push(decl);
    } while (cursor.nextSibling());
  }

  return decls;
}

function desugarStatement(cursor: TreeCursor, source: string): CoreDecl | null {
  switch (cursor.name) {
    case "ConstDecl":
      return desugarConstDecl(cursor, source);
    case "TypeDecl":
      return desugarTypeDecl(cursor, source);  // → ConstDecl with WithMetadata
    case "NewtypeDecl":
      return desugarNewtypeDecl(cursor, source);  // → ConstDecl with Branded
    case "ImportDecl":
      return desugarImportDecl(cursor, source);
    case "ExportDecl":
      return desugarExportDecl(cursor, source);
    case "ExpressionStatement":
      // Keep as-is for effect (e.g., assert calls)
      return desugarExprStatement(cursor, source);
    default:
      return null;
  }
}
```

## Open Questions

| Question | Options | Notes |
|----------|---------|-------|
| Space-sensitive `<` detection | External tokenizer / Post-process / GLR | Post-process most reliable |
| Comment preservation | Skip entirely / Preserve for tooling | Preserve - useful for doc generation |
| Error node handling | Fail on any error / Best-effort continue | Best-effort for better DX |

## Testing

```typescript
import { parser } from "./depjs.grammar";

describe("Lezer Parser", () => {
  it("parses const declaration", () => {
    const tree = parser.parse("const x: Int = 42;");
    expect(tree.topNode.name).toBe("Program");
    // ... verify structure
  });

  it("distinguishes type < from comparison <", () => {
    const tree1 = parser.parse("f<Int>(x);");
    // Should have TypeCallExpression

    const tree2 = parser.parse("a < b;");
    // Should have ComparisonExpression
  });

  it("handles template literals", () => {
    const tree = parser.parse("const x = `hello ${name}`;");
    // Should have TemplateStart, expression, TemplateEnd
  });

  it("recovers from errors", () => {
    const tree = parser.parse("const x = ;");  // Missing expression
    const errors = collectErrors(tree);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

## File Organization

```
src/parser/
├── depjs.grammar        # Lezer grammar definition
├── tokens.ts            # External tokenizer for space-sensitive <
├── highlight.ts         # Syntax highlighting props (for editor integration)
├── index.ts             # Parser setup and exports
└── parser.test.ts       # Tests
```

## Build Setup

```json
// package.json
{
  "scripts": {
    "build:parser": "lezer-generator src/parser/depjs.grammar -o src/parser/depjs.grammar.js"
  },
  "devDependencies": {
    "@lezer/generator": "^1.0.0",
    "@lezer/lr": "^1.0.0",
    "@lezer/common": "^1.0.0"
  }
}
```

The grammar compiles to a JavaScript parser that can be imported and used.