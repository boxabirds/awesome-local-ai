
### 0. What is covered

| combination | runs | story conversations | model calls | tool calls | conversations with full text |
|---|---|---|---|---|---|
| FN gufo | 11 | 93 | 17178 | 17956 | 93 |
| FN mlx-serve | 7 | 53 | 13916 | 14646 | 53 |
| FN MTPLX | 4 | 35 | 14834 | 11804 | 35 |
| FN llama.cpp | 4 | 20 | 4509 | 4644 | 20 |
| 27B llama.cpp | 4 | 34 | 10871 | 11687 | 34 |
| Swift llama.cpp | 3 | 33 | 9248 | 10110 | 33 |
| Swift 1.5 llama.cpp | 6 | 47 | 9430 | 10485 | 47 |
| Opus 5.5 | 6 | 68 | 4905 | 5154 | 68 |
| Sonnet 5.5 | 6 | 53 | 2315 | 3782 | 53 |
| all | 51 | 436 | 87206 | 90268 | 436 |

### A. Every model call by what it did (share of the combination's calls)

| class | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| tool call, no visible text | 80% | 89% | 71% | 88% | 58% | 66% | 53% | 65% | 78% |
| tool call with text | 19% | 10% | 7% | 12% | 42% | 33% | 46% | 33% | 19% |
| stops with text | 1% | 0% | 22% | 0% | 0% | 0% | 1% | 2% | 3% |
| stops with nothing | 0% | 0% | 1% | 0% | 0% | 0% | 0% | 0% | 0% |
| model calls | 17178 | 13916 | 14834 | 4509 | 10871 | 9248 | 9430 | 4831 | 2315 |

### B. Every tool call by tool (share)

| tool | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| bash | 49% | 55% | 65% | 60% | 49% | 52% | 53% | 92% | 51% |
| read | 20% | 20% | 16% | 13% | 28% | 21% | 19% | 4% | 2% |
| edit | 19% | 16% | 12% | 15% | 15% | 20% | 18% | 0% | 21% |
| write | 12% | 9% | 7% | 11% | 7% | 7% | 11% | 4% | 26% |
| other tools | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| tool calls | 17956 | 14646 | 11804 | 4644 | 11687 | 10110 | 10485 | 5072 | 3782 |

### C. Every bash command by purpose (share of commands; first matching rule wins)

| purpose | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| run tests: end-to-end | 16% | 18% | 14% | 15% | 14% | 22% | 17% | 17% | 27% |
| run tests: integration | 7% | 4% | 4% | 7% | 6% | 7% | 10% | 5% | 5% |
| run tests: unit and component | 21% | 17% | 15% | 19% | 16% | 18% | 20% | 20% | 16% |
| build, typecheck, lint | 12% | 7% | 5% | 7% | 6% | 6% | 7% | 9% | 5% |
| install or look up packages | 1% | 1% | 0% | 1% | 1% | 0% | 1% | 1% | 0% |
| git: change history or tree | 2% | 2% | 1% | 2% | 1% | 2% | 2% | 4% | 2% |
| git: look | 2% | 3% | 3% | 3% | 3% | 2% | 2% | 3% | 8% |
| processes and ports | 2% | 1% | 1% | 1% | 3% | 2% | 4% | 1% | 0% |
| servers, requests, waiting | 1% | 1% | 1% | 1% | 3% | 1% | 5% | 1% | 0% |
| write files through the shell | 3% | 4% | 3% | 4% | 6% | 6% | 4% | 15% | 13% |
| run code | 2% | 1% | 1% | 2% | 3% | 2% | 2% | 1% | 1% |
| read and search files | 32% | 42% | 51% | 38% | 39% | 32% | 26% | 24% | 22% |
| other | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| bash commands | 8728 | 8008 | 7623 | 2796 | 5749 | 5253 | 5530 | 4650 | 1916 |

### C2. Tool time by purpose (share of bash seconds)

| purpose | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| run tests: end-to-end | 62% | 74% | 46% | 68% | 66% | 74% | 63% | 67% | 80% |
| run tests: integration | 18% | 3% | 21% | 11% | 9% | 13% | 13% | 12% | 7% |
| run tests: unit and component | 10% | 7% | 13% | 12% | 5% | 3% | 4% | 13% | 10% |
| build, typecheck, lint | 4% | 4% | 2% | 3% | 2% | 2% | 1% | 3% | 2% |
| install or look up packages | 0% | 1% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| git: change history or tree | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| git: look | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| processes and ports | 3% | 2% | 4% | 1% | 3% | 3% | 6% | 0% | 0% |
| servers, requests, waiting | 1% | 4% | 7% | 3% | 14% | 1% | 8% | 1% | 0% |
| write files through the shell | 0% | 1% | 5% | 1% | 1% | 4% | 4% | 1% | 1% |
| run code | 0% | 0% | 1% | 2% | 0% | 0% | 0% | 0% | 0% |
| read and search files | 0% | 4% | 0% | 0% | 1% | 0% | 0% | 0% | 0% |
| other | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| bash hours | 13.9 | 13.2 | 3.3 | 2.6 | 3.8 | 13.0 | 12.3 | 5.1 | 5.4 |

