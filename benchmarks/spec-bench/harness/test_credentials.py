"""The credential scanner of the publishing step (credentials.py; applied in drive.record_story to every file
staged for a public commit).

1 Oct 2026: an agent ran `env | grep -i -E "PI_|WORK|CWD"`; `PI_` also matches `API_KEY`, and the owner's provider
keys were printed into a tool result and published in the story's log. Two other stories' `pgrep -fl` output put a
session token into theirs. The lines below are those lines with every value replaced by a made-up one of the same
shape and length. No fixture here is, or is part of, a real credential; the prefixed ones are put together at run
time so that no scanner reading this file finds a key in it.
"""
from __future__ import annotations

import gzip
import json

import pytest

import credentials

HEX = "0123456789abcdef"
FAKE_DEEPSEEK = "sk-" + HEX * 2                                   # the shape of a DeepSeek key: sk- and 32 hex, 35 characters
FAKE_SESSION_TOKEN = "fedcba9876543210" * 2                       # 32 hex
ALNUM = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"
DEEPSEEK_CHARS = 35
SHOWN_BEFORE_THE_CUT = 28                                          # what the old truncation left of the key in the log

ENV_OUTPUT = f"PI_CODING_AGENT=true\nDEEPSEEK_API_KEY={FAKE_DEEPSEEK}\nPWD=/work/run/workspace\n"
PGREP_LINE = (f"48211 /usr/local/bin/node /opt/claude/cli.js --output-format stream-json "
              f"CLAUDE_CODE_MESSAGING_TOKEN={FAKE_SESSION_TOKEN} CLAUDE_CODE_ENTRYPOINT=cli\n")


def test_the_deepseek_line_loses_its_value_and_keeps_its_name_and_length():
    assert len(FAKE_DEEPSEEK) == DEEPSEEK_CHARS
    text, names = credentials.redact(ENV_OUTPUT)
    assert text == "PI_CODING_AGENT=true\nDEEPSEEK_API_KEY=[redacted: 35 characters]\nPWD=/work/run/workspace\n"
    assert names == ["DEEPSEEK_API_KEY"]


@pytest.mark.parametrize("after", ["…[truncated 7 chars]", ""])
def test_a_value_cut_short_by_a_truncation_marker_or_the_end_of_the_text_is_redacted_too(after):
    shown = FAKE_DEEPSEEK[:SHOWN_BEFORE_THE_CUT]
    text, names = credentials.redact(f"DEEPSEEK_API_KEY={shown}{after}")
    assert text == f"DEEPSEEK_API_KEY=[redacted: {SHOWN_BEFORE_THE_CUT} characters]{after}" and names == ["DEEPSEEK_API_KEY"]


def test_the_session_token_in_a_process_listing_is_redacted():
    text, names = credentials.redact(PGREP_LINE)
    assert FAKE_SESSION_TOKEN not in text and names == ["CLAUDE_CODE_MESSAGING_TOKEN"]
    assert "CLAUDE_CODE_MESSAGING_TOKEN=[redacted: 32 characters] CLAUDE_CODE_ENTRYPOINT=cli\n" in text


@pytest.mark.parametrize("name", ["OPENAI_API_KEY", "MY_APIKEY", "GITHUB_TOKEN", "SESSION_SECRET", "DB_PASSWORD",
                                  "ROOT_PASSWD", "AWS_SECRET_ACCESS_KEY", "SIGNING_PRIVATE_KEY", "API_KEY", "TOKEN"])
def test_an_environment_assignment_whose_name_says_credential_is_redacted_from_8_characters_up(name):
    assert credentials.MIN_VALUE_CHARS == 8
    for quote in ("", '"', "'"):
        text, names = credentials.redact(f"export {name}={quote}{ALNUM[:8]}{quote}\n")
        assert text == f"export {name}={quote}[redacted: 8 characters]{quote}\n" and names == [name], quote
    short = f"{name}={ALNUM[:7]}\n"
    assert credentials.redact(short) == (short, [])
    assert any(k in name for k in credentials.ENV_NAME_KEYWORDS)


