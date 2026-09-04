# Same brief, different models

Side-by-side builds of the same brief, so a locally-hosted model's output can be compared
against hosted frontier models on identical work — not against a memory of what a model
"usually" does.

This is the qualitative counterpart to the throughput numbers elsewhere in this repo: those
say how fast a local setup runs, these say what it actually produces.

Each subdirectory under a task is one model's or one configuration's attempt. The directory
name is the label. There is no scoring harness here, and the prompts and evaluation criteria
used were not recorded in the tree — so read these as artefacts to inspect, not as a
benchmark with a winner.

## Tasks

### `planning-poker/`

Three independent attempts at the same brief: clone [planningpokeronline.com](https://planningpokeronline.com)
— real-time, multiplayer story-point estimation where a room shares a link, everyone plays a
card at once, and nothing is revealed until the facilitator says so.

| Variant | Stack as built |
| --- | --- |
| `27b-mtplx` | React + React Router, TypeScript, Cloudflare Workers (wrangler), Vitest with `@cloudflare/vitest-pool-workers` and Testing Library |
| `flash-next` | React + Tailwind, plain JS, Node WebSocket server (`ws`) — no Cloudflare, no external realtime service |
| `claude-opus-5` | React + Tailwind, TypeScript, Cloudflare Workers with a Durable Object for room state and D1 for history; Vitest unit tests plus a WebSocket e2e suite |

The three diverge most in where live room state lives — a Node process holding sockets, a
Worker, or a Durable Object — which is the interesting part of the comparison: it is the
decision the brief never states and every implementation has to make.

Each variant has its own README covering how to run it.

### `meteor-storm/`

A browser game built on Three.js (`js/three.min.js` is the vendored library; `js/game.js`
and `js/audio.js` are the generated code). Open `index-bf16.html` directly in a browser —
no build step.

Only one attempt is checked in, labelled by the numeric precision it was generated at
(`bf16`) rather than by model name.

## `docs/`

`mtp.md` is the write-up behind the `27b-mtplx` label: multi-token-prediction speculative
decoding for a local coding-agent stack on Apple Silicon, using the MTP head that ships
inside the Qwen3.8-27B checkpoint as its own drafter. It records the config, how to verify
MTP is actually on, and measured before/after decode throughput on the author's machine.

The `-mtplx` suffix on a variant directory means it was produced with that setup enabled.

## Layout

```
bench_util.py            scratch helper, not a harness
docs/mtp.md              the MTP speculative-decoding write-up
meteor-storm/            Three.js browser game, one attempt
planning-poker/          three attempts at the same brief
  27b-mtplx/
  claude-opus-5/
  flash-next/
```

## Working in here

Each variant is a self-contained project with its own dependencies. `node_modules`, build
output and local Cloudflare state (`.wrangler/`) are all ignored — expect to run an install
inside a variant before running it.

Nothing here is deployed, and nothing shares state between variants.

These are generated demo artefacts kept for comparison. Unlike the measured figures
elsewhere in this repo, nothing here has been graded or ranked.
