"""Find the themes of the model's thinking, from the paragraphs alone (extract_paragraphs.py): TF-IDF, a low-rank
projection, k-means. Nothing is named here: it writes each cluster's size, its strongest terms and the paragraphs
nearest its centre, for a reader to name, and the stability of the partition across seeds.

Usage: uv run --with scikit-learn --with numpy python cluster_paragraphs.py PARAS.pkl OUT_DIR K
"""
import json, pickle, sys
import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import normalize

MIN_DF = 25            # a term in fewer paragraphs than this is a name of one file, not a theme
MAX_DF = 0.30          # in more than this share it is the language of every paragraph
SVD_DIM = 100
SEEDS = (0, 1, 2)
NEAREST = 5
SILHOUETTE_SAMPLE = 8000
EXCERPT = 360

def main(paras_pkl: str, out_dir: str, k: int) -> None:
    rows = pickle.load(open(paras_pkl, "rb"))
    docs = [r[3] for r in rows]
    vec = TfidfVectorizer(lowercase=True, token_pattern=r"[A-Za-z][A-Za-z']{2,}", ngram_range=(1, 2), min_df=MIN_DF, max_df=MAX_DF,
                          sublinear_tf=True, stop_words="english", max_features=60000, dtype=np.float32)
    X = vec.fit_transform(docs)
    print(f"{X.shape[0]} paragraphs x {X.shape[1]} terms", flush=True)
    Z = normalize(TruncatedSVD(SVD_DIM, random_state=0).fit_transform(X))
    labels = []
    for seed in SEEDS:
        km = MiniBatchKMeans(k, random_state=seed, n_init=3, batch_size=4096)
        labels.append(km.fit_predict(Z))
        print(f"seed {seed}: inertia {km.inertia_:.1f}", flush=True)
    ari = [adjusted_rand_score(labels[a], labels[b]) for a in range(len(SEEDS)) for b in range(a + 1, len(SEEDS))]
    rng = np.random.default_rng(0)
    sample = rng.choice(len(docs), SILHOUETTE_SAMPLE, replace=False)
    sil = float(silhouette_score(Z[sample], labels[0][sample]))
    print(f"stability: adjusted Rand between seeds {np.round(ari, 3).tolist()}; silhouette {sil:.3f}", flush=True)
    lab = labels[0]
    terms = np.array(vec.get_feature_names_out())
    out = []
    for c in range(k):
        idx = np.where(lab == c)[0]
        centre = normalize(Z[idx].mean(axis=0, keepdims=True))
        near = idx[np.argsort(-(Z[idx] @ centre.T).ravel())[:NEAREST]]
        top = np.asarray(X[idx].mean(axis=0)).ravel().argsort()[::-1][:14]
        out.append({"cluster": c, "paragraphs": int(len(idx)), "share": round(len(idx) / len(docs), 4), "chars_share": round(sum(len(docs[i]) for i in idx) / sum(map(len, docs)), 4),
                    "terms": terms[top].tolist(), "nearest": [{"rel": rows[i][0], "idx": rows[i][1], "para": rows[i][2], "text": docs[i][:EXCERPT]} for i in near]})
    out.sort(key=lambda d: -d["paragraphs"])
    import os
    os.makedirs(out_dir, exist_ok=True)
    json.dump({"k": k, "ari": ari, "silhouette": sil, "clusters": out}, open(f"{out_dir}/clusters_k{k}.json", "w"), indent=1)
    np.save(f"{out_dir}/labels_k{k}.npy", lab)
    np.save(f"{out_dir}/svd.npy", Z)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]))
