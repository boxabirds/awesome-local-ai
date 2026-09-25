# /// script
# requires-python = ">=3.11"
# ///
"""Did an agent touch anything outside its own workspace?

Reads agent transcripts, lists every path a tool call touched, and sorts each path into one of three
groups. Supported transcripts are Claude Code session and subagent JSONL (the files under
~/.claude/projects/...) and pi event logs.
- allowed: the agent's workspace and other paths you permit (its brief, the remote wrapper, scratch dirs);
- sensitive: counted as a PEEK. These are the pack (spec and held-out suite), the repo, other runs,
  results and audits;
- review: any other path outside the allowed set, plus a `../` that climbs out of the workspace.

    uv run peek_audit.py --workspace <ws> [--allow <path>]... [--sensitive <path>]... transcript.jsonl...

Exits 1 if any peek is found. The default sensitive set is the resolved pack's checkout, this repo, the
harness work root and the Opus reference folders.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# An absolute or ~ path, not the tail of a relative one (`../x` is caught by CLIMB_RE instead).
PATH_RE = re.compile(r"(?<![\w.~/*-])(?:~|/)[^\s\"'`;|&<>(){}]+")
# Shell assignments (W=/path) and their uses ($W, ${W}, "$W"), expanded before paths are read.
ASSIGN_RE = re.compile(r"(?:^|[;&|\s])([A-Za-z_]\w*)=(\"[^\"]*\"|'[^']*'|[^\s;&|]+)")
# OS locations every tool touches; not evidence of anything.
SYSTEM_PREFIXES = ("/dev/", "/usr/", "/bin/", "/sbin/", "/etc/", "/opt/homebrew/", "/System/", "/proc/", "/var/folders/")
# A relative path that climbs (../x), and the directory a command cd's into first.
CLIMB_RE = re.compile(r"(?<![\w./~-])((?:\.\./)+[^\s\"'`;|&<>(){}]*)")
CD_RE = re.compile(r"(?:^|[;&|\s])cd\s+(\"[^\"]+\"|'[^']+'|[^\s;&|]+)")
# Tool-input fields that name a path directly.
PATH_FIELDS = ("file_path", "path", "notebook_path", "cwd")
# Tool-input fields holding shell or free text that may mention paths.
TEXT_FIELDS = ("command", "pattern", "glob")


@dataclass
class Finding:
    tool: str
    path: str
    source: str


@dataclass
class Report:
    tool_calls: int = 0
    peeks: list[Finding] = field(default_factory=list)
    review: list[Finding] = field(default_factory=list)


def tool_calls(line: dict):
    """(tool name, input dict) for every tool call in one transcript line, in either format."""
    if line.get("type") == "tool_execution_start":  # pi
        yield line.get("toolName", "?"), line.get("args") or {}
        return
    msg = line.get("message") or {}
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, list):  # Claude Code
        for c in content:
            if isinstance(c, dict) and c.get("type") == "tool_use":
                yield c.get("name", "?"), c.get("input") or {}


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?\n\s*\2\s*(?:\n|$)", re.S)


def strip_heredocs(cmd: str) -> str:
    """Heredoc bodies are file contents being written, not paths being read."""
    return HEREDOC_RE.sub("\n", cmd)


def expand_vars(cmd: str) -> str:
    for name, value in ASSIGN_RE.findall(cmd):
        value = value.strip("\"'")
        for ref in (f'"${{{name}}}"', f'"${name}"', f"${{{name}}}", f"${name}"):
            cmd = cmd.replace(ref, value)
    return cmd


def meaningful(p: str) -> bool:
    """A real path, not a glob fragment ('/*.ts', '//') or an OS location."""
    return bool(re.search(r"[A-Za-z0-9]", p)) and p not in ("/dev", "/tmp/") and not p.startswith(SYSTEM_PREFIXES)


def climbs_in(cmd: str) -> tuple[list[str], list[str]]:
    """(resolved paths, unresolved climbs) for ../ paths in a shell command, resolved against its first cd."""
    cmd = expand_vars(strip_heredocs(cmd))
    cd = CD_RE.search(cmd)
    base = cd.group(1).strip("\"'") if cd else None
    resolved, unresolved = [], []
    quoted = {m.group(0) for m in re.finditer(r"\"[^\"]*\"|'[^']*'", cmd)}
    in_quotes = lambda rel: any(rel in q for q in quoted)  # noqa: E731
    for rel in CLIMB_RE.findall(cmd):
        if in_quotes(rel):  # code or a search pattern, not a path the command opens
            unresolved.append(rel)
        elif base and base.startswith("/"):
            resolved.append(os.path.normpath(os.path.join(base, rel)))
        else:
            unresolved.append(rel)
    return resolved, unresolved


def paths_in(inp: dict) -> list[str]:
    out = []
    for k in PATH_FIELDS:
        v = inp.get(k)
        if isinstance(v, str) and v.startswith(("/", "~")):
            out.append(v)
    for k in TEXT_FIELDS:
        v = inp.get(k)
        if isinstance(v, str):
            out += PATH_RE.findall(expand_vars(strip_heredocs(v)))
    return [p for p in out if meaningful(p)]


def under(p: str, roots: list[str]) -> bool:
    p = p.rstrip("/")
    return any(p == r or p.startswith(r.rstrip("/") + "/") for r in roots)


def audit(transcripts: list[Path], allowed: list[str], sensitive: list[str]) -> Report:
    home = str(Path.home())
    norm = lambda p: p.replace("~", home, 1) if p.startswith("~") else p  # noqa: E731
    allowed = [norm(a) for a in allowed]
    sensitive = [norm(s) for s in sensitive]
    r = Report()
    for t in transcripts:
        for raw in t.read_text(errors="replace").splitlines():
            try:
                line = json.loads(raw)
            except json.JSONDecodeError:
                continue
            for name, inp in tool_calls(line):
                r.tool_calls += 1
                for p in paths_in(inp):
                    p = norm(p)
                    if under(p, allowed):
                        continue
                    (r.peeks if under(p, sensitive) else r.review).append(Finding(name, p, t.name))
                cmd = inp.get("command")
                if isinstance(cmd, str):
                    resolved, unresolved = climbs_in(cmd)
                    for p in resolved:
                        if not under(p, allowed):
                            (r.peeks if under(p, sensitive) else r.review).append(Finding(name, p, t.name))
                    for rel in unresolved:
                        r.review.append(Finding(name, f"{rel} (no known base) in: {cmd[:120]}", t.name))
    return r


def default_sensitive() -> list[str]:
    import packdir
    here = Path(__file__).resolve().parent
    repo = here.parent.parent.parent
    pack = packdir.resolve()
    out = [str(repo), str(packdir.private_root(pack) or pack)]
    home = Path.home()
    import hostenv
    out += [str(hostenv.bench_home()), str(home / ".dbench")]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("transcripts", nargs="+", type=Path)
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--allow", action="append", default=[], help="extra allowed path (brief, remote wrapper, scratch)")
    ap.add_argument("--sensitive", action="append", help="replaces the default sensitive set")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    r = audit(a.transcripts, allowed=[a.workspace, *a.allow], sensitive=a.sensitive or default_sensitive())
    if a.json:
        print(json.dumps({"tool_calls": r.tool_calls, "peeks": [f.__dict__ for f in r.peeks],
                          "review": [f.__dict__ for f in r.review]}, indent=2))
    else:
        print(f"{r.tool_calls} tool calls; {len(r.peeks)} peeks; {len(r.review)} to review")
        for f in r.peeks:
            print(f"  PEEK   {f.tool}: {f.path}  ({f.source})")
        for f in r.review:
            print(f"  review {f.tool}: {f.path}  ({f.source})")
    sys.exit(1 if r.peeks else 0)


if __name__ == "__main__":
    main()
