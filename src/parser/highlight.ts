/**
 * Syntax highlighting props for editor integration.
 */

import { styleTags, tags as t } from "@lezer/highlight";

export const highlighting = styleTags({
  "const type newtype import from as export async await match case when throw": t.keyword,
  "true false null undefined": t.literal,
  "comptime extends": t.modifier,
  VariableName: t.variableName,
  TypeName: t.typeName,
  PropertyName: t.propertyName,
  String: t.string,
  Number: t.number,
  LineComment: t.lineComment,
  BlockComment: t.blockComment,
  "( )": t.paren,
  "[ ]": t.squareBracket,
  "{ }": t.brace,
  ",": t.separator,
  ";": t.separator,
  "=>": t.definitionOperator,
  ":": t.punctuation,
  "@": t.meta,
  // Operators are styled via BinaryExpr/UnaryExpr nodes
  BinaryExpr: t.operator,
  UnaryExpr: t.operator,
});
