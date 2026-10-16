//! The rounds project's Rust member: one function whose two cuts follow each other on one path.

/// Stands in for a version-control command: 0 on success, 1 when the path names a folder.
pub fn run_git(args: &[&str]) -> i32 {
    if args[1].ends_with('/') {
        1
    } else {
        0
    }
}

/// Add, then commit. Both calls are cuts.
pub fn publish_all(path: &str) -> String {
    let first: i32;
    let second: i32;
    first = run_git(&["add", path]);
    second = run_git(&["commit", path]);
    if first + second != 0 {
        return String::from("failed");
    }
    format!("ok:{path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_all_records_a_run() {
        assert_eq!(publish_all("r/x"), "ok:r/x");
    }

    #[test]
    fn publish_all_reports_a_failure() {
        assert_eq!(publish_all("r/"), "failed");
    }
}
