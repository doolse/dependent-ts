/**
 * Runtime values for the interpreter.
 */

import { Constraint, isNumber, isString, isBool, isNull, isObject, isArray, isFunction, and, equals, hasField, elements, length, elementAt, isType, constraintToString } from "./constraint";
import type { Expr } from "./expr";
import type { Env } from "./env";

// ============================================================================
// Value Types
// ============================================================================

export type Value =
  | NumberValue
  | StringValue
  | BoolValue
  | NullValue
  | ObjectValue
  | ArrayValue
  | ClosureValue
  | TypeValue
  | BuiltinValue;

export interface NumberValue {
  tag: "number";
  value: number;
}

export interface StringValue {
  tag: "string";
  value: string;
}

export interface BoolValue {
  tag: "bool";
  value: boolean;
}

export interface NullValue {
  tag: "null";
}

export interface ObjectValue {
  tag: "object";
  fields: Map<string, Value>;
}

export interface ArrayValue {
  tag: "array";
  elements: Value[];
}

export interface ClosureValue {
  tag: "closure";
  name?: string;      // Optional name for recursive self-reference
  params: string[];
  body: Expr;
  env: Env;
}

export interface TypeValue {
  tag: "type";
  constraint: Constraint;  // The constraint set this type represents
}

/**
 * A built-in function value.
 * References a function in the builtin registry by name.
 */
export interface BuiltinValue {
  tag: "builtin";
  name: string;
}

// ============================================================================
// Constructors
// ============================================================================

export const numberVal = (value: number): NumberValue => ({ tag: "number", value });
export const stringVal = (value: string): StringValue => ({ tag: "string", value });
export const boolVal = (value: boolean): BoolValue => ({ tag: "bool", value });
export const nullVal: NullValue = { tag: "null" };

export const objectVal = (fields: Record<string, Value>): ObjectValue => ({
  tag: "object",
  fields: new Map(Object.entries(fields)),
});

export const arrayVal = (elems: Value[]): ArrayValue => ({
  tag: "array",
  elements: elems,
});

export const closureVal = (params: string[], body: Expr, env: Env, name?: string): ClosureValue => ({
  tag: "closure",
  name,
  params,
  body,
  env,
});

export const typeVal = (constraint: Constraint): TypeValue => ({
  tag: "type",
  constraint,
});

export const builtinVal = (name: string): BuiltinValue => ({
  tag: "builtin",
  name,
});

// ============================================================================
// Value to Constraint
// ============================================================================

/**
 * Compute the most specific constraint for a concrete value.
 * This gives us the "literal type" of the value.
 */
export function constraintOf(value: Value): Constraint {
  switch (value.tag) {
    case "number":
      return and(isNumber, equals(value.value));

    case "string":
      return and(isString, equals(value.value));

    case "bool":
      return and(isBool, equals(value.value));

    case "null":
      return isNull;

    case "object": {
      const fieldConstraints: Constraint[] = [isObject];
      for (const [name, val] of value.fields) {
        fieldConstraints.push(hasField(name, constraintOf(val)));
      }
      return and(...fieldConstraints);
    }

    case "array": {
      const constraints: Constraint[] = [isArray];

      // Add length constraint
      constraints.push(length(and(isNumber, equals(value.elements.length))));

      // Add elementAt constraints for each position (tuple-style)
      value.elements.forEach((elem, i) => {
        constraints.push(elementAt(i, constraintOf(elem)));
      });

      // Also compute a common element type for homogeneous access
      if (value.elements.length > 0) {
        // For now, just use the constraint of the first element
        // A full implementation would compute a union
        constraints.push(elements(constraintOf(value.elements[0])));
      }

      return and(...constraints);
    }

    case "closure":
      // For closures, we just know it's a function
      // The parameter/return constraints are inferred when called
      return isFunction;

    case "type":
      // A type value has the isType constraint wrapping what it represents
      return isType(value.constraint);

    case "builtin":
      // Builtins are functions
      return isFunction;
  }
}

/**
 * Compute a "widened" constraint that forgets literal information.
 * and(isNumber, equals(5)) -> isNumber
 */
export function widenConstraint(c: Constraint): Constraint {
  if (c.tag === "and") {
    // Remove equals constraints
    const filtered = c.constraints.filter(x => x.tag !== "equals");
    if (filtered.length === 0) return { tag: "any" };
    if (filtered.length === 1) return filtered[0];
    return { tag: "and", constraints: filtered };
  }
  if (c.tag === "equals") {
    // Widen to classification
    const v = c.value;
    if (typeof v === "number") return isNumber;
    if (typeof v === "string") return isString;
    if (typeof v === "boolean") return isBool;
    if (v === null) return isNull;
    return { tag: "any" };
  }
  return c;
}

// ============================================================================
// Value Checking
// ============================================================================

/**
 * Check if a value satisfies a constraint.
 */
