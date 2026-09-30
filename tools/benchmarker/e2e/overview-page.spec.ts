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
  test("idle tritus, unscored v2-r7 and v2-r1's accounting, in that order, and a count", async ({ page }) => {
    await patchState(page);
    await open(page);
    expect(await needs(page).locator("li").evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.need))).toEqual(["idle", "unscored", "accounting"]);
    await expect(needs(page).locator("h2 .count")).toHaveText("3");
    await expect(needs(page).locator("h2")).toContainText("machines: all · runs: vidi · vidi-v2");
  });

  test("nothing needs you: says so, with a count of 0", async ({ page }) => {
    await patchState(page, (s) => {
      for (const m of s.machines) m.queued = Math.max(m.queued, 1);
      rowOf(s, SWIFT, "v2-r7").scores[SUITE] = { passed: 60, total: 75, flaky: 0, at: "" };
      for (const r of s.rows) for (const st of r.stories) if (st.usage?.split) st.usage.split.check = { status: "ok", problems: [] };
    });
    await open(page);
    await expect(needs(page).locator(".all-well")).toHaveText("✓ Nothing needs you.");
    await expect(needs(page).locator("h2 .count")).toHaveText("0");
  });
});

test.describe("needs you: each kind", () => {
  test("a running story with no activity: machine, run, story and how long; resolved on the machine's page", async ({ page }) => {
    await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 20; l.storyStartedAt = s.now - 40 * MIN; });
    await open(page);
    const n = need(page, "silent");
    await expect(n).toHaveCount(1);
    await expect(n).toContainText("gruntus: 3.8-swift-1.5/27b llamacpp v2-r1 on story 3 has reported nothing for 20 min");
    await expect(n.locator("a.machine-link")).toHaveAttribute("href", "#/m/gruntus");
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
    await patchMachines(page, (ms) => { const t = ms.find((m) => m.name === "tritus")!; t.ok = false; t.error = "connection refused"; delete t.node; });
    await open(page);
    await expect(need(page, "unreachable")).toContainText("tritus doesn't answer: connection refused");
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
    await expect(need(page, "ended")).toContainText("3.8-swift-1.5/27b llamacpp v2-r5 failed 1h00m ago on gruntus: agent crashed");
    await expect(need(page, "ended").locator(".need-tag")).toContainText("failed");
    await expect(need(page, "ended").locator("a.run-link")).toHaveAttribute("href", runHref(SWIFT, "v2-r5"));
    await expect(need(page, "ended").locator("a.resolve")).toHaveAttribute("href", "#/m/gruntus");
  });

  test("a stopped run from the last day is listed too, tagged stopped", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r4"), { status: "stopped", stateAt: new Date((s.now - MIN) * 1000).toISOString() }));
    await open(page);
    await expect(need(page, "ended").locator(".need-tag")).toContainText("stopped");
  });

  test("an idle machine: resolved by queueing a run on its page", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(need(page, "idle")).toContainText("tritus is idle: nothing running, nothing queued");
    await need(page, "idle").locator("a.resolve").click();
    await expect(page).toHaveURL(/#\/m\/tritus$/);
    await expect(page.locator('[data-page="machine"] [data-section="now"]')).toContainText("Idle: nothing running, nothing queued.");
  });

  test("a machine with a queue but nothing running is not idle", async ({ page }) => {
    await patchState(page, (s) => { s.machines.find((m) => m.node === "tritus")!.queued = 2; });
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
    await expect(tip(page)).toBeVisible();
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
    expect(await now(page).locator("tbody tr").evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.machine))).toEqual(["gruntus", "macbook-air", "quintus", "tritus"]);
    await nowRow(page, "quintus").locator("a.machine-link").click();
    await expect(page.locator('[data-page="machine"] h1')).toHaveText("quintus");
  });

  test("running: the run, the story with its title, minutes on it, and the queue; each a link", async ({ page }) => {
    await patchState(page);
    await open(page);
    const g = nowRow(page, "gruntus");
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
    await expect(nowRow(page, "gruntus").locator(".now-stuck")).toHaveText(" ⚠ no activity for 1h56m");
  });

  test("running, finishing: says the gates are running, and is never called silent", async ({ page }) => {
    await patchState(page, (s) => {
      const l = rowOf(s, SWIFT, "v2-r1").live!; l.currentStory = null; l.storyStartedAt = s.now - 2 * HOUR;
      s.machines.find((m) => m.node === "gruntus")!.running!.finishing = true;
    });
    await open(page);
    await expect(nowRow(page, "gruntus")).toContainText("(finishing: gates and scoring)");
    await expect(nowRow(page, "gruntus").locator(".now-stuck")).toHaveCount(0);
  });

  test("idle: says so; nothing queued", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(nowRow(page, "tritus")).toHaveAttribute("data-state", "idle");
    await expect(nowRow(page, "tritus").locator("td").first()).toHaveText("idle");
    await expect(nowRow(page, "tritus").locator("td.q")).toHaveText("nothing queued");
  });

  test("queued only: nothing running, the queue waiting", async ({ page }) => {
    await patchState(page, (s) => { s.machines.find((m) => m.node === "tritus")!.queued = 2; });
    await open(page);
    await expect(nowRow(page, "tritus")).toHaveAttribute("data-state", "queuedOnly");
    await expect(nowRow(page, "tritus").locator("td").first()).toHaveText("nothing running (2 waiting)");
    await expect(nowRow(page, "tritus").locator("td.q")).toHaveText("2 queued");
  });

  test("unreachable: says so with the error; its queue can't be told", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { const t = ms.find((m) => m.name === "gruntus")!; t.ok = false; t.error = "timed out"; });
    await open(page);
    await expect(nowRow(page, "gruntus")).toHaveAttribute("data-state", "unreachable");
    await expect(nowRow(page, "gruntus").locator("td").first()).toHaveText("unreachable timed out");
    await expect(nowRow(page, "gruntus").locator("td.q .missing")).toHaveText("—");
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
    await expect(nowRow(page, "gruntus").locator(".now-min")).toHaveAttribute("data-tip", GLOSSARY.storyMinutes.what);
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
    await expect(page).toHaveURL(/#\/m\/tritus$/);
  });
});

test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: 900 } });
  test("no sideways scroll; every need, Now row and the ranking fit the page", async ({ page }) => {
    await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 4; l.storyStartedAt = s.now - 2 * HOUR; });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROW);
    for (const sel of ['[data-section="needs"]', '[data-section="now"]', "section.combinations"]) {
      const box = await overview(page).locator(sel).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW);
      expect(await overview(page).locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  });
});
