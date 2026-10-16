"""The epic's delete-all-then-integrate commands (story 20 of the data-separation epic).

Five small commands run the owner's steps four and five once for the whole epic, in one detached working copy:

    epic-entry     refuse to start unless the touched set, the coverage and the stage are right
    epic-worktree  create, status, sync and can-push for the one detached working copy
    epic-groups    propose, check, connect NAME and status for the component groups
    epic-finish    move the stage to Reimplemented when every group is green and the release check passed
    epic-search    repeat the audit's recorded queries over the tracked files

The tool's existing commands (check-touched-set, check-coverage, check-stubs, run-suites, report-deletion, fates, stage) are
used as they are. These commands write reports only, apart from the stage move epic-finish asks the existing stage command
to make. They never edit production code, never create a branch and never send anything to a remote. Exit codes follow the
tool: 0 the rule holds, 1 it is broken, 2 the tool could not decide.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree

import refactor as R
from refactor import EXIT_ERROR, EXIT_FAIL, EXIT_OK, Result

MAX_LISTED_FILES = 20                                   # how many incoming files a sync names; the count is always given
MAX_NAMED_TESTS = 20                                    # how many failing tests a gate refusal names before it says how many more
MAX_LINE_CHARS = 160                                    # how much of a hit's line a report quotes
MIN_COMMIT_CHARS = 7                                    # the shortest commit abbreviation that identifies a commit
PERCENT_FULL = 100.0
PERCENT_DECIMALS = 2
BINARY_PROBE_BYTES = 8000                               # git's own test: a NUL byte in the first 8000 bytes makes a file binary
DEFAULT_WORKTREE = Path(".claude/worktrees/epic-delete")
DEFAULT_BASE = "origin/main"
REMOTE_NAME = "origin"
GROUPS_FILE = R.REFACTOR_DIR / "groups.toml"
QUERIES_FILE = R.AUDIT_DIR / "queries.toml"
EXCLUSIONS_FILE = R.AUDIT_DIR / "exclusions.toml"
RELEASE_CHECK_FILE = R.REPORTS_DIR / "release-check.json"
DELETION_REPORT = R.REPORTS_DIR / "deletion.json"
COMMAND_NAMES = ("epic-entry", "epic-worktree", "epic-groups", "epic-finish", "epic-search")
WORKTREE_ACTIONS = ("create", "status", "sync", "can-push")
GROUP_ACTIONS = ("propose", "check", "connect", "status")
ENTRY_STAGE = "Proved"
FINISH_TO = "Reimplemented"
GATE_STAGES = ("Reimplemented", "Compared")             # the stages from which the working copy may go to the shared main line
UNDECIDED_COVERAGE = ("E-TOOL-MISSING", "E-SUITE-RED", "E-NO-COVERAGE-RUNNER")      # the coverage step's codes for "cannot decide"
GROUP_GREEN, GROUP_RED, GROUP_WAITING, GROUP_SKIPPED = "green", "red", "waiting", "skipped"
CLOSED_STATES = (GROUP_GREEN, GROUP_SKIPPED)
RELEASE_PASSED = "passed"
AUDIT_PREFIX = R.AUDIT_DIR.as_posix() + "/"             # the audit folder holds the patterns themselves: no query searches it
EXCLUDE_SPEC, GLOB_SPEC = ":(exclude)", ":(glob)"       # the git pathspec forms the audit's Paths column uses
GIT_QUIET_ENV = {"GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "true"}


# ---- git, behind one seam so the unit tests can answer for it ---------------------------------------------------------

@dataclass
class GitOut:
    code: int
    out: str = ""
    err: str = ""


GitRunner = Callable[[Path, list[str]], GitOut]


def run_git(cwd: Path, args: list[str]) -> GitOut:
    done = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, env={**os.environ, **GIT_QUIET_ENV})
    return GitOut(done.returncode, done.stdout, done.stderr)


def git_tracked_files(root: Path) -> list[str]:
    """Every file git tracks in the working copy, as repository-relative paths (a path git lists that is gone from the disk is left out)."""
    done = run_git(root, ["ls-files", "-z"])
    if done.code != 0:
        raise RuntimeError(f"git ls-files failed: {done.err.strip()}")
    return sorted(name for name in done.out.split("\0") if name and (root / name).is_file())


# ---- paths: the globs of the groups, and the pathspecs of the audit's queries ---------------------------------------------

@functools.lru_cache(maxsize=None)
def glob_regex(pattern: str) -> re.Pattern:
    """`**/` any folders (or none), `**` anything, `*` anything within one folder, `?` one character of a name."""
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(out))


def glob_matches(path: str, pattern: str) -> bool:
    return glob_regex(pattern).fullmatch(path) is not None


def spec_matches(path: str, spec: str) -> bool:
    """One positive pathspec: a file, a folder (everything under it) or a glob."""
    if spec.startswith(GLOB_SPEC):
        return glob_matches(path, spec[len(GLOB_SPEC):])
    folder = spec.rstrip("/")
    return path == folder or path.startswith(folder + "/") or glob_matches(path, spec)


def pathspecs_match(path: str, specs: list[str]) -> bool:
    """Git's rule: at least one plain spec includes the path and no `:(exclude)` spec removes it."""
    include = [s for s in specs if not s.startswith(EXCLUDE_SPEC)]
    exclude = [s[len(EXCLUDE_SPEC):] for s in specs if s.startswith(EXCLUDE_SPEC)]
    return any(spec_matches(path, s) for s in include) and not any(spec_matches(path, s) for s in exclude)


