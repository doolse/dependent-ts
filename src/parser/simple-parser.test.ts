/**
 * Tests for the simple recursive descent parser.
 */

import { describe, test, expect } from "vitest";
import { parse } from "./simple-parser.js";
import { CoreDecl, CoreExpr } from "../ast/core-ast.js";

describe("Parser", () => {
  describe("literals", () => {
    test("parses integer literals", () => {
      const decls = parse("const x = 42;");
      expect(decls).toHaveLength(1);
      expect(decls[0].kind).toBe("const");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.name).toBe("x");
      expect(constDecl.init.kind).toBe("literal");
      const lit = constDecl.init as CoreExpr & { kind: "literal" };
      expect(lit.value).toBe(42);
      expect(lit.literalKind).toBe("int");
    });

    test("parses float literals", () => {
      const decls = parse("const x = 3.14;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      const lit = constDecl.init as CoreExpr & { kind: "literal" };
      expect(lit.value).toBe(3.14);
      expect(lit.literalKind).toBe("float");
    });

    test("parses string literals", () => {
      const decls = parse('const x = "hello";');
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      const lit = constDecl.init as CoreExpr & { kind: "literal" };
      expect(lit.value).toBe("hello");
      expect(lit.literalKind).toBe("string");
    });

    test("parses boolean literals", () => {
      const decls = parse("const x = true; const y = false;");
      expect(decls).toHaveLength(2);

      const trueDecl = decls[0] as CoreDecl & { kind: "const" };
      const trueLit = trueDecl.init as CoreExpr & { kind: "literal" };
      expect(trueLit.value).toBe(true);

      const falseDecl = decls[1] as CoreDecl & { kind: "const" };
      const falseLit = falseDecl.init as CoreExpr & { kind: "literal" };
      expect(falseLit.value).toBe(false);
    });

    test("parses null and undefined", () => {
      const decls = parse("const x = null; const y = undefined;");
      expect(decls).toHaveLength(2);

      const nullDecl = decls[0] as CoreDecl & { kind: "const" };
      const nullLit = nullDecl.init as CoreExpr & { kind: "literal" };
      expect(nullLit.value).toBe(null);

      const undefinedDecl = decls[1] as CoreDecl & { kind: "const" };
      const undefinedLit = undefinedDecl.init as CoreExpr & { kind: "literal" };
      expect(undefinedLit.value).toBe(undefined);
    });
  });

  describe("binary operations", () => {
    test("parses arithmetic", () => {
      const decls = parse("const x = 1 + 2;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("binary");
      const binary = constDecl.init as CoreExpr & { kind: "binary" };
      expect(binary.op).toBe("+");
    });

    test("parses comparison", () => {
      const decls = parse("const x = 1 < 2;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      const binary = constDecl.init as CoreExpr & { kind: "binary" };
      expect(binary.op).toBe("<");
    });

    test("parses logical operators", () => {
      const decls = parse("const x = a && b || c;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("binary");
    });

    test("respects precedence", () => {
      const decls = parse("const x = 1 + 2 * 3;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      const binary = constDecl.init as CoreExpr & { kind: "binary" };
      // Should be (1 + (2 * 3)), so outer op is +
      expect(binary.op).toBe("+");
      expect((binary.right as CoreExpr & { kind: "binary" }).op).toBe("*");
    });
  });

  describe("function calls", () => {
    test("parses simple call", () => {
      const decls = parse("const x = f(1, 2);");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("call");
      const call = constDecl.init as CoreExpr & { kind: "call" };
      expect((call.fn as CoreExpr & { kind: "identifier" }).name).toBe("f");
      expect(call.args).toHaveLength(2);
    });

    test("parses method chain", () => {
      const decls = parse("const x = a.b.c();");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("call");
    });
  });

  describe("arrays and records", () => {
    test("parses array literal", () => {
      const decls = parse("const x = [1, 2, 3];");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("array");
      const arr = constDecl.init as CoreExpr & { kind: "array" };
      expect(arr.elements).toHaveLength(3);
    });

    test("parses record literal", () => {
      const decls = parse("const x = { a: 1, b: 2 };");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("record");
      const rec = constDecl.init as CoreExpr & { kind: "record" };
      expect(rec.fields).toHaveLength(2);
    });

    test("parses shorthand record", () => {
      const decls = parse("const x = { a, b };");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("record");
    });
  });

  describe("lambdas", () => {
    test("parses arrow function", () => {
      const decls = parse("const f = (x) => x + 1;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("lambda");
      const lambda = constDecl.init as CoreExpr & { kind: "lambda" };
      expect(lambda.params).toHaveLength(1);
      expect(lambda.params[0].name).toBe("x");
    });

    test("parses shorthand arrow", () => {
      const decls = parse("const f = x => x;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("lambda");
    });

    test("parses multi-param arrow", () => {
      const decls = parse("const f = (a, b) => a + b;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      const lambda = constDecl.init as CoreExpr & { kind: "lambda" };
      expect(lambda.params).toHaveLength(2);
    });
  });

  describe("type declarations", () => {
    test("parses type alias", () => {
      const decls = parse("type MyInt = Int;");
      expect(decls).toHaveLength(1);
      // type Foo = T desugars to const Foo = WithMetadata(T, { name: "Foo" })
      expect(decls[0].kind).toBe("const");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.name).toBe("MyInt");
      expect(constDecl.init.kind).toBe("call");
    });

    test("parses newtype", () => {
      const decls = parse("newtype UserId = String;");
      expect(decls).toHaveLength(1);
      expect(decls[0].kind).toBe("const");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.name).toBe("UserId");
      expect(constDecl.init.kind).toBe("call");
      const call = constDecl.init as CoreExpr & { kind: "call" };
      expect((call.fn as CoreExpr & { kind: "identifier" }).name).toBe("Branded");
    });
  });

  describe("type annotations", () => {
    test("parses const with type annotation", () => {
      const decls = parse("const x: Int = 42;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.type).toBeDefined();
      expect(constDecl.type?.kind).toBe("identifier");
    });

    test("parses union type", () => {
      const decls = parse("const x: Int | String = 42;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.type?.kind).toBe("call");
      const call = constDecl.type as CoreExpr & { kind: "call" };
      expect((call.fn as CoreExpr & { kind: "identifier" }).name).toBe("Union");
    });

    test("parses record type", () => {
      const decls = parse("const x: { a: Int, b: String } = { a: 1, b: 'hi' };");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.type?.kind).toBe("call");
      const call = constDecl.type as CoreExpr & { kind: "call" };
      expect((call.fn as CoreExpr & { kind: "identifier" }).name).toBe("RecordType");
    });

    test("parses array type", () => {
      const decls = parse("const x: Int[] = [1, 2, 3];");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.type?.kind).toBe("call");
      const call = constDecl.type as CoreExpr & { kind: "call" };
      expect((call.fn as CoreExpr & { kind: "identifier" }).name).toBe("Array");
    });
  });

  describe("imports", () => {
    test("parses named import", () => {
      const decls = parse('import { foo, bar } from "module";');
      expect(decls).toHaveLength(1);
      expect(decls[0].kind).toBe("import");
      const imp = decls[0] as CoreDecl & { kind: "import" };
      expect(imp.clause.kind).toBe("named");
    });

    test("parses default import", () => {
      const decls = parse('import lib from "module";');
      expect(decls).toHaveLength(1);
      const imp = decls[0] as CoreDecl & { kind: "import" };
      expect(imp.clause.kind).toBe("default");
    });

    test("parses namespace import", () => {
      const decls = parse('import * as lib from "module";');
      expect(decls).toHaveLength(1);
      const imp = decls[0] as CoreDecl & { kind: "import" };
      expect(imp.clause.kind).toBe("namespace");
    });
  });

  describe("expression statements", () => {
    test("parses assert call", () => {
      const decls = parse("assert(true);");
      expect(decls).toHaveLength(1);
      expect(decls[0].kind).toBe("expr");
      const exprStmt = decls[0] as CoreDecl & { kind: "expr" };
      expect(exprStmt.expr.kind).toBe("call");
    });
  });

  describe("conditionals", () => {
    test("parses ternary", () => {
      const decls = parse("const x = a ? b : c;");
      const constDecl = decls[0] as CoreDecl & { kind: "const" };
      expect(constDecl.init.kind).toBe("conditional");
    });
  });

  describe("comments", () => {
    test("ignores line comments", () => {
      const decls = parse("// comment\nconst x = 1;");
      expect(decls).toHaveLength(1);
    });

    test("ignores block comments", () => {
      const decls = parse("/* comment */ const x = 1;");
      expect(decls).toHaveLength(1);
    });
  });
});
