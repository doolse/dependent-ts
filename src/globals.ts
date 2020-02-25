import {
  addNode,
  findField,
  getNode,
  nodeToString,
  isStringType,
  singleField,
  unify,
  isObjectType,
  reduceKeys,
  reduceAll,
  getAndRefine,
  Refinements,
  toJS,
  numberType,
  mkValuePrim,
  isNumber,
  letExpr,
  NodeGraph,
  nodeFromExpr,
  applyRef,
  ref,
  appendField,
  emptyObject,
  toJSPrimitive,
  Expr,
  JSContext,
  reduce,
  refinementFromNode,
  cnst,
  isFlagSet,
  FunctionType,
  SymbolTable,
  addNodeType,
  simpleRefinement,
  getStringValue,
  untyped,
  needsRefining,
  nodeNeedsRefining,
  boolType,
  Refinement,
  isPrim,
  Type
} from "./types";
import { newArg, expr2string, JSExpr } from "./javascript";
import { networkInterfaces } from "os";

const fieldRef: FunctionType = {
  type: "function",
  name: "fieldRef",
  exec(graph, result, args) {
    const argRefine = reduceKeys(graph, args);
    if (argRefine.length > 0) {
      return argRefine;
    }
    const obj = findField(graph, args, 1);
    const a = findField(graph, args, 0);
    if (a && obj) {
      const vals = reduceAll(graph, obj, a);
      if (vals.length > 0) {
        return vals;
      }
      const key = getNode(graph, obj);
      if (isStringType(key.type) && key.type.value !== undefined) {
        const field = findField(graph, a, key.type.value);
        if (field === null) {
          return [
            {
              ref: a,
              refine: singleField(graph, obj, result, true)
            }
          ];
        } else {
          return unify([], graph, result, field, true);
        }
      }
    }
    throw new Error("Missing args");
  },
  toJSExpr(graph, result, args, jsContext): [JSContext, JSExpr] {
    const obj = findField(graph, args, 1);
    const a = findField(graph, args, 0);
    const key = getNode(graph, obj!);
    if (isStringType(key.type) && key.type.value !== undefined) {
      const fieldName: JSExpr = { type: "symbol", name: key.type.value };
      if (isFlagSet(graph, a!, "inScope")) {
        return [jsContext, fieldName];
      }
      const [nextContext, objJS] = toJS(graph, a!, jsContext);
      return [
        nextContext,
        {
          type: "fieldRef",
          left: objJS,
          right: fieldName
        }
      ];
    }
    throw new Error("Can't get here");
  }
};

const eqRef: FunctionType = {
  type: "function",
  name: "==",
  exec(graph, result, args) {
    const argRefine = reduceKeys(graph, args);
    if (argRefine.length > 0) {
      return argRefine;
    }
    const val1 = findField(graph, args, 0);
    const val2 = findField(graph, args, 1);
    if (val1 && val2) {
      const vals = reduceAll(graph, val1, val2);
      if (vals.length > 0) {
        return vals;
      }
      const n1 = getNode(graph, val1).type;
      const n2 = getNode(graph, val2).type;
      const ref = unify([], graph, val1, val2, false);
      const resultType =
        isPrim(n1) &&
        isPrim(n2) &&
        n1.value !== undefined &&
        n2.value !== undefined
          ? mkValuePrim(n1.value === n2.value)
          : boolType;
      getAndRefine(ref, graph, result, resultType, true);
      return ref;
    }
    throw new Error("Missing args");
  },
  toJSExpr(graph, result, args, jsContext): [JSContext, JSExpr] {
    const arg1 = findField(graph, args, 0);
    const arg2 = findField(graph, args, 1);
    const [f1, left] = toJS(graph, arg1!, jsContext);
    const [f2, right] = toJS(graph, arg2!, f1);
    return [f2, { type: "infix", op: "==", left, right }];
  }
};

const addFunc: FunctionType = {
  type: "function",
  name: "add",
  exec(graph, result, args) {
    if (isObjectType(graph[args].type)) {
      const keys = reduceKeys(graph, args);
      if (keys.length > 0) {
        return keys;
      }
      const arg1 = findField(graph, args, 0);
      const arg2 = findField(graph, args, 1);
      if (arg1 && arg2) {
        const vals = reduceAll(graph, arg1, arg2);
        if (vals.length > 0) {
          return vals;
        }
        const refinements: Refinements = [];
        const arg1N = getAndRefine(refinements, graph, arg1, numberType);
        const arg2N = getAndRefine(refinements, graph, arg2, numberType);
        if (
          isNumber(arg1N.type) &&
          isNumber(arg2N.type) &&
          arg1N.type.value !== undefined &&
          arg2N.type.value !== undefined
        ) {
          getAndRefine(
            refinements,
            graph,
            result,
            mkValuePrim(arg1N.type.value + arg2N.type.value),
            true
          );
        } else {
          getAndRefine(refinements, graph, result, numberType);
        }
        return refinements;
      } else {
        console.log("No args");
      }
    } else {
      return reduce(graph, args);
    }
    return [];
  },
  toJSExpr(graph, result, args, funcDef) {
    const arg1 = findField(graph, args, 0);
    const arg2 = findField(graph, args, 1);
    const [f1, left] = toJS(graph, arg1!, funcDef);
    const [f2, right] = toJS(graph, arg2!, f1);
    return [f2, { type: "infix", op: "+", left, right }];
  }
};

export function declareGlobals(graph: NodeGraph): SymbolTable {
  return {
    add: addNodeType(graph, addFunc),
    fieldRef: addNodeType(graph, fieldRef),
    "==": addNodeType(graph, eqRef)
  };
}

export function argName(name: string, expr: Expr): Expr {
  return expr;
}

export function lookupArg(name: string): Expr {
  return applyRef("fieldRef", ref("args"), cnst(name));
}

export function defineFunction(
  graph: NodeGraph,
  symbols: SymbolTable,
  name: string,
  expr: Expr
): SymbolTable {
  const newSyms = { ...symbols };
  newSyms[name] = addNodeType(graph, {
    type: "function",
    name,
    exec(graph, result, args) {
      const newsyms = { ...symbols, args };
      return [
        {
          ref: result,
          refine: untyped,
          expr: { expr, symbols: newsyms, unexpanded: true },
          apply: null
        }
      ];
    }
  });
  return newSyms;
}
