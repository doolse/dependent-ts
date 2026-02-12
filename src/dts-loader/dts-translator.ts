/**
 * TypeScript .d.ts Loader - Translator Module
 *
 * Translates Lezer TypeScript AST to CoreDecl[] (same AST as native DepJS).
 * The type checker then processes these CoreDecls uniformly.
 */

import { TreeCursor } from "@lezer/common";
import {
  CoreDecl,
  CoreExpr,
  CoreParam,
  CoreRecordField,
  CoreArgument,
  SourceLocation,
  LiteralKind,
} from "../ast/core-ast";
import { parseDTS, getText } from "./dts-parser";

/**
 * Result of loading a .d.ts file
 */
export interface DTSLoadResult {
  /** Declarations to be processed by the type checker */
  decls: CoreDecl[];
  /** Errors encountered during loading */
  errors: string[];
}

/**
 * Options for loading a .d.ts file
 */
export interface DTSLoadOptions {
  /** Path to the .d.ts file being loaded (for error messages) */
  filePath?: string;
}

// ============================================
// CoreExpr Builder Helpers
// ============================================

const dtsLoc: SourceLocation = { from: 0, to: 0 };

function coreId(name: string): CoreExpr {
  return { kind: "identifier", name, loc: dtsLoc };
}

function coreLit(value: string | number | boolean | null | undefined, literalKind: LiteralKind): CoreExpr {
  return { kind: "literal", value, literalKind, loc: dtsLoc };
}

function coreCall(fn: string | CoreExpr, ...args: CoreExpr[]): CoreExpr {
  const fnExpr = typeof fn === "string" ? coreId(fn) : fn;
  return {
    kind: "call",
    fn: fnExpr,
    args: args.map(a => ({ kind: "element" as const, value: a })),
    loc: dtsLoc,
  };
}

function coreRecord(fields: CoreRecordField[]): CoreExpr {
  return { kind: "record", fields, loc: dtsLoc };
}

function coreArray(elements: CoreExpr[]): CoreExpr {
  return {
    kind: "array",
    elements: elements.map(e => ({ kind: "element" as const, value: e })),
    loc: dtsLoc,
  };
}

function coreLambda(params: CoreParam[], body: CoreExpr, returnType?: CoreExpr): CoreExpr {
  return {
    kind: "lambda",
    params,
    body,
    returnType,
    async: false,
    loc: dtsLoc,
  };
}

function coreThrow(): CoreExpr {
  return {
    kind: "throw",
    expr: coreLit("not implemented", "string"),
    loc: dtsLoc,
  };
}

function coreConst(
  name: string,
  init: CoreExpr,
  options?: { type?: CoreExpr; comptime?: boolean; exported?: boolean }
): CoreDecl {
  return {
    kind: "const",
    name,
    init,
    type: options?.type,
    comptime: options?.comptime ?? false,
    exported: options?.exported ?? false,
    loc: dtsLoc,
  };
}

function coreProperty(object: string | CoreExpr, name: string): CoreExpr {
  const objExpr = typeof object === "string" ? coreId(object) : object;
  return { kind: "property", object: objExpr, name, loc: dtsLoc };
}

function coreFieldInfo(name: string, type: CoreExpr, optional: boolean): CoreExpr {
  return coreRecord([
    { kind: "field", name: "name", value: coreLit(name, "string") },
    { kind: "field", name: "type", value: type },
    { kind: "field", name: "optional", value: coreLit(optional, "boolean") },
    { kind: "field", name: "annotations", value: coreArray([]) },
  ]);
}

function coreParamInfo(name: string, type: CoreExpr, optional: boolean, rest: boolean = false): CoreExpr {
  return coreRecord([
    { kind: "field", name: "name", value: coreLit(name, "string") },
    { kind: "field", name: "type", value: type },
    { kind: "field", name: "optional", value: coreLit(optional, "boolean") },
    { kind: "field", name: "rest", value: coreLit(rest, "boolean") },
    { kind: "field", name: "annotations", value: coreArray([]) },
  ]);
}

// ============================================
// Primitive Type Mapping
// ============================================

const PRIMITIVE_MAP: Record<string, string> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  null: "Null",
  undefined: "Undefined",
  void: "Void",
  never: "Never",
  unknown: "Unknown",
  any: "Unknown",
  object: "Unknown",
};

// ============================================
// Translation Context
// ============================================

