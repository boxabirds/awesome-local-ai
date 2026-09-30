"""The publishing gate: no commit the harness makes carries the held-out suite's detail. The rules are
publicise.py's; heldout.py and drive.record_story apply them.

MECE by what the gate guarantees:
  A. private files are never staged: the run's .gitignore, and untracking what an older harness committed
  B. each held-out result has its public summary beside it: story, re-score story, final, run-level, base
  C. metrics.json and the reports, as committed, hold counts only; the machine's tools still get the detail
  D. the leak check refuses a commit that carries held-out detail, and allows the agent's own work
  E. the detail is copied to the private repo, and the resolver finds it here or there
  F. every writer of results goes through the same path: rescore, gates, finalize, backfill
  G. end to end: a whole run through record_story into a git repo, and what was pushed
Every title here is made up: a real held-out title in this public repo would itself be a leak.
Run: uv run --with pytest pytest test_publish_gate.py
"""
from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import drive
import heldout
import history
import publicise as pub
import report

G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
TITLE = "a made-up held-out title for the gate"
OTHER = "another invented held-out check of the gate"
ANCHOR = "@ref prd:made-up.gate-anchor"
OWN_TITLE = "creates a note on a double click, invented"
RUN_REL = "combinations/some/stack/benchmarks/vidi/r1"
VERSION = "vidi-v9"
MESSAGE = "vidi some/stack r1: story 2 done"
ERROR = "Error: expect(locator).toHaveText(expected) failed\nLocator: getByRole('note')\nExpected: \"x\""
LOG = """commit bbbb
vidi-agent  Sat Sep 26 09:44:15 2026 +0100

    story 2: notes


 src/Note.tsx | 20 ++++
 1 file changed, 20 insertions(+)

commit aaaa
vidi-agent  Sat Sep 26 08:00:00 2026 +0100

    story 1: board


 src/Board.tsx | 10 ++++
 1 file changed, 10 insertions(+)

commit 0000
harness  Sat Sep 26 07:00:00 2026 +0100

    harness: empty repository with spec

"""


# ---------- fixtures: a private suite, a public repo, a whole run ----------

def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*G, *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


def write(p: Path, content: str | bytes | dict) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, dict):
        content = json.dumps(content, indent=2)
    (p.write_bytes if isinstance(content, bytes) else p.write_text)(content)
    return p


def cloned(root: Path, name: str) -> tuple[Path, Path]:
    """A checkout of a bare remote, with a first commit pushed."""
    remote, repo = root / f"{name}.git", root / name
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True, capture_output=True)
    write(repo / "README.md", name)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "first")
    git(repo, "push", "-q", "-u", "origin", "HEAD:main")
    return repo, remote


