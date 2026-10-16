"""lake_runs.py, the Python half of the read-only library that reads benchmark runs from the lake (story 21), against the
trimmed real runs in tools/bench-lake/tests/fixtures/lake and against the Rust half (tools/bench-lake), which must print
the same bytes for the same lake and question (tools/bench-lake/CANONICAL.md is the contract).

MECE by what the library answers (the test-case numbers are the design's, TC-01 to TC-109):
  A. the parts of the layout: the part rule, the ranking of copies, the record names, the story and version ranges
  B. listing the runs: discover, copies, preferred, find_run (TC-01 to TC-16)
  C. a run's records as bytes and values (TC-17 to TC-34, TC-73, TC-74, TC-79, TC-80)
  D. a story's log in the form the lake holds (TC-35 to TC-46)
  E. a working copy of a run's code from its bundle, with real git (TC-47 to TC-58, TC-84)
  F. whether a run is complete (TC-59 to TC-68)
  G. the typed absence and the refusal, and that Python never raises (TC-69 to TC-76)
  H. reading never changes the lake (TC-77 to TC-82)
  I. canonical JSON and the strict reading of a record
  J. the command and its agreement with the Rust command (TC-91 to TC-96, TC-107)
  K. import has no effects, stdlib only, importable from the monitor (TC-93 to TC-95)
  L. equal to the old reads: the file system and git (TC-97 to TC-106, TC-108, TC-109)

The fixture runs are real (trimmed copies of the host's lake); the damaged and temporary files are made from them by the
tests. Real files, real gzip, real git. Nothing under test is mocked. The tests that need the Rust command build it with
`cargo build -p bench-lake` from tools/ and are skipped, with the reason, where cargo is not installed.
Run: uv run --with pytest pytest test_lake_runs.py
Regenerate tools/bench-lake/golden/answers.json (from the Rust command): python test_lake_runs.py --regenerate-golden
"""
from __future__ import annotations

import ast
import gzip
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
from pathlib import Path

import pytest

import lake_runs as L

HARNESS = Path(__file__).resolve().parent
REPO = HARNESS.parents[2]
CRATE = REPO / "tools" / "bench-lake"
FIXTURES = CRATE / "tests" / "fixtures"
FIXTURE = FIXTURES / "lake"
GOLDEN = CRATE / "golden" / "answers.json"
MODULE = HARNESS / "lake_runs.py"
GIT_REPO = CRATE.resolve().parents[1]      # the repository the crate is in (the scratch tree used while developing links to it)

HOST_STATE_ENV = "BENCH_LAKE_HOST_STATE"
HOST_REPO_ENV = "BENCH_LAKE_HOST_REPO"

ID_FRESH = "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1"
ID_Q36 = "combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2"
ID_DRY = "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2"
ID_FLASH = "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1"
ID_TODOODLE = "benchmarks/reference/todoodle/opus-5.5/run-1"
ID_REFV = "benchmarks/reference/vidi/sonnet-5.5/v2-r1"
FIXTURE_RUN_COUNT = 8
FIXTURE_DISTINCT_IDS = 6
NODE_PATH = "collected/gruntus/combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi"
REAL_COMMIT_1 = "59a592fca04af9fe2c8b667b3a784298795ccde9"
FRESH_BASE_COMMIT = "30816ab716043c8a400ee0e43b0e7f8b3438a3ea"
LAST_STORY = 12
ABSENT_REV = "0123456789abcdef0123456789abcdef01234567"
STORY_WITHOUT_COMMIT = 6
FIXTURE_RAW_LINES = 20
RAW_LOG = "agent-events.jsonl"
COMPACT_LOG = "agent-events.compact.jsonl.gz"
BUNDLE = "workspace.bundle"
NOTE = "collection.json"
SIXTY_FOUR = 64
SIXTY_FIVE = 65
MAX_DEPTH_JSON = 127            # serde_json refuses a document nested 128 deep: the Rust command's limit, held by Python
MIB = 1024 * 1024
BIG_LOG_BYTES = 200 * MIB
BIG_LINE_BYTES = 1024
RSS_SAMPLE_EVERY_LINES = 20_000
RSS_GROWTH_LIMIT_KIB = 64 * 1024
SNAPSHOT_HASH_LIMIT = 8 * MIB
RANDOM_BUNDLE_BYTES = 4096
LCG_MUL = 6364136223846793005
LCG_ADD = 1442695040888963407
UINT64_MASK = (1 << 64) - 1
LCG_SHIFT = 33
DIR_MODE_WRITABLE = 0o755
FILE_MODE_WRITABLE = 0o644
DIR_MODE_READONLY = 0o555
FILE_MODE_READONLY = 0o444
BUILD_TIMEOUT_S = 900
SOME_STORIES = [0, 1, 2, 999]
GOLDEN_STORIES = [0, 1, 2, 12, 999, 1000, -1]
GOLDEN_LOG_STORIES = [0, 1, 2, 999, 1000, -1]
GOLDEN_WORKSPACE_STORIES = [1, STORY_WITHOUT_COMMIT, 1000]
PLACEHOLDER_DEST = "<DEST>"
PLACEHOLDER_NONEMPTY = "<NONEMPTY-DEST>"
PLAIN_NAMES = ["run-description", "status", "metrics", "finalize", "progress", "collection"]
STORY_NAMES = ["accept", "prompt", "base-commit", "gate"]
SIX = [L.RUN_DESCRIPTION, L.STATUS, L.METRICS, L.FINALIZE, L.PROGRESS, L.COLLECTION]
GIT_IDENTITY = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
}

is_root = hasattr(os, "geteuid") and os.geteuid() == 0
needs_non_root = pytest.mark.skipif(is_root, reason="running as root: permission tests prove nothing")


# ---------------------------------------------------------------------------------------------------------------- helpers

def fixture_lake() -> L.Lake:
    return L.Lake.in_state_dir(FIXTURE)


def find(lake: L.Lake, run_id: str, node: str | None) -> L.RunRef:
    for r in lake.discover().runs:
        if r.id == run_id and r.node == node:
            return r
    raise AssertionError(f"no run {run_id} node {node} in the lake")


def preferred_of(lake: L.Lake, run_id: str) -> L.RunRef:
    run = lake.preferred(lake.discover(), run_id)
    assert run is not None, run_id
    return run


def found(result):
    assert isinstance(result, L.Found), result
    return result.value


def absent(result, code: str | None = None) -> L.Absent:
    assert isinstance(result, L.Absent), result
    if code is not None:
        assert result.code == code, result
    return result


def refused(result, code: str | None = None) -> L.Refused:
    assert isinstance(result, L.Refused), result
    if code is not None:
        assert result.code == code, result
    return result


def write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def copy_tree(src: Path, dst: Path) -> None:
    shutil.copytree(src, dst, symlinks=True)
    for p in [dst, *dst.rglob("*")]:
        if not p.is_symlink():
            p.chmod(DIR_MODE_WRITABLE if p.is_dir() else FILE_MODE_WRITABLE)


@pytest.fixture
def scratch(tmp_path):
    """A writable copy of the fixture lake: (state folder, lake)."""
    state = tmp_path / "state"
    copy_tree(FIXTURE, state)
    return state, L.Lake.in_state_dir(state)


def set_modes(path: Path, dir_mode: int, file_mode: int) -> None:
    if path.is_symlink():
        return
    if path.is_dir():
        path.chmod(DIR_MODE_WRITABLE)
        for child in path.iterdir():
            set_modes(child, dir_mode, file_mode)
        path.chmod(dir_mode)
    else:
        path.chmod(file_mode)


def snapshot(root: Path) -> dict[str, str]:
    """Every file and folder below root: kind, size, permission bits, modification time and (small files) content hash.
    Access times are not recorded."""
    out: dict[str, str] = {}

    def walk(directory: Path) -> None:
        for p in sorted(directory.iterdir()):
            st = p.lstat()
            rel = str(p.relative_to(root))
            if stat.S_ISLNK(st.st_mode):
                kind = f"link->{os.readlink(p)}"
            elif stat.S_ISDIR(st.st_mode):
                kind = "dir"
            elif st.st_size <= SNAPSHOT_HASH_LIMIT:
                kind = L.sha256_hex(p.read_bytes())
            else:
                kind = "big"
            out[rel] = f"{kind} size={st.st_size} mode={st.st_mode:o} mtime={st.st_mtime_ns}"
            if stat.S_ISDIR(st.st_mode):
                walk(p)

    walk(root)
    return out


def git_in(directory: Path, *args: str) -> str:
    out = subprocess.run(
        ["git", "-C", str(directory), *args], capture_output=True, text=True,
        env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"},
    )
    assert out.returncode == 0, f"git {args}: {out.stderr}"
    return out.stdout.rstrip("\n")


def gunzip(data: bytes) -> bytes:
    return gzip.decompress(data)


def split_lines(data: bytes) -> list[bytes]:
    lines = data.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    return lines


def collect_lines(log: L.Log):
    ok, err = [], None
    for item in log.lines():
        if isinstance(item, L.Found):
            assert err is None, "a line after the error"
            ok.append(item.value)
        else:
            assert err is None, "two errors"
            err = item
    return ok, err


def labels(d: L.Discovery):
    return [(r.label, r.code) for r in d.rejected]


def make_run(state: Path, rel_from_state: str) -> None:
    write(state / rel_from_state / "run.json", b"{}")


def fs_compressed_copy(src: Path, dst: Path) -> bool:
    """Makes dst a copy of src compressed by the file system (APFS), if the system can. False if it cannot, or the copy is
    not marked compressed (a file that does not shrink is stored plain)."""
    if shutil.which("ditto") is None:
        return False
    plain = Path(str(dst) + ".plain-name")       # ditto skips names it takes for compressed types, so rename after
    ok = subprocess.run(["ditto", "--hfsCompression", str(src), str(plain)]).returncode == 0
    if not ok:
        return False
    os.rename(plain, dst)
    return "compressed" in subprocess.run(["ls", "-lO", str(dst)], capture_output=True, text=True).stdout


def rss_kib() -> int:
    out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True)
    return int(out.stdout.strip())


# ------------------------------------------------------------------------------------------------------- the Rust command

@pytest.fixture(scope="session")
def rust_binary() -> Path:
    cargo = shutil.which("cargo")
    if cargo is None:
        pytest.skip("cargo is not installed: the Rust command cannot be built, so the two languages are not compared")
    built = subprocess.run([cargo, "build", "-q", "-p", "bench-lake"], cwd=REPO / "tools", capture_output=True, text=True,
                           timeout=BUILD_TIMEOUT_S)
    assert built.returncode == 0, built.stderr
    meta = subprocess.run([cargo, "metadata", "--no-deps", "--format-version", "1"], cwd=REPO / "tools",
                          capture_output=True, text=True, timeout=BUILD_TIMEOUT_S)
    assert meta.returncode == 0, meta.stderr
    binary = Path(json.loads(meta.stdout)["target_directory"]) / "debug" / "bench-lake"
    assert binary.is_file(), binary
    return binary


def rust_ask(binary: Path, state: Path, args: list[str]) -> tuple[int, bytes, bytes]:
    p = subprocess.run([str(binary), str(state), *args], capture_output=True)
    return p.returncode, p.stdout, p.stderr


def py_ask(state: Path, args: list[str]) -> tuple[int, bytes, bytes]:
    """The Python command in this process: (exit code, stdout, stderr)."""
    out, err = io.BytesIO(), io.BytesIO()
    code = L.run([str(state), *args], out, err)
    return code, out.getvalue(), err.getvalue()


def py_process(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(MODULE), *args], capture_output=True, cwd=cwd)


# ----------------------------------------------------------------------------------------------------------- A. the parts

def test_a_part_of_64_characters_is_valid():                                                              # TC-08
    assert L.is_valid_part("a" * SIXTY_FOUR)


def test_a_part_of_65_characters_is_not_valid():                                                          # TC-09
    assert not L.is_valid_part("a" * SIXTY_FIVE)


def test_the_dot_parts_are_not_valid():                                                                   # TC-10
    for part in ["..", ".", "..."]:
        assert not L.is_valid_part(part), part


def test_the_part_rule_alphabet():
    for ok in ["a", "3.8-swift-1.5", "strix-halo-128GB", "v2_r1", "a.b", ".hidden"]:
        assert L.is_valid_part(ok), ok
    for bad in ["", "a b", "a/b", "é", "a\n", "a:b", "a\\b", "a\0b"]:
        assert not L.is_valid_part(bad), repr(bad)


def note(node, has_note, complete, files, settled):
    return L.CopyNote(node=node, has_note=has_note, complete=complete, files=files, settled_at=settled)


def test_the_ranking_puts_complete_then_more_files_then_later_settled_first_and_no_note_last():       # TC-14
    incomplete_many = note("a", True, False, 500, 9.0)
    complete_few = note("b", True, True, 10, 9.0)
    complete_many_early = note("c", True, True, 100, 1.0)
    complete_many_late = note("d", True, True, 100, 2.0)
    no_note = note("e", False, False, 0, None)
    import functools
    best_first = sorted([incomplete_many, complete_few, complete_many_early, complete_many_late, no_note],
                        key=functools.cmp_to_key(lambda a, b: L.compare_copies(b, a)))
    assert [n.node for n in best_first] == ["d", "c", "b", "a", "e"]


def test_with_everything_else_equal_the_smaller_node_name_wins():                                         # TC-14
    a, b = note("alpha", True, True, 5, 7.0), note("beta", True, True, 5, 7.0)
    assert L.compare_copies(a, b) > 0
    assert L.compare_copies(b, a) < 0
    assert L.compare_copies(a, a) == 0


def test_a_copy_with_no_note_ranks_below_one_with_a_note():                                               # TC-14
    assert L.compare_copies(note("z", True, False, 0, None), note("a", False, False, 0, None)) > 0
    assert L.compare_copies(note("a", False, False, 0, None), note("z", True, False, 0, None)) < 0


def test_a_missing_settled_at_ranks_lowest():                                                             # TC-14
    assert L.compare_copies(note("z", True, True, 5, 1.0), note("a", True, True, 5, None)) > 0
    assert L.compare_copies(note("a", True, True, 5, None), note("z", True, True, 5, 1.0)) < 0
    assert L.compare_copies(note("a", True, True, 5, None), note("z", True, True, 5, None)) > 0, "both missing: the node name"
    assert L.compare_copies(note("a", True, True, 5, -0.0), note("z", True, True, 5, 0.0)) < 0, "-0.0 is below 0.0"


def test_story_numbers_are_written_with_at_least_two_digits():                                            # TC-25
    assert L.story_dir(1) == "01"
    assert L.story_dir(12) == "12"
    assert L.accept(1).relative_path() == L.Found("stories/01/accept-summary.json")
    assert L.accept(12).relative_path() == L.Found("stories/12/accept-summary.json")


def test_story_0_and_999_have_their_names():                                                              # TC-26, TC-30
    assert L.gate(999).relative_path() == L.Found("stories/999/gate.json")
    assert L.gate(0).relative_path() == L.Found("stories/00/gate.json")


def test_a_story_out_of_range_is_a_bad_name():                                                            # TC-31
    for story in [1000, -1, 2 ** 63 - 1, -(2 ** 63)]:
        assert L.accept(story).relative_path() == L.BadName("story out of range"), story
        assert L.story_dir(story) is None


def test_a_version_of_one_character_is_accepted():                                                        # TC-32
    assert L.is_valid_version("a")
    assert L.rescore("a").relative_path() == L.Found("rescore/a/rescore.json")


def test_bad_versions_are_bad_names():                                                                    # TC-33
    for version in ["", "a" * SIXTY_FIVE, "a/b", "..", ".", "a b", "a\0b", "é"]:
        assert not L.is_valid_version(version), repr(version)
        assert L.rescore(version).relative_path() == L.BadName("version not valid")
        assert L.rescore_accept(version, 1).relative_path() == L.BadName("version not valid")
    assert L.is_valid_version("a" * SIXTY_FOUR)


def test_every_record_maps_to_its_file_and_back():
    cases = [
        (L.RUN_DESCRIPTION, "run.json"), (L.STATUS, "run-status.json"), (L.METRICS, "metrics.json"),
        (L.FINALIZE, "finalize.json"), (L.PROGRESS, "progress.json"), (L.COLLECTION, "collection.json"),
        (L.rescore("v1"), "rescore/v1/rescore.json"),
        (L.rescore_accept("v1", 2), "rescore/v1/stories/02/accept-summary.json"),
        (L.accept(3), "stories/03/accept-summary.json"), (L.prompt(4), "stories/04/prompt.md"),
        (L.base_commit(5), "stories/05/base-commit"), (L.gate(6), "stories/06/gate.json"),
    ]
    for record, path in cases:
        assert record.relative_path() == L.Found(path), record
        assert L.Record.from_relative_path(path) == record, path


def test_a_path_that_is_not_a_record_names_no_record():
    for path in ["", ".metrics.json.partial", ".metrics.json.1234.tmp", "stories/01/agent-events.jsonl",
                 "stories/1/gate.json", "stories/1000/gate.json", "stories/01/../gate.json", "../metrics.json",
                 "/metrics.json", "rescore/../x/rescore.json", "rescore/a/b/rescore.json", "metrics.json/",
                 "stories/01/.gate.json"]:
        assert L.Record.from_relative_path(path) is None, repr(path)


def test_only_prompt_and_base_commit_are_text_records():                                                  # TC-22
    assert L.prompt(1).is_text() and L.base_commit(1).is_text()
    for record in [L.METRICS, L.gate(1), L.COLLECTION, L.rescore("v")]:
        assert not record.is_text(), record


