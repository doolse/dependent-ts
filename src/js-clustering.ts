/**
 * JS-based Specialization Clustering
 *
 * This module implements deduplication of specialized functions by comparing
 * their generated JavaScript structure. Two specializations can be merged if
 * they produce identical JS except for literal values at certain positions.
 *
 * Key insight: We compare actual JS output rather than source AST, because
 * JavaScript has no types at runtime. So `identity(42)` and `identity("hello")`
 * produce structurally identical JS and can share one implementation.
 */

import { JSExpr, JSStmt } from "./js-ast";

// ============================================================================
// Types
// ============================================================================

/**
 * A path into a JS AST, used to identify positions where values differ.
 * Each element is either a property name or array index.
 */
export type JSPath = (string | number)[];

/**
 * Represents a "hole" in a JS template - a position where a literal varies
 * across different specializations.
 */
export interface JSHole {
  path: JSPath;
  values: (number | string | boolean | null)[];  // One per specialization in cluster
}

/**
 * A JS template is a structural signature (for grouping) plus the positions
 * where literals vary (holes).
 */
export interface JSTemplate {
  signature: string;  // Structural hash/signature for quick comparison
  holes: JSPath[];    // Positions of varying literals
}

/**
 * Information about a specialization for clustering purposes.
 */
export interface ClusterableSpec<T> {
  id: T;                    // Original identifier (e.g., bodyKey or index)
  jsExpr: JSExpr;           // Generated JS expression
  argValues: (number | string | boolean | null)[];  // Literal arg values (for correlation)
}

/**
 * A cluster of alpha-equivalent specializations.
 */
export interface JSCluster<T> {
  members: ClusterableSpec<T>[];
  template: JSTemplate;
  // Parameter mapping: which holes share the same parameter
  // Array index = hole index, value = parameter index
  parameterMapping: number[];
  parameterCount: number;
}

// ============================================================================
// JS AST Structural Comparison
// ============================================================================

/**
 * Result of comparing two JS expressions.
 * null = structural mismatch (can't merge)
 * JSPath[] = paths where literals differ (can merge)
 */
type CompareResult = JSPath[] | null;

/**
 * Compare two JS expressions structurally.
 * Returns the paths where they differ (only at literal positions),
 * or null if they have structural differences.
 */
