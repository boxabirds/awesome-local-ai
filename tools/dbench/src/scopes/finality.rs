//! The finality rule of the scope API (docs/design/dbench-scopes/api.md, "Final, and resumption"), as pure functions of
//! recorded state, plus the thin readers that gather that state from a run directory.
//!
//! The rule:
//! * A run is final when `run-status.json` says `finished`, `failed` or `stopped`, or the job for the run is terminal
//!   (`done`, `failed`, `cancelled`), whichever comes first. A run still `started` (or with no readable status) and with
//!   no job, or a live job (`queued`, `running`), is not final.
//! * When a run is final every story and stream of it is final, including a story that never started or never ended.
//! * A story is final when it has a closing status, or the run is final.
//! * A stream (`agent`, `conditions`) is final when its story is; `egress` is final when the run is.
//!
//! Story status values found in the 135 real run directories of the lake (17 Oct 2026; counts in the report of this
//! change): `metrics.json` `stories[N].status` is `DONE` or `PARTIAL` only; `progress.json` `stories[].status` is `DONE`,
//! `PARTIAL`, `pending` or `running`. No `FAILED` or `SKIPPED` story status exists in the data: an operator's skip ends
//! the story `PARTIAL` (`ended_by: operator`). The mapping below still accepts `failed` and `skipped` (any case), because
//! the contract names those states.
//!
//! Decision for a status value this module does not know (or a story with files but no status): it is `running` while the
//! run is open, because the harness may be about to write a value this version does not know; once the run is final it is
//! `failed`, because the story is over and did not end in any closing status. `running` or `pending` in a final run is the
//! same case: `pending` is `not_started`, `running` is `failed` (it never ended).

use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

use crate::collect::{METRICS_FILE, STORIES_DIR};
use crate::progress::PROGRESS_FILE;

/// `run-status.json` `state` values the harness writes.
pub const RUN_STARTED: &str = "started";
pub const RUN_FINISHED: &str = "finished";
pub const RUN_FAILED: &str = "failed";
pub const RUN_STOPPED: &str = "stopped";
pub const RUN_UNKNOWN: &str = "unknown";

/// Story statuses as recorded.
const STATUS_DONE: &str = "DONE";
const STATUS_PARTIAL: &str = "PARTIAL";
const STATUS_PENDING: &str = "pending";
const STATUS_RUNNING: &str = "running";
const STATUS_FAILED: &str = "failed";
const STATUS_SKIPPED: &str = "skipped";

/// The most digits a story directory name has (`collect::MAX_STORY_DIGITS`), so its number fits a `u32`.
const STORY_DIGITS_RADIX: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    Started,
    Finished,
    Failed,
    Stopped,
    /// No `run-status.json`, or one that does not hold a state this version knows.
    Unknown,
}

impl RunState {
    pub fn from_text(text: Option<&str>) -> RunState {
        match text {
            Some(RUN_STARTED) => RunState::Started,
            Some(RUN_FINISHED) => RunState::Finished,
            Some(RUN_FAILED) => RunState::Failed,
            Some(RUN_STOPPED) => RunState::Stopped,
            _ => RunState::Unknown,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            RunState::Started => RUN_STARTED,
            RunState::Finished => RUN_FINISHED,
            RunState::Failed => RUN_FAILED,
            RunState::Stopped => RUN_STOPPED,
            RunState::Unknown => RUN_UNKNOWN,
        }
    }

    fn is_closing(self) -> bool {
        matches!(self, RunState::Finished | RunState::Failed | RunState::Stopped)
    }
}

/// The state of the newest job for the run, or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobPhase {
    NoJob,
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
    /// A label this version does not know: not terminal, so it never closes a run.
    Other,
}

