import * as util from "util";
import {
  JSExpr,
  JSFunctionDef,
  newArg,
  func2string,
  JSStatement,
  emptyFunction,
  expr2string
} from "./javascript";

export type Expr =
  | PrimitiveExpr
  | PrimitiveNameExpr
  | ApplicationExpr
  | ObjectExpr
  | LetExpr
  | SymbolExpr
  | NativeExpr;

export interface PrimitiveExpr {
  tag: "prim";
  value: string | number | boolean;
}

export interface PrimitiveNameExpr {
  tag: "primType";
  name: "string" | "number" | "boolean" | "any";
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
  keyType: Expr;
  valueType: Expr;
}

export interface KeyValueExpr {
  key: Expr;
  value: Expr;
}

export interface NativeExpr {
  tag: "native";
  node(graph: NodeGraph, symbols: NodeRef): NodeRef;
}

export type NodeGraph = TypedNode[];

export function applyRef(name: string, ...args: Expr[]): ApplicationExpr {
  return {
    tag: "apply",
    args: arrayExpr(...args),
    function: ref(name)
  };
}

export function arrayExpr(...entries: Expr[]): ObjectExpr {
  return {
    tag: "object",
    keyType: { tag: "primType", name: "number" },
    valueType: { tag: "primType", name: "any" },
    entries: entries.map((value, i) => ({
      tag: "keyvalue",
      key: cnst(i),
      value
    }))
  };
}

export function objectExpr(entries: { [key: string]: Expr }): ObjectExpr {
  return {
    tag: "object",
    keyType: { tag: "primType", name: "string" },
    valueType: { tag: "primType", name: "any" },
    entries: Object.entries(entries).map(([key, value]) => ({
      tag: "keyvalue",
      key: cnst(key),
      value
    }))
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
    in: inn
  };
}

export type NodeRef = number;

export interface TypedNode {
  type: Type;
  annotation?: ObjectType;
  apply?: [NodeRef, NodeRef];
}

export interface NodeTuple {
  key: NodeRef;
  value: NodeRef;
}

export type Type =
  | AnyType
  | UntypedType
  | NumberType
  | StringType
  | BoolType
  | ObjectType
  | UnionType
  | FunctionType;

export interface AnyType {
  type: "any";
}

export interface UntypedType {
  type: "untyped";
}

export interface NumberType {
  type: "number";
  value?: number;
}

export interface StringType {
  type: "string";
  value?: string;
}

export interface BoolType {
  type: "boolean";
  value?: boolean;
}

export interface ObjectType {
  type: "object";
  keyType: NodeRef;
  valueType: NodeRef;
  keyValues: NodeTuple[];
}

export interface UnionType {
  type: "union";
  oneOf: NodeRef[];
}

export interface FunctionType {
  type: "function";
  name: string;
  exec(symbols: NodeGraph, result: NodeRef, args: NodeRef): Refinements;
}

export type PrimType = StringType | NumberType | BoolType;

export type TypeRefinement =
  | AnyType
  | UntypedType
  | NumberType
  | StringType
  | BoolType
  | ObjectRefinement;

export type FieldRefinement = { key: Refinement; value: Refinement };

export type ObjectRefinement = {
  type: "object";
  fields: FieldRefinement[];
};

export type Refinement = {
  type: TypeRefinement;
  annotation?: ObjectRefinement;
  apply?: [NodeRef, NodeRef];
};

export type Refinements = { ref: NodeRef; refinement: Refinement }[];

export function emptyObject(graph: NodeGraph): ObjectType {
  return {
    type: "object",
    keyValues: [],
    keyType: addNode(graph, { type: anyType }),
    valueType: addNode(graph, { type: anyType })
  };
}

export function singleField(
  graph: NodeGraph,
  key: NodeRef,
  value: NodeRef
): ObjectRefinement {
  return {
    type: "object",
    fields: [
      {
        key: refinementFromNode(graph, key),
        value: refinementFromNode(graph, value)
      }
    ]
  };
}

export const anyType: AnyType = { type: "any" };
export const untyped: UntypedType = { type: "untyped" };
export const numberType: NumberType = { type: "number" };
export const boolType: BoolType = { type: "boolean" };
export const stringType: StringType = { type: "string" };

