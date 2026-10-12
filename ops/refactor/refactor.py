#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""The refactor method of docs/designs/operational-data-separation.md, enforced.

MECE test coverage first, then delete first, then expect every assigned test to fail, then reimplement. This tool never
edits production code: it reads test lists, coverage output and test results from the existing runners and fails when
the method's rules are broken. Its data files sit beside it in ops/refactor/ (use_cases.toml, touched_set.toml,
assignments.toml, matrices/, fates.toml, stage.toml); its reports go to ops/refactor/reports/ (git-ignored).

    uv run ops/refactor/refactor.py check-register
    uv run ops/refactor/refactor.py --help

Exit codes: 0 the rule holds; 1 the rule is broken (problems are listed); 2 the tool could not decide (a runner or a
coverage tool is missing, a result file is absent, a node cannot be reached): an unknown is never treated as a pass.
"""
from __future__ import annotations

import argparse
import ast
import fnmatch
import itertools
import json
import os
import re
import subprocess
import sys
import tomllib
from datetime import datetime, timezone
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

EXIT_OK, EXIT_FAIL, EXIT_ERROR = 0, 1, 2
REFACTOR_DIR = Path("ops/refactor")
REPORTS_DIR = REFACTOR_DIR / "reports"
USE_CASES_FILE = REFACTOR_DIR / "use_cases.toml"
ASSIGNMENTS_FILE = REFACTOR_DIR / "assignments.toml"
TOUCHED_FILE = REFACTOR_DIR / "touched_set.toml"
CLASSES_FILE = REFACTOR_DIR / "classes.toml"
MATRICES_DIR = REFACTOR_DIR / "matrices"
TUPLE_SEPARATOR = " x "
STAGE_FILE = REFACTOR_DIR / "stage.toml"
STAGES = ("Inventory", "Matrices", "Proved", "Deleted", "RedContracts", "Reimplemented", "Compared")
BACK_EDGE = ("Deleted", "Proved")      # an assigned test passed against the stubs: the only move backwards
FAILED_STUB, FAILED_OTHER, PASSED = "failed-stub", "failed-other", "passed"
LANGUAGES = ("python", "rust", "typescript", "shell")
UNFIT_DECISIONS = ("assign", "retire")
JSON_INDENT = 2
WORKSPACE_CLASS = "W"                  # git inside the agent's own workspace: out of scope by decision, never in the set
CHECKED_CLASSES = ("A", "B", "C", "E")  # a match in these must be listed or excluded; D is listed only where its source moves
MODULE_LEVEL = "<module>"              # where top-level code is attributed
SCRIPT_LEVEL = "<script>"


@dataclass
class Problem:
    """One broken rule: a stable code, what it is about, and the facts a person needs to act on it."""
    code: str
    subject: str
    detail: str = ""


@dataclass
class Result:
    exit_code: int = EXIT_OK
    problems: list[Problem] = field(default_factory=list)
    data: dict = field(default_factory=dict)

    def fail(self, code: str, subject: str, detail: str = "") -> None:
        self.problems.append(Problem(code, subject, detail))
        self.exit_code = max(self.exit_code, EXIT_FAIL)

    def error(self, code: str, subject: str, detail: str = "") -> None:
        self.problems.append(Problem(code, subject, detail))
        self.exit_code = EXIT_ERROR


Lister = Callable[[Path], dict[str, set[str]]]   # root -> {language: test ids}


def read_toml(path: Path) -> dict:
    return tomllib.loads(path.read_text()) if path.exists() else {}


def write_report(root: Path, name: str, result: Result) -> Path:
    """The report of one command, as JSON: written whether the check passed or not."""
    path = root / REPORTS_DIR / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"exit_code": result.exit_code, "problems": [vars(p) for p in result.problems], **result.data}
    path.write_text(json.dumps(body, indent=JSON_INDENT, sort_keys=True) + "\n")
    return path


def qualified(language: str, test_id: str) -> str:
    return f"{language}:{test_id}"


# ---- register: every test under exactly one use case ----------------------------------------------------------------

def touched_languages(root: Path) -> set[str]:
    return {e["language"] for e in read_toml(root / TOUCHED_FILE).get("entry", [])}


def check_register(root: Path, lister: Lister) -> Result:
    """Every test the runners list is assigned to exactly one of the fourteen use cases, or is listed unfit with a decision."""
    result = Result()
    use_cases = set(read_toml(root / USE_CASES_FILE).get("use_cases", {}))
    assignments = read_toml(root / ASSIGNMENTS_FILE)
    unfit = assignments.get("unfit", [])
    listed_by_language = lister(root)
    listed = {qualified(lang, t) for lang, ids in listed_by_language.items() for t in ids}

    owners: dict[str, list[str]] = {}
    for use_case, tests in assignments.get("assignments", {}).items():
        if use_case not in use_cases:
            result.fail("E-UNKNOWN-USE-CASE", use_case, f"{len(tests)} test(s) assigned to it")
            continue
        for test in tests:
            owners.setdefault(test, []).append(use_case)

    for test, cases in sorted(owners.items()):
        if len(cases) > 1:
            result.fail("E-DUPLICATE", test, ", ".join(sorted(cases)))
        if test not in listed:
            result.fail("E-STALE", test, "assigned, but no runner lists it")

    unfit_tests = set()
    for entry in unfit:
        test = entry.get("test", "")
        unfit_tests.add(test)
        if entry.get("decision") not in UNFIT_DECISIONS or not entry.get("reason", "").strip():
            result.fail("E-UNFIT-NO-DECISION", test, "needs decision 'assign' or 'retire' and a reason")
        if test not in listed:
            result.fail("E-STALE", test, "listed unfit, but no runner lists it")

    for test in sorted(listed - set(owners) - unfit_tests):
        result.fail("E-UNASSIGNED", test, "in no use case and not listed unfit")

    for language in sorted(touched_languages(root)):
        if not listed_by_language.get(language):
            result.fail("E-NO-TESTS", language, "the touched set has files in this language and no runner lists a test")

    result.data = {"counts": {u: len(t) for u, t in sorted(assignments.get("assignments", {}).items()) if u in use_cases},
                   "unfit": [dict(e) for e in unfit]}
    write_report(root, "register", result)
    return result


# ---- touched set: derived from the code, checked on every run --------------------------------------------------------

@dataclass(frozen=True)
class Entry:
    language: str
    file: str
    function: str
    classes: list[str]


@dataclass
class Classes:
    sources: dict[str, list[str]]
    exclude: list[str]
    patterns: dict[str, list[re.Pattern]]
    workspace_functions: set[str]
    named: dict[str, list[str]]       # class -> ["file::function"] the design names, whether or not a pattern matches


def load_classes(root: Path) -> Classes:
    cfg = read_toml(root / CLASSES_FILE)
    sources = cfg.get("sources", {})
    classes = cfg.get("classes", {})
    return Classes(
        sources={lang: list(sources.get(lang, [])) for lang in LANGUAGES},
        exclude=list(sources.get("exclude", [])),
        patterns={name: [re.compile(p, re.S) for p in body.get("patterns", [])]
                  for name, body in classes.items() if name != WORKSPACE_CLASS},
        workspace_functions=set(classes.get(WORKSPACE_CLASS, {}).get("functions", [])),
        named={c: list(names) for c, names in cfg.get("named", {}).items()},
    )


def source_files(root: Path, cfg: Classes) -> list[tuple[str, str]]:
    found = []
    for language, globs in cfg.sources.items():
        for pattern in globs:
            for path in sorted(root.glob(pattern)):
                if path.is_file() and not any(fnmatch.fnmatch(path.name, x) for x in cfg.exclude):
                    found.append((language, path.relative_to(root).as_posix()))
    return found


@dataclass
class Func:
    name: str
    text: str


RUST_FN = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)")
TS_FN = re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(")
RUST_TEST_MODULE = re.compile(r"^#\[cfg\(test\)\]", re.M)   # the trailing test module and everything after it is test code
SHELL_FN = re.compile(r"^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{")


def python_functions(text: str) -> list[Func]:
    """Each def with its own lines (nested defs are separate functions); top-level code as <module>."""
    tree = ast.parse(text)
    lines = text.splitlines()
    defs: list[tuple[str, int, int]] = []

    def walk(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defs.append((prefix + child.name, child.lineno, child.end_lineno))
                walk(child, prefix)
            elif isinstance(child, ast.ClassDef):
                walk(child, prefix + child.name + ".")
            else:
                walk(child, prefix)

    walk(tree, "")
    claimed: dict[int, str] = {}
    for name, start, end in sorted(defs, key=lambda d: d[2] - d[1], reverse=True):   # outer first, inner overwrite
        for n in range(start, end + 1):
            claimed[n] = name
    own: dict[str, list[str]] = {name: [] for name, _, _ in defs}
    module_lines = []
    for n, line in enumerate(lines, start=1):
        if n in claimed:
            own[claimed[n]].append(line)
        else:
            module_lines.append(line)
    funcs = [Func(name, "\n".join(body)) for name, body in own.items()]
    funcs.append(Func(MODULE_LEVEL, "\n".join(module_lines)))
    return funcs


def boundary_functions(text: str, start: re.Pattern, top_level: str) -> list[Func]:
    """Rust, TypeScript and shell: a function runs from its definition line to the next definition line."""
    lines = text.splitlines()
    starts = []
    for n, line in enumerate(lines):
        m = start.match(line)
        if m:
            starts.append((n, next(g for g in m.groups() if g)))
    funcs = []
    head = lines[: starts[0][0]] if starts else lines
    funcs.append(Func(top_level, "\n".join(head)))
    for i, (n, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(lines)
        funcs.append(Func(name, "\n".join(lines[n:end])))
    return funcs


def functions_of(language: str, text: str) -> list[Func]:
    if language == "python":
        return python_functions(text)
    if language == "rust":
        return boundary_functions(RUST_TEST_MODULE.split(text, maxsplit=1)[0], RUST_FN, MODULE_LEVEL)
    if language == "typescript":
        return boundary_functions(text, TS_FN, MODULE_LEVEL)
    return boundary_functions(text, SHELL_FN, SCRIPT_LEVEL)


def scan(root: Path, cfg: Classes) -> dict[tuple[str, str], dict[str, list[str]]]:
    """{(language, file): {function: classes matched}} for every function in the source trees, matched or not."""
    out: dict[tuple[str, str], dict[str, list[str]]] = {}
    for language, rel in source_files(root, cfg):
        found: dict[str, list[str]] = {}
        for func in functions_of(language, (root / rel).read_text()):
            matched = {name for name, pats in cfg.patterns.items() if any(p.search(func.text) for p in pats)}
            matched |= {c for c, names in cfg.named.items() if f"{rel}::{func.name}" in names}
            matched = sorted(matched)
            found[func.name] = sorted(set(found.get(func.name, [])) | set(matched))
        out[(language, rel)] = found
    return out


def propose_touched(root: Path) -> list[Entry]:
    """One entry per function that matches a class pattern. Never written anywhere; never includes a class W function."""
    cfg = load_classes(root)
    entries = []
    for (language, rel), funcs in scan(root, cfg).items():
        for name, classes in funcs.items():
            if classes and name.split(".")[-1] not in cfg.workspace_functions:
                entries.append(Entry(language, rel, name, classes))
    return sorted(entries, key=lambda e: (e.language, e.file, e.function))


def check_touched(root: Path) -> Result:
    """The committed touched_set.toml equals the derivation after the owner's recorded decisions (excluded entries)."""
    result = Result()
    cfg = load_classes(root)
    known = set(cfg.patterns) | set(cfg.named) | {WORKSPACE_CLASS}
    touched = read_toml(root / TOUCHED_FILE)
    scanned = scan(root, cfg)
    listed = set()
    for e in touched.get("entry", []):
        key = (e["language"], e["file"], e["function"])
        subject = f"{e['file']}::{e['function']}"
        listed.add(key)
        for c in e.get("classes", []):
            if c not in known:
                result.fail("E-CLASS-UNKNOWN", subject, f"class {c}")
        if WORKSPACE_CLASS in e.get("classes", []) or e["function"].split(".")[-1] in cfg.workspace_functions:
            result.fail("E-W-IN-SET", subject, "workspace git is out of scope by decision")
        if e["function"] not in scanned.get((e["language"], e["file"]), {}):
            result.fail("E-STALE-ENTRY", subject, "no such function in the file")
        if "D" in e.get("classes", []) and not e.get("move", "").strip():
            result.fail("E-D-WITHOUT-MOVE", subject, "a class D entry needs a note of where its source moves to")
    for c, names in cfg.named.items():
        for name in names:
            file, _, function = name.partition("::")
            if not any(function in funcs for (_, rel), funcs in scanned.items() if rel == file):
                result.fail("E-NAMED-MISSING", name, f"class {c}: the design names a function that is not in the file")
    for e in touched.get("excluded", []):
        listed.add((e["language"], e["file"], e["function"]))
        if not e.get("reason", "").strip():
            result.fail("E-EXCLUDED-NO-REASON", f"{e['file']}::{e['function']}", "an excluded match needs a reason")
    for entry in propose_touched(root):
        if set(entry.classes) & set(CHECKED_CLASSES) and (entry.language, entry.file, entry.function) not in listed:
            result.fail("E-UNLISTED-MATCH", f"{entry.file}::{entry.function}", f"matches class {', '.join(entry.classes)}; list it or exclude it with a reason")
    write_report(root, "touched-set", result)
    return result


