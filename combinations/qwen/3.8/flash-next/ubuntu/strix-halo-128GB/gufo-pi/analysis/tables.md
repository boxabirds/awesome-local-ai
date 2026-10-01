
### 1. The engine, per run

| run | requests | decode tok/s | drafts accepted | prompt cache hits | prompt tokens re-read | requests not ended by the model | GPU max °C | throttled samples |
|---|---|---|---|---|---|---|---|---|
| v2-r1 | 2510 | 46.7 | 79% | 98.0% | 1.8% | 0 | 87 | 0 |
| v2-r2 | 1817 | 45.9 | 79% | 98.1% | 1.6% | 0 | 87 | 0 |
| v2-r3 | 1884 | 47.0 | 80% | 98.2% | 1.6% | 2 | 86 | 0 |
| v2-r4 | 1884 | 47.8 | 80% | 98.2% | 1.6% | 0 | 86 | 0 |

### 1b. Decode speed by what is being generated

| calls that are | calls | decode tok/s | drafts accepted |
|---|---|---|---|
| thinking (80%+ of the call) | 762 | 38.5 | 69% |
| code and text (80%+ of the call) | 1555 | 52.7 | 85% |

### 1c. Decode speed by how full the context is

| prompt tokens | requests | decode tok/s | drafts accepted |
|---|---|---|---|
| 0–20k | 243 | 46.6 | 78% |
| 20–40k | 1217 | 46.5 | 78% |
| 40–60k | 1809 | 47.6 | 80% |
| 60–80k | 1843 | 47.0 | 80% |
| 80–100k | 1704 | 46.6 | 80% |
| 100–140k | 1127 | 45.9 | 80% |

### 1d. Where the 34 hours of the four runs went

| spent on | hours | share |
|---|---|---|
| generating code and text | 14.1 | 42% |
| generating thinking | 9.4 | 28% |
| tools (tests, builds, servers) | 6.7 | 20% |
| reading prompts, and the rest | 2.4 | 7% |
| compaction | 1.4 | 4% |

### 2. Minutes per story

| story | v2-r1 | v2-r2 | v2-r3 | v2-r4 | slowest / fastest | CV | same, to first "done" | CV |
|---|---|---|---|---|---|---|---|---|
| 1 | 51 | 35 | 28 | 35 | 1.8x | 23% | 1.8x | 23% |
| 2 | 80 | 18 | 97 | 52 | 5.4x | 49% | 5.4x | 49% |
| 3 | 45 | 38 | 39 | 39 | 1.2x | 7% | 1.2x | 7% |
| 4 | 47 | 122 | 67 | 92 | 2.6x | 34% | 2.6x | 39% |
| 5 | 32 | 48 | 39 | 32 | 1.5x | 17% | 1.5x | 17% |
| 7 | 29 | 49 | 50 | 30 | 1.8x | 26% | 1.8x | 26% |
| 8 | 35 | 28 | 22 | 40 | 1.8x | 21% | 1.8x | 21% |
| 9 | 34 | 30 | 32 | 32 | 1.1x | 5% | 1.1x | 5% |
| 10 | 204 | 27 | 53 | 34 | 7.6x | 92% | 2.0x | 27% |
| 11 | 65 | 32 | 15 | 25 | 4.3x | 54% | 4.3x | 54% |
| 12 | 43 | 25 | 35 | 33 | 1.7x | 19% | 1.7x | 19% |

### 2b. Hours per run

|  | v2-r1 | v2-r2 | v2-r3 | v2-r4 | CV |
|---|---|---|---|---|---|
| as recorded | 11.1 | 7.5 | 8.0 | 7.4 | 18% |
| to the first "done" of each story | 8.2 | 7.5 | 8.0 | 6.8 | 7% |

### 2c. Stories where the agent said "done" and was nudged on

| run | story | said done at (min) | went on for (min) | calls after | ended |
|---|---|---|---|---|---|
| v2-r1 | 10 | 32 | 171 | 504 | operator |
| v2-r4 | 4 | 57 | 35 | 97 | operator |

### 3. The gap between the slowest and the fastest run of each story, summed over the 11 stories

| spent on | hours | share of the gap |
|---|---|---|
| thinking | 3.3 | 40% |
| after the agent said done (nudged on) | 2.9 | 35% |
| tools (tests, builds, servers) | 0.7 | 9% |
| writing code and text | 0.6 | 8% |
| compaction | 0.4 | 5% |
| reading prompts and the rest | 0.2 | 3% |
| total | 8.1 | 100% |

### 4. Thinking by the size of the thought

| characters in the thought | calls | share of calls | share of all thinking |
|---|---|---|---|
| 0–300 | 5738 | 71% | 11% |
| 300–1,000 | 1223 | 15% | 13% |
| 1,000–3,000 | 698 | 9% | 23% |
| 3,000–10,000 | 314 | 4% | 30% |
| 10,000+ | 62 | 1% | 22% |

