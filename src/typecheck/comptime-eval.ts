/**
 * Compile-time Evaluator - fuel-limited interpreter for comptime execution.
 *
 * Evaluates expressions at compile time to compute Type values,
 * assert conditions, and other comptime computations.
 *
 * Returns TypedComptimeValue pairs containing both the value and its type.
 * This makes typeOf trivial - just extract the type from the value.
 */

import {
  Type,
  primitiveType,
  literalType,
  recordType,
  arrayType,
  arrayTypeFromElements,
  unionType,
  functionType,
  FieldInfo,
  isVariadicArray,
  getArrayElementTypes,
} from "../types/types";
import { isSubtype } from "../types/subtype";
import { formatType } from "../types/format";
import {
  CoreExpr,
  CoreDecl,
  CoreRecordField,
  CoreArrayElement,
  CoreArgument,
  CoreCase,
  CoreTemplatePart,
  CorePattern,
  BinaryOp,
  UnaryOp,
  CompileError,
  SourceLocation,
} from "../ast/core-ast";
import { TypeEnv } from "./type-env";
import {
  ComptimeEnv,
  TypedComptimeValue,
  RawComptimeValue,
  RawComptimeRecord,
  ComptimeClosure,
  ComptimeBuiltin,
  ComptimeEvaluatorInterface,
  isRawTypeValue,
  isTypeValue,
  isClosureValue,
  isBuiltinValue,
  isRecordValue,
  wrapValue,
  wrapTypeValue,
} from "./comptime-env";
import { getTypeProperty } from "./type-properties";

/**
 * Fuel-limited compile-time evaluator.
 */
export class ComptimeEvaluator implements ComptimeEvaluatorInterface {
  private fuel: number;
  private readonly maxFuel: number;

  constructor(maxFuel: number = 10000) {
    this.maxFuel = maxFuel;
    this.fuel = maxFuel;
  }

  /**
   * Evaluate an expression at compile time.
   * Returns TypedComptimeValue containing both the value and its type.
   */
  evaluate(
    expr: CoreExpr,
    comptimeEnv: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    if (--this.fuel <= 0) {
      throw new CompileError(
        "Compile-time evaluation exceeded fuel limit. " +
          "This may indicate an infinite loop or overly complex computation.",
        "typecheck",
        expr.loc
      );
    }

    switch (expr.kind) {
      case "literal":
        return this.evalLiteral(expr);

      case "identifier":
        return comptimeEnv.getValue(expr.name, this, expr.loc);

      case "binary":
        return this.evalBinary(expr.op, expr.left, expr.right, comptimeEnv, typeEnv, expr.loc);

      case "unary":
        return this.evalUnary(expr.op, expr.operand, comptimeEnv, typeEnv, expr.loc);

      case "call":
        return this.evalCall(expr.fn, expr.args, comptimeEnv, typeEnv, expr.loc);

      case "property":
        return this.evalProperty(expr.object, expr.name, comptimeEnv, typeEnv, expr.loc);

      case "index":
        return this.evalIndex(expr.object, expr.index, comptimeEnv, typeEnv, expr.loc);

      case "lambda":
        return this.evalLambda(expr, comptimeEnv, typeEnv);

      case "conditional":
        return this.evalConditional(
          expr.condition,
          expr.then,
          expr.else,
          comptimeEnv,
          typeEnv
        );

      case "record":
        return this.evalRecord(expr.fields, comptimeEnv, typeEnv);

      case "array":
        return this.evalArray(expr.elements, comptimeEnv, typeEnv);

      case "block":
        return this.evalBlock(expr.statements, expr.result, comptimeEnv, typeEnv);

      case "match":
        return this.evalMatch(expr.expr, expr.cases, comptimeEnv, typeEnv, expr.loc);

      case "throw": {
        const throwVal = this.evaluate(expr.expr, comptimeEnv, typeEnv);
        throw new CompileError(
          `Uncaught exception at compile time: ${throwVal.value}`,
          "typecheck",
          expr.loc
        );
      }

      case "await":
        throw new CompileError(
          "Cannot use 'await' in compile-time evaluation",
          "typecheck",
          expr.loc
        );

      case "template":
        return this.evalTemplate(expr.parts, comptimeEnv, typeEnv);
    }
  }

  /**
   * Evaluate a literal expression.
   */
  private evalLiteral(expr: CoreExpr & { kind: "literal" }): TypedComptimeValue {
    const value = expr.value;
    let type: Type;

    switch (expr.literalKind) {
      case "int":
        type = literalType(value as number, "Int");
        break;
      case "float":
        type = literalType(value as number, "Float");
        break;
      case "string":
        type = literalType(value as string, "String");
        break;
      case "boolean":
        type = literalType(value as boolean, "Boolean");
        break;
      case "null":
        type = primitiveType("Null");
        break;
      case "undefined":
        type = primitiveType("Undefined");
        break;
    }

    return { value, type };
  }

  /**
   * Reset fuel for a new evaluation.
   */
  reset(): void {
    this.fuel = this.maxFuel;
  }

  /**
   * Get remaining fuel.
   */
  getRemainingFuel(): number {
    return this.fuel;
  }

