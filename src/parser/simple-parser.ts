/**
 * Simple recursive descent parser for DepJS.
 * Handles the core language features needed for type checking.
 *
 * This is a simpler alternative to the full Lezer grammar while
 * the ambiguity issues are being worked out.
 */

import {
  CoreExpr,
  CoreDecl,
  CoreParam,
  CoreCase,
  CorePattern,
  CoreRecordField,
  CoreArrayElement,
  CoreTemplatePart,
  SourceLocation,
  LiteralKind,
  BinaryOp,
  UnaryOp,
  CompileError,
} from "../ast/core-ast.js";

// Token types
type TokenType =
  | "identifier"
  | "typeName"
  | "number"
  | "string"
  | "true"
  | "false"
  | "null"
  | "undefined"
  | "const"
  | "type"
  | "newtype"
  | "import"
  | "from"
  | "export"
  | "as"
  | "comptime"
  | "async"
  | "await"
  | "match"
  | "case"
  | "when"
  | "throw"
  | "extends"
  | "("
  | ")"
  | "["
  | "]"
  | "{"
  | "}"
  | "{|"
  | "|}"
  | ";"
  | ","
  | "."
  | ":"
  | "?"
  | "@"
  | "=>"
  | "="
  | "..."
  | "_"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "&&"
  | "||"
  | "|"
  | "&"
  | "^"
  | "!"
  | "~"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  from: number;
  to: number;
}

// Keywords map
const KEYWORDS: Record<string, TokenType> = {
  const: "const",
  type: "type",
  newtype: "newtype",
  import: "import",
  from: "from",
  export: "export",
  as: "as",
  comptime: "comptime",
  async: "async",
  await: "await",
  match: "match",
  case: "case",
  when: "when",
  throw: "throw",
  extends: "extends",
  true: "true",
  false: "false",
  null: "null",
  undefined: "undefined",
};

// Tokenizer
class Lexer {
  private pos = 0;
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? "";
  }

  private advance(): string {
    return this.source[this.pos++] ?? "";
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.advance();
      } else if (ch === "/" && this.peek(1) === "/") {
        // Line comment
        while (this.peek() && this.peek() !== "\n") this.advance();
      } else if (ch === "/" && this.peek(1) === "*") {
        // Block comment
        this.advance(); this.advance();
        while (this.pos < this.source.length - 1) {
          if (this.peek() === "*" && this.peek(1) === "/") {
            this.advance(); this.advance();
            break;
          }
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  nextToken(): Token {
    this.skipWhitespace();

    const from = this.pos;

    if (this.pos >= this.source.length) {
      return { type: "eof", value: "", from, to: from };
    }

    const ch = this.peek();

    // Multi-character operators
    const twoChar = ch + this.peek(1);
    const threeChar = twoChar + this.peek(2);

    if (threeChar === "...") {
      this.pos += 3;
      return { type: "...", value: "...", from, to: this.pos };
    }

    if (twoChar === "=>" || twoChar === "==" || twoChar === "!=" ||
        twoChar === "<=" || twoChar === ">=" || twoChar === "&&" ||
        twoChar === "||" || twoChar === "{|" || twoChar === "|}") {
      this.pos += 2;
      return { type: twoChar as TokenType, value: twoChar, from, to: this.pos };
    }

    // Single character operators/punctuation
    if ("()[]{}.,;:?@=+-*/%<>|&^!~".includes(ch)) {
      this.advance();
      return { type: ch as TokenType, value: ch, from, to: this.pos };
    }

    // String
    if (ch === '"' || ch === "'") {
      const quote = ch;
      this.advance();
      let value = "";
      while (this.peek() && this.peek() !== quote) {
        if (this.peek() === "\\") {
          this.advance();
          const escaped = this.advance();
          switch (escaped) {
            case "n": value += "\n"; break;
            case "t": value += "\t"; break;
            case "r": value += "\r"; break;
            case "\\": value += "\\"; break;
            case '"': value += '"'; break;
            case "'": value += "'"; break;
            default: value += escaped;
          }
        } else {
          value += this.advance();
        }
      }
      this.advance(); // closing quote
      return { type: "string", value, from, to: this.pos };
    }

    // Number
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(this.peek(1)))) {
      let value = "";
      // Hex, binary, octal
      if (ch === "0" && (this.peek(1) === "x" || this.peek(1) === "b" || this.peek(1) === "o")) {
        value += this.advance() + this.advance();
        while (/[0-9a-fA-F]/.test(this.peek())) value += this.advance();
      } else {
        while (/[0-9]/.test(this.peek())) value += this.advance();
        if (this.peek() === "." && /[0-9]/.test(this.peek(1))) {
          value += this.advance();
          while (/[0-9]/.test(this.peek())) value += this.advance();
        }
        if (this.peek() === "e" || this.peek() === "E") {
          value += this.advance();
          if (this.peek() === "+" || this.peek() === "-") value += this.advance();
          while (/[0-9]/.test(this.peek())) value += this.advance();
        }
      }
      return { type: "number", value, from, to: this.pos };
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let value = "";
      while (/[a-zA-Z0-9_]/.test(this.peek())) value += this.advance();

      const keyword = KEYWORDS[value];
      if (keyword) {
        return { type: keyword, value, from, to: this.pos };
      }

      // Type name starts with uppercase, identifier with lowercase
      const type: TokenType = /^[A-Z]/.test(value) ? "typeName" : "identifier";
      return { type, value, from, to: this.pos };
    }

    // Unknown character
    this.advance();
    throw new CompileError(`Unexpected character: ${ch}`, "parse", { from, to: this.pos });
  }
}

