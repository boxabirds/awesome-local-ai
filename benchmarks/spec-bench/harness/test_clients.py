"""uv run --with pytest pytest harness/test_clients.py"""
import json
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


def test_claude_env_isolates_config_uses_the_token_and_drops_api_keys(tmp_path, monkeypatch):
    from clients import ClaudeClient
    token = tmp_path / "token"
    token.write_text("sk-ant-oat01-test\n")
    monkeypatch.setenv("CLAUDE_BENCH_TOKEN_FILE", str(token))
    c = ClaudeClient(tmp_path / "work")
    env = c.env()
    assert env["CLAUDE_CONFIG_DIR"].startswith(str(tmp_path / "work"))
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-test"
    assert set(c.env_remove) >= {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"}
