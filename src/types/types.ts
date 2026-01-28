/**
 * Type representation for the DepJS type system.
 *
 * Types are first-class values in DepJS that can be manipulated at compile time.
 * This module defines the internal representation of types during compilation.
 */

// Primitive type names
export type PrimitiveName =
  | "Int"
  | "Float"
  | "Number"
  | "String"
  | "Boolean"
  | "Null"
  | "Undefined"
  | "Never"
  | "Unknown"
  | "Void"
  | "Type"; // The meta-type of all types

// Base type for literal types
export type LiteralBaseType = "Int" | "Float" | "String" | "Boolean";

/**
 * Typed annotation - stores both the value and its type.
 */
export type TypedAnnotation = {
  value: unknown;
  type: Type;
};

/**
 * Field information for record types.
 */
export type FieldInfo = {
  name: string;
  type: Type;
  optional: boolean;
  annotations: TypedAnnotation[];
};

/**
 * Parameter information for function types.
 */
export type ParamInfo = {
  name: string;
  type: Type;
  optional: boolean;
  rest?: boolean; // True if this is a rest parameter
};

/**
 * Metadata attached to types via WithMetadata.
 */
export type TypeMetadata = {
  name?: string;
  typeArgs?: Type[];
  annotations?: TypedAnnotation[];
};

/**
 * The Type discriminated union - internal representation of all types.
 */
export type Type =
  | PrimitiveType
  | LiteralType
  | RecordType
  | FunctionType
  | ArrayType
  | UnionType
  | IntersectionType
  | BrandedType
  | TypeVarType
  | ThisType
  | WithMetadataType
  | BoundedTypeType
  | KeyofType
  | IndexedAccessType;

export type PrimitiveType = {
  kind: "primitive";
  name: PrimitiveName;
};

export type LiteralType = {
  kind: "literal";
  value: string | number | boolean;
  baseType: LiteralBaseType;
};

export type RecordType = {
  kind: "record";
  fields: FieldInfo[];
  indexType?: Type; // For { [key: string]: T }
  closed: boolean; // True for {| ... |} syntax
};

export type FunctionType = {
  kind: "function";
  params: ParamInfo[];
  returnType: Type;
  async: boolean;
};

/**
 * Element definition for array types.
 * Supports labels (e.g., [x: Int, y: Int]) and spread (e.g., [Int, ...String]).
 */
export type ArrayElementDef = {
  type: Type;
  label?: string;
  spread?: boolean; // True for ...Type (rest element)
};

export type ArrayType = {
  kind: "array";
  elements: ArrayElementDef[];
  // Derived: isVariadic = any element has spread: true
  // For backwards compat: single spread element = variadic, else fixed-length
};

export type UnionType = {
  kind: "union";
  types: Type[];
};

export type IntersectionType = {
  kind: "intersection";
  types: Type[];
};

export type BrandedType = {
  kind: "branded";
  baseType: Type;
  brand: string;
  name: string;
};

export type TypeVarType = {
  kind: "typeVar";
  name: string;
  bound?: Type;
};

export type ThisType = {
  kind: "this";
};

export type WithMetadataType = {
  kind: "withMetadata";
  baseType: Type;
  metadata: TypeMetadata;
};

/**
 * Bounded type - represents Type<Bound>.
 * A metatype for type parameters that must be subtypes of the bound.
 */
export type BoundedTypeType = {
  kind: "boundedType";
  bound: Type;
};

/**
 * Keyof type - represents `keyof T`.
 * Returns a union of string literal types for the keys of the operand type.
 * This is used when the operand is not yet fully resolved (e.g., a type variable).
 */
export type KeyofType = {
  kind: "keyof";
  operand: Type;
};

/**
 * Indexed access type - represents `T[K]`.
 * Returns the type of property K on type T.
 * Used when the types are not yet fully resolved.
 */
export type IndexedAccessType = {
  kind: "indexedAccess";
  objectType: Type;
  indexType: Type;
};

// ============================================
// Type constructors (convenience functions)
// ============================================

export function primitiveType(name: PrimitiveName): PrimitiveType {
  return { kind: "primitive", name };
}

export function literalType(
  value: string | number | boolean,
  baseType: LiteralBaseType
): LiteralType {
  return { kind: "literal", value, baseType };
}

