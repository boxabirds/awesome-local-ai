# Agent containment: the orchestrator owns every process the agent starts

Status: implemented 29 Sep 2026 in `benchmarks/spec-bench/harness/containment.py`; tests 1–3 below pass on gruntus and tritus; test 4 (live) comes with each Linux machine's next run.

## The problem

The benchmark harness starts a coding agent and, story by story, lets it run commands: builds, tests, dev servers. Those commands start processes of their own, and some outlive the command that started them:

- **Leaked test servers.** On gruntus (Swift 27B, canvas-pi-03, story 10) 49 `wrangler dev` servers from the agent's own e2e helper were still running 1 to 28 minutes after their tests ended, each with two `workerd` processes: about 20 GB. Their parents were gone (`sh` → `systemd --user`). The helper stops its servers in teardown; teardown never ran because the test run was cut off.
- **The harness cuts runs off itself.** Its hang guard interrupts a tool call that is silent for 10 minutes (twice in that same story). The agent's shell dies; what it started does not.
- **The cost is scores.** Story 5 of the same run was stopped by the memory guard (7% free < 8%) with about 28 GB held by something other than the model server. A stopped story scores what it had built at that moment.

Killing by process group, or by "working in the agent's workspace", misses these. Process groups serve job control: programs routinely give servers a group of their own so they can stop the whole tree later (Node's `spawn(..., { detached: true })`, `setsid`, daemons), and when their cleanup never runs the server sits in a group nobody kills. The orchestrator has to hold even when the code it runs is careless: that code is written by the model under test.

## The proposal

### 1. Contain the agent in a cgroup (Linux)

Each agent session runs in its own systemd user scope:

```
systemd-run --user --scope --quiet --collect --unit=spec-bench-<run>-s<story>-<n> \
    -p MemoryMax=<limit> -- <the sandboxed agent command>
```

The kernel puts every child in its parent's cgroup at fork, and an unprivileged process cannot move out of it: `setsid`, double forks and reparenting change its process group and parent, not its cgroup. So the orchestrator can always list every process the agent ever started (`cgroup.procs`), measure them (`memory.current`, `memory.peak`), cap them (`memory.max`) and kill them all at once (`cgroup.kill`, no race with processes forking at that moment).

Checked on both Linux bench machines (29 Sep 2026): a `sleep` that called `setsid` and double-forked (parent init, its own process group) stayed in the scope; `memory.max` was set; `cgroup.kill` from the user account left no members and the unit went away. gruntus: systemd 249, kernel 6.8; tritus: systemd 259, kernel 7.0.

**Memory limit.** `MemoryMax` is the memory available when the story starts, less a reserve for the operating system and the harness. If the agent's processes exceed it, the kernel's OOM killer acts inside the agent's scope (where every process already has the highest OOM score), never on the model server. The existing memory guard (stop the story below 8% free) stays as the last resort.

### 2. Reap at points where the orchestrator knows the answer

| When | What is killed | Why it is safe |
|---|---|---|
| The harness interrupts a tool call (hang guard) | every process in the scope that started after that tool call began (by process start time, with a 2 s allowance: the harness hears of a call from the agent's event stream slightly late), except the agent and the wrappers above it | the call is being cut off by the harness; nothing it started can still be in use by it |
| Free memory falls below the reap threshold | orphans in the scope (no ancestor is the agent), oldest first, older than a grace period | an orphan's starter is gone; the grace period spares a server the agent deliberately put in the background moments ago |
| The story ends | the whole scope (`cgroup.kill`) | as today's between-story clean-up, but complete |

Every reaping is recorded in the story's telemetry (what, how old, how much memory, which rule), with the scope's peak memory, so a run shows how much it leaked and when.

### 3. Safety rules for the orchestrator itself

A first probe resolved an empty unit lookup to the cgroup root and tried to write `cgroup.kill` there; the kernel refused. So:

- A scope's cgroup path must be under this user's own `user@<uid>.service`, must end in the scope's own unit name, and must exist. Anything else raises; nothing is ever killed by a path that was not checked.
- Only processes whose `/proc/<pid>/cgroup` names that same scope are signalled.

### 4. Where it does not apply

- **macOS (quintus)** has no cgroups (the closest mechanism, "coalitions", is not a public API). There the harness keeps today's approach: process groups plus processes working in the agent's workspace, and the between-story clean-up.
- **A Linux host without a reachable systemd user manager** falls back the same way, and the run records that containment was off.

## Policy

Containment is environment hygiene, like the between-story clean-up. It takes nothing from the held-out suite and gives the agent no feedback from it (EVALUATION-POLICY rule 6). One visible effect: an agent that relied on a process leaked by a call the harness interrupted will find it gone.

## How it is tested

1. **Unit tests (any platform):** the wrapped command; cgroup-path validation (rejects the root, another user's slice, a path not ending in the unit, a missing path, an empty lookup); orphan classification from a synthetic process table; the interrupted-call rule (only processes started after the snapshot, never the agent); the memory-pressure rule (orphans only, oldest first, grace respected); the telemetry record.
2. **Linux integration tests (skipped elsewhere), run on a bench machine from a separate copy of the harness so live runs are untouched:**
   - a process that escapes by `setsid` and a double fork is still listed and is killed by the scope kill;
   - interrupt reaping kills only what started after the snapshot;
   - `MemoryMax` is enforced inside the scope while a process outside it is unaffected;
   - a failed lookup never reaches the cgroup root.
3. **A fake agent through the real harness path on Linux:** it starts a detached server the way the agent's e2e helper does and then goes silent; the hang guard interrupts it; the server must be gone and the reaping recorded. A second fake exits normally leaving a detached server behind; it must be reaped at the end of the story.
4. **Live:** the next run on a Linux bench machine records the scope's peak memory and every reaping; leaked `wrangler dev` servers must not survive an interrupted call.
