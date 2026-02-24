/**
 * Built-in type constructors and primitive types.
 *
 * These are available in the initial comptime environment
 * and are used to construct Type values at compile time.
 */

import {
  Type,
  PrimitiveName,
  primitiveType,
  recordType,
  functionType,
  arrayType,
  arrayTypeFromElements,
  unionType,
  intersectionType,
  brandedType,
  withMetadata,
  literalType,
  boundedType,
  keyofType,
  indexedAccessType,
  mappedType,
  conditionalType,
  typeVarType,
  resolveConditionalType,
  FieldInfo,
  TypeMetadata,
  Unknown,
  getArrayElementTypes,
  isVariadicArray,
} from "../types/types";
import { CompileError, SourceLocation } from "../ast/core-ast";
import {
  ComptimeEnv,
  TypedComptimeValue,
  RawComptimeValue,
  RawComptimeRecord,
  ComptimeBuiltin,
  isTypeValue,
  isRawTypeValue,
  isRecordValue,
  isClosureValue,
  isBuiltinValue,
  wrapTypeValue,
  wrapValue,
} from "./comptime-env";
import { TypeEnv } from "./type-env";

// ============================================
// Built-in record types
// ============================================

/**
 * FieldInfo: { name: String, type: Type, optional: Boolean, annotations: Array<Unknown> }
 */
