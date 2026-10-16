# Harness unit suite: where the time goes (16 October 2026)

Measured on the owner's Mac (Apple silicon, 8 cores: 4 performance, 4 efficiency), the harness unit suite of
`benchmarks/spec-bench/harness` (79 test files, 2,302 collected tests: 2,294 passed, 8 skipped). Times are UK local time
where a time of day is given. Everything here is measured except the lines marked **reading**, which are interpretation.

Raw data, kept in the scratchpad (not in the repository):

- `/private/tmp/claude-501/-Users-julian-expts-awesome-local-ai/96d2b867-03cb-4ffa-ad0d-194ddc7ab5e6/scratchpad/profile/full.txt` (pytest output with every test's setup, call and teardown time)
- `/private/tmp/claude-501/-Users-julian-expts-awesome-local-ai/96d2b867-03cb-4ffa-ad0d-194ddc7ab5e6/scratchpad/profile/junit.xml` (the same, per test, as XML)

## 1. Information

### 1.1 The runs, and how much they differ

| run | what | wall time |
|---|---|---|
| release check, 16 Oct, with coverage | `dbench harness-release --check-only`, the check named "harness unit suite" | 16 min 29 s |
| serial, no coverage, earlier today | same tests, pytest alone | 17 min 26 s (1,046 s); 586 s Python CPU + 297 s system CPU, 84% of one core's worth of wall time |
| serial, no coverage, this report | same tests, per-test times recorded | 13 min 36 s (815.9 s); 470 s Python CPU + 231 s system CPU |

The same tests, run the same way, took 1,046 s and 816 s: a 28% spread between two runs on one machine. I do not know why
(other work on the Mac at the time is the likely cause, not checked). Any figure below is one run, and differences of
that size are not findings. Coverage did not add a visible cost: the coverage run was the shortest of the three.

### 1.2 Setup and teardown are not the cost

Summed over every test of this run: test bodies **764.2 s (97.0%)**, setup **23.3 s (3.0%)**, teardown **0.6 s (0.1%)**.
The three add to 788.1 s; the other 27.7 s of the 815.9 s is collection (pytest importing the 79 files; measured at
26.5 s on its own earlier).

Only five tests have a setup over 0.4 s, and they account for 11 s of the 23 s:

| s | test |
|---:|---|
| 5.95 | test_pipeline.py::test_the_pipeline_records_exactly_the_known_answer |
| 2.01 | test_agent_world.py::test_the_agents_world_holds[probe] |
| 1.76 | test_publish_gate.py::test_A1_each_private_kind_stays_out_of_the_public_repo_and_on_the_machine[stories/01/accept.json] |
| 0.46 | test_drive_record.py::test_a_private_checkout_with_no_main_of_the_remote_s_cannot_be_recorded_onto |
| 0.45 | test_drive_record.py::test_a_private_push_refused_while_the_remote_answers_is_tried_once_more_and_then_reported |

So the idea that the suite repeats an expensive setup and teardown thousands of times is not what the data shows. Setup is
cheap per test; the cost is in what the tests do.

### 1.3 The time is concentrated in a few tests

| test body takes | tests | share of tests | seconds | share of time |
|---|---:|---:|---:|---:|
| under 0.1 s | 1,737 | 75.7% | 6.8 | 0.9% |
| 0.1 s to 1 s | 396 | 17.2% | 149.1 | 18.9% |
| 1 s to 5 s | 129 | 5.6% | 333.3 | 42.3% |
| 5 s or more | 34 | 1.5% | 274.9 | 34.9% |

(Shares of the 788.1 s of recorded test time. 2,296 tests ran a body; 6 skipped tests have none.) 163 tests, 7.1% of them,
are 77.2% of the time. Cumulative: the 10 slowest are 132.5 s (16.8%), the 40 slowest 304.6 s (38.6%), the 100 slowest
529.9 s (67.2%), the 500 slowest 750.2 s (95.2%). The other 1,796 tests together take about 38 s.

### 1.4 Time per test file

Sorted by total time. "share" is of the 788.1 s of recorded test time.

| file | tests | total s | test bodies s | setup s | teardown s | share |
|---|---:|---:|---:|---:|---:|---:|
| test_drive.py | 89 | 159.4 | 159.4 | 0.0 | 0.0 | 20.2% |
| test_u1_matrix.py | 22 | 128.8 | 128.8 | 0.0 | 0.0 | 16.3% |
| test_story_faults.py | 19 | 66.2 | 66.2 | 0.0 | 0.0 | 8.4% |
| test_pipeline.py | 11 | 53.6 | 46.5 | 7.1 | 0.0 | 6.8% |
| test_replay_real_logs.py | 75 | 52.0 | 52.0 | 0.0 | 0.0 | 6.6% |
| test_drive_main.py | 85 | 49.1 | 49.1 | 0.0 | 0.0 | 6.2% |
| test_recording.py | 24 | 38.8 | 38.8 | 0.0 | 0.0 | 4.9% |
| test_publish_gate.py | 119 | 38.5 | 36.7 | 1.8 | 0.0 | 4.9% |
| test_drive_record.py | 62 | 35.1 | 29.7 | 5.4 | 0.0 | 4.5% |
| test_gates.py | 48 | 27.2 | 27.2 | 0.0 | 0.0 | 3.5% |
| test_roots.py | 19 | 24.3 | 24.3 | 0.0 | 0.0 | 3.1% |
| test_finalize.py | 73 | 16.6 | 16.6 | 0.0 | 0.0 | 2.1% |
| test_stop_rule.py | 67 | 13.3 | 8.4 | 5.0 | 0.0 | 1.7% |
| test_server_log.py | 1 | 13.2 | 13.2 | 0.0 | 0.0 | 1.7% |
| test_record_event.py | 7 | 13.0 | 13.0 | 0.0 | 0.0 | 1.6% |
| test_preflight_browsers.py | 10 | 9.6 | 9.6 | 0.0 | 0.0 | 1.2% |
| test_tagsuite.py | 26 | 6.9 | 4.9 | 2.0 | 0.0 | 0.9% |
| test_progress.py | 29 | 6.5 | 6.5 | 0.0 | 0.0 | 0.8% |
| test_run_series.py | 3 | 5.9 | 5.9 | 0.0 | 0.0 | 0.7% |
| test_drive_helpers.py | 159 | 4.0 | 4.0 | 0.0 | 0.0 | 0.5% |
| test_annotate.py | 7 | 3.8 | 3.8 | 0.0 | 0.0 | 0.5% |
| test_agent_world.py | 14 | 3.1 | 0.5 | 2.0 | 0.6 | 0.4% |
| test_check_browser.py | 3 | 1.9 | 1.9 | 0.0 | 0.0 | 0.2% |
| test_collect_ids_stable.py | 1 | 1.8 | 1.8 | 0.0 | 0.0 | 0.2% |
| test_finalize_pending.py | 42 | 1.7 | 1.7 | 0.0 | 0.0 | 0.2% |
| test_host_desc.py | 3 | 1.5 | 1.5 | 0.0 | 0.0 | 0.2% |
| test_ensure_browser.py | 5 | 1.4 | 1.4 | 0.0 | 0.0 | 0.2% |
| test_machine_names.py | 53 | 1.0 | 1.0 | 0.0 | 0.0 | 0.1% |
| test_meter_proxy.py | 2 | 0.9 | 0.9 | 0.0 | 0.0 | 0.1% |
| test_history.py | 18 | 0.9 | 0.9 | 0.0 | 0.0 | 0.1% |
| test_drive_agent.py | 73 | 0.8 | 0.8 | 0.0 | 0.0 | 0.1% |
| test_config_value.py | 2 | 0.8 | 0.8 | 0.0 | 0.0 | 0.1% |
| test_pack_version.py | 2 | 0.6 | 0.6 | 0.0 | 0.0 | 0.1% |
| test_judge.py | 11 | 0.6 | 0.6 | 0.0 | 0.0 | 0.1% |
| test_judge_collect.py | 9 | 0.6 | 0.6 | 0.0 | 0.0 | 0.1% |
| test_provenance.py | 13 | 0.6 | 0.6 | 0.0 | 0.0 | 0.1% |
| test_publicise.py | 83 | 0.6 | 0.6 | 0.0 | 0.0 | 0.1% |
| test_playwright_platform.py | 3 | 0.6 | 0.6 | 0.0 | 0.0 | 0.1% |
| test_rescore.py | 39 | 0.4 | 0.4 | 0.0 | 0.0 | 0.1% |
| test_identity.py | 31 | 0.4 | 0.4 | 0.0 | 0.0 | 0.1% |
| test_size_limits.py | 13 | 0.3 | 0.3 | 0.0 | 0.0 | 0.0% |
| test_scoring_env.py | 8 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_pack.py | 11 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_accounting.py | 86 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_prerequisites.py | 13 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_engine_settings.py | 99 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_logscan.py | 192 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_judge_sandbox.py | 6 | 0.2 | 0.2 | 0.0 | 0.0 | 0.0% |
| test_import_run.py | 3 | 0.1 | 0.1 | 0.0 | 0.0 | 0.0% |
| test_grading_package.py | 3 | 0.1 | 0.1 | 0.0 | 0.0 | 0.0% |
| test_drive_story_result.py | 2 | 0.1 | 0.1 | 0.0 | 0.0 | 0.0% |
| test_silent_alive.py | 5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_recount_tokens.py | 14 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_hostenv.py | 28 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_migrate_rescore_to_record.py | 56 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_backfill_timing.py | 19 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_backfill_draft.py | 6 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_sandbox.py | 23 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_telemetry_doc.py | 7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_scoring_tools.py | 9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_reread_finish.py | 7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_host_sample.py | 9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_self_test.py | 4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_progress_file.py | 12 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_packdir.py | 9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_preflight_claude.py | 3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_llama_log.py | 4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_machine_fit.py | 11 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_peek_audit.py | 10 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_mark_not_comparable.py | 6 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_memory_snapshot.py | 31 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_attempts.py | 38 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_engine_log.py | 16 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_credentials.py | 74 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_claims.py | 4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_accounting_opencode.py | 6 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_clients.py | 20 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_containment.py | 17 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |
| test_conversation.py | 50 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0% |

### 1.5 The 100 slowest test bodies

| # | s | file | test |
|---:|---:|---|---|
| 1 | 24.71 | test_gates.py | `test_unstartable_app_counts_every_applicable_test_as_failed` |
| 2 | 14.31 | test_roots.py | `test_the_sandbox_hides_both_roots_from_the_agent` |
| 3 | 14.12 | test_drive.py | `test_sandbox_hides_all_bench_state_but_the_agents_own_run` |
| 4 | 14.00 | test_drive.py | `test_dbench_home_is_hidden_except_its_tools` |
| 5 | 13.18 | test_server_log.py | `test_each_server_start_is_appended_after_a_start_marker` |
| 6 | 12.24 | test_u1_matrix.py | `test_u1_a_checkout_the_process_may_not_record_in_is_refused` |
| 7 | 11.10 | test_pipeline.py | `test_the_story_loop_with_the_results_in_another_checkout` |
| 8 | 10.10 | test_drive.py | `test_sandbox_hides_sibling_runs_but_not_own` |
| 9 | 9.54 | test_drive.py | `test_sandbox_allows_realpath_of_own_workspace` |
| 10 | 9.18 | test_drive.py | `test_sandbox_blocks_the_held_out_suites_browsers` |
| 11 | 9.17 | test_pipeline.py | `test_a_claude_code_run_records_the_same_known_answer` |
| 12 | 7.40 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-present-absent-over]` |
| 13 | 6.79 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-absent-absent-under]` |
| 14 | 6.76 | test_pipeline.py | `test_a_suite_checkout_past_its_tag_with_changed_tests_is_scored_by_the_tags_suite` |
| 15 | 6.62 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-present-absent-under]` |
| 16 | 6.56 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-absent-absent-over]` |
| 17 | 6.19 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-absent-present-over]` |
| 18 | 6.08 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-absent-present-under]` |
| 19 | 5.98 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-present-present-over]` |
| 20 | 5.96 | test_u1_matrix.py | `test_u1_a_root_that_is_not_the_top_of_a_checkout_is_refused` |
| 21 | 5.95 | test_u1_matrix.py | `test_u1_a_run_outside_a_root_inside_a_checkout_is_refused_for_being_outside` |
| 22 | 5.65 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-present-absent-over]` |
| 23 | 5.60 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-present-absent-under]` |
| 24 | 5.57 | test_u1_matrix.py | `test_u1_a_run_outside_the_default_root_is_refused` |
| 25 | 5.55 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[present-present-present-under]` |
| 26 | 5.39 | test_story_faults.py | `test_a_fault_judging_a_story_the_operator_ended_still_records_it_and_the_next[stub markers]` |
| 27 | 5.33 | test_progress.py | `test_operator_skip_stops_the_agent_with_no_resume_or_nudge` |
| 28 | 5.30 | test_u1_matrix.py | `test_u1_a_run_outside_a_valid_root_is_refused` |
| 29 | 5.25 | test_story_faults.py | `test_a_fault_judging_a_story_the_operator_ended_still_records_it_and_the_next[verdict]` |
| 30 | 5.19 | test_pipeline.py | `test_scoring_only_the_latest_story_is_caught` |
| 31 | 5.07 | test_drive.py | `test_agent_env_pwd_points_inside_sandbox` |
| 32 | 5.06 | test_story_faults.py | `test_every_derived_step_failing_at_once_still_records_both_stories_and_the_run_can_be_reported` |
| 33 | 5.04 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[git checkout of another version]` |
| 34 | 5.00 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[delete]` |
| 35 | 4.96 | test_recording.py | `test_the_agent_writes_and_reads_its_own_temp_dir` |
| 36 | 4.96 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[move the directory away]` |
| 37 | 4.96 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[git rm]` |
| 38 | 4.95 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-absent-absent-over]` |
| 39 | 4.95 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[replace by rename]` |
| 40 | 4.93 | test_recording.py | `test_node_resolves_the_workspace_s_packages_and_none_from_above` |
| 41 | 4.93 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[write]` |
| 42 | 4.93 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[overwrite]` |
| 43 | 4.93 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[new file]` |
| 44 | 4.91 | test_drive.py | `test_the_sandbox_refuses_every_change_to_the_workspace_s_spec[chmod then write]` |
| 45 | 4.91 | test_drive.py | `test_the_sandbox_lets_the_agent_read_the_spec_and_write_the_rest_of_its_workspace` |
| 46 | 4.87 | test_story_faults.py | `test_a_fault_judging_a_story_the_operator_ended_still_records_it_and_the_next[held-out changes]` |
| 47 | 4.86 | test_drive.py | `test_the_harness_outside_the_sandbox_can_still_write_the_spec` |
| 48 | 4.82 | test_drive.py | `test_sandbox_blocks_listing_the_repo` |
| 49 | 4.81 | test_u1_matrix.py | `test_u1_with_the_root_unset_the_default_root_records_like_a_valid_one` |
| 50 | 4.81 | test_recording.py | `test_mktemp_and_git_still_work_in_the_sandbox` |
| 51 | 4.81 | test_preflight_browsers.py | `test_playwright_s_bookkeeping_is_written_in_the_runs_own_browsers_directory` |
| 52 | 4.81 | test_drive.py | `test_sandbox_blocks_reading_the_acceptance_suite` |
| 53 | 4.80 | test_recording.py | `test_claude_code_s_temp_dir_works_in_the_sandbox_when_the_shared_one_exists` |
| 54 | 4.78 | test_drive.py | `test_sandbox_allows_own_workspace` |
| 55 | 4.74 | test_recording.py | `test_another_run_s_temp_dir_is_not_visible` |
| 56 | 4.73 | test_recording.py | `test_what_another_run_left_in_tmp_is_not_visible` |
| 57 | 4.72 | test_preflight_browsers.py | `test_the_agent_cannot_put_anything_into_the_shared_browsers` |
| 58 | 4.71 | test_recording.py | `test_the_held_out_suite_s_scratch_is_not_visible` |
| 59 | 4.70 | test_recording.py | `test_the_agent_cannot_read_packages_above_its_run` |
| 60 | 4.67 | test_drive.py | `test_private_pack_checkout_is_hidden_from_the_agent` |
| 61 | 4.66 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-absent-absent-under]` |
| 62 | 4.61 | test_stop_rule.py | `test_every_recorded_stop_gets_the_stop_message` |
| 63 | 4.41 | test_drive.py | `test_hang_guard_kills_a_tool_child_that_left_the_workspace` |
| 64 | 4.37 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-present-present-over]` |
| 65 | 4.34 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-absent-present-over]` |
| 66 | 4.23 | test_record_event.py | `test_a_run_stopped_for_missing_resources_exits_3_and_records_why` |
| 67 | 4.10 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-present-present-under]` |
| 68 | 4.09 | test_u1_matrix.py | `test_u1_records_in_a_valid_root[absent-absent-present-under]` |
| 69 | 3.80 | test_roots.py | `test_run_sh_from_a_release_writes_and_records_in_the_results_checkout` |
| 70 | 3.75 | test_annotate.py | `test_attempts_build_from_the_real_records` |
| 71 | 3.68 | test_drive.py | `test_hang_guard_is_not_fooled_by_a_workspace_path_that_names_a_client` |
| 72 | 3.59 | test_run_series.py | `test_background_really_runs_every_run_and_reports_status` |
| 73 | 3.58 | test_roots.py | `test_run_sh_in_a_checkout_records_no_release` |
| 74 | 3.57 | test_story_faults.py | `test_an_ordinary_story_records_no_faults` |
| 75 | 3.48 | test_pipeline.py | `test_the_pipeline_records_exactly_the_known_answer` |
| 76 | 3.34 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[time split]` |
| 77 | 3.18 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[server statistics]` |
| 78 | 3.16 | test_pipeline.py | `test_a_run_left_unscored_for_a_passing_reason_is_scored_when_the_next_run_starts` |
| 79 | 3.07 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[reply check]` |
| 80 | 3.06 | test_story_faults.py | `test_a_guard_stopping_the_run_is_not_swallowed` |
| 81 | 3.05 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[task table]` |
| 82 | 3.04 | test_record_event.py | `test_a_run_that_refuses_to_start_says_so_in_a_pushed_commit` |
| 83 | 3.03 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[workspace mirror]` |
| 84 | 3.02 | test_story_faults.py | `test_a_fault_while_publishing_still_keeps_the_story_on_the_machine[compacted log]` |
| 85 | 2.98 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[conversation profile]` |
| 86 | 2.96 | test_story_faults.py | `test_a_fault_while_publishing_still_keeps_the_story_on_the_machine[record]` |
| 87 | 2.94 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[task evidence]` |
| 88 | 2.89 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[progress file]` |
| 89 | 2.89 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[lines of code]` |
| 90 | 2.84 | test_story_faults.py | `test_a_fault_while_publishing_still_keeps_the_story_on_the_machine[summary]` |
| 91 | 2.83 | test_story_faults.py | `test_a_fault_in_one_derived_step_still_records_the_story[provenance]` |
| 92 | 2.82 | test_record_event.py | `test_a_cloud_run_that_completes_exits_0` |
| 93 | 2.79 | test_pipeline.py | `test_losing_the_majority_vote_is_caught` |
| 94 | 2.66 | test_pipeline.py | `test_skipping_the_build_in_the_rescore_is_caught` |
| 95 | 2.48 | test_drive.py | `test_hang_guard_kills_a_tool_that_replaced_its_shell_and_left_the_workspace` |
| 96 | 2.21 | test_drive.py | `test_record_story_survives_a_conflicting_remote_and_pushes_the_backlog_later` |
| 97 | 1.96 | test_drive_record.py | `test_each_step_of_building_the_private_commit_reports_its_own_failure` |
| 98 | 1.92 | test_replay_real_logs.py | `test_every_reader_reads_the_recorded_log[combinations/qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4...` |
| 99 | 1.87 | test_drive.py | `test_hang_guard_spares_the_agent_whose_cwd_is_the_workspace` |
| 100 | 1.79 | test_record_event.py | `test_a_reference_stack_puts_each_packs_runs_under_that_pack` |

