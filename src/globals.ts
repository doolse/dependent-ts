import {
  NativeExpr,
  addNode,
  findField,
  getNode,
  nodeToString,
  isStringType,
  singleField,
  unify,
  isObjectType,
  reduceKeys,
  reduceAll,
  getNodeAndRefine,
  Refinements,
  numberType,
  mkValuePrim,
  isNumber,
  letExpr,
  NodeGraph,
  nodeFromExpr,
  emptyObject
} from "./types";

const lookupFunc: NativeExpr = {
  tag: "native",
  node: (g, s) => {
    return addNode(g, {
      type: {
        type: "function",
        name: "lookupArg",
        exec(graph, result, args) {
          const obj = findField(graph, args, 1);
          const a = findField(graph, args, 0);
          if (a && obj) {
            const key = getNode(graph, obj);
            console.log("Looking up args", nodeToString(graph, a));
            if (isStringType(key.type) && key.type.value !== undefined) {
              const field = findField(graph, a, key.type.value);
              if (field === null) {
                console.log("Didn't find the field");
                return [
                  {
                    ref: a,
                    refinement: { type: singleField(graph, obj, result) }
                  }
                ];
              } else return unify(graph, result, field);
            }
          } else {
            console.log("Didn't find any args", nodeToString(graph, args));
          }
          return [];
        }
      }
    });
  }
};

const addFunc: NativeExpr = {
  tag: "native",
  node: g =>
    addNode(g, {
      type: {
        type: "function",
        name: "add",
        exec(graph, result, args) {
          if (isObjectType(graph[args].type)) {
            const keys = reduceKeys(graph, args);
            if (keys.length > 0) {
              return keys;
            }
            const arg1 = findField(graph, args, 0);
            const arg2 = findField(graph, args, 1);
            if (arg1 && arg2) {
              const vals = reduceAll(graph, arg1, arg2);
              if (vals.length > 0) {
                return vals;
              }
              console.log("adding", arg1, arg2);
              const refinements: Refinements = [];
              const arg1N = getNodeAndRefine(
                refinements,
                graph,
                arg1,
                numberType
              );
              const arg2N = getNodeAndRefine(
                refinements,
                graph,
                arg2,
                numberType
              );
              if (
                isNumber(arg1N.type) &&
                isNumber(arg2N.type) &&
                arg1N.type.value !== undefined &&
                arg2N.type.value !== undefined
              ) {
                getNodeAndRefine(
                  refinements,
                  graph,
                  result,
                  mkValuePrim(arg1N.type.value + arg2N.type.value)
                );
              } else {
                getNodeAndRefine(refinements, graph, result, numberType);
              }
              return refinements;
            } else {
              console.log("No args");
            }
          }
          return [];
        }
      }
    })
};

var graph: NodeGraph = [{ type: emptyObject([]) }];

const globals = nodeFromExpr(
  graph,
  0,
  letExpr(
    "add",
    addFunc,
    letExpr(
      "lookupArg",
      lookupFunc,
      letExpr("main", appType, { tag: "native", node: (g, s) => s })
    )
  )
);
