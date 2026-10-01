"""sandbox.py: what the harness asks of agent-sandbox for each agent run, without starting one (the real sandbox is
test_agent_world.py). The command line, the exact environment, the secrets' descriptors, the ports, the modes, the
binary that is built once from the source and kept."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import sandbox
from sandbox import ENFORCED, PERMISSIVE


@pytest.fixture
def enforced(monkeypatch):
    monkeypatch.delenv(sandbox.MODE_ENV, raising=False)
    monkeypatch.setattr(sandbox, "binary", lambda: Path("/opt/agent-sandbox"))
    monkeypatch.setattr(sandbox, "read_only_paths", lambda: [Path("/tools/ro")])


def run_dir(tmp_path, spec=True) -> Path:
    own = tmp_path / "work" / "abc123"
    (own / "workspace" / ("spec" if spec else "src")).mkdir(parents=True)
    return own


# ---------- the mode ----------

def test_the_sandbox_is_on_unless_the_harness_s_own_tests_say_permissive():
    assert sandbox.mode({}) == ENFORCED
    assert sandbox.mode({sandbox.MODE_ENV: "permissive"}) == PERMISSIVE
    assert sandbox.mode({sandbox.MODE_ENV: "enforced"}) == ENFORCED


def test_any_other_mode_is_refused():
    with pytest.raises(SystemExit, match="permissive"):
        sandbox.mode({sandbox.MODE_ENV: "off"})


def test_permissive_runs_the_command_as_it_is_with_the_harness_s_environment_on_top(monkeypatch, tmp_path):
    monkeypatch.setenv(sandbox.MODE_ENV, PERMISSIVE)
    monkeypatch.setenv("COV_HARNESS", "x")
    launch = sandbox.launch(["pi", "-p"], tmp_path, None, {"HOME": "/h"}, {"TOKEN": "t"})
    assert launch.argv == ["pi", "-p"] and launch.fds == ()
    assert launch.env["COV_HARNESS"] == "x" and launch.env["HOME"] == "/h" and launch.env["TOKEN"] == "t"
    assert sandbox.identity() == {"mode": PERMISSIVE}


def test_no_session_starts_without_a_world(enforced, tmp_path):
    with pytest.raises(SystemExit, match="no sandbox world"):
        sandbox.launch(["pi"], run_dir(tmp_path), None, {})


# ---------- where the agent sees its run ----------

def test_the_run_is_at_w_on_linux_and_where_it_is_on_macos(monkeypatch, tmp_path):
    monkeypatch.delenv(sandbox.MODE_ENV, raising=False)
    monkeypatch.setattr(sandbox, "IS_MAC", False)
    assert sandbox.view_root(tmp_path) == Path("/w") and sandbox.tmp_view(Path("/w")) == Path("/tmp")
    monkeypatch.setattr(sandbox, "IS_MAC", True)
    assert sandbox.view_root(tmp_path) == tmp_path.resolve() and sandbox.tmp_view(tmp_path) == tmp_path / "tmp"
    monkeypatch.setenv(sandbox.MODE_ENV, PERMISSIVE)
    assert sandbox.view_root(tmp_path) == tmp_path and sandbox.tmp_view(tmp_path) == tmp_path / "tmp"


# ---------- ports ----------

def test_each_run_has_its_own_stable_block_of_ports_away_from_the_harness_s():
    names = [f"run-{i}" for i in range(200)]
    blocks = {n: sandbox.ports_for(n) for n in names}
    assert blocks["run-1"] == sandbox.ports_for("run-1")
    for first, last in blocks.values():
        assert last - first + 1 == sandbox.PORTS_PER_RUN
        assert sandbox.PORT_POOL_FIRST <= first and last < 32_768                       # below Linux's ephemeral range
        assert not {18010, 18100, 18787, 18788, 19787, 8787, 9229} & set(range(first, last + 1))
    assert len(set(blocks.values())) > 150                                                # different runs, different blocks


# ---------- the world ----------

def test_a_local_model_server_is_the_one_host_port_and_a_cloud_model_has_none():
    w = sandbox.world_for("r", "http://127.0.0.1:18010/v1", (), None)
    assert w.host_ports == (18010,) and w.presets == ("npm", "playwright")
    assert sandbox.world_for("r", "http://localhost:18100/v1", (), None).host_ports == (18100,)
    c = sandbox.world_for("r", "cloud", ("claude",), None)
    assert c.host_ports == () and c.presets == ("npm", "playwright", "claude")
    assert sandbox.world_for("r", None, ("npm",), None).presets == ("npm", "playwright")


@pytest.mark.parametrize("url", ["http://192.168.1.5:8080/v1", "http://127.0.0.1/v1", "https://api.example.com/v1"])
def test_a_model_server_anywhere_else_is_refused(url):
    with pytest.raises(SystemExit, match="loopback"):
        sandbox.world_for("r", url, (), None)


# ---------- the environment ----------

def test_the_path_names_the_toolchain_the_client_and_the_system_and_nothing_else_of_the_harness_s(tmp_path, monkeypatch):
    node, client, other = tmp_path / "node" / "bin", tmp_path / "tools", tmp_path / "owners-other-tool"
    for d, exe in ((node, "node"), (client, "pi"), (other, "terraform")):
        d.mkdir(parents=True)
        (d / exe).write_text("#!/bin/sh\n")
        (d / exe).chmod(0o755)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))
    (tmp_path / "home" / ".dbench" / "tools" / "bin").mkdir(parents=True)
    path = sandbox.agent_path("pi", os.pathsep.join(str(d) for d in (other, node, client)))
    dirs = path.split(os.pathsep)
    assert dirs[:2] == [str(node), str(client)] and str(tmp_path / "home" / ".dbench" / "tools" / "bin") in dirs
    assert str(other) not in dirs and "/usr/bin" in dirs
    assert sandbox.agent_path("absent-client", str(node)).split(os.pathsep)[0] == str(node)


def test_the_agent_s_environment_is_exactly_the_allow_list_with_the_locale_from_the_harness():
    got = sandbox.process_env({"HOME": "/w/agent-home", "PI_OFFLINE": "1"}, {"LANG": "en_GB.UTF-8", "FAKE_API_KEY": "x"})
    assert got == {"LANG": "en_GB.UTF-8", "HOME": "/w/agent-home", "PI_OFFLINE": "1"}
    assert sandbox.process_env({}, {}) == {"LANG": "C.UTF-8"}
    with pytest.raises(ValueError, match="FAKE_API_KEY"):
        sandbox.process_env({"FAKE_API_KEY": "x"}, {})
    assert "PATH" not in sandbox.ENV_FROM_HARNESS         # computed (agent_path), never inherited
    assert not any(k.endswith(("_KEY", "_SECRET", "_PASSWORD", "_TOKEN")) for k in sandbox.ENV_ALLOWED)


# ---------- the secrets ----------

def test_a_secret_is_in_a_pipe_named_by_a_variable_and_never_in_the_environment():
    env, fds = sandbox.secret_fds({"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-x"})
    try:
        assert env == {"CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR": str(fds[0])} and os.get_inheritable(fds[0])
        assert os.read(fds[0], 100) == b"sk-ant-oat01-x" and os.read(fds[0], 100) == b""
    finally:
        os.close(fds[0])
    assert sandbox.secret_fds({}) == ({}, [])


# ---------- the command line ----------

def test_the_command_is_wrapped_with_the_run_s_directory_the_spec_the_hosts_and_the_ports(enforced, monkeypatch, tmp_path):
    monkeypatch.setattr(sandbox, "IS_MAC", False)
    own = run_dir(tmp_path)
    world = sandbox.World(run="abc123", host_ports=(18010,), presets=("npm", "playwright", "claude"),
                          egress_log=tmp_path / "logs" / "abc123.jsonl")
    launch = sandbox.launch(["pi", "-p", "go"], own, world, {"HOME": "/w/agent-home", "TMPDIR": "/tmp"},
                            {"CLAUDE_CODE_OAUTH_TOKEN": "t"})
    argv = launch.argv
    first, last = sandbox.ports_for("abc123")
    assert argv[:2] == ["/opt/agent-sandbox", "run"] and argv[argv.index("--") + 1:] == ["pi", "-p", "go"]
    pairs = [(argv[i], argv[i + 1]) for i in range(len(argv) - 1)]
    assert ("--own-dir", str(own.resolve())) in pairs and ("--workdir", "workspace") in pairs
    assert ("--own-ro", "workspace/spec") in pairs and ("--own-at", "/w") in pairs
    assert ("--ro", "/tools/ro") in pairs
    assert [v for k, v in pairs if k == "--preset"] == ["npm", "playwright", "claude"]
    assert ("--host-port", "18010") in pairs and ("--agent-ports", f"{first}-{last}") in pairs
    assert ("--proxy-log", str(tmp_path / "logs" / "abc123.jsonl")) in pairs and (tmp_path / "logs").is_dir()
    assert "--ephemeral-ports" not in argv                                   # Linux: its loopback is its own
    # The environment is exact: the allow-list, a PATH of the toolchain, and the secret's descriptor, not the token.
    assert set(launch.env) == {"LANG", "PATH", "HOME", "TMPDIR", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"}
    assert "t" not in launch.env.values()
    assert ("--keep-env", ",".join(sorted(launch.env))) in pairs
    assert launch.fds == (int(launch.env["CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"]),)
    launch.close()
    launch.close()                                                           # closing twice is harmless
    with pytest.raises(OSError):
        os.fstat(launch.fds[0])


def test_on_macos_the_run_is_not_remapped_and_wrangler_s_kernel_picked_ports_are_opened_unless_the_run_does_not_serve(
        enforced, monkeypatch, tmp_path):
    monkeypatch.setattr(sandbox, "IS_MAC", True)
    own = run_dir(tmp_path, spec=False)                                      # no spec: nothing to protect, no flag
    argv = sandbox.launch(["pi"], own, sandbox.World(run="r"), {}).argv
    assert "--own-at" not in argv and "--own-ro" not in argv and "--ephemeral-ports" in argv and "--proxy-log" not in argv
    argv = sandbox.launch(["pi"], own, sandbox.World(run="r", kernel_picked_ports=False), {}).argv
    assert "--ephemeral-ports" not in argv
    argv = sandbox.launch(["pi"], own, sandbox.World(run="r", extra_read_only=(Path("/fake/agent"),)), {}).argv
    assert argv[argv.index("/fake/agent") - 1] == "--ro"


def test_the_read_only_paths_are_the_agents_browsers_and_dbench_s_tools_when_they_exist(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    assert sandbox.read_only_paths() == []
    (home / ".dbench" / "tools").mkdir(parents=True)
    (home / ".cache" / "vidi-agent-ms-playwright").mkdir(parents=True)
    assert sorted(sandbox.read_only_paths()) == sorted([home / ".dbench" / "tools", sandbox.hostenv.agent_playwright_cache(home)])


# ---------- the binary: built once from the release's own source ----------

@pytest.fixture
def source(tmp_path, monkeypatch):
    """A code root with a tools/agent-sandbox, a cache, and a stand-in for cargo."""
    code = tmp_path / "code"
    src = code / "tools" / "agent-sandbox"
    (src / "src").mkdir(parents=True)
    for name, text in (("Cargo.toml", "[package]"), ("Cargo.lock", "# lock"), ("presets.toml", "[npm]"), ("src/main.rs", "fn main() {}")):
        (src / name).write_text(text)
    cache = tmp_path / "cache"
    monkeypatch.setattr(sandbox.roots, "CODE_ROOT", code)
    monkeypatch.setenv(sandbox.CACHE_ENV, str(cache))
    monkeypatch.delenv(sandbox.BINARY_ENV, raising=False)
    sandbox.binary.cache_clear()
    sandbox.build_identity.cache_clear()
    calls = []

    def cargo(cmd, **kw):
        calls.append((cmd, kw))
        built = Path(kw["env"]["CARGO_TARGET_DIR"]) / "release" / sandbox.BINARY_NAME
        built.parent.mkdir(parents=True, exist_ok=True)
        built.write_text("binary")
        return SimpleNamespace(returncode=0, stdout="", stderr="")
    monkeypatch.setattr(sandbox, "_cargo", lambda: "/usr/bin/cargo")
    monkeypatch.setattr(sandbox.subprocess, "run", cargo)
    yield SimpleNamespace(code=code, src=src, cache=cache, calls=calls)
    sandbox.binary.cache_clear()
    sandbox.build_identity.cache_clear()


def test_the_binary_is_built_once_from_the_release_s_own_source_and_kept_by_its_hash(source):
    built = sandbox.binary()
    assert built.is_file() and built.parent.parent.parent == source.cache
    (cmd, kw), = source.calls
    assert cmd[:4] == ["/usr/bin/cargo", "build", "--release", "--locked"]
    assert cmd[-1] == str(source.src / "Cargo.toml") and kw["env"]["CARGO_TARGET_DIR"] == str(built.parent.parent)
    sandbox.binary.cache_clear()
    assert sandbox.binary() == built and len(source.calls) == 1                  # the same source: kept, not built again
    (source.src / "src" / "main.rs").write_text("fn main() { /* changed */ }")
    sandbox.binary.cache_clear()
    assert sandbox.binary() != built and len(source.calls) == 2                  # a changed source: a new binary


def test_a_binary_can_be_named_and_then_nothing_is_built(source, monkeypatch, tmp_path):
    given = tmp_path / "mine"
    given.write_text("x")
    monkeypatch.setenv(sandbox.BINARY_ENV, str(given))
    assert sandbox.binary() == given and source.calls == []
    sandbox.binary.cache_clear()
    monkeypatch.setenv(sandbox.BINARY_ENV, str(tmp_path / "absent"))
    with pytest.raises(sandbox.SandboxUnavailable, match="no such file"):
        sandbox.binary()


def test_no_source_no_cargo_or_a_failed_build_stops_the_run_before_it_starts_and_says_why(source, monkeypatch):
    sandbox.binary.cache_clear()
    monkeypatch.setattr(sandbox, "_cargo", lambda: None)
    with pytest.raises(sandbox.SandboxUnavailable, match="no cargo"):
        sandbox.binary()
    monkeypatch.setattr(sandbox, "_cargo", lambda: "/usr/bin/cargo")
    monkeypatch.setattr(sandbox.subprocess, "run", lambda cmd, **kw: SimpleNamespace(returncode=101, stdout="", stderr="error[E0432]"))
    sandbox.binary.cache_clear()
    with pytest.raises(sandbox.SandboxUnavailable, match="(?s)building agent-sandbox failed.*E0432"):
        sandbox.binary()
    for f in source.src.glob("Cargo.toml"):
        f.unlink()
    sandbox.binary.cache_clear()
    with pytest.raises(sandbox.SandboxUnavailable, match="is not here"):
        sandbox.binary()


def test_cargo_is_found_on_the_path_or_in_the_cargo_home(monkeypatch, tmp_path):
    monkeypatch.setattr(sandbox.shutil, "which", lambda name: "/x/cargo")
    assert sandbox._cargo() == "/x/cargo"
    monkeypatch.setattr(sandbox.shutil, "which", lambda name: None)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    assert sandbox._cargo() is None
    (tmp_path / ".cargo" / "bin").mkdir(parents=True)
    (tmp_path / ".cargo" / "bin" / "cargo").write_text("x")
    assert sandbox._cargo() == str(tmp_path / ".cargo" / "bin" / "cargo")


def test_the_cache_is_under_the_bench_home_unless_named(monkeypatch):
    monkeypatch.delenv(sandbox.CACHE_ENV, raising=False)
    assert sandbox.cache_dir() == sandbox.hostenv.bench_home() / "agent-sandbox"


def test_the_run_s_identity_is_the_builds_and_says_the_mode(source, monkeypatch):
    fake_binary = lambda: Path("/opt/agent-sandbox")
    fake_binary.cache_clear = lambda: None                      # the fixture clears the cache of the real one when it ends
    monkeypatch.setattr(sandbox, "binary", fake_binary)
    monkeypatch.setattr(sandbox.subprocess, "run", lambda cmd, **kw: SimpleNamespace(
        returncode=0, stdout=json.dumps({"version": "0.2.0", "platform": "linux-x86_64", "policy_hash": "ab" * 32}), stderr=""))
    assert sandbox.identity() == {"mode": ENFORCED, "version": "0.2.0", "platform": "linux-x86_64", "policy_hash": "ab" * 32}
    sandbox.build_identity.cache_clear()
    monkeypatch.setattr(sandbox.subprocess, "run", lambda cmd, **kw: SimpleNamespace(returncode=1, stdout="", stderr="boom"))
    with pytest.raises(sandbox.SandboxUnavailable, match="identity failed: boom"):
        sandbox.build_identity()
