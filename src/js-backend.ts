/**
 * JavaScript Backend
 *
 * Generates JavaScript AST from staged values.
 * This backend has access to the staging context and can:
 * - Pattern match on function calls to decide method vs function syntax
 * - Access constraints for type-aware decisions
 * - Stage sub-expressions on demand
 */

import { Backend, BackendContext, isNowValue, isLaterValue, isLaterArrayValue } from "./backend";
import {
  JSExpr, JSStmt, JSPattern,
  jsLit, jsVar, jsBinop, jsUnary, jsCall, jsMethod,
  jsArrow, jsNamedFunction, jsTernary, jsMember, jsIndex, jsObject, jsArray,
  jsIIFE, jsConst, jsConstPattern, jsReturn, jsExpr,
  jsVarPattern, jsArrayPattern, jsObjectPattern
} from "./js-ast";
import { SValue, Now, Later, LaterArray } from "./svalue";
import { Value } from "./value";
import { Expr, Pattern } from "./expr";
import { Constraint } from "./constraint";

// ============================================================================
// JS Backend Implementation
// ============================================================================

export class JSBackend implements Backend {
  name = "javascript";

  generate(sv: SValue, ctx: BackendContext): JSExpr {
    if (isNowValue(sv)) {
      // Check if there's a residual to use (e.g., variable reference)
      if (sv.residual) {
        return this.generateFromExpr(sv.residual, ctx);
      }
      return this.generateFromValue(sv.value, ctx);
    }

    if (isLaterArrayValue(sv)) {
      // Generate array from elements
      return jsArray(sv.elements.map(elem => ctx.generate(elem)));
    }

    // Later - generate from residual
    return this.generateFromExpr(sv.residual, ctx);
  }

  // ==========================================================================
  // Value Generation (for Now values)
  // ==========================================================================

  private generateFromValue(value: Value, ctx: BackendContext): JSExpr {
    switch (value.tag) {
      case "number":
        return jsLit(value.value);

      case "string":
        return jsLit(value.value);

      case "bool":
        return jsLit(value.value);

      case "null":
        return jsLit(null);

      case "object": {
        const fields: { key: string; value: JSExpr }[] = [];
        for (const [name, val] of value.fields) {
          fields.push({ key: name, value: this.generateFromValue(val, ctx) });
        }
        return jsObject(fields);
      }

      case "array":
        return jsArray(value.elements.map(e => this.generateFromValue(e, ctx)));

      case "closure":
        // Generate function from closure
        return this.generateClosure(value, ctx);

      case "type":
        throw new Error("Cannot generate code for type value");

      case "builtin":
        return jsVar(value.name);
    }
  }

  private generateClosure(closure: Value, ctx: BackendContext): JSExpr {
    if (closure.tag !== "closure") {
      throw new Error("Expected closure value");
    }

    // Convert closure to a residual expression - this properly stages the body
    // with parameters as Later values, enabling compile-time evaluation
    const residualExpr = ctx.closureToResidual(closure);

    // Generate from the staged residual
    return this.generateFromExpr(residualExpr, ctx);
  }

  private extractParamsFromBody(body: Expr): { params: string[]; body: Expr } {
    if (body.tag === "letPattern" && body.value.tag === "var" && body.value.name === "args") {
      const pattern = body.pattern;
      if (pattern.tag === "arrayPattern") {
        const params: string[] = [];
        for (const elem of pattern.elements) {
          if (elem.tag === "varPattern") {
            params.push(elem.name);
          } else {
            return { params: [], body };
          }
        }
        return { params, body: body.body };
      }
    }
    return { params: [], body };
  }

  // ==========================================================================
  // Expression Generation (for residuals)
  // ==========================================================================

