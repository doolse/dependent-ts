#!/usr/bin/env node
/**
 * REPL for the staged interpreter.
 *
 * Usage:
 *   npx ts-node src/staged/repl.ts
 *
 * Commands:
 *   :help          - Show help
 *   :env           - Show current environment
 *   :clear         - Clear environment
 *   :type <expr>   - Show type of expression
 *   :ast <expr>    - Show AST of expression
 *   :def name = expr  - Define a variable
 *   :fn name(params) = expr  - Define a function
 *   :spec name(known) - Specialize a function
 *   :quit          - Exit REPL
 *
 * Examples:
 *   > 1 + 2 * 3
 *   7
 *   > :def x = 10
 *   x = 10
 *   > x * 2
 *   20
 *   > :fn double(x) = x * 2
 *   defined: double(x)
 *   > double(5)
 *   10
 */

/* eslint-disable @typescript-eslint/no-var-requires */
declare const require: (module: string) => unknown;
declare const process: { stdin: unknown; stdout: unknown; exit: (code: number) => void };
const readline = require("readline") as {
  createInterface: (opts: { input: unknown; output: unknown; prompt: string }) => {
    prompt: () => void;
    on: (event: string, callback: (line: string) => void) => void;
    close: () => void;
  };
};

import { parse } from "./parser";
import { evaluate } from "./evaluate";
import { Env, nowValue, isNow, SValue, isClosure, Closure } from "./svalue";
import { FunctionDef } from "./expr";
import { specialize } from "./specialize";
import { typeToString, TypeValue, numberType } from "./types";
import { emptyContext } from "./refinement";

// State
let env = new Env();
const functions = new Map<string, FunctionDef>();

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function color(c: keyof typeof colors, text: string): string {
  return `${colors[c]}${text}${colors.reset}`;
}

function printHelp(): void {
  console.log(`
${color("bright", "Staged Interpreter REPL")}

${color("cyan", "Expressions:")}
  1 + 2 * 3              Arithmetic
  x > 0 ? x : 0          Ternary conditional
  { x: 1, y: 2 }         Object literal
  obj.field              Field access
  func(arg1, arg2)       Function call
  (x, y) => x + y        Lambda expression
  let x = 5 in x * 2     Let binding

${color("cyan", "Commands:")}
  ${color("yellow", ":help")}                  Show this help
  ${color("yellow", ":env")}                   Show current environment
  ${color("yellow", ":clear")}                 Clear environment
  ${color("yellow", ":type")} <expr>           Show type of expression
  ${color("yellow", ":ast")} <expr>            Show AST of expression
  ${color("yellow", ":def")} name = expr       Define a variable
  ${color("yellow", ":fn")} name(p1,p2) = expr Define a function
  ${color("yellow", ":spec")} name(v1=x,v2=y)  Specialize a function with known values
  ${color("yellow", ":quit")}                  Exit REPL

${color("cyan", "Reflection:")}
  typeOf(x)              Get type of value
  fields(obj)            Get field names
  hasField(obj, "x")     Check if field exists
  typeTag(typeOf(x))     Get type tag

${color("cyan", "Examples:")}
  > :def x = 10
  > x * 2 + 5
  25
  > :fn double(x) = x * 2
  > double(5)
  10
  > :def add = (a, b) => a + b
  > add(3, 4)
  7
`);
}

