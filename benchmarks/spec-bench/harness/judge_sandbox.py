"""The macOS sandbox a judge runs in: an allowlist, so nothing else exists for it.

A denylist names what matters and leaves everything nobody thought of open. This profile hides the
whole home directory, then re-opens only what the judge needs:
- read-write: its package folder, its private tool config (e.g. a CODEX_HOME), and its output folder;
- read-only: toolchains (node, the judge CLI) and the held-out suite's browsers;
- network: localhost only. The judge's model API is reached through egress_proxy.py on localhost,
  which forwards only to allowed hosts, so the public repo (which would un-blind every run) is
  unreachable.

Tools resolve real paths by stat()ing every ancestor, so ancestors of the allowed paths get
metadata-only access: they can be stat()ed, not read or listed.

The profile goes in a file outside every allowed path (sandbox-exec -f), so a judge running `ps`
sees a path it can't read, not a list of what's worth finding.
"""
from __future__ import annotations

from pathlib import Path


def _q(p: Path) -> str:
    return '"' + str(p).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _ancestors(paths: list[Path]) -> list[Path]:
    seen: list[Path] = []
    for p in paths:
        for a in p.parents:
            if a not in seen:
                seen.append(a)
    return seen


def profile(*, home: Path, rw: list[Path], ro: list[Path], hide: list[Path] = ()) -> str:
    """An SBPL profile. `hide` adds roots to deny besides home (e.g. a temp dir holding secrets)."""
    rw = [p.resolve() for p in rw]
    ro = [p.resolve() for p in ro]
    home = home.resolve()
    denied = " ".join(f"(subpath {_q(p)})" for p in [home, *(h.resolve() for h in hide)])
    meta = " ".join(f"(literal {_q(a)})" for a in _ancestors(rw + ro))
    return "".join([
        "(version 1)(allow default)",
        f"(deny file-read* file-write* {denied})",
        f"(allow file-read-metadata {meta})" if meta else "",
        # CoreFoundation reads this at every process start; it holds only the text encoding.
        f"(allow file-read-data (literal {_q(home / '.CFUserTextEncoding')}))",
        "".join(f"(allow file-read* (subpath {_q(p)}))" for p in ro),
        "".join(f"(allow file-read* file-write* (subpath {_q(p)}))" for p in rw),
        "(deny network-outbound)",
        '(allow network-outbound (remote ip "localhost:*"))',
        "(allow network-outbound (remote unix-socket))",
    ])
