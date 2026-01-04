/**
 * Tests for the Lezer-based TypeScript/JSX parser.
 */

import { describe, it, expect } from "vitest";
import { parseTS, parseTSExpr, parseTSType, TSParseError } from "@dependent-ts/core";
import { exprToString } from "@dependent-ts/core";
import { constraintToString, implies, isNumber, isString, isBool, isNull, or, and, hasField, isObject, isArray, elements, equals } from "@dependent-ts/core";

describe("parseTSExpr - Literals", () => {
  it("parses number literals", () => {
    expect(exprToString(parseTSExpr("42"))).toBe("42");
    expect(exprToString(parseTSExpr("3.14"))).toBe("3.14");
    expect(exprToString(parseTSExpr("-5"))).toBe("-5");
  });

  it("parses string literals", () => {
    expect(exprToString(parseTSExpr('"hello"'))).toBe('"hello"');
    expect(exprToString(parseTSExpr("'world'"))).toBe('"world"');
  });

  it("parses boolean literals", () => {
    expect(exprToString(parseTSExpr("true"))).toBe("true");
    expect(exprToString(parseTSExpr("false"))).toBe("false");
  });

  it("parses null", () => {
    expect(exprToString(parseTSExpr("null"))).toBe("null");
  });
});

describe("parseTSExpr - Operators", () => {
  it("parses arithmetic operators", () => {
    expect(exprToString(parseTSExpr("1 + 2"))).toBe("(1 + 2)");
    expect(exprToString(parseTSExpr("5 - 3"))).toBe("(5 - 3)");
    expect(exprToString(parseTSExpr("2 * 4"))).toBe("(2 * 4)");
    expect(exprToString(parseTSExpr("10 / 2"))).toBe("(10 / 2)");
    expect(exprToString(parseTSExpr("7 % 3"))).toBe("(7 % 3)");
  });

  it("parses comparison operators", () => {
    expect(exprToString(parseTSExpr("1 < 2"))).toBe("(1 < 2)");
    expect(exprToString(parseTSExpr("1 > 2"))).toBe("(1 > 2)");
    expect(exprToString(parseTSExpr("1 <= 2"))).toBe("(1 <= 2)");
    expect(exprToString(parseTSExpr("1 >= 2"))).toBe("(1 >= 2)");
    expect(exprToString(parseTSExpr("1 === 2"))).toBe("(1 == 2)");
    expect(exprToString(parseTSExpr("1 !== 2"))).toBe("(1 != 2)");
  });

  it("parses logical operators", () => {
    expect(exprToString(parseTSExpr("true && false"))).toBe("(true && false)");
    expect(exprToString(parseTSExpr("true || false"))).toBe("(true || false)");
    expect(exprToString(parseTSExpr("!true"))).toBe("!true");
  });

  it("parses unary minus", () => {
    expect(exprToString(parseTSExpr("-x"))).toBe("-x");
  });

  it("handles operator precedence", () => {
    expect(exprToString(parseTSExpr("1 + 2 * 3"))).toBe("(1 + (2 * 3))");
    expect(exprToString(parseTSExpr("(1 + 2) * 3"))).toBe("((1 + 2) * 3)");
  });
});

describe("parseTSExpr - Variables and References", () => {
  it("parses variable references", () => {
    expect(exprToString(parseTSExpr("x"))).toBe("x");
    expect(exprToString(parseTSExpr("myVar"))).toBe("myVar");
  });
});

describe("parseTSExpr - Functions", () => {
  it("parses arrow functions with single parameter", () => {
    const expr = parseTSExpr("x => x + 1");
    expect(exprToString(expr)).toContain("fn");
    expect(exprToString(expr)).toContain("x");
  });

  it("parses arrow functions with multiple parameters", () => {
    const expr = parseTSExpr("(x, y) => x + y");
    expect(exprToString(expr)).toContain("fn");
  });

  it("parses arrow functions with no parameters", () => {
    const expr = parseTSExpr("() => 42");
    expect(exprToString(expr)).toContain("fn");
    expect(exprToString(expr)).toContain("42");
  });
});

