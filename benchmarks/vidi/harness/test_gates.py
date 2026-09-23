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
