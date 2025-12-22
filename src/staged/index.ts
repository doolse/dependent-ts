/**
 * Staged Interpreter - Main exports
 */

// Types
export { TypeValue, PrimitiveType, ObjectType, LiteralType, ArrayType, MetaType, FunctionType, TypeVariable, ObjectField } from "./types";
export { numberType, stringType, boolType, metatype, literalType, objectType, arrayType, functionType, typeVar, resetTypeVarCounter, inferType, widenType, typeToString, typeEquals, isSubtype } from "./types";

// Unification
export { Substitution, UnifyResult, emptySubst, applySubst, occursIn, unify, composeSubst, unifyAll } from "./unify";

// Staged values
export { SValue, NowValue, LaterValue, SourceInfo, Closure, nowValue, laterValue, isNow, isLater, isClosure, makeClosure, withSource, Env } from "./svalue";

// Expressions
export { Expr, LiteralExpr, VariableExpr, BinaryOpExpr, IfExpr, ObjectExpr, FieldAccessExpr, CallExpr, ReflectExpr, TypeOpExpr, LambdaExpr, LetExpr, BinaryOp, ReflectOp, TypeOp, FunctionDef } from "./expr";
export { lit, varRef, binOp, ifExpr, obj, field, call, lambda, letExpr, typeOf, fields, fieldType, hasField, isSubtypeExpr, typeEqualsExpr, typeTag, typeToStringExpr, pick, omit, partial, required, merge, elementType } from "./expr";

// Reflection
export { makeTypeValue, isTypeValue, getTypeValue, reflectTypeOf, reflectFields, reflectFieldType, reflectHasField, reflectIsSubtype, reflectTypeEquals, reflectTypeTag, reflectTypeToString, typeOpPick, typeOpOmit, typeOpPartial, typeOpRequired, typeOpMerge, typeOpElementType, typeOpMakeObject } from "./reflect";

// JavaScript expressions
export { JsExpr, JsLiteral, JsParam, JsBinaryOp, JsConditional, JsFieldAccess, JsObject, JsCall } from "./jsexpr";
export { jsLit, jsParam, jsBinOp, jsCond, jsField, jsObj, jsCall } from "./jsexpr";

// Code generation
export { exprToJs, generateFunction } from "./codegen";

// Constraints
export { Constraint, ConstraintTerm } from "./constraints";
export { symTerm, litTerm, fieldTerm, eqConstraint, neqConstraint, ltConstraint, lteConstraint, gtConstraint, gteConstraint, andConstraint, orConstraint, notConstraint } from "./constraints";
export { termEquals, constraintEquals, negateConstraint, constraintToString, termToString } from "./constraints";

// Refinement
export { RefinementContext, emptyContext, extendContext, allFacts, proveFromFacts, debugContext } from "./refinement";

// Built-ins
export { BuiltinFn, builtins, toExpr, toConstraintTerm, extractConstraint } from "./builtins";

// Evaluation
export { evaluate } from "./evaluate";

// Entry points
export { specialize, evaluateFully, UnknownInput } from "./specialize";

// Parser
export { parse, parseFunction } from "./parser";
