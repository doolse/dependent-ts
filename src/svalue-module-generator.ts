/**
 * SValue Module Generator
 *
 * Generates ES modules directly from SValue trees.
 * This is a new code generator that works directly on SValue rather than
 * going through the existing js-backend.ts which primarily works with Expr residuals.
 *
 * Key features:
 * - Collects imports from Later values with origin tracking
 * - Collects runtime parameters and wraps in function
 * - Emits named closures as top-level const declarations
 * - Applies method call optimizations (map → arr.map(), etc.)
 * - Handles mutual recursion with topological sorting
 */

import {
  JSExpr, JSStmt, JSModule, JSImportDecl,
  jsLit, jsVar, jsBinop, jsUnary, jsCall, jsMethod,
  jsArrow, jsNamedFunction, jsTernary, jsMember, jsIndex, jsObject, jsArray,
  jsConst, jsReturn, jsIIFE, jsExpr as jsExprStmt, jsConstPattern,
  jsImportDecl, jsExportDefault, jsModule,
  jsVarPattern, jsArrayPattern, jsObjectPattern,
  jsIf, jsThrow
} from "./js-ast";
import {
  SValue, Now, Later, LaterArray, StagedClosure, SEnv,
  isNow, isLater, isLaterArray, isStagedClosure,
  collectByOrigin, collectClosures, laterRuntime, later
} from "./svalue";
import { closureToResidual, stagingEvaluate, svalueToResidual, createArraySValue, freeVars } from "./staged-evaluate";
import { Value } from "./value";
import { Expr, Pattern, varRef } from "./expr";
import { RefinementContext } from "./env";
import { Constraint, and as andC, isFunction } from "./constraint";
const anyC = { tag: "any" } as const;

// ============================================================================
// Generator Context
// ============================================================================

interface ImportInfo {
  modulePath: string;
  bindings: Set<string>;
  defaultBinding?: string;
}

interface ModuleGenContext {
  // Named closures to emit at top-level (name -> closure)
  namedClosures: Map<string, StagedClosure>;

  // Closures already generated (to avoid duplicates)
  generatedClosures: Set<StagedClosure>;

  // Dependency graph for topological sorting
  closureDeps: Map<string, Set<string>>;

  // Import declarations collected during traversal
  imports: Map<string, ImportInfo>;

  // Runtime parameters collected during traversal
  runtimeParams: Map<string, Later>;
}

