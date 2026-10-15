//! Story 5, unit tests of the allow-list and its not-collected list, through the public API (lake.allowlist.full_record,
//! lake.allowlist.not_collected, and the path-safety half of lake.serve.held_out_allowlist). The checks that need the
//! private matching functions are in src/collect.rs (mod name_check).

use dbench::collect::*;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-allow-list-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}


// ---- story 5: the lake takes the full record (lake.allowlist.full_record) ----

/// The 19 fixed record names of the design table, with their kinds.
const FIXED_RECORDS: [(&str, FileKind); 19] = [
    ("run.json", FileKind::Whole),
    ("run-history.jsonl", FileKind::Whole),
    ("run-status.json", FileKind::Whole),
    ("metrics.json", FileKind::Whole),
    ("interventions.md", FileKind::Whole),
    ("summary.md", FileKind::Whole),
    ("summary-detail.md", FileKind::Whole),
    ("finalize.json", FileKind::Whole),
    ("server-health.json", FileKind::Whole),
    ("flow-counts.json", FileKind::Whole),
    ("machine-unfit.json", FileKind::Whole),
    ("progress.json", FileKind::Whole),
    ("metrics.subagent.json", FileKind::Blob),
    ("heldout-detail.json", FileKind::Blob),
    ("workspace-git-log.txt", FileKind::Blob),
    ("AUDIT.md", FileKind::Blob),
    ("audit.jsonl", FileKind::Blob),
    ("publish-refused.json", FileKind::Blob),
    ("workspace.bundle", FileKind::Blob),
];
const FIXED_RAW: [&str; 4] = ["server.log", "proxy.log", "requests.jsonl", "egress.jsonl"];
/// The 9 story record names and the 2 story raw names.
const STORY_RECORDS: [(&str, FileKind); 9] = [
    ("prompt.md", FileKind::Whole),
    ("base-commit", FileKind::Whole),
    ("gate.json", FileKind::Whole),
    ("accept-summary.json", FileKind::Whole),
    ("accept-final-summary.json", FileKind::Whole),
    ("accept.json", FileKind::Blob),
    ("accept-report.json", FileKind::Blob),
    ("accept-final.json", FileKind::Blob),
    ("agent-events.compact.jsonl.gz", FileKind::Blob),
];
const STORY_RAW: [&str; 2] = ["agent-events.jsonl", "conditions.jsonl"];

#[test]
fn the_table_holds_the_42_rules_of_the_design_and_the_legacy_records_beside_them() {
    assert_eq!(COLLECTABLE.len(), COLLECTED_RULES);
    assert_eq!(LEGACY_RECORDS.len(), LEGACY_RULES);
    let count = |f: &dyn Fn(&Collectable) -> bool| COLLECTABLE.iter().filter(|e| f(e)).count();
    assert_eq!(count(&|e| matches!(e.pattern, Pattern::Fixed(_)) && e.class == Class::Record), 19);
    assert_eq!(count(&|e| matches!(e.pattern, Pattern::Fixed(_)) && e.class == Class::Raw), 4);
    assert_eq!(count(&|e| matches!(e.pattern, Pattern::Story(_)) && e.class == Class::Record), 9);
    assert_eq!(count(&|e| matches!(e.pattern, Pattern::Story(_)) && e.class == Class::Raw), 2);
    assert_eq!(count(&|e| matches!(e.pattern, Pattern::Tree(_))), 8);
    let ids: BTreeSet<&str> = rules().map(|e| e.id).collect();
    assert_eq!(ids.len(), COLLECTED_RULES + LEGACY_RULES, "every rule has its own id");
}

