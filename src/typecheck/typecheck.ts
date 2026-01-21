/**
 * Type Checker - the core of DepJS type checking.
 *
 * Key feature: Interleaved type checking and comptime evaluation.
 * When a type annotation is encountered, it's evaluated at compile time
 * to produce a Type value.
 *
 * The type checker:
 * 1. Infers types for expressions
 * 2. Evaluates type annotations at compile time
 * 3. Checks assignments against declared types
 * 4. Tracks comptimeOnly values that cannot exist at runtime
 * 5. Provides contextual typing for lambdas
 */

import {
  Type,
  primitiveType,
  literalType,
  recordType,
  functionType,
  arrayType,
  arrayTypeFromElements,
  unionType,
  typeVarType,
  withMetadata,
  FieldInfo,
  ParamInfo,
  substituteThis,
  isVariadicArray,
  getArrayElementTypes,
} from "../types/types";
import { isSubtype } from "../types/subtype";
import { formatType } from "../types/format";
import {
  CoreExpr,
  CoreDecl,
  CoreParam,
  CorePattern,
  CoreArgument,
  TypedExpr,
  TypedArgument,
  TypedDecl,
  TypedProgram,
  CompileError,
  SourceLocation,
} from "../ast/core-ast";
import { TypeEnv, TypeBinding, ComptimeStatus } from "./type-env";
import { ComptimeEnv, TypedComptimeValue, isTypeValue, isClosureValue, isBuiltinValue, isRawTypeValue } from "./comptime-env";
import { ComptimeEvaluator } from "./comptime-eval";
import { createInitialComptimeEnv, createInitialTypeEnv } from "./builtins";
import { isComptimeOnlyProperty, getTypePropertyType, getTypeProperty } from "./type-properties";
import { getArrayMethodType, getArrayElementType } from "./array-methods";

/**
 * Type checker configuration.
 */
export interface TypeCheckConfig {
  maxFuel?: number;
}

/**
 * Type check a program (list of declarations).
 */
export function typecheck(
  decls: CoreDecl[],
  config: TypeCheckConfig = {}
): TypedProgram {
  const checker = new TypeChecker(config);
  return checker.checkProgram(decls);
}

/**
 * The type checker implementation.
 */
class TypeChecker {
  private typeEnv: TypeEnv;
  private comptimeEnv: ComptimeEnv;
  private evaluator: ComptimeEvaluator;

  constructor(config: TypeCheckConfig = {}) {
    this.typeEnv = createInitialTypeEnv();
    this.comptimeEnv = createInitialComptimeEnv();
    this.evaluator = new ComptimeEvaluator(config.maxFuel);
  }

  /**
   * Type check a program.
   */
  checkProgram(decls: CoreDecl[]): TypedProgram {
    const typedDecls: TypedDecl[] = [];

    for (const decl of decls) {
      const typed = this.checkDecl(decl);
      typedDecls.push(typed);
    }

    return { decls: typedDecls };
  }

  /**
   * Type check a declaration.
   */
  private checkDecl(decl: CoreDecl): TypedDecl {
    switch (decl.kind) {
      case "const":
        return this.checkConstDecl(decl);
      case "import":
        return this.checkImportDecl(decl);
      case "expr":
        return this.checkExprDecl(decl);
    }
  }

  /**
   * Type check a const declaration.
   */
  private checkConstDecl(
    decl: CoreDecl & { kind: "const" }
  ): TypedDecl {
    // 1. If type annotation exists, evaluate it to get the declared type
    let declaredType: Type | undefined;
    let comptimeStatus: ComptimeStatus = "runtime";

    // Track whether we pre-registered for recursive function support
    let preRegistered = false;

    if (decl.type) {
      // Type annotation must evaluate to a Type
      const typeValue = this.evaluator.evaluate(
        decl.type,
        this.comptimeEnv,
        this.typeEnv
      );

      if (!isTypeValue(typeValue)) {
        throw new CompileError(
          `Type annotation must evaluate to a Type, got ${typeof typeValue.value}`,
          "typecheck",
          decl.type.loc
        );
      }

      declaredType = typeValue.value as Type;

      // Pre-register binding to enable recursive function references.
      // This allows the initializer to reference the binding being defined.
      // The binding will be updated with final comptime status after type checking.
      this.typeEnv.define(decl.name, {
        type: declaredType,
        comptimeStatus: "runtime", // Tentative, updated below
        mutable: false,
      });
      preRegistered = true;
    } else if (
      decl.init.kind === "lambda" &&
      decl.init.returnType &&
      decl.init.params.every((p) => p.type) &&
      // Exclude generic lambdas - they need special handling in checkLambda
      !decl.init.params.some((p) => this.isTypeParam(p))
    ) {
      // Lambda with explicit return type and all params typed - compute function type
      // This enables recursive functions like: const f = (n: Int): Int => f(n-1)
      const paramInfos: ParamInfo[] = [];
      for (const p of decl.init.params) {
        const paramTypeValue = this.evaluator.evaluate(
          p.type!,
          this.comptimeEnv,
          this.typeEnv
        );
        if (!isTypeValue(paramTypeValue)) {
          throw new CompileError(
            `Parameter type must evaluate to a Type`,
            "typecheck",
            p.type!.loc
          );
        }
        paramInfos.push({
          name: p.name,
          type: paramTypeValue.value as Type,
          optional: p.defaultValue !== undefined,
          rest: p.rest,
        });
      }

      const returnTypeValue = this.evaluator.evaluate(
        decl.init.returnType,
        this.comptimeEnv,
        this.typeEnv
      );
      if (!isTypeValue(returnTypeValue)) {
        throw new CompileError(
          `Return type must evaluate to a Type`,
          "typecheck",
          decl.init.returnType.loc
        );
      }

      declaredType = {
        kind: "function",
        params: paramInfos,
        returnType: returnTypeValue.value as Type,
        async: decl.init.async,
      };

      this.typeEnv.define(decl.name, {
        type: declaredType,
        comptimeStatus: "runtime",
        mutable: false,
      });
      preRegistered = true;
    }

    // 2. Type check the initializer with contextual typing
    const typedInit = this.checkExpr(decl.init, declaredType);

    // 3. Determine the final type
    const finalType = declaredType ?? typedInit.type;

    // 4. Check assignability if declared type exists
    if (declaredType && !isSubtype(typedInit.type, declaredType)) {
      throw new CompileError(
        `Type '${formatType(typedInit.type)}' is not assignable to type '${formatType(declaredType)}'`,
        "typecheck",
        decl.init.loc
      );
    }

    // 5. Determine comptime status
    if (decl.comptime) {
      comptimeStatus = "comptimeOnly";
    } else if (typedInit.comptimeOnly) {
      comptimeStatus = "comptimeOnly";
    } else if (isComptimeOnlyType(finalType)) {
      comptimeStatus = "comptimeOnly";
    }

    // 6. Register in environments
    // If we pre-registered (for recursive function support), update instead of define
    const typeBinding = {
      type: finalType,
      comptimeStatus,
      mutable: false as const,
    };
    if (preRegistered) {
      this.typeEnv.update(decl.name, typeBinding);
    } else {
      this.typeEnv.define(decl.name, typeBinding);
    }

    // Register in comptime env
    if (comptimeStatus === "comptimeOnly" || decl.comptime) {
      // Evaluate eagerly for comptime bindings
      try {
        const value = this.evaluator.evaluate(
          decl.init,
          this.comptimeEnv,
          this.typeEnv
        );
        this.comptimeEnv.defineEvaluated(decl.name, value);
      } catch (e) {
        // Re-throw actual compile errors (like type property errors)
        // but not "unavailable at compile time" errors which are expected
        if (e instanceof CompileError && !e.message.includes("not available at compile time")) {
          throw e;
        }
        // If evaluation fails due to unavailable values, mark as unavailable
        this.comptimeEnv.defineUnavailable(decl.name);
      }
    } else {
      // Register lazily for runtime bindings that might be needed at comptime
      this.comptimeEnv.defineUnevaluated(decl.name, decl.init, this.typeEnv);
    }

    return {
      ...decl,
      init: typedInit,
      declType: finalType,
      comptimeOnly: comptimeStatus === "comptimeOnly",
    };
  }

