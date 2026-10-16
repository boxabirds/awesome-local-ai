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
import difflib
import fnmatch
import functools
import hashlib
import itertools
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tomllib
from xml.etree import ElementTree
from datetime import datetime, timezone
from collections import Counter
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
STAR = "*"               # in a matrix row: every value of this dimension
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
TESTS_LEVEL = "<tests>"                # the trailing #[cfg(test)] module of a Rust file: not production code, and not the file's top level


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
    every_test = getattr(lister, "all", listed_by_language)         # a lister that narrows keeps the full list on .all
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
                   "unfit": [dict(e) for e in unfit],
                   "listed": {lang: sorted(ids) for lang, ids in sorted(every_test.items())},
                   "touching": {lang: sorted(ids) for lang, ids in sorted(listed_by_language.items())}}
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
    start: int = 1          # the line the function starts on (1-based); python_functions leaves it at 1 (it only keeps own lines)


RUST_FN = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)")
TS_FN = re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(")
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
        funcs.append(Func(name, "\n".join(lines[n:end]), start=n + 1))
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


def audit_step(root: Path, entries: list[dict], result: Result, grep, snapshot) -> None:
    """The touched set equals the protected hits of the final audit. Without a final audit nothing is compared."""
    audit = check_audit(root, require_final=True, grep=grep, snapshot=snapshot)
    for p in audit.problems:
        if p.code in (NO_AUDIT_CODES):
            result.fail("E-NO-FINAL-AUDIT", p.subject, f"{p.code}: {p.detail}")
        else:
            result.fail(p.code, p.subject, p.detail)
    if audit.exit_code == EXIT_OK:
        problems, counts = compare_audit_to_set([parse_pass(f) for f in pass_files(root)], entries)
        result.data["audit_counts"] = counts
        for p in problems:
            result.fail(p.code, p.subject, p.detail)


def check_touched(root: Path, grep=None, snapshot=None) -> Result:
    """The committed touched_set.toml equals the final audit and, as a cross-check, the derivation after the owner's recorded decisions
    (excluded entries). A repository with no audit folder is checked by the derivation alone."""
    result = Result()
    cfg = load_classes(root)
    known = set(cfg.patterns) | set(cfg.named) | {WORKSPACE_CLASS}
    touched = read_toml(root / TOUCHED_FILE)
    if (root / AUDIT_DIR).is_dir():
        audit_step(root, touched.get("entry", []), result, grep or git_grep, snapshot or tree_snapshot)
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

def raw_tuple_count(dimensions: dict[str, list[str]]) -> int:
    """How many cells the cross product of the declared dimensions has (before any impossible cell is considered)."""
    return len(list(itertools.product(*dimensions.values())))


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
        at = list(cell.get("at", []))
        tests = list(cell.get("tests", [])) + ([cell["test"]] if "test" in cell else [])
        if len(at) != len(names):
            result.fail("E-CELL-EXTRA", TUPLE_SEPARATOR.join(at), "not one value for each declared dimension")
            continue
        # a "*" stands for every value of its dimension: the row covers all of those tuples
        tuples = [tuple(t) for t in itertools.product(*(dimensions[n] if v == STAR else [v] for n, v in zip(names, at)))]
        for t in tuples:
            if t not in expected:
                result.fail("E-CELL-EXTRA", TUPLE_SEPARATOR.join(t), "not in the cross product of the declared dimensions")
            else:
                seen.setdefault(t, []).extend(tests)
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
    result.data = {"cells": len(expected), "rows": len(cells), "tests": len(used), "dimensions": names}
    write_report(root, f"matrix-{use_case}", result)
    return result


# ---- stage: the method's stages happen in order, each move justified by the check that earns it -------------------

# every allowed move, with the checks that justify it (names for the record; the checks are wired in default_justifiers)
ALLOWED_MOVES: dict[tuple[str, str], str] = {
    ("Inventory", "Matrices"): "check-register, check-touched-set",
    ("Matrices", "Proved"): "check-matrix (the use cases use_cases.toml requires), check-coverage",
    ("Proved", "Deleted"): "check-stubs",
    BACK_EDGE: "report-deletion: an assigned test passed",
    ("Deleted", "RedContracts"): "report-deletion, fates (every old test has a fate; every new contract test seen red)",
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


def render_stage(stage: str, moves: list[dict], proved: dict | None = None) -> str:
    lines = [f"stage = {json.dumps(stage)}", ""]
    if proved:
        lines += ["[proved_members]", f"digest = {json.dumps(proved['digest'])}", f"count = {proved['count']}", "members = ["]
        lines += [f"  {json.dumps(m)}," for m in proved["members"]] + ["]", ""]
    for m in moves:
        lines += ["[[move]]", f'from = {json.dumps(m["from"])}', f'to = {json.dumps(m["to"])}', f'at = {json.dumps(m["at"])}', f'justified_by = {json.dumps(m["justified_by"])}', ""]
    return "\n".join(lines)


KEEP_PROOF = "keep"       # record_move: leave the recorded proof as it is


def record_move(root: Path, current: str, to: str, justified_by: str, now: datetime | None = None, proved: dict | None | str = KEEP_PROOF) -> None:
    """Write the new stage and the move that led to it in one atomic write; `proved` is the proof recorded with it (kept, replaced or dropped)."""
    path = root / STAGE_FILE
    old = read_toml(path) if path.exists() else {}
    moves = old.get("move", [])
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    moves.append({"from": current, "to": to, "at": stamp, "justified_by": justified_by})
    atomic_write(path, render_stage(to, moves, old.get("proved_members") if proved == KEEP_PROOF else proved))


def member_identities(entries: list[dict]) -> list[str]:
    """The places the touched set protects, as file::function, sorted: what a proof is about (not the language or the classes)."""
    return sorted({f"{e['file']}::{e['function']}" for e in entries})


def members_digest(entries: list[dict]) -> str:
    return hashlib.sha256("\n".join(member_identities(entries)).encode()).hexdigest()


def proof_of(entries: list[dict]) -> dict:
    members = member_identities(entries)
    return {"digest": members_digest(entries), "count": len(members), "members": members}


MAX_NAMED_MEMBERS = 20      # how many unproved members a reason names before it says how many more


def reconcile_stage(root: Path, now: datetime | None = None) -> Result:
    """From Proved on, the stage is only as good as the proof: a member added to the touched set since it moves the stage back to
    Matrices (and says so), and so does a stage with no recorded proof. Fewer members keep the proof. Before Proved nothing changes."""
    result = Result()
    try:
        current = read_stage(root)
    except StageFileCorrupt:
        return result                                         # the command that follows reports the corrupt file
    if STAGES.index(current) < STAGES.index("Proved"):
        return result
    entries = read_toml(root / TOUCHED_FILE).get("entry", [])
    recorded = read_toml(root / STAGE_FILE).get("proved_members")
    if not recorded or "members" not in recorded:
        record_move(root, current, "Matrices", "reconcile: E-STAGE-DIGEST-MISSING, no proof is recorded", now, proved=None)
        result.fail("E-STAGE-DIGEST-MISSING", STAGE_FILE.as_posix(), f"the stage was {current} and no proof is recorded; it is now Matrices")
        return result
    added = sorted(set(member_identities(entries)) - set(recorded["members"]))
    if added:
        named = ", ".join(added[:MAX_NAMED_MEMBERS]) + (f" and {len(added) - MAX_NAMED_MEMBERS} more" if len(added) > MAX_NAMED_MEMBERS else "")
        record_move(root, current, "Matrices", f"reconcile: E-MEMBER-UNPROVED, added since the proof: {named}", now, proved=None)
        result.fail("E-MEMBER-UNPROVED", STAGE_FILE.as_posix(), f"the stage was {current}; added since the proof: {named}; it is now Matrices")
    return result


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
    proved = proof_of(read_toml(root / TOUCHED_FILE).get("entry", [])) if move == ("Matrices", "Proved") else KEEP_PROOF
    record_move(root, current, to, ALLOWED_MOVES[move], now, proved=proved)
    result.data = {"from": current, "to": to}
    return result


# ---- stubs and the deletion report ----------------------------------------------------------------------------------

@dataclass
class Results:
    """What the runners reported for one run against the stubs: outcome per qualified test id, and languages with no result file."""
    outcomes: dict[str, str] = field(default_factory=dict)
    missing: set[str] = field(default_factory=set)
    file_failures: set[str] = field(default_factory=set)         # "language:file" whose whole file failed before any test ran
    rust_names: dict[str, str] = field(default_factory=dict)     # cargo's json names tests but not their binary: outcome by name
    texts: dict[str, str] = field(default_factory=dict)          # what each failing test said, by qualified test id (so a failure can cite a cut)
    rust_texts: dict[str, str] = field(default_factory=dict)     # the same for Rust, by test name
    exit_codes: dict[str, int] = field(default_factory=dict)     # a shell test's exit status, by qualified test id

    def outcome_of(self, test: str) -> str | None:
        """Exact result, else a whole-file failure, else (Rust) the result of the test of that name."""
        if test in self.outcomes:
            return self.outcomes[test]
        language, _, rest = test.partition(":")
        if f"{language}:{rest.split('::')[0]}" in self.file_failures:
            return FAILED_OTHER
        if language == "rust":
            return self.rust_names.get(rest.split("::", 1)[1]) if "::" in rest else None
        return None


RUST_STUB = re.compile(r"^(?:todo|unimplemented)!\s*\(.*\)\s*;?$", re.S)
TS_STUB = re.compile(r"^throw\s+new\s+Error\s*\(.*\)\s*;?$", re.S)
SHELL_STUB_CODE = 99      # the exit/return status of every shell stub
SHELL_STUB = re.compile(rf"^return\s+{SHELL_STUB_CODE}\s*;?$")
SCRIPT_STUB = re.compile(rf"^exit\s+{SHELL_STUB_CODE}\s*;?$")


def skip_literal(language: str, text: str, i: int) -> int | None:
    """The index just past a string, character literal or comment that starts at text[i]; None when none starts there."""
    if language == "shell":
        if text[i] == "#" and (i == 0 or text[i - 1] in " \t\n;"):
            return text.find("\n", i) if "\n" in text[i:] else len(text)
        if text[i] == "'":
            return text.find("'", i + 1) + 1 or len(text)
    else:
        if text.startswith("//", i):
            return text.find("\n", i) if "\n" in text[i:] else len(text)
        if text.startswith("/*", i):
            return text.find("*/", i + 2) + 2 if "*/" in text[i:] else len(text)
        if text[i] == "'" and language == "rust":
            m = RUST_CHAR.match(text, i)
            return m.end() if m else None                     # a lifetime such as 'a is not a literal
        if text[i] == "'":
            return skip_quoted(text, i)
    if text[i] in "\"" + ("`" if language == "typescript" else ""):
        return skip_quoted(text, i)
    return None


RUST_CHAR = re.compile(r"'(?:\\.[^']*|[^\\'])'")


def skip_quoted(text: str, i: int) -> int:
    quote, i = text[i], i + 1
    while i < len(text) and text[i] != quote:
        i += 2 if text[i] == "\\" else 1
    return i + 1


TYPE_BRACE_AFTER = ":|&"         # a brace after one of these opens a type literal (`): { ok: boolean } {`), not the body


def brace_body(text: str, language: str = "rust") -> str | None:
    """The text inside the function's own brace block: the first brace of the signature's end, outside parentheses and
    angle brackets (a parameter or return type may hold braces of its own), up to its matching close. The function's
    text runs to the next definition line, so what follows that close (the next item's doc comment, attributes, blank
    lines) is not the function's. None when the function has no block."""
    i, depth, paren, angle, start = 0, 0, 0, 0, None
    while i < len(text):
        skipped = skip_literal(language, text, i)
        if skipped is not None:
            i = skipped
            continue
        c, before = text[i], text[:i].rstrip()[-1:]
        if depth:
            depth += {"{": 1, "}": -1}.get(c, 0)
            if depth == 0:
                return text[start:i].strip()
        elif c in "([":
            paren += 1
        elif c in ")]":
            paren -= 1
        elif c == "<" and not paren:
            angle += 1
        elif c == ">" and angle and before not in "-=":
            angle -= 1
        elif c == "{" and not paren and not angle:
            if before in TYPE_BRACE_AFTER and before:
                angle += 1                                  # a type literal: skip to its close
            else:
                depth, start = 1, i + 1
        elif c == "}" and angle and not paren:
            angle -= 1
        i += 1
    return None


def strip_comments(language: str, body: str) -> str:
    """The body without line, block and doc comments (`#` comments for shell), strings left as they are."""
    out, i = [], 0
    while i < len(body):
        skipped = skip_literal(language, body, i)
        if skipped is None:
            out.append(body[i])
            i += 1
        elif body[i] in "#/":
            out.append(" ")                               # a comment: dropped, a space keeps the neighbours apart
            i = skipped
        else:
            out.append(body[i:skipped])
            i = skipped
    return "".join(out).strip()


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
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return None
    statements = node.body
    if len(statements) > 1 and isinstance(statements[0], ast.Expr) and isinstance(statements[0].value, ast.Constant) and isinstance(statements[0].value.value, str):
        statements = statements[1:]                       # a docstring is not code
    if len(statements) != 1 or not isinstance(statements[0], ast.Raise):
        return False
    exc = statements[0].exc
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
    body = brace_body(func.text, language)
    pattern = {"rust": RUST_STUB, "typescript": TS_STUB, "shell": SHELL_STUB}[language]
    return body is not None and bool(pattern.match(strip_comments(language, body)))


# ---- cut statements: the unit of deletion is the code that depends on what is replaced (owner, 16 Oct 2026) --------------

CUT_ID_PREFIX = "refactor-cut:"
CUT_ID_CITED = re.compile(r"refactor-cut:(\S+?#\d+)")      # how a failing test's text cites the cut whose stand-in it hit
KIND_WHOLE, KIND_CUT, KIND_NONE, KIND_UNDECIDED, KIND_CONFLICT = "whole", "cut", "none", "undecided", "conflict"
DEFAULT_NTH = 1
DEFAULT_LINES = 1
SPAN_ROLES = ("uses", "guards")            # statements that stay and must be covered, around a cut
COMMENT_STARTS = {"python": ("#",), "shell": ("#",), "rust": ("//", "/*", "* ", "*/"), "typescript": ("//", "/*", "* ", "*/")}
DIFF_SNIPPET_LINES = 3                      # how many differing lines a collateral problem quotes


class BaseUnreadable(Exception):
    """The base revision of a file cannot be read (no such revision, no git): the tool cannot decide."""


def entry_kind(e: dict) -> str:
    """whole: the whole function is the cut. cut: statements are. none: `cut = []`, nothing in it needs cutting. undecided: neither key
    is there (it is treated as whole, and only check-cuts --strict says so). conflict: `whole = true` together with a non-empty cut."""
    whole, cut = bool(e.get("whole")), e.get("cut")
    if whole and cut:
        return KIND_CONFLICT
    if whole:
        return KIND_WHOLE
    if "cut" in e:
        return KIND_CUT if cut else KIND_NONE
    return KIND_UNDECIDED


def behaves_as(kind: str) -> str:
    return KIND_WHOLE if kind == KIND_UNDECIDED else kind


def entry_subject(e: dict) -> str:
    return f"{e['file']}::{e['function']}"


def cut_id(e: dict, n: int) -> str:
    return f"{CUT_ID_PREFIX}{entry_subject(e)}#{n}"


@dataclass
class ResolvedCut:
    n: int
    id: str
    span: tuple[int, int]                 # absolute 1-based file lines, inclusive
    uses: list[tuple[int, int]]
    guards: list[tuple[int, int]]


def span_lines(span: tuple[int, int]) -> set[int]:
    return set(range(span[0], span[1] + 1))


def resolve_span(spec, file_lines: list[str], in_function: set[int]) -> tuple[tuple[int, int] | None, str, str]:
    """(span, problem code, detail): the span an anchor names inside the function, or why it names none."""
    if not isinstance(spec, dict) or not isinstance(spec.get("anchor"), str) or not spec["anchor"].strip():
        return None, "E-CUT-ANCHOR-MISSING", "no anchor text"
    nth, count = spec.get("nth"), spec.get("lines", DEFAULT_LINES)
    if not isinstance(count, int) or isinstance(count, bool) or count < 1 or (nth is not None and (not isinstance(nth, int) or isinstance(nth, bool) or nth < 1)):
        return None, "E-CUT-ANCHOR-MISSING", "`nth` and `lines` are whole numbers from 1"
    anchor = spec["anchor"].strip()
    found = [n for n in sorted(in_function) if n <= len(file_lines) and file_lines[n - 1].strip() == anchor]
    if not found or (nth is not None and nth > len(found)):
        return None, "E-CUT-ANCHOR-MISSING", f"{anchor!r} is not {'in the function' if not found else f'there {nth} times (found {len(found)})'}"
    if len(found) > 1 and nth is None:
        return None, "E-CUT-ANCHOR-AMBIGUOUS", f"{anchor!r} occurs {len(found)} times (lines {', '.join(map(str, found))}): give `nth`"
    start = found[(nth or DEFAULT_NTH) - 1]
    span = (start, start + count - 1)
    if not span_lines(span) <= in_function:
        return None, "E-CUT-OUT-OF-FUNCTION", f"{anchor!r} with lines = {count} (file lines {span[0]} to {span[1]}) runs past the function"
    return span, "", ""


def resolve_cuts(e: dict, text: str, in_function: set[int]) -> tuple[list[ResolvedCut], list[Problem]]:
    """Every cut of an entry as file lines of `text`, and every problem found: anchors, why, overlaps. A cut with a problem is left out."""
    problems: list[Problem] = []
    file_lines = text.splitlines()
    resolved: list[ResolvedCut] = []
    for n, raw in enumerate(e.get("cut", []), start=1):
        cid = cut_id(e, n)
        if not isinstance(raw, dict):
            problems.append(Problem("E-CUT-ANCHOR-MISSING", cid, "a cut is a table with an anchor"))
            continue
        broken = False
        if not str(raw.get("why", "")).strip():
            problems.append(Problem("E-CUT-NO-WHY", cid, "a cut says why it depends on the replaced code"))
        span, code, detail = resolve_span(raw, file_lines, in_function)
        if span is None:
            problems.append(Problem(code, cid, detail))
            broken = True
        spans: dict[str, list[tuple[int, int]]] = {}
        for role in SPAN_ROLES:
            spans[role] = []
            for i, spec in enumerate(raw.get(role, []), start=1):
                found, code, detail = resolve_span(spec, file_lines, in_function)
                if found is None:
                    problems.append(Problem(code, cid, f"{role}[{i}]: {detail}"))
                    broken = True
                else:
                    spans[role].append(found)
        if not broken:
            resolved.append(ResolvedCut(n, cid, span, spans["uses"], spans["guards"]))
    for i, a in enumerate(resolved):
        for b in resolved[i + 1:]:
            if span_lines(a.span) & span_lines(b.span):
                problems.append(Problem("E-CUT-OVERLAP", a.id, f"its span and the span of {b.id} share lines"))
    for a in resolved:                       # a use or guard may lie in a DIFFERENT cut's span (a chain: one cut's result is the next cut's input)
        for role in SPAN_ROLES:
            if any(span_lines(a.span) & span_lines(s) for s in getattr(a, role)):
                problems.append(Problem("E-CUT-OVERLAP", a.id, f"its span and one of its own {role} share lines"))
    return resolved, problems


def working_tree_reader(root: Path) -> Callable[[str], str | None]:
    return lambda file: (root / file).read_text() if (root / file).exists() else None


def git_show_reader(root: Path, rev: str) -> Callable[[str], str | None]:
    """The text of a file at a revision (`git show REV:FILE`). A revision or a repository that git cannot read is BaseUnreadable."""
    def read(file: str) -> str | None:
        try:
            done = subprocess.run(["git", "-C", str(root), "show", f"{rev}:{file}"], capture_output=True, text=True)
        except FileNotFoundError as exc:
            raise BaseUnreadable("git is not installed") from exc
        if done.returncode != EXIT_OK:
            raise BaseUnreadable(f"git show {rev}:{file} failed: {done.stderr.strip().splitlines()[-1] if done.stderr.strip() else done.returncode}")
        return done.stdout
    return read


def check_cuts(root: Path, strict: bool = False, base: Callable[[str], str | None] | None = None) -> Result:
    """The cut / whole data of every touched-set entry is well formed: every anchor finds one statement inside the function, spans
    do not overlap, every cut says why. The anchors are read from `base` (default: the working tree; give the revision the deletion
    started from once the stand-ins are in). With strict, an entry that says neither `whole` nor `cut` is refused."""
    result = Result()
    read = base or working_tree_reader(root)
    kinds: dict[str, str] = {}
    undecided: list[str] = []
    no_obligation: list[str] = []
    try:
        for e in read_toml(root / TOUCHED_FILE).get("entry", []):
            subject, kind = entry_subject(e), entry_kind(e)
            kinds[subject] = behaves_as(kind) if kind != KIND_CONFLICT else KIND_CONFLICT
            if kind == KIND_CONFLICT:
                result.fail("E-CUT-WHOLE-AND-CUT", subject, "`whole = true` and a non-empty `cut` together: choose one")
            elif kind == KIND_UNDECIDED:
                undecided.append(subject)
                if strict:
                    result.fail("E-CUT-UNDECIDED", subject, "says neither `whole = true` nor `cut = [...]`")
            elif kind == KIND_NONE:
                no_obligation.append(subject)
            elif kind == KIND_CUT:
                text = read(e["file"])
                in_function = lines_in_text(e["language"], text, e["function"]) if text is not None else None
                if in_function is None:
                    result.fail("E-STALE-ENTRY", subject, "no such function in the file")
                    continue
                for p in resolve_cuts(e, text, in_function)[1]:
                    result.fail(p.code, p.subject, p.detail)
    except BaseUnreadable as exc:
        result.error("E-BASE-UNREADABLE", "base", str(exc))
    result.data = {"kinds": kinds, "undecided": undecided, "no_obligation": no_obligation}
    write_report(root, "cuts", result)
    return result



DEFAULT_BASE_REV = "HEAD"                   # the revision a deletion started from: the working tree holds the deletion, uncommitted
STAND_IN_FORMS = {                          # the stand-in of a cut, by language; %s is the cut's id
    "python": 'raise NotImplementedError("%s")',
    "rust": 'unimplemented!("%s");',
    "typescript": 'throw new Error("not implemented: %s");',
}


def stand_in_text(language: str, function: str, cid: str) -> str:
    if language == "shell":
        return f"exit {SHELL_STUB_CODE}" if function == SCRIPT_LEVEL else f"return {SHELL_STUB_CODE}"       # a shell stand-in cannot carry the id
    return STAND_IN_FORMS[language] % cid


def stand_in_pattern(language: str, function: str, cid: str) -> re.Pattern:
    """What a line must be (stripped) to be the stand-in of one cut: the form of its language, carrying the cut's id."""
    esc = re.escape(cid)
    if language == "shell":
        return re.compile(rf"^{'exit' if function == SCRIPT_LEVEL else 'return'}\s+{SHELL_STUB_CODE}\s*;?$")
    return re.compile({
        "python": rf"""^raise NotImplementedError\((["']){esc}\1\)$""",
        "rust": rf"""^(?:unimplemented|todo)!\("{esc}"\);?$""",
        "typescript": rf"""^throw new Error\((["'`])not implemented: {esc}\1\);?$""",
    }[language])


def meaningful(language: str, line: str) -> str | None:
    """The line as compared when a function is matched with its base: None for a blank line or a comment."""
    stripped = line.strip()
    if not stripped or stripped.startswith(COMMENT_STARTS[language]) or stripped == "*":
        return None
    return line.rstrip()


@dataclass
class StandIn:
    cut: ResolvedCut
    indent: str                            # the indentation of the cut's first line, which its stand-in takes
    text: list[str]                        # the cut's own lines, as compared (to tell "still there" from "replaced by something else")


def deleted_items(language: str, text: str, in_function: set[int], cuts: list[ResolvedCut]) -> list[str | StandIn]:
    """The function's lines in order, each cut's span replaced by one StandIn."""
    file_lines = text.splitlines()
    starts = {c.span[0]: c for c in cuts}
    skipped = set().union(*(span_lines(c.span) for c in cuts)) if cuts else set()
    items: list[str | StandIn] = []
    for n in sorted(in_function):
        if n in starts:
            first = file_lines[n - 1]
            own = [m for m in (meaningful(language, file_lines[k - 1]) for k in sorted(span_lines(starts[n].span))) if m is not None]
            items.append(StandIn(starts[n], first[: len(first) - len(first.lstrip())], own))
        elif n not in skipped:
            items.append(file_lines[n - 1])
    return items


def match_deleted(language: str, items: list[str | StandIn], current: list[str]) -> list[tuple[list[StandIn], list[str]]] | None:
    """Match the current function (as meaningful lines) with the base-with-stand-ins: the kept lines exactly, and in place of each
    run of stand-ins whatever lies between the kept lines around it. [(the run, the lines found there)] in order, or None when the
    kept lines do not line up, that is when the function differs from its base outside the cuts."""
    tokens: list[tuple[str, list]] = []
    for item in items:
        if isinstance(item, StandIn):
            if tokens and tokens[-1][0] == "stand":
                tokens[-1][1].append(item)
            else:
                tokens.append(("stand", [item]))
        else:
            line = meaningful(language, item)
            if line is not None:
                if tokens and tokens[-1][0] == "keep":
                    tokens[-1][1].append(line)
                else:
                    tokens.append(("keep", [line]))
    memo: dict[tuple[int, int], list[tuple[list[StandIn], list[str]]] | None] = {}

    def solve(ti: int, pos: int) -> list[tuple[list[StandIn], list[str]]] | None:
        if (ti, pos) in memo:
            return memo[(ti, pos)]
        found: list[tuple[list[StandIn], list[str]]] | None = None
        if ti == len(tokens):
            found = [] if pos == len(current) else None
        elif tokens[ti][0] == "keep":
            kept = tokens[ti][1]
            found = solve(ti + 1, pos + len(kept)) if current[pos:pos + len(kept)] == kept else None
        else:
            run = tokens[ti][1]
            following = tokens[ti + 1][1] if ti + 1 < len(tokens) else None      # a run is followed by kept lines, or ends the function
            ends = [len(current)] if following is None else [k for k in range(pos, len(current) + 1) if current[k:k + len(following)] == following]
            for k in sorted(ends, key=lambda k: (abs(k - pos - len(run)), k)):     # a region of the expected length first
                rest = solve(ti + 1, k)
                if rest is not None:
                    found = [(run, current[pos:k]), *rest]
                    break
        memo[(ti, pos)] = found
        return found

    return solve(0, 0)


def stand_in_problems(e: dict, matched: list[tuple[list[StandIn], list[str]]]) -> list[Problem]:
    """E-CUT-NOT-REPLACED where a cut's own text is still there, E-CUT-STAND-IN-WRONG where what stands in its place is not its
    stand-in (nothing, another form, another id, a wrong indentation, or a second one)."""
    problems: list[Problem] = []
    for run, found in matched:
        exact = len(found) == len(run)
        for i, stand in enumerate(run):
            cid = stand.cut.id
            line = found[i] if exact else None
            ok = line is not None and line[: len(stand.indent)] == stand.indent and not line[len(stand.indent):][:1].isspace() \
                and bool(stand_in_pattern(e["language"], e["function"], cid).match(line.strip()))
            if ok:
                continue
            if stand.text and stand.text[0] in found:
                problems.append(Problem("E-CUT-NOT-REPLACED", cid, "the cut's own statements are still in the function"))
            else:
                expected = stand.indent + stand_in_text(e["language"], e["function"], cid)
                problems.append(Problem("E-CUT-STAND-IN-WRONG", cid, f"expected exactly one statement here: {expected.strip()!r}"))
    return problems


def first_difference(expected: list[str], current: list[str]) -> str:
    """A short quote of where two lists of lines first differ, for the collateral problem."""
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, expected, current, autojunk=False).get_opcodes():
        if tag != "equal":
            return f"expected {expected[i1:i2][:DIFF_SNIPPET_LINES]!r}, found {current[j1:j2][:DIFF_SNIPPET_LINES]!r}"
    return "the line counts differ"


def check_cut_entry(root: Path, e: dict, read_base: Callable[[str], str | None], result: Result) -> None:
    """One cut entry: the current function is the BASE function with each cut replaced by one stand-in, and nothing else changed."""
    subject, language = entry_subject(e), e["language"]
    current_text = (root / e["file"]).read_text() if (root / e["file"]).exists() else None
    base_text = read_base(e["file"])
    if current_text is None or base_text is None:
        result.fail("E-STALE-ENTRY", subject, "no such file" + ("" if base_text is not None else " in the base revision"))
        return
    try:
        base_lines = lines_in_text(language, base_text, e["function"])
    except SyntaxError as exc:
        raise BaseUnreadable(f"{e['file']} does not parse in the base revision: {exc.msg}") from exc
    if base_lines is None:
        result.fail("E-STALE-ENTRY", subject, "no such function in the base revision")
        return
    cuts, problems = resolve_cuts(e, base_text, base_lines)
    if problems:
        for p in problems:
            result.fail(p.code, p.subject, p.detail)
        return
    try:
        current_lines = lines_in_text(language, current_text, e["function"])
    except SyntaxError as exc:
        result.fail("E-CUT-COLLATERAL", subject, f"the file does not parse: {exc.msg}")
        return
    if current_lines is None:
        result.fail("E-STALE-ENTRY", subject, "no such function in the file")
        return
    items = deleted_items(language, base_text, base_lines, cuts)
    file_lines = current_text.splitlines()
    current = [m for m in (meaningful(language, file_lines[n - 1]) for n in sorted(current_lines)) if m is not None]
    matched = match_deleted(language, items, current)
    if matched is None:
        expected = [m for m in (meaningful(language, i.indent + stand_in_text(language, e["function"], i.cut.id) if isinstance(i, StandIn) else i) for i in items) if m is not None]
        result.fail("E-CUT-COLLATERAL", subject, f"differs from the base version outside the cut spans: {first_difference(expected, current)}")
        return
    for p in stand_in_problems(e, matched):
        result.fail(p.code, p.subject, p.detail)


def apply_cuts(root: Path, base: Callable[[str], str | None] | None = None) -> Result:
    """Dry run only: for each entry with cuts, the BASE function with a stand-in in place of each cut. Never writes anything but its
    report; the deletion itself is made by hand in the working tree."""
    result = Result()
    read = base or git_show_reader(root, DEFAULT_BASE_REV)
    printed: dict[str, str] = {}
    try:
        for e in read_toml(root / TOUCHED_FILE).get("entry", []):
            if entry_kind(e) != KIND_CUT:
                continue
            subject, text = entry_subject(e), read(e["file"])
            in_function = lines_in_text(e["language"], text, e["function"]) if text is not None else None
            if in_function is None:
                result.fail("E-STALE-ENTRY", subject, "no such function in the base revision")
                continue
            cuts, problems = resolve_cuts(e, text, in_function)
            for p in problems:
                result.fail(p.code, p.subject, p.detail)
            if not problems:
                printed[subject] = "".join(
                    f"{i.indent}{stand_in_text(e['language'], e['function'], i.cut.id)}\n" if isinstance(i, StandIn) else f"{i}\n"
                    for i in deleted_items(e["language"], text, in_function, cuts))
    except BaseUnreadable as exc:
        result.error("E-BASE-UNREADABLE", "base", str(exc))
    result.data = {"entries": printed}
    write_report(root, "apply-cuts", result)
    return result


def check_stubs(root: Path, base: Callable[[str], str | None] | None = None) -> Result:
    """Every function in the touched set has been replaced by hand with a stub of the exact form for its language; for an entry with
    cuts, only each cut has been replaced, by the stand-in of its language. `base` reads a file as it was before the deletion
    (default: `git show HEAD:FILE`; the working tree holds the deletion, uncommitted)."""
    result = Result()
    read = base or git_show_reader(root, DEFAULT_BASE_REV)
    try:
        for e in read_toml(root / TOUCHED_FILE).get("entry", []):
            subject = entry_subject(e)
            kind = entry_kind(e)
            if kind == KIND_CONFLICT:
                result.fail("E-CUT-WHOLE-AND-CUT", subject, "`whole = true` and a non-empty `cut` together: choose one")
            elif kind == KIND_CUT:
                check_cut_entry(root, e, read, result)
            elif kind == KIND_NONE:
                continue
            else:
                path = root / e["file"]
                verdict = is_stub(e["language"], path.read_text(), e["function"]) if path.exists() else None
                if verdict is None:
                    result.fail("E-STALE-ENTRY", subject, "no such function in the file")
                elif not verdict:
                    result.fail("E-NOT-STUB", subject, "the body is not exactly a stub")
    except BaseUnreadable as exc:
        result.error("E-BASE-UNREADABLE", "base", str(exc))
    write_report(root, "stubs", result)
    return result


def cuts_cited(results: Results) -> dict[str, set[str]]:
    """{cut id: the failing tests whose failure text cites it} (Rust tests are named `rust:NAME`: cargo's json does not name the binary)."""
    cited: dict[str, set[str]] = {}
    failing_texts = [(t, text) for t, text in results.texts.items() if results.outcomes.get(t, FAILED_OTHER) != PASSED]
    failing_texts += [(f"rust:{name}", text) for name, text in results.rust_texts.items() if results.rust_names.get(name, FAILED_OTHER) != PASSED]
    for test, text in failing_texts:
        for cid in CUT_ID_CITED.findall(text):
            cited.setdefault(f"{CUT_ID_PREFIX}{cid}", set()).add(test)
    return cited


def shell_cut_failed(root: Path, e: dict, results: Results) -> bool:
    """A shell stand-in cannot carry its id, so a shell cut is proved by a test script that names the cut's script and ended with exit 99."""
    scripts = {t.split(":", 1)[1] for t in results.exit_codes}
    named = shell_touching(root, [e], scripts)
    return any(results.exit_codes.get(f"shell:{t}") == SHELL_STUB_CODE for t in named)


def assigned_tests(root: Path) -> set[str]:
    return {t for tests in read_toml(root / ASSIGNMENTS_FILE).get("assignments", {}).values() for t in tests}


def report_deletion(root: Path, results: Results, base: Callable[[str], str | None] | None = None) -> Result:
    """Against the stubs every assigned test must fail for the stub's reason, and every test outside the set must not fail."""
    stubs = check_stubs(root, base)
    if stubs.exit_code != EXIT_OK:
        write_report(root, "deletion", stubs)
        return stubs
    result = Result()
    assigned = assigned_tests(root)
    unfit = {e.get("test") for e in read_toml(root / ASSIGNMENTS_FILE).get("unfit", [])}
    for language in sorted(results.missing):
        result.fail("E-RESULTS-MISSING", language, "the runner produced no result file, so no test can be counted as failed")
    cut_entries = [e for e in read_toml(root / TOUCHED_FILE).get("entry", []) if entry_kind(e) == KIND_CUT]
    passed_assigned = False
    for test in sorted(assigned):
        if test.split(":", 1)[0] in results.missing:
            continue
        outcome = results.outcome_of(test)
        if outcome is None:
            result.fail("E-RESULTS-MISSING", test, "no result for an assigned test")
        elif outcome == PASSED:
            if not cut_entries:         # with cuts a test that does not depend on them passes, and the cuts are proved by the tests that fail
                passed_assigned = True
                result.fail("E-ASSIGNED-PASSED", test, "the test passes against the stubs: rewrite it")
        elif outcome == FAILED_OTHER:
            result.fail("E-STUB-FAILS-TO-IMPORT", test, "it failed, but not for the stub's reason: a broken import proves nothing about assertions")
    contract_tests = {c.get("test") for c in read_toml(root / CONTRACTS_FILE).get("contract", [])}      # expected red: not outsiders
    assigned_rust_names = {t.split(":", 1)[1].split("::", 1)[1] for t in assigned if t.startswith("rust:") and "::" in t}
    for test, outcome in sorted({**results.outcomes, **{f"rust:{n}": o for n, o in results.rust_names.items() if n not in assigned_rust_names}}.items()):
        if test not in assigned and test not in unfit and test not in contract_tests and outcome in (FAILED_STUB, FAILED_OTHER):
            result.fail("E-OUTSIDE-FAILED", test, "a test outside the touched set failed: the partition is not MECE")
    if passed_assigned and read_stage(root) == "Deleted":
        record_move(root, "Deleted", "Proved", ALLOWED_MOVES[BACK_EDGE])
    if cut_entries:
        cited_by = cuts_cited(results)
        for e in cut_entries:
            if e["language"] in results.missing:
                continue
            if e["language"] == "shell":
                if not shell_cut_failed(root, e, results):
                    result.fail("E-CUT-NO-TEST-FAILED", entry_subject(e), f"no failing shell test that names the script ended with exit {SHELL_STUB_CODE}: the cut is not covered")
                continue
            for n in range(1, len(e["cut"]) + 1):
                if cut_id(e, n) not in cited_by:
                    result.fail("E-CUT-NO-TEST-FAILED", cut_id(e, n), "no failing test cites this cut: it is a coverage gap, go back to proving coverage")
    if result.exit_code == EXIT_OK:
        failed = [t for t in sorted(assigned) if results.outcome_of(t) != PASSED] if cut_entries else sorted(assigned)
        result.data = {"assigned_failed": failed}
        if cut_entries:
            declared = {cut_id(e, n) for e in cut_entries if e["language"] != "shell" for n in range(1, len(e["cut"]) + 1)}
            result.data["cuts_cited"] = {cid: sorted(tests) for cid, tests in cuts_cited(results).items() if cid in declared}
    write_report(root, "deletion", result)
    return result


# ---- result readers: each runner's own format, classified as passed, failed for the stub, or failed for anything else -----

STUB_REASON = {                       # what a failure must say to be "for the stub's reason"
    "python": re.compile(r"NotImplementedError"),
    "rust": re.compile(r"not (yet )?implemented"),
    "typescript": re.compile(r"not implemented", re.I),
    "shell": re.compile(rf"\b{SHELL_STUB_CODE}\b"),
}
RESULTS_EXT = {"junit": "xml", "cargo-json": "jsonl", "vitest-json": "json", "shell-exit": "json"}


def classify_failure(language: str, text: str) -> str:
    return FAILED_STUB if STUB_REASON[language].search(text) else FAILED_OTHER


def parse_junit(folder: str, xml_text: str, texts: dict[str, str] | None = None) -> tuple[dict[str, str], set[str]]:
    """pytest --junitxml with junit_family=xunit1 (which names the file). A collection error becomes a whole-file failure. When
    `texts` is given, each failing test's message and trace are put in it, by test id."""
    outcomes: dict[str, str] = {}
    file_failures: set[str] = set()
    for case in ElementTree.fromstring(xml_text).iter("testcase"):
        failure = next((c for c in case if c.tag in ("failure", "error")), None)
        text = f"{failure.get('message', '')} {failure.text or ''}" if failure is not None else ""
        if failure is not None and failure.get("message") == "collection failure":
            file_failures.add(qualified("python", f"{folder}/{case.get('name')}.py"))
            continue
        module = case.get("classname", "").split(".")[0]
        classes = case.get("classname", "").split(".")[1:]
        file = case.get("file") or f"{module}.py"
        test_id = qualified("python", "::".join([posixpath.normpath(f"{folder}/{file}"), *classes, case.get("name", "")]))
        outcomes[test_id] = PASSED if failure is None else classify_failure("python", text)
        if failure is not None and texts is not None:
            texts[test_id] = failure.get("message", "")       # the exception's own words: the trace lists the source, with every stand-in in it
    return outcomes, file_failures


def parse_cargo_json(text: str, texts: dict[str, str] | None = None) -> dict[str, str]:
    """cargo +nightly test -- -Z unstable-options --format json: one event per line; the binary is not named. When `texts` is given,
    each failing test's output is put in it, by test name."""
    outcomes: dict[str, str] = {}
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "test" and event.get("event") in ("ok", "failed"):
            outcomes[event["name"]] = PASSED if event["event"] == "ok" else classify_failure("rust", event.get("stdout", ""))
            if event["event"] != "ok" and texts is not None:
                texts[event["name"]] = event.get("stdout", "")
    return outcomes


def parse_vitest_json(root: Path, text: str, texts: dict[str, str] | None = None) -> dict[str, str]:
    outcomes: dict[str, str] = {}
    for file in json.loads(text)["testResults"]:
        rel = relative(root, file["name"])
        for test in file["assertionResults"]:
            title = " > ".join([*test["ancestorTitles"], test["title"]])
            failed = test["status"] != "passed"
            test_id = qualified("typescript", f"{rel}::{title}")
            outcomes[test_id] = classify_failure("typescript", " ".join(test["failureMessages"])) if failed else PASSED
            if failed and texts is not None:
                texts[test_id] = "\n".join(m.split("\n", 1)[0] for m in test["failureMessages"])      # the first line of each: the rest is a stack
    return outcomes


def parse_shell_results(text: str, texts: dict[str, str] | None = None, codes: dict[str, int] | None = None) -> dict[str, str]:
    """Outcome per test script. When given, `texts` gets each failing script's output and `codes` every script's exit status."""
    for script, body in json.loads(text).items():
        if codes is not None:
            codes[qualified("shell", script)] = body["code"]
        if texts is not None and body["code"] != 0:
            texts[qualified("shell", script)] = body["output"]
    return {qualified("shell", script): PASSED if body["code"] == 0 else FAILED_STUB if body["code"] == SHELL_STUB_CODE
            else classify_failure("shell", body["output"])
            for script, body in json.loads(text).items()}


def results_path(root: Path, language: str, spec: dict) -> Path:
    return root / REPORTS_DIR / f"results-{language}.{RESULTS_EXT[spec['format']]}"


def run_suites(root: Path) -> Result:
    """Run each language's suite with its result output switched on. Failing tests are the data here, so this exits 0 unless a
    runner cannot be started at all."""
    result = Result()
    for key, spec in read_toml(root / RUNNERS_FILE).items():
        language = runner_language(key)
        results = spec.get("results")
        if results is None:
            continue
        out = results_path(root, key, results)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.unlink(missing_ok=True)
        try:
            if language == "shell":
                runs = {}
                for script in sorted(p for p in root.glob(spec["glob"]) if p.is_file()):
                    done = subprocess.run(["bash", str(script)], cwd=root, capture_output=True, text=True)
                    runs[script.relative_to(root).as_posix()] = {"code": done.returncode, "output": done.stdout + done.stderr}
                out.write_text(json.dumps(runs, indent=JSON_INDENT))
                continue
            command = [part.replace(COVERAGE_OUT, str(out)) for part in results["command"]]
            done = subprocess.run(command, cwd=root / spec["dir"], capture_output=True, text=True)
            if language == "rust":
                out.write_text(done.stdout)
        except (FileNotFoundError, NotADirectoryError) as exc:
            result.error("E-TOOL-MISSING", key, f"cannot run {exc.filename or key}")
    return result


def read_results(root: Path) -> Results:
    """Read whatever result files exist; a language that has a results command but no file is missing."""
    found = Results()
    for key, spec in read_toml(root / RUNNERS_FILE).items():
        language = runner_language(key)
        results = spec.get("results")
        if results is None:
            continue
        path = results_path(root, key, results)
        if not path.exists():
            found.missing.add(language)
            continue
        text = path.read_text()
        if language == "python":
            outcomes, file_failures = parse_junit(spec["dir"], text, found.texts)
            found.outcomes.update(outcomes)
            found.file_failures |= file_failures
        elif language == "rust":
            found.rust_names.update(parse_cargo_json(text, found.rust_texts))
        elif language == "typescript":
            found.outcomes.update(parse_vitest_json(root, text, found.texts))
        elif language == "shell":
            found.outcomes.update(parse_shell_results(text, found.texts, found.exit_codes))
    return found


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
            result.fail("E-FATE-INVALID", test, f"{state!r}: states are {', '.join(FATE_STATES)}")
            continue
        counts[state] += 1
        if state == "rewritten" and not fate.get("new_test"):
            result.fail("E-FATE-NO-NEW-TEST", test, "a rewritten test names the test that replaces it")
        if state == "retired":
            if fate.get("function") not in touched:
                result.fail("E-RETIRED-NO-FUNCTION", test, "a retired test names the touched function retired with it")
            if not fate.get("reason"):
                result.fail("E-FATE-RETIRED-NO-REASON", test, "a retired test gives the reason")
    for test in sorted(assigned):
        if test not in seen:
            result.fail("E-NO-FATE", test, "no fate")
    for test, n in sorted(seen.items()):
        if n > 1 and test in assigned:
            result.fail("E-FATE-MULTIPLE", test, f"{n} fates")
    result.data = {"counts": counts}
    write_report(root, "fates", result)
    return result


CONTRACTS_FILE = REFACTOR_DIR / "new_contracts.toml"


def render_fates(root: Path) -> str:
    """The table for the plan: each old test once, with its fate and what it became or what it was retired with."""
    rows = ["| old test | fate | detail |", "|---|---|---|"]
    for fate in read_toml(root / FATES_FILE).get("fate", []):
        detail = {"kept": "unchanged", "rewritten": f"rewritten to `{fate.get('new_test', '')}`",
                  "retired": f"retired with `{fate.get('function', '')}`: {fate.get('reason', '')}"}.get(fate.get("state", ""), "")
        rows.append(f"| `{fate['test']}` | {fate.get('state', '')} | {detail} |")
    return "\n".join(rows) + "\n"


def check_contracts(root: Path, results: Results) -> Result:
    """Every contract area of the PRD has a new test, and each new test has been seen to fail (a test never seen red proves nothing)."""
    result = Result()
    config = read_toml(root / CONTRACTS_FILE)
    areas = set(config.get("areas", {}))
    covered: set[str] = set()
    for contract in config.get("contract", []):
        area, test = contract.get("area", ""), contract.get("test", "")
        if area not in areas:
            result.fail("E-CONTRACT-AREA-UNKNOWN", test, f"area {area!r} is not one of the PRD's contract areas")
            continue
        covered.add(area)
        outcome = results.outcome_of(test)
        if outcome is None:
            result.fail("E-RESULTS-MISSING", test, "no result: a new test with no run cannot be called red")
        elif outcome == PASSED:
            result.fail("E-CONTRACT-NOT-RED", test, f"area {area}: it passes before the reimplementation, so it proves nothing about it")
    for area in sorted(areas - covered):
        result.fail("E-CONTRACT-MISSING", area, "the area has no new test")
    write_report(root, "contracts", result)
    return result


# ---- coverage proof: 100% of lines and branches of every touched file -----------------------------------------------

@dataclass
class FileLines:
    """One file's coverage as a tool reports it: hits per instrumented line, and each branch as (line, id, taken)."""
    lines: dict[int, int]
    branches: list[tuple[int, str, bool]] = field(default_factory=list)


class ToolMissing(Exception):
    """A coverage tool is not installed: exit 2 naming it."""


class SuiteRed(Exception):
    """The suite failed under coverage: a red suite is never accepted as a proof (exit 2)."""


class NoRunner(Exception):
    """runners.toml has no coverage command for a language that has touched functions: exit 2, not a traceback."""


class NotMeasured(Exception):
    """This language cannot be measured here (kcov on macOS): reported as not measured, never as passed."""


CoverageRunner = Callable[[Path, str, dict], dict[str, FileLines]]
COVERAGE_OUT = "{out}"           # replaced in a coverage command by the file the tool must write its JSON to
COVERAGE_OUTDIR = "{outdir}"     # or by the folder, for a tool that picks the file name itself (spec "file" names it)


def relative(root: Path, name: str) -> str:
    return Path(name).resolve().relative_to(root.resolve()).as_posix()


def parse_lcov(root: Path, folder: str, text: str) -> dict[str, FileLines]:
    """lcov (pytest-cov, cargo llvm-cov, vitest all write it): SF file, DA line,hits, BRDA line,block,branch,taken."""
    files: dict[str, FileLines] = {}
    current: FileLines | None = None
    for raw in text.splitlines():
        if raw.startswith("SF:"):
            path = Path(raw[3:])
            name = relative(root, raw[3:]) if path.is_absolute() else posixpath.normpath(f"{folder}/{raw[3:]}" if folder else raw[3:])
            current = files.setdefault(name, FileLines({}))
        elif raw.startswith("DA:") and current is not None:
            line, hits = raw[3:].split(",")[:2]
            current.lines[int(line)] = int(hits)
        elif raw.startswith("BRDA:") and current is not None:
            line, block, branch, taken = raw[5:].split(",")
            current.branches.append((int(line), f"{block}:{branch}", taken not in ("-", "0")))
    return files


def parse_kcov(root: Path, report: dict, scripts: list[str] | None = None) -> dict[str, FileLines]:
    """kcov's per-line report (codecov.json): hits per line of each file it watched; no branches. A file outside the repository is
    matched to a touched script by the end of its path (a test may run a copy made in a temporary folder)."""
    found: dict[str, FileLines] = {}
    for path, lines in report["coverage"].items():
        try:
            name = relative(root, path)
        except ValueError:
            name = next((sc for sc in (scripts or []) if Path(path).as_posix().endswith("/" + sc)), None)
            if name is None:
                continue
        found = combine_lines(found, {name: FileLines({int(n): int(hits) for n, hits in lines.items()})})
    return found


def combine_lines(a: dict[str, FileLines], b: dict[str, FileLines]) -> dict[str, FileLines]:
    """Two sets of per-line reports (two tests, say): a line has run if it ran in either, so the larger hit count wins."""
    out = {name: FileLines(dict(f.lines), list(f.branches)) for name, f in a.items()}
    for name, f in b.items():
        mine = out.setdefault(name, FileLines({}))
        for line, hits in f.lines.items():
            mine.lines[line] = max(hits, mine.lines.get(line, 0))
        mine.branches += f.branches
    return out


def function_lines(root: Path, language: str, file: str, function: str) -> set[int] | None:
    """The line numbers a touched function spans (a shell <script> is the whole file); None if the file has no such function."""
    return lines_in_text(language, (root / file).read_text(), function)


def lines_in_text(language: str, text: str, function: str) -> set[int] | None:
    """function_lines for a source text that is not (or not yet) the file on disk, such as the base version of a file."""
    if function == SCRIPT_LEVEL:
        return set(range(1, len(text.splitlines()) + 1))
    if language == "python":
        return python_function_lines(text, function)
    funcs = [f for f in functions_of(language, text) if f.name == function]
    if not funcs:
        return None
    lines: set[int] = set()
    for f in funcs:
        lines |= set(range(f.start, f.start + len(f.text.splitlines())))
    return lines


def run_kcov(root: Path, outdir: Path, spec: dict) -> dict[str, FileLines]:
    """Every shell test script runs under kcov, then the runs are merged and the merged json is read (Linux only)."""
    kcov = shutil.which("kcov")
    if kcov is None:
        raise NotMeasured("kcov is not installed (it measures shell coverage on Linux only)")
    parts = []
    scripts = spec.get("scripts", [])
    # watch the touched scripts by their path inside the repository, wherever a test runs them from (a test may run a copy in a
    # temporary folder); the lines named in exclude_lines (code of another language written inside a shell string) are not shell
    watch = [f"--include-pattern={','.join(scripts)}"] if scripts else [f"--include-path={root}"]
    if spec.get("exclude_lines"):
        watch.append(f"--exclude-line={','.join(spec['exclude_lines'])}")
    tests = spec.get("tests")
    combined: dict[str, FileLines] = {}
    for script in [root / t for t in tests] if tests is not None else sorted(p for p in root.glob(spec["glob"]) if p.is_file()):
        part = outdir / script.stem
        done = subprocess.run([kcov, *watch, str(part), str(script)], cwd=root, capture_output=True, text=True)
        if done.returncode != EXIT_OK:
            raise SuiteRed(f"{script.relative_to(root)} exited {done.returncode} under kcov")
        # each test's own report is read: kcov's --merge re-reads the sources, and a test's temporary copy of a script is gone by then
        for report in sorted(part.glob("*/codecov.json")):
            combined = combine_lines(combined, parse_kcov(root, json.loads(report.read_text()), scripts))
    return combined


def run_coverage(root: Path, language: str, spec: dict) -> dict[str, FileLines]:
    """Run one language's suite under its coverage tool and read the per-file counts it wrote."""
    outdir = root / REPORTS_DIR / f"coverage-{language}"
    shutil.rmtree(outdir, ignore_errors=True)
    outdir.mkdir(parents=True)
    if language == "shell":
        return run_kcov(root, outdir, spec)
    if not spec.get("command"):
        raise NoRunner(language)
    out = outdir / spec.get("file", "coverage.json")       # a tool that writes a folder names the file it writes there
    command = [part.replace(COVERAGE_OUT, str(out)).replace(COVERAGE_OUTDIR, str(outdir)) for part in spec["command"]]
    try:
        done = subprocess.run(command, cwd=root / spec["dir"], capture_output=True, text=True)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise ToolMissing(command[0]) from exc
    missing = re.search(r"no such command: .(\S+?).$", done.stderr, re.M)
    if missing:
        raise ToolMissing(f"{command[0]} {missing.group(1)}")
    if done.returncode != EXIT_OK or not out.exists():
        tail = " | ".join((done.stderr or done.stdout).strip().splitlines()[-ERROR_TAIL_LINES:])
        raise SuiteRed(f"{' '.join(command[:3])} exited {done.returncode}: {tail}")
    return parse_lcov(root, spec["dir"], out.read_text())


def check_coverage(root: Path, runner: CoverageRunner = run_coverage, languages: set[str] | None = None) -> Result:
    """100% of the lines and of the branches inside every touched function, measured by running each language's suite under its
    tool (the owner approved the function level on 12 Oct 2026: the refactor deletes functions, not files)."""
    result = Result()
    specs = read_toml(root / RUNNERS_FILE)
    touched: dict[str, list[dict]] = {}
    kinds: dict[str, str] = {}                  # whole, cut, none or conflict, by "file::function" (an entry that says neither is whole)
    no_obligation: list[str] = []               # `cut = []`: nothing in the function needs cutting, so nothing is owed
    for e in read_toml(root / TOUCHED_FILE).get("entry", []):
        if languages is None or e["language"] in languages:
            subject, kind = entry_subject(e), entry_kind(e)
            kinds[subject] = behaves_as(kind)
            if kind == KIND_CONFLICT:
                result.fail("E-CUT-WHOLE-AND-CUT", subject, "`whole = true` and a non-empty `cut` together: choose one")
            elif kind == KIND_NONE:
                no_obligation.append(subject)
            else:
                touched.setdefault(e["language"], []).append(e)
    not_measured: dict[str, str] = {}
    measured_counts: dict[str, list[int]] = {}
    excused: dict[str, dict] = {}
    constants_only: list[str] = []              # module heads in a measured file with no executable line: reported, not a coverage claim
    spans_seen: dict[str, set[int]] = {}        # the lines of each file that a touched function covers
    blind: dict[str, list[dict]] = {}          # the reviewed table of lines a tool cannot see, by file
    for tool_spec in specs.values():
        for row in tool_spec.get("coverage", {}).get("blind", []):
            if not str(row.get("reason", "")).strip():
                result.fail("E-BLIND-NO-REASON", row.get("file", "?"), "a line a tool cannot see is excused only with a reason")
            else:
                blind.setdefault(row["file"], []).append(row)
    for language, entries in sorted(touched.items()):
        try:
            measured: dict[str, FileLines] = {}
            for key in [k for k in specs if runner_language(k) == language] or [language]:     # a language may have several runners
                language_spec = specs.get(key, {})
                spec = language_spec.get("coverage", {}) | {"dir": language_spec.get("dir", "."), "glob": language_spec.get("glob", "")}
                if language == "shell":      # kcov runs only the test scripts that name a touched script, not every shell test
                    every = {p.relative_to(root).as_posix() for p in root.glob(spec["glob"]) if p.is_file()} if spec["glob"] else set()
                    spec["tests"] = sorted(shell_touching(root, entries, every))
                    spec["scripts"] = sorted({e["file"] for e in entries})
                measured |= runner(root, language, spec)
        except NoRunner as exc:
            result.error("E-NO-COVERAGE-RUNNER", language, f"runners.toml has no coverage command for {exc}")
            continue
        except NotMeasured as exc:
            not_measured[language] = str(exc)
            continue
        except ToolMissing as exc:
            result.error("E-TOOL-MISSING", language, f"{exc} is not installed")
            continue
        except SuiteRed as exc:
            result.error("E-SUITE-RED", language, str(exc))
            continue
        for e in entries:
            subject = f"{e['file']}::{e['function']}"
            data = measured.get(e["file"])
            span = function_lines(root, language, e["file"], e["function"]) if (root / e["file"]).exists() else None
            if data is None or span is None:
                result.fail("E-FILE-UNMEASURED", subject, f"{language}: the coverage tool reported nothing for this {'file' if data is None else 'function'}")
                continue
            obligation = span                       # a whole entry owes every line of the function ...
            if kinds[subject] == KIND_CUT:          # ... a cut entry owes the cut, the statements that use its result, and its guards
                cuts, cut_problems = resolve_cuts(e, (root / e["file"]).read_text(), span)
                if cut_problems:
                    for p in cut_problems:
                        result.fail(p.code, p.subject, p.detail)
                    continue
                obligation = set().union(*(span_lines(s) for c in cuts for s in [c.span, *c.uses, *c.guards]))
            executable = sorted(n for n in obligation if n in data.lines)
            if not executable:
                if e["function"] == MODULE_LEVEL:      # a head of constants and imports has no line a coverage tool measures; the functions that read it are what the tests exercise
                    constants_only.append(subject)
                    continue
                owed = "function" if obligation is span else "function's cut, use and guard lines"
                result.fail("E-FILE-UNMEASURED", subject, f"{language}: no measurable line in this {owed}")
                continue
            unrun = [n for n in executable if data.lines[n] == 0]
            spans_seen.setdefault(e["file"], set()).update(obligation)
            named = {n: row["reason"] for row in blind.get(e["file"], []) for n in row.get("lines", []) if n in obligation}
            for n in sorted(named):
                if n not in data.lines:
                    result.fail("E-BLIND-STALE", f"{e['file']}:{n}", "not a line the coverage tool measures: remove it from the table")
                elif data.lines[n] > 0:
                    result.fail("E-BLIND-STALE", f"{e['file']}:{n}", f"the tool now sees this line run ({data.lines[n]} time(s)): remove it from the table")
            skipped = sorted(n for n in unrun if n in named)
            if skipped:
                excused[subject] = {"lines": skipped, "reason": "; ".join(sorted({named[n] for n in skipped}))}
            lines_missing = [n for n in unrun if n not in named]
            lines_n, lines_hit = len(executable), len(executable) - len(lines_missing)
            inside = [b for b in data.branches if b[0] in obligation]
            branches_missing = [b for b in inside if not b[2]]
            branches_n = len(inside)
            branches_hit = branches_n - len(branches_missing)
            measured_counts[subject] = [lines_n, lines_n - len(unrun), branches_n, branches_hit]       # the honest count: excused lines are not counted as run
            short = []
            if lines_hit < lines_n:
                where = ", ".join(f"line {n}" for n in lines_missing)
                short.append(f"{lines_hit} of {lines_n} lines" + (f" ({where})" if where else ""))
            if branches_hit < branches_n:
                short.append(f"{branches_hit} of {branches_n} branches (" + ", ".join(f"{line}->{bid.split(':', 1)[1].removeprefix('jump to line ')}" for line, bid, _ in branches_missing) + ")")
            if short:
                result.fail("E-BELOW", subject, "; ".join(short))
    for file, rows in sorted(blind.items()):      # a line named in the table that no touched function covers is a mistake too
        for n in sorted({n for row in rows for n in row.get("lines", [])} - spans_seen.get(file, set())):
            if file in spans_seen:
                result.fail("E-BLIND-STALE", f"{file}:{n}", "not a line of any touched function in this file: remove it from the table")
    result.data = {"not_measured": not_measured, "measured": measured_counts, "excused": excused, "constants_only": constants_only,
                   "kinds": kinds, "no_obligation": no_obligation}
    write_report(root, "coverage", result)
    return result


# ---- idle guard: nothing moves on a machine that is running a story -------------------------------------------------

JOB_STATES = {"queued", "running", "done", "failed", "cancelled"}      # dbench's JobState, as `dbench status --json` prints it


def guard_idle(node: str, status_text: str) -> Result:
    """Exit 0 when no job on the node is running (queued jobs do not count); 1 naming the running job and its story; 2 when the
    text is not the status of that node. An unknown state is never treated as idle."""
    result = Result()
    try:
        jobs = json.loads(status_text)[node]
        if not isinstance(jobs, list):
            raise TypeError("the node's jobs are not a list")
        states = [(job["id"], job["state"]["status"], job["progress"].get("current_story")) for job in jobs]
        unknown = [state for _, state, _ in states if state not in JOB_STATES]
        if unknown:
            raise ValueError(f"unknown job state {unknown[0]!r}")
    except (json.JSONDecodeError, KeyError, TypeError, ValueError, AttributeError) as exc:
        result.error("E-STATUS-UNPARSEABLE", node, f"not the status of this node: {type(exc).__name__}: {exc}")
        return result
    for job_id, state, story in states:
        if state == "running":
            result.fail("E-MACHINE-BUSY", job_id, f"story {story}" if story else "story not started yet")
    return result


def run_guard_idle(node: str) -> Result:
    """Ask dbench for the node's status; a dbench that cannot be run or exits non-zero is an unreachable node (exit 2)."""
    try:
        done = subprocess.run(["dbench", "status", "--json", node], capture_output=True, text=True)
    except FileNotFoundError:
        result = Result()
        result.error("E-UNREACHABLE", node, "dbench is not installed")
        return result
    if done.returncode != EXIT_OK:
        result = Result()
        result.error("E-UNREACHABLE", node, f"dbench status exited {done.returncode}: {done.stderr.strip()[-200:]}")
        return result
    return guard_idle(node, done.stdout)


# ---- membership: which listed tests touch the touched set ------------------------------------------------------------------

TOUCH_PYTHON = REPORTS_DIR / "touch-python.json"      # coverage contexts of the whole Python suite, written by measure-touch
CONTEXT_PHASE = "|run"                                # coverage's per-test context is "<nodeid>|run", "|setup" or "|teardown"
RUST_SKIP_STEMS = {"main", "lib", "mod"}


def python_function_lines(text: str, name: str) -> set[int] | None:
    """Lines from the def line through its last line, named as the scan names it (class prefixes only; a nested def
    keeps its plain name); None if absent."""
    if name == MODULE_LEVEL:         # every line outside a def: the top-level code, as the scan attributes it
        tree = ast.parse(text)
        in_defs = {n for d in ast.walk(tree) if isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef))
                   for n in range(d.lineno, d.end_lineno + 1)}
        return set(range(1, len(text.splitlines()) + 1)) - in_defs

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


