import * as util from "util";
import {
  JSExpr,
  JSFunctionDef,
  newArg,
  func2string,
  JSStatement,
  emptyFunction,
  expr2string,
  appendReturn
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
  annotation?: NodeRef;
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
  keyValues: NodeTuple[];
}

export interface UnionType {
  type: "union";
  oneOf: NodeRef[];
}

export interface FunctionType {
  type: "function";
  name: string;
  exec(graph: NodeGraph, result: NodeRef, args: NodeRef): Refinements;
  toJSExpr?(
    graph: NodeGraph,
    result: NodeRef,
    args: NodeRef,
    funcDef: JSContext
  ): [JSContext, JSExpr];
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
  annotation?: boolean;
  apply?: [NodeRef, NodeRef];
};

export type Refinements = { ref: NodeRef; refinement: Refinement }[];

export function emptyObject(graph: NodeGraph): ObjectType {
  return {
    type: "object",
    keyValues: [
      {
        key: addNode(graph, { type: anyType }),
        value: addNode(graph, { type: anyType })
      }
    ]
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
  return addNode(graph, {
    type: mainType,
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
    keyValues: fields
  };
}

export function refineNode(
  graph: NodeGraph,
  ref: NodeRef,
  refinement: Refinement
): void {
  var n = getNode(graph, ref);
  if (refinement.annotation) {
    if (n.annotation !== undefined)
      return refineNode(graph, n.annotation, {
        ...refinement,
        annotation: false
      });
    const newAnn = refinementToNode(graph, refinement);
    graph[ref] = {
      ...n,
      annotation: newAnn
    };
    return;
  }
  const mainType = n.type;
  const mainRefine = refineType(graph, mainType, refinement.type);
  const newNode: TypedNode = {
    type: mainRefine,
    annotation: n.annotation,
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
  return {
    type: mainRefine,
    apply: includeApply ? n.apply : undefined
  };
}

type RefineValue = { node: NodeRef; refine: Refinement };

type FieldRefinementChoice = "disallow" | RefineValue[] | null;

export function refineField(
  graph: NodeGraph,
  rf: FieldRefinement,
  field: NodeTuple
): FieldRefinementChoice {
  const k = getNode(graph, field.key);
  if (
    isPrim(k.type) &&
    isPrim(rf.key.type) &&
    k.type.value === rf.key.type.value
  ) {
    return [{ node: field.value, refine: rf.value }];
  }
  return null;
}

export function refineObject(
  graph: NodeGraph,
  obj: ObjectType,
  refine: ObjectRefinement
): ObjectType {
  return refine.fields.reduce((latestObj, field) => {
    const fieldChoice = latestObj.keyValues.reduce((choice, cur) => {
      if (choice === "disallow") {
        return choice;
      }
      const next = refineField(graph, field, cur);
      if (next === "disallow") {
        return next;
      }
      if (next === null) {
        return choice;
      }
      return choice ? choice.concat(next) : next;
    }, null as FieldRefinementChoice);
    if (fieldChoice == null) {
      const key = refinementToNode(graph, field.key);
      const value = refinementToNode(graph, field.value);
      return {
        ...latestObj,
        keyValues: latestObj.keyValues.concat([{ key, value }])
      };
    } else if (fieldChoice === "disallow") {
      throw new Error("Not allowed to ");
    } else {
      fieldChoice.forEach(c => refineNode(graph, c.node, c.refine));
      return latestObj;
    }
  }, obj);
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
    throw new Error("Type error");
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
  if (needsRefining(graph, n.type, o.type)) {
    return true;
  }
  if (n.annotation && o.annotation) {
    return nodeNeedsRefining(graph, n.annotation, o.annotation);
  }
  return o.annotation !== undefined;
}

export function needsRefining(graph: NodeGraph, t: Type, ot: Type): boolean {
  if (isUntyped(t)) {
    return !isUntyped(ot);
  }
  if (t.type !== ot.type) {
    return !isUntyped(ot);
  }
  if (isPrim(t) && isPrim(ot)) {
    return t.value !== ot.value && ot.value !== undefined;
  }
  if (isObjectType(t) && isObjectType(ot)) {
    return objectNeedsRefining(graph, t, ot);
  }
  return true;
}

export function objectNeedsRefining(
  graph: NodeGraph,
  obj: ObjectType,
  other: ObjectType
): boolean {
  function fieldNeedsRefine(rf: NodeTuple, field: NodeTuple): boolean {
    const k1 = getNode(graph, field.key);
    const k2 = getNode(graph, rf.key);
    if (isPrim(k1.type) && isPrim(k2.type) && k1.type.value === k2.type.value) {
      return nodeNeedsRefining(graph, field.value, rf.value);
    }
    return false;
  }
  return other.keyValues.some(okv =>
    obj.keyValues.some(tkv => fieldNeedsRefine(okv, tkv))
  );
}

export function getNodeAndRefine(
  refinements: Refinements,
  graph: NodeGraph,
  ref: NodeRef,
  t: Type
): TypedNode {
  const n = getNode(graph, ref);
  if (needsRefining(graph, n.type, t)) {
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
    console.log("It's not an object", obj);
    throw new Error("It's not an object");
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

export function matchField(
  graph: NodeGraph,
  obj: NodeRef,
  f: (kv: NodeTuple) => boolean
): NodeTuple | undefined {
  const objNode = getNode(graph, obj);
  if (isObjectType(objNode.type)) {
    return objNode.type.keyValues.find(f);
  }
  return undefined;
}

export function findField(
  graph: NodeGraph,
  obj: NodeRef,
  key: string | number | boolean
): NodeRef | null {
  const field = matchField(graph, obj, kv => {
    const keyType = graph[kv.key].type;
    return primEquals(keyType, key);
  });
  return field ? field.value : null;
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
      const keyValues = expr.entries.map(kv => {
        const key = nodeFromExpr(graph, symbols, kv.key);
        const value = nodeFromExpr(graph, symbols, kv.value);
        return { key, value };
      });
      return addNode(graph, {
        type: { type: "object", keyValues }
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
  var withoutApply = node + "-" + typeToString(graph, n.type);
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

export interface JSContext {
  funcDef: JSFunctionDef;
  exprs: { [n: number]: JSExpr };
}

export function toJSPrimitive(graph: NodeGraph, type: Type): JSExpr | null {
  if (isPrim(type) && type.value) {
    return { type: "prim", value: type.value };
  }
  return null;
}

export function toJS(
  graph: NodeGraph,
  ref: NodeRef,
  jsContext: JSContext
): [JSContext, JSExpr] {
  const already = jsContext.exprs[ref];
  if (already) {
    return [jsContext, already];
  }
  const n = getNode(graph, ref);
  const ret = toJSPrimitive(graph, n.type);
  if (ret) {
    return [jsContext, ret];
  }
  if (n.apply) {
    const func = getNode(graph, n.apply[0]);
    if (isFunctionType(func.type)) {
      if (func.type.toJSExpr) {
        return func.type.toJSExpr(graph, ref, n.apply[1], jsContext);
      } else {
        console.log("No JS def for func", func);
        throw new Error("No JS def for func");
      }
    } else {
      throw new Error("Not a function when genning JS");
    }
  }
  console.log("Can't generate any JS for", nodeToString(graph, ref));
  return [jsContext, { type: "undefined" }];
}
