"""Where the Vidi pack lives: spec/, scope/, prompts/ and the held-out acceptance/ suite.

The pack is private (github.com/boxabirds/awesome-local-ai-bench-private) so it stays out of
public training data. Resolution order:
  1. $VIDI_PACK_DIR, if set;
  2. a checkout of the private repo next to this public one;
  3. benchmarks/vidi in this repo (the layout before the move; kept so older checkouts still run).

    python3 packdir.py [spec|acceptance|scope|prompts]   # prints the resolved path (for run.sh)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ENV = "VIDI_PACK_DIR"
PRIVATE_REPO = "awesome-local-ai-bench-private"
PACK_REL = Path("packs") / "vidi"
LEGACY = Path(__file__).resolve().parent.parent  # benchmarks/vidi


def resolve(legacy: Path = LEGACY) -> Path:
    if os.environ.get(ENV):
        return Path(os.environ[ENV]).expanduser().resolve()
    public_root = legacy.parent.parent
    sibling = public_root.parent / PRIVATE_REPO / PACK_REL
    if (sibling / "spec").is_dir():
        return sibling
    return legacy


def private_root(pack: Path) -> Path | None:
    """The private checkout that holds the pack, which the agent sandbox must hide. None for an
    in-repo pack, since the public repo is hidden already."""
    if pack.parent.name == "packs":
        return pack.parent.parent
    return None


if __name__ == "__main__":
    part = sys.argv[1] if len(sys.argv) > 1 else ""
    print(resolve() / part if part else resolve())