def python_touching(root: Path, entries: list[dict], listed: set[str]) -> set[str]:
    path = root / TOUCH_PYTHON
    if not path.exists():
        raise AdapterError(f"{TOUCH_PYTHON} does not exist: run `refactor.py measure-touch` first (it runs the whole Python suite under coverage)")
    files = json.loads(path.read_text()).get("files", {})
    found: set[str] = set()
    for e in entries:
        data = files.get(e["file"])
        if data is None:
            raise AdapterError(f"{e['file']}: the touch measurement never saw this file")
        lines = python_function_lines((root / e["file"]).read_text(), e["function"])
        if lines is None:
            raise AdapterError(f"{e['file']}::{e['function']}: no such function")
        found |= {t.split(":", 1)[1] for t in tests_touching(data.get("contexts", {}), lines)}
    unlisted = sorted(found - listed)
    if unlisted:
        raise AdapterError(f"{len(unlisted)} test(s) touch the set but no runner lists them, for example {unlisted[0]!r}")
    return found


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


def rust_touching(root: Path, entries: list[dict], listed: set[str]) -> set[str]:
    """A unit test by the file of its module; an integration test by whether its text names a touched module."""
    touched_files = {e["file"] for e in entries}
    stems = {Path(f).stem if Path(f).stem not in RUST_SKIP_STEMS else Path(f).parent.name for f in touched_files}
    found: set[str] = set()
    for test in sorted(listed):
        file, _, name = test.partition("::")
        if "/tests/" in file:
            text = (root / file).read_text() if (root / file).exists() else ""
            if any(re.search(rf"\b{re.escape(stem)}\b", text) for stem in stems):
                found.add(test)
            continue
        crate_dir, _, entry_file = file.partition("/src/")
        segments = name.split("::")
        module = segments[: segments.index("tests")] if "tests" in segments else segments[:-1]
        resolved = rust_module_file(root, crate_dir, f"src/{entry_file}", module)
        if resolved is None:
            raise AdapterError(f"{crate_dir}: no source file for the module of test {name!r} ({'::'.join(module)})")
        if resolved in touched_files:
            found.add(test)
    return found


