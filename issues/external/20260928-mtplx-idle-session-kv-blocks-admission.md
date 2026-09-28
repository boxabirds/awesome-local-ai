> **Draft**, not filed. The four sections below match the MTPLX bug report form's fields, in order, with the same names.

**Title:** Near the memory limit, the admission shed can't evict an idle coding session's live KV, so a new request can be refused (507) on every retry

## Output of mtplx doctor --json

Captured on 28 Sep 2026 on the same machine and MTPLX version (2.12.0), with no MTPLX server running. The incident itself was on 24 Sep. Home-directory paths are shortened to `~`. `default_model` shows the 27B pack, doctor's default; the incident used the Flash-Next pack named in the command below.

<details>
<summary>mtplx doctor --json (335 lines)</summary>

```json
{
  "compiled_verify": {
    "above_fence_behavior": "eager verify per call",
    "default_model": "~/.mtplx/models/Youssofal--Qwen3.8-27B-MTPLX-Optimized-Speed",
    "fenced": true,
    "max_context_source": "turbo profile",
    "max_context_tokens": 32768,
    "mode": "on",
    "mode_source": "turbo profile",
    "resolved_default_profile": "turbo"
  },
  "diagnostics": {
    "checks": [
      {
        "command": null,
        "docs_url": "https://ml-explore.github.io/mlx/build/html/install.html",
        "expected": "macOS >= 14.0 on Apple Silicon",
        "fix": "Upgrade to macOS 14+; MLX does not support older macOS.",
        "id": "os.macos_version",
        "observed": "26.4",
        "severity": "error",
        "status": "pass"
      },
      {
        "command": "python3 -c \"import platform; print(platform.machine(), platform.processor())\"",
        "docs_url": "https://ml-explore.github.io/mlx/build/html/install.html",
        "expected": "native arm64 Python, not Rosetta",
        "fix": "Install/use a native arm64 Python. If needed, reinstall via Homebrew arm64 or uv.",
        "id": "python.native_arm64",
        "observed": {
          "machine": "arm64",
          "processor": "arm"
        },
        "severity": "error",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": "https://ml-explore.github.io/mlx/build/html/install.html",
        "expected": "Python >= 3.11",
        "fix": "Install Python 3.11 or newer.",
        "id": "python.version",
        "observed": "3.13.7",
        "severity": "error",
        "status": "pass"
      },
      {
        "command": "python3 -m pip install --force-reinstall mlx 'mtplx[server]'",
        "docs_url": "https://ml-explore.github.io/mlx/build/html/install.html",
        "expected": "mlx importable",
        "fix": "MLX is broken or mismatched in this environment. App installs: quit and relaunch the MTPLX app \u2014 it verifies and repairs its own runtime. CLI installs: force-reinstall with the command below.",
        "id": "mlx.import",
        "observed": {
          "default_device": "Device(gpu, 0)",
          "get_active_memory": 0,
          "get_peak_memory": 0,
          "gpu_architecture": "applegpu_g17s",
          "mlx": "0.32.2",
          "mlx_lm": "0.31.3"
        },
        "severity": "error",
        "status": "pass"
      },
      {
        "command": "which -a mtplx",
        "docs_url": null,
        "expected": "the `mtplx` on PATH runs the same MTPLX this doctor imported",
        "fix": "Two MTPLX runtimes are installed (an installer launcher in ~/.local/bin, a Homebrew venv, the app runtime, a source checkout) and the first on PATH is not this one. `which -a mtplx` lists them; run the one you mean, or move the other off PATH.",
        "id": "runtime.identity",
        "observed": {
          "gpu_architecture": "applegpu_g17s",
          "launcher_matches_this_python": false,
          "mtplx_on_path": "~/.local/bin/mtplx",
          "mtplx_path": "~/.local/share/uv/tools/mtplx/lib/python3.13/site-packages/mtplx",
          "mtplx_version": "2.12.0",
          "nax_route_available": true,
          "python_executable": "~/.local/share/uv/tools/mtplx/bin/python3"
        },
        "severity": "warning",
        "status": "warn"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "the model this Mac's default routes to fits: measured peak <= unified memory (comfortable at 1.5x)",
        "fix": null,
        "id": "resource.memory",
        "observed": {
          "default_model": "Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
          "estimated_peak_gib": 25.0,
          "unified_memory_gib": 128.0
        },
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "free space for model + temp download + safety headroom",
        "fix": "Free disk space or set MTPLX_MODEL_DIR to a larger volume.",
        "id": "resource.model_cache_disk",
        "observed": {
          "cache_dir": "~/.mtplx/models",
          "free_gib": 379.95,
          "required_gib": 49.63
        },
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": "mtplx pull Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
        "docs_url": "https://huggingface.co/Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
        "expected": "default model available in the HF cache or as the verified local startup model",
        "fix": "No action needed.",
        "id": "model.cache",
        "observed": {
          "hf_cache_exists": true,
          "hf_cache_path": "~/.mtplx/models/Youssofal--Qwen3.8-27B-MTPLX-Optimized-Speed",
          "hf_cache_validation": {
            "contract_arch_id": "qwen3-next-mtp",
            "contract_error": null,
            "contract_present": true,
            "missing_files": [],
            "mtp_sidecar_candidates": [
              "mtp.safetensors",
              "mtp/weights.safetensors",
              "model-mtp.safetensors"
            ],
            "ok": true,
            "required_files": [
              "config.json",
              "tokenizer.json",
              "model.safetensors.index.json",
              "mtplx_runtime.json",
              "mtp.safetensors"
            ]
          },
          "startup_default_model": null
        },
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": "mtplx pull Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
        "docs_url": "https://huggingface.co/Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
        "expected": "a published Youssofal/... repo (not a local mtplx/ or models/ path)",
        "fix": "Pull the default model, or pass --model to serve a different one.",
        "id": "model.default_repo",
        "observed": "Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
        "severity": "error",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": "https://docs.docker.com/desktop/setup/install/mac-install/",
        "expected": "Docker Desktop installed for Open WebUI Docker path",
        "fix": "Install Docker Desktop if you want the Open WebUI Docker integration.",
        "id": "docker.binary",
        "observed": "/opt/homebrew/bin/docker",
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "port free before starting mtplx serve, or already a healthy MTPLX server",
        "fix": "A healthy MTPLX server already on this port is fine to keep using; if something else holds it, stop that process or use --port 8001.",
        "id": "port.mtplx_server",
        "observed": {
          "host": "127.0.0.1",
          "open": false,
          "port": 8000
        },
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "port free before starting Open WebUI, or already an Open WebUI container",
        "fix": "Use a different Open WebUI host port or stop the process on 3000.",
        "id": "port.openwebui",
        "observed": {
          "host": "127.0.0.1",
          "open": false,
          "port": 3000
        },
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "ThermalForge or TG Pro available for explicit --max only",
        "fix": "Install ThermalForge only if you want opt-in fan boost.",
        "id": "thermal.control",
        "observed": "none",
        "severity": "warning",
        "status": "warn"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "Low Power Mode off for best sustained decode",
        "fix": "Turn off Low Power Mode before benchmarking or serving long responses.",
        "id": "power.low_power_mode",
        "observed": {
          "available": true,
          "lowpowermode": null,
          "powermode": "0",
          "thermal": "Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded\nNote: No CPU power status has been recorded",
          "thermal_ok": true
        },
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "no recorded thermal or performance warning",
        "fix": "Let the Mac cool down or improve airflow before sustained benchmarks.",
        "id": "power.thermal_pressure",
        "observed": "Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded\nNote: No CPU power status has been recorded",
        "severity": "warning",
        "status": "pass"
      },
      {
        "command": null,
        "docs_url": null,
        "expected": "no recent failed start recorded by the app",
        "fix": null,
        "id": "app.last_failed_start",
        "observed": null,
        "severity": "warning",
        "status": "pass"
      }
    ],
    "created_at": "2026-09-28T18:12:12+0100",
    "host": {
      "cache_dir": "~/.mtplx/models",
      "chip": "Apple M5 Max",
      "disk_free_bytes": 407965798400,
      "disk_free_gib": 379.95,
      "mac_model": "Mac17,7",
      "machine": "arm64",
      "macos_version": "26.4",
      "memory_bytes": 137438953472,
      "memory_gib": 128.0,
      "model_dirs": [
        "~/.mtplx/models"
      ],
      "platform": "macOS-26.4-arm64-arm-64bit-Mach-O",
      "processor": "arm",
      "python_executable": "~/.local/share/uv/tools/mtplx/bin/python3",
      "python_version": "3.13.7",
      "system": "Darwin"
    },
    "overall": "warn",
    "resources": {
      "default_model_size_bytes": 21313949792,
      "estimated_runtime_memory_bytes": 42788786272,
      "required_download_free_bytes": 53284874480
    },
    "schema_version": 1,
    "support_matrix": {
      "preview_test_targets": [
        "M3 Max",
        "M4 Max",
        "M3 Ultra / Mac Studio",
        "M5 Max"
      ],
      "supported": {
        "default_model": "Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed",
        "default_profile": "turbo",
        "docker": "Docker Desktop current plus previous two macOS major releases",
        "macos": ">= 14.0",
        "platform": "Apple Silicon arm64 Mac",
        "python": "native arm64 Python >= 3.11"
      }
    }
  },
  "environment": {
    "git_branch": "not a git worktree",
    "git_status": "not a git worktree",
    "hf_path": "~/.local/bin/hf",
    "mlx": {
      "default_device": "Device(gpu, 0)",
      "get_active_memory": 0,
      "get_peak_memory": 0,
      "gpu_architecture": "applegpu_g17s",
      "mlx": "0.32.2",
      "mlx_lm": "0.31.3"
    },
    "platform": "macOS-26.4-arm64-arm-64bit-Mach-O",
    "project_root": "~",
    "python_executable": "~/.local/share/uv/tools/mtplx/bin/python3",
    "python_version": "3.13.7 (main, Aug 14 2025, 11:12:11) [Clang 17.0.0 (clang-1700.0.13.3)]",
    "uv_path": "~/.local/bin/uv"
  },
  "huggingface": {
    "cache_dir": "~/.mtplx/models",
    "cache_exists": true,
    "cache_writable": true,
    "cached_models": 3,
    "disk_free_bytes": 407965810688,
    "disk_free_gb": 407.966,
    "model_roots": [
      "~/.mtplx/models"
    ],
    "token_policy": "mtplx pull sends the HF_TOKEN / HUGGING_FACE_HUB_TOKEN token, else the `hf auth login` token, else nothing; public models never need one",
    "token_present": true,
    "token_source": "login",
    "token_used_by_pull": true
  },
  "policy": {
    "benchmark_exactness_smoke_context": 2048,
    "fanmax_counts_for_product_gate": false
  },
  "thermal_control": {
    "available": false,
    "clock_anchor_enabled": false,
    "clock_anchor_policy": "explicit experimental only; never used for product claims",
    "instructions": "Run `mtplx max --install` to install ThermalForge automatically, or install TG Pro manually if you prefer. MTPLX will continue without fan control when --max is requested and no supported tool is present.",
    "selected": null,
    "tools": []
  },
  "tools": {
    "powermetrics": "/usr/bin/powermetrics",
    "python": "~/.local/share/uv/tools/mtplx/bin/python3",
    "smc_atlas": null,
    "smc_atlas_exists": false,
    "sovereign": null,
    "sovereign_exists": false,
    "sudo": "/usr/bin/sudo"
  }
}
```

