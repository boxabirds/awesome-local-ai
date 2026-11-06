"""TC-A0 and TC-A1 (story 23, readers.tools): every analysis tool that read other runs from a checkout gives the same
output from the lake, and stops with bench-lake's message when bench-lake cannot answer.

One fixture, built in two layouts (`world`):
  checkout  the runs as git carried them into a checkout: compact logs, public summaries, no raw logs. The held-out
            detail is in the private repo's runs/<id>/. This is what the tools read before story 23.
  lake      the same runs as the collector lays them out: the node's copy (raw and compact logs) in
            collected/node-t/, a copy git carried to another machine (compact only) in collected/node-u/, the reference
            run in reference/. The checkout holds no run folder at all, so a tool that still read one would find
            nothing and its output would differ.
The goldens in fixtures/lake_readers/ are the tools' output on the checkout layout, captured once with the code as it
was before task 23.18 (commit 7cf93f444^; how, in fixtures/lake_readers/README.md) and never edited by hand.

Per tool (the task 23.18 decisions say why the last four are as they are):
  annotate (attempts), heldout.private_copy (the held-out results found), judge (the blinded package),
  the token counter (the corpus): TC-A0 golden and TC-A1;
  tensorfold-check: tools/tensorfold-check/tests/driver-test.sh ("the default session is this Mac's own run");
  logscan.known_runs, finalize_pending, publicise.over_limit: they read this machine's own disk, never the lake, so
  TC-A0 is that a checkout without run folders gives their empty answer and TC-A1 that a failing bench-lake does not
  touch them; machine_names.tracked was deleted (nothing called it since 3 Nov 2026), so it has no case.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import benchlake
import lake_testing

HERE = Path(__file__).resolve().parent
GOLDEN = HERE / "fixtures" / "lake_readers"
EVENTS = HERE / "fixtures" / "events" / "pi"
RAW_LOG = "agent-events.jsonl"
COMPACT_LOG = "agent-events.compact.jsonl.gz"
VIDI = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi"
RUNS = {"pi": f"{VIDI}/fx-r1", "alt": f"{VIDI}/fx-r2"}          # judge's label -> run id
REF = "benchmarks/reference/vidi/opus-5.5/fx-ref"
NODE, CARRIED_TO = "node-t", "node-u"
STORIES = ("01", "02")
LOG = """commit {c2}
vidi-agent  Fri Sep 25 17:07:33 2026 +0100

    story 2: notes

 src/b.ts | 1 +

commit {c1}
vidi-agent  Fri Sep 25 16:00:00 2026 +0100

    story 1: pan

 src/a.ts | 1 +
"""


class World:
    def __init__(self, root: Path, layout: str):
        self.root = root
        self.layout = layout
        self.checkout = root / "awesome-local-ai"
        self.private = root / "awesome-local-ai-bench-private"
        self.state = self.private / "state"
        self.dirs: dict[str, Path] = {}       # run id -> the folder a tool should read

    def run_dir(self, run_id: str, node: str = NODE) -> Path:
        if self.layout == "checkout":
            return self.checkout / run_id
        if run_id.startswith(benchlake.REFERENCE_ID_PREFIX + "/"):
            return self.state / benchlake.REFERENCE / run_id.removeprefix(benchlake.REFERENCE_ID_PREFIX + "/")
        return self.state / benchlake.COLLECTED / node / run_id


def write(path: Path, data) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, bytes):
        path.write_bytes(data)
    else:
        path.write_text(data if isinstance(data, str) else json.dumps(data, indent=1, sort_keys=True))
    return path


def accept(story: str, passed: int) -> dict:
    return {"passed": passed, "total": 4, "by_story": {story: {"passed": passed // 2, "total": 2}},
            "tests": [{"title": f"story {story} pans", "status": "passed", "file": f"story-{story}.spec.ts"},
                      {"title": f"story {story} zooms", "status": "failed", "file": f"story-{story}.spec.ts",
                       "error": "Error: expected 2\nreceived 1"}]}


def summary(detail: dict) -> dict:
    return {"passed": detail["passed"], "total": detail["total"]}


def fill_run(w: World, run_id: str, d: Path, n: int, raw: bool) -> None:
    """A finished two-story run: its records, its app in workspace/, each story's log, gate and held-out summary."""
    c1, c2 = f"{n}" * 40, f"{n + 1}" * 40
    write(d / "run.json", {"run": run_id.rsplit("/", 1)[-1]})
    write(d / "run-status.json", {"state": "finished", "at": "2026-09-25T17:30:00Z"})
    write(d / "metrics.json", {"stories": {
        "1": {"title": "Pan the board", "status": "DONE", "ended_by": "agent", "commit": c1,
              "agent": {"seconds": 90 * n, "tool_calls": 4 + n}},
        "2": {"title": "Notes", "status": "DONE", "ended_by": "agent", "commit": c2,
              "agent": {"seconds": 120 * n, "tool_calls": 6 + n}}}})
    write(d / "workspace-git-log.txt", LOG.format(c1=c1, c2=c2))
    write(d / "workspace" / "src" / "a.ts", f"export const a = {n}\n")
    write(d / "workspace" / "src" / "b.ts", f"export const b = {n + 1}\n")
    for i, s in enumerate(STORIES):
        sdir = d / "stories" / s
        write(sdir / COMPACT_LOG, (EVENTS / COMPACT_LOG).read_bytes())
        if raw:
            write(sdir / RAW_LOG, (EVENTS / RAW_LOG).read_bytes())
        write(sdir / "gate.json", {"all_green": i == 0})
        detail = accept(s, n + i + 1)
        write(sdir / "accept-summary.json", summary(detail))
        write(w.private / "runs" / run_id / "stories" / s / "accept.json", detail)