def private_suite(root: Path) -> Path:
    """The private repo as it is beside this one: a tagged held-out suite, and a remote to push to."""
    repo, _ = cloned(root, "private")
    write(repo / "packs/vidi/acceptance/tests/story-01.spec.ts",
          f"test('{TITLE} {ANCHOR}', async () => {{}});\ntest(\"{OTHER} @ref prd:made-up.other\", async () => {{}});\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "suite")
    git(repo, "tag", VERSION)
    git(repo, "push", "-q", "origin", "HEAD:main", "--tags")
    return repo


def t(title: str, status: str, story: int = 1, error: str = "") -> dict:
    return {"file": f"story-{story:02d}.spec.ts", "line": 9, "title": f"{title} {ANCHOR}" if title in (TITLE, OTHER) else title,
            "status": status, "error": error}


def result(tests: list[dict], **extra) -> dict:
    """A held-out result as gates.accept returns it: counts, runner output, and every test."""
    by: dict[str, dict] = {}
    for x in tests:
        s = by.setdefault(x["file"][6:8], {"passed": 0, "total": 0})
        s["total"] += 1
        s["passed"] += x["status"] == "passed"
    return {"skipped": False, "build_exit": 0, "runner_exit": 1, "runner_tail": f"  1) {TITLE} {ANCHOR}\n{ERROR}",
            "passed": sum(x["status"] == "passed" for x in tests), "total": len(tests),
            "on_partial": {"passed": 1, "total": 2}, "by_story": by, "harness_fault": None,
            "setup_fallbacks": {"tests": 0, "by_owner": {}}, "tests": tests, **extra}


STORY_1 = result([t(TITLE, "passed"), t(OTHER, "failed", error=ERROR)])
STORY_2 = result([t(TITLE, "failed", error=ERROR), t(OTHER, "passed"), t(OWN_TITLE, "passed", story=2)])
RESCORED = result([t(TITLE, "failed", error=ERROR), t(OTHER, "passed"), t(OWN_TITLE, "passed", story=2)],
                  scores=[2, 2, 3], flaky=[f"story-01.spec.ts: {TITLE}"])


def story_record(n: int, acc: dict, commit: str, **extra) -> dict:
    """metrics.json's record of a story, as drive.main keeps it: the result without its tests."""
    return {"title": f"Story {n}", "commit": commit, "finished": 1, "status": "DONE",
            "agent": {"seconds": 600, "stalled": False, "steps": 3, "tokens": {"output": 10}},
            "requests": {"requests": 3}, "conditions": {},
            "gate": {"all_green": True, "steps": {"e2e": {"tail": f"ok  {OWN_TITLE}; ok {TITLE}"}}},
            "accept": {k: v for k, v in acc.items() if k != "tests"}, **extra}


def full_metrics() -> dict:
    return {"pack": "vidi", "processed": [{"id": 1, "status": "PARTIAL"}, {"id": 2, "status": "DONE"}], "stories": {
        "1": story_record(1, STORY_1, "aaaa", status="PARTIAL", skip={"by": "op", "reason": "cap"},
                          verdict={"verdict": "green", "gate_green": True, "heldout": {"passed": 1, "total": 2}}),
        "2": story_record(2, STORY_2, "bbbb", partial_base=[1], stub_markers=[],
                          partial_heldout_changes={"1": {"fixed": [f"{OTHER} {ANCHOR}"], "regressed": [f"{TITLE} {ANCHOR}"]}}),
    }}


# Every private file a run can hold (publicise.is_private), relative to the run.
PRIVATE_KINDS = [
    "stories/01/accept.json", "stories/01/accept-report.json", "stories/01/artifacts/story-01-x-chromium/error-context.md",
    "stories/01/screenshots/a.png", "stories/01/scoring-2/accept-report.json", "stories/01/pre-suite-fix/accept.json",
    "stories/02/accept.json", f"rescore/{VERSION}/stories/02/accept.json", f"rescore/{VERSION}/stories/02/accept-report.json",
    f"rescore/{VERSION}/stories/02/artifacts/story-02-x/error-context.md", f"rescore/{VERSION}/stories/02/screenshots/s.png",
    f"rescore/{VERSION}/stories/02/scoring-2/accept-report.json", f"rescore/{VERSION}/{pub.HELDOUT_DETAIL}",
    "accept-final.json", "AUDIT.md", "audit.jsonl", pub.HELDOUT_DETAIL, pub.SUMMARY_DETAIL,
    "base/accept.json", "base/screenshots/b.png", "base/artifacts/x/error-context.md",
    "superseded/story-03-early-stop/accept.json", "superseded/story-03-early-stop/artifacts/x/error-context.md",
]
# The agent's own files, some named like private ones: always public.
OWN_KINDS = ["workspace/accept.json", "workspace/AUDIT.md", "workspace/tests/e2e/screenshots/w.png",
             "workspace/artifacts/notes.md", "workspace/tests/e2e/notes.spec.ts", "stories/01/gate.json",
             "stories/01/agent-events.compact.jsonl.gz", "workspace-git-log.txt"]
# Each held-out result, and its public summary beside it.
SUMMARIES = {"stories/01/accept.json": "stories/01/accept-summary.json",
             "stories/02/accept.json": "stories/02/accept-summary.json",
             f"rescore/{VERSION}/stories/02/accept.json": f"rescore/{VERSION}/stories/02/accept-summary.json",
             "accept-final.json": "accept-final-summary.json",
             "base/accept.json": "base/accept-summary.json",
             "superseded/story-03-early-stop/accept.json": "superseded/story-03-early-stop/accept-summary.json"}


def make_run(repo: Path) -> Path:
    """A run directory with every kind of file a finished, re-scored run holds, as the machine has it just before
    record_story: the results written plainly (the gate must summarise them), metrics and summary as drive wrote them."""
    run = repo / RUN_REL
    write(run / "run.json", {"combination": "some/stack", "model_id": "m", "host": "h"})
    write(run / "run-status.json", {"state": "running"})
    write(run / "interventions.md", "- nothing to note\n")
    write(run / "workspace-git-log.txt", LOG + f"    test: {TITLE}\n")
    for n, acc, base in ((1, STORY_1, "0000"), (2, STORY_2, "aaaa")):
        s = run / "stories" / f"{n:02d}"
        write(s / "prompt.md", f"Build story {n}.")
        write(s / "base-commit", base + "\n")
        write(s / "gate.json", {"all_green": True, "tail": f"ok {TITLE}"})
        write(s / "agent-events.jsonl", json.dumps({"type": "tool", "text": TITLE}) + "\n")
        write(s / "agent-events.compact.jsonl.gz", gzip.compress(json.dumps({"type": "tool", "text": TITLE}).encode()))
        write(s / "accept.json", acc)
    s1 = run / "stories" / "01"
    write(s1 / "accept-report.json", {"suites": [{"title": TITLE}]})
    write(s1 / "artifacts/story-01-x-chromium/error-context.md", f"# {TITLE}\n{ERROR}")
    write(s1 / "screenshots/a.png", b"\x89PNG " + TITLE.encode())
    write(s1 / "scoring-2/accept-report.json", {"suites": [{"title": TITLE}]})
    write(s1 / "pre-suite-fix/accept.json", STORY_1)
    rs = run / "rescore" / VERSION
    write(rs / "stories/02/accept.json", RESCORED)
    write(rs / "stories/02/accept-report.json", {"suites": [{"title": TITLE}]})
    write(rs / "stories/02/artifacts/story-02-x/error-context.md", f"# {TITLE}")
    write(rs / "stories/02/screenshots/s.png", b"\x89PNG")
    write(rs / "stories/02/scoring-2/accept-report.json", {"suites": [{"title": TITLE}]})
    write(rs / "rescore.json", {"pack_version": VERSION, "results": [{"story": 2, "passed": 2, "total": 3, "flaky": 1}]})
    write(run / "accept-final.json", RESCORED)
    write(run / "AUDIT.md", f"- {TITLE}: failed")
    write(run / "audit.jsonl", json.dumps({"test": TITLE}) + "\n")
    write(run / "base/accept.json", STORY_1)
    write(run / "base/screenshots/b.png", b"\x89PNG")
    write(run / "base/artifacts/x/error-context.md", f"# {TITLE}")
    write(run / "superseded/story-03-early-stop/accept.json", STORY_1)
    write(run / "superseded/story-03-early-stop/artifacts/x/error-context.md", f"# {TITLE}")
    write(run / "superseded/story-03-early-stop/prompt.md", "Build story 3.")
    write(run / "workspace/accept.json", {"mine": TITLE})
    write(run / "workspace/AUDIT.md", f"my audit of {TITLE}")
    write(run / "workspace/tests/e2e/screenshots/w.png", b"\x89PNG")
    write(run / "workspace/artifacts/notes.md", "notes")
    write(run / "workspace/tests/e2e/notes.spec.ts", f"test('{TITLE} {ANCHOR}', async () => {{}});\n")
    for local in ("work_dir.txt", "current_story", "progress.json"):
        write(run / local, "local")
    drive.save_metrics(run, full_metrics())
    heldout.save_metrics(rs, full_metrics())
    (rs / "per-story.md").write_text(history.render_per_story(rs))
    report.write_summary(run)
    return run


@pytest.fixture(scope="module")
def recorded(tmp_path_factory):
    """One whole run recorded through record_story: the public and private repos as they are after it."""
    root = tmp_path_factory.mktemp("gate")
    private = private_suite(root)
    repo, remote = cloned(root, "public")
    run = make_run(repo)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=private)
    public = subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "main"],
                            capture_output=True, text=True, check=True).stdout.split()
    in_private = subprocess.run(["git", "--git-dir", str(root / "private.git"), "ls-tree", "-r", "--name-only", "main"],
                                capture_output=True, text=True, check=True).stdout.split()
    blob = lambda rel: subprocess.run(["git", "--git-dir", str(remote), "show", f"main:{rel}"],
                                      capture_output=True, check=True).stdout
    return SimpleNamespace(root=root, private=private, repo=repo, remote=remote, run=run, res=res, public=public,
                           in_private=in_private, blob=blob, fps=pub.fingerprints(private))


