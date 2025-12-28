import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";

export default (props) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState(false);
  const isEmpty = (s) => s.length === 0;
  const isValidEmail = (s) => s.includes("@") && s.includes(".");
  const isNumber = (s) => s.length === 0 ? false : s.split("").filter((c) => c < "0" || c > "9").length === 0;
  const minLength = (n) => (s) => s.length >= n;
  const validate = () => [
    isEmpty(email) ? "Email is required" : !isValidEmail(email) ? "Email must contain @ and ." : null,
    isEmpty(password) ? "Password is required" : !(() => {
    const [s] = [password];
    return s.length >= 8;
  })() ? "Password must be at least 8 characters" : null,
    isEmpty(age) ? "Age is required" : !isNumber(age) ? "Age must be a number" : null
  ].filter((x) => x !== null);
  const handleSubmit = () => {
    const validationErrors = [
      isEmpty(email) ? "Email is required" : !isValidEmail(email) ? "Email must contain @ and ." : null,
      isEmpty(password) ? "Password is required" : !(() => {
      const [s] = [password];
      return s.length >= 8;
    })() ? "Password must be at least 8 characters" : null,
      isEmpty(age) ? "Age is required" : !isNumber(age) ? "Age must be a number" : null
    ].filter((x) => x !== null);
    return setSuccess(false);
  };
  return jsxs("div", {
    style: {
    fontFamily: "system-ui",
    padding: "20px",
    maxWidth: "400px",
    margin: "0 auto"
  },
    children: [
    jsx("h1", { children: "Form Validation Demo" }),
    jsxs("div", {
    style: {
    backgroundColor: "#e3f2fd",
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
    jsx("li", {
    children: "Higher-order functions(minLength returns a function)"
  }),
    jsx("li", { children: "Functional composition for validation" }),
    jsx("li", { children: "Pattern matching with if-then-else chains" }),
    jsx("li", { children: "Array methods:concat,filter,split" })
  ]
  })
  ]
  }),
    jsxs("div", {
    style: { marginBottom: "15px" },
    children: [
    jsx("label", {
    style: {
    display: "block",
    marginBottom: "5px",
    fontWeight: "bold"
  },
    children: "Email:"
  }),
    jsx("input", {
    type: "text",
    value: email,
    placeholder: "user@example.com",
    style: {
    width: "100%",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    boxSizing: "border-box"
  },
    onChange: (e) => setEmail(e.target.value)
  })
  ]
  }),
    jsxs("div", {
    style: { marginBottom: "15px" },
    children: [
    jsx("label", {
    style: {
    display: "block",
    marginBottom: "5px",
    fontWeight: "bold"
  },
    children: "Password:"
  }),
    jsx("input", {
    type: "password",
    value: password,
    placeholder: "Min 8 characters",
    style: {
    width: "100%",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    boxSizing: "border-box"
  },
    onChange: (e) => setPassword(e.target.value)
  })
  ]
  }),
    jsxs("div", {
    style: { marginBottom: "15px" },
    children: [
    jsx("label", {
    style: {
    display: "block",
    marginBottom: "5px",
    fontWeight: "bold"
  },
    children: "Age:"
  }),
    jsx("input", {
    type: "text",
    value: age,
    placeholder: "Enter your age",
    style: {
    width: "100%",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    boxSizing: "border-box"
  },
    onChange: (e) => setAge(e.target.value)
  })
  ]
  }),
    jsx("button", {
    style: {
    width: "100%",
    padding: "12px",
    backgroundColor: "#2196F3",
    color: "white",
    border: "none",
    borderRadius: "4px",
    fontSize: "16px",
    cursor: "pointer"
  },
    onClick: () => {
    const validationErrors = [
      isEmpty(email) ? "Email is required" : !isValidEmail(email) ? "Email must contain @ and ." : null,
      isEmpty(password) ? "Password is required" : !(() => {
      const [s] = [password];
      return s.length >= 8;
    })() ? "Password must be at least 8 characters" : null,
      isEmpty(age) ? "Age is required" : !isNumber(age) ? "Age must be a number" : null
    ].filter((x) => x !== null);
    return setSuccess(false);
  },
    children: "Validate and Submit"
  }),
    success ? jsx("div", {
    style: {
    marginTop: "15px",
    padding: "15px",
    backgroundColor: "#e8f5e9",
    borderRadius: "8px",
    border: "1px solid #a5d6a7"
  },
    children: jsx("p", {
    style: { margin: 0, color: "#2e7d32", fontWeight: "bold" },
    children: "Form submitted successfully!"
  })
  }) : jsx("div", {})
  ]
  });
};
