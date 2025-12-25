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
  loadExports,
  constraintToString,
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

  describe("React jsx-runtime", () => {
    it("loads jsx and jsxs from react/jsx-runtime", () => {
      const exports = loadExports("react/jsx-runtime", ["jsx", "jsxs", "Fragment"]);
      expect(exports.size).toBe(3);
      expect(exports.has("jsx")).toBe(true);
      expect(exports.has("jsxs")).toBe(true);
      expect(exports.has("Fragment")).toBe(true);
    });

    it("loads useState from react", () => {
      const exports = loadExports("react", ["useState"]);
      expect(exports.size).toBe(1);
      const useStateType = exports.get("useState");
      expect(useStateType).toBeDefined();
      // useState is a function - type info is derived at call sites via synthetic closures
      const typeStr = constraintToString(useStateType!);
      expect(typeStr).toBe("function");
    });

    it("derives useState return type from argument type", () => {
      // When we call useState with a number, the return type should be a tuple
      // with the first element being the same type as the argument (number)
      // Note: the exact constraint might be equals(0) rather than just isNumber
      const code = `
        import { useState } from "react" in
        let [count, setCount] = useState(0) in
        count
      `;
      const expr = parse(code);
      const result = stage(expr);
      expect(isLater(result.svalue)).toBe(true);
      // The count should have a number-related constraint (from the 0 argument)
      // It could be "number", "0", or "number & 0" depending on how the type is derived
      const typeStr = constraintToString(result.svalue.constraint);
      expect(typeStr.includes("number") || typeStr.includes("0")).toBe(true);
    });

    it("generates React counter component", () => {
      const code = `
        import { jsx, jsxs } from "react/jsx-runtime" in
        import { useState } from "react" in
          fn(props) =>
            let [count, setCount] = useState(0) in
            jsxs("div", {
              children: [
                jsx("p", { children: count }),
                jsx("button", {
                  onClick: fn() => setCount(count + 1),
                  children: "+"
                })
              ]
            })
      `;
      const expr = parse(code);
      const jsCode = generateModuleWithImports(expr);

      // Should have proper imports
      expect(jsCode).toContain('import { jsx, jsxs } from "react/jsx-runtime";');
      expect(jsCode).toContain('import { useState } from "react";');

      // Should have useState destructuring
      expect(jsCode).toContain("const [count, setCount] = useState(0)");

      // Should have jsx calls
      expect(jsCode).toContain("jsxs(");
      expect(jsCode).toContain("jsx(");
    });
  });
});
