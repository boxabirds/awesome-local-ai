"""The refactor-method tool's own tests. Written before the tool (story 1 of the data-separation epic): each section
names the test cases (TC-nn) of the design's test strategy it covers.

Run with: uv run --with pytest python -m pytest -q ops/refactor
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import pytest

import refactor as R

USE_CASE_IDS = [f"U{n}" for n in range(1, 15)]


def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def write_stage(root: Path, stage: str) -> None:
    """A stage file for a hand-built root. From Proved on it carries the proof of the root's touched set, as a real move to Proved
    records (without one the stage reads as unproved and goes back to Matrices: E-STAGE-DIGEST-MISSING)."""
    touched = root / "ops/refactor/touched_set.toml"
    entries = tomllib.loads(touched.read_text()).get("entry", []) if touched.exists() else []
    proved = R.proof_of(entries) if R.STAGES.index(stage) >= R.STAGES.index("Proved") else None
    write(root, "ops/refactor/stage.toml", R.render_stage(stage, [], proved))


def make_root(tmp_path: Path, assignments: str = "", touched: str = "") -> Path:
    """A repository skeleton holding only the tool's own data files."""
    lines = ["[use_cases]"] + [f'{u} = "use case {u}"' for u in USE_CASE_IDS]
    write(tmp_path, "ops/refactor/use_cases.toml", "\n".join(lines) + "\n")
    write(tmp_path, "ops/refactor/assignments.toml", assignments)
    write(tmp_path, "ops/refactor/touched_set.toml", touched)
    return tmp_path


def lister(**per_language: list[str]):
    """A stand-in for the runners: {language: ids}."""
    listed = {lang: set(ids) for lang, ids in per_language.items()}
    return lambda root: listed


def codes(result: R.Result) -> list[str]:
    return [p.code for p in result.problems]


# ---- register (TC-01 to TC-10) ------------------------------------------------------------------------------------

SIX_ASSIGNED = """
[assignments]
U1 = ["python:a.py::t1", "python:a.py::t2"]
U2 = ["python:b.py::t1", "python:b.py::t2"]
U3 = ["python:c.py::t1", "python:c.py::t2"]
"""
SIX_LISTED = ["a.py::t1", "a.py::t2", "b.py::t1", "b.py::t2", "c.py::t1", "c.py::t2"]


def test_tc01_all_tests_assigned_once_gives_counts_per_use_case(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED)
    result = R.check_register(root, lister(python=SIX_LISTED))
    assert result.exit_code == R.EXIT_OK and result.problems == []
    assert result.data["counts"] == {"U1": 2, "U2": 2, "U3": 2}


def test_tc02_a_test_in_no_use_case_is_unassigned(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED)
    result = R.check_register(root, lister(python=SIX_LISTED + ["d.py::t1"]))
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems] == [("E-UNASSIGNED", "python:d.py::t1")]


def test_tc03_a_test_under_two_use_cases_is_a_duplicate_naming_both(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED.replace('U2 = ["python:b.py::t1"', 'U2 = ["python:a.py::t1", "python:b.py::t1"'))
    result = R.check_register(root, lister(python=SIX_LISTED))
    assert result.exit_code == R.EXIT_FAIL
    dup = [p for p in result.problems if p.code == "E-DUPLICATE"]
    assert len(dup) == 1 and dup[0].subject == "python:a.py::t1" and "U1" in dup[0].detail and "U2" in dup[0].detail


def test_tc04_an_assignment_that_no_runner_lists_is_stale(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED)
    result = R.check_register(root, lister(python=SIX_LISTED[:-1]))
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems] == [("E-STALE", "python:c.py::t2")]


def test_tc05_an_assignment_under_an_unknown_use_case_is_refused(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED + 'U15 = ["python:d.py::t1"]\n')
    result = R.check_register(root, lister(python=SIX_LISTED + ["d.py::t1"]))
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems if p.code == "E-UNKNOWN-USE-CASE"] == [("E-UNKNOWN-USE-CASE", "U15")]


def test_tc06_an_unfit_test_with_a_decision_and_a_reason_is_accepted_and_reported(tmp_path):
    unfit = '\n[[unfit]]\ntest = "python:d.py::t1"\ndecision = "retire"\nreason = "covers only the deleted git path"\n'
    root = make_root(tmp_path, SIX_ASSIGNED + unfit)
    result = R.check_register(root, lister(python=SIX_LISTED + ["d.py::t1"]))
    assert result.exit_code == R.EXIT_OK
    assert result.data["unfit"] == [{"test": "python:d.py::t1", "decision": "retire", "reason": "covers only the deleted git path"}]


@pytest.mark.parametrize("decision,reason", [("", "a reason"), ("assign", ""), ("maybe", "a reason")])
def test_tc07_an_unfit_entry_without_a_valid_decision_and_a_reason_is_refused(tmp_path, decision, reason):
    unfit = f'\n[[unfit]]\ntest = "python:d.py::t1"\ndecision = "{decision}"\nreason = "{reason}"\n'
    root = make_root(tmp_path, SIX_ASSIGNED + unfit)
    result = R.check_register(root, lister(python=SIX_LISTED + ["d.py::t1"]))
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems if p.code == "E-UNFIT-NO-DECISION"] == [("E-UNFIT-NO-DECISION", "python:d.py::t1")]


def test_tc08_a_language_with_touched_files_and_no_listed_tests_is_refused(tmp_path):
    touched = '[[entry]]\nlanguage = "rust"\nfile = "tools/dbench/src/collect.rs"\nfunction = "pull"\nclasses = ["B"]\n'
    root = make_root(tmp_path, SIX_ASSIGNED, touched)
    result = R.check_register(root, lister(python=SIX_LISTED))
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems] == [("E-NO-TESTS", "rust")]


def test_boundary_the_fourteenth_use_case_is_accepted_and_the_fifteenth_is_not(tmp_path):
    fourteenth = make_root(tmp_path / "a", SIX_ASSIGNED + 'U14 = ["python:d.py::t1"]\n')
    assert R.check_register(fourteenth, lister(python=SIX_LISTED + ["d.py::t1"])).exit_code == R.EXIT_OK
    fifteenth = make_root(tmp_path / "b", SIX_ASSIGNED + 'U15 = ["python:d.py::t1"]\n')
    assert R.check_register(fifteenth, lister(python=SIX_LISTED + ["d.py::t1"])).exit_code == R.EXIT_FAIL


def test_tc10_a_failing_check_writes_its_report_and_leaves_assignments_untouched(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED)
    before = (root / "ops/refactor/assignments.toml").read_bytes()
    R.check_register(root, lister(python=SIX_LISTED + ["d.py::t1"]))
    report = json.loads((root / "ops/refactor/reports/register.json").read_text())
    assert report["exit_code"] == R.EXIT_FAIL and report["problems"][0]["code"] == "E-UNASSIGNED"
    assert (root / "ops/refactor/assignments.toml").read_bytes() == before


# ---- touched set (TC-61 to TC-67) ---------------------------------------------------------------------------------

CLASSES = """
[sources]
python = ["src/*.py"]
rust = ["src/*.rs"]
typescript = ["src/*.ts"]
shell = ["src/*.sh"]
exclude = ["test_*.py", "*.test.ts"]

[classes.A]
patterns = ['relative_to\\(REPO_ROOT']
[classes.B]
patterns = [\'\'\'git['", \\[]+(fetch|ls-tree|cat-file|show)\\b\'\'\', 'Command::new\\("git"\\)[\\s\\S]{0,200}?"(fetch|ls-tree|cat-file|show)"', 'origin/main']
[classes.C]
patterns = [\'\'\'git['", \\[]+(add|commit|push|rebase)\\b\'\'\']
[classes.D]
patterns = ['config\\.sh']
[classes.E]
patterns = ['awesome-local-ai-bench-private']
[classes.W]
functions = ["restore_spec", "setup_workspace"]
"""


def make_code_root(tmp_path: Path, files: dict[str, str], touched: str = "") -> Path:
    root = make_root(tmp_path, touched=touched)
    write(root, "ops/refactor/classes.toml", CLASSES)
    for rel, text in files.items():
        write(root, rel, text)
    return root


def proposed(root: Path) -> dict[tuple[str, str], list[str]]:
    return {(e.file, e.function): e.classes for e in R.propose_touched(root)}


def test_tc61_a_python_function_taking_identity_from_the_checkout_is_class_a(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": "def run_id(p):\n    return p.relative_to(REPO_ROOT)\n\ndef other():\n    return 1\n"})
    assert proposed(root) == {("src/a.py", "run_id"): ["A"]}


def test_tc62_a_python_function_committing_to_git_is_class_c(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'import subprocess\n\ndef record():\n    subprocess.run(["git", "commit", "-m", "x"])\n'})
    assert proposed(root) == {("src/a.py", "record"): ["C"]}


def test_tc63_a_rust_function_fetching_with_git_is_class_b(tmp_path):
    rust = 'fn pull(repo: &Path) {\n    Command::new("git")\n        .args(["fetch", "origin"])\n        .status();\n}\n\nfn other() {}\n'
    root = make_code_root(tmp_path, {"src/c.rs": rust})
    assert proposed(root) == {("src/c.rs", "pull"): ["B"]}


def test_tc64_a_typescript_function_listing_a_git_tree_is_class_b(tmp_path):
    ts = 'export function lsTree(rev: string) {\n  return spawn("git", ["ls-tree", "-r", rev]);\n}\n\nexport function noGit() { return 1; }\n'
    root = make_code_root(tmp_path, {"src/s.ts": ts})
    assert proposed(root) == {("src/s.ts", "lsTree"): ["B"]}


def test_a_shell_function_is_attributed_by_the_nearest_function_definition(tmp_path):
    sh = 'plain() {\n  echo hi\n}\n\nsync() {\n  git push origin HEAD\n}\n'
    root = make_code_root(tmp_path, {"src/x.sh": sh})
    assert proposed(root) == {("src/x.sh", "sync"): ["C"]}


def test_a_function_matching_several_classes_lists_all_of_them(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'def both(p):\n    q = p.relative_to(REPO_ROOT)\n    run(["git", "push"])\n'})
    assert proposed(root) == {("src/a.py", "both"): ["A", "C"]}


def test_a_pattern_inside_a_comment_is_still_a_match(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": "def f():\n    # old: git push origin\n    return 1\n"})
    assert proposed(root) == {("src/a.py", "f"): ["C"]}


def test_an_empty_file_and_a_test_file_propose_nothing(tmp_path):
    root = make_code_root(tmp_path, {"src/empty.py": "", "src/test_a.py": 'def test_x():\n    run(["git", "push"])\n'})
    assert proposed(root) == {}


def test_a_class_w_function_is_never_proposed_even_when_it_matches_other_classes(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'def restore_spec(ws):\n    run(["git", "commit", "-m", "x"])\n\ndef record():\n    run(["git", "push"])\n'})
    assert proposed(root) == {("src/a.py", "record"): ["C"]}


def test_proposing_never_writes_the_touched_set(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'def record():\n    run(["git", "push"])\n'})
    before = (root / "ops/refactor/touched_set.toml").read_bytes()
    R.propose_touched(root)
    assert (root / "ops/refactor/touched_set.toml").read_bytes() == before


ENTRY = '[[entry]]\nlanguage = "{lang}"\nfile = "{file}"\nfunction = "{fn}"\nclasses = [{classes}]\n{extra}'


def entry(lang="python", file="src/a.py", fn="record", classes='"C"', extra=""):
    return ENTRY.format(lang=lang, file=file, fn=fn, classes=classes, extra=extra)


def test_a_committed_set_equal_to_the_derivation_passes(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'def record():\n    run(["git", "push"])\n'}, touched=entry())
    result = R.check_touched(root)
    assert result.exit_code == R.EXIT_OK and result.problems == []


def test_tc65_a_class_w_function_in_the_set_is_refused(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": "def restore_spec(ws):\n    return 1\n"}, touched=entry(fn="restore_spec", classes='"W"'))
    assert "E-W-IN-SET" in codes(R.check_touched(root))


def test_tc66_a_class_e_match_in_neither_the_set_nor_the_excluded_table_is_refused(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'def where():\n    return "awesome-local-ai-bench-private"\n'})
    result = R.check_touched(root)
    assert [(p.code, p.subject) for p in result.problems] == [("E-UNLISTED-MATCH", "src/a.py::where")]


def test_an_excluded_entry_with_a_reason_resolves_a_match_and_one_without_is_refused(tmp_path):
    files = {"src/a.py": 'def where():\n    return "awesome-local-ai-bench-private"\n'}
    ok = '[[excluded]]\nlanguage = "python"\nfile = "src/a.py"\nfunction = "where"\nreason = "a path used only in a message"\n'
    bad = ok.replace('reason = "a path used only in a message"', 'reason = ""')
    assert R.check_touched(make_code_root(tmp_path / "ok", files, touched=ok)).exit_code == R.EXIT_OK
    assert "E-EXCLUDED-NO-REASON" in codes(R.check_touched(make_code_root(tmp_path / "bad", files, touched=bad)))


def test_tc67_a_listed_function_that_no_longer_exists_is_stale_and_an_unknown_class_is_refused(tmp_path):
    touched = entry(fn="gone") + entry(fn="record", classes='"Z"')
    root = make_code_root(tmp_path, {"src/a.py": 'def record():\n    run(["git", "push"])\n'}, touched=touched)
    result = R.check_touched(root)
    assert {"E-STALE-ENTRY", "E-CLASS-UNKNOWN"} <= set(codes(result))


def test_a_class_d_entry_without_a_note_of_where_its_source_moves_is_refused(tmp_path):
    files = {"src/a.py": "def cfg():\n    return open('config.sh')\n"}
    assert "E-D-WITHOUT-MOVE" in codes(R.check_touched(make_code_root(tmp_path / "a", files, touched=entry(fn="cfg", classes='"D"'))))
    with_move = entry(fn="cfg", classes='"D"', extra='move = "the release carries the definitions (story 4)"\n')
    assert R.check_touched(make_code_root(tmp_path / "b", files, touched=with_move)).exit_code == R.EXIT_OK


# ---- matrix (TC-11 to TC-17) --------------------------------------------------------------------------------------

def write_matrix(root: Path, text: str, use_case: str = "U1") -> None:
    write(root, f"ops/refactor/matrices/{use_case}.toml", text)


TWO_BY_TWO = '''
[dimensions]
kind = ["combination", "reference"]
outcome = ["done", "partial"]

[[cell]]
at = ["combination", "done"]
test = "python:t.py::a"
[[cell]]
at = ["combination", "partial"]
test = "python:t.py::b"
[[cell]]
at = ["reference", "done"]
test = "python:t.py::c"
[[cell]]
at = ["reference", "partial"]
test = "python:t.py::d"
'''
MATRIX_TESTS = ["t.py::a", "t.py::b", "t.py::c", "t.py::d"]


def matrix_result(tmp_path: Path, text: str, tests=MATRIX_TESTS) -> R.Result:
    root = make_root(tmp_path)
    write_matrix(root, text)
    return R.check_matrix(root, "U1", lister(python=tests))


def test_tc11_a_full_cross_product_with_one_test_per_cell_passes(tmp_path):
    result = matrix_result(tmp_path, TWO_BY_TWO)
    assert result.exit_code == R.EXIT_OK and result.data["cells"] == 4 and result.data["tests"] == 4


def test_tc12_a_missing_cell_names_the_tuple(tmp_path):
    text = TWO_BY_TWO.replace('[[cell]]\nat = ["reference", "partial"]\ntest = "python:t.py::d"\n', "")
    result = matrix_result(tmp_path, text)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CELL-MISSING", "reference x partial")]


def test_tc13_a_cell_with_a_value_nobody_declared_is_extra(tmp_path):
    result = matrix_result(tmp_path, TWO_BY_TWO + '[[cell]]\nat = ["combination", "stopped"]\ntest = "python:t.py::a"\n')
    assert "E-CELL-EXTRA" in codes(result) and result.exit_code == R.EXIT_FAIL


def test_tc14_a_cell_naming_two_tests_is_refused(tmp_path):
    text = TWO_BY_TWO.replace('test = "python:t.py::d"', 'tests = ["python:t.py::d", "python:t.py::a"]')
    assert "E-CELL-MULTIPLE" in codes(matrix_result(tmp_path, text))


def test_a_tuple_defined_twice_is_also_multiple(tmp_path):
    result = matrix_result(tmp_path, TWO_BY_TWO + '[[cell]]\nat = ["reference", "done"]\ntest = "python:t.py::a"\n')
    assert "E-CELL-MULTIPLE" in codes(result)


def test_tc15_a_cell_naming_a_test_the_register_lacks_is_unknown(tmp_path):
    result = matrix_result(tmp_path, TWO_BY_TWO, tests=MATRIX_TESTS[:3])
    assert [(p.code, p.subject) for p in result.problems] == [("E-TEST-UNKNOWN", "python:t.py::d")]


def test_tc16_cells_written_before_the_dimensions_are_refused(tmp_path):
    cells_first = '[[cell]]\nat = ["a"]\ntest = "python:t.py::a"\n\n[dimensions]\nkind = ["a"]\n'
    assert codes(matrix_result(tmp_path, cells_first, tests=["t.py::a"])) == ["E-NO-DIMENSIONS"]


def test_cells_with_no_dimensions_at_all_are_refused(tmp_path):
    assert codes(matrix_result(tmp_path, '[[cell]]\nat = ["a"]\ntest = "python:t.py::a"\n', tests=["t.py::a"])) == ["E-NO-DIMENSIONS"]


def test_tc17_one_dimension_with_one_value_is_one_cell(tmp_path):
    text = '[dimensions]\nkind = ["only"]\n\n[[cell]]\nat = ["only"]\ntest = "python:t.py::a"\n'
    result = matrix_result(tmp_path, text, tests=["t.py::a"])
    assert result.exit_code == R.EXIT_OK and result.data["cells"] == 1


def test_a_cell_with_the_wrong_number_of_values_is_extra(tmp_path):
    result = matrix_result(tmp_path, TWO_BY_TWO + '[[cell]]\nat = ["combination"]\ntest = "python:t.py::a"\n')
    assert "E-CELL-EXTRA" in codes(result)


def test_a_use_case_without_a_matrix_file_is_refused(tmp_path):
    root = make_root(tmp_path)
    assert codes(R.check_matrix(root, "U1", lister(python=[]))) == ["E-NO-MATRIX"]


def test_the_matrix_report_is_written_when_it_fails(tmp_path):
    root = make_root(tmp_path)
    write_matrix(root, TWO_BY_TWO.replace('test = "python:t.py::d"', 'test = "python:t.py::zzz"'))
    R.check_matrix(root, "U1", lister(python=MATRIX_TESTS))
    assert json.loads((root / "ops/refactor/reports/matrix-U1.json").read_text())["problems"][0]["code"] == "E-TEST-UNKNOWN"


# ---- stage (TC-46 to TC-53) ---------------------------------------------------------------------------------------

def ok_justifier(root: Path) -> R.Result:
    return R.Result()


def failing_justifier(root: Path) -> R.Result:
    result = R.Result()
    result.fail("E-BELOW", "x.py", "line 3")
    return result


def justifiers_all(fn):
    return {move: fn for move in R.ALLOWED_MOVES}


def stage_of(root: Path) -> str:
    return R.read_stage(root)


def test_tc46_the_first_move_is_inventory_to_matrices_when_justified(tmp_path):
    root = make_root(tmp_path)
    result = R.move_stage(root, "Matrices", justifiers_all(ok_justifier))
    assert result.exit_code == R.EXIT_OK and stage_of(root) == "Matrices"
    assert 'justified_by' in (root / "ops/refactor/stage.toml").read_text()


def test_tc47_skipping_a_stage_is_refused(tmp_path):
    root = make_root(tmp_path)
    result = R.move_stage(root, "Proved", justifiers_all(ok_justifier))
    assert codes(result) == ["E-SKIP"] and stage_of(root) == "Inventory"


def test_tc48_a_move_whose_justifying_check_fails_leaves_the_stage_alone(tmp_path):
    root = make_root(tmp_path)
    R.move_stage(root, "Matrices", justifiers_all(ok_justifier))
    result = R.move_stage(root, "Proved", justifiers_all(failing_justifier))
    assert codes(result) == ["E-NOT-JUSTIFIED"] and stage_of(root) == "Matrices"


def test_tc49_the_back_edge_from_deleted_to_proved_is_allowed(tmp_path):
    root = make_root(tmp_path)
    for to in ("Matrices", "Proved", "Deleted"):
        assert R.move_stage(root, to, justifiers_all(ok_justifier)).exit_code == R.EXIT_OK
    assert R.move_stage(root, "Proved", justifiers_all(failing_justifier)).exit_code == R.EXIT_OK   # needs no justification
    assert stage_of(root) == "Proved"


def test_tc50_reimplementing_straight_from_proved_is_refused(tmp_path):
    root = make_root(tmp_path)
    for to in ("Matrices", "Proved"):
        R.move_stage(root, to, justifiers_all(ok_justifier))
    assert codes(R.move_stage(root, "Reimplemented", justifiers_all(ok_justifier))) == ["E-SKIP"]


def test_tc51_a_corrupt_stage_file_is_refused_and_left_byte_identical(tmp_path):
    root = make_root(tmp_path)
    path = write(root, "ops/refactor/stage.toml", "stage = = nonsense [[\n")
    before = path.read_bytes()
    result = R.move_stage(root, "Matrices", justifiers_all(ok_justifier))
    assert codes(result) == ["E-STAGE-FILE-CORRUPT"] and path.read_bytes() == before


def test_tc52_an_unknown_stage_is_refused(tmp_path):
    assert codes(R.move_stage(make_root(tmp_path), "Frozen", justifiers_all(ok_justifier))) == ["E-UNKNOWN-STAGE"]


def test_the_full_path_through_every_stage_in_order(tmp_path):
    root = make_root(tmp_path)
    for to in R.STAGES[1:]:
        assert R.move_stage(root, to, justifiers_all(ok_justifier)).exit_code == R.EXIT_OK, to
    assert stage_of(root) == "Compared"
    assert [m["to"] for m in R.read_toml(root / "ops/refactor/stage.toml")["move"]] == list(R.STAGES[1:])


def test_tc53_a_process_killed_while_writing_leaves_the_old_content(tmp_path):
    import subprocess
    import sys
    target = tmp_path / "stage.toml"
    target.write_text("stage = \"Inventory\"\n")
    script = (
        "import os, signal, sys; sys.path.insert(0, %r); import refactor as R\n"
        "os.replace = lambda *a, **k: os.kill(os.getpid(), signal.SIGKILL)\n"
        "R.atomic_write(__import__('pathlib').Path(%r), 'stage = \"Matrices\"\\n')\n" % (str(Path(R.__file__).parent), str(target))
    )
    proc = subprocess.run([sys.executable, "-c", script])
    assert proc.returncode != 0
    assert target.read_text() == 'stage = "Inventory"\n'


# ---- stubs and the deletion report (TC-27 to TC-38) -----------------------------------------------------------------

STUB_FILES = {
    "src/a.py": 'def pull(repo):\n    raise NotImplementedError("deleted by story 4")\n',
    "src/c.rs": 'fn pull(repo: &Path) {\n    todo!()\n}\n',
    "src/s.ts": 'export function lsTree(rev: string) {\n  throw new Error("not yet implemented");\n}\n',
    "src/x.sh": 'sync() {\n  return 99\n}\n',
}
STUB_ENTRIES = (entry("python", "src/a.py", "pull", '"B"') + entry("rust", "src/c.rs", "pull", '"B"')
                + entry("typescript", "src/s.ts", "lsTree", '"B"') + entry("shell", "src/x.sh", "sync", '"C"'))


def stub_root(tmp_path: Path, files: dict[str, str] | None = None) -> Path:
    return make_code_root(tmp_path, files or STUB_FILES, touched=STUB_ENTRIES)


def test_tc27_every_touched_function_a_stub_passes(tmp_path):
    result = R.check_stubs(stub_root(tmp_path))
    assert result.exit_code == R.EXIT_OK and result.problems == []


@pytest.mark.parametrize("language,file", [("python", "src/a.py"), ("rust", "src/c.rs"), ("typescript", "src/s.ts"), ("shell", "src/x.sh")])
def test_tc28_a_touched_function_with_a_real_body_is_not_a_stub(tmp_path, language, file):
    real = {
        "src/a.py": 'def pull(repo):\n    return repo.fetch()\n',
        "src/c.rs": 'fn pull(repo: &Path) {\n    repo.fetch();\n}\n',
        "src/s.ts": 'export function lsTree(rev: string) {\n  return run(rev);\n}\n',
        "src/x.sh": 'sync() {\n  git push\n}\n',
    }
    files = dict(STUB_FILES, **{file: real[file]})
    result = R.check_stubs(stub_root(tmp_path, files))
    assert [(p.code, p.subject) for p in result.problems] == [("E-NOT-STUB", f"{file}::{'sync' if language == 'shell' else 'lsTree' if language == 'typescript' else 'pull'}")]


def test_tc29_a_stub_with_an_extra_statement_is_not_a_stub(tmp_path):
    files = dict(STUB_FILES, **{"src/a.py": 'def pull(repo):\n    log("x")\n    raise NotImplementedError("deleted")\n'})
    assert codes(R.check_stubs(stub_root(tmp_path, files))) == ["E-NOT-STUB"]


@pytest.mark.parametrize("body", ["todo!()", "unimplemented!()", 'todo!("deleted by story 4")', "todo!();"])
def test_tc35_rust_stub_forms_are_recognised(tmp_path, body):
    files = dict(STUB_FILES, **{"src/c.rs": "fn pull(repo: &Path) {\n    %s\n}\n" % body})
    assert R.check_stubs(stub_root(tmp_path, files)).exit_code == R.EXIT_OK


def test_tc36_typescript_stub_forms_are_recognised(tmp_path):
    files = dict(STUB_FILES, **{"src/s.ts": "export function lsTree(rev: string) {\n  throw new Error(`gone: ${rev}`)\n}\n"})
    assert R.check_stubs(stub_root(tmp_path, files)).exit_code == R.EXIT_OK


def test_tc37_a_shell_stub_is_exactly_return_99(tmp_path):
    files = dict(STUB_FILES, **{"src/x.sh": "sync() {\n  return 98\n}\n"})
    assert codes(R.check_stubs(stub_root(tmp_path, files))) == ["E-NOT-STUB"]


def test_a_listed_function_that_does_not_exist_is_reported_as_stale(tmp_path):
    files = {k: v for k, v in STUB_FILES.items() if k != "src/a.py"}
    files["src/a.py"] = "def other():\n    raise NotImplementedError()\n"
    assert "E-STALE-ENTRY" in codes(R.check_stubs(stub_root(tmp_path, files)))


SIX_TESTS = [f"python:t.py::t{n}" for n in range(1, 7)]
OUTSIDE = ["python:u.py::u1", "python:u.py::u2"]


def deletion_root(tmp_path: Path, stage: str = "Deleted") -> Path:
    root = stub_root(tmp_path)
    write(root, "ops/refactor/assignments.toml", "[assignments]\nU1 = [%s]\n" % ", ".join(f'"{t}"' for t in SIX_TESTS))
    write_stage(root, stage)
    return root


def results(outcomes: dict[str, str], missing: tuple[str, ...] = ()) -> R.Results:
    return R.Results(outcomes=dict(outcomes), missing=set(missing))


ALL_FAILED = {t: R.FAILED_STUB for t in SIX_TESTS} | {t: R.PASSED for t in OUTSIDE}


def test_tc30_every_assigned_test_failing_for_the_stub_reason_is_ok_and_reported(tmp_path):
    root = deletion_root(tmp_path)
    result = R.report_deletion(root, results(ALL_FAILED))
    assert result.exit_code == R.EXIT_OK and result.data["assigned_failed"] == sorted(SIX_TESTS)


def test_tc31_an_assigned_test_that_passes_is_refused_and_the_stage_goes_back(tmp_path):
    root = deletion_root(tmp_path)
    outcomes = ALL_FAILED | {SIX_TESTS[2]: R.PASSED}
    result = R.report_deletion(root, results(outcomes))
    assert [(p.code, p.subject) for p in result.problems] == [("E-ASSIGNED-PASSED", SIX_TESTS[2])]
    assert stage_of(root) == "Proved"                                                      # TC-38


def test_tc32_an_unassigned_test_that_fails_means_the_partition_is_not_mece(tmp_path):
    root = deletion_root(tmp_path)
    result = R.report_deletion(root, results(ALL_FAILED | {OUTSIDE[0]: R.FAILED_STUB}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-OUTSIDE-FAILED", OUTSIDE[0])]
    assert stage_of(root) == "Deleted"


def test_tc33_a_runner_that_produced_no_result_file_is_refused(tmp_path):
    root = deletion_root(tmp_path)
    result = R.report_deletion(root, results(ALL_FAILED, missing=("rust",)))
    assert [(p.code, p.subject) for p in result.problems] == [("E-RESULTS-MISSING", "rust")]


def test_an_assigned_test_with_no_result_at_all_is_missing_not_failed(tmp_path):
    root = deletion_root(tmp_path)
    outcomes = {k: v for k, v in ALL_FAILED.items() if k != SIX_TESTS[0]}
    assert [(p.code, p.subject) for p in R.report_deletion(root, results(outcomes)).problems] == [("E-RESULTS-MISSING", SIX_TESTS[0])]


def test_tc34_a_failure_that_is_not_the_stub_is_not_evidence(tmp_path):
    root = deletion_root(tmp_path)
    result = R.report_deletion(root, results(ALL_FAILED | {SIX_TESTS[1]: R.FAILED_OTHER}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-STUB-FAILS-TO-IMPORT", SIX_TESTS[1])]


def test_a_real_body_left_behind_stops_the_report_before_any_result_is_read(tmp_path):
    files = dict(STUB_FILES, **{"src/a.py": "def pull(repo):\n    return 1\n"})
    root = make_code_root(tmp_path, files, touched=STUB_ENTRIES)
    write(root, "ops/refactor/assignments.toml", "[assignments]\nU1 = []\n")
    write_stage(root, "Deleted")
    assert codes(R.report_deletion(root, results({}))) == ["E-NOT-STUB"]


def test_unfit_tests_are_exempt_from_the_outside_check(tmp_path):
    root = deletion_root(tmp_path)
    (root / "ops/refactor/assignments.toml").write_text(
        (root / "ops/refactor/assignments.toml").read_text()
        + '\n[[unfit]]\ntest = "python:u.py::u1"\ndecision = "retire"\nreason = "covers only the deleted path"\n')
    assert R.report_deletion(root, results(ALL_FAILED | {OUTSIDE[0]: R.FAILED_STUB})).exit_code == R.EXIT_OK


def test_the_deletion_report_never_edits_production_code(tmp_path):
    root = deletion_root(tmp_path)
    before = {f: (root / f).read_bytes() for f in STUB_FILES}
    R.report_deletion(root, results(ALL_FAILED | {SIX_TESTS[2]: R.PASSED}))
    assert {f: (root / f).read_bytes() for f in STUB_FILES} == before


# ---- fates: every assigned test ends in exactly one state ----------------------------------------------------------------

FATE_ASSIGNMENTS = '[assignments]\nU1 = ["python:t_a", "python:t_b", "python:t_c"]\n'
FATE_TOUCHED = '[[entry]]\nfile = "src/a.py"\nfunction = "record"\nlanguage = "python"\nclasses = ["C"]\n'


def fates_result(tmp_path: Path, fates: str, assignments: str = FATE_ASSIGNMENTS) -> R.Result:
    root = make_root(tmp_path, assignments=assignments, touched=FATE_TOUCHED)
    write(root, "ops/refactor/fates.toml", fates)
    return R.check_fates(root)


def test_tc54_each_assigned_test_with_one_valid_fate_passes(tmp_path):
    result = fates_result(tmp_path, '''
[[fate]]
test = "python:t_a"
state = "kept"
[[fate]]
test = "python:t_b"
state = "rewritten"
new_test = "python:t_b_new"
[[fate]]
test = "python:t_c"
state = "retired"
function = "src/a.py::record"
reason = "the function is deleted"
''')
    assert result.exit_code == R.EXIT_OK, result.problems


def test_tc55_an_assigned_test_without_a_fate_is_missing_and_one_with_two_is_refused(tmp_path):
    result = fates_result(tmp_path, '''
[[fate]]
test = "python:t_a"
state = "kept"
[[fate]]
test = "python:t_a"
state = "kept"
[[fate]]
test = "python:t_b"
state = "kept"
''')
    assert sorted(codes(result)) == sorted(["E-NO-FATE", "E-FATE-MULTIPLE"])


def test_tc56_a_fate_for_an_unassigned_test_or_with_an_unknown_state_is_refused(tmp_path):
    result = fates_result(tmp_path, '''
[[fate]]
test = "python:t_a"
state = "kept"
[[fate]]
test = "python:t_b"
state = "kept"
[[fate]]
test = "python:t_c"
state = "deleted"
[[fate]]
test = "python:ghost"
state = "kept"
''')
    assert sorted(codes(result)) == sorted(["E-FATE-INVALID", "E-FATE-UNKNOWN-TEST"])


def test_tc57_rewritten_needs_a_new_test_and_retired_needs_a_touched_function_and_a_reason(tmp_path):
    result = fates_result(tmp_path, '''
[[fate]]
test = "python:t_a"
state = "rewritten"
[[fate]]
test = "python:t_b"
state = "retired"
function = "src/a.py::elsewhere"
reason = "gone"
[[fate]]
test = "python:t_c"
state = "retired"
function = "src/a.py::record"
''')
    assert sorted(codes(result)) == sorted(["E-FATE-NO-NEW-TEST", "E-RETIRED-NO-FUNCTION", "E-FATE-RETIRED-NO-REASON"])


def test_the_fates_report_is_written_and_counts_each_state(tmp_path):
    root = make_root(tmp_path, assignments=FATE_ASSIGNMENTS, touched=FATE_TOUCHED)
    write(root, "ops/refactor/fates.toml", '[[fate]]\ntest = "python:t_a"\nstate = "kept"\n')
    R.check_fates(root)
    report = json.loads((root / "ops/refactor/reports/fates.json").read_text())
    assert report["exit_code"] == R.EXIT_FAIL and report["counts"]["kept"] == 1


# ---- coverage proof (tasks 1.4 and 1.14), at the level of the touched FUNCTIONS (owner-approved 12 Oct 2026) --------------------------

def entry_toml(language: str, file: str, function: str) -> str:
    return f'[[entry]]\nfile = "{file}"\nfunction = "{function}"\nlanguage = "{language}"\nclasses = ["C"]\n'


PY_RECORD = "def record():\n    x = 1\n    if x:\n        return x\n    return 0\n\n\ndef elsewhere():\n    return 9\n"      # record is lines 1 to 5
RS_PULL = "pub fn pull() {\n    let x = 1;\n    if x > 0 {\n        return;\n    }\n}\n\npub fn other() {\n    println!();\n}\n"      # pull is lines 1 to 7 (to the next fn)


def canned(**per_language):
    """A coverage runner returning canned per-file line data, or raising what a real one raises."""
    def run(root, language, spec):
        outcome = per_language[language]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome
    return run


def coverage_result(tmp_path: Path, touched: str, files: dict | None = None, **per_language) -> R.Result:
    root = make_root(tmp_path, touched=touched)
    for rel, text in (files or {}).items():
        write(root, rel, text)
    return R.check_coverage(root, canned(**per_language))


def lines(hits: dict[int, int], branches=()):
    return R.FileLines(dict(hits), list(branches))


ALL_HIT = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 8: 0, 9: 0}      # record fully hit; the function after it not run at all


def test_a_touched_function_with_every_line_and_branch_hit_passes_whatever_the_rest_of_the_file_does(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD},
                             python={"src/a.py": lines(ALL_HIT, [(3, "0:4", True), (3, "0:5", True)])})
    assert result.exit_code == R.EXIT_OK and result.problems == []                      # lines 8 and 9 (elsewhere) are unhit and do not matter
    assert result.data["measured"] == {"src/a.py::record": [5, 5, 2, 2]}


def test_tc21_one_uncovered_line_inside_the_function_fails_naming_function_and_line(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD},
                             python={"src/a.py": lines({**ALL_HIT, 5: 0})})
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems] == [("E-BELOW", "src/a.py::record")]
    assert result.problems[0].detail == "4 of 5 lines (line 5)"


