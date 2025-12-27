/**
 * JavaScript AST Types
 *
 * An intermediate representation for JavaScript code generation.
 * The backend generates this AST, and the printer converts it to strings.
 *
 * This separation allows:
 * - Backend to focus on structure and semantics
 * - Printer to focus on formatting
 * - Easy testing of AST output
 * - Future backends to reuse the same AST
 */

// ============================================================================
// Expressions
// ============================================================================

export type JSExpr =
  | JSLit
  | JSVar
  | JSBinop
  | JSUnary
  | JSCall
  | JSMethod
  | JSArrow
  | JSNamedFunction
  | JSTernary
  | JSMember
  | JSIndex
  | JSObject
  | JSArray
  | JSIIFE;

/** Literal value: number, string, boolean, or null */
export interface JSLit {
  tag: "jsLit";
  value: number | string | boolean | null;
}

/** Variable reference */
export interface JSVar {
  tag: "jsVar";
  name: string;
}

/** Binary operation: left op right */
export interface JSBinop {
  tag: "jsBinop";
  op: string;
  left: JSExpr;
  right: JSExpr;
}

/** Unary operation: op operand */
export interface JSUnary {
  tag: "jsUnary";
  op: string;
  operand: JSExpr;
}

/** Function call: func(args) */
export interface JSCall {
  tag: "jsCall";
  func: JSExpr;
  args: JSExpr[];
}

/** Method call: obj.method(args) */
export interface JSMethod {
  tag: "jsMethod";
  obj: JSExpr;
  method: string;
  args: JSExpr[];
}

/** Arrow function: (params) => body */
export interface JSArrow {
  tag: "jsArrow";
  params: string[];
  body: JSExpr | JSStmt[];
}

/** Named function expression: function name(params) { body } */
export interface JSNamedFunction {
  tag: "jsNamedFunction";
  name: string;
  params: string[];
  body: JSExpr | JSStmt[];
}

/** Ternary expression: cond ? then : else */
export interface JSTernary {
  tag: "jsTernary";
  cond: JSExpr;
  then: JSExpr;
  else: JSExpr;
}

/** Member access: obj.prop */
export interface JSMember {
  tag: "jsMember";
  obj: JSExpr;
  prop: string;
}

/** Index access: arr[idx] */
export interface JSIndex {
  tag: "jsIndex";
  arr: JSExpr;
  idx: JSExpr;
}

/** Object literal: { key: value, ... } */
export interface JSObject {
  tag: "jsObject";
  fields: { key: string; value: JSExpr }[];
}

/** Array literal: [elements] */
export interface JSArray {
  tag: "jsArray";
  elements: JSExpr[];
}

/** Immediately invoked function expression: (() => { body })() */
export interface JSIIFE {
  tag: "jsIIFE";
  body: JSStmt[];
}

// ============================================================================
// Patterns (for destructuring)
// ============================================================================

export type JSPattern =
  | JSVarPattern
  | JSArrayPattern
  | JSObjectPattern;

export interface JSVarPattern {
  tag: "jsVarPattern";
  name: string;
}

export interface JSArrayPattern {
  tag: "jsArrayPattern";
  elements: JSPattern[];
}

export interface JSObjectPattern {
  tag: "jsObjectPattern";
  fields: { key: string; pattern: JSPattern }[];
}

/** Const declaration with pattern: const pattern = value; */
export interface JSConstPattern {
  tag: "jsConstPattern";
  pattern: JSPattern;
  value: JSExpr;
}

// ============================================================================
// Statements
// ============================================================================

export type JSStmt =
  | JSConst
  | JSLet
  | JSReturn
  | JSIfStmt
  | JSForOf
  | JSExprStmt
  | JSContinue
  | JSBreak
  | JSConstPattern;

/** Const declaration: const name = value; */
export interface JSConst {
  tag: "jsConst";
  name: string;
  value: JSExpr;
}

/** Let declaration: let name = value; */
export interface JSLet {
  tag: "jsLet";
  name: string;
  value: JSExpr;
}

/** Return statement: return value; */
export interface JSReturn {
  tag: "jsReturn";
  value: JSExpr;
}

/** If statement: if (cond) { then } else { else } */
export interface JSIfStmt {
  tag: "jsIf";
  cond: JSExpr;
  then: JSStmt[];
  else?: JSStmt[];
}

