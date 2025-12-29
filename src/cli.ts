#!/usr/bin/env node
/**
 * Compiler CLI for the dependent-ts language.
 *
 * Usage:
 *   depsc <input-file> [options]
 *   depsc --help
 *
 * Options:
 *   -o, --output <file>    Output file path (default: stdout)
 *   --no-module            Don't wrap as ES module (raw expression)
 *   --typescript           Generate TypeScript output
 *   --iife                 Wrap in an IIFE
 *   -h, --help             Show help
 */

import * as fs from "fs";
import * as path from "path";
import { parse } from "./parser";
import { compile, CodeGenOptions } from "./codegen";
import { stage, StagingError } from "./staged-evaluate";
import { generateESModule } from "./svalue-module-generator";
import { printModule } from "./js-printer";
import { LexerError } from "./lexer";
import { ParseError } from "./parser";
import { TypeError } from "./builtins";

interface CliOptions {
  inputFile: string;
  outputFile: string | null;
  asModule: boolean;
  typescript: boolean;
  iife: boolean;
}

function printHelp(): void {
  console.log(`
dependent-ts compiler

Usage:
  depsc <input-file> [options]

Options:
  -o, --output <file>    Output file path (default: stdout)
  --no-module            Don't wrap as ES module (raw expression)
  --typescript           Generate TypeScript output
  --iife                 Wrap in an IIFE
  -h, --help             Show this help

Examples:
  depsc main.dep -o main.js
  depsc lib.dep --typescript -o lib.ts
  depsc script.dep --no-module
`);
}

function parseArgs(args: string[]): CliOptions | null {
  const options: CliOptions = {
    inputFile: "",
    outputFile: null,
    asModule: true,
    typescript: false,
    iife: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "-o" || arg === "--output") {
      i++;
      if (i >= args.length) {
        console.error("Error: --output requires a file path");
        return null;
      }
      options.outputFile = args[i];
    } else if (arg === "--no-module") {
      options.asModule = false;
    } else if (arg === "--typescript") {
      options.typescript = true;
    } else if (arg === "--iife") {
      options.iife = true;
    } else if (arg.startsWith("-")) {
      console.error(`Error: Unknown option: ${arg}`);
      return null;
    } else {
      if (options.inputFile) {
        console.error("Error: Multiple input files not supported");
        return null;
      }
      options.inputFile = arg;
    }
    i++;
  }

  if (!options.inputFile) {
    console.error("Error: No input file specified");
    printHelp();
    return null;
  }

  return options;
}

function formatError(error: unknown, filePath: string): string {
  if (error instanceof LexerError) {
    return `${filePath}: Lexer error: ${error.message}`;
  }

  if (error instanceof ParseError) {
    return `${filePath}: Parse error: ${error.message}`;
  }

  if (error instanceof TypeError) {
    return `${filePath}: Type error: ${error.message}`;
  }

  if (error instanceof StagingError) {
    return `${filePath}: Staging error: ${error.message}`;
  }

  if (error instanceof Error) {
    return `${filePath}: ${error.message}`;
  }

  return `${filePath}: Unknown error: ${String(error)}`;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    process.exit(1);
  }

  const options = parseArgs(args);
  if (!options) {
    process.exit(1);
  }

  // Read input file
  const inputPath = path.resolve(options.inputFile);
  let source: string;
  try {
    source = fs.readFileSync(inputPath, "utf-8");
  } catch (err) {
    console.error(`Error reading file: ${inputPath}`);
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(1);
  }

  // Compile
  const codeGenOptions: CodeGenOptions = {
    typescript: options.typescript,
    wrapInIIFE: options.iife,
  };

  let output: string;
  try {
    const expr = parse(source);

    if (options.asModule) {
      // Stage the expression and generate ES module
      const result = stage(expr);
      const jsModule = generateESModule(result.svalue);
      output = printModule(jsModule);
    } else {
      output = compile(expr, codeGenOptions);
    }
  } catch (err) {
    console.error(formatError(err, options.inputFile));
    process.exit(1);
  }

  // Write output
  if (options.outputFile) {
    const outputPath = path.resolve(options.outputFile);
    try {
      fs.writeFileSync(outputPath, output);
      console.error(`Compiled ${options.inputFile} -> ${options.outputFile}`);
    } catch (err) {
      console.error(`Error writing file: ${outputPath}`);
      if (err instanceof Error) {
        console.error(err.message);
      }
      process.exit(1);
    }
  } else {
    process.stdout.write(output);
  }
}

main();
