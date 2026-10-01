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
/** The kinds listed, in order. */
const kinds = (page: Page) => needs(page).locator("li").evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.need));
const HARNESS = "benchmarks/spec-bench/harness";
const dirOf = (run: string, stack = SWIFT) => `combinations/${stack}/benchmarks/vidi/${run}`;
// The fixture's three finished runs with no score of record, by what the harness's finalize.json says about a person:
// VK v2-r1 needs one (needs_person: true), VK v2-r2 doesn't (false), SWIFT v2-r7 doesn't say (a record from before).
const VK = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi";
const VK_MACHINE = "AMD Ryzen AI Max+ 395 128GB";
const VK_FAILED = "Its final re-score failed: the app's build failed in the re-score (exit 1) but passed where the agent worked, on the same commit. Tried 3 times, last at 2026-09-29T07:30:00Z.";
const SKIPPED = "Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre1+28ace8b, not the pack's vidi-v2.0-pre1.";
const ALL_WELL = "✓ Nothing needs you right now.";
/** What a run's page says beside its score of record while its final score is owed. */
const finalNote = (page: Page) => page.locator('[data-page="run"] [data-section="header"] [data-stat="scoreOfRecord"] [data-final-score]');
/** Every machine has work, so none is idle. */
const allBusy = (s: State) => { for (const m of s.machines) m.queued = Math.max(m.queued, 1); };
/** The harness says this run's final score needs a person, or (false) that it doesn't. */
const setNeedsPerson = (s: State, stack: string, run: string, needsPerson: boolean) => { rowOf(s, stack, run).finalize!.needsPerson = needsPerson; };
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
  test("idle node-d and the one run whose final score needs a person, in that order, and a count; nothing else", async ({ page }) => {
    await patchState(page);
    await open(page);
    expect(await kinds(page)).toEqual(["idle", "unscored"]);
    await expect(needs(page).locator("h2 .count")).toHaveText("2");
    await expect(needs(page).locator("h2")).toContainText("machines: all · runs: vidi · vidi-v2");
    await expect(need(page, "unscored")).toContainText("3.8/flash-next llamacpp v2-r1");
    // One list and no second group: nothing the system handles by itself is on the Overview.
    await expect(needs(page).locator("ul")).toHaveCount(1);
    await expect(needs(page).locator("h3")).toHaveCount(0);
    await expect(needs(page)).not.toContainText("Nothing to do");
    await expect(needs(page).locator(".all-well")).toHaveCount(0);
  });

  test("nothing needs you: the panel is one quiet line, with no heading, count or list", async ({ page }) => {
    await patchState(page, (s) => { allBusy(s); setNeedsPerson(s, VK, "v2-r1", false); });
    await open(page);
    await expect(needs(page)).toHaveText(ALL_WELL);
    await expect(needs(page).locator("h2, h3, ul, li, .count")).toHaveCount(0);
    await expect(needs(page)).toHaveAccessibleName("Needs you");
  });
});

