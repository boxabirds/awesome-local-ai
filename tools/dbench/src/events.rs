//! Typed events parsed from the harness's own log lines (see drive.py's prints).

use serde::{Deserialize, Serialize};

const STORY_PREFIX: &str = "[story ";
const GATE_MARKER: &str = "gate green=";
const MINUTE_S: u64 = 60;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventKind {
    StoryStart {
        title: String,
    },
    StoryContinue {
        session: String,
    },
    AgentError {
        message: String,
    },
    Nudge {
        n: u32,
    },
    AgentDone {
        seconds: Option<f64>,
    },
    Recorded {
        commit: String,
        pushed: Option<bool>,
    },
    Scored {
        green: Option<bool>,
        passed: u32,
        total: u32,
        stalled: Option<bool>,
        degraded: bool,
    },
    HangInterrupt {
        silent_s: Option<u64>,
    },
    Crash {
        exception: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Event {
    /// 1-based line number in the job log.
    pub line: usize,
    /// The story the line belongs to: its own `[story N]` tag, else the last one seen.
    pub story: Option<u32>,
    #[serde(flatten)]
    pub kind: EventKind,
}

fn py_bool(s: &str) -> Option<bool> {
    match s {
        "True" | "true" => Some(true),
        "False" | "false" => Some(false),
        _ => None,
    }
}

fn leading_number<T: std::str::FromStr>(s: &str) -> Option<T> {
    let end = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(s.len());
    s[..end].parse().ok()
}

/// `key=value` token anywhere in the text.
fn kv<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.split_whitespace()
        .find_map(|t| t.strip_prefix(key)?.strip_prefix('='))
}

/// One line on its own. Returns the story number the line names, if any.
pub fn parse_line(line: &str) -> Option<(Option<u32>, EventKind)> {
    let t = line.trim();
    if let Some(rest) = t.strip_prefix(STORY_PREFIX) {
        let (num, rest) = rest.split_once(']')?;
        let story: u32 = num.trim().parse().ok()?;
        let rest = rest.trim_start();
        let kind = if let Some(title) = rest.strip_suffix("— agent starting") {
            EventKind::StoryStart {
                title: title.trim().to_string(),
            }
        } else if let Some(s) = rest.strip_prefix("continuing the agent's own session ") {
            EventKind::StoryContinue {
                session: s.split_whitespace().next()?.to_string(),
            }
        } else if let Some(s) = rest.strip_prefix("agent done in ") {
            EventKind::AgentDone {
                seconds: leading_number(s),
            }
        } else if let Some(s) = rest.strip_prefix("recorded: commit ") {
            EventKind::Recorded {
                commit: s.split_whitespace().next()?.to_string(),
                pushed: kv(s, "pushed").and_then(py_bool),
            }
        } else if let Some(at) = rest.find(GATE_MARKER) {
            // "[story N] DONE gate green=…" — anything before the marker is the story's status.
            let rest = &rest[at..];
            let accept = rest.split_once(" accept ")?.1.split_whitespace().next()?;
            let (p, tot) = accept.split_once('/')?;
            EventKind::Scored {
                green: kv(rest, "green").and_then(py_bool),
                passed: p.parse().ok()?,
                total: tot.parse().ok()?,
                stalled: kv(rest, "stalled").and_then(py_bool),
                degraded: rest.contains("DEGRADED"),
            }
        } else {
            return None;
        };
        return Some((Some(story), kind));
    }
    if let Some(msg) = t.strip_prefix("agent error: ") {
        return Some((
            None,
            EventKind::AgentError {
                message: msg.to_string(),
            },
        ));
    }
    if let Some(rest) = t.strip_prefix("agent stopped without committing — nudge ") {
        return Some((
            None,
            EventKind::Nudge {
                n: leading_number(rest)?,
            },
        ));
    }
    // Interventions-log form: "[<timestamp> ]<story dir>: interrupted a tool call silent for 600s ..."
    if let Some((prefix, rest)) = t.split_once(": interrupted a tool call silent for ") {
        let story = prefix
            .split_whitespace()
            .last()
            .and_then(|s| s.parse().ok());
        return Some((
            story,
            EventKind::HangInterrupt {
                silent_s: leading_number(rest),
            },
        ));
    }
    // Console form: "tool call silent 10 min — interrupted (Ctrl-C equivalent)"
    if let Some(rest) = t.strip_prefix("tool call silent ") {
        if rest.contains("interrupted") {
            let mins: Option<u64> = leading_number(rest);
            return Some((
                None,
                EventKind::HangInterrupt {
                    silent_s: mins.map(|m| m * MINUTE_S),
                },
            ));
        }
    }
    if t.starts_with("Traceback (most recent call last):") {
        return Some((None, EventKind::Crash { exception: None }));
    }
    None
}

/// All events in a log, with story context carried forward and each crash
/// given the exception line that ends its traceback.
pub fn parse_log(text: &str) -> Vec<Event> {
    let mut events: Vec<Event> = Vec::new();
    let mut story: Option<u32> = None;
    let mut open_crash: Option<usize> = None;
    for (i, line) in text.lines().enumerate() {
        if let Some(idx) = open_crash {
            // Frames are indented; the first unindented line is "SomeError: message".
            if !line.starts_with(char::is_whitespace)
                && !line.is_empty()
                && !line.starts_with("Traceback")
            {
                if let EventKind::Crash { exception } = &mut events[idx].kind {
                    *exception = Some(line.trim().to_string());
                }
                open_crash = None;
                continue;
            }
        }
        let Some((own_story, kind)) = parse_line(line) else {
            continue;
        };
        // `[story N]` lines set the context; a hang line names its story but doesn't change it.
        if let Some(s) = own_story {
            if !matches!(kind, EventKind::HangInterrupt { .. }) {
                story = Some(s);
            }
        }
        let is_crash = matches!(kind, EventKind::Crash { .. });
        events.push(Event {
            line: i + 1,
            story: own_story.or(story),
            kind,
        });
        if is_crash {
            open_crash = Some(events.len() - 1);
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
[story 5] Share a board with others using a link — agent starting
[story 5] continuing the agent's own session 01a0d332-22c2-744a-844c-35aa7f5e2323 after a harness restart
    agent error: insufficient memory: this prompt projects 96.5 GiB against the engine's 96.0 GiB limit (0.5 GiB over) — fork-resuming session in 60s
    agent stopped without committing — nudge 1: continuing the session
[story 5] agent done in 4671.6s; running gates
[story 5] recorded: commit 11c1831 pushed=True
[story 5] gate green=False accept 26/36 stalled=False
04: interrupted a tool call silent for 600s (killed processes under the workspace)
Traceback (most recent call last):
  File \"drive.py\", line 1, in <module>
    main()
RuntimeError: boom
";

    #[test]
    fn parses_the_harness_lines() {
        let ev = parse_log(SAMPLE);
        let kinds: Vec<_> = ev
            .iter()
            .map(|e| (e.line, e.story, e.kind.clone()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (1, Some(5), EventKind::StoryStart { title: "Share a board with others using a link".into() }),
                (2, Some(5), EventKind::StoryContinue { session: "01a0d332-22c2-744a-844c-35aa7f5e2323".into() }),
                (
                    3,
                    Some(5),
                    EventKind::AgentError {
                        message: "insufficient memory: this prompt projects 96.5 GiB against the engine's 96.0 GiB limit (0.5 GiB over) — fork-resuming session in 60s".into()
                    }
                ),
                (4, Some(5), EventKind::Nudge { n: 1 }),
                (5, Some(5), EventKind::AgentDone { seconds: Some(4671.6) }),
                (6, Some(5), EventKind::Recorded { commit: "11c1831".into(), pushed: Some(true) }),
                (
                    7,
                    Some(5),
                    EventKind::Scored { green: Some(false), passed: 26, total: 36, stalled: Some(false), degraded: false }
                ),
                (8, Some(4), EventKind::HangInterrupt { silent_s: Some(600) }),
                (9, Some(5), EventKind::Crash { exception: Some("RuntimeError: boom".into()) }),
            ]
        );
    }

    #[test]
    fn serializes_with_kind_tag() {
        let ev = parse_log("[story 5] gate green=True accept 36/36 stalled=False\n");
        let v = serde_json::to_value(&ev[0]).unwrap();
        assert_eq!(v["kind"], "scored");
        assert_eq!(v["story"], 5);
        assert_eq!(v["passed"], 36);
        assert_eq!(v["green"], true);
    }

    #[test]
    fn other_forms() {
        assert_eq!(
            parse_line("2026-09-24T01:02:03Z 04: interrupted a tool call silent for 600s (killed processes under the workspace)"),
            Some((Some(4), EventKind::HangInterrupt { silent_s: Some(600) }))
        );
        assert_eq!(
            parse_line("    tool call silent 10 min — interrupted (Ctrl-C equivalent)"),
            Some((
                None,
                EventKind::HangInterrupt {
                    silent_s: Some(600)
                }
            ))
        );
        assert_eq!(
            parse_line("[story 2] recorded: commit - pushed=False  push rejected"),
            Some((
                Some(2),
                EventKind::Recorded {
                    commit: "-".into(),
                    pushed: Some(false)
                }
            ))
        );
        assert_eq!(
            parse_line("[story 3] gate green=None accept 0/12 stalled=True DEGRADED (power/thermal) — timing not comparable"),
            Some((
                Some(3),
                EventKind::Scored { green: None, passed: 0, total: 12, stalled: Some(true), degraded: true }
            ))
        );
        // Since the story status was added, the harness prints it before the gate result.
        assert_eq!(
            parse_line("[story 4] DONE gate green=True accept 4/4 stalled=False"),
            Some((
                Some(4),
                EventKind::Scored {
                    green: Some(true),
                    passed: 4,
                    total: 4,
                    stalled: Some(false),
                    degraded: false
                }
            ))
        );
        assert_eq!(
            parse_line(
                "[story 6] PARTIAL verdict incomplete gate green=False accept 2/9 stalled=False"
            ),
            Some((
                Some(6),
                EventKind::Scored {
                    green: Some(false),
                    passed: 2,
                    total: 9,
                    stalled: Some(false),
                    degraded: false
                }
            ))
        );
        for noise in [
            "",
            "run dir: /x",
            "[story x] agent starting",
            "[story 5] something else",
            "[dbench] attempt 1",
        ] {
            assert_eq!(parse_line(noise), None, "{noise}");
        }
    }
}