def test_tc21_boundary_9999_of_10000_lines_fails_and_all_10000_pass(tmp_path):
    big = "def big():\n" + "    x = 1\n" * 9999                                         # 10,000 lines
    full = {n: 1 for n in range(1, 10001)}
    almost = {**full, 7777: 0}
    below = coverage_result(tmp_path / "a", entry_toml("python", "src/b.py", "big"), {"src/b.py": big}, python={"src/b.py": lines(almost)})
    assert below.exit_code == R.EXIT_FAIL and below.problems[0].detail == "9999 of 10000 lines (line 7777)"
    assert coverage_result(tmp_path / "b", entry_toml("python", "src/b.py", "big"), {"src/b.py": big}, python={"src/b.py": lines(full)}).exit_code == R.EXIT_OK


def test_lines_and_branches_are_checked_independently(tmp_path):
    only_branch = coverage_result(tmp_path / "a", entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD},
                                  python={"src/a.py": lines(ALL_HIT, [(3, "0:4", True), (3, "0:5", False)])})
    assert only_branch.problems[0].detail == "1 of 2 branches (3->5)"
    both = coverage_result(tmp_path / "b", entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD},
                           python={"src/a.py": lines({**ALL_HIT, 4: 0}, [(3, "0:4", False), (3, "0:5", True)])})
    assert both.problems[0].detail == "4 of 5 lines (line 4); 1 of 2 branches (3->4)"


def test_a_branch_outside_the_function_is_not_counted(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD},
                             python={"src/a.py": lines(ALL_HIT, [(3, "0:4", True), (8, "0:9", False)])})
    assert result.exit_code == R.EXIT_OK


def test_a_function_with_no_measurable_line_or_a_file_the_tool_never_saw_is_unmeasured(tmp_path):
    none = coverage_result(tmp_path / "a", entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD}, python={"src/a.py": lines({8: 1})})
    assert [(p.code, p.subject) for p in none.problems] == [("E-FILE-UNMEASURED", "src/a.py::record")]
    unseen = coverage_result(tmp_path / "b", entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD}, python={})
    assert [(p.code, p.subject) for p in unseen.problems] == [("E-FILE-UNMEASURED", "src/a.py::record")]


RS_CONSTANTS = "const COMBINATIONS_DIR: &str = \"combinations\";\nconst BENCHMARKS_DIR: &str = \"benchmarks\";\n\nfn pull() {\n    run();\n}\n"


def test_a_module_head_of_constants_has_no_line_to_measure_and_is_reported_not_failed(tmp_path):
    result = coverage_result(tmp_path, entry_toml("rust", "src/a.rs", "<module>"), {"src/a.rs": RS_CONSTANTS},
                             rust={"src/a.rs": lines({5: 1})})
    assert result.exit_code == R.EXIT_OK and result.problems == []
    assert result.data["constants_only"] == ["src/a.rs::<module>"]
    assert "src/a.rs::<module>" not in result.data["measured"]


def test_a_module_head_in_a_file_the_tool_never_saw_is_still_unmeasured(tmp_path):
    result = coverage_result(tmp_path, entry_toml("rust", "src/a.rs", "<module>"), {"src/a.rs": RS_CONSTANTS}, rust={})
    assert [(p.code, p.subject) for p in result.problems] == [("E-FILE-UNMEASURED", "src/a.rs::<module>")]


def test_only_a_module_head_may_have_no_measurable_line_a_named_function_may_not(tmp_path):
    result = coverage_result(tmp_path, entry_toml("rust", "src/a.rs", "pull"), {"src/a.rs": RS_CONSTANTS}, rust={"src/a.rs": lines({1: 1})})
    assert [(p.code, p.subject) for p in result.problems] == [("E-FILE-UNMEASURED", "src/a.rs::pull")]


def test_a_touched_function_that_is_not_in_its_file_is_unmeasured_not_passed(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "ghost"), {"src/a.py": PY_RECORD}, python={"src/a.py": lines(ALL_HIT)})
    assert [p.code for p in result.problems] == ["E-FILE-UNMEASURED"]


def test_a_rust_function_runs_from_its_fn_line_to_the_next_function(tmp_path):
    hits = {1: 1, 2: 1, 3: 1, 4: 0, 8: 1, 9: 1}
    result = coverage_result(tmp_path, entry_toml("rust", "src/a.rs", "pull"), {"src/a.rs": RS_PULL}, rust={"src/a.rs": lines(hits)})
    assert result.problems[0].detail == "3 of 4 lines (line 4)"


def test_two_rust_functions_of_one_name_are_both_checked(tmp_path):
    src = "impl A {\n    fn new() {\n        1;\n    }\n}\nimpl B {\n    fn new() {\n        2;\n    }\n}\n"
    result = coverage_result(tmp_path, entry_toml("rust", "src/a.rs", "new"), {"src/a.rs": src}, rust={"src/a.rs": lines({2: 1, 3: 1, 7: 1, 8: 0})})
    assert result.problems[0].detail == "3 of 4 lines (line 8)"


def test_a_shell_script_entry_is_the_whole_file(tmp_path):
    src = "echo one\necho two\n"
    result = coverage_result(tmp_path, entry_toml("shell", "src/a.sh", "<script>"), {"src/a.sh": src}, shell={"src/a.sh": lines({1: 1, 2: 0})})
    assert result.problems[0].detail == "1 of 2 lines (line 2)"


def test_tc24_a_missing_coverage_tool_is_exit_2_naming_it(tmp_path):
    result = coverage_result(tmp_path, entry_toml("rust", "src/a.rs", "pull"), {"src/a.rs": RS_PULL}, rust=R.ToolMissing("cargo llvm-cov"))
    assert result.exit_code == R.EXIT_ERROR
    assert [(p.code, p.subject) for p in result.problems] == [("E-TOOL-MISSING", "rust")] and "cargo llvm-cov" in result.problems[0].detail


def test_tc25_a_red_suite_is_exit_2_and_never_a_proof(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD}, python=R.SuiteRed("1 failed"))
    assert result.exit_code == R.EXIT_ERROR and [p.code for p in result.problems] == ["E-SUITE-RED"]


def test_tc26_shell_without_kcov_is_reported_not_measured_while_other_languages_still_decide(tmp_path):
    touched = entry_toml("python", "src/a.py", "record") + entry_toml("shell", "src/a.sh", "<script>")
    files = {"src/a.py": PY_RECORD, "src/a.sh": "echo\n"}
    passing = coverage_result(tmp_path / "a", touched, files, python={"src/a.py": lines(ALL_HIT)}, shell=R.NotMeasured("kcov is not available on macOS"))
    assert passing.exit_code == R.EXIT_OK and passing.data["not_measured"] == {"shell": "kcov is not available on macOS"}
    failing = coverage_result(tmp_path / "b", touched, files, python={"src/a.py": lines({**ALL_HIT, 5: 0})}, shell=R.NotMeasured("x"))
    assert failing.exit_code == R.EXIT_FAIL and failing.data["not_measured"] == {"shell": "x"}


def test_a_language_with_no_touched_functions_is_not_run(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD}, python={"src/a.py": lines(ALL_HIT)})   # no rust key: a call would KeyError
    assert result.exit_code == R.EXIT_OK


LCOV = """TN:
SF:{root}/src/a.rs
FN:1,pull
DA:1,3
DA:2,3
DA:3,0
BRDA:3,0,0,2
BRDA:3,0,1,-
end_of_record
SF:{root}/src/b.rs
DA:5,1
end_of_record
"""


def test_lcov_is_read_into_hit_counts_per_line_and_taken_branches_with_files_relative_to_the_repository():
    data = R.parse_lcov(Path("/r"), "", LCOV.format(root="/r"))
    assert data["src/a.rs"].lines == {1: 3, 2: 3, 3: 0}
    assert data["src/a.rs"].branches == [(3, "0:0", True), (3, "0:1", False)]
    assert data["src/b.rs"].lines == {5: 1}


def test_lcov_from_a_run_made_in_a_folder_has_files_relative_to_that_folder():
    text = "SF:pkg/core.py\nDA:1,1\nBRDA:3,0,4,1\nend_of_record\n"
    assert R.parse_lcov(Path("/r"), "py", text)["py/pkg/core.py"].branches == [(3, "0:4", True)]


# ---- justifiers and the command line ----------------------------------------------------------------------------------

def cli(root: Path, *args: str) -> int:
    return R.main(["--root", str(root), *args])


def test_tc44_advance_inventory_to_matrices_needs_the_register_and_the_touched_set_to_hold(tmp_path, monkeypatch):
    root = make_root(tmp_path, assignments=SIX_ASSIGNED)
    monkeypatch.setattr(R, "list_tests", lister(python=SIX_LISTED))
    monkeypatch.setattr(R, "touching_tests", lambda root, listed: listed)
    assert cli(root, "stage", "Matrices") == R.EXIT_OK
    assert R.read_stage(root) == "Matrices"


def test_tc45_advance_with_the_register_broken_refuses_and_the_stage_stays(tmp_path, monkeypatch):
    root = make_root(tmp_path, assignments=SIX_ASSIGNED)
    monkeypatch.setattr(R, "list_tests", lister(python=SIX_LISTED + ["d.py::extra"]))
    monkeypatch.setattr(R, "touching_tests", lambda root, listed: listed)
    assert cli(root, "stage", "Matrices") == R.EXIT_FAIL
    assert R.read_stage(root) == "Inventory"


def test_advancing_two_stages_at_once_is_refused_with_exit_1(tmp_path):
    root = make_root(tmp_path)
    assert cli(root, "stage", "Proved") == R.EXIT_FAIL


def test_stage_prints_the_current_stage(tmp_path, capsys):
    root = make_root(tmp_path)
    assert cli(root, "stage") == R.EXIT_OK
    assert capsys.readouterr().out.splitlines()[-1] == "Inventory"      # the scope line comes first


def test_a_corrupt_stage_file_is_exit_2_names_its_code_and_is_left_as_it_is(tmp_path, capsys):
    root = make_root(tmp_path)
    write(root, "ops/refactor/stage.toml", "stage = [")
    assert cli(root, "stage") == R.EXIT_ERROR
    assert "E-STAGE-FILE-CORRUPT" in capsys.readouterr().out
    assert (root / "ops/refactor/stage.toml").read_text() == "stage = ["


def test_check_fates_and_check_stubs_run_from_the_command_line(tmp_path):
    root = make_root(tmp_path, assignments=FATE_ASSIGNMENTS, touched=FATE_TOUCHED)
    assert cli(root, "fates") == R.EXIT_FAIL          # three assigned tests, no fates
    write(root, "src/a.py", "def record():\n    return 1\n")
    assert cli(root, "check-stubs") == R.EXIT_FAIL          # not a stub yet
    write(root, "src/a.py", "def record():\n    raise NotImplementedError\n")
    assert cli(root, "check-stubs") == R.EXIT_OK


def test_a_deletion_advance_is_refused_until_the_stubs_are_in(tmp_path):
    root = make_root(tmp_path, touched=FATE_TOUCHED)
    write_stage(root, "Proved")
    write(root, "src/a.py", "def record():\n    return 1\n")
    assert cli(root, "stage", "Deleted") == R.EXIT_FAIL
    write(root, "src/a.py", "def record():\n    raise NotImplementedError\n")
    assert cli(root, "stage", "Deleted") == R.EXIT_OK


# ---- found by running the scan on the real repository: test code and functions the design names --------------------------

def test_a_rust_function_inside_the_trailing_test_module_is_never_proposed(tmp_path):
    root = make_code_root(tmp_path, {"src/a.rs": (
        'fn fetch_it() {\n    Command::new("git").args(["fetch"]);\n}\n\n'
        '#[cfg(test)]\nmod tests {\n    fn a_test_that_runs_git() {\n        Command::new("git").args(["fetch"]);\n    }\n}\n')})
    assert [e.function for e in R.propose_touched(root)] == ["fetch_it"]


def named_root(tmp_path: Path, named: str) -> Path:
    root = make_code_root(tmp_path, {"src/a.py": "def resolve_dir(run):\n    return run\n\ndef other():\n    return 1\n"})
    write(root, "ops/refactor/classes.toml", CLASSES + named)
    return root


def test_a_function_the_design_names_is_proposed_under_its_class_without_matching_a_pattern(tmp_path):
    root = named_root(tmp_path, '\n[named]\nA = ["src/a.py::resolve_dir"]\n')
    assert proposed(root) == {("src/a.py", "resolve_dir"): ["A"]}


def test_a_named_function_that_does_not_exist_is_refused_by_check_touched(tmp_path):
    root = named_root(tmp_path, '\n[named]\nA = ["src/a.py::no_such_function"]\n')
    assert "E-NAMED-MISSING" in codes(R.check_touched(root))


def test_a_named_function_matching_a_pattern_too_lists_both_classes_once(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": "def f():\n    run(['git', 'commit'])\n"})
    write(root, "ops/refactor/classes.toml", CLASSES + '\n[named]\nA = ["src/a.py::f"]\n')
    assert proposed(root) == {("src/a.py", "f"): ["A", "C"]}


# ---- script-level stubs (approved 12 Oct 2026): a script with no functions is stubbed as a whole ----------------------------

SCRIPT_ENTRY = '[[entry]]\nfile = "src/go.sh"\nfunction = "<script>"\nlanguage = "shell"\nclasses = ["B"]\n'


def script_stub_result(tmp_path: Path, body: str) -> R.Result:
    root = make_root(tmp_path, touched=SCRIPT_ENTRY)
    write(root, "src/go.sh", body)
    return R.check_stubs(root)


def test_a_script_reduced_to_a_shebang_comments_and_exit_99_is_a_stub(tmp_path):
    assert script_stub_result(tmp_path, "#!/usr/bin/env bash\n# replaced\n\nexit 99\n").exit_code == R.EXIT_OK


def test_a_script_with_any_other_code_is_not_a_stub(tmp_path):
    result = script_stub_result(tmp_path, "#!/usr/bin/env bash\necho hi\nexit 99\n")
    assert codes(result) == ["E-NOT-STUB"]


def test_a_script_that_exits_with_another_code_or_has_functions_left_is_not_a_stub(tmp_path):
    assert codes(script_stub_result(tmp_path, "#!/bin/sh\nexit 0\n")) == ["E-NOT-STUB"]
    assert codes(script_stub_result(tmp_path, "#!/bin/sh\nf() { :; }\nexit 99\n")) == ["E-NOT-STUB"]


def test_an_empty_script_is_not_a_stub(tmp_path):
    assert codes(script_stub_result(tmp_path, "#!/bin/sh\n")) == ["E-NOT-STUB"]


# ---- the four real runners list their tests (task 1.1; TC-09 is the mini-project test in 1.10) -----------------------

PYTEST_OUT = """\
test_a.py::test_one
test_a.py::TestC::test_m[x-1]
sub/test_b.py::test_two

3 tests collected in 0.01s
"""
CARGO_OUT = """\
     Running unittests src/lib.rs (target/debug/deps/dbench-3c9e3c3b1e939def)
collector::tests::copies_a_run: test
events::tests::parses_an_event: test

2 tests, 0 benchmarks
     Running tests/server.rs (target/debug/deps/server-607e7965d4855fd8)
serves_a_run_file: test
   Doc-tests dbench
"""


def test_pytest_collect_output_gives_ids_with_the_runner_folder(tmp_path):
    assert R.parse_pytest("h", PYTEST_OUT) == {"h/test_a.py::test_one", "h/test_a.py::TestC::test_m[x-1]", "h/sub/test_b.py::test_two"}


def test_pytest_collection_errors_are_an_adapter_error_not_a_smaller_list(tmp_path):
    with pytest.raises(R.AdapterError, match="test_x.py"):
        R.parse_pytest("h", "test_a.py::test_one\nERROR test_x.py - ImportError\n1 test collected, 1 error\n")


def test_cargo_list_output_gives_file_qualified_ids_and_skips_doc_tests_and_summaries(tmp_path):
    root = make_root(tmp_path)
    write(root, "w/dbench/Cargo.toml", '[package]\nname = "dbench"\n')
    assert R.parse_cargo_list(root, "w", CARGO_OUT) == {
        "w/dbench/src/lib.rs::collector::tests::copies_a_run", "w/dbench/src/lib.rs::events::tests::parses_an_event",
        "w/dbench/tests/server.rs::serves_a_run_file"}


def test_cargo_list_with_a_binary_that_has_no_member_folder_is_an_adapter_error(tmp_path):
    with pytest.raises(R.AdapterError, match="dbench"):
        R.parse_cargo_list(make_root(tmp_path), "w", CARGO_OUT)


def test_vitest_json_gives_file_qualified_ids(tmp_path):
    root = make_root(tmp_path)
    rows = [{"name": "a > b", "file": str(root / "t/x.test.ts"), "location": {}}]
    assert R.parse_vitest(root, json.dumps(rows)) == {"t/x.test.ts::a > b"}


def test_vitest_output_that_is_not_json_is_an_adapter_error(tmp_path):
    with pytest.raises(R.AdapterError):
        R.parse_vitest(make_root(tmp_path), "not json")


def runners(root: Path, text: str) -> None:
    write(root, "ops/refactor/runners.toml", text)


def test_a_runner_whose_program_is_not_installed_is_an_error_naming_it(tmp_path):
    root = make_root(tmp_path)
    runners(root, '[python]\ndir = "."\ncommand = ["no-such-program-xyz", "--collect-only"]\n')
    with pytest.raises(R.AdapterError, match="no-such-program-xyz"):
        R.list_tests(root)


def test_a_runner_that_exits_non_zero_is_an_error_not_an_empty_list(tmp_path):
    root = make_root(tmp_path)
    runners(root, '[python]\ndir = "."\ncommand = ["sh", "-c", "echo boom >&2; exit 3"]\n')
    with pytest.raises(R.AdapterError, match="boom"):
        R.list_tests(root)


def test_shell_tests_are_the_scripts_matching_the_glob(tmp_path):
    root = make_root(tmp_path)
    runners(root, '[shell]\nglob = "tests/*-test.sh"\n')
    write(root, "tests/a-test.sh", "")
    write(root, "tests/lib.sh", "")
    assert R.list_tests(root) == {"shell": {"tests/a-test.sh"}}


def test_a_language_with_no_runner_configured_is_absent_from_the_lists(tmp_path):
    root = make_root(tmp_path)
    runners(root, "")
    assert R.list_tests(root) == {}


def test_no_runners_file_is_an_adapter_error(tmp_path):
    with pytest.raises(R.AdapterError, match="runners.toml"):
        R.list_tests(make_root(tmp_path))


def test_rust_headers_on_stderr_stay_in_order_with_the_tests_on_stdout(tmp_path):
    root = make_root(tmp_path)
    write(root, "w/dbench/Cargo.toml", '[package]\nname = "dbench"\n')
    script = ("echo '     Running unittests src/lib.rs (target/debug/deps/dbench-3c9e3c3b1e939def)' >&2; "
              "echo 'collector::tests::a: test'; "
              "echo '     Running tests/server.rs (target/debug/deps/server-607e7965d4855fd8)' >&2; "
              "echo 'serves: test'")
    runners(root, f'[rust]\ndir = "w"\ncommand = ["sh", "-c", {json.dumps(script)}]\n')
    assert R.list_tests(root) == {"rust": {"w/dbench/src/lib.rs::collector::tests::a", "w/dbench/tests/server.rs::serves"}}


# ---- integration: the mini project, run as a process with the real runners (task 1.10, TC-09) ---------------------------------

import os
import shutil
import subprocess
import sys

TOOL = Path(__file__).parent / "refactor.py"
MINI = Path(__file__).parent / "fixtures" / "mini"
MINI_IGNORED = shutil.ignore_patterns("target", "node_modules", "__pycache__", ".pytest_cache", "reports")
MINI_IDS = {
    "python": {"py/test_core.py::test_record_keeps_only_what_fits_under_the_limit", "py/test_core.py::test_run_dir_joins_the_root_and_the_run_id"},
    "rust": {"rs/mini/src/lib.rs::tests::an_empty_listing_has_no_lines", "rs/mini/src/lib.rs::tests::a_listing_counts_its_lines"},
    "typescript": {"ts/src/core.test.ts::a run with a title shows it", "ts/src/core.test.ts::a run without a title is untitled"},
    "shell": {"tests/one-test.sh", "tests/two-test.sh"},
}


@pytest.fixture(scope="module")
def mini(tmp_path_factory) -> Path:
    """A private copy of the mini project with its TypeScript dependencies installed (the real runners need them)."""
    root = tmp_path_factory.mktemp("mini") / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    subprocess.run(["bun", "install"], cwd=root / "ts", check=True, capture_output=True)
    return root


def tool(root: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TOOL), "--root", str(root), *args], capture_output=True, text=True,
                          env=env if env is not None else os.environ)


def test_tc09_the_four_real_runners_list_eight_tests_in_the_expected_formats_and_the_register_holds(mini):
    assert tool(mini, "measure-touch").returncode == R.EXIT_OK              # the register's universe is the tests that touch the set
    done = tool(mini, "check-register")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    report = json.loads((mini / "ops/refactor/reports/register.json").read_text())
    assert {lang: set(ids) for lang, ids in report["listed"].items()} == MINI_IDS


def test_tc09_negative_a_runner_missing_from_the_path_is_exit_2_naming_it_not_a_silent_zero(mini):
    no_cargo = os.pathsep.join(d for d in os.environ["PATH"].split(os.pathsep) if not (Path(d) / "cargo").exists())
    done = tool(mini, "check-register", env={**os.environ, "PATH": no_cargo})
    assert done.returncode == R.EXIT_ERROR and "cargo" in done.stdout


def snapshot(root: Path) -> dict[str, bytes]:
    skip = {"target", "node_modules", "__pycache__", ".pytest_cache", "reports"}
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file() and not skip & set(p.relative_to(root).parts)}


def test_check_register_writes_nothing_outside_the_reports_folder(mini):
    assert tool(mini, "measure-touch").returncode == R.EXIT_OK
    before = snapshot(mini)
    assert tool(mini, "check-register").returncode == R.EXIT_OK
    assert snapshot(mini) == before


# ---- touched set: commands and boundary cases of task 1.11 -------------------------------------------------------------

import hashlib


def test_build_touched_set_propose_prints_the_proposal_and_never_changes_the_committed_set(tmp_path, capsys):
    root = make_code_root(tmp_path, {"src/a.py": "def f(p):\n    return p.relative_to(REPO_ROOT)\n"}, touched="# committed\n")
    before = hashlib.sha256((root / "ops/refactor/touched_set.toml").read_bytes()).hexdigest()
    assert cli(root, "build-touched-set", "--propose") == R.EXIT_OK
    assert "src/a.py::f" in capsys.readouterr().out
    assert hashlib.sha256((root / "ops/refactor/touched_set.toml").read_bytes()).hexdigest() == before


def test_build_touched_set_without_propose_is_refused(tmp_path):
    root = make_code_root(tmp_path, {})
    assert cli(root, "build-touched-set") == R.EXIT_ERROR


