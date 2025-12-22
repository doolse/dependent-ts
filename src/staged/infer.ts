/**
 * Type inference context and constraint-based type inference.
 *
 * The inference algorithm works in two phases:
 * 1. Constraint generation: Walk the AST, create type variables for unknowns,
 *    and collect constraints between types.
 * 2. Constraint solving: Use unification to solve constraints and produce
 *    a substitution mapping type variables to concrete types.
 */

import { TypeValue, TypeVariable, typeVar, functionType, numberType, stringType, boolType, objectType, typeToString, ObjectField, TypeScheme, monoScheme, polyScheme } from "./types";
import { Substitution, emptySubst, unify, applySubst, UnifyResult } from "./unify";
import { Expr } from "./expr";
import { Env, SValue, isNow } from "./svalue";

/**
 * A constraint between types that must be satisfied.
 */
export type Constraint =
  | { kind: "equals"; left: TypeValue; right: TypeValue; source?: string }
  | { kind: "has_field"; objType: TypeValue; field: string; fieldType: TypeValue; source?: string };

/**
 * Type environment for inference - maps variable names to type schemes.
 * Using schemes allows polymorphic let bindings.
 */
export type TypeEnv = Map<string, TypeScheme>;

/**
 * Inference context - tracks state during type inference.
 */
export interface InferenceContext {
  /** Counter for generating fresh type variables */
  nextVarId: number;

  /** Collected constraints to be solved */
  constraints: Constraint[];

  /** Type environment - maps variable names to types */
  typeEnv: TypeEnv;

  /** Current substitution (updated during solving) */
  substitution: Substitution;
}

/**
 * Create a fresh inference context.
 */
export function emptyInferenceContext(): InferenceContext {
  return {
    nextVarId: 0,
    constraints: [],
    typeEnv: new Map(),
    substitution: emptySubst(),
  };
}

/**
 * Create a fresh type variable in the context.
 */
export function freshTypeVar(ctx: InferenceContext, name?: string): TypeVariable {
  const id = ctx.nextVarId++;
  return { tag: "typevar", id, name: name ?? `T${id}` };
}

/**
 * Add a constraint that two types must be equal.
 */
export function addEqualityConstraint(
  ctx: InferenceContext,
  left: TypeValue,
  right: TypeValue,
  source?: string
): void {
  ctx.constraints.push({ kind: "equals", left, right, source });
}

/**
 * Add a constraint that an object type must have a field.
 */
export function addFieldConstraint(
  ctx: InferenceContext,
  objType: TypeValue,
  field: string,
  fieldType: TypeValue,
  source?: string
): void {
  ctx.constraints.push({ kind: "has_field", objType, field, fieldType, source });
}

/**
 * Extend the type environment with a new binding (monomorphic).
 */
export function extendTypeEnv(ctx: InferenceContext, name: string, type: TypeValue): InferenceContext {
  const newEnv = new Map(ctx.typeEnv);
  newEnv.set(name, monoScheme(type));
  return { ...ctx, typeEnv: newEnv };
}

/**
 * Extend the type environment with a type scheme (polymorphic).
 */
export function extendTypeEnvWithScheme(ctx: InferenceContext, name: string, scheme: TypeScheme): InferenceContext {
  const newEnv = new Map(ctx.typeEnv);
  newEnv.set(name, scheme);
  return { ...ctx, typeEnv: newEnv };
}

/**
 * Look up a variable's type scheme in the environment.
 */
export function lookupScheme(ctx: InferenceContext, name: string): TypeScheme | undefined {
  return ctx.typeEnv.get(name);
}

/**
 * Collect all free type variable IDs in a type.
 */
