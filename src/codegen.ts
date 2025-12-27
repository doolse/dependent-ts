/**
 * JavaScript Code Generator
 *
 * Converts expressions (typically residual expressions from staged evaluation)
 * into JavaScript code strings that can be executed.
 */

import { Expr, patternToString, patternVars } from "./expr";

// ============================================================================
// Code Generation Options
// ============================================================================

export interface CodeGenOptions {
  /** Indentation string (default: "  ") */
  indent?: string;
  /** Whether to generate TypeScript (adds type annotations where possible) */
  typescript?: boolean;
  /** Whether to wrap in an IIFE for immediate execution */
  wrapInIIFE?: boolean;
  /** Whether to use expression form (ternaries) vs statement form (if/else) */
  preferExpressions?: boolean;
}

const defaultOptions: Required<CodeGenOptions> = {
  indent: "  ",
  typescript: false,
  wrapInIIFE: false,
  preferExpressions: true,
};

// ============================================================================
// Main Code Generation Function
// ============================================================================

/**
 * Generate JavaScript code from an expression.
 */
export function generateJS(expr: Expr, options: CodeGenOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  const code = genExpr(expr, opts, 0);

  if (opts.wrapInIIFE) {
    return `(() => {\n${opts.indent}return ${code};\n})()`;
  }

  return code;
}

/**
 * Generate a complete JavaScript module with the expression as the default export.
 */
export function generateModule(expr: Expr, options: CodeGenOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  const code = genExpr(expr, opts, 0);
  return `export default ${code};\n`;
}

/**
 * Generate a JavaScript function from an expression.
 * The expression should be a function expression.
 */
export function generateFunction(
  name: string,
  expr: Expr,
  options: CodeGenOptions = {}
): string {
  const opts = { ...defaultOptions, ...options };

  if (expr.tag !== "fn") {
    throw new Error("generateFunction requires a function expression");
  }

  // Check for args destructuring optimization
  let params = expr.params;
  let body = expr.body;
  if (params.length === 0) {
    const argsDestructuring = extractArgsDestructuring(body);
    if (argsDestructuring) {
      params = argsDestructuring.params;
      body = argsDestructuring.innerBody;
    }
  }

  const paramsStr = params.join(", ");
  const bodyCode = genExpr(body, opts, 1);

  return `function ${name}(${paramsStr}) {\n${opts.indent}return ${bodyCode};\n}`;
}

// ============================================================================
// Expression Code Generation
// ============================================================================

function genExpr(expr: Expr, opts: Required<CodeGenOptions>, depth: number): string {
  switch (expr.tag) {
    case "lit":
      return genLiteral(expr.value);

    case "var":
      return genIdentifier(expr.name);

    case "binop":
      return genBinaryOp(expr.op, expr.left, expr.right, opts, depth);

    case "unary":
      return genUnaryOp(expr.op, expr.operand, opts, depth);

    case "if":
      return genIf(expr.cond, expr.then, expr.else, opts, depth);

    case "let":
      return genLet(expr.name, expr.value, expr.body, opts, depth);

    case "letPattern":
      return genLetPattern(expr.pattern, expr.value, expr.body, opts, depth);

    case "fn":
      return genFunction(expr.params, expr.body, opts, depth);

    case "recfn":
      return genRecFunction(expr.name, expr.params, expr.body, opts, depth);

    case "call":
      return genCall(expr.func, expr.args, opts, depth);

    case "obj":
      return genObject(expr.fields, opts, depth);

    case "field":
      return genFieldAccess(expr.object, expr.name, opts, depth);

    case "array":
      return genArray(expr.elements, opts, depth);

    case "index":
      return genIndex(expr.array, expr.index, opts, depth);

    case "block":
      return genBlock(expr.exprs, opts, depth);

    case "comptime":
      // comptime should have been resolved during staging
      // If we reach here, just generate the inner expression
      return genExpr(expr.expr, opts, depth);

    case "runtime":
      // runtime annotation - generate the variable reference or inner expression
      if (expr.name) {
        return genIdentifier(expr.name);
      }
      return genExpr(expr.expr, opts, depth);

    case "assert":
      return genAssert(expr.expr, expr.constraint, expr.message, opts, depth);

    case "assertCond":
      return genAssertCond(expr.condition, expr.message, opts, depth);

    case "trust":
      // trust is purely a type-level operation - just generate the inner expression
      return genExpr(expr.expr, opts, depth);

    case "methodCall":
      return genMethodCall(expr.receiver, expr.method, expr.args, opts, depth);

    case "import":
      return genImport(expr.names, expr.modulePath, expr.body, opts, depth);

    case "typeOf":
      // typeOf should have been evaluated at compile time
      // If it appears in residual code, that's an error
      throw new Error("typeOf cannot appear in residual code - it must be evaluated at compile time");
  }
}

// ============================================================================
// Literal Generation
// ============================================================================

function genLiteral(value: number | string | boolean | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    // Handle special number cases
    if (Object.is(value, -0)) return "-0";
    if (!Number.isFinite(value)) {
      if (value === Infinity) return "Infinity";
      if (value === -Infinity) return "-Infinity";
      return "NaN";
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  throw new Error(`Unknown literal type: ${typeof value}`);
}

// ============================================================================
// Identifier Generation
// ============================================================================

// JavaScript reserved words that need escaping
const RESERVED_WORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "null", "true", "false"
]);

function genIdentifier(name: string): string {
  // If it's a reserved word, prefix with underscore
  if (RESERVED_WORDS.has(name)) {
    return `_${name}`;
  }
  // Check if it's a valid identifier
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    return name;
  }
  // Otherwise, escape it (shouldn't happen with normal usage)
  return `_${name.replace(/[^a-zA-Z0-9_$]/g, "_")}`;
}

// ============================================================================
// Operator Generation
// ============================================================================

// Operator precedence for deciding when to add parentheses
const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3, "!=": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
  "!": 7, "-unary": 7,
};

