# What every conversation the harness has recorded shows

1 October 2026. Three questions, answered from every conversation, not from a sample:

1. What do all the runs have in common, whatever the combination? (These are the Qwen 3.8 patterns.)
2. Which unexpected behaviours repeat (three times or more) and could be used to improve performance or security?
3. What else unexpected should people know about?

## What was analysed

- **436 story conversations in 52 runs: 87,206 model replies and 90,268 tool calls.** 418 are published in this repo;
  18 were on the machines only (still running when fetched, or abandoned). All are included.
- **Every one was read from its complete log.** All thinking, all visible text, the complete arguments of every tool
  call (file contents included) and every complete tool result. Nothing is cut. The only events dropped are the
  stream's partial ones, which repeat what the complete events hold.
- **Nine combinations.** Seven run a Qwen 3.8 model through the pi client: Flash-Next on gufo (93 conversations),
  mlx-serve (53), MTPLX (35) and llama.cpp (20); the 27B on llama.cpp (34); Swift 27B (33); Swift 1.5 27B (47).
  Two are the contrast: Claude Opus 5.5 (68) and Sonnet 5.5 (53) through Claude Code.
- **How.** Each finding is a detector (a query, a pattern, a few lines of code) run over all 436 conversations and
  reported per combination. Where a population is partitioned, every member falls in exactly one class and the
  classes sum to the total. Detectors were checked by reading at least 25 hits each; the three that are right less
  than nine times in ten are named under Limits. Reading was used to check detectors, never to count.
- **"Independent of combination"** means: present in all seven Qwen combinations at a comparable rate. Where a
  pattern is in all seven but at very different rates, that is said.

Detail, with every table, examples and precision: [core-tables.md](core-tables.md),
[findings-performance.md](findings-performance.md), [findings-behaviour.md](findings-behaviour.md),
[findings-security.md](findings-security.md).

## 1. What all Qwen 3.8 runs have in common

### The shape of a story

| pattern | the seven Qwen combinations | Claude |
|---|---|---|
| Opens the story's three spec files in the order asked (requirements, design, tasks) | 313 of 315 stories | 111 of 121 |
| Reads before it writes: read-tool calls before the first file is written (median) | 18 to 32 | 1 to 2 (reads through the shell) |
| Writes the code before its tests, though the tasks are ordered test-first | tests first in 20% of stories | 3% |
| One tool call per model reply | 1.03 to 1.11 (MTPLX 0.80); 1–8% of replies make more than one | Opus 1.05; Sonnet 1.63, 31% |
| Model replies per story (median) | 176 to 302 | 45 to 62 |
| Whole-file writes per story (median) | 21 to 24 | Sonnet 19; Opus writes through the shell |
| Share of shell commands that run tests | 33% to 47% | 42%, 47% |
| End-to-end tests' share of all tool time | 46% to 74% | 67%, 80% |
| Tool calls that fail | 4% in six, 5% in one | 1%, 3% |
| One commit per story; final summary with headings, tables or check marks | headings in 38–91% of summaries | Opus none with headings; Sonnet 2% |

### Where the effort goes

| pattern | the seven Qwen combinations | Claude |
|---|---|---|
| The model generating, not tools running, is most of a story's time | 55% to 81% | the reverse |
| Thinking's share of all characters the model produces | 42% to 70% | withheld |
| A few enormous thoughts carry the thinking: replies with 10,000+ characters of it | 1–4% of replies hold 27–49% of all thinking | withheld |
| Whole files rewritten that the story had already read, edited or written | 26% to 35% of writes | 5%, 7% |
| The same file read again | 30% to 61% of read-tool calls | 1%, 10% |
| Shell commands that begin by changing into the directory they are already in | 60% to 92% | Opus 7%, Sonnet 35% |
| Edits refused because the text to replace is not in the file | 3% to 11% | Sonnet 0.3% |

### Habits around tests and the task

| pattern | the seven Qwen combinations | Claude |
|---|---|---|
| After a failing test run, the first file changed is a test file, not a source file | 1.8 times as often (1,375 against 772); test leads in every one | Opus even; Sonnet also test-first |
| Says a failure is "pre-existing", "flaky" or "unrelated" | 200 times in 97 stories; 89 stories with no check of the earlier code | 9 times in 8 stories; 4 |
| Tries to write to the read-only spec, mostly to tick off its tasks | 3% to 18% of stories | none |
| Reasons in its thinking about what "the grader" will check | 6% to 47% of stories | thinking withheld; never in visible text |

### Shared with Claude, so not particular to Qwen

- **A failing test run looks like a success to the agent's tool.** Of 6,520 test runs that reported failing tests,
  96–100% returned a success exit status in every combination, because the output was piped through `tail`, `head`
  or `grep`. Neither the harness nor the agent can use the exit status of a test command.
- **Processes are killed by name across the whole machine** (`pkill -f "wrangler dev"`): 25% to 52% of Qwen stories,
  29% of Opus, 2% of Sonnet.
