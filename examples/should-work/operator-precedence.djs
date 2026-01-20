// Operator precedence
// Standard mathematical precedence: * before +, == after arithmetic

const a = 1 + 2 * 3;  // Should be 7, not 9
print("1 + 2 * 3 =", a);
assert(a == 7, "Expected 7");

const b = 4 * 5 + 6;  // Should be 26
print("4 * 5 + 6 =", b);
assert(b == 26, "Expected 26");

const c = 10 % 3 == 1;  // Should be true (10 % 3 = 1, 1 == 1)
print("10 % 3 == 1 is", c);
assert(c, "Expected true");