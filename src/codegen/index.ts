/**
 * Codegen module - transforms RuntimeAST to JavaScript.
 *
 * Public exports for the code generation phase.
 */

export { codegen, codegenDecls } from "./codegen";
export type { CodegenOptions } from "./codegen";
export { CodeBuilder } from "./code-builder";
