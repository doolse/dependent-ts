import { describe, it, expect } from "vitest";
import {
  parse,
  stage,
  importExpr,
  varRef,
  add,
  num,
  generateJS,
  generateModuleWithImports,
  exprToString,
  isLater,
} from "../src/index";

describe("Import Expression", () => {
  describe("parsing", () => {
    it("parses simple import", () => {
      const expr = parse('import { foo } from "test-module" in foo');
      expect(expr.tag).toBe("import");
      if (expr.tag === "import") {
        expect(expr.names).toEqual(["foo"]);
        expect(expr.modulePath).toBe("test-module");
        expect(expr.body.tag).toBe("var");
      }
    });

    it("parses multiple imports", () => {
      const expr = parse('import { a, b, c } from "test-module" in a + b + c');
      expect(expr.tag).toBe("import");
      if (expr.tag === "import") {
        expect(expr.names).toEqual(["a", "b", "c"]);
        expect(expr.modulePath).toBe("test-module");
      }
    });

    it("parses nested import in body", () => {
      const expr = parse('import { x } from "mod1" in import { y } from "mod2" in x + y');
      expect(expr.tag).toBe("import");
      if (expr.tag === "import") {
        expect(expr.names).toEqual(["x"]);
        expect(expr.body.tag).toBe("import");
      }
    });
  });

  describe("exprToString", () => {
    it("prints import expression", () => {
      const expr = importExpr(["foo", "bar"], "my-module", add(varRef("foo"), varRef("bar")));
      expect(exprToString(expr)).toBe('import { foo, bar } from "my-module" in (foo + bar)');
    });
  });

  describe("code generation", () => {
    it("generates IIFE for import in expression context", () => {
      const expr = importExpr(["foo"], "test-module", varRef("foo"));
      const code = generateJS(expr);
      expect(code).toContain("// import { foo }");
      expect(code).toContain("return foo");
    });

    it("generates module with top-level imports", () => {
      const expr = importExpr(["useState"], "react", varRef("useState"));
      const code = generateModuleWithImports(expr);
      expect(code).toContain('import { useState } from "react";');
      expect(code).toContain("export default useState");
    });

    it("collects multiple imports from different modules", () => {
      const expr = importExpr(
        ["useState"],
        "react",
        importExpr(["something"], "other", add(varRef("useState"), varRef("something")))
      );
      const code = generateModuleWithImports(expr);
      expect(code).toContain('import { useState } from "react";');
      expect(code).toContain('import { something } from "other";');
    });
  });
});
