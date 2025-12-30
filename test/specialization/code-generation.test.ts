/**
 * Code Generation Tests
 *
 * Tests for specialization in code generation scenarios - generating
 * specialized queries, form inputs, API calls, etc. based on type schemas.
 */

import { describe, it, expect } from "vitest";
import { parse, compile, parseAndRun, stage, isNow, isLater } from "../../src/index";

describe("Code Generation Specialization", () => {
  describe("Query builder generation", () => {
    it("specializes SELECT query based on type fields", () => {
      const code = compile(parse(`
        let select = fn(T) =>
          let fieldNames = fields(comptime(T)) in
          let fieldList = comptimeFold(fieldNames, "", fn(acc, f) =>
            if acc == "" then f else acc + ", " + f
          ) in
          "SELECT " + fieldList
        in
        let UserType = objectType({ id: number, name: string, email: string }) in
        let ProductType = objectType({ id: number, title: string, price: number }) in
        [select(UserType), select(ProductType)]
      `));

      // Fully computed at compile time - results are literal strings
      expect(code).toContain("SELECT id, name, email");
      expect(code).toContain("SELECT id, title, price");
    });

    it("generates insert query with correct columns", () => {
      const code = compile(parse(`
        let insert = fn(T, tableName) =>
          let table = comptime(tableName) in
          let fieldNames = fields(comptime(T)) in
          let cols = comptimeFold(fieldNames, "", fn(acc, f) =>
            if acc == "" then f else acc + ", " + f
          ) in
          let placeholders = comptimeFold(fieldNames, "", fn(acc, f) =>
            if acc == "" then "?" else acc + ", ?"
          ) in
          "INSERT INTO " + table + " (" + cols + ") VALUES (" + placeholders + ")"
        in
        let UserType = objectType({ name: string, email: string }) in
        insert(UserType, "users")
      `));

      expect(code).toContain("INSERT INTO");
      expect(code).toContain("users");
    });
  });

  describe("Form input generation", () => {
    it("specializes form field based on field type", () => {
      const code = compile(parse(`
        let inputType = fn(T) =>
          let t = comptime(T) in
          if t == number then "number"
          else if t == string then "text"
          else if t == boolean then "checkbox"
          else "text"
        in
        [inputType(number), inputType(string), inputType(boolean)]
      `));

      // Fully computed at compile time - results are literal array
      expect(code).toContain('"number"');
      expect(code).toContain('"text"');
      expect(code).toContain('"checkbox"');
    });

    it("generates form config from schema", () => {
      const code = compile(parse(`
        let fieldConfig = fn(fieldType, fieldName) =>
          let t = comptime(fieldType) in
          let name = comptime(fieldName) in
          if t == number then
            { name: name, type: "number", min: 0 }
          else if t == string then
            { name: name, type: "text", maxLength: 255 }
          else
            { name: name, type: "text" }
        in
        let nameConfig = fieldConfig(string, "name") in
        let ageConfig = fieldConfig(number, "age") in
        [nameConfig, ageConfig]
      `));

      // Fully computed at compile time - configs are inlined as object literals
      expect(code).toContain("nameConfig");
      expect(code).toContain("ageConfig");
    });
  });

  describe("API client generation", () => {
    it("specializes fetch wrapper based on response type", () => {
      const code = compile(parse(`
        let fetchAs = fn(T, url) =>
          let responseType = comptime(T) in
          let endpoint = comptime(url) in
          if responseType == string then
            "fetch('" + endpoint + "').then(r => r.text())"
          else if responseType == number then
            "fetch('" + endpoint + "').then(r => r.json())"
          else
            "fetch('" + endpoint + "').then(r => r.json())"
        in
        fetchAs(string, "/api/name")
      `));

      expect(code).toContain("fetch");
      expect(code).toContain("/api/name");
    });

    it("generates typed API endpoints", () => {
      const code = compile(parse(`
        let endpoint = fn(method, path) =>
          let m = comptime(method) in
          let p = comptime(path) in
          { method: m, path: p }
        in
        let getUsers = endpoint("GET", "/users") in
        let createUser = endpoint("POST", "/users") in
        [getUsers, createUser]
      `));

      // Fully computed at compile time - endpoints are variable references
      expect(code).toContain("getUsers");
      expect(code).toContain("createUser");
    });
  });

  describe("Serialization code generation", () => {
    it("handles type marker with comptime and parameter lifting", () => {
      // Use an object with a comptime marker instead of type parameter
      const code = compile(parse(`
        let serializeField = fn(item) =>
          let t = comptime(item.type) in
          if t == "number" then { type: "number", val: item.val }
          else if t == "string" then { type: "string", val: item.val }
          else { type: "other" }
        in
        let n = { type: "number", val: trust(runtime(n: 42), number) } in
        let s = { type: "string", val: trust(runtime(s: "hi"), string) } in
        [serializeField(n), serializeField(s)]
      `));

      // With comptime(item.type), branches are eliminated and values are lifted to parameters
      // The function is not specialized but the comptime values are extracted
      expect(code).toContain("serializeField");
      expect(code).toContain('"number"');
      expect(code).toContain('"string"');
    });

    it("generates string representation based on type", () => {
      const code = compile(parse(`
        let typeToString = fn(T) =>
          let t = comptime(T) in
          if t == number then "number"
          else if t == string then "string"
          else "unknown"
        in
        [typeToString(number), typeToString(string)]
      `));

      // Fully computed at compile time
      expect(code).toContain('"number"');
      expect(code).toContain('"string"');
    });
  });

  describe("Parser generation", () => {
    it("specializes parser tag based on expected type", () => {
      // Using let t = comptime(T) we can specialize on the type
      const code = compile(parse(`
        let getTypeTag = fn(T) =>
          let t = comptime(T) in
          if t == number then "number"
          else if t == boolean then "boolean"
          else "string"
        in
        [getTypeTag(number), getTypeTag(boolean), getTypeTag(string)]
      `));

      // Fully computed at compile time
      expect(code).toContain('"number"');
      expect(code).toContain('"boolean"');
      expect(code).toContain('"string"');
    });
  });

  describe("Template generation", () => {
    it("handles template with comptime and parameter lifting", () => {
      // Use an object with a comptime marker
      const code = compile(parse(`
        let template = fn(item) =>
          let t = comptime(item.type) in
          if t == "number" then
            { class: "number", value: item.data }
          else if t == "string" then
            { class: "text", value: item.data }
          else
            { class: "unknown" }
        in
        let n = { type: "number", data: trust(runtime(n: 42), number) } in
        let s = { type: "string", data: trust(runtime(s: "hello"), string) } in
        [template(n), template(s)]
      `));

      // With comptime(item.type), branches are eliminated and values are lifted to parameters
      expect(code).toContain("template");
      expect(code).toContain('"number"');
      expect(code).toContain('"text"');
    });

    it("generates template with dynamic field lookup", () => {
      const code = compile(parse(`
        let renderField = fn(fieldName, obj) =>
          let f = comptime(fieldName) in
          { field: f, value: dynamicField(obj, f) }
        in
        let obj = trust(runtime(o: { name: "Alice" }),
                       objectType({ name: string })) in
        renderField("name", obj)
      `));

      expect(code).toContain("renderField");
    });
  });

  describe("Schema-driven factories", () => {
    it("generates factory function from type", () => {
      const code = compile(parse(`
        let makeDefault = fn(T) =>
          let t = comptime(T) in
          if t == number then 0
          else if t == string then ""
          else if t == boolean then false
          else null
        in
        [makeDefault(number), makeDefault(string), makeDefault(boolean)]
      `));

      // Fully computed at compile time - results are literal values
      expect(code).toContain("[0");
      expect(code).toContain('""');
      expect(code).toContain("false");
    });

    it("generates object factory from schema", () => {
      const code = compile(parse(`
        let createEmpty = fn(T) =>
          let fieldNames = fields(comptime(T)) in
          objectFromEntries(
            comptimeFold(fieldNames, [], fn(acc, f) =>
              let fieldT = fieldType(comptime(T), f) in
              let defaultVal = if fieldT == number then 0
                              else if fieldT == string then ""
                              else null in
              append(acc, [f, defaultVal])
            )
          )
        in
        let UserType = objectType({ name: string, age: number }) in
        createEmpty(UserType)
      `));

      // Fully computed at compile time - result is literal object
      expect(code).toContain('name:');
      expect(code).toContain('age:');
    });
  });

  describe("Event handler generation", () => {
    it("generates event handler based on event schema", () => {
      const code = compile(parse(`
        let makeHandler = fn(eventType) =>
          let t = comptime(eventType) in
          if t == "click" then
            fn(e) => { type: "click", x: e.x, y: e.y }
          else if t == "input" then
            fn(e) => { type: "input", value: e.value }
          else
            fn(e) => { type: "unknown" }
        in
        let clickHandler = makeHandler("click") in
        let inputHandler = makeHandler("input") in
        let clickEvent = trust(runtime(e: { x: 10, y: 20 }),
                              objectType({ x: number, y: number })) in
        let inputEvent = trust(runtime(e: { value: "hello" }),
                              objectType({ value: string })) in
        [clickHandler(clickEvent), inputHandler(inputEvent)]
      `));

      expect(code).toContain("clickHandler");
      expect(code).toContain("inputHandler");
    });
  });

  describe("Lens generation", () => {
    it("generates getter from field name", () => {
      const code = compile(parse(`
        let getter = fn(fieldName) =>
          fn(obj) =>
            let f = comptime(fieldName) in
            dynamicField(obj, f)
        in
        let getName = getter("name") in
        let getAge = getter("age") in
        let person = trust(runtime(p: { name: "Alice", age: 30 }),
                          objectType({ name: string, age: number })) in
        [getName(person), getAge(person)]
      `));

      expect(code).toContain("getName");
      expect(code).toContain("getAge");
    });

    it("generates value wrapper from field name", () => {
      // Note: Spread syntax {...obj} is not supported, so we test a simpler pattern
      const code = compile(parse(`
        let wrapper = fn(fieldName) =>
          fn(value) =>
            let f = comptime(fieldName) in
            { field: f, value: value }
        in
        let wrapName = wrapper("name") in
        let newName = trust(runtime(n: "Bob"), string) in
        wrapName(newName)
      `));

      expect(code).toContain("wrapName");
    });
  });

  describe("Runtime correctness", () => {
    it("generates correct field list", () => {
      const result = parseAndRun(`
        let fieldList = fn(T) =>
          let fieldNames = fields(T) in
          comptimeFold(fieldNames, "", fn(acc, f) =>
            if acc == "" then f else acc + ", " + f
          )
        in
        fieldList(objectType({ a: number, b: string, c: boolean }))
      `);

      expect(result.value.tag).toBe("string");
      const str = (result.value as any).value;
      expect(str).toContain("a");
      expect(str).toContain("b");
      expect(str).toContain("c");
    });

    it("serializes number correctly", () => {
      const result = parseAndRun(`
        let serialize = fn(T, val) =>
          if T == number then val.toString()
          else val
        in
        serialize(number, 42)
      `);

      expect(result.value.tag).toBe("string");
      expect((result.value as any).value).toBe("42");
    });

    it("creates default object correctly", () => {
      const result = parseAndRun(`
        let createDefault = fn(T) =>
          objectFromEntries(
            comptimeFold(fields(T), [], fn(acc, f) =>
              let ft = fieldType(T, f) in
              let def = if ft == number then 0 else "" in
              append(acc, [f, def])
            )
          )
        in
        createDefault(objectType({ count: number, name: string }))
      `);

      expect(result.value.tag).toBe("object");
      const obj = result.value as any;
      expect(obj.fields.get("count").value).toBe(0);
      expect(obj.fields.get("name").value).toBe("");
    });
  });

  describe("Complex code generation patterns", () => {
    it("generates type-aware field list at compile time", () => {
      // Test using fields() with comptime to get field names at compile time
      const code = compile(parse(`
        let fieldList = fn(T) =>
          let names = fields(comptime(T)) in
          comptimeFold(names, "", fn(acc, f) =>
            if acc == "" then f else acc + ", " + f
          )
        in
        let userFields = fieldList(objectType({ name: string, age: number })) in
        userFields
      `));

      // Fully computed at compile time
      expect(code).toContain("name");
      expect(code).toContain("age");
    });
  });
});
