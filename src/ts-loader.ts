/**
 * TypeScript Declaration Loader
 *
 * Loads TypeScript .d.ts declaration files and converts them to our constraint
 * system. This enables importing React and other TypeScript libraries.
 *
 * Type mapping:
 * - number -> isNumber
 * - string -> isString
 * - boolean -> isBool
 * - null -> isNull
 * - undefined -> isUndefined
 * - any -> anyC
 * - never -> neverC
 * - { x: T } -> and(isObject, hasField("x", T))
 * - T[] -> and(isArray, elements(T))
 * - [T, U] -> and(isArray, elementAt(0,T), elementAt(1,U), length(equals(2)))
 * - A | B -> or(A, B)
 * - (x: A) => B -> isFunction (body-based type derivation at call sites)
 * - <T>(x: T) => T -> isFunction (body-based type derivation at call sites)
 */

import * as ts from "typescript";
import {
  Constraint,
  isNumber,
  isString,
  isBool,
  isNull,
  isUndefined,
  isObject,
  isArray,
  isFunction,
  anyC,
  neverC,
  and,
  or,
  hasField,
  elements,
  elementAt,
  length,
  equals,
} from "./constraint";

/**
 * Result of loading a module's declarations.
 */
export interface ModuleDeclarations {
  /** Named exports from the module */
  exports: Map<string, Constraint>;
  /** Default export, if any */
  defaultExport?: Constraint;
}

/**
 * Context for type conversion.
 * Note: Type parameters are resolved to `any` since we use body-based type derivation.
 */
interface ConversionContext {
  /** The TypeScript type checker */
  checker: ts.TypeChecker;
  /** Set of type IDs currently being converted (for cycle detection) */
  converting: Set<number>;
  /** Current depth of type conversion */
  depth: number;
}

/** Maximum depth for type conversion to prevent stack overflow */
const MAX_CONVERSION_DEPTH = 8;

/**
 * TypeScript Declaration Loader.
 * Loads .d.ts files and converts types to constraints.
 */
export class TSDeclarationLoader {
  private program: ts.Program | null = null;
  private checker: ts.TypeChecker | null = null;
  private compilerOptions: ts.CompilerOptions;

