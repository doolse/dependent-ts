/**
 * Expression AST for the interpreter.
 * Simple, focused on core language constructs.
 */

// ============================================================================
// Pattern Types (for destructuring)
// ============================================================================

/**
 * Patterns for destructuring in let expressions.
 */
export type Pattern =
  | VarPattern
  | ArrayPattern
  | ObjectPattern;

/**
 * Simple variable pattern: let x = ...
 */
export interface VarPattern {
  tag: "varPattern";
  name: string;
}

/**
 * Array destructuring pattern: let [a, b] = ...
 */
export interface ArrayPattern {
  tag: "arrayPattern";
  elements: Pattern[];
}

/**
 * Object destructuring pattern: let { x, y } = ...
 */
export interface ObjectPattern {
  tag: "objectPattern";
  fields: { key: string; pattern: Pattern }[];
}

// Pattern constructors
export const varPattern = (name: string): VarPattern => ({ tag: "varPattern", name });
export const arrayPattern = (...elements: Pattern[]): ArrayPattern => ({ tag: "arrayPattern", elements });
export const objectPattern = (fields: { key: string; pattern: Pattern }[]): ObjectPattern =>
  ({ tag: "objectPattern", fields });

/**
 * Convert a pattern to a string for pretty printing.
 */
export function patternToString(pattern: Pattern): string {
  switch (pattern.tag) {
    case "varPattern":
      return pattern.name;
    case "arrayPattern":
      return `[${pattern.elements.map(patternToString).join(", ")}]`;
    case "objectPattern":
      return `{ ${pattern.fields.map(f =>
        f.key === (f.pattern.tag === "varPattern" ? f.pattern.name : "")
          ? f.key
          : `${f.key}: ${patternToString(f.pattern)}`
      ).join(", ")} }`;
  }
}

/**
 * Extract all variable names from a pattern.
 */
export function patternVars(pattern: Pattern): string[] {
  switch (pattern.tag) {
    case "varPattern":
      return [pattern.name];
    case "arrayPattern":
      return pattern.elements.flatMap(patternVars);
    case "objectPattern":
      return pattern.fields.flatMap(f => patternVars(f.pattern));
  }
}

// ============================================================================
// Expression Types
// ============================================================================

export type Expr =
  | LitExpr
  | VarExpr
  | BinOpExpr
  | UnaryOpExpr
  | IfExpr
  | LetExpr
  | LetPatternExpr
  | FnExpr
  | RecFnExpr
  | CallExpr
  | ObjExpr
  | FieldExpr
  | ArrayExpr
  | IndexExpr
  | BlockExpr
  | ComptimeExpr
  | RuntimeExpr
  | AssertExpr
  | AssertCondExpr
  | TrustExpr
  | MethodCallExpr
  | ImportExpr
  | TypeOfExpr;

export interface LitExpr {
  tag: "lit";
  value: number | string | boolean | null;
}

export interface VarExpr {
  tag: "var";
  name: string;
}

export interface BinOpExpr {
  tag: "binop";
  op: BinOp;
  left: Expr;
  right: Expr;
}

export type BinOp =
  // Arithmetic
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  // Comparison
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  // Logical
  | "&&"
  | "||";

export interface UnaryOpExpr {
  tag: "unary";
  op: UnaryOp;
  operand: Expr;
}

export type UnaryOp = "-" | "!";

export interface IfExpr {
  tag: "if";
  cond: Expr;
  then: Expr;
  else: Expr;
}

export interface LetExpr {
  tag: "let";
  name: string;
  value: Expr;
  body: Expr;
}

/**
 * Let expression with pattern destructuring.
 * Allows: let [a, b] = expr in body
 *         let { x, y } = expr in body
 */
export interface LetPatternExpr {
  tag: "letPattern";
  pattern: Pattern;
  value: Expr;
  body: Expr;
}

export interface FnExpr {
  tag: "fn";
  params: string[];
  body: Expr;
}

/**
 * Named recursive function.
 * The function can call itself by name within the body.
 */
export interface RecFnExpr {
  tag: "recfn";
  name: string;
  params: string[];
  body: Expr;
}

export interface CallExpr {
  tag: "call";
  func: Expr;
  args: Expr[];
}

export interface ObjExpr {
  tag: "obj";
  fields: { name: string; value: Expr }[];
}

export interface FieldExpr {
  tag: "field";
  object: Expr;
  name: string;
}

export interface ArrayExpr {
  tag: "array";
  elements: Expr[];
}

export interface IndexExpr {
  tag: "index";
  array: Expr;
  index: Expr;
}

export interface BlockExpr {
  tag: "block";
  exprs: Expr[];  // Last expression is the result
}

/**
 * Force compile-time evaluation.
 * Errors if the inner expression is not fully known at compile time.
 */
export interface ComptimeExpr {
  tag: "comptime";
  expr: Expr;
}

/**
 * Mark an expression as runtime-only.
 * The value won't be computed at compile time, only its type/constraint is tracked.
 * Useful for simulating function parameters and external inputs.
 */
