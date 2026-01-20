// Template literals inside match expressions
// Template literals should work in any expression context

const describe = (n: Int): String => match (n) {
  case 0: `zero`;
  case 1: `one`;
  case x: `number ${x}`;
};

print(describe(0));
print(describe(1));
print(describe(42));