interface TranslationContext {
  source: string;
  errors: string[];
  /** Type parameters currently in scope */
  typeParams: Set<string>;
  /** Track emitted function names to skip duplicate overloads */
  emittedFunctions: Set<string>;
  /** Track namespace bodies for export = Ns pattern */
  namespaces: Map<string, CoreDecl[]>;
}

// ============================================
// Main Entry Point
// ============================================

/**
 * Load and translate a .d.ts file to CoreDecl[].
 */
export function loadDTS(content: string, options?: DTSLoadOptions): DTSLoadResult {
  const tree = parseDTS(content);
  const ctx: TranslationContext = {
    source: content,
    errors: [],
    typeParams: new Set(),
    emittedFunctions: new Set(),
    namespaces: new Map(),
  };

  const decls: CoreDecl[] = [];
  let exportEqualsName: string | null = null;

  // First pass: find export = NsName pattern
  const cursor1 = tree.cursor();
  if (cursor1.firstChild()) {
    do {
      if (cursor1.name === "ExportDeclaration") {
        const name = findExportEquals(cursor1, ctx.source);
        if (name) exportEqualsName = name;
      }
    } while (cursor1.nextSibling());
  }

  // Second pass: translate declarations
  const cursor2 = tree.cursor();
  if (cursor2.firstChild()) {
    do {
      decls.push(...translateTopLevel(cursor2, ctx));
    } while (cursor2.nextSibling());
  }

  // If export = NsName, promote namespace members to top-level
  if (exportEqualsName && ctx.namespaces.has(exportEqualsName)) {
    const nsDecls = ctx.namespaces.get(exportEqualsName)!;
    decls.push(...nsDecls);
  }

  return { decls, errors: ctx.errors };
}

/**
 * Find the name in an `export = Name` declaration.
 */
