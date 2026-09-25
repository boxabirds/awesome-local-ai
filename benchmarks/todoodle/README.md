# Todoodle

A spec pack for [spec-bench](../spec-bench/): a to-do app with authless workspaces (a secret link
is the credential), tasks and projects. 11 stories in 3 epics, in [`spec/`](spec/).

**The spec is public; the held-out parts are private.** The acceptance suite and the grading brief
live in the private repo (`awesome-local-ai-bench-private`, `packs/todoodle/acceptance/` and
`packs/todoodle/GRADING.md`), where the harness finds them when that repo is checked out next to
this one. Agents never see them: the sandbox hides the private checkout.

```sh
benchmarks/spec-bench/harness/drive.py --pack benchmarks/todoodle --dry-run                # stories + first prompt
benchmarks/spec-bench/harness/run.sh <install-id> --pack benchmarks/todoodle --epic workspaces --run-id <id>
```

Until `packs/todoodle/acceptance/tests/` exists, runs are scored on the agent's own gate only and
acceptance is reported n/a. When the held-out suite is added, tag the private repo (e.g.
`todoodle-v1`) and set `"pack_ref"` in [`bench.json`](bench.json), so every node pins the same
version (`setup-node.sh --pack benchmarks/todoodle`).
