/**
 * Expression code generation.
 *
 * Transforms CoreExpr nodes to JavaScript code strings.
 */

import {
  CoreExpr,
  CoreParam,
  CoreArgument,
  CoreRecordField,
  CoreArrayElement,
  CoreTemplatePart,
  CoreDecl,
  BinaryOp,
} from "../ast/core-ast";
import { CodeBuilder } from "./code-builder";
import { PREC, binaryPrecedence, unaryPrecedence } from "./precedence";
import { genMatch } from "./gen-pattern";
import { genDecl } from "./gen-decl";

// Context passed during expression generation
export type GenExprContext = {
  builder: CodeBuilder;
  parentPrecedence: number;
};

/**
 * Generate JavaScript code for an expression.
 * Returns the generated code as a string.
 */
export function genExpr(expr: CoreExpr, ctx: GenExprContext): string {
  switch (expr.kind) {
    case "identifier":
      return expr.name;

    case "literal":
      return genLiteral(expr.value, expr.literalKind);

    case "binary":
      return genBinary(expr.op, expr.left, expr.right, ctx);

    case "unary":
      return genUnary(expr.op, expr.operand, ctx);

    case "conditional":
      return genConditional(expr.condition, expr.then, expr.else, ctx);

    case "property":
      return genProperty(expr.object, expr.name, ctx);

    case "index":
      return genIndex(expr.object, expr.index, ctx);

    case "call":
      return genCall(expr.fn, expr.args, ctx);

    case "lambda":
      return genLambda(expr.params, expr.body, expr.async, ctx);

    case "record":
      return genRecord(expr.fields, ctx);

    case "array":
      return genArray(expr.elements, ctx);

    case "template":
      return genTemplate(expr.parts, ctx);

    case "block":
      return genBlock(expr.statements, expr.result, ctx);

    case "await":
      return genAwait(expr.expr, ctx);

    case "throw":
      return genThrow(expr.expr, ctx);

    case "match":
      return genMatch(expr.expr, expr.cases, ctx);

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unknown expression kind: ${(expr as any).kind}`);
    }
  }
}

/**
 * Generate code for an expression with a specified parent precedence.
 * Wraps in parens if needed.
 */
export function genExprPrec(
  expr: CoreExpr,
  ctx: GenExprContext,
  precedence: number
): string {
  const code = genExpr(expr, { ...ctx, parentPrecedence: precedence });
  return code;
}

// ============================================
// Literals
// ============================================

function genLiteral(
  value: string | number | boolean | null | undefined,
  literalKind: string
): string {
  switch (literalKind) {
    case "string":
      return JSON.stringify(value);
    case "int":
    case "float":
      return String(value);
    case "boolean":
      return value ? "true" : "false";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    default:
      throw new Error(`Unknown literal kind: ${literalKind}`);
  }
}

// ============================================
// Binary Operators
// ============================================

function genBinary(
  op: BinaryOp,
  left: CoreExpr,
  right: CoreExpr,
  ctx: GenExprContext
): string {
  // Map DepJS == to JS ===, and != to !==
  const jsOp = op === "==" ? "===" : op === "!=" ? "!==" : op;

  const prec = binaryPrecedence(op);
  const needsParens = prec < ctx.parentPrecedence;

  // For left operand, same precedence is OK (left-associative)
  const leftCode = genExpr(left, { ...ctx, parentPrecedence: prec });
  // For right operand, need higher precedence (since left-associative)
  const rightCode = genExpr(right, { ...ctx, parentPrecedence: prec + 1 });

  const code = `${leftCode} ${jsOp} ${rightCode}`;
  return needsParens ? `(${code})` : code;
}

// ============================================
// Unary Operators
// ============================================

function genUnary(
  op: string,
  operand: CoreExpr,
  ctx: GenExprContext
): string {
  const prec = unaryPrecedence(op as any);
  const needsParens = prec < ctx.parentPrecedence;

  const operandCode = genExpr(operand, { ...ctx, parentPrecedence: prec });
  const code = `${op}${operandCode}`;
  return needsParens ? `(${code})` : code;
}

// ============================================
// Conditional (Ternary)
// ============================================

function genConditional(
  condition: CoreExpr,
  thenExpr: CoreExpr,
  elseExpr: CoreExpr,
  ctx: GenExprContext
): string {
  const needsParens = PREC.CONDITIONAL < ctx.parentPrecedence;

  const condCode = genExpr(condition, {
    ...ctx,
    parentPrecedence: PREC.CONDITIONAL + 1,
  });
  const thenCode = genExpr(thenExpr, {
    ...ctx,
    parentPrecedence: PREC.CONDITIONAL,
  });
  const elseCode = genExpr(elseExpr, {
    ...ctx,
    parentPrecedence: PREC.CONDITIONAL,
  });

  const code = `${condCode} ? ${thenCode} : ${elseCode}`;
  return needsParens ? `(${code})` : code;
}

// ============================================
// Property Access
// ============================================

function genProperty(
  object: CoreExpr,
  name: string,
  ctx: GenExprContext
): string {
  const objCode = genExpr(object, { ...ctx, parentPrecedence: PREC.MEMBER });

  // Check if name is a valid identifier
  if (isValidIdentifier(name)) {
    return `${objCode}.${name}`;
  } else {
    return `${objCode}[${JSON.stringify(name)}]`;
  }
}

function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

// ============================================
// Index Access
// ============================================

function genIndex(
  object: CoreExpr,
  index: CoreExpr,
  ctx: GenExprContext
): string {
  const objCode = genExpr(object, { ...ctx, parentPrecedence: PREC.MEMBER });
  const indexCode = genExpr(index, { ...ctx, parentPrecedence: PREC.COMMA });
  return `${objCode}[${indexCode}]`;
}

// ============================================
// Function Calls
// ============================================

function genCall(
  fn: CoreExpr,
  args: CoreArgument[],
  ctx: GenExprContext
): string {
  const fnCode = genExpr(fn, { ...ctx, parentPrecedence: PREC.CALL });
  const argsCode = args.map((arg) => genArgument(arg, ctx)).join(", ");
  return `${fnCode}(${argsCode})`;
}

function genArgument(arg: CoreArgument, ctx: GenExprContext): string {
  if (arg.kind === "spread") {
    return `...${genExpr(arg.expr, { ...ctx, parentPrecedence: PREC.COMMA })}`;
  }
  return genExpr(arg.value, { ...ctx, parentPrecedence: PREC.COMMA });
}

// ============================================
// Lambda (Arrow Functions)
// ============================================

function genLambda(
  params: CoreParam[],
  body: CoreExpr,
  async: boolean,
  ctx: GenExprContext
): string {
  const asyncPrefix = async ? "async " : "";
  const paramsCode = genParams(params, ctx);

  // Check if body is a block or a simple expression
  if (body.kind === "block") {
    // Generate as { statements; return result; }
    const bodyCode = genBlockBody(body.statements, body.result, ctx);
    return `${asyncPrefix}(${paramsCode}) => ${bodyCode}`;
  } else {
    // Simple expression - no braces needed
    const bodyCode = genExpr(body, { ...ctx, parentPrecedence: PREC.COMMA });
    return `${asyncPrefix}(${paramsCode}) => ${bodyCode}`;
  }
}

function genParams(params: CoreParam[], ctx: GenExprContext): string {
  return params.map((p) => genParam(p, ctx)).join(", ");
}

function genParam(param: CoreParam, ctx: GenExprContext): string {
  const rest = param.rest ? "..." : "";
  if (param.defaultValue) {
    const defaultCode = genExpr(param.defaultValue, {
      ...ctx,
      parentPrecedence: PREC.COMMA,
    });
    return `${rest}${param.name} = ${defaultCode}`;
  }
  return `${rest}${param.name}`;
}

// ============================================
// Records (Object Literals)
// ============================================

function genRecord(fields: CoreRecordField[], ctx: GenExprContext): string {
  if (fields.length === 0) {
    return "{}";
  }

  const fieldsCode = fields.map((f) => genRecordField(f, ctx)).join(", ");
  return `{ ${fieldsCode} }`;
}

function genRecordField(field: CoreRecordField, ctx: GenExprContext): string {
  if (field.kind === "spread") {
    return `...${genExpr(field.expr, { ...ctx, parentPrecedence: PREC.COMMA })}`;
  }

  const valueCode = genExpr(field.value, {
    ...ctx,
    parentPrecedence: PREC.COMMA,
  });

  // Use shorthand if the value is an identifier with the same name
  if (
    field.value.kind === "identifier" &&
    field.value.name === field.name &&
    isValidIdentifier(field.name)
  ) {
    return field.name;
  }

  // Need to quote field name if not a valid identifier
  if (isValidIdentifier(field.name)) {
    return `${field.name}: ${valueCode}`;
  } else {
    return `${JSON.stringify(field.name)}: ${valueCode}`;
  }
}

// ============================================
// Arrays
// ============================================

function genArray(elements: CoreArrayElement[], ctx: GenExprContext): string {
  if (elements.length === 0) {
    return "[]";
  }

  const elemsCode = elements.map((e) => genArrayElement(e, ctx)).join(", ");
  return `[${elemsCode}]`;
}

function genArrayElement(
  element: CoreArrayElement,
  ctx: GenExprContext
): string {
  if (element.kind === "spread") {
    return `...${genExpr(element.expr, { ...ctx, parentPrecedence: PREC.COMMA })}`;
  }
  return genExpr(element.value, { ...ctx, parentPrecedence: PREC.COMMA });
}

// ============================================
// Template Literals
// ============================================

function genTemplate(parts: CoreTemplatePart[], ctx: GenExprContext): string {
  let result = "`";
  for (const part of parts) {
    if (part.kind === "string") {
      // Escape backticks and ${
      result += part.value
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$\{/g, "\\${");
    } else {
      const exprCode = genExpr(part.expr, {
        ...ctx,
        parentPrecedence: PREC.COMMA,
      });
      result += `\${${exprCode}}`;
    }
  }
  result += "`";
  return result;
}

// ============================================
// Block Expressions
// ============================================

function genBlock(
  statements: CoreDecl[],
  result: CoreExpr | undefined,
  ctx: GenExprContext
): string {
  // Block expression becomes IIFE: (() => { ...; return result; })()
  const bodyCode = genBlockBody(statements, result, ctx);
  return `(() => ${bodyCode})()`;
}

function genBlockBody(
  statements: CoreDecl[],
  result: CoreExpr | undefined,
  ctx: GenExprContext
): string {
  const builder = new CodeBuilder();
  builder.write("{");
  builder.newline();
  builder.indent();

  for (const stmt of statements) {
    const stmtCode = genDecl(stmt, { builder, parentPrecedence: PREC.PRIMARY });
    builder.write(stmtCode);
  }

  if (result) {
    const resultCode = genExpr(result, { ...ctx, parentPrecedence: PREC.COMMA });
    builder.write(`return ${resultCode};`);
    builder.newline();
  }

  builder.dedent();
  builder.write("}");
  return builder.build();
}

// ============================================
// Await
// ============================================

function genAwait(expr: CoreExpr, ctx: GenExprContext): string {
  const needsParens = PREC.UNARY < ctx.parentPrecedence;
  const exprCode = genExpr(expr, { ...ctx, parentPrecedence: PREC.UNARY });
  const code = `await ${exprCode}`;
  return needsParens ? `(${code})` : code;
}

// ============================================
// Throw
// ============================================

function genThrow(expr: CoreExpr, ctx: GenExprContext): string {
  // throw is a statement, but in expression context we wrap in IIFE
  const exprCode = genExpr(expr, { ...ctx, parentPrecedence: PREC.COMMA });
  return `(() => { throw ${exprCode}; })()`;
}
