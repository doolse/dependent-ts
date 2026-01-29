import { describe, it, expect } from "vitest";
import { parseDTS, printTree, getText, getChildren } from "./dts-parser";

describe("DTS Parser", () => {
  it("parses primitive types", () => {
    const source = `
type MyString = string;
type MyNumber = number;
type MyBool = boolean;
`;
    const tree = parseDTS(source);
    console.log("\n=== Primitive Types ===");
    printTree(tree, source);

    // Verify we got type alias declarations
    const cursor = tree.cursor();
    const names: string[] = [];
    cursor.firstChild();
    do {
      if (cursor.name === "TypeAliasDeclaration") {
        cursor.firstChild();
        do {
          if ((cursor.name as string) === "TypeDefinition") {
            names.push(getText(cursor, source));
          }
        } while (cursor.nextSibling());
        cursor.parent();
      }
    } while (cursor.nextSibling());

    expect(names).toEqual(["MyString", "MyNumber", "MyBool"]);
  });

  it("parses union types", () => {
    const source = `type StringOrNumber = string | number;`;
    const tree = parseDTS(source);
    console.log("\n=== Union Type ===");
    printTree(tree, source);
  });

  it("parses intersection types", () => {
    const source = `type Combined = { a: string } & { b: number };`;
    const tree = parseDTS(source);
    console.log("\n=== Intersection Type ===");
    printTree(tree, source);
  });

  it("parses interface declarations", () => {
    const source = `
interface Person {
  name: string;
  age: number;
  email?: string;
}
`;
    const tree = parseDTS(source);
    console.log("\n=== Interface ===");
    printTree(tree, source);
  });

  it("parses generic types", () => {
    const source = `
type Container<T> = { value: T };
type Pair<A, B> = { first: A; second: B };
`;
    const tree = parseDTS(source);
    console.log("\n=== Generic Types ===");
    printTree(tree, source);
  });

  it("parses conditional types", () => {
    const source = `
type IsString<T> = T extends string ? true : false;
type NonNullable<T> = T extends null | undefined ? never : T;
`;
    const tree = parseDTS(source);
    console.log("\n=== Conditional Types ===");
    printTree(tree, source);
  });

  it("parses infer keyword", () => {
    const source = `
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
type ElementType<T> = T extends (infer U)[] ? U : never;
type Unwrap<T> = T extends Promise<infer U> ? U : T;
`;
    const tree = parseDTS(source);
    console.log("\n=== Infer Types ===");
    printTree(tree, source);
  });

  it("parses function types", () => {
    const source = `
type Callback = (x: number, y: string) => boolean;
type AsyncFn = () => Promise<void>;
`;
    const tree = parseDTS(source);
    console.log("\n=== Function Types ===");
    printTree(tree, source);
  });

  it("parses tuple types", () => {
    const source = `
type Point = [number, number];
type Named = [x: number, y: number];
type Variadic = [string, ...number[]];
`;
    const tree = parseDTS(source);
    console.log("\n=== Tuple Types ===");
    printTree(tree, source);
  });

  it("parses mapped types", () => {
    const source = `
type Partial<T> = { [K in keyof T]?: T[K] };
type Readonly<T> = { readonly [K in keyof T]: T[K] };
`;
    const tree = parseDTS(source);
    console.log("\n=== Mapped Types ===");
    printTree(tree, source);
  });

  it("parses namespace declarations", () => {
    const source = `
declare namespace React {
  type ReactNode = string | number | null;
  interface Component<P> {
    props: P;
  }
}
`;
    const tree = parseDTS(source);
    console.log("\n=== Namespace ===");
    printTree(tree, source);
  });

  it("parses keyof and indexed access", () => {
    const source = `
type Keys<T> = keyof T;
type PropType<T, K extends keyof T> = T[K];
`;
    const tree = parseDTS(source);
    console.log("\n=== Keyof and Indexed Access ===");
    printTree(tree, source);
  });

  it("parses class declarations", () => {
    const source = `
declare class Component<P, S> {
  props: P;
  state: S;
  setState(state: Partial<S>): void;
  render(): ReactNode;
}
`;
    const tree = parseDTS(source);
    console.log("\n=== Class Declaration ===");
    printTree(tree, source);
  });

  it("parses function declarations", () => {
    const source = `
declare function createElement(
  type: string,
  props: any,
  ...children: any[]
): ReactElement;
`;
    const tree = parseDTS(source);
    console.log("\n=== Function Declaration ===");
    printTree(tree, source);
  });

  it("parses overloaded functions", () => {
    const source = `
declare function useState<S>(initialState: S | (() => S)): [S, (s: S) => void];
declare function useState<S = undefined>(): [S | undefined, (s: S | undefined) => void];
`;
    const tree = parseDTS(source);
    console.log("\n=== Overloaded Functions ===");
    printTree(tree, source);
  });

  it("parses mapped types", () => {
    const source = `type Partial<T> = { [K in keyof T]?: T[K] };
type Readonly<T> = { readonly [K in keyof T]: T[K] };`;
    const tree = parseDTS(source);
    console.log("\n=== Mapped Types ===");
    printTree(tree, source);
  });

  it("parses Required mapped type with -?", () => {
    const source = `type Required<T> = { [K in keyof T]-?: T[K] };`;
    const tree = parseDTS(source);
    console.log("\n=== Required Mapped Type ===");
    printTree(tree, source);
  });
});