</details>

## Exact command


```
python -m mtplx.server.openai --model ~/.mtplx/models/Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed \
  --backend-id native_mtp --host 127.0.0.1 --port 18010 --depth 3 --generation-mode mtp --profile turbo \
  --reasoning-mode on --preserve-thinking auto --verify-strategy batched --verify-core linear-gdn-from-conv-tape \
  --draft-lm-head-bits 4 --draft-lm-head-group-size 64 --draft-lm-head-mode affine --rate-limit 0 --stream-interval 1 \
  --scheduler-mode serial --batching-preset latency --mtp-batch-numerics throughput --warmup-tokens 16 \
  --model-id mtplx-flash-next-optimized-speed --paged-kv-quantization off --fan-mode default --retrieval-max-resident 2 \
  --no-auth --context-window 131072 --ssd-session-cache on --ssd-session-cache-max-size auto \
  --ssd-session-cache-min-prefix-tokens 512 --draft-temperature 1.0 --draft-top-p 0.95 --draft-top-k 20 \
  --draft-sampler-source default --tool-prompt-mode hybrid --chat-template-profile tokenizer --max-response-tokens 32768 \
  --temperature 1.0 --top-p 0.95 --top-k 20 --enable-thinking --reasoning-parser qwen3 --reasoning-effort low
```

