/**
 * TypeScript .d.ts Loader - Translator Module
 *
 * Translates Lezer TypeScript AST to DepJS Type values.
 */

import { Tree, TreeCursor } from "@lezer/common";
import { Type, primitiveType, recordType, unionType, intersectionType, functionType, arrayType, literalType, FieldInfo, ParamInfo, typeVarType, PrimitiveName } from "../types/types";
import { parseDTS, getText, findChild } from "./dts-parser";

/**
 * Result of loading a .d.ts file
 */
export interface DTSLoadResult {
  /** Exported type bindings */
  types: Map<string, Type>;
  /** Exported value bindings (functions, consts) */
  values: Map<string, Type>;
  /** Errors encountered during loading */
  errors: string[];
}

/**
 * Context for translation - tracks type parameters in scope
 */
interface TranslationContext {
  /** Type parameters currently in scope (name -> position for infer tracking) */
  typeParams: Map<string, number>;
  /** Infer variables in current conditional scope */
  inferVars: Map<string, InferPattern>;
  /** Source string for error messages */
  source: string;
  /** Accumulated errors */
  errors: string[];
}

/**
 * Pattern detected for an infer variable
 */
interface InferPattern {
  kind: "returnType" | "elementType" | "typeArg" | "propertyType" | "parameterType";
  position?: number; // For typeArg position
  propertyName?: string; // For propertyType
}

/**
 * Primitive type name mapping
 */
const PRIMITIVE_MAP: Record<string, PrimitiveName> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  null: "Null",
  undefined: "Undefined",
  void: "Void",
  never: "Never",
  unknown: "Unknown",
  any: "Unknown",
};

/**
 * Create a placeholder type for unresolved references.
 * Uses typeVarType with the name for now - proper resolution comes later.
 */
function unresolvedType(name: string): Type {
  return typeVarType(name);
}

/**
 * Load and translate a .d.ts file
 */
export function loadDTS(content: string): DTSLoadResult {
  const tree = parseDTS(content);
  const ctx: TranslationContext = {
    typeParams: new Map(),
    inferVars: new Map(),
    source: content,
    errors: [],
  };

  const types = new Map<string, Type>();
  const values = new Map<string, Type>();

  const cursor = tree.cursor();
  if (cursor.firstChild()) {
    do {
      translateTopLevel(cursor, ctx, types, values);
    } while (cursor.nextSibling());
  }

  return { types, values, errors: ctx.errors };
}

/**
 * Translate a top-level declaration
 */
function translateTopLevel(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>,
  values: Map<string, Type>
): void {
  switch (cursor.name) {
    case "TypeAliasDeclaration":
      translateTypeAlias(cursor, ctx, types);
      break;

    case "InterfaceDeclaration":
      translateInterface(cursor, ctx, types);
      break;

    case "AmbientDeclaration":
      // declare function, declare class, declare namespace, etc.
      if (cursor.firstChild()) {
        // Skip 'declare' keyword
        while (cursor.nextSibling()) {
          translateAmbient(cursor, ctx, types, values);
        }
        cursor.parent();
      }
      break;

    case "ExportDeclaration":
      // TODO: Handle exports
      break;

    default:
      // Ignore other top-level constructs for now
      break;
  }
}

/**
 * Translate a type alias declaration
 */
function translateTypeAlias(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>
): void {
  let name = "";
  let typeParamNames: string[] = [];
  let bodyType: Type | null = null;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "TypeDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "TypeParamList":
        typeParamNames = translateTypeParamList(cursor, ctx);
        break;

      default:
        // Try to translate as type
        const translated = translateType(cursor, ctx);
        if (translated) {
          bodyType = translated;
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name && bodyType) {
    // If it has type params, it's a generic type (function from types to type)
    // For now, store the body type directly
    // TODO: Create a type function for generics
    types.set(name, bodyType);
  }
}

/**
 * Translate an interface declaration
 */
