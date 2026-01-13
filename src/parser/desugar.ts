/**
 * Desugar Lezer Tree to CoreAST.
 *
 * Transforms:
 * - Type syntax (A | B, { a: T }) → function calls (Union(A, B), RecordType([...]))
 * - type X = T → const X = WithMetadata(T, { name: "X" })
 * - newtype X = T → const X = Branded(T, "X")
 */

import { Tree, TreeCursor } from "@lezer/common";
import {
  CoreDecl,
  CoreExpr,
  CoreParam,
  CoreCase,
  CorePattern,
  CorePatternField,
  CoreRecordField,
  CoreArrayElement,
  CoreImportClause,
  CoreImportSpecifier,
  SourceLocation,
  LiteralKind,
  BinaryOp,
  UnaryOp,
  CompileError,
} from "../ast/core-ast";
import { parser } from "./parser";

/**
 * Parse source code and desugar to CoreAST.
 */
export function parse(source: string): CoreDecl[] {
  const tree = parser.parse(source);
  return desugar(tree, source);
}

/**
 * Desugar a Lezer tree to CoreAST declarations.
 */
export function desugar(tree: Tree, source: string): CoreDecl[] {
  const cursor = tree.cursor();
  const decls: CoreDecl[] = [];

  // Skip to Program's children
  if (cursor.name === "Program" && cursor.firstChild()) {
    do {
      const decl = desugarStatement(cursor, source);
      if (decl) decls.push(decl);
    } while (cursor.nextSibling());
  }

  return decls;
}

function loc(cursor: TreeCursor): SourceLocation {
  return { from: cursor.from, to: cursor.to };
}

function text(cursor: TreeCursor, source: string): string {
  return source.slice(cursor.from, cursor.to);
}

function error(message: string, cursor: TreeCursor): never {
  throw new CompileError(message, "desugar", loc(cursor));
}

// Helper to get cursor name without TypeScript's type narrowing issues
function nodeName(cursor: TreeCursor): string {
  return cursor.name;
}

// ============================================
// Statements
// ============================================

function desugarStatement(cursor: TreeCursor, source: string): CoreDecl | null {
  switch (cursor.name) {
    case "ConstDecl":
      return desugarConstDecl(cursor, source);
    case "TypeDecl":
      return desugarTypeDecl(cursor, source);
    case "NewtypeDecl":
      return desugarNewtypeDecl(cursor, source);
    case "ImportDecl":
      return desugarImportDecl(cursor, source);
    case "ExportDecl":
      return desugarExportDecl(cursor, source);
    case "ExpressionStatement":
      return desugarExprStatement(cursor, source);
    case "⚠":
      // Parse error - skip
      return null;
    default:
      // Skip unknown nodes (like whitespace, comments)
      return null;
  }
}

function desugarConstDecl(cursor: TreeCursor, source: string): CoreDecl {
  const declLoc = loc(cursor);
  let name = "";
  let typeAnnotation: CoreExpr | undefined;
  let init: CoreExpr | undefined;
  let comptime = false;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "comptime":
          comptime = true;
          break;
        case "const":
          break;
        case "VariableName":
        case "TypeName":
          name = text(cursor, source);
          break;
        case "TypeAnnotation":
          typeAnnotation = desugarTypeAnnotation(cursor, source);
          break;
        case "=":
          break;
        default:
          if (isExpression(cursor.name)) {
            init = desugarExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!init) {
    error("const declaration missing initializer", cursor);
  }

  return {
    kind: "const",
    name,
    type: typeAnnotation,
    init,
    comptime,
    exported: false,
    loc: declLoc,
  };
}

function desugarTypeDecl(cursor: TreeCursor, source: string): CoreDecl {
  const declLoc = loc(cursor);
  let name = "";
  let typeExpr: CoreExpr | undefined;
  const annotations: CoreExpr[] = [];
  let typeParams: { name: string; constraint?: CoreExpr }[] = [];

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Annotation":
          annotations.push(desugarAnnotation(cursor, source));
          break;
        case "type":
          break;
        case "TypeName":
          name = text(cursor, source);
          break;
        case "TypeParams":
          typeParams = desugarTypeParams(cursor, source);
          break;
        case "=":
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            typeExpr = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!typeExpr) {
    error("type declaration missing type expression", cursor);
  }

  // Desugar: type Foo = T → const Foo = WithMetadata(T, { name: "Foo" })
  // For parameterized types: type Foo<T> = ... → const Foo = (T: Type) => WithMetadata(..., { name: "Foo", typeArgs: [T] })
  // For generic function types: type Foo = <T>(...) => R → const Foo = (T: Type) => WithMetadata(FunctionType(...), { name: "Foo", typeArgs: [T] })
  let init: CoreExpr;

  // Check if typeExpr is a lambda (from generic function type desugaring)
  // If so, extract the type params and merge with the type declaration handling
  let effectiveTypeExpr: CoreExpr = typeExpr;
  let functionTypeParams: CoreParam[] = [];

  if (typeExpr.kind === "lambda" && typeParams.length === 0) {
    // This is a generic function type like <T>(x: T) => T
    // The lambda params are the type params, the body is the FunctionType call
    functionTypeParams = typeExpr.params;
    effectiveTypeExpr = typeExpr.body;
  }

  // Combine type params from type declaration and from generic function type
  const allTypeParams = [...typeParams, ...functionTypeParams.map(p => ({
    name: p.name,
    constraint: p.type?.kind === "call" && p.type.fn.kind === "identifier" && p.type.fn.name === "Type"
      ? p.type.args[0]
      : undefined
  }))];

  const metadata: CoreRecordField[] = [
    {
      kind: "field",
      name: "name",
      value: { kind: "literal", value: name, literalKind: "string", loc: declLoc },
    },
  ];

  if (annotations.length > 0) {
    metadata.push({
      kind: "field",
      name: "annotations",
      value: {
        kind: "array",
        elements: annotations.map((a) => ({ kind: "element" as const, value: a })),
        loc: declLoc,
      },
    });
  }

  const withMetadataCall: CoreExpr = {
    kind: "call",
    fn: { kind: "identifier", name: "WithMetadata", loc: declLoc },
    args: [
      effectiveTypeExpr,
      { kind: "record", fields: metadata, loc: declLoc },
    ],
    loc: declLoc,
  };

  if (allTypeParams.length > 0) {
    // Wrap in lambda: (T: Type = Default, U: Type) => WithMetadata(...)
    const params: CoreParam[] = allTypeParams.map((tp) => ({
      name: tp.name,
      type: tp.constraint
        ? {
            kind: "call" as const,
            fn: { kind: "identifier" as const, name: "Type", loc: declLoc },
            args: [tp.constraint],
            loc: declLoc,
          }
        : { kind: "identifier" as const, name: "Type", loc: declLoc },
      defaultValue: tp.defaultValue,
      annotations: [],
    }));

    // Add typeArgs to metadata
    metadata.push({
      kind: "field",
      name: "typeArgs",
      value: {
        kind: "array",
        elements: allTypeParams.map((tp) => ({
          kind: "element" as const,
          value: { kind: "identifier", name: tp.name, loc: declLoc } as CoreExpr,
        })),
        loc: declLoc,
      },
    });

    init = {
      kind: "lambda",
      params,
      body: withMetadataCall,
      async: false,
      loc: declLoc,
    };
  } else {
    init = withMetadataCall;
  }

  return {
    kind: "const",
    name,
    type: undefined,
    init,
    comptime: true,
    exported: false,
    loc: declLoc,
  };
}

