import {
  NativeExpr,
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
  getNodeAndRefine,
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
  isFlagSet
} from "./types";
import { newArg, expr2string, JSExpr } from "./javascript";

const fieldRef: NativeExpr = {
  tag: "native",
  node: (g, s) => {
    return addNode(g, {
      type: {
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
                    refinement: { refine: singleField(graph, obj, result) }
                  }
                ];
              } else {
                return unify(graph, result, field);
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
      }
    });
  }
};

const addFunc: NativeExpr = {
  tag: "native",
  node: g =>
    addNode(g, {
      type: {
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
              const arg1N = getNodeAndRefine(
                refinements,
                graph,
                arg1,
                numberType
              );
              const arg2N = getNodeAndRefine(
                refinements,
                graph,
                arg2,
                numberType
              );
              if (
                isNumber(arg1N.type) &&
                isNumber(arg2N.type) &&
                arg1N.type.value !== undefined &&
                arg2N.type.value !== undefined
              ) {
                getNodeAndRefine(
                  refinements,
                  graph,
                  result,
                  mkValuePrim(arg1N.type.value + arg2N.type.value)
                );
              } else {
                getNodeAndRefine(refinements, graph, result, numberType);
              }
              return refinements;
            } else {
              console.log("No args");
            }
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
      }
    })
};

export function globals(expr: Expr): Expr {
  return letExpr("add", addFunc, letExpr("fieldRef", fieldRef, expr));
}

export function argName(name: string, expr: Expr): NativeExpr {
  return {
    tag: "native",
    node: (g, s) => nodeFromExpr(g, s, expr)
  };
}

export function lookupArg(name: string): Expr {
  return applyRef("fieldRef", ref("args"), cnst(name));
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
