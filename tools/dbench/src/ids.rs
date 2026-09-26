//! Name validation. Everything a job names ends up in a file path or an argv
//! element, so names are restricted to a small alphabet.

/// Longest job id, run id, install id or scope accepted.
pub const MAX_ID_LEN: usize = 64;
/// Longest pack path accepted (a repo-relative directory such as `benchmarks/vidi`).
pub const MAX_PACK_LEN: usize = 256;

/// `[A-Za-z0-9._-]{1,64}`, and not made only of dots (so never `.` or `..`).
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_ID_LEN
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
        && !s.bytes().all(|b| b == b'.')
}

/// A repo-relative path: segments that are each a valid id, joined by `/`.
/// No leading `/`, no empty, `.` or `..` segments, so it cannot leave the repo.
pub fn valid_pack(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_PACK_LEN && !s.starts_with('/') && s.split('/').all(valid_id)
}

/// Suffix that numbers repeat runs: `canvas-pi` × 3 becomes `canvas-pi-r1`, `-r2`, `-r3`.
pub const REPEAT_SUFFIX: &str = "-r";

/// Expand one job into `count` repeats: `(job id, run id)` pairs, numbered from `first`.
/// A count of 1 keeps the ids unchanged. Every result must still be a valid id.
pub fn expand_repeats(
    id: &str,
    run_id: &str,
    count: u32,
    first: u32,
) -> Result<Vec<(String, String)>, String> {
    if count == 0 {
        return Err("--repeat must be at least 1".into());
    }
    if count == 1 && first == 1 {
        return Ok(vec![(id.to_string(), run_id.to_string())]);
    }
    (first..first + count)
        .map(|n| {
            let pair = (
                format!("{id}{REPEAT_SUFFIX}{n}"),
                format!("{run_id}{REPEAT_SUFFIX}{n}"),
            );
            if valid_id(&pair.0) && valid_id(&pair.1) {
                Ok(pair)
            } else {
                Err(format!(
                    "repeat ids {} / {} are not valid ids (max {MAX_ID_LEN} chars)",
                    pair.0, pair.1
                ))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_are_numbered_distinct_jobs_and_runs() {
        assert_eq!(
            expand_repeats("j", "run", 1, 1).unwrap(),
            vec![("j".into(), "run".into())]
        );
        assert_eq!(
            expand_repeats("vidi-4090", "canvas-pi", 3, 1).unwrap(),
            vec![
                ("vidi-4090-r1".to_string(), "canvas-pi-r1".to_string()),
                ("vidi-4090-r2".to_string(), "canvas-pi-r2".to_string()),
                ("vidi-4090-r3".to_string(), "canvas-pi-r3".to_string()),
            ]
        );
        // Adding more repeats later continues the numbering without clobbering earlier runs.
        assert_eq!(
            expand_repeats("j", "run", 2, 4).unwrap()[0],
            ("j-r4".into(), "run-r4".into())
        );
        assert!(expand_repeats("j", "run", 0, 1).is_err());
        assert!(expand_repeats(&"x".repeat(MAX_ID_LEN), "run", 2, 1).is_err()); // suffix would overflow
    }

    #[test]
    fn ids() {
        for ok in ["a", "canvas-pi-01", "A.b_c-9", &"x".repeat(MAX_ID_LEN)] {
            assert!(valid_id(ok), "{ok}");
        }
        for bad in [
            "",
            ".",
            "..",
            "...",
            "a/b",
            "a b",
            "a;rm",
            "$(x)",
            "é",
            &"x".repeat(MAX_ID_LEN + 1),
        ] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn packs() {
        for ok in ["benchmarks/vidi", "fakepack", "a/b/c"] {
            assert!(valid_pack(ok), "{ok}");
        }
        for bad in ["", "/etc", "a/../b", "../x", "a//b", "a/", "./a", "a/b c"] {
            assert!(!valid_pack(bad), "{bad}");
        }
    }
}
