#!/usr/bin/env python3
"""Needle-in-a-haystack retrieval test, comparing KV cache quantisation.

Design notes:
  * temperature 0 / top_k 1 so we measure KV fidelity, not sampling noise.
  * One shared haystack with N needles at different depths, then one query per
    needle. The haystack is an identical prefix for every request, so
    llama.cpp's prompt cache makes queries after the first cheap.
  * Needles are 6-digit codes -- unambiguous to score, and not guessable.
"""
import json, os, sys, time, urllib.request, random

PORT = sys.argv[1] if len(sys.argv) > 1 else "8080"
ALIAS = os.environ.get("MODEL_ALIAS_DEFAULT", "qwen3.8-27b")
TARGET_TOKENS = int(sys.argv[2]) if len(sys.argv) > 2 else 60000

CITIES = ["Trondheim","Valparaiso","Kaohsiung","Ljubljana","Mombasa",
          "Yekaterinburg","Fortaleza","Hakodate","Bratislava","Windhoek"]
DEPTHS = [0.04, 0.13, 0.27, 0.41, 0.55, 0.68, 0.82, 0.95]

rng = random.Random(20260816)

TOPICS = ["sediment core sampling","harbour dredging schedules","lighthouse optics",
          "freight manifest reconciliation","tidal gauge calibration","rope splicing standards",
          "ballast water treatment","chart datum corrections","buoy maintenance rotas",
          "customs bonded warehousing"]

def filler_paragraph(i):
    t = TOPICS[i % len(TOPICS)]
    n1, n2 = rng.randint(100, 999), rng.randint(10, 99)
    return (f"Section {i}. Notes on {t}. The working group reviewed {n1} records "
            f"during the {n2}th quarterly audit, noting that procedural drift remains "
            f"within tolerance. Follow-up actions were assigned to the regional office, "
            f"which will report at the next sitting. Historical comparisons suggest the "
            f"variance is seasonal rather than structural, though the sample remains small.")

def tokens(text):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/tokenize",
        data=json.dumps({"content": text}).encode(), headers={"Content-Type":"application/json"})
    return len(json.load(urllib.request.urlopen(req))["tokens"])

# ---- build haystack sized to TARGET_TOKENS ----
per = tokens(filler_paragraph(0))
n_paras = int(TARGET_TOKENS / per) + 1
paras = [filler_paragraph(i) for i in range(n_paras)]

needles = []
for idx, (city, depth) in enumerate(zip(CITIES, DEPTHS)):
    code = str(100000 + rng.randint(0, 899999))
    pos = int(len(paras) * depth)
    paras.insert(pos, f"IMPORTANT RECORD: In the archives of {city}, the vault access code is {code}.")
    needles.append({"city": city, "code": code, "depth": depth})

haystack = "\n\n".join(paras)
hay_tokens = tokens(haystack)
print(f"haystack: {len(paras)} paragraphs, {hay_tokens} tokens, {len(needles)} needles", flush=True)

def ask(city):
    body = {"model":ALIAS,"max_tokens":600,
            "temperature":0,"top_k":1,"top_p":1.0,
            "messages":[{"role":"user","content":
              haystack + f"\n\nQuestion: What is the vault access code for {city}? "
                         f"Reply with only the six-digit number."}]}
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions",
        data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    t0 = time.time()
    d = json.load(urllib.request.urlopen(req, timeout=900))
    return d["choices"][0]["message"]["content"], d["usage"], time.time()-t0

results = []
for n in needles:
    txt, usage, dt = ask(n["city"])
    hit = n["code"] in txt
    results.append({**n, "hit": hit, "reply": txt.strip()[:60], "s": round(dt,1),
                    "prompt_tokens": usage["prompt_tokens"]})
    print(f"  depth {n['depth']:.2f}  {'HIT ' if hit else 'MISS'}  "
          f"want={n['code']}  got={txt.strip()[:40]!r}  ({dt:.1f}s)", flush=True)

score = sum(r["hit"] for r in results)
print(json.dumps({"score": score, "total": len(results),
                  "haystack_tokens": hay_tokens, "results": results}))
