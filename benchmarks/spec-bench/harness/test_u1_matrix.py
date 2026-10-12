"""U1, "the harness records a story": the test matrix of ops/refactor/matrices/U1.toml, one test per row.

The eight dimensions (run_kind, story_outcome, private_files, credential, heldout_title, size, results_root,
run_position) make 1,024 combinations; 22 rows cover them, a row using "*" for a dimension the code ignores in that
row. A row's test then runs EVERY value of each "*" dimension (one at a time, from a plain base), and asserts the same
outcome each time:

- run_kind (combination path vs benchmarks/reference path) and story_outcome change nothing inside record_story; the
  outcome only changes the commit message: done and partial are the string drive.main builds, stopped and failed are
  built by record_event.record (which also writes run-status.json before it records).
- a refusal (drive.record_refusal) returns exactly {committed, pushed: False, error: "not recorded: <why>"}, prints
  the reason on stderr, writes nothing into the run (not even .gitignore), moves neither HEAD nor the remote, and
  makes no private commit. The checks run in this order: off-limits checkout, run outside the root, root not the top
  of a checkout.

The repositories are real ones in tmp_path with bare remotes; the private repo is test_publish_gate.private_suite.
Rows 1-6: R1..R6 below; rows 7-22: test_u1_records_in_a_valid_root, one id per (private, credential, title, size).
Run: uv run --with pytest pytest test_u1_matrix.py
"""
from __future__ import annotations

import itertools
import json
import os
import subprocess
from pathlib import Path
from typing import NamedTuple

import pytest

import drive
import heldout
import hostenv
import publicise as pub
import record_event
import roots
import test_publish_gate as pg

G = pg.G
PACK = "vidi"                                  # record_event's default pack name
RUN_ID = "r1"
KINDS = ("combination", "reference")
OUTCOMES = ("done", "partial", "stopped", "failed")
STORY_ID = 3
PARTIAL_TEXT = "partial (ended by operator)"   # the string drive.main builds for a PARTIAL story
EVENT_REASON = "the operator asked for it"
IDENTITY = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
KIND_PATHS = {"combination": Path("combinations/some/stack/benchmarks") / PACK / RUN_ID,
              "reference": Path("benchmarks/reference") / PACK / "stack" / RUN_ID}
PRIVATE_FILE = "stories/01/accept.json"        # a private file of the run (publicise.is_private)
TITLE_FILE = "report-notes.md"                 # a public file of the run that carries a held-out title
CREDENTIAL_FILE = "interventions.md"           # a public file of the run that carries a credential
BIG_FILE = "big-notes.md"
SECRET = "sk-a1b2c3d4e5f6a7b8c9d0e1f2"
CREDENTIAL_NAME = "sk- key"
SUB = "sub"                                    # a folder inside the checkout that is not its top
OUTSIDE = "outside"
ROOT_MODES = ("set and valid", "unset", "a git checkout", "inside one")
NOT_INSIDE = "the run's directory is not inside the results root"
NOT_TOP = "the results root is not the top of a git checkout"
OFF_LIMITS = f"records may not be committed in this checkout in this process (${roots.NO_RECORD_ENV})"


class Flags(NamedTuple):
    kind: str = "combination"
    outcome: str = "done"
    private: bool = False
    credential: bool = False
    title: bool = False
    big: bool = False


BASE = Flags()


def vary_kind_and_outcome(flags: Flags) -> list[Flags]:
    """flags with each run_kind, then each story_outcome, one at a time (the base's own value counted once)."""
    return [flags, flags._replace(kind="reference"), *(flags._replace(outcome=o) for o in OUTCOMES[1:])]


def vary_everything(flags: Flags = BASE) -> list[Flags]:
    """For a refusal: it ignores every dimension, so each value of each one is run, one at a time."""
    return [*vary_kind_and_outcome(flags), flags._replace(private=True), flags._replace(credential=True),
            flags._replace(title=True), flags._replace(big=True)]


def ident(flags: Flags) -> str:
    return "-".join(f"{k}={v}" for k, v in flags._asdict().items())


@pytest.fixture(autouse=True)
def recording_environment(monkeypatch):
    for k, v in IDENTITY.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("SPEC_BENCH_PACK_NAME", raising=False)
    monkeypatch.setattr(hostenv, "host_desc", lambda: "")


class Scenario(NamedTuple):
    flags: Flags
    repo: Path
    remote: Path
    private: Path
    private_remote: Path
    run: Path


