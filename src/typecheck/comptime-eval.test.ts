/**
 * Tests for compile-time evaluation.
 */

import { describe, test, expect } from "vitest";
import { ComptimeEvaluator, comptimeEquals } from "./comptime-eval";
import { ComptimeEnv, ComptimeValue, isTypeValue } from "./comptime-env";
import { TypeEnv } from "./type-env";
import { createInitialComptimeEnv, createInitialTypeEnv } from "./builtins";
import { CoreExpr, BinaryOp, dummyLoc, located, CorePattern, CoreCase, CorePatternField, CoreTemplatePart } from "../ast/core-ast";
import { primitiveType, recordType, unionType, Type } from "../types/types";

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

// Helper to create match expressions
function matchExpr(expr: CoreExpr, cases: CoreCase[]): CoreExpr {
  return loc({ kind: "match", expr, cases });
}

function matchCase(pattern: CorePattern, body: CoreExpr, guard?: CoreExpr): CoreCase {
  return { pattern, body, guard, loc: dummyLoc() };
}

function wildcardPattern(): CorePattern {
  return loc({ kind: "wildcard" });
}

function literalPattern(value: string | number | boolean | null | undefined): CorePattern {
  let literalKind: "int" | "float" | "string" | "boolean" | "null" | "undefined";
  if (typeof value === "string") literalKind = "string";
  else if (typeof value === "number") literalKind = Number.isInteger(value) ? "int" : "float";
  else if (typeof value === "boolean") literalKind = "boolean";
  else if (value === null) literalKind = "null";
  else literalKind = "undefined";
  return loc({ kind: "literal", value, literalKind });
}

function bindingPattern(name: string, nested?: CorePattern): CorePattern {
  return loc({ kind: "binding", name, pattern: nested });
}

function destructurePattern(fields: CorePatternField[]): CorePattern {
  return loc({ kind: "destructure", fields });
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

describe("function type properties", () => {
  describe(".returnType", () => {
    test("returns the return type of a function", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // FunctionType([Int], String).returnType
      const fnType = call(id("FunctionType"), [array(id("Int")), id("String")]);
      const returnType = prop(fnType, "returnType");

      const result = evaluator.evaluate(returnType, env, typeEnv);
      expect(isTypeValue(result)).toBe(true);
      expect((result as Type).kind).toBe("primitive");
      expect((result as Type & { kind: "primitive" }).name).toBe("String");
    });

    test("throws for non-function types", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      expect(() =>
        evaluator.evaluate(prop(id("Int"), "returnType"), env, typeEnv)
      ).toThrow(/function/i);
    });
  });

  describe(".parameterTypes", () => {
    test("returns array of parameter types", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // FunctionType([Int, String], Boolean).parameterTypes
      const fnType = call(id("FunctionType"), [
        array(id("Int"), id("String")),
        id("Boolean"),
      ]);
      const paramTypes = prop(fnType, "parameterTypes");

      const result = evaluator.evaluate(paramTypes, env, typeEnv) as Type[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect((result[0] as Type & { kind: "primitive" }).name).toBe("Int");
      expect((result[1] as Type & { kind: "primitive" }).name).toBe("String");
    });

    test("returns empty array for no-param function", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // FunctionType([], Int).parameterTypes
      const fnType = call(id("FunctionType"), [array(), id("Int")]);
      const paramTypes = prop(fnType, "parameterTypes");

      const result = evaluator.evaluate(paramTypes, env, typeEnv) as Type[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe("ReturnType utility pattern", () => {
    test("extracts return type from function type", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Define ReturnType = (T) => T.returnType
      const returnTypeFn = lambda(["T"], prop(id("T"), "returnType"));
      env.defineEvaluated("ReturnType", evaluator.evaluate(returnTypeFn, env, typeEnv));

      // Create a function type: (Int) => String
      const fnType = call(id("FunctionType"), [array(id("Int")), id("String")]);
      env.defineEvaluated("MyFn", evaluator.evaluate(fnType, env, typeEnv));

      // ReturnType(MyFn) should be String
      const result = evaluator.evaluate(call(id("ReturnType"), [id("MyFn")]), env, typeEnv);
      expect(isTypeValue(result)).toBe(true);
      expect((result as Type & { kind: "primitive" }).name).toBe("String");
    });
  });
});

describe("Intersection types", () => {
  test("creates intersection of types", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Intersection(Int, String)
    const intersectExpr = call(id("Intersection"), [id("Int"), id("String")]);
    const result = evaluator.evaluate(intersectExpr, env, typeEnv);

    expect(isTypeValue(result)).toBe(true);
    expect((result as Type).kind).toBe("intersection");
    expect((result as { kind: "intersection"; types: Type[] }).types).toHaveLength(2);
  });

  test("intersection of record types", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create { a: Int }
    const fieldA = record({
      name: literal("a"),
      type: id("Int"),
      optional: literal(false),
      annotations: array(),
    });
    const recA = call(id("RecordType"), [array(fieldA)]);

    // Create { b: String }
    const fieldB = record({
      name: literal("b"),
      type: id("String"),
      optional: literal(false),
      annotations: array(),
    });
    const recB = call(id("RecordType"), [array(fieldB)]);

    // Intersection of both
    const intersectExpr = call(id("Intersection"), [recA, recB]);
    const result = evaluator.evaluate(intersectExpr, env, typeEnv);

    expect(isTypeValue(result)).toBe(true);
    expect((result as Type).kind).toBe("intersection");
  });

  test(".signatures returns function types from intersection", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create intersection of two function types
    const fnType1 = call(id("FunctionType"), [
      array(record({ name: literal("x"), type: id("String"), optional: literal(false) })),
      id("Int"),
    ]);
    const fnType2 = call(id("FunctionType"), [
      array(record({ name: literal("x"), type: id("Int"), optional: literal(false) })),
      id("String"),
    ]);

    const intersectExpr = call(id("Intersection"), [fnType1, fnType2]);
    const signatures = prop(intersectExpr, "signatures");

    const result = evaluator.evaluate(signatures, env, typeEnv) as Type[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("function");
    expect(result[1].kind).toBe("function");
  });

  test(".returnType throws for intersection types", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create intersection of two function types
    const fnType1 = call(id("FunctionType"), [
      array(record({ name: literal("x"), type: id("String"), optional: literal(false) })),
      id("Int"),
    ]);
    const fnType2 = call(id("FunctionType"), [
      array(record({ name: literal("x"), type: id("Int"), optional: literal(false) })),
      id("String"),
    ]);

    const intersectExpr = call(id("Intersection"), [fnType1, fnType2]);
    const returnType = prop(intersectExpr, "returnType");

    expect(() => evaluator.evaluate(returnType, env, typeEnv)).toThrow(/ambiguous/);
  });

  test(".parameterTypes throws for intersection types", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create intersection of two function types
    const fnType1 = call(id("FunctionType"), [
      array(record({ name: literal("x"), type: id("String"), optional: literal(false) })),
      id("Int"),
    ]);
    const fnType2 = call(id("FunctionType"), [
      array(record({ name: literal("x"), type: id("Int"), optional: literal(false) })),
      id("String"),
    ]);

    const intersectExpr = call(id("Intersection"), [fnType1, fnType2]);
    const paramTypes = prop(intersectExpr, "parameterTypes");

    expect(() => evaluator.evaluate(paramTypes, env, typeEnv)).toThrow(/ambiguous/);
  });
});

