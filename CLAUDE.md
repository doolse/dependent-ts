I# CLAUDE.md

This file provides guidance to Claude Code when working on this language specification project.

## Project Overview

DepJS is a new programming language with these known design goals (from initial-ideas.txt):

- **Functional JavaScript subset**: No explicit loops
- **Target language**: JavaScript
- **Implementation language**: TypeScript
- **Type system**: As powerful as TypeScript, with:
  - First-class types that can be manipulated in the language
  - Types erased at runtime unless explicitly reified
- **Simple type annotation syntax**: e.g., `const x : Int = 1`
- **Compile-time assertions**: Must be checkable at compile time

## Working on the Specification

### Principles

1. **Under-specify rather than over-specify**: If something hasn't been decided, mark it as TODO rather than inventing details
2. **Ask before assuming**: When a design decision is unclear, ask the user rather than guessing
3. **Show examples**: Use concrete code examples to illustrate features
4. **Track unknowns**: Clearly mark open questions and unresolved decisions

### When Writing Spec Sections

- Only document what has been explicitly decided
- Use `TODO:` markers for undecided details
- Use `OPEN QUESTION:` for decisions that need user input
- Include rationale for decisions when known

## Spec Files

- `spec/syntax.md` - Core syntax decisions (established)

Create additional spec files as topics are discussed and decided. Don't create placeholder files with invented content.

## Decided

- **Base syntax**: JavaScript-like with curly braces, semicolons required
- **Functions**: Standard JS syntax (arrow functions, function declarations)
- **Type annotations**: TypeScript-style (colon after name)
- **Bindings**: `const` only (immutable)
- **Generics**: Angle brackets `<T>`
- **Data types**: `interface` keyword
- **Sum types**: TypeScript-style discriminated unions with tag property
- **Pattern matching**: `match` expression with `case` clauses, semicolon separated
- **Iteration**: Method chaining (map, filter, reduce, etc.)
- **Modules**: ES modules
- **Compile-time assertions**: `assert` keyword

## Open Questions

These need to be resolved through discussion:

- TODO: Exact syntax for first-class type manipulation (leaning towards `type` keyword)
- TODO: How pattern matching works with discriminated unions
- TODO: What can be asserted with `assert`
- TODO: How to handle side effects (pure functional vs controlled effects)
- TODO: Error handling model
- TODO: JavaScript interop story
- TODO: Async handling
- TODO: Operations available on reified types