export function freeTypeVars(t: TypeValue): Set<number> {
  switch (t.tag) {
    case "typevar":
      return new Set([t.id]);
    case "primitive":
    case "literal":
    case "metatype":
      return new Set();
    case "array":
      return freeTypeVars(t.element);
    case "function": {
      const result = new Set<number>();
      for (const p of t.params) {
        for (const id of freeTypeVars(p)) result.add(id);
      }
      for (const id of freeTypeVars(t.returnType)) result.add(id);
      return result;
    }
    case "object": {
      const result = new Set<number>();
      for (const f of t.fields) {
        for (const id of freeTypeVars(f.type)) result.add(id);
      }
      return result;
    }
  }
}

/**
 * Collect free type variables in a type scheme.
 * A variable is free in a scheme if it's free in the type but not quantified.
 */
export function freeTypeVarsInScheme(scheme: TypeScheme): Set<number> {
  const free = freeTypeVars(scheme.type);
  for (const id of scheme.quantified) {
    free.delete(id);
  }
  return free;
}

/**
 * Collect free type variables in a type environment.
 */
export function freeTypeVarsInEnv(env: TypeEnv): Set<number> {
  const result = new Set<number>();
  for (const scheme of env.values()) {
    for (const id of freeTypeVarsInScheme(scheme)) {
      result.add(id);
    }
  }
  return result;
}

/**
 * Generalize a type to a type scheme by quantifying over free type variables
 * that are not free in the environment.
 */
export function generalize(t: TypeValue, env: TypeEnv, subst: Substitution): TypeScheme {
  // Apply current substitution to get most specific type
  const resolved = applySubst(t, subst);

  // Find free vars in the type
  const freeInType = freeTypeVars(resolved);

  // Find free vars in the environment (also apply subst)
  const freeInEnv = new Set<number>();
  for (const scheme of env.values()) {
    const resolvedScheme = applySubst(scheme.type, subst);
    for (const id of freeTypeVars(resolvedScheme)) {
      if (!scheme.quantified.includes(id)) {
        freeInEnv.add(id);
      }
    }
  }

  // Quantify over vars that are free in type but not in env
  const quantified: number[] = [];
  for (const id of freeInType) {
    if (!freeInEnv.has(id)) {
      quantified.push(id);
    }
  }

  if (quantified.length === 0) {
    return monoScheme(resolved);
  }

  return polyScheme(quantified, resolved);
}

/**
 * Instantiate a type scheme by replacing quantified variables with fresh ones.
 */
export function instantiate(scheme: TypeScheme, ctx: InferenceContext): TypeValue {
  if (scheme.quantified.length === 0) {
    return scheme.type;
  }

  // Create fresh type variables for each quantified variable
  const freshVars = new Map<number, TypeVariable>();
  for (const id of scheme.quantified) {
    freshVars.set(id, freshTypeVar(ctx));
  }

  // Substitute quantified vars with fresh vars
  return substituteTypeVars(scheme.type, freshVars);
}

/**
 * Substitute type variables according to a mapping.
 */
function substituteTypeVars(t: TypeValue, mapping: Map<number, TypeVariable>): TypeValue {
  switch (t.tag) {
    case "typevar": {
      const replacement = mapping.get(t.id);
      return replacement ?? t;
    }
    case "primitive":
    case "literal":
    case "metatype":
      return t;
    case "array":
      return { tag: "array", element: substituteTypeVars(t.element, mapping) };
    case "function":
      return {
        tag: "function",
        params: t.params.map(p => substituteTypeVars(p, mapping)),
        returnType: substituteTypeVars(t.returnType, mapping),
      };
    case "object":
      return {
        tag: "object",
        fields: t.fields.map(f => ({
          ...f,
          type: substituteTypeVars(f.type, mapping),
        })),
      };
  }
}

/**
 * Look up a variable's type in the environment, instantiating if polymorphic.
 */
export function lookupType(ctx: InferenceContext, name: string): TypeValue | undefined {
  const scheme = ctx.typeEnv.get(name);
  if (!scheme) return undefined;
  return instantiate(scheme, ctx);
}

/**
 * Result of type inference.
 */
export type InferResult =
  | { success: true; type: TypeValue; substitution: Substitution }
  | { success: false; error: string };

