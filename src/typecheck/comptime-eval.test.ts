/**
 * Tests for compile-time evaluation.
 */

import { describe, test, expect } from "vitest";
import { ComptimeEvaluator, comptimeEquals } from "./comptime-eval.js";
import { ComptimeEnv, ComptimeValue, isTypeValue } from "./comptime-env.js";
import { TypeEnv } from "./type-env.js";
import { createInitialComptimeEnv, createInitialTypeEnv } from "./builtins.js";
import { CoreExpr, BinaryOp, dummyLoc, located } from "../ast/core-ast.js";
import { primitiveType, recordType, unionType, Type } from "../types/types.js";

// Helper to create expressions with dummy locations
function loc<T>(expr: T): T & { loc: { from: number; to: number } } {
  return located(expr, dummyLoc()) as T & { loc: { from: number; to: number } };
}

// Helper to create literal expressions
function literal(value: string | number | boolean | null | undefined): CoreExpr {
  let literalKind: "int" | "float" | "string" | "boolean" | "null" | "undefined";
  if (typeof value === "string") literalKind = "string";
  else if (typeof value === "number") literalKind = Number.isInteger(value) ? "int" : "float";
  else if (typeof value === "boolean") literalKind = "boolean";
  else if (value === null) literalKind = "null";
  else literalKind = "undefined";
  return loc({ kind: "literal", value, literalKind });
}

// Helper to create identifier expressions
function id(name: string): CoreExpr {
  return loc({ kind: "identifier", name });
}

// Helper to create binary expressions
function binary(op: BinaryOp, left: CoreExpr, right: CoreExpr): CoreExpr {
  return loc({ kind: "binary", op, left, right });
}

// Helper to create call expressions
function call(fn: CoreExpr, args: CoreExpr[]): CoreExpr {
  return loc({ kind: "call", fn, args });
}

// Helper to create property access
function prop(obj: CoreExpr, name: string): CoreExpr {
  return loc({ kind: "property", object: obj, name });
}

// Helper to create array expressions
function array(...elements: CoreExpr[]): CoreExpr {
  return loc({
    kind: "array",
    elements: elements.map((e) => ({ kind: "element" as const, value: e })),
  });
}

// Helper to create record expressions
function record(fields: Record<string, CoreExpr>): CoreExpr {
  return loc({
    kind: "record",
    fields: Object.entries(fields).map(([name, value]) => ({
      kind: "field" as const,
      name,
      value,
    })),
  });
}

// Helper to create lambda expressions
function lambda(params: string[], body: CoreExpr): CoreExpr {
  return loc({
    kind: "lambda",
    params: params.map((name) => ({ name, annotations: [] })),
    body,
    async: false,
  });
}

// Helper to create conditional expressions
function cond(condition: CoreExpr, then: CoreExpr, else_: CoreExpr): CoreExpr {
  return loc({ kind: "conditional", condition, then, else: else_ });
}

