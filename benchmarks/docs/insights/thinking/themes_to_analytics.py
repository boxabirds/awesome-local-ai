"""Write each story run's theme shares into analytics.db (tables theme, theme_story, theme_share; the schema is
tools/dbench/src/analytics/schema.sql, the one definition). Incremental: a story run is redone only when its
analytics source digest or the model version changed. Reads the warehouse and writes analytics.db.

Usage: uv run --with scikit-learn --with numpy --with scipy --with joblib python themes_to_analytics.py [--insights DIR] [--model FILE]
"""
import argparse, json, os, sqlite3, time
import numpy as np
import theme_model as tm

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, "../../../../tools/dbench/src/analytics/schema.sql")
DEFAULT_INSIGHTS = "/Users/julian/expts/awesome-local-ai-bench-private/state/insights"
LOCK_WAIT_S = 120

def aggregate(texts, w):
    """Per theme: the characters of the paragraphs times their weight on it, and how many paragraphs it is strongest in.
    (chars, count) arrays of length themes. The chars sum to the paragraphs' total characters."""
    n = np.array([len(t) for t in texts], dtype=float)
    return (w * n[:, None]).sum(0), np.bincount(w.argmax(1), minlength=w.shape[1])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--insights", default=DEFAULT_INSIGHTS)
    ap.add_argument("--model", default=None)
    a = ap.parse_args()
    model = tm.load(a.model or f"{a.insights}/themes/theme_model_v1.joblib")
    meta = json.load(open(tm.THEMES_FILE)); version = meta["version"]
    wh = sqlite3.connect(f"file:{a.insights}/conversations.db?mode=ro", uri=True)
    an = sqlite3.connect(f"{a.insights}/analytics.db", timeout=LOCK_WAIT_S)
    an.executescript(open(SCHEMA).read())
    an.execute("delete from theme where version = ?", (version,))
    an.executemany("insert into theme values (?,?,?,?)", [(version, t["id"], t["name"], t["definition"]) for t in meta["themes"]])
    done = dict(an.execute("select rel, source_digest from theme_story where version = ?", (version,)))
    todo = [(r, d) for r, d in an.execute("select rel, source_digest from analytics_story where think_complete = 1 and stack like 'qwen%' order by rel") if done.get(r) != d]
    started = time.time(); paragraphs = 0
    for rel, digest in todo:
        texts = [p for (t,) in wh.execute("select c.think_full from calls c join stories s using(sk) where s.rel = ? and c.think > 0 order by c.idx", (rel,)) for p in tm.paragraphs(t)]
        chars, counts = aggregate(texts, tm.weights(model, texts)) if texts else (np.zeros(14), np.zeros(14, int))
        an.execute("delete from theme_share where rel = ? and version = ?", (rel, version))
        an.executemany("insert into theme_share values (?,?,?,?,?)", [(rel, version, t, float(chars[t]), int(counts[t])) for t in range(len(chars))])
        an.execute("insert or replace into theme_story values (?,?,?,?,?)", (rel, version, digest, len(texts), time.time()))
        paragraphs += len(texts)
        an.commit()
    print(f"themes v{version}: {len(todo)} of {len(todo) + len(done)} story runs assigned, {paragraphs} paragraphs, {time.time() - started:.0f} s")

if __name__ == "__main__":
    main()
