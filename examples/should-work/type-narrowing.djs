// Type narrowing in pattern matching
// After matching a discriminant, the type should be narrowed

type Circle = { kind: "circle", radius: Int };
type Rectangle = { kind: "rectangle", width: Int, height: Int };
type Shape = Circle | Rectangle;

const area = (s: Shape): Int => match (s) {
  case { kind: "circle" }: s.radius * s.radius * 3;
  case { kind: "rectangle" }: s.width * s.height;
};

const circle: Shape = { kind: "circle", radius: 5 };
print("Circle area:", area(circle));