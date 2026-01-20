// Type System Features in DepJS
// Types are first-class values that can be introspected at compile time

// Define a record type
type Person = { name: String, age: Int, email: String };

// Type introspection - these are evaluated at compile time
// and inlined as literals in the generated JavaScript
const personTypeName = Person.name;
const personFields = Person.fieldNames;

print("Type name:", personTypeName);
print("Field names:", personFields);

// Creating values of the type
const alice: Person = { name: "Alice", age: 30, email: "alice@example.com" };
print("Person:", alice);

// Nested types
type Address = { street: String, city: String };
type Employee = { person: Person, address: Address, salary: Int };

// Union types (sum types)
type Result = { ok: true, value: Int } | { ok: false, error: String };

const success: Result = { ok: true, value: 42 };
const failure: Result = { ok: false, error: "something went wrong" };

const handleResult = (r: Result): String => match (r) {
  case { ok: true }: "Success";
  case { ok: false }: "Error";
};

print(handleResult(success));
print(handleResult(failure));

// Compile-time assertions
assert(Person.fieldNames.length == 3, "Person should have 3 fields");

// The assertion is checked at compile time and removed from output
// If it fails, compilation fails with an error
print("All compile-time assertions passed!");
