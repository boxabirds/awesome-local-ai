//! What a failed attempt failed on, so the runner can tell the same failure again from a new one.
//!
//! A restart is right when the failure may not happen again (a crash mid-story that resumes, a
//! network blip). It is wasted when nothing can have changed: a broken checkout, a model server that
//! exits at start, a traceback at import. The runner compares each failed attempt's signature (the
//! exit code and the attempt's last meaningful log line, with what varies from run to run taken
//! out) and the number of stories recorded with the previous attempt's; the same signature with no
//! new story ends the job.

use serde::{Deserialize, Serialize};

use crate::progress::StoryProgress;

/// The start of the `Failed` reason when a job stops on a repeated failure.
pub const SAME_FAILURE_REASON: &str = "the same failure twice with no progress";

/// The signature's line when the attempt printed nothing of its own.
pub const NO_OUTPUT: &str = "(no output from the harness)";
/// Longest signature line kept, in characters.
pub const SIGNATURE_MAX_CHARS: usize = 300;
/// How many of the attempt's last harness lines are searched for why it failed. Enough for the
/// output preflight prints after its PREFLIGHT FAILED line (up to 1500 characters); an older line
/// than this is history, not the failure.
pub const SIGNATURE_WINDOW_LINES: usize = 60;

/// Every line dbench writes into a job log starts with this (server.rs `log_line`).
const DBENCH_LINE_PREFIX: &str = "[dbench ";
/// dbench's line for the start of an attempt: `[dbench <time>] attempt <n>: bash …`.
const ATTEMPT_MARK: &str = "] attempt ";
const TRACEBACK_HEADER: &str = "Traceback (most recent call last):";
/// Lines that say outright why the harness stopped (preflight.py, machine_fit.py, drive.py).
const STRONG_MARKS: [&str; 3] = ["PREFLIGHT FAILED", "MACHINE UNFIT", "MISSING RESOURCES"];
/// Words, in lower case, of a line that reports a failure (git, a model server, a script).
const WEAK_MARKS: [&str; 4] = ["failed", "error:", "fatal:", "exited"];

/// Where temporary files live: a path under one of these differs from one attempt to the next.
const TEMP_PREFIXES: [&str; 6] = [
    "/private/var/folders/",
    "/private/tmp/",
    "/var/folders/",
    "/var/tmp/",
    "/dev/shm/",
    "/tmp/",
];
/// What ends a path inside a line.
const PATH_END: [char; 9] = ['\'', '"', '`', ')', ']', '>', ',', ';', ':'];
/// Words a number after which is a process id or a port.
const ID_KEYS: [&str; 4] = ["pid", "pgid", "process", "port"];
/// What may join such a word to its number.
const ID_SEPARATORS: [&str; 4] = [": ", ":", "=", " "];
/// Hosts a `:<number>` after which is a port.
const PORT_HOSTS: [&str; 1] = ["localhost"];
/// Lengths of a Unix time in seconds and in milliseconds.
const EPOCH_DIGITS: [usize; 2] = [10, 13];
/// Duration units, longest first so `ms` isn't read as `m`.
const DURATION_UNITS: [&str; 4] = ["min", "ms", "s", "h"];
const YEAR_DIGITS: usize = 4;
const CLOCK_FIELD_DIGITS: usize = 2;

const TMP: &str = "<tmp>";
const TIME: &str = "<time>";
const DATE: &str = "<date>";
const DURATION: &str = "<dur>";
const ADDRESS: &str = "<addr>";
const ID: &str = "<n>";
const PORT: &str = "<port>";

/// A failed attempt, as the next one is compared with it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FailureMark {
    pub signature: String,
    /// Stories the run had recorded when the attempt ended.
    pub stories: usize,
}

fn is_dbench_line(line: &str) -> bool {
    line.starts_with(DBENCH_LINE_PREFIX)
}

/// The attempt's part of the job log: everything after the last attempt line dbench wrote (all of
/// it when the attempt line is further back than the log given).
pub fn attempt_section(log: &str) -> &str {
    let mut from = 0;
    let mut at = 0;
    for line in log.split_inclusive('\n') {
        at += line.len();
        if is_dbench_line(line) && line.contains(ATTEMPT_MARK) {
            from = at;
        }
    }
    &log[from..]
}

