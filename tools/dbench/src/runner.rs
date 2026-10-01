//! The job runner: one harness at a time, first in first out, with restarts.

use std::collections::HashMap;
use std::os::unix::process::ExitStatusExt;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::process::Command;

use crate::failure::{self, FailureMark, SAME_FAILURE_REASON};
use crate::harness::{self, Harness, Materialised};
use crate::job::{harness_args, resolve_entry, JobState, PullRecord};
use crate::progress::{self, install_env_path};
use crate::server::Shared;
use crate::sys;
use crate::timefmt::now_secs;

/// Longest `git pull --ff-only` may take before it counts as failed.
pub const GIT_PULL_TIMEOUT: Duration = Duration::from_secs(120);
/// How often an adopted harness (not our child) is checked for exit.
pub const ADOPT_POLL: Duration = Duration::from_secs(2);
/// How often a signalled process group is checked for exit.
const KILL_POLL: Duration = Duration::from_millis(200);
/// Keep this much of git's output in the job record.
const PULL_DETAIL_MAX_CHARS: usize = 500;
/// Shell convention for "killed by signal N".
const SIGNAL_EXIT_BASE: i32 = 128;
/// The harness's exit when the machine lacks what the run needs (drive.py EXIT_MISSING_RESOURCES).
/// A restart would hit the same wall, so the job fails at once.
pub const EXIT_MISSING_RESOURCES: i32 = 3;
/// The harness's exit while the machine hasn't recovered from a swap or memory guard stop (machine_fit.py
/// EXIT_MACHINE_UNFIT). Not a crash: the job waits the unfit backoff and tries again, without using a restart.
pub const EXIT_MACHINE_UNFIT: i32 = 75;
/// The line the harness prints before that exit (drive.py stop_if_missing_resources).
const MISSING_RESOURCES_MARK: &str = "MISSING RESOURCES";
/// How much of the end of the job log to search for that line.
const REASON_LOG_TAIL_BYTES: u64 = 64 * 1024;

pub async fn run(st: Arc<Shared>, adopt: Vec<crate::server::Adopted>) {
    for (id, pgid) in adopt {
        supervise_adopted(&st, &id, pgid).await;
    }
    loop {
        let Some(id) = take_next(&st) else {
            st.wake.notified().await;
            continue;
        };
        let backoff = run_one(&st, &id).await;
        st.lock().current = None;
        if let Some(wait) = backoff {
            tokio::time::sleep(wait).await;
        }
    }
}

fn take_next(st: &Shared) -> Option<String> {
    let mut inner = st.lock();
    if inner.hold.is_some() {
        return None; // held: the release wakes the loop
    }
    while let Some(id) = inner.queue.pop_front() {
        if inner
            .jobs
            .get(&id)
            .is_some_and(|j| j.state == JobState::Queued)
        {
            inner.current = Some(id.clone());
            return Some(id);
        }
    }
    None
}

/// Processes the harness started, by pid, as last seen in the process table.
type Seen = Arc<Mutex<HashMap<i32, sys::Proc>>>;

/// `ps` suffix for a process that has exited but not been reaped; there's nothing left to stop.
const DEFUNCT: &str = "<defunct>";

async fn process_table() -> Vec<sys::Proc> {
    let out = Command::new("ps")
        .args([
            "-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "lstart=", "-o", "comm=",
        ])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await;
    match out {
        Ok(o) if o.status.success() => sys::parse_ps(&String::from_utf8_lossy(&o.stdout)),
        _ => Vec::new(),
    }
}

/// Sample the harness's process tree until aborted. The harness starts some processes in
/// their own session (llama-server via setsid, pi under bwrap), outside its process group, so
/// they are orphaned rather than stopped if it dies; remembering them lets `stop_leftovers`
/// find them afterwards. A process started and orphaned between two samples is missed.
async fn track_tree(root: i32, seen: Seen, every: Duration) {
    loop {
        let found = sys::descendants(&process_table().await, root);
        if let Ok(mut s) = seen.lock() {
            for p in found {
                s.insert(p.pid, p);
            }
        }
        tokio::time::sleep(every).await;
    }
}

