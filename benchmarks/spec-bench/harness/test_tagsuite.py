"""tagsuite.py: a re-score runs the held-out suite exactly as the pack's tag has it, taken from the private
repo's git objects, so where that checkout happens to be cannot change (or prevent) a score.

Why: on 1 Oct 2026 a finished run got no score of record because the private checkout had been left on its main
branch, 11 commits past the pack's tag, though the held-out tests were the tag's byte for byte.

Each case below is a state the checkout can be in; the suite that comes back is always the tag's."""
import os
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import tagsuite

PACK = "kat"
TAG = "kat-v1"
AT_TAG = "check == tag\n"
CHANGED = "check == changed after the tag\n"
G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
HARNESS = Path(__file__).resolve().parent


def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*G, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def private_repo(root: Path, tag: str | None = TAG) -> Path:
    """A private repo with pack kat's suite, tagged; returns the suite's directory in the checkout."""
    acc = root / "packs" / PACK / "acceptance"
    (acc / "tests").mkdir(parents=True)
    (acc / "tests" / "story-01.spec.ts").write_text(AT_TAG)
    (acc / "playwright.config.ts").write_text("// config\n")
    (acc / ".gitignore").write_text("node_modules/\n")
    (root / "packs" / PACK / "bench.json").write_text('{"name": "kat"}')
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "kat pack")
    if tag:
        git(root, "tag", tag)
    return acc


def commit_change(acc: Path, text: str = CHANGED, name: str = "story-01.spec.ts") -> None:
    (acc / "tests" / name).write_text(text)
    git(acc, "add", "-A")
    git(acc, "commit", "-qm", "after the tag")


def no_install(suite: Path, env: dict) -> None:
    pass


def suite_of(acc: Path, cache: Path, **kw) -> tagsuite.Suite:
    return tagsuite.materialise(acc, TAG, PACK, cache=cache, install=kw.pop("install", no_install), **kw)


def story_one(suite: tagsuite.Suite) -> str:
    return (suite.acceptance / "tests" / "story-01.spec.ts").read_text()


@pytest.fixture
def acc(tmp_path):
    return private_repo(tmp_path / "private")


@pytest.fixture
def cache(tmp_path):
    return tmp_path / "cache"


# ---------- wherever the checkout is, the suite is the tag's ----------

def test_a_checkout_at_the_tag_gives_the_tags_suite(acc, cache):
    s = suite_of(acc, cache)
    assert story_one(s) == AT_TAG and s.version == TAG and s.pinned
    assert s.commit == git(acc, "rev-parse", f"{TAG}^{{commit}}")[:tagsuite.COMMIT_CHARS]
    assert cache in s.acceptance.parents and acc.parents[2] not in s.acceptance.parents   # not the working tree


def test_a_checkout_past_the_tag_with_the_same_tests_is_scored_under_the_tag(acc, cache):
    """The 1 Oct 2026 case: commits after the tag that leave the held-out tests as they were."""
    (acc.parent / "bench.json").write_text('{"name": "kat", "note": "edited after the tag"}')
    git(acc, "add", "-A")
    git(acc, "commit", "-qm", "pack metadata")
    described = subprocess.run([str(HARNESS / "pack-version.sh"), str(acc.parent), PACK], capture_output=True,
                               text=True).stdout.strip()
    assert described.startswith(TAG + "+")              # what stopped the re-score before
    s = suite_of(acc, cache)
    assert story_one(s) == AT_TAG and s.version == TAG


def test_a_checkout_past_the_tag_with_changed_tests_still_gives_the_tags(acc, cache):
    commit_change(acc)
    commit_change(acc, "new story\n", "story-02.spec.ts")
    s = suite_of(acc, cache)
    assert (acc / "tests/story-01.spec.ts").read_text() == CHANGED
    assert story_one(s) == AT_TAG and s.version == TAG
    assert not (s.acceptance / "tests/story-02.spec.ts").exists()          # a test added after the tag is not run


def test_a_detached_checkout_gives_the_tags(acc, cache):
    commit_change(acc)
    git(acc, "checkout", "-q", "--detach", "HEAD")
    assert story_one(suite_of(acc, cache)) == AT_TAG


def test_a_checkout_the_tag_is_not_an_ancestor_of_gives_the_tags(tmp_path, cache):
    """Detached at a commit before the pack was tagged: `git describe` there doesn't know the tag at all."""
    acc = private_repo(tmp_path / "private", tag=None)
    first = git(acc, "rev-parse", "HEAD")
    commit_change(acc, AT_TAG.replace("tag", "the tag, later"))
    git(acc, "tag", TAG)
    git(acc, "checkout", "-q", "--detach", first)
    assert story_one(suite_of(acc, cache)) == "check == the tag, later\n"


def test_a_dirty_working_tree_gives_the_tags(acc, cache):
    (acc / "tests/story-01.spec.ts").write_text("edited, not committed\n")
    (acc / "tests/story-09.spec.ts").write_text("untracked\n")
    s = suite_of(acc, cache)
    assert story_one(s) == AT_TAG and not (s.acceptance / "tests/story-09.spec.ts").exists()