function createContext(): ModuleGenContext {
  return {
    namedClosures: new Map(),
    generatedClosures: new Set(),
    closureDeps: new Map(),
    imports: new Map(),
    runtimeParams: new Map(),
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Generate an ES module from an SValue.
 * This is the main entry point for the esModule builtin.
 */
export function generateESModule(sv: SValue): JSModule {
  const ctx = createContext();

  // Phase 1: Collect all metadata (imports, runtime params)
  collectMetadata(sv, ctx);

  // Phase 2: Determine which closures should be top-level
  determineTopLevelClosures(sv, ctx);

  // Phase 3: Compute topological order for closures
  const orderedClosures = topologicalSort(ctx.namedClosures, ctx.closureDeps);

  // Phase 4: Generate import declarations
  const imports = generateImportDecls(ctx.imports);

  // Phase 5: Generate top-level closure statements
  const statements = generateTopLevelClosures(orderedClosures, ctx);

  // Phase 6: Generate the main expression
  let mainExpr = generateSValue(sv, ctx);

  // Phase 7: Wrap with runtime parameters if any
  if (ctx.runtimeParams.size > 0) {
    const params = Array.from(ctx.runtimeParams.keys());
    mainExpr = jsArrow(params, mainExpr);
  }

  return jsModule(imports, statements, jsExportDefault(mainExpr));
}

/**
 * Generate a JavaScript expression from an SValue.
 * This is a simpler entry point for expression-level code generation
 * (used by compile(), generateJS(), etc.)
 */
export function generateExpression(sv: SValue): JSExpr {
  const ctx = createContext();
  return generateSValue(sv, ctx);
}

// ============================================================================
// Phase 1: Metadata Collection
// ============================================================================

function collectMetadata(sv: SValue, ctx: ModuleGenContext): void {
  // Collect imports
  const importLaters = collectByOrigin(sv, "import");
  for (const [name, later] of importLaters) {
    if (later.origin.kind === "import") {
      const { module: modulePath, binding, isDefault } = later.origin;

      let info = ctx.imports.get(modulePath);
      if (!info) {
        info = { modulePath, bindings: new Set() };
        ctx.imports.set(modulePath, info);
      }

      if (isDefault) {
        info.defaultBinding = binding;
      } else {
        info.bindings.add(binding);
      }
    }
  }

  // Collect runtime parameters
  const runtimeLaters = collectByOrigin(sv, "runtime");
  for (const [name, later] of runtimeLaters) {
    ctx.runtimeParams.set(name, later);
  }
}

// ============================================================================
// Phase 2: Top-Level Closure Detection
// ============================================================================

function determineTopLevelClosures(sv: SValue, ctx: ModuleGenContext): void {
  // Collect all closures from the SValue tree
  const allClosures = collectClosures(sv);

  // Named closures are candidates for top-level emission
  for (const closure of allClosures) {
    if (closure.name) {
      ctx.namedClosures.set(closure.name, closure);

      // Analyze dependencies
      const deps = collectClosureDependencies(closure, allClosures);
      ctx.closureDeps.set(closure.name, deps);
    }
  }
}

/**
 * Collect names of closures that a given closure depends on.
 */
function collectClosureDependencies(
  sc: StagedClosure,
  allClosures: StagedClosure[]
): Set<string> {
  const deps = new Set<string>();

  // Walk the closure's environment
  for (const [, binding] of sc.env.entries()) {
    const sv = binding.svalue;
    if (isStagedClosure(sv) && sv.name) {
      deps.add(sv.name);
    }
  }

  // Also check siblings (mutual recursion)
  if (sc.siblings) {
    for (const sibling of sc.siblings) {
      deps.add(sibling);
    }
  }

  return deps;
}

// ============================================================================
// Phase 3: Topological Sort
// ============================================================================

/**
 * Topologically sort closures so dependencies come before dependents.
 * Returns groups - closures in the same group form a mutual recursion cycle.
 */
function topologicalSort(
  closures: Map<string, StagedClosure>,
  deps: Map<string, Set<string>>
): StagedClosure[][] {
  if (closures.size === 0) return [];

  // Find strongly connected components using Tarjan's algorithm
  const sccs = findSCCs(closures, deps);

  // Sort SCCs topologically
  const sccDeps = computeSCCDeps(sccs, deps);
  const sortedSCCIndices = topSortSCCs(sccs.length, sccDeps);

  // Convert to closure groups
  return sortedSCCIndices.map(i =>
    sccs[i].map(name => closures.get(name)!).filter(Boolean)
  );
}

/**
 * Find strongly connected components using Tarjan's algorithm.
 */
function findSCCs(
  closures: Map<string, StagedClosure>,
  deps: Map<string, Set<string>>
): string[][] {
  const sccs: string[][] = [];
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let currentIndex = 0;

  function strongConnect(name: string): void {
    index.set(name, currentIndex);
    lowlink.set(name, currentIndex);
    currentIndex++;
    stack.push(name);
    onStack.add(name);

    const dependencies = deps.get(name) || new Set();
    for (const dep of dependencies) {
      if (!closures.has(dep)) continue; // External dependency

      if (!index.has(dep)) {
        strongConnect(dep);
        lowlink.set(name, Math.min(lowlink.get(name)!, lowlink.get(dep)!));
      } else if (onStack.has(dep)) {
        lowlink.set(name, Math.min(lowlink.get(name)!, index.get(dep)!));
      }
    }

    // If this is a root node, pop the SCC
    if (lowlink.get(name) === index.get(name)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== name);
      sccs.push(scc);
    }
  }

  for (const name of closures.keys()) {
    if (!index.has(name)) {
      strongConnect(name);
    }
  }

  return sccs;
}

/**
 * Compute dependencies between SCCs.
 */
function computeSCCDeps(
  sccs: string[][],
  deps: Map<string, Set<string>>
): Map<number, Set<number>> {
  // Build name -> SCC index lookup
  const nameToSCC = new Map<string, number>();
  sccs.forEach((scc, i) => {
    for (const name of scc) {
      nameToSCC.set(name, i);
    }
  });

  // Compute SCC-level dependencies
  const sccDeps = new Map<number, Set<number>>();
  sccs.forEach((scc, i) => {
    const sccDepSet = new Set<number>();
    for (const name of scc) {
      const nameDeps = deps.get(name) || new Set();
      for (const dep of nameDeps) {
        const depSCC = nameToSCC.get(dep);
        if (depSCC !== undefined && depSCC !== i) {
          sccDepSet.add(depSCC);
        }
      }
    }
    sccDeps.set(i, sccDepSet);
  });

  return sccDeps;
}

/**
 * Topologically sort SCC indices.
 */
function topSortSCCs(count: number, deps: Map<number, Set<number>>): number[] {
  const result: number[] = [];
  const visited = new Set<number>();

  function visit(i: number): void {
    if (visited.has(i)) return;
    visited.add(i);

    for (const dep of deps.get(i) || []) {
      visit(dep);
    }

    result.push(i);
  }

  for (let i = 0; i < count; i++) {
    visit(i);
  }

  return result;
}

// ============================================================================
// Phase 4: Import Generation
// ============================================================================

function generateImportDecls(imports: Map<string, ImportInfo>): JSImportDecl[] {
  const decls: JSImportDecl[] = [];

  for (const [modulePath, info] of imports) {
    // Default import
    if (info.defaultBinding) {
      decls.push(jsImportDecl([info.defaultBinding], modulePath, true));
    }

    // Named imports
    if (info.bindings.size > 0) {
      decls.push(jsImportDecl(Array.from(info.bindings).sort(), modulePath));
    }
  }

  // Sort by module path for consistent output
  return decls.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
}

// ============================================================================
// Args Destructuring Optimization
// ============================================================================

/**
 * Optimization: Extract params from `let [x, y] = args in body` pattern.
 * This transforms `fn() => let [x, y] = args in body` to `fn(x, y) => body`.
 */
function extractParamsFromBody(body: Expr): { params: string[]; body: Expr } {
  if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern") {
      const params: string[] = [];
      for (const elem of pattern.elements) {
        if (elem.tag === "varPattern") {
          params.push(elem.name);
        } else {
          return { params: [], body };
        }
      }
      return { params, body: body.body };
    }
  }
  return { params: [], body };
}