### D. Every tool result by outcome (share)

| outcome | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| edit refused: the text to replace was not found | 1% | 2% | 1% | 1% | 2% | 2% | 1% | 0% | 0% |
| read or write refused | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| test run: reports failing tests | 7% | 7% | 6% | 8% | 5% | 10% | 9% | 9% | 8% |
| test run: no failure reported | 14% | 15% | 15% | 17% | 13% | 14% | 15% | 30% | 16% |
| other command: exited non-zero | 2% | 1% | 2% | 2% | 2% | 2% | 3% | 1% | 3% |
| other command: exited zero | 26% | 32% | 42% | 34% | 30% | 26% | 26% | 52% | 24% |
| read, edit or write: done | 50% | 43% | 34% | 39% | 49% | 46% | 46% | 8% | 49% |
| never returned | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| tool calls | 17956 | 14646 | 11804 | 4644 | 11687 | 10110 | 10485 | 5072 | 3782 |

### D2. Test runs that report failing tests: what exit status the agent's tool saw

|  | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| reported failures, tool saw success (exit zero) | 1169 | 959 | 708 | 352 | 605 | 993 | 918 | 443 | 291 |
| reported failures, tool saw failure | 24 | 4 | 2 | 16 | 4 | 0 | 32 | 0 | 0 |
| share seen as success | 98% | 100% | 100% | 96% | 99% | 100% | 97% | 100% | 100% |

### E. A story, in medians per combination

| per story (median) | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 | range across the seven Qwen combinations |
|---|---|---|---|---|---|---|---|---|---|---|
| minutes | 39 | 98 | 65 | 135 | 80 | 60 | 36 | 17 | 12 | 36–135 |
| model calls | 176 | 274 | 302 | 215 | 274 | 252 | 185 | 62 | 45 | 176–302 |
| tool calls | 180 | 299 | 317 | 219 | 306 | 283 | 205 | 68 | 75 | 180–317 |
| bash commands | 88 | 149 | 193 | 135 | 134 | 139 | 92 | 58 | 38 | 88–193 |
| file reads (read tool) | 40 | 52 | 46 | 32 | 100 | 70 | 34 | 3 | 1 | 32–100 |
| edits | 36 | 39 | 35 | 32 | 46 | 58 | 34 | 0 | 14 | 32–58 |
| whole-file writes | 22 | 23 | 24 | 24 | 22 | 21 | 22 | 0 | 19 | 21–24 |
| test runs | 34 | 59 | 58 | 56 | 58 | 59 | 44 | 24 | 15 | 34–59 |
| tool calls that failed | 6 | 9 | 10 | 8 | 9 | 10 | 7 | 0 | 2 | 6–10 |
| stops | 1 | 1 | 3 | 1 | 1 | 1 | 1 | 1 | 1 | 1–3 |
| thinking, thousand characters | 103 | 375 | 430 | 319 | 487 | 311 | 162 | 0 | 0 | 103–487 |

### F. Ratios, by combination

| ratio | FN gufo | FN mlx-serve | FN MTPLX | FN llama.cpp | 27B llama.cpp | Swift llama.cpp | Swift 1.5 llama.cpp | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|---|---|---|---|---|
| tool calls per model call | 1.05 | 1.05 | 0.80 | 1.03 | 1.08 | 1.09 | 1.11 | 1.05 | 1.63 |
| model calls making more than one tool call | 4% | 5% | 1% | 3% | 7% | 8% | 8% | 5% | 31% |
| tool calls that fail | 4% | 4% | 4% | 4% | 4% | 4% | 5% | 1% | 3% |
| edits refused | 4% | 12% | 10% | 7% | 11% | 9% | 4% | 0% | 0% |
| edits per whole-file write | 1.5 | 1.8 | 1.7 | 1.3 | 2.0 | 2.8 | 1.6 | 0.0 | 0.8 |
| bash commands per read-tool call | 2.4 | 2.7 | 3.9 | 4.6 | 1.7 | 2.5 | 2.8 | 23.5 | 25.9 |
| bash commands that are test runs | 43% | 39% | 33% | 41% | 36% | 47% | 46% | 42% | 47% |
| thinking per call that thinks, median characters | 137 | 447 | 303 | 338 | 364 | 298 | 227 | 0 | 0 |
