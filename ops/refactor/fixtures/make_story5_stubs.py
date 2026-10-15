"""Rebuild fixtures/real/story5/: the three dbench files as story 5's delete-first run left them (15 Oct 2026).

That run stubbed eleven functions with `todo!()` in a working copy and never committed it, so the stubbed files are
rebuilt here from the pinned commit. Each listed function keeps its signature and its attributes; its body becomes
`todo!()`. Everything between functions (the doc comments of the next item included) is kept as it stood.

    uv run ops/refactor/fixtures/make_story5_stubs.py            # rewrite fixtures/real/story5/
    uv run ops/refactor/fixtures/make_story5_stubs.py --check    # fail when the committed files differ from a rebuild

A refresh is deliberate: change PINNED_COMMIT and say why in the note it writes.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

PINNED_SHORT = "e89785fbb"
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OUT = HERE / "real" / "story5"
SOURCE_DIR = "tools/dbench/src"
STUBBED = {                                   # file -> functions (by name, in file order) that story 5 stubbed
    "collect.rs": ["kind", "name", "parse_name", "resolve", "manifest"],
    "collector.rs": ["plan", "store_dir", "pull_file", "collect_run", "wanted"],
    "server.rs": ["file_of"],
}
STUB_BODY = "todo!()"
NOTE = "NOTE.md"


def git_show(commit: str, path: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), "show", f"{commit}:{path}"], capture_output=True, text=True, check=True).stdout


def full_hash(commit: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), "rev-parse", commit], capture_output=True, text=True, check=True).stdout.strip()


def body_span(text: str, name: str) -> tuple[int, int]:
    """(index after the opening brace, index of the closing brace) of the first `fn name` body. Strings, chars and
    comments are skipped so a brace inside one does not count."""
    m = re.search(rf"\bfn\s+{re.escape(name)}\b", text)
    if not m:
        raise ValueError(f"no fn {name}")
    i, depth, paren = m.end(), 0, 0
    while i < len(text):
        c = text[i]
        if text.startswith("//", i):
            i = text.index("\n", i)
            continue
        if text.startswith("/*", i):
            i = text.index("*/", i) + 2
            continue
        if c == '"':
            i += 1
            while text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        elif c == "'" and re.match(r"'(\\.|[^\\'])'", text[i:i + 4]):
            i += 3 if text[i + 1] != "\\" else 4
        elif c in "([":
            paren += 1
        elif c in ")]":
            paren -= 1
        elif c == "{" and (paren == 0 or depth > 0):
            if depth == 0:
                start = i + 1
            depth += 1
        elif c == "}" and (paren == 0 or depth > 0):
            depth -= 1
            if depth == 0:
                return start, i
        elif c == ";" and paren == 0 and depth == 0:
            raise ValueError(f"fn {name} has no body")
        i += 1
    raise ValueError(f"fn {name}: unbalanced braces")


def stub_file(text: str, names: list[str]) -> str:
    for name in names:
        start, end = body_span(text, name)
        text = text[:start] + f"\n    {STUB_BODY}\n" + text[end:]
    return text


def build(commit: str) -> dict[str, str]:
    files = {f: stub_file(git_show(commit, f"{SOURCE_DIR}/{f}"), names) for f, names in STUBBED.items()}
    listing = "; ".join(f"{f}: " + ", ".join(n) for f, n in STUBBED.items())
    files[NOTE] = (
        "# Story 5's stubbed files (rebuilt)\n\n"
        f"Pinned at `{commit}` (the corpus commit that follows `f0066f55b`, the code story 5's delete-first run started from).\n"
        "Story 5 stubbed these eleven functions with `todo!()` in a working copy and did not commit it, so these files are\n"
        f"rebuilt by `fixtures/make_story5_stubs.py` from the pinned commit: {listing}.\n"
        "Signatures and the text between functions are as they stood; only the eleven bodies changed.\n\n"
        "They are fixtures for the stub detector (`is_stub`): all eleven must read as stubs. A refresh is deliberate:\n"
        "change `PINNED_SHORT` in the script, run it, and say why here.\n"
    )
    return files


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    commit = full_hash(PINNED_SHORT)
    files = build(commit)
    if args.check:
        stale = [f for f, t in files.items() if not (OUT / f).exists() or (OUT / f).read_text() != t]
        print("stale: " + ", ".join(stale) if stale else "fixtures match a rebuild")
        return 1 if stale else 0
    OUT.mkdir(parents=True, exist_ok=True)
    for f, t in files.items():
        (OUT / f).write_text(t)
    print(f"wrote {len(files)} files to {OUT} from {commit}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