def percent(hit: int, total: int) -> float:
    return PERCENT_FULL if total == 0 else round(PERCENT_FULL * hit / total, PERCENT_DECIMALS)


def read_stage_or_none(root: Path, result: Result) -> str | None:
    try:
        return R.read_stage(root)
    except R.StageFileCorrupt as exc:
        result.error("E-STAGE-FILE-CORRUPT", R.STAGE_FILE.as_posix(), f"left as it is: {exc}")
        return None


def read_results_safe(root: Path) -> R.Results:
    """The result files the last run-suites wrote. A file that cannot be read is the same as a file that is not there: the language
    is listed as missing, never counted as passed."""
    try:
        return R.read_results(root)
    except (ElementTree.ParseError, json.JSONDecodeError, KeyError, ValueError, OSError):
        found = R.Results()
        for key, spec in R.read_toml(root / R.RUNNERS_FILE).items():
            if spec.get("results") is not None:
                found.missing.add(R.runner_language(key))
        return found


def all_outcomes(results: R.Results) -> dict[str, str]:
    return {**results.outcomes, **{f"rust:{name}": outcome for name, outcome in results.rust_names.items()}}



# ======================================================================================================================
# epic-entry
# ======================================================================================================================

def audit_pass_of(root: Path) -> str | None:
    files = R.pass_files(root)
    return files[-1].stem if files else None


def epic_entry(root: Path, runner: R.CoverageRunner = R.run_coverage) -> Result:
    """The touched set equals the audit, every touched function is at 100% of lines and branches, and the stage is Proved. The three
    checks always all run, so the one report lists every difference."""
    result = Result()
    entries = R.read_toml(root / R.TOUCHED_FILE).get("entry", [])
    for p in R.check_touched(root).problems:
        result.fail("E-ENTRY-TOUCHED", p.subject, f"{p.code} {p.detail}".strip())
    coverage = R.check_coverage(root, runner)
    for p in coverage.problems:
        if p.code in UNDECIDED_COVERAGE:
            result.error(p.code, p.subject, p.detail)
        else:
            result.fail("E-ENTRY-COVERAGE", p.subject, f"{p.code} {p.detail}".strip())
    for language, why in sorted(coverage.data.get("not_measured", {}).items()):
        result.fail("E-ENTRY-COVERAGE", language, f"not measured: {why}")
    stage = read_stage_or_none(root, result)
    if stage is not None and stage != ENTRY_STAGE:
        result.fail("E-ENTRY-STAGE", R.STAGE_FILE.as_posix(), f"the stage is {stage}; the epic starts from {ENTRY_STAGE}")
    if not entries:
        result.fail("E-ENTRY-EMPTY", R.TOUCHED_FILE.as_posix(), "the touched set has no entry, so there is nothing to remove")
    measured = coverage.data.get("measured", {})
    lines_n, lines_hit = sum(c[0] for c in measured.values()), sum(c[1] for c in measured.values())
    branches_n, branches_hit = sum(c[2] for c in measured.values()), sum(c[3] for c in measured.values())
    languages = sorted({e["language"] for e in entries})
    result.data = {
        "audit_pass": audit_pass_of(root),
        "functions": {language: sum(1 for e in entries if e["language"] == language) for language in languages},
        "coverage": {"lines_percent": percent(lines_hit, lines_n), "branches_percent": percent(branches_hit, branches_n), "measured": measured},
        "stage": stage,
    }
    R.write_report(root, "epic-entry", result)
    return result