### 1.6 What the slow tests do (a count of processes started)

I counted every process a test group starts (a wrapper on `subprocess.Popen`), running the group on its own. One run each.

| group | wall | processes started | what they are |
|---|---:|---:|---|
| test_u1_matrix.py, the 16 `test_u1_records_in_a_valid_root` cells | 88.9 s | 3,760 | git: 800 rev-parse, 640 show, 360 add, 320 push, 280 commit, 240 ls-tree, 160 init, 160 clone |
| test_story_faults.py, all 19 tests | 72.7 s | 1,107 | 140 lsof, 125 git rev-parse, 111 npm, 105 git diff, 84 git add, 79 git log, 62 git status, 61 git commit |
| test_gates.py, all 48 tests | 37.6 s | 45 | 25 npm, 19 node, 1 npx |

Cost of one start on this Mac, measured: `git --version` 14.6 ms, `python -c pass` 23.2 ms, a new repository with one commit
(init, add, commit) 59.6 ms. A push or a clone to a local bare repository costs more than those; not measured separately.

The test file `test_u1_matrix.py` says in its own header that each row runs every value of its "*" dimensions, one at a time,
on real repositories with bare remotes. That is why one test starts about 235 processes (3,760 / 16).

I did not count the other 76 files. Where a figure is missing here the cause is not established.

