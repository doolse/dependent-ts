/**
 * Tests for the lexer and parser.
 */
import { describe, it, expect } from "vitest";

import {
  tokenize,
  parse,
  parseAndRun,
  parseAndCompile,
  LexerError,
  ParseError,
  exprToString,
} from "../src/index";

function evalTo(source: string): unknown {
  const result = parseAndRun(source);
  const v = result.value;
  switch (v.tag) {
    case "number":
      return v.value;
    case "string":
      return v.value;
    case "bool":
      return v.value;
    case "null":
      return null;
    default:
      return v;
  }
}

describe("Lexer Tests", () => {
  it("tokenizes numbers", () => {
    const tokens = tokenize("42 3.14 0");
    expect(tokens[0].type).toBe("NUMBER");
    expect(tokens[0].value).toBe("42");
    expect(tokens[1].type).toBe("NUMBER");
    expect(tokens[1].value).toBe("3.14");
    expect(tokens[2].type).toBe("NUMBER");
    expect(tokens[2].value).toBe("0");
  });

  it("tokenizes strings", () => {
    const tokens = tokenize('"hello" "world"');
    expect(tokens[0].type).toBe("STRING");
    expect(tokens[0].value).toBe("hello");
    expect(tokens[1].type).toBe("STRING");
    expect(tokens[1].value).toBe("world");
  });

  it("tokenizes string escapes", () => {
    const tokens = tokenize('"hello\\nworld" "tab\\there"');
    expect(tokens[0].value).toBe("hello\nworld");
    expect(tokens[1].value).toBe("tab\there");
  });

  it("tokenizes keywords", () => {
    const tokens = tokenize(
      "let in if then else fn true false null comptime runtime"
    );
    expect(tokens[0].type).toBe("LET");
    expect(tokens[1].type).toBe("IN");
    expect(tokens[2].type).toBe("IF");
    expect(tokens[3].type).toBe("THEN");
    expect(tokens[4].type).toBe("ELSE");
    expect(tokens[5].type).toBe("FN");
    expect(tokens[6].type).toBe("TRUE");
    expect(tokens[7].type).toBe("FALSE");
    expect(tokens[8].type).toBe("NULL");
    expect(tokens[9].type).toBe("COMPTIME");
    expect(tokens[10].type).toBe("RUNTIME");
  });

  it("tokenizes identifiers", () => {
    const tokens = tokenize("foo bar_baz x1 _private");
    expect(tokens[0].type).toBe("IDENT");
    expect(tokens[0].value).toBe("foo");
    expect(tokens[1].value).toBe("bar_baz");
    expect(tokens[2].value).toBe("x1");
    expect(tokens[3].value).toBe("_private");
  });

  it("tokenizes operators", () => {
    const tokens = tokenize("+ - * / % == != < > <= >= && || !");
    expect(tokens[0].type).toBe("PLUS");
    expect(tokens[1].type).toBe("MINUS");
    expect(tokens[2].type).toBe("STAR");
    expect(tokens[3].type).toBe("SLASH");
    expect(tokens[4].type).toBe("PERCENT");
    expect(tokens[5].type).toBe("EQ");
    expect(tokens[6].type).toBe("NEQ");
    expect(tokens[7].type).toBe("LT");
    expect(tokens[8].type).toBe("GT");
    expect(tokens[9].type).toBe("LTE");
    expect(tokens[10].type).toBe("GTE");
    expect(tokens[11].type).toBe("AND");
    expect(tokens[12].type).toBe("OR");
    expect(tokens[13].type).toBe("NOT");
  });

  it("tokenizes punctuation", () => {
    const tokens = tokenize("( ) { } [ ] , : . => =");
    expect(tokens[0].type).toBe("LPAREN");
    expect(tokens[1].type).toBe("RPAREN");
    expect(tokens[2].type).toBe("LBRACE");
    expect(tokens[3].type).toBe("RBRACE");
    expect(tokens[4].type).toBe("LBRACKET");
    expect(tokens[5].type).toBe("RBRACKET");
    expect(tokens[6].type).toBe("COMMA");
    expect(tokens[7].type).toBe("COLON");
    expect(tokens[8].type).toBe("DOT");
    expect(tokens[9].type).toBe("ARROW");
    expect(tokens[10].type).toBe("ASSIGN");
  });

  it("skips comments", () => {
    const tokens = tokenize("1 // this is a comment\n2");
    expect(tokens[0].type).toBe("NUMBER");
    expect(tokens[0].value).toBe("1");
    expect(tokens[1].type).toBe("NUMBER");
    expect(tokens[1].value).toBe("2");
  });

  it("tracks line and column", () => {
    const tokens = tokenize("a\nb c");
    expect(tokens[0].line).toBe(1);
    expect(tokens[0].column).toBe(1);
    expect(tokens[1].line).toBe(2);
    expect(tokens[1].column).toBe(1);
    expect(tokens[2].line).toBe(2);
    expect(tokens[2].column).toBe(3);
  });
});

