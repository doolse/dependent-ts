/**
 * Lezer Tree to Expr AST Conversion
 *
 * Converts TypeScript/JSX syntax trees from @lezer/javascript to our Expr AST.
 * Handles expression conversion, statement-to-let transformation, and JSX desugaring.
 */

import { SyntaxNode, Tree } from "@lezer/common";
import {
  Expr,
  lit,
  num,
  str,
  bool,
  nil,
  varRef,
  binop,
  unary,
  ifExpr,
  letExpr,
  letPatternExpr,
  fn,
  recfn,
  call,
  obj,
  field,
  array,
  index,
  block,
  comptime,
  assertExpr,
  methodCall,
  BinOp,
  UnaryOp,
  Pattern,
  varPattern,
  arrayPattern,
  objectPattern,
} from "../expr";
import { convertTypeNodeToExpr } from "./type-convert";

// ============================================================================
// Error Handling
// ============================================================================

export class TSParseError extends Error {
  constructor(
    message: string,
    public from: number,
    public to: number,
    public nodeType?: string
  ) {
    super(message);
    this.name = "TSParseError";
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get text content of a syntax node.
 */
function getText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

/**
 * Get first child node with a specific type name.
 */
function getChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === name) return child;
  }
  return null;
}

/**
 * Get all children with a specific type name.
 */
function getChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === name) children.push(child);
  }
  return children;
}

/**
 * Get all direct children nodes.
 */
function getAllChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

/**
 * Check if a node is an expression node.
 */
function isExpression(node: SyntaxNode): boolean {
  const name = node.type.name;
  return (
    name === "Number" ||
    name === "String" ||
    name === "TemplateString" ||
    name === "BooleanLiteral" ||
    name === "VariableName" ||
    name === "BinaryExpression" ||
    name === "UnaryExpression" ||
    name === "ConditionalExpression" ||
    name === "CallExpression" ||
    name === "MemberExpression" ||
    name === "ArrowFunction" ||
    name === "FunctionExpression" ||
    name === "ArrayExpression" ||
    name === "ObjectExpression" ||
    name === "ParenthesizedExpression" ||
    name === "JSXElement" ||
    name === "JSXSelfClosingElement" ||
    name === "JSXFragment" ||
    name === "null" ||
    name === "undefined" ||
    name === "this"
  );
}

// ============================================================================
// Operator Mapping
// ============================================================================

/**
 * Map TypeScript binary operators to our BinOp type.
 */
function mapBinaryOp(op: string): BinOp | null {
  switch (op) {
    case "+":
      return "+";
    case "-":
      return "-";
    case "*":
      return "*";
    case "/":
      return "/";
    case "%":
      return "%";
    case "===":
    case "==":
      return "==";
    case "!==":
    case "!=":
      return "!=";
    case "<":
      return "<";
    case ">":
      return ">";
    case "<=":
      return "<=";
    case ">=":
      return ">=";
    case "&&":
      return "&&";
    case "||":
      return "||";
    default:
      return null;
  }
}

/**
 * Map TypeScript unary operators to our UnaryOp type.
 */
function mapUnaryOp(op: string): UnaryOp | null {
  switch (op) {
    case "-":
      return "-";
    case "!":
      return "!";
    default:
      return null;
  }
}

// ============================================================================
// Expression Conversion
// ============================================================================

/**
 * Convert a Lezer syntax node to an Expr.
 */
