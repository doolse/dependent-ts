/**
 * Parser for a TypeScript-like expression language.
 * Converts source strings to Expr AST nodes.
 */

import {
  Expr,
  BinaryOp,
  lit,
  varRef,
  binOp,
  ifExpr,
  obj,
  field,
  call,
  typeOf,
  fields,
  fieldType,
  hasField,
  typeTag,
  typeToStringExpr,
  lambda,
  letExpr,
} from "./expr";

// ============================================================================
// Tokenizer
// ============================================================================

type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "identifier"
  | "keyword"
  | "operator"
  | "punctuation"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPERATORS = [
  "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "=>",
  "+", "-", "*", "/", "<", ">", "?", ":", "=",
];

const PUNCTUATION = ["(", ")", "{", "}", "[", "]", ",", "."];

const KEYWORDS = ["true", "false", "let", "in"];

class Lexer {
  private pos = 0;
  private tokens: Token[] = [];

  constructor(private source: string) {
    this.tokenize();
  }

  private tokenize(): void {
    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;

      const startPos = this.pos;
      const ch = this.source[this.pos];

      // String literal
      if (ch === '"' || ch === "'") {
        this.tokens.push(this.readString(ch));
        continue;
      }

      // Number literal
      if (this.isDigit(ch) || (ch === "-" && this.isDigit(this.peek(1)))) {
        this.tokens.push(this.readNumber());
        continue;
      }

      // Identifier or keyword
      if (this.isIdentStart(ch)) {
        this.tokens.push(this.readIdentifier());
        continue;
      }

      // Operators (try longest match first)
      const op = this.tryOperator();
      if (op) {
        this.tokens.push({ type: "operator", value: op, pos: startPos });
        continue;
      }

      // Punctuation
      if (PUNCTUATION.includes(ch)) {
        this.tokens.push({ type: "punctuation", value: ch, pos: startPos });
        this.pos++;
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    this.tokens.push({ type: "eof", value: "", pos: this.pos });
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++;
    }
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] || "";
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  private readString(quote: string): Token {
    const startPos = this.pos;
    this.pos++; // skip opening quote
    let value = "";

    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      if (this.source[this.pos] === "\\") {
        this.pos++;
        const escaped = this.source[this.pos];
        switch (escaped) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          default: value += escaped;
        }
      } else {
        value += this.source[this.pos];
      }
      this.pos++;
    }

    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated string starting at position ${startPos}`);
    }

    this.pos++; // skip closing quote
    return { type: "string", value, pos: startPos };
  }

  private readNumber(): Token {
    const startPos = this.pos;
    let value = "";

    if (this.source[this.pos] === "-") {
      value += "-";
      this.pos++;
    }

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.source[this.pos];
      this.pos++;
    }

    // Decimal part
    if (this.source[this.pos] === "." && this.isDigit(this.peek(1))) {
      value += ".";
      this.pos++;
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        value += this.source[this.pos];
        this.pos++;
      }
    }

    return { type: "number", value, pos: startPos };
  }

  private readIdentifier(): Token {
    const startPos = this.pos;
    let value = "";

    while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos])) {
      value += this.source[this.pos];
      this.pos++;
    }

    if (value === "true" || value === "false") {
      return { type: "boolean", value, pos: startPos };
    }

    if (value === "let" || value === "in") {
      return { type: "keyword", value, pos: startPos };
    }

    return { type: "identifier", value, pos: startPos };
  }

  private tryOperator(): string | null {
    // Try longest operators first
    for (const op of OPERATORS) {
      if (this.source.substring(this.pos, this.pos + op.length) === op) {
        this.pos += op.length;
        return op;
      }
    }
    return null;
  }

  getTokens(): Token[] {
    return this.tokens;
  }
}

// ============================================================================
// Parser
// ============================================================================

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  parse(): Expr {
    const expr = this.parseExpression();
    if (this.current().type !== "eof") {
      throw new Error(`Unexpected token '${this.current().value}' at end of expression`);
    }
    return expr;
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: "eof", value: "", pos: -1 };
  }

  private peek(offset = 1): Token {
    return this.tokens[this.pos + offset] || { type: "eof", value: "", pos: -1 };
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(
        `Expected ${type}${value ? ` '${value}'` : ""}, got ${token.type} '${token.value}'`
      );
    }
    return this.advance();
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current();
    return token.type === type && (value === undefined || token.value === value);
  }

  // Expression parsing with precedence climbing
  private parseExpression(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    let expr = this.parseOr();

    if (this.match("operator", "?")) {
      this.advance();
      const thenBranch = this.parseExpression();
      this.expect("operator", ":");
      const elseBranch = this.parseExpression();
      expr = ifExpr(expr, thenBranch, elseBranch);
    }

    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();

    while (this.match("operator", "||")) {
      this.advance();
      const right = this.parseAnd();
      left = binOp("||", left, right);
    }

    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();

    while (this.match("operator", "&&")) {
      this.advance();
      const right = this.parseEquality();
      left = binOp("&&", left, right);
    }

    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();

    while (
      this.match("operator", "==") ||
      this.match("operator", "!=") ||
      this.match("operator", "===") ||
      this.match("operator", "!==")
    ) {
      let op = this.advance().value;
      // Normalize === to == and !== to !=
      if (op === "===") op = "==";
      if (op === "!==") op = "!=";
      const right = this.parseComparison();
      left = binOp(op as BinaryOp, left, right);
    }

    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();

    while (
      this.match("operator", "<") ||
      this.match("operator", ">") ||
      this.match("operator", "<=") ||
      this.match("operator", ">=")
    ) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseAdditive();
      left = binOp(op, left, right);
    }

    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();

    while (this.match("operator", "+") || this.match("operator", "-")) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseMultiplicative();
      left = binOp(op, left, right);
    }

    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();

    while (this.match("operator", "*") || this.match("operator", "/")) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseUnary();
      left = binOp(op, left, right);
    }

    return left;
  }

  private parseUnary(): Expr {
    // For now, just postfix (field access, calls)
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match("punctuation", ".")) {
        this.advance();
        const fieldName = this.expect("identifier").value;
        expr = field(expr, fieldName);
      } else if (this.match("punctuation", "(")) {
        // Function call - works for any expression: foo(1), (lambda)(1), obj.method(1)
        expr = this.parseCall(expr);
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Expr {
    const token = this.current();

    // Number literal
    if (token.type === "number") {
      this.advance();
      return lit(parseFloat(token.value));
    }

    // String literal
    if (token.type === "string") {
      this.advance();
      return lit(token.value);
    }

    // Boolean literal
    if (token.type === "boolean") {
      this.advance();
      return lit(token.value === "true");
    }

    // Let expression: let x = expr in body
    if (this.match("keyword", "let")) {
      return this.parseLet();
    }

    // Parenthesized expression or lambda
    if (this.match("punctuation", "(")) {
      return this.parseParenOrLambda();
    }

    // Object literal
    if (this.match("punctuation", "{")) {
      return this.parseObject();
    }

    // Identifier (variable)
    if (token.type === "identifier") {
      const name = this.advance().value;
      return varRef(name);
    }

    throw new Error(`Unexpected token '${token.value}' (${token.type})`);
  }

  private parseLet(): Expr {
    this.expect("keyword", "let");
    const name = this.expect("identifier").value;
    this.expect("operator", "=");
    const value = this.parseExpression();
    this.expect("keyword", "in");
    const body = this.parseExpression();
    return letExpr(name, value, body);
  }

  private parseObject(): Expr {
    this.expect("punctuation", "{");
    const objectFields: { name: string; value: Expr }[] = [];

    while (!this.match("punctuation", "}")) {
      const fieldName = this.expect("identifier").value;
      this.expect("operator", ":");
      const fieldValue = this.parseExpression();
      objectFields.push({ name: fieldName, value: fieldValue });

      if (this.match("punctuation", ",")) {
        this.advance();
      } else {
        break;
      }
    }

    this.expect("punctuation", "}");
    return obj(objectFields);
  }

  private parseCall(funcExpr: Expr): Expr {
    this.expect("punctuation", "(");
    const args: Expr[] = [];

    while (!this.match("punctuation", ")")) {
      args.push(this.parseExpression());

      if (this.match("punctuation", ",")) {
        this.advance();
      } else {
        break;
      }
    }

    this.expect("punctuation", ")");

    // Handle reflection built-ins specially (if funcExpr is a variable)
    if (funcExpr.tag === "variable") {
      const name = funcExpr.name;
      switch (name) {
        case "typeOf":
          if (args.length !== 1) throw new Error("typeOf() requires 1 argument");
          return typeOf(args[0]);
        case "fields":
          if (args.length !== 1) throw new Error("fields() requires 1 argument");
          return fields(args[0]);
        case "fieldType":
          if (args.length !== 2) throw new Error("fieldType() requires 2 arguments");
          return fieldType(args[0], args[1]);
        case "hasField":
          if (args.length !== 2) throw new Error("hasField() requires 2 arguments");
          return hasField(args[0], args[1]);
        case "typeTag":
          if (args.length !== 1) throw new Error("typeTag() requires 1 argument");
          return typeTag(args[0]);
        case "typeToString":
          if (args.length !== 1) throw new Error("typeToString() requires 1 argument");
          return typeToStringExpr(args[0]);
      }
    }

    return call(funcExpr, ...args);
  }

  /**
   * Parse either a parenthesized expression or a lambda.
   * We need to look ahead to determine which one.
   */
  private parseParenOrLambda(): Expr {
    const startPos = this.pos;
    this.expect("punctuation", "(");

    // Try to parse as parameter list for lambda
    const params: string[] = [];
    let isLambda = true;

    // Check if this could be a lambda: (ident, ident, ...) =>
    while (!this.match("punctuation", ")")) {
      if (this.match("identifier")) {
        params.push(this.advance().value);
        if (this.match("punctuation", ",")) {
          this.advance();
        } else if (!this.match("punctuation", ")")) {
          // Not a valid parameter list
          isLambda = false;
          break;
        }
      } else {
        // Not an identifier, so not a lambda parameter list
        isLambda = false;
        break;
      }
    }

    if (isLambda) {
      this.expect("punctuation", ")");

      // Check for => arrow
      if (this.match("operator", "=>")) {
        this.advance();
        const body = this.parseExpression();
        return lambda(params, body);
      }

      // No arrow, so it was just a parenthesized expression with identifiers
      // Need to backtrack - but for simplicity, handle single identifier case
      if (params.length === 1) {
        return varRef(params[0]);
      }
    }

    // Not a lambda, backtrack and parse as expression
    this.pos = startPos;
    this.expect("punctuation", "(");
    const expr = this.parseExpression();
    this.expect("punctuation", ")");
    return expr;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a source string into an Expr AST.
 */
export function parse(source: string): Expr {
  const lexer = new Lexer(source);
  const parser = new Parser(lexer.getTokens());
  return parser.parse();
}

/**
 * Parse a function definition from source.
 * Format: (param1, param2) => expr
 */
export function parseFunction(source: string): { params: string[]; body: Expr } {
  const lexer = new Lexer(source);
  const tokens = lexer.getTokens();

  // Parse parameter list
  let pos = 0;

  const expect = (type: TokenType, value?: string) => {
    const token = tokens[pos];
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ""}, got ${token.type} '${token.value}'`);
    }
    return tokens[pos++];
  };

  const match = (type: TokenType, value?: string) => {
    const token = tokens[pos];
    return token.type === type && (value === undefined || token.value === value);
  };

  expect("punctuation", "(");
  const params: string[] = [];

  while (!match("punctuation", ")")) {
    params.push(expect("identifier").value);
    if (match("punctuation", ",")) {
      pos++;
    } else {
      break;
    }
  }

  expect("punctuation", ")");

  // Expect => arrow
  if (!match("operator", "=>")) {
    throw new Error("Expected '=>' after parameter list");
  }
  pos++;

  // Parse body
  const remainingTokens = tokens.slice(pos);
  const bodyParser = new Parser(remainingTokens);
  const body = bodyParser.parse();

  return { params, body };
}
