"""The stop rule: what the harness does each time the agent stops (owner's decision, 1 October 2026).

Until then the harness looked only at commits since the story began: none, and the agent was told to "continue";
any, and the story was accepted. Over the 227 nudges in the repo's logs a nudge led to a commit 15% of the time;
agents that had finished but not committed did busywork or started the next stories (gufo v2-r1 story 10 built
stories 11 and 12); and a stall after an early task's commit was accepted as a finished story.

The rule now, and what is tested here:
- A story is finished only on evidence (story_finished): the agent's last reply has the line `STORY <n> DONE <hash>`
  for this story on a line of its own, the hash is the workspace's HEAD, and nothing is left uncommitted.
- Every other clean stop gets one message, the same every time (stop_message), naming the story, its title and its
  tasks file. A tool call written as text gets it too, counted and logged as before.
- After MAX_NUDGES messages the story is capped: recorded PARTIAL, its work committed by the harness.
- Errors, stalls, the guards and the operator's skip are as they were.
- The story's prompt asks for the DONE line (render_prompt), so an agent that does as asked is never nudged.
- The record says whether the story ended on a verified finish (`finished`).

The replies in fixtures/stops/recorded-stops.json are the ends of the agent's replies before every nudge in the
repo's logs (each distinct ending once, a handful from the one story that looped 3,124 times): none of them is a
finish, and each gets the message.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import drive
from clients import empty_state

G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
STORY = {"id": 4, "title": "Edit a note", "tasks_path": "spec/stories/004-edit-a-note/tasks.md"}
RECORDED_STOPS = Path(__file__).with_name("fixtures") / "stops" / "recorded-stops.json"
MIN_HASH_CHARS = 7

# The owner's wording, with story 4's number, title and tasks file filled in.
MESSAGE_FOR_STORY_4 = """\
This is an automated message from a script. Nobody reads your replies and nobody can answer questions. You will get this same message every time you stop, until story 4 is finished in the way described here.

You are working on story 4, "Edit a note", and nothing else. Its tasks are in spec/stories/004-edit-a-note/tasks.md.

Do the first of these that applies:

1. Your last message contained a tool call written as text: it was not run. Make the call again as a real tool call.
2. A task in tasks.md is not finished: carry on with it now. Do not write a summary first.
3. Something cannot be done on this machine (for example a browser that is not installed): write what and why in NOTES.md and treat that task as finished.
4. Every task is finished: do not re-check or improve anything. Run
   git add -A && git commit -m "story 4: Edit a note"
   then git rev-parse HEAD.

When the commit is made, reply with exactly this one line and stop:

STORY 4 DONE <commit hash>

