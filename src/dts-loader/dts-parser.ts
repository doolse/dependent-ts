/**
 * TypeScript .d.ts Loader - Parser Module
 *
 * Uses @lezer/javascript with TypeScript dialect to parse .d.ts files.
 */

import { parser } from "@lezer/javascript";
import { Tree, TreeCursor, SyntaxNode } from "@lezer/common";

// Configure parser for TypeScript
const tsParser = parser.configure({ dialect: "ts" });

/**
 * Parse TypeScript declaration content
 */
export function parseDTS(content: string): Tree {
  return tsParser.parse(content);
}

/**
 * Debug helper: print tree structure
 */
export function printTree(tree: Tree, source: string, indent = 0): void {
  const cursor = tree.cursor();
  do {
    const node = cursor.node;
    const text = source.slice(node.from, node.to);
    const preview = text.length > 40 ? text.slice(0, 40) + "..." : text;
    const indentStr = "  ".repeat(indent);

    // Only show leaf nodes' text, or short text for containers
    if (cursor.firstChild()) {
      console.log(`${indentStr}${node.name} [${node.from}-${node.to}]`);
      printTreeFromCursor(cursor, source, indent + 1);
      cursor.parent();
    } else {
      console.log(`${indentStr}${node.name}: "${preview}"`);
    }
  } while (cursor.nextSibling());
}

function printTreeFromCursor(cursor: TreeCursor, source: string, indent: number): void {
  do {
    const node = cursor.node;
    const text = source.slice(node.from, node.to);
    const preview = text.length > 40 ? text.slice(0, 40) + "..." : text;
    const indentStr = "  ".repeat(indent);

    if (cursor.firstChild()) {
      console.log(`${indentStr}${node.name} [${node.from}-${node.to}]`);
      printTreeFromCursor(cursor, source, indent + 1);
      cursor.parent();
    } else {
      console.log(`${indentStr}${node.name}: "${preview}"`);
    }
  } while (cursor.nextSibling());
}

/**
 * Get text content of a node
 */
export function getText(cursor: TreeCursor, source: string): string {
  return source.slice(cursor.from, cursor.to);
}

/**
 * Find child node by name
 */
export function findChild(cursor: TreeCursor, name: string): boolean {
  if (cursor.firstChild()) {
    do {
      if (cursor.name === name) {
        return true;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }
  return false;
}

/**
 * Iterate over all children with given name
 */
export function* findChildren(
  cursor: TreeCursor,
  name: string
): Generator<TreeCursor> {
  if (cursor.firstChild()) {
    do {
      if (cursor.name === name) {
        yield cursor;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

/**
 * Get all direct children
 */
export function* getChildren(cursor: TreeCursor): Generator<{ name: string; from: number; to: number }> {
  if (cursor.firstChild()) {
    do {
      yield { name: cursor.name, from: cursor.from, to: cursor.to };
    } while (cursor.nextSibling());
    cursor.parent();
  }
}
