# Story 21: the bench-lake tests against the stubs (task 21.24)

Every test of the shared lake reader was run against the crate's stubs, to show each fails because the
behaviour is absent and not because an item is missing, a fixture is wrong or a test is broken.

**How it was run.** On 3 Nov 2026, in a detached worktree at commit `d21ac1bfb` (16 Oct 2026, "all tests written
against the stubs"), on macOS with no agent sandbox: `cargo test -p bench-lake --no-fail-fast`, with neither
`BENCH_LAKE_HOST_STATE` nor `BENCH_LAKE_HOST_REPO` set. Every test compiled. Rust only: the Python half was
dropped by the owner on 16 Oct 2026, so its tests are not part of this report.

**Result: 150 of 159 fail, 9 pass.**

| why the test fails | tests |
|---|---|
| a stub's `todo!()` panics (the library function it calls is not written) | 137 |
| the command stub panics at `cli::run` (exit 101), so a test that runs the command (11 in command.rs, the golden test in canonical.rs) gets no answer or the wrong exit code | 12 |
| the source scan TC-83 finds no write in the stub `bundle.rs`, where the working copy will be made | 1 |

No test failed for any other reason.

**The 9 that pass, and why that is right:**

- Static checks that hold for the skeleton too: `tc89_dependencies_are_serde_json_flate2_and_sha2_only`,
  `tc90_member_of_the_workspace`, `tc83_only_bundle_rs_starts_a_process_for_the_library`,
  `tc103_fixture_size_is_within_the_budget` and `every_question_has_a_worked_example` (a check of CANONICAL.md).
  TC-89 and TC-83's write scan were proved on 3 Nov by a planted fault each caught (story 21 tasks 21.15 and
  21.17).
