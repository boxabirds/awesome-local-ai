"""uv run --with pytest pytest test_pack.py"""
import json
from pathlib import Path

import pytest

import pack

REPO = Path(__file__).resolve().parents[3]
VIDI = REPO / "benchmarks" / "vidi"
TEMPLATE = (Path(__file__).parent.parent / "prompts" / "story.md.tmpl").read_text()
# The story-1 prompt the harness sent before packs existed (pi-smoke run, committed dffafbe).
RECORDED_PROMPT = (REPO / "combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/benchmarks/vidi/pi-smoke/stories/01/prompt.md")


def test_vidi_prompt_is_byte_identical_to_the_pre_pack_harness():
    p = pack.load(VIDI)
    scope = p.resolve_scope(scope="canvas")
    assert p.render_prompt(1, [], scope["out_of_scope_note"], TEMPLATE) == RECORDED_PROMPT.read_text()


def test_vidi_scope_and_titles():
    p = pack.load(VIDI)
    ids = [s["id"] for s in p.resolve_scope(scope="canvas")["stories"]]
    assert ids == [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]
    assert p.title(1) == "Pan and zoom around an infinite board"
    assert p.acceptance is not None and p.name == "vidi"


def test_epic_selector_reads_the_epic_table():
    p = pack.load(VIDI)
    assert [s["id"] for s in p.resolve_scope(epic="canvas")["stories"]] == [1, 2, 7, 8, 9, 10, 11, 12]


def mini_pack(tmp_path: Path) -> Path:
    root = tmp_path / "mini"
    for n, slug in ((1, "001-first"), (2, "002-second")):
        d = root / "spec" / "stories" / slug
        d.mkdir(parents=True)
        (d / "story.md").write_text(f"# Story {n} title\n")
    (root / "spec" / "epics").mkdir()
    (root / "spec" / "epics" / "core.md").write_text("| ID | Title |\n|---|---|\n| 2 | Second |\n")
    return root


def test_minimal_pack_without_bench_json_uses_defaults(tmp_path):
    p = pack.load(mini_pack(tmp_path))
    assert p.name == "mini" and p.acceptance is None and p.gate == pack.DEFAULT_GATE
    assert [s["id"] for s in p.resolve_scope()["stories"]] == [1, 2]
    assert [s["id"] for s in p.resolve_scope(epic="core")["stories"]] == [2]
    assert [s["id"] for s in p.resolve_scope(ids=[2, 1])["stories"]] == [2, 1]
    prompt = p.render_prompt(2, [1], "", TEMPLATE)
    assert "Story 2 title" in prompt and "vidi" not in prompt and "spec/stories/002-second" in prompt


def test_unknown_story_is_refused(tmp_path):
    with pytest.raises(SystemExit):
        pack.load(mini_pack(tmp_path)).resolve_scope(ids=[9])
