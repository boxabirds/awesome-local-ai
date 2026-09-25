# /// script
# requires-python = ">=3.11"
# ///
"""Continue a run that Claude Code subagents started, under the harness (sandboxed from here on).

Every imported story's transcript is peek-audited first (peek_audit.py); if any story touched the
held-out suite, the pack, the repo or another run, nothing is imported. Otherwise:
- the subagents' workspace, with its git history, becomes the harness work dir's workspace;
- the run's metrics.json is rewritten in harness form, with the imported stories DONE and marked
  `imported: {method, peek_audit}`. The original is kept as metrics.subagent.json.
`run.sh <install-id> --run-id <run> --client claude` then carries on at the next story.

    uv run import_run.py --run-dir benchmarks/reference/vidi/opus-5.5/run-2 \\
        --workspace ~/.vidi-bench/reference/opus-5.5-run2/workspace \\
        --transcripts ~/.vidi-bench/reference/opus-5.5-run2/agents.json \\
        --session-dir ~/.claude/projects/<project>/<session> \\
        [--allow <extra allowed path>]...
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import peek_audit

METHOD = "claude-code-subagent"
SECONDS_PER_MINUTE = 60


def audit_stories(transcripts: dict[int, Path], allowed: list[str], sensitive: list[str]) -> dict[int, dict]:
    out = {}
    for sid, t in sorted(transcripts.items()):
        r = peek_audit.audit([t], allowed=allowed, sensitive=sensitive)
        out[sid] = {"tool_calls": r.tool_calls, "peeks": len(r.peeks), "review": len(r.review),
                    "peek_paths": [f.path for f in r.peeks][:20]}
    return out


def refusal(audits: dict[int, dict]) -> str | None:
    bad = [sid for sid, a in audits.items() if a["peeks"]]
    return f"story {', story '.join(map(str, bad))} touched secrets; not importing" if bad else None


def harness_metrics(sub: dict, titles: dict[int, str], audits: dict[int, dict], scope: dict) -> dict:
    now = time.time()
    stories, processed = {}, []
    for s in scope["stories"]:
        sid = s["id"]
        info = sub["stories"].get(str(sid))
        if not info or "commit" not in info:  # only stories the subagent finished and recorded
            continue
        stories[str(sid)] = {
            "title": titles.get(sid, ""), "finished": info.get("finished", now),
            "agent": {"seconds": info.get("agent_minutes", 0) * SECONDS_PER_MINUTE, "steps": None,
                      "tool_calls": info.get("tool_uses"), "stalled": False, "resumes": 0, "nudges": 0,
                      "tokens": {"subagent_total": info.get("subagent_tokens")}},
            "requests": {}, "gate": {"all_green": None, "note": "imported: the subagent ran its own gate"},
            "accept": {}, "commit": info["commit"],
            "imported": {"method": METHOD, "peek_audit": audits.get(sid, {})},
        }
        processed.append({"id": sid, "title": titles.get(sid, ""), "status": "DONE", "ended_by": "agent"})
    return {"stories": stories, "processed": processed, "imported_from": METHOD}


def copy_workspace(src: Path, dest: Path) -> None:
    if dest.exists():
        raise SystemExit(f"{dest} already exists; refusing to overwrite a harness workspace")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest, symlinks=True, ignore=shutil.ignore_patterns("node_modules", "dist", ".wrangler"))


def main() -> None:
    import drive
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--workspace", type=Path, required=True)
    ap.add_argument("--transcripts", type=Path, required=True, help="agents.json: {story: agent id}")
    ap.add_argument("--session-dir", type=Path, required=True, help="~/.claude/projects/<project>/<session>")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--scope", default="canvas")
    a = ap.parse_args()
    run = (drive.REPO_ROOT / a.run_dir).resolve() if not a.run_dir.is_absolute() else a.run_dir
    ws = a.workspace.expanduser().resolve()
    agents = json.loads(a.transcripts.expanduser().read_text())
    tx = {int(sid): a.session_dir.expanduser() / "subagents" / f"agent-{aid}.jsonl" for sid, aid in agents.items()}
    allowed = [str(ws.parent), str(a.session_dir.expanduser() / "tool-results"), *a.allow]
    audits = audit_stories(tx, allowed=allowed, sensitive=peek_audit.default_sensitive())
    for sid, au in audits.items():
        print(f"story {sid}: {au['tool_calls']} tool calls, {au['peeks']} peeks, {au['review']} to review")
    why = refusal(audits)
    if why:
        raise SystemExit(why)
    scope = json.loads((drive.PACK / "scope" / f"{a.scope}.json").read_text())
    titles = {s["id"]: drive.story_title(s) for s in scope["stories"]}
    sub_path = run / "metrics.json"
    sub = json.loads(sub_path.read_text())
    work = drive.work_dir_for(run)
    copy_workspace(ws, work / "workspace")
    shutil.copy(sub_path, run / "metrics.subagent.json")
    m = harness_metrics(sub, titles, audits, scope)
    m["scope"] = a.scope
    sub_path.write_text(json.dumps(m, indent=2))
    (run / "work_dir.txt").write_text(str(work))
    done = [p["id"] for p in m["processed"]]
    print(f"imported stories {done} into {run}; harness workspace {work / 'workspace'}")


if __name__ == "__main__":
    main()
