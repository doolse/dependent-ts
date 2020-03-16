import * as ts from "typescript";
import {
  boolType,
  NodeGraph,
  Closure,
  Expr,
  applyRef,
  ref,
  cnst,
  applyObj,
  cnstType,
  letExpr,
  defineFunction,
  noDepNode,
  arrayType,
  applyFunction,
  exprToString,
  reduceGraph,
  refToString,
  objType,
  node,
  nodeToString,
  arrayExpr,
  KeyValueExpr,
  primTypeExpr,
  newExprNode,
  reduce,
  printGraph
} from "./types";
import { globals, globalGraph } from "./globals";

const source = `
function another()
{
    // let r = refine(args.a == args.b, false)
    args.a + args.b;
}

function main()
{
    // let crap = refine(args.a == 13, false);
    // another({a: args.a, b: 18})
    // refine(args.a == args.a, false);
    another({a:21, b: 23});
    // 12 + 21
    // let a = 12;
    // let b = 13;
    // a + b
}
`;

const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.ES2015, true);

interface LetDeclaration {
  name: string;
  expr: Expr;
}
function parseFunctions(graph: NodeGraph, closure: Closure, n: ts.Node) {
  function paramDef(p: ts.ParameterDeclaration): LetDeclaration {
    const name = p.name.getText();
    return {
      name,
      expr: applyRef("fieldRef", ref("args"), cnst(name))
    };
  }

  function identifierExpr(name: string): Expr {
    switch (name) {
      case "string":
      case "number":
      case "boolean":
        return primTypeExpr(name);
      default:
        return ref(name);
    }
  }

  function parseElem(n: ts.ObjectLiteralElementLike): KeyValueExpr {
    if (ts.isPropertyAssignment(n)) {
      const p = n.name.getText();
      return { key: cnst(p), value: parseExpr(n.initializer) };
    } else if (ts.isShorthandPropertyAssignment(n)) {
      const p = n.name.getText();
      return { key: cnst(p), value: ref(p) };
    } else {
      console.log(n.kind);
      throw new Error("Unknown object literal");
    }
  }

  function parseExpr(n: ts.Expression): Expr {
    if (ts.isBinaryExpression(n)) {
      const l = parseExpr(n.left);
      const r = parseExpr(n.right);
      switch (n.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsToken:
          return applyRef("==", l, r);
        case ts.SyntaxKind.PlusToken:
          return applyRef("add", l, r);
        default:
          throw new Error("Can only use plus");
      }
    } else if (ts.isIdentifier(n)) {
      return identifierExpr(n.text);
    } else if (ts.isNumericLiteral(n)) {
      return cnst(parseInt(n.text));
    } else if (ts.isParenthesizedExpression(n)) {
      return parseExpr(n.expression);
    } else if (ts.isPropertyAccessExpression(n)) {
      return applyRef("fieldRef", parseExpr(n.expression), cnst(n.name.text));
    } else if (ts.isCallExpression(n)) {
      const params = n.arguments.map(parseExpr);
      const args =
        params.length == 1 && params[0].tag == "object"
          ? params[0]
          : arrayExpr(...params);
      return {
        tag: "apply",
        function: parseExpr(n.expression),
        args
      };
    } else if (ts.isObjectLiteralExpression(n)) {
      const entries = n.properties.map(parseElem);
      return {
        tag: "object",
        keyExpr: primTypeExpr("untyped"),
        valueExpr: primTypeExpr("untyped"),
        entries
      };
    } else if (ts.isConditionalExpression(n)) {
      return applyRef(
        "ifThenElse",
        parseExpr(n.condition),
        parseExpr(n.whenTrue),
        parseExpr(n.whenFalse)
      );
    } else {
      switch (n.kind) {
        case ts.SyntaxKind.TrueKeyword:
          return cnst(true);
        case ts.SyntaxKind.FalseKeyword:
          return cnst(false);
        default:
          console.log(n.kind);
          throw new Error("Unknown expr node");
      }
    }
  }

  function parseFunction(n: ts.FunctionDeclaration) {
    const decls = n.parameters.map(paramDef);
    var bodyExpr: Expr = cnst(0);
    function parseBody(n: ts.Node) {
      if (ts.isVariableDeclaration(n)) {
        decls.push({ name: n.name.getText(), expr: parseExpr(n.initializer!) });
      } else if (ts.isExpressionStatement(n)) {
        bodyExpr = parseExpr(n.expression);
      } else if (ts.isVariableStatement(n) || ts.isVariableDeclarationList(n)) {
        ts.forEachChild(n, parseBody);
      } else {
        console.log("Body ", n.kind);
      }
    }
    ts.forEachChild(n.body!, parseBody);
    for (let i = decls.length - 1; i >= 0; i--) {
      const d = decls[i];
      bodyExpr = letExpr(d.name, d.expr, bodyExpr);
    }
    const funcName = n.name?.text ?? "main";
    console.log(exprToString(bodyExpr));
    closure.symbols[funcName] = defineFunction(
      graph,
      funcName,
      closure,
      bodyExpr
    ).ref;
  }

  function topLevel(n: ts.Node) {
    if (ts.isFunctionDeclaration(n)) {
      parseFunction(n);
    }
    ts.forEachChild(n, topLevel);
  }

  topLevel(n);
}

const ourFuncs: Closure = { parent: globals, symbols: {} };

parseFunctions(globalGraph, ourFuncs, sf);

const appNode = newExprNode(globalGraph, ourFuncs, applyObj("main"));

reduce(globalGraph, appNode);
const args = globalGraph.nodes[appNode].application!.args;
reduceGraph(globalGraph);
// console.log(refToString(globalGraph, argsNode));
console.log(refToString(globalGraph, args, { refinements: true }));
console.log(refToString(globalGraph, appNode, { application: true }));