// Parser
export class Parser {
  private lexer: Lexer;
  private current: Token;
  private previous: Token;
  private source: string;

  private lookaheadBuffer: Token[] = [];

  constructor(source: string) {
    this.source = source;
    this.lexer = new Lexer(source);
    this.current = this.lexer.nextToken();
    this.previous = this.current;
  }

  /**
   * Peek at a token ahead without consuming.
   * peek(0) returns current token, peek(1) returns next token, etc.
   */
  private peek(offset: number): Token | undefined {
    if (offset === 0) return this.current;

    // Fill lookahead buffer as needed
    while (this.lookaheadBuffer.length < offset) {
      this.lookaheadBuffer.push(this.lexer.nextToken());
    }
    return this.lookaheadBuffer[offset - 1];
  }

  parse(): CoreDecl[] {
    const decls: CoreDecl[] = [];
    while (!this.check("eof")) {
      decls.push(this.declaration());
    }
    return decls;
  }

  private declaration(): CoreDecl {
    const from = this.current.from;

    if (this.check("comptime") || this.check("const")) {
      return this.constDecl(from);
    }
    if (this.check("type")) {
      return this.typeDecl(from);
    }
    if (this.check("newtype")) {
      return this.newtypeDecl(from);
    }
    if (this.check("import")) {
      return this.importDecl(from);
    }

    // Expression statement
    const expr = this.expression();
    this.consume(";", "Expected ';' after expression");
    return {
      kind: "expr",
      expr,
      loc: { from, to: this.previous.to },
    };
  }

  private constDecl(from: number): CoreDecl {
    const comptime = this.match("comptime");
    this.consume("const", "Expected 'const'");
    const name = this.consume("identifier", "Expected identifier").value;

    let type: CoreExpr | undefined;
    if (this.match(":")) {
      type = this.typeExpression();
    }

    this.consume("=", "Expected '='");
    const init = this.expression();
    this.consume(";", "Expected ';'");

    return {
      kind: "const",
      name,
      type,
      init,
      comptime,
      exported: false,
      loc: { from, to: this.previous.to },
    };
  }

