// Functions in DepJS
// All functions are lambdas (arrow functions)
// DepJS is pure functional - no loops, use recursion and higher-order functions

// Basic function
const add = (a: Int, b: Int): Int => a + b;
print("2 + 3 =", add(2, 3));

// Function with default parameter
const greet = (name: String, greeting: String = "Hello"): String =>
  `${greeting}, ${name}!`;

print(greet("World"));
print(greet("DepJS", "Welcome to"));

// Higher-order functions
const twice = (f: (x: Int) => Int, x: Int): Int => f(f(x));
const increment = (x: Int): Int => x + 1;

print("twice(increment, 5) =", twice(increment, 5));

// Function returning function (currying)
const multiplier = (n: Int): (x: Int) => Int => (x: Int): Int => x * n;
const triple = multiplier(3);
print("triple(7) =", triple(7));

// Composition
const compose = (f: (x: Int) => Int, g: (x: Int) => Int): (x: Int) => Int =>
  (x: Int): Int => f(g(x));

const addOne = (x: Int): Int => x + 1;
const double = (x: Int): Int => x * 2;
const addOneThenDouble = compose(double, addOne);

print("addOneThenDouble(5) =", addOneThenDouble(5));

// Rest parameters
const sum = (...nums: Int[]): Int => nums.reduce((a, b) => a + b, 0);
print("sum(1, 2, 3, 4, 5) =", sum(1, 2, 3, 4, 5));

// Block expressions in function bodies
const compute = (): Int => {
  const a = 10;
  const b = 20;
  const c = a + b;
  c * 2
};

print("compute() =", compute());
