/**
 * Type property access - implements .name, .fields, .fieldNames, etc.
 *
 * Type properties are accessed when evaluating expressions like `T.fields`.
 * Some properties are runtime-usable (return String, Number, etc.),
 * while others are comptime-only (return Type or contain Type).
 */

import {
  Type,
  FieldInfo,
  unwrapMetadata,
  getMetadata,
  unionType,
  primitiveType,
  isVariadicArray,
  getArrayElementTypes,
  arrayType,
} from "../types/types";
import { formatType } from "../types/format";
import { isSubtype } from "../types/subtype";
import { CompileError, SourceLocation } from "../ast/core-ast";
import {
  TypedComptimeValue,
  ComptimeBuiltin,
  ComptimeEvaluatorInterface,
  wrapValue,
  wrapTypeValue,
  RawComptimeValue,
  isRawTypeValue,
} from "./comptime-env";

/**
 * Get a property from a Type value.
 */
export function getTypeProperty(
  type: Type,
  prop: string,
  evaluator: ComptimeEvaluatorInterface,
  loc?: SourceLocation
): TypedComptimeValue {
  const base = unwrapMetadata(type);
  const metadata = getMetadata(type);

  switch (prop) {
    // ============================================
    // Runtime-usable properties (return primitives)
    // ============================================

    case "name":
      return wrapValue(
        getTypeName(type),
        unionType([primitiveType("String"), primitiveType("Undefined")])
      );

    case "baseName":
      // For parameterized types, just the name without type args
      return wrapValue(
        metadata?.name ?? getSimpleTypeName(base),
        unionType([primitiveType("String"), primitiveType("Undefined")])
      );

    case "fieldNames":
      if (base.kind !== "record") {
        throw new CompileError(
          `'fieldNames' is only valid on record types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return wrapValue(
        base.fields.map((f) => f.name),
        arrayType([primitiveType("String")], true)
      );

    case "length":
      if (base.kind !== "array") {
        return wrapValue(undefined, primitiveType("Undefined"));
      }
      return wrapValue(
        isVariadicArray(base) ? undefined : base.elements.length,
        unionType([primitiveType("Int"), primitiveType("Undefined")])
      );

    case "isFixed":
      if (base.kind !== "array") {
        return wrapValue(false, primitiveType("Boolean"));
      }
      return wrapValue(!isVariadicArray(base), primitiveType("Boolean"));

    case "brand":
      return wrapValue(
        base.kind === "branded" ? base.brand : undefined,
        unionType([primitiveType("String"), primitiveType("Undefined")])
      );

    // ============================================
    // ComptimeOnly properties (return Type or contain Type)
    // ============================================

    case "fields":
      if (base.kind !== "record") {
        throw new CompileError(
          `'fields' is only valid on record types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      // Return Array<FieldInfo> - contains Type values
      // FieldInfo type: { name: String, type: Type, optional: Boolean, annotations: Array<Unknown> }
      const FieldInfoType: Type = {
        kind: "record",
        fields: [
          { name: "name", type: primitiveType("String"), optional: false, annotations: [] },
          { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
          { name: "optional", type: primitiveType("Boolean"), optional: false, annotations: [] },
          { name: "annotations", type: arrayType([primitiveType("Unknown")], true), optional: false, annotations: [] },
        ],
        closed: false,
      };
      return wrapValue(
        base.fields.map((f) => ({
          name: f.name,
          type: f.type,
          optional: f.optional,
          annotations: f.annotations as RawComptimeValue[],
        })),
        arrayType([FieldInfoType], true)
      );

    case "variants":
      if (base.kind !== "union") {
        throw new CompileError(
          `'variants' is only valid on union types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return wrapValue(
        base.types,
        arrayType([primitiveType("Type")], true)
      );

    case "typeArgs":
      return wrapValue(
        metadata?.typeArgs ?? [],
        arrayType([primitiveType("Type")], true)
      );

    case "elementType":
      if (base.kind !== "array") {
        throw new CompileError(
          `'elementType' is only valid on array types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return wrapTypeValue(unionType(getArrayElementTypes(base)));

    case "elements":
      // ArrayElementInfo type: { type: Type, label: String | Undefined, spread: Boolean | Undefined }
      const ArrayElementInfoType: Type = {
        kind: "record",
        fields: [
          { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
          { name: "label", type: unionType([primitiveType("String"), primitiveType("Undefined")]), optional: false, annotations: [] },
          { name: "spread", type: unionType([primitiveType("Boolean"), primitiveType("Undefined")]), optional: false, annotations: [] },
        ],
        closed: false,
      };
      if (base.kind !== "array") {
        return wrapValue(undefined, primitiveType("Undefined"));
      }
      if (isVariadicArray(base)) {
        return wrapValue(undefined, primitiveType("Undefined"));
      }
      // Return ArrayElementInfo[] with actual labels and spread info
      return wrapValue(
        base.elements.map(e => ({
          type: e.type,
          label: e.label,
          spread: e.spread,
        })),
        arrayType([ArrayElementInfoType], true)
      );

    case "returnType":
      if (base.kind === "intersection") {
        throw new CompileError(
          `'returnType' is ambiguous for overloaded functions. Use '.signatures' instead.`,
          "typecheck",
          loc
        );
      }
      if (base.kind !== "function") {
        throw new CompileError(
          `'returnType' is only valid on function types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return wrapTypeValue(base.returnType);

    case "parameterTypes":
      if (base.kind === "intersection") {
        throw new CompileError(
          `'parameterTypes' is ambiguous for overloaded functions. Use '.signatures' instead.`,
          "typecheck",
          loc
        );
      }
      if (base.kind !== "function") {
        throw new CompileError(
          `'parameterTypes' is only valid on function types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return wrapValue(
        base.params.map((p) => p.type),
        arrayType([primitiveType("Type")], true)
      );

    case "baseType":
      if (base.kind === "branded") {
        return wrapTypeValue(base.baseType);
      }
      if (base.kind === "withMetadata") {
        return wrapTypeValue(base.baseType);
      }
      return wrapValue(undefined, primitiveType("Undefined"));

    case "keysType":
      if (base.kind !== "record") {
        throw new CompileError(
          `'keysType' is only valid on record types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      // Return union of literal string types for field names
      if (base.fields.length === 0) {
        return wrapTypeValue(primitiveType("Never"));
      }
      return wrapTypeValue(
        unionType(
          base.fields.map((f) => ({
            kind: "literal" as const,
            value: f.name,
            baseType: "String" as const,
          }))
        )
      );

    case "indexType":
      if (base.kind !== "record") {
        return wrapValue(undefined, primitiveType("Undefined"));
      }
      // Closed records return Never as indexType (per spec)
      if (base.closed) {
        return wrapTypeValue(primitiveType("Never"));
      }
      if (base.indexType) {
        return wrapTypeValue(base.indexType);
      }
      return wrapValue(undefined, primitiveType("Undefined"));

    case "annotations":
      // Extract just the values from TypedAnnotation[]
      const annValues = (metadata?.annotations ?? []).map(ann => ann.value);
      return wrapValue(
        annValues as RawComptimeValue[],
        arrayType([primitiveType("Unknown")], true)
      );

    case "closed":
      if (base.kind !== "record") {
        return wrapValue(false, primitiveType("Boolean"));
      }
      return wrapValue(base.closed, primitiveType("Boolean"));

    case "async":
      if (base.kind !== "function") {
        return wrapValue(false, primitiveType("Boolean"));
      }
      return wrapValue(base.async, primitiveType("Boolean"));

    case "signatures":
      if (base.kind !== "intersection") {
        throw new CompileError(
          `'signatures' is only valid on intersection types (overloaded functions), got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      // Return only the function types from the intersection
      return wrapValue(
        base.types.filter((t) => t.kind === "function"),
        arrayType([primitiveType("Type")], true)
      );

    // ============================================
    // Methods (return functions)
    // ============================================

    case "extends":
      return wrapValue(createExtendsMethod(type), {
        kind: "function",
        params: [{ name: "other", type: primitiveType("Type"), optional: false }],
        returnType: primitiveType("Boolean"),
        async: false,
      });

    case "annotation":
      return wrapValue(createAnnotationMethod(type, metadata), {
        kind: "function",
        params: [{ name: "annotationType", type: primitiveType("Type"), optional: false }],
        returnType: primitiveType("Unknown"),
        async: false,
      });

    default:
      throw new CompileError(
        `Type has no property '${prop}'`,
        "typecheck",
        loc
      );
  }
}

/**
 * Get the full name of a type (including type arguments).
 */
function getTypeName(type: Type): string | undefined {
  const metadata = getMetadata(type);
  if (metadata?.name) {
    const typeArgs = metadata.typeArgs;
    if (typeArgs && typeArgs.length > 0) {
      const argNames = typeArgs.map((t) => getTypeName(t) ?? "?").join(", ");
      return `${metadata.name}<${argNames}>`;
    }
    return metadata.name;
  }
  return getSimpleTypeName(unwrapMetadata(type));
}

/**
 * Get simple type name without metadata.
 */
function getSimpleTypeName(type: Type): string | undefined {
  switch (type.kind) {
    case "primitive":
      return type.name;
    case "literal":
      return undefined; // Literals don't have names
    case "branded":
      return type.name;
    default:
      return undefined;
  }
}

/**
 * Create the T.extends(U) method.
 */
function createExtendsMethod(type: Type): ComptimeBuiltin {
  return {
    kind: "builtin",
    name: "Type.extends",
    impl: (args, _evaluator, loc) => {
      if (args.length !== 1) {
        throw new CompileError(
          `extends() expects 1 argument, got ${args.length}`,
          "typecheck",
          loc
        );
      }
      const rawArg = args[0].value;
      if (!isRawTypeValue(rawArg)) {
        throw new CompileError(
          `extends() argument must be a Type`,
          "typecheck",
          loc
        );
      }
      return wrapValue(isSubtype(type, rawArg), primitiveType("Boolean"));
    },
  };
}

/**
 * Create the T.annotation<A>() method.
 * Returns the first annotation whose type is a subtype of the requested type.
 */
function createAnnotationMethod(
  type: Type,
  metadata: ReturnType<typeof getMetadata>
): ComptimeBuiltin {
  return {
    kind: "builtin",
    name: "Type.annotation",
    impl: (args, _evaluator, loc) => {
      if (args.length !== 1) {
        throw new CompileError(
          `annotation() expects 1 type argument`,
          "typecheck",
          loc
        );
      }

      const rawArg = args[0].value;
      if (!isRawTypeValue(rawArg)) {
        throw new CompileError(
          `annotation() argument must be a Type`,
          "typecheck",
          loc
        );
      }
      const annotationType = rawArg as Type;
      const annotations = metadata?.annotations ?? [];

      // Find first annotation whose type is a subtype of the requested type
      for (const ann of annotations) {
        if (ann.value !== undefined && isSubtype(ann.type, annotationType)) {
          return wrapValue(ann.value as RawComptimeValue, ann.type);
        }
      }

      return wrapValue(undefined, primitiveType("Undefined"));
    },
  };
}

/**
 * Check if a property is comptime-only.
 */
export function isComptimeOnlyProperty(prop: string): boolean {
  const comptimeOnlyProps = new Set([
    "fields",
    "variants",
    "typeArgs",
    "elementType",
    "elements",
    "returnType",
    "parameterTypes",
    "baseType",
    "keysType",
    "indexType",
    "annotations",
    "extends",
    "annotation",
    "signatures",
  ]);
  return comptimeOnlyProps.has(prop);
}

/**
 * Check if a property is runtime-usable.
 */
export function isRuntimeUsableProperty(prop: string): boolean {
  const runtimeProps = new Set([
    "name",
    "baseName",
    "fieldNames",
    "length",
    "isFixed",
    "brand",
    "closed",
    "async",
  ]);
  return runtimeProps.has(prop);
}

/**
 * Get the static type of a Type property.
 * This allows the type checker to know the return types of property accesses
 * like T.fields, T.returnType, etc.
 */
export function getTypePropertyType(prop: string): Type | undefined {
  // FieldInfo type: { name: String, type: Type, optional: Boolean, annotations: Array<Unknown> }
  const FieldInfoType: Type = {
    kind: "record",
    fields: [
      { name: "name", type: primitiveType("String"), optional: false, annotations: [] },
      { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
      { name: "optional", type: primitiveType("Boolean"), optional: false, annotations: [] },
      { name: "annotations", type: arrayType([primitiveType("Unknown")], true), optional: false, annotations: [] },
    ],
    closed: false,
  };

  // ArrayElementInfo type: { type: Type, label: String | Undefined }
  const ArrayElementInfoType: Type = {
    kind: "record",
    fields: [
      { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
      { name: "label", type: unionType([primitiveType("String"), primitiveType("Undefined")]), optional: false, annotations: [] },
    ],
    closed: false,
  };

  switch (prop) {
    // Runtime-usable properties
    case "name":
      return unionType([primitiveType("String"), primitiveType("Undefined")]);
    case "baseName":
      return unionType([primitiveType("String"), primitiveType("Undefined")]);
    case "fieldNames":
      return arrayType([primitiveType("String")], true);
    case "length":
      return unionType([primitiveType("Int"), primitiveType("Undefined")]);
    case "isFixed":
      return primitiveType("Boolean");
    case "brand":
      return unionType([primitiveType("String"), primitiveType("Undefined")]);
    case "closed":
      return primitiveType("Boolean");
    case "async":
      return primitiveType("Boolean");

    // Comptime-only properties returning Type
    case "elementType":
      return primitiveType("Type");
    case "returnType":
      return primitiveType("Type");
    case "baseType":
      return unionType([primitiveType("Type"), primitiveType("Undefined")]);
    case "keysType":
      return primitiveType("Type");
    case "indexType":
      return unionType([primitiveType("Type"), primitiveType("Undefined")]);

    // Comptime-only properties returning arrays
    case "fields":
      return arrayType([FieldInfoType], true);
    case "variants":
      return arrayType([primitiveType("Type")], true);
    case "typeArgs":
      return arrayType([primitiveType("Type")], true);
    case "parameterTypes":
      return arrayType([primitiveType("Type")], true);
    case "elements":
      return unionType([
        arrayType([ArrayElementInfoType], true),
        primitiveType("Undefined"),
      ]);
    case "annotations":
      return arrayType([primitiveType("Unknown")], true);
    case "signatures":
      // Returns Array<FunctionType> - array of function types
      return arrayType([primitiveType("Type")], true);

    // Methods
    case "extends":
      // (Type) => Boolean
      return {
        kind: "function",
        params: [{ name: "other", type: primitiveType("Type"), optional: false }],
        returnType: primitiveType("Boolean"),
        async: false,
      };
    case "annotation":
      // (Type) => Unknown (simplified - actually generic)
      return {
        kind: "function",
        params: [{ name: "annotationType", type: primitiveType("Type"), optional: false }],
        returnType: primitiveType("Unknown"),
        async: false,
      };

    default:
      return undefined;
  }
}