# ---- matrix: dimensions first, then one test per cell ---------------------------------------------------------------

def check_matrix(root: Path, use_case: str, lister: Lister) -> Result:
    """The cross product of the declared dimensions has exactly one test in every cell, and no cell outside it."""
    result = Result()
    path = root / MATRICES_DIR / f"{use_case}.toml"
    if not path.exists():
        result.fail("E-NO-MATRIX", use_case, f"no {path.relative_to(root)}")
        write_report(root, f"matrix-{use_case}", result)
        return result
    data = tomllib.loads(path.read_text())
    keys = list(data)                       # the file's own order: dimensions must come before cells
    cells = data.get("cell", [])
    dimensions = data.get("dimensions", {})
    if cells and (not dimensions or ("cell" in keys and "dimensions" in keys and keys.index("cell") < keys.index("dimensions"))):
        result.fail("E-NO-DIMENSIONS", use_case, "declare the dimensions before any cell")
        write_report(root, f"matrix-{use_case}", result)
        return result

    listed = {qualified(lang, t) for lang, ids in lister(root).items() for t in ids}
    names = list(dimensions)
    expected = {tuple(t) for t in itertools.product(*(dimensions[n] for n in names))}
    seen: dict[tuple, list[str]] = {}
    for cell in cells:
        at = tuple(cell.get("at", []))
        tests = list(cell.get("tests", [])) + ([cell["test"]] if "test" in cell else [])
        if at not in expected:
            result.fail("E-CELL-EXTRA", TUPLE_SEPARATOR.join(at), "not in the cross product of the declared dimensions")
            continue
        seen.setdefault(at, []).extend(tests)
    used = set()
    for at in sorted(expected):
        tests = seen.get(at, [])
        label = TUPLE_SEPARATOR.join(at)
        if not tests:
            result.fail("E-CELL-MISSING", label, "no test")
        elif len(tests) > 1:
            result.fail("E-CELL-MULTIPLE", label, ", ".join(tests))
        for test in tests:
            used.add(test)
            if test not in listed:
                result.fail("E-TEST-UNKNOWN", test, f"cell {label}: no runner lists it")
    result.data = {"cells": len(expected), "tests": len(used), "dimensions": names}
    write_report(root, f"matrix-{use_case}", result)
    return result