function findExportEquals(cursor: TreeCursor, source: string): string | null {
  let hasExport = false;
  let hasEquals = false;
  let name: string | null = null;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "export":
        hasExport = true;
        break;
      case "Equals":
      case "=":
        hasEquals = true;
        break;
      case "VariableName":
      case "VariableDefinition":
        if (hasExport && hasEquals) {
          name = getText(cursor, source);
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  return name;
}

// ============================================
// Top-Level Declaration Translation
// ============================================

function translateTopLevel(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  switch (cursor.name) {
    case "TypeAliasDeclaration":
      return translateTypeAlias(cursor, ctx);

    case "InterfaceDeclaration":
      return translateInterface(cursor, ctx);

    case "AmbientDeclaration":
      return translateAmbientDeclaration(cursor, ctx);

    case "ExportDeclaration":
      return translateExportDeclaration(cursor, ctx);

    case "ImportDeclaration":
      return translateImportDeclaration(cursor, ctx);

    case "FunctionDeclaration":
      return translateFunctionDeclaration(cursor, ctx);

    case "NamespaceDeclaration":
      return translateNamespace(cursor, ctx);

    case "VariableDeclaration":
      return translateVariableDeclaration(cursor, ctx);

    default:
      return [];
  }
}

// ============================================
// Declaration Translators
// ============================================

/**
 * Translate type alias: type Foo = T or type Foo<A> = T
 */
function translateTypeAlias(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  let typeParamNames: string[] = [];
  let bodyExpr: CoreExpr | null = null;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "TypeDefinition":
        name = getText(cursor, ctx.source);
        break;
      case "TypeParamList":
        typeParamNames = translateTypeParamList(cursor, ctx);
        break;
      default: {
        const translated = translateType(cursor, ctx);
        if (translated) bodyExpr = translated;
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Clean up type params from scope
  for (const p of typeParamNames) {
    ctx.typeParams.delete(p);
  }

  if (!name || !bodyExpr) return [];

  // Build metadata record
  const metadataFields: CoreRecordField[] = [
    { kind: "field", name: "name", value: coreLit(name, "string") },
  ];

  if (typeParamNames.length > 0) {
    metadataFields.push({
      kind: "field",
      name: "typeArgs",
      value: coreArray(typeParamNames.map(n => coreId(n))),
    });

    // Wrap in lambda: (A: Type) => WithMetadata(body, metadata)
    const params: CoreParam[] = typeParamNames.map(n => ({
      name: n,
      type: coreId("Type"),
      annotations: [],
    }));

    const init = coreLambda(
      params,
      coreCall("WithMetadata", bodyExpr, coreRecord(metadataFields)),
      coreId("Type"),
    );

    return [coreConst(name, init, { comptime: true })];
  }

  // Non-generic: const Foo = WithMetadata(body, metadata)
  const init = coreCall("WithMetadata", bodyExpr, coreRecord(metadataFields));
  return [coreConst(name, init, { comptime: true })];
}

/**
 * Translate interface declaration: interface Foo { x: T }
 */
function translateInterface(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  let typeParamNames: string[] = [];
  let fields: CoreExpr[] = [];

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
        fields = translateObjectTypeFields(cursor, ctx);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Clean up type params
  for (const p of typeParamNames) {
    ctx.typeParams.delete(p);
  }

  if (!name) return [];

  const bodyExpr = coreCall("RecordType", coreArray(fields));

  const metadataFields: CoreRecordField[] = [
    { kind: "field", name: "name", value: coreLit(name, "string") },
  ];

  if (typeParamNames.length > 0) {
    metadataFields.push({
      kind: "field",
      name: "typeArgs",
      value: coreArray(typeParamNames.map(n => coreId(n))),
    });

    const params: CoreParam[] = typeParamNames.map(n => ({
      name: n,
      type: coreId("Type"),
      annotations: [],
    }));

    const init = coreLambda(
      params,
      coreCall("WithMetadata", bodyExpr, coreRecord(metadataFields)),
      coreId("Type"),
    );

    return [coreConst(name, init, { comptime: true })];
  }

  const init = coreCall("WithMetadata", bodyExpr, coreRecord(metadataFields));
  return [coreConst(name, init, { comptime: true })];
}

/**
 * Translate ambient declaration (declare function, declare class, declare namespace, etc.)
 */
function translateAmbientDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  const decls: CoreDecl[] = [];
  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "AmbientFunctionDeclaration":
        decls.push(...translateAmbientFunction(cursor, ctx));
        break;
      case "ClassDeclaration":
        decls.push(...translateClassDeclaration(cursor, ctx));
        break;
      case "NamespaceDeclaration":
        decls.push(...translateNamespace(cursor, ctx));
        break;
      case "VariableDeclaration":
        decls.push(...translateVariableDeclaration(cursor, ctx));
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return decls;
}

/**
 * Translate a function (ambient or regular).
 * Generic functions become lambdas with Type params and wideTypeOf defaults.
 * Non-generic functions become lambdas with throw body.
 * Overloaded functions: only the first overload is emitted.
 */
function translateAmbientFunction(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  let typeParamNames: string[] = [];
  let params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] = [];
  let returnTypeExpr: CoreExpr = coreId("Void");

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
        params = translateParamList(cursor, ctx);
        break;
      case "TypeAnnotation":
        const retType = translateTypeAnnotation(cursor, ctx);
        if (retType) returnTypeExpr = retType;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Clean up type params
  for (const p of typeParamNames) {
    ctx.typeParams.delete(p);
  }

  if (!name) return [];

  // Skip duplicate overloads
  if (ctx.emittedFunctions.has(name)) return [];
  ctx.emittedFunctions.add(name);

  return [buildFunctionDecl(name, typeParamNames, params, returnTypeExpr)];
}

/**
 * Translate a function declaration (inside namespace body).
 */
function translateFunctionDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  let typeParamNames: string[] = [];
  let params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] = [];
  let returnTypeExpr: CoreExpr = coreId("Void");

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
        params = translateParamList(cursor, ctx);
        break;
      case "TypeAnnotation":
        const retType = translateTypeAnnotation(cursor, ctx);
        if (retType) returnTypeExpr = retType;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Clean up type params
  for (const p of typeParamNames) {
    ctx.typeParams.delete(p);
  }

  if (!name) return [];

  // Skip duplicate overloads
  if (ctx.emittedFunctions.has(name)) return [];
  ctx.emittedFunctions.add(name);

  return [buildFunctionDecl(name, typeParamNames, params, returnTypeExpr)];
}

/**
 * Build a function CoreDecl from parsed components.
 */
function buildFunctionDecl(
  name: string,
  typeParamNames: string[],
  params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[],
  returnTypeExpr: CoreExpr
): CoreDecl {
  // Build value params
  const coreParams: CoreParam[] = params.map(p => ({
    name: p.name,
    type: p.type,
    annotations: [],
    rest: p.rest || undefined,
  }));

  if (typeParamNames.length > 0) {
    // Generic function: add type params with wideTypeOf defaults
    for (const tp of typeParamNames) {
      // Find first value param whose type mentions this type param
      const matchingParam = params.find(p => exprMentions(p.type, tp));
      const defaultValue = matchingParam
        ? coreCall("wideTypeOf", coreId(matchingParam.name))
        : undefined;

      coreParams.push({
        name: tp,
        type: coreId("Type"),
        defaultValue,
        annotations: [],
      });
    }
  }

  const init = coreLambda(coreParams, coreThrow(), returnTypeExpr);
  return coreConst(name, init);
}