def test_record_names_from_the_words_of_a_question():
    assert L.Record.from_words("status", []) == L.STATUS
    assert L.Record.from_words("accept", ["1"]) == L.accept(1)
    assert L.Record.from_words("accept", ["-1"]) == L.accept(-1)
    assert L.Record.from_words("accept", ["001"]) == L.accept(1)
    assert L.Record.from_words("rescore", ["v1"]) == L.rescore("v1")
    assert L.Record.from_words("rescore-accept", ["v1", "2"]) == L.rescore_accept("v1", 2)
    assert L.Record.from_words("rescore", [""]) == L.rescore("")
    for name, args in [("nope", []), ("status", ["1"]), ("accept", []), ("accept", ["x"]), ("accept", ["+1"]),
                       ("accept", [" 1"]), ("accept", ["1", "2"]), ("rescore-accept", ["v1"]), ("rescore", []),
                       ("accept", ["١"])]:
        with pytest.raises(L.QuestionError):
            L.Record.from_words(name, args)


def test_the_item_name_of_a_record():
    assert L.METRICS.item_name() == "metrics"
    assert L.accept(1000).item_name() == "accept:1000"
    assert L.accept(-1).item_name() == "accept:-1"
    assert L.rescore_accept("v1", 1).item_name() == "rescore-accept:v1:1"
    assert L.RUN_DESCRIPTION.item_name() == "run-description"


def test_a_story_argument_is_a_decimal_integer_clamped_to_64_bits():
    assert L.parse_story_arg("1") == 1
    assert L.parse_story_arg("001") == 1
    assert L.parse_story_arg("-1") == -1
    assert L.parse_story_arg("-0") == 0
    assert L.parse_story_arg("0" * 30 + "7") == 7
    assert L.parse_story_arg("99999999999999999999") == 2 ** 63 - 1
    assert L.parse_story_arg("-99999999999999999999") == -(2 ** 63)
    assert L.parse_story_arg("9" * 5000) == 2 ** 63 - 1
    for bad in ["", "-", "x1", "+1", " 1", "1 ", "1.0", "--1", "١", "1_0"]:
        with pytest.raises(L.QuestionError):
            L.parse_story_arg(bad)


# ------------------------------------------------------------------------------------------------------------ B. discover

def test_a_combination_run_with_one_copy():                                                               # TC-01
    lake = fixture_lake()
    d = lake.discover()
    copies = lake.copies(d, ID_FLASH)
    assert len(copies) == 1
    r = copies[0]
    assert (r.kind, r.node, r.id) == ("combination", "tritus", ID_FLASH)
    assert r.dir == str(FIXTURE / "collected" / "tritus" / ID_FLASH)
    assert r.label == f"collected/tritus/{ID_FLASH}"


def test_the_whole_fixture_lake_is_listed_in_order():
    d = fixture_lake().discover()
    assert d.rejected == [] and d.missing_roots == []
    assert [(r.id, r.node) for r in d.runs] == [
        (ID_TODOODLE, None), (ID_REFV, None), (ID_Q36, "gruntus"), (ID_Q36, "quintus"), (ID_Q36, "tritus"),
        (ID_DRY, "gruntus"), (ID_FRESH, "gruntus"), (ID_FLASH, "tritus"),
    ]
    assert len(d.runs) == FIXTURE_RUN_COUNT


def test_a_combination_run_with_several_copies():                                                         # TC-02
    lake = fixture_lake()
    copies = lake.copies(lake.discover(), ID_Q36)
    assert [r.node for r in copies] == ["gruntus", "quintus", "tritus"]
    assert all(r.kind == "combination" and r.id == ID_Q36 for r in copies)


def test_a_reference_run():                                                                               # TC-03
    lake = fixture_lake()
    copies = lake.copies(lake.discover(), ID_REFV)
    assert len(copies) == 1
    r = copies[0]
    assert (r.kind, r.node, r.id) == ("reference", None, "benchmarks/reference/vidi/sonnet-5.5/v2-r1")
    assert r.dir == str(FIXTURE / "reference/vidi/sonnet-5.5/v2-r1")
    assert r.label == "reference/vidi/sonnet-5.5/v2-r1"


def test_a_reference_run_has_no_node_and_one_place():                                                      # TC-04
    lake = fixture_lake()
    d = lake.discover()
    for run_id in [ID_REFV, ID_TODOODLE]:
        copies = lake.copies(d, run_id)
        assert len(copies) == 1 and copies[0].node is None, run_id
    assert lake.copies(d, "benchmarks/reference/no/such/run") == []


def test_the_real_stray_folder_is_rejected_and_the_real_runs_still_listed(scratch):                       # TC-05
    state, lake = scratch
    (state / "collected/tritus/benchmarks").mkdir()
    d = lake.discover()
    assert labels(d) == [("collected/tritus/benchmarks", "E-LAKE-STRAY")]
    assert d.rejected[0].path == str(state / "collected/tritus/benchmarks")
    assert len(d.runs) == FIXTURE_RUN_COUNT


def test_a_file_and_a_symlink_where_folders_belong_are_rejected(scratch):                                 # TC-06
    state, lake = scratch
    write(state / "collected/zz-file", b"x")
    os.symlink(state / "collected/gruntus", state / "collected/zz-link")
    pack = state / NODE_PATH
    os.symlink(pack / "v2-fresh-r1", pack / "v2-link")
    write(state / "collected/tritus/readme.txt", b"x")
    d = lake.discover()
    got = labels(d)
    assert ("collected/zz-file", "E-LAKE-NOT-A-FOLDER") in got
    assert ("collected/zz-link", "E-LAKE-NOT-A-FOLDER") in got
    assert (f"{NODE_PATH}/v2-link", "E-LAKE-NOT-A-FOLDER") in got
    assert ("collected/tritus/readme.txt", "E-LAKE-STRAY") in got
    assert len(got) == 4, got
    assert len(d.runs) == FIXTURE_RUN_COUNT, "the link's target is not listed twice"


def test_a_link_named_combinations_is_not_followed(scratch):                                              # TC-06
    state, lake = scratch
    (state / "collected/newnode").mkdir()
    os.symlink(state / "collected/tritus/combinations", state / "collected/newnode/combinations")
    d = lake.discover()
    assert labels(d) == [("collected/newnode/combinations", "E-LAKE-NOT-A-FOLDER")]
    assert len(d.runs) == FIXTURE_RUN_COUNT


def test_a_run_folder_at_depth_nine_is_listed_and_one_at_depth_ten_is_the_runs_own_content(scratch):   # TC-07
    state, lake = scratch
    nine = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r9"
    make_run(state, nine)
    make_run(state, f"{nine}/r10")
    d = lake.discover()
    assert any(r.label == nine for r in d.runs)
    assert not any(r.label.endswith("r10") for r in d.runs)
    assert d.rejected == []
    assert len(d.runs) == FIXTURE_RUN_COUNT + 1


def test_a_chain_that_ends_too_early_is_shallow(scratch):                                                 # TC-07
    state, lake = scratch
    (state / "collected/tritus/combinations/a/b/c").mkdir(parents=True)
    (state / "reference/pack").mkdir(parents=True)
    assert labels(lake.discover()) == [
        ("collected/tritus/combinations/a/b/c", "E-LAKE-SHALLOW"), ("reference/pack", "E-LAKE-SHALLOW")]


def test_a_file_above_run_depth_is_not_a_folder(scratch):                                                 # TC-07
    state, lake = scratch
    write(state / "collected/tritus/combinations/a/file.txt", b"x")
    assert labels(lake.discover()) == [("collected/tritus/combinations/a/file.txt", "E-LAKE-NOT-A-FOLDER")]


def test_the_part_rule_applies_in_the_walk(scratch):                                                      # TC-08, TC-09, TC-10
    state, lake = scratch
    base = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p"
    make_run(state, f"{base}/{'x' * 64}")
    make_run(state, f"{base}/{'y' * 65}")
    make_run(state, f"{base}/with space")
    make_run(state, f"{base}/...")
    d = lake.discover()
    assert any(r.id.endswith("x" * 64) for r in d.runs)
    got = labels(d)
    assert len(got) == 3, got
    assert all(code == "E-LAKE-BAD-PART" for _, code in got)
    assert any(label.endswith("y" * 65) for label, _ in got)
    assert any(label.endswith("/...") for label, _ in got)
    assert any(label.endswith("with space") for label, _ in got)


def test_the_literal_benchmarks_and_the_engine_client_dash_are_required(scratch):
    state, lake = scratch
    make_run(state, "collected/tritus/combinations/a/b/c/d/e/f-g/notbenchmarks/p/r")
    make_run(state, "collected/tritus/combinations/a/b/c/d/e/nodash/benchmarks/p/r")
    d = lake.discover()
    assert labels(d) == [
        ("collected/tritus/combinations/a/b/c/d/e/f-g/notbenchmarks", "E-LAKE-BAD-PART"),
        ("collected/tritus/combinations/a/b/c/d/e/nodash", "E-LAKE-BAD-PART"),
    ]
    assert len(d.runs) == FIXTURE_RUN_COUNT


def test_a_bad_node_name_is_rejected(scratch):
    state, lake = scratch
    (state / "collected/bad node").mkdir()
    assert labels(lake.discover()) == [("collected/bad node", "E-LAKE-BAD-PART")]


def test_a_folder_at_run_depth_with_no_marker_is_rejected(scratch):                                       # TC-11
    state, lake = scratch
    rel = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r"
    (state / rel / "stories").mkdir(parents=True)
    assert labels(lake.discover()) == [(rel, "E-LAKE-NO-MARKER")]
    rel2 = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r2"
    (state / rel2 / "run.json").mkdir(parents=True)          # a marker that is a folder
    rel3 = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r3"
    (state / rel3).mkdir(parents=True)
    write(state / "target.json", b"{}")
    os.symlink(state / "target.json", state / rel3 / "collection.json")     # a marker that is a link
    d = lake.discover()
    assert len(d.rejected) == 3 and all(r.code == "E-LAKE-NO-MARKER" for r in d.rejected)


def test_either_marker_makes_a_run(scratch):
    state, lake = scratch
    base = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p"
    write(state / base / "r1/collection.json", b"{}")
    write(state / base / "r2/run.json", b"{}")
    d = lake.discover()
    assert d.rejected == [] and len(d.runs) == FIXTURE_RUN_COUNT + 2


def test_a_missing_root_is_named_and_is_not_an_error():                                                   # TC-12
    d = L.Lake(FIXTURE / "collected", FIXTURE / "no-such-reference").discover()
    assert d.missing_roots == ["reference"] and d.rejected == []
    assert all(r.kind == "combination" for r in d.runs) and len(d.runs) == 6
    d = L.Lake(FIXTURE / "no-such-collected", FIXTURE / "reference").discover()
    assert d.missing_roots == ["collected"] and len(d.runs) == 2
    d = L.Lake.in_state_dir(FIXTURE / "nothing-here").discover()
    assert d.missing_roots == ["collected", "reference"] and d.runs == [] and d.rejected == []


def test_an_empty_root_lists_nothing_and_rejects_nothing(tmp_path):                                       # TC-13
    (tmp_path / "state/collected").mkdir(parents=True)
    (tmp_path / "state/reference").mkdir(parents=True)
    d = L.Lake.in_state_dir(tmp_path / "state").discover()
    assert d.runs == [] and d.rejected == [] and d.missing_roots == []


def test_preferred_on_the_real_notes():                                                                   # TC-14
    lake = fixture_lake()
    d = lake.discover()
    assert lake.preferred(d, ID_Q36).node == "gruntus"
    assert lake.preferred(d, ID_REFV).node is None
    assert lake.preferred(d, "combinations/nothing") is None


def set_note(state: Path, node: str, change) -> None:
    p = state / "collected" / node / ID_Q36 / NOTE
    value = json.loads(p.read_bytes())
    change(value)
    p.write_bytes(json.dumps(value).encode())


def test_preferred_follows_the_ranking_on_notes_changed_one_step_at_a_time(scratch):                      # TC-14
    state, lake = scratch

    def pref() -> str:
        return lake.preferred(lake.discover(), ID_Q36).node

    assert pref() == "gruntus"
    set_note(state, "quintus", lambda v: v.__setitem__("settled_at", 1792116938))
    assert pref() == "quintus", "settles later: wins"
    set_note(state, "quintus", lambda v: v.__setitem__("settled_at", 1792116937))
    assert pref() == "gruntus", "equal settled_at: the smaller node name"
    set_note(state, "gruntus", lambda v: v.__setitem__("complete", False))
    assert pref() == "quintus", "a complete copy ranks first"
    set_note(state, "tritus", lambda v: v.__setitem__("files", {f"f{i}": {} for i in range(100)}))
    assert pref() == "tritus", "more files in the note"
    (state / "collected/tritus" / ID_Q36 / NOTE).unlink()
    assert pref() == "quintus", "a copy with no note ranks last"
    (state / "collected/quintus" / ID_Q36 / NOTE).write_bytes(b"not json")
    assert pref() == "gruntus", "a note that is not JSON counts as no note"


def test_preferred_against_the_hosts_lake():                                                              # TC-15
    host = os.environ.get(HOST_STATE_ENV)
    if not host:
        pytest.skip(f"{HOST_STATE_ENV} is not set: the host's lake is not on this machine")
    lake = L.Lake.in_state_dir(Path(host))
    d = lake.discover()
    checked = 0
    for run_id in sorted({r.id for r in d.runs}):
        copies = lake.copies(d, run_id)
        if len(copies) < 2:
            continue

        def holds_raw(r: L.RunRef) -> bool:
            stories = Path(r.dir) / "stories"
            return stories.is_dir() and any((s / RAW_LOG).is_file() for s in stories.iterdir())

        if any(holds_raw(r) for r in copies):
            assert holds_raw(lake.preferred(d, run_id)), f"preferred copy of {run_id} does not hold the raw logs"
            checked += 1
    print(f"TC-15: {checked} ids with several copies and raw logs checked")


def test_the_order_does_not_depend_on_the_order_entries_were_made(tmp_path):                              # TC-16
    def build(order: list[str], tag: str):
        root = tmp_path / tag
        for node in order:
            base = f"state/collected/{node}/combinations/a/b/c/d/e/f-g/benchmarks/p"
            for run in ["r3", "r1", "r2"]:
                write(root / f"{base}/{run}/run.json", b"{}")
            (root / f"state/collected/{node}/stray2").mkdir(parents=True)
            (root / f"state/collected/{node}/stray1").mkdir(parents=True)
        write(root / "state/collected/file-b", b"x")
        write(root / "state/collected/file-a", b"x")
        d = L.Lake.in_state_dir(root / "state").discover()
        return [(r.id, r.node) for r in d.runs], [(r.label, r.code) for r in d.rejected]

    a = build(["m", "a", "z"], "order1")
    b = build(["z", "m", "a"], "order2")
    assert a == b
    ids = [r[0] for r in a[0]]
    assert ids == sorted(ids)
    paths = [r[0] for r in a[1]]
    assert paths == sorted(paths)
    assert sum(1 for r in a[0] if r[0].endswith("/r1")) == 3


def test_rejected_folders_are_ordered_by_their_whole_path_not_by_the_order_the_walk_met_them(scratch):   # TC-16
    state, lake = scratch
    (state / "collected/qq").mkdir()
    (state / "collected/qq/stray").mkdir()
    write(state / "collected/qq-file", b"x")           # "qq" is walked first, but "collected/qq-file" < "collected/qq/stray"
    got = [r.label for r in lake.discover().rejected]
    assert got == ["collected/qq-file", "collected/qq/stray"], got


def test_temporaries_beside_the_records_are_not_runs_or_rejected_entries(scratch):                        # TC-81
    state, lake = scratch
    before = lake.discover()
    run = state / "collected/gruntus" / ID_FRESH
    write(run / ".collection.json.partial", b"x")
    write(run / ".metrics.json.1234.tmp", b"x")
    after = lake.discover()
    assert before == after and after.rejected == []


@needs_non_root
def test_a_folder_that_cannot_be_listed_is_rejected_as_unreadable(scratch):
    state, lake = scratch
    directory = state / "collected/gruntus/combinations/qwen/3.8-swift-1.5/27b"
    directory.chmod(0)
    try:
        d = lake.discover()
    finally:
        directory.chmod(DIR_MODE_WRITABLE)
    assert any(r.code == "E-LAKE-UNREADABLE" and r.label.endswith("combinations/qwen/3.8-swift-1.5/27b")
               for r in d.rejected), d.rejected


def test_a_run_is_found_by_its_id_or_by_node_at_id():
    lake = fixture_lake()
    d = lake.discover()
    assert found(lake.find_run(d, ID_Q36)).node == "gruntus"
    assert found(lake.find_run(d, f"quintus@{ID_Q36}")).node == "quintus"
    a = absent(lake.find_run(d, f"nonode@{ID_Q36}"), "E-LAKE-NO-RUN")
    assert (a.node, a.run) == ("nonode", ID_Q36)
    a = absent(lake.find_run(d, "combinations/none"), "E-LAKE-NO-RUN")
    assert a.node is None
    assert found(lake.find_run(d, ID_REFV)).kind == "reference"


def test_an_id_that_names_no_run_is_a_no_run_absence():                                                   # TC-72
    lake = fixture_lake()
    a = absent(lake.preferred_or_absent(lake.discover(), "combinations/not/in/the/lake"), "E-LAKE-NO-RUN")
    assert (a.run, a.node, a.item, a.detail) == ("combinations/not/in/the/lake", None, "run", "no run with this id")


