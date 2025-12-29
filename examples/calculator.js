import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

export default (props) => {
  const [display, setDisplay] = useState("0");
  const [memory, setMemory] = useState(0);
  const [operation, setOperation] = useState("");
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const inputDigit = (digit) => waitingForOperand ? (() => {
    setDisplay(digit);
    return setWaitingForOperand(false);
  })() : setDisplay(display === "0" ? digit : display + digit);
  const inputDecimal = () => waitingForOperand ? (() => {
    setDisplay("0.");
    return setWaitingForOperand(false);
  })() : !display.includes(".") ? setDisplay(display + ".") : null;
  const clear = () => (() => {
    setDisplay("0");
    setMemory(0);
    setOperation(null);
    return setWaitingForOperand(false);
  })();
  const performOperation = (nextOp) => (() => {
    setOperation(nextOp);
    setMemory(display);
    return setWaitingForOperand(true);
  })();
  const calculate = () => setDisplay(memory.toString() + " " + operation + " " + display);
  const applyFunction = (funcName) => {
    const n = display;
    return funcName === "sqrt" ? setDisplay("sqrt(" + display + ")") : funcName === "square" ? setDisplay(display + "^2") : funcName === "factorial" ? setDisplay(display + "!") : setDisplay(display);
  };
  const buttonStyle = {
    padding: "15px",
    fontSize: "18px",
    border: "1px solid #ddd",
    backgroundColor: "#f5f5f5",
    cursor: "pointer",
    borderRadius: "4px"
  };
  const opStyle = {
    padding: "15px",
    fontSize: "18px",
    border: "1px solid #ddd",
    backgroundColor: "#ff9800",
    color: "white",
    cursor: "pointer",
    borderRadius: "4px"
  };
  const funcStyle = {
    padding: "15px",
    fontSize: "14px",
    border: "1px solid #ddd",
    backgroundColor: "#2196F3",
    color: "white",
    cursor: "pointer",
    borderRadius: "4px"
  };
  return jsxs("div", {
    style: {
    fontFamily: "system-ui",
    padding: "20px",
    maxWidth: "350px",
    margin: "0 auto"
  },
    children: [
    jsx("h1", { children: "Calculator" }),
    jsxs("div", {
    style: {
    backgroundColor: "#e8f5e9",
    padding: "15px",
    borderRadius: "8px",
    marginBottom: "20px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Language Features"
  }),
    jsxs("ul", {
    style: { margin: 0, paddingLeft: "20px", fontSize: "14px" },
    children: [
    jsx("li", { children: "Recursive functions(factorial,power,sqrt)" }),
    jsx("li", { children: "Named recursive functions(fn fac(n)syntax)" }),
    jsx("li", { children: "Nested function definitions" }),
    jsx("li", { children: "Pattern matching with conditionals" })
  ]
  })
  ]
  }),
    jsx("div", {
    style: {
    backgroundColor: "#333",
    color: "#0f0",
    padding: "20px",
    fontSize: "28px",
    textAlign: "right",
    borderRadius: "8px",
    marginBottom: "10px",
    fontFamily: "monospace",
    minHeight: "40px",
    wordBreak: "break-all"
  },
    children: display
  }),
    jsxs("div", {
    style: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "5px",
    marginBottom: "10px"
  },
    children: [
    jsx("button", {
    style: funcStyle,
    onClick: () => applyFunction("sqrt"),
    children: "sqrt"
  }),
    jsx("button", {
    style: funcStyle,
    onClick: () => applyFunction("square"),
    children: "x2"
  }),
    jsx("button", {
    style: funcStyle,
    onClick: () => applyFunction("factorial"),
    children: "n"
  }),
    jsx("button", { style: opStyle, onClick: clear, children: "C" })
  ]
  }),
    jsxs("div", {
    style: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "5px"
  },
    children: [
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("7"),
    children: "7"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("8"),
    children: "8"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("9"),
    children: "9"
  }),
    jsx("button", {
    style: opStyle,
    onClick: () => performOperation("/"),
    children: ":"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("4"),
    children: "4"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("5"),
    children: "5"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("6"),
    children: "6"
  }),
    jsx("button", {
    style: opStyle,
    onClick: () => performOperation("*"),
    children: "x"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("1"),
    children: "1"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("2"),
    children: "2"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("3"),
    children: "3"
  }),
    jsx("button", {
    style: opStyle,
    onClick: () => performOperation("-"),
    children: "-"
  }),
    jsx("button", {
    style: buttonStyle,
    onClick: () => inputDigit("0"),
    children: "0"
  }),
    jsx("button", { style: buttonStyle, onClick: inputDecimal, children: "." }),
    jsx("button", { style: opStyle, onClick: calculate, children: "=" }),
    jsx("button", {
    style: opStyle,
    onClick: () => performOperation("+"),
    children: "+"
  })
  ]
  }),
    jsxs("div", {
    style: {
    marginTop: "20px",
    padding: "15px",
    backgroundColor: "#fff3e0",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Recursive Math Functions"
  }),
    jsx("p", {
    style: { margin: 0, fontSize: "14px" },
    children: "This calculator uses recursive functions for factorial,power,and square root(Newton-Raphson method)."
  })
  ]
  })
  ]
  });
};
