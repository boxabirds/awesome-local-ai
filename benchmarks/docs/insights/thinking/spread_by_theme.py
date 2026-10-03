"""Which themes of thinking carry the run-to-run spread. For each story, the variance across its runs of the total
thinking characters is split exactly by theme: Var(total) = sum over themes of Cov(total, theme's characters), so a
theme's share is Cov(total, theme) / Var(total), and the shares sum to 1. Summed over stories (the numerator and the
denominator each), for the runs of one combination.

Usage: python3 spread_by_theme.py PARAS.pkl LABELS.npy
"""
import collections, pickle, re, sys
import numpy as np

STORY = re.compile(r"/stories/(\d+)$")
RUN = re.compile(r"benchmarks/vidi/([^/]+)/stories")
STACK = re.compile(r"^combinations/(.*?)/benchmarks/")

def main(paras_pkl, labels_npy, min_runs=4):
    rows = pickle.load(open(paras_pkl, "rb")); lab = np.load(labels_npy); k = int(lab.max()) + 1
    chars = collections.defaultdict(lambda: np.zeros(k))                  # (stack, story, run) -> chars per theme
    for (rel, _, _, text), c in zip(rows, lab):
        stack = STACK.match(rel).group(1); story = int(STORY.search(rel).group(1)); run = RUN.search(rel).group(1)
        if not run.startswith("v2-"): continue                            # the newest spec family, as the app's figures use
        chars[(stack, story, run)][c] += len(text)
    for stack in sorted({s for s, _, _ in chars}):
        num = np.zeros(k); den = 0.0; stories = 0
        for story in sorted({st for s, st, _ in chars if s == stack}):
            M = np.array([v for (s, st, _), v in chars.items() if s == stack and st == story])
            if len(M) < min_runs: continue
            T = M.sum(1); cov = ((M - M.mean(0)) * (T - T.mean())[:, None]).mean(0)
            num += cov; den += T.var(); stories += 1
        if den == 0: continue
        share = num / den
        print(f"\n{stack}  ({stories} stories, runs per story >= {min_runs}); the shares sum to {share.sum():.2f}")
        order = np.argsort(-share)
        print("  theme:share  ", "  ".join(f"{t}:{share[t]:.0%}" for t in order[:8]))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
