#!/usr/bin/env node
/**
 * DepJS REPL - Interactive compile-time evaluator.
 *
 * Supports multiline input, persistent bindings, and type introspection.
 */

import * as readline from "readline";
import { parse } from "./parser";
import { ComptimeEvaluator } from "./typecheck/comptime-eval";
import {
  createInitialComptimeEnv,
  createInitialTypeEnv,
} from "./typecheck/builtins";
import {
  RawComptimeValue,
  TypedComptimeValue,
  ComptimeEnv,
  isRawTypeValue,
  isClosureValue,
  isBuiltinValue,
  isRecordValue,
} from "./typecheck/comptime-env";
import { TypeEnv } from "./typecheck/type-env";
import { formatType } from "./types/format";
import { CoreDecl, CompileError } from "./ast/core-ast";

// ANSI colors for terminal output
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

/**
 * Format a comptime value for display.
 */
function formatValue(value: RawComptimeValue, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (value === undefined) return colors.dim + "undefined" + colors.reset;
  if (value === null) return colors.dim + "null" + colors.reset;

  if (isRawTypeValue(value)) {
    return colors.cyan + formatType(value) + colors.reset;
  }

  if (isClosureValue(value)) {
    const params = value.params.map((p) => p.name).join(", ");
    return colors.magenta + `[Function (${params}) => ...]` + colors.reset;
  }

  if (isBuiltinValue(value)) {
    return colors.magenta + `[Builtin: ${value.name}]` + colors.reset;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.length <= 5 && !value.some((v) => Array.isArray(v) || isRecordValue(v))) {
      // Short array, inline
      return "[" + value.map((v) => formatValue(v, 0)).join(", ") + "]";
    }
    // Multi-line array
    const items = value.map((v) => pad + "  " + formatValue(v, indent + 1));
    return "[\n" + items.join(",\n") + "\n" + pad + "]";
  }

  if (isRecordValue(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    if (entries.length <= 3 && !entries.some(([, v]) => Array.isArray(v) || isRecordValue(v))) {
      // Short record, inline
      const fields = entries.map(([k, v]) => `${k}: ${formatValue(v, 0)}`);
      return "{ " + fields.join(", ") + " }";
    }
    // Multi-line record
    const fields = entries.map(([k, v]) => pad + "  " + k + ": " + formatValue(v, indent + 1));
    return "{\n" + fields.join(",\n") + "\n" + pad + "}";
  }

  if (typeof value === "string") {
    return colors.green + JSON.stringify(value) + colors.reset;
  }

  if (typeof value === "number") {
    return colors.yellow + String(value) + colors.reset;
  }

  if (typeof value === "boolean") {
    return colors.blue + String(value) + colors.reset;
  }

  return String(value);
}

/**
 * Check if input appears to be incomplete (needs more lines).
 */
function isIncomplete(input: string): boolean {
  // Count brackets/braces/parens
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    switch (ch) {
      case "{":
        braces++;
        break;
      case "}":
        braces--;
        break;
      case "[":
        brackets++;
        break;
      case "]":
        brackets--;
        break;
      case "(":
        parens++;
        break;
      case ")":
        parens--;
        break;
    }
  }

  // Incomplete if unclosed delimiters or unterminated string
  return braces > 0 || brackets > 0 || parens > 0 || inString;
}

/**
 * Determine if input is a declaration or expression.
 * Returns parsed declarations if successful, or null if it's likely incomplete.
 */
function tryParse(input: string): CoreDecl[] | null {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Check for obvious incomplete input
  if (isIncomplete(trimmed)) {
    return null;
  }

  // Try parsing as-is (might be declarations)
  try {
    return parse(trimmed);
  } catch (e) {
    // If it fails, try wrapping as expression
    // This handles cases like "1 + 2" which aren't valid declarations
    if (!trimmed.endsWith(";")) {
      try {
        return parse(trimmed + ";");
      } catch {
        // If still fails, might need semicolon or be incomplete
        return null;
      }
    }
    throw e;
  }
}

/**
 * Process parsed declarations, updating environment and returning results.
 */
function processDeclarations(
  decls: CoreDecl[],
  evaluator: ComptimeEvaluator,
  comptimeEnv: ComptimeEnv,
  typeEnv: TypeEnv
): string[] {
  const results: string[] = [];

  for (const decl of decls) {
    evaluator.reset();

    switch (decl.kind) {
      case "const": {
        const typed = evaluator.evaluate(decl.init, comptimeEnv, typeEnv);
        comptimeEnv.defineEvaluated(decl.name, typed);

        // Also register in type env (use the type from the typed value)
        typeEnv.define(decl.name, {
          type: typed.type,
          comptimeStatus: "comptimeOnly",
          mutable: false,
        });

        results.push(
          colors.dim + decl.name + " = " + colors.reset + formatValue(typed.value)
        );
        break;
      }

      case "expr": {
        const typed = evaluator.evaluate(decl.expr, comptimeEnv, typeEnv);
        if (typed.value !== undefined) {
          results.push(formatValue(typed.value));
        }
        break;
      }

      case "import": {
        results.push(
          colors.yellow +
            "Warning: imports are not supported in REPL" +
            colors.reset
        );
        break;
      }
    }
  }

  return results;
}

/**
 * Print help message.
 */