# ---- stage: the method's stages happen in order, each move justified by the check that earns it -------------------

# every allowed move, with the checks that justify it (names for the record; the checks are wired in default_justifiers)
ALLOWED_MOVES: dict[tuple[str, str], str] = {
    ("Inventory", "Matrices"): "check-register, check-touched-set",
    ("Matrices", "Proved"): "check-matrix U1 to U14, check-coverage",
    ("Proved", "Deleted"): "check-stubs",
    BACK_EDGE: "report-deletion: an assigned test passed",
    ("Deleted", "RedContracts"): "report-deletion, check-fates",
    ("RedContracts", "Reimplemented"): "the whole suite is green",
    ("Reimplemented", "Compared"): "reports/parity.json written by the parity story",
}

Justifier = Callable[[Path], Result]


class StageFileCorrupt(Exception):
    pass


def atomic_write(path: Path, text: str) -> None:
    """Write to a temporary file in the same folder, then rename over the target: never a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    with open(tmp, "w") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def read_stage(root: Path) -> str:
    path = root / STAGE_FILE
    if not path.exists():
        return STAGES[0]
    try:
        return tomllib.loads(path.read_text())["stage"]
    except (tomllib.TOMLDecodeError, KeyError) as exc:
        raise StageFileCorrupt(str(exc)) from exc


def render_stage(stage: str, moves: list[dict]) -> str:
    lines = [f'stage = "{stage}"', ""]
    for m in moves:
        lines += ["[[move]]", f'from = "{m["from"]}"', f'to = "{m["to"]}"', f'at = "{m["at"]}"', f'justified_by = "{m["justified_by"]}"', ""]
    return "\n".join(lines)


def record_move(root: Path, current: str, to: str, justified_by: str, now: datetime | None = None) -> None:
    path = root / STAGE_FILE
    moves = read_toml(path).get("move", []) if path.exists() else []
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    moves.append({"from": current, "to": to, "at": stamp, "justified_by": justified_by})
    atomic_write(path, render_stage(to, moves))


def move_stage(root: Path, to: str, justifiers: dict[tuple[str, str], Justifier], now: datetime | None = None) -> Result:
    """Move to the next stage if, and only if, the check that justifies the move passes. A stage is never skipped."""
    result = Result()
    if to not in STAGES:
        result.fail("E-UNKNOWN-STAGE", to, f"stages: {', '.join(STAGES)}")
        return result
    try:
        current = read_stage(root)
    except StageFileCorrupt as exc:
        result.fail("E-STAGE-FILE-CORRUPT", str(STAGE_FILE), f"{exc}; the file is left as it is")
        return result
    move = (current, to)
    if move not in ALLOWED_MOVES:
        result.fail("E-SKIP", f"{current} -> {to}", "the allowed moves are one stage forward, and Deleted back to Proved")
        return result
    if move != BACK_EDGE:
        checked = justifiers[move](root)
        if checked.exit_code != EXIT_OK:
            result.fail("E-NOT-JUSTIFIED", f"{current} -> {to}", "; ".join(f"{p.code} {p.subject}" for p in checked.problems))
            return result
    record_move(root, current, to, ALLOWED_MOVES[move], now)
    result.data = {"from": current, "to": to}
    return result


# ---- stubs and the deletion report ----------------------------------------------------------------------------------

@dataclass
class Results:
    """What the runners reported for one run against the stubs: outcome per qualified test id, and languages with no result file."""
    outcomes: dict[str, str] = field(default_factory=dict)
    missing: set[str] = field(default_factory=set)


RUST_STUB = re.compile(r"^(?:todo|unimplemented)!\s*\(.*\)\s*;?$", re.S)
TS_STUB = re.compile(r"^throw\s+new\s+Error\s*\(.*\)\s*;?$", re.S)
SHELL_STUB_CODE = 99      # the exit/return status of every shell stub
SHELL_STUB = re.compile(rf"^return\s+{SHELL_STUB_CODE}\s*;?$")
SCRIPT_STUB = re.compile(rf"^exit\s+{SHELL_STUB_CODE}\s*;?$")


def brace_body(text: str) -> str | None:
    """The text between the first { and its matching }; None when there is none."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return text[start + 1:i].strip()
    return None


