"""publicise.py — what of a run may be public. Held-out test detail never is; its counts are.

The held-out suite is private so that no agent can tune its work to it, and so no model trained on this public
repo learns it. Until 30 Sep 2026 every scored story committed the suite's own report (test titles, locators,
expected values, the failing page and test source), which undid that. This module is the single definition of
what may be published, used by the harness before every commit, by the rewrite of the repo's history, and by
anything converting old records:

- private paths (is_private): a run's held-out results and their artefacts, and the old public copy of the suite;
- public summaries (summary_path, summarise_accept): each held-out result's counts, beside where it was;
- metrics.json (strip_metrics) and reports (redact_markdown) without test titles, errors or runner output;
- a check (fingerprints, leaks): no held-out test title may appear in a public file the harness wrote;
- a run's .gitignore (gitignore_lines), so its private files are never staged;
- metrics.json split in two (split_metrics, merge_metrics): the public part, and the held-out detail kept beside
  it in a git-ignored sidecar (HELDOUT_DETAIL) that the machine's own tools read back;
- the size limit of each kind of committed file (size_limit), used by the harness and tests/privacy-test.sh
  (`publicise.py over-limit <repo>`), so the two can't disagree.
The agent's own work (anything under a run's workspace/, its conversation and its gate) is its own and always
public, except a credential in it: every file staged for a public commit is put through the credential scanner
(credentials.py, heldout.redact_staged), which replaces the value by a marker naming it.
The harness applies these rules in heldout.py and drive.record_story.
Tests: test_publicise.py.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path, PurePosixPath

# The harness's own sidecars of held-out detail: metrics.json's (split_metrics), the report with its test titles
# (redact_markdown's input), and the record of a commit the leak check refused (it names the title it found).
HELDOUT_DETAIL = "heldout-detail.json"
SUMMARY_DETAIL = "summary-detail.md"
PUBLISH_REFUSED = "publish-refused.json"
PRIVATE_FILES = {"accept.json", "accept-report.json", "accept-final.json", HELDOUT_DETAIL, SUMMARY_DETAIL,
                 PUBLISH_REFUSED}
# A scoring's artefacts. In a run record they are private wherever they are: under stories/NN/, and also a known-good
# run's base/ and a superseded attempt's superseded/<name>/, which hold the same pages and screenshots.
PRIVATE_DIRS = {"artifacts", "screenshots", "pre-suite-fix"}
RUN_RECORDS = (("combinations",), ("benchmarks", "reference"))
PRIVATE_RUN_FILES = {"AUDIT.md", "audit.jsonl"}   # audits triage each held-out failure by its title
SCORING_DIR = re.compile(r"^scoring-\d+$")
SUITE_COPY = ("benchmarks", "vidi", "acceptance")       # a public copy of the v1 suite, 23-25 Sep 2026
SUMMARY_NAMES = {"accept.json": "accept-summary.json", "accept-final.json": "accept-final-summary.json"}
# What a held-out result's public summary keeps: counts and the harness's own words, never a test or its output.
SUMMARY_FIELDS = ("skipped", "build_exit", "runner_exit", "passed", "total", "on_partial", "by_story",
                  "setup_fallbacks", "harness_fault", "install", "scores")
ANCHOR_MARK = "@ref prd:"                  # every held-out test's title names its PRD anchor this way
MIN_TITLE_CHARS = 16                       # shorter titles ("undo") would match ordinary words
# The agent's own records beside its workspace: its conversation with the model (it wrote its tests from the same
# spec sentences the held-out titles come from, and never saw the suite), its git log, and its gate's output.
AGENT_OWN_FILES = {"gate.json", "agent-events.jsonl", "agent-events.compact.jsonl.gz", "workspace-git-log.txt"}
TEST_TITLE = re.compile(r"""\btest(?:\.\w+)?\(\s*(['"`])(.+?)\1\s*,""")
# history.render's "broke N: “t1”; “t2” …": the titles, "; " only between them, so a "; fixed M" after them stays.
QUOTED_TITLES = re.compile(r";? (?:broke|fixed) \d+: “[^”]*”(?:; “[^”]*”)*(?: …)?")
COMMON_ERROR = re.compile(r"\.? Most common error: `[^`]*`")

# Committed benchmark files stay small: a large results file is usually raw capture that should have been
# summarised, and 512 KB is well above any legitimate summary. Some kinds are large on purpose and have their own:
KB, MB = 1024, 1024 * 1024
DEFAULT_SIZE_LIMIT = 512 * KB
BUNDLE_LIMIT = 20 * MB          # workspace.bundle: the agent's git history, which re-scoring and judging rebuild from
WORKSPACE_LIMIT = 20 * MB       # <run>/workspace/**: the agent's own work, mirrored (agents write large test images)
EVENT_LOG_LIMIT = 50 * MB       # the lossless conversation log: GitHub warns on pushes over 50 MB, refuses over 100
METRICS_LIMIT = 2 * MB          # per-story records with conversation profiles


def _parts(rel: str) -> tuple[str, ...]:
    return PurePosixPath(rel).parts


def _in_run_records(parts: tuple[str, ...]) -> bool:
    return any(parts[:len(r)] == r for r in RUN_RECORDS)


def is_private(rel: str) -> bool:
    """Whether a repo-relative path holds held-out detail that must never be public."""
    parts = _parts(rel)
    if parts[:len(SUITE_COPY)] == SUITE_COPY:
        return True
    if "workspace" in parts:              # the agent's own work, whatever it named its files
        return False
    name = parts[-1]
    if name in PRIVATE_FILES or (name in PRIVATE_RUN_FILES and _in_run_records(parts)):
        return True
    if _in_run_records(parts) and any(p in PRIVATE_DIRS or SCORING_DIR.match(p) for p in parts[:-1]):
        return True
    # Anything under stories/NN/<artefacts> (also inside rescore/<version>/).
    for i, p in enumerate(parts[:-1]):
        if p == "stories" and i + 2 < len(parts):
            sub = parts[i + 2]
            if sub in PRIVATE_DIRS or SCORING_DIR.match(sub):
                return True
    return False


def summary_path(rel: str) -> str | None:
    """The public summary that stands beside a held-out result; None for anything else."""
    parts = _parts(rel)
    if parts[-1] not in SUMMARY_NAMES or "workspace" in parts:
        return None
    if any(p in PRIVATE_DIRS or SCORING_DIR.match(p) for p in parts[:-1]):
        return None                       # a superseded or repeated scoring: its result is summarised elsewhere
    return str(PurePosixPath(*parts[:-1], SUMMARY_NAMES[parts[-1]]))


def summarise_accept(acc: dict) -> dict:
    """A held-out result's counts: what may be public."""
    out = {k: acc[k] for k in SUMMARY_FIELDS if k in acc}
    if "flaky" in acc:
        out["flaky"] = len(acc["flaky"]) if isinstance(acc["flaky"], list) else acc["flaky"]
    return out


def strip_metrics(metrics: dict) -> dict:
    """metrics.json with each story's held-out result reduced to its summary. The input is left as it was."""
    stories = {}
    for sid, rec in (metrics.get("stories") or {}).items():
        rec = dict(rec)
        if isinstance(rec.get("accept"), dict):
            rec["accept"] = summarise_accept(rec["accept"])
        if isinstance(rec.get("partial_heldout_changes"), dict):   # {story: {fixed: [titles], regressed: [titles]}}
            rec["partial_heldout_changes"] = {k: {kk: len(vv) if isinstance(vv, list) else vv for kk, vv in v.items()}
                                              for k, v in rec["partial_heldout_changes"].items() if isinstance(v, dict)}
        stories[sid] = rec
    return {**metrics, "stories": stories} if "stories" in metrics else dict(metrics)


def split_metrics(metrics: dict) -> tuple[dict, dict]:
    """metrics.json as (public, detail): public is strip_metrics(metrics); detail holds, per story, the full value of
    each field strip_metrics changed, so that merge_metrics(public, detail) gives back metrics. Records from before
    stories were keyed by id list them instead; they carry no held-out result, so they are all public."""
    if not isinstance(metrics.get("stories"), dict):
        return dict(metrics), {}
    public = strip_metrics(metrics)
    detail = {}
    for sid, rec in (metrics.get("stories") or {}).items():
        kept = {k: v for k, v in rec.items() if public["stories"][sid].get(k) != v}
        if kept:
            detail[sid] = kept
    return public, ({"stories": detail} if detail else {})


def merge_metrics(public: dict, detail: dict) -> dict:
    """metrics.json with its held-out detail back in: each story's fields from detail replace the public ones.
    A story the public metrics no longer have is not brought back. Neither input is modified."""
    if not isinstance(public.get("stories"), (dict, type(None))):
        return dict(public)
    stories = {sid: dict(rec) for sid, rec in (public.get("stories") or {}).items()}
    for sid, fields in (detail.get("stories") or {}).items():
        if sid in stories:
            stories[sid].update(fields)
    return {**public, "stories": stories} if "stories" in public else dict(public)


def gitignore_lines() -> list[str]:
    """A run's .gitignore lines that keep every private file of the run out of git (is_private), and put back what
    the agent wrote under its workspace/, whatever it named it. Scoring repeats are matched as scoring-<digit>…, a
    little wider than SCORING_DIR; nothing else in a run is named that way."""
    names = sorted(PRIVATE_FILES | PRIVATE_RUN_FILES)
    dirs = [f"{d}/" for d in sorted(PRIVATE_DIRS)] + ["scoring-[0-9]*/"]
    return [*names, *dirs, *(f"!/workspace/**/{p}" for p in [*names, *dirs])]


def redact_markdown(text: str) -> str:
    """A report without held-out test titles or error text; its counts stay."""
    out = []
    for line in text.split("\n"):
        new = COMMON_ERROR.sub("", line)
        new = QUOTED_TITLES.sub(lambda m: m.group(0).split(":")[0], new)
        if new != line and not new.endswith("."):
            new += "."
        out.append(new)
    return "\n".join(out)


def fingerprints(private_repo: Path) -> set[str]:
    """Every held-out test title in every tagged version of the private suites, with and without its anchor."""
    tags = subprocess.run(["git", "-C", str(private_repo), "tag"], capture_output=True, text=True).stdout.split()
    fps: set[str] = set()
    for tag in tags:
        files = subprocess.run(["git", "-C", str(private_repo), "ls-tree", "-r", "--name-only", tag],
                               capture_output=True, text=True).stdout.split("\n")
        for f in (f for f in files if "/acceptance/tests/" in f and f.endswith(".spec.ts")):
            src = subprocess.run(["git", "-C", str(private_repo), "show", f"{tag}:{f}"],
                                 capture_output=True, text=True, errors="replace").stdout
            for m in TEST_TITLE.finditer(src):
                title = m.group(2)
                for t in (title, title.split(" @ref ")[0].strip()):
                    if len(t) >= MIN_TITLE_CHARS:
                        fps.add(t)
    return fps


def leaks(text: str, fps: set[str]) -> list[str]:
    """What in this text would give away the held-out suite: its titles, or the anchor mark its titles carry."""
    found = sorted(fp for fp in fps if fp in text)
    if ANCHOR_MARK in text and not any(ANCHOR_MARK in f for f in found):
        found.append(ANCHOR_MARK)
    return found


def is_own_work(rel: str) -> bool:
    """Whether a file is the agent's own (its workspace, conversation, git log or gate), which leaks_in_file never
    counts: the check can skip reading it."""
    parts = _parts(rel)
    return "workspace" in parts or parts[-1] in AGENT_OWN_FILES


def leaks_in_file(rel: str, text: str, fps: set[str]) -> list[str]:
    """leaks() for a file about to be public, minus what isn't held-out: the agent's own work, its conversation and
    its own checks (agents write tests from the same spec sentences the held-out titles come from), and, outside run records,
    the anchor mark on its own (docs explain the convention)."""
    if is_own_work(rel):
        return []
    parts = _parts(rel)
    if parts[-1] == "metrics.json":
        try:
            m = json.loads(text)
            for rec in (m.get("stories") or {}).values():
                if isinstance(rec, dict):
                    rec.pop("gate", None)
            text = json.dumps(m, ensure_ascii=False)
        except ValueError:
            pass
    found = leaks(text, fps)
    return found if _in_run_records(parts) else [f for f in found if f != ANCHOR_MARK]


def size_limit(rel: str) -> int:
    """The most a committed benchmark file of this kind may weigh, in bytes (any path ending in the file works)."""
    parts = _parts(rel)
    name = parts[-1]
    if name == "workspace.bundle":
        return BUNDLE_LIMIT
    if "workspace" in parts[:-1]:
        return WORKSPACE_LIMIT
    if name == "agent-events.compact.jsonl.gz":
        return EVENT_LOG_LIMIT
    if name == "metrics.json":
        return METRICS_LIMIT
    return DEFAULT_SIZE_LIMIT


TRACKED_RECORDS = ("combinations/**/benchmarks/*", "benchmarks/*")
# Documentation that lives under benchmarks/ but is written by people, not published by a run: no record limit.
DOCUMENTATION_FOLDERS = ("benchmarks/docs/",)


def over_limit(repo: Path) -> list[tuple[str, int, int]]:
    """Tracked benchmark files over their size limit: (path, size, limit)."""
    listed = subprocess.run(["git", "ls-files", "-z", "--", *TRACKED_RECORDS], cwd=repo, capture_output=True,
                            check=True).stdout.decode().split("\0")
    out = []
    for rel in filter(None, listed):
        if rel.startswith(DOCUMENTATION_FOLDERS):
            continue
        f = repo / rel
        if f.is_file() and f.stat().st_size > size_limit(rel):
            out.append((rel, f.stat().st_size, size_limit(rel)))
    return out


if __name__ == "__main__":
    import sys
    if sys.argv[1:2] != ["over-limit"] or len(sys.argv) != 3:
        sys.exit("usage: publicise.py over-limit <repo>")
    for rel, size, limit in over_limit(Path(sys.argv[2])):
        print(f"{rel}\t{size}\t{limit}")
