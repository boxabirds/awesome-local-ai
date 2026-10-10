# anthropic-token-counter

Counts the output of one Claude Code story two ways, and sets both beside the total Claude Code reported:

1. **Anthropic's `count_tokens` endpoint**, for a named model (default `claude-opus-5-5`). The text is sent as the
   content of one user message; a one-word message is counted too, to show how much the endpoint adds around any
   message.
2. **The `Xenova/claude-tokenizer` vocabulary**, run locally with the `tokenizers` crate.

The reported total is `usage.output_tokens` of the log's `result` event, with its `thinking_tokens`. The per-message
`usage.output_tokens` in a Claude Code stream are early snapshots (3 to 16 tokens) and are not used.

```bash
mkdir -p ~/some-empty-dir && curl -sSL -o ~/some-empty-dir/tokenizer.json \
  https://huggingface.co/Xenova/claude-tokenizer/resolve/main/tokenizer.json   # untrusted data: its own folder

cargo run --release -p anthropic-token-counter -- \
  benchmarks/reference/vidi/opus-5.5/v2-r1/stories/04/agent-events.jsonl \
  --env-file .env --tokenizer-json ~/some-empty-dir/tokenizer.json
```

`--skip-api` runs the local count only and needs no key. The key is read from `ANTHROPIC_API_KEY` in the `.env` file
and is sent only to `api.anthropic.com` as a request header; it is never printed. `.env` is git-ignored.

## What "visible" means

Claude Code writes one content block per `assistant` line. The visible text is every block in log order: thinking
text, reply text, and each tool call as its name and compact JSON input. Thinking is mostly **not on disk**: the log
keeps an encrypted signature and, for most blocks, no text. So the visible text is a lower bound on what the model
wrote, and the thinking tokens come only from the `result` event.

## First run, 10 Oct 2026

Story: `benchmarks/reference/vidi/opus-5.5/v2-r1/stories/04` (one `result` event).

| Measure | Tokens | Source |
|---|---|---|
| Reported output tokens | 89,419 | Claude Code `result.usage.output_tokens` |
| of which thinking | 28,534 | the same event's `output_tokens_details.thinking_tokens` |
| Visible text, 135,308 characters, `count_tokens` for `claude-opus-5-5` | 61,874 | the API (a one-word message counts 9) |
| The same text, Xenova/claude-tokenizer | 42,011 | local |

Read with care. These are one story's figures:

- The API count of the visible text (at most 61,874, 61,865 after removing the largest possible framing) plus the
  reported thinking tokens (28,534) is 90,399 to 90,408, about 1.1% above the reported total. That agrees with the
  reported total to within what serialising tool calls as plain text could explain. The thinking figure comes from the
  same `result` event as the total, so this is a consistency check, not an independent one.
- The Xenova vocabulary counts 32% fewer tokens than the API on the same text (42,011 against 61,874). Added to the
  thinking tokens it reaches 70,545, 21% below the reported total. It is not a substitute for the model's own
  tokenizer on this content (mostly JSON tool-call inputs, 2.2 characters per token by the API's count).
- Tool calls are sent as text here. The API encodes `tool_use` blocks in its own way, so the count for them is an
  approximation.

## Tests

`cargo test -p anthropic-token-counter`: the stream reader (blocks, empty thinking, repeated tool calls, result
totals), the `.env` reader and the API response reader. The network calls are not covered by tests.