def test_the_checkout_itself_is_never_touched(acc, cache):
    commit_change(acc)
    (acc / "tests/story-01.spec.ts").write_text("edited, not committed\n")
    before = (git(acc, "rev-parse", "HEAD"), git(acc, "status", "--porcelain"), git(acc, "branch", "--show-current"))
    suite_of(acc, cache)
    assert (git(acc, "rev-parse", "HEAD"), git(acc, "status", "--porcelain"), git(acc, "branch", "--show-current")) == before
    assert git(acc, "branch", "--list").split() == ["*", "main"]            # and no branch was made


def test_the_suites_files_are_read_only(acc, cache):
    s = suite_of(acc, cache)
    for f in (s.acceptance / "tests/story-01.spec.ts", s.acceptance / "playwright.config.ts"):
        assert not f.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)


# ---------- the tag ----------

def test_a_tag_that_does_not_exist_needs_a_person(acc, cache):
    with pytest.raises(tagsuite.SuiteError) as e:
        tagsuite.materialise(acc, "kat-v9", PACK, cache=cache, install=no_install)
    assert e.value.needs_person and e.value.kind == tagsuite.TAG_MISSING and "kat-v9" in str(e.value)
    assert not cache.exists() or not any(cache.rglob("tests"))


def with_remote(tmp_path: Path, acc: Path) -> Path:
    """The private checkout as a clone of a remote that has a newer tag the clone has not fetched."""
    origin = acc.parents[2]
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(origin), str(clone)], check=True, capture_output=True)
    commit_change(acc, "check == v2\n")
    git(acc, "tag", "kat-v2")
    return clone / "packs" / PACK / "acceptance"


def test_a_tag_only_the_remote_has_is_fetched_once(tmp_path, acc, cache):
    cloned = with_remote(tmp_path, acc)
    assert "kat-v2" not in git(cloned, "tag", "-l").split()
    s = tagsuite.materialise(cloned, "kat-v2", PACK, cache=cache, install=no_install)
    assert story_one(s) == "check == v2\n" and s.version == "kat-v2"
    assert git(cloned, "rev-parse", "--abbrev-ref", "HEAD") == "main"       # fetched tags only: the checkout stays put
    assert (cloned / "tests/story-01.spec.ts").read_text() == AT_TAG


def test_a_tag_the_remote_does_not_have_either_needs_a_person(tmp_path, acc, cache):
    cloned = with_remote(tmp_path, acc)
    with pytest.raises(tagsuite.SuiteError) as e:
        tagsuite.materialise(cloned, "kat-v3", PACK, cache=cache, install=no_install)
    assert e.value.needs_person and e.value.kind == tagsuite.TAG_MISSING


