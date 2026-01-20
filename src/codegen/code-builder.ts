/**
 * CodeBuilder - simple string builder with indentation support.
 *
 * Provides a fluent API for building JavaScript code with proper formatting.
 */

export class CodeBuilder {
  private parts: string[] = [];
  private indentLevel: number = 0;
  private indentStr: string;
  private atLineStart: boolean = true;

  constructor(indentStr: string = "  ") {
    this.indentStr = indentStr;
  }

  /**
   * Add content to the builder.
   * Handles indentation when at the start of a line.
   */
  write(content: string): this {
    if (content.length === 0) return this;

    // Handle content that may contain newlines
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i > 0) {
        this.parts.push("\n");
        this.atLineStart = true;
      }
      if (line.length > 0) {
        if (this.atLineStart) {
          this.parts.push(this.indentStr.repeat(this.indentLevel));
          this.atLineStart = false;
        }
        this.parts.push(line);
      }
    }
    return this;
  }

  /**
   * Add a newline.
   */
  newline(): this {
    this.parts.push("\n");
    this.atLineStart = true;
    return this;
  }

  /**
   * Add content followed by a newline.
   */
  writeLine(content: string = ""): this {
    this.write(content);
    return this.newline();
  }

  /**
   * Increase indentation level.
   */
  indent(): this {
    this.indentLevel++;
    return this;
  }

  /**
   * Decrease indentation level.
   */
  dedent(): this {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
    return this;
  }

  /**
   * Get the current indentation level.
   */
  getIndentLevel(): number {
    return this.indentLevel;
  }

  /**
   * Build the final string.
   */
  build(): string {
    return this.parts.join("");
  }

  /**
   * Clear the builder.
   */
  clear(): this {
    this.parts = [];
    this.indentLevel = 0;
    this.atLineStart = true;
    return this;
  }
}
