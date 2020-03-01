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
  reduceFully
} from "./types";
import { globals, lookupArg } from "./globals";

// import { lookupArg, argName, defineFunction, declareGlobals } from "./globals";
// import { emptyFunction, func2string, appendReturn } from "./javascript";

// const appType = expressionFunction(
//   "main",
//   letExpr(
//     "h",
//     // cnst(123),
//     lookupArg("howza"),
//     // applyRef("argNamed", cnst("h")),
//     applyRef(
//       "add",
//       argName("l", cnst(10)),
//       argName(
//         "r",
//         applyRef(
//           "add",
//           argName("l", applyRef("fieldRef", lookupArg("frog"), cnst("field"))),
//           argName("r", cnst(23))
//         )
//       )
//     )
//   )
// );

// var graph: NodeGraph = [{ type: untyped }];

function dot(obj: Expr, field: Expr): Expr {
  return applyRef("fieldRef", obj, field);
}

const mainFunc = defineFunction(
  "main",
  globals,
  applyRef(
    "add",
    cnst(3),
    cnst(34)
    // dot(lookupArg("arg"), cnst("field")),
    // dot(lookupArg("arg"), cnst("another"))
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

const result = reduceFully(applyFunction(mainFunc, node(arrayType())));
console.log(result.reducible);
console.log(nodeToString(result.application!.args));
console.log(nodeToString(result));
