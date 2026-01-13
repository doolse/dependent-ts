/**
 * Tests for the Lezer parser.
 */

import { describe, test, expect } from "vitest";
import { parser } from "./parser";

function getNodeTypes(source: string): string[] {
  const tree = parser.parse(source);
  const nodes: string[] = [];
  const cursor = tree.cursor();

  do {
    // Skip Program and error nodes for cleaner output
    if (cursor.name !== "Program" && cursor.name !== "⚠") {
      nodes.push(cursor.name);
    }
  } while (cursor.next());

  return nodes;
}

function hasNode(source: string, nodeName: string): boolean {
  return getNodeTypes(source).includes(nodeName);
}

function hasError(source: string): boolean {
  const tree = parser.parse(source);
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());
  return false;
}

describe("Lezer Parser", () => {
  describe("basic declarations", () => {
    test("const declaration", () => {
      expect(hasNode("const x = 42;", "ConstDecl")).toBe(true);
      expect(hasError("const x = 42;")).toBe(false);
    });

    test("const with type annotation", () => {
      expect(hasNode("const x: Int = 42;", "ConstDecl")).toBe(true);
      expect(hasNode("const x: Int = 42;", "TypeAnnotation")).toBe(true);
      expect(hasError("const x: Int = 42;")).toBe(false);
    });

    test("const with uppercase name", () => {
      expect(hasNode("const Partial = (T) => T;", "ConstDecl")).toBe(true);
      expect(hasError("const Partial = (T) => T;")).toBe(false);
    });

    test("comptime const", () => {
      expect(hasNode("comptime const x = 1;", "ConstDecl")).toBe(true);
      expect(hasError("comptime const x = 1;")).toBe(false);
    });

    test("type declaration", () => {
      expect(hasNode("type MyInt = Int;", "TypeDecl")).toBe(true);
      expect(hasError("type MyInt = Int;")).toBe(false);
    });

    test("type declaration with params", () => {
      expect(hasNode("type Container<T> = { value: T };", "TypeDecl")).toBe(true);
      expect(hasNode("type Container<T> = { value: T };", "TypeParams")).toBe(true);
      expect(hasError("type Container<T> = { value: T };")).toBe(false);
    });

    test("newtype declaration", () => {
      expect(hasNode("newtype UserId = String;", "NewtypeDecl")).toBe(true);
      expect(hasError("newtype UserId = String;")).toBe(false);
    });

    test("export declaration", () => {
      expect(hasNode("export const x = 1;", "ExportDecl")).toBe(true);
      expect(hasError("export const x = 1;")).toBe(false);
    });
  });

  describe("space-sensitive < disambiguation", () => {
    test("f<T> (no space) is type call", () => {
      expect(hasNode("f<T>;", "TypeCallExpr")).toBe(true);
      expect(hasNode("f<T>;", "BinaryExpr")).toBe(false);
      expect(hasError("f<T>;")).toBe(false);
    });

    test("f < T (space) is comparison", () => {
      expect(hasNode("f < T;", "BinaryExpr")).toBe(true);
      expect(hasNode("f < T;", "TypeCallExpr")).toBe(false);
      expect(hasError("f < T;")).toBe(false);
    });

    test("Array<Int> is type call", () => {
      expect(hasNode("Array<Int>;", "TypeCallExpr")).toBe(true);
      expect(hasError("Array<Int>;")).toBe(false);
    });

    test("a < b is comparison", () => {
      expect(hasNode("a < b;", "BinaryExpr")).toBe(true);
      expect(hasError("a < b;")).toBe(false);
    });

    test("mixed type calls and comparisons", () => {
      const nodes = getNodeTypes("const x = Array<Int>; const y = a < b;");
      expect(nodes.filter(n => n === "TypeCallExpr").length).toBe(1);
      expect(nodes.filter(n => n === "BinaryExpr").length).toBe(1);
    });
  });

  describe("arrow functions (GLR disambiguation)", () => {
    test("simple arrow: x => x", () => {
      expect(hasNode("const f = x => x;", "ArrowFn")).toBe(true);
      expect(hasError("const f = x => x;")).toBe(false);
    });

    test("parenthesized param: (x) => x", () => {
      expect(hasNode("const f = (x) => x;", "ArrowFn")).toBe(true);
      expect(hasError("const f = (x) => x;")).toBe(false);
    });

    test("multiple params: (x, y) => x + y", () => {
      expect(hasNode("const f = (x, y) => x + y;", "ArrowFn")).toBe(true);
      expect(hasError("const f = (x, y) => x + y;")).toBe(false);
    });

    test("typed params: (x: Int) => x", () => {
      expect(hasNode("const f = (x: Int) => x;", "ArrowFn")).toBe(true);
      expect(hasNode("const f = (x: Int) => x;", "TypeAnnotation")).toBe(true);
      expect(hasError("const f = (x: Int) => x;")).toBe(false);
    });

    test("return type: (x): Int => x", () => {
      expect(hasNode("const f = (x): Int => x;", "ArrowFn")).toBe(true);
      expect(hasError("const f = (x): Int => x;")).toBe(false);
    });

    test("async arrow", () => {
      expect(hasNode("const f = async (x) => x;", "ArrowFn")).toBe(true);
      expect(hasError("const f = async (x) => x;")).toBe(false);
    });

    test("arrow with block body", () => {
      expect(hasNode("const f = (x) => { x };", "ArrowFn")).toBe(true);
      expect(hasNode("const f = (x) => { x };", "Block")).toBe(true);
      expect(hasError("const f = (x) => { x };")).toBe(false);
    });

    test("parenthesized expression (not arrow)", () => {
      expect(hasNode("const x = (1 + 2);", "ParenExpr")).toBe(true);
      expect(hasNode("const x = (1 + 2);", "ArrowFn")).toBe(false);
      expect(hasError("const x = (1 + 2);")).toBe(false);
    });
  });

  describe("expressions", () => {
    test("binary operators", () => {
      expect(hasNode("const x = 1 + 2;", "BinaryExpr")).toBe(true);
      expect(hasNode("const x = a && b;", "BinaryExpr")).toBe(true);
      expect(hasError("const x = 1 + 2 * 3;")).toBe(false);
    });

    test("ternary expression", () => {
      expect(hasNode("const x = a ? b : c;", "TernaryExpr")).toBe(true);
      expect(hasError("const x = a ? b : c;")).toBe(false);
    });

    test("ternary in arrow body", () => {
      expect(hasNode("const f = x => a ? b : c;", "ArrowFn")).toBe(true);
      expect(hasNode("const f = x => a ? b : c;", "TernaryExpr")).toBe(true);
      expect(hasError("const f = x => a ? b : c;")).toBe(false);
    });

    test("function call", () => {
      expect(hasNode("f(x, y);", "CallExpr")).toBe(true);
      expect(hasError("f(x, y);")).toBe(false);
    });

    test("method chain", () => {
      expect(hasNode("a.b.c();", "MemberExpr")).toBe(true);
      expect(hasNode("a.b.c();", "CallExpr")).toBe(true);
      expect(hasError("a.b.c();")).toBe(false);
    });

    test("await expression", () => {
      expect(hasNode("await x;", "AwaitExpr")).toBe(true);
      expect(hasError("await x;")).toBe(false);
    });

    test("throw expression", () => {
      expect(hasNode("throw x;", "ThrowExpr")).toBe(true);
      expect(hasError("throw x;")).toBe(false);
    });
  });

  describe("literals", () => {
    test("number literals", () => {
      expect(hasNode("const x = 42;", "Number")).toBe(true);
      expect(hasNode("const x = 3.14;", "Number")).toBe(true);
      expect(hasNode("const x = 0xFF;", "Number")).toBe(true);
    });

    test("string literals", () => {
      expect(hasNode('const x = "hello";', "String")).toBe(true);
      expect(hasNode("const x = 'hello';", "String")).toBe(true);
    });

    test("boolean literals", () => {
      expect(hasNode("const x = true;", "BooleanLiteral")).toBe(true);
      expect(hasNode("const x = false;", "BooleanLiteral")).toBe(true);
    });

    test("null and undefined", () => {
      expect(hasNode("const x = null;", "NullLiteral")).toBe(true);
      expect(hasNode("const x = undefined;", "UndefinedLiteral")).toBe(true);
    });
  });

  describe("arrays and records", () => {
    test("array literal", () => {
      expect(hasNode("const x = [1, 2, 3];", "ArrayExpr")).toBe(true);
      expect(hasError("const x = [1, 2, 3];")).toBe(false);
    });

    test("array with spread", () => {
      expect(hasNode("const x = [...a, 1];", "Spread")).toBe(true);
      expect(hasError("const x = [...a, 1];")).toBe(false);
    });

    test("record literal", () => {
      expect(hasNode("const x = { a: 1, b: 2 };", "RecordExpr")).toBe(true);
      expect(hasError("const x = { a: 1, b: 2 };")).toBe(false);
    });

    test("record shorthand", () => {
      expect(hasNode("const x = { a, b };", "RecordExpr")).toBe(true);
      expect(hasError("const x = { a, b };")).toBe(false);
    });

    test("record with spread", () => {
      expect(hasNode("const x = { ...a, b: 1 };", "Spread")).toBe(true);
      expect(hasError("const x = { ...a, b: 1 };")).toBe(false);
    });

    test("record with 'type' keyword as property name", () => {
      expect(hasNode("const x = { type: Int };", "RecordExpr")).toBe(true);
      expect(hasError("const x = { type: Int };")).toBe(false);
    });

    test("record with multiple keyword property names", () => {
      expect(hasNode("const x = { type: Int, const: 1, async: true };", "RecordExpr")).toBe(true);
      expect(hasError("const x = { type: Int, const: 1, async: true };")).toBe(false);
    });

    test("property access with keyword property name", () => {
      expect(hasNode("const x = foo.type;", "MemberExpr")).toBe(true);
      expect(hasError("const x = foo.type;")).toBe(false);
    });
  });

  describe("match expressions", () => {
    test("basic match", () => {
      expect(hasNode("match (x) { case 1: a; };", "MatchExpr")).toBe(true);
      expect(hasError("match (x) { case 1: a; };")).toBe(false);
    });

    test("match with wildcard", () => {
      expect(hasNode("match (x) { case _: a; };", "WildcardPattern")).toBe(true);
      expect(hasError("match (x) { case _: a; };")).toBe(false);
    });

    test("match with guard", () => {
      expect(hasNode("match (x) { case n when n > 0: n; };", "Guard")).toBe(true);
      expect(hasError("match (x) { case n when n > 0: n; };")).toBe(false);
    });

    test("match with destructure", () => {
      expect(hasNode("match (x) { case { a, b }: a; };", "DestructurePattern")).toBe(true);
      expect(hasError("match (x) { case { a, b }: a; };")).toBe(false);
    });
  });

  describe("type expressions", () => {
    test("union type", () => {
      expect(hasNode("const x: Int | String = 1;", "UnionType")).toBe(true);
      expect(hasError("const x: Int | String = 1;")).toBe(false);
    });

    test("intersection type", () => {
      expect(hasNode("const x: A & B = a;", "IntersectionType")).toBe(true);
      expect(hasError("const x: A & B = a;")).toBe(false);
    });

    test("record type", () => {
      expect(hasNode("const x: { a: Int } = { a: 1 };", "RecordType")).toBe(true);
      expect(hasError("const x: { a: Int } = { a: 1 };")).toBe(false);
    });

    test("closed record type", () => {
      expect(hasNode("const x: {| a: Int |} = { a: 1 };", "ClosedRecordType")).toBe(true);
      expect(hasError("const x: {| a: Int |} = { a: 1 };")).toBe(false);
    });

    test("tuple type", () => {
      expect(hasNode("const x: [Int, String] = [1, 'a'];", "TupleType")).toBe(true);
      expect(hasError("const x: [Int, String] = [1, 'a'];")).toBe(false);
    });

    test("array type suffix", () => {
      expect(hasNode("const x: Int[] = [1];", "ArraySuffix")).toBe(true);
      expect(hasError("const x: Int[] = [1];")).toBe(false);
    });

    test("parenthesized type with array suffix", () => {
      // (Int | String)[] should parse as ParenType with ArraySuffix
      expect(hasNode("const x: (Int | String)[] = [];", "ParenType")).toBe(true);
      expect(hasNode("const x: (Int | String)[] = [];", "ArraySuffix")).toBe(true);
      expect(hasNode("const x: (Int | String)[] = [];", "UnionType")).toBe(true);
      expect(hasError("const x: (Int | String)[] = [];")).toBe(false);
    });

    test("function type", () => {
      expect(hasNode("const x: (a: Int) => String = f;", "FunctionType")).toBe(true);
      expect(hasError("const x: (a: Int) => String = f;")).toBe(false);
    });

    test("generic type with arguments", () => {
      expect(hasNode("const x: Array<Int> = [];", "TypeArgs")).toBe(true);
      expect(hasError("const x: Array<Int> = [];")).toBe(false);
    });
  });

  describe("imports", () => {
    test("named import", () => {
      expect(hasNode('import { foo } from "module";', "ImportDecl")).toBe(true);
      expect(hasError('import { foo } from "module";')).toBe(false);
    });

    test("default import", () => {
      expect(hasNode('import lib from "module";', "ImportDecl")).toBe(true);
      expect(hasError('import lib from "module";')).toBe(false);
    });

    test("namespace import", () => {
      expect(hasNode('import * as lib from "module";', "ImportDecl")).toBe(true);
      expect(hasError('import * as lib from "module";')).toBe(false);
    });

    test("import with alias", () => {
      expect(hasNode('import { foo as bar } from "module";', "ImportDecl")).toBe(true);
      expect(hasError('import { foo as bar } from "module";')).toBe(false);
    });
  });

  describe("comments", () => {
    test("line comments are skipped", () => {
      expect(hasError("// comment\nconst x = 1;")).toBe(false);
    });

    test("block comments are skipped", () => {
      expect(hasError("/* comment */ const x = 1;")).toBe(false);
    });
  });

  describe("template literals", () => {
    test("plain template (no interpolation)", () => {
      expect(hasNode("const x = `hello`;", "TemplateExpr")).toBe(true);
      expect(hasNode("const x = `hello`;", "TemplatePlain")).toBe(true);
      expect(hasError("const x = `hello`;")).toBe(false);
    });

    test("template with single interpolation", () => {
      expect(hasNode("const x = `hello ${name}`;", "TemplateExpr")).toBe(true);
      expect(hasNode("const x = `hello ${name}`;", "TemplateStart")).toBe(true);
      expect(hasNode("const x = `hello ${name}`;", "TemplateEnd")).toBe(true);
      expect(hasError("const x = `hello ${name}`;")).toBe(false);
    });

    test("template with multiple interpolations", () => {
      expect(hasNode("const x = `${a} and ${b}`;", "TemplateExpr")).toBe(true);
      expect(hasNode("const x = `${a} and ${b}`;", "TemplateStart")).toBe(true);
      expect(hasNode("const x = `${a} and ${b}`;", "TemplateMiddle")).toBe(true);
      expect(hasNode("const x = `${a} and ${b}`;", "TemplateEnd")).toBe(true);
      expect(hasError("const x = `${a} and ${b}`;")).toBe(false);
    });

    test("template with expression in interpolation", () => {
      expect(hasNode("const x = `sum: ${1 + 2}`;", "TemplateExpr")).toBe(true);
      expect(hasNode("const x = `sum: ${1 + 2}`;", "BinaryExpr")).toBe(true);
      expect(hasError("const x = `sum: ${1 + 2}`;")).toBe(false);
    });

    test("template with nested template", () => {
      expect(hasNode("const x = `outer ${`inner`}`;", "TemplateExpr")).toBe(true);
      expect(hasError("const x = `outer ${`inner`}`;")).toBe(false);
    });

    test("template with function call in interpolation", () => {
      expect(hasNode("const x = `result: ${f(a)}`;", "TemplateExpr")).toBe(true);
      expect(hasNode("const x = `result: ${f(a)}`;", "CallExpr")).toBe(true);
      expect(hasError("const x = `result: ${f(a)}`;")).toBe(false);
    });

    test("empty template", () => {
      expect(hasNode("const x = ``;", "TemplateExpr")).toBe(true);
      expect(hasError("const x = ``;")).toBe(false);
    });

    test("template with escaped characters", () => {
      expect(hasNode("const x = `hello\\nworld`;", "TemplateExpr")).toBe(true);
      expect(hasError("const x = `hello\\nworld`;")).toBe(false);
    });

    test("template with escaped backtick", () => {
      expect(hasNode("const x = `back\\`tick`;", "TemplateExpr")).toBe(true);
      expect(hasError("const x = `back\\`tick`;")).toBe(false);
    });

    test("template with dollar sign not followed by brace", () => {
      expect(hasNode("const x = `costs $5`;", "TemplateExpr")).toBe(true);
      expect(hasError("const x = `costs $5`;")).toBe(false);
    });

    // Known limitation: Expressions ending with `}` inside template interpolations
    // (like records or blocks) cause parsing issues because `}` is ambiguous between
    // closing the expression and starting TemplateMiddle/TemplateEnd.
    // Workaround: assign to a variable first, or use a function call.
    // Fixing this properly requires a context-aware external tokenizer.

    test("template with property access in interpolation", () => {
      expect(hasNode("const x = `name: ${user.name}`;", "TemplateExpr")).toBe(true);
      expect(hasNode("const x = `name: ${user.name}`;", "MemberExpr")).toBe(true);
      expect(hasError("const x = `name: ${user.name}`;")).toBe(false);
    });
  });

  describe("annotations", () => {
    test("annotation on type", () => {
      expect(hasNode("@Deprecated type X = Int;", "Annotation")).toBe(true);
      expect(hasError("@Deprecated type X = Int;")).toBe(false);
    });

    test("annotation on type field", () => {
      expect(hasNode("type X = { @JsonName(\"x\") name: String };", "Annotation")).toBe(true);
      expect(hasError("type X = { @JsonName(\"x\") name: String };")).toBe(false);
    });
  });

  describe("rest parameters", () => {
    test("rest parameter in arrow function", () => {
      expect(hasNode("const sum = (...nums) => nums;", "ArrowFn")).toBe(true);
      expect(hasNode("const sum = (...nums) => nums;", "Spread")).toBe(true);
      expect(hasError("const sum = (...nums) => nums;")).toBe(false);
    });

    test("rest parameter with type annotation", () => {
      expect(hasNode("const sum = (...nums: Int[]) => nums;", "ArrowFn")).toBe(true);
      expect(hasNode("const sum = (...nums: Int[]) => nums;", "Spread")).toBe(true);
      expect(hasNode("const sum = (...nums: Int[]) => nums;", "TypeAnnotation")).toBe(true);
      expect(hasError("const sum = (...nums: Int[]) => nums;")).toBe(false);
    });

    test("rest parameter after regular parameters", () => {
      expect(hasNode("const f = (a, b, ...rest) => rest;", "ArrowFn")).toBe(true);
      expect(hasNode("const f = (a, b, ...rest) => rest;", "Spread")).toBe(true);
      expect(hasError("const f = (a, b, ...rest) => rest;")).toBe(false);
    });

    test("rest parameter in function type", () => {
      expect(hasNode("type Fn = (...args: Int[]) => Int;", "FunctionType")).toBe(true);
      expect(hasNode("type Fn = (...args: Int[]) => Int;", "Spread")).toBe(true);
      expect(hasError("type Fn = (...args: Int[]) => Int;")).toBe(false);
    });

    test("rest parameter in function type after regular params", () => {
      expect(hasNode("type Fn = (a: Int, ...rest: String[]) => Int;", "FunctionType")).toBe(true);
      expect(hasNode("type Fn = (a: Int, ...rest: String[]) => Int;", "Spread")).toBe(true);
      expect(hasError("type Fn = (a: Int, ...rest: String[]) => Int;")).toBe(false);
    });

    test("uppercase type param with rest", () => {
      expect(hasNode("const f = (...T) => T;", "ArrowFn")).toBe(true);
      expect(hasNode("const f = (...T) => T;", "Spread")).toBe(true);
      expect(hasError("const f = (...T) => T;")).toBe(false);
    });
  });
});