/**
 * Check if body has redundant args destructuring that matches the existing params.
 * If so, return the inner body (stripping the letPattern).
 */
function stripRedundantArgsDestructuring(params: string[], body: Expr): Expr {
  if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern") {
      // Check if pattern matches params
      if (pattern.elements.length === params.length) {
        let matches = true;
        for (let i = 0; i < params.length; i++) {
          const elem = pattern.elements[i];
          if (elem.tag !== "varPattern" || elem.name !== params[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return body.body;
        }
      }
    }
  }
  return body;
}

// ============================================================================
// Phase 5: Top-Level Closure Generation
// ============================================================================

function generateTopLevelClosures(
  orderedGroups: StagedClosure[][],
  ctx: ModuleGenContext
): JSStmt[] {
  const stmts: JSStmt[] = [];

  for (const group of orderedGroups) {
    for (const sc of group) {
      if (!sc.name) continue;

      // Mark as generated
      ctx.generatedClosures.add(sc);

      // Convert the StagedClosure to a residual function expression
      const residual = closureToResidual(sc);

      // Generate code from the residual expression
      const fn = generateFromExpr(residual, ctx);

      stmts.push(jsConst(sc.name, fn));
    }
  }

  return stmts;
}

/**
 * Generate the body expression for a closure.
 */
