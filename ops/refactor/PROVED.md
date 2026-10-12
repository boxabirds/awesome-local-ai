# Proved: story 1, the entry condition for the delete-first tasks of stories 4 to 12

`stage.toml` reads **Proved**. The move was made by `refactor.py stage Proved` on 12 Oct 2026 at 23:00 BST, after the matrix
check and the coverage proof below passed. (The move's label in `stage.toml` reads "check-matrix U1 to U14"; it checked U1,
the only use case `use_cases.toml` requires. The label in the tool is corrected for later moves.)

## What was proved, and how it was measured

| check | result | command |
|---|---|---|
| register | 989 tests that touch the touched code, each under exactly one use case: U1 356, U10 112, U14 120, U5 169, U2 59, U4 58, U6 46, U9 33, U7 13, U8 13, U3 9, U13 1 (U11, U12: none) | `check-register` |
| touched set | 98 functions (Python 51, Rust 36, TypeScript 7, shell 4 scripts) and 22 exclusions, each with a reason; reviewed and approved by the owner | `check-touched-set` |
| U1 matrix | 1,024 combinations of the record path covered by 22 rows, one test each | `check-matrix U1` |
| coverage, Python | 51 functions: 876 of 876 lines, 338 of 338 branches | `check-coverage` |
| coverage, Rust | 36 functions: 847 of 847 lines, 194 of 194 branches | `check-coverage` |
| coverage, TypeScript | 7 functions: 117 of 117 lines, 96 of 96 branches | `check-coverage` |
| whole suite | Python 2,334, Rust 408, TypeScript 919, shell 36 tests run; all pass | `run-suites` |

Coverage is at the level of the touched functions (the lines and branches inside each function of `touched_set.toml`),
not whole files (owner decision, 12 Oct 2026). The tests added were each checked by breaking the code they cover and watching a
test fail (done by the agents that wrote them; I re-ran a sample of those breaks myself and the full coverage proofs).

## What this does not prove

- **Shell is not measured.** `kcov` runs on Linux only. The four touched shell scripts have tests (`setup-node`, `judge-setup`,
  `judge-submit`, `fetch-work`: 148 checks) and a statement trace shows every statement runs, but there is no kcov figure.
  Task 1.32 records it on an idle Linux node.
- **The 609 Playwright end-to-end specs of the benchmarker are not in the register.** The register lists pytest, cargo, vitest
  and the `tests/*-test.sh` scripts only.
- **Only U1 has a matrix** (owner decision): the other thirteen use cases rest on function coverage and the deletion report.
- Coverage shows a line ran, not that its result was checked; the deletion report (every assigned test must fail against the
  stubs) is the check that the tests assert something.

## What changed in the code to get here

- One line of production code: the dead `|| summary.requests > 0` in `collector.rs::pass` (commit `b1935af84`).
- Tests only otherwise, plus a dev-dependency (`tokio` `test-util`) in `tools/dbench/Cargo.toml` and `@vitest/coverage-v8` in
  `tools/benchmarker` (both approved).
- Two test ids that carried the clock were made deterministic (the register keys a test by its id).
- The integration tests of `dbench` now stop the server with SIGTERM before SIGKILL so its coverage profile is written.

## The whole-suite run found one failure, now fixed

`tests/privacy-test.sh` failed: eleven tracked files, most added during this story's work, named machines from the local node
list. The names were replaced by hardware descriptions (and the test fixture's node names by `node-a` to `node-c`); the test
passes (6 of 6).

## Reproduce

    uv run ops/refactor/refactor.py check-register
    uv run ops/refactor/refactor.py check-touched-set
    uv run ops/refactor/refactor.py check-matrix U1
    uv run ops/refactor/refactor.py check-coverage      # about 15 minutes
    uv run ops/refactor/refactor.py run-suites          # about 18 minutes
    uv run ops/refactor/refactor.py stage

`measure-touch` (about 19 minutes) refreshes which tests touch the touched code, after tests are added.