def python_is_stub(text: str, name: str) -> bool | None:
    """True/False for the named def; None when there is no such def."""
    parts = name.split(".")
    scope: list[ast.AST] = [ast.parse(text)]
    node: ast.AST | None = None
    for part in parts:
        node = next((c for s in scope for c in ast.iter_child_nodes(s)
                     if isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and c.name == part), None)
        if node is None:
            return None
        scope = [node]
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or len(node.body) != 1 or not isinstance(node.body[0], ast.Raise):
        return False if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
    exc = node.body[0].exc
    exc = exc.func if isinstance(exc, ast.Call) else exc
    return isinstance(exc, ast.Name) and exc.id == "NotImplementedError"


def is_stub(language: str, text: str, name: str) -> bool | None:
    if language == "python":
        return python_is_stub(text, name)
    if language == "shell" and name == SCRIPT_LEVEL:
        code = [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith("#")]
        return len(code) == 1 and bool(SCRIPT_STUB.match(code[0]))     # a script with no functions: the whole body is `exit 99`
    func = next((f for f in functions_of(language, text) if f.name == name), None)
    if func is None:
        return None
    body = brace_body(func.text)
    pattern = {"rust": RUST_STUB, "typescript": TS_STUB, "shell": SHELL_STUB}[language]
    return body is not None and bool(pattern.match(body))


def check_stubs(root: Path) -> Result:
    """Every function in the touched set has been replaced by hand with a stub of the exact form for its language."""
    result = Result()
    for e in read_toml(root / TOUCHED_FILE).get("entry", []):
        subject = f"{e['file']}::{e['function']}"
        path = root / e["file"]
        verdict = is_stub(e["language"], path.read_text(), e["function"]) if path.exists() else None
        if verdict is None:
            result.fail("E-STALE-ENTRY", subject, "no such function in the file")
        elif not verdict:
            result.fail("E-NOT-STUB", subject, "the body is not exactly a stub")
    write_report(root, "stubs", result)
    return result


def assigned_tests(root: Path) -> set[str]:
    return {t for tests in read_toml(root / ASSIGNMENTS_FILE).get("assignments", {}).values() for t in tests}


def report_deletion(root: Path, results: Results) -> Result:
    """Against the stubs every assigned test must fail for the stub's reason, and every test outside the set must not fail."""
    stubs = check_stubs(root)
    if stubs.exit_code != EXIT_OK:
        write_report(root, "deletion", stubs)
        return stubs
    result = Result()
    assigned = assigned_tests(root)
    unfit = {e.get("test") for e in read_toml(root / ASSIGNMENTS_FILE).get("unfit", [])}
    for language in sorted(results.missing):
        result.fail("E-RESULTS-MISSING", language, "the runner produced no result file, so no test can be counted as failed")
    passed_assigned = False
    for test in sorted(assigned):
        if test.split(":", 1)[0] in results.missing:
            continue
        outcome = results.outcomes.get(test)
        if outcome is None:
            result.fail("E-RESULTS-MISSING", test, "no result for an assigned test")
        elif outcome == PASSED:
            passed_assigned = True
            result.fail("E-ASSIGNED-PASSED", test, "the test passes against the stubs: rewrite it")
        elif outcome == FAILED_OTHER:
            result.fail("E-STUB-FAILS-TO-IMPORT", test, "it failed, but not for the stub's reason: a broken import proves nothing about assertions")
    for test, outcome in sorted(results.outcomes.items()):
        if test not in assigned and test not in unfit and outcome in (FAILED_STUB, FAILED_OTHER):
            result.fail("E-OUTSIDE-FAILED", test, "a test outside the touched set failed: the partition is not MECE")
    if passed_assigned and read_stage(root) == "Deleted":
        record_move(root, "Deleted", "Proved", ALLOWED_MOVES[BACK_EDGE])
    if result.exit_code == EXIT_OK:
        result.data = {"assigned_failed": sorted(assigned)}
    write_report(root, "deletion", result)
    return result


