/**
 * TypeScript .d.ts Loader
 *
 * Parses and translates TypeScript declaration files (.d.ts) into DepJS types.
 *
 * Usage:
 *   import { loadDTS } from "./dts-loader";
 *   const result = loadDTS(dtsContent);
 *   // result.types - Map of exported type names to Type values
 *   // result.values - Map of exported value names (functions, consts) to Type values
 *   // result.errors - Array of error messages
 */

export { loadDTS, DTSLoadResult } from "./dts-translator";
export { parseDTS, printTree } from "./dts-parser";
