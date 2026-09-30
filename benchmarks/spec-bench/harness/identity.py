"""What a run actually ran, recorded at its start (run.json "identity") so variations can be compared over time.

    python3 identity.py --env-file ~/.local/share/<install-id>/install.env --port <server port>

Prints one JSON object:
  backend            install.env BACKEND
  install_manifest   every KEY=VALUE of install.env (it holds no absolute paths by design): engine
                     settings, sampling, draft settings, model files, pinned images and versions
  server_command     argv of the engine serving --port, with $HOME written as ~ and keys masked (null if none).
                     When the port's listener is a container's network helper (Podman's pasta, slirp4netns,
                     rootlessport, conmon; docker-proxy), the engine is the process inside that container
  engine_version     first line the engine prints for --version, asked inside its container, and of `mtplx`
                     rather than the Python interpreter MTPLX runs in (null if it can't say)
  listener_command   the host process on --port when it is not the engine (a container helper), else null
  container          {runtime, name, image} of the engine's container, else null
  model_files        each model file named in the manifest: bytes, and the Hugging Face revision and
                     sha256 saved at download (no hashing here: a 17 GB file would take a minute)
  drivers            NVIDIA driver, and the kernel on Linux
  os                 OS name and release

It never fails a run: anything it can't find is null.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

MODEL_ROLES = ("MODEL_FILE", "MTP_FILE", "MMPROJ_FILE", "GUFO_MODEL_REL", "GUFO_MTP_REL")
HF_METADATA = Path(".cache/huggingface/download")
VERIFIED_MARKER = ".awesome-local-ai-verified"
VERSION_TIMEOUT_S = 20
TOOL_TIMEOUT_S = 10


def parse_env(text: str) -> dict[str, str]:
    """install.env as a dict, with shell quoting undone (values are written with printf %q or in quotes)."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if not m:
            continue
        try:
            parts = shlex.split(m.group(2))
        except ValueError:
            parts = [m.group(2)]
        out[m.group(1)] = " ".join(parts)
    return out


def _metadata(dirs: list[Path], name: str) -> tuple[str | None, str | None]:
    for d in dirs:
        meta = d / HF_METADATA / f"{name}.metadata"
        if meta.is_file():
            lines = meta.read_text().splitlines()
            rev = lines[0].strip() if lines else None
            sha = lines[1].strip() if len(lines) > 1 and re.fullmatch(r"[0-9a-f]{64}", lines[1].strip()) else None
            return rev or None, sha
    return None, None


def _size(p: Path) -> int | None:
    if p.is_file():
        return p.stat().st_size
    if p.is_dir():
        # the model's own files: not the download cache or our verified marker (hidden files)
        return sum(f.stat().st_size for f in p.rglob("*")
                   if f.is_file() and not any(part.startswith(".") for part in f.relative_to(p).parts))
    return None


def model_files(env: dict[str, str], install_dir: Path, home: Path) -> list[dict]:
    """The model files a manifest names, found under the install dir's or $HOME's MODEL_SUBDIR."""
    sub = env.get("MODEL_SUBDIR", "")
    dirs = [install_dir / sub, home / sub]
    # gufo names its GGUF parts relative to the model folder (MODEL_FILE) inside MODEL_SUBDIR
    dirs += [d / env["MODEL_FILE"] for d in list(dirs) if env.get("MODEL_FILE")]
    out = []
    for role in MODEL_ROLES:
        name = env.get(role, "")
        if not name:
            continue
        path = next((d / name for d in dirs if (d / name).exists()), None)
        rev, sha = _metadata(dirs, name)
        if path is not None and path.is_dir() and (path / VERIFIED_MARKER).is_file():
            try:
                rev = rev or json.loads((path / VERIFIED_MARKER).read_text()).get("revision")
            except (ValueError, OSError):
                pass
        out.append({"role": role, "name": name, "bytes": _size(path) if path else None,
                    "revision": rev, "sha256": sha})
    return out


def pid_from_ss(text: str) -> int | None:
    m = re.search(r"pid=(\d+)", text)
    return int(m.group(1)) if m else None


