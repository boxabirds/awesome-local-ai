"""Mini project: a Python tool that reaches data through git (an audit hit in the Python-subprocess category)."""
import subprocess

RUN_PATHS = "runs"


def tracked_runs(repo):
    """Every tracked file under the runs folder, listed by git."""
    out = subprocess.run(["git", "-C", repo, "ls-files", RUN_PATHS], capture_output=True, text=True, check=True)
    return out.stdout.split()


def record_at(repo, rev, path):
    """A tracked file as it stood at a revision."""
    return subprocess.run(["git", "-C", repo, "show", f"{rev}:{path}"], capture_output=True, text=True, check=True).stdout
