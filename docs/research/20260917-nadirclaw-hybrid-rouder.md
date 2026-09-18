# NadirClaw as a local/cloud hybrid router

**Date:** 2026-09-17
**Version examined:** NadirClaw 0.23.1 (PyPI), source at commit `8a9f55f` (2026-09-14)
**Machine:** Apple M5 Max, 128 GB, macOS (the same box as the Flash-Next combination)
**See also:** [NadirClaw vs vLLM Semantic Router](20260917-nadirclaw-vs-semantic-router.md)

## Questions

1. What overhead does NadirClaw add?
2. What does it need installed? Does it only work with LiteLLM?
3. Can it be customised for a much more capable local model like Qwen3.8-Flash-Next?

## Method

Each claim below is labelled with how it was established:

- **MEASURED**: from running `nadirclaw serve` 0.23.1 against a stub upstream that records every request it receives ([`20260917-nadirclaw-harness/`](20260917-nadirclaw-harness/)). The stub answers at once, so any latency is NadirClaw's own.
- **CODE**: from reading the source at the commit above. The file and line are cited.
- **README**: what the project says. It is not verified unless marked otherwise.

### Backends covered

This repo installs two local servers: **MTPLX** (the two macOS combinations) and **llama.cpp `llama-server`** (`qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode`, RTX 4090). Both are OpenAI-compatible, and NadirClaw reaches both the same way: `openai/<alias>` through LiteLLM with `NADIRCLAW_API_BASE`. So:

- **E1–E5 use a stub upstream and are server-agnostic.** The overhead, the tool override, the dropped parameters, session pinning and the `API_BASE` key leak apply identically to MTPLX and llama-server.
- **E6 ran NadirClaw end-to-end against a real llama-server** (llama.cpp `master` `b49650a`, built locally with Metal, small Qwen3 GGUF stand-in, the combination's response-shaping flags). It confirms NadirClaw handles that server's replies, including streamed tool calls.
- **MTPLX itself was not run behind NadirClaw.** Loading Flash-Next takes 77 GB.

Every experiment ran with `env -i` and a throwaway `HOME`. See [Operational gotchas](#operational-gotchas) for why that matters.

---

## TL;DR

- **Latency overhead is small. Memory and install overhead are not.** About **7 ms** is added per request, the first request costs about **1.9 s**, and the process uses **372 MB idle, rising to 733 MB** after 115 requests. The install is **966 MB**, 564 MB of it PyTorch. Measured.
- **LiteLLM is a hard dependency, but not the only dispatch path.** Gemini goes through Google's SDK, Anthropic OAuth tokens go through direct HTTP, and Claude Code's `/v1/messages` traffic only ever goes to `api.anthropic.com`. Every other model, including any OpenAI-compatible local server like MTPLX, goes through the LiteLLM *library*. You don't need a LiteLLM proxy server.
- **Out of the box, it can't route agentic coding traffic to a local model.** Any request with even **one tool definition** is forced to the complex (cloud) tier. OpenCode sends tools on every request, so the classifier never gets a say. Measured.
- **Switching coding agent doesn't change that.** omp, Cline and DeepSeek Harness were captured and replayed too, and every agent turn went to cloud. DeepSeek Harness's default adapter gets an HTTP 422 because it sends `max_tokens` over NadirClaw's 100,000 cap. Measured; see the [comparison doc](20260917-nadirclaw-vs-semantic-router.md#measured-does-switching-coding-agent-change-anything).
- **Where it plausibly does work: Claude Code routing between Anthropic models.** Claude Code's `/v1/messages` path doesn't apply the tool override, so the classifier really chooses between Haiku, Sonnet and Opus. That's what the author and outside GitHub users run. It can't reach a local model. The savings figures are the author's and weren't verified here.
- **Mixing a local OpenAI-compatible server with a cloud tier sends your cloud traffic, and your cloud API key, to the local server.** `NADIRCLAW_API_BASE` is applied to *every* LiteLLM call, not just the local model's. The README documents this exact setup as working. Measured with an Anthropic API key.
- **The "Route → Verify → Escalate" pipeline on the front page isn't wired into `nadirclaw serve`.** `cascade.py`, the verifiers, the N-tier YAML profiles and the `wide_deep` classifier exist as library code, but nothing in the server imports them. Code.
- **The license is PolyForm Noncommercial since 0.22.0.** Commercial use needs a paid license. The last MIT release is **0.21.1**.
- **It does talk to a real llama-server correctly.** Streamed and non-streamed tool-call turns came back intact (E6, measured). The problems are in routing, not in the protocol.
- **Can it accommodate Flash-Next (or the 27B on the 4090)?** Only with source patches. And even then it answers the wrong question for this hardware (see [Verdict](#verdict)).

---

## What `nadirclaw serve` actually does

```
client ──► :8856 ─┬─ /v1/chat/completions (OpenAI shape)
                  │     1. classify the LAST user message (+ system prompt)
                  │        MiniLM-L6 embedding vs two centroids → simple | complex
                  │     2. modifiers: agentic override, reasoning keywords,
                  │        vision swap, context-window swap
                  │     3. session cache: upgrade-only, 300 s TTL
                  │     4. dispatch: gemini-* → google-genai SDK
                  │                  anthropic + sk-ant-oat* → httpx to api.anthropic.com
                  │                  everything else → litellm.acompletion
                  │     5. on 429 / 5xx / timeout → fallback chain
                  │
                  └─ /v1/messages (Anthropic shape, used by Claude Code)
                        classify → rewrite `model` → POST api.anthropic.com
                        (no agentic/reasoning modifiers on this path)
```

### README versus shipped runtime

| README claim | What the server does | Basis |
|---|---|---|
| "Verify — the cheap answer is scored… Escalate — if below τ = 0.80, steps up" | Not in the request path. `Cascade`/`NTierCascade` are only referenced from `cascade.py` itself, tests, and a YAML comment. The only runtime "cascade" is the error fallback chain (429/5xx/timeout), which never judges answer quality. | CODE: `grep` for imports of `cascade`, `heuristic_verifier`, `trained_verifier`, `tier_config` across `nadirclaw/` finds none outside those modules |
| N-tier YAML profiles, `NADIRCLAW_TIERS_PROFILE`, hot-reload | Read by `tier_config/loader.py`, but that loader is only reachable from `cascade.py`. It has no effect on `serve`. | CODE |
| Bundled `wide_deep_asym_v3` classifier | Not selectable. `NADIRCLAW_COMPLEXITY_ANALYZER` only accepts `binary`, `distilbert` and `morph`. | CODE: `classifier.py:334-400`, `settings.py:167-181` |
| Session persistence "with a 30-minute TTL" | TTL is **300 s**. | CODE: `routing.py:900` |
| "Runs locally", "auth disabled (local-only)" | Binds **0.0.0.0** with auth off, so it is reachable on the LAN. | MEASURED: `lsof` shows `*:8856`. A completion request to the machine's LAN address succeeded (tested from the same host through the LAN interface, not from a second machine). CODE: `cli.py:98` |

The published benchmarks (AUROC 0.961, 98.3% quality preserved) are for the Nadir Pro classifier plus the trained DeBERTa verifier. The README says so itself. They don't describe what the OSS server does.

---

## Q1. Overheads

### Measured

| Overhead | Value | Notes |
|---|---:|---|
| Install size (venv, Python 3.12) | **966 MB** | torch 564 MB, scipy 81 MB, litellm 90 MB, transformers 59 MB, sklearn 33 MB. About 91 packages. `sentence-transformers` pulls in the whole PyTorch stack. |
| Embedding model download (first start) | **87 MB** | `all-MiniLM-L6-v2` into the HF cache. The default `binary` classifier needs network on first start. |
| Start → `/health` OK | **1.85 s** warm cache / 2.55 s first start | The encoder loads at startup. |
| RSS idle after startup | **372 MB** | |
| RSS after 115 requests | **733 MB** | Nearly doubled. I didn't run long enough to tell whether it plateaus or grows. |
| First request after start | **1,872 ms** | LiteLLM is imported lazily on first dispatch. |
| Added latency per request, warm (n=100) | **+7.2 ms median** | Direct to stub: 0.36 ms median / 0.46 ms p95. Through NadirClaw: 7.55 ms / 8.62 ms. |
| Classifier, self-reported (n=115) | **4 ms median, 102 ms max** | The max is the cold first call. |

The latency overhead is noise on either box: a Flash-Next turn has a 2.0 s median TTFT.

The RAM cost depends on the box:
- **On the Macs** it matters more than it looks. Memory is unified, and the Flash-Next pack already wires 77.3 GB, so another 0.4–0.7 GB of resident Python isn't free on a machine sized around one model.
- **On the Ubuntu box** host RAM is separate from the 4090's VRAM, so it matters much less there.

### Not measured, but implied by the design

- **Quality escalation, if you wired it in, doubles wall-clock on every miss.** A verify-then-escalate cascade has to *finish* the local generation before it can judge it. Cloud cascades hide this because the cheap model is also the fast one. Locally, the cheap tier is the slow one. Arithmetic from this repo's numbers, not a NadirClaw measurement:
  - **Flash-Next on the Mac** (38.8 effective tok/s median): a 1,000-token answer takes about 26 s before escalation even starts.
  - **27B on the 4090** (~92 tok/s generation with MTP, per its `config.sh`, excluding prefill): about 11 s.
- **Escalation mid-session also costs you the local prefix cache.** MTPLX's median session-bank restore on the Flash-Next combination is 98.8%, and llama-server reuses its slot's KV prefix the same way (`cache_n` in its `timings`). Every turn that goes to the cloud is a turn that turn's prefix cache doesn't get to amortise, and the conversation that comes back to local later is longer.

### Operational gotchas

- **Your shell environment overrides `~/.nadirclaw/.env`.** On the first experiment run, the upstream stub received the real `OPENAI_API_KEY` exported by the shell profile, not the stub key in the isolated `.env`. It went to localhost only and was scrubbed, and it wasn't written to NadirClaw's own logs. The credential order is OpenClaw token → NadirClaw stored credential → environment (`README`, `credentials.py`), and `.env` doesn't override variables that are already set. On a machine with a dozen provider keys exported, the key NadirClaw uses may not be the one you configured.
- **Prompts are logged to disk by default.** `~/.nadirclaw/logs/requests.jsonl` stores `prompt` and `response_preview` for every request. MEASURED.
- **It reads another tool's credentials first.** `~/.openclaw/agents/main/agent/auth-profiles.json` comes before NadirClaw's own store (README).

---

## Q2. What it requires, and whether it's LiteLLM-only

### Hard install dependencies (`pyproject.toml`)

`fastapi`, `uvicorn`, `litellm`, `sentence-transformers` (and so torch), `numpy`, `python-dotenv`, `click`, `google-genai`, `sse-starlette`. Python ≥ 3.10.

Optional extras: `distilbert` classifier (a further 256 MB model download), `[trained]` (transformers and torch for the DeBERTa verifier, which `serve` doesn't use anyway), `[headroom]`, `[telemetry]`, `[dashboard]`.

### Required models and services

| Need | Required? | Detail |
|---|---|---|
| An embedding model | Yes | `all-MiniLM-L6-v2` by default, via sentence-transformers. It can be switched to an Ollama embedding endpoint with `NADIRCLAW_EMBEDDING_BACKEND` / `NADIRCLAW_EMBEDDING_API_BASE` (CODE: `encoder.py`). You still install torch either way, because it's a hard dependency. |
| A cloud provider | No | A fully local setup is supported (e.g. two Ollama models). |
| LiteLLM *proxy server* | No | NadirClaw imports LiteLLM as a library. |
| LiteLLM *library* | Yes, for anything not Gemini and not Anthropic-OAuth | See the dispatch table. |
| Ollama | No | First-class support (`ollama/` prefix, LAN auto-discovery), but optional. |
| Morph API | No | Opt-in remote classifier. |

### Dispatch paths (CODE: `server.py`)

| Target | Path | Honours `NADIRCLAW_API_BASE`? |
|---|---|---|
| `gemini-*` | `google-genai` SDK, native | No |
| Anthropic with an OAuth / setup token (`sk-ant-oat*`) | direct `httpx` to `api.anthropic.com` (`server.py:1033-1141`) | No |
| `ollama/*` | LiteLLM, `api_base = OLLAMA_API_BASE` | No, uses its own base |
| **Everything else**: OpenAI, Anthropic API keys, DeepSeek, OpenRouter, `openai/<local>` | LiteLLM `acompletion` | **Yes, all of them** (`server.py:1144-1148`, streaming `1982-1985`) |
| `/v1/messages` (Claude Code) | Always `https://api.anthropic.com/v1/messages` (`server.py:2379`) | N/A: it can't target any non-Anthropic model |

**So is it LiteLLM-only?** No, but for this repo's purposes it effectively is. MTPLX, llama.cpp and vLLM all expose OpenAI-compatible APIs rather than Ollama's, so the only way NadirClaw can reach them is `openai/<name>` through LiteLLM with `NADIRCLAW_API_BASE`. That's the global setting behind the leak described below.

---

## Q3. Can it be customised for Qwen3.8-Flash-Next?

### The config-only wiring

```bash
# ~/.nadirclaw/.env
NADIRCLAW_SIMPLE_MODEL=openai/mtplx-flash-next-optimized-speed
NADIRCLAW_API_BASE=http://127.0.0.1:8010/v1        # MTPLX
NADIRCLAW_COMPLEX_MODEL=gemini-2.5-pro             # must be a path that ignores API_BASE
```

For the Ubuntu llama.cpp combination, the only differences are the alias and port (from `config.sh` and `lib/runtime/server-llamacpp.sh`):

```bash
NADIRCLAW_SIMPLE_MODEL=openai/qwen3.8-27b
NADIRCLAW_API_BASE=http://127.0.0.1:8080/v1        # llama-server
```

```json
// ~/.nadirclaw/models.local.json — otherwise context-window checks and cost are unknown
{ "models": { "openai/mtplx-flash-next-optimized-speed":
  { "context_window": 131072, "cost_per_m_input": 0, "cost_per_m_output": 0, "has_vision": false } } }
```

That runs. Here is what happens once real traffic goes through it.

### E2: routing decisions (MEASURED)

Simple tier `openai/local-flash`, complex tier `openai/cloud-big`, both on the stub. Each case uses a unique session.

| Request | Went to | Why |
|---|---|---|
| "What is 2+2?", no tools | local | classifier: simple |
| "Design a distributed rate limiter…", no tools | cloud | classifier: complex |
| "What is 2+2?" **+ 1 tool** | **cloud** | agentic override (a single tool scores 0.35, which meets the 0.35 threshold) |
| "What is 2+2?" + 6 tools | cloud | agentic override |
| OpenCode-shaped: agent system prompt + 6 tools + "rename variable x to y in utils.py" | **cloud** | agentic override |
| Agent system prompt, no tools, "rename variable x to y" | local | without tools, the system-prompt signals (at most 0.10 for length + 0.20 for keywords) can't reach 0.35 |

CODE: `routing.py:279-336` scores the signals, and `routing.py:1094` forces complex. **There is no setting to turn this off** (checked every property in `settings.py`).

In practice, for OpenCode, Codex, Cursor agent mode or any tool-using client, the router sends **everything** to the cloud. With Flash-Next as the local tier, the local model would handle roughly none of your coding traffic.

### E3: parameter passthrough (MEASURED)

| Sent | Reached upstream |
|---|---|
| `reasoning_effort`, `temperature`, `top_p` | yes |
| `chat_template_kwargs`, `top_k`, `presence_penalty` | **dropped** |

For both backends this is survivable, because every combination sets the sampler and reasoning effort server-side. MTPLX uses `--default-*` flags. llama-server uses `SAMPLING_*` and `--reasoning-effort` (`lib/runtime/server-llamacpp.sh`). It does rule out per-request `chat_template_kwargs` thinking toggles on either server. CODE: only a fixed allow-list of keys is forwarded (`server.py:1010-1030`).

### E4: session pinning (MEASURED)

| Turn | Went to |
|---|---|
| 1: hard prompt | cloud |
| 2: "thanks, what is 2+2?" in the same conversation | **cloud** |

The session cache is upgrade-only (`routing.py:821`). Once a conversation escalates, it stays on the cloud for the rest of the 300 s TTL, refreshed on each hit. That's sensible for coherence, but it means escalation never flows back to local while a session is active.

### E5: `NADIRCLAW_API_BASE` sends cloud calls and keys to the local server (MEASURED)

Setup: simple tier `openai/local-flash`, complex tier `claude-sonnet-4-5-20250929` with `ANTHROPIC_API_KEY=sk-ant-api03-STUBKEY`, and `NADIRCLAW_API_BASE` pointed at the stub. This mirrors the README's "Local model for simple, cloud for complex" example.

A complex prompt was routed to Claude, and the stub recorded:

```json
{"path": "/v1/v1/messages", "model": "claude-sonnet-4-5-20250929", "x_api_key": "sk-ant-api03-STUBKEY"}
```

The "cloud" request never left the machine, and the Anthropic key went to whatever is listening on the local port. NadirClaw returned the stub's reply as if Claude had answered. Against a real MTPLX or llama-server this would fail rather than silently succeed. The key would still be sent, though. Cloud tiers that avoid this are Gemini (native SDK) and Anthropic OAuth tokens, both CODE-verified but not run.

### E6: end-to-end against a real llama-server (MEASURED)

**Setup:**
- llama.cpp `master` `b49650a` (2026-09-17), built with Metal in a scratch directory. The Ubuntu installer also builds `master`.
- `Qwen3-0.6B-Q8_0.gguf` as a stand-in model, served with `-a qwen3.8-27b -ngl 99 -fa on --jinja -np 1`.
- NadirClaw with both tiers set to `openai/qwen3.8-27b` and `NADIRCLAW_API_BASE` pointed at it.
- OpenCode's captured `req2` body (10 tools) sent through NadirClaw.

| Mode | Result |
|---|---|
| Streaming | 246 chunks, streamed `tool_calls`, `finish_reason: tool_calls`, `data: [DONE]` |
| Non-streaming | `finish_reason: tool_calls`, tool calls present |

llama-server's non-standard `timings` object was not passed on. NadirClaw re-emits replies through LiteLLM. That leniency is why NadirClaw works with llama-server where vLLM Semantic Router's strict decoder doesn't (see the [comparison doc](20260917-nadirclaw-vs-semantic-router.md)).

The request bodies and captured llama-server replies are in [`20260917-nadirclaw-harness/`](20260917-nadirclaw-harness/).

### Claude Code can't use a local model through NadirClaw

`/v1/messages` rewrites `model` and forwards to `api.anthropic.com`, always (CODE: `server.py:2828-2893`). It can move Claude Code between Anthropic models, not to either local server.

### The patches needed for a usable local-first setup

These are ordered by how much they block, and each is concrete enough to hand to an implementer:

1. **Per-model `api_base`.** Read it from `models.local.json` and use it in `_call_litellm` / `_stream_litellm`, instead of the global `NADIRCLAW_API_BASE`. This fixes E5 and is a precondition for any hybrid setup with an OpenAI-compatible local server.
2. **A switch for the agentic override.** Or better, replace it: for a strong local model, "has tools" is not evidence that a request needs the cloud.
3. **Forward `model_extra` wholesale** (minus router-only keys) rather than using an allow-list. This fixes E3.
4. **Wire `NTierCascade` into `chat_completions`** if you want quality-gated escalation. It's the largest change. It also inherits the heuristic verifier, which only catches refusals, truncation and bad JSON, not wrong code. And it costs a full local generation on every escalation (see Q1).
5. **Retrain the centroids** (`nadirclaw build-centroids`) on prompts labelled by *where the local model fails* (per box), not by what's cheap on the cloud. The shipped centroids come from about 170 seed prompts written around the cloud cheap/premium split.

Patches 1–3 are small and local to `server.py` / `routing.py`. Patch 4 is a real integration. Patch 5 needs a labelled dataset you don't have yet.

**License check before patching:** anything built on 0.22.0+ is noncommercial-only. For any commercial use, either buy the commercial license or fork **0.21.1** (MIT) and apply the patches there.

---

## Verdict

**NadirClaw answers "is this prompt too hard for the *cheap* model?" For either box in this repo (Flash-Next on the 128 GB Mac, the 27B on the 4090), that's the wrong question.**

- **The gatekeeper is far weaker than the model it gates.** A 22 M-parameter MiniLM plus two centroids is deciding whether a 512-expert MoE can handle a prompt. It is effectively checking whether the prompt sounds hard. Flash-Next's failure modes on this box are known and measured, and none of them are "sounds hard": context past about 200k returns zero tokens, thinking can eat `max_tokens`, and thermal state costs decode speed. The 4090 box has its own measured limits: which KV cache types stay on the GPU, and a context ceiling set by 24 GB. NadirClaw can't see any of those.
- **The economics it optimises for don't apply.** Its savings maths assume the cheap tier is a cheaper cloud model. Your local tier costs nothing per token and is already paid for. The real trade-off is wall-clock and quality against cloud spend, and no part of NadirClaw measures wall-clock or quality.
- **In agentic clients the classifier is bypassed anyway**, and every request is sent to the cloud (E2). Without patches, putting NadirClaw in front of OpenCode just moves your coding traffic off the local model, on either box.

**Be honest about why this is appealing.** "An intelligent router decides for me" feels like progress, but you'd be taking on 966 MB of dependencies, a noncommercial license, a credential-leak footgun and a server-side fork, all to avoid writing down a routing policy you could state in three lines. You already have the data a real policy needs: `docs/20260904-effective-tokens-per-second.md`, the thermal breakdown, and the context-band A/B.

### What I'd do instead, in priority order

The comparison doc has the fuller version: [techniques worth pursuing](20260917-nadirclaw-vs-semantic-router.md#techniques-worth-pursuing), [switching cost and context caching](20260917-nadirclaw-vs-semantic-router.md#switching-cost-context-caching), and updated recommendations.

1. **Write the policy explicitly, using signals you've already measured.** Local by default. Cloud when estimated context goes past the band where Flash-Next degrades, when the task is architecture or planning, or when the local server is unhealthy. OpenCode's per-agent `model` setting can already carry the task split (for example, a `plan` agent on a cloud model and the default build agent on the local server). That covers most of what NadirClaw would do, with no new process. Keep side work off the main session's slot, and switch only at turn boundaries: a single-slot llama-server can be evicted by side requests, and a cold 100k-token prefill costs at least ~43 s on the 4090. Confirm OpenCode's current per-agent config syntax before relying on it. I didn't re-verify it for this doc.
2. **For availability failover (local down → cloud), use a plain proxy with per-model `api_base` and fallbacks**, such as the LiteLLM proxy server. It handles this correctly without a classifier.
3. **Only if (1) leaves real money on the table, collect the dataset:** log a few hundred real OpenCode turns with local-vs-cloud outcome judgements. A router trained on *your* failure boundary could then be worth building. That might be NadirClaw 0.21.1 with patches 1–3 and 5, but the dataset has to exist first. Without it, any router is guessing.

---

## Reproduce

```bash
# 1. install (clean venv)
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "nadirclaw==0.23.1"

# 2. stub upstream that records what it receives
.venv/bin/python docs/research/20260917-nadirclaw-harness/stub.py 18010 stub.jsonl &

# 3. serve with an ISOLATED environment (shell-exported keys otherwise win)
mkdir -p nchome/.nadirclaw && cat > nchome/.nadirclaw/.env <<'EOF'
NADIRCLAW_SIMPLE_MODEL=openai/local-flash
NADIRCLAW_COMPLEX_MODEL=openai/cloud-big
NADIRCLAW_API_BASE=http://127.0.0.1:18010/v1
OPENAI_API_KEY=sk-stub-openai
EOF
env -i PATH=/usr/bin:/bin HOME=$PWD/nchome .venv/bin/nadirclaw serve --port 18856 </dev/null &

# 4. E1–E4
.venv/bin/python docs/research/20260917-nadirclaw-harness/harness.py \
  http://127.0.0.1:18856 http://127.0.0.1:18010 stub.jsonl
```

E5: same as above, but with `NADIRCLAW_COMPLEX_MODEL=claude-sonnet-4-5-20250929` and a **fake** `ANTHROPIC_API_KEY`. Send a complex prompt and inspect the last line of `stub.jsonl`.

## Sources

- Source code: [NadirRouter/NadirClaw](https://github.com/NadirRouter/NadirClaw), commit `8a9f55f`, tag `v0.23.1`
- [nadirclaw on PyPI](https://pypi.org/project/nadirclaw/)
- `CHANGELOG.md` in the repo: 0.22.0 relicense entry, 0.23.0 tty/serve fix
- This repo: `combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/config.sh` (Flash-Next measurements cited above)
- This repo: `combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/config.sh`, `lib/runtime/server-llamacpp.sh` (llama.cpp combination)
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) @ `b49650a`