  private typeDecl(from: number): CoreDecl {
    this.consume("type", "Expected 'type'");
    const name = this.consume("typeName", "Expected type name").value;

    // Type params would go here

    this.consume("=", "Expected '='");
    const typeExpr = this.typeExpression();
    this.consume(";", "Expected ';'");

    // Desugar: type Foo = T => const Foo = WithMetadata(T, { name: "Foo" })
    const withMetadataCall: CoreExpr = {
      kind: "call",
      fn: { kind: "identifier", name: "WithMetadata", loc: { from, to: from } },
      args: [
        typeExpr,
        {
          kind: "record",
          fields: [{
            kind: "field",
            name: "name",
            value: { kind: "literal", value: name, literalKind: "string", loc: { from, to: from } },
          }],
          loc: { from, to: from },
        },
      ],
      loc: { from, to: this.previous.to },
    };

    return {
      kind: "const",
      name,
      type: undefined,
      init: withMetadataCall,
      comptime: true,
      exported: false,
      loc: { from, to: this.previous.to },
    };
  }

  private newtypeDecl(from: number): CoreDecl {
    this.consume("newtype", "Expected 'newtype'");
    const name = this.consume("typeName", "Expected type name").value;
    this.consume("=", "Expected '='");
    const baseType = this.typeExpression();
    this.consume(";", "Expected ';'");

    // Desugar: newtype Foo = T => const Foo = Branded(T, "Foo")
    const brandedCall: CoreExpr = {
      kind: "call",
      fn: { kind: "identifier", name: "Branded", loc: { from, to: from } },
      args: [
        baseType,
        { kind: "literal", value: name, literalKind: "string", loc: { from, to: from } },
      ],
      loc: { from, to: this.previous.to },
    };

    return {
      kind: "const",
      name,
      type: undefined,
      init: brandedCall,
      comptime: true,
      exported: false,
      loc: { from, to: this.previous.to },
    };
  }

  private importDecl(from: number): CoreDecl {
    this.consume("import", "Expected 'import'");

    // Simplified import handling
    let clause: { kind: "default"; name: string } |
                { kind: "named"; specifiers: { name: string; alias?: string }[] } |
                { kind: "namespace"; name: string };

    if (this.check("{")) {
      this.advance();
      const specifiers: { name: string; alias?: string }[] = [];
      if (!this.check("}")) {
        do {
          const name = this.consume("identifier", "Expected identifier").value;
          let alias: string | undefined;
          if (this.match("as")) {
            alias = this.consume("identifier", "Expected alias").value;
          }
          specifiers.push({ name, alias });
        } while (this.match(","));
      }
      this.consume("}", "Expected '}'");
      clause = { kind: "named", specifiers };
    } else if (this.match("*")) {
      this.consume("as", "Expected 'as'");
      const name = this.consume("identifier", "Expected identifier").value;
      clause = { kind: "namespace", name };
    } else {
      const name = this.consume("identifier", "Expected identifier").value;
      clause = { kind: "default", name };
    }

    this.consume("from", "Expected 'from'");
    const source = this.consume("string", "Expected string").value;
    this.consume(";", "Expected ';'");

    return {
      kind: "import",
      clause,
      source,
      loc: { from, to: this.previous.to },
    };
  }

  // Expression parsing with precedence climbing
  private expression(): CoreExpr {
    return this.conditional();
  }

  private conditional(): CoreExpr {
    const from = this.current.from;
    let expr = this.logicalOr();

    if (this.match("?")) {
      const then = this.expression();
      this.consume(":", "Expected ':' in conditional");
      const else_ = this.conditional();
      expr = {
        kind: "conditional",
        condition: expr,
        then,
        else: else_,
        loc: { from, to: this.previous.to },
      };
    }

    return expr;
  }

  private logicalOr(): CoreExpr {
    return this.binaryLeft(["||"], () => this.logicalAnd());
  }

  private logicalAnd(): CoreExpr {
    return this.binaryLeft(["&&"], () => this.bitwiseOr());
  }

  private bitwiseOr(): CoreExpr {
    return this.binaryLeft(["|"], () => this.bitwiseXor());
  }

  private bitwiseXor(): CoreExpr {
    return this.binaryLeft(["^"], () => this.bitwiseAnd());
  }

  private bitwiseAnd(): CoreExpr {
    return this.binaryLeft(["&"], () => this.equality());
  }

  private equality(): CoreExpr {
    return this.binaryLeft(["==", "!="], () => this.comparison());
  }