describe("Branded types", () => {
  describe("Branded constructor", () => {
    test("creates branded type", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Branded(String, "UserId")
      const brandedExpr = call(id("Branded"), [id("String"), literal("UserId")]);
      const result = evaluator.evaluate(brandedExpr, env, typeEnv);

      expect(isTypeValue(result)).toBe(true);
      expect((result as Type).kind).toBe("branded");
    });

    test(".baseType returns underlying type", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Branded(String, "UserId").baseType
      const brandedExpr = call(id("Branded"), [id("String"), literal("UserId")]);
      env.defineEvaluated("UserId", evaluator.evaluate(brandedExpr, env, typeEnv));

      const baseType = evaluator.evaluate(prop(id("UserId"), "baseType"), env, typeEnv);
      expect(isTypeValue(baseType)).toBe(true);
      expect((baseType as Type & { kind: "primitive" }).name).toBe("String");
    });

    test(".brand returns brand name", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Branded(Int, "OrderId").brand
      const brandedExpr = call(id("Branded"), [id("Int"), literal("OrderId")]);
      env.defineEvaluated("OrderId", evaluator.evaluate(brandedExpr, env, typeEnv));

      const brand = evaluator.evaluate(prop(id("OrderId"), "brand"), env, typeEnv);
      expect(brand).toBe("OrderId");
    });
  });

  describe("branded type distinctness", () => {
    test("different brands create different types", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      const userId = call(id("Branded"), [id("String"), literal("UserId")]);
      const orderId = call(id("Branded"), [id("String"), literal("OrderId")]);

      env.defineEvaluated("UserId", evaluator.evaluate(userId, env, typeEnv));
      env.defineEvaluated("OrderId", evaluator.evaluate(orderId, env, typeEnv));

      // UserId.extends(OrderId) should be false
      const extendsCall = call(prop(id("UserId"), "extends"), [id("OrderId")]);
      expect(evaluator.evaluate(extendsCall, env, typeEnv)).toBe(false);

      // UserId.extends(UserId) should be true
      const selfExtends = call(prop(id("UserId"), "extends"), [id("UserId")]);
      expect(evaluator.evaluate(selfExtends, env, typeEnv)).toBe(true);
    });
  });
});

describe(".keysType property", () => {
  test("returns union of literal field names", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create { name: String, age: Int }
    const fieldInfo1 = record({
      name: literal("name"),
      type: id("String"),
      optional: literal(false),
      annotations: array(),
    });
    const fieldInfo2 = record({
      name: literal("age"),
      type: id("Int"),
      optional: literal(false),
      annotations: array(),
    });
    const recTypeExpr = call(id("RecordType"), [array(fieldInfo1, fieldInfo2)]);
    env.defineEvaluated("Person", evaluator.evaluate(recTypeExpr, env, typeEnv));

    // Person.keysType should be "name" | "age"
    const keysType = evaluator.evaluate(prop(id("Person"), "keysType"), env, typeEnv);
    expect(isTypeValue(keysType)).toBe(true);
    expect((keysType as Type).kind).toBe("union");
    const unionTypes = (keysType as { kind: "union"; types: Type[] }).types;
    expect(unionTypes).toHaveLength(2);
    expect(unionTypes.every((t) => t.kind === "literal")).toBe(true);
    const values = unionTypes.map((t) => (t as { kind: "literal"; value: string }).value);
    expect(values).toContain("name");
    expect(values).toContain("age");
  });

  test("returns Never for empty record", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create empty record {}
    const emptyRecExpr = call(id("RecordType"), [array()]);
    env.defineEvaluated("Empty", evaluator.evaluate(emptyRecExpr, env, typeEnv));

    // Empty.keysType should be Never
    const keysType = evaluator.evaluate(prop(id("Empty"), "keysType"), env, typeEnv);
    expect(isTypeValue(keysType)).toBe(true);
    expect((keysType as Type).kind).toBe("primitive");
    expect((keysType as Type & { kind: "primitive" }).name).toBe("Never");
  });

  test("throws for non-record types", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    expect(() =>
      evaluator.evaluate(prop(id("Int"), "keysType"), env, typeEnv)
    ).toThrow(/record/i);
  });
});

describe("WithMetadata", () => {
  test("attaches name to type", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // WithMetadata(Int, { name: "MyInt" })
    const withMeta = call(id("WithMetadata"), [
      id("Int"),
      record({ name: literal("MyInt") }),
    ]);
    const result = evaluator.evaluate(withMeta, env, typeEnv);

    expect(isTypeValue(result)).toBe(true);
    // .name should return "MyInt"
    env.defineEvaluated("MyInt", result);
    const name = evaluator.evaluate(prop(id("MyInt"), "name"), env, typeEnv);
    expect(name).toBe("MyInt");
  });

  test("attaches typeArgs to type", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // WithMetadata(Array(Int), { name: "IntArray", typeArgs: [Int] })
    const arrayInt = call(id("Array"), [id("Int")]);
    const withMeta = call(id("WithMetadata"), [
      arrayInt,
      record({
        name: literal("IntArray"),
        typeArgs: array(id("Int")),
      }),
    ]);
    env.defineEvaluated("IntArray", evaluator.evaluate(withMeta, env, typeEnv));

    // .typeArgs should return [Int]
    const typeArgs = evaluator.evaluate(prop(id("IntArray"), "typeArgs"), env, typeEnv) as Type[];
    expect(Array.isArray(typeArgs)).toBe(true);
    expect(typeArgs).toHaveLength(1);
    expect((typeArgs[0] as Type & { kind: "primitive" }).name).toBe("Int");
  });

  test(".baseName returns name without type args", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Create Array<Int> with metadata
    const arrayInt = call(id("Array"), [id("Int")]);
    const withMeta = call(id("WithMetadata"), [
      arrayInt,
      record({
        name: literal("Container"),
        typeArgs: array(id("Int")),
      }),
    ]);
    env.defineEvaluated("Container", evaluator.evaluate(withMeta, env, typeEnv));

    const baseName = evaluator.evaluate(prop(id("Container"), "baseName"), env, typeEnv);
    expect(baseName).toBe("Container");
  });

  test("attaches annotations to type", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // WithMetadata(String, { name: "Email", annotations: ["validated"] })
    const withMeta = call(id("WithMetadata"), [
      id("String"),
      record({
        name: literal("Email"),
        annotations: array(literal("validated")),
      }),
    ]);
    env.defineEvaluated("Email", evaluator.evaluate(withMeta, env, typeEnv));

    // .annotations should return ["validated"]
    const annotations = evaluator.evaluate(
      prop(id("Email"), "annotations"),
      env,
      typeEnv
    ) as string[];
    expect(Array.isArray(annotations)).toBe(true);
    expect(annotations).toContain("validated");
  });
});

