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
  unionType,
  intersectionType,
  brandedType,
  withMetadata,
  literalType,
  FieldInfo,
  TypeMetadata,
  Unknown,
} from "../types/types";
import { CompileError, SourceLocation } from "../ast/core-ast";
import {
  ComptimeEnv,
  ComptimeValue,
  ComptimeBuiltin,
  ComptimeRecord,
  isTypeValue,
  isRecordValue,
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
 * Create the initial comptime environment with all builtins.
 */
export function createInitialComptimeEnv(): ComptimeEnv {
  const env = new ComptimeEnv();

  // Primitive types
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
    env.defineEvaluated(name, primitiveType(name));
  }

  // Built-in record types
  env.defineEvaluated("FieldInfo", FieldInfoType);
  env.defineEvaluated("ParamInfo", ParamInfoType);
  env.defineEvaluated("ArrayElementInfo", ArrayElementInfoType);
  env.defineEvaluated("TypeMetadata", TypeMetadataType);

  // Type constructors
  env.defineEvaluated("RecordType", builtinRecordType);
  env.defineEvaluated("Union", builtinUnion);
  env.defineEvaluated("Intersection", builtinIntersection);
  env.defineEvaluated("FunctionType", builtinFunctionType);
  env.defineEvaluated("Array", builtinArray);
  env.defineEvaluated("WithMetadata", builtinWithMetadata);
  env.defineEvaluated("Branded", builtinBranded);
  env.defineEvaluated("LiteralType", builtinLiteralType);

  // Special builtins
  env.defineEvaluated("typeOf", builtinTypeOf);
  env.defineEvaluated("assert", builtinAssert);

  // This type
  env.defineEvaluated("This", { kind: "this" } as Type);

  return env;
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
  const builtinRecordTypes = ["FieldInfo", "ParamInfo", "ArrayElementInfo", "TypeMetadata"];
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

  // Array is variadic - accepts rest parameters
  env.define("Array", {
    type: functionType(
      [{ name: "elementTypes", type: arrayType([typeType], true), optional: false, rest: true }],
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

    const fieldsArg = args[0];
    if (!Array.isArray(fieldsArg)) {
      throw new CompileError(
        "RecordType first argument must be an array of FieldInfo",
        "typecheck",
        loc
      );
    }

    const fields: FieldInfo[] = fieldsArg.map((f, i) => {
      if (!isRecordValue(f)) {
        throw new CompileError(
          `RecordType field ${i} must be a FieldInfo record`,
          "typecheck",
          loc
        );
      }
      return {
        name: f.name as string,
        type: f.type as Type,
        optional: (f.optional as boolean) ?? false,
        annotations: (f.annotations as unknown[]) ?? [],
      };
    });

    const indexType = args.length > 1 ? (args[1] as Type | undefined) : undefined;

    // Determine if closed based on indexType being Never
    const closed =
      indexType?.kind === "primitive" && indexType.name === "Never";

    return recordType(fields, { indexType: closed ? undefined : indexType, closed });
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
      types.push(arg);
    }

    return unionType(types);
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
      types.push(arg);
    }

    return intersectionType(types);
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

    const paramInfos = args[0];
    if (!Array.isArray(paramInfos)) {
      throw new CompileError(
        "FunctionType first argument must be an array of ParamInfo",
        "typecheck",
        loc
      );
    }

    const returnType = args[1];
    if (!isTypeValue(returnType)) {
      throw new CompileError(
        "FunctionType second argument must be a Type",
        "typecheck",
        loc
      );
    }

    // Convert ParamInfo records or Types to ParamInfo
    const params = paramInfos.map((p, i) => {
      // If it's a Type directly (legacy format), wrap it
      if (isTypeValue(p)) {
        return { name: `arg${i}`, type: p, optional: false };
      }
      // If it's a ParamInfo record with name, type, optional, rest
      if (
        typeof p === "object" &&
        p !== null &&
        "name" in p &&
        "type" in p &&
        isTypeValue(p.type as unknown)
      ) {
        return {
          name: String(p.name),
          type: p.type as Type,
          optional: Boolean(p.optional),
          rest: Boolean(p.rest),
        };
      }
      throw new CompileError(
        `FunctionType param ${i} must be a Type or ParamInfo record`,
        "typecheck",
        loc
      );
    });

    return functionType(params, returnType);
  },
};

const builtinArray: ComptimeBuiltin = {
  kind: "builtin",
  name: "Array",
  impl: (args, _evaluator, loc) => {
    const types: Type[] = [];

    for (const arg of args) {
      if (!isTypeValue(arg)) {
        throw new CompileError(
          "Array arguments must be Types",
          "typecheck",
          loc
        );
      }
      types.push(arg);
    }

    // Single type = variable-length array
    // Multiple types = fixed-length array (tuple)
    const variadic = types.length === 1;

    return arrayType(types, variadic);
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

    const baseType = args[0];
    if (!isTypeValue(baseType)) {
      throw new CompileError(
        "WithMetadata first argument must be a Type",
        "typecheck",
        loc
      );
    }

    const metadataArg = args[1];
    if (!isRecordValue(metadataArg)) {
      throw new CompileError(
        "WithMetadata second argument must be a metadata record",
        "typecheck",
        loc
      );
    }

    const metadata: TypeMetadata = {
      name: metadataArg.name as string | undefined,
      typeArgs: metadataArg.typeArgs as Type[] | undefined,
      annotations: metadataArg.annotations as unknown[] | undefined,
    };

    return withMetadata(baseType, metadata);
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

    const baseType = args[0];
    if (!isTypeValue(baseType)) {
      throw new CompileError(
        "Branded first argument must be a Type",
        "typecheck",
        loc
      );
    }

    const brand = args[1];
    if (typeof brand !== "string") {
      throw new CompileError(
        "Branded second argument must be a string",
        "typecheck",
        loc
      );
    }

    return brandedType(baseType, brand, brand);
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

    const value = args[0];

    // Determine the base type from the value
    if (typeof value === "string") {
      return literalType(value, "String");
    } else if (typeof value === "number") {
      // Check if it's an integer or float
      const isInt = Number.isInteger(value);
      return literalType(value, isInt ? "Int" : "Float");
    } else if (typeof value === "boolean") {
      return literalType(value, "Boolean");
    } else {
      throw new CompileError(
        `LiteralType argument must be a string, number, or boolean, got ${typeof value}`,
        "typecheck",
        loc
      );
    }
  },
};

const builtinTypeOf: ComptimeBuiltin = {
  kind: "builtin",
  name: "typeOf",
  impl: (_args, _evaluator, loc) => {
    // typeOf is special - it needs access to type information
    // This is handled specially in the type checker, not here
    throw new CompileError(
      "typeOf must be handled specially during type checking, not comptime evaluation",
      "typecheck",
      loc
    );
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

    const condition = args[0];
    const message = args.length > 1 ? String(args[1]) : "Assertion failed";

    if (!condition) {
      throw new CompileError(message, "typecheck", loc);
    }

    return undefined; // Void
  },
};
