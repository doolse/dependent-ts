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
  SymbolExpr,
  updateFlags,
  NodeFlags,
  expand,
  isExpandableExpression,
  NodeRef,
  ExpressionNode,
  newExprNode,
  graphNode,
  isNodeExpression,
  exprToString,
  updateNodePart,
  lookupType,
  newClosure,
  nodePrimValue,
  assertExpression,
  NodeExpression,
  unify,
  printSymbols,
  printClosure,
  copyType,
  withoutValue
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
      const arg0Type = nodeType(arg0);
      const arg1Type = nodeType(arg1);
      unifyNode(arg0, arg1, false);
      if (
        isPrim(arg0Type) &&
        isPrim(arg1Type) &&
        arg0Type.value !== undefined &&
        arg1Type.value !== undefined
      ) {
        refineToType(result, cnstType(c(arg0Type.value, arg1Type.value)));
      } else if (expectedValue !== undefined) {
        if (unifyEq && expectedValue === true) {
          unifyNode(arg0, arg1);
        } else {
          updateFlags(result.graph, result.ref, fl => fl | NodeFlags.Unproven);
        }
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
    reduceToObject(args, { keys: true });
    const [, condition] = findField(args, 0);
    const [, whenTrue] = findField(args, 1);
    const [, whenFalse] = findField(args, 2);

    var closureMap: { [id: number]: Closure } = {};

    function copyExpr(
      graph: NodeGraph,
      expr: NodeExpression,
      p: NodeRef
    ): NodeRef {
      return recurseWithCopy(graph, expr.closure, expr.expr, p);
    }

    function recurseWithCopy(
      graph: NodeGraph,
      closure: Closure,
      expr: Expr,
      p: NodeRef
    ) {
      const newNode = newExprNode(graph, closure, expr, p);
      if (expr.tag !== "symbol") {
        const oNode = graphNode(graph, newNode);
        if (isNodeExpression(oNode)) {
          expand(graph, oNode, recurseWithCopy);
        }
      } else {
        updateFlags(graph, newNode, flags => flags & ~NodeFlags.Expandable);
        var remapped = closureMap[closure.closureId];
        if (!remapped) {
          remapped = newClosure({});
          closureMap[closure.closureId] = remapped;
        }
        const redirSymbol = remapped.symbols[expr.symbol];
        if (redirSymbol !== undefined) {
          updateNodePart(graph, newNode, {
            typeRef: redirSymbol
          });
        } else {
          const sym = findSymbol(expr.symbol, closure);
          updateNodePart(graph, newNode, {
            type: copyType(graph, lookupType(graph, sym), newNode)
          });
          remapped.symbols[expr.symbol] = newNode;
        }
      }
      return newNode;
    }
    const graph = result.graph;
    const trueCond = copyExpr(graph, assertExpression(condition), result.ref);
    const trueResult = copyExpr(graph, assertExpression(whenTrue), result.ref);
    const trueClosures = closureMap;
    closureMap = {};
    const falseCond = copyExpr(graph, assertExpression(condition), result.ref);
    const falseResult = copyExpr(
      graph,
      assertExpression(whenFalse),
      result.ref
    );
    const falseClosures = closureMap;
    updateNodePart(result.graph, result.ref, {
      reduce() {
        reduceNode(condition);
        refineToType(condition, boolType);
        const cv = nodePrimValue(condition, boolType);
        if (cv === undefined) {
          console.log("TRUESIDE:" + printClosure(graph, trueClosures[3]));
          console.log("FALSESIDE:" + printClosure(graph, falseClosures[3]));
          refine(graph, trueCond, cnstType(true));
          refine(graph, falseCond, cnstType(false));
          reduce(graph, trueCond);
          reduce(graph, falseCond);
          reduce(graph, trueResult);
          reduce(graph, falseResult);
          unify(graph, result.ref, trueResult, false);
          unify(graph, result.ref, falseResult, false);
        } else if (cv) {
          reduce(graph, trueCond);
          reduce(graph, trueResult);
          unify(graph, result.ref, trueResult);
        } else {
          reduce(graph, falseCond);
          reduce(graph, falseResult);
          unify(graph, result.ref, falseResult);
        }
      }
    });
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

export const globals: Closure = newClosure({
  add: noDepNode(globalGraph, addFunc),
  fieldRef: noDepNode(globalGraph, fieldRef),
  "==": noDepNode(globalGraph, eqRef),
  "<": noDepNode(globalGraph, ltRef),
  ifThenElse: noDepNode(globalGraph, ifThenElseFunc),
  refine: noDepNode(globalGraph, refineFunc)
});

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
