export type Expr =
  | PrimitiveExpr
  | PrimitiveNameExpr
  | ApplicationExpr
  | ObjectExpr
  | LetExpr
  | SymbolExpr;

export interface PrimitiveExpr {
  tag: "prim";
  value: string | number | boolean;
}

export interface PrimitiveNameExpr {
  tag: "primType";
  name: "string" | "number" | "boolean" | "any" | "untyped";
}

export interface LetExpr {
  tag: "let";
  symbol: string;
  expr: Expr;
  in: Expr;
}

export interface SymbolExpr {
  tag: "symbol";
  symbol: string;
}

export interface ApplicationExpr {
  tag: "apply";
  function: Expr;
  args: Expr;
}

export interface ObjectExpr {
  tag: "object";
  entries: KeyValueExpr[];
}

export interface KeyValueExpr {
  key: Expr;
  value: Expr;
}

export function applyRef(name: string, ...args: Expr[]): ApplicationExpr {
  return {
    tag: "apply",
    args: arrayExpr(...args),
    function: ref(name),
  };
}

export function applyObj(
  name: string,
  ...args: [Expr, Expr][]
): ApplicationExpr {
  return {
    tag: "apply",
    args: {
      tag: "object",
      entries: args.map(([key, value]) => ({
        tag: "keyvalue",
        key,
        value,
      })),
    },
    function: ref(name),
  };
}

export function arrayExpr(...entries: Expr[]): ObjectExpr {
  return {
    tag: "object",
    entries: entries.map((value, i) => ({
      tag: "keyvalue",
      key: cnst(i),
      value,
    })),
  };
}

export function objectExpr(entries: { [key: string]: Expr }): ObjectExpr {
  return {
    tag: "object",
    entries: Object.entries(entries).map(([key, value]) => ({
      tag: "keyvalue",
      key: cnst(key),
      value,
    })),
  };
}

export function ref(symbol: string): SymbolExpr {
  return { tag: "symbol", symbol };
}

export function cnst(value: any): PrimitiveExpr {
  return { tag: "prim", value };
}

export function letExpr(symbol: string, expr: Expr, inn: Expr): LetExpr {
  return {
    tag: "let",
    symbol,
    expr,
    in: inn,
  };
}

export function primTypeExpr(
  name: "string" | "number" | "boolean" | "any" | "untyped"
): PrimitiveNameExpr {
  return { tag: "primType", name };
}
