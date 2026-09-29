"""benchmarker: live status of benchmark runs, from dbench and from the fetched repo."""
import benchmarker as B

PATHS = [
    "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1/run.json",
    "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1/run-status.json",
    "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1/stories/01/accept.json",
    "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/run.json",
    "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/rescore/vidi-v1.3.2/rescore.json",
    "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/workspace.bundle",
    "benchmarks/reference/vidi/opus-5.5/run-3/run.json",
    "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/perf/results.json",
]


def test_runs_are_found_by_their_run_json_under_combinations_and_reference():
    runs = B.find_runs(PATHS)
    assert [(r["pack"], r["stack"], r["run_id"]) for r in runs] == [
        ("vidi", "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi", "v2-r1"),
        ("vidi", "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "canvas-gufo-r3"),
        ("vidi", "reference/opus-5.5", "run-3"),
    ]
    gufo = runs[1]
    assert gufo["rescores"] == ["vidi-v1.3.2"] and gufo["has_bundle"] is True
    assert runs[0]["rescores"] == [] and runs[0]["has_bundle"] is False


def test_a_version_family_is_the_tag_up_to_its_major_number():
    assert B.version_family("vidi-v2.0-pre1") == "vidi-v2"
    assert B.version_family("vidi-v1.3.2") == "vidi-v1"
    assert B.version_family("vidi-v1.1+e9b0291f-dirty") == "vidi-v1"
    assert B.version_family("") == ""


def test_links_point_at_the_repo_on_github_whatever_the_remote_form():
    assert B.web_base("git@github.com:boxabirds/awesome-local-ai.git") == "https://github.com/boxabirds/awesome-local-ai"
    assert B.web_base("https://github.com/boxabirds/awesome-local-ai") == "https://github.com/boxabirds/awesome-local-ai"
    assert B.web_base("/some/local/path") is None


def test_dbench_jobs_are_matched_to_runs_by_stack_pack_and_run_id():
    jobs = {"gruntus": [{"id": "vidi-v2-swift15-r1", "spec": {"pack": "benchmarks/vidi", "run_id": "v2-r1"},
                         "progress": {"combination": "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi"},
                         "state": {"status": "running"}, "updated_at": 2},
                        {"id": "old", "spec": {"pack": "benchmarks/vidi", "run_id": "v2-r1"},
                         "progress": {"combination": "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi"},
                         "state": {"status": "failed"}, "updated_at": 1}]}
    idx = B.index_jobs(jobs)
    job = idx[("qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi", "vidi", "v2-r1")]
    assert job["id"] == "vidi-v2-swift15-r1" and job["node"] == "gruntus"   # the newest job wins


def test_stages_say_what_each_run_is_waiting_for():
    run = {"state": "started", "rescores": [], "has_bundle": False}
    s = B.stages(run, job={"state": {"status": "running"}, "progress": {"current_story": "3"}}, suite="vidi-v2.0")
    assert s["build"] == "running: story 3" and s["score"] == "waiting for the build"
    assert s["judge"] == "waiting for scoring"

    done = {"state": "finished", "rescores": [], "has_bundle": True}
    s = B.stages(done, job=None, suite="vidi-v2.0")
    assert s["build"] == "finished" and s["score"] == "not scored with vidi-v2.0" and s["judge"] == "waiting for scoring"

    scored = {"state": "finished", "rescores": ["vidi-v2.0"], "has_bundle": True}
    assert B.stages(scored, job=None, suite="vidi-v2.0")["judge"] == "ready"
    no_bundle = {"state": "finished", "rescores": ["vidi-v2.0"], "has_bundle": False}
    assert B.stages(no_bundle, job=None, suite="vidi-v2.0")["judge"] == "needs workspace.bundle"

    queued = {"state": "", "rescores": [], "has_bundle": False}
    assert B.stages(queued, job={"state": {"status": "queued"}, "progress": {}}, suite="x")["build"] == "queued"
    failed = {"state": "stopped", "rescores": [], "has_bundle": False}
    assert B.stages(failed, job={"state": {"status": "failed", "reason": "harness exited 1"}, "progress": {}},
                    suite="x")["build"] == "failed: harness exited 1"


def test_jobs_without_a_run_record_yet_still_appear():
    jobs = {"quintus": [{"id": "vidi-v2-mlx-r3", "spec": {"pack": "benchmarks/vidi", "run_id": "v2-r3"},
                         "progress": {"combination": "qwen/3.8/flash-next/macos/128GB/mlxserve-pi"},
                         "state": {"status": "queued"}, "updated_at": 1}]}
    rows = B.merge(runs=[], jobs=B.index_jobs(jobs))
    assert [(r["stack"], r["run_id"], r["node"]) for r in rows] == [
        ("qwen/3.8/flash-next/macos/128GB/mlxserve-pi", "v2-r3", "quintus")]
    assert rows[0]["stories"] == [] and rows[0]["scores"] == {} and rows[0]["state"] == ""


def test_a_record_without_a_pack_version_is_unversioned_not_current():
    assert B.row_family({"dir": "x/run", "pack_version": ""}, suite="vidi-v2.0-pre1") == "unversioned"
    assert B.row_family({"dir": "x/run", "pack_version": "vidi-v1.1"}, suite="vidi-v2.0-pre1") == "vidi-v1"
    assert B.row_family({"dir": None, "pack_version": ""}, suite="vidi-v2.0-pre1") == "vidi-v2"
    assert B.row_family({"dir": "x/run", "pack_version": "unversioned"}, suite="vidi-v2.0-pre1") == "unversioned"
    assert B.row_family({"dir": "x/run", "pack_version": "3f2a1bc"}, suite="vidi-v2.0-pre1") == "unversioned"


def test_old_finished_or_cancelled_jobs_without_a_record_are_left_out():
    now = 1_000_000
    def job(status, age):
        return {"id": status, "spec": {"pack": "benchmarks/vidi", "run_id": status},
                "progress": {"combination": "c"}, "state": {"status": status}, "updated_at": now - age}
    jobs = B.index_jobs({"n": [job("queued", 99_999), job("running", 99_999), job("failed", 3_600),
                               job("cancelled", 2 * B.RECENT_S), job("done", 2 * B.RECENT_S)]})
    rows = B.merge(runs=[], jobs=jobs, now=now)
    assert sorted(r["run_id"] for r in rows) == ["failed", "queued", "running"]


def test_a_finished_job_reads_as_finished():
    s = B.stages({"state": "", "rescores": [], "has_bundle": False}, job={"state": {"status": "done"}, "progress": {}}, suite="x")
    assert s["build"] == "finished (not recorded)"


def test_live_numbers_come_from_the_running_story_not_the_last_listed():
    job = {"id": "j", "state": {"status": "running", "attempt": 1},
           "progress": {"current_story": "1", "log_tail": ["[story 1] … agent starting"],
                        "stories": [
                            {"id": "1", "status": "running", "agent_minutes": 6.0, "calls": 32, "output_tokens": 36199,
                             "last_task_change_at": 100.0,
                             "tasks": [{"status": "written"}, {"status": "written"}, {"status": "not-started"}],
                             "recent_activity": ["bash: npm run build 2>&1", "bash: npx vitest run 2>&1"]},
                            {"id": "2", "status": "pending"},
                            {"id": "12", "status": "pending"}]}}
    live = B.live_from_job(job)
    assert (live["current_story"], live["agent_minutes"], live["calls"], live["output_tokens"]) == ("1", 6.0, 32, 36199)
    assert (live["tasks_written"], live["tasks_total"]) == (2, 3)
    assert live["last_activity"] == "bash: npx vitest run 2>&1" and live["last_task_change_at"] == 100.0


def test_a_job_between_stories_has_no_live_story():
    job = {"id": "j", "state": {"status": "running"}, "progress": {"current_story": None, "stories": [{"id": "1", "status": "done"}]}}
    assert B.live_from_job(job)["agent_minutes"] is None


def test_queued_jobs_know_their_place_and_what_is_ahead():
    def job(i, status, run, t, stack="qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi"):
        return {"id": i, "spec": {"pack": "benchmarks/vidi", "run_id": run}, "progress": {"combination": stack},
                "state": {"status": status}, "submitted_at": t}
    jobs = {"gruntus": [
        job("s1", "running", "v2-r1", 1), job("s2", "queued", "v2-r2", 2), job("s3", "queued", "v2-r3", 3),
        job("b1", "queued", "v2-r1", 4, "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi"),
        job("old", "cancelled", "v2-r9", 0)]}
    q = B.queue_positions(jobs)
    assert q["b1"]["position"] == 4
    assert q["b1"]["ahead"] == ["3.8-swift-1.5/27b v2-r1 (running)", "3.8-swift-1.5/27b v2-r2", "3.8-swift-1.5/27b v2-r3"]
    assert q["s2"]["position"] == 2 and q["s2"]["ahead"] == ["3.8-swift-1.5/27b v2-r1 (running)"]
    assert "s1" not in q and "old" not in q


def test_jobs_submitted_in_the_same_second_keep_dbench_order_by_id():
    def job(i, run, t):
        return {"id": i, "spec": {"pack": "benchmarks/vidi", "run_id": run},
                "progress": {"combination": "qwen/3.8-swift-1.5/27b/x/y/z"}, "state": {"status": "queued"}, "submitted_at": t}
    q = B.queue_positions({"n": [job("vidi-v2b-swift15-r3", "v2-r3", 5), job("vidi-v2b-swift15-r2", "v2-r2", 5),
                                 job("vidi-v2b-swift15-r1", "v2-r1", 5)]})
    assert [q[f"vidi-v2b-swift15-r{i}"]["position"] for i in (1, 2, 3)] == [1, 2, 3]


def test_between_stories_the_build_names_the_story_being_finished():
    run = {"state": "started", "rescores": [], "has_bundle": False}
    job = {"state": {"status": "running"},
           "progress": {"current_story": None, "stories": [{"id": "1", "status": "running"}, {"id": "2", "status": "pending"}]}}
    assert B.stages(run, job=job, suite="x")["build"] == "running: story 1 (finishing)"
    job2 = {"state": {"status": "running"}, "progress": {"current_story": None, "stories": [{"id": "1", "status": "done"}]}}
    assert B.stages(run, job=job2, suite="x")["build"] == "running: between stories"


def test_dbench_sequence_numbers_decide_order_within_a_second():
    def job(i, run, seq):
        return {"id": i, "spec": {"pack": "benchmarks/vidi", "run_id": run}, "seq": seq,
                "progress": {"combination": "qwen/3.8/27b/x/y/z"}, "state": {"status": "queued"}, "submitted_at": 5}
    q = B.queue_positions({"n": [job("aa-late", "r2", 2), job("zz-early", "r1", 1)]})
    assert q["zz-early"]["position"] == 1 and q["aa-late"]["position"] == 2
