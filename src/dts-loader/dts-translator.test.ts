import { describe, it, expect } from "vitest";
import { loadDTS } from "./dts-translator";
import { CoreDecl, CoreExpr } from "../ast/core-ast";

// ============================================
// Test Helper Functions
// ============================================

/**
 * Find a const declaration by name in a list of CoreDecls.
 */
function findDecl(decls: CoreDecl[], name: string): CoreDecl & { kind: "const" } {
  const decl = decls.find(d => d.kind === "const" && d.name === name);
  if (!decl || decl.kind !== "const") {
    throw new Error(`Declaration '${name}' not found. Available: ${decls.filter(d => d.kind === "const").map(d => (d as any).name).join(", ")}`);
  }
  return decl as CoreDecl & { kind: "const" };
}

/**
 * Find an import declaration by source in a list of CoreDecls.
 */
function findImport(decls: CoreDecl[], source: string): CoreDecl & { kind: "import" } {
  const decl = decls.find(d => d.kind === "import" && d.source === source);
  if (!decl || decl.kind !== "import") {
    throw new Error(`Import from '${source}' not found.`);
  }
  return decl as CoreDecl & { kind: "import" };
}

/**
 * Check that a declaration has a specific init expression kind.
 */
function getInit(decl: { init: CoreExpr }): CoreExpr {
  return decl.init;
}

/**
 * Assert the init is a call and return its fn and args.
 */
function expectCall(expr: CoreExpr): { fn: CoreExpr; args: CoreExpr[] } {
  expect(expr.kind).toBe("call");
  if (expr.kind !== "call") throw new Error("Expected call");
  return {
    fn: expr.fn,
    args: expr.args.map(a => a.kind === "element" ? a.value : (a as any).expr),
  };
}

/**
 * Assert the expr is an identifier and return its name.
 */
function expectId(expr: CoreExpr): string {
  expect(expr.kind).toBe("identifier");
  if (expr.kind !== "identifier") throw new Error("Expected identifier");
  return expr.name;
}

/**
 * Assert the expr is a literal and return its value.
 */
function expectLiteral(expr: CoreExpr): { value: any; literalKind: string } {
  expect(expr.kind).toBe("literal");
  if (expr.kind !== "literal") throw new Error("Expected literal");
  return { value: expr.value, literalKind: expr.literalKind };
}

/**
 * Assert the expr is a lambda and return its params, body, and returnType.
 */
function expectLambda(expr: CoreExpr): { params: any[]; body: CoreExpr; returnType?: CoreExpr } {
  expect(expr.kind).toBe("lambda");
  if (expr.kind !== "lambda") throw new Error("Expected lambda");
  return { params: expr.params, body: expr.body, returnType: expr.returnType };
}

/**
 * Assert the expr is a record and return its fields.
 */
function expectRecord(expr: CoreExpr): { name: string; value: CoreExpr }[] {
  expect(expr.kind).toBe("record");
  if (expr.kind !== "record") throw new Error("Expected record");
  return expr.fields
    .filter(f => f.kind === "field")
    .map(f => ({ name: (f as any).name, value: (f as any).value }));
}

/**
 * Assert the expr is an array and return its elements.
 */
function expectArray(expr: CoreExpr): CoreExpr[] {
  expect(expr.kind).toBe("array");
  if (expr.kind !== "array") throw new Error("Expected array");
  return expr.elements.map(e => e.kind === "element" ? e.value : (e as any).expr);
}

/**
 * Assert the expr is a throw.
 */
function expectThrow(expr: CoreExpr): void {
  expect(expr.kind).toBe("throw");
}

/**
 * Assert the expr is a property access and return object and name.
 */
function expectProperty(expr: CoreExpr): { object: CoreExpr; name: string } {
  expect(expr.kind).toBe("property");
  if (expr.kind !== "property") throw new Error("Expected property");
  return { object: expr.object, name: expr.name };
}

/**
 * For a WithMetadata call, return {body, metadata}.
 * Expects: call(WithMetadata, [body, metadata])
 */
function unwrapWithMetadata(expr: CoreExpr): { body: CoreExpr; metadata: CoreExpr } {
  const call = expectCall(expr);
  expectId(call.fn);
  expect((call.fn as any).name).toBe("WithMetadata");
  expect(call.args.length).toBe(2);
  return { body: call.args[0], metadata: call.args[1] };
}

/**
 * Get field info records from a RecordType call's array argument.
 * Expects: call(RecordType, [array([fieldInfo, fieldInfo, ...])])
 */