def fill_reference(w: World, d: Path) -> None:
    """A hand-built reference run: no stories/, the agent's reports, its app in workspace/."""
    write(d / "run.json", {"run": "fx-ref"})
    write(d / "metrics.json", {"stories": {"1": {"title": "Pan the board", "commit": "9" * 40}}})
    write(d / "workspace-git-log.txt", LOG.format(c1="8" * 40, c2="9" * 40))
    write(d / "workspace" / "src" / "a.ts", "export const a = 'ref'\n")
    write(d / "accept.json", accept("01", 4))
    write(d / "agent-reports" / "story-01.md", "Story 1 is done: the board pans.\n")


def world(tmp: Path, monkeypatch, layout: str) -> World:
    """The fixture in one layout, with the private repo, its pack and an empty lake beside the checkout."""
    w = World(tmp, layout)
    (w.checkout / ".git").mkdir(parents=True)
    w.private.mkdir()
    subprocess.run(["git", "init", "-q", str(w.private)], check=True)
    write(w.private / ".gitignore", "/state/\n")
    pack = w.private / "packs" / "vidi"
    write(pack / "spec" / "spec.md", "spec")
    write(pack / "scope" / "canvas.json", '{"stories": []}')
    write(pack / "acceptance" / "tests" / "story-01.spec.ts", "test")
    write(pack / "acceptance" / "package.json", "{}")
    write(pack / "GRADING.md", "grade it")
    for root in (benchlake.COLLECTED, benchlake.REFERENCE):
        (w.state / root).mkdir(parents=True)
    subprocess.run(["git", "init", "--quiet", "--bare", str(w.state / "code.git")], check=True)
    for n, run_id in enumerate(RUNS.values(), start=1):
        d = w.dirs[run_id] = w.run_dir(run_id)
        fill_run(w, run_id, d, n, raw=layout == "lake")
        if layout == "lake":                                        # the copy git carried to another machine
            fill_run(w, run_id, w.run_dir(run_id, CARRIED_TO), n, raw=False)
    w.dirs[REF] = w.run_dir(REF)
    fill_reference(w, w.dirs[REF])
    monkeypatch.setenv(benchlake.BIN_ENV, str(lake_testing.binary()))
    monkeypatch.setenv(benchlake.STATE_ENV, str(w.state))
    monkeypatch.setenv("SPEC_BENCH_PRIVATE_REPO", str(w.private))
    monkeypatch.setenv("SPEC_BENCH_PACK_DIR", str(pack))
    import packdir
    monkeypatch.setattr(packdir, "REPO_ROOT", w.checkout)
    return w


def failing_bench_lake(tmp: Path, monkeypatch) -> str:
    """A bench-lake that cannot answer: exits 1 with one line on standard error. Returns that line."""
    line = "E-LAKE-UNREADABLE: permission denied"
    stub = write(tmp / "stub" / "bench-lake", f"#!/bin/sh\necho '{line}' >&2\nexit 1\n")
    stub.chmod(0o755)
    monkeypatch.setenv(benchlake.BIN_ENV, str(stub))
    return line


# ---------- what each tool gives: the same functions capture the goldens and check the lake ----------

def attempts_of(w: World) -> list[dict]:
    import annotate
    cache = w.root / "annotate-cache.json"
    if w.layout == "checkout":
        return annotate.load_attempts(w.checkout, cache, rebuild=True)          # before 23.18: a checkout
    return annotate.load_attempts(annotate.run_dirs(), cache, rebuild=True)


def heldout_of(w: World) -> dict:
    import heldout
    return {f"{run_id}#{s}": heldout.read_json(w.dirs[run_id], f"stories/{s}/accept.json")
            for run_id in RUNS.values() for s in STORIES}


