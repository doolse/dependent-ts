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
  withoutValue,
  addRefinementNode
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
        } else if (!(nodeData(result).flags & NodeFlags.Refinement)) {
          addRefinementNode(arg0.graph, arg0.ref, {
            application: result.ref,
            original: arg0.ref
          });
          addRefinementNode(arg1.graph, arg1.ref, {
            application: result.ref,
            original: arg1.ref
          });
        }
      }
    }
  };
}

// OR
// x 0 0 - x must be false
// x 1 0 - error
// x 1 1 - no knowledge
// x 0 1 - x must be true

// AND
// x 0 0 - x must be false
// x 1 0 - x must be false
// x 1 1 - x must be true
// x 0 1 - x must be true

const andRef: FunctionType = refBinaryBoolFunc(
  "&&",
  (v1, v2) => v1 && v2,
  (rv, v1) => rv,
  one => (one ? undefined : false),
  r => (r ? true : undefined)
);

const orRef: FunctionType = refBinaryBoolFunc(
  "||",
  (v1, v2) => v1 || v2,
  (rv, v1) => {
    if (!rv && v1)
      throw new Error("Expected OR to be false but one side was true");
    return !v1 ? rv : undefined;
  },
  one => (one ? true : undefined),
  r => undefined
);

function refBinaryBoolFunc(
  name: string,
  bothKnown: (v1: boolean, v2: boolean) => boolean,
  oneAndResult: (result: boolean, v: boolean) => boolean | undefined,
  resultFromOne: (v1: boolean) => boolean | undefined,
  argsFromResult: (result: boolean) => boolean | undefined
): FunctionType {
  return {
    type: "function",
    name,
    reduce(result, args) {
      reduceToObject(args);
      const [, arg0] = findField(args, 0);
      const [, arg1] = findField(args, 1);
      refineToType(result, boolType);
      refineToType(arg0, boolType);
      refineToType(arg1, boolType);
      const expectedValue = nodePrimValue(result, boolType);
      const arg0B = nodePrimValue(arg0, boolType);
      const arg1B = nodePrimValue(arg1, boolType);

      if (arg0B !== undefined && arg1B !== undefined) {
        refineToType(result, cnstType(bothKnown(arg0B, arg1B)));
      } else if (expectedValue !== undefined) {
        if (arg0B !== undefined) {
          const arg1R = oneAndResult(expectedValue, arg0B);
          if (arg1R !== undefined) {
            refineToType(arg1, cnstType(arg1R));
          }
        } else if (arg1B !== undefined) {
          const arg0R = oneAndResult(expectedValue, arg1B);
          if (arg0R !== undefined) {
            refineToType(arg0, cnstType(arg0R));
          }
        } else {
          const argR = argsFromResult(expectedValue);
          if (argR !== undefined) {
            refineToType(arg0, cnstType(argR));
            refineToType(arg1, cnstType(argR));
          }
        }
      } else {
        const res =
          arg0B !== undefined
            ? resultFromOne(arg0B)
            : arg1B !== undefined
            ? resultFromOne(arg1B)
            : undefined;
        if (res !== undefined) {
          refineToType(result, cnstType(res));
        }
      }
    }
  };
}

const eqRef: FunctionType = refBoolFunc("==", (v1, v2) => v1 === v2, true);
const ltRef: FunctionType = refBoolFunc("<", (v1, v2) => v1 < v2, false);
const gtRef: FunctionType = refBoolFunc(">", (v1, v2) => v1 > v2, false);

const addFunc: FunctionType = {
  type: "function",
  name: "add",
  reduce(result, args) {
    reduceToObject(args);
    const [, arg0] = findField(args, 0);
    const [, arg1] = findField(args, 1);
    refineToType(arg0, numberType);
    refineToType(arg1, numberType);
    unifyNode(arg0, arg1, false);
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
          console.log(
            "FALSESIDE:" +
              printClosure(graph, falseClosures[3], { refinements: true })
          );
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
  "&&": noDepNode(globalGraph, andRef),
  "||": noDepNode(globalGraph, orRef),
  "<": noDepNode(globalGraph, ltRef),
  ">": noDepNode(globalGraph, gtRef),
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
