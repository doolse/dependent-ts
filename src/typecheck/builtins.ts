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

  // Special builtins
  env.defineEvaluated("typeOf", wrapBuiltinValue(builtinTypeOf));
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

  // typeOf and assert have special handling in the type checker
  env.define("typeOf", {
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