# ---- fates: every assigned test ends in exactly one state -----------------------------------------------------------

FATE_STATES = ("kept", "rewritten", "retired")
FATES_FILE = REFACTOR_DIR / "fates.toml"


def check_fates(root: Path) -> Result:
    """Each assigned test is kept unchanged, rewritten to the new contract, or retired together with a touched function."""
    result = Result()
    assigned = assigned_tests(root)
    touched = {f"{e['file']}::{e['function']}" for e in read_toml(root / TOUCHED_FILE).get("entry", [])}
    seen: dict[str, int] = {}
    counts = {state: 0 for state in FATE_STATES}
    for fate in read_toml(root / FATES_FILE).get("fate", []):
        test, state = fate.get("test", ""), fate.get("state", "")
        seen[test] = seen.get(test, 0) + 1
        if test not in assigned:
            result.fail("E-FATE-UNKNOWN-TEST", test, "not an assigned test")
            continue
        if state not in FATE_STATES:
            result.fail("E-FATE-STATE", test, f"{state!r}: states are {', '.join(FATE_STATES)}")
            continue
        counts[state] += 1
        if state == "rewritten" and not fate.get("new_test"):
            result.fail("E-FATE-NO-NEW-TEST", test, "a rewritten test names the test that replaces it")
        if state == "retired":
            if fate.get("function") not in touched:
                result.fail("E-FATE-RETIRED-NO-FUNCTION", test, "a retired test names the touched function retired with it")
            if not fate.get("reason"):
                result.fail("E-FATE-RETIRED-NO-REASON", test, "a retired test gives the reason")
    for test in sorted(assigned):
        if test not in seen:
            result.fail("E-FATE-MISSING", test, "no fate")
    for test, n in sorted(seen.items()):
        if n > 1 and test in assigned:
            result.fail("E-FATE-MULTIPLE", test, f"{n} fates")
    result.data = {"counts": counts}
    write_report(root, "fates", result)
    return result


# ---- coverage proof: 100% of lines and branches of every touched file -----------------------------------------------

@dataclass
class FileCoverage:
    lines: int
    lines_hit: int
    branches: int
    branches_hit: int


Measured = dict[str, dict[str, FileCoverage]]   # language -> file -> coverage, as the language's own tool reported it


def check_coverage(root: Path, measured: Measured) -> Result:
    """Fail on any missed line or branch; a touched file the coverage tool did not report is undecidable, never a pass."""
    result = Result()
    files = sorted({(e["language"], e["file"]) for e in read_toml(root / TOUCHED_FILE).get("entry", [])})
    for language, file in files:
        cov = measured.get(language, {}).get(file)
        if cov is None:
            result.error("E-COVERAGE-UNKNOWN", file, f"{language}: the coverage tool reported nothing for this file")
            continue
        if cov.lines_hit < cov.lines:
            result.fail("E-LINES-UNCOVERED", file, f"{cov.lines_hit} of {cov.lines} lines")
        if cov.branches_hit < cov.branches:
            result.fail("E-BRANCHES-UNCOVERED", file, f"{cov.branches_hit} of {cov.branches} branches")
    write_report(root, "coverage", result)
    return result


# ---- idle guard: nothing moves on a machine that is running a story -------------------------------------------------

def check_idle(probe: Callable[[], list[str] | None]) -> Result:
    """The probe lists running stories, or returns None when it cannot tell; an unknown is never idle."""
    result = Result()
    running = probe()
    if running is None:
        result.error("E-IDLE-UNKNOWN", "machine", "the probe could not tell whether a story is running")
    for story in running or []:
        result.fail("E-MACHINE-BUSY", story, "a story is running: nothing moves until it ends")
    return result


# ---- python adapter: which tests execute a touched function (coverage contexts) --------------------------------------

class AdapterError(Exception):
    """A runner's output cannot be read: the command turns this into exit 2, never a pass."""


CONTEXT_PHASE = "|run"        # coverage's per-test context is "<nodeid>|run", "|setup" or "|teardown"


def python_function_lines(text: str, name: str) -> set[int] | None:
    """Lines from the def line through its last line, named as the scan names it (class prefixes only; a nested def
    keeps its plain name); a class name alone gives the whole class. None if absent."""
    def walk(node: ast.AST, prefix: str) -> set[int] | None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                full = prefix + child.name
                if full == name:
                    return set(range(child.lineno, child.end_lineno + 1))
                found = walk(child, full + "." if isinstance(child, ast.ClassDef) else prefix)
            else:
                found = walk(child, prefix)
            if found is not None:
                return found
        return None
    return walk(ast.parse(text), "")


def tests_touching(contexts: dict[str, list[str]], lines: set[int]) -> set[str]:
    """Qualified ids of the tests whose run phase executed any of the lines."""
    found = set()
    for line, names in contexts.items():
        if int(line) in lines:
            found |= {qualified("python", n[: -len(CONTEXT_PHASE)]) for n in names if n.endswith(CONTEXT_PHASE)}
    return found


def python_touching_tests(root: Path, coverage: dict) -> set[str]:
    """Union over the touched Python functions; a touched file the coverage data lacks makes the answer unknowable."""
    found: set[str] = set()
    for e in read_toml(root / TOUCHED_FILE).get("entry", []):
        if e["language"] != "python":
            continue
        data = coverage.get("files", {}).get(e["file"])
        if data is None:
            raise AdapterError(f"{e['file']}: no coverage data (the file was never imported by the run)")
        lines = python_function_lines((root / e["file"]).read_text(), e["function"])
        if lines is None:
            raise AdapterError(f"{e['file']}::{e['function']}: no such function")
        found |= tests_touching(data.get("contexts", {}), lines)
    return found


