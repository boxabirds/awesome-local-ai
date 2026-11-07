"""Story 23 (harness.no_publish), TC-23 and the story-end units: the harness commits, tags and pushes nothing outside
the run's own repository, and writes no workspace.bundle. A run's records stay in its folder; the collector takes them
to the lake through the node's API. Nothing of a run reaches the bench checkout's history or the private repository.

The guard reads the harness's own sources: every git command that writes history (commit, push, rebase, bundle,
reset, merge, cherry-pick, am) must sit in a function that works on the run's own workspace, or on a scratch
repository of the harness's own, each named below with why. Anything else is a way for a run's data to leave
through git, and fails here with its file, line and function.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

import drive

HARNESS = Path(__file__).resolve().parent
WRITE_VERBS = {"commit", "push", "rebase", "bundle", "cherry-pick", "merge", "am", "reset"}

# (file, function): why its git writes are allowed. Every one works on a repository that is not the bench checkout
# and not the private repository.
ALLOWED = {
    ("drive.py", "restore_spec"): "the run's workspace: puts the pack's spec back after the agent changed it",
    ("drive.py", "begin_progress_file"): "the run's workspace: the story's PROGRESS.md",
    ("drive.py", "setup_workspace"): "the run's workspace: its first commit",
    ("drive.py", "setup_workspace_from"): "the run's workspace: a partial rerun's base",
    ("drive.py", "snapshot_story"): "the run's workspace: the agent's uncommitted work at the story's end",
    ("judge.py", "record_workspace"): "a scratch copy of a story's code in the judge's own blinded package",
}
# Shell scripts allowed to write git history, and why. judge-submit.sh is the outside judges' exchange, out of story 23.
ALLOWED_SHELL = {"judge-submit.sh": "an outside judge's grading, pushed to the judges' exchange (story 10)"}
SHELL_WRITE = re.compile(r"\bgit\b[^\n#]*\b(commit|push|rebase|bundle)\b")


def _gitish(n: ast.AST) -> bool:
    if isinstance(n, ast.Constant) and n.value == "git":
        return True
    if isinstance(n, ast.Starred):
        n = n.value
    if isinstance(n, ast.Name):
        return "git" in n.id.lower()
    if isinstance(n, ast.Attribute):
        return "git" in n.attr.lower()
    return False


def git_writes(source: str) -> list[tuple[int, str, list[str]]]:
    """(line, enclosing function, verbs) for every git command in `source` that writes history: a list literal holding
    "git" (or a git-prefix variable) and a write verb, or `<git prefix> + [..., verb, ...]`."""
    found: list[tuple[int, str, list[str]]] = []
    stack: list[str] = []

    def check(node: ast.AST, elts: list[ast.expr], prefixed: bool) -> None:
        verbs = sorted({e.value for e in elts if isinstance(e, ast.Constant) and e.value in WRITE_VERBS})
        if verbs and (prefixed or any(_gitish(e) for e in elts)):
            found.append((node.lineno, ".".join(stack) or "<module>", verbs))

    class Visitor(ast.NodeVisitor):
        def visit_FunctionDef(self, n):
            stack.append(n.name)
            self.generic_visit(n)
            stack.pop()

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_List(self, n):
            check(n, n.elts, False)
            self.generic_visit(n)

        def visit_BinOp(self, n):
            if isinstance(n.op, ast.Add) and isinstance(n.right, ast.List) and _gitish(n.left):
                check(n, n.right.elts, True)
                self.visit(n.left)
                return
            self.generic_visit(n)

    Visitor().visit(ast.parse(source))
    return found


def harness_sources() -> list[Path]:
    return sorted(p for p in HARNESS.glob("*.py") if not p.name.startswith("test_") and p.name != "conftest.py")


def test_the_scan_finds_each_way_the_harness_writes_git_history():
    """The guard is only as good as its scan: each form the harness has used must be found."""
    src = '''
def a(ws):
    sh(["git", "commit", "-qm", "m"], ws)
def b(root, git):
    run(git + ["push", "origin", "HEAD"])
def c(git):
    run([*git, "rebase", "origin/main"])
def d(ws):
    subprocess.run(["git", "-C", str(ws), "bundle", "create", "x", "--all"])
def e(git):
    run(git + ["status"])                     # a read: not a write
'''
    assert [(fn, verbs) for _, fn, verbs in git_writes(src)] == [
        ("a", ["commit"]), ("b", ["push"]), ("c", ["rebase"]), ("d", ["bundle"])]


def test_tc23_no_harness_code_writes_git_history_outside_the_run_s_own_repository():
    stray = [f"{p.name}:{line} {fn} {verbs}" for p in harness_sources() for line, fn, verbs in git_writes(p.read_text())
             if (p.name, fn) not in ALLOWED]
    assert stray == [], "git writes outside the run's own repository:\n" + "\n".join(stray)


def test_tc23_no_harness_script_commits_pushes_or_bundles():
    stray = [f"{p.name}:{i}: {line.strip()}" for p in sorted(HARNESS.glob("*.sh")) if p.name not in ALLOWED_SHELL
             for i, line in enumerate(p.read_text().splitlines(), 1)
             if not line.lstrip().startswith("#") and SHELL_WRITE.search(line)]
    assert stray == [], "\n".join(stray)


def test_tc23_every_allowed_writer_still_exists():
    """An allowance for a function that is gone would let a new one of the same name through unexamined."""
    present = {(p.name, fn) for p in harness_sources() for _, fn, _ in git_writes(p.read_text())}
    assert set(ALLOWED) <= present, sorted(set(ALLOWED) - present)


def test_nothing_in_the_harness_names_the_workspace_bundle_as_a_file_to_write():
    """The bundle is read only where an old run still has one (finalize.code_of, for a run from before story 23)."""
    writers = [f"{p.name}:{i}" for p in harness_sources() for i, line in enumerate(p.read_text().splitlines(), 1)
               if "WORKSPACE_BUNDLE" in line and not line.lstrip().startswith("#")]
    assert writers == []


@pytest.mark.parametrize("sid, tag", [(1, "story-01"), (9, "story-09"), (12, "story-12"), (100, "story-100")])
def test_a_story_s_tag_is_story_and_its_two_digit_number(sid, tag):
    assert drive.STORY_TAG.format(sid) == tag
