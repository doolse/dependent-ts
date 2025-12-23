/**
 * Lexer - Tokenizes source code into tokens.
 */

// ============================================================================
// Token Types
// ============================================================================

export type TokenType =
  // Literals
  | "NUMBER"
  | "STRING"
  | "TRUE"
  | "FALSE"
  | "NULL"
  // Identifiers
  | "IDENT"
  // Keywords
  | "LET"
  | "IN"
  | "IF"
  | "THEN"
  | "ELSE"
  | "FN"
  | "COMPTIME"
  | "RUNTIME"
  // Operators
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "EQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  | "AND"
  | "OR"
  | "NOT"
  // Assignment
  | "ASSIGN"
  // Punctuation
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  | "COLON"
  | "DOT"
  | "ARROW"
  | "SEMICOLON"
  // Special
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

// ============================================================================
// Keywords
// ============================================================================

const KEYWORDS: Record<string, TokenType> = {
  let: "LET",
  in: "IN",
  if: "IF",
  then: "THEN",
  else: "ELSE",
  fn: "FN",
  true: "TRUE",
  false: "FALSE",
  null: "NULL",
  comptime: "COMPTIME",
  runtime: "RUNTIME",
};

// ============================================================================
// Lexer Class
// ============================================================================

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;

      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    tokens.push(this.makeToken("EOF", ""));
    return tokens;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private peek(): string {
    return this.source[this.pos] ?? "";
  }

  private peekNext(): string {
    return this.source[this.pos + 1] ?? "";
  }

  private advance(): string {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private makeToken(type: TokenType, value: string): Token {
    return { type, value, line: this.line, column: this.column - value.length };
  }

  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
      } else if (ch === "/" && this.peekNext() === "/") {
        // Single-line comment
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private nextToken(): Token | null {
    const ch = this.peek();

    // Numbers
    if (this.isDigit(ch)) {
      return this.readNumber();
    }

    // Strings
    if (ch === '"') {
      return this.readString();
    }

    // Identifiers and keywords
    if (this.isAlpha(ch)) {
      return this.readIdentifier();
    }

    // Operators and punctuation
    return this.readOperator();
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  private readNumber(): Token {
    const startCol = this.column;
    let value = "";

    // Integer part
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }

    // Decimal part
    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      value += this.advance(); // consume '.'
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    return { type: "NUMBER", value, line: this.line, column: startCol };
  }

  private readString(): Token {
    const startCol = this.column;
    let value = "";

    this.advance(); // consume opening "

    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === "\\") {
        this.advance(); // consume backslash
        const escaped = this.advance();
        switch (escaped) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          default: value += escaped;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      throw new LexerError(`Unterminated string at line ${this.line}, column ${startCol}`);
    }

    this.advance(); // consume closing "

    return { type: "STRING", value, line: this.line, column: startCol };
  }

  private readIdentifier(): Token {
    const startCol = this.column;
    let value = "";

    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
      value += this.advance();
    }

    const type = KEYWORDS[value] ?? "IDENT";
    return { type, value, line: this.line, column: startCol };
  }

  private readOperator(): Token {
    const ch = this.advance();
    const startCol = this.column - 1;

    switch (ch) {
      case "+": return { type: "PLUS", value: "+", line: this.line, column: startCol };
      case "-": return { type: "MINUS", value: "-", line: this.line, column: startCol };
      case "*": return { type: "STAR", value: "*", line: this.line, column: startCol };
      case "/": return { type: "SLASH", value: "/", line: this.line, column: startCol };
      case "%": return { type: "PERCENT", value: "%", line: this.line, column: startCol };

      case "(": return { type: "LPAREN", value: "(", line: this.line, column: startCol };
      case ")": return { type: "RPAREN", value: ")", line: this.line, column: startCol };
      case "{": return { type: "LBRACE", value: "{", line: this.line, column: startCol };
      case "}": return { type: "RBRACE", value: "}", line: this.line, column: startCol };
      case "[": return { type: "LBRACKET", value: "[", line: this.line, column: startCol };
      case "]": return { type: "RBRACKET", value: "]", line: this.line, column: startCol };

      case ",": return { type: "COMMA", value: ",", line: this.line, column: startCol };
      case ":": return { type: "COLON", value: ":", line: this.line, column: startCol };
      case ".": return { type: "DOT", value: ".", line: this.line, column: startCol };
      case ";": return { type: "SEMICOLON", value: ";", line: this.line, column: startCol };

      case "=":
        if (this.peek() === "=") {
          this.advance();
          return { type: "EQ", value: "==", line: this.line, column: startCol };
        }
        if (this.peek() === ">") {
          this.advance();
          return { type: "ARROW", value: "=>", line: this.line, column: startCol };
        }
        return { type: "ASSIGN", value: "=", line: this.line, column: startCol };

      case "!":
        if (this.peek() === "=") {
          this.advance();
          return { type: "NEQ", value: "!=", line: this.line, column: startCol };
        }
        return { type: "NOT", value: "!", line: this.line, column: startCol };

      case "<":
        if (this.peek() === "=") {
          this.advance();
          return { type: "LTE", value: "<=", line: this.line, column: startCol };
        }
        return { type: "LT", value: "<", line: this.line, column: startCol };

      case ">":
        if (this.peek() === "=") {
          this.advance();
          return { type: "GTE", value: ">=", line: this.line, column: startCol };
        }
        return { type: "GT", value: ">", line: this.line, column: startCol };

      case "&":
        if (this.peek() === "&") {
          this.advance();
          return { type: "AND", value: "&&", line: this.line, column: startCol };
        }
        throw new LexerError(`Unexpected character '&' at line ${this.line}, column ${startCol}. Did you mean '&&'?`);

      case "|":
        if (this.peek() === "|") {
          this.advance();
          return { type: "OR", value: "||", line: this.line, column: startCol };
        }
        throw new LexerError(`Unexpected character '|' at line ${this.line}, column ${startCol}. Did you mean '||'?`);

      default:
        throw new LexerError(`Unexpected character '${ch}' at line ${this.line}, column ${startCol}`);
    }
  }
}

// ============================================================================
// Errors
// ============================================================================

export class LexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LexerError";
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