def small_run(repo: Path) -> Path:
    run = repo / RUN_REL
    write(run / "run.json", {"combination": "some/stack"})
    drive.save_metrics(run, {"stories": {"1": story_record(1, STORY_1, "aaaa")}})
    return run


def remote_log(remote: Path) -> str:
    return subprocess.run(["git", "--git-dir", str(remote), "log", "--format=%s", "main"], capture_output=True, text=True).stdout


# ---------- A. private files are never staged ----------

@pytest.mark.parametrize("kind", PRIVATE_KINDS)
def test_A1_each_private_kind_stays_out_of_the_public_repo_and_on_the_machine(recorded, kind):
    assert pub.is_private(f"{RUN_REL}/{kind}")
    assert f"{RUN_REL}/{kind}" not in recorded.public
    assert (recorded.run / kind).exists()


@pytest.mark.parametrize("kind", OWN_KINDS)
def test_A2_the_agents_own_files_are_published_whatever_their_names(recorded, kind):
    assert f"{RUN_REL}/{kind}" in recorded.public


CORPUS_PUBLIC = ["metrics.json", "summary.md", "run.json", "interventions.md", "workspace-git-log.txt",
                 "stories/01/gate.json", "stories/01/accept-summary.json", "stories/01/prompt.md",
                 "stories/01/agent-events.compact.jsonl.gz", f"rescore/{VERSION}/rescore.json",
                 f"rescore/{VERSION}/per-story.md", f"rescore/{VERSION}/metrics.json",
                 f"rescore/{VERSION}/stories/02/accept-summary.json", "accept-final-summary.json",
                 "superseded/story-03-early-stop/prompt.md", "workspace/accept.json", "workspace/AUDIT.md",
                 "workspace/audit.jsonl", "workspace/tests/e2e/screenshots/a.png", "workspace/artifacts/notes.md",
                 "workspace/src/stories/01/artifacts/x.ts", "workspace/test-results/x/error-context.md",
                 "workspace/scoring-2/x.md"]
CORPUS_PRIVATE = [*PRIVATE_KINDS, "accept.json", pub.PUBLISH_REFUSED, f"rescore/{VERSION}/stories/02/scoring-3/screenshots/s.png",
                  f"rescore-spoiled/{VERSION}-20260930T000000/stories/02/accept.json", "stories/01/pre-suite-fix/screenshots/p.png"]


def test_A3_the_runs_gitignore_ignores_exactly_the_private_paths(tmp_path):
    """The .gitignore record_story writes, as git reads it, against publicise.is_private: same answer for every path."""
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    run = tmp_path / RUN_REL
    write(run / ".gitignore", drive.RUN_GITIGNORE)
    for rel in CORPUS_PUBLIC + CORPUS_PRIVATE:
        write(run / rel, "x")
    ignored = set(subprocess.run(["git", "check-ignore", "--stdin"], cwd=run, input="\n".join(CORPUS_PUBLIC + CORPUS_PRIVATE),
                                 capture_output=True, text=True).stdout.split())
    assert {r: pub.is_private(f"{RUN_REL}/{r}") for r in CORPUS_PUBLIC + CORPUS_PRIVATE} == \
           {r: r in ignored for r in CORPUS_PUBLIC + CORPUS_PRIVATE}