function translateInterface(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>
): void {
  let name = "";
  let fields: FieldInfo[] = [];
  let typeParamNames: string[] = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "TypeDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "TypeParamList":
        typeParamNames = translateTypeParamList(cursor, ctx);
        break;

      case "ObjectType":
        fields = translateObjectType(cursor, ctx);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    types.set(name, recordType(fields));
  }
}

/**
 * Translate ambient declarations (declare function, declare class, etc.)
 */
function translateAmbient(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>,
  values: Map<string, Type>
): void {
  switch (cursor.name) {
    case "AmbientFunctionDeclaration":
      translateAmbientFunction(cursor, ctx, values);
      break;

    case "ClassDeclaration":
      translateClass(cursor, ctx, types, values);
      break;

    case "NamespaceDeclaration":
      translateNamespace(cursor, ctx, types, values);
      break;
  }
}

/**
 * Translate a declare function
 */
function translateAmbientFunction(
  cursor: TreeCursor,
  ctx: TranslationContext,
  values: Map<string, Type>
): void {
  let name = "";
  let params: ParamInfo[] = [];
  let returnType: Type = primitiveType("Void");
  let typeParamNames: string[] = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "TypeParamList":
        typeParamNames = translateTypeParamList(cursor, ctx);
        break;

      case "ParamList":
        params = translateParamListToParams(cursor, ctx);
        break;

      case "TypeAnnotation":
        const retType = translateTypeAnnotation(cursor, ctx);
        if (retType) returnType = retType;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    values.set(name, functionType(params, returnType));
  }
}

/**
 * Translate a class declaration
 */
function translateClass(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>,
  values: Map<string, Type>
): void {
  let name = "";
  let fields: FieldInfo[] = [];
  let typeParamNames: string[] = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "TypeParamList":
        typeParamNames = translateTypeParamList(cursor, ctx);
        break;

      case "ClassBody":
        fields = translateClassBody(cursor, ctx);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    // Store instance type
    types.set(name, recordType(fields));
    // TODO: Store constructor as value
  }
}

/**
 * Translate a namespace declaration
 */
function translateNamespace(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>,
  values: Map<string, Type>
): void {
  let name = "";
  const nsTypes = new Map<string, Type>();
  const nsValues = new Map<string, Type>();

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "Block":
        // Process namespace body
        cursor.firstChild();
        do {
          translateTopLevel(cursor, ctx, nsTypes, nsValues);
        } while (cursor.nextSibling());
        cursor.parent();
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Merge namespace exports into parent scope with prefix
  nsTypes.forEach((type, typeName) => {
    types.set(`${name}.${typeName}`, type);
  });
  nsValues.forEach((type, valueName) => {
    values.set(`${name}.${valueName}`, type);
  });

  // Also create namespace value as record
  const nsFields: FieldInfo[] = [];
  nsTypes.forEach((type, typeName) => {
    nsFields.push({ name: typeName, type, optional: false, annotations: [] });
  });
  nsValues.forEach((type, valueName) => {
    nsFields.push({ name: valueName, type, optional: false, annotations: [] });
  });
  values.set(name, recordType(nsFields));
}

/**
 * Translate type parameter list, returns names
 */