// A finished run with no score of record is listed only when the harness says a person is needed (finalize.json's
// needs_person). Otherwise the harness retries the final re-score at the machine's next run, and the run's own pages
// say its final score is pending.
test.describe("needs you: a finished run with no score of record", () => {
  test("the harness says a person is needed: the recorded reason and attempts, what it affects, the command and the machine to run it on", async ({ page }) => {
    await patchState(page);
    await open(page);
    const n = need(page, "unscored");
    await expect(n).toHaveCount(1);
    await expect(n.locator(".need-what")).toHaveText(`3.8/flash-next llamacpp v2-r1 finished, not scored: not re-scored under ${SUITE} yet`);
    await expect(n.locator(".need-detail")).toHaveText(VK_FAILED);
    await expect(n.locator(".need-affects")).toHaveText("This run has no score of record (the final score it is ranked by), so it doesn't count in the ranking.");
    await expect(n.locator(".need-todo")).toHaveText(`Do this: Put right what that reason names, then run the final re-score again on ${VK_MACHINE}, the machine that ran it, in the repo's ${HARNESS}:`);
    await expect(n.locator("code.need-command")).toHaveText(`uv run finalize.py ../../../${dirOf("v2-r1", VK)} --pack benchmarks/vidi --record`);
    await expect(n.locator(".need-caution")).toHaveCount(0);   // its machine is running nothing
    await n.locator("a.resolve").click();
    await expect(page.locator('[data-page="run"] h1 .run-id')).toHaveText("v2-r1");
    await expect(finalNote(page)).toHaveAttribute("data-final-score", "needsPerson");
    await expect(finalNote(page)).toHaveText(`Final score needs a person: the harness can't finish it by itself. ${VK_FAILED} What to do is under “Needs you” on the Overview.`);
  });

  test("the harness says no person is needed: not listed; its run page says the final score is pending, with the reason and the attempts", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(needs(page).locator("li", { hasText: "v2-r2" })).toHaveCount(0);
    await page.goto(runHref(VK, "v2-r2"));
    await expect(page.locator('[data-page="run"] [data-section="header"] [data-stat="scoreOfRecord"] .na')).toHaveText("n/a");
    await expect(finalNote(page)).toHaveAttribute("data-final-score", "pending");
    await expect(finalNote(page)).toHaveText(`Final score pending: retried automatically at ${VK_MACHINE}'s next run. ${SKIPPED} Tried 2 times, last at 2026-09-29T12:00:00Z.`);
    await expect(page.locator('[data-page="run"] [data-section="heldout"] [data-row="record"] [data-final-score="pending"]')).toContainText("Final score pending: retried automatically");
  });

  test("the record doesn't say (one from before the harness did): not listed; pending on its run page, with no attempts invented", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(needs(page).locator("li", { hasText: "v2-r7" })).toHaveCount(0);
    await page.goto(runHref(SWIFT, "v2-r7"));
    // Its score under an older suite is still shown, beside the note that the one of record is pending.
    await expect(page.locator('[data-page="run"] [data-section="header"] [data-stat="scoreOfRecord"] .stat-value')).toHaveText("60/75");
    await expect(finalNote(page)).toHaveText(`Final score pending: retried automatically at node-a's next run. ${SKIPPED}`);
  });

  test("no finalize record at all: not listed", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, VK, "v2-r1").finalize = null; rowOf(s, SWIFT, "v2-r7").finalize = null; });
    await open(page);
    await expect(need(page, "unscored")).toHaveCount(0);
    await page.goto(runHref(VK, "v2-r1"));
    await expect(finalNote(page)).toHaveText(`Final score pending: retried automatically at ${VK_MACHINE}'s next run. Its record has no final re-score yet.`);
  });

  test("the same run once the harness says a person is needed is listed (the control), with a caution when its machine is running a job", async ({ page }) => {
    await patchState(page, (s) => setNeedsPerson(s, SWIFT, "v2-r7", true));
    await open(page);
    const n = need(page, "unscored").filter({ hasText: "v2-r7" });
    await expect(n).toContainText("3.8-swift-1.5/27b llamacpp v2-r7 finished, not scored: re-scored only under another suite version (60/75 under vidi-v2.0-pre0), not under vidi-v2.0-pre1");
    await expect(n.locator(".need-detail")).toHaveText(SKIPPED);
    await expect(n.locator("code.need-command")).toHaveText(`uv run finalize.py ../../../${dirOf("v2-r7")} --pack benchmarks/vidi --record`);
    // node-a is running v2-r1.
    await expect(n.locator(".need-caution")).toHaveText("node-a is running a job now: a re-score there would share the machine with it.");
  });

  test("a scored run is never listed, whatever its finalize record says", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, VK, "v2-r1").scores[SUITE] = { passed: 60, total: 75, flaky: 0, at: "" }; rowOf(s, VK, "v2-r1").rescores = [SUITE]; });
    await open(page);
    await expect(need(page, "unscored")).toHaveCount(0);
    await expect(need(page, "rescoreFault")).toHaveCount(0);
  });

  test("a re-score fault the harness says needs a person: the reason, and the re-score command from the run's own bundle", async ({ page }) => {
    await patchState(page, (s) => {
      const r = rowOf(s, SWIFT, "v2-r6"); r.scores = {}; r.rescores = [SUITE]; r.hasBundle = true;
      r.finalize = { rescore: "failed", reason: "no browser", version: SUITE, packRef: SUITE, at: "", needsPerson: true, attempts: 4, lastAttemptAt: "" };
    });
    await open(page);
    const n = need(page, "rescoreFault");
    await expect(n.locator(".need-detail")).toHaveText("Its final re-score failed: no browser. Tried 4 times.");
    await expect(n.locator(".need-todo")).toContainText("Do this: Re-score its final build again on node-a");
    await expect(n.locator("code.need-command")).toHaveText(`uv run rescore.py ../../../${dirOf("v2-r6")} --bundle ../../../${dirOf("v2-r6")}/workspace.bundle --pack benchmarks/vidi --final`);
  });

  test("a re-score fault the harness doesn't say needs a person: not listed; pending on its run page", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r6"); r.scores = {}; r.rescores = [SUITE]; });
    await open(page);
    await expect(need(page, "rescoreFault")).toHaveCount(0);
    await page.goto(runHref(SWIFT, "v2-r6"));
    await expect(finalNote(page)).toHaveText("Final score pending: retried automatically at node-a's next run. Its record has no final re-score yet.");
  });

  test("where its score shows elsewhere says pending too: its combination's run list and its machine's history", async ({ page }) => {
    await patchState(page);
    await page.goto(`#/vidi/c/${enc(SWIFT)}`);
    await page.locator('[data-page="combination"] tr[data-run="v2-r7"] .unscored').hover();
    await expect(tip(page)).toContainText(`Final score pending: retried automatically at node-a's next run. ${SKIPPED}`);
    await page.goto("#/m/node-a");
    await expect(page.locator(`[data-page="machine"] .history-combo[data-stack="${SWIFT}"] tr[data-run="v2-r7"] .h-score .missing`))
      .toHaveAttribute("data-tip", new RegExp("Final score pending: retried automatically at node-a's next run\\."));
  });
});

