/**
 * Parser - Recursive descent parser for the expression language.
 *
 * Grammar (in rough precedence order, lowest to highest):
 *
 * expr       = letExpr | ifExpr | fnExpr | orExpr
 * letExpr    = "let" IDENT "=" expr "in" expr
 * ifExpr     = "if" expr "then" expr "else" expr
 * fnExpr     = "fn" IDENT? "(" params? ")" "=>" expr   // Named = recursive
 * orExpr     = andExpr ("||" andExpr)*
 * andExpr    = eqExpr ("&&" eqExpr)*
 * eqExpr     = cmpExpr (("==" | "!=") cmpExpr)*
 * cmpExpr    = addExpr (("<" | ">" | "<=" | ">=") addExpr)*
 * addExpr    = mulExpr (("+" | "-") mulExpr)*
 * mulExpr    = unaryExpr (("*" | "/" | "%") unaryExpr)*
 * unaryExpr  = ("!" | "-") unaryExpr | postfixExpr
 * postfixExpr = primary (call | fieldAccess | indexAccess)*
 * call       = "(" args? ")"
 * fieldAccess = "." IDENT
 * indexAccess = "[" expr "]"
 * primary    = NUMBER | STRING | "true" | "false" | "null"
 *            | IDENT | "(" expr ")" | object | array
 *            | "comptime" "(" expr ")" | "runtime" "(" expr ")"
 * object     = "{" (field ("," field)*)? "}"
 * field      = IDENT ":" expr
 * array      = "[" (expr ("," expr)*)? "]"
 */

import { Token, TokenType, tokenize, LexerError, Lexer } from "./lexer";
import {
  Expr,
  lit,
  varRef,
  binop,
  unary,
  ifExpr,
  letExpr,
  letPatternExpr,
  fn,
  recfn,
  call,
  obj,
  field,
  array,
  index,
  comptime,
  runtime,
  assertExpr,
  assertCondExpr,
  trustExpr,
  methodCall,
  importExpr,
  typeOfExpr,
  BinOp,
  UnaryOp,
  Pattern,
  varPattern,
  arrayPattern,
  objectPattern,
} from "./expr";

