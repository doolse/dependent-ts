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
  collectByOrigin, collectClosures, laterRuntime, later, now
} from "./svalue";
import { numberVal, stringVal, boolVal, nullVal, constraintOf } from "./value";
import { closureToResidual, stagingEvaluate, svalueToResidual, createArraySValue, freeVars } from "./staged-evaluate";
import { Value } from "./value";
import { Expr, Pattern, varRef, exprToString } from "./expr";
import { RefinementContext } from "./env";
import { Constraint, and as andC, isFunction } from "./constraint";
import {
  clusterByJS,
  ClusterableSpec,
  JSCluster,
  applyTemplate,
  getParameterValues,
} from "./js-clustering";
const anyC = { tag: "any" } as const;

// ============================================================================
// Generator Context
// ============================================================================

interface ImportInfo {
  modulePath: string;
  bindings: Set<string>;
  defaultBinding?: string;
}

/**
 * Information about a specialized function body.
 */
interface SpecializationInfo {
  closure: StagedClosure;
  bodyKey: string;      // exprToString(body) for deduplication
  body: Expr;
  args: Expr[];         // Argument expressions from the call
  isSelfCall: boolean;  // True if this is a self-recursive call marker
}

/**
 * Information about extra arguments needed for JS-clustered specializations.
 * When multiple specializations are merged via JS clustering, call sites need
 * to pass the varying literal values as extra arguments.
 */
interface ClusterCallInfo {
  functionName: string;
  extraArgs: JSExpr[];  // The hole values to pass as extra arguments
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

  // Specialization name mapping: closure -> bodyKey -> functionName
  specializationNames: Map<StagedClosure, Map<string, string>>;

  // JS clustering info: closure -> bodyKey -> ClusterCallInfo
  // Used when generating calls to clustered functions
  clusterCallInfo: Map<StagedClosure, Map<string, ClusterCallInfo>>;
}

function createContext(): ModuleGenContext {
  return {
    namedClosures: new Map(),
    generatedClosures: new Set(),
    closureDeps: new Map(),
    imports: new Map(),
    runtimeParams: new Map(),
    specializationNames: new Map(),
    clusterCallInfo: new Map(),
  };
}

// ============================================================================
// Two-Pass Specialization Collection and Naming
// ============================================================================

/**
 * Collect all specializedCall nodes from an expression tree.
 * Groups them by closure identity for deduplication.
 */
function collectSpecializations(expr: Expr): Map<StagedClosure, SpecializationInfo[]> {
  const result = new Map<StagedClosure, SpecializationInfo[]>();

  function walk(e: Expr): void {
    switch (e.tag) {
      case "specializedCall": {
        const bodyKey = exprToString(e.body);
        const existing = result.get(e.closure) ?? [];
        // Check if this is a self-recursive call marker (body === closure.body)
        const isSelfCall = e.body === e.closure.body;
        // Only add if this body isn't already collected (dedupe by bodyKey)
        if (!existing.some(s => s.bodyKey === bodyKey)) {
          existing.push({ closure: e.closure, bodyKey, body: e.body, args: e.args, isSelfCall });
          result.set(e.closure, existing);
        }
        // Walk the args
        for (const arg of e.args) {
          walk(arg);
        }
        // If not a self-call marker, also walk the body for nested specializations
        if (!isSelfCall) {
          walk(e.body);
        }
        break;
      }
      case "lit":
      case "var":
      case "runtime":
        break;
      case "binop":
        walk(e.left);
        walk(e.right);
        break;
      case "unary":
        walk(e.operand);
        break;
      case "if":
        walk(e.cond);
        walk(e.then);
        walk(e.else);
        break;
      case "let":
        walk(e.value);
        walk(e.body);
        break;
      case "letPattern":
        walk(e.value);
        walk(e.body);
        break;
      case "fn":
        walk(e.body);
        break;
      case "recfn":
        walk(e.body);
        break;
      case "call":
        walk(e.func);
        for (const arg of e.args) {
          walk(arg);
        }
        break;
      case "obj":
        for (const field of e.fields) {
          walk(field.value);
        }
        break;
      case "field":
        walk(e.object);
        break;
      case "array":
        for (const elem of e.elements) {
          walk(elem);
        }
        break;
      case "index":
        walk(e.array);
        walk(e.index);
        break;
      case "block":
        for (const expr of e.exprs) {
          walk(expr);
        }
        break;
      case "comptime":
        walk(e.expr);
        break;
      case "assert":
        walk(e.expr);
        walk(e.constraint);
        break;
      case "assertCond":
        walk(e.condition);
        break;
      case "trust":
        walk(e.expr);
        if (e.constraint) walk(e.constraint);
        break;
      case "methodCall":
        walk(e.receiver);
        for (const arg of e.args) {
          walk(arg);
        }
        break;
      case "import":
        walk(e.body);
        break;
      case "typeOf":
        walk(e.expr);
        break;
      case "deferredClosure":
        // Don't recurse into deferred closures - they're staged separately
        break;
    }
  }

  walk(expr);
  return result;
}

