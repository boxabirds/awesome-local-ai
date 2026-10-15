# Story 5, deletion report (15 Oct 2026)

The delete-first step of story 5 (the lake takes the full record of a run), run story-locally. `refactor.py check-stubs`
and `report-deletion` check the whole touched set (98 entries in 37 files, the whole epic), and none of the nine
functions this story rewrites is in it. In `tools/dbench` the set holds `is_run_dir`, `list_runs`, `rel_of`,
`archived_runs`, `pass`, the collector's `resolve`, and the server's `job_run_rel` and `list_runs`. The tool therefore
cannot reach `Deleted` on this story alone, and the stage stays `Proved`. What was done instead, in the same spirit, on
the code as it was at `f0066f55b41e80e41b8a4b86840e081ab5addda6` plus the corpus commit:

## Stubs

Each function below was replaced by `todo!()` with its signature kept; the whole `dbench` suite
(`cargo test -p dbench --no-fail-fast`, 279 tests) was run against the stubs.

| file | stubbed to `todo!()` |
|---|---|
| `tools/dbench/src/collect.rs` | `parse_name`, `resolve`, `manifest`, `FileName::kind`, `FileName::name` |
| `tools/dbench/src/collector.rs` | `plan`, `pull_file`, `collect_run`, `wanted`, `store_dir` |
| `tools/dbench/src/server.rs` | `file_of` |

A stub that panics first hides every function behind it (an integration test that panics in `wanted` never reaches
`collect_run`), so there were three runs:

| run | stubbed | passed | failed |
|---|---|---|---|
| A | all eleven | 266 | 13 |
| B | `resolve`, `kind`, `name`, `collect_run` | 270 | 9 |
| C | `pull_file` alone | 276 | 3 |

Every failure, in all three runs, was `not yet implemented` at a stubbed function. None failed for another reason.

## What pins each function (the tests that failed)

| function | failing tests | run |
|---|---|---|
| `parse_name` | `collect::tests::only_allow_listed_names_parse` | A |
| `resolve` | `collect::tests::every_accepted_name_resolves_under_the_run_dir_or_the_egress_dir`, `a_ranged_read_follows_growth_and_the_prefix_check_catches_a_rewrite` | B |
| `FileName::kind`, `FileName::name` | `collect::tests::only_allow_listed_names_parse`, `collect::tests::manifest_lists_existing_files_with_size_and_mtime_and_the_egress_log_from_work_dir_txt`, `files_manifest_by_job_and_by_run_path_lists_only_allow_listed_files` | B |
| `manifest` | `collect::tests::the_lake_takes_a_runs_records_as_well_as_its_logs_so_scores_are_never_single_copy`, `collect::tests::manifest_lists_existing_files_with_size_and_mtime_and_the_egress_log_from_work_dir_txt`, `files_manifest_by_job_and_by_run_path_lists_only_allow_listed_files` | A |
| `plan` | `collector::tests::plan_skips_unchanged_pulls_growth_refetches_a_shrunk_file_and_rewrites_whole_files` | A |
| `store_dir` | `collector::tests::store_dir_rejects_a_run_path_the_node_should_not_have_sent` | A |
| `wanted` | `collector::tests::a_reference_models_run_is_never_pulled_so_the_lake_holds_no_claude_transcript`, `collector::tests::an_archived_run_is_never_pulled_even_when_asked_for_and_only_runs_still_narrows`, and the three collect passes below | A |
| `collect_run` | `collect_pulls_deltas_resumes_after_the_node_was_unreachable_and_completes_a_settled_run`, `collect_refetches_a_file_the_node_rewrote_and_backfills_a_run_that_has_no_job`, `a_collect_pass_in_git_mode_skips_runs_archived_on_origin_main_and_ingests_what_it_pulled_without_a_fetch` | B |
| `pull_file` | the same three collect passes | C |
| `file_of` | `a_ranged_read_follows_growth_and_the_prefix_check_catches_a_rewrite` | A |

Every stubbed function is pinned by at least one test that fails when it is gone, and no test that exercises one
passed. The complement held: in run A the 266 that passed were the analytics (18), harness (12), ingest (37), label (5)
and release (23) suites and the rest of the library (139) and server (32) tests, and none of them failed.

## The tool's stub detector

`refactor.py check-stubs` was also tried on the stub tree. It says 9 of the 11 are not stubs, although each body is
exactly `todo!()` (the two it accepted are `store_dir` and `file_of`). From reading `functions_of` and `brace_body`, the
cause appears to be that a function's text runs to the start of the next function, so a doc comment or item between two
functions is counted as part of the first, and `brace_body` then does not end at a closing brace. That is an inference
from the code, not tested. It is a fault in the tool (story 1), found by looking; it is not fixed here (the file is outside
this task's scope), and the fix starts with a test that fails because of it.

## What this does not show

`E-ASSIGNED-PASSED` and `E-OUTSIDE-FAILED` are the tool's names for these two checks; the tool itself was not run,
because it works on the whole epic's touched set. The owner decides whether the touched set should gain these functions or
the tool a per-story scope.