The client was the pi coding agent, one conversation at a time. Its tools are bash, read, edit and write, and it compacts at the context window minus 16,384 tokens (about 114k).

## Model path or repo id


`~/.mtplx/models/Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed` (served as `mtplx-flash-next-optimized-speed`)

## Chip, RAM, macOS version


Apple M5 Max, 128 GB, macOS 26.4 (25E246). Default memory limit (`limit_bytes` = 96.0 GiB in the guard events); `iogpu.wired_limit_mb` untouched.

---

## What happened and why

The form has no description field. Put this in the issue body if it allows free text, or as the first comment after filing.


**In short:** this only happens when three things coincide: memory is already near MTPLX's limit, another session's KV is still resident and was active in the last 10 minutes, and that session is a coding-agent session (its requests carry tools). Then a new request, even a smaller one, is refused, and retrying doesn't help. We saw it deadlock 1 of 9 long agent tasks; 2 other tasks hit refusals and recovered.

### What happened

One long coding conversation grew to about 113k tokens. pi then asked the model to summarise the older history (compaction), which is a new request of about 68–74k tokens under a new session id. MTPLX refused that request 13 times in a row with HTTP 507 `memory_refusal`:

> insufficient memory: this prompt projects 96.9 GiB against the engine's 96.0 GiB limit (0.9 GiB over) after the allocator cache and the session bank were reclaimed (73663 prompt tokens, 73663 not cached).

