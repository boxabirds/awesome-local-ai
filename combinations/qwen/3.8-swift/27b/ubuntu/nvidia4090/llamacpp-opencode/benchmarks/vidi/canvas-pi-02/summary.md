# Vidi run — qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-swift-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 24.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 32.2 | None | None | None | — | — | green | 16/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 24 GB |
| 3 | See other people's edits appear live on the same board | DONE | 193.0 | None | None | None | — | — | green | 22/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 24 GB |
| 4 | Return to a board and find everything as it was left | DONE | 211.0 | None | None | None | — | — | red | 26/31 |  | 0 / 0 | 7 | — | throttled 0%, server peak 24 GB |

**Totals:** 4 stories, 461 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/4, final acceptance 26/31, stalled 0, partial 0, 8650 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6386 / 0 | `useCamera.ts` (205), `BoardViewport.tsx` (178), `camera.ts` (126), `styles.css` (114), `NOTES.md` (91), `App.tsx` (52), +13 more |
| 2 | 4 by the agent | 2349 / 65 | `board-model.ts` (259), `StickyNote.tsx` (192), `styles.css` (175), `App.tsx` (110), `StickyTextEditor.tsx` (104), `StickyText.ts` (101), +10 more |
| 3 | 4 by the agent | 4285 / 321 | `board-room.ts` (240), `connectBoard.ts` (212), `NOTES.md` (124), `protocol.ts` (91), `board-id.ts` (48), `App.tsx` (41), +13 more |
| 4 | 2 by the agent | 2783 / 122 | `board-room.ts` (466), `board-store.ts` (311), `NOTES.md` (83), `room-state.ts` (80), `connectBoard.ts` (76), `test-hooks.ts` (48), +15 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 1** earlier held-out tests (Story 3 (tasks 4, 7, 8, 9): y-websocket client sync + connection badge, live-collab e2e, and nightly soak; Story 3 (tasks 3, 5, 6): BoardRoom Durable Object relays y-protocols sync + awareness over real WebSockets, with full integration tests in workerd; story 3 (task 2): Worker entry routing + board-id/protocol implementation + wrangler config + vitest workers pool; story 3 (task 1): board id + protocol decode unit tests first (TC-01..TC-03), named settings). Source files it changed most: `board-room.ts` (240), `connectBoard.ts` (212), `NOTES.md` (124), `protocol.ts` (91), `board-id.ts` (48), `App.tsx` (41), +13 more.
  - story 2: 6/10 → 7/10; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