/**
 * Assign function names to specializations.
 * If there's only one unique body, use the base name.
 * If there are multiple, use suffixed names.
 * @param specs - Map of closures to their specialization info
 * @param baseNameOverride - Optional override for the base name (e.g., let binding name)
 * Returns: closure -> bodyKey -> functionName
 */
function assignSpecializationNames(
  specs: Map<StagedClosure, SpecializationInfo[]>,
  baseNameOverride?: string
): Map<StagedClosure, Map<string, string>> {
  const result = new Map<StagedClosure, Map<string, string>>();

  for (const [closure, bodies] of specs) {
    // Use override if provided, otherwise use closure's name or "fn"
    const baseName = baseNameOverride ?? closure.name ?? "fn";
    const nameMap = new Map<string, string>();

    // Filter out self-call markers - they use the same name as the real body
    const realBodies = bodies.filter(b => !b.isSelfCall);

    if (realBodies.length === 0) {
      // Only self-calls, no real bodies - shouldn't happen, but handle it
      // All calls will use the base name
      for (const body of bodies) {
        nameMap.set(body.bodyKey, baseName);
      }
    } else if (realBodies.length === 1) {
      // Single version - use base name for all (including self-calls)
      const fnName = baseName;
      for (const body of bodies) {
        nameMap.set(body.bodyKey, fnName);
      }
    } else {
      // Multiple versions - use suffixed names
      realBodies.forEach((spec, i) => {
        nameMap.set(spec.bodyKey, `${baseName}$${i}`);
      });
      // Self-calls get assigned to the first real body's name
      // (they should match one of the real bodies in practice)
      for (const body of bodies) {
        if (body.isSelfCall && !nameMap.has(body.bodyKey)) {
          // Self-call that doesn't match any real body - use base name
          nameMap.set(body.bodyKey, baseName);
        }
      }
    }

    result.set(closure, nameMap);
  }

  return result;
}

/**
 * Collect specializations from an expression and populate the context.
 * Used when generating let bindings that contain deferred closures.
 */