describe("conditional type patterns", () => {
  test("T.extends(U) ? X : Y pattern", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // IsNumber = (T) => T.extends(Number) ? true : false
    const isNumberFn = lambda(
      ["T"],
      cond(
        call(prop(id("T"), "extends"), [id("Number")]),
        literal(true),
        literal(false)
      )
    );
    env.defineEvaluated("IsNumber", evaluator.evaluate(isNumberFn, env, typeEnv));

    // IsNumber(Int) should be true (Int extends Number)
    expect(evaluator.evaluate(call(id("IsNumber"), [id("Int")]), env, typeEnv)).toBe(true);

    // IsNumber(String) should be false
    expect(evaluator.evaluate(call(id("IsNumber"), [id("String")]), env, typeEnv)).toBe(false);
  });

  test("NonNullable pattern", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // NonNullable = (T) => T.extends(Union(Null, Undefined)) ? Never : T
    const nullishUnion = call(id("Union"), [id("Null"), id("Undefined")]);
    const nonNullableFn = lambda(
      ["T"],
      cond(
        call(prop(id("T"), "extends"), [nullishUnion]),
        id("Never"),
        id("T")
      )
    );
    env.defineEvaluated("NonNullable", evaluator.evaluate(nonNullableFn, env, typeEnv));

    // NonNullable(String) should return String
    const result1 = evaluator.evaluate(call(id("NonNullable"), [id("String")]), env, typeEnv);
    expect(isTypeValue(result1)).toBe(true);
    expect((result1 as Type & { kind: "primitive" }).name).toBe("String");

    // NonNullable(Null) should return Never
    const result2 = evaluator.evaluate(call(id("NonNullable"), [id("Null")]), env, typeEnv);
    expect(isTypeValue(result2)).toBe(true);
    expect((result2 as Type & { kind: "primitive" }).name).toBe("Never");
  });

  test("Extract pattern - returns type if matches, Never otherwise", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Extract = (T, U) => T.extends(U) ? T : Never
    const extractFn = lambda(
      ["T", "U"],
      cond(
        call(prop(id("T"), "extends"), [id("U")]),
        id("T"),
        id("Never")
      )
    );
    env.defineEvaluated("Extract", evaluator.evaluate(extractFn, env, typeEnv));

    // Extract(Int, Number) should return Int
    const result1 = evaluator.evaluate(
      call(id("Extract"), [id("Int"), id("Number")]),
      env,
      typeEnv
    );
    expect(isTypeValue(result1)).toBe(true);
    expect((result1 as Type & { kind: "primitive" }).name).toBe("Int");

    // Extract(String, Number) should return Never
    const result2 = evaluator.evaluate(
      call(id("Extract"), [id("String"), id("Number")]),
      env,
      typeEnv
    );
    expect(isTypeValue(result2)).toBe(true);
    expect((result2 as Type & { kind: "primitive" }).name).toBe("Never");
  });

  test("Exclude pattern - returns Never if matches, type otherwise", () => {
    const evaluator = new ComptimeEvaluator();
    const env = createInitialComptimeEnv();
    const typeEnv = createInitialTypeEnv();

    // Exclude = (T, U) => T.extends(U) ? Never : T
    const excludeFn = lambda(
      ["T", "U"],
      cond(
        call(prop(id("T"), "extends"), [id("U")]),
        id("Never"),
        id("T")
      )
    );
    env.defineEvaluated("Exclude", evaluator.evaluate(excludeFn, env, typeEnv));

    // Exclude(Int, Number) should return Never (Int extends Number)
    const result1 = evaluator.evaluate(
      call(id("Exclude"), [id("Int"), id("Number")]),
      env,
      typeEnv
    );
    expect(isTypeValue(result1)).toBe(true);
    expect((result1 as Type & { kind: "primitive" }).name).toBe("Never");

    // Exclude(String, Number) should return String
    const result2 = evaluator.evaluate(
      call(id("Exclude"), [id("String"), id("Number")]),
      env,
      typeEnv
    );
    expect(isTypeValue(result2)).toBe(true);
    expect((result2 as Type & { kind: "primitive" }).name).toBe("String");
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

describe("Array methods at compile time", () => {
  describe("map", () => {
    test("transforms array elements", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].map(x => x * 2)
      const mapExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "map"),
        [lambda(["x"], binary("*", id("x"), literal(2)))]
      );

      expect(evaluator.evaluate(mapExpr, env, typeEnv)).toEqual([2, 4, 6]);
    });

    test("passes index as second argument", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // ["a", "b", "c"].map((_, i) => i)
      const mapExpr = call(
        prop(array(literal("a"), literal("b"), literal("c")), "map"),
        [lambda(["x", "i"], id("i"))]
      );

      expect(evaluator.evaluate(mapExpr, env, typeEnv)).toEqual([0, 1, 2]);
    });

    test("works with record transformation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [{ a: 1 }, { a: 2 }].map(r => r.a)
      env.defineEvaluated("arr", [{ a: 1 }, { a: 2 }]);
      const mapExpr = call(
        prop(id("arr"), "map"),
        [lambda(["r"], prop(id("r"), "a"))]
      );

      expect(evaluator.evaluate(mapExpr, env, typeEnv)).toEqual([1, 2]);
    });
  });

  describe("filter", () => {
    test("filters array elements", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4, 5].filter(x => x > 2)
      const filterExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4), literal(5)), "filter"),
        [lambda(["x"], binary(">", id("x"), literal(2)))]
      );

      expect(evaluator.evaluate(filterExpr, env, typeEnv)).toEqual([3, 4, 5]);
    });

    test("returns empty array when no matches", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].filter(x => x > 10)
      const filterExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "filter"),
        [lambda(["x"], binary(">", id("x"), literal(10)))]
      );

      expect(evaluator.evaluate(filterExpr, env, typeEnv)).toEqual([]);
    });
  });

  describe("includes", () => {
    test("returns true when element exists", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].includes(2)
      const includesExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "includes"),
        [literal(2)]
      );

      expect(evaluator.evaluate(includesExpr, env, typeEnv)).toBe(true);
    });

    test("returns false when element does not exist", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].includes(5)
      const includesExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "includes"),
        [literal(5)]
      );

      expect(evaluator.evaluate(includesExpr, env, typeEnv)).toBe(false);
    });

    test("works with strings", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // ["a", "b", "c"].includes("b")
      const includesExpr = call(
        prop(array(literal("a"), literal("b"), literal("c")), "includes"),
        [literal("b")]
      );

      expect(evaluator.evaluate(includesExpr, env, typeEnv)).toBe(true);
    });
  });

  describe("find", () => {
    test("returns first matching element", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4].find(x => x > 2)
      const findExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4)), "find"),
        [lambda(["x"], binary(">", id("x"), literal(2)))]
      );

      expect(evaluator.evaluate(findExpr, env, typeEnv)).toBe(3);
    });

    test("returns undefined when not found", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].find(x => x > 10)
      const findExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "find"),
        [lambda(["x"], binary(">", id("x"), literal(10)))]
      );

      expect(evaluator.evaluate(findExpr, env, typeEnv)).toBe(undefined);
    });
  });

  describe("findIndex", () => {
    test("returns index of first matching element", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4].findIndex(x => x > 2)
      const findIndexExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4)), "findIndex"),
        [lambda(["x"], binary(">", id("x"), literal(2)))]
      );

      expect(evaluator.evaluate(findIndexExpr, env, typeEnv)).toBe(2);
    });

    test("returns -1 when not found", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].findIndex(x => x > 10)
      const findIndexExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "findIndex"),
        [lambda(["x"], binary(">", id("x"), literal(10)))]
      );

      expect(evaluator.evaluate(findIndexExpr, env, typeEnv)).toBe(-1);
    });
  });

  describe("some", () => {
    test("returns true when some elements match", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].some(x => x > 2)
      const someExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "some"),
        [lambda(["x"], binary(">", id("x"), literal(2)))]
      );

      expect(evaluator.evaluate(someExpr, env, typeEnv)).toBe(true);
    });

    test("returns false when no elements match", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].some(x => x > 10)
      const someExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "some"),
        [lambda(["x"], binary(">", id("x"), literal(10)))]
      );

      expect(evaluator.evaluate(someExpr, env, typeEnv)).toBe(false);
    });
  });

  describe("every", () => {
    test("returns true when all elements match", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].every(x => x > 0)
      const everyExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "every"),
        [lambda(["x"], binary(">", id("x"), literal(0)))]
      );

      expect(evaluator.evaluate(everyExpr, env, typeEnv)).toBe(true);
    });

    test("returns false when some elements don't match", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].every(x => x > 1)
      const everyExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "every"),
        [lambda(["x"], binary(">", id("x"), literal(1)))]
      );

      expect(evaluator.evaluate(everyExpr, env, typeEnv)).toBe(false);
    });
  });

  describe("reduce", () => {
    test("reduces with initial value", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].reduce((acc, x) => acc + x, 0)
      const reduceExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "reduce"),
        [lambda(["acc", "x"], binary("+", id("acc"), id("x"))), literal(0)]
      );

      expect(evaluator.evaluate(reduceExpr, env, typeEnv)).toBe(6);
    });

    test("reduces without initial value", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4].reduce((acc, x) => acc + x)
      const reduceExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4)), "reduce"),
        [lambda(["acc", "x"], binary("+", id("acc"), id("x")))]
      );

      expect(evaluator.evaluate(reduceExpr, env, typeEnv)).toBe(10);
    });
  });

  describe("concat", () => {
    test("concatenates arrays", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2].concat([3, 4])
      const concatExpr = call(
        prop(array(literal(1), literal(2)), "concat"),
        [array(literal(3), literal(4))]
      );

      expect(evaluator.evaluate(concatExpr, env, typeEnv)).toEqual([1, 2, 3, 4]);
    });

    test("concatenates single values", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2].concat(3)
      const concatExpr = call(
        prop(array(literal(1), literal(2)), "concat"),
        [literal(3)]
      );

      expect(evaluator.evaluate(concatExpr, env, typeEnv)).toEqual([1, 2, 3]);
    });
  });

  describe("slice", () => {
    test("slices with start and end", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4, 5].slice(1, 4)
      const sliceExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4), literal(5)), "slice"),
        [literal(1), literal(4)]
      );

      expect(evaluator.evaluate(sliceExpr, env, typeEnv)).toEqual([2, 3, 4]);
    });

    test("slices with only start", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4, 5].slice(2)
      const sliceExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4), literal(5)), "slice"),
        [literal(2)]
      );

      expect(evaluator.evaluate(sliceExpr, env, typeEnv)).toEqual([3, 4, 5]);
    });
  });

  describe("indexOf", () => {
    test("returns index of element", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].indexOf(2)
      const indexOfExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "indexOf"),
        [literal(2)]
      );

      expect(evaluator.evaluate(indexOfExpr, env, typeEnv)).toBe(1);
    });

    test("returns -1 when not found", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].indexOf(5)
      const indexOfExpr = call(
        prop(array(literal(1), literal(2), literal(3)), "indexOf"),
        [literal(5)]
      );

      expect(evaluator.evaluate(indexOfExpr, env, typeEnv)).toBe(-1);
    });
  });

  describe("join", () => {
    test("joins with separator", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // ["a", "b", "c"].join("-")
      const joinExpr = call(
        prop(array(literal("a"), literal("b"), literal("c")), "join"),
        [literal("-")]
      );

      expect(evaluator.evaluate(joinExpr, env, typeEnv)).toBe("a-b-c");
    });

    test("joins with default comma separator", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // ["a", "b", "c"].join()
      const joinExpr = call(
        prop(array(literal("a"), literal("b"), literal("c")), "join"),
        []
      );

      expect(evaluator.evaluate(joinExpr, env, typeEnv)).toBe("a,b,c");
    });
  });

  describe("flat", () => {
    test("flattens one level by default", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [[1, 2], [3, 4]].flat()
      env.defineEvaluated("nested", [[1, 2], [3, 4]]);
      const flatExpr = call(prop(id("nested"), "flat"), []);

      expect(evaluator.evaluate(flatExpr, env, typeEnv)).toEqual([1, 2, 3, 4]);
    });

    test("flattens to specified depth", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [[[1]], [[2]]].flat(2)
      env.defineEvaluated("nested", [[[1]], [[2]]]);
      const flatExpr = call(prop(id("nested"), "flat"), [literal(2)]);

      expect(evaluator.evaluate(flatExpr, env, typeEnv)).toEqual([1, 2]);
    });
  });

  describe("flatMap", () => {
    test("maps and flattens result", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3].flatMap(x => [x, x * 2])
      env.defineEvaluated("arr", [1, 2, 3]);
      const flatMapExpr = call(
        prop(id("arr"), "flatMap"),
        [lambda(["x"], array(id("x"), binary("*", id("x"), literal(2))))]
      );

      expect(evaluator.evaluate(flatMapExpr, env, typeEnv)).toEqual([1, 2, 2, 4, 3, 6]);
    });
  });

  describe("chained array methods", () => {
    test("map then filter", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4].map(x => x * 2).filter(x => x > 4)
      const chainExpr = call(
        prop(
          call(
            prop(array(literal(1), literal(2), literal(3), literal(4)), "map"),
            [lambda(["x"], binary("*", id("x"), literal(2)))]
          ),
          "filter"
        ),
        [lambda(["x"], binary(">", id("x"), literal(4)))]
      );

      expect(evaluator.evaluate(chainExpr, env, typeEnv)).toEqual([6, 8]);
    });

    test("filter then map then reduce", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // [1, 2, 3, 4, 5].filter(x => x > 2).map(x => x * 10).reduce((a, b) => a + b, 0)
      const filterExpr = call(
        prop(array(literal(1), literal(2), literal(3), literal(4), literal(5)), "filter"),
        [lambda(["x"], binary(">", id("x"), literal(2)))]
      );
      const mapExpr = call(
        prop(filterExpr, "map"),
        [lambda(["x"], binary("*", id("x"), literal(10)))]
      );
      const reduceExpr = call(
        prop(mapExpr, "reduce"),
        [lambda(["a", "b"], binary("+", id("a"), id("b"))), literal(0)]
      );

      expect(evaluator.evaluate(reduceExpr, env, typeEnv)).toBe(120); // (3+4+5)*10 = 120
    });
  });

  describe("mapped type utilities pattern", () => {
    test("T.fields.map to transform fields", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a record type with fields
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
      env.defineEvaluated("MyRecord", evaluator.evaluate(recTypeExpr, env, typeEnv));

      // T.fields.map(f => ({ ...f, optional: true }))
      // Since we can't use spread in our AST helpers easily, we'll create new records
      const mapExpr = call(
        prop(prop(id("MyRecord"), "fields"), "map"),
        [
          lambda(
            ["f"],
            record({
              name: prop(id("f"), "name"),
              type: prop(id("f"), "type"),
              optional: literal(true),
              annotations: prop(id("f"), "annotations"),
            })
          ),
        ]
      );

      const mappedFields = evaluator.evaluate(mapExpr, env, typeEnv) as ComptimeValue[];
      expect(Array.isArray(mappedFields)).toBe(true);
      expect(mappedFields).toHaveLength(2);
      expect((mappedFields[0] as Record<string, unknown>).optional).toBe(true);
      expect((mappedFields[1] as Record<string, unknown>).optional).toBe(true);
    });

    test("T.fields.filter to select fields", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a record type with fields
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
      env.defineEvaluated("MyRecord", evaluator.evaluate(recTypeExpr, env, typeEnv));

      // Create an array of keys to pick
      env.defineEvaluated("keys", ["x"]);

      // T.fields.filter(f => keys.includes(f.name))
      const filterExpr = call(
        prop(prop(id("MyRecord"), "fields"), "filter"),
        [
          lambda(
            ["f"],
            call(prop(id("keys"), "includes"), [prop(id("f"), "name")])
          ),
        ]
      );

      const filteredFields = evaluator.evaluate(filterExpr, env, typeEnv) as ComptimeValue[];
      expect(Array.isArray(filteredFields)).toBe(true);
      expect(filteredFields).toHaveLength(1);
      expect((filteredFields[0] as Record<string, unknown>).name).toBe("x");
    });

    test("Partial utility function - makes all fields optional", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a record type: { name: String, age: Int }
      const fieldInfo1 = record({
        name: literal("name"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo2 = record({
        name: literal("age"),
        type: id("Int"),
        optional: literal(false),
        annotations: array(),
      });
      const personTypeExpr = call(id("RecordType"), [array(fieldInfo1, fieldInfo2)]);
      env.defineEvaluated("Person", evaluator.evaluate(personTypeExpr, env, typeEnv));

      // Define Partial function:
      // const Partial = (T: Type): Type => {
      //   const newFields = T.fields.map(f => ({ ...f, optional: true }));
      //   return RecordType(newFields, T.indexType);
      // };
      const partialFn = lambda(
        ["T"],
        call(id("RecordType"), [
          call(
            prop(prop(id("T"), "fields"), "map"),
            [
              lambda(
                ["f"],
                record({
                  name: prop(id("f"), "name"),
                  type: prop(id("f"), "type"),
                  optional: literal(true),
                  annotations: prop(id("f"), "annotations"),
                })
              ),
            ]
          ),
          prop(id("T"), "indexType"),
        ])
      );
      env.defineEvaluated("Partial", evaluator.evaluate(partialFn, env, typeEnv));

      // Call Partial(Person)
      const partialPersonExpr = call(id("Partial"), [id("Person")]);
      const partialPerson = evaluator.evaluate(partialPersonExpr, env, typeEnv) as Type;

      // Verify it's a record type with optional fields
      expect(isTypeValue(partialPerson)).toBe(true);
      expect(partialPerson.kind).toBe("record");
      if (partialPerson.kind === "record") {
        expect(partialPerson.fields).toHaveLength(2);
        expect(partialPerson.fields[0].optional).toBe(true);
        expect(partialPerson.fields[1].optional).toBe(true);
        expect(partialPerson.fields[0].name).toBe("name");
        expect(partialPerson.fields[1].name).toBe("age");
      }
    });

    test("Partial preserves closed records", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a CLOSED record type: {| name: String, age: Int |}
      const fieldInfo1 = record({
        name: literal("name"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo2 = record({
        name: literal("age"),
        type: id("Int"),
        optional: literal(false),
        annotations: array(),
      });
      // Pass Never as second arg to make it closed
      const closedTypeExpr = call(id("RecordType"), [array(fieldInfo1, fieldInfo2), id("Never")]);
      env.defineEvaluated("ClosedPerson", evaluator.evaluate(closedTypeExpr, env, typeEnv));

      // Verify it's closed
      const closedPerson = env.getEvaluatedValue("ClosedPerson") as Type;
      expect(closedPerson.kind).toBe("record");
      if (closedPerson.kind === "record") {
        expect(closedPerson.closed).toBe(true);
      }

      // Define Partial function (same as before)
      const partialFn = lambda(
        ["T"],
        call(id("RecordType"), [
          call(
            prop(prop(id("T"), "fields"), "map"),
            [
              lambda(
                ["f"],
                record({
                  name: prop(id("f"), "name"),
                  type: prop(id("f"), "type"),
                  optional: literal(true),
                  annotations: prop(id("f"), "annotations"),
                })
              ),
            ]
          ),
          prop(id("T"), "indexType"),
        ])
      );
      env.defineEvaluated("Partial", evaluator.evaluate(partialFn, env, typeEnv));

      // Call Partial(ClosedPerson)
      const partialClosedExpr = call(id("Partial"), [id("ClosedPerson")]);
      const partialClosed = evaluator.evaluate(partialClosedExpr, env, typeEnv) as Type;

      // Verify result is also a closed record with optional fields
      expect(partialClosed.kind).toBe("record");
      if (partialClosed.kind === "record") {
        expect(partialClosed.closed).toBe(true);
        expect(partialClosed.fields).toHaveLength(2);
        expect(partialClosed.fields[0].optional).toBe(true);
        expect(partialClosed.fields[1].optional).toBe(true);
      }
    });

    test("Pick utility function - selects specific fields", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a record type: { name: String, age: Int, email: String }
      const fieldInfo1 = record({
        name: literal("name"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo2 = record({
        name: literal("age"),
        type: id("Int"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo3 = record({
        name: literal("email"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const personTypeExpr = call(id("RecordType"), [array(fieldInfo1, fieldInfo2, fieldInfo3)]);
      env.defineEvaluated("Person", evaluator.evaluate(personTypeExpr, env, typeEnv));

      // Define Pick function:
      // const Pick = (T: Type, keys: Array<String>): Type => {
      //   const newFields = T.fields.filter(f => keys.includes(f.name));
      //   return RecordType(newFields, T.indexType);
      // };
      const pickFn = lambda(
        ["T", "keys"],
        call(id("RecordType"), [
          call(
            prop(prop(id("T"), "fields"), "filter"),
            [
              lambda(
                ["f"],
                call(prop(id("keys"), "includes"), [prop(id("f"), "name")])
              ),
            ]
          ),
          prop(id("T"), "indexType"),
        ])
      );
      env.defineEvaluated("Pick", evaluator.evaluate(pickFn, env, typeEnv));

      // Call Pick(Person, ["name", "email"])
      const pickExpr = call(id("Pick"), [id("Person"), array(literal("name"), literal("email"))]);
      const pickedType = evaluator.evaluate(pickExpr, env, typeEnv) as Type;

      // Verify it's a record type with only name and email fields
      expect(isTypeValue(pickedType)).toBe(true);
      expect(pickedType.kind).toBe("record");
      if (pickedType.kind === "record") {
        expect(pickedType.fields).toHaveLength(2);
        expect(pickedType.fields.map(f => f.name)).toEqual(["name", "email"]);
      }
    });

    test("Omit utility function - excludes specific fields", () => {
      const evaluator = new ComptimeEvaluator();
      const env = createInitialComptimeEnv();
      const typeEnv = createInitialTypeEnv();

      // Create a record type: { name: String, age: Int, password: String }
      const fieldInfo1 = record({
        name: literal("name"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo2 = record({
        name: literal("age"),
        type: id("Int"),
        optional: literal(false),
        annotations: array(),
      });
      const fieldInfo3 = record({
        name: literal("password"),
        type: id("String"),
        optional: literal(false),
        annotations: array(),
      });
      const userTypeExpr = call(id("RecordType"), [array(fieldInfo1, fieldInfo2, fieldInfo3)]);
      env.defineEvaluated("User", evaluator.evaluate(userTypeExpr, env, typeEnv));

      // Define Omit function:
      // const Omit = (T: Type, keys: Array<String>): Type => {
      //   const newFields = T.fields.filter(f => !keys.includes(f.name));
      //   return RecordType(newFields, T.indexType);
      // };
      const omitFn = lambda(
        ["T", "keys"],
        call(id("RecordType"), [
          call(
            prop(prop(id("T"), "fields"), "filter"),
            [
              lambda(
                ["f"],
                loc({ kind: "unary", op: "!", operand: call(prop(id("keys"), "includes"), [prop(id("f"), "name")]) })
              ),
            ]
          ),
          prop(id("T"), "indexType"),
        ])
      );
      env.defineEvaluated("Omit", evaluator.evaluate(omitFn, env, typeEnv));

      // Call Omit(User, ["password"])
      const omitExpr = call(id("Omit"), [id("User"), array(literal("password"))]);
      const omittedType = evaluator.evaluate(omitExpr, env, typeEnv) as Type;

      // Verify it's a record type without password field
      expect(isTypeValue(omittedType)).toBe(true);
      expect(omittedType.kind).toBe("record");
      if (omittedType.kind === "record") {
        expect(omittedType.fields).toHaveLength(2);
        expect(omittedType.fields.map(f => f.name)).toEqual(["name", "age"]);
      }
    });
  });
});

describe("match expression evaluation", () => {
  describe("literal patterns", () => {
    test("matches integer literal", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (42) { case 42: "matched"; case _: "default"; }
      const expr = matchExpr(literal(42), [
        matchCase(literalPattern(42), literal("matched")),
        matchCase(wildcardPattern(), literal("default")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("matched");
    });

    test("falls through to next case on no match", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (10) { case 42: "matched"; case _: "default"; }
      const expr = matchExpr(literal(10), [
        matchCase(literalPattern(42), literal("matched")),
        matchCase(wildcardPattern(), literal("default")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("default");
    });

    test("matches string literal", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ("hello") { case "hello": 1; case "world": 2; case _: 0; }
      const expr = matchExpr(literal("hello"), [
        matchCase(literalPattern("hello"), literal(1)),
        matchCase(literalPattern("world"), literal(2)),
        matchCase(wildcardPattern(), literal(0)),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(1);
    });

    test("matches boolean literal", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (true) { case true: "yes"; case false: "no"; }
      const expr = matchExpr(literal(true), [
        matchCase(literalPattern(true), literal("yes")),
        matchCase(literalPattern(false), literal("no")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("yes");
    });

    test("matches null literal", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (null) { case null: "null"; case _: "other"; }
      const expr = matchExpr(literal(null), [
        matchCase(literalPattern(null), literal("null")),
        matchCase(wildcardPattern(), literal("other")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("null");
    });
  });

  describe("wildcard pattern", () => {
    test("matches any value", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (42) { case _: "matched"; }
      const expr = matchExpr(literal(42), [
        matchCase(wildcardPattern(), literal("matched")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("matched");
    });

    test("matches records", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ({ a: 1 }) { case _: "matched"; }
      const expr = matchExpr(record({ a: literal(1) }), [
        matchCase(wildcardPattern(), literal("matched")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("matched");
    });
  });

  describe("binding patterns", () => {
    test("captures value in binding", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (42) { case n: n + 1; }
      const expr = matchExpr(literal(42), [
        matchCase(bindingPattern("n"), binary("+", id("n"), literal(1))),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(43);
    });

    test("binding is scoped to case body", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ("hello") { case s: s; }
      const expr = matchExpr(literal("hello"), [
        matchCase(bindingPattern("s"), id("s")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("hello");
    });

    test("multiple bindings in different cases", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (5) { case 1: 10; case x: x * 2; }
      const expr = matchExpr(literal(5), [
        matchCase(literalPattern(1), literal(10)),
        matchCase(bindingPattern("x"), binary("*", id("x"), literal(2))),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(10);
    });
  });

  describe("destructure patterns", () => {
    test("destructures record fields", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ({ x: 1, y: 2 }) { case { x, y }: x + y; }
      const expr = matchExpr(record({ x: literal(1), y: literal(2) }), [
        matchCase(
          destructurePattern([{ name: "x" }, { name: "y" }]),
          binary("+", id("x"), id("y"))
        ),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(3);
    });

    test("destructure with renamed binding", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ({ name: "Alice" }) { case { name: n }: n; }
      const expr = matchExpr(record({ name: literal("Alice") }), [
        matchCase(destructurePattern([{ name: "name", binding: "n" }]), id("n")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Alice");
    });

    test("destructure fails if field missing", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ({ a: 1 }) { case { b }: b; case _: 0; }
      const expr = matchExpr(record({ a: literal(1) }), [
        matchCase(destructurePattern([{ name: "b" }]), id("b")),
        matchCase(wildcardPattern(), literal(0)),
      ]);

      // Should fall through to wildcard since 'b' doesn't exist
      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(0);
    });

    test("partial destructure succeeds", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ({ x: 1, y: 2, z: 3 }) { case { x }: x; }
      const expr = matchExpr(
        record({ x: literal(1), y: literal(2), z: literal(3) }),
        [matchCase(destructurePattern([{ name: "x" }]), id("x"))]
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(1);
    });
  });

  describe("guards (when clause)", () => {
    test("guard passes - case matches", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (10) { case n when n > 5: "big"; case _: "small"; }
      const expr = matchExpr(literal(10), [
        matchCase(
          bindingPattern("n"),
          literal("big"),
          binary(">", id("n"), literal(5))
        ),
        matchCase(wildcardPattern(), literal("small")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("big");
    });

    test("guard fails - falls through to next case", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (3) { case n when n > 5: "big"; case _: "small"; }
      const expr = matchExpr(literal(3), [
        matchCase(
          bindingPattern("n"),
          literal("big"),
          binary(">", id("n"), literal(5))
        ),
        matchCase(wildcardPattern(), literal("small")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("small");
    });

    test("guard with destructured variables", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match ({ a: 1, b: 2 }) { case { a, b } when a < b: "a < b"; case _: "other"; }
      const expr = matchExpr(record({ a: literal(1), b: literal(2) }), [
        matchCase(
          destructurePattern([{ name: "a" }, { name: "b" }]),
          literal("a < b"),
          binary("<", id("a"), id("b"))
        ),
        matchCase(wildcardPattern(), literal("other")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("a < b");
    });

    test("multiple guards in sequence", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (0) { case n when n > 0: "pos"; case n when n < 0: "neg"; case _: "zero"; }
      const expr = matchExpr(literal(0), [
        matchCase(
          bindingPattern("n"),
          literal("pos"),
          binary(">", id("n"), literal(0))
        ),
        matchCase(
          bindingPattern("n"),
          literal("neg"),
          binary("<", id("n"), literal(0))
        ),
        matchCase(wildcardPattern(), literal("zero")),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("zero");
    });
  });

  describe("no match error", () => {
    test("throws when no pattern matches", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (42) { case 1: "one"; case 2: "two"; }
      const expr = matchExpr(literal(42), [
        matchCase(literalPattern(1), literal("one")),
        matchCase(literalPattern(2), literal("two")),
      ]);

      expect(() => evaluator.evaluate(expr, env, typeEnv)).toThrow(
        /No pattern matched/
      );
    });
  });

  describe("complex cases", () => {
    test("nested match expressions", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (1) { case 1: match (2) { case 2: "1,2"; case _: "1,?"; }; case _: "?,?"; }
      const inner = matchExpr(literal(2), [
        matchCase(literalPattern(2), literal("1,2")),
        matchCase(wildcardPattern(), literal("1,?")),
      ]);
      const outer = matchExpr(literal(1), [
        matchCase(literalPattern(1), inner),
        matchCase(wildcardPattern(), literal("?,?")),
      ]);

      expect(evaluator.evaluate(outer, env, typeEnv)).toBe("1,2");
    });

    test("match result used in expression", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // (match (5) { case n: n; }) * 2
      const matchResult = matchExpr(literal(5), [
        matchCase(bindingPattern("n"), id("n")),
      ]);
      const expr = binary("*", matchResult, literal(2));

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(10);
    });

    test("match with computation in body", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // match (3) { case n: n * n + 1; }
      const expr = matchExpr(literal(3), [
        matchCase(
          bindingPattern("n"),
          binary("+", binary("*", id("n"), id("n")), literal(1))
        ),
      ]);

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe(10);
    });
  });
});

describe("await expression evaluation", () => {
  test("await throws error at compile time", () => {
    const evaluator = new ComptimeEvaluator();
    const env = new ComptimeEnv();
    const typeEnv = new TypeEnv();

    // await x - should throw because await cannot be evaluated at compile time
    const awaitExpr = loc({ kind: "await" as const, expr: literal(42) });

    expect(() => evaluator.evaluate(awaitExpr, env, typeEnv)).toThrow(
      /Cannot use 'await' in compile-time evaluation/
    );
  });
});

// Helper to create template expressions
function template(...parts: CoreTemplatePart[]): CoreExpr {
  return loc({ kind: "template", parts });
}

function templateStr(value: string): CoreTemplatePart {
  return { kind: "string", value };
}

function templateExpr(expr: CoreExpr): CoreTemplatePart {
  return { kind: "expr", expr };
}

describe("template literal evaluation", () => {
  describe("plain templates", () => {
    test("evaluates plain template string", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `hello world`
      const expr = template(templateStr("hello world"));

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("hello world");
    });

    test("evaluates empty template", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // ``
      const expr = template();

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("");
    });

    test("evaluates template with only string parts", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `hello` + ` ` + `world` (multiple string parts)
      const expr = template(
        templateStr("hello"),
        templateStr(" "),
        templateStr("world")
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("hello world");
    });
  });

  describe("interpolation", () => {
    test("evaluates template with single interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();
      env.defineEvaluated("name", "Alice");

      // `Hello, ${name}!`
      const expr = template(
        templateStr("Hello, "),
        templateExpr(id("name")),
        templateStr("!")
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Hello, Alice!");
    });

    test("evaluates template with number interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `The answer is ${42}`
      const expr = template(
        templateStr("The answer is "),
        templateExpr(literal(42))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("The answer is 42");
    });

    test("evaluates template with multiple interpolations", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();
      env.defineEvaluated("a", 1);
      env.defineEvaluated("b", 2);

      // `${a} + ${b} = ${a + b}`
      const expr = template(
        templateExpr(id("a")),
        templateStr(" + "),
        templateExpr(id("b")),
        templateStr(" = "),
        templateExpr(binary("+", id("a"), id("b")))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("1 + 2 = 3");
    });

    test("evaluates template with boolean interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `Flag is ${true}`
      const expr = template(
        templateStr("Flag is "),
        templateExpr(literal(true))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Flag is true");
    });

    test("evaluates template with null interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `Value: ${null}`
      const expr = template(
        templateStr("Value: "),
        templateExpr(literal(null))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Value: null");
    });

    test("evaluates template with undefined interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `Value: ${undefined}`
      const expr = template(
        templateStr("Value: "),
        templateExpr(literal(undefined))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Value: undefined");
    });
  });

  describe("expression interpolation", () => {
    test("evaluates template with arithmetic expression", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `Double: ${5 * 2}`
      const expr = template(
        templateStr("Double: "),
        templateExpr(binary("*", literal(5), literal(2)))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Double: 10");
    });

    test("evaluates template with comparison expression", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `Is greater: ${5 > 3}`
      const expr = template(
        templateStr("Is greater: "),
        templateExpr(binary(">", literal(5), literal(3)))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Is greater: true");
    });

    test("evaluates template with property access", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();
      env.defineEvaluated("person", { name: "Bob", age: 30 });

      // `${person.name} is ${person.age} years old`
      const expr = template(
        templateExpr(prop(id("person"), "name")),
        templateStr(" is "),
        templateExpr(prop(id("person"), "age")),
        templateStr(" years old")
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Bob is 30 years old");
    });

    test("evaluates template with array access", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();
      env.defineEvaluated("items", ["a", "b", "c"]);

      // `First: ${items[0]}, Last: ${items[2]}`
      const indexExpr = (arr: CoreExpr, idx: number): CoreExpr =>
        loc({ kind: "index", object: arr, index: literal(idx) });

      const expr = template(
        templateStr("First: "),
        templateExpr(indexExpr(id("items"), 0)),
        templateStr(", Last: "),
        templateExpr(indexExpr(id("items"), 2))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("First: a, Last: c");
    });

    test("evaluates template with function call", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // Define a double function
      const doubleFn = lambda(["x"], binary("*", id("x"), literal(2)));
      env.defineEvaluated("double", evaluator.evaluate(doubleFn, env, typeEnv));

      // `Result: ${double(5)}`
      const expr = template(
        templateStr("Result: "),
        templateExpr(call(id("double"), [literal(5)]))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Result: 10");
    });
  });

  describe("nested templates", () => {
    test("evaluates nested template in interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();
      env.defineEvaluated("inner", "world");

      // `Hello, ${`dear ${inner}`}!`
      const innerTemplate = template(
        templateStr("dear "),
        templateExpr(id("inner"))
      );

      const expr = template(
        templateStr("Hello, "),
        templateExpr(innerTemplate),
        templateStr("!")
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Hello, dear world!");
    });
  });

  describe("edge cases", () => {
    test("evaluates template starting with interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `${42} is the answer`
      const expr = template(
        templateExpr(literal(42)),
        templateStr(" is the answer")
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("42 is the answer");
    });

    test("evaluates template ending with interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `The answer is ${42}`
      const expr = template(
        templateStr("The answer is "),
        templateExpr(literal(42))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("The answer is 42");
    });

    test("evaluates template with only interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `${42}`
      const expr = template(templateExpr(literal(42)));

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("42");
    });

    test("evaluates template with consecutive interpolations", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `${1}${2}${3}`
      const expr = template(
        templateExpr(literal(1)),
        templateExpr(literal(2)),
        templateExpr(literal(3))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("123");
    });

    test("evaluates template with float interpolation", () => {
      const evaluator = new ComptimeEvaluator();
      const env = new ComptimeEnv();
      const typeEnv = new TypeEnv();

      // `Pi is approximately ${3.14159}`
      const expr = template(
        templateStr("Pi is approximately "),
        templateExpr(literal(3.14159))
      );

      expect(evaluator.evaluate(expr, env, typeEnv)).toBe("Pi is approximately 3.14159");
    });
  });
});
