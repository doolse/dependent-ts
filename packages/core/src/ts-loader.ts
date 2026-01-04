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
import {
  Expr,
  varRef,
  call,
  index,
  num,
  trustExpr,
  typeOfExpr,
  array,
  obj,
} from "./expr";
import { typeVal, Value } from "./value";

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
 */
interface ConversionContext {
  /** The TypeScript type checker */
  checker: ts.TypeChecker;
  /** Set of type IDs currently being converted (for cycle detection) */
  converting: Set<number>;
  /** Current depth of type conversion */
  depth: number;
  /** Maps type parameter names to argument indices (for signature extraction) */
  typeParamToArgIndex?: Map<string, number>;
}

/** Maximum depth for type conversion to prevent stack overflow */
const MAX_CONVERSION_DEPTH = 8;

/**
 * Specification for how to compute a return type constraint.
 * Used in synthetic closure bodies to derive return types from argument types.
 */
export type ReturnTypeSpec =
  | { tag: "static"; constraint: Constraint }           // Fixed return type: () => string
  | { tag: "paramType"; index: number }                 // Returns type param: <T>(x: T) => T
  | { tag: "tuple"; elements: ReturnTypeSpec[] }        // Tuple: <S>(x: S) => [S, Fn]
  | { tag: "arrayOf"; element: ReturnTypeSpec }         // Array: <T>(x: T) => T[]
  | { tag: "functionReturning"; returnSpec: ReturnTypeSpec }  // Function type: () => (() => T)

/**
 * Information about a function's type signature.
 * Used to create synthetic closures that preserve type information for imports.
 */