TOUCHED_TESTS = REPORTS_DIR / "touched-tests.json"   # {language: [test ids]} written by the adapters, one language at a time


def list_tests(root: Path) -> dict[str, set[str]]:
    """The tests that execute the touched set, as the per-language adapters last wrote them."""
    path = root / TOUCHED_TESTS
    if not path.exists():
        raise AdapterError(f"{TOUCHED_TESTS} does not exist: run the adapters (adapt-python, ...) first")
    return {language: set(ids) for language, ids in json.loads(path.read_text()).items()}


def adapt_python(root: Path, sources: list[tuple[str, Path]]) -> Result:
    """Read `coverage json --show-contexts` outputs, one per folder a run was made in (file keys and test ids are relative
    to that folder, so both get the folder as a prefix), and store the Python tests that execute the touched functions.
    Nothing is written unless every touched file was measured."""
    result = Result()
    merged_files: dict[str, dict] = {}
    for prefix, coverage_json in sources:
        for file, body in json.loads(coverage_json.read_text()).get("files", {}).items():
            contexts = {line: [prefix + n if n else n for n in names] for line, names in body.get("contexts", {}).items()}
            merged_files[prefix + file] = {"contexts": contexts}
    try:
        tests = python_touching_tests(root, {"files": merged_files})
    except AdapterError as exc:
        result.error("E-ADAPTER", "coverage", str(exc))
        return result
    path = root / TOUCHED_TESTS
    current = json.loads(path.read_text()) if path.exists() else {}
    current["python"] = sorted(t.split(":", 1)[1] for t in tests)
    atomic_write(path, json.dumps(current, indent=JSON_INDENT, sort_keys=True) + "\n")
    result.data = {"python": len(tests)}
    return result


FILE_USE_CASE_FILE = REFACTOR_DIR / "file_use_case.toml"   # [language] "<test file>" = "U<n>": the reviewed table behind assignments.toml


def toml_string(value: str) -> str:
    return json.dumps(value)        # a JSON string is a valid TOML basic string


def render_assignments(assigned: dict[str, list[str]], unfit: list[dict]) -> str:
    lines = ["# Written by `refactor.py assign-by-file` from file_use_case.toml; unfit entries are kept as recorded.", "", "[assignments]"]
    for use_case in sorted(assigned):
        body = ", ".join(toml_string(t) for t in sorted(assigned[use_case]))
        lines.append(f"{use_case} = [{body}]")
    for entry in unfit:
        lines += ["", "[[unfit]]"] + [f"{k} = {toml_string(v)}" for k, v in entry.items()]
    return "\n".join(lines) + "\n"


def assign_by_file(root: Path) -> Result:
    """Every touched test goes to the use case of its test file; a test file with no entry, or an entry naming an unknown
    use case, stops the whole step with assignments.toml untouched. Tests already listed unfit are left to that list."""
    result = Result()
    use_cases = set(read_toml(root / USE_CASES_FILE).get("use_cases", {}))
    table = read_toml(root / FILE_USE_CASE_FILE)
    unfit = read_toml(root / ASSIGNMENTS_FILE).get("unfit", [])
    unfit_tests = {e.get("test") for e in unfit}
    for language, files in table.items():
        for file, use_case in files.items():
            if use_case not in use_cases:
                result.fail("E-UNKNOWN-USE-CASE", f"{language}:{file}", use_case)
    assigned: dict[str, list[str]] = {}
    for language, ids in sorted(list_tests(root).items()):
        for test_id in sorted(ids):
            test = qualified(language, test_id)
            if test in unfit_tests:
                continue
            parts = test_id.split("::")
            keys = ["::".join(parts[:n]) for n in range(len(parts) - 1, 0, -1)]      # the longest prefix first
            use_case = next((table[language][k] for k in keys if k in table.get(language, {})), None)
            if use_case is None:
                result.fail("E-FILE-UNMAPPED", parts[0], f"{language}: no entry in {FILE_USE_CASE_FILE}")
            elif use_case in use_cases:
                assigned.setdefault(use_case, []).append(test)
    if result.exit_code == EXIT_OK:
        atomic_write(root / ASSIGNMENTS_FILE, render_assignments(assigned, unfit))
        result.data = {"counts": {u: len(t) for u, t in sorted(assigned.items())}}
    write_report(root, "assign-by-file", result)
    return result


# ---- rust adapter: which tests belong to the touched files ------------------------------------------------------------

RUST_RUNNING = re.compile(r"^\s*Running (unittests )?(\S+) \(target/debug/deps/([A-Za-z0-9_]+?)-[0-9a-f]+\)")
RUST_TEST_LINE = re.compile(r"^(\S+): test$")
RUST_SKIP_STEMS = {"main", "lib", "mod"}


def rust_module_file(root: Path, crate_dir: str, entry_file: str, module: list[str]) -> str | None:
    """The source file that holds a unit test's module: the longest module prefix that has a file (the rest is inline)."""
    if not module:
        return f"{crate_dir}/{entry_file}"
    for end in range(len(module), 0, -1):
        base = f"{crate_dir}/src/{'/'.join(module[:end])}"
        for candidate in (f"{base}.rs", f"{base}/mod.rs"):
            if (root / candidate).exists():
                return candidate
    return None


