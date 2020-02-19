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
  createArgs
} from "./types";

import { globals, expressionFunction, lookupArg, argName } from "./globals";
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

const appType = expressionFunction(
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

var graph: NodeGraph = [{ type: { type: "object", keyValues: [] } }];

const allGlobals = nodeFromExpr(
  graph,
  0,
  globals(letExpr("main", appType, { tag: "native", node: (g, s) => s }))
);

const runMain = nodeFromExpr(graph, allGlobals, applyRef("main"));
const mainNode = getNode(graph, runMain);
const argsNode = mainNode.apply![1];

var iter = 1;
var finished = false;
while (iter < 50) {
  const refinements = reduce(graph, runMain);
  for (const k in refinements) {
    refineNode(graph, refinements[k].ref, refinements[k].refinement);
  }
  if (refinements.length == 0) {
    finished = true;
    break;
  }
  iter++;
}

if (finished) {
  const funcDef = createArgs(graph, argsNode, emptyFunction());
  const [funcCode, ret] = toJS(graph, runMain, {
    funcDef,
    exprs: {}
  });
  console.log(func2string(appendReturn(funcCode.funcDef, ret)));
}
if (!finished) {
  console.log(runMain, argsNode);
  graph.map((r, i) =>
    console.log(nodeToString(graph, i), r.annotation ? r.annotation : "")
  );
  console.log("Couldn't finish refining");
}

// console.log(typeCompare({ type: "string" }, { type: "string", value: "sdf" }));
