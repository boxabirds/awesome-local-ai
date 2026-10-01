import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// The overview (plan 4.1), section by section: "Needs you" (one test per kind of exception, present and absent, its
// links, its order and its scope), "Now" (one test per machine state), the Combinations table, then keyboard, the
// glossary hovers, and 1000 px. The fixture's clock is the server's, but its running stories started on fixed
// dates, so every test first brings their progress up to date and makes the state it tests itself.
//
// The overview is mounted by App.tsx. Until App.tsx renders <OverviewPage>, these tests are skipped; they switch on
// by themselves when it does (OVERVIEW_WIRED=1 forces them on, for a build with the overview wired in).
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const WIRED = process.env.OVERVIEW_WIRED === "1" || APP.includes("<OverviewPage");
test.skip(!WIRED, "App.tsx doesn't render <OverviewPage> yet");

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const MLX = "qwen/3.8/flash-next/macos/128GB/mlxserve-pi";
const OPUS = "reference/opus-5.5";
const SUITE = "vidi-v2.0-pre1";
const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;
const NARROW = 1000;
const enc = encodeURIComponent;
const runHref = (stack: string, run: string) => `#/vidi/r/${enc(stack)}/${enc(run)}`;
const storyRunHref = (stack: string, run: string, story: string) => `${runHref(stack, run)}/s/${story}`;
const rowOf = (s: State, stack: string, runId: string) => s.rows.find((r) => r.stack === stack && r.runId === runId)!;

const overview = (page: Page) => page.locator('[data-page="overview"]');
const needs = (page: Page) => overview(page).locator('[data-section="needs"]');
const need = (page: Page, kind: string) => needs(page).locator(`li[data-need="${kind}"]`);
/** The panel's two groups: "do" (a person must act) and "nothing" (nothing to do now). */
const group = (page: Page, name: "do" | "nothing") => needs(page).locator(`[data-group="${name}"]`);
const kindsIn = (page: Page, name: "do" | "nothing") => group(page, name).locator("li").evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.need));
const HARNESS = "benchmarks/spec-bench/harness";
const dirOf = (run: string) => `combinations/${SWIFT}/benchmarks/vidi/${run}`;
// Recorded accounting problems, one of each class (shared/accountingView.ts).
const WAITS_TWICE = "wall 13113.4 s differs from the agent's own clock (13111.7 s + 205.8 s between sessions)";
const CLOCK_OFF = "wall 2352.1 s differs from the agent's own clock (2321.2 s)";
const ACCOUNTING_VERSION = 3;
/** Fail one recorded story's accounting check with this problem, made by the current accounting or an older one. */
function failCheck(s: State, run: string, story: string, problem: string, current: boolean | null = null) {
  rowOf(s, SWIFT, run).stories.find((st) => st.id === story)!.usage!.split!.check = { status: "problems", problems: [problem], version: ACCOUNTING_VERSION, current };
}
const now = (page: Page) => overview(page).locator('[data-section="now"]');
const nowRow = (page: Page, machine: string) => now(page).locator(`tr[data-machine="${machine}"]`);
const tip = (page: Page) => page.getByRole("tooltip");

/** Every running story's progress up to date: reported this minute, so none is silent unless a test says so. */
function current(s: State) {
  for (const r of s.rows) if (r.live?.status === "running") { r.live.agentMinutes ??= 0; r.live.storyStartedAt = s.now - r.live.agentMinutes * MIN; }
}

/** Serve the page the fixture's state, brought up to date and then changed by `change`, for this test only. */
async function patchState(page: Page, change: (s: State) => void = () => {}) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    current(s);
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

/** Serve the machine list with these machines changed (e.g. unreachable). */
async function patchMachines(page: Page, change: (ms: { name: string; ok: boolean; error?: string; node?: unknown }[]) => void) {
  await page.route("**/api/machines", async (route) => {
    const res = await route.fetch();
    const ms = await res.json();
    change(ms);
    await route.fulfill({ response: res, json: ms });
  });
}

