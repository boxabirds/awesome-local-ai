"""The scoring pipeline, end to end, against a known answer (item 6f).

A scripted agent builds a two-story app whose held-out results are known in advance. The real path runs it:
drive.py's story loop (with a scripted client instead of a model), the gate and the held-out scoring after each
story, then finalize.py with the re-score of record (rescore.py, in this process). The held-out suite is a tiny
fake one in a temporary private repo, tagged like a real pack; its runner stands in for Playwright (no browser),
reads what the app's build produced, and writes Playwright's JSON report. The recorded numbers must equal the
expected ones exactly, and breaking any stage (the install's exit code ignored, the build skipped, the majority
vote lost, the processed stories dropped) must change them: each breakage has its own test below.

What the app does, and so what every scoring must record:
  story-01: "greeting" passes, "sum" fails (the agent writes 2+2 where 5 is expected), "title" passes;
  story-02: "peer" passes only if the dependencies were installed (the agent installed them with
            --legacy-peer-deps, which a plain `npm ci` refuses: the Swift 1.5 v2-r2 incident), and "racy" fails
            on a first scoring and passes on the repeats (a flaky test, decided by majority).
Everything runs offline (npm_config_offline) against file: dependencies; it needs node and npm, and skips
without them.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

import clients
import containment
import drive
import finalize
import gates
import heldout
import progress
import rescore

pytestmark = pytest.mark.skipif(not (shutil.which("node") and shutil.which("npm") and shutil.which("npx")),
                                reason="needs node, npm and npx")

PACK = "kat"
PACK_REF = f"{PACK}-v1"
MODEL = "kat-model"
OUTPUT_TOKENS_PER_STORY = 100
# Ports well away from the real scoring's (18787, 18800), so a scoring running on this machine is left alone.
TEST_ACCEPT_PORT = 28787
TEST_RESCORE_PORT = 28800

EXPECTED_LIVE = {"1": {"passed": 2, "total": 3}, "2": {"passed": 3, "total": 5}}
EXPECTED_LIVE_BY_STORY = {"01": {"passed": 2, "total": 3}, "02": {"passed": 1, "total": 2}}
EXPECTED_RECORD = {"score": "4/5", "scores": [3, 4, 4], "flaky": 1, "flaky_failing": 1, "flaky_passing": 0,
                   "passing_sampled": 3, "install": "npm ci --no-audit --no-fund --legacy-peer-deps"}

# ---------- the pack: spec, prompt, and the fake held-out suite ----------

SUITE_TESTS = {
    "story-01.spec.ts": ["kat greeting reads hello :: greeting == hello",
                         "kat sum shows five :: sum == 5",
                         "kat title names the app :: title == Kat"],
    "story-02.spec.ts": ["kat peer library answers :: peer == needy+p1",
                         "kat racy counter settles :: racy"],
}
# Stands in for `npx playwright test`: the same arguments (files, or file:line for a repeat), the same
# environment (WORKSPACE, ACCEPT_JSON), and Playwright's JSON report shape, which gates._walk reads.
FAKE_RUNNER = r"""#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2).filter(a => a !== 'test');
let app = null;
try { app = JSON.parse(fs.readFileSync(path.join(process.env.WORKSPACE, 'dist', 'app.json'), 'utf8')); } catch {}
const repeat = (process.env.ACCEPT_JSON || '').includes('/scoring-');
const suites = []; let passed = 0, failed = 0;
for (const arg of args) {
  const [rel, only] = arg.split(':');
  const file = path.basename(rel);
  const specs = [];
  fs.readFileSync(path.join('tests', file), 'utf8').split('\n').forEach((text, i) => {
    const line = i + 1;
    if (!text.trim() || (only && Number(only) !== line)) return;
    const [title, check] = text.split(' :: ');
    let ok, error;
    if (!app) { ok = false; error = 'page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:' + process.env.ACCEPT_PORT + '/'; }
    else if (check === 'racy') { ok = repeat; error = 'Error: expect(counter).toHaveText(expected) racy'; }
    else { const [key, want] = check.split(' == '); ok = String(app[key]) === want;
           error = 'Error: expect(' + key + ').toEqual(' + want + ') got ' + app[key]; }
    ok ? passed++ : failed++;
    specs.push({ title, line, tests: [{ results: [{ status: ok ? 'passed' : 'failed', error: ok ? undefined : { message: error } }] }] });
  });
  suites.push({ file, specs });
}
fs.writeFileSync(process.env.ACCEPT_JSON, JSON.stringify({ suites }));
console.log(`${passed} passed`); if (failed) console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
"""
FAKE_PLAYWRIGHT_VERSION = "0.0.0-kat"
FAKE_CHROMIUM = {"browsers": [{"name": "chromium", "revision": "1", "browserVersion": "1.0.0-kat"}]}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout


def make_private_repo(root: Path) -> Path:
    """A private repo holding pack `kat`, tagged at PACK_REF like a real pack's release."""
    pack = root / "packs" / PACK
    for n, (slug, title) in enumerate([("greet", "Greet the visitor"), ("peer", "Use the peer library")], 1):
        d = pack / "spec" / "stories" / f"{n:03d}-{slug}"
        d.mkdir(parents=True)
        (d / "story.md").write_text(f"# {title}\n")
        (d / "tasks.md").write_text("# Tasks\n")
    (pack / "spec" / "README.md").write_text("# kat\n")
    (pack / "prompts").mkdir()
    (pack / "prompts" / "story.md.tmpl").write_text("STORY {{ID}}: {{TITLE}}\n{{STORIES_SO_FAR}}\n")
    (pack / "bench.json").write_text(json.dumps({"name": PACK, "gate": ["build"], "pack_ref": PACK_REF}))
    acc = pack / "acceptance"
    (acc / "tests").mkdir(parents=True)
    for f, lines in SUITE_TESTS.items():
        (acc / "tests" / f).write_text("\n".join(lines) + "\n")
    (acc / "package.json").write_text(json.dumps({"name": "kat-acceptance", "private": True}))
    (acc / ".gitignore").write_text("node_modules/\n")
    runner = acc / "node_modules" / ".bin" / "playwright"
    runner.parent.mkdir(parents=True)
    runner.write_text(FAKE_RUNNER)
    runner.chmod(0o755)
    (acc / "node_modules" / "@playwright" / "test").mkdir(parents=True)
    (acc / "node_modules" / "@playwright" / "test" / "package.json").write_text(json.dumps({"version": FAKE_PLAYWRIGHT_VERSION}))
    (acc / "node_modules" / "playwright-core").mkdir(parents=True)
    (acc / "node_modules" / "playwright-core" / "browsers.json").write_text(json.dumps(FAKE_CHROMIUM))
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "kat pack")
    git(root, "tag", PACK_REF)
    return pack