impl JobPhase {
    pub fn from_label(label: Option<&str>) -> JobPhase {
        match label {
            None => JobPhase::NoJob,
            Some("queued") => JobPhase::Queued,
            Some("running") => JobPhase::Running,
            Some("done") => JobPhase::Done,
            Some("failed") => JobPhase::Failed,
            Some("cancelled") => JobPhase::Cancelled,
            Some(_) => JobPhase::Other,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, JobPhase::Done | JobPhase::Failed | JobPhase::Cancelled)
    }

    /// A job that is queued or running: the harness will write more.
    pub fn is_live(self) -> bool {
        matches!(self, JobPhase::Queued | JobPhase::Running)
    }
}

/// Whether the run scope is final. A queued or running job reopens the run whatever run-status.json still says: a resumed
/// run keeps the old closing state until its harness writes `started`, and a caller must not stop reading then.
pub fn run_is_final(run: RunState, job: JobPhase) -> bool {
    !job.is_live() && (run.is_closing() || job.is_terminal())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoryState {
    NotStarted,
    Running,
    Done,
    Partial,
    Failed,
    Skipped,
}

impl StoryState {
    pub fn label(self) -> &'static str {
        match self {
            StoryState::NotStarted => "not_started",
            StoryState::Running => "running",
            StoryState::Done => "done",
            StoryState::Partial => "partial",
            StoryState::Failed => "failed",
            StoryState::Skipped => "skipped",
        }
    }

    /// A state that closes a story whatever the run is doing.
    fn is_closing(self) -> bool {
        matches!(
            self,
            StoryState::Done | StoryState::Partial | StoryState::Failed | StoryState::Skipped
        )
    }
}

/// What the run directory records about one story. All inputs; nothing is read here.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StoryFacts {
    /// `metrics.json` `stories[N].status`, when metrics.json lists the story and gives it one.
    pub metrics_status: Option<String>,
    /// Whether `metrics.json` lists the story at all.
    pub in_metrics: bool,
    /// `progress.json` `stories[].status`, when progress.json lists the story and gives it one.
    pub progress_status: Option<String>,
    /// Whether `progress.json` lists the story at all.
    pub in_progress: bool,
    /// Whether `stories/NN/` exists in the run directory (the harness makes it when the story starts).
    pub has_dir: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoryView {
    pub state: StoryState,
    pub final_: bool,
}

/// A recorded status text as a state, when it is one this version knows.
fn state_of_status(text: &str) -> Option<StoryState> {
    let t = text.trim();
    if t == STATUS_DONE {
        Some(StoryState::Done)
    } else if t == STATUS_PARTIAL {
        Some(StoryState::Partial)
    } else if t.eq_ignore_ascii_case(STATUS_FAILED) {
        Some(StoryState::Failed)
    } else if t.eq_ignore_ascii_case(STATUS_SKIPPED) {
        Some(StoryState::Skipped)
    } else if t.eq_ignore_ascii_case(STATUS_RUNNING) {
        Some(StoryState::Running)
    } else if t.eq_ignore_ascii_case(STATUS_PENDING) {
        Some(StoryState::NotStarted)
    } else {
        None
    }
}

/// A story's state and final flag, from what is recorded and whether the run is final.
pub fn story_view(run_final: bool, facts: &StoryFacts) -> StoryView {
    let known = |s: &Option<String>| s.as_deref().and_then(state_of_status);
    let metrics = known(&facts.metrics_status);
    let progress = known(&facts.progress_status);
    // A value was written that this version does not know.
    let unknown_status = (facts.metrics_status.is_some() && metrics.is_none()) || (facts.progress_status.is_some() && progress.is_none());
    // A closing status wins, wherever it is written; metrics.json is the record, progress.json the live view.
    let closing = metrics
        .filter(|s| s.is_closing())
        .or_else(|| progress.filter(|s| s.is_closing()));
    let state = if let Some(state) = closing {
        state
    } else if run_final {
        // The run is over and the story has no closing status: it never started, or it never ended.
        let started = facts.has_dir || facts.in_metrics || progress == Some(StoryState::Running) || unknown_status;
        if started {
            StoryState::Failed
        } else {
            StoryState::NotStarted
        }
    } else if progress == Some(StoryState::Running)
        || metrics == Some(StoryState::Running)
        || facts.has_dir
        || facts.in_metrics
        || unknown_status
    {
        StoryState::Running
    } else {
        StoryState::NotStarted
    };
    StoryView {
        state,
        final_: run_final || state.is_closing(),
    }
}

