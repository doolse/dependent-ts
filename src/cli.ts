#!/usr/bin/env node
/**
 * DepJS CLI - Compile DepJS source to JavaScript.
 *
 * Usage:
 *   depjs compile <file.djs>          # Compile to stdout
 *   depjs compile <file.djs> -o out.js  # Compile to file
 *   depjs run <file.djs>              # Compile and run
 *   depjs check <file.djs>            # Type check only
 */

import * as fs from "fs";
import * as path from "path";
import { parse } from "./parser";
import { typecheck } from "./typecheck/typecheck";
import { erase } from "./erasure/erasure";
import { codegen } from "./codegen";
import { CompileError } from "./ast/core-ast";

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function printUsage(): void {
  console.log(`
${colors.cyan}DepJS Compiler${colors.reset}

${colors.yellow}Usage:${colors.reset}
  depjs compile <file.djs>              Compile to stdout
  depjs compile <file.djs> -o <out.js>  Compile to file
  depjs run <file.djs>                  Compile and execute
  depjs check <file.djs>                Type check only
  depjs help                            Show this message

${colors.yellow}Options:${colors.reset}
  -o, --output <file>   Output file (for compile)
  -q, --quiet           Suppress info messages
  -v, --verbose         Show verbose output

${colors.yellow}Examples:${colors.reset}
  depjs compile hello.djs               # Output JS to stdout
  depjs compile hello.djs -o hello.js   # Output to file
  depjs run hello.djs                   # Compile and run
  depjs check hello.djs                 # Check for errors
`);
}

function printError(source: string, error: CompileError): void {
  console.error(colors.red + `${error.stage} error: ${error.message}` + colors.reset);

  if (error.loc) {
    const lines = source.split("\n");
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineEnd = pos + lines[i].length;
      if (lineEnd >= error.loc.from) {
        const col = error.loc.from - pos;
        console.error(colors.dim + `  at line ${i + 1}, column ${col + 1}` + colors.reset);
        console.error(colors.dim + "  " + lines[i] + colors.reset);
        console.error(colors.dim + "  " + " ".repeat(col) + "^" + colors.reset);
        break;
      }
      pos = lineEnd + 1; // +1 for newline
    }
  }

  for (const note of error.notes) {
    console.error(colors.dim + `  note: ${note.message}` + colors.reset);
  }
}

interface Options {
  command: "compile" | "run" | "check" | "help";
  inputFile?: string;
  outputFile?: string;
  quiet: boolean;
  verbose: boolean;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    command: "help",
    quiet: false,
    verbose: false,
  };

  let i = 0;

  // Get command
  if (args.length > 0) {
    const cmd = args[0];
    if (cmd === "compile" || cmd === "run" || cmd === "check" || cmd === "help") {
      options.command = cmd;
      i = 1;
    } else if (cmd.endsWith(".djs") || cmd.endsWith(".depjs")) {
      // Allow: depjs myfile.djs (defaults to run)
      options.command = "run";
      options.inputFile = cmd;
      i = 1;
    }
  }

  // Parse remaining args
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-o" || arg === "--output") {
      options.outputFile = args[++i];
    } else if (arg === "-q" || arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "-h" || arg === "--help") {
      options.command = "help";
    } else if (!arg.startsWith("-") && !options.inputFile) {
      options.inputFile = arg;
    } else {
      console.error(colors.red + `Unknown option: ${arg}` + colors.reset);
      process.exit(1);
    }
    i++;
  }

  return options;
}

function compile(source: string, filename: string): string {
  // Parse
  const decls = parse(source);

  // Type check
  const typed = typecheck(decls);

  // Erase comptime-only code
  const runtime = erase(typed);

  // Generate JavaScript
  return codegen(runtime);
}

function main(): void {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.command === "help") {
    printUsage();
    process.exit(0);
  }

  if (!options.inputFile) {
    console.error(colors.red + "Error: No input file specified" + colors.reset);
    printUsage();
    process.exit(1);
  }

  // Read source file
  const inputPath = path.resolve(options.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(colors.red + `Error: File not found: ${inputPath}` + colors.reset);
    process.exit(1);
  }

  const source = fs.readFileSync(inputPath, "utf-8");

  try {
    switch (options.command) {
      case "check": {
        // Just parse and type check
        const decls = parse(source);
        typecheck(decls);
        if (!options.quiet) {
          console.log(colors.green + "✓ No errors" + colors.reset);
        }
        break;
      }

      case "compile": {
        const js = compile(source, inputPath);

        if (options.outputFile) {
          const outputPath = path.resolve(options.outputFile);
          fs.writeFileSync(outputPath, js);
          if (!options.quiet) {
            console.error(colors.green + `✓ Compiled to ${outputPath}` + colors.reset);
          }
        } else {
          // Output to stdout
          process.stdout.write(js);
        }
        break;
      }

      case "run": {
        const js = compile(source, inputPath);

        if (options.verbose) {
          console.error(colors.dim + "--- Generated JavaScript ---" + colors.reset);
          console.error(colors.dim + js + colors.reset);
          console.error(colors.dim + "--- Output ---" + colors.reset);
        }

        // Run the JavaScript
        // Note: This runs in Node.js context, so console.log etc. work
        const runnable = new Function(js);
        runnable();
        break;
      }
    }
  } catch (e) {
    if (e instanceof CompileError) {
      printError(source, e);
      process.exit(1);
    }
    throw e;
  }
}

main();