def test_A4_private_files_an_older_harness_committed_are_untracked_and_kept_on_disk(tmp_path):
    repo, remote = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / "stories/01/accept.json", STORY_1)
    write(run / "stories/01/screenshots/a.png", b"\x89PNG")
    git(repo, "add", "-f", "--", RUN_REL)
    git(repo, "commit", "-qm", "an older harness's record")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] and res["untracked_private"] == 3, res      # and the metrics sidecar small_run wrote
    tracked = git(repo, "ls-files", "--", RUN_REL).split()
    assert not [f for f in tracked if pub.is_private(f)]
    assert (run / "stories/01/accept.json").exists() and (run / "stories/01/screenshots/a.png").exists()


# ---------- B. each held-out result has its public summary beside it ----------

@pytest.mark.parametrize("full,summary", SUMMARIES.items())
def test_B1_each_result_is_published_as_its_summary(recorded, full, summary):
    assert f"{RUN_REL}/{summary}" in recorded.public
    local = json.loads((recorded.run / full).read_text())
    assert json.loads(recorded.blob(f"{RUN_REL}/{summary}")) == pub.summarise_accept(local)


def test_B2_a_repeat_or_superseded_scoring_gets_no_summary(recorded):
    assert not (recorded.run / "stories/01/pre-suite-fix/accept-summary.json").exists()
    assert not list(recorded.run.glob("**/scoring-*/*summary*"))


def test_B3_write_accept_puts_the_summary_beside_each_kind_of_result(tmp_path):
    for name, summary in pub.SUMMARY_NAMES.items():
        heldout.write_accept(tmp_path / name, RESCORED)
        assert json.loads((tmp_path / summary).read_text()) == pub.summarise_accept(RESCORED)
        assert json.loads((tmp_path / summary).read_text())["flaky"] == 1
    heldout.write_accept(tmp_path / "other.json", RESCORED)          # not a held-out result's name: no summary
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([*pub.SUMMARY_NAMES, *pub.SUMMARY_NAMES.values(), "other.json"])


def test_B4_write_summaries_finds_every_result_once_and_leaves_the_workspace_alone(tmp_path):
    run = tmp_path / "run"
    for full in SUMMARIES:
        write(run / full, STORY_1)
    write(run / "workspace/accept.json", {"passed": 1})
    write(run / "stories/01/half-written/accept.json", "{not json")
    assert sorted(heldout.write_summaries(run)) == sorted(SUMMARIES.values())
    assert heldout.write_summaries(run) == []                           # unchanged: nothing rewritten
    assert not (run / "workspace/accept-summary.json").exists()


# ---------- C. metrics and reports as committed: counts only; the machine keeps the detail ----------

@pytest.mark.parametrize("rel", ["metrics.json", f"rescore/{VERSION}/metrics.json"])
def test_C1_committed_metrics_hold_counts_not_tests_or_runner_output(recorded, rel):
    m = json.loads(recorded.blob(f"{RUN_REL}/{rel}"))
    for rec in m["stories"].values():
        assert "runner_tail" not in rec["accept"] and "tests" not in rec["accept"]
        assert rec["accept"]["by_story"]
    assert m["stories"]["2"]["partial_heldout_changes"] == {"1": {"fixed": 1, "regressed": 1}}
    assert pub.leaks_in_file(f"{RUN_REL}/{rel}", recorded.blob(f"{RUN_REL}/{rel}").decode(), recorded.fps) == []


@pytest.mark.parametrize("rel", ["summary.md", f"rescore/{VERSION}/per-story.md"])
def test_C2_committed_reports_hold_counts_not_titles_or_errors(recorded, rel):
    text = recorded.blob(f"{RUN_REL}/{rel}").decode()
    assert pub.leaks_in_file(f"{RUN_REL}/{rel}", text, recorded.fps) == []
    assert TITLE not in text and "Most common error" not in text


def test_C3_the_summary_keeps_its_counts(recorded):
    text = recorded.blob(f"{RUN_REL}/summary.md").decode()
    assert "story 1: 1/2 → 1/2; broke 1; fixed 1." in text
    assert "fixed 1, regressed 1" in text          # the partial story's tests, from counts


def test_C4_the_machine_keeps_the_detail_for_its_own_tools(recorded):
    assert heldout.load_metrics(recorded.run) == full_metrics()
    detail = (recorded.run / pub.SUMMARY_DETAIL).read_text()
    assert f"“{TITLE} {ANCHOR}”" in detail and "Most common error" in detail
    assert TITLE in history.render(recorded.run)
    assert history.per_story(recorded.run)[1]["regressions"] == 1


def test_C5_the_partial_notes_read_the_same_from_titles_or_counts():
    full = full_metrics()
    public, _ = pub.split_metrics(full)
    assert report.partial_notes(full) == report.partial_notes(public)


def test_C6_saving_what_was_loaded_changes_nothing(tmp_path):
    drive.save_metrics(tmp_path, full_metrics())
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    drive.save_metrics(tmp_path, drive.load_metrics(tmp_path))
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before