def build_run(parent: Path, flags: Flags) -> Path:
    run = parent / KIND_PATHS[flags.kind]
    pg.write(run / "run.json", {"combination": "some/stack"})
    drive.save_metrics(run, {"stories": {"1": {"title": "Story 1", "status": "DONE"}}})
    if flags.private:
        pg.write(run / PRIVATE_FILE, {"passed": 1, "total": 2, "tests": [{"title": pg.TITLE, "status": "failed"}]})
    if flags.credential:
        pg.write(run / CREDENTIAL_FILE, f"- the agent printed the key {SECRET} in its shell\n")
    if flags.title:
        pg.write(run / TITLE_FILE, f"the story's test: {pg.TITLE}\n")
    if flags.big:
        pg.write(run / BIG_FILE, "x" * (pub.size_limit(BIG_FILE) + 1))
    return run


def scenario(tmp_path: Path, n: int, flags: Flags, run_parent: str = "repo") -> Scenario:
    """A public checkout with a bare origin, the private repo, and the run: under the checkout's top ("repo"), under
    a folder inside it ("sub"), or outside it ("outside")."""
    base = tmp_path.resolve() / f"s{n}"
    base.mkdir()
    repo, remote = pg.cloned(base, "public")
    private = pg.private_suite(base)
    (repo / SUB).mkdir()
    parent = {"repo": repo, "sub": repo / SUB, "outside": base / OUTSIDE}[run_parent]
    return Scenario(flags, repo, remote, private, base / "private.git", build_run(parent, flags))


def point_roots(monkeypatch, mode: str, scn: Scenario) -> Path:
    """The results root the harness would use, as roots.results_root() says it, for each value of the dimension."""
    if mode == "unset":
        monkeypatch.delenv(roots.ENV, raising=False)
        monkeypatch.setattr(roots, "CODE_ROOT", scn.repo)    # in a checkout with no variable, the root is the checkout
        expected = scn.repo
    else:
        expected = scn.repo / SUB if mode == "inside one" else scn.repo
        monkeypatch.setenv(roots.ENV, str(expected))
    if mode == "a git checkout":
        monkeypatch.setenv(roots.NO_RECORD_ENV, os.pathsep.join([os.environ[roots.NO_RECORD_ENV], str(scn.repo)]))
    root = roots.results_root()
    assert root == expected.resolve()
    monkeypatch.setattr(drive, "REPO_ROOT", root)
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(scn.private))
    return root


def act(root: Path, scn: Scenario) -> tuple[dict, str]:
    """Record the scenario's run as its outcome says, the way the harness does; returns the result and the message."""
    run, outcome = scn.run, scn.flags.outcome
    label = drive.combination_label(run)
    if outcome in ("done", "partial"):
        message = f"{PACK} {label} {run.name}: story {STORY_ID} {'done' if outcome == 'done' else PARTIAL_TEXT}"
        return drive.record_story(root, run, message), message
    message = f"{PACK} {label} {run.name}: run {outcome}: {EVENT_REASON}"
    return record_event.record(root, run, outcome, EVENT_REASON), message


def head(repo: Path) -> str:
    return pg.git(repo, "rev-parse", "HEAD").strip()


def remote_head(remote: Path) -> str:
    return subprocess.run(["git", "--git-dir", str(remote), "rev-parse", "main"], capture_output=True, text=True).stdout.strip()


def remote_tree(remote: Path) -> list[str]:
    return subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "main"],
                          capture_output=True, text=True, check=True).stdout.split()


def remote_subject(remote: Path) -> str:
    return subprocess.run(["git", "--git-dir", str(remote), "log", "-1", "--format=%s", "main"],
                          capture_output=True, text=True, check=True).stdout.strip()


def remote_blob(remote: Path, rel: str) -> str:
    return subprocess.run(["git", "--git-dir", str(remote), "show", f"main:{rel}"], capture_output=True,
                          text=True, check=True).stdout


def run_files(run: Path) -> dict[str, bytes]:
    return {p.relative_to(run).as_posix(): p.read_bytes() for p in sorted(run.rglob("*")) if p.is_file()}


def state(scn: Scenario) -> dict:
    return {"head": head(scn.repo), "remote": remote_head(scn.remote), "status": pg.git(scn.repo, "status", "--porcelain"),
            "private_head": head(scn.private), "private_remote": remote_head(scn.private_remote),
            "files": run_files(scn.run)}


# ======================= the refusals =======================