  // ============================================
  // Private evaluation methods
  // ============================================

  private evalBinary(
    op: BinaryOp,
    left: CoreExpr,
    right: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    const l = this.evaluate(left, env, typeEnv);
    const r = this.evaluate(right, env, typeEnv);

    // Type coercion helpers
    const asNum = (v: RawComptimeValue): number => {
      if (typeof v !== "number") {
        throw new CompileError(
          `Expected number in binary operation, got ${typeof v}`,
          "typecheck",
          loc
        );
      }
      return v;
    };

    let resultValue: RawComptimeValue;
    let resultType: Type;

    switch (op) {
      case "+":
        if (typeof l.value === "string" || typeof r.value === "string") {
          resultValue = String(l.value) + String(r.value);
          resultType = primitiveType("String");
        } else {
          resultValue = asNum(l.value) + asNum(r.value);
          // Determine result type based on operand types
          if (isIntType(l.type) && isIntType(r.type)) {
            resultType = primitiveType("Int");
          } else {
            resultType = primitiveType("Number");
          }
        }
        break;
      case "-":
        resultValue = asNum(l.value) - asNum(r.value);
        resultType = isIntType(l.type) && isIntType(r.type) ? primitiveType("Int") : primitiveType("Number");
        break;
      case "*":
        resultValue = asNum(l.value) * asNum(r.value);
        resultType = isIntType(l.type) && isIntType(r.type) ? primitiveType("Int") : primitiveType("Number");
        break;
      case "/":
        resultValue = asNum(l.value) / asNum(r.value);
        resultType = primitiveType("Float"); // Division always returns Float
        break;
      case "%":
        resultValue = asNum(l.value) % asNum(r.value);
        resultType = isIntType(l.type) && isIntType(r.type) ? primitiveType("Int") : primitiveType("Number");
        break;
      case "==":
        resultValue = rawComptimeEquals(l.value, r.value);
        resultType = primitiveType("Boolean");
        break;
      case "!=":
        resultValue = !rawComptimeEquals(l.value, r.value);
        resultType = primitiveType("Boolean");
        break;
      case "<":
        resultValue = asNum(l.value) < asNum(r.value);
        resultType = primitiveType("Boolean");
        break;
      case ">":
        resultValue = asNum(l.value) > asNum(r.value);
        resultType = primitiveType("Boolean");
        break;
      case "<=":
        resultValue = asNum(l.value) <= asNum(r.value);
        resultType = primitiveType("Boolean");
        break;
      case ">=":
        resultValue = asNum(l.value) >= asNum(r.value);
        resultType = primitiveType("Boolean");
        break;
      case "&&":
        // Short-circuit: if l is falsy, return l; else return r
        if (!l.value) {
          return l;
        }
        return r;
      case "||":
        // Short-circuit: if l is truthy, return l; else return r
        if (l.value) {
          return l;
        }
        return r;
      case "|":
        resultValue = asNum(l.value) | asNum(r.value);
        resultType = primitiveType("Int");
        break;
      case "&":
        resultValue = asNum(l.value) & asNum(r.value);
        resultType = primitiveType("Int");
        break;
      case "^":
        resultValue = asNum(l.value) ^ asNum(r.value);
        resultType = primitiveType("Int");
        break;
    }

    return { value: resultValue, type: resultType };
  }

  private evalUnary(
    op: UnaryOp,
    operand: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    const v = this.evaluate(operand, env, typeEnv);

    switch (op) {
      case "!":
        return { value: !v.value, type: primitiveType("Boolean") };
      case "-":
        if (typeof v.value !== "number") {
          throw new CompileError(
            `Cannot negate non-number at compile time`,
            "typecheck",
            loc
          );
        }
        return { value: -v.value, type: v.type }; // Preserve Int/Float/Number
      case "~":
        if (typeof v.value !== "number") {
          throw new CompileError(
            `Cannot bitwise-not non-number at compile time`,
            "typecheck",
            loc
          );
        }
        return { value: ~v.value, type: primitiveType("Int") };
    }
  }

  /**
   * Extract the expression from a CoreArgument.
   */
  private getArgExpr(arg: CoreArgument): CoreExpr {
    return arg.kind === "element" ? arg.value : arg.expr;
  }

