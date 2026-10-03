"""Does the runtime bias the model's thinking, and how much of it is excess? From analytics.db (Qwen stacks only; story
runs with complete thinking text; the newest spec family `v2-*`) and the app's records for quality.

A. Is verbosity a trait of a whole RUN? Per stack, each story run's log thinking minus its story's mean over runs; a
   run's index is the mean of those over its stories. The variance of the run indices is compared with a permutation null
   (the same residuals shuffled between runs within each story).
B. WHEN does a call think more? Per call, log(1 + thinking characters) minus its story run's mean; the mean of that for
   calls with a condition against those without, with a 95% interval by resampling story runs.
C. Are the runs' configurations the same? The recorded engine settings of each run, and what differs.
D. How much is excess, and what does it buy? Per story, thinking above the story's median; and the story's own held-out
   pass rate for its high-thinking runs against its low-thinking runs.

Usage: python3 runtime_bias.py STATE.json
"""
import collections, json, random, sqlite3, sys
import numpy as np

INSIGHTS = "/Users/julian/expts/awesome-local-ai-bench-private/state/insights"
PERMUTATIONS = 4000
BOOT = 1000
SEED = 5
MIN_RUNS = 4

def a_run_trait(rows):
    by_story = collections.defaultdict(dict)
    for run, story, t in rows: by_story[story][run] = np.log(t)
    runs = sorted({r for d in by_story.values() for r in d})
    stories = [s for s, d in by_story.items() if len(d) == len(runs)]
    if len(stories) < 3 or len(runs) < MIN_RUNS: return None
    R = np.array([[by_story[s][r] for r in runs] for s in stories]); R = R - R.mean(1, keepdims=True)
    obs = R.mean(0).var()
    rng = np.random.default_rng(SEED)
    null = [np.array([rng.permutation(row) for row in R]).mean(0).var() for _ in range(PERMUTATIONS)]
    p = (1 + sum(n >= obs for n in null)) / (1 + PERMUTATIONS)
    idx = dict(zip(runs, R.mean(0)))
    return len(stories), len(runs), obs, float(np.mean(null)), p, idx

def boot_diff(groups, rng):
    """groups: story_run -> (values with condition, values without), already demeaned within the story run."""
    keys = list(groups)
    def stat(ks):
        a = np.concatenate([groups[k][0] for k in ks]); b = np.concatenate([groups[k][1] for k in ks])
        return a.mean() - b.mean() if len(a) and len(b) else np.nan
    obs = stat(keys)
    bs = [stat([keys[i] for i in rng.integers(0, len(keys), len(keys))]) for _ in range(BOOT)]
    return obs, np.nanpercentile(bs, 2.5), np.nanpercentile(bs, 97.5)