**Reading:**
- In the u1 matrix and the story-faults tests the time is plausibly process starts: 3,760 starts at 15 to 60 ms each is
  between 56 s and 225 s, and the group took 89 s. This is a consistent estimate, not an attribution; I did not measure the
  time inside the git calls.
- `test_gates.py` is different: 45 processes in 37.6 s is about 0.8 s a process, so its cost is `npm` and `node` start-up
  and their work, not the number of processes.
- In `test_drive.py` the slowest tests (6 to 17 s) use the real sandbox, which is a separate Rust program that starts
  a confined process. Not counted.

### 1.7 Parallel run: wall time and contention

The six files test_logscan, test_drive_helpers, test_publish_gate, test_drive_main, test_finalize and test_history (646 tests),
`pytest-xdist`, one run per setting:

| workers | wall | CPU (user + system) | of which system |
|---|---:|---:|---:|
| 1 (earlier serial run, own measurement) | 166 s | not measured | not measured |
| 2 | 66 s | 119 s | 67 s |
| 4 | 51 s | 164 s | 97 s |
| 8 | 51 s | 217 s | 130 s |

- Wall time stops improving at 4 workers; 8 workers cost twice the CPU of 4 for the same 51 s.
- The CPU needed for the same tests grows from 119 s (2 workers) to 217 s (8): the work gets more expensive as workers are
  added. That is contention for something shared; what is not isolated.
