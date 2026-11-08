//! Unit tests of the point store (collector.rs, story 24 collect.point_store): TC-13 to TC-18.

use super::*;
use std::path::PathBuf;

const NODE: &str = "gruntus";

fn state(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-points-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn point(cursor: &str) -> Point {
    Point {
        cursor: cursor.into(),
        node_id: "a1b2".into(),
        at: 1_762_560_000,
    }
}

fn point_file(state: &Path, node: &str) -> PathBuf {
    state.join(POINTS_DIR).join(format!("{node}.json"))
}

#[test]
fn tc13_a_node_with_no_point_file_has_no_point() {
    let s = state("tc13");
    assert_eq!(read_point(&s, NODE), None);
}

#[test]
fn tc14_a_point_file_that_is_not_json_is_no_point() {
    let s = state("tc14");
    std::fs::create_dir_all(s.join(POINTS_DIR)).unwrap();
    std::fs::write(point_file(&s, NODE), "{").unwrap();
    assert_eq!(read_point(&s, NODE), None);
}

#[test]
fn tc15_a_written_point_reads_back_the_same() {
    let s = state("tc15");
    write_point(&s, NODE, &point("a1b2.1000")).unwrap();
    assert_eq!(read_point(&s, NODE), Some(point("a1b2.1000")));
    write_point(&s, NODE, &point("a1b2.2000.combinations/x/run.json")).unwrap();
    assert_eq!(
        read_point(&s, NODE),
        Some(point("a1b2.2000.combinations/x/run.json")),
        "a later write replaces it"
    );
}

#[test]
fn tc16_a_crash_between_the_temporary_write_and_the_rename_leaves_the_old_point() {
    let s = state("tc16");
    write_point(&s, NODE, &point("a1b2.1000")).unwrap();
    // What a write that died before its rename leaves: the temporary beside the point, half written.
    let tmp = s
        .join(POINTS_DIR)
        .join(format!(".{NODE}.json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, r#"{"cursor": "a1b2.20"#).unwrap();
    assert_eq!(read_point(&s, NODE), Some(point("a1b2.1000")));
    write_point(&s, NODE, &point("a1b2.3000")).unwrap();
    assert_eq!(
        read_point(&s, NODE),
        Some(point("a1b2.3000")),
        "the next write is not stopped by the leftover"
    );
}

#[test]
fn tc17_a_node_name_that_leaves_the_points_folder_is_refused_and_nothing_is_written() {
    let s = state("tc17");
    for bad in ["../x", "a/b", "..", ""] {
        assert!(
            write_point(&s, bad, &point("a1b2.1")).is_err(),
            "{bad:?} was accepted"
        );
        assert_eq!(read_point(&s, bad), None);
        assert!(
            remove_point(&s, bad).is_err(),
            "{bad:?} removal was accepted"
        );
    }
    assert!(!s.join("x.json").exists() && !s.join("x").exists());
    let written: Vec<_> = std::fs::read_dir(&s)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name())
        .collect();
    assert!(
        written.iter().all(|n| n == POINTS_DIR),
        "written outside points/: {written:?}"
    );
}

#[test]
fn tc18_a_removed_point_is_gone_and_removing_none_is_fine() {
    let s = state("tc18");
    write_point(&s, NODE, &point("a1b2.1000")).unwrap();
    remove_point(&s, NODE).unwrap();
    assert_eq!(read_point(&s, NODE), None);
    remove_point(&s, NODE).unwrap();
}