/// Of the tracked processes, those still running (same pid and start time).
fn still_running(tracked: &[sys::Proc], table: &[sys::Proc]) -> Vec<sys::Proc> {
    tracked
        .iter()
        .filter(|t| {
            table
                .iter()
                .any(|p| p.pid == t.pid && p.started == t.started && !p.name.ends_with(DEFUNCT))
        })
        .cloned()
        .collect()
}

/// Signal each process, and the process group of each that leads one (so a server's own
/// children go too). Never our own group.
fn signal_procs(procs: &[sys::Proc], sig: i32) {
    // SAFETY: getpgrp has no memory effects.
    let own_group = unsafe { libc::getpgrp() };
    for p in procs {
        if p.pgid == p.pid && p.pgid != own_group {
            sys::signal_group(p.pgid, sig);
        }
        sys::signal_pid(p.pid, sig);
    }
}

/// Once the harness has exited, stop whatever it started that is still running: SIGTERM,
/// then SIGKILL after the cancel grace. Also waits for them to go, so the next job doesn't
/// start while, say, the last one's model server still holds the GPU.
async fn stop_leftovers(st: &Shared, id: &str, seen: &Seen) {
    let tracked: Vec<sys::Proc> = seen
        .lock()
        .map(|s| s.values().cloned().collect())
        .unwrap_or_default();
    if tracked.is_empty() {
        return;
    }
    let left = still_running(&tracked, &process_table().await);
    if left.is_empty() {
        return;
    }
    let names: Vec<String> = left
        .iter()
        .map(|p| format!("{} ({})", p.name, p.pid))
        .collect();
    st.log_line(
        id,
        &format!(
            "stopping processes the harness left running: {}",
            names.join(", ")
        ),
    );
    signal_procs(&left, libc::SIGTERM);
    let deadline = Instant::now() + st.cfg.cancel_grace;
    loop {
        tokio::time::sleep(KILL_POLL).await;
        let left = still_running(&tracked, &process_table().await);
        if left.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            st.log_line(
                id,
                &format!("{} still running after SIGTERM; SIGKILL", left.len()),
            );
            signal_procs(&left, libc::SIGKILL);
            return;
        }
    }
}

/// SIGTERM the group, wait up to `grace` for it to go, then SIGKILL it.
pub async fn terminate_group(pgid: i32, grace: Duration) {
    if !sys::signal_group(pgid, libc::SIGTERM) {
        return;
    }
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if !sys::group_alive(pgid) {
            return;
        }
        tokio::time::sleep(KILL_POLL).await;
    }
    sys::signal_group(pgid, libc::SIGKILL);
}

/// A harness left running by a previous server: wait for its group to go, then
/// requeue it (exit code unknown; the harness resumes, so re-running is safe).
async fn supervise_adopted(st: &Arc<Shared>, id: &str, pgid: i32) {
    st.lock().current = Some(id.to_string());
    let seen = Seen::default();
    let tracker = tokio::spawn(track_tree(pgid, seen.clone(), st.cfg.tree_poll));
    if st.lock().jobs.get(id).is_some_and(|j| j.cancel_requested) {
        tokio::spawn(terminate_group(pgid, st.cfg.cancel_grace));
    }
    while sys::group_alive(pgid) {
        tokio::time::sleep(ADOPT_POLL).await;
    }
    tracker.abort();
    stop_leftovers(st, id, &seen).await;
    let mut requeued = false;
    st.update(id, |j, inner| {
        if j.cancel_requested {
            j.state = JobState::Cancelled;
            j.note(now_secs(), "adopted harness ended after a cancel");
        } else {
            j.state = JobState::Queued;
            j.note(
                now_secs(),
                "adopted harness ended (exit code unknown); requeued to resume",
            );
            inner.queue.push_front(id.to_string());
            requeued = true;
        }
    });
    st.log_line(
        id,
        if requeued {
            "adopted harness ended; requeued to resume"
        } else {
            "adopted harness ended; cancelled"
        },
    );
    st.lock().current = None;
}

