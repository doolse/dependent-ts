#!/usr/bin/env node
/**
 * REPL - Read-Eval-Print Loop for the expression language.
 */

import * as readline from "readline";
import { parse, ParseError } from "./parser";
import { LexerError } from "./lexer";
import { run } from "./staged-evaluate";
import { TypeError } from "./builtins";
import { stage, StagingError } from "./staged-evaluate";
import { compile } from "./codegen";
import { valueToString } from "./value";
import { constraintToString } from "./constraint";
import { exprToString, Expr } from "./expr";
import { isNow, isLater } from "./svalue";

// ============================================================================
// REPL Mode
// ============================================================================

type ReplMode = "eval" | "stage" | "compile" | "ast";

// ============================================================================
// REPL State
// ============================================================================

interface ReplState {
  mode: ReplMode;
  showConstraints: boolean;
}

const state: ReplState = {
  mode: "eval",
  showConstraints: true,
};

// ============================================================================
// Commands
// ============================================================================

const COMMANDS: Record<string, { description: string; handler: (args: string) => void }> = {
  help: {
    description: "Show this help message",
    handler: () => showHelp(),
  },
  mode: {
    description: "Set mode: eval, stage, compile, or ast",
    handler: (args) => {
      const mode = args.trim() as ReplMode;
      if (["eval", "stage", "compile", "ast"].includes(mode)) {
        state.mode = mode;
        console.log(`Mode set to: ${mode}`);
      } else {
        console.log("Valid modes: eval, stage, compile, ast");
      }
    },
  },
  constraints: {
    description: "Toggle constraint display (on/off)",
    handler: (args) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") {
        state.showConstraints = true;
      } else if (arg === "off") {
        state.showConstraints = false;
      } else {
        state.showConstraints = !state.showConstraints;
      }
      console.log(`Constraint display: ${state.showConstraints ? "on" : "off"}`);
    },
  },
  clear: {
    description: "Clear the screen",
    handler: () => {
      console.clear();
    },
  },
  exit: {
    description: "Exit the REPL",
    handler: () => {
      process.exit(0);
    },
  },
};

function showHelp(): void {
  console.log("\nCommands:");
  for (const [name, { description }] of Object.entries(COMMANDS)) {
    console.log(`  :${name.padEnd(12)} ${description}`);
  }
  console.log("\nModes:");
  console.log("  eval       Evaluate and show result (default)");
  console.log("  stage      Show staged evaluation (Now/Later)");
  console.log("  compile    Compile to JavaScript");
  console.log("  ast        Show parsed AST");
  console.log("\nBuiltins:");
  console.log("  print(value)         Output value to console");
  console.log("  fields(Type)         Get field names from a type");
  console.log("  fieldType(Type, name) Get type of a field");
  console.log("  map(fn, array)       Transform array elements");
  console.log("  filter(fn, array)    Keep elements where fn returns true");
  console.log("  startsWith(s, pre)   Check if string starts with prefix");
  console.log("  endsWith(s, suf)     Check if string ends with suffix");
  console.log("  contains(s, sub)     Check if string contains substring");
  console.log("\nType Constructors:");
  console.log("  objectType({f1: T1, f2: T2})  Create object type with fields");
  console.log("  arrayType(ElemType)           Create array type");
  console.log("  unionType(T1, T2, ...)        Create union type (T1 | T2)");
  console.log("  intersectionType(T1, T2, ...) Create intersection (T1 & T2)");
  console.log("  nullable(Type)                Create nullable (Type | null)");
  console.log("  functionType([Params], Result) Create function type");
  console.log("\nExamples:");
  console.log("  1 + 2 * 3");
  console.log("  let x = 5 in x + 1");
  console.log("  fn(x) => x * 2");
  console.log("  if x > 0 then x else -x");
  console.log("  { name: \"Alice\", age: 30 }");
  console.log("  [1, 2, 3][1]");
  console.log("  print(\"Hello, World!\")");
  console.log("");
}

// ============================================================================
// Evaluation
// ============================================================================

function processInput(input: string): void {
  const trimmed = input.trim();

  // Empty input
  if (!trimmed) return;

  // Command
  if (trimmed.startsWith(":")) {
    const spaceIdx = trimmed.indexOf(" ");
    const cmdName = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1);
    const cmdArgs = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1) : "";

    const cmd = COMMANDS[cmdName];
    if (cmd) {
      cmd.handler(cmdArgs);
    } else {
      console.log(`Unknown command: :${cmdName}. Type :help for available commands.`);
    }
    return;
  }

  // Expression
  try {
    const expr = parse(trimmed);

    switch (state.mode) {
      case "eval":
        evalMode(expr);
        break;
      case "stage":
        stageMode(expr);
        break;
      case "compile":
        compileMode(expr);
        break;
      case "ast":
        astMode(expr);
        break;
    }
  } catch (e) {
    if (e instanceof LexerError || e instanceof ParseError) {
      console.log(`Syntax error: ${(e as Error).message}`);
    } else if (e instanceof TypeError) {
      console.log(`Type error: ${(e as Error).message}`);
    } else if (e instanceof StagingError) {
      console.log(`Staging error: ${(e as Error).message}`);
    } else if (e instanceof Error) {
      console.log(`Error: ${e.message}`);
    } else {
      console.log(`Error: ${e}`);
    }
  }
}

function evalMode(expr: Expr): void {
  const result = run(expr);
  console.log(valueToString(result.value));
  if (state.showConstraints) {
    console.log(`  : ${constraintToString(result.constraint)}`);
  }
}

function stageMode(expr: Expr): void {
  const result = stage(expr);
  const sv = result.svalue;

  if (isNow(sv)) {
    console.log(`Now: ${valueToString(sv.value)}`);
    if (state.showConstraints) {
      console.log(`  : ${constraintToString(sv.constraint)}`);
    }
  } else {
    console.log(`Later: ${exprToString(sv.residual)}`);
    if (state.showConstraints) {
      console.log(`  : ${constraintToString(sv.constraint)}`);
    }
  }
}

function compileMode(expr: Expr): void {
  const code = compile(expr);
  console.log(code);
}

function astMode(expr: Expr): void {
  console.log(JSON.stringify(expr, null, 2));
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log("Dependent Types Interpreter");
  console.log("Type :help for available commands, :exit to quit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  rl.on("line", (line: string) => {
    processInput(line);
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { processInput, main };
