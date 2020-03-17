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
    keyValues: entries.map(([k, value]) => ({
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
};

export type NodeRef = number;
export type SymbolTable = { [symbol: string]: NodeRef };

export type Closure = {
  parent?: Closure;
  symbols: SymbolTable;
};

export type Application = {
  func: NodeRef;
  args: NodeRef;
};

export type NodeExpression = {
  expr: Expr;
  closure: Closure;
};

export type TypedNode = {
  ref: NodeRef;
  graph: NodeGraph;
};

export type ApplicationNode = NodeData & {
  application: Application;
};

export type ExpressionNode = NodeData & {
  expression: NodeExpression;
};

export enum NodeFlags {
  Expandable = 1,
  Reducible = 2,
  Unproven = 4
}

export interface NodeData {
  type: Type;
  flags: NodeFlags;
  typeRef?: NodeRef;
  nodeId: NodeRef;
  references: NodeRef[];
  expression?: NodeExpression;
  application?: Application;
  reduce?(): void;
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

export function newNode(
  graph: NodeGraph,
  type: Type,
  parent?: NodeRef,
  application?: Application,
  expression?: NodeExpression
): NodeData {
  const nodeId = graph.nodes.length;
  const newNode: NodeData = {
    nodeId,
    flags:
      (expression ? NodeFlags.Expandable : 0) |
      (application ? NodeFlags.Reducible : 0),
    type,
    application,
    expression,
    references: parent ? [parent] : []
  };
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
  return newNode(graph, type).nodeId;
}

export function node(parent: TypedNode, type: Type): NodeRef {
  return newNode(parent.graph, type, parent.ref).nodeId;
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

export function lookupType(graph: NodeGraph, ref: NodeRef): Type {
  const n = graphNode(graph, ref);
  if (n.typeRef !== undefined) {
    return lookupType(graph, n.typeRef);
  }
  return n.type;
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
  return nodeData(node).expression?.expr;
}

export function isNodeApp(node: NodeData): node is ApplicationNode {
  return Boolean(node.application);
}

export function isNodeExpression(node: NodeData): node is ExpressionNode {
  return Boolean(node.expression);
}

export function isExpandableExpression(node: NodeData): node is ExpressionNode {
  return Boolean(node.expression && node.flags & NodeFlags.Expandable);
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
  deps?: boolean;
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
  const data = nodeData(node);
  var typeOnly = typeAndRefinementsToString(node.graph, type, flags);
  const expr = nodeExpr(node);
  if (flags?.expr && expr && data.flags & NodeFlags.Expandable) {
    typeOnly = typeOnly + color.magenta("~" + exprToString(expr));
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
    typeOnly = data.nodeId + "@" + typeOnly;
    // }
  }
  if (flags?.deps) {
    typeOnly = typeOnly + " [" + color.bold(data.references.join(", ")) + "]";
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
    const appNode = newNode(func.graph, untyped, undefined, {
      func: func.ref,
      args
    });
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

export function addDependency(
  graph: NodeGraph,
  ref: NodeRef,
  dependency: NodeRef
) {
  updateNode(graph, ref, n => ({
    ...n,
    references: [...n.references, dependency]
  }));
}

function markReducible(graph: NodeGraph, nodes: NodeRef[]) {
  nodes.forEach(n => {
    updateNode(graph, n, nd => ({
      ...nd,
      flags: nd.flags | NodeFlags.Reducible
    }));
    const nd = graphNode(graph, n);
    markReducible(graph, nd.references);
  });
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
  var node = graphNode(graph, source);
  if (node.typeRef) {
    return refine(graph, node.typeRef, refinement);
  }
  if (node.flags & NodeFlags.Expandable) {
    throw new Error("Can't refine an unexpanded expression @" + source);
  }
  const sourceType = lookupType(graph, source);
  if (isRefinementOf(graph, sourceType, refinement)) {
    return false;
  }
  const type = refineType(graph, sourceType, refinement);
  if (type !== sourceType) {
    node = updateNodePart(graph, source, { type });
    // console.log(
    //   "Mark reducible for " +
    //     refToString(graph, source, {
    //       application: true,
    //       nodeId: true,
    //       appFlags: { nodeId: true }
    //     })
    // );
    markReducible(graph, [node.nodeId]);
    return true;
  }
  return false;
}

export function findSymbol(name: string, closure?: Closure): NodeRef {
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
  reduceNode(node);
  const type = nodeType(node);
  if (isObjectType(type)) {
    reduceObjectType(node.graph, type, flags);
  }
}

export function reduceNode(node: TypedNode): void {
  reduce(node.graph, node.ref);
}

let reduceCount = 0;
export function reduce(graph: NodeGraph, ref: NodeRef): void {
  // let num = reduceCount++;
  // console.log(
  //   num +
  //     " Reducing: " +
  //     refToString(graph, ref, {
  //       nodeId: true,
  //       application: true,
  //       expr: true
  //     })
  // );
  while (true) {
    const data = graphNode(graph, ref);
    if (!(data.flags & (NodeFlags.Expandable | NodeFlags.Reducible))) {
      // console.log(
      //   num +
      //     " Finished: " +
      //     refToString(graph, ref, {
      //       nodeId: true,
      //       application: true,
      //       expr: true
      //     })
      // );
      return;
    }
    updateFlags(
      graph,
      ref,
      fl => fl & ~(NodeFlags.Expandable | NodeFlags.Reducible)
    );
    if (data.reduce) {
      data.reduce();
    } else if (isNodeApp(data)) {
      const app = data.application;
      reduce(graph, app.func);
      const funcType = lookupType(graph, app.func);
      if (isFunctionType(funcType)) {
        funcType.reduce({ graph, ref }, { graph, ref: app.args });
      } else {
        throw new Error("Can't apply to non function");
      }
    } else if (isExpandableExpression(data)) {
      expand(graph, data);
    }
  }
}

export function reduceObjectType(
  graph: NodeGraph,
  obj: ObjectType,
  flags?: ReduceFlags
): void {
  function reduceRef(ref: NodeRef) {
    reduce(graph, ref);
  }
  reduceRef(obj.keyType);
  reduceRef(obj.valueType);
  obj.keyValues.forEach(kv => {
    if (!flags || flags.keys) reduceRef(kv.key);
    if (!flags || flags.values) reduceRef(kv.value);
  });
}

export function findField(
  obj: TypedNode,
  named: string | number | boolean
): [TypedNode, TypedNode] {
  const graph = obj.graph;
  const type = nodeType(obj);
  assertType(type, objectTypeName);
  var kv = type.keyValues.find(({ key }) =>
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

export function unify(graph: NodeGraph, node: NodeRef, node2: NodeRef): void {
  refine(graph, node, lookupType(graph, node2));
  refine(graph, node2, lookupType(graph, node));
}

export function unifyNode(node: TypedNode, node2: TypedNode): void {
  unify(node.graph, node.ref, node2.ref);
}

export function newExprNode(
  graph: NodeGraph,
  closure: Closure,
  expr: Expr,
  parent?: NodeRef
) {
  return newNode(graph, untyped, parent, undefined, {
    closure,
    expr
  }).nodeId;
}

export function exprToClosure(
  graph: NodeGraph,
  expr: Expr,
  parent: Closure,
  unifyWith: NodeRef
): [Closure, NodeRef] {
  const symbols: SymbolTable = {};
  const closure: Closure = {
    parent,
    symbols
  };
  var current = expr;
  while (current.tag === "let") {
    const newNode = newExprNode(graph, closure, current.expr);
    symbols[current.symbol] = newNode;
    current = current.in;
  }
  const result = newExprNode(graph, closure, current);
  // addDependency(graph, unifyWith, result);
  // addDependency(graph, result, unifyWith);
  // updateNodePart(graph, unifyWith, {
  //   typeRef: result
  // });
  return [closure, result];
}

export function updateFlags(
  graph: NodeGraph,
  ref: NodeRef,
  f: (d: NodeFlags) => NodeFlags
) {
  return updateNode(graph, ref, nd => ({ ...nd, flags: f(nd.flags) }));
}

export function updateNode(
  graph: NodeGraph,
  ref: NodeRef,
  f: (d: NodeData) => NodeData
): NodeData {
  const res = f(graph.nodes[ref]);
  graph.nodes[ref] = res;
  return res;
}

export function updateNodePart(
  graph: NodeGraph,
  ref: NodeRef,
  upd: Partial<NodeData>
): NodeData {
  return updateNode(graph, ref, n => ({ ...n, ...upd }));
}

export function expand(graph: NodeGraph, node: ExpressionNode) {
  const { expr, closure } = node.expression;
  const nodeId = node.nodeId;
  updateNodePart(graph, nodeId, {
    flags: node.flags & ~NodeFlags.Expandable
  });
  switch (expr.tag) {
    case "apply":
      const func = newExprNode(graph, closure, expr.function, nodeId);
      const args = newExprNode(graph, closure, expr.args, nodeId);
      updateNodePart(graph, nodeId, {
        application: {
          func,
          args
        }
      });
      markReducible(graph, [nodeId]);
      break;
    case "prim":
      refine(graph, nodeId, cnstType(expr.value));
      break;
    case "primType":
      refine(graph, nodeId, { type: expr.name });
      break;
    case "object":
      const keyValues = expr.entries.map(kv => {
        const key = newExprNode(graph, closure, kv.key, nodeId);
        const value = newExprNode(graph, closure, kv.value, nodeId);
        return { key, value };
      });
      const keyType = newExprNode(graph, closure, expr.keyExpr, nodeId);
      const valueType = newExprNode(graph, closure, expr.valueExpr, nodeId);
      refine(graph, nodeId, { type: "object", keyValues, keyType, valueType });
      break;
    case "let":
      throw new Error("No let's yet");
    case "symbol":
      const sym = findSymbol(expr.symbol, closure);
      addDependency(graph, sym, nodeId);
      updateNodePart(graph, nodeId, {
        typeRef: sym,
        reduce() {
          reduce(graph, sym);
          // console.log("I have been told to reduce " + expr.symbol);
        }
      });
      markReducible(graph, [nodeId]);
      // if (isExpandableExpression(graphNode(graph, sym))) {
      //   reduce(graph, sym);
      // }
      // markReducible(graph, graphNode(graph, nodeId).references);
      break;
  }
}

export function defineFunction(
  graph: NodeGraph,
  name: string,
  parent: Closure,
  funcExpr: Expr
): TypedNode {
  const node = newNode(graph, {
    type: "function",
    name,
    reduce(result, args) {
      const graph = result.graph;
      const [closure, funcNode] = exprToClosure(
        graph,
        funcExpr,
        parent,
        result.ref
      );
      var allNodes = Object.values(closure.symbols);
      closure.symbols["args"] = args.ref;
      updateNodePart(graph, result.ref, {
        reduce() {
          allNodes.forEach(n => reduce(graph, n));
          reduce(graph, funcNode);
          unify(graph, funcNode, result.ref);
        }
      });
      markReducible(graph, [result.ref]);
    }
  });
  return { graph, ref: node.nodeId };
}

export function printGraph(
  graph: NodeGraph,
  f: (nd: NodeData) => boolean,
  flags?: PrintFlags
) {
  graph.nodes.filter(f).forEach(g => {
    var deps = graph.nodes
      .filter(n => n.references.includes(g.nodeId))
      .map(d => d.nodeId)
      .join(", ");
    const typeRef = g.typeRef ? " !" + g.typeRef : "";
    console.log(
      refToString(graph, g.nodeId, flags) +
        color.bold(" [" + deps + "]" + typeRef)
    );
  });
}

export function addRefinement(t: Type, appNode: TypedNode): Type {
  if (!t.refinements) {
    return { ...t, refinements: [appNode] };
  }
  return { ...t, refinements: [...t.refinements, appNode] };
}