def package_of(w: World, monkeypatch, capsys) -> dict:
    """judge.py --prepare-only for the two combination runs and the reference run: every file of the blinded
    package, by path with the build's label in place of its letter, as its SHA-256."""
    import judge
    jobs = {}
    for name, builds in (("pair", RUNS), ("ref", {"pi": RUNS["pi"], "ref": REF})):
        if w.layout == "checkout":
            monkeypatch.setattr(judge, "REPO", w.checkout, raising=False)
        argv = [w for label, run_id in builds.items() for w in ("--build", f"{label}={run_id}")]
        monkeypatch.setattr("sys.argv", ["judge.py", "--name", name, "--label", "fake", *argv, "--prepare-only"])
        judge.main()
        capsys.readouterr()
        key = json.loads((w.state / "keys" / f"{name}.json").read_text())
        package = w.state / "judging" / name / "package"
        files = {}
        for f in sorted(p for p in package.rglob("*") if p.is_file()):
            rel = f.relative_to(package).as_posix()
            for letter, label in key.items():
                rel = rel.replace(f"build-{letter}/", f"build-{label}/")
            files[rel] = hashlib.sha256(f.read_bytes()).hexdigest()
        jobs[name] = dict(sorted(files.items()))
    return jobs


TOOLS = HERE.parents[2] / "tools"
COUNTER = TOOLS / "target" / "release" / "anthropic-token-counter"
# Above every count the fixture has, so each side takes every candidate: the pick hashes a key holding the line
# number, which differs between a raw log and its compact copy, so a capped pick would take different strings.
CORPUS_PLAN = ["--files-per-kind", "100000", "--chunks-per-file", "100000", "--logs", "100000", "--strings-per-kind", "100000"]


def counter() -> Path:
    cargo = shutil.which("cargo")
    if not cargo:
        raise RuntimeError("the token counter's case runs the real binary and needs cargo to build it")
    subprocess.run([cargo, "build", "--quiet", "--release", "-p", "anthropic-token-counter"], cwd=TOOLS, check=True,
                   timeout=lake_testing.BUILD_TIMEOUT_S)
    return COUNTER


def corpus_of(w: World, binary: Path, lake: bool = True) -> subprocess.CompletedProcess:
    """The token counter's corpus of the fixture checkout (git-tracked, as the counter reads it) and the lake."""
    subprocess.run(["git", "-C", str(w.checkout), "init", "-q"], check=True, capture_output=True)
    write(w.checkout / "docs" / "guide.md", "".join(f"guide line {i}: the quick brown fox\n" for i in range(40)))
    subprocess.run(["git", "-C", str(w.checkout), "add", "-A"], check=True, capture_output=True)
    out = w.root / "corpus.jsonl"
    cmd = [str(binary), "corpus", "--repo", str(w.checkout), "--out", str(out), *CORPUS_PLAN]
    if lake:
        cmd += ["--lake", str(w.state)]
    return subprocess.run(cmd, capture_output=True, text=True)


def log_samples(w: World) -> list[dict]:
    """The corpus's samples from the runs' logs. (Its samples of a run's other files, which it took from the checkout
    before story 23, are gone on purpose: a run's files are run data, and it reads only logs from the lake.)"""
    every = [json.loads(line) for line in (w.root / "corpus.jsonl").read_text().splitlines()]
    return sorted((s for s in every if s["kind"].startswith("log:")), key=lambda s: (s["source"], s["kind"], s["text"]))


def golden(name: str):
    return json.loads((GOLDEN / f"{name}.json").read_text())


# ---------- TC-A0: the same output from the lake ----------

def test_annotate_gives_the_attempts_it_gave_from_the_checkout(tmp_path, monkeypatch):
    w = world(tmp_path, monkeypatch, "lake")
    assert attempts_of(w) == golden("annotate")


def test_the_held_out_results_are_found_as_they_were_from_the_checkout(tmp_path, monkeypatch):
    w = world(tmp_path, monkeypatch, "lake")
    assert heldout_of(w) == golden("heldout")


@pytest.mark.skipif(sys.platform != "darwin", reason="judge.py needs macOS (sandbox-exec)")
def test_judge_builds_the_package_it_built_from_the_checkout(tmp_path, monkeypatch, capsys):
    w = world(tmp_path, monkeypatch, "lake")
    assert package_of(w, monkeypatch, capsys) == golden("judge")