  /**
   * Type check an import declaration.
   */
  private checkImportDecl(
    decl: CoreDecl & { kind: "import" }
  ): TypedDecl {
    // For now, treat imported values as Unknown
    // Full TypeScript .d.ts support would go here

    switch (decl.clause.kind) {
      case "default":
        this.typeEnv.define(decl.clause.name, {
          type: primitiveType("Unknown"),
          comptimeStatus: "runtime",
          mutable: false,
        });
        this.comptimeEnv.defineUnavailable(decl.clause.name);
        break;

      case "named":
        for (const spec of decl.clause.specifiers) {
          const name = spec.alias ?? spec.name;
          this.typeEnv.define(name, {
            type: primitiveType("Unknown"),
            comptimeStatus: "runtime",
            mutable: false,
          });
          this.comptimeEnv.defineUnavailable(name);
        }
        break;

      case "namespace":
        this.typeEnv.define(decl.clause.name, {
          type: primitiveType("Unknown"),
          comptimeStatus: "runtime",
          mutable: false,
        });
        this.comptimeEnv.defineUnavailable(decl.clause.name);
        break;
    }

    return {
      ...decl,
      declType: primitiveType("Void"),
      comptimeOnly: false,
    };
  }

  /**
   * Type check an expression statement.
   */
  private checkExprDecl(
    decl: CoreDecl & { kind: "expr" }
  ): TypedDecl {
    const typed = this.checkExpr(decl.expr);

    // If it's a comptime-only expression, evaluate it for effects (like assert)
    if (typed.comptimeOnly) {
      this.evaluator.evaluate(decl.expr, this.comptimeEnv, this.typeEnv);
    }

    return {
      ...decl,
      expr: typed,
      declType: typed.type,
      comptimeOnly: typed.comptimeOnly,
    };
  }

  /**
   * Type check an expression with optional contextual type.
   */
  private checkExpr(expr: CoreExpr, contextType?: Type): TypedExpr {
    switch (expr.kind) {
      case "literal":
        return this.checkLiteral(expr);

      case "identifier":
        return this.checkIdentifier(expr);

      case "binary":
        return this.checkBinary(expr);

      case "unary":
        return this.checkUnary(expr);

      case "call":
        return this.checkCall(expr);

      case "property":
        return this.checkProperty(expr);

      case "index":
        return this.checkIndex(expr);

      case "lambda":
        return this.checkLambda(expr, contextType);

      case "conditional":
        return this.checkConditional(expr);

      case "record":
        return this.checkRecord(expr, contextType);

      case "array":
        return this.checkArray(expr, contextType);

      case "block":
        return this.checkBlock(expr);

      case "match":
        return this.checkMatch(expr);

      case "throw":
        return this.checkThrow(expr);

      case "await":
        return this.checkAwait(expr);

      case "template":
        return this.checkTemplate(expr);
    }
  }

  /**
   * Check a literal expression.
   */
  private checkLiteral(expr: CoreExpr & { kind: "literal" }): TypedExpr {
    let type: Type;

    switch (expr.literalKind) {
      case "int":
        type = literalType(expr.value as number, "Int");
        break;
      case "float":
        type = literalType(expr.value as number, "Float");
        break;
      case "string":
        type = literalType(expr.value as string, "String");
        break;
      case "boolean":
        type = literalType(expr.value as boolean, "Boolean");
        break;
      case "null":
        type = primitiveType("Null");
        break;
      case "undefined":
        type = primitiveType("Undefined");
        break;
    }

    return {
      ...expr,
      type,
      comptimeOnly: false,
    };
  }

  /**
   * Check an identifier expression.
   */
  private checkIdentifier(expr: CoreExpr & { kind: "identifier" }): TypedExpr {
    const binding = this.typeEnv.lookupOrThrow(expr.name, expr.loc);
    const isComptimeOnly = binding.comptimeStatus === "comptimeOnly";

    // For comptime-only bindings, try to get the evaluated value
    let comptimeValue: unknown;
    if (isComptimeOnly) {
      const evaluated = this.comptimeEnv.getEvaluatedValue(expr.name);
      if (evaluated !== undefined) {
        comptimeValue = evaluated.value;
      }
    }

    return {
      ...expr,
      type: binding.type,
      comptimeOnly: isComptimeOnly,
      comptimeValue,
    };
  }

  /**
   * Check a binary expression.
   */
  private checkBinary(expr: CoreExpr & { kind: "binary" }): TypedExpr {
    const left = this.checkExpr(expr.left);
    const right = this.checkExpr(expr.right);

    let resultType: Type;
    const comptimeOnly = left.comptimeOnly || right.comptimeOnly;

    switch (expr.op) {
      // Arithmetic operators
      case "+":
        // + can be addition or string concatenation
        if (
          isSubtype(left.type, primitiveType("String")) ||
          isSubtype(right.type, primitiveType("String"))
        ) {
          resultType = primitiveType("String");
        } else if (
          isSubtype(left.type, primitiveType("Int")) &&
          isSubtype(right.type, primitiveType("Int"))
        ) {
          resultType = primitiveType("Int");
        } else if (
          isSubtype(left.type, primitiveType("Number")) &&
          isSubtype(right.type, primitiveType("Number"))
        ) {
          resultType = primitiveType("Number");
        } else {
          throw new CompileError(
            `Cannot apply '+' to '${formatType(left.type)}' and '${formatType(right.type)}'`,
            "typecheck",
            expr.loc
          );
        }
        break;

      case "-":
      case "*":
      case "/":
      case "%":
        if (
          isSubtype(left.type, primitiveType("Int")) &&
          isSubtype(right.type, primitiveType("Int"))
        ) {
          resultType = expr.op === "/" ? primitiveType("Float") : primitiveType("Int");
        } else if (
          isSubtype(left.type, primitiveType("Number")) &&
          isSubtype(right.type, primitiveType("Number"))
        ) {
          resultType = primitiveType("Number");
        } else {
          throw new CompileError(
            `Cannot apply '${expr.op}' to '${formatType(left.type)}' and '${formatType(right.type)}'`,
            "typecheck",
            expr.loc
          );
        }
        break;

      // Comparison operators
      case "<":
      case ">":
      case "<=":
      case ">=":
        if (
          !isSubtype(left.type, primitiveType("Number")) ||
          !isSubtype(right.type, primitiveType("Number"))
        ) {
          throw new CompileError(
            `Cannot compare '${formatType(left.type)}' and '${formatType(right.type)}'`,
            "typecheck",
            expr.loc
          );
        }
        resultType = primitiveType("Boolean");
        break;

      // Equality operators
      case "==":
      case "!=":
        resultType = primitiveType("Boolean");
        break;

      // Logical operators
      case "&&":
      case "||":
        resultType = unionType([left.type, right.type]);
        break;

      // Bitwise operators
      case "|":
      case "&":
      case "^":
        if (
          !isSubtype(left.type, primitiveType("Int")) ||
          !isSubtype(right.type, primitiveType("Int"))
        ) {
          throw new CompileError(
            `Bitwise operators require Int operands`,
            "typecheck",
            expr.loc
          );
        }
        resultType = primitiveType("Int");
        break;
    }

    return {
      ...expr,
      left,
      right,
      type: resultType,
      comptimeOnly,
    };
  }

