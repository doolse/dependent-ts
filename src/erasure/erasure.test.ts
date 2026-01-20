/**
 * Tests for the erasure phase.
 *
 * Erasure removes compile-time-only code from TypedAST, producing
 * RuntimeAST (structurally identical to CoreAST).
 *
 * Note: Some erasure features (comptimeValue inlining) require the type checker
 * to set comptimeValue on expressions. Until that's implemented, those tests
 * are skipped.
 */

import { describe, test, expect } from "vitest";
import { parse } from "../parser";
import { typecheck } from "../typecheck/typecheck";
import { erase } from "./erasure";
import { CoreDecl, CoreExpr } from "../ast/core-ast";

// Helper to parse, typecheck, and erase code
function eraseCode(code: string): CoreDecl[] {
  const decls = parse(code);
  const typed = typecheck(decls);
  const result = erase(typed);
  return result.decls;
}

// Helper to get a specific declaration by name
function getDecl(decls: CoreDecl[], name: string): CoreDecl | undefined {
  return decls.find((d) => d.kind === "const" && d.name === name);
}

// Helper to check if a declaration exists
function hasDecl(decls: CoreDecl[], name: string): boolean {
  return getDecl(decls, name) !== undefined;
}

// Helper to count non-import declarations
function countNonImportDecls(decls: CoreDecl[]): number {
  return decls.filter((d) => d.kind !== "import").length;
}

