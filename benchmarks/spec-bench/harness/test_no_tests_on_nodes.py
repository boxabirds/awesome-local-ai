"""Tests run at build, never on a node: a node checks only its own machine, and once per release.

The owner, 7 Nov 2026: "It's built. You deploy. You don't run all your dev tests in production." Until then run.sh ran
the harness self-test (pytest test_pipeline.py, the whole story loop) and the full sandbox preflight before every job,
on every node, although the same code had passed the release's checks (`dbench harness-release`) before any node
could take it. Now run.sh runs no test suite, and the preflight (what is about this machine: can the sandbox run node,
npm, a build, wrangler and Chromium here) runs once per release and client on each node, at the first job after the
node takes that release, and is not repeated while it stays passed. A checkout (a developer's, no release) has no
release to remember a pass against: it runs the preflight every time, as before."""
import re
from pathlib import Path

import pytest

import preflight
import roots

RUN_SH = Path(__file__).with_name("run.sh").read_text()
TAG = "harness-v2026.11.07.1"


def test_run_sh_runs_no_test_suite():
    assert not re.search(r"\bpytest\b", RUN_SH)
    assert "test_pipeline" not in RUN_SH
    assert "SKIP_SELF_TEST" not in RUN_SH


def test_run_sh_asks_for_the_preflight_once_per_release():
    line = next(l for l in RUN_SH.splitlines() if "preflight.py" in l and not l.lstrip().startswith("#"))
    assert "--once" in line and '--client "$CLIENT_NAME"' in line
    assert "exit 1" in line                                  # a failed check still refuses the job


@pytest.fixture
def node(tmp_path, monkeypatch):
    """A node running release TAG, its passes kept under tmp_path; `checks` counts the machine checks made."""
    checks = []
    monkeypatch.setattr(preflight, "PASSED_DIR", tmp_path / "preflight-passed")
    monkeypatch.setattr(roots, "release_tag", lambda *a: TAG)
    monkeypatch.setattr(preflight, "check", lambda client: checks.append(client))
    return checks


def run(monkeypatch, *args):
    monkeypatch.setattr("sys.argv", ["preflight.py", *args])
    preflight.main()


def test_the_first_job_on_a_release_checks_the_machine_and_remembers_the_pass(node, monkeypatch, capsys):
    run(monkeypatch, "--client", "pi", "--once")
    assert node == ["pi"]
    assert (preflight.PASSED_DIR / f"{TAG}-pi").is_file()
    assert "preflight passed" in capsys.readouterr().out


def test_later_jobs_on_the_same_release_and_client_do_not_check_again(node, monkeypatch, capsys):
    run(monkeypatch, "--client", "pi", "--once")
    run(monkeypatch, "--client", "pi", "--once")
    run(monkeypatch, "--client", "pi", "--once")
    assert node == ["pi"]
    assert f"already passed on this machine for {TAG} (pi)" in capsys.readouterr().out


def test_another_client_is_checked_on_its_own(node, monkeypatch):
    # A Claude stack's preflight also proves Claude Code authenticates in the sandbox: a pi pass says nothing of it.
    run(monkeypatch, "--client", "pi", "--once")
    run(monkeypatch, "--client", "claude", "--once")
    assert node == ["pi", "claude"]


def test_a_new_release_is_checked_again(node, monkeypatch):
    run(monkeypatch, "--client", "pi", "--once")
    monkeypatch.setattr(roots, "release_tag", lambda *a: "harness-v2026.11.08.1")
    run(monkeypatch, "--client", "pi", "--once")
    assert node == ["pi", "pi"]


def test_a_failed_check_is_not_remembered(tmp_path, monkeypatch):
    monkeypatch.setattr(preflight, "PASSED_DIR", tmp_path / "preflight-passed")
    monkeypatch.setattr(roots, "release_tag", lambda *a: TAG)

    def fails(client):
        raise SystemExit("PREFLIGHT FAILED at vite build")
    monkeypatch.setattr(preflight, "check", fails)
    with pytest.raises(SystemExit):
        run(monkeypatch, "--client", "pi", "--once")
    assert not (tmp_path / "preflight-passed" / f"{TAG}-pi").exists()


def test_a_checkout_with_no_release_checks_every_time(node, monkeypatch):
    monkeypatch.setattr(roots, "release_tag", lambda *a: None)
    run(monkeypatch, "--client", "pi", "--once")
    run(monkeypatch, "--client", "pi", "--once")
    assert node == ["pi", "pi"]
    assert not preflight.PASSED_DIR.exists()


def test_without_once_it_always_checks(node, monkeypatch):
    # setup-node.sh: a machine being set up is checked whatever it passed before.
    run(monkeypatch, "--client", "pi")
    run(monkeypatch, "--client", "pi")
    assert node == ["pi", "pi"]
