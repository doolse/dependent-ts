/**
 * JavaScript Code Generator
 *
 * Converts expressions (typically residual expressions from staged evaluation)
 * into JavaScript code strings that can be executed.
 */

import { Expr } from "./expr";

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

  const params = expr.params.join(", ");
  const body = genExpr(expr.body, opts, 1);

  return `function ${name}(${params}) {\n${opts.indent}return ${body};\n}`;
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
  const safeName = genIdentifier(name);
  const valueCode = genExpr(value, opts, depth + 1);
  const bodyCode = genExpr(body, opts, depth + 1);

  // Use IIFE to create proper scoping
  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);

  return `(() => {
${innerIndent}const ${safeName} = ${valueCode};
${innerIndent}return ${bodyCode};
${indent}})()`;
}

// ============================================================================
// Function Generation
// ============================================================================

function genFunction(
  params: string[],
  body: Expr,
  opts: Required<CodeGenOptions>,
  depth: number
): string {
  const safeParams = params.map(genIdentifier).join(", ");
  const bodyCode = genExpr(body, opts, depth);

  // Use arrow function syntax
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
  const safeName = genIdentifier(name);
  const safeParams = params.map(genIdentifier).join(", ");
  const bodyCode = genExpr(body, opts, depth);

  // Use named function expression for recursion
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
  const recvCode = genExpr(receiver, opts, depth);
  const argsCode = args.map(arg => genExpr(arg, opts, depth)).join(", ");

  // Wrap complex receiver expressions in parentheses
  const needsWrap = receiver.tag === "binop" || receiver.tag === "unary" ||
                    receiver.tag === "if" || receiver.tag === "let";
  const recvWrapped = needsWrap ? `(${recvCode})` : recvCode;

  return `${recvWrapped}.${method}(${argsCode})`;
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
// Compilation Pipeline
// ============================================================================

import { stage } from "./staged-evaluate";
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

  // Generate code from residual (sv is Later)
  return generateJS(sv.residual, options);
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
    case "closure": {
      // Convert closure back to expression by wrapping captured variables in let bindings
      const funcExpr: Expr = { tag: "fn", params: value.params, body: value.body };

      // Find free variables in the body that need to be captured
      const paramSet = new Set(value.params);
      const freeInBody = freeVars(value.body, paramSet);

      // Build let bindings for captured variables from the closure's environment
      let result: Expr = funcExpr;
      for (const varName of freeInBody) {
        if (value.env.has(varName)) {
          const binding = value.env.get(varName);
          const valueExpr = exprFromValue(binding.value);
          result = { tag: "let", name: varName, value: valueExpr, body: result };
        }
      }

      return result;
    }
    case "type":
      // Types are meta-level values that don't have a runtime representation
      // They're only used at compile time, so this shouldn't normally be called
      throw new Error("Cannot convert type value to expression");
  }
}