def main(state_path):
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    state = json.load(open(state_path))
    quality = {}
    for r in state["rows"]:
        if not r.get("dir"): continue
        for s in r["stories"]:
            if s.get("ownTotal"): quality[f"{r['dir']}/stories/{int(s['id']):02d}"] = s["ownPassed"] / s["ownTotal"]
    stacks = [r[0] for r in an.execute("select distinct stack from analytics_story where stack like 'qwen%' and run like 'v2-%'")]
    for stack in sorted(stacks):
        label = stack.split("/")[-1] + " " + stack.split("/")[1]
        sr = an.execute("select rel, run, story, think_chars from analytics_story where stack = ? and run like 'v2-%' and think_complete = 1 and think_chars > 0", (stack,)).fetchall()
        print(f"\n================ {label}: {len(sr)} story runs, {len({r[1] for r in sr})} runs ================")
        # A
        res = a_run_trait([(run, story, t) for _, run, story, t in sr])
        if res:
            n, nr, obs, null, p, idx = res
            print(f"A. Run-level verbosity ({n} stories x {nr} runs): variance of run indices {obs:.3f}, expected by chance {null:.3f}, permutation p = {p:.3f}")
            print("   run index (log scale; +0.30 = 35% more than the story's typical run):", ", ".join(f"{r} {v:+.2f}" for r, v in sorted(idx.items(), key=lambda kv: -kv[1])))
        # B
        rng = np.random.default_rng(SEED)
        rels = {r[0] for r in sr}
        calls = an.execute(f"select c.rel, c.idx, c.frac, c.context_tok, c.after_compaction, c.prev_tests_failed, c.prev_tool_errors, c.prev_tool_kinds, t.chars from call_context c join think_text t using (rel, idx) where c.rel in ({','.join('?' * len(rels))})", list(rels)).fetchall()
        per = collections.defaultdict(list)
        for c in calls: per[c[0]].append(c)
        feats = {"first call after a compaction": lambda c: c[4] == 1, "previous call's tests had failures": lambda c: (c[5] or 0) > 0,
                 "previous call's tool errored": lambda c: (c[6] or 0) > 0, "previous call ran tests (unit or e2e)": lambda c: any(k in (c[7] or "") for k in ("unit", "e2e")),
                 "first call of the story run": lambda c: c[1] == min(x[1] for x in per[c[0]]), "last third of the story run": lambda c: c[2] >= 2 / 3}
        print("B. Change in a call's thinking (log scale) when the condition holds, within a story run; 95% interval over story runs")
        for name, f in feats.items():
            g = {}
            for rel, cs in per.items():
                y = np.log1p([c[8] for c in cs]); y = y - y.mean()
                m = np.array([bool(f(c)) for c in cs])
                if m.any() and (~m).any(): g[rel] = (y[m], y[~m])
            if len(g) >= 10:
                o, lo, hi = boot_diff(g, rng)
                print(f"   {name:42s} {o:+.2f} ({np.expm1(o):+.0%})  [{lo:+.2f}, {hi:+.2f}]  n story runs {len(g)}")
        ctx = {rel: np.array([c[3] if c[3] is not None else np.nan for c in cs], float) for rel, cs in per.items()}
        g = {}
        for rel, cs in per.items():
            x = ctx[rel]; ok = ~np.isnan(x)
            if ok.sum() < 12: continue
            y = np.log1p([c[8] for c in cs])[ok]; y = y - y.mean(); x = x[ok]; hi_ = x >= np.quantile(x, 2 / 3); lo_ = x <= np.quantile(x, 1 / 3)
            if hi_.any() and lo_.any(): g[rel] = (y[hi_], y[lo_])
        o, lo, hi = boot_diff(g, rng); print(f"   {'context in its top third vs bottom third':42s} {o:+.2f} ({np.expm1(o):+.0%})  [{lo:+.2f}, {hi:+.2f}]  n story runs {len(g)}")
        # D
        by_story = collections.defaultdict(list)
        for rel, run, story, t in sr: by_story[story].append((t, quality.get(rel), run))
        excess = tot = 0.0; hi_q, lo_q = [], []
        for story, v in by_story.items():
            if len(v) < MIN_RUNS: continue
            ts = np.array([x[0] for x in v]); med = np.median(ts); excess += np.maximum(ts - med, 0).sum(); tot += ts.sum()
            q = [(x[0], x[1]) for x in v if x[1] is not None]
            if len(q) >= MIN_RUNS:
                q.sort(); k = max(1, len(q) // 3)
                lo_q.append(np.mean([x[1] for x in q[:k]])); hi_q.append(np.mean([x[1] for x in q[-k:]]))
        print(f"D. Thinking above each story's median is {excess / tot:.0%} of all thinking. "
              + (f"Own held-out pass rate, lowest-thinking third of runs vs highest-thinking third (mean over {len(lo_q)} stories): {np.mean(lo_q):.0%} vs {np.mean(hi_q):.0%}" if lo_q else ""))

if __name__ == "__main__":
    main(sys.argv[1])