def test_every_keyword_of_an_environment_name_is_tried():
    assert credentials.ENV_NAME_KEYWORDS == ("API_KEY", "APIKEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD",
                                             "ACCESS_KEY", "PRIVATE_KEY")
    for k in credentials.ENV_NAME_KEYWORDS:
        assert credentials.redact(f"X_{k}_Y={ALNUM[:12]}")[1] == [f"X_{k}_Y"]


@pytest.mark.parametrize("prefix", ["sk-", "sk-ant-", "sk-or-", "sk-proj-"])
def test_an_sk_key_is_redacted_wherever_it_stands(prefix):
    key = prefix + ALNUM
    text, names = credentials.redact(f'curl -H "x-api-key: {key}" https://api.example.invalid\n')
    assert text == f'curl -H "x-api-key: [redacted {credentials.SK_KEY}: {len(key)} characters]" https://api.example.invalid\n'
    assert names == [credentials.SK_KEY]


@pytest.mark.parametrize("prefix", ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"])
def test_a_github_token_is_redacted(prefix):
    token = prefix + ALNUM + "0123"
    text, names = credentials.redact(f"remote: https://x-access-token:{token}@github.example.invalid/o/r.git")
    assert token not in text and names == [credentials.GITHUB_TOKEN]
    assert f"[redacted {credentials.GITHUB_TOKEN}: {len(token)} characters]" in text


def test_an_aws_access_key_id_is_redacted():
    key = "AK" + "IA" + "Q7ZP2M4XK9WB3TLC"
    text, names = credentials.redact(f"aws_access_key_id = {key}\n")
    assert text == f"aws_access_key_id = [redacted {credentials.AWS_KEY_ID}: 20 characters]\n" and names == [credentials.AWS_KEY_ID]


def test_a_bearer_token_of_24_characters_or_more_is_redacted_and_a_shorter_word_is_not():
    assert credentials.BEARER_MIN_CHARS == 24
    token = ALNUM[:24]
    text, names = credentials.redact(f"Authorization: Bearer {token}\n")
    assert text == f"Authorization: Bearer [redacted {credentials.BEARER}: 24 characters]\n" and names == [credentials.BEARER]
    for prose in ("Authorization: Bearer <token>\n", f"Authorization: Bearer {ALNUM[:23]}\n", "the Bearer authentication scheme\n",
                  "Authorization: Bearer your-token-goes-here-0000\n", "Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxx\n"):
        assert credentials.redact(prose) == (prose, [])


@pytest.mark.parametrize("prefix", ["r8_", "gsk_", "fc-", "xai-", "csk-", "pplx-", "hf_"])
def test_a_provider_s_prefixed_key_is_redacted(prefix):
    assert prefix in credentials.PROVIDER_PREFIXES
    key = prefix + ALNUM
    text, names = credentials.redact(f"using key {key} for the request")
    assert text == f"using key [redacted {credentials.PROVIDER_KEY}: {len(key)} characters] for the request"
    assert names == [credentials.PROVIDER_KEY]


PEM_BODY = "\n".join(["MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7" + ALNUM, ALNUM * 2, "Zm9vYmFy+/=="])


@pytest.mark.parametrize("kind", ["PRIVATE KEY", "RSA PRIVATE KEY", "OPENSSH PRIVATE KEY", "EC PRIVATE KEY"])
def test_a_pem_private_key_block_is_redacted_whole(kind):
    block = f"-----BEGIN {kind}-----\n{PEM_BODY}\n-----END {kind}-----"
    text, names = credentials.redact(f"cat key.pem\n{block}\ndone\n")
    assert text == f"cat key.pem\n[redacted {credentials.PEM_KEY}: {len(block)} characters]\ndone\n" and names == [credentials.PEM_KEY]


def test_a_pem_block_cut_short_is_redacted_as_far_as_it_goes():
    block = f"-----BEGIN PRIVATE KEY-----\n{PEM_BODY[:60]}"
    text, names = credentials.redact(block + "…[truncated 900 chars]")
    assert text == f"[redacted {credentials.PEM_KEY}: {len(block)} characters]…[truncated 900 chars]" and names == [credentials.PEM_KEY]


def test_the_same_forms_json_escaped_inside_an_event_s_strings_are_redacted_and_the_line_is_still_json():
    pem = f"-----BEGIN RSA PRIVATE KEY-----\n{PEM_BODY}\n-----END RSA PRIVATE KEY-----"
    event = {"_rx": 1790000000.123, "type": "tool_execution_end", "toolName": "bash",
             "args": {"command": f'export OPENAI_API_KEY="{"sk-" + ALNUM}" && env | grep -i -E "PI_|WORK|CWD"'},
             "result": {"content": [{"type": "text", "text": ENV_OUTPUT + PGREP_LINE + pem + "\n"}]}}
    line = json.dumps(event)
    out, names = credentials.redact(line)
    back = json.loads(out)                                                  # still one JSON object
    assert names == ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "CLAUDE_CODE_MESSAGING_TOKEN", credentials.PEM_KEY]
    for value in (FAKE_DEEPSEEK, FAKE_SESSION_TOKEN, "sk-" + ALNUM, "MIIEvQ"):
        assert value not in out
    assert back["args"]["command"] == 'export OPENAI_API_KEY="[redacted: 35 characters]" && env | grep -i -E "PI_|WORK|CWD"'
    shown = back["result"]["content"][0]["text"]
    assert shown.startswith("PI_CODING_AGENT=true\nDEEPSEEK_API_KEY=[redacted: 35 characters]\nPWD=/work/run/workspace\n")
    assert shown.endswith(f"[redacted {credentials.PEM_KEY}: {len(json.dumps(pem)) - 2} characters]\n")   # counted as written
    assert (back["_rx"], back["type"]) == (event["_rx"], event["type"])


