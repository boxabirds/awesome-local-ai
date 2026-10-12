"""The refactor-method tool's own tests. Written before the tool (story 1 of the data-separation epic): each section
names the test cases (TC-nn) of the design's test strategy it covers.

Run with: uv run --with pytest python -m pytest -q ops/refactor
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import refactor as R

USE_CASE_IDS = [f"U{n}" for n in range(1, 15)]


def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


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
    dup = [p for p in result.problems if p.code == "E-DUPLICATE"]
    assert len(dup) == 1 and dup[0].subject == "python:a.py::t1" and "U1" in dup[0].detail and "U2" in dup[0].detail


def test_tc04_an_assignment_that_no_runner_lists_is_stale(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED)
    result = R.check_register(root, lister(python=SIX_LISTED[:-1]))
    assert [(p.code, p.subject) for p in result.problems] == [("E-STALE", "python:c.py::t2")]


def test_tc05_an_assignment_under_an_unknown_use_case_is_refused(tmp_path):
    root = make_root(tmp_path, SIX_ASSIGNED + 'U15 = ["python:d.py::t1"]\n')
    result = R.check_register(root, lister(python=SIX_LISTED + ["d.py::t1"]))
    assert "E-UNKNOWN-USE-CASE" in codes(result) and result.exit_code == R.EXIT_FAIL


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
    assert "E-UNFIT-NO-DECISION" in codes(result) and result.exit_code == R.EXIT_FAIL


def test_tc08_a_language_with_touched_files_and_no_listed_tests_is_refused(tmp_path):
    touched = '[[entry]]\nlanguage = "rust"\nfile = "tools/dbench/src/collect.rs"\nfunction = "pull"\nclasses = ["B"]\n'
    root = make_root(tmp_path, SIX_ASSIGNED, touched)
    result = R.check_register(root, lister(python=SIX_LISTED))
    assert [(p.code, p.subject) for p in result.problems] == [("E-NO-TESTS", "rust")]


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
    write(root, "ops/refactor/stage.toml", f'stage = "{stage}"\n')
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
    write(root, "ops/refactor/stage.toml", 'stage = "Deleted"\n')
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
    assert sorted(codes(result)) == ["E-FATE-MISSING", "E-FATE-MULTIPLE"]


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
    assert sorted(codes(result)) == ["E-FATE-STATE", "E-FATE-UNKNOWN-TEST"]


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
    assert sorted(codes(result)) == ["E-FATE-NO-NEW-TEST", "E-FATE-RETIRED-NO-FUNCTION", "E-FATE-RETIRED-NO-REASON"]


def test_the_fates_report_is_written_and_counts_each_state(tmp_path):
    root = make_root(tmp_path, assignments=FATE_ASSIGNMENTS, touched=FATE_TOUCHED)
    write(root, "ops/refactor/fates.toml", '[[fate]]\ntest = "python:t_a"\nstate = "kept"\n')
    R.check_fates(root)
    report = json.loads((root / "ops/refactor/reports/fates.json").read_text())
    assert report["exit_code"] == R.EXIT_FAIL and report["counts"]["kept"] == 1


# ---- coverage proof: 100% lines and branches of the touched files, or no proof ----------------------------------------------

def coverage_result(tmp_path: Path, measured: dict) -> R.Result:
    root = make_root(tmp_path, touched=FATE_TOUCHED)
    return R.check_coverage(root, measured)


def test_tc40_full_line_and_branch_coverage_of_every_touched_file_passes(tmp_path):
    result = coverage_result(tmp_path, {"python": {"src/a.py": R.FileCoverage(10, 10, 4, 4)}})
    assert result.exit_code == R.EXIT_OK, result.problems


def test_tc41_one_missed_line_or_branch_is_named_with_its_counts(tmp_path):
    result = coverage_result(tmp_path, {"python": {"src/a.py": R.FileCoverage(10, 9, 4, 3)}})
    assert codes(result) == ["E-LINES-UNCOVERED", "E-BRANCHES-UNCOVERED"]


def test_tc42_a_touched_file_the_tool_did_not_report_is_undecidable_not_a_pass(tmp_path):
    result = coverage_result(tmp_path, {"python": {}})
    assert result.exit_code == R.EXIT_ERROR and codes(result) == ["E-COVERAGE-UNKNOWN"]


def test_tc43_a_language_with_no_coverage_output_at_all_is_undecidable(tmp_path):
    result = coverage_result(tmp_path, {})
    assert result.exit_code == R.EXIT_ERROR and codes(result) == ["E-COVERAGE-UNKNOWN"]


def test_a_file_with_no_branches_is_fully_covered_on_branches(tmp_path):
    result = coverage_result(tmp_path, {"python": {"src/a.py": R.FileCoverage(3, 3, 0, 0)}})
    assert result.exit_code == R.EXIT_OK


# ---- idle guard: nothing moves on a machine that is running a story ---------------------------------------------------------

def test_tc58_an_idle_machine_passes(tmp_path):
    assert R.check_idle(lambda: []).exit_code == R.EXIT_OK


def test_tc59_a_running_story_refuses_and_names_it(tmp_path):
    result = R.check_idle(lambda: ["run v2-x-r1 story 3"])
    assert result.exit_code == R.EXIT_FAIL and codes(result) == ["E-MACHINE-BUSY"]


def test_tc60_a_probe_that_cannot_tell_is_undecidable(tmp_path):
    result = R.check_idle(lambda: None)
    assert result.exit_code == R.EXIT_ERROR and codes(result) == ["E-IDLE-UNKNOWN"]


# ---- justifiers and the command line ----------------------------------------------------------------------------------

def cli(root: Path, *args: str) -> int:
    return R.main(["--root", str(root), *args])


def test_tc44_advance_inventory_to_matrices_needs_the_register_and_the_touched_set_to_hold(tmp_path, monkeypatch):
    root = make_root(tmp_path, assignments=SIX_ASSIGNED)
    monkeypatch.setattr(R, "list_tests", lister(python=SIX_LISTED))
    assert cli(root, "advance", "Matrices") == R.EXIT_OK
    assert R.read_stage(root) == "Matrices"


def test_tc45_advance_with_the_register_broken_refuses_and_the_stage_stays(tmp_path, monkeypatch):
    root = make_root(tmp_path, assignments=SIX_ASSIGNED)
    monkeypatch.setattr(R, "list_tests", lister(python=SIX_LISTED + ["d.py::extra"]))
    assert cli(root, "advance", "Matrices") == R.EXIT_FAIL
    assert R.read_stage(root) == "Inventory"


def test_advancing_two_stages_at_once_is_refused_with_exit_1(tmp_path):
    root = make_root(tmp_path)
    assert cli(root, "advance", "Proved") == R.EXIT_FAIL


def test_stage_prints_the_current_stage(tmp_path, capsys):
    root = make_root(tmp_path)
    assert cli(root, "stage") == R.EXIT_OK
    assert capsys.readouterr().out.strip() == "Inventory"


def test_a_corrupt_stage_file_is_exit_1_and_is_left_as_it_is(tmp_path):
    root = make_root(tmp_path)
    write(root, "ops/refactor/stage.toml", "stage = [")
    assert cli(root, "stage") == R.EXIT_ERROR
    assert (root / "ops/refactor/stage.toml").read_text() == "stage = ["


def test_check_fates_and_check_stubs_run_from_the_command_line(tmp_path):
    root = make_root(tmp_path, assignments=FATE_ASSIGNMENTS, touched=FATE_TOUCHED)
    assert cli(root, "check-fates") == R.EXIT_FAIL          # three assigned tests, no fates
    write(root, "src/a.py", "def record():\n    return 1\n")
    assert cli(root, "check-stubs") == R.EXIT_FAIL          # not a stub yet
    write(root, "src/a.py", "def record():\n    raise NotImplementedError\n")
    assert cli(root, "check-stubs") == R.EXIT_OK


def test_check_coverage_reads_the_neutral_coverage_file(tmp_path):
    root = make_root(tmp_path, touched=FATE_TOUCHED)
    write(root, "ops/refactor/reports/coverage-input.json", json.dumps({"python": {"src/a.py": [10, 10, 4, 4]}}))
    assert cli(root, "check-coverage") == R.EXIT_OK
    write(root, "ops/refactor/reports/coverage-input.json", json.dumps({"python": {"src/a.py": [10, 9, 4, 4]}}))
    assert cli(root, "check-coverage") == R.EXIT_FAIL


def test_check_coverage_with_no_input_file_is_undecidable(tmp_path):
    root = make_root(tmp_path, touched=FATE_TOUCHED)
    assert cli(root, "check-coverage") == R.EXIT_ERROR


def test_report_deletion_reads_the_neutral_results_file(tmp_path):
    root = make_root(tmp_path, assignments='[assignments]\nU1 = ["python:t_a"]\n', touched=FATE_TOUCHED)
    write(root, "src/a.py", "def record():\n    raise NotImplementedError\n")
    write(root, "ops/refactor/reports/results-input.json", json.dumps({"outcomes": {"python:t_a": R.FAILED_STUB}, "missing": []}))
    assert cli(root, "report-deletion") == R.EXIT_OK
    write(root, "ops/refactor/reports/results-input.json", json.dumps({"outcomes": {"python:t_a": R.PASSED}, "missing": []}))
    assert cli(root, "report-deletion") == R.EXIT_FAIL


def test_check_idle_uses_the_machine_probe(tmp_path, monkeypatch):
    root = make_root(tmp_path)
    monkeypatch.setattr(R, "probe_running_stories", lambda: [])
    assert cli(root, "check-idle") == R.EXIT_OK
    monkeypatch.setattr(R, "probe_running_stories", lambda: ["run x story 1"])
    assert cli(root, "check-idle") == R.EXIT_FAIL
    monkeypatch.setattr(R, "probe_running_stories", lambda: None)
    assert cli(root, "check-idle") == R.EXIT_ERROR


def test_a_deletion_advance_is_refused_until_the_stubs_are_in(tmp_path):
    root = make_root(tmp_path, touched=FATE_TOUCHED)
    write(root, "ops/refactor/stage.toml", 'stage = "Proved"\n')
    write(root, "src/a.py", "def record():\n    return 1\n")
    assert cli(root, "advance", "Deleted") == R.EXIT_FAIL
    write(root, "src/a.py", "def record():\n    raise NotImplementedError\n")
    assert cli(root, "advance", "Deleted") == R.EXIT_OK


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


# ---- python adapter: the tests that execute a touched function, from coverage contexts ----------------------------------

PY_SOURCE = "def record():\n    x = 1\n    return x\n\n\ndef other():\n    return 2\n"


def test_function_lines_are_the_def_through_its_last_line():
    assert R.python_function_lines(PY_SOURCE, "record") == {1, 2, 3}
    assert R.python_function_lines(PY_SOURCE, "other") == {6, 7}


def test_function_lines_of_a_method_use_the_dotted_name():
    src = "class C:\n    def m(self):\n        return 1\n"
    assert R.python_function_lines(src, "C.m") == {2, 3}


def test_function_lines_of_a_missing_function_is_none():
    assert R.python_function_lines(PY_SOURCE, "ghost") is None


def test_a_test_whose_context_hit_a_line_of_the_function_touches_it():
    contexts = {"2": ["test_a.py::test_one|run"], "7": ["test_b.py::test_two|run"]}
    assert R.tests_touching(contexts, {1, 2, 3}) == {"python:test_a.py::test_one"}


def test_setup_and_teardown_contexts_and_the_empty_context_are_not_tests():
    contexts = {"2": ["", "test_a.py::test_one|setup", "test_a.py::test_one|teardown", "test_a.py::test_one|run"]}
    assert R.tests_touching(contexts, {2}) == {"python:test_a.py::test_one"}


def test_a_setup_only_hit_is_not_a_test_touching_the_function():
    assert R.tests_touching({"2": ["test_a.py::test_one|setup"]}, {2}) == set()


def test_parametrised_ids_keep_their_brackets():
    assert R.tests_touching({"2": ["test_a.py::test_p[a-1]|run"]}, {2}) == {"python:test_a.py::test_p[a-1]"}


def test_the_touched_python_tests_are_the_union_over_every_touched_function(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": PY_SOURCE}, touched=(
        '[[entry]]\nlanguage = "python"\nfile = "src/a.py"\nfunction = "record"\nclasses = ["A"]\n'
        '[[entry]]\nlanguage = "python"\nfile = "src/a.py"\nfunction = "other"\nclasses = ["A"]\n'))
    coverage = {"files": {"src/a.py": {"contexts": {"2": ["t.py::one|run"], "7": ["t.py::two|run"]}}}}
    assert R.python_touching_tests(root, coverage) == {"python:t.py::one", "python:t.py::two"}


def test_a_touched_python_file_missing_from_the_coverage_data_is_undecidable(tmp_path):
    root = make_code_root(tmp_path, {"src/a.py": PY_SOURCE}, touched=(
        '[[entry]]\nlanguage = "python"\nfile = "src/a.py"\nfunction = "record"\nclasses = ["A"]\n'))
    with pytest.raises(R.AdapterError):
        R.python_touching_tests(root, {"files": {}})


def test_function_lines_find_a_function_nested_inside_another_by_the_name_the_scan_gives_it():
    src = "def outer():\n    def inner():\n        return 1\n    return inner\n"
    assert R.python_function_lines(src, "inner") == {2, 3}


def test_function_lines_find_a_function_nested_in_a_method_under_the_class_prefix():
    src = "class C:\n    def m(self):\n        def helper():\n            return 1\n        return helper\n"
    assert R.python_function_lines(src, "C.helper") == {3, 4}


# ---- the register reads the adapters' output --------------------------------------------------------------------------

def test_list_tests_reads_the_touched_tests_file_the_adapters_wrote(tmp_path):
    root = make_root(tmp_path)
    write(root, "ops/refactor/reports/touched-tests.json", json.dumps({"python": ["a.py::t1"], "rust": ["m::t2"]}))
    assert R.list_tests(root) == {"python": {"a.py::t1"}, "rust": {"m::t2"}}


def test_list_tests_without_the_file_is_an_adapter_error(tmp_path):
    with pytest.raises(R.AdapterError):
        R.list_tests(make_root(tmp_path))


TWO_TOUCHED = (
    '[[entry]]\nlanguage = "python"\nfile = "h/a.py"\nfunction = "record"\nclasses = ["A"]\n'
    '[[entry]]\nlanguage = "python"\nfile = "m/b.py"\nfunction = "scan"\nclasses = ["B"]\n')


def two_sources(tmp_path: Path):
    root = make_code_root(tmp_path, {"h/a.py": PY_SOURCE, "m/b.py": "def scan():\n    return 1\n"}, touched=TWO_TOUCHED)
    h = write(tmp_path, "h.json", json.dumps({"files": {"a.py": {"contexts": {"2": ["t.py::one|run"]}}}}))
    m = write(tmp_path, "m.json", json.dumps({"files": {"b.py": {"contexts": {"2": ["t.py::two|run"]}}}}))
    return root, h, m


def test_adapt_python_merges_several_sources_and_makes_ids_unique_by_their_folder(tmp_path):
    root, h, m = two_sources(tmp_path)
    write(root, "ops/refactor/reports/touched-tests.json", json.dumps({"rust": ["m::t2"]}))
    assert cli(root, "adapt-python", f"h/={h}", f"m/={m}") == R.EXIT_OK
    stored = json.loads((root / "ops/refactor/reports/touched-tests.json").read_text())
    assert stored == {"rust": ["m::t2"], "python": ["h/t.py::one", "m/t.py::two"]}


def test_adapt_python_with_a_source_missing_is_exit_2_and_writes_nothing(tmp_path):
    root, h, _ = two_sources(tmp_path)
    assert cli(root, "adapt-python", f"h/={h}") == R.EXIT_ERROR
    assert not (root / "ops/refactor/reports/touched-tests.json").exists()


def test_check_register_with_no_adapter_output_is_exit_2(tmp_path):
    assert cli(make_root(tmp_path), "check-register") == R.EXIT_ERROR


# ---- assign by file: one reviewed table, expanded into the register ----------------------------------------------------

def assign_root(tmp_path: Path, mapping: str, tests: dict) -> Path:
    root = make_root(tmp_path)
    write(root, "ops/refactor/file_use_case.toml", mapping)
    write(root, "ops/refactor/reports/touched-tests.json", json.dumps(tests))
    return root


def test_assign_by_file_expands_each_test_to_its_files_use_case(tmp_path):
    root = assign_root(tmp_path, '[python]\n"h/a.py" = "U1"\n"h/b.py" = "U2"\n',
                       {"python": ["h/a.py::t1", "h/a.py::t2", "h/b.py::t1"]})
    assert cli(root, "assign-by-file") == R.EXIT_OK
    written = tomllib_load(root / "ops/refactor/assignments.toml")["assignments"]
    assert written == {"U1": ["python:h/a.py::t1", "python:h/a.py::t2"], "U2": ["python:h/b.py::t1"]}
    assert cli(root, "check-register") == R.EXIT_OK


def tomllib_load(path: Path) -> dict:
    import tomllib
    return tomllib.loads(path.read_text())


def test_assign_by_file_with_an_unmapped_file_is_refused_and_writes_nothing(tmp_path):
    root = assign_root(tmp_path, '[python]\n"h/a.py" = "U1"\n', {"python": ["h/a.py::t1", "h/c.py::t1"]})
    before = (root / "ops/refactor/assignments.toml").read_text()
    assert cli(root, "assign-by-file") == R.EXIT_FAIL
    assert (root / "ops/refactor/assignments.toml").read_text() == before


def test_assign_by_file_to_an_unknown_use_case_is_refused(tmp_path):
    root = assign_root(tmp_path, '[python]\n"h/a.py" = "U99"\n', {"python": ["h/a.py::t1"]})
    assert cli(root, "assign-by-file") == R.EXIT_FAIL


def test_assign_by_file_keeps_the_unfit_decisions_already_recorded(tmp_path):
    root = assign_root(tmp_path, '[python]\n"h/a.py" = "U1"\n', {"python": ["h/a.py::t1", "h/a.py::odd"]})
    write(root, "ops/refactor/assignments.toml",
          '[[unfit]]\ntest = "python:h/a.py::odd"\ndecision = "retire"\nreason = "fits no actor"\n')
    assert cli(root, "assign-by-file") == R.EXIT_OK
    written = tomllib_load(root / "ops/refactor/assignments.toml")
    assert written["assignments"] == {"U1": ["python:h/a.py::t1"]} and written["unfit"][0]["test"] == "python:h/a.py::odd"
    assert cli(root, "check-register") == R.EXIT_OK


# ---- rust adapter: which tests belong to the touched files (from `cargo test -- --list`) -------------------------------

RUST_TOUCHED = (
    '[[entry]]\nlanguage = "rust"\nfile = "tools/dbench/src/collector.rs"\nfunction = "pass"\nclasses = ["C"]\n'
    '[[entry]]\nlanguage = "rust"\nfile = "tools/dbench/src/ingest/inputs.rs"\nfunction = "candidates"\nclasses = ["B"]\n')

CARGO_LIST = """\
     Running unittests src/lib.rs (target/debug/deps/dbench-3c9e3c3b1e939def)
