"""logscan.py: did the agent reach outside its own workspace for anything that could give it answers?

Organised by dimension, each class one dimension:
  TestLogFormats         which events count as the agent's own calls, for pi and Claude Code stream-json logs
  TestRoutesFlagged      one test per route (and per spelling of a route) that must be flagged
  TestNotFlagged         look-alikes that must not be flagged
  TestOwnWorkspace       every spelling of the agent's own workspace, and the near-misses that are someone else's
  TestTmpLeftovers       /tmp: what the run named or made itself versus what the environment showed it
  TestTruncation         a verdict says when the strings it read were cut short
  TestVerdictShape       the verdict's fields, counting, examples, redaction
  TestScanRun            a whole run directory: which log is read, story keys, missing logs, the CLI

Every path is made up, in the shape of the real ones.
"""
from __future__ import annotations

import gzip
import json
import subprocess
import sys
from pathlib import Path

import pytest

import logscan
from logscan import Context, scan, scan_run

HARNESS = Path(__file__).resolve().parent

HOME = "/home/tester"
OWN = "qwen__9.9__13b__linux__rtx9999__llamacpp-pi__benchmarks__vidi__trial-07"
OWN_OLD = "qwen__9.9__13b__linux__rtx9999__llamacpp-opencode__benchmarks__vidi__trial-07"
OWN_WS = f"{HOME}/.vidi-bench/work/{OWN}"
OWN_CWD = f"~/.vidi-bench/work/{OWN}/workspace"
OTHER = "qwen__9.9__13b__linux__rtx9999__llamacpp-pi__benchmarks__vidi__trial-06"
OTHER_COMBO_SAME_ID = "qwen__9.9-fast__13b__linux__rtx9999__llamacpp-pi__benchmarks__vidi__trial-07"
REF_RUN = "benchmarks__reference__vidi__bigmodel-1.0__run-2"
KNOWN = frozenset({OWN, OTHER, OTHER_COMBO_SAME_ID, REF_RUN})
CLONE = "~/nas/tools/awesome-local-ai"
TRUNC = "…[truncated 321 chars]"


# ---------------------------------------------------------------- log builders

def _write(path: Path, events: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(e) + "\n" for e in events)
    if path.name.endswith(".gz"):
        with gzip.open(path, "wt") as f:
            f.write(text)
    else:
        path.write_text(text)
    return path


def pi_events(calls: list[tuple], cwd: str = OWN_CWD, sources=("message_end", "tool_execution_start")) -> list[dict]:
    """calls: (tool, args) or (tool, args, result_text). Each call is emitted the way pi emits it: in the
    assistant message, again at execution start, again in turn_end and agent_end."""
    ev: list[dict] = [{"type": "session", "version": 3, "cwd": cwd}, {"type": "agent_start"}]
    blocks = []
    for i, c in enumerate(calls):
        tool, args = c[0], c[1]
        result = c[2] if len(c) > 2 else "ok"
        cid = f"call{i}"
        block = {"type": "toolCall", "id": cid, "name": tool, "arguments": args}
        blocks.append(block)
        msg = {"role": "assistant", "content": [{"type": "text", "text": "Let me look."}, block]}
        if "message_end" in sources:
            ev.append({"type": "message_end", "message": msg})
        if "tool_execution_start" in sources:
            ev.append({"type": "tool_execution_start", "toolCallId": cid, "toolName": tool, "args": args})
        ev.append({"type": "tool_execution_end", "toolCallId": cid, "toolName": tool,
                   "result": {"content": [{"type": "text", "text": result}]}, "isError": False})
        if "turn_end" in sources:
            ev.append({"type": "turn_end", "message": msg})
    if "agent_end" in sources:
        ev.append({"type": "agent_end", "messages": [{"role": "assistant", "content": blocks}]})
    return ev


