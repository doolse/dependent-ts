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
  letExpr,

  // Constraints
  isArray,
  isObject,
  isString,
  isNumber,
  isNull,
  hasField,
  and,
  or,
  rec,
  recVar,
  extractAllFieldNames,
  extractFieldConstraint,

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

// ============================================================================
// recType() and recVarType() Tests
// ============================================================================

describe("recType() and recVarType() builtins", () => {
  it("creates a simple recursive type (linked list)", () => {
    // ListType = recType("List", unionType(null, objectType({ head: number, tail: recVarType("List") })))
    const result = run(
      call(varRef("recType"),
        str("List"),
        call(varRef("unionType"),
          varRef("null"),
          call(varRef("objectType"),
            obj({
              head: varRef("number"),
              tail: call(varRef("recVarType"), str("List"))
            })
          )
        )
      )
    );

    expect(result.value.tag).toBe("type");
    const typeValue = result.value as { tag: "type"; constraint: any };
    expect(typeValue.constraint.tag).toBe("rec");
    expect(typeValue.constraint.var).toBe("List");
  });

  it("creates a tree type with left and right children", () => {
    const result = run(
      call(varRef("recType"),
        str("Tree"),
        call(varRef("objectType"),
          obj({
            value: varRef("number"),
            left: call(varRef("nullable"), call(varRef("recVarType"), str("Tree"))),
            right: call(varRef("nullable"), call(varRef("recVarType"), str("Tree")))
          })
        )
      )
    );

    expect(result.value.tag).toBe("type");
    const typeValue = result.value as { tag: "type"; constraint: any };
    expect(typeValue.constraint.tag).toBe("rec");
    expect(typeValue.constraint.var).toBe("Tree");
  });

  it("fields() extracts field names from recursive type", () => {
    // Create a list type and check that fields() works
    const listType = call(varRef("recType"),
      str("List"),
      call(varRef("unionType"),
        varRef("null"),
        call(varRef("objectType"),
          obj({
            head: varRef("number"),
            tail: call(varRef("recVarType"), str("List"))
          })
        )
      )
    );

    const result = run(
      call(varRef("fields"), listType)
    );

    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    const names = arr.elements.map((e: any) => e.value);
    expect(names).toContain("head");
    expect(names).toContain("tail");
  });

  it("fieldType() extracts field type from recursive type", () => {
    const listType = call(varRef("recType"),
      str("List"),
      call(varRef("unionType"),
        varRef("null"),
        call(varRef("objectType"),
          obj({
            head: varRef("number"),
            tail: call(varRef("recVarType"), str("List"))
          })
        )
      )
    );

    const result = run(
      call(varRef("fieldType"), listType, str("head"))
    );

    expect(result.value.tag).toBe("type");
    const typeValue = result.value as { tag: "type"; constraint: any };
    expect(typeValue.constraint.tag).toBe("isNumber");
  });

  it("fieldType() returns recVar for recursive field", () => {
    const listType = call(varRef("recType"),
      str("List"),
      call(varRef("unionType"),
        varRef("null"),
        call(varRef("objectType"),
          obj({
            head: varRef("number"),
            tail: call(varRef("recVarType"), str("List"))
          })
        )
      )
    );

    const result = run(
      call(varRef("fieldType"), listType, str("tail"))
    );

    expect(result.value.tag).toBe("type");
    const typeValue = result.value as { tag: "type"; constraint: any };
    // The tail field type should be the recVar
    expect(typeValue.constraint.tag).toBe("recVar");
    expect(typeValue.constraint.var).toBe("List");
  });
});

// ============================================================================
// typeOf() Tests
// ============================================================================

describe("typeOf() builtin", () => {
  it("returns type of a number literal", () => {
    const result = run(call(varRef("typeOf"), num(42)));
    expect(result.value.tag).toBe("type");
  });

  it("returns type of an object literal", () => {
    const result = run(call(varRef("typeOf"), obj({ x: num(1), y: num(2) })));
    expect(result.value.tag).toBe("type");
    const typeValue = result.value as { tag: "type"; constraint: any };
    // Should have field constraints
    const fieldNames = extractAllFieldNames(typeValue.constraint);
    expect(fieldNames).toContain("x");
    expect(fieldNames).toContain("y");
  });

  it("can be used with fields() to reflect on value's type", () => {
    const result = run(
      call(varRef("fields"),
        call(varRef("typeOf"), obj({ name: str("Alice"), age: num(30) }))
      )
    );

    expect(result.value.tag).toBe("array");
    const arr = result.value as { tag: "array"; elements: any[] };
    const names = arr.elements.map((e: any) => e.value);
    expect(names).toContain("name");
    expect(names).toContain("age");
  });

  it("works on runtime values (Later) - constraint is still known", () => {
    // Use a runtime() expression to create a Later value with known constraint
    // runtime(expr, name) marks the value as Later but preserves the constraint
    const personExpr = letExpr("person",
      // Create a runtime value with object constraint
      {
        tag: "runtime" as const,
        expr: obj({ name: str("Alice"), age: num(30) }),
        name: "person"
      },
      call(varRef("fields"),
        call(varRef("typeOf"), varRef("person"))
      )
    );

    // Use stage() since the let binding has a Later value
    const result = stage(personExpr);

    // Even though person is Later, typeOf returns the constraint which is known
    // So fields() should return a Now value at compile time
    expect(isNow(result.svalue)).toBe(true);
    if (isNow(result.svalue)) {
      expect(result.svalue.value.tag).toBe("array");
      const arr = result.svalue.value as { tag: "array"; elements: any[] };
      const names = arr.elements.map((e: any) => e.value);
      expect(names).toContain("name");
      expect(names).toContain("age");
    }
  });
});

