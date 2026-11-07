"""heldout.py: where a run's held-out detail lives.

publicise.py says what may be public; this applies it to a run directory:

- metrics.json is written public (publicise.strip_metrics) with the held-out detail beside it in a sidecar
  (publicise.HELDOUT_DETAIL); load_metrics puts the two back together, so a resumed run and the machine's own tools
  (report, history) see everything.
- each held-out result (accept.json, accept-final.json) gets its public summary beside it (write_accept,
  write_summaries).
- find() looks for a detail file in the run, then in the private repo's copy (runs/<the run's path>/), where runs from
  before story 23 had theirs copied. Since story 23 the detail stays in the run folder, and the collector takes it to
  the lake (harness.no_publish): nothing is copied or committed anywhere.
Tests: test_publish_gate.py.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import benchlake
import packdir
import publicise as pub

# Where the private repo is: this variable, else the checkout beside this repo (packdir.private_checkout).
PRIVATE_ENV = "SPEC_BENCH_PRIVATE_REPO"
PRIVATE_RUNS = "runs"          # the private repo's copy of each run's detail: runs/<run id>/
METRICS = "metrics.json"
# Directories never walked for held-out results or private files: the agent's work and build output.
SKIP_PARTS = {"workspace", "node_modules", ".git"}
FINGERPRINT_DIGEST_CHARS = 12  # how a refused commit names a title in records that are themselves public


def private_repo() -> Path:
    return Path(os.environ[PRIVATE_ENV]).expanduser() if os.environ.get(PRIVATE_ENV) else packdir.private_checkout()


def repo_of(d: Path) -> tuple[Path, str] | None:
    """The git checkout a directory is in, and the directory's path inside it; None outside any checkout."""
    d = d.resolve()
    for root in (d, *d.parents):
        if (root / ".git").exists():
            return root, d.relative_to(root).as_posix()
    return None


def lake_name(d: Path) -> str | None:
    """A directory in the lake as the private repo names it (story 23): the run id, the same on every machine that
    holds a copy, then the path below the run folder ("" for a folder above any run). None outside the lake."""
    d, lake = d.resolve(), benchlake.state().resolve()
    if d.is_relative_to(lake / benchlake.COLLECTED):
        return "/".join(d.relative_to(lake / benchlake.COLLECTED).parts[1:])   # without the machine's folder
    if d.is_relative_to(lake / benchlake.REFERENCE):
        rel = d.relative_to(lake / benchlake.REFERENCE).as_posix()
        return "" if rel == "." else f"{benchlake.REFERENCE_ID_PREFIX}/{rel}"
    if d.is_relative_to(lake):
        return ""
    return None


def private_copy(d: Path, private: Path | None = None) -> Path | None:
    """Where the private repo keeps this directory's detail: <private>/runs/<run id>[/<path below the run>]. A
    directory in the lake is named by its run id; one in a checkout (a node's own run) by its path there."""
    name = lake_name(d)
    if name is None:
        found = repo_of(d)
        name = found[1] if found else ""
    if name in ("", "."):
        return None
    return (private or private_repo()) / PRIVATE_RUNS / name


def find(d: Path, rel: str, private: Path | None = None) -> Path | None:
    """A detail file of a run (or of one of its re-scores): the machine's own copy, else the private repo's."""
    local = d / rel
    if local.exists():
        return local
    copy = private_copy(d, private)
    if copy is not None and (copy / rel).exists():
        return copy / rel
    return None


def read_json(d: Path, rel: str, private: Path | None = None) -> dict | None:
    f = find(d, rel, private)
    try:
        return json.loads(f.read_text()) if f else None
    except (OSError, json.JSONDecodeError):
        return None


def accept_or_summary(d: Path, rel: str, private: Path | None = None) -> dict | None:
    """A held-out result where its detail can be found, else its public summary: enough for counts either way."""
    full = read_json(d, rel, private)
    if full is not None:
        return full
    name = Path(rel).name
    if name not in pub.SUMMARY_NAMES:
        return None
    try:
        return json.loads((d / Path(rel).with_name(pub.SUMMARY_NAMES[name])).read_text())
    except (OSError, json.JSONDecodeError):
        return None