def rust_touching_tests(root: Path, listing: str) -> set[str]:
    """Tests of `cargo test -- --list` output that belong to a touched file: a unit test by its module's file, an
    integration test by whether its text names a touched module. A static rule; report-deletion corrects it with facts."""
    touched_files = {e["file"] for e in read_toml(root / TOUCHED_FILE).get("entry", []) if e["language"] == "rust"}
    stems = {Path(f).stem if Path(f).stem not in RUST_SKIP_STEMS else Path(f).parent.name for f in touched_files}
    found: set[str] = set()
    crate_dir, kind, entry_file, integration_text = "", "", "", ""
    for line in listing.splitlines():
        running = RUST_RUNNING.match(line)
        if running:
            unit, entry_file, binary = running.group(1), running.group(2), running.group(3)
            if unit:
                crate_dir = f"tools/{binary.replace('_', '-')}"
                if not (root / crate_dir).is_dir():
                    raise AdapterError(f"{crate_dir}: no such crate folder (binary {binary})")
            kind = "unit" if unit else "integration"
            integration_text = "" if unit else (root / crate_dir / entry_file).read_text() if (root / crate_dir / entry_file).exists() else ""
            continue
        test = RUST_TEST_LINE.match(line)
        if not test or not kind:
            continue
        name = test.group(1)
        if kind == "unit":
            segments = name.split("::")
            module = segments[: segments.index("tests")] if "tests" in segments else segments[:-1]
            file = rust_module_file(root, crate_dir, entry_file, module)
            if file is None:
                raise AdapterError(f"{crate_dir}: no source file for the module of test {name}")
            if file in touched_files:
                found.add(f"{crate_dir}/{entry_file}::{name}")
        elif any(re.search(rf"\b{re.escape(stem)}\b", integration_text) for stem in stems):
            found.add(f"{crate_dir}/{entry_file}::{name}")
    return found


def adapt_rust(root: Path, listing: Path) -> Result:
    result = Result()
    try:
        tests = rust_touching_tests(root, listing.read_text())
    except AdapterError as exc:
        result.error("E-ADAPTER", str(listing), str(exc))
        return result
    path = root / TOUCHED_TESTS
    current = json.loads(path.read_text()) if path.exists() else {}
    current["rust"] = sorted(tests)
    atomic_write(path, json.dumps(current, indent=JSON_INDENT, sort_keys=True) + "\n")
    result.data = {"rust": len(tests)}
    return result


# ---- typescript adapter: vitest list and playwright list -----------------------------------------------------------------

PLAYWRIGHT_LINE = re.compile(r"^\s+(\S+\.(?:spec|test)\.ts):\d+:\d+ › (.+)$")
E2E_DIR_DEFAULT = "tools/benchmarker/e2e"


def typescript_touching_tests(root: Path, vitest_json: str, playwright_list: str, e2e_dir: str = E2E_DIR_DEFAULT) -> set[str]:
    """Vitest tests whose file is named for, or imports, a touched module; every Playwright test, because each one drives the
    whole app through the server. A static rule; report-deletion corrects it with facts."""
    stems = {Path(e["file"]).stem for e in read_toml(root / TOUCHED_FILE).get("entry", []) if e["language"] == "typescript"}
    root_resolved = root.resolve()
    found: set[str] = set()
    touching: dict[str, bool] = {}
    for row in json.loads(vitest_json):
        try:
            rel = Path(row["file"]).resolve().relative_to(root_resolved).as_posix()
        except ValueError:
            raise AdapterError(f"{row['file']}: a vitest file outside the repository") from None
        if rel not in touching:
            text = (root / rel).read_text() if (root / rel).exists() else ""
            named = Path(rel).name.split(".")[0] in stems
            imported = any(re.search(rf"""["'](?:[^"']*/)?{re.escape(stem)}(?:\.ts)?["']""", text) for stem in stems)
            touching[rel] = named or imported
        if touching[rel]:
            found.add(f"{rel}::{row['name']}")
    for line in playwright_list.splitlines():
        m = PLAYWRIGHT_LINE.match(line)
        if m:
            found.add(f"{e2e_dir}/{m.group(1)}::{m.group(2)}")
    return found


def adapt_typescript(root: Path, vitest_json: Path, playwright_list: Path, e2e_dir: str) -> Result:
    result = Result()
    try:
        tests = typescript_touching_tests(root, vitest_json.read_text(), playwright_list.read_text(), e2e_dir)
    except AdapterError as exc:
        result.error("E-ADAPTER", str(vitest_json), str(exc))
        return result
    path = root / TOUCHED_TESTS
    current = json.loads(path.read_text()) if path.exists() else {}
    current["typescript"] = sorted(tests)
    atomic_write(path, json.dumps(current, indent=JSON_INDENT, sort_keys=True) + "\n")
    result.data = {"typescript": len(tests)}
    return result


# ---- inputs the runners' adapters write (neutral JSON), and the machine probe -------------------------------------------

COVERAGE_INPUT = REPORTS_DIR / "coverage-input.json"   # {language: {file: [lines, lines_hit, branches, branches_hit]}}
RESULTS_INPUT = REPORTS_DIR / "results-input.json"     # {"outcomes": {qualified test id: outcome}, "missing": [language]}
PARITY_REPORT = REPORTS_DIR / "parity.json"
IDLE_PROBE_ENV = "REFACTOR_IDLE_PROBE"                 # a command that prints one running story per line


def load_measured(root: Path) -> Measured:
    path = root / COVERAGE_INPUT
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    return {lang: {file: FileCoverage(*counts) for file, counts in files.items()} for lang, files in raw.items()}


def load_results(root: Path) -> Results | None:
    path = root / RESULTS_INPUT
    if not path.exists():
        return None
    raw = json.loads(path.read_text())
    return Results(outcomes=raw.get("outcomes", {}), missing=set(raw.get("missing", [])))


def probe_running_stories() -> list[str] | None:
    """Running stories on this machine, or None when it cannot be told (no probe command configured, or it failed)."""
    command = os.environ.get(IDLE_PROBE_ENV)
    if not command:
        return None
    done = subprocess.run(command, shell=True, capture_output=True, text=True)
    return [line for line in done.stdout.splitlines() if line.strip()] if done.returncode == 0 else None


def merged(*results: Result) -> Result:
    out = Result()
    for r in results:
        out.exit_code = max(out.exit_code, r.exit_code)
        out.problems += r.problems
    return out


