/**
 * Erasure - removes compile-time-only code from TypedAST.
 *
 * The erasure phase transforms TypedAST to RuntimeAST (which is structurally
 * the same as CoreAST, just without comptime-only nodes).
 *
 * What gets erased:
 * - Type values (bindings whose value is Type)
 * - Type parameters (trailing Type arguments in calls/lambdas)
 * - Assert statements (already evaluated at compile time)
 * - Comptime bindings not used at runtime
 * - Type annotations on parameters/returns
 * - Comptime-only property access (inlined)
 *
 * What gets preserved:
 * - Runtime values
 * - Runtime-extracted type info (.name, .fieldNames → inlined)
 * - Function bodies (minus type params)
 * - Pattern matching
 * - Async/await
 */

import {
  CoreExpr,
  CoreDecl,
  CoreParam,
  CoreCase,
  CoreRecordField,
  CoreArrayElement,
  CoreArgument,
  CoreTemplatePart,
  CorePattern,
  SourceLocation,
  TypedExpr,
  TypedDecl,
  TypedProgram,
  TypedArgument,
  LiteralKind,
  dummyLoc,
} from "../ast/core-ast";
import { Type, isTypeType } from "../types/types";

// ============================================
// Main Entry Point
// ============================================

export type RuntimeProgram = {
  decls: CoreDecl[];
};

/**
 * Erase comptime-only code from a typed program.
 */
export function erase(program: TypedProgram): RuntimeProgram {
  const decls: CoreDecl[] = [];

  for (const decl of program.decls) {
    const erased = eraseDecl(decl);
    if (erased) {
      decls.push(erased);
    }
  }

  return { decls };
}

// ============================================
// Declaration Erasure
// ============================================

/**
 * Erase a single declaration.
 * Returns null if the declaration should be removed entirely.
 */
function eraseDecl(decl: TypedDecl): CoreDecl | null {
  // Skip comptime-only declarations entirely
  if (decl.comptimeOnly) {
    return null;
  }

  switch (decl.kind) {
    case "const": {
      const init = eraseExpr(decl.init);
      return {
        kind: "const",
        name: decl.name,
        // Note: type annotation removed
        init,
        comptime: false, // No longer comptime after erasure
        exported: decl.exported,
        loc: decl.loc,
      };
    }

    case "import":
      // Imports are preserved as-is (they're runtime)
      return decl;

    case "expr": {
      // Expression statements - check if comptime-only
      const expr = decl.expr as TypedExpr;
      if (expr.comptimeOnly) {
        // e.g., assert(...) - already evaluated, remove
        return null;
      }
      return {
        kind: "expr",
        expr: eraseExpr(expr),
        loc: decl.loc,
      };
    }
  }
}

// ============================================
// Expression Erasure
// ============================================

/**
 * Erase comptime-only parts from an expression.
 */
function eraseExpr(expr: TypedExpr): CoreExpr {
  // If this expression was evaluated at comptime and has a
  // runtime-usable value, inline it
  if (expr.comptimeValue !== undefined && isRuntimeUsable(expr.type)) {
    return inlineValue(expr.comptimeValue, expr.loc);
  }

  switch (expr.kind) {
    case "identifier":
      return {
        kind: "identifier",
        name: expr.name,
        loc: expr.loc,
      };

    case "literal":
      return {
        kind: "literal",
        value: expr.value,
        literalKind: expr.literalKind,
        loc: expr.loc,
      };

    case "binary":
      return {
        kind: "binary",
        op: expr.op,
        left: eraseExpr(expr.left as TypedExpr),
        right: eraseExpr(expr.right as TypedExpr),
        loc: expr.loc,
      };

    case "unary":
      return {
        kind: "unary",
        op: expr.op,
        operand: eraseExpr(expr.operand as TypedExpr),
        loc: expr.loc,
      };

    case "call":
      return eraseCall(expr);

    case "property":
      return eraseProperty(expr);

    case "index":
      return {
        kind: "index",
        object: eraseExpr(expr.object as TypedExpr),
        index: eraseExpr(expr.index as TypedExpr),
        loc: expr.loc,
      };

    case "lambda":
      return eraseLambda(expr);

    case "match":
      return {
        kind: "match",
        expr: eraseExpr(expr.expr as TypedExpr),
        cases: expr.cases.map(eraseCase),
        loc: expr.loc,
      };

    case "conditional": {
      // If the condition was evaluated at comptime, we can eliminate the branch
      const condExpr = expr.condition as TypedExpr;
      if (condExpr.comptimeValue !== undefined) {
        // Branch elimination - only keep the taken branch
        if (condExpr.comptimeValue) {
          return eraseExpr(expr.then as TypedExpr);
        } else {
          return eraseExpr(expr.else as TypedExpr);
        }
      }
      return {
        kind: "conditional",
        condition: eraseExpr(condExpr),
        then: eraseExpr(expr.then as TypedExpr),
        else: eraseExpr(expr.else as TypedExpr),
        loc: expr.loc,
      };
    }

    case "record":
      return {
        kind: "record",
        fields: expr.fields.map(eraseRecordField),
        loc: expr.loc,
      };

    case "array":
      return {
        kind: "array",
        elements: expr.elements.map(eraseArrayElement),
        loc: expr.loc,
      };

    case "await":
      return {
        kind: "await",
        expr: eraseExpr(expr.expr as TypedExpr),
        loc: expr.loc,
      };

    case "throw":
      return {
        kind: "throw",
        expr: eraseExpr(expr.expr as TypedExpr),
        loc: expr.loc,
      };

    case "template":
      return {
        kind: "template",
        parts: expr.parts.map(eraseTemplatePart),
        loc: expr.loc,
      };

    case "block": {
      const statements = (expr.statements as TypedDecl[])
        .map(eraseDecl)
        .filter((s): s is CoreDecl => s !== null);
      return {
        kind: "block",
        statements,
        result: expr.result ? eraseExpr(expr.result as TypedExpr) : undefined,
        loc: expr.loc,
      };
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = expr;
      throw new Error(`Unknown expression kind: ${(expr as any).kind}`);
    }
  }
}

