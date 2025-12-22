/**
 * Type unification for type inference.
 * Implements the core unification algorithm and substitution application.
 */

import {
  TypeValue,
  TypeVariable,
  PrimitiveType,
  ObjectType,
  LiteralType,
  ArrayType,
  FunctionType,
  typeEquals,
  objectType,
  arrayType,
  functionType,
} from "./types";

/**
 * Substitution - maps type variable IDs to their resolved types.
 */
export type Substitution = Map<number, TypeValue>;

/**
 * Create an empty substitution.
 */
export function emptySubst(): Substitution {
  return new Map();
}

/**
 * Apply a substitution to a type, replacing type variables with their bindings.
 * Recursively applies to nested types.
 */
export function applySubst(t: TypeValue, subst: Substitution): TypeValue {
  switch (t.tag) {
    case "typevar": {
      const bound = subst.get(t.id);
      if (bound) {
        // Recursively apply in case bound type contains more type vars
        return applySubst(bound, subst);
      }
      return t;
    }

    case "primitive":
    case "literal":
    case "metatype":
      return t;

    case "array":
      return arrayType(applySubst(t.element, subst));

    case "function":
      return functionType(
        t.params.map((p) => applySubst(p, subst)),
        applySubst(t.returnType, subst)
      );

    case "object":
      return objectType(
        t.fields.map((f) => ({
          ...f,
          type: applySubst(f.type, subst),
        }))
      );
  }
}

/**
 * Check if a type variable occurs in a type.
 * Used to prevent infinite types like T = List<T>.
 */
export function occursIn(varId: number, t: TypeValue, subst: Substitution): boolean {
  t = applySubst(t, subst);

  switch (t.tag) {
    case "typevar":
      return t.id === varId;

    case "primitive":
    case "literal":
    case "metatype":
      return false;

    case "array":
      return occursIn(varId, t.element, subst);

    case "function":
      return (
        t.params.some((p) => occursIn(varId, p, subst)) ||
        occursIn(varId, t.returnType, subst)
      );

    case "object":
      return t.fields.some((f) => occursIn(varId, f.type, subst));
  }
}

/**
 * Unification result - either success with updated substitution, or failure with error.
 */
export type UnifyResult =
  | { success: true; subst: Substitution }
  | { success: false; error: string };

/**
 * Unify two types, producing a substitution that makes them equal.
 *
 * The core unification algorithm:
 * 1. If either is a type variable, bind it to the other
 * 2. If both are the same concrete type, succeed
 * 3. If both are compound types (function, object, array), unify components
 * 4. Otherwise, fail
 */
