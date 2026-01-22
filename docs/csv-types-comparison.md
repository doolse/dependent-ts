# CSV Types: Language Comparison

This document compares how different languages can achieve compile-time type generation from CSV files, similar to the DepJS `csv-types.djs` example.

## The Goal

Read a CSV file at compile time, derive a record type from its headers, and get full type safety where field names and types come from the actual file content.

**Sample CSV (`users.csv`):**
```csv
name,email,role,ageI
Alice,alice@example.com,admin,30
Bob,bob@example.com,user,25
Charlie,charlie@example.com,user,35
```

---

## DepJS (This Language)

```javascript
// Type-safe CSV loading - types derived from CSV headers at compile time

const fieldType = (header: String): Type =>
  header.endsWith("I") ? Int : String;

const parseValue = (header: String, value: String): String | Int =>
  header.endsWith("I") ? parseInt(value) : value;

// Read and parse at compile time
const content = Comptime.readFile("users.csv");
const lines = content.split("\n");
const headers = lines[0].split(",").map(h => h.trim());

// Build User type from actual CSV headers
const User = RecordType(headers.map(h => ({
  name: h,
  type: fieldType(h),
  optional: false
})));

// Parse data rows with full type safety
const dataLines = lines.slice(1).filter(line => line.length > 0);
const users: Array<User> = dataLines.map(line => {
  const values = line.split(",").map(v => v.trim());
  const entries = headers.map((h, i) => [h, parseValue(h, values[i])]);
  buildRecord(entries, User)
});

// Type-safe access
print("First user:", users[0].name);      // String
print("Age:", users[0].ageI);             // Int
print("Next year:", users[0].ageI + 1);   // arithmetic works

// users[0].nmae would be a compile error
```

**Key features:**
- `Comptime.readFile` reads files at compile time
- `RecordType(...)` constructs types from data
- `buildRecord(entries, Type)` creates typed records from key-value pairs
- Same language for compile-time and runtime code

---

## F# Type Providers

The cleanest existing equivalent—type providers were designed for exactly this use case.

```fsharp
// F# with FSharp.Data package
open FSharp.Data

// Type is generated from CSV headers at compile time
type Users = CsvProvider<"users.csv">

let users = Users.Load("users.csv")

// Type-safe access - fields derived from headers
for user in users.Rows do
    printfn "First user: %s" user.Name      // string
    printfn "Email: %s" user.Email          // string
    printfn "Role: %s" user.Role            // string
    printfn "Age: %d" user.AgeI             // int (inferred from data)
    printfn "Next year: %d" (user.AgeI + 1) // arithmetic works

// user.Nmae would be a compile error
```

**Notes:**
- F# type providers infer `Int` from actual data values, not from naming conventions
- The type provider is a separate compiled assembly, not regular F# code
- Source code: https://github.com/fsprojects/FSharp.Data/tree/main/src/FSharp.Data.Csv.Core

**Limitations:**
- Type providers must be written in a separate project
- Cannot use arbitrary F# code—must follow the type provider API
- The provider runs in a sandboxed environment

### Why is the F# CSV Provider ~1000+ Lines?

The FSharp.Data CSV provider is spread across multiple files:

**CsvRuntime.fs (~300 lines)** — Runtime parsing:
- RFC 4180-compliant CSV parsing (quoted values, escaped quotes, embedded newlines)
- Lazy enumeration for memory efficiency
- `CsvFile<'RowType>` class with `Map`, `Filter`, `Take`, `Skip`, `Save`
- Resource disposal (`IDisposable`)

**CsvInference.fs (~200 lines)** — Type inference:
- Infers column types from sample data (Int, Float, String, DateTime, etc.)
- Handles nullable vs optional types
- Culture-specific parsing (decimal separators, date formats)
- Schema string parsing (`"Name,Age:int,Score:float?"`)
- Units of measure support