def test_C7_an_old_full_metrics_json_is_split_when_a_resumed_run_next_saves(tmp_path):
    (tmp_path / "metrics.json").write_text(json.dumps(full_metrics()))      # written by the harness before the gate
    m = drive.load_metrics(tmp_path)
    assert m == full_metrics()
    drive.save_metrics(tmp_path, m)
    assert "runner_tail" not in (tmp_path / "metrics.json").read_text()
    assert pub.leaks_in_file(f"{RUN_REL}/metrics.json", (tmp_path / "metrics.json").read_text(), {TITLE}) == []
    assert TITLE in (tmp_path / pub.HELDOUT_DETAIL).read_text()


def test_C8_a_run_without_held_out_detail_leaves_no_sidecar(tmp_path):
    write(tmp_path / pub.HELDOUT_DETAIL, {"stories": {"1": {"accept": {"runner_tail": "stale"}}}})
    drive.save_metrics(tmp_path, {"stories": {"1": {"title": "no held-out suite", "accept": {"passed": 0, "total": 0}}}})
    assert not (tmp_path / pub.HELDOUT_DETAIL).exists()


# ---------- D. the leak check: refuses held-out detail, allows the agent's own work ----------

PLANTED = {
    "a harness file": ("run-status.json", json.dumps({"state": "failed", "reason": f"story 2: {TITLE}"})),
    "metrics": ("metrics.json", json.dumps({"stories": {"1": {"verdict": f"failed: {TITLE}"}}})),
    "a summary": ("stories/01/accept-summary.json", json.dumps({"harness_fault": f"{TITLE} timed out"})),
    # a line redact_markdown doesn't know (it redacts the ones history.render writes: H2): the check is the backstop
    "the report": ("summary.md", f"- the test “{TITLE}” failed after story 2\n"),
    "a gzipped record": ("notes.jsonl.gz", gzip.compress(TITLE.encode())),
}


@pytest.mark.parametrize("where", PLANTED)
def test_D1_a_planted_held_out_title_stops_the_commit_and_is_named_only_privately(tmp_path, capsys, where):
    private = private_suite(tmp_path)
    repo, remote = cloned(tmp_path, "public")
    run = small_run(repo)
    rel, content = PLANTED[where]
    write(run / rel, content)
    before = remote_log(remote)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=private)
    assert not res["committed"] and not res["pushed"], res
    assert f"{RUN_REL}/{rel}" in res["error"] and heldout.digest(TITLE) in res["error"]
    assert TITLE not in json.dumps(res) and pub.ANCHOR_MARK not in json.dumps(res)   # it goes into metrics.json
    assert remote_log(remote) == before
    assert git(repo, "diff", "--cached", "--name-only") == ""                        # nothing left staged
    refused = run / pub.PUBLISH_REFUSED
    assert TITLE in refused.read_text()
    assert git(repo, "check-ignore", str(refused)).strip()
    assert TITLE in capsys.readouterr().out                                          # the operator sees what


def test_D2_without_a_private_checkout_the_anchor_mark_still_stops_the_commit(tmp_path):
    repo, remote = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / "interventions.md", f"- story 1 failed “something {ANCHOR}”\n")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "no-private")
    assert not res["committed"] and res["private"]["skipped"]
    assert [r["file"] for r in res["refused"]] == [f"{RUN_REL}/interventions.md"]


@pytest.mark.parametrize("rel,content", [
    ("workspace/tests/e2e/notes.spec.ts", f"test('{TITLE} {ANCHOR}', () => {{}});"),
    ("stories/01/gate.json", json.dumps({"tail": f"ok {TITLE}"})),
    ("stories/01/agent-events.compact.jsonl.gz", gzip.compress(json.dumps({"text": TITLE}).encode() + b"\n")),
    ("workspace-git-log.txt", f"    test: {TITLE}"),
])
def test_D3_the_agents_own_work_is_committed_even_when_it_matches(tmp_path, rel, content):
    """Agents write their own tests from the same spec sentences the held-out titles come from."""
    private = private_suite(tmp_path)
    repo, _ = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / rel, content)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=private)
    assert res["committed"] and res["pushed"], res


def test_D4_the_agents_gate_output_inside_metrics_is_allowed(tmp_path):
    private = private_suite(tmp_path)
    repo, _ = cloned(tmp_path, "public")
    run = repo / RUN_REL
    run.mkdir(parents=True)
    drive.save_metrics(run, {"stories": {"1": {"gate": {"steps": {"e2e": {"tail": f"ok {TITLE}"}}}}}})
    assert drive.record_story(repo, run, MESSAGE, git=G, private=private)["committed"]


def test_D5_a_private_file_forced_into_the_index_is_refused(tmp_path):
    repo, _ = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / "stories/01/accept.json", {"passed": 1})
    git(repo, "add", "-f", "--", RUN_REL)
    problems = heldout.staged_problems(repo, RUN_REL, G, set())
    assert problems == [{"file": f"{RUN_REL}/{f}", "why": heldout.PRIVATE_FILE, "fingerprint": None}
                        for f in (pub.HELDOUT_DETAIL, "stories/01/accept.json")]


def test_D6_what_is_checked_is_what_is_staged_not_the_working_tree(tmp_path):
    repo, _ = cloned(tmp_path, "public")
    f = write(repo / RUN_REL / "run-status.json", TITLE)
    git(repo, "add", "--", RUN_REL)
    f.write_text("clean now, but not staged")
    assert [p["fingerprint"] for p in heldout.staged_problems(repo, RUN_REL, G, {TITLE})] == [TITLE]


