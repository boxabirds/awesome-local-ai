"""The agent's world: every agent run goes through tools/agent-sandbox (deny by default), never around it.

Until 1 Oct 2026 the agent ran with the whole machine visible and a list of paths hidden, with the owner's whole
environment and an open network. Every leak (benchmarks/docs/insights/findings-security.md) was a path, a variable or a
host nobody had listed. Now nothing exists for the agent unless it is named here:

  files       the run's own directory only (workspace, tmp, home, the client's config), shown at /w on Linux and at a
              short neutral directory (~/.w/<id>) on macOS; spec/ read-only; the toolchain read-only; a private /tmp.
  environment one table (ENV_ALLOWED): a variable that is not in it does not exist inside.
  network     the npm registry, the Playwright CDN, and for Claude Code its API host, through an allow-listing proxy;
              the model server's own port on the host's loopback; the run's own port range for its own servers.
  processes   its own only (a pid namespace on Linux; on macOS other processes cannot be listed or signalled).
  privileges  none: no sudo, no setuid, no capabilities, nothing the spec's mode could undo.

The harness itself (gates, held-out scoring, snapshots, records) runs outside it and reaches the same directory by its
real path. `SPEC_BENCH_SANDBOX=permissive` runs the agent with no sandbox at all, for the harness's own tests; it
refuses to run a recording benchmark, and a run that used it cannot be published (drive.record_refusal).
"""
from __future__ import annotations

import functools
import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import hostenv
import roots
from hostenv import IS_MAC

MODE_ENV = "SPEC_BENCH_SANDBOX"
ENFORCED = "enforced"
PERMISSIVE = "permissive"
BINARY_ENV = "AGENT_SANDBOX_BIN"          # a binary to use instead of the one built from tools/agent-sandbox
CACHE_ENV = "SPEC_BENCH_SANDBOX_CACHE"    # where built binaries are kept (default: <bench home>/agent-sandbox)
SOURCE_DIR = Path("tools") / "agent-sandbox"
SOURCE_FILES = ("Cargo.toml", "Cargo.lock", "presets.toml")
BINARY_NAME = "agent-sandbox"
BUILD_TIMEOUT_S = 900

# Where the run's directory is for the agent. Linux: bubblewrap shows it at VIEW_ROOT, whatever it is on the host.
# macOS: Seatbelt cannot remap a path, so the directory really is short and neutral (drive.WORK_ROOT, ~/.w/<id>).
VIEW_ROOT = Path("/w")
WORKSPACE_DIR = "workspace"
SPEC_DIR = "spec"
TMP_DIR = "tmp"
HOME_DIR = "agent-home"
BROWSERS_DIR = "browsers"
LINUX_TMP = Path("/tmp")                  # bound over by the run's own tmp (bubblewrap)

# What the agent may reach.
PRESET_NPM = "npm"
PRESET_PLAYWRIGHT = "playwright"
PRESET_CLAUDE = "claude"
DEFAULT_PRESETS = (PRESET_NPM, PRESET_PLAYWRIGHT)
LOOPBACK_HOSTS = ("127.0.0.1", "localhost")

# Each run's own ports, for the servers it starts: dev servers, wrangler and its inspector, test servers. Away from
# the harness's (the bench and proxy ports 18010 and 18100, the held-out suite's 18787 and up, the judge's 19787),
# and below the ranges the kernels pick from (32768 on Linux, 49152 on macOS).
PORT_POOL_FIRST = 20_000
PORT_POOL_SLOTS = 600
PORTS_PER_RUN = 16
PORT_FIRST_ENV = "AGENT_PORT_FIRST"
PORT_LAST_ENV = "AGENT_PORT_LAST"

