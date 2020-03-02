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
  reduceTo
} from "./types";

const fieldRef: FunctionType = {
  type: "function",
  name: "fieldRef",
  reduce(appNode) {
    const { args } = appNode.application;
    const argsObj = reduceToObject(args);
    const [, arg0] = findField(argsObj, 0);
    const [, arg1] = findField(argsObj, 1);
    const fieldName = getStringValue(arg1.type);
    refineNode(arg0, emptyObject);
    const newObjType = reduceToObject(arg0, {
      keys: true
    });
    if (fieldName !== undefined) {
      const [, fieldNode] = findField(newObjType, fieldName);
      unifyNode(fieldNode, appNode);
    } else {
      console.log(nodeToString(argsObj));
      throw new Error("Fields must be strings atm");
    }
  }
};

const eqRef: FunctionType = {
  type: "function",
  name: "==",
  reduce(appNode) {
    return appNode;
  }
};

const addFunc: FunctionType = {
  type: "function",
  name: "add",
  reduce(appNode) {
    const { args, func } = appNode.application;
    const argsObj = reduceToObject(args);
    const [, arg0] = findField(argsObj, 0);
    const [, arg1] = findField(argsObj, 1);
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

export function lookupArg(name: string): Expr {
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
