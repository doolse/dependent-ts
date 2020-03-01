import { JSExpr, JSFunctionDef, newArg, stmt2string } from "./javascript";
import { inspect } from "util";
import color from "cli-color";

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

export type SymbolTable = { [symbol: string]: TypedNode };
export type Closure = { parent?: Closure; symbols: SymbolTable };

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

export function arrayType(...entries: Type[]): ObjectType {
  return {
    type: "object",
    keyType: node(untyped),
    valueType: node(untyped),
    keyValues: entries.map((value, i) => ({
      key: node(cnstType(i)),
      value: node(value)
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

export type NodeRef = number;

export type Application = {
  func: TypedNode;
  args: TypedNode;
};

export type TypedNode = TypedNodeT<Type>;

export type ApplicationNode = TypedNode & {
  application: Application;
};

export interface TypedNodeT<T extends Type> {
  type: T;
  expr?: Expr;
  application?: Application;
  reducible?: boolean;
  closure?: Closure;
  symbol?: string;
}

export type ReduceFlags = {
  object?: boolean;
  keys?: boolean;
  values?: boolean;
};

export function isAppNode(node: TypedNode): node is ApplicationNode {
  return Boolean(node.application);
}

export interface NodeTuple {
  key: TypedNode;
  value: TypedNode;
}

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
  keyType: TypedNode;
  valueType: TypedNode;
  keyValues: NodeTuple[];
}

export interface FunctionType {
  type: "function";
  name: string;
  exec(app: ApplicationNode): TypedNode;
  // toJSExpr?(
  //   graph: NodeGraph,
  //   result: NodeRef,
  //   args: NodeRef,
  //   funcDef: JSContext
  // ): [JSContext, JSExpr];
}

export type PrimType = StringType | NumberType | BoolType;

export const anyType: AnyType = { type: "any" };
export const untyped: UntypedType = { type: "untyped" };
export const numberType: NumberType = { type: "number" };
export const boolType: BoolType = { type: "boolean" };
export const stringType: StringType = { type: "string" };

export const emptyObject: ObjectType = {
  type: "object",
  keyValues: [],
  keyType: node(untyped),
  valueType: node(untyped)
};

export function node(type: Type): TypedNode {
  return {
    type
  };
}

export function isFunctionType(t: Type): t is FunctionType {
  return t.type === "function";
}

export function isObjectType(t: Type): t is ObjectType {
  return t.type === "object";
}

export function isObjectNode(t: TypedNode): t is TypedNodeT<ObjectType> {
  return isObjectType(t.type);
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

export function getNumberValue(t: TypedNode): number | undefined {
  if (isNumber(t.type)) {
    return t.type.value;
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
  reducible?: boolean;
  application?: boolean;
  appFlags?: PrintFlags;
};

export function nodeToString(typedNode: TypedNode, flags?: PrintFlags): string {
  var typeOnly = typeToString(typedNode.type, flags);
  if (flags?.expr && typedNode.expr) {
    typeOnly = typeOnly + color.magenta("~" + exprToString(typedNode.expr));
  }
  if (flags?.reducible && isReducibleNode(typedNode) && typedNode.reducible) {
    typeOnly = color.red("*") + typeOnly;
  }
  if (flags?.application && typedNode.application) {
    typeOnly =
      " " +
      typeOnly +
      color.underline(
        `~` +
          nodeToString(typedNode.application.func, flags?.appFlags) +
          "(" +
          nodeToString(typedNode.application.args, flags?.appFlags) +
          ")"
      );
  }
  if (typedNode.symbol) {
    typeOnly = typeOnly + color.italic("%" + typedNode.symbol);
  }
  return typeOnly;
}

export function typeToString(type: Type, flags?: PrintFlags): string {
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
        return `${nodeToString(key, flags)}: ${nodeToString(value, flags)}`;
      });
      return `{ ${fields.join(", ")} }`;
    default:
      return color.blue(type.type);
  }
}

export function applyFunction(
  func: TypedNode,
  args: TypedNode
): ApplicationNode {
  if (isFunctionType(func.type)) {
    const result = reduce({
      type: untyped,
      application: { func, args },
      reducible: true
    });
    if (isAppNode(result)) {
      return result;
    }
    throw new Error("Not an app node");
  }
  throw new Error("Trying to apply not a function");
}

export function inspectAll(a: any) {
  return inspect(a, false, null, true);
}

export function valueEqualsNode(one: TypedNode, two: TypedNode): boolean {
  return valueEqualsType(one.type, two.type);
}

export function valueEqualsType(one: Type, two: Type): boolean {
  if (isPrim(one) && isPrim(two)) {
    return one.value === two.value;
  }
  return false;
}

export function typeEquals(one: Type, two: Type): boolean {
  return isRefinementOf(one, two) && isRefinementOf(two, one);
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
  return (
    !(refinement.reducible === false && canReduce(source)) &&
    isRefinementOf(source.type, refinement.type)
  );
}

export function isRefinementOf(source: Type, refinement: Type): boolean {
  if (source === refinement) {
    return true;
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
      isRefinementOfNode(source.keyType, refinement.keyType) &&
      isRefinementOfNode(source.valueType, refinement.valueType) &&
      refinement.keyValues.every(({ key, value }) => {
        const ind = source.keyValues.findIndex(kv =>
          valueEqualsNode(key, kv.key)
        );
        if (ind >= 0) {
          return isRefinementOfNode(source.keyValues[ind].value, value);
        } else {
          return (
            isRefinementOfNode(source.keyType, key) &&
            isRefinementOfNode(source.valueType, value)
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

export function refineType(source: Type, refinement: Type): Type {
  if (source === refinement) {
    return source;
  }
  if (isUntyped(refinement)) {
    if (!isUntyped(source)) {
      throw new Error("Can't refine back to untyped");
    }
    return source;
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
        return cnstType(refinement.value!);
      } else {
        throw new Error(
          "Can't refine value from " + source.value + " to " + refinement.value
        );
      }
    }
    return source;
  }
  if (isObjectType(source) && isObjectType(refinement)) {
    // console.log(
    //   "Refining:" + typeToString(source) + " with " + typeToString(refinement)
    // );
    const newKeyValues = refinement.keyValues.reduce(
      (changes, { key, value }) => {
        const ind = source.keyValues.findIndex(kv =>
          valueEqualsNode(key, kv.key)
        );
        var newValue: TypedNode | null = null;
        var newKey: TypedNode | null = null;
        if (ind >= 0) {
          const exKV = source.keyValues[ind];
          newValue = refineNode(exKV.value, value);
          newKey = refineNode(exKV.key, key);
          if (newValue === exKV.value) {
            newValue = null;
          }
          if (newKey === exKV.key) {
            newKey = null;
          }
        }
        if (newValue || newKey || ind == -1) {
          changes = changes ? changes : [...source.keyValues];
          if (ind == -1) {
            changes.push({
              key: refineNode(source.keyType, key),
              value: refineNode(source.valueType, value)
            });
          } else {
            const { key, value } = changes[ind];
            changes[ind] = {
              key: newKey ? newKey : key,
              value: newValue ? newValue : value
            };
          }
        }
        return changes;
      },
      null as NodeTuple[] | null
    );
    const newKeyType = refineNode(source.keyType, refinement.keyType);
    const newValueType = refineNode(source.valueType, refinement.valueType);
    if (
      newKeyValues !== null ||
      newKeyType !== source.keyType ||
      newValueType !== source.valueType
    ) {
      return {
        ...source,
        keyValues: newKeyValues ?? source.keyValues,
        keyType: newKeyType,
        valueType: newValueType
      };
    }
    return source;
  }
  debugger;
  throw new Error(
    "Don't know how to refine this yet: " +
      inspect(source, false, null, true) +
      " AND " +
      inspect(refinement, false, null, true)
  );
}

export function printClosure(closure: Closure, flags?: PrintFlags) {
  return printSymbols(closure.symbols, flags);
}

export function printSymbols(symbols: SymbolTable, flags?: PrintFlags): string {
  const symStrings = Object.entries(symbols).map(
    ([sym, node]) => `${sym}: ${nodeToString(node, flags)} ${node.reducible}`
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

function printAppChange(
  app: Application | undefined,
  app2: Application | undefined
): string {
  if (app && app2) {
    return `func: ${printDiff(app.func, app2.func)} args: ${printDiff(
      app.args,
      app2.args
    )}`;
  }
  if (app2) {
    return `Was nothing now: func: ${nodeToString(
      app2.func
    )} args: ${nodeToString(app2.args)}`;
  }
  if (app)
    return `Becoming undefined! func: ${nodeToString(
      app.func
    )} args: ${nodeToString(app.args)}`;
  throw new Error("Don't think this should happen");
}

export function refineNode(
  source: TypedNode,
  refinement: TypedNode
): TypedNode {
  const type = refineType(source.type, refinement.type);

  const application = !source.application
    ? refinement.application
    : refinement.application
    ? refineApp(source.application, refinement.application)
    : source.application;

  const argsReducible = application
    ? canReduce(application.args, { keys: true, values: true })
    : false;
  const changedApp = source.application !== application;
  const changedType = type !== source.type;
  const reducible = isReducibleNode(source) && (changedType || argsReducible);

  if (changedType || changedApp) {
    if (source.symbol && source.closure) {
      const symTable = findSymbol(source.symbol, source.closure);
      const newSym = refineToType(symTable, type);
      if (newSym !== symTable) {
        // console.log(`Symbol update ${source.symbol} ${nodeToString(symTable)}
        // ${typeToString(type)}`);
        source.closure.symbols[source.symbol] = newSym;
      }
    }

    return {
      ...source,
      type,
      application,
      reducible
    };
  }
  if (Boolean(source.reducible) !== reducible) {
    return { ...source, reducible };
  }
  return source;
}

function findSymbol(name: string, closure?: Closure): TypedNode {
  while (closure) {
    const node = closure.symbols[name];
    if (node) {
      return node;
    }
    closure = closure.parent;
  }
  throw new Error("No symbol for" + name);
}

export function reduceToObject(
  node: TypedNode,
  flags?: ReduceFlags
): TypedNodeT<ObjectType> {
  return reduceTo(node, emptyObject, flags ?? { keys: true, values: true });
}

export function reduceTo<T extends Type>(
  node: TypedNode,
  type: T,
  flags?: ReduceFlags
): TypedNodeT<T> {
  const n = reduce(node, flags);
  if (isNodeOfType(n, type)) {
    return n;
  }
  throw new Error("Not of the right type");
}

let counter = 0;
export function reduce(node: TypedNode, flags?: ReduceFlags): TypedNode {
  let count = counter++;
  while (canReduce(node, flags)) {
    if (isAppNode(node)) {
      let { func, args } = node.application;
      if (isFunctionType(func.type)) {
        console.log(
          `${func.type.name} ${count}-IN ${nodeToString(args, {
            reducible: true
          })} ${nodeToString(node)}`
        );
        node = func.type.exec(node);
        console.log(
          `${func.type.name} ${count}-OUT ${nodeToString(
            node.application!.args,
            {
              reducible: true,
              application: count == 66 || count == 1,
              appFlags: {
                reducible: true
              }
            }
          )} ${nodeToString(node, {
            reducible: true,
            application: count == 66 || count == 1,
            appFlags: {
              reducible: true
            }
          })}`
        );
      } else {
        node = {
          ...node,
          application: { func: reduce(func, undefined), args },
          reducible: true
        };
      }
    } else if (node.symbol) {
      const lookedUp = findSymbol(node.symbol, node.closure);
      if (!lookedUp) {
        throw new Error(`Couldn't find: ${node.symbol}`);
      }
      node = refineToType(node, lookedUp.type);
    } else if (
      (flags?.object || flags?.keys || flags?.values) &&
      isObjectNode(node)
    ) {
      node = refineNode(node, { type: reduceObjectType(node.type, flags) });
    } else {
      console.log(inspect(node, false, 1, true));
      throw new Error("Don't know how to reduce this");
    }
  }
  return node;
}

export function reduceObjectType(
  obj: ObjectType,
  flags?: ReduceFlags
): ObjectType {
  const keyType = reduce(obj.keyType, undefined);
  const valueType = reduce(obj.valueType, undefined);
  const keyValues = mapChanges(obj.keyValues, kv => {
    const newKey = flags?.keys ? reduce(kv.key, undefined) : kv.key;
    const newValue = flags?.values ? reduce(kv.value, undefined) : kv.value;
    return newKey !== kv.key || newValue !== kv.value
      ? { key: newKey, value: newValue }
      : kv;
  });
  return keyType !== obj.keyType ||
    valueType !== obj.valueType ||
    keyValues !== obj.keyValues
    ? { ...obj, keyValues, keyType, valueType }
    : obj;
}

export function canReduceObject(
  node: TypedNodeT<ObjectType>,
  flags?: ReduceFlags
): boolean {
  return (
    canReduce(node.type.keyType) ||
    canReduce(node.type.valueType) ||
    node.type.keyValues.some(
      ({ key, value }) =>
        (flags?.keys && canReduce(key)) || (flags?.values && canReduce(value))
    )
  );
}

export function isReducibleNode(node: TypedNode): boolean {
  return Boolean(node.application || node.symbol);
}

export function canReduce(node: TypedNode, flags?: ReduceFlags): boolean {
  if (flags?.object || flags?.keys || flags?.values) {
    if (isObjectNode(node)) {
      return canReduceObject(node, flags);
    }
  }
  return isReducibleNode(node) ? Boolean(node.reducible) : false;
}

export function findField(
  obj: TypedNodeT<ObjectType> | null,
  named: string | number | boolean
): [TypedNode, TypedNode] {
  var kv = obj?.type.keyValues.find(({ key, value }) =>
    primEquals(key.type, named)
  );
  if (!kv) {
    return [node(cnstType(named)), node(untyped)];
  }
  return [kv.key, kv.value];
}

export function isOfType<T extends Type>(t: Type, t2: T): t is T {
  return t.type === t2.type;
}

export function isNodeOfType<T extends Type>(
  t: TypedNode,
  t2: T
): t is TypedNodeT<T> {
  return isOfType(t.type, t2);
}

export function refineFields(
  node: TypedNodeT<ObjectType>,
  ...fields: NodeTuple[]
): TypedNode {
  return refineToType(node, { ...node.type, keyValues: fields });
}

export function refineToType(t: TypedNode, type: Type): TypedNode {
  return refineNode(t, { type });
}

export function unifyNode(
  node: TypedNode,
  node2: TypedNode
): [TypedNode, TypedNode] {
  const lRef = isRefinementOfNode(node, node2);
  const rRef = isRefinementOfNode(node2, node);
  if (lRef && rRef) {
    return [node, node2];
  }
  return [
    rRef ? refineToType(node, node2.type) : node,
    lRef ? refineToType(node2, node.type) : node2
  ];
}

export function exprToNode(exprs: Expr, closure: Closure): TypedNode {
  function recurse(expr: Expr): TypedNode {
    function mkExprNode(type: Type): TypedNode {
      return { type, expr, closure };
    }
    switch (expr.tag) {
      case "apply":
        return {
          ...mkExprNode(untyped),
          application: {
            func: recurse(expr.function),
            args: recurse(expr.args)
          },
          reducible: true
        };
      case "prim":
        return mkExprNode(cnstType(expr.value));
      case "primType":
        return mkExprNode({ type: expr.name });
      case "object":
        const keyValues = expr.entries.map(kv => {
          const key = recurse(kv.key);
          const value = recurse(kv.value);
          return { key, value };
        });
        const keyType = recurse(expr.keyExpr);
        const valueType = recurse(expr.valueExpr);
        return mkExprNode({ type: "object", keyValues, keyType, valueType });
      case "symbol":
        return {
          ...mkExprNode(untyped),
          reducible: true,
          symbol: expr.symbol
        };
      case "let":
        closure.symbols[expr.symbol] = recurse(expr.expr);
        return recurse(expr.in);
    }
  }
  return recurse(exprs);
}

export function defineFunction(
  name: string,
  parent: Closure,
  expr: Expr
): TypedNode {
  return {
    type: {
      type: "function",
      name,
      exec(appNode) {
        const { args, func } = appNode.application;
        const closure = {
          parent,
          symbols: { args }
        };
        const afterRefine = reduce(exprToNode(expr, closure));

        console.log("CLOSURE " + printClosure(closure));
        console.log(
          "REFINED" +
            nodeToString(afterRefine, {
              application: true,
              appFlags: { application: true, appFlags: { application: true } }
            })
        );
        return {
          ...afterRefine,
          application: { args: closure.symbols.args, func }
        };
      }
    }
  };
}
