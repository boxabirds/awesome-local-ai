//! A recorded path (one held-out test's Playwright trace) as the review player needs it: the
//! test's steps with their times and results, and each browser page's screencast frames, all on
//! the trace's one monotonic clock. Each page is a person ("Person 1", "Person 2") in the order
//! they first appear. Frames are served from the trace zip's resources/.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

/// The test's own step list (steps, errors); each browser context writes `<n>-trace.trace`.
const TEST_TRACE: &str = "test.trace";
const CONTEXT_TRACE_SUFFIX: &str = "-trace.trace";
const RESOURCES: &str = "resources/";
/// Harness plumbing, not something the test does to the app: hidden unless it fails.
const NOISE_PREFIXES: [&str; 7] = ["Create context", "Create page", "Close context", "Query count", "Wait for load state", "Bounding box", "Screenshot"];
const WAIT_PREFIX: &str = "Wait for timeout";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Step {
    pub title: String,
    /// "check" (an expect), "action" (the test driving the page), "wait" (a timed pause) or "step".
    pub kind: String,
    /// The person (index into `people`) whose page the step acted on, if it acted on one.
    pub person: Option<usize>,
    pub start: f64,
    pub end: f64,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Person {
    pub label: String,
    pub width: u64,
    pub height: u64,
    /// (time, frame name under resources/), in time order.
    pub frames: Vec<(f64, String)>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Walkthrough {
    pub start: f64,
    pub end: f64,
    pub people: Vec<Person>,
    pub steps: Vec<Step>,
    /// The test's error when no single step carries it (e.g. a timeout of the whole test).
    pub error: String,
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn events(text: &str) -> Vec<Value> {
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

/// The walkthrough from a trace's files: `test` is test.trace, `contexts` each context's trace.
pub fn parse(test: &str, contexts: &[String]) -> Walkthrough {
    // Pages, in order of first appearance across the contexts (a context starts when it is created).
    let mut ctx: Vec<Vec<Value>> = contexts.iter().map(|t| events(t)).collect();
    ctx.sort_by(|a, b| {
        let start = |e: &Vec<Value>| e.iter().find_map(|x| (s(x, "type") == "context-options").then(|| f(x, "monotonicTime")).flatten()).unwrap_or(f64::MAX);
        start(a).total_cmp(&start(b))
    });
    let mut people: Vec<Person> = Vec::new();
    let mut page_person: HashMap<String, usize> = HashMap::new();
    let mut step_page: HashMap<String, String> = HashMap::new();
    for e in ctx.iter().flatten() {
        let page = s(e, "pageId");
        if page.is_empty() {
            continue;
        }
        let i = *page_person.entry(page.to_string()).or_insert_with(|| {
            people.push(Person { label: format!("Person {}", people.len() + 1), width: 0, height: 0, frames: Vec::new() });
            people.len() - 1
        });
        match s(e, "type") {
            "screencast-frame" => {
                let p = &mut people[i];
                p.width = e.get("width").and_then(Value::as_u64).unwrap_or(p.width);
                p.height = e.get("height").and_then(Value::as_u64).unwrap_or(p.height);
                p.frames.push((f(e, "timestamp").unwrap_or(0.0), s(e, "sha1").to_string()));
            }
            "before" if !s(e, "stepId").is_empty() => {
                step_page.insert(s(e, "stepId").to_string(), page.to_string());
            }
            _ => {}
        }
    }
    for p in &mut people {
        p.frames.sort_by(|a, b| a.0.total_cmp(&b.0));
    }

    let test_events = events(test);
    let after: HashMap<&str, &Value> =
        test_events.iter().filter(|e| s(e, "type") == "after").map(|e| (s(e, "callId"), e)).collect();
    let mut steps = Vec::new();
    let mut error = String::new();
    for e in &test_events {
        match s(e, "type") {
            "error" if error.is_empty() => error = strip_ansi(s(e, "message")),
            "before" => {
                let a = after.get(s(e, "callId")).copied();
                let err = a.and_then(|a| a.get("error")).map(|x| strip_ansi(s(x, "message"))).unwrap_or_default();
                let (method, title) = (s(e, "method"), s(e, "title"));
                let top = e.get("parentId").is_none();
                let kind = match method {
                    "expect" => "check",
                    "pw:api" if title.starts_with(WAIT_PREFIX) => "wait",
                    "pw:api" if NOISE_PREFIXES.iter().any(|n| title.starts_with(n)) => "noise",
                    "pw:api" => "action",
                    "test.step" => "step",
                    _ => "noise", // hooks and fixtures
                };
                if (kind == "noise" || !top && kind != "check") && err.is_empty() {
                    continue;
                }
                let start = f(e, "startTime").unwrap_or(0.0);
                steps.push(Step {
                    title: title.to_string(),
                    kind: if kind == "noise" { "step".into() } else { kind.into() },
                    person: step_page.get(s(e, "stepId")).and_then(|p| page_person.get(p)).copied(),
                    start,
                    end: a.and_then(|a| f(a, "endTime")).unwrap_or(start),
                    error: err,
                });
            }
            _ => {}
        }
    }
    if steps.iter().any(|st| !st.error.is_empty() && error.starts_with(st.error.lines().next().unwrap_or("\u{0}"))) {
        error.clear(); // already shown on its step
    }
    let times = steps.iter().flat_map(|st| [st.start, st.end]).chain(people.iter().flat_map(|p| p.frames.iter().map(|x| x.0)));
    let (start, end) = times.fold((f64::MAX, f64::MIN), |(lo, hi), t| (lo.min(t), hi.max(t)));
    let (start, end) = if start > end { (0.0, 0.0) } else { (start, end) };
    Walkthrough { start, end, people, steps, error }
}

/// A trace zip's walkthrough.
pub fn load(zip_path: &Path) -> anyhow::Result<Walkthrough> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(zip_path)?)?;
    let mut test = String::new();
    let mut contexts = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        if name == TEST_TRACE {
            entry.read_to_string(&mut test)?;
        } else if name.ends_with(CONTEXT_TRACE_SUFFIX) && !name.contains('/') {
            let mut t = String::new();
            entry.read_to_string(&mut t)?;
            contexts.push(t);
        }
    }
    Ok(parse(&test, &contexts))
}

/// One frame image from a trace zip, by the name a walkthrough lists.
pub fn frame(zip_path: &Path, name: &str) -> anyhow::Result<Vec<u8>> {
    if name.contains('/') || name.contains("..") {
        anyhow::bail!("not a frame name");
    }
    let mut zip = zip::ZipArchive::new(std::fs::File::open(zip_path)?)?;
    let mut entry = zip.by_name(&format!("{RESOURCES}{name}"))?;
    let mut out = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn l(v: Value) -> String {
        v.to_string() + "\n"
    }

    // Two people: Person 1 creates a board, Person 2 opens the link; one check fails.
    fn fixture() -> (String, Vec<String>) {
        let test = [
            l(serde_json::json!({"type": "before", "callId": "hook@1", "stepId": "hook@1", "startTime": 1.0, "class": "Test", "method": "hook", "title": "Before Hooks"})),
            l(serde_json::json!({"type": "after", "callId": "hook@1", "endTime": 2.0})),
            l(serde_json::json!({"type": "before", "callId": "pw:api@3", "stepId": "pw:api@3", "startTime": 3.0, "class": "Test", "method": "pw:api", "title": "Create page"})),
            l(serde_json::json!({"type": "after", "callId": "pw:api@3", "endTime": 4.0})),
            l(serde_json::json!({"type": "before", "callId": "pw:api@5", "stepId": "pw:api@5", "startTime": 10.0, "class": "Test", "method": "pw:api", "title": "Click getByRole('button', { name: 'Create a board' })"})),
            l(serde_json::json!({"type": "after", "callId": "pw:api@5", "endTime": 20.0})),
            l(serde_json::json!({"type": "before", "callId": "pw:api@9", "stepId": "pw:api@9", "startTime": 20.7, "class": "Test", "method": "pw:api", "title": "Screenshot"})),
            l(serde_json::json!({"type": "after", "callId": "pw:api@9", "endTime": 20.8})),
            l(serde_json::json!({"type": "before", "callId": "pw:api@8", "stepId": "pw:api@8", "startTime": 20.5, "class": "Test", "method": "pw:api", "title": "Bounding box locator('x')"})),
            l(serde_json::json!({"type": "after", "callId": "pw:api@8", "endTime": 20.6})),
            l(serde_json::json!({"type": "before", "callId": "pw:api@6", "stepId": "pw:api@6", "startTime": 21.0, "class": "Test", "method": "pw:api", "title": "Wait for timeout"})),
            l(serde_json::json!({"type": "after", "callId": "pw:api@6", "endTime": 5000.0})),
            l(serde_json::json!({"type": "before", "callId": "expect@7", "stepId": "expect@7", "startTime": 5001.0, "class": "Test", "method": "expect", "title": "Expect \"toBeVisible\""})),
            l(serde_json::json!({"type": "after", "callId": "expect@7", "endTime": 5100.0, "error": {"message": "\u{1b}[2mexpect(\u{1b}[22mlocator).toBeVisible() failed\n\nLocator: x"}})),
            l(serde_json::json!({"type": "error", "message": "\u{1b}[2mexpect(\u{1b}[22mlocator).toBeVisible() failed\n\nLocator: x"})),
        ]
        .concat();
        let ctx1 = [
            l(serde_json::json!({"type": "context-options", "monotonicTime": 2.5})),
            l(serde_json::json!({"type": "before", "callId": "call@1", "stepId": "pw:api@5", "pageId": "page@aaa", "startTime": 10.0})),
            l(serde_json::json!({"type": "screencast-frame", "pageId": "page@aaa", "sha1": "page@aaa-2.jpeg", "width": 1280, "height": 800, "timestamp": 12.0})),
            l(serde_json::json!({"type": "screencast-frame", "pageId": "page@aaa", "sha1": "page@aaa-1.jpeg", "width": 1280, "height": 800, "timestamp": 11.0})),
        ]
        .concat();
        let ctx2 = [
            l(serde_json::json!({"type": "context-options", "monotonicTime": 4990.0})),
            l(serde_json::json!({"type": "before", "callId": "call@9", "stepId": "expect@7", "pageId": "page@bbb", "startTime": 5001.0})),
            l(serde_json::json!({"type": "screencast-frame", "pageId": "page@bbb", "sha1": "page@bbb-1.jpeg", "width": 800, "height": 600, "timestamp": 5050.0})),
        ]
        .concat();
        (test, vec![ctx2, ctx1]) // out of order on purpose: people are numbered by when they appear
    }

    #[test]
    fn steps_keep_what_the_test_does_and_checks_and_drop_the_plumbing() {
        let (test, ctx) = fixture();
        let w = parse(&test, &ctx);
        let titles: Vec<(&str, &str)> = w.steps.iter().map(|s| (s.kind.as_str(), s.title.as_str())).collect();
        assert_eq!(titles, vec![
            ("action", "Click getByRole('button', { name: 'Create a board' })"),
            ("wait", "Wait for timeout"),
            ("check", "Expect \"toBeVisible\""),
        ]);
        assert_eq!(w.steps[2].error, "expect(locator).toBeVisible() failed\n\nLocator: x");
        assert_eq!(w.error, "", "the test's error is already on its failing step");
    }

    #[test]
    fn each_page_is_a_person_in_order_of_appearance_with_its_frames_in_time_order() {
        let (test, ctx) = fixture();
        let w = parse(&test, &ctx);
        assert_eq!(w.people.iter().map(|p| p.label.as_str()).collect::<Vec<_>>(), ["Person 1", "Person 2"]);
        assert_eq!(w.people[0].frames, vec![(11.0, "page@aaa-1.jpeg".to_string()), (12.0, "page@aaa-2.jpeg".to_string())]);
        assert_eq!((w.people[1].width, w.people[1].height), (800, 600));
        assert_eq!(w.steps[0].person, Some(0));
        assert_eq!(w.steps[2].person, Some(1), "the failing check acted on the second person's page");
        assert_eq!((w.start, w.end), (10.0, 5100.0));
    }

    #[test]
    fn a_trace_zip_is_read_and_its_frames_served_by_name_only() {
        let (test, ctx) = fixture();
        let path = std::env::temp_dir().join(format!("vidi-trace-{}.zip", std::process::id()));
        let mut z = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, body) in [("test.trace", test.as_bytes()), ("0-trace.trace", ctx[1].as_bytes()), ("1-trace.trace", ctx[0].as_bytes()), ("resources/page@aaa-1.jpeg", b"JPEG".as_slice())] {
            z.start_file(name, opts).unwrap();
            z.write_all(body).unwrap();
        }
        z.finish().unwrap();
        let w = load(&path).unwrap();
        assert_eq!(w.people.len(), 2);
        assert_eq!(frame(&path, "page@aaa-1.jpeg").unwrap(), b"JPEG");
        assert!(frame(&path, "../test.trace").is_err());
        let _ = std::fs::remove_file(path);
    }
}