/**
 * Infer the type of an expression, collecting constraints.
 * Returns the (possibly polymorphic) type before constraint solving.
 */
export function inferType(expr: Expr, ctx: InferenceContext): TypeValue {
  switch (expr.tag) {
    case "literal": {
      const v = expr.value;
      if (typeof v === "number") return numberType;
      if (typeof v === "string") return stringType;
      if (typeof v === "boolean") return boolType;
      throw new Error(`Unknown literal type: ${typeof v}`);
    }

    case "variable": {
      const t = lookupType(ctx, expr.name);
      if (!t) {
        throw new Error(`Unbound variable: ${expr.name}`);
      }
      return t;
    }

    case "binary_op": {
      const leftType = inferType(expr.left, ctx);
      const rightType = inferType(expr.right, ctx);

      switch (expr.op) {
        case "+": {
          // + works on numbers or strings
          // For now, assume number and add constraint
          addEqualityConstraint(ctx, leftType, numberType, `left of +`);
          addEqualityConstraint(ctx, rightType, numberType, `right of +`);
          return numberType;
        }
        case "-":
        case "*":
        case "/": {
          addEqualityConstraint(ctx, leftType, numberType, `left of ${expr.op}`);
          addEqualityConstraint(ctx, rightType, numberType, `right of ${expr.op}`);
          return numberType;
        }
        case "==":
        case "!=":
        case "<":
        case ">":
        case "<=":
        case ">=": {
          // Comparison operators - operands should be same type
          addEqualityConstraint(ctx, leftType, rightType, `comparison ${expr.op}`);
          return boolType;
        }
        case "&&":
        case "||": {
          addEqualityConstraint(ctx, leftType, boolType, `left of ${expr.op}`);
          addEqualityConstraint(ctx, rightType, boolType, `right of ${expr.op}`);
          return boolType;
        }
        default:
          throw new Error(`Unknown binary operator: ${expr.op}`);
      }
    }

    case "if": {
      const condType = inferType(expr.condition, ctx);
      addEqualityConstraint(ctx, condType, boolType, "if condition");

      const thenType = inferType(expr.thenBranch, ctx);
      const elseType = inferType(expr.elseBranch, ctx);

      // Both branches must have same type
      addEqualityConstraint(ctx, thenType, elseType, "if branches");
      return thenType;
    }

    case "object": {
      const fields: ObjectField[] = expr.fields.map((f) => ({
        name: f.name,
        type: inferType(f.value, ctx),
      }));
      return objectType(fields);
    }

    case "field_access": {
      const objType = inferType(expr.object, ctx);
      const fieldType = freshTypeVar(ctx, `${expr.field}Type`);

      // Add constraint: objType must have this field with fieldType
      addFieldConstraint(ctx, objType, expr.field, fieldType, `field access .${expr.field}`);

      return fieldType;
    }

    case "call": {
      const funcType = inferType(expr.func, ctx);
      const argTypes = expr.args.map((a) => inferType(a, ctx));
      const returnType = freshTypeVar(ctx, "Return");

      // Constraint: funcType must be a function from argTypes to returnType
      const expectedFnType = functionType(argTypes, returnType);
      addEqualityConstraint(ctx, funcType, expectedFnType, "function call");

      return returnType;
    }

    case "lambda": {
      // Create fresh type variables for each parameter
      const paramTypes = expr.params.map((p) => freshTypeVar(ctx, p));

      // Extend environment with parameter types
      let bodyCtx = ctx;
      for (let i = 0; i < expr.params.length; i++) {
        bodyCtx = extendTypeEnv(bodyCtx, expr.params[i], paramTypes[i]);
      }

      // Infer body type in extended environment
      const bodyType = inferType(expr.body, bodyCtx);

      return functionType(paramTypes, bodyType);
    }

    case "let": {
      // Infer the type of the bound value
      const valueType = inferType(expr.value, ctx);

      // Solve constraints collected so far to get most specific type
      const solveResult = solveConstraints(ctx);
      if (!solveResult.success) {
        throw new Error(solveResult.error);
      }

      // Update the context's substitution
      ctx.substitution = solveResult.subst;

      // Generalize: quantify over type vars free in valueType but not in env
      const scheme = generalize(valueType, ctx.typeEnv, ctx.substitution);

      // Extend environment with the generalized scheme
      const bodyCtx = extendTypeEnvWithScheme(ctx, expr.name, scheme);
      return inferType(expr.body, bodyCtx);
    }

    case "reflect":
    case "type_op":
      // Reflection operations return metatype or specific types
      // For now, return a fresh type var
      return freshTypeVar(ctx, "Reflect");

    default:
      throw new Error(`Cannot infer type for: ${(expr as any).tag}`);
  }
}