Meanwhile the long conversation kept being admitted, because its prefix was cached, until it was left 1 output token per turn. Neither could make progress. After restarting MTPLX, the identical 73,663-token request succeeded at once (3,146 tokens out, 83.9 GiB active).

| Time | Request | Prompt tokens | Cached | Result | Active memory |
|---|---|---|---|---|---|
| 20:56:10 | conversation | 113,610 | 111,115 | ok | 95.3 GiB |
| 20:56:10 | compaction (new session) | 67,833 | none | 507 | 91.6 GiB |
| 20:56:21–20:59:24 | compaction ×12 | 70,361–73,663 | none | 507 every time | 91.6–92.1 GiB |
| 20:59:16–21:00:22 | conversation ×8 | 128,418–128,437 | ≈ all | 1 token each (`length`) | 94.9–100.2 GiB |
| 21:04:31 | restart | | | | 77.6 GiB |
| 21:06:08 | the same 73,663-token compaction | 73,663 | 0 | ok | 83.9 GiB |

The summary request is smaller than the conversation, so there was room for it if the idle conversation's KV had been released.

### How often

Not every time. It deadlocked 1 of the 9 agent tasks we ran on MTPLX 2.12.0, about an hour into that task. Two earlier tasks got 507 refusals (3 in all, one at 75,961 tokens) and recovered, because pi fell back to starting a fresh conversation from the same history. A later run on the same setup had 5 more refusals at 0.2–1.7 GiB over the limit.

It depends on size. A refusal only happens when the memory already in use plus the new request's projection goes over the limit, and in the incident that was by 0.9 GiB. A shorter conversation or a smaller summary request fits and never meets the problem. But once it does happen, the idle session's memory can't be reclaimed (next section), so retrying doesn't help until restart.

### Why (our reading of the 2.12.0 source)

