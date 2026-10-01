"""uv run --with pytest pytest harness/test_clients.py"""
import json
import os
from pathlib import Path

from clients import PiClient, empty_state

FIXTURE = Path(__file__).parent / "fixtures" / "pi-smoke-events.jsonl"  # real pi 0.86.0 run vs MTPLX Flash-Next


def scan_all(events):
    c, st = PiClient(Path("/tmp")), empty_state()
    keys = [k for e in events if (k := c.scan(e, st)) is not None]
    return st, keys


def test_pi_real_stream_session_steps_tools_tokens():
    events = [json.loads(l) for l in FIXTURE.read_text().splitlines()]
    st, keys = scan_all(events)
    assert st["session"] == "01a0cf76-c7d8-71fb-a6e6-912206a3d4f8"
    assert st["steps"] == 5 and st["tool_calls"] == 4 and len(keys) == 4
    assert st["tokens"]["input"] == 2651 and st["tokens"]["output"] == 735
    assert st["tokens"]["reasoning"] == 230 and st["tokens"]["cache_read"] == 9121
    assert st["error"] is None
    assert json.loads(keys[0])[0] == "write"


def test_pi_error_then_successful_retry_clears_error():
    err = {"type": "message_end", "message": {"role": "assistant", "stopReason": "error",
                                              "errorMessage": "fetch failed", "usage": {}}}
    ok = {"type": "message_end", "message": {"role": "assistant", "stopReason": "stop", "usage": {}}}
    st, _ = scan_all([err])
    assert "fetch failed" in st["error"]
    st, _ = scan_all([err, ok])
    assert st["error"] is None


def test_pi_counts_compactions():
    st, _ = scan_all([{"type": "compaction_start"}, {"type": "compaction_end"}])
    assert st["compactions"] == 1


def test_pi_config_written_isolated(tmp_path):
    c = PiClient(tmp_path)
    c.write_config("http://127.0.0.1:1/v1", "m", 131072, 32768)
    models = json.loads((tmp_path / "pi-agent" / "models.json").read_text())
    m = models["providers"]["local"]["models"][0]
    assert m["compat"] == {"supportsDeveloperRole": False, "supportsReasoningEffort": False}
    assert c.env()["PI_CODING_AGENT_DIR"] == str(tmp_path / "pi-agent")
    settings = json.loads((tmp_path / "pi-agent" / "settings.json").read_text())
    assert settings["httpIdleTimeoutMs"] > 300_000


def test_pi_compacts_at_the_requested_context(tmp_path):
    """canvas-pi-01 story 4: the Mac panicked with MTPLX at 112-115k context. pi compacts when
    context > window - reserveTokens, so compacting at N means reserve = window - N."""
    c = PiClient(tmp_path)
    c.write_config("http://127.0.0.1:1/v1", "m", 131072, 32768, compact_at=90_000)
    s = json.loads((tmp_path / "pi-agent" / "settings.json").read_text())
    assert s["compaction"]["reserveTokens"] == 131072 - 90_000
    c.write_config("http://127.0.0.1:1/v1", "m", 131072, 32768)
    assert "compaction" not in json.loads((tmp_path / "pi-agent" / "settings.json").read_text())


# ---------- Claude Code (claude -p --output-format stream-json) ----------
CLAUDE_FIXTURE = Path(__file__).parent / "fixtures" / "claude-stream.jsonl"  # real Claude Code 2.1.282 run


def claude_scan(events):
    from clients import ClaudeClient
    c, st = ClaudeClient(Path("/tmp/w")), empty_state()
    keys = [k for e in events if (k := c.scan(e, st)) is not None]
    return st, keys


def test_claude_real_stream_session_steps_tools_tokens():
    st, keys = claude_scan([json.loads(l) for l in CLAUDE_FIXTURE.read_text().splitlines()])
    assert st["session"] == "684b77fd-5cfb-4d4b-b411-f572f78c76d8"
    assert st["steps"] == 2          # two model calls (assistant events share a message id per call)
    assert st["tool_calls"] == 2 and len(keys) == 2
    assert st["tokens"] == {"input": 18, "output": 343, "reasoning": 0, "cache_read": 39386, "cache_write": 12461}
    assert st["error"] is None


def test_claude_error_result_is_reported():
    st, _ = claude_scan([{"type": "system", "subtype": "init", "session_id": "s"},
                         {"type": "result", "subtype": "error_during_execution", "is_error": True,
                          "result": "API Error: 529 overloaded", "session_id": "s", "usage": {}}])
    assert st["error"] and "529" in st["error"]


