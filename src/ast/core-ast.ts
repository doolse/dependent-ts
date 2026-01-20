/**
 * CoreAST - the desugared AST representation.
 *
 * All type syntax has been transformed into function calls.
 * No separate "type expressions" - types are just expressions evaluating to Type values.
 */

import { Type } from "../types/types";

// ============================================
// Source Locations
// ============================================

export type SourceLocation = {
  from: number; // Start offset in source
  to: number; // End offset in source
};

export type Located<T> = T & { loc: SourceLocation };

// ============================================
// Expressions
// ============================================

export type CoreExpr = Located<CoreExprBase>;

export type CoreExprBase =
  | { kind: "identifier"; name: string }
  | { kind: "literal"; value: LiteralValue; literalKind: LiteralKind }
  | { kind: "binary"; op: BinaryOp; left: CoreExpr; right: CoreExpr }
  | { kind: "unary"; op: UnaryOp; operand: CoreExpr }
  | { kind: "call"; fn: CoreExpr; args: CoreArgument[] }
  | { kind: "property"; object: CoreExpr; name: string }
  | { kind: "index"; object: CoreExpr; index: CoreExpr }
  | {
      kind: "lambda";
      params: CoreParam[];
      body: CoreExpr;
      returnType?: CoreExpr;
      async: boolean;
    }
  | { kind: "match"; expr: CoreExpr; cases: CoreCase[] }
  | {
      kind: "conditional";
      condition: CoreExpr;
      then: CoreExpr;
      else: CoreExpr;
    }
  | { kind: "record"; fields: CoreRecordField[] }
  | { kind: "array"; elements: CoreArrayElement[] }
  | { kind: "await"; expr: CoreExpr }
  | { kind: "throw"; expr: CoreExpr }
  | { kind: "template"; parts: CoreTemplatePart[] }
  | { kind: "block"; statements: CoreDecl[]; result?: CoreExpr };

export type LiteralValue = string | number | boolean | null | undefined;

export type LiteralKind =
  | "int"
  | "float"
  | "string"
  | "boolean"
  | "null"
  | "undefined";

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "&&"
  | "||"
  | "|"
  | "&"
  | "^";

export type UnaryOp = "!" | "-" | "~";

export type CoreParam = {
  name: string;
  type?: CoreExpr; // Type annotation (desugared to expression)
  defaultValue?: CoreExpr;
  annotations: CoreExpr[];
  rest?: boolean; // True if this is a rest parameter (...param)
};

export type CoreCase = {
  pattern: CorePattern;
  guard?: CoreExpr;
  body: CoreExpr;
  loc: SourceLocation;
};

export type CoreRecordField =
  | { kind: "field"; name: string; value: CoreExpr }
  | { kind: "spread"; expr: CoreExpr };

export type CoreArrayElement =
  | { kind: "element"; value: CoreExpr }
  | { kind: "spread"; expr: CoreExpr };

export type CoreArgument =
  | { kind: "element"; value: CoreExpr }
  | { kind: "spread"; expr: CoreExpr };

export type CoreTemplatePart =
  | { kind: "string"; value: string }
  | { kind: "expr"; expr: CoreExpr };

// ============================================
// Patterns
// ============================================

export type CorePattern = Located<CorePatternBase>;

export type CorePatternBase =
  | { kind: "wildcard" }
  | { kind: "literal"; value: LiteralValue; literalKind: LiteralKind }
  | { kind: "type"; typeExpr: CoreExpr } // Type pattern - expression evaluating to Type
  | { kind: "binding"; name: string; pattern?: CorePattern }
  | { kind: "destructure"; fields: CorePatternField[] };

export type CorePatternField = {
  name: string; // Field name to match
  binding?: string; // Variable to bind to (defaults to name)
  pattern?: CorePattern; // Nested pattern
};

// ============================================
// Declarations
// ============================================

export type CoreDecl = Located<CoreDeclBase>;

export type CoreDeclBase =
  | {
      kind: "const";
      name: string;
      type?: CoreExpr;
      init: CoreExpr;
      comptime: boolean;
      exported: boolean;
    }
  | { kind: "import"; clause: CoreImportClause; source: string }
  | { kind: "expr"; expr: CoreExpr }; // Expression statement (for effects like assert)

export type CoreImportClause =
  | { kind: "default"; name: string }
  | { kind: "named"; specifiers: CoreImportSpecifier[] }
  | { kind: "namespace"; name: string }
  | {
      kind: "defaultAndNamed";
      defaultName: string;
      specifiers: CoreImportSpecifier[];
    };

export type CoreImportSpecifier = {
  name: string;
  alias?: string;
};

// ============================================
// Typed AST (output of type checking)
// ============================================

export type TypedArgument =
  | { kind: "element"; value: TypedExpr }
  | { kind: "spread"; expr: TypedExpr };

// Note: For call expressions, args is TypedArgument[] at runtime, but TypeScript
// inherits CoreExpr's args: CoreArgument[]. The type checker uses casts to work around this.
export type TypedExpr = CoreExpr & {
  type: Type;
  comptimeValue?: unknown; // If expression was evaluated at comptime
  comptimeOnly: boolean; // Cannot exist at runtime
};

/**
 * Typed declaration base - like CoreDeclBase but with TypedExpr
 * for expression fields.
 */
export type TypedDeclBase =
  | {
      kind: "const";
      name: string;
      type?: CoreExpr;
      init: TypedExpr;
      comptime: boolean;
      exported: boolean;
    }
  | { kind: "import"; clause: CoreImportClause; source: string }
  | { kind: "expr"; expr: TypedExpr };

export type TypedDecl = Located<TypedDeclBase> & {
  declType: Type;
  comptimeOnly: boolean;
};

export type TypedProgram = {
  decls: TypedDecl[];
};

// ============================================
// Compiler Errors
// ============================================

export type CompileErrorStage =
  | "parse"
  | "desugar"
  | "typecheck"
  | "erasure"
  | "codegen";

export class CompileError extends Error {
  stage: CompileErrorStage;
  loc?: SourceLocation;
  notes: CompilerNote[];

  constructor(
    message: string,
    stage: CompileErrorStage = "typecheck",
    loc?: SourceLocation
  ) {
    super(message);
    this.name = "CompileError";
    this.stage = stage;
    this.loc = loc;
    this.notes = [];
  }

  addNote(message: string, loc?: SourceLocation): this {
    this.notes.push({ message, loc });
    return this;
  }
}

export type CompilerNote = {
  message: string;
  loc?: SourceLocation;
};

// ============================================
// Helper functions
// ============================================

export function located<T>(base: T, loc: SourceLocation): Located<T> {
  return { ...base, loc };
}

export function dummyLoc(): SourceLocation {
  return { from: 0, to: 0 };
}