/// The line that best says why the attempt failed, as the harness printed it. Of the attempt's
/// last `SIGNATURE_WINDOW_LINES` harness lines (dbench's own never count): the last that ends a
/// Python traceback or carries a strong mark (PREFLIGHT FAILED, MACHINE UNFIT, MISSING
/// RESOURCES); else the last that reports a failure in other words; else the last line.
pub fn meaningful_line(section: &str) -> Option<String> {
    let lines: Vec<&str> = section
        .lines()
        .filter(|l| !l.trim().is_empty() && !is_dbench_line(l))
        .collect();
    let first_in_window = lines.len().saturating_sub(SIGNATURE_WINDOW_LINES);
    let mut strong = None;
    let mut weak = None;
    let mut in_traceback = false;
    for (i, line) in lines.iter().enumerate() {
        let ends_traceback = in_traceback && !line.starts_with(char::is_whitespace);
        if line.contains(TRACEBACK_HEADER) {
            in_traceback = true;
            continue;
        }
        if ends_traceback {
            in_traceback = false;
        }
        if i < first_in_window {
            continue;
        }
        let lower = line.to_lowercase();
        if ends_traceback || STRONG_MARKS.iter().any(|m| line.contains(m)) {
            strong = Some(i);
        } else if WEAK_MARKS.iter().any(|m| lower.contains(m)) {
            weak = Some(i);
        }
    }
    let pick = strong.or(weak).or_else(|| lines.len().checked_sub(1))?;
    Some(lines[pick].trim().to_string())
}

/// Replace each temporary path (from its prefix to the end of the path) with `<tmp>`. A prefix
/// counts only where a path starts, not inside a longer one (`/home/u/tmp/x` is kept).
fn replace_temp_paths(line: &str) -> String {
    let mut prefixes: Vec<String> = TEMP_PREFIXES.iter().map(|p| p.to_string()).collect();
    let own = std::env::temp_dir().display().to_string();
    if own.len() > 1 {
        prefixes.push(format!("{}/", own.trim_end_matches('/')));
    }
    prefixes.sort_by_key(|p| std::cmp::Reverse(p.len()));
    let mut out = line.to_string();
    for prefix in &prefixes {
        let mut from = 0;
        while let Some(found) = out[from..].find(prefix.as_str()) {
            let start = from + found;
            let starts_path = out[..start]
                .chars()
                .next_back()
                .is_none_or(|c| !(c.is_alphanumeric() || "_-./~".contains(c)));
            if !starts_path {
                from = start + prefix.len();
                continue;
            }
            let end = out[start..]
                .find(|c: char| c.is_whitespace() || PATH_END.contains(&c))
                .map_or(out.len(), |e| start + e);
            out.replace_range(start..end, TMP);
            from = start + TMP.len();
        }
    }
    out
}

/// The number of ASCII digits at the start of `s`.
fn digits(s: &str) -> usize {
    s.bytes().take_while(u8::is_ascii_digit).count()
}

/// `s` starts with `sep` and then exactly `n` digits: the length matched.
fn field(s: &str, sep: char, n: usize) -> Option<usize> {
    let rest = s.strip_prefix(sep)?;
    (digits(rest) == n).then_some(sep.len_utf8() + n)
}

/// `.<digits>` at the start of `s`: its length, or 0.
fn fraction(s: &str) -> usize {
    match s.strip_prefix('.') {
        Some(rest) if digits(rest) > 0 => 1 + digits(rest),
        _ => 0,
    }
}

/// `s` (what follows a number) starts with a duration unit that ends the word: its length.
fn duration_unit(s: &str) -> Option<usize> {
    DURATION_UNITS.iter().find_map(|u| {
        let rest = s.strip_prefix(u)?;
        (!rest.starts_with(|c: char| c.is_alphanumeric())).then_some(u.len())
    })
}

/// The text before a number says it is a process id or a port (`pid 42`, `port=8080`, `PID: 7`).
fn after_id_key(before: &str) -> bool {
    let lower = before.to_lowercase();
    ID_KEYS.iter().any(|key| {
        ID_SEPARATORS.iter().any(|sep| {
            let word = format!("{key}{sep}");
            lower.ends_with(&word)
                && lower[..lower.len() - word.len()]
                    .chars()
                    .next_back()
                    .is_none_or(|c| !c.is_alphanumeric())
        })
    })
}