def result_dirs(d: Path, private: Path | None = None) -> list[Path]:
    """The story directories under d/stories that have a held-out result, here or in the private copy."""
    names = set()
    copy = private_copy(d, private)
    for root in [d] + ([copy] if copy else []):
        if (root / "stories").is_dir():
            names |= {s.name for s in (root / "stories").iterdir() if (s / "accept.json").exists()}
    return [d / "stories" / n for n in sorted(names)]


# ---------- metrics.json ----------

def load_metrics(run: Path, private: Path | None = None) -> dict:
    """metrics.json with its held-out detail back in, wherever the detail is kept."""
    p = run / METRICS
    public = json.loads(p.read_text()) if p.exists() else {"stories": {}}
    return pub.merge_metrics(public, read_json(run, pub.HELDOUT_DETAIL, private) or {})


def save_metrics(run: Path, metrics: dict) -> None:
    """metrics.json as it may be published, and its held-out detail in the git-ignored sidecar."""
    public, detail = pub.split_metrics(metrics)
    (run / METRICS).write_text(json.dumps(public, indent=2))
    sidecar = run / pub.HELDOUT_DETAIL
    if detail:
        sidecar.write_text(json.dumps(detail, indent=2))
    else:
        sidecar.unlink(missing_ok=True)


# ---------- held-out results and their summaries ----------

def write_accept(path: Path, acc: dict) -> None:
    """A held-out result, and its public summary beside it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(acc, indent=2))
    if path.name in pub.SUMMARY_NAMES:
        (path.parent / pub.SUMMARY_NAMES[path.name]).write_text(json.dumps(pub.summarise_accept(acc), indent=2))


def _walk(run: Path):
    for dirpath, dirnames, filenames in os.walk(run):
        dirnames[:] = [n for n in dirnames if n not in SKIP_PARTS]
        for n in filenames:
            yield Path(dirpath) / n


def write_summaries(run: Path) -> list[str]:
    """The public summary beside every held-out result in the run that has one (publicise.summary_path),
    wherever the result came from (the harness, rescore.py, gates.py, a hand-made accept-final.json).
    Returns the summaries written or changed, relative to the run."""
    out = []
    for f in _walk(run):
        rel = f.relative_to(run).as_posix()
        summary = pub.summary_path(rel)
        if summary is None:
            continue
        try:
            text = json.dumps(pub.summarise_accept(json.loads(f.read_text())), indent=2)
        except (OSError, json.JSONDecodeError, AttributeError):
            continue          # not a result (or half-written): nothing to summarise
        dest = run / summary
        if not dest.exists() or dest.read_text() != text:
            dest.write_text(text)
            out.append(summary)
    return out


REPORT = "summary.md"   # report.write_summary's public report; its full form is publicise.SUMMARY_DETAIL


def make_public(run: Path) -> dict:
    """Everything in the run that the harness publishes, in its public form, before it is staged: a summary beside
    every held-out result, every metrics.json split (a re-score's copy too, and any a harness from before the
    split wrote), and summary.md redacted with its full form kept beside it. Idempotent. Returns what it changed."""
    changed: dict = {"summaries": write_summaries(run), "metrics": [], "reports": []}
    for f in list(_walk(run)):
        rel = f.relative_to(run).as_posix()
        if f.name == METRICS:
            try:
                public = json.loads(f.read_text())
            except (OSError, json.JSONDecodeError):
                continue      # not metrics this can read: the check before the commit decides
            if not isinstance(public.get("stories"), dict):
                continue
            public, detail = pub.split_metrics(public)
            if detail:
                # The detail in metrics.json is the latest; it goes over what the sidecar already held.
                sidecar = f.parent / pub.HELDOUT_DETAIL
                held = (json.loads(sidecar.read_text()) if sidecar.exists() else {}).get("stories") or {}
                for sid, fields in detail["stories"].items():
                    held[sid] = {**held.get(sid, {}), **fields}
                sidecar.write_text(json.dumps({"stories": held}, indent=2))
                f.write_text(json.dumps(public, indent=2))
                changed["metrics"].append(rel)
        elif f.name == REPORT:
            text = f.read_text(errors="replace")
            public = pub.redact_markdown(text)
            if public != text:
                if not (f.parent / pub.SUMMARY_DETAIL).exists():
                    (f.parent / pub.SUMMARY_DETAIL).write_text(text)
                f.write_text(public)
                changed["reports"].append(rel)
    return changed


# ---------- the private copy ----------



# ---------- the check before a commit ----------