# THE allow-list. A variable is inside the agent's world if and only if its name is here (the harness's own
# environment is never inherited); the value comes from the caller (drive.agent_env, the client, or the harness's
# own environment for ENV_FROM_HARNESS). Nothing the owner has in their shell reaches the agent: not API keys, not
# tokens, not the names of runs or benchmarks.
ENV_FROM_HARNESS = {"LANG": "C.UTF-8", "LC_ALL": None}      # copied when the harness has it; else the default (or none)
ENV_ALLOWED = {
    "PATH": "the toolchain's directories only (agent_path)",
    "HOME": "a private home inside the run's directory",
    "TERM": "a terminal that needs nothing",
    "TMPDIR": "the run's own temp directory",
    "TMP": "the run's own temp directory",
    "TEMP": "the run's own temp directory",
    "CLAUDE_CODE_TMPDIR": "Claude Code ignores TMPDIR for its own files",
    "PWD": "inside the sandbox, not the harness's",
    "OLDPWD": "inside the sandbox, not the harness's",
    "XDG_CONFIG_HOME": "under the private home",
    "XDG_DATA_HOME": "under the private home",
    "XDG_CACHE_HOME": "under the private home",
    "XDG_STATE_HOME": "under the private home",
    "PLAYWRIGHT_BROWSERS_PATH": "the run's own browsers directory, linked to the shared read-only cache",
    "WRANGLER_SEND_METRICS": "no telemetry",
    "npm_config_update_notifier": "no update check",
    "GIT_AUTHOR_NAME": "the agent's commits",
    "GIT_AUTHOR_EMAIL": "the agent's commits",
    "GIT_COMMITTER_NAME": "the agent's commits",
    "GIT_COMMITTER_EMAIL": "the agent's commits",
    PORT_FIRST_ENV: "the run's own ports: the first",
    PORT_LAST_ENV: "the run's own ports: the last",
    # The clients' own: where each keeps its configuration, and what it must not do on its own.
    "PI_CODING_AGENT_DIR": "pi: its configuration directory",
    "PI_OFFLINE": "pi: no update check",
    "CLAUDE_CONFIG_DIR": "Claude Code: its configuration directory",
    "DISABLE_AUTOUPDATER": "Claude Code: no update",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "Claude Code: no telemetry or update hosts (only its API host is reachable)",
    "ANTHROPIC_BASE_URL": "Claude Code: the model endpoint (the harness's own tests point it at a stub)",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR": "Claude Code: the descriptor its token is read from; the token is never in the environment",
}
# Set by agent-sandbox itself when the network is allowed through its proxy; listed so the table is the whole truth.
ENV_FROM_SANDBOX = ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY")
# What a shell adds to its own environment.
ENV_FROM_SHELL = ("SHLVL", "_")
TERM_VALUE = "dumb"

# Programs the agent's PATH must reach. node brings npm and npx; the client's own program is added per run. git and
# python3 are the system's (on macOS agent-sandbox finds the developer tools' own).
TOOL_PROGRAMS = ("node",)
SYSTEM_PATH = ("/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin")
DBENCH_TOOLS = Path(".dbench") / "tools"


def mode(environ: dict | None = None) -> str:
    """ENFORCED unless SPEC_BENCH_SANDBOX=permissive. Anything else named there is refused."""
    value = (os.environ if environ is None else environ).get(MODE_ENV, ENFORCED)
    if value not in (ENFORCED, PERMISSIVE):
        raise SystemExit(f"{MODE_ENV}={value!r}: the only other value is {PERMISSIVE!r}")
    return value


def view_root(work: Path, enforced: bool | None = None) -> Path:
    """Where the agent sees the run's directory. Linux: VIEW_ROOT. macOS: its real (short, neutral) path."""
    if not (mode() == ENFORCED if enforced is None else enforced):
        return work
    return work.resolve() if IS_MAC else VIEW_ROOT


def tmp_view(view: Path, enforced: bool | None = None) -> Path:
    """The agent's temp directory: /tmp on Linux (the run's own is mounted there), else inside the run's directory."""
    if (mode() == ENFORCED if enforced is None else enforced) and not IS_MAC:
        return LINUX_TMP
    return view / TMP_DIR


def ports_for(run_name: str) -> tuple[int, int]:
    """The run's own ports (first, last): a stable block of PORTS_PER_RUN, chosen by the run's name."""
    slot = int(hashlib.sha256(run_name.encode()).hexdigest(), 16) % PORT_POOL_SLOTS
    first = PORT_POOL_FIRST + slot * PORTS_PER_RUN
    return first, first + PORTS_PER_RUN - 1


# ---------- the binary ----------

class SandboxUnavailable(SystemExit):
    pass


def _source_digest(code_root: Path) -> str:
    src = code_root / SOURCE_DIR
    h = hashlib.sha256()
    names = [*SOURCE_FILES, *sorted(str(p.relative_to(src)) for p in (src / "src").rglob("*.rs"))]
    for name in names:
        f = src / name
        if f.is_file():
            h.update(name.encode())
            h.update(f.read_bytes())
    h.update(f"{sys.platform}-{os.uname().machine}".encode())
    return h.hexdigest()[:16]


def cache_dir() -> Path:
    return Path(os.environ.get(CACHE_ENV) or hostenv.bench_home() / "agent-sandbox").expanduser()


def _cargo() -> str | None:
    return shutil.which("cargo") or next((str(p) for p in [Path.home() / ".cargo" / "bin" / "cargo"] if p.is_file()), None)


