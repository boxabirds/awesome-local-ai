# Harness ↔ dbench contract: live progress and operator control

`drive.py` and `dbench serve` share two things through the run directory
(`combinations/<COMBINATION>/benchmarks/vidi/<run-id>/`). Neither is committed
(`.gitignore` in the run dir).

## `progress.json`: live story and task status (harness writes, dbench reads)

Rewritten atomically (temp file + rename) by the harness. It is updated when a
story starts or ends, and about once a minute while a story runs, whenever the
workspace's HEAD or working tree changed. dbench returns it in its status view
(`GET /v1/jobs/{id}` → `progress.stories`; `dbench status <node> <job>`).

```json
{
  "updated_at": 1790302781.2,
  "scope": "canvas",
  "stories": [
    {
      "id": 3,
      "title": "See other people's edits appear live on the same board",
      "status": "running",
      "ended_by": null,
      "reason": null,
      "verdict": null,
      "partial_base": [],
      "started_at": 1790291590.0,
      "ended_at": null,
      "agent_minutes": 187.4,
      "calls": 572,
      "output_tokens": 526585,
      "compactions": 8,
      "last_commit_at": 1790299920.0,
      "last_task_change_at": 1790299920.0,
      "accept": {"passed": 5, "total": 7},
      "tasks": [
        {"n": 8, "title": "E2E live collaboration with multiple browser contexts (TC-22 to TC-28)",
         "type": "test:e2e", "implements": ["sync.client"], "tcs": ["TC-22", "TC-23"],
         "status": "written", "found": 7, "total": 7}
      ],
      "baselines": [
        {"source": "qwen/3.8/flash-next/macos/128GB/mtplx-opencode canvas-pi-01",
         "agent_minutes": 58.4, "calls": 236, "output_tokens": 163933, "status": "DONE"}
      ],
      "recent_activity": ["bash: npx playwright test --config=playwright.nightly.config.ts …"]
    }
  ]
}
```

- `status` is `pending` | `running` | `DONE` | `PARTIAL`. DONE means the agent
  finished the story by itself; PARTIAL means it was ended early (`ended_by: "operator"`).
- `verdict` is `green` | `amber` | `red`, set on PARTIAL stories only.
  `partial_base` lists the earlier PARTIAL stories this story was built on.
- Task `status` is `not-started` | `written` | `committed` | `verified` (see `progress.py`).
- Times are Unix seconds. Readers compute ages (e.g. "last commit 1h47m ago") at display time.
- Any field may be null or missing; readers must tolerate that.

## `control/skip-story.json`: end the running story (dbench writes, harness reads)

```json
{"story": 3, "reason": "3h, no commit for 107 min: e2e/WebKit flake triage", "by": "100.71.150.106", "at": 1790303000}
```

- dbench writes it atomically only if the job is running and `story` equals the
  run's `current_story`; otherwise it refuses (409). An existing, unapplied
  `skip-story.json` is replaced.
- The harness checks it every few seconds while a story runs, and once before a
  story's agent starts, so a skip can be placed before a restart. When `story`
  matches the running story, it stops the agent (no resume, no nudge), finishes
  the story as PARTIAL, and renames the file to `control/skip-story-<N>.applied.json`.
  A file for any other story is ignored and left in place.
- The harness always goes on to the next story, if there is one.
