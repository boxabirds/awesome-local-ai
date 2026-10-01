"""credentials.py — the credential scanner of the publishing step.

Everything the harness publishes goes through drive.record_story, which stages a run's directory for a public
commit. Before that commit is made, every staged file is put through redact_file (heldout.redact_staged): a
credential found in it is replaced by a marker that names what it was and how long, never the value, e.g.

    DEEPSEEK_API_KEY=[redacted: 35 characters]

and the names (never the values) are recorded with the story. The full log on the machine, which is not
published, is left as it is.

Why: on 1 Oct 2026 an agent ran `env | grep -i -E "PI_|WORK|CWD"`; `PI_` also matches `API_KEY`, so the owner's
provider keys were printed into a tool result and published in the story's log (inside a .gz, where
tests/privacy-test.sh can't see). Two other stories' `pgrep -fl` output put a session token into theirs.

What is looked for (each a named pattern below, each with its test in test_credentials.py):
- an environment-style assignment NAME=value whose NAME is upper case and contains one of ENV_NAME_KEYWORDS, with
  a value of MIN_VALUE_CHARS or more (also when the value is cut short by the end of the text or by a truncation
  marker);
- keys known by their prefix: sk- (sk-ant-, sk-or-, sk-proj-), GitHub tokens, AWS access key ids, the other
  providers' PROVIDER_PREFIXES;
- `Bearer <token>` with a token of BEARER_MIN_CHARS or more;
- PEM private key blocks;
and the same forms as they stand JSON-escaped inside an event's strings: a marker has no character JSON would
need escaped, and a value ends at a backslash, so a redacted line of the event log is still the same JSON object.

What is not: placeholder values (STUBKEY, xxx, your-key, example…, test…, changeme, ${VAR}), paths, numbers
(token counts), bare hashes, and a constant in source code (`export const SECRET = '…'`: spaces round the `=`, a
code assignment, the app's own fixture and not an environment credential). A key known by its prefix is redacted
wherever it stands, source code included.
"""
from __future__ import annotations

import gzip
import os
import re
from pathlib import Path

MIN_VALUE_CHARS = 8
ENV_NAME_KEYWORDS = ("API_KEY", "APIKEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "ACCESS_KEY", "PRIVATE_KEY")
# What ends a value: space, quotes, a backslash (a JSON escape), shell and markup punctuation, a truncation mark.
VALUE_CHAR = r"""[^\s"'\\$<>\[\]{}()|;&,`…]"""
# A name starts where no name character comes before it, or straight after a JSON-escaped line end or tab (in an
# event's string, the `n` of `\n` is the character before the first name of a line).
NAME_START = r"(?:(?<![A-Za-z0-9_])|(?<=\\[nrt]))"
ENV_ASSIGNMENT = re.compile(
    rf"""{NAME_START}([A-Z0-9_]*(?:{"|".join(ENV_NAME_KEYWORDS)})[A-Z0-9_]*)=(\\?["']?)({VALUE_CHAR}{{{MIN_VALUE_CHARS},}})""")
# Values that stand where a credential would and are none: what examples, tests and templates are written with.
PLACEHOLDER_STARTS = ("stub", "your", "example", "test", "changeme", "dummy", "fake", "placeholder", "sample",
                      "redacted", "none", "null", "undefined")
PATH_STARTS = ("/", "~", ".")
SK_MIN_CHARS = 16
SK_KEY_RE = re.compile(rf"(?<![A-Za-z0-9_-])sk-(?:ant-|or-|proj-)?(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{{{SK_MIN_CHARS},}}")
PREFIXED_MIN_CHARS = 20
GITHUB_TOKEN_RE = re.compile(rf"(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{{{PREFIXED_MIN_CHARS},}}"
                             rf"|github_pat_[A-Za-z0-9_]{{{PREFIXED_MIN_CHARS},}})")
AWS_KEY_ID_RE = re.compile(r"(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])")
BEARER_MIN_CHARS = 24
BEARER_RE = re.compile(rf"\bBearer(\s+)([A-Za-z0-9._~+/=-]{{{BEARER_MIN_CHARS},}})")
PROVIDER_PREFIXES = ("r8_", "gsk_", "fc-", "xai-", "csk-", "pplx-", "hf_")
PROVIDER_KEY_RE = re.compile(rf"(?<![A-Za-z0-9_-])(?:{'|'.join(PROVIDER_PREFIXES)})[A-Za-z0-9]{{{PREFIXED_MIN_CHARS},}}")
# A block's body is base64 and line ends, written out or JSON-escaped; a block cut short has no END line.
PEM_KEY_RE = re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----(?:[A-Za-z0-9+/=\s]|\\[nrt])*"
                        r"(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----)?")
