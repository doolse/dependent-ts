# Plan: Implement esModule Builtin Compiler

## Overview

Create an `esModule` builtin that compiles staged expressions into ES module source code strings, with proper import collection, runtime parameter wrapping, and named function emission.

**Key decisions:**
- Returns a string (the generated module source)
- Runtime parameters wrapped: `export default (userId, ...) => <body>`
- Named functions emitted as `const f = (...) => ...` at top level

## Example Usage

```
esModule(
  import { fetch } from "node-fetch" in
  fn(userId) => fetch("/api/user/" + userId)
)
// Returns: 'import { fetch } from "node-fetch";\n\nexport default (userId) => fetch("/api/user/" + userId);\n'
```

---

## Implementation Steps

### Step 1: Add Module-Level AST Types (js-ast.ts)

Add new types for ES module constructs:

```typescript
// Import declaration: import { a, b } from "module"
export interface JSImportDecl {
  tag: "jsImportDecl";
  names: string[];
  modulePath: string;
  isDefault?: boolean;
}

// Export default: export default <expr>
export interface JSExportDefault {
  tag: "jsExportDefault";
  value: JSExpr;
}

// Complete ES module
export interface JSModule {
  tag: "jsModule";
  imports: JSImportDecl[];
  statements: JSStmt[];      // Named function declarations
  export: JSExportDefault;
}

// Constructors
export const jsImportDecl = (names: string[], modulePath: string, isDefault?: boolean): JSImportDecl => ...
export const jsExportDefault = (value: JSExpr): JSExportDefault => ...
export const jsModule = (imports: JSImportDecl[], statements: JSStmt[], exp: JSExportDefault): JSModule => ...
```

**File:** `src/js-ast.ts`

---

### Step 2: Add Module Printing (js-printer.ts)

Add printing functions for the new AST types:

```typescript
export function printModule(mod: JSModule, options: PrintOptions = {}): string {
  const opts = { ...defaultOptions, ...options };

  // Print imports
  const importStrs = mod.imports.map(printImportDecl);

  // Print top-level statements (named functions)
  const stmtStrs = mod.statements.map(s => printJSStmt(s, opts, 0));

  // Print export
  const exportStr = printExportDefault(mod.export, opts);

  const parts = [
    ...importStrs,
    ...(importStrs.length > 0 && (stmtStrs.length > 0 || true) ? [''] : []),
    ...stmtStrs,
    ...(stmtStrs.length > 0 ? [''] : []),
    exportStr
  ];

  return parts.join('\n') + '\n';
}

function printImportDecl(decl: JSImportDecl): string {
  if (decl.isDefault) {
    return `import ${decl.names[0]} from ${JSON.stringify(decl.modulePath)};`;
  }
  return `import { ${decl.names.join(', ')} } from ${JSON.stringify(decl.modulePath)};`;
}

function printExportDefault(exp: JSExportDefault, opts: Required<PrintOptions>): string {
  return `export default ${printJSExpr(exp.value, opts, 0)};`;
}
```

**File:** `src/js-printer.ts`

---

### Step 3: Create ES Module Generator (new file)

Create a new module that handles the core generation logic:

```typescript
// src/es-module-generator.ts

export interface ESModuleOptions {
  // Future options: minify, comments, etc.
}

export function generateESModule(sv: SValue, ctx: BackendContext): JSModule {
  // 1. Collect all imports from SValue tree
  const importMap = collectByOrigin(sv, "import");

  // 2. Collect all runtime parameters
  const runtimeMap = collectByOrigin(sv, "runtime");

  // 3. Group imports by module path
  const moduleImports = groupImportsByModule(importMap);

  // 4. Collect named closures for top-level emission
  const namedClosures = collectNamedClosures(sv);

  // 5. Generate main expression
  let mainExpr = backend.generate(sv, ctx);

  // 6. Wrap in function if runtime params exist
  if (runtimeMap.size > 0) {
    const params = Array.from(runtimeMap.keys());
    mainExpr = jsArrow(params, mainExpr);
  }

  // 7. Build import declarations
  const imports = buildImportDecls(moduleImports);

  // 8. Build top-level statements for named functions
  const statements = buildNamedFunctionStmts(namedClosures, ctx);

  return jsModule(imports, statements, jsExportDefault(mainExpr));
}
```

**File:** `src/es-module-generator.ts` (new)

---

### Step 4: Add Named Closure Collection Utility (svalue.ts)

