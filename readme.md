```haskell

add2(l, r) = (+)(l, r)

let l = args.l
let r = args.r
apply((+), l, r)

+[A: any](l: A, r: A): A
args.l

```

Irreducible Primitive Types:
number
string
boolean

compound irreducible
function

function application

<!-- Reducible Types:
expression = "reference" | let "new_reference" = expression in expression -->

```ml
main()
{
    let s = 2
    in hello(s + 6)
}

function hello(s)
{
    s + 5
}

let s = arguments.s in
        s + 5
```

```psuedo
(+) (a : find_interface(Numeric)) (l : unify(a)) (r : unify(a))

Is there an optimised way to find the type of the function without attempting to reduce the whole thing?

Type is one of the primitives:
(string|number|bool|[]|function)

Each primitive has it's own custom refinement types + function refinements

string:
length
singleton

number:
integer
singleton
min
max

bool:
singleton

array:
length
elementType
values

TBC!

```