async function open(page: Page) {
  await page.goto("/");
  await expect(overview(page)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("needs you: the fixture as it is", () => {
  test("idle node-d, unscored v2-r7 and v2-r1's accounting, in that order, and a count", async ({ page }) => {
    await patchState(page);
    await open(page);
    expect(await needs(page).locator("li").evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.need))).toEqual(["idle", "unscored", "accounting"]);
    // The count is of what a person must do: v2-r1's accounting (a call with no end) has nothing to do.
    await expect(needs(page).locator("h2 .count")).toHaveText("2");
    await expect(needs(page).locator("h2")).toContainText("machines: all · runs: vidi · vidi-v2");
  });

  test("nothing needs you: says so, with a count of 0", async ({ page }) => {
    await patchState(page, (s) => {
      for (const m of s.machines) m.queued = Math.max(m.queued, 1);
      rowOf(s, SWIFT, "v2-r7").scores[SUITE] = { passed: 60, total: 75, flaky: 0, at: "" };
      for (const r of s.rows) for (const st of r.stories) if (st.usage?.split) st.usage.split.check = { status: "ok", problems: [] };
    });
    await open(page);
    await expect(needs(page).locator(".all-well")).toHaveText("✓ Nothing needs you right now.");
    await expect(needs(page).locator("h2 .count")).toHaveText("0");
    await expect(group(page, "nothing")).toHaveCount(0);
  });
});

