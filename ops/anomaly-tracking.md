# Anomaly tracking (benchmark soak test)

A running list of things that looked wrong while the vidi benchmark ran on the four machines: what was
seen, what it turned out to be, and whether it needs someone. Kept by a monitor that only observes (it
never touches jobs, nodes, run records or harness code).

**Last updated:** 2026-10-01 14:02 UTC

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

**This file is the fault log.** From 1 Oct 2026 12:40 the dashboard shows results only; every internal fault
the system records (failed or unchecked accounting, runs without a score of record, flagged re-scores, invalid
runs, harness faults in story records, failed, cancelled or restarted jobs, unreachable or idle machines, CI)
is swept every cycle (the dashboard's `/api/faults` feed once it answers; until then the same derived from
the records and dbench) and lands here as an entry that stays open until fixed (with the commit) or explained.
The harness now repairs stale accounting and re-scores pending runs by itself at each run's start and end;
each such fault records whether that repair fixed it, and one that survives a repair attempt is a bug.

---

## Internal bugs to fix

Open entries in the internal-bug and broken-pipeline buckets, most damaging first, each with the fix or the
test that would reproduce it. Details under the entries.

| # | What | Fix / reproducing test |
|---|---|---|
| A-016 | Survived the automatic repair (13:51): on a restarted story the conversation profile still reports the killed call as the longest tool across the harness's downtime (1389 s, 1460 s) and raises a false `hung-command`; the run's `interventions.md` still omits both swap-guard stops and the restarts. (The accounting check itself is fixed.) | conversation.py: end an attempt's open tool call at that attempt's end, as accounting v4 does; drive/attempts: write a guard stop and each restart to interventions. Test: a two-attempt story whose attempt 1 ends in a guard-killed call → no `hung-command`, longest tool within one attempt, two interventions listed |
| A-031 | dbench spends all three restarts within minutes on a failure that cannot change (a pull that fails on unmerged files, a model server that exits at start, a deterministic traceback) | stop after the same exit and the same last log line twice; test in dbench with a harness that always exits 1 |
| A-011 | The M5 Max's private suite checkout is detached 31 commits past the tag with 6 private record commits not on the private main; mlx v2-r2 will end without a score of record until it is repaired | owner's repair when mlx v2-r2 ends; then the automatic re-score should produce the score. Test: `pack-version.sh` on a detached checkout at the tag's tree reports the tag |
| A-028, A-029, A-030 | Stale records: 5 older stories with a failed accounting check, 94 stories with no check (from the feed; 72 with no time split at all), 27 runs that ended before `finalize.json` existed (12 have a hand-made re-score, 15 v1 runs have live scores only) | expected to be repaired by the sweep at the next run start/end on each machine; whatever survives is a bug in `repair_records` / `needing_repair` |
| A-019 | dbench's pull before a job on the Strix Halo box: "Cannot fast-forward to multiple branches"; the job ran on the existing checkout | needs dbench's exact pull command; a job must never start on a checkout that failed to update without saying which commit it runs |
| A-020 | Live progress shows "0 tokens" for a Claude Code story in flight | print "not yet known" until the client's first `result` event |

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
- **Note 2026-10-01 13:57:** mlx v2-r2 finished with a score of record after all: 69/75 under
  vidi-v2.0-pre2 (`2b3d5847`; live 69/75, marked not comparable because the live stories carry
  `pre2+88a5c4002`). Left to check: gufo v2-r5.
- **Note 2026-10-01 11:37:** done: gufo v2-r4 now has a score of record, 66/75 (`9f6a8307`; live was 65/75,
  marked not comparable because the live suite version string differed). The failed attempt below was
  rerun by the owner. Left to check: gufo v2-r5 and mlx v2-r2.
- **Note 2026-10-01 11:28 (resolved 11:37):** the re-score of gufo v2-r4 was attempted at about 11:25 and
  failed: `finalize.json` now says `rescore: failed`, reason "[Errno 2] No such file or directory: 'uv'"
  (commit `a058bf53`). The job that ran it on the Strix Halo box doesn't have `uv` on its PATH (a unit's
  environment is not a login shell's). It also ran while v2-r5 was still on story 3, not after it ended.
  v2-r4 still has no score of record, and nothing will retry it. **Action:** rerun the re-score with
  `uv`'s directory on the unit's PATH (or its full path), preferably when v2-r5 is not scoring.
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
- **Note 2026-10-01 12:55 (from the owner):** when mlx v2-r2 ends, the M5 Max is kept free on purpose for
  the approved TensorFold checks, then mlx-serve r3–r5 are queued. Idle there is expected for a few hours;
  flagged only if still idle 4 hours after v2-r2 ends.
