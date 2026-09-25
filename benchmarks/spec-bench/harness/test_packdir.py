"""A benchmark pack (spec, scope, prompts, held-out suite) is named by benchmarks/<name> and may live
outside the public repo, in the private repo's packs/<name>."""
from pathlib import Path

import packdir


def make_pack(root: Path, name: str = "vidi") -> Path:
    p = root / "packs" / name
    for d in ("spec", "acceptance", "scope", "prompts"):
        (p / d).mkdir(parents=True)
    return p


def public_repo(tmp_path: Path, monkeypatch) -> Path:
    repo = tmp_path / "awesome-local-ai"
    (repo / "benchmarks").mkdir(parents=True)
    monkeypatch.setattr(packdir, "REPO_ROOT", repo)
    for env in (packdir.ENV, *packdir.LEGACY_ENV.values()):
        monkeypatch.delenv(env, raising=False)
    return repo


def test_a_pack_is_named_by_path_or_name(tmp_path, monkeypatch):
    repo = public_repo(tmp_path, monkeypatch)
    assert packdir.public_dir("benchmarks/todoodle") == repo / "benchmarks" / "todoodle"
    assert packdir.public_dir("todoodle") == repo / "benchmarks" / "todoodle"
    assert packdir.name(repo / "benchmarks" / "vidi") == "vidi"


def test_explicit_env_wins(tmp_path, monkeypatch):
    public_repo(tmp_path, monkeypatch)
    pack = make_pack(tmp_path / "anywhere")
    monkeypatch.setenv(packdir.ENV, str(pack))
    assert packdir.resolve("benchmarks/vidi") == pack


def test_vidi_keeps_its_older_env_var(tmp_path, monkeypatch):
    public_repo(tmp_path, monkeypatch)
    pack = make_pack(tmp_path / "anywhere")
    monkeypatch.setenv("VIDI_PACK_DIR", str(pack))
    assert packdir.resolve("benchmarks/vidi") == pack
    assert packdir.resolve("benchmarks/todoodle") != pack  # only vidi reads the old name


def test_sibling_private_checkout_is_found_per_pack(tmp_path, monkeypatch):
    public_repo(tmp_path, monkeypatch)
    vidi = make_pack(tmp_path / packdir.PRIVATE_REPO, "vidi")
    assert packdir.resolve("benchmarks/vidi") == vidi
    # a pack the private repo does not hold falls back to the public directory
    assert packdir.resolve("benchmarks/todoodle") == tmp_path / "awesome-local-ai" / "benchmarks" / "todoodle"


def test_falls_back_to_the_in_repo_pack(tmp_path, monkeypatch):
    repo = public_repo(tmp_path, monkeypatch)
    (repo / "benchmarks" / "vidi" / "spec").mkdir(parents=True)
    assert packdir.resolve("benchmarks/vidi") == repo / "benchmarks" / "vidi"


def test_private_root_is_the_checkout_to_hide(tmp_path, monkeypatch):
    repo = public_repo(tmp_path, monkeypatch)
    pack = make_pack(tmp_path / packdir.PRIVATE_REPO)
    assert packdir.private_root(pack) == tmp_path / packdir.PRIVATE_REPO
    assert packdir.private_root(repo / "benchmarks" / "vidi") is None  # the repo itself is already hidden


def test_a_public_spec_takes_its_held_out_parts_from_the_private_repo(tmp_path, monkeypatch):
    """todoodle: the spec is public (benchmarks/todoodle/spec), the held-out suite and the grading
    brief are private (packs/todoodle/acceptance, packs/todoodle/GRADING.md)."""
    repo = public_repo(tmp_path, monkeypatch)
    public = repo / "benchmarks" / "todoodle"
    (public / "spec").mkdir(parents=True)
    private = tmp_path / packdir.PRIVATE_REPO / "packs" / "todoodle"
    (private / "acceptance" / "tests").mkdir(parents=True)
    (private / "GRADING.md").write_text("brief")
    assert packdir.resolve("benchmarks/todoodle") == public            # the spec stays public
    assert packdir.part("benchmarks/todoodle", "acceptance") == private / "acceptance"
    assert packdir.part("benchmarks/todoodle", "GRADING.md") == private / "GRADING.md"
    assert packdir.part("benchmarks/todoodle", "spec") == public / "spec"


def test_a_pack_s_own_part_wins_over_the_private_repo(tmp_path, monkeypatch):
    repo = public_repo(tmp_path, monkeypatch)
    public = repo / "benchmarks" / "todoodle"
    (public / "acceptance").mkdir(parents=True)
    (tmp_path / packdir.PRIVATE_REPO / "packs" / "todoodle" / "acceptance").mkdir(parents=True)
    assert packdir.part("benchmarks/todoodle", "acceptance") == public / "acceptance"


def test_a_part_nobody_has_is_the_pack_s_own_path(tmp_path, monkeypatch):
    repo = public_repo(tmp_path, monkeypatch)
    (repo / "benchmarks" / "todoodle" / "spec").mkdir(parents=True)
    assert packdir.part("benchmarks/todoodle", "acceptance") == repo / "benchmarks" / "todoodle" / "acceptance"