function generateClosureBody(sc: StagedClosure, ctx: ModuleGenContext): JSExpr | JSStmt[] {
  return generateClosureBodyFromExpr(sc.body, ctx);
}

/**
 * Collect let chain as statements for function body.
 */
function collectLetChainStmts(expr: Expr, ctx: ModuleGenContext): JSStmt[] {
  const stmts: JSStmt[] = [];
  let current = expr;

  while (current.tag === "let" || current.tag === "letPattern") {
    if (current.tag === "let") {
      const valueJs = generateFromExpr(current.value, ctx);
      if (current.name === "_") {
        stmts.push(jsExprStmt(valueJs));
      } else {
        stmts.push(jsConst(current.name, valueJs));
      }
      current = current.body;
    } else {
      const valueJs = generateFromExpr(current.value, ctx);
      const pattern = convertPattern(current.pattern);
      stmts.push(jsConstPattern(pattern, valueJs));
      current = current.body;
    }
  }

  stmts.push(jsReturn(generateFromExpr(current, ctx)));
  return stmts;
}

// ============================================================================
// Phase 6: SValue to JSExpr Generation
// ============================================================================

/**
 * Generate JSExpr from an SValue.
 */
function generateSValue(sv: SValue, ctx: ModuleGenContext): JSExpr {
  switch (sv.stage) {
    case "now":
      return generateNow(sv, ctx);
    case "later":
      return generateLater(sv, ctx);
    case "closure":
      return generateClosure(sv, ctx);
    case "later-array":
      return generateLaterArray(sv, ctx);
  }
}

function generateNow(sv: Now, ctx: ModuleGenContext): JSExpr {
  if (sv.residual) {
    return generateFromExpr(sv.residual, ctx);
  }
  return generateFromValue(sv.value, ctx);
}

function generateLater(sv: Later, ctx: ModuleGenContext): JSExpr {
  // Try method optimizations first
  const optimized = tryMethodOptimization(sv.residual, ctx);
  if (optimized) return optimized;

  return generateFromExpr(sv.residual, ctx);
}

function generateClosure(sc: StagedClosure, ctx: ModuleGenContext): JSExpr {
  // Reference by name if it's a top-level closure
  if (sc.name && ctx.namedClosures.has(sc.name)) {
    return jsVar(sc.name);
  }

  // Inline the closure
  return generateInlineClosure(sc, ctx);
}

function generateInlineClosure(sc: StagedClosure, ctx: ModuleGenContext): JSExpr {
  // Convert the StagedClosure to a residual function expression first
  // This properly stages the body with parameters bound as Later values
  // and converts `args` to the array of parameters
  const residual = closureToResidual(sc);

  // Generate code from the residual expression
  return generateFromExpr(residual, ctx);
}

function generateClosureBodyFromExpr(body: Expr, ctx: ModuleGenContext): JSExpr | JSStmt[] {
  if (body.tag === "let" || body.tag === "letPattern") {
    return collectLetChainStmts(body, ctx);
  }
  return generateFromExpr(body, ctx);
}

function generateLaterArray(sv: LaterArray, ctx: ModuleGenContext): JSExpr {
  return jsArray(sv.elements.map(elem => generateSValue(elem, ctx)));
}

// ============================================================================
// Value Generation
// ============================================================================

