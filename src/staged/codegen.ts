/**
 * Convert JsExpr to JavaScript source code string.
 */

import { JsExpr } from "./jsexpr";

/**
 * Convert a JsExpr to JavaScript source code.
 */
export function exprToJs(expr: JsExpr): string {
  switch (expr.tag) {
    case "literal":
      return JSON.stringify(expr.value);

    case "param":
      return expr.name;

    case "binary":
      return `(${exprToJs(expr.left)} ${expr.op} ${exprToJs(expr.right)})`;

    case "conditional":
      return `(${exprToJs(expr.condition)} ? ${exprToJs(expr.thenExpr)} : ${exprToJs(expr.elseExpr)})`;

    case "field":
      return `${exprToJs(expr.object)}.${expr.field}`;

    case "object": {
      const fields = expr.fields.map((f) => `${f.name}: ${exprToJs(f.value)}`);
      return `{ ${fields.join(", ")} }`;
    }

    case "call": {
      const args = expr.args.map(exprToJs).join(", ");
      return `${expr.func}(${args})`;
    }
  }
}

/**
 * Generate a complete function definition.
 */
export function generateFunction(name: string, params: string[], body: JsExpr): string {
  const paramList = params.join(", ");
  return `function ${name}(${paramList}) {\n  return ${exprToJs(body)};\n}`;
}
