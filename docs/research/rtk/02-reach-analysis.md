# Reach analysis (step 0)

*28 September 2026. RTK 0.49.0, commit `7efbaef`, built from source.*

Before spending machine time on an A/B test, this checks how much of our agents' tool output RTK could even touch.

## Method

1. [`scripts/extract.py`](scripts/extract.py) read every completed tool call from the agent event logs of three runs and recorded the tool, the shell command (for bash calls) and the size of the output:
   - quintus, mlx-serve, `canvas-mlx-02`: stories 1–9 and the start of story 10, 2,242 calls;
   - tritus, gufo, `canvas-gufo-r1`: all 11 stories, 2,202 calls;
   - gruntus, llama.cpp with Qwen3.8-Swift 27B, `canvas-pi-02`: all 11 stories, 3,692 calls.
2. [`scripts/classify.py`](scripts/classify.py) ran each shell command through `rtk rewrite`, RTK's own rule for what its hook intercepts, and totalled the output characters by class. Output characters stand in for tokens.

Note: `rtk rewrite` exits with code 3 for an "advisory" rewrite, which is what it returned for every command here. Its `--help` only mentions 0, but the pi extension it installs documents 3 as a rewrite too. The first run of the classifier treated only 0 as a rewrite and missed every one.

The totals are in [`results/reach-2026-09-28.json`](results/reach-2026-09-28.json).

## Results

Share of all tool-output characters:

| Stack | pi's `read` tool | bash, RTK rewrites it | bash, RTK leaves it alone | edit and write |
|---|---|---|---|---|
| quintus, mlx-serve (Flash-Next) | 50.4% | **30.3%** | 18.2% | 1.2% |
| tritus, gufo (Flash-Next) | 58.5% | **20.5%** | 19.4% | 1.7% |
| gruntus, llama.cpp (Swift 27B) | 59.5% | **18.3%** | 20.0% | 2.2% |

**RTK can reach 18–30% of the tool output.** Half or more of all tool output comes from pi's own `read` tool, which the hook never sees.

What RTK would rewrite is mostly searching and listing: `grep -n` and `grep -rn`, `sed -n` file views, `ls -la` and `find`. What it leaves alone includes most of the test-runner output (`npx vitest`, `npx playwright`, `npm run test:…`), which is where its failures-only filters are strongest.

That's because **our agents pipe most commands into a filter themselves**: 72% of bash calls end in `| tail`, `| head`, `| grep` or similar, and those calls produce 59% of the bash output. RTK does not rewrite a command piped into `tail` (for example `npx vitest run 2>&1 | tail -30`). The agents are already doing their own compression.

## What this means

- **The ceiling is modest.** If RTK cut the output it reaches by the 60–90% it claims, total tool output would fall by roughly 11–27%. Tool output is 38–63% of what fills a quintus conversation (measured on canvas-mlx-02 stories 5, 8 and 9), so the conversation would be roughly 4–17% smaller. These are estimates from RTK's claimed rates, not measurements of its compression on our commands.
- **The part it reaches is the riskiest to compress.** Grep and file views are how the agent finds what to change. Grouping or trimming them can hide the one line it needs, and that is where the independent study found agents making extra turns.
- **The part where it is safest and strongest, test output, is mostly out of reach,** because the agents already pipe it into `tail`.

## Not covered

- How much RTK actually compresses our commands. That would need the commands re-run against the workspace as it was at the time.
- Whether routing pi's `read` tool through `rtk read` is possible or wise. RTK's aggressive read mode strips function bodies, which would break editing.
- OpenCode runs. All three runs here used pi.
