"""judge_sandbox.py and egress_proxy.py: a judge reads and writes only its package, and reaches
the internet only through the proxy's allowlist. The sandbox tests run the real sandbox-exec."""
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

import egress_proxy
import judge_sandbox

HERE = Path(__file__).resolve().parent
UNROUTED_IP = "192.0.2.1"  # TEST-NET-1: the sandbox must refuse before any packet is sent
DNS_PORT = 53
mac_only = pytest.mark.skipif(sys.platform != "darwin", reason="sandbox-exec is macOS only")


@pytest.fixture
def box(tmp_path):
    """A fake home with a secret, a package inside it, and a profile that allows only the package."""
    home = tmp_path / "home"
    pkg = home / "state" / "judging" / "x" / "package"
    pkg.mkdir(parents=True)
    (pkg / "inside.txt").write_text("inside")
    (home / "secret.txt").write_text("SECRET")
    (home / "state" / "keys").mkdir()
    (home / "state" / "keys" / "x.json").write_text('{"A": "opus"}')
    (pkg.parent / "sibling.txt").write_text("next to the package")
    prof = tmp_path / "profile.sb"
    prof.write_text(judge_sandbox.profile(home=home, rw=[pkg], ro=[]))
    return home, pkg, prof


def run_in(prof: Path, cwd: Path, *cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(["sandbox-exec", "-f", str(prof), *cmd], cwd=cwd, capture_output=True, text=True)


@mac_only
def test_the_package_is_readable_and_writable(box):
    _, pkg, prof = box
    assert run_in(prof, pkg, "/bin/cat", "inside.txt").stdout == "inside"
    assert run_in(prof, pkg, "/bin/sh", "-c", "echo out > new.txt").returncode == 0
    assert (pkg / "new.txt").read_text() == "out\n"


@mac_only
def test_everything_else_in_home_is_invisible_including_the_key(box):
    home, pkg, prof = box
    for target in (home / "secret.txt", home / "state" / "keys" / "x.json", pkg.parent / "sibling.txt"):
        r = run_in(prof, pkg, "/bin/cat", str(target))
        assert r.returncode != 0 and "not permitted" in r.stderr
    r = run_in(prof, pkg, "/bin/ls", str(home))
    assert r.returncode != 0 and "not permitted" in r.stderr


@mac_only
def test_direct_outbound_connections_are_refused(box):
    _, pkg, prof = box
    code = f"import socket; socket.create_connection(('{UNROUTED_IP}', {DNS_PORT}), timeout=2)"
    r = run_in(prof, pkg, "/usr/bin/python3", "-c", code)
    assert r.returncode != 0 and "Operation not permitted" in r.stderr


def test_proxy_allows_listed_hosts_and_their_subdomains_only():
    allow = ["chatgpt.com", "openai.com"]
    assert egress_proxy.allowed("chatgpt.com", allow) and egress_proxy.allowed("ab.chatgpt.com", allow)
    assert egress_proxy.allowed("API.OpenAI.com.", allow)
    assert not egress_proxy.allowed("github.com", allow)
    assert not egress_proxy.allowed("evilchatgpt.com", allow)
    assert not egress_proxy.allowed("chatgpt.com.evil.net", allow)


def test_proxy_parses_only_https_connects():
    assert egress_proxy.parse_connect(b"CONNECT chatgpt.com:443 HTTP/1.1\r\n\r\n") == ("chatgpt.com", 443)
    assert egress_proxy.parse_connect(b"CONNECT chatgpt.com:22 HTTP/1.1\r\n\r\n") is None
    assert egress_proxy.parse_connect(b"GET http://github.com/ HTTP/1.1\r\n\r\n") is None


def test_live_proxy_refuses_an_unlisted_host_and_logs_it(tmp_path):
    log = tmp_path / "proxy.jsonl"
    p = subprocess.Popen([sys.executable, str(HERE / "egress_proxy.py"), "--allow", "example.invalid", "--log", str(log)],
                         stdout=subprocess.PIPE, text=True)
    try:
        port = int(p.stdout.readline())
        with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
            s.sendall(b"CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n")
            reply = s.recv(200)
        assert reply.startswith(b"HTTP/1.1 403")
        deadline = time.time() + 5
        while not log.exists() and time.time() < deadline:
            time.sleep(0.05)
        assert '"allowed": false' in log.read_text() and "github.com" in log.read_text()
    finally:
        p.terminate()