function printEnv(): void {
  console.log(color("cyan", "\nEnvironment:"));

  if (env.size() === 0 && functions.size === 0) {
    console.log(color("dim", "  (empty)"));
    return;
  }

  for (const [name, value] of env.entries()) {
    const typeStr = typeToString(value.type);
    if (isNow(value)) {
      console.log(`  ${color("green", name)}: ${color("dim", typeStr)} = ${formatValue(value.value)}`);
    } else {
      console.log(`  ${color("green", name)}: ${color("dim", typeStr)} = ${color("dim", "<later>")}`);
    }
  }

  for (const [name, fn] of functions) {
    console.log(`  ${color("magenta", name)}(${fn.params.join(", ")})`);
  }
  console.log();
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return color("yellow", `"${value}"`);
  if (typeof value === "number") return color("cyan", String(value));
  if (typeof value === "boolean") return color("magenta", String(value));
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (isClosure(value)) {
    const closure = value as Closure;
    return color("magenta", `(${closure.params.join(", ")}) => ...`);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${k}: ${formatValue(v)}`);
    return `{ ${entries.join(", ")} }`;
  }
  return String(value);
}

function formatSValue(sv: SValue): string {
  if (isNow(sv)) {
    return formatValue(sv.value);
  } else {
    return color("dim", `<later: ${typeToString(sv.type)}>`);
  }
}

function handleCommand(input: string): boolean {
  const trimmed = input.trim();

  if (trimmed === ":quit" || trimmed === ":q" || trimmed === ":exit") {
    console.log(color("dim", "Goodbye!"));
    return false;
  }

  if (trimmed === ":help" || trimmed === ":h" || trimmed === ":?") {
    printHelp();
    return true;
  }

  if (trimmed === ":env" || trimmed === ":e") {
    printEnv();
    return true;
  }

  if (trimmed === ":clear" || trimmed === ":c") {
    env = new Env();
    functions.clear();
    console.log(color("dim", "Environment cleared."));
    return true;
  }

  // :type <expr>
  if (trimmed.startsWith(":type ") || trimmed.startsWith(":t ")) {
    const exprStr = trimmed.replace(/^:(type|t)\s+/, "");
    try {
      const ast = parse(exprStr);
      const result = evaluate(ast, env, emptyContext());
      console.log(color("cyan", typeToString(result.type)));
    } catch (e) {
      console.log(color("red", `Error: ${(e as Error).message}`));
    }
    return true;
  }

  // :ast <expr>
  if (trimmed.startsWith(":ast ") || trimmed.startsWith(":a ")) {
    const exprStr = trimmed.replace(/^:(ast|a)\s+/, "");
    try {
      const ast = parse(exprStr);
      console.log(color("dim", JSON.stringify(ast, null, 2)));
    } catch (e) {
      console.log(color("red", `Error: ${(e as Error).message}`));
    }
    return true;
  }

  // :def name = expr
  if (trimmed.startsWith(":def ") || trimmed.startsWith(":d ")) {
    const rest = trimmed.replace(/^:(def|d)\s+/, "");
    const match = rest.match(/^(\w+)\s*=\s*(.+)$/);
    if (!match) {
      console.log(color("red", "Usage: :def name = expr"));
      return true;
    }
    const [, name, exprStr] = match;
    try {
      const ast = parse(exprStr);
      const result = evaluate(ast, env, emptyContext());
      env = env.set(name, result);
      console.log(`${color("green", name)} = ${formatSValue(result)}`);
    } catch (e) {
      console.log(color("red", `Error: ${(e as Error).message}`));
    }
    return true;
  }

  // :fn name(params) = expr - syntactic sugar for :def name = (params) => expr
  if (trimmed.startsWith(":fn ") || trimmed.startsWith(":f ")) {
    const rest = trimmed.replace(/^:(fn|f)\s+/, "");
    const match = rest.match(/^(\w+)\s*\(([^)]*)\)\s*=\s*(.+)$/);
    if (!match) {
      console.log(color("red", "Usage: :fn name(p1, p2) = expr"));
      return true;
    }
    const [, name, paramsStr, bodyStr] = match;
    const params = paramsStr.split(",").map(p => p.trim()).filter(p => p);
    try {
      // Convert to lambda expression: (p1, p2) => body
      const lambdaStr = `(${params.join(", ")}) => ${bodyStr}`;
      const ast = parse(lambdaStr);
      const result = evaluate(ast, env, emptyContext());
      env = env.set(name, result);

      // Also store in functions map for specialization compatibility
      const body = parse(bodyStr);
      const fn: FunctionDef = { name, params, body };
      functions.set(name, fn);

      console.log(`${color("magenta", "defined:")} ${name}(${params.join(", ")})`);
    } catch (e) {
      console.log(color("red", `Error: ${(e as Error).message}`));
    }
    return true;
  }

  // :spec name(param=value, ...)
  if (trimmed.startsWith(":spec ") || trimmed.startsWith(":s ")) {
    const rest = trimmed.replace(/^:(spec|s)\s+/, "");
    const match = rest.match(/^(\w+)\s*\(([^)]*)\)$/);
    if (!match) {
      console.log(color("red", "Usage: :spec name(param=value, ...)"));
      return true;
    }
    const [, name, argsStr] = match;
    const fn = functions.get(name);
    if (!fn) {
      console.log(color("red", `Unknown function: ${name}`));
      return true;
    }

    try {
      // Parse known values
      const knownValues: Record<string, unknown> = {};
      const unknownParams: { name: string; type: TypeValue }[] = [];

      if (argsStr.trim()) {
        const argPairs = argsStr.split(",").map(s => s.trim());
        for (const pair of argPairs) {
          const [paramName, valueStr] = pair.split("=").map(s => s.trim());
          if (valueStr) {
            // Known value
            const valueAst = parse(valueStr);
            const valueResult = evaluate(valueAst, env, emptyContext());
            if (!isNow(valueResult)) {
              console.log(color("red", `Value for ${paramName} must be known at specialization time`));
              return true;
            }
            knownValues[paramName] = valueResult.value;
          }
        }
      }

      // Remaining params are unknown
      for (const param of fn.params) {
        if (!(param in knownValues)) {
          unknownParams.push({ name: param, type: numberType }); // Default to number
        }
      }

      const code = specialize(fn, knownValues, unknownParams);
      console.log(color("green", code));
    } catch (e) {
      console.log(color("red", `Error: ${(e as Error).message}`));
    }
    return true;
  }

  // Unknown command
  if (trimmed.startsWith(":")) {
    console.log(color("red", `Unknown command: ${trimmed.split(" ")[0]}`));
    console.log(color("dim", "Type :help for available commands."));
    return true;
  }

  // Regular expression
  try {
    const ast = parse(trimmed);
    const result = evaluate(ast, env, emptyContext());
    console.log(formatSValue(result));
  } catch (e) {
    console.log(color("red", `Error: ${(e as Error).message}`));
  }

  return true;
}

function main(): void {
  console.log(color("bright", "Staged Interpreter REPL"));
  console.log(color("dim", "Type :help for commands, :quit to exit.\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: color("green", "> "),
  });

  rl.prompt();

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (trimmed) {
      const shouldContinue = handleCommand(trimmed);
      if (!shouldContinue) {
        rl.close();
        return;
      }
    }
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main();
