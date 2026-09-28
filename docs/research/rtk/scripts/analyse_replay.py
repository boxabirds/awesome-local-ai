# Summarise the replay: compression by command family, and whether grep hits and test failures survive.
import json, re, collections, sys
rows = json.load(open(sys.argv[1]))
MIN_REAL_OUTPUT = 200     # below this the command mostly failed (e.g. a file missing from the snapshot)
ok = [r for r in rows if r["plain_exit"] in (0, 1) and r["plain_chars"] >= MIN_REAL_OUTPUT]
fam = lambda c: " ".join(c.split()[:2]) if c.startswith(("git", "npm", "npx", "sed")) else c.split()[0]
agg = collections.defaultdict(lambda: [0, 0, 0])
for r in ok:
    f = fam(r["cmd"]); agg[f][0] += 1; agg[f][1] += r["plain_chars"]; agg[f][2] += r["rtk_chars"]
tp = sum(v[1] for v in agg.values()); tr = sum(v[2] for v in agg.values())
print(f"{len(rows)} replayed, {len(ok)} with real output; overall {tp} -> {tr} chars ({100*(1-tr/tp):.0f}% smaller)")
for f, (n, p, q) in sorted(agg.items(), key=lambda x: -x[1][1]):
    print(f"  {f:22s} {n:3d} cmds  {p:8d} -> {q:8d}  ({100*(1-q/p):+.0f}% smaller)")
# grep: do the plain hits' line numbers still appear?
lost = []; checked = 0
for r in ok:
    if not r["cmd"].startswith("grep -n") or "|" in r["cmd"]: continue
    hits = set(re.findall(r"^(?:[^:\n]+:)?(\d+):", r["plain"], re.M))
    if not hits: continue
    checked += 1
    kept = sum(1 for h in hits if re.search(rf"\b{h}\b", r["rtk_out"]))
    if kept < len(hits): lost.append((r["cmd"][:70], len(hits), kept))
print(f"grep -n: {checked} commands checked; {len(lost)} lost some hit line numbers")
for l in lost[:8]: print("   ", l)
diff_exit = [r for r in ok if r["plain_exit"] != r["rtk_exit"]]
print(f"exit status differs in {len(diff_exit)}:", [(r['cmd'][:50], r['plain_exit'], r['rtk_exit']) for r in diff_exit[:5]])
