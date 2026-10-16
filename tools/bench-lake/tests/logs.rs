//! lakelib.logs.read: TC-35 to TC-46.

mod common;
use bench_lake::{Absent, Form, Item, Reason};
use common::*;
use flate2::read::GzDecoder;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

const RAW: &str = "agent-events.jsonl";
const COMPACT: &str = "agent-events.compact.jsonl.gz";
const FIXTURE_RAW_LINES: usize = 20;
const MIB: usize = 1024 * 1024;
const BIG_LOG_BYTES: usize = 200 * MIB;
const BIG_LINE_BYTES: usize = 1024;
const RSS_SAMPLE_EVERY_LINES: usize = 20_000;
const RSS_GROWTH_LIMIT_KIB: u64 = 64 * 1024;

fn story_dir(state: &Path, node: &str, id: &str) -> PathBuf {
    state.join("collected").join(node).join(id).join("stories/01")
}

fn gunzip(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    GzDecoder::new(bytes).read_to_end(&mut out).unwrap();
    out
}

fn split_lines(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut lines: Vec<Vec<u8>> = bytes.split(|b| *b == b'\n').map(|l| l.to_vec()).collect();
    if lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines
}

fn collect_lines(log: &bench_lake::Log) -> (Vec<Vec<u8>>, Option<Absent>) {
    let mut ok = Vec::new();
    let mut err = None;
    for item in log.lines() {
        match item {
            Ok(l) => {
                assert!(err.is_none(), "a line after the error");
                ok.push(l)
            }
            Err(e) => {
                assert!(err.is_none(), "two errors");
                err = Some(e)
            }
        }
    }
    (ok, err)
}

#[test]
fn tc36_raw_log_not_compressed() {
    let (_s, state, lake) = scratch_lake("rawplain");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    fs::remove_file(dir.join(COMPACT)).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Raw);
    assert_eq!(log.bytes().unwrap(), fs::read(dir.join(RAW)).unwrap());
    let (lines, err) = collect_lines(&log);
    assert!(err.is_none());
    assert_eq!(lines.len(), FIXTURE_RAW_LINES);
    assert_eq!(lines, split_lines(&fs::read(dir.join(RAW)).unwrap()));
}

#[test]
fn tc38_compact_log_not_compressed() {
    let lake = fixture_lake();
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Compact);
    let direct = gunzip(&fs::read(run.dir.join("stories/01").join(COMPACT)).unwrap());
    assert_eq!(log.bytes().unwrap(), direct);
    let (lines, err) = collect_lines(&log);
    assert!(err.is_none());
    assert_eq!(lines, split_lines(&direct));
    assert!(lines.len() > 1000);
}

#[test]
fn tc40_both_forms_the_raw_is_preferred() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let dir = run.dir.join("stories/01");
    assert!(dir.join(RAW).is_file() && dir.join(COMPACT).is_file());
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Raw);
    assert_eq!(log.bytes().unwrap(), fs::read(dir.join(RAW)).unwrap());
    // the compact form of the same story is longer than the raw cut
    assert_ne!(fs::read(dir.join(RAW)).unwrap(), gunzip(&fs::read(dir.join(COMPACT)).unwrap()));
}

#[test]
fn reference_run_with_only_a_compact_log() {
    let lake = fixture_lake();
    let run = find(&lake, ID_REFV, None);
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Compact);
    assert!(log.bytes().unwrap().len() > 1000);
}

/// A gzip file of `decoded` whose blocks are stored (level 0), so the file system can compress it.
fn stored_gzip(decoded: &[u8]) -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::none());
    e.write_all(decoded).unwrap();
    e.finish().unwrap()
}

#[test]
fn tc35_raw_log_compressed_on_disk() {
    let (s, state, lake) = scratch_lake("rawfs");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    let plain = fs::read(dir.join(RAW)).unwrap();
    fs::remove_file(dir.join(COMPACT)).unwrap();
    let source = s.join("raw-source.jsonl");
    fs::write(&source, &plain).unwrap();
    fs::remove_file(dir.join(RAW)).unwrap();
    if !fs_compressed_copy(&source, &dir.join(RAW)) {
        not_run("TC-35", "this file system did not mark the copy as compressed");
        return;
    }
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Raw);
    assert_eq!(log.bytes().unwrap(), plain);
}