- Tests that print NOT RUN and pass when their input is absent: `tc15_preferred_against_the_hosts_lake`,
  `tc102_fixture_drop_list_is_recorded` and `tc104_real_data_comparison` (they need the host's lake), and
  `tc48_and_tc109_files_equal_the_repository_workspace` (the repository tracks no workspace mirror, even at
  `d21ac1bfb`). None of them is evidence of the behaviour. TC-15 has since been run on the host's lake: it found
  the ranking defect fixed in `5016d92c3`.

The message of `d21ac1bfb` says 151 failed and 8 passed. This run gives 150 and 9. Which test differed on 16 Oct
is not known; the run of that day was not kept.

## Every test

| file | test | result | why |
|---|---|---|---|
| None.rs | `tc104_real_data_comparison` | pass | passes against the stubs (see below) |
| None.rs | `tc102_fixture_drop_list_is_recorded` | pass | passes against the stubs (see below) |
| None.rs | `tc97_a_library_equals_a_direct_read` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc98_b_on_the_real_repository_nothing_differs` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc101_b_the_repository_lacks_a_file` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc106_cannot_look_is_not_a_pass` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc105_untracked_runs_are_not_compared_and_not_counted` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc98_b_library_equals_the_repository_on_the_fixtures` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc103_fixture_size_is_within_the_budget` | pass | passes against the stubs (see below) |
| None.rs | `tc99_b_equal_values_with_different_bytes_still_differ` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc100_b_the_lake_lacks_a_file` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc99_b_a_difference_is_reported` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc48_and_tc109_files_equal_the_repository_workspace` | pass | passes against the stubs (see below) |
| None.rs | `a_reference_run_has_a_workspace_too` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc47_good` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc49_bundle_unchanged` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc51_metrics_not_there` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc51_bundle_that_is_a_link_or_a_folder` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc50_destination_is_an_existing_empty_folder` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `story_out_of_range_for_a_workspace` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc51_no_bundle` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc52_no_commit_for_the_story` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc53_commit_not_in_the_bundle` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc56_destination_not_empty` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc54_commit_not_hexadecimal` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc55_destination_inside_a_root` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc57_git_fails` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc58_the_callers_git_settings_do_not_matter` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc84_workspace_writes_only_its_destination` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `every_question_has_a_worked_example` | pass | passes against the stubs (see below) |
| None.rs | `the_worked_examples_are_the_commands_output` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `complete_command` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `tc85_the_command_answers_runs` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `tc86_payload_form_for_a_record_and_a_log` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `a_big_story_number_is_a_bad_name_not_a_crash` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `tc87_a_malformed_question_is_exit_2_with_a_message_on_stderr` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `copies_and_preferred` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `compare_git_reports_not_run_and_runs` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `tc88_absence_is_an_answer_on_stdout_with_exit_0` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `the_node_at_id_form_picks_a_copy` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `workspace_command_success_and_refusal` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `the_two_root_form_equals_the_state_dir_form` | FAIL | the command stub panics at `cli::run` (exit 101), so no answer is printed |
| None.rs | `a_damaged_record_and_a_damaged_log_are_absences` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc62_reference_complete` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc64_reference_no_note` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc59_combination_complete` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc60_combination_incomplete` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `the_note_as_a_link_or_unreadable` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc66_note_not_json` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc63_reference_incomplete` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc61_combination_no_note` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc68_only_the_note_is_read` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc67_no_boolean_complete` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc04_reference_run_has_no_node_and_one_place` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `find_run_by_id_and_by_node` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc02_combination_run_several_copies` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc01_combination_run_one_copy` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc03_reference_run` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `either_marker_makes_a_run` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc06_a_link_named_combinations_is_not_followed` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc06_file_and_symlink_where_folders_belong` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc07_a_chain_that_ends_too_early_is_shallow` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc07_a_file_above_run_depth_is_not_a_folder` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc12_missing_root` | FAIL | `todo!()`: Lake::new |
| None.rs | `tc05_the_real_stray_folder` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc13_empty_root` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc07_depth_nine_and_ten` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc14_preferred_on_real_notes` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc15_preferred_against_the_hosts_lake` | pass | passes against the stubs (see below) |
| None.rs | `tc72_no_run_is_an_absence` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `an_unlistable_folder_is_rejected_unreadable` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `whole_fixture_lake_is_listed_in_order` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc16_order_is_stable` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc08_to_tc10_part_rule_in_the_walk` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc09_literal_benchmarks_and_dash_rules` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc09_a_bad_node_name` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc81_discover_ignores_temporaries_beside_records` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc14_preferred_follows_the_ranking_on_scratch_notes` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc11_no_marker` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `reference_run_with_only_a_compact_log` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `log_story_out_of_range` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `digest_equals_hash_of_bytes` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc38_compact_log_not_compressed` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc40_both_forms_the_raw_is_preferred` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc41_neither_form` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc44_lines_on_a_large_log_use_memory_of_one_line` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc35_raw_log_compressed_on_disk` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc43_one_line_without_a_final_newline_and_other_shapes` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc36_raw_log_not_compressed` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc42_zero_byte_raw_log` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `a_transfer_in_progress_is_not_a_log` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc37_and_tc39_compact_log_compressed_on_disk` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `an_unreadable_log` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc45_a_compact_file_that_is_not_gzip` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc46_a_link_in_a_logs_place` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc45_a_damaged_compact_file` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc108_w2_read_only_over_a_whole_lake` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc78_a_read_only_lake_answers_as_before` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc77_the_lake_is_unchanged_after_every_call` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc19_story_records` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc17_every_record_of_a_combination_run` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc18_records_of_a_reference_run` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc22_text_records_are_text_and_the_same_bytes` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc24_commit_of_a_story` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc27_absent_record_combination` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc31_story_out_of_range_is_a_bad_name_before_any_file_is_touched` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc32_and_tc33_versions_before_any_file_is_touched` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc28_absent_record_reference` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc23_bytes_are_exact_for_non_utf8_and_crlf` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc74_no_fallback_to_another_copy` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc75_no_default_value_for_an_absent_record` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc21_rescore_versions` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc29_a_link_in_the_place_of_a_record` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc21_rescore_that_is_a_link_is_not_a_file` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc30_story_0_and_999_names` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc34_a_record_that_does_not_parse` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc20_rescore_records` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc79_a_transfer_in_progress_is_never_returned` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc80_a_transfer_next_to_a_good_file` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc73_unreadable_record` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `canonical_numbers` | FAIL | `todo!()`: canonical |
| None.rs | `completeness_names` | FAIL | `todo!()`: Completeness::as_str |
| None.rs | `canonical_sha256` | FAIL | `todo!()`: sha256_hex |
| None.rs | `canonical_strings` | FAIL | `todo!()`: canonical |
| None.rs | `every_record_maps_to_its_file_and_back` | FAIL | `todo!()`: Record::relative_path |
| None.rs | `from_relative_path_rejects_what_is_not_a_record` | FAIL | `todo!()`: Record::from_relative_path |
| None.rs | `complete_true_with_state_and_times` | FAIL | `todo!()`: decide |
| None.rs | `canonical_sorts_keys_and_drops_whitespace` | FAIL | `todo!()`: canonical |
| None.rs | `item_names` | FAIL | `todo!()`: Record::item_name |
| None.rs | `item_texts` | FAIL | `todo!()`: Absent::new |
| None.rs | `part_rule_alphabet` | FAIL | `todo!()`: is_valid_part |
| None.rs | `record_names_from_words` | FAIL | `todo!()`: Record::from_words |
| None.rs | `refused_json` | FAIL | `todo!()`: Refused::to_json |
| None.rs | `state_and_times_that_are_not_the_right_type_are_none` | FAIL | `todo!()`: decide |
| None.rs | `tc08_part_of_64_characters_is_valid` | FAIL | `todo!()`: is_valid_part |
| None.rs | `tc09_part_of_65_characters_is_not_valid` | FAIL | `todo!()`: is_valid_part |
| None.rs | `tc10_dot_parts_are_not_valid` | FAIL | `todo!()`: is_valid_part |
| None.rs | `tc14_a_copy_with_no_note_ranks_below_one_with_a_note` | FAIL | `todo!()`: compare_copies |
| None.rs | `tc14_equal_but_node_prefers_the_smaller_node` | FAIL | `todo!()`: compare_copies |
| None.rs | `tc14_missing_settled_at_is_lowest` | FAIL | `todo!()`: compare_copies |
| None.rs | `tc14_ranking_order` | FAIL | `todo!()`: compare_copies |
| None.rs | `tc22_text_records` | FAIL | `todo!()`: Record::is_text |
| None.rs | `tc25_story_padding` | FAIL | `todo!()`: story_dir |
| None.rs | `tc26_and_tc30_story_999_and_0` | FAIL | `todo!()`: Record::relative_path |
| None.rs | `tc31_story_out_of_range_is_a_bad_name` | FAIL | `todo!()`: Record::relative_path |
| None.rs | `tc32_version_of_one_character` | FAIL | `todo!()`: is_valid_version |
| None.rs | `tc33_bad_versions` | FAIL | `todo!()`: is_valid_version |
| None.rs | `tc65_settled_at_null_is_none` | FAIL | `todo!()`: decide |
| None.rs | `tc66_note_that_is_not_an_object` | FAIL | `todo!()`: decide |
| None.rs | `tc67_no_boolean_complete` | FAIL | `todo!()`: Lake::in_state_dir |
| None.rs | `tc69_canonical_text` | FAIL | `todo!()`: Absent::new |
| None.rs | `tc70_canonical_json` | FAIL | `todo!()`: Absent::new |
| None.rs | `tc71_every_code_has_its_text` | FAIL | `todo!()`: Reason::code |
| None.rs | `tc89_dependencies_are_serde_json_flate2_and_sha2_only` | pass | passes against the stubs (see below) |
| None.rs | `the_message_is_not_part_of_the_canonical_form` | FAIL | `todo!()`: Absent::new |
| None.rs | `tc90_member_of_the_workspace` | pass | passes against the stubs (see below) |
| None.rs | `unreadable_reason_from_io_errors` | FAIL | `todo!()`: Reason::from_io |
| None.rs | `tc83_only_bundle_rs_starts_a_process_for_the_library` | pass | passes against the stubs (see below) |
| None.rs | `tc83_rust_makes_no_writes_outside_bundle_rs` | FAIL | the stub bundle.rs makes no working copy yet (scan expects its writes there) |