  /**
   * Check a unary expression.
   */
  private checkUnary(expr: CoreExpr & { kind: "unary" }): TypedExpr {
    const operand = this.checkExpr(expr.operand);

    let resultType: Type;

    switch (expr.op) {
      case "!":
        resultType = primitiveType("Boolean");
        break;

      case "-":
        if (!isSubtype(operand.type, primitiveType("Number"))) {
          throw new CompileError(
            `Cannot negate '${formatType(operand.type)}'`,
            "typecheck",
            expr.loc
          );
        }
        resultType = operand.type;
        break;

      case "~":
        if (!isSubtype(operand.type, primitiveType("Int"))) {
          throw new CompileError(
            `Bitwise not requires Int operand`,
            "typecheck",
            expr.loc
          );
        }
        resultType = primitiveType("Int");
        break;
    }

    return {
      ...expr,
      operand,
      type: resultType,
      comptimeOnly: operand.comptimeOnly,
    };
  }

  /**
   * Get the expression from a CoreArgument.
   */
  private getArgExpr(arg: CoreArgument): CoreExpr {
    return arg.kind === "element" ? arg.value : arg.expr;
  }

  /**
   * Get the source location from a CoreArgument.
   */
  private getArgLoc(arg: CoreArgument): SourceLocation {
    return this.getArgExpr(arg).loc;
  }

  /**
   * Check a function call expression.
   */
  private checkCall(expr: CoreExpr & { kind: "call" }): TypedExpr {
    const fn = this.checkExpr(expr.fn);

    // Get the function type first (needed for contextual typing of arguments)
    let fnType = fn.type;

    // Unwrap metadata if present
    if (fnType.kind === "withMetadata") {
      fnType = fnType.baseType;
    }

    // Handle overloaded functions (intersection of function types)
    if (fnType.kind === "intersection") {
      return this.checkOverloadedCall(expr, fn, fnType, expr.args);
    }

    if (fnType.kind !== "function") {
      throw new CompileError(
        `Cannot call non-function type '${formatType(fn.type)}'`,
        "typecheck",
        expr.fn.loc
      );
    }

    // Check for rest parameter (last param with rest: true)
    const hasRestParam =
      fnType.params.length > 0 &&
      fnType.params[fnType.params.length - 1].rest === true;
    const nonRestParams = hasRestParam
      ? fnType.params.slice(0, -1)
      : fnType.params;
    const restParam = hasRestParam
      ? fnType.params[fnType.params.length - 1]
      : undefined;

    // Check for spread arguments - they affect how we count and check arguments
    const hasSpreadArg = expr.args.some((a) => a.kind === "spread");

    // If no spread arguments, we can do precise count checking
    if (!hasSpreadArg) {
      const requiredParams = nonRestParams.filter((p) => !p.optional).length;
      if (expr.args.length < requiredParams) {
        throw new CompileError(
          `Expected at least ${requiredParams} arguments, got ${expr.args.length}`,
          "typecheck",
          expr.loc
        );
      }
      // Only check max args if there's no rest parameter
      if (!hasRestParam && expr.args.length > fnType.params.length) {
        throw new CompileError(
          `Expected at most ${fnType.params.length} arguments, got ${expr.args.length}`,
          "typecheck",
          expr.loc
        );
      }
    }

    // Check arguments WITH contextual types from parameter types
    const typedArgs: TypedArgument[] = [];
    // For type checking, we track the "expanded" argument types
    const expandedArgTypes: { type: Type; loc: SourceLocation }[] = [];

    for (let i = 0; i < expr.args.length; i++) {
      const arg = expr.args[i];
      const argExpr = this.getArgExpr(arg);

      if (arg.kind === "spread") {
        // Spread argument - check the expression and expand its type
        const checkedExpr = this.checkExpr(argExpr);
        typedArgs.push({ kind: "spread", expr: checkedExpr });

        // The spread expression should be an array type
        if (checkedExpr.type.kind === "array") {
          // For variadic arrays (T[]), we can't know the count
          // For fixed arrays ([T, U, V]), we expand each element type
          const elemTypes = getArrayElementTypes(checkedExpr.type);
          if (isVariadicArray(checkedExpr.type)) {
            // Variable length - add a single entry representing "unknown number of elements"
            // We'll check against rest param if available
            const elemType = elemTypes[0] ?? primitiveType("Unknown");
            expandedArgTypes.push({ type: elemType, loc: argExpr.loc });
          } else {
            // Fixed length - expand each element type
            for (const elemType of elemTypes) {
              expandedArgTypes.push({ type: elemType, loc: argExpr.loc });
            }
          }
        } else {
          throw new CompileError(
            `Spread argument must be an array type, got '${formatType(checkedExpr.type)}'`,
            "typecheck",
            argExpr.loc
          );
        }
      } else {
        // Regular element argument
        // Get the expected parameter type for contextual typing
        let contextType: Type | undefined;
        const expandedIndex = expandedArgTypes.length;
        if (expandedIndex < nonRestParams.length) {
          contextType = nonRestParams[expandedIndex].type;
        } else if (restParam) {
          // Rest parameter - get element type
          if (restParam.type.kind === "array" && isVariadicArray(restParam.type)) {
            contextType = getArrayElementTypes(restParam.type)[0];
          }
        }

        const checkedExpr = this.checkExpr(argExpr, contextType);
        typedArgs.push({ kind: "element", value: checkedExpr });
        expandedArgTypes.push({ type: checkedExpr.type, loc: argExpr.loc });
      }
    }

    // Check expanded argument types against parameters
    for (let i = 0; i < Math.min(expandedArgTypes.length, nonRestParams.length); i++) {
      const paramType = nonRestParams[i].type;
      const argInfo = expandedArgTypes[i];
      if (!isSubtype(argInfo.type, paramType)) {
        throw new CompileError(
          `Argument type '${formatType(argInfo.type)}' is not assignable to parameter type '${formatType(paramType)}'`,
          "typecheck",
          argInfo.loc
        );
      }
    }

    // Check rest arguments against the rest parameter's element type
    if (restParam && expandedArgTypes.length > nonRestParams.length) {
      let restElementType: Type;
      if (restParam.type.kind === "array" && isVariadicArray(restParam.type)) {
        restElementType = getArrayElementTypes(restParam.type)[0] ?? primitiveType("Unknown");
      } else {
        restElementType = restParam.type;
      }

      for (let i = nonRestParams.length; i < expandedArgTypes.length; i++) {
        const argInfo = expandedArgTypes[i];
        if (!isSubtype(argInfo.type, restElementType)) {
          throw new CompileError(
            `Rest argument type '${formatType(argInfo.type)}' is not assignable to rest parameter element type '${formatType(restElementType)}'`,
            "typecheck",
            argInfo.loc
          );
        }
      }
    }

    // Handle generic return type inference for array methods
    let returnType = fnType.returnType;
    if (expr.fn.kind === "property") {
      const methodName = expr.fn.name;
      // Extract TypedExpr[] for the method inference
      const argExprs = typedArgs.map((a) => a.kind === "element" ? a.value : a.expr);
      returnType = this.inferArrayMethodReturnType(
        fn,
        methodName,
        argExprs,
        fnType.returnType
      );
    }

    // Handle Try builtin - compute TryResult<T> from the thunk's return type
    if (expr.fn.kind === "identifier" && expr.fn.name === "Try" && typedArgs.length > 0) {
      const thunkArg = typedArgs[0];
      const thunkType = thunkArg.kind === "element" ? thunkArg.value.type : thunkArg.expr.type;
      if (thunkType.kind === "function") {
        // Get T from () => T
        const valueType = thunkType.returnType;
        // Construct TryResult<T>
        returnType = this.constructTryResultType(valueType);
      }
    }

    // A call is comptimeOnly if:
    // 1. The result type cannot exist at runtime (like Type), OR
    // 2. The function itself is comptimeOnly (like assert - it shouldn't emit code)
    //
    // Note: If the function is comptimeOnly but returns a runtime-usable value
    // (like X.extends(Number) returning Boolean), we still set comptimeOnly=false
    // but capture the comptimeValue for potential branch elimination.
    const comptimeOnly = isComptimeOnlyType(returnType) || fn.comptimeOnly;

    // If the function or any argument is comptime-only, try to evaluate the call
    // and capture the value. This enables branch elimination for conditionals
    // with comptime conditions like `X.extends(Number) ? ... : ...`
    let comptimeValue: unknown;
    const hasComptimeInputs = fn.comptimeOnly || typedArgs.some((a) =>
      (a.kind === "element" ? a.value : a.expr).comptimeOnly
    );
    if (hasComptimeInputs) {
      try {
        const result = this.evaluator.evaluate(expr, this.comptimeEnv, this.typeEnv);
        comptimeValue = result.value;
      } catch {
        // If evaluation fails, that's OK - we just won't have a comptimeValue
      }
    }

    return {
      ...expr,
      fn,
      args: typedArgs as unknown as CoreArgument[],
      type: returnType,
      comptimeOnly,
      comptimeValue,
    };
  }