function desugarNewtypeDecl(cursor: TreeCursor, source: string): CoreDecl {
  const declLoc = loc(cursor);
  let name = "";
  let baseType: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "newtype":
          break;
        case "TypeName":
          name = text(cursor, source);
          break;
        case "=":
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            baseType = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!baseType) {
    error("newtype declaration missing base type", cursor);
  }

  // Desugar: newtype Foo = T → const Foo = Branded(T, "Foo")
  const init: CoreExpr = {
    kind: "call",
    fn: { kind: "identifier", name: "Branded", loc: declLoc },
    args: [
      baseType,
      { kind: "literal", value: name, literalKind: "string", loc: declLoc },
    ],
    loc: declLoc,
  };

  return {
    kind: "const",
    name,
    type: undefined,
    init,
    comptime: true,
    exported: false,
    loc: declLoc,
  };
}

function desugarImportDecl(cursor: TreeCursor, source: string): CoreDecl {
  const declLoc = loc(cursor);
  let clause: CoreImportClause | undefined;
  let importSource = "";

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "import":
          break;
        case "ImportClause":
          clause = desugarImportClause(cursor, source);
          break;
        case "from":
          break;
        case "String":
          importSource = parseString(text(cursor, source));
          break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!clause) {
    error("import declaration missing clause", cursor);
  }

  return {
    kind: "import",
    clause,
    source: importSource,
    loc: declLoc,
  };
}