# ======================================================================================================================
# epic-worktree
# ======================================================================================================================

def cap_files(names: list[str]) -> tuple[list[str], int]:
    """The first MAX_LISTED_FILES names, and how many there are in all."""
    return names[:MAX_LISTED_FILES], len(names)


def is_working_copy(git: GitRunner, copy: Path) -> bool:
    if not copy.is_dir():
        return False
    top = git(copy, ["rev-parse", "--show-toplevel"])
    return top.code == 0 and Path(top.out.strip()).resolve() == copy.resolve()


def recorded_path(root: Path) -> Path | None:
    path = root / R.REPORTS_DIR / "epic-worktree.json"
    if not path.exists():
        return None
    try:
        return Path(json.loads(path.read_text())["path"])
    except (json.JSONDecodeError, KeyError, TypeError):
        return None


def check_copy(result: Result, git: GitRunner, copy: Path) -> bool:
    """The folder is a working copy and is detached; on a branch it is refused by name."""
    if not is_working_copy(git, copy):
        result.fail("E-WT-MISSING", str(copy), "the folder is not a working copy")
        return False
    branch = git(copy, ["symbolic-ref", "-q", "--short", "HEAD"])
    if branch.code == 0:
        result.fail("E-NOT-DETACHED", str(copy), f"the working copy is on the branch {branch.out.strip()}")
        return False
    return True


def ahead_behind(git: GitRunner, copy: Path, base: str) -> tuple[int, int] | None:
    counted = git(copy, ["rev-list", "--left-right", "--count", f"HEAD...{base}"])
    if counted.code != 0:
        return None
    ahead, behind = counted.out.split()
    return int(ahead), int(behind)


def fetch(result: Result, git: GitRunner, where: Path) -> bool:
    done = git(where, ["fetch", REMOTE_NAME])
    if done.code != 0:
        result.error("E-FETCH-FAILED", REMOTE_NAME, done.err.strip())
        return False
    return True


def commit_of(git: GitRunner, where: Path, ref: str = "HEAD") -> str | None:
    done = git(where, ["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"])
    return done.out.strip() if done.code == 0 else None


def worktree_create(result: Result, root: Path, copy: Path, base: str, git: GitRunner) -> None:
    if copy.exists():
        result.fail("E-WT-EXISTS", str(copy), "the folder exists; nothing is changed in it")
        return
    if not fetch(result, git, root):
        return
    commit = commit_of(git, root, base)
    if commit is None:
        result.fail("E-WT-BASE-UNKNOWN", base, "not a known reference")
        return
    copy.parent.mkdir(parents=True, exist_ok=True)
    added = git(root, ["worktree", "add", "--detach", str(copy), commit])
    if added.code != 0:
        result.error("E-WT-CREATE-FAILED", str(copy), added.err.strip())
        return
    result.data["base_commit"] = commit


def worktree_status(result: Result, copy: Path, base: str, git: GitRunner) -> None:
    if not check_copy(result, git, copy):
        return
    counts = ahead_behind(git, copy, base)
    if counts is None:
        result.fail("E-WT-BASE-UNKNOWN", base, "not a known reference in the working copy")
        return
    changed = git(copy, ["status", "--porcelain", "--untracked-files=no"]).out.strip()
    result.data.update({"detached": True, "ahead": counts[0], "behind": counts[1], "dirty": bool(changed)})


