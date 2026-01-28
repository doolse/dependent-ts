import { describe, it, expect } from "vitest";
import { loadDTS } from "./dts-translator";
import { formatType } from "../types/format";

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

  it("handles generic types with type parameters", () => {
    const result = loadDTS(`type Container<T> = { value: T };`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("Container");
    expect(type?.kind).toBe("record");
    if (type?.kind === "record") {
      const valueField = type.fields.find(f => f.name === "value");
      expect(valueField?.type.kind).toBe("typeVar");
    }
  });

  it("handles conditional types", () => {
    const result = loadDTS(`type IsString<T> = T extends string ? true : false;`);

    // No errors - we now handle conditional types
    expect(result.errors).toHaveLength(0);
    const type = result.types.get("IsString");
    // Returns union of both branches for general case
    expect(type?.kind).toBe("union");
  });

  it("handles conditional types with infer", () => {
    const result = loadDTS(`type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("ReturnType");
    // When false branch is never, we return the true branch (the inferred type)
    expect(type?.kind).toBe("typeVar");
    if (type?.kind === "typeVar") {
      expect(type.name).toBe("R");
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

  it("translates keyof on type reference as deferred keyof", () => {
    // Note: At translation time, type references (like Person) are unresolved.
    // The keyof is kept as a deferred KeyofType to be resolved during type checking.
    const result = loadDTS(`
interface Person {
  name: string;
  age: number;
}
type PersonKeys = keyof Person;
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PersonKeys");
    // keyof on a type reference creates a deferred KeyofType
    expect(type?.kind).toBe("keyof");
    if (type?.kind === "keyof") {
      // The operand is the unresolved "Person" type reference
      expect(type.operand.kind).toBe("typeVar");
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
    // keyof on a type variable should create a KeyofType
    expect(type?.kind).toBe("keyof");
    if (type?.kind === "keyof") {
      expect(type.operand.kind).toBe("typeVar");
      if (type.operand.kind === "typeVar") {
        expect(type.operand.name).toBe("T");
      }
    }
  });

  it("translates indexed access on type reference as deferred", () => {
    // Note: At translation time, type references are unresolved.
    // Indexed access is kept as deferred to be resolved during type checking.
    const result = loadDTS(`
interface Person {
  name: string;
  age: number;
}
type PersonName = Person["name"];
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("PersonName");
    // Indexed access on type reference creates deferred IndexedAccessType
    expect(type?.kind).toBe("indexedAccess");
    if (type?.kind === "indexedAccess") {
      expect(type.objectType.kind).toBe("typeVar"); // Unresolved Person
      expect(type.indexType.kind).toBe("literal"); // "name" literal
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
    // Indexed access with type variable should create IndexedAccessType
    expect(type?.kind).toBe("indexedAccess");
    if (type?.kind === "indexedAccess") {
      expect(type.objectType.kind).toBe("typeVar");
      expect(type.indexType.kind).toBe("typeVar");
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

  it("keeps keyof on type reference as deferred", () => {
    const result = loadDTS(`
type Empty = {};
type EmptyKeys = keyof Empty;
`);

    expect(result.errors).toHaveLength(0);
    const type = result.types.get("EmptyKeys");
    // keyof on type reference (even if it's empty) is deferred
    expect(type?.kind).toBe("keyof");
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

    it("ignores re-exports from other modules", () => {
      // Re-exports from other modules are not supported yet
      const result = loadDTS(`
export { something } from "other-module";
export * from "another-module";
`);

      // Should not error, just ignore
      expect(result.errors).toHaveLength(0);
      // Nothing should be exported since we don't follow imports
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
});