def test_D7_only_the_runs_own_staged_files_are_checked(tmp_path):
    repo, _ = cloned(tmp_path, "public")
    write(repo / "elsewhere.md", TITLE)
    write(repo / RUN_REL / "run.json", "{}")
    git(repo, "add", "-A")
    assert heldout.staged_problems(repo, RUN_REL, G, {TITLE}) == []


def test_D8_after_a_refusal_the_cleaned_run_commits_and_its_refusal_record_goes(tmp_path):
    private = private_suite(tmp_path)
    repo, _ = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / "run-status.json", TITLE)
    assert not drive.record_story(repo, run, MESSAGE, git=G, private=private)["committed"]
    write(run / "run-status.json", "{}")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=private)
    assert res["committed"] and res["pushed"], res
    assert not (run / pub.PUBLISH_REFUSED).exists()


def test_D9_fingerprints_are_read_from_the_private_suite_once_per_process(tmp_path, monkeypatch):
    private = private_suite(tmp_path)
    calls = []
    real = pub.fingerprints
    monkeypatch.setattr(pub, "fingerprints", lambda p: calls.append(p) or real(p))
    heldout._fingerprints.cache_clear()
    first, again = heldout.fingerprints(private), heldout.fingerprints(private)
    assert first == again and TITLE in first and len(calls) == 1
    assert heldout.fingerprints(tmp_path / "no-checkout") == set()


# ---------- E. the private copy, and finding the detail here or there ----------

def test_E1_the_private_repo_gets_every_private_file_and_the_record_is_pushed(recorded):
    assert recorded.res["private"]["committed"] and recorded.res["private"]["pushed"], recorded.res
    missing = [k for k in PRIVATE_KINDS if f"{heldout.PRIVATE_RUNS}/{RUN_REL}/{k}" not in recorded.in_private]
    assert missing == []
    assert not [f for f in recorded.in_private if f.startswith(heldout.PRIVATE_RUNS) and not pub.is_private(
        f.removeprefix(f"{heldout.PRIVATE_RUNS}/"))]                        # only the private files


def test_E2_the_copy_takes_only_what_is_new_or_changed(tmp_path):
    repo = tmp_path / "public"
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    run = repo / RUN_REL
    write(run / "stories/01/accept.json", STORY_1)
    write(run / "metrics.json", "{}")
    private = tmp_path / "private"
    assert heldout.copy_private(run, repo, private) == ["stories/01/accept.json"]
    assert heldout.copy_private(run, repo, private) == []
    write(run / "stories/01/accept.json", STORY_2)
    assert heldout.copy_private(run, repo, private) == ["stories/01/accept.json"]
    assert json.loads((private / "runs" / RUN_REL / "stories/01/accept.json").read_text()) == STORY_2


def test_E3_without_a_private_checkout_the_public_record_still_goes_ahead(tmp_path):
    repo, _ = cloned(tmp_path, "public")
    res = drive.record_story(repo, small_run(repo), MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] and res["pushed"] and "no private checkout" in res["private"]["skipped"]


def test_E4_a_failed_private_push_is_reported_and_the_next_record_pushes_it(tmp_path):
    private = private_suite(tmp_path)
    repo, _ = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / "stories/01/accept.json", STORY_1)
    (tmp_path / "private.git").rename(tmp_path / "away.git")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=private)
    assert res["committed"] and res["pushed"], res                                # the public record is not held up
    assert res["private"]["committed"] and not res["private"]["pushed"] and res["private"]["error"]
    (tmp_path / "away.git").rename(tmp_path / "private.git")
    res = drive.record_story(repo, run, "story 3 done", git=G, private=private)
    assert res["private"] == {"copied": 0, "committed": False, "pushed": True}
    assert "stories/01/accept.json" in git(tmp_path / "private", "ls-tree", "-r", "--name-only", "origin/main")


def _here_and_private(tmp_path: Path) -> tuple[Path, Path]:
    """A run in a checkout, and a private repo whose copy of it holds detail the run doesn't."""
    repo = tmp_path / "public"
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    run = repo / RUN_REL
    run.mkdir(parents=True)
    private = tmp_path / "private"
    return run, private


def test_E5_find_takes_the_machines_copy_then_the_private_repos_then_none(tmp_path):
    run, private = _here_and_private(tmp_path)
    copy = write(private / "runs" / RUN_REL / "stories/01/accept.json", STORY_2)
    assert heldout.find(run, "stories/01/accept.json", private) == copy
    local = write(run / "stories/01/accept.json", STORY_1)
    assert heldout.find(run, "stories/01/accept.json", private) == local
    assert heldout.find(run, "stories/09/accept.json", private) is None
    assert heldout.find(tmp_path / "not-in-a-checkout", "accept.json", private) is None


def test_E6_counts_come_from_the_summary_where_the_detail_is_nowhere(tmp_path):
    run, private = _here_and_private(tmp_path)
    write(run / "stories/01/accept-summary.json", pub.summarise_accept(STORY_1))
    assert heldout.accept_or_summary(run, "stories/01/accept.json", private) == pub.summarise_accept(STORY_1)
    write(private / "runs" / RUN_REL / "stories/01/accept.json", STORY_1)
    assert heldout.accept_or_summary(run, "stories/01/accept.json", private) == STORY_1
    assert heldout.accept_or_summary(run, "gate.json", private) is None


