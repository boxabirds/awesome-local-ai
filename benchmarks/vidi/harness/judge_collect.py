"""judge_collect.py <package-name> <judge-label> [--audit <build>=<audit.jsonl> ...] [--dir DIR]

Check and un-blind an independent judge's results (pushed by judge-submit.sh), on the machine that
holds the key (~/.vidi-bench/keys/<name>.json):

  1. the four output files exist and every row is well-formed (category, severity, evidence, own_way);
  2. the transcript, if there is one, shows no reads outside the package: any path into the public
     repo, the private repo outside the package, or the bench home is a peek;
  3. A and B become the build names, and the judge's counts are set beside our own audits'.

Reads gradings/<name>/results/<judge>/ from the private repo's origin/main (fetched first) unless
--dir says otherwise. Writes the report to stdout; --out saves it.

  uv run judge_collect.py vidi-v1 gpt-5.6 \\
      --audit opus=benchmarks/reference/vidi/opus-5.5/run-1/audit.jsonl \\
      --audit flash-next=combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/benchmarks/vidi/canvas-pi-01/audit.jsonl
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import hostenv
import packdir

HERE = Path(__file__).resolve().parent
OUTPUTS = ("build-A.jsonl", "build-B.jsonl", "test-faults.jsonl", "summary.md")
CATEGORIES = {"functional", "false-claim", "missing-test", "weak-test", "design-deviation", "gap-fill"}
SEVERITIES = ("high", "medium", "low")
OWN_WAY = {"works", "partial", "broken", "not-applicable", "not-run"}
REQUIRED = ("story", "category", "severity", "discrepancy", "evidence")
# Folders the judge must never read: our audits and run records, and anything else we keep.
FORBIDDEN_MARKERS = ("awesome-local-ai/", ".vidi-bench", "awesome-local-ai-bench-private/")
PATH_RE = re.compile(r"(?:/Users/|/home/|~/)[^\s\"'`\\)\]>,;]+")
EXAMPLES = 5


def read_jsonl(text: str) -> tuple[list[dict], list[str]]:
    rows, problems = [], []
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            problems.append(f"line {n}: not JSON ({e.msg})")
    return rows, problems


def row_problems(rows: list[dict]) -> list[str]:
    out = []
    for n, r in enumerate(rows, 1):
        missing = [k for k in REQUIRED if not r.get(k)]
        if missing:
            out.append(f"row {n}: missing {', '.join(missing)}")
        if r.get("category") not in CATEGORIES:
            out.append(f"row {n}: category {r.get('category')!r}")
        if r.get("severity") not in SEVERITIES:
            out.append(f"row {n}: severity {r.get('severity')!r}")
        if "own_way" in r and r["own_way"] not in OWN_WAY:
            out.append(f"row {n}: own_way {r['own_way']!r}")
    return out


def peeks(transcript: str, package_marker: str) -> list[str]:
    """Paths in the transcript outside the package that lead to something the judge mustn't see."""
    found = []
    for p in dict.fromkeys(PATH_RE.findall(transcript)):
        if package_marker in p:
            continue
        if any(m in p for m in FORBIDDEN_MARKERS):
            found.append(p)
    return found


def counts(rows: list[dict]) -> dict:
    counted = [r for r in rows if r.get("status", "counted") == "counted"]
    functional = [r for r in counted if r.get("category") == "functional"]
    return {
        "rows": len(counted),
        "by_category": dict(collections.Counter(r["category"] for r in counted)),
        "functional_by_severity": {s: sum(r.get("severity") == s for r in functional) for s in SEVERITIES},
        "functional_by_story": dict(sorted(collections.Counter(int(r["story"]) for r in functional).items())),
        "own_way": dict(collections.Counter(r["own_way"] for r in counted if "own_way" in r)),
    }


