# NadirClaw vs vLLM Semantic Router

**Date:** 2026-09-17
**Companion to:** [20260917-nadirclaw-hybrid-rouder.md](20260917-nadirclaw-hybrid-rouder.md), which has the NadirClaw findings and experiments this doc refers back to.

| | **vLLM Semantic Router (vSR)** |
|---|---|
| Repo, version examined | `vllm-project/semantic-router` @ `0266af8` (2026-09-17), CLI 0.3.0 |
| What it is | A model-selection **gateway**: Envoy plus a Go ExtProc router plus Rust/Candle classifiers. It is the direct counterpart to NadirClaw. |
| License | Apache-2.0 |

## Backends in scope

A router is judged by what it does with the servers this repo actually installs. There are two:

| Combination | Backend | Platform |
|---|---|---|
| `qwen/3.8/flash-next/macos/128GB/mtplx-opencode` | MTPLX 2.11.1 | Apple silicon, 128 GB |
| `qwen/3.8/27b/macos/64GB/mtplx-opencode` | MTPLX 2.11.1 | Apple silicon, 64 GB |
| `qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode` | llama.cpp `llama-server`, built from `master` | Ubuntu 22.04, RTX 4090 24 GB |

All three are driven by OpenCode.

## Method

Claims are labelled the same way as in the NadirClaw doc:

- **MEASURED**: run on this machine.
- **CODE**: verified in source at the commits above.
- **DOCS**: stated in README or docs only.

The vSR repo was read with a source audit. The claims this doc's conclusions rest on were spot-checked by hand. The vSR request and response compatibility question was **tested** by feeding real traffic through vSR's own protocol decoder in a Go test.

**Not done:** running vSR end-to-end. On macOS it only runs as containers inside a Colima VM. That means starting a Linux VM and pulling images on this machine, which is a step for you to approve, not for me to take. So vSR latency and memory overhead are **not measured**.

---

## TL;DR

- **vSR is built the right way for a local/cloud hybrid, where NadirClaw isn't.**
  - Tool-bearing requests are not forced to cloud.
  - Every backend has its own endpoint and credentials.
  - It translates between OpenAI and Anthropic formats.
  - It can route on context length.
  - Routing is declared in YAML.
  - It is Apache-2.0.
- **But today vSR rejects the responses of *both* backends this repo installs. MEASURED.**
  - vSR rejects upstream JSON with fields it doesn't know.
  - **llama-server** (real bytes captured from `master` `b49650a`) adds a `timings` object to the final chunk of every stream, and to every non-streamed reply. vSR rejected all 6 captured streams and the non-streamed body. With only `timings` removed, all of them were accepted.
  - **MTPLX 2.11.1** adds `mtplx_stats` and `timings` to its final chunk. The shapes were copied from its source and rejected the same way.
  - The final chunk is the one carrying `finish_reason` and usage.
  - The real OpenCode 1.18.20 *requests* were accepted.
- **NadirClaw, for contrast, works end-to-end against real llama-server. MEASURED.** A tool-call turn came back with `tool_calls`, `finish_reason: tool_calls` and `[DONE]`. NadirClaw rebuilds the response, so `timings` is simply dropped. Its problems are in routing, not in speaking the protocol (see the companion doc).
- **Platform depends on which box.**
  - **Ubuntu x86-64 (the llama.cpp combination)** is vSR's maintained platform: Docker runs natively, with no VM. The model fills the 4090's 24 GB, so vSR's classifiers would run on CPU.
  - **macOS (the MTPLX combinations)** is "Not qualified". vSR runs in a Colima Linux VM with the classifiers on CPU.
  - Images are 250 MB compressed for the router and 170 MB for the dashboard, plus classifier models whose sizes aren't stated.