function generateFromValue(value: Value, ctx: ModuleGenContext): JSExpr {
  switch (value.tag) {
    case "number":
      return jsLit(value.value);

    case "string":
      return jsLit(value.value);

    case "bool":
      return jsLit(value.value);

    case "null":
      return jsLit(null);

    case "object": {
      const fields: { key: string; value: JSExpr }[] = [];
      for (const [name, val] of value.fields) {
        fields.push({ key: name, value: generateFromValue(val, ctx) });
      }
      return jsObject(fields);
    }

    case "array":
      return jsArray(value.elements.map(e => generateFromValue(e, ctx)));

    case "closure":
      throw new Error("Unexpected ClosureValue - should be StagedClosure");

    case "type":
      throw new Error("Types are compile-time only and cannot be used at runtime");

    case "builtin":
      return jsVar(value.name);
  }
}

// ============================================================================
// Method Call Optimizations
// ============================================================================

// Methods that should be transformed to method call syntax
const FIRST_ARG_METHODS = new Set([
  "map", "filter",
  // String methods
  "startsWith", "endsWith", "includes", "indexOf", "lastIndexOf",
  "toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd",
  "slice", "substring", "charAt", "charCodeAt", "split",
  "replace", "replaceAll", "padStart", "padEnd", "repeat", "concat",
  // Array methods
  "join", "reverse",
  // Number methods
  "toString", "toFixed",
]);

function tryMethodOptimization(expr: Expr, ctx: ModuleGenContext): JSExpr | null {
  if (expr.tag !== "call" || expr.func.tag !== "var") return null;

  const name = expr.func.name;

  // print(...) -> console.log(...)
  if (name === "print") {
    return jsMethod(
      jsVar("console"),
      "log",
      expr.args.map(a => generateFromExpr(a, ctx))
    );
  }

  // First-arg-as-receiver methods: fn(receiver, ...args) -> receiver.fn(...args)
  if (FIRST_ARG_METHODS.has(name) && expr.args.length >= 1) {
    const [receiver, ...rest] = expr.args;
    return jsMethod(
      generateFromExpr(receiver, ctx),
      name,
      rest.map(a => generateFromExpr(a, ctx))
    );
  }

  return null;
}

// ============================================================================
// Expression Generation
// ============================================================================

function generateFromExpr(expr: Expr, ctx: ModuleGenContext): JSExpr {
  // Try method optimizations first
  const optimized = tryMethodOptimization(expr, ctx);
  if (optimized) return optimized;

  switch (expr.tag) {
    case "lit":
      return jsLit(expr.value);

    case "var":
      return jsVar(expr.name);

    case "binop": {
      const jsOp = expr.op === "==" ? "===" : expr.op === "!=" ? "!==" : expr.op;
      return jsBinop(jsOp, generateFromExpr(expr.left, ctx), generateFromExpr(expr.right, ctx));
    }

    case "unary":
      return jsUnary(expr.op, generateFromExpr(expr.operand, ctx));

    case "if":
      return jsTernary(
        generateFromExpr(expr.cond, ctx),
        generateFromExpr(expr.then, ctx),
        generateFromExpr(expr.else, ctx)
      );

    case "let":
      return generateLet(expr.name, expr.value, expr.body, ctx);

    case "letPattern":
      return generateLetPattern(expr.pattern, expr.value, expr.body, ctx);

    case "fn":
      return generateFnExpr(expr.params, expr.body, ctx);

    case "recfn":
      return generateRecFnExpr(expr.name, expr.params, expr.body, ctx);

    case "call":
      return jsCall(
        generateFromExpr(expr.func, ctx),
        expr.args.map(a => generateFromExpr(a, ctx))
      );

    case "obj":
      return jsObject(
        expr.fields.map(f => ({
          key: f.name,
          value: generateFromExpr(f.value, ctx)
        }))
      );

    case "field":
      return jsMember(generateFromExpr(expr.object, ctx), expr.name);

    case "array":
      return jsArray(expr.elements.map(e => generateFromExpr(e, ctx)));

    case "index":
      return jsIndex(generateFromExpr(expr.array, ctx), generateFromExpr(expr.index, ctx));

    case "block":
      return generateBlock(expr.exprs, ctx);

    case "comptime":
      return generateFromExpr(expr.expr, ctx);

    case "runtime":
      // runtime annotation - generate variable reference if named
      if (expr.name) {
        return jsVar(expr.name);
      }
      return generateFromExpr(expr.expr, ctx);

    case "assert":
      // For assert(expr, constraint), the constraint was already checked at staging time
      // where possible. The residual just evaluates the expression.
      return generateFromExpr(expr.expr, ctx);

    case "assertCond": {
      // Generate: (() => { if (!cond) { throw new Error(msg); } return true; })()
      const condJs = generateFromExpr(expr.condition, ctx);
      const errorMsg = expr.message ?? "Assertion failed: condition is false";
      return jsIIFE([
        jsIf(
          jsUnary("!", condJs),
          [jsThrow(jsCall(jsVar("Error"), [jsLit(errorMsg)]))]
        ),
        jsReturn(jsLit(true))
      ]);
    }

    case "trust":
      return generateFromExpr(expr.expr, ctx);

    case "methodCall":
      return jsMethod(
        generateFromExpr(expr.receiver, ctx),
        expr.method,
        expr.args.map(a => generateFromExpr(a, ctx))
      );

    case "import":
      // Imports are handled at module level; just generate the body
      return generateFromExpr(expr.body, ctx);

    case "typeOf":
      throw new Error("typeOf cannot appear in residual code");

    case "deferredClosure":
      return generateDeferredClosure(expr.closure, ctx);
  }
}

