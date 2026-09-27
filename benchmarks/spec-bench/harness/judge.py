# /// script
# requires-python = ">=3.11"
# ///
"""Grade two finished runs blind, end to end, with a sandboxed judge. macOS only.

    uv run judge.py --name <name> \\
        --build opus=benchmarks/reference/vidi/opus-5.5/run-2 \\
        --build pi03=combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/benchmarks/vidi/canvas-pi-03@gruntus \\
        --label codex-<model>-high --model <model> [--effort high] [--repeat 2]

One command does the whole flow, so no human has to type an instruction to the judge:
1. Fetches each build's workspace from the machine that ran it (`@node`, over ssh as a git bundle;
   none means this machine) into a fresh clone, and pulls each story's completion claims and the
   final held-out results from the run record in this repo.
2. Builds the blinded package (grading_package.py) in <private>/state/judging/<name>/package. The
   key goes to <private>/state/keys/<name>.json. state/ is git-ignored, so neither is ever committed.
3. Installs the builds' and the held-out suite's dependencies, because the judge gets no internet.
4. For each repeat, clones the package and runs the judge (Codex, non-interactive) inside
   judge_sandbox's allowlist: it can read and write only its package, its own tool config and a
   scratch home. Its only network route is egress_proxy.py, which forwards to the model API's hosts
   and nothing else. It gets the kickoff message and nothing more.
5. Collects its four output files and its transcript into state/judging/<name>/results/<label>-rN/,
   and un-blinds them with judge_collect.py (which also checks the transcript for reads outside the
   package).

--repeat 2 runs the judge twice on the same package, independently, so the gap between the two
gradings measures the judge's own noise.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import claims  # noqa: E402
import gates  # noqa: E402
import hostenv  # noqa: E402
import judge_sandbox  # noqa: E402
import packdir  # noqa: E402

OUTPUTS = ("build-A.jsonl", "build-B.jsonl", "test-faults.jsonl", "summary.md")
JUDGE_ACCEPT_PORT = 19787
BUSY_PORTS = "8787, 18787 and 18788"
MODEL_API_HOSTS = ("chatgpt.com", "openai.com")
ACCEPTANCE_FILES = ("package.json", "package-lock.json", "playwright.config.ts")
PROXY_START_TIMEOUT_S = 10

KICKOFF = f"""Read `GRADING.md` in this folder and follow it exactly. Work only from files in this folder.
Write your output files (`build-A.jsonl`, `build-B.jsonl`, `test-faults.jsonl`, `summary.md`) in
this folder. Every dependency is already installed, including the held-out suite's in
`acceptance/`; there is no internet access. When you run a build or the held-out tests (step 5),
set `ACCEPT_PORT={JUDGE_ACCEPT_PORT}` and don't use ports {BUSY_PORTS} for anything you start: a
benchmark may be running on this machine."""


def work_dir_name(record: str) -> str:
    """The harness names a run's work dir after its record path, without the combinations/ prefix."""
    rel = record.strip("/").removeprefix("combinations/")
    return rel.replace("/", "__")


def last_accept(record: Path) -> Path:
    """The run's final held-out results: a whole-run re-score if there is one, else the last story's."""
    for final in ("accept-final.json", "accept.json"):
        if (record / final).exists():
            return record / final
    stories = sorted(p for p in (record / "stories").iterdir() if (p / "accept.json").exists())
    if not stories:
        raise SystemExit(f"{record}: no stories/NN/accept.json")
    return stories[-1] / "accept.json"


def scorer_fault(accept: Path) -> str | None:
    """Why a run's final held-out results say nothing about the build, or None. A judge given them
    would grade a machine fault as the build's."""
    d = json.loads(accept.read_text())
    tests = d.get("tests") or []
    return d.get("harness_fault") or gates.harness_fault(tests, d.get("runner_tail") or "")


