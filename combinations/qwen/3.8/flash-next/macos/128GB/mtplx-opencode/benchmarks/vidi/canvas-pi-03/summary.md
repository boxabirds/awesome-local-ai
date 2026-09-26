# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | 100 | 5844203 | 96786 | 0.9 | 63.7 | green | 6/6 |  | 0 / 0 | 1 | 115094 | throttled 96%, server peak 108 GB |

**Totals:** 1 stories, 34 agent-minutes, 100 requests, 5,844,203 prompt / 96,786 completion tokens, gate green 1/1, final acceptance 6/6, stalled 0, partial 0, 1515 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 8 | 97.8 |
| 16-32k | 16 | 75.5 |
| 32-64k | 29 | 63.1 |
| 64-100k | 37 | 62.7 |
| 100-+k | 10 | 57.8 |
