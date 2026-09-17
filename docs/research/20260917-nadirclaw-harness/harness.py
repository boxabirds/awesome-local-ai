"""Measure NadirClaw proxy overhead and routing decisions against a recording stub."""
import json, statistics, sys, time, urllib.request, uuid

NC = sys.argv[1]            # nadirclaw base, e.g. http://127.0.0.1:18856
STUB = sys.argv[2]          # stub base, e.g. http://127.0.0.1:18010
STUB_LOG = sys.argv[3]
WARM_N = 100
WARMUP_N = 5

def post(url, body):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"})
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return (time.perf_counter() - t) * 1000, data

def last_stub():
    with open(STUB_LOG) as f:
        return json.loads(f.readlines()[-1])

def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]

def summarise(name, xs):
    print(f"  {name:<28} median={statistics.median(xs):7.2f}ms  p95={pct(xs,95):7.2f}ms  n={len(xs)}")

def msg(text):
    return {"messages": [{"role": "user", "content": text}]}

# ---- E1: overhead -------------------------------------------------------
print("E1 overhead (stub upstream responds instantly)")
cold_ms, _ = post(f"{NC}/v1/chat/completions", msg(f"cold {uuid.uuid4()} what is 2+2?"))
print(f"  first request after start      {cold_ms:.1f}ms")
for _ in range(WARMUP_N):
    post(f"{NC}/v1/chat/completions", msg(f"warm {uuid.uuid4()}"))
direct, proxied, classify = [], [], []
for i in range(WARM_N):
    body = msg(f"[{uuid.uuid4()}] Format this JSON: {{\"a\":1}}")
    ms, _ = post(f"{STUB}/v1/chat/completions", {**body, "model": "local-flash"}); direct.append(ms)
    ms, data = post(f"{NC}/v1/chat/completions", body); proxied.append(ms)
    cl = (data.get("nadirclaw_metadata") or {}).get("classifier_latency_ms")
    if cl is not None: classify.append(cl)
summarise("direct to stub", direct)
summarise("via nadirclaw", proxied)
print(f"  added per request (median)     {statistics.median(proxied) - statistics.median(direct):.2f}ms")
if classify: summarise("classifier (self-reported)", classify)

# ---- E2: routing matrix ---------------------------------------------------
print("\nE2 routing: which upstream model received the request")
TOOLS = [{"type": "function", "function": {"name": n, "description": n, "parameters": {"type": "object", "properties": {}}}}
         for n in ("read", "write", "edit", "bash", "grep", "glob")]
AGENT_SYS = "You are OpenCode, an interactive coding agent. You can execute commands and edit files. " + "Follow the rules. " * 60
cases = [
    ("trivial, no tools", msg("What is 2+2?")),
    ("hard, no tools", msg("Design a distributed rate limiter with consistent hashing and explain failure modes")),
    ("trivial + 1 tool", {**msg("What is 2+2?"), "tools": TOOLS[:1]}),
    ("trivial + 6 tools", {**msg("What is 2+2?"), "tools": TOOLS}),
    ("OpenCode-shaped: sys+tools, 'rename x to y'", {"messages": [{"role": "system", "content": AGENT_SYS},
                                                                   {"role": "user", "content": "rename variable x to y in utils.py"}], "tools": TOOLS}),
    ("agent sys prompt only, no tools", {"messages": [{"role": "system", "content": AGENT_SYS},
                                                      {"role": "user", "content": "rename variable x to y"}]}),
]
for name, body in cases:
    # a unique first user message per case, so session pinning never carries over
    body = json.loads(json.dumps(body))
    for m in body["messages"]:
        if m["role"] == "user": m["content"] = f"[{uuid.uuid4().hex[:6]}] " + m["content"]
    _, data = post(f"{NC}/v1/chat/completions", body)
    meta = data.get("nadirclaw_metadata") or {}
    mods = (meta.get("routing_modifiers") or {}).get("modifiers_applied")
    print(f"  {name:<44} -> {last_stub()['model']:<12} tier={meta.get('tier')} modifiers={mods}")

# ---- E3: parameter passthrough ------------------------------------------
print("\nE3 passthrough of local-server params")
body = msg(f"[{uuid.uuid4()}] What is 2+2?")
body.update({"reasoning_effort": "low", "chat_template_kwargs": {"enable_thinking": False},
             "top_k": 20, "presence_penalty": 1.5, "temperature": 0.7, "top_p": 0.8})
post(f"{NC}/v1/chat/completions", body)
print(f"  sent:     {sorted(k for k in body if k != 'messages')}")
print(f"  received: {[k for k in last_stub()['body_keys'] if k not in ('messages', 'model')]}")

# ---- E4: session pinning --------------------------------------------------
print("\nE4 session pinning (same system + first user message)")
first = f"[{uuid.uuid4().hex[:6]}] Design a distributed rate limiter with consistent hashing and explain failure modes"
convo = [{"role": "user", "content": first}]
post(f"{NC}/v1/chat/completions", {"messages": convo}); print(f"  turn 1 (hard)            -> {last_stub()['model']}")
convo += [{"role": "assistant", "content": "ok"}, {"role": "user", "content": "thanks, what is 2+2?"}]
post(f"{NC}/v1/chat/completions", {"messages": convo}); print(f"  turn 2 (trivial)         -> {last_stub()['model']}")
