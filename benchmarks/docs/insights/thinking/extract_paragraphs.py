"""Every paragraph of the model's thinking, from the story runs whose thinking text is complete (analytics.db
think_complete = 1), Qwen combinations only: the raw material for finding what thinking is made of.

Reads the warehouse and analytics.db read-only; writes one parquet-free pickle (a list of tuples) and prints counts.
Usage: uv run --with numpy python extract_paragraphs.py OUT.pkl
"""
import os, pathlib, pickle, re, sqlite3, sys

# The repository this script is in, and the private repo beside it (as the harness finds it, packdir.private_checkout).
# INSIGHTS_DIR overrides, for a checkout somewhere else. No absolute path is written here: this repo is public.
REPO = pathlib.Path(__file__).resolve().parents[4]
INSIGHTS = os.environ.get("INSIGHTS_DIR") or str(REPO.parent / "awesome-local-ai-bench-private" / "state" / "insights")
MIN_CHARS = 40          # a shorter paragraph is a fragment ("Let me check.") and carries no theme of its own
BLANK = re.compile(r"\n\s*\n")

def main(out: str) -> None:
    wh = sqlite3.connect(f"file:{INSIGHTS}/conversations.db?mode=ro", uri=True)
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    rels = [r[0] for r in an.execute("select rel from analytics_story where think_complete = 1 and stack like 'qwen%' order by rel")]
    rows, short, blocks = [], 0, 0
    for rel in rels:
        for idx, text in wh.execute("select c.idx, c.think_full from calls c join stories s using(sk) where s.rel = ? and c.think > 0 order by c.idx", (rel,)):
            blocks += 1
            for n, p in enumerate(BLANK.split(text)):
                p = p.strip()
                if len(p) < MIN_CHARS:
                    short += 1
                    continue
                rows.append((rel, idx, n, p))
    pickle.dump(rows, open(out, "wb"))
    print(f"{len(rels)} story runs, {blocks} thinking blocks, {len(rows)} paragraphs kept ({short} under {MIN_CHARS} chars dropped), {sum(len(r[3]) for r in rows):,} chars")

if __name__ == "__main__":
    main(sys.argv[1])
