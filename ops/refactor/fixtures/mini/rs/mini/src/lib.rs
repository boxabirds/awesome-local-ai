//! The mini project's Rust member: one function, fully covered by its two tests.

/// Class B stand-in: pull the number of lines a listing holds.
pub fn count_lines(listing: &str) -> usize {
    if listing.is_empty() {
        0
    } else {
        listing.lines().count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_listing_has_no_lines() {
        assert_eq!(count_lines(""), 0);
    }

    #[test]
    fn a_listing_counts_its_lines() {
        assert_eq!(count_lines("a\nb"), 2);
    }
}