def test_check_touched_set_is_the_command_name_and_the_old_names_are_gone(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": "def f():\n    return 1\n"})
    assert cli(root, "check-touched-set") == R.EXIT_OK
    for old in ("check-touched", "propose-touched"):
        with pytest.raises(SystemExit):
            cli(root, old)


def test_a_function_with_exactly_one_matching_line_is_proposed(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": "def f():\n    x = 1\n    y = origin_main  # origin/main\n    return x\n"})
    assert proposed(root) == {("src/a.py", "f"): ["B"]}


def test_a_function_matching_all_of_a_to_e_lists_every_class(tmp_path):
    body = ("def f(p):\n    p.relative_to(REPO_ROOT)\n    run(['git', 'fetch'])\n    run(['git', 'commit'])\n"
            "    open('config.sh')\n    x = 'awesome-local-ai-bench-private'\n")
    assert proposed(make_code_root(tmp_path, {"src/a.py": body})) == {("src/a.py", "f"): ["A", "B", "C", "D", "E"]}


def test_a_match_on_the_first_and_on_the_last_line_of_a_file_is_found(tmp_path):
    root = make_code_root(tmp_path, {
        "src/first.sh": "run git commit\nf() {\n  echo hi\n}\n",
        "src/last.sh": "f() {\n  echo hi\n  git commit -m x",
    })
    found = proposed(root)
    assert found == {("src/first.sh", "<script>"): ["C"], ("src/last.sh", "f"): ["C"]}


def test_an_indented_arrow_function_inside_a_typescript_function_does_not_end_the_outer_one(tmp_path):
    src = ("export async function loadRuns(repo: string) {\n"
           "  const names = (xs: string[]) => xs.map((x) => x.trim());\n"
           "  await run(\"git\", \"fetch\", \"origin\");\n"
           "}\n")
    root = make_code_root(tmp_path, {"src/a.ts": src})
    assert proposed(root) == {("src/a.ts", "loadRuns"): ["B"]}


# ---- integration: the classifier on trimmed real files (task 1.12, TC-68) ------------------------------------------------

REAL = Path(__file__).parent / "fixtures" / "real"


def propose_as_process(root: Path) -> dict[tuple[str, str], str]:
    done = tool(root, "build-touched-set", "--propose")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    rows = [line.split() for line in done.stdout.splitlines() if "::" in line]
    return {(file.split("::")[0], file.split("::")[1]): classes for _, file, classes in rows}


def test_tc68_the_known_functions_are_found_with_the_expected_classes_in_unchanged_real_excerpts():
    found = propose_as_process(REAL)
    assert found[("drive.py", "record_story")].split(",")[0] == "C"
    assert found[("sources.ts", "loadRuns")] == "B"
    assert found[("collector.rs", "archived_runs")] == "B" and found[("collector.rs", "pass")] == "B"


def test_tc68_negative_a_real_function_that_only_touches_workspace_git_is_not_proposed():
    assert "def setup_workspace(" in (REAL / "drive.py").read_text()
    assert ("drive.py", "setup_workspace") not in propose_as_process(REAL)


def test_the_excerpts_carry_the_commit_they_came_from():
    for name in ("drive.py", "sources.ts", "collector.rs"):
        assert "pinned to commit" in (REAL / name).read_text().splitlines()[0]


# ---- matrix: task 1.13's assertions on the tuple, and the real U1 file --------------------------------------------------

def test_tc13_the_extra_cell_names_its_tuple_and_tc14_the_multiple_cell_names_its_tuple_and_tests(tmp_path):
    extra = matrix_result(tmp_path / "a", TWO_BY_TWO + '[[cell]]\nat = ["combination", "stopped"]\ntest = "python:t.py::a"\n')
    assert [(p.code, p.subject) for p in extra.problems] == [("E-CELL-EXTRA", "combination x stopped")]
    multiple = matrix_result(tmp_path / "b", TWO_BY_TWO.replace('test = "python:t.py::d"', 'tests = ["python:t.py::d", "python:t.py::a"]'))
    problem = multiple.problems[0]
    assert (problem.code, problem.subject) == ("E-CELL-MULTIPLE", "reference x partial") and "python:t.py::a" in problem.detail


def test_the_real_u1_file_declares_the_eight_dimensions_of_the_prd_and_yields_1024_raw_tuples():
    data = tomllib.loads((Path(__file__).parent / "matrices" / "U1.toml").read_text())
    assert list(data["dimensions"]) == ["run_kind", "story_outcome", "private_files", "credential", "heldout_title", "size",
                                        "results_root", "run_position"]
    assert R.raw_tuple_count(data["dimensions"]) == 1024


def test_tc20_the_stage_is_checked_before_and_after_every_move_including_each_refusal(tmp_path):
    root = make_root(tmp_path)
    steps = [("Matrices", ok_justifier, "Inventory", "Matrices"),       # a justified move
             ("Deleted", ok_justifier, "Matrices", "Matrices"),          # a skip is refused: unchanged
             ("Frozen", ok_justifier, "Matrices", "Matrices"),           # an unknown stage is refused: unchanged
             ("Proved", failing_justifier, "Matrices", "Matrices"),      # an unjustified move is refused: unchanged
             ("Proved", ok_justifier, "Matrices", "Proved")]
    for to, justifier, before, after in steps:
        assert stage_of(root) == before
        R.move_stage(root, to, justifiers_all(justifier))
        assert stage_of(root) == after


def test_the_printed_report_says_which_languages_were_not_measured(capsys):
    result = R.Result()
    result.data = {"not_measured": {"shell": "kcov is not available on macOS"}}
    R.print_result("check-coverage", result)
    assert "not measured  shell  kcov is not available on macOS" in capsys.readouterr().out


# ---- integration: coverage through the real tools on the mini project (task 1.15) ---------------------------------------------

def fresh_mini(tmp_path: Path) -> Path:
    """A private copy of the mini project that shares the already-installed TypeScript dependencies."""
    root = tmp_path / "mini"
    shutil.copytree(MINI, root, ignore=MINI_IGNORED)
    os.symlink(MINI_DEPS, root / "ts" / "node_modules")
    return root


MINI_DEPS = None


@pytest.fixture(scope="module")
def coverage_tools(mini):
    """Skips, with a recorded reason, when a real coverage tool is absent; never passes silently."""
    missing = [name for name, probe in (("cargo-llvm-cov", ["cargo", "llvm-cov", "--version"]), ("bun", ["bun", "--version"]),
                                        ("uv", ["uv", "--version"])) if subprocess.run(probe, capture_output=True).returncode != 0]
    if missing:
        pytest.skip(f"coverage tools not installed: {', '.join(missing)}")
    global MINI_DEPS
    MINI_DEPS = mini / "ts" / "node_modules"


def coverage_run(root: Path) -> tuple[subprocess.CompletedProcess, dict]:
    done = tool(root, "check-coverage")
    report = root / "ops/refactor/reports/coverage.json"
    return done, (json.loads(report.read_text()) if report.exists() else {})


def test_tc18_tc22_tc23_every_touched_file_at_100_in_python_rust_and_typescript_passes(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    done, report = coverage_run(root)
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    assert set(report["measured"]) == {"py/minipy/core.py::record", "py/minipy/core.py::run_dir", "rs/mini/src/lib.rs::count_lines", "ts/src/core.ts::titleOf"}
    assert all(c[0] == c[1] and c[2] == c[3] for c in report["measured"].values())      # lines and branches both fully hit
    assert report["measured"]["rs/mini/src/lib.rs::count_lines"][2] > 0                 # the Rust branches really were counted
    assert report["measured"]["ts/src/core.ts::titleOf"][2] > 0                         # and the TypeScript ones


def test_tc19_one_uncovered_line_fails_listing_the_line(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    core = root / "py/minipy/core.py"
    core.write_text(core.read_text() + "\n\ndef never_called():\n    return 'uncovered'\n")
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "py/minipy/core.py"\nfunction = "never_called"\nclasses = ["A"]\n')
    done, report = coverage_run(root)
    problem = report["problems"][0]
    assert done.returncode == R.EXIT_FAIL and problem["code"] == "E-BELOW" and problem["subject"] == "py/minipy/core.py::never_called"
    last = len(core.read_text().splitlines())
    assert f"line {last}" in problem["detail"]


def test_tc20_one_untaken_branch_with_every_line_covered_fails_listing_the_branch(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    core = root / "py/minipy/core.py"
    core.write_text(core.read_text() + "\n\ndef branchy(flag):\n    if flag:\n        marker = 1\n    return 2\n")
    (root / "py/test_core.py").write_text((root / "py/test_core.py").read_text() +
                                          "\n\ndef test_branchy_with_the_flag_set():\n    from minipy.core import branchy\n    assert branchy(True) == 2\n")
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "py/minipy/core.py"\nfunction = "branchy"\nclasses = ["A"]\n')
    done, report = coverage_run(root)
    detail = report["problems"][0]["detail"]
    assert done.returncode == R.EXIT_FAIL and "branches" in detail and "lines" not in detail
    assert "->" in detail                                                              # the untaken arc, source line to target line


def test_tc25_a_failing_test_gives_suite_red_and_exit_2(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    test = root / "py/test_core.py"
    test.write_text(test.read_text() + "\n\ndef test_that_fails():\n    assert False\n")
    done, report = coverage_run(root)
    assert done.returncode == R.EXIT_ERROR and report["problems"][0]["code"] == "E-SUITE-RED"


def test_tc24_the_missing_tool_is_exit_2_naming_it_through_the_real_command(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    rt = root / "ops/refactor/runners.toml"
    rt.write_text(rt.read_text().replace('"llvm-cov"', '"llvm-cov-not-installed"'))
    done, report = coverage_run(root)
    assert done.returncode == R.EXIT_ERROR and {p["code"] for p in report["problems"]} == {"E-TOOL-MISSING"}
    assert "llvm-cov-not-installed" in report["problems"][0]["detail"]


# ---- shell coverage through kcov (Linux): our invocation, tested with a stand-in kcov on the PATH -------------------------------

FAKE_KCOV = """#!/usr/bin/env python3
# records every call; a run writes the per-line report the real kcov writes: <out>/<script>.<hash>/codecov.json, for a copy of the
# script a test made in a temporary folder (outside the repository). Lines 1 to 7 of its nine lines run; KCOV_LINES overrides that.
import json, os, sys
args = sys.argv[1:]
out, script = args[-2], args[-1]
open(os.environ["KCOV_LOG"], "a").write(" ".join(args) + "\\n")
name = os.path.basename(script)
hit = json.loads(os.environ.get("KCOV_LINES_" + name.replace("-", "_").replace(".", "_"), os.environ.get("KCOV_LINES", "[1,2,3,4,5,6,7]")))
report = os.path.join(out, name + ".abc123")
os.makedirs(report, exist_ok=True)
lines = {str(n): (1 if n in hit else 0) for n in range(1, 10)}
json.dump({"coverage": {"/tmp/x/pub/s/target.sh": lines, "/tmp/x/pub/other.sh": {"1": 1}}}, open(os.path.join(report, "codecov.json"), "w"))
"""


def shell_root(tmp_path: Path) -> Path:
    root = make_root(tmp_path, touched='[[entry]]\nlanguage = "shell"\nfile = "s/target.sh"\nfunction = "<script>"\nclasses = ["B"]\n')
    write(root, "s/target.sh", "echo hi\n" * 9)
    write(root, "tests/target-test.sh", 'bash "$ROOT/s/target.sh"\n')
    write(root, "tests/other-test.sh", "echo other\n")
    write(root, "ops/refactor/runners.toml",
          '[shell]\nglob = "tests/*-test.sh"\n[shell.coverage]\nformat = "kcov"\n')
    return root


def use_fake_kcov(tmp_path: Path, monkeypatch, **env) -> Path:
    bin_dir = tmp_path / "bin"
    write(bin_dir, "kcov", FAKE_KCOV).chmod(0o755)
    log = tmp_path / "kcov.log"
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("KCOV_LOG", str(log))
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return log


def test_with_kcov_only_the_tests_that_name_a_touched_script_run_under_it_and_their_per_line_reports_are_read(tmp_path, monkeypatch):
    root = shell_root(tmp_path)
    log = use_fake_kcov(tmp_path, monkeypatch)
    result = R.check_coverage(root)
    calls = log.read_text().splitlines()
    assert any("tests/target-test.sh" in c for c in calls) and not any("tests/other-test.sh" in c for c in calls)
    assert not any("--merge" in c for c in calls)                              # each test's own report is read; kcov's merge re-reads sources
    assert any("--include-pattern=s/target.sh" in c for c in calls)            # only the touched scripts are watched, wherever a test runs them from
    assert [(p.code, p.subject) for p in result.problems] == [("E-BELOW", "s/target.sh::<script>")]
    assert result.problems[0].detail == "7 of 9 lines (line 8, line 9)"
    assert result.data["not_measured"] == {}


def test_kcov_gets_the_exclude_line_patterns_the_runners_file_names(tmp_path, monkeypatch):
    root = shell_root(tmp_path)
    write(root, "ops/refactor/runners.toml", '[shell]\nglob = "tests/*-test.sh"\n[shell.coverage]\nexclude_lines = ["python in a string", "more python"]\n')
    log = use_fake_kcov(tmp_path, monkeypatch)
    R.check_coverage(root)
    assert any("--exclude-line=python in a string,more python" in c for c in log.read_text().splitlines())


def test_two_tests_that_each_run_part_of_a_script_together_cover_the_lines_either_ran(tmp_path, monkeypatch):
    root = shell_root(tmp_path)
    write(root, "tests/target-more-test.sh", 'bash "$ROOT/s/target.sh" again\n')
    use_fake_kcov(tmp_path, monkeypatch, KCOV_LINES_target_test_sh="[1,2,3,4,5]", KCOV_LINES_target_more_test_sh="[5,6,7,8,9]")
    result = R.check_coverage(root)
    assert result.exit_code == R.EXIT_OK and result.data["measured"] == {"s/target.sh::<script>": [9, 9, 0, 0]}


BLIND_TABLE = ('[[shell.coverage.blind]]\nfile = "s/target.sh"\nlines = [8, 9]\n'
               'reason = "these lines run inside a command substitution, which kcov cannot see"\n')


def blind_root(tmp_path: Path, table: str) -> Path:
    root = shell_root(tmp_path)
    write(root, "ops/refactor/runners.toml", '[shell]\nglob = "tests/*-test.sh"\n[shell.coverage]\nformat = "kcov"\n' + table)
    return root


def test_lines_kcov_cannot_see_are_excused_only_when_named_with_a_reason_and_are_reported(tmp_path, monkeypatch):
    root = blind_root(tmp_path, BLIND_TABLE)
    use_fake_kcov(tmp_path, monkeypatch)                                   # lines 8 and 9 are the ones not run
    result = R.check_coverage(root)
    assert result.exit_code == R.EXIT_OK and result.problems == []
    assert result.data["measured"] == {"s/target.sh::<script>": [9, 7, 0, 0]}          # the figure is the honest one
    assert result.data["excused"] == {"s/target.sh::<script>": {"lines": [8, 9], "reason": "these lines run inside a command substitution, which kcov cannot see"}}


def test_an_unrun_line_the_table_does_not_name_still_fails(tmp_path, monkeypatch):
    root = blind_root(tmp_path, BLIND_TABLE)
    use_fake_kcov(tmp_path, monkeypatch, KCOV_LINES="[2,3,4,5,6,7]")                 # line 1 is also unrun
    result = R.check_coverage(root)
    assert [(p.code, p.detail) for p in result.problems] == [("E-BELOW", "8 of 9 lines (line 1)")]


def test_a_named_line_kcov_does_see_run_is_a_stale_entry(tmp_path, monkeypatch):
    root = blind_root(tmp_path, BLIND_TABLE)
    use_fake_kcov(tmp_path, monkeypatch, KCOV_LINES="[1,2,3,4,5,6,7,8]")              # line 8 now runs
    result = R.check_coverage(root)
    assert [(p.code, p.subject) for p in result.problems] == [("E-BLIND-STALE", "s/target.sh:8")]


def test_a_named_line_that_is_not_an_instrumented_line_is_a_stale_entry(tmp_path, monkeypatch):
    root = blind_root(tmp_path, BLIND_TABLE.replace("[8, 9]", "[8, 9, 40]"))
    use_fake_kcov(tmp_path, monkeypatch)
    result = R.check_coverage(root)
    assert [(p.code, p.subject) for p in result.problems] == [("E-BLIND-STALE", "s/target.sh:40")]


def test_an_entry_without_a_reason_is_refused(tmp_path, monkeypatch):
    root = blind_root(tmp_path, '[[shell.coverage.blind]]\nfile = "s/target.sh"\nlines = [8, 9]\nreason = ""\n')
    use_fake_kcov(tmp_path, monkeypatch)
    assert "E-BLIND-NO-REASON" in codes(R.check_coverage(root))


def test_the_printed_report_names_the_excused_lines_and_why(capsys):
    result = R.Result()
    result.data = {"excused": {"s/target.sh::<script>": {"lines": [8, 9], "reason": "inside a command substitution"}}}
    R.print_result("check-coverage", result)
    assert "excused  s/target.sh::<script>  lines 8, 9: inside a command substitution" in capsys.readouterr().out


def test_kcov_per_line_data_is_read_by_the_end_of_each_path_and_the_larger_hit_count_wins(tmp_path):
    root = make_root(tmp_path)
    report = {"coverage": {"/tmp/a/pub/s/t.sh": {"1": 2, "2": 0}, "/tmp/a/pub/unrelated.sh": {"1": 1}}}
    first = R.parse_kcov(root, report, ["s/t.sh"])
    second = R.parse_kcov(root, {"coverage": {"/elsewhere/s/t.sh": {"1": 0, "2": 3}}}, ["s/t.sh"])
    assert set(first) == {"s/t.sh"} and first["s/t.sh"].lines == {1: 2, 2: 0}
    assert R.combine_lines(first, second)["s/t.sh"].lines == {1: 2, 2: 3}


def test_without_kcov_on_the_path_shell_is_not_measured_and_the_check_still_decides(tmp_path, monkeypatch):
    root = shell_root(tmp_path)
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    assert shutil.which("kcov") is None
    result = R.check_coverage(root)
    assert result.exit_code == R.EXIT_OK and list(result.data["not_measured"]) == ["shell"]


# ---- stubs: the boundaries of task 1.16 ---------------------------------------------------------------------------------------

def test_boundary_a_single_touched_function_that_is_a_stub_passes(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": 'def only():\n    raise NotImplementedError\n'}, touched=entry("python", "src/a.py", "only", '"B"'))
    assert R.check_stubs(root).exit_code == R.EXIT_OK


def test_boundary_an_empty_touched_set_has_nothing_to_stub_and_passes(tmp_path):
    assert R.check_stubs(make_root(tmp_path)).exit_code == R.EXIT_OK


@pytest.mark.parametrize("language,file,body", [
    ("rust", "src/c.rs", "fn pull() {\n    // todo\n}\n"),
    ("shell", "src/x.sh", "pull() {\n  # nothing yet\n}\n"),
    ("typescript", "src/s.ts", "export function pull() {\n  // nothing yet\n}\n"),
])
def test_boundary_a_function_whose_body_is_only_a_comment_is_not_a_stub(tmp_path, language, file, body):
    root = make_code_root(tmp_path, {file: body}, touched=entry(language, file, "pull", '"B"'))
    result = R.check_stubs(root)
    assert result.exit_code == R.EXIT_FAIL and [p.code for p in result.problems] == ["E-NOT-STUB"]


# ---- result readers: canned output in each runner's real format (task 1.5) -------------------------------------------------

JUNIT = """<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="4">
<testcase classname="test_core" name="test_a" file="test_core.py" line="3"><failure message="NotImplementedError: deleted">trace</failure></testcase>
<testcase classname="test_core.TestC" name="test_b[x-1]" file="test_core.py" line="9" />
<testcase classname="test_core" name="test_c" file="test_core.py" line="12"><failure message="assert 1 == 2">trace</failure></testcase>
<testcase classname="" name="test_broken"><error message="collection failure">SyntaxError: invalid syntax</error></testcase>
</testsuite></testsuites>"""
CARGO_JSON = "\n".join(json.dumps(e) for e in [
    {"type": "suite", "event": "started", "test_count": 3},
    {"type": "test", "event": "started", "name": "tests::a"},
    {"type": "test", "name": "tests::a", "event": "failed", "stdout": "thread 'tests::a' panicked at src/lib.rs:4:5:\nnot yet implemented\n"},
    {"type": "test", "name": "tests::b", "event": "ok"},
    {"type": "test", "name": "tests::c", "event": "failed", "stdout": "assertion failed: x"},
    {"type": "suite", "event": "failed", "passed": 1, "failed": 2},
])
VITEST_JSON = json.dumps({"testResults": [{"name": "/r/ts/src/core.test.ts", "assertionResults": [
    {"ancestorTitles": ["a run"], "title": "shows it", "fullName": "a run shows it", "status": "failed", "failureMessages": ["Error: not implemented"]},
    {"ancestorTitles": [], "title": "plain", "fullName": "plain", "status": "passed", "failureMessages": []},
    {"ancestorTitles": [], "title": "other", "fullName": "other", "status": "failed", "failureMessages": ["expected 1 to be 2"]},
]}]})
SHELL_JSON = json.dumps({"tests/one-test.sh": {"code": 1, "output": "  FAIL true succeeds\\n  expected: exit 0\\n  actual:   exit 99"},
                         "tests/two-test.sh": {"code": 0, "output": "all 2 checks passed"},
                         "tests/three-test.sh": {"code": 1, "output": "syntax error near unexpected token"}})


def test_the_junit_reader_gives_ids_with_the_runner_folder_and_names_the_stub_failures():
    outcomes, file_failures = R.parse_junit("py", JUNIT)
    assert outcomes == {"python:py/test_core.py::test_a": R.FAILED_STUB, "python:py/test_core.py::TestC::test_b[x-1]": R.PASSED,
                        "python:py/test_core.py::test_c": R.FAILED_OTHER}
    assert file_failures == {"python:py/test_broken.py"}


def test_the_cargo_json_reader_gives_outcomes_by_test_name_and_names_the_stub_failures():
    assert R.parse_cargo_json(CARGO_JSON) == {"tests::a": R.FAILED_STUB, "tests::b": R.PASSED, "tests::c": R.FAILED_OTHER}


def test_the_vitest_json_reader_joins_the_titles_the_way_vitest_list_does(tmp_path):
    outcomes = R.parse_vitest_json(Path("/r"), VITEST_JSON)
    assert outcomes == {"typescript:ts/src/core.test.ts::a run > shows it": R.FAILED_STUB,
                        "typescript:ts/src/core.test.ts::plain": R.PASSED, "typescript:ts/src/core.test.ts::other": R.FAILED_OTHER}


def test_the_shell_reader_treats_a_99_in_the_output_as_the_stub_and_zero_as_passed():
    assert R.parse_shell_results(SHELL_JSON) == {"shell:tests/one-test.sh": R.FAILED_STUB, "shell:tests/two-test.sh": R.PASSED,
                                                 "shell:tests/three-test.sh": R.FAILED_OTHER}


def test_a_syntax_error_in_a_test_file_marks_each_assigned_test_of_that_file_failed_other(tmp_path):
    root = deletion_root(tmp_path)
    write(root, "ops/refactor/assignments.toml", '[assignments]\nU1 = ["python:py/test_broken.py::test_x", "python:py/test_broken.py::test_y"]\n')
    broken = R.Results(outcomes={}, file_failures={"python:py/test_broken.py"})
    result = R.report_deletion(root, broken)
    assert [(p.code, p.subject) for p in result.problems] == [("E-STUB-FAILS-TO-IMPORT", "python:py/test_broken.py::test_x"),
                                                              ("E-STUB-FAILS-TO-IMPORT", "python:py/test_broken.py::test_y")]


def test_a_rust_assigned_test_is_matched_to_its_outcome_by_name(tmp_path):
    root = deletion_root(tmp_path)
    write(root, "ops/refactor/assignments.toml", '[assignments]\nU1 = ["rust:rs/mini/src/lib.rs::tests::a"]\n')
    assert R.report_deletion(root, R.Results(outcomes={}, rust_names={"tests::a": R.FAILED_STUB})).exit_code == R.EXIT_OK
    assert [p.code for p in R.report_deletion(root, R.Results(outcomes={}, rust_names={"tests::a": R.PASSED})).problems] == ["E-ASSIGNED-PASSED"]


# ---- integration: the whole-suite deletion report on the mini project (task 1.17, TC-30 to TC-32, TC-34) -------------------

STUBBED = {
    "py/minipy/core.py": "def record(items, limit):\n    raise NotImplementedError(\"deleted\")\n\n\ndef run_dir(data_root, run_id):\n    raise NotImplementedError(\"deleted\")\n",
    "rs/mini/src/lib.rs": ("pub fn count_lines(_listing: &str) -> usize {\n    todo!()\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n"
                           "    #[test]\n    fn an_empty_listing_has_no_lines() {\n        assert_eq!(count_lines(\"\"), 0);\n    }\n\n"
                           "    #[test]\n    fn a_listing_counts_its_lines() {\n        assert_eq!(count_lines(\"a\\nb\"), 2);\n    }\n}\n"),
    "ts/src/core.ts": "export function titleOf(run: { title?: string }): string {\n  throw new Error(\"not implemented: deleted\")\n}\n",
}
SIX_ASSIGNED_MINI = """[assignments]
U1 = ["python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit", "python:py/test_core.py::test_run_dir_joins_the_root_and_the_run_id"]
U2 = ["rust:rs/mini/src/lib.rs::tests::an_empty_listing_has_no_lines", "rust:rs/mini/src/lib.rs::tests::a_listing_counts_its_lines"]
U3 = ["typescript:ts/src/core.test.ts::a run with a title shows it", "typescript:ts/src/core.test.ts::a run without a title is untitled"]
"""


def stubbed_mini(tmp_path: Path) -> Path:
    root = fresh_mini(tmp_path)
    for rel, text in STUBBED.items():
        (root / rel).write_text(text)
    (root / "ops/refactor/assignments.toml").write_text(SIX_ASSIGNED_MINI)
    write_stage(root, "Deleted")
    return root


def delete_report(root: Path) -> tuple[subprocess.CompletedProcess, dict]:
    ran = tool(root, "run-suites")
    assert ran.returncode == R.EXIT_OK, ran.stdout + ran.stderr
    done = tool(root, "report-deletion")
    report = root / "ops/refactor/reports/deletion.json"
    return done, (json.loads(report.read_text()) if report.exists() else {})


def test_tc30_all_six_assigned_tests_fail_for_the_stub_and_the_exit_is_0(coverage_tools, tmp_path):
    done, report = delete_report(stubbed_mini(tmp_path))
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    assert len(report["assigned_failed"]) == 6


def test_tc31_and_w1_an_assigned_test_that_passes_is_refused_by_name_and_the_stage_goes_back_to_proved(coverage_tools, tmp_path):
    root = stubbed_mini(tmp_path)
    test = root / "py/test_core.py"
    test.write_text(test.read_text().replace("assert record([\"a\", \"b\", \"c\"], 2) == [\"a\", \"b\"]", "assert True"))
    done, report = delete_report(root)
    assert done.returncode == R.EXIT_FAIL
    assert [(p["code"], p["subject"]) for p in report["problems"]] == [
        ("E-ASSIGNED-PASSED", "python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit")]
    assert (root / "ops/refactor/stage.toml").read_text().startswith('stage = "Proved"')


def test_tc32_an_unassigned_test_that_fails_means_the_partition_is_not_mece(coverage_tools, tmp_path):
    root = stubbed_mini(tmp_path)
    (root / "tests/three-test.sh").write_text("#!/usr/bin/env bash\nexit 1\n")
    done, report = delete_report(root)
    assert done.returncode == R.EXIT_FAIL
    assert [(p["code"], p["subject"]) for p in report["problems"]] == [("E-OUTSIDE-FAILED", "shell:tests/three-test.sh")]


def test_tc34_a_syntax_error_in_a_test_file_is_stub_fails_to_import_not_a_pass(coverage_tools, tmp_path):
    root = stubbed_mini(tmp_path)
    (root / "py/test_core.py").write_text("def test_x(:\n    pass\n")
    done, report = delete_report(root)
    assert done.returncode == R.EXIT_FAIL
    assert {p["code"] for p in report["problems"]} == {"E-STUB-FAILS-TO-IMPORT"}
    assert {p["subject"] for p in report["problems"]} == {
        "python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit", "python:py/test_core.py::test_run_dir_joins_the_root_and_the_run_id"}


def test_tc33_through_the_process_a_runner_that_wrote_no_result_file_is_refused(coverage_tools, tmp_path):
    root = stubbed_mini(tmp_path)
    done = tool(root, "report-deletion")                      # run-suites was never run: no result files exist
    report = json.loads((root / "ops/refactor/reports/deletion.json").read_text())
    assert done.returncode == R.EXIT_FAIL and "E-RESULTS-MISSING" in {p["code"] for p in report["problems"]}


def test_a_typescript_stub_with_braces_in_its_parameter_and_return_types_is_still_a_stub(tmp_path):
    src = ('export function titleOf(run: { title?: string }): Promise<{ ok: boolean }> {\n'
           '  throw new Error("not implemented");\n}\n')
    root = make_code_root(tmp_path, {"src/s.ts": src}, touched=entry("typescript", "src/s.ts", "titleOf", '"C"'))
    assert R.check_stubs(root).exit_code == R.EXIT_OK


def test_a_typescript_function_with_braces_in_its_types_and_a_real_body_is_not_a_stub(tmp_path):
    src = 'export function titleOf(run: { title?: string }): string {\n  return run.title ?? "x";\n}\n'
    root = make_code_root(tmp_path, {"src/s.ts": src}, touched=entry("typescript", "src/s.ts", "titleOf", '"C"'))
    assert [p.code for p in R.check_stubs(root).problems] == ["E-NOT-STUB"]


def test_a_rust_stub_with_a_where_clause_and_generic_braces_is_still_a_stub(tmp_path):
    src = 'pub fn pull<T>(x: T) -> Vec<T>\nwhere\n    T: Clone,\n{\n    todo!()\n}\n'
    root = make_code_root(tmp_path, {"src/c.rs": src}, touched=entry("rust", "src/c.rs", "pull", '"B"'))
    assert R.check_stubs(root).exit_code == R.EXIT_OK


# ---- fates and contract areas (tasks 1.6 and 1.18) ------------------------------------------------------------------------------

FIVE = ["python:a.py::t1", "python:a.py::t2", "python:b.py::t1", "python:b.py::t2", "python:c.py::t1"]
FIVE_ASSIGNED = "[assignments]\nU1 = [" + ", ".join(f'"{t}"' for t in FIVE) + "]\n"
CONTRACT_AREAS = ("data_root", "run_id_goldens", "allow_list", "lake_ingest", "lake_readers", "job_inputs", "export_step")


def fate_block(test: str, state: str, extra: str = "") -> str:
    return f'[[fate]]\ntest = "{test}"\nstate = "{state}"\n{extra}'


def fates_root(tmp_path: Path, fates: str, assigned: str = FIVE_ASSIGNED) -> Path:
    root = make_root(tmp_path, assignments=assigned, touched=FATE_TOUCHED)
    write(root, "ops/refactor/fates.toml", fates)
    return root


FIVE_FATES = "\n".join([
    fate_block(FIVE[0], "kept"),
    fate_block(FIVE[1], "rewritten", 'new_test = "python:a.py::t1_new"\n'),
    fate_block(FIVE[2], "retired", 'function = "src/a.py::record"\nreason = "the function is deleted"\n'),
    fate_block(FIVE[3], "kept"),
    fate_block(FIVE[4], "rewritten", 'new_test = "python:c.py::t1_new"\n'),
])


def test_tc39_five_old_tests_with_five_fates_render_a_markdown_table_with_each_id_once(tmp_path):
    root = fates_root(tmp_path, FIVE_FATES)
    assert R.check_fates(root).exit_code == R.EXIT_OK
    table = R.render_fates(root)
    for test in FIVE:
        assert table.count(f"`{test}`") == 1
    assert table.splitlines()[0].startswith("| old test | fate |") and "retired with `src/a.py::record`" in table


def test_tc40_an_old_test_with_no_fate_is_e_no_fate_naming_it(tmp_path):
    root = fates_root(tmp_path, FIVE_FATES.replace(fate_block(FIVE[3], "kept"), ""))
    result = R.check_fates(root)
    assert result.exit_code == R.EXIT_FAIL and [(p.code, p.subject) for p in result.problems] == [("E-NO-FATE", FIVE[3])]


def test_tc41_a_fate_of_maybe_is_invalid(tmp_path):
    root = fates_root(tmp_path, FIVE_FATES.replace(fate_block(FIVE[0], "kept"), fate_block(FIVE[0], "maybe")))
    assert [(p.code, p.subject) for p in R.check_fates(root).problems] == [("E-FATE-INVALID", FIVE[0])]


def test_tc42_a_retired_test_without_the_deleted_function_it_covered_is_refused(tmp_path):
    root = fates_root(tmp_path, FIVE_FATES.replace('function = "src/a.py::record"\n', ""))
    assert [(p.code, p.subject) for p in R.check_fates(root).problems] == [("E-RETIRED-NO-FUNCTION", FIVE[2])]


def test_boundary_one_old_test_only_and_every_fate_retired(tmp_path):
    one = fates_root(tmp_path / "a", fate_block(FIVE[0], "kept"), '[assignments]\nU1 = ["python:a.py::t1"]\n')
    assert R.check_fates(one).exit_code == R.EXIT_OK and R.render_fates(one).count("python:a.py::t1") == 1
    retired = "\n".join(fate_block(t, "retired", 'function = "src/a.py::record"\nreason = "gone"\n') for t in FIVE)
    assert R.check_fates(fates_root(tmp_path / "b", retired)).exit_code == R.EXIT_OK


def contracts_root(tmp_path: Path, contracts: str) -> Path:
    root = make_root(tmp_path)
    areas = "[areas]\n" + "".join(f'{a} = "{a}"\n' for a in CONTRACT_AREAS)
    write(root, "ops/refactor/new_contracts.toml", areas + contracts)
    return root


ALL_AREAS_COVERED = "".join(f'[[contract]]\narea = "{a}"\ntest = "python:n.py::{a}"\n' for a in CONTRACT_AREAS)


def red(*tests: str, passed: tuple[str, ...] = ()) -> R.Results:
    return R.Results(outcomes={**{f"python:n.py::{t}": R.FAILED_OTHER for t in tests}, **{f"python:n.py::{t}": R.PASSED for t in passed}})


def test_tc45_a_contract_area_with_no_new_test_is_e_contract_missing_naming_the_area(tmp_path):
    root = contracts_root(tmp_path, ALL_AREAS_COVERED.replace('area = "export_step"\ntest = "python:n.py::export_step"\n', 'area = "data_root"\ntest = "python:n.py::data_root_2"\n'))
    result = R.check_contracts(root, red(*CONTRACT_AREAS, "data_root_2"))
    assert result.exit_code == R.EXIT_FAIL and [(p.code, p.subject) for p in result.problems] == [("E-CONTRACT-MISSING", "export_step")]


def test_every_area_covered_by_a_new_test_seen_failing_passes(tmp_path):
    assert R.check_contracts(contracts_root(tmp_path, ALL_AREAS_COVERED), red(*CONTRACT_AREAS)).exit_code == R.EXIT_OK


def test_tc44_a_new_test_that_already_passes_is_not_red_and_is_named(tmp_path):
    root = contracts_root(tmp_path, ALL_AREAS_COVERED)
    others = tuple(a for a in CONTRACT_AREAS if a != "lake_ingest")
    result = R.check_contracts(root, red(*others, passed=("lake_ingest",)))
    assert [(p.code, p.subject) for p in result.problems] == [("E-CONTRACT-NOT-RED", "python:n.py::lake_ingest")]


def test_a_new_test_with_no_result_cannot_be_called_red(tmp_path):
    root = contracts_root(tmp_path, ALL_AREAS_COVERED)
    result = R.check_contracts(root, red(*CONTRACT_AREAS[:-1]))
    assert [(p.code, p.subject) for p in result.problems] == [("E-RESULTS-MISSING", "python:n.py::export_step")]


def test_a_contract_naming_an_unknown_area_is_refused(tmp_path):
    root = contracts_root(tmp_path, ALL_AREAS_COVERED + '[[contract]]\narea = "not_an_area"\ntest = "python:n.py::x"\n')
    assert "E-CONTRACT-AREA-UNKNOWN" in codes(R.check_contracts(root, red(*CONTRACT_AREAS, "x")))


def test_the_fates_command_checks_fates_and_contracts_and_renders_the_table_to_a_file(tmp_path, capsys):
    root = fates_root(tmp_path, FIVE_FATES)
    write(root, "ops/refactor/new_contracts.toml", "[areas]\n" + "".join(f'{a} = "{a}"\n' for a in CONTRACT_AREAS) + ALL_AREAS_COVERED)
    write(root, "ops/refactor/reports/results-python.xml", "<testsuites>" + "".join(
        f'<testcase classname="n" name="{a}" file="n.py"><failure message="x">t</failure></testcase>' for a in CONTRACT_AREAS) + "</testsuites>")
    write(root, "ops/refactor/runners.toml", '[python]\ndir = "."\ncommand = ["true"]\n[python.results]\nformat = "junit"\ncommand = ["true"]\n')
    assert cli(root, "fates", "--render", str(root / "plans/fates.md")) == R.EXIT_OK
    assert (root / "plans/fates.md").read_text().count("python:a.py::t1") >= 1


# ---- integration: new contracts must be seen red, with real runner results (task 1.19, TC-43 and TC-44) ----------------------

SIX_OLD = ["python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit", "python:py/test_core.py::test_run_dir_joins_the_root_and_the_run_id",
           "rust:rs/mini/src/lib.rs::tests::an_empty_listing_has_no_lines", "rust:rs/mini/src/lib.rs::tests::a_listing_counts_its_lines",
           "typescript:ts/src/core.test.ts::a run with a title shows it", "typescript:ts/src/core.test.ts::a run without a title is untitled"]
NEW_PY = "py/test_new.py::test_new_python_contract"
NEW_RS = "rs/mini/src/lib.rs::tests::new_rust_contract"
NEW_TS = "ts/src/core.test.ts::new ts contract"


def mini_with_three_new_contracts(tmp_path: Path) -> Path:
    root = stubbed_mini(tmp_path)
    (root / "py/test_new.py").write_text("def test_new_python_contract():\n    from minipy.core import data_root\n    assert data_root('x') == 'x'\n")
    lib = root / "rs/mini/src/lib.rs"
    lib.write_text(lib.read_text().rstrip()[:-1] + '\n    #[test]\n    fn new_rust_contract() {\n        assert_eq!(count_lines("x"), 1);\n    }\n}\n')
    ts = root / "ts/src/core.test.ts"
    ts.write_text(ts.read_text() + '\ntest("new ts contract", () => {\n  expect(titleOf({})).toBe("untitled")\n})\n')
    (root / "ops/refactor/fates.toml").write_text("".join(fate_block(t, "kept") + "\n" for t in SIX_OLD))
    (root / "ops/refactor/new_contracts.toml").write_text(
        '[areas]\npython_area = "p"\nrust_area = "r"\nts_area = "t"\n'
        f'[[contract]]\narea = "python_area"\ntest = "python:{NEW_PY}"\n[[contract]]\narea = "rust_area"\ntest = "rust:{NEW_RS}"\n'
        f'[[contract]]\narea = "ts_area"\ntest = "typescript:{NEW_TS}"\n')
    return root


def test_tc43_three_new_contract_tests_that_all_fail_before_reimplementation_give_exit_0(coverage_tools, tmp_path):
    root = mini_with_three_new_contracts(tmp_path)
    assert tool(root, "run-suites").returncode == R.EXIT_OK
    done = tool(root, "fates")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr


def test_tc44_one_of_three_already_passing_is_not_red_and_is_named(coverage_tools, tmp_path):
    root = mini_with_three_new_contracts(tmp_path)
    (root / "py/test_new.py").write_text("def test_new_python_contract():\n    assert True\n")
    assert tool(root, "run-suites").returncode == R.EXIT_OK
    done = tool(root, "fates")
    report = json.loads((root / "ops/refactor/reports/contracts.json").read_text())
    assert done.returncode == R.EXIT_FAIL
    assert [(p["code"], p["subject"]) for p in report["problems"]] == [("E-CONTRACT-NOT-RED", f"python:{NEW_PY}")]


# ---- stage: entering RedContracts needs the contracts seen red (task 1.7) ----------------------------------------------------

def red_contracts_root(tmp_path: Path, contract_result: str) -> Path:
    root = deletion_root(tmp_path)           # stage Deleted, one assigned test, a stub in place
    write(root, "ops/refactor/reports/deletion.json", json.dumps({"exit_code": 0, "problems": []}))
    write(root, "ops/refactor/assignments.toml", '[assignments]\nU1 = ["python:t_a"]\n')
    write(root, "ops/refactor/fates.toml", fate_block("python:t_a", "kept"))
    write(root, "ops/refactor/new_contracts.toml", '[areas]\nonly = "the only area"\n[[contract]]\narea = "only"\ntest = "python:n.py::new"\n')
    write(root, "ops/refactor/runners.toml", '[python]\ndir = "."\ncommand = ["true"]\n[python.results]\nformat = "junit"\ncommand = ["true"]\n')
    body = '<failure message="x">t</failure>' if contract_result == "fails" else ""
    write(root, "ops/refactor/reports/results-python.xml",
          f'<testsuites><testcase classname="n" name="new" file="n.py">{body}</testcase></testsuites>')
    return root


def test_the_move_into_red_contracts_needs_every_new_contract_test_seen_failing(tmp_path):
    ok = red_contracts_root(tmp_path / "a", "fails")
    assert cli(ok, "stage", "RedContracts") == R.EXIT_OK and stage_of(ok) == "RedContracts"
    not_red = red_contracts_root(tmp_path / "b", "passes")
    assert cli(not_red, "stage", "RedContracts") == R.EXIT_FAIL and stage_of(not_red) == "Deleted"


# ---- integration: justified moves and atomic writes (task 1.21, TC-48 and TC-53) --------------------------------------------

MINI_TEST = "python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit"


def mini_at_matrices(tmp_path: Path) -> Path:
    """The mini project at stage Matrices with a one-cell matrix for each of the fourteen use cases."""
    root = fresh_mini(tmp_path)
    assert tool(root, "measure-touch").returncode == R.EXIT_OK
    (root / "ops/refactor/stage.toml").write_text('stage = "Matrices"\n')
    for n in range(1, 15):
        (root / f"ops/refactor/matrices/U{n}.toml").parent.mkdir(exist_ok=True)
        (root / f"ops/refactor/matrices/U{n}.toml").write_text(f'[dimensions]\nonly = ["x"]\n\n[[cell]]\nat = ["x"]\ntest = "{MINI_TEST}"\n')
    return root


def test_tc48_a_move_from_matrices_to_proved_while_coverage_fails_is_not_justified_and_the_stage_stays(coverage_tools, tmp_path):
    root = mini_at_matrices(tmp_path)
    core = root / "py/minipy/core.py"
    core.write_text(core.read_text() + "\n\ndef never_called():\n    return 'uncovered'\n")
    touched = root / "ops/refactor/touched_set.toml"
    touched.write_text(touched.read_text() + '\n[[entry]]\nlanguage = "python"\nfile = "py/minipy/core.py"\nfunction = "never_called"\nclasses = ["A"]\n')
    done = tool(root, "stage", "Proved")
    assert done.returncode == R.EXIT_FAIL and "E-NOT-JUSTIFIED" in done.stdout and "E-BELOW" in done.stdout
    assert (root / "ops/refactor/stage.toml").read_text() == 'stage = "Matrices"\n'


def test_tc48_positive_with_the_matrices_and_coverage_green_the_same_move_succeeds(coverage_tools, tmp_path):
    root = mini_at_matrices(tmp_path)
    done = tool(root, "stage", "Proved")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    assert tool(root, "stage").stdout.splitlines()[-1] == "Proved"


KILL_POINTS = {
    "before the data is flushed": "os.fsync",
    "before the rename": "os.replace",
    "just after the rename": "after-replace",
}


@pytest.mark.parametrize("where", sorted(KILL_POINTS))
def test_tc53_killed_at_each_point_of_the_write_the_file_is_whole_old_or_whole_new_never_partial(tmp_path, where):
    target = tmp_path / "stage.toml"
    old, new = 'stage = "Inventory"\n', 'stage = "Matrices"\n' + "# padding to make a partial write visible\n" * 200
    target.write_text(old)
    point = KILL_POINTS[where]
    kill = "os.kill(os.getpid(), signal.SIGKILL)"
    patch = (f"_real = os.replace\ndef _replace(*a, **k):\n    _real(*a, **k)\n    {kill}\nos.replace = _replace\n" if point == "after-replace"
             else f"os.{point.split('.')[1]} = lambda *a, **k: {kill}\n")
    script = ("import os, signal, sys, pathlib\nsys.path.insert(0, %r)\nimport refactor as R\n%s"
              "R.atomic_write(pathlib.Path(%r), %r)\n" % (str(Path(R.__file__).parent), patch, str(target), new))
    proc = subprocess.run([sys.executable, "-c", script])
    assert proc.returncode != 0
    assert target.read_text() in (old, new)


# ---- idle guard over dbench status (tasks 1.8 and 1.22) ----------------------------------------------------------------------------

CAPTURE = Path(__file__).parent / "fixtures" / "dbench-status-capture.json"


def status_text(**nodes) -> str:
    """dbench status --json: {node: [jobs]}; a job is its id, its state and the story it is on."""
    def job(i, status, story=None):
        return {"id": i, "state": {"status": status}, "progress": {"current_story": story}}
    return json.dumps({n: [job(*j) for j in jobs] for n, jobs in nodes.items()})


def test_tc54_a_node_with_no_job_is_idle():
    assert R.guard_idle("n1", status_text(n1=[])).exit_code == R.EXIT_OK


def test_tc55_a_node_with_only_queued_jobs_is_idle():
    assert R.guard_idle("n1", status_text(n1=[("j1", "queued"), ("j2", "queued", "7"), ("j3", "done"), ("j4", "failed"), ("j5", "cancelled")])).exit_code == R.EXIT_OK


def test_tc56_a_job_running_story_4_is_busy_naming_the_job_and_the_story():
    result = R.guard_idle("n1", status_text(n1=[("j1", "queued"), ("j2", "running", "4")]))
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems] == [("E-MACHINE-BUSY", "j2")] and "story 4" in result.problems[0].detail


def test_a_running_job_that_has_not_started_a_story_is_still_busy():
    result = R.guard_idle("n1", status_text(n1=[("j2", "running", None)]))
    assert result.exit_code == R.EXIT_FAIL and "story" in result.problems[0].detail


@pytest.mark.parametrize("text", ["not json", "", "[]", '{"other": []}', '{"n1": "oops"}', '{"n1": [{"id": "j"}]}',
                                  '{"n1": [{"id": "j", "state": {"status": "paused"}, "progress": {}}]}'])
def test_tc58_anything_that_is_not_a_status_of_the_named_node_is_unparseable_never_idle(text):
    result = R.guard_idle("n1", text)
    assert result.exit_code == R.EXIT_ERROR and [p.code for p in result.problems] == ["E-STATUS-UNPARSEABLE"]


def test_tc59_a_trimmed_capture_of_real_dbench_status_output_is_parsed_and_the_exit_follows_its_content():
    text = CAPTURE.read_text()
    busy = R.guard_idle("node-a", text)
    assert busy.exit_code == R.EXIT_FAIL and busy.problems[0].subject == "vidi-v2-iq4xs-llamacpp-r2" and "story 5" in busy.problems[0].detail
    assert R.guard_idle("node-b", text).exit_code == R.EXIT_OK          # queued and done only (the node is held)
    assert R.guard_idle("node-c", text).exit_code == R.EXIT_OK
    assert R.guard_idle("not-in-the-capture", text).exit_code == R.EXIT_ERROR


# ---- integration: an unreachable node and a caller that stops (task 1.23, TC-57 and TC-60 / workflow W-2) --------------------------

STAND_IN_DBENCH = """#!/usr/bin/env python3
# a stand-in dbench: `status --json NODE` prints what the real one printed (a trimmed capture), or exits non-zero
import json, os, sys
if os.environ.get("STAND_IN_UNREACHABLE"):
    sys.stderr.write("Error: cannot reach the node\\n"); sys.exit(1)
node = sys.argv[-1]
capture = json.load(open(os.environ["STAND_IN_CAPTURE"]))
print(json.dumps({node: capture[node]}) if node in capture else "")
"""


def with_stand_in_dbench(tmp_path: Path, **env) -> dict:
    bin_dir = tmp_path / "bin"
    write(bin_dir, "dbench", STAND_IN_DBENCH).chmod(0o755)
    return {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "STAND_IN_CAPTURE": str(CAPTURE), **env}


def test_tc57_a_dbench_that_exits_non_zero_is_exit_2_unreachable(tmp_path):
    root = make_root(tmp_path)
    done = tool(root, "guard-idle", "node-a", env=with_stand_in_dbench(tmp_path, STAND_IN_UNREACHABLE="1"))
    assert done.returncode == R.EXIT_ERROR and "E-UNREACHABLE" in done.stdout


def test_a_dbench_that_is_not_installed_is_also_unreachable(tmp_path):
    root = make_root(tmp_path)
    done = tool(root, "guard-idle", "node-a", env={**os.environ, "PATH": "/usr/bin:/bin"})
    assert done.returncode == R.EXIT_ERROR and "E-UNREACHABLE" in done.stdout


SWITCH_SCRIPT = """#!/bin/sh
# a stand-in for the layout, install and switch scripts of stories 2 and 12: ask the guard first, stop on any non-zero exit
python3 "$TOOL" --root "$ROOT" guard-idle "$NODE" || exit $?
echo changed > "$WORK/changed.txt"
"""


def run_switch(tmp_path: Path, node: str) -> tuple[subprocess.CompletedProcess, Path]:
    work = tmp_path / "work"
    work.mkdir(parents=True)
    (work / "keep.txt").write_text("untouched")
    script = write(tmp_path, "switch.sh", SWITCH_SCRIPT)
    env = {**with_stand_in_dbench(tmp_path), "TOOL": str(TOOL), "ROOT": str(make_root(tmp_path / "root")), "NODE": node, "WORK": str(work)}
    return subprocess.run(["sh", str(script)], env=env, capture_output=True, text=True), work


def test_tc60_and_w2_a_switch_script_that_calls_the_guard_first_stops_before_touching_any_file_while_a_story_runs(tmp_path):
    done, work = run_switch(tmp_path, "node-a")                 # the real capture has a story running on node-a
    assert done.returncode == R.EXIT_FAIL and "E-MACHINE-BUSY" in done.stdout and "story 5" in done.stdout
    assert sorted(p.name for p in work.iterdir()) == ["keep.txt"] and (work / "keep.txt").read_text() == "untouched"


def test_w2_negative_with_an_idle_status_the_same_script_proceeds(tmp_path):
    done, work = run_switch(tmp_path, "node-b")
    assert done.returncode == 0 and (work / "changed.txt").read_text() == "changed\n"


def test_a_failing_new_contract_test_is_not_an_outside_failure_but_any_other_failing_outsider_still_is(tmp_path):
    root = deletion_root(tmp_path)
    write(root, "ops/refactor/assignments.toml", '[assignments]\nU1 = ["python:t_a"]\n')
    write(root, "ops/refactor/new_contracts.toml", '[areas]\nonly = "x"\n[[contract]]\narea = "only"\ntest = "python:n.py::new"\n')
    outcomes = {"python:t_a": R.FAILED_STUB, "python:n.py::new": R.FAILED_OTHER}
    assert R.report_deletion(root, R.Results(outcomes=outcomes)).exit_code == R.EXIT_OK
    result = R.report_deletion(root, R.Results(outcomes={**outcomes, "python:other.py::x": R.FAILED_OTHER}))
    assert [(p.code, p.subject) for p in result.problems] == [("E-OUTSIDE-FAILED", "python:other.py::x")]


# ---- end to end: workflows W-1 and W-2 on the mini project, tool run as a process with the real runners (task 1.31) -------------------

def stage_now(root: Path) -> str:
    return tool(root, "stage").stdout.splitlines()[-1]      # the scope line comes first


def test_w1_the_whole_method_in_order_then_a_planted_passing_test_sends_the_stage_back_to_proved(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    assert tool(root, "measure-touch").returncode == R.EXIT_OK
    for n in range(1, 15):
        (root / "ops/refactor/matrices").mkdir(exist_ok=True)
        (root / f"ops/refactor/matrices/U{n}.toml").write_text(f'[dimensions]\nonly = ["x"]\n\n[[cell]]\nat = ["x"]\ntest = "{MINI_TEST}"\n')
    assert stage_now(root) == "Inventory"

    for command in (["check-register"], ["check-touched-set"]):
        assert tool(root, *command).returncode == R.EXIT_OK, command
    assert tool(root, "stage", "Matrices").returncode == R.EXIT_OK and stage_now(root) == "Matrices"

    assert all(tool(root, "check-matrix", f"U{n}").returncode == R.EXIT_OK for n in range(1, 15))
    assert tool(root, "check-coverage").returncode == R.EXIT_OK
    assert tool(root, "stage", "Proved").returncode == R.EXIT_OK and stage_now(root) == "Proved"

    for rel, text in STUBBED.items():                                       # the stubs are written by hand
        (root / rel).write_text(text)
    (root / "ops/refactor/assignments.toml").write_text(SIX_ASSIGNED_MINI)  # the two shell tests stay outside the set
    assert tool(root, "check-stubs").returncode == R.EXIT_OK
    assert tool(root, "stage", "Deleted").returncode == R.EXIT_OK and stage_now(root) == "Deleted"

    assert tool(root, "run-suites").returncode == R.EXIT_OK
    assert tool(root, "report-deletion").returncode == R.EXIT_OK
    (root / "ops/refactor/fates.toml").write_text("".join(fate_block(t, "kept") + "\n" for t in SIX_OLD))
    assert tool(root, "fates").returncode == R.EXIT_OK and stage_now(root) == "Deleted"

    test = root / "py/test_core.py"                                         # plant a test that passes against the stubs
    test.write_text(test.read_text().replace('assert record(["a", "b", "c"], 2) == ["a", "b"]', "assert True"))
    assert tool(root, "run-suites").returncode == R.EXIT_OK
    done = tool(root, "report-deletion")
    report = json.loads((root / "ops/refactor/reports/deletion.json").read_text())
    assert done.returncode == R.EXIT_FAIL and [p["code"] for p in report["problems"]] == ["E-ASSIGNED-PASSED"]
    assert MINI_TEST in report["problems"][0]["subject"]
    assert stage_now(root) == "Proved"


def test_w2_a_switch_script_asks_the_guard_first_and_stops_while_a_story_runs_and_proceeds_when_idle(tmp_path):
    busy, work = run_switch(tmp_path / "busy", "node-a")
    assert busy.returncode != 0 and "E-MACHINE-BUSY" in busy.stdout and not (work / "changed.txt").exists()
    idle, work = run_switch(tmp_path / "idle", "node-b")
    assert idle.returncode == 0 and (work / "changed.txt").exists()


# ---- a second runner for the same language: [python-monitor] beside [python] (approved with task 1.24) -------------------------

def test_a_runner_key_with_a_suffix_lists_its_own_folders_tests_under_the_same_language(tmp_path):
    root = make_root(tmp_path)
    write(root, "ops/refactor/runners.toml", """
[python]
dir = "h"
command = ["sh", "-c", "echo test_a.py::t1"]
[python-monitor]
dir = "m"
command = ["sh", "-c", "echo test_m.py::t2"]
""")
    (root / "h").mkdir(); (root / "m").mkdir()
    assert R.list_tests(root) == {"python": {"h/test_a.py::t1", "m/test_m.py::t2"}}


def test_the_language_of_a_runner_key_is_the_part_before_the_dash():
    assert R.runner_language("python-monitor") == "python" and R.runner_language("rust") == "rust"


def test_results_of_two_runners_of_one_language_are_kept_in_separate_files(tmp_path):
    root = make_root(tmp_path)
    spec = {"format": "junit"}
    assert R.results_path(root, "python", spec) != R.results_path(root, "python-monitor", spec)


# ---- membership: which listed tests touch the touched set (approved with task 1.24) -----------------------------------------------

PY_SOURCE = "def record():\n    x = 1\n    return x\n\n\ndef other():\n    return 2\n"


def test_function_lines_are_the_def_through_its_last_line_for_functions_methods_and_nested_defs():
    assert R.python_function_lines(PY_SOURCE, "record") == {1, 2, 3}
    assert R.python_function_lines(PY_SOURCE, "other") == {6, 7}
    assert R.python_function_lines("class C:\n    def m(self):\n        return 1\n", "C.m") == {2, 3}
    assert R.python_function_lines("def outer():\n    def inner():\n        return 1\n    return inner\n", "inner") == {2, 3}
    assert R.python_function_lines("class C:\n    def m(self):\n        def helper():\n            return 1\n        return helper\n", "C.helper") == {3, 4}
    assert R.python_function_lines(PY_SOURCE, "ghost") is None


def test_the_module_level_of_a_python_file_is_every_line_outside_a_def():
    source = "import os\nLIMIT = 3\n\n\ndef f():\n    return LIMIT\n\n\nclass C:\n    KIND = 1\n\n    def m(self):\n        return 2\n\n\nprint(os)\n"
    assert R.python_function_lines(source, "<module>") == {1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16}


def test_only_the_run_phase_of_a_test_counts_as_touching_a_function():
    contexts = {"2": ["", "test_a.py::t1|setup", "test_a.py::t1|teardown", "test_a.py::t1|run", "test_a.py::p[a-1]|run"], "7": ["test_b.py::t2|run"]}
    assert R.tests_touching(contexts, {1, 2, 3}) == {"python:test_a.py::t1", "python:test_a.py::p[a-1]"}
    assert R.tests_touching({"2": ["test_a.py::t1|setup"]}, {2}) == set()


def touch_root(tmp_path: Path, touched: str) -> Path:
    return make_code_root(tmp_path, {
        "h/a.py": PY_SOURCE,
        "tools/dbench/Cargo.toml": '[package]\nname = "dbench"\n',
        "tools/dbench/src/collector.rs": "pub fn pass() {}\n",
        "tools/dbench/src/events.rs": "pub fn parse() {}\n",
        "tools/dbench/tests/server.rs": "use dbench::collector::pass;\n",
        "tools/dbench/tests/label.rs": "// nothing\n",
        "tools/b/server/domain.ts": "export function findRuns() {}\n",
        "tools/b/server/domain.test.ts": 'import { findRuns } from "./domain"\n',
        "tools/b/shared/view.test.ts": 'import { x } from "../server/domain"\n',
        "tools/b/shared/other.test.ts": 'import { x } from "./stats"\n',
        "s/judge-setup.sh": "echo hi\n",
        "tests/judge-setup-test.sh": 'bash "$ROOT/s/judge-setup.sh"\n',
        "tests/other-test.sh": "echo other\n",
    }, touched=touched)


TOUCH_ALL = (
    '[[entry]]\nlanguage = "python"\nfile = "h/a.py"\nfunction = "record"\nclasses = ["C"]\n'
    '[[entry]]\nlanguage = "rust"\nfile = "tools/dbench/src/collector.rs"\nfunction = "pass"\nclasses = ["C"]\n'
    '[[entry]]\nlanguage = "typescript"\nfile = "tools/b/server/domain.ts"\nfunction = "findRuns"\nclasses = ["A"]\n'
    '[[entry]]\nlanguage = "shell"\nfile = "s/judge-setup.sh"\nfunction = "<script>"\nclasses = ["B"]\n')
LISTED = {
    "python": {"h/test_a.py::t1", "h/test_a.py::t_other"},
    "rust": {"tools/dbench/src/lib.rs::collector::tests::copies", "tools/dbench/src/lib.rs::events::tests::parses",
             "tools/dbench/tests/server.rs::serves", "tools/dbench/tests/label.rs::renders"},
    "typescript": {"tools/b/server/domain.test.ts::finds", "tools/b/shared/view.test.ts::shows", "tools/b/shared/other.test.ts::adds"},
    "shell": {"tests/judge-setup-test.sh", "tests/other-test.sh"},
}


def touch_artifact(root: Path, contexts: dict) -> None:
    write(root, "ops/refactor/reports/touch-python.json", json.dumps({"files": {"h/a.py": {"contexts": contexts}}}))


def test_touching_tests_selects_by_language_rule(tmp_path):
    root = touch_root(tmp_path, TOUCH_ALL)
    touch_artifact(root, {"2": ["h/test_a.py::t1|run"], "7": ["h/test_a.py::t_other|run"]})
    assert R.touching_tests(root, LISTED) == {
        "python": {"h/test_a.py::t1"},
        "rust": {"tools/dbench/src/lib.rs::collector::tests::copies", "tools/dbench/tests/server.rs::serves"},
        "typescript": {"tools/b/server/domain.test.ts::finds", "tools/b/shared/view.test.ts::shows"},
        "shell": {"tests/judge-setup-test.sh"},
    }


def test_python_touch_data_that_is_missing_is_an_adapter_error_naming_the_command(tmp_path):
    with pytest.raises(R.AdapterError, match="measure-touch"):
        R.touching_tests(touch_root(tmp_path, TOUCH_ALL), LISTED)


def test_a_touched_python_file_the_measurement_never_saw_is_an_adapter_error(tmp_path):
    root = touch_root(tmp_path, TOUCH_ALL)
    write(root, "ops/refactor/reports/touch-python.json", json.dumps({"files": {}}))
    with pytest.raises(R.AdapterError, match="h/a.py"):
        R.touching_tests(root, LISTED)


def test_a_test_the_measurement_says_touches_the_set_but_no_runner_lists_is_an_adapter_error_not_a_silent_drop(tmp_path):
    root = touch_root(tmp_path, TOUCH_ALL)
    touch_artifact(root, {"2": ["h/test_a.py::t1|run", "h/test_a.py::ghost|run"]})
    with pytest.raises(R.AdapterError, match="ghost"):
        R.touching_tests(root, LISTED)


def test_a_rust_unit_test_whose_module_has_no_file_is_an_adapter_error(tmp_path):
    root = touch_root(tmp_path, TOUCH_ALL)
    touch_artifact(root, {"2": ["h/test_a.py::t1|run"]})
    with pytest.raises(R.AdapterError, match="ghost_module"):
        R.touching_tests(root, {**LISTED, "rust": {"tools/dbench/src/lib.rs::ghost_module::tests::x"}})


def test_the_register_is_decided_over_the_touching_tests_and_reports_both_lists(tmp_path):
    root = make_root(tmp_path, assignments='[assignments]\nU1 = ["python:h/test_a.py::t1"]\n')
    class Universe:
        def __call__(self, root):
            self.all = {"python": {"h/test_a.py::t1", "h/test_a.py::t_other"}}
            return {"python": {"h/test_a.py::t1"}}
    result = R.check_register(root, Universe())
    assert result.exit_code == R.EXIT_OK
    assert result.data["touching"] == {"python": ["h/test_a.py::t1"]} and result.data["listed"]["python"] == ["h/test_a.py::t1", "h/test_a.py::t_other"]


# ---- integration: measure-touch and the register over the touching tests, on the mini project -----------------------------------

MINI_SIX = {"python:py/test_core.py::test_record_keeps_only_what_fits_under_the_limit", "python:py/test_core.py::test_run_dir_joins_the_root_and_the_run_id",
            "rust:rs/mini/src/lib.rs::tests::an_empty_listing_has_no_lines", "rust:rs/mini/src/lib.rs::tests::a_listing_counts_its_lines",
            "typescript:ts/src/core.test.ts::a run with a title shows it", "typescript:ts/src/core.test.ts::a run without a title is untitled"}


def test_measure_touch_runs_the_python_suite_under_coverage_and_keeps_the_contexts(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    done = tool(root, "measure-touch")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    files = json.loads((root / "ops/refactor/reports/touch-python.json").read_text())["files"]
    assert "py/minipy/core.py" in files
    contexts = {n for names in files["py/minipy/core.py"]["contexts"].values() for n in names}
    assert "py/test_core.py::test_record_keeps_only_what_fits_under_the_limit|run" in contexts      # folder prefix, test id, run phase


def test_check_register_on_the_mini_project_decides_over_the_six_touching_tests_of_eight_listed(coverage_tools, tmp_path):
    root = fresh_mini(tmp_path)
    assert tool(root, "check-register").returncode == R.EXIT_ERROR          # the touch data is missing: undecidable, not a pass
    assert tool(root, "measure-touch").returncode == R.EXIT_OK
    (root / "ops/refactor/assignments.toml").write_text(SIX_ASSIGNED_MINI)
    done = tool(root, "check-register")
    assert done.returncode == R.EXIT_OK, done.stdout
    data = json.loads((root / "ops/refactor/reports/register.json").read_text())
    assert sum(len(v) for v in data["listed"].values()) == 8
    assert {f"{lang}:{t}" for lang, ids in data["touching"].items() for t in ids} == MINI_SIX


def test_a_branch_target_written_as_jump_to_line_is_shown_as_a_plain_arc(tmp_path):
    result = coverage_result(tmp_path, entry_toml("python", "src/a.py", "record"), {"src/a.py": PY_RECORD},
                             python={"src/a.py": lines(ALL_HIT, [(3, "0:jump to line 4", True), (3, "0:jump to line 5", False)])})
    assert result.problems[0].detail == "1 of 2 branches (3->5)"


def test_check_coverage_can_be_limited_to_one_language_and_runs_no_other(tmp_path):
    touched = entry_toml("python", "src/a.py", "record") + entry_toml("rust", "src/a.rs", "pull")
    root = make_root(tmp_path, touched=touched)
    write(root, "src/a.py", PY_RECORD); write(root, "src/a.rs", RS_PULL)
    ran = []
    def runner(root, language, spec):
        ran.append(language)
        return {"src/a.py": lines(ALL_HIT)} if language == "python" else {}
    result = R.check_coverage(root, runner, languages={"python"})
    assert ran == ["python"] and result.exit_code == R.EXIT_OK
    assert list(result.data["measured"]) == ["src/a.py::record"]


def test_the_command_line_takes_language_and_rejects_one_the_tool_does_not_know(tmp_path):
    root = make_root(tmp_path)
    with pytest.raises(SystemExit):
        cli(root, "check-coverage", "--language", "cobol")


# ---- matrix rows with * (owner-approved 12 Oct 2026: a row stands for every tuple of a dimension the code ignores) --------------

def star(rows: list[tuple[list[str], str]]) -> str:
    head = '[dimensions]\nkind = ["combination", "reference"]\noutcome = ["done", "partial", "stopped"]\n'
    return head + "".join(f'\n[[cell]]\nat = {json.dumps(at)}\ntest = "python:t.py::{name}"\n' for at, name in rows)


STAR_TESTS = ["a", "b", "c", "d"]
FULL_ROWS = [(["*", "stopped"], "a"), (["combination", "done"], "b"), (["combination", "partial"], "c"), (["reference", "*"], "d")]


def star_result(tmp_path: Path, rows) -> R.Result:
    return matrix_result(tmp_path, star(rows), tests=[f"t.py::{n}" for n in STAR_TESTS])


def test_rows_with_a_star_that_cover_every_tuple_exactly_once_pass_and_count_rows_and_cells_and_tests(tmp_path):
    result = star_result(tmp_path, [(["*", "stopped"], "a"), (["combination", "done"], "b"), (["combination", "partial"], "c"),
                                    (["reference", "done"], "d"), (["reference", "partial"], "d")])
    assert result.exit_code == R.EXIT_OK, result.problems
    assert result.data["cells"] == 6 and result.data["rows"] == 5 and result.data["tests"] == 4


def test_a_tuple_two_rows_both_cover_is_multiple_and_named(tmp_path):
    result = star_result(tmp_path, FULL_ROWS)          # (reference, stopped) is covered by the first row and the last
    assert [(p.code, p.subject) for p in result.problems] == [("E-CELL-MULTIPLE", "reference x stopped")]


def test_a_tuple_no_row_covers_is_missing_even_when_other_rows_use_a_star(tmp_path):
    result = star_result(tmp_path, [(["*", "stopped"], "a"), (["combination", "done"], "b"), (["reference", "done"], "d")])
    assert sorted((p.code, p.subject) for p in result.problems) == [("E-CELL-MISSING", "combination x partial"), ("E-CELL-MISSING", "reference x partial")]


def test_a_star_row_naming_a_value_nobody_declared_is_extra(tmp_path):
    assert "E-CELL-EXTRA" in codes(star_result(tmp_path, [(["*", "failed"], "a")]))


def test_a_row_with_the_wrong_number_of_values_is_extra_even_with_a_star(tmp_path):
    assert "E-CELL-EXTRA" in codes(star_result(tmp_path, [(["*"], "a")]))


# ---- which use cases need a matrix (use_cases.toml: matrix_required) ----------------------------------------------------------

def justifier_root(tmp_path: Path, required: str) -> Path:
    root = make_root(tmp_path)
    write(root, "ops/refactor/use_cases.toml", required + (root / "ops/refactor/use_cases.toml").read_text())      # a top-level key goes first
    write(root, "ops/refactor/runners.toml", '[python]\ndir = "."\ncommand = ["sh", "-c", "echo test_a.py::t1"]\n')
    write(root, "ops/refactor/touched_set.toml", "")
    write(root, "ops/refactor/stage.toml", 'stage = "Matrices"\n')
    return root


ONE_CELL = '[dimensions]\nonly = ["x"]\n\n[[cell]]\nat = ["x"]\ntest = "python:test_a.py::t1"\n'


def test_the_move_to_proved_checks_only_the_matrices_the_use_case_file_requires(tmp_path, monkeypatch):
    root = justifier_root(tmp_path, 'matrix_required = ["U1"]\n')
    write_matrix(root, ONE_CELL, "U1")                      # no matrix for U2 to U14
    monkeypatch.setattr(R, "check_coverage", lambda root, *a, **k: R.Result())
    monkeypatch.setattr(R, "touching_tests", lambda root, listed: listed)
    assert cli(root, "stage", "Proved") == R.EXIT_OK and stage_of(root) == "Proved"


def test_a_required_matrix_that_is_missing_refuses_the_move(tmp_path, monkeypatch):
    root = justifier_root(tmp_path, 'matrix_required = ["U1"]\n')
    monkeypatch.setattr(R, "check_coverage", lambda root, *a, **k: R.Result())
    monkeypatch.setattr(R, "touching_tests", lambda root, listed: listed)
    assert cli(root, "stage", "Proved") == R.EXIT_FAIL and stage_of(root) == "Matrices"


def test_without_the_key_every_use_case_needs_a_matrix(tmp_path, monkeypatch):
    root = justifier_root(tmp_path, "")
    write_matrix(root, ONE_CELL, "U1")
    monkeypatch.setattr(R, "check_coverage", lambda root, *a, **k: R.Result())
    monkeypatch.setattr(R, "touching_tests", lambda root, listed: listed)
    assert cli(root, "stage", "Proved") == R.EXIT_FAIL


def test_a_matrix_required_naming_an_unknown_use_case_is_refused(tmp_path):
    root = justifier_root(tmp_path, 'matrix_required = ["U99"]\n')
    assert cli(root, "stage", "Proved") != R.EXIT_OK


def test_the_real_use_cases_file_has_fourteen_use_cases_and_the_key_is_top_level_not_a_fifteenth_use_case():
    data = tomllib.loads((Path(__file__).parent / "use_cases.toml").read_text())
    assert data["matrix_required"] == ["U1"] and len(data["use_cases"]) == 14 and "matrix_required" not in data["use_cases"]


# ---- story 19 fixtures: the stubbed excerpts of story 5 and the mini repository with a history (task 19.1) ----------

FIXTURES = Path(__file__).parent / "fixtures"
STORY5_STUBBED = {"collect.rs": 5, "collector.rs": 5, "server.rs": 1}      # file -> how many bodies story 5 stubbed


def load_fixture_module(name: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, FIXTURES / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_story_5_excerpts_are_the_pinned_commit_with_eleven_bodies_stubbed_and_a_rebuild_matches():
    dest = FIXTURES / "real" / "story5"
    for file, count in STORY5_STUBBED.items():
        assert (dest / file).read_text().count("todo!()") == count, file
    assert "e89785fbb" in (dest / "NOTE.md").read_text(), "the pinned commit is recorded"
    assert load_fixture_module("make_story5_stubs").main(["--check"]) == 0, "the committed excerpts differ from a rebuild at the pinned commit"


def test_the_mini_repository_builds_with_a_three_commit_history_and_a_git_user_in_each_category(tmp_path):
    import subprocess
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "mini")
    log = subprocess.run(["git", "-C", str(repo), "log", "--format=%s"], capture_output=True, text=True, check=True).stdout.splitlines()
    assert log == ["vidi/m1/run-1: rescored", "vidi/m1/run-1: run finished", "mini: the code"]
    assert "git" in (repo / "tools/publish.py").read_text() and "ls-files" in (repo / "tools/publish.py").read_text()   # Python subprocess
    assert "git push" in (repo / "tools/publish.sh").read_text()                                                          # shell
    assert '"runs"' in (repo / "tools/read_run.py").read_text()                                                           # tracked path
    first = subprocess.run(["git", "-C", str(repo), "show", "HEAD~1:runs/vidi/m1/run-1/metrics.json"], capture_output=True, text=True, check=True).stdout
    assert first.strip() == '{"passed": 7}' and (repo / "runs/vidi/m1/run-1/metrics.json").read_text().strip() == '{"passed": 9}'
    status = subprocess.run(["git", "-C", str(repo), "status", "--short"], capture_output=True, text=True, check=True).stdout
    assert status == "", "the repository is clean after the build"


# ---- story 19: comments never change what a stub is (TC-90 to TC-96, TC-98; task 19.2) ---------------------------------------
# 15 Oct 2026: story 5's delete-first run left eleven `todo!()` bodies and the tool called nine of them "not a stub", because a
# function's text runs to the next definition line and so ended in the next item's doc comment, not in a closing brace.

def one_stub(tmp_path: Path, language: str, file: str, function: str, text: str) -> R.Result:
    return R.check_stubs(make_code_root(tmp_path, {file: text}, touched=entry(language, file, function, '"B"')))


STUB_WITH_COMMENT = [
    pytest.param("rust", "src/c.rs", "pull",
                 "fn pull(repo: &Path) {\n    todo!()\n}\n\n/// The next function's doc comment.\nfn other() -> u8 {\n    1\n}\n", id="TC-90-rust-doc-comment-of-the-next-fn"),
    pytest.param("rust", "src/c.rs", "pull",
                 "fn pull(repo: &Path) {\n    // removed by story 5\n    todo!()\n}\n", id="TC-91-rust-line-comment-inside-the-body"),
    pytest.param("rust", "src/c.rs", "pull",
                 "fn pull(repo: &Path) {\n    todo!()\n}\n/* a block comment after the closing brace */\n", id="TC-92-rust-block-comment-after-the-brace"),
    pytest.param("typescript", "src/s.ts", "lsTree",
                 'export function lsTree(rev: string) {\n  throw new Error("gone");\n}\n\n/** The next item. */\nexport function other() { return 1; }\n', id="TC-93-typescript-doc-comment-of-the-next-item"),
    pytest.param("python", "src/a.py", "pull",
                 'def pull(repo):\n    """Fetch the repo."""\n    # removed by story 4\n    raise NotImplementedError("gone")\n', id="TC-94-python-docstring-and-comment-line"),
    pytest.param("shell", "src/x.sh", "sync",
                 "sync() {\n  return 99\n}\n# the next function pushes\npush() {\n  git push\n}\n", id="TC-95-shell-comment-line-after-the-brace"),
]


@pytest.mark.parametrize("language,file,function,text", STUB_WITH_COMMENT)
def test_comments_never_change_what_a_stub_is(tmp_path, language, file, function, text):
    result = one_stub(tmp_path, language, file, function, text)
    assert result.exit_code == R.EXIT_OK and result.problems == [], [(p.code, p.subject) for p in result.problems]


NOT_A_STUB_DESPITE_COMMENTS = [
    pytest.param("rust", "src/c.rs", "pull",
                 "fn pull(repo: &Path) {\n    repo.fetch();\n    todo!()\n    // a comment\n}\n\n/// next\nfn other() {}\n", id="TC-96-a-real-statement-and-a-comment-stay-not-a-stub"),
    pytest.param("rust", "src/c.rs", "pull",
                 "fn pull(repo: &Path) {\n    repo.fetch(); // todo!()\n}\n\n/// next\nfn other() {}\n", id="TC-98-a-real-body-whose-comment-says-todo-stays-not-a-stub"),
]


@pytest.mark.parametrize("language,file,function,text", NOT_A_STUB_DESPITE_COMMENTS)
def test_comments_never_make_a_real_body_a_stub(tmp_path, language, file, function, text):
    assert [p.code for p in one_stub(tmp_path, language, file, function, text).problems] == ["E-NOT-STUB"]


# ---- story 19: the real excerpts of story 5 (TC-97; task 19.3) ---------------------------------------------------------------

STORY5_FUNCTIONS = {                    # the eleven bodies story 5 stubbed (its deletion report), by file
    "collect.rs": ["parse_name", "resolve", "manifest", "kind", "name"],
    "collector.rs": ["plan", "pull_file", "collect_run", "wanted", "store_dir"],
    "server.rs": ["file_of"],
}
STORY5_SOURCE_DIR = "tools/dbench/src"


def test_tc97_check_stubs_as_a_process_recognises_all_eleven_stubs_of_story_5(tmp_path):
    touched = "".join(entry("rust", f"{STORY5_SOURCE_DIR}/{file}", fn, '"B"') for file, fns in STORY5_FUNCTIONS.items() for fn in fns)
    root = make_root(tmp_path, touched=touched)
    for file in STORY5_FUNCTIONS:
        write(root, f"{STORY5_SOURCE_DIR}/{file}", (FIXTURES / "real" / "story5" / file).read_text())
    done = tool(root, "check-stubs")
    not_stubs = [line for line in (done.stdout + done.stderr).splitlines() if "E-NOT-STUB" in line]
    assert len(not_stubs) == 0 and done.returncode == R.EXIT_OK, f"{len(not_stubs)} of 11 reported as not a stub:\n" + "\n".join(not_stubs)


# ---- story 19: the tool says it acts on the whole epic's list (TC-100 to TC-103; tasks 19.5 and 19.6) -------------------------
# 15 Oct 2026: the README said stories 4 to 12 were "held by the stage" and each story's deletion report was written as if it
# stood alone; the tool's output never said which list it was checking. It now prints its scope first.

SCOPED_COMMANDS = ["check-stubs", "report-deletion", "check-coverage", "stage", "check-touched-set"]
BANNED_PHRASES = ["one story at a time", "per story", "this story alone"]
SCOPE_WORDS = "whole touched set"
SCOPE_LINE = re.compile(r"^scope: whole touched set, (\d+) entries in (\d+) files$")


def touched_counts(touched_toml: Path) -> tuple[int, int]:
    entries = tomllib.loads(touched_toml.read_text()).get("entry", [])
    return len(entries), len({e["file"] for e in entries})


def root_with_only_the_touched_set(tmp_path: Path, source: Path) -> Path:
    """A repository holding nothing but the touched-set file, so a command that needs real runners stops quickly."""
    root = tmp_path / "scope-root"
    write(root, "ops/refactor/touched_set.toml", source.read_text())
    return root


@pytest.mark.parametrize("command", SCOPED_COMMANDS)
def test_tc100_each_scoped_command_prints_the_scope_line_before_its_result(tmp_path, capsys, command):
    root = tmp_path / "mini"
    shutil.copytree(FIXTURES / "mini", root, ignore=shutil.ignore_patterns("node_modules", "target", "__pycache__"))
    cli(root, command, *(["--language", "shell"] if command == "check-coverage" else []))      # the line comes first, whatever the result
    first = capsys.readouterr().out.splitlines()[0]
    n, m = touched_counts(root / "ops/refactor/touched_set.toml")
    assert first == f"scope: whole touched set, {n} entries in {m} files"


@pytest.mark.parametrize("command", SCOPED_COMMANDS)
def test_tc101_the_help_of_each_scoped_command_names_the_whole_touched_set_and_none_of_the_banned_phrases(capsys, command):
    with pytest.raises(SystemExit):
        R.main([command, "--help"])
    out = " ".join(capsys.readouterr().out.lower().split())
    assert SCOPE_WORDS in out, out
    assert not [b for b in BANNED_PHRASES if b in out]


def test_the_tool_s_own_help_prints_and_lists_every_command_instead_of_crashing(capsys):
    with pytest.raises(SystemExit) as stopped:
        R.main(["--help"])
    assert stopped.value.code == 0
    out = " ".join(capsys.readouterr().out.split())
    for command in SCOPED_COMMANDS:
        assert command in out, f"{command} is missing from the tool's own help"
    assert "100% of lines and branches" in out
    assert "%%" not in out


def test_the_help_of_the_coverage_command_prints_a_single_percent_sign(capsys):
    with pytest.raises(SystemExit):
        R.main(["check-coverage", "--help"])
    out = " ".join(capsys.readouterr().out.split())
    assert "100% of lines and branches" in out
    assert "%%" not in out


def test_tc103_the_readme_says_the_stage_and_the_checks_act_on_the_whole_epic_and_uses_none_of_the_banned_phrases():
    text = " ".join((Path(__file__).parent / "README.md").read_text().lower().split())
    assert "whole epic" in text
    assert not [b for b in BANNED_PHRASES if b in text]
    assert "stories 4 to 12 are held" not in text, "the sentence that holds a range of stories by the stage"


@pytest.mark.parametrize("command", SCOPED_COMMANDS)
def test_tc102_the_scope_line_of_the_real_touched_set_counts_what_the_file_holds(tmp_path, command):
    real = Path(__file__).parent / "touched_set.toml"
    root = root_with_only_the_touched_set(tmp_path, real)
    done = tool(root, command)
    lines = done.stdout.splitlines()
    assert lines and SCOPE_LINE.match(lines[0]), f"first line of {command}: {lines[:1]}"
    n, m = touched_counts(real)
    assert tuple(int(x) for x in SCOPE_LINE.match(lines[0]).groups()) == (n, m)



def test_check_coverage_with_no_coverage_command_for_a_language_is_undecided_not_a_traceback(tmp_path):
    # found 15 Oct 2026 while testing the scope line on a root with no runners.toml: spec["command"] raised KeyError
    root = make_code_root(tmp_path, {"src/a.py": "def record():\n    return 1\n"}, touched=entry())
    result = R.check_coverage(root)
    assert result.exit_code == R.EXIT_ERROR and codes(result) == ["E-NO-COVERAGE-RUNNER"]


# ---- story 19: the pass file, its queries and its checks (TC-01 to TC-05, TC-08 to TC-13; task 19.8) ------------------------
# A pass is `ops/refactor/audit/pass-NN.md`: Queries, Hits and Open findings tables and a verdict line. The search is injected
# here (a stand-in that reads the files of the root); the real `git grep` is used in the integration tests that follow.

AUDIT_DIR = "ops/refactor/audit"
ALL_SCOPES = "benchmarks/spec-bench tools ops tests lib :(glob)*.sh"
CATEGORIES = ["vcs-command", "tree-read", "host-url", "history-test"]
HIT_COLUMNS = ["Hit", "Place", "Function", "Source", "Access", "Via", "UseCase", "Outcome", "Reason", "New"]
QUERY_COLUMNS = ["Query", "Category", "Pattern", "Paths"]
FINDING_COLUMNS = ["Finding", "Title", "Status"]
AUDIT_FILES = {
    "tools/pull.py": 'def pull(repo):\n    run("git pull")\n\n\ndef push(repo):\n    run("git push")\n',
    "ops/show.sh": "show() {\n  git show HEAD:x\n}\n",
    "lib/runs.py": 'def bundle_of(run):\n    return open(run + "/workspace.bundle")\n',
    "tests/test_hist.py": "def test_history():\n    run('git log')\n",
    "benchmarks/spec-bench/h.py": 'def url(remote):\n    return "https://github.com/" + remote\n',
}
AUDIT_QUERIES = [          # id, category, pattern (as written in the table: | is escaped), paths
    ("Q1", "vcs-command", r"git (pull\|push\|show)", ALL_SCOPES),
    ("Q2", "tree-read", r"workspace\.bundle", ALL_SCOPES),
    ("Q3", "host-url", r"github\.com", ALL_SCOPES),
    ("Q4", "history-test", r"git log", ALL_SCOPES),
]
AUDIT_HITS = [             # place, function, source
    ("tools/pull.py", "pull", "Q1"), ("tools/pull.py", "push", "Q1"), ("ops/show.sh", "show", "Q1"),
    ("lib/runs.py", "bundle_of", "Q2"), ("benchmarks/spec-bench/h.py", "url", "Q3"), ("tests/test_hist.py", "test_history", "Q4"),
]


def md_table(columns: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    return "\n".join(lines + ["| " + " | ".join(r) + " |" for r in rows]) + "\n"


def hit_row(n: int, place: str, function: str, source: str, new: str = "yes", reason: str = "", outcome: str = "protected", use_case: str = "U1") -> list[str]:
    return [f"H{n}", place, function, source, "reader", "command", use_case, outcome, reason, new]


def pass_md(queries=AUDIT_QUERIES, hits=AUDIT_HITS, verdict="verdict: another pass required, first pass", new_flags=None, hit_columns=HIT_COLUMNS, extra_hits=(), default_new="yes", overrides=None, findings=()) -> str:
    rows = [hit_row(i + 1, p, f, s, (new_flags or {}).get(i, default_new)) for i, (p, f, s) in enumerate(hits)] + list(extra_hits)
    for index, columns in (overrides or {}).items():                    # {row index: {column name: value}}
        for column, value in columns.items():
            rows[index][HIT_COLUMNS.index(column)] = value
    rows = [[c for c, name in zip(r, HIT_COLUMNS) if name in hit_columns] for r in rows]
    return ("# Audit pass\n\n## Queries\n\n" + md_table(QUERY_COLUMNS, [[q, c, f"`{p}`", paths] for q, c, p, paths in queries])
            + "\n## Hits\n\n" + md_table(hit_columns, rows) + "\n## Open findings\n\n" + md_table(FINDING_COLUMNS, [list(f) for f in findings]) + f"\n{verdict}\n")


def audit_root(tmp_path: Path, passes: dict[int, str] | None = None, files: dict[str, str] | None = None) -> Path:
    root = tmp_path / "audit-root"
    for rel, text in (files or AUDIT_FILES).items():
        write(root, rel, text)
    write(root, "ops/refactor/use_cases.toml", "[use_cases]\n" + "".join(f'{u} = "use case {u}"\n' for u in USE_CASE_IDS))
    write(root, "ops/refactor/classes.toml", '[classes.W]\nfunctions = ["agent_git"]\n')
    for n, text in (passes if passes is not None else {1: pass_md()}).items():
        write(root, f"{AUDIT_DIR}/pass-{n:02d}.md", text)
    return root


def file_grep(root: Path, pattern: str, paths: list[str]) -> list[tuple[str, int]]:
    """A stand-in for `git grep -n -E`: every matching line of every file under root outside the audit folder."""
    found = []
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = f.relative_to(root).as_posix()
        if rel.startswith(AUDIT_DIR) or rel.startswith("ops/refactor/reports"):
            continue
        if not any(q in (".", "") or rel == q or rel.startswith(q.rstrip("/") + "/") or (q == ":(glob)*.sh" and "/" not in rel and rel.endswith(".sh")) for q in paths):
            continue                                                      # the query does not search this file
        for n, line in enumerate(f.read_text().splitlines(), start=1):
            if re.search(pattern, line):
                found.append((rel, n))
    return found


def check(root: Path, **kw) -> R.Result:
    return R.check_audit(root, grep=file_grep, **kw)


def test_tc01_a_valid_pass_is_accepted_and_the_report_counts_its_queries_and_hits(tmp_path):
    root = audit_root(tmp_path)
    result = check(root)
    assert result.exit_code == R.EXIT_OK and result.problems == [], [(p.code, p.subject, p.detail) for p in result.problems]
    first = json.loads((root / "ops/refactor/reports/audit.json").read_text())["passes"][0]
    assert (first["queries"], first["hits"], first["new"]) == (4, 6, 6)


def test_tc02_no_pass_file_means_the_audit_has_not_been_run(tmp_path):
    assert codes(check(audit_root(tmp_path, passes={}))) == ["E-AUDIT-NONE"]


def test_tc03_a_gap_in_the_pass_numbers_is_named(tmp_path):
    result = check(audit_root(tmp_path, passes={1: pass_md(), 3: pass_md()}))
    assert codes(result) == ["E-PASS-GAP"] and "02" in result.problems[0].detail


def test_tc04_a_hits_table_without_the_outcome_column_is_a_format_error_naming_file_and_column(tmp_path):
    result = check(audit_root(tmp_path, passes={1: pass_md(hit_columns=[c for c in HIT_COLUMNS if c != "Outcome"])}))
    assert codes(result) == ["E-PASS-FORMAT"] and "pass-01.md" in result.problems[0].subject and "Outcome" in result.problems[0].detail


def test_tc05_a_query_with_an_unknown_category_is_refused(tmp_path):
    queries = AUDIT_QUERIES[:3] + [("Q4", "other", r"git log", ALL_SCOPES)]
    assert "E-QUERY-CATEGORY" in codes(check(audit_root(tmp_path, passes={1: pass_md(queries=queries, hits=AUDIT_HITS[:5])})))


def test_tc08_a_hit_marked_new_that_an_earlier_pass_already_has_is_a_mismatch(tmp_path):
    result = check(audit_root(tmp_path, passes={1: pass_md(), 2: pass_md(new_flags={0: "yes"})}))        # pass 2 repeats pass 01's hits: none is new
    assert "E-NEW-MISMATCH" in codes(result) and "tools/pull.py::pull" in " ".join(p.subject + p.detail for p in result.problems)


def test_tc09_a_pass_with_no_host_url_query_names_the_category(tmp_path):
    queries = [q for q in AUDIT_QUERIES if q[1] != "host-url"]
    result = check(audit_root(tmp_path, passes={1: pass_md(queries=queries, hits=[h for h in AUDIT_HITS if h[2] != "Q3"])}))
    assert codes(result) == ["E-CATEGORY-UNSEARCHED"] and "host-url" in result.problems[0].detail


def test_tc10_a_pass_with_no_query_over_the_tests_folder_names_it(tmp_path):
    no_tests = "benchmarks/spec-bench tools ops lib :(glob)*.sh"
    queries = [(q, c, p, no_tests) for q, c, p, _ in AUDIT_QUERIES]
    result = check(audit_root(tmp_path, passes={1: pass_md(queries=queries, hits=[h for h in AUDIT_HITS if h[0] != "tests/test_hist.py"])}))
    assert codes(result) == ["E-SCOPE-UNSEARCHED"] and "tests" in result.problems[0].detail


def tracked_bytes(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()
            and not p.relative_to(root).as_posix().startswith(("ops/refactor/reports", AUDIT_DIR))}


def test_tc11_a_search_that_writes_a_file_outside_the_audit_folder_is_caught_and_a_normal_run_leaves_every_file_alone(tmp_path):
    root = audit_root(tmp_path)
    before = tracked_bytes(root)
    assert check(root).exit_code == R.EXIT_OK and tracked_bytes(root) == before            # the negative: a normal run changes nothing

    def writing_grep(r, pattern, paths):
        (r / "tools" / "leak.txt").write_text("written by a search")
        return file_grep(r, pattern, paths)
    result = R.check_audit(root, grep=writing_grep)
    assert "E-AUDIT-WROTE" in codes(result) and "tools/leak.txt" in " ".join(p.subject + p.detail for p in result.problems)


def test_tc12_a_manual_hit_with_a_reason_is_accepted_without_a_search_and_counted(tmp_path):
    manual = [hit_row(7, "tools/pull.py", "<module>", "manual", reason="calls the helper that runs git pull")]
    root = audit_root(tmp_path, passes={1: pass_md(extra_hits=manual)})
    result = check(root)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]
    assert json.loads((root / "ops/refactor/reports/audit.json").read_text())["passes"][0]["hits"] == 7


def test_tc13_a_manual_hit_without_a_reason_is_refused(tmp_path):
    manual = [hit_row(7, "tools/pull.py", "<module>", "manual", reason="")]
    assert codes(check(audit_root(tmp_path, passes={1: pass_md(extra_hits=manual)}))) == ["E-MANUAL-NO-REASON"]


# ---- story 19: recorded queries give the same hits for anyone, with the real `git grep` (TC-06, TC-07, TC-14; task 19.9) -------

import subprocess as sp

LS_TREE_FILES = {                  # three files that run `git ls-tree`, one of them also at module level
    "tools/a.py": 'LISTING = "git ls-tree"\n\n\ndef lister(rev):\n    return run("git ls-tree " + rev)\n',
    "tools/b.sh": "tree() {\n  git ls-tree -r HEAD\n}\n",
    "lib/c.rs": 'pub fn list_tree() -> &\'static str {\n    "git ls-tree"\n}\n',
}
REAL_QUERIES = [
    ("Q1", "vcs-command", r"git ls-tree", "."),
    ("Q2", "tree-read", r'"runs"', "."),
    ("Q3", "host-url", r"github\.com", "."),
    ("Q4", "history-test", r"git log", "."),
]
REAL_HITS = [("tools/a.py", "<module>", "Q1"), ("tools/a.py", "lister", "Q1"), ("tools/b.sh", "tree", "Q1"), ("lib/c.rs", "list_tree", "Q1"),
             ("tools/publish.py", "<module>", "Q2"), ("tools/read_run.py", "score_of", "Q2")]


def run_git(repo: Path, *args: str) -> None:
    sp.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-C", str(repo), *args],
           check=True, capture_output=True, text=True)


def real_audit_repo(tmp_path: Path) -> Path:
    """The mini project with its real history, three files that run `git ls-tree`, and a first pass written for them."""
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "audited")
    for rel, text in LS_TREE_FILES.items():
        write(repo, rel, text)
    write(repo, f"{AUDIT_DIR}/pass-01.md", pass_md(queries=REAL_QUERIES, hits=REAL_HITS))
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-q", "-m", "add ls-tree users and pass 01")
    return repo


def test_tc14_a_stored_query_returns_its_hits_with_their_enclosing_functions_from_the_real_git_grep(tmp_path):
    repo = real_audit_repo(tmp_path)
    found = R.run_queries(repo, R.parse_pass(repo / AUDIT_DIR / "pass-01.md"))
    assert {(h.file, h.function) for h in found["Q1"]} == {("tools/a.py", "<module>"), ("tools/a.py", "lister"), ("tools/b.sh", "tree"), ("lib/c.rs", "list_tree")}
    assert all(h.line > 0 for hits in found.values() for h in hits)
    assert R.check_audit(repo).exit_code == R.EXIT_OK


def test_tc06_a_recorded_hit_whose_line_was_removed_from_the_repository_is_not_reproducible(tmp_path):
    repo = real_audit_repo(tmp_path)
    write(repo, "tools/a.py", 'LISTING = "git ls-tree"\n\n\ndef lister(rev):\n    return rev\n')
    result = R.check_audit(repo)
    assert codes(result) == ["E-PASS-NOT-REPRODUCIBLE"] and "tools/a.py::lister" in result.problems[0].subject + result.problems[0].detail


def test_tc07_a_matching_line_added_after_the_pass_was_written_is_not_recorded(tmp_path):
    repo = real_audit_repo(tmp_path)
    write(repo, "tools/b.sh", "tree() {\n  git ls-tree -r HEAD\n}\nextra() {\n  git ls-tree HEAD\n}\n")
    result = R.check_audit(repo)
    assert codes(result) == ["E-PASS-NOT-REPRODUCIBLE"] and "tools/b.sh::extra" in result.problems[0].subject + result.problems[0].detail


# ---- story 19: the audit ends only on a pass with new searches and no new hit (TC-20 to TC-27; task 19.11) -------------------

EXTRA_QUERY = ("Q5", "vcs-command", r"git fetch", ALL_SCOPES)
THIRD_QUERY = ("Q6", "vcs-command", r"git diff", ALL_SCOPES)
FINAL = "verdict: final"
ANOTHER = "verdict: another pass required, the owner wants one more"


def later_pass(queries=None, verdict=ANOTHER, extra_hits=(), hits=AUDIT_HITS) -> str:
    """A pass after the first: the first pass's hits again (none new), the given queries."""
    return pass_md(queries=queries if queries is not None else AUDIT_QUERIES + [EXTRA_QUERY], hits=hits, default_new="no", verdict=verdict, extra_hits=extra_hits)


def audit_json(root: Path) -> dict:
    return json.loads((root / "ops/refactor/reports/audit.json").read_text())


def three_new_hits() -> list[list[str]]:
    return [hit_row(10 + i, "tools/pull.py", f"added_{i}", "manual", reason="found by reading") for i in range(3)]


def test_tc20_a_later_pass_with_no_new_hit_and_a_new_query_is_final(tmp_path):
    root = audit_root(tmp_path, passes={1: pass_md(), 2: later_pass(verdict=FINAL)})
    result = check(root)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]
    assert audit_json(root)["final_pass"] == 2


def test_tc21_a_pass_with_the_same_queries_as_the_one_before_is_a_repeat_and_never_final(tmp_path):
    root = audit_root(tmp_path, passes={1: pass_md(), 2: later_pass(queries=AUDIT_QUERIES)})
    result = check(root)
    assert "E-PASS-REPEAT" in codes(result)
    assert audit_json(root)["final_pass"] is None and audit_json(root)["final_reason"] == "repeat"


def test_tc22_new_hits_keep_the_audit_open_and_a_verdict_of_another_pass_is_accepted(tmp_path):
    root = audit_root(tmp_path, passes={1: pass_md(), 2: later_pass(extra_hits=[[*r[:9], "yes"] for r in three_new_hits()])})
    result = check(root)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]
    assert audit_json(root)["final_pass"] is None and audit_json(root)["final_reason"] == "new-hits"


def test_tc23_a_verdict_of_final_on_a_pass_with_new_hits_is_a_mismatch(tmp_path):
    root = audit_root(tmp_path, passes={1: pass_md(), 2: later_pass(verdict=FINAL, extra_hits=three_new_hits())})
    assert "E-VERDICT-MISMATCH" in codes(check(root))


def test_tc24_the_owner_may_ask_for_another_pass_after_a_computed_final_one(tmp_path):
    root = audit_root(tmp_path, passes={1: pass_md(), 2: later_pass(verdict=ANOTHER)})
    result = check(root)
    assert result.exit_code == R.EXIT_OK and audit_json(root)["final_pass"] == 2


def test_tc25_a_single_pass_is_never_final_and_require_final_refuses_it(tmp_path):
    root = audit_root(tmp_path, passes={1: pass_md(hits=[])}, files={"tools/x.py": "x = 1\n"})
    assert check(root).exit_code == R.EXIT_OK
    assert audit_json(root)["final_pass"] is None and audit_json(root)["final_reason"] == "single-pass"
    assert codes(check(root, require_final=True)) == ["E-NOT-FINAL"]


def test_tc26_a_final_audit_is_reopened_by_a_later_pass_that_finds_a_new_hit(tmp_path):
    files = {**AUDIT_FILES, "tools/c.py": 'def commit(repo):\n    run("git commit")\n'}
    third = later_pass(queries=AUDIT_QUERIES + [EXTRA_QUERY, THIRD_QUERY], verdict=FINAL)
    fourth_query = ("Q7", "vcs-command", r"git commit", ALL_SCOPES)
    fourth = later_pass(queries=AUDIT_QUERIES + [EXTRA_QUERY, THIRD_QUERY, fourth_query], extra_hits=[hit_row(7, "tools/c.py", "commit", "Q7", new="yes")])
    root = audit_root(tmp_path, passes={1: pass_md(), 2: later_pass(), 3: third}, files=files)
    assert check(root, require_final=True).exit_code == R.EXIT_OK and audit_json(root)["final_pass"] == 3
    write(root, f"{AUDIT_DIR}/pass-04.md", fourth)
    result = check(root, require_final=True)
    assert codes(result) == ["E-NOT-FINAL"] and audit_json(root)["final_pass"] is None and audit_json(root)["final_reason"] == "new-hits"


def test_tc27_one_changed_character_in_a_pattern_is_a_new_query_and_a_reordering_is_a_repeat(tmp_path):
    changed = [(q, c, p.replace(r"github\.com", r"github\.co"), paths) for q, c, p, paths in AUDIT_QUERIES]
    root = audit_root(tmp_path / "one", passes={1: pass_md(), 2: later_pass(queries=changed, verdict=FINAL)})
    assert check(root).exit_code == R.EXIT_OK and audit_json(root)["final_pass"] == 2
    root = audit_root(tmp_path / "two", passes={1: pass_md(), 2: later_pass(queries=list(reversed(AUDIT_QUERIES)))})
    assert "E-PASS-REPEAT" in codes(check(root))


# ---- story 19: --require-final as a process, over passes whose hits come from the real audit-run (TC-20, TC-25, TC-26; task 19.33) ----

NEW_QUERY_Q5 = ("Q5", "vcs-command", r"git ls-tree -r", ".")           # a new query that finds only what Q1 already found
NEW_QUERY_Q6 = ("Q6", "vcs-command", r"git diff", ".")                  # a query that finds nothing in the repository until a file is added


def write_pass_from_audit_run(repo: Path, number: int, queries: list, earlier: set[str], verdict: str) -> set[str]:
    """Write pass NN: the queries first, then the Hits table from what `audit-run NN` really returns, with the New column computed."""
    path = repo / AUDIT_DIR / f"pass-{number:02d}.md"
    write(repo, f"{AUDIT_DIR}/pass-{number:02d}.md", pass_md(queries=queries, hits=[], verdict=verdict))
    assert tool(repo, "audit-run", str(number)).returncode == R.EXIT_OK
    found = json.loads((repo / "ops/refactor/reports" / f"audit-hits-{number:02d}.json").read_text())["queries"]
    sources: dict[str, list[str]] = {}
    for qid, hits in found.items():
        for h in hits:
            sources.setdefault(f"{h['file']}::{h['function']}", []).append(qid)
    rows = [hit_row(i + 1, ident.split("::")[0], ident.split("::")[1], ",".join(sorted(set(qs))), "no" if ident in earlier else "yes")
            for i, (ident, qs) in enumerate(sorted(sources.items()))]
    path.write_text(pass_md(queries=queries, hits=[], verdict=verdict, extra_hits=rows))
    return earlier | set(sources)


def test_tc25_tc20_tc26_require_final_as_a_process_single_pass_final_pass_and_reopening(tmp_path):
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "audited")
    for rel, text in LS_TREE_FILES.items():
        write(repo, rel, text)
    run_git(repo, "add", "-A")                                                                       # git grep searches tracked files only
    known = write_pass_from_audit_run(repo, 1, REAL_QUERIES, set(), "verdict: another pass required, first pass")
    assert {"tools/a.py::lister", "tools/b.sh::tree", "lib/c.rs::list_tree"} <= known, "the real search found the three ls-tree users"
    one = tool(repo, "audit-check", "--require-final")                                             # TC-25: one pass only
    assert one.returncode == R.EXIT_FAIL and "E-NOT-FINAL" in one.stdout
    assert json.loads((repo / "ops/refactor/reports/audit.json").read_text())["final_pass"] is None
    known = write_pass_from_audit_run(repo, 2, REAL_QUERIES + [NEW_QUERY_Q5], known, "verdict: final")
    two = tool(repo, "audit-check", "--require-final")                                             # TC-20: a new query, no new hit
    assert two.returncode == R.EXIT_OK, two.stdout
    assert json.loads((repo / "ops/refactor/reports/audit.json").read_text())["final_pass"] == 2
    write(repo, "tools/d.sh", "reread() {\n  git diff HEAD\n}\n")                                   # TC-26: a new git read appears
    run_git(repo, "add", "tools/d.sh")                                                              # git grep searches tracked files only
    write_pass_from_audit_run(repo, 3, REAL_QUERIES + [NEW_QUERY_Q5, NEW_QUERY_Q6], known, "verdict: another pass required, a new hit")
    three = tool(repo, "audit-check", "--require-final")
    report = json.loads((repo / "ops/refactor/reports/audit.json").read_text())
    assert three.returncode == R.EXIT_FAIL and "E-NOT-FINAL" in three.stdout
    assert report["final_pass"] is None and report["final_reason"] == "new-hits" and report["passes"][2]["new"] == 1


# ---- story 19: every hit has one outcome, an access, a way and a use case (TC-30 to TC-39; task 19.13) --------------------------

AGENT_FILES = {**AUDIT_FILES, "tools/agent.py": 'def agent_git():\n    run("git push")\n'}       # agent_git is a class W function (the agent's own repository)
AGENT_HITS = AUDIT_HITS + [("tools/agent.py", "agent_git", "Q1")]
SHOW_ROW, AGENT_ROW = 2, 6                                                                      # indexes in AGENT_HITS


def classified(tmp_path: Path, overrides=None, extra=(), use_cases_toml=None) -> tuple[R.Result, Path]:
    root = audit_root(tmp_path, passes={1: pass_md(hits=AGENT_HITS, overrides={AGENT_ROW: {"Outcome": "intrinsic", "UseCase": "", "Reason": "git in the agent's own repository"}, **(overrides or {})}, extra_hits=extra)}, files=AGENT_FILES)
    if use_cases_toml is not None:
        write(root, "ops/refactor/use_cases.toml", use_cases_toml)
    return check(root), root


def test_tc30_protected_excluded_and_intrinsic_rows_are_accepted_and_counted(tmp_path):
    result, root = classified(tmp_path, overrides={SHOW_ROW: {"Outcome": "excluded", "UseCase": "", "Reason": "reads the agent-visible clone only"}})
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]
    assert audit_json(root)["passes"][0]["outcomes"] == {"protected": 5, "excluded": 1, "intrinsic": 1}


@pytest.mark.parametrize("overrides,extra,code", [
    pytest.param({0: {"Outcome": ""}}, (), "E-HIT-NO-OUTCOME", id="TC-31-no-outcome"),
    pytest.param({}, [hit_row(9, "tools/pull.py", "pull", "Q1", outcome="excluded", reason="a second opinion", use_case="")], "E-HIT-OUTCOME-CONFLICT", id="TC-32-one-identity-two-outcomes"),
    pytest.param({0: {"UseCase": ""}}, (), "E-HIT-NO-USE-CASE", id="TC-33-protected-without-a-use-case"),
    pytest.param({0: {"UseCase": "U15"}}, (), "E-USE-CASE-UNKNOWN", id="TC-34-an-unrecorded-use-case"),
    pytest.param({0: {"Outcome": "excluded", "UseCase": "", "Reason": ""}}, (), "E-EXCLUDED-NO-REASON", id="TC-35-excluded-without-a-reason"),
    pytest.param({0: {"Outcome": "intrinsic", "UseCase": "", "Reason": "own repository"}}, (), "E-INTRINSIC-NOT-OWN-REPO", id="TC-36-intrinsic-outside-class-W"),
    pytest.param({0: {"Access": "reads"}}, (), "E-ACCESS-INVALID", id="TC-37-bad-access"),
    pytest.param({0: {"Via": "both"}}, (), "E-VIA-INVALID", id="TC-38-bad-via"),
])
def test_a_hit_that_breaks_a_classification_rule_is_refused_with_its_code(tmp_path, overrides, extra, code):
    result, _ = classified(tmp_path, overrides=overrides, extra=extra)
    assert codes(result) == [code], [(p.code, p.subject, p.detail) for p in result.problems]
    assert "tools/agent.py::agent_git" not in " ".join(p.detail for p in result.problems), "the valid intrinsic row is not blamed"


def test_tc39_a_use_case_the_owner_agreed_is_accepted_only_when_recorded_with_a_reason(tmp_path):
    base = "[use_cases]\n" + "".join(f'{u} = "use case {u}"\n' for u in USE_CASE_IDS)
    agreed = base + '\n[agreed.U15]\ndescription = "the owner reads the audit"\nreason = "agreed 15 Oct 2026"\n'
    unexplained = base + '\n[agreed.U15]\ndescription = "the owner reads the audit"\nreason = ""\n'
    ok, _ = classified(tmp_path / "ok", overrides={0: {"UseCase": "U15"}}, use_cases_toml=agreed)
    assert ok.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in ok.problems]
    refused, _ = classified(tmp_path / "no", overrides={0: {"UseCase": "U15"}}, use_cases_toml=unexplained)
    assert codes(refused) == ["E-USE-CASE-UNKNOWN"]


# ---- story 19: the real use-case and class tables are accepted (TC-40; task 19.14) ---------------------------------------------

NOTHING_MATCHES = r"zz-matches-nothing-zz"


def test_tc40_the_fourteen_real_use_cases_and_a_real_class_w_function_are_accepted_by_audit_check_as_a_process(tmp_path):
    real = Path(__file__).parent
    use_cases = tomllib.loads((real / "use_cases.toml").read_text())["use_cases"]
    workspace_function = tomllib.loads((real / "classes.toml").read_text())["classes"]["W"]["functions"][0]
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "audited")
    write(repo, "ops/refactor/use_cases.toml", (real / "use_cases.toml").read_text())
    write(repo, "ops/refactor/classes.toml", (real / "classes.toml").read_text())
    queries = [(f"Q{i + 1}", category, NOTHING_MATCHES, ".") for i, category in enumerate(CATEGORIES)]
    rows = [hit_row(i + 1, "tools/publish.py", f"reads_for_{u.lower()}", "manual", reason=f"found by reading, {u}", use_case=u) for i, u in enumerate(sorted(use_cases, key=lambda u: int(u[1:])))]
    rows.append(hit_row(99, "tools/publish.py", workspace_function, "manual", reason="git in the agent's own repository", outcome="intrinsic", use_case=""))
    write(repo, f"{AUDIT_DIR}/pass-01.md", pass_md(queries=queries, hits=[], extra_hits=rows))
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-q", "-m", "pass 01 with every real use case")
    done = tool(repo, "audit-check")
    assert done.returncode == R.EXIT_OK, done.stdout
    outcomes = json.loads((repo / "ops/refactor/reports/audit.json").read_text())["passes"][0]["outcomes"]
    assert outcomes == {"protected": len(use_cases), "intrinsic": 1} and len(use_cases) == 14


# ---- story 19: pass 01 accounts for the gaps known on 15 October 2026 (TC-70 to TC-72; task 19.16) ---------------------------------

SEED_TOML = """
[[place]]
file = "tools/pull.py"
function = "pull"
reason = "runs git pull"

[[place]]
file = "lib/runs.py"
function = "*"
reason = "reads the bundle of a run"

[[place]]
file = "benchmarks/spec-bench/h.py"
function = "url"
reason = "builds a code-host address"
"""
CLAIMS = "benchmarks/spec-bench/harness/claims.py"


def seeded(tmp_path: Path, seed: str = SEED_TOML, extra: list | None = None, overrides=None):
    root = audit_root(tmp_path, passes={1: pass_md(extra_hits=extra or [], overrides=overrides)})
    write(root, f"{AUDIT_DIR}/seed.toml", seed)
    return check(root), root


def test_tc70_a_first_pass_with_a_row_for_every_seeded_place_passes(tmp_path):
    result, _ = seeded(tmp_path)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]


