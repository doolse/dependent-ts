/**
 * Staged values - either known now or computed later.
 * Based on docs/staged-architecture.md Part 1.1
 */

import { TypeValue, FunctionType } from "./types";
import { JsExpr } from "./jsexpr";
import { Expr } from "./expr";

/**
 * Source information for tracking where a value came from.
 * Used by the refinement system to extract constraints.
 */
export interface SourceInfo {
  // The original variable name, if this value came from a variable
  symbol?: string;
  // The field access path, if this value came from a field access
  field?: { object: SValue; field: string };
  // The operation that produced this value, if from a binary op
  op?: { op: string; left: SValue; right: SValue };
}

/**
 * A staged value. The type is ALWAYS known, even for "later" values.
 */
export type SValue = NowValue | LaterValue;

export interface NowValue {
  stage: "now";
  type: TypeValue;
  value: unknown;
  source?: SourceInfo;
}

export interface LaterValue {
  stage: "later";
  type: TypeValue;
  expr: JsExpr;
  source?: SourceInfo;
}

/**
 * A closure - a function value that captures its environment.
 * Closures are always "now" values since we know their structure at specialization time.
 */
export interface Closure {
  params: string[];
  body: Expr;
  env: Env; // Captured environment
  type: FunctionType;
}

// Constructors
export function nowValue(type: TypeValue, value: unknown, source?: SourceInfo): NowValue {
  return { stage: "now", type, value, source };
}

export function laterValue(type: TypeValue, expr: JsExpr, source?: SourceInfo): LaterValue {
  return { stage: "later", type, expr, source };
}

// Type guards
export function isNow(v: SValue): v is NowValue {
  return v.stage === "now";
}

export function isLater(v: SValue): v is LaterValue {
  return v.stage === "later";
}

export function isClosure(value: unknown): value is Closure {
  return (
    typeof value === "object" &&
    value !== null &&
    "params" in value &&
    "body" in value &&
    "env" in value &&
    "type" in value
  );
}

export function makeClosure(params: string[], body: Expr, env: Env, type: FunctionType): Closure {
  return { params, body, env, type };
}

/**
 * Add source info to an existing SValue.
 */
export function withSource(v: SValue, source: SourceInfo): SValue {
  return { ...v, source: { ...v.source, ...source } };
}

/**
 * Environment - maps variable names to staged values.
 * Immutable: set() returns a new Env.
 */
export class Env {
  private bindings: Map<string, SValue>;

  constructor(initial?: Map<string, SValue>) {
    this.bindings = initial ?? new Map();
  }

  get(name: string): SValue {
    const v = this.bindings.get(name);
    if (v === undefined) {
      throw new Error(`Undefined variable: ${name}`);
    }
    return v;
  }

  set(name: string, value: SValue): Env {
    const newBindings = new Map(this.bindings);
    newBindings.set(name, value);
    return new Env(newBindings);
  }

  has(name: string): boolean {
    return this.bindings.has(name);
  }

  entries(): IterableIterator<[string, SValue]> {
    return this.bindings.entries();
  }

  size(): number {
    return this.bindings.size;
  }
}