#[test]
fn every_fixed_record_name_parses_with_the_kind_and_class_of_the_table() {
    // TC-01
    for (name, kind) in FIXED_RECORDS {
        let n = parse_name(name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!((n.name().as_str(), n.kind(), n.class()), (name, kind, Class::Record), "{name}");
        assert_eq!(n.rule(), name);
    }
}

#[test]
fn every_fixed_raw_name_parses_as_raw_and_append() {
    // TC-02
    for name in FIXED_RAW {
        let n = parse_name(name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!((n.kind(), n.class()), (FileKind::Append, Class::Raw), "{name}");
    }
    assert_eq!(parse_name("egress.jsonl").unwrap().source(), Source::Egress);
    assert_eq!(parse_name("server.log").unwrap().source(), Source::RunDir);
}

#[test]
fn every_story_name_parses_for_story_01_and_story_123() {
    // TC-03
    for story in ["01", "123"] {
        for (file, kind) in STORY_RECORDS {
            let name = format!("stories/{story}/{file}");
            let n = parse_name(&name).unwrap_or_else(|| panic!("{name}"));
            assert_eq!((n.name(), n.kind(), n.class()), (name.clone(), kind, Class::Record), "{name}");
        }
        for file in STORY_RAW {
            let name = format!("stories/{story}/{file}");
            let n = parse_name(&name).unwrap_or_else(|| panic!("{name}"));
            assert_eq!((n.kind(), n.class()), (FileKind::Append, Class::Raw), "{name}");
        }
    }
}

#[test]
fn tree_names_parse_as_blob_records() {
    // TC-04
    for name in [
        "rescore/vidi-v2.0-pre2/rescore.json",
        "rescore/V/stories/12/accept-summary.json",
        "rescore-spoiled/vidi-v2.0-pre2-20261009T125355/set-aside.json",
        "superseded/S/x/y",
        "base/accept.json",
        "base/x/y/z.png",
        "stories/01/artifacts/a/b.png",
        "stories/01/artifacts/.last-run.json",
        "stories/02/screenshots/shot-01.png",
        "stories/02/pre-suite-fix/y.json",
        "stories/01/scoring-2/accept.json",
        "stories/123/scoring-12/a/b/c.log",
    ] {
        let n = parse_name(name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!((n.kind(), n.class(), n.name().as_str()), (FileKind::Blob, Class::Record, name), "{name}");
    }
}

#[test]
fn the_13_names_of_the_list_this_replaced_still_parse_with_their_old_kind() {
    // TC-11
    let old: [(&str, FileKind); 13] = [
        ("stories/03/agent-events.jsonl", FileKind::Append),
        ("stories/03/conditions.jsonl", FileKind::Append),
        ("server.log", FileKind::Append),
        ("proxy.log", FileKind::Append),
        ("progress.json", FileKind::Whole),
        ("egress.jsonl", FileKind::Append),
        ("metrics.json", FileKind::Whole),
        ("run.json", FileKind::Whole),
        ("run-status.json", FileKind::Whole),
        ("interventions.md", FileKind::Whole),
        ("stories/03/accept-summary.json", FileKind::Whole),
        ("stories/03/gate.json", FileKind::Whole),
        ("stories/03/base-commit", FileKind::Whole),
    ];
    for (name, kind) in old {
        assert_eq!(parse_name(name).unwrap_or_else(|| panic!("{name}")).kind(), kind, "{name}");
    }
    assert_eq!(COLLECTABLE.iter().take(old.len()).map(|e| e.id).collect::<Vec<_>>().len(), 13);
}

#[test]
fn a_name_no_rule_accepts_is_not_parsed() {
    // TC-05
    for bad in [
        "stories/01/other.json",
        "rescore",
        "rescore/",
        "rescore/V",
        "a/b",
        "",
        "/run.json",
        "run.json/",
        "RUN.JSON",
        "stories/01/artifacts",
        "stories/01/artifacts/",
        "stories/01/scoring-/x",
        "stories/01/scoring-x/y",
        "stories/01/scoring-1234/y",
        "workspace/a/b",
        "control/skip-story.json",
        "current_story",
        "work_dir.txt",
    ] {
        assert!(parse_name(bad).is_none(), "{bad:?}");
    }
}

#[test]
fn a_story_number_of_four_digits_is_refused() {
    // TC-06
    assert!(parse_name("stories/1234/prompt.md").is_none());
    assert!(parse_name("stories/1234/artifacts/a.png").is_none());
    assert!(parse_name("stories/123/prompt.md").is_some());
    assert!(parse_name("stories/x1/prompt.md").is_none());
}

#[test]
fn a_segment_outside_the_alphabet_is_refused() {
    // TC-07
    for bad in [
        "stories/01/artifacts/a b.png",
        "stories/01/artifacts/a\\b.png",
        "stories/01/artifacts/é.png",
        "stories/01/artifacts/a→b.png",
        "stories/01/artifacts/a(1).png",
        "rescore/v 2/rescore.json",
        "base/a:b",
    ] {
        assert!(parse_name(bad).is_none(), "{bad:?}");
    }
    for ok in ["base/a+b", "base/a@b", "base/a=b", "base/a_b", "base/A-b.c"] {
        assert!(parse_name(ok).is_some(), "{ok:?}");
    }
}

#[test]
fn a_segment_may_be_128_characters_and_not_129() {
    // TC-08
    let long = "a".repeat(MAX_SEGMENT_CHARS);
    let too_long = "a".repeat(MAX_SEGMENT_CHARS + 1);
    assert!(parse_name(&format!("stories/01/artifacts/{long}")).is_some());
    assert!(parse_name(&format!("stories/01/artifacts/{too_long}")).is_none());
    assert!(parse_name(&format!("rescore/{long}/x.json")).is_some());
    assert!(parse_name(&format!("rescore/{too_long}/x.json")).is_none());
}

#[test]
fn a_tree_name_may_be_as_deep_as_the_constant_and_not_one_deeper() {
    // TC-09
    let below = |extra: usize| format!("stories/01/artifacts/{}", vec!["d"; extra].join("/"));
    let room = MAX_TREE_DEPTH - 3;
    assert_eq!(below(room).split('/').count(), MAX_TREE_DEPTH);
    assert!(parse_name(&below(room)).is_some());
    assert!(parse_name(&below(room + 1)).is_none());
    assert!(parse_name(&below(1)).is_some());
}

#[test]
fn a_dot_segment_or_an_empty_one_is_refused() {
    // TC-10
    for bad in [
        "rescore/../x",
        "rescore/./x",
        "rescore//x",
        "rescore/V/../x.json",
        "stories/01/artifacts/../../x",
        "stories/01/artifacts/./a",
        "stories/01/artifacts//a",
        "base/..",
        "base/.",
        "../server.log",
        "stories/../agent-events.jsonl",
    ] {
        assert!(parse_name(bad).is_none(), "{bad:?}");
    }
}

#[test]
fn an_in_flight_temporary_is_never_a_collected_name() {
    for tmp in [".progress.json.1234.tmp", ".x.partial", "stories/01/artifacts/.y.tmp", "base/.z.partial", "rescore/V/.a.json.9.tmp"] {
        assert!(parse_name(tmp).is_none(), "{tmp}");
    }
    // A dot file that is not a temporary is a name like any other.
    assert!(parse_name("stories/01/artifacts/.last-run.json").is_some());
}

#[test]
fn the_records_of_an_older_layout_are_collected_too() {
    // The corpus of recorded run directories holds names the design's 42 rules do not cover (tests/fixtures/run-nonrun-literals.toml).
    for name in [
        "OMITTED.txt",
        "README.md",
        "accept-summary.json",
        "accept-final.json",
        "accept-final-summary.json",
        "stories/04/gate.original.json",
        "prompts/story-01.md",
        "agent-reports/story-12.md",
    ] {
        let n = parse_name(name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!(n.class(), Class::Record, "{name}");
    }
    assert!(parse_name("prompts").is_none() && parse_name("agent-reports/").is_none());
}

#[test]
fn the_egress_log_is_the_one_work_dir_txt_names_else_a_file_of_that_name_in_the_run() {
    let root = temp_dir("egress-fallback");
    let run_dir = root.join("run");
    let bench_home = root.join("bench");
    std::fs::create_dir_all(&run_dir).unwrap();
    std::fs::create_dir_all(bench_home.join(EGRESS_DIR)).unwrap();
    let name = parse_name(EGRESS_NAME).unwrap();
    // No work_dir.txt: the file in the run directory itself (one tracked run holds its egress log there).
    assert_eq!(resolve(&run_dir, &bench_home, &name), Some(run_dir.join(EGRESS_NAME)));
    // work_dir.txt names a log that exists: that one.
    std::fs::write(run_dir.join(WORK_DIR_FILE), "/w/run-7\n").unwrap();
    std::fs::write(bench_home.join(EGRESS_DIR).join("run-7.jsonl"), "{}\n").unwrap();
    assert_eq!(resolve(&run_dir, &bench_home, &name), Some(bench_home.join(EGRESS_DIR).join("run-7.jsonl")));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn every_rule_resolves_under_the_run_dir_or_the_egress_dir() {
    let root = temp_dir("resolve-rules");
    let run_dir = root.join("repo/combinations/a/b/benchmarks/p/r1");
    let bench_home = root.join("bench");
    std::fs::create_dir_all(&run_dir).unwrap();
    std::fs::write(run_dir.join(WORK_DIR_FILE), "/home/x/.w/abc123/workspace\n").unwrap();
    std::fs::create_dir_all(bench_home.join(EGRESS_DIR)).unwrap();
    std::fs::write(bench_home.join(EGRESS_DIR).join("workspace.jsonl"), "{}\n").unwrap();
    let mut names: Vec<String> = FIXED_RECORDS.iter().map(|(n, _)| n.to_string()).collect();
    names.extend(FIXED_RAW.iter().map(|n| n.to_string()));
    names.extend(STORY_RECORDS.iter().map(|(n, _)| format!("stories/02/{n}")));
    names.extend(STORY_RAW.iter().map(|n| format!("stories/02/{n}")));
    names.extend(["rescore/V/rescore.json", "base/x/y.json", "stories/02/artifacts/a/b.png", "stories/02/scoring-2/c.json"].map(String::from));
    for name in names {
        let p = resolve(&run_dir, &bench_home, &parse_name(&name).unwrap_or_else(|| panic!("{name}"))).unwrap();
        let inside = p.starts_with(&run_dir) || p == bench_home.join(EGRESS_DIR).join("workspace.jsonl");
        assert!(inside, "{name}: {}", p.display());
        if p.starts_with(&run_dir) {
            assert!(p.strip_prefix(&run_dir).unwrap().components().all(|c| matches!(c, std::path::Component::Normal(_))), "{name}");
        }
    }
    std::fs::remove_dir_all(&root).unwrap();
}

// ---- lake.allowlist.not_collected ----

#[test]
fn each_name_left_out_on_purpose_is_classified_with_a_reason() {
    // TC-29
    for name in ["workspace/a/b", "control/skip-story.json", "current_story", "work_dir.txt", ".gitignore", "archived.json"] {
        match classify(name) {
            Classification::NotCollected(rule, reason) => assert!(!reason.is_empty() && !rule.is_empty(), "{name}"),
            other => panic!("{name}: {other:?}"),
        }
    }
}

#[test]
fn a_temporary_is_left_out_and_wins_over_the_tree_rule() {
    // TC-30
    for tmp in [".progress.json.1234.tmp", ".x.partial", "stories/01/artifacts/.y.tmp", "rescore/V/.z.json.2.tmp", "base/.q.partial"] {
        assert!(matches!(classify(tmp), Classification::NotCollected(id, _) if id.starts_with(".NAME.")), "{tmp}: {:?}", classify(tmp));
    }
    // One at the run root and one inside a tree folder: the same rule.
    assert_eq!(classify(".a.tmp"), classify("stories/01/screenshots/.a.tmp"));
    assert_ne!(classify(".a.tmp"), classify(".a.partial"));
}

#[test]
fn every_not_collected_rule_has_a_reason_and_the_list_has_eight() {
    // TC-33
    assert_eq!(NOT_COLLECTED.len(), 8);
    for r in NOT_COLLECTED {
        assert!(r.reason.len() > 10 && !r.id.is_empty(), "{}", r.id);
    }
    let ids: BTreeSet<&str> = NOT_COLLECTED.iter().map(|r| r.id).collect();
    assert_eq!(ids.len(), 8);
}

#[test]
fn classify_is_total_over_the_old_names_and_the_not_collected_ones() {
    // TC-34
    for name in [
        "stories/03/agent-events.jsonl",
        "stories/03/conditions.jsonl",
        "server.log",
        "proxy.log",
        "progress.json",
        "egress.jsonl",
        "metrics.json",
        "run.json",
        "run-status.json",
        "interventions.md",
        "stories/03/accept-summary.json",
        "stories/03/gate.json",
        "stories/03/base-commit",
        "workspace/x/y",
        "control/z",
        "current_story",
        "work_dir.txt",
        ".gitignore",
        "archived.json",
        ".a.1.tmp",
        ".a.partial",
    ] {
        assert_ne!(classify(name), Classification::Unclassified, "{name}");
    }
    assert!(matches!(classify("server.log"), Classification::Collected("server.log")));
    // A name that is neither listed is unclassified.
    for name in ["new-thing.json", "stories/01/new-thing.json", "notes.txt"] {
        assert_eq!(classify(name), Classification::Unclassified, "{name}");
    }
}

#[test]
fn the_rules_are_printed_one_line_each_with_the_reason_of_every_exclusion() {
    // TC-32
    let text = list_rules();
    for e in rules() {
        assert!(text.lines().any(|l| l.contains(e.id)), "collected rule {} is not printed", e.id);
    }
    for r in NOT_COLLECTED {
        assert!(text.lines().any(|l| l.contains(r.id) && l.contains(r.reason)), "{} is not printed with its reason", r.id);
    }
    assert!(text.contains("collected rules") && text.contains("not collected"));
    assert_eq!(text.lines().count(), 2 + COLLECTED_RULES + LEGACY_RULES + NOT_COLLECTED.len());
}

#[test]
fn the_node_never_lists_a_name_that_is_left_out() {
    let root = temp_dir("manifest-left-out");
    let run_dir = root.join("run");
    let bench_home = root.join("bench");
    std::fs::create_dir_all(run_dir.join("workspace/src")).unwrap();
    std::fs::create_dir_all(run_dir.join("control")).unwrap();
    std::fs::create_dir_all(run_dir.join("stories/01/artifacts")).unwrap();
    for (path, body) in [
        ("run.json", "{}"),
        ("workspace/src/a.ts", "x"),
        ("control/skip-story.json", "{}"),
        ("current_story", "1"),
        ("work_dir.txt", "/w/x"),
        (".gitignore", "x"),
        (".run-status.json.99.tmp", "x"),
        ("stories/01/artifacts/.y.tmp", "x"),
        ("stories/01/artifacts/kept.png", "x"),
    ] {
        std::fs::write(run_dir.join(path), body).unwrap();
    }
    let got: Vec<String> = manifest(&run_dir, &bench_home).into_iter().map(|f| f.name).collect();
    assert_eq!(got, ["run.json", "stories/01/artifacts/kept.png"]);
    std::fs::remove_dir_all(&root).unwrap();
}

// ---- lake.serve.held_out_allowlist: path safety (the unit part) ----

#[test]
fn a_path_that_leaves_the_run_directory_through_a_link_is_not_inside_it() {
    // TC-52
    let root = temp_dir("inside-run");
    let run_dir = root.join("run");
    let outside = root.join("outside");
    std::fs::create_dir_all(run_dir.join("stories/01")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.txt"), "s").unwrap();
    std::fs::write(run_dir.join("run.json"), "{}").unwrap();
    // A symlinked parent: stories/01/artifacts -> ../../../outside
    std::os::unix::fs::symlink(&outside, run_dir.join("stories/01/artifacts")).unwrap();
    let via_parent = run_dir.join("stories/01/artifacts/secret.txt");
    assert!(via_parent.is_file(), "the link resolves");
    assert!(!is_inside_run(&run_dir, &via_parent));
    assert!(has_link_below(&run_dir, &via_parent));
    // A plain file inside is inside and has no link.
    assert!(is_inside_run(&run_dir, &run_dir.join("run.json")));
    assert!(!has_link_below(&run_dir, &run_dir.join("run.json")));
    // A link to a file in the same run directory is still a link.
    std::os::unix::fs::symlink(run_dir.join("run.json"), run_dir.join("alias.json")).unwrap();
    assert!(has_link_below(&run_dir, &run_dir.join("alias.json")));
    // A path that does not exist is not inside.
    assert!(!is_inside_run(&run_dir, &run_dir.join("nope.json")));
    // A path outside the run directory has a link-free route but is not inside it.
    assert!(!is_inside_run(&run_dir, &outside.join("secret.txt")));
    assert!(has_link_below(&run_dir, &outside.join("secret.txt")), "not below the run directory at all");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn the_destinations_the_rules_compute_are_only_names_below_the_run_directory() {
    // TC-56 (the collect.rs half: every rule resolves below the run directory or to the egress folder; the destinations
    // in the lake are tested in collector.rs).
    for e in rules() {
        assert!(matches!(e.source, Source::RunDir | Source::Egress));
    }
    for name in ["heldout-detail.json", "summary-detail.md", "AUDIT.md", "audit.jsonl", "stories/01/accept.json", "stories/01/accept-report.json", "stories/01/accept-final.json", "stories/01/artifacts/a.png", "rescore/V/rescore.json"] {
        let n = parse_name(name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!(n.source(), Source::RunDir, "{name}");
        let p = resolve(Path::new("/run"), Path::new("/bench"), &n).unwrap();
        assert!(p.starts_with("/run"), "{name}: {}", p.display());
    }
}
