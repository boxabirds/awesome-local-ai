"""lake_runs: a read-only library that reads benchmark runs from the lake (story 21), Python half.

The lake is two folders, a collected folder (collected/<node>/combinations/.../<run>) and a reference folder
(reference/<pack>/<stack>/<run>). This module lists the runs in it, returns a run's records, a story's log and the
run's completeness, makes a working copy of a run's code at a story from its workspace.bundle, and names anything
missing, unreadable or damaged as a typed answer. It writes nothing into a lake: the only things it ever creates are
the working copy a caller asks for (in a folder outside the lake) and the report the compare-git command is told to
write. The Rust crate tools/bench-lake is the other half; `python3 lake_runs.py <STATE_DIR> <question...>` prints the
same bytes as `bench-lake <STATE_DIR> <question...>` for the same lake and question. tools/bench-lake/CANONICAL.md is
the contract between the two.

Importing this module has no effects: it reads no environment, makes no folder and starts no process. It uses the
standard library only, and does not import roots.py or drive.py (which have effects at import), so a tool such as
ops/monitor/monitor.py can import it by adding this folder to sys.path.

Every call answers with a value (`Found`) or a typed `Absent` (the run, the thing asked for, a stable code); a caller's
mistake or a tool failure on a working copy is a `Refused`. Nothing here raises on a missing, damaged or unexpected
file, and nothing looks in another copy of a run or substitutes a value.
"""
from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import zlib
from pathlib import PurePath
from typing import Any, Callable, Iterator

# ---------------------------------------------------------------------------------------------------------- constants

EXIT_OK = 0
EXIT_DEFECT = 1
EXIT_QUESTION = 2
EXIT_NOT_RUN = 3

PROGRAM = "bench-lake"
MAX_PART_LEN = 64
COMBINATION_DEPTH = 9          # levels below `combinations`: family, version, variant, os, machine, engine-client, benchmarks, pack, run
BENCHMARKS_LEVEL = 7           # the 1-based level that must be the literal `benchmarks`
ENGINE_CLIENT_LEVEL = 6        # the 1-based level whose name must contain a dash
REFERENCE_DEPTH = 3            # pack, stack, run
COMBINATIONS_DIR = "combinations"
BENCHMARKS_DIR = "benchmarks"
REFERENCE_ID_PREFIX = "benchmarks/reference/"
COLLECTED_LABEL = "collected"
REFERENCE_LABEL = "reference"
MARKER_COLLECTION = "collection.json"
MARKER_RUN = "run.json"
NODE_SEPARATOR = "@"

MAX_STORY = 999
MIN_STORY = 0
STORY_MIN_DIGITS = 2
INT64_MIN = -(2 ** 63)
INT64_MAX = 2 ** 63 - 1
UINT64_MAX = 2 ** 64 - 1
INT64_MAX_DIGITS = 19          # a decimal integer of more digits than this is outside 64 bits
UINT64_MAX_DIGITS = 20
MAX_JSON_DEPTH = 127           # a document nested deeper than this is not valid (the Rust reader's limit)
COMMIT_LEN = 40
CHUNK_BYTES = 64 * 1024
GZIP_INPUT_BYTES = 16 * 1024   # compressed bytes fed to the decoder at a time (bounds what one step can inflate)
GZIP_WBITS = zlib.MAX_WBITS | 16        # zlib's window bits plus 16: a gzip wrapper, with its header, CRC and length checked
LINE_FEED = b"\n"
POSITIONAL_MIN = 1e-5          # a float below this, or at or above POSITIONAL_MAX, is printed in scientific notation
POSITIONAL_MAX = 1e16

FIRST_LEVEL = 1                # the first level of a walk (the entries of the walk's root folder)
ROOT_FOLDER_DEPTH = 0          # the depth of the walk's own root folder: an empty one is not a chain that ends too early
STORY_RECORD_PARTS = 3         # stories/<NN>/<file>
RESCORE_RECORD_PARTS = 3       # rescore/<version>/rescore.json
RESCORE_ACCEPT_PARTS = 5       # rescore/<version>/stories/<NN>/accept-summary.json
ROOTS_FLAG_WORDS = 3           # --roots <COLLECTED> <REFERENCE>
RECORD_MIN_WORDS = 3           # record <run> <name>
BETTER, WORSE, EQUAL = 1, -1, 0    # how compare_copies ranks its first argument against its second
ARGV_FIRST = 1                 # sys.argv[0] is the program

DEFAULT_REV = "origin/main"
NULL_DEVICE = "/dev/null"
BUNDLE_FILE = "workspace.bundle"
RAW_LOG = "agent-events.jsonl"
COMPACT_LOG = "agent-events.compact.jsonl.gz"
STORIES_DIR = "stories"
RESCORE_DIR = "rescore"
ITEM_RESCORE_VERSIONS = "rescore-versions"

CODE_NO_RUN = "E-LAKE-NO-RUN"
CODE_NOT_COLLECTED = "E-LAKE-NOT-COLLECTED"
CODE_NOT_A_FILE = "E-LAKE-NOT-A-FILE"
CODE_UNREADABLE = "E-LAKE-UNREADABLE"
CODE_MALFORMED = "E-LAKE-MALFORMED"
CODE_BAD_NAME = "E-LAKE-BAD-NAME"
CODE_DEST_INSIDE_ROOT = "E-LAKE-DEST-INSIDE-ROOT"
CODE_DEST_NOT_EMPTY = "E-LAKE-DEST-NOT-EMPTY"
CODE_GIT_FAILED = "E-LAKE-GIT-FAILED"

CODE_NOT_A_FOLDER = "E-LAKE-NOT-A-FOLDER"
CODE_STRAY = "E-LAKE-STRAY"
CODE_SHALLOW = "E-LAKE-SHALLOW"
CODE_BAD_PART = "E-LAKE-BAD-PART"
CODE_NO_MARKER = "E-LAKE-NO-MARKER"

DETAIL_NO_RUN = "no run with this id"
DETAIL_NOT_COLLECTED = "no such file"
DETAIL_NOT_A_FILE = "not a regular file"
DETAIL_PERMISSION = "permission denied"
DETAIL_IO = "io error"
DETAIL_NOT_JSON = "not valid JSON"
DETAIL_NOT_UTF8 = "not valid UTF-8"
DETAIL_NOT_GZIP = "not valid gzip"
DETAIL_STORY_RANGE = "story out of range"
DETAIL_VERSION = "version not valid"
DETAIL_NOT_OBJECT = "note is not an object"
DETAIL_COMPLETE_NOT_BOOL = "complete is not a boolean"
DETAIL_NO_COMMIT = "no commit for story"
DETAIL_BAD_COMMIT = "commit is not 40 hexadecimal characters"
DETAIL_COMMIT_NOT_IN_BUNDLE = "commit not in bundle"
DETAIL_INSIDE_ROOT = "destination is inside the lake"
DETAIL_NOT_EMPTY = "destination is not empty"
DETAIL_CLONE_FAILED = "git clone failed"
DETAIL_CHECKOUT_FAILED = "git checkout failed"
TEXT_NO_NODE = "-"

KIND_COMBINATION = "combination"
KIND_REFERENCE = "reference"
FORM_RAW = "raw"
FORM_COMPACT = "compact"
COMPLETE = "complete"
INCOMPLETE = "incomplete"
NO_NOTE = "no-note"

DIFF_DIFFERS = "differs"
DIFF_LAKE_ABSENT = "lake-absent"
DIFF_REPOSITORY_ABSENT = "repository-absent"

FLAG_ROOTS = "--roots"
FLAG_REV = "--rev"
FLAG_REPORT = "--report"

_PART_RE = re.compile(r"[A-Za-z0-9._-]{1,%d}" % MAX_PART_LEN)
_STORY_ARG_RE = re.compile(r"-?[0-9]+")
_COMMIT_RE = re.compile(r"[0-9a-fA-F]{%d}" % COMMIT_LEN)
_STORY_DIR_RE = re.compile(r"[0-9]+")
_SIGNED_INT_RE = re.compile(r"[+-]?[0-9]+")
_SURROGATE_RE = re.compile("[\ud800-\udfff]")
_STRUCTURE_RE = re.compile(r'"[^"\\]*(?:\\.[^"\\]*)*"|[\[\]{}]', re.DOTALL)
_ESCAPE_RE = re.compile('["\\\\\x00-\x1f]')
_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