- System CPU is the larger part and is the part that grows. **Reading:** that matches process creation and file operations
  contending in the operating system. The Mac having only 4 performance cores could produce the same plateau; I did not
  separate the two.
- An earlier 8-worker run of the same sample took 82 s, not 51 s: the spread between runs is large.
- Not tested: the full suite in parallel, and any of the sandbox, npm and node tests in parallel. A parallel run may fail
  for reasons a serial one cannot show (shared ports, shared temporary folders, git locks); the 646-test sample passed at
  every worker count.

### 1.8 What was not measured

- Which individual calls inside the slow tests cost what (a profiler on the slow tests would show it).
- Whether the second run's 230 s faster result is noise or a changed machine state.
- The same suite on a Linux bench machine (the release check runs it on this Mac).
- The other three slow checks in the release gate: real-log replay 11 min 52 s, repo shell tests 5 min 0 s, end-to-end
  2 min 34 s (from the first release-check run).

## 2. Options (nothing has been changed)

These need the owner's decision; none touches the migration.

1. **Problem:** the suite takes 13.6 to 17.4 minutes, and 163 tests (7.1%) are 77% of it.
   **Recommended solution:** mark those tests (for example `slow`) and give the other 2,133 an answer in a fraction of the
   time; the full suite stays the build-time gate.
   **Proposed actions:** choose the threshold and mark (no owner approval needed beyond this choice).
2. **Problem:** nothing runs in parallel. **Recommended solution:** run the quick tests with 4 workers; the sample says 4 is
   the useful number on this Mac. **Proposed actions:** run the full suite at 4 workers once to see if the heavy tests
   survive it (needs your approval; about the length of the suite, on this Mac only).
3. **Problem:** the u1 matrix starts about 235 processes per test. **Recommended solution:** share one repository
   fixture between its cells where the cell does not need a fresh one. **Proposed actions:** this changes tests that pin
   the refactor and so follows the refactor method (prove coverage first); only after the migration (needs approval).
