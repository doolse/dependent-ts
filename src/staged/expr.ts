/**
 * Expression AST for the source language.
 * Includes reflection expressions for type introspection.
 */

export type Expr =
  | LiteralExpr
  | VariableExpr
  | BinaryOpExpr
  | IfExpr
  | ObjectExpr
  | FieldAccessExpr
  | CallExpr
  | ReflectExpr
  | TypeOpExpr
  | LambdaExpr
  | LetExpr;

export interface LiteralExpr {
  tag: "literal";
  value: string | number | boolean;
}

export interface VariableExpr {
  tag: "variable";
  name: string;
}

export interface BinaryOpExpr {
  tag: "binary_op";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "&&"
  | "||";

export interface IfExpr {
  tag: "if";
  condition: Expr;
  thenBranch: Expr;
  elseBranch: Expr;
}

export interface ObjectExpr {
  tag: "object";
  fields: { name: string; value: Expr }[];
}

export interface FieldAccessExpr {
  tag: "field_access";
  object: Expr;
  field: string;
}

export interface CallExpr {
  tag: "call";
  func: Expr; // Function expression (can be variable, lambda, etc.)
  args: Expr[];
}

/**
 * Lambda expression - creates a first-class function.
 */
export interface LambdaExpr {
  tag: "lambda";
  params: string[];
  body: Expr;
}

/**
 * Let expression - local binding.
 * `let x = value in body`
 */
export interface LetExpr {
  tag: "let";
  name: string;
  value: Expr;
  body: Expr;
}

/**
 * Reflection expressions - introspect types at specialization time.
 */
export interface ReflectExpr {
  tag: "reflect";
  operation: ReflectOp;
  target: Expr;
  args?: Expr[]; // Additional arguments for some operations
}

export type ReflectOp =
  | "typeOf"      // Get the type of a value
  | "fields"      // Get field names of an object type
  | "fieldType"   // Get the type of a specific field
  | "hasField"    // Check if type has a field
  | "isSubtype"   // Check if one type is subtype of another
  | "typeEquals"  // Check if two types are equal
  | "typeTag"     // Get the tag of a type ("object", "primitive", etc.)
  | "typeToString"; // Convert type to string

/**
 * Type-level operation expressions.
 */
export interface TypeOpExpr {
  tag: "type_op";
  operation: TypeOp;
  args: Expr[];
}

export type TypeOp =
  | "pick"        // Pick specific fields from object type
  | "omit"        // Omit specific fields from object type
  | "partial"     // Make all fields optional
  | "required"    // Make all fields required
  | "merge"       // Merge two object types
  | "elementType"; // Get element type of array

// Expression constructors
export const lit = (value: string | number | boolean): LiteralExpr => ({
  tag: "literal",
  value,
});

export const varRef = (name: string): VariableExpr => ({
  tag: "variable",
  name,
});

export const binOp = (op: BinaryOp, left: Expr, right: Expr): BinaryOpExpr => ({
  tag: "binary_op",
  op,
  left,
  right,
});

export const ifExpr = (condition: Expr, thenBranch: Expr, elseBranch: Expr): IfExpr => ({
  tag: "if",
  condition,
  thenBranch,
  elseBranch,
});

export const obj = (fields: { name: string; value: Expr }[]): ObjectExpr => ({
  tag: "object",
  fields,
});

export const field = (object: Expr, fieldName: string): FieldAccessExpr => ({
  tag: "field_access",
  object,
  field: fieldName,
});

export const call = (func: Expr, ...args: Expr[]): CallExpr => ({
  tag: "call",
  func,
  args,
});

export const lambda = (params: string[], body: Expr): LambdaExpr => ({
  tag: "lambda",
  params,
  body,
});

export const letExpr = (name: string, value: Expr, body: Expr): LetExpr => ({
  tag: "let",
  name,
  value,
  body,
});

// Reflection expression constructors
export const typeOf = (target: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "typeOf",
  target,
});

export const fields = (target: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "fields",
  target,
});

export const fieldType = (target: Expr, fieldName: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "fieldType",
  target,
  args: [fieldName],
});

export const hasField = (target: Expr, fieldName: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "hasField",
  target,
  args: [fieldName],
});

export const isSubtypeExpr = (subtype: Expr, supertype: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "isSubtype",
  target: subtype,
  args: [supertype],
});

export const typeEqualsExpr = (type1: Expr, type2: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "typeEquals",
  target: type1,
  args: [type2],
});

export const typeTag = (typeExpr: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "typeTag",
  target: typeExpr,
});

export const typeToStringExpr = (typeExpr: Expr): ReflectExpr => ({
  tag: "reflect",
  operation: "typeToString",
  target: typeExpr,
});

// Type operation expression constructors
export const pick = (typeExpr: Expr, fieldNames: Expr): TypeOpExpr => ({
  tag: "type_op",
  operation: "pick",
  args: [typeExpr, fieldNames],
});

export const omit = (typeExpr: Expr, fieldNames: Expr): TypeOpExpr => ({
  tag: "type_op",
  operation: "omit",
  args: [typeExpr, fieldNames],
});

export const partial = (typeExpr: Expr): TypeOpExpr => ({
  tag: "type_op",
  operation: "partial",
  args: [typeExpr],
});

export const required = (typeExpr: Expr): TypeOpExpr => ({
  tag: "type_op",
  operation: "required",
  args: [typeExpr],
});

export const merge = (type1: Expr, type2: Expr): TypeOpExpr => ({
  tag: "type_op",
  operation: "merge",
  args: [type1, type2],
});

export const elementType = (arrayType: Expr): TypeOpExpr => ({
  tag: "type_op",
  operation: "elementType",
  args: [arrayType],
});

/**
 * Function definition for specialization.
 */
export interface FunctionDef {
  name: string;
  params: string[];
  body: Expr;
}
