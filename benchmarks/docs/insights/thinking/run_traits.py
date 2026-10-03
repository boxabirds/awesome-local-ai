"""Run-level traits of thinking. Per stack (Qwen, family v2-*), for each run: its verbosity index (mean over its stories of
log thinking minus the story's median over runs), split into calls and characters per call, beside the engine version
and harness release from its record; the per-story residuals of the two most extreme runs; and whether a run's early
stories (1 to 4) predict its late ones (7 to 12).

Usage: python3 run_traits.py
"""
import collections, glob, json, sqlite3
import numpy as np

INSIGHTS = "/Users/julian/expts/awesome-local-ai-bench-private/state/insights"
REPO = "/Users/julian/expts/awesome-local-ai"
STACKS = {"gufo": "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "swift": "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi", "mlx": "qwen/3.8/flash-next/macos/128GB/mlxserve-pi"}
MIN_RUNS = 4
EARLY, LATE = 4, 7

def value(e, k):
    v = e.get(k)
    return v.get("value") if isinstance(v, dict) else v

def by_story(an, stack):
    rows = an.execute("select run, story, think_chars, n_calls from analytics_story where stack = ? and run like 'v2-%' and think_complete = 1 and think_chars > 0", (stack,)).fetchall()
    out = collections.defaultdict(dict)
    for run, story, t, n in rows: out[story][run] = (t, n)
    return out

def residuals(stories):
    idx, calls, per = (collections.defaultdict(dict) for _ in range(3))
    for story, d in stories.items():
        if len(d) < MIN_RUNS: continue
        mt = np.median([np.log(t) for t, _ in d.values()]); mn = np.median([np.log(n) for _, n in d.values()]); mp = np.median([np.log(t / n) for t, n in d.values()])
        for run, (t, n) in d.items():
            idx[run][story] = np.log(t) - mt; calls[run][story] = np.log(n) - mn; per[run][story] = np.log(t / n) - mp
    return idx, calls, per

def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])

def main():
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    for name, stack in STACKS.items():
        idx, calls, per = residuals(by_story(an, stack))
        meta = {}
        for f in glob.glob(f"{REPO}/combinations/{stack}/benchmarks/vidi/v2-*/run.json"):
            d = json.load(open(f)); e = d.get("engine_settings") or {}
            meta[f.split("/")[-2]] = (str(value(e, "engine_version") or "not recorded"), str(d.get("harness_release") or "pre-release"))
        print(f"\n== {name}: verbosity index (log scale, +0.69 = 2x) over the stories each run has")
        order = sorted(idx, key=lambda r: -np.mean(list(idx[r].values())))
        for run in order:
            m = lambda d: np.mean(list(d[run].values()))
            print(f"   {run:16s} {m(idx):+.2f}  (calls {m(calls):+.2f}, chars/call {m(per):+.2f}; {len(idx[run])} stories)  {meta.get(run, ('?', '?'))[0][-30:]:30s} {meta.get(run, ('?', '?'))[1]}")
        for run in (order[0], order[-1]):
            print(f"   {run} per story: " + ", ".join(f"{s}: {v:+.2f}" for s, v in sorted(idx[run].items())))
        early, late = [], []
        for run, d in idx.items():
            e = [v for s, v in d.items() if s <= EARLY]; l = [v for s, v in d.items() if s >= LATE]
            if len(e) >= 2 and len(l) >= 3: early.append(np.mean(e)); late.append(np.mean(l))
        if len(early) >= MIN_RUNS: print(f"   early (stories 1 to {EARLY}) against late ({LATE} on) verbosity, {len(early)} runs, rank correlation {spearman(early, late):+.2f}")

if __name__ == "__main__":
    main()
