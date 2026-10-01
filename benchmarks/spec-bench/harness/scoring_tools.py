"""scoring_tools.py — the tools a re-score needs (uv, node, npm, npx), found without relying on the caller's PATH.

run.sh remembers the environment it starts each run with (PATH, and Playwright's platform override where
playwright-platform.sh set one): every run on the machine found its tools there. A re-score (finalize.py,
finalize_pending.py) looks on that PATH first and the caller's after it, so one started from a shell without the
login profile (ssh, cron, a dashboard) finds the same tools the runs did. A tool that is nowhere is named; that is
a reason to try again later, not a result.

What is remembered holds home paths, so it stays on this machine: in the scoring home (the bench home's scoring/,
which the agents' sandbox hides with the rest of the bench home), never in a run's directory, which is committed.

    python3 scoring_tools.py remember     # run.sh, at every start

Why: in the week of 28 Sep 2026 finished runs ended unscored because `uv` or `node` was not on the PATH of the
process that ran the re-score. Tests: test_scoring_tools.py.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

HOME_ENV = "SPEC_BENCH_SCORING_HOME"      # tests point it at a directory of their own (conftest.py)
HOME_DIR = "scoring"
ENV_FILE = "scoring-env.json"
OWNER_ONLY = 0o600
TOOLS = ("uv", "node", "npm", "npx")
PATH = "PATH"
# What run.sh's environment decides about a scoring, beyond where the tools are.
KEPT = (PATH, "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE")


def home() -> Path:
    """Where this machine keeps what its re-scores need: the remembered environment, the suites at their tags."""
    if os.environ.get(HOME_ENV):
        return Path(os.environ[HOME_ENV]).expanduser()
    import hostenv
    return hostenv.bench_home() / HOME_DIR


def remember(environ: dict | None = None) -> Path:
    environ = os.environ if environ is None else environ
    f = home() / ENV_FILE
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f.name + f".{os.getpid()}")
    tmp.write_text(json.dumps({k: environ[k] for k in KEPT if environ.get(k)}, indent=2) + "\n")
    tmp.chmod(OWNER_ONLY)
    tmp.replace(f)
    return f


def remembered() -> dict:
    try:
        doc = json.loads((home() / ENV_FILE).read_text())
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in doc.items() if k in KEPT and isinstance(v, str)} if isinstance(doc, dict) else {}


def environment(environ: dict | None = None) -> dict:
    """The caller's environment, with the remembered PATH ahead of its own (each directory once) and the other
    remembered settings where the caller has none of its own."""
    env = dict(os.environ if environ is None else environ)
    kept = remembered()
    dirs = [d for d in [*kept.get(PATH, "").split(os.pathsep), *env.get(PATH, "").split(os.pathsep)] if d]
    env[PATH] = os.pathsep.join(dict.fromkeys(dirs))
    for k, v in kept.items():
        env.setdefault(k, v)
    return env


def resolve(env: dict) -> dict[str, str | None]:
    return {t: shutil.which(t, path=env.get(PATH, "")) for t in TOOLS}


def missing(env: dict) -> list[str]:
    return [t for t, where in resolve(env).items() if where is None]


def main(argv: list[str]) -> int:
    if argv != ["remember"]:
        print(__doc__, file=sys.stderr)
        return 2
    remember()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
