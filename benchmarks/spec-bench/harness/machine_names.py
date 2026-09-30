"""machine_names.py — the owner's own machine names, which never go into the public repo.

A machine's name is personal setup; in this repo a machine is named by its hardware (run.json's "host",
host-desc.sh). The names themselves live only outside the repo, and are read from there at run time:
- the dbench node list, ~/.config/dbench/nodes.toml (or NODES_ENV): its [nodes.<name>] tables. Each user
  lists their own machines there; URLs and tokens are not names and are never read into anything;
- this machine's hostname, in full and short ("box.local" and "box").
Nothing here, and no test, hard-codes a real name.

Used by heldout.staged_problems (the check before every harness commit: a staged file the harness wrote, or the
commit message, naming a machine is refused) and by tests/privacy-test.sh (`python3 machine_names.py tracked
<repo>`: no tracked file names a machine in the node list). The agent's own work (publicise.is_own_work) is its
own and never checked, as for held-out titles.
Tests: test_machine_names.py, and section I of test_publish_gate.py.
"""
from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import tomllib
from pathlib import Path, PurePosixPath

NODES_ENV = "SPEC_BENCH_NODES_FILE"
NODES_REL = ".config/dbench/nodes.toml"      # dbench's own default (tools/dbench/src/client.rs CONFIG_REL)
# Names that are not anyone's: an OS's default hostname is also a path segment of every combination on it
# ("ubuntu/nvidia4090"), and "localhost" is in every server log. Refusing them would refuse every run.
GENERIC_NAMES = {"localhost", "localhost.localdomain", "ubuntu", "debian", "fedora", "archlinux", "raspberrypi",
                 "linux", "macos", "windows", "mac", "macbook", "computer", "host", "node", "server", "desktop"}
MIN_NAME_CHARS = 4                            # shorter names match ordinary words
NAME_CHAR = "A-Za-z0-9"                       # a name ends where these do: "-", "_", ".", "(" all separate
AGENT_OWN_FILES = {"gate.json", "agent-events.jsonl", "agent-events.compact.jsonl.gz", "workspace-git-log.txt"}
EXIT_FOUND = 1
EXIT_BROKEN_LIST = 2


def nodes_file() -> Path:
    """The local dbench node list: NODES_ENV, else dbench's default under $HOME."""
    if os.environ.get(NODES_ENV):
        return Path(os.environ[NODES_ENV]).expanduser()
    return Path(os.environ.get("HOME") or Path.home()) / NODES_REL


def node_names(path: Path) -> set[str]:
    """The node list's machine names; none when there is no list. A list that can't be read or parsed raises
    ValueError: a check must not take a broken list for an empty one."""
    try:
        text = path.read_text()
    except FileNotFoundError:
        return set()
    except OSError as e:
        raise ValueError(f"cannot read the node list {path}: {e}") from e
    try:
        nodes = tomllib.loads(text).get("nodes") or {}
    except tomllib.TOMLDecodeError as e:
        raise ValueError(f"cannot parse the node list {path}: {e}") from e
    return set(nodes) if isinstance(nodes, dict) else set()


def this_hostname() -> str:
    return socket.gethostname()


def host_names(hostname: str) -> set[str]:
    """A hostname as it can appear: in full, and its first label."""
    return {n for n in (hostname, hostname.split(".")[0]) if n}


def distinctive(names: set[str]) -> set[str]:
    """The names worth looking for: not generic, not short enough to be an ordinary word."""
    return {n for n in names if len(n) >= MIN_NAME_CHARS and n.lower() not in GENERIC_NAMES}


def local_names(nodes: Path | None = None, hostname: str | None = None) -> set[str]:
    """Every local machine name, read now (a node list edited mid-run counts from the next check)."""
    return distinctive(node_names(nodes_file() if nodes is None else nodes)
                       | host_names(this_hostname() if hostname is None else hostname))


def _pattern(names: set[str]) -> re.Pattern | None:
    if not names:
        return None
    alts = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    return re.compile(rf"(?<![{NAME_CHAR}])(?:{alts})(?![{NAME_CHAR}])", re.IGNORECASE)


def found(text: str, names: set[str]) -> list[str]:
    """The names in text, whole and in any case, each once and spelled as the list spells it."""
    pat = _pattern(names)
    if pat is None:
        return []
    by_lower = {n.lower(): n for n in names}
    return sorted({by_lower[m.group(0).lower()] for m in pat.finditer(text)})


def redact(text: str, names: set[str], mark: str = "<machine name>") -> str:
    """text with every name replaced: for a refusal that is itself published."""
    pat = _pattern(names)
    return pat.sub(mark, text) if pat else text


def is_own_work(rel: str) -> bool:
    """The agent's own work, which it may word as it likes (the same rule as publicise.is_own_work)."""
    parts = PurePosixPath(rel).parts
    return "workspace" in parts or parts[-1] in AGENT_OWN_FILES


def in_file(rel: str, text: str, names: set[str]) -> list[str]:
    """The names in a file about to be public, found in its path or its text; none for the agent's own work."""
    if is_own_work(rel):
        return []
    return sorted(set(found(rel, names)) | set(found(text, names)))


def tracked(repo: Path, names: set[str]) -> dict[str, list[str]]:
    """Every tracked text file of repo (not the agent's own work) that names a machine, with the names."""
    if not names:
        return {}
    listed = subprocess.run(["git", "-C", str(repo), "ls-files", "-z"], capture_output=True, check=True).stdout
    out = {}
    for rel in filter(None, listed.decode().split("\0")):
        if is_own_work(rel):
            continue
        try:
            data = (repo / rel).read_bytes()
        except OSError:
            continue                              # deleted in the working tree: nothing there to publish
        if b"\0" in data[:8192]:
            hits = found(rel, names)              # binary: only its name can be read
        else:
            hits = in_file(rel, data.decode("utf-8", errors="replace"), names)
        if hits:
            out[rel] = hits
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] != "tracked":
        print("usage: machine_names.py tracked [repo]", file=sys.stderr)
        return EXIT_BROKEN_LIST
    repo = Path(argv[2] if len(argv) > 2 else ".")
    path = nodes_file()
    try:
        names = distinctive(node_names(path))
    except ValueError as e:
        print(e)
        return EXIT_BROKEN_LIST
    if not names:
        print(f"skip: no machine names in a local node list ({path})")
        return 0
    hits = tracked(repo, names)
    for rel, found_names in sorted(hits.items()):
        print(f"{rel}: {', '.join(found_names)}")
    return EXIT_FOUND if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
