# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 46.1 | 118 | 8577481 | 137733 | 1.2 | 67.5 | green | 6/6 |  | 0 / 0 | 1 | 119758 | throttled 87%, server peak 105 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 77.6 | 205 | 13417999 | 211432 | 1.1 | 59.2 | green | 20/20 |  | 0 / 0 | 3 | 116754 | throttled 99%, server peak 110 GB |
| 3 | See other people's edits appear live on the same board | DONE | 124.0 | 420 | 28827658 | 337899 | 1.3 | 62.4 | green | 20/27 |  | 1 / 0 | 6 | 118458 | throttled 96%, server peak 112 GB |
| 4 | Return to a board and find everything as it was left | DONE | 138.7 | 69 | 5683005 | 35316 | 1.6 | 64.4 | green | 21/31 |  | 0 / 0 | 6 | 112516 | DEGRADED (power) throttled 86%, server peak 115 GB |
| 5 | Share a board with others using a link | PARTIAL (amber) | 389.0 | 1240 | 89064830 | 873403 | 1.6 | 61.7 | green | 34/36 |  | 2 / 20 | 16 | 118520 | throttled 91%, server peak 116 GB |

**Totals:** 5 stories, 775 agent-minutes, 2052 requests, 145,570,973 prompt / 1,595,783 completion tokens, gate green 5/5, final acceptance 34/36, stalled 0, partial 1, 19526 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 5 PARTIAL**, ended by the operator (operator (quintus)): runaway story: ~7.5 h agent time and 20 nudges without committing; operator cut-off at 4 h / 5 nudges adopted 2026-09-25. Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 5/5 (floor 1.0).

> Stories 4 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 21 | 92.5 |
| 32-64k | 701 | 63.6 |
| 64-100k | 849 | 60.9 |
| 100-+k | 383 | 60.3 |
| 16-32k | 98 | 64.0 |
