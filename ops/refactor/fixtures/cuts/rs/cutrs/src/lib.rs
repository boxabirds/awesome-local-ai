//! The cuts project's Rust member: one function with two cuts, a guard and a use, fully covered by its tests.

/// Stands in for a version-control command: 0 on success, 1 when the path names a folder.
pub fn run_git(args: &[&str]) -> i32 {
    if args[1].ends_with('/') {
        1
    } else {
        0
    }
}

/// Record a run. The version-control calls are the cuts; the guard decides what a failure does; the last line is the use.
pub fn publish(path: &str, amend: bool) -> String {
    let done: i32;
    if amend {
        done = run_git(&["amend", path]);
    } else {
        done = run_git(&["add", path]);
    }
    if done != 0 {
        return String::from("failed");
    }
    format!("ok:{path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_adds_a_run() {
        assert_eq!(publish("r/x", false), "ok:r/x");
    }

    #[test]
    fn publish_amends_a_run() {
        assert_eq!(publish("r/x", true), "ok:r/x");
    }

    #[test]
    fn publish_reports_a_failed_add() {
        assert_eq!(publish("r/", false), "failed");
    }

    #[test]
    fn publish_reports_a_failed_amend() {
        assert_eq!(publish("r/", true), "failed");
    }
}
