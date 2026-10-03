"""Agreement between the themes' own assignments and a labeller's choices over the blind items: observed agreement,
Cohen's kappa, and per theme how often the labeller picked the theme the paragraph was assigned to (recall) and how
often a pick of that theme was one the assignment made (precision). Also agreement with the labeller's pick restricted to
the items whose assigned-theme weight is 0.5 or more (the clear ones).

Usage: python3 score_validation.py items-all.jsonl LABELLER NAME
  LABELLER is a JSON {id: theme id} (an independent model's) or a decisions.jsonl from `dbench label` (the owner's).
"""
import collections, json, sys

CLEAR = 0.5

def load(path):
    text = open(path).read()
    if path.endswith(".jsonl"):
        return {d["id"]: d["label"] for d in (json.loads(l) for l in text.splitlines() if l.strip())}    # the last decision wins
    return json.load(open(path))

def kappa(pairs):
    n = len(pairs)
    po = sum(a == b for a, b in pairs) / n
    ca, cb = collections.Counter(a for a, _ in pairs), collections.Counter(b for _, b in pairs)
    pe = sum(ca[k] / n * cb[k] / n for k in ca)
    return None if pe >= 1 else (po - pe) / (1 - pe)

def main(items_path, labeller_path, name):
    items = {i["id"]: i for i in map(json.loads, open(items_path))}
    got = load(labeller_path)
    ids = [i for i in items if i in got]
    pairs = [(items[i]["label"], str(got[i])) for i in ids]
    clear = [(items[i]["label"], str(got[i])) for i in ids if items[i]["meta"]["theme_weight"] >= CLEAR]
    agree = sum(a == b for a, b in pairs)
    k = kappa(pairs)
    print(f"{name}: {len(ids)} items; agreement {agree}/{len(ids)} = {agree / len(ids):.0%}; kappa {k:.2f}" if k is not None else f"{name}: {len(ids)} items; agreement {agree / len(ids):.0%}")
    if clear:
        print(f"  on the {len(clear)} items whose theme weight is {CLEAR} or more: {sum(a == b for a, b in clear) / len(clear):.0%}")
    print(f"  labelled 'other': {sum(b == 'other' for _, b in pairs)}")
    mine, theirs = collections.Counter(a for a, _ in pairs), collections.Counter(b for _, b in pairs)
    rows = []
    for t in sorted(mine, key=int):
        both = sum(a == b == t for a, b in pairs)
        rows.append((t, mine[t], both / mine[t], both / theirs[t] if theirs[t] else None))
    print("  theme: items, recall, precision")
    for t, n, r, p in rows:
        print(f"   {t:>3}: {n:2d}  recall {r:4.0%}  precision {'n/a' if p is None else format(p, '4.0%')}")

if __name__ == "__main__":
    main(*sys.argv[1:4])