#[test]
fn tc37_and_tc39_compact_log_compressed_on_disk() {
    let (s, state, lake) = scratch_lake("compactfs");
    let dir = story_dir(&state, "gruntus", ID_Q36);
    let decoded = gunzip(&fs::read(dir.join(COMPACT)).unwrap());
    // A gzip file made of stored blocks, which the file system can compress (a normal gzip file does not shrink).
    let source = s.join("stored.gz");
    fs::write(&source, stored_gzip(&decoded)).unwrap();
    fs::remove_file(dir.join(COMPACT)).unwrap();
    if !fs_compressed_copy(&source, &dir.join(COMPACT)) {
        not_run("TC-37, TC-39", "this file system did not mark the copy as compressed");
        return;
    }
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Compact);
    assert_eq!(log.bytes().unwrap(), decoded);
    // both present, compressed: raw preferred
    let raw = b"{\"a\":1}\n";
    let raw_source = s.join("raw2.jsonl");
    fs::write(&raw_source, raw.repeat(4096)).unwrap();
    if fs_compressed_copy(&raw_source, &dir.join(RAW)) {
        let log = lake.log(&run, 1).unwrap();
        assert_eq!(log.form(), Form::Raw);
        assert_eq!(log.bytes().unwrap(), raw.repeat(4096));
    } else {
        not_run("TC-39", "the raw copy was not compressed");
    }
}

#[test]
fn tc41_neither_form() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.log(&run, 2).unwrap_err();
    assert_eq!(e.reason, Reason::NotCollected);
    assert_eq!(e.item, Item::Log(2));
    assert_eq!(e.node.as_deref(), Some("gruntus"));
    assert_eq!(e.to_json(), format!("{{\"code\":\"E-LAKE-NOT-COLLECTED\",\"detail\":\"no such file\",\"item\":\"log:2\",\"node\":\"gruntus\",\"run\":\"{ID_FRESH}\"}}"));
}

#[test]
fn log_story_out_of_range() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    for s in [1000, -1] {
        let e = lake.log(&run, s).unwrap_err();
        assert_eq!(e.reason, Reason::BadName("story out of range".to_string()));
        assert_eq!(e.item, Item::Log(s));
    }
}

#[test]
fn tc42_zero_byte_raw_log() {
    let (_s, state, lake) = scratch_lake("zero");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    fs::write(dir.join(RAW), b"").unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Raw);
    assert!(log.bytes().unwrap().is_empty());
    assert_eq!(log.lines().count(), 0);
    let d = log.digest().unwrap();
    assert_eq!((d.length, d.lines), (0, 0));
    assert_eq!(d.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

#[test]
fn tc43_one_line_without_a_final_newline_and_other_shapes() {
    let (_s, state, lake) = scratch_lake("oneline");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let cases: [(&[u8], &[&[u8]]); 6] = [
        (b"abc", &[b"abc"]),
        (b"abc\n", &[b"abc"]),
        (b"a\n\nb", &[b"a", b"", b"b"]),
        (b"a\n\n", &[b"a", b""]),
        (b"a\r\nb\r\n", &[b"a\r", b"b\r"]),
        (b"\n", &[b""]),
    ];
    for (bytes, want) in cases {
        fs::write(dir.join(RAW), bytes).unwrap();
        let log = lake.log(&run, 1).unwrap();
        let (lines, err) = collect_lines(&log);
        assert!(err.is_none());
        let want: Vec<Vec<u8>> = want.iter().map(|l| l.to_vec()).collect();
        assert_eq!(lines, want, "{bytes:?}");
        let d = log.digest().unwrap();
        assert_eq!(d.lines as usize, want.len(), "{bytes:?}");
        assert_eq!(d.length as usize, bytes.len());
    }
}

fn rss_kib() -> u64 {
    let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap()
}

#[test]
fn tc44_lines_on_a_large_log_use_memory_of_one_line() {
    let (s, state, lake) = scratch_lake("big");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    let line = format!("{{\"type\":\"x\",\"pad\":\"{}\"}}\n", "p".repeat(BIG_LINE_BYTES - 20));
    let count = BIG_LOG_BYTES / line.len();
    {
        let mut f = std::io::BufWriter::new(fs::File::create(dir.join(RAW)).unwrap());
        for _ in 0..count {
            f.write_all(line.as_bytes()).unwrap();
        }
    }
    let _ = &s;
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    let before = rss_kib();
    let mut peak = before;
    let mut n = 0usize;
    for item in log.lines() {
        let l = item.unwrap();
        assert_eq!(l.len() + 1, line.len());
        n += 1;
        if n.is_multiple_of(RSS_SAMPLE_EVERY_LINES) {
            peak = peak.max(rss_kib());
        }
    }
    assert_eq!(n, count);
    assert!(peak.saturating_sub(before) < RSS_GROWTH_LIMIT_KIB, "resident memory grew by {} KiB reading {} MiB", peak.saturating_sub(before), BIG_LOG_BYTES / MIB);
    let d = log.digest().unwrap();
    assert_eq!(d.lines as usize, count);
    assert!(rss_kib().saturating_sub(before) < RSS_GROWTH_LIMIT_KIB);
}

#[test]
fn tc45_a_damaged_compact_file() {
    let (_s, state, lake) = scratch_lake("damaged");
    let dir = story_dir(&state, "gruntus", ID_Q36);
    let whole = fs::read(dir.join(COMPACT)).unwrap();
    fs::write(dir.join(COMPACT), &whole[..whole.len() / 2]).unwrap();
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Compact);
    let (lines, err) = collect_lines(&log);
    assert!(!lines.is_empty(), "the lines before the damage are delivered");
    let full = split_lines(&gunzip(&whole));
    assert_eq!(&lines[..], &full[..lines.len()], "and they are the right lines");
    let e = err.expect("then an error");
    assert_eq!(e.reason, Reason::Malformed("not valid gzip".to_string()));
    assert_eq!(e.item, Item::Log(1));
    assert_eq!(log.bytes().unwrap_err().code(), "E-LAKE-MALFORMED");
    assert_eq!(log.digest().unwrap_err().code(), "E-LAKE-MALFORMED");
}

