# Router research harness (2026-09-17)

Scripts and captured traffic behind
[NadirClaw as a local/cloud hybrid router](../20260917-nadirclaw-hybrid-rouder.md) and
[NadirClaw vs vLLM Semantic Router](../20260917-nadirclaw-vs-semantic-router.md).

## Scripts

| File | What it does |
|---|---|
| `stub.py` | OpenAI/Anthropic-shaped upstream that answers instantly and records model, path, auth header and body keys of each request. Used to see which tier a router picked. |
| `capture_stub.py` | Streaming OpenAI-compatible upstream that saves full request bodies. It answers the first tool-bearing request with a `glob` tool call so the client sends a tool-result turn too. |
| `harness.py` | NadirClaw experiments E1–E4: overhead, routing matrix, parameter passthrough, session pinning. |
| `nadirclaw_route_probe.py` | Replays captured request bodies through a running NadirClaw and reports which tier each one hit. |
| `nadirclaw_probe_fresh.sh` | Runs the probe with a fresh NadirClaw per body directory, so the upgrade-only session cache can't carry a tier between clients. |
| `vsr_protocol_probe_test.go` | Go test for `vllm-project/semantic-router`'s `pkg/protocolcodec`. It decodes captured request bodies (OpenAI and Anthropic) and captured or synthetic response streams under the router's strict default policy. |

## Captured traffic

| Directory | Contents |
|---|---|
| `opencode-1.18.20-bodies/` | OpenCode requests: title generator, first agent turn (10 tools), tool-result turn |
| `clients/omp-18.2.4/` | omp native-tools and text-tools (`supportsTools: false`) runs |
| `clients/cline-cli-3.0.62/` | Cline CLI default and `--thinking high` runs |
| `clients/dsh-0.1.6-alpha.2/` | DeepSeek Harness runs A–F (both adapters, headless and Web presets, chat-completions and Anthropic Messages) |
| `llama-server-b49650a-responses/` | Real llama-server responses (streamed and non-streamed), each paired with a `.stripped` copy that has only `timings` removed |

Absolute paths in captured bodies are redacted to `/path/to/workdir`. Every capture ran with `env -i` and a throwaway `HOME`, and used the placeholder API key `local`.

## Run

```bash
# NadirClaw routing for captured bodies (needs nadirclaw 0.23.1 installed)
NADIRCLAW=/path/to/nadirclaw ./nadirclaw_probe_fresh.sh opencode-1.18.20-bodies clients/cline-cli-3.0.62

# vLLM Semantic Router protocol decoding
git clone https://github.com/vllm-project/semantic-router vsr
cp vsr_protocol_probe_test.go vsr/src/semantic-router/pkg/protocolcodec/
cd vsr/src/semantic-router/pkg/protocolcodec
PROBE_BODIES=<dir of req*.json> PROBE_RESPONSES=<dir of *.sse/*.json> \
PROBE_ANTHROPIC_BODIES=<dir of Anthropic req*.json> go test -count=1 -run TestProbe -v .
```