function genBinaryOp(
  op: string,
  left: Expr,
  right: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const leftCode = genExpr(left, opts, depth);
  const rightCode = genExpr(right, opts, depth);

  // Use === and !== instead of == and != for JavaScript
  const jsOp = op === "==" ? "===" : op === "!=" ? "!==" : op;

  // Add parentheses based on precedence if needed
  const leftWrapped = needsParens(left, op, "left") ? `(${leftCode})` : leftCode;
  const rightWrapped = needsParens(right, op, "right") ? `(${rightCode})` : rightCode;

  return `${leftWrapped} ${jsOp} ${rightWrapped}`;
}

function needsParens(expr: Expr, parentOp: string, side: "left" | "right"): boolean {
  if (expr.tag !== "binop") return false;

  const childPrec = PRECEDENCE[expr.op] ?? 0;
  const parentPrec = PRECEDENCE[parentOp] ?? 0;

  if (childPrec < parentPrec) return true;
  if (childPrec === parentPrec && side === "right") return true;

  return false;
}

function genUnaryOp(
  op: string,
  operand: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const operandCode = genExpr(operand, opts, depth);

  // Add parentheses for complex operands
  const needsWrap = operand.tag === "binop" || operand.tag === "unary";
  const wrapped = needsWrap ? `(${operandCode})` : operandCode;

  return `${op}${wrapped}`;
}

// ============================================================================
// Control Flow Generation
// ============================================================================

function genIf(
  cond: Expr,
  thenExpr: Expr,
  elseExpr: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const condCode = genExpr(cond, opts, depth);
  const thenCode = genExpr(thenExpr, opts, depth);
  const elseCode = genExpr(elseExpr, opts, depth);

  if (opts.preferExpressions) {
    // Use ternary operator
    // Wrap complex conditions in parentheses
    const condWrapped = cond.tag === "binop" && PRECEDENCE[cond.op] <= 1
      ? `(${condCode})`
      : condCode;
    return `${condWrapped} ? ${thenCode} : ${elseCode}`;
  }

  // Use if statement wrapped in IIFE
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  return `(() => {
${innerIndent}if (${condCode}) {
${innerIndent}${opts.indent}return ${thenCode};
${innerIndent}} else {
${innerIndent}${opts.indent}return ${elseCode};
${innerIndent}}
${indent}})()`;
}

// ============================================================================
// Let Binding Generation
// ============================================================================

function genLet(
  name: string,
  value: Expr,
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const valueCode = genExpr(value, opts, depth + 1);
  const bodyCode = genExpr(body, opts, depth + 1);

  // Use IIFE to create proper scoping
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);

  if (name === "_") {
    // Discard binding - just evaluate for side effect
    return `(() => {
${innerIndent}${valueCode};
${innerIndent}return ${bodyCode};
${indent}})()`;
  }

  const safeName = genIdentifier(name);
  return `(() => {
${innerIndent}const ${safeName} = ${valueCode};
${innerIndent}return ${bodyCode};
${indent}})()`;
}

import type { Pattern } from "./expr";

/**
 * Generate JavaScript for pattern destructuring.
 */
function genPattern(pattern: Pattern): string {
  switch (pattern.tag) {
    case "varPattern":
      return genIdentifier(pattern.name);
    case "arrayPattern":
      return `[${pattern.elements.map(genPattern).join(", ")}]`;
    case "objectPattern":
      return `{ ${pattern.fields.map(f => {
        const patStr = genPattern(f.pattern);
        // If the pattern is just a variable with the same name as the key, use shorthand
        if (f.pattern.tag === "varPattern" && f.pattern.name === f.key) {
          return genIdentifier(f.key);
        }
        return `${genIdentifier(f.key)}: ${patStr}`;
      }).join(", ")} }`;
  }
}

function genLetPattern(
  pattern: Pattern,
  value: Expr,
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const patternCode = genPattern(pattern);
  const valueCode = genExpr(value, opts, depth + 1);
  const bodyCode = genExpr(body, opts, depth + 1);

  // Use IIFE to create proper scoping
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);

  return `(() => {
${innerIndent}const ${patternCode} = ${valueCode};
${innerIndent}return ${bodyCode};
${indent}})()`;
}

// ============================================================================
// Function Generation
// ============================================================================

/**
 * Check if an expression is a let chain (let x = ... in let y = ... in ...)
 * These should be generated as statements in function bodies, not IIFEs.
 */
function isLetChain(expr: Expr): boolean {
  return expr.tag === "let" || expr.tag === "letPattern";
}

/**
 * Generate a function body as statements (for let chains).
 * Converts: let x = a in let y = b in result
 * To: const x = a; const y = b; return result;
 */
function genFunctionBodyStatements(
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const indent = opts.indent.repeat(depth);
  const statements: string[] = [];

  let current = body;
  while (isLetChain(current)) {
    if (current.tag === "let") {
      const valueCode = genExpr(current.value, opts, depth);
      if (current.name === "_") {
        // Discard binding - just emit the expression as a statement
        statements.push(`${indent}${valueCode};`);
      } else {
        const safeName = genIdentifier(current.name);
        statements.push(`${indent}const ${safeName} = ${valueCode};`);
      }
      current = current.body;
    } else if (current.tag === "letPattern") {
      const patternCode = genPattern(current.pattern);
      const valueCode = genExpr(current.value, opts, depth);
      statements.push(`${indent}const ${patternCode} = ${valueCode};`);
      current = current.body;
    }
  }

  // The final expression is the return value
  const returnCode = genExpr(current, opts, depth);
  statements.push(`${indent}return ${returnCode};`);

  return statements.join("\n");
}

/**
 * Check if a pattern is a simple array destructuring of consecutive elements.
 * Returns the list of variable names if it's a simple pattern, null otherwise.
 */
function extractSimpleArrayPattern(pattern: Pattern): string[] | null {
  if (pattern.tag === "arrayPattern") {
    const names: string[] = [];
    for (const elem of pattern.elements) {
      if (elem.tag === "varPattern") {
        names.push(elem.name);
      } else {
        // Nested patterns not supported for this optimization
        return null;
      }
    }
    return names;
  }
  return null;
}

/**
 * Check if a function body starts with `let [a, b, ...] = args in rest`
 * and extract the parameter names and the inner body.
 * This allows us to generate proper JavaScript function parameters.
 */
