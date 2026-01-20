// Generic function expressions
// Per spec: <T>(x: T) => x should work

const identity = <T>(x: T): T => x;

print(identity(42));
print(identity("hello"));
print(identity(true));