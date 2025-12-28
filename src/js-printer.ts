/**
 * JavaScript Pretty-Printer
 *
 * Converts JS AST to JavaScript source code strings.
 * This is purely mechanical formatting - no semantic decisions.
 */

import { JSExpr, JSStmt, JSPattern, JSModule, JSImportDecl, JSExportDefault } from "./js-ast";

// ============================================================================
// Options
// ============================================================================

export interface PrintOptions {
  /** Indentation string (default: "  ") */
  indent?: string;
}

const defaultOptions: Required<PrintOptions> = {
  indent: "  ",
};

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Print a JS expression to a string.
 */
export function printExpr(expr: JSExpr, options: PrintOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  return printJSExpr(expr, opts, 0);
}

/**
 * Print JS statements to a string.
 */
export function printStmts(stmts: JSStmt[], options: PrintOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  return stmts.map((s) => printJSStmt(s, opts, 0)).join("\n");
}

/**
 * Print an ES module to a string.
 */
export function printModule(mod: JSModule, options: PrintOptions = {}): string {
  const opts = { ...defaultOptions, ...options };

  const importStrs = mod.imports.map(printImportDecl);
  const stmtStrs = mod.statements.map(s => printJSStmt(s, opts, 0));
  const exportStr = printExportDefault(mod.export, opts);

  const parts: string[] = [];
  if (importStrs.length > 0) {
    parts.push(...importStrs);
    parts.push('');
  }
  if (stmtStrs.length > 0) {
    parts.push(...stmtStrs);
    parts.push('');
  }
  parts.push(exportStr);

  return parts.join('\n') + '\n';
}

function printImportDecl(decl: JSImportDecl): string {
  if (decl.isDefault) {
    return `import ${printIdentifier(decl.names[0])} from ${JSON.stringify(decl.modulePath)};`;
  }
  const names = decl.names.map(printIdentifier).join(', ');
  return `import { ${names} } from ${JSON.stringify(decl.modulePath)};`;
}

function printExportDefault(exp: JSExportDefault, opts: Required<PrintOptions>): string {
  return `export default ${printJSExpr(exp.value, opts, 0)};`;
}

// ============================================================================
// Expression Printing
// ============================================================================

function printJSExpr(expr: JSExpr, opts: Required<PrintOptions>, depth: number): string {
  switch (expr.tag) {
    case "jsLit":
      return printLiteral(expr.value);

    case "jsVar":
      return printIdentifier(expr.name);

    case "jsBinop":
      return printBinop(expr.op, expr.left, expr.right, opts, depth);

    case "jsUnary":
      return printUnary(expr.op, expr.operand, opts, depth);

    case "jsCall":
      return printCall(expr.func, expr.args, opts, depth);

    case "jsMethod":
      return printMethod(expr.obj, expr.method, expr.args, opts, depth);

    case "jsArrow":
      return printArrow(expr.params, expr.body, opts, depth);

    case "jsNamedFunction":
      return printNamedFunction(expr.name, expr.params, expr.body, opts, depth);

    case "jsTernary":
      return printTernary(expr.cond, expr.then, expr.else, opts, depth);

    case "jsMember":
      return printMember(expr.obj, expr.prop, opts, depth);

    case "jsIndex":
      return printIndex(expr.arr, expr.idx, opts, depth);

    case "jsObject":
      return printObject(expr.fields, opts, depth);

    case "jsArray":
      return printArray(expr.elements, opts, depth);

    case "jsIIFE":
      return printIIFE(expr.body, opts, depth);
  }
}

// ============================================================================
// Literals
// ============================================================================

function printLiteral(value: number | string | boolean | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
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
// Identifiers
// ============================================================================

const RESERVED_WORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "null", "true", "false"
]);

function printIdentifier(name: string): string {
  if (RESERVED_WORDS.has(name)) {
    return `_${name}`;
  }
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    return name;
  }
  return `_${name.replace(/[^a-zA-Z0-9_$]/g, "_")}`;
}

// ============================================================================
// Operators
// ============================================================================

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
  "!": 7, "-unary": 7,
};

function printBinop(
  op: string,
  left: JSExpr,
  right: JSExpr,
  opts: Required<PrintOptions>,
  depth: number
): string {
  const leftCode = printJSExpr(left, opts, depth);
  const rightCode = printJSExpr(right, opts, depth);

  const leftWrapped = needsParens(left, op, "left") ? `(${leftCode})` : leftCode;
  const rightWrapped = needsParens(right, op, "right") ? `(${rightCode})` : rightCode;

  return `${leftWrapped} ${op} ${rightWrapped}`;
}

function needsParens(expr: JSExpr, parentOp: string, side: "left" | "right"): boolean {
  if (expr.tag !== "jsBinop") return false;

  const childPrec = PRECEDENCE[expr.op] ?? 0;
  const parentPrec = PRECEDENCE[parentOp] ?? 0;

  if (childPrec < parentPrec) return true;
  if (childPrec === parentPrec && side === "right") return true;

  return false;
}

