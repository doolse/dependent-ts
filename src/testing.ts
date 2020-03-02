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
  ref,
  Closure,
  applyObj
} from "./types";
import { globals, lookupArg } from "./globals";
import { runMain } from "module";

// import { lookupArg, argName, defineFunction, declareGlobals } from "./globals";
// import { emptyFunction, func2string, appendReturn } from "./javascript";

function dot(obj: Expr, field: Expr): Expr {
  return applyRef("fieldRef", obj, field);
}

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

const withMain: Closure = {
  parent: globals,
  symbols: { main: appType },
  nodes: []
};

const callMain = defineFunction(
  "callMain",
  withMain,
  applyObj("main", [cnst("frog"), objectExpr({ field: cnst(12) })])
);

// var graph: NodeGraph = [{ type: untyped }];

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

const appSymbols = defineFunction(
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

const appNode = applyFunction(appSymbols, node(arrayType(cnstType("hello"))));
console.log(nodeToString(appNode.application!.args));
console.log(nodeToString(appNode));
