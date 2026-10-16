"""Tests of the epic commands (story 20): epic-entry, epic-worktree, epic-groups, epic-finish, epic-search.

Written before the commands. Each section names the test cases (TC-nn) of the story's design it covers, and the level.
The carried-out capabilities (stand-ins, the deletion report, the new contracts, the hand-over) have no code of their own;
their cases run the existing commands on the miniature project in the end-to-end workflows at the end.

Run with: uv run --with pytest python -m pytest -q -p no:cacheprovider ops/refactor/epic_test.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

import epic as E
import refactor as R

HERE = Path(__file__).parent
TOOL = HERE / "refactor.py"
MINI = HERE / "fixtures" / "mini"
EPIC_FIXTURES = HERE / "fixtures" / "epic"
OVERLAY = EPIC_FIXTURES / "overlay"
AUDIT_FIXTURES = EPIC_FIXTURES / "audit"
MINI_IGNORED = shutil.ignore_patterns("target", "node_modules", "__pycache__", ".pytest_cache", "reports")
REAL_ROOT = HERE.parent.parent
COPY_IGNORED = shutil.ignore_patterns("node_modules", "__pycache__", ".pytest_cache")      # a copied bytecode cache would keep naming the original folder

NO_NEWS = ""
TEN_THOUSAND = 10_000
EIGHT_GROUPS = 8
FILES_OVER_THE_CAP = E.MAX_LISTED_FILES + 5
TEN_INCOMING = 10
PY_TESTS = ["python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit",
            "python:py/test_core.py::test_run_dir_joins_the_root_and_the_run_id"]
RUST_TESTS = ["rust:rs/mini/src/lib.rs::tests::an_empty_listing_has_no_lines", "rust:rs/mini/src/lib.rs::tests::a_listing_counts_its_lines"]
TS_TESTS = ["typescript:ts/src/core.test.ts::a run with a title shows it", "typescript:ts/src/core.test.ts::a run without a title is untitled"]
ASSIGNED = PY_TESTS + RUST_TESTS + TS_TESTS
MINI_ENTRIES = {"py/minipy/core.py::record", "py/minipy/core.py::run_dir", "rs/mini/src/lib.rs::count_lines", "ts/src/core.ts::titleOf"}


# ---- helpers ------------------------------------------------------------------------------------------------------

def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def write_stage(root: Path, stage: str) -> None:
    touched = root / "ops/refactor/touched_set.toml"
    entries = tomllib.loads(touched.read_text()).get("entry", []) if touched.exists() else []
    proved = R.proof_of(entries) if R.STAGES.index(stage) >= R.STAGES.index("Proved") else None
    write(root, "ops/refactor/stage.toml", R.render_stage(stage, [], proved))


def codes(result: R.Result) -> list[str]:
    return [p.code for p in result.problems]


def unit_mini(tmp_path: Path, stage: str = "Proved") -> Path:
    """A private copy of the miniature project with the epic overlay (groups, contracts, fates), at the given stage."""
    root = tmp_path / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    write_stage(root, stage)
    return root


def perfect_runner(extra=None):
    """A canned coverage runner: every line of every touched file run once, no branches. `extra(file, FileLines)` may spoil it."""
    def run(root, language, spec):
        measured = {}
        for e in R.read_toml(root / R.TOUCHED_FILE).get("entry", []):
            if e["language"] == language:
                count = len((root / e["file"]).read_text().splitlines()) + 1
                measured[e["file"]] = R.FileLines({n: 1 for n in range(1, count + 1)})
                if extra:
                    extra(e["file"], measured[e["file"]])
        return measured
    return run


def read_report(root: Path, name: str) -> dict:
    return json.loads((root / R.REPORTS_DIR / f"{name}.json").read_text())


def snapshot_bytes(root: Path, *rels: str) -> dict[str, bytes]:
    return {rel: (root / rel).read_bytes() for rel in rels}


def canned_results(overrides: dict[str, str] | None = None, default: str = R.PASSED) -> R.Results:
    found = R.Results()
    for test in ASSIGNED:
        outcome = (overrides or {}).get(test, default)
        if test.startswith("rust:"):
            found.rust_names[test.partition(":")[2].split("::", 1)[1]] = outcome
        else:
            found.outcomes[test] = outcome
    return found


def write_deletion(root: Path, tests=None, exit_code: int = R.EXIT_OK) -> None:
    write(root, "ops/refactor/reports/deletion.json", json.dumps({"exit_code": exit_code, "problems": [], "assigned_failed": sorted(tests if tests is not None else ASSIGNED)}))


def write_groups(root: Path, text: str) -> None:
    write(root, "ops/refactor/groups.toml", text)


def groups_text(groups: list[dict]) -> str:
    out = []
    for g in groups:
        out.append("[[group]]")
        out.append(f'name = {json.dumps(g["name"])}')
        out.append(f'order = {g["order"]}')
        out.append(f'patterns = {json.dumps(g["patterns"])}')
        if g.get("except"):
            out.append(f'except = {json.dumps(g["except"])}')
        if g.get("tests") is not None:
            out.append(f'tests = {json.dumps(g["tests"])}')
        if g.get("empty_reason"):
            out.append(f'empty_reason = {json.dumps(g["empty_reason"])}')
        out.append("")
    return "\n".join(out)


MINI_GROUPS = [
    {"name": "python", "order": 1, "patterns": ["py/**"], "tests": PY_TESTS},
    {"name": "rust", "order": 2, "patterns": ["rs/**"], "tests": RUST_TESTS},
    {"name": "typescript", "order": 3, "patterns": ["ts/**"], "tests": TS_TESTS},
]


def mini_groups(**changes) -> list[dict]:
    """The miniature groups with changes by group name: {"rust": {"order": 2, ...}} (a value of None drops the group)."""
    out = []
    for g in MINI_GROUPS:
        change = changes.get(g["name"], {})
        if change is None:
            continue
        out.append({**g, **change})
    return out


def plain_wrapped_stubs(root: Path, which: set[str]) -> None:
    """Replace the named miniature files by their stand-ins (the same stand-ins story 1's tests use)."""
    for rel, text in STUBBED.items():
        if rel in which:
            (root / rel).write_text(text)


STUBBED = {
    "py/minipy/core.py": "def record(items, limit):\n    raise NotImplementedError(\"deleted\")\n\n\ndef run_dir(data_root, run_id):\n    raise NotImplementedError(\"deleted\")\n",
    "rs/mini/src/lib.rs": ("pub fn count_lines(_listing: &str) -> usize {\n    todo!()\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n"
                           "    #[test]\n    fn an_empty_listing_has_no_lines() {\n        assert_eq!(count_lines(\"\"), 0);\n    }\n\n"
                           "    #[test]\n    fn a_listing_counts_its_lines() {\n        assert_eq!(count_lines(\"a\\nb\"), 2);\n    }\n}\n"),
    "ts/src/core.ts": "export function titleOf(run: { title?: string }): string {\n  throw new Error(\"not implemented: deleted\")\n}\n",
}


# ---- git worlds: a clone, a bare remote that records pushes, and a second clone that lands commits -------------------

@pytest.fixture(autouse=True)
def git_identity(monkeypatch):
    for key, value in (("GIT_AUTHOR_NAME", "Epic Test"), ("GIT_AUTHOR_EMAIL", "epic@example.invalid"), ("GIT_COMMITTER_NAME", "Epic Test"),
                       ("GIT_COMMITTER_EMAIL", "epic@example.invalid"), ("GIT_CONFIG_GLOBAL", os.devnull), ("GIT_CONFIG_SYSTEM", os.devnull)):
        monkeypatch.setenv(key, value)


GIT_ENV = {**os.environ, "GIT_AUTHOR_NAME": "Epic Test", "GIT_AUTHOR_EMAIL": "epic@example.invalid", "GIT_COMMITTER_NAME": "Epic Test",
           "GIT_COMMITTER_EMAIL": "epic@example.invalid", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=GIT_ENV)
    if check and done.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} in {cwd}: {done.stderr}")
    return done


class World:
    """work: the clone the commands run in; bare: its remote; other: a second clone for landing commits; pushes: what the remote received."""

    def __init__(self, tmp_path: Path, files: dict[str, str]):
        self.bare = tmp_path / "remote.git"
        self.work = tmp_path / "work"
        self.other = tmp_path / "other"
        self.pushes = tmp_path / "pushes.log"
        git(tmp_path, "init", "-q", "--bare", "-b", "main", str(self.bare))
        git(tmp_path, "init", "-q", "-b", "main", str(self.work))
        for rel, text in files.items():
            write(self.work, rel, text)
        git(self.work, "add", "-A")
        git(self.work, "commit", "-q", "-m", "the project")
        git(self.work, "remote", "add", "origin", str(self.bare))
        git(self.work, "push", "-q", "origin", "main")
        hook = self.bare / "hooks" / "pre-receive"
        hook.write_text(f"#!/bin/sh\necho received >> '{self.pushes}'\n")
        hook.chmod(0o755)
        git(tmp_path, "clone", "-q", str(self.bare), str(self.other))

    def land(self, files: dict[str, str], message: str = "a run's records") -> str:
        """Commit files in the second clone and send them to the remote (the shared main line moving)."""
        for rel, text in files.items():
            write(self.other, rel, text)
        git(self.other, "add", "-A")
        git(self.other, "commit", "-q", "-m", message)
        git(self.other, "push", "-q", "origin", "main")
        return git(self.other, "rev-parse", "HEAD").stdout.strip()

    def pushed(self) -> bool:
        return self.pushes.exists() and self.pushes.read_text().strip() != ""


TINY_ENTRY = '[[entry]]\nlanguage = "python"\nfile = "py/a.py"\nfunction = "record"\nclasses = ["C"]\n'
TINY_RUNNERS = '[python]\ndir = "py"\n\n[python.results]\nformat = "junit"\ncommand = ["true"]\n'
GREEN_JUNIT = '<testsuite><testcase classname="test_a" name="test_x" file="test_a.py"/></testsuite>'
RED_JUNIT = ('<testsuite><testcase classname="test_a" name="test_x" file="test_a.py"/>'
             '<testcase classname="test_a" name="test_y" file="test_a.py"><failure message="boom">boom</failure></testcase></testsuite>')


def tiny_files(stage: str = "Reimplemented", body: str = "    return list(items)") -> dict[str, str]:
    entries = tomllib.loads(TINY_ENTRY)["entry"]
    proved = R.proof_of(entries) if R.STAGES.index(stage) >= R.STAGES.index("Proved") else None
    return {".gitignore": "ops/refactor/reports/\n", "py/a.py": f"def record(items):\n{body}\n",
            "ops/refactor/touched_set.toml": TINY_ENTRY, "ops/refactor/runners.toml": TINY_RUNNERS,
            "ops/refactor/stage.toml": R.render_stage(stage, [], proved)}


