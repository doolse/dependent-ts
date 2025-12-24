/**
 * Tests for method calls on primitives.
 */
import { describe, it, expect } from "vitest";

import {
  parse,
  parseAndRun,
  parseAndCompile,
  exprToString,
  isString,
  isNumber,
  isBool,
  isArray,
  implies,
} from "../src/index";

function evalTo(source: string): unknown {
  const result = parseAndRun(source);
  const v = result.value;
  switch (v.tag) {
    case "number":
      return v.value;
    case "string":
      return v.value;
    case "bool":
      return v.value;
    case "null":
      return null;
    case "array":
      return v.elements.map(e => {
        switch (e.tag) {
          case "number": return e.value;
          case "string": return e.value;
          case "bool": return e.value;
          case "null": return null;
          default: return e;
        }
      });
    default:
      return v;
  }
}

describe("String Method Parsing", () => {
  it("parses startsWith method call", () => {
    const expr = parse('"hello".startsWith("he")');
    expect(expr.tag).toBe("methodCall");
    if (expr.tag === "methodCall") {
      expect(expr.method).toBe("startsWith");
      expect(expr.args.length).toBe(1);
    }
  });

  it("parses chained method calls", () => {
    const expr = parse('"hello".toUpperCase().startsWith("HE")');
    expect(expr.tag).toBe("methodCall");
    if (expr.tag === "methodCall") {
      expect(expr.method).toBe("startsWith");
      expect(expr.receiver.tag).toBe("methodCall");
    }
  });

  it("parses method call with no args", () => {
    const expr = parse('"hello".toUpperCase()');
    expect(expr.tag).toBe("methodCall");
    if (expr.tag === "methodCall") {
      expect(expr.method).toBe("toUpperCase");
      expect(expr.args.length).toBe(0);
    }
  });

  it("distinguishes field access from method call", () => {
    const fieldExpr = parse("obj.field");
    expect(fieldExpr.tag).toBe("field");

    const methodExpr = parse("obj.method()");
    expect(methodExpr.tag).toBe("methodCall");
  });
});

describe("String Method Evaluation", () => {
  describe("startsWith/endsWith/includes", () => {
    it("evaluates startsWith correctly", () => {
      expect(evalTo('"hello world".startsWith("hello")')).toBe(true);
      expect(evalTo('"hello world".startsWith("world")')).toBe(false);
    });

    it("evaluates endsWith correctly", () => {
      expect(evalTo('"hello world".endsWith("world")')).toBe(true);
      expect(evalTo('"hello world".endsWith("hello")')).toBe(false);
    });

    it("evaluates includes correctly", () => {
      expect(evalTo('"hello world".includes("lo wo")')).toBe(true);
      expect(evalTo('"hello world".includes("xyz")')).toBe(false);
    });
  });

  describe("case transformation", () => {
    it("evaluates toUpperCase", () => {
      expect(evalTo('"hello".toUpperCase()')).toBe("HELLO");
    });

    it("evaluates toLowerCase", () => {
      expect(evalTo('"HELLO".toLowerCase()')).toBe("hello");
    });
  });

  describe("trim methods", () => {
    it("evaluates trim", () => {
      expect(evalTo('"  hello  ".trim()')).toBe("hello");
    });

    it("evaluates trimStart", () => {
      expect(evalTo('"  hello  ".trimStart()')).toBe("hello  ");
    });

    it("evaluates trimEnd", () => {
      expect(evalTo('"  hello  ".trimEnd()')).toBe("  hello");
    });
  });

  describe("slice and substring", () => {
    it("evaluates slice with two args", () => {
      expect(evalTo('"hello world".slice(0, 5)')).toBe("hello");
    });

    it("evaluates charAt", () => {
      expect(evalTo('"hello".charAt(1)')).toBe("e");
    });

    it("evaluates charCodeAt", () => {
      expect(evalTo('"A".charCodeAt(0)')).toBe(65);
    });
  });

  describe("indexOf/lastIndexOf", () => {
    it("evaluates indexOf", () => {
      expect(evalTo('"hello hello".indexOf("llo")')).toBe(2);
    });

    it("evaluates lastIndexOf", () => {
      expect(evalTo('"hello hello".lastIndexOf("llo")')).toBe(8);
    });

    it("returns -1 for not found", () => {
      expect(evalTo('"hello".indexOf("xyz")')).toBe(-1);
    });
  });

  describe("split", () => {
    it("evaluates split", () => {
      expect(evalTo('"a,b,c".split(",")')).toEqual(["a", "b", "c"]);
    });

    it("splits on empty string", () => {
      expect(evalTo('"abc".split("")')).toEqual(["a", "b", "c"]);
    });
  });

  describe("replace", () => {
    it("evaluates replace (first occurrence)", () => {
      expect(evalTo('"hello hello".replace("hello", "hi")')).toBe("hi hello");
    });

    it("evaluates replaceAll", () => {
      expect(evalTo('"hello hello".replaceAll("hello", "hi")')).toBe("hi hi");
    });
  });

  describe("padding", () => {
    it("evaluates padStart", () => {
      expect(evalTo('"5".padStart(3, "0")')).toBe("005");
    });

    it("evaluates padEnd", () => {
      expect(evalTo('"5".padEnd(3, "0")')).toBe("500");
    });
  });

  describe("repeat and concat", () => {
    it("evaluates repeat", () => {
      expect(evalTo('"ab".repeat(3)')).toBe("ababab");
    });

    it("evaluates concat", () => {
      expect(evalTo('"hello".concat(" world")')).toBe("hello world");
    });
  });
});