/// The text before a number ends `<host>:`, so the number is a port: an IPv4 address, an IPv6 one
/// in brackets, or localhost.
fn after_host(before: &str) -> bool {
    let Some(host_part) = before.strip_suffix(':') else {
        return false;
    };
    if host_part.ends_with(']') {
        return true;
    }
    let host = host_part
        .rsplit(|c: char| c.is_whitespace() || "/@(\"'=".contains(c))
        .next()
        .unwrap_or("");
    if PORT_HOSTS.iter().any(|h| host.eq_ignore_ascii_case(h)) {
        return true;
    }
    let parts: Vec<&str> = host.split('.').collect();
    const IPV4_PARTS: usize = 4;
    parts.len() == IPV4_PARTS && parts.iter().all(|p| !p.is_empty() && digits(p) == p.len())
}

/// The line with what changes from one attempt to the next replaced by placeholders, whitespace
/// collapsed, and cut to `SIGNATURE_MAX_CHARS`:
/// - temporary paths (under /tmp, /var/folders, /var/tmp, /dev/shm or the temp dir) → `<tmp>`
/// - dates (`2026-10-01`) → `<date>`; clock times (`05:12:03`, `5:12`, with a fraction) and Unix
///   times (10 or 13 digits, with a fraction) → `<time>`
/// - durations (`600.3s`, `250ms`, `5min`, `2h`) → `<dur>`
/// - hex addresses (`0x7f3a…`) → `<addr>`
/// - a number after pid, pgid, process or port → `<n>`; after `<host>:` → `<port>`
///
/// Other numbers are kept: story numbers, exit codes, line numbers and scores tell failures apart.
pub fn normalise(line: &str) -> String {
    let line = replace_temp_paths(line);
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < line.len() {
        let rest = &line[i..];
        let prev = out.chars().next_back();
        let boundary = prev.is_none_or(|c| !(c.is_ascii_digit() || c == '.'));
        let word_start = prev.is_none_or(|c| !c.is_alphanumeric());
        if word_start && rest.starts_with("0x") && digits_hex(&rest[2..]) > 0 {
            out.push_str(ADDRESS);
            i += 2 + digits_hex(&rest[2..]);
            continue;
        }
        let n = digits(rest);
        if n == 0 || !boundary {
            let c = rest.chars().next().unwrap_or(' ');
            out.push(c);
            i += c.len_utf8();
            continue;
        }
        let after = &rest[n..];
        // 2026-10-01
        if n == YEAR_DIGITS {
            if let Some(m) = field(after, '-', CLOCK_FIELD_DIGITS) {
                if let Some(d) = field(&after[m..], '-', CLOCK_FIELD_DIGITS) {
                    out.push_str(DATE);
                    i += n + m + d;
                    continue;
                }
            }
        }
        // 05:12, 05:12:03, 05:12:03.123
        if n <= CLOCK_FIELD_DIGITS {
            if let Some(m) = field(after, ':', CLOCK_FIELD_DIGITS) {
                let mut len = n + m;
                if let Some(s) = field(&rest[len..], ':', CLOCK_FIELD_DIGITS) {
                    len += s;
                }
                len += fraction(&rest[len..]);
                out.push_str(TIME);
                i += len;
                continue;
            }
        }
        let frac = fraction(after);
        if EPOCH_DIGITS.contains(&n) {
            out.push_str(TIME);
            i += n + frac;
            continue;
        }
        if let Some(u) = duration_unit(&rest[n + frac..]) {
            out.push_str(DURATION);
            i += n + frac + u;
            continue;
        }
        if frac == 0 && after_id_key(&out) {
            out.push_str(ID);
            i += n;
            continue;
        }
        if frac == 0 && after_host(&out) {
            out.push_str(PORT);
            i += n;
            continue;
        }
        out.push_str(&rest[..n + frac]);
        i += n + frac;
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(SIGNATURE_MAX_CHARS).collect()
}

fn digits_hex(s: &str) -> usize {
    s.bytes().take_while(u8::is_ascii_hexdigit).count()
}

/// `exit <code>: <meaningful line, normalised>`, from the end of the job log.
pub fn signature(code: i32, log: &str) -> String {
    let line = meaningful_line(attempt_section(log))
        .map(|l| normalise(&l))
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| NO_OUTPUT.to_string());
    format!("exit {code}: {line}")
}

