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
  reduce,
  reduceTo,
  isPrim,
  boolType
} from "./types";

const fieldRef: FunctionType = {
  type: "function",
  name: "fieldRef",
  reduce(appNode) {
    const { args } = appNode.application;
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    refineNode(arg0, emptyObject);
    reduceToObject(arg0, { keys: true });
    if (isPrim(arg1.type) && arg1.type.value !== undefined) {
      const [, fieldNode] = findField(arg0, arg1.type.value);
      unifyNode(fieldNode, appNode);
    } else {
      console.log(nodeToString(args));
      throw new Error("Fields must be prims");
    }
  }
};

const eqRef: FunctionType = {
  type: "function",
  name: "==",
  reduce(appNode) {
    const { args } = appNode.application;
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    refineNode(appNode, boolType);
    if (isPrim(arg0.type) && isPrim(arg1.type)) {
      if (arg0.type.value !== undefined && arg1.type.value !== undefined) {
        refineNode(appNode, cnstType(arg0.type.value === arg1.type.value));
      }
    }
    return appNode;
  }
};

const addFunc: FunctionType = {
  type: "function",
  name: "add",
  reduce(appNode) {
    const { args } = appNode.application;
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    const numValue = numberOp(arg0, arg1, (a, b) => a + b);
    const resultVal = numValue !== undefined ? cnstType(numValue) : numberType;
    refineNode(arg0, numberType);
    refineNode(arg1, numberType);
    refineNode(appNode, resultVal);
  }
};

export const globals: Closure = {
  symbols: {
    add: node(addFunc),
    fieldRef: node(fieldRef),
    "==": node(eqRef)
  },
  nodes: []
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