def typescript_touching(root: Path, entries: list[dict], listed: set[str]) -> set[str]:
    """A vitest file named for a touched module, or importing one."""
    stems = {Path(e["file"]).stem for e in entries}
    found: set[str] = set()
    for test in sorted(listed):
        file = test.partition("::")[0]
        text = (root / file).read_text() if (root / file).exists() else ""
        named = Path(file).name.split(".")[0] in stems
        imported = any(re.search(rf"""["'](?:[^"']*/)?{re.escape(stem)}(?:\.ts)?["']""", text) for stem in stems)
        if named or imported:
            found.add(test)
    return found


def shell_touching(root: Path, entries: list[dict], listed: set[str]) -> set[str]:
    """A shell test script that names a touched script."""
    names = {Path(e["file"]).name for e in entries}
    return {t for t in listed if any(n in ((root / t).read_text() if (root / t).exists() else "") for n in names)}


def touching_tests(root: Path, listed: dict[str, set[str]]) -> dict[str, set[str]]:
    """The listed tests that touch the touched set: the register's universe (approved with task 1.24)."""
    by_language: dict[str, list[dict]] = {}
    for e in read_toml(root / TOUCHED_FILE).get("entry", []):
        by_language.setdefault(e["language"], []).append(e)
    rules = {"python": python_touching, "rust": rust_touching, "typescript": typescript_touching, "shell": shell_touching}
    return {language: rules[language](root, entries, listed.get(language, set())) for language, entries in sorted(by_language.items())}