def test_tc71_a_first_pass_without_the_row_for_a_seeded_file_names_it(tmp_path):
    seed = SEED_TOML + f'\n[[place]]\nfile = "{CLAIMS}"\nfunction = "*"\nreason = "reads run records"\n'
    result, _ = seeded(tmp_path, seed)
    assert codes(result) == ["E-SEED-MISSING"] and CLAIMS in result.problems[0].detail


def test_a_whole_file_seed_is_satisfied_by_any_row_in_that_file_and_not_by_a_row_in_another(tmp_path):
    seed = f'[[place]]\nfile = "{CLAIMS}"\nfunction = "*"\nreason = "reads run records"\n'
    elsewhere = [hit_row(7, "benchmarks/spec-bench/harness/other.py", "<module>", "manual", reason="found by reading")]
    inside = [hit_row(7, CLAIMS, "<module>", "manual", reason="found by reading")]
    assert codes(seeded(tmp_path / "a", seed, extra=elsewhere)[0]) == ["E-SEED-MISSING"]
    assert seeded(tmp_path / "b", seed, extra=inside)[0].exit_code == R.EXIT_OK


def test_a_named_function_seed_needs_that_function_not_just_the_file(tmp_path):
    seed = '[[place]]\nfile = "tools/pull.py"\nfunction = "fetch"\nreason = "runs git fetch"\n'
    assert codes(seeded(tmp_path, seed)[0]) == ["E-SEED-MISSING"]