describe("parseTSExpr - Ternary/Conditional", () => {
  it("parses ternary expressions", () => {
    const expr = parseTSExpr("x ? 1 : 2");
    expect(exprToString(expr)).toBe("if x then 1 else 2");
  });

  it("parses nested ternary expressions", () => {
    const expr = parseTSExpr("a ? 1 : b ? 2 : 3");
    expect(exprToString(expr)).toContain("if a then 1 else");
  });
});

describe("parseTSExpr - Objects", () => {
  it("parses empty object", () => {
    expect(exprToString(parseTSExpr("{}"))).toBe("{  }");
  });

  it("parses object with properties", () => {
    const expr = parseTSExpr("{ x: 1, y: 2 }");
    expect(exprToString(expr)).toContain("x: 1");
    expect(exprToString(expr)).toContain("y: 2");
  });

  it("parses shorthand properties", () => {
    const expr = parseTSExpr("{ x, y }");
    expect(exprToString(expr)).toContain("x: x");
    expect(exprToString(expr)).toContain("y: y");
  });
});

describe("parseTSExpr - Arrays", () => {
  it("parses empty array", () => {
    expect(exprToString(parseTSExpr("[]"))).toBe("[]");
  });

  it("parses array with elements", () => {
    expect(exprToString(parseTSExpr("[1, 2, 3]"))).toBe("[1, 2, 3]");
  });
});

describe("parseTSExpr - Member Access", () => {
  it("parses property access", () => {
    expect(exprToString(parseTSExpr("obj.prop"))).toBe("obj.prop");
  });

  it("parses index access", () => {
    expect(exprToString(parseTSExpr("arr[0]"))).toBe("arr[0]");
  });

  it("parses chained access", () => {
    expect(exprToString(parseTSExpr("obj.arr[0].name"))).toBe("obj.arr[0].name");
  });
});

describe("parseTSExpr - Function Calls", () => {
  it("parses function call with no args", () => {
    expect(exprToString(parseTSExpr("foo()"))).toBe("foo()");
  });

  it("parses function call with args", () => {
    expect(exprToString(parseTSExpr("foo(1, 2)"))).toBe("foo(1, 2)");
  });

  it("parses method calls", () => {
    const expr = parseTSExpr('str.startsWith("hello")');
    expect(exprToString(expr)).toBe('str.startsWith("hello")');
  });
});

describe("parseTS - Statement Conversion", () => {
  it("converts const to let-in", () => {
    const expr = parseTS("const x = 5; x + 1");
    expect(exprToString(expr)).toContain("let x = 5 in");
    expect(exprToString(expr)).toContain("(x + 1)");
  });

  it("converts multiple declarations", () => {
    const expr = parseTS("const x = 1; const y = 2; x + y");
    expect(exprToString(expr)).toContain("let x = 1 in");
    expect(exprToString(expr)).toContain("let y = 2 in");
  });

  it("handles array destructuring", () => {
    const expr = parseTS("const [a, b] = arr; a + b");
    expect(exprToString(expr)).toContain("let [a, b] = arr in");
  });

  it("handles object destructuring", () => {
    const expr = parseTS("const { x, y } = obj; x + y");
    expect(exprToString(expr)).toContain("let { x, y } = obj in");
  });

  it("handles return statements", () => {
    const expr = parseTS("const x = 5; return x * 2");
    expect(exprToString(expr)).toContain("let x = 5 in");
    expect(exprToString(expr)).toContain("(x * 2)");
  });
});

describe("parseTSType - Type Parsing", () => {
  it("parses primitive types", () => {
    // constraintToString returns user-friendly names
    expect(constraintToString(parseTSType("number"))).toBe("number");
    expect(constraintToString(parseTSType("string"))).toBe("string");
    expect(constraintToString(parseTSType("boolean"))).toBe("boolean");
    expect(constraintToString(parseTSType("null"))).toBe("null");
    expect(constraintToString(parseTSType("undefined"))).toBe("undefined");
    // Check the actual constraint tags
    expect(parseTSType("number").tag).toBe("isNumber");
    expect(parseTSType("string").tag).toBe("isString");
    expect(parseTSType("boolean").tag).toBe("isBool");
  });

  it("parses union types", () => {
    const c = parseTSType("number | string");
    expect(c.tag).toBe("or");
    expect(implies(isNumber, c)).toBe(true);
    expect(implies(isString, c)).toBe(true);
  });

  it("parses intersection types", () => {
    const c = parseTSType("{ x: number } & { y: string }");
    expect(c.tag).toBe("and");
  });

  it("parses array types", () => {
    const c = parseTSType("number[]");
    expect(implies(c, isArray)).toBe(true);
  });

  it("parses object types", () => {
    const c = parseTSType("{ x: number }");
    expect(implies(c, isObject)).toBe(true);
  });
});