/**
 * Solve collected constraints using unification.
 */
export function solveConstraints(ctx: InferenceContext): UnifyResult {
  let subst = ctx.substitution;

  for (const constraint of ctx.constraints) {
    switch (constraint.kind) {
      case "equals": {
        const result = unify(constraint.left, constraint.right, subst);
        if (!result.success) {
          return {
            success: false,
            error: `${result.error}${constraint.source ? ` (at ${constraint.source})` : ""}`,
          };
        }
        subst = result.subst;
        break;
      }

      case "has_field": {
        // Apply current substitution to get concrete type
        const objType = applySubst(constraint.objType, subst);

        if (objType.tag === "typevar") {
          // Object type is still unknown - can't verify field yet
          // In a full system, we'd defer this constraint
          // For now, we'll assume it's valid and continue
          break;
        }

        if (objType.tag !== "object") {
          return {
            success: false,
            error: `Cannot access field '${constraint.field}' on non-object type ${typeToString(objType)}`,
          };
        }

        const field = objType.fields.find((f) => f.name === constraint.field);
        if (!field) {
          return {
            success: false,
            error: `Object type ${typeToString(objType)} has no field '${constraint.field}'`,
          };
        }

        // Unify expected field type with actual field type
        const result = unify(constraint.fieldType, field.type, subst);
        if (!result.success) {
          return result;
        }
        subst = result.subst;
        break;
      }
    }
  }

  return { success: true, subst };
}

/**
 * Perform full type inference on an expression.
 *
 * 1. Creates fresh type variables for unknowns
 * 2. Collects constraints
 * 3. Solves constraints
 * 4. Returns the resolved type
 */
export function infer(expr: Expr, initialEnv?: TypeEnv): InferResult {
  const ctx = emptyInferenceContext();
  if (initialEnv) {
    for (const [name, scheme] of initialEnv) {
      ctx.typeEnv.set(name, scheme);
    }
  }

  try {
    // Phase 1: Collect constraints and get initial type
    const rawType = inferType(expr, ctx);

    // Phase 2: Solve constraints
    const result = solveConstraints(ctx);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Phase 3: Apply substitution to get final type
    const finalType = applySubst(rawType, result.subst);

    return { success: true, type: finalType, substitution: result.subst };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Convenience function: infer with a simple type environment (monomorphic types).
 */
export function inferWithTypes(expr: Expr, initialEnv?: Map<string, TypeValue>): InferResult {
  const schemeEnv: TypeEnv = new Map();
  if (initialEnv) {
    for (const [name, type] of initialEnv) {
      schemeEnv.set(name, monoScheme(type));
    }
  }
  return infer(expr, schemeEnv);
}

/**
 * Pretty print a constraint for debugging.
 */
export function constraintToString(c: Constraint): string {
  switch (c.kind) {
    case "equals":
      return `${typeToString(c.left)} = ${typeToString(c.right)}${c.source ? ` [${c.source}]` : ""}`;
    case "has_field":
      return `${typeToString(c.objType)}.${c.field} : ${typeToString(c.fieldType)}${c.source ? ` [${c.source}]` : ""}`;
  }
}