/// Stories the run has finished and recorded: by status where progress.json gives one (DONE or
/// PARTIAL), else those with an acceptance result (metrics.json's finished stories).
pub fn recorded_stories(stories: &[StoryProgress]) -> usize {
    const FINISHED: [&str; 2] = ["DONE", "PARTIAL"];
    stories
        .iter()
        .filter(|s| match &s.status {
            Some(st) => FINISHED.iter().any(|f| st.eq_ignore_ascii_case(f)),
            None => s.passed.is_some(),
        })
        .count()
}

/// True when `now` is `prev` again with no story recorded since.
pub fn is_repeat(prev: Option<&FailureMark>, now: &FailureMark) -> bool {
    prev.is_some_and(|p| p.signature == now.signature && now.stories <= p.stories)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(code: i32, log: &str) -> String {
        signature(code, log)
    }

    /// A real-looking job log: dbench's lines around a first attempt, then the attempt under test.
    fn job_log(last_attempt: &str) -> String {
        format!(
            "[dbench 2026-10-01 05:10:01] git pull --ff-only: ok\n\
             [dbench 2026-10-01 05:10:02] attempt 1: bash vidi/harness/run.sh fake-install --run-id v2-r5\n\
             [story 4] Board — agent starting\n\
             Traceback (most recent call last):\n  File \"drive.py\", line 3, in <module>\n\
             KeyError: 'first attempt'\n\
             [dbench 2026-10-01 05:11:02] harness exited 1; restarting in 30s\n\
             [dbench 2026-10-01 05:11:32] git pull --ff-only: ok\n\
             [dbench 2026-10-01 05:11:33] attempt 2: bash vidi/harness/run.sh fake-install --run-id v2-r5\n\
             {last_attempt}\
             [dbench 2026-10-01 05:12:40] stopping processes the harness left running: llama-server (4242)\n"
        )
    }

    #[test]
    fn a_python_traceback_gives_its_exception_line() {
        let log = job_log(
            "[story 4] Board — agent starting\n\
             [story 4] agent done in 812.4s; running gates\n\
             Traceback (most recent call last):\n\
             \x20 File \"/home/tester/awesome-local-ai/benchmarks/spec-bench/harness/drive.py\", line 1210, in <module>\n\
             \x20   main()\n\
             \x20 File \"/home/tester/awesome-local-ai/benchmarks/spec-bench/harness/drive.py\", line 1180, in main\n\
             \x20   record = finish_story(story, held)\n\
             \x20            ^^^^^^^^^^^^^^^^^^^^^^^^^^\n\
             UnboundLocalError: cannot access local variable 'held' where it is not associated with a value\n",
        );
        assert_eq!(
            sig(1, &log),
            "exit 1: UnboundLocalError: cannot access local variable 'held' where it is not associated with a value"
        );
    }

    #[test]
    fn a_chained_traceback_gives_the_last_exception() {
        let log = job_log(
            "Traceback (most recent call last):\n  File \"a.py\", line 1, in f\n\
             KeyError: 'model'\n\nDuring handling of the above exception, another exception occurred:\n\n\
             Traceback (most recent call last):\n  File \"a.py\", line 4, in <module>\n\
             RuntimeError: no model configured\n",
        );
        assert_eq!(sig(1, &log), "exit 1: RuntimeError: no model configured");
    }

    #[test]
    fn preflight_failed_beats_the_generic_line_after_it() {
        let log = job_log(
            "PREFLIGHT FAILED at npm ci: exit 1\n\
             npm ERR! code ENOTEMPTY\n\
             npm ERR! syscall rename\n\
             preflight failed; not starting the run\n",
        );
        assert_eq!(sig(1, &log), "exit 1: PREFLIGHT FAILED at npm ci: exit 1");
    }

    #[test]
    fn a_failed_git_pull_gives_its_own_line() {
        let log = job_log(
            "error: Pulling is not possible because you have unmerged files.\n\
             hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n\
             fatal: Exiting because of an unresolved conflict.\n\
             git pull --ff-only failed: unmerged files\n",
        );
        assert_eq!(sig(1, &log), "exit 1: git pull --ff-only failed: unmerged files");
    }

    #[test]
    fn a_model_server_that_exits_at_start() {
        let log = job_log(
            "starting llama-server on port 18080\n\
             llama_model_load: error loading model: unable to allocate ROCm0 buffer\n\
             srv    load_model: failed to load model, '/models/qwen.gguf'\n\
             main: exiting due to model loading error\n\
             server exited; see /home/tester/awesome-local-ai/combinations/x/benchmarks/vidi/v2-r1/server.log\n",
        );
        assert_eq!(
            sig(1, &log),
            "exit 1: server exited; see /home/tester/awesome-local-ai/combinations/x/benchmarks/vidi/v2-r1/server.log"
        );
    }

    #[test]
    fn machine_unfit_and_missing_resources_lines() {
        let log = job_log("MACHINE UNFIT: story 9 was stopped (swap guard). Waiting for it to recover.\n");
        assert_eq!(
            sig(75, &log),
            "exit 75: MACHINE UNFIT: story 9 was stopped (swap guard). Waiting for it to recover."
        );
        let log = job_log("MISSING RESOURCES: no browser. Story 3 scores are void.\nexit 3: noise\n");
        assert_eq!(sig(3, &log), "exit 3: MISSING RESOURCES: no browser. Story 3 scores are void.");
    }

    #[test]
    fn with_no_marker_the_last_harness_line_counts_and_dbench_lines_never_do() {
        let log = job_log("[story 2] Two — agent starting\nKilled\n");
        assert_eq!(sig(137, &log), "exit 137: Killed");
        // Nothing from the harness in this attempt: not the first attempt's traceback either.
        assert_eq!(sig(1, &job_log("")), format!("exit 1: {NO_OUTPUT}"));
    }

    #[test]
    fn only_the_last_attempt_counts() {
        let log = job_log("PREFLIGHT FAILED (claude): token missing\n");
        assert!(!sig(1, &log).contains("first attempt"), "{}", sig(1, &log));
        // A tail that starts after the attempt line: all of it is the attempt.
        assert_eq!(sig(1, "KeyError: 'x'\nfatal: bad object\n"), "exit 1: fatal: bad object");
    }

    #[test]
    fn a_long_attempt_looks_only_at_its_end() {
        let mut body = String::from("Traceback (most recent call last):\n  File \"x.py\", line 1\nOldError: long ago\n");
        for i in 0..200 {
            body.push_str(&format!("[story 5] working {i}\n"));
        }
        body.push_str("[story 5] still working\n");
        assert_eq!(sig(1, &job_log(&body)), "exit 1: [story 5] still working");
    }

    #[test]
    fn volatile_parts_are_normalised() {
        let same = |a: &str, b: &str| {
            assert_eq!(normalise(a), normalise(b), "{a:?} vs {b:?}");
            assert_ne!(normalise(a), a, "{a:?} kept something volatile");
        };
        same("[2026-10-01T05:12:03Z] boom", "[2026-09-30T23:01:59Z] boom");
        same("[2026-10-01 05:12:03.123] boom", "[2026-10-02 06:00:00.9] boom");
        same("at 05:12:03 it died", "at 17:01:44 it died");
        same("updated_at 1790302781.2 stale", "updated_at 1790309999.75 stale");
        same("server pid 4242 died", "server pid 99 died");
        same("PID=4242 gone", "PID=7 gone");
        same("pgid: 311 left", "pgid: 9001 left");
        same("could not connect to 127.0.0.1:18080", "could not connect to 127.0.0.1:18081");
        same("GET http://localhost:8787/api failed", "GET http://localhost:9000/api failed");
        same("bind on [::1]:5173 refused", "bind on [::1]:5174 refused");
        same("port 18080 in use", "port 18123 in use");
        same("see /tmp/tmpab3k_9x/server.log", "see /tmp/tmpzz81/server.log");
        same("'/private/var/folders/x1/abc/T/probe-1/out.txt' missing", "'/private/var/folders/q9/zzz/T/probe-2/out.txt' missing");
        same("<Popen object at 0x7f3a2c1b9d30>", "<Popen object at 0x10a4f2e80>");
        same("timed out after 600.3s", "timed out after 601.9s");
        same("took 250ms", "took 1200ms");
        // What the placeholders look like, on a line from the end-to-end test's fake harness.
        assert_eq!(
            normalise("ConnectionError: server pid 56122 on 127.0.0.1:18001 stopped at 12:52:42.1 after 1.1s, see /tmp/run-56122-1/server.log"),
            "ConnectionError: server pid <n> on 127.0.0.1:<port> stopped at <time> after <dur>, see <tmp>"
        );
        assert_eq!(
            normalise("[2026-10-01T05:12:03Z] File \"/private/tmp/x/drive.py\", line 9 at 0x7f3a"),
            "[<date>T<time>Z] File \"<tmp>\", line 9 at <addr>"
        );
        // A temp prefix inside a longer path is not a temp path.
        assert_eq!(normalise("see /home/u/tmp/x.log"), "see /home/u/tmp/x.log");
    }

    #[test]
    fn what_tells_failures_apart_is_kept() {
        let differ = |a: &str, b: &str| assert_ne!(normalise(a), normalise(b), "{a:?} vs {b:?}");
        differ("[story 3] crashed", "[story 4] crashed");
        differ("exit 1", "exit 2");
        differ("accept 3/4", "accept 4/4");
        differ("File \"drive.py\", line 52", "File \"drive.py\", line 53");
        differ("KeyError: 'a'", "KeyError: 'b'");
        differ("see /home/tester/a.log", "see /home/tester/b.log");
        differ("qwen 3.8 flash", "qwen 3.9 flash");
        // Kept as written.
        assert_eq!(normalise("  RuntimeError:   fake  crash \t"), "RuntimeError: fake crash");
        assert_eq!(normalise("v2-r5 story 12: 65/75"), "v2-r5 story 12: 65/75");
    }

    #[test]
    fn a_very_long_line_is_cut() {
        let long = format!("RuntimeError: {}", "é".repeat(SIGNATURE_MAX_CHARS * 2));
        assert_eq!(normalise(&long).chars().count(), SIGNATURE_MAX_CHARS);
    }

    fn story(id: &str, status: Option<&str>, passed: Option<u64>) -> StoryProgress {
        StoryProgress {
            id: id.into(),
            status: status.map(String::from),
            passed,
            ..Default::default()
        }
    }

    #[test]
    fn recorded_stories_count_finished_ones() {
        // From progress.json: by status.
        let p = [
            story("1", Some("DONE"), Some(4)),
            story("2", Some("PARTIAL"), Some(1)),
            story("3", Some("running"), None),
            story("4", Some("pending"), None),
        ];
        assert_eq!(recorded_stories(&p), 2);
        // From metrics.json (no status): each has an acceptance result.
        assert_eq!(recorded_stories(&[story("1", None, Some(3)), story("2", None, Some(0))]), 2);
        assert_eq!(recorded_stories(&[story("2", None, None)]), 0);
        assert_eq!(recorded_stories(&[]), 0);
    }

    #[test]
    fn a_repeat_is_the_same_signature_with_no_new_story() {
        let mark = |s: &str, n| FailureMark { signature: s.into(), stories: n };
        assert!(!is_repeat(None, &mark("exit 1: x", 0)));
        assert!(is_repeat(Some(&mark("exit 1: x", 3)), &mark("exit 1: x", 3)));
        assert!(!is_repeat(Some(&mark("exit 1: x", 3)), &mark("exit 1: x", 4)));
        assert!(!is_repeat(Some(&mark("exit 1: x", 3)), &mark("exit 1: y", 3)));
        assert!(!is_repeat(Some(&mark("exit 1: x", 3)), &mark("exit 2: x", 3)));
        // Fewer stories than before (a record moved away) is not progress.
        assert!(is_repeat(Some(&mark("exit 1: x", 3)), &mark("exit 1: x", 2)));
    }
}
