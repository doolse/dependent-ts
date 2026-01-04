/**
 * TypeScript Type Annotation to Expr Conversion
 *
 * Converts parsed TypeScript type syntax (from Lezer) directly to Expr
 * that evaluates to TypeValue. This provides compile-time type checking
 * via comptime(assert()).
 */

import type { SyntaxNode } from "@lezer/common";
import type { Expr } from "../expr";
import { varRef, call, num, str, bool } from "../expr";

/**
 * Get text content of a syntax node.
 */
function getText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

/**
 * Get first child node with a specific name.
 */
function getChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === name) return child;
  }
  return null;
}

/**
 * Get all children with a specific name.
 */
function getChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === name) children.push(child);
  }
  return children;
}

/**
 * Get all direct children nodes (excluding anonymous nodes).
 */
function getAllChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

/**
 * Check if a property has the optional modifier (?).
 */
function hasOptionalModifier(node: SyntaxNode, source: string): boolean {
  // Look for "?" token after property name
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (getText(child, source) === "?") return true;
    // Stop at TypeAnnotation (: comes after ?)
    if (child.type.name === "TypeAnnotation") break;
  }
  return false;
}

/**
 * Convert a TypeScript type name to an Expr referencing the builtin type.
 */
function convertTypeName(name: string): Expr {
  switch (name) {
    case "number":
      return varRef("number");
    case "string":
      return varRef("string");
    case "boolean":
      return varRef("boolean");
    case "null":
      return varRef("null");
    case "undefined":
      return varRef("undefined");
    case "void":
      return varRef("undefined");
    case "any":
    case "unknown":
      return varRef("any");
    case "never":
      return varRef("never");
    case "object":
      return varRef("object");
    default:
      // Unknown type names become any
      return varRef("any");
  }
}

/**
 * Convert a TypeScript type node directly to an Expr that evaluates to a TypeValue.
 * This calls builtin type constructors like `number`, `unionType`, etc.
 */
