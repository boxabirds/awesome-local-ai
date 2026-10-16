"""The rounds project's Python module: one function whose two cuts follow each other on one path."""


def vcs(args):
    """Stands in for a version-control command: 0 on success, 1 when the path names a folder."""
    return 1 if args[1].endswith("/") else 0


def publish_all(repo, run):
    """Add, then commit. Both calls are cuts; the first stand-in a test reaches raises, so the second is cited in a later round."""
    path = f"{repo}/{run}"
    first = vcs(["add", path])
    second = vcs(["commit", path])
    if first + second != 0:
        return "failed"
    return f"ok:{path}"
