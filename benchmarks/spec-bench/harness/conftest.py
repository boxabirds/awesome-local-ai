"""Every test runs with the private repo pointed at a directory that doesn't exist, so nothing a test records
(drive.record_story copies held-out detail to the private repo) can reach the real private checkout beside this
repo. A test that needs a private repo makes one in tmp_path and passes it, or sets heldout.PRIVATE_ENV itself."""
import pytest

import heldout


@pytest.fixture(autouse=True)
def no_real_private_repo(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(tmp_path / "no-private-checkout"))
