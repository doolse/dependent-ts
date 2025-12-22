/**
 * JavaScript expression AST for generated code.
 * Based on docs/staged-architecture.md Part 7.1
 */

export type JsExpr =
  | JsLiteral
  | JsParam
  | JsBinaryOp
  | JsConditional
  | JsFieldAccess
  | JsObject
  | JsCall;

export interface JsLiteral {
  tag: "literal";
  value: unknown;
}

export interface JsParam {
  tag: "param";
  name: string;
}

export interface JsBinaryOp {
  tag: "binary";
  op: string;
  left: JsExpr;
  right: JsExpr;
}

export interface JsConditional {
  tag: "conditional";
  condition: JsExpr;
  thenExpr: JsExpr;
  elseExpr: JsExpr;
}

export interface JsFieldAccess {
  tag: "field";
  object: JsExpr;
  field: string;
}

export interface JsObject {
  tag: "object";
  fields: { name: string; value: JsExpr }[];
}

export interface JsCall {
  tag: "call";
  func: string;
  args: JsExpr[];
}

// Constructors
export const jsLit = (value: unknown): JsLiteral => ({ tag: "literal", value });

export const jsParam = (name: string): JsParam => ({ tag: "param", name });

export const jsBinOp = (op: string, left: JsExpr, right: JsExpr): JsBinaryOp => ({
  tag: "binary",
  op,
  left,
  right,
});

export const jsCond = (condition: JsExpr, thenExpr: JsExpr, elseExpr: JsExpr): JsConditional => ({
  tag: "conditional",
  condition,
  thenExpr,
  elseExpr,
});

export const jsField = (object: JsExpr, field: string): JsFieldAccess => ({
  tag: "field",
  object,
  field,
});

export const jsObj = (fields: { name: string; value: JsExpr }[]): JsObject => ({
  tag: "object",
  fields,
});

export const jsCall = (func: string, ...args: JsExpr[]): JsCall => ({
  tag: "call",
  func,
  args,
});