def fetch_workspace(record: str, node: str | None, dest: Path) -> None:
    """A fresh clone of the run's final workspace, from this machine or over ssh."""
    work = f".vidi-bench/work/{work_dir_name(record)}/workspace"
    if node is None:
        src = hostenv.bench_home() / "work" / work_dir_name(record) / "workspace"
        subprocess.run(["git", "clone", "-q", str(src), str(dest)], check=True)
        return
    bundle = dest.with_suffix(".bundle")
    with bundle.open("wb") as f:
        subprocess.run(["ssh", "-o", "BatchMode=yes", node, f"git -C {work} bundle create - HEAD --branches"],
                       stdout=f, check=True)
    subprocess.run(["git", "clone", "-q", str(bundle), str(dest)], check=True)


def npm_ci(where: Path) -> None:
    if (where / "package-lock.json").exists():
        subprocess.run(["npm", "ci", "--no-audit", "--no-fund", "--loglevel=error"], cwd=where, check=True)


def tool_root(binary: str) -> Path:
    """The install root holding a CLI and its node, e.g. ~/.nvm/versions/node/v24: read-only in the sandbox."""
    path = shutil.which(binary)
    if not path:
        raise SystemExit(f"{binary} not found on PATH")
    return Path(path).resolve().parents[1]


def start_proxy(log: Path) -> tuple[subprocess.Popen, int]:
    cmd = [sys.executable, str(HERE / "egress_proxy.py"), "--log", str(log)]
    for h in MODEL_API_HOSTS:
        cmd += ["--allow", h]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True)
    deadline = time.time() + PROXY_START_TIMEOUT_S
    line = p.stdout.readline()
    if not line.strip().isdigit() or time.time() > deadline:
        p.terminate()
        raise SystemExit("egress proxy did not start")
    return p, int(line)