  constructor(options?: { basePath?: string; typeRoots?: string[] }) {
    this.compilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      declaration: true,
      strict: true,
      skipLibCheck: true,
      typeRoots: options?.typeRoots,
      baseUrl: options?.basePath || ".",
    };
  }

  /**
   * Load declarations from a module by name (e.g., "react").
   * Uses Node.js module resolution to find @types packages.
   */
  loadModule(moduleName: string, basePath?: string): ModuleDeclarations | null {
    const resolvedModule = ts.resolveModuleName(
      moduleName,
      basePath || process.cwd() + "/index.ts",
      this.compilerOptions,
      ts.sys
    );

    if (!resolvedModule.resolvedModule) {
      return null;
    }

    const resolvedPath = resolvedModule.resolvedModule.resolvedFileName;
    return this.loadFile(resolvedPath);
  }

  /**
   * Load specific exports from a module by name.
   * This is more efficient than loadModule for large modules like React.
   */
  loadExports(moduleName: string, exportNames: string[], basePath?: string): Map<string, Constraint> {
    const resolvedModule = ts.resolveModuleName(
      moduleName,
      basePath || process.cwd() + "/index.ts",
      this.compilerOptions,
      ts.sys
    );

    if (!resolvedModule.resolvedModule) {
      return new Map();
    }

    const resolvedPath = resolvedModule.resolvedModule.resolvedFileName;

    // Create a program with just this file
    this.program = ts.createProgram([resolvedPath], this.compilerOptions);
    this.checker = this.program.getTypeChecker();

    const sourceFile = this.program.getSourceFile(resolvedPath);
    if (!sourceFile) {
      return new Map();
    }

    const ctx: ConversionContext = {
      checker: this.checker,
      converting: new Set(),
      depth: 0,
    };

    const result = new Map<string, Constraint>();

    // Get the module symbol
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      return result;
    }

    // Get the exports of the module
    const moduleExports = this.checker.getExportsOfModule(moduleSymbol);

    // Only process the requested exports
    for (const exportName of exportNames) {
      const symbol = moduleExports.find(s => s.getName() === exportName);
      if (symbol) {
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
        const constraint = this.convertType(type, ctx);
        result.set(exportName, constraint);
      }
    }

    return result;
  }

  /**
   * Load declarations from a specific .d.ts file path.
   */
  loadFile(filePath: string): ModuleDeclarations | null {
    // Create a program with just this file
    this.program = ts.createProgram([filePath], this.compilerOptions);
    this.checker = this.program.getTypeChecker();

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return null;
    }

    const result: ModuleDeclarations = {
      exports: new Map(),
    };

    const ctx: ConversionContext = {
      checker: this.checker,
      converting: new Set(),
      depth: 0,
    };

    // Walk the source file and extract declarations
    ts.forEachChild(sourceFile, (node) => {
      this.processNode(node, result, ctx);
    });

    return result;
  }

  /**
   * Load declarations from inline TypeScript declaration text.
   * Useful for testing.
   */
  loadFromSource(source: string): ModuleDeclarations | null {
    const fileName = "/__virtual__.d.ts";

    // Create a virtual file system
    const host = ts.createCompilerHost(this.compilerOptions);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (
      name: string,
      languageVersion: ts.ScriptTarget,
      onError?: (message: string) => void
    ) => {
      if (name === fileName) {
        return ts.createSourceFile(name, source, languageVersion, true);
      }
      return originalGetSourceFile(name, languageVersion, onError);
    };
    host.fileExists = (name: string) => {
      if (name === fileName) return true;
      return ts.sys.fileExists(name);
    };
    host.readFile = (name: string) => {
      if (name === fileName) return source;
      return ts.sys.readFile(name);
    };

    this.program = ts.createProgram([fileName], this.compilerOptions, host);
    this.checker = this.program.getTypeChecker();

    const sourceFile = this.program.getSourceFile(fileName);
    if (!sourceFile) {
      return null;
    }

    const result: ModuleDeclarations = {
      exports: new Map(),
    };

    const ctx: ConversionContext = {
      checker: this.checker,
      converting: new Set(),
      depth: 0,
    };

    ts.forEachChild(sourceFile, (node) => {
      this.processNode(node, result, ctx);
    });

    return result;
  }

  private processNode(
    node: ts.Node,
    result: ModuleDeclarations,
    ctx: ConversionContext
  ): void {
    // Handle different declaration types
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const type = ctx.checker.getTypeAtLocation(node);
      const constraint = this.convertType(type, ctx);

      if (this.hasExportModifier(node)) {
        if (this.hasDefaultModifier(node)) {
          result.defaultExport = constraint;
        } else {
          result.exports.set(name, constraint);
        }
      }
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const type = ctx.checker.getTypeAtLocation(decl);
          const constraint = this.convertType(type, ctx);

          if (this.hasExportModifier(node)) {
            if (this.hasDefaultModifier(node)) {
              result.defaultExport = constraint;
            } else {
              result.exports.set(name, constraint);
            }
          }
        }
      }
    }

    if (ts.isInterfaceDeclaration(node) && node.name) {
      const name = node.name.text;
      const symbol = ctx.checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = ctx.checker.getDeclaredTypeOfSymbol(symbol);
        const constraint = this.convertType(type, ctx);

        if (this.hasExportModifier(node)) {
          result.exports.set(name, constraint);
        }
      }
    }

    if (ts.isTypeAliasDeclaration(node) && node.name) {
      const name = node.name.text;
      const symbol = ctx.checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = ctx.checker.getDeclaredTypeOfSymbol(symbol);
        const constraint = this.convertType(type, ctx);

        if (this.hasExportModifier(node)) {
          result.exports.set(name, constraint);
        }
      }
    }

    // Handle module declarations (declare module "x" { ... })
    if (ts.isModuleDeclaration(node) && node.body) {
      if (ts.isModuleBlock(node.body)) {
        for (const statement of node.body.statements) {
          this.processNode(statement, result, ctx);
        }
      }
    }

    // Handle export declarations
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const spec of node.exportClause.elements) {
          const name = spec.name.text;
          const symbol = ctx.checker.getSymbolAtLocation(spec.name);
          if (symbol) {
            const type = ctx.checker.getTypeOfSymbol(symbol);
            const constraint = this.convertType(type, ctx);
            result.exports.set(name, constraint);
          }
        }
      }
    }
  }

  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node)
      ? ts.getModifiers(node)
      : undefined;
    return (
      modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    );
  }

  private hasDefaultModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node)
      ? ts.getModifiers(node)
      : undefined;
    return (
      modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false
    );
  }

  /**
   * Convert a TypeScript type to a Constraint.
   */
  convertType(type: ts.Type, ctx: ConversionContext): Constraint {
    // Depth check - if we've gone too deep, return any to prevent stack overflow
    if (ctx.depth >= MAX_CONVERSION_DEPTH) {
      return anyC;
    }

    const flags = type.getFlags();

    // Cycle detection - if we're already converting this type, return any
    // This handles recursive types like ReactNode
    const typeId = (type as any).id as number | undefined;
    if (typeId !== undefined) {
      if (ctx.converting.has(typeId)) {
        // Recursive type - return any to break the cycle
        return anyC;
      }
      ctx.converting.add(typeId);
    }

    // Increment depth for nested conversions
    const innerCtx = { ...ctx, depth: ctx.depth + 1 };

    try {
      return this.convertTypeInner(type, flags, innerCtx);
    } finally {
      if (typeId !== undefined) {
        ctx.converting.delete(typeId);
      }
    }
  }

  /**
   * Inner type conversion after cycle detection.
   */
  private convertTypeInner(type: ts.Type, flags: ts.TypeFlags, ctx: ConversionContext): Constraint {
    // Primitive types
    if (flags & ts.TypeFlags.Number || flags & ts.TypeFlags.NumberLiteral) {
      if (flags & ts.TypeFlags.NumberLiteral && type.isLiteral()) {
        return and(isNumber, equals(Number(type.value)));
      }
      return isNumber;
    }

    if (flags & ts.TypeFlags.String || flags & ts.TypeFlags.StringLiteral) {
      if (flags & ts.TypeFlags.StringLiteral && type.isLiteral()) {
        return and(isString, equals(String(type.value)));
      }
      return isString;
    }

    if (flags & ts.TypeFlags.Boolean) {
      return isBool;
    }

    if (flags & ts.TypeFlags.BooleanLiteral) {
      // TypeScript represents true/false as intrinsic types
      const intrinsicName = (type as any).intrinsicName;
      if (intrinsicName === "true") {
        return and(isBool, equals(true));
      }
      if (intrinsicName === "false") {
        return and(isBool, equals(false));
      }
      return isBool;
    }

    if (flags & ts.TypeFlags.Null) {
      return isNull;
    }

    if (flags & ts.TypeFlags.Undefined) {
      return isUndefined;
    }

    if (flags & ts.TypeFlags.Void) {
      return isUndefined; // void is treated as undefined
    }

    if (flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown) {
      return anyC;
    }

    if (flags & ts.TypeFlags.Never) {
      return neverC;
    }

    // TypeScript's `object` keyword (non-primitive type)
    if (flags & ts.TypeFlags.NonPrimitive) {
      return isObject;
    }

    // Type parameters -> return any (body-based type derivation handles this at call sites)
    if (flags & ts.TypeFlags.TypeParameter) {
      return anyC;
    }

    // Union types
    if (type.isUnion()) {
      const unionTypes = type.types.map((t) => this.convertType(t, ctx));
      return or(...unionTypes);
    }

    // Intersection types
    if (type.isIntersection()) {
      const intersectionTypes = type.types.map((t) =>
        this.convertType(t, ctx)
      );
      return and(...intersectionTypes);
    }

    // Array types
    if (ctx.checker.isArrayType(type)) {
      const typeArgs = ctx.checker.getTypeArguments(type as ts.TypeReference);
      if (typeArgs.length > 0) {
        const elementType = this.convertType(typeArgs[0], ctx);
        return and(isArray, elements(elementType));
      }
      return isArray;
    }

    // Tuple types
    if (ctx.checker.isTupleType(type)) {
      const tupleType = type as ts.TypeReference;
      const typeArgs = ctx.checker.getTypeArguments(tupleType);
      const constraints: Constraint[] = [isArray];

      for (let i = 0; i < typeArgs.length; i++) {
        constraints.push(elementAt(i, this.convertType(typeArgs[i], ctx)));
      }
      constraints.push(length(equals(typeArgs.length)));

      return and(...constraints);
    }

    // Function types - check for call signatures
    const callSignatures = type.getCallSignatures();
    if (callSignatures.length > 0) {
      // Use the first call signature (overloads would need more handling)
      return this.convertSignature(callSignatures[0], ctx);
    }

    // Object types
    if (flags & ts.TypeFlags.Object) {
      const objType = type as ts.ObjectType;
      const properties = type.getProperties();

      if (properties.length === 0) {
        return isObject;
      }

      const constraints: Constraint[] = [isObject];
      for (const prop of properties) {
        const propType = ctx.checker.getTypeOfSymbol(prop);
        const propConstraint = this.convertType(propType, ctx);
        constraints.push(hasField(prop.getName(), propConstraint));
      }

      return and(...constraints);
    }

    // Fallback
    return anyC;
  }

  /**
   * Convert a TypeScript call signature to a function constraint.
   * With body-based type derivation, we return simple isFunction constraint.
   * Actual types are derived at call sites when we have the function body.
   */
  private convertSignature(
    _signature: ts.Signature,
    _ctx: ConversionContext
  ): Constraint {
    // All functions get isFunction constraint
    // Type derivation happens at call sites with body analysis
    return isFunction;
  }
}

/**
 * Convenience function to load a module's declarations.
 */
export function loadModule(
  moduleName: string,
  basePath?: string
): ModuleDeclarations | null {
  const loader = new TSDeclarationLoader();
  return loader.loadModule(moduleName, basePath);
}

/**
 * Convenience function to load declarations from source text.
 */
export function loadFromSource(source: string): ModuleDeclarations | null {
  const loader = new TSDeclarationLoader();
  return loader.loadFromSource(source);
}

/**
 * Convenience function to load specific exports from a module.
 * More efficient than loadModule for large modules like React.
 */
export function loadExports(
  moduleName: string,
  exportNames: string[],
  basePath?: string
): Map<string, Constraint> {
  const loader = new TSDeclarationLoader();
  return loader.loadExports(moduleName, exportNames, basePath);
}
