"""drive.py's recording path when git says no, pinned branch by branch before the story loop is rebuilt (CLAUDE.md,
"Refactor DELETE FIRST").

What a record returns and leaves behind when a step of it fails: the public commit (record_story), the push and
the replay onto a remote that moved (push_with_rebase, replay_onto_remote, _merged_tree), and the private copy
(record_private, _private_commit). The repositories are real ones in tmp_path with bare remotes beside them. Where
a failure can't be produced by the repositories' own state, git is a wrapper that refuses the named command on the
named calls and is real git for everything else. The paths that succeed are test_drive.py's and
test_publish_gate.py's; a few are repeated here so that each function's outcomes are side by side.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

import drive
import heldout
import publicise
import roots
import test_publish_gate as pg

G = pg.G
git = pg.git
MESSAGE = pg.MESSAGE
ACCEPT = "stories/01/accept.json"           # a private file of the run (publicise.is_private)

FAKE_GIT = r"""#!/bin/sh
# Real git, except that a command starting with a pattern in rules fails on the calls its rule lists.
dir="@DIR@"
all="$*"
printf '%s\n' "$all" | head -1 >> "$dir/calls.log"
tab="$(printf '\t')"
i=0
while IFS="$tab" read -r calls pattern; do
  i=$((i + 1))
  case "$all" in
    $pattern*)
      n=$(( $(cat "$dir/count-$i" 2>/dev/null || echo 0) + 1 ))
      echo "$n" > "$dir/count-$i"
      for want in $calls; do
        if [ "$want" = all ] || [ "$want" = "$n" ]; then
          echo "fake git: $pattern refused (call $n)" >&2
          exit 1
        fi
      done ;;
  esac
done < "$dir/rules"
exec git -c user.name=t -c user.email=t@t "$@"
"""


class FakeGit:
    """git for drive's `git` argument: real, but refusing what refuse() names."""

    def __init__(self, home: Path):
        home.mkdir()
        self.home = home
        script = home / "git"
        script.write_text(FAKE_GIT.replace("@DIR@", str(home)))
        script.chmod(0o755)
        (home / "rules").write_text("")
        self.cmd = [str(script)]

    def refuse(self, pattern: str, *calls: int) -> "FakeGit":
        """Fail every call (or only the numbered ones) of a command line that starts with pattern."""
        with (self.home / "rules").open("a") as f:
            f.write(f"{' '.join(map(str, calls)) or 'all'}\t{pattern}\n")
        return self

    def refusal(self, pattern: str, call: int = 1) -> str:
        return f"fake git: {pattern} refused (call {call})\n"

    def calls(self, command: str) -> list[str]:
        log = self.home / "calls.log"
        return [l for l in (log.read_text().splitlines() if log.exists() else []) if l.split(" ")[0] == command]


@pytest.fixture
def fake(tmp_path) -> FakeGit:
    return FakeGit(tmp_path / "fake-git")


def head(repo: Path, ref: str = "HEAD") -> str:
    return git(repo, "rev-parse", ref).strip()


def remote_head(remote: Path) -> str:
    return subprocess.run(["git", "--git-dir", str(remote), "rev-parse", "main"], capture_output=True, text=True).stdout.strip()


def commit(repo: Path, rel: str, text: str, message: str) -> str:
    pg.write(repo / rel, text)
    git(repo, "add", "--", rel)
    git(repo, "commit", "-qm", message)
    return head(repo)


def move_remote(root: Path, remote: Path, rel: str = "elsewhere.md", text: str = "someone else's") -> str:
    """Another checkout commits and pushes: the remote is now ahead of the first."""
    other = root / f"other-{len(list(root.glob('other-*')))}"
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True, capture_output=True)
    sha = commit(other, rel, text, f"other: {rel}")
    git(other, "push", "-q", "origin", "HEAD:main")
    return sha


# ======================= record_story =======================