function desugarImportClause(cursor: TreeCursor, source: string): CoreImportClause {
  if (cursor.firstChild()) {
    const firstChildName = cursor.name;

    switch (firstChildName) {
      case "DefaultImport": {
        cursor.firstChild();
        const name = text(cursor, source);
        cursor.parent();
        cursor.parent();
        return { kind: "default", name };
      }
      case "NamedImports": {
        const specifiers = desugarImportSpecifiers(cursor, source);
        cursor.parent();
        return { kind: "named", specifiers };
      }
      case "NamespaceImport": {
        cursor.firstChild();
        // Skip "*" and "as"
        cursor.nextSibling();
        cursor.nextSibling();
        const name = text(cursor, source);
        cursor.parent();
        cursor.parent();
        return { kind: "namespace", name };
      }
      case "DefaultAndNamed": {
        let defaultName = "";
        let specifiers: CoreImportSpecifier[] = [];
        if (cursor.firstChild()) {
          do {
            if (cursor.name === "VariableName" && !defaultName) {
              defaultName = text(cursor, source);
            } else if (cursor.name === "ListOf") {
              specifiers = desugarImportSpecifierList(cursor, source);
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
        cursor.parent();
        return { kind: "defaultAndNamed", defaultName, specifiers };
      }
    }
    cursor.parent();
  }

  return { kind: "named", specifiers: [] };
}

function desugarImportSpecifiers(cursor: TreeCursor, source: string): CoreImportSpecifier[] {
  const specifiers: CoreImportSpecifier[] = [];
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "ListOf") {
        return desugarImportSpecifierList(cursor, source);
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }
  return specifiers;
}

function desugarImportSpecifierList(cursor: TreeCursor, source: string): CoreImportSpecifier[] {
  const specifiers: CoreImportSpecifier[] = [];
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "ImportSpecifier") {
        specifiers.push(desugarImportSpecifier(cursor, source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }
  return specifiers;
}

function desugarImportSpecifier(cursor: TreeCursor, source: string): CoreImportSpecifier {
  let name = "";
  let alias: string | undefined;

  if (cursor.firstChild()) {
    name = text(cursor, source);
    if (cursor.nextSibling() && cursor.name === "as") {
      cursor.nextSibling();
      alias = text(cursor, source);
    }
    cursor.parent();
  }

  return { name, alias };
}

function desugarExportDecl(cursor: TreeCursor, source: string): CoreDecl {
  if (cursor.firstChild()) {
    cursor.nextSibling(); // Skip "export"
    const decl = desugarStatement(cursor, source);
    cursor.parent();

    if (decl && decl.kind === "const") {
      return { ...decl, exported: true };
    }
    if (decl) return decl;
  }

  error("export declaration missing inner declaration", cursor);
}

function desugarExprStatement(cursor: TreeCursor, source: string): CoreDecl {
  const stmtLoc = loc(cursor);

  if (cursor.firstChild()) {
    const expr = desugarExpr(cursor, source);
    cursor.parent();
    return { kind: "expr", expr, loc: stmtLoc };
  }

  error("expression statement missing expression", cursor);
}

// ============================================
// Type Parameters
// ============================================

function desugarTypeParams(
  cursor: TreeCursor,
  source: string
): { name: string; constraint?: CoreExpr }[] {
  const params: { name: string; constraint?: CoreExpr }[] = [];

  if (cursor.firstChild()) {
    do {
      if (nodeName(cursor) === "ListOf1") {
        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "TypeParam") {
              params.push(desugarTypeParam(cursor, source));
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return params;
}

function desugarTypeParam(
  cursor: TreeCursor,
  source: string
): { name: string; constraint?: CoreExpr; defaultValue?: CoreExpr } {
  let name = "";
  let constraint: CoreExpr | undefined;
  let defaultValue: CoreExpr | undefined;
  let nextIsConstraint = false;
  let nextIsDefault = false;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Annotation":
          // TODO: Handle annotations on type params
          break;
        case "TypeName":
          name = text(cursor, source);
          break;
        case "extends":
          nextIsConstraint = true;
          break;
        case "=":
          nextIsDefault = true;
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            if (nextIsDefault) {
              defaultValue = desugarTypeExpr(cursor, source);
              nextIsDefault = false;
            } else if (nextIsConstraint) {
              constraint = desugarTypeExpr(cursor, source);
              nextIsConstraint = false;
            }
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { name, constraint, defaultValue };
}

// ============================================
// Expressions
// ============================================

function isExpression(name: string): boolean {
  return [
    "ArrowFn",
    "TernaryExpr",
    "BinaryExpr",
    "UnaryExpr",
    "AwaitExpr",
    "CallExpr",
    "TypeCallExpr",
    "MemberExpr",
    "IndexExpr",
    "VariableExpr",
    "TypeExpr",
    "Literal",
    "ArrayExpr",
    "RecordExpr",
    "MatchExpr",
    "ThrowExpr",
    "ParenExpr",
    "Block",
  ].includes(name);
}

function desugarExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);

  switch (cursor.name) {
    case "ArrowFn":
      return desugarArrowFn(cursor, source);

    case "TernaryExpr":
      return desugarTernaryExpr(cursor, source);

    case "BinaryExpr":
      return desugarBinaryExpr(cursor, source);

    case "UnaryExpr":
      return desugarUnaryExpr(cursor, source);

    case "AwaitExpr":
      return desugarAwaitExpr(cursor, source);

    case "CallExpr":
      return desugarCallExpr(cursor, source);

    case "TypeCallExpr":
      return desugarTypeCallExpr(cursor, source);

    case "MemberExpr":
      return desugarMemberExpr(cursor, source);

    case "IndexExpr":
      return desugarIndexExpr(cursor, source);

    case "VariableExpr":
      return desugarVariableExpr(cursor, source);

    case "TypeExpr":
      return desugarTypeExprAsExpr(cursor, source);

    case "Literal":
      return desugarLiteral(cursor, source);

    case "ArrayExpr":
      return desugarArrayExpr(cursor, source);

    case "RecordExpr":
      return desugarRecordExpr(cursor, source);

    case "MatchExpr":
      return desugarMatchExpr(cursor, source);

    case "ThrowExpr":
      return desugarThrowExpr(cursor, source);

    case "ParenExpr":
      return desugarParenExpr(cursor, source);

    case "Block":
      return desugarBlock(cursor, source);

    default:
      // Try to descend into child
      if (cursor.firstChild()) {
        const result = desugarExpr(cursor, source);
        cursor.parent();
        return result;
      }
      error(`Unknown expression type: ${cursor.name}`, cursor);
  }
}

function desugarArrowFn(cursor: TreeCursor, source: string): CoreExpr {
  const fnLoc = loc(cursor);
  let async = false;
  let params: CoreParam[] = [];
  let returnType: CoreExpr | undefined;
  let body: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "async":
          async = true;
          break;
        case "ArrowParams":
          ({ params, returnType } = desugarArrowParams(cursor, source));
          break;
        case "=>":
          break;
        case "ArrowBody":
          if (cursor.firstChild()) {
            body = nodeName(cursor) === "Block"
              ? desugarBlock(cursor, source)
              : desugarExpr(cursor, source);
            cursor.parent();
          }
          break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!body) {
    error("arrow function missing body", cursor);
  }

  return {
    kind: "lambda",
    params,
    body,
    returnType,
    async,
    loc: fnLoc,
  };
}

function desugarArrowParams(
  cursor: TreeCursor,
  source: string
): { params: CoreParam[]; returnType?: CoreExpr } {
  const params: CoreParam[] = [];
  let returnType: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "VariableName":
        case "TypeName":
          // Simple param: x => ...
          params.push({ name: text(cursor, source), annotations: [] });
          break;
        case "(":
        case ")":
          break;
        case "ListOf":
          if (cursor.firstChild()) {
            do {
              if (nodeName(cursor) === "ArrowParam") {
                params.push(desugarArrowParam(cursor, source));
              }
            } while (cursor.nextSibling());
            cursor.parent();
          }
          break;
        case "TypeAnnotation":
          returnType = desugarTypeAnnotation(cursor, source);
          break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { params, returnType };
}

function desugarArrowParam(cursor: TreeCursor, source: string): CoreParam {
  let name = "";
  let type: CoreExpr | undefined;
  let defaultValue: CoreExpr | undefined;
  let rest = false;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Spread":
          rest = true;
          break;
        case "VariableName":
        case "TypeName":
          name = text(cursor, source);
          break;
        case "TypeAnnotation":
          type = desugarTypeAnnotation(cursor, source);
          break;
        case "DefaultValue":
          if (cursor.firstChild()) {
            cursor.nextSibling(); // Skip "="
            defaultValue = desugarExpr(cursor, source);
            cursor.parent();
          }
          break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { name, type, defaultValue, annotations: [], rest: rest || undefined };
}

function desugarTernaryExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let condition: CoreExpr | undefined;
  let thenExpr: CoreExpr | undefined;
  let elseExpr: CoreExpr | undefined;

  if (cursor.firstChild()) {
    condition = desugarExpr(cursor, source);
    cursor.nextSibling(); // Skip "?"
    cursor.nextSibling();
    thenExpr = desugarExpr(cursor, source);
    cursor.nextSibling(); // Skip ":"
    cursor.nextSibling();
    elseExpr = desugarExpr(cursor, source);
    cursor.parent();
  }

  if (!condition || !thenExpr || !elseExpr) {
    error("malformed ternary expression", cursor);
  }

  return {
    kind: "conditional",
    condition,
    then: thenExpr,
    else: elseExpr,
    loc: exprLoc,
  };
}

function desugarBinaryExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let left: CoreExpr | undefined;
  let op: BinaryOp | undefined;
  let right: CoreExpr | undefined;

  if (cursor.firstChild()) {
    left = desugarExpr(cursor, source);
    cursor.nextSibling();
    op = text(cursor, source) as BinaryOp;
    cursor.nextSibling();
    right = desugarExpr(cursor, source);
    cursor.parent();
  }

  if (!left || !op || !right) {
    error("malformed binary expression", cursor);
  }

  return { kind: "binary", op, left, right, loc: exprLoc };
}

function desugarUnaryExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let op: UnaryOp | undefined;
  let operand: CoreExpr | undefined;

  if (cursor.firstChild()) {
    op = text(cursor, source) as UnaryOp;
    cursor.nextSibling();
    operand = desugarExpr(cursor, source);
    cursor.parent();
  }

  if (!op || !operand) {
    error("malformed unary expression", cursor);
  }

  return { kind: "unary", op, operand, loc: exprLoc };
}

function desugarAwaitExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let expr: CoreExpr | undefined;

  if (cursor.firstChild()) {
    cursor.nextSibling(); // Skip "await"
    expr = desugarExpr(cursor, source);
    cursor.parent();
  }

  if (!expr) {
    error("await expression missing operand", cursor);
  }

  return { kind: "await", expr, loc: exprLoc };
}

function desugarCallExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let fn: CoreExpr | undefined;
  const args: CoreExpr[] = [];

  if (cursor.firstChild()) {
    fn = desugarExpr(cursor, source);
    while (cursor.nextSibling()) {
      if (nodeName(cursor) === "ListOf") {
        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "Argument") {
              args.push(desugarArgument(cursor, source));
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    }
    cursor.parent();
  }

  if (!fn) {
    error("call expression missing function", cursor);
  }

  return { kind: "call", fn, args, loc: exprLoc };
}

function desugarArgument(cursor: TreeCursor, source: string): CoreExpr {
  if (cursor.firstChild()) {
    let isSpread = false;
    if (nodeName(cursor) === "Spread") {
      isSpread = true;
      cursor.nextSibling();
    }
    const expr = desugarExpr(cursor, source);
    cursor.parent();

    // TODO: Handle spread arguments properly
    return expr;
  }
  error("argument missing expression", cursor);
}

function desugarTypeCallExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let fn: CoreExpr | undefined;
  const typeArgs: CoreExpr[] = [];
  const args: CoreExpr[] = [];

  if (cursor.firstChild()) {
    fn = desugarExpr(cursor, source);
    while (cursor.nextSibling()) {
      switch (nodeName(cursor)) {
        case "ListOf1":
          // Type arguments
          if (cursor.firstChild()) {
            do {
              if (isTypeExpression(nodeName(cursor))) {
                typeArgs.push(desugarTypeExpr(cursor, source));
              }
            } while (cursor.nextSibling());
            cursor.parent();
          }
          break;
        case "ListOf":
          // Value arguments
          if (cursor.firstChild()) {
            do {
              if (nodeName(cursor) === "Argument") {
                args.push(desugarArgument(cursor, source));
              }
            } while (cursor.nextSibling());
            cursor.parent();
          }
          break;
      }
    }
    cursor.parent();
  }

  if (!fn) {
    error("type call expression missing function", cursor);
  }

  // Type args are passed as first arguments
  return { kind: "call", fn, args: [...typeArgs, ...args], loc: exprLoc };
}

function desugarMemberExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let object: CoreExpr | undefined;
  let propName = "";

  if (cursor.firstChild()) {
    object = desugarExpr(cursor, source);
    while (cursor.nextSibling()) {
      if (cursor.name === "PropertyName") {
        if (cursor.firstChild()) {
          propName = text(cursor, source);
          cursor.parent();
        }
      }
    }
    cursor.parent();
  }

  if (!object) {
    error("member expression missing object", cursor);
  }

  return { kind: "property", object, name: propName, loc: exprLoc };
}

function desugarIndexExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let object: CoreExpr | undefined;
  let index: CoreExpr | undefined;

  if (cursor.firstChild()) {
    object = desugarExpr(cursor, source);
    while (cursor.nextSibling()) {
      if (isExpression(cursor.name)) {
        index = desugarExpr(cursor, source);
      }
    }
    cursor.parent();
  }

  if (!object || !index) {
    error("index expression missing operands", cursor);
  }

  return { kind: "index", object, index, loc: exprLoc };
}

function desugarVariableExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let name = "";

  if (cursor.firstChild()) {
    name = text(cursor, source);
    cursor.parent();
  }

  return { kind: "identifier", name, loc: exprLoc };
}

function desugarTypeExprAsExpr(cursor: TreeCursor, source: string): CoreExpr {
  const exprLoc = loc(cursor);
  let name = "";

  if (cursor.firstChild()) {
    name = text(cursor, source);
    cursor.parent();
  }

  return { kind: "identifier", name, loc: exprLoc };
}

function desugarLiteral(cursor: TreeCursor, source: string): CoreExpr {
  const litLoc = loc(cursor);

  if (cursor.firstChild()) {
    const result = desugarLiteralInner(cursor, source, litLoc);
    cursor.parent();
    return result;
  }

  error("empty literal", cursor);
}

function desugarLiteralInner(
  cursor: TreeCursor,
  source: string,
  litLoc: SourceLocation
): CoreExpr {
  switch (cursor.name) {
    case "String": {
      const value = parseString(text(cursor, source));
      return { kind: "literal", value, literalKind: "string", loc: litLoc };
    }
    case "Number": {
      const numText = text(cursor, source);
      const isFloat = numText.includes(".") || numText.includes("e") || numText.includes("E");
      const value = isFloat ? parseFloat(numText) : parseInt(numText);
      return {
        kind: "literal",
        value,
        literalKind: isFloat ? "float" : "int",
        loc: litLoc,
      };
    }
    case "BooleanLiteral": {
      if (cursor.firstChild()) {
        const value = nodeName(cursor) === "true";
        cursor.parent();
        return { kind: "literal", value, literalKind: "boolean", loc: litLoc };
      }
      return { kind: "literal", value: true, literalKind: "boolean", loc: litLoc };
    }
    case "NullLiteral":
      return { kind: "literal", value: null, literalKind: "null", loc: litLoc };
    case "UndefinedLiteral":
      return { kind: "literal", value: undefined, literalKind: "undefined", loc: litLoc };
    case "true":
      return { kind: "literal", value: true, literalKind: "boolean", loc: litLoc };
    case "false":
      return { kind: "literal", value: false, literalKind: "boolean", loc: litLoc };
    case "null":
      return { kind: "literal", value: null, literalKind: "null", loc: litLoc };
    case "undefined":
      return { kind: "literal", value: undefined, literalKind: "undefined", loc: litLoc };
    default:
      error(`Unknown literal type: ${cursor.name}`, cursor);
  }
}

function parseString(str: string): string {
  // Remove quotes
  const inner = str.slice(1, -1);
  // Handle escape sequences
  return inner.replace(/\\(.)/g, (_, char) => {
    switch (char) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return char;
    }
  });
}