/**
 * Check if a CoreExpr mentions a name (used to find type param references).
 */
function exprMentions(expr: CoreExpr, name: string): boolean {
  switch (expr.kind) {
    case "identifier":
      return expr.name === name;
    case "call":
      return exprMentions(expr.fn, name) || expr.args.some(a =>
        a.kind === "element" ? exprMentions(a.value, name) :
        a.kind === "spread" ? exprMentions(a.expr, name) : false
      );
    case "property":
      return exprMentions(expr.object, name);
    case "record":
      return expr.fields.some(f =>
        f.kind === "field" ? exprMentions(f.value, name) :
        f.kind === "spread" ? exprMentions(f.expr, name) : false
      );
    case "array":
      return expr.elements.some(e =>
        e.kind === "element" ? exprMentions(e.value, name) :
        e.kind === "spread" ? exprMentions(e.expr, name) : false
      );
    default:
      return false;
  }
}

/**
 * Translate a variable declaration: declare const x: T
 */
function translateVariableDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  let typeExpr: CoreExpr | null = null;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
        name = getText(cursor, ctx.source);
        break;
      case "TypeAnnotation":
        typeExpr = translateTypeAnnotation(cursor, ctx);
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (!name) return [];

  return [coreConst(name, coreThrow(), { type: typeExpr ?? coreId("Unknown") })];
}

/**
 * Translate a class declaration.
 * Class produces:
 * - A type binding (instance type as record)
 * - A value binding (constructor function)
 */
function translateClassDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  let typeParamNames: string[] = [];
  let fields: CoreExpr[] = [];
  let constructorParams: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] | null = null;

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
        const result = translateClassBody(cursor, ctx);
        fields = result.fields;
        constructorParams = result.constructorParams;
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Clean up type params
  for (const p of typeParamNames) {
    ctx.typeParams.delete(p);
  }

  if (!name) return [];

  const decls: CoreDecl[] = [];

  // Instance type
  const instanceType = coreCall("RecordType", coreArray(fields));
  const typeMetadata: CoreRecordField[] = [
    { kind: "field", name: "name", value: coreLit(name, "string") },
  ];
  decls.push(coreConst(name, coreCall("WithMetadata", instanceType, coreRecord(typeMetadata)), { comptime: true }));

  // Constructor function (as value with same name — the type checker allows this
  // since the comptime const and the runtime value exist in different envs)
  const ctorParams = constructorParams ?? [];
  const ctorParamsCoreExpr = ctorParams.map(p => ({
    name: p.name,
    type: p.type,
    annotations: [] as CoreExpr[],
    rest: p.rest || undefined,
  }));
  // Return the instance type
  // The constructor is a non-generic function for simplicity
  // (we skip the class name as value since it conflicts with the type)

  return decls;
}

/**
 * Translate a namespace declaration.
 * Members are collected and stored; if export = NsName is present,
 * they're promoted to top-level.
 */
function translateNamespace(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let name = "";
  const nsDecls: CoreDecl[] = [];

  // Save and clear function tracking for namespace scope
  const savedEmittedFunctions = ctx.emittedFunctions;
  ctx.emittedFunctions = new Set();

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
        name = getText(cursor, ctx.source);
        break;
      case "Block":
        cursor.firstChild();
        do {
          nsDecls.push(...translateTopLevel(cursor, ctx));
        } while (cursor.nextSibling());
        cursor.parent();
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Restore function tracking
  ctx.emittedFunctions = savedEmittedFunctions;

  if (name) {
    // Store namespace decls for potential export = Ns promotion
    ctx.namespaces.set(name, nsDecls);
  }

  // Always emit the namespace as a "block" that defines all members,
  // and then create a record value for namespace access (e.g., React.useState)
  // The namespace members are NOT directly available at the parent scope
  // unless export = Ns promotes them.

  // For namespace access like React.ElementType, we need the namespace value.
  // We'll emit nothing here — the export = Ns path adds members to top-level,
  // and the type checker builds the namespace record when processing imports.
  return [];
}