def test_a_record_that_cannot_be_staged_commits_nothing_and_says_why(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    before = head(repo)
    res = drive.record_story(repo, run, MESSAGE, git=fake.refuse("add").cmd, private=tmp_path / "none")
    assert res == {"committed": False, "pushed": False, "over_size_limit": [],
                   "private": {"skipped": f"no private checkout at {tmp_path / 'none'}"}, "error": fake.refusal("add")}
    assert head(repo) == before == remote_head(remote)
    assert git(repo, "status", "--porcelain").split() == ["??", "combinations/"]       # the checkout's index is untouched
    assert (run / ".gitignore").read_text() == drive.RUN_GITIGNORE                     # the run was still made publishable


def test_a_record_whose_commit_fails_is_not_pushed_and_says_why(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    before = head(repo)
    res = drive.record_story(repo, run, MESSAGE, git=fake.refuse("commit -q").cmd, private=tmp_path / "none")
    assert res["committed"] is False and res["pushed"] is False and res["error"] == fake.refusal("commit -q")
    assert "commit" not in res and head(repo) == before == remote_head(remote) and fake.calls("push") == []


def test_a_record_is_one_commit_of_the_run_with_the_trailer_and_the_checkout_s_index_caught_up(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    pg.write(repo / "staged-by-someone.md", "another process's staged work")
    git(repo, "add", "staged-by-someone.md")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res == {"committed": True, "pushed": True, "over_size_limit": [], "commit": git(repo, "rev-parse", "--short", "HEAD").strip(),
                   "private": {"skipped": f"no private checkout at {tmp_path / 'none'}"}}
    assert remote_head(remote) == head(repo)
    assert git(repo, "log", "-1", "--format=%B").strip() == MESSAGE + drive.COMMIT_TRAILER
    committed = git(repo, "show", "--name-only", "--format=", "HEAD").split()
    assert committed and all(f.startswith(pg.RUN_REL + "/") for f in committed)
    assert git(repo, "status", "--porcelain").strip() == "A  staged-by-someone.md"     # still staged, still not committed


def test_the_first_record_in_a_repository_with_no_commit_yet_is_its_first_commit(tmp_path):
    remote, repo = tmp_path / "empty.git", tmp_path / "empty"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True, capture_output=True)
    run = pg.small_run(repo)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True and res["pushed"] is True
    assert git(repo, "rev-list", "--count", "HEAD").strip() == "1" and remote_head(remote) == head(repo)


def test_a_rebase_left_by_a_killed_harness_is_aborted_before_the_record_and_reported(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    (repo / ".git" / "rebase-merge").mkdir()
    res = drive.record_story(repo, run, MESSAGE, git=fake.cmd, private=tmp_path / "none")
    assert res["recovered"] == "aborted a rebase left in progress by an earlier run"
    assert fake.calls("rebase") == ["rebase --abort"]
    assert res["committed"] is True and res["pushed"] is True and remote_head(remote) == head(repo)


def test_a_record_with_no_rebase_in_progress_aborts_none_and_reports_no_recovery(tmp_path, fake):
    repo, _ = pg.cloned(tmp_path, "public")
    res = drive.record_story(repo, pg.small_run(repo), MESSAGE, git=fake.cmd, private=tmp_path / "none")
    assert "recovered" not in res and fake.calls("rebase") == [] and res["committed"] is True
    assert "untracked_private" not in res and "refused" not in res


def test_a_record_drops_the_private_files_an_older_harness_committed_and_counts_them(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    pg.write(run / ACCEPT, json.dumps(pg.STORY_1))
    git(repo, "add", "-f", "--", pg.RUN_REL)
    git(repo, "commit", "-qm", "an older harness's record, private files and all")
    private = [f"{pg.RUN_REL}/{f}" for f in heldout.private_files(run, repo)]
    assert set(private) <= set(git(repo, "ls-tree", "-r", "--name-only", "HEAD").split())
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["untracked_private"] == len(private) and res["committed"] is True and res["pushed"] is True
    assert not set(private) & set(git(repo, "ls-tree", "-r", "--name-only", "HEAD").split())
    assert all((repo / f).exists() for f in private)                                   # still on the machine


def test_a_record_carrying_held_out_detail_is_refused_whole_and_goes_through_once_it_is_clean(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    before = head(repo)
    pg.write(run / "notes.md", f"the test is called: something {pg.ANCHOR}\n")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is False and res["pushed"] is False and "commit" not in res
    assert [r["file"] for r in res["refused"]] == [f"{pg.RUN_REL}/notes.md"]
    assert res["error"].startswith("not committed: 1 staged file(s) must not be public: ")
    assert pg.ANCHOR not in json.dumps(res)
    assert (run / publicise.PUBLISH_REFUSED).exists() and head(repo) == before == remote_head(remote)
    (run / "notes.md").write_text("nothing held out\n")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True and res["pushed"] is True and "refused" not in res
    assert not (run / publicise.PUBLISH_REFUSED).exists()


# ---------- credentials in what is published (credentials.py) ----------

import gzip                                                                 # noqa: E402
import test_credentials as tc                                               # noqa: E402  (its made-up values and real lines)

FAKE_GITHUB_TOKEN = "gh" + "p_" + tc.ALNUM + "0123"
LOG = "stories/01/agent-events.compact.jsonl.gz"
RAW_LOG = "stories/01/agent-events.jsonl"                                   # the full log: git-ignored, never published


def run_with_credentials(repo: Path) -> Path:
    """A run whose agent printed its environment: the values are in its log, an intervention, its gate's output
    and a file of its mirrored workspace."""
    run = pg.small_run(repo)
    events = [json.dumps({"_rx": 1.0, "type": "session", "id": "s"}),
              json.dumps({"_rx": 2.0, "type": "tool_execution_end", "result": tc.ENV_OUTPUT})]
    pg.write(run / RAW_LOG, "\n".join(events) + "\n")
    (run / LOG).write_bytes(gzip.compress(("\n".join(events) + "\n").encode()))
    pg.write(run / "interventions.md", f"# Interventions\n\n- story 1: stray process: {tc.PGREP_LINE}")
    pg.write(run / "stories/01/gate.json", {"steps": {"build": {"exit": 1, "tail": f"Authorization: Bearer {tc.ALNUM}"}}})
    pg.write(run / "workspace/deploy.sh", f"git push https://x:{FAKE_GITHUB_TOKEN}@example.invalid/o/r.git\n")
    return run


def published(repo: Path, rel: str) -> str:
    blob = subprocess.run(["git", "show", f"HEAD:{pg.RUN_REL}/{rel}"], cwd=repo, capture_output=True, check=True).stdout
    return (gzip.decompress(blob) if rel.endswith(".gz") else blob).decode()


def test_a_credential_in_anything_staged_is_redacted_before_the_commit_and_named_in_the_record(tmp_path, capsys):
    repo, remote = pg.cloned(tmp_path, "public")
    run = run_with_credentials(repo)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True and res["pushed"] is True
    names = ["Bearer token", "CLAUDE_CODE_MESSAGING_TOKEN", "DEEPSEEK_API_KEY", "GitHub token"]
    assert res["credentials_redacted"] == {"count": 4, "names": names}
    everything = "".join(published(repo, f) for f in git(repo, "ls-tree", "-r", "--name-only", "HEAD", "--", pg.RUN_REL)
                         .replace(pg.RUN_REL + "/", "").split())
    for value in (tc.FAKE_DEEPSEEK, tc.FAKE_SESSION_TOKEN, tc.ALNUM, FAKE_GITHUB_TOKEN):
        assert value not in everything and value not in json.dumps(res)
    log = published(repo, LOG).splitlines()
    assert log[0] == json.dumps({"_rx": 1.0, "type": "session", "id": "s"})
    assert json.loads(log[1])["result"] == tc.ENV_OUTPUT.replace(tc.FAKE_DEEPSEEK, "[redacted: 35 characters]")
    assert "CLAUDE_CODE_MESSAGING_TOKEN=[redacted: 32 characters]" in published(repo, "interventions.md")
    assert json.loads(published(repo, "stories/01/gate.json"))["steps"]["build"]["tail"] == "Authorization: Bearer [redacted Bearer token: 32 characters]"
    assert "[redacted GitHub token: 40 characters]" in published(repo, "workspace/deploy.sh")
    assert tc.FAKE_DEEPSEEK in (run / RAW_LOG).read_text()                  # the full log on the machine is as it was
    assert git(repo, "status", "--porcelain").strip() == ""                 # what is on disk is what was committed
    out = capsys.readouterr().out
    assert out.count(f"record: 4 credential(s) redacted from what is published: {', '.join(names)}\n") == 1
    for value in (tc.FAKE_DEEPSEEK, tc.FAKE_SESSION_TOKEN, tc.ALNUM, FAKE_GITHUB_TOKEN):
        assert value not in out
    # Recorded again with nothing new: nothing is found, and nothing is said.
    pg.write(run / "notes.md", "a later story\n")
    again = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert again["committed"] is True and "credentials_redacted" not in again
    assert "credential" not in capsys.readouterr().out


def test_a_record_with_no_credential_publishes_its_log_byte_for_byte_and_records_nothing_about_it(tmp_path):
    repo, _ = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    packed = gzip.compress(b'{"_rx":1.0,"type":"session","id":"s"}\n{"_rx":2.0,"type":"message_end","max_tokens":4096}\n')
    pg.write(run / LOG, packed)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True and "credentials_redacted" not in res
    assert subprocess.run(["git", "show", f"HEAD:{pg.RUN_REL}/{LOG}"], cwd=repo, capture_output=True).stdout == packed


@pytest.mark.parametrize("refused, call", [("diff --cached --name-only", 1), ("add --", 2)])
def test_a_scan_that_cannot_be_done_commits_nothing(tmp_path, fake, refused, call):
    """Fails closed: where the staged files can't be listed, or a redacted file can't be staged again, the commit
    is refused, like one the held-out check couldn't read."""
    repo, remote = pg.cloned(tmp_path, "public")
    run = run_with_credentials(repo)
    before = head(repo)
    res = drive.record_story(repo, run, MESSAGE, git=fake.refuse(refused, call).cmd, private=tmp_path / "none")
    assert res["committed"] is False and res["pushed"] is False and head(repo) == before == remote_head(remote)
    assert [r["why"].split(":")[0] for r in res["refused"]] == [heldout.CHECK_FAILED]
    assert tc.FAKE_DEEPSEEK not in json.dumps(res)


def test_a_record_names_the_public_files_over_their_size_limit_and_not_the_private_ones(tmp_path, monkeypatch):
    repo, _ = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    pg.write(run / "notes.md", "n" * 200)
    pg.write(run / ACCEPT, json.dumps({**pg.STORY_1, "padding": "p" * 5000}))
    limit = publicise.size_limit
    monkeypatch.setattr(publicise, "size_limit", lambda rel: 100 if rel.endswith(("notes.md", "accept.json")) else limit(rel))
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["over_size_limit"] == [str(run / "notes.md")] and res["committed"] is True


def test_a_run_outside_the_results_root_is_not_recorded(tmp_path, capsys):
    repo, _ = pg.cloned(tmp_path, "public")
    elsewhere = tmp_path / "elsewhere" / "run"
    elsewhere.mkdir(parents=True)
    for run in (elsewhere, repo):
        res = drive.record_story(repo, run, MESSAGE, git=G)
        assert res == {"committed": False, "pushed": False, "error": "not recorded: the run's directory is not inside the results root"}
        assert not (run / ".gitignore").exists()                                       # nothing written, nothing staged
    err = capsys.readouterr().err
    assert f"record: NOT RECORDED, the run's directory is not inside the results root: run {elsewhere.resolve()}, results root {repo.resolve()}" in err


@pytest.mark.parametrize("root_is", ["inside a checkout", "not a checkout", "not a directory"])
def test_a_results_root_that_is_not_the_top_of_a_checkout_is_not_recorded_in(tmp_path, root_is):
    repo, _ = pg.cloned(tmp_path, "public")
    root = {"inside a checkout": repo / "nested", "not a checkout": tmp_path / "plain", "not a directory": tmp_path / "absent"}[root_is]
    run = root / "run"
    if root_is != "not a directory":
        run.mkdir(parents=True)
    assert drive.record_refusal(root, run, G) == "the results root is not the top of a git checkout"
    assert drive.record_refusal(repo, repo / "any" / "run", G) is None                # the checkout's top may be recorded in


def test_a_checkout_named_off_limits_or_inside_one_is_not_recorded_in(tmp_path, monkeypatch):
    repo, _ = pg.cloned(tmp_path, "public")
    monkeypatch.setenv(roots.NO_RECORD_ENV, str(tmp_path))                            # the repo is inside it
    why = drive.record_refusal(repo, repo / "run", G)
    assert why == f"records may not be committed in this checkout in this process (${roots.NO_RECORD_ENV})"
    monkeypatch.setenv(roots.NO_RECORD_ENV, str(repo))
    assert drive.record_refusal(repo, repo / "run", G) == why


@pytest.mark.parametrize("sandbox_record, refused", [
    ({"mode": "permissive"}, True),                                                   # no sandbox at all: it cannot publish
    ({"mode": "enforced", "version": "0.2.0", "platform": "linux-x86_64", "policy_hash": "ab" * 32}, False),
    (None, False),                                                                    # written before the sandbox was recorded
])
def test_a_run_whose_agent_had_no_sandbox_is_not_recorded(tmp_path, sandbox_record, refused):
    repo, _ = pg.cloned(tmp_path, "public")
    run = repo / "combinations" / "x" / "benchmarks" / "vidi" / "r1"
    run.mkdir(parents=True)
    (run / "run.json").write_text(json.dumps({"client": "pi", **({"sandbox": sandbox_record} if sandbox_record else {})}))
    why = drive.record_refusal(repo, run, G)
    assert why == ("the run's agent was not in the sandbox (SPEC_BENCH_SANDBOX=permissive)" if refused else None)
    if refused:
        assert drive.record_story(repo, run, MESSAGE, git=G) == {"committed": False, "pushed": False, "error": f"not recorded: {why}"}


@pytest.mark.parametrize("text", [None, "{not json", "[]", '{"sandbox": "permissive"}'])
def test_a_run_json_that_is_missing_or_unreadable_does_not_make_a_run_a_permissive_one(tmp_path, text):
    run = tmp_path / "run"
    run.mkdir()
    if text is not None:
        (run / "run.json").write_text(text)
    assert drive._ran_without_sandbox(run) is False


def test_a_rebase_in_progress_is_found_under_either_of_git_s_names(tmp_path):
    repo, _ = pg.cloned(tmp_path, "public")
    assert drive._rebase_in_progress(repo, G) is False
    for name in ("rebase-merge", "rebase-apply"):
        (repo / ".git" / name).mkdir()
        assert drive._rebase_in_progress(repo, G) is True
        (repo / ".git" / name).rmdir()
    assert drive._rebase_in_progress(tmp_path, G) is False                            # not a repository: none in progress


def test_private_files_an_older_harness_committed_are_dropped_from_the_index_and_kept_on_disk(tmp_path):
    repo, _ = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    pg.write(run / ACCEPT, json.dumps(pg.STORY_1))
    git(repo, "add", "-f", "--", pg.RUN_REL)
    private = sorted(f"{pg.RUN_REL}/{f}" for f in heldout.private_files(run, repo))
    assert f"{pg.RUN_REL}/{ACCEPT}" in private
    assert sorted(drive.untrack_private(repo, pg.RUN_REL, G)) == private
    tracked = git(repo, "ls-files", "--", pg.RUN_REL).split()
    assert not set(private) & set(tracked) and f"{pg.RUN_REL}/run.json" in tracked
    assert all((repo / f).exists() for f in private)
    assert drive.untrack_private(repo, pg.RUN_REL, G) == []                           # nothing private tracked: nothing to do


def test_a_refused_commit_keeps_what_was_found_privately_and_returns_only_digests(tmp_path, capsys):
    problems = [{"file": f"run/f{n}.md", "why": "held-out title", "fingerprint": f"a secret title {n}"} for n in (1, 2)]
    problems += [{"file": "run/f1.md", "why": "held-out title", "fingerprint": "another secret"},
                 {"file": "run/accept.json", "why": "private file", "fingerprint": None}]
    res = drive.refuse(tmp_path, problems)
    kept = json.loads((tmp_path / publicise.PUBLISH_REFUSED).read_text())
    assert kept["problems"] == problems and isinstance(kept["at"], float)
    digests = [heldout.digest(p["fingerprint"]) if p["fingerprint"] else None for p in problems]
    assert res["refused"] == [{"file": p["file"], "why": p["why"], "fingerprint": d} for p, d in zip(problems, digests)]
    assert res["error"] == (f"not committed: 3 staged file(s) must not be public: run/f1.md (held-out title {digests[0]}), "
                            f"run/f2.md (held-out title {digests[1]}), run/f1.md (held-out title {digests[2]}) …; "
                            f"see {publicise.PUBLISH_REFUSED}")
    assert "secret" not in json.dumps(res)
    out = capsys.readouterr().out.splitlines()
    assert out == ["record: NOT COMMITTED, held-out title in run/f1.md: a secret title 1",
                   "record: NOT COMMITTED, held-out title in run/f2.md: a secret title 2",
                   "record: NOT COMMITTED, held-out title in run/f1.md: another secret",
                   "record: NOT COMMITTED, private file in run/accept.json"]


def test_a_refusal_of_few_problems_names_them_all_and_masks_a_machine_name(tmp_path):
    res = drive.refuse(tmp_path, [{"file": "run/made-up-box/log.txt", "why": "private file", "fingerprint": None}],
                       names={"made-up-box"})
    assert res["refused"] == [{"file": "run/<machine name>/log.txt", "why": "private file", "fingerprint": None}]
    assert res["error"] == (f"not committed: 1 staged file(s) must not be public: run/<machine name>/log.txt (private file); "
                            f"see {publicise.PUBLISH_REFUSED}")


# ======================= push_with_rebase =======================

def test_a_push_the_remote_takes_is_just_pushed(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    sha = commit(repo, "run/metrics.json", "{}", "story 1 done")
    assert drive.push_with_rebase(repo, G) == {"pushed": True}
    assert remote_head(remote) == sha


def test_a_push_refused_before_and_after_the_replay_leaves_the_commit_local_and_says_why(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    before = remote_head(remote)
    commit(repo, "run/metrics.json", "{}", "story 1 done")
    res = drive.push_with_rebase(repo, fake.refuse("push").cmd)
    assert res == {"pushed": False, "unpushed": True, "error": fake.refusal("push", 2)}
    assert len(fake.calls("push")) == 2 and len(fake.calls("fetch")) == 1              # once, the replay, once more: no loop
    assert remote_head(remote) == before
    assert git(repo, "log", "-1", "--format=%s").strip() == "story 1 done" and git(repo, "status", "--porcelain") == ""


def test_a_push_that_cannot_be_replayed_is_reported_with_the_replay_s_reason(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    sha = commit(repo, "run/metrics.json", "{}", "story 1 done")
    res = drive.push_with_rebase(repo, fake.refuse("push").refuse("fetch").cmd)
    assert res == {"pushed": False, "unpushed": True, "error": "fetch failed: " + fake.refusal("fetch")}
    assert len(fake.calls("push")) == 1 and head(repo) == sha                          # no second push without a replay


def test_a_push_after_the_remote_moved_replays_and_pushes(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    theirs = move_remote(tmp_path, remote)
    commit(repo, "run/metrics.json", "{}", "story 1 done")
    assert drive.push_with_rebase(repo, G) == {"pushed": True}
    assert remote_head(remote) == head(repo) and head(repo, "HEAD~1") == theirs


def test_a_push_blocked_by_an_uncommitted_edit_still_publishes_and_leaves_the_checkout_as_it_is(tmp_path):
    """The M5 Max, 4 Oct 2026: an old record had an uncommitted edit, main changed that file, and the replay's
    checkout move refused, so fourteen story commits stayed local for twenty hours. The replayed commits are pushed
    whether or not the checkout can move; the checkout and its uncommitted edit are left exactly as they were."""
    repo, remote = pg.cloned(tmp_path, "public")
    theirs = move_remote(tmp_path, remote)                                            # the remote changed elsewhere.md
    pg.write(repo / "elsewhere.md", "someone's uncommitted edit")                       # which has an uncommitted edit here
    mine = commit(repo, "run/metrics.json", "{}", "story 1 done")
    res = drive.push_with_rebase(repo, G)
    assert res["pushed"] is True and "unpushed" not in res
    assert res["checkout_behind"] == ["elsewhere.md"]
    assert git(remote, "log", "--format=%s", "main").split("\n")[:2] == ["story 1 done", "other: elsewhere.md"]   # published, on the remote's tip
    assert head(repo) == mine and (repo / "elsewhere.md").read_text() == "someone's uncommitted edit"            # nothing here moved
    assert git(repo, "status", "--porcelain").strip() == "?? elsewhere.md"                                        # the remote's file would overwrite it


def test_the_next_record_after_a_blocked_checkout_pushes_only_what_is_new(tmp_path):
    """The checkout still holds the commits the remote already has copies of: replaying those again changes
    nothing and makes no commit, so the remote gets each story once."""
    repo, remote = pg.cloned(tmp_path, "public")
    move_remote(tmp_path, remote)
    pg.write(repo / "elsewhere.md", "someone's uncommitted edit")
    commit(repo, "run/metrics.json", "{}", "story 1 done")
    assert drive.push_with_rebase(repo, G)["pushed"] is True
    commit(repo, "run/stories/02/x.json", "{}", "story 2 done")
    res = drive.push_with_rebase(repo, G)
    assert res["pushed"] is True and res["checkout_behind"] == ["elsewhere.md"]
    assert git(remote, "log", "--format=%s", "main").split("\n")[:3] == ["story 2 done", "story 1 done", "other: elsewhere.md"]


# ======================= replay_onto_remote =======================

def test_a_detached_checkout_has_no_branch_to_replay(tmp_path):
    repo, _ = pg.cloned(tmp_path, "public")
    git(repo, "checkout", "-q", "--detach")
    assert drive.replay_onto_remote(repo, G) == {
        "error": "the checkout is not on a branch, so there is nothing to replay onto the remote's"}


def test_a_checkout_whose_remote_cannot_be_fetched_is_not_replayed(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    sha = commit(repo, "run/metrics.json", "{}", "story 1 done")
    remote.rename(tmp_path / "away.git")
    res = drive.replay_onto_remote(repo, G)
    assert list(res) == ["error"] and res["error"].startswith("fetch failed: ") and len(res["error"]) > len("fetch failed: ")
    assert head(repo) == sha


def test_our_commits_are_made_again_on_the_remote_s_with_their_authors_dates_and_messages(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    theirs = move_remote(tmp_path, remote)
    env = {"GIT_AUTHOR_NAME": "First Author", "GIT_AUTHOR_EMAIL": "first@example.invalid", "GIT_AUTHOR_DATE": "1790000000 +0100"}
    pg.write(repo / "run/a.json", "a")
    git(repo, "add", "run/a.json")
    subprocess.run([*G, "commit", "-qm", "story 1 done\n\nwith a body"], cwd=repo, check=True, env={**os.environ, **env})
    commit(repo, "run/b.json", "b", "story 2 done")
    pg.write(repo / "uncommitted.md", "another process's edit")
    assert drive.replay_onto_remote(repo, G) == {"new": head(repo), "branch": "main"}
    assert git(repo, "log", "--format=%s").split("\n")[:3] == ["story 2 done", "story 1 done", "other: elsewhere.md"]
    assert head(repo, "HEAD~2") == theirs
    assert git(repo, "log", "-1", "--format=%an <%ae> %ad%n%B", "--date=raw", "HEAD~1").strip() == (
        "First Author <first@example.invalid> 1790000000 +0100\nstory 1 done\n\nwith a body")
    assert (repo / "elsewhere.md").read_text() == "someone else's"                     # the remote's file is checked out
    assert (repo / "uncommitted.md").read_text() == "another process's edit"
    assert git(repo, "status", "--porcelain").strip() == "?? uncommitted.md"
    assert git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip() == "main"
    assert "record: replayed onto the remote" in git(repo, "reflog", "show", "main", "-1")


def test_a_first_commit_with_no_parent_is_replayed_onto_the_remote_too(tmp_path):
    _, remote = pg.cloned(tmp_path, "public")
    theirs = remote_head(remote)
    repo = tmp_path / "fresh"
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    git(repo, "remote", "add", "origin", str(remote))
    commit(repo, "run/metrics.json", "{}", "story 1 done")
    assert drive.replay_onto_remote(repo, G) == {"new": head(repo), "branch": "main"}
    assert head(repo, "HEAD~1") == theirs and git(repo, "log", "-1", "--format=%s").strip() == "story 1 done"
    assert sorted(git(repo, "ls-files").split()) == ["README.md", "run/metrics.json"] and (repo / "README.md").exists()


def test_a_replay_with_nothing_of_ours_just_moves_to_the_remote_s(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    theirs = move_remote(tmp_path, remote)
    assert drive.replay_onto_remote(repo, G) == {"new": theirs, "branch": "main"} and head(repo) == theirs and (repo / "elsewhere.md").exists()


def test_a_commit_that_cannot_be_made_again_stops_the_replay_and_moves_nothing(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    move_remote(tmp_path, remote)
    sha = commit(repo, "run/metrics.json", "{}", "story 1 done")
    assert drive.replay_onto_remote(repo, fake.refuse("commit-tree").cmd) == {"error": fake.refusal("commit-tree")}
    assert head(repo) == sha and not (repo / "elsewhere.md").exists()


CONFLICT = ("the remote changed the same files as our commits: the story is committed locally and unpushed, and a later "
            "record pushes it once the remote no longer conflicts")


def test_a_merge_that_cannot_be_read_is_treated_as_a_conflict_and_moves_nothing(tmp_path, fake):
    repo, remote = pg.cloned(tmp_path, "public")
    move_remote(tmp_path, remote)
    sha = commit(repo, "run/metrics.json", "{}", "story 1 done")
    assert drive.replay_onto_remote(repo, fake.refuse("read-tree -m --aggressive").cmd) == {"error": CONFLICT}
    assert head(repo) == sha


def test_the_remote_changing_our_own_file_is_a_conflict_and_moves_nothing(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    move_remote(tmp_path, remote, rel="README.md", text="theirs")
    sha = commit(repo, "README.md", "ours", "story 1 done")
    assert drive.replay_onto_remote(repo, G) == {"error": CONFLICT}
    assert head(repo) == sha and (repo / "README.md").read_text() == "ours"


def test_the_remote_changing_a_file_with_uncommitted_edits_here_moves_nothing_and_names_the_file(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    move_remote(tmp_path, remote, rel="README.md", text="theirs")
    sha = commit(repo, "run/metrics.json", "{}", "story 1 done")
    pg.write(repo / "README.md", "being edited here")
    res = drive.replay_onto_remote(repo, G)
    assert res["checkout_behind"] == ["README.md"] and res["branch"] == "main"
    assert git(repo, "log", "-1", "--format=%s", res["new"]).strip() == "story 1 done"       # made, on the remote's tip, not pushed here
    assert head(repo) == sha and (repo / "README.md").read_text() == "being edited here"


# ======================= _merged_tree =======================

@pytest.fixture
def three_trees(tmp_path):
    """A repository with a base commit and two commits made from it: (repo, base, ours, theirs)."""
    repo, _ = pg.cloned(tmp_path, "public")
    base = commit(repo, "shared.md", "base", "base")

    def side(rel: str, text: str) -> str:
        git(repo, "checkout", "-q", "--detach", base)
        return commit(repo, rel, text, f"change {rel}")
    return repo, base, side


def files(repo: Path, tree: str) -> dict[str, str]:
    return {f: git(repo, "show", f"{tree}:{f}") for f in git(repo, "ls-tree", "-r", "--name-only", tree).split()}


def test_two_sides_that_changed_different_files_merge_into_one_tree(three_trees):
    repo, base, side = three_trees
    ours, theirs = side("ours.md", "ours"), side("theirs.md", "theirs")
    tree = drive._merged_tree(repo, G, base, ours, theirs)
    assert files(repo, tree) == {"README.md": "public", "shared.md": "base", "ours.md": "ours", "theirs.md": "theirs"}
    assert git(repo, "status", "--porcelain") == ""                                    # the checkout's own index was not used


def test_two_sides_that_changed_the_same_file_differently_do_not_merge(three_trees):
    repo, base, side = three_trees
    assert drive._merged_tree(repo, G, base, side("shared.md", "ours"), side("shared.md", "theirs")) is None


def test_two_sides_that_made_the_same_change_merge(three_trees):
    repo, base, side = three_trees
    tree = drive._merged_tree(repo, G, base, side("shared.md", "same"), side("shared.md", "same"))
    assert files(repo, tree)["shared.md"] == "same"


def test_trees_that_cannot_be_read_do_not_merge(three_trees):
    repo, base, side = three_trees
    assert drive._merged_tree(repo, G, "0" * 40, base, base) is None


def test_a_merge_whose_tree_cannot_be_written_is_no_merge(three_trees, fake):
    repo, base, side = three_trees
    assert drive._merged_tree(repo, fake.refuse("write-tree").cmd, base, side("a.md", "a"), side("b.md", "b")) is None


# ======================= record_private, _private_commit =======================

@pytest.fixture
def detail(tmp_path):
    """A run with one private file in a public checkout, and the private checkout beside it:
    (repo, run, private, the private remote)."""
    private = pg.private_suite(tmp_path)
    repo, _ = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    pg.write(run / ACCEPT, json.dumps(pg.STORY_1))
    return repo, run, private, tmp_path / "private.git"


DEST = f"{heldout.PRIVATE_RUNS}/{pg.RUN_REL}"


def private_remote_files(remote: Path) -> list[str]:
    return subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "main"],
                          capture_output=True, text=True, check=True).stdout.split()


def test_without_a_private_checkout_the_detail_is_not_copied(tmp_path):
    assert drive.record_private(tmp_path, tmp_path / "run", MESSAGE, tmp_path / "none", G) == {
        "skipped": f"no private checkout at {tmp_path / 'none'}"}


def test_a_run_with_no_private_files_records_nothing_privately(tmp_path, fake):
    private = pg.private_suite(tmp_path)
    repo, _ = pg.cloned(tmp_path, "public")
    run = pg.small_run(repo)
    (run / publicise.HELDOUT_DETAIL).unlink(missing_ok=True)
    for f in heldout.private_files(run, repo):
        (run / f).unlink()
    assert drive.record_private(repo, run, MESSAGE, private, fake.cmd) == {"copied": 0, "committed": False, "pushed": False}
    assert fake.calls("fetch") == [] and fake.calls("push") == []


def test_the_detail_is_committed_on_the_remote_s_main_and_pushed(detail):
    repo, run, private, remote = detail
    before, checkout_head = remote_head(remote), head(private)
    n = len(heldout.private_files(run, repo))
    assert drive.record_private(repo, run, MESSAGE, private, G) == {"copied": n, "committed": True, "pushed": True}
    assert f"{DEST}/{ACCEPT}" in private_remote_files(remote)
    assert subprocess.run(["git", "--git-dir", str(remote), "log", "-1", "--format=%P%n%B", "main"], capture_output=True,
                          text=True).stdout.strip() == f"{before}\n{MESSAGE}{drive.COMMIT_TRAILER}"
    assert head(private) == checkout_head                                              # the checkout's HEAD is left where it was
    assert drive.record_private(repo, run, MESSAGE, private, G) == {"copied": 0, "committed": False, "pushed": True}


def test_a_private_checkout_with_no_main_of_the_remote_s_cannot_be_recorded_onto(detail, tmp_path):
    repo, run, _, _ = detail
    bare = tmp_path / "private-without-remote"
    subprocess.run(["git", "init", "-q", "-b", "main", str(bare)], check=True)
    n = len(heldout.private_files(run, repo))
    assert drive.record_private(repo, run, MESSAGE, bare, G) == {
        "copied": n, "committed": False, "pushed": False,
        "error": f"the private repo has no refs/remotes/origin/{drive.PRIVATE_BRANCH} to record onto"}


def test_a_private_push_refused_while_the_remote_answers_is_tried_once_more_and_then_reported(detail, fake):
    repo, run, private, remote = detail
    before = remote_head(remote)
    res = drive.record_private(repo, run, MESSAGE, private, fake.refuse("push").cmd)
    assert res == {"copied": len(heldout.private_files(run, repo)), "committed": True, "pushed": False,
                   "error": fake.refusal("push", drive.PRIVATE_PUSH_TRIES)}
    assert len(fake.calls("fetch")) == len(fake.calls("push")) == drive.PRIVATE_PUSH_TRIES
    assert remote_head(remote) == before


def test_a_private_push_that_goes_through_on_the_second_try_leaves_no_error(detail, fake):
    repo, run, private, remote = detail
    res = drive.record_private(repo, run, MESSAGE, private, fake.refuse("push", 1).cmd)
    assert res == {"copied": len(heldout.private_files(run, repo)), "committed": True, "pushed": True}
    assert len(fake.calls("push")) == 2 and f"{DEST}/{ACCEPT}" in private_remote_files(remote)


def test_a_private_push_refused_while_the_remote_cannot_be_fetched_is_not_tried_again(detail, fake):
    repo, run, private, _ = detail
    res = drive.record_private(repo, run, MESSAGE, private, fake.refuse("push").refuse("fetch").cmd)
    assert res == {"copied": len(heldout.private_files(run, repo)), "committed": True, "pushed": False,
                   "error": fake.refusal("fetch") + fake.refusal("push")}
    assert len(fake.calls("push")) == 1


def test_detail_the_remote_was_last_seen_to_have_counts_as_pushed_only_if_the_remote_answered(detail, fake):
    repo, run, private, _ = detail
    assert drive.record_private(repo, run, MESSAGE, private, G)["pushed"] is True
    git(private, "fetch", "-q", "origin")
    res = drive.record_private(repo, run, MESSAGE, private, fake.refuse("fetch").cmd)
    assert res == {"copied": 0, "committed": False, "pushed": False} and fake.calls("push") == []


def test_a_private_commit_that_fails_at_any_step_is_reported_and_nothing_is_pushed(detail, fake):
    repo, run, private, _ = detail
    res = drive.record_private(repo, run, MESSAGE, private, fake.refuse("commit-tree").cmd)
    assert res == {"copied": len(heldout.private_files(run, repo)), "committed": False, "pushed": False,
                   "error": fake.refusal("commit-tree")}
    assert fake.calls("push") == []


TRACKING = f"refs/remotes/origin/{drive.PRIVATE_BRANCH}"


PRIVATE_COMMIT_STEPS = ["read-tree", "hash-object", "update-index", "write-tree", "commit-tree"]


def test_each_step_of_building_the_private_commit_reports_its_own_failure(detail, tmp_path):
    repo, run, private, _ = detail
    for step in PRIVATE_COMMIT_STEPS:
        fake = FakeGit(tmp_path / f"fake-{step}").refuse(step)
        built = drive._private_commit(private, TRACKING, run, [ACCEPT], DEST, MESSAGE, fake.cmd)
        assert built == {"error": fake.refusal(step)}, step
        later = PRIVATE_COMMIT_STEPS[PRIVATE_COMMIT_STEPS.index(step) + 1:]
        assert not any(fake.calls(s) for s in later), step                             # it stopped at the step that failed


def test_a_private_commit_holds_the_files_at_their_place_on_the_base_and_touches_no_checkout(detail):
    repo, run, private, _ = detail
    base, status = head(private, TRACKING), git(private, "status", "--porcelain")
    built = drive._private_commit(private, TRACKING, run, [ACCEPT], DEST, MESSAGE, G)
    sha = built["commit"]
    assert list(built) == ["commit"] and head(private, f"{sha}^") == base
    assert git(private, "show", f"{sha}:{DEST}/{ACCEPT}") == (run / ACCEPT).read_text()
    assert git(private, "log", "-1", "--format=%B", sha).strip() == MESSAGE + drive.COMMIT_TRAILER
    assert git(private, "diff", "--name-only", base, sha).split() == [f"{DEST}/{ACCEPT}"]
    assert head(private) == base and git(private, "status", "--porcelain") == status
    git(private, "update-ref", TRACKING, sha)                                          # as after a push and a fetch
    assert drive._private_commit(private, TRACKING, run, [ACCEPT], DEST, MESSAGE, G) == {"commit": None}


def test_a_private_commit_needs_a_base(detail):
    repo, run, private, _ = detail
    assert drive._private_commit(private, "refs/remotes/origin/absent", run, [ACCEPT], DEST, MESSAGE, G) == {
        "error": "the private repo has no refs/remotes/origin/absent to record onto"}


def test_metrics_are_saved_and_loaded_through_the_held_out_split(tmp_path):
    metrics = {"stories": {"1": pg.story_record(1, pg.STORY_1, "aaaa")}}
    drive.save_metrics(tmp_path, metrics)
    assert drive.load_metrics(tmp_path) == heldout.load_metrics(tmp_path)
    assert drive.load_metrics(tmp_path)["stories"]["1"]["commit"] == "aaaa"
