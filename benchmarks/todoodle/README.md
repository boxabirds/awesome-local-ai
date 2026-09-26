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

The held-out suite is pinned by `"pack_ref": "todoodle-v1"` in [`bench.json`](bench.json), so every
node runs the same version (`setup-node.sh --pack benchmarks/todoodle` checks out that tag). It has
one Playwright file per story and starts each build the way the spec runs it: the local D1 database
migrated from `migrations/`, then `wrangler dev` from the workspace root. What it covers, and which
PRD requirements it can't test from a browser, is in the private repo's
`packs/todoodle/acceptance/README.md`. A change to the suite or the grading brief is a new tag
(`todoodle-v2`), and results only compare within one version.
