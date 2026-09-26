"""TELEMETRY.md must name every field the harness records. A field added to the code without a line in
the doc fails here, so the doc can't quietly fall behind. Fields are taken from the code itself:
the recorders' real outputs where they are pure functions, else the source's own dict keys."""
import inspect
import json
import re
from pathlib import Path

import drive
import gates
import hostenv
import llama_log
from test_hostenv import fake_amdgpu

DOC = Path(__file__).resolve().parent.parent / "TELEMETRY.md"


def undocumented(keys) -> list[str]:
    text = DOC.read_text()
    return sorted(k for k in set(keys) if f"`{k}`" not in text)


def keys(d: dict, deep: bool = True) -> set[str]:
    out = set()
    for k, v in d.items():
        out.add(k)
        if deep and isinstance(v, dict) and not k.startswith(("by_story", "tools_by_kind", "decode_by_context")):
            out |= keys(v)
    return out


def test_run_json_fields():
    block = re.search(r'cat > "\$RUN_DIR/run.json".*?\nJSON', (drive.HARNESS / "run.sh").read_text(), re.S).group(0)
    assert undocumented(re.findall(r'"(\w+)": ', block)) == []


def test_story_record_fields():
    src = inspect.getsource(drive)
    top = set(re.findall(r'rec\["(\w+)"\]', src)) | {"title", "status", "ended_by", "partial_base", "tasks",
                                                       "conditions_start"}
    assert undocumented(top) == []


def test_agent_fields():
    src = inspect.getsource(drive.run_story_agent)
    fields = set(re.findall(r'"(\w+)":', src)) | {"seconds", "steps", "tool_calls", "compactions",
                                                  "tool_interruptions", "tokens"}
    tokens = {"input", "output", "reasoning", "cache_read", "cache_write"}
    assert undocumented(fields | tokens) == []


def test_condition_and_gpu_fields(tmp_path):
    src = inspect.getsource(drive.ConditionSampler.stop)
    fields = set(re.findall(r'"(\w+)":', src)) | keys(drive.summarise_conditions(1, []))
    fields |= keys(hostenv.summarise_gpu([hostenv.amdgpu_sample(fake_amdgpu(tmp_path))]))
    fields |= keys(hostenv.summarise_gpu([hostenv.parse_nvidia_gpu("98, 2745, 3105, 405.08, 68, 22622, 0x0\n")]))
    fields |= {"ac", "low_power", "thermal"}   # drive.conditions(): live readings, not callable in a test
    assert undocumented(fields) == []


def test_time_split_and_server_fields(tmp_path):
    ev = tmp_path / "e.jsonl"
    ev.write_text("")
    log = tmp_path / "server.log"
    log.write_text(llama_log.start_marker(0) +
                   "0.00.001.000 I slot print_timing: id  0 | task 0 | prompt eval time = 1.00 ms /  1 tokens (x)\n"
                   "0.00.001.000 I slot print_timing: id  0 | task 0 |        eval time = 1.00 ms /  1 tokens (x)\n")
    fields = keys(drive.time_split(ev, log, 0, 10))
    fields |= set(re.findall(r'"(\w+)":', inspect.getsource(drive.server_stats)))
    assert undocumented(fields) == []


def test_gate_and_acceptance_fields(tmp_path):
    fields = keys(gates.accept(tmp_path, [], tmp_path / "o", None), deep=False)
    fields |= {"steps", "all_green", "harness_fault", "cmd", "exit", "seconds", "tail", "passed", "failed",
               "browser_install"}
    assert undocumented(fields) == []
