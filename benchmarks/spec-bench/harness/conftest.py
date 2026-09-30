"""Every test runs with the private repo pointed at a directory that doesn't exist, so nothing a test records
(drive.record_story copies held-out detail to the private repo) can reach the real private checkout beside this
repo. A test that needs a private repo makes one in tmp_path and passes it, or sets heldout.PRIVATE_ENV itself.

Likewise the owner's machine names (machine_names.py): no test reads the real dbench node list or depends on the
real hostname. Both are set here, at import, so module-scoped fixtures get them too; a test that needs names
makes its own node list (machine_names.NODES_ENV) or patches machine_names.this_hostname."""
import os

import pytest

import heldout
import machine_names

TEST_HOSTNAME = "made-up-bench-box.local"
os.environ[machine_names.NODES_ENV] = "/nonexistent/dbench/nodes.toml"
machine_names.this_hostname = lambda: TEST_HOSTNAME


@pytest.fixture(autouse=True)
def no_real_private_repo(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(tmp_path / "no-private-checkout"))
