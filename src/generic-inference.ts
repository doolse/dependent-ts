/**
 * Generic Type Instantiation
 *
 * This module handles the instantiation of generic function types when called
 * with concrete arguments. For example:
 *
 *   useState<T>(initial: T): [T, (v: T) => void]
 *   useState(0) -> [number, (number) => void]
 *
 * The algorithm:
 * 1. Create fresh inference variables for each type parameter
 * 2. Substitute type params in parameter constraints with fresh vars
 * 3. Unify argument constraints with instantiated parameter constraints
 * 4. Apply resulting substitution to the result constraint
 */

import {
  Constraint,
  TypeParam,
  Substitution,
  emptySubstitution,
  freshCVar,
  applySubstitution,
  solve,
  simplify,
  anyC,
  or,
  fnType,
} from "./constraint";

/**
 * Result of generic instantiation.
 */
export interface InstantiationResult {
  /** The substitution mapping type param IDs to inferred constraints */
  substitution: Substitution;
  /** The instantiated result constraint */
  resultConstraint: Constraint;
  /** The instantiated parameter constraints (for error messages) */
  instantiatedParams: Constraint[];
}

/**
 * Substitute type parameter references with their replacements.
 * This replaces typeParam constraints that match the given type param IDs.
 */
export function substituteTypeParams(
  constraint: Constraint,
  typeParamSubs: Map<number, Constraint>
): Constraint {
  return substituteTypeParamsImpl(constraint, typeParamSubs);
}

function substituteTypeParamsImpl(
  c: Constraint,
  subs: Map<number, Constraint>
): Constraint {
  switch (c.tag) {
    case "typeParam":
      // Replace if we have a substitution for this type param
      if (subs.has(c.id)) {
        return subs.get(c.id)!;
      }
      return c;

    case "and":
      return {
        tag: "and",
        constraints: c.constraints.map((x) => substituteTypeParamsImpl(x, subs)),
      };

    case "or":
      return or(...c.constraints.map((x) => substituteTypeParamsImpl(x, subs)));

    case "not":
      return { tag: "not", constraint: substituteTypeParamsImpl(c.constraint, subs) };

    case "hasField":
      return {
        tag: "hasField",
        name: c.name,
        constraint: substituteTypeParamsImpl(c.constraint, subs),
      };

    case "elements":
      return { tag: "elements", constraint: substituteTypeParamsImpl(c.constraint, subs) };

    case "length":
      return { tag: "length", constraint: substituteTypeParamsImpl(c.constraint, subs) };

    case "elementAt":
      return {
        tag: "elementAt",
        index: c.index,
        constraint: substituteTypeParamsImpl(c.constraint, subs),
      };

    case "isType":
      return { tag: "isType", constraint: substituteTypeParamsImpl(c.constraint, subs) };

    case "rec":
      return { tag: "rec", var: c.var, body: substituteTypeParamsImpl(c.body, subs) };

    case "fnType":
      return fnType(
        c.params.map((p) => substituteTypeParamsImpl(p, subs)),
        substituteTypeParamsImpl(c.result, subs)
      );

    case "genericFnType":
      // Don't substitute type params that are bound by this generic
      const boundIds = new Set(c.typeParams.map((tp) => tp.id));
      const filteredSubs = new Map(
        [...subs.entries()].filter(([id]) => !boundIds.has(id))
      );
      return {
        tag: "genericFnType",
        typeParams: c.typeParams.map((tp) => ({
          ...tp,
          bound: substituteTypeParamsImpl(tp.bound, filteredSubs),
        })),
        params: c.params.map((p) => substituteTypeParamsImpl(p, filteredSubs)),
        result: substituteTypeParamsImpl(c.result, filteredSubs),
      };

    // Primitives and other constraints pass through unchanged
    default:
      return c;
  }
}

/**
 * Instantiate a generic function type with the given argument constraints.
 *
 * @param genericFn - The generic function type to instantiate
 * @param argConstraints - Constraints of the arguments being passed
 * @returns The instantiation result with inferred types, or null if unification fails
 */
export function instantiateGenericCall(
  genericFn: {
    tag: "genericFnType";
    typeParams: TypeParam[];
    params: Constraint[];
    result: Constraint;
  },
  argConstraints: Constraint[]
): InstantiationResult | null {
  // 1. Create fresh inference variables for each type parameter
  const typeParamSubs = new Map<number, Constraint>();
  for (const tp of genericFn.typeParams) {
    const fresh = freshCVar();
    typeParamSubs.set(tp.id, fresh);
  }

  // 2. Substitute type params in parameter constraints
  const instantiatedParams = genericFn.params.map((p) =>
    substituteTypeParams(p, typeParamSubs)
  );

  // 3. Unify argument constraints with instantiated parameters
  let substitution = emptySubstitution();

  // Handle variadic args (if more args than params, assume rest param)
  const numParams = Math.min(argConstraints.length, instantiatedParams.length);

  for (let i = 0; i < numParams; i++) {
    const argC = argConstraints[i];
    const paramC = instantiatedParams[i];

    // Try to solve/unify argC with paramC
    const result = solve(argC, paramC);
    if (result === null) {
      // Try the reverse - sometimes we need to solve param against arg
      const reverseResult = solve(paramC, argC);
      if (reverseResult === null) {
        // Unification failed - but we can still try to infer from OR branches
        // For useState(0) with param T | (() => T), try each branch
        if (paramC.tag === "or") {
          let foundMatch = false;
          for (const branch of paramC.constraints) {
            const branchResult = solve(argC, branch);
            if (branchResult !== null) {
              // Merge this result
              for (const [id, c] of branchResult) {
                substitution.set(id, c);
              }
              foundMatch = true;
              break;
            }
          }
          if (!foundMatch) {
            return null; // No branch matched
          }
        } else {
          return null; // Unification failed
        }
      } else {
        // Merge reverse result
        for (const [id, c] of reverseResult) {
          substitution.set(id, c);
        }
      }
    } else {
      // Merge result into substitution
      for (const [id, c] of result) {
        substitution.set(id, c);
      }
    }
  }

  // 4. Apply substitution to result constraint
  const instantiatedResult = substituteTypeParams(genericFn.result, typeParamSubs);
  const resultConstraint = simplify(applySubstitution(instantiatedResult, substitution));

  return {
    substitution,
    resultConstraint,
    instantiatedParams,
  };
}

/**
 * Try to instantiate a constraint if it's a generic function type.
 * If it's a regular fnType, just return the result.
 * If it's neither, return null.
 */
export function tryInstantiateCall(
  funcConstraint: Constraint,
  argConstraints: Constraint[]
): Constraint | null {
  if (funcConstraint.tag === "genericFnType") {
    const result = instantiateGenericCall(funcConstraint, argConstraints);
    return result?.resultConstraint ?? null;
  }

  if (funcConstraint.tag === "fnType") {
    // Non-generic function - just return the result type
    // (Actual type checking of args happens elsewhere)
    return funcConstraint.result;
  }

  // Not a function type
  return null;
}

/**
 * Infer the return type of a generic function call, handling nested generics.
 */
export function inferGenericCallResult(
  funcConstraint: Constraint,
  argConstraints: Constraint[]
): Constraint {
  const result = tryInstantiateCall(funcConstraint, argConstraints);
  if (result !== null) {
    return result;
  }

  // Fall back to any if we can't determine the type
  return anyC;
}
