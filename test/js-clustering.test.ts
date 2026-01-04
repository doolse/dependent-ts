import { describe, it, expect } from "vitest";
import {
  compareJSExprs,
  jsExprSignature,
  clusterByJS,
  extractHoleValues,
  getParameterValues,
  applyTemplate,
  ClusterableSpec,
} from "@dependent-ts/core/js-clustering";
import {
  JSExpr,
  jsLit,
  jsVar,
  jsBinop,
  jsCall,
  jsTernary,
  jsObject,
  jsArray,
  jsMethod,
  jsArrow,
} from "@dependent-ts/core";

describe("JS Clustering", () => {
  describe("compareJSExprs", () => {
    it("returns empty array for identical expressions", () => {
      const a = jsLit(42);
      const b = jsLit(42);
      expect(compareJSExprs(a, b)).toEqual([]);
    });

    it("returns path for differing literals", () => {
      const a = jsLit(42);
      const b = jsLit(99);
      expect(compareJSExprs(a, b)).toEqual([[]]);
    });

    it("returns null for different node types", () => {
      const a = jsLit(42);
      const b = jsVar("x");
      expect(compareJSExprs(a, b)).toBeNull();
    });

    it("returns null for different variable names", () => {
      const a = jsVar("x");
      const b = jsVar("y");
      expect(compareJSExprs(a, b)).toBeNull();
    });

    it("compares binary operations", () => {
      const a = jsBinop("+", jsLit(1), jsLit(2));
      const b = jsBinop("+", jsLit(3), jsLit(4));
      const result = compareJSExprs(a, b);
      expect(result).toEqual([["left"], ["right"]]);
    });

    it("returns null for different operators", () => {
      const a = jsBinop("+", jsLit(1), jsLit(2));
      const b = jsBinop("-", jsLit(1), jsLit(2));
      expect(compareJSExprs(a, b)).toBeNull();
    });

    it("compares nested expressions", () => {
      // (x + 1) vs (x + 2)
      const a = jsBinop("+", jsVar("x"), jsLit(1));
      const b = jsBinop("+", jsVar("x"), jsLit(2));
      expect(compareJSExprs(a, b)).toEqual([["right"]]);
    });

    it("compares ternary expressions", () => {
      // cond ? 1 : 2 vs cond ? 3 : 4
      const a = jsTernary(jsVar("cond"), jsLit(1), jsLit(2));
      const b = jsTernary(jsVar("cond"), jsLit(3), jsLit(4));
      expect(compareJSExprs(a, b)).toEqual([["then"], ["else"]]);
    });

    it("compares function calls", () => {
      const a = jsCall(jsVar("f"), [jsLit("a"), jsLit(1)]);
      const b = jsCall(jsVar("f"), [jsLit("b"), jsLit(2)]);
      expect(compareJSExprs(a, b)).toEqual([["args", 0], ["args", 1]]);
    });

    it("returns null for different arg counts", () => {
      const a = jsCall(jsVar("f"), [jsLit(1)]);
      const b = jsCall(jsVar("f"), [jsLit(1), jsLit(2)]);
      expect(compareJSExprs(a, b)).toBeNull();
    });

    it("compares objects", () => {
      const a = jsObject([{ key: "x", value: jsLit(1) }, { key: "y", value: jsLit(2) }]);
      const b = jsObject([{ key: "x", value: jsLit(3) }, { key: "y", value: jsLit(4) }]);
      expect(compareJSExprs(a, b)).toEqual([
        ["fields", 0, "value"],
        ["fields", 1, "value"],
      ]);
    });

    it("returns null for different object keys", () => {
      const a = jsObject([{ key: "x", value: jsLit(1) }]);
      const b = jsObject([{ key: "y", value: jsLit(1) }]);
      expect(compareJSExprs(a, b)).toBeNull();
    });

    it("compares arrays", () => {
      const a = jsArray([jsLit(1), jsLit(2)]);
      const b = jsArray([jsLit(3), jsLit(4)]);
      expect(compareJSExprs(a, b)).toEqual([["elements", 0], ["elements", 1]]);
    });

    it("compares method calls", () => {
      const a = jsMethod(jsVar("arr"), "map", [jsVar("f")]);
      const b = jsMethod(jsVar("arr"), "map", [jsVar("f")]);
      expect(compareJSExprs(a, b)).toEqual([]);
    });

    it("returns null for different methods", () => {
      const a = jsMethod(jsVar("arr"), "map", [jsVar("f")]);
      const b = jsMethod(jsVar("arr"), "filter", [jsVar("f")]);
      expect(compareJSExprs(a, b)).toBeNull();
    });
  });

  describe("jsExprSignature", () => {
    it("generates same signature for different literals", () => {
      expect(jsExprSignature(jsLit(42))).toBe(jsExprSignature(jsLit(99)));
      expect(jsExprSignature(jsLit("hello"))).toBe(jsExprSignature(jsLit("world")));
      expect(jsExprSignature(jsLit(42))).toBe(jsExprSignature(jsLit("hello")));
    });

    it("generates different signatures for different structures", () => {
      const lit = jsExprSignature(jsLit(1));
      const varSig = jsExprSignature(jsVar("x"));
      expect(lit).not.toBe(varSig);
    });

    it("includes variable names in signature", () => {
      expect(jsExprSignature(jsVar("x"))).not.toBe(jsExprSignature(jsVar("y")));
    });

    it("includes operator in signature", () => {
      const add = jsExprSignature(jsBinop("+", jsLit(1), jsLit(2)));
      const sub = jsExprSignature(jsBinop("-", jsLit(1), jsLit(2)));
      expect(add).not.toBe(sub);
    });
  });

  describe("clusterByJS", () => {
    it("puts identical JS in same cluster", () => {
      const specs: ClusterableSpec<string>[] = [
        { id: "a", jsExpr: jsLit(42), argValues: [42] },
        { id: "b", jsExpr: jsLit(42), argValues: [42] },
      ];
      const clusters = clusterByJS(specs);
      expect(clusters.length).toBe(1);
      expect(clusters[0].members.length).toBe(2);
    });

    it("puts structurally identical JS with different literals in same cluster", () => {
      const specs: ClusterableSpec<string>[] = [
        { id: "a", jsExpr: jsLit(42), argValues: [42] },
        { id: "b", jsExpr: jsLit(99), argValues: [99] },
        { id: "c", jsExpr: jsLit("hello"), argValues: ["hello"] },
      ];
      const clusters = clusterByJS(specs);
      expect(clusters.length).toBe(1);
      expect(clusters[0].members.length).toBe(3);
      expect(clusters[0].template.holes.length).toBe(1);
    });

    it("separates structurally different JS", () => {
      const specs: ClusterableSpec<string>[] = [
        { id: "a", jsExpr: jsLit(42), argValues: [42] },
        { id: "b", jsExpr: jsVar("x"), argValues: [] },
      ];
      const clusters = clusterByJS(specs);
      expect(clusters.length).toBe(2);
    });

    it("handles complex expressions - inputDigit example", () => {
      // Simulating: if (waiting) { setDisplay(digit) } else { display + digit }
      const makeExpr = (digit: string) =>
        jsTernary(
          jsVar("waiting"),
          jsCall(jsVar("setDisplay"), [jsLit(digit)]),
          jsBinop("+", jsVar("display"), jsLit(digit))
        );

      const specs: ClusterableSpec<string>[] = [
        { id: "0", jsExpr: makeExpr("0"), argValues: ["0"] },
        { id: "1", jsExpr: makeExpr("1"), argValues: ["1"] },
        { id: "2", jsExpr: makeExpr("2"), argValues: ["2"] },
      ];

      const clusters = clusterByJS(specs);
      expect(clusters.length).toBe(1);
      expect(clusters[0].members.length).toBe(3);
      // Two holes: one in setDisplay arg, one in the + operation
      expect(clusters[0].template.holes.length).toBe(2);
    });

    it("computes parameter mapping with value correlation", () => {
      // All holes have the same value for each member -> 1 parameter
      const makeExpr = (digit: string) =>
        jsTernary(
          jsVar("waiting"),
          jsCall(jsVar("setDisplay"), [jsLit(digit)]),
          jsBinop("+", jsVar("display"), jsLit(digit))
        );

      const specs: ClusterableSpec<string>[] = [
        { id: "0", jsExpr: makeExpr("0"), argValues: ["0"] },
        { id: "1", jsExpr: makeExpr("1"), argValues: ["1"] },
      ];

      const clusters = clusterByJS(specs);
      expect(clusters[0].parameterCount).toBe(1);
      // Both holes map to parameter 0
      expect(clusters[0].parameterMapping).toEqual([0, 0]);
    });

    it("uses multiple parameters when values differ", () => {
      // makePoint(x, y) => { x: x, y: y }
      const makeExpr = (x: number, y: number) =>
        jsObject([{ key: "x", value: jsLit(x) }, { key: "y", value: jsLit(y) }]);

      const specs: ClusterableSpec<string>[] = [
        { id: "a", jsExpr: makeExpr(1, 2), argValues: [1, 2] },
        { id: "b", jsExpr: makeExpr(3, 4), argValues: [3, 4] },
      ];

      const clusters = clusterByJS(specs);
      expect(clusters[0].parameterCount).toBe(2);
      expect(clusters[0].parameterMapping).toEqual([0, 1]);
    });

    it("consolidates parameters that always have same value", () => {
      // If x and y always have the same value, use one parameter
      const makeExpr = (v: number) =>
        jsObject([{ key: "x", value: jsLit(v) }, { key: "y", value: jsLit(v) }]);

      const specs: ClusterableSpec<string>[] = [
        { id: "a", jsExpr: makeExpr(1), argValues: [1] },
        { id: "b", jsExpr: makeExpr(2), argValues: [2] },
      ];

      const clusters = clusterByJS(specs);
      expect(clusters[0].parameterCount).toBe(1);
      expect(clusters[0].parameterMapping).toEqual([0, 0]);
    });
  });

  describe("extractHoleValues", () => {
    it("extracts literal values at hole paths", () => {
      const expr = jsObject([
        { key: "x", value: jsLit(42) },
        { key: "y", value: jsLit("hello") },
      ]);
      const holes = [["fields", 0, "value"], ["fields", 1, "value"]] as any;
      expect(extractHoleValues(expr, holes)).toEqual([42, "hello"]);
    });
  });

  describe("getParameterValues", () => {
    it("returns deduplicated parameter values", () => {
      const expr = jsObject([
        { key: "a", value: jsLit(5) },
        { key: "b", value: jsLit(5) },
        { key: "c", value: jsLit(10) },
      ]);

      const cluster = {
        members: [{ id: "test", jsExpr: expr, argValues: [] }],
        template: {
          signature: "",
          holes: [
            ["fields", 0, "value"],
            ["fields", 1, "value"],
            ["fields", 2, "value"],
          ] as any,
        },
        parameterMapping: [0, 0, 1], // First two share param 0, third is param 1
        parameterCount: 2,
      };

      const values = getParameterValues(cluster.members[0], cluster);
      expect(values).toEqual([5, 10]);
    });
  });

  describe("applyTemplate", () => {
    it("replaces holes with variable references", () => {
      const expr = jsBinop("+", jsLit(1), jsLit(2));
      const holes = [["left"], ["right"]] as any;
      const paramMapping = [0, 1];
      const paramNames = ["x", "y"];

      const result = applyTemplate(expr, holes, paramMapping, paramNames);

      expect(result).toEqual(jsBinop("+", jsVar("x"), jsVar("y")));
    });

    it("consolidates holes with same parameter", () => {
      const expr = jsObject([
        { key: "a", value: jsLit(1) },
        { key: "b", value: jsLit(1) },
      ]);
      const holes = [["fields", 0, "value"], ["fields", 1, "value"]] as any;
      const paramMapping = [0, 0]; // Both map to param 0
      const paramNames = ["x"];

      const result = applyTemplate(expr, holes, paramMapping, paramNames);

      expect(result).toEqual(
        jsObject([
          { key: "a", value: jsVar("x") },
          { key: "b", value: jsVar("x") },
        ])
      );
    });

    it("handles nested expressions", () => {
      const expr = jsTernary(
        jsVar("cond"),
        jsCall(jsVar("f"), [jsLit("a")]),
        jsBinop("+", jsVar("s"), jsLit("a"))
      );
      const holes = [["then", "args", 0], ["else", "right"]] as any;
      const paramMapping = [0, 0]; // Same parameter
      const paramNames = ["digit"];

      const result = applyTemplate(expr, holes, paramMapping, paramNames);

      expect(result).toEqual(
        jsTernary(
          jsVar("cond"),
          jsCall(jsVar("f"), [jsVar("digit")]),
          jsBinop("+", jsVar("s"), jsVar("digit"))
        )
      );
    });
  });

  describe("identity function example - cross-type merging", () => {
    it("merges identity(42) and identity('hello') into same cluster", () => {
      // The key insight: identity(42) produces JS `42`
      // identity("hello") produces JS `"hello"`
      // These have the same structure (a literal) so they merge
      const specs: ClusterableSpec<string>[] = [
        { id: "num", jsExpr: jsLit(42), argValues: [42] },
        { id: "str", jsExpr: jsLit("hello"), argValues: ["hello"] },
      ];

      const clusters = clusterByJS(specs);

      expect(clusters.length).toBe(1);
      expect(clusters[0].members.length).toBe(2);
      expect(clusters[0].parameterCount).toBe(1);
    });
  });

  describe("format function example - structural difference", () => {
    it("separates format(number) and format(string) due to different operators", () => {
      // format(numVar) produces: x * 2
      // format(strVar) produces: x + x
      // Different operators = structural difference = separate clusters
      const specs: ClusterableSpec<string>[] = [
        { id: "num", jsExpr: jsBinop("*", jsVar("x"), jsLit(2)), argValues: [] },
        { id: "str", jsExpr: jsBinop("+", jsVar("x"), jsVar("x")), argValues: [] },
      ];

      const clusters = clusterByJS(specs);

      expect(clusters.length).toBe(2);
    });
  });
});