export function convertNode(node: SyntaxNode, source: string): Expr {
  const typeName = node.type.name;

  switch (typeName) {
    // Literals
    case "Number": {
      const text = getText(node, source);
      return num(parseFloat(text));
    }

    case "String": {
      const text = getText(node, source);
      return str(parseStringLiteral(text));
    }

    case "TemplateString": {
      // Simple template string without interpolation
      const text = getText(node, source);
      // Remove backticks
      return str(text.slice(1, -1));
    }

    case "BooleanLiteral": {
      const text = getText(node, source);
      return bool(text === "true");
    }

    case "null":
      return nil;

    case "undefined":
      return varRef("undefined");

    case "this":
      return varRef("this");

    // Variable reference
    case "VariableName":
    case "Identifier": {
      return varRef(getText(node, source));
    }

    // Binary expression
    case "BinaryExpression": {
      return convertBinaryExpr(node, source);
    }

    // Unary expression
    case "UnaryExpression": {
      return convertUnaryExpr(node, source);
    }

    // Ternary / conditional expression
    case "ConditionalExpression": {
      return convertConditionalExpr(node, source);
    }

    // Arrow function
    case "ArrowFunction": {
      return convertArrowFunction(node, source);
    }

    // Function expression (non-arrow)
    case "FunctionExpression": {
      return convertFunctionExpr(node, source);
    }

    // Call expression
    case "CallExpression": {
      return convertCallExpr(node, source);
    }

    // Member expression (property access)
    case "MemberExpression": {
      return convertMemberExpr(node, source);
    }

    // Array literal
    case "ArrayExpression": {
      return convertArrayExpr(node, source);
    }

    // Object literal
    case "ObjectExpression": {
      return convertObjectExpr(node, source);
    }

    // Parenthesized expression
    case "ParenthesizedExpression": {
      const inner = node.firstChild?.nextSibling;
      if (inner) {
        return convertNode(inner, source);
      }
      throw new TSParseError(
        "Empty parenthesized expression",
        node.from,
        node.to,
        typeName
      );
    }

    // JSX elements
    case "JSXElement":
    case "JSXSelfClosingElement": {
      return convertJSXElement(node, source);
    }

    case "JSXFragment": {
      return convertJSXFragment(node, source);
    }

    // Expression statement (unwrap)
    case "ExpressionStatement": {
      const child = node.firstChild;
      if (child) {
        return convertNode(child, source);
      }
      throw new TSParseError("Empty expression statement", node.from, node.to, typeName);
    }

    // Script/Program wrapper
    case "Script": {
      return convertScript(node, source);
    }

    // Sequence expression (comma operator)
    case "SequenceExpression": {
      // Take the last expression in the sequence
      let last: Expr = nil;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.type.name !== ",") {
          last = convertNode(child, source);
        }
      }
      return last;
    }

    // Assignment expression - not directly supported, but we can handle simple cases
    case "AssignmentExpression": {
      throw new TSParseError(
        "Assignment expressions are not supported in this expression language",
        node.from,
        node.to,
        typeName
      );
    }

    default:
      throw new TSParseError(
        `Unsupported syntax: ${typeName}`,
        node.from,
        node.to,
        typeName
      );
  }
}

/**
 * Parse a string literal, handling escape sequences.
 */