def assert_refused(root: Path, scn: Scenario, why: str, capsys) -> None:
    """record_refusal's outcome, whatever the run holds and however its story ended."""
    before = state(scn)
    capsys.readouterr()
    res, _ = act(root, scn)
    assert res == {"committed": False, "pushed": False, "error": f"not recorded: {why}"}, ident(scn.flags)
    assert capsys.readouterr().err == f"record: NOT RECORDED, {why}: run {scn.run.resolve()}, results root {root.resolve()}\n"
    after = state(scn)
    # record_event writes run-status.json before it records; record_story itself writes nothing, not even .gitignore.
    expected_files = dict(before["files"])
    if scn.flags.outcome in ("stopped", "failed"):
        assert after["files"].pop("run-status.json")
    assert after["files"] == expected_files
    assert not (scn.run / ".gitignore").exists() and not (scn.run / pub.PUBLISH_REFUSED).exists()
    assert {k: v for k, v in after.items() if k != "files"} == {k: v for k, v in before.items() if k != "files"}
    assert not (scn.private / heldout.PRIVATE_RUNS).exists()                          # no private copy, so no private commit
    if scn.flags.credential:
        assert SECRET in (scn.run / CREDENTIAL_FILE).read_text()                      # nothing was redacted: nothing was read


def refused_everywhere(tmp_path, monkeypatch, capsys, mode: str, why: str, run_parent: str):
    for n, flags in enumerate(vary_everything()):
        scn = scenario(tmp_path, n, flags, run_parent)
        root = point_roots(monkeypatch, mode, scn)
        assert_refused(root, scn, why, capsys)


def test_u1_a_checkout_the_process_may_not_record_in_is_refused(tmp_path, monkeypatch, capsys):
    # R1: whatever the run holds, and wherever the run is: the off-limits check comes first, so a run outside the root
    # is refused for the checkout, not for being outside.
    n = 0
    for run_parent in ("repo", "outside"):
        for flags in vary_everything():
            scn = scenario(tmp_path, n, flags, run_parent)
            n += 1
            assert_refused(point_roots(monkeypatch, "a git checkout", scn), scn, OFF_LIMITS, capsys)
    # A root inside the named checkout (not its top) is off limits too, and is refused for that before the top check.
    for flags in (BASE, BASE._replace(outcome="failed")):
        scn = scenario(tmp_path, n, flags, "sub")
        n += 1
        monkeypatch.setenv(roots.NO_RECORD_ENV, os.pathsep.join([os.environ[roots.NO_RECORD_ENV], str(scn.repo)]))
        monkeypatch.setenv(roots.ENV, str(scn.repo / SUB))
        root = roots.results_root()
        monkeypatch.setattr(drive, "REPO_ROOT", root)
        monkeypatch.setenv(heldout.PRIVATE_ENV, str(scn.private))
        assert_refused(root, scn, OFF_LIMITS, capsys)


def test_u1_a_run_outside_a_valid_root_is_refused(tmp_path, monkeypatch, capsys):
    # R2: the root is the top of a checkout with a bare origin; the run is not inside it.
    refused_everywhere(tmp_path, monkeypatch, capsys, "set and valid", NOT_INSIDE, "outside")


def test_u1_a_run_outside_the_default_root_is_refused(tmp_path, monkeypatch, capsys):
    # R3: with $SPEC_BENCH_RESULTS_ROOT unset the root is the code's checkout; a run outside it is refused.
    refused_everywhere(tmp_path, monkeypatch, capsys, "unset", NOT_INSIDE, "outside")


def test_u1_a_run_outside_a_root_inside_a_checkout_is_refused_for_being_outside(tmp_path, monkeypatch, capsys):
    # R4: the root is a folder inside a checkout, so it is not a top either; the run being outside is said first.
    refused_everywhere(tmp_path, monkeypatch, capsys, "inside one", NOT_INSIDE, "outside")


def test_u1_a_root_that_is_not_the_top_of_a_checkout_is_refused(tmp_path, monkeypatch, capsys):
    # R5: the run is inside the root, and the root is a folder inside a checkout: git would commit into the one above.
    refused_everywhere(tmp_path, monkeypatch, capsys, "inside one", NOT_TOP, "sub")


# ======================= the records =======================

