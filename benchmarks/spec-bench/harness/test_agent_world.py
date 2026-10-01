"""The agent's world, seen from inside it: the real sandbox (Seatbelt on macOS, bubblewrap on Linux), started the way a
story starts the agent (drive.run_agent), with a probe in place of the agent (prove_sandbox.py: the same checks the owner
runs on a bench machine with prove-sandbox.sh).

Each group is one property the owner required of the agent's world, and every one failed on the permissive sandbox that
ran until 1 Oct 2026 (the whole machine visible, the owner's whole environment, an open network): the cwd named the run
and the word "bench", `env` printed the owner's keys, `pkill -f wrangler` reached the machine, any host could be
fetched from. Around the probe sit canaries that a leak would show, each first read from outside (prove_sandbox.observe)."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

import prove_sandbox as ps

pytestmark = pytest.mark.needs_sandbox


@pytest.fixture(scope="module")
def results():
    scratch = Path.home() / f"{ps.TEMP_PREFIX}{uuid.uuid4().hex[:ps.TEMP_TAG_CHARS]}"
    scratch.mkdir()
    observed = None
    try:
        observed = ps.observe(scratch)
        yield ps.checks(observed)
    finally:
        if observed is not None:
            ps.cleanup(observed)
        shutil.rmtree(scratch, ignore_errors=True)


def failed(results, group: str) -> list[str]:
    return [f"{c.name}: {c.detail.strip()[:300]}" for c in results if c.group == group and not c.ok and not c.skipped]


@pytest.mark.parametrize("group", ps.GROUPS)
def test_the_agents_world_holds(results, group):
    in_group = [c for c in results if c.group == group]
    assert in_group, f"no check ran for {group}"
    assert not failed(results, group), "\n".join(failed(results, group))


def test_the_checks_are_the_ones_the_owner_asked_for(results):
    names = " | ".join(c.name for c in results)
    for phrase in ("names no run", "cannot read the repository", "cannot read another run's directory", "cannot read a file share",
                   "real home directory", "cannot change spec/", "allow-list", "canary key", "model server",
                   "raw address is refused", "not listed is refused", "survives the agent's pkill", "`ps` shows nothing",
                   "its own port", "no sudo"):
        assert phrase in names, phrase