export function isFunctionType(t: Type): t is FunctionType {
  return t.type === "function";
}

export function isObjectType(t: Type): t is ObjectType {
  return t.type === "object";
}

export function isObjectNode(t: TypedNode): boolean {
  return isObjectType(t.type);
}

export function isStringType(t: Type): t is StringType {
  return t.type === "string";
}

export function isAnyType(t: Type): boolean {
  return t.type === "any";
}

export function isUntyped(t: Type): t is UntypedType {
  return t.type === "untyped";
}

export function isBoolType(t: Type): t is BoolType {
  return t.type === "boolean";
}

export function getNode(graph: NodeGraph, ref: NodeRef) {
  if (ref < 0) {
    console.log("Not a ref");
  }
  return graph[ref];
}

export function mkValuePrim(val: string | number | boolean): PrimType {
  return { type: typeof val, value: val } as PrimType;
}

export function typedRefinementToType(
  graph: NodeGraph,
  ref: TypeRefinement
): Type {
  if (ref.type == "object") {
    return objectFromRefinement(graph, ref);
  }
  return ref;
}

export function refinementToNode(graph: NodeGraph, ref: Refinement): NodeRef {
  const mainType = typedRefinementToType(graph, ref.type);
  const annType = ref.annotation
    ? objectFromRefinement(graph, ref.annotation)
    : undefined;
  return addNode(graph, {
    type: mainType,
    annotation: annType,
    apply: ref.apply
  });
}

export function objectFromRefinement(
  graph: NodeGraph,
  refine: ObjectRefinement
): ObjectType {
  const fields = refine.fields.map(kv => {
    return {
      key: refinementToNode(graph, kv.key),
      value: refinementToNode(graph, kv.value)
    };
  });
  return {
    type: "object",
    keyValues: fields,
    keyType: addNode(graph, { type: untyped }),
    valueType: addNode(graph, { type: untyped })
  };
}

export function refineNode(
  graph: NodeGraph,
  ref: NodeRef,
  refinement: Refinement
): void {
  const n = getNode(graph, ref);
  const mainType = n.type;
  const mainRefine = refineType(graph, mainType, refinement.type);
  var ann = n.annotation;
  if (refinement.annotation) {
    if (ann) {
      ann = refineObject(graph, ann, refinement.annotation);
    } else {
      ann = objectFromRefinement(graph, refinement.annotation);
    }
  }
  const newNode: TypedNode = {
    type: mainRefine,
    annotation: ann,
    apply: refinement.apply ?? n.apply
  };
  graph[ref] = newNode;
}

export function refineFromObjectType(
  graph: NodeGraph,
  type: ObjectType
): ObjectRefinement {
  const fields = type.keyValues.map(kv => {
    return {
      key: refinementFromNode(graph, kv.key),
      value: refinementFromNode(graph, kv.value)
    };
  });
  return { type: "object", fields };
}

export function refinementFromType(
  graph: NodeGraph,
  type: Type
): TypeRefinement {
  if (isPrim(type) || isUntyped(type)) {
    return type;
  }
  if (type.type == "object") {
    return refineFromObjectType(graph, type);
  }
  console.log("Can't make a refinement from", type);
  return { type: "untyped" };
}

export function refinementFromNode(
  graph: NodeGraph,
  ref: NodeRef,
  includeApply?: boolean
): Refinement {
  const n = getNode(graph, ref);
  const mainRefine = refinementFromType(graph, n.type);
  const annRef = n.annotation
    ? refineFromObjectType(graph, n.annotation)
    : undefined;
  return {
    type: mainRefine,
    annotation: annRef,
    apply: includeApply ? n.apply : undefined
  };
}

export function refineObject(
  graph: NodeGraph,
  obj: ObjectType,
  refine: ObjectRefinement
): ObjectType {
  const fields = obj.keyValues;
  const newKV = fields.concat(
    refine.fields.map(fr => {
      return {
        key: refinementToNode(graph, fr.key),
        value: refinementToNode(graph, fr.value)
      };
    })
  );
  return { ...obj, keyValues: newKV };
}

export function refinePrimitive(
  thisType: PrimType,
  refinement: PrimType
): Type {
  if (thisType.value !== refinement.value) {
    if (refinement.value === undefined) {
      return thisType;
    }
    if (thisType.value === undefined) {
      return mkValuePrim(refinement.value);
    }
    console.log(
      "Can't refine different values",
      thisType.value,
      refinement.value
    );
  }
  return thisType;
}