def measure_touch(root: Path) -> Result:
    """Run each Python suite under coverage with a context per test and keep which tests ran which lines (one slow run; the
    register then decides membership from the file). A suite that fails still leaves usable data; no data at all is SuiteRed."""
    result = Result()
    merged: dict[str, dict] = {}
    ran = 0
    for key, spec in read_toml(root / RUNNERS_FILE).items():
        touch = spec.get("touch")
        if runner_language(key) != "python" or touch is None:
            continue
        outdir = root / REPORTS_DIR / f"touch-{key}"
        shutil.rmtree(outdir, ignore_errors=True)
        outdir.mkdir(parents=True)
        env = {**os.environ, "COVERAGE_FILE": str(outdir / "data")}
        out = outdir / "coverage.json"
        try:
            subprocess.run(touch["command"], cwd=root / spec["dir"], env=env, capture_output=True, text=True)
            made = subprocess.run([part.replace(COVERAGE_OUT, str(out)) for part in touch["json_command"]], cwd=root / spec["dir"], env=env,
                                  capture_output=True, text=True)
        except (FileNotFoundError, NotADirectoryError) as exc:
            result.error("E-TOOL-MISSING", key, f"cannot run {exc.filename or key}")
            return result
        if made.returncode != EXIT_OK or not out.exists():
            result.error("E-SUITE-RED", key, f"no coverage data came out of the run: {(made.stderr or made.stdout).strip()[-200:]}")
            return result
        folder = spec["dir"]
        for file, body in json.loads(out.read_text()).get("files", {}).items():
            contexts = {line: [f"{folder}/{n}" if n else n for n in names] for line, names in body.get("contexts", {}).items()}
            merged[posixpath.normpath(f"{folder}/{file}")] = {"contexts": contexts}
        ran += 1
    if not ran:
        result.error("E-NO-TOUCH-RUNNER", "runners.toml", "no [python*.touch] section names a command")
        return result
    atomic_write(root / TOUCH_PYTHON, json.dumps({"files": merged}))
    result.data = {"files": len(merged)}
    write_report(root, "measure-touch", result)
    return result