export function recordType(
  fields: FieldInfo[],
  options: { indexType?: Type; closed?: boolean } = {}
): RecordType {
  return {
    kind: "record",
    fields,
    indexType: options.indexType,
    closed: options.closed ?? false,
  };
}

export function functionType(
  params: ParamInfo[],
  returnType: Type,
  async: boolean = false
): FunctionType {
  return { kind: "function", params, returnType, async };
}

/**
 * Create an array type from types and variadic flag (backward compatible).
 * For variadic arrays, pass a single type and variadic=true.
 * For fixed arrays, pass multiple types and variadic=false.
 */
export function arrayType(
  elementTypes: Type[],
  variadic: boolean = false
): ArrayType {
  if (variadic) {
    // Single spread element
    return {
      kind: "array",
      elements: [{ type: elementTypes[0] || primitiveType("Unknown"), spread: true }],
    };
  }
  // Fixed-length array
  return {
    kind: "array",
    elements: elementTypes.map(type => ({ type })),
  };
}

/**
 * Create an array type from element definitions.
 */
export function arrayTypeFromElements(elements: ArrayElementDef[]): ArrayType {
  return { kind: "array", elements };
}

/**
 * Check if an array type is variadic (has any spread element).
 */
export function isVariadicArray(arr: ArrayType): boolean {
  return arr.elements.some(e => e.spread === true);
}

/**
 * Get the element types from an array type (for backward compatibility).
 * For variadic arrays, returns the single element type.
 * For fixed arrays, returns all element types.
 */
export function getArrayElementTypes(arr: ArrayType): Type[] {
  return arr.elements.map(e => e.type);
}

export function unionType(types: Type[]): Type {
  // Flatten nested unions
  const flattened: Type[] = [];
  for (const t of types) {
    if (t.kind === "union") {
      flattened.push(...t.types);
    } else {
      flattened.push(t);
    }
  }

  // Handle degenerate cases
  if (flattened.length === 0) return primitiveType("Never");
  if (flattened.length === 1) return flattened[0];

  return { kind: "union", types: flattened };
}

export function intersectionType(types: Type[]): Type {
  // Flatten nested intersections
  const flattened: Type[] = [];
  for (const t of types) {
    if (t.kind === "intersection") {
      flattened.push(...t.types);
    } else {
      flattened.push(t);
    }
  }

  // Handle degenerate cases
  if (flattened.length === 0) return primitiveType("Unknown");
  if (flattened.length === 1) return flattened[0];

  // Check for Never (any intersection with Never is Never)
  if (flattened.some((t) => t.kind === "primitive" && t.name === "Never")) {
    return primitiveType("Never");
  }

  return { kind: "intersection", types: flattened };
}

export function brandedType(
  baseType: Type,
  brand: string,
  name: string
): BrandedType {
  return { kind: "branded", baseType, brand, name };
}

export function typeVarType(name: string, bound?: Type): TypeVarType {
  return { kind: "typeVar", name, bound };
}

export function thisType(): ThisType {
  return { kind: "this" };
}

export function withMetadata(
  baseType: Type,
  metadata: TypeMetadata
): WithMetadataType {
  return { kind: "withMetadata", baseType, metadata };
}

export function boundedType(bound: Type): BoundedTypeType {
  return { kind: "boundedType", bound };
}

export function keyofType(operand: Type): KeyofType {
  return { kind: "keyof", operand };
}

export function indexedAccessType(objectType: Type, indexType: Type): IndexedAccessType {
  return { kind: "indexedAccess", objectType, indexType };
}

// ============================================
// Built-in primitive types
// ============================================

export const Int: PrimitiveType = primitiveType("Int");
export const Float: PrimitiveType = primitiveType("Float");
export const Num: PrimitiveType = primitiveType("Number");
export const Str: PrimitiveType = primitiveType("String");
export const Bool: PrimitiveType = primitiveType("Boolean");
export const Null: PrimitiveType = primitiveType("Null");
export const Undefined: PrimitiveType = primitiveType("Undefined");
export const Never: PrimitiveType = primitiveType("Never");
export const Unknown: PrimitiveType = primitiveType("Unknown");
export const Void: PrimitiveType = primitiveType("Void");
export const TypeType: PrimitiveType = primitiveType("Type");

// ============================================
// Type utilities
// ============================================