async fn git_pull(st: &Shared, id: &str) {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&st.cfg.repo)
        .args(["pull", "--ff-only"])
        .env("PATH", st.cfg.child_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let (ok, detail) = match tokio::time::timeout(GIT_PULL_TIMEOUT, cmd.output()).await {
        Err(_) => (
            false,
            format!("timed out after {}s", GIT_PULL_TIMEOUT.as_secs()),
        ),
        Ok(Err(e)) => (false, format!("could not run git: {e}")),
        Ok(Ok(out)) => {
            let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&out.stderr));
            let text = text.trim();
            let start = text
                .char_indices()
                .rev()
                .nth(PULL_DETAIL_MAX_CHARS)
                .map_or(0, |(i, _)| i);
            (out.status.success(), text[start..].to_string())
        }
    };
    if ok {
        st.log_line(id, "git pull --ff-only: ok");
    } else {
        st.log_line(
            id,
            &format!("git pull --ff-only: FAILED (running anyway): {detail}"),
        );
    }
    st.update(id, |j, _| {
        if !ok {
            j.note(
                now_secs(),
                format!("git pull --ff-only failed; ran on the existing checkout: {detail}"),
            );
        }
        j.last_pull = Some(PullRecord {
            at: now_secs(),
            ok,
            detail,
        });
    });
}

/// The harness this attempt runs, ready on disk. A job that has started before keeps what it
/// started on, whatever has been released or allowed since; a new one takes the newest release
/// on origin/main, or, with none, is refused (or with `--allow-unreleased` runs the checkout's
/// own). Err is why the job can't run.
async fn choose_harness(st: &Shared, id: &str) -> Result<Harness, String> {
    let (kept, attempts) = {
        let inner = st.lock();
        let job = inner.jobs.get(id);
        (job.and_then(|j| j.harness.clone()), job.map_or(0, |j| j.attempt))
    };
    let chosen = match kept {
        Some(Harness::Release { tag, commit }) => {
            resume_release(st, id, &tag, &commit).await?;
            Harness::Release { tag, commit }
        }
        Some(Harness::Unreleased) => {
            st.log_line(id, "harness: UNRELEASED, the checkout's own, as this job started on it");
            Harness::Unreleased
        }
        // Started by a dbench from before releases: it has been running the checkout's own harness.
        None if attempts > 0 => {
            let text = "started before this node ran harness releases: keeps the checkout's own harness (UNRELEASED)";
            st.log_line(id, &format!("harness: {text}"));
            st.update(id, |j, _| {
                j.harness = Some(Harness::Unreleased);
                j.note(now_secs(), text);
            });
            Harness::Unreleased
        }
        None => {
            let chosen = first_harness(st, id).await?;
            let text = format!("runs harness {}", chosen.describe());
            st.update(id, |j, _| {
                j.harness = Some(chosen.clone());
                j.note(now_secs(), text);
            });
            chosen
        }
    };
    prune_releases(st, id, &chosen);
    Ok(chosen)
}