def cc_events(calls: list[tuple], cwd: str = OWN_CWD) -> list[dict]:
    """Claude Code stream-json: tool_use blocks in assistant messages, tool_result blocks in user messages."""
    ev: list[dict] = [{"type": "system", "subtype": "init", "cwd": cwd}]
    for i, c in enumerate(calls):
        tool, args = c[0], c[1]
        result = c[2] if len(c) > 2 else "ok"
        cid = f"toolu_{i}"
        ev.append({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "text", "text": "Checking."}, {"type": "tool_use", "id": cid, "name": tool, "input": args}]}})
        ev.append({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": cid, "content": result}]}})
    ev.append({"type": "result", "subtype": "success"})
    return ev


def pi_log(tmp_path: Path, calls: list[tuple], name: str = "agent-events.jsonl", **kw) -> Path:
    return _write(tmp_path / "stories" / "01" / name, pi_events(calls, **kw))


def cc_log(tmp_path: Path, calls: list[tuple], name: str = "agent-events.jsonl", **kw) -> Path:
    return _write(tmp_path / "stories" / "01" / name, cc_events(calls, **kw))


def bash(cmd: str, result: str = "ok") -> tuple:
    return ("bash", {"command": cmd, "timeout": 30}, result)


# `ls /tmp` whose output shows another run's leftovers: how an agent finds them.
LS_TMP = ("bash", {"command": "ls -la /tmp/"}, "drwxr-xr-x 5 u u 4096 Sep 26 vidi-baseline\n"
          "drwx------ 3 u u 4096 Sep 26 tmp.q7Rk2mZx9A\n-rw-r--r-- 1 u u 10 Sep 26 dbg.log\n")


def run_scan(tmp_path: Path, calls: list[tuple], own: str = OWN_WS, ctx: Context | None = None, fmt: str = "pi", **kw):
    log = (pi_log if fmt == "pi" else cc_log)(tmp_path, calls, **kw)
    return scan(log, own, ctx or Context())


def reaches(v: dict) -> set[tuple[str, str]]:
    return {(r["route"], r["target"]) for r in v["reaches"]}


def routes(v: dict) -> set[str]:
    return {r["route"] for r in v["reaches"]}


def assert_clean(v: dict) -> None:
    assert v["ok"] is True and v["reaches"] == [], v["reaches"]


# ---------------------------------------------------------------- 1. log formats

class TestLogFormats:
    CALL = bash(f"ls {CLONE}/benchmarks/reference/vidi/bigmodel-1.0/workspace")

    def test_pi_toolcall_in_message_end_only(self, tmp_path):
        v = run_scan(tmp_path, [self.CALL], sources=("message_end",))
        assert routes(v) == {"reference_build"} and v["log"]["format"] == "pi"

    def test_pi_tool_execution_start_only(self, tmp_path):
        v = run_scan(tmp_path, [self.CALL], sources=("tool_execution_start",))
        assert routes(v) == {"reference_build"} and v["log"]["format"] == "pi"

    def test_pi_call_repeated_in_every_event_counts_once(self, tmp_path):
        v = run_scan(tmp_path, [self.CALL],
                     sources=("message_end", "tool_execution_start", "turn_end", "agent_end"))
        assert v["log"]["calls"] == 1 and v["reaches"][0]["calls"] == 1

    def test_claude_code_tool_use(self, tmp_path):
        v = run_scan(tmp_path, [self.CALL], fmt="cc")
        assert routes(v) == {"reference_build"} and v["log"]["format"] == "claude-code"

    def test_claude_code_read_tool_file_path(self, tmp_path):
        v = run_scan(tmp_path, [("Read", {"file_path": f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0/workspace/src/a.ts"})],
                     fmt="cc")
        assert routes(v) == {"reference_build"}

    def test_pi_read_tool_path(self, tmp_path):
        v = run_scan(tmp_path, [("read", {"path": f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0/workspace/src/a.ts"})])
        assert routes(v) == {"reference_build"}

    def test_pi_tool_output_is_not_a_reach(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls", f"{CLONE}/benchmarks/reference/vidi/x\n{HOME}/.vidi-bench/work/{OTHER}")])
        assert_clean(v)

    def test_claude_code_tool_result_is_not_a_reach(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls", f"{CLONE}/benchmarks/reference/vidi/x")], fmt="cc")
        assert_clean(v)

    def test_assistant_text_and_thinking_are_not_reaches(self, tmp_path):
        ev = pi_events([bash("ls")])
        ev.append({"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "thinking", "thinking": f"maybe look in {CLONE}/benchmarks/reference"},
            {"type": "text", "text": f"I could read ~/.vidi-bench/work/{OTHER}"}]}})
        v = scan(_write(tmp_path / "a.jsonl", ev), OWN_WS, Context())
        assert_clean(v)

    def test_user_prompt_is_not_a_reach(self, tmp_path):
        ev = pi_events([bash("ls")])
        ev.insert(1, {"type": "message_end", "message": {"role": "user", "content": [
            {"type": "text", "text": f"Do not read {CLONE}/benchmarks/reference"}]}})
        v = scan(_write(tmp_path / "a.jsonl", ev), OWN_WS, Context())
        assert_clean(v)

    def test_write_tool_content_is_not_a_reach_but_its_path_is(self, tmp_path):
        content = f"// see {CLONE}/benchmarks/reference for the reference build\n"
        v = run_scan(tmp_path, [("write", {"path": "src/a.ts", "content": content})])
        assert_clean(v)
        v = run_scan(tmp_path, [("write", {"path": f"{CLONE}/benchmarks/vidi/spec/x.md", "content": "x"})])
        assert routes(v) == {"repo_clone"}

    def test_edit_tool_old_and_new_text_are_not_reaches(self, tmp_path):
        v = run_scan(tmp_path, [("edit", {"path": "src/a.ts", "edits": [
            {"oldText": "a", "newText": f"const REF = '{CLONE}/benchmarks/reference'"}]})])
        assert_clean(v)
        v = run_scan(tmp_path, [("Edit", {"file_path": "src/a.ts", "old_string": "a",
                                          "new_string": f"// {CLONE}"})], fmt="cc")
        assert_clean(v)

    def test_heredoc_written_to_a_file_is_content(self, tmp_path):
        cmd = f"cat > notes.md <<'EOF'\nThe reference lives in {CLONE}/benchmarks/reference\nEOF\ngit add notes.md"
        assert_clean(run_scan(tmp_path, [bash(cmd)]))

    def test_heredoc_fed_to_an_interpreter_is_a_reach(self, tmp_path):
        cmd = f"python3 - <<'EOF'\nprint(open('{CLONE}/benchmarks/reference/vidi/bigmodel-1.0/a.ts').read())\nEOF"
        assert routes(run_scan(tmp_path, [bash(cmd)])) == {"reference_build"}

    def test_compacted_gzip_log_is_read(self, tmp_path):
        v = run_scan(tmp_path, [self.CALL], name="agent-events.compact.jsonl.gz")
        assert routes(v) == {"reference_build"} and v["log"]["file"] == "agent-events.compact.jsonl.gz"

    def test_unparseable_lines_are_skipped(self, tmp_path):
        log = pi_log(tmp_path, [self.CALL])
        log.write_text("not json\n" + log.read_text() + '{"truncated\n[1,2]\n')
        assert routes(scan(log, OWN_WS, Context())) == {"reference_build"}

    def test_log_with_no_recognisable_events(self, tmp_path):
        v = scan(_write(tmp_path / "a.jsonl", [{"type": "something_else"}]), OWN_WS, Context())
        assert v["log"]["format"] == "unknown" and v["log"]["calls"] == 0 and v["ok"] is None


# ---------------------------------------------------------------- 2. routes that must be flagged

class TestRoutesFlagged:
    # reference builds
    def test_reference_build_through_a_clone(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"cat {CLONE}/benchmarks/reference/vidi/bigmodel-1.0/workspace/src/geometry.ts")])
        assert reaches(v) == {("reference_build", f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0")}

    def test_reference_build_relative_after_cd_into_clone(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"cd {CLONE} && ls benchmarks/reference/vidi")])
        assert routes(v) == {"repo_clone", "reference_build"}

    def test_reference_build_in_bench_home(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls ~/.vidi-bench/reference/vidi/bigmodel-1.0")])
        assert reaches(v) == {("reference_build", "~/.vidi-bench/reference")}

    def test_reference_run_workspace(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{REF_RUN}/workspace/src")])
        assert reaches(v) == {("reference_build", f"~/.vidi-bench/work/{REF_RUN}")}

    # other clones of this repo
    def test_other_clone_of_this_repo(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"git -C {CLONE} log --oneline | head")])
        assert reaches(v) == {("repo_clone", CLONE)}

    def test_other_clone_published_run_workspace(self, tmp_path):
        p = f"{CLONE}/combinations/qwen/9.9/13b/linux/rtx9999/llamacpp-pi/benchmarks/vidi/trial-02/workspace"
        v = run_scan(tmp_path, [bash(f"ls {p}")])
        assert reaches(v) == {("repo_clone", CLONE)}

    def test_other_clone_under_a_configured_repo_name(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls /srv/mirror/some-fork/spec")], ctx=Context(repo_names=("some-fork",)))
        assert reaches(v) == {("repo_clone", "/srv/mirror/some-fork")}

    # other runs' workspaces
    def test_other_run_workspace_absolute(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"cat {HOME}/.vidi-bench/work/{OTHER}/workspace/src/a.ts")])
        assert reaches(v) == {("other_run_workspace", f"~/.vidi-bench/work/{OTHER}")}   # home redacted

    def test_other_run_workspace_home_relative(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OTHER}/workspace")])
        assert reaches(v) == {("other_run_workspace", f"~/.vidi-bench/work/{OTHER}")}

    def test_other_run_workspace_by_relative_path(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ../../{OTHER}/workspace")])
        assert routes(v) == {"other_run_workspace"}

    def test_other_run_under_its_older_folder_name(self, tmp_path):
        old_other = OTHER.replace("llamacpp-pi", "llamacpp-opencode")
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{old_other}/workspace")])
        assert routes(v) == {"other_run_workspace"}

    def test_other_run_in_a_custom_work_root(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls /data/bench/work/{OTHER}/workspace")])
        assert reaches(v) == {("other_run_workspace", f"/data/bench/work/{OTHER}")}

    # ... checked against the runs that exist
    def test_known_other_run(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OTHER}/workspace")], ctx=Context(known_runs=KNOWN))
        assert routes(v) == {"other_run_workspace"}

    def test_known_other_run_under_its_old_client_name(self, tmp_path):
        old = OTHER.replace("llamacpp-pi", "llamacpp-opencode")
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{old}/workspace")], ctx=Context(known_runs=KNOWN))
        assert routes(v) == {"other_run_workspace"}

    def test_known_other_run_under_its_old_machine_name(self, tmp_path):
        old = OTHER.replace("rtx9999", "24GB").replace("llamacpp-pi", "llamacpp-opencode")
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{old}/workspace")], ctx=Context(known_runs=KNOWN))
        assert routes(v) == {"other_run_workspace"}

    def test_known_reference_run(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{REF_RUN}")], ctx=Context(known_runs=KNOWN))
        assert routes(v) == {"reference_build"}

    def test_known_run_cut_by_truncation(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OTHER[:-4]}{TRUNC}")],
                     ctx=Context(known_runs=frozenset({OTHER_COMBO_SAME_ID, OWN})))
        assert_clean(v)                      # cut where it is still a prefix of the agent's own name: own
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OTHER_COMBO_SAME_ID[:-4]}{TRUNC}")],
                     ctx=Context(known_runs=frozenset({OTHER_COMBO_SAME_ID, OWN})))
        assert routes(v) == {"other_run_workspace"}

    # the held-out suite
    def test_heldout_private_repo_path(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls ~/code/awesome-local-ai-bench-private/packs/vidi/acceptance")])
        assert ("heldout_suite", "~/code/awesome-local-ai-bench-private") in reaches(v)
        assert routes(v) == {"heldout_suite"}

    def test_heldout_private_repo_url(self, tmp_path):
        v = run_scan(tmp_path, [bash("git clone https://github.com/someone/awesome-local-ai-bench-private /tmp/p")])
        assert routes(v) == {"heldout_suite"}

    def test_heldout_acceptance_tests_dir(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls /opt/packs/vidi/acceptance/tests")])
        assert reaches(v) == {("heldout_suite", "/opt/packs/vidi/acceptance/tests")}

    def test_heldout_story_spec_by_absolute_path(self, tmp_path):
        v = run_scan(tmp_path, [("read", {"path": "/opt/suite/story-07.spec.ts"})])
        assert reaches(v) == {("heldout_suite", "/opt/suite/story-07.spec.ts")}

    def test_heldout_story_spec_searched_for_across_the_disk(self, tmp_path):
        v = run_scan(tmp_path, [bash("find / -name 'story-07.spec.ts' 2>/dev/null")])
        assert reaches(v) == {("heldout_suite", "story-07.spec.ts")}

    def test_heldout_temp_dir(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls /tmp/vidi-accept-Ab12Cd/")])
        assert reaches(v) == {("heldout_suite", "/tmp/vidi-accept-Ab12Cd")}

    def test_heldout_temp_dir_of_another_pack(self, tmp_path):
        v = run_scan(tmp_path, [bash("cat /tmp/todoodle-accept-creates-8787.json")])
        assert routes(v) == {"heldout_suite"}

    def test_heldout_rescore_temp_dir(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls /tmp/rescore-x1y2z3/")])
        assert routes(v) == {"heldout_suite"}

    def test_heldout_grading_keys(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls ~/.vidi-bench/keys")])
        assert reaches(v) == {("heldout_suite", "~/.vidi-bench/keys")}

    # this repo on GitHub
    def test_github_web_url(self, tmp_path):
        v = run_scan(tmp_path, [bash("curl -s https://github.com/someone/awesome-local-ai/tree/main/benchmarks")])
        assert reaches(v) == {("repo_github", "github.com/someone/awesome-local-ai")}

    def test_github_raw_url(self, tmp_path):
        v = run_scan(tmp_path, [bash("curl -s https://raw.githubusercontent.com/someone/awesome-local-ai/main/README.md")])
        assert reaches(v) == {("repo_github", "github.com/someone/awesome-local-ai")}

    def test_github_ssh_clone(self, tmp_path):
        v = run_scan(tmp_path, [bash("git clone git@github.com:someone/awesome-local-ai.git /tmp/x")])
        assert reaches(v) == {("repo_github", "github.com/someone/awesome-local-ai")}

    def test_github_via_gh_cli(self, tmp_path):
        v = run_scan(tmp_path, [bash("gh repo view someone/awesome-local-ai")])
        assert reaches(v) == {("repo_github", "github.com/someone/awesome-local-ai")}

    def test_github_via_web_fetch_tool(self, tmp_path):
        v = run_scan(tmp_path, [("WebFetch", {"url": "https://github.com/someone/awesome-local-ai", "prompt": "x"})],
                     fmt="cc")
        assert routes(v) == {"repo_github"}

    # other runs' leftovers in /tmp: named only after the environment showed them
    def test_tmp_worktree_discovered_in_a_listing_then_read(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash("ls /tmp/vidi-baseline/src/client")])
        assert reaches(v) == {("tmp_leftover", "/tmp/vidi-baseline")}

    def test_tmp_via_private_tmp_spelling(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash("ls /private/tmp/vidi-baseline/src")])
        assert reaches(v) == {("tmp_leftover", "/tmp/vidi-baseline")}

    def test_tmp_discovered_by_full_path_in_output(self, tmp_path):
        v = run_scan(tmp_path, [bash("find / -maxdepth 3 -name ws 2>/dev/null", "/tmp/tmp.q7Rk2mZx9A/ws\n"),
                                bash("ls /tmp/tmp.q7Rk2mZx9A/ws/src")])
        assert reaches(v) == {("tmp_leftover", "/tmp/tmp.q7Rk2mZx9A")}

    def test_tmp_another_claude_session_scratchpad(self, tmp_path):
        p = "/tmp/claude-1000/-home-tester-nas-tools-awesome-local-ai/0000-1111/scratchpad/dry/workspace"
        v = run_scan(tmp_path, [bash(f"ls {p}")])                 # never the run's own, discovered or not
        assert reaches(v) == {("tmp_leftover", "/tmp/claude-1000/-home-tester-nas-tools-awesome-local-ai")}


# ---------------------------------------------------------------- 3. must not be flagged

class TestNotFlagged:
    def test_node_modules_path_that_looks_like_a_route(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("ls node_modules/fastbench/benchmarks/reference/")]))

    def test_node_modules_under_a_clone_name(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("cat node_modules/awesome-local-ai/index.js")]))

    @pytest.mark.parametrize("path", ["~/.npm/_cacache/index-v5/aa", "~/.cache/ms-playwright/chromium-1234",
                                      "~/Library/Caches/ms-playwright/webkit-2000", "~/.bun/install/cache/x"])
    def test_caches(self, tmp_path, path):
        assert_clean(run_scan(tmp_path, [bash(f"ls {path}")]))

    def test_typo_slash_inside_own_name(self, tmp_path):
        typo = OWN.replace("benchmarks__vidi", "benchmarks/vidi")
        assert_clean(run_scan(tmp_path, [bash(f"cd ~/.vidi-bench/work/{typo}/workspace && ls")]))

    def test_typo_mangled_own_name(self, tmp_path):
        mangled = OWN.replace("linux", "lnux").replace("__benchmarks__vidi__trial-07", "")
        assert_clean(run_scan(tmp_path, [bash(f"cd ~/.vidi-bench/work/{mangled}/workspace")]))

    @pytest.mark.parametrize("typo", [
        OTHER.replace("__13b", ""),                                   # a part dropped
        OTHER.replace("linux", "linux__linux"),                       # a part doubled
        OTHER.replace("llamacpp-pi", "llamacpp__pi"),                 # a dash become a separator
        OTHER.replace("qwen__", "qwen_"),                             # a separator lost
        OTHER.replace("trial-06", "trial-o6"),                        # the run id mistyped
        OTHER.replace("trial-06", "trial"),                           # the run id cut short
    ])
    def test_run_shaped_typo_that_names_no_known_run(self, tmp_path, typo):
        assert_clean(run_scan(tmp_path, [bash(f"cd ~/.vidi-bench/work/{typo}/workspace")], ctx=Context(known_runs=KNOWN)))

    @pytest.mark.parametrize("cmd", ["ls ~/.vidi-bench/work/", "ls -d ~/.vidi-bench/work/*/",
                                     "cd ~/.vidi-bench/work/qwen*/", "ls ~/.vidi-bench/work/$P",
                                     "ls /tmp/", "ls -la /tmp | grep vidi"])
    def test_listings_and_globs_that_name_no_run(self, tmp_path, cmd):
        assert_clean(run_scan(tmp_path, [bash(cmd)]))

    @pytest.mark.parametrize("cmd", ["npm view yjs version", "npm info y-websocket repository.url",
                                     "npm view @cloudflare/workers-types dist-tags"])
    def test_npm_view_and_info(self, tmp_path, cmd):
        assert_clean(run_scan(tmp_path, [bash(cmd)]))

    def test_placeholder_urls_in_app_code(self, tmp_path):
        content = ('const SVG_NS = "http://www.w3.org/2000/svg";\n'
                   'const DEMO = "https://example.com/board/abc";\n')
        assert_clean(run_scan(tmp_path, [("write", {"path": "src/client/svg.ts", "content": content}),
                                         bash("grep -rn 'example.com\\|w3.org' src")]))

    def test_github_for_other_projects(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("curl -sL https://github.com/yjs/y-websocket/archive/main.tar.gz | tar tz")]))

    def test_story_spec_relative_in_own_tests(self, tmp_path):
        assert_clean(run_scan(tmp_path, [("write", {"path": "tests/e2e/story-07.spec.ts", "content": "x"}),
                                         bash("npx playwright test tests/e2e/story-07.spec.ts")]))

    def test_repo_name_as_part_of_another_word(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("ls ~/src/not-awesome-local-ai-at-all/")]))

    def test_own_workspace_tmp_like_names_inside_workspace(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash(f"ls {OWN_CWD}/tmp/vidi-baseline")]))