def default_justifiers(lister: Lister) -> dict[tuple[str, str], Justifier]:
    def matrices(root: Path) -> Result:
        return merged(*(check_matrix(root, u, lister) for u in read_toml(root / USE_CASES_FILE).get("use_cases", {})))

    def red_contracts(root: Path) -> Result:
        report = root / REPORTS_DIR / "deletion.json"
        held = Result()
        if not report.exists() or json.loads(report.read_text()).get("exit_code") != EXIT_OK:
            held.fail("E-NO-DELETION-REPORT", str(report.relative_to(root)), "report-deletion has not passed")
        return merged(held, check_fates(root))

    def suite_green(root: Path) -> Result:
        found = Result()
        results = load_results(root)
        if results is None:
            found.error("E-RESULTS-MISSING", str(RESULTS_INPUT), "no suite result to read")
        elif results.missing or any(o != PASSED for o in results.outcomes.values()):
            found.fail("E-SUITE-NOT-GREEN", str(RESULTS_INPUT), "the whole suite must pass")
        return found

    def parity(root: Path) -> Result:
        found = Result()
        path = root / PARITY_REPORT
        if not path.exists() or json.loads(path.read_text()).get("exit_code") != EXIT_OK:
            found.fail("E-NO-PARITY", str(PARITY_REPORT), "the comparison has not passed")
        return found

    return {
        ("Inventory", "Matrices"): lambda root: merged(check_register(root, lister), check_touched(root)),
        ("Matrices", "Proved"): lambda root: merged(matrices(root), check_coverage(root, load_measured(root))),
        ("Proved", "Deleted"): check_stubs,
        ("Deleted", "RedContracts"): red_contracts,
        ("RedContracts", "Reimplemented"): suite_green,
        ("Reimplemented", "Compared"): parity,
    }


# ---- command line -----------------------------------------------------------------------------------------------------

def print_result(name: str, result: Result) -> None:
    status = {EXIT_OK: "ok", EXIT_FAIL: "FAILED", EXIT_ERROR: "UNDECIDED"}[result.exit_code]
    print(f"{name}: {status}")
    for p in result.problems:
        print(f"  {p.code}  {p.subject}  {p.detail}".rstrip())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="the repository root (default: the current directory)")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (("check-register", "every test in exactly one use case"),
                       ("propose-touched", "print the touched set the scan derives"),
                       ("check-touched", "the committed touched set equals the scan"),
                       ("check-stubs", "every touched function is a stub"),
                       ("check-fates", "every assigned test has exactly one fate"),
                       ("check-coverage", f"100% line and branch coverage from {COVERAGE_INPUT}"),
                       ("report-deletion", f"every assigned test failed against the stubs, from {RESULTS_INPUT}"),
                       ("check-idle", "no story is running on this machine"),
                       ("stage", "print the current stage")):
        sub.add_parser(name, help=text)
    sub.add_parser("check-matrix", help="one use case's matrix is a full cross-product with one test per cell").add_argument("use_case")
    sub.add_parser("advance", help="move to the next stage if its check passes").add_argument("to")
    sub.add_parser("assign-by-file", help=f"expand {FILE_USE_CASE_FILE} into assignments.toml")
    sub.add_parser("adapt-rust", help="store the Rust tests of the touched files, from `cargo test --workspace -- --list` output").add_argument("listing", type=Path)
    ts = sub.add_parser("adapt-typescript", help="store the TypeScript tests of the touched files, from `vitest list --json` and `playwright test --list`")
    ts.add_argument("vitest_json", type=Path)
    ts.add_argument("playwright_list", type=Path)
    ts.add_argument("--e2e-dir", default=E2E_DIR_DEFAULT)
    adapt = sub.add_parser("adapt-python", help="store the Python tests that execute the touched set, from coverage contexts")
    adapt.add_argument("sources", nargs="+", metavar="FOLDER=FILE",
                       help="the folder (relative to the repository root, with a trailing /) a coverage run was made in, and its JSON")
    args = parser.parse_args(argv)
    root = args.root
    lister = list_tests                                   # looked up at call time so tests can replace it
    simple = {
        "check-register": lambda: check_register(root, lister),
        "check-touched": lambda: check_touched(root),
        "check-stubs": lambda: check_stubs(root),
        "check-fates": lambda: check_fates(root),
        "check-coverage": lambda: check_coverage(root, load_measured(root)),
        "check-idle": lambda: check_idle(probe_running_stories),
    }
    try:
        if args.command == "stage":
            print(read_stage(root))
            return EXIT_OK
        if args.command == "propose-touched":
            for e in propose_touched(root):
                print(f"{e.language}  {e.file}::{e.function}  {','.join(e.classes)}")
            return EXIT_OK
        if args.command == "check-matrix":
            result = check_matrix(root, args.use_case, lister)
        elif args.command == "report-deletion":
            results = load_results(root)
            if results is None:
                result = Result()
                result.error("E-RESULTS-MISSING", str(RESULTS_INPUT), "no results to read")
            else:
                result = report_deletion(root, results)
        elif args.command == "adapt-typescript":
            result = adapt_typescript(root, args.vitest_json, args.playwright_list, args.e2e_dir)
        elif args.command == "adapt-rust":
            result = adapt_rust(root, args.listing)
        elif args.command == "assign-by-file":
            result = assign_by_file(root)
        elif args.command == "adapt-python":
            result = adapt_python(root, [(folder, Path(file)) for folder, _, file in (src.partition("=") for src in args.sources)])
        elif args.command == "advance":
            result = move_stage(root, args.to, default_justifiers(lister))
        else:
            result = simple[args.command]()
    except AdapterError as exc:
        print(f"{args.command}: UNDECIDED\n  E-ADAPTER  {exc}")
        return EXIT_ERROR
    except StageFileCorrupt as exc:
        print(f"{STAGE_FILE}: corrupt, left as it is: {exc}")
        return EXIT_ERROR
    print_result(args.command, result)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