def test_claude_command_is_headless_on_the_subscription_and_forks_on_resume():
    from clients import ClaudeClient
    c = ClaudeClient(Path("/tmp/w"))
    cmd = c.command("claude-opus-5-5", "do story 1")
    assert cmd[:3] == ["claude", "-p", "do story 1"]
    assert ["--model", "claude-opus-5-5"] == cmd[cmd.index("--model"):cmd.index("--model") + 2]
    assert "stream-json" in cmd and "--verbose" in cmd and "--dangerously-skip-permissions" in cmd
    assert "--bare" not in cmd       # bare mode ignores CLAUDE_CODE_OAUTH_TOKEN and would force API billing
    fork = c.command("m", "go on", resume_from="abc")
    assert fork[fork.index("--resume") + 1] == "abc" and "--fork-session" in fork
    nudge = c.command("m", "go on", resume_from="abc", fork=False)
    assert "--resume" in nudge and "--fork-session" not in nudge


def test_claude_env_isolates_config_and_hands_the_token_over_in_a_descriptor_never_in_the_environment(tmp_path, monkeypatch):
    from clients import ClaudeClient
    import sandbox
    token = tmp_path / "token"
    token.write_text("sk-ant-oat01-test\n")
    monkeypatch.setenv("CLAUDE_BENCH_TOKEN_FILE", str(token))
    c = ClaudeClient(tmp_path / "work", view=Path("/w"))
    env = c.env()
    assert env["CLAUDE_CONFIG_DIR"] == "/w/claude-config"                  # as the agent sees it, not where the run is
    assert "sk-ant-oat01-test" not in json.dumps(env) and "CLAUDE_CODE_OAUTH_TOKEN" not in env
    assert "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB" not in env                   # it would force the permission prompts back on
    assert c.secrets() == {"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-test"}
    assert c.presets == ("claude",)
    # What the sandbox does with it: a pipe, named by NAME_FILE_DESCRIPTOR, which the client reads once.
    fd_env, fds = sandbox.secret_fds(c.secrets())
    try:
        assert os.read(fds[0], 100) == b"sk-ant-oat01-test" and fd_env == {"CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR": str(fds[0])}
    finally:
        os.close(fds[0])
    assert set(env) | set(fd_env) <= set(sandbox.ENV_ALLOWED)


def test_the_local_clients_need_no_secret_and_no_host_beyond_the_defaults(tmp_path):
    from clients import OpenCodeClient
    for c in (PiClient(tmp_path), OpenCodeClient(tmp_path)):
        assert c.secrets() == {} and c.presets == ()


def test_pi_is_told_the_paths_the_agent_sees_and_writes_its_config_where_the_run_is(tmp_path):
    c = PiClient(tmp_path / "work", view=Path("/w"))
    c.write_config("http://127.0.0.1:1/v1", "m", 131072, 32768)
    assert (tmp_path / "work" / "pi-agent" / "models.json").is_file()
    assert c.env()["PI_CODING_AGENT_DIR"] == "/w/pi-agent"
    cmd = c.command("m", "do it")
    assert cmd[cmd.index("--session-dir") + 1] == "/w/pi-sessions"


def test_pi_sends_a_thinking_level_when_the_server_cannot_apply_one(tmp_path):
    """mlx-serve has no server-side effort: run.sh's REASONING_EFFORT=low reached its launcher and was
    ignored, so canvas-mlx-02 ran at the chat template's default (xhigh) while recorded as "low".
    With a client thinking level, pi sends reasoning_effort itself."""
    c = PiClient(tmp_path, thinking="low")
    c.write_config("http://127.0.0.1:1/v1", "m", 131072, 32768)
    m = json.loads((tmp_path / "pi-agent" / "models.json").read_text())["providers"]["local"]["models"][0]
    assert m["compat"]["supportsReasoningEffort"] is True
    cmd = c.command("m", "do it")
    assert cmd[cmd.index("--thinking") + 1] == "low"
    assert cmd.index("--thinking") < cmd.index("--")


def test_pi_sends_no_thinking_level_by_default(tmp_path):
    c = PiClient(tmp_path)
    assert "--thinking" not in c.command("m", "do it")


def test_pi_refuses_an_unknown_thinking_level(tmp_path):
    import pytest
    with pytest.raises(ValueError):
        PiClient(tmp_path, thinking="extreme")


# ---------- Claude Code token counts: every result event adds, none overwrites ----------
# Opus v2-r3 story 12 (30 Sep 2026): one `claude -p` session emitted two `result` events (the agent was
# woken again after its first answer). Each carries the usage of its own stretch of the session, not a
# running total (total_cost_usd is the running figure). metrics.json recorded only the second: 1,230
# output tokens against 91,850.
OPUS_V2R3_S12_RESULTS = (
    {"input_tokens": 130, "output_tokens": 90620, "cache_read_input_tokens": 10582402,
     "cache_creation_input_tokens": 226164},
    {"input_tokens": 6, "output_tokens": 1230, "cache_read_input_tokens": 476307,
     "cache_creation_input_tokens": 1044},
)