/// A new job's harness: the newest release, materialised; or the checkout's own where allowed.
async fn first_harness(st: &Shared, id: &str) -> Result<Harness, String> {
    if st.cfg.pull {
        if let Err(e) = harness::fetch(&st.cfg).await {
            st.log_line(id, &format!("fetching release tags FAILED (using the tags already here): {e}"));
        }
    }
    let none = match harness::latest_release(&st.cfg).await {
        Ok(Some((tag, commit))) => {
            let made = harness::materialise(&st.cfg, &tag, &commit).await?;
            let dir = harness::release_dir(&st.cfg, &tag);
            let how = if made == Materialised::Made { "made from the tag" } else { "already here" };
            st.log_line(id, &format!("harness release {tag} ({commit}): {} ({how})", dir.display()));
            return Ok(Harness::Release { tag, commit });
        }
        Ok(None) => format!(
            "no {}* tag on {}/{}",
            crate::release::TAG_PREFIX,
            crate::release::REMOTE,
            crate::release::MAIN_BRANCH
        ),
        Err(e) => format!("the releases could not be listed: {e}"),
    };
    if !st.cfg.allow_unreleased {
        return Err(format!("no harness release ({none}): {}", harness::HOW_TO_RELEASE));
    }
    st.log_line(
        id,
        &format!("harness: UNRELEASED ({none}); running the checkout's own harness, as main has it (--allow-unreleased)"),
    );
    Ok(Harness::Unreleased)
}

/// A restarted job's release: its directory, made again from the tag if it is gone. The tag must
/// still name the commit the job started on; otherwise the job fails rather than change harness.
async fn resume_release(st: &Shared, id: &str, tag: &str, commit: &str) -> Result<(), String> {
    let dir = harness::release_dir(&st.cfg, tag);
    if !dir.join(harness::MANIFEST_FILE).is_file() {
        match harness::tag_commit(&st.cfg, tag).await {
            Ok(now) if now == commit => {}
            other => {
                let found = match other {
                    Ok(now) => format!("the tag now names {now}"),
                    Err(_) => "the tag is gone".into(),
                };
                return Err(format!(
                    "this job started on harness release {tag} ({commit}); its directory {} is gone and {found}; \
                     not switching harness part-way through a run: restore the tag, or cancel and \
                     resubmit under a new run id",
                    dir.display()
                ));
            }
        }
    }
    let made = harness::materialise(&st.cfg, tag, commit).await?;
    let how = if made == Materialised::Made {
        st.update(id, |j, _| {
            j.note(now_secs(), format!("the directory of harness release {tag} was gone; made again from the tag"));
        });
        "its directory was gone: made again from the tag"
    } else {
        "kept from the job's first start"
    };
    st.log_line(id, &format!("harness release {tag} ({commit}): {} ({how})", dir.display()));
    Ok(())
}

/// Remove release directories nothing needs: all but the newest few, this job's, and those of
/// other jobs that have started and not finished.
fn prune_releases(st: &Shared, id: &str, chosen: &Harness) {
    let mut needed: std::collections::BTreeSet<String> = st
        .lock()
        .jobs
        .values()
        .filter(|j| !j.state.is_terminal())
        .filter_map(|j| match &j.harness {
            Some(Harness::Release { tag, .. }) => Some(tag.clone()),
            _ => None,
        })
        .collect();
    if let Harness::Release { tag, .. } = chosen {
        needed.insert(tag.clone());
    }
    for tag in harness::prune(&st.cfg, &needed) {
        st.log_line(id, &format!("pruned release {tag}: no job needs it and {} newer are kept", harness::KEEP_RELEASES));
    }
}

fn fail(st: &Shared, id: &str, reason: String) {
    st.log_line(id, &format!("failed: {reason}"));
    st.update(id, |j, _| {
        j.state = JobState::Failed {
            reason,
            exit_code: None,
        };
    });
}

