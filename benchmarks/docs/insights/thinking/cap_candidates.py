"""Where a per-call thinking cap would bite. Per stack (Qwen, family v2-*, complete thinking text), for candidate caps in
characters of thinking: the share of calls above the cap, the share of all thinking characters in them, and the share of
thinking a cap would remove if each call above it were cut to the cap. Characters, not tokens: the record holds the
characters (a token is about 3 to 4 of them in this text, not measured here), and a cap on `--reasoning-budget` is in
tokens, so a value chosen from this table needs converting, and a series to confirm it.

Usage: python3 cap_candidates.py
"""
import sqlite3
import numpy as np

INSIGHTS = "/Users/julian/expts/awesome-local-ai-bench-private/state/insights"
STACKS = {"Swift 1.5 / llama.cpp": "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi", "Flash-Next / gufo": "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "Flash-Next / mlx-serve": "qwen/3.8/flash-next/macos/128GB/mlxserve-pi"}
CAPS = (5_000, 10_000, 20_000, 40_000)

def main():
    an = sqlite3.connect(f"file:{INSIGHTS}/analytics.db?mode=ro", uri=True)
    for name, stack in STACKS.items():
        chars = np.array([r[0] for r in an.execute("select t.chars from think_text t join analytics_story s using (rel) where s.stack = ? and s.run like 'v2-%' and s.think_complete = 1", (stack,))], float)
        q = np.percentile(chars, [50, 90, 99])
        print(f"\n{name}: {len(chars)} calls with thinking, {chars.sum() / 1e6:.1f} M characters; per call median {q[0]:.0f}, p90 {q[1]:.0f}, p99 {q[2]:.0f}, max {chars.max():.0f}")
        for cap in CAPS:
            over = chars > cap
            cut = np.maximum(chars - cap, 0).sum()
            print(f"   cap {cap:>6,} chars: {over.mean():5.1%} of calls above it, holding {chars[over].sum() / chars.sum():5.1%} of thinking; cutting each to the cap removes {cut / chars.sum():5.1%}")

if __name__ == "__main__":
    main()