/// Whether a stream is final: `egress` (no story) with the run; `agent` and `conditions` with their story.
pub fn stream_is_final(run_final: bool, story: Option<StoryView>) -> bool {
    match story {
        None => run_final,
        Some(view) => run_final || view.final_,
    }
}

/// A story number from a `stories/` directory name or a recorded id.
pub fn story_number(text: &str) -> Option<u32> {
    let t = text.trim();
    if t.is_empty() || !t.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    u32::from_str_radix(t, STORY_DIGITS_RADIX).ok()
}

fn read_json(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn status_text(v: &Value) -> Option<String> {
    v.get("status").and_then(|s| s.as_str()).map(String::from)
}

/// What the run directory records about every story it knows: stories listed in `metrics.json`, in `progress.json`, or
/// that have a `stories/NN/` directory. Absent or unreadable files are simply absent.
pub fn read_story_facts(run_dir: &Path) -> BTreeMap<u32, StoryFacts> {
    let mut out: BTreeMap<u32, StoryFacts> = BTreeMap::new();
    if let Ok(rd) = std::fs::read_dir(run_dir.join(STORIES_DIR)) {
        for e in rd.filter_map(|e| e.ok()) {
            // `DirEntry::file_type` does not follow a link: a link named like a story is not a story directory.
            if !e.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            if let Some(n) = e.file_name().to_str().and_then(story_number) {
                out.entry(n).or_default().has_dir = true;
            }
        }
    }
    if let Some(stories) = read_json(&run_dir.join(METRICS_FILE))
        .as_ref()
        .and_then(|m| m.get("stories"))
        .and_then(|s| s.as_object())
    {
        for (id, s) in stories {
            if let Some(n) = story_number(id) {
                let f = out.entry(n).or_default();
                f.in_metrics = true;
                f.metrics_status = status_text(s);
            }
        }
    }
    if let Some(stories) = read_json(&run_dir.join(PROGRESS_FILE))
        .as_ref()
        .and_then(|p| p.get("stories"))
        .and_then(|s| s.as_array())
    {
        for s in stories {
            let id = match s.get("id") {
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::String(t)) => t.clone(),
                _ => continue,
            };
            if let Some(n) = story_number(&id) {
                let f = out.entry(n).or_default();
                f.in_progress = true;
                f.progress_status = status_text(s);
            }
        }
    }
    out
}

/// Everything the finality rule needs from a run directory and its newest job.
pub struct Assessment {
    pub run_state: RunState,
    pub job: JobPhase,
    pub run_final: bool,
    pub stories: BTreeMap<u32, StoryFacts>,
}

impl Assessment {
    pub fn read(run_dir: &Path, job_state_label: Option<&str>) -> Assessment {
        let status = crate::collect::run_status(run_dir);
        let run_state = RunState::from_text(status.as_ref().map(|s| s.state.as_str()));
        let job = JobPhase::from_label(job_state_label);
        Assessment {
            run_state,
            job,
            run_final: run_is_final(run_state, job),
            stories: read_story_facts(run_dir),
        }
    }

    /// The view of one story; a story nothing records is `not_started` (final once the run is).
    pub fn story(&self, n: u32) -> StoryView {
        let facts = self.stories.get(&n).cloned().unwrap_or_default();
        story_view(self.run_final, &facts)
    }
}

