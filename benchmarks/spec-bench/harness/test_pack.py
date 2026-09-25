"""uv run --with pytest pytest test_pack.py

The harness runs any spec pack, not only vidi. A pack in todoodle's shape (a spec only: stories and
epics, no scope files, no held-out suite, no bench.json) must load, choose its stories and render a
complete prompt; vidi must render exactly the prompts its runs have recorded."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

import gates
import pack
from drive import REPO_ROOT

HARNESS = Path(__file__).resolve().parent
RECORDED_RUN = (REPO_ROOT / "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/benchmarks/vidi"
                / "canvas-pi-03")


def spec_only_pack(root: Path) -> Path:
    """Three stories, two epics, nothing else: todoodle as it stands."""
    p = root / "todoo"
    stories = {1: "see-which-version-is-live", 2: "start-a-private-workspace", 5: "capture-a-task"}
    for sid, slug in stories.items():
        d = p / "spec" / "stories" / f"{sid:03d}-{slug}"
        d.mkdir(parents=True)
        (d / "story.md").write_text(f"# Story {sid}: {slug.replace('-', ' ')}\n\n| Field | Value |\n")
        for f in ("prd.md", "design.md", "tasks.md"):
            (d / f).write_text("x\n")
    epics = p / "spec" / "epics"
    epics.mkdir()
    (epics / "workspaces.md").write_text("# Workspaces\n\n| ID | Title | Status |\n|----|---|---|\n"
                                         "| 2 | Start a private workspace | proposed |\n")
    (epics / "platform.md").write_text("# Platform\n\n| ID | Title | Status |\n|----|---|---|\n"
                                       "| 1 | See which version is live | proposed |\n| 5 | Capture | proposed |\n")
    (p / "spec" / "README.md").write_text("# todoo\n")
    return p


def test_a_spec_only_pack_loads_with_defaults(tmp_path):
    pk = pack.load(spec_only_pack(tmp_path))
    assert pk.name == "todoo" and sorted(pk.stories) == [1, 2, 5]
    assert pk.acceptance is None and pk.default_scope is None and pk.pack_ref is None
    assert pk.gate == pack.DEFAULT_GATE and pk.template == pack.GENERIC_TEMPLATE
    assert pk.title(pk.stories[2]) == "Story 2: start a private workspace"


def test_stories_come_from_all_an_epic_or_a_list(tmp_path):
    pk = pack.load(spec_only_pack(tmp_path))
    assert [s["id"] for s in pk.scope()["stories"]] == [1, 2, 5]
    assert pk.scope()["name"] == "all"
    platform = pk.scope(epic="platform")
    assert [s["id"] for s in platform["stories"]] == [1, 5] and platform["name"] == "epic:platform"
    assert [s["id"] for s in pk.scope(ids=[5])["stories"]] == [5]
    with pytest.raises(SystemExit):
        pk.scope(ids=[7])


def test_bench_json_sets_the_packs_choices(tmp_path):
    p = spec_only_pack(tmp_path)
    (p / "bench.json").write_text(json.dumps({"name": "Todoo", "gate": ["build"], "default_scope": "core",
                                              "pack_ref": "todoo-v1", "app_line": "Build Todoo.",
                                              "rules": ["Only rule."]}))
    pk = pack.load(p)
    assert (pk.name, pk.gate, pk.default_scope, pk.pack_ref) == ("Todoo", ["build"], "core", "todoo-v1")
    assert pk.app_line == "Build Todoo." and pk.rules == "1. Only rule."


def test_a_pack_without_a_held_out_suite_reports_na_not_zero(tmp_path):
    res = gates.accept(tmp_path, [1], tmp_path / "out", None)
    assert res["skipped"] is True and res["total"] == 0 and res["harness_fault"] is None


def test_dry_run_renders_a_complete_generic_prompt(tmp_path):
    p = spec_only_pack(tmp_path)
    r = subprocess.run([sys.executable, str(HARNESS / "drive.py"), "--pack", str(p), "--epic", "platform",
                        "--dry-run"], capture_output=True, text=True, cwd=HARNESS)
    assert r.returncode == 0, r.stderr
    assert "stories [1, 5]" in r.stdout and "n/a" in r.stdout
    prompt = r.stdout.split("--- first prompt ---", 1)[1]
    assert "{{" not in prompt, prompt
    assert 'implementing "todoo"' in prompt and "story 1" in prompt
    assert "Stories already implemented in this repository, in order: none (empty repository)." in prompt


def test_a_real_run_needs_its_run_dir_server_and_model(tmp_path):
    r = subprocess.run([sys.executable, str(HARNESS / "drive.py"), "--pack", str(spec_only_pack(tmp_path))],
                       capture_output=True, text=True, cwd=HARNESS)
    assert r.returncode != 0 and "--run-dir" in r.stderr and "--dry-run" in r.stderr


@pytest.mark.parametrize("sid", [1, 2])
def test_vidi_renders_exactly_the_prompts_its_runs_recorded(sid):
    """Moving the harness and making it pack-generic must not change a word vidi's agents see,
    or earlier runs stop being comparable."""
    import drive
    recorded = RECORDED_RUN / "stories" / f"{sid:02d}" / "prompt.md"
    if not recorded.exists():
        pytest.skip("no recorded canvas-pi-03 prompt in this checkout")
    drive.set_pack("benchmarks/vidi")
    scope = drive.PK.scope(scope="canvas")
    story = next(s for s in scope["stories"] if s["id"] == sid)
    processed = [{"id": i, "status": "DONE"} for i in range(1, sid)]
    assert drive.render_prompt(story, drive.story_title(story), processed, scope) == recorded.read_text()


def test_vidi_defaults_to_its_canvas_scope():
    pk = pack.load("benchmarks/vidi")
    assert pk.name == "vidi" and pk.default_scope == "canvas" and pk.pack_ref == "vidi-v1"
