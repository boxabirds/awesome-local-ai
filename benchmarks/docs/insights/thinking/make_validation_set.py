"""The blind recognisability check for the themes: paragraphs drawn at random, a fixed number per theme (by strongest
theme), from the story runs with complete thinking text. Every item is blind: the labeller sees the paragraph and
the theme list, not the model's theme. Writes labels.json, items-all.jsonl (for an independent model) and
items-owner.jsonl (a subset for the owner), in the format `dbench label` reads.

Usage: uv run --with scikit-learn --with numpy --with scipy --with joblib python make_validation_set.py OUT_DIR
"""
import json, random, sqlite3, sys
import numpy as np
import theme_model as tm

INSIGHTS = "/Users/julian/expts/awesome-local-ai-bench-private/state/insights"
PER_THEME = 7
OWNER_ITEMS = 20
MIN_CHARS, MAX_CHARS = 60, 900       # long enough to carry a theme, short enough to read in a glance
SEED = 11

def main(out):
    model = tm.load(f"{INSIGHTS}/themes/theme_model_v1.joblib")
    meta = json.load(open(tm.THEMES_FILE))
    wh = sqlite3.connect(f"file:{INSIGHTS}/conversations.db?mode=ro", uri=True)
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    rels = [r[0] for r in an.execute("select rel from analytics_story where think_complete = 1 and stack like 'qwen%' order by rel")]
    rng = random.Random(SEED)
    pool = []
    for rel in rng.sample(rels, 60):               # a spread of story runs, not all 231: enough paragraphs per theme
        for idx, t in wh.execute("select c.idx, c.think_full from calls c join stories s using(sk) where s.rel = ? and c.think > 0", (rel,)):
            pool += [(rel, idx, p) for p in tm.paragraphs(t) if MIN_CHARS <= len(p) <= MAX_CHARS]
    W = tm.weights(model, [p[2] for p in pool])
    strongest = W.argmax(1)
    items = []
    for theme in (t["id"] for t in meta["themes"]):
        cand = [i for i in range(len(pool)) if strongest[i] == theme]
        for i in rng.sample(cand, PER_THEME):
            second = np.argsort(-W[i])[1]
            items.append({"id": f"p{len(items):03d}", "text": pool[i][2], "label": str(theme), "blind": True,
                          "reason": f"weight {W[i][theme]:.2f}; next {second} at {W[i][second]:.2f}",
                          "meta": {"story_run": pool[i][0].split("/benchmarks/")[1], "call": pool[i][1], "theme_weight": round(float(W[i][theme]), 2)}})
    rng.shuffle(items)
    owner = []
    seen = set()
    for it in items:                                # one per theme first, then fill at random
        if it["label"] not in seen: owner.append(it); seen.add(it["label"])
    rest = [i for i in items if i not in owner]; rng.shuffle(rest)
    owner += rest[: OWNER_ITEMS - len(owner)]
    rng.shuffle(owner)
    labels = [{"id": str(t["id"]), "name": t["name"], "definition": t["definition"]} for t in meta["themes"]] + [{"id": "other", "name": meta["other"]["name"], "definition": meta["other"]["definition"]}]
    json.dump(labels, open(f"{out}/labels.json", "w"), indent=1)
    for name, rows in (("items-all.jsonl", items), ("items-owner.jsonl", owner)):
        open(f"{out}/{name}", "w").write("".join(json.dumps(r) + "\n" for r in rows))
    print(f"{len(items)} items ({PER_THEME} per theme) from {len(pool)} candidate paragraphs; {len(owner)} for the owner")

if __name__ == "__main__":
    main(sys.argv[1])
