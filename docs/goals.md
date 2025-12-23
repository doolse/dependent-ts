A functional language which is compatible with the TypeScript type definitions.

* Everything that can be done using typescript type syntaxes should be possible in standard syntax
* Expression should be able to forced to be known at compile time - e.g. all compile time reflection must be known
* Type inference
* Compile time reflection 
* Type safety
* Give power to the API designer to provide good error messages
* Source language doesn't allow mutation but generated code can use it as optimization when types prove it
* Use a single primitive collection type (array) but specialize based on operations performed
* Produce optimized code by partial evaluation and specialization
* Refinement types - SMT solver?

## Ideas
* Easy DSLs by using an implicit environment parameter
* Instead of creating type classes with different syntax, use the standard syntax and compile time reflection with global registries of types
  * How to add handler for a new type in an immutable way?

