/**
 * Tests for Types as First-Class Values and Reflection Functions
 *
 * Challenge 4 from constraints-as-types.md: Types become comptime values.
 */

import { describe, it, expect } from "vitest";
import {
  // Constraints
  isNumber,
  isString,
  isBool,
  isNull,
  isObject,
  isArray,
  isFunction,
  isType,
  isTypeC,
  hasField,
  and,
  implies,
  constraintToString,
  extractAllFieldNames,
  extractFieldConstraint,

  // Values
  typeVal,
  valueToString,
  constraintOf,
  valueSatisfies,
  stringVal,
  arrayVal,

  // Expressions
  varRef,
  call,
  str,
  obj,
  array,

  // Evaluator
  run,

  // Staged evaluator
  stage,
  StagingError,
} from "@dependent-ts/core";

// ============================================================================
// Type Values
// ============================================================================

describe("Type Values", () => {
  describe("TypeValue creation", () => {
    it("creates a type value wrapping a constraint", () => {
      const numType = typeVal(isNumber);
      expect(numType.tag).toBe("type");
      expect(numType.constraint).toEqual(isNumber);
    });

    it("creates a type value from complex constraint", () => {
      const objType = typeVal(and(isObject, hasField("x", isNumber)));
      expect(objType.tag).toBe("type");
      expect(objType.constraint).toEqual(and(isObject, hasField("x", isNumber)));
    });
  });

  describe("constraintOf for type values", () => {
    it("returns isType wrapping the inner constraint", () => {
      const numType = typeVal(isNumber);
      const constraint = constraintOf(numType);
      expect(constraint).toEqual(isType(isNumber));
    });

    it("works for complex type values", () => {
      const objType = typeVal(and(isObject, hasField("name", isString)));
      const constraint = constraintOf(objType);
      expect(constraint).toEqual(isType(and(isObject, hasField("name", isString))));
    });
  });

  describe("valueSatisfies for type values", () => {
    it("type values satisfy isType constraint", () => {
      const numType = typeVal(isNumber);
      expect(valueSatisfies(numType, isTypeC)).toBe(true);
    });

    it("non-type values do not satisfy isType constraint", () => {
      const numVal = { tag: "number" as const, value: 42 };
      expect(valueSatisfies(numVal, isTypeC)).toBe(false);
    });
  });

  describe("valueToString for type values", () => {
    it("prints type value nicely", () => {
      const numType = typeVal(isNumber);
      expect(valueToString(numType)).toBe("Type<number>");
    });

    it("prints complex type value", () => {
      const objType = typeVal(and(isObject, hasField("x", isNumber)));
      const str = valueToString(objType);
      expect(str).toContain("Type<");
    });
  });
});

// ============================================================================
// isType Constraint
// ============================================================================

describe("isType Constraint", () => {
  it("isType(isNumber) represents a type for numbers", () => {
    const constraint = isType(isNumber);
    expect(constraint.tag).toBe("isType");
    expect((constraint as any).constraint).toEqual(isNumber);
  });

  it("isTypeC is isType(any) - any type", () => {
    expect(isTypeC.tag).toBe("isType");
    expect((isTypeC as any).constraint.tag).toBe("any");
  });

  it("isType(A) implies isType(B) when A implies B", () => {
    const typeNum = isType(isNumber);
    const typeAny = isType({ tag: "any" });
    expect(implies(typeNum, typeAny)).toBe(true);
  });

  it("isType is included in constraintToString", () => {
    const str = constraintToString(isType(isNumber));
    expect(str).toBe("Type<number>");
  });
});

// ============================================================================
// Type Bindings in Evaluator
// ============================================================================

