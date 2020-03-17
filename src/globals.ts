import {
  numberType,
  cnstType,
  applyRef,
  ref,
  Expr,
  cnst,
  FunctionType,
  SymbolTable,
  getStringValue,
  node,
  findField,
  numberOp,
  isObjectNode,
  unifyNode,
  nodeToString,
  emptyObject,
  typeToString,
  refineNode,
  Closure,
  reduceToObject,
  reduceNode,
  isPrim,
  boolType,
  nodeRef,
  refineToType,
  nodeData,
  findSymbol,
  nodeType,
  refineRef,
  refine,
  NodeGraph,
  reduce,
  noDepNode,
  newNode,
  untyped,
  isBoolType,
  addRefinement,
  refToString,
  SymbolExpr
} from "./types";

const fieldRef: FunctionType = {
  type: "function",
  name: "fieldRef",
  reduce(result, args) {
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    reduceToObject(arg0, { keys: true });
    refineToType(arg0, emptyObject(args));

    const arg1Type = nodeType(arg1);
    if (isPrim(arg1Type) && arg1Type.value !== undefined) {
      const [, fieldNode] = findField(arg0, arg1Type.value);
      reduceNode(fieldNode);
      unifyNode(fieldNode, result);
    } else {
      console.log(nodeToString(args));
      throw new Error("Fields must be prims");
    }
  }
};

function refBoolFunc(
  name: string,
  c: (v1: string | number | boolean, v2: string | number | boolean) => boolean,
  unifyEq: boolean
): FunctionType {
  return {
    type: "function",
    name,
    reduce(result, args) {
      reduceToObject(args);
      const [, arg0] = findField(args, 0);
      const [, arg1] = findField(args, 1);
      refineToType(result, boolType);
      const resType = nodeType(result);
      const expectedValue = isBoolType(resType) ? resType.value : undefined;
      if (unifyEq && expectedValue === true) {
        unifyNode(arg0, arg1);
      }
      const arg0Type = nodeType(arg0);
      const arg1Type = nodeType(arg1);
      if (
        isPrim(arg0Type) &&
        isPrim(arg1Type) &&
        arg0Type.value !== undefined &&
        arg1Type.value !== undefined
      ) {
        refineToType(result, cnstType(c(arg0Type.value, arg1Type.value)));
      } else {
        refineToType(arg0, addRefinement(arg0Type, result));
        refineToType(arg1, addRefinement(arg1Type, result));
      }
    }
  };
}

const eqRef: FunctionType = refBoolFunc("==", (v1, v2) => v1 === v2, true);
const ltRef: FunctionType = refBoolFunc("<", (v1, v2) => v1 < v2, false);

const addFunc: FunctionType = {
  type: "function",
  name: "add",
  reduce(result, args) {
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    refineToType(arg0, numberType);
    refineToType(arg1, numberType);
    const numValue = numberOp(arg0, arg1, (a, b) => a + b);
    const resultVal = numValue !== undefined ? cnstType(numValue) : numberType;
    // console.log(
    //   `0: ${nodeToString(arg0, { nodeId: true })} 1:${nodeToString(arg1, {
    //     nodeId: true
    //   })} result: ${nodeToString(result, { nodeId: true })} 2: ${typeToString(
    //     result.graph,
    //     resultVal
    //   )}`
    // );
    refineToType(result, resultVal);
  }
};

const ifThenElseFunc: FunctionType = {
  type: "function",
  name: "ifThenElse",
  reduce(result, args) {
    reduceToObject(args);
    const [, condition] = findField(args, 0);
    const [, whenTrue] = findField(args, 1);
    const [, whenFalse] = findField(args, 1);
    refineToType(condition, boolType);
  }
};

const refineFunc: FunctionType = {
  type: "function",
  name: "refine",
  reduce(result, args) {
    reduceToObject(args);
    const [, application] = findField(args, 0);
    const [, expectedResult] = findField(args, 1);
    refineNode(application, expectedResult);
  }
};

export const globalGraph: NodeGraph = {
  nodes: []
};

export const globals: Closure = {
  symbols: {
    add: noDepNode(globalGraph, addFunc),
    fieldRef: noDepNode(globalGraph, fieldRef),
    "==": noDepNode(globalGraph, eqRef),
    "<": noDepNode(globalGraph, ltRef),
    ifThenElse: noDepNode(globalGraph, ifThenElseFunc),
    refine: noDepNode(globalGraph, refineFunc)
  }
};

export function lookupArg(name: string | number | boolean): Expr {
  return applyRef("fieldRef", ref("args"), cnst(name));
}

// export function defineFunction(
//   graph: NodeGraph,
//   symbols: SymbolTable,
//   name: string,
//   expr: Expr
// ): SymbolTable {
//   const newSyms = { ...symbols };
//   newSyms[name] = addNodeType(graph, {
//     type: "function",
//     name,
//     exec(graph, result, args) {
//       const newsyms = { ...symbols, args };
//       return [
//         {
//           ref: result,
//           refine: untyped,
//           expr: { expr, symbols: newsyms, unexpanded: true },
//           apply: null
//         }
//       ];
//     }
//   });
//   return newSyms;
// }
