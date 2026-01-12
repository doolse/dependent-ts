/**
 * DepJS Parser
 */

// Main parser: Lezer + desugar to CoreAST
export { parse, desugar } from "./desugar";

// Lezer parser (for IDE integration with incremental parsing)
export { parser as lezerParser } from "./parser";
export { spaceTokens } from "./tokens";
export { highlighting } from "./highlight";