export interface RuntimeExpr {
  tag: "runtime";
  expr: Expr;           // Expression that defines the constraint
  name?: string;        // Optional name for the residual variable
}

/**
 * Runtime assertion that a value satisfies a constraint.
 * Inserts a runtime check; after the assertion, the compiler knows the constraint holds.
 */
export interface AssertExpr {
  tag: "assert";
  expr: Expr;           // The value to check
  constraint: Expr;     // The constraint to check (evaluates to a Type value)
  message?: string;     // Optional error message
}

/**
 * Trust that a value satisfies a constraint without runtime checking.
 * Escape hatch for when the programmer knows better than the type system.
 * Use with caution - no runtime check is inserted.
 * If constraint is omitted, the value is trusted without any specific constraint.
 */
export interface TrustExpr {
  tag: "trust";
  expr: Expr;           // The value to trust
  constraint?: Expr;    // Optional: The constraint to trust (evaluates to a Type value)
}

/**
 * Assert a boolean condition at runtime.
 * Throws AssertionError if condition is false.
 * Returns true if the condition passes.
 */
export interface AssertCondExpr {
  tag: "assertCond";
  condition: Expr;      // The condition to check (must be boolean)
  message?: string;     // Optional error message
}

/**
 * Method call on a receiver.
 * Represents `receiver.method(args)` syntax for built-in methods on primitives.
 * Examples: str.startsWith("foo"), arr.includes(x), str.toUpperCase()
 */
export interface MethodCallExpr {
  tag: "methodCall";
  receiver: Expr;       // The object/value to call the method on
  method: string;       // The method name
  args: Expr[];         // Method arguments (not including receiver)
}

/**
 * Import expression for loading external TypeScript declarations.
 * Syntax: import { name1, name2 } from "module"
 *
 * This binds the imported names in the body expression.
 * Imported values become Later (runtime) with constraints from .d.ts files.
 */
export interface ImportExpr {
  tag: "import";
  names: string[];      // Names to import (e.g., ["useState", "useEffect"])
  modulePath: string;   // Module path (e.g., "react")
  body: Expr;           // Expression where imports are in scope
}

/**
 * Get the type (constraint) of an expression as a Type value.
 * Syntax: typeOf(expr)
 *
 * Returns the constraint of the expression wrapped as a TypeValue.
 * Useful for explicit same-type enforcement:
 *   let pair = fn(x, y) => let _ = assert(y, typeOf(x)) in [x, y]
 *
 * When expr is Later, returns `any` (the constraint is unknown at compile time).
 */
export interface TypeOfExpr {
  tag: "typeOf";
  expr: Expr;           // The expression to get the type of
}

// ============================================================================
// Constructors
// ============================================================================

export const lit = (value: number | string | boolean | null): LitExpr =>
  ({ tag: "lit", value });

export const num = (value: number): LitExpr => lit(value);
export const str = (value: string): LitExpr => lit(value);
export const bool = (value: boolean): LitExpr => lit(value);
export const nil: LitExpr = lit(null);

export const varRef = (name: string): VarExpr => ({ tag: "var", name });

export const binop = (op: BinOp, left: Expr, right: Expr): BinOpExpr =>
  ({ tag: "binop", op, left, right });

// Arithmetic shortcuts
export const add = (left: Expr, right: Expr) => binop("+", left, right);
export const sub = (left: Expr, right: Expr) => binop("-", left, right);
export const mul = (left: Expr, right: Expr) => binop("*", left, right);
export const div = (left: Expr, right: Expr) => binop("/", left, right);
export const mod = (left: Expr, right: Expr) => binop("%", left, right);

// Comparison shortcuts
export const eq = (left: Expr, right: Expr) => binop("==", left, right);
export const neq = (left: Expr, right: Expr) => binop("!=", left, right);
export const ltExpr = (left: Expr, right: Expr) => binop("<", left, right);
export const gtExpr = (left: Expr, right: Expr) => binop(">", left, right);
export const lteExpr = (left: Expr, right: Expr) => binop("<=", left, right);
export const gteExpr = (left: Expr, right: Expr) => binop(">=", left, right);

// Logical shortcuts
export const andExpr = (left: Expr, right: Expr) => binop("&&", left, right);
export const orExpr = (left: Expr, right: Expr) => binop("||", left, right);

export const unary = (op: UnaryOp, operand: Expr): UnaryOpExpr =>
  ({ tag: "unary", op, operand });

export const neg = (operand: Expr) => unary("-", operand);
export const notExpr = (operand: Expr) => unary("!", operand);

export const ifExpr = (cond: Expr, then: Expr, els: Expr): IfExpr =>
  ({ tag: "if", cond, then, else: els });

export const letExpr = (name: string, value: Expr, body: Expr): LetExpr =>
  ({ tag: "let", name, value, body });