// ============================================
// Call Erasure
// ============================================

/**
 * Erase a function call, removing Type arguments.
 */
function eraseCall(expr: TypedExpr & { kind: "call" }): CoreExpr {
  const fn = eraseExpr(expr.fn as TypedExpr);

  // Filter out Type arguments
  // The args are TypedArgument[] at runtime (cast from CoreArgument[])
  const typedArgs = expr.args as TypedArgument[];
  const args: CoreArgument[] = [];

  for (const arg of typedArgs) {
    if (arg.kind === "spread") {
      const spreadExpr = arg.expr as TypedExpr;
      if (!isTypeValue(spreadExpr.type)) {
        args.push({
          kind: "spread",
          expr: eraseExpr(spreadExpr),
        });
      }
    } else {
      const valueExpr = arg.value as TypedExpr;
      if (!isTypeValue(valueExpr.type)) {
        args.push({
          kind: "element",
          value: eraseExpr(valueExpr),
        });
      }
    }
  }

  return {
    kind: "call",
    fn,
    args,
    loc: expr.loc,
  };
}

// ============================================
// Lambda Erasure
// ============================================

/**
 * Erase a lambda, removing Type parameters and type annotations.
 */
function eraseLambda(expr: TypedExpr & { kind: "lambda" }): CoreExpr {
  // Filter out Type parameters
  const params: CoreParam[] = [];

  for (const param of expr.params) {
    // Skip parameters whose type is Type (type parameters)
    if (param.type) {
      // The type annotation is a CoreExpr, but we need to check if this
      // parameter represents a Type parameter. We check the TypedExpr's
      // resolved type information.
      // For now, we use a heuristic: if the parameter name starts with
      // uppercase and has no default value, it might be a type param.
      // But more accurately, we should track this during type checking.

      // Actually, we need to check the parameter's *value* type, not the annotation.
      // During desugaring, type params become regular params with Type type.
      // The type checker should have annotated these params.

      // For a proper implementation, we'd need the TypedParam to carry the
      // resolved type. For now, we'll check if the default value is a typeOf call
      // or if the parameter type annotation evaluates to Type.

      // Simplified approach: check if this looks like a type parameter pattern
      // (has a default value that's a typeOf call)
      if (
        param.defaultValue &&
        param.defaultValue.kind === "call" &&
        (param.defaultValue.fn as CoreExpr).kind === "identifier" &&
        ((param.defaultValue.fn as CoreExpr & { kind: "identifier" }).name === "typeOf")
      ) {
        // This is a type parameter - skip it
        continue;
      }
    }

    // Keep the parameter but remove type annotation
    params.push({
      name: param.name,
      defaultValue: param.defaultValue
        ? eraseExpr(param.defaultValue as TypedExpr)
        : undefined,
      annotations: [], // Remove annotations
      rest: param.rest,
    });
  }

  return {
    kind: "lambda",
    params,
    body: eraseExpr(expr.body as TypedExpr),
    // Note: returnType removed
    async: expr.async,
    loc: expr.loc,
  };
}

// ============================================
// Property Access Erasure
// ============================================

/**
 * Erase property access, handling comptime-evaluated properties.
 */
function eraseProperty(expr: TypedExpr & { kind: "property" }): CoreExpr {
  // If this was a comptime property access on a Type, it's been evaluated
  if (expr.comptimeValue !== undefined && isRuntimeUsable(expr.type)) {
    return inlineValue(expr.comptimeValue, expr.loc);
  }

  // Otherwise, preserve the property access
  return {
    kind: "property",
    object: eraseExpr(expr.object as TypedExpr),
    name: expr.name,
    loc: expr.loc,
  };
}

// ============================================
// Helper Erasure Functions
// ============================================

function eraseCase(c: CoreCase): CoreCase {
  return {
    pattern: erasePattern(c.pattern),
    guard: c.guard ? eraseExpr(c.guard as TypedExpr) : undefined,
    body: eraseExpr(c.body as TypedExpr),
    loc: c.loc,
  };
}

