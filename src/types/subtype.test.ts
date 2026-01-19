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
  intersectionType,
  brandedType,
  withMetadata,
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

  describe("intersection types", () => {
    it("intersection is subtype of each part", () => {
      const inter = intersectionType([Int, Num]);
      expect(isSubtype(inter, Int)).toBe(true);
      expect(isSubtype(inter, Num)).toBe(true);
    });

    it("type is subtype of intersection if subtype of all parts", () => {
      // Int <: Int & Number (since Int <: Int and Int <: Number)
      const inter = intersectionType([Int, Num]);
      expect(isSubtype(Int, inter)).toBe(true);
    });

    it("type is not subtype of intersection if not subtype of all parts", () => {
      // Str is not <: Int, so Str is not <: (Int & Str)
      const inter = intersectionType([Int, Str]);
      expect(isSubtype(Str, inter)).toBe(false);
    });

    it("intersection of records combines fields", () => {
      const r1 = recordType([{ name: "a", type: Int, optional: false, annotations: [] }]);
      const r2 = recordType([{ name: "b", type: Str, optional: false, annotations: [] }]);
      const inter = intersectionType([r1, r2]);
      // A record with both fields should be subtype
      const combined = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
        { name: "b", type: Str, optional: false, annotations: [] },
      ]);
      expect(isSubtype(combined, inter)).toBe(true);
    });
  });

  describe("overloaded functions (function intersections)", () => {
    // Overloaded functions are represented as intersections of function types:
    // ((String) => Number) & ((Number) => String)

    it("overloaded function is subtype of first signature", () => {
      // ((String) => Number) & ((Number) => String) <: (String) => Number
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Num);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      expect(isSubtype(overloaded, sig1)).toBe(true);
    });

    it("overloaded function is subtype of second signature", () => {
      // ((String) => Number) & ((Number) => String) <: (Number) => String
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Num);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      expect(isSubtype(overloaded, sig2)).toBe(true);
    });

    it("overloaded function is NOT structurally subtype of union-based function", () => {
      // ((String) => Number) & ((Number) => String) is NOT <: (String | Number) => (Number | String)
      // Due to contravariance in function params:
      // For (String) => Number <: (String|Number) => (Number|String):
      //   - Params: String|Number <: String? NO (contravariant)
      // The spec's "Overloaded <: Union" refers to call semantics, not structural subtyping
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Num);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      const unionBased = functionType(
        [{ name: "x", type: unionType([Str, Num]), optional: false }],
        unionType([Num, Str])
      );

      // Function subtyping is contravariant in params, so neither sig1 nor sig2
      // can be a subtype of unionBased (their params are narrower, not wider)
      expect(isSubtype(overloaded, unionBased)).toBe(false);
    });

    it("union-based function IS subtype of overloaded with same return types", () => {
      // If the overloaded signatures have the same return type, a union-based
      // function can be a subtype due to contravariance
      // (String | Number) => String <: ((String) => String) & ((Number) => String)
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Str);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      const unionBased = functionType(
        [{ name: "x", type: unionType([Str, Num]), optional: false }],
        Str
      );

      // unionBased <: sig1? param: Str <: Str|Num ✓, ret: Str <: Str ✓
      // unionBased <: sig2? param: Num <: Str|Num ✓, ret: Str <: Str ✓
      // Both pass due to contravariance!
      expect(isSubtype(unionBased, overloaded)).toBe(true);
    });

    it("union-based function is NOT subtype of overloaded function", () => {
      // (String | Number) => (Number | String) is NOT <: ((String) => Number) & ((Number) => String)
      // Because union-based can't guarantee precise return types
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Num);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      const unionBased = functionType(
        [{ name: "x", type: unionType([Str, Num]), optional: false }],
        unionType([Num, Str])
      );

      // unionBased must be subtype of ALL parts of intersection
      // unionBased <: sig1? param: Str <: Str|Num ✓, ret: Num|Str <: Num ✗
      expect(isSubtype(unionBased, overloaded)).toBe(false);
    });

    it("single function is not subtype of overloaded requiring both signatures", () => {
      // (String) => Number is NOT <: ((String) => Number) & ((Number) => String)
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Num);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      // sig1 <: sig1 ✓, but sig1 <: sig2? param: Num <: Str ✗
      expect(isSubtype(sig1, overloaded)).toBe(false);
    });

    it("overloaded function with compatible signatures", () => {
      // ((Int) => String) & ((Number) => String)
      // The first is more specific, second is more general
      const sig1 = functionType([{ name: "x", type: Int, optional: false }], Str);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const overloaded = intersectionType([sig1, sig2]);

      // Should be subtype of the more general signature
      expect(isSubtype(overloaded, sig2)).toBe(true);

      // And of course the more specific one
      expect(isSubtype(overloaded, sig1)).toBe(true);
    });

    it("three-way overloaded function", () => {
      // ((String) => Number) & ((Number) => String) & ((Boolean) => Boolean)
      const sig1 = functionType([{ name: "x", type: Str, optional: false }], Num);
      const sig2 = functionType([{ name: "x", type: Num, optional: false }], Str);
      const sig3 = functionType([{ name: "x", type: Bool, optional: false }], Bool);
      const overloaded = intersectionType([sig1, sig2, sig3]);

      expect(isSubtype(overloaded, sig1)).toBe(true);
      expect(isSubtype(overloaded, sig2)).toBe(true);
      expect(isSubtype(overloaded, sig3)).toBe(true);
    });
  });

  describe("WithMetadata", () => {
    it("WithMetadata is subtype of base type", () => {
      const withMeta = withMetadata(Int, { name: "MyInt" });
      expect(isSubtype(withMeta, Int)).toBe(true);
    });

    it("base type is subtype of WithMetadata", () => {
      const withMeta = withMetadata(Int, { name: "MyInt" });
      expect(isSubtype(Int, withMeta)).toBe(true);
    });

    it("different WithMetadata with same base are subtypes", () => {
      const meta1 = withMetadata(Int, { name: "A" });
      const meta2 = withMetadata(Int, { name: "B" });
      expect(isSubtype(meta1, meta2)).toBe(true);
      expect(isSubtype(meta2, meta1)).toBe(true);
    });

    it("WithMetadata with different base types are not subtypes", () => {
      const meta1 = withMetadata(Int, { name: "A" });
      const meta2 = withMetadata(Str, { name: "A" });
      expect(isSubtype(meta1, meta2)).toBe(false);
    });

    it("nested WithMetadata is unwrapped", () => {
      const nested = withMetadata(withMetadata(Int, { name: "Inner" }), { name: "Outer" });
      expect(isSubtype(nested, Int)).toBe(true);
      expect(isSubtype(Int, nested)).toBe(true);
    });
  });

  describe("optional field subtyping", () => {
    it("required field satisfies optional field", () => {
      const required = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
      ]);
      const optional = recordType([
        { name: "a", type: Int, optional: true, annotations: [] },
      ]);
      expect(isSubtype(required, optional)).toBe(true);
    });

    it("optional field does not satisfy required field", () => {
      const optional = recordType([
        { name: "a", type: Int, optional: true, annotations: [] },
      ]);
      const required = recordType([
        { name: "a", type: Int, optional: false, annotations: [] },
      ]);
      expect(isSubtype(optional, required)).toBe(false);
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

  it("WithMetadata is unwrapped for equality", () => {
    const withMeta = withMetadata(Int, { name: "MyInt" });
    expect(typesEqual(withMeta, Int)).toBe(true);
  });
});