# ---------- the scripted agent ----------

# What the agent writes in each story. Story 2 adds a library whose peer range its sibling doesn't meet: npm
# refuses it unless --legacy-peer-deps, which the agent uses, as Swift 1.5 v2-r2's agent did.
AGENT_SCRIPT = textwrap.dedent(r'''
    import json, os, re, subprocess, sys
    from pathlib import Path
    story = int(re.search(r"STORY (\d+)", sys.argv[1]).group(1))
    ws = Path.cwd()
    def write(rel, text):
        (ws / rel).parent.mkdir(parents=True, exist_ok=True)
        (ws / rel).write_text(text)
    def lib(name, body, **extra):
        write(f"vendor/{name}/package.json", json.dumps({"name": name, "version": "1.0.0", "main": "index.js", **extra}))
        write(f"vendor/{name}/index.js", f"module.exports = {body};\n")
    deps = {"greetlib": "file:vendor/greetlib"}
    app = {"greeting": "require('greetlib')", "sum": "2 + 2", "title": "'Kat'"}
    lib("greetlib", "'hello'")
    install = ["npm", "install", "--no-audit", "--no-fund"]
    if story >= 2:
        lib("peerlib", "'p1'")
        lib("needy", "'needy'", peerDependencies={"peerlib": "^2.0.0"})
        deps |= {"peerlib": "file:vendor/peerlib", "needy": "file:vendor/needy"}
        app["peer"] = "require('needy') + '+' + require('peerlib')"
        install.append("--legacy-peer-deps")
    write("package.json", json.dumps({"name": "kat-app", "version": "1.0.0", "private": True,
                                      "scripts": {"build": "node build.js"}, "dependencies": deps}, indent=2))
    fields = ", ".join(f"{k}: {v}" for k, v in app.items())
    write("build.js", "const fs = require('fs');\nfs.mkdirSync('dist', {recursive: true});\n"
                      f"fs.writeFileSync('dist/app.json', JSON.stringify({{{fields}}}));\n")
    write(".gitignore", "node_modules/\ndist/\n")
    subprocess.run(install, check=True, capture_output=True)
    subprocess.run(["git", "add", "-A"], check=True)
    subprocess.run(["git", "commit", "-qm", f"story {story}"], check=True)
    for e in ({"type": "session", "id": f"kat-{story}"},
              {"type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                                  "usage": {"input": 10, "output": %d}}}):
        print(json.dumps(e), flush=True)
''' % OUTPUT_TOKENS_PER_STORY)


