/**
 * Pure interpreter with constraints-as-types.
 */

// Core constraint system
export {
  Constraint,
  isNumber,
  isString,
  isBool,
  isNull,
  isObject,
  isArray,
  isFunction,
  never,
  any,
  equals,
  gt,
  gte,
  lt,
  lte,
  hasField,
  elements,
  length,
  elementAt,
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
} from "./constraint";

// Values
export {
  Value,
  NumberValue,
  StringValue,
  BoolValue,
  NullValue,
  ObjectValue,
  ArrayValue,
  ClosureValue,
  numberVal,
  stringVal,
  boolVal,
  nullVal,
  objectVal,
  arrayVal,
  closureVal,
  constraintOf,
  widenConstraint,
  valueSatisfies,
  valueToString,
  valueFromRaw,
  valueToRaw,
} from "./value";

// Expressions
export {
  Expr,
  LitExpr,
  VarExpr,
  BinOpExpr,
  UnaryOpExpr,
  IfExpr,
  LetExpr,
  FnExpr,
  CallExpr,
  ObjExpr,
  FieldExpr,
  ArrayExpr,
  IndexExpr,
  BlockExpr,
  ComptimeExpr,
  RuntimeExpr,
  BinOp,
  UnaryOp,
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
  fn,
  call,
  obj,
  field,
  array,
  index,
  block,
  comptime,
  runtime,
  exprToString,
} from "./expr";

// Environment
export {
  Binding,
  Env,
  RefinementContext,
} from "./env";

// Builtins
export {
  EvalResult,
  BuiltinOp,
  TypeError,
  requireConstraint,
  getBinaryOp,
  getUnaryOp,
} from "./builtins";

// Evaluator
export {
  evaluate,
  run,
  runValue,
} from "./evaluate";

// Refinement
export {
  Refinement,
  extractRefinement,
  extractAllRefinements,
  extractTypeGuard,
  negateRefinement,
  emptyRefinement,
  singleRefinement,
  mergeRefinements,
} from "./refinement";

// Staged Values
export {
  SValue,
  Now,
  Later,
  now,
  later,
  isNow,
  isLater,
  allNow,
  constraintOfSV,
  svalueToString,
} from "./svalue";

// Staged Evaluator
export {
  SEnv,
  SBinding,
  SClosure,
  StagingError,
  SEvalResult,
  stagingEvaluate,
  stage,
  stageToExpr,
  freshVar,
  resetVarCounter,
} from "./staged-evaluate";

// Code Generation
export {
  CodeGenOptions,
  generateJS,
  generateModule,
  generateFunction,
  compile,
} from "./codegen";

// Lexer
export {
  Token,
  TokenType,
  Lexer,
  LexerError,
  tokenize,
} from "./lexer";

// Parser
export {
  Parser,
  ParseError,
  parse,
  parseAndRun,
  parseAndCompile,
} from "./parser";
