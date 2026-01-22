// Type-safe CSV loading - types derived from CSV headers at compile time
//
// This example demonstrates:
// - Reading files at compile time with Comptime.readFile
// - Using string methods (split, trim) at compile time
// - Building types dynamically from data with RecordType
// - Deriving field types from header naming conventions (headers ending in "I" are Int)
// - Using buildRecord to construct typed records from key-value pairs
// - Demand-driven comptime propagation (no explicit 'comptime' keyword needed)

// Helper to determine field type from header name
// Headers ending in "I" are Int, otherwise String
const fieldType = (header: String): Type =>
  header.endsWith("I") ? Int : String;

// Helper to parse a value based on header convention
// If header ends with "I", parse as Int; otherwise keep as String
const parseValue = (header: String, value: String): String | Int =>
  header.endsWith("I") ? parseInt(value) : value;

// Read the CSV at compile time - no 'comptime' keyword needed because
// Comptime.readFile() is comptime-only, so demand-driven evaluation kicks in
const content = Comptime.readFile("users.csv");

// Parse headers at compile time
const lines = content.split("\n");
const headerLine = lines[0];
const headers = headerLine.split(",").map(h => h.trim());

// Build the User type from actual CSV headers found in the file
// Type is derived from header names: ageI -> Int, others -> String
// Result: { name: String, email: String, role: String, ageI: Int }
const User = RecordType(headers.map(h => ({
  name: h,
  type: fieldType(h),
  optional: false
})));

// Parse data rows using buildRecord to construct properly typed records
// No hardcoded field names - the mapping is driven by headers!
const dataLines = lines.slice(1).filter(line => line.length > 0);
const users: Array<User> = dataLines.map(line => {
  const values = line.split(",").map(v => v.trim());
  // Create [key, value] pairs, converting to Int where needed
  const entries = headers.map((h, i) => [h, parseValue(h, values[i])]);
  // buildRecord validates entries against User type and returns User
  buildRecord(entries, User)
});

// Type-safe access - field types are derived from CSV headers:
print("First user:", users[0].name);      // String
print("Email:", users[0].email);          // String
print("Role:", users[0].role);            // String
print("Age:", users[0].ageI);             // Int (header ended with "I")

// The power here is that User type is DERIVED from the CSV headers.
// If the CSV changes (new columns, different names), the type changes automatically.
// Any type mismatches are caught at compile time.

// This would be a compile error (uncomment to test):
// print(users[0].nmae);  // Error: property 'nmae' does not exist on type User

// Type safety: ageI is Int, so arithmetic works:
print("Next year:", users[0].ageI + 1);  // OK - Int + Int = Int

// But string methods on ageI would fail (uncomment to test):
// print(users[0].ageI.toUpperCase());  // Error: Int has no method 'toUpperCase'
