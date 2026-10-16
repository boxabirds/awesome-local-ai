"""The epic's delete-all-then-integrate commands, for story 20 (see the story's design in Ceetrix).

SKELETON: signatures and constants only; behaviour is added command by command after its tests have been seen to fail.
"""
from __future__ import annotations

import argparse
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import refactor as R
from refactor import Result

MAX_LISTED_FILES = 20                                   # how many incoming files a sync names; the count is always given
DEFAULT_WORKTREE = Path(".claude/worktrees/epic-delete")
DEFAULT_BASE = "origin/main"
GROUPS_FILE = R.REFACTOR_DIR / "groups.toml"
QUERIES_FILE = R.AUDIT_DIR / "queries.toml"
EXCLUSIONS_FILE = R.AUDIT_DIR / "exclusions.toml"
RELEASE_CHECK_FILE = R.REPORTS_DIR / "release-check.json"
COMMAND_NAMES = ("epic-entry", "epic-worktree", "epic-groups", "epic-finish", "epic-search")


@dataclass
class GitOut:
    code: int
    out: str = ""
    err: str = ""


GitRunner = Callable[[Path, list[str]], GitOut]


def run_git(cwd: Path, args: list[str]) -> GitOut:
    raise NotImplementedError("skeleton")


@dataclass
class Group:
    name: str
    order: int
    patterns: list[str]
    tests: list[str] = field(default_factory=list)
    empty_reason: str = ""
    except_patterns: list[str] = field(default_factory=list)
    sites: list[str] = field(default_factory=list)


def epic_entry(root: Path, runner: R.CoverageRunner = R.run_coverage) -> Result:
    raise NotImplementedError("skeleton")


def epic_worktree(root: Path, action: str, path: Path | None, base: str, git: GitRunner = run_git) -> Result:
    raise NotImplementedError("skeleton")


def propose_groups(root: Path) -> list[Group]:
    raise NotImplementedError("skeleton")


def cap_files(names: list[str]) -> tuple[list[str], int]:
    raise NotImplementedError("skeleton")


def render_groups_toml(groups: list[Group]) -> str:
    raise NotImplementedError("skeleton")


def ungrouped_sites(root: Path, groups: list[Group]) -> list[str]:
    raise NotImplementedError("skeleton")


def read_results_safe(root: Path) -> R.Results:
    raise NotImplementedError("skeleton")


def site_is_stub(root: Path, entry: R.Entry) -> bool:
    raise NotImplementedError("skeleton")


def epic_groups(root: Path, action: str, name: str | None, results: R.Results) -> Result:
    raise NotImplementedError("skeleton")


def epic_finish(root: Path, git: GitRunner = run_git, results: R.Results | None = None) -> Result:
    raise NotImplementedError("skeleton")


def git_tracked_files(root: Path) -> list[str]:
    raise NotImplementedError("skeleton")


def epic_search(root: Path, files: Callable[[Path], list[str]] = git_tracked_files) -> Result:
    raise NotImplementedError("skeleton")


WORKTREE_ACTIONS = ("create", "status", "sync", "can-push")
GROUP_ACTIONS = ("propose", "check", "connect", "status")


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
    gr.add_argument("--toml", action="store_true", help="propose: print the draft as groups.toml text")
    sub.add_parser("epic-finish", help="move the stage to Reimplemented when every group is green and the release check passed",
                   description="every group green, the release check passed on this commit, the suite green")
    sub.add_parser("epic-search", help="repeat the audit's queries over the tracked files: zero hits outside the exclusions",
                   description="repeat the audit's recorded queries and report every hit that no exclusion covers")


def run_command(root: Path, args: argparse.Namespace) -> Result:
    raise NotImplementedError("skeleton")
