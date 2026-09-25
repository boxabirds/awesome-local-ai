"""The Vidi pack (spec, scope, prompts, held-out suite) may live outside the public repo."""
from pathlib import Path

import packdir


def make_pack(root: Path) -> Path:
    p = root / "packs" / "vidi"
    for d in ("spec", "acceptance", "scope", "prompts"):
        (p / d).mkdir(parents=True)
    return p


def test_explicit_env_wins(tmp_path, monkeypatch):
    pack = make_pack(tmp_path / "anywhere")
    monkeypatch.setenv(packdir.ENV, str(pack))
    assert packdir.resolve(tmp_path / "public" / "benchmarks" / "vidi") == pack


def test_sibling_private_checkout_is_found(tmp_path, monkeypatch):
    monkeypatch.delenv(packdir.ENV, raising=False)
    public = tmp_path / "awesome-local-ai"
    legacy = public / "benchmarks" / "vidi"
    make_pack(legacy.parent.parent.parent / packdir.PRIVATE_REPO)  # sibling of the public repo
    assert packdir.resolve(legacy) == tmp_path / packdir.PRIVATE_REPO / "packs" / "vidi"


def test_falls_back_to_the_in_repo_pack(tmp_path, monkeypatch):
    monkeypatch.delenv(packdir.ENV, raising=False)
    legacy = tmp_path / "awesome-local-ai" / "benchmarks" / "vidi"
    (legacy / "spec").mkdir(parents=True)
    assert packdir.resolve(legacy) == legacy


def test_private_root_is_the_checkout_to_hide(tmp_path, monkeypatch):
    pack = make_pack(tmp_path / packdir.PRIVATE_REPO)
    assert packdir.private_root(pack) == tmp_path / packdir.PRIVATE_REPO
    legacy = tmp_path / "awesome-local-ai" / "benchmarks" / "vidi"
    assert packdir.private_root(legacy) is None  # in-repo pack: the repo itself is already hidden