export function compareJSExprs(a: JSExpr, b: JSExpr, path: JSPath = []): CompareResult {
  // Different node types = structural mismatch
  if (a.tag !== b.tag) return null;

  switch (a.tag) {
    case "jsLit": {
      const bLit = b as typeof a;
      // Same literal value = no diff
      if (a.value === bLit.value) return [];
      // Different literal values = varying position (this is allowed)
      return [path];
    }

    case "jsVar": {
      const bVar = b as typeof a;
      // Variable names must match (structural)
      if (a.name !== bVar.name) return null;
      return [];
    }

    case "jsBinop": {
      const bBinop = b as typeof a;
      // Operator must match
      if (a.op !== bBinop.op) return null;
      return mergeResults(
        compareJSExprs(a.left, bBinop.left, [...path, "left"]),
        compareJSExprs(a.right, bBinop.right, [...path, "right"])
      );
    }

    case "jsUnary": {
      const bUnary = b as typeof a;
      if (a.op !== bUnary.op) return null;
      return compareJSExprs(a.operand, bUnary.operand, [...path, "operand"]);
    }

    case "jsCall": {
      const bCall = b as typeof a;
      if (a.args.length !== bCall.args.length) return null;
      let result = compareJSExprs(a.func, bCall.func, [...path, "func"]);
      for (let i = 0; i < a.args.length && result !== null; i++) {
        result = mergeResults(result, compareJSExprs(a.args[i], bCall.args[i], [...path, "args", i]));
      }
      return result;
    }

    case "jsMethod": {
      const bMethod = b as typeof a;
      if (a.method !== bMethod.method) return null;
      if (a.args.length !== bMethod.args.length) return null;
      let result = compareJSExprs(a.obj, bMethod.obj, [...path, "obj"]);
      for (let i = 0; i < a.args.length && result !== null; i++) {
        result = mergeResults(result, compareJSExprs(a.args[i], bMethod.args[i], [...path, "args", i]));
      }
      return result;
    }

    case "jsArrow": {
      const bArrow = b as typeof a;
      // Params must match structurally
      if (a.params.length !== bArrow.params.length) return null;
      for (let i = 0; i < a.params.length; i++) {
        if (a.params[i] !== bArrow.params[i]) return null;
      }
      return compareJSBodies(a.body, bArrow.body, [...path, "body"]);
    }

    case "jsNamedFunction": {
      const bNamed = b as typeof a;
      // Name and params must match structurally
      if (a.name !== bNamed.name) return null;
      if (a.params.length !== bNamed.params.length) return null;
      for (let i = 0; i < a.params.length; i++) {
        if (a.params[i] !== bNamed.params[i]) return null;
      }
      return compareJSBodies(a.body, bNamed.body, [...path, "body"]);
    }

    case "jsTernary": {
      const bTernary = b as typeof a;
      return mergeResults(
        compareJSExprs(a.cond, bTernary.cond, [...path, "cond"]),
        mergeResults(
          compareJSExprs(a.then, bTernary.then, [...path, "then"]),
          compareJSExprs(a.else, bTernary.else, [...path, "else"])
        )
      );
    }

    case "jsMember": {
      const bMember = b as typeof a;
      if (a.prop !== bMember.prop) return null;
      return compareJSExprs(a.obj, bMember.obj, [...path, "obj"]);
    }

    case "jsIndex": {
      const bIndex = b as typeof a;
      return mergeResults(
        compareJSExprs(a.arr, bIndex.arr, [...path, "arr"]),
        compareJSExprs(a.idx, bIndex.idx, [...path, "idx"])
      );
    }

    case "jsObject": {
      const bObj = b as typeof a;
      if (a.fields.length !== bObj.fields.length) return null;
      let result: CompareResult = [];
      for (let i = 0; i < a.fields.length && result !== null; i++) {
        // Field keys must match structurally
        if (a.fields[i].key !== bObj.fields[i].key) return null;
        result = mergeResults(
          result,
          compareJSExprs(a.fields[i].value, bObj.fields[i].value, [...path, "fields", i, "value"])
        );
      }
      return result;
    }

    case "jsArray": {
      const bArr = b as typeof a;
      if (a.elements.length !== bArr.elements.length) return null;
      let result: CompareResult = [];
      for (let i = 0; i < a.elements.length && result !== null; i++) {
        result = mergeResults(result, compareJSExprs(a.elements[i], bArr.elements[i], [...path, "elements", i]));
      }
      return result;
    }

    case "jsIIFE": {
      const bIIFE = b as typeof a;
      return compareJSStmtArrays(a.body, bIIFE.body, [...path, "body"]);
    }
  }
}

/**
 * Compare JS statement arrays.
 */
function compareJSStmtArrays(a: JSStmt[], b: JSStmt[], path: JSPath): CompareResult {
  if (a.length !== b.length) return null;
  let result: CompareResult = [];
  for (let i = 0; i < a.length && result !== null; i++) {
    result = mergeResults(result, compareJSStmts(a[i], b[i], [...path, i]));
  }
  return result;
}

/**
 * Compare two JS statements.
 */