describe("Parser Tests - Literals", () => {
  it("parses number", () => {
    expect(evalTo("42")).toBe(42);
    expect(evalTo("3.14")).toBe(3.14);
    expect(evalTo("0")).toBe(0);
  });

  it("parses string", () => {
    expect(evalTo('"hello"')).toBe("hello");
    expect(evalTo('""')).toBe("");
  });

  it("parses boolean", () => {
    expect(evalTo("true")).toBe(true);
    expect(evalTo("false")).toBe(false);
  });

  it("parses null", () => {
    expect(evalTo("null")).toBe(null);
  });
});

describe("Parser Tests - Arithmetic", () => {
  it("parses addition", () => {
    expect(evalTo("1 + 2")).toBe(3);
    expect(evalTo("1 + 2 + 3")).toBe(6);
  });

  it("parses subtraction", () => {
    expect(evalTo("5 - 3")).toBe(2);
    expect(evalTo("10 - 3 - 2")).toBe(5);
  });

  it("parses multiplication", () => {
    expect(evalTo("4 * 5")).toBe(20);
  });

  it("parses division", () => {
    expect(evalTo("10 / 2")).toBe(5);
  });

  it("parses modulo", () => {
    expect(evalTo("7 % 3")).toBe(1);
  });

  it("respects precedence (* before +)", () => {
    expect(evalTo("1 + 2 * 3")).toBe(7);
    expect(evalTo("2 * 3 + 1")).toBe(7);
  });

  it("respects parentheses", () => {
    expect(evalTo("(1 + 2) * 3")).toBe(9);
  });

  it("parses unary minus", () => {
    expect(evalTo("-5")).toBe(-5);
    expect(evalTo("--5")).toBe(5);
    expect(evalTo("1 + -2")).toBe(-1);
  });
});

describe("Parser Tests - Comparison", () => {
  it("parses equality", () => {
    expect(evalTo("1 == 1")).toBe(true);
    expect(evalTo("1 == 2")).toBe(false);
    expect(evalTo("1 != 2")).toBe(true);
    expect(evalTo("1 != 1")).toBe(false);
  });

  it("parses relational", () => {
    expect(evalTo("1 < 2")).toBe(true);
    expect(evalTo("2 < 1")).toBe(false);
    expect(evalTo("2 > 1")).toBe(true);
    expect(evalTo("1 <= 1")).toBe(true);
    expect(evalTo("1 >= 1")).toBe(true);
  });
});

describe("Parser Tests - Logical", () => {
  it("parses and", () => {
    expect(evalTo("true && true")).toBe(true);
    expect(evalTo("true && false")).toBe(false);
  });

  it("parses or", () => {
    expect(evalTo("false || true")).toBe(true);
    expect(evalTo("false || false")).toBe(false);
  });

  it("parses not", () => {
    expect(evalTo("!true")).toBe(false);
    expect(evalTo("!false")).toBe(true);
    expect(evalTo("!!true")).toBe(true);
  });

  it("respects logical precedence", () => {
    expect(evalTo("true || false && false")).toBe(true);
    expect(evalTo("false && true || true")).toBe(true);
  });
});

describe("Parser Tests - Let", () => {
  it("parses let binding", () => {
    expect(evalTo("let x = 5 in x")).toBe(5);
    expect(evalTo("let x = 5 in x + 1")).toBe(6);
  });

  it("parses nested let", () => {
    expect(evalTo("let x = 5 in let y = 3 in x + y")).toBe(8);
  });

  it("let shadows outer binding", () => {
    expect(evalTo("let x = 5 in let x = 10 in x")).toBe(10);
  });
});

describe("Parser Tests - If", () => {
  it("parses if expression", () => {
    expect(evalTo("if true then 1 else 2")).toBe(1);
    expect(evalTo("if false then 1 else 2")).toBe(2);
  });

  it("parses nested if", () => {
    expect(evalTo("if true then if false then 1 else 2 else 3")).toBe(2);
  });

  it("if with complex condition", () => {
    expect(evalTo("if 1 < 2 then 10 else 20")).toBe(10);
  });
});

