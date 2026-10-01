"""What TensorFold's startup log says about the keep-prompt limit, and the pi context limit that follows from it.

TensorFold 0.6.0 (src/tensorfold/cli.py) prints one of:
  "[tensorfold] context window N tokens: the most one request can use in the X GiB memory budget and still keep its
   prompt for the next turn ..."                       (no --context: the window was fitted to keep prompts)
  "[tensorfold] requests up to N tokens keep their prompt for the next turn in the X GiB memory budget; a longer one
   is served, and its next turn prefills again"        (an explicit window larger than what keeps prompts)
and then always "[tensorfold] serving NAME at URL (...; context: N; ...)". With an explicit window and neither of the
first two lines, every request the window admits keeps its prompt.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FITTED = re.compile(r"\[tensorfold\] context window ([\d,]+) tokens: the most one request can use .*keep its prompt")
REQUESTS_UP_TO = re.compile(r"\[tensorfold\] requests up to ([\d,]+) tokens keep their prompt for the next turn")
SERVING = re.compile(r"\[tensorfold\] serving \S+ at \S+ \(.*context: (unlimited|[\d,]+);")
LOADED = re.compile(r"\[tensorfold\] serving \S+ at \S+ \(.*loaded in ([\d.]+)s\)")

# pi (pi-coding-agent settings-manager.js, 0.86-0.87) compacts once the context passes contextWindow - reserveTokens,
# reserveTokens 16384 by default, and every request asks for maxTokens = OUTPUT_LIMIT reply tokens, which TensorFold
# reserves out of its window before prefill (docs/api.md, "Context and errors").
PI_RESERVE_TOKENS = 16_384
OUTPUT_LIMIT = 32_768
# mlx-serve's runs use 131072, the context every other Flash-Next combination is compared at.
CONTEXT_CEILING = 131_072


def _int(s: str) -> int:
    return int(s.replace(",", ""))


def is_serving(log: str) -> bool:
    return SERVING.search(log) is not None


def keep_limit(log: str) -> dict:
    """{"keep_limit": tokens or None, "source", "line", "context_window", "load_seconds"} from a server log."""
    loaded = LOADED.search(log)
    return {**_keep(log), "load_seconds": float(loaded.group(1)) if loaded else None}


def _keep(log: str) -> dict:
    m = SERVING.search(log)
    window = None if (m is None or m.group(1) == "unlimited") else _int(m.group(1))
    for rx, source in ((FITTED, "fitted"), (REQUESTS_UP_TO, "requests-up-to")):
        hit = rx.search(log)
        if hit:
            line = log[hit.start():].splitlines()[0]
            return {"keep_limit": _int(hit.group(1)), "source": source, "line": line,
                    "context_window": window if window is not None else _int(hit.group(1))}
    if window is not None:
        return {"keep_limit": window, "source": "serving-context", "line": m.group(0), "context_window": window}
    return {"keep_limit": None, "source": "none", "line": "", "context_window": window}


def pi_context_limit(keep: int, output_limit: int = OUTPUT_LIMIT, reserve: int = PI_RESERVE_TOKENS,
                     ceiling: int = CONTEXT_CEILING) -> int:
    """The largest pi contextWindow whose compaction point plus a full reply stays inside what the server keeps."""
    return min(ceiling, keep - output_limit + reserve)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("server_log", type=Path)
    ap.add_argument("--wait-check", action="store_true", help="exit 0 if the log shows the server is serving")
    a = ap.parse_args(argv)
    text = a.server_log.read_text(errors="replace")
    if a.wait_check:
        return 0 if is_serving(text) else 1
    k = keep_limit(text)
    if k["keep_limit"] is not None:
        k["pi_context_limit"] = pi_context_limit(k["keep_limit"])
    print(json.dumps(k))
    return 0 if k["keep_limit"] is not None else 1


if __name__ == "__main__":
    sys.exit(main())