Add utility to collect closures that should be emitted as named top-level functions:

```typescript
/**
 * Collect closures that have names and should be emitted as top-level declarations.
 * Returns them in dependency order (dependencies before dependents).
 */
export function collectNamedClosures(root: SValue): StagedClosure[] {
  const closures = collectClosures(root);
  // Filter to only named closures
  const named = closures.filter(c => c.name);
  // TODO: Topological sort by dependencies
  return named;
}
```

**File:** `src/svalue.ts`

---

### Step 5: Register esModule Builtin (builtin-registry.ts)

Register the builtin with the staged handler:

```typescript
registerBuiltin({
  name: "esModule",
  params: [{ name: "body", constraint: { tag: "any" } }],
  resultType: () => isString,
  isMethod: false,
  evaluate: {
    kind: "staged",
    handler: (args, argExprs, ctx) => {
      const input = args[0];

      // Create backend context from staged context
      const backendCtx = createBackendContext(ctx);

      // Generate the module
      const module = generateESModule(input, backendCtx);

      // Print to string
      const source = printModule(module);

      // Return as compile-time string
      return { svalue: ctx.now(stringVal(source), isString) };
    }
  }
});
```

**File:** `src/builtin-registry.ts`

---

### Step 6: Add Tests

Create comprehensive tests:

```typescript
// test/es-module.test.ts

describe("esModule builtin", () => {
  it("generates simple export for compile-time value", () => {
    const result = runString(`esModule({ sum: 10 + 20 })`);
    expect(result).toBe("export default { sum: 30 };\n");
  });

  it("collects imports", () => {
    const result = runString(`
      esModule(
        import { fetch } from "node-fetch" in
        fetch("/api")
      )
    `);
    expect(result).toContain('import { fetch } from "node-fetch"');
    expect(result).toContain("export default fetch");
  });

  it("wraps with runtime params", () => {
    const result = runString(`
      esModule(
        let userId = runtime("userId") in
        "/api/user/" + userId
      )
    `);
    expect(result).toContain("export default (userId) =>");
  });

  it("emits named functions as const", () => {
    const result = runString(`
      esModule(
        let double = fn(x) => x * 2 in
        double(5)
      )
    `);
    expect(result).toContain("const double =");
  });

  it("groups imports by module", () => {
    const result = runString(`
      esModule(
        import { a } from "mod" in
        import { b } from "mod" in
        a + b
      )
    `);
    // Should have one import statement with both names
    expect(result).toMatch(/import \{ a, b \} from "mod"/);
  });
});
```

**File:** `test/es-module.test.ts` (new)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/js-ast.ts` | Add JSImportDecl, JSExportDefault, JSModule types + constructors |
| `src/js-printer.ts` | Add printModule, printImportDecl, printExportDefault functions |
| `src/svalue.ts` | Add collectNamedClosures utility |
| `src/builtin-registry.ts` | Register esModule builtin |
| `src/es-module-generator.ts` | New file - core generation logic |
| `src/index.ts` | Export new types and functions |
| `test/es-module.test.ts` | New file - test suite |

---

## Edge Cases to Handle

1. **No imports, no runtime** → Just `export default <value>;`
2. **Imports but no runtime** → Import statements + `export default <expr>;`
3. **Runtime but no imports** → `export default (params) => <expr>;`
4. **Both imports and runtime** → Imports + `export default (params) => <expr>;`
5. **Named functions with runtime captures** → Emit as arrow functions that close over params
6. **Diamond dependencies** → Deduplicate via collectByOrigin's visited set
7. **Closures in object fields** → Traverse into objects to find nested closures

---

## Implementation Order

1. AST additions (js-ast.ts) - foundation
2. Printer additions (js-printer.ts) - can test AST→string
3. Named closure collection (svalue.ts) - utility
4. ES module generator (new file) - core logic
5. Builtin registration (builtin-registry.ts) - integration
6. Tests (es-module.test.ts) - verification
7. Exports (index.ts) - public API

---

## Open Questions / Future Enhancements

1. **Default imports** - Currently only handles named imports. May need `import foo from "mod"` support.
2. **Named exports** - Could extend to support `export { name }` in addition to `export default`.
3. **Source maps** - Could generate source maps for debugging.
4. **Minification** - Could add an option for minified output.
5. **CommonJS** - Could add a `cjsModule` variant for Node.js compatibility.