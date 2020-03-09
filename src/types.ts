import { JSExpr, JSFunctionDef, newArg, stmt2string } from "./javascript";
import { inspect } from "util";
import color from "cli-color";
import { shallowEqual } from "shallow-equal-object";
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
  keyExpr: Expr;
  valueExpr: Expr;
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
    function: ref(name)
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
      keyExpr: primTypeExpr("untyped"),
      valueExpr: primTypeExpr("untyped"),
      entries: args.map(([key, value]) => ({
        tag: "keyvalue",
        key,
        value
      }))
    },
    function: ref(name)
  };
}

export function arrayType(graph: NodeGraph, ...entries: Type[]): ObjectType {
  return {
    type: "object",
    keyType: noDepNode(graph, untyped),
    valueType: noDepNode(graph, untyped),
    keyValues: entries.map((value, i) => ({
      key: noDepNode(graph, cnstType(i)),
      value: noDepNode(graph, value)
    }))
  };
}

export function objType(
  graph: NodeGraph,
  ...entries: [Type, Type][]
): ObjectType {
  return {
    type: "object",
    keyType: noDepNode(graph, untyped),
    valueType: noDepNode(graph, untyped),
    keyValues: entries.map(([k, value], i) => ({
      key: noDepNode(graph, k),
      value: noDepNode(graph, value)
    }))
  };
}