function getFieldInfos(recordTypeCall: CoreExpr): { name: string; type: CoreExpr; optional: boolean }[] {
  const call = expectCall(recordTypeCall);
  expect(expectId(call.fn)).toBe("RecordType");
  const elements = expectArray(call.args[0]);
  return elements.map(el => {
    const fields = expectRecord(el);
    const nameField = fields.find(f => f.name === "name");
    const typeField = fields.find(f => f.name === "type");
    const optionalField = fields.find(f => f.name === "optional");
    return {
      name: nameField ? expectLiteral(nameField.value).value : "",
      type: typeField!.value,
      optional: optionalField ? expectLiteral(optionalField.value).value : false,
    };
  });
}

/**
 * Get metadata name from a metadata record expression.
 */
function getMetadataName(metadataExpr: CoreExpr): string {
  const fields = expectRecord(metadataExpr);
  const nameField = fields.find(f => f.name === "name");
  if (!nameField) throw new Error("No 'name' field in metadata");
  return expectLiteral(nameField.value).value;
}

/**
 * Get metadata typeArgs from a metadata record expression.
 */
function getMetadataTypeArgs(metadataExpr: CoreExpr): CoreExpr[] {
  const fields = expectRecord(metadataExpr);
  const typeArgsField = fields.find(f => f.name === "typeArgs");
  if (!typeArgsField) return [];
  return expectArray(typeArgsField.value);
}

// ============================================
// Tests
// ============================================