  /**
   * Check a call to an overloaded function (intersection of function types).
   * Tries each signature in order and returns the first matching one.
   * For union arguments, returns union of all matching return types.
   */
  private checkOverloadedCall(
    expr: CoreExpr & { kind: "call" },
    fn: TypedExpr,
    fnType: Type & { kind: "intersection" },
    coreArgs: CoreArgument[]
  ): TypedExpr {
    // Extract function signatures from the intersection
    const signatures = fnType.types.filter(
      (t): t is Type & { kind: "function" } => t.kind === "function"
    );

    if (signatures.length === 0) {
      throw new CompileError(
        `Intersection type contains no function signatures`,
        "typecheck",
        expr.fn.loc
      );
    }

    // Type check the arguments without contextual typing first
    // (we'll need their types to match against signatures)
    // For now, spread arguments in overloaded calls are not fully supported
    const typedArgs: TypedArgument[] = coreArgs.map((arg) => {
      const argExpr = this.getArgExpr(arg);
      const checked = this.checkExpr(argExpr);
      if (arg.kind === "spread") {
        return { kind: "spread" as const, expr: checked };
      }
      return { kind: "element" as const, value: checked };
    });

    const args = typedArgs.map((a) => a.kind === "element" ? a.value : a.expr);

    // Check if any argument is a union type
    const hasUnionArg = args.some((a) => a.type.kind === "union");

    if (hasUnionArg) {
      // For union arguments, collect all matching return types
      return this.checkOverloadedCallWithUnion(expr, fn, signatures, args, typedArgs);
    }

    // Try each signature in order (first match wins)
    for (const sig of signatures) {
      const matchResult = this.tryMatchSignature(sig, args, coreArgs);
      if (matchResult.matches) {
        const comptimeOnly =
          fn.comptimeOnly || args.some((a) => a.comptimeOnly);

        return {
          ...expr,
          fn,
          args: typedArgs as unknown as CoreArgument[],
          type: sig.returnType,
          comptimeOnly,
        };
      }
    }

    // No signature matched - report error
    const argTypes = args.map((a) => formatType(a.type)).join(", ");
    const sigDescriptions = signatures
      .map((s) => `  (${s.params.map((p) => formatType(p.type)).join(", ")}) => ${formatType(s.returnType)}`)
      .join("\n");

    throw new CompileError(
      `No overload matches call with arguments (${argTypes}).\nAvailable signatures:\n${sigDescriptions}`,
      "typecheck",
      expr.loc
    );
  }

  /**
   * Handle overloaded call when arguments include union types.
   * Returns union of all matching return types.
   */
  private checkOverloadedCallWithUnion(
    expr: CoreExpr & { kind: "call" },
    fn: TypedExpr,
    signatures: (Type & { kind: "function" })[],
    args: TypedExpr[],
    typedArgs: TypedArgument[]
  ): TypedExpr {
    const matchingReturnTypes: Type[] = [];

    // For each signature, check if it could match any combination of union variants
    for (const sig of signatures) {
      if (this.signatureCouldMatchUnion(sig, args)) {
        matchingReturnTypes.push(sig.returnType);
      }
    }

    if (matchingReturnTypes.length === 0) {
      const argTypes = args.map((a) => formatType(a.type)).join(", ");
      const sigDescriptions = signatures
        .map((s) => `  (${s.params.map((p) => formatType(p.type)).join(", ")}) => ${formatType(s.returnType)}`)
        .join("\n");

      throw new CompileError(
        `No overload matches call with arguments (${argTypes}).\nAvailable signatures:\n${sigDescriptions}`,
        "typecheck",
        expr.loc
      );
    }

    const comptimeOnly = fn.comptimeOnly || args.some((a) => a.comptimeOnly);

    return {
      ...expr,
      fn,
      args: typedArgs as unknown as CoreArgument[],
      type: unionType(matchingReturnTypes),
      comptimeOnly,
    };
  }

