# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope ``, effort `client default`, client claude 2.1.283 (Claude Code), host Apple M2 16GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | See which version of Todoodle is live in each environment | DONE | 18.7 | None | None | None | — | — | green | 11/11 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Start a private workspace instantly, with no sign-up, and get a secret link to return to it | DONE | 31.9 | None | None | None | — | — | green | 33/33 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | Get back to my workspaces from this browser without hunting for the link | DONE | 21.5 | None | None | None | — | — | green | 47/48 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |

**Totals:** 3 stories, 72 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 47/48, stalled 0, partial 0, 0 lines in src+tests.

> Stories 3 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 13 by the agent | 3916 / 24 | `pipeline.ts` (195), `README.md` (105), `deps.ts` (100), `vitest.config.ts` (84), `wrangler.toml` (72), `validate.ts` (71), +46 more |
| 2 | 19 by the agent | 5014 / 134 | `cookie.ts` (138), `SharePanel.tsx` (136), `Workspace.tsx` (125), `tokens.ts` (121), `workspaces.ts` (114), `WorkspaceNameEditor.tsx` (103), +55 more |
| 3 | 14 by the agent | 2865 / 70 | `WorkspaceSwitcher.tsx` (107), `UnsavedLinkWarning.tsx` (87), `RememberedRow.tsx` (78), `cookie.ts` (75), `WorkspaceSkeleton.tsx` (71), `remembered.ts` (70), +38 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
