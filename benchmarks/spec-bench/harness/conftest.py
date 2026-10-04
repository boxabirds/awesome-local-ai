"""Every test runs with the private repo pointed at a directory that doesn't exist, so nothing a test records
(drive.record_story copies held-out detail to the private repo) can reach the real private checkout beside this
repo. A test that needs a private repo makes one in tmp_path and passes it, or sets heldout.PRIVATE_ENV itself.

Likewise the owner's machine names (machine_names.py): no test reads the real dbench node list or depends on the
real hostname. Both are set here, at import, so module-scoped fixtures get them too; a test that needs names
makes its own node list (machine_names.NODES_ENV) or patches machine_names.this_hostname.

And the public repo itself: on 1 Oct 2026 a test whose results root fell back to this checkout committed made-up
records on its main and pushed them. roots.NO_RECORD_ENV names this checkout as off limits for records, for
every test and every process a test starts.

And the scoring home (scoring_tools.home(): the suites kept at their tags, the remembered tool paths): every test
gets a temporary one, set at import and removed when the tests end, so no test reads or writes the machine's own
under the bench home. A test of the cache itself passes a directory in tmp_path.

The agent-sandbox binary the tests run in is built once from tools/agent-sandbox into a cache the tests share
(sandbox.CACHE_ENV, keyed by the source's hash), never into the machine's own under the bench home.

A test that runs a command in the real sandbox is marked `needs_sandbox`. Where the platform's sandbox tool
(SANDBOX_TOOL) is missing it is skipped with NO_SANDBOX_REASON, the same way in every test file; with
$SPEC_BENCH_REQUIRE_SANDBOX set (CI sets it) it fails instead, so the sandbox can't go unproven there unnoticed."""
import atexit
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import pytest

import heldout
import hostenv
import machine_names
import roots
import sandbox
import scoring_tools

# No test, and no process a test starts, records in the roots the tests run with (drive.record_refusal): the
# checkout this code is in, and, in a release's self-test on a node, the node's results checkout. Set in the
# environment at import, so it is inherited; a process a test starts keeps what it inherited (its own results
# root is the repository the test made for it to record in). A test that records makes a repository of its own.
os.environ.setdefault(roots.NO_RECORD_ENV,
                      os.pathsep.join(dict.fromkeys([str(roots.CODE_ROOT), str(roots.RESULTS_ROOT)])))

os.environ[scoring_tools.HOME_ENV] = tempfile.mkdtemp(prefix="spec-bench-test-scoring-home-")
atexit.register(shutil.rmtree, os.environ[scoring_tools.HOME_ENV], ignore_errors=True)

os.environ.setdefault(sandbox.CACHE_ENV, str(Path(tempfile.gettempdir()) / "spec-bench-test-agent-sandbox"))

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
    """A directory of the test's own that is not under /tmp. On Linux tmp_path is under /tmp, which the
    sandbox replaces with the run's own temp dir: anything a test puts in tmp_path and expects to see from inside
    the sandbox (other than the run's own dir) is not there."""
    d = Path.home() / f"{OUTSIDE_TEMP_PREFIX}{uuid.uuid4().hex[:OUTSIDE_TEMP_TAG_CHARS]}"
    d.mkdir()
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


# Records archived on 4 October 2026 (plans/20261003-archive-superseded-records.md) left the working tree. A test built
# on a real incident in one of them reads it from the last commit that still held it.
RECORDS_BEFORE_ARCHIVE = "3ff97db22d29ea7ff64422a10fb40634b2b07759"


def record_before_archive(rel: str, root: Path) -> Path:
    """The run record at repo-relative `rel` as it was committed before it was archived, extracted under `root`.
    `root` is marked as a checkout, so the record's repo-relative path, and with it its private copy
    (heldout.private_copy), is what it was. Skips the test where this clone lacks that commit."""
    repo = Path(__file__).resolve().parents[3]
    tar = subprocess.run(["git", "-C", str(repo), "archive", RECORDS_BEFORE_ARCHIVE, rel], capture_output=True)
    if tar.returncode != 0:
        pytest.skip(f"this clone has no {RECORDS_BEFORE_ARCHIVE[:9]}, the last commit with {rel}")
    (root / ".git").mkdir(parents=True, exist_ok=True)
    subprocess.run(["tar", "-x", "-C", str(root)], input=tar.stdout, check=True)
    return root / rel
