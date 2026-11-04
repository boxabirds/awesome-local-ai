//! The command: argument parsing and the canonical answer (lakelib.impl.rust). CANONICAL.md is the contract.

use crate::absent::{Absent, Error};
use crate::annotations::{self, AnnotateError, Kind, Op, Request, State, Store};
use crate::compare::{compare_git, DEFAULT_REV};
use crate::layout::{Discovery, Lake};
use crate::records::{parse_story_arg, Record};
use crate::{canonical, sha256_hex};
use serde_json::{json, Value};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const EXIT_OK: i32 = 0;
pub const EXIT_QUESTION: i32 = 2;
pub const EXIT_NOT_RUN: i32 = 3;
pub const EXIT_DEFECT: i32 = 1;
/// The annotation store could not be read or written: nothing was answered.
pub const EXIT_STORE: i32 = 1;
const PROGRAM: &str = "bench-lake";
const FLAG_ROOTS: &str = "--roots";
const FLAG_REV: &str = "--rev";
const FLAG_REPORT: &str = "--report";
const FLAG_ARCHIVED: &str = "--archived";
const FLAG_STORY: &str = "--story";
const FLAG_REASON: &str = "--reason";
const FLAG_BY: &str = "--by";
const FLAG_HISTORY: &str = "--history";

/// Where `compare-git --report` puts its report. The library proper writes nothing; the program supplies the writer.
pub type ReportSink<'a> = &'a mut dyn FnMut(&Path, &str) -> io::Result<()>;

/// A malformed question: the message for standard error.
struct Question(String);

fn bad<T>(message: impl Into<String>) -> Result<T, Question> {
    Err(Question(message.into()))
}

/// Runs the command; returns the exit code. `args` excludes the program name.
pub fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write, report: ReportSink) -> i32 {
    match answer(args, report) {
        Ok(Answer::Print(value, code)) => {
            let _ = writeln!(out, "{}", canonical(&value));
            code
        }
        Ok(Answer::NotRun(reason)) => {
            let _ = writeln!(err, "{PROGRAM}: not run: {reason}");
            EXIT_NOT_RUN
        }
        Ok(Answer::StoreFailed(message)) => {
            let _ = writeln!(err, "{PROGRAM}: {message}");
            EXIT_STORE
        }
        Err(Question(message)) => {
            let _ = writeln!(err, "{PROGRAM}: {message}");
            EXIT_QUESTION
        }
    }
}

enum Answer {
    Print(Value, i32),
    NotRun(String),
    StoreFailed(String),
}

fn found(mut value: Value) -> Answer {
    value["status"] = json!("found");
    Answer::Print(value, EXIT_OK)
}

fn absent(a: &Absent) -> Answer {
    Answer::Print(json!({"absent": a.to_value(), "status": "absent"}), EXIT_OK)
}

fn error_answer(e: Error) -> Answer {
    match e {
        Error::Absent(a) => absent(&a),
        Error::Refused(r) => Answer::Print(json!({"refused": r.to_value(), "status": "refused"}), EXIT_QUESTION),
    }
}

/// The lake, its annotation store (only in the state-folder form: `--roots` names no store), and the question.
fn parse_roots(args: &[String]) -> Result<(Lake, Option<Store>, &[String]), Question> {
    match args.first().map(String::as_str) {
        None => bad("usage: bench-lake <STATE_DIR> <question...> | --roots <COLLECTED> <REFERENCE> <question...>"),
        Some(FLAG_ROOTS) => {
            if args.len() < 3 {
                return bad("--roots takes the collected folder and the reference folder");
            }
            Ok((Lake::new(Path::new(&args[1]), Path::new(&args[2])), None, &args[3..]))
        }
        Some(state) => Ok((Lake::in_state_dir(Path::new(state)), Some(Store::in_state_dir(Path::new(state))), &args[1..])),
    }
}

/// The decisions in force: none without a store; an unreadable store is a failure, never an empty one.
fn decisions(store: &Option<Store>) -> Result<State, Answer> {
    match store {
        None => Ok(State::default()),
        Some(s) => s.state().map_err(|e| Answer::StoreFailed(e.to_string())),
    }
}

fn need_store<'a>(store: &'a Option<Store>, question: &str) -> Result<&'a Store, Question> {
    store.as_ref().ok_or_else(|| Question(format!("{question} needs the state folder: --roots names no annotation store")))
}

