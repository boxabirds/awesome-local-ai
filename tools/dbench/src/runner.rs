//! The job runner: one harness at a time, first in first out, with restarts.

use std::os::unix::process::ExitStatusExt;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Command;

use crate::job::{harness_args, resolve_entry, JobState, PullRecord};
use crate::progress::install_env_path;
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
        if backoff {
            tokio::time::sleep(st.cfg.restart_backoff).await;
        }
    }
}

fn take_next(st: &Shared) -> Option<String> {
    let mut inner = st.lock();
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
    if st.lock().jobs.get(id).is_some_and(|j| j.cancel_requested) {
        tokio::spawn(terminate_group(pgid, st.cfg.cancel_grace));
    }
    while sys::group_alive(pgid) {
        tokio::time::sleep(ADOPT_POLL).await;
    }
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
async fn run_one(st: &Arc<Shared>, id: &str) -> bool {
    if st.cfg.pull {
        git_pull(st, id).await;
    }
    let Some(spec) = st.lock().jobs.get(id).map(|j| j.spec.clone()) else {
        return false;
    };
    let env = install_env_path(&st.cfg.share_dir, &spec.install_id);
    if !env.is_file() {
        fail(st, id, format!("{} missing", env.display()));
        return false;
    }
    let Some(entry) = resolve_entry(&st.cfg.repo, &spec.pack) else {
        fail(st, id, format!("no harness for pack {}", spec.pack));
        return false;
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
            return false;
        }
    };
    let (out, errf) = match (log.try_clone(), log.try_clone()) {
        (Ok(a), Ok(b)) => (a, b),
        _ => {
            fail(st, id, "duplicate log handle".into());
            return false;
        }
    };
    let mut cmd = Command::new("bash");
    cmd.args(&args)
        .current_dir(&st.cfg.repo)
        .env("PATH", st.cfg.child_path())
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(errf)
        .process_group(0);
    let shown: Vec<String> = args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();

    // Spawn under the lock so a cancel can't slip between the check and the start.
    let (mut child, pgid) = {
        let mut inner = st.lock();
        let Some(job) = inner.jobs.get_mut(id) else {
            return false;
        };
        if job.state != JobState::Queued {
            return false; // cancelled while preparing
        }
        let attempt = job.attempt + 1;
        st.log_line(id, &format!("attempt {attempt}: bash {}", shown.join(" ")));
        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                drop(inner);
                fail(st, id, format!("spawn bash: {e}"));
                return false;
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

    let max = st.cfg.max_restarts;
    let mut requeued = false;
    let job = st.update(id, |j, inner| {
        let now = now_secs();
        if j.cancel_requested {
            j.state = JobState::Cancelled;
        } else if code == 0 {
            j.state = JobState::Done { exit_code: 0 };
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
            j.state = JobState::Queued;
            inner.queue.push_front(id.to_string());
            requeued = true;
        }
    });
    let label = job.map(|j| j.state.label()).unwrap_or("gone");
    if requeued {
        st.log_line(
            id,
            &format!(
                "harness exited {code}; restarting in {}s",
                st.cfg.restart_backoff.as_secs_f32()
            ),
        );
    } else {
        st.log_line(id, &format!("harness exited {code}; job {label}"));
    }
    requeued
}
