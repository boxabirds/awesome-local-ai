import json, sys, collections
lines = open(sys.argv[1], errors="replace").readlines()
start = max(i for i, l in enumerate(lines) if '"type":"message_start"' in l[:60] or '"message_start"' in l[:40])
buf = []
for l in lines[start:]:
    if "thinking_delta" in l or "text_delta" in l:
        try:
            buf.append(json.loads(l)["assistantMessageEvent"].get("delta", ""))
        except Exception:
            pass
text = "".join(buf)
print("chars:", len(text))
print("--- first 600:\n", text[:600])
print("--- last 1500:\n", text[-1500:])
# repetition: most common 80-char lines
c = collections.Counter(s.strip() for s in text.splitlines() if len(s.strip()) > 30)
print("--- most repeated lines:")
for s, n in c.most_common(5):
    print(n, s[:150])