class QuestionError(Exception):
    """A malformed question of the command (not a missing or damaged file): exit code 2, a line on standard error."""


# ---------------------------------------------------------------------------------------------- answers: found, absent

@dataclasses.dataclass(frozen=True)
class Found:
    """The value that was asked for."""
    value: Any


@dataclasses.dataclass(frozen=True)
class BadName:
    """A story or version that cannot name a file (returned by Record.relative_path)."""
    detail: str


@dataclasses.dataclass(frozen=True)
class ParseError:
    """A document that is not valid: the fixed detail, and the parser's own message (not part of the canonical form)."""
    detail: str
    message: str


def _object(run: str, node: str | None, item: str, code: str, detail: str) -> dict:
    return {"code": code, "detail": detail, "item": item, "node": node, "run": run}


@dataclasses.dataclass(frozen=True)
class Absent:
    """Something that is not there or cannot be used. `item` is what was asked for (`run`, `record:accept:1`, `log:2`,
    `bundle`, `workspace:1`). `message` is the parser's or the operating system's own words: not part of the canonical
    form and not part of equality."""
    run: str
    node: str | None
    item: str
    code: str
    detail: str
    message: str | None = dataclasses.field(default=None, compare=False)

    def to_text(self) -> str:
        node = self.node if self.node is not None else TEXT_NO_NODE
        return f"run={self.run} node={node} item={self.item} code={self.code} detail={self.detail}"

    def to_value(self) -> dict:
        return _object(self.run, self.node, self.item, self.code, self.detail)

    def to_json(self) -> str:
        return canonical(self.to_value())


@dataclasses.dataclass(frozen=True)
class Refused:
    """A caller's mistake or a tool failure on a working copy; never returned for missing data."""
    run: str
    node: str | None
    item: str
    code: str
    detail: str
    message: str | None = dataclasses.field(default=None, compare=False)

    def to_value(self) -> dict:
        return _object(self.run, self.node, self.item, self.code, self.detail)

    def to_json(self) -> str:
        return canonical(self.to_value())


def _absent(run: RunRef, item: str, code: str, detail: str, message: str | None = None) -> Absent:
    return Absent(run.id, run.node, item, code, detail, message)


@dataclasses.dataclass(frozen=True)
class _Problem:
    """Why a file could not be opened as a regular file."""
    kind: str                     # "missing", "not-a-file" or "unreadable"
    detail: str = ""
    message: str | None = None


_MISSING = "missing"
_NOT_A_FILE = "not-a-file"
_UNREADABLE = "unreadable"


def _unreadable(error: BaseException) -> _Problem:
    """The operating system refused: `permission denied` for EACCES and EPERM, `io error` for anything else."""
    detail = DETAIL_PERMISSION if isinstance(error, PermissionError) else DETAIL_IO
    return _Problem(_UNREADABLE, detail, str(error))


def _absent_for(run: RunRef, item: str, problem: _Problem) -> Absent:
    if problem.kind == _MISSING:
        return _absent(run, item, CODE_NOT_COLLECTED, DETAIL_NOT_COLLECTED)
    if problem.kind == _NOT_A_FILE:
        return _absent(run, item, CODE_NOT_A_FILE, DETAIL_NOT_A_FILE)
    return _absent(run, item, CODE_UNREADABLE, problem.detail, problem.message)


def _open_regular(base: str, rel: str):
    """Opens base/rel for reading only if it is a regular file and no folder of rel is a link: the open file, or a
    _Problem."""
    current = base
    parts = rel.split("/")
    for index, part in enumerate(parts):
        current = os.path.join(current, part)
        try:
            mode = os.lstat(current).st_mode
        except FileNotFoundError:
            return _Problem(_MISSING)
        except (OSError, ValueError) as error:
            return _unreadable(error)
        wanted = stat.S_ISREG(mode) if index == len(parts) - 1 else stat.S_ISDIR(mode)
        if not wanted:
            return _Problem(_NOT_A_FILE)
    try:
        return open(current, "rb")
    except FileNotFoundError:
        return _Problem(_MISSING)
    except (OSError, ValueError) as error:
        return _unreadable(error)


def _read_regular(base: str, rel: str):
    """All the bytes of base/rel under the rules of _open_regular: bytes, or a _Problem."""
    opened = _open_regular(base, rel)
    if isinstance(opened, _Problem):
        return opened
    try:
        with opened:
            return opened.read()
    except OSError as error:
        return _unreadable(error)


# ------------------------------------------------------------------------------------------------- names and ranges

def is_valid_part(part: str) -> bool:
    """The part rule: 1 to 64 characters of [A-Za-z0-9._-], not only dots."""
    return _PART_RE.fullmatch(part) is not None and part.strip(".") != ""


def is_valid_version(version: str) -> bool:
    """A rescore version follows the part rule."""
    return is_valid_part(version)


def story_dir(story: int) -> str | None:
    """The folder name of a story (at least two digits), or None for a story outside 0 to 999."""
    if MIN_STORY <= story <= MAX_STORY:
        return f"{story:0{STORY_MIN_DIGITS}d}"
    return None


def parse_story_arg(text: str) -> int:
    """A story argument of the command: `^-?[0-9]+$`, clamped to the 64-bit range (anything outside 0 to 999 is a bad
    name later, whatever its size). Raises QuestionError for anything else."""
    if _STORY_ARG_RE.fullmatch(text) is None:
        raise QuestionError(f"{json.dumps(text)} is not a story number")
    negative = text.startswith("-")
    digits = (text[1:] if negative else text).lstrip("0") or "0"
    if len(digits) > INT64_MAX_DIGITS:
        return INT64_MIN if negative else INT64_MAX
    number = -int(digits) if negative else int(digits)
    return max(INT64_MIN, min(INT64_MAX, number))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------------------------------- canonical JSON

def format_float(x: float) -> str:
    """CANONICAL.md section 2: the shortest digits that read back to the same double; positional notation (with `.0`
    appended to an integer value) when 1e-5 <= |x| < 1e16, otherwise `d[.ddd]e<sign>N`."""
    if x == 0:
        return "-0.0" if math.copysign(1.0, x) < 0 else "0.0"
    sign = "-" if x < 0 else ""
    shortest = repr(abs(x))
    mantissa, _, exponent = shortest.partition("e")
    int_part, _, frac_part = mantissa.partition(".")
    digits = int_part + frac_part
    point = len(int_part) + (int(exponent) if exponent else 0)       # the value is 0.<digits> x 10^point
    trimmed = digits.lstrip("0")
    point -= len(digits) - len(trimmed)
    digits = trimmed.rstrip("0")
    scientific_exponent = point - 1
    if POSITIONAL_MIN <= abs(x) < POSITIONAL_MAX:
        if scientific_exponent >= 0:
            whole = digits[: scientific_exponent + 1].ljust(scientific_exponent + 1, "0")
            body = f"{whole}.{digits[scientific_exponent + 1:] or '0'}"
        else:
            body = "0." + "0" * (-scientific_exponent - 1) + digits
    else:
        lead = digits[0] + ("." + digits[1:] if len(digits) > 1 else "")
        body = f"{lead}e{'+' if scientific_exponent >= 0 else '-'}{abs(scientific_exponent)}"
    return sign + body


def _write_string(text: str) -> str:
    return '"' + _ESCAPE_RE.sub(lambda m: _ESCAPES.get(m.group(0)) or "\\u%04x" % ord(m.group(0)), text) + '"'


