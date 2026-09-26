"""pack-version.sh: a run records its own pack's version, whatever tag the shared checkout sits on."""
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parent / "pack-version.sh"
G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]


def version(repo: Path, name: str) -> str:
    return subprocess.run([str(SCRIPT), str(repo / "packs" / name), name], capture_output=True, text=True).stdout.strip()


def commit(repo: Path, msg: str) -> None:
    subprocess.run([*G, "add", "-A"], cwd=repo, check=True)
    subprocess.run([*G, "commit", "-qm", msg], cwd=repo, check=True)


def test_each_pack_records_its_own_tag_when_its_files_match(tmp_path):
    repo = tmp_path / "private"
    (repo / "packs" / "vidi").mkdir(parents=True)
    subprocess.run([*G, "init", "-q"], cwd=repo, check=True)
    (repo / "packs" / "vidi" / "t.ts").write_text("v1")
    commit(repo, "vidi"); subprocess.run(["git", "tag", "vidi-v1"], cwd=repo, check=True)
    (repo / "packs" / "todoodle").mkdir()
    (repo / "packs" / "todoodle" / "t.ts").write_text("t1")
    commit(repo, "todoodle"); subprocess.run(["git", "tag", "todoodle-v1"], cwd=repo, check=True)
    # The checkout sits on todoodle-v1: vidi's files are unchanged since vidi-v1, so vidi runs record vidi-v1.
    assert version(repo, "vidi") == "vidi-v1"
    assert version(repo, "todoodle") == "todoodle-v1"
    # vidi changes after its tag: the record says so, with the commit.
    (repo / "packs" / "vidi" / "t.ts").write_text("v2")
    commit(repo, "vidi change")
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
    assert version(repo, "vidi") == f"vidi-v1+{head}"
    assert version(repo, "todoodle") == "todoodle-v1"
    # Uncommitted edits are never recorded as a clean tag.
    (repo / "packs" / "todoodle" / "t.ts").write_text("edited")
    assert version(repo, "todoodle").endswith("-dirty")


def test_a_pack_outside_git_is_reported_unversioned(tmp_path):
    (tmp_path / "packs" / "x").mkdir(parents=True)
    assert version(tmp_path, "x") == "unversioned"