function extractArgsDestructuring(body: Expr): { params: string[]; innerBody: Expr } | null {
  if (body.tag === "letPattern") {
    // Check if the value is the 'args' variable
    if (body.value.tag === "var" && body.value.name === "args") {
      const params = extractSimpleArrayPattern(body.pattern);
      if (params) {
        return { params, innerBody: body.body };
      }
    }
  }
  return null;
}

function genFunction(
  params: string[],
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  // Check for args destructuring optimization: fn => let [x, y] = args in body
  // transforms to (x, y) => body
  if (params.length === 0) {
    const argsDestructuring = extractArgsDestructuring(body);
    if (argsDestructuring) {
      return genFunction(argsDestructuring.params, argsDestructuring.innerBody, opts, depth);
    }
  }

  const safeParams = params.map(genIdentifier).join(", ");

  // If body is a let chain, generate as block with statements
  if (isLetChain(body)) {
    const bodyStatements = genFunctionBodyStatements(body, opts, depth + 1);
    const indent = opts.indent.repeat(depth);
    return `(${safeParams}) => {\n${bodyStatements}\n${indent}}`;
  }

  // Simple expression body
  const bodyCode = genExpr(body, opts, depth);
  return `(${safeParams}) => ${bodyCode}`;
}

/**
 * Generate a named recursive function.
 * Uses function declaration syntax for proper recursion.
 */
function genRecFunction(
  name: string,
  params: string[],
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  // Check for args destructuring optimization
  if (params.length === 0) {
    const argsDestructuring = extractArgsDestructuring(body);
    if (argsDestructuring) {
      return genRecFunction(name, argsDestructuring.params, argsDestructuring.innerBody, opts, depth);
    }
  }

  const safeName = genIdentifier(name);
  const safeParams = params.map(genIdentifier).join(", ");

  // If body is a let chain, generate as block with statements
  if (isLetChain(body)) {
    const bodyStatements = genFunctionBodyStatements(body, opts, depth + 1);
    const indent = opts.indent.repeat(depth);
    return `function ${safeName}(${safeParams}) {\n${bodyStatements}\n${indent}}`;
  }

  // Simple expression body
  const bodyCode = genExpr(body, opts, depth);
  return `function ${safeName}(${safeParams}) { return ${bodyCode}; }`;
}

function genCall(
  func: Expr,
  args: Expr[],
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  // Special case: print() becomes console.log()
  if (func.tag === "var" && func.name === "print") {
    const argsCode = args.map(arg => genExpr(arg, opts, depth)).join(", ");
    return `console.log(${argsCode})`;
  }

  // Special case: map(fn, arr) becomes arr.map(fn)
  if (func.tag === "var" && func.name === "map" && args.length === 2) {
    const fnCode = genExpr(args[0], opts, depth);
    const arrCode = genExpr(args[1], opts, depth);
    return `${arrCode}.map(${fnCode})`;
  }

  // Special case: filter(fn, arr) becomes arr.filter(fn)
  if (func.tag === "var" && func.name === "filter" && args.length === 2) {
    const fnCode = genExpr(args[0], opts, depth);
    const arrCode = genExpr(args[1], opts, depth);
    return `${arrCode}.filter(${fnCode})`;
  }

  const funcCode = genExpr(func, opts, depth);
  const argsCode = args.map(arg => genExpr(arg, opts, depth)).join(", ");

  // Wrap function expression in parentheses if needed
  const funcWrapped = func.tag === "fn" ? `(${funcCode})` : funcCode;

  return `${funcWrapped}(${argsCode})`;
}

/**
 * Generate method call: receiver.method(args)
 */
function genMethodCall(
  receiver: Expr,
  method: string,
  args: Expr[],
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  // Try optimized filter generation for array literals with conditional elements
  if (method === "filter" && args.length === 1 && receiver.tag === "array") {
    const optimized = tryGenerateOptimizedFilter(receiver, args[0], undefined, opts, depth);
    if (optimized) {
      return optimized;
    }
  }

  // Try optimized filter().map() fusion for array literals
  if (method === "map" && args.length === 1 &&
      receiver.tag === "methodCall" && receiver.method === "filter" &&
      receiver.args.length === 1 && receiver.receiver.tag === "array") {
    const optimized = tryGenerateOptimizedFilter(
      receiver.receiver,
      receiver.args[0],
      args[0],  // The map transform function
      opts,
      depth
    );
    if (optimized) {
      return optimized;
    }
  }

  const recvCode = genExpr(receiver, opts, depth);
  const argsCode = args.map(arg => genExpr(arg, opts, depth)).join(", ");

  // Wrap complex receiver expressions in parentheses
  const needsWrap = receiver.tag === "binop" || receiver.tag === "unary" ||
                    receiver.tag === "if" || receiver.tag === "let";
  const recvWrapped = needsWrap ? `(${recvCode})` : recvCode;

  return `${recvWrapped}.${method}(${argsCode})`;
}

// ============================================================================
// Optimized Filter Generation
// ============================================================================

/**
 * Represents a simple predicate that can be evaluated statically.
 */
interface SimplePredicate {
  kind: "notNull" | "notEquals" | "equals" | "gt" | "gte" | "lt" | "lte";
  paramName: string;
  value?: unknown; // For comparison predicates
}

/**
 * Try to extract a simple predicate from a function expression.
 * Returns null if the predicate is too complex to analyze.
 */
function extractSimplePredicate(fn: Expr): SimplePredicate | null {
  // Handle fn expression: fn(params) => body
  if (fn.tag !== "fn") return null;

  // Extract param name from desugared body: let [x] = args in <body>
  let body = fn.body;
  let paramName: string | null = null;

  if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern" && pattern.elements.length > 0) {
      const firstElem = pattern.elements[0];
      if (firstElem.tag === "varPattern") {
        paramName = firstElem.name;
        body = body.body;
      }
    }
  }

  if (!paramName) return null;

  // Analyze the body for simple patterns
  if (body.tag === "binop") {
    const { op, left, right } = body;

    // Pattern: x != null
    if (op === "!=" && left.tag === "var" && left.name === paramName) {
      if (right.tag === "lit" && right.value === null) {
        return { kind: "notNull", paramName };
      }
      if (right.tag === "lit") {
        return { kind: "notEquals", paramName, value: right.value };
      }
    }

    // Pattern: null != x
    if (op === "!=" && right.tag === "var" && right.name === paramName) {
      if (left.tag === "lit" && left.value === null) {
        return { kind: "notNull", paramName };
      }
    }

    // Pattern: x == value
    if (op === "==" && left.tag === "var" && left.name === paramName && right.tag === "lit") {
      return { kind: "equals", paramName, value: right.value };
    }

    // Pattern: x > n, x >= n, x < n, x <= n
    if (left.tag === "var" && left.name === paramName && right.tag === "lit" && typeof right.value === "number") {
      if (op === ">") return { kind: "gt", paramName, value: right.value };
      if (op === ">=") return { kind: "gte", paramName, value: right.value };
      if (op === "<") return { kind: "lt", paramName, value: right.value };
      if (op === "<=") return { kind: "lte", paramName, value: right.value };
    }
  }

  return null;
}