# What real logs are full of, and none of it a credential: each must come back exactly as it went in.
NOT_CREDENTIALS = [
    "OPENAI_API_KEY=STUBKEY-for-tests\n",
    "API_KEY=xxxxxxxxxxxxxxxx\n",
    "API_KEY=your-key-here\n",
    "ANTHROPIC_API_KEY=your_api_key_here\n",
    "SESSION_SECRET=example-secret-value\n",
    "DB_PASSWORD=test-password-123\n",
    "ADMIN_PASSWORD=changeme\n",
    "export OPENAI_API_KEY=${OPENAI_API_KEY}\n",
    "export OPENAI_API_KEY=$OPENAI_API_KEY\n",
    'headers: { Authorization: `Bearer ${token}` }\n',
    "GITHUB_TOKEN=<your-token>\n",
    "SSH_PRIVATE_KEY_FILE=/run/secrets/deploy-key-file\n",
    "MAX_OUTPUT_TOKENS=32768\n", "CONTEXT_TOKENS=131072000\n",
    '"max_tokens": 4096, "output_tokens": 123, "usage": {"input_tokens": 98765432}\n',
    "max_tokens: 4096\n", "maxTokens=1234567890\n",
    # A constant in source code the agent wrote is its app's own fixture, not an environment credential.
    "export const SECRET = 'a-test-fixture-secret-value';\n",
    "const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-secret-0001';\n",
    'const token = "abcdefgh12345678";\n', "token=abcdefgh12345678\n",
    # Hashes.
    "commit 3fe36bdd9c0a41e2b7d5f6a8c1e0d9b2a7f4c6e5\n", "STORY 4 DONE 90347162abcdef0123456789abcdef0123456789\n",
    '"integrity": "sha512-Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYg=="\n',
    # Words that only look like a prefix.
    "pip install sk-learn-contrib-utilities-package\n", "the task-force-on-something-0123456789abcdef\n",
    "rfc-9110abcdefghijklmnopqrstuvwxyz\n", "a disk-usage-report-0123456789abcdef0123\n",
    "-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIE\n-----END CERTIFICATE-----\n",
    "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----\n",
]