def worktree_sync(result: Result, copy: Path, base: str, git: GitRunner) -> None:
    if not check_copy(result, git, copy):
        return
    if git(copy, ["status", "--porcelain", "--untracked-files=no"]).out.strip():
        result.fail("E-WT-DIRTY", str(copy), "tracked files are changed, so a rebase would lose work: commit or discard them first")
        return
    if not fetch(result, git, copy):
        return
    incoming = [n for n in git(copy, ["diff", "--name-only", f"HEAD...{base}"]).out.splitlines() if n]
    listed, total = cap_files(incoming)
    result.data.update({"files_in": listed, "files_in_count": total, "head_before": commit_of(git, copy)})
    rebased = git(copy, ["rebase", base])
    if rebased.code != 0:
        conflicting = [n for n in git(copy, ["diff", "--name-only", "--diff-filter=U"]).out.splitlines() if n]
        git(copy, ["rebase", "--abort"])
        result.data.update({"files_in": [], "files_in_count": 0})
        for name in conflicting or [str(copy)]:
            result.fail("E-WT-REBASE-CONFLICT", name, "the rebase met an overlap and was aborted; the head is as before" if conflicting else rebased.err.strip())


def worktree_gate(result: Result, copy: Path, base: str, git: GitRunner) -> None:
    """Whether the copy may go to the shared main line. Every condition is checked, so one report lists what is missing."""
    if not check_copy(result, git, copy):
        return
    stage = read_stage_or_none(copy, result)
    if stage is not None and stage not in GATE_STAGES:
        result.fail("E-PUSH-NOT-REIMPLEMENTED", R.STAGE_FILE.as_posix(), f"the stage is {stage}; it must be {' or '.join(GATE_STAGES)}")
    for e in R.read_toml(copy / R.TOUCHED_FILE).get("entry", []):
        if site_still_stub(copy, e):
            result.fail("E-STUB-REMAINS", f"{e['file']}::{e['function']}", "the function is still a stand-in")
    found = read_results_safe(copy)
    for language in sorted(found.missing):
        result.fail("E-NOT-GREEN", language, "no result file: an unknown is not green")
    outcomes = all_outcomes(found)
    bad = sorted(t for t, o in outcomes.items() if o != R.PASSED) + sorted(found.file_failures)
    for test in bad[:MAX_NAMED_TESTS]:
        result.fail("E-NOT-GREEN", test, "this test does not pass")
    if len(bad) > MAX_NAMED_TESTS:
        result.fail("E-NOT-GREEN", "suite", f"and {len(bad) - MAX_NAMED_TESTS} more failing")
    if not outcomes and not found.missing:
        result.fail("E-NOT-GREEN", "suite", "the last suite report holds no test result: an unknown is not green")
    if fetch(result, git, copy):
        counts = ahead_behind(git, copy, base)
        if counts is None:
            result.fail("E-WT-BASE-UNKNOWN", base, "not a known reference in the working copy")
        elif counts[1] > 0:
            result.fail("E-BEHIND-MAIN", base, f"the working copy lacks {counts[1]} commit(s) of {base}: sync first")


def site_still_stub(root: Path, entry: dict) -> bool:
    """Whether a touched function is a hand-written stand-in (the stub detector of check-stubs); a function that is gone is not one."""
    path = root / entry["file"]
    try:
        return path.exists() and R.is_stub(entry["language"], path.read_text(), entry["function"]) is True
    except (SyntaxError, UnicodeDecodeError):
        return False         # code that does not parse is not a stand-in; its tests are red, which is reported where it matters


def epic_worktree(root: Path, action: str, path: Path | None, base: str, git: GitRunner = run_git) -> Result:
    """create, status, sync and can-push for the one detached working copy. Nothing here creates a branch or sends anything out."""
    result = Result()
    chosen = path or recorded_path(root) or DEFAULT_WORKTREE
    copy = chosen if chosen.is_absolute() else root / chosen
    try:
        if action == "create":
            worktree_create(result, root, copy, base, git)
        elif action == "status":
            worktree_status(result, copy, base, git)
        elif action == "sync":
            worktree_sync(result, copy, base, git)
        elif action == "can-push":
            worktree_gate(result, copy, base, git)
        else:
            result.fail("E-WT-ACTION", action, f"actions: {', '.join(WORKTREE_ACTIONS)}")
        result.data["path"] = str(copy)
        if is_working_copy(git, copy):
            result.data["head"] = commit_of(git, copy)
    except FileNotFoundError as exc:
        result.error("E-TOOL-MISSING", "git", f"cannot run {exc.filename or 'git'}")
    R.write_report(root, "epic-worktree", result)
    return result


