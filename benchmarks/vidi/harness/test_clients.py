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