export interface FunctionSignatureInfo {
  /** Constraints for parameter types (for type checking arguments) */
  paramTypes: Constraint[];
  /** How to compute the return type constraint */
  returnType: ReturnTypeSpec;
  /** Number of type parameters (0 for non-generic functions) */
  typeParamCount: number;
  /** Maps type parameter names to their first occurrence in parameters */
  typeParamToArgIndex: Map<string, number>;
}

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
   * Load specific exports from a module, including function signature info.
   * Returns both constraints and signature info for creating synthetic closures.
   */
  loadExportsWithSignatures(
    moduleName: string,
    exportNames: string[],
    basePath?: string
  ): {
    constraints: Map<string, Constraint>;
    signatures: Map<string, FunctionSignatureInfo>;
  } {
    const resolvedModule = ts.resolveModuleName(
      moduleName,
      basePath || process.cwd() + "/index.ts",
      this.compilerOptions,
      ts.sys
    );

    if (!resolvedModule.resolvedModule) {
      return { constraints: new Map(), signatures: new Map() };
    }

    const resolvedPath = resolvedModule.resolvedModule.resolvedFileName;

    // Create a program with just this file
    this.program = ts.createProgram([resolvedPath], this.compilerOptions);
    this.checker = this.program.getTypeChecker();

    const sourceFile = this.program.getSourceFile(resolvedPath);
    if (!sourceFile) {
      return { constraints: new Map(), signatures: new Map() };
    }

    const ctx: ConversionContext = {
      checker: this.checker,
      converting: new Set(),
      depth: 0,
    };

    const constraints = new Map<string, Constraint>();
    const signatures = new Map<string, FunctionSignatureInfo>();

    // Get the module symbol
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      return { constraints, signatures };
    }

    // Get the exports of the module
    const moduleExports = this.checker.getExportsOfModule(moduleSymbol);

    // Only process the requested exports
    for (const exportName of exportNames) {
      const symbol = moduleExports.find(s => s.getName() === exportName);
      if (symbol) {
        const type = this.checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
        const constraint = this.convertType(type, ctx);
        constraints.set(exportName, constraint);

        // If it's a function type, extract signature info
        const callSignatures = type.getCallSignatures();
        if (callSignatures.length > 0) {
          const sigInfo = this.extractSignatureInfo(callSignatures[0], ctx);
          signatures.set(exportName, sigInfo);
        }
      }
    }

    return { constraints, signatures };
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

  /**
   * Extract full signature information from a TypeScript call signature.
   * This is used to create synthetic closures for imported functions.
   */
  extractSignatureInfo(
    signature: ts.Signature,
    ctx: ConversionContext
  ): FunctionSignatureInfo {
    // Get type parameters
    const typeParams = signature.getTypeParameters() || [];
    const typeParamToArgIndex = new Map<string, number>();

    // Get parameters and build mapping from type params to arg indices
    const params = signature.getParameters();
    const paramTypes: Constraint[] = [];

    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const paramType = ctx.checker.getTypeOfSymbol(param);

      // Check if this parameter is a type parameter
      if (paramType.flags & ts.TypeFlags.TypeParameter) {
        const typeParam = paramType as ts.TypeParameter;
        const symbol = typeParam.getSymbol();
        if (symbol && !typeParamToArgIndex.has(symbol.getName())) {
          typeParamToArgIndex.set(symbol.getName(), i);
        }
      }

      // Also check if the parameter type contains type parameters
      this.collectTypeParamIndices(paramType, i, typeParamToArgIndex, ctx);

      // Convert the parameter type to constraint
      paramTypes.push(this.convertType(paramType, ctx));
    }

    // Convert return type to ReturnTypeSpec
    const returnType = signature.getReturnType();
    const returnTypeSpec = this.convertToReturnTypeSpec(
      returnType,
      { ...ctx, typeParamToArgIndex }
    );

    return {
      paramTypes,
      returnType: returnTypeSpec,
      typeParamCount: typeParams.length,
      typeParamToArgIndex,
    };
  }

  /**
   * Collect type parameter occurrences and map them to argument indices.
   */
  private collectTypeParamIndices(
    type: ts.Type,
    argIndex: number,
    mapping: Map<string, number>,
    ctx: ConversionContext
  ): void {
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const symbol = type.getSymbol();
      if (symbol && !mapping.has(symbol.getName())) {
        mapping.set(symbol.getName(), argIndex);
      }
      return;
    }

    // For union/intersection types, check all constituent types
    if (type.isUnion() || type.isIntersection()) {
      for (const t of type.types) {
        this.collectTypeParamIndices(t, argIndex, mapping, ctx);
      }
      return;
    }

    // For array types, check element type
    if (ctx.checker.isArrayType(type)) {
      const typeArgs = ctx.checker.getTypeArguments(type as ts.TypeReference);
      if (typeArgs.length > 0) {
        this.collectTypeParamIndices(typeArgs[0], argIndex, mapping, ctx);
      }
      return;
    }

    // For tuple types, check all element types
    if (ctx.checker.isTupleType(type)) {
      const typeArgs = ctx.checker.getTypeArguments(type as ts.TypeReference);
      for (const arg of typeArgs) {
        this.collectTypeParamIndices(arg, argIndex, mapping, ctx);
      }
      return;
    }

    // For function types, check parameter and return types
    const callSignatures = type.getCallSignatures();
    if (callSignatures.length > 0) {
      const sig = callSignatures[0];
      for (const param of sig.getParameters()) {
        const paramType = ctx.checker.getTypeOfSymbol(param);
        this.collectTypeParamIndices(paramType, argIndex, mapping, ctx);
      }
      this.collectTypeParamIndices(sig.getReturnType(), argIndex, mapping, ctx);
    }
  }

  /**
   * Convert a TypeScript type to a ReturnTypeSpec.
   * This captures the structure of the return type including type parameter references.
   */
  private convertToReturnTypeSpec(
    type: ts.Type,
    ctx: ConversionContext
  ): ReturnTypeSpec {
    const mapping = ctx.typeParamToArgIndex;

    // Type parameter -> reference to arg type
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const symbol = type.getSymbol();
      if (symbol && mapping?.has(symbol.getName())) {
        return { tag: "paramType", index: mapping.get(symbol.getName())! };
      }
      // Unknown type parameter - fall back to static any
      return { tag: "static", constraint: anyC };
    }

    // Tuple types
    if (ctx.checker.isTupleType(type)) {
      const typeArgs = ctx.checker.getTypeArguments(type as ts.TypeReference);
      const elements = typeArgs.map(arg => this.convertToReturnTypeSpec(arg, ctx));
      return { tag: "tuple", elements };
    }

    // Array types (non-tuple)
    if (ctx.checker.isArrayType(type)) {
      const typeArgs = ctx.checker.getTypeArguments(type as ts.TypeReference);
      if (typeArgs.length > 0) {
        const element = this.convertToReturnTypeSpec(typeArgs[0], ctx);
        return { tag: "arrayOf", element };
      }
      return { tag: "static", constraint: and(isArray, elements(anyC)) };
    }

    // Function types
    const callSignatures = type.getCallSignatures();
    if (callSignatures.length > 0) {
      const sig = callSignatures[0];
      const returnSpec = this.convertToReturnTypeSpec(sig.getReturnType(), ctx);
      return { tag: "functionReturning", returnSpec };
    }

    // Union types - if all branches are type params pointing to same arg, use that
    if (type.isUnion()) {
      // For now, convert to static constraint
      return { tag: "static", constraint: this.convertType(type, ctx) };
    }

    // All other types - convert to static constraint
    return { tag: "static", constraint: this.convertType(type, ctx) };
  }
}

