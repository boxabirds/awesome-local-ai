# Local replay: what RTK actually does to our commands

*28 September 2026. RTK 0.49.0, commit `7efbaef`. Run on a MacBook, no model needed.*

The [reach analysis](02-reach-analysis.md) found which commands RTK would rewrite, using RTK's own claimed compression to estimate the effect. This measures the effect directly.

## Method

1. Copied the final workspace of `canvas-gufo-r1` (tritus, gufo) into a scratch folder, installed its dependencies and made it a git repository so git commands work.
2. [`scripts/replay.py`](scripts/replay.py) took the shell commands the agent actually ran in that run, kept only read-only ones (`grep`, `sed -n`, `ls`, `find`, `cat`, `head`, `tail`, `wc`, git read commands, unit and component test runs), dropped anything that writes, deletes or starts a server, and picked 150 at random from those RTK rewrites. Each ran twice in the workspace: as recorded, and as RTK rewrites it.
3. [`scripts/analyse_replay.py`](scripts/analyse_replay.py) compared output sizes, checked that every line number a `grep -n` found was still in RTK's output, and checked exit statuses.
4. Separately, the test runners were run with a passing suite and again with one assertion deliberately broken, to see whether the failure survives.

Raw sizes are in [`results/replay-gufo-r1-2026-09-28.json`](results/replay-gufo-r1-2026-09-28.json). The workspace is the agent's final state, not the state at the time of each command, so some commands (for example, ones reading the spec folder, which isn't kept in the snapshot) failed in both arms. They are left out: 86 of the 150 produced real output.

## Results

**On the agent's own commands, RTK made the output 1% smaller** (109,367 to 107,996 characters):

| Commands | Count | Before | After | Smaller by |
|---|---|---|---|---|
| `grep` | 60 | 42,457 | 41,869 | 1% |
| `cat` (becomes `rtk read`) | 13 | 41,200 | 41,200 | 0% |
| `npm run` | 1 | 10,625 | 10,420 | 2% |
| `find` | 1 | 6,281 | 6,281 | 0% |
| `head` | 6 | 5,925 | 5,925 | 0% |
| `ls` | 4 | 2,672 | 2,094 | 22% |

Nothing was lost: all `grep -n` hits kept their line numbers, and no exit status changed.

**Test runners, the case RTK is best at:**

| Command | Suite passing | One test failing | Failure still shown? |
|---|---|---|---|
| `npm run test:unit` (becomes `rtk npm run test:unit`) | 1,990 to 1,959 | 3,344 to 3,311 | yes |
| `npx vitest run --project unit` (becomes `rtk vitest`) | 1,907 to **20** | 3,265 to **1,959** | yes: test name, assertion and file line, plus a `rtk recall` id for the full output |

RTK's vitest filter works well: a passing run shrinks to one line, and a failing one keeps what the agent needs. But it only applies when the agent calls vitest directly. Our agents run the test scripts the spec defines (`npm run test:unit`), and RTK's `npm run` handler passes that output through almost unchanged.

## What this means

RTK, installed as-is, would barely change what our agents see: about 1% on their actual commands, where the [reach analysis](02-reach-analysis.md) estimated up to 4–17% of the conversation from RTK's claimed rates. Its compression is real, but it applies to commands our agents mostly don't run in the form RTK recognises:
- tests run through `npm run` scripts rather than vitest directly;
- output already piped into `tail`;
- files read through pi's `read` tool rather than `cat`.

Getting the benefit would mean changing how the agent works (calling test runners directly, not piping), for example by telling it about RTK. That is a change to the agent's instructions, and it would need its own A/B test.

## Pi integration

`rtk init -g --agent pi` writes one file, `~/.pi/agent/extensions/rtk.ts`, a small pi extension that sends each bash call through `rtk rewrite`. Tested in an isolated home directory like the harness's agent sandbox. For the harness, an RTK arm would install that file into each run's sandbox home and put `rtk` on the agent's PATH. Not tried inside the sandbox yet.