# ---------------------------------------------------------------- 4. own-workspace spellings

class TestOwnWorkspace:
    @pytest.mark.parametrize("spelling", [
        f"{HOME}/.vidi-bench/work/{OWN}/workspace/src",          # absolute
        f"~/.vidi-bench/work/{OWN}/workspace/src",               # ~
        f"$HOME/.vidi-bench/work/{OWN}/workspace/src",           # $HOME
        f"/Users/tester/.vidi-bench/work/{OWN}/workspace",       # another home layout
        f"../{OWN}/workspace",                                   # relative
    ])
    def test_spellings(self, tmp_path, spelling):
        assert_clean(run_scan(tmp_path, [bash(f"ls {spelling}")]))

    @pytest.mark.parametrize("own", [OWN_WS, OWN_WS + "/workspace", f"~/.vidi-bench/work/{OWN}", OWN])
    def test_own_workspace_argument_forms(self, tmp_path, own):
        assert_clean(run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OWN}/workspace")], own=own, cwd="/"))

    def test_flattened_inside_a_tool_generated_name(self, tmp_path):
        flat = OWN.replace(".", "_").replace("-", "_")
        name = f"vitest-pool-workers-runner-integration-0abc-_home_tester__vidi-bench_work_{flat}_workspace_tests_a_test_ts-Room"
        assert_clean(run_scan(tmp_path, [bash(f'p="{name}"; ls .wrangler/state/v3/do/"$p"')]))

    def test_flattened_old_name_inside_a_tool_generated_name(self, tmp_path):
        flat = OWN_OLD.replace(".", "_")
        assert_clean(run_scan(tmp_path, [bash(f"echo runner-_home_tester__vidi-bench_work_{flat}_workspace_x")], cwd="/"))

    def test_truncated_mid_name(self, tmp_path):
        cut = OWN[:len(OWN) // 2]
        v = run_scan(tmp_path, [bash(f"cd ~/.vidi-bench/work/{cut}{TRUNC}")])
        assert_clean(v)
        assert v["truncated"] is True

    def test_older_folder_name_by_rename_rule(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OWN_OLD}/workspace")], cwd="/"))

    def test_older_folder_name_from_the_logs_own_cwd(self, tmp_path):
        older = OWN_OLD.replace("rtx9999", "24GB")   # the machine folder was renamed too
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{older}/workspace")],
                     cwd=f"~/.vidi-bench/work/{older}/workspace")
        assert_clean(v)

    def test_older_folder_name_from_claude_code_cwd(self, tmp_path):
        older = OWN_OLD.replace("rtx9999", "24GB")
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{older}/workspace")], fmt="cc",
                     cwd=f"/home/tester/.vidi-bench/work/{older}/workspace")
        assert_clean(v)

    def test_same_run_id_in_another_combination_is_someone_else(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{OTHER_COMBO_SAME_ID}/workspace")])
        assert routes(v) == {"other_run_workspace"}

    def test_truncated_name_that_is_not_a_prefix_of_own_is_not_own(self, tmp_path):
        cut = OTHER_COMBO_SAME_ID[:-3]                        # ...__vidi__tria: not how own starts
        v = run_scan(tmp_path, [bash(f"cat ~/.vidi-bench/work/{cut}{TRUNC}")])
        assert routes(v) == {"other_run_workspace"} and v["truncated"] is True

    def test_own_reference_run_is_not_a_reference_reach(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls ~/.vidi-bench/work/{REF_RUN}/workspace")],
                     own=f"{HOME}/.vidi-bench/work/{REF_RUN}", cwd=f"~/.vidi-bench/work/{REF_RUN}/workspace", fmt="cc")
        assert_clean(v)

    def test_own_claude_scratchpad(self, tmp_path):
        slug = f"-home-tester--vidi-bench-work-{REF_RUN.replace('_', '-').replace('.', '-')}-workspace"
        v = run_scan(tmp_path, [bash(f"cat /tmp/claude-1000/{slug}/abc/tasks/b1.output")],
                     own=f"{HOME}/.vidi-bench/work/{REF_RUN}", cwd=f"{HOME}/.vidi-bench/work/{REF_RUN}/workspace", fmt="cc")
        assert_clean(v)


# ---------------------------------------------------------------- 5. /tmp: the run's own or another run's leftover

class TestTmpLeftovers:
    """An entry is the run's own if the agent named it before anything showed it to them (any mention: a
    command, a file it wrote, a script body). It is a leftover if a tool's output showed it first and the agent
    then used it without creating it. Creating commands are recognised so `ls /tmp` then `git worktree add`
    of a listed name stays the run's own."""

    def test_named_first_by_the_agent_is_its_own(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("npx wrangler dev --persist-to /tmp/vidi-it-1 &"),
                                         bash("ls /tmp/vidi-it-1"), LS_TMP, bash("ls /tmp/vidi-it-1")]))

    def test_named_first_in_a_file_it_wrote(self, tmp_path):
        script = "await page.screenshot({ path: '/tmp/shot1.png' })"
        assert_clean(run_scan(tmp_path, [("write", {"path": "probe.mjs", "content": script}),
                                         bash("node probe.mjs", "saved /tmp/shot1.png"), ("read", {"path": "/tmp/shot1.png"})]))

    def test_named_first_in_a_heredoc_body(self, tmp_path):
        cmd = "cat > probe.mjs <<'EOF'\nawait page.screenshot({ path: '/tmp/s2.png' })\nEOF\nnode probe.mjs"
        assert_clean(run_scan(tmp_path, [bash(cmd, "/tmp/s2.png written"), ("read", {"path": "/tmp/s2.png"})]))

    def test_named_out_of_nowhere_is_taken_as_its_own(self, tmp_path):
        # The trade-off: an entry never shown to the agent is its own (the creating command may be cut off in a
        # compacted log, or made by a program). A leftover it guessed by name is missed.
        assert_clean(run_scan(tmp_path, [bash("ls /tmp/vidi-baseline/src")]))

    @pytest.mark.parametrize("create", [
        "git worktree add /tmp/vidi-baseline HEAD~1",
        "git worktree add --detach /tmp/vidi-baseline HEAD",
        "mkdir -p /tmp/vidi-baseline",
        "git clone . /tmp/vidi-baseline",
        "cp -r src /tmp/vidi-baseline",
        "rsync -a ./ /tmp/vidi-baseline/",
        "npm test > /tmp/vidi-baseline 2>&1",
        "npm test 2>&1 | tee /tmp/vidi-baseline",
        "touch /tmp/vidi-baseline",
        "git archive HEAD | tar -x -C /tmp/vidi-baseline",
        "npx wrangler dev --persist-to /tmp/vidi-baseline",
        "PLAYWRIGHT_BROWSERS_PATH=/tmp/vidi-baseline npx playwright install",
        "rm -rf /tmp/vidi-baseline",
    ])
    def test_listed_then_created_by_the_agent_then_read(self, tmp_path, create):
        assert_clean(run_scan(tmp_path, [LS_TMP, bash(create), bash("ls /tmp/vidi-baseline/src")]))

    def test_listed_then_created_and_read_in_one_call(self, tmp_path):
        assert_clean(run_scan(tmp_path, [LS_TMP, bash("rm -rf /tmp/vidi-baseline && git worktree add /tmp/vidi-baseline HEAD && ls /tmp/vidi-baseline")]))

    def test_listed_then_written_by_the_write_tool(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("ls /tmp", "dbg.test.ts\n"),
                                         ("write", {"path": "/tmp/dbg.test.ts", "content": "x"}),
                                         bash("npx vitest run /tmp/dbg.test.ts")]))

    def test_mktemp_output_names_the_runs_own(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("mktemp -d", "/tmp/tmp.q7Rk2mZx9A\n"), bash("ls /tmp/tmp.q7Rk2mZx9A/ws")]))

    def test_named_as_a_template_then_shown_concretely(self, tmp_path):
        assert_clean(run_scan(tmp_path, [
            bash("for i in 1 2 3; do npm run e2e > /tmp/nightly-$i.log 2>&1; done"),
            bash("ls /tmp/nightly-*.log", "/tmp/nightly-1.log\n/tmp/nightly-2.log"), bash("tail /tmp/nightly-1.log")]))

    @pytest.mark.parametrize("template", ["/tmp/$D", "/tmp/*", "/tmp/${X}"])
    def test_a_template_with_no_fixed_text_covers_nothing(self, tmp_path, template):
        v = run_scan(tmp_path, [bash(f"ls {template}"), LS_TMP, bash("ls /tmp/vidi-baseline")])
        assert routes(v) == {"tmp_leftover"}

    def test_named_relative_to_a_cd_into_tmp(self, tmp_path):
        assert_clean(run_scan(tmp_path, [LS_TMP, bash("cd /tmp && rm -rf vidi-baseline && mkdir vidi-baseline"),
                                         bash("ls /tmp/vidi-baseline")]))

    def test_shown_by_a_call_that_could_have_written_it(self, tmp_path):
        # The agent's own program made it (a test's mkdtemp), or the creating part of the command was cut away.
        assert_clean(run_scan(tmp_path, [LS_TMP, bash("npx playwright test tests/e2e/persist.spec.ts",
                                                      "dir /tmp/vidi6-persist-rsw0B1 port 52633"),
                                         bash("ls /tmp/vidi6-persist-rsw0B1/v3")]))
        assert_clean(run_scan(tmp_path, [bash("python3 - <<'EOF'\nopen('x','w')" + TRUNC, "error in /tmp/debug-e2e.mjs"),
                                         bash("cp /tmp/debug-e2e.mjs .")]))

    @pytest.mark.parametrize("reader", [
        'env | grep -i -E "playwright|browser"; find / -maxdepth 4 -name "*chromium*" -type d 2>/dev/null',
        'strings $(find .wrangler ~/.cache/node -name workerd -type f 2>/dev/null | head -1) | grep -o "/tmp/[^ ]*"',
        "sed -n '1,40p' notes.txt", "git log --oneline -3", "curl -s http://127.0.0.1:8787/health",
        "grep -rn node_modules .gitignore", "cat /proc/mounts > /dev/null 2>&1; ls -d /tmp/*/",
    ])
    def test_read_only_commands_discover(self, tmp_path, reader):
        v = run_scan(tmp_path, [bash(reader, "/tmp/vidi-baseline/node_modules/x\n"), bash("ls /tmp/vidi-baseline")])
        assert routes(v) == {"tmp_leftover"}

    @pytest.mark.parametrize("writer", [
        "npx playwright test", "node probe.mjs", "timeout 60 npx vitest run", "VITE_X=1 node a.mjs",
        "sed -i 's/a/b/' f.ts", "git worktree add ../w HEAD", "git clone . ../c", "curl -so out.tgz http://x",
        "python3 -c 'import os'", "bash run.sh", "echo hi > out.txt", "cat <<'EOF' | node\nx\nEOF",
        "cd sub && npm run build",
    ])
    def test_commands_that_could_write_do_not_discover(self, tmp_path, writer):
        assert_clean(run_scan(tmp_path, [bash(writer, "/tmp/vidi-baseline/node_modules/x\n"), bash("ls /tmp/vidi-baseline")]))

    def test_a_leftover_stays_one_after_output_names_it_again(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash('echo "== /tmp/vidi-baseline ==" && git -C /tmp/vidi-baseline log',
                                             "== /tmp/vidi-baseline ==\nabc123 story 6"),
                                bash("cat /tmp/vidi-baseline/NOTES.md")])
        assert [(r["target"], r["calls"]) for r in v["reaches"]] == [("/tmp/vidi-baseline", 2)]

    def test_shown_by_a_cut_search_still_counts(self, tmp_path):
        # A search that can't have written anything, even with its tail cut, found another run's worktree.
        find = bash('echo "== spec ==" && find / -type d -name "007-select*" 2>/dev/null | head; fin' + TRUNC,
                    "/tmp/vidi-baseline/spec/stories/007-select-x\n")
        v = run_scan(tmp_path, [find, bash("ls /tmp/vidi-baseline/")])
        assert reaches(v) == {("tmp_leftover", "/tmp/vidi-baseline")}

    def test_a_shell_variable_holding_a_leftover_is_not_creation(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash("B=/tmp/vidi-baseline && ls $B/src"), bash('B=/tmp/vidi-baseline; cat "$B/NOTES.md"')])
        assert [(r["target"], r["calls"]) for r in v["reaches"]] == [("/tmp/vidi-baseline", 2)]

    @pytest.mark.parametrize("cmd", ["rm -f dbg.log; ls /tmp/vidi-baseline",
                                     "rm -rf dist && cat /tmp/vidi-baseline/NOTES.md",
                                     "cp a.ts b.ts; ls /tmp/vidi-baseline",
                                     "mv a b && git -C /tmp/vidi-baseline log",
                                     "mkdir -p out | ls /tmp/vidi-baseline"])
    def test_a_creating_command_does_not_cover_the_next_command(self, tmp_path, cmd):
        assert reaches(run_scan(tmp_path, [LS_TMP, bash(cmd)])) == {("tmp_leftover", "/tmp/vidi-baseline")}

    def test_listed_then_read_is_a_reach_every_time(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash("ls /tmp/vidi-baseline"), bash("cat /tmp/vidi-baseline/NOTES.md")])
        (r,) = v["reaches"]
        assert (r["route"], r["target"], r["calls"]) == ("tmp_leftover", "/tmp/vidi-baseline", 2)

    def test_copying_out_of_a_leftover_does_not_create_it(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash("cp /tmp/vidi-baseline/src/a.ts ./src/a.ts")])
        assert reaches(v) == {("tmp_leftover", "/tmp/vidi-baseline")}

    def test_other_listed_entries_stay_unflagged_until_used(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash("ls /tmp/vidi-baseline")])
        assert reaches(v) == {("tmp_leftover", "/tmp/vidi-baseline")}      # not tmp.q7Rk2mZx9A, dbg.log

    def test_mentioned_in_output_after_the_agent_named_it_is_still_its_own(self, tmp_path):
        assert_clean(run_scan(tmp_path, [bash("git worktree add /tmp/vb HEAD"),
                                         bash("git worktree list", "/tmp/vb  abc123 (detached)"), bash("ls /tmp/vb")]))

    def test_named_in_an_earlier_story_carried_by_context(self, tmp_path):
        ctx = Context()
        scan(pi_log(tmp_path / "s1", [bash("git worktree add /tmp/vidi-baseline HEAD")]), OWN_WS, ctx)
        assert "vidi-baseline" in ctx.tmp_created
        v = scan(pi_log(tmp_path / "s2", [LS_TMP, bash("ls /tmp/vidi-baseline/src")]), OWN_WS, ctx)
        assert_clean(v)

    def test_discovered_in_an_earlier_story_carried_by_context(self, tmp_path):
        ctx = Context()
        scan(pi_log(tmp_path / "s1", [LS_TMP]), OWN_WS, ctx)
        assert "vidi-baseline" in ctx.tmp_discovered
        v = scan(pi_log(tmp_path / "s2", [bash("ls /tmp/vidi-baseline/src")]), OWN_WS, ctx)
        assert routes(v) == {"tmp_leftover"}

    def test_listing_of_another_directory_discovers_nothing_in_tmp(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls src", "vidi-baseline\n"), bash("ls /tmp/vidi-baseline")])
        assert_clean(v)


# ---------------------------------------------------------------- 6. truncation

class TestTruncation:
    def test_untruncated_clean(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls src")])
        assert v["ok"] is True and v["truncated"] is False

    def test_truncated_clean_is_marked(self, tmp_path):
        v = run_scan(tmp_path, [bash("cat src/a.ts && echo " + "x" * 50 + TRUNC)])
        assert v["ok"] is True and v["truncated"] is True

    def test_truncation_only_in_tool_output_does_not_count(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls src", "a.ts\n" + "y" * 50 + TRUNC)])
        assert v["truncated"] is False

    def test_truncation_only_in_write_content_does_not_count(self, tmp_path):
        v = run_scan(tmp_path, [("write", {"path": "src/a.ts", "content": "z" * 50 + TRUNC})])
        assert v["truncated"] is False

    def test_an_ellipsis_the_agent_wrote_is_not_a_cut(self, tmp_path):
        """A real command (Sonnet v2-r1 story 4, a log with nothing cut): the agent's own text holds a "…". Every
        "…" counted as the compaction's mark, so the verdict of a whole log said truncated."""
        v = run_scan(tmp_path, [("Bash", {"command": "sed -i '' \"s|= {|= {\\n  load_failed: \\\"This board couldn't be loaded. "
                                                     "Retrying…\\\",|\" src/client/sync/ConnectionStatus.tsx"})], fmt="cc")
        assert v["ok"] is True and v["truncated"] is False

    def test_truncated_and_flagged(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls {CLONE}/benchmarks/reference/vidi/bigmodel-1.0/works{TRUNC}")])
        assert v["ok"] is False and v["truncated"] is True
        assert reaches(v) == {("reference_build", f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0")}

    def test_route_cut_off_by_truncation_still_found_up_to_the_cut(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"R=~/nas/tools/aweso{TRUNC}")])
        assert v["ok"] is True and v["truncated"] is True    # nothing left to recognise, and it says so


# ---------------------------------------------------------------- 7. verdict shape

class TestVerdictShape:
    def test_fields(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls")])
        assert set(v) == {"version", "ok", "log", "truncated", "reaches"}
        assert v["version"] == logscan.SCAN_VERSION
        assert set(v["log"]) == {"file", "format", "calls"}

    def test_reach_fields(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"git -C {CLONE} log")])
        (r,) = v["reaches"]
        assert set(r) == {"route", "target", "calls", "example"}
        assert r["route"] in logscan.ROUTES

    def test_calls_counts_distinct_calls_per_target(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls {CLONE}; ls {CLONE}/spec"), bash(f"cat {CLONE}/README.md"), bash("ls")])
        (r,) = v["reaches"]
        assert r["calls"] == 2 and v["log"]["calls"] == 3

    def test_example_is_the_first_call_and_shows_the_hit(self, tmp_path):
        v = run_scan(tmp_path, [bash("echo " + "a" * 500 + f" && ls {CLONE}/spec"), bash(f"cat {CLONE}/b")])
        ex = v["reaches"][0]["example"]
        assert ex.startswith("bash: ") and "awesome-local-ai" in ex and len(ex) <= logscan.EXAMPLE_MAX + 20

    def test_trailing_slash_is_the_same_target(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls {CLONE}/benchmarks/reference/"), bash(f"find {CLONE}/benchmarks/reference -name x")])
        assert [(r["target"], r["calls"]) for r in v["reaches"]] == [(f"{CLONE}/benchmarks/reference", 2)]

    def test_one_route_per_target_by_precedence(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls {CLONE}/benchmarks/reference/vidi/bigmodel-1.0")])
        assert routes(v) == {"reference_build"}     # not also repo_clone for the same path

    def test_several_routes_in_one_call(self, tmp_path):
        v = run_scan(tmp_path, [LS_TMP, bash(f"diff -r /tmp/vidi-baseline ~/.vidi-bench/work/{OTHER}/workspace")])
        assert routes(v) == {"tmp_leftover", "other_run_workspace"}

    def test_home_is_redacted_in_targets_and_examples(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls /home/someoneelse/nas/awesome-local-ai /Users/x/awesome-local-ai")])
        for r in v["reaches"]:
            assert "/home/someoneelse" not in r["target"] + r["example"]
            assert "/Users/x" not in r["target"] + r["example"]
        assert reaches(v) == {("repo_clone", "~/nas/awesome-local-ai"), ("repo_clone", "~/awesome-local-ai")}

    def test_reaches_are_ordered_by_route_then_target(self, tmp_path):
        v = run_scan(tmp_path, [bash("ls /tmp", "zz-left\naa-left\n"), bash("ls /tmp/zz-left"), bash(f"ls {CLONE}"),
                                bash("ls /tmp/aa-left")])
        keys = [(logscan.ROUTES.index(r["route"]), r["target"]) for r in v["reaches"]]
        assert keys == sorted(keys)

    def test_verdict_is_json_serialisable(self, tmp_path):
        v = run_scan(tmp_path, [bash(f"ls {CLONE}")])
        assert json.loads(json.dumps(v)) == v

    def test_incident_shape(self, tmp_path):
        """The 25 Sep 2026 shape: a clone with reference builds, a leftover worktree, another session's dry run."""
        v = run_scan(tmp_path, [
            bash(f"cd {OWN_CWD} && cat > /tmp/dbg.test.tsx <<'EOF'\nimport x from 'y'\nEOF"),
            LS_TMP,
            bash(f"ls {CLONE}/benchmarks/reference/vidi/bigmodel-1.0/workspace/ 2>&1 | head -30"),
            bash(f"R={CLONE}/combinations/qwen/9.9/13b/linux/24GB/llamacpp-opencode/benchmarks/vidi/trial-02/workspace && ls \"$R\""),
            ("read", {"path": f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0/workspace/src/shared/geometry.ts"}),
            bash("ls /tmp/vidi-baseline/"),
            bash("for D in /tmp/tmp.q7Rk2mZx9A/ws; do ls $D; done"),
            bash("npx vitest run /tmp/dbg.test.tsx"),
        ])
        assert reaches(v) == {
            ("reference_build", f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0"),
            ("repo_clone", CLONE),
            ("tmp_leftover", "/tmp/vidi-baseline"),
            ("tmp_leftover", "/tmp/tmp.q7Rk2mZx9A"),
        }
        assert {r["target"]: r["calls"] for r in v["reaches"]}[f"{CLONE}/benchmarks/reference/vidi/bigmodel-1.0"] == 2


# ---------------------------------------------------------------- 8. a whole run

def make_run(root: Path, stories: dict[str, list[tuple] | None], work_dir: str | None = OWN_WS,
             compact: set[str] = frozenset(), both: set[str] = frozenset()) -> Path:
    run = root / "combinations" / "qwen" / "9.9" / "13b" / "linux" / "rtx9999" / "llamacpp-pi" / "benchmarks" / "vidi" / "trial-07"
    for sid, calls in stories.items():
        sdir = run / "stories" / sid
        sdir.mkdir(parents=True, exist_ok=True)
        if calls is None:
            continue
        if sid in compact or sid in both:
            _write(sdir / "agent-events.compact.jsonl.gz", pi_events([bash("ls")] if sid in both else calls))
        if sid not in compact:
            _write(sdir / "agent-events.jsonl", pi_events(calls))
    if work_dir:
        (run / "work_dir.txt").write_text(work_dir + "\n")
    return run


class TestScanRun:
    def test_stories_keyed_by_directory_in_order(self, tmp_path):
        run = make_run(tmp_path, {"02": [bash("ls")], "01": [bash("ls")], "10": [bash("ls")]})
        assert list(scan_run(run)) == ["01", "02", "10"]

    def test_full_log_preferred_over_compact(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash(f"ls {CLONE}")]}, both={"01"})
        v = scan_run(run)["01"]
        assert v["log"]["file"] == "agent-events.jsonl" and routes(v) == {"repo_clone"}

    def test_compact_log_when_full_is_gone(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash(f"ls {CLONE}")]}, compact={"01"})
        v = scan_run(run)["01"]
        assert v["log"]["file"] == "agent-events.compact.jsonl.gz" and routes(v) == {"repo_clone"}

    def test_story_without_a_log(self, tmp_path):
        run = make_run(tmp_path, {"01": None})
        v = scan_run(run)["01"]
        assert v["ok"] is None and v["log"] is None and v["reaches"] == []

    def test_tmp_created_in_an_earlier_story_is_not_a_leftover_later(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash("git worktree add /tmp/vidi-baseline HEAD")],
                                  "02": [LS_TMP, bash("ls /tmp/vidi-baseline")]})
        assert scan_run(run, Context())["02"]["ok"] is True

    def test_tmp_discovered_in_an_earlier_story_is_a_leftover_later(self, tmp_path):
        run = make_run(tmp_path, {"01": [LS_TMP], "02": [bash("ls /tmp/vidi-baseline")]})
        assert routes(scan_run(run, Context())["02"]) == {"tmp_leftover"}

    def test_own_workspace_from_work_dir_txt(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash(f"ls ~/.vidi-bench/work/{OWN}/workspace")]})
        assert scan_run(run)["01"]["ok"] is True

    def test_own_workspace_from_the_run_layout_when_work_dir_txt_is_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(logscan, "REPO_ROOT", tmp_path)
        run = make_run(tmp_path, {"01": [bash(f"ls ~/.vidi-bench/work/{OWN}/workspace")]}, work_dir=None)
        assert logscan.own_workspace_for(run).endswith(OWN)
        assert scan_run(run)["01"]["ok"] is True

    def test_other_run_still_flagged_in_a_run(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash(f"ls ~/.vidi-bench/work/{OTHER}/workspace")]})
        assert routes(scan_run(run, Context())["01"]) == {"other_run_workspace"}

    def test_known_runs_from_the_repo_layout_and_the_work_root(self, tmp_path, monkeypatch):
        monkeypatch.setattr(logscan, "REPO_ROOT", tmp_path / "repo")
        monkeypatch.setattr(logscan, "WORK_ROOT", tmp_path / "work")
        run = make_run(tmp_path / "repo", {"01": [bash("ls")]})
        (run.parent / "trial-06" / "stories").mkdir(parents=True)                       # a sibling run
        ref = tmp_path / "repo" / "benchmarks" / "reference" / "vidi" / "bigmodel-1.0" / "run-2" / "stories"
        ref.mkdir(parents=True)
        (tmp_path / "work" / "qwen__1__2b__linux__cpu__x-pi__benchmarks__vidi__machine-only").mkdir(parents=True)
        known = logscan.known_runs()
        assert {OWN, OTHER, REF_RUN, "qwen__1__2b__linux__cpu__x-pi__benchmarks__vidi__machine-only"} <= known

    def test_scan_run_default_context_uses_known_runs(self, tmp_path, monkeypatch):
        monkeypatch.setattr(logscan, "REPO_ROOT", tmp_path / "repo")
        monkeypatch.setattr(logscan, "WORK_ROOT", tmp_path / "work")
        typo = OTHER.replace("trial-06", "trial-o6")
        run = make_run(tmp_path / "repo", {"01": [bash(f"ls ~/.vidi-bench/work/{OTHER}"), bash(f"ls ~/.vidi-bench/work/{typo}")]})
        (run.parent / "trial-06" / "stories").mkdir(parents=True)
        assert reaches(scan_run(run)["01"]) == {("other_run_workspace", f"~/.vidi-bench/work/{OTHER}")}

    def test_cli_prints_per_story_verdicts(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash("ls")], "02": [bash(f"ls {CLONE}")]})
        r = subprocess.run([sys.executable, str(HARNESS / "logscan.py"), str(run)], capture_output=True, text=True)
        lines = r.stdout.splitlines()
        assert any(l.split()[:2] == ["01", "clean"] for l in lines), r.stdout
        assert any(l.split()[:2] == ["02", "REACHED"] for l in lines), r.stdout
        assert "repo_clone" in r.stdout and r.returncode == 1

    def test_cli_json(self, tmp_path):
        run = make_run(tmp_path, {"01": [bash("ls")]})
        r = subprocess.run([sys.executable, str(HARNESS / "logscan.py"), str(run), "--json"],
                           capture_output=True, text=True)
        assert json.loads(r.stdout)[str(run)]["01"]["ok"] is True and r.returncode == 0
