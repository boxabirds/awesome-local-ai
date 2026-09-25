"""uv run --with pytest pytest harness/test_gates.py"""
from pathlib import Path

import gates


def test_unstartable_app_counts_every_applicable_test_as_failed(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "exit 1"}}')
    res = gates.accept(ws, [1], tmp_path / "out")
    assert res["total"] > 0, "an app that cannot start must fail its tests, not have none"
    assert res["passed"] == 0


BROWSER_MISSING = ("browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/"
                   "chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell")


def test_a_missing_browser_is_a_harness_fault_not_an_app_failure():
    tests = [{"status": "failed", "error": BROWSER_MISSING}, {"status": "failed", "error": BROWSER_MISSING}]
    assert "playwright install" in gates.harness_fault(tests)


def test_app_failures_are_not_harness_faults():
    refused = "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/"
    assert gates.harness_fault([{"status": "failed", "error": refused}, {"status": "passed", "error": ""}]) is None
    assert gates.harness_fault([]) is None