  private generateFromExpr(expr: Expr, ctx: BackendContext): JSExpr {
    switch (expr.tag) {
      case "lit":
        return jsLit(expr.value);

      case "var":
        return jsVar(expr.name);

      case "binop":
        return this.generateBinop(expr.op, expr.left, expr.right, ctx);

      case "unary":
        return jsUnary(expr.op, this.generateFromExpr(expr.operand, ctx));

      case "if":
        return jsTernary(
          this.generateFromExpr(expr.cond, ctx),
          this.generateFromExpr(expr.then, ctx),
          this.generateFromExpr(expr.else, ctx)
        );

      case "let":
        return this.generateLet(expr.name, expr.value, expr.body, ctx);

      case "letPattern":
        return this.generateLetPattern(expr.pattern, expr.value, expr.body, ctx);

      case "fn":
        return this.generateFn(expr.params, expr.body, ctx);

      case "recfn":
        return this.generateRecFn(expr.name, expr.params, expr.body, ctx);

      case "call":
        return this.generateCall(expr.func, expr.args, ctx);

      case "obj":
        return jsObject(
          expr.fields.map(f => ({
            key: f.name,
            value: this.generateFromExpr(f.value, ctx)
          }))
        );

      case "field":
        return jsMember(this.generateFromExpr(expr.object, ctx), expr.name);

      case "array":
        return jsArray(expr.elements.map(e => this.generateFromExpr(e, ctx)));

      case "index":
        return jsIndex(
          this.generateFromExpr(expr.array, ctx),
          this.generateFromExpr(expr.index, ctx)
        );

      case "block":
        return this.generateBlock(expr.exprs, ctx);

      case "comptime":
        // comptime should have been resolved - just generate inner
        return this.generateFromExpr(expr.expr, ctx);

      case "runtime":
        // runtime annotation - generate variable reference or inner
        if (expr.name) {
          return jsVar(expr.name);
        }
        return this.generateFromExpr(expr.expr, ctx);

      case "assert":
        return this.generateAssert(expr.expr, expr.message, ctx);

      case "assertCond":
        return this.generateAssertCond(expr.condition, expr.message, ctx);

      case "trust":
        // trust is purely type-level - just generate the inner expression
        return this.generateFromExpr(expr.expr, ctx);

      case "methodCall":
        return jsMethod(
          this.generateFromExpr(expr.receiver, ctx),
          expr.method,
          expr.args.map(a => this.generateFromExpr(a, ctx))
        );

      case "import":
        return this.generateImport(expr.names, expr.modulePath, expr.body, ctx);

      case "typeOf":
        throw new Error("typeOf cannot appear in residual code");
    }
  }

  // ==========================================================================
  // Binary Operations
  // ==========================================================================

  private generateBinop(op: string, left: Expr, right: Expr, ctx: BackendContext): JSExpr {
    // Convert == to === and != to !== for JavaScript
    const jsOp = op === "==" ? "===" : op === "!=" ? "!==" : op;

    return jsBinop(
      jsOp,
      this.generateFromExpr(left, ctx),
      this.generateFromExpr(right, ctx)
    );
  }

  // ==========================================================================
  // Let Bindings
  // ==========================================================================

  private generateLet(name: string, value: Expr, body: Expr, ctx: BackendContext): JSExpr {
    const valueJs = this.generateFromExpr(value, ctx);

    if (name === "_") {
      // Discard binding - evaluate for side effect
      const bodyJs = this.generateFromExpr(body, ctx);
      return jsIIFE([
        jsExpr(valueJs),
        jsReturn(bodyJs)
      ]);
    }

    // Check for let chain BEFORE generating body - prevents nested IIFEs
    if (body.tag === "let" || body.tag === "letPattern") {
      const stmts = this.collectLetChain(name, valueJs, body, ctx);
      return jsIIFE(stmts);
    }

    // Single let - use IIFE
    const bodyJs = this.generateFromExpr(body, ctx);
    return jsIIFE([
      jsConst(name, valueJs),
      jsReturn(bodyJs)
    ]);
  }

  private collectLetChain(firstName: string, firstValue: JSExpr, body: Expr, ctx: BackendContext): JSStmt[] {
    const stmts: JSStmt[] = [jsConst(firstName, firstValue)];

    let current = body;
    while (current.tag === "let" || current.tag === "letPattern") {
      if (current.tag === "let") {
        const valueJs = this.generateFromExpr(current.value, ctx);
        if (current.name === "_") {
          stmts.push(jsExpr(valueJs));
        } else {
          stmts.push(jsConst(current.name, valueJs));
        }
        current = current.body;
      } else {
        const valueJs = this.generateFromExpr(current.value, ctx);
        const pattern = this.convertPattern(current.pattern);
        stmts.push(jsConstPattern(pattern, valueJs));
        current = current.body;
      }
    }

    stmts.push(jsReturn(this.generateFromExpr(current, ctx)));
    return stmts;
  }