  private comparison(): CoreExpr {
    return this.binaryLeft(["<", ">", "<=", ">="], () => this.additive());
  }

  private additive(): CoreExpr {
    return this.binaryLeft(["+", "-"], () => this.multiplicative());
  }

  private multiplicative(): CoreExpr {
    return this.binaryLeft(["*", "/", "%"], () => this.unary());
  }

  private binaryLeft(ops: string[], parseOperand: () => CoreExpr): CoreExpr {
    const from = this.current.from;
    let left = parseOperand();

    while (ops.some(op => this.check(op as TokenType))) {
      const op = this.advance().value as BinaryOp;
      const right = parseOperand();
      left = {
        kind: "binary",
        op,
        left,
        right,
        loc: { from, to: this.previous.to },
      };
    }

    return left;
  }

  private unary(): CoreExpr {
    const from = this.current.from;

    if (this.check("!") || this.check("-") || this.check("~")) {
      const op = this.advance().value as UnaryOp;
      const operand = this.unary();
      return {
        kind: "unary",
        op,
        operand,
        loc: { from, to: this.previous.to },
      };
    }

    if (this.match("await")) {
      const expr = this.unary();
      return {
        kind: "await",
        expr,
        loc: { from, to: this.previous.to },
      };
    }

    return this.postfix();
  }

  private postfix(): CoreExpr {
    let expr = this.primary();

    while (true) {
      const from = expr.loc.from;

      if (this.match("(")) {
        // Function call
        const args: CoreExpr[] = [];
        if (!this.check(")")) {
          do {
            args.push(this.expression());
          } while (this.match(","));
        }
        this.consume(")", "Expected ')'");
        expr = {
          kind: "call",
          fn: expr,
          args,
          loc: { from, to: this.previous.to },
        };
      } else if (this.match("[")) {
        // Index access
        const index = this.expression();
        this.consume("]", "Expected ']'");
        expr = {
          kind: "index",
          object: expr,
          index,
          loc: { from, to: this.previous.to },
        };
      } else if (this.match(".")) {
        // Property access
        const name = this.consume("identifier", "Expected property name").value;
        expr = {
          kind: "property",
          object: expr,
          name,
          loc: { from, to: this.previous.to },
        };
      } else if (this.check("<") && !this.hadWhitespaceBefore()) {
        // Type call - check for no whitespace before <
        this.advance(); // consume <
        const typeArgs: CoreExpr[] = [];
        do {
          typeArgs.push(this.typeExpression());
        } while (this.match(","));
        this.consume(">", "Expected '>'");

        // If followed by (, it's a call with type args
        if (this.match("(")) {
          const args: CoreExpr[] = [];
          if (!this.check(")")) {
            do {
              args.push(this.expression());
            } while (this.match(","));
          }
          this.consume(")", "Expected ')'");
          expr = {
            kind: "call",
            fn: expr,
            args: [...typeArgs, ...args], // Type args passed as first args
            loc: { from, to: this.previous.to },
          };
        } else {
          // Just type application
          expr = {
            kind: "call",
            fn: expr,
            args: typeArgs,
            loc: { from, to: this.previous.to },
          };
        }
      } else {
        break;
      }
    }

    return expr;
  }

  private hadWhitespaceBefore(): boolean {
    // Check if there was whitespace before current token
    if (this.previous.to >= this.current.from) return false;
    const between = this.source.slice(this.previous.to, this.current.from);
    return /\s/.test(between);
  }