# ------------------------------------------------------------------------------------------------------------- C. records

def assert_record_equals_file(lake: L.Lake, run: L.RunRef, record: L.Record) -> None:
    path = Path(run.dir) / found(record.relative_path())
    direct = path.read_bytes()
    assert found(lake.bytes(run, record)) == direct, record
    value = found(lake.value(run, record))
    if record.is_text():
        assert value == direct.decode("utf-8")
    else:
        assert value == json.loads(direct)


def test_every_record_of_a_combination_run():                                                             # TC-17
    lake = fixture_lake()
    run = find(lake, ID_FRESH, "gruntus")
    for record in SIX:
        assert_record_equals_file(lake, run, record)


def test_the_records_of_a_reference_run():                                                                # TC-18
    lake = fixture_lake()
    run = find(lake, ID_REFV, None)
    for record in SIX:
        assert_record_equals_file(lake, run, record)


def test_the_story_records():                                                                             # TC-19
    lake = fixture_lake()
    run = find(lake, ID_FRESH, "gruntus")
    for record in [L.accept(1), L.prompt(1), L.base_commit(1), L.gate(1)]:
        assert_record_equals_file(lake, run, record)
    assert found(lake.value(run, L.base_commit(1))) == FRESH_BASE_COMMIT


def add_rescore(state: Path, node: str, run_id: str, version: str) -> None:
    run = state / "collected" / node / run_id
    write(run / "rescore" / version / "rescore.json", b'{"version":"x"}')
    accept_bytes = (run / "stories/01/accept-summary.json").read_bytes()
    write(run / "rescore" / version / "stories/01/accept-summary.json", accept_bytes)


def test_the_rescore_records(scratch):                                                                    # TC-20
    state, lake = scratch
    add_rescore(state, "gruntus", ID_FRESH, "vidi-v2.0-pre2")
    run = find(lake, ID_FRESH, "gruntus")
    version = "vidi-v2.0-pre2"
    assert found(lake.bytes(run, L.rescore(version))) == b'{"version":"x"}'
    assert found(lake.value(run, L.rescore(version)))["version"] == "x"
    direct = (Path(run.dir) / "rescore/vidi-v2.0-pre2/stories/01/accept-summary.json").read_bytes()
    assert found(lake.bytes(run, L.rescore_accept(version, 1))) == direct
    a = absent(lake.bytes(run, L.rescore_accept(version, 2)), "E-LAKE-NOT-COLLECTED")
    assert a.item == "record:rescore-accept:vidi-v2.0-pre2:2"


def test_the_rescore_versions_are_listed_in_byte_order(scratch):                                          # TC-21
    state, lake = scratch
    add_rescore(state, "gruntus", ID_FRESH, "v2")
    add_rescore(state, "gruntus", ID_FRESH, "v1")
    run_dir = state / "collected/gruntus" / ID_FRESH
    write(run_dir / "rescore/notes.txt", b"x")
    (run_dir / "rescore/bad name").mkdir()
    os.symlink(run_dir / "rescore/v1", run_dir / "rescore/v0-link")
    assert found(lake.rescore_versions(find(lake, ID_FRESH, "gruntus"))) == ["v1", "v2"]
    assert found(lake.rescore_versions(find(lake, ID_Q36, "gruntus"))) == []


def test_a_rescore_folder_that_is_a_link_is_not_a_file(scratch):                                          # TC-21
    state, lake = scratch
    os.symlink(state, state / "collected/gruntus" / ID_FRESH / "rescore")
    absent(lake.rescore_versions(find(lake, ID_FRESH, "gruntus")), "E-LAKE-NOT-A-FILE")


def test_the_text_records_are_text_and_the_same_bytes():                                                  # TC-22
    lake = fixture_lake()
    run = find(lake, ID_FRESH, "gruntus")
    for record in [L.prompt(1), L.base_commit(1)]:
        data = found(lake.bytes(run, record))
        assert found(lake.value(run, record)).encode("utf-8") == data


def test_bytes_are_exact_for_non_utf8_and_crlf(scratch):                                                  # TC-23
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    run = find(lake, ID_FRESH, "gruntus")
    odd = bytes([0xFF, 0xFE, 0x0D, 0x0A, 0x00, 0x78])
    (run_dir / "stories/01/prompt.md").write_bytes(odd)
    assert found(lake.bytes(run, L.prompt(1))) == odd
    a = absent(lake.value(run, L.prompt(1)), "E-LAKE-MALFORMED")
    assert a.detail == "not valid UTF-8"
    (run_dir / "stories/01/prompt.md").write_bytes(b"a\r\nb\r\n")
    assert found(lake.value(run, L.prompt(1))) == "a\r\nb\r\n"
    crlf = b'{\r\n "a": 1\r\n}\r\n'
    (run_dir / "stories/01/gate.json").write_bytes(crlf)
    assert found(lake.bytes(run, L.gate(1))) == crlf
    assert found(lake.value(run, L.gate(1)))["a"] == 1
    (run_dir / "stories/01/gate.json").write_bytes(b'{"a":"\xff"}')
    assert absent(lake.value(run, L.gate(1)), "E-LAKE-MALFORMED").detail == "not valid UTF-8"
    (run_dir / "stories/01/gate.json").write_bytes(b"\xef\xbb\xbf{}")
    assert absent(lake.value(run, L.gate(1)), "E-LAKE-MALFORMED").detail == "not valid JSON"


def test_the_commit_of_a_story_is_in_the_metrics():                                                       # TC-24
    lake = fixture_lake()
    run = find(lake, ID_Q36, "gruntus")
    commit = found(lake.value(run, L.METRICS))["stories"]["1"]["commit"]
    assert len(commit) == 40 and commit == REAL_COMMIT_1
    direct = json.loads((Path(run.dir) / "metrics.json").read_bytes())
    assert direct["stories"]["1"]["commit"] == commit


def test_an_absent_record_of_a_combination_run_names_run_node_and_record():                               # TC-27
    lake = fixture_lake()
    run = find(lake, ID_Q36, "quintus")
    a = absent(lake.bytes(run, L.FINALIZE), "E-LAKE-NOT-COLLECTED")
    assert (a.run, a.node, a.item) == (ID_Q36, "quintus", "record:finalize")
    assert a.to_text() == f"run={ID_Q36} node=quintus item=record:finalize code=E-LAKE-NOT-COLLECTED detail=no such file"
    assert lake.value(run, L.FINALIZE) == a


def test_an_absent_record_of_a_reference_run(scratch):                                                    # TC-28
    state, lake = scratch
    (state / "reference/vidi/sonnet-5.5/v2-r1/progress.json").unlink()
    a = absent(lake.bytes(find(lake, ID_REFV, None), L.PROGRESS), "E-LAKE-NOT-COLLECTED")
    assert (a.node, a.run) == (None, ID_REFV)
    absent(lake.bytes(find(lake, ID_TODOODLE, None), L.METRICS), "E-LAKE-NOT-COLLECTED")


def test_a_link_or_folder_in_the_place_of_a_record_is_not_a_file(scratch):                                # TC-29
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    run = find(lake, ID_FRESH, "gruntus")
    (run_dir / "metrics.json").unlink()
    os.symlink(run_dir / "finalize.json", run_dir / "metrics.json")
    absent(lake.bytes(run, L.METRICS), "E-LAKE-NOT-A-FILE")
    absent(lake.value(run, L.METRICS), "E-LAKE-NOT-A-FILE")
    (run_dir / "metrics.json").unlink()
    (run_dir / "metrics.json").mkdir()
    absent(lake.bytes(run, L.METRICS), "E-LAKE-NOT-A-FILE")
    outside = state / "outside"
    shutil.copytree(run_dir / "stories/01", outside)
    shutil.rmtree(run_dir / "stories/01")
    os.symlink(outside, run_dir / "stories/01")
    absent(lake.bytes(run, L.accept(1)), "E-LAKE-NOT-A-FILE")


def test_story_0_and_999_are_read_from_their_folders(scratch):                                            # TC-30
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    write(run_dir / "stories/00/gate.json", b'{"s":0}')
    write(run_dir / "stories/999/gate.json", b'{"s":999}')
    run = find(lake, ID_FRESH, "gruntus")
    assert found(lake.value(run, L.gate(0)))["s"] == 0
    assert found(lake.value(run, L.gate(999)))["s"] == 999


def nowhere() -> L.RunRef:
    return L.RunRef(kind="combination", node="nowhere", id="combinations/x", dir="/this/folder/does/not/exist",
                    label="collected/nowhere/combinations/x")


def test_a_story_out_of_range_is_a_bad_name_before_any_file_is_touched():                                 # TC-31
    lake = fixture_lake()
    for story in [1000, -1]:
        a = absent(lake.bytes(nowhere(), L.accept(story)), "E-LAKE-BAD-NAME")
        assert (a.detail, a.item) == ("story out of range", f"record:accept:{story}")
        absent(lake.value(nowhere(), L.gate(story)), "E-LAKE-BAD-NAME")
    for story in [0, 999]:
        absent(lake.bytes(nowhere(), L.accept(story)), "E-LAKE-NOT-COLLECTED")


def test_versions_are_checked_before_any_file_is_touched():                                               # TC-32, TC-33
    lake = fixture_lake()
    absent(lake.bytes(nowhere(), L.rescore("a")), "E-LAKE-NOT-COLLECTED")
    for version in ["", "a" * SIXTY_FIVE, "a/b", "..", "a b", "../../etc"]:
        assert absent(lake.bytes(nowhere(), L.rescore(version)), "E-LAKE-BAD-NAME").detail == "version not valid"
        absent(lake.bytes(nowhere(), L.rescore_accept(version, 1)), "E-LAKE-BAD-NAME")


def test_a_record_that_does_not_parse_is_malformed_and_its_bytes_are_still_returned(scratch):            # TC-34
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    whole = (run_dir / "metrics.json").read_bytes()
    half = whole[: len(whole) // 2]
    (run_dir / "metrics.json").write_bytes(half)
    run = find(lake, ID_FRESH, "gruntus")
    a = absent(lake.value(run, L.METRICS), "E-LAKE-MALFORMED")
    assert a.detail == "not valid JSON"
    assert a.message, "the parser's message is carried"
    assert found(lake.bytes(run, L.METRICS)) == half


@needs_non_root
def test_a_record_made_unreadable_is_an_unreadable_absence(scratch):                                      # TC-73
    state, lake = scratch
    p = state / "collected/gruntus" / ID_FRESH / "metrics.json"
    p.chmod(0)
    run = find(lake, ID_FRESH, "gruntus")
    a = absent(lake.bytes(run, L.METRICS), "E-LAKE-UNREADABLE")
    assert a.detail == "permission denied" and a.message
    absent(lake.value(run, L.METRICS), "E-LAKE-UNREADABLE")


def test_a_record_absent_in_one_copy_is_not_taken_from_another():                                         # TC-74
    lake = fixture_lake()
    d = lake.discover()
    gruntus = found(lake.find_run(d, ID_Q36))
    assert isinstance(lake.bytes(gruntus, L.FINALIZE), L.Found), "the preferred copy holds finalize.json"
    quintus = found(lake.find_run(d, f"quintus@{ID_Q36}"))
    a = absent(lake.bytes(quintus, L.FINALIZE), "E-LAKE-NOT-COLLECTED")
    assert a.node == "quintus"


def test_no_default_value_is_returned_for_an_absent_record():                                             # TC-75
    lake = fixture_lake()
    run = find(lake, ID_FLASH, "tritus")
    for record in [L.METRICS, L.accept(1), L.prompt(1), L.base_commit(1)]:
        assert isinstance(lake.value(run, record), L.Absent), record
        assert isinstance(lake.bytes(run, record), L.Absent), record


def test_a_transfer_in_progress_is_never_returned(scratch):                                               # TC-79
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    (run_dir / "metrics.json").unlink()
    (run_dir / ".metrics.json.partial").write_bytes(b'{"half":')
    (run_dir / ".metrics.json.1234.tmp").write_bytes(b'{"half":')
    run = find(lake, ID_FRESH, "gruntus")
    absent(lake.bytes(run, L.METRICS), "E-LAKE-NOT-COLLECTED")
    absent(lake.value(run, L.METRICS), "E-LAKE-NOT-COLLECTED")
    assert L.Record.from_relative_path(".metrics.json.partial") is None
    assert L.Record.from_relative_path(".metrics.json.1234.tmp") is None


def test_a_transfer_next_to_a_good_file_leaves_the_good_file(scratch):                                    # TC-80
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    good = (run_dir / "metrics.json").read_bytes()
    (run_dir / ".metrics.json.partial").write_bytes(b'{"half":')
    (run_dir / ".metrics.json.1234.tmp").write_bytes(b"junk")
    assert found(lake.bytes(find(lake, ID_FRESH, "gruntus"), L.METRICS)) == good


# ---------------------------------------------------------------------------------------------------------------- D. logs

def story_dir_of(state: Path, node: str, run_id: str) -> Path:
    return state / "collected" / node / run_id / "stories/01"


def stored_gzip(decoded: bytes) -> bytes:
    """A gzip file of decoded whose blocks are stored (level 0), so the file system can compress it."""
    return gzip.compress(decoded, compresslevel=0)


def test_a_raw_log_not_compressed_is_the_raw_form(scratch):                                               # TC-36
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_FRESH)
    (directory / COMPACT_LOG).unlink()
    log = found(lake.log(find(lake, ID_FRESH, "gruntus"), 1))
    assert log.form == "raw"
    assert found(log.bytes()) == (directory / RAW_LOG).read_bytes()
    lines, err = collect_lines(log)
    assert err is None and len(lines) == FIXTURE_RAW_LINES
    assert lines == split_lines((directory / RAW_LOG).read_bytes())


def test_a_compact_log_not_compressed_is_the_compact_form_decoded():                                      # TC-38
    lake = fixture_lake()
    run = find(lake, ID_Q36, "gruntus")
    log = found(lake.log(run, 1))
    assert log.form == "compact"
    direct = gunzip((Path(run.dir) / "stories/01" / COMPACT_LOG).read_bytes())
    assert found(log.bytes()) == direct
    lines, err = collect_lines(log)
    assert err is None and lines == split_lines(direct) and len(lines) > 1000


def test_with_both_forms_the_raw_log_is_preferred():                                                      # TC-40
    lake = fixture_lake()
    run = find(lake, ID_FRESH, "gruntus")
    directory = Path(run.dir) / "stories/01"
    assert (directory / RAW_LOG).is_file() and (directory / COMPACT_LOG).is_file()
    log = found(lake.log(run, 1))
    assert log.form == "raw"
    assert found(log.bytes()) == (directory / RAW_LOG).read_bytes()
    assert (directory / RAW_LOG).read_bytes() != gunzip((directory / COMPACT_LOG).read_bytes())


def test_a_reference_run_with_only_a_compact_log():
    lake = fixture_lake()
    log = found(lake.log(find(lake, ID_REFV, None), 1))
    assert log.form == "compact" and len(found(log.bytes())) > 1000


def test_a_raw_log_compressed_by_the_file_system_has_the_same_bytes(scratch, tmp_path):                   # TC-35
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_FRESH)
    plain = (directory / RAW_LOG).read_bytes()
    (directory / COMPACT_LOG).unlink()
    source = tmp_path / "raw-source.jsonl"
    source.write_bytes(plain)
    (directory / RAW_LOG).unlink()
    if not fs_compressed_copy(source, directory / RAW_LOG):
        pytest.skip("this file system did not mark the copy as compressed")
    log = found(lake.log(find(lake, ID_FRESH, "gruntus"), 1))
    assert log.form == "raw" and found(log.bytes()) == plain


def test_a_compact_log_compressed_by_the_file_system_and_both_forms_compressed(scratch, tmp_path):        # TC-37, TC-39
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_Q36)
    decoded = gunzip((directory / COMPACT_LOG).read_bytes())
    source = tmp_path / "stored.gz"
    source.write_bytes(stored_gzip(decoded))
    (directory / COMPACT_LOG).unlink()
    if not fs_compressed_copy(source, directory / COMPACT_LOG):
        pytest.skip("this file system did not mark the copy as compressed")
    run = find(lake, ID_Q36, "gruntus")
    log = found(lake.log(run, 1))
    assert log.form == "compact" and found(log.bytes()) == decoded
    raw = b'{"a":1}\n'
    raw_source = tmp_path / "raw2.jsonl"
    raw_source.write_bytes(raw * 4096)
    if not fs_compressed_copy(raw_source, directory / RAW_LOG):
        pytest.skip("the raw copy was not compressed")
    log = found(lake.log(run, 1))
    assert log.form == "raw" and found(log.bytes()) == raw * 4096


def test_a_story_with_no_log_is_not_collected():                                                          # TC-41
    lake = fixture_lake()
    a = absent(lake.log(find(lake, ID_FRESH, "gruntus"), 2), "E-LAKE-NOT-COLLECTED")
    assert (a.item, a.node) == ("log:2", "gruntus")
    assert a.to_json() == ('{"code":"E-LAKE-NOT-COLLECTED","detail":"no such file","item":"log:2","node":"gruntus",'
                           f'"run":"{ID_FRESH}"}}')


def test_a_log_story_out_of_range_is_a_bad_name():
    lake = fixture_lake()
    run = find(lake, ID_FRESH, "gruntus")
    for story in [1000, -1]:
        a = absent(lake.log(run, story), "E-LAKE-BAD-NAME")
        assert (a.detail, a.item) == ("story out of range", f"log:{story}")