  /**
   * Expand CoreArgument[] to evaluated TypedComptimeValue[], handling spreads.
   */
  private expandArgs(
    args: CoreArgument[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue[] {
    const result: TypedComptimeValue[] = [];
    for (const arg of args) {
      const expr = this.getArgExpr(arg);
      const tv = this.evaluate(expr, env, typeEnv);
      if (arg.kind === "spread") {
        // Spread - value should be an array
        if (!Array.isArray(tv.value)) {
          throw new CompileError(
            `Spread argument must be an array`,
            "typecheck",
            loc
          );
        }
        // For spreads, we need to wrap each element with its type from the array type
        const arrType = tv.type;
        const elementTypes = arrType.kind === "array" ? getArrayElementTypes(arrType) : [];
        const variadic = arrType.kind === "array" && isVariadicArray(arrType);
        const elementType = variadic && elementTypes.length > 0 ? elementTypes[0] : undefined;
        const rawElements = tv.value as RawComptimeValue[];
        for (let i = 0; i < rawElements.length; i++) {
          const elemType = arrType.kind === "array" && !variadic && i < elementTypes.length
            ? elementTypes[i]
            : elementType ?? primitiveType("Unknown");
          result.push({ value: rawElements[i], type: elemType });
        }
      } else {
        result.push(tv);
      }
    }
    return result;
  }

  private evalCall(
    fnExpr: CoreExpr,
    args: CoreArgument[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    const fn = this.evaluate(fnExpr, env, typeEnv);

    if (isClosureValue(fn.value)) {
      return this.applyClosure(fn.value, args, env, typeEnv, loc);
    }

    if (isBuiltinValue(fn.value)) {
      const evaluatedArgs = this.expandArgs(args, env, typeEnv, loc);
      return fn.value.impl(evaluatedArgs, this, loc);
    }

    // Special case: Type(Bound) creates a bounded type constraint
    // Type is the primitive type, but can be "called" to create Type<Bound>
    if (
      isTypeValue(fn) &&
      isRawTypeValue(fn.value) &&
      fn.value.kind === "primitive" &&
      fn.value.name === "Type"
    ) {
      if (args.length === 0) {
        // Type() with no args returns unbounded Type
        return fn;
      }
      const firstArg = this.getArgExpr(args[0]);
      const bound = this.evaluate(firstArg, env, typeEnv);
      if (!isTypeValue(bound)) {
        throw new CompileError(
          "Type argument must be a Type",
          "typecheck",
          loc
        );
      }
      // Return a boundedType
      const boundedType: Type = { kind: "boundedType", bound: bound.value as Type };
      return wrapTypeValue(boundedType);
    }

    throw new CompileError(
      `Cannot call non-function at compile time`,
      "typecheck",
      loc
    );
  }

  private applyClosure(
    closure: ComptimeClosure,
    args: CoreArgument[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    // First, expand all arguments (handling spreads)
    const expandedArgs = this.expandArgs(args, env, typeEnv, loc);

    const newEnv = closure.env.extend();
    const newTypeEnv = closure.typeEnv.extend();

    for (let i = 0; i < closure.params.length; i++) {
      const param = closure.params[i];
      let argValue: TypedComptimeValue;

      if (i < expandedArgs.length) {
        argValue = expandedArgs[i];
      } else if (param.defaultValue) {
        argValue = this.evaluate(param.defaultValue, closure.env, closure.typeEnv);
      } else {
        throw new CompileError(
          `Missing argument for parameter '${param.name}'`,
          "typecheck",
          loc
        );
      }

      // Check bounded type constraints (generic constraints)
      // If param has type Type<Bound> and argValue is a Type, check constraint
      if (param.type?.kind === "boundedType" && isRawTypeValue(argValue.value)) {
        const argType = argValue.value as Type;
        if (!isSubtype(argType, param.type.bound)) {
          throw new CompileError(
            `Type '${formatType(argType)}' does not satisfy constraint '${formatType(param.type.bound)}'`,
            "typecheck",
            loc
          );
        }
      }

      newEnv.defineEvaluated(param.name, argValue);
    }

    return this.evaluate(closure.body, newEnv, newTypeEnv);
  }

  /**
   * Call a closure with pre-evaluated arguments.
   * Used by builtins (like array methods) that need to invoke user callbacks.
   */
  applyClosureWithValues(
    closure: ComptimeClosure,
    args: TypedComptimeValue[],
    loc?: SourceLocation
  ): TypedComptimeValue {
    const newEnv = closure.env.extend();
    const newTypeEnv = closure.typeEnv.extend();

    for (let i = 0; i < closure.params.length; i++) {
      const param = closure.params[i];
      let argValue: TypedComptimeValue;

      if (i < args.length) {
        argValue = args[i];
      } else if (param.defaultValue) {
        argValue = this.evaluate(param.defaultValue, closure.env, closure.typeEnv);
      } else {
        throw new CompileError(
          `Missing argument for parameter '${param.name}'`,
          "typecheck",
          loc
        );
      }

      // Check bounded type constraints (generic constraints)
      if (param.type?.kind === "boundedType" && isRawTypeValue(argValue.value)) {
        const argType = argValue.value as Type;
        if (!isSubtype(argType, param.type.bound)) {
          throw new CompileError(
            `Type '${formatType(argType)}' does not satisfy constraint '${formatType(param.type.bound)}'`,
            "typecheck",
            loc
          );
        }
      }

      newEnv.defineEvaluated(param.name, argValue);
    }

    return this.evaluate(closure.body, newEnv, newTypeEnv);
  }

  private evalProperty(
    objectExpr: CoreExpr,
    name: string,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    const obj = this.evaluate(objectExpr, env, typeEnv);

    // Type property access
    if (isTypeValue(obj)) {
      return getTypeProperty(obj.value as Type, name, this, loc);
    }

    // Array properties and methods
    if (Array.isArray(obj.value)) {
      if (name === "length") {
        return { value: obj.value.length, type: primitiveType("Int") };
      }
      const method = getArrayMethod(obj.value, obj.type, name, loc);
      if (method) return method;
    }

    // Record property access
    if (isRecordValue(obj.value)) {
      const value = obj.value[name];
      if (value === undefined && !(name in obj.value)) {
        throw new CompileError(
          `Property '${name}' does not exist`,
          "typecheck",
          loc
        );
      }
      // Get the field type from the object's type
      let fieldType: Type = primitiveType("Unknown");
      if (obj.type.kind === "record") {
        const field = obj.type.fields.find(f => f.name === name);
        if (field) {
          fieldType = field.type;
        } else if (obj.type.indexType) {
          fieldType = obj.type.indexType;
        }
      }
      return { value, type: fieldType };
    }

    // String properties and methods
    if (typeof obj.value === "string") {
      if (name === "length") {
        return { value: obj.value.length, type: primitiveType("Int") };
      }
      const method = getStringMethod(obj.value, name, loc);
      if (method) return method;
    }

    throw new CompileError(
      `Cannot access property '${name}' on ${typeof obj.value} at compile time`,
      "typecheck",
      loc
    );
  }

  private evalIndex(
    objectExpr: CoreExpr,
    indexExpr: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    const obj = this.evaluate(objectExpr, env, typeEnv);
    const index = this.evaluate(indexExpr, env, typeEnv);

    if (Array.isArray(obj.value)) {
      if (typeof index.value !== "number") {
        throw new CompileError(
          `Array index must be a number`,
          "typecheck",
          loc
        );
      }
      const rawValue = obj.value[index.value];
      // Get element type from array type
      let elemType: Type = primitiveType("Unknown");
      if (obj.type.kind === "array") {
        const elementTypes = getArrayElementTypes(obj.type);
        if (isVariadicArray(obj.type)) {
          elemType = elementTypes[0] ?? primitiveType("Unknown");
        } else if (index.value >= 0 && index.value < elementTypes.length) {
          elemType = elementTypes[index.value];
        } else {
          elemType = unionType(elementTypes);
        }
      }
      return { value: rawValue, type: elemType };
    }

    if (typeof obj.value === "string") {
      if (typeof index.value !== "number") {
        throw new CompileError(
          `String index must be a number`,
          "typecheck",
          loc
        );
      }
      return { value: obj.value[index.value], type: primitiveType("String") };
    }

    if (isRecordValue(obj.value)) {
      if (typeof index.value !== "string") {
        throw new CompileError(
          `Record index must be a string`,
          "typecheck",
          loc
        );
      }
      const rawValue = obj.value[index.value];
      let fieldType: Type = primitiveType("Unknown");
      if (obj.type.kind === "record" && obj.type.indexType) {
        fieldType = obj.type.indexType;
      }
      return { value: rawValue, type: fieldType };
    }

    throw new CompileError(
      `Cannot index into ${typeof obj.value} at compile time`,
      "typecheck",
      loc
    );
  }

  private evalLambda(
    expr: CoreExpr & { kind: "lambda" },
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    // Evaluate parameter types
    const params = expr.params.map((p) => ({
      name: p.name,
      // Evaluate type annotation if present to get the Type value (for constraint checking)
      type: p.type ? (this.evaluate(p.type, env, typeEnv).value as Type) : undefined,
      defaultValue: p.defaultValue,
    }));

    // Build the function type from params
    // Note: We don't evaluate the body here, so we can't determine the return type precisely
    // The closure stores the fnType which includes param types but uses Unknown for return
    const paramTypes = params.map((p, i) => ({
      name: p.name,
      type: p.type ?? primitiveType("Unknown"),
      optional: expr.params[i].defaultValue !== undefined,
      rest: expr.params[i].rest,
    }));

    // If there's an explicit return type annotation, evaluate it
    let returnType: Type = primitiveType("Unknown");
    if (expr.returnType) {
      returnType = this.evaluate(expr.returnType, env, typeEnv).value as Type;
    }

    const fnType = functionType(paramTypes, returnType, expr.async);

    const closure: ComptimeClosure = {
      kind: "closure",
      params,
      body: expr.body,
      env,
      typeEnv,
      fnType,
    };

    return { value: closure, type: fnType };
  }

  private evalConditional(
    condition: CoreExpr,
    thenExpr: CoreExpr,
    elseExpr: CoreExpr,
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    const cond = this.evaluate(condition, env, typeEnv);
    return cond.value
      ? this.evaluate(thenExpr, env, typeEnv)
      : this.evaluate(elseExpr, env, typeEnv);
  }

  private evalRecord(
    fields: CoreRecordField[],
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    const result: RawComptimeRecord = {};
    const fieldInfos: FieldInfo[] = [];

    for (const field of fields) {
      if (field.kind === "field") {
        const tv = this.evaluate(field.value, env, typeEnv);
        result[field.name] = tv.value;
        fieldInfos.push({
          name: field.name,
          type: tv.type,
          optional: false,
          annotations: [],
        });
      } else if (field.kind === "spread") {
        const spreadObj = this.evaluate(field.expr, env, typeEnv);
        if (!isRecordValue(spreadObj.value)) {
          throw new CompileError(
            `Cannot spread non-record in compile-time evaluation`,
            "typecheck",
            field.expr.loc
          );
        }
        Object.assign(result, spreadObj.value);
        // Add spread fields to type
        if (spreadObj.type.kind === "record") {
          for (const f of spreadObj.type.fields) {
            fieldInfos.push(f);
          }
        }
      }
    }

    return { value: result, type: recordType(fieldInfos) };
  }

  private evalArray(
    elements: CoreArrayElement[],
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    const rawResult: RawComptimeValue[] = [];
    const elementTypes: Type[] = [];
    let hasSpread = false;

    for (const element of elements) {
      if (element.kind === "element") {
        const tv = this.evaluate(element.value, env, typeEnv);
        rawResult.push(tv.value);
        elementTypes.push(tv.type);
      } else if (element.kind === "spread") {
        const spreadArr = this.evaluate(element.expr, env, typeEnv);
        if (!Array.isArray(spreadArr.value)) {
          throw new CompileError(
            `Cannot spread non-array in compile-time evaluation`,
            "typecheck",
            element.expr.loc
          );
        }
        rawResult.push(...spreadArr.value);
        hasSpread = true;
        // Add element types from spread
        if (spreadArr.type.kind === "array") {
          elementTypes.push(...getArrayElementTypes(spreadArr.type));
        }
      }
    }

    // If there's a spread, the result is variadic
    const resultType = hasSpread
      ? arrayType([unionType(elementTypes)], true)
      : arrayTypeFromElements(elementTypes.map(type => ({ type })));

    return { value: rawResult, type: resultType };
  }

  private evalBlock(
    statements: CoreDecl[],
    result: CoreExpr | undefined,
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    const blockEnv = env.extend();
    const blockTypeEnv = typeEnv.extend();

    for (const stmt of statements) {
      if (stmt.kind === "const") {
        const value = this.evaluate(stmt.init, blockEnv, blockTypeEnv);
        blockEnv.defineEvaluated(stmt.name, value);
      } else if (stmt.kind === "expr") {
        // Execute for side effects
        this.evaluate(stmt.expr, blockEnv, blockTypeEnv);
      }
      // Ignore imports in comptime blocks
    }

    if (result) {
      return this.evaluate(result, blockEnv, blockTypeEnv);
    }

    return { value: undefined, type: primitiveType("Undefined") };
  }

  private evalMatch(
    exprToMatch: CoreExpr,
    cases: CoreCase[],
    env: ComptimeEnv,
    typeEnv: TypeEnv,
    loc: SourceLocation
  ): TypedComptimeValue {
    const value = this.evaluate(exprToMatch, env, typeEnv);

    for (const c of cases) {
      const bindings = matchPattern(c.pattern, value);
      if (bindings !== null) {
        // Check guard if present
        if (c.guard) {
          const guardEnv = env.extend();
          for (const [name, val] of Object.entries(bindings)) {
            guardEnv.defineEvaluated(name, val);
          }
          const guardResult = this.evaluate(c.guard, guardEnv, typeEnv);
          if (!guardResult.value) continue;
        }

        // Pattern matched - evaluate body with bindings
        const bodyEnv = env.extend();
        for (const [name, val] of Object.entries(bindings)) {
          bodyEnv.defineEvaluated(name, val);
        }
        return this.evaluate(c.body, bodyEnv, typeEnv);
      }
    }

    throw new CompileError(
      `No pattern matched in compile-time match expression`,
      "typecheck",
      loc
    );
  }

  private evalTemplate(
    parts: CoreTemplatePart[],
    env: ComptimeEnv,
    typeEnv: TypeEnv
  ): TypedComptimeValue {
    let result = "";

    for (const part of parts) {
      if (part.kind === "string") {
        result += part.value;
      } else {
        const tv = this.evaluate(part.expr, env, typeEnv);
        result += String(tv.value);
      }
    }

    return { value: result, type: primitiveType("String") };
  }
}

// ============================================
// Array method factories
// ============================================

/**
 * Call a callback function (closure or builtin) with typed arguments.
 */
function callCallback(
  fn: TypedComptimeValue,
  args: TypedComptimeValue[],
  evaluator: ComptimeEvaluatorInterface,
  loc?: SourceLocation
): TypedComptimeValue {
  if (isClosureValue(fn.value)) {
    return evaluator.applyClosureWithValues(fn.value, args, loc);
  }
  if (isBuiltinValue(fn.value)) {
    return fn.value.impl(args, evaluator, loc);
  }
  throw new CompileError(
    `Expected function in array method callback, got ${typeof fn.value}`,
    "typecheck",
    loc
  );
}

/**
 * Get an array method as a TypedComptimeValue (wrapping a builtin).
 * The arrType is the type of the array, used to compute element types.
 */
function getArrayMethod(
  arr: RawComptimeValue[],
  arrType: Type,
  name: string,
  loc?: SourceLocation
): TypedComptimeValue | undefined {
  // Get element type from array type
  const elementTypes = arrType.kind === "array" ? getArrayElementTypes(arrType) : [];
  const variadic = arrType.kind === "array" && isVariadicArray(arrType);
  const elementType = arrType.kind === "array"
    ? (variadic ? elementTypes[0] : unionType(elementTypes))
    : primitiveType("Unknown");

  // Helper to wrap raw element with its type
  const wrapElement = (elem: RawComptimeValue, index: number): TypedComptimeValue => {
    const elemType = arrType.kind === "array" && !variadic && index < elementTypes.length
      ? elementTypes[index]
      : elementType;
    return { value: elem, type: elemType };
  };

  // Helper to wrap the raw array for callbacks
  const wrapArray = (): TypedComptimeValue => ({ value: arr, type: arrType });

  switch (name) {
    case "map":
      return wrapBuiltin("Array.map", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.map requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        const results: RawComptimeValue[] = [];
        const resultTypes: Type[] = [];
        for (let i = 0; i < arr.length; i++) {
          const result = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          results.push(result.value);
          resultTypes.push(result.type);
        }
        return { value: results, type: arrayType([unionType(resultTypes)], true) };
      });

    case "filter":
      return wrapBuiltin("Array.filter", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.filter requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        const results: RawComptimeValue[] = [];
        for (let i = 0; i < arr.length; i++) {
          const result = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          if (result.value) {
            results.push(arr[i]);
          }
        }
        return { value: results, type: arrayType([elementType], true) };
      });

    case "includes":
      return wrapBuiltin("Array.includes", (args, _evaluator, _callLoc) => {
        const searchElement = args[0];
        const found = arr.some((element) => rawComptimeEquals(element, searchElement?.value));
        return { value: found, type: primitiveType("Boolean") };
      });

    case "find":
      return wrapBuiltin("Array.find", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.find requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        for (let i = 0; i < arr.length; i++) {
          const result = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          if (result.value) {
            return wrapElement(arr[i], i);
          }
        }
        return { value: undefined, type: unionType([elementType, primitiveType("Undefined")]) };
      });

    case "findIndex":
      return wrapBuiltin("Array.findIndex", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.findIndex requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        for (let i = 0; i < arr.length; i++) {
          const result = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          if (result.value) {
            return { value: i, type: primitiveType("Int") };
          }
        }
        return { value: -1, type: primitiveType("Int") };
      });

    case "some":
      return wrapBuiltin("Array.some", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.some requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        for (let i = 0; i < arr.length; i++) {
          const result = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          if (result.value) {
            return { value: true, type: primitiveType("Boolean") };
          }
        }
        return { value: false, type: primitiveType("Boolean") };
      });

