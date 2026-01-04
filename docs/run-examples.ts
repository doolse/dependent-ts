#!/usr/bin/env npx ts-node
/**
 * Documentation Example Runner
 *
 * Extracts and runs code examples from markdown documentation files.
 * Code blocks marked with `// @run` are extracted, executed, and their
 * output is verified against `// Output:` comments.
 *
 * Usage:
 *   npx ts-node docs/run-examples.ts [file.md]
 *
 * If no file is specified, runs all .md files in the docs directory.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CodeBlock {
  file: string;
  lineNumber: number;
  code: string;
  expectedOutputs: string[];
}

/**
 * Extract code blocks from markdown content.
 * Only extracts blocks that start with `// @run`
 */
function extractCodeBlocks(content: string, filename: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split("\n");

  let inCodeBlock = false;
  let currentCode: string[] = [];
  let blockStartLine = 0;
  let isRunnable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^```(typescript|ts)$/)) {
      inCodeBlock = true;
      currentCode = [];
      blockStartLine = i + 1;
      isRunnable = false;
    } else if (line === "```" && inCodeBlock) {
      inCodeBlock = false;

      if (isRunnable && currentCode.length > 0) {
        // Extract expected outputs from // Output: comments
        const expectedOutputs: string[] = [];
        const codeLines = currentCode.join("\n").split("\n");

        for (const codeLine of codeLines) {
          const outputMatch = codeLine.match(/\/\/\s*Output:\s*(.*)$/);
          if (outputMatch) {
            expectedOutputs.push(outputMatch[1].trim());
          }
        }

        blocks.push({
          file: filename,
          lineNumber: blockStartLine,
          code: currentCode.join("\n"),
          expectedOutputs,
        });
      }
    } else if (inCodeBlock) {
      // Check if this is a runnable block
      if (currentCode.length === 0 && line.trim() === "// @run") {
        isRunnable = true;
      }
      currentCode.push(line);
    }
  }

  return blocks;
}

/**
 * Extract imports from a code block.
 */
function extractImports(code: string): { imports: string[]; rest: string } {
  const lines = code.split("\n");
  const imports: string[] = [];
  const rest: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("import ")) {
      imports.push(line);
    } else {
      rest.push(line);
    }
  }

  return { imports, rest: rest.join("\n") };
}

/**
 * Collect all unique imports from blocks.
 */
