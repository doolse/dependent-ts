// Array operations in DepJS
// DepJS is functional - use map, filter, reduce instead of loops

const nums: Int[] = [1, 2, 3, 4, 5];

// Map - transform each element
const doubled = nums.map(x => x * 2);
print("Doubled:", doubled);

// Filter - keep elements matching predicate
const evens = nums.filter(x => (x % 2) == 0);
print("Evens:", evens);

// Reduce - fold into single value
const sum = nums.reduce((acc, x) => acc + x, 0);
print("Sum:", sum);

const product = nums.reduce((acc, x) => acc * x, 1);
print("Product:", product);

// Chaining operations
const result = nums
  .filter(x => x > 2)
  .map(x => x * 10)
  .reduce((acc, x) => acc + x, 0);
print("Chained result:", result);

// Some and every
const hasEven = nums.some(x => (x % 2) == 0);
const allPositive = nums.every(x => x > 0);
print("Has even:", hasEven);
print("All positive:", allPositive);

// Find
const firstEven = nums.find(x => (x % 2) == 0);
print("First even:", firstEven);