def tiny_world(tmp_path: Path, **kw) -> World:
    return World(tmp_path, tiny_files(**kw))


def copy_path(tmp_path: Path) -> Path:
    return tmp_path / "epic-copy"


class FakeGit:
    """A canned git: answers by the longest matching prefix of the arguments; records every call. The defaults describe a good
    detached copy that is level with main."""

    def __init__(self, rules: dict | None = None):
        self.rules = dict(rules or {})
        self.calls: list[list[str]] = []

    def __call__(self, cwd: Path, args: list[str]) -> E.GitOut:
        self.calls.append(list(args))
        line = " ".join(args)
        match = max((k for k in self.rules if line.startswith(k)), key=len, default=None)
        if match is not None:
            answer = self.rules[match]
            return answer(cwd) if callable(answer) else answer
        if line.startswith("rev-parse --show-toplevel"):
            return E.GitOut(0, str(cwd.resolve()) + "\n")
        if line.startswith("symbolic-ref"):
            return E.GitOut(1)
        if line.startswith("rev-list --left-right --count"):
            return E.GitOut(0, "0\t0\n")
        if line.startswith("rev-parse"):
            return E.GitOut(0, "deadbeef\n")
        return E.GitOut(0)


# ======================================================================================================================
# epic-entry (refactor.epic_entry.check): TC-01 to TC-14
# ======================================================================================================================

def entry_unit(tmp_path: Path, stage: str = "Proved", runner=None) -> tuple[Path, R.Result]:
    root = unit_mini(tmp_path, stage)
    return root, E.epic_entry(root, runner or perfect_runner())


def test_tc01_unit_form_all_conditions_hold_gives_the_counts_and_the_stage(tmp_path):
    root, result = entry_unit(tmp_path)
    assert result.exit_code == R.EXIT_OK and result.problems == []
    report = read_report(root, "epic-entry")
    assert report["stage"] == "Proved"
    assert report["functions"] == {"python": 2, "rust": 1, "typescript": 1}
    assert report["coverage"]["lines_percent"] == 100.0 and report["coverage"]["branches_percent"] == 100.0
    assert "audit_pass" in report


def test_tc02_a_touched_set_that_differs_from_the_scan_is_refused_with_the_underlying_code_and_function(tmp_path):
    root = unit_mini(tmp_path)
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text().split("[[entry]]\nlanguage = \"typescript\"")[0])      # titleOf is no longer listed
    write_stage(root, "Proved")
    result = E.epic_entry(root, perfect_runner())
    assert result.exit_code == R.EXIT_FAIL
    problem = next(p for p in result.problems if p.code == "E-ENTRY-TOUCHED")
    assert problem.subject == "ts/src/core.ts::titleOf" and "E-UNLISTED-MATCH" in problem.detail


def test_tc03_an_entry_that_names_no_function_is_refused_as_stale(tmp_path):
    root = unit_mini(tmp_path)
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "py/minipy/core.py"\nfunction = "gone"\nclasses = ["C"]\n')
    write_stage(root, "Proved")
    result = E.epic_entry(root, perfect_runner())
    problem = next(p for p in result.problems if p.code == "E-ENTRY-TOUCHED")
    assert problem.subject == "py/minipy/core.py::gone" and "E-STALE-ENTRY" in problem.detail


def big_function_root(tmp_path: Path) -> Path:
    root = unit_mini(tmp_path)
    body = "".join(f"    x{n} = {n}\n" for n in range(TEN_THOUSAND - 1))
    write(root, "py/minipy/big.py", f"def big():\n{body}")
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "py/minipy/big.py"\nfunction = "big"\nclasses = ["C"]\n')
    write_stage(root, "Proved")
    return root


def test_tc04_boundary_9999_of_10000_lines_is_refused_naming_the_function_and_the_line(tmp_path):
    root = big_function_root(tmp_path)
    missed = TEN_THOUSAND // 2

    def spoil(file, lines):
        if file == "py/minipy/big.py":
            lines.lines[missed] = 0
    result = E.epic_entry(root, perfect_runner(spoil))
    assert result.exit_code == R.EXIT_FAIL
    problem = next(p for p in result.problems if p.code == "E-ENTRY-COVERAGE")
    assert problem.subject == "py/minipy/big.py::big"
    assert f"{TEN_THOUSAND - 1} of {TEN_THOUSAND} lines" in problem.detail and f"line {missed}" in problem.detail


def test_tc04_boundary_exactly_100_percent_of_10000_lines_passes(tmp_path):
    root = big_function_root(tmp_path)
    assert E.epic_entry(root, perfect_runner()).exit_code == R.EXIT_OK


def test_tc05_a_branch_not_taken_is_refused_naming_the_function_and_the_branch(tmp_path):
    root = unit_mini(tmp_path)
    first = min(R.function_lines(root, "python", "py/minipy/core.py", "record"))

    def spoil(file, lines):
        if file == "py/minipy/core.py":
            lines.branches.append((first, "0:1", False))
    result = E.epic_entry(root, perfect_runner(spoil))
    assert result.exit_code == R.EXIT_FAIL
    problem = next(p for p in result.problems if p.code == "E-ENTRY-COVERAGE")
    assert problem.subject == "py/minipy/core.py::record" and "branch" in problem.detail


def test_tc06_a_missing_coverage_tool_is_exit_2_naming_it_and_nothing_else_is_claimed(tmp_path):
    def missing(root, language, spec):
        if language == "rust":
            raise R.ToolMissing("cargo-llvm-cov")
        return perfect_runner()(root, language, spec)
    root = unit_mini(tmp_path)
    result = E.epic_entry(root, missing)
    assert result.exit_code == R.EXIT_ERROR
    assert [(p.code, p.subject) for p in result.problems] == [("E-TOOL-MISSING", "rust")]
    assert "cargo-llvm-cov" in result.problems[0].detail


def test_tc07_a_red_suite_while_measuring_is_exit_2_naming_the_failure(tmp_path):
    def red(root, language, spec):
        raise R.SuiteRed("pytest exited 1: FAILED py/test_core.py::test_x")
    root = unit_mini(tmp_path)
    result = E.epic_entry(root, red)
    assert result.exit_code == R.EXIT_ERROR and "E-SUITE-RED" in codes(result)
    assert any("test_x" in p.detail for p in result.problems if p.code == "E-SUITE-RED")


@pytest.mark.parametrize("stage", ["Inventory", "Matrices", "Deleted", "RedContracts", "Reimplemented", "Compared"])
def test_tc08_to_tc11_every_stage_but_proved_is_refused_naming_it(tmp_path, stage):
    root, result = entry_unit(tmp_path, stage)
    assert result.exit_code == R.EXIT_FAIL
    problem = next(p for p in result.problems if p.code == "E-ENTRY-STAGE")
    assert stage in problem.detail + problem.subject


def test_tc12_an_empty_touched_set_is_refused_and_the_stage_is_unchanged(tmp_path):
    root = unit_mini(tmp_path)
    (root / "ops/refactor/touched_set.toml").write_text("")
    (root / "ops/refactor/classes.toml").write_text("[sources]\npython = []\nrust = []\ntypescript = []\nshell = []\n")
    write_stage(root, "Proved")
    before = snapshot_bytes(root, "ops/refactor/stage.toml", "ops/refactor/touched_set.toml")
    result = E.epic_entry(root, perfect_runner())
    assert result.exit_code == R.EXIT_FAIL and codes(result) == ["E-ENTRY-EMPTY"]
    assert snapshot_bytes(root, "ops/refactor/stage.toml", "ops/refactor/touched_set.toml") == before


def test_tc13_two_faults_at_once_are_both_in_the_one_report(tmp_path):
    root = unit_mini(tmp_path, "Matrices")
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "py/minipy/core.py"\nfunction = "gone"\nclasses = ["C"]\n')
    result = E.epic_entry(root, perfect_runner())
    assert {"E-ENTRY-TOUCHED", "E-ENTRY-STAGE"} <= set(codes(result))
    report = read_report(root, "epic-entry")
    assert {p["code"] for p in report["problems"]} >= {"E-ENTRY-TOUCHED", "E-ENTRY-STAGE"}


# ---- integration: the command as a process, with the real runners ------------------------------------------------------

@pytest.fixture(scope="module")
def mini_deps(tmp_path_factory):
    """The miniature project's TypeScript dependencies, installed once; skips with its reason when a real tool is absent."""
    missing = [name for name, probe in (("cargo-llvm-cov", ["cargo", "llvm-cov", "--version"]), ("bun", ["bun", "--version"]),
                                        ("uv", ["uv", "--version"]), ("git", ["git", "--version"])) if subprocess.run(probe, capture_output=True).returncode != 0]
    if missing:
        pytest.skip(f"tools not installed: {', '.join(missing)}")
    root = tmp_path_factory.mktemp("epicdeps") / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    subprocess.run(["bun", "install"], cwd=root / "ts", check=True, capture_output=True)
    return root / "ts" / "node_modules"


@pytest.fixture(scope="module")
def tool_env(tmp_path_factory):
    target = tmp_path_factory.mktemp("epictarget")
    env = {**os.environ, "CARGO_TARGET_DIR": str(target), "GIT_AUTHOR_NAME": "Epic Test", "GIT_AUTHOR_EMAIL": "epic@example.invalid",
           "GIT_COMMITTER_NAME": "Epic Test", "GIT_COMMITTER_EMAIL": "epic@example.invalid", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
    return env


def tool(root: Path, env: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TOOL), "--root", str(root), *args], capture_output=True, text=True, env=env)


def link_deps(root: Path, deps: Path) -> None:
    link = root / "ts" / "node_modules"
    if not link.exists():
        os.symlink(deps, link)


@pytest.fixture(scope="module")
def entry_run(mini_deps, tool_env, tmp_path_factory):
    """One real epic-entry run on the miniature project, with the bytes of the guarded files before it."""
    root = tmp_path_factory.mktemp("entryrun") / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    link_deps(root, mini_deps)
    write_stage(root, "Proved")
    guarded = ["ops/refactor/stage.toml", "ops/refactor/touched_set.toml", "py/minipy/core.py", "rs/mini/src/lib.rs", "ts/src/core.ts"]
    before = snapshot_bytes(root, *guarded)
    done = tool(root, tool_env, "epic-entry")
    return root, done, before, guarded


def test_tc01_integration_the_miniature_project_passes_the_entry_check_as_a_process(entry_run):
    root, done, _, _ = entry_run
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    report = read_report(root, "epic-entry")
    assert report["stage"] == "Proved" and report["functions"] == {"python": 2, "rust": 1, "typescript": 1}
    assert report["coverage"]["lines_percent"] == 100.0 and report["coverage"]["branches_percent"] == 100.0
    assert set(report["coverage"]["measured"]) == MINI_ENTRIES


