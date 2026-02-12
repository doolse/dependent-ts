// DepJS React Counter App
// A browser-runnable React component demonstrating:
//   - .d.ts imports (react, react/jsx-runtime)
//   - Generic function calls with type argument inference (useState)
//   - Array destructuring of hook return values
//   - Arrow functions as components and event handlers
//   - Template literals
//   - Record literals as props

import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

const Counter = () => {
  const [count, setCount] = useState(0);

  jsxs("div", {
    children: [
      jsx("h1", { children: "DepJS Counter" }),
      jsx("p", { children: `Count: ${count}` }),
      jsxs("div", {
        children: [
          jsx("button", {
            onClick: () => setCount(count + 1),
            children: "+"
          }),
          jsx("button", {
            onClick: () => setCount(count - 1),
            children: "-"
          })
        ]
      })
    ]
  })
};

export const App = Counter;