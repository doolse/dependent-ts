/**
 * TypeScript .d.ts Loader - Translator Module
 *
 * Translates Lezer TypeScript AST to DepJS Type values.
 */

import { Tree, TreeCursor } from "@lezer/common";
import { Type, primitiveType, recordType, unionType, intersectionType, functionType, arrayType, literalType, FieldInfo, ParamInfo, typeVarType, PrimitiveName, keyofType, indexedAccessType } from "../types/types";
import { computeKeyofRecord } from "../types/subtype";
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
 * Add a value to the map, merging overloaded functions as intersection types.
 */
function addValue(values: Map<string, Type>, name: string, newType: Type): void {
  const existing = values.get(name);
  if (existing) {
    // If both are functions, create an intersection (overloaded function)
    if (existing.kind === "function" && newType.kind === "function") {
      values.set(name, intersectionType([existing, newType]));
    } else if (existing.kind === "intersection" && newType.kind === "function") {
      // Already an intersection, add to it
      values.set(name, intersectionType([...existing.types, newType]));
    } else {
      // Different kinds - just overwrite (shouldn't happen for valid .d.ts)
      values.set(name, newType);
    }
  } else {
    values.set(name, newType);
  }
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
      translateExportDeclaration(cursor, ctx, types, values);
      break;

    case "FunctionDeclaration":
      // function declarations inside namespaces
      translateFunctionDeclaration(cursor, ctx, values);
      break;

    case "VariableDeclaration":
      // const declarations inside namespaces
      translateVariableDeclaration(cursor, ctx, values);
      break;

    default:
      // Ignore other top-level constructs for now
      break;
  }
}

/**
 * Translate an export declaration.
 * Handles:
 * - Inline exports: export type Foo = ..., export interface Foo { }, export function foo(), export declare ...
 * - Export groups: export { A }, export { A as B }, export type { A }
 * - Re-exports are skipped (export { foo } from "module", export * from "module")
 */
