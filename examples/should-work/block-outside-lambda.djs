// Block expressions outside lambda bodies
// Per spec: blocks should work in any expression position

const result = {
  const x = 10;
  const y = 20;
  x + y
};

print("result =", result);