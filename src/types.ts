import { inspect } from "util";
import color from "cli-color";
import { Expr } from "./expr";

export function arrayType(graph: NodeGraph, ...entries: Type[]): ObjectType {
  return {
    type: "object",
    keyValues: entries.map((value, i) => ({
      key: noDepNode(graph, cnstType(i)),
      value: noDepNode(graph, value),
    })),
  };
}

export function objType(
  graph: NodeGraph,
  ...entries: [Type, Type][]
): ObjectType {
  return {
    type: "object",
    keyValues: entries.map(([k, value]) => ({
      key: noDepNode(graph, k),
      value: noDepNode(graph, value),
    })),
  };
}

export type NodeGraph = {
  nodes: NodeData[];
};

export type NodeRef = number;
export type SymbolTable = { [symbol: string]: NodeRef };

export type Closure = {
  closureId: number;
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
  Unproven = 4,
  Refinement = 8,
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

export interface Refinement {
  original: NodeRef;
  application: NodeRef;
  reduce?: NodeRef;
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
  refinements?: Refinement[];
}

export interface AnyType extends BaseType {
  type: "any";
}

export interface UntypedType extends BaseType {
  type: "untyped";
}

export interface NumberType extends BaseType, PrimValue<number> {
  type: "number";
  value?: number;
}

export interface StringType extends BaseType {
  type: "string";
  value?: string;
}

export interface BoolType extends BaseType, PrimValue<boolean> {
  type: "boolean";
  value?: boolean;
}

export interface ObjectType extends BaseType {
  type: "object";
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

export type PrimType = BoolType | NumberType | StringType;

export interface PrimValue<T> {
  value?: T;
}

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
    references: parent ? [parent] : [],
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

export function assertExpression(node: TypedNode): NodeExpression {
  return assertDefined(nodeData(node).expression);
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

export function cnstType<V extends string | number | boolean>(
  value: V
): PrimType & PrimValue<V> {
  return <PrimType & PrimValue<V>>{ type: typeof value, value };
}

export function isNumber(t: Type): t is NumberType {
  return t.type === "number";
}

export function nodePrimValue<V>(
  node: TypedNode,
  prim: PrimType & PrimValue<V>
): V | undefined {
  const t = nodeType(node);
  assertType(t, prim);
  if (isPrim(t)) {
    return <V | undefined>t.value;
  }
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
    typeOnly = color.magenta(data.nodeId) + "@" + typeOnly;
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
      .map(
        (r) =>
          color.magenta(r.original) +
          ":" +
          refToString(graph, r.application, {
            application: true,
          })
      )
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
      return color.blue("string");
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
      args,
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
  const changedArr = array.map((a) => {
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
  source: Refinement[] | undefined,
  refinements: Refinement[] | undefined
) {
  if (!source) {
    return refinements && refinements.length > 0;
  } else
    return (
      refinements &&
      refinements.some(
        (r) => !source.find((sr) => sr.application === r.application)
      )
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
    return refinement.keyValues.every(({ key, value }) => {
      const ind = source.keyValues.findIndex((kv) =>
        valueEqualsRef(graph, key, kv.key)
      );
      if (ind >= 0) {
        return isRefinementOfRef(graph, source.keyValues[ind].value, value);
      } else {
        return false;
      }
    });
  }
  if (isPrim(source)) {
    return false;
  }
  console.log(source, "AND", refinement);
  throw new Error("Don't know how to check if already refine yet");
}

export function refineType(
  graph: NodeGraph,
  sourceRef: NodeRef,
  source: Type,
  refinement: Type
): Type | undefined {
  const refinements = refinement.refinements;
  function withRefinements(newType: Type) {
    if (!refinements || refinements.length == 0) {
      return newType;
    } else {
      const srcRefine = newType.refinements ?? [];
      const extraRefine = refinements
        .filter(
          (r) => !srcRefine.find((sr) => sr.application === r.application)
        )
        .map((r) => {
          const appNode = graphNode(graph, r.application);
          assertAppNode(appNode);
          const oldApp = appNode.application;
          const newAppRef = newNode(graph, appNode.type).nodeId;
          const argsNode = graphNode(graph, oldApp.args);
          const newArgsNode = newNode(graph, untyped, newAppRef).nodeId;
          assertType(argsNode.type, objectTypeName);
          const newArgsType = withObjectType(argsNode.type, (o) => {
            if (o === r.original) {
              return sourceRef;
            }
            addDependency(graph, o, newArgsNode);
            return o;
          });
          updateNodePart(graph, newArgsNode, { type: newArgsType });
          updateNodePart(graph, newAppRef, {
            flags: NodeFlags.Reducible | NodeFlags.Refinement,
            application: { func: appNode.application.func, args: newArgsNode },
          });
          return { ...r, reduce: newAppRef };
        });
      // extraRefine.forEach(n =>
      //   console.log(nodeToString(n, { application: true, nodeId: true }))
      // );
      if (extraRefine.length == 0) {
        return newType;
      }
      return {
        ...newType,
        refinements: [...srcRefine, ...extraRefine],
      };
    }
  }

  if (source === refinement) {
    return source;
  }
  if (isUntyped(refinement)) {
    return withRefinements(source);
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
      if (refinement.value === undefined) {
        return withRefinements(source);
      }
      if (source.value === undefined) {
        return withRefinements({
          ...source!,
          value: refinement.value!,
        } as PrimType);
      } else {
        return undefined;
      }
    }
    return withRefinements(source);
  }
  if (isObjectType(source) && isObjectType(refinement)) {
    // console.log(
    //   "Refining:" + typeToString(source) + " with " + typeToString(refinement)
    // );
    const result = refineObjects(graph, source, refinement);
    // console.log(`Resulting in ${result === source} ${typeToString(result)}`);
    return withRefinements(result);
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
    const ind = source.keyValues.findIndex((kv) =>
      valueEqualsRef(graph, key, kv.key)
    );
    if (ind >= 0) {
      const exKV = source.keyValues[ind];
      changed = refineRef(graph, exKV.value, value) || changed;
      changed = refineRef(graph, exKV.key, key) || changed;
    } else {
      newFields.push({ key, value });
    }
  });
  if (newFields.length) {
    return {
      ...source,
      keyValues: [...source.keyValues, ...newFields],
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
  updateNode(graph, ref, (n) => ({
    ...n,
    references: [...n.references, dependency],
  }));
}

export function markReducible(graph: NodeGraph, nodes: NodeRef[]) {
  nodes.forEach((n) => {
    updateNode(graph, n, (nd) => ({
      ...nd,
      flags: nd.flags | NodeFlags.Reducible,
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
  const type = refineType(graph, source, sourceType, refinement);
  if (type === undefined) {
    console.log(
      "Failed to refine node: " +
        refToString(graph, source, { application: true }) +
        " to " +
        typeToString(graph, refinement)
    );
    throw new Error("Failed to refine");
  }
  if (type !== sourceType) {
    node = updateNodePart(graph, source, { type });
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
    if (data.type.refinements) {
      data.type.refinements
        .filter((r) => r.reduce !== undefined)
        .forEach((r) => {
          reduce(graph, r.reduce!);
        });
    }
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
      (fl) => fl & ~(NodeFlags.Expandable | NodeFlags.Reducible)
    );
    doReduce(graph, data, ref);
  }
}

export function doReduce(graph: NodeGraph, data: NodeData, ref: NodeRef) {
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

export function reduceObjectType(
  graph: NodeGraph,
  obj: ObjectType,
  flags?: ReduceFlags
): void {
  function reduceRef(ref: NodeRef) {
    reduce(graph, ref);
  }
  obj.keyValues.forEach((kv) => {
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
      keyValues: [...type.keyValues, { key: newKey, value: newType }],
    });
    return [nodeRef(graph, newKey), nodeRef(graph, newType)];
  }
  return [nodeRef(graph, kv.key), nodeRef(graph, kv.value)];
}

export function unify(
  graph: NodeGraph,
  node: NodeRef,
  node2: NodeRef,
  includeValues: boolean = true
): void {
  const n2Value = lookupType(graph, node2);
  const nValue = lookupType(graph, node);
  refine(graph, node, includeValues ? n2Value : withoutValue(graph, n2Value));
  refine(graph, node2, includeValues ? nValue : withoutValue(graph, nValue));
}

export function unifyNode(
  node: TypedNode,
  node2: TypedNode,
  includeValues: boolean = true
): void {
  unify(node.graph, node.ref, node2.ref, includeValues);
}

export function newExprNode(
  graph: NodeGraph,
  closure: Closure,
  expr: Expr,
  parent?: NodeRef
) {
  return newNode(graph, untyped, parent, undefined, {
    closure,
    expr,
  }).nodeId;
}

var closureCount = 1;
export function newClosure(symbols: SymbolTable, parent?: Closure): Closure {
  return {
    closureId: closureCount++,
    parent,
    symbols,
  };
}

export function exprToClosure(
  graph: NodeGraph,
  expr: Expr,
  parent: Closure
): [Closure, NodeRef] {
  const symbols: SymbolTable = {};
  const closure = newClosure(symbols, parent);
  var current = expr;
  while (current.tag === "let") {
    const newNode = newExprNode(graph, closure, current.expr);
    symbols[current.symbol] = newNode;
    current = current.in;
  }
  const result = newExprNode(graph, closure, current);
  return [closure, result];
}

export function updateFlags(
  graph: NodeGraph,
  ref: NodeRef,
  f: (d: NodeFlags) => NodeFlags
) {
  return updateNode(graph, ref, (nd) => ({ ...nd, flags: f(nd.flags) }));
}

export function updateNode(
  graph: NodeGraph,
  ref: NodeRef,
  f: (d: NodeData) => NodeData
): NodeData {
  const res = f(graphNode(graph, ref));
  graph.nodes[res.nodeId] = res;
  return res;
}

export function updateNodePart(
  graph: NodeGraph,
  ref: NodeRef,
  upd: Partial<NodeData>
): NodeData {
  return updateNode(graph, ref, (n) => ({ ...n, ...upd }));
}

export function expand(
  graph: NodeGraph,
  node: ExpressionNode,
  mkChild?: (
    graph: NodeGraph,
    closure: Closure,
    expr: Expr,
    parent: NodeRef
  ) => NodeRef
) {
  const { expr, closure } = node.expression;
  const nodeId = node.nodeId;
  updateNodePart(graph, nodeId, {
    flags: node.flags & ~NodeFlags.Expandable,
  });
  if (!mkChild) {
    mkChild = newExprNode;
  }
  switch (expr.tag) {
    case "apply":
      const func = mkChild(graph, closure, expr.function, nodeId);
      const args = mkChild(graph, closure, expr.args, nodeId);
      updateNodePart(graph, nodeId, {
        application: {
          func,
          args,
        },
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
      const keyValues = expr.entries.map((kv) => {
        const key = mkChild!(graph, closure, kv.key, nodeId);
        const value = mkChild!(graph, closure, kv.value, nodeId);
        return { key, value };
      });
      refine(graph, nodeId, { type: "object", keyValues });
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
        },
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
      const [closure, funcNode] = exprToClosure(graph, funcExpr, parent);
      var allNodes = Object.values(closure.symbols);
      closure.symbols["args"] = args.ref;
      updateNodePart(graph, result.ref, {
        reduce() {
          allNodes.forEach((n) => reduce(graph, n));
          reduce(graph, funcNode);
          unify(graph, funcNode, result.ref);
        },
      });
      markReducible(graph, [result.ref]);
    },
  });
  return { graph, ref: node.nodeId };
}

export function printGraph(
  graph: NodeGraph,
  f: (nd: NodeData) => boolean,
  flags?: PrintFlags
) {
  graph.nodes.filter(f).forEach((g) => {
    var deps = graph.nodes
      .filter((n) => n.references.includes(g.nodeId))
      .map((d) => d.nodeId)
      .join(", ");
    const typeRef = g.typeRef ? " !" + g.typeRef : "";
    console.log(
      refToString(graph, g.nodeId, flags) +
        color.bold(" [" + deps + "]" + typeRef)
    );
  });
}

export function addRefinementNode(
  graph: NodeGraph,
  ref: NodeRef,
  refinement: Refinement
): void {
  const n = graphNode(graph, ref);
  if (n.typeRef !== undefined) {
    return addRefinementNode(graph, n.typeRef, refinement);
  }
  if (missingRefinements(n.type.refinements, [refinement])) {
    updateNode(graph, ref, (nd) => {
      const t = nd.type;
      return {
        ...nd,
        type: {
          ...t,
          refinements: [refinement, ...(t.refinements ? t.refinements : [])],
        },
      };
    });
    markReducible(graph, [ref]);
  }
}

export function copyNewNode(
  graph: NodeGraph,
  typeRef: NodeRef,
  parent?: NodeRef
): NodeRef {
  const nd = newNode(graph, untyped, parent);
  const type = copyType(graph, lookupType(graph, typeRef), nd.nodeId);
  nd.type = type;
  return nd.nodeId;
}

export function withObjectType(
  type: ObjectType,
  f: (n: NodeRef) => NodeRef
): ObjectType {
  const keyValues = type.keyValues.map((kv) => {
    const key = f(kv.key);
    const value = f(kv.value);
    return { key, value };
  });
  return { type: "object", keyValues };
}

export function copyType(graph: NodeGraph, type: Type, parent?: NodeRef): Type {
  switch (type.type) {
    case "object":
      return withObjectType(type, (t) => copyNewNode(graph, t, parent));
    default:
      return type;
  }
}

export function withoutValue(
  graph: NodeGraph,
  type: Type,
  parent?: NodeRef
): Type {
  switch (type.type) {
    case "string":
    case "number":
    case "boolean":
      return { ...type, value: undefined };
    case "object":
      return withObjectType(type, (n) => {
        const nn = newNode(
          graph,
          withoutValue(graph, lookupType(graph, n), parent)
        );
        return nn.nodeId;
      });
    default:
      return type;
  }
}
