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
  reduceToObject,
  findField,
  refineToType,
  numberOp,
  isObjectNode,
  unifyNode,
  refineFields,
  nodeToString,
  emptyObject,
  typeToString,
  refineNode
} from "./types";

const fieldRef: FunctionType = {
  type: "function",
  name: "fieldRef",
  exec(appNode) {
    const { args, func } = appNode.application;
    const argsObj = reduceToObject(args);
    // console.log("fieldRef-args " + nodeToString(argsObj, true));
    const [arg0Key, arg0] = findField(argsObj, 0);
    const [, arg1] = findField(argsObj, 1);
    const fieldName = getStringValue(arg1.type);
    var newObjType = refineToType(arg0, emptyObject);
    if (isObjectNode(newObjType)) {
      if (fieldName !== undefined) {
        const [key, valueType] = findField(newObjType, fieldName);
        const [value, resultValue] = unifyNode(valueType, appNode);
        return refineNode(resultValue, {
          ...resultValue,
          application: {
            args: refineFields(argsObj, {
              key: arg0Key,
              value: refineFields(newObjType, {
                key,
                value
              })
            }),
            func
          }
        });
      } else {
        console.log(nodeToString(argsObj, true));
        throw new Error("Fields must be strings atm");
      }
    } else {
      console.log(newObjType);
      throw new Error("Didn't refine to object");
    }
  }
  // toJSExpr(graph, result, args, jsContext): [JSContext, JSExpr] {
  //   const obj = findField(graph, args, 1);
  //   const a = findField(graph, args, 0);
  //   const key = getNode(graph, obj!);
  //   if (isStringType(key.type) && key.type.value !== undefined) {
  //     const fieldName: JSExpr = { type: "symbol", name: key.type.value };
  //     if (isFlagSet(graph, a!, "inScope")) {
  //       return [jsContext, fieldName];
  //     }
  //     const [nextContext, objJS] = toJS(graph, a!, jsContext);
  //     return [
  //       nextContext,
  //       {
  //         type: "fieldRef",
  //         left: objJS,
  //         right: fieldName
  //       }
  //     ];
  //   }
  //   throw new Error("Can't get here");
  // }
};

const eqRef: FunctionType = {
  type: "function",
  name: "==",
  exec(appNode) {
    return appNode;
    // const argRefine = reduceKeys(graph, args);
    // if (argRefine.length > 0) {
    //   return argRefine;
    // }
    // const val1 = findField(graph, args, 0);
    // const val2 = findField(graph, args, 1);
    // if (val1 && val2) {
    //   const vals = reduceAll(graph, val1, val2);
    //   if (vals.length > 0) {
    //     return vals;
    //   }
    //   const n1 = getNode(graph, val1).type;
    //   const n2 = getNode(graph, val2).type;
    //   const ref = unify([], graph, val1, val2, false);
    //   const resultType =
    //     isPrim(n1) &&
    //     isPrim(n2) &&
    //     n1.value !== undefined &&
    //     n2.value !== undefined
    //       ? mkValuePrim(n1.value === n2.value)
    //       : boolType;
    //   getAndRefine(ref, graph, result, resultType, true);
    //   return ref;
    // }
    // throw new Error("Missing args");
  }
  // toJSExpr(graph, result, args, jsContext): [JSContext, JSExpr] {
  //   const arg1 = findField(graph, args, 0);
  //   const arg2 = findField(graph, args, 1);
  //   const [f1, left] = toJS(graph, arg1!, jsContext);
  //   const [f2, right] = toJS(graph, arg2!, f1);
  //   return [f2, { type: "infix", op: "==", left, right }];
  // }
};

const addFunc: FunctionType = {
  type: "function",
  name: "add",
  exec(appNode) {
    const { args, func } = appNode.application;
    const argsObj = reduceToObject(args);
    if (argsObj) {
      const [arg0Key, arg0] = findField(argsObj, 0);
      const [arg1Key, arg1] = findField(argsObj, 1);
      const numValue = numberOp(arg0, arg1, (a, b) => a + b);
      const resultVal =
        numValue !== undefined ? cnstType(numValue) : numberType;
      const newArgs = refineToType(args, {
        ...argsObj.type,
        keyValues: [
          { key: arg0Key, value: refineToType(arg0, numberType) },
          { key: arg1Key, value: refineToType(arg1, numberType) }
        ]
      });
      return refineToType(
        refineNode(appNode, {
          ...appNode,
          application: { func, args: newArgs }
        }),
        resultVal
      );
    } else throw new Error("Not an object");
    // if (isObjectType(graph[args].type)) {
    //   const keys = reduceKeys(graph, args);
    //   if (keys.length > 0) {
    //     return keys;
    //   }
    //   const arg1 = findField(graph, args, 0);
    //   const arg2 = findField(graph, args, 1);
    //   if (arg1 && arg2) {
    //     const vals = reduceAll(graph, arg1, arg2);
    //     if (vals.length > 0) {
    //       return vals;
    //     }
    //     const refinements: Refinements = [];
    //     const arg1N = getAndRefine(refinements, graph, arg1, numberType);
    //     const arg2N = getAndRefine(refinements, graph, arg2, numberType);
    //     if (
    //       isNumber(arg1N.type) &&
    //       isNumber(arg2N.type) &&
    //       arg1N.type.value !== undefined &&
    //       arg2N.type.value !== undefined
    //     ) {
    //       getAndRefine(
    //         refinements,
    //         graph,
    //         result,
    //         mkValuePrim(arg1N.type.value + arg2N.type.value),
    //         true
    //       );
    //     } else {
    //       getAndRefine(refinements, graph, result, numberType);
    //     }
    //     return refinements;
    //   } else {
    //     console.log("No args");
    //   }
    // } else {
    //   return reduce(graph, args);
    // }
    // return [];
  }
  // toJSExpr(graph, result, args, funcDef) {
  //   const arg1 = findField(graph, args, 0);
  //   const arg2 = findField(graph, args, 1);
  //   const [f1, left] = toJS(graph, arg1!, funcDef);
  //   const [f2, right] = toJS(graph, arg2!, f1);
  //   return [f2, { type: "infix", op: "+", left, right }];
  // }
};

export const globals: SymbolTable = {
  add: node(addFunc),
  fieldRef: node(fieldRef),
  "==": node(eqRef)
};

export function argName(expr: Expr): Expr {
  return expr;
}

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