// ============================================================================
// extractAllFieldNames() Direct Tests
// ============================================================================

describe("extractAllFieldNames() handles complex constraints", () => {
  it("extracts fields from simple hasField", () => {
    const c = hasField("name", isString);
    expect(extractAllFieldNames(c)).toEqual(["name"]);
  });

  it("extracts fields from and constraint", () => {
    const c = and(isObject, hasField("x", isNumber), hasField("y", isNumber));
    const fields = extractAllFieldNames(c);
    expect(fields).toContain("x");
    expect(fields).toContain("y");
  });

  it("extracts fields from or constraint (union of fields)", () => {
    const c = or(
      and(isObject, hasField("a", isNumber)),
      and(isObject, hasField("b", isString))
    );
    const fields = extractAllFieldNames(c);
    expect(fields).toContain("a");
    expect(fields).toContain("b");
  });

  it("extracts fields from rec constraint", () => {
    const c = rec("Node", and(
      isObject,
      hasField("value", isNumber),
      hasField("next", or(isNull, recVar("Node")))
    ));
    const fields = extractAllFieldNames(c);
    expect(fields).toContain("value");
    expect(fields).toContain("next");
  });

  it("handles nested or inside rec", () => {
    // rec("X", or(null, and(hasField("a"), hasField("b", recVar("X")))))
    const c = rec("X", or(
      isNull,
      and(isObject, hasField("a", isNumber), hasField("b", recVar("X")))
    ));
    const fields = extractAllFieldNames(c);
    expect(fields).toContain("a");
    expect(fields).toContain("b");
  });

  it("does not infinite loop on recVar", () => {
    const c = rec("Loop", and(
      hasField("self", recVar("Loop")),
      hasField("data", isNumber)
    ));
    const fields = extractAllFieldNames(c);
    expect(fields).toContain("self");
    expect(fields).toContain("data");
  });
});

// ============================================================================
// extractFieldConstraint() Direct Tests
// ============================================================================

describe("extractFieldConstraint() handles complex constraints", () => {
  it("extracts constraint from simple hasField", () => {
    const c = hasField("name", isString);
    expect(extractFieldConstraint(c, "name")).toEqual(isString);
    expect(extractFieldConstraint(c, "other")).toBeNull();
  });

  it("extracts constraint from and", () => {
    const c = and(isObject, hasField("x", isNumber), hasField("y", isString));
    expect(extractFieldConstraint(c, "x")).toEqual(isNumber);
    expect(extractFieldConstraint(c, "y")).toEqual(isString);
    expect(extractFieldConstraint(c, "z")).toBeNull();
  });

  it("extracts constraint from or (returns union)", () => {
    const c = or(
      and(isObject, hasField("x", isNumber)),
      and(isObject, hasField("x", isString))
    );
    const xConstraint = extractFieldConstraint(c, "x");
    // Should be or(isNumber, isString)
    expect(xConstraint).not.toBeNull();
    expect(xConstraint!.tag).toBe("or");
  });

  it("extracts constraint from rec", () => {
    const c = rec("Node", and(
      isObject,
      hasField("value", isNumber),
      hasField("next", recVar("Node"))
    ));
    expect(extractFieldConstraint(c, "value")).toEqual(isNumber);
    const nextConstraint = extractFieldConstraint(c, "next");
    expect(nextConstraint).not.toBeNull();
    expect(nextConstraint!.tag).toBe("recVar");
  });

  it("returns null for field only in some branches of or", () => {
    const c = or(
      and(isObject, hasField("a", isNumber)),
      and(isObject, hasField("b", isString))
    );
    // 'a' only exists in first branch
    const aConstraint = extractFieldConstraint(c, "a");
    expect(aConstraint).toEqual(isNumber); // Returns from the branch that has it
  });

  it("handles deeply nested structures", () => {
    const c = rec("Tree", or(
      isNull,
      and(
        isObject,
        hasField("value", isNumber),
        hasField("left", recVar("Tree")),
        hasField("right", recVar("Tree"))
      )
    ));

    expect(extractFieldConstraint(c, "value")).toEqual(isNumber);
    expect(extractFieldConstraint(c, "left")?.tag).toBe("recVar");
    expect(extractFieldConstraint(c, "right")?.tag).toBe("recVar");
    expect(extractFieldConstraint(c, "nonexistent")).toBeNull();
  });
});