/** For-of loop: for (const item of iter) { body } */
export interface JSForOf {
  tag: "jsForOf";
  item: string;
  iter: JSExpr;
  body: JSStmt[];
}

/** Expression statement: expr; */
export interface JSExprStmt {
  tag: "jsExpr";
  expr: JSExpr;
}

/** Continue statement */
export interface JSContinue {
  tag: "jsContinue";
}

/** Break statement */
export interface JSBreak {
  tag: "jsBreak";
}

// ============================================================================
// Constructors
// ============================================================================

export const jsLit = (value: number | string | boolean | null): JSLit => ({
  tag: "jsLit",
  value,
});

export const jsVar = (name: string): JSVar => ({
  tag: "jsVar",
  name,
});

export const jsBinop = (op: string, left: JSExpr, right: JSExpr): JSBinop => ({
  tag: "jsBinop",
  op,
  left,
  right,
});

export const jsUnary = (op: string, operand: JSExpr): JSUnary => ({
  tag: "jsUnary",
  op,
  operand,
});

export const jsCall = (func: JSExpr, args: JSExpr[]): JSCall => ({
  tag: "jsCall",
  func,
  args,
});

export const jsMethod = (obj: JSExpr, method: string, args: JSExpr[]): JSMethod => ({
  tag: "jsMethod",
  obj,
  method,
  args,
});

export const jsArrow = (params: string[], body: JSExpr | JSStmt[]): JSArrow => ({
  tag: "jsArrow",
  params,
  body,
});

export const jsNamedFunction = (name: string, params: string[], body: JSExpr | JSStmt[]): JSNamedFunction => ({
  tag: "jsNamedFunction",
  name,
  params,
  body,
});

export const jsTernary = (cond: JSExpr, thenExpr: JSExpr, elseExpr: JSExpr): JSTernary => ({
  tag: "jsTernary",
  cond,
  then: thenExpr,
  else: elseExpr,
});

export const jsMember = (obj: JSExpr, prop: string): JSMember => ({
  tag: "jsMember",
  obj,
  prop,
});

export const jsIndex = (arr: JSExpr, idx: JSExpr): JSIndex => ({
  tag: "jsIndex",
  arr,
  idx,
});

export const jsObject = (fields: { key: string; value: JSExpr }[]): JSObject => ({
  tag: "jsObject",
  fields,
});

export const jsArray = (elements: JSExpr[]): JSArray => ({
  tag: "jsArray",
  elements,
});

export const jsIIFE = (body: JSStmt[]): JSIIFE => ({
  tag: "jsIIFE",
  body,
});

export const jsConst = (name: string, value: JSExpr): JSConst => ({
  tag: "jsConst",
  name,
  value,
});

export const jsLet = (name: string, value: JSExpr): JSLet => ({
  tag: "jsLet",
  name,
  value,
});

export const jsReturn = (value: JSExpr): JSReturn => ({
  tag: "jsReturn",
  value,
});

export const jsIf = (cond: JSExpr, thenStmts: JSStmt[], elseStmts?: JSStmt[]): JSIfStmt => ({
  tag: "jsIf",
  cond,
  then: thenStmts,
  else: elseStmts,
});

export const jsForOf = (item: string, iter: JSExpr, body: JSStmt[]): JSForOf => ({
  tag: "jsForOf",
  item,
  iter,
  body,
});

export const jsExpr = (expr: JSExpr): JSExprStmt => ({
  tag: "jsExpr",
  expr,
});

export const jsContinue: JSContinue = { tag: "jsContinue" };

export const jsBreak: JSBreak = { tag: "jsBreak" };

// Pattern constructors
export const jsVarPattern = (name: string): JSVarPattern => ({
  tag: "jsVarPattern",
  name,
});

export const jsArrayPattern = (elements: JSPattern[]): JSArrayPattern => ({
  tag: "jsArrayPattern",
  elements,
});

export const jsObjectPattern = (fields: { key: string; pattern: JSPattern }[]): JSObjectPattern => ({
  tag: "jsObjectPattern",
  fields,
});

export const jsConstPattern = (pattern: JSPattern, value: JSExpr): JSConstPattern => ({
  tag: "jsConstPattern",
  pattern,
  value,
});
