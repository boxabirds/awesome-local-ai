"""roots.py: the harness's code and the results it writes can live in different directories.

A benchmark node runs the harness of the latest release (dbench materialises the tag as a read-only directory with
no .git) while results are still written, committed and pushed in the node's checkout of main. $SPEC_BENCH_RESULTS_ROOT
names that checkout; without it the checkout the harness is in is both, as it always was.

Module-level paths are set at import, so the two-root cases run in a process of their own (probe), with the
variable set, and print what the modules hold.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

import provenance
import roots
from test_record_event import IDENTITY, fake_pack, last_pushed, repo_with_remote

HARNESS = Path(__file__).resolve().parent
TAG = "harness-v2026.10.01.2"
COMMIT = "0123456789abcdef0123456789abcdef01234567"
COMMIT_SHORT = "01234567"
READ_ONLY = stat.S_IRUSR | stat.S_IXUSR | stat.S_IRGRP | stat.S_IXGRP
OWNER_ALL = stat.S_IRWXU


def probe(code: str, results: Path | None, tmp_path: Path, *args: str, harness: Path = HARNESS,
          env: dict | None = None):
    """Run `code` in a fresh interpreter in the harness directory, with the results root set (or not)."""
    e = {**os.environ, "VIDI_PACK_DIR": str(fake_pack_once(tmp_path)), **(env or {})}
    e.pop(roots.ENV, None)
    if results is not None:
        e[roots.ENV] = str(results)
    return subprocess.run([sys.executable, "-c", code, *args], cwd=harness, env=e, capture_output=True, text=True)


def fake_pack_once(tmp_path: Path) -> Path:
    return tmp_path / "pack" if (tmp_path / "pack").exists() else fake_pack(tmp_path)


def release_manifest(tag: str = TAG) -> str:
    return json.dumps({"tag": tag, "commit": COMMIT, "commit_short": COMMIT_SHORT})


def make_release(tmp_path: Path, read_only: bool = False) -> Path:
    """A harness release as dbench materialises one: the harness's files, a manifest, and no .git."""
    release = tmp_path / "releases" / TAG
    shutil.copytree(HARNESS, release / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    (release / roots.RELEASE_FILE).write_text(release_manifest())
    if read_only:
        for p in [release, *release.rglob("*")]:
            p.chmod(p.stat().st_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    return release


@pytest.fixture
def writable_again(tmp_path):
    """pytest can't remove a read-only tree; give the owner write access back when the test ends."""
    yield
    for p in [tmp_path, *tmp_path.rglob("*")]:
        if not p.is_symlink():
            p.chmod(p.stat().st_mode | OWNER_ALL if p.is_dir() else p.stat().st_mode | stat.S_IWUSR)


# ---------- one checkout (no variable): as it always was ----------

def test_without_the_variable_the_checkout_the_harness_is_in_is_both_roots():
    assert roots.CODE_ROOT == HARNESS.parents[2]
    assert roots.results_root({}) == roots.CODE_ROOT
    assert roots.results_root({roots.ENV: ""}) == roots.CODE_ROOT


def test_without_the_variable_every_module_points_at_the_one_checkout(tmp_path):
    r = probe("import drive, packdir, logscan, json\n"
              "print(json.dumps({'results': str(drive.REPO_ROOT), 'code': str(drive.CODE_ROOT),\n"
              "  'packdir': str(packdir.REPO_ROOT), 'logscan': str(logscan.REPO_ROOT),\n"
              "  'deny': [str(p) for p in drive.SANDBOX_DENY]}))", None, tmp_path)
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout)
    here = str(HARNESS.parents[2])
    assert got["results"] == got["code"] == got["packdir"] == got["logscan"] == here
    assert got["deny"].count(here) == 1          # listed once, as before


def test_in_a_checkout_the_harness_commit_is_head_and_there_is_no_release(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    for args in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "x"]):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=repo, check=True)
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
    assert roots.release(repo) is None and roots.release_tag(repo) is None
    assert roots.harness_commit(repo) == head