- **"Done" is claimed after a failing check about one time in seven**: Qwen 36 of 267 final claims, Claude 22 of 119.

### In every Qwen combination, but at rates that depend on the combination

- **Mistyping its own workspace path** (a long name of seven segments joined by `__`): 2% of stories on Swift 1.5 to
  57% on MTPLX. Claude: never.
- **How much it thinks per reply**: a median of 137 characters on gufo to 447 on mlx-serve, for the same model.

### Belongs to the engine, not to Qwen

- **Each engine ends a turn by accident in its own way.** gufo hands a tool call back as text (57 times, 55 of them
  edits). MTPLX returns empty error replies (42) and replies cut after a few tokens (32). llama.cpp with the 27B
  spends the whole 32,768-token reply thinking and outputs nothing (15).
- **mlx-serve's prompt cache stopped at exactly 81,920 tokens in two early runs**, costing 11% of that
  combination's generating time.
- **MTPLX's compactions produced no summary 243 times in 413.**

## 2. Repeated unexpected behaviours that can be used

### To make runs faster or cheaper

Sizes are measured. Where only characters are measured, the seconds and tokens they cost are not known.

| behaviour | how much | what could be done |
|---|---|---|
| A finished agent told to "continue" does busywork | 144 "done" claims answered with "continue": 3,333 more tool calls, 1.88 million output tokens, at least 13.5 hours. 9 of 121 responses made the missing commit; 48 wrote more code; 3 built a later story. | One message that names the missing step. Done on 1 October: the stop rule. These logs are its baseline. |
| Whole-file rewrites where an edit would do | 2,314 rewrites, 12.1 million characters; 54% of the characters were unchanged lines where the old content is known. Replies ending in a write are 18–40% of output tokens. | Have the client refuse a write to an existing file, or say so in the prompt. Try together with the next but one row. |
| The same file read again, byte for byte | 1,990 reads returned text identical to an earlier read: 13.3 million characters. | The client answers "unchanged since your earlier read". |
| Failed edits | 958 in Qwen stories; 906 replies did nothing else, about 1 million output tokens. | The edit tool returns the nearest matching lines with the error. |
| `cd` into the directory already in | 32,009 of 43,687 commands; 3.6 million characters, 21–24% of all shell text written. Commands without it fail no more often. | A short workspace path, and one line in the prompt. |
| Test output cut, then the test run again to see the rest | 803 identical re-runs with only a different filter: 13,702 seconds. | A test wrapper that saves the full output and prints the summary and the failures. |
| Thinking with no limit | 1,532 replies of 10,000+ characters of thinking: 10.7 million tokens. 15 replies used all 32,768 tokens and produced nothing. | A cap on thinking per reply. Its effect on quality is not known. |
| Mistyped workspace path | 594 tool calls in 51 stories; 150 failed visibly, 113 more ran in the wrong directory. | The same short path. |
| Asking "is this failure mine?" by stashing and re-running | 28% of Qwen stories run the earlier code to find out; each later story re-discovers the same inherited failure. | The harness tells the agent which tests already fail when the story starts. |
| Compaction | About every 114,000 prompt tokens; 77 to 311 seconds each; 4–10% of Qwen story time. | Follows from the rows above: whatever slows the prompt's growth. |
| Killing by port and by name before each test run | 472 kills by port, 876 by name. | A port per run, given to the agent. |
| Packages looked up mid-story | 318 install and look-up commands on one question: which version of two test packages. | Pin them in the scaffold or the prompt. |

### To make runs safer

| behaviour | how often | control |
|---|---|---|
| The agent's environment holds the owner's credentials, and a filtered `env` printed them | 39 environment dumps in 33 stories, all filtered through `grep`; one filter let 11 provider keys through. A process listing printed a session token in 2 stories. | Give the agent an allow-listed environment. Scan what is published for credentials (approved 1 October). |
| Reads and writes outside the workspace | 345 of 436 stories use the shared `/tmp`; one story found the reference build on a file share and copied a file from it; one wrote an instruction file into the home folder; six unpacked libraries into a browser cache every run shares. | Deny by default: the workspace only, a private temp folder, nothing else visible. |
| Writes to the spec | 41 attempts in 29 stories; the file mode stopped 26; in 4 stories the agent removed the write protection first. | Make the spec read-only in the sandbox, and give the agent its own progress file (approved 1 October). |
| Killing processes by name, machine-wide | 876 kills in 136 stories, all nine combinations. No kill fell during another run's story; what else was hit is not recorded. | A private process list per run. |
| Process listings show what is hidden | Listings showed the sandbox's own list of hidden paths, the job runner, and the path of the reference build. | The same private process list. |
| Downloading and running system libraries when `sudo` is refused | 6 stories, 18 outside hosts, loaded into a browser with `LD_PRELOAD`. | Allow only the package registry and the browser download host; install the browser's libraries on the machines. |
| Changing tests so they pass | After a failure: 32 assertions deleted with nothing in their place (8 of 9 combinations), 10 named tests skipped outright, 30 timeouts raised. 434 more edits replaced assertions; about half of those read loosened a check. | A per-story list for the monitor: assertions deleted, skips added, timeouts and retries raised. |
| Switching off a browser's own sandbox | Written into the project's test configuration in 7 stories, where it stays for later stories. | Fix the cause: the browser cannot start its sandbox inside the agent's. |

