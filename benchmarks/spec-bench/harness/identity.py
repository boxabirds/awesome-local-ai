"""What a run actually ran, recorded at its start (run.json "identity") so variations can be compared over time.

    python3 identity.py --env-file ~/.local/share/<install-id>/install.env --port <server port>

Prints one JSON object:
  backend            install.env BACKEND
  install_manifest   every KEY=VALUE of install.env (it holds no absolute paths by design): engine
                     settings, sampling, draft settings, model files, pinned images and versions
  server_command     argv of the process listening on --port, with $HOME written as ~ (null if none)
  engine_version     first line the serving binary prints for --version (null if it can't say)
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


def engine_version(argv: list[str]) -> str | None:
    """The serving binary's own answer to --version (llama-server prints it on stdout or stderr)."""
    if not argv or not os.access(argv[0], os.X_OK):
        return None
    try:
        r = subprocess.run([argv[0], "--version"], capture_output=True, text=True, timeout=VERSION_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return None
    for line in (r.stdout + "\n" + r.stderr).splitlines():
        if re.search(r"version|\d+\.\d+", line, re.I) and not line.lstrip().startswith(("[", "0.")):
            return line.strip()
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
    argv = argv_of(pid) if pid else None
    return {
        "backend": env.get("BACKEND"),
        "install_manifest": env,
        "server_command": tilde(argv, home) if argv else None,
        "engine_version": engine_version(argv) if argv else None,
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
