# Anomaly tracking (benchmark soak test)

A running list of things that looked wrong while the vidi benchmark ran on the four machines: what was
seen, what it turned out to be, and whether it needs someone. Kept by a monitor that only observes (it
never touches jobs, nodes, run records or harness code).

**Last updated:** 2026-10-01 10:06 UTC

**Machines:** the RTX 4090 machine, the Strix Halo box, the M5 Max, the M2 MacBook Air.

**Buckets** (each anomaly gets exactly one, with a confidence):

| Bucket | Meaning |
|---|---|
| internal bug | the harness, dbench, dashboard, scoring or sandbox did something wrong |
| genuine LLM behaviour | the model/agent (with its engine) really behaved that way and the harness measured it correctly |
| stuck job | a process hung or makes no progress and needs someone |
| broken pipeline | the work happened but recording, publishing, scoring or CI didn't |
| environment | the machine (memory, thermal, disk, network, another process) caused it |
| unexplained | couldn't tell; the entry says what would settle it |

**Numbering:** A-001, A-002, … in the order first written down; an id never changes or is reused.
Entries are updated in place (last seen bumped, a dated note added) and move between sections; nothing is
deleted. Held-out tests are referred to by counts only. Times are UTC.

---

## Open — needs someone

### A-011 — Runs end with no score of record: the suite checkout is one commit off its tag
- **First seen:** 2026-10-01 07:26 · **Last seen:** 2026-10-01 09:12 (still true for the running jobs)
- **Where:** gufo-pi on the Strix Halo box: v2-r4 (finished, unscored), v2-r5 (running, will end the same
  way). mlxserve-pi on the M5 Max: v2-r2 (running; its stories record the same kind of version).
- **Observed:** gufo v2-r4 `finalize.json`: `rescore: skipped`, reason "the suite checkout is at
  vidi-v2.0-pre2+28ace8b, not the pack's vidi-v2.0-pre2". Its live score at story 12 is 65/75 and there is
  no final re-score. gufo v2-r5's `run.json` has the same `pack_version`; mlx v2-r2's stories carry
  `vidi-v2.0-pre2+67fcf29` (story 4) and `…+88a5c4002` (story 9).
- **Why:** on the Strix Halo box the private suite checkout sits on its main branch, 11 commits past the
  tag. Exactly one of those commits touches the pack: it deletes one v1-only scope file (20 lines). The
  held-out tests themselves are identical to the tag's. `pack-version.sh` compares the whole pack directory
  with the tag, so it reports "tag+HEAD" (and the suffix moves every time a private record commit lands),
  and `finalize.py decide()` skips the re-score when the version is not exactly the pack's `pack_ref`.
- **Bucket:** broken pipeline — **confidence high** for the Strix Halo box (read from the checkout itself);
  medium for the M5 Max (same symptom in its records; its checkout not inspected).
- **Note 2026-10-01 09:40 (from the owner):** the Strix Halo box's suite checkout is back on the tag, so
  gufo v2-r5 should finalize with a score, and a one-off job there re-scores v2-r4 when v2-r5 ends. The
  M5 Max's checkout is detached 31 commits past the tag (6 private commits made on the detached HEAD by
  the older harness, not yet on the private main); it will be repaired when mlx v2-r2 ends, so that run
  will end without a score of record until then.
- **Status:** open, known to the owner. To check: a final score for gufo v2-r4 appears after v2-r5 ends;
  gufo v2-r5 finalizes with a score; mlx v2-r2 gets one after the repair.
- **Suggested action:** either tag the suite again where it is now and bump the pack's `pack_ref`, or put
  the two checkouts back on the tag; then re-score gufo v2-r4 by hand. Longer term: have `pack-version.sh`
  compare only what scoring depends on, or have finalize say so loudly at run start rather than after
  11 stories.

### A-018 — Two machines will go idle when their current run ends (queues empty; two nodes held)
- **First seen:** 2026-10-01 09:02 · **Last seen:** 2026-10-01 09:12
- **Where:** the M5 Max (mlxserve-pi v2-r2 running, nothing queued; its v2-r3 job was cancelled while
  queued on 30 Sep) and the Strix Halo box (gufo-pi v2-r5 running, nothing queued).