// A failed accounting check makes a story's time figures doubtful. Nobody has to do anything about it from the
// Overview (the harness recomputes its records by itself), so it is never listed there; it is said where the time
// figures are read. The fixture's v2-r1 has one on story 1 (a tool call with no end).
test.describe("needs you: a failed accounting check is not the Overview's business", () => {
  test("it is not listed, counted or hinted at on the Overview, and is still explained on its story run's page", async ({ page }) => {
    await patchState(page);
    await open(page);
    const state = await page.request.get("/api/state").then((r) => r.json()) as State;
    expect(rowOf(state, SWIFT, "v2-r1").stories.find((st) => st.id === "1")!.usage!.split!.check.status).toBe("problems");   // the failure is in the data
    await expect(need(page, "accounting")).toHaveCount(0);
    await expect(needs(page)).not.toContainText("accounting");
    await expect(needs(page)).not.toContainText("failed its checks");
    await expect(needs(page).locator("h2 .count")).toHaveText("2");   // idle node-d and VK v2-r1 only
    await page.goto(storyRunHref(SWIFT, "v2-r1", "1"));
    const story = page.locator('[data-page="storyRun"]');
    await expect(story.locator(".problems li .problem-text")).toHaveText(["Tool call t9 has no end in the log, so its time was counted up to the agent's next step."]);
    await expect(story.locator(".check-todo")).toContainText("What to do: nothing to fix");
  });

  test("with the accounting failure the only exception, the panel is the one quiet line", async ({ page }) => {
    await patchState(page, (s) => { allBusy(s); setNeedsPerson(s, VK, "v2-r1", false); });
    await open(page);
    expect((await page.request.get("/api/state").then((r) => r.json()) as State).rows.some((r) => r.stories.some((st) => st.usage?.split?.check.status === "problems"))).toBe(true);
    await expect(needs(page)).toHaveText(ALL_WELL);
  });
});