function translateTypeParamList(cursor: TreeCursor, ctx: TranslationContext): string[] {
  const names: string[] = [];
  cursor.firstChild();
  do {
    if (cursor.name === "TypeDefinition") {
      const name = getText(cursor, ctx.source);
      names.push(name);
      ctx.typeParams.set(name, names.length - 1);
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return names;
}

/**
 * Translate parameter list to ParamInfo array
 */
function translateParamListToParams(cursor: TreeCursor, ctx: TranslationContext): ParamInfo[] {
  const params: ParamInfo[] = [];
  let currentName = "";
  let currentType: Type = primitiveType("Unknown");
  let nextIsRest = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "Spread":
        // Mark that the next parameter is a rest parameter
        nextIsRest = true;
        break;

      case "VariableDefinition":
        // If we have a pending param, save it first
        if (currentName) {
          params.push({ name: currentName, type: currentType, optional: false });
        }
        currentName = getText(cursor, ctx.source);
        currentType = primitiveType("Unknown");
        // Check if this param is marked as rest
        if (nextIsRest) {
          // We'll set rest when we push this param
        }
        break;

      case "TypeAnnotation":
        const type = translateTypeAnnotation(cursor, ctx);
        if (type) currentType = type;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Don't forget the last param
  if (currentName) {
    params.push({ name: currentName, type: currentType, optional: false, rest: nextIsRest });
  }

  return params;
}

/**
 * Translate parameter list to types (for function signatures in types)
 */
function translateParamListToTypes(cursor: TreeCursor, ctx: TranslationContext): Type[] {
  const types: Type[] = [];
  cursor.firstChild();
  do {
    if (cursor.name === "TypeAnnotation") {
      const type = translateTypeAnnotation(cursor, ctx);
      if (type) types.push(type);
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return types;
}

/**
 * Translate a type annotation (: Type)
 */
function translateTypeAnnotation(cursor: TreeCursor, ctx: TranslationContext): Type | null {
  cursor.firstChild();
  let result: Type | null = null;
  do {
    const translated = translateType(cursor, ctx);
    if (translated) result = translated;
  } while (cursor.nextSibling());
  cursor.parent();
  return result;
}

/**
 * Translate object type to fields
 */
function translateObjectType(cursor: TreeCursor, ctx: TranslationContext): FieldInfo[] {
  const fields: FieldInfo[] = [];
  cursor.firstChild();
  do {
    if (cursor.name === "PropertyType") {
      const field = translatePropertyType(cursor, ctx);
      if (field) fields.push(field);
    }
    // TODO: Handle MethodType, IndexSignature
  } while (cursor.nextSibling());
  cursor.parent();
  return fields;
}

/**
 * Translate a property type to FieldInfo
 */
function translatePropertyType(cursor: TreeCursor, ctx: TranslationContext): FieldInfo | null {
  let name = "";
  let type: Type = primitiveType("Unknown");
  let optional = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "Optional":
        optional = true;
        break;

      case "TypeAnnotation":
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) type = t;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    return { name, type, optional, annotations: [] };
  }
  return null;
}

/**
 * Translate class body to fields
 */
function translateClassBody(cursor: TreeCursor, ctx: TranslationContext): FieldInfo[] {
  const fields: FieldInfo[] = [];
  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDeclaration":
        const propField = translatePropertyDeclaration(cursor, ctx);
        if (propField) fields.push(propField);
        break;

      case "MethodDeclaration":
        const methodField = translateMethodDeclaration(cursor, ctx);
        if (methodField) fields.push(methodField);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return fields;
}

/**
 * Translate property declaration to FieldInfo
 */
function translatePropertyDeclaration(cursor: TreeCursor, ctx: TranslationContext): FieldInfo | null {
  let name = "";
  let type: Type = primitiveType("Unknown");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "TypeAnnotation":
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) type = t;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    return { name, type, optional: false, annotations: [] };
  }
  return null;
}

/**
 * Translate method declaration to FieldInfo
 */
function translateMethodDeclaration(cursor: TreeCursor, ctx: TranslationContext): FieldInfo | null {
  let name = "";
  let params: ParamInfo[] = [];
  let returnType: Type = primitiveType("Void");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDefinition":
        name = getText(cursor, ctx.source);
        break;

      case "ParamList":
        params = translateParamListToParams(cursor, ctx);
        break;

      case "TypeAnnotation":
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) returnType = t;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    return {
      name,
      type: functionType(params, returnType),
      optional: false,
      annotations: [],
    };
  }
  return null;
}

/**
 * Main type translation - dispatches based on node type
 */