function collectAllImports(blocks: CodeBlock[]): string[] {
  const importSet = new Set<string>();

  for (const block of blocks) {
    const { imports } = extractImports(block.code);
    for (const imp of imports) {
      // Normalize import path
      const normalized = imp.replace(/from\s+["']@dependent-ts\/core["']/, 'from "@dependent-ts/core"');
      importSet.add(normalized);
    }
  }

  return Array.from(importSet);
}

/**
 * Merge all imports into a single import statement.
 */
function mergeImports(imports: string[]): string {
  const allNames = new Set<string>();

  for (const imp of imports) {
    // Extract names from: import { a, b, c } from "..."
    const match = imp.match(/import\s*\{([^}]+)\}\s*from/);
    if (match) {
      const names = match[1].split(",").map((n) => n.trim());
      for (const name of names) {
        if (name) allNames.add(name);
      }
    }
  }

  if (allNames.size === 0) return "";

  const sortedNames = Array.from(allNames).sort();
  return `import { ${sortedNames.join(", ")} } from "../packages/core/src/index.ts";`;
}

/**
 * Generate a test file from code blocks.
 */
function generateTestCode(blocks: CodeBlock[]): string {
  // Collect and merge all imports
  const allImports = collectAllImports(blocks);
  const mergedImport = mergeImports(allImports);

  const tests: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Remove the // @run comment and imports, prepare the code
    const { rest } = extractImports(block.code);
    const codeLines = rest.split("\n");
    const filteredLines = codeLines.filter((line) => line.trim() !== "// @run");

    // Remove // Output: lines from code execution but keep track of them
    const executableLines = filteredLines.filter(
      (line) => !line.match(/\/\/\s*Output:/)
    );

    // Replace console.log calls with __capture calls
    const processedCode = executableLines
      .map((line) => {
        return line.replace(/console\.log\(/g, "__capture(");
      })
      .join("\n");

    const expectedOutputsJson = JSON.stringify(block.expectedOutputs);
    const location = `${block.file}:${block.lineNumber}`;

    tests.push(`
// Test from ${location}
(function test_${i}() {
  const __outputs: string[] = [];
  const __capture = (...args: unknown[]) => {
    __outputs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  };

  try {
${processedCode
  .split("\n")
  .map((l) => "    " + l)
  .join("\n")}

    // Check expected outputs
    const expectedOutputs: string[] = ${expectedOutputsJson};
    let failed = false;
    for (let i = 0; i < expectedOutputs.length; i++) {
      if (__outputs[i] !== expectedOutputs[i]) {
        console.error('FAIL ${location}');
        console.error('  Expected:', expectedOutputs[i]);
        console.error('  Actual:  ', __outputs[i]);
        failed = true;
        process.exitCode = 1;
      }
    }
    if (!failed) {
      console.log('PASS ${location}');
    }
  } catch (e) {
    console.error('ERROR ${location}');
    console.error('  ', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
})();
`);
  }

  return `${mergedImport}\n${tests.join("\n")}`;
}

/**
 * Main function.
 */
async function main() {
  const args = process.argv.slice(2);

  let mdFiles: string[];
  if (args.length > 0) {
    mdFiles = args;
  } else {
    const docsDir = __dirname;
    mdFiles = fs
      .readdirSync(docsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(docsDir, f));
  }

  let totalBlocks = 0;
  let passedBlocks = 0;
  let failedBlocks = 0;

  for (const mdFile of mdFiles) {
    if (!fs.existsSync(mdFile)) {
      console.error(`File not found: ${mdFile}`);
      continue;
    }

    const content = fs.readFileSync(mdFile, "utf-8");
    const blocks = extractCodeBlocks(content, path.basename(mdFile));

    if (blocks.length === 0) {
      console.log(`No runnable code blocks in ${path.basename(mdFile)}`);
      continue;
    }

    console.log(`\n📄 ${path.basename(mdFile)} (${blocks.length} examples)`);
    console.log("─".repeat(50));

    // Generate and write test file
    const testCode = generateTestCode(blocks);
    const testFile = path.join(
      path.dirname(mdFile),
      `.test-${path.basename(mdFile, ".md")}.ts`
    );
    fs.writeFileSync(testFile, testCode);

    // Run with tsx
    try {
      const output = execSync(`npx tsx ${testFile}`, {
        encoding: "utf-8",
        cwd: path.dirname(path.dirname(mdFile)),
      });
      console.log(output);

      // Count results
      const passCount = (output.match(/^PASS/gm) || []).length;
      const failCount = (output.match(/^(FAIL|ERROR)/gm) || []).length;

      passedBlocks += passCount;
      failedBlocks += failCount;
      totalBlocks += blocks.length;
    } catch (e: unknown) {
      if (e && typeof e === "object" && "stdout" in e) {
        const err = e as { stdout?: string; stderr?: string };
        console.log(err.stdout);
        if (err.stderr) console.error(err.stderr);
      }

      // Still count what we can
      const output =
        e && typeof e === "object" && "stdout" in e
          ? (e as { stdout: string }).stdout
          : "";
      const passCount = (output.match(/^PASS/gm) || []).length;
      const failCount = blocks.length - passCount;

      passedBlocks += passCount;
      failedBlocks += failCount;
      totalBlocks += blocks.length;
    } finally {
      // Clean up test file
      try {
        fs.unlinkSync(testFile);
      } catch {
        // ignore
      }
    }
  }

  // Summary
  console.log("\n" + "═".repeat(50));
  console.log(`Total: ${totalBlocks} examples`);
  console.log(`✅ Passed: ${passedBlocks}`);
  if (failedBlocks > 0) {
    console.log(`❌ Failed: ${failedBlocks}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