def test_a_zero_byte_raw_log_has_no_bytes_and_no_lines(scratch):                                          # TC-42
    state, lake = scratch
    (story_dir_of(state, "gruntus", ID_FRESH) / RAW_LOG).write_bytes(b"")
    log = found(lake.log(find(lake, ID_FRESH, "gruntus"), 1))
    assert log.form == "raw" and found(log.bytes()) == b"" and list(log.lines()) == []
    d = found(log.digest())
    assert (d.length, d.lines) == (0, 0)
    assert d.sha256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_lines_are_split_at_line_feeds_only_and_a_last_piece_without_one_counts(scratch):                 # TC-43
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_FRESH)
    run = find(lake, ID_FRESH, "gruntus")
    cases = [
        (b"abc", [b"abc"]), (b"abc\n", [b"abc"]), (b"a\n\nb", [b"a", b"", b"b"]), (b"a\n\n", [b"a", b""]),
        (b"a\r\nb\r\n", [b"a\r", b"b\r"]), (b"\n", [b""]),
    ]
    for data, want in cases:
        (directory / RAW_LOG).write_bytes(data)
        log = found(lake.log(run, 1))
        lines, err = collect_lines(log)
        assert err is None and lines == want, data
        d = found(log.digest())
        assert (d.lines, d.length) == (len(want), len(data)), data