    case "every":
      return wrapBuiltin("Array.every", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.every requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        for (let i = 0; i < arr.length; i++) {
          const result = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          if (!result.value) {
            return { value: false, type: primitiveType("Boolean") };
          }
        }
        return { value: true, type: primitiveType("Boolean") };
      });

    case "reduce":
      return wrapBuiltin("Array.reduce", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.reduce requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        let accumulator: TypedComptimeValue;
        let startIndex: number;
        if (args.length > 1) {
          accumulator = args[1];
          startIndex = 0;
        } else {
          if (arr.length === 0) {
            throw new CompileError(
              "Array.reduce on empty array requires initial value",
              "typecheck",
              callLoc ?? loc
            );
          }
          accumulator = wrapElement(arr[0], 0);
          startIndex = 1;
        }
        for (let i = startIndex; i < arr.length; i++) {
          accumulator = callCallback(
            fn,
            [accumulator, wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
        }
        return accumulator;
      });

    case "concat":
      return wrapBuiltin("Array.concat", (args, _evaluator, _callLoc) => {
        const result: RawComptimeValue[] = [...arr];
        for (const arg of args) {
          if (Array.isArray(arg.value)) {
            result.push(...arg.value);
          } else {
            result.push(arg.value);
          }
        }
        return { value: result, type: arrayType([elementType], true) };
      });

    case "slice":
      return wrapBuiltin("Array.slice", (args, _evaluator, _callLoc) => {
        const start = args[0]?.value as number | undefined;
        const end = args[1]?.value as number | undefined;
        return { value: arr.slice(start, end), type: arrayType([elementType], true) };
      });

    case "indexOf":
      return wrapBuiltin("Array.indexOf", (args, _evaluator, _callLoc) => {
        const searchElement = args[0]?.value;
        const fromIndex = (args[1]?.value as number | undefined) ?? 0;
        for (let i = fromIndex; i < arr.length; i++) {
          if (rawComptimeEquals(arr[i], searchElement)) {
            return { value: i, type: primitiveType("Int") };
          }
        }
        return { value: -1, type: primitiveType("Int") };
      });

    case "join":
      return wrapBuiltin("Array.join", (args, _evaluator, _callLoc) => {
        const separator = (args[0]?.value as string | undefined) ?? ",";
        const result = arr.map((v) => String(v)).join(separator);
        return { value: result, type: primitiveType("String") };
      });

    case "flat":
      return wrapBuiltin("Array.flat", (args, _evaluator, _callLoc) => {
        const depth = (args[0]?.value as number | undefined) ?? 1;
        const flatten = (arr: RawComptimeValue[], d: number): RawComptimeValue[] => {
          if (d <= 0) return arr;
          const result: RawComptimeValue[] = [];
          for (const item of arr) {
            if (Array.isArray(item)) {
              result.push(...flatten(item, d - 1));
            } else {
              result.push(item);
            }
          }
          return result;
        };
        return { value: flatten(arr, depth), type: arrayType([elementType], true) };
      });

    case "flatMap":
      return wrapBuiltin("Array.flatMap", (args, evaluator, callLoc) => {
        const fn = args[0];
        if (fn === undefined) {
          throw new CompileError(
            "Array.flatMap requires a callback function",
            "typecheck",
            callLoc ?? loc
          );
        }
        const results: RawComptimeValue[] = [];
        const resultTypes: Type[] = [];
        for (let i = 0; i < arr.length; i++) {
          const mapped = callCallback(
            fn,
            [wrapElement(arr[i], i), wrapValue(i, primitiveType("Int")), wrapArray()],
            evaluator,
            callLoc ?? loc
          );
          if (Array.isArray(mapped.value)) {
            results.push(...mapped.value);
          } else {
            results.push(mapped.value);
          }
          // Get the inner element type
          if (mapped.type.kind === "array") {
            resultTypes.push(...getArrayElementTypes(mapped.type));
          } else {
            resultTypes.push(mapped.type);
          }
        }
        return { value: results, type: arrayType([unionType(resultTypes)], true) };
      });

    default:
      return undefined;
  }
}

