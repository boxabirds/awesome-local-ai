"""drive.main reads the story's held-out result after its other recording steps; nothing in between may rebind it.

30 Sep 2026: the accounting change wrote `acc = rec["time_split"]["accounting"]` between the held-out scoring
(`acc = gates.accept(...)`) and `own = acc["by_story"]...`, so every story crashed with KeyError: 'by_story'
after scoring and before its record was saved; mlx-serve v2-r2 lost story 4 three times. This test reads
drive.py's source, so it runs in milliseconds and fails on that version (checked against b4340cbf's drive.py).
test_pipeline.py checks the same end to end."""
import ast
import subprocess
from pathlib import Path

DRIVE = Path(__file__).with_name("drive.py")
RESULT = "acc"                 # the name drive.main gives the story's held-out result
READ_KEY = "by_story"


def _main(source: str) -> ast.FunctionDef:
    return next(n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == "main")


def last_binding_before_read(source: str) -> str:
    """What the held-out result's name was last bound to before drive.main reads acc["by_story"]."""
    main = _main(source)
    read = min(n.lineno for n in ast.walk(main) if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Name)
               and n.value.id == RESULT and isinstance(n.slice, ast.Constant) and n.slice.value == READ_KEY)
    binds = [n for n in ast.walk(main) if isinstance(n, ast.Assign) and n.lineno < read
             and any(isinstance(t, ast.Name) and t.id == RESULT for t in n.targets)]
    return ast.unparse(max(binds, key=lambda n: n.lineno).value)


def test_the_held_out_result_is_still_the_scorings_when_drive_reads_it():
    assert last_binding_before_read(DRIVE.read_text()).startswith("gates.accept(")


def test_the_check_catches_the_30_sep_crash():
    """The same check against the drive.py that crashed, so this test can't pass vacuously."""
    old = subprocess.run(["git", "show", "b4340cbf:benchmarks/spec-bench/harness/drive.py"], cwd=DRIVE.parent,
                         capture_output=True, text=True)
    if old.returncode != 0:
        import pytest
        pytest.skip("b4340cbf is not in this checkout's history")
    assert last_binding_before_read(old.stdout) == "rec['time_split']['accounting']"