/**
 * Evaluate a predicate against a literal value.
 * Returns true/false if can determine, null if unknown.
 */
function evaluatePredicate(pred: SimplePredicate, value: unknown): boolean | null {
  switch (pred.kind) {
    case "notNull":
      return value !== null;
    case "notEquals":
      return value !== pred.value;
    case "equals":
      return value === pred.value;
    case "gt":
      return typeof value === "number" ? value > (pred.value as number) : null;
    case "gte":
      return typeof value === "number" ? value >= (pred.value as number) : null;
    case "lt":
      return typeof value === "number" ? value < (pred.value as number) : null;
    case "lte":
      return typeof value === "number" ? value <= (pred.value as number) : null;
  }
}

/**
 * A branch in an if-else-if chain.
 */
interface IfChainBranch {
  condition: Expr;
  value: Expr;
}

/**
 * Result of analyzing an element against a predicate.
 */
type ElementAnalysis =
  | { result: "always" }           // Always included
  | { result: "never" }            // Never included (dead branch)
  | { result: "conditional"; condition: Expr; value: Expr }  // Include conditionally
  | { result: "ifChain"; branches: IfChainBranch[] }  // If-else-if chain
  | { result: "unknown"; expr: Expr };  // Can't analyze, use runtime check

/**
 * Analyze a single array element against a predicate.
 */
function analyzeElement(element: Expr, pred: SimplePredicate): ElementAnalysis {
  // Literal value - evaluate statically
  if (element.tag === "lit") {
    const result = evaluatePredicate(pred, element.value);
    if (result === true) return { result: "always" };
    if (result === false) return { result: "never" };
    return { result: "unknown", expr: element };
  }

  // If expression - analyze each branch
  if (element.tag === "if") {
    const thenAnalysis = analyzeElement(element.then, pred);
    const elseAnalysis = analyzeElement(element.else, pred);

    // Both branches have same result
    if (thenAnalysis.result === "always" && elseAnalysis.result === "always") {
      return { result: "always" };
    }
    if (thenAnalysis.result === "never" && elseAnalysis.result === "never") {
      return { result: "never" };
    }

    // Then included, else excluded: include when condition is true
    if (thenAnalysis.result === "always" && elseAnalysis.result === "never") {
      return { result: "conditional", condition: element.cond, value: element.then };
    }

    // Then excluded, else included: include when condition is false
    if (thenAnalysis.result === "never" && elseAnalysis.result === "always") {
      return {
        result: "conditional",
        condition: { tag: "unary", op: "!", operand: element.cond },
        value: element.else
      };
    }

    // Helper to get branches from an analysis result
    const getBranches = (analysis: ElementAnalysis, cond: Expr, value: Expr): IfChainBranch[] | null => {
      if (analysis.result === "always") {
        return [{ condition: cond, value }];
      }
      if (analysis.result === "conditional") {
        // Combine: cond && analysis.condition
        return [{ condition: { tag: "binop", op: "&&", left: cond, right: analysis.condition }, value: analysis.value }];
      }
      if (analysis.result === "ifChain") {
        // Prepend condition to each branch
        return analysis.branches.map(b => ({
          condition: { tag: "binop", op: "&&", left: cond, right: b.condition },
          value: b.value
        }));
      }
      return null; // never or unknown
    };

    // Then always, else conditional: build ifChain
    if (thenAnalysis.result === "always" && elseAnalysis.result === "conditional") {
      return {
        result: "ifChain",
        branches: [
          { condition: element.cond, value: element.then },
          { condition: elseAnalysis.condition, value: elseAnalysis.value }
        ]
      };
    }

    // Then always, else ifChain: prepend to chain
    if (thenAnalysis.result === "always" && elseAnalysis.result === "ifChain") {
      return {
        result: "ifChain",
        branches: [
          { condition: element.cond, value: element.then },
          ...elseAnalysis.branches
        ]
      };
    }

    // Then conditional, else never: just use the conditional with combined condition
    if (thenAnalysis.result === "conditional" && elseAnalysis.result === "never") {
      return {
        result: "conditional",
        condition: { tag: "binop", op: "&&", left: element.cond, right: thenAnalysis.condition },
        value: thenAnalysis.value
      };
    }

    // Then never, else conditional: use the else conditional
    if (thenAnalysis.result === "never" && elseAnalysis.result === "conditional") {
      return elseAnalysis;
    }

    // Then never, else ifChain: use the else ifChain
    if (thenAnalysis.result === "never" && elseAnalysis.result === "ifChain") {
      return elseAnalysis;
    }

    // Then conditional, else always: build ifChain with negated else
    if (thenAnalysis.result === "conditional" && elseAnalysis.result === "always") {
      return {
        result: "ifChain",
        branches: [
          { condition: { tag: "binop", op: "&&", left: element.cond, right: thenAnalysis.condition }, value: thenAnalysis.value },
          { condition: { tag: "unary", op: "!", operand: element.cond }, value: element.else }
        ]
      };
    }

    // Then conditional, else conditional: build ifChain
    if (thenAnalysis.result === "conditional" && elseAnalysis.result === "conditional") {
      return {
        result: "ifChain",
        branches: [
          { condition: { tag: "binop", op: "&&", left: element.cond, right: thenAnalysis.condition }, value: thenAnalysis.value },
          { condition: elseAnalysis.condition, value: elseAnalysis.value }
        ]
      };
    }

    // Then conditional, else ifChain: combine
    if (thenAnalysis.result === "conditional" && elseAnalysis.result === "ifChain") {
      return {
        result: "ifChain",
        branches: [
          { condition: { tag: "binop", op: "&&", left: element.cond, right: thenAnalysis.condition }, value: thenAnalysis.value },
          ...elseAnalysis.branches
        ]
      };
    }

    // Then ifChain, else never: keep the ifChain guarded by condition
    if (thenAnalysis.result === "ifChain" && elseAnalysis.result === "never") {
      return {
        result: "ifChain",
        branches: thenAnalysis.branches.map(b => ({
          condition: { tag: "binop", op: "&&", left: element.cond, right: b.condition },
          value: b.value
        }))
      };
    }

    // Then ifChain, else always: combine with negated condition for else
    if (thenAnalysis.result === "ifChain" && elseAnalysis.result === "always") {
      const thenBranches: IfChainBranch[] = thenAnalysis.branches.map(b => ({
        condition: { tag: "binop" as const, op: "&&" as const, left: element.cond, right: b.condition },
        value: b.value
      }));
      return {
        result: "ifChain",
        branches: [
          ...thenBranches,
          { condition: { tag: "unary" as const, op: "!" as const, operand: element.cond }, value: element.else }
        ]
      };
    }

    // Then ifChain, else conditional: combine
    if (thenAnalysis.result === "ifChain" && elseAnalysis.result === "conditional") {
      const thenBranches: IfChainBranch[] = thenAnalysis.branches.map(b => ({
        condition: { tag: "binop" as const, op: "&&" as const, left: element.cond, right: b.condition },
        value: b.value
      }));
      return {
        result: "ifChain",
        branches: [
          ...thenBranches,
          { condition: elseAnalysis.condition, value: elseAnalysis.value }
        ]
      };
    }

    // Then ifChain, else ifChain: combine both
    if (thenAnalysis.result === "ifChain" && elseAnalysis.result === "ifChain") {
      const thenBranches: IfChainBranch[] = thenAnalysis.branches.map(b => ({
        condition: { tag: "binop" as const, op: "&&" as const, left: element.cond, right: b.condition },
        value: b.value
      }));
      return {
        result: "ifChain",
        branches: [...thenBranches, ...elseAnalysis.branches]
      };
    }

    // One is unknown - fall back
    return { result: "unknown", expr: element };
  }

  // Can't analyze - need runtime check
  return { result: "unknown", expr: element };
}

