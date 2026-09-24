//! What to do, at server start, with a job the previous server left behind.

use crate::job::JobState;

/// What the new server knows about the recorded process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessCheck {
    /// The recorded pid exists and still leads the recorded process group.
    pub alive: bool,
    /// The machine has not rebooted since the job started (or it can't tell).
    pub same_boot: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Recovery {
    /// Not a running job: leave it (queued jobs go back in the queue in submit order).
    Keep,
    /// The harness is still running: watch it until its group is gone, then requeue it
    /// (its exit code is unknown; re-running is safe because the harness resumes).
    Adopt { pid: i32, pgid: i32 },
    /// The harness died with the server (or the machine rebooted): queue it at the
    /// front. The dead run counts as an attempt, so the next start is attempt + 1.
    Requeue,
    /// It was being cancelled when the server went away, and it is gone now.
    Cancelled,
    /// It has already used all its restarts.
    Fail { reason: String },
}

pub fn decide(
    state: &JobState,
    attempt: u32,
    max_restarts: u32,
    cancel_requested: bool,
    check: ProcessCheck,
) -> Recovery {
    let JobState::Running { pid, pgid, .. } = *state else {
        return Recovery::Keep;
    };
    if check.alive && check.same_boot {
        return Recovery::Adopt { pid, pgid };
    }
    if cancel_requested {
        return Recovery::Cancelled;
    }
    if attempt > max_restarts {
        return Recovery::Fail {
            reason: format!(
                "harness process gone after an unclean server stop, and all {max_restarts} restarts are used"
            ),
        };
    }
    Recovery::Requeue
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX: u32 = 3;
    fn running(attempt: u32) -> JobState {
        JobState::Running {
            pid: 10,
            pgid: 10,
            attempt,
            started_at: 0,
            boot_time: None,
        }
    }
    fn check(alive: bool, same_boot: bool) -> ProcessCheck {
        ProcessCheck { alive, same_boot }
    }

    #[test]
    fn not_running_is_kept() {
        for s in [
            JobState::Queued,
            JobState::Done { exit_code: 0 },
            JobState::Cancelled,
            JobState::Failed {
                reason: "x".into(),
                exit_code: None,
            },
        ] {
            assert_eq!(decide(&s, 1, MAX, false, check(true, true)), Recovery::Keep);
        }
    }

    #[test]
    fn alive_is_adopted() {
        assert_eq!(
            decide(&running(1), 1, MAX, false, check(true, true)),
            Recovery::Adopt { pid: 10, pgid: 10 }
        );
        // Even past the restart cap, and even while a cancel is pending: it is still running.
        assert_eq!(
            decide(&running(9), 9, MAX, true, check(true, true)),
            Recovery::Adopt { pid: 10, pgid: 10 }
        );
    }

    #[test]
    fn dead_or_rebooted_is_requeued() {
        assert_eq!(
            decide(&running(1), 1, MAX, false, check(false, true)),
            Recovery::Requeue
        );
        // A live pid after a reboot is someone else's process.
        assert_eq!(
            decide(&running(1), 1, MAX, false, check(true, false)),
            Recovery::Requeue
        );
        assert_eq!(
            decide(&running(MAX), MAX, MAX, false, check(false, true)),
            Recovery::Requeue
        );
    }

    #[test]
    fn dead_past_the_cap_fails() {
        assert!(matches!(
            decide(&running(MAX + 1), MAX + 1, MAX, false, check(false, false)),
            Recovery::Fail { .. }
        ));
    }

    #[test]
    fn dead_while_cancelling_is_cancelled() {
        assert_eq!(
            decide(&running(1), 1, MAX, true, check(false, true)),
            Recovery::Cancelled
        );
    }
}