def canonical(value: Any) -> str:
    """The canonical text of a JSON value (CANONICAL.md section 2): keys sorted by their UTF-8 bytes, no whitespace,
    minimal escapes, numbers as format_float and decimal digits."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return format_float(value)
    if isinstance(value, str):
        return _write_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-8"))
        return "{" + ",".join(_write_string(k) + ":" + canonical(value[k]) for k in keys) + "}"
    raise TypeError(f"{type(value).__name__} is not a JSON value")


def _finite(x: float) -> float:
    if math.isinf(x) or math.isnan(x):
        raise ValueError("number out of range")
    return x


def _parse_int(token: str) -> int | float:
    """An integer token that fits a signed or unsigned 64-bit integer stays an integer; any other is a double. The token
    `-0` is the double -0.0."""
    if token == "-0":
        return -0.0
    if len(token) - token.startswith("-") <= UINT64_MAX_DIGITS:
        number = int(token)
        if INT64_MIN <= number <= UINT64_MAX:
            return number
    return _finite(float(token))


def _parse_float(token: str) -> float:
    return _finite(float(token))


def _refuse_constant(token: str) -> Any:
    raise ValueError(f"{token} is not JSON")


def _nesting_too_deep(text: str) -> bool:
    depth = 0
    for token in _STRUCTURE_RE.finditer(text):
        char = token.group(0)
        if char in "[{":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                return True
        elif char in "]}":
            depth -= 1
    return False


def _has_lone_surrogate(value: Any) -> bool:
    """A string with a surrogate in it came from an escape that was not half of a valid pair: not valid JSON text."""
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if _SURROGATE_RE.search(item):
                return True
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, dict):
            for key, child in item.items():
                if _SURROGATE_RE.search(key):
                    return True
                stack.append(child)
    return False


def parse_json(data: bytes) -> Found | ParseError:
    """Reads bytes as strict UTF-8 JSON: one document, no byte order mark, no trailing comma, comment or text after it,
    no NaN or Infinity, nested at most 127 deep. A key that occurs twice keeps the last value. Found(value) or a
    ParseError."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        return ParseError(DETAIL_NOT_UTF8, str(error))
    if _nesting_too_deep(text):
        return ParseError(DETAIL_NOT_JSON, "recursion limit exceeded")
    try:
        value = json.loads(text, parse_int=_parse_int, parse_float=_parse_float, parse_constant=_refuse_constant)
    except (ValueError, RecursionError) as error:
        return ParseError(DETAIL_NOT_JSON, str(error))
    if _has_lone_surrogate(value):
        return ParseError(DETAIL_NOT_JSON, "lone surrogate in a string")
    return Found(value)


# ------------------------------------------------------------------------------------------------------------ records

_FILE_RUN = "run.json"
_FILE_STATUS = "run-status.json"
_FILE_METRICS = "metrics.json"
_FILE_FINALIZE = "finalize.json"
_FILE_PROGRESS = "progress.json"
_FILE_COLLECTION = "collection.json"
_FILE_RESCORE = "rescore.json"
_FILE_ACCEPT = "accept-summary.json"
_FILE_PROMPT = "prompt.md"
_FILE_BASE_COMMIT = "base-commit"
_FILE_GATE = "gate.json"

_PLAIN_FILES = {
    "run-description": _FILE_RUN, "status": _FILE_STATUS, "metrics": _FILE_METRICS, "finalize": _FILE_FINALIZE,
    "progress": _FILE_PROGRESS, "collection": _FILE_COLLECTION,
}
_STORY_FILES = {"accept": _FILE_ACCEPT, "prompt": _FILE_PROMPT, "base-commit": _FILE_BASE_COMMIT, "gate": _FILE_GATE}
_FILE_TO_STORY_NAME = {file: name for name, file in _STORY_FILES.items()}
_TEXT_RECORDS = ("prompt", "base-commit")
_RECORD_ARITY = {**{name: 0 for name in _PLAIN_FILES}, **{name: 1 for name in _STORY_FILES}, "rescore": 1,
                 "rescore-accept": 2}      # how many arguments (a story, a version) each record name takes


@dataclasses.dataclass(frozen=True)
class Record:
    """A record, named by a value and never by a path. `name` is the command-line name (`status`, `rescore-accept`,
    ...); `version` and `story` are set for the records that take them."""
    name: str
    version: str | None = None
    story: int | None = None

    def item_name(self) -> str:
        """The canonical item text after `record:` (`accept:1`)."""
        if self.name == "rescore":
            return f"{self.name}:{self.version}"
        if self.name == "rescore-accept":
            return f"{self.name}:{self.version}:{self.story}"
        if self.name in _STORY_FILES:
            return f"{self.name}:{self.story}"
        return self.name

    def relative_path(self) -> Found | BadName:
        """Found(the file relative to the run folder), or BadName for a story or version out of range."""
        if self.name in _PLAIN_FILES:
            return Found(_PLAIN_FILES[self.name])
        if self.name in ("rescore", "rescore-accept"):
            if not is_valid_version(self.version or ""):
                return BadName(DETAIL_VERSION)
            base = f"{RESCORE_DIR}/{self.version}"
            if self.name == "rescore":
                return Found(f"{base}/{_FILE_RESCORE}")
            folder = story_dir(self.story)
            if folder is None:
                return BadName(DETAIL_STORY_RANGE)
            return Found(f"{base}/{STORIES_DIR}/{folder}/{_FILE_ACCEPT}")
        folder = story_dir(self.story)
        if folder is None:
            return BadName(DETAIL_STORY_RANGE)
        return Found(f"{STORIES_DIR}/{folder}/{_STORY_FILES[self.name]}")

    def is_text(self) -> bool:
        """True for `prompt` and `base-commit`."""
        return self.name in _TEXT_RECORDS

    @staticmethod
    def from_relative_path(path: str) -> "Record | None":
        """The record a run-relative path names, if any (`stories/01/gate.json` is gate(1)). A name that begins with a dot
        names none, so a transfer in progress is never a record."""
        parts = path.split("/")

        def story_of(name: str) -> int | None:
            if _STORY_DIR_RE.fullmatch(name) is None or len(name) > len(str(MAX_STORY)):
                return None
            number = int(name)
            return number if story_dir(number) == name else None

        for name, file in _PLAIN_FILES.items():
            if parts == [file]:
                return Record(name)
        if len(parts) == STORY_RECORD_PARTS and parts[0] == STORIES_DIR:
            _, folder, file = parts
            story = story_of(folder)
            return None if story is None or file not in _FILE_TO_STORY_NAME else Record(_FILE_TO_STORY_NAME[file], story=story)
        if len(parts) == RESCORE_RECORD_PARTS and parts[0] == RESCORE_DIR:
            _, version, file = parts
            return Record("rescore", version=version) if file == _FILE_RESCORE and is_valid_version(version) else None
        if len(parts) == RESCORE_ACCEPT_PARTS and parts[0] == RESCORE_DIR:
            _, version, stories, folder, file = parts
            story = story_of(folder)
            if stories == STORIES_DIR and file == _FILE_ACCEPT and is_valid_version(version) and story is not None:
                return Record("rescore-accept", version=version, story=story)
        return None

    @staticmethod
    def from_words(name: str, args: list[str]) -> "Record":
        """The record named by a command's words. Raises QuestionError for a malformed question."""
        arity = _RECORD_ARITY.get(name)
        if arity is None:
            raise QuestionError(f"unknown record name {name}")
        if len(args) != arity:
            raise QuestionError(f"record {name} takes {arity} argument(s), got {len(args)}")
        if name in _PLAIN_FILES:
            return Record(name)
        if name in _STORY_FILES:
            (story,) = args
            return Record(name, story=parse_story_arg(story))
        if name == "rescore":
            (version,) = args
            return Record(name, version=version)
        version, story = args
        return Record(name, version=version, story=parse_story_arg(story))


RUN_DESCRIPTION = Record("run-description")
STATUS = Record("status")
METRICS = Record("metrics")
FINALIZE = Record("finalize")
PROGRESS = Record("progress")
COLLECTION = Record("collection")


def rescore(version: str) -> Record:
    return Record("rescore", version=version)


def rescore_accept(version: str, story: int) -> Record:
    return Record("rescore-accept", version=version, story=story)


def accept(story: int) -> Record:
    return Record("accept", story=story)


def prompt(story: int) -> Record:
    return Record("prompt", story=story)


def base_commit(story: int) -> Record:
    return Record("base-commit", story=story)


def gate(story: int) -> Record:
    return Record("gate", story=story)


# ---------------------------------------------------------------------------------------------------- runs and copies

@dataclasses.dataclass(frozen=True)
class RunRef:
    """One copy of a run: one per node folder for a combination run, the only one for a reference run. `dir` is the run
    folder on disk; `label` is its place relative to its root, with the root's label first (what the command prints)."""
    kind: str
    node: str | None
    id: str
    dir: str
    label: str

    def to_value(self) -> dict:
        return {"dir": self.label, "id": self.id, "kind": self.kind, "node": self.node}