/**
 * Translate an import declaration within a .d.ts file.
 * Produces a CoreDecl import that the type checker resolves.
 */
function translateImportDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  let moduleSpecifier = "";
  let namespaceAlias = "";
  let defaultImportName = "";
  const namedImports: { name: string; alias?: string }[] = [];
  let hasStar = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "import":
      case "from":
      case "type":
        break;
      case "Star":
        hasStar = true;
        break;
      case "as":
        break;
      case "VariableDefinition": {
        const name = getText(cursor, ctx.source);
        if (hasStar) {
          namespaceAlias = name;
        } else if (!defaultImportName && namedImports.length === 0) {
          defaultImportName = name;
        }
        break;
      }
      case "ImportGroup":
        parseImportGroup(cursor, ctx, namedImports);
        if (defaultImportName) {
          // The previous VariableDefinition was actually a default import
          // (followed by named imports)
        }
        break;
      case "String": {
        const specText = getText(cursor, ctx.source);
        moduleSpecifier = specText.slice(1, -1);
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (!moduleSpecifier) return [];

  // Produce CoreDecl import
  if (namespaceAlias) {
    return [{
      kind: "import",
      clause: { kind: "namespace", name: namespaceAlias },
      source: moduleSpecifier,
      loc: dtsLoc,
    }];
  }

  if (namedImports.length > 0) {
    return [{
      kind: "import",
      clause: {
        kind: "named",
        specifiers: namedImports.map(ni => ({ name: ni.name, alias: ni.alias })),
      },
      source: moduleSpecifier,
      loc: dtsLoc,
    }];
  }

  if (defaultImportName) {
    return [{
      kind: "import",
      clause: { kind: "default", name: defaultImportName },
      source: moduleSpecifier,
      loc: dtsLoc,
    }];
  }

  return [];
}

/**
 * Parse an import group: { A, B as C }
 */