#[test]
fn tc45_a_compact_file_that_is_not_gzip() {
    let (_s, state, lake) = scratch_lake("notgzip");
    let dir = story_dir(&state, "gruntus", ID_Q36);
    fs::write(dir.join(COMPACT), b"this is not gzip at all, just text\n").unwrap();
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    let (lines, err) = collect_lines(&log);
    assert!(lines.is_empty());
    assert_eq!(err.unwrap().reason, Reason::Malformed("not valid gzip".to_string()));
}

#[test]
fn tc46_a_link_in_a_logs_place() {
    let (_s, state, lake) = scratch_lake("loglink");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    let raw_bytes = fs::read(dir.join(RAW)).unwrap();
    fs::remove_file(dir.join(COMPACT)).unwrap();
    fs::rename(dir.join(RAW), dir.join("moved.jsonl")).unwrap();
    symlink(dir.join("moved.jsonl"), dir.join(RAW)).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.log(&run, 1).unwrap_err();
    assert_eq!(e.reason, Reason::NotAFile);
    assert_eq!(e.item, Item::Log(1));
    // with a regular compact file beside the link, the compact form is used
    fs::write(dir.join(COMPACT), stored_gzip(&raw_bytes)).unwrap();
    let log = lake.log(&run, 1).unwrap();
    assert_eq!(log.form(), Form::Compact);
    assert_eq!(log.bytes().unwrap(), raw_bytes);
    // a folder in the place of the raw log
    fs::remove_file(dir.join(COMPACT)).unwrap();
    fs::remove_file(dir.join(RAW)).unwrap();
    fs::create_dir(dir.join(RAW)).unwrap();
    assert_eq!(lake.log(&run, 1).unwrap_err().reason, Reason::NotAFile);
}

#[test]
fn an_unreadable_log() {
    if is_root() {
        not_run("log unreadable", "running as root");
        return;
    }
    let (_s, state, lake) = scratch_lake("logperm");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    fs::set_permissions(dir.join(RAW), fs::Permissions::from_mode(0o000)).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.log(&run, 1).unwrap_err();
    assert_eq!(e.reason, Reason::Unreadable("permission denied".to_string()));
}

#[test]
fn a_transfer_in_progress_is_not_a_log() {
    let (_s, state, lake) = scratch_lake("logpartial");
    let dir = story_dir(&state, "gruntus", ID_FRESH);
    fs::remove_file(dir.join(RAW)).unwrap();
    fs::remove_file(dir.join(COMPACT)).unwrap();
    fs::write(dir.join(".agent-events.jsonl.partial"), b"{}\n").unwrap();
    fs::write(dir.join(".agent-events.compact.jsonl.gz.99.tmp"), b"x").unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.log(&run, 1).unwrap_err().reason, Reason::NotCollected);
}

#[test]
fn digest_equals_hash_of_bytes() {
    let lake = fixture_lake();
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let log = lake.log(&run, 1).unwrap();
    let bytes = log.bytes().unwrap();
    let d = log.digest().unwrap();
    assert_eq!(d.length as usize, bytes.len());
    assert_eq!(d.sha256, bench_lake::sha256_hex(&bytes));
    assert_eq!(d.lines as usize, split_lines(&bytes).len());
}