# ---------- two roots ----------

def test_the_variable_moves_results_and_leaves_code_where_it_is(tmp_path):
    results = tmp_path / "checkout"
    run = results / "combinations" / "a" / "b" / "benchmarks" / "kat" / "r1"
    ref = results / "benchmarks" / "reference" / "kat" / "stack-1" / "run-2"
    for d in (run, ref):
        d.mkdir(parents=True)
    r = probe("import drive, packdir, logscan, pack, history, peek_audit, heldout, json, sys\n"
              "from pathlib import Path\n"
              "run, ref = Path(sys.argv[1]), Path(sys.argv[2])\n"
              "print(json.dumps({'results': str(drive.REPO_ROOT), 'code': str(drive.CODE_ROOT),\n"
              "  'packdir': str(packdir.REPO_ROOT), 'logscan': str(logscan.REPO_ROOT),\n"
              "  'public_pack': str(packdir.public_dir('benchmarks/kat')),\n"
              "  'private': str(packdir.private_checkout()),\n"
              "  'perf': str(drive.BENCHMARKS), 'template': str(pack.GENERIC_TEMPLATE), 'policy': str(history.POLICY),\n"
              "  'deny': [str(p) for p in drive.SANDBOX_DENY], 'sensitive': peek_audit.default_sensitive(),\n"
              "  'label': drive.combination_label(run), 'ref_label': drive.combination_label(ref),\n"
              "  'work': drive.work_dir_for(run).name, 'known': sorted(logscan.known_runs(work_root=run))}))\n"
              , results, tmp_path, str(run), str(ref))
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout)
    code = HARNESS.parents[2]
    # Results, records, other runs' records, packs and the private checkout beside the repo: the results root.
    assert got["results"] == got["packdir"] == got["logscan"] == str(results)
    assert got["public_pack"] == str(results / "benchmarks" / "kat")
    assert got["private"] == str(tmp_path / packdir_private_name())
    assert got["label"] == "a/b" and got["ref_label"] == "reference/stack-1"
    assert got["work"] == "a__b__benchmarks__kat__r1"
    assert "a__b__benchmarks__kat__r1" in got["known"]
    # The harness's own files: where the code is.
    assert got["code"] == str(code)
    assert got["perf"] == str(code / "benchmarks")
    assert got["template"] == str(code / "benchmarks/spec-bench/prompts/story.md.tmpl")
    assert got["policy"] == str(code / "benchmarks/spec-bench/EVALUATION-POLICY.md")
    # The agent may read neither.
    assert str(results) in got["deny"] and str(code) in got["deny"]
    assert str(results) in got["sensitive"] and str(code) in got["sensitive"]


def packdir_private_name() -> str:
    import packdir
    return packdir.PRIVATE_REPO


def test_a_results_root_that_is_not_a_directory_stops_the_harness(tmp_path):
    r = probe("import drive", tmp_path / "nowhere", tmp_path)
    assert r.returncode != 0
    assert roots.ENV in r.stderr and "nowhere" in r.stderr


@pytest.mark.needs_sandbox
def test_the_sandbox_hides_both_roots_from_the_agent(tmp_path, outside_shared_temp):
    results = outside_shared_temp / "checkout"
    (results / "combinations").mkdir(parents=True)
    (results / "combinations" / "other-run.json").write_text("another run's record")
    own = outside_shared_temp / "work" / "run"
    (own / "workspace").mkdir(parents=True)
    (own / "workspace" / "mine.txt").write_text("mine")
    script = ("import drive, subprocess, sys, json\n"
            "from pathlib import Path\n"
            "own = Path(sys.argv[1])\n"
            "out = {}\n"
            "for name, f in (('results', sys.argv[2]), ('code', str(drive.HARNESS / 'drive.py')), ('own', str(own / 'workspace/mine.txt'))):\n"
            "    r = subprocess.run(drive.sandboxed(['cat', f], own_dir=own), capture_output=True, text=True)\n"
            "    out[name] = [r.returncode, r.stdout[:40]]\n"
            "print(json.dumps(out))")
    r = probe(script, results, tmp_path, str(own), str(results / "combinations" / "other-run.json"),
              env={"VIDI_WORK_ROOT": str(outside_shared_temp / "work")})
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout)
    assert got["own"] == [0, "mine"]
    assert got["results"][0] != 0 and "another run" not in got["results"][1]
    assert got["code"][0] != 0 and got["code"][1] == ""