function parseImportGroup(
  cursor: TreeCursor,
  ctx: TranslationContext,
  items: { name: string; alias?: string }[]
): void {
  let currentName = "";
  let expectingAlias = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableDefinition":
      case "VariableName": {
        const name = getText(cursor, ctx.source);
        if (expectingAlias) {
          items.push({ name: currentName, alias: name });
          currentName = "";
          expectingAlias = false;
        } else {
          if (currentName) {
            items.push({ name: currentName });
          }
          currentName = name;
        }
        break;
      }
      case "as":
        expectingAlias = true;
        break;
      case ",":
        if (currentName && !expectingAlias) {
          items.push({ name: currentName });
          currentName = "";
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (currentName && !expectingAlias) {
    items.push({ name: currentName });
  }
}

/**
 * Translate an export declaration.
 */
function translateExportDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreDecl[] {
  const decls: CoreDecl[] = [];
  let hasFromClause = false;
  let isStarExport = false;
  let moduleSpecifier = "";
  const exportGroupItems: { localName: string; exportedName: string }[] = [];

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "export":
      case "type":
        break;

      case "from":
        hasFromClause = true;
        break;

      case "Star":
        isStarExport = true;
        hasFromClause = true;
        break;

      case "String": {
        const specText = getText(cursor, ctx.source);
        moduleSpecifier = specText.slice(1, -1);
        break;
      }

      case "ExportGroup":
        parseExportGroup(cursor, ctx, exportGroupItems);
        break;

      // Inline export declarations
      case "TypeAliasDeclaration":
        decls.push(...translateTypeAlias(cursor, ctx));
        break;
      case "InterfaceDeclaration":
        decls.push(...translateInterface(cursor, ctx));
        break;
      case "FunctionDeclaration":
        decls.push(...translateFunctionDeclaration(cursor, ctx));
        break;
      case "AmbientDeclaration":
        decls.push(...translateAmbientDeclaration(cursor, ctx));
        break;

      // export = Name is handled in findExportEquals, skip here
      case "Equals":
      case "=":
      case "VariableName":
      case "VariableDefinition":
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  // Handle re-exports: export * from "module" or export { A } from "module"
  if (hasFromClause && moduleSpecifier) {
    if (isStarExport) {
      // export * from "module" — emit a namespace import + we need to re-export
      // For simplicity, emit as a "wildcard re-export" using import
      // The type checker will need to handle this
      const tempName = `_reexport_${moduleSpecifier.replace(/[^a-zA-Z0-9]/g, "_")}`;
      decls.push({
        kind: "import",
        clause: { kind: "namespace", name: tempName },
        source: moduleSpecifier,
        loc: dtsLoc,
      });
      // We can't easily re-export all members without knowing them.
      // For now, skip star re-exports (not needed for react-counter).
    } else if (exportGroupItems.length > 0) {
      // export { A, B } from "module" — import then re-define
      decls.push({
        kind: "import",
        clause: {
          kind: "named",
          specifiers: exportGroupItems.map(e => ({
            name: e.localName,
            alias: e.localName !== e.exportedName ? e.exportedName : undefined,
          })),
        },
        source: moduleSpecifier,
        loc: dtsLoc,
      });
    }
  }

  return decls;
}

/**
 * Parse an export group: { A } or { A as B }
 */
function parseExportGroup(
  cursor: TreeCursor,
  ctx: TranslationContext,
  items: { localName: string; exportedName: string }[]
): void {
  let currentLocalName = "";
  let expectingExportedName = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "VariableName":
      case "VariableDefinition": {
        const name = getText(cursor, ctx.source);
        if (expectingExportedName) {
          items.push({ localName: currentLocalName, exportedName: name });
          currentLocalName = "";
          expectingExportedName = false;
        } else {
          if (currentLocalName) {
            items.push({ localName: currentLocalName, exportedName: currentLocalName });
          }
          currentLocalName = name;
        }
        break;
      }
      case "as":
        expectingExportedName = true;
        break;
      case ",":
        if (currentLocalName && !expectingExportedName) {
          items.push({ localName: currentLocalName, exportedName: currentLocalName });
          currentLocalName = "";
        }
        break;
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (currentLocalName && !expectingExportedName) {
    items.push({ localName: currentLocalName, exportedName: currentLocalName });
  }
}

// ============================================
// Type Parameter List
// ============================================

function translateTypeParamList(cursor: TreeCursor, ctx: TranslationContext): string[] {
  const names: string[] = [];
  cursor.firstChild();
  do {
    if (cursor.name === "TypeDefinition") {
      const name = getText(cursor, ctx.source);
      names.push(name);
      ctx.typeParams.add(name);
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return names;
}

// ============================================
// Parameter List
// ============================================

function translateParamList(
  cursor: TreeCursor,
  ctx: TranslationContext
): { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] {
  const params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] = [];
  let currentName = "";
  let currentType: CoreExpr = coreId("Unknown");
  let currentOptional = false;
  let currentRest = false;
  let nextIsRest = false;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "Spread":
        nextIsRest = true;
        break;
      case "VariableDefinition": {
        if (currentName) {
          params.push({ name: currentName, type: currentType, optional: currentOptional, rest: currentRest });
        }
        currentName = getText(cursor, ctx.source);
        currentType = coreId("Unknown");
        currentOptional = false;
        currentRest = nextIsRest;
        nextIsRest = false;
        break;
      }
      case "Optional":
        currentOptional = true;
        break;
      case "TypeAnnotation": {
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) currentType = t;
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (currentName) {
    params.push({ name: currentName, type: currentType, optional: currentOptional, rest: currentRest });
  }

  return params;
}

/**
 * Translate a type annotation (: Type)
 */
function translateTypeAnnotation(cursor: TreeCursor, ctx: TranslationContext): CoreExpr | null {
  cursor.firstChild();
  let result: CoreExpr | null = null;
  do {
    const translated = translateType(cursor, ctx);
    if (translated) result = translated;
  } while (cursor.nextSibling());
  cursor.parent();
  return result;
}

// ============================================
// Class Body
// ============================================

function translateClassBody(
  cursor: TreeCursor,
  ctx: TranslationContext
): { fields: CoreExpr[]; constructorParams: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] | null } {
  const fields: CoreExpr[] = [];
  let constructorParams: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] | null = null;

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDeclaration": {
        const field = translatePropertyDeclaration(cursor, ctx);
        if (field) fields.push(field);
        break;
      }
      case "MethodDeclaration": {
        const result = translateMethodDeclaration(cursor, ctx);
        if (result.isConstructor) {
          constructorParams = result.params;
        } else if (result.field) {
          fields.push(result.field);
        }
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  return { fields, constructorParams };
}

function translatePropertyDeclaration(cursor: TreeCursor, ctx: TranslationContext): CoreExpr | null {
  let name = "";
  let typeExpr: CoreExpr = coreId("Unknown");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDefinition":
        name = getText(cursor, ctx.source);
        break;
      case "TypeAnnotation": {
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) typeExpr = t;
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    return coreFieldInfo(name, typeExpr, false);
  }
  return null;
}