def test_a_seeded_row_must_have_an_outcome(tmp_path):
    result, _ = seeded(tmp_path, SEED_TOML, overrides={0: {"Outcome": ""}})
    assert "E-HIT-NO-OUTCOME" in codes(result)                # the row exists but says nothing: the classification check refuses it


EXPECTED_SEED = [               # exactly the places the capability lists, 15 October 2026
    ("benchmarks/spec-bench/harness/annotate.py", "*"), ("benchmarks/spec-bench/harness/claims.py", "*"),
    ("tools/anthropic-token-counter/src/corpus.rs", "*"),
    ("tools/dbench/src/ingest/inputs.rs", "inputs_for"), ("tools/dbench/src/ingest/inputs.rs", "ids"), ("tools/dbench/src/ingest/inputs.rs", "read"),
    ("benchmarks/spec-bench/harness/history.py", "_event_times"),
    ("tools/dbench/src/collect.rs", "manifest"), ("tools/dbench/src/collect.rs", "resolve"), ("tools/dbench/src/collect.rs", "parse_name"),
    ("tools/dbench/src/collector.rs", "plan"), ("tools/dbench/src/collector.rs", "pull_blob"), ("tools/dbench/src/collector.rs", "store_dir"),
    ("tools/dbench/src/collector.rs", "classes_for"), ("tools/dbench/src/collector.rs", "wanted"),
    ("tools/dbench/src/server.rs", "file_of"),
    ("tools/benchmarker/server/domain.ts", "findRuns"), ("tools/benchmarker/server/sources.ts", "loadRuns"),
    ("tools/vidi-gallery/src/runs.rs", "*"), ("tools/vidi-gallery/src/builds.rs", "*"), ("tools/vidi-gallery/src/main.rs", "*"),
    ("ops/monitor/monitor.py", "git_json"),
    ("benchmarks/spec-bench/harness/drive.py", "known_good_base"), ("benchmarks/spec-bench/harness/progress.py", "baselines"),
    ("benchmarks/spec-bench/harness/logscan.py", "known_runs"), ("benchmarks/spec-bench/harness/judge.py", "*"),
]


def test_tc72_the_real_seed_holds_exactly_the_places_the_capability_lists_each_with_a_reason():
    places = tomllib.loads((Path(__file__).parent / "audit" / "seed.toml").read_text())["place"]
    assert sorted((p["file"], p["function"]) for p in places) == sorted(EXPECTED_SEED)
    assert all(p["reason"].strip() for p in places)


# ---- story 19: every seeded place exists in the real tree (TC-72 on the real repository; task 19.34) --------------------------------

REAL_REPOSITORY = Path(__file__).resolve().parents[2]


def seed_rot(repo: Path) -> list[str]:
    """Seeded places that no longer exist in the tracked tree: a file that is not tracked, or a function the tool's own scan cannot find."""
    seed = tomllib.loads((repo / "ops/refactor/audit/seed.toml").read_text())["place"]
    tracked = set(sp.run(["git", "-C", str(repo), "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n"))
    rot = []
    for place in seed:
        file, function = place["file"], place["function"]
        if file not in tracked:
            rot.append(f"{file}::{function}: the file is not tracked")
        elif function != "*":
            language = R.SOURCE_LANGUAGES.get(Path(file).suffix)
            names = {f.name.split(".")[-1] for f in R.functions_of(language, (repo / file).read_text())}
            if function not in names:
                rot.append(f"{file}::{function}: no such function in the file")
    return rot


def test_every_place_in_the_real_seed_exists_in_the_real_tree():
    assert seed_rot(REAL_REPOSITORY) == []


def test_a_planted_seed_naming_a_missing_file_and_a_missing_function_is_reported_with_the_entries_named(tmp_path):
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "audited")
    seed = ('[[place]]\nfile = "tools/publish.py"\nfunction = "tracked_runs"\nreason = "lists tracked runs"\n'
            '[[place]]\nfile = "tools/publish.py"\nfunction = "gone_function"\nreason = "was renamed"\n'
            '[[place]]\nfile = "tools/gone.py"\nfunction = "*"\nreason = "was deleted"\n')
    write(repo, "ops/refactor/audit/seed.toml", seed)
    assert seed_rot(repo) == ["tools/publish.py::gone_function: no such function in the file", "tools/gone.py::*: the file is not tracked"]


# ---- story 19: findings that are not code stay listed until the owner closes them (TC-80 to TC-85; task 19.18) ------------------

F01 = ("F-01", "ten finished runs hold the only copy of the final source tree", "open")
OPEN_FINDING = '[[finding]]\nid = "F-01"\ntitle = "ten finished runs hold the only copy of the final source tree"\ndetail = "archive them first"\nstatus = "open"\n'
CLOSED_WITH_RECORD = OPEN_FINDING.replace('status = "open"', 'status = "closed"\nclosed_on = "2026-10-20"\nclosed_by = "owner decision, archived in the owner\'s store"')
CLOSED_WITHOUT_RECORD = OPEN_FINDING.replace('status = "open"', 'status = "closed"\nclosed_on = "2026-10-20"\nclosed_by = ""')


def with_findings(tmp_path: Path, findings_toml: str, first=(F01,), second=(F01,)):
    root = audit_root(tmp_path, passes={1: pass_md(findings=first), 2: later_pass_with(second)})
    write(root, f"{AUDIT_DIR}/findings.toml", findings_toml)
    return check(root), root


def later_pass_with(findings) -> str:
    return pass_md(queries=AUDIT_QUERIES + [EXTRA_QUERY], default_new="no", findings=findings, verdict=ANOTHER)


def test_tc80_an_open_finding_listed_in_every_pass_is_accepted(tmp_path):
    result, _ = with_findings(tmp_path, OPEN_FINDING)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]


def test_tc81_a_pass_that_omits_an_open_finding_is_refused_naming_it(tmp_path):
    result, _ = with_findings(tmp_path, OPEN_FINDING, second=())
    assert codes(result) == ["E-FINDING-DROPPED"] and "F-01" in result.problems[0].detail and result.problems[0].subject == "pass-02.md"


def test_tc82_a_pass_that_lists_an_id_not_in_the_findings_file_is_refused(tmp_path):
    result, _ = with_findings(tmp_path, OPEN_FINDING, second=(F01, ("F-09", "not recorded", "open")))
    assert codes(result) == ["E-FINDING-UNKNOWN"] and "F-09" in result.problems[0].detail


def test_tc83_a_closed_finding_without_a_date_and_a_reference_is_refused(tmp_path):
    result, _ = with_findings(tmp_path, CLOSED_WITHOUT_RECORD)
    assert codes(result) == ["E-FINDING-CLOSE-NO-RECORD"] and "F-01" in result.problems[0].detail


def test_tc84_a_closed_finding_with_its_record_is_accepted_and_the_passes_before_it_still_list_it_as_open(tmp_path):
    result, _ = with_findings(tmp_path, CLOSED_WITH_RECORD, first=(F01,), second=())
    assert result.exit_code == R.EXIT_OK, [(p.code, p.detail) for p in result.problems]


def test_the_tool_never_changes_a_findings_status(tmp_path):
    result, root = with_findings(tmp_path, OPEN_FINDING, second=())
    assert codes(result) == ["E-FINDING-DROPPED"]
    assert (root / AUDIT_DIR / "findings.toml").read_text() == OPEN_FINDING


F01_RUNS = [
    "benchmarks/reference/todoodle/opus-5.5/run-1", "benchmarks/reference/todoodle/opus-5.5/run-2",
    "benchmarks/reference/vidi/opus-5.5/run-1", "benchmarks/reference/vidi/sonnet-5.5/v2-r2", "benchmarks/reference/vidi/sonnet-5.5/v2-r3",
    "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r4",
    "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r4",
    "combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/benchmarks/vidi/strata-s2on-r1",
    "combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/benchmarks/vidi/v2-strata0141-r2",
    "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/strata-pi/benchmarks/vidi/v2-stratastrix-r1",
]


def test_tc85_the_real_findings_file_has_f_01_open_and_naming_the_ten_run_folders():
    findings = {f["id"]: f for f in tomllib.loads((Path(__file__).parent / "audit" / "findings.toml").read_text())["finding"]}
    assert findings["F-01"]["status"] == "open" and findings["F-01"]["runs"] == F01_RUNS and len(F01_RUNS) == 10


# ---- story 19: while F-01 is open the ten runs really have a tracked workspace and no bundle (TC-85 on the real repository; task 19.35) ----