function translateType(cursor: TreeCursor, ctx: TranslationContext): Type | null {
  switch (cursor.name) {
    case "TypeName":
      return translateTypeName(cursor, ctx);

    case "UnionType":
      return translateUnionType(cursor, ctx);

    case "IntersectionType":
      return translateIntersectionType(cursor, ctx);

    case "ObjectType":
      return recordType(translateObjectType(cursor, ctx));

    case "ArrayType":
      return translateArrayType(cursor, ctx);

    case "TupleType":
      return translateTupleType(cursor, ctx);

    case "FunctionSignature":
      return translateFunctionSignature(cursor, ctx);

    case "ParameterizedType":
      return translateParameterizedType(cursor, ctx);

    case "ConditionalType":
      return translateConditionalType(cursor, ctx);

    case "KeyofType":
      return translateKeyofType(cursor, ctx);

    case "IndexedType":
      return translateIndexedType(cursor, ctx);

    case "ParenthesizedType":
      return translateParenthesizedType(cursor, ctx);

    case "LiteralType":
      return translateLiteralType(cursor, ctx);

    case "NullType":
      return primitiveType("Null");

    case "VoidType":
      return primitiveType("Void");

    case "InferredType":
      // This shouldn't be called directly - infer is handled in conditional type context
      ctx.errors.push(`Unexpected infer outside conditional type`);
      return primitiveType("Unknown");

    default:
      return null;
  }
}

/**
 * Translate a type name (primitive or reference)
 */
function translateTypeName(cursor: TreeCursor, ctx: TranslationContext): Type {
  const name = getText(cursor, ctx.source);

  // Check primitives
  if (name in PRIMITIVE_MAP) {
    return primitiveType(PRIMITIVE_MAP[name]);
  }

  // Check type parameters in scope
  if (ctx.typeParams.has(name)) {
    // Return a type variable reference
    return typeVarType(name);
  }

  // Otherwise it's a type reference - use typeVarType as placeholder
  // TODO: Look up in types map and resolve properly
  return unresolvedType(name);
}

/**
 * Translate union type
 */
function translateUnionType(cursor: TreeCursor, ctx: TranslationContext): Type {
  const members: Type[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) members.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  if (members.length === 0) return primitiveType("Never");
  if (members.length === 1) return members[0];
  return unionType(members);
}

/**
 * Translate intersection type
 */
function translateIntersectionType(cursor: TreeCursor, ctx: TranslationContext): Type {
  const members: Type[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) members.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  if (members.length === 0) return primitiveType("Unknown");
  if (members.length === 1) return members[0];
  return intersectionType(members);
}

/**
 * Translate array type (T[])
 */
function translateArrayType(cursor: TreeCursor, ctx: TranslationContext): Type {
  cursor.firstChild();
  const elementType = translateType(cursor, ctx) ?? primitiveType("Unknown");
  cursor.parent();
  // Variable-length array: single element with spread
  return arrayType([elementType], true);
}

/**
 * Translate tuple type
 */
function translateTupleType(cursor: TreeCursor, ctx: TranslationContext): Type {
  const elementTypes: Type[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) elementTypes.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  // Fixed-length array: no variadic/spread
  return arrayType(elementTypes, false);
}

/**
 * Translate function signature
 */
function translateFunctionSignature(cursor: TreeCursor, ctx: TranslationContext): Type {
  let params: ParamInfo[] = [];
  let returnType: Type = primitiveType("Void");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "ParamList":
        params = translateParamListToParams(cursor, ctx);
        break;

      case "TypeAnnotation":
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) returnType = t;
        break;

      default:
        // Could be return type directly
        const translated = translateType(cursor, ctx);
        if (translated) returnType = translated;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  return functionType(params, returnType);
}

/**
 * Translate parameterized type (Generic<Args>)
 */
function translateParameterizedType(cursor: TreeCursor, ctx: TranslationContext): Type {
  let baseName = "";
  const typeArgs: Type[] = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "TypeName":
        baseName = getText(cursor, ctx.source);
        break;

      case "TypeArgList":
        cursor.firstChild();
        do {
          const translated = translateType(cursor, ctx);
          if (translated) typeArgs.push(translated);
        } while (cursor.nextSibling());
        cursor.parent();
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Special cases
  if (baseName === "Array" && typeArgs.length === 1) {
    return arrayType([typeArgs[0]], true); // Variable-length array
  }

  // Generic parameterized type - use typeVarType with descriptive name for now
  // TODO: Create proper parameterized type with type args
  const typeName = `${baseName}<${typeArgs.map(formatTypeSimple).join(", ")}>`;
  return unresolvedType(typeName);
}