def test_lines_of_a_large_log_use_the_memory_of_one_line_not_the_file(scratch):                           # TC-44
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_FRESH)
    line = ('{"type":"x","pad":"' + "p" * (BIG_LINE_BYTES - 20) + '"}\n').encode()
    count = BIG_LOG_BYTES // len(line)
    with open(directory / RAW_LOG, "wb") as f:
        chunk = line * 1000
        for _ in range(count // 1000):
            f.write(chunk)
        f.write(line * (count % 1000))
    log = found(lake.log(find(lake, ID_FRESH, "gruntus"), 1))
    before = rss_kib()
    peak = before
    n = 0
    for item in log.lines():
        assert len(found(item)) + 1 == len(line)
        n += 1
        if n % RSS_SAMPLE_EVERY_LINES == 0:
            peak = max(peak, rss_kib())
    assert n == count
    assert peak - before < RSS_GROWTH_LIMIT_KIB, f"resident memory grew by {peak - before} KiB reading {BIG_LOG_BYTES // MIB} MiB"
    assert found(log.digest()).lines == count
    assert rss_kib() - before < RSS_GROWTH_LIMIT_KIB


def test_a_damaged_compact_file_delivers_the_lines_before_the_damage_then_malformed(scratch):             # TC-45
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_Q36)
    whole = (directory / COMPACT_LOG).read_bytes()
    (directory / COMPACT_LOG).write_bytes(whole[: len(whole) // 2])
    log = found(lake.log(find(lake, ID_Q36, "gruntus"), 1))
    assert log.form == "compact"
    lines, err = collect_lines(log)
    assert lines, "the lines before the damage are delivered"
    assert lines == split_lines(gunzip(whole))[: len(lines)], "and they are the right lines"
    assert err is not None and (err.code, err.detail, err.item) == ("E-LAKE-MALFORMED", "not valid gzip", "log:1")
    absent(log.bytes(), "E-LAKE-MALFORMED")
    absent(log.digest(), "E-LAKE-MALFORMED")


def test_a_compact_file_that_is_not_gzip_is_malformed_with_no_lines(scratch):                             # TC-45
    state, lake = scratch
    (story_dir_of(state, "gruntus", ID_Q36) / COMPACT_LOG).write_bytes(b"this is not gzip at all, just text\n")
    log = found(lake.log(find(lake, ID_Q36, "gruntus"), 1))
    lines, err = collect_lines(log)
    assert lines == [] and err.code == "E-LAKE-MALFORMED" and err.detail == "not valid gzip"


def test_a_link_or_folder_in_a_logs_place_is_not_a_file(scratch):                                         # TC-46
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_FRESH)
    raw_bytes = (directory / RAW_LOG).read_bytes()
    (directory / COMPACT_LOG).unlink()
    os.rename(directory / RAW_LOG, directory / "moved.jsonl")
    os.symlink(directory / "moved.jsonl", directory / RAW_LOG)
    run = find(lake, ID_FRESH, "gruntus")
    a = absent(lake.log(run, 1), "E-LAKE-NOT-A-FILE")
    assert a.item == "log:1"
    (directory / COMPACT_LOG).write_bytes(stored_gzip(raw_bytes))
    log = found(lake.log(run, 1))
    assert log.form == "compact" and found(log.bytes()) == raw_bytes, "with a regular compact file beside the link"
    (directory / COMPACT_LOG).unlink()
    (directory / RAW_LOG).unlink()
    (directory / RAW_LOG).mkdir()
    absent(lake.log(run, 1), "E-LAKE-NOT-A-FILE")


@needs_non_root
def test_an_unreadable_log_is_an_unreadable_absence(scratch):
    state, lake = scratch
    (story_dir_of(state, "gruntus", ID_FRESH) / RAW_LOG).chmod(0)
    a = absent(lake.log(find(lake, ID_FRESH, "gruntus"), 1), "E-LAKE-UNREADABLE")
    assert a.detail == "permission denied"


def test_a_log_being_transferred_is_not_a_log(scratch):
    state, lake = scratch
    directory = story_dir_of(state, "gruntus", ID_FRESH)
    (directory / RAW_LOG).unlink()
    (directory / COMPACT_LOG).unlink()
    (directory / ".agent-events.jsonl.partial").write_bytes(b"{}\n")
    (directory / ".agent-events.compact.jsonl.gz.99.tmp").write_bytes(b"x")
    absent(lake.log(find(lake, ID_FRESH, "gruntus"), 1), "E-LAKE-NOT-COLLECTED")


def test_the_digest_is_the_hash_of_the_decoded_bytes():
    lake = fixture_lake()
    log = found(lake.log(find(lake, ID_Q36, "gruntus"), 1))
    data = found(log.bytes())
    d = found(log.digest())
    assert d.length == len(data) and d.sha256 == L.sha256_hex(data) and d.lines == len(split_lines(data))


# -------------------------------------------------------------------------------------------------------------- E. workspace

def tree_of(directory: Path, commit: str) -> dict[str, str]:
    out = {}
    for line in git_in(directory, "ls-tree", "-r", commit).splitlines():
        meta, path = line.split("\t", 1)
        out[path] = meta.split(" ")[2]
    return out


def set_commit(state: Path, story: int, commit: str) -> None:
    p = state / "collected/gruntus" / ID_Q36 / "metrics.json"
    value = json.loads(p.read_bytes())
    value["stories"][str(story)]["commit"] = commit
    p.write_bytes(json.dumps(value).encode())


def empty_or_missing(p: Path) -> bool:
    return not p.exists() or not any(p.iterdir())


def test_a_working_copy_at_a_story_is_a_clean_detached_checkout_of_its_commit(scratch, tmp_path):         # TC-47
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    dest = tmp_path / "work"
    ws = found(lake.workspace(run, 1, dest))
    assert ws.path == dest and ws.commit == REAL_COMMIT_1
    assert git_in(dest, "rev-parse", "HEAD") == REAL_COMMIT_1
    assert git_in(dest, "rev-parse", "--abbrev-ref", "HEAD") == "HEAD", "detached"
    assert git_in(dest, "status", "--porcelain") == "", "a clean tree"
    assert (dest / ".git").is_dir()
    assert found(lake.value(run, L.METRICS))["stories"]["1"]["commit"] == ws.commit


def test_the_working_copy_equals_the_repositorys_tracked_workspace_of_that_story(scratch, tmp_path):      # TC-48, TC-109
    if not (GIT_REPO / ".git").exists():
        pytest.skip("no repository next to the crate")
    tracked = subprocess.run(["git", "-C", str(GIT_REPO), "ls-tree", "-r", "HEAD", "--", f"{ID_Q36}/workspace"],
                             capture_output=True, text=True).stdout
    if not tracked.strip():
        pytest.skip("the repository does not track this run's workspace")
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    dest = tmp_path / "last"
    ws = found(lake.workspace(run, LAST_STORY, dest))
    assert git_in(dest, "rev-parse", "HEAD") == ws.commit
    prefix = f"{ID_Q36}/workspace/"
    compared = 0
    repo_paths = []
    for line in tracked.splitlines():
        meta, path = line.split("\t", 1)
        blob = meta.split(" ")[2]
        rel = path[len(prefix):]
        repo_paths.append(rel)
        assert git_in(dest, "hash-object", "--", rel) == blob, rel
        compared += 1
    assert compared > 100, compared
    ours = tree_of(dest, ws.commit)
    for p in repo_paths:
        assert p in ours, p
    extra = [p for p in ours if p not in repo_paths]
    assert all(p.startswith("spec/") for p in extra), extra


def test_the_bundle_is_unchanged_by_a_working_copy(scratch, tmp_path):                                    # TC-49
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    before = (Path(run.dir) / BUNDLE).read_bytes()
    found(lake.workspace(run, 1, tmp_path / "w"))
    assert (Path(run.dir) / BUNDLE).read_bytes() == before


def test_an_existing_empty_folder_is_accepted_as_the_destination(scratch, tmp_path):                      # TC-50
    state, lake = scratch
    dest = tmp_path / "w"
    dest.mkdir()
    ws = found(lake.workspace(find(lake, ID_Q36, "gruntus"), 1, dest))
    assert git_in(dest, "rev-parse", "HEAD") == ws.commit


def test_a_run_with_no_bundle_is_not_collected_and_nothing_is_made(scratch, tmp_path):                    # TC-51
    state, lake = scratch
    run = find(lake, ID_FLASH, "tritus")
    dest = tmp_path / "w"
    a = absent(lake.workspace(run, 1, dest), "E-LAKE-NOT-COLLECTED")
    assert (a.item, a.node) == ("bundle", "tritus")
    assert not dest.exists()
    assert absent(lake.workspace(run, 99, dest)).item == "bundle", "the bundle is looked for first"


def test_a_bundle_that_is_a_link_is_not_a_file(scratch, tmp_path):                                        # TC-51
    state, lake = scratch
    b = state / "collected/gruntus" / ID_Q36 / BUNDLE
    moved = tmp_path / "moved.bundle"
    os.rename(b, moved)
    os.symlink(moved, b)
    a = absent(lake.workspace(find(lake, ID_Q36, "gruntus"), 1, tmp_path / "w"), "E-LAKE-NOT-A-FILE")
    assert a.item == "bundle"


def test_metrics_that_are_not_there_are_not_collected_for_the_workspace(scratch, tmp_path):               # TC-51
    state, lake = scratch
    (state / "collected/gruntus" / ID_Q36 / "metrics.json").unlink()
    a = absent(lake.workspace(find(lake, ID_Q36, "gruntus"), 1, tmp_path / "w"), "E-LAKE-NOT-COLLECTED")
    assert a.item == "workspace:1"


def test_a_story_with_no_commit_is_malformed_and_nothing_is_made(scratch, tmp_path):                      # TC-52
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    assert str(STORY_WITHOUT_COMMIT) not in found(lake.value(run, L.METRICS))["stories"]
    dest = tmp_path / "w"
    a = absent(lake.workspace(run, STORY_WITHOUT_COMMIT, dest), "E-LAKE-MALFORMED")
    assert (a.detail, a.item) == ("no commit for story", f"workspace:{STORY_WITHOUT_COMMIT}")
    assert not dest.exists()
    p = state / "collected/gruntus" / ID_Q36 / "metrics.json"
    value = json.loads(p.read_bytes())
    del value["stories"]["2"]["commit"]
    value["stories"]["3"]["commit"] = 7
    p.write_bytes(json.dumps(value).encode())
    for story in [2, 3]:
        assert absent(lake.workspace(run, story, tmp_path / "w2"), "E-LAKE-MALFORMED").detail == "no commit for story"


def test_a_commit_that_is_not_in_the_bundle_is_malformed_and_the_folder_the_library_made_is_removed(scratch, tmp_path):  # TC-53
    state, lake = scratch
    set_commit(state, 1, "0123456789abcdef0123456789abcdef01234567")
    run = find(lake, ID_Q36, "gruntus")
    dest = tmp_path / "w"
    a = absent(lake.workspace(run, 1, dest), "E-LAKE-MALFORMED")
    assert (a.detail, a.item) == ("commit not in bundle", "workspace:1")
    assert not dest.exists()
    pre = tmp_path / "pre"
    pre.mkdir()
    absent(lake.workspace(run, 1, pre))
    assert pre.exists() and empty_or_missing(pre), "an existing empty folder is left empty"


def test_a_commit_that_is_not_40_hexadecimal_characters_is_malformed(scratch, tmp_path):                  # TC-54
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    for bad in [REAL_COMMIT_1[:39], "zzz592fca04af9fe2c8b667b3a784298795ccde9", "", "HEAD", "--upload-pack=x"]:
        set_commit(state, 1, bad)
        a = absent(lake.workspace(run, 1, tmp_path / "w"), "E-LAKE-MALFORMED")
        assert a.detail == "commit is not 40 hexadecimal characters", repr(bad)
    assert not (tmp_path / "w").exists()


def test_a_story_out_of_range_has_no_workspace(scratch, tmp_path):
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    for story in [1000, -1]:
        a = absent(lake.workspace(run, story, tmp_path / "w"), "E-LAKE-BAD-NAME")
        assert (a.detail, a.item) == ("story out of range", f"workspace:{story}")


def test_a_destination_inside_a_root_is_refused_even_through_a_link_or_dots(scratch, tmp_path):           # TC-55
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    inside = state / "collected/new-dest"
    refused(lake.workspace(run, 1, inside), "E-LAKE-DEST-INSIDE-ROOT")
    assert not inside.exists()
    refused(lake.workspace(run, 1, state / "reference/x"), "E-LAKE-DEST-INSIDE-ROOT")
    refused(lake.workspace(run, 1, state / "collected"), "E-LAKE-DEST-INSIDE-ROOT")
    link = tmp_path / "link"
    os.symlink(state / "collected", link)
    refused(lake.workspace(run, 1, link / "via-link"), "E-LAKE-DEST-INSIDE-ROOT")
    assert not (state / "collected/via-link").exists()
    (tmp_path / "a").mkdir()
    refused(lake.workspace(run, 1, tmp_path / "a/../state/collected/climb"), "E-LAKE-DEST-INSIDE-ROOT")
    assert not (state / "collected/climb").exists()


def test_a_destination_that_is_not_empty_is_refused_and_untouched(scratch, tmp_path):                     # TC-56
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    dest = tmp_path / "w"
    write(dest / "keep.txt", b"mine")
    r = refused(lake.workspace(run, 1, dest), "E-LAKE-DEST-NOT-EMPTY")
    assert r.detail == "destination is not empty"
    assert (dest / "keep.txt").read_bytes() == b"mine" and len(list(dest.iterdir())) == 1
    afile = tmp_path / "afile"
    afile.write_bytes(b"x")
    refused(lake.workspace(run, 1, afile), "E-LAKE-DEST-NOT-EMPTY")


def test_when_git_fails_the_refusal_carries_gits_message_and_leaves_the_destination_empty(scratch, tmp_path):  # TC-57
    state, lake = scratch
    x = 12345
    random = bytearray()
    for _ in range(RANDOM_BUNDLE_BYTES):
        x = (x * LCG_MUL + LCG_ADD) & UINT64_MASK
        random.append((x >> LCG_SHIFT) & 0xFF)
    (state / "collected/gruntus" / ID_Q36 / BUNDLE).write_bytes(bytes(random))
    dest = tmp_path / "w"
    r = refused(lake.workspace(find(lake, ID_Q36, "gruntus"), 1, dest), "E-LAKE-GIT-FAILED")
    assert r.detail == "git clone failed" and r.message
    assert empty_or_missing(dest)


def test_the_callers_git_settings_do_not_matter(scratch, tmp_path, monkeypatch):                          # TC-58
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    plain = tmp_path / "plain"
    found(lake.workspace(run, 1, plain))
    marker = tmp_path / "HOOK-RAN"
    hook_text = f"#!/bin/sh\ntouch {marker}\n".encode()
    template = tmp_path / "template"
    write(template / "hooks/post-checkout", hook_text)
    (template / "hooks/post-checkout").chmod(0o755)
    hooks = tmp_path / "hooks"
    write(hooks / "post-checkout", hook_text)
    (hooks / "post-checkout").chmod(0o755)
    cfg = tmp_path / "gitconfig"
    cfg.write_text(f"[core]\n\thooksPath = {hooks}\n\tautocrlf = true\n[init]\n\ttemplateDir = {template}\n"
                   "[checkout]\n\tdefaultRemote = nonsense\n")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_TEMPLATE_DIR", str(template))
    monkeypatch.setenv("GIT_DIR", str(tmp_path / "nonexistent-git-dir"))
    monkeypatch.setenv("GIT_WORK_TREE", str(tmp_path / "nonexistent-tree"))
    monkeypatch.setenv("HOME", str(tmp_path))
    dirty = tmp_path / "dirty"
    ws = found(lake.workspace(run, 1, dirty))
    monkeypatch.undo()
    assert not marker.exists(), "no hook of the caller's configuration ran"
    assert ws.commit == REAL_COMMIT_1
    assert tree_of(dirty, ws.commit) == tree_of(plain, ws.commit)
    files = lambda d: {p: (d / p).read_bytes() for p in tree_of(d, REAL_COMMIT_1)}
    assert files(dirty) == files(plain), "same bytes, no line-ending conversion"
    hooks_dir = dirty / ".git/hooks"
    assert not hooks_dir.exists() or not any(hooks_dir.iterdir()), "no hook was copied from the template"


def test_a_working_copy_writes_only_its_destination(scratch, tmp_path):                                   # TC-84
    state, lake = scratch
    run = find(lake, ID_Q36, "gruntus")
    before = snapshot(state)
    dest = tmp_path / "w"
    found(lake.workspace(run, 1, dest))
    assert snapshot(state) == before
    assert (dest / ".git").is_dir() and len(list(dest.iterdir())) > 1
    lake.workspace(run, 1, state / "collected/x")
    lake.workspace(run, STORY_WITHOUT_COMMIT, tmp_path / "w2")
    assert snapshot(state) == before


def test_a_reference_run_has_a_working_copy_too(scratch, tmp_path):
    state, lake = scratch
    ws = found(lake.workspace(find(lake, ID_REFV, None), 1, tmp_path / "w"))
    assert len(ws.commit) == 40 and git_in(tmp_path / "w", "rev-parse", "HEAD") == ws.commit


# ------------------------------------------------------------------------------------------------------------ F. complete

def parts(c: L.Completeness):
    return c.kind, c.state, c.settled_at, c.collected_at


def test_a_combination_run_that_is_complete():                                                            # TC-59
    lake = fixture_lake()
    assert parts(found(lake.completeness(find(lake, ID_FRESH, "gruntus")))) == ("complete", "finished", 1792116937, 1792160967)


def test_a_combination_run_that_is_incomplete():                                                          # TC-60
    lake = fixture_lake()
    assert parts(found(lake.completeness(find(lake, ID_DRY, "gruntus")))) == ("incomplete", None, None, 1792161516)


def test_a_combination_run_with_no_note(scratch):                                                         # TC-61
    state, lake = scratch
    (state / "collected/gruntus" / ID_FRESH / NOTE).unlink()
    assert found(lake.completeness(find(lake, ID_FRESH, "gruntus"))) == L.Completeness(kind="no-note")


def test_a_reference_run_that_is_complete():                                                              # TC-62
    lake = fixture_lake()
    assert parts(found(lake.completeness(find(lake, ID_REFV, None)))) == ("complete", "finished", 1792040989, 1792158296)


def test_a_reference_run_that_is_incomplete(scratch):                                                     # TC-63
    state, lake = scratch
    p = state / "reference/vidi/sonnet-5.5/v2-r1" / NOTE
    value = json.loads(p.read_bytes())
    value["complete"] = False
    p.write_bytes(json.dumps(value).encode())
    assert found(lake.completeness(find(lake, ID_REFV, None))).kind == "incomplete"


def test_a_reference_run_with_no_note():                                                                  # TC-64
    lake = fixture_lake()
    assert found(lake.completeness(find(lake, ID_TODOODLE, None))) == L.Completeness(kind="no-note")


def test_a_settled_at_of_null_is_none():                                                                  # TC-65
    c = L.decide({"complete": False, "settled_at": None, "collected_at": 5, "run_status": None})
    assert c == L.Completeness(kind="incomplete", state=None, settled_at=None, collected_at=5)


def test_complete_true_with_state_and_times():
    c = L.decide({"complete": True, "settled_at": 7, "collected_at": 9, "run_status": {"state": "finished"}})
    assert c == L.Completeness(kind="complete", state="finished", settled_at=7, collected_at=9)


def test_a_state_or_time_of_the_wrong_type_is_none():
    c = L.decide({"complete": True, "settled_at": "soon", "collected_at": [1], "run_status": {"state": 3}})
    assert c == L.Completeness(kind="complete")
    assert L.decide({"complete": True, "run_status": "finished"}) == L.Completeness(kind="complete")
    assert L.decide({"complete": True, "settled_at": True, "collected_at": False}) == L.Completeness(kind="complete")


def test_a_note_that_is_not_json_is_malformed(scratch):                                                   # TC-66
    state, lake = scratch
    (state / "collected/gruntus" / ID_FRESH / NOTE).write_bytes(b"this is text")
    a = absent(lake.completeness(find(lake, ID_FRESH, "gruntus")), "E-LAKE-MALFORMED")
    assert (a.detail, a.item) == ("not valid JSON", "record:collection")


def test_a_note_that_is_not_an_object_is_malformed():                                                     # TC-66
    for note_value in [[1], "text", 3, None]:
        assert L.decide(note_value) == "note is not an object", note_value


def test_a_note_with_no_boolean_complete_is_malformed(scratch):                                           # TC-67
    for note_value in [{"complete": "yes"}, {"complete": 1}, {"complete": None}, {}]:
        assert L.decide(note_value) == "complete is not a boolean", note_value
    state, lake = scratch
    p = state / "collected/gruntus" / ID_FRESH / NOTE
    run = find(lake, ID_FRESH, "gruntus")
    p.write_bytes(b'{"complete":"yes"}')
    assert absent(lake.completeness(run), "E-LAKE-MALFORMED").detail == "complete is not a boolean"
    p.write_bytes(b"[true]")
    assert absent(lake.completeness(run), "E-LAKE-MALFORMED").detail == "note is not an object"


def test_completeness_names():
    assert L.Completeness(kind="no-note").kind == "no-note"
    assert L.decide({"complete": False}).kind == "incomplete"
    assert L.decide({"complete": True}).kind == "complete"


def test_a_note_that_is_a_link_or_a_folder_or_unreadable(scratch, tmp_path):
    state, lake = scratch
    p = state / "collected/gruntus" / ID_FRESH / NOTE
    moved = tmp_path / "moved.json"
    os.rename(p, moved)
    os.symlink(moved, p)
    run = find(lake, ID_FRESH, "gruntus")
    absent(lake.completeness(run), "E-LAKE-NOT-A-FILE")
    p.unlink()
    p.mkdir()
    absent(lake.completeness(run), "E-LAKE-NOT-A-FILE")
    if is_root:
        return
    p.rmdir()
    p.write_bytes(b'{"complete":true}')
    p.chmod(0)
    assert absent(lake.completeness(run), "E-LAKE-UNREADABLE").detail == "permission denied"


@needs_non_root
def test_only_the_note_is_read_for_completeness(scratch):                                                 # TC-68
    state, lake = scratch
    run = find(lake, ID_FRESH, "gruntus")
    want = found(lake.completeness(run))
    directory = state / "collected/gruntus" / ID_FRESH
    for e in list(directory.iterdir()):
        if e.name == NOTE:
            continue
        if e.is_dir():
            shutil.rmtree(e)
        else:
            e.chmod(0)
    directory.chmod(0o311)          # the folder can be entered but not listed
    try:
        got = lake.completeness(run)
    finally:
        directory.chmod(DIR_MODE_WRITABLE)
    assert found(got) == want


# ------------------------------------------------------------------------------------------------------------- G. absence

def finalize_absent() -> L.Absent:
    return L.Absent(run="combinations/x", node="gruntus", item="record:finalize", code="E-LAKE-NOT-COLLECTED",
                    detail="no such file")


def test_the_canonical_text_of_an_absence():                                                              # TC-69
    assert finalize_absent().to_text() == (
        "run=combinations/x node=gruntus item=record:finalize code=E-LAKE-NOT-COLLECTED detail=no such file")
    reference = L.Absent(run="benchmarks/reference/p/s/r", node=None, item="run", code="E-LAKE-NO-RUN",
                         detail="no run with this id")
    assert reference.to_text() == "run=benchmarks/reference/p/s/r node=- item=run code=E-LAKE-NO-RUN detail=no run with this id"


def test_the_canonical_json_of_an_absence():                                                              # TC-70
    assert finalize_absent().to_json() == (
        '{"code":"E-LAKE-NOT-COLLECTED","detail":"no such file","item":"record:finalize","node":"gruntus",'
        '"run":"combinations/x"}')
    reference = L.Absent(run="r", node=None, item="log:2", code="E-LAKE-MALFORMED", detail="not valid gzip")
    assert reference.to_json() == (
        '{"code":"E-LAKE-MALFORMED","detail":"not valid gzip","item":"log:2","node":null,"run":"r"}')


def test_the_canonical_json_of_a_refusal():
    r = L.Refused(run="r", node="n", item="workspace:1", code="E-LAKE-DEST-NOT-EMPTY",
                  detail="destination is not empty", message="ignored")
    assert r.to_json() == ('{"code":"E-LAKE-DEST-NOT-EMPTY","detail":"destination is not empty","item":"workspace:1",'
                           '"node":"n","run":"r"}')


def test_the_message_is_not_part_of_the_canonical_form_or_of_equality():
    a = L.Absent(run="r", node=None, item="run", code="E-LAKE-NO-RUN", detail="no run with this id", message="os says no")
    b = L.Absent(run="r", node=None, item="run", code="E-LAKE-NO-RUN", detail="no run with this id")
    assert a.to_json() == b.to_json() and a == b


def test_every_code_is_produced_by_a_case_with_its_fixed_text(scratch, tmp_path):                        # TC-71
    codes = {
        L.CODE_NO_RUN: "E-LAKE-NO-RUN", L.CODE_NOT_COLLECTED: "E-LAKE-NOT-COLLECTED", L.CODE_NOT_A_FILE: "E-LAKE-NOT-A-FILE",
        L.CODE_UNREADABLE: "E-LAKE-UNREADABLE", L.CODE_MALFORMED: "E-LAKE-MALFORMED", L.CODE_BAD_NAME: "E-LAKE-BAD-NAME",
        L.CODE_DEST_INSIDE_ROOT: "E-LAKE-DEST-INSIDE-ROOT", L.CODE_DEST_NOT_EMPTY: "E-LAKE-DEST-NOT-EMPTY",
        L.CODE_GIT_FAILED: "E-LAKE-GIT-FAILED",
    }
    for constant, text in codes.items():
        assert constant == text
    state, lake = scratch
    d = lake.discover()
    fresh_dir = state / "collected/gruntus" / ID_FRESH
    q36_dir = state / "collected/gruntus" / ID_Q36
    fresh, q36, flash = find(lake, ID_FRESH, "gruntus"), find(lake, ID_Q36, "gruntus"), find(lake, ID_FLASH, "tritus")
    (fresh_dir / "metrics.json").write_bytes(b"{")
    os.rename(fresh_dir / "finalize.json", tmp_path / "moved.json")
    os.symlink(tmp_path / "moved.json", fresh_dir / "finalize.json")
    (q36_dir / BUNDLE).write_bytes(b"not a bundle" * 100)
    produced = {
        lake.preferred_or_absent(d, "combinations/none"): ("E-LAKE-NO-RUN", "no run with this id"),
        lake.bytes(flash, L.METRICS): ("E-LAKE-NOT-COLLECTED", "no such file"),
        lake.bytes(fresh, L.FINALIZE): ("E-LAKE-NOT-A-FILE", "not a regular file"),
        lake.value(fresh, L.METRICS): ("E-LAKE-MALFORMED", "not valid JSON"),
        lake.bytes(fresh, L.accept(1000)): ("E-LAKE-BAD-NAME", "story out of range"),
        lake.workspace(q36, 1, state / "collected" / "new"): ("E-LAKE-DEST-INSIDE-ROOT", "destination is inside the lake"),
        lake.workspace(q36, 1, state): ("E-LAKE-DEST-NOT-EMPTY", "destination is not empty"),
        lake.workspace(q36, 1, tmp_path / "w"): ("E-LAKE-GIT-FAILED", "git clone failed"),
    }
    if not is_root:
        (fresh_dir / "run-status.json").chmod(0)
        produced[lake.bytes(fresh, L.STATUS)] = ("E-LAKE-UNREADABLE", "permission denied")
    seen = set()
    for result, (code, detail) in produced.items():
        assert isinstance(result, (L.Absent, L.Refused)), (code, result)
        assert (result.code, result.detail) == (code, detail)
        seen.add(result.code)
    assert seen == set(codes.values()) - (set() if not is_root else {"E-LAKE-UNREADABLE"})
    assert len(codes) == 9, "six absences and three refusals"


def python_absent_cases(state: Path, tmp_path: Path):
    """Every kind of absence and refusal the library has, as (name, thunk)."""
    lake = L.Lake.in_state_dir(state)
    d = lake.discover()
    fresh = find(lake, ID_FRESH, "gruntus")
    q36 = find(lake, ID_Q36, "gruntus")
    flash = find(lake, ID_FLASH, "tritus")
    ghost = nowhere()
    broken_root = L.Lake(state / "collected" / "nothing", state / "reference" / "nothing")
    cases = [
        ("no run", lambda: lake.preferred_or_absent(d, "combinations/none")),
        ("find no run", lambda: lake.find_run(d, "nonode@" + ID_Q36)),
        ("not collected", lambda: lake.bytes(flash, L.METRICS)),
        ("value not collected", lambda: lake.value(flash, L.METRICS)),
        ("bad story", lambda: lake.bytes(fresh, L.accept(1000))),
        ("bad story huge", lambda: lake.bytes(fresh, L.accept(2 ** 70))),
        ("bad version", lambda: lake.bytes(fresh, L.rescore("../.."))),
        ("run folder missing", lambda: lake.bytes(ghost, L.METRICS)),
        ("run folder missing log", lambda: lake.log(ghost, 1)),
        ("log not collected", lambda: lake.log(fresh, 2)),
        ("log bad story", lambda: lake.log(fresh, -1)),
        ("no bundle", lambda: lake.workspace(flash, 1, tmp_path / "w1")),
        ("bundle run missing", lambda: lake.workspace(ghost, 1, tmp_path / "w2")),
        ("inside root", lambda: lake.workspace(q36, 1, state / "collected" / "new")),
        ("not empty", lambda: lake.workspace(q36, 1, state)),
        ("compare nothing", lambda: L.compare_git(broken_root, tmp_path / "no-repo")),
    ]
    return cases


def test_python_does_not_raise_for_any_absence_or_refusal(scratch, tmp_path):                            # TC-76
    state, _ = scratch
    for name, thunk in python_absent_cases(state, tmp_path):
        result = thunk()                                  # an exception here fails the test: that is the point
        assert isinstance(result, (L.Absent, L.Refused, str)), (name, result)
    ghost = nowhere()
    lake = L.Lake.in_state_dir(state)
    assert lake.completeness(ghost) == L.Found(L.Completeness(kind="no-note")), "no note is an answer, not an absence"
    assert lake.rescore_versions(ghost) == L.Found([]), "no rescore folder is an empty list"


def test_python_does_not_raise_on_damaged_unreadable_and_odd_inputs(scratch, tmp_path):                  # TC-76
    state, lake = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    run = find(lake, ID_FRESH, "gruntus")
    (run_dir / "metrics.json").write_bytes(b"\xff\xfe{")
    (run_dir / "run-status.json").write_bytes(b"[" * 5000)           # nested far deeper than any parser can take
    (run_dir / "stories/01/accept-summary.json").write_bytes(b"1" * 5000)
    (run_dir / "stories/01/prompt.md").write_bytes(b"\xff")
    (run_dir / "stories/01" / COMPACT_LOG).write_bytes(b"\x1f\x8b\x08\x00garbage")
    (run_dir / NOTE).write_bytes(b"{")
    for record in [L.METRICS, L.STATUS, L.accept(1), L.prompt(1), L.COLLECTION, L.rescore("x" * 100)]:
        assert isinstance(lake.value(run, record), (L.Found, L.Absent)), record
        assert isinstance(lake.bytes(run, record), (L.Found, L.Absent)), record
    assert isinstance(lake.completeness(run), L.Absent)
    log = found(lake.log(run, 1))
    for item in log.lines():
        assert isinstance(item, (L.Found, L.Absent))
    assert isinstance(lake.workspace(run, 1, "relative/destination/for/the/test"), L.Absent), "no bundle: nothing is made"
    assert isinstance(lake.workspace(run, 1, "bad\0path"), (L.Absent, L.Refused))
    for root in [state / "collected" / "gruntus" / "combinations" / "qwen" / "3.8-swift-1.5" / "27b" / "ubuntu"]:
        assert isinstance(L.Lake(root, root).discover(), L.Discovery)
    # a root that is a file, not a folder
    afile = tmp_path / "afile"
    afile.write_bytes(b"x")
    d = L.Lake(afile, afile).discover()
    assert [r.code for r in d.rejected] == ["E-LAKE-UNREADABLE", "E-LAKE-UNREADABLE"]


# ------------------------------------------------------------------------------------------------------------- H. read-only

def ask_everything(lake: L.Lake) -> list[str]:
    """Every question of the library over every run, rendered to text so two sequences can be compared."""
    out = []
    d = lake.discover()
    out.append(repr(d))
    for run in d.runs:
        out.append(f"copies {len(lake.copies(d, run.id))}")
        out.append(f"preferred {lake.preferred(d, run.id)}")
        out.append(f"completeness {lake.completeness(run)}")
        out.append(f"versions {lake.rescore_versions(run)}")
        for r in SIX:
            b = lake.bytes(run, r)
            out.append(f"{r} {L.sha256_hex(b.value) if isinstance(b, L.Found) else b}")
            v = lake.value(run, r)
            out.append(f"{r} {L.canonical(v.value) if isinstance(v, L.Found) else v}")
        for s in SOME_STORIES:
            for r in [L.accept(s), L.prompt(s), L.base_commit(s), L.gate(s)]:
                b = lake.bytes(run, r)
                out.append(f"{r} {L.sha256_hex(b.value) if isinstance(b, L.Found) else b}")
            lg = lake.log(run, s)
            if isinstance(lg, L.Found):
                out.append(f"log {s} {lg.value.form} {lg.value.digest()}")
            else:
                out.append(f"log {s} {lg.to_text()}")
    return out


def test_the_lake_is_unchanged_after_every_call(scratch, tmp_path):                                       # TC-77
    state, lake = scratch
    before = snapshot(state)
    answers = ask_everything(lake)
    assert len(answers) > 100
    run = find(lake, ID_Q36, "gruntus")
    found(lake.workspace(run, 1, tmp_path / "w"))
    lake.workspace(run, 1, state / "collected/x")
    assert snapshot(state) == before


@needs_non_root
def test_a_read_only_lake_answers_as_before(scratch):                                                     # TC-78
    state, lake = scratch
    want = ask_everything(lake)
    set_modes(state, DIR_MODE_READONLY, FILE_MODE_READONLY)
    try:
        got = ask_everything(lake)
    finally:
        set_modes(state, DIR_MODE_WRITABLE, FILE_MODE_WRITABLE)
    assert got == want


def write_calls(tree: ast.AST) -> set[tuple[str, str]]:
    """Every (enclosing function, call) in the module that could write, move or remove a file."""
    os_names = {"remove", "unlink", "rename", "replace", "rmdir", "removedirs", "mkdir", "makedirs", "symlink", "link",
                "truncate", "chmod", "chown", "utime", "write", "mkfifo", "mknod", "system", "popen", "fdopen"}
    path_methods = {"write_text", "write_bytes", "touch", "symlink_to", "hardlink_to", "mkdir", "unlink", "rmdir", "rename",
                    "chmod"}
    write_modes = "wax+"
    found_calls: set[tuple[str, str]] = set()

    def dotted(node: ast.AST) -> str:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return f"{dotted(node.value)}.{node.attr}"
        return "?"

    def visit(node: ast.AST, function: str) -> None:
        for child in ast.iter_child_nodes(node):
            name = function
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = child.name
            if isinstance(child, ast.Call):
                callee = dotted(child.func)
                last = callee.rsplit(".", 1)[-1]
                if last == "open":
                    mode_nodes = list(child.args[1:2]) + [k.value for k in child.keywords if k.arg == "mode"]
                    modes = [m.value for m in mode_nodes if isinstance(m, ast.Constant) and isinstance(m.value, str)]
                    unseen = any(not isinstance(m, ast.Constant) for m in mode_nodes)
                    if callee == "os.open" or unseen or any(c in mode for mode in modes for c in write_modes):
                        found_calls.add((function, callee))
                elif callee.startswith("os.") and last in os_names:
                    found_calls.add((function, callee))
                elif callee.startswith(("shutil.", "tempfile.")):
                    found_calls.add((function, callee))
                elif "." in callee and last in path_methods:
                    found_calls.add((function, callee))
            visit(child, name)

    visit(tree, "<module>")
    return found_calls


def test_the_module_makes_no_writes_except_the_workspace_cleanup_and_the_report():                        # TC-82
    # The only places that remove or write: removing what a failed working copy made in its own destination (the one
    # folder the library writes into, outside both roots), and writing the report to the path the caller named.
    assert write_calls(ast.parse(MODULE.read_text())) == {
        ("_clean_up", "shutil.rmtree"), ("_clean_up", "os.remove"), ("_write_report", "open")}


def test_the_write_scan_catches_a_write_it_is_meant_to_catch():                                           # TC-82
    bad = ast.parse("import os, shutil\n"
                    "def f(p):\n open(p, 'wb')\n os.rename(p, p)\n shutil.rmtree(p)\n p.write_text('x')\n"
                    "def g(p, m):\n open(p, m)\n open(p)\n open(p, 'rb')\n")
    calls = write_calls(bad)
    assert ("f", "open") in calls and ("f", "os.rename") in calls and ("f", "shutil.rmtree") in calls
    assert ("f", "p.write_text") in calls and ("g", "open") in calls
    assert len([c for c in calls if c[0] == "g"]) == 1, "a read-mode open is not a write; a mode no one can see is"


def test_every_open_in_the_module_is_for_reading_except_the_report():
    tree = ast.parse(MODULE.read_text())
    modes = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "open":
            mode = node.args[1].value if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) else "r"
            modes.append(mode)
    assert modes and all(not any(c in m for c in "wax+") for m in modes if m != "w"), modes
    assert modes.count("w") <= 1, "one write-mode open at most: the report"