fn annotate_command(store: &Store, words: &[String]) -> Result<Answer, Question> {
    const USAGE: &str = "annotate set|clear <kind> <run> [--story N] --reason TEXT [--by NAME]";
    let [op, kind, run, flags @ ..] = words else { return bad(format!("usage: {USAGE}")) };
    let op = Op::parse(op).ok_or_else(|| Question(format!("annotate takes set or clear, not {op:?} ({USAGE})")))?;
    let kind = Kind::parse(kind).ok_or_else(|| {
        let known: Vec<&str> = Kind::ALL.iter().map(Kind::as_str).collect();
        Question(format!("unknown kind {kind:?}: one of {}", known.join(", ")))
    })?;
    let (mut story, mut reason, mut by) = (None, None, None);
    let mut it = flags.iter();
    while let Some(flag) = it.next() {
        let mut value = || it.next().ok_or_else(|| Question(format!("{flag} takes a value")));
        match flag.as_str() {
            FLAG_STORY => {
                let text = value()?;
                story = Some(parse_story_arg(text).map_err(|e| Question(format!("--story: {e}")))?);
            }
            FLAG_REASON => reason = Some(value()?.clone()),
            FLAG_BY => by = Some(value()?.clone()),
            other => return bad(format!("annotate does not take {other} ({USAGE})")),
        }
    }
    let Some(reason) = reason else { return bad("annotate needs --reason: a decision needs a reason") };
    let req = Request { op, kind, run: run.clone(), story, reason, by: by.unwrap_or_else(annotations::default_by) };
    match store.append(&req, &annotations::utc_now()) {
        Ok(event) => Ok(found(json!({"event": event.to_value()}))),
        Err(AnnotateError::Refused(why)) => bad(why),
        Err(AnnotateError::Store(e)) => Ok(Answer::StoreFailed(e.to_string())),
    }
}

fn expect(words: &[String], name: &str, min: usize, max: usize) -> Result<(), Question> {
    let n = words.len() - 1;
    if n < min || n > max {
        return bad(format!("{name} takes {} argument(s), got {n}", if min == max { min.to_string() } else { format!("{min} to {max}") }));
    }
    Ok(())
}