def run_judge(run_dir: Path, package: Path, args: argparse.Namespace) -> Path:
    """One independent judging of a clone of the package. Returns the results folder."""
    pkg = run_dir / "package"
    run_dir.mkdir(parents=True)
    subprocess.run(["cp", "-Rc", str(package), str(pkg)], check=True)  # APFS clone: instant, no extra space
    out, codex_home, scratch_home = run_dir / "out", run_dir / "codex-home", run_dir / "home"
    for d in (out, codex_home, scratch_home):
        d.mkdir(parents=True)
    auth = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "auth.json"
    shutil.copy(auth, codex_home / "auth.json")
    (codex_home / "auth.json").chmod(0o600)
    ro = [tool_root("codex"), tool_root("node"), hostenv.playwright_cache(Path.home())]
    profile_file = run_dir / "profile.sb"  # outside every allowed path: the judge can't read it
    profile_file.write_text(judge_sandbox.profile(home=Path.home(), rw=[pkg, out, codex_home, scratch_home],
                                                  ro=[p for p in ro if p.exists()]))
    proxy, port = start_proxy(out / "proxy.jsonl")
    proxy_url = f"http://127.0.0.1:{port}"
    env = {**os.environ, "CODEX_HOME": str(codex_home), "HOME": str(scratch_home),
           "HTTPS_PROXY": proxy_url, "HTTP_PROXY": proxy_url, "ALL_PROXY": proxy_url,
           "https_proxy": proxy_url, "http_proxy": proxy_url, "NO_PROXY": "localhost,127.0.0.1",
           "PLAYWRIGHT_BROWSERS_PATH": str(hostenv.playwright_cache(Path.home()))}
    cmd = ["sandbox-exec", "-f", str(profile_file), "codex", "exec", "--skip-git-repo-check",
           "--ignore-user-config", "--ignore-rules", "--ephemeral", "-C", str(pkg),
           "-s", "danger-full-access",  # its own sandbox can't nest inside ours; ours is the boundary
           "--json"]
    if args.model:
        cmd += ["-m", args.model]
    if args.effort:
        cmd += ["-c", f'model_reasoning_effort="{args.effort}"']
    cmd.append(KICKOFF)
    try:
        with (out / "transcript.jsonl").open("w") as t, (out / "stderr.txt").open("w") as e:
            rc = subprocess.run(cmd, cwd=pkg, env=env, stdin=subprocess.DEVNULL, stdout=t, stderr=e).returncode
    finally:
        proxy.terminate()
    results = run_dir.parent / "results" / f"{args.label}-{run_dir.name}"
    results.mkdir(parents=True)
    missing = [f for f in OUTPUTS if not (pkg / f).exists()]
    for f in OUTPUTS:
        if (pkg / f).exists():
            shutil.copy(pkg / f, results / f)
    shutil.copy(out / "transcript.jsonl", results / "transcript.jsonl")
    print(f"{run_dir.name}: judge exited {rc}; missing outputs: {', '.join(missing) or 'none'}")
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True)
    ap.add_argument("--build", action="append", required=True, help="label=<run record dir>[@node], exactly two")
    ap.add_argument("--label", required=True, help="names the judge: model and effort, e.g. codex-<model>-high")
    ap.add_argument("--model")
    ap.add_argument("--effort")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--scope", default="canvas")
    ap.add_argument("--audit", action="append", default=[], help="label=<audit.jsonl>, passed to judge_collect")
    a = ap.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("judge.py needs macOS (sandbox-exec)")
    if len(a.build) != 2:
        raise SystemExit("exactly two --build entries")
    private = packdir.private_checkout()
    state = private / "state"
    if subprocess.run(["git", "-C", str(private), "check-ignore", "-q", str(state / "x")]).returncode != 0:
        raise SystemExit(f"{private}/.gitignore must ignore /state/ before anything is written there")
    job = state / "judging" / a.name
    key = state / "keys" / f"{a.name}.json"
    if job.exists() or key.exists():
        raise SystemExit(f"{job} or {key} exists; choose a new name")
    src = job / "src"
    src.mkdir(parents=True)
    specs = []
    for b in a.build:
        label, _, rest = b.partition("=")
        record, _, node = rest.partition("@")
        rec = REPO / record
        fault = scorer_fault(last_accept(rec))
        if fault:
            raise SystemExit(f"{label}: {last_accept(rec).relative_to(REPO)} is a scorer fault, not a result "
                             f"({fault}). Re-score the run before judging it.")
        ws = src / label
        print(f"{label}: workspace from {node or 'this machine'}")
        fetch_workspace(record, node or None, ws)
        claims_dir = src / f"{label}-claims"
        print(f"{label}: claims for stories {' '.join(claims.write_claims(rec, claims_dir))}")
        specs.append(f"{label}={ws}:{claims_dir}:{last_accept(rec)}")
    package = job / "package"
    cmd = ["uv", "run", str(HERE / "grading_package.py"), "--name", a.name, "--out", str(package),
           "--key", str(key), "--scope", a.scope]
    for s in specs:
        cmd += ["--build", s]
    subprocess.run(cmd, check=True)
    accept_src = packdir.resolve() / "acceptance"
    for f in ACCEPTANCE_FILES:
        if (accept_src / f).exists():
            shutil.copy(accept_src / f, package / "acceptance" / f)
    for where in [package / "acceptance", package / "build-A" / "workspace", package / "build-B" / "workspace"]:
        print(f"installing dependencies in {where.relative_to(job)}")
        npm_ci(where)
    for r in range(1, a.repeat + 1):
        results = run_judge(job / f"run-{r}", package, a)
        cmd = ["uv", "run", str(HERE / "judge_collect.py"), a.name, results.name, "--dir", str(results),
               "--key", str(key), "--out", str(results / "report.md")]
        for x in a.audit:
            cmd += ["--audit", x]
        subprocess.run(cmd)
    print(f"done: {job / 'results'}")


if __name__ == "__main__":
    main()
