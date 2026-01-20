// Pattern Matching in DepJS
// Pattern matching is exhaustive and type-safe

// Matching on literals
const describeNumber = (n: Int): String => match (n) {
  case 0: "zero";
  case 1: "one";
  case 2: "two";
  case _: "many";
};

print("0 is:", describeNumber(0));
print("1 is:", describeNumber(1));
print("5 is:", describeNumber(5));

// Matching with guards
const classify = (n: Int): String => match (n) {
  case x when x < 0: "negative";
  case 0: "zero";
  case x when x < 10: "small positive";
  case x when x < 100: "medium";
  case _: "large";
};

print("-5 is:", classify(-5));
print("0 is:", classify(0));
print("7 is:", classify(7));
print("50 is:", classify(50));
print("1000 is:", classify(1000));

// Matching on records with destructuring
type Point = { x: Int, y: Int };

const describePoint = (p: Point): String => match (p) {
  case { x: 0, y: 0 }: "origin";
  case { x: 0 }: "on y-axis";
  case { y: 0 }: "on x-axis";
  case _: "somewhere else";
};

print("(0,0):", describePoint({ x: 0, y: 0 }));
print("(0,5):", describePoint({ x: 0, y: 5 }));
print("(3,0):", describePoint({ x: 3, y: 0 }));
print("(3,4):", describePoint({ x: 3, y: 4 }));

// Matching on type patterns
const describe = (x: Int | String): String => match (x) {
  case Int: "it's a number";
  case String: "it's a string";
};

print("42 is:", describe(42));
print("hello is:", describe("hello"));