class ScriptedClient(clients.PiClient):
    """pi's event stream and config, with the scripted agent in place of `pi`."""
    name = "kat"
    script: Path

    def command(self, model_id, prompt, resume_from=None, fork=True):
        return [sys.executable, str(self.script), prompt]


_RealContainment = containment.StoryContainment


def _Uncontained(run, story):
    """Containment off, as on a Mac: systemd scopes are Linux's and not what this test measures."""
    return _RealContainment(run, story, enabled=False)


class QuietSampler:
    """The conditions sampler, without reading the machine's power and memory: a fit machine throughout."""
    def __init__(self, *a, **k):
        pass

    def start(self):
        pass

    def stop(self):
        return {**drive.summarise_conditions(0, []), "aborted_swap": False, "aborted_memory": False}


def offline_node_env(mp: pytest.MonkeyPatch) -> None:
    """npm offline (file: dependencies only), test ports, one worker; and no grace period when the scoring stops its
    own process groups (a real suite's browsers need it; the fake runner has exited by then)."""
    mp.setattr(gates, "STOP_GRACE_S", 0)
    for k, v in {"npm_config_offline": "true", "npm_config_audit": "false", "npm_config_fund": "false",
                 "npm_config_update_notifier": "false", "ACCEPT_PORT": str(TEST_ACCEPT_PORT), "ACCEPT_WORKERS": "1"}.items():
        mp.setenv(k, v)


PACK_GLOBALS = ("PK", "PACK", "SPEC", "PROMPT_TMPL")


def keep_pack(mp: pytest.MonkeyPatch) -> None:
    """drive.set_pack changes module globals; these put them back when the test ends, after its environment
    (SPEC_BENCH_PACK_DIR) is undone. Re-loading the default pack inside the test would load this test's pack."""
    for name in PACK_GLOBALS:
        mp.setattr(drive, name, getattr(drive, name))


def drive_run(root: Path, mp: pytest.MonkeyPatch) -> Path:
    """Both stories through drive.py's own main loop. Returns the run directory."""
    keep_pack(mp)
    pack = make_private_repo(root / "private")
    mp.setenv("SPEC_BENCH_PACK_DIR", str(pack))
    mp.setenv(heldout.PRIVATE_ENV, str(root / "no-private-copy"))
    offline_node_env(mp)
    script = root / "agent.py"
    script.write_text(AGENT_SCRIPT)
    ScriptedClient.script = script
    mp.setitem(drive.CLIENTS, ScriptedClient.name, ScriptedClient)
    mp.setattr(drive, "WORK_ROOT", root / "work")
    mp.setattr(drive, "sandboxed", lambda cmd, own_dir: cmd)       # sandbox-exec is macOS's; the test runs anywhere
    mp.setattr(drive, "conditions", lambda: {"ac": True, "low_power": False, "thermal": "nominal"})
    mp.setattr(drive, "ConditionSampler", QuietSampler)
    mp.setattr(progress, "baselines", lambda *a, **k: [])          # other runs of this repo: not this test's
    mp.setattr(containment, "StoryContainment", _Uncontained)
    run = root / "run"
    mp.setattr(sys, "argv", ["drive.py", "--pack", PACK, "--run-dir", str(run), "--base-url", "http://127.0.0.1:9/v1",
                             "--model-id", MODEL, "--client", ScriptedClient.name])
    drive.main()
    return run


