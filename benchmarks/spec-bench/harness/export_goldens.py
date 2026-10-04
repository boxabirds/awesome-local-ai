"""export_goldens.py — what the harness's Python parsers say about the fixture logs, as JSON, for the Rust ingest.

dbench's ingest (tools/dbench/src/ingest) reads the same logs in Rust: the agent's event logs, llama-server's
log, gufo's, mlx-serve's and Strata's, and the flag tables of the insights scripts. Two readers of one format
drift unless something holds them together. This script runs the Python parsers, the ones the harness itself
records with, over every fixture here and writes their output to tools/dbench/tests/golden/; the Rust tests
assert their output equals it. When a Python parser changes (its VERSION bumps, a regex moves), the goldens
change, the Rust tests fail, and the port is brought up to date the same day.

    uv run export_goldens.py            # write the goldens
    uv run export_goldens.py --check    # exit 1 when the goldens on disk are not what the parsers say now

The release checks (tools/dbench/checks.toml) run --check.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import accounting
import engine_log
import llama_log

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
GOLDEN = REPO / "tools/dbench/tests/golden"
FIXTURES = HERE / "fixtures"
sys.path.insert(0, str(REPO / "benchmarks/docs/insights/scripts"))
import reduce_lib  # noqa: E402

START = 1790390000.0
FOREVER = 1e12                 # a window that holds every event of a fixture with no window of its own
LOGS = ["pi-smoke-events.jsonl", "claude-stream.jsonl"] + [f"accounting/{c['log']}" for c in json.loads((FIXTURES / "accounting/cases.json").read_text())]
ENGINE_LOGS = ["gufo-excerpt.txt", "mlx-serve-excerpt.txt", "strata-excerpt.txt"]
SKIP = ('"message_update"', '"agent_end"', '"turn_end"', '"message_start"', '"tool_execution_update"', '"stream_event"')
PRE = 90


def windows(name: str) -> list[list[float]]:
    for c in json.loads((FIXTURES / "accounting/cases.json").read_text()):
        if f"accounting/{c['log']}" == name:
            return c["windows"]
    return [[0.0, FOREVER]]


def text_of(content):
    if isinstance(content, str):
        return content
    return "".join((b.get("text") or "") for b in (content or []) if isinstance(b, dict) and b.get("type") == "text")


def rows(path: Path) -> dict:
    """The warehouse rows of one log: build_full.py's parse, as it was on 3 Oct 2026 (the DB the detect scripts read)."""
    clean = lambda s: reduce_lib.HOME.sub("~", s) if isinstance(s, str) else s
    ntr = ctr = 0
    fmt = None
    calls, tools, order, msgs, comps, by_mid = [], {}, [], [], [], {}
    comp_start = None
    with path.open(errors="replace") as f:
        for line in f:
            if any(s in line[:PRE] for s in SKIP):
                continue
            for mt in reduce_lib.TRUNC.finditer(line):
                ntr += 1
                ctr += int(mt.group(1))
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if not isinstance(e, dict):
                continue
            t, rx = e.get("type"), e.get("_rx")
            if t == "message_end":
                fmt = "pi"
                msg = e.get("message") or {}
                role = msg.get("role")
                if role == "assistant":
                    c = msg.get("content") if isinstance(msg.get("content"), list) else []
                    th = clean("".join(b.get("thinking") or "" for b in c if b.get("type") == "thinking"))
                    tx = clean(text_of(c))
                    tcs = [b for b in c if b.get("type") == "toolCall"]
                    u = msg.get("usage") or {}
                    idx = len(calls)
                    calls.append([idx, rx, len(th), len(tx), len(tcs), u.get("output"), u.get("input"), u.get("cacheRead"), msg.get("stopReason"), 0,
                                  ",".join(reduce_lib.flags(reduce_lib.TEXT_RX, th)), ",".join(reduce_lib.flags(reduce_lib.TEXT_RX, tx)), th, tx])
                    for b in tcs:
                        a = b.get("arguments") or {}
                        aj = clean(json.dumps(a, ensure_ascii=False))
                        arg = a.get("command") if b.get("name") == "bash" else a.get("path")
                        arg = clean(str(arg if arg is not None else aj))
                        ne, oc, nc = reduce_lib.edit_sizes(a)
                        tools[b.get("id")] = dict(call=idx, name=b.get("name"), arg=arg, aj=aj, start=None, end=None, err=None, res=None, sub=0, ne=ne, oc=oc, nc=nc)
                        order.append(b.get("id"))
                elif role == "user":
                    tx = clean(text_of(msg.get("content")))
                    msgs.append([len(msgs), rx, "user", len(tx), tx])
            elif t == "tool_execution_start":
                d = tools.get(e.get("toolCallId"))
                if d:
                    d["start"] = rx
            elif t == "tool_execution_end":
                d = tools.get(e.get("toolCallId"))
                if d:
                    d.update(end=rx, err=int(bool(e.get("isError"))), res=clean(text_of((e.get("result") or {}).get("content"))))
            elif t == "compaction_start":
                comp_start = rx
            elif t == "compaction_end":
                r = e.get("result") or {}
                comps.append([comp_start, rx, e.get("reason"), len(r.get("summary") or ""), clean(r.get("summary") or "")])
                comp_start = None
            elif t == "assistant" and isinstance(e.get("message"), dict):
                fmt = "claude"
                msg = e["message"]
                mid = msg.get("id")
                sub = int(bool(e.get("parent_tool_use_id")))
                c = msg.get("content") if isinstance(msg.get("content"), list) else []
                if mid not in by_mid:
                    u = msg.get("usage") or {}
                    by_mid[mid] = len(calls)
                    calls.append([len(calls), rx, 0, 0, 0, u.get("output_tokens"), u.get("input_tokens"), u.get("cache_read_input_tokens"), msg.get("stop_reason"), sub, "", "", "", ""])
                row = calls[by_mid[mid]]
                for b in c:
                    if b.get("type") == "text":
                        tx = clean(b.get("text") or "")
                        row[13] += tx
                        row[3] = len(row[13])
                        row[11] = ",".join(reduce_lib.flags(reduce_lib.TEXT_RX, row[13]))
                    elif b.get("type") == "tool_use":
                        row[4] += 1
                        a = b.get("input") if isinstance(b.get("input"), dict) else {}
                        aj = clean(json.dumps(a, ensure_ascii=False))
                        arg = a.get("command") if b.get("name") == "Bash" else (a.get("file_path") or a.get("path") or a.get("pattern"))
                        arg = clean(str(arg if arg is not None else aj))
                        ne, oc, nc = reduce_lib.edit_sizes(a)
                        tools[b.get("id")] = dict(call=row[0], name=b.get("name"), arg=arg, aj=aj, start=rx, end=None, err=None, res=None, sub=sub, ne=ne, oc=oc, nc=nc)
                        order.append(b.get("id"))
            elif t == "user" and isinstance(e.get("message"), dict):
                c = e["message"].get("content")
                if isinstance(c, str):
                    msgs.append([len(msgs), rx, "user", len(c), clean(c)])
                else:
                    for b in c or []:
                        if isinstance(b, dict) and b.get("type") == "tool_result":
                            d = tools.get(b.get("tool_use_id"))
                            if d:
                                res = b.get("content")
                                res = res if isinstance(res, str) else text_of(res)
                                d.update(end=rx, err=int(bool(b.get("is_error"))), res=clean(res))
                        elif isinstance(b, dict) and b.get("type") == "text" and not e.get("parent_tool_use_id"):
                            tx = clean(b.get("text") or "")
                            msgs.append([len(msgs), rx, "user", len(tx), tx])
    out_tools = []
    for i, tid in enumerate(order):
        d = tools[tid]
        res = d["res"]
        sm = reduce_lib.summary(res) if res else {}
        out_tools.append({"idx": i, "tid": tid, "call": d["call"], "name": d["name"], "arg": d["arg"], "arg_chars": len(d["aj"]),
                          "start": d["start"], "end": d["end"], "error": d["err"], "res_chars": len(res) if res is not None else None,
                          "sub": d["sub"], "arg_flags": reduce_lib.flags(reduce_lib.ARG_RX, d["aj"]),
                          "res_flags": reduce_lib.flags(reduce_lib.RES_RX, res) if res else [], "n_edits": d["ne"], "old_chars": d["oc"],
                          "new_chars": d["nc"], "passed": sm.get("passed"), "failed": sm.get("failed"), "flaky": sm.get("flaky"),
                          "skipped": sm.get("skipped"), "args_json": d["aj"], "res": res})
    return {"fmt": fmt, "truncated_strings": ntr, "truncated_chars": ctr,
            "calls": [{"idx": c[0], "rx": c[1], "think": c[2], "text": c[3], "n_tools": c[4], "out_tok": c[5], "in_tok": c[6], "cache_tok": c[7],
                       "stop": c[8], "sub": c[9], "think_flags": c[10].split(",") if c[10] else [], "text_flags": c[11].split(",") if c[11] else [],
                       "think_full": c[12], "text_full": c[13]} for c in calls],
            "tools": out_tools,
            "msgs": [{"idx": m[0], "rx": m[1], "role": m[2], "chars": m[3], "text": m[4]} for m in msgs],
            "compactions": [{"start": c[0], "end": c[1], "reason": c[2], "summary_chars": c[3], "summary": c[4]} for c in comps]}