test.describe("needs you: the kinds a person must act on say what they affect and what to do", () => {
  test("the machine kinds and a failed run are to do on the machine's page: each says what it affects and the action there", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 20; l.storyStartedAt = s.now - 40 * MIN;
      Object.assign(rowOf(s, SWIFT, "v2-r5"), { status: "failed", statusNote: "agent crashed" });
      Object.assign(rowOf(s, SWIFT, "v2-r5").jobs.at(-1)!, { updatedAt: s.now - HOUR, endedAt: s.now - HOUR });
    });
    await patchMachines(page, (ms) => { ms.push({ name: "node-e", ok: false, error: "connection refused" }); });
    await open(page);
    expect(await kinds(page)).toEqual(["silent", "unreachable", "ended", "idle", "unscored"]);
    const todo = (kind: string) => need(page, kind).locator(".need-todo");
    await expect(todo("silent")).toHaveText("Do this: On node-a's page, read the job's log. If it has stopped, press Stop on the job, then Restart: the run resumes at story 3.");
    await expect(todo("unreachable")).toHaveText("Do this: Check that node-e is on, on the network, and that its dbench service is running. Its page shows the address that was tried.");
    await expect(todo("ended")).toHaveText("Do this: On node-a's page, under “Ended in the last day”, press Restart on its job: the run resumes at its first unfinished story.");
    await expect(todo("idle")).toHaveText("Do this: Queue a run with the “Queue a run” form on node-d's page.");
    await expect(need(page, "silent").locator(".need-affects")).toHaveText("The machine is held by a run that has stopped reporting, and anything queued behind it waits. No recorded result is affected.");
    await expect(need(page, "idle").locator(".need-affects")).toHaveText("No result is affected: the machine is doing no benchmarking.");
    await expect(needs(page).locator("code.need-command")).toHaveCount(1);  // only the unscored run has a command
    for (const li of await needs(page).locator("li").all()) {
      await expect(li.locator(".need-affects")).not.toBeEmpty();
      await expect(li.locator(".need-todo")).toContainText("Do this:");
    }
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

  test("a finished run not scored that needs a person: why, its links, and resolved on its run page", async ({ page }) => {
    await patchState(page);
    await open(page);
    const n = need(page, "unscored");
    await expect(n.locator("a.run-link")).toHaveAttribute("href", runHref(VK, "v2-r1"));
    await expect(n.locator("a.resolve")).toHaveAttribute("href", runHref(VK, "v2-r1"));
    await expect(n.locator("a.resolve")).toHaveText("the run →");
  });

  test("a re-score fault that needs a person: re-scored under the current suite with no score of record; resolved on the run", async ({ page }) => {
    await patchState(page, (s) => {
      const r = rowOf(s, SWIFT, "v2-r6"); r.scores = {}; r.rescores = [SUITE];
      r.finalize = { rescore: "failed", reason: "no browser", version: SUITE, packRef: SUITE, at: "", needsPerson: true, attempts: null, lastAttemptAt: "" };
    });
    await open(page);
    await expect(need(page, "rescoreFault")).toContainText(`3.8-swift-1.5/27b llamacpp v2-r6 was re-scored under ${SUITE}, but the re-score gave no score of record`);
    await expect(need(page, "unscored")).not.toContainText("v2-r6");
    await expect(need(page, "rescoreFault").locator("a.resolve")).toHaveAttribute("href", runHref(SWIFT, "v2-r6"));
  });
});

test.describe("needs you: scope", () => {
  test("run exceptions follow the header's version; machine ones don't", async ({ page }) => {
    await patchState(page);
    await open(page);
    await page.getByLabel("Version").selectOption("vidi-v1");
    await expect(need(page, "unscored")).toHaveCount(0);
    await expect(need(page, "idle")).toHaveCount(1);
  });

  test("with every version shown, a v1 run is not called unscored, even one the harness says needs a person: this suite can't score another spec", async ({ page }) => {
    await patchState(page, (s) => {
      rowOf(s, SWIFT, "canvas-s-01").finalize = { rescore: "failed", reason: "no browser", version: "vidi-v1.1", packRef: "vidi-v1.1", at: "", needsPerson: true, attempts: null, lastAttemptAt: "" };
    });
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
    await expect(need(page, "unscored")).toContainText("v2-r1");
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
    expect(await t.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.stack))).toEqual([OPUS, SWIFT, QWEN_27B, VK, MLX]);
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
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`uv run finalize.py ../../../${dirOf("v2-r1", VK)} --pack benchmarks/vidi --record`);
    await page.keyboard.press("Tab");
    await expect(n.locator("a.resolve")).toBeFocused();
  });
});

test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: 900 } });
  test("no sideways scroll; every need, Now row and the ranking fit the page", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 4; l.storyStartedAt = s.now - 2 * HOUR;
      setNeedsPerson(s, SWIFT, "v2-r7", true);  // two long commands
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
