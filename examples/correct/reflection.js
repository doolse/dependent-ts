import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

export default (props) => {
  const [count, setCount] = useState(0);
  return jsxs("div", {
    style: {
    fontFamily: "system-ui",
    padding: "20px",
    maxWidth: "600px",
    margin: "0 auto"
  },
    children: [
    jsx("h1", { children: "Compile-Time Computation Demo" }),
    jsxs("div", {
    style: {
    backgroundColor: "#f0f8ff",
    padding: "15px",
    borderRadius: "8px",
    marginBottom: "20px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Staged Evaluation"
  }),
    jsx("p", {
    style: { margin: 0, fontSize: "14px" },
    children: "This language uses staged evaluation-comptime()ensures values are computed during compilation,not at runtime."
  })
  ]
  }),
    jsxs("div", {
    style: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "20px"
  },
    children: [
    jsxs("div", {
    style: {
    backgroundColor: "#e8f5e9",
    padding: "15px",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Factorial(10)"
  }),
    jsx("p", {
    style: { fontSize: "24px", fontWeight: "bold", margin: 0 },
    children: "3628800"
  })
  ]
  }),
    jsxs("div", {
    style: {
    backgroundColor: "#fff3e0",
    padding: "15px",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Fibonacci(15)"
  }),
    jsx("p", {
    style: { fontSize: "24px", fontWeight: "bold", margin: 0 },
    children: "610"
  })
  ]
  })
  ]
  }),
    jsxs("div", {
    style: {
    marginTop: "20px",
    backgroundColor: "#e3f2fd",
    padding: "15px",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Factorials 1-7"
  }),
    jsx("div", {
    style: { display: "flex", gap: "10px", flexWrap: "wrap" },
    children: [1, 2, 6, 24, 120, 720, 5040].map((f) => jsx("span", {
    style: {
    padding: "5px 10px",
    backgroundColor: "#1976d2",
    color: "white",
    borderRadius: "4px"
  },
    children: f.toString()
  }))
  })
  ]
  }),
    jsxs("div", {
    style: {
    marginTop: "20px",
    backgroundColor: "#fce4ec",
    padding: "15px",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Fibonacci 1-10"
  }),
    jsx("div", {
    style: { display: "flex", gap: "10px", flexWrap: "wrap" },
    children: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55].map((f) => jsx("span", {
    style: {
    padding: "5px 10px",
    backgroundColor: "#c2185b",
    color: "white",
    borderRadius: "4px"
  },
    children: f.toString()
  }))
  })
  ]
  }),
    jsxs("div", {
    style: {
    marginTop: "20px",
    backgroundColor: "#f5f5f5",
    padding: "15px",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Runtime Counter"
  }),
    jsxs("div", {
    style: { display: "flex", alignItems: "center", gap: "10px" },
    children: [
    jsx("button", {
    style: {
    padding: "10px 20px",
    fontSize: "18px",
    cursor: "pointer"
  },
    onClick: () => setCount(count - 1),
    children: "-"
  }),
    jsx("span", {
    style: {
    fontSize: "24px",
    fontWeight: "bold",
    minWidth: "50px",
    textAlign: "center"
  },
    children: count.toString()
  }),
    jsx("button", {
    style: {
    padding: "10px 20px",
    fontSize: "18px",
    cursor: "pointer"
  },
    onClick: () => setCount(count + 1),
    children: "+"
  })
  ]
  })
  ]
  })
  ]
  });
};
