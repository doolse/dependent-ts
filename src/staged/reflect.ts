/**
 * Reflection operations - inspect and manipulate types at specialization time.
 * Based on docs/staged-architecture.md Part 3.3 and 3.4
 */

import { SValue, nowValue, isNow } from "./svalue";
import {
  TypeValue,
  ObjectType,
  ObjectField,
  metatype,
  boolType,
  stringType,
  arrayType,
  objectType,
  typeEquals,
  isSubtype,
  typeToString,
} from "./types";

/**
 * Create a type-as-value (a value whose type is metatype).
 */
export function makeTypeValue(t: TypeValue): SValue {
  return nowValue(metatype, t);
}

/**
 * Check if an SValue is a type value.
 */
export function isTypeValue(v: SValue): boolean {
  return v.type.tag === "metatype";
}

/**
 * Get the TypeValue from a type-as-value SValue.
 */
export function getTypeValue(v: SValue): TypeValue {
  if (!isTypeValue(v)) {
    throw new Error("Expected a type value");
  }
  if (!isNow(v)) {
    throw new Error("Type value must be known at specialization time");
  }
  return v.value as TypeValue;
}

// ============================================================================
// Reflection Primitives (Section 3.3)
// ============================================================================

/**
 * Get the type of any value. Always succeeds, always "now".
 */
export function reflectTypeOf(target: SValue): SValue {
  return makeTypeValue(target.type);
}

/**
 * Get field names from an object type.
 */
export function reflectFields(target: SValue): SValue {
  const type = target.type;
  if (type.tag !== "object") {
    throw new TypeError(`fields() requires object type, got ${type.tag}`);
  }

  return nowValue(arrayType(stringType), type.fields.map((f) => f.name));
}

/**
 * Get the type of a specific field.
 */
export function reflectFieldType(target: SValue, fieldName: SValue): SValue {
  if (!isNow(fieldName)) {
    throw new Error("Field name must be known at specialization time");
  }

  const type = target.type;
  if (type.tag !== "object") {
    throw new TypeError(`fieldType() requires object type`);
  }

  const field = type.fields.find((f) => f.name === fieldName.value);
  if (!field) {
    throw new TypeError(`No field '${fieldName.value}' in type`);
  }

  return makeTypeValue(field.type);
}

/**
 * Check if a value's type has a specific field.
 * This is a type-level check, always returns a "now" boolean.
 */
export function reflectHasField(target: SValue, fieldName: SValue): SValue {
  if (!isNow(fieldName)) {
    throw new Error("Field name must be known at specialization time");
  }

  // If target is a type value (metatype), check if the type has the field
  let typeToCheck: TypeValue;
  if (isTypeValue(target)) {
    typeToCheck = getTypeValue(target);
  } else {
    typeToCheck = target.type;
  }

  if (typeToCheck.tag !== "object") {
    return nowValue(boolType, false);
  }

  const has = typeToCheck.fields.some((f) => f.name === fieldName.value);
  return nowValue(boolType, has);
}

/**
 * Check if a type is a subtype of another.
 */
export function reflectIsSubtype(subtype: SValue, supertype: SValue): SValue {
  if (!isTypeValue(subtype) || !isTypeValue(supertype)) {
    throw new Error("isSubtype() requires type values");
  }

  const result = isSubtype(getTypeValue(subtype), getTypeValue(supertype));
  return nowValue(boolType, result);
}

/**
 * Check if two types are equal.
 */
export function reflectTypeEquals(type1: SValue, type2: SValue): SValue {
  if (!isTypeValue(type1) || !isTypeValue(type2)) {
    throw new Error("typeEquals() requires type values");
  }

  const result = typeEquals(getTypeValue(type1), getTypeValue(type2));
  return nowValue(boolType, result);
}

/**
 * Get the tag of a type (e.g., "object", "primitive", "literal").
 */
export function reflectTypeTag(typeVal: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("typeTag() requires a type value");
  }

  const t = getTypeValue(typeVal);
  return nowValue(stringType, t.tag);
}

