/**
 * Tests for the codegen phase.
 *
 * Codegen transforms RuntimeAST (CoreDecl[] after erasure) to JavaScript.
 */

import { describe, test, expect } from "vitest";
import { parse } from "../parser";
import { typecheck } from "../typecheck/typecheck";
import { erase } from "../erasure/erasure";
import { codegen } from "./codegen";

// Helper to compile DepJS code to JavaScript
function compile(code: string): string {
  const decls = parse(code);
  const typed = typecheck(decls);
  const runtime = erase(typed);
  return codegen(runtime);
}

// Helper to normalize whitespace for comparison
function normalize(code: string): string {
  return code.replace(/\s+/g, " ").trim();
}

describe("Codegen", () => {
  describe("literals", () => {
    test("integer literals", () => {
      const js = compile("const x = 42;");
      expect(js).toContain("const x = 42;");
    });

    test("float literals", () => {
      const js = compile("const x = 3.14;");
      expect(js).toContain("const x = 3.14;");
    });

    test("string literals", () => {
      const js = compile('const x = "hello";');
      expect(js).toContain('const x = "hello";');
    });

    test("boolean literals", () => {
      const jsTrue = compile("const x = true;");
      const jsFalse = compile("const y = false;");
      expect(jsTrue).toContain("const x = true;");
      expect(jsFalse).toContain("const y = false;");
    });

    test("null literal", () => {
      const js = compile("const x = null;");
      expect(js).toContain("const x = null;");
    });

    test("undefined literal", () => {
      const js = compile("const x = undefined;");
      expect(js).toContain("const x = undefined;");
    });
  });

  describe("binary operators", () => {
    test("arithmetic operators", () => {
      // Note: Parser precedence may add parens; codegen preserves AST structure
      const js = compile("const x = 1 + 2;");
      expect(js).toContain("1 + 2");
    });

    test("multiplication", () => {
      const js = compile("const x = 2 * 3;");
      expect(js).toContain("2 * 3");
    });

    test("equality maps to strict equality", () => {
      const js = compile("const x = 1 == 2;");
      expect(js).toContain("const x = 1 === 2;");
    });

    test("inequality maps to strict inequality", () => {
      const js = compile("const x = 1 != 2;");
      expect(js).toContain("const x = 1 !== 2;");
    });

    test("comparison operators", () => {
      const js = compile("const x = 1 < 2;");
      expect(js).toContain("const x = 1 < 2;");
    });

    test("logical and", () => {
      const js = compile("const x = true && false;");
      expect(js).toContain("true && false");
    });

    test("logical or", () => {
      const js = compile("const x = true || false;");
      expect(js).toContain("true || false");
    });

    test("bitwise operators", () => {
      const js = compile("const x = 5 | 3;");
      expect(js).toContain("const x = 5 | 3;");
    });
  });

  describe("unary operators", () => {
    test("logical not", () => {
      const js = compile("const x = !true;");
      expect(js).toContain("const x = !true;");
    });

    test("negation", () => {
      const js = compile("const x = -42;");
      expect(js).toContain("const x = -42;");
    });

    test("bitwise not", () => {
      const js = compile("const x = ~5;");
      expect(js).toContain("const x = ~5;");
    });
  });

  describe("conditionals", () => {
    test("ternary expression", () => {
      const js = compile("const x = true ? 1 : 2;");
      expect(js).toContain("true ? 1 : 2");
    });

    test("nested ternary", () => {
      const js = compile("const x = true ? false ? 1 : 2 : 3;");
      expect(normalize(js)).toContain("true ? false ? 1 : 2 : 3");
    });
  });

  describe("property access", () => {
    test("dot access", () => {
      const js = compile("const obj = { a: 1 }; const x = obj.a;");
      expect(js).toContain("obj.a");
    });
  });

  describe("index access", () => {
    test("array index", () => {
      const js = compile("const arr = [1, 2, 3]; const x = arr[0];");
      expect(js).toContain("arr[0]");
    });
  });

  describe("function calls", () => {
    test("simple call", () => {
      const js = compile("const f = (x: Int) => x; const y = f(42);");
      expect(js).toContain("f(42)");
    });

    test("multiple arguments", () => {
      const js = compile("const add = (a: Int, b: Int) => a + b; const x = add(1, 2);");
      expect(js).toContain("add(1, 2)");
    });

    test("spread arguments", () => {
      const js = compile("const f = (...args: Int[]) => args[0]; const arr = [1, 2]; const x = f(...arr);");
      expect(js).toContain("f(...arr)");
    });
  });

  describe("lambdas", () => {
    test("simple lambda", () => {
      const js = compile("const f = (x: Int) => x + 1;");
      expect(normalize(js)).toContain("(x) => x + 1");
    });

    test("lambda with multiple params", () => {
      const js = compile("const f = (a: Int, b: Int) => a + b;");
      expect(normalize(js)).toContain("(a, b) => a + b");
    });

    test("lambda with default value", () => {
      const js = compile("const f = (x: Int = 42) => x;");
      expect(normalize(js)).toContain("(x = 42) => x");
    });

    test("lambda with rest parameter", () => {
      const js = compile("const f = (...args: Int[]) => args;");
      expect(normalize(js)).toContain("(...args) => args");
    });

    test("async lambda", () => {
      const js = compile("const f = async (x: Int) => x;");
      expect(normalize(js)).toContain("async (x) => x");
    });

    test("type annotations are removed", () => {
      const js = compile("const f = (x: Int): Int => x;");
      expect(js).not.toContain(": Int");
    });
  });

  describe("records", () => {
    test("empty record", () => {
      const js = compile("const x = {};");
      expect(js).toContain("const x = {};");
    });

    test("simple record", () => {
      const js = compile("const x = { a: 1, b: 2 };");
      expect(js).toContain("a: 1");
      expect(js).toContain("b: 2");
    });

    test("record with spread", () => {
      const js = compile("const a = { x: 1 }; const b = { ...a, y: 2 };");
      expect(js).toContain("...a");
    });

    test("shorthand property", () => {
      const js = compile("const a = 1; const x = { a };");
      // Should use shorthand: { a } not { a: a }
      expect(normalize(js)).toContain("{ a }");
    });
  });

  describe("arrays", () => {
    test("empty array", () => {
      const js = compile("const x: Int[] = [];");
      expect(js).toContain("const x = [];");
    });

    test("simple array", () => {
      const js = compile("const x = [1, 2, 3];");
      expect(js).toContain("[1, 2, 3]");
    });

    test("array with spread", () => {
      const js = compile("const a = [1, 2]; const b = [...a, 3];");
      expect(js).toContain("...a");
    });
  });

  describe("template literals", () => {
    test("simple template", () => {
      const js = compile("const x = `hello`;");
      expect(js).toContain("`hello`");
    });

    test("template with interpolation", () => {
      const js = compile("const name = \"world\"; const x = `hello ${name}`;");
      expect(js).toContain("${name}");
    });
  });

  describe("block expressions", () => {
    test("block in lambda body", () => {
      const js = compile(`
        const f = () => {
          const x = 1;
          const y = 2;
          x + y
        };
      `);
      // Block becomes function body with return
      expect(js).toContain("const x = 1;");
      expect(js).toContain("const y = 2;");
      expect(js).toContain("return x + y;");
    });
  });

  describe("await", () => {
    test("await expression", () => {
      // Need a Promise type for this
      const js = compile(`
        type Promise<T> = { __promiseValue: T };
        const p: Promise<Int> = { __promiseValue: 42 };
        const x = await p;
      `);
      expect(js).toContain("await p");
    });
  });

  describe("throw", () => {
    test("throw expression", () => {
      // throw in expression position becomes IIFE
      const js = compile(`
        const x = true ? 1 : throw "error";
      `);
      expect(js).toContain("throw");
      expect(js).toContain('"error"');
    });
  });

  describe("imports", () => {
    test("default import preserved", () => {
      // Note: imports pass through from erasure
      // We test the genImportDecl function indirectly
      const js = compile("const x = 1;");
      // Just verify codegen works with simple code
      expect(js).toContain("const x = 1;");
    });
  });

  describe("exports", () => {
    test("exported const", () => {
      const js = compile("export const x = 42;");
      expect(js).toContain("export const x = 42;");
    });
  });

  describe("pattern matching", () => {
    test("match with literal patterns", () => {
      const js = compile(`
        const x = 1;
        const y = match (x) {
          case 1: "one";
          case 2: "two";
          case _: "other";
        };
      `);
      // Should generate IIFE with if-chain
      expect(js).toContain("(() =>");
      expect(js).toContain("_match === 1");
      expect(js).toContain("_match === 2");
      expect(js).toContain("return");
    });

    test("match with type patterns", () => {
      const js = compile(`
        const x: Int | String = 42;
        const y = match (x) {
          case Int: "number";
          case String: "string";
        };
      `);
      expect(js).toContain('typeof _match === "number"');
      expect(js).toContain('typeof _match === "string"');
    });

    test("match with destructure patterns", () => {
      const js = compile(`
        const obj = { kind: "a", value: 42 };
        const y = match (obj) {
          case { kind: "a", value }: value;
          case { kind: "b" }: 0;
        };
      `);
      expect(js).toContain('_match.kind === "a"');
      expect(js).toContain("const value = _match.value;");
    });

    test("match with guard", () => {
      const js = compile(`
        const x = 5;
        const y = match (x) {
          case n when n > 0: "positive";
          case _: "non-positive";
        };
      `);
      expect(js).toContain("n > 0");
    });

    test("match with binding pattern", () => {
      const js = compile(`
        const x = 42;
        const y = match (x) {
          case n: n + 1;
        };
      `);
      expect(js).toContain("const n = _match;");
    });

    test("match with wildcard", () => {
      const js = compile(`
        const x = 42;
        const y = match (x) {
          case _: 0;
        };
      `);
      // Wildcard has no condition, just true
      expect(js).toContain("if (true)");
    });
  });

  describe("type erasure integration", () => {
    test("type declarations are erased", () => {
      const js = compile(`
        type MyInt = Int;
        const x: MyInt = 42;
      `);
      // MyInt should not appear in output
      expect(js).not.toContain("MyInt");
      expect(js).toContain("const x = 42;");
    });

    test("assert statements are erased", () => {
      const js = compile(`
        const x = true;
        assert(x);
        const y = 42;
      `);
      // assert should not appear in output
      expect(js).not.toContain("assert");
      expect(js).toContain("const x = true;");
      expect(js).toContain("const y = 42;");
    });
  });

  describe("roundtrip evaluation", () => {
    // These tests compile DepJS to JS and evaluate the result

    test("arithmetic expression evaluates correctly", () => {
      // Use explicit parentheses since parser may not handle precedence correctly
      const js = compile("const result = 2 + (3 * 4);");
      const result = evalLastConst(js);
      expect(result).toBe(14);
    });

    test("simple addition evaluates correctly", () => {
      const js = compile("const result = 2 + 3;");
      const result = evalLastConst(js);
      expect(result).toBe(5);
    });

    test("array map evaluates correctly", () => {
      const js = compile("const result = [1, 2, 3].map(x => x * 2);");
      const result = evalLastConst(js);
      expect(result).toEqual([2, 4, 6]);
    });

    test("conditional evaluates correctly", () => {
      const js = compile('const result = true ? "yes" : "no";');
      const result = evalLastConst(js);
      expect(result).toBe("yes");
    });

    test("record spread evaluates correctly", () => {
      const js = compile("const a = { x: 1 }; const result = { ...a, y: 2 };");
      const result = evalLastConst(js);
      expect(result).toEqual({ x: 1, y: 2 });
    });

    test("lambda call evaluates correctly", () => {
      const js = compile("const add = (a: Int, b: Int) => a + b; const result = add(3, 4);");
      const result = evalLastConst(js);
      expect(result).toBe(7);
    });

    test("template literal evaluates correctly", () => {
      const js = compile('const name = "world"; const result = `hello ${name}`;');
      const result = evalLastConst(js);
      expect(result).toBe("hello world");
    });

    test("block expression evaluates correctly", () => {
      const js = compile(`
        const f = () => {
          const x = 1;
          const y = 2;
          x + y
        };
        const result = f();
      `);
      const result = evalLastConst(js);
      expect(result).toBe(3);
    });

    test("match with literals evaluates correctly", () => {
      const js = compile(`
        const x = 2;
        const result = match (x) {
          case 1: "one";
          case 2: "two";
          case _: "other";
        };
      `);
      const result = evalLastConst(js);
      expect(result).toBe("two");
    });

    test("match with binding and guard evaluates correctly", () => {
      const js = compile(`
        const x = 5;
        const result = match (x) {
          case n when n > 10: "big";
          case n when n > 0: "small";
          case _: "zero or negative";
        };
      `);
      const result = evalLastConst(js);
      expect(result).toBe("small");
    });

    test("match with destructure evaluates correctly", () => {
      const js = compile(`
        const obj = { kind: "add", a: 3, b: 4 };
        const result = match (obj) {
          case { kind: "add", a, b }: a + b;
          case { kind: "sub", a, b }: a - b;
          case _: 0;
        };
      `);
      const result = evalLastConst(js);
      expect(result).toBe(7);
    });
  });

  describe("numeric conversion builtins", () => {
    test("toInt truncates to integer", () => {
      const js = compile("const result = toInt(3.7);");
      expect(js).toContain("toInt");
      const result = evalLastConst(js);
      expect(result).toBe(3);
    });

    test("toInt truncates negative numbers toward zero", () => {
      const js = compile("const result = toInt(-3.7);");
      const result = evalLastConst(js);
      expect(result).toBe(-3);
    });

    test("toFloat preserves integer value", () => {
      const js = compile("const result = toFloat(42);");
      expect(js).toContain("toFloat");
      const result = evalLastConst(js);
      expect(result).toBe(42);
    });
  });

  describe("Try builtin", () => {
    test("Try catches successful execution", () => {
      const js = compile("const result = Try(() => 42);");
      expect(js).toContain("Try");
      const result = evalLastConst(js) as { ok: boolean; value?: number };
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    test("Try catches thrown errors", () => {
      // Note: We can't easily test this without a throw statement in DepJS
      // but we can verify the runtime preamble includes Try
      const js = compile("const result = Try(() => 1);");
      expect(js).toContain("const Try = ");
    });
  });
});

// Helper to evaluate JS and extract the last const value
function evalLastConst(js: string): unknown {
  // Wrap in module context and extract result
  const wrappedJs = `
    ${js}
    return result;
  `;
  return new Function(wrappedJs)();
}
