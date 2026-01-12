/**
 * DepJS Parser
 */

// Simple recursive descent parser (handles core syntax)
export { parse, Parser } from "./simple-parser.js";

// Lezer parser (work in progress - has ambiguity issues)
// export { parser } from "./parser.js";
// export { spaceTokens } from "./tokens.js";
// export { highlighting } from "./highlight.js";
