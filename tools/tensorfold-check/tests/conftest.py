import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))   # tfcheck
sys.path.insert(0, str(HERE))          # fake_server, pibodies

import pytest  # noqa: E402

import fake_server  # noqa: E402


@pytest.fixture
def fake():
    """fake(**State options) -> (state, base_url); every server started is shut down after the test."""
    started = []

    def start(**kw):
        srv, st, url = fake_server.serve(**kw)
        started.append(srv)
        return st, url

    yield start
    for srv in started:
        srv.shutdown()
        srv.server_close()
