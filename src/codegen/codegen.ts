/**
 * Codegen - transforms RuntimeAST (CoreDecl[] after erasure) to JavaScript.
 *
 * Main entry point for code generation.
 */

import { CoreDecl } from "../ast/core-ast";
import { RuntimeProgram } from "../erasure/erasure";
import { CodeBuilder } from "./code-builder";
import { genDecl } from "./gen-decl";
import { PREC } from "./precedence";

/**
 * Options for code generation.
 */
export type CodegenOptions = {
  /** Indentation string (default: "  ") */
  indent?: string;
  /** Include runtime preamble with print function (default: true) */
  includePreamble?: boolean;
};

/**
 * Runtime preamble - defines helpers like print.
 */
const RUNTIME_PREAMBLE = `const print = (...args) => console.log(...args);
`;

/**
 * Generate JavaScript code from a RuntimeProgram.
 */
export function codegen(
  program: RuntimeProgram,
  options: CodegenOptions = {}
): string {
  return codegenDecls(program.decls, options);
}

/**
 * Generate JavaScript code from an array of declarations.
 */
export function codegenDecls(
  decls: CoreDecl[],
  options: CodegenOptions = {}
): string {
  const indent = options.indent ?? "  ";
  const includePreamble = options.includePreamble ?? true;
  const builder = new CodeBuilder(indent);

  // Add runtime preamble if requested
  if (includePreamble) {
    builder.write(RUNTIME_PREAMBLE);
  }

  for (const decl of decls) {
    const code = genDecl(decl, { builder, parentPrecedence: PREC.PRIMARY });
    builder.write(code);
  }

  return builder.build();
}