def _result(usage: dict, **extra) -> dict:
    return {"type": "result", "subtype": "success", "is_error": False, "session_id": "s", "usage": usage, **extra}


def test_claude_adds_the_usage_of_every_result_in_a_session():
    st, _ = claude_scan([{"type": "system", "subtype": "init", "session_id": "s"},
                         *(_result(u) for u in OPUS_V2R3_S12_RESULTS)])
    assert st["tokens"] == {"input": 136, "output": 91850, "reasoning": 0, "cache_read": 11058709,
                            "cache_write": 227208}


def test_claude_adds_results_across_the_sessions_of_one_story():
    """A story's log holds every attempt (fork-resumes, nudges, a restart's continuation), one after another."""
    a, b = OPUS_V2R3_S12_RESULTS
    st, _ = claude_scan([{"type": "system", "subtype": "init", "session_id": "s1"}, _result(a),
                         {"type": "system", "subtype": "init", "session_id": "s2"}, _result(b)])
    assert st["tokens"]["output"] == a["output_tokens"] + b["output_tokens"]
    assert st["session"] == "s1"          # the first session is the story's, as before


def test_claude_result_without_usage_adds_nothing():
    a, _ = OPUS_V2R3_S12_RESULTS
    st, _ = claude_scan([_result(a), {"type": "result", "subtype": "success", "is_error": False}])
    assert st["tokens"]["output"] == a["output_tokens"] and st["tokens"]["input"] == a["input_tokens"]


def test_claude_a_later_successful_result_still_clears_an_earlier_error():
    a, b = OPUS_V2R3_S12_RESULTS
    st, _ = claude_scan([_result(a, is_error=True, subtype="error_during_execution", result="API Error: 529"),
                         _result(b)])
    assert st["error"] is None and st["tokens"]["output"] == a["output_tokens"] + b["output_tokens"]


# ---------- Claude Code steps: counted in every pass over a log, not only the client's first ----------
# The harness reads a restarted story's log more than once with the one client it has: drive.last_session (which
# session to continue), then attempts.earlier_attempts (what the earlier attempts did), then the progress tally.
# ClaudeClient kept the message ids it had counted on itself, so every pass after the first counted no steps:
# Sonnet v2-r1 story 9's earlier attempts were recorded with 0 steps against 84 tool calls (its log holds 60).
# The events: that story's first two model calls, the second arriving as two blocks (cut to the fields read).
def _claude_block(rx: float, mid: str, block: dict) -> dict:
    return {"_rx": rx, "type": "assistant", "parent_tool_use_id": None, "session_id": "683db215-79f7-4f8a-9d88-34a405c202ed",
            "message": {"model": "claude-sonnet-5-5", "id": mid, "type": "message", "role": "assistant", "content": [block],
                        "usage": {"input_tokens": 2, "cache_read_input_tokens": 11998, "output_tokens": 16}}}


RESTARTED_CLAUDE_EVENTS = [
    _claude_block(1790822539.434, "msg_011CfakFwkiXETQpzsmdz8jy",
                  {"type": "tool_use", "id": "toolu_01GMD8d7EsEAerbJLsrZ3BqB", "name": "Bash", "input": {"command": "cat package.json"}}),
    _claude_block(1790822543.089, "msg_011CfakGEJsC4zHNpuk9VnBM", {"type": "thinking", "thinking": "", "signature": "CAQS"}),
    _claude_block(1790822543.407, "msg_011CfakGEJsC4zHNpuk9VnBM",
                  {"type": "tool_use", "id": "toolu_0121eE3QoJiY9P8WZoZKb2d9", "name": "Bash", "input": {"command": "wc -l src/*"}}),
]
RESTARTED_CLAUDE_STEPS = 2


def test_claude_counts_a_logs_steps_in_every_pass_with_the_same_client():
    from clients import ClaudeClient
    c = ClaudeClient(Path("/tmp/w"))
    for _ in range(2):                      # the second pass is the one the harness records
        st = empty_state()
        for e in RESTARTED_CLAUDE_EVENTS:
            c.scan(e, st)
        assert st["steps"] == RESTARTED_CLAUDE_STEPS and st["tool_calls"] == 2


def test_claude_state_stays_json_serialisable():
    from clients import ClaudeClient
    c, st = ClaudeClient(Path("/tmp/w")), empty_state()
    for e in RESTARTED_CLAUDE_EVENTS:
        c.scan(e, st)
    assert json.loads(json.dumps(st))["steps"] == RESTARTED_CLAUDE_STEPS
