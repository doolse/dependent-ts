/**
 * JavaScript Code Generator
 *
 * Converts expressions (typically residual expressions from staged evaluation)
 * into JavaScript code strings that can be executed.
 *
 * Uses the new backend architecture:
 * 1. Stage the expression to get SValue
 * 2. Pass to backend to generate JS AST
 * 3. Print JS AST to string
 */

import { Expr, patternVars } from "./expr";
import { stage, stagingEvaluate, svalueToResidual, SEnv, closureToResidual } from "./staged-evaluate";
import { isNow, SValue } from "./svalue";
import { Backend, BackendContext } from "./backend";
import { JSBackend } from "./js-backend";
import { JSExpr } from "./js-ast";
import { printExpr } from "./js-printer";

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
// Compilation Pipeline
// ============================================================================

/**
 * Full compilation pipeline: stage + codegen.
 * Takes an expression, partially evaluates it, and generates JavaScript.
 */
export function compile(expr: Expr, options: CodeGenOptions = {}): string {
  const result = stage(expr);
  return compileFromSValue(result.svalue, options);
}

/**
 * Alias for compile() - stages the expression and generates JavaScript.
 */
export const generateJS = compile;

/**
 * Generate a complete JavaScript module with the expression as the default export.
 */
export function generateModule(expr: Expr, options: CodeGenOptions = {}): string {
  const code = compile(expr, options);
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
  if (expr.tag !== "fn") {
    throw new Error("generateFunction requires a function expression");
  }

  const code = compile(expr, options);

  // The backend generates arrow functions, convert to named function declaration
  const arrowMatch = code.match(/^\(([^)]*)\)\s*=>\s*(.*)$/s);
  if (arrowMatch) {
    const [, params, body] = arrowMatch;
    if (body.startsWith("{")) {
      return `function ${name}(${params}) ${body}`;
    }
    return `function ${name}(${params}) { return ${body}; }`;
  }

  // Fallback - wrap in assignment
  return `const ${name} = ${code};`;
}

/**
 * Compile from an already-staged value.
 */
export function compileFromSValue(sv: SValue, options: CodeGenOptions = {}): string {
  const backend = new JSBackend();
  const jsAst = generateWithBackend(sv, backend);
  return printExpr(jsAst, options.indent ? { indent: options.indent } : {});
}

/**
 * Generate JS AST using a backend.
 * This is the core of the new architecture - the backend has access
 * to staging machinery for on-demand evaluation.
 */
export function generateWithBackend(sv: SValue, backend: Backend): JSExpr {
  const emptyEnv = SEnv.empty();
  const ctx: BackendContext = {
    stage: (expr, env) => stagingEvaluate(expr, env ?? emptyEnv),
    env: emptyEnv,
    svalueToResidual,
    generate: (innerSv) => backend.generate(innerSv, ctx),
    generateExpr: (expr) => {
      const result = stagingEvaluate(expr, emptyEnv);
      return backend.generate(result.svalue, ctx);
    }
  };

  return backend.generate(sv, ctx);
}

// ============================================================================
// Module Generation with Imports
// ============================================================================

/**
 * Generate JavaScript with top-level imports.
 * This is for generating complete modules with proper ES imports.
 */
export function generateModuleWithImports(expr: Expr, options: CodeGenOptions = {}): string {
  const opts = { ...defaultOptions, ...options };

  // Collect all imports from the ORIGINAL expression (before staging)
  const imports = collectImports(expr);

  // Generate import statements
  const importStatements = Array.from(imports.entries())
    .map(([modulePath, names]) => {
      const importNames = Array.from(names).map(escapeIdentifier).join(", ");
      return `import { ${importNames} } from ${JSON.stringify(modulePath)};`;
    })
    .join("\n");

  // Stage the expression for partial evaluation
  const result = stage(expr);
  const sv = result.svalue;

  // Generate code from the staged value
  const code = compileFromSValue(sv, opts);

  if (importStatements) {
    return `${importStatements}\n\nexport default ${code};\n`;
  }
  return `export default ${code};\n`;
}

// ============================================================================
// Identifier Escaping
// ============================================================================

const RESERVED_WORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "await", "null", "true", "false"
]);

function escapeIdentifier(name: string): string {
  if (RESERVED_WORDS.has(name)) {
    return `_${name}`;
  }
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    return name;
  }
  return `_${name.replace(/[^a-zA-Z0-9_$]/g, "_")}`;
}

// ============================================================================
// Import Collection and Stripping
// ============================================================================

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

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Get free variables in an expression (variables not bound within the expression).
 */
export function freeVars(expr: Expr, bound: Set<string> = new Set()): Set<string> {
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
export function exprFromValue(value: import("./value").Value): Expr {
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
      return closureToResidual(value);
    case "type":
      throw new Error("Cannot convert type value to expression");
    case "builtin":
      return { tag: "var", name: value.name };
  }
}