/// For the stream handler: whether a stream is final now. `story` is `Some(n)` for `agent` and `conditions`, `None` for
/// `egress`. `job_state_label` is the label of the newest job for the run (`queued|running|done|failed|cancelled`), or
/// `None` when the run has no job.
pub fn stream_final(run_dir: &Path, job_state_label: Option<&str>, story: Option<u32>) -> bool {
    let a = Assessment::read(run_dir, job_state_label);
    stream_is_final(a.run_final, story.map(|n| a.story(n)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Case table (MECE by input dimension).
    //
    // run_is_final: run_state {started, finished, failed, stopped, unknown} x job {none, queued, running, done, failed,
    //   cancelled}: 30 cells. Final iff run_state is closing OR job is terminal.
    // job label outside the five: never terminal.
    // story_view, run open: {metrics DONE, metrics PARTIAL, progress DONE, progress PARTIAL, progress running, progress
    //   pending, dir only, in metrics without status, unknown status, nothing} .
    // story_view, run final: the same inputs; a never-started story closes as not_started, a started-never-ended story
    //   as failed.
    // stream_is_final: egress follows the run; a story stream follows its story or the run.

    const RUN_STATES: [RunState; 5] = [
        RunState::Started,
        RunState::Finished,
        RunState::Failed,
        RunState::Stopped,
        RunState::Unknown,
    ];
    const JOB_LABELS: [Option<&str>; 6] = [
        None,
        Some("queued"),
        Some("running"),
        Some("done"),
        Some("failed"),
        Some("cancelled"),
    ];

    #[test]
    fn run_is_final_for_every_run_state_and_job_state() {
        for run in RUN_STATES {
            for label in JOB_LABELS {
                let job = JobPhase::from_label(label);
                // A queued or running job reopens the run whatever run-status.json still says (a resumed run).
                let live = matches!(label, Some("queued") | Some("running"));
                let expected = !live
                    && (matches!(run, RunState::Finished | RunState::Failed | RunState::Stopped)
                        || matches!(label, Some("done") | Some("failed") | Some("cancelled")));
                assert_eq!(run_is_final(run, job), expected, "run {run:?}, job {label:?}");
            }
        }
    }

    #[test]
    fn an_unknown_job_label_never_closes_a_run() {
        assert!(!run_is_final(RunState::Started, JobPhase::from_label(Some("paused"))));
    }

    #[test]
    fn run_state_text_maps_and_unknown_text_is_unknown() {
        assert_eq!(RunState::from_text(Some("started")), RunState::Started);
        assert_eq!(RunState::from_text(Some("finished")), RunState::Finished);
        assert_eq!(RunState::from_text(Some("failed")), RunState::Failed);
        assert_eq!(RunState::from_text(Some("stopped")), RunState::Stopped);
        assert_eq!(RunState::from_text(Some("exploded")), RunState::Unknown);
        assert_eq!(RunState::from_text(None), RunState::Unknown);
        for s in RUN_STATES {
            assert_eq!(RunState::from_text(Some(s.label())), s);
        }
    }

    fn facts(metrics: Option<&str>, progress: Option<&str>, dir: bool) -> StoryFacts {
        StoryFacts {
            metrics_status: metrics.map(String::from),
            in_metrics: metrics.is_some(),
            progress_status: progress.map(String::from),
            in_progress: progress.is_some(),
            has_dir: dir,
        }
    }

    fn view(run_final: bool, f: &StoryFacts) -> (StoryState, bool) {
        let v = story_view(run_final, f);
        (v.state, v.final_)
    }

    #[test]
    fn closing_statuses_are_final_in_an_open_run() {
        assert_eq!(view(false, &facts(Some("DONE"), None, true)), (StoryState::Done, true));
        assert_eq!(view(false, &facts(Some("PARTIAL"), None, true)), (StoryState::Partial, true));
        assert_eq!(view(false, &facts(None, Some("DONE"), true)), (StoryState::Done, true));
        assert_eq!(view(false, &facts(None, Some("PARTIAL"), true)), (StoryState::Partial, true));
        assert_eq!(view(false, &facts(None, Some("FAILED"), true)), (StoryState::Failed, true));
        assert_eq!(view(false, &facts(None, Some("skipped"), false)), (StoryState::Skipped, true));
    }

    #[test]
    fn metrics_status_wins_over_progress_status() {
        assert_eq!(view(false, &facts(Some("PARTIAL"), Some("running"), true)), (StoryState::Partial, true));
        assert_eq!(view(false, &facts(Some("DONE"), Some("PARTIAL"), true)), (StoryState::Done, true));
    }

    #[test]
    fn an_open_run_with_story_1_done_2_running_3_not_started() {
        let s1 = facts(Some("DONE"), Some("DONE"), true);
        let s2 = facts(None, Some("running"), true);
        let s3 = facts(None, Some("pending"), false);
        assert_eq!(view(false, &s1), (StoryState::Done, true));
        assert_eq!(view(false, &s2), (StoryState::Running, false));
        assert_eq!(view(false, &s3), (StoryState::NotStarted, false));
    }

    #[test]
    fn a_story_with_files_but_no_record_is_running_while_open_and_failed_once_final() {
        let f = facts(None, None, true);
        assert_eq!(view(false, &f), (StoryState::Running, false));
        assert_eq!(view(true, &f), (StoryState::Failed, true));
    }

    #[test]
    fn a_story_listed_in_metrics_without_a_status_follows_the_unknown_rule() {
        let f = StoryFacts { in_metrics: true, ..Default::default() };
        assert_eq!(view(false, &f), (StoryState::Running, false));
        assert_eq!(view(true, &f), (StoryState::Failed, true));
    }

    #[test]
    fn an_unknown_status_value_is_running_while_open_and_failed_once_final() {
        let f = facts(None, Some("exploding"), false);
        assert_eq!(view(false, &f), (StoryState::Running, false));
        assert_eq!(view(true, &f), (StoryState::Failed, true));
        let g = facts(Some("WEIRD"), None, true);
        assert_eq!(view(false, &g), (StoryState::Running, false));
        assert_eq!(view(true, &g), (StoryState::Failed, true));
    }

    #[test]
    fn a_final_run_closes_a_story_that_never_started_and_one_that_never_ended() {
        let never_started = facts(None, Some("pending"), false);
        assert_eq!(view(true, &never_started), (StoryState::NotStarted, true));
        let nothing = StoryFacts::default();
        assert_eq!(view(true, &nothing), (StoryState::NotStarted, true));
        let never_ended = facts(None, Some("running"), true);
        assert_eq!(view(true, &never_ended), (StoryState::Failed, true));
        // A story that ended keeps its state in a final run.
        assert_eq!(view(true, &facts(Some("DONE"), None, true)), (StoryState::Done, true));
    }

    #[test]
    fn nothing_recorded_is_not_started_and_open() {
        assert_eq!(view(false, &StoryFacts::default()), (StoryState::NotStarted, false));
    }

    #[test]
    fn stream_finality_follows_the_run_or_the_story() {
        let open_running = StoryView { state: StoryState::Running, final_: false };
        let done = StoryView { state: StoryState::Done, final_: true };
        assert!(!stream_is_final(false, None));
        assert!(stream_is_final(true, None));
        assert!(!stream_is_final(false, Some(open_running)));
        assert!(stream_is_final(false, Some(done)));
        assert!(stream_is_final(true, Some(open_running)));
    }

    #[test]
    fn story_numbers_are_digits_only() {
        assert_eq!(story_number("01"), Some(1));
        assert_eq!(story_number("12"), Some(12));
        assert_eq!(story_number(""), None);
        assert_eq!(story_number("1a"), None);
        assert_eq!(story_number("-1"), None);
        assert_eq!(story_number("99999999999999"), None);
    }
}