export function arrayExpr(...entries: Expr[]): ObjectExpr {
  return {
    tag: "object",
    keyExpr: primTypeExpr("untyped"),
    valueExpr: primTypeExpr("untyped"),
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
    keyExpr: primTypeExpr("untyped"),
    valueExpr: primTypeExpr("untyped"),
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

export function primTypeExpr(
  name: "string" | "number" | "boolean" | "any" | "untyped"
): PrimitiveNameExpr {
  return { tag: "primType", name };
}

export type NodeGraph = {
  nodes: NodeData[];
  types: TypeData[];
};

export type TypeData = {
  type: Type;
  owner: NodeRef;
  deps: NodeRef[];
};

export type NodeRef = number;
export type TypeRef = number;
export type SymbolTable = { [symbol: string]: NodeRef };

export type Closure = {
  parent?: Closure;
  symbols: SymbolTable;
};

export type Application = {
  func: NodeRef;
  args: NodeRef;
};

export type TypedNode = {
  ref: NodeRef;
  graph: NodeGraph;
};

export type ApplicationNode = NodeData & {
  application: Application;
};

export interface NewNodeData {
  expr?: Expr;
  parent?: NodeRef;
  application?: Application;
  reducible?: boolean;
  symbol?: string;
}

export interface NodeData extends NewNodeData {
  typeRef: TypeRef;
  nodeId: NodeRef;
}

export type ReduceFlags = {
  keys?: boolean;
  values?: boolean;
};

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
  | FunctionType;

export interface BaseType {
  refinements?: TypedNode[];
}

export interface AnyType extends BaseType {
  type: "any";
}

export interface UntypedType extends BaseType {
  type: "untyped";
}

export interface NumberType extends BaseType {
  type: "number";
  value?: number;
}

export interface StringType extends BaseType {
  type: "string";
  value?: string;
}

export interface BoolType extends BaseType {
  type: "boolean";
  value?: boolean;
}

export interface ObjectType extends BaseType {
  type: "object";
  keyType: NodeRef;
  valueType: NodeRef;
  keyValues: NodeTuple[];
}

export interface FunctionType extends BaseType {
  type: "function";
  name: string;
  reduce(result: TypedNode, args: TypedNode): void;
  // toJSExpr?(
  //   graph: NodeGraph,
  //   result: NodeRef,
  //   args: NodeRef,
  //   funcDef: JSContext
  // ): [JSContext, JSExpr];
}

export type TypeNameOnly<T extends Type> = Pick<T, "type">;

export type PrimType = StringType | NumberType | BoolType;

export const anyType: AnyType = { type: "any" };
export const untyped: UntypedType = { type: "untyped" };
export const numberType: NumberType = { type: "number" };
export const boolType: BoolType = { type: "boolean" };
export const stringType: StringType = { type: "string" };

export const objectTypeName: TypeNameOnly<ObjectType> = { type: "object" };

export function emptyObject(depsFrom: TypedNode): ObjectType {
  return {
    type: "object",
    keyValues: [],
    keyType: node(depsFrom, untyped),
    valueType: node(depsFrom, untyped)
  };
}

export function existingType(
  graph: NodeGraph,
  node: NewNodeData,
  typeRef: TypeRef
): NodeData {
  const nodeId = graph.nodes.length;
  const exTypeData = graph.types[typeRef];
  graph.types[typeRef] = { ...exTypeData, deps: [...exTypeData.deps, nodeId] };
  const newNode = { ...node, nodeId, typeRef };
  graph.nodes.push(newNode);
  return newNode;
}

export function newNode(
  graph: NodeGraph,
  node: NewNodeData,
  type: Type,
  parent?: NodeRef
): NodeData {
  const nodeId = graph.nodes.length;
  const typeRef = graph.types.length;
  graph.types.push({ type, owner: nodeId, deps: [] });
  const newNode = { ...node, nodeId, typeRef, parent };
  graph.nodes.push(newNode);
  return newNode;
}

export function assertType<T extends Type>(
  t: Type,
  t2: TypeNameOnly<T>
): asserts t is T {
  if (t.type !== t2.type) {
    throw new Error(
      `Not the correct type: expected ${t2.type} but found ${t.type}`
    );
  }
}

export function isNodeOfType<T extends Type>(
  t: TypedNode,
  expected: TypeNameOnly<T>
): boolean {
  return isOfType(nodeType(t), expected);
}

export function isOfType<T extends Type>(t: Type, t2: TypeNameOnly<T>): t is T {
  return t.type === t2.type;
}

export function noDepNode(graph: NodeGraph, type: Type): NodeRef {
  return newNode(graph, {}, type).nodeId;
}

export function node(parent: TypedNode, type: Type): NodeRef {
  return newNode(parent.graph, {}, type, parent.ref).nodeId;
}

export function isFunctionType(t: Type): t is FunctionType {
  return t.type === "function";
}

export function isObjectType(t: Type): t is ObjectType {
  return t.type === "object";
}

export function graphNode(graph: NodeGraph, ref: NodeRef): NodeData {
  return graph.nodes[ref];
}

export function nodeData(node: TypedNode): NodeData {
  return graphNode(node.graph, node.ref);
}

export function depsFromNode(node: TypedNode): TypeRef[] {
  return node.graph.types[node.graph.nodes[node.ref].typeRef].deps;
}

export function typeFromRef(graph: NodeGraph, ref: TypeRef) {
  return graph.types[ref].type;
}

export function lookupType(graph: NodeGraph, ref: NodeRef): Type {
  return typeFromRef(graph, graphNode(graph, ref).typeRef);
}

export function nodeRef(graph: NodeGraph, ref: NodeRef): TypedNode {
  return { graph, ref };
}

export function fromNodeRef(n: TypedNode, ref: NodeRef): TypedNode {
  return { graph: n.graph, ref };
}

export function nodeType(node: TypedNode): Type {
  return lookupType(node.graph, node.ref);
}

export function nodeExpr(node: TypedNode): Expr | undefined {
  return nodeData(node).expr;
}

export function nodeReducible(node: TypedNode): boolean {
  return Boolean(isReducibleNode(node) && nodeData(node).reducible);
}

export function isNodeApp(node: NodeData): node is ApplicationNode {
  return Boolean(node.application);
}

export function isObjectNode(t: TypedNode): boolean {
  return isObjectType(nodeType(t));
}

export function isFunctionNode(t: TypedNode): boolean {
  return isFunctionType(nodeType(t));
}

export function assertDefined<A>(a: A | undefined): A {
  if (a !== undefined) return a;
  throw new Error("Is undefined");
}

export function assertApplication(node: TypedNode): Application {
  return assertDefined(nodeData(node).application);
}

export function assertAppNode(node: NodeData): asserts node is ApplicationNode {
  if (!node.application) {
    throw new Error("Not an app node");
  }
}

export function isStringType(t: Type): t is StringType {
  return t.type === "string";
}

export function getStringValue(type: Type): string | undefined {
  if (isStringType(type)) {
    return type.value;
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

export function cnstType(val: string | number | boolean): PrimType {
  return { type: typeof val, value: val } as PrimType;
}

export function isNumber(t: Type): t is NumberType {
  return t.type === "number";
}

export function getNumberValue(node: TypedNode): number | undefined {
  const t = nodeType(node);
  if (isNumber(t)) {
    return t.value;
  }
}

export function numberOp(
  t: TypedNode,
  t2: TypedNode,
  f: (n1: number, n2: number) => number
): number | undefined {
  const n1 = getNumberValue(t);
  const n2 = getNumberValue(t2);
  return n1 !== undefined && n2 !== undefined ? f(n1, n2) : undefined;
}

export function isPrim(t: Type): t is StringType | BoolType | NumberType {
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

export function refinePrimitive(
  thisType: PrimType,
  refinement: PrimType
): Type {
  if (thisType.value !== refinement.value) {
    if (refinement.value === undefined) {
      return thisType;
    }
    if (thisType.value === undefined) {
      return cnstType(refinement.value);
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

export function exprToString(expr: Expr): string {
  switch (expr.tag) {
    case "apply":
      return exprToString(expr.function) + "(" + exprToString(expr.args) + ")";
    case "let":
      return (
        "let " +
        expr.symbol +
        " = " +
        exprToString(expr.expr) +
        " in " +
        exprToString(expr.in)
      );
    case "object":
      // const keyString = exprToString(expr.keyExpr);
      // const valString = exprToString(expr.valueExpr);
      const fields = expr.entries
        .map(({ key, value }) => exprToString(key) + ": " + exprToString(value))
        .join(", ");
      return "{" + fields + " }";
    case "prim":
      if (typeof expr.value === "string") {
        return '"' + expr.value + '"';
      }
      return expr.value.toString();
    case "primType":
      return expr.name;
    case "symbol":
      return "'" + expr.symbol;
  }
}

export type PrintFlags = {
  expr?: boolean;
  nodeId?: boolean;
  reducible?: boolean;
  application?: boolean;
  refinements?: boolean;
  appFlags?: PrintFlags;
};

export function refToString(
  graph: NodeGraph,
  ref: NodeRef,
  flags?: PrintFlags
): string {
  return nodeToString({ graph, ref }, flags);
}

export function nodeToString(node: TypedNode, flags?: PrintFlags): string {
  const type = nodeType(node);
  var typeOnly = typeAndRefinementsToString(node.graph, type, flags);
  const expr = nodeExpr(node);
  if (flags?.expr && expr) {
    typeOnly = typeOnly + color.magenta("~" + exprToString(expr));
  }
  if (flags?.reducible && nodeReducible(node)) {
    typeOnly = color.red("*") + typeOnly;
  }
  const app = nodeData(node).application;
  if (flags?.application && app) {
    typeOnly =
      typeOnly +
      color.underline(
        `~` +
          nodeToString(fromNodeRef(node, app.func), flags?.appFlags) +
          "(" +
          nodeToString(fromNodeRef(node, app.args), flags?.appFlags) +
          ")"
      );
  }
  if (flags?.nodeId) {
    // if ((!isPrim(type) || type.value === undefined) && !isFunctionType(type)) {
    typeOnly = nodeData(node).nodeId + "@" + typeOnly;
    // }
  }
  return typeOnly;
}

export function typeAndRefinementsToString(
  graph: NodeGraph,
  type: Type,
  flags?: PrintFlags
): string {
  const baseStr = typeToString(graph, type, flags);
  if (!type.refinements || !flags?.refinements) {
    return baseStr;
  } else {
    const plusRef = type.refinements
      .map(r => nodeToString(r, { application: true }))
      .join(" && ");
    return baseStr + "#" + plusRef;
  }
}

export function typeToString(
  graph: NodeGraph,
  type: Type,
  flags?: PrintFlags
): string {
  switch (type.type) {
    case "any":
      return color.blue("any");
    case "boolean":
    case "number":
      if (type.value !== undefined) {
        return color.yellow(type.value.toString());
      }
      return color.blue(type.type);
    case "string":
      if (type.value !== undefined) {
        return color.green(`"${type.value}"`);
      }
      return "string";
    case "function":
      return color.cyan(type.name + "()");
    case "object":
      const fields = type.keyValues.map(({ key, value }) => {
        return `${nodeToString(nodeRef(graph, key), flags)}: ${nodeToString(
          nodeRef(graph, value),
          flags
        )}`;
      });
      return `{ ${fields.join(", ")} }`;
    default:
      return color.blue(type.type);
  }
}

export function applyFunction(func: TypedNode, args: NodeRef): NodeRef {
  if (isFunctionNode(func)) {
    const appNode = newNode(
      func.graph,
      {
        application: { func: func.ref, args },
        reducible: true
      },
      untyped
    );
    return appNode.nodeId;
  }
  throw new Error("Trying to apply not a function");
}

export function inspectAll(a: any) {
  return inspect(a, false, null, true);
}

export function valueEqualsNode(one: TypedNode, two: TypedNode): boolean {
  return valueEqualsType(nodeType(one), nodeType(two));
}

export function valueEqualsRef(
  graph: NodeGraph,
  one: NodeRef,
  two: NodeRef
): boolean {
  return valueEqualsType(lookupType(graph, one), lookupType(graph, two));
}

export function valueEqualsType(one: Type, two: Type): boolean {
  if (isPrim(one) && isPrim(two)) {
    return one.value === two.value;
  }
  return false;
}

export function typeEquals(graph: NodeGraph, one: Type, two: Type): boolean {
  return isRefinementOf(graph, one, two) && isRefinementOf(graph, two, one);
}

export function mapChanges<A>(array: A[], f: (a: A) => A): A[] {
  var changed = false;
  const changedArr = array.map(a => {
    const newa = f(a);
    if (newa !== a) {
      changed = true;
    }
    return newa;
  });
  return changed ? changedArr : array;
}

export function isRefinementOfNode(source: TypedNode, refinement: TypedNode) {
  return isRefinementOf(source.graph, nodeType(source), nodeType(refinement));
}

export function isRefinementOfRef(
  graph: NodeGraph,
  source: NodeRef,
  refinement: NodeRef
) {
  return isRefinementOf(
    graph,
    lookupType(graph, source),
    lookupType(graph, refinement)
  );
}

export function missingRefinements(
  source: TypedNode[] | undefined,
  refinements: TypedNode[] | undefined
) {
  if (!source) {
    return refinements && refinements.length > 0;
  } else
    return (
      refinements &&
      refinements.some(r => !source.find(sr => shallowEqual(sr, r)))
    );
}

export function isRefinementOf(
  graph: NodeGraph,
  source: Type,
  refinement: Type
): boolean {
  if (source === refinement) {
    return true;
  }
  if (missingRefinements(source.refinements, refinement.refinements)) {
    return false;
  }
  if (isUntyped(refinement)) {
    return true;
  }
  if (isUntyped(source)) {
    return false;
  }
  if (isOfType(source, refinement) && isPrim(refinement) && isPrim(source)) {
    return refinement.value === undefined || source.value === refinement.value;
  }
  if (isObjectType(source) && isObjectType(refinement)) {
    return (
      isRefinementOfRef(graph, source.keyType, refinement.keyType) &&
      isRefinementOfRef(graph, source.valueType, refinement.valueType) &&
      refinement.keyValues.every(({ key, value }) => {
        const ind = source.keyValues.findIndex(kv =>
          valueEqualsRef(graph, key, kv.key)
        );
        if (ind >= 0) {
          return isRefinementOfRef(graph, source.keyValues[ind].value, value);
        } else {
          return (
            isRefinementOfRef(graph, source.keyType, key) &&
            isRefinementOfRef(graph, source.valueType, value)
          );
        }
      })
    );
  }
  if (isPrim(source)) {
    return false;
  }
  console.log(source, "AND", refinement);
  throw new Error("Don't know how to check if already refine yet");
}

export function withRefinements(source: Type, refinement: Type) {
  const refinements = refinement.refinements;
  if (!refinements || refinements.length == 0) {
    return source;
  } else if (!source.refinements) {
    return { ...source, refinements };
  } else {
    const extraRefine = refinements.filter(
      r => !source.refinements!.find(sr => shallowEqual(sr, r))
    );
    extraRefine.forEach(n =>
      console.log(nodeToString(n, { application: true, nodeId: true }))
    );
    if (extraRefine.length == 0) {
      return source;
    }
    return {
      ...source,
      refinements: [...source.refinements, ...extraRefine]
    };
  }
}

export function refineType(
  graph: NodeGraph,
  source: Type,
  refinement: Type
): Type {
  if (source === refinement) {
    return source;
  }
  if (isUntyped(refinement)) {
    return withRefinements(source, refinement);
  }
  if (isUntyped(source)) {
    return refinement;
  }
  if (isPrim(source) && isPrim(refinement)) {
    if (source.type !== refinement.type) {
      throw new Error(
        "Can't refine type " + source.type + " to " + refinement.type
      );
    }
    if (source.value !== refinement.value) {
      if (source.value === undefined) {
        return withRefinements(
          { ...source!, value: refinement.value! } as PrimType,
          refinement
        );
      } else {
        throw new Error(
          "Can't refine value from " + source.value + " to " + refinement.value
        );
      }
    }
    return withRefinements(source, refinement);
  }
  if (isObjectType(source) && isObjectType(refinement)) {
    // console.log(
    //   "Refining:" + typeToString(source) + " with " + typeToString(refinement)
    // );
    const result = refineObjects(graph, source, refinement);
    // console.log(`Resulting in ${result === source} ${typeToString(result)}`);
    return withRefinements(result, refinement);
  }
  debugger;
  throw new Error(
    "Don't know how to refine this yet: " +
      inspect(source, false, null, true) +
      " AND " +
      inspect(refinement, false, null, true)
  );
}

function refineObjects(
  graph: NodeGraph,
  source: ObjectType,
  refinement: ObjectType
) {
  let newFields: NodeTuple[] = [];
  let changed = false;
  refinement.keyValues.forEach(({ key, value }) => {
    const ind = source.keyValues.findIndex(kv =>
      valueEqualsRef(graph, key, kv.key)
    );
    if (ind >= 0) {
      const exKV = source.keyValues[ind];
      changed = refineRef(graph, exKV.value, value) || changed;
      changed = refineRef(graph, exKV.key, key) || changed;
    } else {
      refineRef(graph, key, source.keyType);
      refineRef(graph, value, source.valueType);
      newFields.push({ key, value });
    }
  });
  changed = refineRef(graph, source.keyType, refinement.keyType) || changed;
  changed = refineRef(graph, source.valueType, refinement.valueType) || changed;
  if (newFields.length) {
    return {
      ...source,
      keyValues: [...source.keyValues, ...newFields]
    };
  }
  if (changed) {
    return { ...source };
  }
  return source;
}

export function printClosure(
  graph: NodeGraph,
  closure: Closure,
  flags?: PrintFlags
) {
  return printSymbols(graph, closure.symbols, flags);
}

export function printSymbols(
  graph: NodeGraph,
  symbols: SymbolTable,
  flags?: PrintFlags
): string {
  const symStrings = Object.entries(symbols).map(
    ([sym, node]) => `${sym}: ${nodeToString({ graph, ref: node }, flags)}`
  );
  return `{${symStrings.join(", ")} }`;
}

export function refineApp(app: Application, app2: Application): Application {
  return app.args === app2.args && app.func === app2.func ? app : app2;
}

export function refineSymbols(
  symbols: SymbolTable,
  symbols2: SymbolTable
): SymbolTable {
  if (symbols === symbols2) {
    return symbols;
  }
  return Object.assign({}, symbols, symbols2);
}

function printDiff(node1: TypedNode, node2: TypedNode) {
  const lr = isRefinementOfNode(node1, node2);
  const rl = isRefinementOfNode(node2, node1);
  if (lr && rl) {
    return "same: " + nodeToString(node1);
  }
  return `diff: orig-${nodeToString(node1)} new-${nodeToString(node2)}`;
}

function markReducible(
  graph: NodeGraph,
  nodeRef: NodeRef,
  seenNodes: NodeRef[]
) {
  if (seenNodes.includes(nodeRef)) {
    return;
  }
  seenNodes.push(nodeRef);
  const data = graph.nodes[nodeRef];
  if (data.application) {
    // console.log(
    //   refToString(graph, nodeRef, {
    //     application: true,
    //     nodeId: true,
    //     appFlags: { nodeId: true }
    //   })
    // );
    graph.nodes[nodeRef] = { ...data, reducible: true };
  }
  const typeData = graph.types[data.typeRef];
  // typeData.deps.forEach(nRef => {
  //   markReducible(graph, nRef, seenNodes);
  // });
  markReducible(graph, typeData.owner, seenNodes);
  if (data.parent) {
    markReducible(graph, data.parent, seenNodes);
  }
}

export function refineNode(node1: TypedNode, node2: TypedNode): boolean {
  return refine(node1.graph, node1.ref, nodeType(node2));
}

export function refineToType(node1: TypedNode, type: Type): boolean {
  return refine(node1.graph, node1.ref, type);
}

export function refineRef(
  graph: NodeGraph,
  source: NodeRef,
  refinement: NodeRef
) {
  return refine(graph, source, lookupType(graph, refinement));
}

export function refine(
  graph: NodeGraph,
  source: NodeRef,
  refinement: Type
): boolean {
  const node = graphNode(graph, source);
  const typeRef = node.typeRef;
  const sourceType = typeFromRef(graph, typeRef);
  if (isRefinementOf(graph, sourceType, refinement)) {
    return false;
  }
  const type = refineType(graph, sourceType, refinement);
  if (type !== sourceType) {
    const tNode = graph.types[typeRef];
    graph.types[typeRef] = { ...tNode, type };
    // console.log(
    //   "Mark reducible for " +
    //     refToString(graph, source, {
    //       application: true,
    //       nodeId: true,
    //       appFlags: { nodeId: true }
    //     })
    // );
    markReducible(graph, source, []);
    return true;
  }
  return false;
}

function findSymbol(name: string, closure?: Closure): NodeRef {
  while (closure) {
    const node = closure.symbols[name];
    if (node !== undefined) {
      return node;
    }
    closure = closure.parent;
  }
  throw new Error(`No symbol for: '${name}'`);
}

export function reduceToObject(node: TypedNode, flags?: ReduceFlags): void {
  reduceTo(node, objectTypeName, flags ?? { keys: true, values: true });
}

export function reduceTo<T extends Type>(
  node: TypedNode,
  expected: TypeNameOnly<T>,
  flags?: ReduceFlags
): void {
  reduceNode(node, flags);
  if (!isOfType(nodeType(node), expected)) {
    throw new Error("It's not of the type." + expected.type);
  }
}

export function reduceNode(node: TypedNode, flags?: ReduceFlags): void {
  reduce(node.graph, node.ref);
}

export function updateReducible(
  graph: NodeGraph,
  ref: NodeRef,
  reducible: boolean
) {
  graph.nodes[ref] = { ...graph.nodes[ref], reducible };
}

let counter = 0;
export function reduce(
  graph: NodeGraph,
  ref: NodeRef,
  flags?: ReduceFlags
): void {
  let count = counter++;
  while (canReduce(graph, ref, flags)) {
    const data = graphNode(graph, ref);
    if (isNodeApp(data)) {
      const app = data.application;
      const func = nodeRef(graph, app.func);
      reduce(graph, app.func);
      const funcType = nodeType(func);
      if (isFunctionType(funcType)) {
        updateReducible(graph, ref, false);
        funcType.reduce({ graph, ref }, { graph, ref: app.args });
      } else {
        throw new Error("Can't apply to non function");
      }
    } else {
      const type = typeFromRef(graph, data.typeRef);
      if (flags && (flags.keys || flags.values) && isObjectType(type)) {
        reduceObjectType(graph, type, flags);
      } else throw new Error("This is not reducible");
    }
  }
}

export function reduceObjectType(
  graph: NodeGraph,
  obj: ObjectType,
  flags?: ReduceFlags
): void {
  reduce(graph, obj.keyType);
  reduce(graph, obj.valueType);
  obj.keyValues.forEach(kv => {
    if (flags?.keys) reduce(graph, kv.key);
    if (flags?.values) reduce(graph, kv.value);
  });
}

export function canReduceObject(
  graph: NodeGraph,
  obj: ObjectType,
  flags?: ReduceFlags
): boolean {
  return (
    canReduce(graph, obj.keyType) ||
    canReduce(graph, obj.valueType) ||
    obj.keyValues.some(
      ({ key, value }) =>
        (flags?.keys && canReduce(graph, key)) ||
        (flags?.values && canReduce(graph, value))
    )
  );
}

export function isReducibleNode(node: TypedNode): boolean {
  return Boolean(nodeData(node).application);
}

export function canReduceNode(node: TypedNode): boolean {
  return canReduce(node.graph, node.ref);
}

export function canReduce(
  graph: NodeGraph,
  ref: NodeRef,
  flags?: ReduceFlags
): boolean {
  const data = graphNode(graph, ref);
  if (flags?.keys || flags?.values) {
    const type = typeFromRef(graph, data.typeRef);
    if (isObjectType(type)) {
      return canReduceObject(graph, type, flags);
    }
  }
  return data.application ? Boolean(data.reducible) : false;
}

export function findField(
  obj: TypedNode,
  named: string | number | boolean
): [TypedNode, TypedNode] {
  const graph = obj.graph;
  const data = nodeData(obj);
  const type = nodeType(obj);
  assertType(type, objectTypeName);
  var kv = type.keyValues.find(({ key, value }) =>
    primEquals(lookupType(graph, key), named)
  );
  if (!kv) {
    const newKey = node(obj, cnstType(named));
    const newType = node(obj, untyped);
    refineToType(obj, {
      ...type,
      keyValues: [...type.keyValues, { key: newKey, value: newType }]
    });
    return [nodeRef(graph, newKey), nodeRef(graph, newType)];
  }
  return [nodeRef(graph, kv.key), nodeRef(graph, kv.value)];
}

export function unifyNode(node: TypedNode, node2: TypedNode): void {
  // console.log(
  //   `Before unification ${nodeToString(node, {
  //     nodeId: true
  //   })} ${nodeToString(node2, { nodeId: true })}`
  // );
  refineNode(node2, node);
  refineNode(node, node2);
  // console.log(
  //   `After unification ${nodeToString(node, {
  //     nodeId: true
  //   })} ${nodeToString(node2, { nodeId: true })}`
  // );
}

function updateTypeNode(
  graph: NodeGraph,
  ref: TypeRef,
  f: (t: TypeData) => TypeData
) {
  const n = graph.types[ref];
  graph.types[ref] = f(n);
}

export function exprToNode(
  graph: NodeGraph,
  exprs: Expr,
  closure: Closure,
  parent?: NodeRef
): NodeRef {
  function recurse(expr: Expr, parent?: NodeRef): NodeRef {
    function mkExprNodeData(type: Type): NodeData {
      return newNode(graph, {}, type, parent);
    }

    function mkExprNode(type: Type): NodeRef {
      return mkExprNodeData(type).nodeId;
    }

    switch (expr.tag) {
      case "apply":
        const n = mkExprNodeData(untyped);
        n.application = {
          func: recurse(expr.function, n.nodeId),
          args: recurse(expr.args, n.nodeId)
        };
        n.reducible = true;
        return n.nodeId;
      case "prim":
        return mkExprNode(cnstType(expr.value));
      case "primType":
        return mkExprNode({ type: expr.name });
      case "object":
        const obj = mkExprNodeData(untyped);
        const pare = obj.nodeId;
        const keyValues = expr.entries.map(kv => {
          const key = recurse(kv.key, pare);
          const value = recurse(kv.value, pare);
          return { key, value };
        });
        const keyType = recurse(expr.keyExpr, pare);
        const valueType = recurse(expr.valueExpr, pare);
        updateTypeNode(graph, obj.typeRef, n => ({
          ...n,
          type: { type: "object", keyValues, keyType, valueType }
        }));
        return pare;
      case "symbol":
        const symNode = graphNode(graph, findSymbol(expr.symbol, closure));
        // console.log(symNode.nodeId, expr.symbol, symNode.typeRef);
        const newSymNode = existingType(
          graph,
          { symbol: expr.symbol },
          symNode.typeRef
        );
        updateTypeNode(graph, symNode.typeRef, n => ({
          ...n,
          deps: [...n.deps, newSymNode.nodeId]
        }));
        return newSymNode.nodeId;
      case "let":
        const symbolic = recurse(expr.expr, parent);
        closure.symbols[expr.symbol] = symbolic;
        return recurse(expr.in, parent);
    }
  }
  return recurse(exprs, parent);
}

export function defineFunction(
  graph: NodeGraph,
  name: string,
  parent: Closure,
  expr: Expr
): TypedNode {
  const node = newNode(
    graph,
    {},
    {
      type: "function",
      name,
      reduce(result, args) {
        const closure: Closure = {
          parent,
          symbols: { args: args.ref }
        };
        const resultNode = nodeData(result);
        const entry = exprToNode(graph, expr, closure, resultNode.typeRef);
        const entryNode = graphNode(graph, entry);
        const app = entryNode.application;
        if (app) {
          resultNode.application = {
            func: app.func,
            args: app.args
          };
          resultNode.reducible = true;
        } else {
          refineRef(result.graph, result.ref, entry);
        }
      }
    }
  );
  return { graph, ref: node.nodeId };
}

export function printGraph(graph: NodeGraph, flags?: PrintFlags) {
  console.log("TYPES");
  graph.types.forEach(g => {
    const refs = g.deps
      .map(
        n => n.toString()
        // refToString(graph, n, {
        //   application: true,
        //   nodeId: true
        // })
      )
      .join(",");
    console.log(
      refToString(graph, g.owner, { nodeId: true }) + "-[" + refs + "]"
    );
  });
}

export function printReducible(
  graph: NodeGraph,
  flags?: PrintFlags,
  include?: NodeRef[]
) {
  graph.nodes
    .filter(n => n.reducible || include?.includes(n.nodeId))
    .forEach(g => {
      console.log(refToString(graph, g.nodeId, flags));
    });
}

export function reduceGraph(graph: NodeGraph) {
  const flags = {
    nodeId: true,
    application: true,
    reducible: true,
    appFlags: { nodeId: true }
  };
  // printGraph(graph, flags);
  // printReducible(graph, flags);
  do {
    var reducedNodes: NodeRef[] = [];
    var current = 0;
    while (current < graph.nodes.length) {
      const g = graphNode(graph, current);
      if (g.reducible && g.application) {
        reducedNodes.push(current);
        reduce(graph, current);
      }
      current++;
    }
    // console.log("REDUCED NODES=" + reducedNodes.length);
    // printReducible(graph, flags, reducedNodes);
  } while (reducedNodes.length > 0);
}

export function addRefinement(t: Type, appNode: TypedNode): Type {
  if (!t.refinements) {
    return { ...t, refinements: [appNode] };
  }
  return { ...t, refinements: [...t.refinements, appNode] };
}
