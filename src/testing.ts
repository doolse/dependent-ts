import {
  applyRef,
  cnst,
  untyped,
  node,
  applyFunction,
  nodeToString,
  cnstType,
  arrayType,
  defineFunction,
  Expr,
  reduceNode,
  unifyNode,
  objectExpr,
  primTypeExpr,
  letExpr,
  ref,
  Closure,
  applyObj,
  nodeRef,
  refToString,
  reduceGraph,
  noDepNode
} from "./types";
import { globals, lookupArg, globalGraph } from "./globals";
import { runMain } from "module";

// import { lookupArg, argName, defineFunction, declareGlobals } from "./globals";
// import { emptyFunction, func2string, appendReturn } from "./javascript";

function dot(obj: Expr, field: Expr): Expr {
  return applyRef("fieldRef", obj, field);
}

const appType = defineFunction(
  globalGraph,
  "main",
  globals,
  letExpr(
    "h",
    // cnst(123),
    applyRef("add", dot(lookupArg("howza"), cnst("poo")), cnst(1)),
    // applyRef("argNamed", cnst("h")),
    applyRef(
      "add",
      cnst(10),
      applyRef(
        "add",
        applyRef("fieldRef", lookupArg("frog"), cnst("field")),
        cnst(3)
      )
    )
  )
);

const withMain: Closure = {
  parent: globals,
  symbols: { main: appType.ref }
};

const callMain = defineFunction(
  globalGraph,
  "callMain",
  withMain,
  applyObj("main", [cnst("frog"), objectExpr({ field: cnst(12) })])
);

const addNumbers = defineFunction(
  globalGraph,
  "addNumbers",
  withMain,
  applyRef("add", cnst(12), cnst(23))
);

// var graph: NodeGraph = [{ type: untyped }];

// const mainFunc = defineFunction(
//   globalGraph,
//   "main",
//   globals,
//   applyRef(
//     "add",
//     cnst(2),
//     lookupArg("as")
//     // cnst(3)
//     // dot(lookupArg("arg"), cnst("field")),
//     // dot(lookupArg("arg2"), cnst("A"))
//   )
// );

// const mainFunc = defineFunction(
//   "main",
//   globals,
//   dot(lookupArg("arg"), cnst("field"))
// );

const appSymbols = defineFunction(
  globalGraph,
  "main",
  globals,
  applyRef("==", lookupArg(0), cnst("hello"))
  // applyRef(
  //   "ifThenElse",
  //   applyRef("==", lookupArg("arg"), cnst("hello")),
  //   applyRef("==", lookupArg("arg"), cnst("hello")),
  //   applyRef("==", lookupArg("arg"), cnst("hello"))
  // )
);

// const argsNode = noDepNode(globalGraph, arrayType(globalGraph));
// const appNode = applyFunction(
//   { graph: globalGraph, ref: exprToNode(globalGraph, ref("main"), withMain) },
//   argsNode
// );
// reduceGraph(globalGraph);
// console.log(refToString(globalGraph, argsNode));
// console.log(refToString(globalGraph, appNode, { application: true }));