def finding_untrue(repo: Path) -> list[str]:
    """For each open finding that names runs: the runs that no longer have tracked workspace files and no bundle (the finding is stale)."""
    stale = []
    tracked = sp.run(["git", "-C", str(repo), "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
    for finding in tomllib.loads((repo / "ops/refactor/audit/findings.toml").read_text())["finding"]:
        if finding["status"] != "open":
            continue                                          # closed by the owner: nothing is asserted about the tree
        for run in finding.get("runs", []):
            if f"{run}/workspace.bundle" in tracked:
                stale.append(f"{finding['id']}: {run} has a bundle")
            elif not any(f.startswith(f"{run}/workspace/") for f in tracked):
                stale.append(f"{finding['id']}: {run} has no tracked workspace")
    return stale


def test_while_f_01_is_open_its_ten_runs_have_a_tracked_workspace_and_no_bundle_in_the_real_repository():
    assert finding_untrue(REAL_REPOSITORY) == []


def test_a_planted_open_finding_naming_a_run_with_a_bundle_or_no_workspace_is_reported_naming_the_run(tmp_path):
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "audited")
    write(repo, "runs/vidi/m2/run-1/workspace/app.js", "x\n")
    write(repo, "runs/vidi/m2/run-1/metrics.json", "{}\n")
    write(repo, "runs/vidi/m3/run-1/workspace/app.js", "x\n")
    write(repo, "runs/vidi/m3/run-1/workspace.bundle", "bundle\n")
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-q", "-m", "runs")
    toml = ('[[finding]]\nid = "F-01"\ntitle = "t"\ndetail = "d"\nstatus = "open"\nruns = ["runs/vidi/m2/run-1", "runs/vidi/m3/run-1", "runs/vidi/m4/run-1"]\n')
    write(repo, "ops/refactor/audit/findings.toml", toml)
    assert finding_untrue(repo) == ["F-01: runs/vidi/m3/run-1 has a bundle", "F-01: runs/vidi/m4/run-1 has no tracked workspace"]
    write(repo, "ops/refactor/audit/findings.toml", toml.replace('status = "open"', 'status = "closed"'))
    assert finding_untrue(repo) == [], "a closed finding asserts nothing about the tree"


# ---- story 19: the touched set equals the final audit (TC-50 to TC-55; task 19.20) -------------------------------------------------

EQUAL_CLASSES = """[sources]
python = ["tools/*.py", "lib/*.py", "tests/*.py", "benchmarks/spec-bench/*.py"]
shell = ["ops/*.sh"]

[classes.B]
patterns = ['git (pull|push|show)']

[classes.W]
functions = ["agent_git"]
"""
FETCHIT_FILE = {"tools/fetchit.py": 'def fetchit():\n    run("git fetch")\n'}                          # found only by the query for git fetch
FETCHIT_ROW = hit_row(7, "tools/fetchit.py", "fetchit", "Q5", new="yes")
PROTECTED_IDS = [("python", "tools/pull.py", "pull"), ("python", "tools/pull.py", "push"), ("shell", "ops/show.sh", "show"),
                 ("python", "lib/runs.py", "bundle_of"), ("python", "benchmarks/spec-bench/h.py", "url"), ("python", "tests/test_hist.py", "test_history")]


def touched_toml(ids) -> str:
    return "".join(entry(lang, file, fn, '"B"') for lang, file, fn in ids)


def equal_root(tmp_path: Path, ids=PROTECTED_IDS, passes=None, files=None) -> Path:
    """A root whose final audit is pass 02, with the touched set written for `ids`."""
    root = audit_root(tmp_path, passes=passes if passes is not None else {1: pass_md(), 2: later_pass(verdict=FINAL)}, files=files or AUDIT_FILES)
    write(root, "ops/refactor/classes.toml", EQUAL_CLASSES)
    write(root, "ops/refactor/touched_set.toml", touched_toml(ids))
    return root


def touched(root: Path) -> R.Result:
    return R.check_touched(root, grep=file_grep)


def test_tc50_a_set_equal_to_the_protected_hits_of_the_final_audit_passes_with_the_counts(tmp_path):
    root = equal_root(tmp_path)
    before = (root / "ops/refactor/touched_set.toml").read_bytes()
    result = touched(root)
    assert result.exit_code == R.EXIT_OK, [(p.code, p.subject, p.detail) for p in result.problems]
    assert result.data["audit_counts"] == {"protected": 6, "entries": 6, "excluded": 0, "intrinsic": 0}
    assert (root / "ops/refactor/touched_set.toml").read_bytes() == before, "the tool never writes the touched set"


def three_pass_root(tmp_path: Path, ids=PROTECTED_IDS) -> Path:
    """Pass 02 finds tools/fetchit.py::fetchit with a new query; pass 03 adds a query and finds nothing new, so it is final."""
    second = pass_md(queries=AUDIT_QUERIES + [EXTRA_QUERY], default_new="no", extra_hits=[FETCHIT_ROW], verdict=ANOTHER)
    third = pass_md(queries=AUDIT_QUERIES + [EXTRA_QUERY, THIRD_QUERY], default_new="no", extra_hits=[[*FETCHIT_ROW[:9], "no"]], verdict=FINAL)
    return equal_root(tmp_path, ids=ids, passes={1: pass_md(), 2: second, 3: third}, files={**AUDIT_FILES, **FETCHIT_FILE})


def test_tc51_a_protected_hit_that_is_not_an_entry_is_named_with_the_pass_that_first_found_it(tmp_path):
    result = touched(three_pass_root(tmp_path))
    assert codes(result) == ["E-AUDIT-MISSING-FROM-SET"]
    assert "tools/fetchit.py::fetchit" in result.problems[0].subject and "pass 02" in result.problems[0].detail


def test_tc52_an_entry_no_protected_hit_supports_is_refused(tmp_path):
    files = {**AUDIT_FILES, "tools/pull.py": AUDIT_FILES["tools/pull.py"] + "\n\ndef unused():\n    return 1\n"}
    root = equal_root(tmp_path, ids=PROTECTED_IDS + [("python", "tools/pull.py", "unused")], files=files)
    result = touched(root)
    assert codes(result) == ["E-SET-NOT-IN-AUDIT"] and "tools/pull.py::unused" in result.problems[0].subject


def test_tc53_a_hit_the_audit_excluded_that_is_also_an_entry_is_refused(tmp_path):
    excluded = pass_md(overrides={2: {"Outcome": "excluded", "UseCase": "", "Reason": "reads the agent-visible clone only"}})
    second = pass_md(queries=AUDIT_QUERIES + [EXTRA_QUERY], default_new="no", overrides={2: {"Outcome": "excluded", "UseCase": "", "Reason": "reads the agent-visible clone only"}}, verdict=FINAL)
    root = equal_root(tmp_path, passes={1: excluded, 2: second})              # ops/show.sh::show is excluded but still listed
    result = touched(root)
    assert codes(result) == ["E-HIT-EXCLUDED-IN-SET"] and "ops/show.sh::show" in result.problems[0].subject


def test_tc54_passes_that_are_not_final_mean_no_comparison_is_made(tmp_path):
    second = pass_md(queries=AUDIT_QUERIES + [EXTRA_QUERY], default_new="no", extra_hits=[FETCHIT_ROW], verdict=ANOTHER)
    root = equal_root(tmp_path, passes={1: pass_md(), 2: second}, files={**AUDIT_FILES, **FETCHIT_FILE})
    assert codes(touched(root)) == ["E-NO-FINAL-AUDIT"]


def test_tc55_a_module_level_entry_that_exists_only_for_constants_is_exempt(tmp_path):
    root = equal_root(tmp_path, ids=PROTECTED_IDS + [("python", "tools/pull.py", "<module>")])
    assert touched(root).exit_code == R.EXIT_OK


# ---- story 19: the class derivation still runs beside the audit (TC-56; task 19.21) ------------------------------------------------

DERIVATION_CLASSES = """[sources]
python = ["tools/*.py"]
shell = ["tools/*.sh"]
rust = ["lib/*.rs"]

[classes.B]
patterns = ['git (ls-tree|cat-file)']
"""
LANGUAGE_OF_SUFFIX = {".py": "python", ".sh": "shell", ".rs": "rust"}


def test_tc56_an_unlisted_function_the_derivation_matches_is_still_refused_when_the_audit_and_the_list_are_equal(tmp_path):
    repo = load_fixture_module("build_mini_repo").build(tmp_path / "audited")
    for rel, text in LS_TREE_FILES.items():
        write(repo, rel, text)
    run_git(repo, "add", "-A")                                                                       # git grep searches tracked files only
    known = write_pass_from_audit_run(repo, 1, REAL_QUERIES, set(), "verdict: another pass required, first pass")
    write_pass_from_audit_run(repo, 2, REAL_QUERIES + [NEW_QUERY_Q5], known, "verdict: final")
    write(repo, "ops/refactor/classes.toml", DERIVATION_CLASSES)
    write(repo, "ops/refactor/touched_set.toml", "".join(entry(LANGUAGE_OF_SUFFIX[Path(i.split('::')[0]).suffix], i.split("::")[0], i.split("::")[1], '"B"') for i in sorted(known)))
    run_git(repo, "add", "-A")
    equal = tool(repo, "check-touched-set")
    assert equal.returncode == R.EXIT_OK, equal.stdout
    lines = equal.stdout.splitlines()
    assert lines[0].startswith("scope: whole touched set") and lines[-1] == f"counts: protected hits {len(known)}, entries {len(known)}, excluded hits 0, intrinsic hits 0"
    write(repo, "tools/e.py", 'def peek():\n    run("git cat-file -p HEAD")\n')                  # a git read the audit's queries do not match
    run_git(repo, "add", "tools/e.py")
    unlisted = tool(repo, "check-touched-set")
    assert unlisted.returncode == R.EXIT_FAIL and "E-UNLISTED-MATCH  tools/e.py::peek" in unlisted.stdout


# ---- story 19: the stage moves back when the touched set has grown since the proof (TC-60 to TC-65; task 19.23) ------------------------

TOUCHED_SET_SIZE = 98      # the real touched set on 15 October 2026: 98 entries, so the boundaries are 97 (one removed) and 99 (one added)


def member_ids(n: int) -> list[str]:
    return [f"src/m{i}.py::f{i}" for i in range(n)]


def proof_toml(ids: list[str]) -> str:
    digest = R.members_digest([{"file": i.split("::")[0], "function": i.split("::")[1]} for i in ids])
    return f'\n[proved_members]\ndigest = "{digest}"\ncount = {len(ids)}\nmembers = [{", ".join(chr(34) + i + chr(34) for i in ids)}]\n'


def staged_root(tmp_path: Path, stage: str, proved: list[str] | None, current: list[str]) -> Path:
    root = make_root(tmp_path, touched="".join(entry("python", i.split("::")[0], i.split("::")[1], '"C"') for i in current))
    write(root, "ops/refactor/stage.toml", f'stage = "{stage}"\n' + (proof_toml(proved) if proved is not None else ""))
    return root


def stage_file(root: Path) -> dict:
    return tomllib.loads((root / "ops/refactor/stage.toml").read_text())


def test_tc60_the_same_members_leave_a_proved_stage_alone(tmp_path):
    root = staged_root(tmp_path, "Proved", member_ids(TOUCHED_SET_SIZE), member_ids(TOUCHED_SET_SIZE))
    before = (root / "ops/refactor/stage.toml").read_bytes()
    result = R.reconcile_stage(root)
    assert result.exit_code == R.EXIT_OK and (root / "ops/refactor/stage.toml").read_bytes() == before


def test_tc61_a_member_added_since_the_proof_moves_a_proved_stage_back_to_matrices_naming_it(tmp_path):
    root = staged_root(tmp_path, "Proved", member_ids(TOUCHED_SET_SIZE), member_ids(TOUCHED_SET_SIZE + 1))
    result = R.reconcile_stage(root)
    assert codes(result) == ["E-MEMBER-UNPROVED"] and f"src/m{TOUCHED_SET_SIZE}.py::f{TOUCHED_SET_SIZE}" in result.problems[0].detail
    state = stage_file(root)
    assert state["stage"] == "Matrices" and state["move"][-1]["from"] == "Proved" and "E-MEMBER-UNPROVED" in state["move"][-1]["justified_by"]
    assert R.reconcile_stage(root).exit_code == R.EXIT_OK, "a second reconcile at Matrices changes nothing"


def test_tc62_a_member_removed_leaves_the_proof_standing(tmp_path):
    root = staged_root(tmp_path, "Proved", member_ids(TOUCHED_SET_SIZE), member_ids(TOUCHED_SET_SIZE - 1))
    assert R.reconcile_stage(root).exit_code == R.EXIT_OK and stage_file(root)["stage"] == "Proved"


@pytest.mark.parametrize("stage", ["Deleted", "RedContracts", "Reimplemented"])
def test_tc63_a_later_stage_also_moves_back_when_a_member_was_added(tmp_path, stage):
    root = staged_root(tmp_path, stage, member_ids(TOUCHED_SET_SIZE), member_ids(TOUCHED_SET_SIZE + 1))
    assert codes(R.reconcile_stage(root)) == ["E-MEMBER-UNPROVED"] and stage_file(root)["stage"] == "Matrices"


@pytest.mark.parametrize("stage", ["Inventory", "Matrices"])
def test_tc64_before_proved_a_new_member_changes_nothing(tmp_path, stage):
    root = staged_root(tmp_path, stage, None, member_ids(6))
    before = (root / "ops/refactor/stage.toml").read_bytes()
    assert R.reconcile_stage(root).exit_code == R.EXIT_OK and (root / "ops/refactor/stage.toml").read_bytes() == before


def test_tc65_a_proved_stage_with_no_recorded_proof_moves_back_once(tmp_path):
    root = staged_root(tmp_path, "Proved", None, member_ids(TOUCHED_SET_SIZE))
    assert codes(R.reconcile_stage(root)) == ["E-STAGE-DIGEST-MISSING"] and stage_file(root)["stage"] == "Matrices"


def test_boundary_a_one_entry_set_is_unproved_when_a_second_member_appears(tmp_path):
    assert R.reconcile_stage(staged_root(tmp_path / "same", "Proved", member_ids(1), member_ids(1))).exit_code == R.EXIT_OK
    assert codes(R.reconcile_stage(staged_root(tmp_path / "grown", "Proved", member_ids(1), member_ids(2)))) == ["E-MEMBER-UNPROVED"]


def test_the_reconciliation_never_moves_the_stage_forward(tmp_path):
    root = staged_root(tmp_path, "Matrices", member_ids(5), member_ids(5))          # a proof on record and equal members, but the stage is still Matrices
    assert R.reconcile_stage(root).exit_code == R.EXIT_OK and stage_file(root)["stage"] == "Matrices"


def test_a_move_to_proved_records_the_members_and_later_moves_keep_them(tmp_path):
    root = make_root(tmp_path, touched="".join(entry("python", i.split("::")[0], i.split("::")[1], '"C"') for i in member_ids(3)))
    write(root, "ops/refactor/stage.toml", 'stage = "Matrices"\n')
    ok = {("Matrices", "Proved"): lambda r: R.Result(), ("Proved", "Deleted"): lambda r: R.Result()}
    assert R.move_stage(root, "Proved", ok).exit_code == R.EXIT_OK
    recorded = stage_file(root)["proved_members"]
    assert recorded["count"] == 3 and recorded["members"] == member_ids(3) and recorded["digest"] == R.members_digest([{"file": i.split("::")[0], "function": i.split("::")[1]} for i in member_ids(3)])
    assert R.move_stage(root, "Deleted", ok).exit_code == R.EXIT_OK and stage_file(root)["proved_members"] == recorded


@pytest.mark.parametrize("command", ["stage", "check-stubs", "report-deletion", "check-coverage"])
def test_each_stage_aware_command_reconciles_first_and_stops_when_it_moved_the_stage(tmp_path, capsys, command):
    root = staged_root(tmp_path, "Proved", member_ids(5), member_ids(6))
    assert cli(root, command) == R.EXIT_FAIL
    out = capsys.readouterr().out
    assert "E-MEMBER-UNPROVED" in out and stage_file(root)["stage"] == "Matrices"
    assert not (root / "ops/refactor/reports/stubs.json").exists(), "the command itself did not run"


# ---- story 19: re-proving records the digest, and a killed write is never partial (TC-66, TC-67; task 19.24) ---------------------------

def without_entry(touched: str, function: str) -> str:
    blocks = touched.split("[[entry]]")
    return "[[entry]]".join(b for b in blocks if f'function = "{function}"' not in b)


def test_tc66_after_the_stage_moved_back_the_added_member_is_proved_and_the_new_digest_is_recorded(coverage_tools, tmp_path):
    root = mini_at_matrices(tmp_path)
    touched_file = root / "ops/refactor/touched_set.toml"
    full = touched_file.read_text()
    touched_file.write_text(without_entry(full, "titleOf"))                       # the proof is made over three members
    assert tool(root, "stage", "Proved").returncode == R.EXIT_OK, "the first proof"
    first = stage_file(root)["proved_members"]
    assert first["count"] == 3 and not any("titleOf" in m for m in first["members"])
    touched_file.write_text(full)                                                 # a fourth member joins the set (it is covered and has its matrix)
    moved = tool(root, "stage")
    assert moved.returncode == R.EXIT_FAIL and "E-MEMBER-UNPROVED" in moved.stdout and "titleOf" in moved.stdout
    assert stage_file(root)["stage"] == "Matrices"
    proved = tool(root, "stage", "Proved")                                        # matrix and coverage are green for all four
    assert proved.returncode == R.EXIT_OK, proved.stdout + proved.stderr
    second = stage_file(root)
    assert second["stage"] == "Proved" and second["proved_members"]["count"] == 4 and any("titleOf" in m for m in second["proved_members"]["members"])
    assert second["proved_members"]["digest"] != first["digest"]


@pytest.mark.parametrize("where", sorted(KILL_POINTS))
def test_tc67_a_process_killed_while_it_writes_the_back_move_leaves_the_old_or_the_new_stage_file_never_a_partial_one(tmp_path, where):
    old_root = staged_root(tmp_path / "old", "Proved", member_ids(5), member_ids(6))
    old = (old_root / "ops/refactor/stage.toml").read_text()
    new_root = staged_root(tmp_path / "new", "Proved", member_ids(5), member_ids(6))
    R.reconcile_stage(new_root, now=datetime_for_tests())
    new = (new_root / "ops/refactor/stage.toml").read_text()
    kill = "os.kill(os.getpid(), signal.SIGKILL)"
    point = KILL_POINTS[where]
    patch = (f"_real = os.replace\ndef _replace(*a, **k):\n    _real(*a, **k)\n    {kill}\nos.replace = _replace\n" if point == "after-replace"
             else f"os.{point.split('.')[1]} = lambda *a, **k: {kill}\n")
    script = ("import os, signal, sys, pathlib, datetime\nsys.path.insert(0, %r)\nimport refactor as R\n%s"
              "R.reconcile_stage(pathlib.Path(%r), now=datetime.datetime(2026, 10, 15, tzinfo=datetime.timezone.utc))\n" % (str(Path(R.__file__).parent), patch, str(old_root)))
    proc = subprocess.run([sys.executable, "-c", script])
    assert proc.returncode != 0
    assert (old_root / "ops/refactor/stage.toml").read_text() in (old, new)


def datetime_for_tests():
    import datetime
    return datetime.datetime(2026, 10, 15, tzinfo=datetime.timezone.utc)


# ---- story 19: the whole workflow on the miniature project (W-1 and W-2; tasks 19.26 and 19.27) ------------------------------------

W_QUERIES = [                    # queries tuned to the four functions of the mini project; two categories find nothing there
    ("Q1", "vcs-command", r"kept\.append", "."), ("Q2", "tree-read", r"\{data_root\}", "."),
    ("Q3", "host-url", r"zz-nothing-host-zz", "."), ("Q4", "history-test", r"zz-nothing-history-zz", "."),
]
W_Q5, W_Q6 = ("Q5", "vcs-command", r"listing\.lines", "."), ("Q6", "vcs-command", r"run\.title \?\?", ".")
W_Q7 = ("Q7", "vcs-command", r"kept = \[\]", ".")                  # a new search that finds only what Q1 already found
W_Q8 = ("Q8", "vcs-command", r"git pull", ".")                     # finds the git read added in W-2
W_Q9 = ("Q9", "vcs-command", r"run\(.git pull.\)", ".")            # a new search that finds only what Q8 found
GIT_IGNORE = "node_modules\ntarget/\n__pycache__/\n.pytest_cache/\n.coverage\nops/refactor/reports/\n"


def mini_audit_repo(tmp_path: Path) -> Path:
    """The mini project at stage Matrices with a matrix for each use case, as a git repository."""
    root = mini_at_matrices(tmp_path)
    write(root, ".gitignore", GIT_IGNORE)
    sp.run(["git", "-C", str(root), "init", "-q", "-b", "main"], check=True, capture_output=True)
    run_git(root, "add", "-A")
    run_git(root, "commit", "-q", "-m", "the mini project")
    return root


def run_w1(tmp_path: Path) -> tuple[Path, set[str], str]:
    """W-1: three passes reach a final audit, the list is extended to equal it, the stage goes back and is proved again."""
    repo = mini_audit_repo(tmp_path)
    touched_file = repo / "ops/refactor/touched_set.toml"
    full = touched_file.read_text()
    touched_file.write_text(without_entry(full, "titleOf"))                       # the list as it stands: three of the four members
    known = write_pass_from_audit_run(repo, 1, W_QUERIES, set(), ANOTHER)
    known = write_pass_from_audit_run(repo, 2, W_QUERIES + [W_Q5, W_Q6], known, ANOTHER)         # new hits: count_lines, titleOf
    known = write_pass_from_audit_run(repo, 3, W_QUERIES + [W_Q5, W_Q6, W_Q7], known, FINAL)     # one new query, no new hit
    final = tool(repo, "audit-check", "--require-final")                          # TC-20
    assert final.returncode == R.EXIT_OK, final.stdout
    assert json.loads((repo / "ops/refactor/reports/audit.json").read_text())["final_pass"] == 3
    refused = tool(repo, "check-touched-set")                                     # the list lacks titleOf, which pass 02 found
    assert refused.returncode == R.EXIT_FAIL and "E-AUDIT-MISSING-FROM-SET  ts/src/core.ts::titleOf" in refused.stdout and "pass 02" in refused.stdout
    assert tool(repo, "stage", "Proved").returncode == R.EXIT_OK                  # the first proof is over three members
    assert stage_file(repo)["proved_members"]["count"] == 3
    touched_file.write_text(full)                                                 # the list is extended to equal the audit
    equal = tool(repo, "check-touched-set")                                       # TC-50
    assert equal.returncode == R.EXIT_OK, equal.stdout
    assert equal.stdout.splitlines()[-1] == "counts: protected hits 4, entries 4, excluded hits 0, intrinsic hits 0"
    moved = tool(repo, "stage")                                                   # the stage goes back (E-MEMBER-UNPROVED)
    assert moved.returncode == R.EXIT_FAIL and "E-MEMBER-UNPROVED" in moved.stdout and stage_file(repo)["stage"] == "Matrices"
    reproved = tool(repo, "stage", "Proved")                                      # TC-66: the matrices and coverage are complete
    assert reproved.returncode == R.EXIT_OK, reproved.stdout + reproved.stderr
    state = stage_file(repo)
    assert state["stage"] == "Proved" and state["proved_members"]["count"] == 4
    return repo, known, state["proved_members"]["digest"]


def test_w1_three_passes_reach_a_final_audit_the_list_is_extended_and_the_stage_is_proved_again(coverage_tools, tmp_path):
    run_w1(tmp_path)


def test_w2_a_late_find_reopens_the_audit_and_the_list_check_refuses_until_a_new_pass_closes_it(coverage_tools, tmp_path):
    repo, known, digest = run_w1(tmp_path)
    write(repo, "py/minipy/fetchy.py", 'def pull_more():\n    return run("git pull")\n')
    run_git(repo, "add", "py/minipy/fetchy.py")
    known = write_pass_from_audit_run(repo, 4, W_QUERIES + [W_Q5, W_Q6, W_Q7, W_Q8], known, ANOTHER)       # pass 04 finds the new git read
    reopened = tool(repo, "audit-check", "--require-final")
    report = json.loads((repo / "ops/refactor/reports/audit.json").read_text())
    assert reopened.returncode == R.EXIT_FAIL and "E-NOT-FINAL" in reopened.stdout and report["final_pass"] is None and report["final_reason"] == "new-hits"
    refused = tool(repo, "check-touched-set")
    assert refused.returncode == R.EXIT_FAIL and "E-NO-FINAL-AUDIT" in refused.stdout
    assert stage_file(repo)["proved_members"]["digest"] == digest, "no member has been added to the list yet, so the proof stands"
    known = write_pass_from_audit_run(repo, 5, W_QUERIES + [W_Q5, W_Q6, W_Q7, W_Q8, W_Q9], known, FINAL)    # a new search, no new hit: final again
    assert tool(repo, "audit-check", "--require-final").returncode == R.EXIT_OK
    touched_file = repo / "ops/refactor/touched_set.toml"
    touched_file.write_text(touched_file.read_text() + entry("python", "py/minipy/fetchy.py", "pull_more", '"B"'))
    equal = tool(repo, "check-touched-set")
    assert equal.returncode == R.EXIT_OK and equal.stdout.splitlines()[-1] == "counts: protected hits 5, entries 5, excluded hits 0, intrinsic hits 0", equal.stdout
    moved = tool(repo, "stage")
    assert moved.returncode == R.EXIT_FAIL and "py/minipy/fetchy.py::pull_more" in moved.stdout and stage_file(repo)["stage"] == "Matrices"


# ---- story 19: a hit in a Rust test module is attributed to the test module (task 19.36) ------------------------------------------

RUST_WITH_TESTS = """const ROOT: &str = "git";

pub fn pull() -> &'static str {
    "git pull"
}

#[cfg(test)]
mod tests {
    #[test]
    fn it_pulls() {
        assert_eq!(super::pull(), "git pull");
    }
}
"""


@pytest.mark.parametrize("line,expected", [
    pytest.param(1, "<module>", id="a-constant-at-the-top-level"),
    pytest.param(4, "pull", id="a-line-in-a-function"),
    pytest.param(11, "<tests>", id="a-line-in-the-test-module"),
    pytest.param(7, "<tests>", id="the-marker-line-itself"),
])
def test_a_hit_in_a_rust_test_module_is_attributed_to_the_test_module_not_the_top_level(tmp_path, line, expected):
    write(tmp_path, "src/lib.rs", RUST_WITH_TESTS)
    assert R.function_at(tmp_path, "src/lib.rs", line) == expected


# ---- story 19: a comment block directly above a function belongs to that function (task 19.37) --------------------------------------

LEADING_RUST = """const TOP: u8 = 1;

fn a() {
    run("git pull");
}
// a stray remark about git push, then a blank line

/// docs of b: mentions git fetch
#[inline]
fn b() {
    run("git show");
}
"""
LEADING_SHELL = "first() {\n  git pull\n}\n# note about git push\nsecond() {\n  git show\n}\n"
LEADING_PYTHON = "def first():\n    return 1\n\n\n# note about git push\n@decorated\ndef second():\n    return 2\n"
LEADING_TS = "export function first() {\n  return 1\n}\n/** docs of second: git fetch */\nexport function second() {\n  return 2\n}\n"


@pytest.mark.parametrize("rel,text,line,expected", [
    pytest.param("src/x.rs", LEADING_RUST, 4, "a", id="rust-the-body-of-a-function"),
    pytest.param("src/x.rs", LEADING_RUST, 6, "a", id="rust-a-remark-followed-by-a-blank-line-stays-above"),
    pytest.param("src/x.rs", LEADING_RUST, 8, "b", id="rust-a-doc-comment-directly-above-belongs-to-the-function"),
    pytest.param("src/x.rs", LEADING_RUST, 9, "b", id="rust-an-attribute-directly-above-belongs-to-the-function"),
    pytest.param("src/x.rs", LEADING_RUST, 1, "<module>", id="rust-a-constant-at-the-top"),
    pytest.param("src/x.sh", LEADING_SHELL, 4, "second", id="shell-a-comment-directly-above-belongs-to-the-function"),
    pytest.param("src/x.sh", LEADING_SHELL, 2, "first", id="shell-the-body"),
    pytest.param("src/x.py", LEADING_PYTHON, 5, "second", id="python-a-comment-above-a-decorator-belongs-to-the-function"),
    pytest.param("src/x.py", LEADING_PYTHON, 6, "second", id="python-a-decorator-belongs-to-the-function"),
    pytest.param("src/x.ts", LEADING_TS, 4, "second", id="typescript-a-doc-comment-directly-above-belongs-to-the-function"),
    pytest.param("src/x.ts", LEADING_TS, 2, "first", id="typescript-the-body"),
])
def test_a_comment_block_directly_above_a_function_belongs_to_that_function(tmp_path, rel, text, line, expected):
    write(tmp_path, rel, text)
    assert R.function_at(tmp_path, rel, line) == expected


# ---- story 19: a file is parsed once however many hits fall in it (task 19.38) --------------------------------------------------------

def test_function_at_parses_a_file_once_for_many_hits_and_again_when_the_file_changes(tmp_path, monkeypatch):
    write(tmp_path, "src/x.rs", RUST_WITH_TESTS)
    write(tmp_path, "src/x.py", "def a():\n    return 1\n\n\ndef b():\n    return 2\n")
    calls = []
    real_functions_of, real_python_spans = R.functions_of, R.python_spans
    monkeypatch.setattr(R, "functions_of", lambda *a, **k: calls.append("functions_of") or real_functions_of(*a, **k))
    monkeypatch.setattr(R, "python_spans", lambda *a, **k: calls.append("python_spans") or real_python_spans(*a, **k))
    R.function_at.__globals__.get("parsed_file", lambda *a: None)             # the cache, if any, starts empty for this file
    for line in (1, 2, 3, 4, 5):
        R.function_at(tmp_path, "src/x.rs", line)
        R.function_at(tmp_path, "src/x.py", line)
    assert calls.count("functions_of") <= 1 and calls.count("python_spans") <= 1, calls
    write(tmp_path, "src/x.py", "def a():\n    return 1\n\n\ndef b():\n    return 2\n\n\ndef c():\n    return 3\n")
    assert R.function_at(tmp_path, "src/x.py", 9) == "c", "a changed file is read again, not answered from a stale cache"


# ---- cut statements (16 Oct 2026): the unit of deletion is the code that depends on what is replaced ----------------------------
# Step 1: reading and validating the `cut` / `whole` data of a touched-set entry (check-cuts).

CUT_PY = (
    "def publish(repo, run):\n"                                   # 1
    "    path = run_path(run)\n"                                  # 2
    "    result = subprocess.run(\n"                              # 3
    "        [\"git\", \"add\", path],\n"                         # 4
    "        check=False,\n"                                      # 5
    "    )\n"                                                     # 6
    "    if result.returncode != 0:\n"                            # 7
    "        return None\n"                                       # 8
    "    count = len(result.stdout)\n"                            # 9
    "    return count\n"                                          # 10
    "\n\n"
    "def other(x):\n"                                             # 13
    "    count = len(x)\n"                                        # 14
    "    return count\n"                                          # 15
)


def cut_entry(function: str = "publish", body: str = "", language: str = "python", file: str = "src/p.py", head: str = "") -> str:
    """A touched-set entry in TOML; `body` is the cut-related keys (whole = true, or [[entry.cut]] tables)."""
    return f'[[entry]]\nlanguage = "{language}"\nfile = "{file}"\nfunction = "{function}"\nclasses = ["C"]\n{head}{body}\n'


def cut_toml(anchor: str, why: str = "runs git", lines: int | None = None, nth: int | None = None, extra: str = "") -> str:
    """One [[entry.cut]] table."""
    keys = f'anchor = {json.dumps(anchor)}\nwhy = {json.dumps(why)}\n'
    keys += f"lines = {lines}\n" if lines is not None else ""
    keys += f"nth = {nth}\n" if nth is not None else ""
    return f"[[entry.cut]]\n{keys}{extra}"


def span_toml(kind: str, anchor: str, lines: int | None = None, nth: int | None = None) -> str:
    keys = f"anchor = {json.dumps(anchor)}\n" + (f"lines = {lines}\n" if lines is not None else "") + (f"nth = {nth}\n" if nth is not None else "")
    return f"[[entry.cut.{kind}]]\n{keys}"


GIT_CUT = cut_toml("result = subprocess.run(", lines=4)
USE_RESULT = span_toml("uses", "count = len(result.stdout)")
GUARD_RESULT = span_toml("guards", "if result.returncode != 0:")


def cuts_root(tmp_path: Path, body: str, source: str = CUT_PY, **kw) -> Path:
    root = make_root(tmp_path, touched=cut_entry(body=body, **kw))
    write(root, kw.get("file", "src/p.py"), source)
    return root


def cut_problems(result: R.Result) -> list[tuple[str, str]]:
    return [(p.code, p.subject) for p in result.problems]


def test_cuts_a_cut_with_a_use_and_a_guard_that_all_resolve_is_valid(tmp_path):
    root = cuts_root(tmp_path, GIT_CUT + USE_RESULT + GUARD_RESULT)
    result = R.check_cuts(root)
    assert result.exit_code == R.EXIT_OK and result.problems == []
    assert result.data["kinds"] == {"src/p.py::publish": "cut"}


def test_cuts_a_missing_anchor_is_named_with_its_cut_id(tmp_path):
    root = cuts_root(tmp_path, cut_toml("result = subprocess.popen("))
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.py::publish#1")]


def test_cuts_an_anchor_that_is_in_another_function_is_missing(tmp_path):
    root = cuts_root(tmp_path, cut_toml("count = len(x)"))               # only in `other`
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.py::publish#1")]


def test_cuts_an_anchor_that_occurs_twice_needs_nth_and_nth_picks_one(tmp_path):
    source = "def publish(a):\n    x = 1\n    y = 2\n    x = 1\n    return x\n"
    ambiguous = cuts_root(tmp_path / "a", cut_toml("x = 1"), source)
    assert cut_problems(R.check_cuts(ambiguous)) == [("E-CUT-ANCHOR-AMBIGUOUS", "refactor-cut:src/p.py::publish#1")]
    second = cuts_root(tmp_path / "b", cut_toml("x = 1", nth=2), source)
    assert R.check_cuts(second).exit_code == R.EXIT_OK
    third = cuts_root(tmp_path / "c", cut_toml("x = 1", nth=3), source)
    assert cut_problems(R.check_cuts(third)) == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.py::publish#1")]


def test_cuts_an_anchor_is_compared_after_stripping_the_line(tmp_path):
    assert R.check_cuts(cuts_root(tmp_path, cut_toml("return None"))).exit_code == R.EXIT_OK      # the file line has eight spaces


def test_cuts_a_use_or_a_guard_anchor_that_is_missing_is_named_with_the_cuts_id(tmp_path):
    root = cuts_root(tmp_path, GIT_CUT + span_toml("uses", "nowhere()") + span_toml("guards", "if nothing:"))
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.py::publish#1")] * 2


def test_cuts_a_span_that_runs_past_the_function_is_out_of_it(tmp_path):
    root = cuts_root(tmp_path, cut_toml("count = len(result.stdout)", lines=3))      # lines 9 to 11: 11 is blank, past the def's end
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-OUT-OF-FUNCTION", "refactor-cut:src/p.py::publish#1")]


def test_cuts_a_span_that_runs_past_the_end_of_the_file_is_out_of_the_function(tmp_path):
    root = cuts_root(tmp_path, cut_toml("count = len(x)", lines=9), function="other")
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-OUT-OF-FUNCTION", "refactor-cut:src/p.py::other#1")]


def test_cuts_two_cuts_that_share_a_line_overlap(tmp_path):
    root = cuts_root(tmp_path, GIT_CUT + cut_toml("check=False,"))
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-OVERLAP", "refactor-cut:src/p.py::publish#1")]


def test_cuts_a_use_of_one_cut_may_lie_inside_a_different_cuts_span_a_chain(tmp_path):
    source = "def publish(repo):\n    a = gitty1(repo)\n    b = gitty2(a)\n    return b\n"
    chain = cut_toml("a = gitty1(repo)") + span_toml("uses", "b = gitty2(a)") + cut_toml("b = gitty2(a)") + span_toml("uses", "return b")
    result = R.check_cuts(cuts_root(tmp_path, chain, source))
    assert result.exit_code == R.EXIT_OK and result.problems == []


def test_cuts_a_guard_of_one_cut_may_lie_inside_a_different_cuts_span(tmp_path):
    source = "def publish(repo):\n    a = gitty1(repo)\n    if a:\n        b = gitty2(a)\n    return a\n"
    body = cut_toml("a = gitty1(repo)") + span_toml("guards", "if a:", lines=2) + cut_toml("b = gitty2(a)")
    assert R.check_cuts(cuts_root(tmp_path, body, source)).exit_code == R.EXIT_OK


def test_cuts_a_use_inside_the_cuts_own_span_still_overlaps(tmp_path):
    source = "def publish(repo):\n    a = gitty1(repo)\n    b = gitty2(a)\n    return b\n"
    body = cut_toml("a = gitty1(repo)", lines=2) + span_toml("uses", "b = gitty2(a)")
    assert cut_problems(R.check_cuts(cuts_root(tmp_path, body, source))) == [("E-CUT-OVERLAP", "refactor-cut:src/p.py::publish#1")]


def test_cuts_a_chain_keeps_the_coverage_obligation_as_the_union_of_the_lines(tmp_path):
    source = "def publish(repo):\n    a = gitty1(repo)\n    b = gitty2(a)\n    return b\n"
    chain = cut_toml("a = gitty1(repo)") + span_toml("uses", "b = gitty2(a)") + cut_toml("b = gitty2(a)") + span_toml("uses", "return b")
    result = coverage_result(tmp_path, cut_entry(body=chain), {"src/p.py": source}, python={"src/p.py": lines({1: 1, 2: 1, 3: 1, 4: 1})})
    assert result.exit_code == R.EXIT_OK and result.data["measured"] == {"src/p.py::publish": [3, 3, 0, 0]}
    short = coverage_result(tmp_path / "s", cut_entry(body=chain), {"src/p.py": source}, python={"src/p.py": lines({1: 1, 2: 1, 3: 1, 4: 0})})
    assert short.problems[0].detail == "2 of 3 lines (line 4)"


def test_cuts_a_guard_inside_a_cuts_own_span_overlaps(tmp_path):
    root = cuts_root(tmp_path, GIT_CUT + span_toml("guards", "check=False,"))
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-OVERLAP", "refactor-cut:src/p.py::publish#1")]


def test_cuts_the_same_use_named_by_two_cuts_is_not_an_overlap(tmp_path):
    root = cuts_root(tmp_path, GIT_CUT + USE_RESULT + cut_toml("path = run_path(run)") + USE_RESULT)
    assert R.check_cuts(root).exit_code == R.EXIT_OK


@pytest.mark.parametrize("why", ["", "   "])
def test_cuts_an_empty_why_is_refused(tmp_path, why):
    assert cut_problems(R.check_cuts(cuts_root(tmp_path, cut_toml("return None", why=why)))) == [("E-CUT-NO-WHY", "refactor-cut:src/p.py::publish#1")]


def test_cuts_a_missing_why_is_refused(tmp_path):
    root = cuts_root(tmp_path, '[[entry.cut]]\nanchor = "return None"\n')
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-NO-WHY", "refactor-cut:src/p.py::publish#1")]


def test_cuts_whole_and_a_non_empty_cut_together_are_an_error(tmp_path):
    root = cuts_root(tmp_path, GIT_CUT, head="whole = true\n")
    assert cut_problems(R.check_cuts(root)) == [("E-CUT-WHOLE-AND-CUT", "src/p.py::publish")]


def test_cuts_whole_with_an_empty_cut_list_is_whole(tmp_path):
    root = cuts_root(tmp_path, "", head="whole = true\ncut = []\n")
    result = R.check_cuts(root)
    assert result.exit_code == R.EXIT_OK and result.data["kinds"] == {"src/p.py::publish": "whole"}


def test_cuts_an_entry_with_neither_is_whole_and_only_strict_calls_it_undecided(tmp_path):
    root = cuts_root(tmp_path, "")
    loose = R.check_cuts(root)
    assert loose.exit_code == R.EXIT_OK and loose.data["kinds"] == {"src/p.py::publish": "whole"} and loose.data["undecided"] == ["src/p.py::publish"]
    strict = R.check_cuts(root, strict=True)
    assert strict.exit_code == R.EXIT_FAIL and cut_problems(strict) == [("E-CUT-UNDECIDED", "src/p.py::publish")]


def test_cuts_an_empty_cut_list_without_whole_has_no_obligation_and_is_reported_not_failed(tmp_path):
    root = cuts_root(tmp_path, "", head="cut = []\n")
    for strict in (False, True):
        result = R.check_cuts(root, strict=strict)
        assert result.exit_code == R.EXIT_OK
        assert result.data["kinds"] == {"src/p.py::publish": "none"} and result.data["no_obligation"] == ["src/p.py::publish"]


def test_cuts_a_listed_function_that_is_not_in_the_file_is_stale(tmp_path):
    root = cuts_root(tmp_path, cut_toml("return None"), function="ghost")
    assert cut_problems(R.check_cuts(root)) == [("E-STALE-ENTRY", "src/p.py::ghost")]


RS_CUT = (
    "pub fn pull(repo: &Path) -> bool {\n"                        # 1
    "    let out = Command::new(\"git\")\n"                        # 2
    "        .args([\"fetch\"])\n"                                 # 3
    "        .status();\n"                                         # 4
    "    if out.is_err() {\n"                                      # 5
    "        return false;\n"                                      # 6
    "    }\n"                                                      # 7
    "    true\n"                                                   # 8
    "}\n"                                                          # 9
    "\n"
    "pub fn other() -> bool {\n"                                   # 11
    "    true\n"                                                   # 12
    "}\n"
)


def test_cuts_a_rust_function_runs_from_its_fn_line_to_the_next_one(tmp_path):
    ok = cuts_root(tmp_path / "a", cut_toml("let out = Command::new(\"git\")", lines=3) + span_toml("guards", "if out.is_err() {"),
                   RS_CUT, language="rust", file="src/p.rs", function="pull")
    assert R.check_cuts(ok).exit_code == R.EXIT_OK
    past = cuts_root(tmp_path / "b", cut_toml("pub fn other() -> bool {"), RS_CUT, language="rust", file="src/p.rs", function="pull")
    assert cut_problems(R.check_cuts(past)) == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.rs::pull#1")]


def test_cuts_a_module_head_is_the_lines_outside_every_def(tmp_path):
    source = "import os\nLIMIT = 3\n\n\ndef f():\n    return LIMIT\n"
    root = cuts_root(tmp_path, cut_toml("LIMIT = 3"), source, function="<module>")
    assert R.check_cuts(root).exit_code == R.EXIT_OK
    inside = cuts_root(tmp_path / "x", cut_toml("return LIMIT"), source, function="<module>")
    assert cut_problems(R.check_cuts(inside)) == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.py::<module>#1")]


def test_cuts_a_shell_script_entry_is_the_whole_file(tmp_path):
    source = "#!/usr/bin/env bash\nrun=\"$1\"\ngit add \"runs/$run\"\ngit push origin HEAD:main\n"
    root = cuts_root(tmp_path, cut_toml("git add \"runs/$run\"") + cut_toml("git push origin HEAD:main"), source,
                     language="shell", file="src/p.sh", function="<script>")
    assert R.check_cuts(root).exit_code == R.EXIT_OK


def test_cuts_the_report_is_written_and_the_cli_exit_codes_are_those_of_the_other_commands(tmp_path):
    root = cuts_root(tmp_path, cut_toml("nowhere()"))
    assert cli(root, "check-cuts") == R.EXIT_FAIL
    report = json.loads((root / "ops/refactor/reports/cuts.json").read_text())
    assert report["exit_code"] == R.EXIT_FAIL and report["problems"][0]["code"] == "E-CUT-ANCHOR-MISSING"
    good = cuts_root(tmp_path / "good", cut_toml("return None"))
    assert cli(good, "check-cuts") == R.EXIT_OK
    loose = cuts_root(tmp_path / "loose", "")
    assert cli(loose, "check-cuts") == R.EXIT_OK and cli(loose, "check-cuts", "--strict") == R.EXIT_FAIL


def test_cuts_a_base_revision_that_cannot_be_read_is_undecided_not_a_pass(tmp_path):
    root = cuts_root(tmp_path, cut_toml("return None"))
    assert cli(root, "check-cuts", "--base", "no-such-rev") == R.EXIT_ERROR            # the root is no git repository


# Step 2: check-coverage proves the cut statements, the statements that use their results, and the guards, not the whole function.

CUT_ALL = GIT_CUT + USE_RESULT + GUARD_RESULT                  # lines 3 to 6 (cut), 9 (use), 7 (guard); 2, 8 and 10 are outside the obligation
CUT_HIT = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 1, 10: 1, 14: 0, 15: 0}           # line 8 (`return None`) never runs
CUT_BRANCHES = [(7, "0:4", True), (7, "0:5", True)]


