//! Novel filler text of a requested size. Every paragraph is different, so no prefix of one turn repeats in
//! another and the server cannot answer from a cache it did not make from the conversation itself.

/// A first guess at characters per token for this filler. The real figure is the server's tokenizer's, so a run
/// measures it first (`attempt::calibrate`): the guess of 3.7 gave 14k tokens where 20k were asked for.
pub const CHARS_PER_TOKEN: f64 = 3.7;
const WORDS_PER_PARAGRAPH: usize = 24;
const WORD_STRIDE: usize = 7;
const WORD_SKEW: usize = 13;

const VOCABULARY: [&str; 40] = [
    "kernel", "scheduler", "checkpoint", "publish", "restore", "decode", "prefill", "chunk", "buffer", "ledger",
    "retention", "manifest", "outcome", "graph", "worker", "stall", "queue", "device", "memory", "heap", "page",
    "table", "shard", "tensor", "draft", "accept", "verify", "stream", "batch", "width", "latency", "throughput",
    "budget", "reserve", "eviction", "session", "context", "token", "prefix", "boundary",
];

fn paragraph(index: usize) -> String {
    let words: Vec<&str> = (0..WORDS_PER_PARAGRAPH)
        .map(|k| VOCABULARY[(index * WORD_STRIDE + k * WORD_SKEW + k * k) % VOCABULARY.len()])
        .collect();
    format!("paragraph {index} about {} then {}: {}, section {index}.\n", words[0], words[1], words.join(" "))
}

/// About `tokens` tokens of text whose paragraphs are numbered from `first`, so two calls with ranges that do
/// not overlap share nothing.
pub fn fresh_text(first: usize, tokens: usize, chars_per_token: f64) -> String {
    let want = (tokens as f64 * chars_per_token) as usize;
    let mut text = String::with_capacity(want + 128);
    let mut index = first;
    while text.len() < want {
        text.push_str(&paragraph(index));
        index += 1;
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_is_about_the_size_asked_for() {
        let t = fresh_text(0, 20_000, CHARS_PER_TOKEN);
        let tokens = t.len() as f64 / CHARS_PER_TOKEN;
        assert!((20_000.0..20_100.0).contains(&tokens), "{tokens}");
    }

    #[test]
    fn turns_with_separate_paragraph_ranges_share_no_paragraph() {
        let a = fresh_text(0, 2_000, CHARS_PER_TOKEN);
        let b = fresh_text(10_000, 2_000, CHARS_PER_TOKEN);
        assert!(a.lines().all(|line| !b.contains(line)));
    }

    #[test]
    fn the_same_range_gives_the_same_text() {
        assert_eq!(fresh_text(5, 500, CHARS_PER_TOKEN), fresh_text(5, 500, CHARS_PER_TOKEN));
    }
}