function translateExportDeclaration(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>,
  values: Map<string, Type>
): void {
  let hasFromClause = false;
  let isTypeOnly = false;
  const exportGroupItems: Array<{ localName: string; exportedName: string }> = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "export":
        // Skip the export keyword
        break;

      case "type":
        // export type { ... } - type-only export (we treat same as regular for now)
        isTypeOnly = true;
        break;

      case "from":
        // Re-export from another module - skip since we don't follow imports
        hasFromClause = true;
        break;

      case "Star":
        // export * from "module" - skip since we don't follow imports
        hasFromClause = true;
        break;

      case "ExportGroup":
        // Parse export group: { A } or { A as B } or { A, B as C }
        parseExportGroup(cursor, ctx, exportGroupItems);
        break;

      case "TypeAliasDeclaration":
        // export type Foo = ...
        translateTypeAlias(cursor, ctx, types);
        break;

      case "InterfaceDeclaration":
        // export interface Foo { }
        translateInterface(cursor, ctx, types);
        break;

      case "FunctionDeclaration":
        // export function foo(): void
        translateFunctionDeclaration(cursor, ctx, values);
        break;

      case "AmbientDeclaration":
        // export declare function/class/namespace/const
        if (cursor.firstChild()) {
          while (cursor.nextSibling()) {
            translateAmbient(cursor, ctx, types, values);
          }
          cursor.parent();
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Handle export group if present and not a re-export
  if (exportGroupItems.length > 0 && !hasFromClause) {
    for (const { localName, exportedName } of exportGroupItems) {
      // Check if it's a type
      const typeVal = types.get(localName);
      if (typeVal) {
        if (localName !== exportedName) {
          types.set(exportedName, typeVal);
        }
        continue;
      }

      // Check if it's a value
      const valueType = values.get(localName);
      if (valueType) {
        if (localName !== exportedName) {
          values.set(exportedName, valueType);
        }
        continue;
      }

      // Symbol not found - could be in a different file or not yet processed
      // For now, ignore (the symbol might be declared elsewhere in the same file
      // and processed before we get here)
    }
  }
}

/**
 * Parse an export group: { A } or { A as B } or { A, B as C }
 */
function parseExportGroup(
  cursor: TreeCursor,
  ctx: TranslationContext,
  items: Array<{ localName: string; exportedName: string }>
): void {
  let currentLocalName = "";
  let expectingExportedName = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableName":
        const name = getText(cursor, ctx.source);
        if (expectingExportedName) {
          // This is the "as B" part - B is the exported name
          items.push({ localName: currentLocalName, exportedName: name });
          currentLocalName = "";
          expectingExportedName = false;
        } else {
          // This could be a standalone name or the local part of "A as B"
          if (currentLocalName) {
            // Previous name wasn't followed by "as", so it's a standalone export
            items.push({ localName: currentLocalName, exportedName: currentLocalName });
          }
          currentLocalName = name;
        }
        break;

      case "as":
        // Next VariableName will be the exported name
        expectingExportedName = true;
        break;

      case ",":
        // Separator - if we have a pending name without "as", add it
        if (currentLocalName && !expectingExportedName) {
          items.push({ localName: currentLocalName, exportedName: currentLocalName });
          currentLocalName = "";
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Don't forget the last item if not followed by "as"
  if (currentLocalName && !expectingExportedName) {
    items.push({ localName: currentLocalName, exportedName: currentLocalName });
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

    case "VariableDeclaration":
      // declare const x: T
      translateVariableDeclaration(cursor, ctx, values);
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
    addValue(values, name, functionType(params, returnType));
  }
}

/**
 * Translate a function declaration (inside namespace body)
 */
function translateFunctionDeclaration(
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
    addValue(values, name, functionType(params, returnType));
  }
}

/**
 * Translate a variable declaration (const inside namespace body)
 */
function translateVariableDeclaration(
  cursor: TreeCursor,
  ctx: TranslationContext,
  values: Map<string, Type>
): void {
  let name = "";
  let type: Type = primitiveType("Unknown");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
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
    values.set(name, type);
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
  let currentOptional = false;
  let currentRest = false;
  let nextIsRest = false; // Spread applies to the NEXT param

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "Spread":
        // Mark that the next parameter (not current) is a rest parameter
        // Spread comes BEFORE the VariableDefinition for the rest param
        nextIsRest = true;
        break;

      case "VariableDefinition":
        // If we have a pending param, save it first (with its own rest flag, not nextIsRest)
        if (currentName) {
          params.push({ name: currentName, type: currentType, optional: currentOptional, rest: currentRest });
        }
        // Start new param
        currentName = getText(cursor, ctx.source);
        currentType = primitiveType("Unknown");
        currentOptional = false;
        currentRest = nextIsRest; // Transfer the rest flag to this param
        nextIsRest = false;
        break;

      case "Optional":
        // Parameter is optional (has ? after name)
        currentOptional = true;
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
    params.push({ name: currentName, type: currentType, optional: currentOptional, rest: currentRest });
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
      // The infer var should be in scope if we're inside a conditional type's extends clause
      // Return the type variable representing the inferred type
      {
        let inferName = "";
        cursor.firstChild();
        do {
          if ((cursor.name as string) === "TypeName") {
            inferName = getText(cursor, ctx.source);
          }
        } while (cursor.nextSibling());
        cursor.parent();
        if (inferName && ctx.typeParams.has(inferName)) {
          return typeVarType(inferName);
        }
        // Not in scope - this happens for complex patterns we don't fully handle
        return primitiveType("Unknown");
      }

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
 * Structure: checkType extends extendsType ? trueType : falseType
 */
function translateConditionalType(cursor: TreeCursor, ctx: TranslationContext): Type {
  let checkType: Type | null = null;
  let extendsType: Type | null = null;
  let trueType: Type | null = null;
  let falseType: Type | null = null;
  let stage = 0; // 0=checkType, 1=extendsType, 2=trueType, 3=falseType

  // Track infer variables found in the extends clause
  const inferVars = new Set<string>();

  cursor.firstChild();
  do {
    // Skip keywords and operators
    if (cursor.name === "extends" || cursor.name === "LogicOp") {
      if (cursor.name === "LogicOp") {
        const op = getText(cursor, ctx.source);
        if (op === "?") stage = 2;
        else if (op === ":") stage = 3;
      } else {
        stage = 1;
      }
      continue;
    }

    // For the extends clause, collect infer variables first
    if (stage === 1) {
      collectInferVars(cursor, ctx, inferVars);
      // Add infer vars to type params temporarily
      for (const v of inferVars) {
        ctx.typeParams.set(v, -1); // Use -1 to mark as infer var
      }
    }

    const translated = translateType(cursor, ctx);
    if (translated) {
      switch (stage) {
        case 0: checkType = translated; break;
        case 1: extendsType = translated; break;
        case 2: trueType = translated; break;
        case 3: falseType = translated; break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Remove infer vars from scope
  for (const v of inferVars) {
    ctx.typeParams.delete(v);
  }

  // Handle the result
  if (!trueType) trueType = primitiveType("Unknown");
  if (!falseType) falseType = primitiveType("Never");

  // Common pattern: `T extends X ? Y : never` - return Y (extraction pattern)
  if (falseType.kind === "primitive" && falseType.name === "Never") {
    return trueType;
  }

  // Common pattern: `T extends X ? T : Y` where true just returns the checked type
  // Return union of possible results
  if (trueType.kind === "primitive" && trueType.name === "Never") {
    return falseType;
  }

  // General case: return union of both possibilities
  return unionType([trueType, falseType]);
}

/**
 * Collect infer variable names from a type node
 */
function collectInferVars(cursor: TreeCursor, ctx: TranslationContext, inferVars: Set<string>): void {
  if (cursor.name === "InferredType") {
    // Structure: infer TypeName
    cursor.firstChild();
    do {
      if ((cursor.name as string) === "TypeName") {
        inferVars.add(getText(cursor, ctx.source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
    return;
  }

  // Recurse into children
  if (cursor.firstChild()) {
    do {
      collectInferVars(cursor, ctx, inferVars);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

/**
 * Translate keyof type.
 * If the operand is a concrete record type, compute the keys immediately.
 * Otherwise, create a KeyofType for deferred resolution.
 */
function translateKeyofType(cursor: TreeCursor, ctx: TranslationContext): Type {
  cursor.firstChild();
  do {
    if (cursor.name !== "keyof") {
      const operandType = translateType(cursor, ctx);
      cursor.parent();

      if (!operandType) {
        return primitiveType("Unknown");
      }

      // If the operand is a concrete record type, compute keyof immediately
      if (operandType.kind === "record") {
        return computeKeyofRecord(operandType);
      }

      // For type variables or other complex types, create a deferred KeyofType
      return keyofType(operandType);
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return primitiveType("Unknown");
}

/**
 * Translate indexed type (T[K]).
 * If the object type is a record and the index is a literal string, resolve immediately.
 * Otherwise, create an IndexedAccessType for deferred resolution.
 */
function translateIndexedType(cursor: TreeCursor, ctx: TranslationContext): Type {
  const parts: Type[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) parts.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  if (parts.length >= 2) {
    const [objectType, indexType] = parts;

    // If object is a record and index is a literal string, resolve immediately
    if (objectType.kind === "record" && indexType.kind === "literal" && indexType.baseType === "String") {
      const fieldName = indexType.value as string;
      const field = objectType.fields.find(f => f.name === fieldName);
      if (field) {
        return field.type;
      }
      // Field not found - check index type
      if (objectType.indexType) {
        return objectType.indexType;
      }
      // No such field and no index type - return Never
      return primitiveType("Never");
    }

    // For complex cases, create a deferred IndexedAccessType
    return indexedAccessType(objectType, indexType);
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
