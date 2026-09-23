# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | 55.4 | 137 | 9872492 | 149984 | 1.2 | 59.3 | red | 0/6 |  | 0 | 1 | 114803 | throttled 97% |

**Totals:** 1 stories, 55 agent-minutes, 137 requests, 9,872,492 prompt / 149,984 completion tokens, gate green 0/1, final acceptance 0/6, stalled 0, 2457 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 7 | 79.0 |
| 16-32k | 3 | 59.1 |
| 32-64k | 43 | 59.9 |
| 64-100k | 56 | 59.3 |
| 100-+k | 28 | 58.3 |