/**
 * Extract the parameter name and body from a map function.
 * Returns null if the function structure can't be analyzed.
 */
function extractMapFnBody(fn: Expr): { paramName: string; body: Expr } | null {
  if (fn.tag !== "fn") return null;

  let body = fn.body;
  let paramName: string | null = null;

  // Extract param name from desugared body: let [x] = args in <body>
  if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern" && pattern.elements.length > 0) {
      const firstElem = pattern.elements[0];
      if (firstElem.tag === "varPattern") {
        paramName = firstElem.name;
        body = body.body;
      }
    }
  }

  if (!paramName) return null;

  return { paramName, body };
}

/**
 * Substitute a value for a variable in an expression (simple substitution).
 */
function substituteVar(expr: Expr, varName: string, replacement: Expr): Expr {
  switch (expr.tag) {
    case "var":
      return expr.name === varName ? replacement : expr;
    case "lit":
      return expr;
    case "binop":
      return {
        ...expr,
        left: substituteVar(expr.left, varName, replacement),
        right: substituteVar(expr.right, varName, replacement)
      };
    case "unary":
      return {
        ...expr,
        operand: substituteVar(expr.operand, varName, replacement)
      };
    case "if":
      return {
        ...expr,
        cond: substituteVar(expr.cond, varName, replacement),
        then: substituteVar(expr.then, varName, replacement),
        else: substituteVar(expr.else, varName, replacement)
      };
    case "methodCall":
      return {
        ...expr,
        receiver: substituteVar(expr.receiver, varName, replacement),
        args: expr.args.map(a => substituteVar(a, varName, replacement))
      };
    case "call":
      return {
        ...expr,
        func: substituteVar(expr.func, varName, replacement),
        args: expr.args.map(a => substituteVar(a, varName, replacement))
      };
    case "field":
      return {
        ...expr,
        object: substituteVar(expr.object, varName, replacement)
      };
    case "index":
      return {
        ...expr,
        array: substituteVar(expr.array, varName, replacement),
        index: substituteVar(expr.index, varName, replacement)
      };
    case "array":
      return {
        ...expr,
        elements: expr.elements.map(e => substituteVar(e, varName, replacement))
      };
    case "obj":
      return {
        ...expr,
        fields: expr.fields.map(f => ({
          name: f.name,
          value: substituteVar(f.value, varName, replacement)
        }))
      };
    // For let/fn, be careful about shadowing - for simplicity, don't substitute into them
    default:
      return expr;
  }
}

/**
 * Try to evaluate an expression at compile time using the staged evaluator.
 * Returns the evaluated expression if possible, or null if runtime evaluation is needed.
 *
 * This is the generic approach - it uses the existing staged evaluator infrastructure
 * which already knows how to evaluate any expression when all inputs are known.
 */
function tryEvalAtCompileTime(expr: Expr): Expr | null {
  try {
    const result = stage(expr);
    if (isNow(result.svalue)) {
      // Successfully evaluated at compile time - convert value back to expression
      return exprFromValue(result.svalue.value);
    }
    // Couldn't fully evaluate - needs runtime
    return null;
  } catch {
    // Evaluation failed (e.g., type error, unknown variable) - needs runtime
    return null;
  }
}

/**
 * Apply a transform function to a value expression by substituting
 * the value into the function body.
 */
function applyTransform(
  value: Expr,
  transformFn: { paramName: string; body: Expr } | null,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  if (!transformFn) {
    return genExpr(value, opts, depth);
  }

  // Substitute the value for the parameter in the transform body
  const substituted = substituteVar(transformFn.body, transformFn.paramName, value);

  // Try to evaluate at compile time using the staged evaluator
  // This is fully generic - works for any expression, not just method calls
  const evaluated = tryEvalAtCompileTime(substituted);
  if (evaluated) {
    return genExpr(evaluated, opts, depth);
  }

  return genExpr(substituted, opts, depth);
}

