"""Replay captured client request bodies through a running NadirClaw and report the tier.

NadirClaw must run with SIMPLE=openai/local-flash, COMPLEX=openai/cloud-big and
NADIRCLAW_API_BASE pointed at stub.py, so the stub log shows which tier was hit.

usage: nadirclaw_route_probe.py NADIRCLAW_URL STUB_LOG BODY_DIR [BODY_DIR ...]
"""
import glob, json, os, sys, urllib.request

NC, STUB_LOG, DIRS = sys.argv[1], sys.argv[2], sys.argv[3:]
LAST_USER_PREVIEW_CHARS = 80

def last_stub_model():
    with open(STUB_LOG) as f:
        return json.loads(f.readlines()[-1])["model"]

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""

for d in DIRS:
    for path in sorted(glob.glob(os.path.join(d, "*.json"))):
        body = json.load(open(path))
        if "messages" not in body:
            print(f"{d.rstrip('/').split('/')[-1]}/{os.path.basename(path)}: not a chat-completions body, skipped")
            continue
        body["model"] = "auto"
        body["stream"] = False
        body.pop("stream_options", None)
        req = urllib.request.Request(f"{NC}/v1/chat/completions", json.dumps(body).encode(),
                                     {"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=60).read()
        msgs = body["messages"]
        users = [m for m in msgs if m.get("role") == "user"]
        system = sum(len(text_of(m.get("content"))) for m in msgs if m.get("role") in ("system", "developer"))
        print(f"{d.rstrip('/').split('/')[-1]}/{os.path.basename(path)}: -> {last_stub_model():<11} "
              f"tools={len(body.get('tools') or [])} msgs={len(msgs)} tool_msgs={sum(m.get('role')=='tool' for m in msgs)} "
              f"system_chars={system} last_user={text_of(users[-1]['content'])[:LAST_USER_PREVIEW_CHARS]!r}" if users else "")
