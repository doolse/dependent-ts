import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

export default (props) => {
  const [count, setCount] = useState(0);
  return jsxs("div", {
    style: { fontFamily: "system-ui", padding: "20px" },
    children: [
    jsx("h1", { children: "Counter(from dependent-ts)" }),
    jsx("p", {
    style: { fontSize: "48px", margin: "20px 0" },
    children: count
  }),
    jsxs("div", {
    children: [
    jsx("button", {
    style: {
    fontSize: "24px",
    marginRight: "10px",
    padding: "10px 20px"
  },
    onClick: () => setCount(count - 1),
    children: "-"
  }),
    jsx("button", {
    style: { fontSize: "24px", padding: "10px 20px" },
    onClick: () => setCount(count + 1),
    children: "+"
  })
  ]
  })
  ]
  });
};
