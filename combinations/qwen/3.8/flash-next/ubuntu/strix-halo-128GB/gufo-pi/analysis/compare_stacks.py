"""compare_stacks.py — run-to-run variation per story on each stack with v2 runs, from the records in the repo.

For each stack: over its stories, the median coefficient of variation (CV) across runs of the story's minutes,
tokens generated and thinking, and how much the model thinks per call. Thinking is characters for the local models
and tokens for the Claude models (whose thinking text is withheld), so compare its variation, not its size.
"""
import json
import statistics as st
from pathlib import Path

REPO = Path(__file__).resolve().parents[8]
STACKS = [  # name, record folder, finished valid runs
    ('Flash-Next, gufo (this stack)', 'combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi', ['v2-r1', 'v2-r2', 'v2-r3', 'v2-r4']),
    ('Flash-Next, mlx-serve', 'combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi', ['v2-r1', 'v2-r2']),
    ('Swift 1.5 27B, llama.cpp', 'combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi', ['v2-r1', 'v2-r2', 'v2-r3']),
    ('Opus 5.5', 'benchmarks/reference/vidi/opus-5.5', ['v2-r1', 'v2-r2', 'v2-r3']),
    ('Sonnet 5.5', 'benchmarks/reference/vidi/sonnet-5.5', ['v2-r4', 'v2-r5']),
]


def cv(xs):
    return st.pstdev(xs) / st.mean(xs) if st.mean(xs) else 0.0


print('| stack | runs | minutes: CV per story | tokens generated: CV | thinking: CV | thinking per call, median | hours per run | CV |')
print('|---|---|---|---|---|---|---|---|')
for name, folder, runs in STACKS:
    d = {}
    for r in runs:
        for sid, s in json.load(open(REPO / folder / r / 'metrics.json'))['stories'].items():
            ts, c = s.get('time_split') or {}, s.get('conversation') or {}
            if ts.get('wall_s'):
                think = c.get('thinking_chars') if c.get('thinking_chars') is not None else c.get('thinking_tokens')
                d[(r, sid)] = dict(wall=ts['wall_s'], out=((s.get('agent') or {}).get('tokens') or {}).get('output'), think=think, per_call=c.get('thinking_median'))
    stories = sorted({k[1] for k in d if all((r, k[1]) in d for r in runs)}, key=int)
    med = lambda f: st.median(cv([d[(r, s)][f] for r in runs]) for s in stories if all(d[(r, s)][f] for r in runs))
    totals = [sum(d[(r, s)]['wall'] for s in stories) / 3600 for r in runs]
    per_call = [d[(r, s)]['per_call'] for r in runs for s in stories if d[(r, s)]['per_call'] is not None]
    print(f"| {name} | {len(runs)} | {med('wall'):.0%} | {med('out'):.0%} | {med('think'):.0%} | "
          f"{f'{st.median(per_call):.0f} chars' if per_call else 'withheld'} | {' '.join(f'{t:.1f}' for t in totals)} | {cv(totals):.0%} |")
