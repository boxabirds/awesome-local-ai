//! Layer 1: what a thinking block is like as text, from the text alone. Counts, ratios and overlaps: nothing here
//! judges the thinking (docs/designs/thinking-analytics.md has each definition).

use flate2::{write::GzEncoder, Compression};
use regex_lite::Regex;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::OnceLock;

/// A shingle is this many consecutive words.
pub const SHINGLE_WORDS: usize = 5;
/// A line is counted for `max_line_repeat` from this many characters.
pub const MIN_LINE_CHARS: usize = 20;
/// The fence that opens and closes a code block.
const FENCE: &str = "```";
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

pub type Shingles = HashSet<u64>;

/// The features of one block, from its own text.
#[derive(Debug, Clone, PartialEq)]
pub struct TextFeatures {
    pub chars: i64,
    pub words: i64,
    pub lines: i64,
    /// gzip bytes over text bytes; low is repetitive. None for an empty text.
    pub gzip_ratio: Option<f64>,
    /// Share of word 5-grams that repeat an earlier one in the block. None under SHINGLE_WORDS words.
    pub repeat5: Option<f64>,
    /// The most times one trimmed line of MIN_LINE_CHARS or more recurs; 0 when no line is that long.
    pub max_line_repeat: i64,
    pub n_wait: i64,
    pub n_hmm: i64,
    pub n_actually: i64,
    /// "but wait": a subset of n_wait.
    pub n_but_wait: i64,
    pub n_alternatively: i64,
    pub n_verify: i64,
    /// Share of characters on the lines between code fences.
    pub code_share: f64,
}

/// The lower-cased words of a text with their edge punctuation removed; a token with no letter or digit is dropped.
pub fn words_of(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

fn fnv(words: &[String]) -> u64 {
    let mut h = FNV_OFFSET;
    for w in words {
        for b in w.bytes().chain(std::iter::once(b' ')) {
            h ^= u64::from(b);
            h = h.wrapping_mul(FNV_PRIME);
        }
    }
    h
}

/// The hashed word 5-grams of a word list, in order (with repeats).
fn grams(words: &[String]) -> Vec<u64> {
    words.windows(SHINGLE_WORDS).map(fnv).collect()
}

/// The set of a text's word 5-grams.
pub fn shingles(text: &str) -> Shingles {
    grams(&words_of(text)).into_iter().collect()
}

/// The share of `block`'s shingles that `other` also holds; None for an empty block.
pub fn overlap(block: &Shingles, other: &Shingles) -> Option<f64> {
    (!block.is_empty()).then(|| block.iter().filter(|s| other.contains(s)).count() as f64 / block.len() as f64)
}

/// Jaccard similarity; None when both are empty.
pub fn jaccard(a: &Shingles, b: &Shingles) -> Option<f64> {
    let union = a.union(b).count();
    (union > 0).then(|| a.intersection(b).count() as f64 / union as f64)
}

fn verify_phrases() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\blet me (?:check|verify|re-?\w+)\b|\bdouble[- ]check").expect("verify phrases"))
}

fn gzip_ratio(text: &str) -> Option<f64> {
    if text.is_empty() {
        return None;
    }
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(text.as_bytes()).ok()?;
    let packed = enc.finish().ok()?;
    Some(packed.len() as f64 / text.len() as f64)
}

fn code_share(text: &str) -> f64 {
    let total = text.chars().count();
    if total == 0 {
        return 0.0;
    }
    let mut inside = false;
    let mut code = 0usize;
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with(FENCE) {
            inside = !inside;
        } else if inside {
            code += line.chars().count();
        }
    }
    code as f64 / total as f64
}

fn max_line_repeat(text: &str) -> i64 {
    let mut seen: HashMap<&str, i64> = HashMap::new();
    for line in text.lines().map(str::trim).filter(|l| l.chars().count() >= MIN_LINE_CHARS) {
        *seen.entry(line).or_insert(0) += 1;
    }
    seen.values().copied().max().unwrap_or(0)
}