def test_tc14_the_entry_check_writes_reports_only(entry_run):
    root, done, before, guarded = entry_run
    assert done.returncode == R.EXIT_OK and (root / "ops/refactor/reports/epic-entry.json").exists()      # it ran, and wrote its report
    assert snapshot_bytes(root, *guarded) == before


# ======================================================================================================================
# epic-worktree (refactor.epic_worktree.isolate): TC-15 to TC-34
# ======================================================================================================================

def branches(repo: Path) -> list[str]:
    return git(repo, "for-each-ref", "--format=%(refname)", "refs/heads").stdout.split()


def test_tc15_create_makes_a_detached_copy_at_origin_main_and_reports_it(tmp_path):
    world = tiny_world(tmp_path)
    copy = copy_path(tmp_path)
    result = E.epic_worktree(world.work, "create", copy, E.DEFAULT_BASE)
    assert result.exit_code == R.EXIT_OK, result.problems
    assert git(copy, "symbolic-ref", "-q", "HEAD", check=False).returncode != 0          # detached
    main = git(world.work, "rev-parse", "origin/main").stdout.strip()
    assert git(copy, "rev-parse", "HEAD").stdout.strip() == main
    report = read_report(world.work, "epic-worktree")
    assert report["path"] == str(copy) and report["base_commit"] == main and report["head"] == main


def test_tc16_create_creates_no_branch(tmp_path):
    world = tiny_world(tmp_path)
    before = branches(world.work)
    E.epic_worktree(world.work, "create", copy_path(tmp_path), E.DEFAULT_BASE)
    assert branches(world.work) == before == ["refs/heads/main"]


def test_tc17_an_existing_folder_is_refused_and_left_alone(tmp_path):
    world = tiny_world(tmp_path)
    copy = copy_path(tmp_path)
    write(copy, "keep.txt", "mine")
    result = E.epic_worktree(world.work, "create", copy, E.DEFAULT_BASE)
    assert codes(result) == ["E-WT-EXISTS"] and result.exit_code == R.EXIT_FAIL
    assert (copy / "keep.txt").read_text() == "mine" and not (copy / ".git").exists()


def test_tc18_an_unknown_base_is_refused(tmp_path):
    world = tiny_world(tmp_path)
    result = E.epic_worktree(world.work, "create", copy_path(tmp_path), "origin/no-such-line")
    assert codes(result) == ["E-WT-BASE-UNKNOWN"] and not copy_path(tmp_path).exists()


def make_copy(tmp_path: Path, **kw) -> tuple[World, Path]:
    world = tiny_world(tmp_path, **kw)
    copy = copy_path(tmp_path)
    assert E.epic_worktree(world.work, "create", copy, E.DEFAULT_BASE).exit_code == R.EXIT_OK
    return world, copy


def test_tc19_status_of_a_good_copy(tmp_path):
    world, copy = make_copy(tmp_path)
    result = E.epic_worktree(world.work, "status", copy, E.DEFAULT_BASE)
    assert result.exit_code == R.EXIT_OK
    assert (result.data["detached"], result.data["ahead"], result.data["behind"], result.data["dirty"]) == (True, 0, 0, False)


def test_tc20_a_copy_switched_onto_a_branch_is_refused_naming_the_branch(tmp_path):
    world, copy = make_copy(tmp_path)
    git(copy, "checkout", "-q", "-b", "stray")                  # a throwaway branch in a temporary repository
    result = E.epic_worktree(world.work, "status", copy, E.DEFAULT_BASE)
    problem = result.problems[0]
    assert problem.code == "E-NOT-DETACHED" and "stray" in problem.subject + problem.detail


def test_tc21_a_removed_folder_is_missing(tmp_path):
    world, copy = make_copy(tmp_path)
    shutil.rmtree(copy)
    assert codes(E.epic_worktree(world.work, "status", copy, E.DEFAULT_BASE)) == ["E-WT-MISSING"]


def test_tc21_a_folder_that_is_not_a_working_copy_is_missing(tmp_path):
    world = tiny_world(tmp_path)
    (tmp_path / "plain").mkdir()
    assert codes(E.epic_worktree(world.work, "status", tmp_path / "plain", E.DEFAULT_BASE)) == ["E-WT-MISSING"]


def test_tc22_sync_with_nothing_new_changes_nothing(tmp_path):
    world, copy = make_copy(tmp_path)
    head = git(copy, "rev-parse", "HEAD").stdout
    result = E.epic_worktree(world.work, "sync", copy, E.DEFAULT_BASE)
    assert result.exit_code == R.EXIT_OK and result.data["files_in_count"] == 0 and result.data["files_in"] == []
    assert git(copy, "rev-parse", "HEAD").stdout == head


def test_tc23_sync_rebases_the_copys_own_commit_over_three_incoming_record_files(tmp_path):
    world, copy = make_copy(tmp_path)
    write(copy, "py/a.py", "def record(items):\n    return sorted(items)\n")
    git(copy, "commit", "-q", "-am", "the copy's own work")
    own = git(copy, "rev-parse", "HEAD").stdout.strip()
    landed = world.land({f"runs/r{n}/metrics.json": "{}" for n in range(3)})
    result = E.epic_worktree(world.work, "sync", copy, E.DEFAULT_BASE)
    assert result.exit_code == R.EXIT_OK, result.problems
    assert result.data["files_in_count"] == 3 and result.data["files_in"] == [f"runs/r{n}/metrics.json" for n in range(3)]
    assert git(copy, "rev-parse", "HEAD").stdout.strip() != own
    assert git(copy, "rev-parse", "HEAD~1").stdout.strip() == landed
    assert (copy / "py/a.py").read_text().endswith("sorted(items)\n")


def test_tc24_the_incoming_list_is_capped_and_the_count_is_whole(tmp_path):
    copy = tmp_path / "copy"
    copy.mkdir()
    names = [f"runs/r{n:03d}.json" for n in range(FILES_OVER_THE_CAP)]
    fake = FakeGit({"diff --name-only": E.GitOut(0, "\n".join(names) + "\n")})
    result = E.epic_worktree(tmp_path, "sync", copy, E.DEFAULT_BASE, git=fake)
    assert result.exit_code == R.EXIT_OK
    assert result.data["files_in_count"] == FILES_OVER_THE_CAP and result.data["files_in"] == names[:E.MAX_LISTED_FILES]
    assert E.MAX_LISTED_FILES == 20


@pytest.mark.parametrize("count", [0, 1, E.MAX_LISTED_FILES, E.MAX_LISTED_FILES + 1])
def test_tc24_boundary_the_cap_applies_from_21_names(count):
    names = [f"f{n}" for n in range(count)]
    listed, total = E.cap_files(names)
    assert total == count and listed == names[:E.MAX_LISTED_FILES]


def test_tc25_sync_refuses_changed_tracked_files_and_rebases_nothing(tmp_path):
    world, copy = make_copy(tmp_path)
    write(copy, "py/a.py", "def record(items):\n    return []\n")
    world.land({"runs/r/metrics.json": "{}"})
    head = git(copy, "rev-parse", "HEAD").stdout
    result = E.epic_worktree(world.work, "sync", copy, E.DEFAULT_BASE)
    assert codes(result) == ["E-WT-DIRTY"] and git(copy, "rev-parse", "HEAD").stdout == head


def conflicting_world(tmp_path: Path, incoming_files: int = 1) -> tuple[World, Path]:
    world, copy = make_copy(tmp_path)
    write(copy, "py/a.py", "def record(items):\n    return ['copy']\n")
    git(copy, "commit", "-q", "-am", "the copy changes a line")
    landed = {"py/a.py": "def record(items):\n    return ['main']\n"}
    landed.update({f"runs/r{n}/metrics.json": "{}" for n in range(incoming_files - 1)})
    world.land(landed)
    return world, copy


def test_tc26_an_overlap_aborts_the_rebase_names_the_file_and_leaves_the_head(tmp_path):
    world, copy = conflicting_world(tmp_path)
    head = git(copy, "rev-parse", "HEAD").stdout
    text = (copy / "py/a.py").read_text()
    result = E.epic_worktree(world.work, "sync", copy, E.DEFAULT_BASE)
    assert result.exit_code == R.EXIT_FAIL and [(p.code, p.subject) for p in result.problems] == [("E-WT-REBASE-CONFLICT", "py/a.py")]
    assert git(copy, "rev-parse", "HEAD").stdout == head and (copy / "py/a.py").read_text() == text
    assert "rebase" not in git(copy, "status").stdout.lower()
    assert git(copy, "symbolic-ref", "-q", "HEAD", check=False).returncode != 0


def test_tc27_one_conflicting_file_among_ten_incoming_is_the_only_one_named(tmp_path):
    world, copy = conflicting_world(tmp_path, TEN_INCOMING)
    result = E.epic_worktree(world.work, "sync", copy, E.DEFAULT_BASE)
    assert [p.subject for p in result.problems] == ["py/a.py"]


def write_green(copy: Path, xml: str = GREEN_JUNIT) -> None:
    write(copy, "ops/refactor/reports/results-python.xml", xml)


def test_tc28_can_push_passes_when_every_condition_holds_and_nothing_is_sent(tmp_path):
    world, copy = make_copy(tmp_path)
    write_green(copy)
    result = E.epic_worktree(world.work, "can-push", copy, E.DEFAULT_BASE)
    assert result.exit_code == R.EXIT_OK, result.problems
    assert not world.pushed()


def can_push_unit(tmp_path: Path, stage: str = "Reimplemented", body: str = "    return list(items)", xml: str | None = GREEN_JUNIT, git=None) -> R.Result:
    copy = tmp_path / "copy"
    for rel, text in tiny_files(stage, body).items():
        write(copy, rel, text)
    if xml is not None:
        write_green(copy, xml)
    return E.epic_worktree(tmp_path, "can-push", copy, E.DEFAULT_BASE, git=git or FakeGit())


def test_tc28_unit_form_all_conditions_hold(tmp_path):
    assert can_push_unit(tmp_path).exit_code == R.EXIT_OK


@pytest.mark.parametrize("stage", ["Inventory", "Matrices", "Proved", "Deleted", "RedContracts"])
def test_tc29_a_stage_before_reimplemented_is_refused(tmp_path, stage):
    assert codes(can_push_unit(tmp_path, stage)) == ["E-PUSH-NOT-REIMPLEMENTED"]


def test_tc29_boundary_compared_is_accepted(tmp_path):
    assert can_push_unit(tmp_path, "Compared").exit_code == R.EXIT_OK