def timing(path: Path, t_to: float) -> dict:
    p = accounting.parse(path, t_to)
    return {"source": p.source, "abandoned": p.abandoned, "problems": p.problems,
            "calls": [[c.sent, c.first, c.end, c.fresh, c.cached, c.out] for c in p.calls],
            "tools": [list(t) for t in p.tools], "cut_tools": [list(t) for t in p.cut_tools],
            "compactions": [list(c) for c in p.compactions], "cut_compactions": [list(c) for c in p.cut_compactions],
            "suspended": [list(s) for s in p.suspended], "between": [list(b) for b in p.between]}


def call(sent, fresh, cached, out):
    return accounting.Call(sent, sent + 1, sent + 2, fresh, cached, out)


def engine_text(name: str, epoch: float | None = START) -> str:
    body = (FIXTURES / "engine-logs" / name).read_text()
    return (llama_log.start_marker(epoch) if epoch is not None else "") + body


def match_case(text: str, calls: list) -> dict:
    reqs = engine_log.parse(text)
    got = engine_log.match(reqs, calls)
    by_id = {id(r): i for i, r in enumerate(reqs)}
    return {"text": text, "calls": [[c.sent, c.first, c.end, c.fresh, c.cached, c.out] for c in calls],
            "matched": [by_id[id(r)] if r is not None else None for r in got]}