def test_E7_on_a_clone_without_the_detail_the_tools_read_the_private_copy(recorded, tmp_path, monkeypatch):
    """The Mac: its run directory comes from git, so every held-out result is only in the private repo's copy."""
    import judge
    mac = tmp_path / "mac"
    subprocess.run(["git", "clone", "-q", str(recorded.remote), str(mac)], check=True)
    run = mac / RUN_REL
    assert not (run / "stories/01/accept.json").exists()
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(recorded.private))
    assert heldout.load_metrics(run) == full_metrics()
    assert history.per_story(run) == history.per_story(recorded.run)
    assert TITLE in history.render(run) and TITLE in report.summary(run)
    assert judge.last_accept(run) == recorded.private / "runs" / RUN_REL / "accept-final.json"
    assert judge.scorer_fault(judge.last_accept(run)) is None


def test_E8_judge_prep_and_annotate_take_the_results_from_the_private_copy(tmp_path, monkeypatch):
    import annotate
    import judge_prep
    run, private = _here_and_private(tmp_path)
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(private))
    ws = run / "workspace"
    ws.mkdir()
    git(ws, "init", "-q")
    git(ws, "commit", "-q", "--allow-empty", "-m", "base")
    write(run / "stories/01/gate.json", {"all_green": True})
    write(run / "stories/01" / annotate.EVENTS, gzip.compress(json.dumps({"type": "session"}).encode() + b"\n"))
    write(private / "runs" / RUN_REL / "stories/01/accept.json", STORY_1)
    write(private / "runs" / RUN_REL / "stories/01/screenshots/a.png", b"\x89PNG")
    judge_prep.copy_run(run, tmp_path / "bundle")
    assert json.loads((tmp_path / "bundle/stories/01/accept.json").read_text()) == STORY_1
    assert (tmp_path / "bundle/stories/01/screenshots/a.png").exists()
    attempt = annotate.build_attempt(run, run.parents[5], run / "stories/01", {"stories": {"1": {"title": "S"}}}, "")
    assert [f["title"] for f in attempt["behaviour"]["failed"]] == [f"{OTHER} {ANCHOR}"]


def test_E9_baselines_use_the_summaries_and_their_harness_fault(tmp_path):
    import progress
    runs = tmp_path / "combinations/some/stack/benchmarks/vidi"
    story = {"3": {"finished": 1, "accept": {"by_story": {"03": {"passed": 0, "total": 7}}}}}
    write(runs / "void/metrics.json", {"stories": story})
    write(runs / "void/stories/03/accept-summary.json", {"harness_fault": "missing resources: no browser"})
    write(runs / "fine/metrics.json", {"stories": story})
    write(runs / "fine/stories/03/accept-summary.json", {"harness_fault": None, "passed": 0, "total": 7})
    ref = tmp_path / "benchmarks/reference/vidi/opus-5.5/run-1"
    write(ref / "metrics.json", {"stories": {"3": {"finished": 1}}})
    write(ref / "accept-summary.json", {"by_story": {"03": {"passed": 7, "total": 7}}})
    got = {b["source"]: b["accept"] for b in progress.baselines(tmp_path, 3, tmp_path / "elsewhere")}
    assert got == {"some/stack fine": {"passed": 0, "total": 7}, "some/stack void": None,
                   "reference opus-5.5 run-1": {"passed": 7, "total": 7}}


# ---------- F. every writer of results goes through the same path ----------

def test_F1_a_rescore_writes_each_result_with_its_summary(tmp_path, monkeypatch):
    import gates
    import rescore
    base = tmp_path / "base"
    base.mkdir()
    git(base, "init", "-q")
    git(base, "commit", "-q", "--allow-empty", "-m", "story 2")
    commit = git(base, "rev-parse", "HEAD").strip()
    monkeypatch.setenv("ACCEPT_PORT", "0")                    # _score_one sets it; restored after the test
    monkeypatch.setattr(drive, "set_pack", lambda pack: None)
    monkeypatch.setattr(drive, "kill_strays", lambda ws: None)
    scorings = iter([STORY_2, result([t(TITLE, "passed"), t(OTHER, "passed"), t(OWN_TITLE, "passed", story=2)]), STORY_2])
    monkeypatch.setattr(gates, "accept", lambda *a, **k: json.loads(json.dumps(next(scorings))))
    out = tmp_path / "rescore" / VERSION
    rescore._score_one({"story": 2, "commit": commit, "processed": [{"id": 1, "status": "DONE"}, {"id": 2, "status": "DONE"}]},
                       str(base), str(tmp_path), str(out), 0, "benchmarks/vidi")
    full = json.loads((out / "stories/02/accept.json").read_text())
    assert full["flaky"] == [f"story-01.spec.ts: {TITLE} {ANCHOR}"]
    assert json.loads((out / "stories/02/accept-summary.json").read_text()) == pub.summarise_accept(full)


def test_F2_gates_accept_from_the_command_line_writes_the_summary(tmp_path, monkeypatch):
    import sys
    import gates
    monkeypatch.setattr(gates, "accept", lambda *a, **k: STORY_1)
    monkeypatch.setattr(sys, "argv", ["gates.py", "accept", str(tmp_path), "--done", "1", "--out", str(tmp_path / "out")])
    gates.main()
    assert json.loads((tmp_path / "out/accept.json").read_text()) == STORY_1
    assert json.loads((tmp_path / "out/accept-summary.json").read_text()) == pub.summarise_accept(STORY_1)