function generateLet(name: string, value: Expr, body: Expr, ctx: ModuleGenContext): JSExpr {
  // Special handling for deferredClosure with specializations
  // We need to emit the specializations at the same scope level as the body,
  // not inside an IIFE (which would make them inaccessible)
  if (value.tag === "deferredClosure" && value.closure.specializations && value.closure.specializations.size > 0) {
    const stmts: JSStmt[] = [];

    // Generate all specialized versions as const declarations
    for (const specialization of value.closure.specializations.values()) {
      const specializedFn = generateSpecializedClosure(value.closure, specialization, ctx);
      stmts.push(jsConst(specialization.name, specializedFn));
    }

    // Add body
    if (body.tag === "let" || body.tag === "letPattern") {
      stmts.push(...collectLetChainStmtsFromMiddle(body, ctx));
    } else {
      stmts.push(jsReturn(generateFromExpr(body, ctx)));
    }

    return jsIIFE(stmts);
  }

  const valueJs = generateFromExpr(value, ctx);

  if (name === "_") {
    // Discard binding - evaluate for side effect
    const bodyJs = generateFromExpr(body, ctx);
    return jsIIFE([jsExprStmt(valueJs), jsReturn(bodyJs)]);
  }

  // Check for let chain
  if (body.tag === "let" || body.tag === "letPattern") {
    const stmts = [jsConst(name, valueJs), ...collectLetChainStmtsFromMiddle(body, ctx)];
    return jsIIFE(stmts);
  }

  // Single let - use IIFE
  const bodyJs = generateFromExpr(body, ctx);
  return jsIIFE([jsConst(name, valueJs), jsReturn(bodyJs)]);
}

function collectLetChainStmtsFromMiddle(expr: Expr, ctx: ModuleGenContext): JSStmt[] {
  const stmts: JSStmt[] = [];
  let current = expr;

  while (current.tag === "let" || current.tag === "letPattern") {
    if (current.tag === "let") {
      const valueJs = generateFromExpr(current.value, ctx);
      if (current.name === "_") {
        stmts.push(jsExprStmt(valueJs));
      } else {
        stmts.push(jsConst(current.name, valueJs));
      }
      current = current.body;
    } else {
      const valueJs = generateFromExpr(current.value, ctx);
      const pattern = convertPattern(current.pattern);
      stmts.push(jsConstPattern(pattern, valueJs));
      current = current.body;
    }
  }

  stmts.push(jsReturn(generateFromExpr(current, ctx)));
  return stmts;
}