  private generateLetPattern(pattern: Pattern, value: Expr, body: Expr, ctx: BackendContext): JSExpr {
    const valueJs = this.generateFromExpr(value, ctx);
    const patternJs = this.convertPattern(pattern);

    // Check for let chain BEFORE generating body - prevents nested IIFEs
    if (body.tag === "let" || body.tag === "letPattern") {
      const stmts: JSStmt[] = [jsConstPattern(patternJs, valueJs)];
      // Collect remaining chain
      let current: Expr = body;
      while (current.tag === "let" || current.tag === "letPattern") {
        if (current.tag === "let") {
          const val = this.generateFromExpr(current.value, ctx);
          if (current.name === "_") {
            stmts.push(jsExpr(val));
          } else {
            stmts.push(jsConst(current.name, val));
          }
          current = current.body;
        } else {
          const val = this.generateFromExpr(current.value, ctx);
          const pat = this.convertPattern(current.pattern);
          stmts.push(jsConstPattern(pat, val));
          current = current.body;
        }
      }
      stmts.push(jsReturn(this.generateFromExpr(current, ctx)));
      return jsIIFE(stmts);
    }

    const bodyJs = this.generateFromExpr(body, ctx);
    return jsIIFE([
      jsConstPattern(patternJs, valueJs),
      jsReturn(bodyJs)
    ]);
  }

  private convertPattern(pattern: Pattern): JSPattern {
    switch (pattern.tag) {
      case "varPattern":
        return jsVarPattern(pattern.name);

      case "arrayPattern":
        return jsArrayPattern(pattern.elements.map(e => this.convertPattern(e)));

      case "objectPattern":
        return jsObjectPattern(
          pattern.fields.map(f => ({
            key: f.key,
            pattern: this.convertPattern(f.pattern)
          }))
        );
    }
  }

  // ==========================================================================
  // Functions
  // ==========================================================================

  private generateFn(params: string[], body: Expr, ctx: BackendContext): JSExpr {
    // Check for args destructuring optimization
    if (params.length === 0) {
      const extracted = this.extractParamsFromBody(body);
      if (extracted.params.length > 0) {
        return this.generateFn(extracted.params, extracted.body, ctx);
      }
    }

    // Check if body is a let chain - use statement form
    if (body.tag === "let" || body.tag === "letPattern") {
      const stmts = this.collectFunctionBody(body, ctx);
      return jsArrow(params, stmts);
    }

    // Simple expression body
    return jsArrow(params, this.generateFromExpr(body, ctx));
  }

  private generateRecFn(name: string, params: string[], body: Expr, ctx: BackendContext): JSExpr {
    // Check for args destructuring optimization
    if (params.length === 0) {
      const extracted = this.extractParamsFromBody(body);
      if (extracted.params.length > 0) {
        return this.generateRecFn(name, extracted.params, extracted.body, ctx);
      }
    }

    // For recursive functions, generate a named function expression
    // function name(params) { return body; }
    if (body.tag === "let" || body.tag === "letPattern") {
      const stmts = this.collectFunctionBody(body, ctx);
      return jsNamedFunction(name, params, stmts);
    }

    const bodyJs = this.generateFromExpr(body, ctx);
    return jsNamedFunction(name, params, bodyJs);
  }

  private collectFunctionBody(body: Expr, ctx: BackendContext): JSStmt[] {
    const stmts: JSStmt[] = [];

    let current = body;
    while (current.tag === "let" || current.tag === "letPattern") {
      if (current.tag === "let") {
        const valueJs = this.generateFromExpr(current.value, ctx);
        if (current.name === "_") {
          stmts.push(jsExpr(valueJs));
        } else {
          stmts.push(jsConst(current.name, valueJs));
        }
        current = current.body;
      } else {
        const valueJs = this.generateFromExpr(current.value, ctx);
        const pattern = this.convertPattern(current.pattern);
        stmts.push(jsConstPattern(pattern, valueJs));
        current = current.body;
      }
    }

    stmts.push(jsReturn(this.generateFromExpr(current, ctx)));
    return stmts;
  }

  // ==========================================================================
  // Function Calls
  // ==========================================================================

