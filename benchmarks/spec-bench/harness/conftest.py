"""Every test runs with the private repo pointed at a directory that doesn't exist, so nothing a test records
(drive.record_story copies held-out detail to the private repo) can reach the real private checkout beside this
repo. A test that needs a private repo makes one in tmp_path and passes it, or sets heldout.PRIVATE_ENV itself.

Likewise the owner's machine names (machine_names.py): no test reads the real dbench node list or depends on the
real hostname. Both are set here, at import, so module-scoped fixtures get them too; a test that needs names
makes its own node list (machine_names.NODES_ENV) or patches machine_names.this_hostname.

A test that runs a command in the real sandbox is marked `needs_sandbox`. Where the platform's sandbox tool
(SANDBOX_TOOL) is missing it is skipped with NO_SANDBOX_REASON, the same way in every test file; with
$SPEC_BENCH_REQUIRE_SANDBOX set (CI sets it) it fails instead, so the sandbox can't go unproven there unnoticed."""
import os
import shutil
import uuid
from pathlib import Path

import pytest

import heldout
import hostenv
import machine_names

TEST_HOSTNAME = "made-up-bench-box.local"
os.environ[machine_names.NODES_ENV] = "/nonexistent/dbench/nodes.toml"
machine_names.this_hostname = lambda: TEST_HOSTNAME


SANDBOX_TOOL = "sandbox-exec" if hostenv.IS_MAC else "bwrap"
SANDBOX_MARK = "needs_sandbox"
NO_SANDBOX_REASON = "no sandbox tool on this machine"
REQUIRE_SANDBOX_ENV = "SPEC_BENCH_REQUIRE_SANDBOX"
OUTSIDE_TEMP_PREFIX = ".spec-bench-sandbox-test-"
OUTSIDE_TEMP_TAG_CHARS = 8


def sandbox_available() -> bool:
    return shutil.which(SANDBOX_TOOL) is not None


def sandbox_required() -> bool:
    return bool(os.environ.get(REQUIRE_SANDBOX_ENV))


def pytest_configure(config):
    config.addinivalue_line(
        "markers", f"{SANDBOX_MARK}: runs a command in the real sandbox (sandbox-exec on macOS, bwrap on Linux)")


def pytest_collection_modifyitems(config, items):
    if sandbox_available() or sandbox_required():
        return
    for item in items:
        if item.get_closest_marker(SANDBOX_MARK):
            item.add_marker(pytest.mark.skip(reason=NO_SANDBOX_REASON))


def pytest_runtest_setup(item):
    if sandbox_required() and item.get_closest_marker(SANDBOX_MARK) and not sandbox_available():
        pytest.fail(f"{NO_SANDBOX_REASON} ({SANDBOX_TOOL}), and ${REQUIRE_SANDBOX_ENV} says this machine must have it",
                    pytrace=False)


@pytest.fixture(autouse=True)
def no_real_private_repo(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(tmp_path / "no-private-checkout"))


@pytest.fixture
def outside_shared_temp():
    """A directory of the test's own that is not under a shared temp dir (drive.SHARED_TMP). On Linux tmp_path
    is under /tmp, which the sandbox replaces with the run's own temp dir: anything a test puts in tmp_path
    and expects to see from inside the sandbox (other than the run's own dir) is not there."""
    d = Path.home() / f"{OUTSIDE_TEMP_PREFIX}{uuid.uuid4().hex[:OUTSIDE_TEMP_TAG_CHARS]}"
    d.mkdir()
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)