def test_F3_finalize_records_its_rescore_through_the_gate(tmp_path):
    import finalize
    from test_finalize import workspace_with_history
    private = private_suite(tmp_path)
    repo, remote = cloned(tmp_path, "public")
    run = small_run(repo)
    write(run / "work_dir.txt", str(workspace_with_history(tmp_path)))

    def rescore(run: Path, bundle: Path, version: str) -> None:     # as an older rescore.py wrote it: no summary
        write(run / "rescore" / version / "stories/12/accept.json", RESCORED)
        write(run / "rescore" / version / "rescore.json", {"results": [{"story": 12, "passed": 2, "total": 3}]})

    finalize.finalize(run, VERSION, VERSION, rescore,
                      lambda message: drive.record_story(repo, run, message, git=G, private=private))
    public = git(repo, "ls-tree", "-r", "--name-only", "origin/main").split()
    assert f"{RUN_REL}/rescore/{VERSION}/stories/12/accept-summary.json" in public
    assert f"{RUN_REL}/rescore/{VERSION}/stories/12/accept.json" not in public
    assert "final score 2/3" in remote_log(remote)
    assert (private / "runs" / RUN_REL / "rescore" / VERSION / "stories/12/accept.json").exists()


def test_F4_backfill_keeps_metrics_public_and_the_detail_beside_it(tmp_path, monkeypatch):
    import backfill_timing
    import conversation
    (tmp_path / "metrics.json").write_text(json.dumps({"stories": {
        "1": {**story_record(1, STORY_1, "aaaa"), "started": 1, "agent_finished": 2}}}))   # a pre-gate record
    write(tmp_path / "stories/01/agent-events.jsonl", "{}\n")
    monkeypatch.setattr(conversation, "profile", lambda *a: {"calls": 1})
    assert backfill_timing.backfill_conversation(tmp_path) == ["1"]
    assert "runner_tail" not in (tmp_path / "metrics.json").read_text()
    assert pub.leaks_in_file(f"{RUN_REL}/metrics.json", (tmp_path / "metrics.json").read_text(), {TITLE}) == []
    assert heldout.load_metrics(tmp_path)["stories"]["1"]["accept"]["runner_tail"] == STORY_1["runner_tail"]
    assert heldout.load_metrics(tmp_path)["stories"]["1"]["conversation"] == {"calls": 1}


# ---------- G. end to end ----------

def test_G1_the_whole_run_is_recorded_and_pushed(recorded):
    assert recorded.res["committed"] and recorded.res["pushed"], recorded.res
    assert MESSAGE in remote_log(recorded.remote)


def test_G2_nothing_pushed_is_private_and_nothing_pushed_leaks(recorded):
    """git ls-files of the public repo, after a whole run: no private path, and no file carrying a held-out title."""
    run_files = [f for f in recorded.public if f.startswith(RUN_REL + "/")]
    assert len(run_files) > len(OWN_KINDS)
    assert [f for f in run_files if pub.is_private(f)] == []
    leaking = {f: pub.leaks_in_file(f, heldout._text(f, recorded.blob(f)), recorded.fps) for f in run_files}
    assert {f: v for f, v in leaking.items() if v} == {}


# ---------- H. records written before the gate are made public before they are staged ----------

def test_H1_a_full_metrics_copy_anywhere_in_the_run_is_split_and_its_detail_wins(tmp_path):
    """reference run-2 had one: rescore/vidi-v1.3.2/metrics.json, copied whole by rescore.py before the split."""
    rs = tmp_path / "rescore" / VERSION
    write(rs / "metrics.json", full_metrics())
    write(rs / pub.HELDOUT_DETAIL, {"stories": {"1": {"accept": {"runner_tail": "older"}}, "7": {"accept": {"x": 1}}}})
    changed = heldout.make_public(tmp_path)
    assert changed["metrics"] == [f"rescore/{VERSION}/metrics.json"]
    assert "runner_tail" not in (rs / "metrics.json").read_text()
    kept = json.loads((rs / pub.HELDOUT_DETAIL).read_text())["stories"]
    assert kept["1"]["accept"]["runner_tail"] == STORY_1["runner_tail"] and kept["7"] == {"accept": {"x": 1}}
    assert heldout.make_public(tmp_path)["metrics"] == []                 # idempotent


def test_H2_a_summary_with_titles_is_redacted_and_its_full_form_kept(tmp_path):
    text = f"- story 1: 2/2 → 1/2; broke 1: “{TITLE}”. Most common error: `{ERROR.splitlines()[0]}`\n"
    write(tmp_path / "summary.md", text)
    assert heldout.make_public(tmp_path)["reports"] == ["summary.md"]
    assert (tmp_path / "summary.md").read_text() == "- story 1: 2/2 → 1/2; broke 1.\n"
    assert (tmp_path / pub.SUMMARY_DETAIL).read_text() == text
    assert heldout.make_public(tmp_path)["reports"] == []


def test_H3_an_old_run_record_is_committed_after_being_made_public(tmp_path):
    private = private_suite(tmp_path)
    repo, _ = cloned(tmp_path, "public")
    run = repo / RUN_REL
    write(run / "metrics.json", full_metrics())                                    # as the old harness wrote them
    write(run / f"rescore/{VERSION}/metrics.json", full_metrics())
    write(run / "summary.md", f"- story 1: 2/2 → 1/2; broke 1: “{TITLE}”\n")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=private)
    assert res["committed"] and res["pushed"], res