@functools.lru_cache(maxsize=None)
def binary() -> Path:
    """The agent-sandbox this harness runs: $AGENT_SANDBOX_BIN, else the one built from the tools/agent-sandbox in the
    harness's own tree (a release carries it) and kept by the hash of that source, so a machine builds it once per
    change and a release never depends on a binary built by hand."""
    given = os.environ.get(BINARY_ENV)
    if given:
        if not Path(given).is_file():
            raise SandboxUnavailable(f"{BINARY_ENV}={given}: no such file")
        return Path(given)
    src = roots.CODE_ROOT / SOURCE_DIR
    if not (src / "Cargo.toml").is_file():
        raise SandboxUnavailable(f"{src} is not here: this harness has no agent-sandbox to build, and {BINARY_ENV} is not set")
    target = cache_dir() / _source_digest(roots.CODE_ROOT)
    built = target / "release" / BINARY_NAME
    if built.is_file():
        return built
    cargo = _cargo()
    if not cargo:
        raise SandboxUnavailable("agent-sandbox has to be built once on this machine and there is no cargo: "
                                 "install Rust (rustup, 1.77 or newer) or set " + BINARY_ENV)
    target.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([cargo, "build", "--release", "--locked", "--manifest-path", str(src / "Cargo.toml")],
                       env={**os.environ, "CARGO_TARGET_DIR": str(target)}, capture_output=True, text=True,
                       timeout=BUILD_TIMEOUT_S)
    if r.returncode != 0 or not built.is_file():
        raise SandboxUnavailable(f"building agent-sandbox failed:\n{(r.stdout + r.stderr)[-1500:]}")
    return built