The admission shed (`_prefill_admission_shed`, `server/openai.py:18931`) frees memory in this order, and none of the steps can reach the idle conversation:

1. `mx.clear_cache()` (`server/openai.py:19156`). The allocator cache was already 0.
2. Superseded entries of the *incoming* request's session. The compaction has a new session id, so this matches nothing.
3. An LRU pass with `protect_active=True` (`server/openai.py:19198`). It skips any session active in the last `DEFAULT_ACTIVE_SESSION_PIN_TTL_S` = 600 s (`session_bank.py:250`). The conversation had sent a turn seconds earlier.
4. `shrink_for_admission` (`session_bank.py:3150`). Its `_evictable` filter (`session_bank.py:3206`) excludes every entry that holds a live cache reference (`cache_ref is not None` or `live_ref_only`). The conversation's entry holds one: the request carries coding-agent tools (`_anonymous_coding_agent_tool_request`, around `server/openai.py:20303`), so its KV is committed with a live reference.

The comment on `_evictable` explains the exclusion: *"Entries holding a live cache reference are the live session's own arrays … walking one frees nothing and costs the running session its state."* That's right while the session is running. But here the session was idle: its client was waiting for the summary. There doesn't seem to be any path that frees an idle session's live cache, or spills it to the SSD cold tier, under admission pressure. The in-flight set, which would tell idle from running, isn't consulted by the shed.

The numbers are consistent with the shed freeing nothing: 91.6 GiB active + `RUNTIME_TRANSIENTS_BYTES` (3 GiB, `memory_plan.py:54`) + the new prompt's planned KV comes to about the 96.9 GiB in the message. The message then suggests starting a new conversation, which is what the compaction request already was.

We haven't confirmed this with a debugger. The per-refusal `[mtplx] memory guard` log lines (`bank_bytes_before/after`, `lru_entries_evicted`, `chain_entries_evicted`) would show directly whether anything was evicted.

### Reproduction

1. Start MTPLX 2.12.0 with the flags above on a 128 GB Mac, serving Flash-Next.
2. With an agent that sends coding tools (pi in our case), grow one conversation past about 110k tokens.
3. Send a new request, under a new session id, of about 70k uncached tokens while the first session is still resident. With our client that happens naturally at compaction.

### Suggestion

Under admission pressure, for a request that is a full cache miss, let the shed release (or spill to SSD) the live-cache entries of sessions that aren't in flight, using the in-flight set rather than the 600 s activity pin. The SSD session cache is on, so the idle conversation could be restored later.

A smaller point: `protect_tokens` in `shrink_for_admission` protects the entry sharing the longest prefix with the new prompt, with no minimum length. A few shared chat-template tokens seem enough to protect an unrelated entry.

Possible workarounds, which we haven't tried:
- on a 507 `memory_refusal`, the client calls `POST /admin/sessions/{session_id}/clear` for the idle session and retries;
- `MTPLX_SESSION_BANK_ACTIVE_PIN_TTL_S=0`, which lets the LRU pass consider the idle session, at the cost of the pin's protection for every session.

### Related observation, possibly a separate issue

Over the same server lifetime, `host_overhang_bytes` in 23 `prefill_admission_shed` events rose 1.0 → 1.9 → 10.9 → 13.1 → 13.3 GiB and reached 14.2–14.8 GiB by the refusals above, against a 16 GiB `host_allowance_bytes`. It never came down, even through cache clears. The process's `phys_footprint` went from 92 to 109 GiB, briefly 117. The comment above `_HOST_MEMORY_ALLOWANCE_FLOOR_BYTES` (`server/openai.py:18802`) puts a healthy daemon at 3–6 GiB plus up to 4 GiB of SSD writer backlog, so this is about 2.5 times that.

We don't know what it is made of. From the source, two things could hold more than their caps: the n-gram hot-row cache, if cached rows keep their whole fetch batch alive, and a single oversized SSD write entry admitted past the backlog cap. Neither is confirmed. A `footprint -p <pid>` breakdown of a long-running daemon would settle it, and we're happy to share one if we reproduce it.
