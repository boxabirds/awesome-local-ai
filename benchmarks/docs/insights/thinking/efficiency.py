"""How much shorter can a run be at the same result? Per stack and story (at least 4 runs, family v2-*, complete thinking
text): the runs that reach the story's best own held-out pass rate; how many of them thought no more than the story's median;
how much their thinking would fall if each had thought as little as the shortest of them; and the longest over the shortest
among them. The yardstick is the story's own tests only, and "best" is the best of the few runs there are.

A story run in a collapsed stretch (three or more stories in a row that pass none; shared/collapse.ts, the `collapsed`
mark on the app's stories) is left out: a broken run's short thinking is not a thrifty path. How many are left out is printed.

Usage: python3 efficiency.py STATE.json
"""
import collections, json, os, pathlib, sqlite3, sys
import numpy as np

# The repository this script is in, and the private repo beside it (as the harness finds it, packdir.private_checkout).
# INSIGHTS_DIR overrides, for a checkout somewhere else. No absolute path is written here: this repo is public.
REPO = pathlib.Path(__file__).resolve().parents[4]
INSIGHTS = os.environ.get("INSIGHTS_DIR") or str(REPO.parent / "awesome-local-ai-bench-private" / "state" / "insights")
STACKS = {"Swift 1.5 / llama.cpp": "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi", "Flash-Next / gufo": "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "Flash-Next / mlx-serve": "qwen/3.8/flash-next/macos/128GB/mlxserve-pi"}
MIN_RUNS = 4

def main(state_path):
    state = json.load(open(state_path))
    q = {f"{r['dir']}/stories/{int(s['id']):02d}": s["ownPassed"] / s["ownTotal"] for r in state["rows"] if r.get("dir") for s in r["stories"] if s.get("ownTotal")}
    collapsed = {f"{r['dir']}/stories/{int(s['id']):02d}" for r in state["rows"] if r.get("dir") for s in r["stories"] if s.get("collapsed")}
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    for name, stack in STACKS.items():
        by = collections.defaultdict(list); left_out = 0
        for rel, run, story, t in an.execute("select rel, run, story, think_chars from analytics_story where stack = ? and run like 'v2-%' and think_complete = 1 and think_chars > 0", (stack,)):
            if rel in q and rel not in collapsed: by[story].append((run, t, q[rel]))
            elif rel in collapsed: left_out += 1
        best_runs = shorter = zero = cells = 0; best_total = floor_total = 0.0; ratios = []; n = 0
        for v in by.values():
            if len(v) < MIN_RUNS: continue
            n += 1; med = np.median([t for _, t, _ in v]); top = max(x[2] for x in v)
            best = [x for x in v if x[2] >= top - 1e-9]
            best_runs += len(best); shorter += sum(x[1] <= med for x in best)
            best_total += sum(x[1] for x in best); floor_total += len(best) * min(x[1] for x in best)
            zero += sum(x[2] == 0 for x in v); cells += len(v)
            if len(best) >= 2: ratios.append(max(x[1] for x in best) / min(x[1] for x in best))
        print(f"\n{name}: {n} stories with at least {MIN_RUNS} runs")
        print(f"   runs reaching the story's best own pass rate: {best_runs}; at or below the story's median thinking: {shorter} ({shorter / best_runs:.0%})")
        print(f"   their thinking would fall {1 - floor_total / best_total:.0%} if each had thought as little as the shortest of them")
        print(f"   longest over shortest among them, per story: median {np.median(ratios):.1f}x over {len(ratios)} stories")
        print(f"   story runs with no held-out test passing (collapsed stretches left out first): {zero} of {cells}; story runs left out as collapsed: {left_out}")

if __name__ == "__main__":
    main(sys.argv[1])
