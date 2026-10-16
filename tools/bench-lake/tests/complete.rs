//! lakelib.state.complete: TC-59 to TC-68 (TC-65 to TC-67 also in unit.rs on the pure decision).

mod common;
use bench_lake::{Completeness, Item, Reason};
use common::*;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};

const NOTE: &str = "collection.json";

fn parts(c: Completeness) -> (&'static str, Option<String>, Option<u64>, Option<u64>) {
    let name = c.as_str();
    match c {
        Completeness::Complete { state, settled_at, collected_at } | Completeness::Incomplete { state, settled_at, collected_at } => {
            (name, state, settled_at.and_then(|n| n.as_u64()), collected_at.and_then(|n| n.as_u64()))
        }
        Completeness::NoNote => (name, None, None, None),
    }
}

#[test]
fn tc59_combination_complete() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(
        parts(lake.completeness(&run).unwrap()),
        ("complete", Some("finished".to_string()), Some(1792116937), Some(1792160967))
    );
}

#[test]
fn tc60_combination_incomplete() {
    let lake = fixture_lake();
    let run = find(&lake, ID_DRY, Some("gruntus"));
    assert_eq!(parts(lake.completeness(&run).unwrap()), ("incomplete", None, None, Some(1792161516)));
}

#[test]
fn tc61_combination_no_note() {
    let (_s, state, lake) = scratch_lake("nonote");
    fs::remove_file(state.join("collected/gruntus").join(ID_FRESH).join(NOTE)).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.completeness(&run).unwrap(), Completeness::NoNote);
}

#[test]
fn tc62_reference_complete() {
    let lake = fixture_lake();
    let run = find(&lake, ID_REFV, None);
    let (name, state, settled, collected) = parts(lake.completeness(&run).unwrap());
    assert_eq!((name, state.as_deref(), settled, collected), ("complete", Some("finished"), Some(1792040989), Some(1792158296)));
}

#[test]
fn tc63_reference_incomplete() {
    let (_s, state, lake) = scratch_lake("refincomplete");
    let p = state.join("reference/vidi/sonnet-5.5/v2-r1").join(NOTE);
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    v["complete"] = serde_json::json!(false);
    fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
    let run = find(&lake, ID_REFV, None);
    assert_eq!(parts(lake.completeness(&run).unwrap()).0, "incomplete");
}

#[test]
fn tc64_reference_no_note() {
    let lake = fixture_lake();
    let run = find(&lake, ID_TODOODLE, None);
    assert_eq!(lake.completeness(&run).unwrap(), Completeness::NoNote);
}

#[test]
fn tc66_note_not_json() {
    let (_s, state, lake) = scratch_lake("notjson");
    let p = state.join("collected/gruntus").join(ID_FRESH).join(NOTE);
    fs::write(&p, b"this is text").unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.completeness(&run).unwrap_err();
    assert_eq!(e.reason, Reason::Malformed("not valid JSON".to_string()));
    assert_eq!(e.item, Item::Record("collection".to_string()));
}

#[test]
fn tc67_no_boolean_complete() {
    let (_s, state, lake) = scratch_lake("nobool");
    let p = state.join("collected/gruntus").join(ID_FRESH).join(NOTE);
    fs::write(&p, br#"{"complete":"yes"}"#).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.completeness(&run).unwrap_err().reason, Reason::Malformed("complete is not a boolean".to_string()));
    fs::write(&p, b"[true]").unwrap();
    assert_eq!(lake.completeness(&run).unwrap_err().reason, Reason::Malformed("note is not an object".to_string()));
}

#[test]
fn the_note_as_a_link_or_unreadable() {
    let (s, state, lake) = scratch_lake("notelink");
    let p = state.join("collected/gruntus").join(ID_FRESH).join(NOTE);
    let moved = s.join("moved.json");
    fs::rename(&p, &moved).unwrap();
    symlink(&moved, &p).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.completeness(&run).unwrap_err().reason, Reason::NotAFile);
    fs::remove_file(&p).unwrap();
    fs::create_dir(&p).unwrap();
    assert_eq!(lake.completeness(&run).unwrap_err().reason, Reason::NotAFile);
    if is_root() {
        not_run("note unreadable", "running as root");
        return;
    }
    fs::remove_dir(&p).unwrap();
    fs::write(&p, br#"{"complete":true}"#).unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o000)).unwrap();
    assert_eq!(
        lake.completeness(&run).unwrap_err().reason,
        Reason::Unreadable("permission denied".to_string())
    );
}

#[test]
fn tc68_only_the_note_is_read() {
    if is_root() {
        not_run("TC-68", "running as root");
        return;
    }
    let (_s, state, lake) = scratch_lake("onlynote");
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let want = lake.completeness(&run).unwrap();
    let dir = state.join("collected/gruntus").join(ID_FRESH);
    for e in fs::read_dir(&dir).unwrap().flatten() {
        if e.file_name() != NOTE {
            if e.path().is_dir() {
                fs::remove_dir_all(e.path()).unwrap();
            } else {
                fs::set_permissions(e.path(), fs::Permissions::from_mode(0o000)).unwrap();
            }
        }
    }
    // the folder can be entered but not listed
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o311)).unwrap();
    let got = lake.completeness(&run);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(got.unwrap(), want);
}
