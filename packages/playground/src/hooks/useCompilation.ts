import { useState, useEffect, useRef } from 'react';
import {
  parseTS,
  stage,
  compile,
  exprToString,
  constraintToString,
  isNow,
  svalueToString,
  Expr,
} from '@dependent-ts/core';

export interface CompilationResult {
  ast: string | null;
  compiledJs: string | null;
  runtimeResult: string | null;
  typeInfo: string | null;
  error: string | null;
  errorPhase: 'parse' | 'compile' | 'runtime' | null;
}

const initialResult: CompilationResult = {
  ast: null,
  compiledJs: null,
  runtimeResult: null,
  typeInfo: null,
  error: null,
  errorPhase: null,
};

export function useCompilation(source: string, debounceMs = 300): CompilationResult {
  const [result, setResult] = useState<CompilationResult>(initialResult);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      if (!source.trim()) {
        setResult(initialResult);
        return;
      }

      let expr: Expr;
      let ast: string;
      let compiledJs: string;
      let runtimeResult: string | null = null;
      let typeInfo: string;

      try {
        // Phase 1: Parse
        expr = parseTS(source);
        ast = exprToString(expr);
      } catch (e) {
        setResult({
          ast: null,
          compiledJs: null,
          runtimeResult: null,
          typeInfo: null,
          error: e instanceof Error ? e.message : String(e),
          errorPhase: 'parse',
        });
        return;
      }

      try {
        // Phase 2: Compile
        compiledJs = compile(expr);

        // Phase 3: Stage for type info
        const staged = stage(expr);
        if (isNow(staged.svalue)) {
          typeInfo = constraintToString(staged.svalue.constraint);
        } else {
          typeInfo = svalueToString(staged.svalue);
        }
      } catch (e) {
        setResult({
          ast,
          compiledJs: null,
          runtimeResult: null,
          typeInfo: null,
          error: e instanceof Error ? e.message : String(e),
          errorPhase: 'compile',
        });
        return;
      }

      try {
        // Phase 4: Execute
        const fn = new Function(`return (${compiledJs})`);
        const value = fn();
        runtimeResult = formatValue(value);
      } catch (e) {
        // Runtime error is non-fatal, we still show the compiled JS
        runtimeResult = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }

      setResult({
        ast,
        compiledJs,
        runtimeResult,
        typeInfo,
        error: null,
        errorPhase: null,
      });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [source, debounceMs]);

  return result;
}

function formatValue(value: unknown, depth = 0): string {
  if (depth > 5) return '...';

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return '[Function]';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => formatValue(v, depth + 1)).join(', ');
    return `[${items}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const pairs = entries.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`).join(', ');
    return `{ ${pairs} }`;
  }

  return String(value);
}
