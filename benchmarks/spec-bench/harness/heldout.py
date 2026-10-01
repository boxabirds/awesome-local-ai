"""heldout.py — where a run's held-out detail lives, and the check that keeps it out of the public repo.

publicise.py says what may be public; this applies it to a run directory:

- metrics.json is written public (publicise.strip_metrics) with the held-out detail beside it in a git-ignored
  sidecar (publicise.HELDOUT_DETAIL); load_metrics puts the two back together, so a resumed run and the machine's
  own tools (report, history) see everything, and the file git commits never holds a test title or runner output.
- each held-out result (accept.json, accept-final.json) gets its public summary beside it (write_accept,
  write_summaries); the result itself stays git-ignored.
- the full detail is copied to the private repo (copy_private), at runs/<the run's path in this repo>/, so it
  outlives the machine. find() looks for a detail file in the run, then in that copy: on the Mac, where a run's
  directory comes from git, the detail is only in the copy.
- staged_problems is the check record_story runs before every commit: a private file, a held-out test title
  (publicise.fingerprints of the private suite), or a local machine name (machine_names.py: the dbench node list's
  names and this machine's hostname, read at run time) in any staged file of the run, and nothing is committed.
Tests: test_publish_gate.py, which also takes a whole run through drive.record_story.
"""
from __future__ import annotations

import functools
import gzip
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import credentials
import machine_names as mn
import packdir
import publicise as pub

# Where the private repo is: this variable, else the checkout beside this repo (packdir.private_checkout).
PRIVATE_ENV = "SPEC_BENCH_PRIVATE_REPO"
PRIVATE_RUNS = "runs"          # the private repo's copy of each run's detail: runs/<repo-relative run dir>/
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


def private_copy(d: Path, private: Path | None = None) -> Path | None:
    """Where the private repo keeps this directory's detail: <private>/runs/<its path in its checkout>."""
    found = repo_of(d)
    if not found or found[1] in ("", "."):
        return None
    return (private or private_repo()) / PRIVATE_RUNS / found[1]


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

def private_files(run: Path, repo_root: Path) -> list[str]:
    """The run's private files (publicise.is_private), relative to the run."""
    base = run.resolve().relative_to(repo_root.resolve()).as_posix()
    return sorted(f.relative_to(run).as_posix() for f in _walk(run)
                  if f.is_file() and pub.is_private(f"{base}/{f.relative_to(run).as_posix()}"))


def copy_private(run: Path, repo_root: Path, private: Path) -> list[str]:
    """Copy the run's private files to <private>/runs/<run's path in repo_root>/, the ones new or changed since the
    last copy. Nothing is deleted there: it is the archive. Returns what was copied, relative to the run."""
    dest = private / PRIVATE_RUNS / run.resolve().relative_to(repo_root.resolve())
    copied = []
    for rel in private_files(run, repo_root):
        src, dst = run / rel, dest / rel
        s = src.stat()
        if dst.exists() and dst.stat().st_size == s.st_size and int(dst.stat().st_mtime) == int(s.st_mtime):
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(rel)
    return copied


# ---------- the check before a commit ----------

@functools.lru_cache(maxsize=None)
def _fingerprints(private: str) -> frozenset[str]:
    return frozenset(pub.fingerprints(Path(private))) if (Path(private) / ".git").exists() else frozenset()


def fingerprints(private: Path | None = None) -> set[str]:
    """Held-out titles from the private checkout, read once per process; none without a checkout (the anchor
    mark is still caught)."""
    return set(_fingerprints(str((private or private_repo()).resolve())))


def digest(fingerprint: str) -> str:
    """A stand-in for a held-out title in public records: the title itself would be the leak."""
    return hashlib.sha256(fingerprint.encode()).hexdigest()[:FINGERPRINT_DIGEST_CHARS]


def _text(rel: str, data: bytes) -> str:
    if rel.endswith(".gz"):
        try:
            data = gzip.decompress(data)
        except (OSError, EOFError):
            pass              # not really gzip: check the bytes as they are
    return data.decode("utf-8", errors="replace")