export function unify(
  t1: TypeValue,
  t2: TypeValue,
  subst: Substitution = emptySubst()
): UnifyResult {
  // Apply current substitution first
  t1 = applySubst(t1, subst);
  t2 = applySubst(t2, subst);

  // Same type - trivially unifies
  if (typeEquals(t1, t2)) {
    return { success: true, subst };
  }

  // Type variable on left - bind it
  if (t1.tag === "typevar") {
    return unifyVar(t1, t2, subst);
  }

  // Type variable on right - bind it
  if (t2.tag === "typevar") {
    return unifyVar(t2, t1, subst);
  }

  // Literal types can unify with their base primitive
  if (t1.tag === "literal" && t2.tag === "primitive") {
    if (typeof t1.value === t2.name) {
      return { success: true, subst };
    }
    return { success: false, error: `Cannot unify ${JSON.stringify(t1.value)} with ${t2.name}` };
  }

  if (t2.tag === "literal" && t1.tag === "primitive") {
    if (typeof t2.value === t1.name) {
      return { success: true, subst };
    }
    return { success: false, error: `Cannot unify ${t1.name} with ${JSON.stringify(t2.value)}` };
  }

  // Different tags (and neither is typevar) - cannot unify
  if (t1.tag !== t2.tag) {
    return { success: false, error: `Cannot unify ${t1.tag} with ${t2.tag}` };
  }

  // Same tag - unify structurally
  switch (t1.tag) {
    case "primitive": {
      const t2Prim = t2 as PrimitiveType;
      if (t1.name !== t2Prim.name) {
        return { success: false, error: `Cannot unify ${t1.name} with ${t2Prim.name}` };
      }
      return { success: true, subst };
    }

    case "literal": {
      const t2Lit = t2 as LiteralType;
      if (t1.value !== t2Lit.value) {
        return { success: false, error: `Cannot unify ${JSON.stringify(t1.value)} with ${JSON.stringify(t2Lit.value)}` };
      }
      return { success: true, subst };
    }

    case "array": {
      const t2Arr = t2 as ArrayType;
      return unify(t1.element, t2Arr.element, subst);
    }

    case "function": {
      const t2Fn = t2 as FunctionType;
      if (t1.params.length !== t2Fn.params.length) {
        return {
          success: false,
          error: `Function arity mismatch: ${t1.params.length} vs ${t2Fn.params.length}`,
        };
      }

      let currentSubst = subst;

      // Unify each parameter (contravariant, but we use simple equality for now)
      for (let i = 0; i < t1.params.length; i++) {
        const result = unify(t1.params[i], t2Fn.params[i], currentSubst);
        if (!result.success) {
          return result;
        }
        currentSubst = result.subst;
      }

      // Unify return types
      return unify(t1.returnType, t2Fn.returnType, currentSubst);
    }

    case "object": {
      const t2Obj = t2 as ObjectType;

      // For now, require exact field match
      // Could extend to allow width subtyping
      if (t1.fields.length !== t2Obj.fields.length) {
        return {
          success: false,
          error: `Object field count mismatch: ${t1.fields.length} vs ${t2Obj.fields.length}`,
        };
      }

      let currentSubst = subst;

      for (const f1 of t1.fields) {
        const f2 = t2Obj.fields.find((f) => f.name === f1.name);
        if (!f2) {
          return { success: false, error: `Missing field: ${f1.name}` };
        }

        const result = unify(f1.type, f2.type, currentSubst);
        if (!result.success) {
          return result;
        }
        currentSubst = result.subst;
      }

      return { success: true, subst: currentSubst };
    }

    case "metatype":
      return { success: true, subst };

    default:
      return { success: false, error: `Unknown type tag` };
  }
}

/**
 * Unify a type variable with a type.
 */
function unifyVar(
  v: TypeVariable,
  t: TypeValue,
  subst: Substitution
): UnifyResult {
  // Already bound?
  const bound = subst.get(v.id);
  if (bound) {
    return unify(bound, t, subst);
  }

  // If t is also a type variable that's bound, follow it
  if (t.tag === "typevar") {
    const tBound = subst.get(t.id);
    if (tBound) {
      return unify(v, tBound, subst);
    }
  }

  // Occurs check - prevent infinite types
  if (occursIn(v.id, t, subst)) {
    return {
      success: false,
      error: `Infinite type: ${v.name ?? `?${v.id}`} occurs in ${t.tag}`,
    };
  }

  // Bind the variable
  const newSubst = new Map(subst);
  newSubst.set(v.id, t);
  return { success: true, subst: newSubst };
}

/**
 * Compose two substitutions: apply s1 first, then s2.
 */
export function composeSubst(s1: Substitution, s2: Substitution): Substitution {
  const result = new Map<number, TypeValue>();

  // Apply s2 to all bindings in s1
  for (const [id, type] of s1) {
    result.set(id, applySubst(type, s2));
  }

  // Add bindings from s2 that aren't in s1
  for (const [id, type] of s2) {
    if (!result.has(id)) {
      result.set(id, type);
    }
  }

  return result;
}

/**
 * Unify a list of type pairs.
 */
export function unifyAll(
  pairs: Array<[TypeValue, TypeValue]>,
  subst: Substitution = emptySubst()
): UnifyResult {
  let currentSubst = subst;

  for (const [t1, t2] of pairs) {
    const result = unify(t1, t2, currentSubst);
    if (!result.success) {
      return result;
    }
    currentSubst = result.subst;
  }

  return { success: true, subst: currentSubst };
}