# ---------- a release: code with a manifest and no .git ----------

def test_a_release_names_its_tag_and_commit_without_git(tmp_path):
    release = tmp_path / "rel"
    release.mkdir()
    (release / roots.RELEASE_FILE).write_text(release_manifest())
    assert roots.release(release) == {"tag": TAG, "commit": COMMIT, "commit_short": COMMIT_SHORT}
    assert roots.release_tag(release) == TAG
    assert roots.harness_commit(release) == COMMIT_SHORT
    # Each story's provenance: the release's commit; whether its files were edited isn't checked (null).
    assert provenance.at_start(release) == {"harness_commit": COMMIT_SHORT, "harness_dirty": None}


def test_a_broken_release_manifest_stops_the_harness_instead_of_running_as_unknown(tmp_path):
    release = tmp_path / "rel"
    release.mkdir()
    for text in ("{not json", json.dumps({"tag": TAG}), json.dumps(["x"])):
        (release / roots.RELEASE_FILE).write_text(text)
        with pytest.raises(SystemExit) as e:
            roots.release(release)
        assert roots.RELEASE_FILE in str(e.value)


def test_the_story_provenance_carries_the_release_tag_or_null():
    import drive
    harness = drive.harness_provenance(roots.CODE_ROOT)
    assert set(harness) == {"harness_commit", "harness_dirty", "harness_release"}
    assert harness["harness_release"] == roots.release_tag()
    story = drive.story_provenance({"harness_commit": COMMIT_SHORT, "harness_dirty": None, "harness_release": TAG},
                                   started_under="kat-v1", scored_under="kat-v1")
    assert story["harness_release"] == TAG


