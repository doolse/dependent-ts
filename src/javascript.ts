export interface JSUndefined {
  type: "undefined";
}
export interface JSPrimExpr {
  type: "prim";
  value: any;
}
export interface JSInfixOp {
  type: "infix";
  op: string;
  left: JSExpr;
  right: JSExpr;
}

export interface JSFieldRef {
  type: "fieldRef";
  left: JSExpr;
  right: JSExpr;
}

export interface JSSymbol {
  type: "symbol";
  name: string;
}

export interface JSReturn {
  type: "return";
  expr: JSExpr;
}

export interface JSLet {
  type: "let";
  name: string;
  value: JSExpr;
}

export interface JSFuncExpr {
  type: "func";
  definition: JSFunctionDef;
}

export type JSExpr =
  | JSPrimExpr
  | JSInfixOp
  | JSSymbol
  | JSFieldRef
  | JSUndefined
  | JSFuncExpr;
export type JSStatement = JSReturn | JSLet;

export interface JSFunctionDef {
  name: string;
  args: string[];
  body: JSStatement[];
}

export function emptyFunction(): JSFunctionDef {
  return { name: "", args: [], body: [] };
}

export function appendReturn(
  funcDef: JSFunctionDef,
  ret: JSExpr
): JSFunctionDef {
  return {
    ...funcDef,
    body: funcDef.body.concat([{ type: "return", expr: ret }])
  };
}

export function expr2string(t: JSExpr): string {
  switch (t.type) {
    case "infix":
      return `${expr2string(t.left)} ${t.op} ${expr2string(t.right)}`;
    case "fieldRef":
      return `${expr2string(t.left)}.${expr2string(t.right)}`;
    case "prim":
      if (typeof t.value == "string") {
        return `"${t.value}"`;
      }
      return t.value.toString();
    case "symbol":
      return t.name;
    case "func":
      return func2string(t.definition);
    case "undefined":
      return "undefined";
  }
}

export function stmt2string(stmt: JSStatement): string {
  switch (stmt.type) {
    case "let":
      return `let ${stmt.name} = ${expr2string(stmt.value)};`;
    case "return":
      return `return ${expr2string(stmt.expr)};`;
  }
}

export function func2string(func: JSFunctionDef): string {
  return (
    `function ${func.name}(${func.args.join(", ")}) {\n` +
    func.body.map(stmt2string).join("\n") +
    "\n}\n"
  );
}

export function newArg(func: JSFunctionDef, preferred: string): string {
  var count = 1;
  const args = func.args;
  while (count < 10) {
    const name = count > 1 ? `${preferred}${count}` : preferred;
    if (args.indexOf(name) < 0) {
      args.push(name);
      return name;
    }
    count++;
  }
  throw "Too many labels start with " + preferred;
}