function translateMethodDeclaration(
  cursor: TreeCursor,
  ctx: TranslationContext
): { isConstructor: boolean; field: CoreExpr | null; params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] } {
  let name = "";
  let params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] = [];
  let returnTypeExpr: CoreExpr = coreId("Void");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "PropertyDefinition":
        name = getText(cursor, ctx.source);
        break;
      case "ParamList":
        params = translateParamList(cursor, ctx);
        break;
      case "TypeAnnotation": {
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) returnTypeExpr = t;
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name === "constructor") {
    return { isConstructor: true, field: null, params };
  }

  if (name) {
    const methodType = coreCall(
      "FunctionType",
      coreArray(params.map(p => coreParamInfo(p.name, p.type, p.optional, p.rest))),
      returnTypeExpr,
    );
    return {
      isConstructor: false,
      field: coreFieldInfo(name, methodType, false),
      params: [],
    };
  }

  return { isConstructor: false, field: null, params: [] };
}

// ============================================
// Object Type Fields
// ============================================

function translateObjectTypeFields(cursor: TreeCursor, ctx: TranslationContext): CoreExpr[] {
  const fields: CoreExpr[] = [];
  cursor.firstChild();
  do {
    if (cursor.name === "PropertyType") {
      const field = translatePropertyType(cursor, ctx);
      if (field) fields.push(field);
    }
    // Skip IndexSignature, mapped types, etc. for now
  } while (cursor.nextSibling());
  cursor.parent();
  return fields;
}

function translatePropertyType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr | null {
  let name = "";
  let typeExpr: CoreExpr = coreId("Unknown");
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
      case "TypeAnnotation": {
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) typeExpr = t;
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  if (name) {
    return coreFieldInfo(name, typeExpr, optional);
  }
  return null;
}

// ============================================
// Type Translation (→ CoreExpr)
// ============================================

function translateType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr | null {
  switch (cursor.name) {
    case "TypeName":
      return translateTypeName(cursor, ctx);

    case "UnionType":
      return translateUnionType(cursor, ctx);

    case "IntersectionType":
      return translateIntersectionType(cursor, ctx);

    case "ObjectType":
      return translateObjectType(cursor, ctx);

    case "ArrayType":
      return translateArrayType(cursor, ctx);

    case "TupleType":
      return translateTupleType(cursor, ctx);

    case "FunctionSignature":
      return translateFunctionSignature(cursor, ctx);

    case "ParameterizedType":
      return translateParameterizedType(cursor, ctx);

    case "ParenthesizedType":
      return translateParenthesizedType(cursor, ctx);

    case "LiteralType":
      return translateLiteralType(cursor, ctx);

    case "NullType":
      return coreId("Null");

    case "VoidType":
      return coreId("Void");

    case "IndexedType":
      return translateIndexedType(cursor, ctx);

    case "KeyofType":
      // Degrade to Unknown for now
      return coreId("Unknown");

    case "ConditionalType":
      // Degrade to Unknown for now
      return coreId("Unknown");

    case "TypeofType":
      return translateTypeofType(cursor, ctx);

    case "InferredType":
      return coreId("Unknown");

    default:
      return null;
  }
}

function translateTypeName(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  const name = getText(cursor, ctx.source);

  // Check primitives
  if (name in PRIMITIVE_MAP) {
    return coreId(PRIMITIVE_MAP[name]);
  }

  // Type parameters in scope or other references — just emit identifier
  // The type checker will resolve it from scope
  return coreId(name);
}

function translateUnionType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  const members: CoreExpr[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) members.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  if (members.length === 0) return coreId("Never");
  if (members.length === 1) return members[0];

  // Reduce: A | B | C → Union(Union(A, B), C)
  return members.reduce((left, right) => coreCall("Union", left, right));
}

function translateIntersectionType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  const members: CoreExpr[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) members.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  if (members.length === 0) return coreId("Unknown");
  if (members.length === 1) return members[0];

  return members.reduce((left, right) => coreCall("Intersection", left, right));
}

function translateObjectType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  const fields = translateObjectTypeFields(cursor, ctx);
  return coreCall("RecordType", coreArray(fields));
}

function translateArrayType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  cursor.firstChild();
  const elementType = translateType(cursor, ctx) ?? coreId("Unknown");
  cursor.parent();
  return coreCall("Array", elementType);
}