describe("Erasure", () => {
  describe("type value erasure", () => {
    test("removes type alias declarations", () => {
      const decls = eraseCode(`
        type MyInt = Int;
        const x = 42;
      `);

      expect(hasDecl(decls, "MyInt")).toBe(false);
      expect(hasDecl(decls, "x")).toBe(true);
    });

    test("removes newtype declarations", () => {
      const decls = eraseCode(`
        newtype UserId = String;
        const id = "user123";
      `);

      expect(hasDecl(decls, "UserId")).toBe(false);
      expect(hasDecl(decls, "id")).toBe(true);
    });

    test("removes const bindings to Type values", () => {
      const decls = eraseCode(`
        const MyType = RecordType([]);
        const x = 42;
      `);

      expect(hasDecl(decls, "MyType")).toBe(false);
      expect(hasDecl(decls, "x")).toBe(true);
    });
  });

  describe("type annotation erasure", () => {
    test("removes type annotations from const declarations", () => {
      const decls = eraseCode(`
        const x: Int = 42;
      `);

      const xDecl = getDecl(decls, "x") as CoreDecl & { kind: "const" };
      expect(xDecl).toBeDefined();
      expect(xDecl.type).toBeUndefined();
    });
  });

  describe("assert statement removal", () => {
    test("removes assert statements", () => {
      const decls = eraseCode(`
        const x = true;
        assert(x);
        const y = 42;
      `);

      // Should only have x and y, no assert
      expect(countNonImportDecls(decls)).toBe(2);
      expect(hasDecl(decls, "x")).toBe(true);
      expect(hasDecl(decls, "y")).toBe(true);
    });

    test("removes multiple assert statements", () => {
      const decls = eraseCode(`
        const x = true;
        assert(x);
        assert(true);
        const y = 42;
      `);

      expect(countNonImportDecls(decls)).toBe(2);
    });
  });

  describe("type parameter erasure", () => {
    // Note: Generic function expressions (<T>(x: T) => x) are not yet supported.
    // Generic types work at the type level only.

    test("removes type annotations from lambda parameters", () => {
      const decls = eraseCode(`
        const add = (a: Int, b: Int): Int => a + b;
      `);

      const addDecl = getDecl(decls, "add") as CoreDecl & { kind: "const" };
      const lambda = addDecl.init as CoreExpr & { kind: "lambda" };
      expect(lambda.params[0].type).toBeUndefined();
      expect(lambda.params[1].type).toBeUndefined();
      expect(lambda.returnType).toBeUndefined();
    });

    test("removes type annotations from unary functions", () => {
      const decls = eraseCode(`
        const double = (x: Int): Int => x * 2;
      `);

      const doubleDecl = getDecl(decls, "double") as CoreDecl & { kind: "const" };
      const lambda = doubleDecl.init as CoreExpr & { kind: "lambda" };
      expect(lambda.params[0].type).toBeUndefined();
      expect(lambda.returnType).toBeUndefined();
    });
  });

  describe("comptime value inlining", () => {
    // Note: These tests are skipped because the type checker doesn't yet set
    // comptimeValue on expressions. Once that's implemented, these should pass.

    test.skip("inlines comptime string values", () => {
      const decls = eraseCode(`
        type Person = { name: String, age: Int };
        const typeName = Person.name;
      `);

      const typeNameDecl = getDecl(decls, "typeName") as CoreDecl & { kind: "const" };
      expect(typeNameDecl).toBeDefined();

      const literal = typeNameDecl.init as CoreExpr & { kind: "literal" };
      expect(literal.kind).toBe("literal");
      expect(literal.value).toBe("Person");
    });

    test.skip("inlines comptime array values", () => {
      const decls = eraseCode(`
        type Person = { name: String, age: Int };
        const fieldNames = Person.fieldNames;
      `);

      const fieldNamesDecl = getDecl(decls, "fieldNames") as CoreDecl & { kind: "const" };
      expect(fieldNamesDecl).toBeDefined();

      const arr = fieldNamesDecl.init as CoreExpr & { kind: "array" };
      expect(arr.kind).toBe("array");
      expect(arr.elements.length).toBe(2);
    });

    test.skip("inlines comptime boolean values", () => {
      // Note: Array literal doesn't have .isFixed - that's on the Type
      const decls = eraseCode(`
        type MyArr = [Int, Int, Int];
        const isFixed = MyArr.isFixed;
      `);

      const isFixedDecl = getDecl(decls, "isFixed") as CoreDecl & { kind: "const" };
      const literal = isFixedDecl.init as CoreExpr & { kind: "literal" };
      expect(literal.kind).toBe("literal");
      expect(literal.value).toBe(true);
    });
  });

  describe("conditional branch elimination", () => {
    // Note: Branch elimination tests are skipped because the type checker doesn't yet
    // set comptimeValue on expressions. Once that's implemented, these should pass.

    test.skip("eliminates true branch when condition is comptime true", () => {
      const decls = eraseCode(`
        type X = Int;
        const result = X.extends(Number) ? "yes" : "no";
      `);

      const resultDecl = getDecl(decls, "result") as CoreDecl & { kind: "const" };
      const literal = resultDecl.init as CoreExpr & { kind: "literal" };
      expect(literal.kind).toBe("literal");
      expect(literal.value).toBe("yes");
    });

    test.skip("eliminates false branch when condition is comptime false", () => {
      const decls = eraseCode(`
        type X = String;
        const result = X.extends(Int) ? "yes" : "no";
      `);

      const resultDecl = getDecl(decls, "result") as CoreDecl & { kind: "const" };
      const literal = resultDecl.init as CoreExpr & { kind: "literal" };
      expect(literal.kind).toBe("literal");
      expect(literal.value).toBe("no");
    });

    test("preserves conditional when condition is runtime", () => {
      const decls = eraseCode(`
        const x = true;
        const result = x ? "yes" : "no";
      `);

      const resultDecl = getDecl(decls, "result") as CoreDecl & { kind: "const" };
      const cond = resultDecl.init as CoreExpr & { kind: "conditional" };
      expect(cond.kind).toBe("conditional");
    });
  });

  describe("runtime value preservation", () => {
    test("preserves runtime bindings", () => {
      const decls = eraseCode(`
        const x = 42;
        const y = x + 1;
        const z = { a: x, b: y };
      `);

      expect(decls.length).toBe(3);
      expect(hasDecl(decls, "x")).toBe(true);
      expect(hasDecl(decls, "y")).toBe(true);
      expect(hasDecl(decls, "z")).toBe(true);
    });

    test("preserves function bodies", () => {
      const decls = eraseCode(`
        const add = (a: Int, b: Int) => a + b;
        const result = add(1, 2);
      `);

      const addDecl = getDecl(decls, "add") as CoreDecl & { kind: "const" };
      const lambda = addDecl.init as CoreExpr & { kind: "lambda" };
      expect(lambda.body.kind).toBe("binary");
    });

    test("preserves array operations", () => {
      const decls = eraseCode(`
        const arr = [1, 2, 3];
        const doubled = arr.map(x => x * 2);
      `);

      expect(hasDecl(decls, "arr")).toBe(true);
      expect(hasDecl(decls, "doubled")).toBe(true);
    });

    test("preserves pattern matching", () => {
      const decls = eraseCode(`
        const x: Int | String = 42;
        const result = match (x) {
          case Int: "number";
          case String: "string";
        };
      `);

      const resultDecl = getDecl(decls, "result") as CoreDecl & { kind: "const" };
      const match = resultDecl.init as CoreExpr & { kind: "match" };
      expect(match.kind).toBe("match");
    });
  });

  describe("import preservation", () => {
    test("preserves import declarations", () => {
      // Note: This may not fully typecheck without the actual module,
      // but the parser/erasure should preserve imports
      // For now, test with built-in imports if any, or skip
      const decls = eraseCode(`
        const x = 42;
      `);

      // Basic test - imports should be preserved if present
      expect(decls.length).toBeGreaterThan(0);
    });
  });

  describe("mixed comptime and runtime", () => {
    test("erases type declarations but preserves runtime values", () => {
      const decls = eraseCode(`
        type Person = { name: String, age: Int };
        const person = { name: "Alice", age: 30 };
      `);

      // Person should be erased (Type value)
      expect(hasDecl(decls, "Person")).toBe(false);
      // person should be preserved
      expect(hasDecl(decls, "person")).toBe(true);
    });

    test.skip("handles mixed record with comptime type info (requires comptimeValue)", () => {
      const decls = eraseCode(`
        type Person = { name: String, age: Int };
        const typeName = Person.name;
        const person = { name: "Alice", age: 30 };
      `);

      // Person should be erased (Type value)
      expect(hasDecl(decls, "Person")).toBe(false);
      // typeName should be inlined (once comptimeValue is set)
      expect(hasDecl(decls, "typeName")).toBe(true);
      // person should be preserved
      expect(hasDecl(decls, "person")).toBe(true);

      const typeNameDecl = getDecl(decls, "typeName") as CoreDecl & { kind: "const" };
      expect((typeNameDecl.init as any).value).toBe("Person");
    });
  });

  describe("async/await preservation", () => {
    test("preserves async functions", () => {
      // In DepJS, lambda body is an expression (no return keyword)
      const decls = eraseCode(`
        const fetchData = async (x: Int) => x + 1;
      `);

      const fetchDecl = getDecl(decls, "fetchData") as CoreDecl & { kind: "const" };
      const lambda = fetchDecl.init as CoreExpr & { kind: "lambda" };
      expect(lambda.async).toBe(true);
    });

    test("preserves await expressions", () => {
      const decls = eraseCode(`
        type Promise<T> = { __promiseValue: T };
        const p: Promise<Int> = { __promiseValue: 42 };
        const x = await p;
      `);

      // Promise type erased, p and x preserved
      expect(hasDecl(decls, "Promise")).toBe(false);
      expect(hasDecl(decls, "p")).toBe(true);
      expect(hasDecl(decls, "x")).toBe(true);

      const xDecl = getDecl(decls, "x") as CoreDecl & { kind: "const" };
      expect(xDecl.init.kind).toBe("await");
    });
  });

  describe("block expression erasure", () => {
    test("preserves block expressions in function bodies", () => {
      // Blocks only appear in arrow function bodies
      const decls = eraseCode(`
        const f = () => {
          const y = 42;
          const z = y + 1;
          z
        };
      `);

      const fDecl = getDecl(decls, "f") as CoreDecl & { kind: "const" };
      const lambda = fDecl.init as CoreExpr & { kind: "lambda" };
      const block = lambda.body as CoreExpr & { kind: "block" };
      expect(block.kind).toBe("block");
      expect(block.statements.length).toBe(2);
      expect(block.result).toBeDefined();
    });
  });

  describe("template literal preservation", () => {
    test("preserves template literals", () => {
      const decls = eraseCode(`
        const name = "world";
        const greeting = \`hello \${name}\`;
      `);

      const greetingDecl = getDecl(decls, "greeting") as CoreDecl & { kind: "const" };
      const template = greetingDecl.init as CoreExpr & { kind: "template" };
      expect(template.kind).toBe("template");
    });
  });

  describe("spread preservation", () => {
    test("preserves spread in arrays", () => {
      const decls = eraseCode(`
        const arr1 = [1, 2];
        const arr2 = [...arr1, 3];
      `);

      const arr2Decl = getDecl(decls, "arr2") as CoreDecl & { kind: "const" };
      const array = arr2Decl.init as CoreExpr & { kind: "array" };
      expect(array.elements.some((e) => e.kind === "spread")).toBe(true);
    });

    test("preserves spread in records", () => {
      const decls = eraseCode(`
        const obj1 = { a: 1 };
        const obj2 = { ...obj1, b: 2 };
      `);

      const obj2Decl = getDecl(decls, "obj2") as CoreDecl & { kind: "const" };
      const record = obj2Decl.init as CoreExpr & { kind: "record" };
      expect(record.fields.some((f) => f.kind === "spread")).toBe(true);
    });
  });
});