// ============================================================================
// Type-Level Operations (Section 3.4)
// ============================================================================

/**
 * Pick specific fields from an object type.
 */
export function typeOpPick(typeVal: SValue, fieldNames: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("pick() requires a type value");
  }
  if (!isNow(fieldNames)) {
    throw new Error("Field names must be known at specialization time");
  }

  const t = getTypeValue(typeVal);
  if (t.tag !== "object") {
    throw new TypeError("pick() requires object type");
  }

  const names = fieldNames.value as string[];
  const newFields = t.fields.filter((f) => names.includes(f.name));
  return makeTypeValue(objectType(newFields));
}

/**
 * Omit specific fields from an object type.
 */
export function typeOpOmit(typeVal: SValue, fieldNames: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("omit() requires a type value");
  }
  if (!isNow(fieldNames)) {
    throw new Error("Field names must be known at specialization time");
  }

  const t = getTypeValue(typeVal);
  if (t.tag !== "object") {
    throw new TypeError("omit() requires object type");
  }

  const names = fieldNames.value as string[];
  const newFields = t.fields.filter((f) => !names.includes(f.name));
  return makeTypeValue(objectType(newFields));
}

/**
 * Make all fields of an object type optional.
 */
export function typeOpPartial(typeVal: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("partial() requires a type value");
  }

  const t = getTypeValue(typeVal);
  if (t.tag !== "object") {
    throw new TypeError("partial() requires object type");
  }

  const newFields = t.fields.map((f) => ({ ...f, optional: true }));
  return makeTypeValue(objectType(newFields));
}

/**
 * Make all fields of an object type required.
 */
export function typeOpRequired(typeVal: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("required() requires a type value");
  }

  const t = getTypeValue(typeVal);
  if (t.tag !== "object") {
    throw new TypeError("required() requires object type");
  }

  const newFields = t.fields.map((f) => ({ ...f, optional: false }));
  return makeTypeValue(objectType(newFields));
}

/**
 * Merge two object types (second overrides first).
 */
export function typeOpMerge(type1: SValue, type2: SValue): SValue {
  if (!isTypeValue(type1) || !isTypeValue(type2)) {
    throw new Error("merge() requires type values");
  }

  const t1 = getTypeValue(type1);
  const t2 = getTypeValue(type2);

  if (t1.tag !== "object" || t2.tag !== "object") {
    throw new TypeError("merge() requires object types");
  }

  const fields: ObjectField[] = [...t1.fields];
  for (const f2 of t2.fields) {
    const existing = fields.findIndex((f) => f.name === f2.name);
    if (existing >= 0) {
      fields[existing] = f2; // Override
    } else {
      fields.push(f2);
    }
  }

  return makeTypeValue(objectType(fields));
}

/**
 * Get the element type of an array type.
 */
export function typeOpElementType(typeVal: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("elementType() requires a type value");
  }

  const t = getTypeValue(typeVal);
  if (t.tag !== "array") {
    throw new TypeError("elementType() requires array type");
  }

  return makeTypeValue(t.element);
}

/**
 * Construct an object type from field definitions.
 */
export function typeOpMakeObject(fields: SValue): SValue {
  if (!isNow(fields)) {
    throw new Error("Type construction requires known values");
  }

  const fieldArray = fields.value as Array<{
    name: string;
    type: TypeValue;
    optional?: boolean;
    readonly?: boolean;
  }>;

  const objectFields: ObjectField[] = fieldArray.map((f) => ({
    name: f.name,
    type: f.type,
    optional: f.optional ?? false,
    readonly: f.readonly ?? false,
  }));

  return makeTypeValue(objectType(objectFields));
}

/**
 * Convert a type value to its string representation.
 */
export function reflectTypeToString(typeVal: SValue): SValue {
  if (!isTypeValue(typeVal)) {
    throw new Error("typeToString() requires a type value");
  }

  const t = getTypeValue(typeVal);
  return nowValue(stringType, typeToString(t));
}