# What each kind is called in a marker and in the record (an environment assignment goes by its own name).
SK_KEY, GITHUB_TOKEN, AWS_KEY_ID, BEARER, PROVIDER_KEY, PEM_KEY = (
    "sk- key", "GitHub token", "AWS access key id", "Bearer token", "provider key", "private key block")
KINDS = ((SK_KEY_RE, SK_KEY), (GITHUB_TOKEN_RE, GITHUB_TOKEN), (AWS_KEY_ID_RE, AWS_KEY_ID),
         (PROVIDER_KEY_RE, PROVIDER_KEY), (PEM_KEY_RE, PEM_KEY))
# No text without one of these has a match: most lines of a log are let through on this alone.
HINT = re.compile("KEY|TOKEN|SECRET|PASSW|Bearer|AKIA|sk-|gh[pousr]_|github_pat_|" + "|".join(map(re.escape, PROVIDER_PREFIXES)))
GZIP_SUFFIX = ".gz"
ENCODING = {"encoding": "utf-8", "errors": "surrogateescape"}     # whatever bytes a log holds are written back as they were


def is_placeholder(value: str) -> bool:
    """A value no one has to keep secret: a placeholder word, one repeated character, a number, a path."""
    low = value.lower()
    return (low.startswith(PLACEHOLDER_STARTS) or value.startswith(PATH_STARTS) or len(set(low)) == 1
            or low.isdigit())


def redact(text: str) -> tuple[str, list[str]]:
    """text with every credential replaced by its marker, and what each was (an environment name, or a kind), in
    the order found. Text with none comes back as it was."""
    if not HINT.search(text):
        return text, []
    names: list[str] = []

    def env(m: re.Match) -> str:
        name, quote, value = m.groups()
        if is_placeholder(value):
            return m.group(0)
        names.append(name)
        return f"{name}={quote}[redacted: {len(value)} characters]"

    def bearer(m: re.Match) -> str:
        if is_placeholder(m.group(2)):
            return m.group(0)
        names.append(BEARER)
        return f"Bearer{m.group(1)}[redacted {BEARER}: {len(m.group(2))} characters]"

    text = ENV_ASSIGNMENT.sub(env, text)
    text = BEARER_RE.sub(bearer, text)
    for pattern, kind in KINDS:
        def marker(m: re.Match, kind: str = kind) -> str:
            names.append(kind)
            return f"[redacted {kind}: {len(m.group(0))} characters]"
        text = pattern.sub(marker, text)
    return text, names


def _redact_gzip(f: Path) -> list[str] | None:
    """A gzipped log, line by line. It is read through once; only a log with a credential is written again.
    None for a file that is not gzip, whatever its name."""
    try:
        with gzip.open(f, "rt", **ENCODING) as src:
            if not any(redact(line)[1] for line in src):
                return []
    except (OSError, EOFError):
        return None
    names: list[str] = []
    tmp = f.with_name(f.name + ".redacting")
    with gzip.open(f, "rt", **ENCODING) as src, gzip.open(tmp, "wt", **ENCODING) as dst:
        for line in src:
            line, found = redact(line)
            names += found
            dst.write(line)
    os.replace(tmp, f)
    return names


def redact_file(f: Path) -> list[str]:
    """Redact a file about to be published, in place, and return what was found in it. A file with no credential
    is not written (byte for byte as it was); a binary file, or one that is gone, is left alone."""
    if not f.is_file():
        return []
    names = _redact_gzip(f) if f.name.endswith(GZIP_SUFFIX) else None
    if names is not None:
        return names
    data = f.read_bytes()
    if b"\0" in data:
        return []
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return []
    text, names = redact(text)
    if names:
        f.write_bytes(text.encode("utf-8"))
    return names
