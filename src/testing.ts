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
  reduce,
  unifyNode,
  objectExpr,
  exprToNode,
  primTypeExpr,
  letExpr,
  ref
} from "./types";
import { globals, lookupArg } from "./globals";

// import { lookupArg, argName, defineFunction, declareGlobals } from "./globals";
// import { emptyFunction, func2string, appendReturn } from "./javascript";

const appType = defineFunction(
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

// var graph: NodeGraph = [{ type: untyped }];

function dot(obj: Expr, field: Expr): Expr {
  return applyRef("fieldRef", obj, field);
}

const mainFunc = defineFunction(
  "main",
  globals,
  applyRef(
    "add",
    cnst(2),
    lookupArg("as")
    // cnst(3)
    // dot(lookupArg("arg"), cnst("field")),
    // dot(lookupArg("arg2"), cnst("A"))
  )
);

// const mainFunc = defineFunction(
//   "main",
//   globals,
//   dot(lookupArg("arg"), cnst("field"))
// );

// const appSymbols = defineFunction(
//   graph,
//   declareGlobals(graph),
//   "main",
//   applyRef("==", lookupArg("all"), cnst("hello"))
//   // applyRef(
//   //   "ifThenElse",
//   //   applyRef("==", lookupArg("arg"), cnst("hello")),
//   //   applyRef("==", lookupArg("arg"), cnst("hello")),
//   //   applyRef("==", lookupArg("arg"), cnst("hello"))
//   // )
// )

const node1 = exprToNode(
  objectExpr({ merge: primTypeExpr("untyped") }),
  globals
);
const node2 = exprToNode(
  objectExpr({
    merge: cnst(1),
    frogs: primTypeExpr("number")
  }),
  globals
);

// console.log(nodeToString(node1));
// console.log(nodeToString(node2));
// unifyNode(node1, node2);
// console.log(nodeToString(node1));
// console.log(nodeToString(node2));

const appNode = applyFunction(appType, node(arrayType()));
console.log(nodeToString(appNode.application!.args));
console.log(nodeToString(appNode));
