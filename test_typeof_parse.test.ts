import { describe, it } from "vitest";
import { parseDTS, printTree } from "./src/dts-loader/dts-parser";

describe("Typeof parsing", () => {
  it("parses typeof in type position", () => {
    const source = `type MyType = typeof x;
type MyOtherType = typeof globalThis;`;
    const tree = parseDTS(source);
    console.log("\n=== Typeof in Type Position ===");
    printTree(tree, source);
  });
});
