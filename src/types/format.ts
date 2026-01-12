/**
 * Type formatting for error messages.
 */

import { Type, getMetadata, unwrapMetadata } from "./types";

/**
 * Format a type as a human-readable string.
 */
export function formatType(t: Type): string {
  // Check for named types first
  const metadata = getMetadata(t);
  if (metadata?.name) {
    const typeArgs = metadata.typeArgs;
    if (typeArgs && typeArgs.length > 0) {
      return `${metadata.name}<${typeArgs.map(formatType).join(", ")}>`;
    }
    return metadata.name;
  }

  const base = unwrapMetadata(t);

  switch (base.kind) {
    case "primitive":
      return base.name;

    case "literal":
      if (typeof base.value === "string") {
        return JSON.stringify(base.value);
      }
      return String(base.value);

    case "record": {
      if (base.fields.length === 0) {
        if (base.indexType) {
          return `{ [key: String]: ${formatType(base.indexType)} }`;
        }
        return base.closed ? "{||}" : "{}";
      }

      const fields = base.fields.map((f) => {
        const opt = f.optional ? "?" : "";
        return `${f.name}${opt}: ${formatType(f.type)}`;
      });

      const open = base.closed ? "{|" : "{";
      const close = base.closed ? "|}" : "}";

      if (base.indexType) {
        fields.push(`[key: String]: ${formatType(base.indexType)}`);
      }

      return `${open} ${fields.join(", ")} ${close}`;
    }

    case "function": {
      const params = base.params.map((p) => {
        const opt = p.optional ? "?" : "";
        return `${p.name}${opt}: ${formatType(p.type)}`;
      });

      const asyncPrefix = base.async ? "async " : "";
      return `${asyncPrefix}(${params.join(", ")}) => ${formatType(base.returnType)}`;
    }

    case "array": {
      if (base.variadic && base.elementTypes.length === 1) {
        // Variable-length array: T[]
        return `${formatTypeParens(base.elementTypes[0])}[]`;
      }

      // Fixed-length array: [T, U, ...]
      return `[${base.elementTypes.map(formatType).join(", ")}]`;
    }

    case "union": {
      if (base.types.length === 0) return "Never";
      return base.types.map(formatTypeParens).join(" | ");
    }

    case "intersection": {
      if (base.types.length === 0) return "Unknown";
      return base.types.map(formatTypeParens).join(" & ");
    }

    case "branded":
      return base.name;

    case "typeVar":
      if (base.bound) {
        return `${base.name} extends ${formatType(base.bound)}`;
      }
      return base.name;

    case "this":
      return "This";

    case "withMetadata":
      // Should be handled above, but fallback
      return formatType(base.baseType);
  }
}

/**
 * Format a type with parentheses if needed for operator precedence.
 */
function formatTypeParens(t: Type): string {
  const base = unwrapMetadata(t);

  // Add parens around unions/intersections when nested
  if (base.kind === "union" || base.kind === "intersection") {
    return `(${formatType(t)})`;
  }

  // Add parens around function types in some contexts
  if (base.kind === "function") {
    return `(${formatType(t)})`;
  }

  return formatType(t);
}
