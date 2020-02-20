import { inspect } from "util";
import {
  letExpr,
  applyRef,
  cnst,
  ref,
  reduce,
  refineNode,
  NodeGraph,
  emptyObject,
  nodeFromExpr,
  nodeToString,
  toJS,
  getNode,
  createArgs,
  addNodeType,
  addNode,
  untyped
} from "./types";

import { lookupArg, argName, defineFunction, declareGlobals } from "./globals";
import { emptyFunction, func2string, appendReturn } from "./javascript";

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

var graph: NodeGraph = [{ type: untyped }];

const appSymbols = defineFunction(
  graph,
  declareGlobals(graph),
  "main",
  applyRef(
    "add",
    applyRef("fieldRef", lookupArg("arg"), cnst("field")),
    applyRef(
      "fieldRef",
      applyRef("fieldRef", lookupArg("arg2"), cnst("anotherField")),
      cnst("lastField")
    )
  )
);

console.log(appSymbols);

const argsNode = addNodeType(graph, emptyObject);
const runMain = addNode(graph, {
  type: untyped,
  apply: [appSymbols["main"], argsNode]
});

var iter = 1;
var finished = false;
while (iter < 50) {
  const refinements = reduce(graph, runMain);
  console.log(refinements);
  for (const k in refinements) {
    refineNode(graph, refinements[k]);
  }
  if (refinements.length == 0) {
    finished = true;
    break;
  }
  iter++;
}

console.log("Entry point", runMain);
console.log("Entry point", argsNode);

if (finished) {
  try {
    const funcDef = createArgs(graph, argsNode, emptyFunction());
    const [funcCode, ret] = toJS(graph, runMain, {
      funcDef,
      exprs: {}
    });
    console.log(func2string(appendReturn(funcCode.funcDef, ret)));
  } catch (e) {
    console.log(e);
    finished = false;
  }
}

if (!finished) {
  graph.map((r, i) =>
    console.log(
      nodeToString(graph, i),
      r.annotation ? r.annotation : "",
      r.expr
    )
  );
  console.log("Couldn't finish refining");
}

// console.log(typeCompare({ type: "string" }, { type: "string", value: "sdf" }));
