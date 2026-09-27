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
    /// Stories a user must go through first (all of them, transitively), in review order.
    pub prerequisites: Vec<u64>,
    /// The story whose build it is reviewed on: the latest-built of itself and its prerequisites.
    pub review_build: u64,
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

/// Review order and the build each story is reviewed on, from per-story prerequisites.
/// `build_order`: story ids in the order they were built. Prerequisites come first; otherwise
/// build order. Each story is reviewed on the build after the latest-built of itself and its
/// (transitive) prerequisites: you can't try a feature before the steps a user takes to reach it.
pub fn plan(build_order: &[u64], prereqs: &std::collections::BTreeMap<u64, Vec<u64>>) -> Vec<(u64, Vec<u64>, u64)> {
    let pos = |id: u64| build_order.iter().position(|&x| x == id).unwrap_or(usize::MAX);
    let closure = |id: u64| {
        let mut seen: Vec<u64> = Vec::new();
        let mut stack = prereqs.get(&id).cloned().unwrap_or_default();
        while let Some(p) = stack.pop() {
            if p != id && !seen.contains(&p) {
                seen.push(p);
                stack.extend(prereqs.get(&p).cloned().unwrap_or_default());
            }
        }
        seen
    };
    let mut done: Vec<u64> = Vec::new();
    let mut out = Vec::new();
    while done.len() < build_order.len() {
        // the earliest-built story whose prerequisites are all placed; a cycle falls back to build order
        let next = build_order
            .iter()
            .copied()
            .find(|id| !done.contains(id) && closure(*id).iter().all(|p| done.contains(p) || !build_order.contains(p)))
            .or_else(|| build_order.iter().copied().find(|id| !done.contains(id)))
            .expect("a story is left");
        let mut pre = closure(next);
        pre.retain(|p| build_order.contains(p));
        pre.sort_by_key(|p| done.iter().position(|d| d == p).unwrap_or(usize::MAX));
        let build = pre.iter().copied().chain([next]).max_by_key(|&s| pos(s)).unwrap_or(next);
        done.push(next);
        out.push((next, pre, build));
    }
    out
}

/// The stories of a scope for the story review: in journey order, each with its prerequisites and
/// review build, from `scope/<scope>-prerequisites.json` if the pack has one (vidi v1, whose story
/// numbers aren't the journey). Without it, story order is the journey and each story is reviewed
/// on its own build.
pub fn load_for_review(pack: &Path, scope: &str) -> Vec<Story> {
    let mut stories = load(pack, scope);
    let file = pack.join("scope").join(format!("{scope}-prerequisites.json"));
    let doc: Value = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let prereqs: std::collections::BTreeMap<u64, Vec<u64>> = doc
        .get("prerequisites")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.parse().ok()?, v.as_array()?.iter().filter_map(Value::as_u64).collect())))
                .collect()
        })
        .unwrap_or_default();
    let build_order: Vec<u64> = stories.iter().map(|s| s.id).collect();
    let mut ordered = Vec::new();
    for (id, pre, build) in plan(&build_order, &prereqs) {
        if let Some(i) = stories.iter().position(|s| s.id == id) {
            let mut s = stories.remove(i);
            if let Some(title) = doc.get("titles").and_then(|t| t.get(id.to_string())).and_then(Value::as_str) {
                s.title = title.to_string();
            }
            s.prerequisites = pre;
            s.review_build = build;
            ordered.push(s);
        }
    }
    ordered
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

    fn prereqs(pairs: &[(u64, &[u64])]) -> std::collections::BTreeMap<u64, Vec<u64>> {
        pairs.iter().map(|(k, v)| (*k, v.to_vec())).collect()
    }

    #[test]
    fn prerequisites_come_first_and_set_the_review_build() {
        // vidi v1: boards are created in story 5, after pan and zoom (1)
        let order = [1, 2, 3, 4, 5, 7];
        let p = prereqs(&[(1, &[5]), (2, &[5]), (3, &[5, 2]), (7, &[5, 2])]);
        let plan = plan(&order, &p);
        assert_eq!(plan.iter().map(|x| x.0).collect::<Vec<_>>(), vec![4, 5, 1, 2, 3, 7]);
        let get = |id| plan.iter().find(|x| x.0 == id).unwrap().clone();
        assert_eq!(get(1), (1, vec![5], 5)); // pan and zoom is reviewed on the build after story 5
        assert_eq!(get(3), (3, vec![5, 2], 5));
        assert_eq!(get(7), (7, vec![5, 2], 7)); // built after its prerequisites: its own build
        assert_eq!(get(4), (4, vec![], 4)); // no prerequisites listed: its own build, in build order
    }

    #[test]
    fn without_prerequisites_story_order_is_the_journey() {
        let plan = plan(&[1, 2, 3], &std::collections::BTreeMap::new());
        assert_eq!(plan, vec![(1, vec![], 1), (2, vec![], 2), (3, vec![], 3)]);
    }

    #[test]
    fn transitive_prerequisites_count() {
        let plan = plan(&[1, 2, 3], &prereqs(&[(1, &[3]), (3, &[2])]));
        assert_eq!(plan.iter().map(|x| x.0).collect::<Vec<_>>(), vec![2, 3, 1]);
        assert_eq!(plan[2], (1, vec![2, 3], 3));
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
        let review = load_for_review(&pack, "canvas");
        if pack.join("scope/canvas-prerequisites.json").is_file() {
            assert_eq!(review.iter().map(|s| s.id).collect::<Vec<_>>(), vec![5, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12]);
            assert_eq!(review[0].title, "Create a board, then share it");
            assert_eq!((review[1].id, review[1].review_build), (1, 5));
        }
    }
}