/**
 * Try to generate optimized filter code for an array with conditional elements.
 * Optionally fuses a map transform into the filter.
 * Returns null if optimization is not possible.
 */
function tryGenerateOptimizedFilter(
  arrayExpr: Expr & { tag: "array" },
  predicateFn: Expr,
  transformFn: Expr | undefined,
  opts: Required<CodeGenOptions>,
  depth: number
): string | null {
  // Extract predicate
  const pred = extractSimplePredicate(predicateFn);
  if (!pred) return null;

  // Check if any elements are conditionals (worth optimizing)
  const hasConditionals = arrayExpr.elements.some(e => e.tag === "if");
  if (!hasConditionals) return null;

  // Analyze each element
  const analyses = arrayExpr.elements.map(e => analyzeElement(e, pred));

  // Check if we can actually optimize (any element is not unknown)
  // "conditional"/"ifChain" means we've pruned branches, "always"/"never" means we know the outcome
  const canOptimize = analyses.some(a => a.result !== "unknown");
  if (!canOptimize) return null;

  // Extract transform if provided
  const transform = transformFn ? extractMapFnBody(transformFn) : null;

  // Generate optimized code
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);

  const lines: string[] = [];
  lines.push(`(() => {`);
  lines.push(`${innerIndent}const _result = [];`);

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i];
    const element = arrayExpr.elements[i];

    switch (analysis.result) {
      case "always":
        // Always included - push unconditionally
        lines.push(`${innerIndent}_result.push(${applyTransform(element, transform, opts, depth + 1)});`);
        break;

      case "never":
        // Never included - skip entirely (the optimization!)
        lines.push(`${innerIndent}// Element ${i} pruned: never passes predicate`);
        break;

      case "conditional":
        // Include conditionally
        lines.push(`${innerIndent}if (${genExpr(analysis.condition, opts, depth + 1)}) {`);
        lines.push(`${innerIndent}${opts.indent}_result.push(${applyTransform(analysis.value, transform, opts, depth + 2)});`);
        lines.push(`${innerIndent}}`);
        break;

      case "ifChain":
        // Generate if-else-if chain
        for (let j = 0; j < analysis.branches.length; j++) {
          const branch = analysis.branches[j];
          const keyword = j === 0 ? "if" : "} else if";
          lines.push(`${innerIndent}${keyword} (${genExpr(branch.condition, opts, depth + 1)}) {`);
          lines.push(`${innerIndent}${opts.indent}_result.push(${applyTransform(branch.value, transform, opts, depth + 2)});`);
        }
        lines.push(`${innerIndent}}`);
        break;

      case "unknown":
        // Can't analyze - use runtime predicate check
        const fnCode = genExpr(predicateFn, opts, depth + 1);
        lines.push(`${innerIndent}if (${fnCode}(${genExpr(analysis.expr, opts, depth + 1)})) {`);
        lines.push(`${innerIndent}${opts.indent}_result.push(${applyTransform(analysis.expr, transform, opts, depth + 2)});`);
        lines.push(`${innerIndent}}`);
        break;
    }
  }

  lines.push(`${innerIndent}return _result;`);

  // If we have a transform we couldn't fuse, apply it at the end
  if (transformFn && !transform) {
    const transformCode = genExpr(transformFn, opts, depth);
    lines.push(`${indent}})().map(${transformCode})`);
  } else {
    lines.push(`${indent}})()`);
  }

  return lines.join("\n");
}

// ============================================================================
// Object Generation
// ============================================================================

function genObject(
  fields: { name: string; value: Expr }[],
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  if (fields.length === 0) {
    return "{}";
  }

  const fieldStrs = fields.map(({ name, value }) => {
    const valueCode = genExpr(value, opts, depth);
    // Use shorthand if the value is a variable with the same name
    if (value.tag === "var" && value.name === name) {
      return genIdentifier(name);
    }
    // Quote field name if necessary
    const safeName = isValidPropertyName(name) ? name : JSON.stringify(name);
    return `${safeName}: ${valueCode}`;
  });

  // Single line for short objects, multi-line for longer ones
  const singleLine = `{ ${fieldStrs.join(", ")} }`;
  if (singleLine.length <= 60) {
    return singleLine;
  }

  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  return `{\n${innerIndent}${fieldStrs.join(`,\n${innerIndent}`)}\n${indent}}`;
}

function isValidPropertyName(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !RESERVED_WORDS.has(name);
}

function genFieldAccess(
  object: Expr,
  fieldName: string,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const objCode = genExpr(object, opts, depth);

  // Wrap complex expressions
  const needsWrap = object.tag === "binop" || object.tag === "unary" ||
                    object.tag === "if" || object.tag === "let";
  const objWrapped = needsWrap ? `(${objCode})` : objCode;

  // Use dot notation if valid, otherwise bracket notation
  if (isValidPropertyName(fieldName)) {
    return `${objWrapped}.${fieldName}`;
  }
  return `${objWrapped}[${JSON.stringify(fieldName)}]`;
}

// ============================================================================
// Array Generation
// ============================================================================

function genArray(
  elements: Expr[],
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  if (elements.length === 0) {
    return "[]";
  }

  const elementStrs = elements.map(e => genExpr(e, opts, depth));

  // Single line for short arrays
  const singleLine = `[${elementStrs.join(", ")}]`;
  if (singleLine.length <= 60) {
    return singleLine;
  }

  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  return `[\n${innerIndent}${elementStrs.join(`,\n${innerIndent}`)}\n${indent}]`;
}

function genIndex(
  array: Expr,
  indexExpr: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const arrCode = genExpr(array, opts, depth);
  const indexCode = genExpr(indexExpr, opts, depth);

  // Wrap complex expressions
  const needsWrap = array.tag === "binop" || array.tag === "unary" ||
                    array.tag === "if" || array.tag === "let";
  const arrWrapped = needsWrap ? `(${arrCode})` : arrCode;

  return `${arrWrapped}[${indexCode}]`;
}

// ============================================================================
// Block Generation
// ============================================================================