  private primary(): CoreExpr {
    const from = this.current.from;

    // Literals
    if (this.check("number")) {
      const value = this.advance().value;
      const isFloat = value.includes(".") || value.includes("e") || value.includes("E");
      return {
        kind: "literal",
        value: isFloat ? parseFloat(value) : parseInt(value),
        literalKind: isFloat ? "float" : "int",
        loc: { from, to: this.previous.to },
      };
    }

    if (this.check("string")) {
      const value = this.advance().value;
      return {
        kind: "literal",
        value,
        literalKind: "string",
        loc: { from, to: this.previous.to },
      };
    }

    if (this.match("true")) {
      return { kind: "literal", value: true, literalKind: "boolean", loc: { from, to: this.previous.to } };
    }
    if (this.match("false")) {
      return { kind: "literal", value: false, literalKind: "boolean", loc: { from, to: this.previous.to } };
    }
    if (this.match("null")) {
      return { kind: "literal", value: null, literalKind: "null", loc: { from, to: this.previous.to } };
    }
    if (this.match("undefined")) {
      return { kind: "literal", value: undefined, literalKind: "undefined", loc: { from, to: this.previous.to } };
    }

    // Array
    if (this.match("[")) {
      const elements: CoreArrayElement[] = [];
      if (!this.check("]")) {
        do {
          const spread = this.match("...");
          const value = this.expression();
          elements.push(spread ? { kind: "spread", expr: value } : { kind: "element", value });
        } while (this.match(","));
      }
      this.consume("]", "Expected ']'");
      return {
        kind: "array",
        elements,
        loc: { from, to: this.previous.to },
      };
    }

    // Record or block
    if (this.match("{")) {
      return this.recordOrBlock(from);
    }

    // Parenthesized expression or lambda
    if (this.match("(")) {
      return this.parenOrLambda(from);
    }

    // Match expression
    if (this.match("match")) {
      return this.matchExpr(from);
    }

    // Throw
    if (this.match("throw")) {
      const expr = this.unary();
      return {
        kind: "throw",
        expr,
        loc: { from, to: this.previous.to },
      };
    }

    // Identifier or type name
    if (this.check("identifier") || this.check("typeName")) {
      const name = this.advance().value;

      // Check for arrow function: x => ...
      if (this.check("=>")) {
        this.advance();
        const body = this.expression();
        return {
          kind: "lambda",
          params: [{ name, annotations: [] }],
          body,
          async: false,
          loc: { from, to: this.previous.to },
        };
      }

      return {
        kind: "identifier",
        name,
        loc: { from, to: this.previous.to },
      };
    }

    throw new CompileError(
      `Unexpected token: ${this.current.type}`,
      "parse",
      { from: this.current.from, to: this.current.to }
    );
  }

  private recordOrBlock(from: number): CoreExpr {
    // Empty {} is ambiguous - treat as empty record
    if (this.check("}")) {
      this.advance();
      return {
        kind: "record",
        fields: [],
        loc: { from, to: this.previous.to },
      };
    }

    // Try to determine if it's a record or block
    // Record fields have name: value or just name
    // Blocks have statements

    // Lookahead to check for record pattern
    const isRecord = this.isRecordStart();

    if (isRecord) {
      const fields: CoreRecordField[] = [];
      do {
        if (this.match("...")) {
          const expr = this.expression();
          fields.push({ kind: "spread", expr });
        } else {
          // Property names can be identifier or typeName
          let name: string;
          if (this.check("identifier") || this.check("typeName")) {
            name = this.advance().value;
          } else {
            throw new CompileError("Expected field name", "parse", { from: this.current.from, to: this.current.to });
          }
          let value: CoreExpr;
          if (this.match(":")) {
            value = this.expression();
          } else {
            // Shorthand: { x } means { x: x }
            value = { kind: "identifier", name, loc: { from, to: this.previous.to } };
          }
          fields.push({ kind: "field", name, value });
        }
      } while (this.match(","));
      this.consume("}", "Expected '}'");
      return {
        kind: "record",
        fields,
        loc: { from, to: this.previous.to },
      };
    } else {
      // Block
      const statements: CoreDecl[] = [];
      let result: CoreExpr | undefined;

      while (!this.check("}")) {
        if (this.check("const") || this.check("comptime") || this.check("type") || this.check("newtype")) {
          statements.push(this.declaration());
        } else {
          const expr = this.expression();
          if (this.check(";")) {
            this.advance();
            statements.push({
              kind: "expr",
              expr,
              loc: expr.loc,
            });
          } else {
            // Last expression without semicolon is the result
            result = expr;
            break;
          }
        }
      }

      this.consume("}", "Expected '}'");
      return {
        kind: "block",
        statements,
        result,
        loc: { from, to: this.previous.to },
      };
    }
  }

