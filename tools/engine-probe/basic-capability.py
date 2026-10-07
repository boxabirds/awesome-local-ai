#!/usr/bin/env python3
"""Ten minutes that say whether a stack is worth a day of benchmarking.

A benchmark series costs machine-days. This asks a running OpenAI-compatible server a handful of short questions
whose answers are checkable by machine, and reports what it got back. It is not a benchmark and not a story: the
repository's rule is that a story is never a smoke run, so this stays at the scale of a few requests.

Two halves, with different standing:

  PLUMBING  does the stack work at all -- generation, a structured tool call, a tool call whose arguments carry
            raw newlines (the defect gufo has had repeatedly), prompt reuse, and a long prompt being admitted.
            A failure here means a series would measure the plumbing rather than the model, so the result would
            be worthless rather than merely bad. Do not proceed.

  BASIC     can it do the kind of thing the pack asks for -- follow an exact instruction, write a function that
            runs, call a tool with the right arguments, and keep a mandated literal string unchanged. A weak
            answer is not disqualifying for a model we expect to be weak; no runnable code or no well-formed
            tool call at all is. This half reports, it does not decide.

The literal-preservation probe is a thirty-second version of FM-2 (contract drift) from
benchmarks/docs/failure-modes.md, the failure that cost one run twenty-one held-out tests from a single changed
attribute. If a stack drifts off an exact required string here, that is worth knowing before the machine-days.

    uv run tools/engine-probe/basic-capability.py --base-url http://127.0.0.1:18010/v1 --model qwen3.6-35b-a3b
    uv run tools/engine-probe/basic-capability.py --self-test      # the judging, against fixed responses
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

# A probe gets one minute; a long-context one gets five. Beyond that the stack is too slow to benchmark anyway.
TIMEOUT_S = 60
LONG_TIMEOUT_S = 300
# The long-prompt probe. The pack needs 128k; filler is cheap tokens, so this says "admitted", not "used well".
LONG_PROMPT_TOKENS = 120_000
WORDS_PER_TOKEN = 0.75
# The literal a spec would mandate. Chosen to be the shape a model is tempted to "improve": a user-facing string
# with an obvious better wording.
MANDATED_LITERAL = 'aria-label="Sticky note"'

TOOL = {
    "type": "function",
    "function": {
        "name": "write_file",
        "description": "Write text to a file.",
        "parameters": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "contents": {"type": "string"}},
            "required": ["path", "contents"],
        },
    },
}


class Probe:
    """One question and the check on its answer. `check` returns (ok, what_was_seen)."""

    def __init__(self, name: str, half: str, body: dict, check, timeout: int = TIMEOUT_S):
        self.name, self.half, self.body, self.check, self.timeout = name, half, body, check, timeout


# Several of these models default to thinking ON, and then spend a small token budget reasoning and return empty
# content with finish_reason "length" -- which reads as "the engine is broken" when the model is working fine.
# lib/smoke.sh warns about exactly this. A probe that wants a short exact answer turns thinking off the way
# lib/gufo.sh's own smoke check does; the rest get a budget big enough to think AND answer.
NO_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}


def ask(base_url: str, body: dict, timeout: int) -> dict:
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def message(resp: dict) -> dict:
    return (resp.get("choices") or [{}])[0].get("message") or {}


def ran_out_thinking(resp: dict) -> str | None:
    """The distinctive failure of a thinking-by-default model on too small a budget: all reasoning, no answer."""
    choice = (resp.get("choices") or [{}])[0]
    m = choice.get("message") or {}
    reasoning = m.get("reasoning_content") or m.get("reasoning") or ""
    if not (m.get("content") or "").strip() and reasoning and choice.get("finish_reason") == "length":
        return f"spent its whole token budget thinking and never answered ({len(reasoning)} characters of reasoning)"
    return None


def text_of(resp: dict) -> str:
    return (message(resp).get("content") or "").strip()


def tool_calls_of(resp: dict) -> list:
    return message(resp).get("tool_calls") or []


# ---- the checks ---------------------------------------------------------------------------------------------
# Each takes the whole response and returns (ok, what was seen), so a failure reports the model's own words
# rather than a verdict.

def says_exactly(want: str):
    def check(resp):
        spent = ran_out_thinking(resp)
        if spent:
            return False, spent
        got = text_of(resp)
        return got == want, repr(got)
    return check


def returns_tool_call(resp):
    calls = tool_calls_of(resp)
    if not calls:
        # The known failure: the call comes back as prose instead of a structured call.
        return False, f"no tool_calls; content was {text_of(resp)[:160]!r}"
    fn = (calls[0].get("function") or {})
    return fn.get("name") == "write_file", f"tool_calls[0].function.name={fn.get('name')!r}"


def tool_call_keeps_newlines(resp):
    calls = tool_calls_of(resp)
    if not calls:
        return False, f"no tool_calls; content was {text_of(resp)[:160]!r}"
    raw = (calls[0].get("function") or {}).get("arguments") or ""
    try:
        args = json.loads(raw)
    except ValueError as e:
        return False, f"arguments are not JSON ({e}): {raw[:160]!r}"
    contents = args.get("contents") or ""
    return "\n" in contents, f"contents had {contents.count(chr(10))} newlines: {contents[:80]!r}"


def keeps_literal(resp):
    spent = ran_out_thinking(resp)
    if spent:
        return False, spent
    got = text_of(resp)
    return MANDATED_LITERAL in got, f"{MANDATED_LITERAL!r} {'present' if MANDATED_LITERAL in got else 'ABSENT'} in {got[:200]!r}"


def code_runs_and_answers(expected: str):
    """Extract a python block, run it in a temp dir, and compare stdout. The point is that the code RUNS."""
    def check(resp):
        got = text_of(resp)
        block = got
        if "```" in got:
            parts = got.split("```")
            if len(parts) >= 2:
                block = parts[1]
                if block.startswith("python"):
                    block = block[len("python"):]
        spent = ran_out_thinking(resp)
        if spent:
            return False, spent
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "probe.py"
            f.write_text(block)
            try:
                out = subprocess.run([sys.executable, str(f)], capture_output=True, text=True, timeout=20)
            except subprocess.TimeoutExpired:
                return False, "the code did not finish in 20 s"
        printed = (out.stdout or "").strip()
        if out.returncode != 0:
            return False, f"exit {out.returncode}: {(out.stderr or '')[-200:].strip()!r}"
        return printed == expected, f"printed {printed!r}"
    return check


def long_prompt_admitted(resp):
    got = text_of(resp)
    return bool(got), f"answered with {len(got)} characters"


def probes(model: str) -> list[Probe]:
    msg = lambda role, content: {"role": role, "content": content}
    filler = "the quick brown fox jumps over the lazy dog " * int(LONG_PROMPT_TOKENS * WORDS_PER_TOKEN / 9)
    return [
        # ---- plumbing ----
        Probe("generates at all", "PLUMBING",
              {"model": model, "messages": [msg("user", "Reply with exactly: OK")], "max_tokens": 256, **NO_THINKING},
              says_exactly("OK")),
        Probe("returns a structured tool call", "PLUMBING",
              {"model": model, "tools": [TOOL], "max_tokens": 2048,
               "messages": [msg("user", "Create a file notes.txt containing the single word hello. Use the tool.")]},
              returns_tool_call),
        Probe("a tool call whose arguments contain raw newlines", "PLUMBING",
              {"model": model, "tools": [TOOL], "max_tokens": 2048,
               "messages": [msg("user", "Use the tool to write a file poem.txt whose contents are exactly three "
                                        "lines: 'one', 'two', 'three', each on its own line.")]},
              tool_call_keeps_newlines),
        Probe(f"admits a ~{LONG_PROMPT_TOKENS // 1000}k-token prompt", "PLUMBING",
              {"model": model, "max_tokens": 256, **NO_THINKING,
               "messages": [msg("user", filler + "\n\nIgnore the text above. Reply with exactly: READ")]},
              says_exactly("READ"), LONG_TIMEOUT_S),
        # ---- basic capability ----
        # Thinking stays ON here: this is the shape the pack's agent actually runs in, and a budget big enough to
        # reason and then answer is part of what is being checked.
        Probe("writes code that runs and gives the right answer", "BASIC",
              {"model": model, "max_tokens": 4096,
               "messages": [msg("user", "Write a complete Python program that prints the 10th Fibonacci number "
                                        "(with fib(1)=1, fib(2)=1). Print only the number. Reply with the code "
                                        "in one ```python block and nothing else.")]},
              code_runs_and_answers("55"), LONG_TIMEOUT_S),
        Probe("keeps a mandated literal unchanged (FM-2)", "BASIC",
              {"model": model, "max_tokens": 4096,
               "messages": [msg("user", 'The specification REQUIRES this exact attribute on the element, '
                                        'character for character: aria-label="Sticky note". '
                                        "Write the single-line JSX for a <div> carrying that attribute and "
                                        "nothing else. Reply with the line only.")]},
              keeps_literal, LONG_TIMEOUT_S),
        Probe("keeps context across turns", "BASIC",
              {"model": model, "max_tokens": 256, **NO_THINKING,
               "messages": [msg("user", "My favourite number is 41."), msg("assistant", "Noted."),
                            msg("user", "Add one to my favourite number. Reply with the number only.")]},
              says_exactly("42")),
    ]


def run(base_url: str, model: str) -> int:
    results = []
    for p in probes(model):
        try:
            resp = ask(base_url, p.body, p.timeout)
            ok, saw = p.check(resp)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            ok, saw = False, f"request failed: {e}"
        except (ValueError, KeyError) as e:
            ok, saw = False, f"unreadable response: {e}"
        results.append((p.half, p.name, ok, saw))
        print(f"  {'ok  ' if ok else 'FAIL'} [{p.half}] {p.name}\n         {saw}")

    plumbing_bad = [n for h, n, ok, _ in results if h == "PLUMBING" and not ok]
    basic_bad = [n for h, n, ok, _ in results if h == "BASIC" and not ok]
    print()
    if plumbing_bad:
        print(f"PLUMBING FAILED: {', '.join(plumbing_bad)}")
        print("Do not queue a series: a fault here would be measured instead of the model.")
        return 1
    print("Plumbing: all checks passed.")
    if basic_bad:
        print(f"Basic capability, not passed: {', '.join(basic_bad)}")
        print("Report these to the owner with what was seen; they are a judgement, not a gate.")
        return 2
    print("Basic capability: all checks passed.")
    return 0


# ---- self-test ----------------------------------------------------------------------------------------------
# The judging has to be right or the gate is theatre: a check that passes on a bad answer is worse than no check.

def self_test() -> int:
    def resp(content=None, tool=None):
        m = {"content": content}
        if tool is not None:
            m["tool_calls"] = [{"function": {"name": "write_file", "arguments": json.dumps(tool)}}]
        return {"choices": [{"message": m}]}

    def thought(reasoning):
        """A thinking model that used its whole budget reasoning: empty content, finish_reason "length"."""
        return {"choices": [{"message": {"content": "", "reasoning_content": reasoning}, "finish_reason": "length"}]}

    cases = [
        ("exact match", says_exactly("OK"), resp("OK"), True),
        ("exact match, trailing space", says_exactly("OK"), resp("OK  "), True),
        ("exact match, chatty", says_exactly("OK"), resp("Sure! OK"), False),
        ("tool call present", returns_tool_call, resp(None, {"path": "a", "contents": "b"}), True),
        ("tool call returned as prose", returns_tool_call, resp('I will call write_file({"path": "a"})'), False),
        ("newlines kept", tool_call_keeps_newlines, resp(None, {"path": "p", "contents": "one\ntwo\nthree"}), True),
        ("newlines flattened", tool_call_keeps_newlines, resp(None, {"path": "p", "contents": "one two three"}), False),
        ("literal kept", keeps_literal, resp('<div aria-label="Sticky note" />'), True),
        ("literal drifted", keeps_literal, resp('<div aria-label={`Sticky note, ${c}`} />'), False),
        ("code runs", code_runs_and_answers("55"), resp("```python\nprint(55)\n```"), True),
        ("code wrong answer", code_runs_and_answers("55"), resp("```python\nprint(54)\n```"), False),
        ("code does not run", code_runs_and_answers("55"), resp("```python\nprint(\n```"), False),
        # The trap that made the first run of this probe report a working stack as broken.
        ("all budget spent thinking", says_exactly("OK"), thought("Here is a thinking process: ..."), False),
    ]
    bad = 0
    for name, check, r, want in cases:
        got, saw = check(r)
        if got == want:
            print(f"  ok   {name}")
        else:
            bad += 1
            print(f"  FAIL {name}: wanted {want}, got {got} ({saw})")
    print()
    print("all checks passed" if not bad else f"{bad} FAILED")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", help="e.g. http://127.0.0.1:18010/v1")
    ap.add_argument("--model", default="", help="the served model name")
    ap.add_argument("--self-test", action="store_true", help="check the judging against fixed responses")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    if not a.base_url:
        ap.error("--base-url is required (or use --self-test)")
    return run(a.base_url, a.model)


if __name__ == "__main__":
    sys.exit(main())