function printHelp(): void {
  console.log(`
${colors.cyan}DepJS REPL Commands:${colors.reset}
  .help     Show this help message
  .exit     Exit the REPL
  .env      Show defined bindings
  .clear    Clear the environment
  .reset    Reset evaluator fuel

${colors.cyan}Examples:${colors.reset}
  > 1 + 2
  ${colors.yellow}3${colors.reset}

  > const x = 42;
  ${colors.dim}x = ${colors.yellow}42${colors.reset}

  > x * 2
  ${colors.yellow}84${colors.reset}

  > type Point = { x: Int, y: Int };
  ${colors.dim}Point = ${colors.cyan}{ x: Int, y: Int }${colors.reset}

  > Int.name
  ${colors.green}"Int"${colors.reset}

  > Union(Int, String)
  ${colors.cyan}Int | String${colors.reset}

${colors.dim}Multiline input is supported - keep typing until brackets are balanced.${colors.reset}
`);
}

/**
 * Show defined bindings in the environment.
 */
function showEnvironment(comptimeEnv: ComptimeEnv, evaluator: ComptimeEvaluator): void {
  // We can't easily enumerate ComptimeEnv, so we'll track names ourselves
  console.log(colors.dim + "(Environment inspection not fully implemented)" + colors.reset);
}

/**
 * Main REPL loop.
 */
async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  let comptimeEnv = createInitialComptimeEnv();
  let typeEnv = createInitialTypeEnv();
  const evaluator = new ComptimeEvaluator();

  // Track user-defined names for .env command
  const userBindings: string[] = [];

  console.log(colors.cyan + "DepJS REPL" + colors.reset + " (comptime evaluator)");
  console.log(colors.dim + 'Type .help for commands, .exit to quit\n' + colors.reset);

  let inputBuffer = "";
  let continuation = false;

  const prompt = (): void => {
    const promptStr = continuation
      ? colors.dim + "... " + colors.reset
      : colors.green + "> " + colors.reset;

    rl.question(promptStr, (line) => {
      // Handle special commands
      if (!continuation && line.startsWith(".")) {
        const cmd = line.trim().toLowerCase();

        switch (cmd) {
          case ".exit":
          case ".quit":
          case ".q":
            rl.close();
            return;

          case ".help":
          case ".h":
            printHelp();
            prompt();
            return;

          case ".env":
            showEnvironment(comptimeEnv, evaluator);
            prompt();
            return;

          case ".clear":
            comptimeEnv = createInitialComptimeEnv();
            typeEnv = createInitialTypeEnv();
            userBindings.length = 0;
            console.log(colors.dim + "Environment cleared" + colors.reset);
            prompt();
            return;

          case ".reset":
            evaluator.reset();
            console.log(colors.dim + "Evaluator fuel reset" + colors.reset);
            prompt();
            return;

          default:
            console.log(colors.red + `Unknown command: ${cmd}` + colors.reset);
            prompt();
            return;
        }
      }

      // Accumulate input
      inputBuffer += (inputBuffer ? "\n" : "") + line;

      // Try to parse
      try {
        const decls = tryParse(inputBuffer);

        if (decls === null) {
          // Incomplete input, continue reading
          continuation = true;
          prompt();
          return;
        }

        // Process declarations
        if (decls.length > 0) {
          const results = processDeclarations(decls, evaluator, comptimeEnv, typeEnv);
          for (const result of results) {
            console.log(result);
          }

          // Track user bindings
          for (const decl of decls) {
            if (decl.kind === "const" && !userBindings.includes(decl.name)) {
              userBindings.push(decl.name);
            }
          }
        }

        // Reset for next input
        inputBuffer = "";
        continuation = false;
        prompt();
      } catch (e) {
        // Check if this might be a parse error due to incomplete input
        if (e instanceof CompileError && e.stage === "parse" && isIncomplete(inputBuffer)) {
          continuation = true;
          prompt();
          return;
        }

        // Real error
        if (e instanceof CompileError) {
          console.log(colors.red + `${e.stage} error: ${e.message}` + colors.reset);
          if (e.loc) {
            // Show location in multi-line input
            const lines = inputBuffer.split("\n");
            let pos = 0;
            for (let i = 0; i < lines.length; i++) {
              if (pos + lines[i].length >= e.loc.from) {
                const col = e.loc.from - pos;
                console.log(colors.dim + `  at line ${i + 1}, column ${col + 1}` + colors.reset);
                console.log(colors.dim + "  " + lines[i] + colors.reset);
                console.log(colors.dim + "  " + " ".repeat(col) + "^" + colors.reset);
                break;
              }
              pos += lines[i].length + 1; // +1 for newline
            }
          }
        } else if (e instanceof Error) {
          console.log(colors.red + `Error: ${e.message}` + colors.reset);
        } else {
          console.log(colors.red + `Error: ${e}` + colors.reset);
        }

        // Reset for next input
        inputBuffer = "";
        continuation = false;
        prompt();
      }
    });
  };

  // Handle Ctrl+C gracefully
  rl.on("close", () => {
    console.log(colors.dim + "\nGoodbye!" + colors.reset);
    process.exit(0);
  });

  // Handle Ctrl+C during multiline input
  rl.on("SIGINT", () => {
    if (continuation) {
      console.log(colors.dim + "\n(input cancelled)" + colors.reset);
      inputBuffer = "";
      continuation = false;
      prompt();
    } else {
      rl.close();
    }
  });

  prompt();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