class Universe:
    """The register's lister: every test the runners list is kept on .all, and the tests that touch the touched set are returned."""

    def __call__(self, root: Path) -> dict[str, set[str]]:
        self.all = list_tests(root)
        return touching_tests(root, self.all)


# ---- the real runners: every test the repository has, as the runners list it ------------------------------------------

RUNNERS_FILE = REFACTOR_DIR / "runners.toml"
PYTEST_ID = re.compile(r"^(\S+\.py::\S.*)$")
PYTEST_ERROR = re.compile(r"^ERROR\s+(\S+)")
CARGO_RUNNING = re.compile(r"^\s*Running (unittests )?(\S+) \(target/debug/deps/([A-Za-z0-9_]+?)-[0-9a-f]+\)")
CARGO_TEST_LINE = re.compile(r"^(\S+): test$")
ERROR_TAIL_LINES = 5       # how much of a failing runner's stderr is quoted in the error


class AdapterError(Exception):
    """A runner or its output cannot be used: the command turns this into exit 2, never a pass and never a shorter list."""


def runner_language(key: str) -> str:
    """A runner key is a language, or language-suffix for a second runner of the same language (python-monitor)."""
    return key.split("-")[0]


def parse_pytest(folder: str, output: str) -> set[str]:
    errors = [m.group(1) for line in output.splitlines() if (m := PYTEST_ERROR.match(line))]
    if errors:
        raise AdapterError(f"pytest could not collect: {', '.join(errors)}")
    return {posixpath.normpath(f"{folder}/{m.group(1).split('::')[0]}") + "::" + m.group(1).split("::", 1)[1]
            for line in output.splitlines() if (m := PYTEST_ID.match(line))}


