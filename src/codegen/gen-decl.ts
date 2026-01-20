/**
 * Declaration code generation.
 *
 * Transforms CoreDecl nodes to JavaScript code strings.
 */

import {
  CoreDecl,
  CoreImportClause,
  CoreImportSpecifier,
} from "../ast/core-ast";
import { CodeBuilder } from "./code-builder";
import { PREC } from "./precedence";
import { genExpr, GenExprContext } from "./gen-expr";

/**
 * Generate JavaScript code for a declaration.
 * Returns the generated code as a string.
 */
export function genDecl(decl: CoreDecl, ctx: GenExprContext): string {
  switch (decl.kind) {
    case "const":
      return genConstDecl(
        decl.name,
        decl.init,
        decl.exported,
        ctx
      );

    case "import":
      return genImportDecl(decl.clause, decl.source);

    case "expr":
      return genExprStmt(decl.expr, ctx);

    default: {
      const _exhaustive: never = decl;
      throw new Error(`Unknown declaration kind: ${(decl as any).kind}`);
    }
  }
}

// ============================================
// Const Declarations
// ============================================

function genConstDecl(
  name: string,
  init: any, // CoreExpr
  exported: boolean,
  ctx: GenExprContext
): string {
  const exportPrefix = exported ? "export " : "";
  const initCode = genExpr(init, { ...ctx, parentPrecedence: PREC.ASSIGNMENT });
  return `${exportPrefix}const ${name} = ${initCode};\n`;
}

// ============================================
// Import Declarations
// ============================================

function genImportDecl(clause: CoreImportClause, source: string): string {
  const sourceStr = JSON.stringify(source);

  switch (clause.kind) {
    case "default":
      return `import ${clause.name} from ${sourceStr};\n`;

    case "named":
      return genNamedImport(clause.specifiers, sourceStr);

    case "namespace":
      return `import * as ${clause.name} from ${sourceStr};\n`;

    case "defaultAndNamed":
      return genDefaultAndNamedImport(
        clause.defaultName,
        clause.specifiers,
        sourceStr
      );

    default: {
      const _exhaustive: never = clause;
      throw new Error(`Unknown import clause kind: ${(clause as any).kind}`);
    }
  }
}

function genNamedImport(
  specifiers: CoreImportSpecifier[],
  sourceStr: string
): string {
  const specs = specifiers.map(genImportSpecifier).join(", ");
  return `import { ${specs} } from ${sourceStr};\n`;
}

function genDefaultAndNamedImport(
  defaultName: string,
  specifiers: CoreImportSpecifier[],
  sourceStr: string
): string {
  const specs = specifiers.map(genImportSpecifier).join(", ");
  return `import ${defaultName}, { ${specs} } from ${sourceStr};\n`;
}

function genImportSpecifier(spec: CoreImportSpecifier): string {
  if (spec.alias && spec.alias !== spec.name) {
    return `${spec.name} as ${spec.alias}`;
  }
  return spec.name;
}

// ============================================
// Expression Statements
// ============================================

function genExprStmt(expr: any, ctx: GenExprContext): string {
  const exprCode = genExpr(expr, { ...ctx, parentPrecedence: PREC.COMMA });
  return `${exprCode};\n`;
}
