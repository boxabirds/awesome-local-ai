# ops/refactor: the refactor method, enforced

The method of `docs/designs/operational-data-separation.md` ("Refactoring method"), as a tool: every use case is
covered by tests, the touched code is deleted first, every assigned test must fail, and only then is the new
behaviour built. The tool never edits production code. It reads test lists, coverage output and test results from the
real runners and refuses when a rule is broken. Story 1 of the epic builds it. The stage and the checks act on the whole epic's list at once: every story whose code is in
the touched set waits on the one stage, and each command prints the size of that list first (`scope: whole touched set, N entries in M files`).

    uv run ops/refactor/refactor.py --help

**What the touched set is (owner, 15 October 2026):** the epic moves benchmark data out of git, so git holds no operational
benchmark data. A function is in the set only if it (G) runs git on operational benchmark data, or (T) itself chooses a
location that exists only because git tracks it (`combinations/**/benchmarks/<pack>/<run>/`, `benchmarks/reference/`,
run paths derived from a checkout, a private checkout root). A function that only receives a path is out: the caller
that chose the location is the member. Also out: data git does not track (a node's run folder while it runs, the lake, the
warehouse), git on the code repository, the agent's own workspace, the private held-out suite source and the monitor's
notes, and matches that are only text. The audit (`audit/`, 15 passes, final at 15) finds the members; `touched_set.toml`
equals its protected hits (112 on 15 October).

Exit codes: **0** the rule holds, **1** it is broken (the problems are listed, each with a code), **2** the tool could
not decide (a runner or a coverage tool is missing, a result file is absent, a node cannot be reached). An unknown is
never treated as a pass. Reports go to `ops/refactor/reports/` (git-ignored). The tool writes nothing outside it
except `stage.toml`.

## The stages

`Inventory`, `Matrices`, `Proved`, `Deleted`, `RedContracts`, `Reimplemented`, `Compared`; `stage TO` moves one stage
forward, and only when the checks that justify the move pass. `Deleted` goes back to `Proved` when an assigned test
passes against the stubs (the tool does it itself). `stage` alone prints the stage.

`stage.toml` also records the proof (`[proved_members]`: a digest, a count and the member list, as `file::function`), written in
the same atomic write that moves to `Proved`. From `Proved` on, `stage`, `check-stubs`, `report-deletion` and `check-coverage`
first compare the touched set with that proof: a member added since moves the stage back to `Matrices` (the tool writes it, and
the move records why) and the command stops with `E-MEMBER-UNPROVED` naming the members; a stage with no recorded proof moves
back once with `E-STAGE-DIGEST-MISSING`. A member removed leaves the proof standing, and reconciling never moves the stage
forward. Moving to `Proved` again records the new proof.

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
| `check-touched-set` | the committed `touched_set.toml` equals the protected hits of the final audit (`E-NO-FINAL-AUDIT`, `E-AUDIT-MISSING-FROM-SET` with the first pass that found the place, `E-SET-NOT-IN-AUDIT` (a `<module>` entry is exempt), `E-HIT-EXCLUDED-IN-SET`) and equals the scan, after the recorded exclusions; ends with a counts line (protected hits, entries, excluded hits, intrinsic hits). A repository with no `audit/` folder is checked by the scan alone. The tool never writes the set |
| `check-matrix U<n>` | the cross product of the dimensions in `matrices/U<n>.toml` has one test in every cell |
| `check-coverage` | runs each suite under its coverage tool: 100% of the lines and branches inside every touched *function* (lcov) |
| `check-stubs` | every touched function (or whole script) is replaced by the stub of its language |
| `audit-run NN` | runs the queries of `audit/pass-NN.md` with `git grep` and writes each query's hits (file, line, function) to `reports/audit-hits-NN.json` |
| `audit-check` | every pass file is well formed, searches the four categories over every scope folder, gives the hits its queries give when run again, and marks as new exactly the hits no earlier pass has; no file outside `audit/` changes; the report gives `final_pass`: the latest pass when it adds a query no earlier pass had and finds no new hit, otherwise null with the reason (`single-pass`, `new-hits`, `repeat`). `--require-final` exits 1 unless the audit is final. Every hit row names its Access (reader or writer), Via (command or path) and one Outcome: protected (with a use case: U1 to U14, or one recorded under `[agreed.Un]` in `use_cases.toml` with a reason), excluded (with a reason) or intrinsic (git in the agent's own repository: a class W function, with a reason). Pass 01 must also have a row with an outcome for every place of `audit/seed.toml` (the gaps known on 15 October 2026; function `*` is satisfied by any row in that file). `audit/findings.toml` holds the findings that are not code (F-01: ten runs hold the only copy of their final source tree): every pass lists each open finding in its Open findings table, and only the owner closes one (a date and a reference); the tool never writes the file |
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

`check-coverage` measures shell with `kcov` (`brew install kcov` on a Mac, `apt install kcov` on Linux). Only the test scripts that
name a touched script run under it. kcov finds a script's lines in the stderr of its bash, so a test that sends the script's stderr
to a file hides it: the shell tests use `run_capturing` (in `tests/lib.sh`), which keeps the file and also passes stderr on when
running under kcov. A test that runs a copy of a script in a temporary folder is matched to the repository's script by the end of
its path, and each test's own kcov report is read (kcov's `--merge` re-reads sources that no longer exist).

Measured on 13 Oct 2026 on a Mac: `judge-setup.sh` 33 of 33 lines, `judge-submit.sh` 31 of 31, `fetch-work.sh` 12 of 12 (after
leaving out the six lines of Python inside shell strings, named in `runners.toml`), `setup-node.sh` 86 of 97. The other 11 lines of
`setup-node.sh` (60, 61, 63, 114 to 118, 134 to 136) are the interactive install prompt, which the test runs in a pseudo-terminal, and
the Chromium-libraries hint; a `bash -x` trace shows the tests run them and kcov does not report them. They are named, with the
reason, in a reviewed table in `runners.toml` (`[[shell.coverage.blind]]`). The check fails if a named line is one kcov now sees run
or is not a measurable line, a line without a reason is refused, and the lines are printed every run. Any other unrun line fails.

## Tests

    uv run --with pytest python -m pytest ops/refactor/refactor_test.py

The process-level tests run the real pytest-cov, cargo (nightly, with `cargo-llvm-cov`), bun/vitest and shell on
`fixtures/mini/`; a test skips with its reason when one of those tools is absent. See `tools/dbench/README.md` for
the Rust coverage tooling.
