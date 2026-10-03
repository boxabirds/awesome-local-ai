"""Theme model: fit once, assign any thinking text to the themes in themes_v1.json. The vocabulary, the cross-story
filter and the NMF are those of topics_function.py (seed 0); this saves them so a paragraph written later is assigned
by the same model (its weights solved against the fitted topics) without refitting.

Fit:    uv run --with scikit-learn --with numpy --with scipy --with joblib python theme_model.py fit PARAS.pkl MODEL.joblib
Import: from theme_model import load, weights   (weights(model, texts) -> an array, one row per text, sums to 1)
"""
import json, pickle, re, sys
import numpy as np
from sklearn.decomposition import NMF
from sklearn.preprocessing import normalize
import topics_function as tf

BLANK = re.compile(r"\n\s*\n")
MIN_CHARS = 40
THEMES_FILE = __file__.rsplit("/", 1)[0] + "/themes_v1.json"

def fit(paras_pkl, out):
    import joblib
    rows = pickle.load(open(paras_pkl, "rb"))
    docs = [r[3] for r in rows]
    story = np.array([int(tf.STORY.search(r[0]).group(1)) for r in rows])
    vec, keep = tf.fit_vocabulary(docs, story)
    X = normalize(vec.transform(docs)[:, keep])
    nmf = NMF(14, init="random", random_state=0, max_iter=300, tol=1e-4).fit(X)
    names = {t["id"]: t["name"] for t in json.load(open(THEMES_FILE))["themes"]}
    assert sorted(names) == list(range(14)), "themes_v1.json must name topics 0 to 13"
    joblib.dump({"version": 1, "vectorizer": vec, "keep": keep, "nmf": nmf}, out)

def load(path):
    import joblib
    return joblib.load(path)

def paragraphs(text):
    return [p.strip() for p in BLANK.split(text) if len(p.strip()) >= MIN_CHARS]

def weights(model, texts):
    X = normalize(model["vectorizer"].transform(texts)[:, model["keep"]])
    W = model["nmf"].transform(X)
    return W / np.maximum(W.sum(1, keepdims=True), 1e-9)

if __name__ == "__main__":
    if sys.argv[1] == "fit":
        fit(sys.argv[2], sys.argv[3])
