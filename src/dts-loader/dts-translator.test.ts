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

  it("reports errors for conditional types (not yet implemented)", () => {
    const result = loadDTS(`type IsString<T> = T extends string ? true : false;`);

    // Should have an error about conditional types
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Conditional");
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
});