describe("DTS Translator", () => {
  describe("primitive type aliases", () => {
    it("translates primitive type aliases", () => {
      const result = loadDTS(`
type MyString = string;
type MyNumber = number;
type MyBool = boolean;
`);

      expect(result.errors).toEqual([]);

      const myString = findDecl(result.decls, "MyString");
      expect(myString.comptime).toBe(true);
      const strWm = unwrapWithMetadata(getInit(myString));
      expect(getMetadataName(strWm.metadata)).toBe("MyString");
      expect(expectId(strWm.body)).toBe("String");

      const myNumber = findDecl(result.decls, "MyNumber");
      const numWm = unwrapWithMetadata(getInit(myNumber));
      expect(expectId(numWm.body)).toBe("Number");

      const myBool = findDecl(result.decls, "MyBool");
      const boolWm = unwrapWithMetadata(getInit(myBool));
      expect(expectId(boolWm.body)).toBe("Boolean");
    });

    it("translates void and never type aliases", () => {
      const result = loadDTS(`
type Nothing = void;
type Bottom = never;
`);

      expect(result.errors).toEqual([]);

      const nothing = findDecl(result.decls, "Nothing");
      const nothingWm = unwrapWithMetadata(getInit(nothing));
      expect(expectId(nothingWm.body)).toBe("Void");

      const bottom = findDecl(result.decls, "Bottom");
      const bottomWm = unwrapWithMetadata(getInit(bottom));
      expect(expectId(bottomWm.body)).toBe("Never");
    });
  });

  describe("union types", () => {
    it("translates union types", () => {
      const result = loadDTS(`type StringOrNumber = string | number;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "StringOrNumber");
      const wm = unwrapWithMetadata(getInit(decl));

      // Union(String, Number)
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Union");
      expect(call.args.length).toBe(2);
      expect(expectId(call.args[0])).toBe("String");
      expect(expectId(call.args[1])).toBe("Number");
    });

    it("translates multi-member union types", () => {
      const result = loadDTS(`type Multi = string | number | boolean;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Multi");
      const wm = unwrapWithMetadata(getInit(decl));

      // Union(Union(String, Number), Boolean)
      const outerCall = expectCall(wm.body);
      expect(expectId(outerCall.fn)).toBe("Union");
      expect(outerCall.args.length).toBe(2);

      const innerCall = expectCall(outerCall.args[0]);
      expect(expectId(innerCall.fn)).toBe("Union");
      expect(expectId(innerCall.args[0])).toBe("String");
      expect(expectId(innerCall.args[1])).toBe("Number");

      expect(expectId(outerCall.args[1])).toBe("Boolean");
    });
  });

  describe("intersection types", () => {
    it("translates intersection types", () => {
      const result = loadDTS(`type Combined = { a: string } & { b: number };`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Combined");
      const wm = unwrapWithMetadata(getInit(decl));

      // Intersection(RecordType(...), RecordType(...))
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Intersection");
      expect(call.args.length).toBe(2);

      // Both args should be RecordType calls
      const leftCall = expectCall(call.args[0]);
      expect(expectId(leftCall.fn)).toBe("RecordType");
      const rightCall = expectCall(call.args[1]);
      expect(expectId(rightCall.fn)).toBe("RecordType");
    });
  });

  describe("interfaces", () => {
    it("translates interfaces to RecordType wrapped in WithMetadata", () => {
      const result = loadDTS(`
interface Person {
  name: string;
  age: number;
  email?: string;
}
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Person");
      expect(decl.comptime).toBe(true);

      const wm = unwrapWithMetadata(getInit(decl));
      expect(getMetadataName(wm.metadata)).toBe("Person");

      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(3);
      expect(fields[0].name).toBe("name");
      expect(expectId(fields[0].type)).toBe("String");
      expect(fields[0].optional).toBe(false);

      expect(fields[1].name).toBe("age");
      expect(expectId(fields[1].type)).toBe("Number");

      expect(fields[2].name).toBe("email");
      expect(expectId(fields[2].type)).toBe("String");
      expect(fields[2].optional).toBe(true);
    });

    it("translates generic interface", () => {
      const result = loadDTS(`
interface Box<T> {
  contents: T;
  isEmpty: boolean;
}
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Box");

      // Generic interface becomes a lambda: (T: Type) => WithMetadata(RecordType(...), {name: "Box", typeArgs: [T]})
      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("T");

      const wm = unwrapWithMetadata(lambda.body);
      expect(getMetadataName(wm.metadata)).toBe("Box");
      expect(getMetadataTypeArgs(wm.metadata).length).toBe(1);
      expect(expectId(getMetadataTypeArgs(wm.metadata)[0])).toBe("T");

      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(2);
      expect(fields[0].name).toBe("contents");
      expect(expectId(fields[0].type)).toBe("T");
      expect(fields[1].name).toBe("isEmpty");
      expect(expectId(fields[1].type)).toBe("Boolean");
    });

    it("translates nested record types", () => {
      const result = loadDTS(`
type Nested = {
  outer: {
    inner: string;
  };
};
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Nested");
      const wm = unwrapWithMetadata(getInit(decl));

      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("outer");

      // The nested type is a RecordType call
      const nestedCall = expectCall(fields[0].type);
      expect(expectId(nestedCall.fn)).toBe("RecordType");
    });
  });

  describe("function types", () => {
    it("translates function type alias", () => {
      const result = loadDTS(`type Callback = (x: number, y: string) => boolean;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Callback");
      const wm = unwrapWithMetadata(getInit(decl));

      // FunctionType([paramInfos...], Boolean)
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("FunctionType");
      expect(call.args.length).toBe(2);

      // Check params array
      const params = expectArray(call.args[0]);
      expect(params.length).toBe(2);

      // Check first param's name
      const param0Fields = expectRecord(params[0]);
      const p0Name = param0Fields.find(f => f.name === "name");
      expect(p0Name && expectLiteral(p0Name.value).value).toBe("x");

      // Check return type
      expect(expectId(call.args[1])).toBe("Boolean");
    });
  });

  describe("declare function", () => {
    it("translates non-generic declare function as lambda with throw body", () => {
      const result = loadDTS(`declare function greet(name: string): string;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "greet");

      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("name");
      expect(expectId(lambda.params[0].type)).toBe("String");
      expectThrow(lambda.body);
      expect(lambda.returnType).toBeDefined();
      expect(expectId(lambda.returnType!)).toBe("String");
    });

    it("translates generic declare function with type params and wideTypeOf defaults", () => {
      const result = loadDTS(`declare function identity<T>(x: T): T;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "identity");

      const lambda = expectLambda(getInit(decl));
      // Should have value param "x" + type param "T"
      expect(lambda.params.length).toBe(2);
      expect(lambda.params[0].name).toBe("x");
      expect(expectId(lambda.params[0].type)).toBe("T");

      // Type param T with Type annotation and wideTypeOf default
      expect(lambda.params[1].name).toBe("T");
      expect(expectId(lambda.params[1].type)).toBe("Type");
      expect(lambda.params[1].defaultValue).toBeDefined();
      const defaultCall = expectCall(lambda.params[1].defaultValue!);
      expect(expectId(defaultCall.fn)).toBe("wideTypeOf");
      expect(expectId(defaultCall.args[0])).toBe("x");

      // Return type is T
      expect(expectId(lambda.returnType!)).toBe("T");
      expectThrow(lambda.body);
    });

    it("translates generic function with multiple type params", () => {
      const result = loadDTS(`declare function pair<A, B>(a: A, b: B): [A, B];`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "pair");

      const lambda = expectLambda(getInit(decl));
      // Value params a, b + type params A, B = 4 params total
      expect(lambda.params.length).toBe(4);
      expect(lambda.params[0].name).toBe("a");
      expect(lambda.params[1].name).toBe("b");
      expect(lambda.params[2].name).toBe("A");
      expect(lambda.params[3].name).toBe("B");

      // A's default should be wideTypeOf(a)
      const aDefault = expectCall(lambda.params[2].defaultValue!);
      expect(expectId(aDefault.fn)).toBe("wideTypeOf");
      expect(expectId(aDefault.args[0])).toBe("a");

      // B's default should be wideTypeOf(b)
      const bDefault = expectCall(lambda.params[3].defaultValue!);
      expect(expectId(bDefault.fn)).toBe("wideTypeOf");
      expect(expectId(bDefault.args[0])).toBe("b");
    });

    it("translates declare function with rest parameter", () => {
      const result = loadDTS(`
declare function createElement(
  type: string,
  props: any,
  ...children: any[]
): ReactElement;
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "createElement");

      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(3);
      expect(lambda.params[0].name).toBe("type");
      expect(lambda.params[1].name).toBe("props");
      expect(lambda.params[2].name).toBe("children");
      expect(lambda.params[2].rest).toBe(true);
    });

    it("translates function declaration (inside namespace body style)", () => {
      const result = loadDTS(`
export function greet(name: string): string;
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "greet");
      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("name");
    });
  });

  describe("array types", () => {
    it("translates array type (T[])", () => {
      const result = loadDTS(`type Numbers = number[];`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Numbers");
      const wm = unwrapWithMetadata(getInit(decl));

      // Array(Number)
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Array");
      expect(call.args.length).toBe(1);
      expect(expectId(call.args[0])).toBe("Number");
    });

    it("translates parameterized Array<T>", () => {
      const result = loadDTS(`type Numbers = Array<number>;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Numbers");
      const wm = unwrapWithMetadata(getInit(decl));

      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Array");
      expect(call.args.length).toBe(1);
      expect(expectId(call.args[0])).toBe("Number");
    });
  });

  describe("tuple types", () => {
    it("translates tuple types", () => {
      const result = loadDTS(`type Point = [number, number];`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Point");
      const wm = unwrapWithMetadata(getInit(decl));

      // Array(Number, Number)
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Array");
      expect(call.args.length).toBe(2);
      expect(expectId(call.args[0])).toBe("Number");
      expect(expectId(call.args[1])).toBe("Number");
    });

    it("translates heterogeneous tuple types", () => {
      const result = loadDTS(`type Pair = [string, number];`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Pair");
      const wm = unwrapWithMetadata(getInit(decl));

      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Array");
      expect(call.args.length).toBe(2);
      expect(expectId(call.args[0])).toBe("String");
      expect(expectId(call.args[1])).toBe("Number");
    });
  });

  describe("literal types", () => {
    it("translates boolean literal types", () => {
      const result = loadDTS(`
type Yes = true;
type No = false;
`);

      expect(result.errors).toHaveLength(0);

      const yes = findDecl(result.decls, "Yes");
      const yesWm = unwrapWithMetadata(getInit(yes));
      // LiteralType(true)
      const yesCall = expectCall(yesWm.body);
      expect(expectId(yesCall.fn)).toBe("LiteralType");
      expect(expectLiteral(yesCall.args[0]).value).toBe(true);

      const no = findDecl(result.decls, "No");
      const noWm = unwrapWithMetadata(getInit(no));
      const noCall = expectCall(noWm.body);
      expect(expectId(noCall.fn)).toBe("LiteralType");
      expect(expectLiteral(noCall.args[0]).value).toBe(false);
    });

    it("translates string literal types", () => {
      const result = loadDTS(`type Hello = "hello";`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Hello");
      const wm = unwrapWithMetadata(getInit(decl));
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("LiteralType");
      expect(expectLiteral(call.args[0]).value).toBe("hello");
    });

    it("translates numeric literal types", () => {
      const result = loadDTS(`type One = 1;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "One");
      const wm = unwrapWithMetadata(getInit(decl));
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("LiteralType");
      expect(expectLiteral(call.args[0]).value).toBe(1);
    });
  });

  describe("generic type aliases", () => {
    it("translates generic type alias as lambda returning WithMetadata", () => {
      const result = loadDTS(`type Container<T> = { value: T };`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Container");
      expect(decl.comptime).toBe(true);

      // Should be a lambda: (T: Type) => WithMetadata(RecordType([...]), {name: "Container", typeArgs: [T]})
      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("T");
      expect(expectId(lambda.params[0].type)).toBe("Type");

      const wm = unwrapWithMetadata(lambda.body);
      expect(getMetadataName(wm.metadata)).toBe("Container");
      const typeArgs = getMetadataTypeArgs(wm.metadata);
      expect(typeArgs.length).toBe(1);
      expect(expectId(typeArgs[0])).toBe("T");

      // Body is RecordType([{name: "value", type: T, ...}])
      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("value");
      expect(expectId(fields[0].type)).toBe("T");
    });

    it("translates multi-parameter generic type alias", () => {
      const result = loadDTS(`type Pair<A, B> = { first: A; second: B };`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Pair");

      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(2);
      expect(lambda.params[0].name).toBe("A");
      expect(lambda.params[1].name).toBe("B");

      const wm = unwrapWithMetadata(lambda.body);
      const typeArgs = getMetadataTypeArgs(wm.metadata);
      expect(typeArgs.length).toBe(2);
      expect(expectId(typeArgs[0])).toBe("A");
      expect(expectId(typeArgs[1])).toBe("B");

      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(2);
      expect(fields[0].name).toBe("first");
      expect(expectId(fields[0].type)).toBe("A");
      expect(fields[1].name).toBe("second");
      expect(expectId(fields[1].type)).toBe("B");
    });

    it("translates generic type alias with function body", () => {
      const result = loadDTS(`type Callback<T, R> = (value: T) => R;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Callback");

      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(2);
      expect(lambda.params[0].name).toBe("T");
      expect(lambda.params[1].name).toBe("R");

      const wm = unwrapWithMetadata(lambda.body);
      // Body should be FunctionType(...)
      const ftCall = expectCall(wm.body);
      expect(expectId(ftCall.fn)).toBe("FunctionType");
    });

    it("translates generic union type alias", () => {
      const result = loadDTS(`type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Result");

      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(2);

      const wm = unwrapWithMetadata(lambda.body);
      // Body should be Union(RecordType(...), RecordType(...))
      const unionCall = expectCall(wm.body);
      expect(expectId(unionCall.fn)).toBe("Union");
      expect(unionCall.args.length).toBe(2);
    });
  });

  describe("classes", () => {
    it("translates declare class as comptime const with RecordType", () => {
      const result = loadDTS(`
declare class Component<P, S> {
  props: P;
  state: S;
  setState(state: Partial<S>): void;
  render(): ReactNode;
}
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Component");
      expect(decl.comptime).toBe(true);

      // Instance type wrapped in WithMetadata
      const wm = unwrapWithMetadata(getInit(decl));
      expect(getMetadataName(wm.metadata)).toBe("Component");

      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(4);
      expect(fields.map(f => f.name)).toEqual(["props", "state", "setState", "render"]);
    });

    it("translates class with constructor (constructor excluded from instance fields)", () => {
      const result = loadDTS(`
declare class Point {
  x: number;
  y: number;
  constructor(x: number, y: number);
  distance(): number;
}
`);

      expect(result.errors).toHaveLength(0);

      const decl = findDecl(result.decls, "Point");
      const wm = unwrapWithMetadata(getInit(decl));

      // Instance type fields should NOT include constructor
      const fields = getFieldInfos(wm.body);
      expect(fields.map(f => f.name)).toEqual(["x", "y", "distance"]);
    });

    it("translates class without constructor", () => {
      const result = loadDTS(`
declare class Empty {
  value: string;
}
`);

      expect(result.errors).toHaveLength(0);

      const decl = findDecl(result.decls, "Empty");
      const wm = unwrapWithMetadata(getInit(decl));
      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(1);
      expect(fields[0].name).toBe("value");
    });
  });

  describe("namespaces", () => {
    it("produces no top-level decls for pure declare namespace (without export =)", () => {
      const result = loadDTS(`
declare namespace React {
  type ReactNode = string | number | null;
  interface Component<P> {
    props: P;
  }
}
`);

      expect(result.errors).toHaveLength(0);
      // Without export = React, namespace members are not promoted
      const constDecls = result.decls.filter(d => d.kind === "const");
      expect(constDecls.length).toBe(0);
    });

    it("promotes namespace members to top-level with export = pattern", () => {
      const result = loadDTS(`
declare namespace NS {
  type Foo = string;
  function bar(): void;
}
export = NS;
`);

      expect(result.errors).toHaveLength(0);
      // Namespace members should be promoted as top-level decls
      const fooDecl = findDecl(result.decls, "Foo");
      expect(fooDecl.comptime).toBe(true);
      const wm = unwrapWithMetadata(getInit(fooDecl));
      expect(expectId(wm.body)).toBe("String");

      const barDecl = findDecl(result.decls, "bar");
      const lambda = expectLambda(getInit(barDecl));
      expectThrow(lambda.body);
    });
  });

  describe("variable declarations", () => {
    it("translates declare const with type annotation", () => {
      const result = loadDTS(`declare const VERSION: string;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "VERSION");
      // Init should be a throw (no runtime value)
      expectThrow(getInit(decl));
      // Type annotation should be present
      expect(decl.type).toBeDefined();
      expect(expectId(decl.type!)).toBe("String");
    });

    it("translates declare const with object type", () => {
      const result = loadDTS(`declare const config: { host: string; port: number };`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "config");
      expectThrow(getInit(decl));
      expect(decl.type).toBeDefined();
      // Type annotation should be RecordType(...)
      const call = expectCall(decl.type!);
      expect(expectId(call.fn)).toBe("RecordType");
    });
  });

  describe("export declarations", () => {
    it("handles export type alias", () => {
      const result = loadDTS(`export type MyString = string;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "MyString");
      const wm = unwrapWithMetadata(getInit(decl));
      expect(expectId(wm.body)).toBe("String");
    });

    it("handles export interface", () => {
      const result = loadDTS(`
export interface User {
  name: string;
  age: number;
}
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "User");
      const wm = unwrapWithMetadata(getInit(decl));
      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(2);
      expect(fields[0].name).toBe("name");
      expect(fields[1].name).toBe("age");
    });

    it("handles export function", () => {
      const result = loadDTS(`export function greet(name: string): string;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "greet");
      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("name");
    });

    it("handles export declare const", () => {
      const result = loadDTS(`export declare const VERSION: string;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "VERSION");
      expectThrow(getInit(decl));
      expect(decl.type).toBeDefined();
      expect(expectId(decl.type!)).toBe("String");
    });

    it("handles export declare function", () => {
      const result = loadDTS(`export declare function calculate(x: number): number;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "calculate");
      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
    });

    it("handles export declare class", () => {
      const result = loadDTS(`
export declare class Point {
  x: number;
  y: number;
}
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Point");
      const wm = unwrapWithMetadata(getInit(decl));
      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(2);
      expect(fields.map(f => f.name)).toEqual(["x", "y"]);
    });

    it("handles export declare namespace with export = pattern", () => {
      const result = loadDTS(`
export declare namespace Utils {
  function helper(): void;
  type Config = { debug: boolean };
}
export = Utils;
`);

      expect(result.errors).toHaveLength(0);
      // With export = Utils, members are promoted
      const helperDecl = findDecl(result.decls, "helper");
      const lambda = expectLambda(getInit(helperDecl));
      expectThrow(lambda.body);

      const configDecl = findDecl(result.decls, "Config");
      expect(configDecl.comptime).toBe(true);
    });

    it("ignores re-exports (export { } from and export * from)", () => {
      const result = loadDTS(`
export { something } from "other-module";
export * from "another-module";
`);

      // Should not error, re-exports produce import decls
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("imports", () => {
    it("translates namespace import", () => {
      const result = loadDTS(`import * as React from "react";`);

      expect(result.errors).toHaveLength(0);
      const importDecl = findImport(result.decls, "react");
      expect(importDecl.clause.kind).toBe("namespace");
      if (importDecl.clause.kind === "namespace") {
        expect(importDecl.clause.name).toBe("React");
      }
    });

    it("translates named imports", () => {
      const result = loadDTS(`import { useState, useEffect } from "react";`);

      expect(result.errors).toHaveLength(0);
      const importDecl = findImport(result.decls, "react");
      expect(importDecl.clause.kind).toBe("named");
      if (importDecl.clause.kind === "named") {
        expect(importDecl.clause.specifiers.length).toBe(2);
        expect(importDecl.clause.specifiers[0].name).toBe("useState");
        expect(importDecl.clause.specifiers[1].name).toBe("useEffect");
      }
    });

    it("translates named import with rename", () => {
      const result = loadDTS(`import { OriginalName as LocalName } from "module";`);

      expect(result.errors).toHaveLength(0);
      const importDecl = findImport(result.decls, "module");
      expect(importDecl.clause.kind).toBe("named");
      if (importDecl.clause.kind === "named") {
        expect(importDecl.clause.specifiers[0].name).toBe("OriginalName");
        expect(importDecl.clause.specifiers[0].alias).toBe("LocalName");
      }
    });

    it("translates default import", () => {
      const result = loadDTS(`import lib from "some-lib";`);

      expect(result.errors).toHaveLength(0);
      const importDecl = findImport(result.decls, "some-lib");
      expect(importDecl.clause.kind).toBe("default");
      if (importDecl.clause.kind === "default") {
        expect(importDecl.clause.name).toBe("lib");
      }
    });

    it("translates import type syntax as regular import", () => {
      const result = loadDTS(`import type { TypeOnly } from "module";`);

      expect(result.errors).toHaveLength(0);
      const importDecl = findImport(result.decls, "module");
      expect(importDecl.clause.kind).toBe("named");
      if (importDecl.clause.kind === "named") {
        expect(importDecl.clause.specifiers[0].name).toBe("TypeOnly");
      }
    });
  });

  describe("parameterized type references", () => {
    it("translates parameterized type as function call", () => {
      const result = loadDTS(`
type Container<T> = { value: T };
type StringContainer = Container<string>;
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "StringContainer");
      const wm = unwrapWithMetadata(getInit(decl));

      // Container(String) — parameterized type becomes a call
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Container");
      expect(call.args.length).toBe(1);
      expect(expectId(call.args[0])).toBe("String");
    });

    it("translates multi-arg parameterized type", () => {
      const result = loadDTS(`
type Pair<A, B> = { first: A; second: B };
type StringNumberPair = Pair<string, number>;
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "StringNumberPair");
      const wm = unwrapWithMetadata(getInit(decl));

      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("Pair");
      expect(call.args.length).toBe(2);
      expect(expectId(call.args[0])).toBe("String");
      expect(expectId(call.args[1])).toBe("Number");
    });
  });

  describe("typeof type operator", () => {
    it("translates typeof for a declared const", () => {
      const result = loadDTS(`
declare const foo: string;
type FooType = typeof foo;
`);
      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "FooType");
      const wm = unwrapWithMetadata(getInit(decl));

      // typeOf(foo)
      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("typeOf");
      expect(expectId(call.args[0])).toBe("foo");
    });

    it("translates typeof for a declared function", () => {
      const result = loadDTS(`
declare function greet(name: string): string;
type GreetFn = typeof greet;
`);
      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "GreetFn");
      const wm = unwrapWithMetadata(getInit(decl));

      const call = expectCall(wm.body);
      expect(expectId(call.fn)).toBe("typeOf");
      expect(expectId(call.args[0])).toBe("greet");
    });

    it("translates typeof for member expression", () => {
      const result = loadDTS(`
declare const x: string;
type MaybeX = typeof x | null;
`);
      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "MaybeX");
      const wm = unwrapWithMetadata(getInit(decl));

      // Union(typeOf(x), Null)
      const unionCall = expectCall(wm.body);
      expect(expectId(unionCall.fn)).toBe("Union");
      expect(unionCall.args.length).toBe(2);

      const typeOfCall = expectCall(unionCall.args[0]);
      expect(expectId(typeOfCall.fn)).toBe("typeOf");
    });
  });

  describe("indexed types (dot access)", () => {
    it("translates Ns.Member as property access", () => {
      const result = loadDTS(`
declare namespace React {
  type ElementType = string;
}
type X = React.ElementType;
`);

      expect(result.errors).toHaveLength(0);
      // The namespace itself produces no decls, but X should reference React.ElementType
      // as a property access
      const decl = findDecl(result.decls, "X");
      const wm = unwrapWithMetadata(getInit(decl));

      const prop = expectProperty(wm.body);
      expect(expectId(prop.object)).toBe("React");
      expect(prop.name).toBe("ElementType");
    });

    it("degrades bracket access with literal type index to Unknown", () => {
      const result = loadDTS(`
type PersonName = { name: string; age: number }["name"];
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "PersonName");
      const wm = unwrapWithMetadata(getInit(decl));

      // The index "name" is parsed as LiteralType("name") — a call, not a raw literal —
      // so the translator falls through to the general case and produces Unknown.
      expect(expectId(wm.body)).toBe("Unknown");
    });
  });

  describe("conditional types", () => {
    it("degrades conditional types to Unknown", () => {
      const result = loadDTS(`type IsString<T> = T extends string ? true : false;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "IsString");

      // Generic type, so it's a lambda
      const lambda = expectLambda(getInit(decl));
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("T");

      // Body is WithMetadata(Unknown, ...)  since conditional types degrade to Unknown
      const wm = unwrapWithMetadata(lambda.body);
      expect(expectId(wm.body)).toBe("Unknown");
    });
  });

  describe("keyof types", () => {
    it("degrades keyof to Unknown", () => {
      const result = loadDTS(`type Keys<T> = keyof T;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Keys");

      const lambda = expectLambda(getInit(decl));
      const wm = unwrapWithMetadata(lambda.body);
      // keyof degrades to Unknown in current translator
      expect(expectId(wm.body)).toBe("Unknown");
    });
  });

  describe("overloaded functions", () => {
    it("only emits the first overload", () => {
      const result = loadDTS(`
declare function parse(input: string): number;
declare function parse(input: number): string;
`);

      expect(result.errors).toHaveLength(0);
      // Should only have one decl named "parse"
      const parseDecls = result.decls.filter(d => d.kind === "const" && d.name === "parse");
      expect(parseDecls.length).toBe(1);

      const decl = findDecl(result.decls, "parse");
      const lambda = expectLambda(getInit(decl));
      // First overload: (input: string): number
      expect(lambda.params.length).toBe(1);
      expect(lambda.params[0].name).toBe("input");
      expect(expectId(lambda.params[0].type)).toBe("String");
      expect(expectId(lambda.returnType!)).toBe("Number");
    });
  });

  describe("null type", () => {
    it("translates null type", () => {
      const result = loadDTS(`type N = null;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "N");
      const wm = unwrapWithMetadata(getInit(decl));
      expect(expectId(wm.body)).toBe("Null");
    });
  });

  describe("void type", () => {
    it("translates void type", () => {
      const result = loadDTS(`type V = void;`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "V");
      const wm = unwrapWithMetadata(getInit(decl));
      expect(expectId(wm.body)).toBe("Void");
    });
  });

  describe("any and unknown types", () => {
    it("translates any and unknown to Unknown", () => {
      const result = loadDTS(`
type A = any;
type U = unknown;
`);

      expect(result.errors).toHaveLength(0);
      const aDecl = findDecl(result.decls, "A");
      const aWm = unwrapWithMetadata(getInit(aDecl));
      expect(expectId(aWm.body)).toBe("Unknown");

      const uDecl = findDecl(result.decls, "U");
      const uWm = unwrapWithMetadata(getInit(uDecl));
      expect(expectId(uWm.body)).toBe("Unknown");
    });
  });

  describe("parenthesized types", () => {
    it("unwraps parenthesized types", () => {
      const result = loadDTS(`type P = (string);`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "P");
      const wm = unwrapWithMetadata(getInit(decl));
      expect(expectId(wm.body)).toBe("String");
    });
  });

  describe("integration: complex type patterns", () => {
    it("translates type with union of record and literal types", () => {
      const result = loadDTS(`
type Response = { status: "ok"; data: string } | { status: "error"; message: string };
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Response");
      const wm = unwrapWithMetadata(getInit(decl));

      const unionCall = expectCall(wm.body);
      expect(expectId(unionCall.fn)).toBe("Union");
      expect(unionCall.args.length).toBe(2);

      // Both args should be RecordType calls
      const leftCall = expectCall(unionCall.args[0]);
      expect(expectId(leftCall.fn)).toBe("RecordType");
      const rightCall = expectCall(unionCall.args[1]);
      expect(expectId(rightCall.fn)).toBe("RecordType");
    });

    it("translates namespace with export = promoting multiple member types", () => {
      const result = loadDTS(`
declare namespace NS {
  type SetStateAction<S> = S | ((prevState: S) => S);
  type Dispatch<A> = (value: A) => void;
  function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
}
export = NS;
`);

      expect(result.errors).toHaveLength(0);

      // All three members should be promoted
      const setStateAction = findDecl(result.decls, "SetStateAction");
      expect(setStateAction.comptime).toBe(true);

      const dispatch = findDecl(result.decls, "Dispatch");
      expect(dispatch.comptime).toBe(true);

      const useState = findDecl(result.decls, "useState");
      const lambda = expectLambda(getInit(useState));
      // Should have value param + type param S
      const sParam = lambda.params.find((p: any) => p.name === "S");
      expect(sParam).toBeDefined();
    });

    it("handles method declarations in interfaces as FunctionType fields", () => {
      // Methods in interfaces are NOT supported in ObjectType — only PropertyType
      // But we can test a class with methods
      const result = loadDTS(`
declare class Calculator {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
}
`);

      expect(result.errors).toHaveLength(0);
      const decl = findDecl(result.decls, "Calculator");
      const wm = unwrapWithMetadata(getInit(decl));

      const fields = getFieldInfos(wm.body);
      expect(fields.length).toBe(2);
      expect(fields[0].name).toBe("add");
      expect(fields[1].name).toBe("subtract");

      // Each field type should be a FunctionType call
      const addTypeCall = expectCall(fields[0].type);
      expect(expectId(addTypeCall.fn)).toBe("FunctionType");

      const subTypeCall = expectCall(fields[1].type);
      expect(expectId(subTypeCall.fn)).toBe("FunctionType");
    });

    it("handles empty declaration gracefully", () => {
      const result = loadDTS(``);

      expect(result.errors).toHaveLength(0);
      expect(result.decls.length).toBe(0);
    });

    it("handles re-export from module as import decl", () => {
      const result = loadDTS(`
export { ExternalType, externalFunc } from "external";
`);

      expect(result.errors).toHaveLength(0);
      // Should produce an import decl with named specifiers
      const importDecl = findImport(result.decls, "external");
      expect(importDecl.clause.kind).toBe("named");
      if (importDecl.clause.kind === "named") {
        expect(importDecl.clause.specifiers.length).toBe(2);
        expect(importDecl.clause.specifiers[0].name).toBe("ExternalType");
        expect(importDecl.clause.specifiers[1].name).toBe("externalFunc");
      }
    });
  });
});