def rescore_here(mp: pytest.MonkeyPatch):
    """finalize's re-score, run in this process (rescore.main, as `rescore.py --final` would), so a stage broken
    by the test is broken in it too."""
    keep_pack(mp)

    def run_rescore(run: Path, bundle: Path, version: str) -> None:
        mp.setattr(rescore, "BASE_PORT", TEST_RESCORE_PORT)
        mp.setattr(sys, "argv", ["rescore.py", str(run), "--bundle", str(bundle), "--pack", PACK, "--final",
                                 "--workers", "1"])
        before = signal.getsignal(signal.SIGTERM)
        try:
            assert rescore.main() == 0
        finally:
            signal.signal(signal.SIGTERM, before)
    return run_rescore


def pack_version(pack: Path) -> str:
    return subprocess.run([str(drive.HARNESS / "pack-version.sh"), str(pack), PACK], capture_output=True,
                          text=True).stdout.strip()


def finalize_run(run: Path, mp: pytest.MonkeyPatch) -> dict:
    pack = Path(os.environ["SPEC_BENCH_PACK_DIR"])
    return finalize.finalize(run, PACK_REF, pack_version(pack), rescore=rescore_here(mp), record=None)


def copy_run(src_root: Path, dest_root: Path) -> Path:
    """A finished run and its work directory, copied so each test can finalize it its own way."""
    shutil.copytree(src_root, dest_root, symlinks=True)
    run = dest_root / "run"
    work = Path((run / "work_dir.txt").read_text().strip())
    (run / "work_dir.txt").write_text(str(dest_root / work.relative_to(src_root)))
    return run


def recorded(run: Path) -> dict:
    """The numbers the pipeline recorded, in the shape of the EXPECTED_* constants."""
    m = heldout.load_metrics(run)
    fin = json.loads((run / finalize.STATUS).read_text())
    out = {"live": {sid: {"passed": s["accept"]["passed"], "total": s["accept"]["total"]} for sid, s in m["stories"].items()},
           "live_by_story": m["stories"]["2"]["accept"]["by_story"],
           "tokens": {sid: s["agent"]["tokens"]["output"] for sid, s in m["stories"].items()},
           "finalize": fin["rescore"], "score": fin.get("score")}
    rs = run / "rescore" / fin["version"] / "rescore.json"
    if rs.is_file():
        doc = json.loads(rs.read_text())
        last = doc["results"][-1]
        out["record"] = {"score": f"{last['passed']}/{last['total']}", "scores": last["scores"],
                         "flaky": last["flaky"], "flaky_failing": last["flaky_failing"],
                         "flaky_passing": last["flaky_passing"], "passing_sampled": last["passing_sampled"],
                         "install": last["environment"]["install_command"]}
        out["environment"] = doc["environment"]
    return out


def assert_known_answer(got: dict) -> None:
    assert got["live"] == EXPECTED_LIVE
    assert got["live_by_story"] == EXPECTED_LIVE_BY_STORY
    assert got["finalize"] == "done" and got["score"] == EXPECTED_RECORD["score"]
    assert got["record"] == EXPECTED_RECORD


@pytest.fixture(scope="module")
def finished_run(tmp_path_factory):
    """One run of both stories through drive.py, shared: each test finalizes its own copy."""
    root = tmp_path_factory.mktemp("kat-live")
    with pytest.MonkeyPatch.context() as mp:
        drive_run(root, mp)
    return root


@pytest.fixture
def run_copy(finished_run, tmp_path, monkeypatch):
    root = tmp_path / "kat"
    run = copy_run(finished_run, root)
    monkeypatch.setenv("SPEC_BENCH_PACK_DIR", str(root / "private" / "packs" / PACK))
    offline_node_env(monkeypatch)
    return run


# ---------- the known answer ----------