/**
 * Get a string method implementation for compile-time evaluation.
 */
function getStringMethod(
  str: string,
  name: string,
  loc?: SourceLocation
): TypedComptimeValue | undefined {
  switch (name) {
    // Character access
    case "charAt":
      return wrapBuiltin("String.charAt", (args) => {
        const index = args[0]?.value as number ?? 0;
        const char = index >= 0 && index < str.length ? str.charAt(index) : "";
        return { value: char, type: primitiveType("String") };
      });

    case "charCodeAt":
      return wrapBuiltin("String.charCodeAt", (args) => {
        const index = args[0]?.value as number ?? 0;
        const code = str.charCodeAt(index);
        // NaN becomes 0 for simplicity in comptime
        return { value: Number.isNaN(code) ? 0 : code, type: primitiveType("Int") };
      });

    // Substring extraction
    case "substring":
      return wrapBuiltin("String.substring", (args) => {
        const start = args[0]?.value as number ?? 0;
        const end = args[1]?.value as number | undefined;
        return { value: str.substring(start, end), type: primitiveType("String") };
      });

    case "slice":
      return wrapBuiltin("String.slice", (args) => {
        const start = args[0]?.value as number | undefined;
        const end = args[1]?.value as number | undefined;
        return { value: str.slice(start, end), type: primitiveType("String") };
      });

    // Searching
    case "indexOf":
      return wrapBuiltin("String.indexOf", (args) => {
        const searchValue = args[0]?.value as string ?? "";
        const fromIndex = args[1]?.value as number | undefined;
        return { value: str.indexOf(searchValue, fromIndex), type: primitiveType("Int") };
      });

    case "lastIndexOf":
      return wrapBuiltin("String.lastIndexOf", (args) => {
        const searchValue = args[0]?.value as string ?? "";
        const fromIndex = args[1]?.value as number | undefined;
        return { value: str.lastIndexOf(searchValue, fromIndex), type: primitiveType("Int") };
      });

    case "includes":
      return wrapBuiltin("String.includes", (args) => {
        const searchString = args[0]?.value as string ?? "";
        const position = args[1]?.value as number | undefined;
        return { value: str.includes(searchString, position), type: primitiveType("Boolean") };
      });

    case "startsWith":
      return wrapBuiltin("String.startsWith", (args) => {
        const searchString = args[0]?.value as string ?? "";
        const position = args[1]?.value as number | undefined;
        return { value: str.startsWith(searchString, position), type: primitiveType("Boolean") };
      });

    case "endsWith":
      return wrapBuiltin("String.endsWith", (args) => {
        const searchString = args[0]?.value as string ?? "";
        const endPosition = args[1]?.value as number | undefined;
        return { value: str.endsWith(searchString, endPosition), type: primitiveType("Boolean") };
      });

    // Splitting
    case "split":
      return wrapBuiltin("String.split", (args) => {
        const separator = args[0]?.value as string ?? "";
        const limit = args[1]?.value as number | undefined;
        const parts = str.split(separator, limit);
        return { value: parts, type: arrayType([primitiveType("String")], true) };
      });

    // Trimming
    case "trim":
      return wrapBuiltin("String.trim", () => {
        return { value: str.trim(), type: primitiveType("String") };
      });

    case "trimStart":
      return wrapBuiltin("String.trimStart", () => {
        return { value: str.trimStart(), type: primitiveType("String") };
      });

    case "trimEnd":
      return wrapBuiltin("String.trimEnd", () => {
        return { value: str.trimEnd(), type: primitiveType("String") };
      });

    // Case conversion
    case "toUpperCase":
      return wrapBuiltin("String.toUpperCase", () => {
        return { value: str.toUpperCase(), type: primitiveType("String") };
      });

    case "toLowerCase":
      return wrapBuiltin("String.toLowerCase", () => {
        return { value: str.toLowerCase(), type: primitiveType("String") };
      });

    // Replacement
    case "replace":
      return wrapBuiltin("String.replace", (args) => {
        const searchValue = args[0]?.value as string ?? "";
        const replaceValue = args[1]?.value as string ?? "";
        return { value: str.replace(searchValue, replaceValue), type: primitiveType("String") };
      });

    case "replaceAll":
      return wrapBuiltin("String.replaceAll", (args) => {
        const searchValue = args[0]?.value as string ?? "";
        const replaceValue = args[1]?.value as string ?? "";
        return { value: str.replaceAll(searchValue, replaceValue), type: primitiveType("String") };
      });

    // Padding
    case "padStart":
      return wrapBuiltin("String.padStart", (args) => {
        const targetLength = args[0]?.value as number ?? str.length;
        const padString = args[1]?.value as string ?? " ";
        return { value: str.padStart(targetLength, padString), type: primitiveType("String") };
      });

    case "padEnd":
      return wrapBuiltin("String.padEnd", (args) => {
        const targetLength = args[0]?.value as number ?? str.length;
        const padString = args[1]?.value as string ?? " ";
        return { value: str.padEnd(targetLength, padString), type: primitiveType("String") };
      });

    // Repetition
    case "repeat":
      return wrapBuiltin("String.repeat", (args) => {
        const count = args[0]?.value as number ?? 0;
        return { value: str.repeat(Math.max(0, count)), type: primitiveType("String") };
      });

    // Concatenation
    case "concat":
      return wrapBuiltin("String.concat", (args) => {
        let result = str;
        for (const arg of args) {
          result += String(arg.value);
        }
        return { value: result, type: primitiveType("String") };
      });

    default:
      return undefined;
  }
}