def engine_cases() -> dict:
    from test_llama_log import PROGRESS, SMOKE
    mlx_line = "  <- {}+{} tokens streamed [prefill: 1 tok/s, decode: 1 tok/s] [stop]\n"
    same_tokens = llama_log.start_marker(START) + "".join(mlx_line.format(p, g) for p, g in ((10, 1), (20, 2), (10, 1), (30, 3), (40, 4)))
    parses = {name: engine_log.parse(engine_text(name)) for name in ENGINE_LOGS}
    parses["gufo-no-marker"] = engine_log.parse(engine_text("gufo-excerpt.txt", None))
    parses["mlx-no-draft"] = engine_log.parse(llama_log.start_marker(START) + mlx_line.format(10, 2))
    parses["two-runs"] = engine_log.parse(engine_text("gufo-excerpt.txt") + engine_text("gufo-excerpt.txt", START + 100))
    matches = {
        "gufo-two-runs": match_case(engine_text("gufo-excerpt.txt") + engine_text("gufo-excerpt.txt", START + 100),
                                    [call(START + 1, 2049, 0, 103), call(START + 2, 1, 1, 1), call(START + 3, 3382, 2152, 55),
                                     call(START + 101, 3382, 2152, 55), call(START + 102, 2049, 0, 103)]),
        "no-output-tokens": match_case(engine_text("gufo-excerpt.txt"), [call(START + 1, 2049, 0, None)]),
        "same-tokens-earlier-story": match_case(same_tokens, [call(START + 1, 10, 0, 1), call(START + 2, 30, 0, 3), call(START + 3, 40, 0, 4)]),
        "mlx": match_case(engine_text("mlx-serve-excerpt.txt"), [call(START + 1, p["prompt"], 0, p["gen"]) for p in parses["mlx-serve-excerpt.txt"][:3]]),
        "strata": match_case(engine_text("strata-excerpt.txt"), [call(START + 1, 37, 54460, 114), call(START + 2, 56, 54492, 98)]),
    }
    summaries = {name: engine_log.summarise(reqs) for name, reqs in parses.items()}
    llama_text = llama_log.start_marker(START) + SMOKE + PROGRESS
    two = llama_log.start_marker(START) + SMOKE.replace("0.41.759", "75.02.000") + llama_log.start_marker(START + 9000) + SMOKE
    llama = {"smoke": {"text": llama_text, "requests": llama_log.parse(llama_text), "summary": llama_log.summarise(llama_log.parse(llama_text), 0.0, FOREVER)},
             "two-starts": {"text": two, "requests": llama_log.parse(two), "summary": llama_log.summarise(llama_log.parse(two), START + 9000, FOREVER)},
             "no-marker": {"text": SMOKE, "requests": llama_log.parse(SMOKE), "summary": llama_log.summarise([], 0.0, FOREVER)}}
    return {"engine": {"texts": {name: engine_text(name) for name in ENGINE_LOGS}, "parsed": parses, "summaries": summaries, "matches": matches},
            "llama": llama}