def test_a_remote_that_cannot_be_reached_is_tried_again_later(tmp_path, acc, cache):
    cloned = with_remote(tmp_path, acc)
    git(cloned, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    with pytest.raises(tagsuite.SuiteError) as e:
        tagsuite.materialise(cloned, "kat-v2", PACK, cache=cache, install=no_install)
    assert not e.value.needs_person and e.value.kind == tagsuite.FETCH_FAILED
    assert str(tmp_path) not in str(e.value)                    # the reason is published: no path of this machine


def test_a_tag_without_the_suite_needs_a_person(tmp_path, cache):
    acc = private_repo(tmp_path / "private", tag=None)
    top = acc.parents[2]
    with_suite = git(top, "rev-parse", "HEAD")
    git(top, "rm", "-rq", "packs/kat/acceptance")
    git(top, "commit", "-qm", "no suite")
    git(top, "tag", TAG)
    git(top, "checkout", "-q", "--detach", with_suite)          # the working tree has the suite; the tag doesn't
    with pytest.raises(tagsuite.SuiteError) as e:
        suite_of(acc, cache)
    assert e.value.needs_person and e.value.kind == tagsuite.NO_SUITE_AT_TAG


def test_a_suite_outside_git_cannot_be_pinned(tmp_path, cache):
    acc = tmp_path / "packs" / PACK / "acceptance"
    (acc / "tests").mkdir(parents=True)
    with pytest.raises(tagsuite.SuiteError) as e:
        suite_of(acc, cache)
    assert e.value.needs_person and e.value.kind == tagsuite.NOT_A_CHECKOUT


# ---------- the cache ----------

def counting():
    calls = []

    def install(suite: Path, env: dict) -> None:
        calls.append(suite)
        (suite / "node_modules").mkdir()
    return calls, install


def test_the_suite_is_built_once_per_tag_and_reused(acc, cache):
    calls, install = counting()
    first = suite_of(acc, cache, install=install)
    commit_change(acc)                                           # the checkout moving on changes nothing
    second = suite_of(acc, cache, install=install)
    assert first.acceptance == second.acceptance and len(calls) == 1
    assert (second.acceptance / "node_modules").is_dir() and story_one(second) == AT_TAG


def test_a_cache_that_is_gone_is_rebuilt(acc, cache):
    calls, install = counting()
    first = suite_of(acc, cache, install=install)
    import shutil
    shutil.rmtree(cache)
    again = suite_of(acc, cache, install=install)
    assert len(calls) == 2 and again.acceptance == first.acceptance and story_one(again) == AT_TAG


def test_a_half_built_cache_is_not_used(acc, cache):
    """A build killed part-way leaves no suite where a finished one goes: it is built in a directory of its own
    and moved into place whole."""
    def killed(suite: Path, env: dict) -> None:
        raise KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        suite_of(acc, cache, install=killed)
    calls, install = counting()
    s = suite_of(acc, cache, install=install)
    assert len(calls) == 1 and (s.acceptance.parent / tagsuite.READY).is_file()
    assert [p.name for p in s.acceptance.parent.parent.iterdir()] == [s.acceptance.parent.name]   # nothing left over


def test_a_tag_moved_to_another_commit_is_not_served_from_the_old_cache(acc, cache):
    old = suite_of(acc, cache)
    commit_change(acc)
    git(acc, "tag", "-f", TAG)
    new = suite_of(acc, cache)
    assert story_one(new) == CHANGED and new.acceptance != old.acceptance and new.commit != old.commit


def test_an_install_that_fails_is_tried_again_later_and_leaves_no_suite(acc, cache):
    def refuses(suite: Path, env: dict) -> None:
        raise tagsuite.SuiteError(tagsuite.INSTALL_FAILED, "the suite's dependencies didn't install", needs_person=False)
    with pytest.raises(tagsuite.SuiteError) as e:
        suite_of(acc, cache, install=refuses)
    assert not e.value.needs_person
    calls, install = counting()
    suite_of(acc, cache, install=install)
    assert len(calls) == 1


def fake_npm(d: Path, script: str) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    for name in ("npm", "npx"):
        (d / name).write_text(f"#!/bin/sh\n{script}\n")
        (d / name).chmod(0o755)
    return {**os.environ, "PATH": f"{d}:/usr/bin:/bin"}


def test_the_suites_dependencies_are_installed_from_its_lockfile(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "package.json").write_text("{}")
    (suite / "package-lock.json").write_text("{}")
    env = fake_npm(tmp_path / "bin", 'echo "$0 $*" >> calls.txt; mkdir -p node_modules/.bin; touch node_modules/.bin/playwright')
    tagsuite.install_deps(suite, env)
    calls = [" ".join(l.split()[1:]) for l in (suite / "calls.txt").read_text().splitlines()]
    assert calls == ["ci --no-audit --no-fund", "playwright install chromium"]


def test_a_suite_without_dependencies_installs_nothing(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    tagsuite.install_deps(suite, fake_npm(tmp_path / "bin", "exit 1"))      # npm is never run


def test_npm_refusing_is_retryable_and_npm_missing_names_the_tool(tmp_path):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "package.json").write_text("{}")
    with pytest.raises(tagsuite.SuiteError) as e:
        tagsuite.install_deps(suite, fake_npm(tmp_path / "bin", "echo ENETDOWN >&2; exit 1"))
    assert e.value.kind == tagsuite.INSTALL_FAILED and not e.value.needs_person and "ENETDOWN" in str(e.value)
    with pytest.raises(tagsuite.SuiteError) as e:
        tagsuite.install_deps(suite, {"PATH": str(tmp_path / "nothing-here")})
    assert e.value.kind == tagsuite.TOOL_MISSING and not e.value.needs_person and "npm" in str(e.value)


# ---------- a pack ----------

def pack(acc: Path | None, ref: str | None):
    return SimpleNamespace(acceptance=acc, pack_ref=ref, name=PACK, dir=acc.parent if acc else Path("/nonexistent"))


def test_a_pinned_pack_is_scored_under_its_tag_whatever_the_checkout_says(acc, cache):
    commit_change(acc)
    s = tagsuite.for_pack(pack(acc, TAG), cache=cache, install=no_install)
    assert s.version == TAG and story_one(s) == AT_TAG
    assert tagsuite.version_for(pack(acc, TAG)) == TAG


def test_a_pack_without_a_pin_is_scored_from_its_working_tree_under_what_that_is(acc, cache):
    commit_change(acc)
    s = tagsuite.for_pack(pack(acc, None), cache=cache, install=no_install)
    assert s.acceptance == acc and not s.pinned and s.commit is None
    assert s.version.startswith(TAG + "+") and tagsuite.version_for(pack(acc, None)) == s.version
    assert not cache.exists()


def test_a_pack_without_a_suite_has_none(cache):
    s = tagsuite.for_pack(pack(None, TAG), cache=cache, install=no_install)
    assert s.acceptance is None and not s.pinned


def test_the_cache_is_in_the_scoring_home_which_agents_cannot_read(acc, tmp_path, monkeypatch):
    import scoring_tools
    monkeypatch.setenv(scoring_tools.HOME_ENV, str(tmp_path / "home"))
    s = tagsuite.materialise(acc, TAG, PACK, install=no_install)
    assert s.acceptance == tmp_path / "home" / tagsuite.SUITES / PACK / f"{TAG}-{s.commit}" / tagsuite.SUITE_DIR
