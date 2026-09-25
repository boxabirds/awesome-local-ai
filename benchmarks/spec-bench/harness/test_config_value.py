"""config-value.sh: run.sh reads CONTEXT_LIMIT/OUTPUT_LIMIT from a combination's config.sh. An inline
comment on the line (four combinations have one) must not become part of the value."""
import subprocess
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
REPO_ROOT = HARNESS.parents[2]


def cfg(path: Path, key: str) -> str:
    return subprocess.run(["bash", "-c", f'. "{HARNESS}/config-value.sh"; cfg "$0" "$1"', key, str(path)],
                          capture_output=True, text=True, check=True).stdout.strip()


def test_values_are_read_as_the_shell_would(tmp_path):
    f = tmp_path / "config.sh"
    f.write_text('CONTEXT_LIMIT=131072                      # must match the default profile\'s ctx\n'
                 'OUTPUT_LIMIT="32768"   # quoted\n'
                 "CLIENT='pi'\n"
                 'NAME="two words" # comment\n'
                 'PLAIN=8192\n'
                 '# CONTEXT_LIMIT=1 (a comment line, not a setting)\n')
    assert cfg(f, "CONTEXT_LIMIT") == "131072"
    assert cfg(f, "OUTPUT_LIMIT") == "32768"
    assert cfg(f, "CLIENT") == "pi"
    assert cfg(f, "NAME") == "two words"
    assert cfg(f, "PLAIN") == "8192"
    assert cfg(f, "MISSING") == ""


def test_every_combination_gives_numeric_limits():
    configs = sorted(REPO_ROOT.glob("combinations/**/config.sh"))
    assert configs
    for c in configs:
        for key in ("CONTEXT_LIMIT", "OUTPUT_LIMIT"):
            v = cfg(c, key)
            assert v.isdigit(), f"{c.relative_to(REPO_ROOT)}: {key}={v!r}"
