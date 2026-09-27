"""grading_package.py: the un-blinding key never lands where a grader or a commit could expose it."""
import subprocess

import grading_package as gp


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