- **Observed:** `dbench status`: no queued job behind either. The M5 Max and the RTX 4090 machine are also
  HELD ("restart on the new dbench … released automatically"): the 4090's queued v2-r5 will not start
  until the hold is released.
- **Bucket:** none — scheduling, not a fault (not counted in the bucket table).
- **Note 2026-10-01 09:40 (from the owner):** the holds release by themselves when the current jobs end;
  a concern only if a node is still held 15 min after its job ended or sits idle with jobs queued.
- **Status:** open. mlxserve-pi has one finished v2 run and one in progress, so it is short of three.
- **Suggested action:** queue mlxserve-pi v2-r3 on the M5 Max and the next job on the Strix Halo box;
  check the holds release as intended when the running jobs end.

### A-022 — The reference run shares the M2 MacBook Air with interactive work: on battery for a whole story, thermal waits
- **First seen:** 2026-10-01 07:5x (story 3) · **Last seen:** 2026-10-01 09:12 (waiting before story 7)
- **Where:** reference/sonnet-5.5 v2-r4, the M2 MacBook Air.
- **Observed:** story 3: 13 of 31 condition samples thermally throttled (moderate or heavy), share 0.42.
  Story 4: 65 of 74 samples on battery with Low Power Mode on, so the story is marked DEGRADED (timing
  not comparable); it took 39 min against 11–18 min elsewhere. The harness waited for fit conditions
  before stories 3, 5 and 7 ("thermal: heavy", and once "ac: False, low_power: True"). At 09:12 the
  machine had a load average of 7 (16 over the previous 15 min), a video call using about 1.8 cores, and
  several other interactive sessions, this monitor among them.
- **Bucket:** environment — **confidence high** (the run's own condition samples and the machine's
  process list).
- **Note 2026-10-01 09:31:** story 7 has not started: the job has been waiting on "thermal: heavy" since
  about 09:05 (26 min and counting), on AC, with the video call still using about 2 cores and the load
  average at 7–10. The run is blocked until the machine cools, which it won't while it is in use like this.
- **Note 2026-10-01 09:52:** still waiting before story 7: 47 min so far.
- **Note 2026-10-01 09:40:** known to the owner (on AC now; a video call and development work load the
  machine). Not escalated again unless the run makes no progress for 2 hours. Waits are logged here:
  before story 7, from about 09:05, still waiting at 09:36 (31 min so far).
- **Status:** open, known. Held-out scores are unaffected so far (36/36 at story 5), but v2-r4's times are not a
  clean reference, and A-010 and A-015 may be side effects.
- **Suggested action:** keep the laptop on AC for the rest of v2-r4..r6; treat story 3 and 4 timings of
  v2-r4 as not comparable; if a clean timing reference matters, run the reference when the machine is
  otherwise idle.

---

## Open — being watched

### A-012 — Every held-out test fails for several stories in a row (Swift 1.5, v2-r4 stories 2–4)
- **First seen:** 2026-09-29 (v2-r1) · **Last seen:** 2026-10-01 08:41 (v2-r4 story 4)
- **Where:** qwen 3.8 Swift 1.5 27B, llamacpp-pi, the RTX 4090 machine. v2-r4: story 2 0/20, story 3 0/27,
  story 4 0/31 (story 1 was 5/6). Same shape earlier: v2-r1 stories 3–8 (0/27 … 0/51, then 53/57 at
  story 9), v2-r3 stories 3–4 (then 34/36 at story 5); and gufo-pi v2-r1 stories 5–9 on the Strix Halo box.
- **Observed (v2-r4, verified):** the build passes, the held-out runner ran, and all 20/27/31 failures have
  one signature: the board never renders in the browser. The agent's own gate agrees: unit and component
  tests pass (48 + 29), its own e2e suite is 0 passed / 17 failed over 491 s on story 2, 0/19 on story 3,
  and on story 4 its Playwright config no longer loads at all. In story 2's log the agent says it wrote the
  e2e tests but would not run them "since they require a running server", then "Everything is green" and
  commits.
