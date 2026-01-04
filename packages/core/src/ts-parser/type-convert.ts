/**
 * TypeScript Type Annotation to Constraint Conversion
 *
 * Converts parsed TypeScript type syntax (from Lezer) to our Constraint type.
 * This provides compile-time type checking via comptime(assert()).
 */

import type { SyntaxNode } from "@lezer/common";
import type { Constraint } from "../constraint";
import {
  isNumber,
  isString,
  isBool,
  isNull,
  isUndefined,
  isObject,
  isArray,
  isFunction,
  anyC,
  neverC,
  and,
  or,
  equals,
  hasField,
  elements,
  tupleConstraint,
} from "../constraint";
import type { Value } from "../value";
import { typeVal } from "../value";
import type { Expr } from "../expr";
import { varRef, call, obj, array, num, str, bool, nil } from "../expr";

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
 * Convert a TypeScript type name to a Constraint.
 */
function convertTypeName(name: string): Constraint {
  switch (name) {
    case "number":
      return isNumber;
    case "string":
      return isString;
    case "boolean":
      return isBool;
    case "null":
      return isNull;
    case "undefined":
      return isUndefined;
    case "void":
      return isUndefined;
    case "any":
    case "unknown":
      return anyC;
    case "never":
      return neverC;
    case "object":
      return isObject;
    default:
      // Unknown type names become any
      return anyC;
  }
}

/**
 * Convert a TypeScript type node to a Constraint.
 */
export function convertTypeNode(node: SyntaxNode, source: string): Constraint {
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
      return isUndefined;

    case "NullType":
      return isNull;

    // Union type: A | B
    case "UnionType": {
      const children = getAllChildren(node);
      const constraints: Constraint[] = [];
      for (const child of children) {
        // Skip the | operator
        if (child.type.name !== "|") {
          constraints.push(convertTypeNode(child, source));
        }
      }
      return or(...constraints);
    }

    // Intersection type: A & B
    case "IntersectionType": {
      const children = getAllChildren(node);
      const constraints: Constraint[] = [];
      for (const child of children) {
        // Skip the & operator
        if (child.type.name !== "&") {
          constraints.push(convertTypeNode(child, source));
        }
      }
      return and(...constraints);
    }

    // Array type: T[]
    case "ArrayType": {
      const elementType = node.firstChild;
      if (elementType) {
        return and(isArray, elements(convertTypeNode(elementType, source)));
      }
      return isArray;
    }

    // Tuple type: [A, B, C]
    case "TupleType": {
      const elementTypes = getAllChildren(node).filter(
        (n) => n.type.name !== "[" && n.type.name !== "]" && n.type.name !== ","
      );
      const constraints = elementTypes.map((t) => convertTypeNode(t, source));
      return tupleConstraint(constraints);
    }

    // Object type: { x: number, y: string }
    case "ObjectType": {
      const constraints: Constraint[] = [isObject];
      const properties = getChildren(node, "PropertyType");
      for (const prop of properties) {
        const nameNode = getChild(prop, "PropertyName") || prop.firstChild;
        if (nameNode) {
          const name = getText(nameNode, source);
          // Find the type annotation (after the :)
          const typeNode = getChild(prop, "TypeAnnotation");
          const propType = typeNode
            ? convertTypeNode(
                typeNode.firstChild?.nextSibling || typeNode,
                source
              )
            : anyC;
          constraints.push(hasField(name, propType));
        }
      }
      return and(...constraints);
    }

    // Literal types: 5, "hello", true, false
    case "LiteralType": {
      const child = node.firstChild;
      if (child) {
        const literal = getText(child, source);
        if (child.type.name === "Number") {
          return and(isNumber, equals(parseFloat(literal)));
        }
        if (child.type.name === "String") {
          // Remove quotes
          const str = literal.slice(1, -1);
          return and(isString, equals(str));
        }
        if (literal === "true") {
          return and(isBool, equals(true));
        }
        if (literal === "false") {
          return and(isBool, equals(false));
        }
        if (literal === "null") {
          return isNull;
        }
      }
      return anyC;
    }

    // Number literal (when used directly as type)
    case "Number": {
      const value = parseFloat(getText(node, source));
      return and(isNumber, equals(value));
    }

    // String literal (when used directly as type)
    case "String": {
      const raw = getText(node, source);
      const value = raw.slice(1, -1); // Remove quotes
      return and(isString, equals(value));
    }

    // Function type: (x: T) => U
    case "FunctionType":
    case "ArrowType":
      return isFunction;

    // Parameterized type: Array<T>, Map<K, V>
    case "ParameterizedType": {
      const typeName = getChild(node, "TypeName");
      if (typeName) {
        const name = getText(typeName, source);
        if (name === "Array") {
          const typeArgs = getChild(node, "TypeArgList");
          if (typeArgs && typeArgs.firstChild) {
            const elementType = convertTypeNode(typeArgs.firstChild, source);
            return and(isArray, elements(elementType));
          }
          return isArray;
        }
        // Other generic types become any for now
      }
      return anyC;
    }

    // Parenthesized type: (T)
    case "ParenthesizedType": {
      const inner = node.firstChild?.nextSibling;
      if (inner) {
        return convertTypeNode(inner, source);
      }
      return anyC;
    }

    // Type annotation wrapper (contains : and the actual type)
    case "TypeAnnotation": {
      // Skip the colon, get the type
      const child = node.firstChild?.nextSibling || node.firstChild;
      if (child) {
        return convertTypeNode(child, source);
      }
      return anyC;
    }

    default:
      // Unknown type constructs become any
      return anyC;
  }
}

/**
 * Convert a Constraint to an Expr that evaluates to a TypeValue.
 * This creates expression code that constructs the type at runtime/compile-time.
 */
export function constraintToExpr(c: Constraint): Expr {
  // For simplicity, we use varRef to reference built-in type constructors.
  // These are expected to be in scope (from the prelude or imports).
  switch (c.tag) {
    case "isNumber":
      return varRef("Number");
    case "isString":
      return varRef("String");
    case "isBool":
      return varRef("Boolean");
    case "isNull":
      return varRef("Null");
    case "isUndefined":
      return varRef("Undefined");
    case "isObject":
      return varRef("Object");
    case "isArray":
      return varRef("Array");
    case "isFunction":
      return varRef("Function");
    case "any":
      return varRef("Any");
    case "never":
      return varRef("Never");
    case "equals":
      return call(varRef("Equals"), valueToExpr(c.value));
    case "and":
      return call(varRef("And"), ...c.constraints.map(constraintToExpr));
    case "or":
      return call(varRef("Or"), ...c.constraints.map(constraintToExpr));
    case "hasField":
      return call(
        varRef("HasField"),
        str(c.name),
        constraintToExpr(c.constraint)
      );
    case "elements":
      return call(varRef("Elements"), constraintToExpr(c.constraint));
    case "elementAt":
      return call(
        varRef("ElementAt"),
        num(c.index),
        constraintToExpr(c.constraint)
      );
    case "length":
      return call(varRef("Length"), constraintToExpr(c.constraint));
    default:
      // For complex constraints, fall back to Any
      return varRef("Any");
  }
}

/**
 * Convert a JavaScript value to an Expr.
 */
function valueToExpr(value: unknown): Expr {
  if (value === null) return nil;
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return str(value);
  if (typeof value === "boolean") return bool(value);
  // For complex values, just use null
  return nil;
}

/**
 * Type alias for exported convenience.
 */
export { Constraint };