@dataclasses.dataclass(frozen=True)
class Rejected:
    """A folder that is not a run, with the reason."""
    path: str
    label: str
    code: str


@dataclasses.dataclass
class Discovery:
    runs: list = dataclasses.field(default_factory=list)
    rejected: list = dataclasses.field(default_factory=list)
    missing_roots: list = dataclasses.field(default_factory=list)


@dataclasses.dataclass(frozen=True)
class CopyNote:
    """The facts of a copy's note that the ranking uses."""
    node: str
    has_note: bool
    complete: bool
    files: int
    settled_at: float | None


def _float_order(x: float) -> tuple[float, float]:
    return (x, math.copysign(1.0, x))              # -0.0 sorts below 0.0, as a total order of doubles does


def compare_copies(a: CopyNote, b: CopyNote) -> int:
    """BETTER (1) when `a` is the better copy, WORSE (-1) when `b` is, EQUAL (0) when they rank equal: a note, complete,
    more files, later settled (a missing settled_at is lowest), then the smaller node name."""
    for left, right in ((a.has_note, b.has_note), (a.complete, b.complete), (a.files, b.files)):
        if left != right:
            return BETTER if left > right else WORSE
    if a.settled_at is None and b.settled_at is not None:
        return WORSE
    if a.settled_at is not None and b.settled_at is None:
        return BETTER
    if a.settled_at is not None and b.settled_at is not None:
        left_time, right_time = _float_order(a.settled_at), _float_order(b.settled_at)
        if left_time != right_time:
            return BETTER if left_time > right_time else WORSE
    left_node, right_node = a.node.encode("utf-8"), b.node.encode("utf-8")
    if left_node != right_node:
        return BETTER if right_node > left_node else WORSE
    return EQUAL