describe("ComptimeEvaluator", () => {
  describe("literals", () => {
    test("evaluates integer literals", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(literal(42), env, typeEnv)).toBe(42);
      expect(evaluator.evaluate(literal(0), env, typeEnv)).toBe(0);
      expect(evaluator.evaluate(literal(-5), env, typeEnv)).toBe(-5);
    });

    test("evaluates float literals", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(literal(3.14), env, typeEnv)).toBe(3.14);
      expect(evaluator.evaluate(literal(0.0), env, typeEnv)).toBe(0.0);
    });

    test("evaluates string literals", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(literal("hello"), env, typeEnv)).toBe("hello");
      expect(evaluator.evaluate(literal(""), env, typeEnv)).toBe("");
    });

    test("evaluates boolean literals", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(literal(true), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(literal(false), env, typeEnv)).toBe(false);
    });

    test("evaluates null and undefined", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(literal(null), env, typeEnv)).toBe(null);
      expect(evaluator.evaluate(literal(undefined), env, typeEnv)).toBe(undefined);
    });
  });

  describe("identifiers", () => {
    test("looks up defined values", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      env.defineEvaluated("x", 42);
      env.defineEvaluated("name", "hello");

      expect(evaluator.evaluate(id("x"), env, typeEnv)).toBe(42);
      expect(evaluator.evaluate(id("name"), env, typeEnv)).toBe("hello");
    });

    test("throws on undefined identifier", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(() => evaluator.evaluate(id("unknown"), env, typeEnv)).toThrow(
        "'unknown' is not defined"
      );
    });

    test("lazy evaluation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // Define a lazy binding
      env.defineUnevaluated("lazy", literal(100), typeEnv);

      // Should evaluate on access
      expect(evaluator.evaluate(id("lazy"), env, typeEnv)).toBe(100);

      // Should be cached now
      expect(env.getEvaluatedValue("lazy")).toBe(100);
    });
  });

  describe("binary operations", () => {
    test("arithmetic", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(binary("+", literal(2), literal(3)), env, typeEnv)).toBe(5);
      expect(evaluator.evaluate(binary("-", literal(10), literal(4)), env, typeEnv)).toBe(6);
      expect(evaluator.evaluate(binary("*", literal(3), literal(4)), env, typeEnv)).toBe(12);
      expect(evaluator.evaluate(binary("/", literal(10), literal(2)), env, typeEnv)).toBe(5);
      expect(evaluator.evaluate(binary("%", literal(10), literal(3)), env, typeEnv)).toBe(1);
    });

    test("string concatenation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(binary("+", literal("hello"), literal(" world")), env, typeEnv)).toBe(
        "hello world"
      );
      expect(evaluator.evaluate(binary("+", literal("num: "), literal(42)), env, typeEnv)).toBe(
        "num: 42"
      );
    });

    test("comparisons", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(binary("<", literal(1), literal(2)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary(">", literal(5), literal(3)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary("<=", literal(3), literal(3)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary(">=", literal(4), literal(4)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary("==", literal(5), literal(5)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary("!=", literal(5), literal(6)), env, typeEnv)).toBe(true);
    });

    test("logical operations", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(binary("&&", literal(true), literal(true)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary("&&", literal(true), literal(false)), env, typeEnv)).toBe(false);
      expect(evaluator.evaluate(binary("||", literal(false), literal(true)), env, typeEnv)).toBe(true);
      expect(evaluator.evaluate(binary("||", literal(false), literal(false)), env, typeEnv)).toBe(false);
    });

    test("bitwise operations", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(binary("|", literal(5), literal(3)), env, typeEnv)).toBe(7);
      expect(evaluator.evaluate(binary("&", literal(5), literal(3)), env, typeEnv)).toBe(1);
      expect(evaluator.evaluate(binary("^", literal(5), literal(3)), env, typeEnv)).toBe(6);
    });
  });

  describe("unary operations", () => {
    test("negation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      const neg = (e: CoreExpr): CoreExpr => loc({ kind: "unary", op: "-", operand: e });
      const not = (e: CoreExpr): CoreExpr => loc({ kind: "unary", op: "!", operand: e });
      const bitnot = (e: CoreExpr): CoreExpr => loc({ kind: "unary", op: "~", operand: e });

      expect(evaluator.evaluate(neg(literal(5)), env, typeEnv)).toBe(-5);
      expect(evaluator.evaluate(not(literal(true)), env, typeEnv)).toBe(false);
      expect(evaluator.evaluate(bitnot(literal(5)), env, typeEnv)).toBe(~5);
    });
  });

  describe("arrays and records", () => {
    test("evaluates array literals", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      const result = evaluator.evaluate(array(literal(1), literal(2), literal(3)), env, typeEnv);
      expect(result).toEqual([1, 2, 3]);
    });

    test("evaluates record literals", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      const result = evaluator.evaluate(record({ a: literal(1), b: literal("hello") }), env, typeEnv);
      expect(result).toEqual({ a: 1, b: "hello" });
    });

    test("property access on records", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      const rec = record({ x: literal(10), y: literal(20) });
      expect(evaluator.evaluate(prop(rec, "x"), env, typeEnv)).toBe(10);
      expect(evaluator.evaluate(prop(rec, "y"), env, typeEnv)).toBe(20);
    });

    test("index access on arrays", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      const arr = array(literal("a"), literal("b"), literal("c"));
      const idx = (obj: CoreExpr, i: CoreExpr): CoreExpr => loc({ kind: "index", object: obj, index: i });

      expect(evaluator.evaluate(idx(arr, literal(0)), env, typeEnv)).toBe("a");
      expect(evaluator.evaluate(idx(arr, literal(1)), env, typeEnv)).toBe("b");
    });

    test("array length", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      const arr = array(literal(1), literal(2), literal(3));
      expect(evaluator.evaluate(prop(arr, "length"), env, typeEnv)).toBe(3);
    });
  });

  describe("lambdas and calls", () => {
    test("evaluates simple lambda call", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // (x) => x + 1
      const addOne = lambda(["x"], binary("+", id("x"), literal(1)));
      // addOne(5)
      const callExpr = call(addOne, [literal(5)]);

      expect(evaluator.evaluate(callExpr, env, typeEnv)).toBe(6);
    });

    test("evaluates multi-param lambda", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // (a, b) => a + b
      const add = lambda(["a", "b"], binary("+", id("a"), id("b")));
      // add(3, 4)
      const callExpr = call(add, [literal(3), literal(4)]);

      expect(evaluator.evaluate(callExpr, env, typeEnv)).toBe(7);
    });

    test("closures capture environment", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      env.defineEvaluated("multiplier", 10);

      // (x) => x * multiplier
      const times = lambda(["x"], binary("*", id("x"), id("multiplier")));
      // times(5)
      const callExpr = call(times, [literal(5)]);

      expect(evaluator.evaluate(callExpr, env, typeEnv)).toBe(50);
    });
  });

  describe("conditionals", () => {
    test("evaluates true branch", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(cond(literal(true), literal("yes"), literal("no")), env, typeEnv)).toBe(
        "yes"
      );
    });

    test("evaluates false branch", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      expect(evaluator.evaluate(cond(literal(false), literal("yes"), literal("no")), env, typeEnv)).toBe(
        "no"
      );
    });

    test("short-circuits evaluation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // If true branch is taken, the false branch (which throws) should never run
      const result = evaluator.evaluate(
        cond(literal(true), literal("safe"), loc({ kind: "throw", expr: literal("error") })),
        env,
        typeEnv
      );
      expect(result).toBe("safe");
    });
  });

  describe("fuel limit", () => {
    test("throws when fuel exhausted", () => {
      const evaluator = new ComptimeEvaluator(5);
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // Create a deeply nested expression
      let expr: CoreExpr = literal(0);
      for (let i = 0; i < 10; i++) {
        expr = binary("+", expr, literal(1));
      }

      expect(() => evaluator.evaluate(expr, env, typeEnv)).toThrow("fuel limit");
    });

    test("can reset fuel", () => {
      const evaluator = new ComptimeEvaluator(100);
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // Use some fuel
      evaluator.evaluate(literal(1), env, typeEnv);
      expect(evaluator.getRemainingFuel()).toBeLessThan(100);

      // Reset
      evaluator.reset();
      expect(evaluator.getRemainingFuel()).toBe(100);
    });
  });
});