function erasePattern(pattern: CorePattern): CorePattern {
  switch (pattern.kind) {
    case "wildcard":
    case "literal":
      return pattern;

    case "type":
      // Type patterns are checked at compile time; at runtime they
      // become runtime checks based on the type's discriminant
      // For now, preserve the pattern (codegen will handle it)
      return {
        kind: "type",
        typeExpr: eraseExpr(pattern.typeExpr as TypedExpr),
        loc: pattern.loc,
      };

    case "binding":
      return {
        kind: "binding",
        name: pattern.name,
        pattern: pattern.pattern ? erasePattern(pattern.pattern) : undefined,
        loc: pattern.loc,
      };

    case "destructure":
      return {
        kind: "destructure",
        fields: pattern.fields.map((f) => ({
          name: f.name,
          binding: f.binding,
          pattern: f.pattern ? erasePattern(f.pattern) : undefined,
        })),
        loc: pattern.loc,
      };
  }
}

function eraseRecordField(field: CoreRecordField): CoreRecordField {
  if (field.kind === "spread") {
    return {
      kind: "spread",
      expr: eraseExpr(field.expr as TypedExpr),
    };
  }
  return {
    kind: "field",
    name: field.name,
    value: eraseExpr(field.value as TypedExpr),
  };
}

function eraseArrayElement(element: CoreArrayElement): CoreArrayElement {
  if (element.kind === "spread") {
    return {
      kind: "spread",
      expr: eraseExpr(element.expr as TypedExpr),
    };
  }
  return {
    kind: "element",
    value: eraseExpr(element.value as TypedExpr),
  };
}

function eraseTemplatePart(part: CoreTemplatePart): CoreTemplatePart {
  if (part.kind === "string") {
    return part;
  }
  return {
    kind: "expr",
    expr: eraseExpr(part.expr as TypedExpr),
  };
}

// ============================================
// Value Inlining
// ============================================

/**
 * Convert a compile-time value to an AST node.
 */
function inlineValue(value: unknown, loc: SourceLocation): CoreExpr {
  if (value === null) {
    return { kind: "literal", value: null, literalKind: "null", loc };
  }
  if (value === undefined) {
    return { kind: "literal", value: undefined, literalKind: "undefined", loc };
  }
  if (typeof value === "boolean") {
    return { kind: "literal", value, literalKind: "boolean", loc };
  }
  if (typeof value === "number") {
    const literalKind: LiteralKind = Number.isInteger(value) ? "int" : "float";
    return { kind: "literal", value, literalKind, loc };
  }
  if (typeof value === "string") {
    return { kind: "literal", value, literalKind: "string", loc };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      elements: value.map((v) => ({
        kind: "element" as const,
        value: inlineValue(v, loc),
      })),
      loc,
    };
  }
  if (typeof value === "object") {
    return {
      kind: "record",
      fields: Object.entries(value).map(([name, v]) => ({
        kind: "field" as const,
        name,
        value: inlineValue(v, loc),
      })),
      loc,
    };
  }

  // Functions and other values cannot be inlined
  throw new Error(`Cannot inline value of type ${typeof value}`);
}

// ============================================
// Runtime Usability Checking
// ============================================

/**
 * Determine if a type can exist at runtime.
 */
function isRuntimeUsable(type: Type): boolean {
  switch (type.kind) {
    case "primitive":
      // Type and Void have no runtime representation
      return type.name !== "Type" && type.name !== "Void";

    case "literal":
      return true;

    case "record":
      // Runtime usable if all fields are runtime usable
      return type.fields.every((f) => isRuntimeUsable(f.type));

    case "array":
      return type.elements.every((e) => isRuntimeUsable(e.type));

    case "function":
      // Functions are runtime usable if params and return are
      return (
        type.params.every((p) => isRuntimeUsable(p.type)) &&
        isRuntimeUsable(type.returnType)
      );

    case "union":
      return type.types.every((t) => isRuntimeUsable(t));

    case "intersection":
      return type.types.every((t) => isRuntimeUsable(t));

    case "branded":
      return isRuntimeUsable(type.baseType);

    case "typeVar":
      // Type variables themselves aren't runtime usable
      // (they represent Type values)
      return false;

    case "this":
      // Resolved during type checking, should be concrete by now
      return true;

    case "withMetadata":
      return isRuntimeUsable(type.baseType);

    case "boundedType":
      // Type<Bound> is a meta-type, not runtime usable
      return false;

    case "keyof":
      // keyof types are comptime-only (they return Type values)
      return false;

    case "indexedAccess":
      // Indexed access types are comptime-only (they return Type values)
      return false;

    case "mapped":
      // Mapped types are comptime-only (used for type transformations)
      return false;
  }
}

/**
 * Check if a type is a Type value (comptime-only).
 */
function isTypeValue(type: Type): boolean {
  // Note: typeVar is NOT comptime-only - it represents a type parameter that gets
  // instantiated at call sites. Values of type T exist at runtime.
  // boundedType (Type<Bound>) IS comptime-only as it's a constraint on types.
  return isTypeType(type) || type.kind === "boundedType";
}