PRIVATE_FILE = "private file"
HELD_OUT = "held-out detail"
MACHINE_NAME = "machine name"
CHECK_FAILED = "check failed"
NODE_LIST_UNREADABLE = f"{CHECK_FAILED}: the local dbench node list can't be read"


def local_names() -> tuple[set[str], list[dict]]:
    """The local machine names (machine_names.local_names), read now; a node list that can't be read is a
    CHECK_FAILED problem (it fails closed), named without its path, which is under the owner's home."""
    try:
        return mn.local_names(), []
    except ValueError:
        return set(), [{"file": mn.NODES_REL, "why": NODE_LIST_UNREADABLE, "fingerprint": None}]


def staged_problems(repo_root: Path, rel: str, git: list[str], fps: set[str], env: dict | None = None,
                    names: set[str] | None = None) -> list[dict]:
    """Every staged file under rel that must not be committed, as {"file", "why", "fingerprint"}: why is
    PRIVATE_FILE (a private path, whatever it holds), HELD_OUT (fingerprint is the held-out title, or the anchor
    mark, found in it), MACHINE_NAME (fingerprint is a local machine name found in its path or text; names, else
    local_names()) or CHECK_FAILED (the check could not read it: it fails closed). The staged content is what
    is read (the index, not the working tree; env may name another index, GIT_INDEX_FILE)."""
    problems: list[dict] = []
    if names is None:
        names, problems = local_names()
    listed = subprocess.run([*git, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT", "--", rel],
                            cwd=repo_root, capture_output=True, env=env)
    if listed.returncode != 0:
        return [*problems, {"file": rel, "why": f"{CHECK_FAILED}: {listed.stderr.decode(errors='replace')[-200:]}",
                            "fingerprint": None}]
    for path in filter(None, listed.stdout.decode().split("\0")):
        if pub.is_private(path):
            problems.append({"file": path, "why": PRIVATE_FILE, "fingerprint": None})
            continue
        if pub.is_own_work(path):
            continue
        blob = subprocess.run([*git, "show", f":{path}"], cwd=repo_root, capture_output=True, env=env)
        if blob.returncode != 0:
            problems.append({"file": path, "why": f"{CHECK_FAILED}: could not read the staged file", "fingerprint": None})
            continue
        text = _text(path, blob.stdout)
        problems += [{"file": path, "why": HELD_OUT, "fingerprint": fp} for fp in pub.leaks_in_file(path, text, fps)]
        problems += [{"file": path, "why": MACHINE_NAME, "fingerprint": n} for n in mn.in_file(path, text, names)]
    return problems


def redact_staged(repo_root: Path, rel: str, git: list[str], env: dict | None = None) -> tuple[list[str], list[dict]]:
    """The credential scan of the publishing step (credentials.py): every file staged under rel for this commit
    (new or changed since HEAD) is redacted in place and staged again, so no path into a public commit goes round
    it. Returns what was found, by name and never by value, and CHECK_FAILED problems where the scan could not be
    done: it fails closed, and the commit is refused. Private files are skipped: they are never committed."""
    failed = lambda why: {"file": rel, "why": f"{CHECK_FAILED}: {why}", "fingerprint": None}
    listed = subprocess.run([*git, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT", "--", rel],
                            cwd=repo_root, capture_output=True, env=env)
    if listed.returncode != 0:
        return [], [failed(f"the credential scan could not list the staged files: {listed.stderr.decode(errors='replace')[-200:]}")]
    found: list[str] = []
    changed: list[str] = []
    for path in filter(None, listed.stdout.decode().split("\0")):
        if pub.is_private(path):
            continue
        names = credentials.redact_file(repo_root / path)
        if names:
            found += names
            changed.append(path)
    if changed:
        add = subprocess.run([*git, "add", "--", *changed], cwd=repo_root, capture_output=True, text=True, env=env)
        if add.returncode != 0:
            return found, [failed("a file redacted by the credential scan could not be staged again")]
    return found, []


def message_problems(message: str, names: set[str], where: str) -> list[dict]:
    """A commit message is as public as the files: the local machine names in it, as problems of `where`."""
    return [{"file": where, "why": MACHINE_NAME, "fingerprint": n} for n in mn.found(message, names)]