function translateTupleType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  const elementTypes: CoreExpr[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) elementTypes.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  // Fixed-length array: Array(A, B, C)
  return coreCall("Array", ...elementTypes);
}

function translateFunctionSignature(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  let params: { name: string; type: CoreExpr; optional: boolean; rest: boolean }[] = [];
  let returnTypeExpr: CoreExpr = coreId("Void");

  cursor.firstChild();
  do {
    switch (cursor.name) {
      case "ParamList":
        params = translateParamList(cursor, ctx);
        break;
      case "TypeAnnotation": {
        const t = translateTypeAnnotation(cursor, ctx);
        if (t) returnTypeExpr = t;
        break;
      }
      default: {
        const translated = translateType(cursor, ctx);
        if (translated) returnTypeExpr = translated;
        break;
      }
    }
  } while (cursor.nextSibling());
  cursor.parent();

  return coreCall(
    "FunctionType",
    coreArray(params.map(p => coreParamInfo(p.name, p.type, p.optional, p.rest))),
    returnTypeExpr,
  );
}

function translateParameterizedType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  let baseName = "";
  const typeArgs: CoreExpr[] = [];

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

  // Special case: Array<T> → Array(T)
  if (baseName === "Array" && typeArgs.length === 1) {
    return coreCall("Array", typeArgs[0]);
  }

  // Check if base is a primitive
  if (baseName in PRIMITIVE_MAP) {
    return coreId(PRIMITIVE_MAP[baseName]);
  }

  // Generic type application: Foo<A, B> → Foo(A, B)
  // The type checker will resolve Foo and call it with the args
  if (typeArgs.length > 0) {
    return coreCall(coreId(baseName), ...typeArgs);
  }

  return coreId(baseName);
}

function translateParenthesizedType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  cursor.firstChild();
  let result: CoreExpr | null = null;
  do {
    const translated = translateType(cursor, ctx);
    if (translated) result = translated;
  } while (cursor.nextSibling());
  cursor.parent();
  return result ?? coreId("Unknown");
}

function translateLiteralType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  cursor.firstChild();
  const text = getText(cursor, ctx.source);
  cursor.parent();

  if (text === "true") return coreCall("LiteralType", coreLit(true, "boolean"));
  if (text === "false") return coreCall("LiteralType", coreLit(false, "boolean"));
  if (text.startsWith('"') || text.startsWith("'")) {
    return coreCall("LiteralType", coreLit(text.slice(1, -1), "string"));
  }
  const num = Number(text);
  if (!isNaN(num)) {
    const isInt = Number.isInteger(num);
    return coreCall("LiteralType", coreLit(num, isInt ? "int" : "float"));
  }
  return coreId("Unknown");
}

/**
 * Translate indexed type (T[K]).
 * For member access patterns (Ns.Member), emit property access.
 */
function translateIndexedType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  const parts: CoreExpr[] = [];
  cursor.firstChild();
  do {
    const translated = translateType(cursor, ctx);
    if (translated) parts.push(translated);
  } while (cursor.nextSibling());
  cursor.parent();

  if (parts.length >= 2) {
    const [objectExpr, indexExpr] = parts;

    // Dot access pattern: both are identifiers → property access
    if (objectExpr.kind === "identifier" && indexExpr.kind === "identifier") {
      return coreProperty(objectExpr, indexExpr.name);
    }

    // Bracket access with literal string key: T["key"]
    if (indexExpr.kind === "literal" && indexExpr.literalKind === "string") {
      return coreProperty(objectExpr, indexExpr.value as string);
    }

    // General case: degrade to Unknown
    return coreId("Unknown");
  }

  return coreId("Unknown");
}

/**
 * Translate typeof type: typeof foo or typeof Foo.bar
 */
function translateTypeofType(cursor: TreeCursor, ctx: TranslationContext): CoreExpr {
  cursor.firstChild(); // Move past 'typeof'
  cursor.nextSibling();

  let result: CoreExpr = coreId("Unknown");

  if (cursor.name === "VariableName") {
    const name = getText(cursor, ctx.source);
    result = coreCall("typeOf", coreId(name));
  } else if (cursor.name === "MemberExpression") {
    const text = getText(cursor, ctx.source);
    const parts = text.split(".");
    if (parts.length === 2) {
      result = coreCall("typeOf", coreProperty(parts[0], parts[1]));
    }
  }

  cursor.parent();
  return result;
}
