"""credentials.py: what in a command line is a credential and what only looks like one.

Until story 23 this module was also the credential scanner of the publishing step: every file the harness staged
for a public commit had its credentials replaced by a marker. Since story 23 (harness.no_publish) the harness commits
nothing, and the scanner went with that step (its history is in git). What is left is the one rule the run's
identity (identity.py) and the host description (hostenv.py) use when they mask command-line values.
"""
from __future__ import annotations

import re

# A flag that counts tokens (--draft-tokens 7, --max-tokens=32768) has "token" in its name and is not a credential.
# Only a number is exempt: a plural name with any other value could still be one.
_COUNT_FLAG = re.compile(r"^--?[\w-]*tokens$", re.I)
_COUNT_VALUE = re.compile(r"^\d+$")


def is_token_count(flag: str, value: str) -> bool:
    return bool(_COUNT_FLAG.match(flag) and _COUNT_VALUE.match(value))