  private isRecordStart(): boolean {
    // Check if current position starts a record
    // Records: { name: value, ... } or { name, ... } or { ...expr, ... }
    // Blocks: { statement; ... } or { expression }

    if (this.check("...")) return true;
    if (!this.check("identifier") && !this.check("typeName")) return false;

    // For now, always treat { identifier as record start
    // We can distinguish later based on what follows
    return true;
  }

  private parenOrLambda(from: number): CoreExpr {
    // Could be:
    // - (expr) - parenthesized expression
    // - () => body - lambda with no params
    // - (x) => body - lambda with one param
    // - (x, y) => body - lambda with multiple params
    // - (x: T) => body - lambda with typed param

    if (this.check(")")) {
      this.advance();
      if (this.check("=>")) {
        // () => body
        this.advance();
        const body = this.arrowBody();
        return {
          kind: "lambda",
          params: [],
          body,
          async: false,
          loc: { from, to: this.previous.to },
        };
      }
      // () is invalid as expression
      throw new CompileError("Unexpected empty parentheses", "parse", { from, to: this.previous.to });
    }

    // Parse what's inside
    const first = this.expression();

    if (this.check(",") || this.check(":") && first.kind === "identifier") {
      // Looks like lambda params
      const params: CoreParam[] = [];

      // Handle first param
      if (first.kind === "identifier") {
        let type: CoreExpr | undefined;
        if (this.match(":")) {
          type = this.typeExpression();
        }
        params.push({ name: first.name, type, annotations: [] });
      } else {
        throw new CompileError("Expected parameter name", "parse", first.loc);
      }

      while (this.match(",")) {
        const name = this.consume("identifier", "Expected parameter name").value;
        let type: CoreExpr | undefined;
        if (this.match(":")) {
          type = this.typeExpression();
        }
        params.push({ name, type, annotations: [] });
      }

      this.consume(")", "Expected ')'");
      this.consume("=>", "Expected '=>'");
      const body = this.arrowBody();

      return {
        kind: "lambda",
        params,
        body,
        async: false,
        loc: { from, to: this.previous.to },
      };
    }

    this.consume(")", "Expected ')'");

    // Check for arrow after )
    if (this.check("=>")) {
      // (x) => body - single param lambda
      if (first.kind !== "identifier") {
        throw new CompileError("Expected identifier for lambda parameter", "parse", first.loc);
      }
      this.advance();
      const body = this.arrowBody();
      return {
        kind: "lambda",
        params: [{ name: first.name, annotations: [] }],
        body,
        async: false,
        loc: { from, to: this.previous.to },
      };
    }

    // Just parenthesized expression
    return first;
  }

  private arrowBody(): CoreExpr {
    if (this.check("{")) {
      const from = this.current.from;
      this.advance();
      const statements: CoreDecl[] = [];
      let result: CoreExpr | undefined;

      while (!this.check("}")) {
        if (this.check("const") || this.check("comptime") || this.check("type") || this.check("newtype")) {
          statements.push(this.declaration());
        } else {
          const expr = this.expression();
          if (this.match(";")) {
            statements.push({ kind: "expr", expr, loc: expr.loc });
          } else {
            result = expr;
            break;
          }
        }
      }

      this.consume("}", "Expected '}'");
      return {
        kind: "block",
        statements,
        result,
        loc: { from, to: this.previous.to },
      };
    }

    return this.expression();
  }

  private matchExpr(from: number): CoreExpr {
    this.consume("(", "Expected '(' after 'match'");
    const expr = this.expression();
    this.consume(")", "Expected ')'");
    this.consume("{", "Expected '{'");

    const cases: CoreCase[] = [];
    while (this.match("case")) {
      const caseFrom = this.previous.from;
      const pattern = this.pattern();
      let guard: CoreExpr | undefined;
      if (this.match("when")) {
        guard = this.expression();
      }
      this.consume(":", "Expected ':'");
      const body = this.expression();
      this.consume(";", "Expected ';'");
      cases.push({ pattern, guard, body, loc: { from: caseFrom, to: this.previous.to } });
    }

    this.consume("}", "Expected '}'");
    return {
      kind: "match",
      expr,
      cases,
      loc: { from, to: this.previous.to },
    };
  }

