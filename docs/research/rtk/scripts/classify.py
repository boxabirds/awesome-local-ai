# Classify each recorded tool call by whether RTK's own rewrite rule would intercept it,
# and total the tool-output characters in each class, per stack.
import json, subprocess, sys, collections, re, glob
RTK = sys.argv[1]
REWRITTEN_EXIT = 3  # rtk 0.49.0 exits 3 when it rewrote the command (its --help says 0)
calls = [json.loads(l) for f in sorted(glob.glob("calls-*.jsonl")) for l in open(f)]
cache = {}
def rewrite(cmd):
    if cmd not in cache:
        r = subprocess.run([RTK, "rewrite", cmd], capture_output=True, text=True)
        cache[cmd] = r.stdout.strip() if r.returncode in (0, REWRITTEN_EXIT) and r.stdout.strip() else None
    return cache[cmd]
def head(cmd):
    c = re.sub(r"^cd \S+ &&\s*", "", cmd.strip())
    return " ".join(c.split()[:2])[:40]
by_stack = collections.defaultdict(lambda: collections.Counter())
cnt = collections.defaultdict(lambda: collections.Counter())
missed = collections.Counter(); hit = collections.Counter(); examples = {}
for c in calls:
    s = c["stack"]
    if c["tool"] != "bash":
        k = f"pi tool: {c['tool']}"
    else:
        rw = rewrite(c["command"] or "")
        k = "bash, RTK rewrites" if rw else "bash, RTK leaves alone"
        h = head(c["command"] or "")
        (hit if rw else missed)[h] += c["chars"]
        if rw and h not in examples: examples[h] = (c["command"][:120], rw[:160])
    by_stack[s][k] += c["chars"]; cnt[s][k] += 1
out = {"stacks": {s: {k: {"calls": cnt[s][k], "chars": v} for k, v in by_stack[s].items()} for s in by_stack},
       "top_rewritten": hit.most_common(15), "top_not_rewritten": missed.most_common(15),
       "rewrite_examples": examples}
json.dump(out, open("classification.json", "w"), indent=1)
for s in by_stack:
    tot = sum(by_stack[s].values())
    print(f"== {s}: {sum(cnt[s].values())} calls, {tot//1000}k chars of tool output")
    for k, v in sorted(by_stack[s].items(), key=lambda x: -x[1]):
        print(f"   {k:26s} {cnt[s][k]:5d} calls {v//1000:6d}k chars  {100*v/tot:5.1f}%")
print("top rewritten (chars):", hit.most_common(8))
print("top NOT rewritten (chars):", missed.most_common(10))
