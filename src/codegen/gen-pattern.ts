/**
 * Pattern matching code generation.
 *
 * Transforms match expressions to JavaScript IIFEs with if-chains.
 */

import {
  CoreExpr,
  CoreCase,
  CorePattern,
  CorePatternField,
} from "../ast/core-ast";
import { CodeBuilder } from "./code-builder";
import { PREC } from "./precedence";
import { genExpr, GenExprContext } from "./gen-expr";

// Variable used for the scrutinee in match expressions
const MATCH_VAR = "_match";

/**
 * Generate JavaScript code for a match expression.
 *
 * Match becomes an IIFE:
 * ```javascript
 * (() => {
 *   const _match = <scrutinee>;
 *   if (<pattern1-condition>) { <bindings>; return <body1>; }
 *   if (<pattern2-condition>) { <bindings>; return <body2>; }
 *   throw new Error("Non-exhaustive match");
 * })()
 * ```
 */
export function genMatch(
  expr: CoreExpr,
  cases: CoreCase[],
  ctx: GenExprContext
): string {
  const builder = new CodeBuilder();
  builder.write("(() => {");
  builder.newline();
  builder.indent();

  // Generate scrutinee binding
  const scrutineeCode = genExpr(expr, {
    ...ctx,
    parentPrecedence: PREC.ASSIGNMENT,
  });
  builder.write(`const ${MATCH_VAR} = ${scrutineeCode};`);
  builder.newline();

  // Generate cases as if-statements
  for (const c of cases) {
    genCase(c, builder, ctx);
  }

  // Fallback error (should be unreachable if exhaustive)
  builder.write(`throw new Error("Non-exhaustive match");`);
  builder.newline();

  builder.dedent();
  builder.write("})()");
  return builder.build();
}

/**
 * Generate a single case as a block with bindings and conditional check.
 *
 * For cases with guards that reference bindings, we need to declare
 * bindings BEFORE evaluating the guard. So we generate:
 *
 * ```javascript
 * {
 *   const n = _match;  // bindings first
 *   if (<pattern-condition> && <guard>) {
 *     return <body>;
 *   }
 * }
 * ```
 */
function genCase(
  c: CoreCase,
  builder: CodeBuilder,
  ctx: GenExprContext
): void {
  const bindings = collectBindings(c.pattern, MATCH_VAR);
  const hasBindings = bindings.length > 0;
  const hasGuard = !!c.guard;

  // If we have bindings that might be used in guards, wrap in a block
  if (hasBindings && hasGuard) {
    builder.write("{");
    builder.newline();
    builder.indent();

    // Declare bindings first (so guard can reference them)
    for (const [name, path] of bindings) {
      builder.write(`const ${name} = ${path};`);
      builder.newline();
    }

    // Generate condition (pattern + guard)
    const patternCond = genPatternCondition(c.pattern, MATCH_VAR);
    const guardCode = genExpr(c.guard!, {
      builder,
      parentPrecedence: PREC.LOGICAL_AND + 1,
    });
    const fullCondition =
      patternCond === "true" ? guardCode : `${patternCond} && ${guardCode}`;

    builder.write(`if (${fullCondition}) {`);
    builder.newline();
    builder.indent();

    // Generate body (bindings already declared above)
    const bodyCode = genExpr(c.body, { builder, parentPrecedence: PREC.COMMA });
    builder.write(`return ${bodyCode};`);
    builder.newline();

    builder.dedent();
    builder.write("}");
    builder.newline();

    builder.dedent();
    builder.write("}");
    builder.newline();
  } else {
    // No guard using bindings, use simpler structure
    const condition = genPatternCondition(c.pattern, MATCH_VAR);

    // Add guard to condition if present
    let fullCondition = condition;
    if (c.guard) {
      const guardCode = genExpr(c.guard, {
        builder,
        parentPrecedence: PREC.LOGICAL_AND + 1,
      });
      if (condition === "true") {
        fullCondition = guardCode;
      } else {
        fullCondition = `${condition} && ${guardCode}`;
      }
    }

    builder.write(`if (${fullCondition}) {`);
    builder.newline();
    builder.indent();

    // Generate bindings
    for (const [name, path] of bindings) {
      builder.write(`const ${name} = ${path};`);
      builder.newline();
    }

    // Generate body
    const bodyCode = genExpr(c.body, { builder, parentPrecedence: PREC.COMMA });
    builder.write(`return ${bodyCode};`);
    builder.newline();

    builder.dedent();
    builder.write("}");
    builder.newline();
  }
}