function parseStringLiteral(text: string): string {
  // Remove quotes (single, double, or backtick)
  const quote = text[0];
  const inner = text.slice(1, -1);

  // Handle escape sequences
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Convert a binary expression.
 */
function convertBinaryExpr(node: SyntaxNode, source: string): Expr {
  const children = getAllChildren(node);
  if (children.length < 3) {
    throw new TSParseError("Invalid binary expression", node.from, node.to, "BinaryExpression");
  }

  const left = convertNode(children[0], source);
  const opNode = children[1];
  const opText = getText(opNode, source);
  const right = convertNode(children[2], source);

  // Handle nullish coalescing: a ?? b => if a != null then a else b
  if (opText === "??") {
    // We need to avoid evaluating 'a' twice - but for simplicity, we'll accept it
    return ifExpr(binop("!=", left, nil), left, right);
  }

  const op = mapBinaryOp(opText);
  if (!op) {
    throw new TSParseError(`Unsupported operator: ${opText}`, opNode.from, opNode.to, "BinaryExpression");
  }

  return binop(op, left, right);
}

/**
 * Convert a unary expression.
 */
function convertUnaryExpr(node: SyntaxNode, source: string): Expr {
  const children = getAllChildren(node);
  if (children.length < 2) {
    throw new TSParseError("Invalid unary expression", node.from, node.to, "UnaryExpression");
  }

  // Operator can be prefix or postfix
  const first = children[0];
  const firstText = getText(first, source);

  // Check if first child is the operator
  if (firstText === "-" || firstText === "!" || firstText === "+" || firstText === "~") {
    const operand = convertNode(children[1], source);

    // Handle unary + (just return the operand)
    if (firstText === "+") {
      return operand;
    }

    const op = mapUnaryOp(firstText);
    if (!op) {
      throw new TSParseError(`Unsupported unary operator: ${firstText}`, first.from, first.to, "UnaryExpression");
    }
    return unary(op, operand);
  }

  // Postfix operators (++, --) are not supported
  throw new TSParseError("Postfix operators are not supported", node.from, node.to, "UnaryExpression");
}

/**
 * Convert a conditional (ternary) expression.
 */
function convertConditionalExpr(node: SyntaxNode, source: string): Expr {
  // Filter out operators (? and :) which are LogicOp nodes
  const children = getAllChildren(node).filter(
    (n) => n.type.name !== "LogicOp"
  );

  if (children.length !== 3) {
    throw new TSParseError("Invalid conditional expression", node.from, node.to, "ConditionalExpression");
  }

  const cond = convertNode(children[0], source);
  const then = convertNode(children[1], source);
  const els = convertNode(children[2], source);

  return ifExpr(cond, then, els);
}

/**
 * Convert an arrow function.
 */
interface TypedParam {
  name: string;
  typeAnnotation?: SyntaxNode;
}

function convertArrowFunction(node: SyntaxNode, source: string): Expr {
  // Find parameter list or single parameter
  const paramList = getChild(node, "ParamList");
  const params: TypedParam[] = [];

  if (paramList) {
    // Multiple parameters
    for (let child = paramList.firstChild; child; child = child.nextSibling) {
      if (child.type.name === "VariableDefinition" || child.type.name === "VariableName") {
        const nameNode = getChild(child, "VariableName") || child;
        const name = getText(nameNode, source);
        // Check if next sibling is a TypeAnnotation
        const nextSibling = child.nextSibling;
        const typeAnnotation = nextSibling?.type.name === "TypeAnnotation" ? nextSibling : undefined;
        params.push({ name, typeAnnotation });
      }
    }
  } else {
    // Single parameter without parens
    const singleParam = node.firstChild;
    if (singleParam && singleParam.type.name === "VariableName") {
      params.push({ name: getText(singleParam, source) });
    }
  }

  // Find body (after =>)
  let body: Expr | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === "Block") {
      // Block body - convert to expression
      body = convertBlockBody(child, source);
      break;
    } else if (child.type.name === "ArrowOp" || getText(child, source) === "=>") {
      // Expression body is the next sibling
      const bodyNode = child.nextSibling;
      if (bodyNode) {
        body = convertNode(bodyNode, source);
      }
      break;
    }
  }

  if (!body) {
    // Try finding any expression after parameters
    for (let child = node.lastChild; child; child = child.prevSibling) {
      if (isExpression(child)) {
        body = convertNode(child, source);
        break;
      }
    }
  }

  if (!body) {
    throw new TSParseError("Arrow function missing body", node.from, node.to, "ArrowFunction");
  }

  // Build comptime assertions for typed parameters
  const assertions: Expr[] = [];
  for (const param of params) {
    if (param.typeAnnotation) {
      const typeExpr = convertTypeNodeToExpr(param.typeAnnotation, source);
      assertions.push(comptime(assertExpr(varRef(param.name), typeExpr)));
    }
  }

  const wrappedBody = assertions.length > 0 ? block(...assertions, body) : body;
  return fn(params.map(p => p.name), wrappedBody);
}

/**
 * Convert a function expression (non-arrow).
 */