function prepareSpecializationsForExpr(expr: Expr, ctx: ModuleGenContext): void {
  const specs = collectSpecializations(expr);
  const names = assignSpecializationNames(specs);

  // Merge into context
  for (const [closure, nameMap] of names) {
    const existing = ctx.specializationNames.get(closure);
    if (existing) {
      for (const [bodyKey, name] of nameMap) {
        existing.set(bodyKey, name);
      }
    } else {
      ctx.specializationNames.set(closure, nameMap);
    }
  }
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
  // Also handle specialized body: `let [x, y] = [arg1, arg2] in body`
  // This pattern appears when a specializedCall body has args baked in
  if (body.tag === "letPattern" && body.value.tag === "array") {
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
  let currentCtx = ctx;

  while (current.tag === "let" || current.tag === "letPattern") {
    if (current.tag === "let") {
      // Check for deferredClosure - needs special handling
      if (current.value.tag === "deferredClosure") {
        const deferredStmts = generateDeferredClosureBinding(
          current.name,
          current.value.closure,
          current.body,
          currentCtx
        );
        stmts.push(...deferredStmts.functionStmts);
        currentCtx = deferredStmts.ctx;
        current = current.body;
      } else {
        const valueJs = generateFromExpr(current.value, currentCtx);
        if (current.name === "_") {
          stmts.push(jsExprStmt(valueJs));
        } else {
          stmts.push(jsConst(current.name, valueJs));
        }
        current = current.body;
      }
    } else {
      const valueJs = generateFromExpr(current.value, currentCtx);
      const pattern = convertPattern(current.pattern);
      stmts.push(jsConstPattern(pattern, valueJs));
      current = current.body;
    }
  }

  stmts.push(jsReturn(generateFromExpr(current, currentCtx)));
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

    case "specializedCall": {
      // Look up the assigned name for this specialization
      const bodyKey = exprToString(expr.body);

      // Check for JS-clustered function (has extra args from hole values)
      const clusterInfo = ctx.clusterCallInfo.get(expr.closure)?.get(bodyKey);
      if (clusterInfo) {
        // Clustered function: pass extra args (hole values) before regular args
        const regularArgs = expr.args.map(a => generateFromExpr(a, ctx));
        return jsCall(jsVar(clusterInfo.functionName), [...clusterInfo.extraArgs, ...regularArgs]);
      }

      const nameMap = ctx.specializationNames.get(expr.closure);
      const name = nameMap?.get(bodyKey);

      if (name) {
        // Found a pre-generated function name
        return jsCall(jsVar(name), expr.args.map(a => generateFromExpr(a, ctx)));
      }

      if (expr.closure.name) {
        // Named recursive function
        return jsCall(jsVar(expr.closure.name), expr.args.map(a => generateFromExpr(a, ctx)));
      }

      // Check for closure with a residual (bound via let or returned from curried function)
      // e.g., let isEmpty = fn(s) => ... creates a closure with residual: varRef("isEmpty")
      // e.g., minLength(8) returns a closure with residual: call(varRef("minLength"), lit(8))
      if (expr.closure.residual) {
        // Generate the function expression from the residual, then call it with args
        const funcExpr = generateFromExpr(expr.closure.residual, ctx);
        return jsCall(funcExpr, expr.args.map(a => generateFromExpr(a, ctx)));
      }

      // Truly anonymous closure with no residual
      // The body already contains the specialized code with args bound.
      // Just generate the body directly.
      return generateFromExpr(expr.body, ctx);
    }
  }
}

/**
 * Extract a Now SValue from a literal expression.
 * Returns undefined if the expression is not a literal.
 */
function exprToNowValue(expr: Expr): Now | undefined {
  if (expr.tag !== "lit") return undefined;
  const v = expr.value;
  if (typeof v === "number") {
    const val = numberVal(v);
    return now(val, constraintOf(val));
  }
  if (typeof v === "string") {
    const val = stringVal(v);
    return now(val, constraintOf(val));
  }
  if (typeof v === "boolean") {
    const val = boolVal(v);
    return now(val, constraintOf(val));
  }
  if (v === null) {
    return now(nullVal, { tag: "isNull" });
  }
  return undefined;
}

/**
 * Generate statements for a deferred closure binding.
 *
 * Uses comptimeParams to determine specialization strategy:
 * - If comptimeParams is empty: generate a generic function with all params as Later
 * - If comptimeParams has values: specialize on those params, keep others as Later
 *
 * This ensures that only explicitly comptime-required params get baked in,
 * while other params remain as proper runtime parameters.
 */