def test_the_command_line_answers_run_sh(tmp_path):
    release = make_release(tmp_path)
    harness = release / "benchmarks/spec-bench/harness"
    results = tmp_path / "checkout"
    results.mkdir()

    def ask(what: str, root: Path | None, where: Path = harness):
        env = {k: v for k, v in os.environ.items() if k != roots.ENV}
        if root is not None:
            env[roots.ENV] = str(root)
        return subprocess.run([sys.executable, str(where / "roots.py"), what], capture_output=True, text=True, env=env)

    assert ask("results", results).stdout.strip() == str(results)
    assert ask("code", results).stdout.strip() == str(release)
    assert ask("harness-commit", results).stdout.strip() == COMMIT_SHORT
    assert ask("release-json", results).stdout.strip() == json.dumps(TAG)
    # A release run by hand, with nowhere to put results: refused, and it says what is missing.
    refused = ask("results", None)
    assert refused.returncode != 0 and roots.ENV in refused.stderr and TAG in refused.stderr
    # A checkout: itself, HEAD, and no release.
    here = HARNESS.parents[2]
    assert ask("results", None, HARNESS).stdout.strip() == str(here)
    assert ask("code", None, HARNESS).stdout.strip() == str(here)
    assert ask("release-json", None, HARNESS).stdout.strip() == "null"
    head = subprocess.run(["git", "-C", str(here), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
    assert ask("harness-commit", None, HARNESS).stdout.strip() == head.stdout.strip()
    assert ask("nonsense", None, HARNESS).returncode != 0


def test_the_rescore_record_names_the_releases_commit(tmp_path):
    release = make_release(tmp_path)
    results = tmp_path / "checkout"
    results.mkdir()
    r = probe("import rescore; print(rescore.rescore_record('v', 1, {}, {}, [])['harness_commit'])", results, tmp_path,
              harness=release / "benchmarks/spec-bench/harness")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == COMMIT_SHORT


# ---------- run.sh itself, from a release, with results in a checkout ----------

def run_sh_stubs(tmp_path: Path, drive_exit: int = 0) -> Path:
    """Every tool the run would use succeeds without doing anything (as test_record_event does); python3 only
    answers the thermal wait, and uv really runs record_event.py so the run's events are committed."""
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for tool in ("npm", "npx", "node", "claude"):
        (stubs / tool).write_text("#!/bin/sh\nexit 0\n")
    real_python, real_uv = shutil.which("python3"), shutil.which("uv")
    (stubs / "python3").write_text(f'#!/bin/sh\ncase "$*" in *wait_for_thermal*) echo "  thermal=nominal"; exit 0;; esac\n'
                                   f'exec "{real_python}" "$@"\n')
    (stubs / "uv").write_text(f'#!/bin/sh\ncase "$*" in\n  *drive.py*) exit {drive_exit};;\n'
                              f'  *record_event.py*) exec "{real_uv}" "$@";;\nesac\nexit 0\n')
    for f in stubs.iterdir():
        f.chmod(0o755)
    return stubs


def results_checkout(tmp_path: Path) -> tuple[Path, Path]:
    """The node's checkout of main: a combination's config, and nothing of the harness."""
    repo, remote = repo_with_remote(tmp_path)
    combo = repo / "combinations" / "test" / "combo"
    combo.mkdir(parents=True)
    (combo / "config.sh").write_text('INSTALL_ID="fake-install"\nCONTEXT_LIMIT=4096   # tokens\nOUTPUT_LIMIT=512\n')
    env = {**os.environ, **IDENTITY}
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "init"], check=True, env=env)
    subprocess.run(["git", "-C", str(repo), "push", "-q", "origin", "HEAD:main"], check=True, capture_output=True)
    return repo, remote


def install(tmp_path: Path) -> Path:
    home = tmp_path / "home"
    share = home / ".local/share/fake-install"
    share.mkdir(parents=True)
    (share / "install.env").write_text('COMBINATION="test/combo"\nBACKEND="anthropic"\nMODEL_ID="m"\n')
    return home


def test_run_sh_from_a_release_writes_and_records_in_the_results_checkout(tmp_path, writable_again):
    release = make_release(tmp_path, read_only=True)
    repo, remote = results_checkout(tmp_path)
    home = install(tmp_path)
    pack = fake_pack(tmp_path)
    (pack / "acceptance" / "node_modules").mkdir(parents=True)
    (pack / "acceptance" / "package-lock.json").write_text("{}")
    env = {**os.environ, **IDENTITY, "HOME": str(home), "VIDI_PACK_DIR": str(pack), roots.ENV: str(repo),
           "PATH": f"{run_sh_stubs(tmp_path)}:{os.environ['PATH']}", "SKIP_SELF_TEST": "1",
           "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache/uv"))}
    r = subprocess.run([str(release / "benchmarks/spec-bench/harness/run.sh"), "fake-install", "--run-id", "r1",
                        "--client", "claude", "--record"], env=env, capture_output=True, text=True, cwd=repo)
    assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]
    run = repo / "combinations/test/combo/benchmarks/vidi/r1"
    doc = json.loads((run / "run.json").read_text())
    # The combination's config is read from the checkout (the release has no combinations/ at all).
    assert (doc["context_limit"], doc["output_limit"]) == (4096, 512)
    assert doc["harness_commit"] == COMMIT_SHORT and doc["harness_release"] == TAG
    # The run's events are commits in the checkout, pushed to its remote, labelled by the combination.
    log = subprocess.run(["git", "--git-dir", str(remote), "log", "--format=%s", "main"], capture_output=True,
                         text=True).stdout.splitlines()
    assert log[0] == "vidi test/combo r1: run finished", log
    assert log[1].startswith(f"vidi test/combo r1: run started: harness {COMMIT_SHORT} ({TAG}),"), log
    # Nothing was written into the release.
    assert not (release / "combinations").exists() and not (release / ".git").exists()


