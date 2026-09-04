# Discovery log — Qwen3.8 on Apple silicon with MTPLX

The macOS counterpart to [discovery.md](discovery.md). Everything here was
measured on one machine: **Apple M5 Max, 128 GB unified memory, macOS 26.4
(build 25E246), MLX 0.32.1 / mlx_lm 0.31.3, mtplx 2.10.1**, between 2026-08-22
and 2026-09-01.

Read this before changing context, reasoning effort or MTP depth on either
macOS combination. Several of the settings look arbitrary and are not.

---

## 1. OpenCode silently drops `reasoning_effort`

The single most expensive finding, because it invalidates any measurement taken
before it was understood.

An OpenCode agent definition accepts an `options` block, and putting
`reasoning_effort` in it does nothing at all: OpenCode strips both
`reasoning_effort` and `chat_template_kwargs` before the request leaves the
client. Every request therefore landed on MTPLX's own default (`auto`, which
resolves to `medium`) no matter what the agent config said.

Nothing warns. The agent config still reads as though it is in force — the
scratchpad this work came from still had `"reasoning_effort": "xhigh"` sitting
in two agent definitions that had never had any effect.

**The fix** is the server flag, which is the only lever that verifiably
applies:

```
mtplx serve --reasoning-effort low
```

and `/health` reports what it resolved to, so it can be checked rather than
assumed:

```bash
curl -s http://127.0.0.1:8010/health | python3 -m json.tool | grep -i reason
```

This is why `REASONING_EFFORT` is a launcher variable in these combinations and
not a client setting.

## 2. The context ceiling is 131072, not the advertised 262144

Both packs advertise a 262144-token context. Running near it does not fail
cleanly; it degrades and then stops producing output.

Measured on the 27B:

| Context | Decode |
|---|---|
| ~27k | ~35 tok/s |
| ~200k | ~11–18 tok/s |

At 201,779 tokens the session began returning **zero-token responses**. Not an
error, not a refusal — empty completions.

131072 is where the model is still fast enough to be worth using. That is the
cap in both combinations, and the reason the `coding` profile is not simply set
to the model's maximum.

### 2b. The cap only works if the client agrees

The server enforces its ceiling by refusing to exceed it. Only the *client's*
`limit.context` makes OpenCode compact its history before it gets there. Set
one without the other and you do not get a smaller context — you get a wall.

So `CONTEXT_LIMIT` in `config.sh` and `--context-window` in the launcher must
match, and the launcher's help says so. This coupling spans two files and one
of them is not in this repo, which is exactly the kind of thing that gets lost.

## 3. `ar` is the only per-request MTP kill switch

Measuring MTP against a baseline requires turning it off per request. The
request fields `enable_mtp` and `mtp` are **accepted and silently ignored**.
Only `"generation_mode": "ar"` works.

An earlier round of "MTP off" numbers was MTP on throughout. The tell was that
the baseline was implausibly fast; there was no error to notice.

## 4. Blind alley: the session bank was predicted to collapse, and did not

The prediction, written down before the Flash-Next run: a 77.3 GB pack on a
128 GB machine would trip the macOS memory pressure guard, the session bank
would be trimmed to zero, warm-prefix restores would never happen, and the
throughput advantage would evaporate.

It did not happen. `restored_median` was 0.988 and the bank held 93–100%
throughout. The 131072 window — against 262144 on an earlier load — left
enough headroom for both.

The reasoning behind the prediction was also wrong in a second way. Flash-Next
has ~60% draft acceptance against the 27B's ~78%, and acceptance is what MTP
converts into throughput, so on that basis it should have been slower. It is
roughly 1.9x faster. MoE memory traffic dominates both effects.

Kept because it was wrong, and because "acceptance is what matters" is a
plausible-sounding heuristic that would have led to the wrong model.

## 5. A/B design: same port, pinned model id, serial blocks, cooled between

Four choices, each from a specific failure.

**Same port, `--model-id` pinned.** The request log is per-port, but every line
carries `served_model_id`, so one log holds both arms and the reporter separates
them. The first attempt used two ports; the second server hit errno 48, never
started, and the run produced no results at all.

**Serial, never interleaved.** The packs cannot be co-resident — 30 GB and
115 GB on a 128 GB machine — so each block owns the machine.

**Cooled to `nominal` between blocks.** Sustained inference leaves this machine
at `heavy` for minutes after the load stops. Measuring the second arm without
cooling turns thermal recovery into a fake model effect; interleaving instead
of cooling produced a **3x error** in earlier work on this hardware.

**Thermal recorded per request, not just per block.** The reporter joins each
request to the thermal state at its start and reports per-state medians, so a
run that drifted across states is visible rather than averaged away.

## 6. Metal's working set, not the machine's RAM

`ACCEL_MEM_MIB` must mean "the budget that constrains the model", the same as
VRAM does on Linux. On Apple silicon that is not `hw.memsize`.

On this machine:

| Source | Value |
|---|---|
| `hw.memsize` | 131,072 MiB |
| Metal `recommendedMaxWorkingSetSize` | 110,100 MiB |
| `maxBufferLength` | 82,576 MiB |
| `iogpu.wired_limit_mb` | 0 (meaning "OS default") |

`recommendedMaxWorkingSetSize` is what MLX allocates against and is what
`lib/accel/metal.sh` reports. Using RAM instead would let a combination qualify
and then die part-way through loading — 21 GB of apparent headroom that does
not exist.

`iogpu.wired_limit_mb` reads `0` unless someone has set it; `0` means the OS
default, not "no limit". macOS does not document that default and it varies
with installed RAM, so the adapter prefers Metal's own answer and only falls
back to a labelled 75% estimate.

Note `maxBufferLength` (80.6 GiB) is *below* the working set: Flash-Next's
77.3 GB of weights fits, but not by much.

## 7. Environment gotchas

- **`mtplx models --json` does not check weight shards.** It validates the
  runtime contract and the MTP sidecar. A pack holding only
  `model.safetensors.index.json` and the tokenizer is reported as missing
  nothing but the sidecar — which is exactly what an interrupted download looks
  like. `lib/mtplx.sh` cross-checks the weight map itself.
- **Two launch paths give different defaults.** `mtplx quickstart --profile
  turbo` and `mtplx serve` are not the same command. The A/B numbers came from
  `serve`, which resolves `turbo` anyway from the pack's `recommended_profile`.
  The combinations use `serve` with explicit flags so nothing is implicit.
- **The packs want different samplers.** The 27B's `mtplx_runtime.json`
  specifies temperature 0.6; Flash-Next specifies 1.0. Sharing one launch path
  across both — as the original scratchpad did — silently ran one of them wrong.
- **Flash-Next streams a 29.8 GB n-gram table from SSD.** It is not wired, so it
  does not count against the memory budget, but the pack wants fast local
  storage.
- **Stock macOS `/bin/bash` is 3.2.57**, `find` has no `-printf`, and there is
  no `setsid`. All three broke shared code that had only ever run on Ubuntu.

## 8. Open questions

- No 64 GB machine has been tested. The 27B combination is filed under `64GB`
  on arithmetic, not measurement.
- Output quality was never compared. The 1.9x is throughput only; no scored
  task was run on either arm.
- Decode falls off with context, but only two points were measured on the 27B
  (~27k and ~200k). The shape of that curve between them is unknown.
- `mtplx tune` prefers a deeper draft within 2% of the fastest. Whether D3's
  robustness over D2 actually holds across prompt distributions was not tested.
