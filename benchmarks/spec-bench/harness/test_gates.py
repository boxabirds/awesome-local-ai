"""uv run --with pytest pytest test_gates.py"""
from pathlib import Path

import gates
import pack

VIDI = pack.load(Path(__file__).resolve().parents[2] / "vidi")


def test_unstartable_app_counts_every_applicable_test_as_failed(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "exit 1"}}')
    res = gates.accept(ws, [1], tmp_path / "out", VIDI.acceptance, VIDI.serve)
    assert res["total"] > 0, "an app that cannot start must fail its tests, not have none"
    assert res["passed"] == 0


def test_pack_without_suite_is_skipped_not_zero(tmp_path: Path):
    res = gates.accept(tmp_path, [1], tmp_path / "out", None)
    assert res["skipped"] is True and res["total"] is None


def test_gate_runs_only_the_packs_steps(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "true", "lint": "true"}}')
    res = gates.gate(ws, ["build", "lint", "test:unit"])
    assert list(res["steps"]) == ["install", "build", "lint", "test:unit"]
    assert res["steps"]["test:unit"]["exit"] == "missing" and res["all_green"]
