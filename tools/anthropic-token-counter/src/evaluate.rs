//! How good an estimate is: grouped cross-validation (every sample of one source file stays in one fold, so a file
//! never helps predict itself), and error measures that say what a user of the estimate cares about.

use crate::corpus::fnv1a;
use crate::fit::{nnls_relative, predict, Fit};

pub const FOLDS: usize = 5;
pub const RIDGE: f64 = 1e-6;
/// Text is assumed to cost one token per this many characters by the plainest rule of thumb.
pub const CHARS_PER_TOKEN_RULE: f64 = 4.0;
const MEDIAN_AT: f64 = 0.5;
const P90_AT: f64 = 0.9;

#[derive(Debug, Clone)]
pub struct Row {
    pub kind: String,
    pub source: String,
    pub features: Vec<f64>,
    /// Tokens the local vocabulary makes of the text, when a vocabulary was given.
    pub vocab: Option<f64>,
    pub chars: f64,
    /// The counted tokens, with the message framing taken off.
    pub tokens: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    CharsOverFour,
    CharsAffine,
    VocabAffine,
    Features,
    FeaturesVocab,
}

pub const ALL: [Method; 5] = [Method::CharsOverFour, Method::CharsAffine, Method::VocabAffine, Method::Features, Method::FeaturesVocab];

impl Method {
    pub fn name(self) -> &'static str {
        match self {
            Method::CharsOverFour => "chars / 4",
            Method::CharsAffine => "chars, fitted",
            Method::VocabAffine => "Xenova vocabulary, fitted",
            Method::Features => "run counts, fitted",
            Method::FeaturesVocab => "run counts + Xenova, fitted",
        }
    }

    pub fn needs_vocab(self) -> bool {
        matches!(self, Method::VocabAffine | Method::FeaturesVocab)
    }

    /// What the fit is made from, per row; `None` for a method that fits nothing.
    pub fn inputs(self, row: &Row) -> Option<Vec<f64>> {
        match self {
            Method::CharsOverFour => None,
            Method::CharsAffine => Some(vec![row.chars]),
            Method::VocabAffine => row.vocab.map(|v| vec![v]),
            Method::Features => Some(row.features.clone()),
            Method::FeaturesVocab => row.vocab.map(|v| row.features.iter().copied().chain([v]).collect()),
        }
    }
}

pub fn fold_of(source: &str, folds: usize) -> usize {
    (fnv1a(source) % folds as u64) as usize
}

pub fn train(method: Method, rows: &[&Row]) -> Option<Fit> {
    let inputs: Vec<Vec<f64>> = rows.iter().filter_map(|r| method.inputs(r)).collect();
    if inputs.is_empty() {
        return None;
    }
    let y: Vec<f64> = rows.iter().map(|r| r.tokens).collect();
    Some(nnls_relative(&inputs, &y, RIDGE))
}

pub fn estimate(method: Method, fit: Option<&Fit>, row: &Row) -> Option<f64> {
    match (method, fit) {
        (Method::CharsOverFour, _) => Some(row.chars / CHARS_PER_TOKEN_RULE),
        (_, Some(fit)) => method.inputs(row).map(|x| predict(fit, &x)),
        _ => None,
    }
}