- **Bucket:** genuine LLM behaviour — **confidence high** for v2-r4 (the agent's own e2e fails the same
  way; no harness fault, no port fault recorded). The other runs listed share the pattern but were not
  read individually (medium). The other reading, a scoring-side failure to start the app, is ruled out
  for v2-r4 by the agent's own e2e result on the same commit.
- **Status:** watching for whether a later story repairs it, as happened in v2-r1 and v2-r3.
- **Note 2026-10-01 09:12:** story 5 done in 22 min (the other runs: 87–128 min): 2/5 of its own held-out
  tests and 3/36 overall, gate still red. The app now renders for a few tests; not repaired.
- **Suggested action:** none for the harness. Worth knowing when reading this stack's story-level scores:
  stories 2–4 will show 0 own held-out tests although unit-level work exists.

### A-013 — A finished story recorded PARTIAL: the agent never commits, and the nudge doesn't say why it is being nudged
- **First seen:** 2026-09-30 04:22 (gufo v2-r1 story 10) · **Last seen:** 2026-10-01 03:13 (gufo v2-r4 story 4)
- **Where:** gufo-pi, the Strix Halo box. v2-r4 story 4: PARTIAL, "story cap: 5 nudges without committing",
  92 agent-min, 301 calls, 0 agent commits; yet gate green and 4/4 of its own held-out tests (27/31 overall).
  v2-r1 story 10: same cap (204 agent-min, 672 calls, 7/8 own; gate red there). Also mlxserve-pi v2-r2
  story 4: 3 nudges, 0 commits.
- **Observed (v2-r4 story 4 log):** the agent declares the story complete after about 59 minutes and never
  runs `git commit` (three `git status` calls in the whole story, no commit). Each of the five nudges is the
  one sentence "Continue with the task from where you left off."; each time the agent re-runs its checks
  and answers that everything is complete and nothing is left to do. About 33 agent-minutes go on this,
  then the cap ends the story.
- **Bucket:** genuine LLM behaviour — **confidence medium**. The prompt's step 5 tells the agent to commit
  and it didn't, so the measurement is right. But the harness contributes: `RESUME_PROMPT` (drive.py) is
  used for the no-commit nudge too and never mentions the missing commit, so a model that believes it is
  done has nothing to act on. The other reading (internal bug) applies if the nudge is meant to help.
- **Note 2026-10-01 09:40:** the no-commit nudge now says the work must be committed, with the hash as
  evidence (`ea7748bf`). Runs started before it (all four running at 09:40: Swift 1.5 v2-r4, gufo v2-r5,
  mlx v2-r2, Sonnet v2-r4) still use the old sentence.