def test_tc30_a_touched_function_that_is_still_a_stand_in_is_refused_by_name(tmp_path):
    result = can_push_unit(tmp_path, body="    raise NotImplementedError('x')")
    assert [(p.code, p.subject) for p in result.problems] == [("E-STUB-REMAINS", "py/a.py::record")]


def test_tc31_a_failing_test_is_not_green_and_is_named(tmp_path):
    result = can_push_unit(tmp_path, xml=RED_JUNIT)
    assert codes(result) == ["E-NOT-GREEN"] and "test_y" in result.problems[0].subject + result.problems[0].detail


def test_tc32_no_suite_report_is_not_green(tmp_path):
    assert codes(can_push_unit(tmp_path, xml=None)) == ["E-NOT-GREEN"]


def test_tc32_a_report_with_no_test_in_it_is_not_green_either(tmp_path):
    assert codes(can_push_unit(tmp_path, xml="<testsuite/>")) == ["E-NOT-GREEN"]


def test_tc33_a_copy_that_lacks_a_commit_of_main_is_behind(tmp_path):
    world, copy = make_copy(tmp_path)
    write_green(copy)
    world.land({"runs/r/metrics.json": "{}"})
    result = E.epic_worktree(world.work, "can-push", copy, E.DEFAULT_BASE)
    assert codes(result) == ["E-BEHIND-MAIN"]


def test_tc34_no_command_ever_sends_anything_to_the_remote(tmp_path):
    world, copy = make_copy(tmp_path)
    write_green(copy)
    world.land({"runs/r/metrics.json": "{}"})
    world.pushes.unlink(missing_ok=True)                     # the landing above is the only thing the remote may have received
    for action in ("status", "sync", "can-push"):
        E.epic_worktree(world.work, action, copy, E.DEFAULT_BASE)
    assert not world.pushed()


def test_tc34_the_source_has_no_push_call_and_no_branch_creation():
    text = (HERE / "epic.py").read_text()
    stripped = re.sub(r"can-push|E-PUSH-[A-Z-]*", "", text)
    assert not re.search(r"(?i)\bpush", stripped), "epic.py must not mention sending anything to a remote"
    assert not re.search(r"""["'](branch|checkout|switch)["']""", text)
    assert not re.search(r"-b\b|--orphan", text.replace("--base", ""))


def test_tc15_through_the_process_create_status_and_can_push_are_exit_codes(tmp_path):
    world = tiny_world(tmp_path)
    copy = copy_path(tmp_path)
    run = lambda *a: subprocess.run([sys.executable, str(TOOL), "--root", str(world.work), *a], capture_output=True, text=True)
    assert run("epic-worktree", "create", "--path", str(copy)).returncode == R.EXIT_OK
    assert run("epic-worktree", "status", "--path", str(copy)).returncode == R.EXIT_OK
    assert run("epic-worktree", "can-push", "--path", str(copy)).returncode == R.EXIT_FAIL       # no suite report yet: not green
    assert not world.pushed()


# ======================================================================================================================
# epic-groups (refactor.epic_groups.connect): TC-49 to TC-72
# ======================================================================================================================

LIVE = {"rust": "pub fn {n}() -> u8 {{\n    1\n}}\n", "typescript": "export function {n}() {{\n  return 1\n}}\n",
        "python": "def {n}():\n    return 1\n", "shell": "{n}() {{\n  echo hi\n}}\n"}
STUB = {"rust": "pub fn {n}() {{\n    todo!()\n}}\n", "typescript": "export function {n}() {{\n  throw new Error(\"not implemented\")\n}}\n",
        "python": "def {n}():\n    raise NotImplementedError('x')\n", "shell": "{n}() {{\n  return 99\n}}\n"}
FAMILIES = [("rust", "tools/dbench/src/collect.rs", "collect_one"), ("typescript", "tools/benchmarker/server/sources.ts", "readState"),
            ("typescript", "tools/benchmarker/server/routes.ts", "forward"), ("typescript", "tools/vidi-gallery/src/load.ts", "loadGallery"),
            ("python", "ops/monitor/monitor.py", "watch"), ("python", "benchmarks/spec-bench/harness/annotate.py", "build_attempt"),
            ("python", "benchmarks/spec-bench/harness/drive.py", "drive"), ("shell", "setup-node.sh", "install_node")]
FAMILY_GROUP_NAMES = ["dbench ingest and collector", "the engine", "the benchmarker web forwarder", "the gallery", "the monitor",
                      "harness offline tools", "harness record path", "node setup"]


def family_root(tmp_path: Path, stubbed: set[int] = frozenset()) -> Path:
    """A root with one touched function in each of the eight path families (1-based, in the cutover order)."""
    root = tmp_path / "family"
    entries = ""
    for index, (language, file, function) in enumerate(FAMILIES, start=1):
        entries += f'[[entry]]\nlanguage = "{language}"\nfile = "{file}"\nfunction = "{function}"\nclasses = ["C"]\n\n'
        write(root, file, (STUB if index in stubbed else LIVE)[language].format(n=function))
    write(root, "ops/refactor/touched_set.toml", entries)
    write(root, "ops/refactor/assignments.toml", "")
    return root


def site_names(group: E.Group) -> list[str]:
    return [s.split("::")[0] for s in group.sites]


def test_tc49_propose_prints_eight_groups_in_the_cutover_order_and_writes_nothing(tmp_path):
    root = family_root(tmp_path)
    before = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
    groups = E.propose_groups(root)
    assert [g.name for g in groups] == FAMILY_GROUP_NAMES and [g.order for g in groups] == list(range(1, EIGHT_GROUPS + 1))
    assert [site_names(g) for g in groups] == [[file] for _, file, _ in FAMILIES]
    assert sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()) == before


def test_tc49_the_proposed_draft_as_text_is_a_groups_file_that_checks_clean(tmp_path):
    root = family_root(tmp_path)
    write_groups(root, E.render_groups_toml(E.propose_groups(root)))
    result = E.epic_groups(root, "check", None, R.Results())
    assert result.exit_code == R.EXIT_OK, [(p.code, p.subject) for p in result.problems]


def checked(tmp_path: Path, groups: list[dict], deletion: bool = True, known=None) -> R.Result:
    root = unit_mini(tmp_path)
    write_groups(root, groups_text(groups))
    if deletion:
        write_deletion(root)
    return E.epic_groups(root, "check", None, canned_results())


def test_tc50_a_grouping_that_covers_every_site_and_test_once_is_clean(tmp_path):
    assert checked(tmp_path, MINI_GROUPS).exit_code == R.EXIT_OK


def test_tc51_a_site_in_no_group_is_named(tmp_path):
    root = unit_mini(tmp_path)
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "misc/x.py"\nfunction = "f"\nclasses = ["C"]\n')
    write_groups(root, groups_text(MINI_GROUPS))
    result = E.epic_groups(root, "check", None, canned_results())
    assert [(p.code, p.subject) for p in result.problems] == [("E-SITE-UNGROUPED", "misc/x.py::f")]


def test_tc52_a_site_in_two_groups_is_refused_naming_both(tmp_path):
    result = checked(tmp_path, mini_groups(rust={"patterns": ["rs/**", "py/**"]}))
    problem = next(p for p in result.problems if p.code == "E-SITE-IN-TWO-GROUPS")
    assert "python" in problem.detail and "rust" in problem.detail


def test_tc53_an_empty_group_without_a_reason_is_refused(tmp_path):
    result = checked(tmp_path, MINI_GROUPS + [{"name": "gallery", "order": 4, "patterns": ["gallery/**"], "tests": []}])
    assert [(p.code, p.subject) for p in result.problems] == [("E-GROUP-EMPTY", "gallery")]


def test_tc54_an_empty_group_with_a_reason_is_accepted_and_reported_as_skipped(tmp_path):
    result = checked(tmp_path, MINI_GROUPS + [{"name": "gallery", "order": 4, "patterns": ["gallery/**"], "tests": [], "empty_reason": "no gallery here"}])
    assert result.exit_code == R.EXIT_OK and result.data["skipped"] == {"gallery": "no gallery here"}


@pytest.mark.parametrize("orders", [(1, 2, 2), (1, 2, 4), (0, 1, 2), (2, 3, 4)])
def test_tc55_tc56_orders_must_be_unique_and_contiguous_from_1(tmp_path, orders):
    groups = [{**g, "order": o} for g, o in zip(MINI_GROUPS, orders)]
    assert "E-ORDER-INVALID" in codes(checked(tmp_path, groups))