Do not start any other story. Do not offer further work. Do not ask what to do next."""


def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*G, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def commit(ws: Path, name: str = "work.ts") -> str:
    """One more commit in the workspace; returns its hash."""
    with (ws / name).open("a") as f:
        f.write("more\n")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", f"change {name}")
    return git(ws, "rev-parse", "HEAD")


@pytest.fixture
def ws(tmp_path) -> Path:
    """A workspace with one commit and nothing uncommitted."""
    d = tmp_path / "ws"
    d.mkdir()
    git(d, "init", "-q", "-b", "main")
    commit(d, "README.md")
    return d


@pytest.fixture(autouse=True)
def clean_story_state():
    def reset():
        drive.STORY_FAULTS.clear()
        drive.STORY_SKIP.clear()
        drive.RUN_ABORT.clear()
    reset()
    yield
    reset()


# ======================= the message =======================

def test_the_stop_message_is_the_owner_s_wording_with_the_story_filled_in():
    assert drive.stop_message(STORY["id"], STORY["title"], STORY["tasks_path"]) == MESSAGE_FOR_STORY_4


def test_the_stop_message_names_the_story_the_commit_command_and_that_no_other_story_is_started():
    text = drive.stop_message(12, "Share a board", "spec/stories/012-share/tasks.md")
    assert 'You are working on story 12, "Share a board", and nothing else.' in text
    assert "Its tasks are in spec/stories/012-share/tasks.md." in text
    assert '   git add -A && git commit -m "story 12: Share a board"\n   then git rev-parse HEAD.' in text
    assert "\nSTORY 12 DONE <commit hash>\n" in text and "until story 12 is finished" in text
    assert text.endswith("Do not start any other story. Do not offer further work. Do not ask what to do next.")
    assert "{" not in text and "}" not in text                       # nothing left unfilled


def test_a_title_with_braces_is_filled_in_as_it_is():
    assert 'story 3: Render {{handlebars}} safely"' in drive.stop_message(3, "Render {{handlebars}} safely", "t.md")


# ======================= story_finished: the evidence =======================

def done_line(ws: Path, story: int = STORY["id"], chars: int | None = None) -> str:
    return f"STORY {story} DONE {git(ws, 'rev-parse', 'HEAD')[:chars]}"


def test_the_done_line_with_the_workspace_s_head_and_a_clean_tree_is_a_finish(ws):
    assert drive.story_finished(done_line(ws), STORY["id"], ws) is True


def test_the_done_line_may_follow_other_lines_and_be_followed_by_them(ws):
    reply = f"All four tasks are complete and every suite passes.\n\n{done_line(ws)}\n"
    assert drive.story_finished(reply, STORY["id"], ws) is True
    assert drive.story_finished(f"{done_line(ws)}\n\nNothing else to report.", STORY["id"], ws) is True


@pytest.mark.parametrize("chars", [MIN_HASH_CHARS, 12, 40])
def test_an_abbreviated_hash_of_at_least_seven_characters_counts(ws, chars):
    assert drive.story_finished(done_line(ws, chars=chars), STORY["id"], ws) is True


def test_a_hash_shorter_than_seven_characters_does_not_count(ws):
    assert drive.story_finished(done_line(ws, chars=MIN_HASH_CHARS - 1), STORY["id"], ws) is False


def test_the_hash_may_be_written_in_capitals(ws):
    assert drive.story_finished(done_line(ws).replace(git(ws, "rev-parse", "HEAD"), git(ws, "rev-parse", "HEAD").upper()),
                                STORY["id"], ws) is True


@pytest.mark.parametrize("wrap", ["`{}`", "**{}**", "  {}  ", "```\n{}\n```", "\t{}"])
def test_the_done_line_set_off_as_code_or_bold_is_still_the_line(ws, wrap):
    assert drive.story_finished(wrap.format(done_line(ws)), STORY["id"], ws) is True


def test_another_story_s_done_line_is_not_this_story_s_finish(ws):
    assert drive.story_finished(done_line(ws, story=STORY["id"] + 1), STORY["id"], ws) is False
    assert drive.story_finished(done_line(ws, story=40), STORY["id"], ws) is False     # 4 is not 40


def test_a_hash_that_is_not_the_workspace_s_head_is_not_a_finish(ws):
    earlier = done_line(ws)
    commit(ws)
    assert drive.story_finished(earlier, STORY["id"], ws) is False                    # an earlier commit's hash
    assert drive.story_finished(f"STORY {STORY['id']} DONE {'0123abc' * 2}", STORY["id"], ws) is False
    assert drive.story_finished(f"STORY {STORY['id']} DONE <commit hash>", STORY["id"], ws) is False


def test_work_left_uncommitted_is_not_a_finish(ws):
    line = done_line(ws)
    (ws / "README.md").write_text("edited, not committed\n")
    assert drive.story_finished(line, STORY["id"], ws) is False
    git(ws, "checkout", "--", "README.md")
    (ws / "new-file.ts").write_text("never added\n")
    assert drive.story_finished(line, STORY["id"], ws) is False
    (ws / "new-file.ts").unlink()
    assert drive.story_finished(line, STORY["id"], ws) is True


def test_the_done_line_inside_a_sentence_is_not_on_a_line_of_its_own(ws):
    line = done_line(ws)
    for reply in (f"I will reply {line} once the commit is made.", f"{line} and all tests pass.",
                  f"Reply: {line}", f"- {line}"):
        assert drive.story_finished(reply, STORY["id"], ws) is False, reply


@pytest.mark.parametrize("reply", [
    "", "   \n", "Story 4 is complete.", "The story is done and committed.", "STORY 4 DONE", "story 4 done 0123abc",
    "STORY 4 COMPLETE 0123abc", "STORY four DONE 0123abc", "Done. All tasks finished, commit 0123abc.",
])
def test_prose_about_being_done_is_not_a_finish(ws, reply):
    assert drive.story_finished(reply, STORY["id"], ws) is False


def test_one_of_several_done_lines_naming_the_head_is_enough(ws):
    reply = f"STORY {STORY['id']} DONE 0123abc\n{done_line(ws)}"
    assert drive.story_finished(reply, STORY["id"], ws) is True


def test_a_workspace_git_cannot_read_is_not_a_finish(tmp_path):
    assert drive.story_finished(f"STORY {STORY['id']} DONE 0123abc", STORY["id"], tmp_path / "no-such-workspace") is False
    plain = tmp_path / "not-a-repository"
    plain.mkdir()
    assert drive.story_finished(f"STORY {STORY['id']} DONE 0123abc", STORY["id"], plain) is False


def test_a_reply_without_the_line_is_judged_without_asking_git(tmp_path, monkeypatch):
    def no_git(*a, **k):
        raise AssertionError("git must not be asked when the reply has no DONE line for the story")
    monkeypatch.setattr(drive, "sh", no_git)
    assert drive.story_finished("All done.", STORY["id"], tmp_path) is False


# ======================= the reply that is judged =======================

def reply_event(role: str, content) -> str:
    return json.dumps({"type": "message_end", "message": {"role": role, "content": content}})


def test_the_reply_judged_is_the_text_of_the_last_assistant_message(tmp_path):
    ev = tmp_path / "agent-events.jsonl"
    ev.write_text("\n".join([
        reply_event("assistant", [{"type": "text", "text": "an earlier reply"}]),
        reply_event("assistant", [{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": "the last "}, "a bare string",
                                  {"type": "toolCall", "name": "bash"}, {"type": "text", "text": "reply"}, {"type": "text"}]),
        reply_event("user", [{"type": "text", "text": "a tool result, not a reply"}]),
        reply_event("assistant", "content that is not a list of parts"),
        json.dumps({"type": "system", "message": "a refused tool call's message is a string"}),
        json.dumps({"type": "agent_end"}),
        "[1, 2]",
        '{"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "cut o',
    ]) + "\n")
    assert drive.final_reply_text(ev) == "the last reply"


def test_a_last_assistant_message_with_no_text_or_no_log_is_an_empty_reply(tmp_path):
    ev = tmp_path / "agent-events.jsonl"
    assert drive.final_reply_text(ev) == ""
    ev.write_text(reply_event("assistant", [{"type": "text", "text": "earlier"}]) + "\n"
                  + reply_event("assistant", [{"type": "toolCall", "name": "bash"}]) + "\n")
    assert drive.final_reply_text(ev) == ""


@pytest.mark.parametrize("text, is_call", [
    ('<tool_call>{"name": "edit"}</tool_call>', True), ("Fixing it.\n<tool_call>\n<function=edit>", True),
    ("All tasks are done and committed.", False), ("", False), ("<tool_result>ok</tool_result>", False)])
def test_a_reply_carrying_a_tool_call_as_text_is_known_by_its_marker(text, is_call):
    assert drive.tool_call_as_text(text) is is_call


# ======================= the loop, with the agent scripted =======================

def attempt(**changes) -> dict:
    return {"exit": 0, "seconds": 60.0, "stalled": False, "session": "s1", "error": None, "steps": 3, "tool_calls": 2,
            "compactions": 1, "tokens": {**empty_state()["tokens"], "input": 100, "output": 10}, **changes}


class Guard:
    """Stands in for the hang guard: how it was built, started and stopped."""
    made: list = []

    def __init__(self, events, ws, log):
        self.args = (events, ws, log)
        self.calls: list[str] = []
        Guard.made.append(self)

    def start(self):
        self.calls.append("start")

    def stop(self):
        self.calls.append("stop")
        return 2


DONE = "{done}"            # in a scripted reply: the DONE line for the workspace's HEAD at that moment
LEAKED_CALL = '<tool_call>\n<function=edit>\n<parameter=path>src/app.ts</parameter>\n</function>\n</tool_call>'


def stop(reply: str = "All tasks are complete.", commits: bool = False, leaves: str | None = None, **result) -> dict:
    """One scripted stop of the agent: what it does in the workspace first, what it then says, and how the session
    ended (attempt()'s fields)."""
    return {"reply": reply, "commits": commits, "leaves": leaves, "result": attempt(**result)}


@pytest.fixture
def loop(tmp_path, ws, monkeypatch):
    """run_story_agent over a real workspace with run_agent scripted: loop(stops) -> (result, the calls made)."""
    run = tmp_path / "run"
    events = run / "stories" / "04" / "agent-events.jsonl"
    events.parent.mkdir(parents=True)
    Guard.made = []
    monkeypatch.setattr(drive, "ToolHangGuard", Guard)
    slept: list[float] = []
    monkeypatch.setattr(drive.time, "sleep", slept.append)

    def go(stops: list[dict], story: dict = STORY, **kwargs):
        script = iter(stops)
        calls: list[dict] = []

        def fake_run_agent(client, ws_, env, model_id, prompt, events_path, resume_from=None, fork=True):
            calls.append({"prompt": prompt, "resume_from": resume_from, "fork": fork, "log_existed": events_path.exists(),
                          "args": (client, ws_, env, model_id, events_path)})
            s = next(script)
            if s["commits"]:
                commit(ws_)
            if s["leaves"]:
                (ws_ / s["leaves"]).write_text("not committed\n")
            reply = s["reply"].replace(DONE, f"STORY {story['id']} DONE {git(ws_, 'rev-parse', 'HEAD')}")
            with events_path.open("a") as f:
                f.write(json.dumps({"type": "message_end", "message": {
                    "role": "assistant", "content": [{"type": "text", "text": reply}]}}) + "\n")
            return s["result"]
        monkeypatch.setattr(drive, "run_agent", fake_run_agent)
        result = drive.run_story_agent("the-client", ws, {"E": "1"}, "the-model", "the story prompt", events, story, **kwargs)
        assert list(script) == [], "every scripted stop was reached"
        return result, calls
    go.events, go.ws, go.run, go.slept = events, ws, run, slept
    return go


def sent(calls: list[dict]) -> list[tuple]:
    return [(c["prompt"], c["resume_from"], c["fork"]) for c in calls]


THE_MESSAGE = (MESSAGE_FOR_STORY_4, "s1", False)        # the stop message, in the same session, not a fork


def test_a_story_that_ends_with_the_done_line_on_its_first_stop_is_finished_and_never_nudged(loop):
    loop.events.write_text("left by an earlier, abandoned start of this story\n")
    result, calls = loop([stop(DONE, commits=True)])
    assert result == {"seconds": 60.0, "steps": 3, "tool_calls": 2, "compactions": 1, "tool_interruptions": 2,
                      "tokens": {"input": 100, "output": 10, "reasoning": 0, "cache_read": 0, "cache_write": 0},
                      "exit": 0, "stalled": False, "resumes": 0, "nudges": 0, "toolcall_text_resumes": 0, "errors": [],
                      "ended_by_operator": False, "ended_in_error": False, "sessions": ["s1"], "finished": True}
    assert sent(calls) == [("the story prompt", None, True)]
    assert calls[0]["log_existed"] is False                           # a fresh story starts a fresh log
    assert calls[0]["args"] == ("the-client", loop.ws, {"E": "1"}, "the-model", loop.events)
    guard, = Guard.made
    assert guard.args == (loop.events, loop.ws, loop.run / "interventions.md") and guard.calls == ["start", "stop"]
    assert not (loop.run / "interventions.md").exists()


def test_an_agent_that_says_it_is_done_without_committing_gets_the_message_and_then_finishes(loop):
    """(a) The commonest recorded case: 88 of 227 nudges followed "the story is done" with nothing committed."""
    told = []
    result, calls = loop([stop("Story 4 is complete: all tasks done and every suite passes.", leaves="src.ts"),
                          stop(DONE, commits=True)], on_cap=told.append)
    assert sent(calls) == [("the story prompt", None, True), THE_MESSAGE]
    assert result["nudges"] == 1 and result["finished"] is True and told == []
    assert result["resumes"] == 0 and result["toolcall_text_resumes"] == 0


def test_a_commit_without_the_done_line_no_longer_ends_the_story(loop):
    """(b) The hole in the old rule: any commit since the story began counted as finished, and agents commit task
    by task, so a stall after the first task's commit was accepted as a finished story."""
    result, calls = loop([stop("Task 1 is committed. Now let me look at task 2.", commits=True),
                          stop(DONE, commits=True)])
    assert sent(calls) == [("the story prompt", None, True), THE_MESSAGE]
    assert result["nudges"] == 1 and result["finished"] is True


def test_an_agent_that_never_finishes_gets_the_same_message_until_the_cap(loop):
    """(d) and (e): replies that only talk, with no tool call and no line, are answered every time; the cap, not
    the absence of a tool call, ends it."""
    told = []
    talk = stop("Nothing left to do.", tool_calls=0)
    result, calls = loop([stop("All tasks are complete.")] + [talk] * drive.MAX_NUDGES, on_cap=told.append)
    assert sent(calls) == [("the story prompt", None, True)] + [THE_MESSAGE] * drive.MAX_NUDGES
    assert result["nudges"] == drive.MAX_NUDGES and result["finished"] is False and result["ended_by_operator"] is False
    assert told == [f"story cap: the stop message was sent {drive.MAX_NUDGES} times without the story finishing "
                    f"(cap {drive.MAX_NUDGES})"]


def test_each_nudge_is_announced_on_the_line_dbench_reads_them_from(loop, capsys):
    """tools/dbench/src/events.rs takes a job's nudges from lines that start this way; the start is kept word for word."""
    loop([stop("Done."), stop("Done again."), stop(DONE, commits=True)])
    out = capsys.readouterr().out.splitlines()
    assert out == [f"    agent stopped without committing — nudge {n}: the story is not finished (no verified DONE line); "
                   f"the stop message was sent" for n in (1, 2)]


def test_the_cap_ends_the_story_when_nobody_asked_to_be_told(loop):
    result, calls = loop([stop("Still going.")] * (drive.MAX_NUDGES + 1))
    assert result["nudges"] == drive.MAX_NUDGES and len(calls) == drive.MAX_NUDGES + 1 and result["finished"] is False


def test_a_done_line_for_a_tree_with_work_left_uncommitted_gets_the_message_again(loop):
    result, calls = loop([stop(DONE, commits=True, leaves="scratch.txt"), stop(DONE, commits=True)])
    assert sent(calls) == [("the story prompt", None, True), THE_MESSAGE]
    assert result["nudges"] == 1 and result["finished"] is True


def test_a_tool_call_written_as_text_gets_the_message_and_is_counted_and_logged_as_before(loop):
    """(f) It is the message's first case; it is not a nudge."""
    result, calls = loop([stop("Now fixing the import.\n" + LEAKED_CALL), stop(DONE, commits=True)])
    assert sent(calls) == [("the story prompt", None, True), THE_MESSAGE]
    assert result["toolcall_text_resumes"] == 1 and result["nudges"] == 0 and result["finished"] is True
    log = (loop.run / "interventions.md").read_text()
    assert ("story 04: the agent's last reply was a tool call written as text (not run); continued the session "
            f"(1/{drive.MAX_TOOLCALL_TEXT_RESUMES})") in log


def test_tool_calls_written_as_text_past_their_cap_count_as_nudges_up_to_the_story_s_cap(loop):
    told = []
    n = drive.MAX_TOOLCALL_TEXT_RESUMES + drive.MAX_NUDGES
    result, calls = loop([stop(LEAKED_CALL)] * (n + 1), on_cap=told.append)
    assert sent(calls)[1:] == [THE_MESSAGE] * n
    assert result["toolcall_text_resumes"] == drive.MAX_TOOLCALL_TEXT_RESUMES and result["nudges"] == drive.MAX_NUDGES
    assert result["finished"] is False and len(told) == 1
    assert (loop.run / "interventions.md").read_text().count("tool call written as text") == drive.MAX_TOOLCALL_TEXT_RESUMES


def test_every_message_in_a_story_is_the_same_text(loop):
    """(h)"""
    _, calls = loop([stop(""), stop("Shall I commit?"), stop(LEAKED_CALL), stop("Let me now run the tests."),
                     stop(DONE, commits=True)])
    assert {c["prompt"] for c in calls[1:]} == {MESSAGE_FOR_STORY_4} and len(calls) == 5


def test_the_message_names_the_story_being_run(loop):
    other = {"id": 12, "title": "Share a board", "tasks_path": "spec/stories/012-share/tasks.md"}
    _, calls = loop([stop("Done."), stop(DONE, commits=True)], story=other)
    assert calls[1]["prompt"] == drive.stop_message(12, "Share a board", "spec/stories/012-share/tasks.md")


def test_a_story_continued_after_a_harness_restart_keeps_its_log_and_its_session(loop):
    loop.events.write_text('{"type": "session", "id": "s0"}\n')
    result, calls = loop([stop(DONE, commits=True)], continue_session="s0")
    assert [(c["prompt"], c["resume_from"], c["fork"], c["log_existed"]) for c in calls] == [
        (drive.RESUME_PROMPT, "s0", False, True)]
    assert loop.events.read_text().startswith('{"type": "session", "id": "s0"}\n') and result["finished"] is True


# ---------- (g) errors, stalls, the guards and the operator's skip: as they were ----------

def test_an_error_is_resumed_in_a_fork_of_its_session_until_the_cap(loop):
    failing = [stop("", session=f"s{n}", error=f"error {n}", exit=1) for n in range(drive.MAX_AGENT_RESUMES + 1)]
    result, calls = loop(failing)
    assert sent(calls) == [("the story prompt", None, True)] + [
        (drive.RESUME_PROMPT, f"s{n}", True) for n in range(drive.MAX_AGENT_RESUMES)]
    assert loop.slept == [drive.RESUME_BACKOFF_S] * drive.MAX_AGENT_RESUMES
    assert result["resumes"] == drive.MAX_AGENT_RESUMES and result["nudges"] == 0 and result["finished"] is False
    assert result["errors"] == [f"error {n}" for n in range(drive.MAX_AGENT_RESUMES + 1)]
    assert result["ended_in_error"] is True and result["exit"] == 1
    assert result["sessions"] == [f"s{n}" for n in range(drive.MAX_AGENT_RESUMES + 1)]
    n = drive.MAX_AGENT_RESUMES + 1
    assert (result["seconds"], result["steps"], result["tool_calls"], result["compactions"]) == (60.0 * n, 3 * n, 2 * n, n)
    assert result["tokens"]["input"] == 100 * n and result["tokens"]["output"] == 10 * n


def test_an_error_that_a_resume_clears_goes_on_to_the_stop_rule(loop):
    result, calls = loop([stop("", error="dropped stream", exit=1), stop("Recovered; all done.", session="s2"),
                          stop(DONE, commits=True, session="s2")])
    assert sent(calls) == [("the story prompt", None, True), (drive.RESUME_PROMPT, "s1", True),
                           (MESSAGE_FOR_STORY_4, "s2", False)]
    assert (result["resumes"], result["nudges"], result["finished"]) == (1, 1, True)
    assert result["errors"] == ["dropped stream"] and result["ended_in_error"] is False


@pytest.mark.parametrize("failed", [{"error": "no session to resume", "session": None, "exit": 1},
                                    {"error": "stopped in a loop", "stalled": True, "exit": -15},
                                    {"stalled": True, "exit": -15},
                                    {"session": None}])
def test_an_attempt_with_no_session_or_ended_by_a_stall_gets_neither_a_resume_nor_the_message(loop, failed):
    result, calls = loop([stop(DONE, commits=True, **failed)])                # even a valid DONE line is not looked at
    assert len(calls) == 1 and result["resumes"] == 0 and result["nudges"] == 0 and result["finished"] is False
    assert result["stalled"] is failed.get("stalled", False) and loop.slept == []


@pytest.mark.parametrize("flag, by_operator", [("RUN_ABORT", False), ("STORY_SKIP", True)])
def test_a_story_a_guard_or_the_operator_stopped_gets_neither_a_resume_nor_the_message(loop, flag, by_operator):
    getattr(drive, flag).set()
    for ended in (stop("", error="killed", exit=-15), stop("All done.")):
        result, calls = loop([ended])
        assert len(calls) == 1 and result["resumes"] == 0 and result["nudges"] == 0
        assert result["ended_by_operator"] is by_operator and result["finished"] is False


def test_a_reply_the_harness_cannot_read_ends_the_attempts_and_is_recorded_as_its_own_fault(loop, monkeypatch):
    """A fault in the check is the harness's, not the agent's: the story is taken as it stands (scored, committed and
    recorded by the caller), with the fault in its record, and the agent is not sent the message blind."""
    def broken(events):
        raise RuntimeError("the log could not be read")
    monkeypatch.setattr(drive, "final_reply_text", broken)
    result, calls = loop([stop(DONE, commits=True)])
    assert len(calls) == 1 and result["nudges"] == 0 and result["finished"] is False
    assert [f["step"] for f in drive.STORY_FAULTS] == ["reply check"]
    assert "harness fault in reply check" in (loop.run / "interventions.md").read_text()


# ======================= every recorded stop =======================

def recorded_stops() -> list[dict]:
    return json.loads(RECORDED_STOPS.read_text())["stops"]


def test_the_recorded_stops_are_the_ones_the_analysis_counted():
    doc = json.loads(RECORDED_STOPS.read_text())
    assert doc["nudges_outside_the_loop"] == 227 and doc["nudges"] == 227 + 3124
    kinds = {s["kind"] for s in doc["stops"]}
    assert kinds == {"said the story was done", "sent an empty reply", "said it would go on, and stopped",
                     "asked a question or offered more", "written a tool call as text", "other"}
    assert all(set(s) == {"story", "kind", "times", "tail"} for s in doc["stops"])
    assert len({s["tail"] for s in doc["stops"]}) == len(doc["stops"]) > 100            # each distinct ending once


def test_no_recorded_stop_counts_as_a_finished_story(ws):
    for s in recorded_stops():
        assert drive.story_finished(s["tail"], s["story"], ws) is False, s["tail"][-80:]


def test_every_recorded_stop_gets_the_stop_message(loop):
    for n, s in enumerate(recorded_stops()):
        story = {"id": s["story"], "title": f"Story {s['story']}", "tasks_path": f"spec/stories/{s['story']:03d}-x/tasks.md"}
        result, calls = loop([stop(s["tail"]), stop("", stalled=True)], story=story)   # the stall ends the scripted story
        assert calls[1]["prompt"] == drive.stop_message(story["id"], story["title"], story["tasks_path"]), (n, s["kind"])
        assert (calls[1]["resume_from"], calls[1]["fork"]) == ("s1", False)
        assert result["nudges"] + result["toolcall_text_resumes"] == 1 and result["finished"] is False, (n, s["kind"])


# ======================= the cap's reason, and the story's prompt =======================

def test_a_story_is_capped_at_four_hours_of_agent_time_or_five_stop_messages():
    hours = drive.MAX_STORY_AGENT_S / drive.SECONDS_PER_HOUR
    assert (drive.MAX_STORY_AGENT_S, drive.MAX_NUDGES) == (4 * 3600, 5)
    assert drive.cap_reason(drive.MAX_STORY_AGENT_S - 0.1, drive.MAX_NUDGES - 1) is None
    assert drive.cap_reason(drive.MAX_STORY_AGENT_S, drive.MAX_NUDGES) == f"story cap: {hours:.1f} h of agent time (cap {hours:.1f} h)"
    assert drive.cap_reason(0, drive.MAX_NUDGES) == (f"story cap: the stop message was sent {drive.MAX_NUDGES} times "
                                                     f"without the story finishing (cap {drive.MAX_NUDGES})")


def test_the_story_s_prompt_ends_by_asking_for_the_done_line(tmp_path, monkeypatch):
    template = tmp_path / "story.md.tmpl"
    template.write_text("Implement story {{ID}}, {{TITLE}}, and commit it.\n")
    monkeypatch.setattr(drive, "PROMPT_TMPL", template)
    monkeypatch.setattr(drive, "PK", SimpleNamespace(app_line="", rules=""))
    prompt = drive.render_prompt({"id": 4, "dir": "004-edit-a-note"}, "Edit a note", [], {})
    assert prompt == ("Implement story 4, Edit a note, and commit it.\n\n"
                      "After that commit, run `git rev-parse HEAD` and end your final reply with exactly this line: "
                      "STORY 4 DONE <commit hash>. The story is not finished until you have sent it.\n")


def test_the_old_prompts_are_gone():
    for name in ("NUDGE_PROMPT", "TOOLCALL_AS_TEXT_PROMPT", "needs_nudge", "keep_nudging", "commits_since"):
        assert not hasattr(drive, name), name