- **Switching agent doesn't help. MEASURED.** omp, DeepSeek Harness and Cline all send native tools on agent turns, so NadirClaw forces them to cloud just like OpenCode. vSR accepts their requests on the plain OpenAI-compatible path, but still rejects the local servers' responses. DeepSeek Harness's own default adapter fails both routers. See [Does switching coding agent change anything?](#measured-does-switching-coding-agent-change-anything)
- **Neither removes the real blocker:** there is no written routing policy and no labelled data on where the local models fail.
- **Promising direction:** route by role and at turn boundaries on deterministic signals, not per request on prompt text. Switching mid-session costs a cold prefill (at least ~43 s for 100k tokens on the 4090) plus lost cloud cache, and a single-slot llama-server can be evicted by side requests. See [Techniques worth pursuing](#techniques-worth-pursuing) and [Switching cost: context caching](#switching-cost-context-caching).

---

## Head-to-head on the NadirClaw failure list

| Issue found in NadirClaw | NadirClaw 0.23.1 | vSR @ 0266af8 |
|---|---|---|
| **Tool definitions force the cloud tier** | Yes, one tool is enough, and there's no off switch. MEASURED | **No.** Tools are only a capability requirement. Tool-use signals (`tool_heavy`, `active_tool_use`, `current_tool_loop`) are opt-in routing inputs. CODE: `llmprotocol/capabilities.go:80-95,179` |
| **Endpoint and credential scoping** | One global `NADIRCLAW_API_BASE`. Cloud calls **and the cloud API key** went to the local server. MEASURED | **Per backend:** `backend_refs[]` each have their own `endpoint`/`base_url`, `api_key_env` and auth header style, with a separate Envoy cluster per model. CODE: `config/config.yaml:12-130`, `extproc/processor_req_body_routing.go:501-537`. One exception, read from code but not tested: the client's own `Authorization` header is not stripped, so an Anthropic backend (which uses `x-api-key`) would also receive the router token. Setting `listeners[].api_keys` removes it. |
| **Format translation** | OpenAI in → LiteLLM. `/v1/messages` only ever goes to `api.anthropic.com`. CODE | OpenAI Chat, Responses and Anthropic Messages, any to any. CODE: `protocolcodec/` |
| **Request parameter passthrough** | Allow-list. `chat_template_kwargs`, `top_k` and `presence_penalty` were **dropped**. MEASURED | The body is rebuilt from a strict schema. Those parameters **are supported**. Unknown fields get a **400**. MEASURED on real OpenCode bodies (below) |
| **Upstream response strictness** | Lenient: LiteLLM parses the reply and NadirClaw re-emits it. Tool calls, `finish_reason` and `[DONE]` survived against real llama-server; non-standard fields such as `timings` are dropped. MEASURED | **Strict:** unknown fields in upstream JSON abort the stream or fail the body. **Incompatible with llama-server (MEASURED on real bytes) and with MTPLX (MEASURED on shapes taken from source).** See below |
| **Session stickiness** | Upgrade-only for 300 s. Once escalated, it stays on cloud. MEASURED | Opt-in. Needs `x-session-id`/`x-conversation-id` headers, and only applies within one matched decision. Not upgrade-only. CODE: `extproc/router_learning_protection.go:364-391`. Not checked: whether OpenCode sends those headers. |
| **Quality-gated escalation** | Advertised, but **not wired into `serve`**. CODE | **Wired in:** `algorithm.type: confidence` scores the cheap model's answer (logprob, margin, self-verify or entailment) and escalates small to large. The logprob methods force non-streaming backend calls. CODE: `extproc/req_filter_looper.go:45-65`, `looper/confidence.go:518` |
| **What the classifier reads** | Last user message plus system prompt. CODE | The **last user message with text**. Tool-result turns don't replace it, so a whole OpenCode tool loop keeps being classified on the original prompt. The context-length signal uses the whole request. CODE: `extproc/utils_neutral.go:100-129` |
| **Context-length routing** | Swaps to a larger window only when the estimate overflows. CODE | First-class `context` signal (token ranges) plus `candidate_requirements.context`. CODE and config |
| **Cross-model failover** | Fallback chain on 429, 5xx or timeout. CODE | Envoy retries and outlier detection **within** one model's replicas. I found no cross-model failover outside the confidence looper. CODE |
| **Default bind and auth** | `0.0.0.0`, no auth. MEASURED | Inference listener on `0.0.0.0:8899` with no auth unless `api_keys` is set. **Dashboard on `:8700`, all interfaces, with open admin bootstrap** unless `DASHBOARD_ADMIN_EMAIL`/`PASSWORD` are set. The first visitor on your LAN becomes admin and can edit routing. CODE: `src/vllm-sr/cli/container_start.py:567,619-625` |
| **Prompts written to disk by default** | Yes, `requests.jsonl`. MEASURED | Engine default: no (Replay is off and in-memory). The built-in MoM recipes turn on Replay to **Postgres with 7-day retention**. Jaeger tracing samples 100% by default. CODE and DOCS |
| **Claude Code support** | Anthropic models only. CODE | `/v1/messages` is accepted and can be routed to a non-Anthropic backend. Strict fields apply, and I found no Claude Code end-to-end test. CODE; untested |
| **LiteLLM** | Hard dependency. | None. CODE |
| **License** | PolyForm **Noncommercial** (0.22.0+) | Apache-2.0 |

---

## MEASURED: vSR against real OpenCode, llama-server and MTPLX traffic

**Question:** vSR rejects any field outside its schema, in both directions. Does real traffic from this repo's stacks get through?

### Inputs

- **OpenCode requests (real).** OpenCode 1.18.20 ran against a capture stub (`capture_stub.py`) and completed a real agent turn with one tool call. That produced three request bodies: the title generator, the first build turn with 10 tools, and the tool-result turn. Saved in [`opencode-1.18.20-bodies/`](20260917-nadirclaw-harness/opencode-1.18.20-bodies/), with the working directory path redacted.
- **llama-server responses (real).**
  - **Build:** llama.cpp `master` at `b49650a` (2026-09-17), built with Metal in a scratch directory. The Ubuntu installer also builds `master`.
  - **Model:** `Qwen3-0.6B-Q8_0.gguf`, a stand-in. Response *fields* come from the server, not the model.
  - **Flags:** the combination's launcher flags that shape responses: `-a qwen3.8-27b --jinja -fa on -np 1`, with thinking on.
  - **What was captured:**
    - Streamed replies to a plain prompt, with and without `stream_options.include_usage`.
    - Streamed replies to all three OpenCode bodies. The `req2` reply contained a real tool call.
    - A non-streamed reply.
  - **Controls:** each capture has a `.stripped` copy with only `timings` removed.
  - Saved in [`llama-server-b49650a-responses/`](20260917-nadirclaw-harness/llama-server-b49650a-responses/).
- **MTPLX streams (shapes from source).** I didn't start MTPLX, because loading Flash-Next takes 77 GB. The chunk shapes were copied from the MTPLX 2.11.1 source (`mtplx/server/openai.py`):

| Chunk | Emitted at |
|---|---|
| Final chunk with `usage`, `mtplx_stats`, `timings` | `:34085-34104` (also `:34196`, `:34449`) |
| `mtplx_progress` heartbeat chunk | `:32261-32275` |
| SSE comment keepalive | `:18416-18432` |
| `reasoning_content` deltas | `:32494` |
| `prompt_tokens_details` / `completion_tokens_details` | `:25028-25053` |

- **Decoder.** Everything went through vSR's own `OpenAIChatCodec` and `Engine.TranslateResponse` with `llmprotocol.DefaultPolicy()`, the policy the ExtProc uses (CODE: `extproc/processor_protocol_contract.go:96`). Test: [`vsr_protocol_probe_test.go`](20260917-nadirclaw-harness/vsr_protocol_probe_test.go).

### Results

**Requests (OpenCode):**

```
REQUEST req1.json    accepted=true   (title generator)
REQUEST req2.json    accepted=true   (first turn, 10 tools, tool_choice, stream_options)
REQUEST req3.json    accepted=true   (tool_calls + tool_call_id turn)
REQUEST unknown-fld  accepted=false  invalid_json: request JSON contains a non-canonical field   ← control
```

**llama-server, real captured bytes:**

```
CAPTURED-STREAM  out_plain.sse                      accepted=false  invalid_upstream_json: ... non-canonical field
CAPTURED-STREAM  out_plain.stripped.sse             accepted=true
CAPTURED-STREAM  out_plain_nousage.sse              accepted=false  invalid_upstream_json: ... non-canonical field
CAPTURED-STREAM  out_plain_nousage.stripped.sse     accepted=true
CAPTURED-STREAM  out_req1.sse                       accepted=false  invalid_upstream_json: ... non-canonical field
CAPTURED-STREAM  out_req1.stripped.sse              accepted=true
CAPTURED-STREAM  out_req2.sse   (tool call)         accepted=false  invalid_upstream_json: ... non-canonical field
CAPTURED-STREAM  out_req2.stripped.sse              accepted=true
CAPTURED-STREAM  out_req3.sse                       accepted=false  invalid_upstream_json: ... non-canonical field
CAPTURED-STREAM  out_req3.stripped.sse              accepted=true
CAPTURED-BODY    out_plain_nonstream.json           accepted=false  invalid_upstream_json: ... non-canonical field
CAPTURED-BODY    out_plain_nonstream.stripped.json  accepted=true
```

In every capture, `timings` appears on exactly one chunk, the last:
- With `include_usage` (OpenCode always sets it), that's the `choices: []` usage chunk.
- Without it, that's the `finish_reason` chunk.

Everything else llama-server sends is accepted, including `reasoning_content`, `system_fingerprint`, streamed `tool_calls` and `prompt_tokens_details`.

CODE: llama-server attaches `timings` whenever a slot has stopped (`tools/server/server-context.cpp:2081-2082`, emitted at `server-task.cpp:408,456,517`). The only related request option, `timings_per_token`, *adds* timings to every chunk. I found no option that removes them.

**MTPLX, shapes from source** (each case differs from a standard control by one feature):

```
STREAM  control(standard)      accepted=true
STREAM  +reasoning_content     accepted=true
STREAM  +sse_comment           accepted=true
STREAM  +usage_details         accepted=true
STREAM  +mtplx_progress        accepted=false  invalid_upstream_json: upstream response JSON contains a non-canonical field
STREAM  +mtplx_stats+timings   accepted=false  invalid_upstream_json: upstream response JSON contains a non-canonical field
```

### Contrast: NadirClaw against the same real llama-server (MEASURED)

`nadirclaw serve` ran with `NADIRCLAW_API_BASE` pointed at the live llama-server, and OpenCode's `req2` body (10 tools) was sent through it:

| Mode | Result |
|---|---|
| Streaming | 246 chunks, streamed `tool_calls`, `finish_reason: tool_calls`, `[DONE]`. `timings` not present: NadirClaw re-emits the reply through LiteLLM. |
| Non-streaming | `finish_reason: tool_calls`, tool calls present, keys `choices, created, id, model, object, usage, nadirclaw_metadata`. |

NadirClaw's problems are about *where* it routes (see the companion doc), not whether it can talk to these servers.

### What that means in production

**CODE, the path is confirmed:**
- Every streaming response goes through `handleSemanticStreamingResponseBody` (`extproc/processor_res_body.go:34`).
- That builds a stream from the same strict engine (`processor_res_semantic_stream.go:176-194`).
- On a decode error it sets `StreamingAborted` and replaces that body chunk with whatever frames translated successfully (`:77-145`).
- Non-streamed replies go through `TranslateResponse` with the same policy (`processor_protocol_contract.go:236`).
- The only bypass, `x-vsr-skip-processing`, skips routing entirely, so it's no workaround.

**Inferred, not observed end-to-end:**
- **Streamed (both backends):** the rejected chunk is the last one. OpenCode would receive the tokens but not the chunk carrying usage (llama-server) or `finish_reason` (MTPLX, and llama-server without `include_usage`).
- **Non-streamed:** the whole reply fails.
- **MTPLX heartbeats:** an `mtplx_progress` heartbeat (sent when more than 10 s pass with no bytes after decode starts) aborts the stream at that point.

**Ways around it, all unbuilt:**
1. **Fix it in vSR: one change covers both backends.** Pass unknown upstream fields through or drop them, configured per backend rather than globally. This is the fix worth filing upstream, because llama-server is a common local backend and this rule rejects its replies as shipped.
2. **Fix it in each server.** No switch found in llama-server or MTPLX. That means two upstream asks, and neither project owes vSR a strict mode.
3. **Add a small stripping proxy** between vSR and each backend. That's another process and another hop per box.

---

## MEASURED: does switching coding agent change anything?

**Question:** OpenCode sends native tools on every agent turn, which NadirClaw forces to cloud. Would omp, DeepSeek Harness or Cline behave differently?

**Method.**
- Each agent was installed only in a scratch directory and run with `env -i` and a throwaway `HOME`.
- Each was pointed at a capture stub on the OpenAI-compatible surface.
- Each completed a real turn: prompt, tool call, tool result.
- The captured bodies were replayed through:
  - **NadirClaw 0.23.1**, via [`nadirclaw_route_probe.py`](20260917-nadirclaw-harness/nadirclaw_route_probe.py), with a **fresh server per agent**. The session cache is upgrade-only and keyed on the system prompt plus the first user message, so reusing a server contaminates the next run.
  - **vSR's strict request decoder**, via [`vsr_protocol_probe_test.go`](20260917-nadirclaw-harness/vsr_protocol_probe_test.go).
- Bodies are in [`clients/`](20260917-nadirclaw-harness/clients/), with paths redacted.

| Agent (version) | How tools are sent to an OpenAI-compatible endpoint | NadirClaw tier per request | vSR request decode |
|---|---|---|---|
| **OpenCode** 1.18.20 | native `tools` (10) | title → local; turn 1 → **cloud**; tool-result turn → **cloud** | all accepted |
| **omp** 18.2.4, default | native `tools` (11). Source: native unless the model is marked `supportsTools: false` | turn 1 → **cloud**; tool-result → **cloud** | accepted |
| **omp**, text-tool mode (`supportsTools: false`) | no `tools` key; tools described in a 112k-char system prompt; tool results sent as *user* messages (`<observation>…`) | turn 1 → local; tool-result turn → **cloud** (classifier scored the observation text 0.67), after which the session pin keeps it cloud | accepted |
| **Cline** CLI 3.0.62 (commit `27fe60d`) | native `tools` (25), always. The XML/text tool path is gone from current source, whatever the v3.35 blog says | turn 1 → **cloud**; tool-result → **cloud** (classifier said simple; agentic override forced it) | accepted |
| **DeepSeek Harness** 0.1.6-alpha.2, pi-ai adapter (`openai-completions`), headless / Standard / Minimal | native `tools`: 24 / 26 / **1** (`bash`) | every agent turn → **cloud**, even Minimal's single tool (scores exactly 0.35, the threshold). The title request (no tools) → **cloud** too (classifier 0.68) | all accepted |
| **DeepSeek Harness**, default `llm-deepseek` adapter, chat-completions | native `tools`, plus `thinking`, `dsh_session_log`, `dsh_plugin_packages`, `max_tokens: 256000` | **HTTP 422 on every request.** NadirClaw rejects `max_tokens` > 100,000 (`server.py:310-311`) | **rejected**. Still rejected with the `dsh_*` extensions removed; accepted only once `thinking` is also removed. The extensions can be disabled in config; `thinking` can't. |
| **DeepSeek Harness**, default adapter, Anthropic Messages (its out-of-the-box protocol) | native `tools` | not applicable: NadirClaw's `/v1/messages` only forwards to `api.anthropic.com` | **rejected** (field not isolated) |

**Findings:**
- **No agent escapes NadirClaw's cloud forcing on agent turns.**
  - Every agent's default sends native tools.
  - The only tool-less path found (omp's text mode) goes to cloud at the first tool result, because the classifier reads the tool observation, and the upgrade-only session pin keeps it there.
- **Agent choice doesn't matter much for vSR's *request* side.** Everything on the plain OpenAI-compatible path was accepted, including omp's and DeepSeek Harness's `store` / `max_completion_tokens`. DeepSeek's own adapter is the exception.
- **The *response* side is unchanged.** vSR still rejects llama-server's `timings` and MTPLX's `mtplx_stats`, whichever agent sent the request.
- **Session headers:** none of omp, Cline or DeepSeek Harness's pi-ai adapter send session-id headers to a custom OpenAI-compatible provider. vSR's session stickiness needs `x-session-id`/`x-conversation-id`, so it would be inactive for all of them without extra configuration. DeepSeek's own adapter sends `x-deepseek-harness-session-id`, which vSR doesn't read.
- **What each router classifies differs by agent.**
  - omp and DeepSeek Harness put injected context in the last user message: omp a `<system-reminder>` with the date and working directory, DeepSeek Harness a "Current runtime context…" snapshot.
  - Routers that score "the last user message" therefore classify boilerplate, not the user's request.
  - Cline and OpenCode leave the user's text last.

---

## Overheads

| | NadirClaw 0.23.1 | vSR on macOS (MTPLX boxes) | vSR on Ubuntu (llama.cpp box) |
|---|---|---|---|
| Install | 966 MB venv, 564 MB of it torch. MEASURED | Router image **250 MB** compressed (arm64), dashboard **170 MB**. MEASURED from GHCR manifests. Plus Envoy, a Colima VM, Homebrew `docker`+`colima` if missing, and classifier models (Vela family, 307M-parameter encoder, sizes not stated). DOCS | Router image **254 MB** compressed (amd64), dashboard **192 MB**. MEASURED from GHCR manifests. Plus Envoy and classifier models. No VM. A CUDA image variant exists. |
| Processes | 1 Python process | Router + Envoy + dashboard containers inside a Linux VM, plus optional Redis, Postgres, Milvus, Jaeger, Prometheus and Grafana | The same containers on native Docker |
| Memory | 372 MB idle, 733 MB after 115 requests. MEASURED | **Not measured.** The VM reserves unified memory next to a model that wires 77.3 GB (Flash-Next) or 27.9 GB (27B). | **Not measured.** Host RAM is separate from VRAM here. The 4090's 24 GB is budgeted to the model (≈17 GB of weights + MTP + projector + KV), so classifiers go on CPU unless you give up context. |
| Added latency | +7.2 ms median. MEASURED | **Not measured.** CPU classifiers inside a VM. | **Not measured.** CPU classifiers. |
| Platform status | Native on both | "Not qualified" (support matrix). DOCS | **Linux x86-64 CPU: "Maintained"** (support matrix). DOCS |
| Maturity | Single maintainer (112 of 133 commits) | Very active, multi-org (heavy AMD involvement), roughly quarterly releases | same |

---

## Reports from others (web and GitHub search, 2026-09-17)

**Question:** has anyone shared a *measured* success using either tool to let a local model carry most of a coding agent's load?

**Answer: none found.**
- Every report with numbers comes from the tools' own authors or maintainers.
- None of them is a local-model-heavy coding-agent deployment.

**Limits of the search:** the web search index is US-only, and Reddit, X and Discord were barely reachable. GitHub issues on both repos were searched with `gh`. Not finding reports doesn't prove there are none.

### NadirClaw reports

| Source | Author | Local model? | Coding agent? | Evidence |
|---|---|---|---|---|
| [Real-World Cost Savings: 3 Months with NadirClaw](https://dev.to/getnadir/real-world-cost-savings-3-months-with-nadirclaw-2aga) | NadirClaw's creator (disclosed) | **No.** Haiku, Sonnet, Opus and GPT-5.2 only | Claude Code, Cursor, scripts | $287 → $97 a month; 12,847 prompts in one month; accuracy by "spot checks" |
| [NadirClaw with Docker + Ollama](https://dev.to/getnadir/how-to-set-up-nadirclaw-with-docker-ollama-for-zero-cost-local-llm-routing-357a) | Creator (disclosed) | Claimed: llama3.1:8b, qwen3:32b | Claude Code | "147 requests in 8 hours", $24.18 → $8.44. The same 147 requests and $24.18 baseline appear in the README priced against Gemini Flash ($10.29), so this looks like one session re-priced, not a separate local deployment. No quality results. |
| [How I Cut My LLM Costs 60%](https://dev.to/getnadir/how-i-cut-my-llm-costs-60-with-a-local-router-open-source-56k0) | Creator | "Gemini Flash **or** Ollama" | "a typical coding session" | "~40% simple", no sample size |
| [Show HN](https://news.ycombinator.com/item?id=47054977) | Creator | No | No | 1 point; the only comment is the author's |

GitHub issues from other users show real use, but routing between cloud models:
- #83 is an Anthropic-only setup behind Claude Code.
- #25 switches between GLM and Codex plans. The author asked "Did you see any impact?" and got no reply.
- #32 reports "Weak/local models return malformed JSON" in tool calls. It was closed as needs-repro.

### vLLM Semantic Router reports

| Source | Author | Setup | Evidence |
|---|---|---|---|
| [Giving AgentGateway a Semantic Brain](https://vllm-sr.ai/blog/agentgateway-semantic-brain-homelab/) | Aayush Saini (Red Hat, listed in the vSR `OWNER` file), Anup Sharma (Nutanix) | qwen2.5-coder:7b on Ollama, plus gpt-4o and gemini-2.5-flash; "scheduled agent jobs", not a coding agent | "two weeks of sustained traffic": ~$24 → ~$14 a month. Misroutes ~18% → ~3% by "subjective spot-checks". Share handled locally: not given. |
| [Cursor-style auto model selection for OpenCode](https://vllm-sr.ai/blog/opencode-auto-mode/) | Same authors plus Shivji Kumar Jha (Nutanix) | OpenCode + Ollama qwen-coder + gpt-4o/Gemini | **No measured results.** A config guide with an illustrative three-prompt example. **Reports that small local models emit "broken imitation" tool calls as text, which corrupts OpenCode session history.** Their workaround disables tool calling for that agent. |
| [Red Hat Developer: Athena getting started](https://developers.redhat.com/articles/2026/03/25/getting-started-vllm-semantic-router-athena-release) | Christopher Nuland (Red Hat) | Qwen3-Coder-Next 80B 4-bit on mlx-lm, M4 Max 128 GB, plus Gemini 2.5 Pro | 21 test prompts, "86% of requests stayed local". No cost savings shown, only projected from price lists. Written against v0.2 (March); I didn't check whether the strict decoder tested here existed then. |

vSR GitHub issues:
- #3409, #3413 and #3417 (still open) and #3418 (closed) report Claude Code breaking on strict decoding, the same mechanism this doc measured.
- #3410 (open) proposes the project's first smoke test against real clients.

---

## Who these tools plausibly do work for

"Doesn't work here" is narrower than "doesn't work":

- **NadirClaw: Claude Code routing between Anthropic models (cloud to cheaper cloud).**
  - Claude Code uses `/v1/messages`, and that path doesn't apply the rule that forces tool-bearing requests to cloud (CODE: `_resolve_messages_model`). So the classifier really chooses between, say, Haiku and Opus.
  - That's what the author and the GitHub users above run.
  - That path can only forward to `api.anthropic.com`, so it can't use a local model.
  - The savings figures are the author's own and weren't verified here.
- **vSR: fleets whose backends return strictly standard OpenAI or Anthropic responses.**
  - vLLM, its home ground, and the cloud APIs. Its intended deployment is Linux or Kubernetes.
  - **Not verified:** that vLLM's responses pass the strict decoder. Only llama-server and MTPLX were tested.
  - Claude Code through vSR is currently broken (open issues above).
- **Local-model-heavy coding agents (this repo's use case): no evidence of success.** The reason is structural as well as bugs:
  - These routers classify prompt *text*, which suits chat.
  - Coding-agent traffic is mostly tool loops: tool definitions, tool results and injected context.
  - NadirClaw forces those loops to cloud. vSR keeps classifying the original prompt for the whole loop. omp and DeepSeek Harness put boilerplate in the last user message.
  - The "40–70% of prompts are simple" figures come from a different traffic shape.

**Limits of the testing here:**
- NadirClaw was tested end-to-end.
- vSR was tested only at its protocol decoder, never run as a proxy.
- vLLM, SGLang and Ollama were not tested as backends.

---

## Techniques worth pursuing

What the research supports is moving routing decisions off guesses about each prompt's text and onto things you can observe: the agent's role, turn boundaries, context size, backend health and observed failures. Labels as elsewhere: **MEASURED**, **CODE**, **DOCS**. **KNOWN** marks general practice from outside this research that wasn't verified here.

### From this research

1. **Route by role, not by prompt text.**
   - Agents already split their traffic. OpenCode's title request is a separate, tool-less request, and it was the only OpenCode request NadirClaw sent local (MEASURED). DeepSeek Harness sends a separate title request too (MEASURED).
   - Background work is the natural local candidate: titles, summaries, compaction, exploration, subagents. Planning and architecture are the cloud candidates.
   - NadirClaw's opt-in agent-role detection (exploration → cheap model, planning → reasoning model; `routing.py:614-1037`, CODE) is the right idea, tuned for Claude Code and off by default.
2. **Decide once per user turn, then stick.**
   - Switching inside a tool loop throws away the prefix cache (see the next section).
   - vSR keeps classifying the original prompt through a whole tool loop (CODE), which for local backends is a feature: one decision per task.
3. **Prefer cheap, deterministic signals over classifiers.**
   - Context size: each combination has measured degradation bands, and MTPLX returns zero tokens past about 200k.
   - Backend health and failover.
   - Explicit user choice, such as model aliases or a keyword rule.
   - A 22M-parameter MiniLM deciding what a far larger model can handle is the weakest signal here.
4. **Escalate on observable failure, not predicted difficulty.**
   - Verifying before replying costs a full local generation: about 26 s on Flash-Next, about 11 s on the 4090 (arithmetic from this repo's benchmarks).
   - Agent loops produce free, deterministic failure signals: malformed or text-imitation tool calls (reported in vSR's OpenCode guide, DOCS), repeated failing tool calls or tests, empty replies where thinking used up `max_tokens`, and hitting the context limit.
   - Escalation must follow the switching rules below.
5. **Classify the right text.** omp and DeepSeek Harness put injected boilerplate in the last user message: a `<system-reminder>` with date and working directory, or a runtime-context snapshot (MEASURED). Strip it before classifying. NadirClaw has `NADIRCLAW_CLASSIFIER_STRIP_PATTERNS` for this (CODE, untested).
6. **Get the plumbing right.** Both routers failed here, not on intelligence:
   - Per-backend endpoint and key scoping (NadirClaw leaked keys, MEASURED).
   - Full parameter passthrough (NadirClaw dropped `chat_template_kwargs` and `top_k`, MEASURED).
   - Tolerate or strip vendor response extensions (vSR rejects `timings` and `mtplx_stats`, MEASURED).
   - Auth on by default, bound to localhost (both bind `0.0.0.0` with no auth).
7. **Evaluate by replay and shadow mode before enforcing anything.**
   - The harness already captures real bodies, replays them through a router and records the decision.
   - Shadow mode on live sessions: log what the router *would* pick, without enforcing it.
   - Pair those logs with outcome labels (did local succeed?). That's the dataset any threshold or trained router needs.

### General practice (KNOWN, not verified here; treat names as pointers to look up)

- **Shipping coding tools route by role.** Aider's architect/editor split, Cline's separate Plan and Act models, Claude Code's small fast model for background tasks, and OpenCode's `small_model` setting all work this way. This is the dominant pattern in shipped tools, far more than per-request classifiers. Confirm each tool's current config syntax.
- **Learned routers are trained on outcome data and judged on cost-versus-quality curves.** RouteLLM (LMSYS) trains routers on preference data. Hybrid LLM (Ding et al.) predicts the quality gap between a small and a large model. Neither relies on hand-labelled "simple/complex" prompts.
- **Verify-then-escalate cascades assume the cheap model is fast.** FrugalGPT and AutoMix both work this way (vSR's `automix_entailment` comes from AutoMix). With slow local models, that assumption fails.
- **Serving stacks route sessions to where their KV cache lives.** Examples are prefix-cache-aware routing in llm-d and the vLLM production stack.
- **RouterBench and RouterArena measure prompt-level routing**, not agent sessions. Their numbers don't carry over to coding-agent loops.

---

## Switching cost: context caching

Every switch throws away a cache. At long contexts that costs more than most routing decisions save.

### Where the cost comes from

1. **The target backend starts cold.** A session moving to another backend must reprocess its whole context there.
   - **4090 box:** prefill is 2,309 tok/s (MEASURED, `combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/profiles.tsv`). A 100k-token session moving onto it waits at least **~43 s** before the first token, and prefill slows as context grows (arithmetic).
   - **Mac:** Flash-Next's warm median time to first token is 2.0 s, helped by a 98.8% session-bank restore (MEASURED). The repo has no measured cold-prefill rate for it.
2. **The source backend may lose the session while it's away.**
   - **The llama.cpp combination runs a single slot:** every profile uses `-np 1` (`profiles.tsv`). Any *other* conversation on that server replaces the main session's KV cache in that slot: a title request, a subagent, a compaction call (CODE-level reasoning, not measured).
   - Current llama-server keeps an **8 GiB prompt cache in system RAM** by default (`--cache-ram`, `common/common.h:632` at `b49650a`; CODE). The combination doesn't change it. **Untested:** whether it restores this hybrid Qwen3.8 model's state after eviction.
   - MTPLX's session bank is designed for multiple sessions and held 93–100% through a real OpenCode session (MEASURED, `docs/discovery-macos-mtplx.md` §4). Whether that session included side conversations wasn't checked.
3. **Cloud caches have short lifetimes.**
   - Anthropic's prompt cache defaults to a 5-minute TTL. A cache write costs more than normal input and a read much less (KNOWN: about 1.25× and 0.1× of base input; check current pricing).
   - Flapping loses both ways: coming back to cloud after the TTL means paying for a full cache write again, and coming back locally after an eviction means a cold prefill again.

### What this means for each technique

| Technique | Cache impact | Verdict |
|---|---|---|
| Per-request routing (NadirClaw, vSR as designed) | can switch mid tool loop, invalidating caches on both sides | **worst**; avoid |
| Role split: side work on a *different* backend or slot | the main session's cache is untouched; side conversations are short and cheap to prefill | **safe** |
| Role split onto the *same* single-slot llama-server | every side request can evict the main session's KV | **harmful** on the 4090 combination as configured; use `-np 2` (VRAM is tight) or send side work elsewhere |
| Mid-task escalation on failure, carrying full history | one cold prefill on the target plus uncached cloud input; the local cache goes stale | **acceptable only if it's one-way and rare** |
| Decide at the start of a task, while context is short | cold prefill of a small context is cheap | **best** |

### Switching rules

1. **Switch only at natural boundaries:** the start of a new task, right after compaction (context just shrank), or a subagent handoff that carries a summary instead of the full history. Never switch inside a tool loop.
2. **One-way within a task.** Once a task goes to cloud, it stays there until it ends or is compacted. That keeps the cloud cache warm and prevents flapping.
3. **Hysteresis.** Require a minimum number of turns before any switch back, and require a failure signal to repeat, not fire once.
4. **Cost the switch explicitly:** switch cost ≈ context tokens ÷ target prefill rate, plus cloud input cost for those tokens (uncached). Only switch when the expected gain is larger. Early decisions are cheap; late ones are expensive.
5. **Prefer decisions you can make upfront.** Role, explicit user choice and the task type at the start beat late failure-based escalation, which happens exactly when context is longest.
6. **Late escalation hands over a summary.** Compact first, then send the short summary to cloud, rather than replaying the full history.
7. **Give side work its own capacity:** a second slot, a small separate local model, or cloud for titles and summaries, so the main session's cache is never evicted.

### Not yet measured

1. **4090 eviction.** Does a title or subagent request evict the main session with `-np 1`, and does `--cache-ram` restore this hybrid model's state? Measure time to first token on the main session's next turn, with and without a side request in between.
2. **Cold vs warm TTFT** at 20k, 50k and 100k on both machines, so rule 4 uses measured switch costs instead of arithmetic.

---

## Verdict

1. **Neither router works as a local-first router for coding agents on llama.cpp or MTPLX today.**
   - **NadirClaw:** agent turns are forced to cloud with every agent tested, cloud keys leak to `API_BASE`, and there's no quality gate.
   - **vSR:** one strictness rule rejects llama-server's `timings` (measured on real bytes) and MTPLX's `mtplx_stats`/`timings`. That's a hard blocker, and the same fix covers both.
2. **Switching coding agent doesn't change that** (measured with omp, Cline and DeepSeek Harness).
3. **If a gateway is ever worth it, vSR is the one to evaluate, and the Ubuntu box is where to do it.**
   - It fixes NadirClaw's structural problems.
   - It routes on context length and escalates on confidence.
   - Linux x86-64 is its maintained platform.
   - It is Apache-2.0.
   - On the Macs it means an unqualified platform, a Linux VM and CPU classifiers next to a model that already dominates unified memory.
4. **NadirClaw is only worth keeping as a fork.** It would need a per-model `api_base`, an off switch for the agentic override, and full parameter passthrough. It is noncommercial since 0.22.0; the last MIT release is 0.21.1.

**What's actually blocking this isn't the router.** Two things are missing:
- **A written policy for when the local model is the wrong choice**, per box, because the boxes differ. The 4090 runs the 27B at about 92 tok/s with MTP; the 128 GB Mac runs Flash-Next at a 38.8 tok/s effective median; their context and thermal limits differ.
- **Data on where that line is.**

vSR's YAML decisions would be a good *place to put* that policy later. They don't replace writing it.

### Recommendations, in order

1. **Don't put a router in front of the agents yet.**
2. **Split by role in the agent's own config, without breaking the main session's cache.**
   - Background work (titles, summaries, compaction, exploration, subagents) goes to capacity that *doesn't share a slot* with the main session: a second llama-server slot, a small separate local model, or cloud. On the 4090 combination as configured (`-np 1`), sending it to the same server can evict the main session.
   - Planning and architecture go to cloud if wanted.
   - Confirm OpenCode's current per-agent and `small_model` syntax.
3. **Write the per-combination escalation policy using the switching rules above.**
   - Local by default. Escalate on deterministic signals: context band, malformed or text-imitation tool calls, repeated tool failures, empty replies, local server health.
   - Escalation happens only at turn boundaries, is one-way within a task, and hands over a compacted summary when context is long.
4. **Measure switching cost:** 4090 eviction with `-np 1` and `--cache-ram`, plus cold vs warm TTFT at 20k, 50k and 100k on both machines.
5. **Label real sessions in shadow mode.** Log what a router would pick, and whether local actually succeeded. Any classifier or threshold needs this data, and it shows whether per-turn routing beyond the role split adds anything.
6. **Only if step 5 shows a real gap, use vSR on the Ubuntu box.**
   - First get unknown upstream response fields handled per backend: an upstream issue (attach the llama-server captures and `vsr_protocol_probe_test.go`) or a local patch.
   - Then run a real OpenCode session through it and measure the routing split, added TTFT, memory and the admin/auth defaults above.
7. **Untested alternative:** vSR with **vLLM** instead of llama.cpp on the 4090 might avoid the strictness problem without a patch. Unverified: that vLLM's responses pass the decoder, and whether the 27B fits in 24 GB with usable context and speculative decoding. It would also give up this repo's measured llama.cpp configuration.

## Reproduce

```bash
H=docs/research/20260917-nadirclaw-harness

# 1. capture OpenCode request bodies (isolated HOME; provider points at the stub)
python3 $H/capture_stub.py 18020 ./bodies &
#    opencode.json provider: {"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://127.0.0.1:18020/v1","apiKey":"local"},...}
env -i PATH="/opt/homebrew/bin:/usr/bin:/bin" HOME=$PWD/ochome opencode run --model stub/stub-model "list the txt files here"

# 2. capture llama-server responses (any GGUF works; fields come from the server)
llama-server -m model.gguf -a qwen3.8-27b -ngl 99 -c 16384 -fa on --jinja -np 1 --port 18030 &
curl -sN localhost:18030/v1/chat/completions -H 'content-type: application/json' \
  --data @req2-with-model-set.json > out_req2.sse
#    make a .stripped copy with only "timings" removed from each data: chunk, as a control

# 3. run requests and responses through vSR's strict decoder
git clone https://github.com/vllm-project/semantic-router vsr
cp $H/vsr_protocol_probe_test.go vsr/src/semantic-router/pkg/protocolcodec/
cd vsr/src/semantic-router/pkg/protocolcodec
PROBE_BODIES=$OLDPWD/$H/opencode-1.18.20-bodies \
PROBE_RESPONSES=$OLDPWD/$H/llama-server-b49650a-responses \
  go test -run TestProbe -v .
```

## Sources

- [vllm-project/semantic-router](https://github.com/vllm-project/semantic-router) @ `0266af8`; images `ghcr.io/vllm-project/semantic-router/{vllm-sr,dashboard}:latest` (manifest sizes read 2026-09-17); support matrix `website/docs/installation/support-matrix.md`
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) @ `b49650a` (`tools/server/`)
- [NadirRouter/NadirClaw](https://github.com/NadirRouter/NadirClaw) @ `8a9f55f` (see companion doc)
- MTPLX 2.11.1 installed source: `mtplx/server/openai.py`
- OpenCode 1.18.20; omp 18.2.4 ([can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)); Cline CLI 3.0.62 ([cline/cline](https://github.com/cline/cline) @ `27fe60d`); DeepSeek Harness 0.1.6-alpha.2 ([deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) @ `ddefc45`). Captured request bodies are in the harness folder.
- This repo: `combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/config.sh`, `lib/runtime/server-llamacpp.sh`