describe("Parser Tests - Functions", () => {
  it("parses function definition", () => {
    const result = parseAndRun("fn(x) => x");
    expect(result.value.tag).toBe("closure");
  });

  it("parses function call", () => {
    expect(evalTo("(fn(x) => x + 1)(5)")).toBe(6);
  });

  it("parses multi-arg function", () => {
    expect(evalTo("(fn(x, y) => x + y)(3, 4)")).toBe(7);
  });

  it("parses no-arg function", () => {
    expect(evalTo("(fn() => 42)()")).toBe(42);
  });

  it("parses higher-order function", () => {
    expect(evalTo("let f = fn(x) => fn(y) => x + y in f(3)(4)")).toBe(7);
  });
});

describe("Parser Tests - Objects", () => {
  it("parses empty object", () => {
    const result = parseAndRun("{}");
    expect(result.value.tag).toBe("object");
  });

  it("parses object literal", () => {
    expect(evalTo("{ x: 1, y: 2 }.x")).toBe(1);
    expect(evalTo("{ x: 1, y: 2 }.y")).toBe(2);
  });

  it("parses nested field access", () => {
    expect(evalTo("{ inner: { x: 42 } }.inner.x")).toBe(42);
  });
});

describe("Parser Tests - Arrays", () => {
  it("parses empty array", () => {
    const result = parseAndRun("[]");
    expect(result.value.tag).toBe("array");
  });

  it("parses array literal", () => {
    expect(evalTo("[1, 2, 3][0]")).toBe(1);
    expect(evalTo("[1, 2, 3][1]")).toBe(2);
    expect(evalTo("[1, 2, 3][2]")).toBe(3);
  });

  it("parses array with expressions", () => {
    expect(evalTo("[1 + 1, 2 + 2][0]")).toBe(2);
  });
});

describe("Parser Tests - Staging", () => {
  it("parses comptime", () => {
    expect(evalTo("comptime(2 + 3)")).toBe(5);
  });

  it("parses runtime", () => {
    // runtime() creates a Later value, so we just test parsing
    const expr = parse("runtime(42)");
    expect(expr.tag).toBe("runtime");
  });

  it("parses named runtime", () => {
    // runtime() with name creates a Later value, so we just test parsing
    const expr = parse("runtime(x: 42)");
    expect(expr.tag).toBe("runtime");
    expect((expr as any).name).toBe("x");
  });
});

describe("Parser Tests - Complex Expressions", () => {
  it("complex arithmetic", () => {
    expect(evalTo("(1 + 2) * (3 + 4) / 7")).toBe(3);
  });

  it("let with function", () => {
    expect(evalTo("let double = fn(x) => x * 2 in double(21)")).toBe(42);
  });

  it("function returning object", () => {
    expect(evalTo("(fn(x) => { value: x })(42).value")).toBe(42);
  });

  it("conditional in function", () => {
    expect(evalTo("let abs = fn(x) => if x < 0 then -x else x in abs(-5)")).toBe(
      5
    );
  });

  it("array in let binding", () => {
    expect(evalTo("let arr = [10, 20, 30] in arr[1]")).toBe(20);
  });
});

describe("Compilation Tests", () => {
  it("compiles simple expression", () => {
    const code = parseAndCompile("1 + 2");
    expect(code).toBe("3");
  });

  it("compiles let binding", () => {
    const code = parseAndCompile("let x = 5 in x * 2");
    expect(code).toBe("10");
  });

  it("compiles with runtime values", () => {
    const code = parseAndCompile("runtime(x: 5) + 3");
    expect(code.includes("x")).toBe(true);
    expect(code.includes("3")).toBe(true);
  });
});

describe("Error Tests", () => {
  it("lexer error on unknown character", () => {
    expect(() => tokenize("@")).toThrow(LexerError);
  });

  it("parse error on incomplete expression", () => {
    expect(() => parse("1 +")).toThrow(ParseError);
  });

  it("parse error on missing then", () => {
    expect(() => parse("if true 1 else 2")).toThrow(ParseError);
  });

  it("parse error on missing in", () => {
    expect(() => parse("let x = 5 x")).toThrow(ParseError);
  });
});

// ============================================================================
// Unimplemented Syntax Edge Cases
// ============================================================================

describe("Unimplemented Syntax", () => {
  it("spread operator in arrays is not supported", () => {
    expect(() => parse("[1, ...arr, 2]")).toThrow();
  });

  it("match expression is not in the parser", () => {
    expect(() => parse("match x with | 1 => true | _ => false")).toThrow();
  });

  it("type annotations in function syntax not supported", () => {
    expect(() => parse("fn(x: number) => x + 1")).toThrow();
  });
});