// Every item says what it affects and what to do, in one of two groups: what a person must do (with the command and
// where to run it, or the page to do it on), and what has nothing to do now (it waits, or no command fixes it).
test.describe("needs you: what each item affects and what to do about it", () => {
  test("two groups: what to do (idle, unscored), then what has nothing to do now (a call with no end), each counted", async ({ page }) => {
    await patchState(page);
    await open(page);
    expect(await kindsIn(page, "do")).toEqual(["idle", "unscored"]);
    expect(await kindsIn(page, "nothing")).toEqual(["accounting"]);
    await expect(group(page, "nothing").locator("h3 .term")).toHaveText(GLOSSARY.needsNothing.name);
    await expect(group(page, "nothing").locator("h3 .term")).toHaveAttribute("data-tip", GLOSSARY.needsNothing.what);
    await expect(group(page, "nothing").locator("h3 .count")).toHaveText("1");
    for (const li of await needs(page).locator("li").all()) {
      await expect(li.locator(".need-affects")).not.toBeEmpty();
      await expect(li.locator(".need-todo")).not.toBeEmpty();
    }
  });

  test("nothing needs you, but something has nothing to do now: says so, and still lists it", async ({ page }) => {
    await patchState(page, (s) => {
      for (const m of s.machines) m.queued = Math.max(m.queued, 1);
      rowOf(s, SWIFT, "v2-r7").scores[SUITE] = { passed: 60, total: 75, flaky: 0, at: "" };
    });
    await open(page);
    await expect(group(page, "do").locator(".all-well")).toHaveText("✓ Nothing needs you right now.");
    await expect(needs(page).locator("h2 .count")).toHaveText("0");
    expect(await kindsIn(page, "nothing")).toEqual(["accounting"]);
  });

  test("not scored, its final re-score skipped: the recorded reason, what it affects, the command and the machine to run it on", async ({ page }) => {
    await patchState(page);
    await open(page);
    const n = need(page, "unscored");
    await expect(n.locator(".need-detail")).toHaveText("Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre1+28ace8b, not the pack's vidi-v2.0-pre1.");
    await expect(n.locator(".need-affects")).toHaveText("This run has no score of record (the final score it is ranked by), so it doesn't count in the ranking.");
    await expect(n.locator(".need-todo")).toContainText(`Do this: Put right what that reason names, then run the final re-score again on node-a, the machine that ran it, in the repo's ${HARNESS}:`);
    await expect(n.locator("code.need-command")).toHaveText(`uv run finalize.py ../../../${dirOf("v2-r7")} --pack benchmarks/vidi --record`);
    // node-a is running v2-r1.
    await expect(n.locator(".need-caution")).toHaveText("node-a is running a job now: a re-score there would share the machine with it.");
  });

  test("not scored, its machine running nothing: no caution", async ({ page }) => {
    await patchState(page, (s) => { s.machines.find((m) => m.node === "node-a")!.running = null; });
    await open(page);
    await expect(need(page, "unscored").locator(".need-todo")).toBeVisible();
    await expect(need(page, "unscored").locator(".need-caution")).toHaveCount(0);
  });

  test("not scored, with no record of a final re-score: says so, with the same command", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r7").finalize = null; });
    await open(page);
    const n = need(page, "unscored");
    await expect(n.locator(".need-detail")).toHaveText("Its record has no final re-score: none was run, or it was recorded before the harness kept one.");
    await expect(n.locator(".need-todo")).toContainText(`Do this: Run the final re-score on node-a, the machine that ran it, in the repo's ${HARNESS}:`);
    await expect(n.locator("code.need-command")).toHaveText(`uv run finalize.py ../../../${dirOf("v2-r7")} --pack benchmarks/vidi --record`);
  });

  test("a re-score fault: the re-score command from the run's own bundle", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r6"); r.scores = {}; r.rescores = [SUITE]; r.hasBundle = true; });
    await open(page);
    const n = group(page, "do").locator('li[data-need="rescoreFault"]');
    await expect(n.locator(".need-todo")).toContainText("Do this: Re-score its final build again on node-a");
    await expect(n.locator("code.need-command")).toHaveText(`uv run rescore.py ../../../${dirOf("v2-r6")} --bundle ../../../${dirOf("v2-r6")}/workspace.bundle --pack benchmarks/vidi --final`);
  });

  test("the machine kinds and a failed run are to do, on the machine's page: each says what it affects and the action there", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 20; l.storyStartedAt = s.now - 40 * MIN;
      Object.assign(rowOf(s, SWIFT, "v2-r5"), { status: "failed", statusNote: "agent crashed" });
      Object.assign(rowOf(s, SWIFT, "v2-r5").jobs.at(-1)!, { updatedAt: s.now - HOUR, endedAt: s.now - HOUR });
    });
    await patchMachines(page, (ms) => { ms.push({ name: "node-e", ok: false, error: "connection refused" }); });
    await open(page);
    expect(await kindsIn(page, "do")).toEqual(["silent", "unreachable", "ended", "idle", "unscored"]);
    const todo = (kind: string) => group(page, "do").locator(`li[data-need="${kind}"] .need-todo`);
    await expect(todo("silent")).toHaveText("Do this: On node-a's page, read the job's log. If it has stopped, press Stop on the job, then Restart: the run resumes at story 3.");
    await expect(todo("unreachable")).toHaveText("Do this: Check that node-e is on, on the network, and that its dbench service is running. Its page shows the address that was tried.");
    await expect(todo("ended")).toHaveText("Do this: On node-a's page, under “Ended in the last day”, press Restart on its job: the run resumes at its first unfinished story.");
    await expect(todo("idle")).toHaveText("Do this: Queue a run with the “Queue a run” form on node-d's page.");
    await expect(need(page, "silent").locator(".need-affects")).toHaveText("The machine is held by a run that has stopped reporting, and anything queued behind it waits. No recorded result is affected.");
    await expect(need(page, "idle").locator(".need-affects")).toHaveText("No result is affected: the machine is doing no benchmarking.");
    await expect(group(page, "do").locator("code.need-command")).toHaveCount(1);  // only the unscored run has a command
  });

  test.describe("accounting, by what fixes it and whether the run is still going", () => {
    test("a recompute fixes it and the run has finished: to do, with the recompute command", async ({ page }) => {
      await patchState(page, (s) => failCheck(s, "v2-r5", "2", WAITS_TWICE));
      await open(page);
      const n = group(page, "do").locator('li[data-need="accounting"]');
      await expect(n).toContainText("3.8-swift-1.5/27b llamacpp v2-r5: the time accounting failed its checks on story 2");
      await expect(n.locator(".need-problem")).toHaveText("The wall time (13113.4 s) already matches the agent's own clock (13111.7 s), but 205.8 s of waits between sessions were added on top of it: they were counted twice.");
      await expect(n.locator(".need-detail")).toHaveText("Likely cause: an older harness counted the waits between sessions twice (a bug since fixed).");
      await expect(n.locator(".need-affects")).toHaveText("Only this story's time figures are affected (where its time went, its agent time); scores are not.");
      await expect(n.locator(".need-todo")).toContainText(`Do this: Recompute this record from the full logs on node-a, the machine that ran it, in the repo's ${HARNESS}:`);
      await expect(n.locator("code.need-command")).toHaveText(`uv run backfill_timing.py --recompute ../../../${dirOf("v2-r5")}`);
    });

    test("a recompute fixes it but the run is still going: waiting, with no command yet", async ({ page }) => {
      await patchState(page, (s) => failCheck(s, "v2-r1", "1", WAITS_TWICE));
      await open(page);
      await expect(group(page, "do").locator('li[data-need="accounting"]')).toHaveCount(0);
      const n = group(page, "nothing").locator('li[data-need="accounting"]');
      await expect(n).toHaveAttribute("data-lead", "Waiting");
      await expect(n.locator(".need-detail")).toHaveText("Likely cause: an older harness counted the waits between sessions twice (a bug since fixed).");
      await expect(n.locator(".need-todo")).toHaveText("Waiting: The run is still going. Recompute its record when it has finished: the command is given here then.");
      await expect(n.locator("code.need-command")).toHaveCount(0);
    });

    test("only a call with no end: nothing to do, running or not", async ({ page }) => {
      await patchState(page);
      await open(page);
      const n = group(page, "nothing").locator('li[data-need="accounting"]');
      await expect(n).toHaveAttribute("data-lead", "Nothing to do");
      await expect(n.locator(".need-problem")).toHaveText("Tool call t9 has no end in the log, so its time was counted up to the agent's next step.");
      await expect(n.locator(".need-todo")).toHaveText("Nothing to do: Recomputing reads the same log and gives the same answer. Read the part the call fell in as an upper estimate.");
    });

    test("made by the harness's current accounting, in a finished run: nothing to run; a harness problem to investigate", async ({ page }) => {
      await patchState(page, (s) => failCheck(s, "v2-r5", "2", CLOCK_OFF, true));
      await open(page);
      await expect(group(page, "do").locator('li[data-need="accounting"]')).toHaveCount(0);
      const n = group(page, "nothing").locator('li[data-need="accounting"]', { hasText: "v2-r5" });
      await expect(n.locator(".need-problem")).toHaveText("The wall time (2352.1 s) doesn't match the agent's own clock (2321.2 s).");
      await expect(n.locator(".need-detail")).toHaveText("Likely cause: not known. The harness's current accounting (version 3) made this record, so it isn't a bug since fixed.");
      await expect(n.locator(".need-todo")).toHaveText("Nothing to do: No command fixes it: recomputing gives the same answer. It is a harness problem to investigate.");
      await expect(n.locator("code.need-command")).toHaveCount(0);
    });

    test("the same problem in a record an older accounting made: a recompute, to do", async ({ page }) => {
      await patchState(page, (s) => failCheck(s, "v2-r5", "2", CLOCK_OFF, false));
      await open(page);
      await expect(group(page, "do").locator('li[data-need="accounting"] code.need-command')).toHaveText(`uv run backfill_timing.py --recompute ../../../${dirOf("v2-r5")}`);
    });

    test("one run's stories that different things fix are separate items, each in its own group", async ({ page }) => {
      await patchState(page, (s) => { failCheck(s, "v2-r5", "1", WAITS_TWICE); failCheck(s, "v2-r5", "2", CLOCK_OFF, true); });
      await open(page);
      await expect(group(page, "do").locator('li[data-need="accounting"]')).toContainText("failed its checks on story 1");
      await expect(group(page, "nothing").locator('li[data-need="accounting"]', { hasText: "v2-r5" })).toContainText("failed its checks on story 2");
    });

    test("the story run's page says the same about a record the current accounting made", async ({ page }) => {
      await patchState(page, (s) => failCheck(s, "v2-r5", "2", CLOCK_OFF, true));
      await open(page);
      await group(page, "nothing").locator('li[data-need="accounting"]', { hasText: "v2-r5" }).locator("a.resolve").click();
      const verdict = page.locator('[data-page="storyRun"] .check-todo');
      await expect(verdict).toContainText("nothing to run: recomputing does the same calculation on the same log and gives the same answer. It is a harness problem to investigate.");
      await expect(page.locator('[data-page="storyRun"] .check-command')).toHaveCount(0);
    });
  });
});