def test_the_token_counter_gives_the_corpus_it_gave_from_the_checkout(tmp_path, monkeypatch):
    w = world(tmp_path, monkeypatch, "lake")
    done = corpus_of(w, counter())
    assert done.returncode == 0, done.stderr
    # The same samples, as kind and text. Which story a sample is credited to is not compared: the fixture's stories
    # hold the same log, so a repeated text is kept from whichever log is read first, and the reading order hashes the
    # log's name, which is the compact copy's in the checkout and the raw log's in the lake (the counter reads the
    # raw log where there is one; it gives the same samples: test_event_log_forms.py).
    text = lambda samples: sorted((s["kind"], s["text"]) for s in samples)
    got, want = log_samples(w), golden("corpus")
    assert text(got) == text(want)
    assert all(s["source"].startswith(tuple(f"{r}/stories/" for r in RUNS.values())) for s in got)
    assert all(s["source"].endswith("/" + RAW_LOG) for s in got)
    sources = {json.loads(line)["source"] for line in (w.root / "corpus.jsonl").read_text().splitlines()}
    assert {x for x in sources if not x.startswith(VIDI)} == {"docs/guide.md"}


def test_logscan_finalize_and_the_size_check_read_no_run_from_a_checkout_without_runs(tmp_path, monkeypatch):
    import finalize_pending
    import logscan
    import publicise
    w = world(tmp_path, monkeypatch, "lake")
    work = tmp_path / "work"
    (work / "own-run").mkdir(parents=True)
    assert logscan.known_runs(w.checkout, work) == frozenset({"own-run"})
    assert finalize_pending.run_dirs(w.checkout) == []
    subprocess.run(["git", "-C", str(w.checkout), "init", "-q"], check=True, capture_output=True)
    assert publicise.over_limit(w.checkout) == []


# ---------- TC-A1: bench-lake cannot answer ----------

def test_annotate_stops_with_bench_lakes_message(tmp_path, monkeypatch):
    import annotate
    world(tmp_path, monkeypatch, "lake")
    line = failing_bench_lake(tmp_path, monkeypatch)
    with pytest.raises(SystemExit) as stop:
        annotate.run_dirs()
    assert line in str(stop.value) and str(stop.value).startswith("bench-lake records failed (exit 1)")


def test_judge_stops_with_bench_lakes_message(tmp_path, monkeypatch):
    import judge
    w = world(tmp_path, monkeypatch, "lake")
    line = failing_bench_lake(tmp_path, monkeypatch)
    monkeypatch.setattr(judge.sys, "platform", "darwin")
    monkeypatch.setattr("sys.argv", ["judge.py", "--name", "x", "--label", "fake", "--build", f"pi={RUNS['pi']}",
                                     "--build", f"alt={RUNS['alt']}", "--prepare-only"])
    with pytest.raises(SystemExit) as stop:
        judge.main()
    assert str(stop.value) == f"pi: bench-lake preferred {RUNS['pi']} failed (exit 1): {line}"
    assert not (w.state / "judging" / "x" / "package").exists()


def test_the_token_counter_stops_naming_a_lake_that_is_not_there(tmp_path, monkeypatch):
    w = world(tmp_path, monkeypatch, "lake")
    shutil.rmtree(w.state / benchlake.COLLECTED)
    shutil.rmtree(w.state / benchlake.REFERENCE)
    done = corpus_of(w, counter())
    assert done.returncode != 0
    assert f"no lake at {w.state}: neither collected/ nor reference/ is there" in done.stderr


def test_heldout_and_the_node_side_tools_do_not_ask_bench_lake(tmp_path, monkeypatch):
    """private_copy works out a path; logscan, finalize_pending and the size check read this machine's disk. A
    bench-lake that cannot answer changes none of them."""
    import finalize_pending
    import logscan
    w = world(tmp_path, monkeypatch, "lake")
    failing_bench_lake(tmp_path, monkeypatch)
    assert heldout_of(w) == golden("heldout")
    assert logscan.known_runs(w.checkout, tmp_path / "no-work") == frozenset()
    assert finalize_pending.run_dirs(w.checkout) == []


def test_the_fixture_is_the_one_the_goldens_were_captured_from(tmp_path, monkeypatch):
    """The two layouts hold the same runs: the same ids, and in each the files a tool reads. A change to the builder
    that the goldens do not reflect fails here, not as a puzzling difference above."""
    checkout = world(tmp_path / "c", monkeypatch, "checkout")
    lake = world(tmp_path / "l", monkeypatch, "lake")
    assert sorted(checkout.dirs) == sorted(lake.dirs)
    for run_id in checkout.dirs:
        a, b = checkout.dirs[run_id], lake.dirs[run_id]
        public = sorted(p.relative_to(a).as_posix() for p in a.rglob("*") if p.is_file())
        assert [p for p in public if (b / p).is_file()] == public, run_id
        assert not any(p.endswith(RAW_LOG) for p in public)     # git never carried a raw log
    assert not (lake.checkout / "combinations").exists() and not (lake.checkout / "benchmarks").exists()
    assert gzip.decompress((EVENTS / COMPACT_LOG).read_bytes())  # the excerpt the logs are made from is readable
