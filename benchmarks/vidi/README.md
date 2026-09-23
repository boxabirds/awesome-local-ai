# Vidi — a spec-bench pack

A Miro-style collaborative whiteboard ("vidi6"): 17 stories in 3 epics
(real-time collaboration; infinite canvas and content; boards, sharing and
output), each with a PRD, a technical design and ordered tasks. Stack: Vite +
React + TypeScript on Cloudflare Workers (Durable Objects, R2), Yjs for sync.

```bash
benchmarks/spec-bench/harness/run.sh <install-id> --pack benchmarks/vidi --record   # scope defaults to canvas
```

| Scope | Stories | Why |
|---|---|---|
| `canvas` | 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12 | the canvas epic plus stories 3–5 its designs build on |

The held-out suite (`acceptance/`) has 75 black-box Playwright tests across
those 11 stories, using only the spec's UI text, aria-labels, roles, shortcuts
and routes (`/b/<22-char id>`). It is validated one way only: against an empty
stub app all 75 fail and none hang.

Results: `combinations/<combination>/benchmarks/vidi/<run-id>/`. See
[`../spec-bench/`](../spec-bench/) for how runs work.
