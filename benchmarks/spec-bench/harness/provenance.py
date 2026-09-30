"""provenance.py — which harness and which suite version each story ran under.

run.json says what the run's latest start ran; a restart rewrites it. run.sh keeps every earlier run.json as a line
of run-history.jsonl before writing the new one, but nothing tied a story to the start it ran under, so a run whose
suite moved between restarts (gufo v2-r1: vidi-v2.0-pre1, then pre2) could not say which stories were scored by
which. Each story's record now carries its own provenance:

- harness_commit: HEAD of this checkout when drive.py started (at_start), the same value run.json records. The
  harness's code is loaded once per process, so it holds for every story the process runs; harness_dirty says
  whether the harness had uncommitted edits. The per-story record commits touch only run directories, not it.
- pack_version: pack-version.sh on the pack's directory when the story is scored, so a suite checkout moved while
  the run was going is caught at the story it affected.

backfill() gives past stories the state (run-history.jsonl + run.json) that was current when each was scored.
Tests: test_provenance.py.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
HARNESS_REL = "benchmarks/spec-bench/harness"
PACK_VERSION_SH = HARNESS / "pack-version.sh"
UNKNOWN = "unknown"
LIVE = "drive"                 # recorded by the harness as the story ran
BACKFILL = "run-history"       # reconstructed from run.sh's record of each start
KEPT = ("harness_commit", "pack_version")


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)


def at_start(repo_root: Path) -> dict:
    """The harness this process runs: HEAD, and whether the harness directory had uncommitted edits."""
    head = _git(repo_root, "rev-parse", "--short", "HEAD")
    dirty = _git(repo_root, "status", "--porcelain", "--untracked-files=no", "--", HARNESS_REL)
    return {"harness_commit": head.stdout.strip() if head.returncode == 0 else UNKNOWN,
            "harness_dirty": bool(dirty.stdout.strip()) if dirty.returncode == 0 else None}


def pack_version(pack_dir: Path, name: str) -> str:
    """The pack's version as run.sh records it (pack-version.sh)."""
    p = subprocess.run(["bash", str(PACK_VERSION_SH), str(pack_dir), name], capture_output=True, text=True)
    return p.stdout.strip() or UNKNOWN


def epoch(stamp: str) -> float | None:
    try:
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def run_states(run: Path) -> list[dict]:
    """Every start of the run as run.sh recorded it, oldest first: {"at", "started_at", harness_commit, pack_version}."""
    lines = (run / "run-history.jsonl").read_text().splitlines() if (run / "run-history.jsonl").exists() else []
    if (run / "run.json").exists():
        lines.append((run / "run.json").read_text())
    out = []
    for line in lines:
        try:
            s = json.loads(line)
        except ValueError:
            continue
        if isinstance(s, dict) and (t := epoch(s.get("started_at", ""))) is not None:
            out.append({"at": t, "started_at": s["started_at"], **{k: s.get(k) for k in KEPT}})
    return sorted(out, key=lambda s: s["at"])


def _state_at(states: list[dict], t: float) -> dict | None:
    current = [s for s in states if s["at"] <= t]
    return current[-1] if current else None


def for_story(states: list[dict], rec: dict) -> dict | None:
    """The state a story was scored under (the latest start before its agent finished), and, when a restart fell
    inside the story, the one it started under."""
    end = _state_at(states, rec.get("agent_finished") or rec.get("started") or 0)
    if end is None:
        return None
    out = {**{k: end[k] for k in KEPT}, "run_started_at": end["started_at"], "source": BACKFILL}
    begin = _state_at(states, rec.get("first_started") or rec.get("started") or 0)
    if begin is not None and begin is not end and any(begin[k] != end[k] for k in KEPT):
        out["started_under"] = {k: begin[k] for k in KEPT}
    return out


def backfill(run: Path) -> list[str]:
    """Give each story with no provenance the state it was scored under. Returns the stories filled."""
    import heldout
    states = run_states(run)
    if not states:
        return []
    metrics = heldout.load_metrics(run)
    filled = []
    for sid, rec in sorted((metrics.get("stories") or {}).items(), key=lambda kv: int(kv[0])):
        if rec.get("provenance") or (p := for_story(states, rec)) is None:
            continue
        rec["provenance"] = p
        filled.append(sid)
    if filled:
        heldout.save_metrics(run, metrics)
    return filled


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(f"{arg} provenance: {', '.join(backfill(Path(arg).resolve())) or 'nothing to fill'}")
