"""When a backup repository's target will be full, and whether the last good backup is stale. Pure functions (test_forecast.py)."""
from __future__ import annotations

SECONDS_PER_DAY = 86400.0
WINDOW_DAYS = 7              # the trajectory is the last week's growth
MIN_SPAN_DAYS = 1.0          # under a day of history there is no rate to speak of
PROVISIONAL_BELOW_DAYS = 7.0  # a rate from less than a full week is labelled as provisional
WARN_DAYS = 30               # warn when the target has less than a month of room
STALE_HOURS = 36
SECONDS_PER_HOUR = 3600.0
GB = 1_000_000_000


def _gb(n: float) -> str:
    return f"{n / GB:.1f} GB"


def forecast(history: list[dict], free_bytes: int, now: float) -> dict:
    """history: [{"t": epoch seconds, "bytes": repository size}], oldest first or not. The rate is the repository's growth between the oldest
    and newest point within the last week; days_left is the target's free space over that rate."""
    recent = sorted((p for p in history if now - p["t"] <= WINDOW_DAYS * SECONDS_PER_DAY), key=lambda p: p["t"])
    span = (recent[-1]["t"] - recent[0]["t"]) / SECONDS_PER_DAY if len(recent) >= 2 else 0.0
    if span < MIN_SPAN_DAYS:
        return {"status": "no-history", "days_left": None, "growth_per_day": None, "free_bytes": free_bytes,
                "message": f"not enough history yet to forecast capacity ({_gb(free_bytes)} free)"}
    growth = (recent[-1]["bytes"] - recent[0]["bytes"]) / span
    provisional = f" (provisional: {span:.0f} days of history)" if span < PROVISIONAL_BELOW_DAYS else ""
    if growth <= 0:
        return {"status": "ok", "days_left": None, "growth_per_day": growth, "free_bytes": free_bytes,
                "message": f"not growing over the last {span:.0f} days; {_gb(free_bytes)} free{provisional}"}
    days = free_bytes / growth
    warn = days < WARN_DAYS
    text = f"{days:.0f} days of room at {_gb(growth)} a day; {_gb(free_bytes)} free{provisional}"
    return {"status": "warn" if warn else "ok", "days_left": days, "growth_per_day": growth, "free_bytes": free_bytes,
            "message": ("less than a month left: " if warn else "") + text}


def staleness(last_good: float | None, now: float) -> dict:
    """Whether the last good backup is older than STALE_HOURS (or there never was one)."""
    if last_good is None:
        return {"status": "stale", "message": "no good backup yet"}
    hours = (now - last_good) / SECONDS_PER_HOUR
    if hours > STALE_HOURS:
        return {"status": "stale", "message": f"last good backup {hours:.0f} hours ago"}
    return {"status": "ok", "message": f"last good backup {hours:.0f} hours ago"}
