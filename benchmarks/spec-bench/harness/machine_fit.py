"""machine_fit.py <run-dir> — is the machine fit to resume a run that the swap or memory guard stopped?

When a guard stops a story (drive.stop_if_machine_unfit), it leaves machine-unfit.json in the run dir and the
harness exits EXIT_MACHINE_UNFIT, which dbench answers by waiting, not by counting a restart. run.sh runs this
first, before anything that takes memory (the preflight's builds, the model server): while the machine hasn't
recovered it exits EXIT_MACHINE_UNFIT again, and once it has, it removes the marker and the run goes on.

Recovered: swap back to within SWAP_RECOVERED_MARGIN_GB of what it was when the stopped story started, and at
least FREE_RECOVERED_PCT of memory free (drive's MEM_REAP_PCT: below that the harness already reaps orphans).
Why: 1 Oct 2026, mlx-serve v2-r2 story 9; the guard said "check memory before resuming", but its exit looked like
a crash and dbench restarted the run 30 s later without looking. Tests: test_machine_fit.py.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

EXIT_MACHINE_UNFIT = 75            # EX_TEMPFAIL: try again later (tools/dbench/src/runner.rs has the same)
UNFIT_FILE = "machine-unfit.json"
SWAP_RECOVERED_MARGIN_GB = 1.0     # swap rarely drops all the way back; this much above the story's start is fine
FREE_RECOVERED_PCT = 30            # drive.MEM_REAP_PCT


def record_unfit(run: Path, story: int, reason: str, swap_start_gb: float | None, swap_max_gb: float | None,
                 free_min_pct: float | None) -> None:
    """The marker a guard leaves: which story it stopped, why, and the swap the story started with."""
    (Path(run) / UNFIT_FILE).write_text(json.dumps(
        {"at": time.time(), "story": story, "reason": reason, "swap_start_gb": swap_start_gb,
         "swap_max_gb": swap_max_gb, "free_min_pct": free_min_pct}, indent=2))


def check(run: Path, swap_gb: float, free_pct: float | None) -> tuple[bool, str]:
    """(fit, why not). Fit when there's no marker, or the machine has recovered from what the marker records."""
    f = Path(run) / UNFIT_FILE
    if not f.exists():
        return True, ""
    m = json.loads(f.read_text())
    limit = (m.get("swap_start_gb") or 0.0) + SWAP_RECOVERED_MARGIN_GB
    short = []
    if swap_gb > limit:
        short.append(f"swap {swap_gb:.1f} GB, above the {limit:.1f} GB it may be")
    if free_pct is not None and free_pct < FREE_RECOVERED_PCT:
        short.append(f"free memory {free_pct:.0f}%, below {FREE_RECOVERED_PCT}%")
    if not short:
        return True, ""
    return False, f"story {m.get('story')} was stopped ({m.get('reason')}); still {' and '.join(short)}"


def readings() -> tuple[float, float | None]:
    """(swap used GB, free memory %) now, as the guards read them."""
    import drive
    import hostenv
    return drive.swap_used_gb(), hostenv.mem_free_pct()


def main(argv: list[str]) -> int:
    run = Path(argv[0])
    swap, free = readings()
    ok, why = check(run, swap, free)
    if not ok:
        print(f"MACHINE UNFIT: {why}. Waiting for it to recover.", file=sys.stderr, flush=True)
        return EXIT_MACHINE_UNFIT
    if (run / UNFIT_FILE).exists():
        print(f"machine fit again (swap {swap:.1f} GB, free {'?' if free is None else f'{free:.0f}'}%): resuming",
              flush=True)
        (run / UNFIT_FILE).unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