function generateDeferredClosureBinding(
  name: string,
  closure: StagedClosure,
  body: Expr,
  ctx: ModuleGenContext
): { functionStmts: JSStmt[]; ctx: ModuleGenContext } {
  const stmts: JSStmt[] = [];

  // Get params from the original closure body
  const { params: paramNames, body: innerBody } = extractParamsFromBody(closure.body);

  // If no comptimeParams, generate a fully generic function
  if (!closure.comptimeParams || closure.comptimeParams.size === 0) {
    stmts.push(jsConst(name, generateDeferredClosure(closure, ctx)));

    // Still need to map any specializedCall nodes to the let binding name
    // so that calls use `findMax` instead of the inner recursive name `maxRec`
    const specs = collectSpecializations(body);
    const closureSpecs = specs.get(closure);
    if (closureSpecs && closureSpecs.length > 0) {
      const nameMap = new Map<string, string>();
      for (const spec of closureSpecs) {
        nameMap.set(spec.bodyKey, name);
      }
      const newCtx = {
        ...ctx,
        specializationNames: new Map([...ctx.specializationNames, [closure, nameMap]])
      };
      return { functionStmts: stmts, ctx: newCtx };
    }

    return { functionStmts: stmts, ctx };
  }

  // Collect specializedCall nodes to find call sites with comptime arg values
  const specs = collectSpecializations(body);
  const closureSpecs = specs.get(closure);

  if (!closureSpecs || closureSpecs.length === 0) {
    // No calls found - generate generic version
    stmts.push(jsConst(name, generateDeferredClosure(closure, ctx)));
    return { functionStmts: stmts, ctx };
  }

  // Filter to real calls (not self-call markers)
  const realSpecs = closureSpecs.filter(s => !s.isSelfCall);

  if (realSpecs.length === 0) {
    stmts.push(jsConst(name, generateDeferredClosure(closure, ctx)));
    return { functionStmts: stmts, ctx };
  }

  // Build param index map
  const paramIndex = new Map<string, number>();
  paramNames.forEach((p, i) => paramIndex.set(p, i));

  // Group calls by unique specialized bodies
  // For typeOf-based specialization, args may not be literals but bodies are unique
  // For comptime-based specialization, we can also extract literal args for re-staging
  // Key: bodyKey (unique body string), Value: { comptimeArgs?: Map<paramName, Now>, specs: SpecializationInfo[], body: Expr }
  const groups = new Map<string, { comptimeArgs: Map<string, Now> | null; specs: SpecializationInfo[]; body: Expr }>();

  for (const spec of realSpecs) {
    // Try to extract comptime arg values from this call (for re-staging approach)
    const comptimeArgs = new Map<string, Now>();
    let hasAllLiteralArgs = true;

    for (const paramName of closure.comptimeParams) {
      const idx = paramIndex.get(paramName);
      if (idx === undefined || idx >= spec.args.length) {
        hasAllLiteralArgs = false;
        break;
      }
      const argExpr = spec.args[idx];
      const nowVal = exprToNowValue(argExpr);
      if (!nowVal) {
        // Arg is not a literal - can't use re-staging approach
        hasAllLiteralArgs = false;
        break;
      }
      comptimeArgs.set(paramName, nowVal);
    }

    // Group by bodyKey - this handles both literal args and constraint-based specialization
    const key = spec.bodyKey;

    if (!groups.has(key)) {
      groups.set(key, {
        comptimeArgs: hasAllLiteralArgs ? comptimeArgs : null,
        specs: [],
        body: spec.body  // Use the already-specialized body
      });
    }
    groups.get(key)!.specs.push(spec);
  }

  if (groups.size === 0) {
    // No valid specializations - generate generic
    stmts.push(jsConst(name, generateDeferredClosure(closure, ctx)));
    return { functionStmts: stmts, ctx };
  }

  // ============================================================================
  // JS Clustering: Generate JS for each group and cluster by structure
  // ============================================================================

  // First, generate residual bodies and JS for each group
  interface GroupWithJS {
    bodyKey: string;
    comptimeArgs: Map<string, Now> | null;
    specs: SpecializationInfo[];
    body: Expr;
    residualBody: Expr;
    jsBody: JSExpr;
  }

  const groupsWithJS: GroupWithJS[] = [];

  for (const [bodyKey, group] of groups) {
    let residualBody: Expr;

    if (group.comptimeArgs) {
      // We have literal comptime args - use re-staging approach for cleaner output
      let bodyEnv = closure.env;
      const paramSValues: SValue[] = [];

      for (const paramName of paramNames) {
        if (closure.comptimeParams!.has(paramName)) {
          // Comptime param - bind to its Now value
          const nowVal = group.comptimeArgs.get(paramName)!;
          paramSValues.push(nowVal);
          bodyEnv = bodyEnv.set(paramName, { svalue: nowVal });
        } else {
          // Runtime param - bind as Later
          const laterVal = laterRuntime(paramName, anyC);
          paramSValues.push(laterVal);
          bodyEnv = bodyEnv.set(paramName, { svalue: laterVal });
        }
      }

      // Bind args array
      const argsArray = createArraySValue(paramSValues);
      bodyEnv = bodyEnv.set("args", { svalue: argsArray });

      // Add self-reference for recursive functions
      if (closure.name) {
        bodyEnv = bodyEnv.set(closure.name, { svalue: closure });
      }

      // Find and bind free variables as Later
      const boundVars = new Set<string>(["args", ...paramNames]);
      if (closure.name) boundVars.add(closure.name);
      const freeInBody = freeVars(innerBody, boundVars);

      for (const freeVar of freeInBody) {
        if (!bodyEnv.has(freeVar)) {
          bodyEnv = bodyEnv.set(freeVar, { svalue: later(anyC, varRef(freeVar)) });
        }
      }

      // Stage the body with this environment
      const bodyResult = stagingEvaluate(innerBody, bodyEnv, RefinementContext.empty());
      residualBody = svalueToResidual(bodyResult.svalue);
    } else {
      // No literal comptime args (e.g., typeOf-based specialization)
      // Use the already-specialized body from the specializedCall node
      residualBody = extractBodyWithoutParamBinding(group.body, paramNames);
    }

    // Generate JS for this residual body
    const jsBody = generateFromExpr(residualBody, ctx);

    groupsWithJS.push({
      bodyKey,
      comptimeArgs: group.comptimeArgs,
      specs: group.specs,
      body: group.body,
      residualBody,
      jsBody,
    });
  }

  // Cluster by JS structure
  const clusterableSpecs: ClusterableSpec<string>[] = groupsWithJS.map(g => ({
    id: g.bodyKey,
    jsExpr: g.jsBody,
    argValues: [], // We'll use the group data for values
  }));

  const jsClusters = clusterByJS(clusterableSpecs);

  // Set up name mapping and cluster call info
  const nameMap = new Map<string, string>();
  const clusterCallInfoMap = new Map<string, ClusterCallInfo>();

  // Assign function names to clusters
  let fnIndex = 0;
  const clusterNames: string[] = [];
  if (jsClusters.length === 1 && jsClusters[0].members.length === groupsWithJS.length) {
    // All groups merged into one cluster - use base name
    clusterNames.push(name);
  } else {
    for (const cluster of jsClusters) {
      if (cluster.members.length === 1) {
        // Single-member cluster - use indexed name if there are multiple clusters
        clusterNames.push(jsClusters.length > 1 ? `${name}$${fnIndex++}` : name);
      } else {
        // Multi-member cluster - use indexed name
        clusterNames.push(jsClusters.length > 1 || fnIndex > 0 ? `${name}$${fnIndex++}` : name);
      }
    }
  }

  // Process each JS cluster
  jsClusters.forEach((cluster, clusterIdx) => {
    const fnName = clusterNames[clusterIdx];

    if (cluster.members.length === 1) {
      // Single-member cluster: generate function as before
      const bodyKey = cluster.members[0].id;
      const groupData = groupsWithJS.find(g => g.bodyKey === bodyKey)!;

      // Map all specs in this group to the function name
      for (const spec of groupData.specs) {
        nameMap.set(spec.bodyKey, fnName);
      }

      // Handle self-recursive calls
      const specsInBody = collectSpecializations(groupData.residualBody);
      const selfSpecs = specsInBody.get(closure);
      if (selfSpecs) {
        for (const s of selfSpecs) {
          nameMap.set(s.bodyKey, fnName);
        }
      }

      // Generate the function
      if (closure.name) {
        stmts.push(jsConst(fnName, generateRecFnExpr(fnName, paramNames, groupData.residualBody, ctx)));
      } else {
        stmts.push(jsConst(fnName, generateFnExpr(paramNames, groupData.residualBody, ctx)));
      }
    } else {
      // Multi-member cluster: generate parameterized function
      // The template has holes that need to become parameters

      // Generate parameter names for the holes
      const holeParamNames: string[] = [];
      for (let i = 0; i < cluster.parameterCount; i++) {
        holeParamNames.push(`_p${i}`);
      }

      // Apply template to get the parameterized body
      const representativeBodyKey = cluster.members[0].id;
      const representativeGroup = groupsWithJS.find(g => g.bodyKey === representativeBodyKey)!;
      const templateBody = applyTemplate(
        representativeGroup.jsBody,
        cluster.template.holes,
        cluster.parameterMapping,
        holeParamNames
      );

      // For each member, compute the hole values and store cluster call info
      for (const member of cluster.members) {
        const groupData = groupsWithJS.find(g => g.bodyKey === member.id)!;

        // Get the parameter values for this member
        const paramValues = getParameterValues(member, cluster);

        // Store cluster call info for each spec
        for (const spec of groupData.specs) {
          nameMap.set(spec.bodyKey, fnName);
          clusterCallInfoMap.set(spec.bodyKey, {
            functionName: fnName,
            extraArgs: paramValues.map(v => jsLit(v)),
          });
        }
      }

      // Generate the parameterized function
      // Function signature: (holeParams..., originalParams...) => body
      const allParams = [...holeParamNames, ...paramNames];

      if (closure.name) {
        stmts.push(jsConst(fnName, jsNamedFunction(fnName, allParams, templateBody)));
      } else {
        stmts.push(jsConst(fnName, jsArrow(allParams, templateBody)));
      }
    }
  });

  // Also map self-call markers
  for (const spec of closureSpecs) {
    if (spec.isSelfCall && !nameMap.has(spec.bodyKey)) {
      nameMap.set(spec.bodyKey, name);
    }
  }

  const newCtx = {
    ...ctx,
    specializationNames: new Map([...ctx.specializationNames, [closure, nameMap]]),
    clusterCallInfo: new Map([...ctx.clusterCallInfo, [closure, clusterCallInfoMap]]),
  };

  return { functionStmts: stmts, ctx: newCtx };
}

