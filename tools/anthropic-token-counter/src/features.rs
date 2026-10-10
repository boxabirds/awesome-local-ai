//! Counts that a token count can be fitted from. A text is cut into the runs a byte-pair tokenizer sees first
//! (words, digit runs, punctuation, indentation, newlines) and the runs are counted by kind and length: a long word
//! costs more tokens than a short one, and code spends more on punctuation and indentation than prose does.

/// Upper edge of each bucket of ASCII word lengths (a word longer than the last edge falls in a final bucket).
pub const WORD_EDGES: [usize; 8] = [1, 2, 3, 4, 6, 8, 12, 20];
pub const DIGIT_EDGES: [usize; 4] = [1, 2, 3, 6];
pub const INDENT_EDGES: [usize; 2] = [3, 7];

/// Names of the features, in the order `features` returns them.
pub fn names() -> Vec<String> {
    let mut out = Vec::new();
    out.extend(bucket_names("word", &WORD_EDGES));
    out.extend(bucket_names("digits", &DIGIT_EDGES));
    out.extend(bucket_names("indent", &INDENT_EDGES));
    out.extend(
        ["punct_chars", "punct_runs", "single_spaces", "newlines", "camel_humps", "underscores", "non_ascii_letters", "non_ascii_other"]
            .map(String::from),
    );
    out
}

fn bucket_names(prefix: &str, edges: &[usize]) -> Vec<String> {
    let mut out: Vec<String> = edges.iter().map(|e| format!("{prefix}_le{e}")).collect();
    out.push(format!("{prefix}_gt{}", edges[edges.len() - 1]));
    out
}

/// Index of the bucket a length falls in: the first edge at or above it, else the overflow bucket.
fn bucket(len: usize, edges: &[usize]) -> usize {
    edges.iter().position(|e| len <= *e).unwrap_or(edges.len())
}

pub fn features(text: &str) -> Vec<f64> {
    let words_at = 0;
    let digits_at = words_at + WORD_EDGES.len() + 1;
    let indent_at = digits_at + DIGIT_EDGES.len() + 1;
    let scalars_at = indent_at + INDENT_EDGES.len() + 1;
    let [punct_chars, punct_runs, single_spaces, newlines, camel_humps, underscores, non_ascii_letters, non_ascii_other] =
        std::array::from_fn(|i| scalars_at + i);
    let mut f = vec![0.0; names().len()];

    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let run_end = |same: fn(char) -> bool| (i..chars.len()).find(|j| !same(chars[*j])).unwrap_or(chars.len());
        if c.is_ascii_alphabetic() {
            let end = run_end(|c| c.is_ascii_alphabetic());
            f[words_at + bucket(end - i, &WORD_EDGES)] += 1.0;
            f[camel_humps] += chars[i..end].windows(2).filter(|w| w[0].is_ascii_lowercase() && w[1].is_ascii_uppercase()).count() as f64;
            i = end;
        } else if c.is_ascii_digit() {
            let end = run_end(|c| c.is_ascii_digit());
            f[digits_at + bucket(end - i, &DIGIT_EDGES)] += 1.0;
            i = end;
        } else if c == ' ' || c == '\t' {
            let end = run_end(|c| c == ' ' || c == '\t');
            if end - i == 1 {
                f[single_spaces] += 1.0;
            } else {
                f[indent_at + bucket(end - i, &INDENT_EDGES)] += 1.0;
            }
            i = end;
        } else if c == '\n' {
            f[newlines] += 1.0;
            i += 1;
        } else if c == '_' {
            f[underscores] += 1.0;
            i += 1;
        } else if c.is_ascii_punctuation() {
            let end = run_end(|c| c.is_ascii_punctuation() && c != '_');
            f[punct_chars] += (end - i) as f64;
            f[punct_runs] += 1.0;
            i = end;
        } else if !c.is_ascii() {
            f[if c.is_alphabetic() { non_ascii_letters } else { non_ascii_other }] += 1.0;
            i += 1;
        } else {
            i += 1; // a control character or a carriage return: no token of its own worth counting
        }
    }
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(text: &str) -> std::collections::BTreeMap<String, f64> {
        names().into_iter().zip(features(text)).filter(|(_, v)| *v != 0.0).collect()
    }

    #[test]
    fn there_is_one_value_per_name() {
        assert_eq!(features("anything").len(), names().len());
    }

    #[test]
    fn words_are_counted_by_length_bucket() {
        let f = named("a to the Hello extraordinarily");
        assert_eq!(f["word_le1"], 1.0);
        assert_eq!(f["word_le2"], 1.0);
        assert_eq!(f["word_le3"], 1.0);
        assert_eq!(f["word_le6"], 1.0);
        assert_eq!(f["word_le20"], 1.0);
        assert!(!f.contains_key("word_gt20"));
        assert_eq!(f["single_spaces"], 4.0);
    }

    #[test]
    fn digit_runs_are_counted_apart_from_words() {
        let f = named("v2 12345 7");
        assert_eq!(f["digits_le1"], 2.0);
        assert_eq!(f["digits_le6"], 1.0);
        assert_eq!(f["word_le1"], 1.0);
    }

    #[test]
    fn punctuation_counts_its_characters_and_its_runs() {
        let f = named("a => {};");
        assert_eq!(f["punct_chars"], 5.0);
        assert_eq!(f["punct_runs"], 2.0);
    }

    #[test]
    fn indentation_runs_and_newlines_are_counted() {
        let f = named("a\n    b\n        c\n");
        assert_eq!(f["newlines"], 3.0);
        assert_eq!(f["indent_le7"], 1.0);
        assert_eq!(f["indent_gt7"], 1.0);
    }

    #[test]
    fn camel_case_humps_and_underscores_are_counted() {
        let f = named("getUserName snake_case_name");
        assert_eq!(f["camel_humps"], 2.0);
        assert_eq!(f["underscores"], 2.0);
    }

    #[test]
    fn non_ascii_letters_and_other_characters_are_counted_apart() {
        let f = named("café 日本 🙂");
        assert_eq!(f["non_ascii_letters"], 3.0);
        assert_eq!(f["non_ascii_other"], 1.0);
    }

    #[test]
    fn empty_text_has_no_features() {
        assert!(named("").is_empty());
    }
}