def test_tc57_a_failed_protecting_test_in_no_group_is_named(tmp_path):
    result = checked(tmp_path, mini_groups(python={"tests": PY_TESTS[:1]}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-TEST-UNGROUPED", PY_TESTS[1])]


def test_tc58_a_test_in_two_groups_is_refused(tmp_path):
    result = checked(tmp_path, mini_groups(typescript={"tests": TS_TESTS + PY_TESTS[:1]}))
    problem = next(p for p in result.problems if p.code == "E-TEST-IN-TWO-GROUPS")
    assert problem.subject == PY_TESTS[0]


def test_tc59_a_listed_test_no_runner_knows_is_refused(tmp_path):
    result = checked(tmp_path, mini_groups(typescript={"tests": TS_TESTS + ["typescript:ts/src/nope.test.ts::ghost"]}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-TEST-UNKNOWN", "typescript:ts/src/nope.test.ts::ghost")]


def test_without_a_passing_deletion_report_the_test_lists_are_not_judged_for_completeness(tmp_path):
    result = checked(tmp_path, mini_groups(python={"tests": []}), deletion=False)
    assert result.exit_code == R.EXIT_OK and result.data["tests_checked"] is False


def connect(root: Path, name: str, results: R.Results | None = None) -> R.Result:
    return E.epic_groups(root, "connect", name, results or canned_results())


def stubbed_unit(tmp_path: Path, stubbed: set[str]) -> Path:
    root = unit_mini(tmp_path, "Deleted")
    write_groups(root, groups_text(MINI_GROUPS))
    write_deletion(root)
    plain_wrapped_stubs(root, stubbed)
    return root


def test_tc60_connecting_a_group_nobody_declared_is_refused(tmp_path):
    root = stubbed_unit(tmp_path, set())
    assert codes(connect(root, "Nowhere")) == ["E-GROUP-UNKNOWN"]


def test_tc61_unit_form_the_first_group_connected_with_green_tests_reports_what_turned_green(tmp_path):
    root = stubbed_unit(tmp_path, {"rs/mini/src/lib.rs", "ts/src/core.ts"})                 # python is connected (live), the rest are stand-ins
    result = connect(root, "python")
    assert result.exit_code == R.EXIT_OK, [(p.code, p.subject) for p in result.problems]
    report = read_report(root, "epic-group-python")
    assert sorted(report["sites_connected"]) == ["py/minipy/core.py::record", "py/minipy/core.py::run_dir"] and report["sites_stub"] == []
    assert sorted(report["tests_green"]) == sorted(PY_TESTS) and report["tests_red"] == [] and sorted(report["turned_green"]) == sorted(PY_TESTS)


def test_tc62_unit_form_a_site_still_a_stand_in_is_named(tmp_path):
    root = stubbed_unit(tmp_path, set())
    core = root / "py/minipy/core.py"
    core.write_text(core.read_text().replace('return f"{data_root}/{run_id}"', 'raise NotImplementedError("deleted")'))
    result = connect(root, "python")
    assert [(p.code, p.subject) for p in result.problems if p.code == "E-GROUP-SITE-STUB"] == [("E-GROUP-SITE-STUB", "py/minipy/core.py::run_dir")]


def test_tc63_unit_form_a_red_test_of_the_group_is_named(tmp_path):
    root = stubbed_unit(tmp_path, set())
    result = connect(root, "python", canned_results({PY_TESTS[0]: R.FAILED_STUB}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-GROUP-TEST-RED", PY_TESTS[0])]


def test_tc64_unit_form_connecting_a_later_group_while_an_earlier_one_has_a_stand_in_is_out_of_order(tmp_path):
    root = stubbed_unit(tmp_path, {"py/minipy/core.py"})
    result = connect(root, "rust")
    assert [(p.code, p.subject) for p in result.problems] == [("E-GROUP-OUT-OF-ORDER", "python")]


def test_tc65_unit_form_a_red_test_of_an_earlier_connected_group_is_a_regression(tmp_path):
    root = stubbed_unit(tmp_path, set())
    result = connect(root, "rust", canned_results({PY_TESTS[1]: R.FAILED_OTHER}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-REGRESSION", PY_TESTS[1])]


def test_tc68_the_smallest_group_one_site_one_test_connects(tmp_path):
    root = unit_mini(tmp_path, "Deleted")
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text('[[entry]]\nlanguage = "typescript"\nfile = "ts/src/core.ts"\nfunction = "titleOf"\nclasses = ["C"]\n')
    write_groups(root, groups_text([{"name": "only", "order": 1, "patterns": ["ts/**"], "tests": TS_TESTS[:1]}]))
    assert connect(root, "only").exit_code == R.EXIT_OK


def test_tc69_status_shows_two_groups_green_and_six_waiting(tmp_path):
    root = family_root(tmp_path, stubbed={3, 4, 5, 6, 7, 8})
    write_groups(root, E.render_groups_toml(E.propose_groups(root)))
    result = E.epic_groups(root, "status", None, R.Results())
    states = [g["state"] for g in result.data["groups"]]
    assert states == ["green", "green"] + ["waiting"] * 6 and result.exit_code == R.EXIT_OK


def test_tc70_a_listed_test_that_never_failed_is_flagged_and_not_counted_as_turned_green(tmp_path):
    root = stubbed_unit(tmp_path, set())
    write_deletion(root, tests=PY_TESTS[:1] + RUST_TESTS + TS_TESTS)                          # the second python test passed in the deletion report
    result = connect(root, "python")
    report = read_report(root, "epic-group-python")
    assert report["never_failed"] == [PY_TESTS[1]] and report["turned_green"] == [PY_TESTS[0]]


def test_tc72_an_unreadable_result_file_is_exit_2_and_is_never_a_pass(tmp_path):
    root = unit_mini(tmp_path)
    write(root, "ops/refactor/reports/results-python.xml", "<not xml")
    found = E.read_results_safe(root)
    assert "python" in found.missing
    result = connect(root, "python", found)
    assert result.exit_code == R.EXIT_ERROR and "E-RESULTS-MISSING" in codes(result)


def test_tc72_a_language_with_no_result_file_is_exit_2(tmp_path):
    root = unit_mini(tmp_path)
    found = canned_results()
    found.missing.add("rust")
    assert connect(root, "python", found).exit_code == R.EXIT_ERROR


def test_tc71_the_real_touched_set_lands_every_site_in_exactly_one_group_or_in_the_ungrouped_list():
    """Read-only over the repository's own touched set."""
    entries = R.read_toml(REAL_ROOT / R.TOUCHED_FILE).get("entry", [])
    groups = E.propose_groups(REAL_ROOT)
    assert [g.name for g in groups] == FAMILY_GROUP_NAMES
    placed = [s for g in groups for s in g.sites]
    ungrouped = E.ungrouped_sites(REAL_ROOT, groups)
    assert sorted(placed + ungrouped) == sorted(f"{e['file']}::{e['function']}" for e in entries)
    assert len(set(placed)) == len(placed)


# ---- integration: connecting groups with the real runners -----------------------------------------------------------------

@pytest.fixture(scope="module")
def stubbed_base(mini_deps, tool_env, tmp_path_factory):
    """The miniature project with every stand-in in place, the suites run against them and the deletion report passed."""
    root = tmp_path_factory.mktemp("stubbedbase") / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    link_deps(root, mini_deps)
    plain_wrapped_stubs(root, set(STUBBED))
    write_stage(root, "Deleted")
    assert tool(root, tool_env, "run-suites").returncode == R.EXIT_OK
    done = tool(root, tool_env, "report-deletion")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    return root


def stubbed_copy(stubbed_base: Path, tmp_path: Path, mini_deps: Path) -> Path:
    root = tmp_path / "mini"
    shutil.copytree(stubbed_base, root, symlinks=True, ignore=COPY_IGNORED)
    link_deps(root, mini_deps)
    return root


def restore(root: Path, *rels: str) -> None:
    for rel in rels:
        shutil.copy(MINI / rel, root / rel)


def report_of(root: Path, name: str) -> dict:
    return read_report(root, name)


def test_tc61_the_first_group_connected_against_the_real_runners(stubbed_base, mini_deps, tool_env, tmp_path):
    root = stubbed_copy(stubbed_base, tmp_path, mini_deps)
    restore(root, "py/minipy/core.py")
    done = tool(root, tool_env, "epic-groups", "connect", "python")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    report = report_of(root, "epic-group-python")
    assert len(report["sites_connected"]) == 2 and sorted(report["turned_green"]) == sorted(PY_TESTS)


def test_tc62_a_site_left_as_a_stand_in_is_refused_by_the_process(stubbed_base, mini_deps, tool_env, tmp_path):
    root = stubbed_copy(stubbed_base, tmp_path, mini_deps)
    restore(root, "py/minipy/core.py")
    core = root / "py/minipy/core.py"
    core.write_text(core.read_text().replace("def record(items, limit):", "def record(items, limit):\n    raise NotImplementedError('left')\n\n\ndef _old(items, limit):"))
    done = tool(root, tool_env, "epic-groups", "connect", "python")
    assert done.returncode == R.EXIT_FAIL
    assert ("E-GROUP-SITE-STUB", "py/minipy/core.py::record") in [(p["code"], p["subject"]) for p in report_of(root, "epic-group-python")["problems"]]


def test_tc63_a_connected_site_with_a_red_test_is_refused_by_the_process(stubbed_base, mini_deps, tool_env, tmp_path):
    root = stubbed_copy(stubbed_base, tmp_path, mini_deps)
    restore(root, "py/minipy/core.py")
    core = root / "py/minipy/core.py"
    core.write_text(core.read_text().replace("len(kept) < limit", "len(kept) < limit - 1"))
    done = tool(root, tool_env, "epic-groups", "connect", "python")
    assert done.returncode == R.EXIT_FAIL
    assert [p["code"] for p in report_of(root, "epic-group-python")["problems"]] == ["E-GROUP-TEST-RED"]


def test_tc64_a_later_group_before_an_earlier_one_is_out_of_order_for_the_process(stubbed_base, mini_deps, tool_env, tmp_path):
    root = stubbed_copy(stubbed_base, tmp_path, mini_deps)
    restore(root, "rs/mini/src/lib.rs")
    done = tool(root, tool_env, "epic-groups", "connect", "rust")
    assert done.returncode == R.EXIT_FAIL and "E-GROUP-OUT-OF-ORDER" in done.stdout


def test_tc65_tc66_tc67_a_regression_is_named_then_cleared_when_fixed_and_the_stage_never_moves(stubbed_base, mini_deps, tool_env, tmp_path):
    root = stubbed_copy(stubbed_base, tmp_path, mini_deps)
    stage_before = (root / "ops/refactor/stage.toml").read_bytes()
    restore(root, "py/minipy/core.py", "rs/mini/src/lib.rs")
    core = root / "py/minipy/core.py"
    good = core.read_text()
    core.write_text(good.replace("len(kept) < limit", "len(kept) < limit - 1"))              # python was connected, then broke
    broken = tool(root, tool_env, "epic-groups", "connect", "rust")
    assert broken.returncode == R.EXIT_FAIL
    assert ("E-REGRESSION", PY_TESTS[0]) in [(p["code"], p["subject"]) for p in report_of(root, "epic-group-rust")["problems"]]
    core.write_text(good)                                                                     # TC-66: fixed, run again
    fixed = tool(root, tool_env, "epic-groups", "connect", "rust")
    assert fixed.returncode == R.EXIT_OK, fixed.stdout + fixed.stderr
    assert (root / "ops/refactor/stage.toml").read_bytes() == stage_before                  # TC-67


# ======================================================================================================================
# epic-finish (refactor.epic_finish.green): TC-73 to TC-80
# ======================================================================================================================

HEAD = "c0ffee1234567890c0ffee1234567890c0ffee12"
GOOD_RELEASE = {"commit": HEAD, "checks": [{"name": "harness tests", "outcome": "passed"}, {"name": "dbench tests", "outcome": "passed"}]}


def finish_root(tmp_path: Path, stage: str = "RedContracts", release=GOOD_RELEASE) -> Path:
    root = unit_mini(tmp_path, stage)
    if release is not None:
        write(root, "ops/refactor/reports/release-check.json", json.dumps(release))
    return root


def finish(root: Path, results: R.Results | None = None, head: str = HEAD) -> R.Result:
    return E.epic_finish(root, FakeGit({"rev-parse HEAD": E.GitOut(0, head + "\n")}), results or canned_results())


def test_tc74_a_group_that_is_not_green_is_named_and_the_stage_stays(tmp_path):
    root = finish_root(tmp_path)
    result = finish(root, canned_results({RUST_TESTS[0]: R.FAILED_OTHER}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-FINISH-GROUP-OPEN", "rust")] and R.read_stage(root) == "RedContracts"


def test_tc75_a_missing_release_check_report_is_refused(tmp_path):
    root = finish_root(tmp_path, release=None)
    assert codes(finish(root)) == ["E-FINISH-RELEASE-CHECK-MISSING"] and R.read_stage(root) == "RedContracts"


def test_tc76_a_red_release_check_is_named(tmp_path):
    release = {**GOOD_RELEASE, "checks": [{"name": "harness tests", "outcome": "failed"}, {"name": "dbench tests", "outcome": "passed"}]}
    result = finish(finish_root(tmp_path, release=release))
    assert [(p.code, p.subject) for p in result.problems] == [("E-FINISH-RELEASE-CHECK-RED", "harness tests")]


def test_tc77_a_release_check_for_another_commit_is_stale(tmp_path):
    release = {**GOOD_RELEASE, "commit": "a" * 40}
    assert codes(finish(finish_root(tmp_path, release=release))) == ["E-FINISH-RELEASE-CHECK-STALE"]


def test_tc77_boundary_an_abbreviated_commit_that_starts_the_head_is_the_same_commit(tmp_path):
    release = {**GOOD_RELEASE, "commit": HEAD[:12]}
    assert "E-FINISH-RELEASE-CHECK-STALE" not in codes(finish(finish_root(tmp_path, release=release)))


def test_tc79_a_skipped_check_counts_as_red(tmp_path):
    release = {**GOOD_RELEASE, "checks": [{"name": "harness tests", "outcome": "skipped"}]}
    result = finish(finish_root(tmp_path, release=release))
    assert [(p.code, p.subject) for p in result.problems] == [("E-FINISH-RELEASE-CHECK-RED", "harness tests")]


def test_a_release_check_report_with_no_checks_or_not_json_is_not_a_pass(tmp_path):
    assert codes(finish(finish_root(tmp_path, release={"commit": HEAD, "checks": []}))) == ["E-FINISH-RELEASE-CHECK-RED"]
    root = finish_root(tmp_path / "b", release=None)
    write(root, "ops/refactor/reports/release-check.json", "not json")
    assert codes(finish(root)) == ["E-FINISH-RELEASE-CHECK-MISSING"]


@pytest.fixture(scope="module")
def finish_base(mini_deps, tool_env, tmp_path_factory):
    """A real git repository of the miniature project at RedContracts with every group connected and the suites run once."""
    root = tmp_path_factory.mktemp("finishbase") / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    write_stage(root, "RedContracts")
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "the project")
    link_deps(root, mini_deps)
    assert tool(root, tool_env, "run-suites").returncode == R.EXIT_OK
    head = git(root, "rev-parse", "HEAD").stdout.strip()
    write(root, "ops/refactor/reports/release-check.json", json.dumps({**GOOD_RELEASE, "commit": head}))
    return root


def finish_copy(finish_base: Path, tmp_path: Path) -> Path:
    root = tmp_path / "mini"
    shutil.copytree(finish_base, root, symlinks=True, ignore=COPY_IGNORED)
    for report in (root / "ops/refactor/reports").glob("results-*"):         # the TypeScript runner names its test files by absolute path
        report.write_text(report.read_text().replace(str(finish_base), str(root)))
    return root


def test_tc73_the_stage_moves_to_reimplemented_through_the_process(finish_base, tool_env, tmp_path):
    root = finish_copy(finish_base, tmp_path)
    done = tool(root, tool_env, "epic-finish")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    assert R.read_stage(root) == "Reimplemented"


def test_tc78_a_red_test_outside_every_group_is_not_justified_and_the_stage_stays(finish_base, tool_env, tmp_path):
    root = finish_copy(finish_base, tmp_path)
    results = root / "ops/refactor/reports/results-shell.json"
    body = json.loads(results.read_text())
    body["tests/three-test.sh"] = {"code": 1, "output": "assertion failed"}
    results.write_text(json.dumps(body))
    done = tool(root, tool_env, "epic-finish")
    assert done.returncode == R.EXIT_FAIL and "E-NOT-JUSTIFIED" in done.stdout and R.read_stage(root) == "RedContracts"


def test_tc80_a_skipped_stage_is_refused_by_the_stage_move(finish_base, tool_env, tmp_path):
    root = finish_copy(finish_base, tmp_path)
    write_stage(root, "Deleted")
    done = tool(root, tool_env, "epic-finish")
    assert done.returncode == R.EXIT_FAIL and "E-SKIP" in done.stdout and R.read_stage(root) == "Deleted"


# ======================================================================================================================
# epic-search (refactor.epic_search.none_left): TC-81 to TC-96
# ======================================================================================================================

def search_root(tmp_path: Path, files: dict[str, str] | None = None, queries: str | None = None, exclusions: str | None = None) -> Path:
    """A miniature project with the miniature audit's queries and exclusions, and optionally planted leftovers."""
    root = tmp_path / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    audit = root / "ops/refactor/audit"
    audit.mkdir(parents=True, exist_ok=True)
    (audit / "queries.toml").write_text(queries if queries is not None else (AUDIT_FIXTURES / "queries.toml").read_text())
    if exclusions is not False:
        (audit / "exclusions.toml").write_text(exclusions if exclusions is not None else (AUDIT_FIXTURES / "exclusions.toml").read_text())
    for rel, text in (files or {}).items():
        write(root, rel, text)
    return root


def every_file(root: Path) -> list[str]:
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and "/reports/" not in p.as_posix())      # git ignores reports


def search(root: Path) -> R.Result:
    return E.epic_search(root, every_file)


LEFTOVERS = {"python": ("py/minipy/leak.py", 'import subprocess\nsubprocess.run("git ls-tree -r HEAD")\n', "Q1"),
             "rust": ("rs/mini/src/leak.rs", 'fn leak() { run("ls-tree"); }\n', "Q2"),
             "typescript": ("ts/src/leak.ts", 'export const leak = "ls-tree"\n', "Q3"),
             "shell": ("tests/leak.sh", "git ls-tree -r HEAD\n", "Q4")}


def test_tc81_unit_form_a_project_with_no_leftover_has_zero_hits_and_the_exclusion_is_listed(tmp_path):
    root = search_root(tmp_path)
    result = search(root)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.subject) for p in result.problems]
    report = read_report(root, "epic-search")
    assert all(hits == [] for hits in report["hits"].values()) and set(report["hits"]) == {"Q1", "Q2", "Q3", "Q4", "Q5"}
    assert report["exclusions_applied"][0]["file"] == "tools/publish.sh" and report["exclusions_applied"][0]["reason"]


def test_tc83_a_hit_covered_by_an_exclusion_with_a_reason_is_listed_and_passes(tmp_path):
    root = search_root(tmp_path)
    report_before = search(root)
    assert report_before.exit_code == R.EXIT_OK and read_report(root, "epic-search")["exclusions_applied"][0]["query"] == "Q5"


def test_tc84_an_exclusion_without_a_reason_is_refused(tmp_path):
    root = search_root(tmp_path, exclusions='[[exclusion]]\nquery = "Q5"\nfile = "tools/publish.sh"\nline_pattern = "git push"\nreason = "  "\n')
    assert "E-EXCLUSION-NO-REASON" in codes(search(root))


def test_tc85_an_exclusion_that_matches_no_hit_is_stale(tmp_path):
    extra = (AUDIT_FIXTURES / "exclusions.toml").read_text() + '\n[[exclusion]]\nquery = "Q1"\nfile = "py/minipy/core.py"\nline_pattern = "ls-tree"\nreason = "nothing"\n'
    result = search(search_root(tmp_path, exclusions=extra))
    assert [(p.code, p.subject) for p in result.problems] == [("E-EXCLUSION-STALE", "Q1 py/minipy/core.py")]


def test_tc86_a_missing_queries_file_is_exit_2(tmp_path):
    root = search_root(tmp_path)
    (root / "ops/refactor/audit/queries.toml").unlink()
    result = search(root)
    assert result.exit_code == R.EXIT_ERROR and codes(result) == ["E-AUDIT-QUERIES-MISSING"]


def test_tc87_a_pattern_that_does_not_compile_is_refused_naming_the_query(tmp_path):
    result = search(search_root(tmp_path, queries='[[query]]\nid = "Qbad"\nlanguage = "python"\npattern = "(unclosed"\npaths = ["py"]\n', exclusions=""))
    assert [(p.code, p.subject) for p in result.problems] == [("E-QUERY-INVALID", "Qbad")]


def test_tc88_a_query_whose_paths_match_no_tracked_file_proves_nothing(tmp_path):
    result = search(search_root(tmp_path, queries='[[query]]\nid = "Qnone"\nlanguage = "python"\npattern = "x"\npaths = ["nowhere"]\n', exclusions=""))
    assert [(p.code, p.subject) for p in result.problems] == [("E-QUERY-NO-FILES", "Qnone")]


def test_tc88_boundary_a_query_that_matches_exactly_one_tracked_file_searches_it(tmp_path):
    root = search_root(tmp_path, queries='[[query]]\nid = "Qone"\nlanguage = "python"\npattern = "never-there"\npaths = ["py/minipy/core.py"]\n', exclusions="")
    assert search(root).exit_code == R.EXIT_OK


def test_tc89_a_match_inside_a_comment_is_still_a_hit(tmp_path):
    root = search_root(tmp_path, {"py/minipy/note.py": "# git ls-tree -r HEAD was removed\n"})
    result = search(root)
    assert [(p.code, p.subject) for p in result.problems] == [("E-HIT", "py/minipy/note.py:1")] and "Q1" in result.problems[0].detail


def test_tc89_the_comment_hit_is_cleared_only_by_an_exclusion_with_a_reason(tmp_path):
    root = search_root(tmp_path, {"py/minipy/note.py": "# git ls-tree -r HEAD was removed\n"},
                       exclusions=(AUDIT_FIXTURES / "exclusions.toml").read_text() +
                       '\n[[exclusion]]\nquery = "Q1"\nfile = "py/minipy/note.py"\nline_pattern = "was removed"\nreason = "history note"\n')
    assert search(root).exit_code == R.EXIT_OK


def test_tc92_the_report_holds_the_hash_of_both_input_files(tmp_path):
    root = search_root(tmp_path)
    search(root)
    report = read_report(root, "epic-search")
    audit = root / "ops/refactor/audit"
    assert report["inputs_sha256"] == {"queries": hashlib.sha256((audit / "queries.toml").read_bytes()).hexdigest(),
                                       "exclusions": hashlib.sha256((audit / "exclusions.toml").read_bytes()).hexdigest()}
    assert report["tracked_files"] == len(every_file(root)) - 2                         # the audit folder itself is not searched
    assert 0 < report["files_searched"] <= report["tracked_files"]                       # a file no query's paths reach is not searched


def test_tc93_hits_on_the_first_and_the_last_line_are_both_found(tmp_path):
    root = search_root(tmp_path, {"py/minipy/edge.py": "git ls-tree a\nx = 1\ny = 2\ngit ls-tree b"})
    assert [p.subject for p in search(root).problems] == ["py/minipy/edge.py:1", "py/minipy/edge.py:4"]


def test_tc94_an_empty_file_has_no_hit_and_no_error(tmp_path):
    assert search(search_root(tmp_path, {"py/minipy/empty.py": ""})).exit_code == R.EXIT_OK


def test_tc95_a_binary_file_is_skipped_and_listed(tmp_path):
    root = search_root(tmp_path)
    (root / "py/blob.bin").write_bytes(b"git ls-tree\x00\x01\x02")
    result = search(root)
    assert result.exit_code == R.EXIT_OK and read_report(root, "epic-search")["skipped_binary"] == ["py/blob.bin"]


def test_tc96_the_same_inputs_give_the_same_report_bytes(tmp_path):
    root = search_root(tmp_path, {"py/minipy/edge.py": "git ls-tree a\n"})
    search(root)
    first = (root / "ops/refactor/reports/epic-search.json").read_bytes()
    search(root)
    assert (root / "ops/refactor/reports/epic-search.json").read_bytes() == first


def test_pathspecs_follow_gits_rules_for_the_audits_paths_column():
    """The audit's Paths column holds git pathspecs: a folder, `:(glob)` (a star stays inside one folder) and `:(exclude)`; a plain
    pathspec's star crosses folders, so `:(exclude)*.md` leaves out every Markdown file at any depth."""
    specs = ["benchmarks/spec-bench", "tools", ":(glob)*.sh", ":(exclude)ops/refactor", ":(exclude)*.md"]
    assert E.pathspecs_match("tools/dbench/src/x.rs", specs)
    assert E.pathspecs_match("setup-node.sh", specs) and not E.pathspecs_match("tools/x/run.sh", [":(glob)*.sh"])
    assert not E.pathspecs_match("tools/dbench/README.md", specs)                       # a plain star crosses folders
    assert not E.pathspecs_match("benchmarks/spec-bench/docs/deep/notes.md", specs)
    assert E.pathspecs_match("combinations/a/b.rs", ["tools"]) is False


# ---- integration: a real git tree --------------------------------------------------------------------------------------

def committed(root: Path) -> None:
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "the project")


def test_tc81_a_real_git_tree_with_no_leftover_passes_as_a_process(tmp_path, tool_env):
    root = search_root(tmp_path)
    committed(root)
    done = tool(root, tool_env, "epic-search")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr


def test_tc82_a_leftover_git_call_in_a_rust_file_is_an_e_hit_with_file_line_and_query(tmp_path, tool_env):
    root = search_root(tmp_path, {"rs/mini/src/leak.rs": 'fn leak() { run("ls-tree"); }\n'})
    committed(root)
    done = tool(root, tool_env, "epic-search")
    assert done.returncode == R.EXIT_FAIL
    assert "E-HIT  rs/mini/src/leak.rs:1  Q2" in done.stdout


def test_tc90_a_leftover_in_each_of_the_four_languages_gives_one_hit_each(tmp_path, tool_env):
    root = search_root(tmp_path, {rel: text for rel, text, _ in LEFTOVERS.values()})
    committed(root)
    done = tool(root, tool_env, "epic-search")
    assert done.returncode == R.EXIT_FAIL
    hits = [(p["subject"], p["detail"].split()[0]) for p in read_report(root, "epic-search")["problems"] if p["code"] == "E-HIT"]
    assert sorted(hits) == sorted((f"{rel}:{2 if language == 'python' else 1}", query) for language, (rel, _, query) in LEFTOVERS.items())


def test_tc91_an_untracked_file_is_not_searched_and_the_count_says_so(tmp_path, tool_env):
    root = search_root(tmp_path)
    committed(root)
    tracked = len(git(root, "ls-files").stdout.split())
    write(root, "py/minipy/untracked.py", "git ls-tree -r HEAD\n")
    done = tool(root, tool_env, "epic-search")
    assert done.returncode == R.EXIT_OK
    assert read_report(root, "epic-search")["tracked_files"] == tracked - 2              # tracked files outside the audit folder


# ======================================================================================================================
# end-to-end workflows on the miniature project (W-1, W-2, W-3)
# ======================================================================================================================

def stub_all(copy: Path) -> None:
    plain_wrapped_stubs(copy, set(STUBBED))


def unstub(copy: Path, *rels: str) -> None:
    restore(copy, *rels)


def epic_world(tmp_path: Path, mini_deps: Path) -> tuple[World, Path]:
    """The miniature project at Proved, pushed to a bare remote, and the working copy created from it by the tool."""
    files = {}
    root = tmp_path / "seed"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    write_stage(root, "Proved")
    for p in root.rglob("*"):
        if p.is_file():
            files[p.relative_to(root).as_posix()] = p.read_text()
    shutil.rmtree(root)
    world = World(tmp_path, files)
    copy = copy_path(tmp_path)
    return world, copy


def create_copy(world: World, copy: Path, env: dict, mini_deps: Path) -> None:
    done = tool(world.work, env, "epic-worktree", "create", "--path", str(copy))
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    link_deps(copy, mini_deps)


def write_release_check(copy: Path) -> None:
    head = git(copy, "rev-parse", "HEAD").stdout.strip()
    template = (EPIC_FIXTURES / "release-check.json").read_text().replace("HEAD_COMMIT", head)
    write(copy, "ops/refactor/reports/release-check.json", template)


HANDOVER = ("# Hand-over to the parity story\n\nStory 16 compares old and new on real data, starting from the commit below. "
            "The stage is Reimplemented; Compared is not moved by this story.\n")


def test_tc100_w1_the_whole_sequence_from_the_entry_check_to_a_successful_push_gate(mini_deps, tool_env, tmp_path):
    world, copy = epic_world(tmp_path, mini_deps)
    os.symlink(mini_deps, world.work / "ts" / "node_modules")
    # TC-01: the entry check passes on the clone
    assert tool(world.work, tool_env, "epic-entry").returncode == R.EXIT_OK
    # the working copy
    create_copy(world, copy, tool_env, mini_deps)
    # TC-38 (first half): the stage cannot move to Deleted while the real bodies are there
    refused = tool(copy, tool_env, "stage", "Deleted")
    assert refused.returncode == R.EXIT_FAIL and "E-NOT-JUSTIFIED" in refused.stdout
    # TC-36 and TC-37: a real body, and a stand-in with an extra statement, are refused
    stub_all(copy)
    core = copy / "py/minipy/core.py"
    stubs = core.read_text()
    core.write_text(stubs.replace('def run_dir(data_root, run_id):\n    raise NotImplementedError("deleted")', 'def run_dir(data_root, run_id):\n    return f"{data_root}/{run_id}"'))
    real_body = tool(copy, tool_env, "check-stubs")
    assert real_body.returncode == R.EXIT_FAIL and "E-NOT-STUB" in real_body.stdout and "run_dir" in real_body.stdout
    core.write_text(stubs.replace('def run_dir(data_root, run_id):\n    raise', 'def run_dir(data_root, run_id):\n    print("x")\n    raise'))
    assert "E-NOT-STUB" in tool(copy, tool_env, "check-stubs").stdout
    # TC-35 and TC-38: every place a stand-in, then the stage moves
    core.write_text(stubs)
    ok = tool(copy, tool_env, "check-stubs")
    assert ok.returncode == R.EXIT_OK and "4 entries" in ok.stdout
    assert tool(copy, tool_env, "stage", "Deleted").returncode == R.EXIT_OK
    # TC-39: all six protecting tests fail; TC-42: a missing result file is not a pass
    assert tool(copy, tool_env, "run-suites").returncode == R.EXIT_OK
    results_rust = copy / "ops/refactor/reports/results-rust.jsonl"
    saved = results_rust.read_text()
    results_rust.unlink()
    assert "E-RESULTS-MISSING" in tool(copy, tool_env, "report-deletion").stdout
    results_rust.write_text(saved)
    deletion = tool(copy, tool_env, "report-deletion")
    assert deletion.returncode == R.EXIT_OK and len(read_report(copy, "deletion")["assigned_failed"]) == 6
    # TC-45 to TC-48: three new contract tests red, six old tests with one fate each, then RedContracts
    assert tool(copy, tool_env, "fates").returncode == R.EXIT_OK
    assert read_report(copy, "fates")["counts"] == {"kept": 3, "rewritten": 2, "retired": 1}
    assert tool(copy, tool_env, "stage", "RedContracts").returncode == R.EXIT_OK
    # the groups, in order
    assert tool(copy, tool_env, "epic-groups", "check").returncode == R.EXIT_OK
    for name, rels in (("python", ["py/minipy/core.py"]), ("rust", ["rs/mini/src/lib.rs"]), ("typescript", ["ts/src/core.ts"])):
        unstub(copy, *rels)
        done = tool(copy, tool_env, "epic-groups", "connect", name)
        assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    # the release check stand-in, and the finish
    write_release_check(copy)
    done = tool(copy, tool_env, "epic-finish")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    assert R.read_stage(copy) == "Reimplemented"
    # TC-81: the final search
    audit = copy / "ops/refactor/audit"
    audit.mkdir(parents=True, exist_ok=True)
    shutil.copy(AUDIT_FIXTURES / "queries.toml", audit / "queries.toml")
    shutil.copy(AUDIT_FIXTURES / "exclusions.toml", audit / "exclusions.toml")
    searched = tool(copy, tool_env, "epic-search")
    assert searched.returncode == R.EXIT_OK, searched.stdout + searched.stderr
    # TC-97 to TC-99: the hand-over note names the parity story; Compared is refused without and with a failing parity report
    note = write(copy, "ops/refactor/story-reports/epic-handover.md", HANDOVER)
    assert "Story 16" in note.read_text() and R.read_stage(copy) != "Compared"
    assert "E-NOT-JUSTIFIED" in tool(copy, tool_env, "stage", "Compared").stdout
    write(copy, "ops/refactor/reports/parity.json", json.dumps({"exit_code": R.EXIT_FAIL}))
    assert "E-NOT-JUSTIFIED" in tool(copy, tool_env, "stage", "Compared").stdout and R.read_stage(copy) == "Reimplemented"
    # TC-28 and TC-100: the gate passes and nothing was sent
    gate = tool(world.work, tool_env, "epic-worktree", "can-push", "--path", str(copy))
    assert gate.returncode == R.EXIT_OK, gate.stdout + gate.stderr
    assert not world.pushed()


def test_tc101_w2_planted_failures_each_block_their_own_step_and_clear_when_fixed(mini_deps, tool_env, tmp_path):
    world, copy = epic_world(tmp_path, mini_deps)
    create_copy(world, copy, tool_env, mini_deps)
    stub_all(copy)
    # TC-36: a function left with its real body blocks the check, and clears when it is a stand-in again
    stubs = (copy / "py/minipy/core.py").read_text()
    (copy / "py/minipy/core.py").write_text(stubs.replace('raise NotImplementedError("deleted")', 'return 1', 1))
    assert tool(copy, tool_env, "check-stubs").returncode == R.EXIT_FAIL
    (copy / "py/minipy/core.py").write_text(stubs)
    assert tool(copy, tool_env, "stage", "Deleted").returncode == R.EXIT_OK
    # TC-40: a protecting test that passes against the stand-ins blocks (E-ASSIGNED-PASSED) and sends the stage back to Proved
    test_file = copy / "py/test_core.py"
    original = test_file.read_text()
    test_file.write_text(original.replace("assert record([\"a\", \"b\", \"c\"], 2) == [\"a\", \"b\"]", "assert True"))
    assert tool(copy, tool_env, "run-suites").returncode == R.EXIT_OK
    blocked = tool(copy, tool_env, "report-deletion")
    assert blocked.returncode == R.EXIT_FAIL and "E-ASSIGNED-PASSED" in blocked.stdout and R.read_stage(copy) == "Proved"
    # TC-44: rewritten, the step repeated, all six fail
    test_file.write_text(original)
    assert tool(copy, tool_env, "stage", "Deleted").returncode == R.EXIT_OK
    # TC-41: a test outside the list that fails blocks (E-OUTSIDE-FAILED)
    write(copy, "tests/three-test.sh", "#!/usr/bin/env bash\nexit 1\n")
    assert tool(copy, tool_env, "run-suites").returncode == R.EXIT_OK
    outside = tool(copy, tool_env, "report-deletion")
    assert outside.returncode == R.EXIT_FAIL and "E-OUTSIDE-FAILED" in outside.stdout
    (copy / "tests/three-test.sh").unlink()
    assert tool(copy, tool_env, "run-suites").returncode == R.EXIT_OK
    assert tool(copy, tool_env, "report-deletion").returncode == R.EXIT_OK
    # TC-46: a new contract test that already passes blocks the move to RedContracts; TC-48: an old test without a fate does too
    contracts = copy / "ops/refactor/new_contracts.toml"
    contracts_text = contracts.read_text()
    contracts.write_text(contracts_text + '\n[[contract]]\narea = "keeping"\ntest = "shell:tests/one-test.sh"\n')       # passes against the stand-ins
    assert "E-CONTRACT-NOT-RED" in tool(copy, tool_env, "fates").stdout
    contracts.write_text(contracts_text)
    fates = copy / "ops/refactor/fates.toml"
    fates_text = fates.read_text()
    fates.write_text(re.sub(r"\[\[fate\]\].*?(?=\[\[fate\]\])", "", fates_text, count=1, flags=re.S))                   # the first fate removed
    assert "E-NO-FATE" in tool(copy, tool_env, "fates").stdout
    fates.write_text(fates_text)
    assert tool(copy, tool_env, "stage", "RedContracts").returncode == R.EXIT_OK
    # all groups connected, then a leftover git read of a run's tree blocks the final search (TC-82) and clears when removed
    unstub(copy, "py/minipy/core.py", "rs/mini/src/lib.rs", "ts/src/core.ts")
    for name in ("python", "rust", "typescript"):
        assert tool(copy, tool_env, "epic-groups", "connect", name).returncode == R.EXIT_OK
    write_release_check(copy)
    assert tool(copy, tool_env, "epic-finish").returncode == R.EXIT_OK
    audit = copy / "ops/refactor/audit"
    audit.mkdir(parents=True, exist_ok=True)
    shutil.copy(AUDIT_FIXTURES / "queries.toml", audit / "queries.toml")
    shutil.copy(AUDIT_FIXTURES / "exclusions.toml", audit / "exclusions.toml")
    leak = write(copy, "rs/mini/src/leak.rs", 'fn leak() { run("ls-tree"); }\n')
    git(copy, "add", "rs/mini/src/leak.rs")
    leftover = tool(copy, tool_env, "epic-search")
    assert leftover.returncode == R.EXIT_FAIL and "E-HIT" in leftover.stdout
    git(copy, "rm", "-q", "-f", "rs/mini/src/leak.rs")
    assert tool(copy, tool_env, "epic-search").returncode == R.EXIT_OK


def test_tc102_w3_main_moves_during_the_work_the_first_commit_rebases_and_the_overlap_aborts(mini_deps, tool_env, tmp_path):
    world, copy = epic_world(tmp_path, mini_deps)
    create_copy(world, copy, tool_env, mini_deps)
    stub_all(copy)
    git(copy, "commit", "-q", "-am", "the stand-ins")
    own = git(copy, "rev-parse", "HEAD").stdout.strip()
    landed = world.land({"runs/vidi/m1/run-2/metrics.json": "{}"})
    synced = tool(world.work, tool_env, "epic-worktree", "sync", "--path", str(copy))
    assert synced.returncode == R.EXIT_OK, synced.stdout + synced.stderr
    assert git(copy, "rev-parse", "HEAD~1").stdout.strip() == landed and git(copy, "rev-parse", "HEAD").stdout.strip() != own
    head = git(copy, "rev-parse", "HEAD").stdout.strip()
    text = (copy / "ts/src/core.ts").read_text()
    world.land({"ts/src/core.ts": 'export function titleOf(run: { title?: string }): string {\n  return run.title ?? "main"\n}\n'})
    conflict = tool(world.work, tool_env, "epic-worktree", "sync", "--path", str(copy))
    assert conflict.returncode == R.EXIT_FAIL and "E-WT-REBASE-CONFLICT  ts/src/core.ts" in conflict.stdout
    assert git(copy, "rev-parse", "HEAD").stdout.strip() == head and (copy / "ts/src/core.ts").read_text() == text
    assert git(copy, "status", "--porcelain", "--untracked-files=no").stdout == ""


# ---- cut entries: a site with cuts is a stand-in while any of its cut stand-ins is left in the function --------------------------

CUT_SITE = ('[[entry]]\nlanguage = "python"\nfile = "py/a.py"\nfunction = "record"\nclasses = ["C"]\n'
            '[[entry.cut]]\nanchor = "x = git()"\nwhy = "runs git"\n[[entry.cut]]\nanchor = "y = git2()"\nwhy = "runs git too"\n')
CUT_ID = "refactor-cut:py/a.py::record"


def cut_site_root(tmp_path: Path, body: str, entry: str = CUT_SITE, language: str = "python", file: str = "py/a.py") -> Path:
    root = tmp_path / "site"
    write(root, "ops/refactor/touched_set.toml", entry)
    write(root, file, body)
    return root


def site(entry: str, root: Path) -> dict:
    return tomllib.loads((root / "ops/refactor/touched_set.toml").read_text())["entry"][0]


@pytest.mark.parametrize("body,still", [
    (f'def record(items):\n    raise NotImplementedError("{CUT_ID}#1")\n    return items\n', True),
    (f'def record(items):\n    x = 1\n    raise NotImplementedError("{CUT_ID}#2")\n', True),
    ('def record(items):\n    x = new_way()\n    return items\n', False),                          # rebuilt
    ('def record(items):\n    raise NotImplementedError("deleted")\n', False),                       # a whole-function stub is not a cut stand-in
    ('def other(items):\n    raise NotImplementedError("%s#1")\n\ndef record(items):\n    return items\n' % CUT_ID, False),     # in another function
])
def test_cut_site_is_a_stand_in_while_one_of_its_cuts_stand_ins_is_in_the_function(tmp_path, body, still):
    root = cut_site_root(tmp_path, body)
    assert E.site_still_stub(root, site(CUT_SITE, root)) is still


def test_cut_site_with_a_gone_file_or_function_is_not_a_stand_in(tmp_path):
    root = cut_site_root(tmp_path, "def other():\n    return 1\n")
    assert E.site_still_stub(root, site(CUT_SITE, root)) is False
    (root / "py/a.py").unlink()
    assert E.site_still_stub(root, site(CUT_SITE, root)) is False


def test_cut_site_in_a_file_that_does_not_parse_is_not_a_stand_in(tmp_path):
    root = cut_site_root(tmp_path, "def record(:\n")
    assert E.site_still_stub(root, site(CUT_SITE, root)) is False


SHELL_SITE = ('[[entry]]\nlanguage = "shell"\nfile = "s/x.sh"\nfunction = "sync"\nclasses = ["C"]\n'
              '[[entry.cut]]\nanchor = "git push"\nwhy = "pushes"\n')


def test_cut_site_in_shell_is_a_stand_in_while_a_return_99_is_in_the_function(tmp_path):
    left = cut_site_root(tmp_path / "a", "sync() {\n  return 99\n  echo done\n}\n", SHELL_SITE, file="s/x.sh")
    assert E.site_still_stub(left, site(SHELL_SITE, left)) is True
    rebuilt = cut_site_root(tmp_path / "b", "sync() {\n  upload\n  echo done\n}\n\nother() {\n  return 99\n}\n", SHELL_SITE, file="s/x.sh")
    assert E.site_still_stub(rebuilt, site(SHELL_SITE, rebuilt)) is False                           # the 99 belongs to another function


def test_cut_site_with_nothing_to_cut_is_never_a_stand_in(tmp_path):
    entry = CUT_SITE.split("[[entry.cut]]")[0] + "cut = []\n"
    root = cut_site_root(tmp_path, f'def record(items):\n    raise NotImplementedError("{CUT_ID}#1")\n', entry)
    assert E.site_still_stub(root, site(entry, root)) is False


def test_cut_site_can_push_names_a_site_that_still_has_a_cut_stand_in(tmp_path):
    copy = tmp_path / "copy"
    files = tiny_files("Reimplemented", f'    raise NotImplementedError("{CUT_ID}#1")')
    files["ops/refactor/touched_set.toml"] = CUT_SITE
    for rel, text in files.items():
        write(copy, rel, text)
    write_green(copy, GREEN_JUNIT)
    result = E.epic_worktree(tmp_path, "can-push", copy, E.DEFAULT_BASE, git=FakeGit())
    assert [(p.code, p.subject) for p in result.problems if p.code == "E-STUB-REMAINS"] == [("E-STUB-REMAINS", "py/a.py::record")]
    write(copy, "py/a.py", "def record(items):\n    return list(items)\n")
    assert [p.code for p in E.epic_worktree(tmp_path, "can-push", copy, E.DEFAULT_BASE, git=FakeGit()).problems if p.code == "E-STUB-REMAINS"] == []


def test_cut_site_group_state_counts_a_cut_stand_in_as_a_site_still_to_connect(tmp_path):
    root = cut_site_root(tmp_path, f'def record(items):\n    raise NotImplementedError("{CUT_ID}#1")\n')
    assert E.site_is_stub(root, site(CUT_SITE, root)) is True