/**
 * Extract the actual function body from a specialized call body.
 * The body has the form: let [param1, param2, ...] = [arg1, arg2, ...] in actualBody
 * We strip the outer let binding to get just the specialized actualBody.
 */
function extractBodyWithoutParamBinding(body: Expr, paramNames: string[]): Expr {
  if (body.tag === "letPattern") {
    // Expected form: let [x, y, ...] = [a, b, ...] in actualBody
    const pattern = body.pattern;
    if (pattern.tag === "arrayPattern") {
      // Verify pattern matches expected params
      const patternVars = pattern.elements
        .filter(e => e.tag === "varPattern")
        .map(e => (e as { tag: "varPattern"; name: string }).name);

      // If pattern matches our params, extract the inner body
      if (patternVars.length === paramNames.length &&
          patternVars.every((v, i) => v === paramNames[i])) {
        return body.body;
      }
    }
  }
  // If we can't extract, return the body as-is
  return body;
}

function generateLet(name: string, value: Expr, body: Expr, ctx: ModuleGenContext): JSExpr {
  // Special handling for deferredClosure: use two-pass specialization
  // Collect all specializedCall nodes from the body, dedupe, assign names, emit functions
  if (value.tag === "deferredClosure") {
    const result = generateDeferredClosureBinding(name, value.closure, body, ctx);

    // Phase 4: Generate body with updated context
    const stmts = [...result.functionStmts];
    if (body.tag === "let" || body.tag === "letPattern") {
      stmts.push(...collectLetChainStmtsFromMiddle(body, result.ctx));
    } else {
      stmts.push(jsReturn(generateFromExpr(body, result.ctx)));
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
  let currentCtx = ctx;

  while (current.tag === "let" || current.tag === "letPattern") {
    if (current.tag === "let") {
      // Check for deferredClosure - needs special handling
      if (current.value.tag === "deferredClosure") {
        const deferredStmts = generateDeferredClosureBinding(
          current.name,
          current.value.closure,
          current.body,
          currentCtx
        );
        stmts.push(...deferredStmts.functionStmts);
        currentCtx = deferredStmts.ctx;
        current = current.body;
      } else {
        const valueJs = generateFromExpr(current.value, currentCtx);
        if (current.name === "_") {
          stmts.push(jsExprStmt(valueJs));
        } else {
          stmts.push(jsConst(current.name, valueJs));
        }
        current = current.body;
      }
    } else {
      const valueJs = generateFromExpr(current.value, currentCtx);
      const pattern = convertPattern(current.pattern);
      stmts.push(jsConstPattern(pattern, valueJs));
      current = current.body;
    }
  }

  stmts.push(jsReturn(generateFromExpr(current, currentCtx)));
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
function generateDeferredClosure(sc: StagedClosure, ctx: ModuleGenContext): JSExpr {
  // Generate generic version with Later(any) params
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
