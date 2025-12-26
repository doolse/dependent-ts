/**
 * Method Registry for Primitive Types
 *
 * Defines built-in methods for string, array, and number types.
 * These methods are part of the language definition and map directly
 * to JavaScript's standard library methods.
 */

import {
  Constraint,
  isString,
  isNumber,
  isBool,
  isArray,
  isNull,
  and,
  or,
  elements,
  length,
  equals,
  implies,
} from "./constraint";
import {
  Value,
  StringValue,
  NumberValue,
  BoolValue,
  ArrayValue,
  stringVal,
  numberVal,
  boolVal,
  nullVal,
  arrayVal,
} from "./value";

// ============================================================================
// Method Definition Interface
// ============================================================================

export interface MethodDef {
  /** Constraint the receiver must satisfy */
  receiverType: Constraint;
  /** Constraints for each parameter */
  params: Constraint[];
  /** Compute result constraint from receiver and argument constraints */
  result: (receiverConstraint: Constraint, argConstraints: Constraint[]) => Constraint;
  /** Implementation for compile-time evaluation */
  impl: (receiver: Value, args: Value[]) => Value;
}

// ============================================================================
// String Methods
// ============================================================================

export const stringMethods: Record<string, MethodDef> = {
  // String predicates
  startsWith: {
    receiverType: isString,
    params: [isString],
    result: () => isBool,
    impl: (recv, [prefix]) => {
      const s = (recv as StringValue).value;
      const p = (prefix as StringValue).value;
      return boolVal(s.startsWith(p));
    },
  },

  endsWith: {
    receiverType: isString,
    params: [isString],
    result: () => isBool,
    impl: (recv, [suffix]) => {
      const s = (recv as StringValue).value;
      const sfx = (suffix as StringValue).value;
      return boolVal(s.endsWith(sfx));
    },
  },

  includes: {
    receiverType: isString,
    params: [isString],
    result: () => isBool,
    impl: (recv, [substr]) => {
      const s = (recv as StringValue).value;
      const sub = (substr as StringValue).value;
      return boolVal(s.includes(sub));
    },
  },

  // String transformations
  toUpperCase: {
    receiverType: isString,
    params: [],
    result: () => isString,
    impl: (recv) => {
      const s = (recv as StringValue).value;
      return stringVal(s.toUpperCase());
    },
  },

  toLowerCase: {
    receiverType: isString,
    params: [],
    result: () => isString,
    impl: (recv) => {
      const s = (recv as StringValue).value;
      return stringVal(s.toLowerCase());
    },
  },

  trim: {
    receiverType: isString,
    params: [],
    result: () => isString,
    impl: (recv) => {
      const s = (recv as StringValue).value;
      return stringVal(s.trim());
    },
  },

  trimStart: {
    receiverType: isString,
    params: [],
    result: () => isString,
    impl: (recv) => {
      const s = (recv as StringValue).value;
      return stringVal(s.trimStart());
    },
  },

  trimEnd: {
    receiverType: isString,
    params: [],
    result: () => isString,
    impl: (recv) => {
      const s = (recv as StringValue).value;
      return stringVal(s.trimEnd());
    },
  },

  // String extraction
  slice: {
    receiverType: isString,
    params: [isNumber, or(isNumber, isNull)],
    result: () => isString,
    impl: (recv, [start, end]) => {
      const s = (recv as StringValue).value;
      const startIdx = (start as NumberValue).value;
      const endIdx = end.tag === "null" ? undefined : (end as NumberValue).value;
      return stringVal(s.slice(startIdx, endIdx));
    },
  },

  substring: {
    receiverType: isString,
    params: [isNumber, or(isNumber, isNull)],
    result: () => isString,
    impl: (recv, [start, end]) => {
      const s = (recv as StringValue).value;
      const startIdx = (start as NumberValue).value;
      const endIdx = end.tag === "null" ? undefined : (end as NumberValue).value;
      return stringVal(s.substring(startIdx, endIdx));
    },
  },

  charAt: {
    receiverType: isString,
    params: [isNumber],
    result: () => isString,
    impl: (recv, [index]) => {
      const s = (recv as StringValue).value;
      const idx = (index as NumberValue).value;
      return stringVal(s.charAt(idx));
    },
  },

  charCodeAt: {
    receiverType: isString,
    params: [isNumber],
    result: () => isNumber,
    impl: (recv, [index]) => {
      const s = (recv as StringValue).value;
      const idx = (index as NumberValue).value;
      return numberVal(s.charCodeAt(idx));
    },
  },

  // String search
  indexOf: {
    receiverType: isString,
    params: [isString],
    result: () => isNumber,
    impl: (recv, [search]) => {
      const s = (recv as StringValue).value;
      const searchStr = (search as StringValue).value;
      return numberVal(s.indexOf(searchStr));
    },
  },

  lastIndexOf: {
    receiverType: isString,
    params: [isString],
    result: () => isNumber,
    impl: (recv, [search]) => {
      const s = (recv as StringValue).value;
      const searchStr = (search as StringValue).value;
      return numberVal(s.lastIndexOf(searchStr));
    },
  },

  // String splitting and joining
  split: {
    receiverType: isString,
    params: [isString],
    result: () => and(isArray, elements(isString)),
    impl: (recv, [separator]) => {
      const s = (recv as StringValue).value;
      const sep = (separator as StringValue).value;
      return arrayVal(s.split(sep).map(stringVal));
    },
  },

  // String replacement
  replace: {
    receiverType: isString,
    params: [isString, isString],
    result: () => isString,
    impl: (recv, [search, replacement]) => {
      const s = (recv as StringValue).value;
      const searchStr = (search as StringValue).value;
      const replaceStr = (replacement as StringValue).value;
      return stringVal(s.replace(searchStr, replaceStr));
    },
  },

  replaceAll: {
    receiverType: isString,
    params: [isString, isString],
    result: () => isString,
    impl: (recv, [search, replacement]) => {
      const s = (recv as StringValue).value;
      const searchStr = (search as StringValue).value;
      const replaceStr = (replacement as StringValue).value;
      // Use split/join as a cross-version alternative to replaceAll
      return stringVal(s.split(searchStr).join(replaceStr));
    },
  },

  // Padding
  padStart: {
    receiverType: isString,
    params: [isNumber, isString],
    result: () => isString,
    impl: (recv, [targetLength, padString]) => {
      const s = (recv as StringValue).value;
      const len = (targetLength as NumberValue).value;
      const pad = (padString as StringValue).value;
      return stringVal(s.padStart(len, pad));
    },
  },

  padEnd: {
    receiverType: isString,
    params: [isNumber, isString],
    result: () => isString,
    impl: (recv, [targetLength, padString]) => {
      const s = (recv as StringValue).value;
      const len = (targetLength as NumberValue).value;
      const pad = (padString as StringValue).value;
      return stringVal(s.padEnd(len, pad));
    },
  },

  // Repeat
  repeat: {
    receiverType: isString,
    params: [isNumber],
    result: () => isString,
    impl: (recv, [count]) => {
      const s = (recv as StringValue).value;
      const n = (count as NumberValue).value;
      return stringVal(s.repeat(n));
    },
  },

  // Concatenation
  concat: {
    receiverType: isString,
    params: [isString],
    result: () => isString,
    impl: (recv, [other]) => {
      const s = (recv as StringValue).value;
      const o = (other as StringValue).value;
      return stringVal(s.concat(o));
    },
  },
};

