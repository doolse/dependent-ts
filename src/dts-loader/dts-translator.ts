/**
 * TypeScript .d.ts Loader - Translator Module
 *
 * Translates Lezer TypeScript AST to DepJS Type values.
 */

import { Tree, TreeCursor } from "@lezer/common";
import { Type, primitiveType, recordType, unionType, intersectionType, functionType, arrayType, literalType, FieldInfo, ParamInfo, typeVarType, PrimitiveName, keyofType, indexedAccessType, withMetadata, getMetadata, unwrapMetadata, substituteTypeVars, mappedType, MappedType } from "../types/types";
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
 * Callback type for resolving modules during .d.ts translation.
 * Returns the load result for the module, or null if it cannot be resolved.
 */
export type ModuleTypeResolver = (
  specifier: string,
  fromPath: string
) => DTSLoadResult | null;

/**
 * Options for loading a .d.ts file
 */
export interface DTSLoadOptions {
  /** Path to the .d.ts file being loaded (for resolving relative imports) */
  filePath?: string;
  /** Resolver callback for loading imported modules */
  resolver?: ModuleTypeResolver;
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
  /** Path to the current file (for resolving relative imports) */
  filePath?: string;
  /** Resolver callback for loading imported modules */
  resolver?: ModuleTypeResolver;
  /** Types imported from other modules (name -> type) */
  importedTypes: Map<string, Type>;
  /** Values imported from other modules (name -> type) */
  importedValues: Map<string, Type>;
  /** Types defined locally in this file (for generic instantiation) */
  localTypes: Map<string, Type>;
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
export function loadDTS(content: string, options?: DTSLoadOptions): DTSLoadResult {
  const tree = parseDTS(content);
  const types = new Map<string, Type>();
  const values = new Map<string, Type>();

  const ctx: TranslationContext = {
    typeParams: new Map(),
    inferVars: new Map(),
    source: content,
    errors: [],
    filePath: options?.filePath,
    resolver: options?.resolver,
    importedTypes: new Map(),
    importedValues: new Map(),
    localTypes: types, // Share the same map so we can look up types as they're defined
  };

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

    case "ImportDeclaration":
      translateImportDeclaration(cursor, ctx);
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
 * - Re-exports: export { foo } from "module", export * from "module"
 */
function translateExportDeclaration(
  cursor: TreeCursor,
  ctx: TranslationContext,
  types: Map<string, Type>,
  values: Map<string, Type>
): void {
  let hasFromClause = false;
  let isTypeOnly = false;
  let isStarExport = false;
  let moduleSpecifier = "";
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
        // Re-export from another module
        hasFromClause = true;
        break;

      case "Star":
        // export * from "module"
        isStarExport = true;
        hasFromClause = true;
        break;

      case "String":
        // Module specifier for re-exports
        const specText = getText(cursor, ctx.source);
        // Remove quotes
        moduleSpecifier = specText.slice(1, -1);
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

  // Handle re-exports from other modules
  if (hasFromClause && moduleSpecifier && ctx.resolver && ctx.filePath) {
    const resolved = ctx.resolver(moduleSpecifier, ctx.filePath);
    if (resolved) {
      if (isStarExport) {
        // export * from "module" - re-export all
        resolved.types.forEach((type, name) => {
          types.set(name, type);
        });
        resolved.values.forEach((type, name) => {
          values.set(name, type);
        });
      } else {
        // export { A, B as C } from "module" - re-export specific symbols
        for (const { localName, exportedName } of exportGroupItems) {
          // Check types first
          const importedType = resolved.types.get(localName);
          if (importedType) {
            types.set(exportedName, importedType);
            continue;
          }

          // Check values
          const importedValue = resolved.values.get(localName);
          if (importedValue) {
            values.set(exportedName, importedValue);
            continue;
          }
          // Symbol not found in resolved module - could be a deeper re-export
        }
      }
    }
    return;
  }

  // Handle export group from current file (not a re-export)
  if (exportGroupItems.length > 0 && !hasFromClause) {
    for (const { localName, exportedName } of exportGroupItems) {
      // Check if it's a type in current file
      const typeVal = types.get(localName);
      if (typeVal) {
        if (localName !== exportedName) {
          types.set(exportedName, typeVal);
        }
        continue;
      }

      // Check if it's a value in current file
      const valueType = values.get(localName);
      if (valueType) {
        if (localName !== exportedName) {
          values.set(exportedName, valueType);
        }
        continue;
      }

      // Check imported types
      const importedType = ctx.importedTypes.get(localName);
      if (importedType) {
        types.set(exportedName, importedType);
        continue;
      }

      // Check imported values
      const importedValue = ctx.importedValues.get(localName);
      if (importedValue) {
        values.set(exportedName, importedValue);
        continue;
      }

      // Symbol not found - could be in a different file or not yet processed
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
 * Translate an import declaration.
 * Handles:
 * - Named imports: import { A, B } from "module"
 * - Type-only imports: import type { A } from "module"
 * - Namespace imports: import * as ns from "module"
 * - Default imports: import X from "module"
 */
function translateImportDeclaration(cursor: TreeCursor, ctx: TranslationContext): void {
  if (!ctx.resolver || !ctx.filePath) {
    // No resolver available, skip import processing
    return;
  }

  let isTypeOnly = false;
  let moduleSpecifier = "";
  let namespaceAlias = "";
  let defaultImportName = "";
  const namedImports: Array<{ importedName: string; localName: string }> = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "import":
        // Skip the import keyword
        break;

      case "type":
        // import type { ... }
        isTypeOnly = true;
        break;

      case "Star":
        // Namespace import: import * as ns
        // Next we expect "as" and then the alias name
        break;

      case "as":
        // Part of namespace import or named import rename
        break;

      case "VariableDefinition":
        // This could be:
        // 1. Namespace alias after "* as"
        // 2. Default import name
        const name = getText(cursor, ctx.source);
        if (namespaceAlias === "" && namedImports.length === 0) {
          // Could be namespace alias or default import
          // We'll determine based on context (if we saw Star, it's namespace)
          namespaceAlias = name;
        }
        break;

      case "ImportGroup":
        // Named imports: { A, B as C }
        parseImportGroup(cursor, ctx, namedImports);
        // If we had a pending name, it was a default import
        if (namespaceAlias) {
          defaultImportName = namespaceAlias;
          namespaceAlias = "";
        }
        break;

      case "String":
        // Module specifier
        const specText = getText(cursor, ctx.source);
        // Remove quotes
        moduleSpecifier = specText.slice(1, -1);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (!moduleSpecifier) {
    return;
  }

  // Resolve the module
  const resolved = ctx.resolver(moduleSpecifier, ctx.filePath);
  if (!resolved) {
    // Module not found - this is not necessarily an error, as some imports
    // may be for runtime-only modules
    return;
  }

  // Handle namespace import: import * as ns from "module"
  if (namespaceAlias && namedImports.length === 0 && !defaultImportName) {
    // Create a record type with all exports
    const fields: FieldInfo[] = [];
    resolved.types.forEach((type, name) => {
      fields.push({ name, type, optional: false, annotations: [] });
    });
    resolved.values.forEach((type, name) => {
      fields.push({ name, type, optional: false, annotations: [] });
    });
    ctx.importedValues.set(namespaceAlias, recordType(fields));
    return;
  }

  // Handle named imports: import { A, B as C } from "module"
  for (const { importedName, localName } of namedImports) {
    // Check types first
    const importedType = resolved.types.get(importedName);
    if (importedType) {
      ctx.importedTypes.set(localName, importedType);
      continue;
    }

    // Check values
    const importedValue = resolved.values.get(importedName);
    if (importedValue) {
      ctx.importedValues.set(localName, importedValue);
      continue;
    }

    // Symbol not found in the resolved module
    // This could be a re-export that wasn't resolved, so we don't error
  }

  // Handle default import: import X from "module"
  if (defaultImportName) {
    // Default exports are typically named "default" in the resolved module
    const defaultType = resolved.types.get("default") || resolved.values.get("default");
    if (defaultType) {
      if (resolved.types.has("default")) {
        ctx.importedTypes.set(defaultImportName, defaultType);
      } else {
        ctx.importedValues.set(defaultImportName, defaultType);
      }
    }
  }
}

/**
 * Parse an import group: { A } or { A as B } or { A, B as C }
 */
function parseImportGroup(
  cursor: TreeCursor,
  ctx: TranslationContext,
  items: Array<{ importedName: string; localName: string }>
): void {
  let currentImportedName = "";
  let expectingLocalName = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
      case "VariableName":
        // In import groups, names can appear as either VariableDefinition or VariableName
        const name = getText(cursor, ctx.source);
        if (expectingLocalName) {
          // This is the "as B" part - B is the local name
          items.push({ importedName: currentImportedName, localName: name });
          currentImportedName = "";
          expectingLocalName = false;
        } else {
          // This could be a standalone name or the imported part of "A as B"
          if (currentImportedName) {
            // Previous name wasn't followed by "as", so it's a standalone import
            items.push({ importedName: currentImportedName, localName: currentImportedName });
          }
          currentImportedName = name;
        }
        break;

      case "as":
        // Next name will be the local name
        expectingLocalName = true;
        break;

      case ",":
        // Separator - if we have a pending name without "as", add it
        if (currentImportedName && !expectingLocalName) {
          items.push({ importedName: currentImportedName, localName: currentImportedName });
          currentImportedName = "";
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Don't forget the last item if not followed by "as"
  if (currentImportedName && !expectingLocalName) {
    items.push({ importedName: currentImportedName, localName: currentImportedName });
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

  // Clear type params from scope after translating body
  for (const param of typeParamNames) {
    ctx.typeParams.delete(param);
  }

  if (name && bodyType) {
    // If it has type params, wrap with metadata to enable instantiation
    if (typeParamNames.length > 0) {
      types.set(name, withMetadata(bodyType, { name, typeParams: typeParamNames }));
    } else {
      types.set(name, bodyType);
    }
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

  // Clear type params from scope after translating body
  for (const param of typeParamNames) {
    ctx.typeParams.delete(param);
  }

  if (name) {
    const baseType = recordType(fields);
    // If it has type params, wrap with metadata to enable instantiation
    if (typeParamNames.length > 0) {
      types.set(name, withMetadata(baseType, { name, typeParams: typeParamNames }));
    } else {
      types.set(name, baseType);
    }
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
  let classBodyResult: ClassBodyResult | null = null;
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
        classBodyResult = translateClassBody(cursor, ctx);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name && classBodyResult) {
    // Store instance type (the shape of instances of this class)
    const instanceType = recordType(classBodyResult.fields);
    types.set(name, instanceType);

    // Store constructor as a function value that returns the instance type
    // If no explicit constructor, use empty params (default constructor)
    const constructorParams = classBodyResult.constructorParams ?? [];
    values.set(name, functionType(constructorParams, instanceType));
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
 * Translate object type as a Type (handles both records and mapped types)
 */
function translateObjectTypeAsType(cursor: TreeCursor, ctx: TranslationContext): Type {
  // First, check if this is a mapped type
  // Mapped types can appear as:
  // 1. IndexSignature with "in" keyword: { [K in keyof T]: T[K] }
  // 2. PropertyType with BinaryExpression containing "in": { [P in K]: T[P] }
  cursor.firstChild();
  let isMapped = false;

  do {
    if (cursor.name === "IndexSignature") {
      // Check if this IndexSignature has an "in" keyword (mapped type)
      cursor.firstChild();
      do {
        if (cursor.name === "in") {
          isMapped = true;
          break;
        }
      } while (cursor.nextSibling());
      cursor.parent();
      if (isMapped) break;
    }

    if (cursor.name === "PropertyType") {
      // Check for PropertyType with [P in K] syntax (BinaryExpression with "in")
      cursor.firstChild();
      do {
        if (cursor.name === "BinaryExpression") {
          cursor.firstChild();
          do {
            if (cursor.name === "in") {
              isMapped = true;
              break;
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      } while (cursor.nextSibling() && !isMapped);
      cursor.parent();
      if (isMapped) break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (isMapped) {
    return translateMappedType(cursor, ctx);
  }

  // Regular record type
  return recordType(translateObjectType(cursor, ctx));
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
    // Note: IndexSignature is handled separately for mapped types
  } while (cursor.nextSibling());
  cursor.parent();
  return fields;
}

/**
 * Translate a mapped type: { [K in Domain]: ValueType }
 *
 * Two AST forms:
 * 1. IndexSignature: { [K in keyof T]?: T[K] }
 * 2. PropertyType with BinaryExpression: { [P in K]: T[P] }
 */
function translateMappedType(cursor: TreeCursor, ctx: TranslationContext): Type {
  let keyVar = "";
  let keyDomain: Type | null = null;
  let valueType: Type | null = null;
  let optionalMod: "add" | "remove" | "preserve" | undefined;
  let readonlyMod: "add" | "remove" | "preserve" | undefined;

  cursor.firstChild();
  do {
    if (cursor.name === "IndexSignature") {
      // Form 1: IndexSignature with in keyword
      cursor.firstChild();
      let sawIn = false;
      let hasOptional = false;
      let hasReadonly = false;
      let hasMinus = false;
      let hasPlus = false;

      do {
        switch (cursor.name) {
          case "readonly":
            hasReadonly = true;
            break;

          case "PropertyDefinition":
            // This is the key variable (K)
            keyVar = getText(cursor, ctx.source);
            // Add to type params so it can be used in the value type
            ctx.typeParams.set(keyVar, -2); // Use -2 to mark as mapped key var
            break;

          case "in":
            sawIn = true;
            break;

          case "ArithOp":
            // Check for +/- modifiers before ? or readonly
            const opText = getText(cursor, ctx.source);
            if (opText === "-") hasMinus = true;
            if (opText === "+") hasPlus = true;
            break;

          case "Optional":
            hasOptional = true;
            break;

          case "TypeAnnotation":
            valueType = translateTypeAnnotation(cursor, ctx);
            break;

          default:
            // After "in", the next type is the key domain
            if (sawIn && !keyDomain) {
              const translated = translateType(cursor, ctx);
              if (translated) keyDomain = translated;
            }
            break;
        }
      } while (cursor.nextSibling());
      cursor.parent();

      // Determine optional modifier
      if (hasOptional) {
        optionalMod = hasMinus ? "remove" : "add";
      }

      // Determine readonly modifier
      if (hasReadonly) {
        readonlyMod = hasMinus ? "remove" : "add";
      }
    }

    if (cursor.name === "PropertyType") {
      // Form 2: PropertyType with BinaryExpression containing "in"
      cursor.firstChild();
      do {
        if (cursor.name === "BinaryExpression") {
          // Parse [P in K] - BinaryExpression: VariableName "in" VariableName/TypeName
          cursor.firstChild();
          let sawIn = false;
          do {
            if (cursor.name === "VariableName") {
              if (!sawIn) {
                keyVar = getText(cursor, ctx.source);
                ctx.typeParams.set(keyVar, -2);
              } else {
                // This is the key domain (could be a type variable)
                const domainName = getText(cursor, ctx.source);
                keyDomain = typeVarType(domainName);
              }
            }
            if (cursor.name === "in") {
              sawIn = true;
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }

        if (cursor.name === "TypeAnnotation") {
          valueType = translateTypeAnnotation(cursor, ctx);
        }
      } while (cursor.nextSibling());
      cursor.parent();
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Remove key var from type params
  if (keyVar) {
    ctx.typeParams.delete(keyVar);
  }

  if (!keyVar || !keyDomain || !valueType) {
    // Failed to parse - return Unknown
    return primitiveType("Unknown");
  }

  return mappedType(keyVar, keyDomain, valueType, { optional: optionalMod, readonly: readonlyMod });
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
 * Result of translating a class body
 */
interface ClassBodyResult {
  /** Instance fields and methods (excludes constructor) */
  fields: FieldInfo[];
  /** Constructor parameters, if a constructor was declared */
  constructorParams: ParamInfo[] | null;
}

/**
 * Translate class body to fields and constructor info
 */
function translateClassBody(cursor: TreeCursor, ctx: TranslationContext): ClassBodyResult {
  const fields: FieldInfo[] = [];
  let constructorParams: ParamInfo[] | null = null;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDeclaration":
        const propField = translatePropertyDeclaration(cursor, ctx);
        if (propField) fields.push(propField);
        break;

      case "MethodDeclaration":
        const methodResult = translateMethodDeclarationOrConstructor(cursor, ctx);
        if (methodResult.isConstructor) {
          constructorParams = methodResult.params;
        } else if (methodResult.field) {
          fields.push(methodResult.field);
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return { fields, constructorParams };
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
 * Result of translating a method declaration
 */
interface MethodResult {
  isConstructor: boolean;
  field: FieldInfo | null;
  params: ParamInfo[];
}

/**
 * Translate method declaration to FieldInfo, or extract constructor params
 */
function translateMethodDeclarationOrConstructor(cursor: TreeCursor, ctx: TranslationContext): MethodResult {
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

  // Constructor is special - return its params but don't add as field
  if (name === "constructor") {
    return { isConstructor: true, field: null, params };
  }

  if (name) {
    return {
      isConstructor: false,
      field: {
        name,
        type: functionType(params, returnType),
        optional: false,
        annotations: [],
      },
      params: [],
    };
  }
  return { isConstructor: false, field: null, params: [] };
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
      return translateObjectTypeAsType(cursor, ctx);

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

  // Check imported types (from cross-file resolution)
  const importedType = ctx.importedTypes.get(name);
  if (importedType) {
    return importedType;
  }

  // Check local types (for non-generic type references)
  const localType = ctx.localTypes.get(name);
  if (localType) {
    const metadata = getMetadata(localType);
    // If it's a generic type (has typeParams), don't return it directly
    // It needs to be instantiated via translateParameterizedType
    if (!metadata?.typeParams || metadata.typeParams.length === 0) {
      return localType;
    }
    // Generic type used without type args - return the body as-is (like TypeScript allows)
  }

  // Otherwise it's a type reference - use typeVarType as placeholder
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

  // Look up the generic type in local types, imported types, or context
  const genericType = ctx.localTypes.get(baseName) ?? ctx.importedTypes.get(baseName);

  if (genericType) {
    const metadata = getMetadata(genericType);
    if (metadata?.typeParams && metadata.typeParams.length > 0) {
      // It's a generic type - instantiate it with the provided type arguments
      if (typeArgs.length === metadata.typeParams.length) {
        const substitutions = new Map<string, Type>();
        for (let i = 0; i < typeArgs.length; i++) {
          substitutions.set(metadata.typeParams[i], typeArgs[i]);
        }
        // Substitute type vars in the body and return
        const bodyType = unwrapMetadata(genericType);
        return substituteTypeVars(bodyType, substitutions);
      }
      // Wrong number of type arguments - return as unresolved with descriptive name
    }
    // Not a generic type or wrong arity - check if it needs type args
    if (!metadata?.typeParams || metadata.typeParams.length === 0) {
      // Non-generic type used with type args - just return the base type
      return genericType;
    }
  }

  // Fallback: unresolved generic type
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