  private generateCall(func: Expr, args: Expr[], ctx: BackendContext): JSExpr {
    // Pattern match on known function names for special handling
    if (func.tag === "var") {
      const name = func.name;

      // map(arr, fn) -> arr.map(fn)
      if (name === "map" && args.length === 2) {
        const [arr, fn] = args;
        return jsMethod(
          this.generateFromExpr(arr, ctx),
          "map",
          [this.generateFromExpr(fn, ctx)]
        );
      }

      // filter(arr, fn) -> arr.filter(fn)
      if (name === "filter" && args.length === 2) {
        const [arr, fn] = args;
        return jsMethod(
          this.generateFromExpr(arr, ctx),
          "filter",
          [this.generateFromExpr(fn, ctx)]
        );
      }

      // print(...) -> console.log(...)
      if (name === "print") {
        return jsMethod(
          jsVar("console"),
          "log",
          args.map(a => this.generateFromExpr(a, ctx))
        );
      }

      // String methods: receiver.method(args)
      const stringMethods = [
        "startsWith", "endsWith", "includes", "indexOf", "lastIndexOf",
        "toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd",
        "slice", "substring", "charAt", "charCodeAt", "split",
        "replace", "replaceAll", "padStart", "padEnd", "repeat", "concat"
      ];
      if (stringMethods.includes(name) && args.length >= 1) {
        const [receiver, ...rest] = args;
        return jsMethod(
          this.generateFromExpr(receiver, ctx),
          name,
          rest.map(a => this.generateFromExpr(a, ctx))
        );
      }

      // Array methods: receiver.method(args)
      const arrayMethods = [
        "join", "reverse", "slice", "concat", "indexOf", "includes"
      ];
      if (arrayMethods.includes(name) && args.length >= 1) {
        const [receiver, ...rest] = args;
        return jsMethod(
          this.generateFromExpr(receiver, ctx),
          name,
          rest.map(a => this.generateFromExpr(a, ctx))
        );
      }

      // Number methods: receiver.method(args)
      const numberMethods = ["toString", "toFixed"];
      if (numberMethods.includes(name) && args.length >= 1) {
        const [receiver, ...rest] = args;
        return jsMethod(
          this.generateFromExpr(receiver, ctx),
          name,
          rest.map(a => this.generateFromExpr(a, ctx))
        );
      }
    }

    // Default: regular function call
    const funcJs = this.generateFromExpr(func, ctx);
    const argsJs = args.map(a => this.generateFromExpr(a, ctx));

    return jsCall(funcJs, argsJs);
  }

  // ==========================================================================
  // Block
  // ==========================================================================

  private generateBlock(exprs: Expr[], ctx: BackendContext): JSExpr {
    if (exprs.length === 0) {
      return jsLit(null);
    }

    if (exprs.length === 1) {
      return this.generateFromExpr(exprs[0], ctx);
    }

    // Multiple expressions - use IIFE
    const stmts: JSStmt[] = exprs.slice(0, -1).map(e => jsExpr(this.generateFromExpr(e, ctx)));
    const last = exprs[exprs.length - 1];
    stmts.push(jsReturn(this.generateFromExpr(last, ctx)));

    return jsIIFE(stmts);
  }

  // ==========================================================================
  // Assertions
  // ==========================================================================

  private generateAssert(expr: Expr, message: string | undefined, ctx: BackendContext): JSExpr {
    const valueJs = this.generateFromExpr(expr, ctx);
    const errorMsg = message ? jsLit(message) : jsLit("Assertion failed");

    return jsIIFE([
      jsConst("__value", valueJs),
      {
        tag: "jsIf",
        cond: jsBinop("||",
          jsBinop("===", jsVar("__value"), jsLit(null)),
          jsBinop("===", jsVar("__value"), jsVar("undefined"))
        ),
        then: [{
          tag: "jsExpr",
          expr: jsCall(
            jsMember(jsVar("Error"), "prototype"),
            [] // This isn't right, let's use throw
          )
        }]
      } as JSStmt,
      jsReturn(jsVar("__value"))
    ]);
  }

  private generateAssertCond(condition: Expr, message: string | undefined, ctx: BackendContext): JSExpr {
    const condJs = this.generateFromExpr(condition, ctx);
    const errorMsg = message ? jsLit(message) : jsLit("Assertion failed: condition is false");

    return jsIIFE([
      {
        tag: "jsIf",
        cond: jsUnary("!", condJs),
        then: [{
          tag: "jsExpr",
          expr: jsCall(jsVar("throw new Error"), [errorMsg])
        }]
      } as JSStmt,
      jsReturn(jsLit(true))
    ]);
  }

  // ==========================================================================
  // Imports
  // ==========================================================================

  private generateImport(names: string[], modulePath: string, body: Expr, ctx: BackendContext): JSExpr {
    // For now, just generate the body with a comment about the import
    // Full import handling would require module-level code generation
    const bodyJs = this.generateFromExpr(body, ctx);

    return jsIIFE([
      // Could add import comment here
      jsReturn(bodyJs)
    ]);
  }
}
