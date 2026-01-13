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
  unionType,
  FieldInfo,
  ParamInfo,
} from "../types/types";
import { isSubtype } from "../types/subtype";
import { formatType } from "../types/format";
import {
  CoreExpr,
  CoreDecl,
  CoreParam,
  CorePattern,
  TypedExpr,
  TypedDecl,
  TypedProgram,
  CompileError,
  SourceLocation,
} from "../ast/core-ast";
import { TypeEnv, TypeBinding, ComptimeStatus } from "./type-env";
import { ComptimeEnv, ComptimeValue, isTypeValue, isClosureValue, isBuiltinValue } from "./comptime-env";
import { ComptimeEvaluator } from "./comptime-eval";
import { createInitialComptimeEnv, createInitialTypeEnv } from "./builtins";
import { isComptimeOnlyProperty } from "./type-properties";

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

    if (decl.type) {
      // Type annotation must evaluate to a Type
      const typeValue = this.evaluator.evaluate(
        decl.type,
        this.comptimeEnv,
        this.typeEnv
      );

      if (!isTypeValue(typeValue)) {
        throw new CompileError(
          `Type annotation must evaluate to a Type, got ${typeof typeValue}`,
          "typecheck",
          decl.type.loc
        );
      }

      declaredType = typeValue;
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
    this.typeEnv.define(decl.name, {
      type: finalType,
      comptimeStatus,
      mutable: false,
    });

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
        // If evaluation fails, mark as unavailable
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

    return {
      ...expr,
      type: binding.type,
      comptimeOnly: binding.comptimeStatus === "comptimeOnly",
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
   * Check a function call expression.
   */
  private checkCall(expr: CoreExpr & { kind: "call" }): TypedExpr {
    const fn = this.checkExpr(expr.fn);
    const args = expr.args.map((a) => this.checkExpr(a));

    // Get the function type
    let fnType = fn.type;

    // Unwrap metadata if present
    if (fnType.kind === "withMetadata") {
      fnType = fnType.baseType;
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

    // Check argument count
    const requiredParams = nonRestParams.filter((p) => !p.optional).length;
    if (args.length < requiredParams) {
      throw new CompileError(
        `Expected at least ${requiredParams} arguments, got ${args.length}`,
        "typecheck",
        expr.loc
      );
    }
    // Only check max args if there's no rest parameter
    if (!hasRestParam && args.length > fnType.params.length) {
      throw new CompileError(
        `Expected at most ${fnType.params.length} arguments, got ${args.length}`,
        "typecheck",
        expr.loc
      );
    }

    // Check argument types for non-rest parameters
    for (let i = 0; i < Math.min(args.length, nonRestParams.length); i++) {
      const paramType = nonRestParams[i].type;
      if (!isSubtype(args[i].type, paramType)) {
        throw new CompileError(
          `Argument type '${formatType(args[i].type)}' is not assignable to parameter type '${formatType(paramType)}'`,
          "typecheck",
          expr.args[i].loc
        );
      }
    }

    // Check rest arguments against the rest parameter's element type
    if (restParam && args.length > nonRestParams.length) {
      // Rest param type should be an array type - extract element type
      let restElementType: Type;
      if (restParam.type.kind === "array" && restParam.type.variadic) {
        restElementType = restParam.type.elementTypes[0] ?? primitiveType("Unknown");
      } else {
        // If not an array type, use the type directly (shouldn't happen normally)
        restElementType = restParam.type;
      }

      for (let i = nonRestParams.length; i < args.length; i++) {
        if (!isSubtype(args[i].type, restElementType)) {
          throw new CompileError(
            `Rest argument type '${formatType(args[i].type)}' is not assignable to rest parameter element type '${formatType(restElementType)}'`,
            "typecheck",
            expr.args[i].loc
          );
        }
      }
    }

    const comptimeOnly =
      fn.comptimeOnly || args.some((a) => a.comptimeOnly);

    return {
      ...expr,
      fn,
      args,
      type: fnType.returnType,
      comptimeOnly,
    };
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

      return {
        ...expr,
        object,
        type: primitiveType("Unknown"), // Will be refined by comptime eval
        comptimeOnly: isComptimeOnly,
      };
    }

    // Regular record property access
    let objType = object.type;

    // Unwrap metadata
    if (objType.kind === "withMetadata") {
      objType = objType.baseType;
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

    return {
      ...expr,
      object,
      type: field.type,
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
      elementType = unionType(objType.elementTypes);
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

    // Process parameters
    const paramTypes: ParamInfo[] = [];

    for (let i = 0; i < expr.params.length; i++) {
      const param = expr.params[i];
      let paramType: Type;

      if (param.type) {
        // Explicit type annotation - evaluate it
        const typeValue = this.evaluator.evaluate(
          param.type,
          this.comptimeEnv,
          this.typeEnv
        );
        if (!isTypeValue(typeValue)) {
          throw new CompileError(
            `Parameter type must be a Type`,
            "typecheck",
            param.type.loc
          );
        }
        paramType = typeValue;
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
      childComptimeEnv.defineUnavailable(param.name);
    }

    // Save current environments and use child environments
    const savedTypeEnv = this.typeEnv;
    const savedComptimeEnv = this.comptimeEnv;
    this.typeEnv = childTypeEnv;
    this.comptimeEnv = childComptimeEnv;

    // Check return type annotation if present
    let returnType: Type | undefined;
    if (expr.returnType) {
      const typeValue = this.evaluator.evaluate(
        expr.returnType,
        savedComptimeEnv,
        savedTypeEnv
      );
      if (!isTypeValue(typeValue)) {
        throw new CompileError(
          `Return type must be a Type`,
          "typecheck",
          expr.returnType.loc
        );
      }
      returnType = typeValue;
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

    return {
      ...expr,
      condition,
      then,
      else: else_,
      type: resultType,
      comptimeOnly: condition.comptimeOnly || then.comptimeOnly || else_.comptimeOnly,
    };
  }

  /**
   * Check a record expression.
   */
  private checkRecord(
    expr: CoreExpr & { kind: "record" },
    contextType?: Type
  ): TypedExpr {
    const fields: FieldInfo[] = [];
    const typedFields: typeof expr.fields = [];
    let comptimeOnly = false;

    for (const field of expr.fields) {
      if (field.kind === "spread") {
        const spreadExpr = this.checkExpr(field.expr);
        comptimeOnly = comptimeOnly || spreadExpr.comptimeOnly;

        // Add spread fields
        let spreadType = spreadExpr.type;
        if (spreadType.kind === "withMetadata") {
          spreadType = spreadType.baseType;
        }
        if (spreadType.kind === "record") {
          fields.push(...spreadType.fields);
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

        fields.push({
          name: field.name,
          type: value.type,
          optional: false,
          annotations: [],
        });

        typedFields.push({ kind: "field", name: field.name, value });
      }
    }

    const type = recordType(fields);

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
        elementContextType = unionType(ctx.elementTypes);
        variadic = ctx.variadic;
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
          elementTypes.push(...spreadType.elementTypes);
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

      // Add pattern bindings to environment
      this.addPatternBindings(c.pattern, matchExpr.type);

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