// ============================================================================
// Parser Class
// ============================================================================

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private source: string = "";  // Original source for JSX text extraction

  constructor(tokens: Token[], source?: string) {
    this.tokens = tokens;
    this.source = source || "";
  }

  parse(): Expr {
    const expr = this.parseExpr();

    if (!this.isAtEnd()) {
      const tok = this.peek();
      throw new ParseError(`Unexpected token '${tok.value}' at line ${tok.line}, column ${tok.column}`);
    }

    return expr;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    const tok = this.peek();
    throw new ParseError(`${message} at line ${tok.line}, column ${tok.column}. Got '${tok.value}'`);
  }

  // ==========================================================================
  // Expression Parsing
  // ==========================================================================

  private parseExpr(): Expr {
    // Check for let, if, fn, import first
    if (this.check("LET")) return this.parseLetExpr();
    if (this.check("IF")) return this.parseIfExpr();
    if (this.check("FN")) return this.parseFnExpr();
    if (this.check("IMPORT")) return this.parseImportExpr();

    return this.parseOrExpr();
  }

  private parseImportExpr(): Expr {
    this.expect("IMPORT", "Expected 'import'");
    this.expect("LBRACE", "Expected '{' after 'import'");

    // Parse named imports
    const names: string[] = [];
    if (!this.check("RBRACE")) {
      do {
        const name = this.expect("IDENT", "Expected identifier in import").value;
        names.push(name);
      } while (this.match("COMMA"));
    }

    this.expect("RBRACE", "Expected '}' after import names");
    this.expect("FROM", "Expected 'from' after import names");

    // Parse module path (a string literal)
    const pathToken = this.expect("STRING", "Expected module path string after 'from'");
    const modulePath = pathToken.value;

    this.expect("IN", "Expected 'in' after module path");
    const body = this.parseExpr();

    return importExpr(names, modulePath, body);
  }

  private parseLetExpr(): Expr {
    this.expect("LET", "Expected 'let'");

    // Check if this is a destructuring pattern: let [a, b] = ... or let { x, y } = ...
    if (this.check("LBRACKET") || this.check("LBRACE")) {
      const pattern = this.parsePattern();
      this.expect("ASSIGN", "Expected '=' after pattern in let binding");
      const value = this.parseExpr();
      this.expect("IN", "Expected 'in' after let value");
      const body = this.parseExpr();
      return letPatternExpr(pattern, value, body);
    }

    // Simple let binding: let name = ...
    const name = this.expect("IDENT", "Expected identifier after 'let'").value;
    this.expect("ASSIGN", "Expected '=' after identifier in let binding");
    const value = this.parseExpr();
    this.expect("IN", "Expected 'in' after let value");
    const body = this.parseExpr();
    return letExpr(name, value, body);
  }

  private parsePattern(): Pattern {
    // Array pattern: [a, b, c]
    if (this.match("LBRACKET")) {
      const elements: Pattern[] = [];
      if (!this.check("RBRACKET")) {
        do {
          elements.push(this.parsePattern());
        } while (this.match("COMMA"));
      }
      this.expect("RBRACKET", "Expected ']' after array pattern");
      return arrayPattern(...elements);
    }

    // Object pattern: { x, y } or { x: a, y: b }
    if (this.match("LBRACE")) {
      const fields: { key: string; pattern: Pattern }[] = [];
      if (!this.check("RBRACE")) {
        do {
          const key = this.expect("IDENT", "Expected field name in object pattern").value;
          let pat: Pattern;
          if (this.match("COLON")) {
            // { key: pattern }
            pat = this.parsePattern();
          } else {
            // { key } - shorthand for { key: key }
            pat = varPattern(key);
          }
          fields.push({ key, pattern: pat });
        } while (this.match("COMMA"));
      }
      this.expect("RBRACE", "Expected '}' after object pattern");
      return objectPattern(fields);
    }

    // Simple variable pattern
    const name = this.expect("IDENT", "Expected identifier in pattern").value;
    return varPattern(name);
  }

  private parseIfExpr(): Expr {
    this.expect("IF", "Expected 'if'");
    const cond = this.parseExpr();
    this.expect("THEN", "Expected 'then' after if condition");
    const thenBranch = this.parseExpr();
    this.expect("ELSE", "Expected 'else' after then branch");
    const elseBranch = this.parseExpr();
    return ifExpr(cond, thenBranch, elseBranch);
  }

  private parseFnExpr(): Expr {
    this.expect("FN", "Expected 'fn'");

    // Check if this is a named function: fn name(params) => body
    let name: string | undefined;
    if (this.check("IDENT")) {
      name = this.advance().value;
    }

    this.expect("LPAREN", `Expected '(' after 'fn'${name ? ` ${name}` : ""}`);

    const params: string[] = [];
    if (!this.check("RPAREN")) {
      do {
        const param = this.expect("IDENT", "Expected parameter name").value;
        params.push(param);
      } while (this.match("COMMA"));
    }

    this.expect("RPAREN", "Expected ')' after parameters");
    this.expect("ARROW", "Expected '=>' after parameters");
    let body = this.parseExpr();

    // Desugar fn(x, y) => body to fn() => let [x, y] = args in body
    // This unifies the internal representation - all functions use args array
    if (params.length > 0) {
      const pattern = arrayPattern(...params.map(p => varPattern(p)));
      body = letPatternExpr(pattern, varRef("args"), body);
    }

    // Named functions are recursive, anonymous functions are not
    if (name) {
      return recfn(name, [], body);
    }
    return fn([], body);
  }

  // Binary operators with precedence climbing
  private parseOrExpr(): Expr {
    let left = this.parseAndExpr();

    while (this.match("OR")) {
      const right = this.parseAndExpr();
      left = binop("||", left, right);
    }

    return left;
  }

  private parseAndExpr(): Expr {
    let left = this.parseEqExpr();

    while (this.match("AND")) {
      const right = this.parseEqExpr();
      left = binop("&&", left, right);
    }

    return left;
  }

  private parseEqExpr(): Expr {
    let left = this.parseCmpExpr();

    while (true) {
      if (this.match("EQ")) {
        left = binop("==", left, this.parseCmpExpr());
      } else if (this.match("NEQ")) {
        left = binop("!=", left, this.parseCmpExpr());
      } else {
        break;
      }
    }

    return left;
  }

  private parseCmpExpr(): Expr {
    let left = this.parseAddExpr();

    while (true) {
      if (this.match("LT")) {
        left = binop("<", left, this.parseAddExpr());
      } else if (this.match("GT")) {
        left = binop(">", left, this.parseAddExpr());
      } else if (this.match("LTE")) {
        left = binop("<=", left, this.parseAddExpr());
      } else if (this.match("GTE")) {
        left = binop(">=", left, this.parseAddExpr());
      } else {
        break;
      }
    }

    return left;
  }

  private parseAddExpr(): Expr {
    let left = this.parseMulExpr();

    while (true) {
      if (this.match("PLUS")) {
        left = binop("+", left, this.parseMulExpr());
      } else if (this.match("MINUS")) {
        left = binop("-", left, this.parseMulExpr());
      } else {
        break;
      }
    }

    return left;
  }

  private parseMulExpr(): Expr {
    let left = this.parseUnaryExpr();

    while (true) {
      if (this.match("STAR")) {
        left = binop("*", left, this.parseUnaryExpr());
      } else if (this.match("SLASH")) {
        left = binop("/", left, this.parseUnaryExpr());
      } else if (this.match("PERCENT")) {
        left = binop("%", left, this.parseUnaryExpr());
      } else {
        break;
      }
    }

    return left;
  }

  private parseUnaryExpr(): Expr {
    if (this.match("NOT")) {
      return unary("!", this.parseUnaryExpr());
    }
    if (this.match("MINUS")) {
      return unary("-", this.parseUnaryExpr());
    }
    return this.parsePostfixExpr();
  }

  private parsePostfixExpr(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match("LPAREN")) {
        // Function call
        const args: Expr[] = [];
        if (!this.check("RPAREN")) {
          do {
            args.push(this.parseExpr());
          } while (this.match("COMMA"));
        }
        this.expect("RPAREN", "Expected ')' after arguments");
        expr = call(expr, ...args);
      } else if (this.match("DOT")) {
        // Field access or method call
        const name = this.expect("IDENT", "Expected field name after '.'").value;

        // Check if this is a method call (followed by LPAREN)
        if (this.match("LPAREN")) {
          // Method call: receiver.method(args)
          const args: Expr[] = [];
          if (!this.check("RPAREN")) {
            do {
              args.push(this.parseExpr());
            } while (this.match("COMMA"));
          }
          this.expect("RPAREN", "Expected ')' after method arguments");
          expr = methodCall(expr, name, args);
        } else {
          // Plain field access
          expr = field(expr, name);
        }
      } else if (this.match("LBRACKET")) {
        // Index access
        const indexExpr = this.parseExpr();
        this.expect("RBRACKET", "Expected ']' after index");
        expr = index(expr, indexExpr);
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Expr {
    // Literals
    if (this.match("NUMBER")) {
      return lit(parseFloat(this.previous().value));
    }
    if (this.match("STRING")) {
      return lit(this.previous().value);
    }
    if (this.match("TRUE")) {
      return lit(true);
    }
    if (this.match("FALSE")) {
      return lit(false);
    }
    if (this.match("NULL")) {
      return lit(null);
    }

    // Comptime
    if (this.match("COMPTIME")) {
      this.expect("LPAREN", "Expected '(' after 'comptime'");
      const expr = this.parseExpr();
      this.expect("RPAREN", "Expected ')' after comptime expression");
      return comptime(expr);
    }

    // Runtime
    if (this.match("RUNTIME")) {
      this.expect("LPAREN", "Expected '(' after 'runtime'");

      // Check for named runtime: runtime(name: expr)
      let name: string | undefined;
      if (this.check("IDENT") && this.tokens[this.pos + 1]?.type === "COLON") {
        name = this.advance().value;
        this.advance(); // consume colon
      }

      const expr = this.parseExpr();
      this.expect("RPAREN", "Expected ')' after runtime expression");
      return runtime(expr, name);
    }

    // Assert: assert(condition) or assert(expr, type)
    if (this.match("ASSERT")) {
      this.expect("LPAREN", "Expected '(' after 'assert'");
      const first = this.parseExpr();

      if (this.match("COMMA")) {
        // assert(expr, type) - type-based assertion
        const constraint = this.parseExpr();
        this.expect("RPAREN", "Expected ')' after assert expression");
        return assertExpr(first, constraint);
      } else {
        // assert(condition) - condition-based assertion
        this.expect("RPAREN", "Expected ')' after assert condition");
        return assertCondExpr(first);
      }
    }

    // Trust: trust(expr) or trust(expr, type)
    if (this.match("TRUST")) {
      this.expect("LPAREN", "Expected '(' after 'trust'");
      const expr = this.parseExpr();

      if (this.match("COMMA")) {
        // trust(expr, type) - trust with specific type
        const constraint = this.parseExpr();
        this.expect("RPAREN", "Expected ')' after trust expression");
        return trustExpr(expr, constraint);
      } else {
        // trust(expr) - trust without specific type
        this.expect("RPAREN", "Expected ')' after trust expression");
        return trustExpr(expr);
      }
    }

    // TypeOf: typeOf(expr)
    if (this.match("TYPEOF")) {
      this.expect("LPAREN", "Expected '(' after 'typeOf'");
      const expr = this.parseExpr();
      this.expect("RPAREN", "Expected ')' after typeOf expression");
      return typeOfExpr(expr);
    }

    // Identifier
    if (this.match("IDENT")) {
      return varRef(this.previous().value);
    }

    // Parenthesized expression
    if (this.match("LPAREN")) {
      const expr = this.parseExpr();
      this.expect("RPAREN", "Expected ')' after expression");
      return expr;
    }

    // Object literal
    if (this.match("LBRACE")) {
      return this.parseObject();
    }

    // Array literal
    if (this.match("LBRACKET")) {
      return this.parseArray();
    }

    // JSX element
    if (this.isJsxStart()) {
      return this.parseJsx();
    }

    const tok = this.peek();
    throw new ParseError(`Unexpected token '${tok.value}' at line ${tok.line}, column ${tok.column}`);
  }

  private parseObject(): Expr {
    const fields: Record<string, Expr> = {};

    if (!this.check("RBRACE")) {
      do {
        const name = this.expect("IDENT", "Expected field name").value;
        this.expect("COLON", "Expected ':' after field name");
        const value = this.parseExpr();
        fields[name] = value;
      } while (this.match("COMMA"));
    }

    this.expect("RBRACE", "Expected '}' after object fields");
    return obj(fields);
  }

  private parseArray(): Expr {
    const elements: Expr[] = [];

    if (!this.check("RBRACKET")) {
      do {
        elements.push(this.parseExpr());
      } while (this.match("COMMA"));
    }

    this.expect("RBRACKET", "Expected ']' after array elements");
    return array(...elements);
  }

  // ==========================================================================
  // JSX Parsing
  // ==========================================================================

  /**
   * Check if we're looking at a JSX element: < followed by identifier or /
   */
  private isJsxStart(): boolean {
    if (!this.check("LT")) return false;
    const next = this.tokens[this.pos + 1];
    return next && (next.type === "IDENT" || next.type === "SLASH");
  }

  /**
   * Parse a JSX element and desugar to jsx()/jsxs() calls.
   * <Tag attr={value}>children</Tag>  ->  jsx(Tag, { attr: value, children: ... })
   * <Tag />                            ->  jsx(Tag, {})
   */
  private parseJsx(): Expr {
    this.expect("LT", "Expected '<' at start of JSX element");

    // Get the tag name (could be lowercase string like "div" or component like "MyComp")
    const tagToken = this.expect("IDENT", "Expected tag name after '<'");
    const tagName = tagToken.value;

    // Tag expression: string literal for lowercase, variable ref for uppercase
    const tagExpr = this.isComponentTag(tagName) ? varRef(tagName) : lit(tagName);

    // Parse attributes
    const props: { name: string; value: Expr }[] = [];
    while (!this.check("GT") && !this.check("SLASH") && !this.isAtEnd()) {
      const attrName = this.expect("IDENT", "Expected attribute name").value;

      if (this.match("ASSIGN")) {
        // attr={expr} or attr="string"
        if (this.match("LBRACE")) {
          const value = this.parseExpr();
          this.expect("RBRACE", "Expected '}' after JSX attribute expression");
          props.push({ name: attrName, value });
        } else if (this.check("STRING")) {
          const value = lit(this.advance().value);
          props.push({ name: attrName, value });
        } else {
          throw new ParseError(`Expected expression or string for attribute '${attrName}'`);
        }
      } else {
        // Boolean attribute: <input disabled />
        props.push({ name: attrName, value: lit(true) });
      }
    }

    // Self-closing tag: <Tag />
    if (this.match("SLASH")) {
      this.expect("GT", "Expected '>' after '/>'");
      return this.buildJsxCall(tagExpr, props, []);
    }

    // Opening tag close: >
    this.expect("GT", "Expected '>' or '/>' after attributes");

    // Parse children
    const children = this.parseJsxChildren(tagName);

    return this.buildJsxCall(tagExpr, props, children);
  }

  /**
   * Check if tag name is a component (starts with uppercase)
   */
  private isComponentTag(name: string): boolean {
    return name.length > 0 && name[0] === name[0].toUpperCase();
  }

  /**
   * Parse JSX children until we hit the closing tag.
   * Children can be: text, {expressions}, or nested JSX elements
   */
  private parseJsxChildren(parentTag: string): Expr[] {
    const children: Expr[] = [];

    while (!this.isAtEnd()) {
      // Check for closing tag
      if (this.check("LT") && this.tokens[this.pos + 1]?.type === "SLASH") {
        // Closing tag: </Tag>
        this.advance(); // <
        this.advance(); // /
        const closeTag = this.expect("IDENT", "Expected closing tag name").value;
        if (closeTag !== parentTag) {
          throw new ParseError(`Mismatched closing tag: expected </${parentTag}> but got </${closeTag}>`);
        }
        this.expect("GT", "Expected '>' after closing tag");
        break;
      }

      // Expression: {expr}
      if (this.match("LBRACE")) {
        const expr = this.parseExpr();
        this.expect("RBRACE", "Expected '}' after JSX expression");
        children.push(expr);
        continue;
      }

      // Nested JSX element
      if (this.isJsxStart()) {
        children.push(this.parseJsx());
        continue;
      }

      // Text content - read until we hit <, {, or special tokens
      const textContent = this.parseJsxText();
      if (textContent) {
        children.push(lit(textContent));
      }
    }

    return children;
  }

  /**
   * Parse text content between JSX elements.
   * We look at tokens and reconstruct text, handling identifiers and other tokens as text.
   */
  private parseJsxText(): string | null {
    // Collect text tokens until we hit something that starts new content
    let text = "";
    let lastWasWord = false;

    // Token types that can appear as text in JSX
    const textTokenTypes: TokenType[] = [
      "IDENT", "NUMBER", "STRING",
      // Punctuation
      "COLON", "DOT", "COMMA", "PLUS", "MINUS", "STAR",
      "SLASH", "LPAREN", "RPAREN", "LBRACKET", "RBRACKET",
      "EQ", "NOT", "AND", "OR", "SEMICOLON", "PERCENT",
      "NEQ", "LTE", "GTE", "ASSIGN", "ARROW", "GT",
      // Keywords (can appear in text)
      "LET", "IN", "IF", "THEN", "ELSE", "FN", "TRUE", "FALSE",
      "NULL", "COMPTIME", "RUNTIME", "ASSERT", "TRUST",
      "IMPORT", "FROM", "TYPEOF",
    ];

    const isWordToken = (type: TokenType) =>
      type === "IDENT" || type === "NUMBER" || type === "STRING" ||
      type === "LET" || type === "IN" || type === "IF" ||
      type === "THEN" || type === "ELSE" || type === "FN" ||
      type === "TRUE" || type === "FALSE" || type === "NULL" ||
      type === "COMPTIME" || type === "RUNTIME" || type === "ASSERT" ||
      type === "TRUST" || type === "IMPORT" || type === "FROM" ||
      type === "TYPEOF";

    while (!this.isAtEnd() &&
           !this.check("LT") &&
           !this.check("LBRACE") &&
           !this.check("RBRACE")) {
      const tok = this.peek();

      if (textTokenTypes.includes(tok.type)) {
        const isWord = isWordToken(tok.type);
        // Add space between words, but not around punctuation
        const needsSpace = lastWasWord && isWord;
        text += (needsSpace ? " " : "") + tok.value;
        lastWasWord = isWord;
        this.advance();
      } else {
        // Stop at unrecognized tokens
        break;
      }
    }

    return text.trim() || null;
  }

  /**
   * Build the jsx() or jsxs() call expression.
   * - No children: jsx(tag, { ...props })
   * - One child: jsx(tag, { ...props, children: child })
   * - Multiple children: jsxs(tag, { ...props, children: [child1, child2, ...] })
   */
  private buildJsxCall(tagExpr: Expr, props: { name: string; value: Expr }[], children: Expr[]): Expr {
    // Build props object
    const propsFields: Record<string, Expr> = {};
    for (const { name, value } of props) {
      propsFields[name] = value;
    }

    // Add children if any
    if (children.length === 1) {
      propsFields["children"] = children[0];
    } else if (children.length > 1) {
      propsFields["children"] = array(...children);
    }

    const propsExpr = obj(propsFields);

    // Choose jsx vs jsxs based on children count
    const funcName = children.length > 1 ? "jsxs" : "jsx";
    return call(varRef(funcName), tagExpr, propsExpr);
  }
}

// ============================================================================
// Errors
// ============================================================================

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parse a source string into an expression.
 */
export function parse(source: string): Expr {
  const tokens = tokenize(source);
  return new Parser(tokens, source).parse();
}

import { run } from "./staged-evaluate";
import { compile } from "./codegen";
import { EvalResult } from "./builtins";

/**
 * Parse and evaluate a source string.
 */
export function parseAndRun(source: string): EvalResult {
  const expr = parse(source);
  return run(expr);
}

/**
 * Parse, stage, and compile a source string to JavaScript.
 */
export function parseAndCompile(source: string): string {
  const expr = parse(source);
  return compile(expr);
}
