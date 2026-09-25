"""peek_audit: did an agent touch anything outside its own workspace?"""
import json
from pathlib import Path

import peek_audit as pa

WS = "/home/u/.vidi-bench/reference/run2/workspace"
PACK = "/home/u/src/awesome-local-ai-bench-private"
REPO = "/home/u/src/awesome-local-ai"


def cc_line(name: str, inp: dict) -> str:
    """One Claude Code transcript line holding a tool call."""
    return json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]}})


def pi_line(name: str, args: dict) -> str:
    return json.dumps({"type": "tool_execution_start", "toolName": name, "args": args})


def audit(tmp_path: Path, *lines: str):
    t = tmp_path / "t.jsonl"
    t.write_text("\n".join(lines) + "\n")
    return pa.audit([t], allowed=[WS, "/home/u/.vidi-bench/reference/run2/remote"], sensitive=[PACK, REPO])


def test_clean_session_has_no_findings(tmp_path):
    r = audit(tmp_path,
              cc_line("Read", {"file_path": f"{WS}/spec/stories/001/prd.md"}),
              cc_line("Bash", {"command": f"git -C {WS} status && /home/u/.vidi-bench/reference/run2/remote npm test"}),
              pi_line("read", {"path": f"{WS}/src/a.ts"}))
    assert r.peeks == [] and r.tool_calls == 3


def test_reading_the_held_out_suite_is_a_peek(tmp_path):
    r = audit(tmp_path, cc_line("Read", {"file_path": f"{PACK}/packs/vidi/acceptance/tests/story-01.spec.ts"}))
    assert len(r.peeks) == 1 and "acceptance" in r.peeks[0].path


def test_search_and_shell_access_count_too(tmp_path):
    r = audit(tmp_path,
              cc_line("Grep", {"pattern": "zoom", "path": f"{REPO}/benchmarks"}),
              cc_line("Glob", {"pattern": "**/*.ts", "path": PACK}),
              cc_line("Bash", {"command": f"cat {REPO}/combinations/x/workspace/src/app.ts | head"}),
              pi_line("bash", {"command": f"ls {PACK}/packs"}))
    assert len(r.peeks) == 4


def test_relative_climbs_are_resolved_against_the_cd(tmp_path):
    """`cd <ws>; ../remote` is the allowed wrapper; `cd <ws>; cat ../../other/file` goes outside."""
    r = audit(tmp_path, cc_line("Bash", {"command": f"cd {WS} && ../remote npm test"}))
    assert r.review == [] and r.peeks == []
    r = audit(tmp_path, cc_line("Bash", {"command": f"cd {WS} && cat ../../other/file"}))
    assert r.peeks == [] and [f.path for f in r.review] == ["/home/u/.vidi-bench/reference/other/file"]
    r = audit(tmp_path, cc_line("Bash", {"command": f"cd {WS} && cat ../../../../src/awesome-local-ai/README.md"}))
    assert len(r.peeks) == 1


def test_a_climb_with_no_known_base_is_reviewed(tmp_path):
    r = audit(tmp_path, cc_line("Bash", {"command": "cat ../x"}))
    assert r.peeks == [] and len(r.review) == 1


def test_unknown_outside_paths_are_reported_not_peeks(tmp_path):
    r = audit(tmp_path, cc_line("Read", {"file_path": "/tmp/scratch/shot.png"}))
    assert r.peeks == [] and [f.path for f in r.review] == ["/tmp/scratch/shot.png"]


def test_shell_variables_are_expanded_before_classifying(tmp_path):
    """Agents write W=<ws>; cat "$W"/prd.md -- that is inside the workspace, not a stray '/prd.md'.
    And P=<pack>; cat $P/x is still a peek."""
    r = audit(tmp_path,
              cc_line("Bash", {"command": f'W={WS}; cat "$W"/spec/prd.md ${{W}}/tasks.md'}),
              cc_line("Bash", {"command": f"P={PACK}/packs; cat $P/vidi/acceptance/tests/story-01.spec.ts"}))
    assert r.review == [] and r.peeks and all(PACK in f.path for f in r.peeks)


def test_system_paths_and_glob_fragments_are_not_findings(tmp_path):
    r = audit(tmp_path, cc_line("Bash", {"command": f"cd {WS} && ls src/**/*.ts 2>/dev/null; find . -name '*.tsx' | head; echo //"}))
    assert r.review == [] and r.peeks == []


def test_heredoc_bodies_are_data_not_paths(tmp_path):
    """`cat > f <<'EOF' ... EOF` writes a file; routes and markup inside it are not paths the agent read."""
    cmd = f"cd {WS} && cat > src/a.tsx <<'EOF'\nreturn <div><a href=\"/b/x\">go</a></div>;\nfetch('/api/boards/1')\nEOF\nnpm test"
    r = audit(tmp_path, cc_line("Bash", {"command": cmd}))
    assert r.review == [] and r.peeks == []


def test_quoted_relative_imports_are_not_peeks(tmp_path):
    """grep/sed over code: '../../src/app' is an import string, not a path the command opens."""
    r = audit(tmp_path, cc_line("Bash", {"command": f"cd {WS}/tests && grep -rn \"from '../../../../../src/awesome-local-ai/x'\" ."}))
    assert r.peeks == [] and len(r.review) == 1
