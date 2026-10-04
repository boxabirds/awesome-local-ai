"""Proposals for the owner to validate: paragraphs drawn at random, a fixed number per theme (by strongest theme), from the
story runs with complete thinking text. The model proposes a theme for each, with its reasons (the theme's weight, the
runner-up, and the theme's strongest terms found in the paragraph); the owner accepts or corrects. `--blind` hides the
proposal until the owner has decided, for a check that is not anchored. Writes labels.json, items-all.jsonl and
items-owner.jsonl (a subset for the owner), in the format `dbench label` reads.

Usage: uv run --with scikit-learn --with numpy --with scipy --with joblib python make_validation_set.py OUT_DIR [--blind]
"""
import json, os, pathlib, random, sqlite3, sys
import numpy as np
import theme_model as tm

# The repository this script is in, and the private repo beside it (as the harness finds it, packdir.private_checkout).
# INSIGHTS_DIR overrides, for a checkout somewhere else. No absolute path is written here: this repo is public.
REPO = pathlib.Path(__file__).resolve().parents[4]
INSIGHTS = os.environ.get("INSIGHTS_DIR") or str(REPO.parent / "awesome-local-ai-bench-private" / "state" / "insights")
PER_THEME = 7
OWNER_ITEMS = 20
MIN_CHARS, MAX_CHARS = 60, 900       # long enough to carry a theme, short enough to read in a glance
SEED = 11

TERMS_SHOWN = 4

def key_terms(model, text, theme):
    """The theme's strongest terms that this paragraph holds: what the proposal rests on."""
    from sklearn.preprocessing import normalize
    row = normalize(model["vectorizer"].transform([text])[:, model["keep"]])
    contrib = row.multiply(model["nmf"].components_[theme]).tocsr()
    terms = np.array(model["vectorizer"].get_feature_names_out())[model["keep"]]
    idx = contrib.indices[np.argsort(-contrib.data)][:TERMS_SHOWN]
    return terms[idx].tolist()

def main(out, blind=False):
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
            names = {t["id"]: t["name"] for t in meta["themes"]}
            terms = ", ".join(f"\"{t}\"" for t in key_terms(model, pool[i][2], theme)) or "no strong term"
            items.append({"id": f"p{len(items):03d}", "text": pool[i][2], "label": str(theme), "blind": blind,
                          "reason": f"weight {W[i][theme]:.2f} for this theme; runner-up {names[second]} at {W[i][second]:.2f}; theme terms in it: {terms}",
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
    main(sys.argv[1], "--blind" in sys.argv[2:])