function desugarArrayExpr(cursor: TreeCursor, source: string): CoreExpr {
  const arrLoc = loc(cursor);
  const elements: CoreArrayElement[] = [];

  if (cursor.firstChild()) {
    do {
      if (nodeName(cursor) === "ListOf") {
        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "ArrayElement") {
              elements.push(desugarArrayElement(cursor, source));
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { kind: "array", elements, loc: arrLoc };
}

function desugarArrayElement(cursor: TreeCursor, source: string): CoreArrayElement {
  if (cursor.firstChild()) {
    let isSpread = false;
    if (nodeName(cursor) === "Spread") {
      isSpread = true;
      cursor.nextSibling();
    }
    const expr = desugarExpr(cursor, source);
    cursor.parent();

    return isSpread ? { kind: "spread", expr } : { kind: "element", value: expr };
  }
  error("array element missing expression", cursor);
}

function desugarRecordExpr(cursor: TreeCursor, source: string): CoreExpr {
  const recLoc = loc(cursor);
  const fields: CoreRecordField[] = [];

  if (cursor.firstChild()) {
    do {
      if (nodeName(cursor) === "ListOf") {
        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "RecordField") {
              fields.push(desugarRecordField(cursor, source));
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { kind: "record", fields, loc: recLoc };
}

function desugarRecordField(cursor: TreeCursor, source: string): CoreRecordField {
  if (cursor.firstChild()) {
    switch (nodeName(cursor)) {
      case "SpreadField": {
        cursor.firstChild(); // Enter SpreadField
        cursor.nextSibling(); // Skip "..."
        const expr = desugarExpr(cursor, source);
        cursor.parent();
        cursor.parent();
        return { kind: "spread", expr };
      }
      case "FieldDef": {
        let name = "";
        let value: CoreExpr | undefined;
        const fieldLoc = loc(cursor);

        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "PropertyName") {
              if (cursor.firstChild()) {
                name = text(cursor, source);
                cursor.parent();
              }
            } else if (nodeName(cursor) === ":") {
              cursor.nextSibling();
              value = desugarExpr(cursor, source);
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }

        // Shorthand: { x } means { x: x }
        if (!value) {
          value = { kind: "identifier", name, loc: fieldLoc };
        }

        cursor.parent();
        return { kind: "field", name, value };
      }
    }
    cursor.parent();
  }
  error("malformed record field", cursor);
}

function desugarMatchExpr(cursor: TreeCursor, source: string): CoreExpr {
  const matchLoc = loc(cursor);
  let expr: CoreExpr | undefined;
  const cases: CoreCase[] = [];

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "match":
        case "(":
        case ")":
        case "{":
        case "}":
          break;
        case "MatchCase":
          cases.push(desugarMatchCase(cursor, source));
          break;
        default:
          if (isExpression(cursor.name)) {
            expr = desugarExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!expr) {
    error("match expression missing subject", cursor);
  }

  return { kind: "match", expr, cases, loc: matchLoc };
}

function desugarMatchCase(cursor: TreeCursor, source: string): CoreCase {
  const caseLoc = loc(cursor);
  let pattern: CorePattern | undefined;
  let guard: CoreExpr | undefined;
  let body: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "case":
        case ":":
        case ";":
          break;
        case "Pattern":
          pattern = desugarPattern(cursor, source);
          break;
        case "Guard":
          if (cursor.firstChild()) {
            cursor.nextSibling(); // Skip "when"
            guard = desugarExpr(cursor, source);
            cursor.parent();
          }
          break;
        default:
          if (isExpression(cursor.name)) {
            body = desugarExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!pattern || !body) {
    error("match case missing pattern or body", cursor);
  }

  return { pattern, guard, body, loc: caseLoc };
}

function desugarPattern(cursor: TreeCursor, source: string): CorePattern {
  const patLoc = loc(cursor);

  if (cursor.firstChild()) {
    const result = desugarPatternInner(cursor, source, patLoc);
    cursor.parent();
    return result;
  }

  error("empty pattern", cursor);
}

function desugarPatternInner(
  cursor: TreeCursor,
  source: string,
  patLoc: SourceLocation
): CorePattern {
  switch (cursor.name) {
    case "WildcardPattern":
      return { kind: "wildcard", loc: patLoc };

    case "LiteralPattern": {
      if (cursor.firstChild()) {
        const litExpr = desugarLiteral(cursor, source);
        cursor.parent();
        if (litExpr.kind === "literal") {
          return {
            kind: "literal",
            value: litExpr.value,
            literalKind: litExpr.literalKind,
            loc: patLoc,
          };
        }
      }
      error("invalid literal pattern", cursor);
    }

    case "TypePattern": {
      if (cursor.firstChild()) {
        const name = text(cursor, source);
        cursor.parent();
        return {
          kind: "type",
          typeExpr: { kind: "identifier", name, loc: patLoc },
          loc: patLoc,
        };
      }
      error("invalid type pattern", cursor);
    }

    case "DestructurePattern": {
      const fields: CorePatternField[] = [];
      if (cursor.firstChild()) {
        do {
          if (nodeName(cursor) === "ListOf") {
            if (cursor.firstChild()) {
              do {
                if (nodeName(cursor) === "PatternField") {
                  fields.push(desugarPatternField(cursor, source));
                }
              } while (cursor.nextSibling());
              cursor.parent();
            }
          }
        } while (cursor.nextSibling());
        cursor.parent();
      }
      return { kind: "destructure", fields, loc: patLoc };
    }

    case "BindingPattern": {
      if (cursor.firstChild()) {
        const name = text(cursor, source);
        cursor.parent();
        return { kind: "binding", name, loc: patLoc };
      }
      error("invalid binding pattern", cursor);
    }

    default:
      error(`Unknown pattern type: ${cursor.name}`, cursor);
  }
}

function desugarPatternField(cursor: TreeCursor, source: string): CorePatternField {
  let name = "";
  let pattern: CorePattern | undefined;

  if (cursor.firstChild()) {
    do {
      if (cursor.name === "PropertyName") {
        if (cursor.firstChild()) {
          name = text(cursor, source);
          cursor.parent();
        }
      } else if (cursor.name === "Pattern") {
        pattern = desugarPattern(cursor, source);
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { name, pattern };
}

function desugarThrowExpr(cursor: TreeCursor, source: string): CoreExpr {
  const throwLoc = loc(cursor);
  let expr: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      if (cursor.name !== "throw" && isExpression(cursor.name)) {
        expr = desugarExpr(cursor, source);
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!expr) {
    error("throw expression missing operand", cursor);
  }

  return { kind: "throw", expr, loc: throwLoc };
}

function desugarParenExpr(cursor: TreeCursor, source: string): CoreExpr {
  if (cursor.firstChild()) {
    do {
      if (isExpression(cursor.name)) {
        const result = desugarExpr(cursor, source);
        cursor.parent();
        return result;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }
  error("empty parenthesized expression", cursor);
}

function desugarBlock(cursor: TreeCursor, source: string): CoreExpr {
  const blockLoc = loc(cursor);
  const statements: CoreDecl[] = [];
  let result: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      if (cursor.name === "BlockContent") {
        if (cursor.firstChild()) {
          do {
            const stmt = desugarStatement(cursor, source);
            if (stmt) {
              statements.push(stmt);
            } else if (isExpression(cursor.name)) {
              result = desugarExpr(cursor, source);
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  return { kind: "block", statements, result, loc: blockLoc };
}

// ============================================
// Type Expressions
// ============================================

function isTypeExpression(name: string): boolean {
  return [
    "UnionType",
    "IntersectionType",
    "NamedType",
    "RecordType",
    "ClosedRecordType",
    "IndexedRecordType",
    "TupleType",
    "FunctionType",
    "ParenType",
    "LiteralType",
  ].includes(name);
}

function desugarTypeAnnotation(cursor: TreeCursor, source: string): CoreExpr {
  if (cursor.firstChild()) {
    cursor.nextSibling(); // Skip ":"
    const result = desugarTypeExpr(cursor, source);
    cursor.parent();
    return result;
  }
  error("empty type annotation", cursor);
}

function desugarTypeExpr(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);

  switch (cursor.name) {
    case "UnionType":
      return desugarUnionType(cursor, source);

    case "IntersectionType":
      return desugarIntersectionType(cursor, source);

    case "NamedType":
      return desugarNamedType(cursor, source);

    case "RecordType":
      return desugarRecordType(cursor, source, false);

    case "ClosedRecordType":
      return desugarRecordType(cursor, source, true);

    case "IndexedRecordType":
      return desugarIndexedRecordType(cursor, source);

    case "TupleType":
      return desugarTupleType(cursor, source);

    case "FunctionType":
      return desugarFunctionType(cursor, source);

    case "ParenType":
      return desugarParenType(cursor, source);

    case "LiteralType":
      return desugarLiteralType(cursor, source);

    default:
      // Try descending into child
      if (cursor.firstChild()) {
        const result = desugarTypeExpr(cursor, source);
        cursor.parent();
        return result;
      }
      error(`Unknown type expression: ${cursor.name}`, cursor);
  }
}

function desugarUnionType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  const types: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (isTypeExpression(cursor.name)) {
        types.push(desugarTypeExpr(cursor, source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // A | B | C → Union(Union(A, B), C)
  return types.reduce((left, right) => ({
    kind: "call",
    fn: { kind: "identifier", name: "Union", loc: typeLoc },
    args: [left, right],
    loc: typeLoc,
  }));
}

function desugarIntersectionType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  const types: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (isTypeExpression(cursor.name)) {
        types.push(desugarTypeExpr(cursor, source));
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // A & B & C → Intersection(Intersection(A, B), C)
  return types.reduce((left, right) => ({
    kind: "call",
    fn: { kind: "identifier", name: "Intersection", loc: typeLoc },
    args: [left, right],
    loc: typeLoc,
  }));
}

function desugarNamedType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  let name = "";
  const typeArgs: CoreExpr[] = [];
  let arraySuffixCount = 0;

  if (cursor.firstChild()) {
    do {
      switch (nodeName(cursor)) {
        case "TypeName":
          name = text(cursor, source);
          break;
        case "TypeArgs":
          if (cursor.firstChild()) {
            do {
              if (nodeName(cursor) === "ListOf1") {
                if (cursor.firstChild()) {
                  do {
                    if (isTypeExpression(nodeName(cursor))) {
                      typeArgs.push(desugarTypeExpr(cursor, source));
                    }
                  } while (cursor.nextSibling());
                  cursor.parent();
                }
              }
            } while (cursor.nextSibling());
            cursor.parent();
          }
          break;
        case "ArraySuffix":
          arraySuffixCount++;
          break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  let result: CoreExpr = { kind: "identifier", name, loc: typeLoc };

  // Apply type arguments
  if (typeArgs.length > 0) {
    result = { kind: "call", fn: result, args: typeArgs, loc: typeLoc };
  }

  // Apply array suffixes: T[][] → Array(Array(T))
  for (let i = 0; i < arraySuffixCount; i++) {
    result = {
      kind: "call",
      fn: { kind: "identifier", name: "Array", loc: typeLoc },
      args: [result],
      loc: typeLoc,
    };
  }

  return result;
}

function desugarRecordType(
  cursor: TreeCursor,
  source: string,
  closed: boolean
): CoreExpr {
  const typeLoc = loc(cursor);
  const fields: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (nodeName(cursor) === "ListOf") {
        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "TypeField") {
              fields.push(desugarTypeField(cursor, source));
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  const args: CoreExpr[] = [
    { kind: "array", elements: fields.map((f) => ({ kind: "element" as const, value: f })), loc: typeLoc },
  ];

  if (closed) {
    args.push({ kind: "identifier", name: "Never", loc: typeLoc });
  }

  return {
    kind: "call",
    fn: { kind: "identifier", name: "RecordType", loc: typeLoc },
    args,
    loc: typeLoc,
  };
}

function desugarTypeField(cursor: TreeCursor, source: string): CoreExpr {
  const fieldLoc = loc(cursor);
  let name = "";
  let optional = false;
  let type: CoreExpr | undefined;
  const annotations: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Annotation":
          annotations.push(desugarAnnotation(cursor, source));
          break;
        case "PropertyName":
          if (cursor.firstChild()) {
            name = text(cursor, source);
            cursor.parent();
          }
          break;
        case "Optional":
          optional = true;
          break;
        case ":":
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            type = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!type) {
    error("type field missing type", cursor);
  }

  // Build FieldInfo record
  const fields: CoreRecordField[] = [
    {
      kind: "field",
      name: "name",
      value: { kind: "literal", value: name, literalKind: "string", loc: fieldLoc },
    },
    { kind: "field", name: "type", value: type },
    {
      kind: "field",
      name: "optional",
      value: { kind: "literal", value: optional, literalKind: "boolean", loc: fieldLoc },
    },
    {
      kind: "field",
      name: "annotations",
      value: {
        kind: "array",
        elements: annotations.map((a) => ({ kind: "element" as const, value: a })),
        loc: fieldLoc,
      },
    },
  ];

  return { kind: "record", fields, loc: fieldLoc };
}

function desugarIndexedRecordType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  let keyType: CoreExpr | undefined;
  let valueType: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      if (cursor.name === "IndexSignature") {
        if (cursor.firstChild()) {
          do {
            if (isTypeExpression(cursor.name)) {
              if (!keyType) {
                keyType = desugarTypeExpr(cursor, source);
              } else {
                valueType = desugarTypeExpr(cursor, source);
              }
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!valueType) {
    error("indexed record type missing value type", cursor);
  }

  // { [key: K]: V } → RecordType([], V)
  return {
    kind: "call",
    fn: { kind: "identifier", name: "RecordType", loc: typeLoc },
    args: [
      { kind: "array", elements: [], loc: typeLoc },
      valueType,
    ],
    loc: typeLoc,
  };
}

function desugarTupleType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  const elements: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      if (nodeName(cursor) === "ListOf") {
        if (cursor.firstChild()) {
          do {
            if (nodeName(cursor) === "TupleElement") {
              elements.push(desugarTupleElement(cursor, source));
            }
          } while (cursor.nextSibling());
          cursor.parent();
        }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  // [A, B, C] → Array(A, B, C)
  return {
    kind: "call",
    fn: { kind: "identifier", name: "Array", loc: typeLoc },
    args: elements,
    loc: typeLoc,
  };
}

function desugarTupleElement(cursor: TreeCursor, source: string): CoreExpr {
  let isSpread = false;
  let type: CoreExpr | undefined;

  if (cursor.firstChild()) {
    do {
      if (nodeName(cursor) === "Spread") {
        isSpread = true;
      } else if (isTypeExpression(nodeName(cursor))) {
        type = desugarTypeExpr(cursor, source);
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!type) {
    error("tuple element missing type", cursor);
  }

  // TODO: Handle spread and labels properly
  return type;
}

function desugarFunctionType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  const params: CoreExpr[] = [];
  let returnType: CoreExpr | undefined;
  let typeParams: { name: string; constraint?: CoreExpr }[] = [];

  if (cursor.firstChild()) {
    do {
      switch (nodeName(cursor)) {
        case "TypeParams":
          typeParams = desugarTypeParams(cursor, source);
          break;
        case "ListOf":
          if (cursor.firstChild()) {
            do {
              if (nodeName(cursor) === "FuncParam") {
                params.push(desugarFuncParam(cursor, source));
              }
            } while (cursor.nextSibling());
            cursor.parent();
          }
          break;
        case "=>":
          break;
        default:
          if (isTypeExpression(nodeName(cursor))) {
            returnType = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!returnType) {
    error("function type missing return type", cursor);
  }

  // (A, B) => C → FunctionType([A, B], C)
  const functionTypeCall: CoreExpr = {
    kind: "call",
    fn: { kind: "identifier", name: "FunctionType", loc: typeLoc },
    args: [
      { kind: "array", elements: params.map((p) => ({ kind: "element" as const, value: p })), loc: typeLoc },
      returnType,
    ],
    loc: typeLoc,
  };

  // If there are type params, wrap in lambda: <T>(x: T) => R → (T: Type) => FunctionType([...], R)
  if (typeParams.length > 0) {
    const lambdaParams: CoreParam[] = typeParams.map((tp) => ({
      name: tp.name,
      type: tp.constraint
        ? {
            kind: "call" as const,
            fn: { kind: "identifier" as const, name: "Type", loc: typeLoc },
            args: [tp.constraint],
            loc: typeLoc,
          }
        : { kind: "identifier" as const, name: "Type", loc: typeLoc },
      annotations: [],
    }));

    return {
      kind: "lambda",
      params: lambdaParams,
      body: functionTypeCall,
      async: false,
      loc: typeLoc,
    };
  }

  return functionTypeCall;
}

function desugarFuncParam(cursor: TreeCursor, source: string): CoreExpr {
  const paramLoc = loc(cursor);
  let name = "";
  let type: CoreExpr | undefined;
  let optional = false;
  let rest = false;
  const annotations: CoreExpr[] = [];

  if (cursor.firstChild()) {
    do {
      switch (cursor.name) {
        case "Annotation":
          annotations.push(desugarAnnotation(cursor, source));
          break;
        case "Spread":
          rest = true;
          break;
        case "VariableName":
          name = text(cursor, source);
          break;
        case "Optional":
          optional = true;
          break;
        default:
          if (isTypeExpression(cursor.name)) {
            type = desugarTypeExpr(cursor, source);
          }
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!type) {
    error("function param missing type", cursor);
  }

  // Build ParamInfo record: { name, type, optional, rest, annotations }
  const fields: CoreRecordField[] = [
    {
      kind: "field",
      name: "name",
      value: { kind: "literal", value: name, literalKind: "string", loc: paramLoc },
    },
    { kind: "field", name: "type", value: type },
    {
      kind: "field",
      name: "optional",
      value: { kind: "literal", value: optional, literalKind: "boolean", loc: paramLoc },
    },
    {
      kind: "field",
      name: "rest",
      value: { kind: "literal", value: rest, literalKind: "boolean", loc: paramLoc },
    },
    {
      kind: "field",
      name: "annotations",
      value: {
        kind: "array",
        elements: annotations.map((a) => ({ kind: "element" as const, value: a })),
        loc: paramLoc,
      },
    },
  ];

  return { kind: "record", fields, loc: paramLoc };
}

function desugarParenType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);
  let innerType: CoreExpr | undefined;
  let arraySuffixCount = 0;

  if (cursor.firstChild()) {
    do {
      if (isTypeExpression(cursor.name)) {
        innerType = desugarTypeExpr(cursor, source);
      } else if (cursor.name === "ArraySuffix") {
        arraySuffixCount++;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (!innerType) {
    error("empty parenthesized type", cursor);
  }

  // Apply array suffixes: (T)[][] → Array(Array(T))
  let result = innerType;
  for (let i = 0; i < arraySuffixCount; i++) {
    result = {
      kind: "call",
      fn: { kind: "identifier", name: "Array", loc: typeLoc },
      args: [result],
      loc: typeLoc,
    };
  }

  return result;
}

function desugarLiteralType(cursor: TreeCursor, source: string): CoreExpr {
  const typeLoc = loc(cursor);

  if (cursor.firstChild()) {
    const literalExpr = desugarLiteralInner(cursor, source, typeLoc);
    cursor.parent();

    // Wrap the literal in a call to LiteralType() to convert value to type
    return {
      kind: "call",
      fn: { kind: "identifier", name: "LiteralType", loc: typeLoc },
      args: [literalExpr],
      loc: typeLoc,
    };
  }

  error("empty literal type", cursor);
}

function desugarAnnotation(cursor: TreeCursor, source: string): CoreExpr {
  if (cursor.firstChild()) {
    cursor.nextSibling(); // Skip "@"
    const result = desugarExpr(cursor, source);
    cursor.parent();
    return result;
  }
  error("empty annotation", cursor);
}
