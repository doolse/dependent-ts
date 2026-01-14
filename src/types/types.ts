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
 * Field information for record types.
 */
export type FieldInfo = {
  name: string;
  type: Type;
  optional: boolean;
  annotations: unknown[];
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
  annotations?: unknown[];
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
  | BoundedTypeType;

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

export type ArrayType = {
  kind: "array";
  elementTypes: Type[];
  variadic: boolean; // False for fixed-length arrays like [Int, String]
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

export function arrayType(
  elementTypes: Type[],
  variadic: boolean = false
): ArrayType {
  return { kind: "array", elementTypes, variadic };
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
      return t.elementTypes.some(containsTypeType);
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