### 4b. Thinking per story run: share of calls with a thought of 300+ characters · all thinking · the largest thought (characters)

| story | v2-r1 | v2-r2 | v2-r3 | v2-r4 |
|---|---|---|---|---|
| 1 | 60% · 235k · 50k | 55% · 181k · 30k | 24% · 46k · 8k | 48% · 136k · 35k |
| 2 | 60% · 329k · 64k | 13% · 21k · 5k | 62% · 390k · 31k | 59% · 188k · 10k |
| 3 | 35% · 141k · 13k | 24% · 90k · 10k | 23% · 67k · 6k | 22% · 91k · 9k |
| 4 | 18% · 97k · 22k | 56% · 574k · 68k | 51% · 203k · 9k | 34% · 199k · 11k |
| 5 | 17% · 67k · 5k | 51% · 218k · 41k | 24% · 91k · 22k | 19% · 59k · 9k |
| 7 | 16% · 45k · 5k | 26% · 118k · 12k | 35% · 130k · 8k | 17% · 46k · 5k |
| 8 | 18% · 65k · 7k | 27% · 67k · 11k | 15% · 41k · 8k | 23% · 103k · 11k |
| 9 | 12% · 43k · 4k | 9% · 35k · 3k | 15% · 55k · 9k | 19% · 48k · 4k |
| 10 | 22% · 269k · 11k | 15% · 33k · 4k | 16% · 47k · 4k | 26% · 74k · 6k |
| 11 | 61% · 220k · 8k | 23% · 87k · 10k | 8% · 19k · 4k | 12% · 62k · 10k |
| 12 | 36% · 152k · 17k | 13% · 32k · 4k | 10% · 27k · 2k | 15% · 55k · 5k |

### 4c. What if no thought could exceed a cap (arithmetic on the recorded runs, not a measurement)

| cap, characters per call | hours removed (of 30.5) | median per-story CV (now 23%) | hours per run | CV of run totals |
|---|---|---|---|---|
| 2,000 | 4.0 | 19% | 7.1 6.2 7.2 6.1 | 7% |
| 8,000 | 1.3 | 21% | 7.8 7.0 7.7 6.7 | 6% |

### 5. Tool time by kind, all four runs

| kind | hours | calls | seconds each |
|---|---|---|---|
| e2e tests | 3.98 | 812 | 17.6 |
| integration tests | 1.41 | 334 | 15.2 |
| unit/component tests | 0.64 | 836 | 2.8 |
| dev server/curl/sleep | 0.34 | 96 | 12.9 |
| build/typecheck | 0.26 | 505 | 1.9 |
| install | 0.01 | 24 | 1.7 |
| shell (read/search/other) | 0.01 | 1302 | 0.0 |

### 5b. Test runs the agent made per story, and minutes of end-to-end tests

| story | v2-r1 runs | v2-r2 runs | v2-r3 runs | v2-r4 runs | v2-r1 e2e min | v2-r2 e2e min | v2-r3 e2e min | v2-r4 e2e min |
|---|---|---|---|---|---|---|---|---|
| 1 | 23 | 24 | 43 | 18 | 1 | 0 | 11 | 1 |
| 2 | 53 | 14 | 50 | 36 | 1 | 0 | 17 | 2 |
| 3 | 78 | 80 | 62 | 71 | 3 | 2 | 0 | 1 |
| 4 | 53 | 43 | 54 | 105 | 8 | 2 | 6 | 20 |
| 5 | 67 | 39 | 61 | 42 | 1 | 2 | 5 | 3 |
| 7 | 22 | 36 | 49 | 21 | 1 | 4 | 2 | 2 |
| 8 | 55 | 37 | 29 | 34 | 4 | 1 | 1 | 2 |
| 9 | 35 | 29 | 33 | 35 | 0 | 0 | 1 | 0 |
| 10 | 171 | 13 | 47 | 23 | 78 | 0 | 18 | 0 |
| 11 | 75 | 35 | 20 | 29 | 20 | 2 | 0 | 1 |
| 12 | 45 | 19 | 39 | 35 | 5 | 0 | 7 | 4 |

### 6. Run-to-run variation per story, by measure (stories 11 and 12 of v2-r1 were largely built inside its story 10)

| measure | median CV across stories | median slowest / fastest | worst |
|---|---|---|---|
| minutes, as recorded | 23% | 1.8x | 7.6x |
| minutes, to the first "done" | 23% | 1.8x | 5.4x |
| thinking, characters | 46% | 3.7x | 18.6x |
| code written, characters | 13% | 1.4x | 4.8x |
| model calls | 13% | 1.4x | 2.4x |
| test runs | 28% | 2.3x | 3.8x |
| tool minutes | 41% | 3.6x | 23.9x |
| tokens generated | 23% | 1.7x | 3.6x |
