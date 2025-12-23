/**
 * Expression AST for the interpreter.
 * Simple, focused on core language constructs.
 */

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
  | FnExpr
  | CallExpr
  | ObjExpr
  | FieldExpr
  | ArrayExpr
  | IndexExpr
  | BlockExpr
  | ComptimeExpr
  | RuntimeExpr;

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

export interface FnExpr {
  tag: "fn";
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

export const fn = (params: string[], body: Expr): FnExpr =>
  ({ tag: "fn", params, body });

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

    case "fn":
      return `fn(${expr.params.join(", ")}) => ${exprToString(expr.body)}`;

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
  }
}
