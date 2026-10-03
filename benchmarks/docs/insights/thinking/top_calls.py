"""The longest thinking calls of a stack, described by derived measures only (no thinking text is printed): where they are
(runs, stories, position, compaction), what came before and after them, how repetitive they are against ordinary calls, and
which themes they are made of. Qwen, family v2-*, complete thinking text. Usage: python3 top_calls.py [STACK_SUBSTRING] [CHARS]
"""
import collections, sqlite3, sys
import numpy as np
import theme_model as tm

INSIGHTS = "/Users/julian/expts/awesome-local-ai-bench-private/state/insights"
DEFAULT_STACK, DEFAULT_CHARS = "swift-1.5", 10_000

def q(a, p): return float(np.percentile(a, p)) if len(a) else float("nan")

def main(stack_sub, cut):
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    wh = sqlite3.connect(f"file:{INSIGHTS}/conversations.db?mode=ro", uri=True)
    cols = ("rel", "s.run", "s.story", "c.idx", "c.frac", "c.t_s", "c.dur_s", "c.context_tok", "c.out_tok", "c.after_compaction", "c.since_compaction", "c.prev_tests_failed", "c.prev_tests_passed", "c.prev_tool_errors", "c.prev_tool_kinds",
            "t.chars", "t.gzip_ratio", "t.repeat5", "t.max_line_repeat", "t.n_wait", "t.n_hmm", "t.n_actually", "t.n_but_wait", "t.n_verify", "t.code_share", "t.prompt_overlap", "t.result_overlap", "t.prev_sim", "t.max_prev_sim")
    rows = an.execute(f"select {', '.join('c.rel' if c == 'rel' else c for c in cols)} from think_text t join call_context c using (rel, idx) join analytics_story s on s.rel = c.rel where s.stack like ? and s.run like 'v2-%' and s.think_complete = 1", (f"%{stack_sub}%",)).fetchall()
    names = [c.split(".")[-1] for c in cols]
    R = [dict(zip(names, r)) for r in rows]
    top = [r for r in R if r["chars"] > cut]; rest = [r for r in R if r["chars"] <= cut]
    chars_all = sum(r["chars"] for r in R)
    print(f"{stack_sub}: {len(R)} calls with thinking; {len(top)} above {cut:,} characters ({len(top) / len(R):.1%}) hold {sum(r['chars'] for r in top) / chars_all:.0%} of all thinking")
    # where
    per_run = collections.Counter(r["run"] for r in top); per_story = collections.Counter(r["story"] for r in top)
    print("  per run:", ", ".join(f"{k} {v}" for k, v in per_run.most_common()))
    print("  per story:", ", ".join(f"{k} {v}" for k, v in sorted(per_story.items())))
    byrs = collections.defaultdict(list)
    for r in top: byrs[(r["run"], r["story"])].append(r["chars"])
    heavy = sorted(byrs.items(), key=lambda kv: -sum(kv[1]))[:5]
    print("  five story runs with the most such thinking (calls, characters):", "; ".join(f"{k[0]} s{k[1]}: {len(v)}, {sum(v):,}" for k, v in heavy))
    # position and situation
    f = lambda key, rs: np.array([r[key] for r in rs if r[key] is not None], float)
    print(f"  position in the story run (fraction): top median {np.median(f('frac', top)):.2f} vs ordinary {np.median(f('frac', rest)):.2f}")
    print(f"  prompt size (tokens): top median {np.median(f('context_tok', top)):,.0f} vs ordinary {np.median(f('context_tok', rest)):,.0f}")
    print(f"  right after a compaction: top {np.mean([r['after_compaction'] == 1 for r in top if r['after_compaction'] is not None]):.1%} vs ordinary {np.mean([r['after_compaction'] == 1 for r in rest if r['after_compaction'] is not None]):.1%}")
    print(f"  previous call's tests had failures: top {np.mean([(r['prev_tests_failed'] or 0) > 0 for r in top]):.0%} vs ordinary {np.mean([(r['prev_tests_failed'] or 0) > 0 for r in rest]):.0%}")
    print(f"  previous call's tool errored: top {np.mean([(r['prev_tool_errors'] or 0) > 0 for r in top]):.0%} vs ordinary {np.mean([(r['prev_tool_errors'] or 0) > 0 for r in rest]):.0%}")
    kinds = collections.Counter(k for r in top for k in (r["prev_tool_kinds"] or "none").split(","))
    print("  previous call's tool kinds in the top calls:", ", ".join(f"{k} {v / len(top):.0%}" for k, v in kinds.most_common(5)))
    print(f"  time and output: a top call takes a median {np.median(f('dur_s', top)):.0f} s ({np.median(f('out_tok', top)):,.0f} tokens) against {np.median(f('dur_s', rest)):.1f} s for an ordinary one")
    # how repetitive
    print("  how repetitive (top vs ordinary medians): ", "; ".join(f"{k} {np.median(f(k, top)):.2f} vs {np.median(f(k, rest)):.2f}" for k in ("gzip_ratio", "repeat5", "prev_sim", "max_prev_sim", "prompt_overlap", "result_overlap", "code_share")))
    print(f"  share with a line repeated 3 or more times: top {np.mean([(r['max_line_repeat'] or 0) >= 3 for r in top]):.0%} vs ordinary {np.mean([(r['max_line_repeat'] or 0) >= 3 for r in rest]):.0%}; with similarity 0.5 or more to an earlier thought: top {np.mean([(r['max_prev_sim'] or 0) >= 0.5 for r in top]):.0%} vs ordinary {np.mean([(r['max_prev_sim'] or 0) >= 0.5 for r in rest]):.0%}")
    per_k = lambda key, rs: np.median([r[key] / r["chars"] * 1000 for r in rs])
    print("  reflection markers per 1,000 characters (top vs ordinary): " + "; ".join(f"{k} {per_k(k, top):.2f} vs {per_k(k, rest):.2f}" for k in ("n_wait", "n_but_wait", "n_hmm", "n_actually", "n_verify")))
    # what followed: the next call's view of this call's tool results
    nxt = {(r["rel"], r["idx"]): r for r in R}
    follow = an.execute("select c.rel, c.idx, c.prev_tests_passed, c.prev_tests_failed, c.prev_tool_errors, c.prev_tool_kinds from call_context c join analytics_story s on s.rel = c.rel where s.stack like ? and s.run like 'v2-%' and s.think_complete = 1", (f"%{stack_sub}%",)).fetchall()
    after = {(a, b - 1): (p, fl, e, k) for a, b, p, fl, e, k in follow}
    def outcome(rs):
        o = [after[(r["rel"], r["idx"])] for r in rs if (r["rel"], r["idx"]) in after]
        ran = [x for x in o if (x[0] or 0) + (x[1] or 0) > 0]
        return len(o), (np.mean([x[1] > 0 for x in ran]) if ran else float("nan")), len(ran), np.mean([(x[2] or 0) > 0 for x in o]), collections.Counter(k for x in o for k in (x[3] or "none").split(",") if k)
    for name, rs in (("top", top), ("ordinary", rest)):
        n, failrate, nran, err, k = outcome(rs)
        print(f"  what the call did next ({name}, {n} calls): ran tests {nran / n:.0%}, of those with failures {failrate:.0%}; tool errored {err:.0%}; kinds: " + ", ".join(f"{a} {b / n:.0%}" for a, b in k.most_common(4)))
    # themes of the top calls' paragraphs vs ordinary calls' (assigned by the saved model; no text printed)
    model = tm.load(f"{INSIGHTS}/themes/theme_model_v1.joblib")
    names = {t["id"]: t["name"] for t in __import__("json").load(open(tm.THEMES_FILE))["themes"]}
    def themes(rs, limit):
        chars = np.zeros(14); texts = []
        for r in rs[:limit]:
            (t,) = wh.execute("select c.think_full from calls c join stories s using(sk) where s.rel = ? and c.idx = ?", (r["rel"], r["idx"])).fetchone()
            texts += tm.paragraphs(t)
        if not texts: return chars
        w = tm.weights(model, texts); n = np.array([len(t) for t in texts], float)
        return (w * n[:, None]).sum(0) / n.sum()
    rng = np.random.default_rng(3); sample = [rest[i] for i in rng.choice(len(rest), 600, replace=False)]
    a, b = themes(top, len(top)), themes(sample, 600)
    print("  themes by share of characters (top calls vs a sample of 600 ordinary calls):")
    for t in np.argsort(-a)[:7]: print(f"     {names[t]:34s} {a[t]:5.0%}  vs {b[t]:5.0%}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_STACK, int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_CHARS)
