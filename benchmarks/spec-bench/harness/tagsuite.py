"""tagsuite.py — the held-out suite exactly as the pack's tag has it, whatever the private checkout is at.

A pack names the tag of its private suite (bench.json "pack_ref"). The score of record must come from that suite
and no other, so a re-score takes it from the private repo's git objects (`git archive <tag>`), never from the
working tree: the checkout can be on a branch, past the tag, detached or dirty, and the suite is the same. It is
kept, with its node_modules and its browser, in the scoring home (scoring_tools.home(): under the bench home,
hidden from agents), one directory per pack, tag and commit, built once and reused:

    <scoring home>/suites/<pack>/<tag>-<commit>/acceptance/      its files read-only
    <scoring home>/suites/<pack>/<tag>-<commit>/.suite-ready.json

It is built in a directory of its own and moved into place whole, so a build that was killed is never used. The
checkout is only read; `git fetch --tags` runs once, and only when the tag isn't there.

What can go wrong says whether a person is needed (SuiteError.needs_person): a tag that exists nowhere, a tag
without the suite, a suite that isn't in a git checkout will not change by trying again; a remote that can't be
reached, an install that failed, a missing npm may.

A pack with no pack_ref (its suite is public, in this repo) is scored from its working tree under what
pack-version.sh says that is, as before.

Why: on 1 Oct 2026 a finished run got no score of record because the private checkout had been left on its main
branch, 11 commits past the pack's tag, though the held-out tests were the tag's byte for byte.
Tests: test_tagsuite.py; test_pipeline.py scores a run with the checkout's tests changed after the tag.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import scoring_tools

HARNESS = Path(__file__).resolve().parent
SUITES = "suites"
SUITE_DIR = "acceptance"
READY = ".suite-ready.json"
BUILDING = ".building-"
COMMIT_CHARS = 12
GIT_TIMEOUT_S = 120
INSTALL_TIMEOUT_S = 900
ERROR_TAIL_CHARS = 200
WRITE_BITS = stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH
NPM_CI = ["npm", "ci", "--no-audit", "--no-fund"]
NPM_INSTALL = ["npm", "install", "--no-audit", "--no-fund"]
BROWSER_INSTALL = ["npx", "playwright", "install", "chromium"]

# SuiteError.kind: why there is no suite to score with.
TAG_MISSING = "suite_tag_missing"
NO_SUITE_AT_TAG = "suite_not_in_tag"
NOT_A_CHECKOUT = "suite_not_in_git"
FETCH_FAILED = "suite_fetch_failed"
ARCHIVE_FAILED = "suite_unavailable"
INSTALL_FAILED = "suite_install_failed"
TOOL_MISSING = "tool_missing"


class SuiteError(Exception):
    def __init__(self, kind: str, reason: str, needs_person: bool):
        super().__init__(reason)
        self.kind, self.needs_person = kind, needs_person


@dataclass(frozen=True)
class Suite:
    acceptance: Path | None      # the suite to run; None for a pack without one
    version: str                 # what a score from it is recorded under
    commit: str | None           # the tag's commit, for a pinned suite
    pinned: bool                 # taken from the pack's tag, not from a working tree


def _git(cwd: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=GIT_TIMEOUT_S, env=env)


def _tail(text: str) -> str:
    """The end of a tool's output, for a reason that is published: one line, with no path of this machine's home."""
    return " ".join(text.replace(str(Path.home()), "~").split())[-ERROR_TAIL_CHARS:]


def checkout_of(acceptance: Path, env: dict | None = None) -> tuple[Path, str]:
    """The git checkout the suite's directory is in, and the directory's path inside it."""
    top = _git(acceptance, "rev-parse", "--show-toplevel", env=env) if acceptance.is_dir() else None
    if top is None or top.returncode != 0:
        raise SuiteError(NOT_A_CHECKOUT, "the held-out suite is not in a git checkout, so the pack's tag can't be "
                                         "read from it", needs_person=True)
    prefix = _git(acceptance, "rev-parse", "--show-prefix", env=env).stdout.strip().rstrip("/")
    return Path(top.stdout.strip()), prefix


def tag_commit(repo: Path, tag: str, env: dict | None = None) -> str:
    """The commit the tag names. A tag the checkout doesn't have is fetched, once."""
    def find() -> str | None:
        r = _git(repo, "rev-parse", "-q", "--verify", f"refs/tags/{tag}^{{commit}}", env=env)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
    if found := find():
        return found
    if _git(repo, "remote", env=env).stdout.strip():
        fetched = _git(repo, "fetch", "-q", "--tags", env=env)
        if fetched.returncode != 0:
            raise SuiteError(FETCH_FAILED, f"the suite's tag {tag} is not in the private checkout and fetching tags "
                                           f"failed (git exit {fetched.returncode})", needs_person=False)
        if found := find():
            return found
    raise SuiteError(TAG_MISSING, f"the pack's suite tag {tag} does not exist in the private repo", needs_person=True)


