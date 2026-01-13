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
      const arr = decl.declType as Type & { kind: "array" };
      expect(arr.variadic).toBe(true);
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
      // TODO: Default type parameters are not yet implemented
      // type Container<T = String> = { value: T };
      // const c: Container = { value: "hello" };  // T defaults to String

      test.skip("default type parameters not yet implemented", () => {
        // Placeholder to mark this feature as pending implementation
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
});
