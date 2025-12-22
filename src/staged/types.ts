/**
 * Type values - always known at specialization time.
 * Based on docs/staged-architecture.md Part 3.1
 */

export type TypeValue =
  | PrimitiveType
  | ObjectType
  | LiteralType
  | ArrayType
  | MetaType
  | FunctionType;

export interface PrimitiveType {
  tag: "primitive";
  name: "number" | "string" | "boolean";
}

export interface ObjectType {
  tag: "object";
  fields: ObjectField[];
}

export interface ObjectField {
  name: string;
  type: TypeValue;
  optional?: boolean;
  readonly?: boolean;
}

export interface LiteralType {
  tag: "literal";
  value: string | number | boolean;
}

export interface ArrayType {
  tag: "array";
  element: TypeValue;
}

/**
 * The metatype - the type of types themselves.
 * Used for reflection operations that return types as values.
 */
export interface MetaType {
  tag: "metatype";
}

/**
 * Function type - for first-class functions.
 */
export interface FunctionType {
  tag: "function";
  params: TypeValue[];
  returnType: TypeValue;
}

// Type constructors
export const numberType: PrimitiveType = { tag: "primitive", name: "number" };
export const stringType: PrimitiveType = { tag: "primitive", name: "string" };
export const boolType: PrimitiveType = { tag: "primitive", name: "boolean" };
export const metatype: MetaType = { tag: "metatype" };

export function literalType(value: string | number | boolean): LiteralType {
  return { tag: "literal", value };
}

export function objectType(fields: ObjectField[]): ObjectType {
  return { tag: "object", fields };
}

export function arrayType(element: TypeValue): ArrayType {
  return { tag: "array", element };
}

export function functionType(params: TypeValue[], returnType: TypeValue): FunctionType {
  return { tag: "function", params, returnType };
}

/**
 * Infer type from a runtime value.
 */
export function inferType(value: unknown): TypeValue {
  if (typeof value === "number") return numberType;
  if (typeof value === "string") return stringType;
  if (typeof value === "boolean") return boolType;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return arrayType({ tag: "primitive", name: "string" }); // Default element type
    }
    return arrayType(inferType(value[0]));
  }
  if (typeof value === "object" && value !== null) {
    const fields: ObjectField[] = Object.entries(value).map(([name, v]) => ({
      name,
      type: inferType(v),
    }));
    return objectType(fields);
  }
  throw new Error(`Cannot infer type for: ${value}`);
}

/**
 * Widen a literal type to its base primitive type.
 */
export function widenType(t: TypeValue): TypeValue {
  if (t.tag === "literal") {
    return { tag: "primitive", name: typeof t.value as "number" | "string" | "boolean" };
  }
  return t;
}

/**
 * Convert type to string for display.
 */
export function typeToString(t: TypeValue): string {
  switch (t.tag) {
    case "primitive":
      return t.name;
    case "literal":
      return JSON.stringify(t.value);
    case "object": {
      const fields = t.fields.map((f) => {
        const opt = f.optional ? "?" : "";
        const ro = f.readonly ? "readonly " : "";
        return `${ro}${f.name}${opt}: ${typeToString(f.type)}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    case "array":
      return `${typeToString(t.element)}[]`;
    case "metatype":
      return "Type";
    case "function": {
      const params = t.params.map(typeToString).join(", ");
      return `(${params}) => ${typeToString(t.returnType)}`;
    }
  }
}

/**
 * Check if two types are structurally equal.
 */
export function typeEquals(a: TypeValue, b: TypeValue): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    case "primitive":
      return a.name === (b as PrimitiveType).name;
    case "literal":
      return a.value === (b as LiteralType).value;
    case "object": {
      const bObj = b as ObjectType;
      if (a.fields.length !== bObj.fields.length) return false;
      return a.fields.every((af) => {
        const bf = bObj.fields.find((f) => f.name === af.name);
        return bf && typeEquals(af.type, bf.type);
      });
    }
    case "array":
      return typeEquals(a.element, (b as ArrayType).element);
    case "metatype":
      return true;
    case "function": {
      const bFn = b as FunctionType;
      if (a.params.length !== bFn.params.length) return false;
      return (
        a.params.every((p, i) => typeEquals(p, bFn.params[i])) &&
        typeEquals(a.returnType, bFn.returnType)
      );
    }
  }
}

/**
 * Check if 'sub' is a subtype of 'sup'.
 * Simplified implementation.
 */
export function isSubtype(sub: TypeValue, sup: TypeValue): boolean {
  // Same type
  if (typeEquals(sub, sup)) return true;

  // Literal is subtype of its base primitive
  if (sub.tag === "literal" && sup.tag === "primitive") {
    return typeof sub.value === sup.name;
  }

  // Object subtyping (width subtyping - sub has at least all fields of sup)
  if (sub.tag === "object" && sup.tag === "object") {
    return sup.fields.every((supField) => {
      const subField = sub.fields.find((f) => f.name === supField.name);
      return subField && isSubtype(subField.type, supField.type);
    });
  }

  // Array subtyping (covariant)
  if (sub.tag === "array" && sup.tag === "array") {
    return isSubtype(sub.element, sup.element);
  }

  return false;
}
