#!/usr/bin/env python3
"""Thermal pressure on Apple silicon, and the noise floors that go with it.

Vendored deliberately. These four symbols previously came from a separate
private checkout via a ``sys.path.insert`` hack, which meant the benchmarks
could not run on anyone else's machine -- and one of them failed hard rather
than degrading when the import was missing. A public repo cannot depend on an
unrelated private one, so the code lives here, with the reasoning that produced
the constants.

Stdlib only, like every other harness in this directory.

Usage:
    from thermal import thermal_pressure, wait_for_thermal
    from thermal import DRIFT_FLOOR_PCT, MAX_IQR_PCT
"""

from __future__ import annotations

import ctypes
import ctypes.util
import time

# Repeat runs of an identical request drifted 16.1 -> 16.3 -> 19.2 s,
# monotonically worse, while token counts stayed byte-stable. Machine-side,
# probably thermal. Differences below this are not real, and a harness that
# reports one as a finding is lying.
DRIFT_FLOOR_PCT = 20.0

# Refuse to report a median whose spread exceeds this: the run is too unstable
# to support a conclusion.
MAX_IQR_PCT = 25.0

_THERMAL_KEY = b"com.apple.system.thermalpressurelevel"
_THERMAL_LEVELS = {0: "nominal", 1: "moderate", 2: "heavy",
                   3: "trapping", 4: "sleeping"}

# Ordered best to worst; used to decide whether a level is "good enough".
THERMAL_ORDER = list(_THERMAL_LEVELS.values())


def thermal_pressure() -> str:
    """Current thermal pressure level, or 'unknown'. No sudo required.

    Reads the Darwin notification directly rather than shelling out, so it is
    cheap enough to poll during a run. Returns 'unknown' on any failure --
    including on non-macOS -- so callers degrade instead of crashing.
    """
    try:
        lib = ctypes.CDLL(ctypes.util.find_library("System") or "/usr/lib/libSystem.dylib")
        tok = ctypes.c_int()
        if lib.notify_register_check(ctypes.c_char_p(_THERMAL_KEY), ctypes.byref(tok)) != 0:
            return "unknown"
        lib.notify_get_state.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint64)]
        state = ctypes.c_uint64()
        if lib.notify_get_state(tok, ctypes.byref(state)) != 0:
            return "unknown"
        return _THERMAL_LEVELS.get(state.value, f"raw:{state.value}")
    except Exception:  # noqa: BLE001
        return "unknown"


def wait_for_thermal(target: str = "nominal", timeout_s: int = 1800,
                     poll_s: float = 15.0, verbose: bool = True) -> str:
    """Block until thermal pressure drops to `target` (or better), or timeout.

    Sustained inference drives an Apple silicon laptop to `heavy` and it stays
    there for minutes after the load stops. Without a cool-down gate, every
    block after the first measures a throttled machine, and a blocked A/B
    design silently turns thermal recovery into a fake model effect. That is
    not hypothetical: interleaving instead of cooling produced a 3x error in
    earlier work on this hardware.

    Returns the level actually reached; the caller decides whether to proceed
    and must record it alongside the results either way.
    """
    want = THERMAL_ORDER.index(target)
    t0 = time.monotonic()
    last = None
    while time.monotonic() - t0 < timeout_s:
        lvl = thermal_pressure()
        if lvl != last and verbose:
            print(f"    thermal: {lvl} (+{time.monotonic() - t0:.0f}s)", flush=True)
            last = lvl
        if lvl not in THERMAL_ORDER or THERMAL_ORDER.index(lvl) <= want:
            return lvl
        time.sleep(poll_s)
    return thermal_pressure()


if __name__ == "__main__":
    print(thermal_pressure())