@functools.lru_cache(maxsize=None)
def build_identity() -> dict:
    """What `agent-sandbox identity` says: {"version", "platform", "policy_hash"}."""
    r = subprocess.run([str(binary()), "identity"], capture_output=True, text=True, timeout=BUILD_TIMEOUT_S)
    if r.returncode != 0:
        raise SandboxUnavailable(f"agent-sandbox identity failed: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)


def identity() -> dict:
    """The sandbox the run uses, for run.json: comparable across machines and runs. A run that used none says so."""
    if mode() == PERMISSIVE:
        return {"mode": PERMISSIVE}
    return {"mode": ENFORCED, **build_identity()}


# ---------- the agent's world ----------

@dataclass(frozen=True)
class World:
    """What one agent run may reach, besides its own directory."""
    run: str                                   # the run's work-directory name: it picks the port block
    host_ports: tuple[int, ...] = ()           # servers on the host's loopback (the model server)
    presets: tuple[str, ...] = DEFAULT_PRESETS
    egress_log: Path | None = None             # the proxy's log of every request, outside the agent's reach
    # macOS: `wrangler dev` listens on ports the kernel picks, which Seatbelt can only allow wholesale (README: the
    # accepted gap) and at a cost of about ten seconds at each start. Off for anything that does not serve.
    kernel_picked_ports: bool = True
    extra_read_only: tuple[Path, ...] = ()     # more read-only paths: the harness's own tests put a fake agent here

    @property
    def ports(self) -> tuple[int, int]:
        return ports_for(self.run)


def world_for(run: str, base_url: str | None, presets: tuple[str, ...], egress_log: Path | None) -> World:
    """The world for a run whose model is at base_url: the loopback port it names, nothing for a cloud model.
    A model server anywhere else is refused: it would need a way out that is not on the list."""
    from urllib.parse import urlparse
    ports: tuple[int, ...] = ()
    if base_url and base_url != "cloud":
        u = urlparse(base_url)
        if u.hostname not in LOOPBACK_HOSTS or not u.port:
            raise SystemExit(f"the model endpoint {base_url} must be on this machine's loopback with a port "
                             f"(the agent's network is closed)")
        ports = (u.port,)
    return World(run=run, host_ports=ports, presets=tuple(dict.fromkeys([*DEFAULT_PRESETS, *presets])), egress_log=egress_log)


def agent_path(program: str, harness_path: str | None = None) -> str:
    """The agent's PATH: the directories of the programs it needs (node and the client) and the system's. Nothing else
    of the harness's PATH, which names the owner's home and every tool they have installed."""
    path = harness_path if harness_path is not None else os.environ.get("PATH") or ""
    needed = {str(Path(p).parent) for p in (shutil.which(name, path=path) for name in (*TOOL_PROGRAMS, program)) if p}
    # In the harness's own order, so each program is the copy the harness would run: a directory that holds node may
    # hold another, older client too, and must not come before the client's own.
    found = [d for d in dict.fromkeys(path.split(os.pathsep)) if d in needed]
    tools = Path.home() / DBENCH_TOOLS / "bin"
    dirs = [*found, *([str(tools)] if tools.is_dir() else []), *(d for d in SYSTEM_PATH if Path(d).is_dir())]
    return os.pathsep.join(dict.fromkeys(dirs))


def read_only_paths() -> list[Path]:
    """Outside the run's directory the agent may only read: the shared browsers (its own tools directory, never the
    held-out suite's) and dbench's tools, where pi and uv are installed. Only those that exist."""
    paths = [hostenv.agent_playwright_cache(Path.home()), Path.home() / DBENCH_TOOLS]
    return [p for p in paths if p.exists()]


def process_env(requested: dict, harness_env: dict | None = None) -> dict:
    """The agent's whole environment: what was asked for, and only if its name is in ENV_ALLOWED; LANG and LC_ALL from
    the harness. A name that is not on the list is a harness bug and stops the run, never a variable passed on."""
    stray = sorted(set(requested) - set(ENV_ALLOWED))
    if stray:
        raise ValueError(f"not on the agent's environment allow-list (sandbox.ENV_ALLOWED): {', '.join(stray)}")
    harness = os.environ if harness_env is None else harness_env
    env = {k: harness.get(k, default) for k, default in ENV_FROM_HARNESS.items()}
    env = {k: v for k, v in env.items() if v is not None}
    env.update(requested)
    return env


@dataclass
class Launch:
    """A command ready to start: its argv, its exact environment, and the descriptors to hand it (secrets)."""
    argv: list[str]
    env: dict
    fds: tuple[int, ...] = ()
    _owned: list[int] = field(default_factory=list)

    def close(self) -> None:
        """After the process is started: the harness's copies of the secrets' descriptors."""
        for fd in self._owned:
            try:
                os.close(fd)
            except OSError:
                pass
        self._owned.clear()


def secret_fds(secrets: dict[str, str]) -> tuple[dict, list[int]]:
    """Each secret in a pipe of its own, read by the client from the descriptor named in NAME_FILE_DESCRIPTOR: the token
    is never in an environment (a process's environment can be read by every process of the same user inside)."""
    env: dict = {}
    fds: list[int] = []
    for name, value in secrets.items():
        r, w = os.pipe()
        os.write(w, value.encode())
        os.close(w)
        os.set_inheritable(r, True)
        env[f"{name}_FILE_DESCRIPTOR"] = str(r)
        fds.append(r)
    return env, fds


def launch(cmd: list[str], work: Path, world: World | None, env: dict, secrets: dict[str, str] | None = None) -> Launch:
    """Wrap `cmd` for the agent. `work` is the run's directory (real path); `env` is what the agent is to have
    (drive.agent_env and the client's), checked against ENV_ALLOWED."""
    if mode() == PERMISSIVE:
        # Not a sandbox at all: only the harness's own tests may ask for it (and recording refuses it).
        return Launch(argv=list(cmd), env={**os.environ, **env, **(secrets or {})})
    if world is None:
        raise SystemExit("the agent was started with no sandbox world: nothing is allowed to run without one")
    secret_env, fds = secret_fds(secrets or {})
    full = process_env({**env, **secret_env, "PATH": agent_path(cmd[0])})
    own = work.resolve()
    spec = own / WORKSPACE_DIR / SPEC_DIR
    # --keep-env: agent-sandbox itself drops every variable but these, so whatever the launcher needed in its own
    # environment (the user manager's address, for systemd-run) never reaches the agent.
    argv = [str(binary()), "run", "--own-dir", str(own), "--workdir", WORKSPACE_DIR, "--keep-env", ",".join(sorted(full))]
    if spec.is_dir():
        argv += ["--own-ro", f"{WORKSPACE_DIR}/{SPEC_DIR}"]
    if not IS_MAC:
        argv += ["--own-at", str(VIEW_ROOT)]
    for ro in (*read_only_paths(), *world.extra_read_only):
        argv += ["--ro", str(ro)]
    for preset in world.presets:
        argv += ["--preset", preset]
    for port in world.host_ports:
        argv += ["--host-port", str(port)]
    first, last = world.ports
    argv += ["--agent-ports", f"{first}-{last}"]
    if IS_MAC and world.kernel_picked_ports:
        argv += ["--ephemeral-ports"]
    if world.egress_log:
        world.egress_log.parent.mkdir(parents=True, exist_ok=True)
        argv += ["--proxy-log", str(world.egress_log)]
    return Launch(argv=[*argv, "--", *cmd], env=full, fds=tuple(fds), _owned=list(fds))


if __name__ == "__main__":
    # `python3 sandbox.py identity` -> the run.json "sandbox" object; `build` -> make sure the binary exists (run.sh).
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    if what == "identity":
        print(json.dumps(identity()))
    elif what == "build":
        print(identity() if mode() == PERMISSIVE else binary())
    else:
        sys.exit("usage: sandbox.py identity | build")