const FieldInfoType: Type = recordType(
  [
    { name: "name", type: primitiveType("String"), optional: false, annotations: [] },
    { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
    { name: "optional", type: primitiveType("Boolean"), optional: false, annotations: [] },
    { name: "annotations", type: arrayType([Unknown], true), optional: false, annotations: [] },
  ],
  { closed: false }
);

/**
 * ParamInfo: { name: String, type: Type, optional: Boolean, rest?: Boolean }
 */
const ParamInfoType: Type = recordType(
  [
    { name: "name", type: primitiveType("String"), optional: false, annotations: [] },
    { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
    { name: "optional", type: primitiveType("Boolean"), optional: false, annotations: [] },
    { name: "rest", type: primitiveType("Boolean"), optional: true, annotations: [] },
  ],
  { closed: false }
);

/**
 * ArrayElementInfo: { type: Type, label?: String }
 */
const ArrayElementInfoType: Type = recordType(
  [
    { name: "type", type: primitiveType("Type"), optional: false, annotations: [] },
    { name: "label", type: unionType([primitiveType("String"), primitiveType("Undefined")]), optional: true, annotations: [] },
  ],
  { closed: false }
);

/**
 * TypeMetadata: { name?: String, typeArgs?: Array<Type>, annotations?: Array<Unknown> }
 */
const TypeMetadataType: Type = recordType(
  [
    { name: "name", type: primitiveType("String"), optional: true, annotations: [] },
    { name: "typeArgs", type: arrayType([primitiveType("Type")], true), optional: true, annotations: [] },
    { name: "annotations", type: arrayType([Unknown], true), optional: true, annotations: [] },
  ],
  { closed: false }
);

/**
 * Error: { message: String, name: String }
 * Represents JavaScript Error objects
 */
const ErrorType: Type = recordType(
  [
    { name: "message", type: primitiveType("String"), optional: false, annotations: [] },
    { name: "name", type: primitiveType("String"), optional: false, annotations: [] },
  ],
  { closed: false }
);

/**
 * Create the initial comptime environment with all builtins.
 * All values are wrapped as TypedComptimeValue.
 */
export function createInitialComptimeEnv(): ComptimeEnv {
  const env = new ComptimeEnv();

  // Primitive types (including Type - the metatype of all types)
  const primitives: PrimitiveName[] = [
    "Int",
    "Float",
    "Number",
    "String",
    "Boolean",
    "Null",
    "Undefined",
    "Never",
    "Unknown",
    "Void",
    "Type",
  ];

  for (const name of primitives) {
    // Each primitive type IS a Type value, so its type is Type
    env.defineEvaluated(name, wrapTypeValue(primitiveType(name)));
  }

  // Built-in record types (all are Type values)
  env.defineEvaluated("FieldInfo", wrapTypeValue(FieldInfoType));
  env.defineEvaluated("ParamInfo", wrapTypeValue(ParamInfoType));
  env.defineEvaluated("ArrayElementInfo", wrapTypeValue(ArrayElementInfoType));
  env.defineEvaluated("TypeMetadata", wrapTypeValue(TypeMetadataType));
  env.defineEvaluated("Error", wrapTypeValue(ErrorType));

  // Type constructors - wrapped as TypedComptimeValue with function type Unknown (for simplicity)
  env.defineEvaluated("RecordType", wrapBuiltinValue(builtinRecordType));
  env.defineEvaluated("TryResult", wrapBuiltinValue(builtinTryResult));
  env.defineEvaluated("Union", wrapBuiltinValue(builtinUnion));
  env.defineEvaluated("Intersection", wrapBuiltinValue(builtinIntersection));
  env.defineEvaluated("FunctionType", wrapBuiltinValue(builtinFunctionType));
  env.defineEvaluated("Array", wrapBuiltinValue(builtinArray));
  env.defineEvaluated("WithMetadata", wrapBuiltinValue(builtinWithMetadata));
  env.defineEvaluated("Branded", wrapBuiltinValue(builtinBranded));
  env.defineEvaluated("LiteralType", wrapBuiltinValue(builtinLiteralType));

  // Type construct builtins (used by DTS translator)
  env.defineEvaluated("Keyof", wrapBuiltinValue(builtinKeyof));
  env.defineEvaluated("IndexedAccess", wrapBuiltinValue(builtinIndexedAccess));
  env.defineEvaluated("MappedType", wrapBuiltinValue(builtinMappedType));
  env.defineEvaluated("ConditionalType", wrapBuiltinValue(builtinConditionalType));
  env.defineEvaluated("TypeVar", wrapBuiltinValue(builtinTypeVar));

  // Special builtins
  env.defineEvaluated("typeOf", wrapBuiltinValue(builtinTypeOf));
  env.defineEvaluated("wideTypeOf", wrapBuiltinValue(builtinWideTypeOf));
  env.defineEvaluated("assert", wrapBuiltinValue(builtinAssert));
  env.defineEvaluated("fromEntries", wrapBuiltinValue(builtinFromEntries));
  env.defineEvaluated("buildRecord", wrapBuiltinValue(builtinBuildRecord));
  env.defineEvaluated("parseInt", wrapBuiltinValue(builtinParseInt));
  env.defineEvaluated("parseFloat", wrapBuiltinValue(builtinParseFloat));

  // This type
  env.defineEvaluated("This", wrapTypeValue({ kind: "this" } as Type));

  // Comptime namespace with comptime-only functions (e.g., readFile)
  // Named "Comptime" (capitalized) to avoid conflict with "comptime" keyword
  env.defineEvaluated("Comptime", wrapValue(createComptimeNamespace(), getComptimeNamespaceType()));

  return env;
}

/**
 * Helper to wrap a builtin as a TypedComptimeValue.
 */
function wrapBuiltinValue(builtin: ComptimeBuiltin): TypedComptimeValue {
  // Builtins are functions, their precise type is defined in TypeEnv
  return wrapValue(builtin, primitiveType("Unknown"));
}

/**
 * Create the initial type environment with primitive types.
 */
export function createInitialTypeEnv(): TypeEnv {
  const env = new TypeEnv();

  // All primitives have type Type
  const primitives: PrimitiveName[] = [
    "Int",
    "Float",
    "Number",
    "String",
    "Boolean",
    "Null",
    "Undefined",
    "Never",
    "Unknown",
    "Void",
    "Type",
  ];

  const typeType = primitiveType("Type");

  for (const name of primitives) {
    env.define(name, {
      type: typeType,
      comptimeStatus: "comptimeOnly",
      mutable: false,
    });
  }

  // Built-in record types (all are Type values)
  const builtinRecordTypes = ["FieldInfo", "ParamInfo", "ArrayElementInfo", "TypeMetadata", "Error"];
  for (const name of builtinRecordTypes) {
    env.define(name, {
      type: typeType,
      comptimeStatus: "comptimeOnly",
      mutable: false,
    });
  }

  // Type constructors have function types
  // RecordType: (fields: Array<FieldInfo>, indexType?: Type) => Type
  env.define("RecordType", {
    type: functionType(
      [
        { name: "fields", type: arrayType([primitiveType("Unknown")], true), optional: false },
        { name: "indexType", type: typeType, optional: true },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // Union: (...types: Type[]) => Type - variadic
  env.define("Union", {
    type: functionType(
      [{ name: "types", type: arrayType([typeType], true), optional: false, rest: true }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // Intersection: (...types: Type[]) => Type - variadic
  env.define("Intersection", {
    type: functionType(
      [{ name: "types", type: arrayType([typeType], true), optional: false, rest: true }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // FunctionType accepts ParamInfo records or Types for params
  // Validation happens in the builtin implementation
  env.define("FunctionType", {
    type: functionType(
      [
        { name: "params", type: arrayType([Unknown], true), optional: false },
        { name: "returnType", type: typeType, optional: false },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // Array is variadic - accepts rest parameters of Type or element records { type: Type, label?, spread? }
  env.define("Array", {
    type: functionType(
      [{ name: "elementTypes", type: arrayType([primitiveType("Unknown")], true), optional: false, rest: true }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("WithMetadata", {
    type: functionType(
      [
        { name: "baseType", type: typeType, optional: false },
        { name: "metadata", type: primitiveType("Unknown"), optional: false },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("Branded", {
    type: functionType(
      [
        { name: "baseType", type: typeType, optional: false },
        { name: "brand", type: primitiveType("String"), optional: false },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // LiteralType: (value: String | Int | Float | Boolean) => Type
  env.define("LiteralType", {
    type: functionType(
      [{ name: "value", type: primitiveType("Unknown"), optional: false }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // TryResult: (T: Type) => Type - creates { ok: true, value: T } | { ok: false, error: Error }
  env.define("TryResult", {
    type: functionType(
      [{ name: "T", type: typeType, optional: false }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // Type construct builtins
  env.define("Keyof", {
    type: functionType(
      [{ name: "T", type: typeType, optional: false }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("IndexedAccess", {
    type: functionType(
      [
        { name: "T", type: typeType, optional: false },
        { name: "K", type: typeType, optional: false },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("MappedType", {
    type: functionType(
      [
        { name: "keyVar", type: primitiveType("String"), optional: false },
        { name: "domain", type: typeType, optional: false },
        { name: "valueFn", type: functionType([{ name: "K", type: typeType, optional: false }], typeType), optional: false },
        { name: "optional", type: primitiveType("String"), optional: true },
        { name: "readonly", type: primitiveType("String"), optional: true },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("ConditionalType", {
    type: functionType(
      [
        { name: "check", type: typeType, optional: false },
        { name: "extends", type: typeType, optional: false },
        { name: "trueType", type: typeType, optional: false },
        { name: "falseType", type: typeType, optional: false },
      ],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("TypeVar", {
    type: functionType(
      [{ name: "name", type: primitiveType("String"), optional: false }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // typeOf and wideTypeOf have special handling in the type checker
  env.define("typeOf", {
    type: functionType(
      [{ name: "value", type: primitiveType("Unknown"), optional: false }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("wideTypeOf", {
    type: functionType(
      [{ name: "value", type: primitiveType("Unknown"), optional: false }],
      typeType
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("assert", {
    type: functionType(
      [
        { name: "condition", type: primitiveType("Boolean"), optional: false },
        { name: "message", type: primitiveType("String"), optional: true },
      ],
      primitiveType("Void")
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  env.define("This", {
    type: typeType,
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // Comptime namespace with comptime-only functions (e.g., readFile)
  // Named "Comptime" (capitalized) to avoid conflict with "comptime" keyword
  env.define("Comptime", {
    type: getComptimeNamespaceType(),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // ============================================
  // Runtime builtins (not comptime-only)
  // ============================================

  // print: (...args: Unknown[]) => Void - maps to console.log
  env.define("print", {
    type: functionType(
      [{ name: "args", type: primitiveType("Unknown"), optional: false, rest: true }],
      primitiveType("Void")
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  // console object with log method
  const consoleType: Type = recordType(
    [
      {
        name: "log",
        type: functionType(
          [{ name: "args", type: primitiveType("Unknown"), optional: false, rest: true }],
          primitiveType("Void")
        ),
        optional: false,
        annotations: [],
      },
      {
        name: "error",
        type: functionType(
          [{ name: "args", type: primitiveType("Unknown"), optional: false, rest: true }],
          primitiveType("Void")
        ),
        optional: false,
        annotations: [],
      },
      {
        name: "warn",
        type: functionType(
          [{ name: "args", type: primitiveType("Unknown"), optional: false, rest: true }],
          primitiveType("Void")
        ),
        optional: false,
        annotations: [],
      },
    ],
    { closed: false }
  );

  env.define("console", {
    type: consoleType,
    comptimeStatus: "runtime",
    mutable: false,
  });

  // toInt: (value: Number) => Int - truncates to integer
  env.define("toInt", {
    type: functionType(
      [{ name: "value", type: primitiveType("Number"), optional: false }],
      primitiveType("Int")
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  // toFloat: (value: Int) => Float - converts to floating point
  env.define("toFloat", {
    type: functionType(
      [{ name: "value", type: primitiveType("Int"), optional: false }],
      primitiveType("Float")
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  // parseInt: (value: String) => Int - parses string to integer
  env.define("parseInt", {
    type: functionType(
      [{ name: "value", type: primitiveType("String"), optional: false }],
      primitiveType("Int")
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  // parseFloat: (value: String) => Float - parses string to float
  env.define("parseFloat", {
    type: functionType(
      [{ name: "value", type: primitiveType("String"), optional: false }],
      primitiveType("Float")
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  // fromEntries: (entries: Array<[String, Unknown]>) => { [key: String]: Unknown }
  // Creates a record from an array of key-value pairs (like Object.fromEntries)
  // Accepts any value type; the actual runtime types are preserved
  env.define("fromEntries", {
    type: functionType(
      [{
        name: "entries",
        type: arrayType([
          arrayType([primitiveType("String"), primitiveType("Unknown")], false)
        ], true),
        optional: false
      }],
      recordType([], { indexType: primitiveType("Unknown") })
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  // buildRecord: (entries: Array<[String, Unknown]>, targetType: Type) => targetType
  // Like fromEntries but validates against and returns the specific target type
  // Comptime-only: validates entries match the target record type at compile time
  env.define("buildRecord", {
    type: functionType(
      [
        {
          name: "entries",
          type: arrayType([
            arrayType([primitiveType("String"), primitiveType("Unknown")], false)
          ], true),
          optional: false
        },
        {
          name: "targetType",
          type: primitiveType("Type"),
          optional: false
        }
      ],
      primitiveType("Unknown") // Return type is the targetType, computed at comptime
    ),
    comptimeStatus: "comptimeOnly",
    mutable: false,
  });

  // Try: <T>(thunk: () => T) => TryResult<T> - catches exceptions
  // The return type is computed based on the thunk's return type
  env.define("Try", {
    type: functionType(
      [
        {
          name: "thunk",
          type: functionType([], primitiveType("Unknown")),
          optional: false,
        },
      ],
      primitiveType("Unknown") // Return type is TryResult<T>, computed at call site
    ),
    comptimeStatus: "runtime",
    mutable: false,
  });

  return env;
}

// ============================================
// Built-in function implementations
// ============================================

const builtinRecordType: ComptimeBuiltin = {
  kind: "builtin",
  name: "RecordType",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError(
        "RecordType requires at least 1 argument (fields)",
        "typecheck",
        loc
      );
    }

    const fieldsArg = args[0].value;
    if (!Array.isArray(fieldsArg)) {
      throw new CompileError(
        "RecordType first argument must be an array of FieldInfo",
        "typecheck",
        loc
      );
    }

    // Get the type information for the fields array
    const fieldsArrayType = args[0].type;
    const fieldRecordTypes = fieldsArrayType.kind === "array"
      ? getArrayElementTypes(fieldsArrayType)
      : [];

    const fields: FieldInfo[] = fieldsArg.map((f, i) => {
      if (!isRecordValue(f)) {
        throw new CompileError(
          `RecordType field ${i} must be a FieldInfo record`,
          "typecheck",
          loc
        );
      }

      // Extract typed annotations from the field's annotations array
      const rawAnnotations = (f.annotations as unknown[]) ?? [];
      let typedAnnotations: { value: unknown; type: Type }[] = [];

      // Try to get annotation types from the array type
      const fieldType = fieldRecordTypes.length > 0
        ? (fieldRecordTypes[i] ?? fieldRecordTypes[0])
        : undefined;
      if (fieldType && fieldType.kind === "record") {
        const annotationsFieldType = fieldType.fields.find(fd => fd.name === "annotations");
        if (annotationsFieldType && annotationsFieldType.type.kind === "array") {
          const annElementTypes = getArrayElementTypes(annotationsFieldType.type);
          const annVariadic = isVariadicArray(annotationsFieldType.type);
          typedAnnotations = rawAnnotations.map((value, j) => ({
            value,
            type: annVariadic
              ? annElementTypes[0] ?? Unknown
              : annElementTypes[j] ?? Unknown,
          }));
        }
      }
      // Fallback: use Unknown type
      if (typedAnnotations.length === 0 && rawAnnotations.length > 0) {
        typedAnnotations = rawAnnotations.map(value => ({ value, type: Unknown }));
      }

      return {
        name: f.name as string,
        type: f.type as Type,
        optional: (f.optional as boolean) ?? false,
        annotations: typedAnnotations,
      };
    });

    const indexType = args.length > 1 && isTypeValue(args[1])
      ? (args[1].value as Type)
      : undefined;

    // Determine if closed based on indexType being Never
    const closed =
      indexType?.kind === "primitive" && indexType.name === "Never";

    return wrapTypeValue(recordType(fields, { indexType: closed ? undefined : indexType, closed }));
  },
};

const builtinUnion: ComptimeBuiltin = {
  kind: "builtin",
  name: "Union",
  impl: (args, _evaluator, loc) => {
    const types: Type[] = [];

    for (const arg of args) {
      if (!isTypeValue(arg)) {
        throw new CompileError(
          "Union arguments must be Types",
          "typecheck",
          loc
        );
      }
      types.push(arg.value as Type);
    }

    return wrapTypeValue(unionType(types));
  },
};

const builtinIntersection: ComptimeBuiltin = {
  kind: "builtin",
  name: "Intersection",
  impl: (args, _evaluator, loc) => {
    const types: Type[] = [];

    for (const arg of args) {
      if (!isTypeValue(arg)) {
        throw new CompileError(
          "Intersection arguments must be Types",
          "typecheck",
          loc
        );
      }
      types.push(arg.value as Type);
    }

    return wrapTypeValue(intersectionType(types));
  },
};

const builtinFunctionType: ComptimeBuiltin = {
  kind: "builtin",
  name: "FunctionType",
  impl: (args, _evaluator, loc) => {
    if (args.length < 2) {
      throw new CompileError(
        "FunctionType requires 2 arguments (params, returnType)",
        "typecheck",
        loc
      );
    }

    const paramInfos = args[0].value;
    if (!Array.isArray(paramInfos)) {
      throw new CompileError(
        "FunctionType first argument must be an array of ParamInfo",
        "typecheck",
        loc
      );
    }

    if (!isTypeValue(args[1])) {
      throw new CompileError(
        "FunctionType second argument must be a Type",
        "typecheck",
        loc
      );
    }
    const returnType = args[1].value as Type;

    // Convert ParamInfo records or Types to ParamInfo
    const params = paramInfos.map((p, i) => {
      // If it's a Type directly (legacy format), wrap it
      if (isRawTypeValue(p)) {
        return { name: `arg${i}`, type: p, optional: false };
      }
      // If it's a ParamInfo record with name, type, optional, rest
      if (
        typeof p === "object" &&
        p !== null &&
        "name" in p &&
        "type" in p &&
        isRawTypeValue((p as RawComptimeRecord).type)
      ) {
        const rec = p as RawComptimeRecord;
        return {
          name: String(rec.name),
          type: rec.type as Type,
          optional: Boolean(rec.optional),
          rest: Boolean(rec.rest),
        };
      }
      throw new CompileError(
        `FunctionType param ${i} must be a Type or ParamInfo record`,
        "typecheck",
        loc
      );
    });

    return wrapTypeValue(functionType(params, returnType));
  },
};

const builtinArray: ComptimeBuiltin = {
  kind: "builtin",
  name: "Array",
  impl: (args, _evaluator, loc) => {
    const elements: { type: Type; label?: string; spread?: boolean }[] = [];

    for (const arg of args) {
      // Accept either plain Type values or { type: Type, label?: String, spread?: Boolean } records
      if (isTypeValue(arg)) {
        // Plain Type - backward compatible
        elements.push({ type: arg.value as Type });
      } else if (isRecordValue(arg.value)) {
        const rec = arg.value as RawComptimeRecord;
        const elemType = rec.type;
        if (!isRawTypeValue(elemType)) {
          throw new CompileError(
            "Array element 'type' must be a Type",
            "typecheck",
            loc
          );
        }
        elements.push({
          type: elemType,
          label: rec.label as string | undefined,
          spread: rec.spread as boolean | undefined,
        });
      } else {
        throw new CompileError(
          "Array arguments must be Types or element records { type: Type, label?: String, spread?: Boolean }",
          "typecheck",
          loc
        );
      }
    }

    // Single spread element = variable-length array (backward compat)
    // Multiple elements or any non-spread = fixed-length array (tuple)
    if (elements.length === 1 && !elements[0].label && !elements[0].spread) {
      // Single plain type without label: variable-length array T[]
      return wrapTypeValue(arrayType([elements[0].type], true));
    }

    // Otherwise, create array from elements
    return wrapTypeValue(arrayTypeFromElements(elements));
  },
};

const builtinWithMetadata: ComptimeBuiltin = {
  kind: "builtin",
  name: "WithMetadata",
  impl: (args, _evaluator, loc) => {
    if (args.length < 2) {
      throw new CompileError(
        "WithMetadata requires 2 arguments (baseType, metadata)",
        "typecheck",
        loc
      );
    }

    if (!isTypeValue(args[0])) {
      throw new CompileError(
        "WithMetadata first argument must be a Type",
        "typecheck",
        loc
      );
    }
    const baseType = args[0].value as Type;

    const metadataArg = args[1].value;
    if (!isRecordValue(metadataArg)) {
      throw new CompileError(
        "WithMetadata second argument must be a metadata record",
        "typecheck",
        loc
      );
    }

    // Extract typed annotations by pairing values with their types from the metadata type
    let typedAnnotations: { value: unknown; type: Type }[] | undefined;
    const rawAnnotations = metadataArg.annotations as unknown[] | undefined;
    if (rawAnnotations && Array.isArray(rawAnnotations)) {
      // Get the type of the annotations field from the metadata argument's type
      const metadataType = args[1].type;
      if (metadataType.kind === "record") {
        const annotationsField = metadataType.fields.find(f => f.name === "annotations");
        if (annotationsField && annotationsField.type.kind === "array") {
          const annElementTypes = getArrayElementTypes(annotationsField.type);
          const annVariadic = isVariadicArray(annotationsField.type);
          // For fixed-length arrays, types are per-element; for variadic, there's one type
          typedAnnotations = rawAnnotations.map((value, i) => ({
            value,
            type: annVariadic
              ? annElementTypes[0] ?? Unknown
              : annElementTypes[i] ?? Unknown,
          }));
        }
      }
      // Fallback: if we couldn't extract types, use Unknown
      if (!typedAnnotations) {
        typedAnnotations = rawAnnotations.map(value => ({ value, type: Unknown }));
      }
    }

    const metadata: TypeMetadata = {
      name: metadataArg.name as string | undefined,
      typeArgs: metadataArg.typeArgs as Type[] | undefined,
      annotations: typedAnnotations,
    };

    return wrapTypeValue(withMetadata(baseType, metadata));
  },
};

const builtinBranded: ComptimeBuiltin = {
  kind: "builtin",
  name: "Branded",
  impl: (args, _evaluator, loc) => {
    if (args.length < 2) {
      throw new CompileError(
        "Branded requires 2 arguments (baseType, brand)",
        "typecheck",
        loc
      );
    }

    if (!isTypeValue(args[0])) {
      throw new CompileError(
        "Branded first argument must be a Type",
        "typecheck",
        loc
      );
    }
    const baseType = args[0].value as Type;

    const brand = args[1].value;
    if (typeof brand !== "string") {
      throw new CompileError(
        "Branded second argument must be a string",
        "typecheck",
        loc
      );
    }

    return wrapTypeValue(brandedType(baseType, brand, brand));
  },
};

const builtinLiteralType: ComptimeBuiltin = {
  kind: "builtin",
  name: "LiteralType",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError(
        "LiteralType requires 1 argument (value)",
        "typecheck",
        loc
      );
    }

    const value = args[0].value;

    // Determine the base type from the value
    if (typeof value === "string") {
      return wrapTypeValue(literalType(value, "String"));
    } else if (typeof value === "number") {
      // Check if it's an integer or float
      const isInt = Number.isInteger(value);
      return wrapTypeValue(literalType(value, isInt ? "Int" : "Float"));
    } else if (typeof value === "boolean") {
      return wrapTypeValue(literalType(value, "Boolean"));
    } else {
      throw new CompileError(
        `LiteralType argument must be a string, number, or boolean, got ${typeof value}`,
        "typecheck",
        loc
      );
    }
  },
};

/**
 * Widen a type by replacing literal types with their base primitive types.
 * Used by wideTypeOf for generic defaults in .d.ts functions where
 * literal preservation is too aggressive (e.g., useState(0) should infer S=Int, not S=0).
 */
function widenType(t: Type): Type {
  switch (t.kind) {
    case "literal":
      return primitiveType(t.baseType);
    case "array": {
      const widenedElements = t.elements.map(el => ({
        ...el,
        type: widenType(el.type),
      }));
      return { ...t, elements: widenedElements };
    }
    case "record": {
      const widenedFields = t.fields.map(f => ({
        ...f,
        type: widenType(f.type),
      }));
      return { ...t, fields: widenedFields };
    }
    case "union":
      return unionType(t.types.map(widenType));
    case "withMetadata":
      return withMetadata(widenType(t.baseType), t.metadata);
    default:
      return t;
  }
}

/**
 * wideTypeOf builtin - like typeOf but widens literal types to their base types.
 * Used for generic defaults in .d.ts functions.
 */
const builtinWideTypeOf: ComptimeBuiltin = {
  kind: "builtin",
  name: "wideTypeOf",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 1) {
      throw new CompileError(
        "wideTypeOf expects exactly 1 argument",
        "typecheck",
        loc
      );
    }
    return wrapTypeValue(widenType(args[0].type));
  },
};

/**
 * typeOf builtin - NOW TRIVIAL!
 * With TypedComptimeValue, we just extract the type from the argument.
 */
const builtinTypeOf: ComptimeBuiltin = {
  kind: "builtin",
  name: "typeOf",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 1) {
      throw new CompileError(
        "typeOf expects exactly 1 argument",
        "typecheck",
        loc
      );
    }
    // The type is right there on the argument!
    // Return it wrapped as a Type value
    return wrapTypeValue(args[0].type);
  },
};

const builtinAssert: ComptimeBuiltin = {
  kind: "builtin",
  name: "assert",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError(
        "assert requires at least 1 argument (condition)",
        "typecheck",
        loc
      );
    }

    const condition = args[0].value;
    const message = args.length > 1 ? String(args[1].value) : "Assertion failed";

    if (!condition) {
      throw new CompileError(message, "typecheck", loc);
    }

    return wrapValue(undefined, primitiveType("Void"));
  },
};

/**
 * fromEntries builtin - creates a record from an array of [key, value] pairs.
 * Like JavaScript's Object.fromEntries.
 * Infers the value type from the input array's element type.
 */
const builtinFromEntries: ComptimeBuiltin = {
  kind: "builtin",
  name: "fromEntries",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError(
        "fromEntries requires 1 argument (entries array)",
        "typecheck",
        loc
      );
    }

    const entries = args[0].value;
    if (!Array.isArray(entries)) {
      throw new CompileError(
        "fromEntries argument must be an array of [key, value] pairs",
        "typecheck",
        loc
      );
    }

    // Infer value type from the input array type
    let valueType: Type = primitiveType("Unknown");
    const inputType = args[0].type;
    if (inputType.kind === "array") {
      // Get the element type of the array
      const elemTypes = getArrayElementTypes(inputType);
      if (elemTypes.length > 0) {
        const entryType = elemTypes[0];
        // Entry type should be a tuple/array like [String, V]
        if (entryType.kind === "array") {
          const entryElemTypes = getArrayElementTypes(entryType);
          if (entryElemTypes.length >= 2) {
            valueType = entryElemTypes[1]; // Second element is the value type
          }
        }
      }
    }

    // Build the record from entries
    const result: RawComptimeRecord = {};
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) {
        throw new CompileError(
          "Each entry must be a [key, value] pair",
          "typecheck",
          loc
        );
      }
      const key = entry[0];
      const value = entry[1];
      if (typeof key !== "string") {
        throw new CompileError(
          "Entry keys must be strings",
          "typecheck",
          loc
        );
      }
      result[key] = value;
    }

    // Return as indexed record type with inferred value type
    return wrapValue(result, recordType([], { indexType: valueType }));
  },
};

/**
 * parseInt builtin - parses a string to an integer.
 */
const builtinParseInt: ComptimeBuiltin = {
  kind: "builtin",
  name: "parseInt",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError("parseInt requires 1 argument", "typecheck", loc);
    }
    const value = args[0].value;
    if (typeof value !== "string") {
      throw new CompileError("parseInt argument must be a String", "typecheck", loc);
    }
    const result = parseInt(value, 10);
    if (isNaN(result)) {
      throw new CompileError(`Cannot parse "${value}" as integer`, "typecheck", loc);
    }
    return wrapValue(result, primitiveType("Int"));
  },
};

/**
 * parseFloat builtin - parses a string to a float.
 */
const builtinParseFloat: ComptimeBuiltin = {
  kind: "builtin",
  name: "parseFloat",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError("parseFloat requires 1 argument", "typecheck", loc);
    }
    const value = args[0].value;
    if (typeof value !== "string") {
      throw new CompileError("parseFloat argument must be a String", "typecheck", loc);
    }
    const result = parseFloat(value);
    if (isNaN(result)) {
      throw new CompileError(`Cannot parse "${value}" as float`, "typecheck", loc);
    }
    return wrapValue(result, primitiveType("Float"));
  },
};

/**
 * buildRecord builtin - creates a typed record from an array of [key, value] pairs.
 * Unlike fromEntries which returns { [key: String]: T }, this validates against
 * a specific target type and returns that type.
 *
 * buildRecord(entries: Array<[String, Unknown]>, targetType: Type): targetType
 */
const builtinBuildRecord: ComptimeBuiltin = {
  kind: "builtin",
  name: "buildRecord",
  impl: (args, _evaluator, loc) => {
    if (args.length < 2) {
      throw new CompileError(
        "buildRecord requires 2 arguments (entries, targetType)",
        "typecheck",
        loc
      );
    }

    const entries = args[0].value;
    if (!Array.isArray(entries)) {
      throw new CompileError(
        "buildRecord first argument must be an array of [key, value] pairs",
        "typecheck",
        loc
      );
    }

    if (!isTypeValue(args[1])) {
      throw new CompileError(
        "buildRecord second argument must be a Type",
        "typecheck",
        loc
      );
    }
    const targetType = args[1].value as Type;

    if (targetType.kind !== "record") {
      throw new CompileError(
        `buildRecord target must be a record type, got ${targetType.kind}`,
        "typecheck",
        loc
      );
    }

    // Build the record from entries
    const result: RawComptimeRecord = {};
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) {
        throw new CompileError(
          "Each entry must be a [key, value] pair",
          "typecheck",
          loc
        );
      }
      const key = entry[0];
      const value = entry[1];
      if (typeof key !== "string") {
        throw new CompileError(
          "Entry keys must be strings",
          "typecheck",
          loc
        );
      }
      // Validate that the key exists in the target type
      const field = targetType.fields.find(f => f.name === key);
      if (!field && !targetType.indexType) {
        throw new CompileError(
          `Field '${key}' does not exist on target type`,
          "typecheck",
          loc
        );
      }
      result[key] = value;
    }

    // Validate that all required fields are present
    for (const field of targetType.fields) {
      if (!field.optional && !(field.name in result)) {
        throw new CompileError(
          `Required field '${field.name}' missing from entries`,
          "typecheck",
          loc
        );
      }
    }

    // Return with the target type
    return wrapValue(result, targetType);
  },
};

// ============================================
// Type construct builtins (for DTS translator)
// ============================================

/**
 * Keyof builtin - creates a KeyofType or resolves eagerly for concrete records.
 * Keyof(T) => keyof T
 */
const builtinKeyof: ComptimeBuiltin = {
  kind: "builtin",
  name: "Keyof",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 1) {
      throw new CompileError("Keyof requires 1 argument", "typecheck", loc);
    }
    if (!isTypeValue(args[0])) {
      throw new CompileError("Keyof argument must be a Type", "typecheck", loc);
    }
    const operand = args[0].value as Type;

    // Try to resolve eagerly if operand is a record
    if (operand.kind === "record") {
      if (operand.fields.length === 0) {
        return wrapTypeValue(primitiveType("Never"));
      }
      return wrapTypeValue(
        unionType(operand.fields.map(f => literalType(f.name, "String")))
      );
    }

    // Deferred: create KeyofType
    return wrapTypeValue(keyofType(operand));
  },
};

/**
 * IndexedAccess builtin - creates an IndexedAccessType or resolves eagerly.
 * IndexedAccess(T, K) => T[K]
 */
const builtinIndexedAccess: ComptimeBuiltin = {
  kind: "builtin",
  name: "IndexedAccess",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 2) {
      throw new CompileError("IndexedAccess requires 2 arguments", "typecheck", loc);
    }
    if (!isTypeValue(args[0])) {
      throw new CompileError("IndexedAccess first argument must be a Type", "typecheck", loc);
    }
    if (!isTypeValue(args[1])) {
      throw new CompileError("IndexedAccess second argument must be a Type", "typecheck", loc);
    }
    const objectType = args[0].value as Type;
    const indexType = args[1].value as Type;

    // Try to resolve eagerly
    if (objectType.kind === "record" && indexType.kind === "literal" && indexType.baseType === "String") {
      const fieldName = indexType.value as string;
      const field = objectType.fields.find(f => f.name === fieldName);
      if (field) return wrapTypeValue(field.type);
      if (objectType.indexType) return wrapTypeValue(objectType.indexType);
      return wrapTypeValue(primitiveType("Never"));
    }

    // If index is a union of string literals and object is a record, resolve each
    if (objectType.kind === "record" && indexType.kind === "union") {
      const types: Type[] = [];
      for (const member of indexType.types) {
        if (member.kind === "literal" && member.baseType === "String") {
          const field = objectType.fields.find(f => f.name === member.value as string);
          if (field) types.push(field.type);
          else if (objectType.indexType) types.push(objectType.indexType);
        } else {
          // Can't fully resolve, fall back to deferred
          return wrapTypeValue(indexedAccessType(objectType, indexType));
        }
      }
      if (types.length > 0) return wrapTypeValue(unionType(types));
    }

    // Deferred
    return wrapTypeValue(indexedAccessType(objectType, indexType));
  },
};

/**
 * MappedType builtin - creates a MappedType.
 * MappedType(keyVar, domain, valueFn, optional?, readonly?)
 * The valueFn is a lambda (K: Type) => Type that is called per key.
 */
const builtinMappedType: ComptimeBuiltin = {
  kind: "builtin",
  name: "MappedType",
  impl: (args, evaluator, loc) => {
    if (args.length < 3) {
      throw new CompileError("MappedType requires at least 3 arguments (keyVar, domain, valueFn)", "typecheck", loc);
    }

    const keyVarName = args[0].value;
    if (typeof keyVarName !== "string") {
      throw new CompileError("MappedType keyVar must be a string", "typecheck", loc);
    }

    if (!isTypeValue(args[1])) {
      throw new CompileError("MappedType domain must be a Type", "typecheck", loc);
    }
    const domain = args[1].value as Type;

    // The third argument is a lambda (K: Type) => Type
    const valueFnRaw = args[2].value;
    if (!isClosureValue(valueFnRaw) && !isBuiltinValue(valueFnRaw)) {
      throw new CompileError("MappedType valueFn must be a function", "typecheck", loc);
    }

    const optionalMod = args.length > 3 && typeof args[3].value === "string"
      ? args[3].value as "add" | "remove" | "preserve"
      : undefined;
    const readonlyMod = args.length > 4 && typeof args[4].value === "string"
      ? args[4].value as "add" | "remove" | "preserve"
      : undefined;

    // Try to resolve eagerly by expanding the domain
    const keys = extractKeyTypes(domain);
    if (keys !== null) {
      const fields: FieldInfo[] = [];

      for (const { name: keyName, originalOptional } of keys) {
        const keyLiteralType = literalType(keyName, "String");
        // Call the value function with the key literal type
        let resolvedValueType: Type;
        if (isClosureValue(valueFnRaw)) {
          const result = evaluator.applyClosureWithValues(
            valueFnRaw,
            [wrapTypeValue(keyLiteralType)],
            loc
          );
          if (!isTypeValue(result)) {
            throw new CompileError("MappedType valueFn must return a Type", "typecheck", loc);
          }
          resolvedValueType = result.value as Type;
        } else {
          // Builtin function
          const result = (valueFnRaw as ComptimeBuiltin).impl(
            [wrapTypeValue(keyLiteralType)],
            evaluator,
            loc
          );
          if (!isTypeValue(result)) {
            throw new CompileError("MappedType valueFn must return a Type", "typecheck", loc);
          }
          resolvedValueType = result.value as Type;
        }

        // Determine optionality
        let isOptional = originalOptional ?? false;
        if (optionalMod === "add") isOptional = true;
        if (optionalMod === "remove") isOptional = false;

        fields.push({
          name: keyName,
          type: resolvedValueType,
          optional: isOptional,
          annotations: [],
        });
      }

      return wrapTypeValue(recordType(fields));
    }

    // Can't resolve eagerly - create a deferred mapped type.
    // For this we need the value type as a Type with the keyVar as a typeVar.
    // Call the valueFn with a typeVar to get the template.
    const keyVarTypeVal = typeVarType(keyVarName);
    let valueTemplate: Type;
    if (isClosureValue(valueFnRaw)) {
      const result = evaluator.applyClosureWithValues(
        valueFnRaw,
        [wrapTypeValue(keyVarTypeVal)],
        loc
      );
      if (!isTypeValue(result)) {
        throw new CompileError("MappedType valueFn must return a Type", "typecheck", loc);
      }
      valueTemplate = result.value as Type;
    } else {
      const result = (valueFnRaw as ComptimeBuiltin).impl(
        [wrapTypeValue(keyVarTypeVal)],
        evaluator,
        loc
      );
      if (!isTypeValue(result)) {
        throw new CompileError("MappedType valueFn must return a Type", "typecheck", loc);
      }
      valueTemplate = result.value as Type;
    }

    return wrapTypeValue(mappedType(keyVarName, domain, valueTemplate, {
      optional: optionalMod,
      readonly: readonlyMod,
    }));
  },
};

/**
 * ConditionalType builtin - creates a ConditionalType or resolves eagerly.
 * ConditionalType(check, extends, trueType, falseType)
 */
const builtinConditionalType: ComptimeBuiltin = {
  kind: "builtin",
  name: "ConditionalType",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 4) {
      throw new CompileError("ConditionalType requires 4 arguments", "typecheck", loc);
    }
    for (let i = 0; i < 4; i++) {
      if (!isTypeValue(args[i])) {
        throw new CompileError(`ConditionalType argument ${i} must be a Type`, "typecheck", loc);
      }
    }
    const checkType = args[0].value as Type;
    const extendsType = args[1].value as Type;
    const trueType = args[2].value as Type;
    const falseType = args[3].value as Type;

    return wrapTypeValue(resolveConditionalType(checkType, extendsType, trueType, falseType));
  },
};

/**
 * TypeVar builtin - creates a typeVar type.
 * TypeVar(name) => typeVar(name)
 */
const builtinTypeVar: ComptimeBuiltin = {
  kind: "builtin",
  name: "TypeVar",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 1) {
      throw new CompileError("TypeVar requires 1 argument (name)", "typecheck", loc);
    }
    const name = args[0].value;
    if (typeof name !== "string") {
      throw new CompileError("TypeVar name must be a string", "typecheck", loc);
    }
    return wrapTypeValue(typeVarType(name));
  },
};

/**
 * Extract keys and optionality from a domain type (keyof record, union of literals).
 * Returns null if the domain cannot be expanded to concrete keys.
 */
function extractKeyTypes(domain: Type): { name: string; originalOptional?: boolean }[] | null {
  // keyof record: get field names with their optionality
  if (domain.kind === "keyof" && domain.operand.kind === "record") {
    return domain.operand.fields.map(f => ({
      name: f.name,
      originalOptional: f.optional,
    }));
  }

  // Union of string literals
  if (domain.kind === "literal" && domain.baseType === "String") {
    return [{ name: domain.value as string }];
  }

  if (domain.kind === "union") {
    const results: { name: string; originalOptional?: boolean }[] = [];
    for (const member of domain.types) {
      if (member.kind === "literal" && member.baseType === "String") {
        results.push({ name: member.value as string });
      } else {
        return null;
      }
    }
    return results;
  }

  return null;
}

/**
 * Type builtin - creates bounded or unbounded Type.
 * Type() returns the primitive Type (unbounded)
 * Type(Bound) returns a boundedType that constrains type arguments
 */
const builtinType: ComptimeBuiltin = {
  kind: "builtin",
  name: "Type",
  impl: (args, _evaluator, loc) => {
    if (args.length === 0) {
      // Type with no args = unbounded Type
      return wrapTypeValue(primitiveType("Type"));
    }

    if (!isTypeValue(args[0])) {
      throw new CompileError(
        "Type argument must be a Type",
        "typecheck",
        loc
      );
    }
    const bound = args[0].value as Type;

    // Type(Bound) creates a bounded type constraint
    return wrapTypeValue(boundedType(bound));
  },
};

/**
 * TryResult builtin - creates the discriminated union type for Try results.
 * TryResult<T> = { ok: true, value: T } | { ok: false, error: Error }
 */
const builtinTryResult: ComptimeBuiltin = {
  kind: "builtin",
  name: "TryResult",
  impl: (args, _evaluator, loc) => {
    if (args.length !== 1) {
      throw new CompileError(
        "TryResult expects exactly 1 type argument",
        "typecheck",
        loc
      );
    }

    if (!isTypeValue(args[0])) {
      throw new CompileError(
        "TryResult argument must be a Type",
        "typecheck",
        loc
      );
    }
    const valueType = args[0].value as Type;

    // Create the success branch: { ok: true, value: T }
    const successType = recordType(
      [
        { name: "ok", type: literalType(true, "Boolean"), optional: false, annotations: [] },
        { name: "value", type: valueType, optional: false, annotations: [] },
      ],
      { closed: false }
    );

    // Create the failure branch: { ok: false, error: Error }
    const failureType = recordType(
      [
        { name: "ok", type: literalType(false, "Boolean"), optional: false, annotations: [] },
        { name: "error", type: ErrorType, optional: false, annotations: [] },
      ],
      { closed: false }
    );

    // Return the union with metadata
    const resultType = unionType([successType, failureType]);
    return wrapTypeValue(
      withMetadata(resultType, { name: "TryResult", typeArgs: [valueType] })
    );
  },
};

// ============================================
// Comptime namespace and readFile builtin
// ============================================

import * as fs from "fs";
import * as nodePath from "path";

/**
 * comptime.readFile builtin - reads a file at compile time.
 * Path is resolved relative to the source file location.
 */
const builtinComptimeReadFile: ComptimeBuiltin = {
  kind: "builtin",
  name: "comptime.readFile",
  impl: (args, _evaluator, loc) => {
    if (args.length < 1) {
      throw new CompileError(
        "comptime.readFile requires a path argument",
        "typecheck",
        loc
      );
    }
    const pathValue = args[0].value;
    if (typeof pathValue !== "string") {
      throw new CompileError(
        "comptime.readFile path must be a string",
        "typecheck",
        loc
      );
    }

    // Resolve relative to source file location
    const sourceDir = loc?.file ? nodePath.dirname(loc.file) : process.cwd();
    const resolvedPath = nodePath.resolve(sourceDir, pathValue);

    try {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      return wrapValue(content, primitiveType("String"));
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      throw new CompileError(
        `Failed to read file '${pathValue}' (resolved to '${resolvedPath}'): ${errorMsg}`,
        "typecheck",
        loc
      );
    }
  },
};

// ============================================
// TypeScript Global Type Stubs
// ============================================

/**
 * Populate an environment with TypeScript global type stubs.
 * These are approximate mappings for types commonly referenced in .d.ts files
 * (Iterable, ReadonlyArray, Readonly, Partial, etc.) that are not part of DepJS's
 * core type system. Added to module-level child environments during import processing.
 */
export function defineTypeScriptGlobalStubs(
  comptimeEnv: ComptimeEnv,
  typeEnv: TypeEnv
): void {
  const typeType = primitiveType("Type");
  const stubNames = [
    "Iterable", "Iterator", "IterableIterator",
    "ReadonlyArray", "Readonly", "Partial", "Required",
    "NonNullable", "Exclude", "Extract", "Omit", "Pick",
    "Record", "Promise", "PromiseLike", "Awaited",
  ];

  const stubImpls: Record<string, ComptimeBuiltin> = {
    "Iterable": builtinIdentityType("Iterable"),
    "Iterator": builtinIdentityType("Iterator"),
    "IterableIterator": builtinIdentityType("IterableIterator"),
    "ReadonlyArray": builtinReadonlyArray,
    "Readonly": builtinIdentityTypeConstructor,
    "Partial": builtinIdentityTypeConstructor,
    "Required": builtinIdentityTypeConstructor,
    "NonNullable": builtinIdentityTypeConstructor,
    "Exclude": builtinExclude,
    "Extract": builtinExtract,
    "Omit": builtinIdentityTypeConstructor,
    "Pick": builtinIdentityTypeConstructor,
    "Record": builtinTSRecord,
    "Promise": builtinPromiseType,
    "PromiseLike": builtinPromiseType,
    "Awaited": builtinIdentityTypeConstructor,
  };

  for (const name of stubNames) {
    // Only define if not already present (don't override real definitions)
    if (!typeEnv.lookup(name)) {
      typeEnv.define(name, {
        type: functionType(
          [{ name: "T", type: typeType, optional: false, rest: true }],
          typeType
        ),
        comptimeStatus: "comptimeOnly",
        mutable: false,
      });
      comptimeEnv.defineEvaluated(name, wrapBuiltinValue(stubImpls[name]));
    }
  }
}

/**
 * Identity type constructor stub: (T: Type) => T
 * Used for Readonly, Partial, Required, NonNullable, etc.
 */
const builtinIdentityTypeConstructor: ComptimeBuiltin = {
  kind: "builtin",
  name: "IdentityType",
  impl: (args, _evaluator, _loc) => {
    if (args.length > 0 && isRawTypeValue(args[0].value)) {
      return wrapTypeValue(args[0].value as Type);
    }
    return wrapTypeValue(Unknown);
  },
};

/**
 * Identity type constructor that wraps result in WithMetadata with given name.
 * Used for Iterable, Iterator, IterableIterator — maps T → Array(T) approximately.
 */
function builtinIdentityType(name: string): ComptimeBuiltin {
  return {
    kind: "builtin",
    name,
    impl: (args, _evaluator, _loc) => {
      if (args.length > 0 && isRawTypeValue(args[0].value)) {
        const elementType = args[0].value as Type;
        return wrapTypeValue(
          withMetadata(
            arrayType([elementType], true),
            { name }
          )
        );
      }
      return wrapTypeValue(
        withMetadata(arrayType([Unknown], true), { name })
      );
    },
  };
}

/**
 * ReadonlyArray<T> → Array(T)
 */
const builtinReadonlyArray: ComptimeBuiltin = {
  kind: "builtin",
  name: "ReadonlyArray",
  impl: (args, _evaluator, _loc) => {
    if (args.length > 0 && isRawTypeValue(args[0].value)) {
      return wrapTypeValue(arrayType([args[0].value as Type], true));
    }
    return wrapTypeValue(arrayType([Unknown], true));
  },
};

/**
 * Exclude<T, U> → ConditionalType(T, U, Never, T) approximately.
 * In practice, just returns T (a rough approximation).
 */
const builtinExclude: ComptimeBuiltin = {
  kind: "builtin",
  name: "Exclude",
  impl: (args, _evaluator, _loc) => {
    if (args.length > 0 && isRawTypeValue(args[0].value)) {
      return wrapTypeValue(args[0].value as Type);
    }
    return wrapTypeValue(Unknown);
  },
};

/**
 * Extract<T, U> → U approximately.
 */
const builtinExtract: ComptimeBuiltin = {
  kind: "builtin",
  name: "Extract",
  impl: (args, _evaluator, _loc) => {
    if (args.length > 1 && isRawTypeValue(args[1].value)) {
      return wrapTypeValue(args[1].value as Type);
    }
    return wrapTypeValue(Unknown);
  },
};

/**
 * Record<K, V> → { [key: K]: V } approximately → RecordType([], V)
 */
const builtinTSRecord: ComptimeBuiltin = {
  kind: "builtin",
  name: "Record",
  impl: (args, _evaluator, _loc) => {
    const valueType = args.length > 1 && isRawTypeValue(args[1].value)
      ? args[1].value as Type
      : Unknown;
    return wrapTypeValue(recordType([], { indexType: valueType }));
  },
};

/**
 * Promise<T> → WithMetadata(T, { name: "Promise" }) approximately.
 */
const builtinPromiseType: ComptimeBuiltin = {
  kind: "builtin",
  name: "Promise",
  impl: (args, _evaluator, _loc) => {
    const innerType = args.length > 0 && isRawTypeValue(args[0].value)
      ? args[0].value as Type
      : Unknown;
    return wrapTypeValue(
      withMetadata(innerType, { name: "Promise" })
    );
  },
};

/**
 * Create the comptime namespace record containing comptime-only functions.
 * This is stored as a record value where each field is a builtin function.
 */
function createComptimeNamespace(): RawComptimeRecord {
  return {
    readFile: builtinComptimeReadFile,
  };
}

/**
 * Type for the comptime namespace.
 * comptime: { readFile: (path: String) => String }
 */
function getComptimeNamespaceType(): Type {
  return recordType(
    [
      {
        name: "readFile",
        type: functionType(
          [{ name: "path", type: primitiveType("String"), optional: false }],
          primitiveType("String")
        ),
        optional: false,
        annotations: [],
      },
    ],
    { closed: false }
  );
}
