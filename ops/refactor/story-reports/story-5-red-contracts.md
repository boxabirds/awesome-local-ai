# Story 5, red contracts (15 Oct 2026)

The new tests of story 5 (TC-01 to TC-99, written from the design's test tables), run against the skeleton: the same
types, constants, tables and signatures as the finished code, with every behavioural function ending in `todo!()` (the
functions of the deletion report, plus `classify`, `list_rules`, `is_inside_run`, `has_link_below`, `dest_dir`,
`is_run_path`, `classes_for`, `pull_blob`, `space_decision`, `free_bytes`, `blob_stale`, the private-mode helpers of
`store.rs` and the checking functions of the name check), and the codes that the new code adds to messages taken out.
`cargo test -p dbench --no-fail-fast`: a test that fails is red; a test that passes is listed with why.

## `tools/dbench/src/collect.rs`, unit (tasks 5.4, 5.8, 5.10, 5.11, 5.12)

32 of 37 red.

| test | against the skeleton |
|---|---|
| `the_table_holds_the_42_rules_of_the_design_and_the_legacy_records_beside_them` | passes: pins the counts of the rule tables, which are data the skeleton holds |
| `every_fixed_record_name_parses_with_the_kind_and_class_of_the_table` | red |
| `every_fixed_raw_name_parses_as_raw_and_append` | red |
| `every_story_name_parses_for_story_01_and_story_123` | red |
| `tree_names_parse_as_blob_records` | red |
| `the_13_names_of_the_list_this_replaced_still_parse_with_their_old_kind` | red |
| `a_name_no_rule_accepts_is_not_parsed` | red |
| `a_story_number_of_four_digits_is_refused` | red |
| `a_segment_outside_the_alphabet_is_refused` | red |
| `a_segment_may_be_128_characters_and_not_129` | red |
| `a_tree_name_may_be_as_deep_as_the_constant_and_not_one_deeper` | red |
| `a_dot_segment_or_an_empty_one_is_refused` | red |
| `an_in_flight_temporary_is_never_a_collected_name` | red |
| `the_records_of_an_older_layout_are_collected_too` | red |
| `the_egress_log_is_the_one_work_dir_txt_names_else_a_file_of_that_name_in_the_run` | red |
| `every_rule_resolves_under_the_run_dir_or_the_egress_dir` | red |
| `each_name_left_out_on_purpose_is_classified_with_a_reason` | red |
| `a_temporary_is_left_out_and_wins_over_the_tree_rule` | red |
| `every_not_collected_rule_has_a_reason_and_the_list_has_eight` | passes: pins the not-collected table (a count and a reason each), data the skeleton holds |
| `classify_is_total_over_the_old_names_and_the_not_collected_ones` | red |
| `the_rules_are_printed_one_line_each_with_the_reason_of_every_exclusion` | red |
| `the_node_never_lists_a_name_that_is_left_out` | red |
| `a_path_that_leaves_the_run_directory_through_a_link_is_not_inside_it` | red |
| `the_destinations_the_rules_compute_are_only_names_below_the_run_directory` | red |
| `every_recorded_name_is_classified_by_exactly_one_rule` | red |
| `a_collected_and_a_not_collected_rule_that_accept_one_name_are_an_overlap` | red |
| `a_rule_that_matches_no_recorded_name_is_unused_unless_it_is_on_the_unobserved_list` | red |
| `every_rule_matches_a_recorded_name_or_is_unobserved_with_a_reason` | red |
| `the_unobserved_rules_are_rules_with_reasons` | passes: pins a list of data to the rule tables |
| `literals_that_are_not_run_files_are_named_in_the_non_run_file_and_not_reported` | red |
| `a_story_number_and_a_version_are_normalised_in_the_corpus` | red |
| `the_deepest_corpus_name_is_within_the_tree_depth` | passes: pins a constant to the recorded corpus: it tests data against data |
| `the_harness_sources_write_no_file_name_the_lists_do_not_know` | red |
| `the_scan_finds_the_file_name_literals_of_the_design_table` | red |
| `a_new_literal_in_a_scratch_copy_of_the_harness_fails_with_its_file_and_line_and_passes_again_without_it` | red |
| `a_literal_in_a_comment_or_a_docstring_is_still_reported` | red |
| `the_corpus_header_names_the_commit_and_its_counts_match_what_git_tracked_there` | passes: tests the recorded corpus against git, not any code of the collector |

## `tools/dbench/src/collector.rs`, unit (tasks 5.6, 5.14, 5.16, 5.18 and the decision of 5.33)

36 of 38 red.

| test | against the skeleton |
|---|---|
| `a_blob_of_exactly_one_chunk_arrives_in_one_request_with_eof` | red |
| `a_blob_of_one_chunk_and_one_byte_arrives_in_two_requests` | red |
| `a_blob_of_zero_bytes_is_a_zero_byte_file_with_no_partial_left` | red |
| `the_final_name_appears_only_after_the_last_chunk_while_the_partial_holds_what_was_pulled` | red |
| `a_pass_killed_after_two_chunks_is_resumed_from_the_partial_and_ends_equal` | red |
| `a_partial_of_a_file_the_node_has_since_rewritten_is_discarded_and_the_file_fetched_from_the_start` | red |
| `a_file_rewritten_between_two_chunks_is_refused_with_a_conflict_and_the_copy_ends_equal_to_the_new_file` | red |
| `a_node_that_reports_more_bytes_than_it_sends_makes_the_collector_discard_the_partial_and_fetch_again` | red |
| `a_node_that_keeps_reporting_a_wrong_size_fails_with_both_codes_and_leaves_no_file_under_the_real_name` | red |
| `a_blob_whose_node_file_changes_on_every_request_fails_and_the_lake_keeps_its_last_complete_copy` | red |
| `a_collection_note_written_before_blobs_existed_loads_with_no_partial` | passes: an optional field is absent as None whatever the code says: a compatibility check that holds before and after |
| `plan_skips_a_blob_the_lake_holds_resumes_a_matching_partial_and_starts_over_otherwise` | red |
| `the_partial_file_sits_beside_the_final_name_and_starts_with_a_dot` | red |
| `a_reference_run_goes_to_the_reference_folder_by_pack_stack_and_run_and_any_other_run_to_the_lake` | red |
| `a_reference_run_id_of_the_wrong_shape_has_no_destination` | red |
| `a_reference_run_is_wanted_an_archived_one_is_not_and_the_run_narrowing_works_as_before` | red |
| `a_reference_run_takes_its_records_only_and_any_other_run_takes_both_classes` | red |
| `the_note_of_a_reference_run_holds_the_full_id_and_the_node_and_a_second_node_updates_it_in_the_one_folder` | red |
| `a_run_with_no_note_becomes_collecting_and_the_first_time_is_set` | red |
| `a_running_run_is_never_complete_however_long_it_waits` | red |
| `a_settled_run_with_every_file_held_waits_out_the_grace_then_completes_and_a_later_look_changes_nothing` | red |
| `a_grace_of_zero_completes_on_the_pass_that_sees_it_settled_twice_and_a_grace_of_one_second_needs_one_second` | red |
| `a_file_that_changes_on_the_node_after_the_run_settled_clears_the_settling` | red |
| `an_outstanding_partial_blocks_completeness` | red |
| `an_old_node_with_no_runs_route_is_reported_with_its_code_and_an_unreachable_one_with_its` | red |
| `a_run_a_node_sends_that_is_not_a_run_path_is_reported_and_skipped` | red |
| `collection_json_has_no_error_reason_or_problem_field_even_with_blobs_and_unlisted_files` | passes: a negative invariant of the note's shape: it holds before and after |
| `every_run_id_that_exists_today_has_its_expected_folder` | red |
| `a_path_that_is_not_a_run_has_no_folder_and_nothing_is_written` | red |
| `the_longest_id_today_and_the_longest_the_rules_allow_have_folders_and_one_character_more_does_not` | red |
| `the_note_of_a_combination_run_holds_its_id_and_the_lake_folder_is_store_node_id` | red |
| `free_space_far_above_the_margin_or_just_above_it_or_exactly_at_it_pulls` | red |
| `one_byte_below_the_margin_holds_with_one_line_that_names_the_free_space_and_the_margin` | red |
| `free_space_that_cannot_be_read_holds_and_says_so_without_a_guessed_value` | red |
| `the_margin_is_a_setting_with_a_proposed_default_of_ten_gib` | red |
| `the_free_bytes_of_a_real_folder_are_read_and_of_a_missing_one_are_an_error` | red |
| `a_pass_that_holds_for_space_contacts_no_node_and_creates_no_file` | red |
| `the_collection_notes_and_the_lake_are_created_readable_by_the_owner_alone` | red |

## `tools/dbench/src/server.rs`, unit (task 5.6, TC-27)

5 of 5 red.

| test | against the skeleton |
|---|---|
| `a_blob_read_from_the_start_is_never_stale_whatever_it_names` | red |
| `a_blob_read_from_past_the_end_is_stale` | red |
| `a_blob_read_from_past_zero_with_another_mtime_or_none_is_stale` | red |
| `a_blob_read_from_its_last_byte_is_fresh_and_from_exactly_the_size_too` | red |
| `the_mtime_is_compared_to_the_millisecond_the_headers_carry` | red |

## `tools/dbench/tests/lake_full_record.rs`, integration and end to end (tasks 5.5, 5.7, 5.9, 5.13, 5.15, 5.17, 5.19, 5.20, 5.21, 5.33)

32 of 32 red.

| test | against the skeleton |
|---|---|
| `the_manifest_of_a_real_run_lists_the_full_record` | red |
| `the_manifest_leaves_out_the_working_tree_the_control_files_and_every_temporary` | red |
| `a_name_outside_the_alphabet_is_counted_not_listed_and_does_not_delay_completeness_and_a_hundred_screenshots_all_list` | red |
| `a_blob_of_a_hundred_kilobytes_arrives_in_one_request_byte_for_byte` | red |
| `a_ten_megabyte_bundle_arrives_in_three_requests_and_leaves_no_partial` | red |
| `a_pass_killed_after_two_chunks_is_resumed_from_the_partial_over_the_real_server` | red |
| `a_file_rewritten_between_two_chunks_gives_a_conflict_and_the_copy_ends_equal_to_the_new_file` | red |
| `a_complete_blob_whose_node_mtime_changed_is_fetched_again_and_replaced_whole` | red |
| `a_blob_that_changes_on_every_request_fails_with_the_limit_and_the_lake_keeps_its_last_complete_copy` | red |
| `a_whole_file_over_one_chunk_is_refused_with_its_code_and_a_zero_byte_blob_is_collected_as_an_empty_file` | red |
| `the_large_members_of_a_run_arrive_whole_at_twenty_and_fifty_megabytes` | red |
| `the_node_neither_lists_nor_serves_a_name_that_is_left_out_and_none_reaches_the_lake` | red |
| `a_run_with_only_left_out_files_besides_its_marker_has_a_manifest_of_that_marker_alone` | red |
| `held_out_detail_and_the_trees_are_collected_byte_for_byte` | red |
| `a_request_for_a_name_outside_the_list_is_refused_with_its_code` | red |
| `a_link_inside_a_tree_is_neither_listed_nor_served_and_a_linked_folder_is_not_followed` | red |
| `a_run_the_node_does_not_have_and_a_run_that_is_no_path_are_refused_with_their_codes` | red |
| `every_file_and_folder_the_collector_creates_is_readable_by_the_owner_alone` | red |
| `a_reference_run_lands_under_reference_with_its_records_and_compact_logs_and_no_raw_stream` | red |
| `a_reference_run_still_running_is_collected_as_it_grows_and_completes_only_after_it_settles` | red |
| `a_pass_with_the_ingest_on_collects_a_reference_run_and_leaves_the_ingest_input_free_of_it` | red |
| `a_rescore_that_arrives_after_the_run_is_complete_is_collected_and_the_run_completes_again` | red |
| `a_crash_between_a_chunk_and_the_note_is_healed_in_every_state_it_can_leave` | red |
| `a_crash_in_the_middle_of_a_whole_file_and_of_an_append_log_is_healed_by_size_and_prefix` | red |
| `a_node_that_is_down_is_reported_with_its_code_the_lake_is_untouched_and_another_node_is_still_collected` | red |
| `w1_a_finished_run_is_collected_whole_and_marked_complete_only_after_everything_is_held` | red |
| `w1_a_run_that_settled_with_no_stories_is_complete_with_its_records_alone` | red |
| `w2_a_reference_run_and_a_combination_run_collected_in_one_pass_land_where_they_belong` | red |
| `w3_a_pass_aborted_in_the_middle_of_a_bundle_and_a_rescore_rewrite_still_end_equal_to_the_node` | red |
| `w4_a_shortage_then_recovery_in_one_run_of_passes_holds_once_then_pulls` | red |
| `a_pass_below_the_margin_reports_the_shortage_once_however_many_nodes_and_runs_it_would_have_pulled` | red |
| `a_shortage_on_a_real_small_disk_pulls_nothing_and_a_partial_resumes_when_space_returns` | red |

## Where the tests live now

The red run is of the tests where they were first written. The unit tests that use only the public API were then moved, unchanged, out of `src/` into
`tools/dbench/tests/allow_list.rs` (the collect.rs group: 24 tests) and `tools/dbench/tests/collector_lake.rs` (the collector.rs and server.rs groups: 43 tests, and one
more added later, TC-82's `E-NOT-A-RUN-PATH`). The checks that need private items stay in `src/collect.rs` (`mod name_check`). The names are those in the tables above.

## Totals

112 new tests: 105 red, 7 pass against the skeleton, each for the reason in its row (data the tables hold,
the recorded corpus against git, an optional field that is absent as None, a negative invariant).

The old tests of the touched modules fail against the skeleton too, as they did against the stubs: 8 of the ones that pin the old list or the old pass (listed in the deletion report). The rest of the suite (analytics, harness, ingest outside the collect pass, label, release) passes.