  private pattern(): CorePattern {
    const from = this.current.from;

    if (this.match("_")) {
      return { kind: "wildcard", loc: { from, to: this.previous.to } };
    }

    if (this.check("number") || this.check("string") || this.check("true") ||
        this.check("false") || this.check("null") || this.check("undefined")) {
      const lit = this.primary();
      if (lit.kind !== "literal") throw new CompileError("Expected literal", "parse", lit.loc);
      return {
        kind: "literal",
        value: lit.value,
        literalKind: lit.literalKind,
        loc: lit.loc,
      };
    }

    if (this.match("{")) {
      const fields: { name: string; binding?: string; pattern?: CorePattern }[] = [];
      if (!this.check("}")) {
        do {
          const name = this.consume("identifier", "Expected field name").value;
          let pattern: CorePattern | undefined;
          if (this.match(":")) {
            pattern = this.pattern();
          }
          fields.push({ name, pattern });
        } while (this.match(","));
      }
      this.consume("}", "Expected '}'");
      return {
        kind: "destructure",
        fields,
        loc: { from, to: this.previous.to },
      };
    }

    if (this.check("typeName")) {
      const typeExpr: CoreExpr = { kind: "identifier", name: this.advance().value, loc: { from, to: this.previous.to } };
      return {
        kind: "type",
        typeExpr,
        loc: { from, to: this.previous.to },
      };
    }

    if (this.check("identifier")) {
      const name = this.advance().value;
      return {
        kind: "binding",
        name,
        loc: { from, to: this.previous.to },
      };
    }

    throw new CompileError("Expected pattern", "parse", { from, to: this.current.to });
  }

  // Type expression parsing
  private typeExpression(): CoreExpr {
    return this.unionType();
  }

  private unionType(): CoreExpr {
    const from = this.current.from;
    let left = this.intersectionType();

    while (this.match("|")) {
      const right = this.intersectionType();
      left = {
        kind: "call",
        fn: { kind: "identifier", name: "Union", loc: { from, to: from } },
        args: [left, right],
        loc: { from, to: this.previous.to },
      };
    }

    return left;
  }

  private intersectionType(): CoreExpr {
    const from = this.current.from;
    let left = this.primaryType();

    while (this.match("&")) {
      const right = this.primaryType();
      left = {
        kind: "call",
        fn: { kind: "identifier", name: "Intersection", loc: { from, to: from } },
        args: [left, right],
        loc: { from, to: this.previous.to },
      };
    }

    return left;
  }

  private primaryType(): CoreExpr {
    const from = this.current.from;

    // Record type: { field: Type } or {| field: Type |}
    if (this.match("{")) {
      return this.recordType(from, false);
    }
    if (this.match("{|")) {
      return this.recordType(from, true);
    }

    // Tuple/Array type: [T, U] or [T]
    if (this.match("[")) {
      return this.tupleType(from);
    }

    // Function type: (params) => ReturnType
    if (this.check("(")) {
      return this.functionType(from);
    }

    // Literal type
    if (this.check("number") || this.check("string") || this.check("true") || this.check("false")) {
      return this.primary();
    }

    // Named type with optional type arguments
    if (this.check("typeName") || this.check("identifier")) {
      const name = this.advance().value;
      let expr: CoreExpr = { kind: "identifier", name, loc: { from, to: this.previous.to } };

      // Type arguments
      if (this.check("<") && !this.hadWhitespaceBefore()) {
        this.advance();
        const args: CoreExpr[] = [];
        do {
          args.push(this.typeExpression());
        } while (this.match(","));
        this.consume(">", "Expected '>'");
        expr = {
          kind: "call",
          fn: expr,
          args,
          loc: { from, to: this.previous.to },
        };
      }

      // Array suffix []
      while (this.match("[")) {
        this.consume("]", "Expected ']'");
        expr = {
          kind: "call",
          fn: { kind: "identifier", name: "Array", loc: { from, to: from } },
          args: [expr],
          loc: { from, to: this.previous.to },
        };
      }

      return expr;
    }

    throw new CompileError(
      `Expected type expression, got ${this.current.type}`,
      "parse",
      { from: this.current.from, to: this.current.to }
    );
  }