function genBlock(
  exprs: Expr[],
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  if (exprs.length === 0) {
    return "null";
  }

  if (exprs.length === 1) {
    return genExpr(exprs[0], opts, depth);
  }

  // Multiple expressions - use IIFE with statements
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);

  const statements = exprs.slice(0, -1).map(e =>
    `${innerIndent}${genExpr(e, opts, depth + 1)};`
  );
  const lastExpr = exprs[exprs.length - 1];
  const returnStmt = `${innerIndent}return ${genExpr(lastExpr, opts, depth + 1)};`;

  return `(() => {\n${statements.join("\n")}\n${returnStmt}\n${indent}})()`;
}

// ============================================================================
// Assert Generation
// ============================================================================

/**
 * Generate runtime assertion code.
 * Creates an IIFE that checks the constraint and throws if it fails.
 */
function genAssert(
  valueExpr: Expr,
  constraintExpr: Expr,
  message: string | undefined,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  const valueCode = genExpr(valueExpr, opts, depth + 1);

  // For now, generate a simple runtime type check
  // In a full implementation, this would generate a proper constraint check
  const errorMessage = message
    ? JSON.stringify(message)
    : `"Assertion failed"`;

  // Generate an IIFE that validates and returns the value
  return `(() => {
${innerIndent}const __value = ${valueCode};
${innerIndent}if (__value === null || __value === undefined) {
${innerIndent}${opts.indent}throw new Error(${errorMessage});
${innerIndent}}
${innerIndent}return __value;
${indent}})()`;
}

/**
 * Generate code for condition-based assert.
 */
function genAssertCond(
  conditionExpr: Expr,
  message: string | undefined,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  const condCode = genExpr(conditionExpr, opts, depth + 1);

  const errorMessage = message
    ? JSON.stringify(message)
    : `"Assertion failed: condition is false"`;

  // Generate an IIFE that checks condition and returns true
  return `(() => {
${innerIndent}if (!(${condCode})) {
${innerIndent}${opts.indent}throw new Error(${errorMessage});
${innerIndent}}
${innerIndent}return true;
${indent}})()`;
}

// ============================================================================
// Import Generation
// ============================================================================

/**
 * Generate JavaScript import statement followed by the body.
 *
 * Generates:
 * import { name1, name2 } from "module";
 * body
 */
function genImport(
  names: string[],
  modulePath: string,
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  const bodyCode = genExpr(body, opts, depth + 1);

  // Generate import names
  const importNames = names.map(genIdentifier).join(", ");

  // Use IIFE to properly scope the import
  // The import statement must be at module level in real ES modules,
  // but for generated code we'll use dynamic import or assume bundler handles it
  return `(() => {
${innerIndent}// import { ${importNames} } from ${JSON.stringify(modulePath)};
${innerIndent}return ${bodyCode};
${indent}})()`;
}

/**
 * Generate JavaScript with top-level imports.
 * This is for generating complete modules with proper ES imports.
 */
export function generateModuleWithImports(expr: Expr, options: CodeGenOptions = {}): string {
  const opts = { ...defaultOptions, ...options };

  // Collect all imports from the ORIGINAL expression (before staging)
  // This is needed because staging may inline/transform imports
  const imports = collectImports(expr);

  // Generate import statements
  const importStatements = Array.from(imports.entries())
    .map(([modulePath, names]) => {
      const importNames = Array.from(names).map(genIdentifier).join(", ");
      return `import { ${importNames} } from ${JSON.stringify(modulePath)};`;
    })
    .join("\n");

  // Stage the expression for partial evaluation
  const result = stage(expr);
  const sv = result.svalue;

  // Get the expression to generate code from
  let codeExpr: Expr;
  if (isNow(sv)) {
    codeExpr = exprFromValue(sv.value);
  } else {
    codeExpr = svalueToResidual(sv);
  }

  // Strip import expressions from the body since we're hoisting them
  const strippedExpr = stripImports(codeExpr);
  const code = genExpr(strippedExpr, opts, 0);

  if (importStatements) {
    return `${importStatements}\n\nexport default ${code};\n`;
  }
  return `export default ${code};\n`;
}

/**
 * Collect all imports from an expression tree.
 */
function collectImports(expr: Expr): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>();

  function visit(e: Expr): void {
    switch (e.tag) {
      case "import": {
        const existing = imports.get(e.modulePath) || new Set();
        for (const name of e.names) {
          existing.add(name);
        }
        imports.set(e.modulePath, existing);
        visit(e.body);
        break;
      }
      case "binop":
        visit(e.left);
        visit(e.right);
        break;
      case "unary":
        visit(e.operand);
        break;
      case "if":
        visit(e.cond);
        visit(e.then);
        visit(e.else);
        break;
      case "let":
        visit(e.value);
        visit(e.body);
        break;
      case "letPattern":
        visit(e.value);
        visit(e.body);
        break;
      case "fn":
        visit(e.body);
        break;
      case "recfn":
        visit(e.body);
        break;
      case "call":
        visit(e.func);
        for (const a of e.args) visit(a);
        break;
      case "obj":
        for (const f of e.fields) visit(f.value);
        break;
      case "field":
        visit(e.object);
        break;
      case "array":
        for (const el of e.elements) visit(el);
        break;
      case "index":
        visit(e.array);
        visit(e.index);
        break;
      case "block":
        for (const ex of e.exprs) visit(ex);
        break;
      case "comptime":
        visit(e.expr);
        break;
      case "runtime":
        visit(e.expr);
        break;
      case "assert":
        visit(e.expr);
        visit(e.constraint);
        break;
      case "assertCond":
        visit(e.condition);
        break;
      case "trust":
        visit(e.expr);
        if (e.constraint) visit(e.constraint);
        break;
      case "methodCall":
        visit(e.receiver);
        for (const a of e.args) visit(a);
        break;
      case "typeOf":
        visit(e.expr);
        break;
      // lit, var don't need visiting
    }
  }

  visit(expr);
  return imports;
}

/**
 * Strip import expressions from an expression tree.
 * Replaces import nodes with just their body, since imports are hoisted.
 */
