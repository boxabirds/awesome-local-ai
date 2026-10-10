//! Non-negative least squares on relative error: the weights that make `intercept + coef . x` closest, as a
//! fraction of the true count, to the counted tokens. Relative error because a 200-character sample and a
//! 6,000-character one should matter alike; non-negative because no kind of run takes away tokens.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Fit {
    pub intercept: f64,
    pub coef: Vec<f64>,
}

/// Sweeps of coordinate descent at most, and the change in any weight below which it has settled.
const MAX_SWEEPS: usize = 100_000;
const SETTLED: f64 = 1e-13;

pub fn predict(fit: &Fit, x: &[f64]) -> f64 {
    fit.intercept + fit.coef.iter().zip(x).map(|(w, v)| w * v).sum::<f64>()
}

/// `rows[i]` are the features of sample i and `y[i]` its true token count (> 0). `ridge` shrinks the weights a little.
pub fn nnls_relative(rows: &[Vec<f64>], y: &[f64], ridge: f64) -> Fit {
    let width = rows.first().map_or(0, Vec::len) + 1; // column 0 is the intercept
    // Each sample's row is divided by its count, and its target is then 1: a fraction-of-the-count error.
    let scaled: Vec<Vec<f64>> = rows
        .iter()
        .zip(y)
        .map(|(r, y)| std::iter::once(1.0).chain(r.iter().copied()).map(|v| v / y).collect())
        .collect();
    let mut gram = vec![vec![0.0; width]; width];
    let mut target = vec![0.0; width];
    for r in &scaled {
        for a in 0..width {
            target[a] += r[a];
            for b in 0..width {
                gram[a][b] += r[a] * r[b];
            }
        }
    }
    for (a, row) in gram.iter_mut().enumerate() {
        row[a] += ridge;
    }
    let mut w = vec![0.0_f64; width];
    for _ in 0..MAX_SWEEPS {
        let mut moved = 0.0_f64;
        for a in 0..width {
            if gram[a][a] <= 0.0 {
                continue;
            }
            let others: f64 = (0..width).filter(|b| *b != a).map(|b| gram[a][b] * w[b]).sum();
            let next = ((target[a] - others) / gram[a][a]).max(0.0);
            moved = moved.max((next - w[a]).abs());
            w[a] = next;
        }
        if moved < SETTLED {
            break;
        }
    }
    Fit { intercept: w[0], coef: w[1..].to_vec() }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOLERANCE: f64 = 0.02;
    const SMALL_RIDGE: f64 = 1e-9;

    /// Deterministic spread of feature values without a random-number crate.
    fn rows(n: usize, width: usize) -> Vec<Vec<f64>> {
        (0..n).map(|i| (0..width).map(|j| (((i * 31 + j * 17 + 7) * 2654435761usize) % 97) as f64 + 1.0).collect()).collect()
    }

    fn truth(rows: &[Vec<f64>], intercept: f64, coef: &[f64]) -> Vec<f64> {
        rows.iter().map(|r| intercept + r.iter().zip(coef).map(|(a, b)| a * b).sum::<f64>()).collect()
    }

    #[test]
    fn known_weights_are_recovered_from_exact_counts() {
        let x = rows(200, 3);
        let y = truth(&x, 5.0, &[0.5, 1.5, 0.25]);
        let fit = nnls_relative(&x, &y, SMALL_RIDGE);
        for (got, want) in fit.coef.iter().zip([0.5, 1.5, 0.25]) {
            assert!((got - want).abs() / want < TOLERANCE, "{got} vs {want}");
        }
        assert!((fit.intercept - 5.0).abs() < 1.0, "intercept {}", fit.intercept);
    }

    #[test]
    fn predictions_follow_the_weights() {
        let fit = Fit { intercept: 2.0, coef: vec![1.0, 3.0] };
        assert_eq!(predict(&fit, &[4.0, 5.0]), 2.0 + 4.0 + 15.0);
    }

    #[test]
    fn no_weight_is_negative_even_when_the_data_pulls_one_down() {
        let x = rows(200, 2);
        let y = truth(&x, 400.0, &[1.0, -0.2]);
        let fit = nnls_relative(&x, &y, SMALL_RIDGE);
        assert!(fit.coef.iter().all(|c| *c >= 0.0) && fit.intercept >= 0.0, "{fit:?}");
    }

    #[test]
    fn a_feature_that_is_always_zero_gets_a_zero_weight_not_nan() {
        let mut x = rows(100, 2);
        for r in &mut x {
            r[1] = 0.0;
        }
        let y = truth(&x, 0.0, &[2.0, 0.0]);
        let fit = nnls_relative(&x, &y, SMALL_RIDGE);
        assert_eq!(fit.coef[1], 0.0);
        assert!(fit.coef[0].is_finite() && (fit.coef[0] - 2.0).abs() < TOLERANCE * 2.0);
    }

    #[test]
    fn small_and_large_samples_count_alike() {
        // Two groups that disagree about the weight: ordinary least squares would follow the large counts; relative
        // error splits the difference by ratio, so the fit lands between the two ratios, not on the large one.
        let mut x = Vec::new();
        let mut y = Vec::new();
        for i in 0..50 {
            x.push(vec![10.0 + i as f64]);
            y.push(2.0 * (10.0 + i as f64));
            x.push(vec![10_000.0 + 10.0 * i as f64]);
            y.push(3.0 * (10_000.0 + 10.0 * i as f64));
        }
        let fit = nnls_relative(&x, &y, SMALL_RIDGE);
        assert!(fit.coef[0] > 2.2 && fit.coef[0] < 2.8, "{}", fit.coef[0]);
    }
}