def parse_cargo_list(root: Path, folder: str, output: str) -> set[str]:
    """`cargo test -- --list` output: unit tests by the file of their binary, integration tests by their own file."""
    found: set[str] = set()
    entry, member = "", ""
    for line in output.splitlines():
        running = CARGO_RUNNING.match(line)
        if running:
            unit, file, binary = running.groups()
            if unit:       # integration test binaries belong to the member of the unit binary listed just before them
                member = next((m for m in (binary, binary.replace("_", "-")) if (root / folder / m / "Cargo.toml").exists()), None)
                if member is None:
                    raise AdapterError(f"{folder}: no workspace member folder for the test binary {binary}")
            entry = f"{folder}/{member}/{file}"
            continue
        test = CARGO_TEST_LINE.match(line)
        if test and entry:
            found.add(f"{entry}::{test.group(1)}")
    return found


def parse_vitest(root: Path, output: str) -> set[str]:
    try:
        rows = json.loads(output)
        return {f"{Path(r['file']).resolve().relative_to(root.resolve()).as_posix()}::{r['name']}" for r in rows}
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise AdapterError(f"vitest list output is not usable: {exc}") from exc


def run_listing(command: list[str], cwd: Path, language: str) -> str:
    try:
        done = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, text=True,
                              stderr=subprocess.STDOUT if language == "rust" else subprocess.PIPE)   # cargo prints headers on stderr
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise AdapterError(f"{language}: cannot run {command[0]}: {exc}") from exc
    if done.returncode != EXIT_OK:
        tail = " | ".join((done.stderr or done.stdout).strip().splitlines()[-ERROR_TAIL_LINES:])
        raise AdapterError(f"{language}: {' '.join(command[:3])} exited {done.returncode}: {tail}")
    return done.stdout


def list_tests(root: Path) -> dict[str, set[str]]:
    """Every test the four runners list, by language, read from ops/refactor/runners.toml (a language not listed is not run)."""
    config = read_toml(root / RUNNERS_FILE)
    if not (root / RUNNERS_FILE).exists():
        raise AdapterError(f"{RUNNERS_FILE} does not exist: it names each language's runner")
    found: dict[str, set[str]] = {}
    for key, spec in config.items():
        language = runner_language(key)
        if language == "shell":
            found.setdefault(language, set()).update(p.relative_to(root).as_posix() for p in sorted(root.glob(spec["glob"])) if p.is_file())
            continue
        folder = spec["dir"]
        output = run_listing(spec["command"], root / folder, language)
        if language == "python":
            found.setdefault(language, set()).update(parse_pytest(folder, output))
        elif language == "rust":
            found.setdefault(language, set()).update(parse_cargo_list(root, folder, output))
        elif language == "typescript":
            found.setdefault(language, set()).update(parse_vitest(root, output))
        else:
            raise AdapterError(f"{RUNNERS_FILE}: unknown language {language}")
    return found


# ---- inputs the runners' adapters write (neutral JSON), and the machine probe -------------------------------------------

PARITY_REPORT = REPORTS_DIR / "parity.json"


def merged(*results: Result) -> Result:
    out = Result()
    for r in results:
        out.exit_code = max(out.exit_code, r.exit_code)
        out.problems += r.problems
    return out


