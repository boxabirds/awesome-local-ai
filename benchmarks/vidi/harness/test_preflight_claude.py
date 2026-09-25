"""The Claude Code preflight probe: authenticated inside the sandbox, and blind to the held-out suite."""
import preflight as pf

INIT = {"type": "system", "subtype": "init", "session_id": "s"}


def tool_result(text: str) -> dict:
    return {"type": "user", "message": {"content": [{"type": "tool_result", "content": text}]}}


def result(ok: bool = True) -> dict:
    return {"type": "result", "subtype": "success" if ok else "error_during_execution", "is_error": not ok, "result": "done"}


def test_blind_and_authenticated_passes():
    ok, why = pf.claude_probe_verdict([INIT, tool_result("ls: /x/acceptance/tests: Operation not permitted"), result()], "story-01.spec.ts")
    assert ok, why


def test_seeing_the_suite_fails():
    ok, why = pf.claude_probe_verdict([INIT, tool_result("story-01.spec.ts\nstory-02.spec.ts"), result()], "story-01.spec.ts")
    assert not ok and "can read" in why


def test_no_successful_result_means_auth_or_startup_failed():
    ok, why = pf.claude_probe_verdict([INIT, result(ok=False)], "story-01.spec.ts")
    assert not ok and "did not complete" in why
    ok, why = pf.claude_probe_verdict([], "story-01.spec.ts")
    assert not ok