def compare(judge: dict, ours: dict) -> list[str]:
    stories = sorted(set(judge["functional_by_story"]) | set(ours["functional_by_story"]))
    return [f"story {s}: judge {judge['functional_by_story'].get(s, 0)}, ours {ours['functional_by_story'].get(s, 0)}"
            for s in stories if judge["functional_by_story"].get(s, 0) != ours["functional_by_story"].get(s, 0)]


def report(name: str, judge_label: str, files: dict[str, str], key: dict, audits: dict[str, Path]) -> str:
    lines = [f"# {judge_label} on {name}", ""]
    missing = [f for f in OUTPUTS if not files.get(f)]
    if missing:
        lines += [f"**Missing outputs:** {', '.join(missing)}", ""]
    transcript = files.get("transcript")
    if transcript is None:
        lines += ["**Transcript:** none, so nothing shows the judge stayed inside the package.", ""]
    else:
        bad = peeks(transcript, f"judging/{name}")
        lines += [f"**Transcript:** {len(bad)} path(s) outside the package into forbidden folders"
                  + ("." if not bad else ": " + "; ".join(bad[:EXAMPLES])), ""]
    for letter in "AB":
        build = key.get(letter, f"build {letter}")
        rows, parse = read_jsonl(files.get(f"build-{letter}.jsonl", ""))
        problems = parse + row_problems(rows)
        c = counts(rows)
        lines += [f"## Build {letter} = {build}", "",
                  f"- rows: {c['rows']}, by category {c['by_category']}",
                  f"- functional by severity: {c['functional_by_severity']}",
                  f"- own way (held-out app faults): {c['own_way'] or 'none recorded'}"]
        if problems:
            lines.append(f"- **{len(problems)} malformed row(s):** " + "; ".join(problems[:EXAMPLES]))
        if build in audits:
            ours = counts(read_jsonl(audits[build].read_text())[0])
            lines += [f"- our audit: rows {ours['rows']}, functional by severity {ours['functional_by_severity']}"]
            diff = compare(c, ours)
            lines += ["- functional rows per story that differ: " + ("; ".join(diff) if diff else "none")]
        lines.append("")
    return "\n".join(lines)


def load_results(name: str, judge: str, directory: Path | None) -> dict[str, str]:
    if directory:
        files = {f: (directory / f).read_text() for f in OUTPUTS if (directory / f).exists()}
        tr = sorted(directory.glob("transcript*"))
        if tr:
            files["transcript"] = tr[0].read_text(errors="replace")
        return files
    private = packdir.private_root(packdir.resolve(HERE.parent))
    if not private:
        raise SystemExit("no private pack repo next to this one")
    subprocess.run(["git", "-C", str(private), "fetch", "-q", "origin"], check=True)
    prefix = f"gradings/{name}/results/{judge}"
    listing = subprocess.run(["git", "-C", str(private), "ls-tree", "--name-only", f"origin/main:{prefix}"],
                             capture_output=True, text=True)
    if listing.returncode != 0:
        raise SystemExit(f"no {prefix} on the private repo's origin/main (run judge-submit.sh first)")
    files = {}
    for f in listing.stdout.split():
        text = subprocess.run(["git", "-C", str(private), "show", f"origin/main:{prefix}/{f}"],
                              capture_output=True, text=True, errors="replace").stdout
        files["transcript" if f.startswith("transcript") else f] = text
    return files


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name")
    ap.add_argument("judge")
    ap.add_argument("--audit", action="append", default=[], help="<build>=<audit.jsonl>, to compare with")
    ap.add_argument("--dir", type=Path, help="read results from here instead of the private repo")
    ap.add_argument("--key", type=Path, help="default: ~/.vidi-bench/keys/<name>.json")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    key_path = a.key or hostenv.bench_home() / "keys" / f"{a.name}.json"
    if not key_path.exists():
        raise SystemExit(f"no key at {key_path}: un-blind on the machine that made the package")
    audits = {b: Path(p).expanduser() for b, p in (x.split("=", 1) for x in a.audit)}
    text = report(a.name, a.judge, load_results(a.name, a.judge, a.dir), json.loads(key_path.read_text()), audits)
    if a.out:
        a.out.write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
