import * as ts from "typescript";
import * as vis from "vis-network";
import { parseFunctions } from "./parsets";
import { exprToNode, TypedNode } from "./newtypes";
import { Node, Edge } from "vis-network";
import { Expr } from "./expr";

const source = `
// function int8(a)
// {
//     refine(a < 128 && a > -129, true)
// }

// function uint8(a)
// {
//     refine(a > -1 && a < 256, true)
// }

function main(a, b)
{
    // ifThenElse(args.a + 1 == 12, "a", 3);
    // let o = another({a: args.a, b: 4});
    // let o = uint8({a});
    // let p = 256 < a;
    // a < 12 || a > 34 ? a : a + 255;    
    // o;
    a + 6 + b + 1
}
`;

const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.ES2015, true);

const functions = parseFunctions(sf);
console.log(functions);
function exprLabel(expr: Expr) {
  switch (expr.tag) {
    case "symbol":
      return "ref:" + expr.symbol;
    case "prim":
      return expr.value.toString();
  }
}

function makeNode(nodes: Node[], edges: Edge[], node: TypedNode): number {
  function recurse(node: TypedNode) {
    const nodeId = nodes.length;
    const labels = [
      node.define ? `val ${node.define[0]} =` : undefined,
      node.application ? "application" : undefined,
      node.expr ? exprLabel(node.expr) : undefined,
      node.fields ? "object" : undefined,
    ].filter((c) => c);
    nodes.push({ id: nodeId, label: labels.join("\n") });
    if (node.bindings) {
      recurse(node.bindings);
    }
    if (node.application) {
      edges.push({ to: nodeId, from: recurse(node.application[0]) });
      edges.push({ to: nodeId, from: recurse(node.application[1]) });
    }
    if (node.fields) {
      node.fields.map((fn) => {
        edges.push({ to: nodeId, from: recurse(fn.key) });
        edges.push({ to: nodeId, from: recurse(fn.value) });
      });
    }

    return nodeId;
  }
  return recurse(node);
}

const mainNode = exprToNode(functions[0].expr);

// create a network
var container = document.getElementById("app");
const nodes: Node[] = [];
const edges: Edge[] = [];
makeNode(nodes, edges, mainNode);
var options: vis.Options = { layout: { hierarchical: { direction: "UD" } } };
var network = new vis.Network(container!, { nodes, edges }, options);