def _number_or_none(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


@dataclasses.dataclass(frozen=True)
class Completeness:
    """`kind` is `complete`, `incomplete` or `no-note`; the note's run_status.state and its two times are None when the
    note has none (or not of the right type)."""
    kind: str
    state: str | None = None
    settled_at: int | float | None = None
    collected_at: int | float | None = None


def decide(note: Any) -> Completeness | str:
    """The decision over a parsed note (pure): a Completeness, or the fixed detail of why the note is malformed."""
    if not isinstance(note, dict):
        return DETAIL_NOT_OBJECT
    complete = note.get("complete")
    if not isinstance(complete, bool):
        return DETAIL_COMPLETE_NOT_BOOL
    status = note.get("run_status")
    state = status.get("state") if isinstance(status, dict) else None
    return Completeness(
        kind=COMPLETE if complete else INCOMPLETE,
        state=state if isinstance(state, str) else None,
        settled_at=_number_or_none(note.get("settled_at")),
        collected_at=_number_or_none(note.get("collected_at")),
    )


@dataclasses.dataclass(frozen=True)
class Workspace:
    """A working copy of a run's code with a story's commit checked out. `path` is the destination as it was given."""
    path: Any
    commit: str


@dataclasses.dataclass(frozen=True)
class Digest:
    """Length, line count and SHA-256 of a log's decoded stream."""
    length: int
    lines: int
    sha256: str


# ------------------------------------------------------------------------------------------------------------- logs

class _MultiMemberGzip(io.RawIOBase):
    """The decoded bytes of a gzip file of one or more members, read as a stream. As strict as the Rust reader: a file
    with no member at all, bytes after the last member that do not start another, a member cut short and a failed
    checksum are each an error (zlib.error or EOFError), reported where they are met, after the bytes already delivered."""

    def __init__(self, file) -> None:
        super().__init__()
        self._file = file
        self._decoder: Any = None
        self._input = b""
        self._pending = bytearray()
        self._members = 0
        self._done = False

    def readable(self) -> bool:
        return True

    def _fill(self) -> None:
        if self._decoder is None:
            if not self._input:
                self._input = self._file.read(GZIP_INPUT_BYTES)
            if not self._input:
                if self._members == 0:
                    raise EOFError("a gzip file has at least one member")
                self._done = True
                return
            self._decoder = zlib.decompressobj(GZIP_WBITS)
            self._members += 1
        elif not self._input:
            self._input = self._file.read(GZIP_INPUT_BYTES)
            if not self._input:
                raise EOFError("compressed file ended before the end-of-stream marker was reached")
        self._pending += self._decoder.decompress(self._input)
        if self._decoder.eof:
            self._input = self._decoder.unused_data
            self._decoder = None
        else:
            self._input = b""

    def readinto(self, buffer) -> int:
        while not self._pending and not self._done:
            self._fill()
        count = min(len(buffer), len(self._pending))
        buffer[:count] = self._pending[:count]
        del self._pending[:count]
        return count


class _Stream:
    """A reader of a log's decoded bytes: the file as it is, or the gunzipped file."""

    def __init__(self, file, compact: bool) -> None:
        self._file = file
        self._reader = io.BufferedReader(_MultiMemberGzip(file), CHUNK_BYTES) if compact else file

    def read(self, size: int = -1) -> bytes:
        return self._reader.read(size)

    def readline(self) -> bytes:
        return self._reader.readline()

    def close(self) -> None:
        if self._reader is not self._file:
            self._reader.close()
        self._file.close()


_DAMAGED_GZIP = (EOFError, zlib.error)


class Log:
    """A story's conversation log in the form the lake holds: the raw log as it is, or the compacted log decoded."""

    def __init__(self, run_id: str, node: str | None, story: int, form: str, path: str) -> None:
        self.run_id = run_id
        self.node = node
        self.story = story
        self.form = form
        self.path = path

    def _absent(self, code: str, detail: str, message: str | None = None) -> Absent:
        return Absent(self.run_id, self.node, f"log:{self.story}", code, detail, message)

    def _read_error(self, error: BaseException) -> Absent:
        if self.form == FORM_COMPACT and isinstance(error, _DAMAGED_GZIP):
            return self._absent(CODE_MALFORMED, DETAIL_NOT_GZIP, str(error))
        problem = _unreadable(error)
        return self._absent(CODE_UNREADABLE, problem.detail, problem.message)

    def _open(self):
        """The stream, or an Absent."""
        try:
            file = open(self.path, "rb")
        except (OSError, ValueError) as error:
            return self._read_error(error)
        return _Stream(file, self.form == FORM_COMPACT)

    def reader(self) -> Found | Absent:
        """Found(a reader of the decoded bytes with read(), readline() and close()), or an Absent."""
        opened = self._open()
        return opened if isinstance(opened, Absent) else Found(opened)

    def bytes(self) -> Found | Absent:
        """All the decoded bytes."""
        opened = self._open()
        if isinstance(opened, Absent):
            return opened
        try:
            return Found(opened.read())
        except (OSError, EOFError, zlib.error) as error:
            return self._read_error(error)
        finally:
            opened.close()

    def lines(self) -> Iterator[Found | Absent]:
        """The lines without their line feed, one at a time (memory use is one line): Found(line) for each. A damaged
        compacted file ends the stream with an Absent E-LAKE-MALFORMED after the lines already delivered."""
        opened = self._open()
        if isinstance(opened, Absent):
            yield opened
            return
        try:
            while True:
                try:
                    line = opened.readline()
                except (OSError, EOFError, zlib.error) as error:
                    yield self._read_error(error)
                    return
                if not line:
                    return
                yield Found(line[:-1] if line.endswith(LINE_FEED) else line)
        finally:
            opened.close()

    def digest(self) -> Found | Absent:
        """Length, line count and SHA-256 of the decoded stream, streamed. A line is what ends at a line feed; a last
        piece after the final line feed counts as a line only if it is not empty."""
        opened = self._open()
        if isinstance(opened, Absent):
            return opened
        hasher = hashlib.sha256()
        length = feeds = 0
        last = LINE_FEED
        try:
            while True:
                chunk = opened.read(CHUNK_BYTES)
                if not chunk:
                    break
                hasher.update(chunk)
                length += len(chunk)
                feeds += chunk.count(LINE_FEED)
                last = chunk[-1:]
        except (OSError, EOFError, zlib.error) as error:
            return self._read_error(error)
        finally:
            opened.close()
        lines = feeds + 1 if length > 0 and last != LINE_FEED else feeds
        return Found(Digest(length, lines, hasher.hexdigest()))


# ------------------------------------------------------------------------------------------------------- the walk

@dataclasses.dataclass(frozen=True)
class _Entry:
    name: str | None          # None when the name is not valid UTF-8
    shown: str
    is_folder: bool           # a real folder; a link to one is not
    path: str


def _list(directory: str) -> list[_Entry]:
    """The entries of a folder in byte order of their names; raises OSError if it cannot be listed."""
    out = []
    with os.scandir(directory) as entries:
        for entry in entries:
            raw = os.fsencode(entry.name)
            try:
                name: str | None = raw.decode("utf-8")
            except UnicodeDecodeError:
                name = None
            shown = raw.decode("utf-8", "replace")
            out.append(_Entry(name, shown, entry.is_dir(follow_symlinks=False), entry.path))
    out.sort(key=lambda e: e.shown.encode("utf-8"))
    return out


def _is_regular_file(path: str) -> bool:
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except (OSError, ValueError):
        return False


class _Walk:
    """The walk of one root: which levels exist and how a run is named."""

    def __init__(self, depth: int, combination: bool, out: Discovery) -> None:
        self.depth = depth
        self.combination = combination
        self.out = out

    def reject(self, path: str, label: str, code: str) -> None:
        self.out.rejected.append(Rejected(path, label, code))

    def name_ok(self, level: int, name: str) -> bool:
        if not is_valid_part(name):
            return False
        if self.combination:
            if level == BENCHMARKS_LEVEL:
                return name == BENCHMARKS_DIR
            if level == ENGINE_CLIENT_LEVEL:
                return "-" in name
        return True

    def visit(self, directory: str, label: str, level: int, trail: list, node: str | None, prefix: str) -> None:
        """Walks the entries of `directory`, which are at `level` (1-based)."""
        try:
            entries = _list(directory)
        except (OSError, ValueError):
            return self.reject(directory, label, CODE_UNREADABLE)
        if not entries:
            folder_depth = level - FIRST_LEVEL
            if folder_depth != ROOT_FOLDER_DEPTH and folder_depth < self.depth:
                self.reject(directory, label, CODE_SHALLOW)
            return
        for entry in entries:
            child_label = f"{label}/{entry.shown}"
            if not entry.is_folder:
                self.reject(entry.path, child_label, CODE_NOT_A_FOLDER)
                continue
            if entry.name is None or not self.name_ok(level, entry.name):
                self.reject(entry.path, child_label, CODE_BAD_PART)
                continue
            trail.append(entry.name)
            if level == self.depth:
                if _is_regular_file(os.path.join(entry.path, MARKER_COLLECTION)) or _is_regular_file(
                        os.path.join(entry.path, MARKER_RUN)):
                    run_id = prefix + "/".join(trail)
                    if node is not None:
                        kind, run_label = KIND_COMBINATION, f"{COLLECTED_LABEL}/{node}/{run_id}"
                    else:
                        kind, run_label = KIND_REFERENCE, f"{REFERENCE_LABEL}/{'/'.join(trail)}"
                    self.out.runs.append(RunRef(kind, node, run_id, entry.path, run_label))
                else:
                    self.reject(entry.path, child_label, CODE_NO_MARKER)
            else:
                self.visit(entry.path, child_label, level + 1, trail, node, prefix)
            trail.pop()


def _absolute(path: str) -> str:
    """The path made absolute without changing its parts (no `..` is folded away, no link followed)."""
    if os.path.isabs(path):
        return path
    try:
        return os.path.join(os.getcwd(), path)
    except OSError:
        return path


def _resolve(path: Any) -> str:
    """The path with links resolved as far as it exists, `..` and `.` removed; the rest of the path is kept as it is.
    Raises OSError or ValueError for a path that cannot be made absolute."""
    text = os.fspath(path)
    if "\0" in text:
        raise ValueError("embedded null byte")
    parts = PurePath(os.path.join(os.getcwd(), text) if not os.path.isabs(text) else text).parts
    resolved, *rest = parts
    for part in rest:
        if part == "..":
            resolved = os.path.dirname(resolved)
            continue
        resolved = os.path.join(resolved, part)
        try:
            resolved = os.path.realpath(resolved, strict=True)
        except (OSError, ValueError):
            pass
    return resolved


def _starts_with(path: str, root: str) -> bool:
    root_parts = PurePath(root).parts
    return PurePath(path).parts[: len(root_parts)] == root_parts


def _sort_key(run: RunRef):
    return (run.id.encode("utf-8"), run.node is not None, (run.node or "").encode("utf-8"))


class Lake:
    """A collected folder and a reference folder, each a path (either may be missing)."""

    def __init__(self, collected: Any, reference: Any) -> None:
        self.collected = os.fspath(collected)
        self.reference = os.fspath(reference)

    @staticmethod
    def in_state_dir(directory: Any) -> "Lake":
        """`directory/collected` and `directory/reference`."""
        base = os.fspath(directory)
        return Lake(os.path.join(base, COLLECTED_LABEL), os.path.join(base, REFERENCE_LABEL))

    # -- discover

    def discover(self) -> Discovery:
        """Every run in the lake, one entry per node folder, and the folders that are not runs, in byte order."""
        d = Discovery()
        self._walk_collected(d)
        self._walk_reference(d)
        d.runs.sort(key=_sort_key)
        d.rejected.sort(key=lambda r: r.label.encode("utf-8"))
        return d

    def _walk_collected(self, d: Discovery) -> None:
        try:
            nodes = _list(self.collected)
        except FileNotFoundError:
            d.missing_roots.append(COLLECTED_LABEL)
            return
        except (OSError, ValueError):
            d.rejected.append(Rejected(self.collected, COLLECTED_LABEL, CODE_UNREADABLE))
            return
        for node in nodes:
            label = f"{COLLECTED_LABEL}/{node.shown}"
            if not node.is_folder:
                d.rejected.append(Rejected(node.path, label, CODE_NOT_A_FOLDER))
                continue
            if node.name is None or not is_valid_part(node.name):
                d.rejected.append(Rejected(node.path, label, CODE_BAD_PART))
                continue
            try:
                inside = _list(node.path)
            except (OSError, ValueError):
                d.rejected.append(Rejected(node.path, label, CODE_UNREADABLE))
                continue
            for entry in inside:
                child_label = f"{label}/{entry.shown}"
                if entry.name != COMBINATIONS_DIR:
                    d.rejected.append(Rejected(entry.path, child_label, CODE_STRAY))
                elif not entry.is_folder:
                    d.rejected.append(Rejected(entry.path, child_label, CODE_NOT_A_FOLDER))
                else:
                    walk = _Walk(COMBINATION_DEPTH, True, d)
                    walk.visit(entry.path, child_label, FIRST_LEVEL, [], node.name, COMBINATIONS_DIR + "/")

    def _walk_reference(self, d: Discovery) -> None:
        try:
            os.lstat(self.reference)
        except FileNotFoundError:
            d.missing_roots.append(REFERENCE_LABEL)
            return
        except (OSError, ValueError):
            pass
        _Walk(REFERENCE_DEPTH, False, d).visit(self.reference, REFERENCE_LABEL, FIRST_LEVEL, [], None, REFERENCE_ID_PREFIX)

    def copies(self, d: Discovery, run_id: str) -> list:
        """Every copy of the run id (one per node folder), ordered by node."""
        return [r for r in d.runs if r.id == run_id]

    def preferred(self, d: Discovery, run_id: str) -> RunRef | None:
        """The copy the ranking picks, or None when the id names no run: a copy with a note ranks above one without, a
        complete one above an incomplete one, then more files in the note, the later settled_at, the smaller node name."""
        best: tuple[RunRef, CopyNote] | None = None
        for run in self.copies(d, run_id):
            note = self.copy_note(run)
            if best is None or compare_copies(note, best[1]) == BETTER:
                best = (run, note)
        return best[0] if best else None

    def preferred_or_absent(self, d: Discovery, run_id: str) -> Found | Absent:
        """Found(the preferred copy), or the absence E-LAKE-NO-RUN."""
        run = self.preferred(d, run_id)
        if run is None:
            return Absent(run_id, None, "run", CODE_NO_RUN, DETAIL_NO_RUN)
        return Found(run)

    def find_run(self, d: Discovery, spec: str) -> Found | Absent:
        """A run given as `<id>` (the preferred copy) or `<node>@<id>` (the copy under that node folder)."""
        if NODE_SEPARATOR not in spec:
            return self.preferred_or_absent(d, spec)
        node, _, run_id = spec.partition(NODE_SEPARATOR)
        for run in d.runs:
            if run.id == run_id and run.node == node:
                return Found(run)
        return Absent(run_id, node, "run", CODE_NO_RUN, DETAIL_NO_RUN)

    def copy_note(self, run: RunRef) -> CopyNote:
        """The ranking facts of one copy, read from its note alone; a note that cannot be read or parsed counts as none."""
        node = run.node or ""
        none = CopyNote(node, False, False, 0, None)
        data = _read_regular(run.dir, MARKER_COLLECTION)
        if isinstance(data, _Problem):
            return none
        parsed = parse_json(data)
        if not isinstance(parsed, Found) or not isinstance(parsed.value, dict):
            return none
        note = parsed.value
        files = note.get("files")
        settled = _number_or_none(note.get("settled_at"))
        return CopyNote(node, True, note.get("complete") is True, len(files) if isinstance(files, dict) else 0,
                        float(settled) if settled is not None else None)

    # -- records

    def bytes(self, run: RunRef, record: Record) -> Found | Absent:
        """The exact bytes of a record's file."""
        item = f"record:{record.item_name()}"
        rel = record.relative_path()
        if isinstance(rel, BadName):
            return _absent(run, item, CODE_BAD_NAME, rel.detail)
        data = _read_regular(run.dir, rel.value)
        if isinstance(data, _Problem):
            return _absent_for(run, item, data)
        return Found(data)

    def value(self, run: RunRef, record: Record) -> Found | Absent:
        """The parsed value of a structured record; the text of `prompt` and `base-commit`."""
        got = self.bytes(run, record)
        if isinstance(got, Absent):
            return got
        item = f"record:{record.item_name()}"
        if record.is_text():
            try:
                return Found(got.value.decode("utf-8"))
            except UnicodeDecodeError as error:
                return _absent(run, item, CODE_MALFORMED, DETAIL_NOT_UTF8, str(error))
        parsed = parse_json(got.value)
        if isinstance(parsed, ParseError):
            return _absent(run, item, CODE_MALFORMED, parsed.detail, parsed.message)
        return parsed

    def rescore_versions(self, run: RunRef) -> Found | Absent:
        """The folders of `rescore/` with a valid version name, in byte order; an empty list when there is no `rescore/`."""
        item = f"record:{ITEM_RESCORE_VERSIONS}"
        directory = os.path.join(run.dir, RESCORE_DIR)
        try:
            mode = os.lstat(directory).st_mode
        except FileNotFoundError:
            return Found([])
        except (OSError, ValueError) as error:
            return _absent_for(run, item, _unreadable(error))
        if not stat.S_ISDIR(mode):
            return _absent(run, item, CODE_NOT_A_FILE, DETAIL_NOT_A_FILE)
        try:
            entries = _list(directory)
        except (OSError, ValueError) as error:
            return _absent_for(run, item, _unreadable(error))
        names = [e.name for e in entries if e.is_folder and e.name is not None and is_valid_version(e.name)]
        return Found(sorted(names, key=lambda n: n.encode("utf-8")))

    # -- logs

    def log(self, run: RunRef, story: int) -> Found | Absent:
        """The raw log when it is a regular file, otherwise the compacted log; the form is stated on the Log."""
        item = f"log:{story}"
        folder = story_dir(story)
        if folder is None:
            return _absent(run, item, CODE_BAD_NAME, DETAIL_STORY_RANGE)
        rel = lambda file: f"{STORIES_DIR}/{folder}/{file}"
        make = lambda form, file: Log(run.id, run.node, story, form, os.path.join(run.dir, rel(file)))
        raw_blocked = False
        opened = _open_regular(run.dir, rel(RAW_LOG))
        if not isinstance(opened, _Problem):
            opened.close()
            return Found(make(FORM_RAW, RAW_LOG))
        if opened.kind == _NOT_A_FILE:
            raw_blocked = True
        elif opened.kind != _MISSING:
            return _absent_for(run, item, opened)
        opened = _open_regular(run.dir, rel(COMPACT_LOG))
        if not isinstance(opened, _Problem):
            opened.close()
            return Found(make(FORM_COMPACT, COMPACT_LOG))
        if opened.kind == _MISSING and raw_blocked:
            return _absent_for(run, item, _Problem(_NOT_A_FILE))
        return _absent_for(run, item, opened)

    # -- completeness

    def completeness(self, run: RunRef) -> Found | Absent:
        """Whether the run is complete, from its collection note alone."""
        item = f"record:{COLLECTION.item_name()}"
        data = _read_regular(run.dir, MARKER_COLLECTION)
        if isinstance(data, _Problem):
            if data.kind == _MISSING:
                return Found(Completeness(kind=NO_NOTE))
            return _absent_for(run, item, data)
        parsed = parse_json(data)
        if isinstance(parsed, ParseError):
            return _absent(run, item, CODE_MALFORMED, parsed.detail, parsed.message)
        decided = decide(parsed.value)
        if isinstance(decided, str):
            return _absent(run, item, CODE_MALFORMED, decided)
        return Found(decided)

    # -- the working copy

    def workspace(self, run: RunRef, story: int, dest: Any) -> Found | Absent | Refused:
        """A working copy of the run's code at a story, made from its workspace.bundle in `dest` (outside both roots, empty
        or not there). git is started here and nowhere else, on the agent's own bundle."""
        item = f"workspace:{story}"

        def refuse(code: str, detail: str, message: str | None = None) -> Refused:
            return Refused(run.id, run.node, item, code, detail, message)

        if story_dir(story) is None:
            return _absent(run, item, CODE_BAD_NAME, DETAIL_STORY_RANGE)
        try:
            target = _resolve(dest)
        except (OSError, ValueError, TypeError) as error:
            return refuse(CODE_GIT_FAILED, DETAIL_CLONE_FAILED, str(error))
        for root in (self.collected, self.reference):
            try:
                inside = _starts_with(target, _resolve(root))
            except (OSError, ValueError):
                continue
            if inside:
                return refuse(CODE_DEST_INSIDE_ROOT, DETAIL_INSIDE_ROOT)
        try:
            mode = os.lstat(target).st_mode
        except (OSError, ValueError):
            made_by_us = True
        else:
            if not stat.S_ISDIR(mode):
                return refuse(CODE_DEST_NOT_EMPTY, DETAIL_NOT_EMPTY)
            try:
                with os.scandir(target) as entries:
                    empty = next(entries, None) is None
            except OSError:
                empty = False
            if not empty:
                return refuse(CODE_DEST_NOT_EMPTY, DETAIL_NOT_EMPTY)
            made_by_us = False
        bundle = _absolute(os.path.join(run.dir, BUNDLE_FILE))
        opened = _open_regular(run.dir, BUNDLE_FILE)
        if isinstance(opened, _Problem):
            return _absent_for(run, "bundle", opened)
        opened.close()
        metrics = self.value(run, METRICS)
        if isinstance(metrics, Absent):
            return dataclasses.replace(metrics, item=item)
        stories = metrics.value.get("stories") if isinstance(metrics.value, dict) else None
        entry = stories.get(str(story)) if isinstance(stories, dict) else None
        commit = entry.get("commit") if isinstance(entry, dict) else None
        if not isinstance(commit, str):
            return _absent(run, item, CODE_MALFORMED, DETAIL_NO_COMMIT)
        if _COMMIT_RE.fullmatch(commit) is None:
            return _absent(run, item, CODE_MALFORMED, DETAIL_BAD_COMMIT)
        clone = _git(["-c", "core.hooksPath=" + NULL_DEVICE, "clone", "--quiet", "--no-checkout", "--template=", "--",
                      bundle, target])
        if clone.returncode != 0:
            _clean_up(target, made_by_us)
            return refuse(CODE_GIT_FAILED, DETAIL_CLONE_FAILED, clone.message)
        probe = _git(["-C", target, "cat-file", "-e", commit + "^{commit}"])
        if probe.returncode != 0:
            _clean_up(target, made_by_us)
            return _absent(run, item, CODE_MALFORMED, DETAIL_COMMIT_NOT_IN_BUNDLE)
        checkout = _git(["-C", target, "-c", "core.hooksPath=" + NULL_DEVICE, "checkout", "--quiet", "--detach", commit])
        if checkout.returncode != 0:
            _clean_up(target, made_by_us)
            return refuse(CODE_GIT_FAILED, DETAIL_CHECKOUT_FAILED, checkout.message)
        return Found(Workspace(dest, commit))


# ------------------------------------------------------------------------------------------------------------- git

def git_command_env() -> dict:
    """The environment git runs in: nothing of the caller's configuration. No system or global configuration, no prompts,
    English messages. Only PATH is passed on, so that git is found."""
    env = {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": NULL_DEVICE, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"}
    path = os.environ.get("PATH")
    if path is not None:
        env["PATH"] = path
    return env


@dataclasses.dataclass(frozen=True)
class _GitResult:
    returncode: int
    stdout: bytes
    stderr: str               # git's own words (empty if it said none)
    message: str              # stderr, or what the exit status was when it said nothing


def _git(args: list, extra_env: dict | None = None) -> _GitResult:
    """Runs git with a cleared environment. A git that cannot be started is a failed run with its reason as the message."""
    env = git_command_env()
    env.update(extra_env or {})
    try:
        done = subprocess.run(["git", *args], env=env, capture_output=True)
    except (OSError, ValueError) as error:
        reason = f"git could not be started: {error}"
        return _GitResult(-1, b"", reason, reason)
    text = done.stderr.decode("utf-8", "replace").strip()
    return _GitResult(done.returncode, done.stdout, text, text or f"git exited with exit status: {done.returncode}")


def _clean_up(destination: str, made_by_us: bool) -> None:
    """Removes what a failed working copy made: the destination when this call made it, else what is in it."""
    if made_by_us:
        shutil.rmtree(destination, ignore_errors=True)
        return
    try:
        children = [e.path for e in _list(destination)]
    except (OSError, ValueError):
        return
    for child in children:
        try:
            if os.path.isdir(child) and not os.path.islink(child):
                shutil.rmtree(child, ignore_errors=True)
            else:
                os.remove(child)
        except OSError:
            pass


# ----------------------------------------------------------------------------------------- comparison with the repository

def _files_below(directory: str, base: str, out: set) -> None:
    try:
        entries = _list(directory)
    except (OSError, ValueError):
        return
    for entry in entries:
        if entry.is_folder:
            _files_below(entry.path, base, out)
        elif _is_regular_file(entry.path):
            out.add(os.path.relpath(entry.path, base).replace(os.sep, "/"))


def _stream_hash(stream) -> str | None:
    hasher = hashlib.sha256()
    try:
        while True:
            chunk = stream.read(CHUNK_BYTES)
            if not chunk:
                return hasher.hexdigest()
            hasher.update(chunk)
    except (OSError, EOFError, zlib.error):
        return None


def _direct_log_hash(path: str, compact: bool) -> str | None:
    try:
        with open(path, "rb") as file:
            return _stream_hash(io.BufferedReader(_MultiMemberGzip(file), CHUNK_BYTES) if compact else file)
    except (OSError, ValueError):
        return None


def _check_logs(lake: Lake, run: RunRef, files: set, defects: list) -> None:
    """Comparison A for the logs of one run: the library's digest equals a direct read of the file."""
    for rel in sorted(files):
        head, _, tail = rel.partition("/")
        if head != STORIES_DIR:
            continue
        folder = tail.partition("/")[0]
        if _SIGNED_INT_RE.fullmatch(folder) is None or len(folder) > UINT64_MAX_DIGITS:
            continue
        story = int(folder)
        if not INT64_MIN <= story <= INT64_MAX:
            continue
        is_raw = rel.endswith("/" + RAW_LOG)
        is_compact = rel.endswith("/" + COMPACT_LOG)
        if not is_raw and not is_compact:
            continue
        if is_compact and f"{STORIES_DIR}/{story:02d}/{RAW_LOG}" in files:
            continue                       # the raw log is the one the library returns
        direct = _direct_log_hash(os.path.join(run.dir, rel), is_compact)
        library = None
        log = lake.log(run, story)
        if isinstance(log, Found):
            digest = log.value.digest()
            library = digest.value.sha256 if isinstance(digest, Found) else None
        if direct != library:
            defects.append({"detail": "log differs from a direct read", "file": rel, "run": run.id})


class _NotRun(Exception):
    """The lake or the repository could not be looked at: a comparison that is not run, never a pass."""


def _git_output(repo: str, args: list) -> bytes:
    extra = {}
    try:
        extra["GIT_CEILING_DIRECTORIES"] = os.path.dirname(os.path.realpath(repo, strict=True))
    except (OSError, ValueError):
        pass
    done = _git(["-C", repo, *args], extra)
    if done.returncode != 0:
        raise _NotRun(done.stderr)
    return done.stdout


def compare_git(lake: Lake, repo: Any, rev: str = DEFAULT_REV) -> Found | str:
    """The library against the file system (A) and against the blobs of revision `rev` of the repository (B), for the
    preferred copy of every run id the repository tracks. Found(report) with `defects` (a defect of the library, never of
    the data), `differences` (differs, lake-absent, repository-absent, with the note's complete flag), `not_compared`,
    `rev` and `runs_compared`; or a string, the reason the comparison could not be made. That is not a pass."""
    try:
        return Found(_compare(lake, os.fspath(repo), rev))
    except _NotRun as reason:
        return str(reason)


def _compare(lake: Lake, repo: str, rev: str) -> dict:
    d = lake.discover()
    if d.missing_roots:
        raise _NotRun("the lake has no " + " and no ".join(d.missing_roots) + " folder")
    if not os.path.isdir(repo):
        raise _NotRun(f"{repo} is not a folder")
    try:
        sha = _git_output(repo, ["rev-parse", "--verify", "--quiet", rev + "^{commit}"])
    except _NotRun as why:
        suffix = f": {why}" if str(why) else ""
        raise _NotRun(f"{repo} cannot be looked at as a repository with revision {rev}{suffix}")
    commit = sha.decode("utf-8", "replace").strip()
    if not commit:
        raise _NotRun(f"revision {rev} not found in {repo}")
    defects: list = []
    differences: list = []
    not_compared: list = []
    runs_compared = 0
    for run_id in sorted({r.id for r in d.runs}, key=lambda i: i.encode("utf-8")):
        run = lake.preferred(d, run_id)
        listing = _git_output(repo, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", commit, "--", run_id])
        paths = listing.decode("utf-8", "replace").split("\0")
        prefix = run_id + "/"
        repo_files = {p[len(prefix):] for p in paths if p.startswith(prefix) and Record.from_relative_path(p[len(prefix):])}
        lake_files: set = set()
        _files_below(run.dir, run.dir, lake_files)
        if all(p == "" for p in paths):
            not_compared.append(run_id)
            continue
        runs_compared += 1
        _check_logs(lake, run, lake_files, defects)
        complete = lake.completeness(run)
        lake_complete = None
        if isinstance(complete, Found):
            lake_complete = {COMPLETE: True, INCOMPLETE: False}.get(complete.value.kind)
        lake_records = {f for f in lake_files if Record.from_relative_path(f) is not None}
        for rel in sorted(repo_files | lake_records, key=lambda f: f.encode("utf-8")):
            record = Record.from_relative_path(rel)
            library = lake.bytes(run, record)
            direct = None
            if _is_regular_file(os.path.join(run.dir, rel)):
                try:
                    with open(os.path.join(run.dir, rel), "rb") as file:
                        direct = file.read()
                except OSError:
                    direct = None
            if isinstance(library, Found) and direct is not None and library.value != direct:
                defects.append({"detail": "record differs from a direct read", "file": rel, "run": run_id})
            elif isinstance(library, Absent) and direct is not None:
                defects.append({"detail": "a readable regular file that the library cannot read", "file": rel, "run": run_id})
            blob = None
            if rel in repo_files:
                try:
                    blob = _git_output(repo, ["cat-file", "blob", f"{commit}:{run_id}/{rel}"])
                except _NotRun:
                    blob = None
            kind = None
            if isinstance(library, Found):
                if blob is None:
                    kind = DIFF_REPOSITORY_ABSENT
                elif library.value != blob:
                    kind = DIFF_DIFFERS
            elif blob is not None:
                kind = DIFF_LAKE_ABSENT
            if kind is not None:
                differences.append({"file": rel, "kind": kind, "lake_complete": lake_complete, "node": run.node, "run": run_id})
    if runs_compared == 0:
        raise _NotRun("no run of the lake is tracked in the repository: nothing was compared")
    return {"defects": defects, "differences": differences, "not_compared": not_compared, "rev": rev,
            "runs_compared": runs_compared}


# ---------------------------------------------------------------------------------------------------------- the command

ReportSink = Callable[[str, str], None]


def _write_report(path: str, text: str) -> None:
    """Writes the report of compare-git to the path the caller named (never inside the lake)."""
    with open(path, "w", encoding="utf-8") as file:
        file.write(text)


def _found(value: dict) -> tuple[dict, int]:
    value["status"] = "found"
    return value, EXIT_OK


def _absent_answer(a: Absent) -> tuple[dict, int]:
    return {"absent": a.to_value(), "status": "absent"}, EXIT_OK


_ARITY = {"runs": 0, "copies": 1, "preferred": 1, "log": 2, "workspace": 3, "complete": 1}   # arguments after the question


def _expect(rest: list, question: str) -> None:
    if len(rest) != _ARITY[question]:
        raise QuestionError(f"{question} takes {_ARITY[question]} argument(s), got {len(rest)}")


def _parse_roots(args: list) -> tuple[Lake, list]:
    if not args:
        raise QuestionError("usage: bench-lake <STATE_DIR> <question...> | --roots <COLLECTED> <REFERENCE> <question...>")
    if args[0] == FLAG_ROOTS:
        if len(args) < ROOTS_FLAG_WORDS:
            raise QuestionError("--roots takes the collected folder and the reference folder")
        _, collected, reference, *question = args
        return Lake(collected, reference), question
    state, *question = args
    return Lake.in_state_dir(state), question


def _runs_value(d: Discovery) -> dict:
    return {
        "missing_roots": list(d.missing_roots),
        "rejected": [{"code": r.code, "path": r.label} for r in d.rejected],
        "runs": [r.to_value() for r in d.runs],
    }


def _compare_command(lake: Lake, words: list, report: ReportSink):
    repo: str | None = None
    rev = DEFAULT_REV
    report_path: str | None = None
    it = iter(words)
    for word in it:
        if word == FLAG_REV:
            rev = next(it, None)
            if rev is None:
                raise QuestionError("--rev takes a revision")
        elif word == FLAG_REPORT:
            report_path = next(it, None)
            if report_path is None:
                raise QuestionError("--report takes a path")
        elif repo is None:
            repo = word
        else:
            raise QuestionError("compare-git takes one repository")
    if repo is None:
        raise QuestionError("compare-git takes the repository to compare with")
    result = compare_git(lake, repo, rev)
    if isinstance(result, str):
        return ("not-run", result)
    if report_path is not None:
        try:
            report(report_path, canonical(result.value) + "\n")
        except OSError as error:
            return ("not-run", f"the report could not be written: {error}")
    return ("print", result.value, EXIT_DEFECT if result.value["defects"] else EXIT_OK)


def _on_run(lake: Lake, spec: str, ask: Callable[[RunRef], tuple]) -> tuple:
    """Finds the run (an id, or node@id) and asks about it; a run that is not there is an absence."""
    run = lake.find_run(lake.discover(), spec)
    if isinstance(run, Absent):
        return ("print", *_absent_answer(run))
    return ask(run.value)


def _answer(args: list, report: ReportSink):
    lake, words = _parse_roots(args)
    if not words:
        raise QuestionError("no question")
    question, *rest = words
    if question in _ARITY:
        _expect(rest, question)
    if question == "runs":
        return ("print", *_found(_runs_value(lake.discover())))
    if question == "copies":
        (run_id,) = rest
        return ("print", *_found({"copies": [r.to_value() for r in lake.copies(lake.discover(), run_id)]}))
    if question == "preferred":
        (run_id,) = rest
        got = lake.preferred_or_absent(lake.discover(), run_id)
        if isinstance(got, Absent):
            return ("print", *_absent_answer(got))
        return ("print", *_found({"preferred": got.value.to_value()}))
    if question == "record":
        if len(words) < RECORD_MIN_WORDS:
            raise QuestionError("record takes a run, a record name and its arguments")
        spec, name, *record_args = rest
        record = Record.from_words(name, record_args)
        return _on_run(lake, spec, lambda run: _record_answer(lake, run, record))
    if question == "log":
        spec, story_text = rest
        story = parse_story_arg(story_text)
        return _on_run(lake, spec, lambda run: _log_answer(lake, run, story))
    if question == "workspace":
        spec, story_text, dest = rest
        story = parse_story_arg(story_text)
        return _on_run(lake, spec, lambda run: _workspace_answer(lake, run, story, dest))
    if question == "complete":
        (spec,) = rest
        return _on_run(lake, spec, lambda run: _complete_answer(lake, run))
    if question == "compare-git":
        return _compare_command(lake, rest, report)
    raise QuestionError(f"unknown question {question}")


def _record_answer(lake: Lake, run: RunRef, record: Record) -> tuple:
    data = lake.bytes(run, record)
    if isinstance(data, Absent):
        return ("print", *_absent_answer(data))
    value = lake.value(run, record)
    if isinstance(value, Absent):
        return ("print", *_absent_answer(value))
    return ("print", *_found({"length": len(data.value), "node": run.node, "run": run.id,
                              "sha256": sha256_hex(data.value), "value": value.value}))


def _log_answer(lake: Lake, run: RunRef, story: int) -> tuple:
    log = lake.log(run, story)
    if isinstance(log, Absent):
        return ("print", *_absent_answer(log))
    digest = log.value.digest()
    if isinstance(digest, Absent):
        return ("print", *_absent_answer(digest))
    dg = digest.value
    return ("print", *_found({"form": log.value.form, "length": dg.length, "lines": dg.lines, "node": run.node,
                              "run": run.id, "sha256": dg.sha256, "story": story}))


def _workspace_answer(lake: Lake, run: RunRef, story: int, dest: str) -> tuple:
    made = lake.workspace(run, story, dest)
    if isinstance(made, Absent):
        return ("print", *_absent_answer(made))
    if isinstance(made, Refused):
        return ("print", {"refused": made.to_value(), "status": "refused"}, EXIT_QUESTION)
    return ("print", *_found({"commit": made.value.commit, "node": run.node, "path": dest, "run": run.id, "story": story}))


def _complete_answer(lake: Lake, run: RunRef) -> tuple:
    got = lake.completeness(run)
    if isinstance(got, Absent):
        return ("print", *_absent_answer(got))
    c = got.value
    return ("print", *_found({"collected_at": c.collected_at, "completeness": c.kind, "node": run.node, "run": run.id,
                              "settled_at": c.settled_at, "state": c.state}))


def run(args: list, out: Any, err: Any, report: ReportSink | None = None) -> int:
    """Runs the command; `args` excludes the program name; `out` and `err` take bytes. Returns the exit code: 0 for a
    value or an absence, 2 for a refusal or a malformed question, 1 when compare-git found a defect of the library, 3 when
    it could not look. `report` writes compare-git's report (default: to the path given)."""
    try:
        outcome = _answer(list(args), report or _write_report)
    except QuestionError as question:
        err.write(f"{PROGRAM}: {question}\n".encode("utf-8", "replace"))
        return EXIT_QUESTION
    if outcome[0] == "not-run":
        err.write(f"{PROGRAM}: not run: {outcome[1]}\n".encode("utf-8", "replace"))
        return EXIT_NOT_RUN
    _, value, code = outcome
    out.write((canonical(value) + "\n").encode("utf-8", "replace"))
    return code


def main(argv: list | None = None) -> int:
    code = run(sys.argv[ARGV_FIRST:] if argv is None else argv, sys.stdout.buffer, sys.stderr.buffer)
    sys.stdout.flush()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
