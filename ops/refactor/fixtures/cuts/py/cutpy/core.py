"""The cuts project's Python module: one function with two cuts, a guard and a use, fully covered by py/test_core.py."""


def vcs(args):
    """Stands in for a version-control command: 0 on success, 1 when the path names a folder."""
    return 1 if args[1].endswith("/") else 0


def publish(repo, run, amend=False):
    """Record a run. The version-control calls are the cuts; the guard decides what a failure does; the return is the use."""
    path = f"{repo}/{run}"
    if amend:
        done = vcs(["amend", path])
    else:
        done = vcs(["add", path])
    if done != 0:
        return "failed"
    return f"ok:{path}"