- **Note 2026-10-01 13:57:** mlx v2-r2 ended at 13:51; the M5 Max is idle as planned (feed: `machine_idle`).
  Flag time: 17:51 if still idle.
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
- **Note 2026-10-01 10:15:** the wait before story 7 lasted 67 min (09:05–10:12) and ended when the job
  was stopped (exit 143) and restarted as attempt 2, after `2c35fa92` (a cloud model's run is never held
  up for the machine's power or temperature). The run's record shows "stopped: exit 143" in between;
  that is the restart, not a failure. Waits so far: before story 3 (short), story 5 (short), story 7 (67 min).
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

### A-027 — Watch: the first job to run the harness from a release (not an anomaly yet)
- **Opened:** 2026-10-01 10:55, at the owner's request.
- **Where:** the RTX 4090 machine: Swift 1.5 v2-r5, queued behind v2-r4 (on story 8 at 10:52). Release
  `harness-v2026.10.01.1` (tag on `ed7e0cc6`, CI green). The other three machines still run from the
  checkout.
- **To check when it starts:** the hold releases after v2-r4 ends; the job is not refused; preflight and
  self-test pass; no restart; its run directory and records reach origin/main as usual; `run.json` and
  each story's provenance carry `harness_release: harness-v2026.10.01.1`.
- **Bucket:** none yet. **Status:** waiting for v2-r4 to end.

### A-028 — Failed accounting checks in older runs (5 stories), awaiting the automatic repair
- **First seen:** 2026-10-01 12:40 (first fault sweep) · **Last seen:** 2026-10-01 12:40
- **Where:** qwen 3.8 Swift 27B llamacpp-pi canvas-pi-03 story 5 and qwen 3.8 27B llamacpp-pi canvas-pi-04
  story 3 (the RTX 4090 machine); gufo-pi canvas-gufo-r3 story 5 and llamacpp-pi canvas-vk-02 stories 3 and 4
  (the Strix Halo box). Each with one accounting problem recorded under accounting v3. (The failed checks on
  Sonnet v2-r4 story 4 and mlx v2-r2 stories 4, 9 and 11 are A-015 and A-016.)
- **Bucket:** internal bug — medium (the checks of v3 are known to fail on cut-off calls and sleeps; v4
  changes that). **Status:** open until the sweep repairs them; a survivor is escalated.

### A-029 — Stories with no accounting check at all (63 stories in 8 older runs), awaiting the automatic repair
- **First seen:** 2026-10-01 12:40 · **Last seen:** 2026-10-01 12:40
- **Where:** reference/opus-5.5 run-2 (9 stories) and run-3 (11); qwen 3.8 27B llamacpp-pi canvas-pi-02 (8)
  and canvas-pi-03 (11); flash-next llamacpp-pi ab-s7s8-01 (5) and canvas-vk-01 (5); mtplx-pi canvas-pi-02 (11);
  mlxserve-pi v2-r2 stories 1–3 (records made before the checks existed, run still going).
- **Bucket:** internal bug — medium (records older than the accounting; the repair is meant to recompute
  them from the full logs each machine kept, where it still has them). **Status:** open until repaired.

### A-030 — Runs that ended before `finalize.json` existed (27)
- **First seen:** 2026-10-01 12:40 · **Last seen:** 2026-10-01 12:40
- **Where:** 12 with a re-score made by hand under vidi-v2.0-pre2 (Opus v2-r1..r3, Swift 1.5 v2-r1..r2, mlx
  v2-r1, gufo v2-r1..r2 and Opus run-3) and 15 v1 runs with live scores only (canvas-pi-02/03 for 27B and
  Swift 27B, canvas-mlx-01..03, kg-07-01, mtplx canvas-pi-02/03, canvas-gufo-01/exp1/exp2/r1..r3,
  canvas-vk-01/02, ab-s7s8-01).
- **Bucket:** broken pipeline — low severity (the v2 ones have their score of record in `rescore/`; the v1
  ones predate the policy). **Status:** open; the sweep's automatic re-score should write `finalize.json`
  for whichever it covers; the rest need a decision on whether v1 runs get one (passed to the owner 12:55).
  **Note 13:05:** approved; the existing v2 re-scores are being converted into scores of record now.
- **Correction 2026-10-01 13:10:** the earlier count of 12 v2 runs with a hand-made re-score was wrong: 5
  qualified. `0c2bad30` gave those five a score of record from their existing final re-score (each with a
  `migrated` field): Swift 1.5 v2-r1 61/75, v2-r2 63/75, gufo v2-r1 68/75, v2-r2 58/75, Opus v2-r3 74/75; the
  monitor saw all five `not_scored` faults clear at 13:04. mlx v2-r1, Swift 1.5 v2-r3, gufo v2-r3/r4 and
  Sonnet v2-r4 already had records. Opus v2-r1 and v2-r2 were left out because they ran under
  vidi-v2.0-pre1+94b980f-dirty, not pre2: a decision for the owner (see A-021). The rest of the 27 are v1,
  unfinished, invalid or another pack. Left open: Opus v2-r1, v2-r2 and the v1 runs.

### A-031 — dbench burnt all three restarts in minutes on failures that could not change
- **First seen:** 2026-09-25 · **Last seen:** 2026-10-01 05:15 (A-003's jobs)
- **Where:** the RTX 4090 machine, 25 Sep: canvas-4090-02b, -03, -04, four attempts each within 90 s, all
  "git pull --ff-only failed: unmerged files" in the checkout; the M5 Max, 29 Sep 19:37: vidi-v2-mlx-r1,
  four attempts in 3 min, the model server exited at start; the M2 MacBook Air, 1 Oct: the three Sonnet
  "b" jobs (A-003) and mlx v2b-r2 on the M5 Max (A-001), deterministic tracebacks.
- **Note 2026-10-01 12:57:** fix on main: `2f73890e` (the same failure twice with no progress fails the job
  instead of using every restart). Resolved once a node runs that dbench.
- **Bucket:** internal bug (dbench's restart policy) — high. **Status:** open; the newer dbench waits for an
  unfit machine instead of restarting, but a start-up failure that repeats is still retried.

### A-033 — What the fault feed reports that wasn't in this log before (mapped, no new faults)
- **First seen:** 2026-10-01 13:22
- **Observed and mapped:** `live_record_disagree` ×4: Opus v2-r1 live 0/75 against record 75/75 (A-021);
  gufo v2-r1, v2-r3, v2-r4 live one below the record (67, 65, 65 against 68, 66, 66): the re-score's three
  scorings with majority rule recover one flaky test; within the guard's threshold of 3, genuine.
  `no_workspace_bundle` ×12 and `run_ended_early` ×5: all v1 runs (canvas-*, kg-07-01, ab-s7s8-01, Opus
  run-1/run-2 and the todoodle pack), part of the A-030 decision. `job_restarted` ×26: dbench's history of
  attempt > 1, which A-001, A-003, A-005 and A-031 cover; the restart of Sonnet v2-r4 at 10:12 was deliberate.
- **Bucket:** none of its own (bookkeeping). **Status:** kept for the mapping.

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
- **Note 2026-10-01 10:15:** story 7: 0/8 of its own, 13/44 overall, gate red (the other runs: 8/8).
- **Note 2026-10-01 12:12:** story 8 has run 122 agent-min (the other runs: 17, 24 and 47 min), 90 min
  since its last commit: repeated full e2e runs that hit its own 590 s time limit, and attempts to find
  and stop whatever holds its dev server's port. Not hung (calls keep coming); over 3× the median.
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
- **Bucket:** genuine LLM behaviour — **confidence medium** (was low until the record named the command).
- **Note 2026-10-01 10:15:** the record names it: a `curl` of the agent's own local dev server with no
  time limit, 616 s (`hung-command` signal, 1 tool interruption). The story ended DONE in 49 min with 0/8
  of its own held-out tests (13/44 overall), gate red. Confidence raised to medium: the agent's server
  accepted the connection and never answered, and the agent set no timeout.
- **Status:** explained; kept here in case it recurs. The guard did its job.

### A-005 — mlx-serve v2-r2 stopped by the swap guard twice (stories 9 and 11), restarted 30 s later each time
- **First seen:** 2026-10-01 05:04 · **Last seen:** 2026-10-01 10:23 · **Where:** mlxserve-pi v2-r2 story 9, the M5 Max (job
  vidi-v2b-mlx-r2-again1, now on attempt 2).
- **What:** swap grew 2.31 → 6.36 GB (guard limit: 4 GB growth); the harness exited 1 and dbench started
  attempt 2 seconds later, before the machine had recovered. The story then completed (6/6 own, 55/57).
- **Bucket:** environment — high for the stop (what filled memory wasn't identified from the record);
  the instant restart was a dbench shortcoming. **Fixed:** `0a712ce6` (a run the guard stopped resumes
  only once the machine has recovered). Side effect on accounting: A-016.
- **Note 2026-10-01 10:25 (recurred; back under watch):** story 11 was stopped the same way at 10:22
  after 77 agent-min and 232 calls (swap 2.64 → 6.94 GB); dbench logged "restarting in 30s" and attempt 3
  was in preflight within a minute, so on this node the stop still used a restart rather than a wait
  (the node was held for a restart onto the newer dbench; whether that happened wasn't checked). One
  restart is left. Both stops came while the agent ran its whole e2e suite across three browsers at once,
  with the model server holding most of the memory: that is the likely trigger. At 10:25 the machine had
  3.9 GB of swap in use and 94% of memory free (model not yet reloaded), so the new attempt starts from a
  higher swap baseline.
- **Note 2026-10-01 10:52:** story 11 finished on attempt 3 (98 agent-min over both attempts, one nudge,
  with the new wording, then a commit): gate green, 64/70 overall, but 1/5 of its own held-out tests
  against 5/5 in v2-r1. Whether the interruption cost it those tests can't be told from one peer.
- **Note 2026-10-01 13:05 (memory context):** the model server's real footprint (`footprint`, the measure
  the harness records as `server_footprint_max_gb`) is 86–94 GB: 70.1 GB of weights, up to 16 GB of prefix
  cache, KV for 131k context unquantised, and the MTP head. It plateaus at 92–94 GB after a server start
  (v2-r2 stories 5, 7, 8, 10 on one server: 92, 92, 93, 92 GB), so not a leak. That leaves about 34 GB of
  the 128 GB for macOS, the agent's builds, the browsers and the e2e tests, which is the likely setting for
  both stops. The monitor now samples the server's footprint and swap every cycle and flags a rise of more
  than 3 GB between consecutive stories on one server.
- **Note 2026-10-01 13:57:** story 12 (no restart) reached 93 GB on the server started at 10:24, against
  81 GB in story 11 on the same server; story 11 began on a fresh server mid-story, so this is the climb to
  the 92–94 GB plateau after a start, not a leak. Run ended 69/75 with no third stop.
- **Suggested action:** if it stops a third time the job fails with no restarts left: resubmit by hand.
  Consider capping the browsers' workers for this stack's memory, or counting a guard stop as a wait.

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
- **Note 2026-10-01 11:54:** v2-r4 finished: final score 75/75 (live 75/75), gate red on stories 2, 3, 5, 9,
  10, 11 and 12. So the red gate never reflected a held-out failure. v2-r5 (started 11:47, on a quieter
  machine) has green gates on stories 1 and 2 so far, which favours the load reading.
- **Note 2026-10-01 11:28:** gate red again on stories 9, 10 and 11 (held-out 57/57, 65/65, 70/70); green
  on 4, 7 and 8. Story 9 was also marked DEGRADED.
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
- **Note 2026-10-01 12:03:** `4b7ebf25` (accounting v4: a cut-off tool call and a machine that slept are
  not failed checks) addresses this and A-016. Stories 5–12 of v2-r4 passed the check.
- **Note 2026-10-01 13:04:** repaired: `2513b83f` recomputed v2-r4 with accounting v4 (the machine slept
  30.8 s); the failed check is gone from the sweep. Resolved.
- **Status:** resolved 13:04 by `2513b83f`.

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
- **Note 2026-10-01 10:52 (recurred):** story 11, restarted after the second swap-guard stop (A-005), fails
  the check the same way as story 9: the killed tool call is "never ended" in attempt 1 and in attempt 2
  under one call id. The profile then reports that call as the longest tool (1460 s, spanning the time the
  harness was down) and raises `hung-command`, which is false here. The run's `interventions.md` lists
  neither swap-guard stop nor the restarts, although it is meant to list every intervention.
- **Note 2026-10-01 12:03:** `4b7ebf25` (accounting v4) stops counting a cut-off tool call as a failed
  check; whether the false `hung-command` and the missing interventions are covered wasn't checked.
- **Note 2026-10-01 13:57 (automatic repair checked):** mlx v2-r2 finished; finalize repaired every story
  with accounting v4 (`repair.left` empty, harness `a5c58a2a`), and all six accounting faults (stories 1–3
  unchecked, 4, 9, 11 failed) left the feed: that part is fixed. Two parts survived the repair: stories 9 and
  11 still carry `hung-command` with a longest tool of 1389 s and 1460 s (the killed call measured across
  the downtime; v4 itself records it as an interrupted call of 0 s ended by the restart), and the run's
  `interventions.md` still lists only a 30 Sep event, not the two guard stops or the restarts. Escalated as
  an internal bug that survives the repair.
- **Status:** open (two parts left); a backfill after the run ends may clear stories 1–4.
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
- **Note 2026-10-01 13:10:** Opus v2-r1 and v2-r2 were left out of the migration to scores of record
  (A-030) because they ran under vidi-v2.0-pre1 (dirty), not pre2; whether their pre2 re-scores (75/75
  for v2-r1) count is with the owner. This is the same run whose live scores are 0 from story 5.
- **Status:** open; per-story live numbers for this run are not usable. Would need the
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
  whenever main's harness changes). No job started in the broken window (09:39–09:54): the latest job start on
  any machine is 08:26. CI on the fix is green.
- **Status at first report:** open and urgent. dbench pulls main before each job, so the next job to start (Swift 1.5
  v2-r5 on the RTX 4090 machine when v2-r4 ends; Sonnet v2-r5 on the M2 MacBook Air; gufo v2-r4's
  re-score job on the Strix Halo box; any restart of a running job) will fail at import and spend its
  restarts on the same error. Running stories are safe until their process ends.
- **Suggested action:** either commit `roots.py` (with whatever else `drive.py` on main now needs, and its
  tests) or restore `drive.py` on main to the nudge change alone; confirm with a green CI run before any
  running job reaches its end. Longer term: commit by path with a review of the diff when two pieces of
  work share one working tree, and have dbench refuse to start a job on a commit whose checks are red.

### A-032 — The fault feed misses stories that have no time split at all
- **First seen:** 2026-10-01 13:22 (the feed's first answer) · **Last seen:** 2026-10-01 13:30
- **Where:** the dashboard server's `/api/faults`.
- **Observed:** the feed lists 22 `accounting_unchecked` stories, all with a `time_split` but no
  `accounting` block (todoodle Opus run-1 and run-2, ab-s7s8-01, mlx v2-r2 stories 1–3). It leaves out 55 vidi
  stories whose `time_split` is null: Opus run-2 (9) and run-3 (11), 27B canvas-pi-02 (8) and canvas-pi-03
  (11), mtplx canvas-pi-02 (11), canvas-vk-01 (5), read from origin/main's records. Those have no accounting
  at all, which is worse than an unchecked one.
- **Bucket:** internal bug (the dashboard's fault derivation) — **confidence high**.
- **Status:** resolved 2026-10-01 13:44 by `1a04cefe`: the feed now lists 94 `accounting_unchecked`, 72 of them
  stories with no time split (all packs), including every run listed above (it counts 11 for Opus run-2
  and also covers mtplx canvas-pi-01 and pi-smoke, which the monitor's own count missed). A-029 is now
  tracked from the feed.

---

## Summary

By bucket (A-018 is a scheduling flag and has no bucket):

| Bucket | Open: needs someone | Open: watched | Explained / resolved | Total |
|---|---|---|---|---|
| internal bug | 0 | 5 (A-016, A-020, A-028, A-029, A-031) | 11 (A-001, A-002, A-003, A-004, A-008, A-009, A-014, A-015, A-023, A-025, A-032) | 16 |
| genuine LLM behaviour | 0 | 4 (A-010, A-012, A-013, A-026) | 3 (A-006, A-007, A-017) | 7 |
| stuck job | 0 | 0 | 0 | 0 |
| broken pipeline | 1 (A-011) | 1 (A-030) | 1 (A-024) | 3 |
| environment | 1 (A-022) | 1 (A-005) | 0 | 2 |
| unexplained | 0 | 2 (A-019, A-021) | 0 | 2 |
| **Total** | **2** (+A-018) | **13** | **15** | **30** (+A-018, A-027, A-033) |

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
| none (harness tests, CI, dbench) | — | A-023, A-024, A-025, A-031 |
| older runs, several stacks | all four | A-028, A-029, A-030 |