/**
 * Check if a type is the Type meta-type.
 */
export function isTypeType(t: Type): boolean {
  if (t.kind === "primitive" && t.name === "Type") return true;
  if (t.kind === "withMetadata") return isTypeType(t.baseType);
  return false;
}

/**
 * Check if a type is or contains Type (comptime-only).
 */
export function containsTypeType(t: Type): boolean {
  switch (t.kind) {
    case "primitive":
      return t.name === "Type";
    case "literal":
      return false;
    case "record":
      return t.fields.some((f) => containsTypeType(f.type));
    case "function":
      return (
        t.params.some((p) => containsTypeType(p.type)) ||
        containsTypeType(t.returnType)
      );
    case "array":
      return t.elements.some(e => containsTypeType(e.type));
    case "union":
    case "intersection":
      return t.types.some(containsTypeType);
    case "branded":
      return containsTypeType(t.baseType);
    case "typeVar":
      return t.bound ? containsTypeType(t.bound) : false;
    case "this":
      return false;
    case "withMetadata":
      return containsTypeType(t.baseType);
    case "boundedType":
      return true; // Type<Bound> contains Type
    case "keyof":
      return containsTypeType(t.operand);
    case "indexedAccess":
      return containsTypeType(t.objectType) || containsTypeType(t.indexType);
  }
}

/**
 * Unwrap WithMetadata to get the base type.
 */
export function unwrapMetadata(t: Type): Type {
  return t.kind === "withMetadata" ? t.baseType : t;
}

/**
 * Get metadata from a type, if any.
 */
export function getMetadata(t: Type): TypeMetadata | undefined {
  return t.kind === "withMetadata" ? t.metadata : undefined;
}

/**
 * Substitute `This` type with a concrete receiver type.
 * Used for fluent interface support.
 */
export function substituteThis(type: Type, receiverType: Type): Type {
  switch (type.kind) {
    case "this":
      return receiverType;
    case "primitive":
    case "literal":
    case "typeVar":
    case "boundedType":
      return type;
    case "record":
      return recordType(
        type.fields.map((f) => ({
          ...f,
          type: substituteThis(f.type, receiverType),
        })),
        {
          indexType: type.indexType
            ? substituteThis(type.indexType, receiverType)
            : undefined,
          closed: type.closed,
        }
      );
    case "function":
      return functionType(
        type.params.map((p) => ({
          ...p,
          type: substituteThis(p.type, receiverType),
        })),
        substituteThis(type.returnType, receiverType),
        type.async
      );
    case "array":
      return arrayTypeFromElements(
        type.elements.map(e => ({
          ...e,
          type: substituteThis(e.type, receiverType),
        }))
      );
    case "union":
      return unionType(type.types.map((t) => substituteThis(t, receiverType)));
    case "intersection":
      return intersectionType(
        type.types.map((t) => substituteThis(t, receiverType))
      );
    case "branded":
      return brandedType(
        substituteThis(type.baseType, receiverType),
        type.brand,
        type.name
      );
    case "withMetadata":
      return withMetadata(
        substituteThis(type.baseType, receiverType),
        type.metadata
      );
    case "keyof":
      return keyofType(substituteThis(type.operand, receiverType));
    case "indexedAccess":
      return indexedAccessType(
        substituteThis(type.objectType, receiverType),
        substituteThis(type.indexType, receiverType)
      );
  }
}

/**
 * Check if a type contains `This`.
 */
export function containsThis(type: Type): boolean {
  switch (type.kind) {
    case "this":
      return true;
    case "primitive":
    case "literal":
    case "typeVar":
    case "boundedType":
      return false;
    case "record":
      return (
        type.fields.some((f) => containsThis(f.type)) ||
        (type.indexType ? containsThis(type.indexType) : false)
      );
    case "function":
      return (
        type.params.some((p) => containsThis(p.type)) ||
        containsThis(type.returnType)
      );
    case "array":
      return type.elements.some(e => containsThis(e.type));
    case "union":
    case "intersection":
      return type.types.some(containsThis);
    case "branded":
    case "withMetadata":
      return containsThis(type.baseType);
    case "keyof":
      return containsThis(type.operand);
    case "indexedAccess":
      return containsThis(type.objectType) || containsThis(type.indexType);
  }
}