function generateLetPattern(pattern: Pattern, value: Expr, body: Expr, ctx: ModuleGenContext): JSExpr {
  const valueJs = generateFromExpr(value, ctx);
  const patternJs = convertPattern(pattern);

  if (body.tag === "let" || body.tag === "letPattern") {
    const stmts = [jsConstPattern(patternJs, valueJs), ...collectLetChainStmtsFromMiddle(body, ctx)];
    return jsIIFE(stmts);
  }

  const bodyJs = generateFromExpr(body, ctx);
  return jsIIFE([jsConstPattern(patternJs, valueJs), jsReturn(bodyJs)]);
}

function generateFnExpr(params: string[], body: Expr, ctx: ModuleGenContext): JSExpr {
  // Check for args destructuring optimization
  if (params.length === 0) {
    const extracted = extractParamsFromBody(body);
    if (extracted.params.length > 0) {
      return generateFnExpr(extracted.params, extracted.body, ctx);
    }
  }

  if (body.tag === "let" || body.tag === "letPattern") {
    const stmts = collectLetChainStmts(body, ctx);
    return jsArrow(params, stmts);
  }
  return jsArrow(params, generateFromExpr(body, ctx));
}

function generateRecFnExpr(name: string, params: string[], body: Expr, ctx: ModuleGenContext): JSExpr {
  // Check for args destructuring optimization
  if (params.length === 0) {
    const extracted = extractParamsFromBody(body);
    if (extracted.params.length > 0) {
      return generateRecFnExpr(name, extracted.params, extracted.body, ctx);
    }
  }

  if (body.tag === "let" || body.tag === "letPattern") {
    const stmts = collectLetChainStmts(body, ctx);
    return jsNamedFunction(name, params, stmts);
  }
  return jsNamedFunction(name, params, generateFromExpr(body, ctx));
}

/**
 * Generate code for a deferred closure.
 * This stages the function body during code generation, enabling:
 * - Specialization at call sites with Now args
 * - Dead code elimination for uncalled functions
 * - Deferred errors (only surface when function needs to be emitted)
 */
/**
 * Generate a specialized version of a closure for specific argument constraints.
 */
function generateSpecializedClosure(
  sc: StagedClosure,
  specialization: { name: string; argConstraints: Constraint[] },
  ctx: ModuleGenContext
): JSExpr {
  // Extract params from desugared body: let [a, b] = args in body
  const { params: paramNames, body: innerBody } = extractParamsFromBody(sc.body);

  // Set up environment with params using the ACTUAL constraints from call site
  let bodyEnv = sc.env;

  const paramSValues: SValue[] = [];
  for (let i = 0; i < paramNames.length; i++) {
    const paramName = paramNames[i];
    // Use the actual constraint from the call site, not 'any'
    const constraint = specialization.argConstraints[i] ?? anyC;
    const paramSValue = laterRuntime(paramName, constraint);
    paramSValues.push(paramSValue);
    bodyEnv = bodyEnv.set(paramName, { svalue: paramSValue });
  }

  // Create args array binding
  const argsArray = createArraySValue(paramSValues);
  bodyEnv = bodyEnv.set("args", { svalue: argsArray });

  // Add self-reference for recursive functions (use specialized name for self-calls)
  if (sc.name) {
    // Create a modified closure that records specializations on itself
    bodyEnv = bodyEnv.set(sc.name, { svalue: sc });
  }

  // Find free variables in the inner body that aren't bound in the environment
  const boundVars = new Set<string>(["args", ...paramNames]);
  if (sc.name) boundVars.add(sc.name);
  const freeInBody = freeVars(innerBody, boundVars);

  for (const freeVar of freeInBody) {
    if (!bodyEnv.has(freeVar)) {
      bodyEnv = bodyEnv.set(freeVar, { svalue: later(anyC, varRef(freeVar)) });
    }
  }

  // Stage the body with the specialized constraints
  const bodyResult = stagingEvaluate(innerBody, bodyEnv, RefinementContext.empty());
  const residualBody = svalueToResidual(bodyResult.svalue);

  // Generate the function expression (use specialization.name for recursive self-reference)
  if (sc.name) {
    return generateRecFnExpr(specialization.name, paramNames, residualBody, ctx);
  }
  return generateFnExpr(paramNames, residualBody, ctx);
}