def cut_coverage(tmp_path: Path, body: str, hits: dict, branches=(), source: str = CUT_PY, head: str = "", **kw) -> R.Result:
    return coverage_result(tmp_path, cut_entry(body=body, head=head, **kw), {kw.get("file", "src/p.py"): source},
                           python={"src/p.py": lines(hits, branches)})


def test_cov_a_cut_entry_owes_only_its_cut_use_and_guard_lines(tmp_path):
    result = cut_coverage(tmp_path, CUT_ALL, CUT_HIT, CUT_BRANCHES)
    assert result.exit_code == R.EXIT_OK and result.problems == []                    # line 8 and the rest of the function are not owed
    assert result.data["measured"] == {"src/p.py::publish": [6, 6, 2, 2]}              # 3, 4, 5, 6, 7 and 9
    assert result.data["kinds"] == {"src/p.py::publish": "cut"}


def test_cov_an_unrun_use_line_fails_naming_the_function_and_the_line(tmp_path):
    result = cut_coverage(tmp_path, CUT_ALL, CUT_HIT | {9: 0}, CUT_BRANCHES)
    assert [(p.code, p.subject, p.detail) for p in result.problems] == [("E-BELOW", "src/p.py::publish", "5 of 6 lines (line 9)")]


def test_cov_an_unrun_line_of_the_cut_itself_fails(tmp_path):
    result = cut_coverage(tmp_path, CUT_ALL, CUT_HIT | {4: 0}, CUT_BRANCHES)
    assert [(p.code, p.detail) for p in result.problems] == [("E-BELOW", "5 of 6 lines (line 4)")]


def test_cov_a_guard_must_be_covered_both_ways(tmp_path):
    result = cut_coverage(tmp_path, CUT_ALL, CUT_HIT, [(7, "0:4", True), (7, "0:5", False)])
    assert [(p.code, p.detail) for p in result.problems] == [("E-BELOW", "1 of 2 branches (7->5)")]


def test_cov_a_branch_on_a_line_outside_the_obligation_is_not_counted(tmp_path):
    result = cut_coverage(tmp_path, CUT_ALL, CUT_HIT, CUT_BRANCHES + [(8, "0:9", False)])
    assert result.exit_code == R.EXIT_OK


def test_cov_an_unrun_line_outside_the_obligation_does_not_matter_even_when_a_whole_entry_would_fail_on_it(tmp_path):
    whole = cut_coverage(tmp_path / "w", "", CUT_HIT, CUT_BRANCHES, head="whole = true\n")
    assert [(p.code, p.detail) for p in whole.problems] == [("E-BELOW", "9 of 10 lines (line 8)")]      # the old behaviour, unchanged
    assert whole.data["kinds"] == {"src/p.py::publish": "whole"} and whole.data["measured"] == {"src/p.py::publish": [10, 9, 2, 2]}
    assert cut_coverage(tmp_path / "c", CUT_ALL, CUT_HIT, CUT_BRANCHES).exit_code == R.EXIT_OK


def test_cov_an_entry_with_neither_key_is_measured_as_a_whole_function(tmp_path):
    result = cut_coverage(tmp_path, "", CUT_HIT, CUT_BRANCHES)
    assert [(p.code, p.detail) for p in result.problems] == [("E-BELOW", "9 of 10 lines (line 8)")]
    assert result.data["kinds"] == {"src/p.py::publish": "whole"}


def test_cov_a_cut_entry_whose_obligation_has_no_measured_line_is_unmeasured(tmp_path):
    result = cut_coverage(tmp_path, CUT_ALL, {1: 1, 2: 1, 8: 0})
    assert [(p.code, p.subject) for p in result.problems] == [("E-FILE-UNMEASURED", "src/p.py::publish")]


def test_cov_an_empty_cut_list_is_no_obligation_and_its_language_is_not_even_run(tmp_path):
    result = coverage_result(tmp_path, cut_entry(head="cut = []\n"), {"src/p.py": CUT_PY})            # no python key: a call would KeyError
    assert result.exit_code == R.EXIT_OK and result.problems == []
    assert result.data["kinds"] == {"src/p.py::publish": "none"} and result.data["no_obligation"] == ["src/p.py::publish"]
    assert result.data["measured"] == {}


def test_cov_a_cut_that_does_not_resolve_is_reported_with_its_check_cuts_code_and_not_measured(tmp_path):
    result = cut_coverage(tmp_path, cut_toml("nowhere()"), CUT_HIT)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-ANCHOR-MISSING", "refactor-cut:src/p.py::publish#1")]
    assert result.data["measured"] == {}


def test_cov_whole_and_cut_together_are_refused(tmp_path):
    result = cut_coverage(tmp_path, GIT_CUT, CUT_HIT, head="whole = true\n")
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-WHOLE-AND-CUT", "src/p.py::publish")]


def test_cov_the_reviewed_blind_table_applies_to_the_obligation_lines_of_a_cut_entry(tmp_path):
    root = make_root(tmp_path, touched=cut_entry(body=CUT_ALL))
    write(root, "src/p.py", CUT_PY)
    write(root, "ops/refactor/runners.toml", '[python.coverage]\ncommand = []\n[[python.coverage.blind]]\nfile = "src/p.py"\nlines = [9]\nreason = "runs in a thread"\n')
    result = R.check_coverage(root, canned(python={"src/p.py": lines(CUT_HIT | {9: 0}, CUT_BRANCHES)}))
    assert result.exit_code == R.EXIT_OK
    assert result.data["excused"] == {"src/p.py::publish": {"lines": [9], "reason": "runs in a thread"}}


def test_cov_a_module_head_cut_of_constants_is_reported_not_failed(tmp_path):
    source = "LIMIT = 3\n\n\ndef f():\n    return LIMIT\n"
    result = coverage_result(tmp_path, cut_entry(function="<module>", body=cut_toml("LIMIT = 3")), {"src/p.py": source},
                             python={"src/p.py": lines({5: 1})})
    assert result.exit_code == R.EXIT_OK and result.data["constants_only"] == ["src/p.py::<module>"]


def test_cov_a_rust_cut_entry_owes_its_lines_and_the_branches_on_them(tmp_path):
    body = cut_toml("let out = Command::new(\"git\")", lines=3) + span_toml("guards", "if out.is_err() {")
    hits = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 0, 8: 1, 12: 0}
    good = coverage_result(tmp_path / "a", cut_entry("pull", body, "rust", "src/p.rs"), {"src/p.rs": RS_CUT},
                           rust={"src/p.rs": lines(hits, [(5, "0:0", True), (5, "0:1", True)])})
    assert good.exit_code == R.EXIT_OK and good.data["measured"] == {"src/p.rs::pull": [4, 4, 2, 2]}
    bad = coverage_result(tmp_path / "b", cut_entry("pull", body, "rust", "src/p.rs"), {"src/p.rs": RS_CUT},
                          rust={"src/p.rs": lines(hits, [(5, "0:0", True), (5, "0:1", False)])})
    assert [(p.code, p.detail) for p in bad.problems] == [("E-BELOW", "1 of 2 branches (5->1)")]


# Step 3: check-stubs compares a cut entry with the BASE version of the function, each cut span replaced by one stand-in;
# apply-cuts --dry-run prints that form.

PY_ID1 = "refactor-cut:src/p.py::publish#1"
PY_DELETED = CUT_PY.replace(
    "    result = subprocess.run(\n        [\"git\", \"add\", path],\n        check=False,\n    )\n",
    f"    raise NotImplementedError(\"{PY_ID1}\")\n")
GUARDED = GIT_CUT + USE_RESULT + GUARD_RESULT


def stubs_of(tmp_path: Path, body: str, base_source: str, current: str, head: str = "", **kw) -> R.Result:
    root = cuts_root(tmp_path, body, current, head=head, **kw)
    return R.check_stubs(root, base=lambda file: base_source if file == kw.get("file", "src/p.py") else None)


def stub_problems(result: R.Result) -> list[tuple[str, str]]:
    return [(p.code, p.subject) for p in result.problems]


def test_stubs_a_cut_replaced_by_exactly_one_stand_in_passes_when_everything_else_is_the_base(tmp_path):
    result = stubs_of(tmp_path, GUARDED, CUT_PY, PY_DELETED)
    assert result.exit_code == R.EXIT_OK and result.problems == []


def test_stubs_blank_lines_and_comments_are_ignored_on_both_sides(tmp_path):
    current = PY_DELETED.replace("    path = run_path(run)\n", "\n    # kept for the new design\n    path = run_path(run)\n\n")
    assert R.check_stubs(cuts_root(tmp_path, GUARDED, current), base=lambda f: CUT_PY.replace("    count =", "    # the count\n    count =")).exit_code == R.EXIT_OK


def test_stubs_a_cut_still_in_place_is_not_replaced(tmp_path):
    assert stub_problems(stubs_of(tmp_path, GUARDED, CUT_PY, CUT_PY)) == [("E-CUT-NOT-REPLACED", PY_ID1)]


def test_stubs_a_stand_in_added_beside_the_cuts_own_statements_is_not_a_replacement(tmp_path):
    base = "def f(x):\n    a = load(x)\n    b = a + 1\n    use(b)\n"
    current = "def f(x):\n    raise NotImplementedError(\"refactor-cut:src/p.py::f#1\")\n    a = load(x)\n    use(b)\n"
    assert stub_problems(stubs_of(tmp_path, cut_toml("a = load(x)", lines=2), base, current, function="f")) == [("E-CUT-NOT-REPLACED", "refactor-cut:src/p.py::f#1")]


@pytest.mark.parametrize("stand_in", [
    "    pass\n",                                                                    # not a stand-in at all
    "    raise NotImplementedError(\"deleted\")\n",                                   # a stand-in without the cut's id
    "    raise NotImplementedError(\"refactor-cut:src/p.py::publish#2\")\n",          # another cut's id
    f"    raise ValueError(\"{PY_ID1}\")\n",                                           # wrong exception
    "",                                                                              # no stand-in: the cut was just removed
])
def test_stubs_a_replacement_that_is_not_the_cuts_stand_in_is_wrong(tmp_path, stand_in):
    current = CUT_PY.replace("    result = subprocess.run(\n        [\"git\", \"add\", path],\n        check=False,\n    )\n", stand_in)
    assert stub_problems(stubs_of(tmp_path, GUARDED, CUT_PY, current)) == [("E-CUT-STAND-IN-WRONG", PY_ID1)]


def test_stubs_two_stand_ins_for_one_cut_are_wrong(tmp_path):
    current = PY_DELETED.replace(f"    raise NotImplementedError(\"{PY_ID1}\")\n", f"    raise NotImplementedError(\"{PY_ID1}\")\n    raise NotImplementedError(\"{PY_ID1}\")\n")
    assert stub_problems(stubs_of(tmp_path, GUARDED, CUT_PY, current)) == [("E-CUT-STAND-IN-WRONG", PY_ID1)]


@pytest.mark.parametrize("old,new", [
    ("    count = len(result.stdout)\n", "    count = 0\n"),                         # a use changed
    ("    if result.returncode != 0:\n", "    if result.returncode:\n"),             # a guard changed
    ("        return None\n", ""),                                                  # a statement removed
    ("    return count\n", "    log(count)\n    return count\n"),                    # a statement added
    ("    path = run_path(run)\n", "    path = run_path(repo)\n"),                  # a statement outside every span
])
def test_stubs_a_difference_from_the_base_outside_the_cut_spans_is_collateral(tmp_path, old, new):
    current = PY_DELETED.replace(old, new)
    assert current != PY_DELETED
    result = stubs_of(tmp_path, GUARDED, CUT_PY, current)
    assert stub_problems(result) == [("E-CUT-COLLATERAL", "src/p.py::publish")]


def test_stubs_a_change_in_another_function_of_the_file_is_not_this_functions_business(tmp_path):
    assert stubs_of(tmp_path, GUARDED, CUT_PY, PY_DELETED.replace("    count = len(x)\n", "    count = 7\n")).exit_code == R.EXIT_OK


PY_TWO = ("def publish(repo, run):\n    a = fetch(repo)\n    b = push(repo)\n    keep(a, b)\n    return a\n")
TWO_CUTS = cut_toml("a = fetch(repo)") + cut_toml("b = push(repo)")


def two_cut_text(first: str, second: str) -> str:
    return f"def publish(repo, run):\n    {first}\n    {second}\n    keep(a, b)\n    return a\n"


def test_stubs_two_adjacent_cuts_have_a_stand_in_each_in_order(tmp_path):
    one = "raise NotImplementedError(\"refactor-cut:src/p.py::publish#1\")"
    two = "raise NotImplementedError(\"refactor-cut:src/p.py::publish#2\")"
    assert stubs_of(tmp_path / "ok", TWO_CUTS, PY_TWO, two_cut_text(one, two)).exit_code == R.EXIT_OK
    swapped = stubs_of(tmp_path / "swapped", TWO_CUTS, PY_TWO, two_cut_text(two, one))
    assert stub_problems(swapped) == [("E-CUT-STAND-IN-WRONG", "refactor-cut:src/p.py::publish#1"), ("E-CUT-STAND-IN-WRONG", "refactor-cut:src/p.py::publish#2")]
    first_only = stubs_of(tmp_path / "half", TWO_CUTS, PY_TWO, two_cut_text(one, "b = push(repo)"))
    assert stub_problems(first_only) == [("E-CUT-NOT-REPLACED", "refactor-cut:src/p.py::publish#2")]


def test_stubs_a_cut_at_the_end_of_a_function_and_one_at_the_start(tmp_path):
    base = "def f(x):\n    a = load(x)\n    use(a)\n    save(a)\n"
    body = cut_toml("a = load(x)") + cut_toml("save(a)")
    current = ("def f(x):\n    raise NotImplementedError(\"refactor-cut:src/p.py::f#1\")\n    use(a)\n"
               "    raise NotImplementedError(\"refactor-cut:src/p.py::f#2\")\n")
    assert stubs_of(tmp_path, body, base, current, function="f").exit_code == R.EXIT_OK


def test_stubs_the_anchors_are_read_from_the_base_so_a_deleted_tree_still_resolves(tmp_path):
    result = stubs_of(tmp_path, cut_toml("result = subprocess.popen("), CUT_PY, PY_DELETED)
    assert stub_problems(result) == [("E-CUT-ANCHOR-MISSING", PY_ID1)]


def test_stubs_a_function_gone_from_the_file_or_from_the_base_is_stale(tmp_path):
    assert stub_problems(stubs_of(tmp_path / "a", GUARDED, CUT_PY, "def other():\n    return 1\n")) == [("E-STALE-ENTRY", "src/p.py::publish")]
    assert stub_problems(stubs_of(tmp_path / "b", GUARDED, "def other():\n    return 1\n", PY_DELETED)) == [("E-STALE-ENTRY", "src/p.py::publish")]


def test_stubs_a_file_missing_from_the_base_is_stale(tmp_path):
    root = cuts_root(tmp_path, GUARDED, PY_DELETED)
    assert stub_problems(R.check_stubs(root, base=lambda file: None)) == [("E-STALE-ENTRY", "src/p.py::publish")]


def test_stubs_whole_entries_keep_the_old_rule_beside_cut_entries(tmp_path):
    touched = (cut_entry(body=GUARDED) + entry("python", "src/w.py", "gone", '"B"', "whole = true\n"))
    root = make_root(tmp_path, touched=touched)
    write(root, "src/p.py", PY_DELETED)
    write(root, "src/w.py", "def gone():\n    raise NotImplementedError(\"deleted\")\n")
    assert R.check_stubs(root, base=lambda f: CUT_PY).exit_code == R.EXIT_OK
    write(root, "src/w.py", "def gone():\n    return 1\n")
    assert stub_problems(R.check_stubs(root, base=lambda f: CUT_PY)) == [("E-NOT-STUB", "src/w.py::gone")]


def test_stubs_an_entry_that_says_neither_is_still_a_whole_stub_check(tmp_path):
    root = make_root(tmp_path, touched=cut_entry(body=""))
    write(root, "src/p.py", "def publish(repo, run):\n    raise NotImplementedError()\n")
    assert R.check_stubs(root).exit_code == R.EXIT_OK


def test_stubs_an_entry_with_an_empty_cut_list_owes_no_stand_in(tmp_path):
    root = make_root(tmp_path, touched=cut_entry(head="cut = []\n"))
    write(root, "src/p.py", CUT_PY)
    assert R.check_stubs(root, base=lambda f: CUT_PY).exit_code == R.EXIT_OK


def test_stubs_whole_and_cut_together_are_refused(tmp_path):
    result = stubs_of(tmp_path, GIT_CUT, CUT_PY, PY_DELETED, head="whole = true\n")
    assert stub_problems(result) == [("E-CUT-WHOLE-AND-CUT", "src/p.py::publish")]


def test_stubs_a_current_file_that_does_not_parse_is_collateral_not_a_traceback(tmp_path):
    result = stubs_of(tmp_path, GUARDED, CUT_PY, PY_DELETED + "def broken(:\n")
    assert stub_problems(result) == [("E-CUT-COLLATERAL", "src/p.py::publish")]


RS_ID = "refactor-cut:src/p.rs::pull#1"
RS_BODY = cut_toml("let out = Command::new(\"git\")", lines=3) + span_toml("guards", "if out.is_err() {")


def rs_deleted(stand_in: str) -> str:
    return RS_CUT.replace("    let out = Command::new(\"git\")\n        .args([\"fetch\"])\n        .status();\n", f"    {stand_in}\n")


@pytest.mark.parametrize("stand_in", [f'unimplemented!("{RS_ID}");', f'todo!("{RS_ID}");', f'todo!("{RS_ID}")'])
def test_stubs_rust_stand_ins_carry_the_id(tmp_path, stand_in):
    assert stubs_of(tmp_path, RS_BODY, RS_CUT, rs_deleted(stand_in), language="rust", file="src/p.rs", function="pull").exit_code == R.EXIT_OK


@pytest.mark.parametrize("stand_in", ["todo!();", 'unimplemented!("deleted");', f'panic!("{RS_ID}");', f'    unimplemented!("{RS_ID}");'])      # the last: wrong indentation
def test_stubs_a_rust_stand_in_without_the_id_or_of_another_form_is_wrong(tmp_path, stand_in):
    result = stubs_of(tmp_path, RS_BODY, RS_CUT, rs_deleted(stand_in), language="rust", file="src/p.rs", function="pull")
    assert stub_problems(result) == [("E-CUT-STAND-IN-WRONG", RS_ID)]


TS_CUT = ('export function load(rev: string): string {\n'                     # 1
          '  const out = spawn("git", ["show", rev])\n'                        # 2
          '  if (out.status !== 0) {\n'                                         # 3
          '    return ""\n'                                                     # 4
          '  }\n'                                                               # 5
          '  return out.stdout.trim()\n'                                        # 6
          '}\n')
TS_ID = "refactor-cut:src/p.ts::load#1"
TS_BODY = cut_toml('const out = spawn("git", ["show", rev])') + span_toml("guards", "if (out.status !== 0) {") + span_toml("uses", "return out.stdout.trim()")


def ts_deleted(stand_in: str) -> str:
    return TS_CUT.replace('  const out = spawn("git", ["show", rev])\n', f"  {stand_in}\n")


def test_stubs_typescript_stand_in_carries_the_id(tmp_path):
    ok = stubs_of(tmp_path / "a", TS_BODY, TS_CUT, ts_deleted(f'throw new Error("not implemented: {TS_ID}");'), language="typescript", file="src/p.ts", function="load")
    assert ok.exit_code == R.EXIT_OK
    bad = stubs_of(tmp_path / "b", TS_BODY, TS_CUT, ts_deleted('throw new Error("deleted");'), language="typescript", file="src/p.ts", function="load")
    assert stub_problems(bad) == [("E-CUT-STAND-IN-WRONG", TS_ID)]
    missing = stubs_of(tmp_path / "c", TS_BODY, TS_CUT, TS_CUT, language="typescript", file="src/p.ts", function="load")
    assert stub_problems(missing) == [("E-CUT-NOT-REPLACED", TS_ID)]


SH_FN = 'sync() {\n  local run="$1"\n  git add "runs/$run"\n  git commit -m "run $run"\n  echo "done $run"\n}\n'
SH_BODY = cut_toml('git add "runs/$run"') + cut_toml('git commit -m "run $run"')


def test_stubs_a_shell_function_cut_is_replaced_by_return_99_each(tmp_path):
    ok = SH_FN.replace('  git add "runs/$run"\n  git commit -m "run $run"\n', "  return 99\n  return 99\n")
    assert stubs_of(tmp_path / "a", SH_BODY, SH_FN, ok, language="shell", file="src/p.sh", function="sync").exit_code == R.EXIT_OK
    wrong = SH_FN.replace('  git add "runs/$run"\n  git commit -m "run $run"\n', "  return 98\n  return 99\n")
    result = stubs_of(tmp_path / "b", SH_BODY, SH_FN, wrong, language="shell", file="src/p.sh", function="sync")
    assert stub_problems(result) == [("E-CUT-STAND-IN-WRONG", "refactor-cut:src/p.sh::sync#1")]


SH_SCRIPT = '#!/usr/bin/env bash\nrun="$1"\ngit add "runs/$run"\necho done\n'


def test_stubs_a_cut_at_script_level_is_exit_99(tmp_path):
    body = cut_toml('git add "runs/$run"')
    kw = dict(language="shell", file="src/p.sh", function="<script>")
    ok = stubs_of(tmp_path / "a", body, SH_SCRIPT, SH_SCRIPT.replace('git add "runs/$run"', "exit 99"), **kw)
    assert ok.exit_code == R.EXIT_OK
    wrong = stubs_of(tmp_path / "b", body, SH_SCRIPT, SH_SCRIPT.replace('git add "runs/$run"', "return 99"), **kw)
    assert stub_problems(wrong) == [("E-CUT-STAND-IN-WRONG", "refactor-cut:src/p.sh::<script>#1")]


def test_stubs_a_base_that_cannot_be_read_is_undecided(tmp_path):
    root = cuts_root(tmp_path, GUARDED, PY_DELETED)           # no git repository here
    result = R.check_stubs(root)
    assert result.exit_code == R.EXIT_ERROR and [p.code for p in result.problems] == ["E-BASE-UNREADABLE"]


GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
           "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git_in(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, env={**os.environ, **GIT_ENV})


def test_stubs_the_base_is_head_by_default_and_the_deletion_is_uncommitted_in_the_working_tree(tmp_path):
    root = cuts_root(tmp_path, GUARDED, CUT_PY)
    git_in(root, "init", "-q")
    git_in(root, "add", "src/p.py", "ops/refactor/touched_set.toml")
    git_in(root, "commit", "-q", "-m", "base")
    assert stub_problems(R.check_stubs(root)) == [("E-CUT-NOT-REPLACED", PY_ID1)]                 # nothing deleted yet
    (root / "src/p.py").write_text(PY_DELETED)
    assert R.check_stubs(root).exit_code == R.EXIT_OK
    assert cli(root, "check-stubs") == R.EXIT_OK and cli(root, "check-stubs", "--base", "HEAD") == R.EXIT_OK
    assert cli(root, "check-stubs", "--base", "no-such-rev") == R.EXIT_ERROR


def apply_text(result: R.Result) -> dict[str, str]:
    return result.data["entries"]


def test_apply_cuts_prints_the_function_with_a_stand_in_for_each_cut(tmp_path):
    root = cuts_root(tmp_path, GUARDED, CUT_PY)
    result = R.apply_cuts(root, base=lambda f: CUT_PY)
    assert result.exit_code == R.EXIT_OK
    expected = PY_DELETED.split("\n\n\n")[0] + "\n"
    assert apply_text(result) == {"src/p.py::publish": expected}


def test_apply_cuts_output_is_what_check_stubs_accepts_in_every_language(tmp_path):
    cases = [("python", "src/p.py", "publish", GUARDED, CUT_PY), ("rust", "src/p.rs", "pull", RS_BODY, RS_CUT),
             ("typescript", "src/p.ts", "load", TS_BODY, TS_CUT), ("shell", "src/p.sh", "sync", SH_BODY, SH_FN)]
    for i, (language, file, function, body, source) in enumerate(cases):
        root = cuts_root(tmp_path / str(i), body, source, language=language, file=file, function=function)
        text = apply_text(R.apply_cuts(root, base=lambda f: source))[f"{file}::{function}"]
        # the function's own lines in the file are replaced by the printed text; the rest of the file is untouched
        in_function = sorted(R.lines_in_text(language, source, function))
        lines_ = source.splitlines()
        deleted = lines_[: in_function[0] - 1] + text.splitlines() + lines_[in_function[-1]:]
        (root / file).write_text("\n".join(deleted) + "\n")
        assert R.check_stubs(root, base=lambda f: source).exit_code == R.EXIT_OK, (language, text)


def test_apply_cuts_skips_whole_and_empty_entries_and_reports_a_bad_cut(tmp_path):
    root = make_root(tmp_path, touched=cut_entry(body=GUARDED) + entry("python", "src/w.py", "gone", '"B"', "whole = true\n")
                     + entry("python", "src/n.py", "none", '"B"', "cut = []\n"))
    write(root, "src/p.py", CUT_PY)
    assert list(apply_text(R.apply_cuts(root, base=lambda f: CUT_PY))) == ["src/p.py::publish"]
    bad = cuts_root(tmp_path / "bad", cut_toml("nowhere()"))
    assert [p.code for p in R.apply_cuts(bad, base=lambda f: CUT_PY).problems] == ["E-CUT-ANCHOR-MISSING"]


def test_apply_cuts_without_dry_run_is_refused_and_with_it_prints_and_writes_nothing(tmp_path, capsys):
    root = cuts_root(tmp_path, GUARDED, CUT_PY)
    git_in(root, "init", "-q")
    git_in(root, "add", "src/p.py", "ops/refactor/touched_set.toml")
    git_in(root, "commit", "-q", "-m", "base")
    before = (root / "src/p.py").read_bytes()
    assert cli(root, "apply-cuts") == R.EXIT_ERROR
    assert cli(root, "apply-cuts", "--dry-run") == R.EXIT_OK
    out = capsys.readouterr().out
    assert f'raise NotImplementedError("{PY_ID1}")' in out and "src/p.py::publish" in out
    assert (root / "src/p.py").read_bytes() == before


# Step 4: report-deletion with cuts. A cut is proved by a failing test whose failure text cites the cut's id.

def test_del_the_result_readers_keep_the_failure_text_of_each_failing_test():
    texts: dict[str, str] = {}
    R.parse_junit("py", JUNIT, texts)
    assert texts == {"python:py/test_core.py::test_a": "NotImplementedError: deleted", "python:py/test_core.py::test_c": "assert 1 == 2"}
    cargo: dict[str, str] = {}
    R.parse_cargo_json(CARGO_JSON, cargo)
    assert cargo == {"tests::a": "thread 'tests::a' panicked at src/lib.rs:4:5:\nnot yet implemented\n", "tests::c": "assertion failed: x"}
    vitest: dict[str, str] = {}
    R.parse_vitest_json(Path("/r"), VITEST_JSON, vitest)
    assert vitest == {"typescript:ts/src/core.test.ts::a run > shows it": "Error: not implemented", "typescript:ts/src/core.test.ts::other": "expected 1 to be 2"}
    shell: dict[str, str] = {}
    codes_: dict[str, int] = {}
    R.parse_shell_results(SHELL_JSON, shell, codes_)
    assert codes_ == {"shell:tests/one-test.sh": 1, "shell:tests/two-test.sh": 0, "shell:tests/three-test.sh": 1}
    assert shell["shell:tests/one-test.sh"].endswith("actual:   exit 99") and "shell:tests/two-test.sh" not in shell