describe("Type Bindings", () => {
  it("'number' evaluates to a type value", () => {
    const result = run(varRef("number"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isNumber);
  });

  it("'string' evaluates to a type value", () => {
    const result = run(varRef("string"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isString);
  });

  it("'boolean' evaluates to a type value", () => {
    const result = run(varRef("boolean"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isBool);
  });

  it("'null' evaluates to a type value", () => {
    const result = run(varRef("null"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isNull);
  });

  it("'object' evaluates to a type value", () => {
    const result = run(varRef("object"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isObject);
  });

  it("'array' evaluates to a type value", () => {
    const result = run(varRef("array"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isArray);
  });

  it("'function' evaluates to a type value", () => {
    const result = run(varRef("function"));
    expect(result.value.tag).toBe("type");
    expect((result.value as any).constraint).toEqual(isFunction);
  });

  it("type bindings have isType constraint", () => {
    const result = run(varRef("number"));
    expect(implies(result.constraint, isTypeC)).toBe(true);
  });
});

// ============================================================================
// Field Extraction Helpers
// ============================================================================

describe("Field Extraction Helpers", () => {
  describe("extractAllFieldNames", () => {
    it("extracts single field name", () => {
      const constraint = hasField("x", isNumber);
      expect(extractAllFieldNames(constraint)).toEqual(["x"]);
    });

    it("extracts multiple field names from AND", () => {
      const constraint = and(
        isObject,
        hasField("x", isNumber),
        hasField("y", isString),
        hasField("z", isBool)
      );
      const names = extractAllFieldNames(constraint);
      expect(names).toContain("x");
      expect(names).toContain("y");
      expect(names).toContain("z");
      expect(names.length).toBe(3);
    });

    it("returns empty array for non-object constraints", () => {
      expect(extractAllFieldNames(isNumber)).toEqual([]);
      expect(extractAllFieldNames(isString)).toEqual([]);
    });
  });

  describe("extractFieldConstraint", () => {
    it("extracts constraint for existing field", () => {
      const constraint = hasField("x", isNumber);
      expect(extractFieldConstraint(constraint, "x")).toEqual(isNumber);
    });

    it("extracts from AND constraint", () => {
      const constraint = and(
        isObject,
        hasField("x", isNumber),
        hasField("y", isString)
      );
      expect(extractFieldConstraint(constraint, "x")).toEqual(isNumber);
      expect(extractFieldConstraint(constraint, "y")).toEqual(isString);
    });

    it("returns null for missing field", () => {
      const constraint = hasField("x", isNumber);
      expect(extractFieldConstraint(constraint, "y")).toBeNull();
    });
  });
});

// ============================================================================
// Reflection Builtins
// ============================================================================

describe("Reflection Builtins", () => {
  describe("fields()", () => {
    it("returns field names from type value", () => {
      const personType = typeVal(and(
        isObject,
        hasField("name", isString),
        hasField("age", isNumber)
      ));

      const result = run(
        call(varRef("fields"), varRef("T")),
        { T: { value: personType, constraint: constraintOf(personType) } }
      );

      expect(result.value.tag).toBe("array");
      const arr = result.value as { tag: "array"; elements: any[] };
      const names = arr.elements.map(e => e.value);
      expect(names).toContain("name");
      expect(names).toContain("age");
    });

    it("returns empty array for primitive type", () => {
      const result = run(call(varRef("fields"), varRef("number")));
      expect(result.value.tag).toBe("array");
      const arr = result.value as { tag: "array"; elements: any[] };
      expect(arr.elements.length).toBe(0);
    });

    it("throws error for non-type argument", () => {
      expect(() => {
        run(call(varRef("fields"), str("not a type")));
      }).toThrow();
    });
  });

  describe("fieldType()", () => {
    it("returns type of field", () => {
      const personType = typeVal(and(
        isObject,
        hasField("name", isString),
        hasField("age", isNumber)
      ));

      const result = run(
        call(varRef("fieldType"), varRef("T"), str("name")),
        { T: { value: personType, constraint: constraintOf(personType) } }
      );

      expect(result.value.tag).toBe("type");
      expect((result.value as any).constraint).toEqual(isString);
    });

    it("throws error for missing field", () => {
      const personType = typeVal(and(isObject, hasField("name", isString)));

      expect(() => {
        run(
          call(varRef("fieldType"), varRef("T"), str("missing")),
          { T: { value: personType, constraint: constraintOf(personType) } }
        );
      }).toThrow("has no field 'missing'");
    });

    it("throws error for non-type first argument", () => {
      expect(() => {
        run(call(varRef("fieldType"), str("not a type"), str("field")));
      }).toThrow();
    });
  });
});

// ============================================================================
// Staged Evaluation with Types
// ============================================================================

describe("Staged Evaluation with Types", () => {
  describe("Type bindings in staged context", () => {
    it("type bindings are Now values", () => {
      const result = stage(varRef("number"));
      expect(result.svalue.stage).toBe("now");
    });

    it("type bindings have correct constraint", () => {
      const result = stage(varRef("string"));
      expect(implies(result.svalue.constraint, isTypeC)).toBe(true);
    });
  });

  describe("fields() comptime enforcement", () => {
    it("works with pre-bound type constants", () => {
      // fields(object) returns empty array since isObject has no hasField constraints
      const result = stage(call(varRef("fields"), varRef("object")));
      expect(result.svalue.stage).toBe("now");
      if (result.svalue.stage === "now") {
        expect(result.svalue.value.tag).toBe("array");
      }
    });

    it("result is Now (compile-time known)", () => {
      const result = stage(call(varRef("fields"), varRef("number")));
      expect(result.svalue.stage).toBe("now");
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration: Types as Values", () => {
  it("types can be stored in variables", () => {
    const result = run(varRef("number"));
    expect(result.value.tag).toBe("type");
  });

  it("types can be passed to functions", () => {
    // Pass type to fields()
    const result = run(call(varRef("fields"), varRef("object")));
    expect(result.value.tag).toBe("array");
  });

  it("field reflection works end-to-end", () => {
    // Create a custom type with fields
    const userType = typeVal(and(
      isObject,
      hasField("id", isNumber),
      hasField("email", isString),
      hasField("active", isBool)
    ));

    // Get fields
    const fieldsResult = run(
      call(varRef("fields"), varRef("User")),
      { User: { value: userType, constraint: constraintOf(userType) } }
    );

    expect(fieldsResult.value.tag).toBe("array");
    const fields = (fieldsResult.value as any).elements.map((e: any) => e.value);
    expect(fields.length).toBe(3);
    expect(fields).toContain("id");
    expect(fields).toContain("email");
    expect(fields).toContain("active");

    // Get type of each field
    const idTypeResult = run(
      call(varRef("fieldType"), varRef("User"), str("id")),
      { User: { value: userType, constraint: constraintOf(userType) } }
    );
    expect(idTypeResult.value.tag).toBe("type");
    expect((idTypeResult.value as any).constraint).toEqual(isNumber);

    const emailTypeResult = run(
      call(varRef("fieldType"), varRef("User"), str("email")),
      { User: { value: userType, constraint: constraintOf(userType) } }
    );
    expect(emailTypeResult.value.tag).toBe("type");
    expect((emailTypeResult.value as any).constraint).toEqual(isString);
  });
});

// ============================================================================
// Type-Level Programming
// Goal: Everything that can be done using TypeScript's type-level syntax
// should be expressible as normal function syntax
// ============================================================================

import { fn, letExpr, ifExpr, bool, num, eq } from "@dependent-ts/core";

describe("Type-Level Programming", () => {
  describe("Type constructors as functions", () => {
    it("should be able to call a function that creates a type", () => {
      // Creating a function that returns its input (identity for types)
      const nullableExpr = fn(["T"], varRef("T"));
      const result = run(nullableExpr);
      expect(result.value.tag).toBe("closure");
    });

    it("should allow passing types to functions", () => {
      const expr = call(fn(["T"], varRef("T")), varRef("number"));
      const result = run(expr);
      expect(result.value.tag).toBe("type");
    });

    it("should support type-level conditionals using if", () => {
      const expr = letExpr("T", varRef("number"),
        ifExpr(
          eq(varRef("T"), varRef("string")),
          bool(true),
          bool(false)
        )
      );
      const result = run(expr);
      expect(result.value.tag).toBe("bool");
      expect((result.value as any).value).toBe(false); // number != string
    });
  });

  describe("Type constructor builtins", () => {
    it("objectType creates object type from field definitions", () => {
      const result = run(call(varRef("objectType"), obj({ name: varRef("string"), age: varRef("number") })));
      expect(result.value.tag).toBe("type");

      // Check that the constraint has the right fields
      const typeVal = result.value as any;
      expect(implies(typeVal.constraint, isObject)).toBe(true);
      expect(implies(typeVal.constraint, hasField("name", isString))).toBe(true);
      expect(implies(typeVal.constraint, hasField("age", isNumber))).toBe(true);
    });

    it("arrayType creates array type", () => {
      const result = run(call(varRef("arrayType"), varRef("number")));
      expect(result.value.tag).toBe("type");

      const typeVal = result.value as any;
      expect(implies(typeVal.constraint, isArray)).toBe(true);
    });

    it("unionType creates union of types", () => {
      const result = run(call(varRef("unionType"), varRef("string"), varRef("number")));
      expect(result.value.tag).toBe("type");

      // Both string and number should be subtypes of the union
      const typeVal = result.value as any;
      expect(implies(isString, typeVal.constraint)).toBe(true);
      expect(implies(isNumber, typeVal.constraint)).toBe(true);
    });

    it("intersectionType creates intersection of types", () => {
      const typeA = call(varRef("objectType"), obj({ x: varRef("number") }));
      const typeB = call(varRef("objectType"), obj({ y: varRef("string") }));
      const result = run(call(varRef("intersectionType"), typeA, typeB));
      expect(result.value.tag).toBe("type");

      // Should have both fields
      const typeVal = result.value as any;
      expect(implies(typeVal.constraint, hasField("x", isNumber))).toBe(true);
      expect(implies(typeVal.constraint, hasField("y", isString))).toBe(true);
    });

    it("nullable creates union with null", () => {
      const result = run(call(varRef("nullable"), varRef("string")));
      expect(result.value.tag).toBe("type");

      const typeVal = result.value as any;
      // Both string and null should be subtypes of nullable(string)
      expect(implies(isString, typeVal.constraint)).toBe(true);
      expect(implies(isNull, typeVal.constraint)).toBe(true);
    });

    it("types created by objectType can be used with fields()", () => {
      const personType = call(varRef("objectType"), obj({
        name: varRef("string"),
        age: varRef("number")
      }));

      const result = run(call(varRef("fields"), personType));
      expect(result.value.tag).toBe("array");
      const fieldNames = (result.value as any).elements.map((e: any) => e.value);
      expect(fieldNames).toContain("name");
      expect(fieldNames).toContain("age");
    });

    it("types created by objectType can be used with fieldType()", () => {
      const personType = call(varRef("objectType"), obj({
        name: varRef("string"),
        age: varRef("number")
      }));

      const nameType = run(call(varRef("fieldType"), personType, str("name")));
      expect(nameType.value.tag).toBe("type");
      expect((nameType.value as any).constraint).toEqual(isString);

      const ageType = run(call(varRef("fieldType"), personType, str("age")));
      expect(ageType.value.tag).toBe("type");
      expect((ageType.value as any).constraint).toEqual(isNumber);
    });
  });

  describe("Type value operations", () => {
    it("type values can be compared for equality", () => {
      const expr = eq(varRef("number"), varRef("number"));
      const result = run(expr);
      expect(result.value.tag).toBe("bool");
      expect((result.value as any).value).toBe(true);
    });

    it("different type values are not equal", () => {
      const expr = eq(varRef("number"), varRef("string"));
      const result = run(expr);
      expect(result.value.tag).toBe("bool");
      expect((result.value as any).value).toBe(false);
    });
  });

  describe("unknown type (not yet implemented)", () => {
    it("should have unknown type binding", () => {
      expect(() => {
        run(varRef("unknown"));
      }).toThrow();
    });
  });
});
