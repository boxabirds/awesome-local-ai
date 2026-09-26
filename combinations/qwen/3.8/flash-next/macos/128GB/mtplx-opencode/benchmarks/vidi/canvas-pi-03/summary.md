# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | 100 | 5844203 | 96786 | 0.9 | 63.7 | green | 6/6 |  | 0 / 0 | 1 | 115094 | throttled 96%, server peak 108 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 46.7 | 181 | 11185922 | 131257 | 1.0 | 57.0 | green | 19/20 |  | 0 / 0 | 1 | 115221 | throttled 99%, server peak 109 GB |

**Totals:** 2 stories, 81 agent-minutes, 281 requests, 17,030,125 prompt / 228,043 completion tokens, gate green 2/2, final acceptance 19/20, stalled 0, partial 0, 3672 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 13 | 97.8 |
| 16-32k | 42 | 69.5 |
| 32-64k | 91 | 55.9 |
| 64-100k | 103 | 55.8 |
| 100-+k | 32 | 52.3 |
