/**
 * Specialization entry point.
 * Based on docs/staged-architecture.md Part 1.5
 */

import { FunctionDef } from "./expr";
import { Env, nowValue, laterValue, isNow } from "./svalue";
import { TypeValue, inferType } from "./types";
import { jsParam } from "./jsexpr";
import { evaluate } from "./evaluate";
import { generateFunction } from "./codegen";
import { toExpr } from "./builtins";

/**
 * Input specification for unknown (runtime) parameters.
 */
export interface UnknownInput {
  name: string;
  type: TypeValue;
}

/**
 * Specialize a function with some known and some unknown inputs.
 * Returns generated JavaScript source code.
 */
export function specialize(
  func: FunctionDef,
  knownInputs: Record<string, unknown>,
  unknownInputs: UnknownInput[]
): string {
  let env = new Env();

  // Known inputs become "now" values
  for (const [name, value] of Object.entries(knownInputs)) {
    env = env.set(name, nowValue(inferType(value), value));
  }

  // Unknown inputs become "later" values referencing parameters
  for (const { name, type } of unknownInputs) {
    env = env.set(name, laterValue(type, jsParam(name)));
  }

  // Evaluate the function body
  const result = evaluate(func.body, env);

  // Generate the specialized function
  const paramNames = unknownInputs.map((u) => u.name);
  const bodyExpr = toExpr(result);

  return generateFunction(func.name + "_specialized", paramNames, bodyExpr);
}

/**
 * Evaluate a function with all known inputs (full evaluation).
 * Returns the computed value.
 */
export function evaluateFully(func: FunctionDef, inputs: Record<string, unknown>): unknown {
  let env = new Env();

  for (const [name, value] of Object.entries(inputs)) {
    env = env.set(name, nowValue(inferType(value), value));
  }

  const result = evaluate(func.body, env);

  if (!isNow(result)) {
    throw new Error("Expected fully known result, but got 'later' value");
  }

  return result.value;
}