def test_del_a_failure_cites_only_what_the_exception_said_not_the_source_listing_in_its_trace():
    junit = ("<testsuites><testsuite><testcase classname=\"test_core\" name=\"test_a\" file=\"test_core.py\">"
             "<failure message=\"NotImplementedError: refactor-cut:src/p.py::f#1\">    def f():\n"
             "        raise NotImplementedError(&quot;refactor-cut:src/p.py::f#1&quot;)\n"
             "        raise NotImplementedError(&quot;refactor-cut:src/p.py::f#2&quot;)</failure></testcase></testsuite></testsuites>")
    texts: dict[str, str] = {}
    outcomes, _ = R.parse_junit("py", junit, texts)
    assert R.cuts_cited(R.Results(outcomes=outcomes, texts=texts)) == {"refactor-cut:src/p.py::f#1": {"python:py/test_core.py::test_a"}}
    vitest = json.dumps({"testResults": [{"name": "/r/ts/a.test.ts", "assertionResults": [
        {"ancestorTitles": [], "title": "t", "status": "failed",
         "failureMessages": ["Error: not implemented: refactor-cut:ts/a.ts::g#1\n    at g (a.ts:3)\n  throw new Error(\"not implemented: refactor-cut:ts/a.ts::g#2\")"]}]}]})
    found: dict[str, str] = {}
    outcomes = R.parse_vitest_json(Path("/r"), vitest, found)
    assert set(R.cuts_cited(R.Results(outcomes=outcomes, texts=found))) == {"refactor-cut:ts/a.ts::g#1"}


def test_del_the_readers_work_as_before_without_a_text_collector():
    assert R.parse_junit("py", JUNIT)[0]["python:py/test_core.py::test_a"] == R.FAILED_STUB
    assert R.parse_cargo_json(CARGO_JSON)["tests::a"] == R.FAILED_STUB


def test_del_read_results_fills_the_texts_the_report_cites(tmp_path):
    root = make_root(tmp_path)
    write(root, "ops/refactor/runners.toml", '[python]\ndir = "py"\n[python.results]\nformat = "junit"\ncommand = []\n'
                                             '[rust]\ndir = "rs"\n[rust.results]\nformat = "cargo-json"\ncommand = []\n'
                                             '[shell]\nglob = "tests/*-test.sh"\n[shell.results]\nformat = "shell-exit"\n')
    write(root, "ops/refactor/reports/results-python.xml", JUNIT)
    write(root, "ops/refactor/reports/results-rust.jsonl", CARGO_JSON)
    write(root, "ops/refactor/reports/results-shell.json", SHELL_JSON)
    found = R.read_results(root)
    assert found.texts["python:py/test_core.py::test_a"] == "NotImplementedError: deleted"
    assert "not yet implemented" in found.rust_texts["tests::a"]
    assert found.exit_codes["shell:tests/one-test.sh"] == 1


CUT_TEST = "python:py/t.py::test_publish"
CUT_TEST_2 = "python:py/t.py::test_publish_fails"
CUT_OUTSIDE = "python:py/u.py::test_other"
TWO_PY_DELETED = two_cut_text('raise NotImplementedError("refactor-cut:src/p.py::publish#1")', 'raise NotImplementedError("refactor-cut:src/p.py::publish#2")')


def cut_deletion_root(tmp_path: Path, stage: str = "Deleted", body: str = GUARDED, current: str = PY_DELETED, tests=(CUT_TEST, CUT_TEST_2)) -> Path:
    root = cuts_root(tmp_path, body, current)
    write(root, "ops/refactor/assignments.toml", "[assignments]\nU1 = [%s]\n" % ", ".join(f'"{t}"' for t in tests))
    write_stage(root, stage)
    return root


def cited(n: int = 1, file: str = "src/p.py", function: str = "publish") -> str:
    return f'NotImplementedError: refactor-cut:{file}::{function}#{n}'


def cut_results(outcomes: dict[str, str], texts: dict[str, str] | None = None, **kw) -> R.Results:
    return R.Results(outcomes=dict(outcomes), texts=dict(texts or {}), **kw)


BASE_PY = lambda f: CUT_PY      # noqa: E731


def test_del_a_cut_cited_by_a_failing_test_is_proved_and_an_assigned_test_that_passes_is_no_error(tmp_path):
    root = cut_deletion_root(tmp_path)
    outcomes = {CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.PASSED, CUT_OUTSIDE: R.PASSED}
    result = R.report_deletion(root, cut_results(outcomes, {CUT_TEST: cited()}), BASE_PY)
    assert result.exit_code == R.EXIT_OK and result.problems == []
    assert result.data["assigned_failed"] == [CUT_TEST]
    assert result.data["cuts_cited"] == {PY_ID1: [CUT_TEST]}
    assert stage_of(root) == "Deleted"                                  # a passing assigned test does not send the stage back when cuts exist


def test_del_a_cut_that_no_failing_test_cites_is_a_coverage_gap(tmp_path):
    root = cut_deletion_root(tmp_path)
    outcomes = {CUT_TEST: R.PASSED, CUT_TEST_2: R.PASSED}
    result = R.report_deletion(root, cut_results(outcomes), BASE_PY)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", PY_ID1)]
    assert result.exit_code == R.EXIT_FAIL


def test_del_a_failure_that_names_another_cut_does_not_prove_this_one(tmp_path):
    root = cut_deletion_root(tmp_path, body=TWO_CUTS, current=TWO_PY_DELETED)
    base = lambda f: PY_TWO      # noqa: E731
    outcomes = {CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.PASSED}
    result = R.report_deletion(root, cut_results(outcomes, {CUT_TEST: cited(2)}), base)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", "refactor-cut:src/p.py::publish#1")]
    both = R.report_deletion(root, cut_results(outcomes, {CUT_TEST: cited(2) + " " + cited(1)}), base)
    assert both.exit_code == R.EXIT_OK


def test_del_a_cut_id_that_is_a_prefix_of_another_is_not_cited_by_it(tmp_path):
    root = cut_deletion_root(tmp_path)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.PASSED}, {CUT_TEST: cited(10)}), BASE_PY)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", PY_ID1)]


def test_del_a_passing_test_never_cites(tmp_path):
    root = cut_deletion_root(tmp_path)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.PASSED, CUT_TEST_2: R.PASSED}, {CUT_TEST: cited()}), BASE_PY)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", PY_ID1)]


def test_del_a_failure_for_another_reason_and_an_outside_failure_keep_their_meaning_with_cuts(tmp_path):
    root = cut_deletion_root(tmp_path)
    outcomes = {CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.FAILED_OTHER, CUT_OUTSIDE: R.FAILED_STUB}
    result = R.report_deletion(root, cut_results(outcomes, {CUT_TEST: cited()}), BASE_PY)
    assert [(p.code, p.subject) for p in result.problems] == [("E-STUB-FAILS-TO-IMPORT", CUT_TEST_2), ("E-OUTSIDE-FAILED", CUT_OUTSIDE)]


def test_del_an_assigned_test_with_no_result_is_still_missing(tmp_path):
    root = cut_deletion_root(tmp_path)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB}, {CUT_TEST: cited()}), BASE_PY)
    assert [(p.code, p.subject) for p in result.problems] == [("E-RESULTS-MISSING", CUT_TEST_2)]


def test_del_without_any_cut_entry_a_passing_assigned_test_is_still_an_error_and_the_data_is_as_before(tmp_path):
    root = deletion_root(tmp_path)
    passes = R.report_deletion(root, results(ALL_FAILED | {SIX_TESTS[2]: R.PASSED}))
    assert [p.code for p in passes.problems] == ["E-ASSIGNED-PASSED"]
    assert R.report_deletion(deletion_root(tmp_path / "b"), results(ALL_FAILED)).data == {"assigned_failed": sorted(SIX_TESTS)}


def test_del_one_cut_entry_among_whole_entries_switches_the_assigned_rule_for_the_set(tmp_path):
    touched = cut_entry(body=GUARDED) + entry("python", "src/w.py", "gone", '"B"', "whole = true\n")
    root = make_root(tmp_path, touched=touched)
    write(root, "src/p.py", PY_DELETED)
    write(root, "src/w.py", "def gone():\n    raise NotImplementedError(\"deleted\")\n")
    write(root, "ops/refactor/assignments.toml", "[assignments]\nU1 = [\"%s\", \"%s\"]\n" % (CUT_TEST, CUT_TEST_2))
    write_stage(root, "Deleted")
    result = R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.PASSED}, {CUT_TEST: cited()}), BASE_PY)
    assert result.exit_code == R.EXIT_OK


def test_del_a_cut_left_in_place_stops_the_report_before_any_result_is_read(tmp_path):
    root = cut_deletion_root(tmp_path, current=CUT_PY)
    result = R.report_deletion(root, cut_results({}), BASE_PY)
    assert [p.code for p in result.problems] == ["E-CUT-NOT-REPLACED"]


def test_del_an_empty_cut_list_entry_has_no_obligation_in_the_report(tmp_path):
    root = make_root(tmp_path, touched=cut_entry(head="cut = []\n") + entry("python", "src/w.py", "gone", '"B"', "whole = true\n"))
    write(root, "src/p.py", CUT_PY)
    write(root, "src/w.py", "def gone():\n    raise NotImplementedError(\"deleted\")\n")
    write(root, "ops/refactor/assignments.toml", "[assignments]\nU1 = [\"%s\"]\n" % CUT_TEST)
    write_stage(root, "Deleted")
    assert R.report_deletion(root, results({CUT_TEST: R.FAILED_STUB}), BASE_PY).exit_code == R.EXIT_OK      # no cut entry: the old rules


def test_del_a_language_with_no_result_file_is_missing_not_a_cut_without_a_test(tmp_path):
    root = cut_deletion_root(tmp_path)
    result = R.report_deletion(root, R.Results(outcomes={}, missing={"python"}), BASE_PY)
    assert {p.code for p in result.problems} == {"E-RESULTS-MISSING"}


def test_del_a_rust_cut_is_cited_through_the_name_keyed_texts(tmp_path):
    body = RS_BODY
    root = make_root(tmp_path, touched=cut_entry("pull", body, "rust", "src/p.rs"))
    write(root, "src/p.rs", rs_deleted(f'unimplemented!("{RS_ID}");'))
    write(root, "ops/refactor/assignments.toml", '[assignments]\nU2 = ["rust:rs/mini/src/lib.rs::tests::a"]\n')
    write_stage(root, "Deleted")
    base = lambda f: RS_CUT      # noqa: E731
    text = f"thread 'tests::a' panicked:\nnot implemented: {RS_ID}\n"
    ok = R.report_deletion(root, R.Results(rust_names={"tests::a": R.FAILED_STUB}, rust_texts={"tests::a": text}), base)
    assert ok.exit_code == R.EXIT_OK and ok.data["cuts_cited"] == {RS_ID: ["rust:tests::a"]}
    none = R.report_deletion(root, R.Results(rust_names={"tests::a": R.FAILED_STUB}, rust_texts={"tests::a": "not implemented"}), base)
    assert [(p.code, p.subject) for p in none.problems] == [("E-CUT-NO-TEST-FAILED", RS_ID)]


def test_del_a_typescript_cut_is_cited_by_the_vitest_failure_message(tmp_path):
    root = make_root(tmp_path, touched=cut_entry("load", TS_BODY, "typescript", "src/p.ts"))
    write(root, "src/p.ts", ts_deleted(f'throw new Error("not implemented: {TS_ID}");'))
    write(root, "ops/refactor/assignments.toml", '[assignments]\nU3 = ["typescript:ts/src/core.test.ts::loads"]\n')
    write_stage(root, "Deleted")
    got = R.report_deletion(root, cut_results({"typescript:ts/src/core.test.ts::loads": R.FAILED_STUB}, {"typescript:ts/src/core.test.ts::loads": f"Error: not implemented: {TS_ID}"}),
                            lambda f: TS_CUT)
    assert got.exit_code == R.EXIT_OK


SH_TEST = "shell:tests/sync-test.sh"


def shell_cut_root(tmp_path: Path, test_text: str = "bash src/p.sh\n") -> Path:
    deleted = SH_FN.replace('  git add "runs/$run"\n  git commit -m "run $run"\n', "  return 99\n  return 99\n")
    root = make_root(tmp_path, touched=cut_entry("sync", SH_BODY, "shell", "src/p.sh"))
    write(root, "src/p.sh", deleted)
    write(root, "tests/sync-test.sh", test_text)
    write(root, "ops/refactor/assignments.toml", f'[assignments]\nU13 = ["{SH_TEST}"]\n')
    write_stage(root, "Deleted")
    return root


def test_del_a_shell_cut_needs_a_test_naming_the_script_that_failed_with_exit_99(tmp_path):
    root = shell_cut_root(tmp_path)
    base = lambda f: SH_FN      # noqa: E731
    ok = R.report_deletion(root, R.Results(outcomes={SH_TEST: R.FAILED_STUB}, exit_codes={SH_TEST: 99}), base)
    assert ok.exit_code == R.EXIT_OK
    other_code = R.report_deletion(root, R.Results(outcomes={SH_TEST: R.FAILED_STUB}, exit_codes={SH_TEST: 1}), base)
    assert [(p.code, p.subject) for p in other_code.problems] == [("E-CUT-NO-TEST-FAILED", "src/p.sh::sync")]
    passed = R.report_deletion(root, R.Results(outcomes={SH_TEST: R.PASSED}, exit_codes={SH_TEST: 0}), base)
    assert [(p.code, p.subject) for p in passed.problems] == [("E-CUT-NO-TEST-FAILED", "src/p.sh::sync")]


def test_del_a_shell_test_that_does_not_name_the_script_does_not_prove_its_cut(tmp_path):
    root = shell_cut_root(tmp_path, test_text="echo unrelated\n")
    result = R.report_deletion(root, R.Results(outcomes={SH_TEST: R.FAILED_STUB}, exit_codes={SH_TEST: 99}), lambda f: SH_FN)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", "src/p.sh::sync")]


def test_del_the_report_never_edits_production_code_with_cuts(tmp_path):
    root = cut_deletion_root(tmp_path)
    before = (root / "src/p.py").read_bytes()
    R.report_deletion(root, cut_results({CUT_TEST: R.PASSED, CUT_TEST_2: R.PASSED}), BASE_PY)
    assert (root / "src/p.py").read_bytes() == before


def test_del_a_shell_test_that_ends_with_exit_99_failed_for_the_stand_in_whatever_it_printed():
    assert R.parse_shell_results(json.dumps({"tests/a-test.sh": {"code": 99, "output": ""}})) == {"shell:tests/a-test.sh": R.FAILED_STUB}


# ---- integration: cut entries through the real tools on fixtures/cuts (one function per language with two cuts, a guard and a use) ----

CUTS = Path(__file__).parent / "fixtures" / "cuts"
CUT_CHECKED = ("python", "rust", "typescript")                       # the languages the coverage tools can measure on every machine (shell needs kcov, Linux only)
CUT_FUNCTIONS = {"python": ("py/cutpy/core.py", "publish"), "rust": ("rs/cutrs/src/lib.rs", "publish"),
                 "typescript": ("ts/src/core.ts", "publish"), "shell": ("scripts/cutsh.sh", "publish_run")}


def fresh_cuts(tmp_path: Path) -> Path:
    """A private copy of fixtures/cuts, committed in its own git repository (the base of a deletion is HEAD), sharing the installed
    TypeScript dependencies."""
    root = tmp_path / "cuts"
    shutil.copytree(CUTS, root, ignore=MINI_IGNORED)
    os.symlink(MINI_DEPS, root / "ts" / "node_modules")
    (root / ".gitignore").write_text((root / ".gitignore").read_text() + "ts/node_modules\n")
    write_stage(root, "Deleted")
    for args in (("init", "-q"), ("add", "-A"), ("commit", "-q", "-m", "base")):
        git_in(root, *args)
    return root


def delete_the_cuts(root: Path) -> None:
    """The deletion a person makes by hand, produced by `apply-cuts --dry-run` (the tool itself never writes production code)."""
    done = tool(root, "apply-cuts", "--dry-run")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    printed = json.loads((root / "ops/refactor/reports/apply-cuts.json").read_text())["entries"]
    for e in tomllib.loads((root / "ops/refactor/touched_set.toml").read_text())["entry"]:
        text = (root / e["file"]).read_text()
        in_function = sorted(R.lines_in_text(e["language"], text, e["function"]))
        lines_ = text.splitlines()
        new = lines_[: in_function[0] - 1] + printed[f"{e['file']}::{e['function']}"].splitlines() + lines_[in_function[-1]:]
        (root / e["file"]).write_text("\n".join(new) + "\n")


def test_cuts_fixture_the_entries_resolve_in_all_four_languages(tmp_path):
    root = tmp_path / "c"
    shutil.copytree(CUTS, root, ignore=MINI_IGNORED)
    done = tool(root, "check-cuts", "--strict")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    kinds = json.loads((root / "ops/refactor/reports/cuts.json").read_text())["kinds"]
    assert kinds == {f"{file}::{function}": "cut" for file, function in CUT_FUNCTIONS.values()}


def test_cuts_fixture_a_cut_entry_is_proved_by_lines_and_branches_of_the_cut_use_and_guard(coverage_tools, tmp_path):
    root = fresh_cuts(tmp_path)
    done = tool(root, "check-coverage", *[a for lang in CUT_CHECKED for a in ("--language", lang)])
    report = json.loads((root / "ops/refactor/reports/coverage.json").read_text())
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    for language in CUT_CHECKED:
        file, function = CUT_FUNCTIONS[language]
        lines_n, lines_hit, branches_n, branches_hit = report["measured"][f"{file}::{function}"]
        assert lines_n == lines_hit > 0 and branches_n == branches_hit > 0, (language, report["measured"])        # the guard's branches were counted
        assert report["kinds"][f"{file}::{function}"] == "cut"


def test_cuts_fixture_a_cut_no_test_reaches_is_short_of_coverage(coverage_tools, tmp_path):
    root = fresh_cuts(tmp_path)
    test = root / "py/test_core.py"
    test.write_text(test.read_text().split("def test_publish_amends_a_run")[0] + "def test_publish_reports_a_failed_add():\n    assert publish(\"r\", \"\") == \"failed\"\n")
    done = tool(root, "check-coverage", "--language", "python")
    report = json.loads((root / "ops/refactor/reports/coverage.json").read_text())
    assert done.returncode == R.EXIT_FAIL
    assert [(p["code"], p["subject"]) for p in report["problems"]] == [("E-BELOW", "py/cutpy/core.py::publish")]
    assert re.fullmatch(r"\d+ of \d+ lines \(line \d+\)", report["problems"][0]["detail"])


def test_cuts_fixture_the_deletion_made_from_apply_cuts_is_accepted_and_every_cut_is_proved_by_a_failing_test(coverage_tools, tmp_path):
    root = fresh_cuts(tmp_path)
    assert tool(root, "check-stubs").returncode == R.EXIT_FAIL                 # nothing deleted yet: the cuts are still in place
    delete_the_cuts(root)
    stubs = tool(root, "check-stubs", "--base", "HEAD")
    assert stubs.returncode == R.EXIT_OK, stubs.stdout + stubs.stderr
    ran = tool(root, "run-suites")
    assert ran.returncode == R.EXIT_OK, ran.stdout + ran.stderr
    done = tool(root, "report-deletion")
    report = json.loads((root / "ops/refactor/reports/deletion.json").read_text())
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    expected = {f"refactor-cut:{CUT_FUNCTIONS[lang][0]}::publish#{n}" for lang in CUT_CHECKED for n in (1, 2)}
    assert set(report["cuts_cited"]) == expected
    assert (root / "ops/refactor/reports/results-shell.json").exists()                               # the shell cuts were proved by exit 99, not by an id


def test_cuts_fixture_a_cut_that_no_failing_test_cites_is_a_coverage_gap(coverage_tools, tmp_path):
    root = fresh_cuts(tmp_path)
    delete_the_cuts(root)
    test = root / "py/test_core.py"
    text = test.read_text()
    for name, call in (("amends_a_run", 'publish("r", "x", amend=True) == "ok:r/x"'), ("reports_a_failed_amend", 'publish("r", "", amend=True) == "failed"')):
        text = text.replace(f"def test_publish_{name}():\n    assert {call}\n", "")      # no test reaches the amend branch any more
    assert "amend=True" not in text
    test.write_text(text)
    assert tool(root, "run-suites").returncode == R.EXIT_OK
    done = tool(root, "report-deletion")
    report = json.loads((root / "ops/refactor/reports/deletion.json").read_text())
    assert done.returncode == R.EXIT_FAIL
    assert [(p["code"], p["subject"]) for p in report["problems"] if p["code"] != "E-RESULTS-MISSING"] == [
        ("E-CUT-NO-TEST-FAILED", "refactor-cut:py/cutpy/core.py::publish#2")]


def test_cuts_fixture_a_deletion_that_also_touches_the_guard_is_collateral(coverage_tools, tmp_path):
    root = fresh_cuts(tmp_path)
    delete_the_cuts(root)
    core = root / "py/cutpy/core.py"
    core.write_text(core.read_text().replace("if done != 0:", "if done:"))
    done = tool(root, "check-stubs")
    report = json.loads((root / "ops/refactor/reports/stubs.json").read_text())
    assert done.returncode == R.EXIT_FAIL
    assert [(p["code"], p["subject"]) for p in report["problems"]] == [("E-CUT-COLLATERAL", "py/cutpy/core.py::publish")]


# ---- rounds: cuts that follow each other on a path are proved one round at a time -------------------------------------------------
# Round 1 applies every cut; the first stand-in a test reaches raises, so only that cut is cited. The cited cuts go back to their base text,
# and the next round runs against a tree in which only the still-pending cuts are replaced.

TWO1 = "refactor-cut:src/p.py::publish#1"
TWO2 = "refactor-cut:src/p.py::publish#2"
STAND1 = f'raise NotImplementedError("{TWO1}")'
STAND2 = f'raise NotImplementedError("{TWO2}")'
BASE_TWO = lambda f: PY_TWO      # noqa: E731
ROUND1_TREE = two_cut_text(STAND1, STAND2)
ROUND2_TREE = two_cut_text("a = fetch(repo)", STAND2)
ROUNDS_FILE = "ops/refactor/reports/cut-rounds.json"


def rounds_root(tmp_path: Path, tree: str = ROUND1_TREE) -> Path:
    return cut_deletion_root(tmp_path, body=TWO_CUTS, current=tree)


def round_state(root: Path) -> dict:
    return json.loads((root / ROUNDS_FILE).read_text())


def test_rounds_round_1_cites_the_first_cut_and_leaves_the_second_pending(tmp_path):
    root = rounds_root(tmp_path)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.FAILED_STUB}, {CUT_TEST: cited(1), CUT_TEST_2: cited(1)}), BASE_TWO, round_=1)
    assert result.exit_code == R.EXIT_FAIL
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-PENDING", TWO2)]
    assert result.data["pending"] == [TWO2] and result.data["round"] == 1
    assert round_state(root) == {"round": 1, "cuts": {TWO1: {"tests": [CUT_TEST, CUT_TEST_2], "round": 1}}}


def test_rounds_round_2_cites_the_second_cut_and_the_process_ends_with_exit_0(tmp_path):
    root = rounds_root(tmp_path)
    R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB}, {CUT_TEST: cited(1)}), BASE_TWO, round_=1)
    (root / "src/p.py").write_text(ROUND2_TREE)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.PASSED}, {CUT_TEST: cited(2)}), BASE_TWO, round_=2)
    assert result.exit_code == R.EXIT_OK and result.problems == [] and result.data["pending"] == []
    assert round_state(root) == {"round": 2, "cuts": {TWO1: {"tests": [CUT_TEST], "round": 1}, TWO2: {"tests": [CUT_TEST], "round": 2}}}


def test_rounds_a_round_that_cites_nothing_new_leaves_the_pending_cuts_as_coverage_gaps(tmp_path):
    root = rounds_root(tmp_path)
    R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB}, {CUT_TEST: cited(1)}), BASE_TWO, round_=1)
    (root / "src/p.py").write_text(ROUND2_TREE)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.PASSED, CUT_TEST_2: R.PASSED}), BASE_TWO, round_=2)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", TWO2)]
    assert result.exit_code == R.EXIT_FAIL and list(round_state(root)["cuts"]) == [TWO1]


def test_rounds_a_round_out_of_order_is_refused(tmp_path):
    root = rounds_root(tmp_path, ROUND2_TREE)
    assert [p.code for p in R.report_deletion(root, cut_results({}), BASE_TWO, round_=2).problems] == ["E-ROUND-ORDER"]          # no round 1 yet
    R.report_deletion(rounds_root(tmp_path / "b"), cut_results({CUT_TEST: R.FAILED_STUB}, {CUT_TEST: cited(1)}), BASE_TWO, round_=1)
    again = rounds_root(tmp_path / "c")
    write(again, ROUNDS_FILE, json.dumps({"round": 1, "cuts": {TWO1: {"tests": [CUT_TEST], "round": 1}}}))
    assert [p.code for p in R.report_deletion(again, cut_results({}), BASE_TWO, round_=3).problems] == ["E-ROUND-ORDER"]


def test_rounds_round_1_starts_from_nothing_whatever_an_earlier_run_left(tmp_path):
    root = rounds_root(tmp_path)
    write(root, ROUNDS_FILE, json.dumps({"round": 5, "cuts": {TWO1: {"tests": ["x"], "round": 5}, TWO2: {"tests": ["x"], "round": 5}}}))
    R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB}, {CUT_TEST: cited(1)}), BASE_TWO, round_=1)
    assert list(round_state(root)["cuts"]) == [TWO1]


def test_rounds_round_2_against_a_tree_that_still_has_the_cited_cuts_stand_in_is_collateral(tmp_path):
    root = rounds_root(tmp_path)
    R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB}, {CUT_TEST: cited(1)}), BASE_TWO, round_=1)
    result = R.report_deletion(root, cut_results({}), BASE_TWO, round_=2)                   # the tree is still the round 1 tree
    assert [p.code for p in result.problems] == ["E-CUT-COLLATERAL"]
    assert list(round_state(root)["cuts"]) == [TWO1]                                         # nothing was recorded from an invalid tree


def test_rounds_without_a_round_number_the_behaviour_is_the_single_run_one_and_no_state_is_written(tmp_path):
    root = rounds_root(tmp_path)
    result = R.report_deletion(root, cut_results({CUT_TEST: R.FAILED_STUB, CUT_TEST_2: R.PASSED}, {CUT_TEST: cited(1)}), BASE_TWO)
    assert [(p.code, p.subject) for p in result.problems] == [("E-CUT-NO-TEST-FAILED", TWO2)]
    assert not (root / ROUNDS_FILE).exists()


def test_rounds_check_stubs_pending_accepts_the_tree_where_only_the_pending_cuts_are_replaced(tmp_path):
    root = rounds_root(tmp_path, ROUND2_TREE)
    write(root, ROUNDS_FILE, json.dumps({"round": 1, "cuts": {TWO1: {"tests": [CUT_TEST], "round": 1}}}))
    assert R.check_stubs(root, BASE_TWO, pending=R.pending_cuts(root)).exit_code == R.EXIT_OK
    assert stub_problems(R.check_stubs(root, BASE_TWO)) == [("E-CUT-NOT-REPLACED", TWO1)]               # without --pending every cut must be replaced
    write(root, "src/p.py", ROUND1_TREE)
    assert stub_problems(R.check_stubs(root, BASE_TWO, pending=R.pending_cuts(root))) == [("E-CUT-COLLATERAL", "src/p.py::publish")]


def test_rounds_apply_cuts_pending_prints_stand_ins_only_for_the_cuts_not_yet_cited(tmp_path):
    root = rounds_root(tmp_path)
    assert apply_text(R.apply_cuts(root, BASE_TWO, pending=R.pending_cuts(root)))["src/p.py::publish"] == two_cut_text(STAND1, STAND2) + ""    # no state: all pending
    write(root, ROUNDS_FILE, json.dumps({"round": 1, "cuts": {TWO1: {"tests": [CUT_TEST], "round": 1}}}))
    assert apply_text(R.apply_cuts(root, BASE_TWO, pending=R.pending_cuts(root)))["src/p.py::publish"] == ROUND2_TREE
    write(root, ROUNDS_FILE, json.dumps({"round": 2, "cuts": {TWO1: {"tests": [], "round": 1}, TWO2: {"tests": [], "round": 2}}}))
    assert apply_text(R.apply_cuts(root, BASE_TWO, pending=R.pending_cuts(root)))["src/p.py::publish"] == PY_TWO       # all cited: the base text


def test_rounds_a_shell_entry_is_cited_as_a_unit_by_exit_99(tmp_path):
    root = shell_cut_root(tmp_path)
    base = lambda f: SH_FN      # noqa: E731
    result = R.report_deletion(root, R.Results(outcomes={SH_TEST: R.FAILED_STUB}, exit_codes={SH_TEST: 99}), base, round_=1)
    assert result.exit_code == R.EXIT_OK
    assert set(round_state(root)["cuts"]) == {"refactor-cut:src/p.sh::sync#1", "refactor-cut:src/p.sh::sync#2"}


def test_rounds_the_command_line_takes_round_and_pending(tmp_path, capsys):
    root = rounds_root(tmp_path)
    git_in(root, "init", "-q")
    write(root, "src/p.py", PY_TWO)
    git_in(root, "add", "src/p.py", "ops/refactor/touched_set.toml")
    git_in(root, "commit", "-q", "-m", "base")
    write(root, "src/p.py", ROUND1_TREE)
    write(root, ROUNDS_FILE, json.dumps({"round": 1, "cuts": {TWO1: {"tests": [CUT_TEST], "round": 1}}}))
    write(root, "src/p.py", ROUND2_TREE)
    assert cli(root, "check-stubs", "--pending") == R.EXIT_OK and cli(root, "check-stubs") == R.EXIT_FAIL
    capsys.readouterr()
    assert cli(root, "apply-cuts", "--dry-run", "--pending") == R.EXIT_OK
    assert STAND2 in capsys.readouterr().out


# ---- integration: rounds through the real runners on fixtures/rounds (two cuts in a row on one path, in each of three languages) -----

ROUNDS = Path(__file__).parent / "fixtures" / "rounds"
ROUND_FILES = {"python": "py/cutpy/core.py", "rust": "rs/roundrs/src/lib.rs", "typescript": "ts/src/core.ts"}


def fresh_rounds(tmp_path: Path) -> Path:
    root = tmp_path / "rounds"
    shutil.copytree(ROUNDS, root, ignore=MINI_IGNORED)
    os.symlink(MINI_DEPS, root / "ts" / "node_modules")
    (root / ".gitignore").write_text((root / ".gitignore").read_text() + "ts/node_modules\n")
    write_stage(root, "Deleted")
    for args in (("init", "-q"), ("add", "-A"), ("commit", "-q", "-m", "base")):
        git_in(root, *args)
    return root


def delete_the_cuts(root: Path, *extra: str) -> None:       # noqa: F811  (the same helper, now taking --pending)
    """The deletion a person makes by hand, produced by `apply-cuts --dry-run` (the tool itself never writes production code)."""
    done = tool(root, "apply-cuts", "--dry-run", *extra)
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr
    printed = json.loads((root / "ops/refactor/reports/apply-cuts.json").read_text())["entries"]
    for e in tomllib.loads((root / "ops/refactor/touched_set.toml").read_text())["entry"]:
        text = (root / e["file"]).read_text()
        in_function = sorted(R.lines_in_text(e["language"], text, e["function"]))
        lines_ = text.splitlines()
        new = lines_[: in_function[0] - 1] + printed[f"{e['file']}::{e['function']}"].splitlines() + lines_[in_function[-1]:]
        (root / e["file"]).write_text("\n".join(new) + "\n")


def round_report(root: Path, n: int) -> tuple[subprocess.CompletedProcess, dict]:
    assert tool(root, "run-suites").returncode == R.EXIT_OK
    done = tool(root, "report-deletion", "--round", str(n))
    return done, json.loads((root / "ops/refactor/reports/deletion.json").read_text())


def test_rounds_fixture_the_entries_resolve(tmp_path):
    root = tmp_path / "r"
    shutil.copytree(ROUNDS, root, ignore=MINI_IGNORED)
    done = tool(root, "check-cuts", "--strict")
    assert done.returncode == R.EXIT_OK, done.stdout + done.stderr


def test_rounds_fixture_round_1_cites_the_first_cut_of_each_language_and_round_2_the_second(coverage_tools, tmp_path):
    root = fresh_rounds(tmp_path)
    delete_the_cuts(root)
    assert tool(root, "check-stubs").returncode == R.EXIT_OK
    done, report = round_report(root, 1)
    firsts = {f"refactor-cut:{ROUND_FILES[lang]}::publish_all#1" for lang in ROUND_FILES}
    seconds = {f"refactor-cut:{ROUND_FILES[lang]}::publish_all#2" for lang in ROUND_FILES}
    assert done.returncode == R.EXIT_FAIL, done.stdout
    assert {(p["code"], p["subject"]) for p in report["problems"]} == {("E-CUT-PENDING", s) for s in seconds}
    assert set(report["cuts_cited"]) == firsts and set(report["pending"]) == seconds
    # round 2: only the pending cuts are replaced; the cited ones are back at their base text
    assert tool(root, "check-stubs", "--pending").returncode == R.EXIT_FAIL                      # the tree is still the round 1 tree
    delete_the_cuts(root, "--pending")
    for lang, file in ROUND_FILES.items():
        assert "#1" not in (root / file).read_text() and "#2" in (root / file).read_text(), lang
    pending_stubs = tool(root, "check-stubs", "--pending")
    assert pending_stubs.returncode == R.EXIT_OK, pending_stubs.stdout + pending_stubs.stderr
    done, report = round_report(root, 2)
    assert done.returncode == R.EXIT_OK, done.stdout
    assert set(report["cuts_cited"]) == seconds and report["pending"] == []
    state = json.loads((root / "ops/refactor/reports/cut-rounds.json").read_text())
    assert state["round"] == 2 and {k: v["round"] for k, v in state["cuts"].items()} == {**{f: 1 for f in firsts}, **{s: 2 for s in seconds}}
    delete_the_cuts(root, "--pending")                                                              # nothing pending: every function is back at its base text
    assert subprocess.run(["git", "-C", str(root), "diff", "--quiet", "--", *ROUND_FILES.values()]).returncode == 0


def test_rounds_fixture_without_rounds_the_second_cut_is_a_coverage_gap(coverage_tools, tmp_path):
    root = fresh_rounds(tmp_path)
    delete_the_cuts(root)
    assert tool(root, "run-suites").returncode == R.EXIT_OK
    done = tool(root, "report-deletion")
    report = json.loads((root / "ops/refactor/reports/deletion.json").read_text())
    assert done.returncode == R.EXIT_FAIL
    assert {(p["code"], p["subject"]) for p in report["problems"]} == {("E-CUT-NO-TEST-FAILED", f"refactor-cut:{f}::publish_all#2") for f in ROUND_FILES.values()}


# A working-tree file that does not parse is a problem in the report, not a traceback (E-FILE-UNPARSEABLE).

def test_unparseable_check_cuts_names_the_file_instead_of_failing(tmp_path):
    root = cuts_root(tmp_path, cut_toml("return None"), "def publish(repo:\n    return None\n")
    result = R.check_cuts(root)
    assert result.exit_code == R.EXIT_FAIL and cut_problems(result) == [("E-FILE-UNPARSEABLE", "src/p.py::publish")]
    assert cli(root, "check-cuts") == R.EXIT_FAIL


def test_unparseable_check_coverage_names_the_file_for_a_whole_entry_and_a_cut_entry(tmp_path):
    broken = "def publish(repo:\n    return None\n"
    for kind, head, body in (("whole", "whole = true\n", ""), ("cut", "", cut_toml("return None"))):
        result = coverage_result(tmp_path / kind, cut_entry(body=body, head=head), {"src/p.py": broken}, python={"src/p.py": lines({1: 1, 2: 1})})
        assert cut_problems(result) == [("E-FILE-UNPARSEABLE", "src/p.py::publish")], kind
        assert result.exit_code == R.EXIT_FAIL
