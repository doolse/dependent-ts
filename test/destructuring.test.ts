import { describe, it, expect } from "vitest";
import {
  parse,
  parseAndRun,
  letPatternExpr,
  arrayPattern,
  objectPattern,
  varPattern,
  array,
  num,
  varRef,
  add,
  generateJS,
  exprToString,
  patternToString,
} from "../src/index";

describe("Destructuring Patterns", () => {
  describe("pattern constructors", () => {
    it("creates varPattern", () => {
      const p = varPattern("x");
      expect(p.tag).toBe("varPattern");
      expect(p.name).toBe("x");
    });

    it("creates arrayPattern", () => {
      const p = arrayPattern(varPattern("a"), varPattern("b"));
      expect(p.tag).toBe("arrayPattern");
      if (p.tag === "arrayPattern") {
        expect(p.elements.length).toBe(2);
      }
    });

    it("creates objectPattern", () => {
      const p = objectPattern([
        { key: "x", pattern: varPattern("a") },
        { key: "y", pattern: varPattern("b") },
      ]);
      expect(p.tag).toBe("objectPattern");
      if (p.tag === "objectPattern") {
        expect(p.fields.length).toBe(2);
      }
    });
  });

  describe("patternToString", () => {
    it("prints varPattern", () => {
      expect(patternToString(varPattern("x"))).toBe("x");
    });

    it("prints arrayPattern", () => {
      const p = arrayPattern(varPattern("a"), varPattern("b"));
      expect(patternToString(p)).toBe("[a, b]");
    });

    it("prints objectPattern with shorthand", () => {
      const p = objectPattern([
        { key: "x", pattern: varPattern("x") },
        { key: "y", pattern: varPattern("y") },
      ]);
      expect(patternToString(p)).toBe("{ x, y }");
    });

    it("prints objectPattern with renamed fields", () => {
      const p = objectPattern([
        { key: "x", pattern: varPattern("a") },
        { key: "y", pattern: varPattern("b") },
      ]);
      expect(patternToString(p)).toBe("{ x: a, y: b }");
    });

    it("prints nested patterns", () => {
      const p = arrayPattern(
        varPattern("a"),
        arrayPattern(varPattern("b"), varPattern("c"))
      );
      expect(patternToString(p)).toBe("[a, [b, c]]");
    });
  });

  describe("letPatternExpr", () => {
    it("creates letPattern expression", () => {
      const expr = letPatternExpr(
        arrayPattern(varPattern("a"), varPattern("b")),
        array(num(1), num(2)),
        add(varRef("a"), varRef("b"))
      );
      expect(expr.tag).toBe("letPattern");
    });

    it("prints letPattern expression", () => {
      const expr = letPatternExpr(
        arrayPattern(varPattern("a"), varPattern("b")),
        array(num(1), num(2)),
        add(varRef("a"), varRef("b"))
      );
      expect(exprToString(expr)).toBe("let [a, b] = [1, 2] in (a + b)");
    });
  });

  describe("parsing destructuring", () => {
    it("parses array destructuring", () => {
      const expr = parse("let [a, b] = [1, 2] in a + b");
      expect(expr.tag).toBe("letPattern");
      if (expr.tag === "letPattern") {
        expect(expr.pattern.tag).toBe("arrayPattern");
      }
    });

    it("parses object destructuring", () => {
      const expr = parse("let { x, y } = { x: 1, y: 2 } in x + y");
      expect(expr.tag).toBe("letPattern");
      if (expr.tag === "letPattern") {
        expect(expr.pattern.tag).toBe("objectPattern");
      }
    });

    it("parses nested array destructuring", () => {
      const expr = parse("let [a, [b, c]] = [1, [2, 3]] in a + b + c");
      expect(expr.tag).toBe("letPattern");
    });

    it("parses object with renamed fields", () => {
      const expr = parse("let { x: a, y: b } = { x: 1, y: 2 } in a + b");
      expect(expr.tag).toBe("letPattern");
      if (expr.tag === "letPattern" && expr.pattern.tag === "objectPattern") {
        expect(expr.pattern.fields[0].key).toBe("x");
        expect(expr.pattern.fields[0].pattern.tag).toBe("varPattern");
        if (expr.pattern.fields[0].pattern.tag === "varPattern") {
          expect(expr.pattern.fields[0].pattern.name).toBe("a");
        }
      }
    });
  });

  describe("evaluating destructuring", () => {
    it("evaluates array destructuring with Now values", () => {
      const result = parseAndRun("let [a, b] = [1, 2] in a + b");
      expect(result.value.tag).toBe("number");
      if (result.value.tag === "number") {
        expect(result.value.value).toBe(3);
      }
    });

    it("evaluates object destructuring with Now values", () => {
      const result = parseAndRun("let { x, y } = { x: 10, y: 20 } in x + y");
      expect(result.value.tag).toBe("number");
      if (result.value.tag === "number") {
        expect(result.value.value).toBe(30);
      }
    });

    it("evaluates nested destructuring", () => {
      const result = parseAndRun("let [a, [b, c]] = [1, [2, 3]] in a + b + c");
      expect(result.value.tag).toBe("number");
      if (result.value.tag === "number") {
        expect(result.value.value).toBe(6);
      }
    });

    it("evaluates object with nested array", () => {
      const result = parseAndRun("let { data: [a, b] } = { data: [5, 10] } in a + b");
      expect(result.value.tag).toBe("number");
      if (result.value.tag === "number") {
        expect(result.value.value).toBe(15);
      }
    });
  });

  describe("codegen for destructuring", () => {
    it("evaluates constant array destructuring at compile time", () => {
      const expr = parse("let [a, b] = [1, 2] in a + b");
      const js = generateJS(expr);
      // With staging, constant destructuring is fully evaluated
      expect(js.trim()).toBe("3");
    });

    it("evaluates constant object destructuring at compile time", () => {
      const expr = parse("let { x, y } = { x: 1, y: 2 } in x + y");
      const js = generateJS(expr);
      // With staging, constant destructuring is fully evaluated
      expect(js.trim()).toBe("3");
    });

    it("evaluates constant renamed object fields at compile time", () => {
      const expr = parse("let { x: a, y: b } = { x: 1, y: 2 } in a + b");
      const js = generateJS(expr);
      // With staging, constant destructuring is fully evaluated
      expect(js.trim()).toBe("3");
    });

    it("generates JS for runtime array destructuring", () => {
      const expr = parse("fn(arr) => let [a, b] = arr in a + b");
      const js = generateJS(expr);
      expect(js).toContain("const [a, b]");
      expect(js).toContain("a + b");
    });
  });
});