function convertFunctionExpr(node: SyntaxNode, source: string): Expr {
  // Check for function name
  const nameNode = getChild(node, "VariableDefinition");
  const name = nameNode ? getText(nameNode, source) : null;

  // Get parameters with type annotations
  const paramList = getChild(node, "ParamList");
  const params: TypedParam[] = [];

  if (paramList) {
    for (let child = paramList.firstChild; child; child = child.nextSibling) {
      if (child.type.name === "VariableDefinition" || child.type.name === "VariableName") {
        const paramNameNode = getChild(child, "VariableName") || child;
        const paramName = getText(paramNameNode, source);
        // Check if next sibling is a TypeAnnotation
        const nextSibling = child.nextSibling;
        const typeAnnotation = nextSibling?.type.name === "TypeAnnotation" ? nextSibling : undefined;
        params.push({ name: paramName, typeAnnotation });
      }
    }
  }

  // Get body
  const bodyNode = getChild(node, "Block");
  if (!bodyNode) {
    throw new TSParseError("Function expression missing body", node.from, node.to, "FunctionExpression");
  }

  const body = convertBlockBody(bodyNode, source);

  // Build comptime assertions for typed parameters
  const assertions: Expr[] = [];
  for (const param of params) {
    if (param.typeAnnotation) {
      const typeExpr = convertTypeNodeToExpr(param.typeAnnotation, source);
      assertions.push(comptime(assertExpr(varRef(param.name), typeExpr)));
    }
  }

  const wrappedBody = assertions.length > 0 ? block(...assertions, body) : body;
  const paramNames = params.map(p => p.name);

  if (name) {
    return recfn(name, paramNames, wrappedBody);
  }
  return fn(paramNames, wrappedBody);
}

/**
 * Convert a block body to an expression using let bindings.
 */
function convertBlockBody(node: SyntaxNode, source: string): Expr {
  const statements: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "{" && child.type.name !== "}") {
      statements.push(child);
    }
  }

  return convertStatements(statements, source);
}

/**
 * Convert a call expression.
 */
function convertCallExpr(node: SyntaxNode, source: string): Expr {
  const children = getAllChildren(node);
  if (children.length === 0) {
    throw new TSParseError("Invalid call expression", node.from, node.to, "CallExpression");
  }

  const funcNode = children[0];
  const argList = getChild(node, "ArgList");

  // Handle method calls
  if (funcNode.type.name === "MemberExpression") {
    const memberChildren = getAllChildren(funcNode);
    if (memberChildren.length >= 2) {
      const receiver = convertNode(memberChildren[0], source);
      const methodName = getText(memberChildren[memberChildren.length - 1], source);

      const args: Expr[] = [];
      if (argList) {
        for (let child = argList.firstChild; child; child = child.nextSibling) {
          if (child.type.name !== "(" && child.type.name !== ")" && child.type.name !== ",") {
            args.push(convertNode(child, source));
          }
        }
      }

      return methodCall(receiver, methodName, args);
    }
  }

  // Regular function call
  const func = convertNode(funcNode, source);
  const args: Expr[] = [];

  if (argList) {
    for (let child = argList.firstChild; child; child = child.nextSibling) {
      if (child.type.name !== "(" && child.type.name !== ")" && child.type.name !== ",") {
        args.push(convertNode(child, source));
      }
    }
  }

  return call(func, ...args);
}

/**
 * Convert a member expression (property access).
 */
function convertMemberExpr(node: SyntaxNode, source: string): Expr {
  const children = getAllChildren(node);
  if (children.length < 2) {
    throw new TSParseError("Invalid member expression", node.from, node.to, "MemberExpression");
  }

  const objNode = children[0];
  const obj = convertNode(objNode, source);

  // Check for bracket notation [expr]
  const hasBracket = children.some((c) => getText(c, source) === "[");
  if (hasBracket) {
    // Find the index expression
    let indexExpr: Expr | null = null;
    let inBracket = false;
    for (const child of children) {
      const text = getText(child, source);
      if (text === "[") {
        inBracket = true;
      } else if (text === "]") {
        break;
      } else if (inBracket) {
        indexExpr = convertNode(child, source);
        break;
      }
    }

    if (indexExpr) {
      return index(obj, indexExpr);
    }
  }

  // Dot notation
  const propNode = children[children.length - 1];
  const propName = getText(propNode, source);

  // Handle optional chaining
  const hasOptional = children.some((c) => getText(c, source) === "?.");
  if (hasOptional) {
    // a?.b => if a != null then a.b else null
    return ifExpr(binop("!=", obj, nil), field(obj, propName), nil);
  }

  return field(obj, propName);
}

/**
 * Convert an array expression.
 */
