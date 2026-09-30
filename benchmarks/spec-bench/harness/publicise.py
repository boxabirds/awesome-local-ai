"""publicise.py — what of a run may be public. Held-out test detail never is; its counts are.

The held-out suite is private so that no agent can tune its work to it, and so no model trained on this public
repo learns it. Until 30 Sep 2026 every scored story committed the suite's own report (test titles, locators,
expected values, the failing page and test source), which undid that. This module is the single definition of
what may be published, used by the harness before every commit, by the rewrite of the repo's history, and by
anything converting old records:

- private paths (is_private): a run's held-out results and their artefacts, and the old public copy of the suite;
- public summaries (summary_path, summarise_accept): each held-out result's counts, beside where it was;
- metrics.json (strip_metrics) and reports (redact_markdown) without test titles, errors or runner output;
- a check (fingerprints, leaks): no held-out test title may appear in a public file the harness wrote.
The agent's own work (anything under a run's workspace/) is its own and always public.
Tests: test_publicise.py.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path, PurePosixPath

PRIVATE_FILES = {"accept.json", "accept-report.json", "accept-final.json"}
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
TEST_TITLE = re.compile(r"""\btest(?:\.\w+)?\(\s*(['"`])(.+?)\1\s*,""")
QUOTED_TITLES = re.compile(r";? (?:broke|fixed) \d+: (?:“[^”]*”(?:; )?)+(?: …)?")
COMMON_ERROR = re.compile(r"\.? Most common error: `[^`]*`")


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


def leaks_in_file(rel: str, text: str, fps: set[str]) -> list[str]:
    """leaks() for a file about to be public, minus what isn't held-out: the agent's own work and its own checks
    (agents write tests from the same spec sentences the held-out titles come from), and, outside run records,
    the anchor mark on its own (docs explain the convention)."""
    parts = _parts(rel)
    if "workspace" in parts or parts[-1] == "gate.json":
        return []
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
