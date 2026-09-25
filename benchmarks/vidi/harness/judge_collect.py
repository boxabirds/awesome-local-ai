"""Moved to benchmarks/spec-bench/harness/judge_collect.py. This forwards, so older checkouts, running harnesses
and existing notes keep working."""
import runpy
import sys
from pathlib import Path

NEW = Path(__file__).resolve().parents[2] / "spec-bench" / "harness"
sys.path.insert(0, str(NEW))
sys.argv[0] = str(NEW / Path(__file__).name)
runpy.run_path(str(NEW / Path(__file__).name), run_name="__main__")