/// Each row's estimate when its fold was held out of the fit.
pub fn cross_validate(method: Method, rows: &[Row], folds: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; rows.len()];
    for fold in 0..folds {
        let training: Vec<&Row> = rows.iter().filter(|r| fold_of(&r.source, folds) != fold).collect();
        let fit = train(method, &training);
        for (i, r) in rows.iter().enumerate().filter(|(_, r)| fold_of(&r.source, folds) == fold) {
            out[i] = estimate(method, fit.as_ref(), r);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Metrics {
    pub n: usize,
    /// Median and 90th percentile of |estimate - true| as a percentage of the true count.
    pub median_abs_pct: f64,
    pub p90_abs_pct: f64,
    /// Sum of estimates over sum of true counts, minus one, as a percentage: what a long text's total is off by.
    pub bias_pct: f64,
}

pub fn metrics(pairs: &[(f64, f64)]) -> Option<Metrics> {
    if pairs.is_empty() {
        return None;
    }
    let mut errs: Vec<f64> = pairs.iter().map(|(e, t)| (e - t).abs() / t * 100.0).collect();
    errs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |q: f64| errs[((errs.len() - 1) as f64 * q).round() as usize];
    let (est, truth): (f64, f64) = pairs.iter().fold((0.0, 0.0), |(a, b), (e, t)| (a + e, b + t));
    Some(Metrics { n: pairs.len(), median_abs_pct: at(MEDIAN_AT), p90_abs_pct: at(P90_AT), bias_pct: (est / truth - 1.0) * 100.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(kind: &str, source: &str, chars: f64, tokens: f64) -> Row {
        Row { kind: kind.into(), source: source.into(), features: vec![chars, 1.0], vocab: Some(tokens), chars, tokens }
    }

    #[test]
    fn metrics_state_the_median_the_tail_and_the_bias() {
        // errors 0%, 10%, 20%, 30%, 40%; estimates run high by 20% in total
        let pairs = [(100.0, 100.0), (110.0, 100.0), (120.0, 100.0), (130.0, 100.0), (140.0, 100.0)];
        let m = metrics(&pairs).unwrap();
        assert_eq!(m.n, 5);
        assert!((m.median_abs_pct - 20.0).abs() < 1e-9);
        assert!((m.p90_abs_pct - 40.0).abs() < 1e-9);
        assert!((m.bias_pct - 20.0).abs() < 1e-9);
    }

    #[test]
    fn errors_that_cancel_leave_the_bias_at_zero_but_not_the_median() {
        let m = metrics(&[(90.0, 100.0), (110.0, 100.0)]).unwrap();
        assert!(m.bias_pct.abs() < 1e-9);
        assert!((m.median_abs_pct - 10.0).abs() < 1e-9);
    }

    #[test]
    fn no_pairs_have_no_metrics() {
        assert_eq!(metrics(&[]), None);
    }

    #[test]
    fn every_sample_of_a_source_lands_in_one_fold() {
        assert_eq!(fold_of("a/b.rs", FOLDS), fold_of("a/b.rs", FOLDS));
        assert!(fold_of("a/b.rs", FOLDS) < FOLDS);
    }

    #[test]
    fn cross_validation_never_trains_on_the_fold_it_predicts() {
        // Each source has a different ratio; a fit that had seen its own source would be exact. One that had not cannot be.
        let rows: Vec<Row> = (0..40).map(|i| row("k", &format!("src{i}"), 1000.0, 200.0 + 10.0 * i as f64)).collect();
        let predicted = cross_validate(Method::CharsAffine, &rows, FOLDS);
        assert!(rows.iter().zip(&predicted).any(|(r, p)| (p.unwrap() - r.tokens).abs() > 1.0));
    }

    #[test]
    fn a_relation_that_holds_everywhere_is_recovered_on_held_out_folds() {
        let rows: Vec<Row> = (0..60).map(|i| row("k", &format!("src{i}"), 500.0 + 37.0 * i as f64, 0.0)).map(|mut r| { r.tokens = 0.3 * r.chars + 4.0; r }).collect();
        let predicted = cross_validate(Method::CharsAffine, &rows, FOLDS);
        for (r, p) in rows.iter().zip(predicted) {
            assert!((p.unwrap() - r.tokens).abs() / r.tokens < 0.02, "{} vs {}", p.unwrap(), r.tokens);
        }
    }

    #[test]
    fn the_rule_of_thumb_needs_no_training() {
        let r = row("k", "s", 400.0, 1.0);
        assert_eq!(estimate(Method::CharsOverFour, None, &r), Some(100.0));
    }

    #[test]
    fn a_vocabulary_method_has_no_estimate_for_a_row_without_a_vocabulary_count() {
        let mut r = row("k", "s", 400.0, 1.0);
        r.vocab = None;
        let fit = Fit { intercept: 0.0, coef: vec![1.0] };
        assert_eq!(estimate(Method::VocabAffine, Some(&fit), &r), None);
    }
}