# ----------------------------------------------------------------------------------------------- I. canonical JSON and parsing

def test_canonical_json_sorts_keys_and_drops_whitespace():
    assert L.canonical({"b": 1, "a": [2, {"d": 1, "c": 2}], "é": 0, "z": None}) == '{"a":[2,{"c":2,"d":1}],"b":1,"z":null,"é":0}'


def test_canonical_json_sorts_keys_by_their_utf8_bytes():
    assert L.canonical({"\U0001F600": 1, "\uffff": 2, "z": 3, "Z": 4}) == '{"Z":4,"z":3,"\uffff":2,"\U0001F600":1}'


def test_canonical_json_strings():
    text = 'q"\\\b\t\n\f\r\x01\x1f\x7fé€😀'
    assert L.canonical(text) == '"q\\"\\\\\\b\\t\\n\\f\\r\\u0001\\u001f\x7fé€😀"'


def test_canonical_json_scalars():
    assert L.canonical([True, False, None, 0, -5, 10 ** 15]) == "[true,false,null,0,-5,1000000000000000]"


CANONICAL_NUMBERS = [
    ("1", "1"), ("-5", "-5"), ("1.0", "1.0"), ("1.5", "1.5"), ("1e2", "100.0"), ("0.00001", "0.00001"),
    ("0.000001", "1e-6"), ("1.5e-7", "1.5e-7"), ("1e15", "1000000000000000.0"), ("1e16", "1e+16"),
    ("1.5e16", "1.5e+16"), ("-0", "-0.0"), ("18446744073709551615", "18446744073709551615"),
    ("18446744073709551616", "1.8446744073709552e+19"), ("-9223372036854775808", "-9223372036854775808"),
    ("1791009358.777", "1791009358.777"), ("0.0", "0.0"), ("-0.0", "-0.0"), ("0.1", "0.1"),
    ("123456789012345.6", "123456789012345.6"), ("9999999999999998", "9999999999999998"),
    ("9999999999999999", "9999999999999999"), ("1e-5", "0.00001"), ("9.9e-6", "9.9e-6"), ("2.5E+3", "2500.0"),
    ("1e300", "1e+300"), ("1e-300", "1e-300"), ("5e-324", "5e-324"), ("1.7976931348623157e308", "1.7976931348623157e+308"),
    ("-1e16", "-1e+16"), ("-12345678901234567890", "-1.2345678901234567e+19"), ("1e-400", "0.0"), ("100e-2", "1.0"),
]


@pytest.mark.parametrize("token,want", CANONICAL_NUMBERS)
def test_canonical_json_numbers(token, want):
    parsed = found(L.parse_json(token.encode()))
    assert L.canonical(parsed) == want


def test_a_float_that_is_not_json_cannot_be_printed_or_read():
    for token in ["NaN", "Infinity", "-Infinity", "1e400", "-1e400"]:
        assert isinstance(L.parse_json(token.encode()), L.ParseError), token


STRICT_REJECTS = [
    b"", b"  ", b"{", b"[1,2,]", b'{"a":1,}', b"// c\n1", b"/* c */ 1", b"1 2", b"{} x", b"'a'", b"[01]", b"[1.]", b"[.5]",
    b"[+1]", b"[1e]", b"[-]", b"\xef\xbb\xbf{}", b'"\x01"', b'"\\x"', b'"\\ud800"', b'"\\udc00x"', b'"\\ud83dx"',
    b'"\\ud83d\\u0041"', b"[NaN]", b"[Infinity]", b"tru", b"nul", b'{"a" 1}', b'{1:2}', b"[1 2]", b'"abc',
    b'"\xff"', b'"\xc0\x80"', b'"\xed\xa0\x80"', b"\x00", b"{}\x00",
]
STRICT_ACCEPTS = [
    b"{}", b"[]", b"null", b"true", b'"x"', b"0", b" \t\r\n{} \t\r\n", b'{"a":1,"a":2}', b'"\\ud83d\\ude00"', b'"\\u0000"',
    b'"\xf0\x9f\x98\x80"', b'"\xe2\x80\xa8"', b'"\\/"', b"-0", b"0e0", b"[1E2]", b"{\"\":1}",
]


@pytest.mark.parametrize("doc", STRICT_REJECTS)
def test_the_strict_reader_rejects(doc):
    r = L.parse_json(doc)
    assert isinstance(r, L.ParseError), doc
    assert r.detail in {"not valid JSON", "not valid UTF-8"}


@pytest.mark.parametrize("doc", STRICT_ACCEPTS)
def test_the_strict_reader_accepts(doc):
    assert isinstance(L.parse_json(doc), L.Found), doc


def test_the_strict_reader_says_which_way_the_document_is_invalid():
    assert L.parse_json(b'{"a":"\xff"}').detail == "not valid UTF-8"
    assert L.parse_json(b'{"a":').detail == "not valid JSON"
    assert L.parse_json(b'{"a":').message


def test_a_duplicate_key_keeps_the_last_value():
    assert found(L.parse_json(b'{"a":1,"b":0,"a":2}')) == {"a": 2, "b": 0}


def test_the_nesting_limit_is_the_rust_readers():
    ok = b"[" * MAX_DEPTH_JSON + b"]" * MAX_DEPTH_JSON
    too_deep = b"[" * (MAX_DEPTH_JSON + 1) + b"]" * (MAX_DEPTH_JSON + 1)
    assert isinstance(L.parse_json(ok), L.Found)
    assert isinstance(L.parse_json(too_deep), L.ParseError)
    assert isinstance(L.parse_json(b"[" * 100000), L.ParseError)
    quoted = b'["' + b"[" * 500 + b'"]'
    assert isinstance(L.parse_json(quoted), L.Found), "brackets inside a string are not nesting"
    escaped = b'["\\"' + b"[" * 500 + b'"]'
    assert isinstance(L.parse_json(escaped), L.Found), "an escaped quote does not end the string"


