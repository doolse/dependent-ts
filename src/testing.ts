import { expressionFunction } from "./types";

const appType = expressionFunction(
  "main",
  letExpr(
    "h",
    // cnst(123),
    lookupArg("howza"),
    // applyRef("argNamed", cnst("h")),
    applyRef(
      "add",
      argName("l", cnst(10)),
      argName(
        "r",
        applyRef("add", argName("l", ref("h")), argName("r", cnst(4)))
      )
    )
  )
);

const runMain = nodeFromExpr(graph, globals, applyRef("main"));

var iter = 1;
while (iter < 10) {
  const refinements = reduce(graph, runMain);
  console.log(util.inspect(refinements, false, null, true));
  for (const k in refinements) {
    refineNode(graph, refinements[k].ref, refinements[k].refinement);
  }
  if (refinements.length == 0) {
    break;
  }
  iter++;
}

graph.map((r, i) => console.log(i, nodeToString(graph, i)));
console.log(runMain);

// console.log(typeCompare({ type: "string" }, { type: "string", value: "sdf" }));
