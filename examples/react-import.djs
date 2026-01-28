// Example: Importing from React
// This demonstrates that DepJS can load types from @types/react

import { useState, useEffect, createElement } from "react";

// useState should have the correct overloaded function type
// Calling with initial value 0
const state = useState(0);

// The result is a tuple [S, Dispatch<SetStateAction<S>>]
const counter = state[0];
const setCounter = state[1];

// useEffect takes an effect callback and optional dependency array
const effect = useEffect(() => {
  print("Effect ran!");
});

// createElement takes a component type, props, and children array
const element = createElement("div", { className: "test" }, ["Hello"]);

print("Types loaded successfully from @types/react!");
print("useState, useEffect, and createElement are all properly typed.");
