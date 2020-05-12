import * as ts from "typescript";
import {
  Expr,
  applyRef,
  ref,
  cnst,
  letExpr,
  arrayExpr,
  KeyValueExpr,
  primTypeExpr,
} from "./expr";

export interface LetDeclaration {
  name: string;
  expr: Expr;
}

export function parseFunctions(n: ts.Node): LetDeclaration[] {
  const topLevelDecl: LetDeclaration[] = [];
  function paramDef(p: ts.ParameterDeclaration): LetDeclaration {
    const name = p.name.getText();
    return {
      name,
      expr: applyRef("fieldRef", ref("args"), cnst(name)),
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
    if (ts.isPrefixUnaryExpression(n)) {
      const minus = parseExpr(n.operand);
      switch (n.operator) {
        case ts.SyntaxKind.MinusToken:
          if (minus.tag == "prim" && typeof minus.value === "number") {
            return { ...minus, value: -minus.value };
          }
      }
      throw new Error("Can't handle unary - apart from negative numbers, ATM");
    } else if (ts.isBinaryExpression(n)) {
      const l = parseExpr(n.left);
      const r = parseExpr(n.right);
      switch (n.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsToken:
          return applyRef("==", l, r);
        case ts.SyntaxKind.LessThanToken:
          return applyRef("<", l, r);
        case ts.SyntaxKind.GreaterThanToken:
          return applyRef(">", l, r);
        case ts.SyntaxKind.AmpersandAmpersandToken:
          return applyRef("&&", l, r);
        case ts.SyntaxKind.BarBarToken:
          return applyRef("||", l, r);
        case ts.SyntaxKind.PlusToken:
          return applyRef("add", l, r);
        default:
          throw new Error("Can't use binary func " + n.operatorToken.kind);
      }
    } else if (ts.isStringLiteralLike(n)) {
      return cnst(n.text);
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
        args,
      };
    } else if (ts.isObjectLiteralExpression(n)) {
      const entries = n.properties.map(parseElem);
      return {
        tag: "object",
        entries,
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
    topLevelDecl.push({ name: funcName, expr: bodyExpr });
  }

  function topLevel(n: ts.Node) {
    if (ts.isFunctionDeclaration(n)) {
      parseFunction(n);
    }
    ts.forEachChild(n, topLevel);
  }

  topLevel(n);
  return topLevelDecl;
}
