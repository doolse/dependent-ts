// Block expressions outside lambda bodies
// Use 'do { }' syntax for block expressions in expression position

const result = do {
  const x = 10;
  const y = 20;
  x + y
};

print("result =", result);