// ============================================================================
// Array Methods
// ============================================================================

export const arrayMethods: Record<string, MethodDef> = {
  includes: {
    receiverType: isArray,
    params: [{ tag: "any" }],
    result: () => isBool,
    impl: (recv, [elem]) => {
      const arr = (recv as ArrayValue).elements;
      // Simple equality check for primitives
      const found = arr.some(v => {
        if (v.tag !== elem.tag) return false;
        if (v.tag === "number" && elem.tag === "number") return v.value === elem.value;
        if (v.tag === "string" && elem.tag === "string") return v.value === elem.value;
        if (v.tag === "bool" && elem.tag === "bool") return v.value === elem.value;
        if (v.tag === "null" && elem.tag === "null") return true;
        return false;
      });
      return boolVal(found);
    },
  },

  join: {
    receiverType: isArray,
    params: [isString],
    result: () => isString,
    impl: (recv, [separator]) => {
      const arr = (recv as ArrayValue).elements;
      const sep = (separator as StringValue).value;
      const strs = arr.map(v => {
        if (v.tag === "string") return v.value;
        if (v.tag === "number") return String(v.value);
        if (v.tag === "bool") return String(v.value);
        if (v.tag === "null") return "null";
        return "[object]";
      });
      return stringVal(strs.join(sep));
    },
  },

  slice: {
    receiverType: isArray,
    params: [isNumber, or(isNumber, isNull)],
    result: (recv) => recv, // Preserve element type constraint
    impl: (recv, [start, end]) => {
      const arr = (recv as ArrayValue).elements;
      const startIdx = (start as NumberValue).value;
      const endIdx = end.tag === "null" ? undefined : (end as NumberValue).value;
      return arrayVal(arr.slice(startIdx, endIdx));
    },
  },

  indexOf: {
    receiverType: isArray,
    params: [{ tag: "any" }],
    result: () => isNumber,
    impl: (recv, [elem]) => {
      const arr = (recv as ArrayValue).elements;
      const idx = arr.findIndex(v => {
        if (v.tag !== elem.tag) return false;
        if (v.tag === "number" && elem.tag === "number") return v.value === elem.value;
        if (v.tag === "string" && elem.tag === "string") return v.value === elem.value;
        if (v.tag === "bool" && elem.tag === "bool") return v.value === elem.value;
        if (v.tag === "null" && elem.tag === "null") return true;
        return false;
      });
      return numberVal(idx);
    },
  },

  reverse: {
    receiverType: isArray,
    params: [],
    result: (recv) => recv,
    impl: (recv) => {
      const arr = (recv as ArrayValue).elements;
      return arrayVal([...arr].reverse());
    },
  },

  concat: {
    receiverType: isArray,
    params: [isArray],
    result: (recv) => recv,
    impl: (recv, [other]) => {
      const arr1 = (recv as ArrayValue).elements;
      const arr2 = (other as ArrayValue).elements;
      return arrayVal([...arr1, ...arr2]);
    },
  },
};