def test_sha256_hex_is_lower_case_hex():
    assert L.sha256_hex(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


# ---------------------------------------------------------------------------------------------------------------- J. command

def test_the_command_answers_runs_in_the_canonical_form():                                                # TC-85, TC-91
    code, out, err = py_ask(FIXTURE, ["runs"])
    assert code == L.EXIT_OK and err == b""
    assert out.endswith(b"}\n") and out.count(b"\n") == 1
    v = json.loads(out)
    assert v["status"] == "found" and len(v["runs"]) == FIXTURE_RUN_COUNT
    assert v["missing_roots"] == [] and v["rejected"] == []
    assert out.decode().rstrip("\n") == L.canonical(v), "the output is its own canonical form"
    assert v["runs"][0]["dir"] == "reference/todoodle/opus-5.5/run-1" and v["runs"][0]["node"] is None


def test_the_python_command_line_prints_the_same_as_the_in_process_run():                                 # TC-91
    p = py_process([str(FIXTURE), "runs"])
    assert p.returncode == 0 and p.stderr == b""
    assert p.stdout == py_ask(FIXTURE, ["runs"])[1]


def test_the_two_root_form_equals_the_state_dir_form():
    two = io.BytesIO()
    L.run(["--roots", str(FIXTURE / "collected"), str(FIXTURE / "reference"), "runs"], two, io.BytesIO())
    assert two.getvalue() == py_ask(FIXTURE, ["runs"])[1]
    code, out, _ = py_ask(FIXTURE / "nothing", ["runs"])
    v = json.loads(out)
    assert code == 0 and v["missing_roots"] == ["collected", "reference"] and v["runs"] == []


def test_copies_and_preferred_as_commands():
    v = json.loads(py_ask(FIXTURE, ["copies", ID_Q36])[1])
    assert [c["node"] for c in v["copies"]] == ["gruntus", "quintus", "tritus"]
    assert json.loads(py_ask(FIXTURE, ["copies", "combinations/none"])[1])["copies"] == []
    assert json.loads(py_ask(FIXTURE, ["preferred", ID_Q36])[1])["preferred"]["node"] == "gruntus"
    code, out, _ = py_ask(FIXTURE, ["preferred", "combinations/none"])
    assert code == 0 and json.loads(out)["absent"]["code"] == "E-LAKE-NO-RUN"


def test_the_payload_form_of_a_record_and_a_log():                                                        # TC-86
    v = json.loads(py_ask(FIXTURE, ["record", ID_FRESH, "status"])[1])
    data = (FIXTURE / "collected/gruntus" / ID_FRESH / "run-status.json").read_bytes()
    assert v["length"] == len(data) and v["sha256"] == L.sha256_hex(data) and v["value"] == json.loads(data)
    assert (v["status"], v["node"], v["run"]) == ("found", "gruntus", ID_FRESH)
    t = json.loads(py_ask(FIXTURE, ["record", ID_FRESH, "base-commit", "1"])[1])
    assert t["value"] == FRESH_BASE_COMMIT and t["length"] == 40
    lg = json.loads(py_ask(FIXTURE, ["log", ID_FRESH, "1"])[1])
    raw = (FIXTURE / "collected/gruntus" / ID_FRESH / "stories/01" / RAW_LOG).read_bytes()
    assert (lg["form"], lg["lines"], lg["length"]) == ("raw", 20, len(raw))
    assert lg["sha256"] == L.sha256_hex(raw) and "value" not in lg and lg["story"] == 1
    assert py_ask(FIXTURE, ["log", ID_FRESH, "01"])[1] == py_ask(FIXTURE, ["log", ID_FRESH, "1"])[1]


def test_the_node_at_id_form_picks_a_copy():
    assert json.loads(py_ask(FIXTURE, ["record", f"quintus@{ID_Q36}", "status"])[1])["node"] == "quintus"
    a = json.loads(py_ask(FIXTURE, ["record", f"quintus@{ID_Q36}", "finalize"])[1])
    assert (a["absent"]["code"], a["absent"]["node"]) == ("E-LAKE-NOT-COLLECTED", "quintus")
    n = json.loads(py_ask(FIXTURE, ["record", f"nonode@{ID_Q36}", "status"])[1])
    assert (n["absent"]["code"], n["absent"]["node"]) == ("E-LAKE-NO-RUN", "nonode")


MALFORMED_QUESTIONS = [
    ["frobnicate"], [], ["runs", "extra"], ["copies"], ["preferred"], ["record"], ["record", ID_FRESH],
    ["record", ID_FRESH, "nonesuch"], ["record", ID_FRESH, "accept", "notanumber"], ["record", ID_FRESH, "accept"],
    ["log", ID_FRESH], ["log", ID_FRESH, "x1"], ["workspace", ID_FRESH, "1"], ["complete"],
]


def test_a_malformed_question_is_exit_2_with_one_line_on_stderr():                                        # TC-87, TC-96
    for args in MALFORMED_QUESTIONS:
        code, out, err = py_ask(FIXTURE, args)
        assert code == L.EXIT_QUESTION, args
        assert out == b"", (args, out)
        assert err.startswith(b"bench-lake: ") and err.rstrip(b"\n").count(b"\n") == 0, (args, err)
    out, err = io.BytesIO(), io.BytesIO()
    assert L.run([], out, err) == L.EXIT_QUESTION and out.getvalue() == b""
    assert L.run(["--roots", str(FIXTURE)], out, err) == L.EXIT_QUESTION and out.getvalue() == b""


def test_the_python_process_exits_2_for_a_malformed_question_and_0_for_an_absent_record():                # TC-96
    bad = py_process([str(FIXTURE), "frobnicate"])
    assert bad.returncode == 2 and bad.stdout == b"" and bad.stderr.startswith(b"bench-lake: ")
    gone = py_process([str(FIXTURE), "record", ID_DRY, "metrics"])
    assert gone.returncode == 0 and json.loads(gone.stdout)["absent"]["code"] == "E-LAKE-NOT-COLLECTED"


def test_an_absence_is_an_answer_on_stdout_with_exit_0():                                                 # TC-88
    code, out, err = py_ask(FIXTURE, ["record", ID_DRY, "metrics"])
    assert code == 0 and err == b""
    v = json.loads(out)
    assert (v["status"], v["absent"]["code"], v["absent"]["item"], v["absent"]["run"]) == (
        "absent", "E-LAKE-NOT-COLLECTED", "record:metrics", ID_DRY)
    assert out.decode().rstrip("\n") == L.canonical(v)
    for args, want in [
        (["record", ID_FRESH, "accept", "1000"], "E-LAKE-BAD-NAME"), (["record", ID_FRESH, "rescore", ".."], "E-LAKE-BAD-NAME"),
        (["record", ID_FRESH, "rescore", ""], "E-LAKE-BAD-NAME"), (["log", ID_FRESH, "2"], "E-LAKE-NOT-COLLECTED"),
        (["log", ID_FRESH, "-1"], "E-LAKE-BAD-NAME"), (["complete", "combinations/none"], "E-LAKE-NO-RUN"),
    ]:
        code, out, _ = py_ask(FIXTURE, args)
        assert code == 0 and json.loads(out)["absent"]["code"] == want, args


def test_a_big_story_number_is_a_bad_name_with_the_clamped_number_in_the_item():
    v = json.loads(py_ask(FIXTURE, ["record", ID_FRESH, "accept", "99999999999999999999"])[1])
    assert v["absent"]["code"] == "E-LAKE-BAD-NAME" and v["absent"]["item"] == "record:accept:9223372036854775807"
    v = json.loads(py_ask(FIXTURE, ["log", ID_FRESH, "-99999999999999999999"])[1])
    assert v["absent"]["item"] == "log:-9223372036854775808"


def test_a_damaged_record_and_a_damaged_log_are_absences_not_crashes(scratch):
    state, _ = scratch
    run_dir = state / "collected/gruntus" / ID_Q36
    whole = (run_dir / "stories/01" / COMPACT_LOG).read_bytes()
    (run_dir / "stories/01" / COMPACT_LOG).write_bytes(whole[: len(whole) // 2])
    (run_dir / "run-status.json").write_bytes(b'{"cut":')
    code, out, _ = py_ask(state, ["log", ID_Q36, "1"])
    assert code == 0 and json.loads(out)["absent"]["detail"] == "not valid gzip"
    assert json.loads(py_ask(state, ["record", ID_Q36, "status"])[1])["absent"]["detail"] == "not valid JSON"
    assert py_ask(state, ["complete", ID_Q36])[0] == 0


def test_the_complete_command():
    v = json.loads(py_ask(FIXTURE, ["complete", ID_FRESH])[1])
    assert (v["completeness"], v["state"], v["settled_at"], v["collected_at"]) == ("complete", "finished", 1792116937, 1792160967)
    v = json.loads(py_ask(FIXTURE, ["complete", ID_TODOODLE])[1])
    assert v["completeness"] == "no-note" and v["settled_at"] is None and v["state"] is None and v["collected_at"] is None


def test_the_workspace_command_success_refusal_and_absence(tmp_path):
    dest = tmp_path / "w"
    code, out, err = py_ask(FIXTURE, ["workspace", ID_Q36, "1", str(dest)])
    assert code == 0, err
    v = json.loads(out)
    assert (v["commit"], v["path"], v["story"]) == (REAL_COMMIT_1, str(dest), 1)
    assert git_in(dest, "rev-parse", "HEAD") == v["commit"]
    code, out, _ = py_ask(FIXTURE, ["workspace", ID_Q36, "1", str(dest)])
    v = json.loads(out)
    assert code == 2 and v["status"] == "refused" and v["refused"]["code"] == "E-LAKE-DEST-NOT-EMPTY"
    assert v["refused"]["item"] == "workspace:1"
    code, out, _ = py_ask(FIXTURE, ["workspace", ID_FLASH, "1", str(tmp_path / "w2")])
    assert code == 0 and json.loads(out)["absent"]["item"] == "bundle"


def test_compare_git_as_a_command_reports_not_run_with_exit_3_and_no_report(tmp_path):                    # TC-106
    report = tmp_path / "out" / "report.json"
    out, err = io.BytesIO(), io.BytesIO()
    code = L.run([str(FIXTURE), "compare-git", str(tmp_path / "no-repo"), "--report", str(report)], out, err)
    assert code == L.EXIT_NOT_RUN and out.getvalue() == b""
    assert err.getvalue().startswith(b"bench-lake: not run: ") and not report.exists()


def test_compare_git_as_a_command_on_the_real_repository_writes_the_report_and_prints_it(tmp_path):
    if not (GIT_REPO / ".git").exists():
        pytest.skip("no repository next to the crate")
    report = tmp_path / "out" / "report.json"
    report.parent.mkdir()
    out, err = io.BytesIO(), io.BytesIO()
    code = L.run([str(FIXTURE), "compare-git", str(GIT_REPO), "--rev", "HEAD", "--report", str(report)], out, err)
    assert code == L.EXIT_OK, err.getvalue()
    value = json.loads(report.read_bytes())
    assert value["defects"] == []
    assert json.loads(out.getvalue()) == value, "the report is also printed"
    assert report.read_bytes() == out.getvalue(), "and is the same bytes"


def test_compare_git_with_a_report_that_cannot_be_written_is_not_run(tmp_path):
    if not (GIT_REPO / ".git").exists():
        pytest.skip("no repository next to the crate")
    out, err = io.BytesIO(), io.BytesIO()
    code = L.run([str(FIXTURE), "compare-git", str(GIT_REPO), "--rev", "HEAD", "--report", str(tmp_path / "no/such/dir/r.json")],
                 out, err)
    assert code == L.EXIT_NOT_RUN and out.getvalue() == b"" and b"the report could not be written" in err.getvalue()


def test_compare_git_arguments():
    for words in [[], ["a", "b"], ["--rev"], ["x", "--report"]]:
        out, err = io.BytesIO(), io.BytesIO()
        assert L.run([str(FIXTURE), "compare-git", *words], out, err) == L.EXIT_QUESTION, words
        assert out.getvalue() == b"" and err.getvalue().startswith(b"bench-lake: ")


# ----------------------------------------------------------------------------- the golden answers and the two languages (TC-92, TC-107)

def load_golden() -> list[dict]:
    return json.loads(GOLDEN.read_text())["questions"]


def build_questions(runs_answer: dict) -> list[list[str]]:
    """Every question over every fixture run: the list the golden file holds (the design's TC-107)."""
    runs = runs_answer["runs"]
    questions: list[list[str]] = [["runs"]]
    ids = sorted({r["id"] for r in runs})
    for run_id in ids:
        questions += [["copies", run_id], ["preferred", run_id], ["complete", run_id], ["record", run_id, "status"]]
    questions += [["copies", "combinations/none"], ["preferred", "combinations/none"], ["complete", "combinations/none"],
                  ["record", "nonode@" + ID_Q36, "status"], ["record", "combinations/none", "status"],
                  ["workspace", ID_Q36, "1", PLACEHOLDER_NONEMPTY]]
    for r in runs:
        spec = r["id"] if r["node"] is None else f"{r['node']}@{r['id']}"
        for name in PLAIN_NAMES:
            questions.append(["record", spec, name])
        for name in STORY_NAMES:
            for story in GOLDEN_STORIES:
                questions.append(["record", spec, name, str(story)])
        for version in ["v1", "..", ""]:
            questions.append(["record", spec, "rescore", version])
        for version, story in [("v1", 1), ("a/b", 1), ("v1", 1000)]:
            questions.append(["record", spec, "rescore-accept", version, str(story)])
        for story in GOLDEN_LOG_STORIES:
            questions.append(["log", spec, str(story)])
        for story in GOLDEN_WORKSPACE_STORIES:
            questions.append(["workspace", spec, str(story), PLACEHOLDER_DEST])
        questions.append(["complete", spec])
    return questions


def answer_golden_question(ask, state: Path, workdir: Path, args: list[str], counter: int) -> tuple[int, str]:
    """Runs one golden question through `ask(state, args) -> (exit, stdout bytes)`; destinations are made fresh."""
    real = []
    dest = workdir / f"dest-{counter}"
    nonempty = workdir / f"nonempty-{counter}"
    for a in args:
        if a == PLACEHOLDER_DEST:
            real.append(str(dest))
        elif a == PLACEHOLDER_NONEMPTY:
            write(nonempty / "keep", b"x")
            real.append(str(nonempty))
        else:
            real.append(a)
    code, out = ask(state, real)
    text = out.decode("utf-8")
    return code, text.replace(str(dest), PLACEHOLDER_DEST).replace(str(nonempty), PLACEHOLDER_NONEMPTY)


def regenerate_golden(binary: Path) -> int:
    runs = json.loads(subprocess.run([str(binary), str(FIXTURE), "runs"], capture_output=True, check=True).stdout)
    entries = []
    import tempfile
    with tempfile.TemporaryDirectory() as work:
        for i, args in enumerate(build_questions(runs)):
            def ask(state, real):
                p = subprocess.run([str(binary), str(state), *real], capture_output=True)
                return p.returncode, p.stdout
            code, text = answer_golden_question(ask, FIXTURE, Path(work), args, i)
            entries.append({"args": args, "exit": code, "stdout": text})
    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join(json.dumps(e, ensure_ascii=False, sort_keys=True) for e in entries)
    GOLDEN.write_text('{"questions":[\n' + body + "\n]}\n", encoding="utf-8")
    return len(entries)


def test_the_golden_file_holds_every_question_over_every_fixture_run():                                    # TC-92, TC-107
    entries = load_golden()
    runs = json.loads(py_ask(FIXTURE, ["runs"])[1])
    assert [e["args"] for e in entries] == build_questions(runs)
    assert len(entries) > 300
    codes = {e["exit"] for e in entries}
    assert codes == {0, 2}, "answers, absences and one refusal"
    kinds = {json.loads(e["stdout"])["status"] for e in entries}
    assert kinds == {"found", "absent", "refused"}


def test_python_answers_every_golden_question_with_the_golden_bytes(tmp_path):                            # TC-107
    def ask(state, args):
        code, out, err = py_ask(state, args)
        assert err == b"", (args, err)
        return code, out

    for i, entry in enumerate(load_golden()):
        code, text = answer_golden_question(ask, FIXTURE, tmp_path, entry["args"], i)
        assert (code, text) == (entry["exit"], entry["stdout"]), entry["args"]


def test_the_rust_command_answers_every_golden_question_with_the_golden_bytes(rust_binary, tmp_path):     # TC-107
    def ask(state, args):
        code, out, err = rust_ask(rust_binary, state, args)
        assert err == b"", (args, err)
        return code, out

    for i, entry in enumerate(load_golden()):
        code, text = answer_golden_question(ask, FIXTURE, tmp_path, entry["args"], i)
        assert (code, text) == (entry["exit"], entry["stdout"]), entry["args"]


def test_the_two_commands_print_the_same_bytes_as_processes(rust_binary):                                 # TC-91, TC-92
    for args in [["runs"], ["copies", ID_Q36], ["preferred", ID_Q36], ["record", ID_FRESH, "metrics"],
                 ["record", ID_FRESH, "accept", "1"], ["log", ID_Q36, "1"], ["complete", ID_DRY],
                 ["record", ID_FRESH, "accept", "1000"], ["frobnicate"], ["record", ID_FRESH, "accept", "x"]]:
        r_code, r_out, r_err = rust_ask(rust_binary, FIXTURE, args)
        p = py_process([str(FIXTURE), *args])
        assert (p.returncode, p.stdout) == (r_code, r_out), args
        assert p.stderr.startswith(b"bench-lake: ") == r_err.startswith(b"bench-lake: "), args


JSON_AGREEMENT_DOCUMENTS = [
    b"{}", b"[]", b"null", b"0", b"-0", b"-0.0", b'"x"', b'{"b":1.0,"a":[1e3,12345678901234567890,1.5E-10]}',
    b'"\\u0000\\u001f\\u007f\\u2028"', b'"\\ud83d\\ude00"', b'"\\ud800"', b'"\\udc00x"', b'{"a":1,"a":2}', b"1E400", b"1e-400",
    b"0.1e1", b"1e16", b"9999999999999999", b"18446744073709551616", b"-9223372036854775809", b"123456789.123456789e-20",
    b"[1,2,]", b'{"a":1,}', b"\xef\xbb\xbf{}", b'"\xff"', b"// c\n1", b"NaN", b"[01]", b"{} x", b" \r\n[ 1 , 2 ]\t\n",
    b'{"\xc3\xa9":1,"\xf0\x9f\x98\x80":2,"\xef\xbf\xbf":3}', b'"\xed\xa0\x80"', b'"\\u00e9\xc3\xa9"',
    b"[" * MAX_DEPTH_JSON + b"]" * MAX_DEPTH_JSON, b"[" * (MAX_DEPTH_JSON + 1) + b"]" * (MAX_DEPTH_JSON + 1),
    b'{"a":' * 60 + b"1" + b"}" * 60, b"1" * 400, b"0." + b"1" * 400, b'"\\/\\b\\f\\n\\r\\t\\"\\\\"', b"\t",
    b"4.9406564584124654e-324", b"2.2250738585072014e-308", b"0.30000000000000004", b"100000000000000000000.0",
]


def test_the_two_languages_read_every_edge_case_document_the_same_way(rust_binary, scratch):               # TC-92
    state, _ = scratch
    gate = state / "collected/gruntus" / ID_FRESH / "stories/01/gate.json"
    for doc in JSON_AGREEMENT_DOCUMENTS:
        gate.write_bytes(doc)
        args = ["record", ID_FRESH, "gate", "1"]
        r_code, r_out, _ = rust_ask(rust_binary, state, args)
        p_code, p_out, _ = py_ask(state, args)
        assert (p_code, p_out) == (r_code, r_out), doc[:80]


def gz_member(data: bytes) -> bytes:
    return gzip.compress(data)


def with_flipped_crc(data: bytes) -> bytes:
    member = bytearray(gzip.compress(data))
    member[-8] ^= 0xFF
    return bytes(member)


def with_flipped_size(data: bytes) -> bytes:
    member = bytearray(gzip.compress(data))
    member[-1] ^= 0xFF
    return bytes(member)


GZ_BODY = b'{"a":1}\n{"b":2}\n{"c":3}\n' * 50


GZIP_AGREEMENT_FILES = {
    "one member": gz_member(GZ_BODY),
    "two members": gz_member(GZ_BODY) + gz_member(b"tail\n"),
    "empty member": gz_member(b""),
    "empty file": b"",
    "trailing garbage": gz_member(GZ_BODY) + b"garbage",
    "trailing zeros": gz_member(GZ_BODY) + b"\x00" * 8,
    "trailing one zero byte": gz_member(GZ_BODY) + b"\x00",
    "truncated header": gz_member(GZ_BODY)[:5],
    "truncated body": gz_member(GZ_BODY)[:40],
    "truncated trailer": gz_member(GZ_BODY)[:-4],
    "bad crc": with_flipped_crc(GZ_BODY),
    "bad size": with_flipped_size(GZ_BODY),
    "magic only": b"\x1f\x8b",
    "text": b"plain text\n",
    "stored blocks": gzip.compress(GZ_BODY, compresslevel=0),
    "second member truncated": gz_member(GZ_BODY) + gz_member(b"tail\n")[:12],
    "second member garbage": gz_member(GZ_BODY) + b"\x1f\x8b\x08\x00 not a member",
    "no final newline": gz_member(b"a\nb"),
}


@pytest.mark.parametrize("name", sorted(GZIP_AGREEMENT_FILES))
def test_the_two_languages_read_every_edge_case_gzip_file_the_same_way(rust_binary, scratch, name):       # TC-92
    state, _ = scratch
    directory = state / "collected/gruntus" / ID_Q36 / "stories/01"
    (directory / COMPACT_LOG).write_bytes(GZIP_AGREEMENT_FILES[name])
    args = ["log", ID_Q36, "1"]
    r_code, r_out, _ = rust_ask(rust_binary, state, args)
    p_code, p_out, _ = py_ask(state, args)
    assert (p_code, p_out) == (r_code, r_out), name


def test_the_two_languages_agree_on_a_lake_with_odd_entries(rust_binary, scratch, tmp_path):             # TC-92
    state, _ = scratch
    (state / "collected/tritus/benchmarks").mkdir()
    write(state / "collected/zz-file", b"x")
    os.symlink(state / "collected/gruntus", state / "collected/zz-link")
    (state / "collected/bad node").mkdir()
    (state / "collected/tritus/combinations/a/b/c").mkdir(parents=True)
    make_run(state, "collected/tritus/combinations/a/b/c/d/e/f-g/notbenchmarks/p/r")
    make_run(state, "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/" + "y" * 65)
    (state / "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r").mkdir()
    (state / "reference/pack").mkdir(parents=True)
    write(state / "reference/zz.txt", b"x")
    (state / "collected/qq/stray").mkdir(parents=True)
    write(state / "collected/qq-file", b"x")
    code_r, out_r, _ = rust_ask(rust_binary, state, ["runs"])
    code_p, out_p, _ = py_ask(state, ["runs"])
    assert (code_p, out_p) == (code_r, out_r)
    assert len(json.loads(out_p)["rejected"]) >= 10
    for root_args in [[str(state / "collected"), str(state / "nothing")], [str(state / "nothing"), str(state / "reference")]]:
        r = subprocess.run([str(rust_binary), "--roots", *root_args, "runs"], capture_output=True)
        out = io.BytesIO()
        L.run(["--roots", *root_args, "runs"], out, io.BytesIO())
        assert out.getvalue() == r.stdout


def test_the_two_languages_agree_on_empty_ids_and_odd_run_specs(rust_binary):                            # TC-92
    for args in [["copies", ""], ["preferred", ""], ["record", "", "status"], ["record", "@x", "status"],
                 ["complete", "a@"], ["record", "x@y@z", "status"], ["log", "@", "1"], ["complete", f"@{ID_Q36}"]]:
        r_code, r_out, _ = rust_ask(rust_binary, FIXTURE, args)
        p_code, p_out, _ = py_ask(FIXTURE, args)
        assert (p_code, p_out) == (r_code, r_out), args


def test_the_two_languages_agree_when_the_files_are_odd(rust_binary, scratch):                           # TC-92
    state, _ = scratch
    run_dir = state / "collected/gruntus" / ID_FRESH
    (run_dir / "metrics.json").write_bytes(b"\xff")
    (run_dir / "finalize.json").unlink()
    (run_dir / "progress.json").unlink()
    (run_dir / "progress.json").mkdir()
    os.symlink(run_dir / "run.json", run_dir / "run-status.json.link")
    (run_dir / NOTE).write_bytes(b'{"complete":true,"settled_at":-0,"collected_at":1e3,"run_status":{"state":"x"}}')
    (run_dir / "stories/01/prompt.md").write_bytes(b"\xef\xbb\xbfbom\r\n")
    for args in [["record", ID_FRESH, "metrics"], ["record", ID_FRESH, "finalize"], ["record", ID_FRESH, "progress"],
                 ["complete", ID_FRESH], ["record", ID_FRESH, "prompt", "1"], ["record", ID_FRESH, "collection"]]:
        r_code, r_out, _ = rust_ask(rust_binary, state, args)
        p_code, p_out, _ = py_ask(state, args)
        assert (p_code, p_out) == (r_code, r_out), args


def test_the_two_languages_agree_on_the_ranking_of_copies(rust_binary, scratch):                         # TC-14, TC-92
    state, _ = scratch

    def both() -> tuple[bytes, bytes]:
        args = ["preferred", ID_Q36]
        return rust_ask(rust_binary, state, args)[1], py_ask(state, args)[1]

    steps = [
        lambda: set_note(state, "quintus", lambda v: v.__setitem__("settled_at", 1792116938)),
        lambda: set_note(state, "quintus", lambda v: v.__setitem__("settled_at", 1792116937)),
        lambda: set_note(state, "gruntus", lambda v: v.__setitem__("complete", False)),
        lambda: set_note(state, "tritus", lambda v: v.__setitem__("files", {f"f{i}": {} for i in range(100)})),
        lambda: set_note(state, "tritus", lambda v: v.__setitem__("settled_at", "later")),
        lambda: set_note(state, "gruntus", lambda v: v.__setitem__("settled_at", -0.0)),
        lambda: set_note(state, "quintus", lambda v: v.__setitem__("settled_at", 0)),
        lambda: (state / "collected/tritus" / ID_Q36 / NOTE).unlink(),
        lambda: (state / "collected/quintus" / ID_Q36 / NOTE).write_bytes(b"not json"),
        lambda: (state / "collected/gruntus" / ID_Q36 / NOTE).write_bytes(b"[1]"),
    ]
    for step in steps:
        step()
        r, p = both()
        assert r == p


# ----------------------------------------------------------------------------------------------------------------- K. import

def test_importing_the_module_has_no_effects(tmp_path):                                                   # TC-93
    shield = tmp_path / "readonly-cwd"
    shield.mkdir()
    code = f"""
import builtins, dataclasses, gzip, hashlib, json, math, os, re, shutil, stat, subprocess, sys, zlib
import pathlib, typing, io, functools, itertools, collections, errno
sys.dont_write_bytecode = True
sys.path.insert(0, {str(HARNESS)!r})

class Forbidden:
    def __init__(self, what): self.what = what
    def __call__(self, *a, **k): raise AssertionError(self.what + " at import")
    def __getattr__(self, name): raise AssertionError(self.what + " at import")
    def __getitem__(self, key): raise AssertionError(self.what + " at import")
    def __iter__(self): raise AssertionError(self.what + " at import")
    def __contains__(self, key): raise AssertionError(self.what + " at import")

os.environ = Forbidden("environment read")
subprocess.Popen = Forbidden("process started")
subprocess.run = Forbidden("process started")
subprocess.check_output = Forbidden("process started")
for name in ("mkdir", "makedirs", "remove", "unlink", "rename", "rmdir", "replace", "system", "popen", "chdir"):
    setattr(os, name, Forbidden("os." + name))
shutil.rmtree = Forbidden("shutil.rmtree")
real_open = builtins.open
def guarded(file, mode="r", *a, **k):
    if any(c in mode for c in "wax+"): raise AssertionError("file opened for writing at import")
    return real_open(file, mode, *a, **k)
builtins.open = guarded
before = set(sys.modules)
import lake_runs
new = set(sys.modules) - before
assert "roots" not in sys.modules and "drive" not in sys.modules, sorted(new)
print("ok")
"""
    r = subprocess.run([sys.executable, "-c", code], cwd=shield, env={}, capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stderr


def test_the_module_imports_only_the_standard_library():                                                  # TC-94
    tree = ast.parse(MODULE.read_text())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, "a relative import is not the standard library"
            imported.add((node.module or "").split(".")[0])
    assert imported, "the module imports something"
    assert imported <= set(sys.stdlib_module_names), imported - set(sys.stdlib_module_names)
    assert not imported & {"roots", "drive"}, "roots.py and drive.py have effects at import"
    assert not imported & {"requests", "httpx", "pytest"}


def test_the_monitor_can_import_it_by_the_same_sys_path_step(tmp_path):                                   # TC-95
    monitor = REPO / "ops" / "monitor" / "monitor.py"
    assert monitor.is_file()
    code = """
import sys
from pathlib import Path
HERE = Path(sys.argv[1]).parent                     # as in ops/monitor/monitor.py: HERE is the monitor's folder
sys.path.insert(0, str(HERE.parents[1] / "benchmarks" / "spec-bench" / "harness"))
import lake_runs
lake = lake_runs.Lake.in_state_dir(sys.argv[2])
print(len(lake.discover().runs), "roots" in sys.modules or "drive" in sys.modules)
"""
    r = subprocess.run([sys.executable, "-I", "-c", code, str(monitor), str(FIXTURE)], cwd=monitor.parent,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == [str(FIXTURE_RUN_COUNT), "False"]


# --------------------------------------------------------------------------------------------------- L. equal to the old reads

def build_repo(tmp_path: Path, lake: L.Lake, skip_runs=(), skip_files=()) -> tuple[Path, str]:
    """A repository holding the preferred copy of every run of lake (records only), minus what is named, made with
    plumbing only: no branch and no ref is created. Returns (repo folder, commit id)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    env = {"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_INDEX_FILE": str(tmp_path / "index"), **GIT_IDENTITY}

    def git(*args: str) -> str:
        p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, env=env)
        assert p.returncode == 0, f"{args}: {p.stderr}"
        return p.stdout.strip()

    git("init", "-q")
    d = lake.discover()
    for run_id in sorted({r.id for r in d.runs}):
        if run_id in skip_runs:
            continue
        run = lake.preferred(d, run_id)
        base = Path(run.dir)
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.is_symlink():
                continue
            rel = str(p.relative_to(base))
            if L.Record.from_relative_path(rel) is None or (run_id, rel) in skip_files:
                continue
            write(repo / run_id / rel, p.read_bytes())
    git("--work-tree", str(repo), "add", "-A", "--", ".")
    tree = git("write-tree")
    commit = git("commit-tree", tree, "-m", "fixture records")
    return repo, commit


def differences(report: dict) -> list[tuple[str, str, str]]:
    return [(d["run"], d["file"], d["kind"]) for d in report["differences"]]


def test_a_comparison_with_a_direct_read_of_every_file_of_every_fixture_run():                            # TC-97
    lake = fixture_lake()
    d = lake.discover()
    compared = skipped = total = 0
    for run in d.runs:
        base = Path(run.dir)
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            rel = str(p.relative_to(base))
            total += 1
            direct = p.read_bytes()
            record = L.Record.from_relative_path(rel)
            if record is not None:
                assert found(lake.bytes(run, record)) == direct, f"{run.label} {rel}"
                compared += 1
            elif rel.startswith("stories/"):
                story = int(rel.split("/")[1])
                if rel.endswith(RAW_LOG):
                    assert found(found(lake.log(run, story)).bytes()) == direct
                    compared += 1
                elif rel.endswith(COMPACT_LOG):
                    has_raw = (base / f"stories/{story:02d}" / RAW_LOG).is_file()
                    log = found(lake.log(run, story))
                    if has_raw:
                        assert log.form == "raw"
                        skipped += 1
                    else:
                        assert found(log.bytes()) == gunzip(direct)
                        compared += 1
            else:
                assert rel.rsplit("/", 1)[-1] == BUNDLE, f"{rel} is neither a record nor a log"
                skipped += 1
    assert compared + skipped == total and compared > skipped


def test_the_library_equals_the_repositorys_blobs_on_the_fixtures(tmp_path):                              # TC-98
    lake = fixture_lake()
    repo, rev = build_repo(tmp_path, lake)
    report = found(L.compare_git(lake, repo, rev))
    assert report["defects"] == []
    assert report["differences"] == [], report
    assert report["runs_compared"] == FIXTURE_DISTINCT_IDS
    assert report["not_compared"] == [] and report["rev"] == rev


def test_the_fixtures_equal_the_real_repository_where_it_tracks_them():                                   # TC-98
    if not (GIT_REPO / ".git").exists():
        pytest.skip("no repository next to the crate")
    report = found(L.compare_git(fixture_lake(), GIT_REPO, "HEAD"))
    assert report["defects"] == []
    differ = [d for d in differences(report) if d[2] == "differs"]
    assert differ == [], f"fixture files that differ from the repository: {differ}"
    assert report["runs_compared"] >= 1


def test_a_changed_byte_is_reported_as_differs_with_run_and_file(scratch, tmp_path):                      # TC-99
    state, lake = scratch
    repo, rev = build_repo(tmp_path, lake)
    p = state / "collected/gruntus" / ID_FRESH / "metrics.json"
    data = bytearray(p.read_bytes())
    data[-1] = ord("\n") if data[-1] == ord(" ") else ord(" ")
    p.write_bytes(bytes(data))
    report = found(L.compare_git(lake, repo, rev))
    assert differences(report) == [(ID_FRESH, "metrics.json", "differs")]
    assert report["differences"][0]["node"] == "gruntus" and report["differences"][0]["lake_complete"] is True
    assert report["defects"] == []


def test_equal_values_in_different_bytes_still_differ(scratch, tmp_path):                                 # TC-99
    state, lake = scratch
    repo, rev = build_repo(tmp_path, lake)
    p = state / "collected/gruntus" / ID_FRESH / "run-status.json"
    p.write_bytes(json.dumps(json.loads(p.read_bytes()), separators=(",", ":"), indent=None).encode() + b"\n\n")
    report = found(L.compare_git(lake, repo, rev))
    assert differences(report) == [(ID_FRESH, "run-status.json", "differs")]


def test_a_file_the_lake_lacks_is_listed_as_lake_absent_with_the_notes_complete_flag(scratch, tmp_path):  # TC-100
    state, lake = scratch
    repo, rev = build_repo(tmp_path, lake)
    (state / "collected/gruntus" / ID_FRESH / "finalize.json").unlink()
    (state / "collected/gruntus" / ID_DRY / "finalize.json").unlink()
    report = found(L.compare_git(lake, repo, rev))
    assert sorted(differences(report)) == [(ID_DRY, "finalize.json", "lake-absent"), (ID_FRESH, "finalize.json", "lake-absent")]
    by_run = {d["run"]: d for d in report["differences"]}
    assert by_run[ID_FRESH]["lake_complete"] is True and by_run[ID_DRY]["lake_complete"] is False


def test_a_file_the_repository_lacks_is_listed_as_repository_absent(tmp_path):                            # TC-101
    lake = fixture_lake()
    repo, rev = build_repo(tmp_path, lake, skip_files=[(ID_FRESH, "finalize.json"), (ID_REFV, "stories/01/gate.json")])
    report = found(L.compare_git(lake, repo, rev))
    assert sorted(differences(report)) == [
        (ID_REFV, "stories/01/gate.json", "repository-absent"), (ID_FRESH, "finalize.json", "repository-absent")]


def test_the_fixture_drop_list_is_recorded_in_a_tab_separated_file():                                     # TC-102
    dropped = (FIXTURES / "DROPPED.tsv").read_text()
    for line in dropped.splitlines():
        if line:
            assert len(line.split("\t")) >= 2, line
    script = (FIXTURES / "make-lake-fixture.sh").read_text()
    assert "DROPPED.tsv" in script or "$dropped" in script


def test_the_fixture_builder_drops_a_file_that_differs_from_the_repository():                             # TC-102
    pytest.skip("not run: the builder needs the host's lake and a repository to compare with, and on 16 October "
                "no fixture file differed (DROPPED.tsv is empty)")


def test_the_fixture_folder_is_within_its_size_budget():                                                  # TC-103
    script = (FIXTURES / "make-lake-fixture.sh").read_text()
    budget = next(int(m.group(1)) for m in re.finditer(r"^FIXTURE_BUDGET_BYTES=(\d+)", script, re.M))
    total = sum(p.stat().st_size for p in FIXTURE.rglob("*") if p.is_file())
    assert 0 < total <= budget, (total, budget)


def test_a_comparison_on_the_hosts_lake_has_no_library_defect():                                          # TC-104
    host, repo = os.environ.get(HOST_STATE_ENV), os.environ.get(HOST_REPO_ENV)
    if not host or not repo:
        pytest.skip(f"{HOST_STATE_ENV} and {HOST_REPO_ENV} are not set: the host's lake is not on this machine, and "
                    "task 5.32 is open")
    report = found(L.compare_git(L.Lake.in_state_dir(Path(host)), Path(repo), L.DEFAULT_REV))
    assert report["defects"] == [], report["defects"]
    print(f"TC-104: {report['runs_compared']} runs compared, {len(report['differences'])} differences")


def test_runs_the_repository_does_not_track_are_not_compared_and_not_counted(tmp_path):                   # TC-105
    lake = fixture_lake()
    repo, rev = build_repo(tmp_path, lake, skip_runs=[ID_DRY, ID_TODOODLE])
    report = found(L.compare_git(lake, repo, rev))
    assert report["runs_compared"] == FIXTURE_DISTINCT_IDS - 2
    assert sorted(report["not_compared"]) == [ID_TODOODLE, ID_DRY]
    assert report["differences"] == [], "an untracked run is not a set of differences"


def test_a_comparison_that_cannot_look_is_not_run_and_never_a_pass(tmp_path):                             # TC-106
    lake = fixture_lake()
    repo, rev = build_repo(tmp_path, lake)
    for repo_path, revision in [(tmp_path / "no-such-repo", rev), (tmp_path, rev), (repo, ABSENT_REV), (repo, "no-such-ref")]:
        assert isinstance(L.compare_git(lake, repo_path, revision), str), (repo_path, revision)
    plain = tmp_path / "plain"
    plain.mkdir()
    assert isinstance(L.compare_git(lake, plain, rev), str)
    no_lake = L.Lake.in_state_dir(tmp_path / "no-lake")
    assert isinstance(L.compare_git(no_lake, repo, rev), str)
    empty_s = tmp_path / "empty"
    empty_s.mkdir()
    ids = sorted({r.id for r in lake.discover().runs})
    other_repo, other_rev = build_repo(empty_s, lake, skip_runs=ids)
    reason = L.compare_git(lake, other_repo, other_rev)
    assert isinstance(reason, str) and "nothing was compared" in reason


def test_the_two_languages_agree_on_the_comparison_with_git(rust_binary, scratch, tmp_path):             # TC-107
    state, lake = scratch
    repo, rev = build_repo(tmp_path, lake, skip_runs=[ID_DRY], skip_files=[(ID_REFV, "stories/01/gate.json")])
    (state / "collected/gruntus" / ID_FRESH / "finalize.json").unlink()
    (state / "collected/gruntus" / ID_Q36 / "progress.json").write_bytes(b"{}")
    r = subprocess.run([str(rust_binary), str(state), "compare-git", str(repo), "--rev", rev], capture_output=True)
    out, err = io.BytesIO(), io.BytesIO()
    code = L.run([str(state), "compare-git", str(repo), "--rev", rev], out, err)
    assert (code, out.getvalue()) == (r.returncode, r.stdout), err.getvalue()
    assert r.returncode == 0 and b'"differences":[{' in r.stdout
    no_repo = subprocess.run([str(rust_binary), str(state), "compare-git", str(tmp_path / "none")], capture_output=True)
    out, err = io.BytesIO(), io.BytesIO()
    assert L.run([str(state), "compare-git", str(tmp_path / "none")], out, err) == no_repo.returncode == L.EXIT_NOT_RUN
    assert err.getvalue() == no_repo.stderr


def test_the_hosts_lake_is_read_without_change():                                                         # TC-108
    def over(state: Path) -> int:
        lake = L.Lake.in_state_dir(state)
        before = snapshot(state)
        asked = 0
        for run in lake.discover().runs:
            assert isinstance(lake.value(run, L.STATUS), (L.Found, L.Absent))
            assert isinstance(lake.completeness(run), (L.Found, L.Absent))
            assert isinstance(lake.log(run, 1), (L.Found, L.Absent))
            asked += 1
        assert snapshot(state) == before, "the lake is unchanged"
        return asked

    assert over(FIXTURE) == FIXTURE_RUN_COUNT
    host = os.environ.get(HOST_STATE_ENV)
    if not host:
        pytest.skip(f"{HOST_STATE_ENV} is not set; the fixture lake was used")
    print(f"TC-108: {over(Path(host))} runs of {host} asked")


if __name__ == "__main__":
    if sys.argv[1:] == ["--regenerate-golden"]:
        cargo = shutil.which("cargo")
        if cargo is None:
            raise SystemExit("cargo is not installed: the golden answers come from the Rust command")
        subprocess.run([cargo, "build", "-q", "-p", "bench-lake"], cwd=REPO / "tools", check=True)
        meta = json.loads(subprocess.run([cargo, "metadata", "--no-deps", "--format-version", "1"], cwd=REPO / "tools",
                                         capture_output=True, text=True, check=True).stdout)
        print(regenerate_golden(Path(meta["target_directory"]) / "debug" / "bench-lake"), "answers written to", GOLDEN)
    else:
        raise SystemExit("usage: test_lake_runs.py --regenerate-golden   (the tests are run with pytest)")
