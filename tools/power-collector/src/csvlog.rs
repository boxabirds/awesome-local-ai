//! One CSV per source per UTC day: `<out>/<source>-YYYY-MM-DD.csv`, header `ts_utc,<fields>`.
//! A day's file keeps the columns it was started with.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::sources::Values;

const MS_PER_S: f64 = 1000.0;

pub fn iso_ms(t: f64) -> String {
    chrono::DateTime::from_timestamp_millis((t * MS_PER_S).round() as i64)
        .map(|d| d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default()
}

fn day(t: f64) -> String {
    chrono::DateTime::from_timestamp_millis((t * MS_PER_S).round() as i64)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

#[derive(Default)]
pub struct CsvLog {
    headers: HashMap<PathBuf, Vec<String>>,
}

impl CsvLog {
    pub fn write(&mut self, out: &Path, source: &str, t: f64, values: &Values) -> std::io::Result<()> {
        let path = out.join(format!("{source}-{}.csv", day(t)));
        let header = match self.headers.get(&path) {
            Some(h) => h.clone(),
            None => {
                let existing = std::fs::read_to_string(&path).ok().and_then(|s| {
                    s.lines().next().map(|l| l.split(',').skip(1).map(String::from).collect::<Vec<_>>())
                });
                match existing.filter(|h| !h.is_empty()) {
                    Some(h) => h,
                    None => {
                        let h: Vec<String> = values.iter().map(|(k, _)| k.clone()).collect();
                        std::fs::write(&path, format!("ts_utc,{}\n", h.join(",")))?;
                        h
                    }
                }
            }
        };
        let by_key: HashMap<&str, Option<f64>> = values.iter().map(|(k, v)| (k.as_str(), *v)).collect();
        let cells: Vec<String> = header
            .iter()
            .map(|k| by_key.get(k.as_str()).copied().flatten().map(|v| v.to_string()).unwrap_or_default())
            .collect();
        let mut f = OpenOptions::new().append(true).open(&path)?;
        writeln!(f, "{},{}", iso_ms(t), cells.join(","))?;
        self.headers.insert(path, header);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: f64 = 1_790_000_000.0; // 2026-09-21T14:13:20Z
    const INTERVAL_S: f64 = 2.0;

    #[test]
    fn each_source_gets_one_csv_per_utc_day() {
        let dir = std::env::temp_dir().join(format!("power-collector-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut log = CsvLog::default();
        let v: Values = vec![("system_w".into(), Some(50.0)), ("on_ac".into(), Some(1.0))];
        log.write(&dir, "mac", T0, &v).unwrap();
        log.write(&dir, "mac", T0 + INTERVAL_S, &v).unwrap();
        let text = std::fs::read_to_string(dir.join("mac-2026-09-21.csv")).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(
            text.lines().collect::<Vec<_>>(),
            vec!["ts_utc,system_w,on_ac", "2026-09-21T14:13:20.000Z,50,1", "2026-09-21T14:13:22.000Z,50,1"]
        );
    }
}