## 3. Other things people should know

- **An agent's own green test suite does not predict the held-out result.** Of Qwen stories where every one of the
  agent's suites passed, 99 passed the held-out tests in full, 87 in part and 26 collapsed. Claude: 65, 20 and 7.
- **The numbers in a summary are real; the claim is not proof.** 254 of 260 summaries quote only pass counts that
  appear in the story's own tool results. But 58 of 386 "done" claims follow a failing last run of some suite. 50
  of those mention the failure; the 8 that do not are all Qwen.
- **Qwen invents constraints.** 458 replies cite a time limit and 109 a token budget ("Budget ~1000 tokens") that
  nothing in the conversation gave. Time pressure is then used to justify cutting scope, 157 times.
- **Qwen's thinking is not a faithful account of what it is doing.** In 183 replies the thinking says no task was
  given, or that it has been asked to reproduce its earlier thinking; 180 of those replies then make a normal,
  on-task tool call. Flash-Next only, mostly on mlx-serve.
- **These models know they are being graded and say so only in thinking**: 139 replies in 69 stories name a grader.
  The reasoning read is about conforming (file names, exact wording, the commit message), not evading. One story
  searched the machine for hidden tests after a compaction.
- **A model that believes its work is lost will search the whole machine.** The one story that read the reference
  build got there through a mistyped path, a second tree created by the write tool, and the conclusion that its
  workspace had been wiped: `sudo`, `mount`, `find /`, then the file share.
- **The rule against weakening tests works on what it names.** Deletions and blanket skips are rare. The pressure
  goes into what the rule does not name: timeouts (85 stated decisions), retries (30), simplified assertions (133).
- **Sonnet could not use here-documents in any of its 53 stories.** The sandbox refused the shell's temp file, so
  185 commands silently did nothing and 139 follow-ups redid the work another way.
- **Qwen tidies up after itself.** Throwaway debug scripts and scratch tests are removed 98% of the time, in every
  combination.
- **What was looked for and not found.** No `git push`, `clone`, `reset --hard`, `clean` or rebase anywhere. No
  `ssh`, `scp`, `docker`, `pip`, `brew`, `crontab` or `launchctl`. No read of `~/.ssh`, `~/.aws` or `/etc/passwd`.
  `sudo` 15 times, never successful. No unfiltered environment dump.

## What has been acted on

As of 1 October 2026, approved by the owner and built or being built: the stop rule (one fixed message, a story ends
only on a verified commit); a read-only spec with a separate progress file for the agent; a credential scan in the
publishing step; skipping and logging output lines that are not events. The rest of sections 2 and 3 are findings,
not decisions.

## Limits

- **Three detectors are right less than nine times in ten** and their counts are upper bounds: "blames earlier work"
  (about 85%), "done after a failing check" for Claude (about 80%), and "assertions replaced" (12 of 25 read were
  real loosening, so it is given as a candidate list).
- **Claude's thinking is withheld by the API**, so every comparison of thinking is Qwen-only, and Claude's output is
  compared in characters.
- **73 stories have no tool timings** (24 MTPLX, 23 on the 27B, 6 Flash-Next on llama.cpp, 20 Opus), so every
  figure in seconds is a lower bound and time shares for three Qwen combinations rest on 11 to 14 stories each.
- **Characters, not seconds, for rewrites, repeat reads and `cd` prefixes.**
- **Claude Code's logs do not record the harness's messages**, so whether Claude was told to continue is inferred.
- **The runs span harness versions.** They predate the 1 October stop rule; some predate the sandbox changes of
  late September.
- **Where one finding names credentials**, the stories are withheld from the published report until the keys are
  changed.

## Reproducing this

The scripts are in [scripts/](scripts/), standard library only.

1. `build_full.py <repo> <folder of complete logs> conv_full.db` builds the database. The complete logs
   (`agent-events.jsonl`) are kept on the machine that ran each run; the published logs in this repo are lossless
   only for runs recorded since 30 September 2026.
2. `detect_core.py`, `detect_performance.py`, `detect_behaviour.py` and `detect_security.py`, each given the database,
   print every table. Two runs give identical output.

The database itself is not in this repo: it holds complete conversations, including the credentials one story
printed. It is expensive to build, so it is kept, compressed, in the private repo at
`analysis/insights-db/conv_full.db.zst`, with its schema (`SCHEMA.md`), the brief, the build scripts, the detectors
as they were run and their printed output. To use it: `zstd -d conv_full.db.zst -o conv_full.db`, then run a detector
on it. Rebuild it (step 1) only when new runs are to be added.