export function refineType(
  graph: NodeGraph,
  thisType: Type,
  refinement: TypeRefinement
): Type {
  if (isUntyped(thisType)) {
    if (refinement.type == "object") {
      return objectFromRefinement(graph, refinement);
    }
    return refinement;
  }
  if (isPrim(thisType) && isPrim(refinement)) {
    return refinePrimitive(thisType, refinement);
  }
  if (isObjectType(thisType) && refinement.type === "object") {
    return refineObject(graph, thisType, refinement);
  }
  console.log("Could not refine", typeToString(graph, thisType), refinement);
  return thisType;
}

export function unify(
  graph: NodeGraph,
  node1: NodeRef,
  node2: NodeRef
): Refinements {
  if (nodeNeedsRefining(graph, node1, node2)) {
    return [
      {
        ref: node1,
        refinement: refinementFromNode(graph, node2)
      }
    ];
  } else if (nodeNeedsRefining(graph, node2, node1)) {
    return [
      {
        ref: node2,
        refinement: refinementFromNode(graph, node1)
      }
    ];
  }
  return [];
}

export function nodeNeedsRefining(
  graph: NodeGraph,
  from: NodeRef,
  to: NodeRef
): boolean {
  const n = getNode(graph, from);
  const o = getNode(graph, to);
  if (needsRefining(n.type, o.type)) {
    return true;
  }
  if (n.annotation && o.annotation) {
    return needsRefining(n.annotation, o.annotation);
  }
  return o.annotation != null;
}

export function needsRefining(t: Type, ot: Type): boolean {
  if (isUntyped(t)) {
    return !isUntyped(ot);
  }
  if (t.type !== ot.type) {
    return !isUntyped(ot);
  }
  if (isPrim(t) && isPrim(ot)) {
    return t.value !== ot.value && ot.value !== undefined;
  }
  return false;
}

export function getNodeAndRefine(
  refinements: Refinements,
  graph: NodeGraph,
  ref: NodeRef,
  t: Type
): TypedNode {
  const n = getNode(graph, ref);
  if (needsRefining(n.type, t)) {
    refinements.push({
      ref,
      refinement: { type: refinementFromType(graph, t) }
    });
  }
  return n;
}

export function appendField(
  graph: NodeGraph,
  objRef: NodeRef,
  key: string,
  value: NodeRef
): NodeRef {
  const obj = getNode(graph, objRef);
  const objType = obj.type;
  if (isObjectType(objType)) {
    const keyRef = addNode(graph, { type: mkValuePrim(key) });
    return addNode(graph, {
      ...obj,
      type: {
        ...objType,
        keyValues: [...objType.keyValues, { key: keyRef, value }]
      }
    });
  } else {
    console.log("It's not an object");
    return objRef;
  }
}

export function reduceAll(graph: NodeGraph, ...refs: NodeRef[]): Refinements {
  return refs.reduce(
    (refs, n) => refs.concat(reduce(graph, n)),
    [] as Refinements
  );
}

export function reduceKeys(graph: NodeGraph, obj: NodeRef): Refinements {
  const objNode = getNode(graph, obj);
  if (isObjectType(objNode.type)) {
    return reduceAll(graph, ...objNode.type.keyValues.map(c => c.key));
  }
  return [];
}

export function isNumber(t: Type): t is NumberType {
  return t.type === "number";
}

export function isPrim(
  t: Type | TypeRefinement
): t is StringType | BoolType | NumberType {
  switch (t.type) {
    case "string":
    case "boolean":
    case "number":
      return true;
  }
  return false;
}

export function primEquals(t: Type, v: string | number | boolean) {
  if (isPrim(t)) {
    return t.value === v;
  }
  return false;
}

export function findField(
  graph: NodeGraph,
  obj: NodeRef,
  key: string | number | boolean
): NodeRef | null {
  const objNode = getNode(graph, obj);
  if (isObjectType(objNode.type)) {
    const v = objNode.type.keyValues.find(nt => {
      const keyType = graph[nt.key].type;
      return primEquals(keyType, key);
    });
    if (v) {
      return v.value;
    }
  }
  return null;
}

