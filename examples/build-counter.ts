/**
 * Build script to generate counter.js from dependent-ts source
 */
import { parse, generateModuleWithImports } from "../src/index";
import * as fs from "fs";
import * as path from "path";

// The dependent-ts source code for our counter
const source = `
import { jsx, jsxs } from "react/jsx-runtime" in
import { useState } from "react" in
  fn(props) =>
    let [count, setCount] = useState(0) in
    jsxs("div", {
      style: { fontFamily: "system-ui", padding: "20px" },
      children: [
        jsx("h1", { children: "Counter (from dependent-ts)" }),
        jsx("p", {
          style: { fontSize: "48px", margin: "20px 0" },
          children: count
        }),
        jsxs("div", {
          children: [
            jsx("button", {
              style: { fontSize: "24px", marginRight: "10px", padding: "10px 20px" },
              onClick: fn() => setCount(count - 1),
              children: "-"
            }),
            jsx("button", {
              style: { fontSize: "24px", padding: "10px 20px" },
              onClick: fn() => setCount(count + 1),
              children: "+"
            })
          ]
        })
      ]
    })
`;

console.log("=== Source (dependent-ts) ===");
console.log(source);

// Parse and generate
const expr = parse(source);
const jsCode = generateModuleWithImports(expr);

console.log("\n=== Generated JavaScript ===");
console.log(jsCode);

// Write to file
const outputPath = path.join(__dirname, "counter.js");
fs.writeFileSync(outputPath, jsCode);
console.log(`\nWritten to: ${outputPath}`);
console.log("\nTo run: open examples/counter.html in a browser (needs a local server)");