// ============================================================================
// Number Methods
// ============================================================================

export const numberMethods: Record<string, MethodDef> = {
  toString: {
    receiverType: isNumber,
    params: [],
    result: () => isString,
    impl: (recv: Value) => {
      const n = (recv as NumberValue).value;
      return stringVal(String(n));
    },
  },

  toFixed: {
    receiverType: isNumber,
    params: [isNumber],
    result: () => isString,
    impl: (recv, [digits]) => {
      const n = (recv as NumberValue).value;
      const d = (digits as NumberValue).value;
      return stringVal(n.toFixed(d));
    },
  },

  toPrecision: {
    receiverType: isNumber,
    params: [isNumber],
    result: () => isString,
    impl: (recv, [precision]) => {
      const n = (recv as NumberValue).value;
      const p = (precision as NumberValue).value;
      return stringVal(n.toPrecision(p));
    },
  },
};

// ============================================================================
// Method Lookup
// ============================================================================

/**
 * Look up a method by receiver constraint and method name.
 * Returns undefined if no matching method is found.
 */
export function lookupMethod(
  receiverConstraint: Constraint,
  methodName: string
): MethodDef | undefined {
  // Check string methods
  if (implies(receiverConstraint, isString)) {
    const method = stringMethods[methodName];
    if (method) return method;
  }

  // Check array methods
  if (implies(receiverConstraint, isArray)) {
    const method = arrayMethods[methodName];
    if (method) return method;
  }

  // Check number methods
  if (implies(receiverConstraint, isNumber)) {
    const method = numberMethods[methodName];
    if (method) return method;
  }

  // For 'any' type, search all method registries
  // The actual type will be checked at runtime
  // Use Object.hasOwn to avoid picking up Object.prototype methods like toString
  if (receiverConstraint.tag === "any") {
    if (Object.prototype.hasOwnProperty.call(stringMethods, methodName)) {
      return stringMethods[methodName];
    }
    if (Object.prototype.hasOwnProperty.call(arrayMethods, methodName)) {
      return arrayMethods[methodName];
    }
    if (Object.prototype.hasOwnProperty.call(numberMethods, methodName)) {
      return numberMethods[methodName];
    }
  }

  return undefined;
}

/**
 * Get all available method names for a given constraint.
 */
export function getMethodNames(constraint: Constraint): string[] {
  const methods: string[] = [];

  if (implies(constraint, isString)) {
    methods.push(...Object.keys(stringMethods));
  }
  if (implies(constraint, isArray)) {
    methods.push(...Object.keys(arrayMethods));
  }
  if (implies(constraint, isNumber)) {
    methods.push(...Object.keys(numberMethods));
  }

  return methods;
}
