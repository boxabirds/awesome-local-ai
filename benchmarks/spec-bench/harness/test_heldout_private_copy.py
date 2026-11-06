"""heldout.private_copy (story 23, readers.tools): where the private repo keeps a run's held-out detail. A run in the
lake is named by its run id, the same on every machine that holds a copy, never by its folder in the lake; a run in a
checkout (a node's own run) by its path in that checkout, as before."""
import json

import benchlake
import heldout

RUN_ID = "combinations/m/1/size/linux/hw/eng-cli/benchmarks/vidi/r1"
REF_ID = "benchmarks/reference/vidi/opus/r1"
ACCEPT = "stories/01/accept.json"
DETAIL = {"passed": 5, "total": 6, "tests": [{"title": "pans", "status": "failed"}]}


def private_repo_holding_the_lake(tmp_path, monkeypatch):
    """The private repo is a git checkout, and the lake's state folder lives inside it, as on the host."""
    private = tmp_path / "awesome-local-ai-bench-private"
    (private / ".git").mkdir(parents=True)
    state = private / "state"
    monkeypatch.setenv(benchlake.STATE_ENV, str(state))
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(private))
    return private, state


def detail_in_private(private, run_id, rel=ACCEPT):
    f = private / heldout.PRIVATE_RUNS / run_id / rel
    f.parent.mkdir(parents=True)
    f.write_text(json.dumps(DETAIL))


def test_a_collected_copy_finds_its_detail_under_its_run_id_whatever_machine_holds_it(tmp_path, monkeypatch):
    private, state = private_repo_holding_the_lake(tmp_path, monkeypatch)
    detail_in_private(private, RUN_ID)
    for node in ("gruntus", "quintus"):
        run = state / benchlake.COLLECTED / node / RUN_ID
        (run / "stories" / "01").mkdir(parents=True)
        assert heldout.private_copy(run) == private / heldout.PRIVATE_RUNS / RUN_ID
        assert heldout.read_json(run, ACCEPT) == DETAIL


def test_a_reference_run_and_a_rescore_folder_in_the_lake_find_theirs(tmp_path, monkeypatch):
    private, state = private_repo_holding_the_lake(tmp_path, monkeypatch)
    ref = state / benchlake.REFERENCE / REF_ID.removeprefix(benchlake.REFERENCE_ID_PREFIX + "/")
    ref.mkdir(parents=True)
    detail_in_private(private, REF_ID)
    assert heldout.read_json(ref, ACCEPT) == DETAIL
    rescore = state / benchlake.COLLECTED / "gruntus" / RUN_ID / "rescore" / "v3"
    rescore.mkdir(parents=True)
    detail_in_private(private, f"{RUN_ID}/rescore/v3")
    assert heldout.read_json(rescore, ACCEPT) == DETAIL


def test_the_lake_copys_own_detail_comes_first(tmp_path, monkeypatch):
    private, state = private_repo_holding_the_lake(tmp_path, monkeypatch)
    detail_in_private(private, RUN_ID)
    run = state / benchlake.COLLECTED / "macbook-air" / RUN_ID
    (run / "stories" / "01").mkdir(parents=True)
    (run / ACCEPT).write_text(json.dumps({"passed": 6, "total": 6}))
    assert heldout.read_json(run, ACCEPT) == {"passed": 6, "total": 6}


def test_a_nodes_own_run_in_its_checkout_is_named_by_its_path_there(tmp_path, monkeypatch):
    private, _ = private_repo_holding_the_lake(tmp_path, monkeypatch)
    checkout = tmp_path / "awesome-local-ai"
    (checkout / ".git").mkdir(parents=True)
    run = checkout / RUN_ID
    run.mkdir(parents=True)
    detail_in_private(private, RUN_ID)
    assert heldout.private_copy(run) == private / heldout.PRIVATE_RUNS / RUN_ID
    assert heldout.read_json(run, ACCEPT) == DETAIL


def test_the_lake_folders_above_any_run_have_no_private_copy(tmp_path, monkeypatch):
    _, state = private_repo_holding_the_lake(tmp_path, monkeypatch)
    for d in (state, state / benchlake.COLLECTED, state / benchlake.COLLECTED / "gruntus", state / benchlake.REFERENCE):
        d.mkdir(parents=True, exist_ok=True)
        assert heldout.private_copy(d) is None
