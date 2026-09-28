# Microbench

Short, targeted checks of a serving setup that run in minutes, for decisions that shouldn't wait for a full benchmark run. A microbench can check a mechanism: does a setting do what we think, and does it break anything? It can't replace a run: effects that build up over many stories, such as features breaking after compactions, only show in full runs.

## Run one

```bash
uv run microbench.py --url http://127.0.0.1:PORT --plan plans/effort-low.json --out results/NAME
```

Output in `results/NAME/`: `raw.jsonl` (one line per request), `summary.json` (per probe and variant: count, errors, median completion tokens and seconds, valid tool-call rate) and `verdict.json`. The exit code is 0 when every criterion passes and 1 when one fails.

## Plans

A plan is a JSON file in `plans/`: which probes to run with what settings, and pass criteria written before running. A criterion is an expression over the summary, for example:

```json
{"name": "low effort thinks at least 30% less",
 "expr": "ratio(replay['effort-low']['median_completion_tokens'], replay['as-is']['median_completion_tokens']) <= 0.7"}
```

| Plan | Question | About |
|---|---|---|
| [`effort-low.json`](plans/effort-low.json) | Does low reasoning effort shorten thinking on real agent turns without breaking tool calls? Which effort does a server apply when none is named? | 15 min on quintus |

## Probes

| Probe | What it does |
|---|---|
| `effort-silence` | Sends one short reasoning prompt with no effort named and with named efforts (`none`, `low`, `medium`, `xhigh`), to see which effort the server applies when a request names none. |
| `replay` | Sends real captured agent requests as captured and in variants (`as-is`, `effort-low`, `effort-medium`, `effort-xhigh`). Records thinking length, time, and whether the reply still ends in a tool call with valid arguments. |

To add a probe, write a function that takes the server URL and its settings and yields one result row per request, and register it in `PROBES` in `microbench.py`. The request helpers come from `benchmarks/gufo-eval/long-session/`.

## Captured requests

`requests/flash-next-pi/` holds three real pi requests to Qwen3.8 Flash-Next at about 30k, 60k and 100k tokens of context, captured from gufo runs during the long-session investigation (`capture_server.py` and `cut_session.py` there). The model and agent are the same on every Flash-Next stack, so they replay on any of them.

## Between benchmark runs

`gate-between-runs.sh` runs a plan in the gap between two runs of a series: it waits for the first run to finish, stops the series before the next run starts a story, starts the model server, runs the plan, and then either starts what comes next (on a pass) or holds and does nothing (on a fail). Settings are environment variables, documented at the top of the script. `DRY_RUN=1` shows what it would do.