/**
 * Build a synthetic closure body for an imported function.
 * The body calls the impl function and trusts the result with the computed return type.
 *
 * @param sig - The function signature info
 * @param implName - The name of the variable holding the actual import
 * @param paramCount - Number of parameters the function takes
 * @returns An expression that can be used as the closure body
 */
export function buildSyntheticBody(
  sig: FunctionSignatureInfo,
  implName: string,
  paramCount: number
): Expr {
  // Build argument expressions: args[0], args[1], etc.
  const argExprs: Expr[] = [];
  for (let i = 0; i < paramCount; i++) {
    argExprs.push(index(varRef("args"), num(i)));
  }

  // Build the call to the impl function
  const callExpr = call(varRef(implName), ...argExprs);

  // Build the return type expression
  const returnTypeExpr = buildReturnTypeExpr(sig.returnType);

  // Wrap in trust
  return trustExpr(callExpr, returnTypeExpr);
}

/**
 * Registry for static constraints that need to be referenced from synthetic bodies.
 * Maps constraint ID to the constraint itself.
 */
const staticConstraintRegistry = new Map<number, Constraint>();
let nextConstraintId = 0;

/**
 * Register a static constraint and return its ID.
 */
function registerConstraint(c: Constraint): number {
  const id = nextConstraintId++;
  staticConstraintRegistry.set(id, c);
  return id;
}

/**
 * Look up a constraint by ID (called by evaluator).
 */
export function getRegisteredConstraint(id: number): Constraint | undefined {
  return staticConstraintRegistry.get(id);
}

/**
 * Build an expression that evaluates to a TypeValue for the return type.
 * Uses array literals to represent tuple types, which the evaluator handles specially.
 * Static constraints are registered and referenced by ID.
 */
function buildReturnTypeExpr(spec: ReturnTypeSpec): Expr {
  switch (spec.tag) {
    case "static": {
      // Register the constraint and create a reference to it
      const id = registerConstraint(spec.constraint);
      // Use a special object marker that the evaluator will recognize
      return obj({ __constraintId: num(id) });
    }

    case "paramType":
      // Return typeOf(args[index]) to get the type of the argument
      return typeOfExpr(index(varRef("args"), num(spec.index)));

    case "tuple": {
      // Create an array of type expressions - evaluator interprets as tuple type
      // Each element evaluates to a TypeValue, combined into tuple constraint
      const elementExprs = spec.elements.map(el => buildReturnTypeExpr(el));
      return array(...elementExprs);
    }

    case "arrayOf": {
      // For Array<T>, we need to wrap the element type in an array constraint
      // Use a special marker object that the evaluator recognizes
      const elementExpr = buildReturnTypeExpr(spec.element);
      return obj({ __arrayOf: elementExpr });
    }

    case "functionReturning": {
      // For function types, register isFunction constraint
      const id = registerConstraint(isFunction);
      return obj({ __constraintId: num(id) });
    }
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
