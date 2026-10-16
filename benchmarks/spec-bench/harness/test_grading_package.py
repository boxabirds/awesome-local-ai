"""grading_package.py: the un-blinding key never lands where a grader or a commit could expose it."""
import json
import stat
import subprocess

import pytest

import grading_package as gp
import packdir


def repo(tmp_path):
    r = tmp_path / "private"
    r.mkdir()
    subprocess.run(["git", "init", "-q", str(r)], check=True)
    (r / ".gitignore").write_text("/state/\n")
    return r


def test_key_inside_the_package_is_refused(tmp_path):
    r = repo(tmp_path)
    out = r / "state" / "judging" / "x" / "package"
    assert "inside the package" in gp.key_location_problem(out / "key.json", out, r)


def test_key_in_a_tracked_part_of_the_private_repo_is_refused(tmp_path):
    r = repo(tmp_path)
    assert "not git-ignored" in gp.key_location_problem(r / "keys" / "x.json", r / "state" / "judging" / "x", r)


def test_key_in_the_ignored_state_folder_or_outside_the_repo_is_fine(tmp_path):
    r = repo(tmp_path)
    out = r / "state" / "judging" / "x" / "package"
    assert gp.key_location_problem(r / "state" / "keys" / "x.json", out, r) is None
    assert gp.key_location_problem(tmp_path / "elsewhere" / "x.json", out, r) is None


KEY_FILE_MODE = 0o600  # owner read/write only


def build_inputs(tmp_path, name, source):
    """One finished build as the command takes it: a git workspace (with a spec/ the package must leave out), a claims folder
    and a held-out result. Returns the `name=workspace:claims:accept.json` argument."""
    ws, claims = tmp_path / f"{name}-ws", tmp_path / f"{name}-claims"
    (ws / "spec").mkdir(parents=True)
    (ws / "spec" / "brief.md").write_text("the brief")
    (ws / "app.ts").write_text(source)
    git = ["git", "-C", str(ws), "-c", "user.name=a", "-c", "user.email=a@a"]
    for step in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "story 1: pan"]):
        subprocess.run([*git, *step], check=True)
    claims.mkdir()
    (claims / "story-01.md").write_text("# story 01\nDone by Claude.\n")
    accept = tmp_path / f"{name}-accept.json"
    accept.write_text(json.dumps({"passed": 1, "total": 2}))
    return f"{name}={ws}:{claims}:{accept}"


def private_pack(tmp_path):
    """A pack in a private repo's packs/vidi, as packdir.private_root recognises it."""
    pack = tmp_path / "private" / "packs" / "vidi"
    (pack / "spec").mkdir(parents=True)
    (pack / "spec" / "spec.md").write_text("spec")
    (pack / "scope").mkdir()
    (pack / "scope" / "canvas.json").write_text('{"stories": []}')
    (pack / "acceptance" / "tests").mkdir(parents=True)
    (pack / "acceptance" / "tests" / "story-01.spec.ts").write_text("test")
    (pack / "GRADING.md").write_text("grade it")
    return pack


@pytest.fixture
def command(tmp_path, monkeypatch):
    pack = private_pack(tmp_path)
    monkeypatch.setenv(packdir.ENV, str(pack))
    monkeypatch.setenv("VIDI_BENCH_HOME", str(tmp_path / "bench-home"))

    def run(*args):
        monkeypatch.setattr("sys.argv", ["grading_package.py", *args])
        gp.main()
    return run


def test_the_command_needs_exactly_two_builds(tmp_path, command):
    with pytest.raises(SystemExit, match="exactly two --build entries"):
        command("--name", "x", "--build", build_inputs(tmp_path, "one", "const a = 1"))


def test_the_command_refuses_a_key_inside_the_package(tmp_path, command):
    out = tmp_path / "pkg"
    builds = [arg for n in ("one", "two") for arg in ("--build", build_inputs(tmp_path, n, "const a = 1"))]
    with pytest.raises(SystemExit, match="inside the package"):
        command("--name", "x", "--out", str(out), "--key", str(out / "key.json"), *builds)
    assert not out.exists()


def test_the_command_refuses_a_package_name_that_exists(tmp_path, command):
    out = tmp_path / "pkg"
    out.mkdir()
    builds = [arg for n in ("one", "two") for arg in ("--build", build_inputs(tmp_path, n, "const a = 1"))]
    with pytest.raises(SystemExit, match="exists; choose a new name"):
        command("--name", "x", "--out", str(out), "--key", str(tmp_path / "key.json"), *builds)
    assert list(out.iterdir()) == []


def test_the_command_builds_a_blinded_package_and_keeps_the_key_outside_it(tmp_path, command, capsys):
    out, key_path = tmp_path / "pkg", tmp_path / "keys" / "x.json"
    builds = [arg for n, src in (("one", "const vendor = 'Qwen'"), ("two", "const a = 1")) for arg in ("--build", build_inputs(tmp_path, n, src))]
    command("--name", "x", "--out", str(out), "--key", str(key_path), *builds)
    key = json.loads(key_path.read_text())
    assert sorted(key) == ["A", "B"] and sorted(key.values()) == ["one", "two"]
    assert stat.S_IMODE(key_path.stat().st_mode) == KEY_FILE_MODE
    assert (out / "GRADING.md").read_text() == "grade it" and (out / "spec" / "spec.md").read_text() == "spec"
    assert (out / "scope.json").read_text() == '{"stories": []}'
    assert (out / "acceptance" / "tests" / "story-01.spec.ts").read_text() == "test"
    scrubbed = {name: (out / f"build-{letter}" / "workspace" / "app.ts").read_text() for letter, name in key.items()}
    assert scrubbed == {"one": "const vendor = '[setup]'", "two": "const a = 1"}
    assert not (out / "build-A" / "workspace" / "spec").exists()
    printed = capsys.readouterr().out.splitlines()
    letter_of = {name: letter for letter, name in key.items()}
    assert f"build-{letter_of['one']}: 1 workspace files had setup names scrubbed" in printed
    assert f"build-{letter_of['two']}: 0 workspace files had setup names scrubbed" in printed
    assert printed[-2:] == [f"package: {out.resolve()}", f"key (don't share with the grader): {key_path.resolve()}"]


def test_the_command_defaults_put_the_package_in_the_private_repo_and_the_key_in_the_bench_home(tmp_path, command):
    builds = [arg for n in ("one", "two") for arg in ("--build", build_inputs(tmp_path, n, "const a = 1"))]
    command("--name", "v2", *builds)
    assert (tmp_path / "private" / "gradings" / "v2" / "build-A" / "workspace" / "app.ts").exists()
    assert (tmp_path / "bench-home" / "keys" / "v2.json").exists()