def assert_recorded(root: Path, scn: Scenario, message: str, res: dict, before: tuple[str, str]) -> None:
    """A record in a valid root: committed and pushed exactly as the run's contents say."""
    flags, run = scn.flags, scn.run
    rel = run.resolve().relative_to(root.resolve())
    before_head, before_remote = before
    private_tree = remote_tree(scn.private_remote)
    # ---- the private copy: made iff the run has private files (and a private checkout is given, always here)
    private_copy = scn.private / heldout.PRIVATE_RUNS / rel / PRIVATE_FILE
    if flags.private:
        assert res["private"]["copied"] == 1 and res["private"]["pushed"] is True, res["private"]
        assert private_copy.read_text() == (run / PRIVATE_FILE).read_text()
        assert f"{heldout.PRIVATE_RUNS}/{rel.as_posix()}/{PRIVATE_FILE}" in private_tree
    else:
        assert res["private"] == {"copied": 0, "committed": False, "pushed": False}, res["private"]
        assert not private_copy.exists() and not any(p.startswith(heldout.PRIVATE_RUNS) for p in private_tree)
    # ---- a credential: redacted in place and counted, whether or not the commit then happens
    if flags.credential:
        assert res["credentials_redacted"] == {"count": 1, "names": [CREDENTIAL_NAME]}, res
        assert SECRET not in (run / CREDENTIAL_FILE).read_text() and SECRET not in json.dumps(res)
    else:
        assert "credentials_redacted" not in res
    # ---- the size: listed iff over the limit, and it never blocks the commit
    assert res["over_size_limit"] == ([str(run / BIG_FILE)] if flags.big else [])
    # ---- the held-out title: nothing is committed, the reason is kept in the run
    if flags.title:
        assert res["committed"] is False and res["pushed"] is False and "commit" not in res
        assert res["error"].startswith("not committed: 1 staged file(s) must not be public: ") and pub.PUBLISH_REFUSED in res["error"]
        assert pg.TITLE not in json.dumps(res)
        refused = json.loads((run / pub.PUBLISH_REFUSED).read_text())["problems"]
        assert [(p["file"], p["why"], p["fingerprint"]) for p in refused] == \
            [(f"{rel.as_posix()}/{TITLE_FILE}", heldout.HELD_OUT, pg.TITLE)]
        assert head(scn.repo) == before_head == remote_head(scn.remote) == before_remote
        assert not any(p.startswith(rel.as_posix()) for p in remote_tree(scn.remote))
        return
    assert not (run / pub.PUBLISH_REFUSED).exists()
    assert res["committed"] is True and res["pushed"] is True and "error" not in res and "unpushed" not in res, res
    # ---- what was pushed: the commit, with the message as its subject, and nothing private in it
    assert head(scn.repo) == remote_head(scn.remote) != before_head
    assert remote_subject(scn.remote) == message
    assert pg.git(scn.repo, "rev-parse", "--short", "HEAD").strip() == res["commit"]
    tree = remote_tree(scn.remote)
    assert not [p for p in tree if pub.is_private(p)], tree
    assert f"{rel.as_posix()}/run.json" in tree and f"{rel.as_posix()}/.gitignore" in tree
    assert (f"{rel.as_posix()}/{BIG_FILE}" in tree) is flags.big
    if flags.credential:
        published = remote_blob(scn.remote, f"{rel.as_posix()}/{CREDENTIAL_FILE}")
        assert SECRET not in published and f"[redacted {CREDENTIAL_NAME}: {len(SECRET)} characters]" in published
    if flags.private:
        assert pg.TITLE not in "".join(remote_blob(scn.remote, p) for p in tree if p.startswith(rel.as_posix()))
        assert f"{rel.as_posix()}/stories/01/accept-summary.json" in tree     # the public summary stands beside it


@pytest.mark.parametrize("private,credential,title,size", [
    pytest.param(p, c, t, s, id=f"{p}-{c}-{t}-{s}")
    for p, c, t, s in itertools.product(("present", "absent"), ("present", "absent"), ("present", "absent"), ("under", "over"))])
def test_u1_records_in_a_valid_root(tmp_path, monkeypatch, private, credential, title, size):
    # R7..R22: the root is the top of a checkout with a bare origin and the run is inside it. Each run_kind and each
    # story_outcome in turn (one at a time): the same result, and the pushed commit's subject is the message.
    base = Flags(private=private == "present", credential=credential == "present", title=title == "present",
                 big=size == "over")
    for n, flags in enumerate(vary_kind_and_outcome(base)):
        scn = scenario(tmp_path, n, flags)
        root = point_roots(monkeypatch, "set and valid", scn)
        before = (head(scn.repo), remote_head(scn.remote))
        res, message = act(root, scn)
        assert_recorded(root, scn, message, res, before)


def test_u1_with_the_root_unset_the_default_root_records_like_a_valid_one(tmp_path, monkeypatch):
    # R6: no $SPEC_BENCH_RESULTS_ROOT: the default root is the code's checkout. A plain run (no private file, no
    # credential, no title, under the limit) is committed and pushed in it, for each kind and each outcome.
    for n, flags in enumerate(vary_kind_and_outcome(BASE)):
        scn = scenario(tmp_path, n, flags)
        root = point_roots(monkeypatch, "unset", scn)
        assert os.environ.get(roots.ENV) is None and root == scn.repo
        before = (head(scn.repo), remote_head(scn.remote))
        res, message = act(root, scn)
        assert_recorded(root, scn, message, res, before)