function convertArrayExpr(node: SyntaxNode, source: string): Expr {
  const elements: Expr[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "[" && child.type.name !== "]" && child.type.name !== ",") {
      elements.push(convertNode(child, source));
    }
  }
  return array(...elements);
}

/**
 * Convert an object expression.
 */
function convertObjectExpr(node: SyntaxNode, source: string): Expr {
  const fields: Record<string, Expr> = {};

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === "Property") {
      const propChildren = getAllChildren(child);
      if (propChildren.length >= 1) {
        const keyNode = propChildren[0];
        let key: string;

        if (keyNode.type.name === "PropertyName" || keyNode.type.name === "Identifier") {
          key = getText(keyNode, source);
        } else if (keyNode.type.name === "String") {
          key = parseStringLiteral(getText(keyNode, source));
        } else {
          key = getText(keyNode, source);
        }

        // Find value (might be shorthand: { x } means { x: x })
        if (propChildren.length >= 2) {
          // Skip the colon
          const valueNode = propChildren[propChildren.length - 1];
          fields[key] = convertNode(valueNode, source);
        } else {
          // Shorthand property
          fields[key] = varRef(key);
        }
      }
    }
  }

  return obj(fields);
}

// ============================================================================
// Statement Conversion
// ============================================================================

/**
 * Declaration info extracted from a statement.
 */
interface Declaration {
  pattern: Pattern;
  value: Expr;
  typeAnnotation?: SyntaxNode;
}

/**
 * Convert a sequence of statements to a single expression using let bindings.
 */
export function convertStatements(statements: SyntaxNode[], source: string): Expr {
  const declarations: Declaration[] = [];
  let finalExpr: Expr | null = null;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const typeName = stmt.type.name;

    switch (typeName) {
      case "VariableDeclaration": {
        // Extract declarations from const/let
        const decls = extractDeclarations(stmt, source);
        declarations.push(...decls);
        break;
      }

      case "ExpressionStatement": {
        // This could be the final expression
        const child = stmt.firstChild;
        if (child) {
          finalExpr = convertNode(child, source);
        }
        break;
      }

      case "ReturnStatement": {
        // Return statement - the returned value is the final expression
        const child = stmt.firstChild?.nextSibling; // Skip "return" keyword
        if (child && child.type.name !== ";") {
          finalExpr = convertNode(child, source);
        } else {
          finalExpr = nil; // return; with no value
        }
        break;
      }

      case ";":
        // Skip semicolons
        break;

      default:
        // For other statements, try to convert as expression
        if (isExpression(stmt)) {
          finalExpr = convertNode(stmt, source);
        } else {
          throw new TSParseError(
            `Unsupported statement: ${typeName}`,
            stmt.from,
            stmt.to,
            typeName
          );
        }
    }
  }

  // If no final expression, use the last declaration's value or null
  if (!finalExpr) {
    if (declarations.length > 0) {
      // Return nil after declarations
      finalExpr = nil;
    } else {
      throw new TSParseError("Statement sequence must end with an expression", 0, 0, "Script");
    }
  }

  // Build nested let-in from declarations
  return wrapInLets(declarations, finalExpr, source);
}

/**
 * Extract declarations from a variable declaration statement.
 */
function extractDeclarations(node: SyntaxNode, source: string): Declaration[] {
  const declarations: Declaration[] = [];

  // VariableDeclaration structure:
  // const/let, VariableDefinition (name), Equals, value, ;
  // Or with type: const/let, VariableDefinition (name), TypeAnnotation, Equals, value, ;

  let nameNode: SyntaxNode | null = null;
  let valueNode: SyntaxNode | null = null;
  let typeNode: SyntaxNode | null = null;
  let foundEquals = false;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    const typeName = child.type.name;

    if (typeName === "VariableDefinition") {
      // This is the variable name (or pattern for destructuring)
      nameNode = child;
    } else if (typeName === "ArrayPattern" || typeName === "ObjectPattern") {
      nameNode = child;
    } else if (typeName === "TypeAnnotation") {
      typeNode = child;
    } else if (typeName === "Equals" || getText(child, source) === "=") {
      foundEquals = true;
    } else if (foundEquals && !valueNode && typeName !== ";" && typeName !== "const" && typeName !== "let" && typeName !== "var") {
      // This should be the value expression
      valueNode = child;
    }
  }

  if (nameNode && valueNode) {
    const pattern = convertPattern(nameNode, source);
    const value = convertNode(valueNode, source);
    declarations.push({ pattern, value, typeAnnotation: typeNode ?? undefined });
  }

  return declarations;
}

