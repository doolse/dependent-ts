/**
 * Tests for the type checker.
 *
 * These tests verify the interleaving of type checking and comptime evaluation.
 */

import { describe, test, expect } from "vitest";
import { parse } from "../parser";
import { typecheck } from "./typecheck";
import { Type, primitiveType, literalType, recordType, arrayType, functionType, unwrapMetadata, withMetadata, FunctionType, isVariadicArray, getArrayElementTypes } from "../types/types";
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
      if (typed.type.kind === "array") {
        expect(getArrayElementTypes(typed.type)).toHaveLength(3);
      }
    });

    test("preserves element literal types", () => {
      const typed = checkExpr("[1, 2]");
      expect(typed.type.kind).toBe("array");
      if (typed.type.kind === "array") {
        const elems = getArrayElementTypes(typed.type);
        expect(elems[0].kind).toBe("literal");
        expect(elems[1].kind).toBe("literal");
      }
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

  describe("spread arguments", () => {
    test("spread array into rest parameter", () => {
      const result = check(`
        const sum = (...nums: Int[]): Int => nums.reduce((a, b) => a + b, 0);
        const arr = [1, 2, 3];
        const result = sum(...arr);
      `);
      const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(resultDecl.init.type).toEqual(primitiveType("Int"));
    });

    test("spread fixed array into parameters", () => {
      const result = check(`
        const add = (a: Int, b: Int) => a + b;
        const args: [Int, Int] = [1, 2];
        const result = add(...args);
      `);
      const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(resultDecl.init.type).toEqual(primitiveType("Int"));
    });

    test("mix of regular and spread arguments", () => {
      const result = check(`
        const fn = (a: Int, b: Int, c: Int) => a + b + c;
        const rest: [Int, Int] = [2, 3];
        const result = fn(1, ...rest);
      `);
      const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(resultDecl.init.type).toEqual(primitiveType("Int"));
    });

    test("spread argument type checking - error on wrong element type", () => {
      expect(() => check(`
        const fn = (a: Int, b: Int) => a + b;
        const args: [String, String] = ["a", "b"];
        const result = fn(...args);
      `)).toThrow("not assignable");
    });

    test("spread must be array type", () => {
      expect(() => check(`
        const fn = (a: Int) => a;
        const x = 42;
        const result = fn(...x);
      `)).toThrow("must be an array");
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

  describe("TypeScript compatibility features", () => {
    describe("union types", () => {
      test("union type annotation", () => {
        const result = check("const x: Int | String = 42;");
        expect(result.decls).toHaveLength(1);
      });

      test("multi-way union", () => {
        const result = check("const x: Int | String | Boolean = true;");
        expect(result.decls).toHaveLength(1);
      });
    });

    describe("function type properties", () => {
      test(".returnType access", () => {
        const result = check(`
          type Fn = (x: Int) => String;
          const ret = Fn.returnType;
        `);
        const retDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(retDecl.init.comptimeOnly).toBe(true);
      });

      test(".parameterTypes access", () => {
        const result = check(`
          type Fn = (x: Int, y: String) => Boolean;
          const params = Fn.parameterTypes;
        `);
        const paramsDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(paramsDecl.init.comptimeOnly).toBe(true);
      });
    });

    describe("record type properties", () => {
      test(".fields access", () => {
        const result = check(`
          type Person = { name: String, age: Int };
          const fields = Person.fields;
        `);
        const fieldsDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(fieldsDecl.init.comptimeOnly).toBe(true);
      });

      test(".fieldNames access (runtime usable)", () => {
        const result = check(`
          type Person = { name: String, age: Int };
          const names = Person.fieldNames;
        `);
        const namesDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // fieldNames returns Array<String>, which is runtime usable
        expect(namesDecl.init.comptimeOnly).toBe(false);
      });

      test(".keysType access", () => {
        const result = check(`
          type Person = { name: String, age: Int };
          const keys = Person.keysType;
        `);
        const keysDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(keysDecl.init.comptimeOnly).toBe(true);
      });
    });

    describe("branded types", () => {
      test("newtype syntax creates branded type", () => {
        const result = check(`
          newtype UserId = String;
          newtype OrderId = String;
        `);
        expect(result.decls).toHaveLength(2);
      });

      test("branded type .baseType", () => {
        const result = check(`
          newtype UserId = String;
          const base = UserId.baseType;
        `);
        const baseDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(baseDecl.init.comptimeOnly).toBe(true);
      });

      test("branded type .brand", () => {
        const result = check(`
          newtype UserId = String;
          const brand = UserId.brand;
        `);
        const brandDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // .brand returns a string, which is runtime usable
        expect(brandDecl.init.comptimeOnly).toBe(false);
      });
    });

    describe("WithMetadata", () => {
      test("attaches metadata to type", () => {
        const result = check(`
          const MyInt = WithMetadata(Int, { name: "MyInt" });
          const name = MyInt.name;
        `);
        expect(result.decls).toHaveLength(2);
      });

      test("type declaration desugars to WithMetadata", () => {
        // type X = T desugars to const X = WithMetadata(T, { name: "X" })
        const result = check(`
          type MyInt = Int;
          const name = MyInt.name;
        `);
        expect(result.decls).toHaveLength(2);
      });
    });

    // Note: The following tests are commented out because they require
    // more advanced type checking features that aren't fully implemented yet:
    // - intersection types (A & B syntax desugaring)
    // - .extends() method calls on types
    // - T.fields.map() chains (type checker doesn't know .fields returns array)
    // - Array type syntax (Int[] vs Array<Int>)
    //
    // The underlying comptime evaluation works (see comptime-eval.test.ts),
    // but the static type checker doesn't yet understand these patterns.
    // These features work when used in comptime contexts that are evaluated,
    // but the type checker can't statically verify them.

    describe("builtin record types", () => {
      test("FieldInfo type is available", () => {
        // FieldInfo is a builtin type that can be used in annotations
        const result = check(`
          type PersonFields = Array<FieldInfo>;
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("ParamInfo type is available", () => {
        const result = check(`
          type FnParams = Array<ParamInfo>;
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("ArrayElementInfo type is available", () => {
        const result = check(`
          type Elements = Array<ArrayElementInfo>;
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("TypeMetadata type is available", () => {
        const result = check(`
          const m: TypeMetadata = { name: "Foo" };
        `);
        expect(result.decls).toHaveLength(1);
      });

      test(".fields returns Array<FieldInfo>", () => {
        // The .fields property on record types returns FieldInfo array
        const result = check(`
          type Person = { name: String, age: Int };
          const fields = Person.fields;
        `);
        // fields is comptime-only because it contains Type values
        const fieldsDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(fieldsDecl.init.comptimeOnly).toBe(true);
      });

      test("FieldInfo literal with type keyword as property name", () => {
        // 'type' is a keyword but allowed as property name in record literals
        const result = check(`
          const f: FieldInfo = { name: "x", type: Int, optional: false, annotations: [] };
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("ParamInfo literal with type keyword as property name", () => {
        const result = check(`
          const p: ParamInfo = { name: "x", type: Int, optional: false };
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("ArrayElementInfo literal with type keyword as property name", () => {
        const result = check(`
          const e: ArrayElementInfo = { type: Int };
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("Array<FieldInfo> works with type keyword", () => {
        const result = check(`
          const fields: Array<FieldInfo> = [
            { name: "x", type: Int, optional: false, annotations: [] },
            { name: "y", type: String, optional: true, annotations: [] }
          ];
        `);
        expect(result.decls).toHaveLength(1);
      });

      // Note: Static type checker doesn't know .fields returns Array<FieldInfo>,
      // so Person.fields[0].name doesn't work statically. This pattern only works
      // in comptime evaluation contexts (see comptime-eval.test.ts).
    });
  });

  describe("rest parameters", () => {
    test("rest parameter in arrow function", () => {
      const fnType = getConstType(
        `const sum = (...nums: Int[]): Int => 0;`,
        "sum"
      );
      expect(fnType.kind).toBe("function");
      const fn = fnType as Type & { kind: "function" };
      expect(fn.params).toHaveLength(1);
      expect(fn.params[0].rest).toBe(true);
    });

    test("rest parameter accepts multiple arguments", () => {
      // Should not throw - variadic call
      check(`
        const sum = (...nums: Int[]): Int => 0;
        const result = sum(1, 2, 3, 4, 5);
      `);
    });

    test("rest parameter accepts zero arguments", () => {
      // Should not throw - empty rest
      check(`
        const sum = (...nums: Int[]): Int => 0;
        const result = sum();
      `);
    });

    test("rest parameter with preceding fixed params", () => {
      check(`
        const concat = (prefix: String, ...parts: String[]): String => prefix;
        const result = concat("hello", "world", "!");
      `);
    });

    test("rest parameter type checking", () => {
      // Should throw - wrong type
      expect(() =>
        check(`
          const sum = (...nums: Int[]): Int => 0;
          const result = sum(1, "hello", 3);
        `)
      ).toThrow(/not assignable/);
    });

    test("function type with rest parameter", () => {
      check(`
        type Variadic = (...args: Int[]) => Int;
        const fn: Variadic = (...nums) => 0;
      `);
    });

    test("required params still checked with rest", () => {
      // Should throw - missing required param
      expect(() =>
        check(`
          const f = (required: String, ...rest: Int[]): Int => 0;
          const result = f();
        `)
      ).toThrow(/Expected at least 1 arguments/);
    });

    test("non-rest function rejects extra arguments", () => {
      // Should throw - too many args
      expect(() =>
        check(`
          const add = (a: Int, b: Int): Int => a;
          const result = add(1, 2, 3);
        `)
      ).toThrow(/Expected at most 2 arguments/);
    });
  });

  describe("subtyping edge cases", () => {
    test("Int literal is subtype of Int", () => {
      check("const x: Int = 42;");
    });

    test("Int is subtype of Number", () => {
      check("const x: Number = 42;");
    });

    test("Float is subtype of Number", () => {
      check("const x: Number = 3.14;");
    });

    test("String literal is subtype of String", () => {
      check('const x: String = "hello";');
    });

    test("Boolean literal is subtype of Boolean", () => {
      check("const x: Boolean = true;");
    });

    test("record with extra field is subtype of record without", () => {
      // Structural subtyping - width subtyping
      check(`
        const r = { a: 1, b: 2 };
        const s: { a: Int } = r;
      `);
    });

    test("record with subtype field is subtype", () => {
      // Depth subtyping - Int literal is subtype of Int
      check(`
        const r = { a: 42 };
        const s: { a: Int } = r;
      `);
    });

    test("fixed array is subtype of variable-length array", () => {
      // [1, 2, 3] : [1, 2, 3] <: Int[]
      check(`
        const arr = [1, 2, 3];
        const nums: Int[] = arr;
      `);
    });

    test("heterogeneous fixed array subtypes union array", () => {
      // [Int, String] <: (Int | String)[]
      check(`
        const arr = [1, "hello"];
        const mixed: (Int | String)[] = arr;
      `);
    });

    test("union member is subtype of union", () => {
      check(`
        const x: Int = 42;
        const y: Int | String = x;
      `);
    });

    test("Never is subtype of everything", () => {
      check(`
        const neverFn = (): Never => { throw "error"; };
        const x: Int = neverFn();
      `);
    });

    test("block ending with throw has type Never", () => {
      // Blocks only appear in arrow function bodies
      const result = check(`
        const f = () => { throw "error"; };
      `);
      const fDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(fDecl.init.type.kind).toBe("function");
      const fnType = fDecl.init.type as Type & { kind: "function" };
      expect(fnType.returnType.kind).toBe("primitive");
      expect((fnType.returnType as any).name).toBe("Never");
    });

    test("everything is subtype of Unknown", () => {
      check(`
        const x: Unknown = 42;
        const y: Unknown = "hello";
        const z: Unknown = { a: 1 };
      `);
    });

    test("incompatible types fail", () => {
      expect(() => check('const x: Int = "hello";')).toThrow(/not assignable/);
    });

    test("missing required field fails", () => {
      expect(() => check(`
        const r = { a: 1 };
        const s: { a: Int, b: String } = r;
      `)).toThrow(/not assignable/);
    });
  });

  describe("optional properties", () => {
    test("optional property can be omitted in literal", () => {
      check(`
        type Config = { name: String, timeout?: Int };
        const c: Config = { name: "test" };
      `);
    });

    test("optional property can be provided", () => {
      check(`
        type Config = { name: String, timeout?: Int };
        const c: Config = { name: "test", timeout: 100 };
      `);
    });

    test("required property cannot be omitted", () => {
      expect(() => check(`
        type Config = { name: String, timeout: Int };
        const c: Config = { name: "test" };
      `)).toThrow(/not assignable/);
    });
  });

  describe("function subtyping", () => {
    test("function with subtype return is subtype", () => {
      // Covariance in return type: () => Int <: () => Number
      check(`
        const intFn = (): Int => 42;
        const numFn: () => Number = intFn;
      `);
    });

    test("function with supertype param is subtype", () => {
      // Contravariance in params: (Number) => Int <: (Int) => Int
      check(`
        const numFn = (x: Number): Int => 1;
        const intFn: (x: Int) => Int = numFn;
      `);
    });

    test("function return type mismatch fails", () => {
      expect(() => check(`
        const strFn = (): String => "hi";
        const intFn: () => Int = strFn;
      `)).toThrow(/not assignable/);
    });
  });

  describe("default parameters", () => {
    test("string literal default is assignable to String annotation", () => {
      const result = check(`
        const greet = (message: String = "Hello") => message;
      `);
      const fnDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(fnDecl.init.type.kind).toBe("function");
    });

    test("int literal default is assignable to Int annotation", () => {
      const result = check(`
        const addDefault = (x: Int = 10) => x + 1;
      `);
      const fnDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(fnDecl.init.type.kind).toBe("function");
    });

    test("default value must be subtype of parameter type", () => {
      expect(() => check(`
        const f = (x: Int = "hello") => x;
      `)).toThrow(/not assignable/);
    });
  })

  describe("array index access", () => {
    test("literal index on fixed array returns specific element type", () => {
      const result = check(`
        const arr = [1, 2, 3];
        const x = arr[0];
      `);
      const xDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // With literal index, returns specific element type (literal 1)
      expect(xDecl.init.type.kind).toBe("literal");
      expect((xDecl.init.type as any).value).toBe(1);
    });

    test("literal index on heterogeneous array returns specific element type", () => {
      const result = check(`
        const arr = [1, "hello", true];
        const x = arr[1];
      `);
      const xDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // arr[1] should be "hello" (string literal)
      expect(xDecl.init.type.kind).toBe("literal");
      expect((xDecl.init.type as any).value).toBe("hello");
    });

    test("dynamic index returns union of element types", () => {
      const result = check(`
        const arr = [1, "hello"];
        const i: Int = 0;
        const x = arr[i];
      `);
      const xDecl = result.decls[2] as TypedDecl & { kind: "const" };
      // With non-literal index, returns union
      expect(xDecl.init.type.kind).toBe("union");
    });
  });

  describe("spread in records", () => {
    test("spread merges record types", () => {
      const result = check(`
        const base = { a: 1, b: 2 };
        const extended = { ...base, c: 3 };
      `);
      const extDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(extDecl.init.type.kind).toBe("record");
      const rec = extDecl.init.type as Type & { kind: "record" };
      expect(rec.fields.map(f => f.name)).toContain("a");
      expect(rec.fields.map(f => f.name)).toContain("b");
      expect(rec.fields.map(f => f.name)).toContain("c");
    });

    test("spread with override takes later value type", () => {
      const result = check(`
        const base = { a: 1, b: 2 };
        const overridden = { ...base, a: "hello" };
      `);
      const extDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(extDecl.init.type.kind).toBe("record");
      const rec = extDecl.init.type as Type & { kind: "record" };
      // Should have exactly 2 fields, not 3
      expect(rec.fields.length).toBe(2);
      // Field 'a' should have the overridden type
      const fieldA = rec.fields.find(f => f.name === "a");
      expect(fieldA?.type.kind).toBe("literal");
      expect((fieldA?.type as any).value).toBe("hello");
    });

    test("spread override preserves field order", () => {
      const result = check(`
        const base = { a: 1, b: 2, c: 3 };
        const overridden = { ...base, b: "mid" };
      `);
      const extDecl = result.decls[1] as TypedDecl & { kind: "const" };
      const rec = extDecl.init.type as Type & { kind: "record" };
      expect(rec.fields.length).toBe(3);
      expect(rec.fields.map(f => f.name)).toEqual(["a", "b", "c"]);
    });
  });

  describe("contextual typing", () => {
    // Note: Array types don't have .map method in type system yet
    // test("lambda param types from contextual type") - skipped

    test("array literal widens with contextual type", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
      `);
      const decl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(decl.declType.kind).toBe("array");
      if (decl.declType.kind === "array") {
        expect(isVariadicArray(decl.declType)).toBe(true);
      }
    });

    test("record literal widens with contextual type", () => {
      const result = check(`
        const r: { a: Int } = { a: 42 };
      `);
      const decl = result.decls[0] as TypedDecl & { kind: "const" };
      const rec = decl.declType as Type & { kind: "record" };
      expect(rec.fields[0].type.kind).toBe("primitive");
    });
  });

  describe("generics", () => {
    describe("parameterized type declarations", () => {
      test("simple parameterized type", () => {
        // type Box<T> = { value: T } desugars to a function
        const result = check(`
          type Box<T> = { value: T };
        `);
        const boxDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(boxDecl.name).toBe("Box");
        // Box should be a function: (T: Type) => Type
        expect(boxDecl.init.type.kind).toBe("function");
      });

      test("parameterized type with multiple parameters", () => {
        const result = check(`
          type Pair<A, B> = { first: A, second: B };
        `);
        const pairDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(pairDecl.name).toBe("Pair");
        expect(pairDecl.init.type.kind).toBe("function");
        const fnType = pairDecl.init.type as Type & { kind: "function" };
        expect(fnType.params).toHaveLength(2);
      });

      test("parameterized type instantiation", () => {
        // Using a parameterized type with explicit type arguments
        const result = check(`
          type Box<T> = { value: T };
          const intBox: Box<Int> = { value: 42 };
        `);
        expect(result.decls).toHaveLength(2);
        const boxDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(boxDecl.declType.kind).toBe("withMetadata");
      });

      test("parameterized type preserves metadata", () => {
        const result = check(`
          type Container<T> = { item: T };
          const c: Container<String> = { item: "hello" };
        `);
        const cDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // The declared type should be Container<String> wrapped in metadata
        expect(cDecl.declType.kind).toBe("withMetadata");
        const meta = cDecl.declType as Type & { kind: "withMetadata" };
        expect(meta.metadata?.name).toBe("Container");
      });

      test("nested parameterized types", () => {
        const result = check(`
          type Box<T> = { value: T };
          type DoubleBox<T> = { outer: Box<T> };
          const db: DoubleBox<Int> = { outer: { value: 42 } };
        `);
        expect(result.decls).toHaveLength(3);
      });
    });

    describe("using parameterized types", () => {
      test("Array<T> instantiation", () => {
        const result = check(`
          const arr: Array<Int> = [1, 2, 3];
        `);
        const decl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(decl.declType.kind).toBe("array");
      });

      test("type argument inference from value context", () => {
        // When using a parameterized type, the value must match
        const result = check(`
          type Box<T> = { value: T };
          const b: Box<Int> = { value: 42 };
        `);
        expect(result.decls).toHaveLength(2);
      });

      test("type argument mismatch throws error", () => {
        expect(() => check(`
          type Box<T> = { value: T };
          const b: Box<Int> = { value: "hello" };
        `)).toThrow(/not assignable/);
      });

      test("multiple type arguments", () => {
        const result = check(`
          type Either<L, R> = { left: L, right: R };
          const e: Either<Int, String> = { left: 1, right: "hello" };
        `);
        expect(result.decls).toHaveLength(2);
      });
    });

    describe("generic constraints", () => {
      test("type parameter with extends constraint", () => {
        const result = check(`
          type Lengthwise = { length: Int };
          type WithLength<T extends Lengthwise> = { item: T };
        `);
        const decl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(decl.init.type.kind).toBe("function");
      });

      test("constrained type accepts valid type argument", () => {
        const result = check(`
          type Lengthwise = { length: Int };
          type WithLength<T extends Lengthwise> = { item: T };
          type HasLength = { length: Int, name: String };
          const w: WithLength<HasLength> = { item: { length: 5, name: "test" } };
        `);
        expect(result.decls).toHaveLength(4);
      });

      test("constrained type rejects invalid type argument", () => {
        expect(() => check(`
          type Lengthwise = { length: Int };
          type WithLength<T extends Lengthwise> = { item: T };
          const w: WithLength<Int> = { item: 42 };  // Int doesn't have length
        `)).toThrow();
      });
    });

    describe("generic function types", () => {
      // Generic function types like `<T>(x: T) => T` desugar to:
      // (T: Type) => FunctionType([{ name: "x", type: T }], T)
      // This makes them parameterized types (functions from Type to FunctionType).

      test("function type with type parameter in annotation", () => {
        const result = check(`
          type Identity = <T>(x: T) => T;
        `);
        const decl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(decl.name).toBe("Identity");
        // Identity is now a function from Type to FunctionType
      });

      test("function type with multiple type parameters", () => {
        const result = check(`
          type MapFn = <A, B>(arr: Array<A>, f: (a: A) => B) => Array<B>;
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("generic function type with constraint", () => {
        const result = check(`
          type Lengthwise = { length: Number };
          type LoggingFn = <T extends Lengthwise>(x: T) => T;
        `);
        expect(result.decls).toHaveLength(2);
      });

      test("instantiate generic function type", () => {
        const result = check(`
          type Identity = <T>(x: T) => T;
          type StringIdentity = Identity<String>;
        `);
        expect(result.decls).toHaveLength(2);
        const stringIdDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(stringIdDecl.name).toBe("StringIdentity");
      });

      // Note: Generic arrow function syntax (<T>(x: T) => x) is not yet supported
      // in expression position. Only type declarations and annotations support
      // the generic syntax.
    });

    describe("default type parameters", () => {
      test("calling parameterized type without args uses default", () => {
        // Calling Box() without arguments uses the default T = Int
        const result = check(`
          type Box<T = Int> = { value: T };
          const BoxType = Box();
        `);
        expect(result.decls).toHaveLength(2);
      });

      test("explicit type arg overrides default", () => {
        const result = check(`
          type Container<T = String> = { value: T };
          const ContainerInt = Container(Int);
        `);
        expect(result.decls).toHaveLength(2);
      });

      test("type annotation uses default when no args provided", () => {
        // Container<> or just Container should use the default
        const result = check(`
          type Container<T = String> = { value: T };
          const ContainerStr = Container();
          const c: ContainerStr = { value: "hello" };
        `);
        expect(result.decls).toHaveLength(3);
      });

      test("multiple params - first required, second has default", () => {
        const result = check(`
          type KeyValue<K, V = String> = { key: K, value: V };
          const KVInt = KeyValue(Int);
          const kv: KVInt = { key: 42, value: "hello" };
        `);
        expect(result.decls).toHaveLength(3);
      });

      test("all params have defaults", () => {
        const result = check(`
          type Defaults<A = Int, B = String> = { a: A, b: B };
          const D1 = Defaults();
          const d: D1 = { a: 1, b: "hi" };
        `);
        expect(result.decls).toHaveLength(3);
      });

      test("default with complex type expression", () => {
        const result = check(`
          type ArrayOf<T = Int | String> = { items: T[] };
          const ArrType = ArrayOf();
        `);
        expect(result.decls).toHaveLength(2);
      });
    });

    describe("type properties on parameterized types", () => {
      test(".typeArgs returns type arguments", () => {
        const result = check(`
          type Box<T> = { value: T };
          const IntBox = Box(Int);
          const args = IntBox.typeArgs;
        `);
        const argsDecl = result.decls[2] as TypedDecl & { kind: "const" };
        expect(argsDecl.init.comptimeOnly).toBe(true);
      });

      test(".baseName returns base type name", () => {
        const result = check(`
          type Container<T> = { item: T };
          const IntContainer = Container(Int);
          const baseName = IntContainer.baseName;
        `);
        const baseNameDecl = result.decls[2] as TypedDecl & { kind: "const" };
        // baseName should be runtime-usable (returns String)
        expect(baseNameDecl.init.comptimeOnly).toBe(false);
      });
    });
  });

  describe("intersection types", () => {
    test("intersection type annotation", () => {
      const result = check(`
        type Named = { name: String };
        type Aged = { age: Int };
        const p: Named & Aged = { name: "Alice", age: 30 };
      `);
      expect(result.decls).toHaveLength(3);
    });

    test("intersection combines record fields", () => {
      // A value of type Named & Aged must have both name and age
      const result = check(`
        type Named = { name: String };
        type Aged = { age: Int };
        const p: Named & Aged = { name: "Bob", age: 25 };
      `);
      const pDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(pDecl.declType.kind).toBe("intersection");
    });

    test("intersection requires all fields present", () => {
      expect(() => check(`
        type Named = { name: String };
        type Aged = { age: Int };
        const p: Named & Aged = { name: "Charlie" };
      `)).toThrow(/not assignable/);
    });

    test("multi-way intersection", () => {
      const result = check(`
        type A = { a: Int };
        type B = { b: String };
        type C = { c: Boolean };
        const x: A & B & C = { a: 1, b: "hi", c: true };
      `);
      expect(result.decls).toHaveLength(4);
    });

    test("intersection with primitive types via Intersection()", () => {
      // Using Intersection builtin in expression context
      const result = check(`
        const IntAndNonZero = Intersection(Int, Int);
      `);
      expect(result.decls).toHaveLength(1);
    });
  });

  describe("overloaded functions (function intersections)", () => {
    // Overloaded functions from .d.ts are represented as intersections of function types:
    // const parse: ((String) => Number) & ((Number) => String)

    test("intersection of function types via & syntax", () => {
      const result = check(`
        type Parse = ((x: String) => Number) & ((x: Number) => String);
      `);
      expect(result.decls).toHaveLength(1);
      const parseDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(parseDecl.name).toBe("Parse");
    });

    test("intersection of function types via Intersection()", () => {
      const result = check(`
        const Parse = Intersection(
          FunctionType([{ name: "x", type: String, optional: false }], Number),
          FunctionType([{ name: "x", type: Number, optional: false }], String)
        );
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("overloaded function type subtyping verified in subtype.test.ts", () => {
      // Subtyping of overloaded functions is tested in subtype.test.ts
      // Here we just verify the intersection type is created correctly
      const result = check(`
        type Overloaded = ((x: String) => Number) & ((x: Number) => String);
      `);
      expect(result.decls).toHaveLength(1);
    });

    // Calling overloaded functions
    // We test the call behavior by wrapping the overloaded function in a higher-order function
    // that accepts it as a parameter (thus the parameter gets the intersection type).
    test("call overloaded function - first signature matches", () => {
      const result = check(`
        type Parse = ((x: String) => Int) & ((x: Int) => String);
        const callWithString = (p: Parse): Int => p("hello");
      `);
      const callDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // The return type should be Int (first signature matches)
      const fnType = callDecl.init.type as Type & { kind: "function" };
      expect(fnType.returnType).toEqual(primitiveType("Int"));
    });

    test("call overloaded function - second signature matches", () => {
      const result = check(`
        type Parse = ((x: String) => Int) & ((x: Int) => String);
        const callWithInt = (p: Parse): String => p(42);
      `);
      const callDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // The return type should be String (second signature matches)
      const fnType = callDecl.init.type as Type & { kind: "function" };
      expect(fnType.returnType).toEqual(primitiveType("String"));
    });

    test("call overloaded function - union argument returns union", () => {
      const result = check(`
        type Parse = ((x: String) => Int) & ((x: Int) => String);
        const callWithUnion = (p: Parse, input: String | Int) => p(input);
      `);
      const callDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // The return type should be Int | String
      const fnType = callDecl.init.type as Type & { kind: "function" };
      expect(fnType.returnType.kind).toBe("union");
    });

    test("call overloaded function - no matching signature", () => {
      expect(() =>
        check(`
          type Parse = ((x: String) => Int) & ((x: Int) => String);
          const callWithBool = (p: Parse) => p(true);
        `)
      ).toThrow(/No overload matches/);
    });

    test("call overloaded function - three-way overload", () => {
      const result = check(`
        type Triple = ((x: String) => Int) & ((x: Int) => String) & ((x: Boolean) => Float);
        const callString = (t: Triple): Int => t("a");
        const callInt = (t: Triple): String => t(1);
        const callBool = (t: Triple): Float => t(true);
      `);
      // Verify each call returns the correct type
      const callStringDecl = result.decls[1] as TypedDecl & { kind: "const" };
      const callIntDecl = result.decls[2] as TypedDecl & { kind: "const" };
      const callBoolDecl = result.decls[3] as TypedDecl & { kind: "const" };

      const callStringFn = callStringDecl.init.type as Type & { kind: "function" };
      const callIntFn = callIntDecl.init.type as Type & { kind: "function" };
      const callBoolFn = callBoolDecl.init.type as Type & { kind: "function" };

      expect(callStringFn.returnType).toEqual(primitiveType("Int"));
      expect(callIntFn.returnType).toEqual(primitiveType("String"));
      expect(callBoolFn.returnType).toEqual(primitiveType("Float"));
    });

    // .signatures property
    test(".signatures returns array of function types", () => {
      const result = check(`
        type Parse = ((x: String) => Int) & ((x: Int) => String);
        const sigs = Parse.signatures;
      `);
      const sigsDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(sigsDecl.init.comptimeOnly).toBe(true);
      // Type should be Array<Type>
      expect(sigsDecl.init.type.kind).toBe("array");
    });

    test(".signatures throws for non-intersection types", () => {
      expect(() =>
        check(`
          const sigs = Int.signatures;
        `)
      ).toThrow(/only valid on intersection types/);
    });

    test(".signatures throws for single function type", () => {
      expect(() =>
        check(`
          type Fn = (x: String) => Int;
          const sigs = Fn.signatures;
        `)
      ).toThrow(/only valid on intersection types/);
    });

    // Ambiguity errors for .returnType and .parameterTypes
    test(".returnType throws for overloaded functions", () => {
      expect(() =>
        check(`
          type Parse = ((x: String) => Int) & ((x: Int) => String);
          const ret = Parse.returnType;
        `)
      ).toThrow(/ambiguous/);
    });

    test(".parameterTypes throws for overloaded functions", () => {
      expect(() =>
        check(`
          type Parse = ((x: String) => Int) & ((x: Int) => String);
          const params = Parse.parameterTypes;
        `)
      ).toThrow(/ambiguous/);
    });

    // .returnType and .parameterTypes still work for single function types
    test(".returnType works for single function type", () => {
      const result = check(`
        type Fn = (x: String) => Int;
        const ret = Fn.returnType;
      `);
      const retDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(retDecl.init.comptimeOnly).toBe(true);
    });

    test(".parameterTypes works for single function type", () => {
      const result = check(`
        type Fn = (x: String) => Int;
        const params = Fn.parameterTypes;
      `);
      const paramsDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(paramsDecl.init.comptimeOnly).toBe(true);
    });
  });

  describe("array type properties", () => {
    test(".elementType on variable array", () => {
      const result = check(`
        type Ints = Int[];
        const elem = Ints.elementType;
      `);
      const elemDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(elemDecl.init.comptimeOnly).toBe(true);
    });

    test(".elementType on fixed array", () => {
      const result = check(`
        type Point = [Int, Int];
        const elem = Point.elementType;
      `);
      const elemDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(elemDecl.init.comptimeOnly).toBe(true);
    });

    test(".isFixed on variable array", () => {
      const result = check(`
        type Ints = Int[];
        const fixed = Ints.isFixed;
      `);
      const fixedDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // isFixed should be runtime-usable (returns Boolean)
      expect(fixedDecl.init.comptimeOnly).toBe(false);
    });

    test(".isFixed on fixed array", () => {
      const result = check(`
        type Point = [Int, Int];
        const fixed = Point.isFixed;
      `);
      const fixedDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(fixedDecl.init.comptimeOnly).toBe(false);
    });

    test(".length on fixed array", () => {
      const result = check(`
        type Triple = [Int, Int, Int];
        const len = Triple.length;
      `);
      const lenDecl = result.decls[1] as TypedDecl & { kind: "const" };
      // length is runtime-usable for fixed arrays
      expect(lenDecl.init.comptimeOnly).toBe(false);
    });
  });

  describe("index signatures", () => {
    test("indexed record type annotation", () => {
      const result = check(`
        const map: { [key: String]: Int } = {};
      `);
      expect(result.decls).toHaveLength(1);
      const decl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(decl.declType.kind).toBe("record");
    });

    test("indexed record accepts any string key", () => {
      // This tests that index signatures allow dynamic string access
      const result = check(`
        type StringIntMap = { [key: String]: Int };
        const getValue = (m: StringIntMap, k: String): Int | Undefined => m[k];
      `);
      expect(result.decls).toHaveLength(2);
    });
  });

  describe("TypeScript utility type patterns", () => {
    // These tests verify that utility type patterns from TypeScript
    // can be implemented in DepJS using first-class type manipulation.

    test("Nullable - add null to any type", () => {
      const result = check(`
        const Nullable = (T: Type): Type => Union(T, Null);

        const NullableInt = Nullable(Int);
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("NonNullable - remove null/undefined from union", () => {
      // .extends() now returns Boolean
      const result = check(`
        const NonNullable = (T: Type): Type =>
          T.extends(Union(Null, Undefined)) ? Never : T;

        const NNString = NonNullable(String);
        const NNNull = NonNullable(Null);
      `);
      expect(result.decls).toHaveLength(3);
    });

    test("Extract - extract union members matching constraint", () => {
      const result = check(`
        const Extract = (T: Type, U: Type): Type =>
          T.extends(U) ? T : Never;
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("Exclude - remove union members matching constraint", () => {
      const result = check(`
        const Exclude = (T: Type, U: Type): Type =>
          T.extends(U) ? Never : T;
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("ReturnType - extract function return type", () => {
      // T.returnType now returns Type
      const result = check(`
        const ReturnType = (T: Type): Type => T.returnType;

        type Fn = (x: Int) => String;
        const Result = ReturnType(Fn);
      `);
      expect(result.decls).toHaveLength(3);
    });

    test("Parameters - extract function parameter types", () => {
      // T.parameterTypes now returns Array<Type>
      const result = check(`
        const Parameters = (T: Type): Array<Type> => T.parameterTypes;

        type Fn = (x: Int, y: String) => Boolean;
        const Params = Parameters(Fn);
      `);
      expect(result.decls).toHaveLength(3);
    });

    // Array method typing is now supported
    test("array .map method type checking", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
        const doubled = arr.map(x => x * 2);
      `);
      expect(result.decls).toHaveLength(2);
      // doubled should have type Int[] (Array<Int>)
      const doubledDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(doubledDecl.init.type.kind).toBe("array");
    });

    test("array .filter method type checking", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3, 4];
        const evens = arr.filter(x => (x % 2) == 0);
      `);
      expect(result.decls).toHaveLength(2);
      const evensDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(evensDecl.init.type.kind).toBe("array");
    });

    test("array .find method type checking", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
        const found = arr.find(x => x > 1);
      `);
      expect(result.decls).toHaveLength(2);
      // found should have type Int | Undefined
      const foundDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(foundDecl.init.type.kind).toBe("union");
    });

    test("array method chaining", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3, 4, 5];
        const result = arr.filter(x => x > 2).map(x => x * 10);
      `);
      expect(result.decls).toHaveLength(2);
      const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(resultDecl.init.type.kind).toBe("array");
    });

    test("T.fields.map pattern for Partial", () => {
      // DepJS blocks return the last expression (no explicit return keyword)
      const result = check(`
        const Partial = (T: Type): Type => {
          const newFields = T.fields.map(f => ({
            name: f.name,
            type: f.type,
            optional: true,
            annotations: f.annotations
          }));
          RecordType(newFields)
        };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("T.fields.filter pattern for Pick", () => {
      // DepJS blocks return the last expression (no explicit return keyword)
      const result = check(`
        const Pick = (T: Type, keys: String[]): Type => {
          const newFields = T.fields.filter(f => keys.includes(f.name));
          RecordType(newFields)
        };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("array .reduce method type checking", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
        const sum = arr.reduce((acc, x) => acc + x, 0);
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("array .some and .every type checking", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
        const hasPositive = arr.some(x => x > 0);
        const allPositive = arr.every(x => x > 0);
      `);
      expect(result.decls).toHaveLength(3);
      const hasPositiveDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(hasPositiveDecl.init.type.kind).toBe("primitive");
    });

    test("array .includes type checking", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
        const has2 = arr.includes(2);
      `);
      expect(result.decls).toHaveLength(2);
      const has2Decl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(has2Decl.init.type.kind).toBe("primitive");
    });

    test("array .length property", () => {
      const result = check(`
        const arr: Int[] = [1, 2, 3];
        const len = arr.length;
      `);
      expect(result.decls).toHaveLength(2);
      const lenDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(lenDecl.init.type.kind).toBe("primitive");
    });

    // String method type checking
    test("string .length property", () => {
      const result = check(`
        const str: String = "hello";
        const len = str.length;
      `);
      expect(result.decls).toHaveLength(2);
      const lenDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(lenDecl.init.type.kind).toBe("primitive");
      expect((lenDecl.init.type as any).name).toBe("Int");
    });

    test("string .toUpperCase and .toLowerCase", () => {
      const result = check(`
        const str: String = "Hello";
        const upper = str.toUpperCase();
        const lower = str.toLowerCase();
      `);
      expect(result.decls).toHaveLength(3);
      const upperDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(upperDecl.init.type.kind).toBe("primitive");
      expect((upperDecl.init.type as any).name).toBe("String");
    });

    test("string .split method", () => {
      const result = check(`
        const str: String = "a,b,c";
        const parts = str.split(",");
      `);
      expect(result.decls).toHaveLength(2);
      const partsDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(partsDecl.init.type.kind).toBe("array");
    });

    test("string .includes and search methods", () => {
      const result = check(`
        const str: String = "hello world";
        const has = str.includes("world");
        const idx = str.indexOf("o");
        const starts = str.startsWith("hello");
        const ends = str.endsWith("world");
      `);
      expect(result.decls).toHaveLength(5);
      const hasDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(hasDecl.init.type.kind).toBe("primitive");
      expect((hasDecl.init.type as any).name).toBe("Boolean");
      const idxDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect((idxDecl.init.type as any).name).toBe("Int");
    });

    test("string .substring and .slice", () => {
      const result = check(`
        const str: String = "hello";
        const sub = str.substring(1, 3);
        const sliced = str.slice(1, 3);
      `);
      expect(result.decls).toHaveLength(3);
      const subDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(subDecl.init.type.kind).toBe("primitive");
      expect((subDecl.init.type as any).name).toBe("String");
    });

    test("string .trim methods", () => {
      const result = check(`
        const str: String = "  hello  ";
        const trimmed = str.trim();
        const trimStart = str.trimStart();
        const trimEnd = str.trimEnd();
      `);
      expect(result.decls).toHaveLength(4);
    });

    test("string .replace and .replaceAll", () => {
      const result = check(`
        const str: String = "hello world";
        const replaced = str.replace("world", "there");
        const allReplaced = str.replaceAll("l", "L");
      `);
      expect(result.decls).toHaveLength(3);
    });

    test("string .padStart and .padEnd", () => {
      const result = check(`
        const num: String = "42";
        const padded = num.padStart(5, "0");
        const paddedEnd = num.padEnd(5, "-");
      `);
      expect(result.decls).toHaveLength(3);
    });

    test("string method chaining", () => {
      const result = check(`
        const str: String = "  HELLO  ";
        const processed = str.trim().toLowerCase().replace("hello", "world");
      `);
      expect(result.decls).toHaveLength(2);
      const processedDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(processedDecl.init.type.kind).toBe("primitive");
      expect((processedDecl.init.type as any).name).toBe("String");
    });

    test("literal string type methods", () => {
      // Methods should work on literal string types too
      const result = check(`
        const greeting = "hello";
        const upper = greeting.toUpperCase();
      `);
      expect(result.decls).toHaveLength(2);
      const upperDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(upperDecl.init.type.kind).toBe("primitive");
      expect((upperDecl.init.type as any).name).toBe("String");
    });
  });

  describe("discriminated unions", () => {
    test("discriminated union type - ok variant", () => {
      const result = check(`
        type Result =
          | { kind: "ok", value: Int }
          | { kind: "error", message: String };
        const ok: Result = { kind: "ok", value: 42 };
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("discriminated union type - error variant", () => {
      const result = check(`
        type Result =
          | { kind: "ok", value: Int }
          | { kind: "error", message: String };
        const err: Result = { kind: "error", message: "oops" };
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("discriminated union rejects wrong variant shape", () => {
      expect(() => check(`
        type Result =
          | { kind: "ok", value: Int }
          | { kind: "error", message: String };
        const bad: Result = { kind: "ok", message: "wrong field" };
      `)).toThrow(/not assignable/);
    });

    test("discriminated union with number discriminant", () => {
      const result = check(`
        type Status =
          | { code: 200, data: String }
          | { code: 404, message: String };
        const success: Status = { code: 200, data: "hello" };
        const notFound: Status = { code: 404, message: "not found" };
      `);
      expect(result.decls).toHaveLength(3);
    });
  });

  describe("literal types in unions", () => {
    test("string literal union", () => {
      const result = check(`
        type Direction = "north" | "south" | "east" | "west";
        const d: Direction = "north";
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("string literal union accepts any valid value", () => {
      const result = check(`
        type Direction = "north" | "south" | "east" | "west";
        const n: Direction = "north";
        const s: Direction = "south";
        const e: Direction = "east";
        const w: Direction = "west";
      `);
      expect(result.decls).toHaveLength(5);
    });

    test("string literal union rejects invalid value", () => {
      expect(() => check(`
        type Direction = "north" | "south" | "east" | "west";
        const d: Direction = "up";
      `)).toThrow(/not assignable/);
    });

    test("number literal union", () => {
      const result = check(`
        type DiceRoll = 1 | 2 | 3 | 4 | 5 | 6;
        const roll: DiceRoll = 4;
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("number literal union rejects out of range", () => {
      expect(() => check(`
        type DiceRoll = 1 | 2 | 3 | 4 | 5 | 6;
        const roll: DiceRoll = 7;
      `)).toThrow(/not assignable/);
    });

    test("boolean literal type", () => {
      const result = check(`
        type Yes = true;
        const y: Yes = true;
      `);
      expect(result.decls).toHaveLength(2);
    });

    test("boolean literal type rejects wrong value", () => {
      expect(() => check(`
        type Yes = true;
        const n: Yes = false;
      `)).toThrow(/not assignable/);
    });

    test("mixed literal union", () => {
      const result = check(`
        type MixedLiteral = "a" | 1 | true;
        const s: MixedLiteral = "a";
        const n: MixedLiteral = 1;
        const b: MixedLiteral = true;
      `);
      expect(result.decls).toHaveLength(4);
    });
  });

  describe("This type (fluent interfaces)", () => {
    test("record type with function field (no This)", () => {
      // First test: can we have function-typed fields at all?
      const result = check(`
        type Action = { run: (x: Int) => Int };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("This type is available as builtin", () => {
      // This is a special type that refers to the enclosing type
      // Note: Use commas, not semicolons, as field separators in record types
      const result = check(`
        type Builder = {
          name: String,
          setName: (name: String) => This
        };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("record type with This in method return", () => {
      // Verify This is accepted in record type definitions
      const result = check(`
        type Builder = {
          name: String,
          setName: (name: String) => This,
          setValue: (value: Int) => This
        };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("This is substituted with receiver type on method access", () => {
      // When accessing a method that returns This, the return type
      // should be substituted with the receiver's type
      //
      // Use a function parameter to avoid self-reference in const declaration
      const result = check(`
        type Builder = {
          name: String,
          setName: (name: String) => This
        };
        const getSetName = (b: Builder) => b.setName;
      `);
      // getSetName returns a function (String) => Builder
      const fnDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(fnDecl.init.type.kind).toBe("function");
      const outerFn = fnDecl.init.type as Type & { kind: "function" };
      // The return type of getSetName should be (String) => Builder
      expect(outerFn.returnType.kind).toBe("function");
      const innerFn = outerFn.returnType as Type & { kind: "function" };
      // The return type of setName should be Builder (This substituted), not "this"
      // Builder is withMetadata wrapping a record, so unwrap to check
      expect(unwrapMetadata(innerFn.returnType).kind).toBe("record");
    });

    test("This substitution on method call", () => {
      const result = check(`
        type Builder = {
          name: String,
          setName: (name: String) => This
        };
        const callSetName = (b: Builder, name: String) => b.setName(name);
      `);
      // callSetName returns Builder (record), not This
      const fnDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(fnDecl.init.type.kind).toBe("function");
      const outerFn = fnDecl.init.type as Type & { kind: "function" };
      // The return type should be Builder (withMetadata wrapping record)
      expect(unwrapMetadata(outerFn.returnType).kind).toBe("record");
    });

    test("This enables fluent method chaining", () => {
      const result = check(`
        type Builder = {
          name: String,
          value: Int,
          setName: (name: String) => This,
          setValue: (value: Int) => This
        };
        const chain = (b: Builder) => b.setName("test").setValue(42);
      `);
      // chain returns Builder (withMetadata wrapping record)
      const fnDecl = result.decls[1] as TypedDecl & { kind: "const" };
      expect(fnDecl.init.type.kind).toBe("function");
      const fn = fnDecl.init.type as Type & { kind: "function" };
      expect(unwrapMetadata(fn.returnType).kind).toBe("record");
    });

    test("This preserves concrete type through subtyping", () => {
      // When a value has a more specific type than its declared type,
      // This should resolve to the concrete receiver type
      const result = check(`
        type Base = {
          name: String,
          setName: (name: String) => This
        };
        type Extended = {
          name: String,
          extra: Int,
          setName: (name: String) => This
        };
        const callOnExtended = (e: Extended) => e.setName("hello");
      `);
      // callOnExtended returns Extended (with extra field), not Base
      const fnDecl = result.decls[2] as TypedDecl & { kind: "const" };
      expect(fnDecl.init.type.kind).toBe("function");
      const fn = fnDecl.init.type as Type & { kind: "function" };
      const unwrappedReturn = unwrapMetadata(fn.returnType);
      expect(unwrappedReturn.kind).toBe("record");
      const recType = unwrappedReturn as Type & { kind: "record" };
      // Should have extra field
      expect(recType.fields.map(f => f.name)).toContain("extra");
    });

    test("This in nested function types within record", () => {
      // This should work in nested function contexts
      const result = check(`
        type Chainable = {
          value: Int,
          transform: (f: (x: Int) => Int) => This
        };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("This used outside record context throws", () => {
      // Using This as a standalone type annotation doesn't make sense
      // and nothing is assignable to it
      expect(() => check(`
        const x: This = 42;
      `)).toThrow(/not assignable/);
    });
  });

  describe("match expressions", () => {
    describe("literal patterns", () => {
      test("matches integer literal", () => {
        const result = check(`
          const x = 42;
          const result = match (x) {
            case 42: "matched";
            case _: "default";
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // Return type is union of branch types
        expect(resultDecl.init.type.kind).toBe("union");
      });

      test("matches string literal", () => {
        const result = check(`
          const x = "hello";
          const result = match (x) {
            case "hello": 1;
            case "world": 2;
            case _: 0;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("union");
      });

      test("matches boolean literal", () => {
        const result = check(`
          const flag = true;
          const result = match (flag) {
            case true: "yes";
            case false: "no";
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("union");
      });
    });

    describe("wildcard pattern", () => {
      test("wildcard matches anything", () => {
        const result = check(`
          const x = 42;
          const result = match (x) {
            case _: "default";
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("literal");
      });

      test("wildcard as catch-all", () => {
        const result = check(`
          const x: Int = 42;
          const result = match (x) {
            case 1: "one";
            case 2: "two";
            case _: "other";
          };
        `);
        expect(result.decls).toHaveLength(2);
      });
    });

    describe("binding patterns", () => {
      test("binding captures matched value", () => {
        const result = check(`
          const x = 42;
          const result = match (x) {
            case n: n + 1;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // n is bound to Int (or literal 42), n + 1 should be Int
        expect(resultDecl.init.type.kind).toBe("primitive");
      });

      test("binding available in body", () => {
        const result = check(`
          const x: String = "hello";
          const result = match (x) {
            case s: s;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type).toEqual(primitiveType("String"));
      });
    });

    describe("destructure patterns", () => {
      test("destructures record fields", () => {
        const result = check(`
          const point = { x: 1, y: 2 };
          const result = match (point) {
            case { x, y }: x + y;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("primitive");
      });

      test("destructure with renamed binding", () => {
        const result = check(`
          const person = { name: "Alice", age: 30 };
          const result = match (person) {
            case { name: n }: n;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("literal");
      });

      test("nested destructure", () => {
        const result = check(`
          const data = { outer: { inner: 42 } };
          const result = match (data) {
            case { outer: { inner } }: inner;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("literal");
      });
    });

    describe("guards (when clause)", () => {
      test("guard with comparison", () => {
        const result = check(`
          const x: Int = 42;
          const result = match (x) {
            case n when n > 0: "positive";
            case n when n < 0: "negative";
            case _: "zero";
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("union");
      });

      test("guard must be boolean", () => {
        expect(() => check(`
          const x = 42;
          const result = match (x) {
            case n when n: "truthy";
          };
        `)).toThrow(/Boolean/);
      });

      test("guard can access bound variables", () => {
        const result = check(`
          const pair = { a: 1, b: 2 };
          const result = match (pair) {
            case { a, b } when a < b: "a is smaller";
            case _: "otherwise";
          };
        `);
        expect(result.decls).toHaveLength(2);
      });
    });

    describe("return type", () => {
      test("return type is union of all branch types", () => {
        const result = check(`
          const x: Int = 1;
          const result = match (x) {
            case 1: "one";
            case 2: 2;
            case _: true;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("union");
        const union = resultDecl.init.type as Type & { kind: "union"; types: Type[] };
        expect(union.types.length).toBe(3);
      });

      test("same return type in all branches", () => {
        const result = check(`
          const x: Int = 1;
          const result = match (x) {
            case 1: 10;
            case 2: 20;
            case _: 0;
          };
        `);
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // All branches return int literals, should be union
        expect(resultDecl.init.type.kind).toBe("union");
      });
    });

    describe("complex cases", () => {
      test("match with record destructuring", () => {
        // Note: full discriminated union matching with literal checks in destructure
        // would require type patterns. This tests basic record destructuring.
        const result = check(`
          const data = { x: 1, y: 2 };
          const result = match (data) {
            case { x, y }: x + y;
          };
        `);
        const resultDecl = result.decls.find(d => d.kind === "const" && d.name === "result") as TypedDecl & { kind: "const" };
        expect(resultDecl).toBeDefined();
        expect(resultDecl.init.type.kind).toBe("primitive");
      });

      test("match expression as function argument", () => {
        const result = check(`
          const double = (x: Int) => x * 2;
          const x: Int = 1;
          const result = double(match (x) {
            case 1: 10;
            case _: 0;
          });
        `);
        const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("primitive");
      });

      test("nested match expressions", () => {
        const result = check(`
          const x: Int = 1;
          const y: Int = 2;
          const result = match (x) {
            case 1: match (y) {
              case 2: "x=1,y=2";
              case _: "x=1,y!=2";
            };
            case _: "x!=1";
          };
        `);
        const resultDecl = result.decls[2] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type.kind).toBe("union");
      });
    });
  });

  describe("async/await", () => {
    describe("async functions", () => {
      test("async arrow function parses and typechecks", () => {
        const result = check(`
          const f = async (x: Int) => x + 1;
        `);
        const fDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(fDecl.init.type.kind).toBe("function");
        const fnType = fDecl.init.type as FunctionType;
        expect(fnType.async).toBe(true);
      });

      test("async function has async flag in type", () => {
        const typed = checkExpr("async (x: Int) => x");
        expect(typed.type.kind).toBe("function");
        const fnType = typed.type as FunctionType;
        expect(fnType.async).toBe(true);
        expect(fnType.returnType).toEqual(primitiveType("Int"));
      });

      test("non-async function has async=false", () => {
        const typed = checkExpr("(x: Int) => x");
        expect(typed.type.kind).toBe("function");
        const fnType = typed.type as FunctionType;
        expect(fnType.async).toBe(false);
      });

      test("async function with multiple params", () => {
        const result = check(`
          const f = async (a: Int, b: String) => a;
        `);
        const fDecl = result.decls[0] as TypedDecl & { kind: "const" };
        const fnType = fDecl.init.type as FunctionType;
        expect(fnType.async).toBe(true);
        expect(fnType.params).toHaveLength(2);
      });

      test("async function with explicit return type", () => {
        const result = check(`
          const f = async (x: Int): Int => x + 1;
        `);
        const fDecl = result.decls[0] as TypedDecl & { kind: "const" };
        const fnType = fDecl.init.type as FunctionType;
        expect(fnType.async).toBe(true);
        expect(fnType.returnType).toEqual(primitiveType("Int"));
      });
    });

    describe("await expressions", () => {
      test("await on Promise unwraps to inner type", () => {
        // Create a Promise<Int> type using withMetadata
        const result = check(`
          type Promise<T> = { __promiseValue: T };
          const p: Promise<Int> = { __promiseValue: 42 };
          const x = await p;
        `);
        const xDecl = result.decls.find(d => d.kind === "const" && d.name === "x") as TypedDecl & { kind: "const" };
        // The await should unwrap Promise<Int> to Int
        expect(xDecl.init.type).toEqual(primitiveType("Int"));
      });

      test("await on non-Promise returns same type", () => {
        // When awaiting a non-Promise, the type passes through
        const result = check(`
          const x = 42;
          const y = await x;
        `);
        const yDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // Awaiting a non-Promise just returns the same type
        expect(yDecl.init.type.kind).toBe("literal");
      });

      test("await expression is not comptimeOnly", () => {
        const result = check(`
          const x = 42;
          const y = await x;
        `);
        const yDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(yDecl.init.comptimeOnly).toBe(false);
      });

      test("await in async function body", () => {
        const result = check(`
          type Promise<T> = { __promiseValue: T };
          const fetchData: () => Promise<String> = () => ({ __promiseValue: "data" });
          const processData = async () => {
            const data = await fetchData();
            data;
          };
        `);
        expect(result.decls).toHaveLength(3);
      });

      test("multiple await expressions", () => {
        const result = check(`
          type Promise<T> = { __promiseValue: T };
          const p1: Promise<Int> = { __promiseValue: 1 };
          const p2: Promise<String> = { __promiseValue: "hello" };
          const x = await p1;
          const y = await p2;
        `);
        const xDecl = result.decls.find(d => d.kind === "const" && d.name === "x") as TypedDecl & { kind: "const" };
        const yDecl = result.decls.find(d => d.kind === "const" && d.name === "y") as TypedDecl & { kind: "const" };
        expect(xDecl.init.type).toEqual(primitiveType("Int"));
        expect(yDecl.init.type).toEqual(primitiveType("String"));
      });
    });

    describe("async function inference", () => {
      test("async function infers correct type without annotation", () => {
        const result = check(`
          const f = async (x: Int) => x + 1;
        `);
        const fDecl = result.decls[0] as TypedDecl & { kind: "const" };
        const fnType = fDecl.init.type as FunctionType;
        expect(fnType.async).toBe(true);
        expect(fnType.returnType).toEqual(primitiveType("Int"));
      });

      test("async function can be assigned to variable", () => {
        const result = check(`
          const asyncAdd = async (a: Int, b: Int) => a + b;
          const result = asyncAdd(1, 2);
        `);
        // asyncAdd returns Int (the unwrapped type)
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type).toEqual(primitiveType("Int"));
      });
    });

    describe("top-level await", () => {
      test("top-level await is supported", () => {
        const result = check(`
          const x = await 42;
        `);
        expect(result.decls).toHaveLength(1);
      });

      test("top-level await with expression", () => {
        const result = check(`
          type Promise<T> = { __promiseValue: T };
          const getNum: () => Promise<Int> = () => ({ __promiseValue: 10 });
          const x = await getNum();
        `);
        const xDecl = result.decls.find(d => d.kind === "const" && d.name === "x") as TypedDecl & { kind: "const" };
        expect(xDecl.init.type).toEqual(primitiveType("Int"));
      });
    });
  });

  describe("template literals", () => {
    describe("basic templates", () => {
      test("plain template returns String type", () => {
        const result = check("const x = `hello world`;");
        const xDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(xDecl.init.type).toEqual(primitiveType("String"));
      });

      test("empty template returns String type", () => {
        const result = check("const x = ``;");
        const xDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(xDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with escaped characters", () => {
        const result = check("const x = `hello\\nworld`;");
        const xDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(xDecl.init.type).toEqual(primitiveType("String"));
      });
    });

    describe("interpolation", () => {
      test("template with single interpolation returns String", () => {
        const result = check('const name = "Alice"; const greeting = `Hello, ${name}!`;');
        const greetingDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(greetingDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with number interpolation returns String", () => {
        const result = check("const x = 42; const msg = `The answer is ${x}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with multiple interpolations returns String", () => {
        const result = check("const a = 1; const b = 2; const msg = `${a} + ${b} = ${a + b}`;");
        const msgDecl = result.decls[2] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with boolean interpolation", () => {
        const result = check("const flag = true; const msg = `Flag is ${flag}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with expression interpolation", () => {
        const result = check("const x = 5; const msg = `Double: ${x * 2}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with function call interpolation", () => {
        const result = check("const double = (n: Int) => n * 2; const msg = `Result: ${double(5)}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template with property access interpolation", () => {
        // Note: Using separate declarations to avoid Lezer parser issue with } in record literals
        // conflicting with template TemplateMiddle/TemplateEnd tokens
        const result = check("const arr = [1, 2, 3]; const msg = `Length: ${arr.length}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });
    });

    describe("comptimeOnly propagation", () => {
      test("template with runtime values is not comptimeOnly", () => {
        const result = check("const x = 42; const msg = `Value: ${x}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(msgDecl.init.comptimeOnly).toBe(false);
      });

      test("template with comptime-only interpolation", () => {
        const result = check("const T = Int; const msg = `Type name: ${T.name}`;");
        const msgDecl = result.decls[1] as TypedDecl & { kind: "const" };
        // T.name returns a String which is runtime-usable
        expect(msgDecl.init.type).toEqual(primitiveType("String"));
      });
    });

    describe("nested templates", () => {
      test("template inside template interpolation", () => {
        const result = check('const inner = "world"; const outer = `Hello, ${`dear ${inner}`}!`;');
        const outerDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(outerDecl.init.type).toEqual(primitiveType("String"));
      });
    });

    describe("template as expression", () => {
      test("template can be used as function argument", () => {
        const result = check("const identity = (s: String) => s; const result = identity(`hello`);");
        const resultDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(resultDecl.init.type).toEqual(primitiveType("String"));
      });

      test("template can be used in record field", () => {
        const result = check('const name = "test"; const obj = { message: `Hello ${name}` };');
        const objDecl = result.decls[1] as TypedDecl & { kind: "const" };
        expect(objDecl.init.type.kind).toBe("record");
      });

      test("template can be used in array", () => {
        const result = check("const items = [`one`, `two`, `three`];");
        const itemsDecl = result.decls[0] as TypedDecl & { kind: "const" };
        expect(itemsDecl.init.type.kind).toBe("array");
      });
    });
  });

  describe("numeric conversion builtins", () => {
    test("toInt converts Float to Int", () => {
      const type = getConstType("const x = toInt(3.14);", "x");
      expect(type).toEqual(primitiveType("Int"));
    });

    test("toInt converts Number to Int", () => {
      const type = getConstType("const n: Number = 42; const x = toInt(n);", "x");
      expect(type).toEqual(primitiveType("Int"));
    });

    test("toInt accepts Int (subtype of Number)", () => {
      const type = getConstType("const x = toInt(42);", "x");
      expect(type).toEqual(primitiveType("Int"));
    });

    test("toFloat converts Int to Float", () => {
      const type = getConstType("const x = toFloat(42);", "x");
      expect(type).toEqual(primitiveType("Float"));
    });

    test("toInt rejects String argument", () => {
      expect(() => check('const x = toInt("hello");')).toThrow(/not assignable/);
    });

    test("toFloat rejects Float argument", () => {
      // toFloat only accepts Int, not Float or Number
      expect(() => check("const x = toFloat(3.14);")).toThrow(/not assignable/);
    });
  });

  describe("Try builtin and TryResult type", () => {
    test("TryResult type can be used directly in annotation", () => {
      // TryResult<Int> should work as a type annotation
      const result = check(`
        const success: TryResult<Int> = { ok: true, value: 42 };
      `);
      expect(result.decls).toHaveLength(1);
    });

    test("Try returns TryResult with inferred type parameter", () => {
      const type = getConstType("const x = Try(() => 42);", "x");
      const unwrapped = unwrapMetadata(type);
      expect(unwrapped.kind).toBe("union");
      // Should be { ok: true, value: 42 } | { ok: false, error: Error }
      const union = unwrapped as Type & { kind: "union" };
      expect(union.types.length).toBe(2);
    });

    test("Try result can be matched", () => {
      // This tests that the discriminated union is well-formed
      const result = check(`
        const result = Try(() => 42);
        const value = match (result) {
          case { ok: true, value }: value;
          case { ok: false, error }: 0;
        };
      `);
      const valueDecl = result.decls.find(d => d.kind === "const" && d.name === "value") as TypedDecl & { kind: "const" };
      expect(valueDecl).toBeDefined();
    });

    test("Try with string-returning thunk", () => {
      const type = getConstType('const x = Try(() => "hello");', "x");
      const unwrapped = unwrapMetadata(type);
      expect(unwrapped.kind).toBe("union");
    });

    test("Try requires thunk argument", () => {
      expect(() => check("const x = Try(42);")).toThrow(/not assignable/);
    });

    test("Error type can be used in annotation", () => {
      // Error should work as a type annotation
      const result = check('const e: Error = { message: "test", name: "Error" };');
      const constDecl = result.decls[0] as TypedDecl & { kind: "const" };
      expect(constDecl.declType.kind).toBe("record");
    });
  });

  describe("module imports with .d.ts", () => {
    // Helper that includes the module resolver
    function checkWithResolver(code: string) {
      const decls = parse(code);
      return typecheck(decls, { baseDir: process.cwd() });
    }

    test("named import from react gets function type", () => {
      const result = checkWithResolver('import { useState } from "react";');
      const importDecl = result.decls[0] as TypedDecl & { kind: "import" };
      expect(importDecl.kind).toBe("import");
    });

    test("useState has intersection type for overloads", () => {
      const result = checkWithResolver(`
        import { useState } from "react";
        const _test = useState;
      `);
      expect(result.decls.length).toBe(2);
      const constDecl = result.decls.find(d => d.kind === "const") as TypedDecl & { kind: "const" };
      expect(constDecl).toBeDefined();
      // useState should be an intersection of multiple function overloads
      expect(constDecl.init.type.kind).toBe("intersection");
    });

    test("namespace import from react builds record type", () => {
      const result = checkWithResolver('import * as React from "react";');
      const importDecl = result.decls[0] as TypedDecl & { kind: "import" };
      expect(importDecl.kind).toBe("import");
    });

    test("createElement has function type", () => {
      const result = checkWithResolver(`
        import { createElement } from "react";
        const _test = createElement;
      `);
      expect(result.decls.length).toBe(2);
      const constDecl = result.decls.find(d => d.kind === "const") as TypedDecl & { kind: "const" };
      expect(constDecl).toBeDefined();
      // createElement should be an intersection of function overloads
      expect(constDecl.init.type.kind).toBe("intersection");
    });

    test("imports without .d.ts fall back to Unknown", () => {
      const result = checkWithResolver('import { foo } from "nonexistent-module";');
      const importDecl = result.decls[0] as TypedDecl & { kind: "import" };
      expect(importDecl.kind).toBe("import");
      // Should not throw - just type as Unknown
    });
  });
});
