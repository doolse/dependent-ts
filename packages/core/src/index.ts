/**
 * Pure interpreter with constraints-as-types.
 */

// Core constraint system - types
export type {
  Constraint,
  Substitution,
  ConstraintScheme,
} from "./constraint";

// Core constraint system - values
export {
  isNumber,
  isString,
  isBool,
  isNull,
  isUndefined,
  isObject,
  isArray,
  isFunction,
  isType,
  isTypeC,
  never,
  any,
  neverC,
  anyC,
  equals,
  gt,
  gte,
  lt,
  lte,
  hasField,
  elements,
  length,
  elementAt,
  indexSig,
  and,
  or,
  not,
  cvar,
  simplify,
  implies,
  unify,
  narrow,
  narrowOr,
  isNever,
  isAny,
  constraintEquals,
  constraintToString,
  extractAllFieldNames,
  extractFieldConstraint,
  rec,
  recVar,
  // Constraint solving
  emptySubstitution,
  applySubstitution,
  freeConstraintVars,
  solve,
  freshCVar,
  resetConstraintVarCounter,
  generalize,
  instantiate,
} from "./constraint";

// Values - types
export type {
  Value,
  NumberValue,
  StringValue,
  BoolValue,
  NullValue,
  ObjectValue,
  ArrayValue,
  ClosureValue,
  TypeValue,
} from "./value";

// Values - functions
export {
  numberVal,
  stringVal,
  boolVal,
  nullVal,
  objectVal,
  arrayVal,
  closureVal,
  typeVal,
  constraintOf,
  widenConstraint,
  valueSatisfies,
  valueToString,
  valueFromRaw,
  valueToRaw,
} from "./value";

// Expressions - types
export type {
  Expr,
  LitExpr,
  VarExpr,
  BinOpExpr,
  UnaryOpExpr,
  IfExpr,
  LetExpr,
  LetPatternExpr,
  FnExpr,
  RecFnExpr,
  CallExpr,
  ObjExpr,
  FieldExpr,
  ArrayExpr,
  IndexExpr,
  BlockExpr,
  ComptimeExpr,
  RuntimeExpr,
  AssertExpr,
  TrustExpr,
  BinOp,
  UnaryOp,
  Pattern,
  VarPattern,
  ArrayPattern,
  ObjectPattern,
  AssertCondExpr,
  MethodCallExpr,
  ImportExpr,
  TypeOfExpr,
} from "./expr";

// Expressions - functions
export {
  varPattern,
  arrayPattern,
  objectPattern,
  patternToString,
  patternVars,
  lit,
  num,
  str,
  bool,
  nil,
  varRef,
  binop,
  add,
  sub,
  mul,
  div,
  mod,
  eq,
  neq,
  ltExpr,
  gtExpr,
  lteExpr,
  gteExpr,
  andExpr,
  orExpr,
  unary,
  neg,
  notExpr,
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
  runtime,
  assertExpr,
  assertCondExpr,
  trustExpr,
  methodCall,
  importExpr,
  typeOfExpr,
  exprToString,
} from "./expr";

// Method Registry - types
export type { MethodDef } from "./methods";

// Method Registry - values
export {
  stringMethods,
  arrayMethods,
  numberMethods,
  lookupMethod,
  getMethodNames,
} from "./methods";

// Environment - types
export type {
  Binding,
  Env,
} from "./env";

// Environment - classes
export { RefinementContext } from "./env";

// Builtins - types
export type {
  EvalResult,
  BuiltinOp,
} from "./builtins";

// Builtins - values/classes
export {
  TypeError,
  AssertionError,
  requireConstraint,
  getBinaryOp,
  getUnaryOp,
} from "./builtins";

// Refinement - types
export type { Refinement } from "./refinement";

// Refinement - functions
export {
  extractRefinement,
  extractAllRefinements,
  extractTypeGuard,
  negateRefinement,
  emptyRefinement,
  singleRefinement,
  mergeRefinements,
} from "./refinement";

// Staged Values - types
export type {
  SValue,
  Now,
  Later,
  LaterArray,
  StagedClosure,
  LaterOrigin,
  SEnv,
  SBinding,
} from "./svalue";

// Staged Values - functions
export {
  now,
  later,
  laterArray,
  laterRuntime,
  laterImport,
  stagedClosure,
  isNow,
  isLater,
  isLaterArray,
  isStagedClosure,
  isRuntime,
  allNow,
  anyRuntime,
  constraintOfSV,
  collectByOrigin,
  collectClosures,
  mergeCaptures,
  svalueToString,
} from "./svalue";

// Staged Evaluator - types
export type { SEvalResult } from "./staged-evaluate";

// Staged Evaluator - values/classes
export {
  StagingError,
  stagingEvaluate,
  stage,
  stageToExpr,
  svalueToResidual,
  closureToResidual,
  freshVar,
  resetVarCounter,
  run,
  runValue,
} from "./staged-evaluate";

// Code Generation - types
export type { CodeGenOptions } from "./codegen";

// Code Generation - functions
export {
  generateJS,
  generateModuleWithImports,
  compile,
} from "./codegen";

// Lexer - types
export type { Token, TokenType } from "./lexer";

// Lexer - classes/functions
export {
  Lexer,
  LexerError,
  tokenize,
} from "./lexer";

// Parser - classes
export {
  Parser,
  ParseError,
  parse,
  parseAndRun,
  parseAndCompile,
} from "./parser";

// TypeScript Declaration Loader - types
export type { ModuleDeclarations } from "./ts-loader";

// TypeScript Declaration Loader - classes/functions
export {
  TSDeclarationLoader,
  loadModule,
  loadFromSource,
  loadExports,
} from "./ts-loader";

// JS AST Types - types
export type {
  JSExpr,
  JSStmt,
  JSModule,
  JSImportDecl,
  JSExportDefault,
} from "./js-ast";

// JS AST Types - functions
export {
  jsLit,
  jsVar,
  jsBinop,
  jsUnary,
  jsCall,
  jsMethod,
  jsArrow,
  jsNamedFunction,
  jsTernary,
  jsMember,
  jsIndex,
  jsObject,
  jsArray,
  jsIIFE,
  jsConst,
  jsLet,
  jsReturn,
  jsIf,
  jsForOf,
  jsExpr,
  jsContinue,
  jsBreak,
  jsImportDecl,
  jsExportDefault,
  jsModule,
} from "./js-ast";

// JS Printer - types
export type { PrintOptions } from "./js-printer";

// JS Printer - functions
export {
  printExpr,
  printStmts,
  printModule,
} from "./js-printer";

// SValue Module Generator
export {
  generateESModule,
} from "./svalue-module-generator";

// Lezer-based TypeScript/JSX Parser
export {
  parseTS,
  parseTSExpr,
  parseTSType,
  parseTSTypeExpr,
  TSParseError,
  convertTypeNodeToExpr,
} from "./ts-parser";
