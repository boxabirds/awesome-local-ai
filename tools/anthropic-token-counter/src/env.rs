//! Reads one variable from a `.env` file. The value is returned to the caller and never printed here.

use anyhow::{Context, Result};
use std::path::Path;

const EXPORT_PREFIX: &str = "export ";

pub fn read_var(path: &Path, name: &str) -> Result<String> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    parse_var(&text, name).with_context(|| format!("{name} is not set in {}", path.display()))
}

pub fn parse_var(text: &str, name: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let line = line.trim();
        let line = line.strip_prefix(EXPORT_PREFIX).unwrap_or(line);
        let (key, value) = line.split_once('=')?;
        if key.trim() != name {
            return None;
        }
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_assignment_is_found() {
        assert_eq!(parse_var("A=1\nKEY=abc\nB=2\n", "KEY").as_deref(), Some("abc"));
    }

    #[test]
    fn quotes_and_an_export_prefix_are_removed() {
        assert_eq!(parse_var("export KEY=\"abc\"\n", "KEY").as_deref(), Some("abc"));
        assert_eq!(parse_var("KEY='abc'\n", "KEY").as_deref(), Some("abc"));
    }

    #[test]
    fn a_comment_or_a_longer_name_is_not_the_variable() {
        assert_eq!(parse_var("# KEY=nope\nKEY_2=other\n", "KEY"), None);
    }

    #[test]
    fn an_empty_value_is_not_a_value() {
        assert_eq!(parse_var("KEY=\n", "KEY"), None);
    }

    #[test]
    fn a_missing_file_names_the_path() {
        let err = read_var(Path::new("/nonexistent/.env"), "KEY").unwrap_err();
        assert!(format!("{err:#}").contains("/nonexistent/.env"));
    }
}
