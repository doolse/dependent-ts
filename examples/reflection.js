import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";

export default (props) => {
  const [count, setCount] = useState(0);
  const factorial = function fac(n) { return n <= 1 ? 1 : n * fac(n - 1); };
  const fib = function fibRec(n) { return n <= 1 ? n : fibRec(n - 1) + fibRec(n - 2); };
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
    children: factorial(10).toString()
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
    children: fib(15).toString()
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
    children: [
    factorial(1),
    factorial(2),
    factorial(3),
    factorial(4),
    factorial(5),
    factorial(6),
    factorial(7)
  ].map((f) => jsx("span", {
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
    children: [
    fib(1),
    fib(2),
    fib(3),
    fib(4),
    fib(5),
    fib(6),
    fib(7),
    fib(8),
    fib(9),
    fib(10)
  ].map((f) => jsx("span", {
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