**CsvProvider.fs (~400 lines)** — Type generation:
- Defines **16 static parameters**: sample path, separator, quote char, has headers, inference rows, schema, skip rows, encoding, culture, etc.
- Generates the Row type with properties for each column
- Creates constructor expressions via F# quotations
- Supports multiple data sources: files, embedded resources, HTTP URLs

**Sources of complexity:**

| Concern | What It Adds |
|---------|--------------|
| Configuration | 16 parameters with validation and interaction logic |
| Type Inference | Sampling rows, merging types, handling nulls/optionals |
| RFC 4180 Compliance | Quoted fields, escaped quotes, multiline values |
| Multiple Sources | File paths, URIs, embedded resources |
| F# Type Provider API | Quotation-based code generation, provided types infrastructure |
| Culture/Localization | Number formats, date parsing per culture |
| Error Handling | Graceful degradation, informative error messages |
| Performance | Lazy evaluation, streaming large files |

**The core issue:** F# type providers are *external to the language*. They must:
1. Implement the `ITypeProvider` interface
2. Generate types as `ProvidedTypeDefinition` objects
3. Build runtime code as **quotations** (AST) that get compiled separately
4. Run in a sandboxed design-time environment

This means the type provider author writes code that *generates code that generates types*—two levels of meta-programming with a verbose API.

**Contrast with DepJS:**
```
// F# Type Provider approach:
// 1. Read file in design-time sandbox
// 2. Infer types using inference module
// 3. Build ProvidedTypeDefinition with ProvidedProperty for each column
// 4. Generate quotation expressions for constructors/parsers
// 5. Hook into compiler via ITypeProvider interface

// DepJS approach:
const User = RecordType(headers.map(h => ({ name: h, type: fieldType(h) })));
```

In DepJS, `RecordType` is a regular function that returns a `Type` value. There's no separate provider API, no quotations, no sandboxing—just code that runs at compile time using the same semantics as runtime code.

---

## Zig

Zig's comptime is powerful but struct field creation from runtime data is limited.

```zig
const std = @import("std");

// Embed file at compile time
const csv_content = @embedFile("users.csv");

// Parse headers at comptime
fn parseHeaders() []const []const u8 {
    comptime {
        var headers: [10][]const u8 = undefined;
        var count: usize = 0;

        // Find first line
        var i: usize = 0;
        var start: usize = 0;
        while (i < csv_content.len and csv_content[i] != '\n') : (i += 1) {
            if (csv_content[i] == ',') {
                headers[count] = csv_content[start..i];
                count += 1;
                start = i + 1;
            }
        }
        headers[count] = csv_content[start..i];
        count += 1;

        return headers[0..count];
    }
}

// LIMITATION: Zig cannot create struct fields from comptime strings
// You must define the struct manually or use a build.zig code generator
const User = struct {
    name: []const u8,
    email: []const u8,
    role: []const u8,
    ageI: i32,
};

pub fn main() void {
    const headers = comptime parseHeaders();
    std.debug.print("Headers: {any}\n", .{headers});
}
```

**Limitations:**
- Cannot create struct fields from comptime-known strings
- Would need a `build.zig` step to generate the struct definition as source code
- No equivalent to `buildRecord` for dynamic field population

---

## D

D's CTFE (Compile-Time Function Execution) and mixins can generate types from strings.

