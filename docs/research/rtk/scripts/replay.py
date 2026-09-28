# Replay the agents' recorded read-only shell commands in a copy of their final workspace,
# once as recorded and once as RTK rewrites them, and compare output size and what survives.
import json, os, re, subprocess, sys, random
WS, RTK_DIR, CALLS, OUT = sys.argv[1:5]
SAMPLE = 150
TIMEOUT_S = 240
SAFE = re.compile(r"^(grep|sed -n|ls|find|cat [^>]|head|tail|wc|git (status|log|diff|show)|npm run test:(unit|component)|npx vitest)")
UNSAFE = re.compile(r"(>|\brm\b|\bmv\b|\bcp\b|python|node -e|playwright|wrangler|test:e2e|\btsc\b|typecheck|dev\b|preview|install|curl|kill|sleep)")
env = dict(os.environ, PATH=f"{RTK_DIR}:{os.environ['PATH']}", CI="1", NO_COLOR="1")
def norm(cmd):
    c = re.sub(r"^cd \S+ &&\s*", "", cmd.strip())
    return re.sub(r"/\S*?/workspace/?", "./", c)
cands = []
for l in open(CALLS):
    c = json.loads(l)
    if c["tool"] != "bash" or not c["command"]: continue
    n = norm(c["command"])
    if SAFE.match(n) and not UNSAFE.search(n): cands.append(n)
cands = sorted(set(cands)); random.seed(7); random.shuffle(cands)
rows = []
for cmd in cands:
    if len(rows) >= SAMPLE: break
    rw = subprocess.run([f"{RTK_DIR}/rtk", "rewrite", cmd], capture_output=True, text=True, env=env)
    if rw.returncode not in (0, 3) or not rw.stdout.strip(): continue
    def run(c):
        try:
            p = subprocess.run(["bash", "-c", c], cwd=WS, capture_output=True, text=True, timeout=TIMEOUT_S, env=env, errors="replace")
            return p.stdout + p.stderr, p.returncode
        except subprocess.TimeoutExpired:
            return "", "timeout"
    a, ea = run(cmd); b, eb = run(rw.stdout.strip())
    rows.append({"cmd": cmd, "rtk": rw.stdout.strip(), "plain_chars": len(a), "rtk_chars": len(b), "plain_exit": ea, "rtk_exit": eb,
                 "plain": a[:20000], "rtk_out": b[:20000]})
    print(f"{len(a):7d} -> {len(b):7d}  {cmd[:90]}", flush=True)
json.dump(rows, open(OUT, "w"), indent=1)