collector::tests::copies_a_run: test
collector::tests::skips_a_complete_run: test
events::tests::parses_an_event: test
ingest::inputs::tests::reads_a_whole_log: test
ingest::mod_less::tests::nothing: test

2 tests, 0 benchmarks
     Running tests/server.rs (target/debug/deps/server-607e7965d4855fd8)
serves_a_run_file: test
lists_machines: test
     Running tests/label.rs (target/debug/deps/label-5db19efd581a89c8)
renders_a_label: test
   Doc-tests dbench
"""


def rust_root(tmp_path: Path) -> Path:
    root = make_code_root(tmp_path, {
        "tools/dbench/src/collector.rs": "pub fn pass() {}\n",
        "tools/dbench/src/events.rs": "pub fn parse() {}\n",
        "tools/dbench/src/ingest/inputs.rs": "pub fn candidates() {}\n",
        "tools/dbench/tests/server.rs": "use dbench::collector::pass;\n#[test]\nfn serves_a_run_file() {}\n",
        "tools/dbench/tests/label.rs": "#[test]\nfn renders_a_label() {}\n",
    }, touched=RUST_TOUCHED)
    return root


def test_unit_tests_of_a_touched_module_are_in_and_of_an_untouched_module_are_out(tmp_path):
    root = rust_root(tmp_path)
    found = R.rust_touching_tests(root, CARGO_LIST.replace("ingest::mod_less::tests::nothing: test\n", ""))
    assert "tools/dbench/src/lib.rs::collector::tests::copies_a_run" in found
    assert "tools/dbench/src/lib.rs::events::tests::parses_an_event" not in found


def test_a_nested_module_path_resolves_to_its_file(tmp_path):
    root = rust_root(tmp_path)
    found = R.rust_touching_tests(root, CARGO_LIST.replace("ingest::mod_less::tests::nothing: test\n", ""))
    assert "tools/dbench/src/lib.rs::ingest::inputs::tests::reads_a_whole_log" in found


def test_an_integration_test_file_that_names_a_touched_module_is_in_and_one_that_does_not_is_out(tmp_path):
    root = rust_root(tmp_path)
    found = R.rust_touching_tests(root, CARGO_LIST.replace("ingest::mod_less::tests::nothing: test\n", ""))
    assert "tools/dbench/tests/server.rs::serves_a_run_file" in found
    assert not any(t.startswith("tools/dbench/tests/label.rs") for t in found)


def test_a_unit_test_whose_module_has_no_file_is_an_adapter_error(tmp_path):
    with pytest.raises(R.AdapterError):
        R.rust_touching_tests(rust_root(tmp_path), CARGO_LIST)      # ingest::mod_less has no file


def test_doc_tests_and_summary_lines_are_not_tests(tmp_path):
    root = rust_root(tmp_path)
    found = R.rust_touching_tests(root, CARGO_LIST.replace("ingest::mod_less::tests::nothing: test\n", ""))
    assert all("Doc-tests" not in t and "benchmarks" not in t for t in found)


def test_adapt_rust_stores_the_rust_key_and_keeps_python(tmp_path):
    root = rust_root(tmp_path)
    write(root, "ops/refactor/reports/touched-tests.json", json.dumps({"python": ["x.py::t"]}))
    listing = write(tmp_path, "list.txt", CARGO_LIST.replace("ingest::mod_less::tests::nothing: test\n", ""))
    assert cli(root, "adapt-rust", str(listing)) == R.EXIT_OK
    stored = json.loads((root / "ops/refactor/reports/touched-tests.json").read_text())
    assert stored["python"] == ["x.py::t"] and len(stored["rust"]) == 5


def test_adapt_rust_on_an_unresolvable_module_is_exit_2_and_writes_nothing(tmp_path):
    root = rust_root(tmp_path)
    listing = write(tmp_path, "list.txt", CARGO_LIST)
    assert cli(root, "adapt-rust", str(listing)) == R.EXIT_ERROR
    assert not (root / "ops/refactor/reports/touched-tests.json").exists()


def test_assign_by_file_uses_the_longest_matching_key_so_a_module_can_differ_from_its_file(tmp_path):
    root = assign_root(tmp_path, '[rust]\n"c/src/lib.rs" = "U3"\n"c/src/lib.rs::ingest" = "U4"\n',
                       {"rust": ["c/src/lib.rs::collector::tests::a", "c/src/lib.rs::ingest::inputs::tests::b"]})
    assert cli(root, "assign-by-file") == R.EXIT_OK
    written = tomllib_load(root / "ops/refactor/assignments.toml")["assignments"]
    assert written == {"U3": ["rust:c/src/lib.rs::collector::tests::a"], "U4": ["rust:c/src/lib.rs::ingest::inputs::tests::b"]}


# ---- typescript adapter: vitest list + playwright list ---------------------------------------------------------------

TS_TOUCHED = (
    '[[entry]]\nlanguage = "typescript"\nfile = "tools/b/server/domain.ts"\nfunction = "findRuns"\nclasses = ["A"]\n'
    '[[entry]]\nlanguage = "typescript"\nfile = "tools/b/server/main.ts"\nfunction = "start"\nclasses = ["C"]\n')


def ts_root(tmp_path: Path) -> Path:
    return make_code_root(tmp_path, {
        "tools/b/server/domain.ts": "export function findRuns() {}\n",
        "tools/b/server/main.ts": "export function start() {}\n",
        "tools/b/server/domain.test.ts": 'import { findRuns } from "./domain"\n',
        "tools/b/shared/view.test.ts": 'import { thing } from "../server/domain"\n',
        "tools/b/shared/other.test.ts": 'import { x } from "./stats"\n',
    }, touched=TS_TOUCHED)


def vitest_json(root: Path, *rows: tuple[str, str]) -> str:
    return json.dumps([{"name": name, "file": str(root / file), "location": {"line": 1, "column": 1}} for file, name in rows])


PW_LIST = "Listing tests:\n  activity.spec.ts:11:1 › the tab leads to it\n  run.spec.ts:5:3 › links › a flag can be read\nTotal: 2 tests in 2 files\n"


def test_a_vitest_file_named_for_or_importing_a_touched_module_is_in_and_an_unrelated_one_is_out(tmp_path):
    root = ts_root(tmp_path)
    listing = vitest_json(root, ("tools/b/server/domain.test.ts", "finds runs"), ("tools/b/shared/view.test.ts", "shows a run"),
                          ("tools/b/shared/other.test.ts", "adds"))
    assert R.typescript_touching_tests(root, listing, "") == {"tools/b/server/domain.test.ts::finds runs", "tools/b/shared/view.test.ts::shows a run"}


def test_every_playwright_test_is_in_because_it_drives_the_whole_app_through_the_server(tmp_path):
    root = ts_root(tmp_path)
    found = R.typescript_touching_tests(root, "[]", PW_LIST, e2e_dir="tools/b/e2e")
    assert found == {"tools/b/e2e/activity.spec.ts::the tab leads to it", "tools/b/e2e/run.spec.ts::links › a flag can be read"}


def test_a_vitest_file_outside_the_repository_is_an_adapter_error(tmp_path):
    root = ts_root(tmp_path)
    bad = json.dumps([{"name": "x", "file": "/elsewhere/a.test.ts", "location": {}}])
    with pytest.raises(R.AdapterError):
        R.typescript_touching_tests(root, bad, "")


def test_adapt_typescript_stores_the_typescript_key_and_keeps_the_rest(tmp_path):
    root = ts_root(tmp_path)
    write(root, "ops/refactor/reports/touched-tests.json", json.dumps({"rust": ["m::t"]}))
    vitest = write(tmp_path, "v.json", vitest_json(root, ("tools/b/server/domain.test.ts", "finds runs")))
    playwright = write(tmp_path, "p.txt", PW_LIST)
    assert cli(root, "adapt-typescript", str(vitest), str(playwright), "--e2e-dir", "tools/b/e2e") == R.EXIT_OK
    stored = json.loads((root / "ops/refactor/reports/touched-tests.json").read_text())
    assert stored["rust"] == ["m::t"] and len(stored["typescript"]) == 3


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
