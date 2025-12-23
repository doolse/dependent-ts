/**
 * Parser - Recursive descent parser for the expression language.
 *
 * Grammar (in rough precedence order, lowest to highest):
 *
 * expr       = letExpr | ifExpr | fnExpr | orExpr
 * letExpr    = "let" IDENT "=" expr "in" expr
 * ifExpr     = "if" expr "then" expr "else" expr
 * fnExpr     = "fn" "(" params? ")" "=>" expr
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

import { Token, TokenType, tokenize, LexerError } from "./lexer";
import {
  Expr,
  lit,
  varRef,
  binop,
  unary,
  ifExpr,
  letExpr,
  fn,
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
  BinOp,
  UnaryOp,
} from "./expr";

// ============================================================================
// Parser Class
// ============================================================================

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
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
    // Check for let, if, fn first
    if (this.check("LET")) return this.parseLetExpr();
    if (this.check("IF")) return this.parseIfExpr();
    if (this.check("FN")) return this.parseFnExpr();

    return this.parseOrExpr();
  }

  private parseLetExpr(): Expr {
    this.expect("LET", "Expected 'let'");
    const name = this.expect("IDENT", "Expected identifier after 'let'").value;
    this.expect("ASSIGN", "Expected '=' after identifier in let binding");
    const value = this.parseExpr();
    this.expect("IN", "Expected 'in' after let value");
    const body = this.parseExpr();
    return letExpr(name, value, body);
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
    this.expect("LPAREN", "Expected '(' after 'fn'");

    const params: string[] = [];
    if (!this.check("RPAREN")) {
      do {
        const param = this.expect("IDENT", "Expected parameter name").value;
        params.push(param);
      } while (this.match("COMMA"));
    }

    this.expect("RPAREN", "Expected ')' after parameters");
    this.expect("ARROW", "Expected '=>' after parameters");
    const body = this.parseExpr();

    return fn(params, body);
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
        // Field access
        const name = this.expect("IDENT", "Expected field name after '.'").value;
        expr = field(expr, name);
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
  return new Parser(tokens).parse();
}

import { run } from "./evaluate";
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
