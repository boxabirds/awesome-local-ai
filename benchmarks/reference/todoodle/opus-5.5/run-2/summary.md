# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope ``, effort `client default`, client claude 2.1.283 (Claude Code), host Apple M2 16GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | See which version of Todoodle is live in each environment | DONE | 18.4 | None | None | None | — | — | green | 11/11 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Start a private workspace instantly, with no sign-up, and get a secret link to return to it | DONE | 29.7 | None | None | None | — | — | red | 30/33 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | Get back to my workspaces from this browser without hunting for the link | DONE | 21.5 | None | None | None | — | — | red | 44/48 |  | 0 / 0 | 0 | — | throttled 0% |
| 4 | Bring others into a workspace by sharing its link | DONE | 36.6 | None | None | None | — | — | red | 46/51 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 4 stories, 106 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/4, final acceptance 46/51, stalled 0, partial 0, 0 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 13 by the agent | 4124 / 52 | `pipeline.ts` (238), `deps.ts` (108), `validate.ts` (97), `README.md` (82), `record.ts` (63), `NOTES.md` (61), +45 more |
| 2 | 19 by the agent | 5041 / 71 | `SharePanel.tsx` (170), `cookie.ts` (133), `Workspace.tsx` (130), `tokens.ts` (122), `linkSaved.ts` (109), `workspaces.ts` (92), +55 more |
| 3 | 14 by the agent | 3142 / 71 | `WorkspaceSwitcher.tsx` (133), `UnsavedLinkWarning.tsx` (102), `RememberedRow.tsx` (87), `NOTES.md` (83), `RememberedList.tsx` (83), `ForgetDialog.tsx` (74), +37 more |
| 4 | 13 by the agent | 4070 / 140 | `LiveConnection.ts` (286), `editGuard.ts` (223), `network.ts` (137), `useEditGuard.ts` (106), `LiveProvider.tsx` (98), `errors.ts` (77), +38 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