FLAG_PROBES = [
    "Permission denied: EACCES on /Users/tester/x", "zsh: command not found: foo", "ENOENT: No such file or directory",
    "Error: listen EADDRINUSE: address already in use", "Test timeout of 30000ms exceeded", "Could not find oldText in file",
    "src/a.ts(1,2): error TS2345", "SyntaxError: Unexpected token", "Cannot find module 'x'", "npm ERR! code 1",
    "Killed", "FATAL ERROR: heap out of memory", "ENOSPC: No space left on device", "Segmentation fault (core dumped)",
    "getaddrinfo ENOTFOUND registry", "3 failed, 12 passed, 1 flaky, 2 skipped", "✘ test", "Executable doesn't exist at",
    "sandbox-exec: deny(file-read", "[... truncated 300 chars]", "...[truncated 12 chars] and more", "…[truncated 5 chars]",
    "test.skip('x')", "it.only('y')", "// @ts-ignore\nconst a = b as any", "await page.waitForTimeout(500)", "console.log('hi')",
    "// TODO later", "retries: 2", "git push --force", "你好", "I'm stuck and cannot proceed", "Is that right?",
    "all tests pass, fully implemented", "for now a workaround", "a pre-existing flaky environment issue", "The harness being evaluated",
    "", "plain text with nothing in it",
]
EDIT_PROBES = [{"edits": [{"oldText": "abc", "newText": "abcd"}, {"old_string": "x", "new_string": "yy"}]}, {"oldText": "old", "newText": "new"},
               {"old_string": "a"}, {"content": "file body"}, {"command": "ls"}, {}]


def flags_cases() -> dict:
    return {"probes": [{"text": s, "res": reduce_lib.flags(reduce_lib.RES_RX, s), "arg": reduce_lib.flags(reduce_lib.ARG_RX, s),
                        "text_flags": reduce_lib.flags(reduce_lib.TEXT_RX, s), "summary": reduce_lib.summary(s) if s else {},
                        "home": reduce_lib.HOME.sub("~", s)} for s in FLAG_PROBES],
            "edits": [{"args": a, "sizes": list(reduce_lib.edit_sizes(a))} for a in EDIT_PROBES]}


def build() -> dict[str, object]:
    out: dict[str, object] = {}
    for name in LOGS:
        path = FIXTURES / name
        key = name.replace("/", "__").removesuffix(".jsonl")
        out[f"rows/{key}.json"] = rows(path)
        out[f"timing/{key}.json"] = {"t_to": max(b for _, b in windows(name)), **timing(path, max(b for _, b in windows(name)))}
    out.update({f"{k}.json": v for k, v in engine_cases().items()})
    out["flags.json"] = flags_cases()
    return out


def finite(v):
    """JSON has no infinities: a non-finite float (engine_log's NO_RUN_START) is written as the string "-inf"/"inf"/"nan"."""
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return "nan" if v != v else ("inf" if v > 0 else "-inf")
    if isinstance(v, dict):
        return {k: finite(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [finite(x) for x in v]
    return v


def dump(v) -> str:
    return json.dumps(finite(v), indent=1, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"


def main(argv: list[str]) -> int:
    want = build()
    if "--check" in argv:
        stale = [k for k, v in want.items() if not (GOLDEN / k).exists() or (GOLDEN / k).read_text() != dump(v)]
        extra = sorted(str(p.relative_to(GOLDEN)) for p in GOLDEN.rglob("*.json") if str(p.relative_to(GOLDEN)) not in want)
        for k in stale:
            print(f"stale: {k}")
        for k in extra:
            print(f"not produced any more: {k}")
        if stale or extra:
            print("the goldens differ from what the parsers say now: run export_goldens.py and update the Rust ingest")
            return 1
        print(f"goldens current: {len(want)} files")
        return 0
    for k, v in want.items():
        p = GOLDEN / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(dump(v))
    print(f"wrote {len(want)} goldens to {GOLDEN}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
