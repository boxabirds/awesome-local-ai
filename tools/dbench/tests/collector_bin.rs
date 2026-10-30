//! The collector runs as its own program, `dbench-collector`, so a process list tells it from a benchmark node
//! (`dbench serve`). Until 30 Oct 2026 it ran as `dbench collect`, and Activity Monitor showed two processes named
//! `dbench`, one of them using half a core, with nothing to say which was the collector.

use std::process::Command;

fn collector(args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_dbench-collector")).args(args).output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

#[test]
fn the_collector_is_a_program_of_its_own_name() {
    let (ok, out) = collector(&["--help"]);
    assert!(ok, "{out}");
    assert!(out.contains("Usage: dbench-collector"), "{out}");
    // It is the collector: its options, and the description of what it does.
    for opt in ["--store", "--once", "--db", "--free-space-margin-gib"] {
        assert!(out.contains(opt), "{opt} missing: {out}");
    }
    assert!(out.contains("into the lake"), "{out}");
    // Not the benchmark tool with its list of commands (serve, submit, ...).
    assert!(!out.contains("Commands:") && !out.contains("submit"), "{out}");
}

#[test]
fn it_takes_the_same_options_as_dbench_collect_and_does_the_same_thing() {
    // The rule list is the collector's own output, and needs no node: the two programs print the same.
    let (ok, mine) = collector(&["--list-rules"]);
    assert!(ok, "{mine}");
    let theirs = Command::new(env!("CARGO_BIN_EXE_dbench")).args(["collect", "--list-rules"]).output().unwrap();
    assert!(theirs.status.success());
    assert_eq!(mine, String::from_utf8_lossy(&theirs.stdout));
    let (ok, out) = collector(&["--no-such-option"]);
    assert!(!ok, "{out}");
}

#[test]
fn it_names_the_build_it_runs_as_dbench_does() {
    // A service has to say which build it is: "0.1.0+<commit>", the same string as dbench's.
    let (ok, mine) = collector(&["--version"]);
    assert!(ok, "{mine}");
    let theirs = Command::new(env!("CARGO_BIN_EXE_dbench")).arg("--version").output().unwrap();
    let theirs = String::from_utf8_lossy(&theirs.stdout).replacen("dbench", "dbench-collector", 1);
    assert_eq!(mine, theirs);
    assert!(mine.contains('+'), "{mine}");
}
