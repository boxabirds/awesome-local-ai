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

#[cfg(test)]
mod tests {
    use super::*;

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