export const letPatternExpr = (pattern: Pattern, value: Expr, body: Expr): LetPatternExpr =>
  ({ tag: "letPattern", pattern, value, body });

export const fn = (params: string[], body: Expr): FnExpr =>
  ({ tag: "fn", params, body });

export const recfn = (name: string, params: string[], body: Expr): RecFnExpr =>
  ({ tag: "recfn", name, params, body });

export const call = (func: Expr, ...args: Expr[]): CallExpr =>
  ({ tag: "call", func, args });

export const obj = (fields: Record<string, Expr>): ObjExpr => ({
  tag: "obj",
  fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
});

export const field = (object: Expr, name: string): FieldExpr =>
  ({ tag: "field", object, name });

export const array = (...elements: Expr[]): ArrayExpr =>
  ({ tag: "array", elements });

export const index = (arr: Expr, idx: Expr): IndexExpr =>
  ({ tag: "index", array: arr, index: idx });

export const block = (...exprs: Expr[]): BlockExpr =>
  ({ tag: "block", exprs });

export const comptime = (expr: Expr): ComptimeExpr =>
  ({ tag: "comptime", expr });

export const runtime = (expr: Expr, name?: string): RuntimeExpr =>
  ({ tag: "runtime", expr, name });

export const assertExpr = (expr: Expr, constraint: Expr, message?: string): AssertExpr =>
  ({ tag: "assert", expr, constraint, message });

export const assertCondExpr = (condition: Expr, message?: string): AssertCondExpr =>
  ({ tag: "assertCond", condition, message });

export const trustExpr = (expr: Expr, constraint?: Expr): TrustExpr =>
  ({ tag: "trust", expr, constraint });

export const methodCall = (receiver: Expr, method: string, args: Expr[]): MethodCallExpr =>
  ({ tag: "methodCall", receiver, method, args });

export const importExpr = (names: string[], modulePath: string, body: Expr): ImportExpr =>
  ({ tag: "import", names, modulePath, body });

export const typeOfExpr = (expr: Expr): TypeOfExpr =>
  ({ tag: "typeOf", expr });

// ============================================================================
// Pretty Printing
// ============================================================================

export function exprToString(expr: Expr): string {
  switch (expr.tag) {
    case "lit":
      return JSON.stringify(expr.value);

    case "var":
      return expr.name;

    case "binop":
      return `(${exprToString(expr.left)} ${expr.op} ${exprToString(expr.right)})`;

    case "unary":
      return `${expr.op}${exprToString(expr.operand)}`;

    case "if":
      return `if ${exprToString(expr.cond)} then ${exprToString(expr.then)} else ${exprToString(expr.else)}`;

    case "let":
      return `let ${expr.name} = ${exprToString(expr.value)} in ${exprToString(expr.body)}`;

    case "letPattern":
      return `let ${patternToString(expr.pattern)} = ${exprToString(expr.value)} in ${exprToString(expr.body)}`;

    case "fn":
      return `fn(${expr.params.join(", ")}) => ${exprToString(expr.body)}`;

    case "recfn":
      return `fn ${expr.name}(${expr.params.join(", ")}) => ${exprToString(expr.body)}`;

    case "call":
      return `${exprToString(expr.func)}(${expr.args.map(exprToString).join(", ")})`;

    case "obj": {
      const fields = expr.fields.map(f => `${f.name}: ${exprToString(f.value)}`);
      return `{ ${fields.join(", ")} }`;
    }

    case "field":
      return `${exprToString(expr.object)}.${expr.name}`;

    case "array":
      return `[${expr.elements.map(exprToString).join(", ")}]`;

    case "index":
      return `${exprToString(expr.array)}[${exprToString(expr.index)}]`;

    case "block":
      return `{ ${expr.exprs.map(exprToString).join("; ")} }`;

    case "comptime":
      return `comptime(${exprToString(expr.expr)})`;

    case "runtime":
      return expr.name
        ? `runtime(${expr.name}: ${exprToString(expr.expr)})`
        : `runtime(${exprToString(expr.expr)})`;

    case "assert":
      return expr.message
        ? `assert(${exprToString(expr.expr)}, ${exprToString(expr.constraint)}, "${expr.message}")`
        : `assert(${exprToString(expr.expr)}, ${exprToString(expr.constraint)})`;

    case "assertCond":
      return expr.message
        ? `assert(${exprToString(expr.condition)}, "${expr.message}")`
        : `assert(${exprToString(expr.condition)})`;

    case "trust":
      return expr.constraint
        ? `trust(${exprToString(expr.expr)}, ${exprToString(expr.constraint)})`
        : `trust(${exprToString(expr.expr)})`;

    case "methodCall":
      return `${exprToString(expr.receiver)}.${expr.method}(${expr.args.map(exprToString).join(", ")})`;

    case "import":
      return `import { ${expr.names.join(", ")} } from "${expr.modulePath}" in ${exprToString(expr.body)}`;

    case "typeOf":
      return `typeOf(${exprToString(expr.expr)})`;
  }
}
