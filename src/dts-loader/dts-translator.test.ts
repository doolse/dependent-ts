import { describe, it, expect } from "vitest";
import { loadDTS, DTSLoadResult, ModuleTypeResolver } from "./dts-translator";
import { formatType } from "../types/format";
import { primitiveType, recordType, functionType, unwrapMetadata } from "../types/types";

describe("DTS Translator", () => {
  it("translates primitive type aliases", () => {
    const result = loadDTS(`
type MyString = string;
type MyNumber = number;
type MyBool = boolean;
`);

    expect(result.errors).toEqual([]);
    expect(result.types.get("MyString")?.kind).toBe("primitive");
    expect(result.types.get("MyNumber")?.kind).toBe("primitive");
    expect(result.types.get("MyBool")?.kind).toBe("primitive");
  });

  it("translates union types", () => {
    const result = loadDTS(`type StringOrNumber = string | number;`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("StringOrNumber");
    expect(type?.kind).toBe("union");
    if (type?.kind === "union") {
      expect(type.types).toHaveLength(2);
    }
  });

  it("translates intersection types", () => {
    const result = loadDTS(`type Combined = { a: string } & { b: number };`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Combined");
    expect(type?.kind).toBe("intersection");
    if (type?.kind === "intersection") {
      expect(type.types).toHaveLength(2);
    }
  });

  it("translates interfaces", () => {
    const result = loadDTS(`
interface Person {
  name: string;
  age: number;
  email?: string;
}
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Person");
    expect(type?.kind).toBe("record");
    if (type?.kind === "record") {
      expect(type.fields).toHaveLength(3);
      expect(type.fields[0].name).toBe("name");
      expect(type.fields[1].name).toBe("age");
      expect(type.fields[2].name).toBe("email");
      expect(type.fields[2].optional).toBe(true);
    }
  });

  it("translates function types", () => {
    const result = loadDTS(`type Callback = (x: number, y: string) => boolean;`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Callback");
    expect(type?.kind).toBe("function");
    if (type?.kind === "function") {
      expect(type.params).toHaveLength(2);
      expect(type.params[0].name).toBe("x");
      expect(type.params[1].name).toBe("y");
      expect(type.returnType.kind).toBe("primitive");
    }
  });

  it("translates array types", () => {
    const result = loadDTS(`type Numbers = number[];`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Numbers");
    expect(type?.kind).toBe("array");
    if (type?.kind === "array") {
      expect(type.elements).toHaveLength(1);
      expect(type.elements[0].spread).toBe(true);
    }
  });

  it("translates tuple types", () => {
    const result = loadDTS(`type Point = [number, number];`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Point");
    expect(type?.kind).toBe("array");
    if (type?.kind === "array") {
      expect(type.elements).toHaveLength(2);
      expect(type.elements[0].spread).toBeUndefined();
    }
  });

  it("translates literal types", () => {
    const result = loadDTS(`
type Yes = true;
type No = false;
type Hello = "hello";
type One = 1;
`);

    expect(result.errors).toHaveLength(0);

    const yes = result.types.get("Yes");
    expect(yes?.kind).toBe("literal");
    if (yes?.kind === "literal") {
      expect(yes.value).toBe(true);
    }

    const hello = result.types.get("Hello");
    expect(hello?.kind).toBe("literal");
    if (hello?.kind === "literal") {
      expect(hello.value).toBe("hello");
    }
  });

  it("translates declare function", () => {
    const result = loadDTS(`
declare function createElement(
  type: string,
  props: any,
  ...children: any[]
): ReactElement;
`);

    expect(result.errors).toHaveLength(0);
    const type = result.values.get("createElement");
    expect(type?.kind).toBe("function");
    if (type?.kind === "function") {
      expect(type.params).toHaveLength(3);
      expect(type.params[2].rest).toBe(true);
    }
  });

  it("attaches type params to generic declare function", () => {
    const result = loadDTS(`declare function identity<T>(x: T): T;`);

    expect(result.errors).toHaveLength(0);
    const type = result.values.get("identity");
    expect(type?.kind).toBe("function");
    if (type?.kind === "function") {
      expect(type.typeParams).toEqual(["T"]);
      expect(type.params).toHaveLength(1);
      expect(type.params[0].type.kind).toBe("typeVar");
      expect(type.returnType.kind).toBe("typeVar");
    }
  });

  it("attaches multiple type params to generic declare function", () => {
    const result = loadDTS(`declare function pair<A, B>(a: A, b: B): [A, B];`);

    expect(result.errors).toHaveLength(0);
    const type = result.values.get("pair");
    expect(type?.kind).toBe("function");
    if (type?.kind === "function") {
      expect(type.typeParams).toEqual(["A", "B"]);
    }
  });

  it("non-generic declare function has no typeParams", () => {
    const result = loadDTS(`declare function greet(name: string): string;`);

    expect(result.errors).toHaveLength(0);
    const type = result.values.get("greet");
    expect(type?.kind).toBe("function");
    if (type?.kind === "function") {
      expect(type.typeParams).toBeUndefined();
    }
  });

  it("translates declare class", () => {
    const result = loadDTS(`
declare class Component<P, S> {
  props: P;
  state: S;
  setState(state: Partial<S>): void;
  render(): ReactNode;
}
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Component");
    expect(type?.kind).toBe("record");
    if (type?.kind === "record") {
      expect(type.fields).toHaveLength(4);
      expect(type.fields.map(f => f.name)).toEqual(["props", "state", "setState", "render"]);
    }
  });

  it("translates class with constructor as callable value", () => {
    const result = loadDTS(`
declare class Point {
  x: number;
  y: number;
  constructor(x: number, y: number);
  distance(): number;
}
`);

    expect(result.errors).toHaveLength(0);

    // Instance type should have fields but NOT constructor
    const type = result.types.get("Point");
    expect(type?.kind).toBe("record");
    if (type?.kind === "record") {
      expect(type.fields).toHaveLength(3);
      expect(type.fields.map(f => f.name)).toEqual(["x", "y", "distance"]);
    }

    // Class should also be a value (constructor function)
    const value = result.values.get("Point");
    expect(value?.kind).toBe("function");
    if (value?.kind === "function") {
      // Constructor takes (number, number) and returns Point instance
      expect(value.params).toHaveLength(2);
      expect(value.params[0].name).toBe("x");
      expect(value.params[1].name).toBe("y");
      expect(value.returnType.kind).toBe("record");
    }
  });

  it("translates class without constructor as callable with empty params", () => {
    const result = loadDTS(`
declare class Empty {
  value: string;
}
`);

    expect(result.errors).toHaveLength(0);

    // Should still have a constructor value with empty params
    const value = result.values.get("Empty");
    expect(value?.kind).toBe("function");
    if (value?.kind === "function") {
      expect(value.params).toHaveLength(0);
      expect(value.returnType.kind).toBe("record");
    }
  });

  it("translates namespace", () => {
    const result = loadDTS(`
declare namespace React {
  type ReactNode = string | number | null;
  interface Component<P> {
    props: P;
  }
}
`);

    expect(result.errors).toHaveLength(0);

    // Check prefixed exports
    expect(result.types.has("React.ReactNode")).toBe(true);
    expect(result.types.has("React.Component")).toBe(true);

    // Check namespace value
    const nsValue = result.values.get("React");
    expect(nsValue?.kind).toBe("record");
  });

  it("resolves namespace member types via dot access", () => {
    const result = loadDTS(`
declare namespace React {
  type ReactNode = string | number | null;
}
type X = React.ReactNode;
`);

    expect(result.errors).toHaveLength(0);
    const xType = result.types.get("X");
    expect(xType).toBeDefined();
    // X should resolve to the union string | number | null, not an unresolved type
    expect(xType?.kind).toBe("union");
  });

  it("resolves nested namespace member types", () => {
    const result = loadDTS(`
declare namespace Outer {
  namespace Inner {
    type MyType = string;
  }
}
type X = Outer.Inner.MyType;
`);

    expect(result.errors).toHaveLength(0);
    const xType = result.types.get("X");
    expect(xType).toBeDefined();
    expect(xType?.kind).toBe("primitive");
  });

  it("resolves namespace member types in function params", () => {
    const result = loadDTS(`
declare namespace React {
  type ElementType = string | number;
  type Key = string | number;
}
declare function jsx(type: React.ElementType, key?: React.Key): void;
`);

    expect(result.errors).toHaveLength(0);
    const fn = result.values.get("jsx");
    expect(fn?.kind).toBe("function");
    if (fn?.kind === "function") {
      // First param should be the resolved union, not an IndexedAccessType
      expect(fn.params[0].type.kind).toBe("union");
    }
  });

  it("resolves parameterized type aliases within namespace", () => {
    const result = loadDTS(`
declare namespace NS {
  type SetStateAction<S> = S | ((prevState: S) => S);
  type Dispatch<A> = (value: A) => void;
  function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
}
`);

    expect(result.errors).toHaveLength(0);
    const fnType = result.values.get("NS.useState");
    expect(fnType?.kind).toBe("function");
    if (fnType?.kind === "function") {
      expect(fnType.typeParams).toEqual(["S"]);
      // Return type should be an array [S, (value: S | ((prevState: S) => S)) => void]
      // NOT [S, typeVar("Dispatch<SetStateAction<S>>")]
      const retType = fnType.returnType;
      expect(retType.kind).toBe("array");
      if (retType.kind === "array") {
        expect(retType.elements).toHaveLength(2);
        // Second element should be the expanded Dispatch - a function type
        const dispatchType = retType.elements[1].type;
        expect(dispatchType.kind).toBe("function");
      }
    }
  });

  it("resolves parameterized type aliases at top level", () => {
    const result = loadDTS(`
type Inner<T> = { value: T };
type Outer<T> = { wrapped: Inner<T> };
`);

    expect(result.errors).toHaveLength(0);
    const outerType = result.types.get("Outer");
    expect(outerType).toBeDefined();
    // Outer<T> should have a field 'wrapped' with type { value: T } (not unresolved Inner<T>)
    const body = unwrapMetadata(outerType!);
    expect(body.kind).toBe("record");
    if (body.kind === "record") {
      const wrappedField = body.fields.find(f => f.name === "wrapped");
      expect(wrappedField).toBeDefined();
      expect(wrappedField!.type.kind).toBe("record");
      if (wrappedField!.type.kind === "record") {
        const valueField = wrappedField!.type.fields.find(f => f.name === "value");
        expect(valueField).toBeDefined();
        expect(valueField!.type.kind).toBe("typeVar");
      }
    }
  });

  it("handles generic types with type parameters", () => {
    const result = loadDTS(`type Container<T> = { value: T };`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Container");
    // Generic type is wrapped in withMetadata with typeParams
    expect(type?.kind).toBe("withMetadata");
    const unwrapped = type ? unwrapMetadata(type) : null;
    expect(unwrapped?.kind).toBe("record");
    if (unwrapped?.kind === "record") {
      const valueField = unwrapped.fields.find(f => f.name === "value");
      expect(valueField?.type.kind).toBe("typeVar");
    }
  });

  it("handles conditional types", () => {
    const result = loadDTS(`type IsString<T> = T extends string ? true : false;`);

    // No errors - we now handle conditional types
    expect(result.errors).toHaveLength(0);
    const type = result.types.get("IsString");
    // Generic type is wrapped in withMetadata
    expect(type?.kind).toBe("withMetadata");
    const unwrapped = type ? unwrapMetadata(type) : null;
    // Returns union of both branches for general case
    expect(unwrapped?.kind).toBe("union");
  });

  it("handles conditional types with infer", () => {
    const result = loadDTS(`type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("ReturnType");
    // Generic type is wrapped in withMetadata
    expect(type?.kind).toBe("withMetadata");
    const unwrapped = type ? unwrapMetadata(type) : null;
    // When false branch is never, we return the true branch (the inferred type)
    expect(unwrapped?.kind).toBe("typeVar");
    if (unwrapped?.kind === "typeVar") {
      expect(unwrapped.name).toBe("R");
    }
  });

  it("handles parameterized types like Array<T>", () => {
    const result = loadDTS(`type Numbers = Array<number>;`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Numbers");
    expect(type?.kind).toBe("array");
  });

  it("handles nested types", () => {
    const result = loadDTS(`
type Nested = {
  outer: {
    inner: string;
  };
};
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Nested");
    expect(type?.kind).toBe("record");
    if (type?.kind === "record") {
      const outer = type.fields[0];
      expect(outer.type.kind).toBe("record");
    }
  });

  it("translates keyof on type reference as resolved union", () => {
    // Note: Since local types are now resolved during translation,
    // keyof on a locally-defined interface resolves immediately.
    const result = loadDTS(`
interface Person {
  name: string;
  age: number;
}
type PersonKeys = keyof Person;
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PersonKeys");
    // keyof on a resolved record type gives a union of literals
    expect(type?.kind).toBe("union");
    if (type?.kind === "union") {
      expect(type.types.length).toBe(2);
      const values = type.types
        .filter(t => t.kind === "literal")
        .map(t => (t as { kind: "literal"; value: string }).value);
      expect(values).toContain("name");
      expect(values).toContain("age");
    }
  });

  it("translates keyof on inline record type immediately", () => {
    const result = loadDTS(`
type PersonKeys = keyof { name: string; age: number };
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PersonKeys");
    // keyof on an inline record type resolves immediately to union of literals
    expect(type?.kind).toBe("union");
    if (type?.kind === "union") {
      expect(type.types.length).toBe(2);
      const literals = type.types.filter(t => t.kind === "literal");
      expect(literals.length).toBe(2);
      const values = literals.map(t => (t as { kind: "literal"; value: string }).value);
      expect(values).toContain("name");
      expect(values).toContain("age");
    }
  });

  it("translates keyof on type variable", () => {
    const result = loadDTS(`type Keys<T> = keyof T;`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Keys");
    // Generic type is wrapped in withMetadata
    expect(type?.kind).toBe("withMetadata");
    const unwrapped = type ? unwrapMetadata(type) : null;
    // keyof on a type variable should create a KeyofType
    expect(unwrapped?.kind).toBe("keyof");
    if (unwrapped?.kind === "keyof") {
      expect(unwrapped.operand.kind).toBe("typeVar");
      if (unwrapped.operand.kind === "typeVar") {
        expect(unwrapped.operand.name).toBe("T");
      }
    }
  });

  it("translates indexed access on type reference as resolved", () => {
    // Note: Since local types are now resolved during translation,
    // indexed access on a locally-defined interface resolves immediately.
    const result = loadDTS(`
interface Person {
  name: string;
  age: number;
}
type PersonName = Person["name"];
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PersonName");
    // Indexed access on resolved record with literal key gives the field type
    expect(type?.kind).toBe("primitive");
    if (type?.kind === "primitive") {
      expect(type.name).toBe("String");
    }
  });

  it("translates indexed access on inline record type immediately", () => {
    const result = loadDTS(`
type PersonName = { name: string; age: number }["name"];
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PersonName");
    // Indexed access on inline record with literal key resolves immediately
    expect(type?.kind).toBe("primitive");
    if (type?.kind === "primitive") {
      expect(type.name).toBe("String");
    }
  });

  it("translates indexed access on type variable", () => {
    const result = loadDTS(`type PropType<T, K extends keyof T> = T[K];`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PropType");
    // Generic type is wrapped in withMetadata
    expect(type?.kind).toBe("withMetadata");
    const unwrapped = type ? unwrapMetadata(type) : null;
    // Indexed access with type variable should create IndexedAccessType
    expect(unwrapped?.kind).toBe("indexedAccess");
    if (unwrapped?.kind === "indexedAccess") {
      expect(unwrapped.objectType.kind).toBe("typeVar");
      expect(unwrapped.indexType.kind).toBe("typeVar");
    }
  });

  it("handles keyof inline empty record", () => {
    const result = loadDTS(`
type EmptyKeys = keyof {};
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("EmptyKeys");
    // keyof empty inline record resolves immediately to Never
    expect(type?.kind).toBe("primitive");
    if (type?.kind === "primitive") {
      expect(type.name).toBe("Never");
    }
  });

  it("resolves keyof on empty type reference to Never", () => {
    const result = loadDTS(`
type Empty = {};
type EmptyKeys = keyof Empty;
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("EmptyKeys");
    // keyof on resolved empty record gives Never (no keys)
    expect(type?.kind).toBe("primitive");
    if (type?.kind === "primitive") {
      expect(type.name).toBe("Never");
    }
  });

  // Export declaration tests
  describe("export declarations", () => {
    it("handles export type alias", () => {
      const result = loadDTS(`export type MyString = string;`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("MyString");
      expect(type?.kind).toBe("primitive");
      if (type?.kind === "primitive") {
        expect(type.name).toBe("String");
      }
    });

    it("handles export interface", () => {
      const result = loadDTS(`
export interface User {
  name: string;
  age: number;
}
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("User");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields).toHaveLength(2);
        expect(type.fields[0].name).toBe("name");
        expect(type.fields[1].name).toBe("age");
      }
    });

    it("handles export function", () => {
      const result = loadDTS(`export function greet(name: string): string;`);

      expect(result.errors).toHaveLength(0);
      const type = result.values.get("greet");
      expect(type?.kind).toBe("function");
      if (type?.kind === "function") {
        expect(type.params).toHaveLength(1);
        expect(type.params[0].name).toBe("name");
      }
    });

    it("handles export declare const", () => {
      const result = loadDTS(`export declare const VERSION: string;`);

      expect(result.errors).toHaveLength(0);
      const type = result.values.get("VERSION");
      expect(type?.kind).toBe("primitive");
      if (type?.kind === "primitive") {
        expect(type.name).toBe("String");
      }
    });

    it("handles export declare function", () => {
      const result = loadDTS(`export declare function calculate(x: number): number;`);

      expect(result.errors).toHaveLength(0);
      const type = result.values.get("calculate");
      expect(type?.kind).toBe("function");
    });

    it("handles export declare class", () => {
      const result = loadDTS(`
export declare class Point {
  x: number;
  y: number;
}
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("Point");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields).toHaveLength(2);
        expect(type.fields.map(f => f.name)).toEqual(["x", "y"]);
      }
    });

    it("handles export declare namespace", () => {
      const result = loadDTS(`
export declare namespace Utils {
  function helper(): void;
  type Config = { debug: boolean };
}
`);

      expect(result.errors).toHaveLength(0);
      // Namespace exports are prefixed
      expect(result.values.has("Utils.helper")).toBe(true);
      expect(result.types.has("Utils.Config")).toBe(true);
      // Namespace value itself
      expect(result.values.has("Utils")).toBe(true);
    });

    it("handles export group without rename", () => {
      const result = loadDTS(`
type Internal = string;
interface Data { value: number }
export { Internal, Data };
`);

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("Internal")?.kind).toBe("primitive");
      expect(result.types.get("Data")?.kind).toBe("record");
    });

    it("handles export group with rename", () => {
      const result = loadDTS(`
type Internal = string;
export { Internal as External };
`);

      expect(result.errors).toHaveLength(0);
      // Original name still exists
      expect(result.types.get("Internal")?.kind).toBe("primitive");
      // Renamed export also exists
      expect(result.types.get("External")?.kind).toBe("primitive");
    });

    it("handles export type group", () => {
      const result = loadDTS(`
type MyType = number;
export type { MyType };
`);

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("MyType")?.kind).toBe("primitive");
    });

    it("handles export type group with rename", () => {
      const result = loadDTS(`
type Original = boolean;
export type { Original as Renamed };
`);

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("Original")?.kind).toBe("primitive");
      expect(result.types.get("Renamed")?.kind).toBe("primitive");
    });

    it("handles mixed exports", () => {
      const result = loadDTS(`
export type PublicType = string;
export interface PublicInterface { x: number }
export declare function publicFunc(): void;
type PrivateType = number;
export { PrivateType as ExportedType };
`);

      expect(result.errors).toHaveLength(0);
      expect(result.types.has("PublicType")).toBe(true);
      expect(result.types.has("PublicInterface")).toBe(true);
      expect(result.values.has("publicFunc")).toBe(true);
      expect(result.types.has("PrivateType")).toBe(true);
      expect(result.types.has("ExportedType")).toBe(true);
    });

    it("ignores re-exports when no resolver provided", () => {
      // Re-exports without a resolver should be ignored
      const result = loadDTS(`
export { something } from "other-module";
export * from "another-module";
`);

      // Should not error, just ignore
      expect(result.errors).toHaveLength(0);
      // Nothing should be exported since we don't have a resolver
      expect(result.types.size).toBe(0);
      expect(result.values.size).toBe(0);
    });

    it("handles multiple items in export group", () => {
      const result = loadDTS(`
type A = string;
type B = number;
type C = boolean;
export { A, B as Beta, C };
`);

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("A")?.kind).toBe("primitive");
      expect(result.types.get("Beta")?.kind).toBe("primitive");
      expect(result.types.get("C")?.kind).toBe("primitive");
    });
  });

  // Mapped types tests
  describe("mapped types", () => {
    it("parses Partial<T> as a mapped type", () => {
      const result = loadDTS(`type Partial<T> = { [K in keyof T]?: T[K] };`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("Partial");
      expect(type?.kind).toBe("withMetadata");
      const unwrapped = type ? unwrapMetadata(type) : null;
      expect(unwrapped?.kind).toBe("mapped");
      if (unwrapped?.kind === "mapped") {
        expect(unwrapped.keyVar).toBe("K");
        expect(unwrapped.keyDomain.kind).toBe("keyof");
        expect(unwrapped.optional).toBe("add");
      }
    });

    it("instantiates Partial<T> with concrete record type", () => {
      const result = loadDTS(`
type Partial<T> = { [K in keyof T]?: T[K] };
interface Person {
  name: string;
  age: number;
}
type PartialPerson = Partial<Person>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("PartialPerson");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields.length).toBe(2);
        const nameField = type.fields.find(f => f.name === "name");
        const ageField = type.fields.find(f => f.name === "age");
        expect(nameField?.optional).toBe(true);
        expect(ageField?.optional).toBe(true);
        expect(nameField?.type.kind).toBe("primitive");
        if (nameField?.type.kind === "primitive") {
          expect(nameField.type.name).toBe("String");
        }
      }
    });

    it("parses Required<T> mapped type", () => {
      const result = loadDTS(`type Required<T> = { [K in keyof T]-?: T[K] };`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("Required");
      expect(type?.kind).toBe("withMetadata");
      const unwrapped = type ? unwrapMetadata(type) : null;
      expect(unwrapped?.kind).toBe("mapped");
      if (unwrapped?.kind === "mapped") {
        expect(unwrapped.keyVar).toBe("K");
        expect(unwrapped.optional).toBe("remove");
      }
    });

    it("parses Readonly<T> mapped type", () => {
      const result = loadDTS(`type Readonly<T> = { readonly [K in keyof T]: T[K] };`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("Readonly");
      expect(type?.kind).toBe("withMetadata");
      const unwrapped = type ? unwrapMetadata(type) : null;
      expect(unwrapped?.kind).toBe("mapped");
      if (unwrapped?.kind === "mapped") {
        expect(unwrapped.keyVar).toBe("K");
        expect(unwrapped.readonly).toBe("add");
      }
    });

    it("instantiates Pick<T, K> with concrete types", () => {
      const result = loadDTS(`
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
interface Person {
  name: string;
  age: number;
  email: string;
}
type NameAndAge = Pick<Person, "name" | "age">;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("NameAndAge");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields.length).toBe(2);
        const names = type.fields.map(f => f.name).sort();
        expect(names).toEqual(["age", "name"]);
      }
    });

    it("handles nested mapped types", () => {
      const result = loadDTS(`
type Partial<T> = { [K in keyof T]?: T[K] };
interface Nested {
  a: string;
  b: number;
}
type Container<T> = { value: Partial<T> };
type PartialNested = Container<Nested>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("PartialNested");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        const valueField = type.fields.find(f => f.name === "value");
        expect(valueField?.type.kind).toBe("record");
        if (valueField?.type.kind === "record") {
          expect(valueField.type.fields.length).toBe(2);
          expect(valueField.type.fields.every(f => f.optional)).toBe(true);
        }
      }
    });
  });

  // Generic type instantiation tests
  describe("generic type instantiation", () => {
    it("instantiates generic type alias with concrete type", () => {
      const result = loadDTS(`
type Container<T> = { value: T };
type StringContainer = Container<string>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("StringContainer");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields.length).toBe(1);
        expect(type.fields[0].name).toBe("value");
        expect(type.fields[0].type.kind).toBe("primitive");
        if (type.fields[0].type.kind === "primitive") {
          expect(type.fields[0].type.name).toBe("String");
        }
      }
    });

    it("instantiates generic interface with concrete type", () => {
      const result = loadDTS(`
interface Box<T> {
  contents: T;
  isEmpty: boolean;
}
type NumberBox = Box<number>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("NumberBox");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields.length).toBe(2);
        const contents = type.fields.find(f => f.name === "contents");
        expect(contents?.type.kind).toBe("primitive");
        if (contents?.type.kind === "primitive") {
          expect(contents.type.name).toBe("Number");
        }
      }
    });

    it("instantiates nested generic types", () => {
      const result = loadDTS(`
type Wrapper<T> = { inner: T };
type Container<T> = { value: Wrapper<T> };
type StringContainer = Container<string>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("StringContainer");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        const valueField = type.fields.find(f => f.name === "value");
        expect(valueField?.type.kind).toBe("record");
        if (valueField?.type.kind === "record") {
          const innerField = valueField.type.fields.find(f => f.name === "inner");
          expect(innerField?.type.kind).toBe("primitive");
          if (innerField?.type.kind === "primitive") {
            expect(innerField.type.name).toBe("String");
          }
        }
      }
    });

    it("instantiates generic type with multiple parameters", () => {
      const result = loadDTS(`
type Pair<A, B> = { first: A; second: B };
type StringNumberPair = Pair<string, number>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("StringNumberPair");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        const first = type.fields.find(f => f.name === "first");
        const second = type.fields.find(f => f.name === "second");
        expect(first?.type.kind).toBe("primitive");
        expect(second?.type.kind).toBe("primitive");
        if (first?.type.kind === "primitive" && second?.type.kind === "primitive") {
          expect(first.type.name).toBe("String");
          expect(second.type.name).toBe("Number");
        }
      }
    });

    it("instantiates generic function type", () => {
      const result = loadDTS(`
type Callback<T, R> = (value: T) => R;
type StringToNumber = Callback<string, number>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("StringToNumber");
      expect(type?.kind).toBe("function");
      if (type?.kind === "function") {
        expect(type.params.length).toBe(1);
        expect(type.params[0].type.kind).toBe("primitive");
        if (type.params[0].type.kind === "primitive") {
          expect(type.params[0].type.name).toBe("String");
        }
        expect(type.returnType.kind).toBe("primitive");
        if (type.returnType.kind === "primitive") {
          expect(type.returnType.name).toBe("Number");
        }
      }
    });

    it("instantiates generic union type", () => {
      const result = loadDTS(`
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
type StringResult = Result<string, Error>;
`);

      expect(result.errors).toHaveLength(0);
      const type = result.types.get("StringResult");
      expect(type?.kind).toBe("union");
      if (type?.kind === "union") {
        expect(type.types.length).toBe(2);
      }
    });

    it("preserves metadata from instantiated generic", () => {
      const result = loadDTS(`
type Container<T> = { value: T };
type StringContainer = Container<string>;
`);

      expect(result.errors).toHaveLength(0);
      // The StringContainer itself is a non-generic type alias
      // Container<T> is the generic that stores metadata with typeParams
      const container = result.types.get("Container");
      expect(container?.kind).toBe("withMetadata");
      if (container?.kind === "withMetadata") {
        expect(container.metadata.typeParams).toEqual(["T"]);
      }
    });
  });

  // Cross-file resolution tests
  describe("cross-file resolution", () => {
    // Create a mock resolver that returns predefined modules
    function createMockResolver(modules: Record<string, DTSLoadResult>): ModuleTypeResolver {
      return (specifier: string, _fromPath: string) => {
        return modules[specifier] || null;
      };
    }

    it("resolves imported types", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["ImportedType", primitiveType("String")]]),
        values: new Map(),
        errors: [],
      };

      const result = loadDTS(
        `
import { ImportedType } from "some-module";
type MyType = ImportedType;
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ "some-module": mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const myType = result.types.get("MyType");
      expect(myType?.kind).toBe("primitive");
      if (myType?.kind === "primitive") {
        expect(myType.name).toBe("String");
      }
    });

    it("resolves imported values", () => {
      const mockModule: DTSLoadResult = {
        types: new Map(),
        values: new Map([
          ["helperFn", functionType([{ name: "x", type: primitiveType("Number"), optional: false }], primitiveType("String"))],
        ]),
        errors: [],
      };

      const result = loadDTS(
        `
import { helperFn } from "utils";
export { helperFn };
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ utils: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const fn = result.values.get("helperFn");
      expect(fn?.kind).toBe("function");
    });

    it("handles import with rename", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["OriginalName", primitiveType("Number")]]),
        values: new Map(),
        errors: [],
      };

      const result = loadDTS(
        `
import { OriginalName as LocalName } from "module";
type UseIt = LocalName;
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ module: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const useIt = result.types.get("UseIt");
      expect(useIt?.kind).toBe("primitive");
      if (useIt?.kind === "primitive") {
        expect(useIt.name).toBe("Number");
      }
    });

    it("handles namespace import", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["SomeType", primitiveType("Boolean")]]),
        values: new Map([["someFunc", functionType([], primitiveType("Void"))]]),
        errors: [],
      };

      const result = loadDTS(
        `
import * as ns from "module";
export { ns };
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ module: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const ns = result.values.get("ns");
      expect(ns?.kind).toBe("record");
      if (ns?.kind === "record") {
        expect(ns.fields.length).toBe(2);
        expect(ns.fields.map((f) => f.name).sort()).toEqual(["SomeType", "someFunc"]);
      }
    });

    it("resolves namespace member types from imported namespace", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["ElementType", primitiveType("String")]]),
        values: new Map([["useState", functionType([], primitiveType("Void"))]]),
        errors: [],
      };

      const result = loadDTS(
        `
import * as React from "react";
declare function jsx(type: React.ElementType): void;
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ react: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const fn = result.values.get("jsx");
      expect(fn?.kind).toBe("function");
      if (fn?.kind === "function") {
        // React.ElementType should resolve to String, not an IndexedAccessType
        expect(fn.params[0].type.kind).toBe("primitive");
      }
    });

    it("handles re-export with resolver", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["ExternalType", primitiveType("String")]]),
        values: new Map([["externalFunc", functionType([], primitiveType("Number"))]]),
        errors: [],
      };

      const result = loadDTS(
        `
export { ExternalType, externalFunc } from "external";
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ external: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("ExternalType")?.kind).toBe("primitive");
      expect(result.values.get("externalFunc")?.kind).toBe("function");
    });

    it("handles re-export with rename", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["InternalName", primitiveType("Boolean")]]),
        values: new Map(),
        errors: [],
      };

      const result = loadDTS(
        `
export { InternalName as PublicName } from "module";
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ module: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("PublicName")?.kind).toBe("primitive");
      // Original name should NOT be exported
      expect(result.types.has("InternalName")).toBe(false);
    });

    it("handles export * from module", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([
          ["TypeA", primitiveType("String")],
          ["TypeB", primitiveType("Number")],
        ]),
        values: new Map([["funcA", functionType([], primitiveType("Void"))]]),
        errors: [],
      };

      const result = loadDTS(
        `
export * from "module";
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ module: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.types.get("TypeA")?.kind).toBe("primitive");
      expect(result.types.get("TypeB")?.kind).toBe("primitive");
      expect(result.values.get("funcA")?.kind).toBe("function");
    });

    it("handles circular dependency gracefully", () => {
      // Create a resolver that simulates circular dependency
      // by returning an empty result when called
      let callCount = 0;
      const circularResolver: ModuleTypeResolver = (_specifier, _fromPath) => {
        callCount++;
        if (callCount > 10) {
          throw new Error("Too many resolver calls - possible infinite loop");
        }
        // Return empty result to simulate circular dependency handling
        return { types: new Map(), values: new Map(), errors: [] };
      };

      const result = loadDTS(
        `
import { Something } from "circular";
export type MyType = string;
`,
        {
          filePath: "/test/file.d.ts",
          resolver: circularResolver,
        }
      );

      // Should not hang or throw
      expect(result.errors).toHaveLength(0);
      expect(result.types.get("MyType")?.kind).toBe("primitive");
    });

    it("handles missing module gracefully", () => {
      const result = loadDTS(
        `
import { NotFound } from "nonexistent";
type MyType = string;
`,
        {
          filePath: "/test/file.d.ts",
          resolver: () => null, // Always returns null
        }
      );

      // Should not error, just ignore the import
      expect(result.errors).toHaveLength(0);
      expect(result.types.get("MyType")?.kind).toBe("primitive");
    });

    it("uses imported type in record field", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([
          [
            "Address",
            recordType([
              { name: "street", type: primitiveType("String"), optional: false, annotations: [] },
              { name: "city", type: primitiveType("String"), optional: false, annotations: [] },
            ]),
          ],
        ]),
        values: new Map(),
        errors: [],
      };

      const result = loadDTS(
        `
import { Address } from "types";
interface Person {
  name: string;
  address: Address;
}
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ types: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const person = result.types.get("Person");
      expect(person?.kind).toBe("record");
      if (person?.kind === "record") {
        const addressField = person.fields.find((f) => f.name === "address");
        expect(addressField?.type.kind).toBe("record");
        if (addressField?.type.kind === "record") {
          expect(addressField.type.fields.length).toBe(2);
        }
      }
    });

    it("handles import type syntax", () => {
      const mockModule: DTSLoadResult = {
        types: new Map([["TypeOnly", primitiveType("String")]]),
        values: new Map(),
        errors: [],
      };

      const result = loadDTS(
        `
import type { TypeOnly } from "module";
type MyType = TypeOnly;
`,
        {
          filePath: "/test/file.d.ts",
          resolver: createMockResolver({ module: mockModule }),
        }
      );

      expect(result.errors).toHaveLength(0);
      const myType = result.types.get("MyType");
      expect(myType?.kind).toBe("primitive");
    });
  });

  describe("typeof type operator", () => {
    it("resolves typeof for a declared const", () => {
      const result = loadDTS(`
declare const foo: string;
type FooType = typeof foo;
`);
      expect(result.errors).toHaveLength(0);
      const type = result.types.get("FooType");
      expect(type?.kind).toBe("primitive");
      if (type?.kind === "primitive") {
        expect(type.name).toBe("String");
      }
    });

    it("resolves typeof for a declared function", () => {
      const result = loadDTS(`
declare function greet(name: string): string;
type GreetFn = typeof greet;
`);
      expect(result.errors).toHaveLength(0);
      const type = result.types.get("GreetFn");
      expect(type?.kind).toBe("function");
      if (type?.kind === "function") {
        expect(type.params).toHaveLength(1);
        expect(type.returnType.kind).toBe("primitive");
      }
    });

    it("resolves typeof for a const with object type", () => {
      const result = loadDTS(`
declare const config: { host: string; port: number };
type Config = typeof config;
`);
      expect(result.errors).toHaveLength(0);
      const type = result.types.get("Config");
      expect(type?.kind).toBe("record");
      if (type?.kind === "record") {
        expect(type.fields).toHaveLength(2);
        expect(type.fields.find(f => f.name === "host")?.type.kind).toBe("primitive");
        expect(type.fields.find(f => f.name === "port")?.type.kind).toBe("primitive");
      }
    });

    it("resolves typeof for overloaded function", () => {
      const result = loadDTS(`
declare function parse(input: string): number;
declare function parse(input: number): string;
type ParseFn = typeof parse;
`);
      expect(result.errors).toHaveLength(0);
      const type = result.types.get("ParseFn");
      expect(type?.kind).toBe("intersection");
    });

    it("returns Unknown for undefined value", () => {
      const result = loadDTS(`
type Missing = typeof nonexistent;
`);
      const type = result.types.get("Missing");
      expect(type?.kind).toBe("primitive");
      if (type?.kind === "primitive") {
        expect(type.name).toBe("Unknown");
      }
    });

    it("resolves typeof used in a larger type expression", () => {
      const result = loadDTS(`
declare const x: string;
type MaybeX = typeof x | null;
`);
      expect(result.errors).toHaveLength(0);
      const type = result.types.get("MaybeX");
      expect(type?.kind).toBe("union");
    });
  });
});
