"""Layer A of the classifier plan (docs/research/20261003-thinking-optimisation-plan.md): how many universal function classes do the
paragraphs support? NMF on cross-story vocabulary (topics_function.py), for several numbers of classes k. Per k, two stabilities:
across seeds (same data, different starts) and across stories (a model fitted on half the stories and one fitted on the other half
each assign every paragraph; how often do the two agree on its strongest class, as an adjusted Rand index). A good k is stable on
both. Writes one line per k.

Usage: uv run --with scikit-learn --with numpy --with scipy python function_classes.py PARAS.pkl
"""
import pickle, re, sys, time
import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.decomposition import NMF
from sklearn.metrics import adjusted_rand_score
from sklearn.preprocessing import normalize
import topics_function as tf

KS = (6, 8, 10, 12, 14)
SEEDS = (0, 1, 2)
HALF_A = {1, 3, 5, 8, 10, 12}          # the other half is the rest of the stories
ITER = dict(init="random", max_iter=250, tol=1e-4)

def fit(X, k, seed):
    m = NMF(k, random_state=seed, **ITER)
    W = m.fit_transform(X)
    return m, W

def matched_cosine(Ha, Hb):
    cos = normalize(Ha) @ normalize(Hb).T
    r, c = linear_sum_assignment(-cos)
    return float(cos[r, c].mean())

def main(paras_pkl):
    rows = pickle.load(open(paras_pkl, "rb"))
    docs = [r[3] for r in rows]
    story = np.array([int(tf.STORY.search(r[0]).group(1)) for r in rows])
    X, _ = tf.tfidf(docs, story)
    in_a = np.array([s in HALF_A for s in story])
    print(f"{X.shape[0]} paragraphs, {X.shape[1]} cross-story terms; half A {in_a.sum()} paragraphs, half B {(~in_a).sum()}", flush=True)
    print("k   seed-matched-cosine  seed-ARI(strongest)  story-halves-ARI  story-halves-matched-cosine   strongest-weight-median", flush=True)
    for k in KS:
        t0 = time.time()
        fits = [fit(X, k, s) for s in SEEDS]
        cos = np.mean([matched_cosine(fits[a][0].components_, fits[b][0].components_) for a in range(3) for b in range(a + 1, 3)])
        ari = np.mean([adjusted_rand_score(fits[a][1].argmax(1), fits[b][1].argmax(1)) for a in range(3) for b in range(a + 1, 3)])
        ma, _ = fit(X[in_a], k, 0)
        mb, _ = fit(X[~in_a], k, 0)
        Wa, Wb = ma.transform(X), mb.transform(X)
        half_ari = adjusted_rand_score(Wa.argmax(1), Wb.argmax(1))
        half_cos = matched_cosine(ma.components_, mb.components_)
        share = fits[0][1] / np.maximum(fits[0][1].sum(1, keepdims=True), 1e-9)
        print(f"{k:<3} {cos:19.3f}  {ari:19.3f}  {half_ari:16.3f}  {half_cos:27.3f}   {np.median(share.max(1)):.2f}   ({time.time() - t0:.0f} s)", flush=True)

if __name__ == "__main__":
    main(sys.argv[1])
