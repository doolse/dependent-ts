# Test Over-simplifications to Review

These tests in `test/specialization/code-generation.test.ts` were simplified in commit b5ff909 but lost important coverage for `typeOf`-based specialization patterns.

## Background

The original tests used `fn(T, value)` pattern which doesn't work (type parameters can't be mixed with runtime values). Instead of replacing with the working `typeOf(value)` pattern, they were simplified to use object discriminants with parameter lifting.

The correct pattern that demonstrates type-directed specialization:
```javascript
let fn = fn(value) =>
  let T = typeOf(value) in
  if T == number then /* operation A */
  else if T == string then /* operation B */
  ...
```

---

## 1. Serialization test (line 135)

**Current test name**: `"handles type marker with comptime and parameter lifting"`

**Issue**: Uses object discriminant with same structure for all branches, resulting in parameter lifting only (one function with `_p0` parameter).

**Should demonstrate**: `typeOf`-based specialization with different operations per type:
- number: `value.toString()`
- string: `"str:" + value`
- boolean: `value ? "true" : "false"`

**Expected output**: `serializeField$0`, `serializeField$1`, `serializeField$2`

---

## 2. Parser test (line 174)

**Current test name**: `"specializes parser tag based on expected type"`

**Issue**: Pure comptime with no runtime values - just returns string literals. Doesn't demonstrate actual parsing of runtime input.

**Should demonstrate**: `typeOf`-based parsing with different operations on runtime input:
- number: `input * 2` (or similar numeric operation)
- boolean: `input ? 1 : 0`
- string: `input + "!"`

**Expected output**: `parseAs$0`, `parseAs$1`, `parseAs$2`

---

## 3. Template test (line 194)

**Current test name**: `"handles template with comptime and parameter lifting"`

**Issue**: Uses object discriminant with same structure (`{ class: X, value: item.data }`), resulting in parameter lifting only.

**Should demonstrate**: `typeOf`-based templating with different rendering operations per type:
- number: wrap in `<span class="number">` with `.toString()`
- string: wrap in `<span class="text">` directly
- etc.

**Expected output**: `template$0`, `template$1`

---

## Verification

To verify a pattern produces specialization, check that the generated code contains numbered function variants (e.g., `fn$0`, `fn$1`) rather than a single function with lifted parameters (`_p0`).

Example working pattern:
```javascript
let process = fn(value) =>
  let T = typeOf(value) in
  if T == number then value * 2
  else value + "!"
in
let n = trust(runtime(n: 42), number) in
let s = trust(runtime(s: "hi"), string) in
[process(n), process(s)]
```

This produces:
```javascript
const process$0 = (value) => value * 2;
const process$1 = (value) => value + "!";
```