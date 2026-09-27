//! The stories in scope, in journey order, each as the user sees it: what it's for, the golden path
//! to follow in every build, the named requirements to check, and what it must NOT do. Read from
//! the private pack's scope file and each story's prd.md.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Requirement {
    pub anchor: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Story {
    pub id: u64,
    pub title: String,
    pub summary: String,
    pub golden_path: Vec<String>,
    pub requirements: Vec<Requirement>,
    pub non_behaviours: Vec<String>,
}

/// "002-capture-ideas-on-sticky-notes-and-rearrange-them" -> "Capture ideas on sticky notes and rearrange them"
fn title_from_dir(dir: &str) -> String {
    let words = dir.split_once('-').map(|(_, rest)| rest).unwrap_or(dir).replace('-', " ");
    let mut c = words.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// The parts of a PRD a reviewer needs, from its markdown.
pub fn parse_prd(text: &str) -> Story {
    let mut story = Story::default();
    let mut section = String::new(); // the current "##" or "###" heading
    let mut last_h2 = String::new();
    let mut in_intro = false;
    for line in text.lines() {
        let t = line.trim();
        if let Some(h) = t.strip_prefix("### ") {
            section = h.trim().to_lowercase();
            continue;
        }
        if let Some(h) = t.strip_prefix("## ") {
            section = h.trim().to_lowercase();
            last_h2 = h.trim().to_string();
            in_intro = false;
            continue;
        }
        if t.starts_with("# ") {
            in_intro = true;
            continue;
        }
        if in_intro && !t.is_empty() && story.summary.is_empty() {
            story.summary = t.to_string();
            continue;
        }
        if let Some(a) = t.strip_prefix("> Anchor:") {
            let anchor = a.trim().trim_matches('`').to_string();
            story.requirements.push(Requirement { anchor, title: last_h2.clone() });
            continue;
        }
        if section == "golden path" {
            if let Some((num, rest)) = t.split_once(". ") {
                if !num.is_empty() && num.chars().all(|c| c.is_ascii_digit()) {
                    story.golden_path.push(rest.to_string());
                }
            }
        } else if section == "explicit non-behaviours" {
            if let Some(rest) = t.strip_prefix("- ") {
                story.non_behaviours.push(rest.to_string());
            }
        }
    }
    story
}

/// The stories of a scope in the order the scope lists them (the user journey).
pub fn load(pack: &Path, scope: &str) -> Vec<Story> {
    let scope_file = pack.join("scope").join(format!("{scope}.json"));
    let Some(doc) = std::fs::read_to_string(&scope_file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return Vec::new();
    };
    doc.get("stories")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|s| {
                    let id = s.get("id")?.as_u64()?;
                    let dir = s.get("dir")?.as_str()?;
                    let prd = std::fs::read_to_string(pack.join("spec/stories").join(dir).join("prd.md")).unwrap_or_default();
                    let mut story = parse_prd(&prd);
                    story.id = id;
                    let heading = std::fs::read_to_string(pack.join("spec/stories").join(dir).join("story.md"))
                        .ok()
                        .and_then(|t| t.lines().find_map(|l| l.strip_prefix("# ").map(|h| h.trim().to_string())));
                    story.title = s
                        .get("title")
                        .and_then(Value::as_str)
                        .map(String::from) // the scope can rename a story for the review
                        .or(heading)
                        .unwrap_or_else(|| title_from_dir(dir)); // dir names are cut at ~50 chars
                    Some(story)
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRD: &str = "# PRD\n\nUsers can create sticky notes.\n\n## Problem\n\nNothing.\n\n## User Experience\n\n### Golden path\n1. User double-clicks empty board space.\n2. User types \"Faster onboarding\".\n\n### Explicit non-behaviours\n- No rich text.\n- No note-to-note links.\n\n## Create by double-click\n\n> Anchor: `sticky.create_dblclick`\n\nText.\n\n## Delete a note\n\n> Anchor: `sticky.delete`\n";

    #[test]
    fn a_prd_gives_summary_golden_path_requirements_and_non_behaviours() {
        let s = parse_prd(PRD);
        assert_eq!(s.summary, "Users can create sticky notes.");
        assert_eq!(s.golden_path, vec!["User double-clicks empty board space.", "User types \"Faster onboarding\"."]);
        assert_eq!(s.non_behaviours, vec!["No rich text.", "No note-to-note links."]);
        assert_eq!(s.requirements, vec![
            Requirement { anchor: "sticky.create_dblclick".into(), title: "Create by double-click".into() },
            Requirement { anchor: "sticky.delete".into(), title: "Delete a note".into() },
        ]);
    }

    #[test]
    fn titles_come_from_the_story_directory() {
        assert_eq!(title_from_dir("002-capture-ideas-on-sticky-notes"), "Capture ideas on sticky notes");
    }

    #[test]
    fn the_real_pack_loads_in_journey_order_when_present() {
        let pack = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../awesome-local-ai-bench-private/packs/vidi");
        if !pack.is_dir() {
            return; // the private pack isn't cloned next to this checkout
        }
        let stories = load(&pack, "canvas");
        assert_eq!(stories.iter().map(|s| s.id).collect::<Vec<_>>(), vec![1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
        assert!(stories.iter().all(|s| !s.golden_path.is_empty() && !s.requirements.is_empty()));
        assert_eq!(stories[2].title, "See other people's edits appear live on the same board"); // not the cut dir name
    }
}
