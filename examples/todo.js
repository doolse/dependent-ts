import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";

export default (props) => (() => {
  const [todos, setTodos] = useState([]);
  return (() => {
    const [inputText, setInputText] = useState("");
    return jsxs("div", {
      style: {
      fontFamily: "system-ui",
      padding: "20px",
      maxWidth: "500px",
      margin: "0 auto"
    },
      children: [
      jsx("h1", { children: "TODO App(from dependent-ts)" }),
      jsxs("div", {
      style: { display: "flex", marginBottom: "20px" },
      children: [
      jsx("input", {
      type: "text",
      value: inputText,
      placeholder: "Enter a todo...",
      style: { flex: 1, padding: "10px", fontSize: "16px" },
      onChange: (e) => setInputText(e.target.value)
    }),
      jsx("button", {
      style: {
      padding: "10px 20px",
      fontSize: "16px",
      marginLeft: "10px",
      cursor: "pointer"
    },
      onClick: () => inputText !== "" ? (() => {
      const newTodo = { id: todos.length, text: inputText, completed: false };
      setTodos(todos.concat([newTodo]));
      return setInputText("");
    })() : null,
      children: "Add"
    })
    ]
    }),
      jsx("ul", {
      style: { listStyle: "none", padding: 0 },
      children: todos.map((todo) => jsx("li", {
      key: todo.id,
      style: {
      padding: "10px",
      marginBottom: "5px",
      backgroundColor: "#f5f5f5",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    },
      children: jsxs("div", {
      style: { display: "flex", alignItems: "center", flex: 1 },
      children: [
      jsx("input", {
      type: "checkbox",
      checked: todo.completed,
      style: { marginRight: "10px", cursor: "pointer" },
      onChange: () => setTodos(todos.map((t) => t.id === todo.id ? { id: t.id, text: t.text, completed: !t.completed } : t))
    }),
      jsx("span", {
      style: todo.completed ? { textDecoration: "line-through", color: "#888" } : {},
      children: todo.text
    }),
      jsx("button", {
      style: {
      marginLeft: "auto",
      padding: "5px 10px",
      cursor: "pointer",
      backgroundColor: "#ff4444",
      color: "white",
      border: "none",
      borderRadius: "3px"
    },
      onClick: () => setTodos(todos.filter((t) => t.id !== todo.id)),
      children: "Delete"
    })
    ]
    })
    }))
    }),
      todos.length > 0 ? jsx("p", {
      style: { color: "#666", marginTop: "20px" },
      children: "Total: " + todos.length.toString() + " items"
    }) : jsx("p", {
      style: { color: "#999", marginTop: "20px", fontStyle: "italic" },
      children: "No todos yet.Add one above!"
    })
    ]
    });
  })();
})();
