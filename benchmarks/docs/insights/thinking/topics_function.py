"""The softer method for the themes of thinking: non-negative matrix factorisation of the same cross-story TF-IDF as
cluster_function.py. Each paragraph becomes a mixture over topics, not one label. Stability across seeds is measured
two ways: topics matched one to one by the cosine of their term weights (the matching that makes the best total), and
the agreement of the paragraphs' strongest topic (adjusted Rand), to set against k-means.

Usage: uv run --with scikit-learn --with numpy --with scipy python topics_function.py PARAS.pkl OUT_DIR K
"""
import json, os, pickle, re, sys
import numpy as np
import scipy.sparse as sp
from scipy.optimize import linear_sum_assignment
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import adjusted_rand_score
from sklearn.preprocessing import normalize

MIN_DF, MAX_DF, MIN_STORIES, MIN_DF_PER_STORY = 25, 0.30, 10, 8
SEEDS = (0, 1, 2)
TOP_TERMS = 12
NEAREST = 5
EXCERPT = 360
STORY = re.compile(r"/stories/(\d+)$")

def fit_vocabulary(docs, story):
    """The fitted vectoriser and the indices of its terms that occur across the stories."""
    vec = TfidfVectorizer(lowercase=True, token_pattern=r"[A-Za-z][A-Za-z']{1,}", ngram_range=(1, 2), min_df=MIN_DF, max_df=MAX_DF,
                          sublinear_tf=True, max_features=80000, dtype=np.float32)
    X = vec.fit_transform(docs)
    ids = sorted(set(story)); sidx = {s: i for i, s in enumerate(ids)}
    S = sp.csr_matrix((np.ones(len(docs)), (np.arange(len(docs)), [sidx[s] for s in story])), shape=(len(docs), len(ids)))
    per_story = ((X > 0).astype(np.float32).T @ S).toarray()
    return vec, np.where((per_story >= MIN_DF_PER_STORY).sum(1) >= MIN_STORIES)[0]

def tfidf(docs, story):
    vec, keep = fit_vocabulary(docs, story)
    return normalize(vec.transform(docs)[:, keep]), np.array(vec.get_feature_names_out())[keep]

def main(paras_pkl, out_dir, k):
    rows = pickle.load(open(paras_pkl, "rb"))
    docs = [r[3] for r in rows]
    story = np.array([int(STORY.search(r[0]).group(1)) for r in rows])
    X, terms = tfidf(docs, story)
    fits = []
    for seed in SEEDS:
        m = NMF(k, init="random", random_state=seed, max_iter=300, tol=1e-4)
        W = m.fit_transform(X); fits.append((W, m.components_))
        print(f"seed {seed}: reconstruction error {m.reconstruction_err_:.2f}", flush=True)
    sims = []
    for a in range(len(SEEDS)):
        for b in range(a + 1, len(SEEDS)):
            cos = normalize(fits[a][1]) @ normalize(fits[b][1]).T
            r, c = linear_sum_assignment(-cos)
            sims.append(float(cos[r, c].mean()))
    ari = [adjusted_rand_score(fits[a][0].argmax(1), fits[b][0].argmax(1)) for a in range(len(SEEDS)) for b in range(a + 1, len(SEEDS))]
    print(f"topic matching (mean cosine of matched topics) {np.round(sims, 3).tolist()}; argmax ARI {np.round(ari, 3).tolist()}", flush=True)
    W, H = fits[0]
    share = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    top = share.max(1)
    print(f"strongest topic's weight in a paragraph: median {np.median(top):.2f}, share of paragraphs where it exceeds 0.5: {(top > 0.5).mean():.0%}")
    out = []
    for t in range(k):
        o = np.argsort(-share[:, t])[:NEAREST]
        out.append({"topic": t, "terms": terms[H[t].argsort()[::-1][:TOP_TERMS]].tolist(), "mass": round(float(W[:, t].sum() / W.sum()), 4),
                    "nearest": [{"rel": rows[i][0], "idx": rows[i][1], "para": rows[i][2], "text": docs[i][:EXCERPT]} for i in o]})
    out.sort(key=lambda d: -d["mass"])
    os.makedirs(out_dir, exist_ok=True)
    json.dump({"k": k, "topic_matching": sims, "ari": ari, "topics": out}, open(f"{out_dir}/topics_k{k}.json", "w"), indent=1)
    np.save(f"{out_dir}/topic_weights_k{k}.npy", share.astype(np.float32))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]))
