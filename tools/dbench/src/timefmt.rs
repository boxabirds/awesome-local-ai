//! Time helpers without a date crate.

use std::time::{SystemTime, UNIX_EPOCH};

const SECS_PER_MIN: u64 = 60;
const SECS_PER_HOUR: u64 = 60 * SECS_PER_MIN;
const SECS_PER_DAY: u64 = 24 * SECS_PER_HOUR;

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `2026-09-24T10:11:12Z` for a unix time.
pub fn fmt_utc(secs: u64) -> String {
    let days = (secs / SECS_PER_DAY) as i64;
    let rem = secs % SECS_PER_DAY;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / SECS_PER_HOUR,
        (rem % SECS_PER_HOUR) / SECS_PER_MIN,
        rem % SECS_PER_MIN
    )
}

/// `3h12m`, `4m05s`, `12s`: a short duration for humans.
pub fn fmt_duration(secs: u64) -> String {
    if secs >= SECS_PER_DAY {
        format!(
            "{}d{}h",
            secs / SECS_PER_DAY,
            (secs % SECS_PER_DAY) / SECS_PER_HOUR
        )
    } else if secs >= SECS_PER_HOUR {
        format!(
            "{}h{:02}m",
            secs / SECS_PER_HOUR,
            (secs % SECS_PER_HOUR) / SECS_PER_MIN
        )
    } else if secs >= SECS_PER_MIN {
        format!("{}m{:02}s", secs / SECS_PER_MIN, secs % SECS_PER_MIN)
    } else {
        format!("{secs}s")
    }
}

// Howard Hinnant's days-to-civil algorithm; the constants are the proleptic
// Gregorian calendar's era arithmetic.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    const DAYS_FROM_0000_TO_1970: i64 = 719_468;
    const DAYS_PER_ERA: i64 = 146_097;
    let z = z + DAYS_FROM_0000_TO_1970;
    let era = if z >= 0 { z } else { z - (DAYS_PER_ERA - 1) } / DAYS_PER_ERA;
    let doe = z - era * DAYS_PER_ERA;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc() {
        assert_eq!(fmt_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(fmt_utc(1_790_199_771), "2026-09-23T21:42:51Z");
        assert_eq!(fmt_utc(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn durations() {
        assert_eq!(fmt_duration(12), "12s");
        assert_eq!(fmt_duration(245), "4m05s");
        assert_eq!(fmt_duration(3 * 3600 + 12 * 60), "3h12m");
        assert_eq!(fmt_duration(2 * 86400 + 3600), "2d1h");
    }
}
