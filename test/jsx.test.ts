import { describe, it, expect } from "vitest";
import { parse } from "../src/parser";
import { exprToString } from "../src/expr";
import { compile } from "../src/codegen";

describe("JSX Parsing", () => {
  describe("Basic elements", () => {
    it("parses self-closing element", () => {
      const code = `<div />`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("div", {  })');
    });

    it("parses element with text child", () => {
      const code = `<span>Hello</span>`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("span", { children: "Hello" })');
    });

    it("parses nested elements", () => {
      const code = `<div><span>A</span><span>B</span></div>`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe(
        'jsxs("div", { children: [jsx("span", { children: "A" }), jsx("span", { children: "B" })] })'
      );
    });

    it("parses component (uppercase) as variable reference", () => {
      const code = `<MyComponent />`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx(MyComponent, {  })');
    });
  });

  describe("Attributes", () => {
    it("parses string attribute", () => {
      const code = `<input type="text" />`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("input", { type: "text" })');
    });

    it("parses expression attribute", () => {
      const code = `<button onClick={handler} />`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("button", { onClick: handler })');
    });

    it("parses object attribute", () => {
      const code = `<div style={{ color: "red" }} />`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("div", { style: { color: "red" } })');
    });

    it("parses boolean attribute", () => {
      const code = `<input disabled />`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("input", { disabled: true })');
    });
  });

  describe("Children", () => {
    it("parses expression child", () => {
      const code = `<span>{count}</span>`;
      const expr = parse(code);
      expect(exprToString(expr)).toBe('jsx("span", { children: count })');
    });

    it("parses mixed text and expressions", () => {
      const code = `<span>Count: {count}</span>`;
      const expr = parse(code);
      // Text and expression become array children
      expect(exprToString(expr)).toContain("jsxs");
    });

    it("parses nested JSX in expression", () => {
      const code = `<div>{items.map(fn(x) => <span>{x}</span>)}</div>`;
      const expr = parse(code);
      expect(exprToString(expr)).toContain("items.map");
    });
  });

  describe("Code generation", () => {
    it("generates valid JavaScript for simple element", () => {
      const code = `
        import { jsx } from "react/jsx-runtime" in
        <div>Hello</div>
      `;
      const js = compile(parse(code));
      expect(js).toContain('jsx("div"');
      expect(js).toContain('children: "Hello"');
    });

    it("generates valid JavaScript for element with handlers", () => {
      const code = `
        import { jsx } from "react/jsx-runtime" in
        <button onClick={fn() => doSomething()}>Click</button>
      `;
      const js = compile(parse(code));
      expect(js).toContain("onClick:");
      expect(js).toContain("doSomething");
    });
  });
});