function compareJSStmts(a: JSStmt, b: JSStmt, path: JSPath): CompareResult {
  if (a.tag !== b.tag) return null;

  switch (a.tag) {
    case "jsConst": {
      const bConst = b as typeof a;
      if (a.name !== bConst.name) return null;
      return compareJSExprs(a.value, bConst.value, [...path, "value"]);
    }

    case "jsLet": {
      const bLet = b as typeof a;
      if (a.name !== bLet.name) return null;
      return compareJSExprs(a.value, bLet.value, [...path, "value"]);
    }

    case "jsReturn": {
      const bReturn = b as typeof a;
      return compareJSExprs(a.value, bReturn.value, [...path, "value"]);
    }

    case "jsIf": {
      const bIf = b as typeof a;
      let result = compareJSExprs(a.cond, bIf.cond, [...path, "cond"]);
      result = mergeResults(result, compareJSStmtArrays(a.then, bIf.then, [...path, "then"]));
      if (a.else && bIf.else) {
        result = mergeResults(result, compareJSStmtArrays(a.else, bIf.else, [...path, "else"]));
      } else if (a.else || bIf.else) {
        return null; // One has else, other doesn't
      }
      return result;
    }

    case "jsForOf": {
      const bFor = b as typeof a;
      if (a.item !== bFor.item) return null;
      let result = compareJSExprs(a.iter, bFor.iter, [...path, "iter"]);
      result = mergeResults(result, compareJSStmtArrays(a.body, bFor.body, [...path, "body"]));
      return result;
    }

    case "jsExpr": {
      const bExpr = b as typeof a;
      return compareJSExprs(a.expr, bExpr.expr, [...path, "expr"]);
    }

    case "jsConstPattern": {
      const bPattern = b as typeof a;
      // Pattern structure must match
      if (!patternsEqual(a.pattern, bPattern.pattern)) return null;
      return compareJSExprs(a.value, bPattern.value, [...path, "value"]);
    }

    case "jsThrow": {
      const bThrow = b as typeof a;
      return compareJSExprs(a.value, bThrow.value, [...path, "value"]);
    }

    case "jsContinue":
    case "jsBreak":
      return [];
  }
}

/**
 * Compare function bodies (can be expr or stmt array).
 */
function compareJSBodies(
  a: JSExpr | JSStmt[],
  b: JSExpr | JSStmt[],
  path: JSPath
): CompareResult {
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return null;
  if (aIsArray && bIsArray) {
    return compareJSStmtArrays(a as JSStmt[], b as JSStmt[], path);
  }
  return compareJSExprs(a as JSExpr, b as JSExpr, path);
}

/**
 * Check if two JS patterns are structurally equal.
 */
function patternsEqual(a: import("./js-ast").JSPattern, b: import("./js-ast").JSPattern): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case "jsVarPattern":
      return a.name === (b as typeof a).name;
    case "jsArrayPattern": {
      const bArr = b as typeof a;
      if (a.elements.length !== bArr.elements.length) return false;
      return a.elements.every((e, i) => patternsEqual(e, bArr.elements[i]));
    }
    case "jsObjectPattern": {
      const bObj = b as typeof a;
      if (a.fields.length !== bObj.fields.length) return false;
      return a.fields.every((f, i) =>
        f.key === bObj.fields[i].key && patternsEqual(f.pattern, bObj.fields[i].pattern)
      );
    }
  }
}

/**
 * Merge two comparison results.
 */
function mergeResults(a: CompareResult, b: CompareResult): CompareResult {
  if (a === null || b === null) return null;
  return [...a, ...b];
}

// ============================================================================
// Template Generation
// ============================================================================

/**
 * Generate a structural signature for a JS expression.
 * This ignores literal values but preserves all structural information.
 */
export function jsExprSignature(expr: JSExpr): string {
  switch (expr.tag) {
    case "jsLit":
      // All literals have the same signature - they're potential holes
      return `L`;

    case "jsVar":
      return `V(${expr.name})`;

    case "jsBinop":
      return `B(${expr.op},${jsExprSignature(expr.left)},${jsExprSignature(expr.right)})`;

    case "jsUnary":
      return `U(${expr.op},${jsExprSignature(expr.operand)})`;

    case "jsCall":
      return `C(${jsExprSignature(expr.func)},[${expr.args.map(jsExprSignature).join(",")}])`;

    case "jsMethod":
      return `M(${jsExprSignature(expr.obj)},${expr.method},[${expr.args.map(jsExprSignature).join(",")}])`;

    case "jsArrow":
      return `A([${expr.params.join(",")}],${jsBodySignature(expr.body)})`;

    case "jsNamedFunction":
      return `F(${expr.name},[${expr.params.join(",")}],${jsBodySignature(expr.body)})`;

    case "jsTernary":
      return `T(${jsExprSignature(expr.cond)},${jsExprSignature(expr.then)},${jsExprSignature(expr.else)})`;

    case "jsMember":
      return `.(${jsExprSignature(expr.obj)},${expr.prop})`;

    case "jsIndex":
      return `I(${jsExprSignature(expr.arr)},${jsExprSignature(expr.idx)})`;

    case "jsObject":
      return `O({${expr.fields.map(f => `${f.key}:${jsExprSignature(f.value)}`).join(",")}})`;

    case "jsArray":
      return `[${expr.elements.map(jsExprSignature).join(",")}]`;

    case "jsIIFE":
      return `IIFE(${jsStmtArraySignature(expr.body)})`;
  }
}