/// Run one attempt of a job. Returns true when it was requeued for a restart.
/// Runs the job once; the wait before the next job, if the job was requeued.
async fn run_one(st: &Arc<Shared>, id: &str) -> Option<Duration> {
    if st.cfg.pull {
        git_pull(st, id).await;
    }
    let spec = st.lock().jobs.get(id).map(|j| j.spec.clone())?;
    let env = install_env_path(&st.cfg.share_dir, &spec.install_id);
    if !env.is_file() {
        fail(st, id, format!("{} missing", env.display()));
        return None;
    }
    let chosen = match choose_harness(st, id).await {
        Ok(h) => h,
        Err(reason) => {
            fail(st, id, reason);
            return None;
        }
    };
    // A release runs from its own directory and is told where results go; the checkout's own
    // harness runs as it always did.
    let (code_root, results_root) = match &chosen {
        Harness::Release { tag, .. } => (harness::release_dir(&st.cfg, tag), Some(&st.cfg.repo)),
        Harness::Unreleased => (st.cfg.repo.clone(), None),
    };
    let Some(entry) = resolve_entry(&code_root, &spec.pack) else {
        fail(st, id, format!("no harness for pack {} in {}", spec.pack, code_root.display()));
        return None;
    };
    let args = harness_args(&entry, &spec);
    let log = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(st.log_path(id))
    {
        Ok(f) => f,
        Err(e) => {
            fail(st, id, format!("open log: {e}"));
            return None;
        }
    };
    let (out, errf) = match (log.try_clone(), log.try_clone()) {
        (Ok(a), Ok(b)) => (a, b),
        _ => {
            fail(st, id, "duplicate log handle".into());
            return None;
        }
    };
    let mut cmd = Command::new("bash");
    cmd.args(&args)
        .current_dir(&st.cfg.repo)
        .env("PATH", st.cfg.child_path())
        .env_remove(harness::RESULTS_ROOT_ENV)
        .envs(&spec.server_env)
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(errf)
        .process_group(0);
    if let Some(root) = results_root {
        cmd.env(harness::RESULTS_ROOT_ENV, root);
    }
    let shown: Vec<String> = args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();

    // Spawn under the lock so a cancel can't slip between the check and the start.
    let (mut child, pgid) = {
        let mut inner = st.lock();
        let job = inner.jobs.get_mut(id)?;
        if job.state != JobState::Queued {
            return None; // cancelled while preparing
        }
        let attempt = job.attempt + 1;
        st.log_line(id, &format!("attempt {attempt}: bash {}", shown.join(" ")));
        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                drop(inner);
                fail(st, id, format!("spawn bash: {e}"));
                return None;
            }
        };
        let pid = child.id().map(|p| p as i32).unwrap_or(0);
        job.attempt = attempt;
        job.state = JobState::Running {
            pid,
            pgid: pid,
            attempt,
            started_at: now_secs(),
            boot_time: st.boot_time,
        };
        job.updated_at = now_secs();
        st.persist(job);
        (child, pid)
    };

    let seen = Seen::default();
    let tracker = tokio::spawn(track_tree(pgid, seen.clone(), st.cfg.tree_poll));
    let code = match child.wait().await {
        Ok(s) => s
            .code()
            .unwrap_or_else(|| SIGNAL_EXIT_BASE + s.signal().unwrap_or(0)),
        Err(e) => {
            st.log_line(id, &format!("wait failed: {e}"));
            -1
        }
    };
    if sys::group_alive(pgid) {
        st.log_line(
            id,
            &format!("harness exited {code}; stopping processes left in its group"),
        );
        terminate_group(pgid, st.cfg.cancel_grace).await;
    }
    tracker.abort();
    stop_leftovers(st, id, &seen).await;

    let max = st.cfg.max_restarts;
    let missing = (code == EXIT_MISSING_RESOURCES).then(|| {
        let tail = log_tail(&st.log_path(id), REASON_LOG_TAIL_BYTES);
        missing_resources_reason(&tail)
            .unwrap_or_else(|| "the harness gave no reason; see the job log".into())
    });
    // What this failure was, to tell a repeat (which a restart can't get past) from a new one.
    let mark = (code != 0 && missing.is_none() && code != EXIT_MACHINE_UNFIT).then(|| FailureMark {
        signature: failure::signature(code, &log_tail(&st.log_path(id), REASON_LOG_TAIL_BYTES)),
        stories: failure::recorded_stories(
            &progress::compute(&st.cfg.repo, &st.cfg.share_dir, &spec, &st.log_path(id)).stories,
        ),
    });
    let mut requeued = false;
    let mut repeated = None;
    let job = st.update(id, |j, inner| {
        let now = now_secs();
        let repeat = mark
            .as_ref()
            .filter(|m| failure::is_repeat(j.last_failure.as_ref(), m));
        if j.cancel_requested {
            j.state = JobState::Cancelled;
        } else if code == 0 {
            j.state = JobState::Done { exit_code: 0 };
        } else if let Some(why) = &missing {
            let reason = format!("missing resources: {why}");
            j.note(now, format!("{reason}; not restarting"));
            j.state = JobState::Failed {
                reason,
                exit_code: Some(code),
            };
        } else if code == EXIT_MACHINE_UNFIT {
            // A wait for the machine, not a failed attempt: the attempt is given back.
            j.attempt = j.attempt.saturating_sub(1);
            j.note(
                now,
                format!("machine unfit (exit {code}); waiting {}s, not counted as a restart", st.cfg.unfit_backoff.as_secs()),
            );
            j.state = JobState::Queued;
            inner.queue.push_front(id.to_string());
            requeued = true;
        } else if let Some(m) = repeat {
            let reason = format!("{SAME_FAILURE_REASON}: {}", m.signature);
            j.note(now, format!("{reason}; not restarting"));
            repeated = Some(reason.clone());
            j.state = JobState::Failed {
                reason,
                exit_code: Some(code),
            };
        } else if j.attempt > max {
            let reason = format!(
                "harness exited {code} on attempt {}; all {max} restarts used",
                j.attempt
            );
            j.note(now, reason.clone());
            j.state = JobState::Failed {
                reason,
                exit_code: Some(code),
            };
        } else {
            j.note(
                now,
                format!("harness exited {code} on attempt {}; restarting", j.attempt),
            );
            j.last_failure = mark.clone();
            j.state = JobState::Queued;
            inner.queue.push_front(id.to_string());
            requeued = true;
        }
    });
    let label = job.map(|j| j.state.label()).unwrap_or("gone");
    if let Some(reason) = repeated {
        st.log_line(id, &format!("{reason}; not restarting"));
    }
    if !requeued {
        st.log_line(id, &format!("harness exited {code}; job {label}"));
        return None;
    }
    let wait = if code == EXIT_MACHINE_UNFIT { st.cfg.unfit_backoff } else { st.cfg.restart_backoff };
    st.log_line(
        id,
        &if code == EXIT_MACHINE_UNFIT {
            format!("machine unfit (exit {code}); waiting {}s for it to recover", wait.as_secs_f32())
        } else {
            format!("harness exited {code}; restarting in {}s", wait.as_secs_f32())
        },
    );
    Some(wait)
}

/// The last `len` bytes of a file, lossily decoded; empty if it can't be read.
fn log_tail(path: &std::path::Path, len: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        return String::new();
    };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(size.saturating_sub(len)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// What the harness said was missing: its last MISSING RESOURCES line, without the marker.
pub fn missing_resources_reason(log: &str) -> Option<String> {
    let line = log
        .lines()
        .rev()
        .find(|l| l.contains(MISSING_RESOURCES_MARK))?;
    let rest = &line[line.find(MISSING_RESOURCES_MARK)? + MISSING_RESOURCES_MARK.len()..];
    Some(rest.trim_start_matches([' ', ':']).trim().to_string())
}

#[cfg(test)]
mod missing_resources_tests {
    use super::missing_resources_reason;

    #[test]
    fn takes_the_last_marked_line() {
        let log = "MISSING RESOURCES: old\n[story 3] gates\nMISSING RESOURCES: no browser. Story 3 scores are void.\nexit 3: noise\n";
        assert_eq!(
            missing_resources_reason(log).as_deref(),
            Some("no browser. Story 3 scores are void.")
        );
        assert_eq!(missing_resources_reason("exit 3\n"), None);
    }
}
