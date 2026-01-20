/**
 * Array method type definitions for static type checking.
 *
 * This module provides static types for array methods like .map(), .filter(), etc.
 * The comptime evaluator (comptime-eval.ts) handles the runtime behavior of these methods;
 * this module enables the type checker to understand their signatures.
 */

import {
  Type,
  primitiveType,
  functionType,
  arrayType,
  unionType,
  ParamInfo,
  getArrayElementTypes,
} from "../types/types";

/**
 * Get the element type of an array type.
 * For fixed arrays like [Int, String], returns union of element types.
 * For variadic arrays like Int[], returns the single element type.
 */
export function getArrayElementType(arrType: Type & { kind: "array" }): Type {
  const elementTypes = getArrayElementTypes(arrType);
  if (elementTypes.length === 0) {
    return primitiveType("Never");
  }
  if (elementTypes.length === 1) {
    return elementTypes[0];
  }
  return unionType(elementTypes);
}

/**
 * Get the static type of an array method.
 *
 * @param elementType - The element type of the array (T in Array<T>)
 * @param methodName - The method name being accessed
 * @returns The function type for the method, or undefined if not a valid method
 */
export function getArrayMethodType(
  elementType: Type,
  methodName: string
): Type | undefined {
  // Helper to create callback parameter type: (element: T) => ReturnType
  const callbackParam = (returnType: Type): ParamInfo => ({
    name: "callback",
    type: functionType(
      [{ name: "element", type: elementType, optional: false }],
      returnType
    ),
    optional: false,
  });

  // Helper to create callback with index: (element: T, index: Int) => ReturnType
  const callbackWithIndex = (returnType: Type): ParamInfo => ({
    name: "callback",
    type: functionType(
      [
        { name: "element", type: elementType, optional: false },
        { name: "index", type: primitiveType("Int"), optional: false },
      ],
      returnType
    ),
    optional: false,
  });

  // Helper to create callback with index and array: (element: T, index: Int, array: Array<T>) => ReturnType
  const fullCallback = (returnType: Type): ParamInfo => ({
    name: "callback",
    type: functionType(
      [
        { name: "element", type: elementType, optional: false },
        { name: "index", type: primitiveType("Int"), optional: false },
        {
          name: "array",
          type: arrayType([elementType], true),
          optional: false,
        },
      ],
      returnType
    ),
    optional: false,
  });

  switch (methodName) {
    // ============================================
    // Simple methods (no generic inference needed)
    // ============================================

    case "length":
      // .length is a property, not a method - handled separately in checkProperty
      return primitiveType("Int");

    case "includes":
      // (searchElement: T) => Boolean
      return functionType(
        [{ name: "searchElement", type: elementType, optional: false }],
        primitiveType("Boolean")
      );

    case "indexOf":
      // (searchElement: T, fromIndex?: Int) => Int
      return functionType(
        [
          { name: "searchElement", type: elementType, optional: false },
          { name: "fromIndex", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("Int")
      );

    case "join":
      // (separator?: String) => String
      return functionType(
        [{ name: "separator", type: primitiveType("String"), optional: true }],
        primitiveType("String")
      );

    case "some":
      // ((element: T) => Boolean) => Boolean
      return functionType([callbackParam(primitiveType("Boolean"))], primitiveType("Boolean"));

    case "every":
      // ((element: T) => Boolean) => Boolean
      return functionType([callbackParam(primitiveType("Boolean"))], primitiveType("Boolean"));

    case "concat":
      // (...items: Array<T | Array<T>>) => Array<T>
      // Simplified: (...items: Array<T>[]) => Array<T>
      return functionType(
        [
          {
            name: "items",
            type: arrayType([arrayType([elementType], true)], true),
            optional: false,
            rest: true,
          },
        ],
        arrayType([elementType], true)
      );

    case "slice":
      // (start?: Int, end?: Int) => Array<T>
      return functionType(
        [
          { name: "start", type: primitiveType("Int"), optional: true },
          { name: "end", type: primitiveType("Int"), optional: true },
        ],
        arrayType([elementType], true)
      );

    // ============================================
    // Generic methods (return type depends on callback)
    // For these, we return a function type but the actual return type
    // will be computed in checkCall() based on the callback's return type.
    // ============================================

    case "map":
      // ((element: T, index: Int, array: Array<T>) => U) => Array<U>
      // We use Unknown as placeholder for U - actual type is inferred in checkCall
      return functionType(
        [fullCallback(primitiveType("Unknown"))],
        arrayType([primitiveType("Unknown")], true)
      );

    case "flatMap":
      // ((element: T, index: Int, array: Array<T>) => Array<U>) => Array<U>
      return functionType(
        [fullCallback(arrayType([primitiveType("Unknown")], true))],
        arrayType([primitiveType("Unknown")], true)
      );

    case "filter":
      // ((element: T, index: Int, array: Array<T>) => Boolean) => Array<T>
      return functionType(
        [fullCallback(primitiveType("Boolean"))],
        arrayType([elementType], true)
      );

    case "find":
      // ((element: T, index: Int, array: Array<T>) => Boolean) => T | Undefined
      return functionType(
        [fullCallback(primitiveType("Boolean"))],
        unionType([elementType, primitiveType("Undefined")])
      );

    case "findIndex":
      // ((element: T, index: Int, array: Array<T>) => Boolean) => Int
      return functionType(
        [fullCallback(primitiveType("Boolean"))],
        primitiveType("Int")
      );

    case "reduce":
      // ((accumulator: T, element: T, index: Int, array: Array<T>) => T, initial?: T) => T
      // We use elementType for the accumulator - this works for the common case.
      // For more complex cases (different accumulator type), explicit annotation is needed.
      return functionType(
        [
          {
            name: "callback",
            type: functionType(
              [
                { name: "accumulator", type: elementType, optional: false },
                { name: "element", type: elementType, optional: false },
                { name: "index", type: primitiveType("Int"), optional: false },
                { name: "array", type: arrayType([elementType], true), optional: false },
              ],
              elementType
            ),
            optional: false,
          },
          {
            name: "initialValue",
            type: elementType,
            optional: true,
          },
        ],
        elementType
      );

    case "flat":
      // (depth?: Int) => Array<...>
      // Simplified: just returns Array<Unknown> - full type inference is complex
      return functionType(
        [{ name: "depth", type: primitiveType("Int"), optional: true }],
        arrayType([primitiveType("Unknown")], true)
      );

    default:
      return undefined;
  }
}

/**
 * Check if a method name is an array method that requires generic return type inference.
 * These methods have return types that depend on callback return types.
 */
export function isGenericArrayMethod(methodName: string): boolean {
  return ["map", "flatMap", "reduce", "flat"].includes(methodName);
}

/**
 * Infer the return type of a generic array method based on actual arguments.
 *
 * @param methodName - The method name
 * @param elementType - The array's element type
 * @param callbackReturnType - The inferred return type of the callback (for map/flatMap)
 * @param initialValueType - The type of initial value (for reduce)
 * @returns The inferred return type
 */
export function inferArrayMethodReturnType(
  methodName: string,
  elementType: Type,
  callbackReturnType?: Type,
  initialValueType?: Type
): Type {
  switch (methodName) {
    case "map":
      // map returns Array<CallbackReturnType>
      if (callbackReturnType) {
        return arrayType([callbackReturnType], true);
      }
      return arrayType([primitiveType("Unknown")], true);

    case "flatMap":
      // flatMap returns Array<ElementOf(CallbackReturnType)>
      if (callbackReturnType && callbackReturnType.kind === "array") {
        return arrayType([getArrayElementType(callbackReturnType)], true);
      }
      return arrayType([primitiveType("Unknown")], true);

    case "reduce":
      // reduce returns initial value type, or element type if no initial value
      if (initialValueType) {
        return initialValueType;
      }
      return elementType;

    case "flat":
      // flat flattens one level - if element is array, return element's element type
      if (elementType.kind === "array") {
        return arrayType([getArrayElementType(elementType)], true);
      }
      return arrayType([elementType], true);

    default:
      return primitiveType("Unknown");
  }
}
