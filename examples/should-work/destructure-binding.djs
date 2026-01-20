// Pattern matching with destructure bindings
// The destructured fields should be available in the case body

type Person = { name: String, age: Int };

const greet = (p: Person): String => match (p) {
  case { name, age }: name;
};

const alice: Person = { name: "Alice", age: 30 };
print(greet(alice));