function stripImports(expr: Expr): Expr {
  switch (expr.tag) {
    case "import":
      return stripImports(expr.body);
    case "binop":
      return { ...expr, left: stripImports(expr.left), right: stripImports(expr.right) };
    case "unary":
      return { ...expr, operand: stripImports(expr.operand) };
    case "if":
      return { ...expr, cond: stripImports(expr.cond), then: stripImports(expr.then), else: stripImports(expr.else) };
    case "let":
      return { ...expr, value: stripImports(expr.value), body: stripImports(expr.body) };
    case "letPattern":
      return { ...expr, value: stripImports(expr.value), body: stripImports(expr.body) };
    case "fn":
      return { ...expr, body: stripImports(expr.body) };
    case "recfn":
      return { ...expr, body: stripImports(expr.body) };
    case "call":
      return { ...expr, func: stripImports(expr.func), args: expr.args.map(stripImports) };
    case "obj":
      return { ...expr, fields: expr.fields.map(f => ({ ...f, value: stripImports(f.value) })) };
    case "field":
      return { ...expr, object: stripImports(expr.object) };
    case "array":
      return { ...expr, elements: expr.elements.map(stripImports) };
    case "index":
      return { ...expr, array: stripImports(expr.array), index: stripImports(expr.index) };
    case "block":
      return { ...expr, exprs: expr.exprs.map(stripImports) };
    case "comptime":
      return { ...expr, expr: stripImports(expr.expr) };
    case "runtime":
      return { ...expr, expr: stripImports(expr.expr) };
    case "assert":
      return { ...expr, expr: stripImports(expr.expr), constraint: stripImports(expr.constraint) };
    case "assertCond":
      return { ...expr, condition: stripImports(expr.condition) };
    case "trust":
      return { ...expr, expr: stripImports(expr.expr), constraint: expr.constraint ? stripImports(expr.constraint) : undefined };
    case "methodCall":
      return { ...expr, receiver: stripImports(expr.receiver), args: expr.args.map(stripImports) };
    case "typeOf":
      return { ...expr, expr: stripImports(expr.expr) };
    default:
      return expr;
  }
}

// ============================================================================
// Compilation Pipeline
// ============================================================================

import { stage, closureToResidual, svalueToResidual } from "./staged-evaluate";
import { isNow } from "./svalue";
import { valueToString } from "./value";

/**
 * Full compilation pipeline: stage + codegen.
 * Takes an expression, partially evaluates it, and generates JavaScript.
 */
export function compile(expr: Expr, options: CodeGenOptions = {}): string {
  const result = stage(expr);
  const sv = result.svalue;

  if (isNow(sv)) {
    // Fully evaluated at compile time - generate literal
    return generateJS(exprFromValue(sv.value), options);
  }

  // Generate code from residual (sv is Later or LaterArray)
  return generateJS(svalueToResidual(sv), options);
}

/**
 * Get free variables in an expression (variables not bound within the expression).
 */
function freeVars(expr: Expr, bound: Set<string> = new Set()): Set<string> {
  const free = new Set<string>();

  function visit(e: Expr, b: Set<string>): void {
    switch (e.tag) {
      case "lit":
        break;
      case "var":
        if (!b.has(e.name)) free.add(e.name);
        break;
      case "binop":
        visit(e.left, b);
        visit(e.right, b);
        break;
      case "unary":
        visit(e.operand, b);
        break;
      case "if":
        visit(e.cond, b);
        visit(e.then, b);
        visit(e.else, b);
        break;
      case "let": {
        visit(e.value, b);
        const newBound = new Set(b);
        newBound.add(e.name);
        visit(e.body, newBound);
        break;
      }
      case "letPattern": {
        visit(e.value, b);
        const newBound = new Set(b);
        for (const v of patternVars(e.pattern)) newBound.add(v);
        visit(e.body, newBound);
        break;
      }
      case "fn": {
        const newBound = new Set(b);
        for (const p of e.params) newBound.add(p);
        visit(e.body, newBound);
        break;
      }
      case "recfn": {
        const newBound = new Set(b);
        newBound.add(e.name);  // Name is bound for recursion
        for (const p of e.params) newBound.add(p);
        visit(e.body, newBound);
        break;
      }
      case "call":
        visit(e.func, b);
        for (const a of e.args) visit(a, b);
        break;
      case "obj":
        for (const f of e.fields) visit(f.value, b);
        break;
      case "field":
        visit(e.object, b);
        break;
      case "array":
        for (const el of e.elements) visit(el, b);
        break;
      case "index":
        visit(e.array, b);
        visit(e.index, b);
        break;
      case "block":
        for (const ex of e.exprs) visit(ex, b);
        break;
      case "comptime":
        visit(e.expr, b);
        break;
      case "runtime":
        visit(e.expr, b);
        break;
      case "assert":
        visit(e.expr, b);
        visit(e.constraint, b);
        break;
      case "assertCond":
        visit(e.condition, b);
        break;
      case "trust":
        visit(e.expr, b);
        if (e.constraint) visit(e.constraint, b);
        break;
      case "methodCall":
        visit(e.receiver, b);
        for (const a of e.args) visit(a, b);
        break;
      case "import": {
        const newBound = new Set(b);
        for (const name of e.names) newBound.add(name);
        visit(e.body, newBound);
        break;
      }
      case "typeOf":
        visit(e.expr, b);
        break;
    }
  }

  visit(expr, bound);
  return free;
}

/**
 * Convert a runtime value back to an expression for code generation.
 */
function exprFromValue(value: import("./value").Value): Expr {
  switch (value.tag) {
    case "number":
      return { tag: "lit", value: value.value };
    case "string":
      return { tag: "lit", value: value.value };
    case "bool":
      return { tag: "lit", value: value.value };
    case "null":
      return { tag: "lit", value: null };
    case "object": {
      const fields: { name: string; value: Expr }[] = [];
      for (const [name, val] of value.fields) {
        fields.push({ name, value: exprFromValue(val) });
      }
      return { tag: "obj", fields };
    }
    case "array":
      return { tag: "array", elements: value.elements.map(exprFromValue) };
    case "closure":
      // Use closureToResidual to properly stage the function body
      // This enables compile-time evaluation of expressions inside the function
      // that don't depend on runtime parameters
      return closureToResidual(value);
    case "type":
      // Types are meta-level values that don't have a runtime representation
      // They're only used at compile time, so this shouldn't normally be called
      throw new Error("Cannot convert type value to expression");
    case "builtin":
      // Builtins are referenced by their name
      return { tag: "var", name: value.name };
  }
}
