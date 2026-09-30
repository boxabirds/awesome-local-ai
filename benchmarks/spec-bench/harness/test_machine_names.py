"""machine_names.py: the owner's own machine names never reach the public repo.

A machine's name is personal setup: the public name for a machine is its hardware. The names live only in the
local, git-ignored dbench node list (~/.config/dbench/nodes.toml) and in the machine's own hostname, so they are
read at run time and never written into this repo. Every name here is made up.

MECE by what the module decides:
  A. which names are local: the node list's names, the machine's hostname (full and short), minus generic ones
  B. what counts as a name in a text: whole names, any case, whatever separates them
  C. which files are checked: everything the harness writes, not the agent's own work
  D. the repo check: tracked files outside the agent's work, skipped without a node list
Run: uv run --with pytest pytest test_machine_names.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

import machine_names as mn

NODES = """[nodes.node-a]
url = "http://node-a:7717"
token = "not-a-real-token"

[nodes.boxwood]
url = "http://100.64.0.2:7717"
"""
G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]


def nodes_file(tmp_path: Path, text: str = NODES) -> Path:
    p = tmp_path / "nodes.toml"
    p.write_text(text)
    return p


# ---------- A. which names are local ----------

def test_A1_the_node_lists_names_are_its_table_keys_not_its_urls_or_tokens(tmp_path):
    assert mn.node_names(nodes_file(tmp_path)) == {"node-a", "boxwood"}


def test_A2_without_a_node_list_there_are_no_node_names(tmp_path):
    assert mn.node_names(tmp_path / "absent.toml") == set()


def test_A3_a_node_list_with_no_nodes_table_has_no_names(tmp_path):
    assert mn.node_names(nodes_file(tmp_path, "# nothing yet\n")) == set()


def test_A4_an_unreadable_node_list_is_an_error_not_an_empty_list(tmp_path):
    """The gate fails closed: a broken list must not read as 'no names to look for'."""
    with pytest.raises(ValueError):
        mn.node_names(nodes_file(tmp_path, "[nodes.node-a\nurl = "))


def test_A5_the_node_list_is_dbenchs_unless_the_environment_names_another(tmp_path, monkeypatch):
    monkeypatch.delenv(mn.NODES_ENV, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert mn.nodes_file() == tmp_path / ".config/dbench/nodes.toml"
    monkeypatch.setenv(mn.NODES_ENV, str(tmp_path / "other.toml"))
    assert mn.nodes_file() == tmp_path / "other.toml"


@pytest.mark.parametrize("hostname,names", [
    ("boxwood", {"boxwood"}),
    ("Someones-Laptop.local", {"Someones-Laptop.local", "Someones-Laptop"}),
    ("node-e.tail1234.ts.net", {"node-e.tail1234.ts.net", "node-e"}),
    ("", set()),
])
def test_A6_the_hostname_counts_in_full_and_short(hostname, names):
    assert mn.host_names(hostname) == names


@pytest.mark.parametrize("generic", ["localhost", "LOCALHOST", "localhost.localdomain", "ubuntu", "debian", "abc"])
def test_A7_generic_or_very_short_names_are_not_looked_for(generic):
    """'ubuntu' is also a combination path segment and 'localhost' is in every server log: refusing them would
    refuse every run. A name shorter than MIN_NAME_CHARS matches ordinary words."""
    assert mn.distinctive({generic, "boxwood"}) == {"boxwood"}


def test_A8_the_local_names_are_the_node_list_and_the_hostname_together(tmp_path):
    assert mn.local_names(nodes_file(tmp_path), "node-e.local") == {"node-a", "boxwood", "node-e.local", "node-e"}


def test_A9_they_are_read_each_time_not_remembered(tmp_path):
    f = nodes_file(tmp_path)
    assert "node-f" not in mn.local_names(f, "")
    f.write_text(NODES + '[nodes.node-f]\nurl = "http://node-f:7717"\n')
    assert "node-f" in mn.local_names(f, "")


# ---------- B. what counts as a name in a text ----------

NAMES = {"node-a", "boxwood", "Someones-Laptop"}


@pytest.mark.parametrize("text", [
    "story 3: boxwood froze",               # prose
    '"host": "boxwood"',                     # a JSON field
    "operator (boxwood)",                    # parentheses
    "20260925-215328-boxwood.tsv",           # a file name: hyphens separate
    "ran_on_boxwood_today",                  # underscores separate
    "kept on BOXWOOD in ~/.spec-bench",     # any case
    "Boxwood's disk",                        # possessive
    "on node-a.",                            # a hyphenated name, then a full stop
    '"host": "Someones-Laptop.local"',       # the hostname, full
])
def test_B1_a_whole_name_is_found_however_it_is_written(text):
    assert mn.found(text, NAMES)


@pytest.mark.parametrize("text", [
    "boxwoods of the garden",                # inside a longer word
    "the xboxwood library",
    "node-ab is another machine",            # a longer name that starts with one
    "anode-a",
    "",
])
def test_B2_a_name_inside_a_longer_word_is_not_a_name(text):
    assert mn.found(text, NAMES) == []


def test_B3_what_is_found_is_named_as_the_list_spells_it_once_each():
    assert mn.found("BOXWOOD, boxwood and node-a", NAMES) == ["boxwood", "node-a"]


def test_B4_names_with_regex_characters_are_matched_literally():
    assert mn.found("on a+b.c today", {"a+b.c"}) == ["a+b.c"]
    assert mn.found("on aaab-c today", {"a+b.c"}) == []


def test_B5_no_names_find_nothing():
    assert mn.found("boxwood", set()) == []


# ---------- C. which files are checked ----------

@pytest.mark.parametrize("rel", [
    "combinations/x/benchmarks/vidi/r1/run-status.json",
    "combinations/x/benchmarks/vidi/r1/metrics.json",
    "combinations/x/benchmarks/vidi/r1/interventions.md",
    "combinations/x/benchmarks/vidi/r1/summary.md",
    "combinations/x/benchmarks/vidi/r1/run.json",
    "combinations/x/benchmarks/vidi/r1/rescore/v1/rescore.json",
])
def test_C1_every_file_the_harness_writes_is_checked(rel):
    assert mn.in_file(rel, "on boxwood", NAMES) == ["boxwood"]


@pytest.mark.parametrize("rel", [
    "combinations/x/benchmarks/vidi/r1/workspace/src/App.tsx",
    "combinations/x/benchmarks/vidi/r1/workspace/notes.md",
    "combinations/x/benchmarks/vidi/r1/stories/01/gate.json",
    "combinations/x/benchmarks/vidi/r1/stories/01/agent-events.compact.jsonl.gz",
    "combinations/x/benchmarks/vidi/r1/workspace-git-log.txt",
])
def test_C2_the_agents_own_work_is_its_own(rel):
    assert mn.in_file(rel, "on boxwood", NAMES) == []


# ---------- D. the repo check ----------

def repo(tmp_path: Path, files: dict[str, str]) -> Path:
    r = tmp_path / "repo"
    r.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(r)], check=True)
    for rel, text in files.items():
        (r / rel).parent.mkdir(parents=True, exist_ok=True)
        (r / rel).write_text(text)
    subprocess.run([*G, "add", "-A"], cwd=r, check=True)
    return r


def test_D1_a_tracked_file_with_a_name_is_reported_with_the_name(tmp_path):
    r = repo(tmp_path, {"README.md": "Runs on boxwood.\n", "docs/a.md": "Runs on the Strix Halo box.\n"})
    assert mn.tracked(r, NAMES) == {"README.md": ["boxwood"]}


def test_D2_the_agents_own_work_in_the_repo_is_not_reported(tmp_path):
    r = repo(tmp_path, {"c/benchmarks/vidi/r1/workspace/x.md": "boxwood", "c/benchmarks/vidi/r1/stories/01/gate.json": "boxwood"})
    assert mn.tracked(r, NAMES) == {}


def test_D3_untracked_files_are_not_the_repos(tmp_path):
    r = repo(tmp_path, {"README.md": "clean\n"})
    (r / "scratch.md").write_text("boxwood")
    assert mn.tracked(r, NAMES) == {}


def test_D4_a_name_found_only_in_another_case_is_reported(tmp_path):
    r = repo(tmp_path, {"a.json": '{"host": "BOXWOOD"}'})
    assert mn.tracked(r, NAMES) == {"a.json": ["boxwood"]}


def cli(tmp_path: Path, r: Path, nodes: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(Path(mn.__file__)), "tracked", str(r)], capture_output=True, text=True,
                          env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), mn.NODES_ENV: str(nodes)})


def test_D5_the_command_fails_and_names_each_file_when_a_name_is_tracked(tmp_path):
    r = repo(tmp_path, {"README.md": "Runs on node-a.\n"})
    p = cli(tmp_path, r, nodes_file(tmp_path))
    assert p.returncode == 1 and "README.md" in p.stdout, p


def test_D6_the_command_passes_on_a_clean_repo(tmp_path):
    p = cli(tmp_path, repo(tmp_path, {"README.md": "Runs on the RTX 4090 machine.\n"}), nodes_file(tmp_path))
    assert p.returncode == 0, p


def test_D7_without_a_node_list_the_command_skips(tmp_path):
    p = cli(tmp_path, repo(tmp_path, {"README.md": "Runs on node-a.\n"}), tmp_path / "absent.toml")
    assert p.returncode == 0 and "skip" in p.stdout.lower(), p


def test_D8_a_broken_node_list_fails_the_command(tmp_path):
    p = cli(tmp_path, repo(tmp_path, {"README.md": "clean\n"}), nodes_file(tmp_path, "[nodes.x\n"))
    assert p.returncode == 2, p
