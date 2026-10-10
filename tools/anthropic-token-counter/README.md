# anthropic-token-counter

Token counts for Claude text, for a harness integration whose client does not report them.

- `story` counts one Claude Code story's visible output with Anthropic's `count_tokens` endpoint and the
  Xenova/claude-tokenizer vocabulary, beside the total Claude Code reported.
- `corpus`, `calibrate`, `fit` and `estimate` build a **fitted estimate** that needs neither: a model of how a Claude
  tokenizer cuts text, calibrated against the endpoint on a varied corpus, with its error measured before it is used.

The endpoint is the reference. It is free but rate limited, and Anthropic calls its count an estimate that "might
differ by a small amount" from billing. Models from Claude 4.7 on share a tokenizer that gives about 30% more tokens
than earlier models ([docs](https://platform.claude.com/docs/build-with-claude/token-counting)), so **a fitted model is
valid only for the Claude model it was calibrated on**. Its file records the model id.

## The estimate

The text is cut into the runs a byte-pair tokenizer sees first, and the runs are counted by kind and length (25
counts, `src/features.rs`): ASCII words by length bucket, digit runs, punctuation characters and runs, indentation
runs, single spaces, newlines, camelCase humps, underscores, and non-ASCII letters and other characters. The weights
come from a non-negative least squares fit on relative error (`src/fit.rs`), so a 200-character sample and a
6,000-character one count alike. The estimate is `intercept + weights . counts`.

```bash
T=tools/anthropic-token-counter
cargo run --release -p anthropic-token-counter -- estimate --model-file $T/models/claude-opus-5-5.json notes.txt
```

### How it was calibrated and tested (10 Oct 2026, `claude-opus-5-5`)

795 texts, 15 kinds, 2.6 million characters, from the repository's tracked files (Rust, Python, TypeScript, CSS, HTML,
shell, JSON, Markdown, configuration, text) and the long strings in its tracked compact agent logs (thinking, replies,
tool-call inputs, tool results; pi, OpenCode and Claude Code). Held-out suite material is excluded by path, and the
corpus was scanned for secrets before anything was sent. Each text was counted once with the endpoint (795 calls and
one probe); the endpoint adds 8 tokens around any message, which is taken off.

Five-fold cross-validation, every source file held out in turn. Median and 90th-percentile error are per text, as a
percentage of the true count; "total off by" is the sum of estimates over the sum of true counts, which is what a long
text's total is off by.

| Method | Median error | 90th percentile | Total off by |
|---|---|---|---|
| characters / 4 | 42.1% | 50.6% | -43.1% |
| characters, fitted | 8.4% | 20.0% | -3.6% |
| Xenova vocabulary, fitted | 4.9% | 11.6% | -0.7% |
| **run counts, fitted** | **3.4%** | **10.0%** | **-0.5%** |
| run counts + Xenova, fitted | 3.5% | 8.7% | -0.6% |

`characters / 4` is wrong by 43% because this tokenizer averages about 2.3 characters per token on this material. The
run-count fit needs no vocabulary file. Per kind, its median error is 2.0% to 4.4% except shell (10.1%, total off by
-8.1%); its worst totals are shell (-8.1%) and text (-3.3%). The table above and the per-kind rows come from `fit`.

### The test it had to pass, and did not pass cleanly

Opus 5.5 `v2-r1` story 4 was kept out of the corpus. The endpoint counts its visible text (135,308 characters of
thinking text, replies and tool calls) at 61,874 tokens, 61,866 after the framing. The fitted estimate is **57,224,
7.5% low**. That is outside the cross-validated total bias (-0.5%) and inside the 90th-percentile range for a single
text (10.0%). One story is one data point. A likely cause, not tested: the story's text is tool calls serialised as
JSON, where a newline is the two characters `\n` and a quote is `\"`, while the corpus holds file contents with real
newlines. Counting a handful of JSON-serialised samples would show whether that is it.

### Limits

- **One tokenizer.** Calibrated for `claude-opus-5-5` only. Whether Sonnet 5.5 and Haiku 5.5 count the same is not
  measured; check by counting the same samples with each and comparing before reusing a fit.
- **Mostly English and code.** Non-English text is not in the corpus.
- **Visible text only.** Thinking that the client does not log is a separate number.
- **Tool calls as text.** The endpoint encodes `tool_use` blocks its own way.
- **Per text, not per token.** It gives no timing.

## Commands

```bash
cargo build --release -p anthropic-token-counter
B=tools/target/release/anthropic-token-counter

$B corpus    --out corpus.jsonl                    # 795 texts from tracked files and compact logs
$B calibrate --corpus corpus.jsonl --cache counts.jsonl --env-file .env --model claude-opus-5-5
$B fit       --corpus corpus.jsonl --cache counts.jsonl --model claude-opus-5-5 --out model.json
$B estimate  --model-file model.json notes.txt
$B story     agent-events.jsonl --env-file .env --fitted model.json   # one Claude Code story; --skip-api makes no calls
```

`calibrate` makes one `count_tokens` call per text not already in the cache, so a re-run only adds. Count the calls
before running it: the default corpus is 795. The key is read from `ANTHROPIC_API_KEY` in the `.env` file and is sent
only to `api.anthropic.com` as a request header; it is never printed. `.env` is git-ignored. `fit --tokenizer-json`
adds the vocabulary methods to the comparison (download `tokenizer.json` from `Xenova/claude-tokenizer` into a folder of
its own).

## What "visible" means for a story

Claude Code writes one content block per `assistant` line. The visible text is every block in log order: thinking
text, reply text, and each tool call as its name and compact JSON input. Thinking is mostly **not on disk**: the log
keeps an encrypted signature and, for most blocks, no text. The thinking tokens come only from the `result` event,
whose `usage.output_tokens` is the story's total. The per-message `usage.output_tokens` in the stream are early
snapshots (3 to 16 tokens) and are not used.

### First check, opus-5.5 v2-r1 story 4

| Measure | Tokens | Source |
|---|---|---|
| Reported output tokens | 89,419 | Claude Code `result.usage.output_tokens` |
| of which thinking | 28,534 | the same event's `thinking_tokens` |
| Visible text, `count_tokens` for `claude-opus-5-5` | 61,874 | the API (a one-character message counts 9) |
| The same text, Xenova/claude-tokenizer | 42,011 | local |

The API count plus the reported thinking tokens is 90,399, about 1.1% above the reported total. The thinking figure is
from the same `result` event as the total, so this is a consistency check, not an independent one.

## Tests

`cargo test -p anthropic-token-counter`: the stream reader, the `.env` reader, the API response reader, the feature
counts, the fitter, the corpus sampler and the cross-validation. The network calls are not covered by tests.