/**
 * Convert a pattern node to our Pattern type.
 */
function convertPattern(node: SyntaxNode, source: string): Pattern {
  const typeName = node.type.name;

  switch (typeName) {
    case "VariableName":
    case "Identifier":
    case "VariableDefinition":
      // VariableDefinition is used for simple variable names in declarations
      return varPattern(getText(node, source));

    case "ArrayPattern": {
      const elements: Pattern[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.type.name !== "[" && child.type.name !== "]" && child.type.name !== ",") {
          elements.push(convertPattern(child, source));
        }
      }
      return arrayPattern(...elements);
    }

    case "ObjectPattern": {
      const fields: { key: string; pattern: Pattern }[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.type.name === "PatternProperty") {
          const propChildren = getAllChildren(child);
          if (propChildren.length >= 1) {
            const keyNode = propChildren[0];
            const key = getText(keyNode, source);

            if (propChildren.length >= 2) {
              // Has explicit pattern: { x: y }
              const patternNode = propChildren[propChildren.length - 1];
              fields.push({ key, pattern: convertPattern(patternNode, source) });
            } else {
              // Shorthand: { x } means { x: x }
              fields.push({ key, pattern: varPattern(key) });
            }
          }
        }
      }
      return objectPattern(fields);
    }

    default:
      // Default to variable pattern
      return varPattern(getText(node, source));
  }
}

/**
 * Wrap an expression in let bindings from declarations.
 */
function wrapInLets(declarations: Declaration[], body: Expr, source: string): Expr {
  let result = body;

  // Build from inside out (reverse order)
  for (let i = declarations.length - 1; i >= 0; i--) {
    const decl = declarations[i];
    let value = decl.value;

    // If there's a type annotation, wrap in comptime(assert())
    if (decl.typeAnnotation) {
      const typeExpr = convertTypeNodeToExpr(decl.typeAnnotation, source);
      value = comptime(assertExpr(value, typeExpr));
    }

    if (decl.pattern.tag === "varPattern") {
      result = letExpr(decl.pattern.name, value, result);
    } else {
      result = letPatternExpr(decl.pattern, value, result);
    }
  }

  return result;
}

// ============================================================================
// Script Conversion
// ============================================================================

/**
 * Convert a Script node (top-level) to an expression.
 */
function convertScript(node: SyntaxNode, source: string): Expr {
  const statements: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    statements.push(child);
  }

  if (statements.length === 0) {
    return nil;
  }

  // If there's only one expression, return it directly
  if (statements.length === 1 && isExpression(statements[0])) {
    return convertNode(statements[0], source);
  }

  return convertStatements(statements, source);
}

// ============================================================================
// JSX Conversion
// ============================================================================

/**
 * Recursively find JSX tag name from a node.
 */
function findJSXTagName(node: SyntaxNode, source: string): string | null {
  // Direct identifier
  if (node.type.name === "JSXIdentifier" || node.type.name === "Identifier") {
    return getText(node, source);
  }
  // JSXBuiltin wraps JSXIdentifier for built-in elements like div, span
  if (node.type.name === "JSXBuiltin") {
    const inner = node.firstChild;
    if (inner) {
      return findJSXTagName(inner, source);
    }
  }
  // JSXMemberExpression for Component.SubComponent
  if (node.type.name === "JSXMemberExpression") {
    return getText(node, source);
  }
  // Search children
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const name = findJSXTagName(child, source);
    if (name) return name;
  }
  return null;
}

/**
 * Convert a JSX element to a jsx/jsxs call.
 */
