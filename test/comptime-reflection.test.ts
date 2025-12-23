/**
 * Tests for compile-time reflection builtins.
 */

import { describe, it, expect } from "vitest";
import {
  // Expressions
  varRef,
  call,
  fn,
  array,
  str,
  num,
  obj,
  field,

  // Constraints
  isArray,
  isObject,
  isString,
  isNumber,
  hasField,
  and,

  // Values
  typeVal,
  constraintOf,
  arrayVal,
  stringVal,
  numberVal,

  // Evaluator
  run,
  stage,
  isNow,
  isLater,
} from "../src/index";

// ============================================================================
// append() Tests
// ============================================================================

describe("append() builtin", () => {
  it("appends element to empty array", () => {
    const result = run(call(varRef("append"), array(), num(1)));
    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(1);
    expect(arr.elements[0].value).toBe(1);
  });

  it("appends element to non-empty array", () => {
    const result = run(call(varRef("append"), array(num(1), num(2)), num(3)));
    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(3);
    expect(arr.elements.map((e: any) => e.value)).toEqual([1, 2, 3]);
  });

  it("appends string to array", () => {
    const result = run(call(varRef("append"), array(str("a")), str("b")));
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(2);
    expect(arr.elements.map((e: any) => e.value)).toEqual(["a", "b"]);
  });

  it("works with nested append calls", () => {
    const result = run(
      call(varRef("append"),
        call(varRef("append"),
          call(varRef("append"), array(), num(1)),
          num(2)
        ),
        num(3)
      )
    );
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(3);
    expect(arr.elements.map((e: any) => e.value)).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// comptimeFold() Tests
// ============================================================================

describe("comptimeFold() builtin", () => {
  it("folds over empty array returning init", () => {
    const result = run(
      call(varRef("comptimeFold"),
        array(),
        num(0),
        fn(["acc", "elem"], varRef("acc"))
      )
    );
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(0);
  });

  it("builds array using append", () => {
    const result = run(
      call(varRef("comptimeFold"),
        array(str("a"), str("b"), str("c")),
        array(),
        fn(["acc", "elem"],
          call(varRef("append"), varRef("acc"), varRef("elem"))
        )
      )
    );
    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(3);
    expect(arr.elements.map((e: any) => e.value)).toEqual(["a", "b", "c"]);
  });

  it("builds array of pairs with comptimeFold", () => {
    // fold over ["x", "y"], building [["x", 42], ["y", 42]]
    // This simulates building entries for objectFromEntries
    const result = run(
      call(varRef("comptimeFold"),
        array(str("x"), str("y")),
        array(),
        fn(["acc", "elem"],
          call(varRef("append"),
            varRef("acc"),
            array(varRef("elem"), num(42))
          )
        )
      )
    );
    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(2);
    // First entry is ["x", 42]
    expect(arr.elements[0].tag).toBe("array");
    expect(arr.elements[0].elements[0].value).toBe("x");
    expect(arr.elements[0].elements[1].value).toBe(42);
  });
});

// ============================================================================
// objectFromEntries() Tests
// ============================================================================

describe("objectFromEntries() builtin", () => {
  it("builds empty object from empty array", () => {
    const result = run(call(varRef("objectFromEntries"), array()));
    expect(result.value.tag).toBe("object");
    const o = result.value as { tag: "object"; fields: Map<string, any> };
    expect(o.fields.size).toBe(0);
  });

  it("builds object from single entry", () => {
    const result = run(
      call(varRef("objectFromEntries"),
        array(array(str("name"), str("Alice")))
      )
    );
    expect(result.value.tag).toBe("object");
    const o = result.value as { tag: "object"; fields: Map<string, any> };
    expect(o.fields.get("name")?.value).toBe("Alice");
  });

  it("builds object from multiple entries", () => {
    const result = run(
      call(varRef("objectFromEntries"),
        array(
          array(str("x"), num(10)),
          array(str("y"), num(20))
        )
      )
    );
    expect(result.value.tag).toBe("object");
    const o = result.value as { tag: "object"; fields: Map<string, any> };
    expect(o.fields.get("x")?.value).toBe(10);
    expect(o.fields.get("y")?.value).toBe(20);
  });

  it("works with comptimeFold to build entries", () => {
    // Build entries using comptimeFold, then convert to object
    const result = run(
      call(varRef("objectFromEntries"),
        call(varRef("comptimeFold"),
          array(str("a"), str("b")),
          array(),
          fn(["acc", "elem"],
            call(varRef("append"),
              varRef("acc"),
              array(varRef("elem"), num(1))
            )
          )
        )
      )
    );
    expect(result.value.tag).toBe("object");
    const o = result.value as { tag: "object"; fields: Map<string, any> };
    expect(o.fields.get("a")?.value).toBe(1);
    expect(o.fields.get("b")?.value).toBe(1);
  });
});

// ============================================================================
// dynamicField() Tests
// ============================================================================

describe("dynamicField() builtin", () => {
  it("accesses field on known object", () => {
    const result = run(
      call(varRef("dynamicField"),
        obj({ name: str("Alice"), age: num(30) }),
        str("name")
      )
    );
    expect(result.value.tag).toBe("string");
    expect((result.value as any).value).toBe("Alice");
  });

  it("accesses numeric field on known object", () => {
    const result = run(
      call(varRef("dynamicField"),
        obj({ x: num(10), y: num(20) }),
        str("y")
      )
    );
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(20);
  });

  it("works on dynamically constructed object", () => {
    // Build an object using objectFromEntries, then access a field
    const result = run(
      call(varRef("dynamicField"),
        call(varRef("objectFromEntries"),
          array(
            array(str("foo"), num(100)),
            array(str("bar"), num(200))
          )
        ),
        str("bar")
      )
    );
    expect(result.value.tag).toBe("number");
    expect((result.value as any).value).toBe(200);
  });
});

// ============================================================================
// Integration: Type-Directed Object Building
// ============================================================================

describe("Integration: Type-Directed Object Building", () => {
  it("uses fields() with comptimeFold to iterate type fields", () => {
    // Create a type with fields
    const personType = typeVal(and(
      isObject,
      hasField("name", isString),
      hasField("age", isNumber)
    ));

    // Get field names and fold over them
    const result = run(
      call(varRef("comptimeFold"),
        call(varRef("fields"), varRef("PersonType")),
        array(),
        fn(["acc", "f"],
          call(varRef("append"), varRef("acc"), varRef("f"))
        )
      ),
      { PersonType: { value: personType, constraint: constraintOf(personType) } }
    );

    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    expect(arr.elements.length).toBe(2);
    const names = arr.elements.map((e: any) => e.value);
    expect(names).toContain("name");
    expect(names).toContain("age");
  });

  it("builds object from type fields using comptimeFold + objectFromEntries + dynamicField", () => {
    // This is the JSON serializer pattern:
    // Given a type T and a value v, build an object with the same fields as T
    // by iterating over fields(T) at compile time

    const personType = typeVal(and(
      isObject,
      hasField("name", isString),
      hasField("age", isNumber)
    ));

    // Create a person value (need to run() to get the Value, not Expr)
    const personExpr = obj({ name: str("Alice"), age: num(30) });
    const personValue = run(personExpr).value;

    // The pattern: objectFromEntries(comptimeFold(fields(T), [], fn(acc, f) => append(acc, [f, dynamicField(value, f)])))
    const result = run(
      call(varRef("objectFromEntries"),
        call(varRef("comptimeFold"),
          call(varRef("fields"), varRef("PersonType")),
          array(),
          fn(["acc", "f"],
            call(varRef("append"),
              varRef("acc"),
              array(
                varRef("f"),
                call(varRef("dynamicField"), varRef("person"), varRef("f"))
              )
            )
          )
        )
      ),
      {
        PersonType: { value: personType, constraint: constraintOf(personType) },
        person: { value: personValue, constraint: and(isObject, hasField("name", isString), hasField("age", isNumber)) }
      }
    );

    expect(result.value.tag).toBe("object");
    const o = result.value as { tag: "object"; fields: Map<string, any> };
    expect(o.fields.get("name")?.value).toBe("Alice");
    expect(o.fields.get("age")?.value).toBe(30);
  });
});

// ============================================================================
// JSON Serializer Example
// ============================================================================

describe("JSON Serializer Pattern", () => {
  it("demonstrates makeSerializer pattern", () => {
    // This test demonstrates the full JSON serializer pattern
    // where we create a higher-order function that generates
    // specialized serializers for any type

    const personType = typeVal(and(
      isObject,
      hasField("name", isString),
      hasField("age", isNumber)
    ));

    // makeSerializer(T) returns a function that takes a value and
    // produces an object with the same fields, extracted from the value
    // This is compile-time code generation!
    //
    // In the language syntax:
    // let makeSerializer = fn(T) =>
    //   fn(value) =>
    //     objectFromEntries(
    //       comptimeFold(fields(T), [], fn(acc, f) =>
    //         append(acc, [f, dynamicField(value, f)])
    //       )
    //     )

    const makeSerializer =
      fn(["T"],
        fn(["value"],
          call(varRef("objectFromEntries"),
            call(varRef("comptimeFold"),
              call(varRef("fields"), varRef("T")),
              array(),
              fn(["acc", "f"],
                call(varRef("append"),
                  varRef("acc"),
                  array(
                    varRef("f"),
                    call(varRef("dynamicField"), varRef("value"), varRef("f"))
                  )
                )
              )
            )
          )
        )
      );

    // First, evaluate makeSerializer to get the function
    const makeSerializerResult = run(makeSerializer);
    expect(makeSerializerResult.value.tag).toBe("closure");

    // Now call makeSerializer(PersonType) to get a personSerializer
    const personSerializerExpr = call(makeSerializer, varRef("PersonType"));
    const personSerializerResult = run(personSerializerExpr, {
      PersonType: { value: personType, constraint: constraintOf(personType) }
    });
    expect(personSerializerResult.value.tag).toBe("closure");

    // Finally, call personSerializer with an actual person value
    const alice = obj({ name: str("Alice"), age: num(30) });
    const serializeAliceExpr = call(
      call(makeSerializer, varRef("PersonType")),
      varRef("alice")
    );

    const serializeResult = run(serializeAliceExpr, {
      PersonType: { value: personType, constraint: constraintOf(personType) },
      alice: { value: run(alice).value, constraint: and(isObject, hasField("name", isString), hasField("age", isNumber)) }
    });

    expect(serializeResult.value.tag).toBe("object");
    const o = serializeResult.value as { tag: "object"; fields: Map<string, any> };
    expect(o.fields.get("name")?.value).toBe("Alice");
    expect(o.fields.get("age")?.value).toBe(30);
  });

  it("demonstrates compile-time specialization with staged evaluation", () => {
    // This test shows how the serializer works with staging
    // When the type is known at compile time but value is runtime,
    // we generate specialized code

    const personType = typeVal(and(
      isObject,
      hasField("name", isString),
      hasField("age", isNumber)
    ));

    // Test that staging a simple serializer pattern works
    // Here we're just checking that comptimeFold iterates at compile time
    // and generates the right result
    const result = run(
      call(varRef("comptimeFold"),
        call(varRef("fields"), varRef("PersonType")),
        array(),
        fn(["acc", "f"],
          call(varRef("append"), varRef("acc"), varRef("f"))
        )
      ),
      {
        PersonType: { value: personType, constraint: constraintOf(personType) }
      }
    );

    // Should have collected field names at compile time
    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    const names = arr.elements.map((e: any) => e.value);
    expect(names).toContain("name");
    expect(names).toContain("age");
  });
});