def test_run_sh_from_a_release_without_a_results_root_refuses_to_start(tmp_path):
    release = make_release(tmp_path)
    home = install(tmp_path)
    env = {**{k: v for k, v in os.environ.items() if k != roots.ENV}, "HOME": str(home),
           "VIDI_PACK_DIR": str(fake_pack(tmp_path)), "PATH": f"{run_sh_stubs(tmp_path)}:{os.environ['PATH']}"}
    r = subprocess.run([str(release / "benchmarks/spec-bench/harness/run.sh"), "fake-install", "--run-id", "r1",
                        "--client", "claude"], env=env, capture_output=True, text=True)
    assert r.returncode != 0 and roots.ENV in r.stderr
    assert not (release / "combinations").exists()


def test_run_sh_in_a_checkout_records_no_release(tmp_path):
    """As developers run it: one checkout, no variable. run.json says the harness is unreleased."""
    repo, remote = results_checkout(tmp_path)
    shutil.copytree(HARNESS, repo / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    env0 = {**os.environ, **IDENTITY}
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "harness"], check=True, env=env0)
    subprocess.run(["git", "-C", str(repo), "push", "-q", "origin", "HEAD:main"], check=True, capture_output=True)
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    home = install(tmp_path)
    pack = fake_pack(tmp_path)
    (pack / "acceptance" / "node_modules").mkdir(parents=True)
    (pack / "acceptance" / "package-lock.json").write_text("{}")
    env = {**{k: v for k, v in os.environ.items() if k != roots.ENV}, **IDENTITY, "HOME": str(home),
           "VIDI_PACK_DIR": str(pack), "PATH": f"{run_sh_stubs(tmp_path)}:{os.environ['PATH']}", "SKIP_SELF_TEST": "1",
           "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache/uv"))}
    r = subprocess.run([str(repo / "benchmarks/spec-bench/harness/run.sh"), "fake-install", "--run-id", "r1",
                        "--client", "claude", "--record"], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]
    doc = json.loads((repo / "combinations/test/combo/benchmarks/vidi/r1/run.json").read_text())
    assert doc["harness_commit"] == head and doc["harness_release"] is None
    log = subprocess.run(["git", "--git-dir", str(remote), "log", "--format=%s", "main"], capture_output=True,
                         text=True).stdout.splitlines()
    assert log[1].startswith(f"vidi test/combo r1: run started: harness {head}, client"), log   # as it always read


# ---------- records go only where they belong ----------
# On 1 Oct 2026 a test of the two-root story loop ran against a harness that did not read the variable yet. The
# results root fell back, silently, to the checkout the code was in, and four made-up records were committed on
# its main and pushed to the public repository. Three things now stand in the way of that, each tested here.

def commits(repo: Path) -> list[str]:
    return subprocess.run(["git", "-C", str(repo), "log", "--format=%s"], capture_output=True, text=True).stdout.splitlines()


def checkout_with_a_commit(tmp_path: Path, monkeypatch) -> tuple[Path, Path]:
    for k, v in IDENTITY.items():
        monkeypatch.setenv(k, v)
    repo, remote = repo_with_remote(tmp_path)
    (repo / "README.md").write_text("x\n")
    for args in (["add", "-A"], ["commit", "-qm", "init"], ["push", "-q", "origin", "HEAD:main"]):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    return repo, remote