@pytest.mark.parametrize("text", NOT_CREDENTIALS)
def test_what_is_not_a_credential_is_left_exactly_as_it_was(text):
    assert credentials.redact(text) == (text, [])
    line = json.dumps({"type": "tool_execution_end", "result": text})
    assert credentials.redact(line) == (line, [])                           # and JSON-escaped in an event's string


def test_redacting_again_finds_nothing_more():
    once, names = credentials.redact(ENV_OUTPUT + PGREP_LINE + "token " + "gh" + "p_" + ALNUM + "0123\n")
    assert len(names) == 3 and credentials.redact(once) == (once, [])


# ---------- files ----------

def test_a_log_with_no_credential_is_left_byte_for_byte(tmp_path):
    log = tmp_path / "agent-events.compact.jsonl.gz"
    with gzip.open(log, "wt") as f:
        f.write(json.dumps({"type": "session", "id": "s"}) + "\n" + json.dumps({"type": "tool_execution_end", "result": "ok"}) + "\n")
    before, stat = log.read_bytes(), log.stat()
    assert credentials.redact_file(log) == []
    assert log.read_bytes() == before and log.stat().st_mtime_ns == stat.st_mtime_ns


def test_a_gzipped_log_with_credentials_is_rewritten_line_by_line_without_them(tmp_path):
    log = tmp_path / "agent-events.compact.jsonl.gz"
    lines = [json.dumps({"type": "session", "id": "s"}),
             json.dumps({"type": "tool_execution_end", "result": ENV_OUTPUT}),
             json.dumps({"type": "tool_execution_end", "result": PGREP_LINE})]
    with gzip.open(log, "wt") as f:
        f.write("\n".join(lines) + "\n")
    assert credentials.redact_file(log) == ["DEEPSEEK_API_KEY", "CLAUDE_CODE_MESSAGING_TOKEN"]
    with gzip.open(log, "rt") as f:
        out = f.read().splitlines()
    assert out[0] == lines[0] and len(out) == 3 and [json.loads(l)["type"] for l in out] == ["session"] + ["tool_execution_end"] * 2
    assert FAKE_DEEPSEEK not in "".join(out) and FAKE_SESSION_TOKEN not in "".join(out)
    assert "DEEPSEEK_API_KEY=[redacted: 35 characters]" in json.loads(out[1])["result"]


def test_a_text_file_is_redacted_in_place_and_a_binary_one_is_left_alone(tmp_path):
    summary = tmp_path / "interventions.md"
    summary.write_text(f"- story 3: the agent printed its environment\n  DEEPSEEK_API_KEY={FAKE_DEEPSEEK}\n")
    assert credentials.redact_file(summary) == ["DEEPSEEK_API_KEY"]
    assert summary.read_text() == "- story 3: the agent printed its environment\n  DEEPSEEK_API_KEY=[redacted: 35 characters]\n"
    image = tmp_path / "shot.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe" + f"API_KEY={ALNUM}".encode())
    before = image.read_bytes()
    assert credentials.redact_file(image) == [] and image.read_bytes() == before
    bundle = tmp_path / "workspace.bundle"
    bundle.write_bytes(b"# v2 git bundle\n\x00\x01PACK")
    assert credentials.redact_file(bundle) == []
    assert credentials.redact_file(tmp_path / "gone.md") == []              # deleted since it was staged
    not_gzip = tmp_path / "notes.gz"
    not_gzip.write_text(f"API_KEY={ALNUM}\n")                               # named .gz and not gzip: read as the text it is
    assert credentials.redact_file(not_gzip) == ["API_KEY"] and not_gzip.read_text() == "API_KEY=[redacted: 32 characters]\n"
    plain = tmp_path / "summary.md"
    plain.write_text("# Summary\n\nmax_tokens: 4096, TOKEN counts only\n")
    before, stat = plain.read_bytes(), plain.stat()
    assert credentials.redact_file(plain) == [] and plain.read_bytes() == before and plain.stat().st_mtime_ns == stat.st_mtime_ns