```d
import std.stdio;
import std.string;
import std.conv;
import std.array;

// Read file at compile time
enum csvContent = import("users.csv");

// Generate struct definition from headers at compile time
string generateStruct() {
    auto lines = csvContent.splitLines();
    auto headers = lines[0].split(",").map!(h => h.strip).array;

    string fields;
    foreach (h; headers) {
        // Headers ending in "I" are int, otherwise string
        string type = h.endsWith("I") ? "int" : "string";
        fields ~= type ~ " " ~ h ~ "; ";
    }

    return "struct User { " ~ fields ~ "}";
}

// Mixin generates: struct User { string name; string email; string role; int ageI; }
mixin(generateStruct());

// Parse data rows
User[] parseUsers() {
    auto lines = csvContent.splitLines();
    auto headers = lines[0].split(",").map!(h => h.strip).array;
    User[] users;

    foreach (line; lines[1..$]) {
        if (line.length == 0) continue;
        auto values = line.split(",").map!(v => v.strip).array;

        User u;
        // Manual field assignment required
        u.name = values[0];
        u.email = values[1];
        u.role = values[2];
        u.ageI = values[3].to!int;
        users ~= u;
    }
    return users;
}

void main() {
    auto users = parseUsers();

    writeln("First user: ", users[0].name);
    writeln("Email: ", users[0].email);
    writeln("Age: ", users[0].ageI);
    writeln("Next year: ", users[0].ageI + 1);

    // users[0].nmae would be a compile error
}
```

**Limitations:**
- The struct is generated via string mixin (code as strings)
- Field assignment in parser is still hardcoded
- CTFE has restrictions on what code can run

---

## Nim

Nim macros can read files at compile time and generate AST nodes.

```nim
import macros, strutils, sequtils

# Macro that reads CSV and generates type at compile time
macro csvType(filename: static[string]): untyped =
  let content = staticRead(filename)
  let lines = content.splitLines()
  let headers = lines[0].split(",").mapIt(it.strip)

  # Build record type fields
  var recFields = newNimNode(nnkRecList)
  for h in headers:
    let fieldType = if h.endsWith("I"): ident("int") else: ident("string")
    recFields.add(newIdentDefs(ident(h), fieldType))

  # Generate: type User = object \n name: string ...
  result = newNimNode(nnkTypeSection).add(
    newNimNode(nnkTypeDef).add(
      ident("User"),
      newEmptyNode(),
      newNimNode(nnkObjectTy).add(
        newEmptyNode(),
        newEmptyNode(),
        recFields
      )
    )
  )

# Generate the User type from CSV headers
csvType("users.csv")

# Parse function
proc parseUsers(filename: string): seq[User] =
  let content = readFile(filename)
  let lines = content.splitLines()

  for line in lines[1..^1]:
    if line.len == 0: continue
    let values = line.split(",").mapIt(it.strip)
    var user: User
    # Manual field assignment required
    user.name = values[0]
    user.email = values[1]
    user.role = values[2]
    user.ageI = parseInt(values[3])
    result.add(user)

let users = parseUsers("users.csv")

echo "First user: ", users[0].name
echo "Email: ", users[0].email
echo "Age: ", users[0].ageI
echo "Next year: ", users[0].ageI + 1

# users[0].nmae would be a compile error
```

**Limitations:**
- Type generation works via AST manipulation
- Field assignment in parser is still manual
- Macros operate on AST, not values

---

## Rust (Procedural Macro)

Requires a separate proc-macro crate.

**In `csv_macro/src/lib.rs`:**
```rust
use proc_macro::TokenStream;
use std::fs;

#[proc_macro]
pub fn csv_record(input: TokenStream) -> TokenStream {
    let filename = input.to_string().trim_matches('"').to_string();
    let content = fs::read_to_string(&filename)
        .expect("Failed to read CSV file");

    let first_line = content.lines().next().unwrap();
    let headers: Vec<&str> = first_line.split(',').map(|s| s.trim()).collect();

    let fields: String = headers.iter().map(|h| {
        let field_type = if h.ends_with("I") { "i32" } else { "String" };
        format!("pub {}: {},\n", h, field_type)
    }).collect();

    let output = format!(
        r#"
        #[derive(Debug)]
        pub struct User {{
            {}
        }}
        "#,
        fields
    );

    output.parse().unwrap()
}
```

