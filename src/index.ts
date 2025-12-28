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
  Substitution,
  emptySubstitution,
  applySubstitution,
  freeConstraintVars,
  solve,
  freshCVar,
  resetConstraintVarCounter,
  ConstraintScheme,
  generalize,
  instantiate,
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
  TypeValue,
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

// Expressions
export {
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
  // Patterns for destructuring
  Pattern,
  VarPattern,
  ArrayPattern,
  ObjectPattern,
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
  AssertCondExpr,
  MethodCallExpr,
  ImportExpr,
  TypeOfExpr,
} from "./expr";

// Method Registry
export {
  MethodDef,
  stringMethods,
  arrayMethods,
  numberMethods,
  lookupMethod,
  getMethodNames,
} from "./methods";

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
  AssertionError,
  requireConstraint,
  getBinaryOp,
  getUnaryOp,
} from "./builtins";

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
  LaterArray,
  StagedClosure,
  LaterOrigin,
  SEnv,
  SBinding,
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

// Staged Evaluator
export {
  StagingError,
  SEvalResult,
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

// Code Generation
export {
  CodeGenOptions,
  generateJS,
  generateModule,
  generateModuleWithImports,
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

// TypeScript Declaration Loader
export {
  ModuleDeclarations,
  TSDeclarationLoader,
  loadModule,
  loadFromSource,
  loadExports,
} from "./ts-loader";

// JS AST Types
export {
  JSExpr,
  JSStmt,
  JSModule,
  JSImportDecl,
  JSExportDefault,
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

// JS Printer
export {
  PrintOptions,
  printExpr,
  printStmts,
  printModule,
} from "./js-printer";

// SValue Module Generator
export {
  generateESModule,
} from "./svalue-module-generator";