describe("Array Method Evaluation", () => {
  it("evaluates includes", () => {
    expect(evalTo('[1, 2, 3].includes(2)')).toBe(true);
    expect(evalTo('[1, 2, 3].includes(5)')).toBe(false);
  });

  it("evaluates join", () => {
    expect(evalTo('["a", "b", "c"].join("-")')).toBe("a-b-c");
  });

  it("evaluates indexOf", () => {
    expect(evalTo('[1, 2, 3].indexOf(2)')).toBe(1);
    expect(evalTo('[1, 2, 3].indexOf(5)')).toBe(-1);
  });

  it("evaluates slice", () => {
    expect(evalTo('[1, 2, 3, 4, 5].slice(1, 3)')).toEqual([2, 3]);
  });

  it("evaluates reverse", () => {
    expect(evalTo('[1, 2, 3].reverse()')).toEqual([3, 2, 1]);
  });

  it("evaluates concat", () => {
    expect(evalTo('[1, 2].concat([3, 4])')).toEqual([1, 2, 3, 4]);
  });
});

describe("Number Method Evaluation", () => {
  it("evaluates toString", () => {
    expect(evalTo('(42).toString()')).toBe("42");
  });

  it("evaluates toFixed", () => {
    expect(evalTo('(3.14159).toFixed(2)')).toBe("3.14");
  });
});

describe("Chained Method Calls", () => {
  it("chains string methods", () => {
    expect(evalTo('"  Hello World  ".trim().toLowerCase()')).toBe("hello world");
  });

  it("chains with arguments", () => {
    expect(evalTo('"hello".toUpperCase().startsWith("HE")')).toBe(true);
  });

  it("chains split and join", () => {
    expect(evalTo('"a,b,c".split(",").join("-")')).toBe("a-b-c");
  });
});

describe("Method Calls with Runtime Values", () => {
  it("generates residual for runtime string methods", () => {
    const code = parseAndCompile('let s = runtime(s: "") in s.toUpperCase()');
    expect(code).toContain(".toUpperCase()");
  });

  it("generates residual for runtime argument", () => {
    const code = parseAndCompile('let prefix = runtime(p: "") in "hello".startsWith(prefix)');
    expect(code).toContain(".startsWith(");
  });

  it("generates residual for chained methods on runtime", () => {
    const code = parseAndCompile('let s = runtime(s: "") in s.trim().toLowerCase()');
    expect(code).toContain(".trim()");
    expect(code).toContain(".toLowerCase()");
  });
});

describe("Method Call Constraint Tracking", () => {
  it("tracks boolean constraint for predicates", () => {
    const result = parseAndRun('"hello".startsWith("he")');
    expect(implies(result.constraint, isBool)).toBe(true);
  });

  it("tracks string constraint for transformations", () => {
    const result = parseAndRun('"hello".toUpperCase()');
    expect(implies(result.constraint, isString)).toBe(true);
  });

  it("tracks number constraint for indexOf", () => {
    const result = parseAndRun('"hello".indexOf("l")');
    expect(implies(result.constraint, isNumber)).toBe(true);
  });

  it("tracks array constraint for split", () => {
    const result = parseAndRun('"a,b,c".split(",")');
    expect(implies(result.constraint, isArray)).toBe(true);
  });
});

describe("exprToString for Method Calls", () => {
  it("pretty prints method calls", () => {
    const expr = parse('"hello".startsWith("he")');
    expect(exprToString(expr)).toBe('"hello".startsWith("he")');
  });

  it("pretty prints chained method calls", () => {
    const expr = parse('"hello".trim().toUpperCase()');
    expect(exprToString(expr)).toBe('"hello".trim().toUpperCase()');
  });
});
