"""How a run's changes happened: each story's commits (from the workspace's git log), and which story
broke or fixed an earlier story's held-out tests (from the suite's results after every story).

Scores say *when* something broke; this names the story, its commits and the files they touched, the
tests that changed, and their most common error. Everything comes from records every run keeps:
workspace-git-log.txt, stories/NN/base-commit, each story's recorded commit, and stories/NN/accept.json.

Attribution is as fine as the agent's commits: an agent that commits once per story can only be
blamed per story. A test that flips once may be flaky; one story breaking many at once is not.

    python3 history.py <run-dir>     # prints the section
"""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

COMMIT_RE = re.compile(r"^commit ([0-9a-f]+)$")
STAT_RE = re.compile(r"^ (\S.*?)\s+\|\s+(\d+)")
SUMMARY_RE = re.compile(r"^ \d+ files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
STORY_FILE_RE = re.compile(r"story-(\d+)")
HARNESS_SUBJECT = "harness:"
TOP_FILES = 6
TITLES_SHOWN = 4
ERROR_SHOWN_CHARS = 240
# Not where a behaviour change comes from: tests, and generated dependency locks.
NOT_SOURCE_RE = re.compile(r"(^|/)(tests?|__tests__|e2e)/|\.(test|spec)\.[jt]sx?$|(^|/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$")
# The lines of a Playwright error that say what was wrong, after its first "Error" line.
DETAIL_PREFIXES = ("Locator:", "Expected", "Received")


def parse_git_log(text: str) -> list[dict]:
    """drive.mirror's `git log --stat` text -> commits, newest first."""
    commits: list[dict] = []
    for line in text.splitlines():
        if (m := COMMIT_RE.match(line)):
            commits.append({"hash": m.group(1), "author": "", "date": "", "subject": "", "files": [],
                            "insertions": 0, "deletions": 0})
            continue
        if not commits:
            continue
        c = commits[-1]
        if not c["author"] and line.strip():
            c["author"], _, c["date"] = line.partition("  ")
        elif not c["subject"] and line.startswith("    "):
            c["subject"] = line.strip()
        elif (m := SUMMARY_RE.match(line)):
            c["insertions"], c["deletions"] = int(m.group(1) or 0), int(m.group(2) or 0)
        elif (m := STAT_RE.match(line)):
            c["files"].append((m.group(1).strip(), int(m.group(2))))
    for c in commits:
        c["by_harness"] = c["subject"].startswith(HARNESS_SUBJECT)
    return commits


def _index(commits: list[dict], sha: str | None) -> int | None:
    if not sha:
        return None
    return next((i for i, c in enumerate(commits) if c["hash"].startswith(sha) or sha.startswith(c["hash"])), None)


def _error_lines(err: str) -> list[str]:
    return [l.strip() for l in ANSI_RE.sub("", err or "").splitlines() if l.strip()]


def _error_kind(err: str) -> str:
    lines = _error_lines(err)
    return next((l for l in lines if "Error" in l.split(":")[0]), lines[0] if lines else "")


def _error_example(err: str) -> str:
    """The error's kind plus the lines that say what was wrong (locator, expected, received)."""
    detail = [l for l in _error_lines(err) if l.startswith(DETAIL_PREFIXES)]
    return " / ".join([_error_kind(err), *detail])


def source_files(commits: list[dict]) -> list[tuple[str, int]]:
    """Lines changed per source file, most first: tests and lockfiles left out."""
    total: dict[str, int] = collections.Counter()
    for c in commits:
        for f, n in c["files"]:
            if not NOT_SOURCE_RE.search(f):
                total[f] += n
    return total.most_common()


def _tests(run: Path, sid: str) -> dict[tuple, dict]:
    f = run / "stories" / f"{int(sid):02d}" / "accept.json"
    try:
        tests = json.loads(f.read_text()).get("tests", [])
    except (OSError, json.JSONDecodeError):
        return {}
    return {(t.get("file"), t.get("title")): t for t in tests if t.get("status") != "skipped"}


def analyse(run: Path) -> dict:
    m = json.loads((run / "metrics.json").read_text())
    log = run / "workspace-git-log.txt"
    commits = parse_git_log(log.read_text(errors="replace")) if log.exists() else []
    ids = list(m["stories"])
    stories = {}
    for sid in ids:
        s = m["stories"][sid]
        base_f = run / "stories" / f"{int(sid):02d}" / "base-commit"
        base = base_f.read_text().strip() if base_f.exists() else None
        hi, lo = _index(commits, s.get("commit")), _index(commits, base)
        own = commits[hi:lo] if hi is not None and lo is not None and hi < lo else []
        stories[sid] = {"title": s.get("title", ""), "commits": own}
    changes = []
    for prev, sid in zip(ids, ids[1:]):
        before_t, after_t = _tests(run, prev), _tests(run, sid)
        before_by = (m["stories"][prev].get("accept") or {}).get("by_story") or {}
        after_by = (m["stories"][sid].get("accept") or {}).get("by_story") or {}
        for of in sorted(before_by):
            flips = [(k, before_t[k], after_t[k]) for k in before_t
                     if k in after_t and STORY_FILE_RE.search(k[0] or "") and
                     STORY_FILE_RE.search(k[0]).group(1).zfill(2) == of.zfill(2)]
            broke = [a for k, b, a in flips if b["status"] == "passed" and a["status"] != "passed"]
            fixed = [a for k, b, a in flips if b["status"] != "passed" and a["status"] == "passed"]
            if not broke and not fixed:
                continue
            errs = collections.Counter(_error_kind(t.get("error", "")) for t in broke)
            kind = errs.most_common(1)[0][0] if errs else ""
            example = next((_error_example(t.get("error", "")) for t in broke if _error_kind(t.get("error", "")) == kind), "")
            b, a = before_by.get(of, {}), after_by.get(of, {})
            changes.append({"by_story": sid, "of_story": of,
                            "before": f"{b.get('passed')}/{b.get('total')}", "after": f"{a.get('passed')}/{a.get('total')}",
                            "broke": [t["title"] for t in broke], "fixed": [t["title"] for t in fixed],
                            "common_error": example})
    return {"stories": stories, "changes": changes}


def _files(commits: list[dict]) -> str:
    files = source_files(commits)
    top = files[:TOP_FILES]
    more = len(files) - len(top)
    return ", ".join(f"`{f.rsplit('/', 1)[-1]}` ({n})" for f, n in top) + (f", +{more} more" if more > 0 else "")


def render(run: Path) -> str:
    h = analyse(run)
    out = ["## How it happened", "",
           "Each story's commits, and which story broke or fixed an earlier story's held-out tests. "
           "Attribution is per commit, so an agent that commits once per story is blamed per story.", "",
           "| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |", "|---|---|---|---|"]
    for sid, s in h["stories"].items():
        cs = s["commits"]
        who = ("harness snapshot (agent left work uncommitted)" if cs and all(c["by_harness"] for c in cs)
               else f"{sum(not c['by_harness'] for c in cs)} by the agent" + (", + harness snapshot" if any(c["by_harness"] for c in cs) else ""))
        out.append(f"| {sid} | {who if cs else '—'} | {sum(c['insertions'] for c in cs)} / {sum(c['deletions'] for c in cs)} | "
                   f"{_files(cs) or '—'} |")
    by = collections.defaultdict(list)
    for c in h["changes"]:
        by[c["by_story"]].append(c)
    out += ["", "### Earlier stories broken or fixed", ""]
    if not by:
        out.append("No story changed an earlier story's held-out results.")
    for sid, cs in by.items():
        broke, fixed = sum(len(c["broke"]) for c in cs), sum(len(c["fixed"]) for c in cs)
        subj = "; ".join(c["subject"] for c in h["stories"][sid]["commits"]) or "no commits"
        out.append(f"- **Story {sid} broke {broke}, fixed {fixed}** earlier held-out tests ({subj}). "
                   f"Source files it changed most: {_files(h['stories'][sid]['commits']) or '—'}.")
        for c in cs:
            titles = c["broke"][:TITLES_SHOWN]
            out.append(f"  - story {int(c['of_story'])}: {c['before']} → {c['after']}"
                       + (f"; broke {len(c['broke'])}: " + "; ".join(f"“{t}”" for t in titles)
                          + (" …" if len(c["broke"]) > TITLES_SHOWN else "") if c["broke"] else "")
                       + (f"; fixed {len(c['fixed'])}" if c["fixed"] else "")
                       + (f". Most common error: `{c['common_error'][:ERROR_SHOWN_CHARS]}`" if c["common_error"] else ""))
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    print(render(Path(sys.argv[1])))