**In `main.rs`:**
```rust
use csv_macro::csv_record;

// Generates struct at compile time from CSV headers
csv_record!("users.csv");

fn main() {
    // Manual parsing still required
    let user = User {
        name: "Alice".to_string(),
        email: "alice@example.com".to_string(),
        role: "admin".to_string(),
        ageI: 30,
    };

    println!("First user: {}", user.name);
    println!("Email: {}", user.email);
    println!("Age: {}", user.ageI);
    println!("Next year: {}", user.ageI + 1);

    // user.nmae would be a compile error
}
```

**Limitations:**
- Proc macros must be in a separate crate
- Generate code as token streams (essentially strings)
- Cannot share logic between macro and runtime code
- No way to generate the parser dynamically

---

## Haskell (Template Haskell)

```haskell
{-# LANGUAGE TemplateHaskell #-}

module Main where

import Language.Haskell.TH
import Data.List.Split (splitOn)

-- Template Haskell splice that generates the User type
$(do
    content <- runIO $ readFile "users.csv"
    let headerLine = head $ lines content
        headers = map trim $ splitOn "," headerLine
        trim = dropWhile (== ' ') . reverse . dropWhile (== ' ') . reverse

        -- Generate field declarations
        mkField h =
            let fieldType = if last h == 'I' then ConT ''Int else ConT ''String
            in (mkName h, Bang NoSourceUnpackedness NoSourceStrictness, fieldType)

        fields = map mkField headers

    -- Generate: data User = User { name :: String, email :: String, ... }
    return [DataD [] (mkName "User") [] Nothing
            [RecC (mkName "User") fields]
            [DerivClause Nothing [ConT ''Show]]]
  )

-- Parsing still needs manual field mapping
parseUser :: [String] -> User
parseUser values = User
    { name = values !! 0
    , email = values !! 1
    , role = values !! 2
    , ageI = read (values !! 3)
    }

main :: IO ()
main = do
    content <- readFile "users.csv"
    let ls = lines content
        dataLines = filter (not . null) $ tail ls
        users = map (parseUser . map trim . splitOn ",") dataLines
        trim = dropWhile (== ' ') . reverse . dropWhile (== ' ') . reverse

    let user = head users
    putStrLn $ "First user: " ++ name user
    putStrLn $ "Email: " ++ email user
    putStrLn $ "Age: " ++ show (ageI user)
    putStrLn $ "Next year: " ++ show (ageI user + 1)

    -- nmae user would be a compile error
```

**Limitations:**
- Template Haskell has staging restrictions
- IO in splices requires `runIO` and can cause issues
- Field assignment in parser is manual

---

## Summary Comparison

| Language | Type Generation | Dynamic Field Population | Code Sharing | Elegance |
|----------|----------------|-------------------------|--------------|----------|
| **DepJS** | ✅ Native `RecordType` | ✅ `buildRecord` | ✅ Same language | ⭐⭐⭐⭐⭐ |
| **F#** | ✅ Type Provider | ✅ Built-in | ❌ Separate provider | ⭐⭐⭐⭐ |
| **D** | ✅ String mixin | ❌ Manual | ⚠️ CTFE subset | ⭐⭐⭐ |
| **Nim** | ✅ AST macro | ❌ Manual | ⚠️ Macro subset | ⭐⭐⭐ |
| **Rust** | ✅ Proc macro | ❌ Manual | ❌ Separate crate | ⭐⭐ |
| **Haskell** | ✅ TH splice | ❌ Manual | ⚠️ TH restrictions | ⭐⭐ |
| **Zig** | ❌ Cannot create fields | ❌ N/A | ✅ Same language | ⭐ |

### Key Differentiators

**DepJS advantages:**
1. **`buildRecord(entries, Type)`** — Construct typed records from key-value pairs at runtime, with type validation at compile time
2. **Same language** — No separate macro language, provider API, or string-based code generation
3. **Demand-driven comptime** — No need to mark code as compile-time; the compiler figures it out

**F# is the closest** — Type providers are mature and well-integrated, but require implementing a separate provider assembly.

**The common limitation** in other languages: They can generate the type definition, but cannot dynamically populate fields without hardcoding field names somewhere in the parsing code.