def test_the_pipeline_records_exactly_the_known_answer(run_copy, monkeypatch):
    finalize_run(run_copy, monkeypatch)
    got = recorded(run_copy)
    assert_known_answer(got)
    assert got["tokens"] == {"1": OUTPUT_TOKENS_PER_STORY, "2": OUTPUT_TOKENS_PER_STORY}
    env = got["environment"]
    assert env["playwright"] == FAKE_PLAYWRIGHT_VERSION and env["chromium"] == "1.0.0-kat (r1)"
    assert env["node"].startswith("v") and env["npm"] and env["os"] and env["workers"] == 1
    guard = json.loads((run_copy / finalize.STATUS).read_text())["guard"]
    assert (guard["live"], guard["record"], guard["difference"], guard["flagged"]) == ("3/5", "4/5", 1, None)


def test_the_live_scores_and_commits_are_recorded_per_story(run_copy):
    m = heldout.load_metrics(run_copy)
    ws = Path((run_copy / "work_dir.txt").read_text().strip()) / "workspace"
    log = git(ws, "log", "--format=%H %s").splitlines()
    assert m["stories"]["2"]["commit"] == log[0].split()[0] and log[0].endswith("story 2")
    assert m["stories"]["1"]["commit"] == log[1].split()[0]
    assert m["stories"]["2"]["gate"]["all_green"] is False       # the gate's own `npm ci` refuses the peer range
    assert m["stories"]["2"]["accept"]["build_exit"] == 0        # but the agent's installed modules build


# ---------- a broken stage changes the answer ----------

def test_ignoring_npms_exit_code_is_caught(run_copy, monkeypatch):
    """The Swift 1.5 v2-r2 bug: the re-score's plain `npm ci` failed, unchecked, and the app was scored with no
    dependencies. With it back, the build fails where live it passed: a fault, never a score."""
    def unchecked(ws, run=subprocess.run):
        run(rescore.NPM_CI, cwd=ws, capture_output=True, text=True, timeout=rescore.INSTALL_TIMEOUT_S)
        return {"ok": True, "command": " ".join(rescore.NPM_CI), "fallback": False}
    monkeypatch.setattr(rescore, "install", unchecked)
    finalize_run(run_copy, monkeypatch)
    got = recorded(run_copy)
    with pytest.raises(AssertionError):
        assert_known_answer(got)
    assert got["finalize"] == "failed" and got["score"] is None
    assert "build failed in the re-score" in json.loads((run_copy / finalize.STATUS).read_text())["reason"]


def test_skipping_the_build_in_the_rescore_is_caught(run_copy, monkeypatch):
    """A fresh worktree has no dist/: every test gets "connection refused". The count is within the threshold
    here (0 of 5 against a live 3), but every failure shares one cause across both stories, so the guard sets it
    aside."""
    real = gates.accept
    monkeypatch.setattr(gates, "accept", lambda *a, **k: real(*a, **{**k, "build": False}))
    finalize_run(run_copy, monkeypatch)
    got = recorded(run_copy)
    with pytest.raises(AssertionError):
        assert_known_answer(got)
    fin = json.loads((run_copy / finalize.STATUS).read_text())
    assert fin["rescore"] == "flagged" and "share one error signature" in fin["reason"]


def test_losing_the_majority_vote_is_caught(run_copy, monkeypatch):
    monkeypatch.setattr(rescore, "majority", lambda accs, sampled_passing=0: accs[0])
    finalize_run(run_copy, monkeypatch)
    got = recorded(run_copy)
    with pytest.raises(AssertionError):
        assert_known_answer(got)
    assert got["score"] == "3/5"


def test_scoring_only_the_latest_story_is_caught(tmp_path, monkeypatch):
    """A live scoring that dropped the stories processed before (only the new story's file) would still look
    like a score: the known answer tells it apart."""
    real = gates.accept
    monkeypatch.setattr(gates, "accept", lambda ws, processed, *a, **k: real(ws, processed[-1:], *a, **k))
    run = drive_run(tmp_path, monkeypatch)
    live = {sid: {"passed": s["accept"]["passed"], "total": s["accept"]["total"]}
            for sid, s in heldout.load_metrics(run)["stories"].items()}
    assert live != EXPECTED_LIVE                   # no re-score needed: the live record already differs
    assert live["2"] == {"passed": 1, "total": 2}
