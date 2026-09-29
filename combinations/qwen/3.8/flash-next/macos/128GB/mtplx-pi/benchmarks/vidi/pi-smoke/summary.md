# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | 30.1 | 81 | 4391776 | 77274 | 0.8 | 55.0 | green | 0/6 |  | 0 | 0 | 105848 | DEGRADED (power) throttled 100% |

**Totals:** 1 stories, 30 agent-minutes, 81 requests, 4,391,776 prompt / 77,274 completion tokens, gate green 1/1, final acceptance 0/6, stalled 0, 1278 lines in src+tests.

> Stories 1 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 9 | 62.0 |
| 16-32k | 16 | 75.3 |
| 32-64k | 23 | 49.8 |
| 64-100k | 25 | 50.7 |
| 100-+k | 8 | 55.0 |