export function addNode(graph: NodeGraph, type: TypedNode): NodeRef {
  return graph.push(type) - 1;
}

export function nodeFromExpr(
  graph: NodeGraph,
  symbols: NodeRef,
  expr: Expr
): NodeRef {
  switch (expr.tag) {
    case "primType":
      return addNode(graph, { type: { type: expr.name } });
    case "prim":
      var type: Type;
      switch (typeof expr.value) {
        case "string":
          type = { type: "string", value: expr.value };
          break;
        case "number":
          type = { type: "number", value: expr.value };
          break;
        case "boolean":
          type = { type: "boolean", value: expr.value };
          break;
      }
      return addNode(graph, { type });
    case "object":
      const keyType = nodeFromExpr(graph, symbols, expr.keyType);
      const valueType = nodeFromExpr(graph, symbols, expr.valueType);
      const keyValues = expr.entries.map(kv => {
        const key = nodeFromExpr(graph, symbols, kv.key);
        const value = nodeFromExpr(graph, symbols, kv.value);
        return { key, value };
      });
      return addNode(graph, {
        type: { type: "object", keyValues, keyType, valueType }
      });
    case "native":
      return expr.node(graph, symbols);
    case "apply":
      const funcRef = nodeFromExpr(graph, symbols, expr.function);
      const argsRef = nodeFromExpr(graph, symbols, expr.args);
      return addNode(graph, { apply: [funcRef, argsRef], type: untyped });
    case "let":
      const letRef = nodeFromExpr(graph, symbols, expr.expr);
      const syms = appendField(graph, symbols, expr.symbol, letRef);
      return nodeFromExpr(graph, syms, expr.in);
    case "symbol":
      const val = findField(graph, symbols, expr.symbol);
      if (val !== null) {
        return val;
      }
      console.log("Couldn't find ", expr.symbol);
      return addNode(graph, { type: untyped });
  }
}

export function reduce(graph: NodeGraph, ref: NodeRef): Refinements {
  const node = graph[ref];
  if (node.apply) {
    const funcRef = node.apply[0];
    const funcRefine = reduce(graph, funcRef);
    if (funcRefine.length > 0) {
      return funcRefine;
    }
    const funcType = graph[funcRef].type;
    if (isFunctionType(funcType)) {
      return funcType.exec(graph, ref, node.apply[1]);
    } else {
      console.log("Trying to apply when not a function");
    }
  }
  return [];
}

export function nodeToString(graph: NodeGraph, node: NodeRef): string {
  var n = getNode(graph, node);
  var withoutApply = typeToString(graph, n.type);
  if (n.apply) {
    return withoutApply + "[" + n.apply[0] + ", " + n.apply[1] + "]";
  }
  return withoutApply;
}

export function typeToString(graph: NodeGraph, type: Type): string {
  switch (type.type) {
    case "any":
      return "any";
    case "boolean":
    case "number":
      if (type.value !== undefined) {
        return type.value.toString();
      }
      return type.type;
    case "string":
      if (type.value !== undefined) {
        return `"${type.value}"`;
      }
      return "string";
    case "function":
      return type.name + "()";
    case "object":
      const fields = type.keyValues.map(({ key, value }) => {
        return `${nodeToString(graph, key)}: ${nodeToString(graph, value)}`;
      });
      return `{ ${fields.join(", ")} }`;
    default:
      return type.type;
  }
}

export function argName(name: string, expr: Expr): NativeExpr {
  return {
    tag: "native",
    node: (g, s) => nodeFromExpr(g, s, expr)
  };
}

export function lookupArg(name: string): Expr {
  return applyRef("lookupArg", ref("args"), cnst(name));
}

export function expressionFunction(name: string, expr: Expr): NativeExpr {
  return {
    tag: "native",
    node: (g, s) =>
      addNode(g, {
        type: {
          type: "function",
          name,
          exec(execGraph, result, args) {
            const symbols = appendField(execGraph, s, "args", args);
            const funcExpr = nodeFromExpr(execGraph, symbols, expr);
            var refinements = reduce(execGraph, funcExpr);
            refinements.push({
              ref: result,
              refinement: refinementFromNode(execGraph, funcExpr, true)
            });
            return refinements;
          }
        }
      })
  };
}
