// Recursive functions
// According to spec, recursive functions need explicit return type annotations

const factorial = (n: Int): Int => n <= 1 ? 1 : n * factorial(n - 1);

print("factorial(5) =", factorial(5));
print("factorial(10) =", factorial(10));