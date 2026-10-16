# Fixtures of the bench-lake tests

`lake/` holds trimmed copies of real runs from the host's lake (`state/collected` and `state/reference`), captured on
16 October 2026 by `make-lake-fixture.sh`. The tests read it as a lake: `Lake::in_state_dir("lake")` (the folders
`collected` and `reference`). Nothing here is invented; the damaged and temporary files some tests need are made from these
by the tests, in a temporary folder.

    FIXTURE_BUDGET_BYTES = 5242880    # 5 MiB, checked by check-fixture.sh and by TC-103; the named constant is in make-lake-fixture.sh

The fixture is 4,777,704 bytes in 48 files; git stores it in about 2.5 MB (the bundles and `.gz` logs are already
compressed). A fresh clone of the public repository is to stay under 10 MB (owner, 12 October 2026), which is why the budget is
a limit and not a goal.

## What was copied, and what was left out

Only files on the allowlist in the script: the records `run.json`, `run-status.json`, `finalize.json`, `collection.json`,
`metrics.json`, `progress.json`, `workspace.bundle`, and for a story `accept-summary.json`, `prompt.md`, `base-commit`,
`gate.json` and the logs. Records are whole. A raw log is cut to its first 20 lines (`RAW_LOG_LINES`). The held-out files
of a run (`accept.json`, `accept-report.json`, `heldout-detail.json`) are on no list. Every copied file is scanned for the
owner's home paths, e-mail address and key patterns, looking inside `.gz` files and into the history of each bundle; the
build stops if one is found, and `check-fixture.sh` repeats the scan. A tracked file that differs from `origin/main` is dropped
and written to `DROPPED.tsv` with the reason (TC-102); on 16 October none differed, so that file is empty.

Not copied: the 11 stories' logs of each run beyond the ones named below, `server.log`, `egress.jsonl`, screenshots.

## The runs, and the cell each fills

| Run (lake id) | Node folder | What it holds | Cell |
|---|---|---|---|
| `combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1` | collected/node-a | the six records, story 01 whole, raw log (20 lines) and compact log | combination run, complete note, raw and compact logs (TC-01, TC-17, TC-19, TC-24, TC-35 to TC-40, TC-59) |
| `combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2` | collected/node-a, collected/node-c, collected/node-d | the owner copy with metrics, story 01, compact log and `workspace.bundle`; a pulled copy with a note and a run description; node-d's copy with a note and progress | one id as three copies (TC-02, TC-14 on real notes, TC-47 to TC-50, TC-53, TC-57) |
| `combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2` | collected/node-a | run description, note, finalize, progress | incomplete note (TC-60) |
| `combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1` | collected/node-d | note and progress; no `workspace.bundle` | the real v2-r1 run with no bundle (TC-51) |
| `vidi/sonnet-5.5/v2-r1` | reference | the six records, story 01 with its compact log only, `workspace.bundle` | reference run with a bundle, compact log only (TC-03, TC-18, TC-37, TC-38, TC-62) |
| `todoodle/opus-5.5/run-1` | reference | run description and status; no note | reference run with no note (TC-64) |

## Deviations from the design, and why

- **The bundle is not the smallest in the lake.** The design names the smallest real `workspace.bundle` (418 KB, the dry run
  above). That run is not tracked by the repository, and its records and logs hold the owner's home path in tool output, so
  the scan refused them; the bundle used is `v2-q36fork-b-r2`'s (613 KB), a tracked run.
- **No combination run without a note.** Every combination run in the lake has a note. TC-61 builds one from a copy of the
  first run by removing `collection.json`. The only real runs without a note are the hand-built reference runs (above).
- **The dry run's raw log is left out**: the first 20 lines of its story 02 raw log hold a home path. `v2-q36fork-b-r2` has
  no raw logs in the lake (compact only), so the raw-log cells use `v2-fresh-r1`.
- **Empty folders.** Git cannot store an empty folder. The real empty `benchmarks` folder in a node folder (node-b and
  node-c have one) is created by the tests that need it (TC-05).

## Rebuilding

    tools/bench-lake/tests/fixtures/make-lake-fixture.sh [STATE_DIR] [REPO_DIR]    # on the host that holds the lake
    tools/bench-lake/tests/fixtures/check-fixture.sh                               # anywhere; no lake needed

The script replaces `lake/`, `MANIFEST.sha256` and `DROPPED.tsv`. It changes nothing in the lake or the repository.