function printUnary(
  op: string,
  operand: JSExpr,
  opts: Required<PrintOptions>,
  depth: number
): string {
  const operandCode = printJSExpr(operand, opts, depth);
  const needsWrap = operand.tag === "jsBinop" || operand.tag === "jsUnary";
  const wrapped = needsWrap ? `(${operandCode})` : operandCode;
  return `${op}${wrapped}`;
}

// ============================================================================
// Calls and Methods
// ============================================================================

function printCall(
  func: JSExpr,
  args: JSExpr[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  const funcCode = printJSExpr(func, opts, depth);
  const argsCode = args.map((a) => printJSExpr(a, opts, depth)).join(", ");

  // Wrap arrow functions in parens when called immediately
  const funcWrapped = func.tag === "jsArrow" ? `(${funcCode})` : funcCode;

  return `${funcWrapped}(${argsCode})`;
}

function printMethod(
  obj: JSExpr,
  method: string,
  args: JSExpr[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  const objCode = printJSExpr(obj, opts, depth);
  const argsCode = args.map((a) => printJSExpr(a, opts, depth)).join(", ");

  // Wrap complex receiver expressions
  const needsWrap = obj.tag === "jsBinop" || obj.tag === "jsUnary" ||
                    obj.tag === "jsTernary" || obj.tag === "jsArrow";
  const objWrapped = needsWrap ? `(${objCode})` : objCode;

  return `${objWrapped}.${method}(${argsCode})`;
}

// ============================================================================
// Functions
// ============================================================================

function printArrow(
  params: string[],
  body: JSExpr | JSStmt[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  const paramsCode = params.map(printIdentifier).join(", ");

  if (Array.isArray(body)) {
    // Statement body
    const bodyCode = body.map((s) => printJSStmt(s, opts, depth + 1)).join("\n");
    const indent = opts.indent.repeat(depth);
    return `(${paramsCode}) => {\n${bodyCode}\n${indent}}`;
  }

  // Expression body
  const bodyCode = printJSExpr(body, opts, depth);
  return `(${paramsCode}) => ${bodyCode}`;
}

function printNamedFunction(
  name: string,
  params: string[],
  body: JSExpr | JSStmt[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  const safeName = printIdentifier(name);
  const paramsCode = params.map(printIdentifier).join(", ");

  if (Array.isArray(body)) {
    // Statement body
    const bodyCode = body.map((s) => printJSStmt(s, opts, depth + 1)).join("\n");
    const indent = opts.indent.repeat(depth);
    return `function ${safeName}(${paramsCode}) {\n${bodyCode}\n${indent}}`;
  }

  // Expression body - wrap in return statement
  const bodyCode = printJSExpr(body, opts, depth);
  return `function ${safeName}(${paramsCode}) { return ${bodyCode}; }`;
}

// ============================================================================
// Ternary
// ============================================================================

function printTernary(
  cond: JSExpr,
  thenExpr: JSExpr,
  elseExpr: JSExpr,
  opts: Required<PrintOptions>,
  depth: number
): string {
  const condCode = printJSExpr(cond, opts, depth);
  const thenCode = printJSExpr(thenExpr, opts, depth);
  const elseCode = printJSExpr(elseExpr, opts, depth);

  // Wrap low-precedence conditions
  const condWrapped = cond.tag === "jsBinop" && (PRECEDENCE[cond.op] ?? 0) <= 1
    ? `(${condCode})`
    : condCode;

  return `${condWrapped} ? ${thenCode} : ${elseCode}`;
}

// ============================================================================
// Member and Index Access
// ============================================================================

function printMember(
  obj: JSExpr,
  prop: string,
  opts: Required<PrintOptions>,
  depth: number
): string {
  const objCode = printJSExpr(obj, opts, depth);

  const needsWrap = obj.tag === "jsBinop" || obj.tag === "jsUnary" ||
                    obj.tag === "jsTernary" || obj.tag === "jsArrow";
  const objWrapped = needsWrap ? `(${objCode})` : objCode;

  if (isValidPropertyName(prop)) {
    return `${objWrapped}.${prop}`;
  }
  return `${objWrapped}[${JSON.stringify(prop)}]`;
}

function printIndex(
  arr: JSExpr,
  idx: JSExpr,
  opts: Required<PrintOptions>,
  depth: number
): string {
  const arrCode = printJSExpr(arr, opts, depth);
  const idxCode = printJSExpr(idx, opts, depth);

  const needsWrap = arr.tag === "jsBinop" || arr.tag === "jsUnary" ||
                    arr.tag === "jsTernary" || arr.tag === "jsArrow";
  const arrWrapped = needsWrap ? `(${arrCode})` : arrCode;

  return `${arrWrapped}[${idxCode}]`;
}

function isValidPropertyName(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !RESERVED_WORDS.has(name);
}

// ============================================================================
// Objects and Arrays
// ============================================================================

function printObject(
  fields: { key: string; value: JSExpr }[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  if (fields.length === 0) {
    return "{}";
  }

  const fieldStrs = fields.map(({ key, value }) => {
    const valueCode = printJSExpr(value, opts, depth);
    // Shorthand if value is a variable with the same name
    if (value.tag === "jsVar" && value.name === key) {
      return printIdentifier(key);
    }
    const safeName = isValidPropertyName(key) ? key : JSON.stringify(key);
    return `${safeName}: ${valueCode}`;
  });

  const singleLine = `{ ${fieldStrs.join(", ")} }`;
  if (singleLine.length <= 60) {
    return singleLine;
  }

  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  return `{\n${innerIndent}${fieldStrs.join(`,\n${innerIndent}`)}\n${indent}}`;
}

function printArray(
  elements: JSExpr[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  if (elements.length === 0) {
    return "[]";
  }

  const elementStrs = elements.map((e) => printJSExpr(e, opts, depth));

  const singleLine = `[${elementStrs.join(", ")}]`;
  if (singleLine.length <= 60) {
    return singleLine;
  }

  const indent = opts.indent.repeat(depth);
  const innerIndent = opts.indent.repeat(depth + 1);
  return `[\n${innerIndent}${elementStrs.join(`,\n${innerIndent}`)}\n${indent}]`;
}

// ============================================================================
// IIFE
// ============================================================================

function printIIFE(
  body: JSStmt[],
  opts: Required<PrintOptions>,
  depth: number
): string {
  const bodyCode = body.map((s) => printJSStmt(s, opts, depth + 1)).join("\n");
  const indent = opts.indent.repeat(depth);
  return `(() => {\n${bodyCode}\n${indent}})()`;
}

// ============================================================================
// Statement Printing
// ============================================================================

function printJSStmt(stmt: JSStmt, opts: Required<PrintOptions>, depth: number): string {
  const indent = opts.indent.repeat(depth);

  switch (stmt.tag) {
    case "jsConst": {
      const valueCode = printJSExpr(stmt.value, opts, depth);
      return `${indent}const ${printIdentifier(stmt.name)} = ${valueCode};`;
    }

    case "jsConstPattern": {
      const patternCode = printPattern(stmt.pattern);
      const valueCode = printJSExpr(stmt.value, opts, depth);
      return `${indent}const ${patternCode} = ${valueCode};`;
    }

    case "jsLet": {
      const valueCode = printJSExpr(stmt.value, opts, depth);
      return `${indent}let ${printIdentifier(stmt.name)} = ${valueCode};`;
    }

    case "jsReturn": {
      const valueCode = printJSExpr(stmt.value, opts, depth);
      return `${indent}return ${valueCode};`;
    }

    case "jsIf": {
      const condCode = printJSExpr(stmt.cond, opts, depth);
      const thenCode = stmt.then.map((s) => printJSStmt(s, opts, depth + 1)).join("\n");

      if (stmt.else && stmt.else.length > 0) {
        const elseCode = stmt.else.map((s) => printJSStmt(s, opts, depth + 1)).join("\n");
        return `${indent}if (${condCode}) {\n${thenCode}\n${indent}} else {\n${elseCode}\n${indent}}`;
      }

      return `${indent}if (${condCode}) {\n${thenCode}\n${indent}}`;
    }

    case "jsForOf": {
      const iterCode = printJSExpr(stmt.iter, opts, depth);
      const bodyCode = stmt.body.map((s) => printJSStmt(s, opts, depth + 1)).join("\n");
      return `${indent}for (const ${printIdentifier(stmt.item)} of ${iterCode}) {\n${bodyCode}\n${indent}}`;
    }

    case "jsExpr": {
      const exprCode = printJSExpr(stmt.expr, opts, depth);
      return `${indent}${exprCode};`;
    }

    case "jsContinue":
      return `${indent}continue;`;

    case "jsBreak":
      return `${indent}break;`;
  }
}

// ============================================================================
// Pattern Printing
// ============================================================================

function printPattern(pattern: JSPattern): string {
  switch (pattern.tag) {
    case "jsVarPattern":
      return printIdentifier(pattern.name);

    case "jsArrayPattern":
      return `[${pattern.elements.map(printPattern).join(", ")}]`;

    case "jsObjectPattern":
      return `{ ${pattern.fields.map((f) => {
        const patStr = printPattern(f.pattern);
        if (f.pattern.tag === "jsVarPattern" && f.pattern.name === f.key) {
          return printIdentifier(f.key);
        }
        return `${printIdentifier(f.key)}: ${patStr}`;
      }).join(", ")} }`;
  }
}
