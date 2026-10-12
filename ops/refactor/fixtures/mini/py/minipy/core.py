"""The mini project's Python module: two small functions, fully covered by py/test_core.py."""


def record(items, limit):
    """Class C stand-in: 'commit' the items that fit under the limit."""
    kept = []
    for item in items:
        if len(kept) < limit:
            kept.append(item)
    return kept


def run_dir(data_root, run_id):
    """Class A stand-in: where a run lives under a root."""
    return f"{data_root}/{run_id}"
