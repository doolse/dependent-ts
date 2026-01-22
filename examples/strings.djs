// String operations in DepJS
// Comprehensive string method examples

const greeting: String = "  Hello, World!  ";
const message: String = "The quick brown fox jumps over the lazy dog";

// Length property
print("Length of greeting:", greeting.length);

// Case conversion
print("Upper:", greeting.toUpperCase());
print("Lower:", greeting.toLowerCase());

// Trimming whitespace
print("Trimmed:", greeting.trim());
print("Trim start:", greeting.trimStart());
print("Trim end:", greeting.trimEnd());

// Character access
print("Char at 2:", greeting.charAt(2));
print("Char code at 2:", greeting.charCodeAt(2));

// Substring extraction
print("Substring(2, 7):", greeting.substring(2, 7));
print("Slice(2, 7):", greeting.slice(2, 7));
print("Slice(-6, -1):", greeting.slice(-6, -1));  // Negative indices

// Searching
print("Index of 'o':", message.indexOf("o"));
print("Last index of 'o':", message.lastIndexOf("o"));
print("Includes 'fox':", message.includes("fox"));
print("Includes 'cat':", message.includes("cat"));
print("Starts with 'The':", message.startsWith("The"));
print("Ends with 'dog':", message.endsWith("dog"));

// Splitting
const words = message.split(" ");
print("Words:", words);
print("Word count:", words.length);

const chars = "hello".split("");
print("Characters:", chars);

// Replacement
print("Replace 'fox' with 'cat':", message.replace("fox", "cat"));
print("Replace all 'o' with '0':", message.replaceAll("o", "0"));

// Padding
const num: String = "42";
print("Pad start:", num.padStart(5, "0"));  // "00042"
print("Pad end:", num.padEnd(5, "-"));      // "42---"

// Repetition
print("Repeat:", "ab".repeat(3));  // "ababab"

// Concatenation
print("Concat:", "Hello".concat(", ", "World", "!"));

// Chaining operations
const processed = "  HELLO WORLD  "
  .trim()
  .toLowerCase()
  .replace("world", "DepJS");
print("Chained:", processed);

// Practical example: simple word processor
const text: String = "  The Quick Brown FOX  ";
const normalized = text.trim().toLowerCase();
const titleCased = normalized.charAt(0).toUpperCase().concat(normalized.slice(1));
print("Title case:", titleCased);

// Parsing example: extract parts from a path
const path: String = "/users/admin/documents/file.txt";
const parts = path.split("/").filter(p => p.length > 0);
print("Path parts:", parts);

const filename = parts[parts.length - 1];
const dotIndex = filename.lastIndexOf(".");
const name = filename.slice(0, dotIndex);
const ext = filename.slice(dotIndex + 1);
print("Filename:", name);
print("Extension:", ext);
