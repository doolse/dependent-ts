// Type-safe CSV loading - types derived from CSV headers at compile time
//
// This example demonstrates:
// - Reading files at compile time with comptime.readFile
// - Using string methods (split, trim) at compile time
// - Building types dynamically from data with RecordType
// - Demand-driven comptime propagation (no explicit 'comptime' keyword needed)

// Read the CSV at compile time - no 'comptime' keyword needed because
// Comptime.readFile() is comptime-only, so demand-driven evaluation kicks in
const content = Comptime.readFile("users.csv");

// Parse headers at compile time
const lines = content.split("\n");
const headerLine = lines[0];
const headers = headerLine.split(",").map(h => h.trim());

// Build the User type from actual CSV headers found in the file
// This type will have exactly the fields from the CSV: name, email, role
// Using const instead of type because we need to call RecordType with computed args
const User = RecordType(headers.map(h => ({ name: h, type: String, optional: false })));

// Parse data rows into the typed structure
const dataLines = lines.slice(1).filter(line => line.length > 0);
const users: Array<User> = dataLines.map(line => {
  const values = line.split(",").map(v => v.trim());
  // Construct a User record - field order must match headers
  ({ name: values[0], email: values[1], role: values[2] })
});

// Type-safe access - these work because User has name, email, role fields:
print("First user:", users[0].name);
print("Email:", users[0].email);
print("Role:", users[0].role);

// This would be a compile error (uncomment to test):
// print(users[0].nmae);  // Error: property 'nmae' does not exist on type User