test.describe("needs you: each kind", () => {
  test("a running story with no activity: machine, run, story and how long; resolved on the machine's page", async ({ page }) => {
    await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 20; l.storyStartedAt = s.now - 40 * MIN; });
    await open(page);
    const n = need(page, "silent");
    await expect(n).toHaveCount(1);
    await expect(n).toContainText("node-a: 3.8-swift-1.5/27b llamacpp v2-r1 on story 3 has reported nothing for 20 min");
    await expect(n.locator("a.machine-link")).toHaveAttribute("href", "#/m/node-a");
    await expect(n.locator("a.run-link")).toHaveAttribute("href", runHref(SWIFT, "v2-r1"));
    await expect(n.locator("a.story-run-link")).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r1", "3"));
    await n.locator("a.resolve").click();
    await expect(page.locator('[data-page="machine"] [data-job="vidi-v2b-swift15-r1"]').getByRole("button", { name: "Stop" })).toBeVisible();
  });

  test("a story silent for less than the limit, or finishing, is not listed", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 20; l.storyStartedAt = s.now - 34 * MIN;
      const m = rowOf(s, MLX, "v2-r1").live!; m.agentMinutes = 1; m.storyStartedAt = s.now - 2 * HOUR; m.currentStory = null;
    });
    await open(page);
    await expect(need(page, "silent")).toHaveCount(0);
  });

  test("an unreachable machine: its error, resolved on its page; it is not also called idle", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { const t = ms.find((m) => m.name === "node-d")!; t.ok = false; t.error = "connection refused"; delete t.node; });
    await open(page);
    await expect(need(page, "unreachable")).toContainText("node-d doesn't answer: connection refused");
    await expect(need(page, "idle")).toHaveCount(0);
    await need(page, "unreachable").locator("a.resolve").click();
    await expect(page.locator('[data-page="machine"] [data-fact="reach"]')).toContainText("✕ unreachable: connection refused");
  });

  test("a failed run from the last day: how long ago, the reason, resolved on its machine; one older than a day is not", async ({ page }) => {
    await patchState(page, (s) => {
      Object.assign(rowOf(s, SWIFT, "v2-r5"), { status: "failed", statusNote: "agent crashed" });
      Object.assign(rowOf(s, SWIFT, "v2-r5").jobs.at(-1)!, { updatedAt: s.now - HOUR, endedAt: s.now - HOUR });
      Object.assign(rowOf(s, SWIFT, "v2-r4"), { status: "stopped", statusNote: "", stateAt: new Date((s.now - 2 * DAY) * 1000).toISOString() });
    });
    await open(page);
    await expect(need(page, "ended")).toHaveCount(1);
    await expect(need(page, "ended")).toContainText("3.8-swift-1.5/27b llamacpp v2-r5 failed 1h00m ago on node-a: agent crashed");
    await expect(need(page, "ended").locator(".need-tag")).toContainText("failed");
    await expect(need(page, "ended").locator("a.run-link")).toHaveAttribute("href", runHref(SWIFT, "v2-r5"));
    await expect(need(page, "ended").locator("a.resolve")).toHaveAttribute("href", "#/m/node-a");
  });

  test("a stopped run from the last day is listed too, tagged stopped", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r4"), { status: "stopped", stateAt: new Date((s.now - MIN) * 1000).toISOString() }));
    await open(page);
    await expect(need(page, "ended").locator(".need-tag")).toContainText("stopped");
  });

  test("an idle machine: resolved by queueing a run on its page", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(need(page, "idle")).toContainText("node-d is idle: nothing running, nothing queued");
    await need(page, "idle").locator("a.resolve").click();
    await expect(page).toHaveURL(/#\/m\/node-d$/);
    await expect(page.locator('[data-page="machine"] [data-section="now"]')).toContainText("Idle: nothing running, nothing queued.");
  });

  test("a machine with a queue but nothing running is not idle", async ({ page }) => {
    await patchState(page, (s) => { s.machines.find((m) => m.node === "node-d")!.queued = 2; });
    await open(page);
    await expect(need(page, "idle")).toHaveCount(0);
  });

  test("a finished run not scored: why, and resolved on its run page", async ({ page }) => {
    await patchState(page);
    await open(page);
    const n = need(page, "unscored");
    await expect(n).toContainText("3.8-swift-1.5/27b llamacpp v2-r7 finished, not scored: re-scored only under another suite version (60/75 under vidi-v2.0-pre0), not under vidi-v2.0-pre1");
    await n.locator("a.resolve").click();
    await expect(page.locator('[data-page="run"] h1 .run-id')).toHaveText("v2-r7");
  });

  test("a re-score fault: re-scored under the current suite with no score of record; resolved on the run", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r6"); r.scores = {}; r.rescores = [SUITE]; });
    await open(page);
    await expect(need(page, "rescoreFault")).toContainText(`3.8-swift-1.5/27b llamacpp v2-r6 was re-scored under ${SUITE}, but the re-score gave no score of record`);
    await expect(need(page, "unscored")).not.toContainText("v2-r6");
    await expect(need(page, "rescoreFault").locator("a.resolve")).toHaveAttribute("href", runHref(SWIFT, "v2-r6"));
  });

  test("accounting: each failing story a link to its story run, its problems on hover", async ({ page }) => {
    await patchState(page);
    await open(page);
    const n = need(page, "accounting");
    await expect(n).toContainText("3.8-swift-1.5/27b llamacpp v2-r1: the time accounting failed its checks on story 1");
    await n.locator("a.story-run-link").hover();
    await expect(tip(page)).toHaveText("Tool call t9 has no end in the log, so its time was counted up to the agent's next step.");
    await n.locator("a.resolve").click();
    await expect(page).toHaveURL(new RegExp(`${storyRunHref(SWIFT, "v2-r1", "1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  });
});

test.describe("needs you: scope", () => {
  test("run exceptions follow the header's version; machine ones don't", async ({ page }) => {
    await patchState(page);
    await open(page);
    await page.getByLabel("Version").selectOption("vidi-v1");
    await expect(need(page, "unscored")).toHaveCount(0);
    await expect(need(page, "accounting")).toHaveCount(0);
    await expect(need(page, "idle")).toHaveCount(1);
  });

  test("with every version shown, a v1 run is not called unscored: this suite can't score another spec", async ({ page }) => {
    await patchState(page);
    await open(page);
    await page.getByLabel("Version").selectOption("all");
    await expect(need(page, "unscored")).toHaveCount(1);
    await expect(needs(page)).not.toContainText("canvas-");
  });

  test("the status filter never hides an exception; it filters the Combinations table", async ({ page }) => {
    await patchState(page);
    await open(page);
    const filter = page.getByRole("group", { name: "Status" });
    await filter.getByRole("button", { name: /^finished/ }).click();
    await expect(need(page, "unscored")).toContainText("v2-r7");
    await expect(page.getByRole("table", { name: "Combinations" }).locator(`tr[data-stack="${OPUS}"]`)).toContainText("not ranked");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("now: one line per machine", () => {
  test("every machine, by name, each linking to its page", async ({ page }) => {
    await patchState(page);
    await open(page);
    expect(await now(page).locator("tbody tr").evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.machine))).toEqual(["node-a", "node-b", "node-c", "node-d"]);
    await nowRow(page, "node-c").locator("a.machine-link").click();
    await expect(page.locator('[data-page="machine"] h1')).toHaveText("node-c");
  });

  test("running: the run, the story with its title, minutes on it, and the queue; each a link", async ({ page }) => {
    await patchState(page);
    await open(page);
    const g = nowRow(page, "node-a");
    await expect(g).toHaveAttribute("data-state", "running");
    await expect(g.locator("td").first()).toHaveText("▶ 3.8-swift-1.5/27b llamacpp v2-r1 · story 3 See other people's edits live · 4 min");
    await expect(g.locator("td.q")).toHaveText("3 queued");
    await expect(g.locator("a.run-link")).toHaveAttribute("href", runHref(SWIFT, "v2-r1"));
    await g.locator("a.story-run-link").click();
    await expect(page.locator('[data-page="storyRun"]')).toBeVisible();
  });

  test("running and silent: flagged in the line", async ({ page }) => {
    await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 4; l.storyStartedAt = s.now - 2 * HOUR; });
    await open(page);
    await expect(nowRow(page, "node-a").locator(".now-stuck")).toHaveText(" ⚠ no activity for 1h56m");
  });

  test("running, finishing: says the gates are running, and is never called silent", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.currentStory = null; l.storyStartedAt = s.now - 2 * HOUR;
      s.machines.find((m) => m.node === "node-a")!.running!.finishing = true;
    });
    await open(page);
    await expect(nowRow(page, "node-a")).toContainText("(finishing: gates and scoring)");
    await expect(nowRow(page, "node-a").locator(".now-stuck")).toHaveCount(0);
  });

  test("idle: says so; nothing queued", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(nowRow(page, "node-d")).toHaveAttribute("data-state", "idle");
    await expect(nowRow(page, "node-d").locator("td").first()).toHaveText("idle");
    await expect(nowRow(page, "node-d").locator("td.q")).toHaveText("nothing queued");
  });

  test("queued only: nothing running, the queue waiting", async ({ page }) => {
    await patchState(page, (s) => { s.machines.find((m) => m.node === "node-d")!.queued = 2; });
    await open(page);
    await expect(nowRow(page, "node-d")).toHaveAttribute("data-state", "queuedOnly");
    await expect(nowRow(page, "node-d").locator("td").first()).toHaveText("nothing running (2 waiting)");
    await expect(nowRow(page, "node-d").locator("td.q")).toHaveText("2 queued");
  });

  test("unreachable: says so with the error; its queue can't be told", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { const t = ms.find((m) => m.name === "node-a")!; t.ok = false; t.error = "timed out"; });
    await open(page);
    await expect(nowRow(page, "node-a")).toHaveAttribute("data-state", "unreachable");
    await expect(nowRow(page, "node-a").locator("td").first()).toHaveText("unreachable timed out");
    await expect(nowRow(page, "node-a").locator("td.q .missing")).toHaveText("—");
  });

  test("a machine in the list that dbench's job list doesn't have is listed, as unreachable", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { ms.push({ name: "newbox", ok: true, node: { hostname: "newbox" } }); });
    await open(page);
    await expect(nowRow(page, "newbox")).toHaveAttribute("data-state", "unreachable");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("the Combinations table", () => {
  test("is there, ranked on finished runs of record, each combination a link to its page", async ({ page }) => {
    await patchState(page);
    await open(page);
    const t = overview(page).getByRole("table", { name: "Combinations" });
    expect(await t.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.stack))).toEqual([OPUS, SWIFT, QWEN_27B, MLX]);
    await t.locator(`tr[data-stack="${SWIFT}"] a.combination-link`).click();
    await expect(page.locator('[data-page="combination"]')).toBeVisible();
  });

  test("with no run for the choices, says so instead of an empty table", async ({ page }) => {
    await patchState(page);
    await open(page);
    await page.getByRole("group", { name: "Status" }).getByRole("button", { name: "only running" }).click();
    await page.getByRole("group", { name: "Status" }).getByRole("button", { name: /^running/ }).click();
    await expect(overview(page).locator('[data-section="combinations"]')).toContainText("No runs for this pack, version and status.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("the glossary: every heading and tag explains itself", () => {
  test("Needs you, Now, each tag and the Now columns carry their glossary definitions", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(needs(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.needsYou.what);
    await expect(now(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.now.what);
    await expect(need(page, "idle").locator(".need-tag")).toHaveAttribute("data-tip", GLOSSARY.needIdle.what);
    await expect(need(page, "unscored").locator(".need-tag")).toHaveAttribute("data-tip", GLOSSARY.needUnscored.what);
    await expect(need(page, "accounting").locator(".need-tag")).toHaveAttribute("data-tip", GLOSSARY.needAccounting.what);
    await expect(now(page).locator("thead th").last()).toHaveAttribute("data-tip", GLOSSARY.queue.what);
    await expect(nowRow(page, "node-a").locator(".now-min")).toHaveAttribute("data-tip", GLOSSARY.storyMinutes.what);
  });
});

test.describe("keyboard", () => {
  test("a tag shows its definition on focus; Tab reaches each link in order; Enter follows it", async ({ page }) => {
    await patchState(page);
    await open(page);
    const tag = need(page, "idle").locator(".need-tag");
    await tag.focus();
    await expect(tip(page)).toHaveText(GLOSSARY.needIdle.what);
    await page.keyboard.press("Tab");
    await expect(need(page, "idle").locator("a.machine-link")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(need(page, "idle").locator("a.resolve")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/m\/node-d$/);
  });

  test("a command is reached by Tab between the item's links and its page link, and Enter copies it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await patchState(page);
    await open(page);
    const n = need(page, "unscored");
    await n.locator("a.run-link").focus();
    await page.keyboard.press("Tab");
    const copy = n.getByRole("button", { name: "Copy the command" });
    await expect(copy).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(n.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`uv run finalize.py ../../../${dirOf("v2-r7")} --pack benchmarks/vidi --record`);
    await page.keyboard.press("Tab");
    await expect(n.locator("a.resolve")).toBeFocused();
  });
});

test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: 900 } });
  test("no sideways scroll; every need, Now row and the ranking fit the page", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 4; l.storyStartedAt = s.now - 2 * HOUR;
      failCheck(s, "v2-r5", "1", WAITS_TWICE); failCheck(s, "v2-r5", "2", CLOCK_OFF, true);  // a long command, and both groups
    });
    await open(page);
    await expect(needs(page).locator("code.need-command")).toHaveCount(2);
    for (const cmd of await needs(page).locator("code.need-command").all()) {
      const box = await cmd.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROW);
    for (const sel of ['[data-section="needs"]', '[data-section="now"]', "section.combinations"]) {
      const box = await overview(page).locator(sel).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW);
      expect(await overview(page).locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  });
});
