/**
 * TypeScript .d.ts Loader
 *
 * Parses and translates TypeScript declaration files (.d.ts) into CoreDecl[].
 * The type checker then processes these declarations uniformly with native DepJS code.
 *
 * Usage:
 *   import { loadDTS } from "./dts-loader";
 *   const result = loadDTS(dtsContent);
 *   // result.decls - Array of CoreDecl to be processed by the type checker
 *   // result.errors - Array of error messages
 */

export { loadDTS, DTSLoadResult } from "./dts-translator";
export { parseDTS, printTree } from "./dts-parser";
