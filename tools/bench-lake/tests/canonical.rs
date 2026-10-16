//! The worked examples of CANONICAL.md are real output: every example block is run and compared byte for byte.

mod common;
use common::*;
use std::fs;

const EXAMPLE_OPEN: &str = "```example";
const EXIT_OK: i32 = 0;
const EXIT_REFUSED: i32 = 2;
const QUESTIONS: [&str; 7] = ["runs", "copies", "preferred", "record", "log", "workspace", "complete"];

struct Example {
    args: Vec<String>,
    output: String,
}

fn examples() -> Vec<Example> {
    let text = fs::read_to_string(manifest_dir().join("CANONICAL.md")).unwrap();
    let mut out = Vec::new();
    let mut lines = text.lines();
    while let Some(l) = lines.next() {
        if l == EXAMPLE_OPEN {
            let cmd = lines.next().unwrap().strip_prefix("$ bench-lake <LAKE> ").expect("example command line").to_string();
            let output = lines.next().unwrap().to_string();
            assert_eq!(lines.next().unwrap(), "```");
            out.push(Example { args: cmd.split(' ').map(String::from).collect(), output });
        }
    }
    out
}

#[test]
fn every_question_has_a_worked_example() {
    let ex = examples();
    for q in QUESTIONS {
        assert!(ex.iter().any(|e| e.args[0] == q), "no example for {q}");
    }
    assert!(ex.iter().any(|e| e.output.contains("\"status\":\"absent\"")));
    assert!(ex.iter().any(|e| e.output.contains("\"status\":\"refused\"")));
}

#[test]
fn the_worked_examples_are_the_commands_output() {
    let s = Scratch::new("canon");
    let dest = s.join("dest");
    let nonempty = s.join("nonempty");
    write(&nonempty.join("keep"), b"x");
    let mut checked = 0;
    for e in examples() {
        let args: Vec<String> = e
            .args
            .iter()
            .map(|a| match a.as_str() {
                "<DEST>" => dest.to_string_lossy().to_string(),
                "<NONEMPTY-DEST>" => nonempty.to_string_lossy().to_string(),
                other => other.to_string(),
            })
            .collect();
        let want = e.output.replace("<DEST>", &dest.to_string_lossy()).replace("<NONEMPTY-DEST>", &nonempty.to_string_lossy());
        let o = bench_lake_cmd().arg(fixture_state()).args(&args).output().unwrap();
        let got = String::from_utf8(o.stdout).unwrap();
        assert_eq!(got, format!("{want}\n"), "{:?}", e.args);
        let expected_exit = if want.contains("\"status\":\"refused\"") { EXIT_REFUSED } else { EXIT_OK };
        assert_eq!(o.status.code(), Some(expected_exit), "{:?}", e.args);
        checked += 1;
        if want.contains("\"status\":\"found\"") && e.args[0] == "workspace" {
            // the working copy is made once; the next workspace example starts from the same destination name
            let _ = fs::remove_dir_all(&dest);
        }
    }
    assert!(checked >= 15, "{checked}");
}