- **Status:** watching; recurs on gufo.
- **Suggested action:** decide whether the nudge may say "you have not committed your work" (it costs the
  agent nothing it wasn't already told in the prompt). If not, consider stopping at the first nudge whose
  reply makes no tool call that changes a file, to save the 30+ minutes.

### A-026 — Swift 1.5 v2-r4 story 7: a tool call silent for 10 minutes, interrupted by the hang guard
- **First seen / last seen:** 2026-10-01 09:42
- **Where:** qwen 3.8 Swift 1.5 27B, llamacpp-pi, the RTX 4090 machine, v2-r4 story 7 (still running at
  10:05, 48 agent-min, no commit yet).
- **Observed:** the job log: "tool call silent 10 min — interrupted (Ctrl-C equivalent)". The agent carried
  on afterwards (edits and builds). Shortly before, its activity included probing a local server with curl,
  so a command waiting on a server that never answers is the likely cause.
- **Bucket:** genuine LLM behaviour — **confidence low** until the story's record shows which command it
  was (`conversation.longest_tool`, `tool_interruptions`).
- **Status:** watching; the guard did its job.

### A-010 — Sonnet 5.5 v2-r4: its own e2e suite fails in the gate on stories 2 and 3 while held-out passes
- **First seen:** 2026-10-01 07:5x (story 2) · **Last seen:** 2026-10-01 08:2x (story 3)
- **Where:** reference/sonnet-5.5 v2-r4, the M2 MacBook Air.
- **Observed:** gate red on both DONE stories with exactly one failing e2e test each time, the same one of
  the agent's own tests (8 passed / 1 failed on story 2; 15 / 1 on story 3); everything else in the gate
  green. Held-out: 20/20 and 26/27. Story 4's gate is green again.
- **Bucket:** genuine LLM behaviour — **confidence medium**: the agent committed with one of its own tests
  failing where the gate runs it. Not yet separated from a test that only fails in the gate's environment
  (the agent's log on those stories would show whether it passed for the agent).
- **Note 2026-10-01 09:12:** story 5's gate is red again (36/36 held-out). The machine was heavily loaded
  during these stories (A-022), so a timing-sensitive test of the agent's own failing only under load is
  now the likelier reading; bucket unchanged until a log is read.
- **Status:** watching v2-r4's later stories and v2-r5/r6.

### A-015 — Sonnet 5.5 v2-r4 story 4: accounting check failed, and the story took 39 min
- **First seen / last seen:** 2026-10-01 08:5x
- **Where:** reference/sonnet-5.5 v2-r4 story 4, the M2 MacBook Air.
- **Observed:** `time_split.accounting.ok` false: wall 2352.1 s against the agent's own clock 2321.2 s
  (31 s, 1.3%; the limit is 1%). One session, no nudges, no time between sessions. Separately, 1710 s of the
  story (73%) is the agent running its own e2e tests; the same story took 17–18 min for Opus.
- **Bucket:** internal bug — **confidence low** (was medium): the split for Claude Code logs (added 1 Oct) leaves
  31 s unowned by the agent's clock; most likely time before the first or after the last logged event.
  The long e2e time is the agent's own doing and is measured correctly.
- **Note 2026-10-01 09:12:** the story ran almost entirely on battery in Low Power Mode and is marked
  DEGRADED (A-022), which explains its length. The 31 s gap may come from the same cause (the machine
  pausing), which would make this environment rather than a bug: confidence lowered to low.
- **Status:** watching for the same on later stories; stories 1–3 and 5 passed the check.

### A-016 — mlx-serve v2-r2: accounting unchecked on stories 1–3, failed on stories 4 and 9
- **First seen:** 2026-09-30 · **Last seen:** 2026-10-01 07:0x (story 9)
- **Where:** mlxserve-pi v2-r2, the M5 Max.
- **Observed:** stories 1–3 have no `accounting` block (recorded before the checks existed; the run is
  still going, so it hasn't been backfilled). Story 4 (restarted, 2 attempts): "wall 13113.4 s differs from
  the agent's own clock (13111.7 s + 205.8 s between sessions)". Story 9 (restarted after A-005): the tool
  call the swap guard killed is reported as "never ended" in attempt 1 and again, under the same call id,
  in attempt 2.
- **Bucket:** internal bug — **confidence medium**. Story 4: the between-sessions time looks counted
  inside the agent's seconds for a restarted story as well as beside them. Story 9: an earlier attempt's
  unfinished call is attributed to the later attempt too (`attempts.py` / `accounting.py`).
- **Status:** watching; a backfill after the run ends may clear stories 1–4.
- **Suggested action:** after the run, run the backfill with `--recompute` and see whether 4 and 9 still
  fail; if 9 does, the call belongs to attempt 1 only.

### A-019 — dbench's pull before a job fails on the Strix Halo box
- **First seen / last seen:** 2026-10-01 07:26
- **Where:** job vidi-v2-gufo-r5.
- **Observed:** "git pull --ff-only: FAILED (running anyway): fatal: Cannot fast-forward to multiple
  branches." The checkout was already at origin's head, so the run started on current code.
- **Bucket:** unexplained — **confidence low**. That message means more than one fetched ref was marked
  for merge; the checkout's branch and fetch settings look ordinary, so it is probably how the pull is
  invoked there, or a second fetch racing it. Needs dbench's exact pull command and the fetch state at
  that moment.
- **Status:** watching; harmless this time, but a job would silently run stale harness code if the
  checkout were behind.

### A-020 — Live progress shows 0 tokens for a Claude Code story in flight
- **First seen / last seen:** 2026-10-01 09:02
- **Where:** reference/sonnet-5.5 v2-r4 story 5 (live view only).
- **Observed:** "agent 6m, 33 calls, 0 tokens". Finished stories of the same run have token counts.
- **Bucket:** internal bug (cosmetic) — **confidence medium**: Claude Code reports tokens per `result`
  event, so nothing is known until a session stretch ends; the live view prints 0 where it should print
  "not yet known".
- **Status:** watching; no effect on records.

### A-021 — Opus 5.5 v2-r1: live score 0/36 … 0/75 on stories 5–12, final re-score 75/75
- **First seen:** 2026-09-29 · **Last seen:** 2026-09-30 (re-score)
- **Where:** reference/opus-5.5 v2-r1, the M2 MacBook Air. Run under the earlier suite (vidi-v2.0-pre1,
  dirty); re-scored under vidi-v2.0-pre2.
- **Observed:** from story 5 on every held-out test failed live, with the gate green throughout; the same
  final commit re-scores 75/75.
- **Bucket:** unexplained — **confidence low**. A scoring-side fault under the pre1 suite is likelier than
  the model (a green gate and a perfect re-score), but the live detail wasn't read.
- **Status:** historic; listed because per-story live numbers for this run are not usable. Would need the
  private held-out detail of story 5.

---

## Explained / resolved

### A-001 — Every story crashed after scoring and before its record was saved (shadowed variable)
- **Seen:** 2026-09-30, about 21:20–22:15 · **Where:** mlxserve-pi v2-r2 story 4 on the M5 Max (job
  vidi-v2b-mlx-r2: "harness exited 1" four times, all three restarts used).
- **What:** a time-accounting change rebound the variable holding the story's held-out result; the end of
  every story then raised.
- **Bucket:** internal bug — high. **Fixed:** `8866abce` (the crash, plus a self-test every run now does
  first) and `29a4f2b0` (a fast test of that path). Verified: later stories on all four machines record.

### A-002 — Claude Code could not create its temp dir inside the sandbox
- **Seen:** 2026-10-01 00:49 · **Where:** reference/sonnet-5.5 v2-r1, the M2 MacBook Air (preflight
  failed with EEXIST on the client's temp dir; run not started).
- **Bucket:** internal bug (sandbox) — high. **Fixed:** `bd0010f1`.

### A-003 — Crash on a refused tool call in Claude Code's log
- **Seen:** 2026-10-01 02:54–04:15 · **Where:** reference/sonnet-5.5 v2-r1, v2-r2, v2-r3 (jobs
  vidi-v2-sonnet-b-r1/r2/r3: each failed four times within about six minutes; 13 "run failed" records).
- **What:** `AttributeError: 'str' object has no attribute 'get'` at the end of a story: a message whose
  content was a string, not a list. dbench restarted a crash that could only repeat, so each job burnt its
  three restarts in minutes.
- **Bucket:** internal bug — high. **Fixed:** `4972149b`; `710a8f41` adds a Claude Code run with those
  events to the self-test, and `68c53c39` replays every recorded log through every reader.
- **Note:** restarts spent on an identical traceback are wasted; a "same error twice in a row → stop"
  rule in dbench would have saved two of the three jobs.

### A-004 — Sonnet 5.5 v2-r1 finished with no score: its build used a package from outside the workspace
- **Seen:** 2026-10-01 06:28 · **Where:** reference/sonnet-5.5 v2-r1 (and v2-r2, v2-r3 stopped early for
  the same reason).
- **What:** live 74/75 at story 12, but the final re-score failed: the build passed where the agent worked
  and failed from a clean clone (a type package it never declared, found in the machine's home
  `node_modules`).
- **Bucket:** internal bug (sandbox exposed directories above the workspace) — high. **Fixed:** `7fd3136f`;
  v2-r1..r3 marked invalid in `ee444cb9`; rerun as v2-r4..r6 (v2-r4 in progress).

### A-005 — mlx-serve v2-r2 story 9 stopped by the swap guard, then restarted at once
- **Seen:** 2026-10-01 05:04 · **Where:** mlxserve-pi v2-r2 story 9, the M5 Max (job
  vidi-v2b-mlx-r2-again1, now on attempt 2).
- **What:** swap grew 2.31 → 6.36 GB (guard limit: 4 GB growth); the harness exited 1 and dbench started
  attempt 2 seconds later, before the machine had recovered. The story then completed (6/6 own, 55/57).
- **Bucket:** environment — high for the stop (what filled memory wasn't identified from the record);
  the instant restart was a dbench shortcoming. **Fixed:** `0a712ce6` (a run the guard stopped resumes
  only once the machine has recovered). Side effect on accounting: A-016.

### A-006 — gufo v2-r2 story 2 took 18 min against 52–96 min in the other runs
- **Seen:** 2026-09-30 · **Where:** gufo-pi v2-r2 story 2, the Strix Halo box.
- **What:** 18 min, 101 calls, 51k output tokens; the others: 80 min (v2-r1), 96 min (v2-r3), 52 min
  (v2-r4). Reasoning: 21k characters against 329k, 390k and 188k; largest block 4.6k against 64k, 31k, 10k.
  Own held-out: 9/10, against 10/10, 10/10 and 9/10.
- **Bucket:** genuine LLM behaviour — high: it simply thought far less that time, and the score barely
  moved. Shows how wide this stack's run-to-run spread is.

### A-007 — gufo: the agent's reply is a tool call written as text, which ends the session
- **Seen:** 2026-09-29 → 2026-10-01 05:11 (recurring) · **Where:** gufo-pi, the Strix Halo box: v2-r1 seven
  times (story 5 used all three continuations), v2-r2 twice, v2-r3 once, v2-r4 once (story 9).
- **What:** the engine returns a tool call as plain text instead of running it; the harness continues the
  session (up to 3 per story) and lists each one in the run's interventions.
- **Note 2026-10-01 09:50:** v2-r5 story 2 used all three continuations (the per-story limit) and still
  ended DONE: 8/10 of its own held-out tests, 18/20 overall, gate red. Seen 2026-09-29 → 2026-10-01 09:50.
- **Bucket:** genuine LLM behaviour (the model-plus-engine stack, measured correctly) — medium on the
  label: the cause is an engine bug reported upstream (gufo issue 304), which could as well be called
  environment. **Status:** handled by the harness; will recur until the engine is fixed.

### A-008 — Time accounting counted some seconds twice
- **Seen:** 2026-09-30 · **Where:** restarted stories and stories with waits, several stacks (e.g. gufo
  canvas-gufo-r3 story 5; Opus v2-r3 story 12's tokens overwritten rather than added).
- **Bucket:** internal bug — high. **Fixed:** `0bac2ffc` (a split counts only its own window), `b4340cbf`
  (accounting by timeline, checks recorded), `71b2165c` (an earlier attempt's waits not counted twice),
  `cc3ebaa0` and `7c9b39cd` (recounts from logs). Remaining oddities: A-015, A-016.

### A-009 — Two v1 runs contaminated: the agent read another build of the app
- **Seen:** 2026-09-30 (found in review) · **Where:** qwen 3.8 27B canvas-pi-04 story 7 (read the reference
  build through a clone the sandbox didn't hide) and qwen 3.8 Swift 27B canvas-pi-01 story 3 (read another
  run's build left in a temp directory by a re-score); both on the RTX 4090 machine.
- **Bucket:** internal bug (sandbox and leftover files let it happen; the agent taking the shortcut is
  genuine) — high. **Resolved:** both marked invalid (`7e4840db` and the canvas-pi-04 record); every story
  now gets an outside-the-workspace verdict (`282b1c10`).

### A-017 — mlx-serve v2-r2 story 10 was very long: 3 h 35 min, 652 calls, 10 compactions
- **Seen:** 2026-10-01 09:02–09:10 · **Where:** mlxserve-pi v2-r2 story 10, the M5 Max.
- **What:** 215 agent-min, 652 calls, 442k output tokens, 10 compactions, against 128 min, 363 calls and
  6 compactions for the same story in v2-r1. It kept committing throughout; its last hour was spent on its
  own e2e tests. It ended DONE with the gate green, 8/8 of its own held-out tests and 63/65 overall,
  accounting check passed.
- **Bucket:** genuine LLM behaviour — medium (the log's last hour was only seen through the live activity
  feed, not read in full). Slow but the best result for this story on this stack; no action.

### A-014 — gufo v2-r4 story 4's record says "not pushed", but it is on main
- **Seen:** 2026-10-01 03:13 · **Where:** gufo-pi v2-r4 story 4.
- **What:** `record.pushed` false / `unpushed` true with a rejected-push error (the remote had moved); the
  story's commit is on origin/main (`3c49776f`), replayed later by the harness (`b8228148`).
- **Bucket:** internal bug (a stale flag in the record; nothing lost) — high.

### A-023 — A harness test committed its fixture run to the real repository and pushed it to public main
- **First seen:** 2026-10-01 09:30 (commits made 09:23:55–09:24:48) · **Last seen:** 2026-10-01 09:35
- **Where:** not a benchmark run: `combinations/kat/combo/benchmarks/kat/r1/` on origin/main, 21 files,
  from four commits authored "t": `4b02a9d1` (run started: by the self-test), `7fa135ec`, `dc5d559c`
  (stories 1 and 2 done), `93df3d75` (final score 4/5 under kat-v1). Host in the record: the M2 MacBook Air.
- **Observed:** "kat" is the known-answer pack of the harness's own tests (`test_pipeline.py`). The text
  "by the self-test" exists only in uncommitted changes to `test_pipeline.py` in the owner's working tree:
  a new test of a run whose results live in another checkout (`split_roots_main`,
  `test_the_story_loop_with_the_results_in_another_checkout`), which by its own docstring "commits and
  pushes for real" into a throwaway checkout. On at least one run it recorded into the real checkout
  instead and pushed to the real remote. The version on disk now has a guard that refuses when the results
  root is the code's own checkout; the commits were made either before that guard existed or despite it.
- **Bucket:** internal bug (a test not isolated from the real repository) — **confidence high** that the
  test did it (record contents, author, host, timing); medium on whether the guard now on disk closes it.
- **Status:** resolved 2026-10-01 09:40: the records were removed from main in `17569810`; the private repo
  and the dashboard have none; the test's developer has been told to give it a remote of its own and a
  guard. The monitor now flags any commit on main by another author or under a fixture path.
- **As first reported:** the public repo has a made-up combination under `combinations/`, in history under the
  owner's remote; the dashboard did not list it at 09:31 but anything that walks `combinations/` will.
  Whoever is developing that test may not know it happened.
- **Suggested action:** stop running that test until it cannot reach the real remote (give it a remote of
  its own and assert the push URL, not only the results root); remove `combinations/kat/` with a normal
  commit (history rewrite is the owner's call); check the private repo for the same four records.

### A-024 — CI red on main for one commit
- **Seen:** 2026-10-01 08:58–09:13 · **Where:** the `checks` workflow on `2299dbbe`.
- **What:** the "Run every check" step failed; the next code commit, `52155b88` (a test corrected for how
  Linux names a killed session leader), ran green at 09:13. Two runs in between were cancelled by newer
  pushes, which is normal.
- **Bucket:** broken pipeline — medium (the failing check's output wasn't read; the fix's subject and the
  green run after it are the evidence). **Resolved** by `52155b88`.

### A-025 — The harness on main imports a module that was never committed: the next job to start will crash
- **First seen:** 2026-10-01 09:52 (CI red on the commit of 09:39) · **Last seen:** 2026-10-01 09:57
- **Where:** `benchmarks/spec-bench/harness/drive.py` on origin/main since `ea7748bf` (the no-commit nudge
  change). Not yet hit by a run: the four running jobs loaded their harness before it.
- **Observed:** CI on `ea7748bf`: 2 of 11 checks failed (harness unit suite, harness real-log replay),
  every test module ending in `ModuleNotFoundError: No module named 'roots'`. That commit's diff of
  `drive.py` adds `import roots` and uses `roots.RESULTS_ROOT`, `roots.CODE_ROOT` and `roots.release_tag`;
  `roots.py` is not in origin/main (it exists only as an untracked file in the owner's working tree, part
  of the unfinished results-in-another-checkout work). The nudge commit took `drive.py` whole, with that
  other work's edits in it.
- **Bucket:** internal bug — **confidence high** (the file list of origin/main, the commit's diff, CI's
  output).
- **Resolved 2026-10-01 10:05:** fixed in `55e01146` (`drive.py` as it was, plus the nudge change alone). A
  clean export of origin/main imports `drive` (checked by the monitor, which now repeats that check
  whenever main's harness changes). No job started in the broken window (08:39–09:54): the latest job start on
  any machine is 08:26. CI on the fix is green.
- **Status at first report:** open and urgent. dbench pulls main before each job, so the next job to start (Swift 1.5
  v2-r5 on the RTX 4090 machine when v2-r4 ends; Sonnet v2-r5 on the M2 MacBook Air; gufo v2-r4's
  re-score job on the Strix Halo box; any restart of a running job) will fail at import and spend its
  restarts on the same error. Running stories are safe until their process ends.
- **Suggested action:** either commit `roots.py` (with whatever else `drive.py` on main now needs, and its
  tests) or restore `drive.py` on main to the nudge change alone; confirm with a green CI run before any
  running job reaches its end. Longer term: commit by path with a review of the diff when two pieces of
  work share one working tree, and have dbench refuse to start a job on a commit whose checks are red.

---

## Summary

By bucket (A-018 is a scheduling flag and has no bucket):

| Bucket | Open: needs someone | Open: watched | Explained / resolved | Total |
|---|---|---|---|---|
| internal bug | 0 | 3 (A-015, A-016, A-020) | 9 (A-001, A-002, A-003, A-004, A-008, A-009, A-014, A-023, A-025) | 12 |
| genuine LLM behaviour | 0 | 4 (A-010, A-012, A-013, A-026) | 3 (A-006, A-007, A-017) | 7 |
| stuck job | 0 | 0 | 0 | 0 |
| broken pipeline | 1 (A-011) | 0 | 1 (A-024) | 2 |
| environment | 1 (A-022) | 0 | 1 (A-005) | 2 |
| unexplained | 0 | 2 (A-019, A-021) | 0 | 2 |
| **Total** | **2** (+A-018) | **9** | **14** | **25** (+A-018) |

By combination (an anomaly is listed under the one it mainly concerns):

| Combination | Machine | Anomalies |
|---|---|---|
| reference/sonnet-5.5 | the M2 MacBook Air | A-002, A-003, A-004, A-010, A-015, A-020, A-022 |
| reference/opus-5.5 | the M2 MacBook Air | A-021 |
| qwen 3.8 flash-next, mlxserve-pi | the M5 Max | A-001, A-005, A-016, A-017 (and A-011, A-018) |
| qwen 3.8 flash-next, gufo-pi | the Strix Halo box | A-006, A-007, A-011, A-013, A-014, A-019 (and A-018) |
| qwen 3.8 Swift 1.5 27B, llamacpp-pi | the RTX 4090 machine | A-012, A-026 |
| qwen 3.8 27B and Swift 27B (v1), llamacpp-pi | the RTX 4090 machine | A-009 |
| several | — | A-008 |
| none (harness tests, CI) | the M2 MacBook Air, CI | A-023, A-024, A-025 |