function jsBodySignature(body: JSExpr | JSStmt[]): string {
  if (Array.isArray(body)) {
    return jsStmtArraySignature(body);
  }
  return jsExprSignature(body);
}

function jsStmtArraySignature(stmts: JSStmt[]): string {
  return `[${stmts.map(jsStmtSignature).join(";")}]`;
}

function jsStmtSignature(stmt: JSStmt): string {
  switch (stmt.tag) {
    case "jsConst":
      return `const ${stmt.name}=${jsExprSignature(stmt.value)}`;
    case "jsLet":
      return `let ${stmt.name}=${jsExprSignature(stmt.value)}`;
    case "jsReturn":
      return `return ${jsExprSignature(stmt.value)}`;
    case "jsIf":
      return `if(${jsExprSignature(stmt.cond)}){${jsStmtArraySignature(stmt.then)}}${stmt.else ? `{${jsStmtArraySignature(stmt.else)}}` : ""}`;
    case "jsForOf":
      return `for(${stmt.item} of ${jsExprSignature(stmt.iter)}){${jsStmtArraySignature(stmt.body)}}`;
    case "jsExpr":
      return jsExprSignature(stmt.expr);
    case "jsConstPattern":
      return `const P=${jsExprSignature(stmt.value)}`;
    case "jsThrow":
      return `throw ${jsExprSignature(stmt.value)}`;
    case "jsContinue":
      return "continue";
    case "jsBreak":
      return "break";
  }
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Cluster specializations by JS structure.
 * Returns clusters of specs that can share a single parameterized function.
 */
export function clusterByJS<T>(specs: ClusterableSpec<T>[]): JSCluster<T>[] {
  if (specs.length === 0) return [];
  if (specs.length === 1) {
    return [{
      members: specs,
      template: { signature: jsExprSignature(specs[0].jsExpr), holes: [] },
      parameterMapping: [],
      parameterCount: 0,
    }];
  }

  const clusters: JSCluster<T>[] = [];

  for (const spec of specs) {
    const signature = jsExprSignature(spec.jsExpr);
    let foundCluster = false;

    for (const cluster of clusters) {
      // Quick check: signature must match
      if (cluster.template.signature !== signature) continue;

      // Detailed check: compare with first member
      const diff = compareJSExprs(spec.jsExpr, cluster.members[0].jsExpr);
      if (diff !== null) {
        // Compatible! Add to cluster
        cluster.members.push(spec);
        // Update holes if this is the second member
        if (cluster.members.length === 2) {
          cluster.template.holes = diff;
        }
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      // Start new cluster
      clusters.push({
        members: [spec],
        template: { signature, holes: [] },
        parameterMapping: [],
        parameterCount: 0,
      });
    }
  }

  // For each multi-member cluster, compute parameter mapping
  for (const cluster of clusters) {
    if (cluster.members.length > 1) {
      const { mapping, count } = computeParameterMapping(cluster);
      cluster.parameterMapping = mapping;
      cluster.parameterCount = count;
    }
  }

  return clusters;
}

// ============================================================================
// Parameter Consolidation
// ============================================================================

/**
 * Compute parameter mapping for a cluster using value correlation.
 *
 * Holes that always have the same value across all members can share a parameter.
 * For example, if hole[0] and hole[2] always have equal values, they map to
 * the same parameter.
 */
function computeParameterMapping<T>(cluster: JSCluster<T>): { mapping: number[]; count: number } {
  const holes = cluster.template.holes;
  if (holes.length === 0) return { mapping: [], count: 0 };

  // Extract values at each hole for each member
  const holeValues: (number | string | boolean | null)[][] = [];
  for (const hole of holes) {
    const values: (number | string | boolean | null)[] = [];
    for (const member of cluster.members) {
      values.push(extractValueAtPath(member.jsExpr, hole));
    }
    holeValues.push(values);
  }

  // Find equivalence classes of holes (holes that always have equal values)
  const mapping: number[] = new Array(holes.length).fill(-1);
  let nextParam = 0;

  for (let i = 0; i < holes.length; i++) {
    if (mapping[i] !== -1) continue; // Already assigned

    mapping[i] = nextParam;

    // Check if any later holes always have equal values
    for (let j = i + 1; j < holes.length; j++) {
      if (mapping[j] !== -1) continue;

      // Check if hole i and hole j always have equal values
      let allEqual = true;
      for (let m = 0; m < cluster.members.length; m++) {
        if (holeValues[i][m] !== holeValues[j][m]) {
          allEqual = false;
          break;
        }
      }

      if (allEqual) {
        mapping[j] = nextParam;
      }
    }

    nextParam++;
  }

  return { mapping, count: nextParam };
}

/**
 * Extract the literal value at a given path in a JS expression.
 */
function extractValueAtPath(expr: JSExpr, path: JSPath): number | string | boolean | null {
  let current: any = expr;

  for (const segment of path) {
    if (typeof segment === "string") {
      current = current[segment];
    } else {
      current = current[segment];
    }
  }

  if (current && current.tag === "jsLit") {
    return current.value;
  }

  throw new Error(`Expected literal at path ${path.join(".")}, got ${current?.tag}`);
}

// ============================================================================
// Hole Value Extraction
// ============================================================================

/**
 * Get the literal values at each hole for a specific member.
 * Returns values in the order of the template's holes.
 */
export function extractHoleValues(expr: JSExpr, holes: JSPath[]): (number | string | boolean | null)[] {
  return holes.map(hole => extractValueAtPath(expr, hole));
}

/**
 * Get the parameter values for a call to a merged function.
 * Uses the parameter mapping to deduplicate values.
 */
export function getParameterValues<T>(
  member: ClusterableSpec<T>,
  cluster: JSCluster<T>
): (number | string | boolean | null)[] {
  const holeValues = extractHoleValues(member.jsExpr, cluster.template.holes);
  const paramValues: (number | string | boolean | null)[] = new Array(cluster.parameterCount);

  for (let i = 0; i < holeValues.length; i++) {
    const paramIndex = cluster.parameterMapping[i];
    paramValues[paramIndex] = holeValues[i];
  }

  return paramValues;
}

// ============================================================================
// Template Application (for code generation)
// ============================================================================

/**
 * Replace holes in a JS expression with variable references.
 * Returns a new expression with literals replaced by parameter references.
 */
export function applyTemplate(
  expr: JSExpr,
  holes: JSPath[],
  parameterMapping: number[],
  paramNames: string[]
): JSExpr {
  // Build a map from path string to parameter name
  const pathToParam = new Map<string, string>();
  for (let i = 0; i < holes.length; i++) {
    const paramIndex = parameterMapping[i];
    const paramName = paramNames[paramIndex];
    pathToParam.set(pathToString(holes[i]), paramName);
  }

  return replaceHoles(expr, [], pathToParam);
}

function pathToString(path: JSPath): string {
  return path.join(".");
}

function replaceHoles(
  expr: JSExpr,
  currentPath: JSPath,
  pathToParam: Map<string, string>
): JSExpr {
  const pathStr = pathToString(currentPath);
  const paramName = pathToParam.get(pathStr);

  if (paramName !== undefined && expr.tag === "jsLit") {
    // Replace this literal with a variable reference
    return { tag: "jsVar", name: paramName };
  }

  // Recursively process children
  switch (expr.tag) {
    case "jsLit":
    case "jsVar":
      return expr;

    case "jsBinop":
      return {
        ...expr,
        left: replaceHoles(expr.left, [...currentPath, "left"], pathToParam),
        right: replaceHoles(expr.right, [...currentPath, "right"], pathToParam),
      };

    case "jsUnary":
      return {
        ...expr,
        operand: replaceHoles(expr.operand, [...currentPath, "operand"], pathToParam),
      };

    case "jsCall":
      return {
        ...expr,
        func: replaceHoles(expr.func, [...currentPath, "func"], pathToParam),
        args: expr.args.map((arg, i) => replaceHoles(arg, [...currentPath, "args", i], pathToParam)),
      };

    case "jsMethod":
      return {
        ...expr,
        obj: replaceHoles(expr.obj, [...currentPath, "obj"], pathToParam),
        args: expr.args.map((arg, i) => replaceHoles(arg, [...currentPath, "args", i], pathToParam)),
      };

    case "jsArrow":
      return {
        ...expr,
        body: replaceHolesInBody(expr.body, [...currentPath, "body"], pathToParam),
      };

    case "jsNamedFunction":
      return {
        ...expr,
        body: replaceHolesInBody(expr.body, [...currentPath, "body"], pathToParam),
      };

    case "jsTernary":
      return {
        ...expr,
        cond: replaceHoles(expr.cond, [...currentPath, "cond"], pathToParam),
        then: replaceHoles(expr.then, [...currentPath, "then"], pathToParam),
        else: replaceHoles(expr.else, [...currentPath, "else"], pathToParam),
      };

    case "jsMember":
      return {
        ...expr,
        obj: replaceHoles(expr.obj, [...currentPath, "obj"], pathToParam),
      };

    case "jsIndex":
      return {
        ...expr,
        arr: replaceHoles(expr.arr, [...currentPath, "arr"], pathToParam),
        idx: replaceHoles(expr.idx, [...currentPath, "idx"], pathToParam),
      };

    case "jsObject":
      return {
        ...expr,
        fields: expr.fields.map((f, i) => ({
          ...f,
          value: replaceHoles(f.value, [...currentPath, "fields", i, "value"], pathToParam),
        })),
      };

    case "jsArray":
      return {
        ...expr,
        elements: expr.elements.map((e, i) =>
          replaceHoles(e, [...currentPath, "elements", i], pathToParam)
        ),
      };

    case "jsIIFE":
      return {
        ...expr,
        body: replaceHolesInStmtArray(expr.body, [...currentPath, "body"], pathToParam),
      };
  }
}

function replaceHolesInBody(
  body: JSExpr | JSStmt[],
  path: JSPath,
  pathToParam: Map<string, string>
): JSExpr | JSStmt[] {
  if (Array.isArray(body)) {
    return replaceHolesInStmtArray(body, path, pathToParam);
  }
  return replaceHoles(body, path, pathToParam);
}

function replaceHolesInStmtArray(
  stmts: JSStmt[],
  path: JSPath,
  pathToParam: Map<string, string>
): JSStmt[] {
  return stmts.map((stmt, i) => replaceHolesInStmt(stmt, [...path, i], pathToParam));
}

function replaceHolesInStmt(
  stmt: JSStmt,
  path: JSPath,
  pathToParam: Map<string, string>
): JSStmt {
  switch (stmt.tag) {
    case "jsConst":
      return {
        ...stmt,
        value: replaceHoles(stmt.value, [...path, "value"], pathToParam),
      };

    case "jsLet":
      return {
        ...stmt,
        value: replaceHoles(stmt.value, [...path, "value"], pathToParam),
      };

    case "jsReturn":
      return {
        ...stmt,
        value: replaceHoles(stmt.value, [...path, "value"], pathToParam),
      };

    case "jsIf":
      return {
        ...stmt,
        cond: replaceHoles(stmt.cond, [...path, "cond"], pathToParam),
        then: replaceHolesInStmtArray(stmt.then, [...path, "then"], pathToParam),
        else: stmt.else ? replaceHolesInStmtArray(stmt.else, [...path, "else"], pathToParam) : undefined,
      };

    case "jsForOf":
      return {
        ...stmt,
        iter: replaceHoles(stmt.iter, [...path, "iter"], pathToParam),
        body: replaceHolesInStmtArray(stmt.body, [...path, "body"], pathToParam),
      };

    case "jsExpr":
      return {
        ...stmt,
        expr: replaceHoles(stmt.expr, [...path, "expr"], pathToParam),
      };

    case "jsConstPattern":
      return {
        ...stmt,
        value: replaceHoles(stmt.value, [...path, "value"], pathToParam),
      };

    case "jsThrow":
      return {
        ...stmt,
        value: replaceHoles(stmt.value, [...path, "value"], pathToParam),
      };

    case "jsContinue":
    case "jsBreak":
      return stmt;
  }
}
