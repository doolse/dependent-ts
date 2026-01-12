import { describe, it, expect } from "vitest";
import {
  Int,
  Float,
  Num,
  Str,
  Bool,
  Never,
  Unknown,
  literalType,
  recordType,
  functionType,
  arrayType,
  unionType,
  brandedType,
} from "./types";
import { isSubtype, typesEqual } from "./subtype";

describe("isSubtype", () => {
  describe("primitives", () => {
    it("same primitive is subtype of itself", () => {
      expect(isSubtype(Int, Int)).toBe(true);
      expect(isSubtype(Str, Str)).toBe(true);
    });

    it("Int is subtype of Number", () => {
      expect(isSubtype(Int, Num)).toBe(true);
    });

    it("Float is subtype of Number", () => {
      expect(isSubtype(Float, Num)).toBe(true);
    });

    it("Number is not subtype of Int", () => {
      expect(isSubtype(Num, Int)).toBe(false);
    });

    it("Never is subtype of everything", () => {
      expect(isSubtype(Never, Int)).toBe(true);
      expect(isSubtype(Never, Str)).toBe(true);
      expect(isSubtype(Never, Unknown)).toBe(true);
    });

    it("everything is subtype of Unknown", () => {
      expect(isSubtype(Int, Unknown)).toBe(true);
      expect(isSubtype(Str, Unknown)).toBe(true);
      expect(isSubtype(Never, Unknown)).toBe(true);
    });

    it("different primitives are not subtypes", () => {
      expect(isSubtype(Int, Str)).toBe(false);
      expect(isSubtype(Str, Bool)).toBe(false);
    });
  });

  describe("literals", () => {
    it("literal is subtype of its base type", () => {
      expect(isSubtype(literalType(42, "Int"), Int)).toBe(true);
      expect(isSubtype(literalType("hello", "String"), Str)).toBe(true);
      expect(isSubtype(literalType(true, "Boolean"), Bool)).toBe(true);
    });

    it("Int literal is subtype of Number", () => {
      expect(isSubtype(literalType(42, "Int"), Num)).toBe(true);
    });

    it("Float literal is subtype of Number", () => {
      expect(isSubtype(literalType(3.14, "Float"), Num)).toBe(true);
    });

    it("literal is not subtype of different primitive", () => {
      expect(isSubtype(literalType(42, "Int"), Str)).toBe(false);
    });

    it("same literals are equal", () => {
      expect(isSubtype(literalType(42, "Int"), literalType(42, "Int"))).toBe(
        true
      );
    });

    it("different literals are not subtypes", () => {
      expect(isSubtype(literalType(42, "Int"), literalType(43, "Int"))).toBe(
        false
      );
    });
  });

  describe("records", () => {
    it("record with same fields is subtype", () => {
      const r1 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      const r2 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      expect(isSubtype(r1, r2)).toBe(true);
    });

    it("record with extra fields is subtype (width subtyping)", () => {
      const r1 = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
        { name: "b", type: Str, optional: false, annotations: [] },
      ]);
      const r2 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      expect(isSubtype(r1, r2)).toBe(true);
    });

    it("record missing required field is not subtype", () => {
      const r1 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      const r2 = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
        { name: "b", type: Str, optional: false, annotations: [] },
      ]);
      expect(isSubtype(r1, r2)).toBe(false);
    });

    it("record with optional field can omit it", () => {
      const r1 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      const r2 = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
        { name: "b", type: Str, optional: true, annotations: [] },
      ]);
      expect(isSubtype(r1, r2)).toBe(true);
    });

    it("record with more specific field type is subtype (depth subtyping)", () => {
      const r1 = recordType([
        { name: "a", type: literalType(42, "Int"), optional: false, annotations: [] },
      ]);
      const r2 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      expect(isSubtype(r1, r2)).toBe(true);
    });

    it("closed record rejects extra fields", () => {
      const r1 = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
        { name: "b", type: Str, optional: false, annotations: [] },
      ]);
      const r2 = recordType(
        [{ name: "a", type: Int, optional: false, annotations: [] }],
        { closed: true }
      );
      expect(isSubtype(r1, r2)).toBe(false);
    });
  });

  describe("functions", () => {
    it("same function type is subtype", () => {
      const f1 = functionType(
        [{ name: "x", type: Int, optional: false }],
        Str
      );
      const f2 = functionType(
        [{ name: "x", type: Int, optional: false }],
        Str
      );
      expect(isSubtype(f1, f2)).toBe(true);
    });

    it("covariant return type", () => {
      const f1 = functionType(
        [{ name: "x", type: Int, optional: false }],
        literalType(42, "Int")
      );
      const f2 = functionType(
        [{ name: "x", type: Int, optional: false }],
        Int
      );
      expect(isSubtype(f1, f2)).toBe(true);
    });

    it("contravariant parameter type", () => {
      // f1 accepts Number, f2 accepts Int
      // f1 can be used where f2 is expected (wider param)
      const f1 = functionType(
        [{ name: "x", type: Num, optional: false }],
        Int
      );
      const f2 = functionType(
        [{ name: "x", type: Int, optional: false }],
        Int
      );
      expect(isSubtype(f1, f2)).toBe(true);
    });

    it("narrower param is not subtype", () => {
      // f1 only accepts Int, can't be used where Number is expected
      const f1 = functionType(
        [{ name: "x", type: Int, optional: false }],
        Int
      );
      const f2 = functionType(
        [{ name: "x", type: Num, optional: false }],
        Int
      );
      expect(isSubtype(f1, f2)).toBe(false);
    });
  });

  describe("arrays", () => {
    it("same array type is subtype", () => {
      const a1 = arrayType([Int], true);
      const a2 = arrayType([Int], true);
      expect(isSubtype(a1, a2)).toBe(true);
    });

    it("fixed array is subtype of variable array", () => {
      const fixed = arrayType([Int, Int, Int], false);
      const variable = arrayType([Int], true);
      expect(isSubtype(fixed, variable)).toBe(true);
    });

    it("variable array is not subtype of fixed array", () => {
      const variable = arrayType([Int], true);
      const fixed = arrayType([Int, Int], false);
      expect(isSubtype(variable, fixed)).toBe(false);
    });

    it("fixed array with literal types is subtype of widened", () => {
      const narrow = arrayType(
        [literalType(1, "Int"), literalType(2, "Int")],
        false
      );
      const wide = arrayType([Int, Int], false);
      expect(isSubtype(narrow, wide)).toBe(true);
    });
  });

  describe("unions", () => {
    it("member is subtype of union", () => {
      const union = unionType([Int, Str]);
      expect(isSubtype(Int, union)).toBe(true);
      expect(isSubtype(Str, union)).toBe(true);
    });

    it("non-member is not subtype of union", () => {
      const union = unionType([Int, Str]);
      expect(isSubtype(Bool, union)).toBe(false);
    });

    it("union is subtype if all members are subtypes", () => {
      const u1 = unionType([literalType(1, "Int"), literalType(2, "Int")]);
      expect(isSubtype(u1, Int)).toBe(true);
    });

    it("union is not subtype if any member is not", () => {
      const u1 = unionType([Int, Str]);
      expect(isSubtype(u1, Int)).toBe(false);
    });
  });

  describe("branded types", () => {
    it("branded type is not subtype of base type", () => {
      const userId = brandedType(Str, "UserId", "UserId");
      expect(isSubtype(userId, Str)).toBe(false);
    });

    it("base type is not subtype of branded type", () => {
      const userId = brandedType(Str, "UserId", "UserId");
      expect(isSubtype(Str, userId)).toBe(false);
    });

    it("same branded type is subtype of itself", () => {
      const userId1 = brandedType(Str, "UserId", "UserId");
      const userId2 = brandedType(Str, "UserId", "UserId");
      expect(isSubtype(userId1, userId2)).toBe(true);
    });

    it("different brands are not subtypes", () => {
      const userId = brandedType(Str, "UserId", "UserId");
      const email = brandedType(Str, "Email", "Email");
      expect(isSubtype(userId, email)).toBe(false);
    });
  });
});

describe("typesEqual", () => {
  it("same primitives are equal", () => {
    expect(typesEqual(Int, Int)).toBe(true);
    expect(typesEqual(Str, Str)).toBe(true);
  });

  it("different primitives are not equal", () => {
    expect(typesEqual(Int, Str)).toBe(false);
  });

  it("same literals are equal", () => {
    expect(typesEqual(literalType(42, "Int"), literalType(42, "Int"))).toBe(
      true
    );
  });

  it("different literals are not equal", () => {
    expect(typesEqual(literalType(42, "Int"), literalType(43, "Int"))).toBe(
      false
    );
  });
});