fn answer(args: &[String], report: ReportSink) -> Result<Answer, Question> {
    let (lake, store, words) = parse_roots(args)?;
    let Some(question) = words.first() else { return bad("no question") };
    match question.as_str() {
        "runs" => {
            expect(words, "runs", 0, 0)?;
            let state = match decisions(&store) {
                Ok(s) => s,
                Err(failed) => return Ok(failed),
            };
            Ok(found(runs_value(&lake.discover(), &state)))
        }
        "annotate" => annotate_command(need_store(&store, "annotate")?, &words[1..]),
        "annotations" => {
            let history = match &words[1..] {
                [] => false,
                [flag] if flag == FLAG_HISTORY => true,
                _ => return bad("annotations takes nothing, or --history"),
            };
            let store = need_store(&store, "annotations")?;
            Ok(match store.events() {
                Err(e) => Answer::StoreFailed(e.to_string()),
                Ok(events) if history => found(json!({"events": events.iter().map(|e| e.to_value()).collect::<Vec<_>>()})),
                Ok(events) => found(annotations::fold(&events).to_value()),
            })
        }
        "copies" => {
            expect(words, "copies", 1, 1)?;
            let d = lake.discover();
            let copies: Vec<Value> = lake.copies(&d, &words[1]).iter().map(|r| r.to_value()).collect();
            Ok(found(json!({"copies": copies})))
        }
        "preferred" => {
            expect(words, "preferred", 1, 1)?;
            let d = lake.discover();
            Ok(match lake.preferred_or_absent(&d, &words[1]) {
                Ok(run) => found(json!({"preferred": run.to_value()})),
                Err(a) => absent(&a),
            })
        }
        "record" => {
            if words.len() < 3 {
                return bad("record takes a run, a record name and its arguments");
            }
            let record = Record::from_words(&words[2], &words[3..]).map_err(Question)?;
            let d = lake.discover();
            let run = match lake.find_run(&d, &words[1]) {
                Ok(r) => r,
                Err(a) => return Ok(absent(&a)),
            };
            let bytes = match lake.bytes(run, &record) {
                Ok(b) => b,
                Err(a) => return Ok(absent(&a)),
            };
            let value = match lake.value(run, &record) {
                Ok(v) => v,
                Err(a) => return Ok(absent(&a)),
            };
            Ok(found(json!({"length": bytes.len(), "node": run.node, "run": run.id, "sha256": sha256_hex(&bytes), "value": value})))
        }
        "log" => {
            expect(words, "log", 2, 2)?;
            let story = parse_story_arg(&words[2]).map_err(Question)?;
            let d = lake.discover();
            let run = match lake.find_run(&d, &words[1]) {
                Ok(r) => r,
                Err(a) => return Ok(absent(&a)),
            };
            let log = match lake.log(run, story) {
                Ok(l) => l,
                Err(a) => return Ok(absent(&a)),
            };
            Ok(match log.digest() {
                Ok(dg) => found(json!({
                    "form": log.form().as_str(), "length": dg.length, "lines": dg.lines,
                    "node": run.node, "run": run.id, "sha256": dg.sha256, "story": story
                })),
                Err(a) => absent(&a),
            })
        }
        "workspace" => {
            expect(words, "workspace", 3, 3)?;
            let story = parse_story_arg(&words[2]).map_err(Question)?;
            let d = lake.discover();
            let run = match lake.find_run(&d, &words[1]) {
                Ok(r) => r,
                Err(a) => return Ok(absent(&a)),
            };
            let dest = PathBuf::from(&words[3]);
            Ok(match lake.workspace(run, story, &dest) {
                Ok(ws) => found(json!({"commit": ws.commit, "node": run.node, "path": words[3], "run": run.id, "story": story})),
                Err(e) => error_answer(e),
            })
        }
        "complete" => {
            expect(words, "complete", 1, 1)?;
            let d = lake.discover();
            let run = match lake.find_run(&d, &words[1]) {
                Ok(r) => r,
                Err(a) => return Ok(absent(&a)),
            };
            Ok(match lake.completeness(run) {
                Ok(c) => {
                    let (state, settled, collected) = match &c {
                        crate::Completeness::Complete { state, settled_at, collected_at }
                        | crate::Completeness::Incomplete { state, settled_at, collected_at } => {
                            (json!(state), json!(settled_at), json!(collected_at))
                        }
                        crate::Completeness::NoNote => (Value::Null, Value::Null, Value::Null),
                    };
                    found(json!({
                        "collected_at": collected, "completeness": c.as_str(), "node": run.node,
                        "run": run.id, "settled_at": settled, "state": state
                    }))
                }
                Err(a) => absent(&a),
            })
        }
        "records" => {
            let archived = match &words[1..] {
                [] => None,
                [flag, checkout] if flag == FLAG_ARCHIVED => Some(Path::new(checkout)),
                _ => return bad("records takes nothing, or --archived and the host checkout"),
            };
            let state = match decisions(&store) {
                Ok(s) => s,
                Err(failed) => return Ok(failed),
            };
            let d = lake.discover();
            let mut value = runs_value(&d, &state);
            value["runs"] = lake.results(&d, archived, &state).iter().map(|r| r.to_value()).collect();
            Ok(found(value))
        }
        "compare-git" => compare_command(&lake, &words[1..], report),
        other => bad(format!("unknown question {other}")),
    }
}

/// Every copy of every run, each with the decisions in force about its run id.
fn runs_value(d: &Discovery, state: &State) -> Value {
    let runs: Vec<Value> = d
        .runs
        .iter()
        .map(|r| {
            let mut v = r.to_value();
            v["annotations"] = state.of(&r.id).to_value();
            v
        })
        .collect();
    json!({
        "missing_roots": d.missing_roots,
        "rejected": d.rejected.iter().map(|r| json!({"code": r.code, "path": r.label})).collect::<Vec<_>>(),
        "runs": runs,
    })
}

fn compare_command(lake: &Lake, words: &[String], report: ReportSink) -> Result<Answer, Question> {
    let mut repo: Option<&String> = None;
    let mut rev = DEFAULT_REV.to_string();
    let mut report_path: Option<&String> = None;
    let mut it = words.iter();
    while let Some(w) = it.next() {
        match w.as_str() {
            FLAG_REV => rev = it.next().ok_or_else(|| Question("--rev takes a revision".to_string()))?.clone(),
            FLAG_REPORT => report_path = Some(it.next().ok_or_else(|| Question("--report takes a path".to_string()))?),
            _ if repo.is_none() => repo = Some(w),
            _ => return bad("compare-git takes one repository"),
        }
    }
    let Some(repo) = repo else { return bad("compare-git takes the repository to compare with") };
    match compare_git(lake, Path::new(repo), &rev) {
        Err(reason) => Ok(Answer::NotRun(reason)),
        Ok(r) => {
            if let Some(path) = report_path {
                if let Err(e) = report(Path::new(path), &format!("{}\n", canonical(&r.value))) {
                    return Ok(Answer::NotRun(format!("the report could not be written: {e}")));
                }
            }
            Ok(Answer::Print(r.value, if r.defects > 0 { EXIT_DEFECT } else { EXIT_OK }))
        }
    }
}
