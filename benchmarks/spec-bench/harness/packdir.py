"""Where a benchmark pack lives: spec/, scope/, prompts/ and an optional held-out acceptance/ suite.

A pack is named by its public directory, benchmarks/<name> (e.g. benchmarks/vidi, benchmarks/todoodle).
Its contents may be private (github.com/boxabirds/awesome-local-ai-bench-private, packs/<name>) so they
stay out of public training data. Resolution order for pack <name>:
  1. $SPEC_BENCH_PACK_DIR, if set (for vidi, the older $VIDI_PACK_DIR too);
  2. a checkout of the private repo next to this public one: packs/<name>, if it has spec/;
  3. benchmarks/<name> in this repo.

    python3 packdir.py [--pack benchmarks/vidi] [spec|acceptance|scope|prompts]   # the resolved path
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ENV = "SPEC_BENCH_PACK_DIR"
LEGACY_ENV = {"vidi": "VIDI_PACK_DIR"}
PRIVATE_REPO = "awesome-local-ai-bench-private"
PRIVATE_PACKS = Path("packs")
REPO_ROOT = Path(__file__).resolve().parents[3]  # benchmarks/spec-bench/harness -> repo
DEFAULT_PACK = "benchmarks/vidi"


def public_dir(pack: str | Path = DEFAULT_PACK) -> Path:
    """The pack's directory in this repo: a repo-relative path, an absolute path, or a bare name."""
    p = Path(pack)
    if p.is_absolute():
        return p.resolve()
    if len(p.parts) == 1:
        p = Path("benchmarks") / p
    return (REPO_ROOT / p).resolve()


def name(pack: str | Path = DEFAULT_PACK) -> str:
    return public_dir(pack).name


def private_checkout() -> Path:
    return REPO_ROOT.parent / PRIVATE_REPO


def resolve(pack: str | Path = DEFAULT_PACK) -> Path:
    n = name(pack)
    for env in (ENV, LEGACY_ENV.get(n)):
        if env and os.environ.get(env):
            return Path(os.environ[env]).expanduser().resolve()
    private = private_checkout() / PRIVATE_PACKS / n
    if (private / "spec").is_dir():
        return private
    return public_dir(pack)


def private_root(pack: Path) -> Path | None:
    """The private checkout that holds the pack, which the agent sandbox must hide. None for an
    in-repo pack, since the public repo is hidden already."""
    if pack.parent.name == PRIVATE_PACKS.name:
        return pack.parent.parent
    return None


def main(argv: list[str]) -> None:
    pack = DEFAULT_PACK
    if argv[:1] == ["--pack"]:
        pack, argv = argv[1], argv[2:]
    part = argv[0] if argv else ""
    print(resolve(pack) / part if part else resolve(pack))


if __name__ == "__main__":
    main(sys.argv[1:])
