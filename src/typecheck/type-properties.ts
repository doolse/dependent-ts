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
} from "../types/types.js";
import { formatType } from "../types/format.js";
import { isSubtype } from "../types/subtype.js";
import { CompileError, SourceLocation } from "../ast/core-ast.js";
import {
  ComptimeValue,
  ComptimeBuiltin,
  ComptimeEvaluatorInterface,
} from "./comptime-env.js";

/**
 * Get a property from a Type value.
 */
export function getTypeProperty(
  type: Type,
  prop: string,
  evaluator: ComptimeEvaluatorInterface,
  loc?: SourceLocation
): ComptimeValue {
  const base = unwrapMetadata(type);
  const metadata = getMetadata(type);

  switch (prop) {
    // ============================================
    // Runtime-usable properties (return primitives)
    // ============================================

    case "name":
      return getTypeName(type);

    case "baseName":
      // For parameterized types, just the name without type args
      return metadata?.name ?? getSimpleTypeName(base);

    case "fieldNames":
      if (base.kind !== "record") {
        throw new CompileError(
          `'fieldNames' is only valid on record types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return base.fields.map((f) => f.name);

    case "length":
      if (base.kind !== "array") {
        return undefined;
      }
      return base.variadic ? undefined : base.elementTypes.length;

    case "isFixed":
      if (base.kind !== "array") {
        return false;
      }
      return !base.variadic;

    case "brand":
      return base.kind === "branded" ? base.brand : undefined;

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
      // Cast annotations to ComptimeValue[] since we know they are valid comptime values
      return base.fields.map((f) => ({
        name: f.name,
        type: f.type,
        optional: f.optional,
        annotations: f.annotations as ComptimeValue[],
      }));

    case "variants":
      if (base.kind !== "union") {
        throw new CompileError(
          `'variants' is only valid on union types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return base.types;

    case "typeArgs":
      return metadata?.typeArgs ?? [];

    case "elementType":
      if (base.kind !== "array") {
        throw new CompileError(
          `'elementType' is only valid on array types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return unionType(base.elementTypes);

    case "elements":
      if (base.kind !== "array") {
        return undefined;
      }
      if (base.variadic) {
        return undefined;
      }
      // Return ArrayElementInfo[]
      return base.elementTypes.map((t, i) => ({
        type: t,
        label: undefined, // TODO: track labels
      }));

    case "returnType":
      if (base.kind !== "function") {
        throw new CompileError(
          `'returnType' is only valid on function types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return base.returnType;

    case "parameterTypes":
      if (base.kind !== "function") {
        throw new CompileError(
          `'parameterTypes' is only valid on function types, got ${formatType(type)}`,
          "typecheck",
          loc
        );
      }
      return base.params.map((p) => p.type);

    case "baseType":
      if (base.kind === "branded") {
        return base.baseType;
      }
      if (base.kind === "withMetadata") {
        return base.baseType;
      }
      return undefined;

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
        return primitiveType("Never");
      }
      return unionType(
        base.fields.map((f) => ({
          kind: "literal" as const,
          value: f.name,
          baseType: "String" as const,
        }))
      );

    case "indexType":
      if (base.kind !== "record") {
        return undefined;
      }
      return base.indexType;

    case "annotations":
      return (metadata?.annotations ?? []) as ComptimeValue[];

    case "closed":
      if (base.kind !== "record") {
        return false;
      }
      return base.closed;

    case "async":
      if (base.kind !== "function") {
        return false;
      }
      return base.async;

    // ============================================
    // Methods (return functions)
    // ============================================

    case "extends":
      return createExtendsMethod(type);

    case "annotation":
      return createAnnotationMethod(type, metadata);

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
      const other = args[0] as Type;
      if (typeof other !== "object" || !("kind" in other)) {
        throw new CompileError(
          `extends() argument must be a Type`,
          "typecheck",
          loc
        );
      }
      return isSubtype(type, other);
    },
  };
}

/**
 * Create the T.annotation<A>() method.
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

      const annotationType = args[0] as Type;
      const annotations = metadata?.annotations ?? [];

      // Find first annotation that matches the type
      for (const ann of annotations) {
        // TODO: proper type checking of annotation value against annotationType
        // For now, just return first annotation
        if (ann !== undefined) {
          return ann as ComptimeValue;
        }
      }

      return undefined;
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