export function convertTypeNodeToExpr(
  node: SyntaxNode,
  source: string
): Expr {
  const typeName = node.type.name;

  switch (typeName) {
    // Type identifiers like "number", "string", etc.
    case "TypeName":
    case "Identifier":
    case "VariableName": {
      const name = getText(node, source);
      return convertTypeName(name);
    }

    // Primitive type keywords
    case "VoidType":
      return varRef("undefined");

    case "NullType":
      return varRef("null");

    // Union type: A | B
    case "UnionType": {
      const children = getAllChildren(node);
      const exprs: Expr[] = [];
      for (const child of children) {
        // Skip the | operator
        if (child.type.name !== "|") {
          exprs.push(convertTypeNodeToExpr(child, source));
        }
      }
      return call(varRef("unionType"), ...exprs);
    }

    // Intersection type: A & B
    case "IntersectionType": {
      const children = getAllChildren(node);
      const exprs: Expr[] = [];
      for (const child of children) {
        // Skip the & operator
        if (child.type.name !== "&") {
          exprs.push(convertTypeNodeToExpr(child, source));
        }
      }
      return call(varRef("intersectionType"), ...exprs);
    }

    // Array type: T[]
    case "ArrayType": {
      const elementType = node.firstChild;
      if (elementType) {
        return call(
          varRef("intersectionType"),
          varRef("array"),
          call(varRef("elementsType"), convertTypeNodeToExpr(elementType, source))
        );
      }
      return varRef("array");
    }

    // Tuple type: [A, B, C]
    case "TupleType": {
      const elementTypes = getAllChildren(node).filter(
        (n) => n.type.name !== "[" && n.type.name !== "]" && n.type.name !== ","
      );
      const exprs = elementTypes.map((t) => convertTypeNodeToExpr(t, source));

      // Build: intersectionType(array, elementAtType(0, T0), elementAtType(1, T1), ..., lengthType(equalsType(N)))
      const args: Expr[] = [varRef("array")];
      for (let i = 0; i < exprs.length; i++) {
        args.push(call(varRef("elementAtType"), num(i), exprs[i]));
      }
      args.push(call(varRef("lengthType"), call(varRef("equalsType"), num(exprs.length))));

      return call(varRef("intersectionType"), ...args);
    }

    // Object type: { x: number, y: string, z?: boolean }
    case "ObjectType": {
      const args: Expr[] = [varRef("object")];
      const properties = getChildren(node, "PropertyType");
      for (const prop of properties) {
        const nameNode = getChild(prop, "PropertyName") || prop.firstChild;
        if (nameNode) {
          const name = getText(nameNode, source);

          // Check for optional modifier (? after property name)
          const isOptional = hasOptionalModifier(prop, source);

          // Find the type annotation (after the :)
          const typeNode = getChild(prop, "TypeAnnotation");
          let propTypeExpr = typeNode
            ? convertTypeNodeToExpr(
                typeNode.firstChild?.nextSibling || typeNode,
                source
              )
            : varRef("any");

          // Optional properties: union with undefined
          if (isOptional) {
            propTypeExpr = call(varRef("unionType"), propTypeExpr, varRef("undefined"));
          }

          args.push(call(varRef("hasFieldType"), str(name), propTypeExpr));
        }
      }
      return call(varRef("intersectionType"), ...args);
    }

    // Literal types: 5, "hello", true, false
    case "LiteralType": {
      const child = node.firstChild;
      if (child) {
        const literal = getText(child, source);
        if (child.type.name === "Number") {
          return call(
            varRef("intersectionType"),
            varRef("number"),
            call(varRef("equalsType"), num(parseFloat(literal)))
          );
        }
        if (child.type.name === "String") {
          // Remove quotes
          const strVal = literal.slice(1, -1);
          return call(
            varRef("intersectionType"),
            varRef("string"),
            call(varRef("equalsType"), str(strVal))
          );
        }
        if (literal === "true") {
          return call(
            varRef("intersectionType"),
            varRef("boolean"),
            call(varRef("equalsType"), bool(true))
          );
        }
        if (literal === "false") {
          return call(
            varRef("intersectionType"),
            varRef("boolean"),
            call(varRef("equalsType"), bool(false))
          );
        }
        if (literal === "null") {
          return varRef("null");
        }
      }
      return varRef("any");
    }

    // Number literal (when used directly as type)
    case "Number": {
      const value = parseFloat(getText(node, source));
      return call(
        varRef("intersectionType"),
        varRef("number"),
        call(varRef("equalsType"), num(value))
      );
    }

    // String literal (when used directly as type)
    case "String": {
      const raw = getText(node, source);
      const value = raw.slice(1, -1); // Remove quotes
      return call(
        varRef("intersectionType"),
        varRef("string"),
        call(varRef("equalsType"), str(value))
      );
    }

    // Function type: (x: T) => U
    case "FunctionType":
    case "ArrowType":
      return varRef("function");

    // Parameterized type: Array<T>, Map<K, V>
    case "ParameterizedType": {
      const typeNameNode = getChild(node, "TypeName");
      if (typeNameNode) {
        const name = getText(typeNameNode, source);
        if (name === "Array") {
          const typeArgs = getChild(node, "TypeArgList");
          if (typeArgs && typeArgs.firstChild) {
            const elementTypeExpr = convertTypeNodeToExpr(typeArgs.firstChild, source);
            return call(
              varRef("intersectionType"),
              varRef("array"),
              call(varRef("elementsType"), elementTypeExpr)
            );
          }
          return varRef("array");
        }
        // Other generic types become any for now
      }
      return varRef("any");
    }

    // Parenthesized type: (T)
    case "ParenthesizedType": {
      const inner = node.firstChild?.nextSibling;
      if (inner) {
        return convertTypeNodeToExpr(inner, source);
      }
      return varRef("any");
    }

    // Type annotation wrapper (contains : and the actual type)
    case "TypeAnnotation": {
      // Skip the colon, get the type
      const child = node.firstChild?.nextSibling || node.firstChild;
      if (child) {
        return convertTypeNodeToExpr(child, source);
      }
      return varRef("any");
    }

    default:
      // Unknown type constructs become any
      return varRef("any");
  }
}
