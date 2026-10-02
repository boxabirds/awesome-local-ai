# Performance findings: where tokens and time go that need not

Every number here is printed by `python3 detect_performance.py conv_full.db` (standard library only, deterministic: two runs give byte-identical output). The tables below are cut-down copies of that output; the script prints the full versions with every column.

## Population and method

- **436 story conversations**, 87,206 model calls, 90,268 tool calls, all read from complete logs (`conv_full.db`).
- **The 18 unpublished conversations** (still running or abandoned when fetched) are counted like any other in every table. They have no wall time or held-out result, and nothing here uses either. The census table in the script shows how many each group has (0 to 5).
- **Groups** (stories / runs): Flash/gufo 93/11, Flash/mlx-serve 53/7, Flash/MTPLX 35/4, Flash/llama.cpp 20/4, 27B/llama.cpp 34/4, Swift 27B 33/3, Swift 1.5 27B 47/6 (315 Qwen-family stories); Opus 5.5 68/6 and Sonnet 5.5 53/6 as the contrast.
- **Seconds are measured only where the log has times.** 363 of 436 stories have a start and end time for every tool call. The other 73 have none: 24 of 35 MTPLX, 23 of 34 27B/llama.cpp, 6 of 20 Flash/llama.cpp and 20 of 68 Opus. Counts, characters and tokens come from all 436.
- **Output tokens are usable for Qwen only.** Claude's recorded output tokens are partial counts (91,247 tokens against 10.7 million characters written by Opus), and Claude's thinking text is withheld. For Claude, use the character columns.
- **Bash commands are classified by a small parser**: leading `cd` stripped, heredoc bodies and quoted strings blanked, the command split into segments, each segment classified by its head word. A compound command takes the kind of its highest-ranking segment (tests, then install, server, build, git, write, script, read). I read 25 random commands of each of 14 kinds: 23 to 25 of 25 correct in each. 64 commands (0.1%) fall in "other".
- **Precision**: for each detector I read 25 hits drawn with a fixed seed (`--samples` prints them). The result is given under each finding.
- **Nothing here is an estimated saving.** Each finding gives calls, characters, tokens or seconds that were recorded. Where a quantity would have to be guessed (for example the seconds a rewrite cost), it is not given.

## Census: what the data contains

Where the time went (timed stories):

| group | model generating | tools running | compaction | waiting for harness | hours covered |
|---|---|---|---|---|---|
| Flash/gufo | 77.7% | 18.1% | 4.1% | 0.1% | 76.6 |
| Flash/mlx-serve | 77.5% | 14.9% | 6.9% | 0.6% | 88.2 |
| Flash/MTPLX (11 of 35 stories) | 54.5% | 12.8% | 6.4% | 26.3% | 26.0 |
| Flash/llama.cpp (14 of 20) | 81.1% | 8.1% | 10.2% | 0.6% | 31.4 |
| 27B/llama.cpp (11 of 34) | 73.5% | 19.5% | 7.0% | 0.0% | 19.4 |
| Swift 27B | 63.3% | 32.0% | 4.7% | 0.0% | 40.5 |
| Swift 1.5 27B | 63.2% | 32.0% | 4.7% | 0.1% | 38.3 |
| Opus 5.5 (48 of 68) | 34.3% | 65.6% | 0 | 0.1% | 17.2 |
| Sonnet 5.5 | 13.5% | 48.8% | 0 | 37.7% | 17.4 |

"Model generating" runs from the previous event to the arrival of the complete reply: reading the prompt, thinking and writing. Sonnet's 37.7% waiting is two gaps of 10,065 s and 12,438 s after the agent had already said the story was done. MTPLX's 26.3% is mostly one story (canvas-pi-03 story 11, 19,473 s idle).

**The pattern common to every Qwen group: the model, not the tools, is where the time goes** (55% to 81%). For Claude it is the reverse. So for Qwen the levers that matter most are the ones that cut what the model has to write and re-read: findings 1 to 5.

