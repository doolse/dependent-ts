/**
 * Subtype checking for DepJS types.
 *
 * DepJS uses structural subtyping for records and arrays,
 * with special rules for literals, unions, and branded types.
 */

import {
  Type,
  RecordType,
  ArrayType,
  FunctionType,
  unwrapMetadata,
} from "./types";

/**
 * Check if `sub` is a subtype of `sup`.
 *
 * Subtyping rules:
 * - Never is subtype of everything
 * - Everything is subtype of Unknown
 * - Literal types are subtypes of their base primitive types
 * - Int and Float are subtypes of Number
 * - Record subtyping is structural (width and depth)
 * - Function subtyping is contravariant in params, covariant in return
 * - Union: sub is subtype if ALL variants are subtypes of sup
 * - Union: sup is supertype if sub is subtype of ANY variant
 * - Branded types use nominal subtyping (must match exactly)
 */
export function isSubtype(sub: Type, sup: Type): boolean {
  // Unwrap WithMetadata for subtyping (metadata doesn't affect subtyping)
  const subBase = unwrapMetadata(sub);
  const supBase = unwrapMetadata(sup);

  // Same type (structural equality)
  if (typesEqual(subBase, supBase)) return true;

  // Never is subtype of everything
  if (subBase.kind === "primitive" && subBase.name === "Never") return true;

  // Everything is subtype of Unknown
  if (supBase.kind === "primitive" && supBase.name === "Unknown") return true;

  // Literal subtype of its base primitive
  if (subBase.kind === "literal" && supBase.kind === "primitive") {
    if (subBase.baseType === supBase.name) return true;
    // Also Int literal <: Number, Float literal <: Number
    if (
      supBase.name === "Number" &&
      (subBase.baseType === "Int" || subBase.baseType === "Float")
    ) {
      return true;
    }
    return false;
  }

  // Int/Float subtype of Number
  if (subBase.kind === "primitive" && supBase.kind === "primitive") {
    if (
      supBase.name === "Number" &&
      (subBase.name === "Int" || subBase.name === "Float")
    ) {
      return true;
    }
  }

  // Record subtyping (structural)
  if (subBase.kind === "record" && supBase.kind === "record") {
    return isRecordSubtype(subBase, supBase);
  }

  // Array subtyping
  if (subBase.kind === "array" && supBase.kind === "array") {
    return isArraySubtype(subBase, supBase);
  }

  // Function subtyping (contravariant params, covariant return)
  if (subBase.kind === "function" && supBase.kind === "function") {
    return isFunctionSubtype(subBase, supBase);
  }

  // Union: sub is subtype if ALL variants are subtypes of sup
  if (subBase.kind === "union") {
    return subBase.types.every((t) => isSubtype(t, supBase));
  }

  // Union: sup is supertype if sub is subtype of ANY variant
  if (supBase.kind === "union") {
    return supBase.types.some((t) => isSubtype(subBase, t));
  }

  // Intersection: sub is subtype if sub is subtype of ALL parts
  if (supBase.kind === "intersection") {
    return supBase.types.every((t) => isSubtype(subBase, t));
  }

  // Intersection: sub is subtype if ANY part is subtype of sup
  if (subBase.kind === "intersection") {
    return subBase.types.some((t) => isSubtype(t, supBase));
  }

  // Branded types: must match exactly (nominal)
  if (subBase.kind === "branded" || supBase.kind === "branded") {
    if (subBase.kind !== "branded" || supBase.kind !== "branded") return false;
    return (
      subBase.brand === supBase.brand &&
      typesEqual(subBase.baseType, supBase.baseType)
    );
  }

  // Type variables: check bounds
  if (subBase.kind === "typeVar" && supBase.kind === "typeVar") {
    // Same type variable
    if (subBase.name === supBase.name) return true;
    // Sub's bound must be subtype of sup's bound
    if (subBase.bound && supBase.bound) {
      return isSubtype(subBase.bound, supBase.bound);
    }
    return false;
  }

  // Type variable with concrete type
  if (subBase.kind === "typeVar" && subBase.bound) {
    return isSubtype(subBase.bound, supBase);
  }

  // Bounded type (Type<Bound>) - used for generic constraints
  // Type<A> <: Type<B> iff A <: B (covariant in bound)
  if (supBase.kind === "boundedType") {
    if (subBase.kind === "boundedType") {
      // Type<A> <: Type<B> iff A <: B
      return isSubtype(subBase.bound, supBase.bound);
    }
    if (subBase.kind === "primitive" && subBase.name === "Type") {
      // Unbounded Type is only subtype of Type<Unknown>
      return supBase.bound.kind === "primitive" && supBase.bound.name === "Unknown";
    }
    // A concrete type T is assignable to Type<Bound> if T <: Bound
    // This allows passing `Int` to a parameter `T: Type<Number>`
    return isSubtype(subBase, supBase.bound);
  }

  if (subBase.kind === "boundedType") {
    // Type<Bound> <: Type (unbounded)
    if (supBase.kind === "primitive" && supBase.name === "Type") {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Structural subtyping for record types.
 *
 * Rules:
 * - Sub must have all required fields of sup
 * - Sub's field types must be subtypes of sup's field types
 * - If sup is closed, sub cannot have extra fields
 * - Optional in sub can satisfy required in sup only if sub has it
 */
function isRecordSubtype(sub: RecordType, sup: RecordType): boolean {
  // Check each field in sup
  for (const supField of sup.fields) {
    const subField = sub.fields.find((f) => f.name === supField.name);

    if (!subField) {
      // Missing field - only OK if sup's field is optional
      if (!supField.optional) return false;
      continue;
    }

    // Check field type compatibility
    if (!isSubtype(subField.type, supField.type)) return false;

    // Check optionality
    // Sub optional, sup required -> NOT OK
    if (subField.optional && !supField.optional) return false;
    // Sub required, sup optional -> OK (more specific)
  }

  // Check closed record constraints
  if (sup.closed) {
    // Sub cannot have extra fields not in sup
    for (const subField of sub.fields) {
      if (!sup.fields.some((f) => f.name === subField.name)) {
        return false;
      }
    }
  }

  // Check index type compatibility
  if (sup.indexType) {
    // If sup has an index type, sub's extra fields must be compatible
    for (const subField of sub.fields) {
      if (!sup.fields.some((f) => f.name === subField.name)) {
        if (!isSubtype(subField.type, sup.indexType)) {
          return false;
        }
      }
    }
    // If sub also has index type, it must be subtype
    if (sub.indexType && !isSubtype(sub.indexType, sup.indexType)) {
      return false;
    }
  }

  return true;
}

/**
 * Subtyping for array types.
 *
 * Rules:
 * - Fixed-length [A, B] is subtype of variable-length (A | B)[]
 * - For same variadic-ness, element types must match positionally
 */
function isArraySubtype(sub: ArrayType, sup: ArrayType): boolean {
  // Fixed-length is subtype of variable-length
  if (!sub.variadic && sup.variadic) {
    // Sub's element types must all be subtypes of sup's element type union
    const supElementType =
      sup.elementTypes.length === 1
        ? sup.elementTypes[0]
        : { kind: "union" as const, types: sup.elementTypes };

    return sub.elementTypes.every((t) => isSubtype(t, supElementType));
  }

  // Variable to fixed: NOT a subtype (can't guarantee length)
  if (sub.variadic && !sup.variadic) {
    return false;
  }

  // Same variadic-ness: check element types
  if (sub.variadic === sup.variadic) {
    // For fixed arrays, must have same length
    if (!sub.variadic && sub.elementTypes.length !== sup.elementTypes.length) {
      return false;
    }

    // For variable arrays, check element type
    if (sub.variadic) {
      // Both variable: sub's element type must be subtype
      const subElem = sub.elementTypes[0];
      const supElem = sup.elementTypes[0];
      if (subElem && supElem) {
        return isSubtype(subElem, supElem);
      }
      return true; // Empty arrays
    }

    // Fixed arrays: check each position
    return sub.elementTypes.every((t, i) => isSubtype(t, sup.elementTypes[i]));
  }

  return false;
}

/**
 * Function subtyping.
 *
 * Contravariant in parameters (sup's params must be subtypes of sub's),
 * covariant in return type (sub's return must be subtype of sup's).
 *
 * Rest parameter handling:
 * - A function with rest param can accept any number of args of that element type
 * - A function with rest can be subtype of one with more fixed params if types match
 */
function isFunctionSubtype(sub: FunctionType, sup: FunctionType): boolean {
  // Check for rest parameters
  const subHasRest =
    sub.params.length > 0 && sub.params[sub.params.length - 1].rest === true;
  const supHasRest =
    sup.params.length > 0 && sup.params[sup.params.length - 1].rest === true;

  const subNonRest = subHasRest ? sub.params.slice(0, -1) : sub.params;
  const supNonRest = supHasRest ? sup.params.slice(0, -1) : sup.params;
  const subRestParam = subHasRest ? sub.params[sub.params.length - 1] : undefined;
  const supRestParam = supHasRest ? sup.params[sup.params.length - 1] : undefined;

  // Count required params (excluding rest)
  const supRequired = supNonRest.filter((p) => !p.optional).length;
  const subRequired = subNonRest.filter((p) => !p.optional).length;

  if (subRequired > supRequired) {
    // Sub requires more params than sup provides
    return false;
  }

  // Check non-rest parameters (contravariant)
  const maxNonRest = Math.max(subNonRest.length, supNonRest.length);
  for (let i = 0; i < maxNonRest; i++) {
    const supParam = supNonRest[i];
    const subParam = subNonRest[i];

    if (!subParam && supParam) {
      // Sub doesn't have this param - that's OK!
      // In JavaScript/TypeScript, a function with fewer parameters can be used
      // where one with more parameters is expected (extra args are ignored).
      // This is standard callback behavior: (x) => x can be passed as (a,b,c) => ...
      if (subRestParam) {
        // Sub has rest param - check rest element type (contravariant)
        const restElemType = getRestElementType(subRestParam);
        if (restElemType && !isSubtype(supParam.type, restElemType)) return false;
      }
      // If sub doesn't have this param and has no rest, that's still fine
      // because the caller will pass the argument and sub will just ignore it.
      continue;
    }

    if (subParam && !supParam) {
      // Sub has extra param that sup doesn't
      // This is ok if sub's param is optional or if sup has rest
      if (!subParam.optional && !supRestParam) {
        return false;
      }
      continue;
    }

    if (supParam && subParam) {
      // Both have param at this position - contravariance
      if (!isSubtype(supParam.type, subParam.type)) return false;
    }
  }

  // Check rest parameter compatibility
  if (supRestParam && subRestParam) {
    // Both have rest - contravariant
    const supRestElem = getRestElementType(supRestParam);
    const subRestElem = getRestElementType(subRestParam);
    if (supRestElem && subRestElem && !isSubtype(supRestElem, subRestElem)) {
      return false;
    }
  } else if (supRestParam && !subRestParam) {
    // Sup expects rest but sub doesn't have it
    // Sub can't handle arbitrary extra args that sup might pass
    return false;
  }
  // If sub has rest but sup doesn't, that's fine - sub can accept more

  // Covariant return type
  if (!isSubtype(sub.returnType, sup.returnType)) return false;

  // Async compatibility
  if (sup.async && !sub.async) {
    return false;
  }

  return true;
}

/**
 * Extract the element type from a rest parameter's array type.
 */
function getRestElementType(param: { type: Type; rest?: boolean }): Type | undefined {
  if (param.type.kind === "array" && param.type.variadic) {
    return param.type.elementTypes[0];
  }
  return param.type;
}

/**
 * Check structural equality of two types.
 */
export function typesEqual(a: Type, b: Type): boolean {
  // Unwrap metadata
  const aBase = unwrapMetadata(a);
  const bBase = unwrapMetadata(b);

  if (aBase.kind !== bBase.kind) return false;

  switch (aBase.kind) {
    case "primitive":
      return aBase.name === (bBase as typeof aBase).name;

    case "literal":
      return (
        aBase.value === (bBase as typeof aBase).value &&
        aBase.baseType === (bBase as typeof aBase).baseType
      );

    case "record": {
      const bRecord = bBase as typeof aBase;
      if (aBase.fields.length !== bRecord.fields.length) return false;
      if (aBase.closed !== bRecord.closed) return false;

      // Check all fields match
      for (const aField of aBase.fields) {
        const bField = bRecord.fields.find((f) => f.name === aField.name);
        if (!bField) return false;
        if (aField.optional !== bField.optional) return false;
        if (!typesEqual(aField.type, bField.type)) return false;
      }

      // Check index types
      if (aBase.indexType && bRecord.indexType) {
        if (!typesEqual(aBase.indexType, bRecord.indexType)) return false;
      } else if (aBase.indexType || bRecord.indexType) {
        return false;
      }

      return true;
    }

    case "function": {
      const bFunc = bBase as typeof aBase;
      if (aBase.params.length !== bFunc.params.length) return false;
      if (aBase.async !== bFunc.async) return false;

      for (let i = 0; i < aBase.params.length; i++) {
        if (aBase.params[i].optional !== bFunc.params[i].optional) return false;
        if (Boolean(aBase.params[i].rest) !== Boolean(bFunc.params[i].rest)) return false;
        if (!typesEqual(aBase.params[i].type, bFunc.params[i].type))
          return false;
      }

      return typesEqual(aBase.returnType, bFunc.returnType);
    }

    case "array": {
      const bArr = bBase as typeof aBase;
      if (aBase.variadic !== bArr.variadic) return false;
      if (aBase.elementTypes.length !== bArr.elementTypes.length) return false;

      return aBase.elementTypes.every((t, i) =>
        typesEqual(t, bArr.elementTypes[i])
      );
    }

    case "union":
    case "intersection": {
      const bCompound = bBase as typeof aBase;
      if (aBase.types.length !== bCompound.types.length) return false;

      // Order matters for equality (though not for subtyping)
      return aBase.types.every((t, i) => typesEqual(t, bCompound.types[i]));
    }

    case "branded": {
      const bBranded = bBase as typeof aBase;
      return (
        aBase.brand === bBranded.brand &&
        typesEqual(aBase.baseType, bBranded.baseType)
      );
    }

    case "typeVar": {
      const bVar = bBase as typeof aBase;
      if (aBase.name !== bVar.name) return false;
      if (aBase.bound && bVar.bound) {
        return typesEqual(aBase.bound, bVar.bound);
      }
      return !aBase.bound && !bVar.bound;
    }

    case "this":
      return true;

    case "withMetadata":
      // Already unwrapped above
      return false;
  }
}
