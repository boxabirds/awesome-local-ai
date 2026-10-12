# ops/refactor: the refactor method, enforced

The method of `docs/designs/operational-data-separation.md` ("Refactoring method"), as a tool: every use case is
covered by tests, the touched code is deleted first, every assigned test must fail, and only then is the new
behaviour built. The tool never edits production code. It reads test lists, coverage output and test results from the
real runners and refuses when a rule is broken. Story 1 of the epic builds it; stories 4 to 12 are held by its stage.

    uv run ops/refactor/refactor.py --help

Exit codes: **0** the rule holds, **1** it is broken (the problems are listed, each with a code), **2** the tool could
not decide (a runner or a coverage tool is missing, a result file is absent, a node cannot be reached). An unknown is
never treated as a pass. Reports go to `ops/refactor/reports/` (git-ignored). The tool writes nothing outside it
except `stage.toml`.

## The stages

`Inventory`, `Matrices`, `Proved`, `Deleted`, `RedContracts`, `Reimplemented`, `Compared`; `stage TO` moves one stage
forward, and only when the checks that justify the move pass. `Deleted` goes back to `Proved` when an assigned test
passes against the stubs (the tool does it itself). `stage` alone prints the stage.

| move | justified by |
|---|---|
| Inventory to Matrices | `check-register` and `check-touched-set` |
| Matrices to Proved | `check-matrix` for the use cases `use_cases.toml` requires (U1) and `check-coverage` |
| Proved to Deleted | `check-stubs` |
| Deleted to RedContracts | the deletion report passed; `fates` (every old test has a fate, every new contract test seen failing) |
| RedContracts to Reimplemented | the whole suite is green (`run-suites`) |
| Reimplemented to Compared | `reports/parity.json` with `exit_code` 0, written by the parity story |

## Commands

| command | what it checks |
|---|---|
| `check-register` | every test the four runners list is under exactly one of U1 to U14, or listed unfit with a decision |
| `build-touched-set --propose` | prints the touched set the scan derives from `classes.toml`; never writes `touched_set.toml` |
| `check-touched-set` | the committed `touched_set.toml` equals the scan, after the recorded exclusions |
| `check-matrix U<n>` | the cross product of the dimensions in `matrices/U<n>.toml` has one test in every cell |
| `check-coverage` | runs each suite under its coverage tool: 100% of the lines and branches inside every touched *function* (lcov) |
| `check-stubs` | every touched function (or whole script) is replaced by the stub of its language |
| `run-suites` | runs each suite with result output on; failing tests are data, so it exits 0 |
| `report-deletion` | every assigned test failed for the stub's reason; none passed; no test outside the set failed |
| `fates [--render PATH]` | every old test has one fate; every contract area has a new test seen failing; renders the table |
| `guard-idle NODE` | no job is running on the node (`dbench status --json NODE`) |
| `stage [TO]` | print the stage, or move to `TO` |

## Files

| file | holds |
|---|---|
| `use_cases.toml` | U1 to U14, fixed by the PRD |
| `runners.toml` | where each language's runner runs and the commands that list tests, measure coverage (lcov) and write results |
| `classes.toml` | the patterns of classes A to E and the class W functions that are never touched |
| `touched_set.toml` | the touched functions, and the excluded matches with a reason each |
| `assignments.toml` | each touched test under one use case; tests that fit none are `[[unfit]]` with a decision |
| `matrices/U<n>.toml` | the dimensions of a use case, then one cell per tuple (see `matrices/README.md`) |
| `fates.toml`, `new_contracts.toml` | the fate of each old test; the contract areas and the new tests that cover them |
| `stage.toml` | the current stage and every move |
| `fixtures/mini/` | a real tiny project (Python, Rust, TypeScript, shell) the tool's process-level tests run on |
| `fixtures/real/` | pinned excerpts of real files, for the classifier test |

## For the scripts of stories 2 and 12

A script that lays out, installs or switches a bench machine must **call `guard-idle` first and stop on any non-zero
exit**, before it changes a file:

    uv run ops/refactor/refactor.py guard-idle node-a || exit $?

Exit 1 means a story is running (the output names the job and the story); exit 2 means the node could not be asked or
the answer was not a status. Neither is "idle". Nothing moves on a machine while a story runs on it.

## Shell coverage

`check-coverage` measures shell with `kcov`, which runs on Linux only. On macOS the tool reports shell as **not measured**
(never as passed). The shell tests of the touched scripts (`tests/setup-node-test.sh`, `judge-setup-test.sh`,
`judge-submit-test.sh`, `fetch-work-test.sh`) were written against every branch of their scripts and each was checked by
breaking the script and watching a test fail. As a stand-in for a coverage figure on a Mac, running a test with the script's
`bash -x` trace (see `SHELL_TRACE` in `tests/setup-node-test.sh`) shows every statement the tests ran; the figure that counts is
kcov's, on a Linux node.

## Tests

    uv run --with pytest python -m pytest ops/refactor/refactor_test.py

The process-level tests run the real pytest-cov, cargo (nightly, with `cargo-llvm-cov`), bun/vitest and shell on
`fixtures/mini/`; a test skips with its reason when one of those tools is absent. See `tools/dbench/README.md` for
the Rust coverage tooling.