  private recordType(from: number, closed: boolean): CoreExpr {
    const fields: CoreExpr[] = [];
    const closingBracket = closed ? "|}" : "}";

    if (!this.check(closingBracket as TokenType)) {
      do {
        const fieldFrom = this.current.from;
        const name = this.consume("identifier", "Expected field name").value;
        const optional = this.match("?");
        this.consume(":", "Expected ':'");
        const type = this.typeExpression();

        fields.push({
          kind: "record",
          fields: [
            { kind: "field", name: "name", value: { kind: "literal", value: name, literalKind: "string", loc: { from: fieldFrom, to: fieldFrom } } },
            { kind: "field", name: "type", value: type },
            { kind: "field", name: "optional", value: { kind: "literal", value: optional, literalKind: "boolean", loc: { from: fieldFrom, to: fieldFrom } } },
            { kind: "field", name: "annotations", value: { kind: "array", elements: [], loc: { from: fieldFrom, to: fieldFrom } } },
          ],
          loc: { from: fieldFrom, to: this.previous.to },
        });
      } while (this.match(","));
    }

    this.consume(closingBracket as TokenType, `Expected '${closingBracket}'`);

    const args: CoreExpr[] = [
      { kind: "array", elements: fields.map(f => ({ kind: "element" as const, value: f })), loc: { from, to: this.previous.to } },
    ];

    if (closed) {
      args.push({ kind: "identifier", name: "Never", loc: { from, to: from } });
    }

    return {
      kind: "call",
      fn: { kind: "identifier", name: "RecordType", loc: { from, to: from } },
      args,
      loc: { from, to: this.previous.to },
    };
  }

  private tupleType(from: number): CoreExpr {
    const elements: CoreExpr[] = [];

    if (!this.check("]")) {
      do {
        elements.push(this.typeExpression());
      } while (this.match(","));
    }

    this.consume("]", "Expected ']'");

    return {
      kind: "call",
      fn: { kind: "identifier", name: "Array", loc: { from, to: from } },
      args: elements,
      loc: { from, to: this.previous.to },
    };
  }

  private functionType(from: number): CoreExpr {
    this.consume("(", "Expected '('");

    const params: CoreExpr[] = [];
    if (!this.check(")")) {
      do {
        // Handle both named params (x: Int) and anonymous params (Int)
        // Check if it's identifier followed by : (named param)
        if ((this.check("identifier") || this.check("typeName")) && this.peek(1)?.type === ":") {
          // Named parameter: x: Type
          this.advance(); // consume name
          this.advance(); // consume :
          params.push(this.typeExpression());
        } else {
          // Anonymous parameter: just a type
          params.push(this.typeExpression());
        }
      } while (this.match(","));
    }

    this.consume(")", "Expected ')'");
    this.consume("=>", "Expected '=>'");
    const returnType = this.typeExpression();

    return {
      kind: "call",
      fn: { kind: "identifier", name: "FunctionType", loc: { from, to: from } },
      args: [
        { kind: "array", elements: params.map(p => ({ kind: "element" as const, value: p })), loc: { from, to: this.previous.to } },
        returnType,
      ],
      loc: { from, to: this.previous.to },
    };
  }

  // Helpers
  private check(type: TokenType): boolean {
    return this.current.type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private advance(): Token {
    this.previous = this.current;
    if (this.lookaheadBuffer.length > 0) {
      this.current = this.lookaheadBuffer.shift()!;
    } else {
      this.current = this.lexer.nextToken();
    }
    return this.previous;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    throw new CompileError(
      `${message}, got ${this.current.type}`,
      "parse",
      { from: this.current.from, to: this.current.to }
    );
  }
}

/**
 * Parse DepJS source code into CoreAST.
 */
export function parse(source: string): CoreDecl[] {
  const parser = new Parser(source);
  return parser.parse();
}