def pid_from_lsof(text: str) -> int | None:
    first = text.split()
    return int(first[0]) if first and first[0].isdigit() else None


def _run(cmd: list[str], timeout: float = TOOL_TIMEOUT_S) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def listening_pid(port: int) -> int | None:
    if port <= 0:
        return None
    if shutil.which("ss"):
        return pid_from_ss(_run(["ss", "-ltnpH", f"sport = :{port}"]))
    if shutil.which("lsof"):
        return pid_from_lsof(_run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"]))
    return None


def argv_of(pid: int) -> list[str] | None:
    proc = Path(f"/proc/{pid}/cmdline")
    if proc.is_file():
        parts = proc.read_bytes().split(b"\0")
        return [p.decode("utf-8", "replace") for p in parts if p]
    out = _run(["ps", "-ww", "-o", "command=", "-p", str(pid)]).strip()
    return shlex.split(out) if out else None


def tilde(argv: list[str], home: str) -> list[str]:
    return [a.replace(home, "~") for a in argv] if home else argv


def _run_rc(cmd: list[str], timeout: float = TOOL_TIMEOUT_S) -> tuple[str, int]:
    """stdout and stderr together, and the exit code (-1 if it couldn't run)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return "", -1
    return r.stdout + "\n" + r.stderr, r.returncode


def first_version_line(text: str, ok: bool) -> str | None:
    """The line that looks like a version (llama-server prints build chatter first); failing that, when the
    command succeeded, its first line (gufo prints just "gufo <commit>")."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for line in lines:
        if re.search(r"version|\d+\.\d+", line, re.I) and not line.startswith(("[", "0.")):
            return line
    return lines[0] if ok and lines else None


def engine_version(argv: list[str] | None, cmd: list[str] | None = None) -> str | None:
    """The engine's own answer to --version: cmd (from version_command) or the serving binary itself."""
    if cmd is None:
        if not argv or not os.access(argv[0], os.X_OK):
            return None
        cmd = [argv[0], "--version"]
    out, rc = _run_rc(cmd, VERSION_TIMEOUT_S)
    return first_version_line(out, rc == 0)


# ---------- the engine behind the port: following it into a container ----------

# What listens on a published port for a container, instead of the engine itself.
CONTAINER_HELPERS = {"pasta", "pasta.avx2", "slirp4netns", "rootlessport", "rootlessport-child", "conmon",
                     "docker-proxy"}
# Backends whose launcher runs the engine in a container, named "<INSTALL_ID>-<PORT>" (lib/runtime/server-*.sh).
CONTAINER_BACKENDS = {"gufo": "podman", "sglang": "docker"}
_SECRET = re.compile(r"^--?[\w-]*(?:key|token|secret|password)[\w-]*$", re.I)


def is_container_helper(argv: list[str] | None) -> bool:
    return bool(argv) and Path(argv[0]).name in CONTAINER_HELPERS


def container_runtime(listener: list[str] | None, backend: str | None) -> str | None:
    """podman or docker when the engine is in a container: the backend's launcher says which; a helper alone
    (docker-proxy for Docker, the rest Podman's) says so when the backend doesn't."""
    if backend in CONTAINER_BACKENDS:
        return CONTAINER_BACKENDS[backend]
    if is_container_helper(listener):
        return "docker" if Path(listener[0]).name == "docker-proxy" else "podman"
    return None


def _json(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


def container_for_port(ps_json: str, port: int) -> str | None:
    """The name of the container publishing host port `port`, from `podman ps --format json`."""
    for c in _json(ps_json) or []:
        for p in c.get("Ports") or []:
            if (p.get("host_port") or p.get("hostPort")) == port:
                names = c.get("Names") or []
                return names[0] if names else c.get("Id")
    return None


def engine_from_inspect(inspect_json: str) -> dict | None:
    """{argv, name, image} of a container's main process, from `podman inspect` or `docker inspect`."""
    data = _json(inspect_json)
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None
    c = data[0]
    if c.get("Path"):
        argv = [c["Path"], *(c.get("Args") or [])]
    else:
        cfg = c.get("Config") or {}
        ep = cfg.get("Entrypoint") or []
        argv = [*([ep] if isinstance(ep, str) else ep), *(cfg.get("Cmd") or [])]
    if not argv:
        return None
    return {"argv": argv, "name": (c.get("Name") or "").lstrip("/") or c.get("Id"),
            "image": c.get("ImageName") or (c.get("Config") or {}).get("Image") or c.get("Image")}


def version_command(backend: str | None, argv: list[str] | None, container: dict | None = None) -> list[str] | None:
    """How to ask the engine its version: inside its container; of `mtplx` for MTPLX (its server is a Python
    process, whose own --version names Python); else the serving binary."""
    if not argv:
        return None
    if container:
        return [container["runtime"], "exec", container["name"], argv[0], "--version"]
    if backend == "mtplx":
        return ["mtplx", "--version"]
    return [argv[0], "--version"]


def redact(argv: list[str]) -> list[str]:
    """Run records are published: a key given on a command line is masked."""
    out, mask_next = [], False
    for a in argv:
        if mask_next:
            out.append("***"); mask_next = False
            continue
        flag, eq, _ = a.partition("=")
        if _SECRET.match(flag):
            if eq:
                out.append(f"{flag}=***")
                continue
            mask_next = True
        out.append(a)
    return out


def follow_container(listener: list[str] | None, port: int, env: dict[str, str]) -> dict | None:
    """The engine inside the container behind `port`: by the launcher's own name first, else by published port."""
    runtime = container_runtime(listener, env.get("BACKEND"))
    if runtime is None or port <= 0:
        return None
    names = [f"{env['INSTALL_ID']}-{port}"] if env.get("INSTALL_ID") else []
    for name in names:
        eng = engine_from_inspect(_run([runtime, "inspect", name]))
        if eng:
            return {"runtime": runtime, **eng}
    if runtime == "podman":
        name = container_for_port(_run(["podman", "ps", "--format", "json"]), port)
        eng = engine_from_inspect(_run([runtime, "inspect", name])) if name else None
        if eng:
            return {"runtime": runtime, **eng}
    return None


def drivers() -> dict:
    d = {}
    if shutil.which("nvidia-smi"):
        d["nvidia"] = _run(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"]).strip() or None
    if platform.system() == "Linux":
        d["kernel"] = platform.release()
    return d


def os_desc() -> str:
    if platform.system() == "Darwin":
        return f"macOS {platform.mac_ver()[0]}"
    try:
        info = dict(l.split("=", 1) for l in Path("/etc/os-release").read_text().splitlines() if "=" in l)
        return info.get("PRETTY_NAME", "").strip('"') or platform.platform()
    except OSError:
        return platform.platform()


def identity(env_file: Path, port: int) -> dict:
    home = str(Path.home())
    env = parse_env(env_file.read_text()) if env_file.is_file() else {}
    pid = listening_pid(port)
    listener = argv_of(pid) if pid else None
    backend = env.get("BACKEND")
    ctr = follow_container(listener, port, env) if (is_container_helper(listener) or backend in CONTAINER_BACKENDS) else None
    # A helper whose container can't be found is not the engine: record no engine rather than the helper.
    argv = ctr["argv"] if ctr else (None if is_container_helper(listener) else listener)
    vcmd = version_command(backend, argv, ctr)
    return {
        "backend": backend,
        "install_manifest": env,
        "server_command": tilde(redact(argv), home) if argv else None,
        "engine_version": engine_version(argv, vcmd if vcmd != [argv[0], "--version"] else None) if argv else None,
        "listener_command": tilde(redact(listener), home) if listener and listener != argv else None,
        "container": {k: ctr[k] for k in ("runtime", "name", "image")} if ctr else None,
        "model_files": model_files(env, env_file.parent, Path(home)),
        "drivers": drivers(),
        "os": os_desc(),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--env-file", type=Path, required=True)
    ap.add_argument("--port", type=int, default=0)
    a = ap.parse_args()
    try:
        rec = identity(a.env_file, a.port)
    except Exception as e:  # never stop a run over its record
        rec = {"error": f"{type(e).__name__}: {e}"}
    print(json.dumps(rec))
    return 0


if __name__ == "__main__":
    sys.exit(main())
