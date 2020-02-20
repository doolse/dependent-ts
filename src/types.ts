import { JSExpr, JSFunctionDef, newArg } from "./javascript";

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

export type NodeGraph = TypedNode[];
export type SymbolTable = { [symbol: string]: NodeRef };

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

export type ExprNode = {
  expr: Expr;
  symbols: SymbolTable;
  unexpanded: boolean;
};

export interface TypedNode {
  type: Type;
  annotation?: NodeRef;
  expr?: ExprNode | null;
  apply?: [NodeRef, NodeRef] | null;
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
  | FunctionType
  | ObjectRefinement;

export type FieldRefinement = { key: Refinement; value: Refinement };

export type ObjectRefinement = {
  type: "object";
  fields: FieldRefinement[];
};

export type TargetedRefinement = {
  ref: NodeRef;
} & Refinement;

export type Refinement = {
  refine: TypeRefinement;
  annotation?: boolean;
  expr?: ExprNode | null;
  apply?: [NodeRef, NodeRef] | null;
};

export type Refinements = TargetedRefinement[];

export function simpleRefinement(
  ref: NodeRef,
  refine: TypeRefinement
): Refinements {
  return [{ ref, refine }];
}

export const emptyObject: ObjectType = {
  type: "object",
  keyValues: []
};

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

export function getStringValue(
  graph: NodeGraph,
  ref: NodeRef
): string | undefined {
  const n = getNode(graph, ref);
  if (isStringType(n.type)) {
    return n.type.value;
  }
  return undefined;
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
  const mainType = typedRefinementToType(graph, ref.refine);
  return addNode(graph, {
    type: mainType,
    apply: ref.apply ? ref.apply : undefined
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
  refinement: TargetedRefinement
): void {
  const ref = refinement.ref;
  var n = getNode(graph, ref);
  if (refinement.annotation) {
    if (n.annotation !== undefined)
      return refineNode(graph, {
        ...refinement,
        ref: n.annotation,
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
  const mainRefine = refineType(graph, mainType, refinement.refine);
  const newNode: TypedNode = {
    type: mainRefine,
    annotation: n.annotation,
    apply: refinement.apply === undefined ? n.apply : refinement.apply,
    expr: refinement.expr === undefined ? n.expr : refinement.expr
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
  srcNode: NodeRef,
  includeApply?: boolean
): Refinement {
  const n = getNode(graph, srcNode);
  const mainRefine = refinementFromType(graph, n.type);
  return {
    refine: mainRefine,
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
    isPrim(rf.key.refine) &&
    k.type.value === rf.key.refine.value
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
      fieldChoice.forEach(c => refineNode(graph, { ...c.refine, ref: c.node }));
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
        ...refinementFromNode(graph, node2),
        ref: node1
      }
    ];
  } else if (nodeNeedsRefining(graph, node2, node1)) {
    return [
      {
        ...refinementFromNode(graph, node1),
        ref: node2
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
      refine: refinementFromType(graph, t)
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

export function addNodeType(graph: NodeGraph, type: Type): NodeRef {
  return addNode(graph, { type });
}

export function nodeFromExpr(
  graph: NodeGraph,
  symbols: SymbolTable,
  expr: Expr
): NodeRef {
  if (expr.tag == "symbol") {
    const ref = symbols[expr.symbol];
    if (ref !== undefined) {
      return ref;
    }
    console.log(symbols);
    throw new Error("Couldn't find " + expr.symbol);
  }
  var type: Type = untyped;
  var unexpanded = true;
  if (expr.tag == "object") {
    const keyValues = expr.entries.map(kv => {
      const key = nodeFromExpr(graph, symbols, kv.key);
      const value = nodeFromExpr(graph, symbols, kv.value);
      return { key, value };
    });
    type = { type: "object", keyValues };
    unexpanded = false;
  }
  switch (expr.tag) {
    case "primType":
      type = { type: expr.name };
      break;
    case "prim":
      unexpanded = false;
      type = mkValuePrim(expr.value);
      break;
  }
  return addNode(graph, {
    type,
    expr: { expr, symbols, unexpanded }
  });
}

export function expandExpr(graph: NodeGraph, nodeRef: NodeRef): Refinements {
  const { expr, symbols } = graph[nodeRef].expr!;

  switch (expr.tag) {
    case "apply":
      const funcRef = nodeFromExpr(graph, symbols, expr.function);
      const argsRef = nodeFromExpr(graph, symbols, expr.args);
      return [
        {
          ref: nodeRef,
          apply: [funcRef, argsRef],
          refine: untyped,
          expr: { expr, symbols, unexpanded: false }
        }
      ];
    case "let":
      const letRef = nodeFromExpr(graph, symbols, expr.expr);
      const newSyms = { ...symbols };
      newSyms[expr.symbol] = letRef;
      return reduce(graph, nodeFromExpr(graph, newSyms, expr.in));
    default:
      throw new Error("Everything else must be expanded already");
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
  } else if (node.expr?.unexpanded) {
    return expandExpr(graph, ref);
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

export function toJSPrimitive(type: Type): JSExpr | null {
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
  const ret = toJSPrimitive(n.type);
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

export function isFlagSet(
  graph: NodeGraph,
  ref: NodeRef,
  key: string
): boolean {
  const n = getNode(graph, ref);
  if (n.annotation) {
    const f = findField(graph, n.annotation, key);
    if (f) {
      const flag = getNode(graph, f);
      return Boolean(isBoolType(flag.type) && flag.type.value);
    }
  }
  return false;
}

export function ensureAnnotation(graph: NodeGraph, ref: NodeRef): NodeRef {
  const n = getNode(graph, ref);
  if (n.annotation) {
    return n.annotation;
  }
  const annotation = addNode(graph, { type: emptyObject });
  graph[ref] = { ...n, annotation };
  return annotation;
}

export function updateType(
  graph: NodeGraph,
  objRef: NodeRef,
  f: (o: Type) => Type
) {
  const n = getNode(graph, objRef);
  graph[objRef] = { ...n, type: f(n.type) };
}

export function updateObjectType(
  graph: NodeGraph,
  objRef: NodeRef,
  f: (o: ObjectType) => ObjectType
) {
  const n = getNode(graph, objRef);
  if (isObjectType(n.type)) {
    graph[objRef] = { ...n, type: f(n.type) };
  } else throw new Error("Not an object: " + nodeToString(graph, objRef));
}

export function ensureField(
  graph: NodeGraph,
  objRef: NodeRef,
  key: string
): NodeRef {
  const field = findField(graph, objRef, key);
  if (field) {
    return field;
  }
  const kf = addNode(graph, { type: mkValuePrim(key) });
  const value = addNode(graph, { type: untyped });
  updateObjectType(graph, objRef, o => ({
    ...o,
    keyValues: o.keyValues.concat([{ key: kf, value }])
  }));
  return value;
}

export function setAnnotationValue(
  graph: NodeGraph,
  ref: NodeRef,
  key: string,
  val: string | boolean | number
) {
  const an = ensureField(graph, ensureAnnotation(graph, ref), key);
  updateType(graph, an, e => mkValuePrim(val));
}

export function createArgs(
  graph: NodeGraph,
  objRef: NodeRef,
  funcDef: JSFunctionDef
): JSFunctionDef {
  setAnnotationValue(graph, objRef, "inScope", true);
  const n = getNode(graph, objRef);
  if (isObjectType(n.type)) {
    n.type.keyValues.forEach(({ key, value }) => {
      const keyString = getStringValue(graph, key);
      if (keyString) {
        newArg(funcDef, keyString);
      }
    });
  }
  return funcDef;
}