def default_justifiers(lister: Lister) -> dict[tuple[str, str], Justifier]:
    def matrices(root: Path) -> Result:
        known = read_toml(root / USE_CASES_FILE)
        required = known.get("matrix_required", list(known.get("use_cases", {})))     # no key: every use case needs a matrix
        unknown = Result()
        for u in required:
            if u not in known.get("use_cases", {}):
                unknown.fail("E-UNKNOWN-USE-CASE", u, "matrix_required names a use case that is not one of the fourteen")
        return merged(unknown, *(check_matrix(root, u, lister) for u in required if u in known.get("use_cases", {})))

    def red_contracts(root: Path) -> Result:
        report = root / REPORTS_DIR / "deletion.json"
        held = Result()
        if not report.exists() or json.loads(report.read_text()).get("exit_code") != EXIT_OK:
            held.fail("E-NO-DELETION-REPORT", str(report.relative_to(root)), "report-deletion has not passed")
        return merged(held, check_fates(root), check_contracts(root, read_results(root)))

    def suite_green(root: Path) -> Result:
        found = Result()
        results = read_results(root)
        for language in sorted(results.missing):
            found.error("E-RESULTS-MISSING", language, "no suite result to read: run `run-suites` first")
        if any(o != PASSED for o in [*results.outcomes.values(), *results.rust_names.values()]) or results.file_failures:
            found.fail("E-SUITE-NOT-GREEN", "suite", "the whole suite must pass")
        return found

    def parity(root: Path) -> Result:
        found = Result()
        path = root / PARITY_REPORT
        if not path.exists() or json.loads(path.read_text()).get("exit_code") != EXIT_OK:
            found.fail("E-NO-PARITY", str(PARITY_REPORT), "the comparison has not passed")
        return found

    return {
        ("Inventory", "Matrices"): lambda root: merged(check_register(root, lister), check_touched(root)),
        ("Matrices", "Proved"): lambda root: merged(matrices(root), check_coverage(root)),
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
    for language, why in result.data.get("not_measured", {}).items():
        print(f"  not measured  {language}  {why}")
    for subject, row in result.data.get("excused", {}).items():
        print(f"  excused  {subject}  lines {', '.join(str(n) for n in row['lines'])}: {row['reason']}")
    if "audit_counts" in result.data:
        c = result.data["audit_counts"]
        print(f"counts: protected hits {c['protected']}, entries {c['entries']}, excluded hits {c['excluded']}, intrinsic hits {c['intrinsic']}")


# ---- the audit: numbered pass files of recorded searches (story 19) -----------------------------------------------------

AUDIT_DIR = REFACTOR_DIR / "audit"
PASS_FILE = re.compile(r"^pass-(\d{2,})\.md$")
CATEGORIES = ("vcs-command", "tree-read", "host-url", "history-test")
SCOPE_FOLDERS = ("benchmarks/spec-bench", "tools", "ops", "tests", "lib")          # every pass searches each of these ...
ROOT_SHELL_SCOPE = ":(glob)*.sh"                                                  # ... and the shell scripts at the root
WHOLE_REPOSITORY = (".", "")
QUERY_COLUMNS = ("Query", "Category", "Pattern", "Paths")
HIT_COLUMNS = ("Hit", "Place", "Function", "Source", "Access", "Via", "UseCase", "Outcome", "Reason", "New")
FINDING_COLUMNS = ("Finding", "Title", "Status")
PASS_PARTS = (("Queries", QUERY_COLUMNS), ("Hits", HIT_COLUMNS), ("Open findings", FINDING_COLUMNS))
VERDICT_FINAL, VERDICT_MORE = "final", "another pass required"
NO_AUDIT_CODES = ("E-AUDIT-NONE", "E-NOT-FINAL")       # an audit with no final pass is E-NO-FINAL-AUDIT to the touched-set check
MANUAL_SOURCE = "manual"
IS_NEW = "yes"
AUDIT_EXCLUDE = f":(exclude){AUDIT_DIR.as_posix()}"       # the pass files hold the patterns, so no query searches them
SOURCE_LANGUAGES = {".py": "python", ".rs": "rust", ".ts": "typescript", ".tsx": "typescript", ".sh": "shell", ".bash": "shell"}
CHANGED_FILES_LISTING = ("ls-files", "-z", "--modified", "--others", "--deleted", "--exclude-standard")     # git: what differs from the last commit


class PassFormatError(Exception):
    """A pass file is missing a part, a column or the verdict line; the message says which."""


@dataclass
class Query:
    id: str
    category: str
    pattern: str
    paths: list[str]


@dataclass
class HitRow:
    id: str
    place: str
    function: str
    source: str
    access: str
    via: str
    use_case: str
    outcome: str
    reason: str
    new: str

    @property
    def identity(self) -> str:
        return f"{self.place}::{self.function}"

    @property
    def manual(self) -> bool:
        return self.source.strip().lower() == MANUAL_SOURCE

    @property
    def sources(self) -> list[str]:
        return [s.strip() for s in self.source.split(",") if s.strip()]


@dataclass
class Pass:
    number: int
    path: Path
    queries: list[Query]
    hits: list[HitRow]
    findings: list[dict]
    verdict: str


@dataclass
class Hit:
    file: str
    line: int
    function: str


def split_cells(line: str) -> list[str]:
    cells = re.split(r"(?<!\\)\|", line.strip())[1:-1]                      # a pipe inside a cell is written \|
    return [c.strip().replace("\\|", "|").strip("`") if c.strip().startswith("`") else c.strip().replace("\\|", "|") for c in cells]


def read_table(text: str, part: str, columns: tuple[str, ...], where: str) -> list[dict[str, str]]:
    block = re.search(rf"^## {re.escape(part)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not block:
        raise PassFormatError(f"{where}: the part '{part}' is missing")
    rows = [split_cells(line) for line in block.group(1).splitlines() if line.strip().startswith("|")]
    if not rows:
        raise PassFormatError(f"{where}: the part '{part}' has no table")
    header, body = rows[0], [r for r in rows[1:] if not all(re.fullmatch(r":?-+:?", c) for c in r)]
    for column in columns:
        if column not in header:
            raise PassFormatError(f"{where}: the {part} table has no column '{column}'")
    return [dict(zip(header, r + [""] * (len(header) - len(r)))) for r in body]


def parse_pass(path: Path) -> Pass:
    """The queries, hits, open findings and verdict of one pass file. Raises PassFormatError naming what is missing."""
    text, where = path.read_text(), path.name
    parts = {name: read_table(text, name, columns, where) for name, columns in PASS_PARTS}
    verdict = re.search(r"^verdict:\s*(.*)$", text, re.M | re.I)
    if not verdict:
        raise PassFormatError(f"{where}: the verdict line is missing")
    return Pass(
        number=int(PASS_FILE.match(path.name).group(1)), path=path,
        queries=[Query(r["Query"], r["Category"], r["Pattern"], r["Paths"].split()) for r in parts["Queries"]],
        hits=[HitRow(r["Hit"], r["Place"], r["Function"], r["Source"], r["Access"], r["Via"], r["UseCase"], r["Outcome"], r["Reason"], r["New"])
              for r in parts["Hits"]],
        findings=parts["Open findings"], verdict=verdict.group(1).strip())


def python_spans(text: str) -> list[tuple[str, int, int]]:
    spans: list[tuple[str, int, int]] = []

    def walk(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                spans.append((prefix + child.name, child.lineno, child.end_lineno))
                walk(child, prefix)
            elif isinstance(child, ast.ClassDef):
                walk(child, prefix + child.name + ".")
            else:
                walk(child, prefix)

    walk(ast.parse(text), "")
    return spans


LEADING_LINE = {                       # a line that belongs to the function it sits directly above (no blank line between)
    "python": re.compile(r"\s*(#|@)"), "shell": re.compile(r"\s*#"),
    "rust": re.compile(r"\s*(//|/\*|\*|#\[)"), "typescript": re.compile(r"\s*(//|/\*|\*|@)"),
}


def leading_start(lines: list[str], definition: int, language: str) -> int:
    """The 1-based line where a function really starts: its definition line, moved up over the comment, doc, attribute or decorator
    lines directly above it."""
    first = definition - 1
    while first > 0 and LEADING_LINE[language].match(lines[first - 1]):
        first -= 1
    return first + 1


@functools.lru_cache(maxsize=None)
def attribution_table(path: str, mtime_ns: int, size: int, language: str) -> tuple[tuple[tuple[str, int, int], ...], int | None]:
    """(spans, tests_after) of one file: each function with the first and last line it owns (its leading comment block included), and for a
    Rust file the line after which its test module begins. Cached by the file's path, size and modification time, so a pass over
    thousands of hits parses each file once and an edited file is read again."""
    text = Path(path).read_text(errors="replace")
    lines = text.splitlines()
    if language == "python":
        try:
            return tuple((name, leading_start(lines, first, language), last) for name, first, last in python_spans(text)), None
        except SyntaxError:
            return (), None
    marker = RUST_TEST_MODULE.search(text) if language == "rust" else None
    tests_after = text[:marker.start()].count("\n") if marker else None
    top = SCRIPT_LEVEL if language == "shell" else MODULE_LEVEL
    funcs = [f for f in functions_of(language, text) if f.name != top]
    starts = [leading_start(lines, f.start, language) for f in funcs]
    spans = tuple((f.name, starts[i], (starts[i + 1] - 1) if i + 1 < len(funcs) else f.start + len(f.text.splitlines()) - 1) for i, f in enumerate(funcs))
    return spans, tests_after


def function_at(root: Path, rel: str, line: int) -> str:
    """The function a line of a tracked file belongs to, by the same scan the touched set uses; the file's top level otherwise. A comment
    block directly above a function belongs to it."""
    language = SOURCE_LANGUAGES.get(Path(rel).suffix)
    if language is None:
        return MODULE_LEVEL
    path = root / rel
    info = path.stat()
    spans, tests_after = attribution_table(str(path), info.st_mtime_ns, info.st_size, language)
    top = SCRIPT_LEVEL if language == "shell" else MODULE_LEVEL
    if tests_after is not None and line > tests_after:
        return TESTS_LEVEL
    inside = [s for s in spans if s[1] <= line <= s[2]]
    if not inside:
        return top
    return min(inside, key=lambda s: s[2] - s[1])[0] if language == "python" else inside[0][0]


def git_grep(root: Path, pattern: str, paths: list[str]) -> list[tuple[str, int]]:
    """`git grep -n -E` over the tracked files, the audit folder left out: (file, line) of every matching line."""
    done = subprocess.run(["git", "-C", str(root), "grep", "-n", "-I", "-E", "-e", pattern, "--", *paths, AUDIT_EXCLUDE], capture_output=True, text=True)
    if done.returncode == 1:
        return []
    if done.returncode != 0:
        raise AdapterError(f"git grep failed: {done.stderr.strip()}")
    return [(m.group(1), int(m.group(2))) for m in (re.match(r"(.+?):(\d+):", line) for line in done.stdout.splitlines()) if m]


def run_queries(root: Path, pass_: Pass, grep=git_grep) -> dict[str, list[Hit]]:
    """Each query of the pass run again: its hits, each attributed to its enclosing function."""
    return {q.id: [Hit(f, n, function_at(root, f, n)) for f, n in sorted(set(grep(root, q.pattern, q.paths)))] for q in pass_.queries}


def tree_snapshot(root: Path) -> dict[str, str | None]:
    """Content hash of every file that differs from the repository's last commit, or is untracked and not ignored (None: deleted),
    outside the audit folder, the reports and the tool's own list files. A command that must not change anything is held to this."""
    skip = (AUDIT_DIR.as_posix() + "/", REPORTS_DIR.as_posix() + "/", TOUCHED_FILE.as_posix(), STAGE_FILE.as_posix())
    listing = subprocess.run(["git", "-C", str(root), *CHANGED_FILES_LISTING], capture_output=True, text=True)
    if listing.returncode == 0:
        names = [n for n in listing.stdout.split("\0") if n]
    else:                                                              # not a repository: every file counts
        names = [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()]
    return {n: (hashlib.sha256((root / n).read_bytes()).hexdigest() if (root / n).is_file() else None)
            for n in names if not n.startswith(skip) and n not in skip}


def covers(path: str, scope: str) -> bool:
    if scope == ROOT_SHELL_SCOPE:
        return path in WHOLE_REPOSITORY or path in (ROOT_SHELL_SCOPE, "*.sh")
    return path in WHOLE_REPOSITORY or path.rstrip("/") == scope or path.startswith(scope + "/")


def check_pass_shape(root: Path, p: Pass, earlier: set[str], result: Result, grep) -> None:
    """The checks of one pass that do not depend on its classification: queries, searched scope, new flags, reproducibility."""
    where = p.path.name
    for q in p.queries:
        if q.category not in CATEGORIES:
            result.fail("E-QUERY-CATEGORY", where, f"{q.id} has category '{q.category}'")
    searched = {q.category for q in p.queries}
    for category in CATEGORIES:
        if category not in searched:
            result.fail("E-CATEGORY-UNSEARCHED", where, f"no query in the category {category}")
    for scope in (*SCOPE_FOLDERS, ROOT_SHELL_SCOPE):
        if not any(covers(path, scope) for q in p.queries for path in q.paths):
            result.fail("E-SCOPE-UNSEARCHED", where, f"no query over {scope}")
    for row in p.hits:
        if row.manual and not row.reason.strip():
            result.fail("E-MANUAL-NO-REASON", where, f"{row.identity} is a manual hit with no reason")
        if (row.identity not in earlier) != (row.new.strip().lower() == IS_NEW):
            result.fail("E-NEW-MISMATCH", where, f"{row.identity} is marked New={row.new!r}")
    returned: dict[str, set[str]] = {}
    for qid, hits in run_queries(root, p, grep).items():
        for h in hits:
            returned.setdefault(f"{h.file}::{h.function}", set()).add(qid)
    recorded = {row.identity for row in p.hits}
    for row in p.hits:
        if not row.manual and not set(row.sources) <= returned.get(row.identity, set()):
            result.fail("E-PASS-NOT-REPRODUCIBLE", where, f"{row.identity} is recorded from {row.source} and the search does not return it")
    for identity, queries in sorted(returned.items()):
        if identity not in recorded:
            result.fail("E-PASS-NOT-REPRODUCIBLE", where, f"{identity} is returned by {', '.join(sorted(queries))} and is not recorded")


ACCESS_VALUES, VIA_VALUES = ("reader", "writer"), ("command", "path")
OUTCOMES = ("protected", "excluded", "intrinsic")
USE_CASES_FILE = REFACTOR_DIR / "use_cases.toml"


def known_use_cases(root: Path) -> set[str]:
    """U1 to U14, and any further use case the owner agreed: recorded under [agreed.Un] with a reason."""
    data = read_toml(root / USE_CASES_FILE)
    agreed = {k for k, v in data.get("agreed", {}).items() if str(v.get("reason", "")).strip()}
    return set(data.get("use_cases", {})) | agreed


def check_hits(root: Path, passes: list[Pass]) -> Result:
    """Every hit says how it reads (reader or writer), by what way (a version-control command or a path in the working tree) and
    has one outcome: protected (with a use case), excluded (with a reason), or intrinsic (git in the agent's own repository, so a
    class W function, with a reason). An intrinsic row with no reason is refused with the excluded code: both are decisions to leave
    a place alone."""
    result = Result()
    use_cases = known_use_cases(root)
    own_repository = load_classes(root).workspace_functions
    for p in passes:
        where = p.path.name
        outcomes: dict[str, set[str]] = {}
        for row in p.hits:
            outcomes.setdefault(row.identity, set()).add(row.outcome)
            if row.access not in ACCESS_VALUES:
                result.fail("E-ACCESS-INVALID", where, f"{row.identity}: access '{row.access}' is not reader or writer")
            if row.via not in VIA_VALUES:
                result.fail("E-VIA-INVALID", where, f"{row.identity}: via '{row.via}' is not command or path")
            if row.outcome not in OUTCOMES:
                result.fail("E-HIT-NO-OUTCOME", where, f"{row.identity}: outcome '{row.outcome}' is not protected, excluded or intrinsic")
            elif row.outcome == "protected":
                if not row.use_case.strip():
                    result.fail("E-HIT-NO-USE-CASE", where, f"{row.identity} is protected and names no use case")
                elif row.use_case not in use_cases:
                    result.fail("E-USE-CASE-UNKNOWN", where, f"{row.identity}: {row.use_case} is neither U1 to U14 nor recorded as agreed")
            elif not row.reason.strip():
                result.fail("E-EXCLUDED-NO-REASON", where, f"{row.identity} is {row.outcome} with no reason")
            elif row.outcome == "intrinsic" and row.function.split(".")[-1] not in own_repository:
                result.fail("E-INTRINSIC-NOT-OWN-REPO", where, f"{row.identity} is not a class W function (git in the agent's own repository)")
        for identity, seen in sorted(outcomes.items()):
            if len(seen) > 1:
                result.fail("E-HIT-OUTCOME-CONFLICT", where, f"{identity} is listed as {' and '.join(sorted(seen))}")
    return result


SEED_FILE = AUDIT_DIR / "seed.toml"
WHOLE_FILE = "*"


def check_seed(root: Path, passes: list[Pass]) -> list[Problem]:
    """Pass 01 has a row for every place of seed.toml; a place with function `*` is satisfied by any row in its file."""
    if not passes:
        return []
    rows = [r for r in passes[0].hits if r.outcome.strip()]
    problems = []
    for place in read_toml(root / SEED_FILE).get("place", []):
        file, function = place["file"], place["function"]
        if not any(r.place == file and function in (WHOLE_FILE, r.function) for r in rows):
            problems.append(Problem("E-SEED-MISSING", passes[0].path.name, f"{file}::{function} is seeded ({place.get('reason', '')}) and has no row in pass 01"))
    return problems


FINDINGS_FILE = AUDIT_DIR / "findings.toml"
FIRST_PASS = 1


def check_findings(root: Path, passes: list[Pass]) -> list[Problem]:
    """Open findings stay listed in every pass from the one they opened in; a pass names no finding the file does not hold; a closed
    finding carries the owner's record. The tool only reads the file: closing a finding is the owner's act."""
    findings = {f["id"]: f for f in read_toml(root / FINDINGS_FILE).get("finding", [])}
    problems = []
    for fid, f in sorted(findings.items()):
        if str(f.get("status", "")).strip().lower() == "closed" and not (str(f.get("closed_on", "")).strip() and str(f.get("closed_by", "")).strip()):
            problems.append(Problem("E-FINDING-CLOSE-NO-RECORD", FINDINGS_FILE.name, f"{fid} is closed with no closed_on and closed_by"))
    for p in passes:
        listed = {row.get("Finding", "").strip() for row in p.findings}
        for fid in sorted(listed - set(findings)):
            problems.append(Problem("E-FINDING-UNKNOWN", p.path.name, f"{fid} is listed and is not in {FINDINGS_FILE.name}"))
        for fid, f in sorted(findings.items()):
            still_open = str(f.get("status", "")).strip().lower() != "closed"
            if still_open and p.number >= int(f.get("opened_in_pass", FIRST_PASS)) and fid not in listed:
                problems.append(Problem("E-FINDING-DROPPED", p.path.name, f"the open finding {fid} is not listed"))
    return problems


def query_set(pass_: Pass) -> frozenset[tuple[str, str, str]]:
    """What a pass searched for: each query's category, pattern and paths (their order ignored), as a set."""
    return frozenset((q.category, q.pattern, " ".join(sorted(q.paths))) for q in pass_.queries)


def new_hits(passes: list[Pass]) -> list[set[str]]:
    """Per pass, the hit identities (file::function) that no earlier pass has."""
    earlier: set[str] = set()
    out = []
    for p in passes:
        identities = {r.identity for r in p.hits}
        out.append(identities - earlier)
        earlier |= identities
    return out


@dataclass
class Final:
    final_pass: int | None                   # the latest pass's number when it is final
    reason: str | None                       # why not: single-pass, new-hits or repeat
    per_pass: list[dict]                     # for each pass: its new hits, whether it repeats the one before, whether it is final


def decide_final(passes: list[Pass]) -> Final:
    """A pass is final when it is not the first, repeats no one, and has no new hit; the audit is final when its latest pass is."""
    fresh = new_hits(passes)
    per_pass = []
    for i, p in enumerate(passes):
        repeat = i > 0 and query_set(p) <= query_set(passes[i - 1])        # none of its queries is absent from the pass before
        per_pass.append({"new": len(fresh[i]), "repeat": repeat, "final": i > 0 and not repeat and not fresh[i]})
    if not passes:
        return Final(None, None, per_pass)
    latest = per_pass[-1]
    reason = None if latest["final"] else "single-pass" if len(passes) == 1 else "new-hits" if latest["new"] else "repeat"
    return Final(passes[-1].number if latest["final"] else None, reason, per_pass)


def check_stop_rule(passes: list[Pass], result: Result, require_final: bool) -> Final:
    final = decide_final(passes)
    for p, state in zip(passes, final.per_pass):
        if state["repeat"]:
            result.fail("E-PASS-REPEAT", p.path.name, "none of its queries is new compared with the pass before it, so it does not count")
        says = p.verdict.lower()
        if says.startswith(VERDICT_FINAL) and not state["final"]:
            result.fail("E-VERDICT-MISMATCH", p.path.name, "the verdict says final and the pass is not (it is the first, a repeat, or has new hits)")
        elif not says.startswith((VERDICT_FINAL, VERDICT_MORE)):
            result.fail("E-PASS-FORMAT", p.path.name, f"the verdict line must say '{VERDICT_FINAL}' or '{VERDICT_MORE}, <why>'")
    if require_final and final.final_pass is None:
        result.fail("E-NOT-FINAL", AUDIT_DIR.as_posix(), f"the audit is not final: {final.reason}")
    return final


def pass_files(root: Path) -> list[Path]:
    folder = root / AUDIT_DIR
    return sorted(f for f in (folder.iterdir() if folder.is_dir() else []) if PASS_FILE.match(f.name))


def audit_outcomes(passes: list[Pass]) -> dict[str, dict]:
    """Each hit identity with its latest outcome and the number of the first pass that found it."""
    found: dict[str, dict] = {}
    for p in passes:
        for row in p.hits:
            found[row.identity] = {"outcome": row.outcome, "first": found.get(row.identity, {}).get("first", p.number)}
    return found


def compare_audit_to_set(passes: list[Pass], entries: list[dict]) -> tuple[list[Problem], dict]:
    """The protected hits of the audit and the touched set's entries must be the same places; the counts line's figures come back too."""
    audited = audit_outcomes(passes)
    listed = {f"{e['file']}::{e['function']}" for e in entries}
    protected = {i for i, a in audited.items() if a["outcome"] == "protected"}
    excluded = {i for i, a in audited.items() if a["outcome"] == "excluded"}
    problems = []
    for identity in sorted(protected - listed):
        problems.append(Problem("E-AUDIT-MISSING-FROM-SET", identity, f"a protected hit first found by pass {audited[identity]['first']:02d} is not an entry"))
    for identity in sorted(listed & excluded):
        problems.append(Problem("E-HIT-EXCLUDED-IN-SET", identity, "the audit excluded this hit and it is listed"))
    for identity in sorted(listed - protected - excluded):
        if not identity.endswith(f"::{MODULE_LEVEL}"):             # a module-level entry may exist only for constants
            problems.append(Problem("E-SET-NOT-IN-AUDIT", identity, "no protected hit of the audit supports this entry"))
    counts = {"protected": len(protected), "entries": len(listed), "excluded": len(excluded),
              "intrinsic": sum(1 for a in audited.values() if a["outcome"] == "intrinsic")}
    return problems, counts


def check_audit(root: Path, require_final: bool = False, grep=git_grep, snapshot=tree_snapshot) -> Result:
    """Every pass file is well formed, searches all four categories over every scope folder, gives the hits anyone gets by running its
    queries again, and marks as new exactly the hits no earlier pass has. The command changes no file outside the audit folder."""
    result = Result()
    before = snapshot(root)
    folder = root / AUDIT_DIR
    numbers = sorted(int(m.group(1)) for f in (folder.iterdir() if folder.is_dir() else []) if (m := PASS_FILE.match(f.name)))
    if not numbers:
        result.fail("E-AUDIT-NONE", AUDIT_DIR.as_posix(), "no pass file: the audit has not been run")
    for n in range(1, (numbers[-1] if numbers else 0) + 1):
        if n not in numbers:
            result.fail("E-PASS-GAP", AUDIT_DIR.as_posix(), f"pass {n:02d} is missing")
    summaries: list[dict] = []
    if result.exit_code == EXIT_OK:
        passes: list[Pass] = []
        for n in numbers:
            try:
                passes.append(parse_pass(folder / f"pass-{n:02d}.md"))
            except PassFormatError as exc:
                result.fail("E-PASS-FORMAT", f"pass-{n:02d}.md", str(exc))
        if result.exit_code == EXIT_OK:
            earlier: set[str] = set()
            for p in passes:
                check_pass_shape(root, p, earlier, result, grep)
                summaries.append({"pass": p.number, "queries": len(p.queries), "hits": len(p.hits),
                                  "new": sum(1 for r in p.hits if r.identity not in earlier),
                                  "outcomes": dict(Counter(r.outcome for r in p.hits))})
                earlier |= {r.identity for r in p.hits}
            classification = check_hits(root, passes)
            result.problems += classification.problems
            result.exit_code = max(result.exit_code, classification.exit_code)
            for problem in check_seed(root, passes):
                result.fail(problem.code, problem.subject, problem.detail)
            for problem in check_findings(root, passes):
                result.fail(problem.code, problem.subject, problem.detail)
            final = check_stop_rule(passes, result, require_final)
            result.data["final_pass"], result.data["final_reason"] = final.final_pass, final.reason
    after = snapshot(root)
    for name in sorted(set(before) | set(after)):
        if before.get(name, "absent") != after.get(name, "absent"):
            result.fail("E-AUDIT-WROTE", name, "the audit changed a file outside the audit folder")
    result.data["passes"] = summaries
    write_report(root, "audit", result)
    return result


def audit_run(root: Path, number: int, grep=git_grep, snapshot=tree_snapshot) -> Result:
    """Run the queries of pass NN and write each query's hits (file, line, function) to reports/audit-hits-NN.json."""
    result = Result()
    before = snapshot(root)
    path = root / AUDIT_DIR / f"pass-{number:02d}.md"
    if not path.exists():
        result.fail("E-AUDIT-NONE", path.name, "no such pass file")
        return result
    try:
        found = run_queries(root, parse_pass(path), grep)
    except PassFormatError as exc:
        result.fail("E-PASS-FORMAT", path.name, str(exc))
        return result
    after = snapshot(root)
    for name in sorted(set(before) | set(after)):
        if before.get(name, "absent") != after.get(name, "absent"):
            result.fail("E-AUDIT-WROTE", name, "the audit changed a file outside the audit folder")
    result.data["pass"] = number
    result.data["queries"] = {q: [vars(h) for h in hits] for q, hits in found.items()}
    write_report(root, f"audit-hits-{number:02d}", result)
    return result


RECONCILING_COMMANDS = ("stage", "report-deletion", "check-stubs", "check-coverage")      # these read the stage, so they check it against the set first
SCOPED_COMMANDS = ("check-cuts", "apply-cuts", "check-stubs", "report-deletion", "check-coverage", "stage", "check-touched-set")    # the ones that act on the whole list


def scope_line(root: Path) -> str:
    """Which list a command acts on, printed first: the whole epic's touched set, never one story's slice of it."""
    entries = read_toml(root / TOUCHED_FILE).get("entry", [])
    return f"scope: whole touched set, {len(entries)} entries in {len({e['file'] for e in entries})} files"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="the repository root (default: the current directory)")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (("check-register", "every test in exactly one use case"),
                       ("check-touched-set", "the committed whole touched set equals the scan"),
                       ("check-stubs", "every function in the whole touched set is a stub"),
                       ("fates", "every old test has one fate, every contract area a new test seen red; --render PATH writes the table"),
                       ("check-coverage", "run each language's suite under coverage: 100% of lines and branches of every file in the whole touched set"),
                       ("report-deletion", "every assigned test failed against the stubs of the whole touched set, read from the files run-suites wrote"),
                       ("run-suites", "run each language's suite with result output on (failing tests are data, not an error)"),
                       ("audit-check", "every audit pass is well formed, gives the hits its recorded queries give, and marks its new hits correctly"),
                       ("measure-touch", "run the Python suite under coverage, a context per test, to learn which tests touch the touched set")):
        sub.add_parser(name, help=text.replace("%", "%%"), description=text)       # help is %-formatted by argparse, a description is not
    build = sub.add_parser("build-touched-set", help="print the touched set the scan derives (never writes touched_set.toml)")
    build.add_argument("--propose", action="store_true", help="required: the proposal is only ever printed")
    sub.choices["fates"].add_argument("--render", help="write the fates table (Markdown) to this path")
    sub.choices["audit-check"].add_argument("--require-final", action="store_true", help="exit 1 unless the latest pass is final")
    sub.add_parser("audit-run", help="run the queries of audit pass NN and write their hits to reports/audit-hits-NN.json").add_argument("number", type=int)
    sub.add_parser("guard-idle", help="exit 0 when no job is running on the node (from `dbench status --json NODE`), 1 naming the job and story, 2 when unknown").add_argument("node")
    cuts = sub.add_parser("check-cuts", help="the cut / whole data of the whole touched set is well formed (anchors, spans, why)",
                          description="the cut / whole data of the whole touched set is well formed (anchors, spans, why)")
    cuts.add_argument("--strict", action="store_true", help="also refuse an entry that says neither `whole` nor `cut`")
    cuts.add_argument("--base", metavar="REV", help="read the anchors from this revision of each file (default: the working tree)")
    sub.choices["check-stubs"].add_argument("--base", metavar="REV", help=f"the revision the deletion started from (default: {DEFAULT_BASE_REV})")
    sub.choices["report-deletion"].add_argument("--base", metavar="REV", help=f"the revision the deletion started from (default: {DEFAULT_BASE_REV})")
    apply = sub.add_parser("apply-cuts", help="print each cut entry's function with a stand-in in place of every cut (never writes production code)",
                           description="print each cut entry's function with a stand-in in place of every cut (never writes production code)")
    apply.add_argument("--dry-run", action="store_true", help="required: the deleted form is only ever printed")
    apply.add_argument("--base", metavar="REV", help=f"the revision the cuts are read from (default: {DEFAULT_BASE_REV})")
    sub.choices["check-coverage"].add_argument("--language", choices=LANGUAGES, action="append", help="measure only this language (repeatable)")
    sub.add_parser("check-matrix", help="one use case's matrix is a full cross-product with one test per cell").add_argument("use_case")
    sub.add_parser("stage", help="print the epic's stage; with a stage name, move the whole touched set to it if its justifying check passes",
                   description="print the epic's stage; with a stage name, move the whole touched set to it if its justifying check passes").add_argument("to", nargs="?")
    sys.modules.setdefault("refactor", sys.modules[__name__])      # epic.py imports this module by name; run as a script it is __main__
    import epic
    epic.add_parsers(sub)
    args = parser.parse_args(argv)
    root = args.root
    lister = Universe()
    base_reader = git_show_reader(root, args.base) if getattr(args, "base", None) else None
    simple = {
        "check-register": lambda: check_register(root, lister),
        "check-touched-set": lambda: check_touched(root),
        "check-stubs": lambda: check_stubs(root, base_reader),
        "fates": lambda: merged(check_fates(root), check_contracts(root, read_results(root))),
        "check-coverage": lambda: check_coverage(root, languages=set(args.language) if args.language else None),
        "audit-check": lambda: check_audit(root, require_final=args.require_final),
        "run-suites": lambda: run_suites(root),
        "measure-touch": lambda: measure_touch(root),
    }
    try:
        if args.command in SCOPED_COMMANDS:
            print(scope_line(root))
        if args.command in RECONCILING_COMMANDS:
            moved = reconcile_stage(root)
            if moved.exit_code != EXIT_OK:
                print_result(args.command, moved)
                return moved.exit_code
        if args.command == "stage" and args.to is None:
            print(read_stage(root))
            return EXIT_OK
        if args.command == "fates" and args.render:
            Path(args.render).parent.mkdir(parents=True, exist_ok=True)
            Path(args.render).write_text(render_fates(root))
        if args.command == "build-touched-set":
            if not args.propose:
                print("build-touched-set: only --propose is supported; the committed set is changed by hand after review")
                return EXIT_ERROR
            for e in propose_touched(root):
                print(f"{e.language}  {e.file}::{e.function}  {','.join(e.classes)}")
            return EXIT_OK
        if args.command in epic.COMMAND_NAMES:
            result = epic.run_command(root, args)
        elif args.command == "check-matrix":
            result = check_matrix(root, args.use_case, lister)
        elif args.command == "check-cuts":
            result = check_cuts(root, strict=args.strict, base=base_reader)
        elif args.command == "apply-cuts":
            if not args.dry_run:
                print("apply-cuts: only --dry-run is supported; the deletion is made by hand in the working tree")
                return EXIT_ERROR
            result = apply_cuts(root, base_reader)
            for subject, text in result.data["entries"].items():
                print(f"--- {subject}\n{text}", end="")
        elif args.command == "report-deletion":
            result = report_deletion(root, read_results(root), base_reader)
        elif args.command == "audit-run":
            result = audit_run(root, args.number)
        elif args.command == "guard-idle":
            result = run_guard_idle(args.node)
        elif args.command == "stage":
            result = move_stage(root, args.to, default_justifiers(lister))
        else:
            result = simple[args.command]()
    except AdapterError as exc:
        print(f"{args.command}: UNDECIDED\n  E-ADAPTER  {exc}")
        return EXIT_ERROR
    except StageFileCorrupt as exc:
        print(f"{args.command}: UNDECIDED\n  E-STAGE-FILE-CORRUPT  {STAGE_FILE}  left as it is: {exc}")
        return EXIT_ERROR
    print_result(args.command, result)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