function convertJSXElement(node: SyntaxNode, source: string): Expr {
  const isSelfClosing = node.type.name === "JSXSelfClosingElement" ||
                        getChild(node, "JSXSelfClosingTag") !== null;

  // Get tag name - look in the open tag or self-closing tag
  const openTag = getChild(node, "JSXOpenTag") || getChild(node, "JSXSelfClosingTag") || node;
  const tagName = findJSXTagName(openTag, source);

  if (!tagName) {
    throw new TSParseError("JSX element missing tag name", node.from, node.to, "JSXElement");
  }

  // Get attributes - look in the open/self-closing tag, not the element
  const props: Record<string, Expr> = {};
  const attributes = getAllChildren(openTag);

  for (const attr of attributes) {
    if (attr.type.name === "JSXAttribute") {
      const attrChildren = getAllChildren(attr);
      if (attrChildren.length >= 1) {
        const nameNode = attrChildren[0];
        const attrName = getText(nameNode, source);

        if (attrChildren.length >= 2) {
          const valueNode = attrChildren[attrChildren.length - 1];
          if (valueNode.type.name === "JSXAttributeValue") {
            // String value
            const text = getText(valueNode, source);
            props[attrName] = str(parseStringLiteral(text));
          } else if (valueNode.type.name === "JSXEscape") {
            // Expression value {expr}
            const exprNode = valueNode.firstChild?.nextSibling;
            if (exprNode) {
              props[attrName] = convertNode(exprNode, source);
            }
          } else {
            props[attrName] = convertNode(valueNode, source);
          }
        } else {
          // Boolean attribute: <div disabled />
          props[attrName] = bool(true);
        }
      }
    } else if (attr.type.name === "JSXSpreadAttribute") {
      // Handle spread: {...props}
      // For now, we'll skip spread attributes
      // TODO: Support spread attributes
    }
  }

  // Get children
  const children: Expr[] = [];
  if (!isSelfClosing) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (
        child.type.name !== "JSXOpenTag" &&
        child.type.name !== "JSXCloseTag"
      ) {
        if (child.type.name === "JSXText") {
          const text = getText(child, source).trim();
          if (text) {
            children.push(str(text));
          }
        } else if (child.type.name === "JSXEscape") {
          const exprNode = child.firstChild?.nextSibling;
          if (exprNode) {
            children.push(convertNode(exprNode, source));
          }
        } else if (
          child.type.name === "JSXElement" ||
          child.type.name === "JSXSelfClosingElement" ||
          child.type.name === "JSXFragment"
        ) {
          children.push(convertJSXElement(child, source));
        }
      }
    }
  }

  // Build props object
  if (children.length === 1) {
    props["children"] = children[0];
  } else if (children.length > 1) {
    props["children"] = array(...children);
  }

  // Tag expression: string for intrinsic (lowercase), varRef for component (uppercase)
  const isComponent = tagName[0] === tagName[0].toUpperCase();
  const tagExpr = isComponent ? varRef(tagName) : str(tagName);

  // Choose jsx vs jsxs
  const funcName = children.length > 1 ? "jsxs" : "jsx";
  return call(varRef(funcName), tagExpr, obj(props));
}

/**
 * Convert a JSX fragment to a jsx call.
 */
function convertJSXFragment(node: SyntaxNode, source: string): Expr {
  const children: Expr[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (
      child.type.name !== "JSXFragmentTag" &&
      child.type.name !== "<" &&
      child.type.name !== ">" &&
      child.type.name !== "/"
    ) {
      if (child.type.name === "JSXText") {
        const text = getText(child, source).trim();
        if (text) {
          children.push(str(text));
        }
      } else if (child.type.name === "JSXEscape") {
        const exprNode = child.firstChild?.nextSibling;
        if (exprNode) {
          children.push(convertNode(exprNode, source));
        }
      } else if (
        child.type.name === "JSXElement" ||
        child.type.name === "JSXSelfClosingElement" ||
        child.type.name === "JSXFragment"
      ) {
        children.push(convertJSXElement(child, source));
      }
    }
  }

  // Build props
  const props: Record<string, Expr> = {};
  if (children.length === 1) {
    props["children"] = children[0];
  } else if (children.length > 1) {
    props["children"] = array(...children);
  }

  // Use Fragment component
  const funcName = children.length > 1 ? "jsxs" : "jsx";
  return call(varRef(funcName), varRef("Fragment"), obj(props));
}
