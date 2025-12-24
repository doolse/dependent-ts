import { describe, it, expect, beforeEach } from "vitest";
import {
  loadFromSource,
  TSDeclarationLoader,
  constraintToString,
  implies,
  isNumber,
  isString,
  isBool,
  isNull,
  isUndefined,
  isArray,
  isObject,
  isFunction,
  anyC,
  neverC,
  and,
  or,
  hasField,
  elements,
  resetTypeParamCounter,
  resetConstraintVarCounter,
} from "../src/index";

describe("TypeScript Declaration Loader", () => {
  beforeEach(() => {
    resetTypeParamCounter();
    resetConstraintVarCounter();
  });

  describe("primitive types", () => {
    it("loads number type", () => {
      const result = loadFromSource(`export const x: number = 0;`);
      expect(result).not.toBeNull();
      expect(result!.exports.has("x")).toBe(true);
      const c = result!.exports.get("x")!;
      expect(implies(c, isNumber)).toBe(true);
    });

    it("loads string type", () => {
      const result = loadFromSource(`export const x: string = "";`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isString)).toBe(true);
    });

    it("loads boolean type", () => {
      const result = loadFromSource(`export const x: boolean = true;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isBool)).toBe(true);
    });

    it("loads null type", () => {
      const result = loadFromSource(`export const x: null = null;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("isNull");
    });

    it("loads undefined type", () => {
      const result = loadFromSource(`export const x: undefined = undefined;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("isUndefined");
    });

    it("loads any type", () => {
      const result = loadFromSource(`export const x: any = null;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("any");
    });

    it("loads never type", () => {
      const result = loadFromSource(`export const x: never = undefined as never;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("never");
    });
  });

  describe("literal types", () => {
    it("loads number literal type", () => {
      const result = loadFromSource(`export const x: 42 = 42;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isNumber)).toBe(true);
      // Should include equals constraint
      if (c.tag === "and") {
        expect(c.constraints.some(x => x.tag === "equals" && x.value === 42)).toBe(true);
      }
    });

    it("loads string literal type", () => {
      const result = loadFromSource(`export const x: "hello" = "hello";`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isString)).toBe(true);
    });
  });

  describe("union types", () => {
    it("loads union of primitives", () => {
      const result = loadFromSource(`export const x: number | string = 0;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("or");
      if (c.tag === "or") {
        expect(c.constraints.length).toBe(2);
      }
    });

    it("loads nullable type", () => {
      const result = loadFromSource(`export const x: number | null = 0;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("or");
    });

    it("loads optional type (undefined union)", () => {
      const result = loadFromSource(`export const x: number | undefined = 0;`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(c.tag).toBe("or");
    });
  });

  describe("array types", () => {
    it("loads array type with bracket syntax", () => {
      const result = loadFromSource(`export const x: number[] = [];`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isArray)).toBe(true);
      // Should have elements constraint
      if (c.tag === "and") {
        const elemC = c.constraints.find(x => x.tag === "elements");
        expect(elemC).toBeDefined();
        if (elemC && elemC.tag === "elements") {
          expect(implies(elemC.constraint, isNumber)).toBe(true);
        }
      }
    });

    it("loads Array<T> syntax", () => {
      const result = loadFromSource(`export const x: Array<string> = [];`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isArray)).toBe(true);
    });
  });

  describe("tuple types", () => {
    it("loads simple tuple", () => {
      const result = loadFromSource(`export const x: [number, string] = [0, ""];`);
      expect(result).not.toBeNull();
      const c = result!.exports.get("x")!;
      expect(implies(c, isArray)).toBe(true);
      // Should have elementAt and length constraints
      if (c.tag === "and") {
        const elem0 = c.constraints.find(x => x.tag === "elementAt" && x.index === 0);
        const elem1 = c.constraints.find(x => x.tag === "elementAt" && x.index === 1);
        const lenC = c.constraints.find(x => x.tag === "length");
        expect(elem0).toBeDefined();
        expect(elem1).toBeDefined();
        expect(lenC).toBeDefined();
      }
    });
  });

  describe("object types", () => {
    it("loads interface", () => {
      const result = loadFromSource(`
        export interface Point {
          x: number;
          y: number;
        }
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("Point")!;
      expect(implies(c, isObject)).toBe(true);
      // Should have hasField constraints
      if (c.tag === "and") {
        const hasX = c.constraints.find(
          x => x.tag === "hasField" && x.name === "x"
        );
        const hasY = c.constraints.find(
          x => x.tag === "hasField" && x.name === "y"
        );
        expect(hasX).toBeDefined();
        expect(hasY).toBeDefined();
      }
    });

    it("loads type alias for object", () => {
      const result = loadFromSource(`
        export type Person = {
          name: string;
          age: number;
        };
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("Person")!;
      expect(implies(c, isObject)).toBe(true);
    });
  });

  describe("function types", () => {
    it("loads simple function declaration", () => {
      const result = loadFromSource(`
        export function add(a: number, b: number): number;
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("add")!;
      expect(c.tag).toBe("fnType");
      if (c.tag === "fnType") {
        expect(c.params.length).toBe(2);
        expect(implies(c.result, isNumber)).toBe(true);
      }
    });

    it("loads function type alias", () => {
      const result = loadFromSource(`
        export const greet: (name: string) => string = (n) => n;
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("greet")!;
      expect(c.tag).toBe("fnType");
      if (c.tag === "fnType") {
        expect(c.params.length).toBe(1);
        expect(implies(c.params[0], isString)).toBe(true);
        expect(implies(c.result, isString)).toBe(true);
      }
    });
  });

  describe("generic function types", () => {
    it("loads identity function", () => {
      const result = loadFromSource(`
        export function identity<T>(x: T): T;
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("identity")!;
      expect(c.tag).toBe("genericFnType");
      if (c.tag === "genericFnType") {
        expect(c.typeParams.length).toBe(1);
        expect(c.typeParams[0].name).toBe("T");
        expect(c.params.length).toBe(1);
        // Param and result should reference the type param
        expect(c.params[0].tag).toBe("typeParam");
        expect(c.result.tag).toBe("typeParam");
      }
    });

    it("loads map function", () => {
      const result = loadFromSource(`
        export function map<T, U>(arr: T[], fn: (x: T) => U): U[];
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("map")!;
      expect(c.tag).toBe("genericFnType");
      if (c.tag === "genericFnType") {
        expect(c.typeParams.length).toBe(2);
        expect(c.typeParams[0].name).toBe("T");
        expect(c.typeParams[1].name).toBe("U");
      }
    });

    it("loads bounded generic function", () => {
      const result = loadFromSource(`
        export function first<T extends object>(obj: T): T;
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("first")!;
      expect(c.tag).toBe("genericFnType");
      if (c.tag === "genericFnType") {
        expect(c.typeParams.length).toBe(1);
        // The bound should be isObject
        expect(implies(c.typeParams[0].bound, isObject)).toBe(true);
      }
    });

    it("loads useState-like function", () => {
      const result = loadFromSource(`
        export function useState<T>(initial: T): [T, (value: T) => void];
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("useState")!;
      expect(c.tag).toBe("genericFnType");
      if (c.tag === "genericFnType") {
        expect(c.typeParams.length).toBe(1);
        expect(c.typeParams[0].name).toBe("T");
        // Result should be a tuple
        expect(implies(c.result, isArray)).toBe(true);
      }
    });
  });

  describe("constraint to string", () => {
    it("prints loaded generic function type", () => {
      const result = loadFromSource(`
        export function identity<T>(x: T): T;
      `);
      expect(result).not.toBeNull();
      const c = result!.exports.get("identity")!;
      const str = constraintToString(c);
      expect(str).toContain("<T>");
      expect(str).toContain("T");
    });
  });

  describe("complex React-like types", () => {
    it("loads FC-like type", () => {
      const result = loadFromSource(`
        export interface Props {
          name: string;
          count: number;
        }
        export function Component(props: Props): null;
      `);
      expect(result).not.toBeNull();
      expect(result!.exports.has("Props")).toBe(true);
      expect(result!.exports.has("Component")).toBe(true);
    });
  });
});
