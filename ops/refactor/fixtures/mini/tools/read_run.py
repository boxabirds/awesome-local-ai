"""Mini project: reads a tracked run folder by path in the working tree (an audit hit in the tracked-path category)."""
import json
from pathlib import Path


def score_of(repo, run):
    """The score of record of a run, read from the checkout's tracked runs folder."""
    return json.loads((Path(repo) / "runs" / run / "metrics.json").read_text())["passed"]