def install_deps(suite: Path, env: dict) -> None:
    """The suite's own dependencies, from its lockfile, and the browser its Playwright launches (nothing to do
    when it is already on the machine)."""
    if not (suite / "package.json").is_file():
        return
    steps = [NPM_CI if (suite / "package-lock.json").is_file() else NPM_INSTALL]
    for i, cmd in enumerate(steps):
        try:
            r = subprocess.run(cmd, cwd=suite, capture_output=True, text=True, timeout=INSTALL_TIMEOUT_S, env=env)
        except FileNotFoundError:
            raise SuiteError(TOOL_MISSING, f"{cmd[0]} is not on PATH", needs_person=False) from None
        except subprocess.TimeoutExpired:
            raise SuiteError(INSTALL_FAILED, f"`{' '.join(cmd)}` for the suite timed out after {INSTALL_TIMEOUT_S}s",
                             needs_person=False) from None
        if r.returncode != 0:
            raise SuiteError(INSTALL_FAILED, f"`{' '.join(cmd)}` for the suite failed (exit {r.returncode}): "
                                             f"{_tail((r.stdout or '') + (r.stderr or ''))}", needs_person=False)
        if i == 0 and (suite / "node_modules" / ".bin" / "playwright").exists():
            steps.append(BROWSER_INSTALL)


def _extract(repo: Path, commit: str, rel: str, dest: Path, tag: str, env: dict | None) -> None:
    tree = f"{commit}:{rel}" if rel else commit
    if _git(repo, "cat-file", "-t", tree, env=env).stdout.strip() != "tree":
        raise SuiteError(NO_SUITE_AT_TAG, f"the pack's suite tag {tag} has no {rel or 'suite'}", needs_person=True)
    dest.mkdir(parents=True)
    archive = subprocess.Popen(["git", "archive", "--format=tar", tree], cwd=repo, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=env)
    try:
        untar = subprocess.run(["tar", "-xf", "-", "-C", str(dest)], stdin=archive.stdout, capture_output=True,
                               timeout=GIT_TIMEOUT_S)
        archive.stdout.close()
        err = archive.stderr.read().decode(errors="replace")
        code = archive.wait(timeout=GIT_TIMEOUT_S)
    finally:
        if archive.poll() is None:
            archive.kill()
    if code != 0 or untar.returncode != 0:
        raise SuiteError(ARCHIVE_FAILED, f"the suite at {tag} could not be read from the private repo: "
                                         f"{_tail(err + untar.stderr.decode(errors='replace'))}", needs_person=False)
    for f in dest.rglob("*"):
        if f.is_file() and not f.is_symlink():
            f.chmod(f.stat().st_mode & ~WRITE_BITS)


def materialise(acceptance: Path, tag: str, pack_name: str, cache: Path | None = None, env: dict | None = None,
                install=install_deps) -> Suite:
    """The suite at the tag, from the cache or built into it. `acceptance` only says which repository and which
    directory in it: nothing is read from the working tree."""
    repo, rel = checkout_of(acceptance, env)
    commit = tag_commit(repo, tag, env)
    short = commit[:COMMIT_CHARS]
    home = (cache if cache is not None else scoring_tools.home() / SUITES) / pack_name
    final = home / f"{tag}-{short}"
    suite = Suite(final / SUITE_DIR, tag, short, True)
    if (final / READY).is_file():
        return suite
    building = home / f"{BUILDING}{uuid.uuid4().hex}"
    try:
        _extract(repo, commit, rel, building / SUITE_DIR, tag, env)
        install(building / SUITE_DIR, dict(os.environ if env is None else env))
        (building / READY).write_text(json.dumps(
            {"tag": tag, "commit": commit, "pack": pack_name,
             "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, indent=2) + "\n")
        if final.exists():                       # a build that was never finished, or one that lost its marker
            shutil.rmtree(final)
        try:
            building.rename(final)
        except OSError:
            if not (final / READY).is_file():    # not another process finishing the same build first
                raise
    finally:
        shutil.rmtree(building, ignore_errors=True)
    return suite


def working_tree_version(pk) -> str:
    return subprocess.run([str(HARNESS / "pack-version.sh"), str(pk.dir), pk.name], capture_output=True,
                          text=True).stdout.strip()


def pinned(pk) -> bool:
    return bool(pk.pack_ref) and pk.acceptance is not None


def version_for(pk) -> str:
    """What a score of this pack is recorded under: its tag when its suite is pinned to one, else what the
    working tree is (pack-version.sh)."""
    return pk.pack_ref if pinned(pk) else working_tree_version(pk)


def for_pack(pk, cache: Path | None = None, env: dict | None = None, install=install_deps) -> Suite:
    """The suite a re-score of this pack runs, and the version it records."""
    if not pinned(pk):
        return Suite(pk.acceptance, working_tree_version(pk), None, False)
    return materialise(pk.acceptance, pk.pack_ref, pk.name, cache, env, install)