function generateDeferredClosure(sc: StagedClosure, ctx: ModuleGenContext): JSExpr {
  // Check if we have specializations to emit
  if (sc.specializations && sc.specializations.size > 0) {
    // Generate all specialized versions in an IIFE
    const stmts: JSStmt[] = [];

    for (const specialization of sc.specializations.values()) {
      const specializedFn = generateSpecializedClosure(sc, specialization, ctx);
      stmts.push(jsConst(specialization.name, specializedFn));
    }

    // Return null since calls use specialized names directly
    stmts.push(jsReturn(jsLit(null)));
    return jsIIFE(stmts);
  }

  // No specializations - generate generic version with Later(any) params
  // Extract params from desugared body: let [a, b] = args in body
  const { params: paramNames, body: innerBody } = extractParamsFromBody(sc.body);

  // Set up environment with params as Later
  let bodyEnv = sc.env;

  const paramSValues: SValue[] = [];
  for (const paramName of paramNames) {
    const paramSValue = laterRuntime(paramName, anyC);
    paramSValues.push(paramSValue);
    bodyEnv = bodyEnv.set(paramName, { svalue: paramSValue });
  }

  // Create args array binding
  const argsArray = createArraySValue(paramSValues);
  bodyEnv = bodyEnv.set("args", { svalue: argsArray });

  // Add self-reference for recursive functions
  if (sc.name) {
    bodyEnv = bodyEnv.set(sc.name, { svalue: sc });
  }

  // Find free variables in the inner body that aren't bound in the environment
  // These are external references (globals, imports, etc.) - treat as Later
  const boundVars = new Set<string>(["args", ...paramNames]);
  if (sc.name) boundVars.add(sc.name);
  const freeInBody = freeVars(innerBody, boundVars);

  for (const freeVar of freeInBody) {
    if (!bodyEnv.has(freeVar)) {
      // External reference - bind as Later
      bodyEnv = bodyEnv.set(freeVar, { svalue: later(anyC, varRef(freeVar)) });
    }
  }

  // Stage the body NOW (during codegen)
  const bodyResult = stagingEvaluate(innerBody, bodyEnv, RefinementContext.empty());
  const residualBody = svalueToResidual(bodyResult.svalue);

  // Generate the function expression
  if (sc.name) {
    return generateRecFnExpr(sc.name, paramNames, residualBody, ctx);
  }
  return generateFnExpr(paramNames, residualBody, ctx);
}

function generateBlock(exprs: Expr[], ctx: ModuleGenContext): JSExpr {
  if (exprs.length === 0) {
    return jsLit(null);
  }
  if (exprs.length === 1) {
    return generateFromExpr(exprs[0], ctx);
  }

  const stmts: JSStmt[] = exprs.slice(0, -1).map(e => jsExprStmt(generateFromExpr(e, ctx)));
  stmts.push(jsReturn(generateFromExpr(exprs[exprs.length - 1], ctx)));
  return jsIIFE(stmts);
}

function convertPattern(pattern: Pattern): import("./js-ast").JSPattern {
  switch (pattern.tag) {
    case "varPattern":
      return jsVarPattern(pattern.name);
    case "arrayPattern":
      return jsArrayPattern(pattern.elements.map(convertPattern));
    case "objectPattern":
      return jsObjectPattern(
        pattern.fields.map(f => ({ key: f.key, pattern: convertPattern(f.pattern) }))
      );
  }
}