pub fn text_features(text: &str) -> TextFeatures {
    let words = words_of(text);
    let g = grams(&words);
    let distinct: Shingles = g.iter().copied().collect();
    let count = |pred: &dyn Fn(&str) -> bool| words.iter().filter(|w| pred(w)).count() as i64;
    TextFeatures {
        chars: text.chars().count() as i64,
        words: words.len() as i64,
        lines: text.lines().count() as i64,
        gzip_ratio: gzip_ratio(text),
        repeat5: (!g.is_empty()).then(|| 1.0 - distinct.len() as f64 / g.len() as f64),
        max_line_repeat: max_line_repeat(text),
        n_wait: count(&|w| w == "wait"),
        n_hmm: count(&|w| w.starts_with("hmm")),
        n_actually: count(&|w| w == "actually"),
        n_but_wait: words.windows(2).filter(|p| p[0] == "but" && p[1] == "wait").count() as i64,
        n_alternatively: count(&|w| w == "alternatively"),
        n_verify: verify_phrases().find_iter(text).count() as i64,
        code_share: code_share(text),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PARA: &str = "the quick brown fox jumps over the lazy dog while the cat watches from the old stone wall";

    #[test]
    fn counts_characters_words_and_lines_not_bytes() {
        let f = text_features("héllo wörld\nsecond line");
        assert_eq!((f.chars, f.words, f.lines), (23, 4, 2));
    }

    #[test]
    fn a_repeated_paragraph_compresses_and_repeats_where_a_novel_one_does_not() {
        let novel = text_features(PARA);
        let repeated = text_features(&vec![PARA; 20].join(" "));
        assert!(repeated.gzip_ratio.unwrap() < novel.gzip_ratio.unwrap() / 3.0);
        assert_eq!(novel.repeat5, Some(0.0));
        assert!(repeated.repeat5.unwrap() > 0.9, "{:?}", repeated.repeat5);
    }

    #[test]
    fn repeat5_is_one_minus_distinct_over_total_five_grams() {
        // 8 words, 4 five-grams: "a b c d e", "b c d e a"... a cycle of 4 words repeats from the 5th five-gram on.
        let f = text_features("a b c d a b c d a b c d");
        // 8 five-grams, 4 distinct (the cycle's four rotations): 1 - 4/8.
        assert_eq!(f.repeat5, Some(0.5));
        assert_eq!(text_features("one two three four").repeat5, None);
    }

    #[test]
    fn the_most_a_long_line_recurs() {
        let f = text_features("a short one\nthis line is long enough to count\nthis line is long enough to count\n  this line is long enough to count  \nanother line that is long enough");
        assert_eq!(f.max_line_repeat, 3);
        assert_eq!(text_features("short\nshort").max_line_repeat, 0);
    }

    #[test]
    fn reflection_markers_are_whole_words_in_any_case() {
        let f = text_features("Wait, that is wrong. But wait! Hmm, hmmm. Actually it works. Alternatively, try X. Waiting is not wait-ing... awaited");
        assert_eq!(f.n_wait, 2); // "Wait," and the wait of "But wait!": not "Waiting", "wait-ing" or "awaited"
        assert_eq!(f.n_but_wait, 1);
        assert_eq!(f.n_hmm, 2);
        assert_eq!(f.n_actually, 1);
        assert_eq!(f.n_alternatively, 1);
    }

    #[test]
    fn verification_phrases() {
        let f = text_features("Let me check the file. let me verify it. I should double-check, and Double check again. Let me rerun it. Let me re-read. Let me write it.");
        assert_eq!(f.n_verify, 6); // check, verify, double-check, Double check, rerun, re-read; not "Let me write"
    }

    #[test]
    fn code_share_is_the_characters_between_fences_over_all() {
        let text = "intro\n```\nlet x = 1;\n```\nafter";
        let f = text_features(text);
        assert_eq!(f.code_share, "let x = 1;\n".chars().count() as f64 / text.chars().count() as f64);
        assert_eq!(text_features("no code here").code_share, 0.0);
        // An unclosed fence runs to the end.
        assert!(text_features("a\n```\nxx\nyy").code_share > 0.3);
    }

    #[test]
    fn overlap_is_the_share_of_the_blocks_shingles_the_other_holds() {
        let task = shingles("implement the board so that people can pan and zoom around an infinite canvas");
        let block = shingles("implement the board so that people can pan and zoom and then something unrelated entirely different here today");
        let o = overlap(&block, &task).unwrap();
        // the block's 5-grams that start within the shared run: "implement the board so that" ... "can pan and zoom and" is not shared.
        assert!(o > 0.2 && o < 0.7, "{o}");
        assert_eq!(overlap(&Shingles::new(), &task), None);
        assert_eq!(overlap(&block, &block), Some(1.0));
    }

    #[test]
    fn jaccard_of_identical_disjoint_and_empty_blocks() {
        let a = shingles(PARA);
        assert_eq!(jaccard(&a, &a), Some(1.0));
        assert_eq!(jaccard(&a, &shingles("completely different words that share no five gram with the other one at all")), Some(0.0));
        assert_eq!(jaccard(&Shingles::new(), &Shingles::new()), None);
    }

    #[test]
    fn punctuation_and_case_do_not_change_a_shingle() {
        assert_eq!(shingles("The Quick, brown fox; jumps!"), shingles("the quick brown fox jumps"));
    }
}