describe("parseTSExpr - JSX", () => {
  it("parses self-closing JSX element", () => {
    const expr = parseTSExpr("<div />");
    expect(exprToString(expr)).toContain("jsx");
    expect(exprToString(expr)).toContain('"div"');
  });

  it("parses JSX element with children", () => {
    const expr = parseTSExpr("<div>Hello</div>");
    expect(exprToString(expr)).toContain("jsx");
    expect(exprToString(expr)).toContain('"div"');
  });

  it("parses JSX with attributes", () => {
    const expr = parseTSExpr('<div className="test" />');
    expect(exprToString(expr)).toContain("className");
    expect(exprToString(expr)).toContain('"test"');
  });

  it("parses JSX with expression attributes", () => {
    const expr = parseTSExpr("<div value={x} />");
    expect(exprToString(expr)).toContain("value: x");
  });

  it("parses component JSX (uppercase)", () => {
    const expr = parseTSExpr("<MyComponent />");
    expect(exprToString(expr)).toContain("jsx(MyComponent");
  });

  it("parses nested JSX", () => {
    const expr = parseTSExpr("<div><span>text</span></div>");
    expect(exprToString(expr)).toContain("jsx");
  });
});

describe("Error handling", () => {
  it("throws TSParseError for unsupported syntax", () => {
    expect(() => parseTSExpr("class Foo {}")).toThrow(TSParseError);
  });

  it("throws TSParseError for assignment expressions", () => {
    expect(() => parseTSExpr("x = 5")).toThrow(TSParseError);
  });
});

import { stage, isNow } from "@dependent-ts/core";

describe("parseTS - Type Annotations", () => {
  it("applies number type annotation to const", () => {
    const expr = parseTS("const x: number = 5; x");
    const result = stage(expr);
    // The constraint should include isNumber
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });

  it("applies string type annotation to const", () => {
    const expr = parseTS('const x: string = "hello"; x');
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isString)).toBe(true);
  });

  it("applies boolean type annotation to const", () => {
    const expr = parseTS("const x: boolean = true; x");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isBool)).toBe(true);
  });

  it("applies null type annotation to const", () => {
    const expr = parseTS("const x: null = null; x");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isNull)).toBe(true);
  });

  it("applies union type annotation", () => {
    const expr = parseTS("const x: number | string = 5; x");
    const result = stage(expr);
    // Result should satisfy number (since value is 5)
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });

  it("applies object type annotation", () => {
    const expr = parseTS('const x: { name: string } = { name: "test" }; x');
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isObject)).toBe(true);
  });

  it("applies array type annotation", () => {
    const expr = parseTS("const x: number[] = [1, 2, 3]; x");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isArray)).toBe(true);
  });
});

describe("parseTS - Function Parameter Type Annotations", () => {
  it("applies type annotation to arrow function parameter", () => {
    const expr = parseTS("((a: number) => a)(5)");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });

  it("applies type annotations to multiple arrow function parameters", () => {
    const expr = parseTS("((a: number, b: string) => a)(5, 'hello')");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });

  it("handles mixed typed and untyped arrow function parameters", () => {
    const expr = parseTS("((a: number, b) => a)(5, 'hello')");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });

  it("applies type annotation to function expression parameter", () => {
    const expr = parseTS("(function(a: number) { return a })(5)");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });

  it("applies type annotations to named function expression", () => {
    const expr = parseTS("(function add(a: number, b: number) { return a + b })(3, 4)");
    const result = stage(expr);
    expect(implies(result.svalue.constraint, isNumber)).toBe(true);
  });
});