/**
 * Translate conditional type
 */
function translateConditionalType(cursor: TreeCursor, ctx: TranslationContext): Type {
  // Structure: checkType extends extendsType ? trueType : falseType
  const parts: Type[] = [];

  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) parts.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  // For now, just return Unknown - proper conditional type support needs pattern matching
  // TODO: Implement pattern matching for infer
  ctx.errors.push(`Conditional types not fully implemented yet`);
  return primitiveType("Unknown");
}

/**
 * Translate keyof type
 */
function translateKeyofType(cursor: TreeCursor, ctx: TranslationContext): Type {
  cursor.firstChild();
  do {
    if (cursor.name !== "keyof") {
      const operandType = translateType(cursor, ctx);
      cursor.parent();
      // TODO: Create proper keyof type - for now use placeholder
      return unresolvedType(`keyof(${formatTypeSimple(operandType)})`);
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return primitiveType("Unknown");
}

/**
 * Translate indexed type (T[K])
 */
function translateIndexedType(cursor: TreeCursor, ctx: TranslationContext): Type {
  const parts: Type[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) parts.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  // TODO: Create proper indexed access type - for now use placeholder
  if (parts.length >= 2) {
    return unresolvedType(`${formatTypeSimple(parts[0])}[${formatTypeSimple(parts[1])}]`);
  }
  return primitiveType("Unknown");
}

/**
 * Translate parenthesized type
 */
function translateParenthesizedType(cursor: TreeCursor, ctx: TranslationContext): Type {
  cursor.firstChild();
  let result: Type | null = null;
  do {
    const translated = translateType(cursor, ctx);
    if (translated) result = translated;
  } while (cursor.nextSibling());
  cursor.parent();
  return result ?? primitiveType("Unknown");
}

/**
 * Translate literal type
 */
function translateLiteralType(cursor: TreeCursor, ctx: TranslationContext): Type {
  cursor.firstChild();
  const text = getText(cursor, ctx.source);
  cursor.parent();

  // Parse the literal
  if (text === "true") return literalType(true, "Boolean");
  if (text === "false") return literalType(false, "Boolean");
  if (text.startsWith('"') || text.startsWith("'")) {
    return literalType(text.slice(1, -1), "String");
  }
  const num = Number(text);
  if (!isNaN(num)) {
    // Check if it's an integer or float
    const baseType = Number.isInteger(num) ? "Int" : "Float";
    return literalType(num, baseType);
  }
  return primitiveType("Unknown");
}

/**
 * Simple type formatter for debugging
 */
function formatTypeSimple(type: Type | null): string {
  if (!type) return "Unknown";
  if (type.kind === "primitive") return type.name;
  if (type.kind === "literal") return JSON.stringify(type.value);
  if (type.kind === "typeVar") return type.name;
  if (type.kind === "union") return type.types.map(formatTypeSimple).join(" | ");
  if (type.kind === "intersection") return type.types.map(formatTypeSimple).join(" & ");
  if (type.kind === "record") return `{ ${type.fields.map(f => `${f.name}: ${formatTypeSimple(f.type)}`).join("; ")} }`;
  if (type.kind === "function") return `(${type.params.map(p => formatTypeSimple(p.type)).join(", ")}) => ${formatTypeSimple(type.returnType)}`;
  if (type.kind === "array") {
    const elementTypes = type.elements.map(e => formatTypeSimple(e.type));
    if (type.elements.length === 1 && type.elements[0].spread) {
      return `${elementTypes[0]}[]`;
    }
    return `[${elementTypes.join(", ")}]`;
  }
  return "Unknown";
}
