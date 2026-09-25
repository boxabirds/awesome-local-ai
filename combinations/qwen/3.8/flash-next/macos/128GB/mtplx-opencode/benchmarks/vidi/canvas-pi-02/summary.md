# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 46.1 | 118 | 8577481 | 137733 | 1.2 | 67.5 | green | 6/6 |  | 0 / 0 | 1 | 119758 | throttled 87%, server peak 105 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 77.6 | 205 | 13417999 | 211432 | 1.1 | 59.2 | green | 20/20 |  | 0 / 0 | 3 | 116754 | throttled 99%, server peak 110 GB |
| 3 | See other people's edits appear live on the same board | DONE | 124.0 | 420 | 28827658 | 337899 | 1.3 | 62.4 | green | 20/27 |  | 1 / 0 | 6 | 118458 | throttled 96%, server peak 112 GB |

**Totals:** 3 stories, 248 agent-minutes, 743 requests, 50,823,138 prompt / 687,064 completion tokens, gate green 3/3, final acceptance 20/27, stalled 0, partial 0, 9401 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 12 | 102.7 |
| 32-64k | 254 | 62.5 |
| 64-100k | 311 | 63.0 |
| 100-+k | 123 | 57.7 |
| 16-32k | 43 | 74.5 |
