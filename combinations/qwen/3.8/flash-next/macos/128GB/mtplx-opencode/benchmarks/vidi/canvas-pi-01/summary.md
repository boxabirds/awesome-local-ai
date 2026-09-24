# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | 55.4 | 137 | 9872492 | 149984 | 1.2 | 59.3 | red | 0/6 |  | 0 / 0 | 1 | 114803 | throttled 97% |
| 2 | Capture ideas on sticky notes and rearrange them | 40.8 | 116 | 7956044 | 126418 | 1.2 | 65.9 | red | 18/20 |  | 0 / 0 | 1 | 115633 | throttled 91% |
| 3 | See other people's edits appear live on the same board | 58.4 | 236 | 15775475 | 163933 | 1.3 | 64.7 | red | 0/27 |  | 0 / 0 | 2 | 115953 | throttled 96% |
| 4 | Return to a board and find everything as it was left | 125.5 | 415 | 28193231 | 335701 | 1.2 | 65.4 | red | 26/31 |  | 0 / 3 | 5 | 120680 | throttled 90% |

**Totals:** 4 stories, 280 agent-minutes, 904 requests, 61,797,242 prompt / 776,036 completion tokens, gate green 0/4, final acceptance 26/31, stalled 0, 10049 lines in src+tests.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 19 | 86.2 |
| 16-32k | 57 | 70.0 |
| 32-64k | 314 | 65.9 |
| 64-100k | 368 | 63.9 |
| 100-+k | 146 | 65.1 |
