"""Find what the model's thinking DOES, apart from what it is about. cluster_paragraphs.py clusters on all vocabulary
and finds both kinds of theme mixed: subject (zoom, sync, undo, storage), which mostly says which story it is, and
function (running tests, reading the spec, trying another approach). The spread the owner asks about is between runs
of the same story, so the themes wanted are the functional ones. Here the vocabulary is only terms that occur across
the stories (a term in fewer than MIN_STORIES of the story numbers is about a subject), plus a few structural features.

Usage: uv run --with scikit-learn --with numpy --with scipy python cluster_function.py PARAS.pkl OUT_DIR K
"""
import json, os, pickle, re, sys
import numpy as np
import scipy.sparse as sp
from sklearn.cluster import MiniBatchKMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import normalize

MIN_DF = 25
MAX_DF = 0.30
MIN_STORIES = 10        # of the 11 story numbers (1 to 5, 7 to 12): a term must be common in nearly all to be function
MIN_DF_PER_STORY = 8
SVD_DIM = 60
STRUCT_WEIGHT = 0.35
SEEDS = (0, 1, 2)
NEAREST = 6
EXCERPT = 360
SILHOUETTE_SAMPLE = 8000
STORY = re.compile(r"/stories/(\d+)$")

def structure(docs):
    f = []
    for d in docs:
        n = len(d)
        f.append([np.log(n), d.count("`") / n, sum(c.isdigit() for c in d) / n, d.count("?") / n * 100, float(bool(re.match(r"\s*(\d+[.)]|[-*])\s", d))), d.count("\n") / n * 100])
    a = np.array(f, dtype=np.float32)
    return (a - a.mean(0)) / (a.std(0) + 1e-6)

def main(paras_pkl, out_dir, k):
    rows = pickle.load(open(paras_pkl, "rb"))
    docs = [r[3] for r in rows]
    story = np.array([int(STORY.search(r[0]).group(1)) for r in rows])
    ids = sorted(set(story)); sidx = {s: i for i, s in enumerate(ids)}
    vec = TfidfVectorizer(lowercase=True, token_pattern=r"[A-Za-z][A-Za-z']{1,}", ngram_range=(1, 2), min_df=MIN_DF, max_df=MAX_DF,
                          sublinear_tf=True, max_features=80000, dtype=np.float32)
    X = vec.fit_transform(docs)
    S = sp.csr_matrix((np.ones(len(rows)), (np.arange(len(rows)), [sidx[s] for s in story])), shape=(len(rows), len(ids)))
    per_story = ((X > 0).astype(np.float32).T @ S).toarray()                 # terms x stories: paragraphs holding the term
    keep = np.where((per_story >= MIN_DF_PER_STORY).sum(1) >= MIN_STORIES)[0]
    print(f"{X.shape[1]} terms; {len(keep)} occur across the stories", flush=True)
    X = normalize(X[:, keep])
    Z = normalize(TruncatedSVD(SVD_DIM, random_state=0).fit_transform(X))
    Z = np.hstack([Z, STRUCT_WEIGHT * structure(docs) / np.sqrt(6)])
    labels = []
    for seed in SEEDS:
        km = MiniBatchKMeans(k, random_state=seed, n_init=3, batch_size=4096)
        labels.append(km.fit_predict(Z))
    ari = [adjusted_rand_score(labels[a], labels[b]) for a in range(len(SEEDS)) for b in range(a + 1, len(SEEDS))]
    sample = np.random.default_rng(0).choice(len(docs), SILHOUETTE_SAMPLE, replace=False)
    sil = float(silhouette_score(Z[sample], labels[0][sample]))
    print(f"stability: adjusted Rand between seeds {np.round(ari, 3).tolist()}; silhouette {sil:.3f}", flush=True)
    lab = labels[0]
    terms = np.array(vec.get_feature_names_out())[keep]
    out = []
    for c in range(k):
        idx = np.where(lab == c)[0]
        centre = Z[idx].mean(0, keepdims=True)
        near = idx[np.argsort(-((Z[idx] @ centre.T).ravel()))[:NEAREST]]
        top = np.asarray(X[idx].mean(0)).ravel().argsort()[::-1][:14]
        out.append({"cluster": c, "paragraphs": int(len(idx)), "share": round(len(idx) / len(docs), 4), "chars_share": round(sum(len(docs[i]) for i in idx) / sum(map(len, docs)), 4),
                    "median_chars": int(np.median([len(docs[i]) for i in idx])), "terms": terms[top].tolist(),
                    "nearest": [{"rel": rows[i][0], "idx": rows[i][1], "para": rows[i][2], "text": docs[i][:EXCERPT]} for i in near]})
    out.sort(key=lambda d: -d["paragraphs"])
    os.makedirs(out_dir, exist_ok=True)
    json.dump({"k": k, "ari": ari, "silhouette": sil, "clusters": out}, open(f"{out_dir}/function_k{k}.json", "w"), indent=1)
    np.save(f"{out_dir}/function_labels_k{k}.npy", lab)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]))