/**
 * Helper to wrap a builtin implementation as a TypedComptimeValue.
 */
function wrapBuiltin(
  name: string,
  impl: (args: TypedComptimeValue[], evaluator: ComptimeEvaluatorInterface, loc?: SourceLocation) => TypedComptimeValue
): TypedComptimeValue {
  const builtin: ComptimeBuiltin = { kind: "builtin", name, impl };
  // Builtins have a function type, but we use Unknown for now
  return { value: builtin, type: primitiveType("Unknown") };
}

/**
 * Check equality of raw comptime values.
 */
export function rawComptimeEquals(a: RawComptimeValue, b: RawComptimeValue): boolean {
  // Primitives
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => rawComptimeEquals(v, b[i]));
  }

  // Records (plain objects)
  if (isRecordValue(a) && isRecordValue(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => rawComptimeEquals(a[k], b[k]));
  }

  // Types
  if (isRawTypeValue(a) && isRawTypeValue(b)) {
    // Use structural equality from subtype module
    // For now, simple comparison
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

/**
 * Check if a type is Int or a literal Int.
 */
function isIntType(type: Type): boolean {
  if (type.kind === "primitive" && type.name === "Int") return true;
  if (type.kind === "literal" && type.baseType === "Int") return true;
  return false;
}

/**
 * Match a pattern against a typed value, returning typed bindings or null if no match.
 */
function matchPattern(
  pattern: CorePattern,
  tv: TypedComptimeValue
): Record<string, TypedComptimeValue> | null {
  switch (pattern.kind) {
    case "wildcard":
      return {};

    case "literal":
      if (rawComptimeEquals(tv.value, pattern.value as RawComptimeValue)) {
        return {};
      }
      return null;

    case "binding": {
      if (pattern.pattern) {
        const nestedBindings = matchPattern(pattern.pattern, tv);
        if (nestedBindings === null) return null;
        return { [pattern.name]: tv, ...nestedBindings };
      }
      return { [pattern.name]: tv };
    }

    case "destructure": {
      if (!isRecordValue(tv.value)) return null;
      const bindings: Record<string, TypedComptimeValue> = {};

      for (const field of pattern.fields) {
        const fieldValue = tv.value[field.name];
        if (fieldValue === undefined && !(field.name in tv.value)) {
          return null;
        }

        // Get field type from the record type
        let fieldType: Type = primitiveType("Unknown");
        if (tv.type.kind === "record") {
          const fieldInfo = tv.type.fields.find(f => f.name === field.name);
          if (fieldInfo) {
            fieldType = fieldInfo.type;
          }
        }

        const fieldTV: TypedComptimeValue = { value: fieldValue, type: fieldType };

        if (field.pattern) {
          const nestedBindings = matchPattern(field.pattern, fieldTV);
          if (nestedBindings === null) return null;
          Object.assign(bindings, nestedBindings);
        } else {
          const bindName = field.binding ?? field.name;
          bindings[bindName] = fieldTV;
        }
      }

      return bindings;
    }

    case "type":
      // Type patterns need type information - handled by type checker
      // For comptime eval, we can't easily check this
      return null;
  }
}