@dataclass
class Group:
    name: str
    order: int
    patterns: list[str]
    tests: list[str] = field(default_factory=list)
    empty_reason: str = ""
    except_patterns: list[str] = field(default_factory=list)
    sites: list[str] = field(default_factory=list)


def propose_groups(root: Path) -> list[Group]:
    raise NotImplementedError("skeleton")


def render_groups_toml(groups: list[Group]) -> str:
    raise NotImplementedError("skeleton")


def ungrouped_sites(root: Path, groups: list[Group]) -> list[str]:
    raise NotImplementedError("skeleton")


def site_is_stub(root: Path, entry: R.Entry | dict) -> bool:
    raise NotImplementedError("skeleton")


def epic_groups(root: Path, action: str, name: str | None, results: R.Results) -> Result:
    raise NotImplementedError("skeleton")


def epic_finish(root: Path, git: GitRunner = run_git, results: R.Results | None = None) -> Result:
    raise NotImplementedError("skeleton")


def epic_search(root: Path, files: Callable[[Path], list[str]] = git_tracked_files) -> Result:
    raise NotImplementedError("skeleton")


# ======================================================================================================================
# the command line
# ======================================================================================================================

def add_parsers(sub: argparse._SubParsersAction) -> None:
    """Register the five commands on the tool's parser (the only change refactor.py makes for them)."""
    sub.add_parser("epic-entry", help="refuse to start unless the touched set, the coverage and the stage are right",
                   description="the touched set equals the audit, every touched function is at 100%, the stage is Proved")
    wt = sub.add_parser("epic-worktree", help="the one detached working copy: create, status, sync, can-push",
                        description="the one detached working copy of the epic's deletion and integration")
    wt.add_argument("action", choices=WORKTREE_ACTIONS)
    wt.add_argument("--path", type=Path, help=f"where the working copy is (default {DEFAULT_WORKTREE})")
    wt.add_argument("--base", default=DEFAULT_BASE, help=f"what the working copy is based on (default {DEFAULT_BASE})")
    gr = sub.add_parser("epic-groups", help="the component groups: propose, check, connect NAME, status",
                        description="connect the removed places to the shared library one group at a time")
    gr.add_argument("action", choices=GROUP_ACTIONS)
    gr.add_argument("name", nargs="?", help="the group to connect")
    gr.add_argument("--toml", action="store_true", help="propose: print the draft as groups.toml text and nothing else")
    sub.add_parser("epic-finish", help="move the stage to Reimplemented when every group is green and the release check passed",
                   description="every group green, the release check passed on this commit, the suite green")
    sub.add_parser("epic-search", help="repeat the audit's queries over the tracked files: zero hits outside the exclusions",
                   description="repeat the audit's recorded queries and report every hit that no exclusion covers")


def print_groups(result: Result, action: str) -> None:
    if action == "propose":
        for g in result.data["groups"]:
            print(f"  {g['order']}  {g['name']}: {len(g['sites'])} site(s)")
        for site in result.data["ungrouped"]:
            print(f"  ungrouped  {site}")
    elif action == "status" and result.exit_code == EXIT_OK:
        for g in result.data["groups"]:
            print(f"  {g['order']}  {g['name']}  {g['state']}  ({g['sites']} sites, {g['sites_stub']} stand-in; {g['tests']} tests, {g['tests_red']} red)")


def run_command(root: Path, args: argparse.Namespace) -> Result:
    if args.command == "epic-entry":
        return epic_entry(root)
    if args.command == "epic-worktree":
        return epic_worktree(root, args.action, args.path, args.base)
    if args.command == "epic-finish":
        return epic_finish(root)
    if args.command == "epic-search":
        return epic_search(root)
    if args.action == "propose" and args.toml:
        sys.stdout.write(render_groups_toml(propose_groups(root)))
        sys.stdout.flush()
        raise SystemExit(EXIT_OK)
    if args.action == "connect":
        ran = R.run_suites(root)
        if ran.exit_code != EXIT_OK:
            return ran
    result = epic_groups(root, args.action, args.name, read_results_safe(root))
    print_groups(result, args.action)
    return result
