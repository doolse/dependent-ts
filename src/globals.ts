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
  canReduceObject,
  reduceNode,
  reduceTo,
  isPrim,
  boolType,
  nodeRef,
  refineToType,
  nodeData,
  nodeType,
  refineRef,
  refine,
  NodeGraph,
  reduce,
  noDepNode
} from "./types";

const fieldRef: FunctionType = {
  type: "function",
  name: "fieldRef",
  reduce(result, args) {
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    refineToType(arg0, emptyObject(args));
    reduceToObject(arg0, { keys: true });
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

const eqRef: FunctionType = {
  type: "function",
  name: "==",
  reduce(result, args) {
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    refineToType(result, boolType);
    const arg0Type = nodeType(arg0);
    const arg1Type = nodeType(arg1);
    if (isPrim(arg0Type) && isPrim(arg1Type)) {
      if (arg0Type.value !== undefined && arg1Type.value !== undefined) {
        refineToType(result, cnstType(arg0Type.value === arg1Type.value));
      }
    }
  }
};

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
    console.log(
      `0: ${nodeToString(arg0, { nodeId: true })} 1:${nodeToString(arg1, {
        nodeId: true
      })}`
    );
    refineToType(result, resultVal);
  }
};

export const globalGraph: NodeGraph = { nodes: [], types: [] };

export const globals: Closure = {
  symbols: {
    add: noDepNode(globalGraph, addFunc),
    fieldRef: noDepNode(globalGraph, fieldRef),
    "==": noDepNode(globalGraph, eqRef)
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
