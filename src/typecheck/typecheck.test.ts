/**
 * Tests for the type checker.
 *
 * These tests verify the interleaving of type checking and comptime evaluation.
 */

import { describe, test, expect } from "vitest";
import { parse } from "../parser";
import { typecheck } from "./typecheck";
import { Type, primitiveType, literalType, recordType, arrayType, functionType } from "../types/types";
import { TypedDecl, TypedExpr } from "../ast/core-ast";

// Helper to parse and typecheck a single expression in a const declaration
function checkExpr(code: string): TypedExpr {
  const decls = parse(`const _result = ${code};`);
  const result = typecheck(decls);
  const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
  return constDecl.init;
}

// Helper to parse and typecheck, returning the result
function check(code: string) {
  const decls = parse(code);
  return typecheck(decls);
}

// Helper to get a const declaration's type
function getConstType(code: string, name: string): Type {
  const result = check(code);
  const constDecl = result.decls.find(
    (d) => d.kind === "const" && d.name === name
  ) as TypedDecl & { kind: "const" };
  return constDecl.init.type;
}

describe("Type Checker", () => {
  describe("literal type inference", () => {
    test("infers integer literal types", () => {
      const typed = checkExpr("42");
      expect(typed.type.kind).toBe("literal");
      const lit = typed.type as Type & { kind: "literal" };
      expect(lit.value).toBe(42);
      expect(lit.baseType).toBe("Int");
    });

    test("infers float literal types", () => {
      const typed = checkExpr("3.14");
      expect(typed.type.kind).toBe("literal");
      const lit = typed.type as Type & { kind: "literal" };
      expect(lit.value).toBe(3.14);
      expect(lit.baseType).toBe("Float");
    });

    test("infers string literal types", () => {
      const typed = checkExpr('"hello"');
      expect(typed.type.kind).toBe("literal");
      const lit = typed.type as Type & { kind: "literal" };
      expect(lit.value).toBe("hello");
      expect(lit.baseType).toBe("String");
    });

    test("infers boolean literal types", () => {
      const typed = checkExpr("true");
      expect(typed.type.kind).toBe("literal");
      const lit = typed.type as Type & { kind: "literal" };
      expect(lit.value).toBe(true);
      expect(lit.baseType).toBe("Boolean");
    });

    test("infers null type", () => {
      const typed = checkExpr("null");
      expect(typed.type.kind).toBe("primitive");
      expect((typed.type as Type & { kind: "primitive" }).name).toBe("Null");
    });

    test("infers undefined type", () => {
      const typed = checkExpr("undefined");
      expect(typed.type.kind).toBe("primitive");
      expect((typed.type as Type & { kind: "primitive" }).name).toBe("Undefined");
    });
  });

  describe("binary operations", () => {
    test("arithmetic returns Int for integer operands", () => {
      const typed = checkExpr("1 + 2");
      expect(typed.type).toEqual(primitiveType("Int"));
    });

    test("arithmetic returns Number for float operands", () => {
      const typed = checkExpr("1.0 + 2.0");
      // Float + Float returns Number (the common supertype)
      expect(typed.type).toEqual(primitiveType("Number"));
    });

    test("comparison returns Boolean", () => {
      const typed = checkExpr("1 < 2");
      expect(typed.type).toEqual(primitiveType("Boolean"));
    });

    test("logical operators return union of boolean literals", () => {
      const typed = checkExpr("true && false");
      // With literal type preservation, true && false returns true | false
      expect(typed.type.kind).toBe("union");
    });

    test("equality returns Boolean", () => {
      const typed = checkExpr("1 == 2");
      expect(typed.type).toEqual(primitiveType("Boolean"));
    });
  });

  describe("record literal inference", () => {
    test("infers record type with literal field types", () => {
      const typed = checkExpr("{ a: 1, b: 'hi' }");
      expect(typed.type.kind).toBe("record");
      const rec = typed.type as Type & { kind: "record" };
      expect(rec.fields).toHaveLength(2);
      expect(rec.fields[0].name).toBe("a");
      expect(rec.fields[0].type.kind).toBe("literal");
      expect(rec.fields[1].name).toBe("b");
      expect(rec.fields[1].type.kind).toBe("literal");
    });

    test("preserves literal types in nested records", () => {
      const typed = checkExpr("{ outer: { inner: 42 } }");
      expect(typed.type.kind).toBe("record");
      const rec = typed.type as Type & { kind: "record" };
      const outerField = rec.fields.find((f) => f.name === "outer");
      expect(outerField?.type.kind).toBe("record");
    });
  });

  describe("array literal inference", () => {
    test("infers fixed array type", () => {
      const typed = checkExpr("[1, 2, 3]");
      expect(typed.type.kind).toBe("array");
      const arr = typed.type as Type & { kind: "array" };
      expect(arr.elementTypes).toHaveLength(3);
    });

    test("preserves element literal types", () => {
      const typed = checkExpr("[1, 2]");
      expect(typed.type.kind).toBe("array");
      const arr = typed.type as Type & { kind: "array" };
      expect(arr.elementTypes[0].kind).toBe("literal");
      expect(arr.elementTypes[1].kind).toBe("literal");
    });
  });

  describe("identifier lookup", () => {
    test("looks up previously defined const", () => {
      const result = check("const x = 42; const y = x;");
      const yDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(yDecl.init.type.kind).toBe("literal");
    });

    test("throws on undefined identifier", () => {
      expect(() => check("const x = undefinedVar;")).toThrow();
    });
  });

  describe("type annotations", () => {
    test("uses declared type instead of inferred", () => {
      const result = check("const x: Int = 42;");
      const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
      // declType is the final type used (declared type if present)
      expect(constDecl.declType.kind).toBe("primitive");
      expect((constDecl.declType as Type & { kind: "primitive" }).name).toBe("Int");
    });

    test("throws on type mismatch", () => {
      expect(() => check('const x: Int = "hello";')).toThrow();
    });

    test("allows subtype assignment", () => {
      // 42 (literal type) is subtype of Int
      const result = check("const x: Int = 42;");
      expect(result.decls).toHaveLength(1);
    });
  });

  describe("lambda type inference", () => {
    test("infers lambda with annotated params", () => {
      const typed = checkExpr("(x: Int) => x + 1");
      expect(typed.type.kind).toBe("function");
      const fn = typed.type as Type & { kind: "function" };
      expect(fn.params).toHaveLength(1);
      expect(fn.params[0].type).toEqual(primitiveType("Int"));
    });

    test("infers return type from body", () => {
      const typed = checkExpr("(x: Int) => x + 1");
      expect(typed.type.kind).toBe("function");
      const fn = typed.type as Type & { kind: "function" };
      expect(fn.returnType).toEqual(primitiveType("Int"));
    });

    test("contextual typing provides param types", () => {
      // Lambda used where (Int) => Int is expected
      const result = check("const f: (x: Int) => Int = x => x + 1;");
      const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(constDecl.init.type.kind).toBe("function");
    });
  });

  describe("function calls", () => {
    test("infers call result type", () => {
      const result = check("const f = (x: Int) => x + 1; const y = f(42);");
      const yDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(yDecl.init.type).toEqual(primitiveType("Int"));
    });

    test("throws on wrong argument type", () => {
      expect(() =>
        check('const f = (x: Int) => x; const y = f("hello");')
      ).toThrow();
    });

    test("throws on wrong argument count", () => {
      expect(() =>
        check("const f = (x: Int) => x; const y = f(1, 2);")
      ).toThrow();
    });
  });

  describe("property access", () => {
    test("accesses record field", () => {
      const result = check("const r = { x: 42 }; const y = r.x;");
      const yDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(yDecl.init.type.kind).toBe("literal");
    });

    test("throws on non-existent field", () => {
      expect(() => check("const r = { x: 42 }; const y = r.z;")).toThrow();
    });
  });

  describe("conditional expressions", () => {
    test("returns union of branch types", () => {
      const typed = checkExpr("true ? 1 : 2");
      // Both branches are Int literals, could be union or shared type
      expect(typed.type.kind).toBe("union");
    });

    test("requires boolean condition", () => {
      expect(() => check("const x = 42 ? 1 : 2;")).toThrow();
    });
  });

  describe("type declarations", () => {
    test("type alias is comptime value", () => {
      // type MyInt = Int desugars to const MyInt = WithMetadata(Int, {...})
      const result = check("type MyInt = Int;");
      const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(constDecl.name).toBe("MyInt");
    });

    test("type can be used in annotation", () => {
      const result = check("type MyInt = Int; const x: MyInt = 42;");
      expect(result.decls).toHaveLength(2);
    });
  });

  describe("comptime evaluation", () => {
    test("evaluates type annotation at comptime", () => {
      // The type annotation must be evaluated to get the Type value
      const result = check("const x: Int = 42;");
      const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
      // The declType should be Int (the declared type)
      expect(constDecl.declType.kind).toBe("primitive");
      expect((constDecl.declType as Type & { kind: "primitive" }).name).toBe("Int");
    });

    test("type property access is comptimeOnly", () => {
      // Accessing .name on a Type returns a string (runtime usable)
      // but accessing .fields returns comptimeOnly value
      const result = check("const name = Int.name;");
      const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
      // .name returns a string, which is runtime usable
      expect(constDecl.init.comptimeOnly).toBe(false);
    });
  });

  describe("expression statements", () => {
    test("allows expression as statement", () => {
      const result = check("const x = 1; x;");
      expect(result.decls).toHaveLength(2);
      expect(result.decls[1].kind).toBe("expr");
    });
  });

  describe("nested constructs", () => {
    test("handles nested function calls", () => {
      const result = check(`
        const add = (a: Int, b: Int) => a + b;
        const mul = (a: Int, b: Int) => a * b;
        const result = add(mul(2, 3), 4);
      `);
      const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(resultDecl.init.type).toEqual(primitiveType("Int"));
    });

    test("handles deeply nested record access", () => {
      const result = check(`
        const data = { outer: { inner: { value: 42 } } };
        const x = data.outer.inner.value;
      `);
      const xDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(xDecl.init.type.kind).toBe("literal");
    });
  });

  describe("higher-order functions", () => {
    test("function returning function", () => {
      const result = check(`
        const makeAdder = (x: Int) => (y: Int) => x + y;
        const add5 = makeAdder(5);
      `);
      const add5Decl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(add5Decl.init.type.kind).toBe("function");
    });

    test("function taking function parameter", () => {
      const result = check(`
        const apply = (f: (x: Int) => Int, x: Int) => f(x);
        const double = (x: Int) => x * 2;
        const result = apply(double, 5);
      `);
      const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(resultDecl.init.type).toEqual(primitiveType("Int"));
    });
  });

  describe("error messages", () => {
    test("reports undefined identifier", () => {
      expect(() => check("const x = unknown;")).toThrow(/undefined|not defined/i);
    });

    test("reports type mismatch with details", () => {
      expect(() => check('const x: Int = "hello";')).toThrow();
    });

    test("reports missing property", () => {
      expect(() => check("const r = { a: 1 }; const x = r.b;")).toThrow(/property/i);
    });
  });

  describe("type alias usage", () => {
    test("type alias can be used in annotations", () => {
      const result = check(`
        type Point = { x: Int, y: Int };
        const p: Point = { x: 1, y: 2 };
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("newtype creates branded type", () => {
      // This should work - creating a branded type
      const result = check("newtype UserId = String;");
      const userIdDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(userIdDecl.name).toBe("UserId");
    });
  });
});
