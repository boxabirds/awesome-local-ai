//! The text `dbench --help` prints is the first documentation anyone reads. These tests run the real binary and
//! check that each command is described by its own text, and that `cancel` says what it costs.

use std::process::Command;

fn help(args: &[&str]) -> String {
    let out = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(args)
        .arg("--help")
        .output()
        .expect("run dbench");
    assert!(out.status.success());
    String::from_utf8(out.stdout).expect("utf-8 help")
}

/// The one-line summary `dbench --help` lists for a command.
fn listed_summary(command: &str) -> String {
    let top = help(&[]);
    let line = top
        .lines()
        .find(|l| l.trim_start().starts_with(&format!("{command} ")))
        .unwrap_or_else(|| panic!("`{command}` is not listed"));
    line.trim_start()[command.len()..].trim().to_string()
}

#[test]
fn collect_is_described_as_the_collector_not_as_skip_story() {
    let summary = listed_summary("collect");
    assert!(!summary.contains("PARTIAL"), "collect is described as: {summary}");
    assert!(summary.to_lowercase().contains("lake"), "collect is described as: {summary}");
}

#[test]
fn skip_story_is_described_as_ending_the_running_story_as_partial() {
    let summary = listed_summary("skip-story");
    assert!(summary.contains("PARTIAL"), "skip-story is described as: {summary:?}");
}

#[test]
fn cancel_says_recorded_stories_are_kept_and_the_same_run_id_resumes() {
    let text = help(&["cancel"]);
    assert!(text.contains("recorded"), "{text}");
    assert!(text.contains("same run id"), "{text}");
    assert!(text.contains("submit"), "{text}");
    assert!(!text.to_lowercase().contains("lost"), "{text}");
}