describe("builtins", () => {
  describe("primitive types", () => {
    test("primitive types are available", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      const int = evaluator.evaluate(id("Int"), env, typeEnv);
      expect(isTypeValue(int)).toBe(true);
      expect((int as Type).kind).toBe("primitive");
      expect((int as Type & { kind: "primitive" }).name).toBe("Int");

      const str = evaluator.evaluate(id("String"), env, typeEnv);
      expect(isTypeValue(str)).toBe(true);
      expect((str as Type).kind).toBe("primitive");
      expect((str as Type & { kind: "primitive" }).name).toBe("String");
    });
  });

  describe("Union", () => {
    test("creates union types", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Union(Int, String)
      const unionExpr = call(id("Union"), [id("Int"), id("String")]);
      const result = evaluator.evaluate(unionExpr, env, typeEnv);

      expect(isTypeValue(result)).toBe(true);
      const unionType = result as Type;
      expect(unionType.kind).toBe("union");
      expect((unionType as { kind: "union"; types: Type[] }).types).toHaveLength(2);
    });
  });

  describe("RecordType", () => {
    test("creates record types", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // RecordType([{ name: "x", type: Int, optional: false, annotations: [] }])
      const fieldInfo = record({
        name: literal("x"),
        type: id("Int"),
        optional: literal(false),
        annotations: array(),
      });
      const recordTypeExpr = call(id("RecordType"), [array(fieldInfo)]);
      const result = evaluator.evaluate(recordTypeExpr, env, typeEnv);

      expect(isTypeValue(result)).toBe(true);
      const recType = result as Type;
      expect(recType.kind).toBe("record");
      expect((recType as { kind: "record"; fields: { name: string }[] }).fields[0].name).toBe("x");
    });
  });

  describe("Array type constructor", () => {
    test("creates variable-length array type", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Array(Int)
      const arrayExpr = call(id("Array"), [id("Int")]);
      const result = evaluator.evaluate(arrayExpr, env, typeEnv);

      expect(isTypeValue(result)).toBe(true);
      const arrType = result as Type;
      expect(arrType.kind).toBe("array");
      expect((arrType as { kind: "array"; variadic: boolean }).variadic).toBe(true);
    });

    test("creates tuple type with multiple args", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Array(Int, String)
      const tupleExpr = call(id("Array"), [id("Int"), id("String")]);
      const result = evaluator.evaluate(tupleExpr, env, typeEnv);

      expect(isTypeValue(result)).toBe(true);
      const arrType = result as Type;
      expect(arrType.kind).toBe("array");
      expect((arrType as { kind: "array"; variadic: boolean }).variadic).toBe(false);
      expect((arrType as { kind: "array"; elementTypes: Type[] }).elementTypes).toHaveLength(2);
    });
  });

  describe("assert", () => {
    test("passes on true", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      const assertExpr = call(id("assert"), [literal(true)]);
      expect(() => evaluator.evaluate(assertExpr, env, typeEnv)).not.toThrow();
    });

    test("throws on false", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      const assertExpr = call(id("assert"), [literal(false)]);
      expect(() => evaluator.evaluate(assertExpr, env, typeEnv)).toThrow("Assertion failed");
    });

    test("throws with custom message", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      const assertExpr = call(id("assert"), [literal(false), literal("custom error")]);
      expect(() => evaluator.evaluate(assertExpr, env, typeEnv)).toThrow("custom error");
    });
  });
});