export function valueSatisfies(value: Value, constraint: Constraint): boolean {
  switch (constraint.tag) {
    case "any":
      return true;

    case "never":
      return false;

    case "isNumber":
      return value.tag === "number";

    case "isString":
      return value.tag === "string";

    case "isBool":
      return value.tag === "bool";

    case "isNull":
      return value.tag === "null";

    case "isObject":
      return value.tag === "object";

    case "isArray":
      return value.tag === "array";

    case "isFunction":
      return value.tag === "closure" || value.tag === "builtin";

    case "equals":
      return valueEqualsRaw(value, constraint.value);

    case "gt":
      return value.tag === "number" && value.value > constraint.bound;

    case "gte":
      return value.tag === "number" && value.value >= constraint.bound;

    case "lt":
      return value.tag === "number" && value.value < constraint.bound;

    case "lte":
      return value.tag === "number" && value.value <= constraint.bound;

    case "hasField":
      if (value.tag !== "object") return false;
      const fieldVal = value.fields.get(constraint.name);
      if (fieldVal === undefined) return false;
      return valueSatisfies(fieldVal, constraint.constraint);

    case "elements":
      if (value.tag !== "array") return false;
      return value.elements.every(elem => valueSatisfies(elem, constraint.constraint));

    case "length":
      if (value.tag === "array") {
        return valueSatisfies(numberVal(value.elements.length), constraint.constraint);
      }
      if (value.tag === "string") {
        return valueSatisfies(numberVal(value.value.length), constraint.constraint);
      }
      return false;

    case "elementAt":
      if (value.tag !== "array") return false;
      if (constraint.index >= value.elements.length) return false;
      return valueSatisfies(value.elements[constraint.index], constraint.constraint);

    case "and":
      return constraint.constraints.every(c => valueSatisfies(value, c));

    case "or":
      return constraint.constraints.some(c => valueSatisfies(value, c));

    case "not":
      return !valueSatisfies(value, constraint.constraint);

    case "var":
      // Variables are unknown - assume satisfied
      return true;

    case "isType":
      // Value must be a type
      return value.tag === "type";

    case "fnType":
      // Value must be a closure
      return value.tag === "closure";

    case "rec":
      // Recursive types - check by unrolling
      // For now, assume satisfied if it could be part of the union
      return true;

    case "recVar":
      // Recursive variable references - assume satisfied
      return true;
  }
}

/**
 * Check if a Value equals a raw JS value.
 */
function valueEqualsRaw(value: Value, raw: unknown): boolean {
  switch (value.tag) {
    case "number":
      return value.value === raw;
    case "string":
      return value.value === raw;
    case "bool":
      return value.value === raw;
    case "null":
      return raw === null;
    default:
      // Objects/arrays would need deep comparison
      return false;
  }
}

// ============================================================================
// Pretty Printing
// ============================================================================

export function valueToString(value: Value): string {
  switch (value.tag) {
    case "number":
      return String(value.value);

    case "string":
      return JSON.stringify(value.value);

    case "bool":
      return String(value.value);

    case "null":
      return "null";

    case "object": {
      const entries: string[] = [];
      for (const [name, val] of value.fields) {
        entries.push(`${name}: ${valueToString(val)}`);
      }
      return `{ ${entries.join(", ")} }`;
    }

    case "array":
      return `[${value.elements.map(valueToString).join(", ")}]`;

    case "closure":
      return value.name
        ? `<fn ${value.name}(${value.params.join(", ")})>`
        : `<fn(${value.params.join(", ")})>`;

    case "type":
      return `Type<${constraintToString(value.constraint)}>`;

    case "builtin":
      return `<builtin ${value.name}>`;
  }
}

/**
 * Convert a raw JS value to a Value.
 */
export function valueFromRaw(raw: unknown): Value {
  if (typeof raw === "number") return numberVal(raw);
  if (typeof raw === "string") return stringVal(raw);
  if (typeof raw === "boolean") return boolVal(raw);
  if (raw === null) return nullVal;
  if (Array.isArray(raw)) return arrayVal(raw.map(valueFromRaw));
  if (typeof raw === "object" && raw !== null) {
    const fields: Record<string, Value> = {};
    for (const [k, v] of Object.entries(raw)) {
      fields[k] = valueFromRaw(v);
    }
    return objectVal(fields);
  }
  throw new Error(`Cannot convert to Value: ${raw}`);
}

/**
 * Convert a Value to a raw JS value.
 */
export function valueToRaw(value: Value): unknown {
  switch (value.tag) {
    case "number":
    case "string":
    case "bool":
      return value.value;
    case "null":
      return null;
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value.fields) {
        obj[k] = valueToRaw(v);
      }
      return obj;
    }
    case "array":
      return value.elements.map(valueToRaw);
    case "closure":
      throw new Error("Cannot convert closure to raw value");
    case "type":
      throw new Error("Cannot convert type to raw value");
    case "builtin":
      throw new Error("Cannot convert builtin to raw value");
  }
}
