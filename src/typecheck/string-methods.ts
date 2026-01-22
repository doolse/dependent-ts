/**
 * String method type definitions for static type checking.
 *
 * This module provides static types for string methods like .toUpperCase(), .split(), etc.
 * The comptime evaluator (comptime-eval.ts) handles the runtime behavior of these methods;
 * this module enables the type checker to understand their signatures.
 */

import { Type, primitiveType, functionType, arrayType } from "../types/types";

/**
 * Get the static type of a string method.
 *
 * @param methodName - The method name being accessed
 * @returns The function type for the method, or undefined if not a valid method
 */
export function getStringMethodType(methodName: string): Type | undefined {
  switch (methodName) {
    // ============================================
    // Properties
    // ============================================

    case "length":
      // .length is a property, not a method - but we define it here for consistency
      return primitiveType("Int");

    // ============================================
    // Character access
    // ============================================

    case "charAt":
      // (index: Int) => String
      return functionType(
        [{ name: "index", type: primitiveType("Int"), optional: false }],
        primitiveType("String")
      );

    case "charCodeAt":
      // (index: Int) => Int
      // Returns NaN (as Int) if index is out of range in JS, but we type it as Int
      return functionType(
        [{ name: "index", type: primitiveType("Int"), optional: false }],
        primitiveType("Int")
      );

    // ============================================
    // Substring extraction
    // ============================================

    case "substring":
      // (start: Int, end?: Int) => String
      return functionType(
        [
          { name: "start", type: primitiveType("Int"), optional: false },
          { name: "end", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("String")
      );

    case "slice":
      // (start?: Int, end?: Int) => String
      return functionType(
        [
          { name: "start", type: primitiveType("Int"), optional: true },
          { name: "end", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("String")
      );

    // ============================================
    // Searching
    // ============================================

    case "indexOf":
      // (searchValue: String, fromIndex?: Int) => Int
      return functionType(
        [
          { name: "searchValue", type: primitiveType("String"), optional: false },
          { name: "fromIndex", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("Int")
      );

    case "lastIndexOf":
      // (searchValue: String, fromIndex?: Int) => Int
      return functionType(
        [
          { name: "searchValue", type: primitiveType("String"), optional: false },
          { name: "fromIndex", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("Int")
      );

    case "includes":
      // (searchString: String, position?: Int) => Boolean
      return functionType(
        [
          { name: "searchString", type: primitiveType("String"), optional: false },
          { name: "position", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("Boolean")
      );

    case "startsWith":
      // (searchString: String, position?: Int) => Boolean
      return functionType(
        [
          { name: "searchString", type: primitiveType("String"), optional: false },
          { name: "position", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("Boolean")
      );

    case "endsWith":
      // (searchString: String, endPosition?: Int) => Boolean
      return functionType(
        [
          { name: "searchString", type: primitiveType("String"), optional: false },
          { name: "endPosition", type: primitiveType("Int"), optional: true },
        ],
        primitiveType("Boolean")
      );

    // ============================================
    // Splitting and joining
    // ============================================

    case "split":
      // (separator: String, limit?: Int) => String[]
      return functionType(
        [
          { name: "separator", type: primitiveType("String"), optional: false },
          { name: "limit", type: primitiveType("Int"), optional: true },
        ],
        arrayType([primitiveType("String")], true)
      );

    // ============================================
    // Trimming
    // ============================================

    case "trim":
      // () => String
      return functionType([], primitiveType("String"));

    case "trimStart":
      // () => String
      return functionType([], primitiveType("String"));

    case "trimEnd":
      // () => String
      return functionType([], primitiveType("String"));

    // ============================================
    // Case conversion
    // ============================================

    case "toUpperCase":
      // () => String
      return functionType([], primitiveType("String"));

    case "toLowerCase":
      // () => String
      return functionType([], primitiveType("String"));

    // ============================================
    // Replacement
    // ============================================

    case "replace":
      // (searchValue: String, replaceValue: String) => String
      // Note: Only replaces first occurrence (JS semantics)
      return functionType(
        [
          { name: "searchValue", type: primitiveType("String"), optional: false },
          { name: "replaceValue", type: primitiveType("String"), optional: false },
        ],
        primitiveType("String")
      );

    case "replaceAll":
      // (searchValue: String, replaceValue: String) => String
      return functionType(
        [
          { name: "searchValue", type: primitiveType("String"), optional: false },
          { name: "replaceValue", type: primitiveType("String"), optional: false },
        ],
        primitiveType("String")
      );

    // ============================================
    // Padding
    // ============================================

    case "padStart":
      // (targetLength: Int, padString?: String) => String
      return functionType(
        [
          { name: "targetLength", type: primitiveType("Int"), optional: false },
          { name: "padString", type: primitiveType("String"), optional: true },
        ],
        primitiveType("String")
      );

    case "padEnd":
      // (targetLength: Int, padString?: String) => String
      return functionType(
        [
          { name: "targetLength", type: primitiveType("Int"), optional: false },
          { name: "padString", type: primitiveType("String"), optional: true },
        ],
        primitiveType("String")
      );

    // ============================================
    // Repetition
    // ============================================

    case "repeat":
      // (count: Int) => String
      return functionType(
        [{ name: "count", type: primitiveType("Int"), optional: false }],
        primitiveType("String")
      );

    // ============================================
    // Concatenation
    // ============================================

    case "concat":
      // (...strings: String[]) => String
      return functionType(
        [
          {
            name: "strings",
            type: primitiveType("String"),
            optional: false,
            rest: true,
          },
        ],
        primitiveType("String")
      );

    default:
      return undefined;
  }
}