describe("type properties", () => {
  describe(".name", () => {
    test("returns primitive type name", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      expect(evaluator.evaluate(prop(id("Int"), "name"), env, typeEnv)).toBe("Int");
      expect(evaluator.evaluate(prop(id("String"), "name"), env, typeEnv)).toBe("String");
    });
  });

  describe(".fieldNames and .fields", () => {
    test("returns field names for record types", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a record type
      const fieldInfo1 = record({
        name: literal("x"),
        type: id("Int"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo2 = record({
        name: literal("y"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const recTypeExpr = call(id("RecordType"), [array(fieldInfo1, fieldInfo2)]);

      // Store it
      env.defineEvaluated("MyRecord", evaluator.evaluate(recTypeExpr, env, typeEnv));

      // Get fieldNames
      const fieldNames = evaluator.evaluate(prop(id("MyRecord"), "fieldNames"), env, typeEnv);
      expect(fieldNames).toEqual(["x", "y"]);
    });

    test(".fields returns FieldInfo array", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      const fieldInfo = record({
        name: literal("value"),
        type: id("Int"),
        optional: literal(true),
        annotations: array(),
      });
      const recTypeExpr = call(id("RecordType"), [array(fieldInfo)]);
      env.defineEvaluated("MyRecord", evaluator.evaluate(recTypeExpr, env, typeEnv));

      const fields = evaluator.evaluate(prop(id("MyRecord"), "fields"), env, typeEnv) as ComptimeValue[];
      expect(Array.isArray(fields)).toBe(true);
      expect(fields).toHaveLength(1);
      expect((fields[0] as Record<string, unknown>).name).toBe("value");
      expect((fields[0] as Record<string, unknown>).optional).toBe(true);
    });
  });

  describe(".extends", () => {
    test("checks subtype relationship", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Int.extends(Number) should be true
      const extendsCall = call(prop(id("Int"), "extends"), [id("Number")]);
      expect(evaluator.evaluate(extendsCall, env, typeEnv)).toBe(true);

      // String.extends(Number) should be false
      const extendsCall2 = call(prop(id("String"), "extends"), [id("Number")]);
      expect(evaluator.evaluate(extendsCall2, env, typeEnv)).toBe(false);
    });
  });

  describe(".variants", () => {
    test("returns union variants", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create Union(Int, String)
      const unionExpr = call(id("Union"), [id("Int"), id("String")]);
      env.defineEvaluated("MyUnion", evaluator.evaluate(unionExpr, env, typeEnv));

      // Get variants
      const variants = evaluator.evaluate(prop(id("MyUnion"), "variants"), env, typeEnv) as Type[];
      expect(Array.isArray(variants)).toBe(true);
      expect(variants).toHaveLength(2);
      expect(variants.every(isTypeValue)).toBe(true);
    });
  });
});

describe("comptimeEquals", () => {
  test("primitives", () => {
    expect(comptimeEquals(1, 1)).toBe(true);
    expect(comptimeEquals(1, 2)).toBe(false);
    expect(comptimeEquals("hello", "hello")).toBe(true);
    expect(comptimeEquals("hello", "world")).toBe(false);
    expect(comptimeEquals(true, true)).toBe(true);
    expect(comptimeEquals(null, null)).toBe(true);
    expect(comptimeEquals(undefined, undefined)).toBe(true);
    expect(comptimeEquals(null, undefined)).toBe(false);
  });

  test("arrays", () => {
    expect(comptimeEquals([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(comptimeEquals([1, 2], [1, 2, 3])).toBe(false);
    expect(comptimeEquals(["a", "b"], ["a", "b"])).toBe(true);
  });

  test("nested arrays", () => {
    expect(comptimeEquals([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
    expect(comptimeEquals([[1, 2], [3]], [[1, 2], [3, 4]])).toBe(false);
  });

  test("records", () => {
    expect(comptimeEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(comptimeEquals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(comptimeEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test("types", () => {
    expect(comptimeEquals(primitiveType("Int"), primitiveType("Int"))).toBe(true);
    expect(comptimeEquals(primitiveType("Int"), primitiveType("String"))).toBe(false);
  });
});
