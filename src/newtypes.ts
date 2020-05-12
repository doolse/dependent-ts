import { Expr } from "./expr";

export type Type =
  | AnyType
  | UntypedType
  | NumberType
  | StringType
  | BoolType
  | ObjectType
  | FunctionType;

export interface AnyType {
  type: "any";
}

export interface UntypedType {
  type: "untyped";
}

export interface NumberType {
  type: "number";
}

export interface StringType {
  type: "string";
}

export interface BoolType {
  type: "boolean";
}

export interface ObjectType {
  type: "object";
}

export interface FunctionType {
  type: "function";
}

type FieldNode = {
  key: TypedNode;
  value: TypedNode;
};

const untyped: UntypedType = { type: "untyped" };

export type TypedNode = {
  type: Type;
  value?: any;
  expr?: Expr;
  define?: string;
  bindings?: TypedNode;
  fields?: FieldNode[];
  application?: [TypedNode, TypedNode];
};

export function exprToNode(expr: Expr): TypedNode {
  switch (expr.tag) {
    case "apply":
      return {
        type: untyped,
        application: [exprToNode(expr.function), exprToNode(expr.args)],
      };
    case "let":
      return {
        ...exprToNode(expr.in),
        bindings: { ...exprToNode(expr.expr), define: expr.symbol },
      };
    case "object":
      return {
        type: { type: "object" },
        fields: expr.entries.map((kv) => ({
          key: exprToNode(kv.key),
          value: exprToNode(kv.value),
        })),
      };
  }
  return { type: untyped, expr };
}