Tool time by kind (share of each group's tool time): browser tests take 46% to 72% in every Qwen group (48.7 of 81.7 tool hours overall); integration tests 2.5% to 22%; servers and waiting 4% to 16%; everything else is under 11%. The read, edit and write tools take no measurable time.

What the census turned up that nobody listed:
- A prompt cache capped at 81,920 tokens in two mlx-serve runs (finding 8).
- One story with 3,124 "Continue" messages (finding 9).
- 243 MTPLX compactions that produced no summary (finding 7).
- Agents fetching Ubuntu `.deb` packages and compiling libraries under `/tmp` to make a browser run: 43 commands, 38 of them in Swift 1.5 27B (v2-r2 story 11, v2-r3 story 5), 5 in 27B/llama.cpp. This is a security matter more than a performance one; I only counted it.
- Opus edits almost entirely through bash: 4 edit-tool calls against 2,185 bash commands that change files.
- The client saves the full output of a cut-off bash result to a log file; no command in any conversation ever opened one.

---

## 1. Whole files are written again when a small edit would do, and writing is the largest use of output

**What it is.** The `write` tool replaces a whole file. In every Qwen group about three in ten writes are of a file the agent had already read, edited or written in the same story. Where the file's previous content is known, just over half of what is re-emitted is lines that were already there.

**Detector.** Each story's file calls are replayed in order, keeping the last known content of every file (from a write, an applied edit, or a whole read; content is marked unknown after any bash command that could change the file). A "rewrite" is a successful write to a path already touched in the story. "Unchanged" characters are those on lines present in the previous content.

| group | whole-file writes | rewrites | share | characters emitted in rewrites | rewrites with previous content known | their characters | of which unchanged lines | unchanged share | stories | runs |
|---|---|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 2,191 | 673 | 30.7% | 3,287,744 | 604 | 3,060,588 | 1,901,825 | 62.1% | 89/93 | 11/11 |
| Flash/mlx-serve | 1,282 | 338 | 26.4% | 2,484,642 | 262 | 2,042,726 | 912,591 | 44.7% | 51/53 | 7/7 |
| Flash/MTPLX | 840 | 281 | 33.5% | 1,777,080 | 202 | 1,331,440 | 638,646 | 48.0% | 31/35 | 3/4 |
| Flash/llama.cpp | 532 | 182 | 34.2% | 981,948 | 133 | 694,862 | 317,893 | 45.7% | 20/20 | 4/4 |
| 27B/llama.cpp | 875 | 265 | 30.3% | 1,074,649 | 215 | 852,877 | 439,811 | 51.6% | 30/34 | 4/4 |
| Swift 27B | 728 | 193 | 26.5% | 845,540 | 164 | 760,336 | 354,091 | 46.6% | 33/33 | 3/3 |
| Swift 1.5 27B | 1,141 | 382 | 33.5% | 1,691,700 | 349 | 1,522,416 | 978,756 | 64.3% | 43/47 | 6/6 |
| Opus 5.5 | 204 | 10 | 4.9% | 55,827 | 0 | - | - | - | 10/68 | 6/6 |
| Sonnet 5.5 | 975 | 72 | 7.4% | 153,839 | 11 | 18,890 | 6,402 | 33.9% | 34/53 | 6/6 |

Qwen total: 2,314 rewrites, 12.1 million characters emitted; in the 1,929 with known previous content, 5.54 of 10.27 million characters (54%) were unchanged lines. 158 rewrites were 90% or more unchanged. 295 files were written three or more times in a story (1,063 writes, 5.06 million characters).

Why it matters for time: calls that end in a `write` are the largest single consumer of output in every Qwen group, 18% to 40% of output tokens (14.9 of 53.9 million) and 18% to 35% of generating time. Calls ending in an `edit` take another 15% to 24% of output tokens.

**Qwen-specific?** Yes at this rate: 26% to 35% of writes in every Qwen group against 5% and 7% for Claude.

**Precision.** By construction (path already touched; character counts from the stored content). 25 of 25 sampled hits were rewrites with the stated counts.

**Examples.**
- Swift 1.5 27B, v2-r1, story 4: `src/worker/board-store.ts: wrote 6,875 chars, 6,174 on lines already in the file (89.8%)`
- Flash/gufo, canvas-gufo-r2, story 11: `tests/e2e/pen-stroke.spec.ts: wrote 11,178 chars, 9,916 on lines already in the file (88.7%)`
- Worst file: `src/worker/room-machine.ts` written whole 8 times, 89,328 characters (Flash/MTPLX, canvas-pi-02, story 4).

**Use.** Performance lever, high confidence that the waste is real: the 5.54 million unchanged characters are measured. What is not measured is how many seconds they cost, or whether steering the model to `edit` would raise the failed-edit count (finding 5). A client-side rule ("this file exists; use edit") or a prompt line is the cheap test.

## 2. A few very long thinking passes hold a third of all thinking

**What it is.** Thinking is 42% to 70% of every character a Qwen model produces. The median call thinks 137 to 447 characters, but 1% to 4% of calls think 10,000 characters or more, and those calls hold 27% to 49% of all thinking.

**Detector.** Calls whose thinking is 10,000 characters or more; their output tokens; their generating seconds in timed stories.

| group | model calls | median thinking chars | p99 | max | calls of 10,000+ | share of calls | share of thinking chars | their output tokens | share of output tokens | share of generating time | stories | runs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 17,178 | 137 | 9,929 | 125,421 | 169 | 1.0% | 26.8% | 1,024,635 | 11.3% | 12.5% | 46/93 | 11/11 |
| Flash/mlx-serve | 13,916 | 447 | 14,858 | 106,314 | 301 | 2.2% | 30.2% | 1,909,197 | 17.4% | 17.1% | 48/53 | 6/7 |
| Flash/MTPLX | 14,834 | 301 | 15,726 | 99,964 | 300 | 2.0% | 33.2% | 1,761,505 | 21.3% | 24.2% | 32/35 | 4/4 |
| Flash/llama.cpp | 4,509 | 338 | 16,229 | 84,683 | 94 | 2.1% | 35.1% | 653,835 | 19.7% | 18.1% | 19/20 | 4/4 |
| 27B/llama.cpp | 10,871 | 364 | 26,918 | 125,669 | 412 | 3.8% | 48.9% | 3,268,249 | 34.0% | 31.7% | 33/34 | 4/4 |
| Swift 27B | 9,248 | 298 | 13,238 | 115,649 | 135 | 1.5% | 31.0% | 1,093,623 | 17.5% | 17.9% | 32/33 | 3/3 |
| Swift 1.5 27B | 9,430 | 227 | 11,605 | 108,376 | 121 | 1.3% | 30.5% | 994,281 | 15.3% | 15.8% | 34/47 | 5/6 |

Qwen total: 1,532 calls, 10.7 million output tokens (20% of all). Claude's thinking is withheld, so no comparison is possible.

What the long passes are: of 25 read, all were real planning or debugging reasoning (restating the spec, tracing a failing test), not noise. Repetition inside one pass is small (0.4% to 2.2% of their characters sit on lines repeated from earlier in the same pass) except in 27B/llama.cpp (4.7%), which has the only five calls where over 20% is repeated, all in canvas-pi-03 story 4; the worst is 119,505 characters with 112,888 on repeated lines.

**Examples.**
- 27B/llama.cpp, canvas-pi-04, story 9: call 25, 71,368 characters, 20,068 output tokens, then one read. Begins `Now I have the full picture. Let me start implementing. I'll work through the tasks in or`
- Flash/mlx-serve, v2-r2, story 3: call 52, 35,696 characters, then a write. Begins `Awareness renews local state every outdatedTimeout/2 = 15000 ms (15s) via setLocalState`

**Use.** Performance lever, medium confidence. A thinking budget per call would cap the tail; whether quality suffers is not measurable here. The 27B loop is rare (one story) but cost five calls of 40,000 to 120,000 characters.

## 3. The same file is read again and again, often byte for byte

**What it is.** Nearly half of all read-tool calls in Qwen stories are of a file already read in the same story, and a sixth of all characters the read tool returns are exact copies of a result already returned.

**Detector.** Per story, a read-tool call on a path already read is a repeat. It is "identical" when its result text equals a result already returned for that path in the story.

| group | read-tool calls | repeat reads | share | characters returned by repeats | identical results | their characters | share of all read characters | stories (identical) | runs |
|---|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 3,632 | 1,140 | 31.4% | 3,196,932 | 252 | 1,291,991 | 8.4% | 54/93 | 9/11 |
| Flash/mlx-serve | 2,984 | 1,403 | 47.0% | 8,211,481 | 681 | 5,970,960 | 32.0% | 42/53 | 7/7 |
| Flash/MTPLX | 1,904 | 1,012 | 53.2% | 5,372,075 | 309 | 2,706,996 | 24.7% | 28/35 | 4/4 |
| Flash/llama.cpp | 608 | 181 | 29.8% | 752,868 | 75 | 467,751 | 14.9% | 14/20 | 3/4 |
| 27B/llama.cpp | 3,270 | 1,993 | 60.9% | 6,522,728 | 317 | 1,237,260 | 10.1% | 26/34 | 3/4 |
| Swift 27B | 2,109 | 1,048 | 49.7% | 3,107,172 | 119 | 415,328 | 5.1% | 25/33 | 3/3 |
| Swift 1.5 27B | 1,943 | 636 | 32.7% | 2,417,185 | 237 | 1,230,430 | 13.2% | 33/47 | 5/6 |
| Opus 5.5 | 198 | 19 | 9.6% | 281,874 | 4 | 0 | 0.0% | 3/68 | 3/6 |
| Sonnet 5.5 | 74 | 1 | 1.4% | 12,497 | 0 | 0 | 0.0% | 0/53 | 0/6 |

Qwen total: 7,413 repeat reads of 16,450 (45%), returning 29.6 million characters; 1,990 identical results, 13.3 million characters. Not every repeat is waste: 21% to 68% of reads return only part of a file, and files change between reads. The identical ones are the firm figure.

Related measurements:
- **Across all tools**, 2,283 Qwen results of 500 characters or more were identical to an earlier result in the same story: 15.8 million characters, 3.6% to 19.8% of everything tools returned (Claude: 2 results).
- **Bash reads on top**: 8,688 Qwen bash commands only read files (`cat`, `sed -n`, `head`, `tail`), 34.2 million characters, 22% to 60% of file-reading calls; 7,704 files read that way had already been read in the story.
- **The spec**: 864 repeat reads of a file under `spec/` in the same story across Qwen groups (stories affected 44% to 89% by group); `spec/stories/<story>/design.md` alone accounts for 262 read results of 20,000 characters or more (6.8 million characters).
- **After a compaction**, the next ten tool calls contain 0.5 to 2.6 read-tool calls on a file read before it (796 in total, 3.9 million characters). The reading share of those ten calls is about the same as at any other time, so there is no special burst, only a steady re-read.
- Worst cases: `src/client/App.tsx` read 35 times in one story (Flash/gufo, v2-r1, story 10); `src/worker/board-room.ts` 26 times (27B/llama.cpp, canvas-pi-03, story 4). 301 files were read six or more times in a story.

**Qwen-specific?** Yes: every Qwen group 30% to 61%, Claude 1% and 10%. (Claude reads mostly through bash, where 1,141 already-read files were read again, so it is not free of this either.)

**Precision.** Exact by construction (same path, equal text). 23 of 25 `bash_file_read` samples were plain file reads; 2 also grep.

**Examples.**
- Flash/mlx-serve, canvas-mlx-02, story 12: `spec/stories/012-drop-images-onto-the-board/prd.md (11,445 chars; first returned by tool call 0, again by 62)`
- 27B/llama.cpp, canvas-pi-02, story 4: `playwright.config.ts (2,007 chars; first returned by tool call 26, again by 376)`

**Use.** Performance lever, high confidence in the count. A client could answer an identical re-read with "unchanged since tool call N" at no risk, since the detector's condition (equal text) is exactly what it would check. The larger class (repeat reads of changed or partial content) needs a design decision and is only counted here.

## 4. Three in four bash commands begin by changing into the directory they are already in

**What it is.** The agent's shell starts in the workspace. Qwen models still prefix commands with `cd <absolute workspace path> &&`, or even `cd "$(pwd)" &&`.

**Detector.** A bash command whose first word is `cd` and whose target is the story's workspace path, `$(pwd)`, `$PWD`, `.` or `$(git rev-parse --show-toplevel)`. Characters are the length of that prefix.

| group | bash commands | absolute workspace path | `$(pwd)` / `$PWD` / `.` | share of commands | characters on the prefix | share of all bash command characters | stories | runs |
|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 8,728 | 4,259 | 939 | 59.6% | 526,007 | 22.9% | 83/93 | 11/11 |
| Flash/mlx-serve | 8,008 | 7,050 | 294 | 91.7% | 821,012 | 21.2% | 52/53 | 7/7 |
| Flash/MTPLX | 7,623 | 5,462 | 405 | 78.1% | 658,828 | 23.0% | 35/35 | 4/4 |
| Flash/llama.cpp | 2,796 | 2,120 | 235 | 84.2% | 269,897 | 23.6% | 20/20 | 4/4 |
| 27B/llama.cpp | 5,749 | 3,532 | 58 | 62.4% | 418,797 | 21.0% | 32/34 | 4/4 |
| Swift 27B | 5,253 | 3,284 | 0 | 62.5% | 416,188 | 21.4% | 29/33 | 3/3 |
| Swift 1.5 27B | 5,530 | 4,279 | 0 | 77.4% | 504,532 | 23.0% | 43/47 | 6/6 |
| Opus 5.5 | 4,723 | 318 | 0 | 6.7% | 25,509 | 0.3% | 42/68 | 6/6 |
| Sonnet 5.5 | 1,916 | 674 | 0 | 35.2% | 53,964 | 4.9% | 50/53 | 6/6 |

Qwen total: 32,009 of 43,687 commands (73%), 3.6 million characters, over a fifth of every character of bash the models wrote. A further 892,410 characters went on the absolute workspace prefix in 7,869 read/edit/write paths.

The prefix does nothing: Qwen read commands without it hit "No such file" 2.5% of the time (132 of 5,357), with it 3.1% (429 of 14,056). The habit is set per story: in 32% to 85% of stories over 90% of commands carry it, and in 3% to 25% almost none do.

The workspace path is long because the harness names it after the whole combination (about 115 characters, for example `~/.vidi-bench/work/qwen__3.8-swift-1.5__27b__ubuntu__nvidia4090__llamacpp-pi__benchmarks__vidi__v2-r1/workspace`).

**Qwen-specific?** Shared in kind, Qwen-specific in rate (60% to 92% against 7% and 35%). For Claude Code the shell keeps its directory between commands, so some of its prefixes are a real return from elsewhere. `cd "$(pwd)"` appears only in the five non-Swift Qwen groups (1,931 times) and never in Swift or Claude.

**Precision.** 25 of 25.

**Examples.**
- Flash/gufo, v2-r2, story 3: `cd "$(pwd)" && timeout 180 npx playwright test tests/e2e/collaboration.spec.ts --grep "TC-27" --project=chromium 2>&1 | tail -10`
- Flash/gufo, v2-r5, story 8: `cd <ws> && npm run test:component 2>&1 | tail -30` (where `<ws>` is the 115-character path)

**Use.** Performance lever, high confidence, and the cheapest to pull: a short workspace path (a symlink such as `/w`) cuts the cost without changing the model, and one line in the prompt ("commands already run in the workspace; do not cd") tests whether the habit can be removed. The 3.6 million characters are measured; the tokens and seconds they cost are not.

## 5. One edit in fourteen fails because the model misremembers the file

**What it is.** The `edit` tool needs the exact old text. It is not found (or not unique) in 3% to 11% of Qwen edit calls (958 of 13,485). Each failure costs a whole model call, and four in five are followed by a look at the file before the retry.

**Detector.** An edit call that returned an error whose text says the old text could not be found or was not unique. The cause comes from the replay in finding 1: the failing old text is compared with the file's last known content.

| group | edit calls | failed | rate | characters of arguments wasted | calls whose only tool calls were failed edits | their output tokens | followed by a look or rewrite | rate with one replacement | rate with several | stories | runs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 3,386 | 110 | 3.2% | 177,528 | 110 | 84,784 | 96 | 2.6% | 5.6% | 61/93 | 10/11 |
| Flash/mlx-serve | 2,351 | 252 | 10.7% | 678,392 | 250 | 312,179 | 209 | 7.2% | 14.9% | 44/53 | 6/7 |
| Flash/MTPLX | 1,399 | 116 | 8.3% | 266,490 | 116 | 132,013 | 93 | 6.2% | 10.6% | 27/35 | 4/4 |
| Flash/llama.cpp | 707 | 44 | 6.2% | 99,559 | 43 | 41,657 | 40 | 3.9% | 10.8% | 16/20 | 4/4 |
| 27B/llama.cpp | 1,764 | 186 | 10.5% | 312,345 | 167 | 203,709 | 130 | 10.5% | 10.7% | 26/34 | 3/4 |
| Swift 27B | 2,013 | 167 | 8.3% | 297,522 | 148 | 152,026 | 125 | 7.6% | 9.5% | 26/33 | 3/3 |
| Swift 1.5 27B | 1,865 | 83 | 4.5% | 189,544 | 72 | 85,078 | 78 | 2.8% | 7.7% | 29/47 | 4/6 |
| Opus 5.5 | 4 | 0 | - | 0 | 0 | 0 | 0 | - | - | 0/68 | 0/6 |
| Sonnet 5.5 | 795 | 2 | 0.3% | 3,885 | 0 | 0 | 1 | 0.3% | - | 2/53 | 2/6 |

Qwen total: 958 failures; 906 model calls did nothing else, costing 1,011,446 output tokens; 771 failures were followed by a read, a bash look or a whole rewrite, and those looks returned 821,648 characters.

Why they fail (share of each group's failures): the old text is nowhere in the file in 22% to 51%, and starts like the file then diverges in 11% to 31%. Whitespace-only differences are 0% to 4.5%. The rest is mostly undetermined because the file's content was not known to the replay (18% to 44%). So the dominant cause is the model writing old text from memory that the file does not contain. I checked 8 "nowhere in the file" cases against the nearest line of the file: 7 were plainly misremembered (for example old text `// Handle pointerdown outside to end editing` against the file's `// Handle outside pointerdown to end editing`), 1 was a replay error.

Chains are short: 651 single failures then success, 63 double, 12 triple, 1 of four. A call with several replacements fails more often than a call with one in all seven groups, and a failure in one replacement rejects the whole call.

A further 107 Qwen edits failed for other reasons: 61 where the replacement equalled the old text or edits overlapped, 19 attempts to edit the read-only spec, 16 on a missing file, 11 other.

**Qwen-specific?** Yes: 3% to 11% against 0.3% for Sonnet.

**Precision.** 25 of 25 are edits rejected for old text not found (2 of them "found 2 occurrences").

**Examples.**
- Swift 1.5 27B, v2-r2, story 2: `Could not find the exact text in tests/e2e/helpers/board.ts.` Old text `export async function getOriginMarker(page: Page): Promise<Locator | null> {`; the file has `export function getOriginMarker(page: Page): Locator {`
- Swift 1.5 27B, v2-r2, story 10: `Found 2 occurrences of edits[2] in tests/component/Connector.test.tsx. Each oldText must be unique.`

**Use.** Performance lever, medium confidence. Two things the tool could do: return the nearest matching lines with the error (the model then would not need the follow-up look that 771 failures triggered), and apply the replacements that do match in a multi-replacement call. Note the tension with finding 1: rewrites avoid this failure, so the two should be changed together.

## 6. Test output is cut, then the same test is run again to see the rest

**What it is.** 92% to 98% of Qwen test commands pipe their output through `tail`, `head` or `grep`. In 3% to 7.5% of them the agent then runs the identical test again, with nothing changed, only to filter the output differently.

**Detector.** A test command whose test part equals that of an earlier test command in the story, with a different output filter, and no file written, edited, installed or git-reverted in between.

| group | test commands | per story median / p90 / max | output cut | same test, other filter | share | seconds (timed) | stories | runs | whole-suite share | whole-suite hours / targeted hours (timed) |
|---|---|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 3,148 | 31 / 53 / 131 | 97.5% | 236 | 7.5% | 5,677 | 67/93 | 11/11 | 46.9% | 7.4 / 5.1 |
| Flash/mlx-serve | 2,323 | 41 / 74 / 104 | 94.3% | 69 | 3.0% | 484 | 37/53 | 7/7 | 37.0% | 4.9 / 5.9 |
| Flash/MTPLX | 1,649 | 39 / 85 / 252 | 98.5% | 54 | 3.3% | 291 | 21/35 | 3/4 | 48.8% | 1.7 / 1.0 |
| Flash/llama.cpp | 903 | 47 / 73 / 108 | 95.7% | 32 | 3.5% | 157 | 13/20 | 4/4 | 33.2% | 0.8 / 1.4 |
| 27B/llama.cpp | 1,607 | 46 / 88 / 149 | 96.0% | 120 | 7.5% | 1,213 | 26/34 | 3/4 | 35.0% | 2.4 / 0.7 |
| Swift 27B | 1,991 | 54 / 104 / 129 | 97.7% | 143 | 7.2% | 2,929 | 32/33 | 3/3 | 32.9% | 6.2 / 5.1 |
| Swift 1.5 27B | 2,121 | 39 / 76 / 147 | 92.4% | 149 | 7.0% | 2,951 | 32/47 | 5/6 | 32.8% | 4.3 / 5.1 |
| Opus 5.5 | 1,495 | 19 / 39 / 58 | 96.9% | 13 | 0.9% | 293 | 11/68 | 5/6 | 46.4% | 3.3 / 3.7 |
| Sonnet 5.5 | 662 | 11 / 17 / 37 | 100% | 6 | 0.9% | 281 | 5/53 | 3/6 | 63.4% | 3.9 / 2.2 |

Qwen total: 803 such re-runs, 13,702 measured seconds in timed stories. Also measured:
- **Qwen runs two to four times as many test commands per story as Claude** (median 31 to 54 against 11 and 19), and 40% to 52% of them report a failure.
- **Exactly identical re-runs are rare**: 77 in all Qwen stories (0.1% to 1.0%), 898 seconds. Not a lever.
- **Whole-suite runs** are a third to a half of test commands and take 0.8 to 7.4 hours per group; whether a targeted run would have served is not determinable from the log.
- A browser test command takes 8 to 37 s at the median and 65 to 173 s at the 90th percentile.

**Qwen-specific?** The cutting is shared (Claude cuts just as much). The re-run to see more is Qwen-specific: 3% to 7.5% against 0.9%.

**Precision.** 25 of 25 are the same test with a different filter and nothing changed; in 23 the second filter asks for more detail than the first.

**Examples.**
- Swift 1.5 27B, v2-r1, story 2: `npm run test:component 2>&1 | tail -40` then `npm run test:component 2>&1 | grep "FAIL\|×" | head -20`
- 27B/llama.cpp, canvas-pi-02, story 4: `npm run test:integration 2>&1 | tail -12` then `npm run test:integration 2>&1 | grep -B2 -A25 "FAIL\|✗\|×" | head -80`

**Use.** Performance lever, medium confidence. A test wrapper that writes the full output to a known file and prints the summary plus the failures would remove the reason to re-run; the 13,702 seconds are the measured cost on timed stories.

## 7. Compaction: at about 114,000 prompt tokens, 77 to 311 seconds each

**What it is.** The pi client summarises the conversation when the prompt reaches its threshold. Claude Code recorded none.

| group | compactions | stories | per story median / p90 / max | no summary produced | summary chars median | seconds each median / p90 | total hours | prompt tokens before / after (median) |
|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 114 | 80/93 | 1 / 2 / 5 | 0 | 7,068 | 92 / 155 | 3.2 | 114,072 / 28,620 |
| Flash/mlx-serve | 190 | 50/53 | 3 / 6 / 10 | 0 | 13,658 | 117 / 174 | 6.2 | 113,949 / 29,216 |
| Flash/MTPLX | 413 | 34/35 | 5 / 24 / 94 | 243 | 0 | 87 / 162 | 1.8 (timed only) | 114,334 / 31,639 |
| Flash/llama.cpp | 50 | 20/20 | 2 / 5 / 5 | 0 | 12,036 | 311 / 490 | 3.7 | 114,195 / 29,404 |
| 27B/llama.cpp | 148 | 32/34 | 3 / 9 / 12 | 0 | 15,706 | 100 / 123 | 1.4 (timed only) | 113,895 / 31,289 |
| Swift 27B | 93 | 32/33 | 3 / 4 / 7 | 0 | 10,594 | 81 / 95 | 1.9 | 114,103 / 30,477 |
| Swift 1.5 27B | 92 | 41/47 | 1 / 4 / 7 | 0 | 10,169 | 77 / 98 | 1.8 | 114,033 / 30,441 |

- Compaction takes 4% to 10% of story time in every Qwen group (20 measured hours).
- Each one throws away the prompt cache: the first call after reads about 29,000 tokens afresh (18.5 million tokens over 657 timed compactions).
- **MTPLX is the outlier**: 243 of its 413 compactions produced no summary, and one story had 94. 69 of its compactions were forced by overflow rather than the threshold (4 in 27B, 2 in mlx-serve, none elsewhere).
- After a compaction the first tool call is a read in 30% to 42% of cases, an edit or write in 28% to 42%, a test in 17% to 30%: the agent mostly carries on.

**Use.** Something to know, and a lever by way of findings 1 to 4: anything that makes the prompt grow more slowly makes compactions rarer. gufo, with the lowest share of identical re-reads among the Flash groups, compacts once per story at the median; mlx-serve and 27B three times.

## 8. mlx-serve re-read up to 30,000 prompt tokens on one call in sixteen (two early runs)

**What it is.** On most engines a new call reuses the whole previous prompt from cache. In mlx-serve runs canvas-mlx-01 and canvas-mlx-02, once the prompt passed 81,920 tokens the cache served exactly 81,920 and the rest was read again on every such call.

**Detector.** A call (not the first after a compaction) where the tokens served from cache are at least 1,000 fewer than the previous call's whole prompt.

| group | calls checked | cache misses | share | old prompt tokens read again | generating hours of those calls | share of generating time | stories | runs |
|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 17,178 | 1 | 0.0% | 96,892 | 0.0 | 0.0% | 1/93 | 1/11 |
| Flash/mlx-serve | 13,916 | 848 | 6.1% | 13,780,523 | 7.5 | 11.0% | 18/53 | 5/7 |
| Flash/MTPLX (timed only) | 3,237 | 22 | 0.7% | 1,157,358 | 0.1 | 0.7% | 9/35 | 1/4 |
| Flash/llama.cpp, 27B, Swift, Swift 1.5 | 25,573 | 1 | 0.0% | 2,276 | 0.0 | 0.0% | 1/134 | 1/17 |

830 of the 848 mlx-serve misses are in canvas-mlx-02 (539) and canvas-mlx-01 (291); the commonest cache figure in both is exactly 81,920. The later runs (v2-r1 to v2-r3, canvas-mlx-03, kg-07-01) have 18 between them, so the cap looks removed, but the log does not say what changed. Overall mlx-serve read 4.2% of its prompt tokens afresh against 1.1% to 1.6% for the others.

**Precision.** 24 of 25 (one hit is an MTPLX engine error with zero tokens recorded).

**Example.** Flash/mlx-serve, canvas-mlx-02, story 4: `call 267: previous prompt 106,361 tokens; this call got 81,920 from cache and read 25,721 afresh`

**Use.** Engine-specific, not a Qwen pattern. Something to know when comparing mlx-serve's two early runs with anything else: 11% of the group's generating time went on this. Worth a check in the harness that flags a run whose cached tokens stop growing.

## 9. Rare but expensive: loops and dead calls

Each of these is confined to a few stories or one group, reported because of its cost.

- **A runaway nudge loop (1 story).** Flash/MTPLX, canvas-pi-01, story 11 received `Continue with the task from where you left off.` 3,124 times and answered `Nothing left to do.` 3,091 times. That one story holds 3,869 of the group's 14,834 model calls and sent 275 million prompt tokens (almost all cached). The next largest count in any story is 24. The harness's nudge has no stop condition for an agent that says it is finished.
- **Thinking to the length limit with nothing produced.** 21 Qwen calls thought until the output limit and returned neither text nor a tool call: 16 in 27B/llama.cpp (465,809 output tokens, 5% of the group's total, 10 stories), 2 in mlx-serve, 1 each in gufo, Swift and Swift 1.5. Example: 27B/llama.cpp, canvas-pi-02, story 9, 124,780 characters of thinking, 32,768 tokens, stop reason `length`.
- **MTPLX empty replies.** 42 calls ended in an engine error with nothing generated and 32 stopped at the length limit after one token (`Let`, `Now`), across 21 of 35 stories. No other engine has either.
- **Tool calls that never returned**: 12 in Qwen timed stories and 2 in Sonnet, nearly all browser test runs or process clean-up. A further 30 Qwen tool calls ran 600 s or more (6 hours in total); 27 of the 45 long or dead calls were browser tests. Example: Swift 27B, canvas-pi-03, story 5, `npm run test:e2e 2>&1 | tail -12` never returned.
- **gufo tool calls written out as text**: 36 harness messages `Your last reply contained a tool call written out as text`, gufo only.

**Use.** The first is a harness fix (stop nudging after N identical "done" replies). The second argues for a thinking cap (finding 2). The others are things to know about MTPLX and about browser tests without a timeout.

## 10. Waiting, timeouts and process clean-up

| group | commands with `sleep N` | seconds of sleep written | wrapped in `timeout N` | share of bash | cut off by the tool's time limit | results with address-in-use | commands that kill processes | tests preceded by a kill | share of tests |
|---|---|---|---|---|---|---|---|---|---|
| Flash/gufo | 310 | 1,776 | 508 | 5.8% | 36 | 16 | 265 | 109 | 3.5% |
| Flash/mlx-serve | 202 | 5,548 | 340 | 4.2% | 1 | 9 | 155 | 89 | 3.8% |
| Flash/MTPLX | 135 | 1,092 | 364 | 4.8% | 6 | 4 | 114 | 62 | 3.8% |
| Flash/llama.cpp | 81 | 1,796 | 209 | 7.5% | 1 | 2 | 38 | 11 | 1.2% |
| 27B/llama.cpp | 241 | 3,404 | 37 | 0.6% | 10 | 2 | 148 | 47 | 2.9% |
| Swift 27B | 247 | 2,832 | 193 | 3.7% | 8 | 4 | 179 | 75 | 3.8% |
| Swift 1.5 27B | 448 | 4,130 | 375 | 6.8% | 14 | 10 | 306 | 129 | 6.1% |
| Opus 5.5 | 81 | 511 | 375 | 7.9% | 0 | 1 | 44 | 10 | 0.7% |
| Sonnet 5.5 | 8 | 671 | 59 | 3.1% | 0 | 3 | 4 | 3 | 0.5% |

- **Sleep is small.** 20,578 seconds written across all Qwen stories (each `sleep` counted once; loops run more). Server, wait and process commands took 6 measured hours in Qwen timed stories, 4% to 16% of tool time, highest in 27B and Swift 1.5.
- **`timeout` wrappers are common and almost never fire**: 2,026 Qwen commands, 36 ran to their limit (timed stories). 331 set a limit over 600 s. Separately, 76 Qwen commands were cut off by the bash tool's own time limit (`Command timed out after N seconds`, 10,735 seconds of limits).
- **Killing leftover servers before a test** is a shared Qwen habit: 522 test commands (1.2% to 6.1%) follow a `pkill`, `fuser -k` or `lsof | xargs kill`, against 13 for Claude. It answers a real problem: 47 Qwen results show a port already in use.

**Precision.** Kill-before-test 24 of 25. Address-in-use was 16 of 25 at first (9 were source text mentioning the phrase); the detector was tightened to bind errors in commands that are not file reads, after which every sampled hit was a real error. Sleep and timeout: every hit whose matching part was visible was correct (3 to 4 of 25 hidden inside long commands). Tool time limit 25 of 25.

**Examples.**
- Swift 27B, canvas-pi-03, story 7: `fuser -k 8787/tcp 2>/dev/null; sleep 1; npx playwright test --project=chromium 2>&1 | tail -15`
- Swift 1.5 27B, v2-r4, story 9: `sleep 120; tail -6 /tmp/e2e-full.log; echo "---"; ps -p 3255151 > /dev/null && echo "STILL RUNNING" || echo "DONE"`

**Use.** Something to know; a small lever. A harness-provided "free the test port" step before each test command would remove the need for the kills and the address-in-use failures.

## 11. Debugging by throwaway script and scratch test

| group | inline scripts (`node -e`, `python3 -c`) | characters | scratch files in workspace | removed in story | left | files under /tmp | left |
|---|---|---|---|---|---|---|---|
| Flash/gufo | 250 | 222,658 | 125 | 123 | 2 | 85 | 79 |
| Flash/mlx-serve | 179 | 83,718 | 180 | 177 | 3 | 64 | 52 |
| Flash/MTPLX | 148 | 81,063 | 146 | 140 | 6 | 60 | 47 |
| Flash/llama.cpp | 108 | 69,201 | 90 | 87 | 3 | 28 | 24 |
| 27B/llama.cpp | 232 | 132,452 | 196 | 191 | 5 | 70 | 50 |
| Swift 27B | 133 | 64,020 | 247 | 246 | 1 | 87 | 56 |
| Swift 1.5 27B | 259 | 240,947 | 277 | 277 | 0 | 93 | 73 |
| Opus 5.5 | 33 | 37,418 | 52 | 51 | 1 | 45 | 40 |
| Sonnet 5.5 | 46 | 19,733 | 11 | 10 | 1 | 12 | 6 |

- Qwen creates 1,261 scratch files in the workspace (names like `debug`, `dbg`, `probe`, `scratch`) and removes 1,241 of them in the same story. Only 20 are left (19 of the 22 leftovers in all groups were real scratch files; 3 may be intended `smoke` tests). 381 files under `/tmp` are not removed.
- The scratch tests are the files rewritten most often: `tests/integration/__probe.test.ts` was written whole 15 times in one story (27B/llama.cpp, canvas-pi-04, story 4), which feeds finding 1.
- **console statements**: edits and writes added 358 console statements to non-test files across Qwen groups and removed 228, a net of 130 left, in 40 stories. This is weak evidence of leftover debugging: 17 of 25 sampled additions are in `src/worker/` files where logging may be intended, and removals made through bash are not seen. I could not determine how many of the 130 are debug leftovers.
- **Contrast**: Opus edits by bash (1,096 python scripts, 1,153 heredocs, 279 `sed -i`; 7.9 million characters) and spends 16% of its tool time doing so.

**Precision.** Inline scripts 24 of 25; scratch files 24 of 25.

**Use.** Something to know. The tidy-up rate (98%) is a good Qwen trait, shared by all seven groups.

## 12. Dependencies and what fills the context

**Dependencies** are a small cost: 270 `npm install` commands in Qwen stories (203 of them after story 1), 185 `npm view/info`, 110 `playwright install`. Measured time in timed stories is 0.3 tool hours for installs and 0.1 for lookups (all groups). 63 Qwen dependency commands returned an npm error. npx downloading a package shows in 3 results.

**What fills the context.** Of 171 million characters returned by tools, reading is the bulk in every group: the read tool 35% to 64% of Qwen result characters and bash reads 18% to 55%; all tests together 6% to 15%. Results of 20,000 characters or more are 0.3% to 1.0% of Qwen results but 4.5% to 13.7% of the characters (Claude: 3.8% and 2.8% of results, 38% and 43% of characters). Of the 860 such results, 816 are file reads. The pi client cut 32 bash results at its 50 KB limit; 5,784 read results ended with a "more lines in file" notice.

**Use.** Something to know: test output is not what fills a Qwen context; file reads are.

---

## What I could not determine

- **Seconds for 73 stories** (24 MTPLX, 23 27B/llama.cpp, 6 Flash/llama.cpp, 20 Opus): their logs carry no tool times. Time shares for those three Qwen groups rest on 11 to 14 stories each.
- **The seconds or tokens a rewrite, a `cd` prefix or a repeat read cost.** The characters are measured; converting them to time needs a per-token speed that I did not derive.
- **Whether a whole-suite test run could have been a targeted one**, and whether a repeat read of changed content was needed.
- **How many of the 130 net console statements are debug leftovers.**
- **Why 18% to 44% of failed edits failed**: the file had been changed through bash or read only in part, so the replay did not know its content.
- **What changed in mlx-serve** between the capped runs and the later ones.
- **Claude's thinking and true output tokens**: withheld or partial in the logs.