def test_a_run_outside_the_results_root_is_not_recorded(tmp_path, monkeypatch):
    import drive
    repo, remote = checkout_with_a_commit(tmp_path, monkeypatch)
    run = tmp_path / "elsewhere" / "benchmarks" / "kat" / "r1"
    run.mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    res = drive.record_story(repo, run, "kat x r1: story 1 done")
    assert res["committed"] is False and res["pushed"] is False
    assert "not inside the results root" in res["error"]
    assert str(tmp_path) not in res["error"]                  # it goes into metrics.json, which is public
    assert commits(repo) == ["init"] and commits(remote) == ["init"]
    assert sorted(p.name for p in run.iterdir()) == ["metrics.json"]       # and the run was left as it was


def test_a_results_root_that_is_not_the_top_of_a_checkout_is_not_recorded_in(tmp_path, monkeypatch):
    """git looks upwards for a repository: a root that is merely inside one (a release's directory under a home
    that is a checkout, a subdirectory given by mistake) would commit into whatever checkout contains it."""
    import drive
    repo, remote = checkout_with_a_commit(tmp_path, monkeypatch)
    inside = repo / "releases" / "harness-v1"
    run = inside / "combinations" / "x" / "benchmarks" / "kat" / "r1"
    run.mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    res = drive.record_story(inside, run, "kat x r1: story 1 done")
    assert res["committed"] is False and "not the top of a git checkout" in res["error"]
    assert commits(repo) == ["init"] and commits(remote) == ["init"]
    nowhere = tmp_path / "no-such-checkout"
    res = drive.record_story(nowhere, nowhere / "r1", "kat x r1: story 1 done")
    assert res["committed"] is False and "not the top of a git checkout" in res["error"]


def test_a_checkout_named_as_off_limits_is_never_recorded_in(tmp_path, monkeypatch):
    import drive
    repo, remote = checkout_with_a_commit(tmp_path, monkeypatch)
    run = repo / "combinations" / "x" / "benchmarks" / "kat" / "r1"
    run.mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    monkeypatch.setenv(roots.NO_RECORD_ENV, str(repo))
    res = drive.record_story(repo, run, "kat x r1: story 1 done")
    assert res["committed"] is False and roots.NO_RECORD_ENV in res["error"]
    assert commits(repo) == ["init"] and commits(remote) == ["init"]
    monkeypatch.delenv(roots.NO_RECORD_ENV)
    assert drive.record_story(repo, run, "kat x r1: story 1 done")["pushed"] is True
    assert commits(remote)[0] == "kat x r1: story 1 done"


def test_every_test_process_has_the_checkout_it_runs_from_off_limits(tmp_path):
    """conftest.py names the checkout the tests run from as off limits for records, in the environment, so the
    processes a test starts (a probe, run.sh, the two-root story loop) inherit it."""
    here = HARNESS.parents[2]
    assert here in roots.off_limits() and roots.RESULTS_ROOT in roots.off_limits()
    r = probe("import roots; print(*roots.off_limits(), sep='\\n')", None, tmp_path)
    assert str(here) in r.stdout.splitlines(), r.stderr
    # Several may be named: the code's checkout and, in a release's self-test, the node's results checkout.
    both = {roots.NO_RECORD_ENV: os.pathsep.join(["/a/code", "/b/results"])}
    assert roots.off_limits(both) == [Path("/a/code").resolve(), Path("/b/results").resolve()]
    assert roots.off_limits({}) == []


def test_a_release_with_no_results_root_does_not_fall_back_to_itself(tmp_path):
    """In a checkout, no variable means the checkout is the results root. In a release that fallback would be the
    release's own directory, which has no git of its own: the harness stops as it loads instead."""
    release = make_release(tmp_path)
    r = probe("import drive", None, tmp_path, harness=release / "benchmarks/spec-bench/harness")
    assert r.returncode != 0 and roots.ENV in r.stderr and TAG in r.stderr