  /**
   * Check if a signature could match given arguments that may include union types.
   */
  private signatureCouldMatchUnion(
    sig: Type & { kind: "function" },
    args: TypedExpr[]
  ): boolean {
    // Check argument count
    const requiredParams = sig.params.filter((p) => !p.optional).length;
    const hasRest = sig.params.length > 0 && sig.params[sig.params.length - 1].rest;
    const maxParams = hasRest ? Infinity : sig.params.length;

    if (args.length < requiredParams || args.length > maxParams) {
      return false;
    }

    // Check each argument - for union args, check if any variant could match
    for (let i = 0; i < args.length; i++) {
      const paramType = i < sig.params.length ? sig.params[i].type : undefined;
      if (!paramType) continue;

      const argType = args[i].type;

      // For union arguments, check if any variant is assignable to the param
      if (argType.kind === "union") {
        const anyVariantMatches = argType.types.some((variant) =>
          isSubtype(variant, paramType)
        );
        if (!anyVariantMatches) {
          return false;
        }
      } else {
        if (!isSubtype(argType, paramType)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Try to match arguments against a single function signature.
   */
  private tryMatchSignature(
    sig: Type & { kind: "function" },
    args: TypedExpr[],
    _coreArgs: CoreArgument[]
  ): { matches: boolean } {
    // Check argument count
    const hasRestParam = sig.params.length > 0 && sig.params[sig.params.length - 1].rest;
    const nonRestParams = hasRestParam ? sig.params.slice(0, -1) : sig.params;
    const requiredParams = nonRestParams.filter((p) => !p.optional).length;

    if (args.length < requiredParams) {
      return { matches: false };
    }

    if (!hasRestParam && args.length > sig.params.length) {
      return { matches: false };
    }

    // Check argument types for non-rest parameters
    for (let i = 0; i < Math.min(args.length, nonRestParams.length); i++) {
      const paramType = nonRestParams[i].type;
      if (!isSubtype(args[i].type, paramType)) {
        return { matches: false };
      }
    }

    // Check rest arguments if present
    if (hasRestParam && args.length > nonRestParams.length) {
      const restParam = sig.params[sig.params.length - 1];
      let restElementType: Type;

      if (restParam.type.kind === "array" && isVariadicArray(restParam.type)) {
        restElementType = getArrayElementTypes(restParam.type)[0] ?? primitiveType("Unknown");
      } else {
        restElementType = restParam.type;
      }

      for (let i = nonRestParams.length; i < args.length; i++) {
        if (!isSubtype(args[i].type, restElementType)) {
          return { matches: false };
        }
      }
    }

    return { matches: true };
  }

  /**
   * Infer the return type for array methods that have generic return types.
   * For methods like map, the return type depends on the callback's return type.
   */
  private inferArrayMethodReturnType(
    fn: TypedExpr,
    methodName: string,
    args: TypedExpr[],
    defaultReturnType: Type
  ): Type {
    // Check if fn is a property access on an array
    if (fn.kind !== "property") {
      return defaultReturnType;
    }

    // Get the object type (unwrap metadata if needed)
    let objType = (fn.object as TypedExpr).type;
    if (objType.kind === "withMetadata") {
      objType = objType.baseType;
    }

    // Only handle array methods
    if (objType.kind !== "array") {
      return defaultReturnType;
    }

    const elementType = getArrayElementType(objType);

    // Get the callback argument if present
    const callback = args[0];
    if (!callback) {
      return defaultReturnType;
    }

    // Get the callback's return type
    let callbackType = callback.type;
    if (callbackType.kind === "withMetadata") {
      callbackType = callbackType.baseType;
    }

    if (callbackType.kind !== "function") {
      return defaultReturnType;
    }

    const callbackReturnType = callbackType.returnType;

    switch (methodName) {
      case "map":
        // map returns Array<CallbackReturnType>
        return arrayType([callbackReturnType], true);

      case "flatMap":
        // flatMap returns Array<ElementOf(CallbackReturnType)>
        if (callbackReturnType.kind === "array") {
          return arrayType([getArrayElementType(callbackReturnType)], true);
        }
        // If callback doesn't return array, treat as regular map
        return arrayType([callbackReturnType], true);

      case "reduce":
        // reduce: If there's an initial value (args[1]), use its type
        // Otherwise, use the element type
        if (args.length > 1) {
          return args[1].type;
        }
        return elementType;

      case "filter":
        // filter returns Array<ElementType> (preserves element type)
        return arrayType([elementType], true);

      case "find":
        // find returns ElementType | Undefined
        return unionType([elementType, primitiveType("Undefined")]);

      default:
        return defaultReturnType;
    }
  }

  /**
   * Construct the TryResult<T> type for a given value type T.
   * TryResult<T> = { ok: true, value: T } | { ok: false, error: Error }
   */
  private constructTryResultType(valueType: Type): Type {
    // Create the success branch: { ok: true, value: T }
    const successType = recordType(
      [
        { name: "ok", type: literalType(true, "Boolean"), optional: false, annotations: [] },
        { name: "value", type: valueType, optional: false, annotations: [] },
      ],
      { closed: false }
    );

    // Create the failure branch: { ok: false, error: Error }
    const errorType = recordType(
      [
        { name: "message", type: primitiveType("String"), optional: false, annotations: [] },
        { name: "name", type: primitiveType("String"), optional: false, annotations: [] },
      ],
      { closed: false }
    );
    const failureType = recordType(
      [
        { name: "ok", type: literalType(false, "Boolean"), optional: false, annotations: [] },
        { name: "error", type: errorType, optional: false, annotations: [] },
      ],
      { closed: false }
    );

    // Return the union with metadata
    const resultType = unionType([successType, failureType]);
    return withMetadata(resultType, { name: "TryResult", typeArgs: [valueType] });
  }

  /**
   * Check a property access expression.
   */
  private checkProperty(expr: CoreExpr & { kind: "property" }): TypedExpr {
    const object = this.checkExpr(expr.object);

    // Handle Type property access specially
    if (isComptimeOnlyType(object.type)) {
      // Determine if the property returns a comptime-only value
      // Some type properties (like .name) are runtime-usable
      const isComptimeOnly = isComptimeOnlyProperty(expr.name);

      // Get the static type for this property
      const propType = getTypePropertyType(expr.name);
      if (!propType) {
        throw new CompileError(
          `Type has no property '${expr.name}'`,
          "typecheck",
          expr.loc
        );
      }

      // If we have the actual Type value, evaluate the property access
      let comptimeValue: unknown;
      if (object.comptimeValue !== undefined && isRawTypeValue(object.comptimeValue)) {
        const result = getTypeProperty(
          object.comptimeValue as Type,
          expr.name,
          this.evaluator,
          expr.loc
        );
        comptimeValue = result.value;
      }

      return {
        ...expr,
        object,
        type: propType,
        comptimeOnly: isComptimeOnly,
        comptimeValue,
      };
    }

    // Regular record property access
    let objType = object.type;

    // Unwrap metadata
    if (objType.kind === "withMetadata") {
      objType = objType.baseType;
    }

    // Handle array property/method access
    if (objType.kind === "array") {
      const elementType = getArrayElementType(objType);

      // Handle .length property
      if (expr.name === "length") {
        return {
          ...expr,
          object,
          type: primitiveType("Int"),
          comptimeOnly: object.comptimeOnly,
        };
      }

      // Handle array methods
      const methodType = getArrayMethodType(elementType, expr.name);
      if (methodType) {
        return {
          ...expr,
          object,
          type: methodType,
          comptimeOnly: object.comptimeOnly,
        };
      }

      throw new CompileError(
        `Array has no method '${expr.name}'`,
        "typecheck",
        expr.loc
      );
    }

    if (objType.kind !== "record") {
      throw new CompileError(
        `Cannot access property '${expr.name}' on type '${formatType(object.type)}'`,
        "typecheck",
        expr.loc
      );
    }

    const field = objType.fields.find((f) => f.name === expr.name);
    if (!field) {
      if (objType.indexType) {
        // Indexed record allows any string key
        return {
          ...expr,
          object,
          type: objType.indexType,
          comptimeOnly: object.comptimeOnly,
        };
      }
      throw new CompileError(
        `Property '${expr.name}' does not exist on type '${formatType(object.type)}'`,
        "typecheck",
        expr.loc
      );
    }

    const fieldType = substituteThis(field.type, object.type);
    return {
      ...expr,
      object,
      type: fieldType,
      comptimeOnly: object.comptimeOnly,
    };
  }

  /**
   * Check an index access expression.
   */
  private checkIndex(expr: CoreExpr & { kind: "index" }): TypedExpr {
    const object = this.checkExpr(expr.object);
    const index = this.checkExpr(expr.index);

    let objType = object.type;

    // Unwrap metadata
    if (objType.kind === "withMetadata") {
      objType = objType.baseType;
    }

    let elementType: Type;

    if (objType.kind === "array") {
      // Array index
      if (!isSubtype(index.type, primitiveType("Int"))) {
        throw new CompileError(
          `Array index must be Int, got '${formatType(index.type)}'`,
          "typecheck",
          expr.index.loc
        );
      }

      // For fixed-length arrays with literal integer index, return specific element type
      const elemTypes = getArrayElementTypes(objType);
      if (
        !isVariadicArray(objType) &&
        index.type.kind === "literal" &&
        index.type.baseType === "Int"
      ) {
        const indexValue = index.type.value as number;
        if (indexValue >= 0 && indexValue < elemTypes.length) {
          elementType = elemTypes[indexValue];
        } else {
          // Out of bounds - could error here, but for now return union
          elementType = unionType(elemTypes);
        }
      } else {
        elementType = unionType(elemTypes);
      }
    } else if (objType.kind === "record" && objType.indexType) {
      // Indexed record
      if (!isSubtype(index.type, primitiveType("String"))) {
        throw new CompileError(
          `Record index must be String, got '${formatType(index.type)}'`,
          "typecheck",
          expr.index.loc
        );
      }
      elementType = objType.indexType;
    } else if (isSubtype(object.type, primitiveType("String"))) {
      // String index
      if (!isSubtype(index.type, primitiveType("Int"))) {
        throw new CompileError(
          `String index must be Int, got '${formatType(index.type)}'`,
          "typecheck",
          expr.index.loc
        );
      }
      elementType = primitiveType("String");
    } else {
      throw new CompileError(
        `Cannot index into type '${formatType(object.type)}'`,
        "typecheck",
        expr.loc
      );
    }

    return {
      ...expr,
      object,
      index,
      type: elementType,
      comptimeOnly: object.comptimeOnly || index.comptimeOnly,
    };
  }

  /**
   * Check a lambda expression with optional contextual type.
   */
  private checkLambda(
    expr: CoreExpr & { kind: "lambda" },
    contextType?: Type
  ): TypedExpr {
    // Extract parameter types from context if available
    let contextParams: ParamInfo[] | undefined;
    if (contextType) {
      let ctx = contextType;
      if (ctx.kind === "withMetadata") ctx = ctx.baseType;
      if (ctx.kind === "function") {
        contextParams = ctx.params;
      }
    }

    // Create child environments
    const childTypeEnv = this.typeEnv.extend();
    const childComptimeEnv = this.comptimeEnv.extend();

    // Pre-register type params (those with Type or Type<Constraint> type annotation)
    // This allows value params to reference type params that come later in the list
    // e.g., <T>(x: T) desugars to (x: T, T: Type) - x's type T must be available
    for (const param of expr.params) {
      if (this.isTypeParam(param)) {
        // Extract constraint if present (Type<Constraint> call)
        let bound: Type | undefined;
        if (param.type?.kind === "call" && param.type.fn.kind === "identifier" && param.type.fn.name === "Type") {
          // Has constraint - evaluate it
          const firstArg = param.type.args[0];
          if (firstArg && firstArg.kind === "element") {
            const constraintExpr = firstArg.value;
            const constraintValue = this.evaluator.evaluate(constraintExpr, childComptimeEnv, childTypeEnv);
            if (isTypeValue(constraintValue)) {
              bound = constraintValue.value as Type;
            }
          }
        }
        // Create type variable
        const typeVar = typeVarType(param.name, bound);
        // Register in comptime env as a Type value
        childComptimeEnv.defineEvaluated(param.name, {
          value: typeVar,
          type: primitiveType("Type"),
        });
      }
    }

    // Process parameters
    const paramTypes: ParamInfo[] = [];

    for (let i = 0; i < expr.params.length; i++) {
      const param = expr.params[i];
      let paramType: Type;

      if (param.type) {
        // Explicit type annotation - evaluate it (using child env which has type params)
        const typeValue = this.evaluator.evaluate(
          param.type,
          childComptimeEnv,
          childTypeEnv
        );
        if (!isTypeValue(typeValue)) {
          throw new CompileError(
            `Parameter type must be a Type`,
            "typecheck",
            param.type.loc
          );
        }
        paramType = typeValue.value as Type;
      } else if (contextParams && i < contextParams.length) {
        // Infer from context
        paramType = contextParams[i].type;
      } else {
        throw new CompileError(
          `Cannot infer type for parameter '${param.name}'`,
          "typecheck",
          expr.loc
        );
      }

      // Check default value type if present
      if (param.defaultValue) {
        // Type check the default value (using child env which has previous params)
        const savedTypeEnvTemp = this.typeEnv;
        const savedComptimeEnvTemp = this.comptimeEnv;
        this.typeEnv = childTypeEnv;
        this.comptimeEnv = childComptimeEnv;

        const defaultTyped = this.checkExpr(param.defaultValue, paramType);

        this.typeEnv = savedTypeEnvTemp;
        this.comptimeEnv = savedComptimeEnvTemp;

        if (!isSubtype(defaultTyped.type, paramType)) {
          throw new CompileError(
            `Default value type '${formatType(defaultTyped.type)}' is not assignable to parameter type '${formatType(paramType)}'`,
            "typecheck",
            param.defaultValue.loc
          );
        }
      }

      paramTypes.push({
        name: param.name,
        type: paramType,
        optional: param.defaultValue !== undefined,
        rest: param.rest,
      });

      // For rest parameters, the variable binding gets the array type
      // For non-rest parameters, it gets the param type directly
      childTypeEnv.define(param.name, {
        type: paramType,
        comptimeStatus: "runtime",
        mutable: false,
      });
      // Type params are already defined as evaluated, don't mark them unavailable
      if (!this.isTypeParam(param)) {
        childComptimeEnv.defineUnavailable(param.name);
      }
    }

    // Save current environments and use child environments
    const savedTypeEnv = this.typeEnv;
    const savedComptimeEnv = this.comptimeEnv;
    this.typeEnv = childTypeEnv;
    this.comptimeEnv = childComptimeEnv;

    // Check return type annotation if present
    // Use child environments since return type may reference type params
    let returnType: Type | undefined;
    if (expr.returnType) {
      const typeValue = this.evaluator.evaluate(
        expr.returnType,
        childComptimeEnv,
        childTypeEnv
      );
      if (!isTypeValue(typeValue)) {
        throw new CompileError(
          `Return type must be a Type`,
          "typecheck",
          expr.returnType.loc
        );
      }
      returnType = typeValue.value as Type;
    }

    // Check body
    const typedBody = this.checkExpr(expr.body, returnType);

    // Restore environments
    this.typeEnv = savedTypeEnv;
    this.comptimeEnv = savedComptimeEnv;

    // Determine return type
    const finalReturnType = returnType ?? typedBody.type;

    // Check return type assignability
    if (returnType && !isSubtype(typedBody.type, returnType)) {
      throw new CompileError(
        `Return type '${formatType(typedBody.type)}' is not assignable to declared return type '${formatType(returnType)}'`,
        "typecheck",
        expr.body.loc
      );
    }

    const fnType = functionType(paramTypes, finalReturnType, expr.async);

    return {
      ...expr,
      body: typedBody,
      type: fnType,
      comptimeOnly: false, // Lambdas themselves aren't comptimeOnly
    };
  }

  /**
   * Check if a parameter is a desugared type parameter (from generic syntax <T>).
   * Type params are identified by:
   * - Type annotation being Type or Type<Constraint>
   * - Having a default value that calls typeOf (e.g., typeOf(x))
   *
   * This distinguishes from regular Type value parameters like (T: Type) which
   * don't have a typeOf default.
   */
  private isTypeParam(param: CoreParam): boolean {
    if (!param.type) return false;

    // Check for typeOf default value - this distinguishes desugared type params
    // from regular Type value parameters
    const hasTypeOfDefault =
      param.defaultValue?.kind === "call" &&
      param.defaultValue.fn.kind === "identifier" &&
      param.defaultValue.fn.name === "typeOf";

    if (!hasTypeOfDefault) return false;

    // Plain Type
    if (param.type.kind === "identifier" && param.type.name === "Type") {
      return true;
    }
    // Type<Constraint>
    if (param.type.kind === "call" &&
        param.type.fn.kind === "identifier" &&
        param.type.fn.name === "Type") {
      return true;
    }
    return false;
  }

  /**
   * Check a conditional expression.
   */
  private checkConditional(expr: CoreExpr & { kind: "conditional" }): TypedExpr {
    const condition = this.checkExpr(expr.condition);
    const then = this.checkExpr(expr.then);
    const else_ = this.checkExpr(expr.else);

    if (!isSubtype(condition.type, primitiveType("Boolean"))) {
      throw new CompileError(
        `Condition must be Boolean, got '${formatType(condition.type)}'`,
        "typecheck",
        expr.condition.loc
      );
    }

    const resultType = unionType([then.type, else_.type]);

    // A conditional is comptimeOnly only if BOTH branches are comptimeOnly.
    // If condition is comptimeOnly but branches are runtime, the result is runtime
    // (erasure will eliminate the dead branch based on the comptime condition value).
    const comptimeOnly = then.comptimeOnly && else_.comptimeOnly;

    return {
      ...expr,
      condition,
      then,
      else: else_,
      type: resultType,
      comptimeOnly,
    };
  }

  /**
   * Check a record expression.
   */
  private checkRecord(
    expr: CoreExpr & { kind: "record" },
    contextType?: Type
  ): TypedExpr {
    // Use a Map to track fields by name - later definitions override earlier ones
    const fieldMap = new Map<string, FieldInfo>();
    const typedFields: typeof expr.fields = [];
    let comptimeOnly = false;

    for (const field of expr.fields) {
      if (field.kind === "spread") {
        const spreadExpr = this.checkExpr(field.expr);
        comptimeOnly = comptimeOnly || spreadExpr.comptimeOnly;

        // Add spread fields (may be overridden by later explicit fields)
        let spreadType = spreadExpr.type;
        if (spreadType.kind === "withMetadata") {
          spreadType = spreadType.baseType;
        }
        if (spreadType.kind === "record") {
          for (const f of spreadType.fields) {
            fieldMap.set(f.name, f);
          }
        }

        typedFields.push({ kind: "spread", expr: spreadExpr });
      } else {
        // Get contextual field type if available
        let fieldContextType: Type | undefined;
        if (contextType) {
          let ctx = contextType;
          if (ctx.kind === "withMetadata") ctx = ctx.baseType;
          if (ctx.kind === "record") {
            const ctxField = ctx.fields.find((f) => f.name === field.name);
            fieldContextType = ctxField?.type;
          }
        }

        const value = this.checkExpr(field.value, fieldContextType);
        comptimeOnly = comptimeOnly || value.comptimeOnly;

        // Override any existing field with same name (from spread)
        fieldMap.set(field.name, {
          name: field.name,
          type: value.type,
          optional: false,
          annotations: [],
        });

        typedFields.push({ kind: "field", name: field.name, value });
      }
    }

    const type = recordType(Array.from(fieldMap.values()));

    return {
      ...expr,
      fields: typedFields,
      type,
      comptimeOnly,
    };
  }

  /**
   * Check an array expression.
   */
  private checkArray(
    expr: CoreExpr & { kind: "array" },
    contextType?: Type
  ): TypedExpr {
    const elementTypes: Type[] = [];
    const typedElements: typeof expr.elements = [];
    let comptimeOnly = false;
    let variadic = false;

    // Get contextual element type if available
    let elementContextType: Type | undefined;
    if (contextType) {
      let ctx = contextType;
      if (ctx.kind === "withMetadata") ctx = ctx.baseType;
      if (ctx.kind === "array") {
        elementContextType = unionType(getArrayElementTypes(ctx));
        variadic = isVariadicArray(ctx);
      }
    }

    for (const elem of expr.elements) {
      if (elem.kind === "spread") {
        const spreadExpr = this.checkExpr(elem.expr);
        comptimeOnly = comptimeOnly || spreadExpr.comptimeOnly;

        let spreadType = spreadExpr.type;
        if (spreadType.kind === "withMetadata") {
          spreadType = spreadType.baseType;
        }
        if (spreadType.kind === "array") {
          elementTypes.push(...getArrayElementTypes(spreadType));
        }

        typedElements.push({ kind: "spread", expr: spreadExpr });
        variadic = true; // Spread makes it variable length
      } else {
        const value = this.checkExpr(elem.value, elementContextType);
        comptimeOnly = comptimeOnly || value.comptimeOnly;
        elementTypes.push(value.type);

        typedElements.push({ kind: "element", value });
      }
    }

    // If context type is variadic array, use that
    const type = arrayType(
      variadic ? [unionType(elementTypes)] : elementTypes,
      variadic
    );

    return {
      ...expr,
      elements: typedElements,
      type,
      comptimeOnly,
    };
  }

  /**
   * Check a block expression.
   */
  private checkBlock(expr: CoreExpr & { kind: "block" }): TypedExpr {
    const childTypeEnv = this.typeEnv.extend();
    const childComptimeEnv = this.comptimeEnv.extend();

    const savedTypeEnv = this.typeEnv;
    const savedComptimeEnv = this.comptimeEnv;
    this.typeEnv = childTypeEnv;
    this.comptimeEnv = childComptimeEnv;

    const typedStatements: TypedDecl[] = [];
    let comptimeOnly = false;

    for (const stmt of expr.statements) {
      const typed = this.checkDecl(stmt);
      typedStatements.push(typed);
      comptimeOnly = comptimeOnly || typed.comptimeOnly;
    }

    let resultType: Type = primitiveType("Undefined");
    let typedResult: TypedExpr | undefined;

    if (expr.result) {
      typedResult = this.checkExpr(expr.result);
      resultType = typedResult.type;
      comptimeOnly = comptimeOnly || typedResult.comptimeOnly;
    } else if (typedStatements.length > 0) {
      // If no trailing expression, use the last statement's type if it's an expression statement
      // This handles cases like { throw "error"; } where the block has type Never
      const lastStmt = typedStatements[typedStatements.length - 1];
      if (lastStmt.kind === "expr") {
        resultType = lastStmt.expr.type;
      }
    }

    this.typeEnv = savedTypeEnv;
    this.comptimeEnv = savedComptimeEnv;

    return {
      ...expr,
      statements: typedStatements,
      result: typedResult,
      type: resultType,
      comptimeOnly,
    };
  }

  /**
   * Check a match expression.
   */
  private checkMatch(expr: CoreExpr & { kind: "match" }): TypedExpr {
    const matchExpr = this.checkExpr(expr.expr);
    const caseTypes: Type[] = [];
    let comptimeOnly = matchExpr.comptimeOnly;

    const typedCases: typeof expr.cases = [];

    for (const c of expr.cases) {
      // Create child environment for case bindings
      const childTypeEnv = this.typeEnv.extend();
      const savedTypeEnv = this.typeEnv;
      this.typeEnv = childTypeEnv;

      // Compute narrowed type for this case
      const narrowedType = this.narrowTypeByPattern(matchExpr.type, c.pattern);

      // If the scrutinee is an identifier, shadow it with the narrowed type
      if (expr.expr.kind === "identifier") {
        this.typeEnv.define(expr.expr.name, {
          type: narrowedType,
          comptimeStatus: "runtime",
          mutable: false,
        });
      }

      // Add pattern bindings to environment (using narrowed type)
      this.addPatternBindings(c.pattern, narrowedType);

      // Check guard if present
      if (c.guard) {
        const guardExpr = this.checkExpr(c.guard);
        if (!isSubtype(guardExpr.type, primitiveType("Boolean"))) {
          throw new CompileError(
            `Guard must be Boolean`,
            "typecheck",
            c.guard.loc
          );
        }
        comptimeOnly = comptimeOnly || guardExpr.comptimeOnly;
      }

      // Check body
      const bodyExpr = this.checkExpr(c.body);
      caseTypes.push(bodyExpr.type);
      comptimeOnly = comptimeOnly || bodyExpr.comptimeOnly;

      this.typeEnv = savedTypeEnv;

      typedCases.push({
        ...c,
        body: bodyExpr,
      });
    }

    const resultType = unionType(caseTypes);

    return {
      ...expr,
      expr: matchExpr,
      cases: typedCases,
      type: resultType,
      comptimeOnly,
    };
  }

  /**
   * Add pattern bindings to the type environment.
   */
  private addPatternBindings(pattern: CorePattern, matchType: Type): void {
    switch (pattern.kind) {
      case "wildcard":
        // No bindings
        break;
      case "literal":
        // No bindings
        break;
      case "type":
        // Type patterns narrow the match type but don't create bindings
        break;
      case "binding":
        // Bind the variable to the matched type
        this.typeEnv.define(pattern.name, {
          type: matchType,
          comptimeStatus: "runtime",
          mutable: false,
        });
        // If there's a nested pattern, process it
        if (pattern.pattern) {
          this.addPatternBindings(pattern.pattern, matchType);
        }
        break;
      case "destructure":
        // Unwrap metadata if present
        if (matchType.kind === "withMetadata") {
          matchType = matchType.baseType;
        }
        // Process each field
        if (matchType.kind === "record") {
          for (const field of pattern.fields) {
            const recordField = matchType.fields.find(f => f.name === field.name);
            const fieldType = recordField?.type ?? primitiveType("Unknown");
            const bindingName = field.binding ?? field.name;
            this.typeEnv.define(bindingName, {
              type: fieldType,
              comptimeStatus: "runtime",
              mutable: false,
            });
            if (field.pattern) {
              this.addPatternBindings(field.pattern, fieldType);
            }
          }
        }
        break;
    }
  }

  /**
   * Narrow a type based on a pattern match.
   * For union types, filters to only the variants that could match the pattern.
   */
  private narrowTypeByPattern(matchType: Type, pattern: CorePattern): Type {
    // Unwrap metadata
    if (matchType.kind === "withMetadata") {
      matchType = matchType.baseType;
    }

    switch (pattern.kind) {
      case "wildcard":
        // Wildcard matches everything, no narrowing
        return matchType;

      case "literal":
        // Literal pattern narrows to the literal type
        return literalType(pattern.value);

      case "type":
        // Type patterns would narrow to that type (but we'd need to evaluate it)
        // For now, return the match type unchanged
        return matchType;

      case "binding":
        // Binding with nested pattern narrows based on the nested pattern
        if (pattern.pattern) {
          return this.narrowTypeByPattern(matchType, pattern.pattern);
        }
        return matchType;

      case "destructure":
        // For destructure patterns, filter union variants
        if (matchType.kind === "union") {
          const matchingVariants = matchType.types.filter((variant) =>
            this.variantMatchesDestructure(variant, pattern)
          );
          if (matchingVariants.length === 0) {
            return matchType; // No narrowing possible
          }
          if (matchingVariants.length === 1) {
            return matchingVariants[0];
          }
          return unionType(matchingVariants);
        }
        // Non-union, return as-is
        return matchType;
    }
  }

  /**
   * Check if a type variant could match a destructure pattern.
   * A variant matches if all literal fields in the pattern are compatible.
   */
  private variantMatchesDestructure(
    variant: Type,
    pattern: CorePattern & { kind: "destructure" }
  ): boolean {
    // Unwrap metadata
    if (variant.kind === "withMetadata") {
      variant = variant.baseType;
    }

    if (variant.kind !== "record") {
      return false;
    }

    // Check each field in the pattern
    for (const patternField of pattern.fields) {
      const recordField = variant.fields.find((f) => f.name === patternField.name);
      if (!recordField) {
        // Record doesn't have this field - doesn't match
        return false;
      }

      // If the pattern field has a nested literal pattern, check compatibility
      if (patternField.pattern?.kind === "literal") {
        const literalValue = patternField.pattern.value;
        const literalKind = patternField.pattern.literalKind;
        // Map literalKind to LiteralBaseType
        const baseType = literalKind === "int" ? "Int"
          : literalKind === "float" ? "Float"
          : literalKind === "boolean" ? "Boolean"
          : "String";
        const literalT = literalType(literalValue as string | number | boolean, baseType);
        // Check if the record field type is compatible with the literal
        // The field type should be a supertype of the literal, or equal to it
        if (!isSubtype(literalT, recordField.type)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check a throw expression.
   */
  private checkThrow(expr: CoreExpr & { kind: "throw" }): TypedExpr {
    const throwExpr = this.checkExpr(expr.expr);

    return {
      ...expr,
      expr: throwExpr,
      type: primitiveType("Never"),
      comptimeOnly: throwExpr.comptimeOnly,
    };
  }

  /**
   * Check an await expression.
   */
  private checkAwait(expr: CoreExpr & { kind: "await" }): TypedExpr {
    const awaitExpr = this.checkExpr(expr.expr);

    // Check that we're awaiting a Promise
    // For now, just unwrap any Promise-like type
    let resultType = awaitExpr.type;

    if (resultType.kind === "withMetadata") {
      const metadata = resultType.metadata;
      if (metadata?.name === "Promise" && metadata.typeArgs?.length === 1) {
        resultType = metadata.typeArgs[0];
      }
    }

    return {
      ...expr,
      expr: awaitExpr,
      type: resultType,
      comptimeOnly: false, // await is runtime-only
    };
  }

  /**
   * Check a template literal expression.
   */
  private checkTemplate(expr: CoreExpr & { kind: "template" }): TypedExpr {
    let comptimeOnly = false;

    const typedParts: typeof expr.parts = [];

    for (const part of expr.parts) {
      if (part.kind === "expr") {
        const partExpr = this.checkExpr(part.expr);
        comptimeOnly = comptimeOnly || partExpr.comptimeOnly;
        typedParts.push({ kind: "expr", expr: partExpr });
      } else {
        typedParts.push(part);
      }
    }

    return {
      ...expr,
      parts: typedParts,
      type: primitiveType("String"),
      comptimeOnly,
    };
  }
}

/**
 * Check if a type is comptime-only (cannot exist at runtime).
 */
function isComptimeOnlyType(type: Type): boolean {
  switch (type.kind) {
    case "primitive":
      return type.name === "Type";
    case "withMetadata":
      return isComptimeOnlyType(type.baseType);
    default:
      return false;
  }
}
