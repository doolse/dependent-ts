import { describe, it, expect, beforeEach } from "vitest";
import {
  typeParam,
  genericFnType,
  makeTypeParam,
  isNumber,
  isString,
  isArray,
  anyC,
  fnType,
  constraintToString,
  constraintEquals,
  simplify,
  implies,
  solve,
  resetTypeParamCounter,
  resetConstraintVarCounter,
  isUndefined,
  or,
  and,
  elementAt,
  length,
  equals,
  elements,
  instantiateGenericCall,
  substituteTypeParams,
  tryInstantiateCall,
} from "../src/index";

describe("Generic Types", () => {
  beforeEach(() => {
    resetTypeParamCounter();
    resetConstraintVarCounter();
  });

  describe("typeParam constraint", () => {
    it("creates type parameter with default bound", () => {
      const t = typeParam("T");
      expect(t.tag).toBe("typeParam");
      if (t.tag === "typeParam") {
        expect(t.name).toBe("T");
        expect(t.bound.tag).toBe("any");
      }
    });

    it("creates type parameter with explicit bound", () => {
      const t = typeParam("T", isNumber);
      expect(t.tag).toBe("typeParam");
      if (t.tag === "typeParam") {
        expect(t.name).toBe("T");
        expect(t.bound.tag).toBe("isNumber");
      }
    });

    it("prints type parameter name", () => {
      const t = typeParam("T");
      expect(constraintToString(t)).toBe("T");
    });
  });

  describe("genericFnType constraint", () => {
    it("creates generic function type with single type param", () => {
      const tp = makeTypeParam("T");
      const gfn = genericFnType(
        [tp],
        [{ tag: "typeParam", name: "T", id: tp.id, bound: anyC }],
        { tag: "typeParam", name: "T", id: tp.id, bound: anyC }
      );
      expect(gfn.tag).toBe("genericFnType");
      if (gfn.tag === "genericFnType") {
        expect(gfn.typeParams.length).toBe(1);
        expect(gfn.params.length).toBe(1);
      }
    });

    it("prints generic function type", () => {
      const tp = makeTypeParam("T");
      const gfn = genericFnType(
        [tp],
        [{ tag: "typeParam", name: "T", id: tp.id, bound: anyC }],
        { tag: "typeParam", name: "T", id: tp.id, bound: anyC }
      );
      expect(constraintToString(gfn)).toBe("<T>(T) -> T");
    });

    it("prints generic function with bounded type param", () => {
      const tp = makeTypeParam("T", isNumber);
      const gfn = genericFnType(
        [tp],
        [{ tag: "typeParam", name: "T", id: tp.id, bound: isNumber }],
        { tag: "typeParam", name: "T", id: tp.id, bound: isNumber }
      );
      expect(constraintToString(gfn)).toBe("<T extends number>(T) -> T");
    });

    it("prints multi-param generic function", () => {
      const tpT = makeTypeParam("T");
      const tpU = makeTypeParam("U");
      const gfn = genericFnType(
        [tpT, tpU],
        [
          { tag: "typeParam", name: "T", id: tpT.id, bound: anyC },
          { tag: "typeParam", name: "U", id: tpU.id, bound: anyC },
        ],
        { tag: "typeParam", name: "U", id: tpU.id, bound: anyC }
      );
      expect(constraintToString(gfn)).toBe("<T, U>(T, U) -> U");
    });
  });

  describe("isUndefined constraint", () => {
    it("is disjoint from other types", () => {
      // and(isUndefined, isNumber) simplifies to never since they're disjoint
      expect(simplify(and(isUndefined, isNumber)).tag).toBe("never");
      expect(simplify(and(isUndefined, isString)).tag).toBe("never");
    });

    it("can form nullable type", () => {
      const nullable = or(isNumber, isUndefined);
      expect(constraintToString(nullable)).toBe("number | undefined");
    });
  });

  describe("implies with generics", () => {
    it("genericFnType implies isFunction", () => {
      const tp = makeTypeParam("T");
      const gfn = genericFnType(
        [tp],
        [{ tag: "typeParam", name: "T", id: tp.id, bound: anyC }],
        { tag: "typeParam", name: "T", id: tp.id, bound: anyC }
      );
      expect(implies(gfn, { tag: "isFunction" })).toBe(true);
    });

    it("typeParam implies its bound", () => {
      const t = typeParam("T", isNumber);
      expect(implies(t, isNumber)).toBe(true);
    });

    it("constraint implies typeParam if it implies the bound", () => {
      const t = typeParam("T", isNumber);
      expect(implies(isNumber, t)).toBe(true);
    });
  });

  describe("constraintEquals with generics", () => {
    it("two identical type params are equal", () => {
      const t1 = typeParam("T", anyC, 1);
      const t2 = typeParam("T", anyC, 1);
      expect(constraintEquals(t1, t2)).toBe(true);
    });

    it("different type param ids are not equal", () => {
      const t1 = typeParam("T", anyC, 1);
      const t2 = typeParam("T", anyC, 2);
      expect(constraintEquals(t1, t2)).toBe(false);
    });

    it("identical generic function types are equal", () => {
      const tp1 = makeTypeParam("T", anyC, 1);
      const tp2 = makeTypeParam("T", anyC, 1);
      const gfn1 = genericFnType([tp1], [typeParam("T", anyC, 1)], typeParam("T", anyC, 1));
      const gfn2 = genericFnType([tp2], [typeParam("T", anyC, 1)], typeParam("T", anyC, 1));
      expect(constraintEquals(gfn1, gfn2)).toBe(true);
    });
  });

  describe("simplify with generics", () => {
    it("simplifies generic function type params", () => {
      const tp = makeTypeParam("T", and(isNumber, isNumber)); // redundant
      const gfn = genericFnType([tp], [typeParam("T", tp.id)], typeParam("T", tp.id));
      const simplified = simplify(gfn);
      // Bounds should be simplified
      if (simplified.tag === "genericFnType") {
        expect(simplified.typeParams[0].bound.tag).toBe("isNumber");
      }
    });
  });

  describe("solve with generics", () => {
    it("solves typeParam with same id", () => {
      const t1 = typeParam("T", anyC, 1);
      const t2 = typeParam("T", anyC, 1);
      const sub = solve(t1, t2);
      expect(sub).not.toBeNull();
    });

    it("solves typeParam with matching bounds", () => {
      const t1 = typeParam("T", isNumber, 1);
      const t2 = typeParam("T", isNumber, 2);
      const sub = solve(t1, t2);
      expect(sub).not.toBeNull();
    });
  });

  describe("substituteTypeParams", () => {
    it("substitutes type params in simple constraints", () => {
      const tp = makeTypeParam("T", anyC, 100);
      const constraint = typeParam("T", anyC, 100);
      const subs = new Map([[100, isNumber]]);
      const result = substituteTypeParams(constraint, subs);
      expect(result.tag).toBe("isNumber");
    });

    it("substitutes in nested structures", () => {
      const tp = makeTypeParam("T", anyC, 100);
      // Array of T
      const constraint = and(isArray, elements(typeParam("T", anyC, 100)));
      const subs = new Map([[100, isNumber]]);
      const result = substituteTypeParams(constraint, subs);
      // Should become array of number
      expect(constraintToString(simplify(result))).toBe("array & number[]");
    });

    it("substitutes in function types", () => {
      const tp = makeTypeParam("T", anyC, 100);
      const constraint = fnType(
        [typeParam("T", anyC, 100)],
        typeParam("T", anyC, 100)
      );
      const subs = new Map([[100, isNumber]]);
      const result = substituteTypeParams(constraint, subs);
      expect(constraintToString(result)).toBe("(number) -> number");
    });
  });

  describe("instantiateGenericCall", () => {
    it("instantiates identity function: <T>(x: T) => T", () => {
      const tp = makeTypeParam("T", anyC, 100);
      const identityFn = genericFnType(
        [tp],
        [typeParam("T", anyC, 100)],
        typeParam("T", anyC, 100)
      );

      // Call with number
      const result = instantiateGenericCall(
        identityFn as any,
        [and(isNumber, equals(42))]
      );

      expect(result).not.toBeNull();
      // Result should be the number type (with the literal)
      expect(implies(result!.resultConstraint, isNumber)).toBe(true);
    });

    it("instantiates useState-like: <T>(initial: T) => [T, (v: T) => void]", () => {
      const tp = makeTypeParam("T", anyC, 100);
      const T = typeParam("T", anyC, 100);

      // useState<T>(initial: T): [T, (T) => void]
      const useStateFn = genericFnType(
        [tp],
        [T], // param: T
        and(
          isArray,
          elementAt(0, T),                    // [0]: T
          elementAt(1, fnType([T], anyC)),    // [1]: (T) => void
          length(equals(2))
        )
      );

      // Call: useState(0)
      const result = instantiateGenericCall(
        useStateFn as any,
        [and(isNumber, equals(0))]
      );

      expect(result).not.toBeNull();
      const resultC = result!.resultConstraint;

      // Result should be an array
      expect(implies(resultC, isArray)).toBe(true);

      // Check it's a tuple-like structure
      if (resultC.tag === "and") {
        const hasElementAt0 = resultC.constraints.find(
          c => c.tag === "elementAt" && c.index === 0
        );
        expect(hasElementAt0).toBeDefined();
        if (hasElementAt0 && hasElementAt0.tag === "elementAt") {
          // The element should be a number
          expect(implies(hasElementAt0.constraint, isNumber)).toBe(true);
        }
      }
    });

    it("instantiates map: <T, U>(arr: T[], fn: (x: T) => U) => U[]", () => {
      const tpT = makeTypeParam("T", anyC, 100);
      const tpU = makeTypeParam("U", anyC, 101);
      const T = typeParam("T", anyC, 100);
      const U = typeParam("U", anyC, 101);

      // map<T, U>(arr: T[], fn: (x: T) => U): U[]
      const mapFn = genericFnType(
        [tpT, tpU],
        [
          and(isArray, elements(T)),           // arr: T[]
          fnType([T], U)                       // fn: (T) => U
        ],
        and(isArray, elements(U))              // result: U[]
      );

      // Call: map([1,2,3], x => x.toString())
      // Args: number[], (number) => string
      const result = instantiateGenericCall(
        mapFn as any,
        [
          and(isArray, elements(isNumber)),
          fnType([isNumber], isString)
        ]
      );

      expect(result).not.toBeNull();
      const resultC = result!.resultConstraint;

      // Result should be string[]
      expect(implies(resultC, isArray)).toBe(true);
      // Check for elements constraint
      if (resultC.tag === "and") {
        const elementsC = resultC.constraints.find(c => c.tag === "elements");
        if (elementsC && elementsC.tag === "elements") {
          expect(implies(elementsC.constraint, isString)).toBe(true);
        }
      }
    });

    it("handles union params: <T>(x: T | (() => T)) => T", () => {
      const tp = makeTypeParam("T", anyC, 100);
      const T = typeParam("T", anyC, 100);

      // Like useState's initializer: T | (() => T)
      const fn = genericFnType(
        [tp],
        [or(T, fnType([], T))],
        T
      );

      // Call with direct value
      const result = instantiateGenericCall(
        fn as any,
        [isNumber]
      );

      expect(result).not.toBeNull();
      expect(implies(result!.resultConstraint, isNumber)).toBe(true);
    });
  });

  describe("tryInstantiateCall", () => {
    it("handles non-generic fnType", () => {
      const fn = fnType([isNumber], isString);
      const result = tryInstantiateCall(fn, [isNumber]);
      expect(result).not.toBeNull();
      expect(result!.tag).toBe("isString");
    });

    it("handles genericFnType", () => {
      const tp = makeTypeParam("T", anyC, 100);
      const gfn = genericFnType(
        [tp],
        [typeParam("T", anyC, 100)],
        typeParam("T", anyC, 100)
      );
      const result = tryInstantiateCall(gfn, [isNumber]);
      expect(result).not.toBeNull();
      expect(implies(result!, isNumber)).toBe(true);
    });

    it("returns null for non-function constraints", () => {
      const result = tryInstantiateCall(isNumber, [isNumber]);
      expect(result).toBeNull();
    });
  });
});
