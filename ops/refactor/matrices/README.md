# Matrices

One file per use case, `U<n>.toml`, read in order by `refactor.py check-matrix U<n>`.

```toml
# U<n>: what this use case is. Dimensions come first, then the cells.

[dimensions]
run_kind = ["combination", "reference"]     # a dimension is a name and the values it takes
story_outcome = ["done", "partial"]

[[cell]]
at = ["combination", "done"]                # one value per dimension, in the order the dimensions are declared
test = "python:benchmarks/spec-bench/harness/test_x.py::test_y"   # exactly one test, as the register lists it
```

The cross product of the dimensions (`itertools.product`, in declaration order) is the set of cells. The check
fails when:

| code | when |
|---|---|
| `E-NO-DIMENSIONS` | a cell is written before the dimensions, or there are none |
| `E-CELL-MISSING` | a tuple of the cross product has no test |
| `E-CELL-EXTRA` | a cell names a tuple outside the cross product (an undeclared value, or the wrong number of values) |
| `E-CELL-MULTIPLE` | a tuple has more than one test |
| `E-TEST-UNKNOWN` | a cell names a test the register does not list |
| `E-NO-MATRIX` | the use case has no matrix file |

**An impossible cell still carries a test.** If a combination of values cannot happen (a reference run with no results
root, say), the cell names a test that asserts the refusal: the code is not allowed to quietly do something else there.

**U11 (export) is the one exception.** It has no code yet; its matrix is written from story 14's design and its cells
point at tests that do not exist yet. That is allowed only for U11 and is flagged in the matrix header.