/**
 * Generate the condition expression for a pattern.
 * Returns "true" if the pattern always matches.
 */
function genPatternCondition(pattern: CorePattern, path: string): string {
  switch (pattern.kind) {
    case "wildcard":
      return "true";

    case "literal":
      return genLiteralCondition(pattern.value, pattern.literalKind, path);

    case "binding":
      // Binding without nested pattern always matches
      if (!pattern.pattern) {
        return "true";
      }
      // With nested pattern, delegate to nested
      return genPatternCondition(pattern.pattern, path);

    case "destructure":
      return genDestructureCondition(pattern.fields, path);

    case "type":
      return genTypeCondition(pattern.typeExpr, path);

    default: {
      const _exhaustive: never = pattern;
      throw new Error(`Unknown pattern kind: ${(pattern as any).kind}`);
    }
  }
}

/**
 * Generate condition for a literal pattern.
 */
function genLiteralCondition(
  value: string | number | boolean | null | undefined,
  literalKind: string,
  path: string
): string {
  switch (literalKind) {
    case "string":
      return `${path} === ${JSON.stringify(value)}`;
    case "int":
    case "float":
      return `${path} === ${value}`;
    case "boolean":
      return `${path} === ${value}`;
    case "null":
      return `${path} === null`;
    case "undefined":
      return `${path} === undefined`;
    default:
      throw new Error(`Unknown literal kind: ${literalKind}`);
  }
}

/**
 * Generate condition for a destructure pattern.
 */
function genDestructureCondition(
  fields: CorePatternField[],
  path: string
): string {
  const conditions: string[] = [];

  for (const field of fields) {
    const fieldPath = `${path}.${field.name}`;

    if (field.pattern) {
      const nestedCond = genPatternCondition(field.pattern, fieldPath);
      if (nestedCond !== "true") {
        conditions.push(nestedCond);
      }
    }
    // No condition needed for just binding a field
  }

  if (conditions.length === 0) {
    return "true";
  }

  return conditions.join(" && ");
}

/**
 * Generate condition for a type pattern.
 *
 * Type patterns check the runtime type:
 * - String → typeof _match === "string"
 * - Int/Float/Number → typeof _match === "number"
 * - Boolean → typeof _match === "boolean"
 * - Null → _match === null
 * - Undefined → _match === undefined
 * - Complex types → rely on discriminant properties or exhaustiveness
 */
function genTypeCondition(typeExpr: CoreExpr, path: string): string {
  // The typeExpr is the erased expression for the type.
  // For primitive types, this will be an identifier like "Int", "String", etc.

  if (typeExpr.kind === "identifier") {
    switch (typeExpr.name) {
      case "String":
        return `typeof ${path} === "string"`;
      case "Int":
      case "Float":
      case "Number":
        return `typeof ${path} === "number"`;
      case "Boolean":
        return `typeof ${path} === "boolean"`;
      case "Null":
        return `${path} === null`;
      case "Undefined":
        return `${path} === undefined`;
      default:
        // For other types (records, unions, etc.), the type checker guarantees
        // exhaustiveness. We generate "true" and rely on previous cases to
        // have matched all other variants.
        return "true";
    }
  }

  // For non-identifier type expressions (like record types), rely on
  // the type checker's exhaustiveness check. Generate true.
  return "true";
}

/**
 * Collect all bindings from a pattern.
 * Returns array of [bindingName, accessPath] pairs.
 */
function collectBindings(
  pattern: CorePattern,
  path: string
): Array<[string, string]> {
  const bindings: Array<[string, string]> = [];

  switch (pattern.kind) {
    case "wildcard":
      // No bindings
      break;

    case "literal":
      // No bindings
      break;

    case "binding":
      // Bind the whole value
      bindings.push([pattern.name, path]);
      // Also collect from nested pattern if present
      if (pattern.pattern) {
        bindings.push(...collectBindings(pattern.pattern, path));
      }
      break;

    case "destructure":
      for (const field of pattern.fields) {
        const fieldPath = `${path}.${field.name}`;
        const bindingName = field.binding ?? field.name;
        bindings.push([bindingName, fieldPath]);

        // Nested pattern
        if (field.pattern) {
          bindings.push(...collectBindings(field.pattern, fieldPath));
        }
      }
      break;

    case "type":
      // Type patterns don't introduce bindings themselves
      break;

    default: {
      const _exhaustive: never = pattern;
      throw new Error(`Unknown pattern kind: ${(pattern as any).kind}`);
    }
  }

  return bindings;
}
