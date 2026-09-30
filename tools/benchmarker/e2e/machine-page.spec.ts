import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// The machine page (plan 4.6), section by section: the header (reachable, unreachable, not a dbench node), Now (the
// running job and its live activity, the queue in dbench's order, jobs ended in the last day, idle, waiting), the
// operations against the fixture server's fake dbench (Stop with confirmation, Remove, Restart, Log, Queue a run,
// Remove machine), History (grouped by combination, then pack and version, with its filter in the address), every
// link landing on its entity, keyboard, and 1000 px. Then the machines list, which replaces the Machines tab.
// States the fixture lacks are made by changing what /api/state or /api/machines returns, for that test only.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const MIN = 60;
const HOUR = 3600;
const NARROW = 1000;
const enc = encodeURIComponent;
const runHref = (stack: string, run: string) => `#/vidi/r/${enc(stack)}/${enc(run)}`;
const rowOf = (s: State, stack: string, runId: string) => s.rows.find((r) => r.stack === stack && r.runId === runId)!;

const mp = (page: Page) => page.locator('[data-page="machine"]');
const header = (page: Page) => mp(page).locator('[data-section="header"]');
const fact = (page: Page, f: string) => header(page).locator(`[data-fact="${f}"]`);
const nowSec = (page: Page) => mp(page).locator('[data-section="now"]');
const history = (page: Page) => mp(page).locator('[data-section="history"]');
const job = (page: Page, id: string) => nowSec(page).locator(`[data-job="${id}"]`);
const tip = (page: Page) => page.getByRole("tooltip");
const ids = (page: Page, sel: string, attr: string) => page.locator(sel).evaluateAll((es, a) => es.map((e) => e.getAttribute(a)), attr);

/** Every running story's progress up to date, then `change`: so no story is silent unless a test makes it so. */
async function patchState(page: Page, change: (s: State) => void = () => {}) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    for (const r of s.rows) if (r.live?.status === "running") { r.live.agentMinutes ??= 0; r.live.storyStartedAt = s.now - r.live.agentMinutes * MIN; }
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

async function patchMachines(page: Page, change: (ms: { name: string; ok: boolean; error?: string; url: string; node?: Record<string, unknown> }[]) => void) {
  await page.route("**/api/machines", async (route) => {
    const res = await route.fetch();
    const ms = await res.json();
    change(ms);
    await route.fulfill({ response: res, json: ms });
  });
}

async function open(page: Page, machine: string, query = "") {
  await page.goto(`/#/m/${enc(machine)}${query}`);
  await expect(mp(page)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("header", () => {
  test("reachable: hardware, OS, dbench version, address; a breadcrumb back to the overview", async ({ page }) => {
    await open(page, "gruntus");
    await expect(header(page).locator("h1")).toHaveText("gruntus");
    await expect(fact(page, "hardware")).toHaveText("13th Gen Intel(R) Core(TM) i9-13900F · 32 cores · 63 GB RAM · NVIDIA GeForce RTX 4090 24 GB");
    await expect(fact(page, "os")).toHaveText("linux");
    await expect(fact(page, "dbench")).toHaveText("0.1.0+30085de1");
    await expect(fact(page, "reach")).toHaveText("✓ reachable http://gruntus:7717");
    await expect(mp(page).locator(".breadcrumb")).toHaveText("Overview › gruntus");
    await expect(mp(page).locator(".breadcrumb a")).toHaveAttribute("href", "#/");
  });

  test("installs: each a link to its combination's page", async ({ page }) => {
    await open(page, "gruntus");
    const links = fact(page, "installs").locator("a.combination-link");
    await expect(links).toHaveText(["3.8-swift-1.5/27b llamacpp", "3.8/27b llamacpp"]);
    await expect(links.first()).toHaveAttribute("href", `#/vidi/c/${enc(SWIFT)}`);
    await links.nth(1).click();
    await expect(page.locator('[data-page="combination"]')).toHaveAttribute("data-stack", QWEN_27B);
  });

  test("an install with no run yet: its id, saying why it has no page", async ({ page }) => {
    await patchMachines(page, (ms) => { ms.find((m) => m.name === "tritus")!.node!.combinations = [{ install_id: "new", combination: "qwen/new/pi" }]; });
    await open(page, "tritus");
    const none = fact(page, "installs").locator(".no-page");
    await expect(none).toHaveText("qwen/new/pi");
    await expect(none).toHaveAttribute("data-tip", /no run of this combination yet/);
  });

  test("nothing installed: says so", async ({ page }) => {
    await open(page, "tritus");
    await expect(fact(page, "installs")).toContainText("Nothing installed yet");
  });

  test("unreachable: the error; what dbench would say is missing, with why", async ({ page }) => {
    await patchMachines(page, (ms) => { const g = ms.find((m) => m.name === "gruntus")!; g.ok = false; g.error = "connection refused"; delete g.node; });
    await open(page, "gruntus");
    await expect(fact(page, "reach")).toHaveText("✕ unreachable: connection refused http://gruntus:7717");
    await expect(fact(page, "dbench").locator(".missing")).toHaveAttribute("data-tip", /Unreachable/);
    // The hardware falls back to what its runs' records say.
    await expect(fact(page, "hardware")).toHaveText("Intel Core i9 + RTX 4090 64GB");
    await expect(nowSec(page).locator('[data-part="no-queue-form"]')).toContainText("Unreachable: nothing can be queued on gruntus");
  });

  test("not a dbench node (a host from run records only): says so; no operations", async ({ page }) => {
    await open(page, "Apple M2 16GB");
    await expect(fact(page, "reach")).toHaveText("not in the machine list");
    await expect(fact(page, "hardware")).toHaveText("Apple M2 16GB");
    await expect(header(page).getByRole("button", { name: "Remove machine…" })).toHaveCount(0);
    await expect(nowSec(page)).toContainText("Not a dbench node");
    await expect(nowSec(page).getByRole("button")).toHaveCount(0);
  });

  test("every label explains itself from the glossary", async ({ page }) => {
    await open(page, "gruntus");
    for (const [f, term] of [["hardware", "hardware"], ["os", "os"], ["dbench", "dbenchVersion"], ["reach", "reachability"]] as const) {
      await expect(header(page).locator(`div:has(> dd[data-fact="${f}"]) dt .term`)).toHaveAttribute("data-tip", GLOSSARY[term].what);
    }
    await expect(fact(page, "installs").locator(".label .term")).toHaveAttribute("data-tip", GLOSSARY.installs.what);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("now", () => {
  test("the running job: run, job place, story and title, minutes, run time, live activity; each link lands", async ({ page }) => {
    await patchState(page);
    await open(page, "gruntus");
    const j = job(page, "vidi-v2b-swift15-r1");
    await expect(j).toHaveAttribute("data-status", "running");
    await expect(j.locator("a.run-link")).toHaveText("3.8-swift-1.5/27b llamacpp v2-r1");
    await expect(j.locator(".job-name")).toContainText("job 1 of 1");
    await expect(j.locator(".job-name")).toHaveAttribute("data-tip", /dbench id: vidi-v2b-swift15-r1/);
    await expect(j.locator('[data-part="story"]')).toHaveText("story 3 of 11 See other people's edits live");
    await expect(j.locator('[data-part="times"]')).toContainText("4 min on story");
    await expect(j.locator('[data-part="activity"]')).toContainText("41 calls · 12k output tokens · tasks 1/2");
    await expect(j.locator('[data-part="activity"] .tag-live')).toHaveText("live");
    await expect(j.locator('[data-part="activity"] .log')).toHaveText("write: src/shared/protocol.ts");
    await expect(j.locator(".now-stuck")).toHaveCount(0);
    await j.locator("a.story-run-link").click();
    await expect(page).toHaveURL(new RegExp(`/r/${enc(SWIFT).replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")}/v2-r1/s/3$`));
    await page.goBack();
    await job(page, "vidi-v2b-swift15-r1").locator("a.run-link").click();
    await expect(page.locator('[data-page="run"] h1 .run-id')).toHaveText("v2-r1");
  });

  test("a running story with no activity is flagged, with how long", async ({ page }) => {
    await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 4; l.storyStartedAt = s.now - HOUR; });
    await open(page, "gruntus");
    await expect(job(page, "vidi-v2b-swift15-r1").locator(".now-stuck")).toHaveText("⚠ no activity for 56 min");
    await expect(job(page, "vidi-v2b-swift15-r1").locator(".now-stuck")).toHaveAttribute("data-tip", GLOSSARY.needSilent.what);
  });

  test("a story just started says so instead of zeros; one finishing says its gates are running", async ({ page }) => {
    await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; Object.assign(l, { calls: null, agentMinutes: null, currentStory: null }); });
    await open(page, "gruntus");
    const j = job(page, "vidi-v2b-swift15-r1");
    await expect(j.locator('[data-part="activity"]')).toContainText("first numbers within a minute");
    await expect(j.locator('[data-part="story"]')).toContainText("(finishing: gates and scoring)");
    await expect(j.locator('[data-part="times"] .missing')).toHaveText("—");
  });

  test("the queue in dbench's order, with each place; then jobs ended in the last day", async ({ page }) => {
    await patchState(page);
    await open(page, "gruntus");
    expect(await ids(page, '[data-section="now"] .mp-queue [data-job]', "data-job")).toEqual(["vidi-v2b-swift15-r2", "vidi-v2b-swift15-r3", "vidi-v2b-27b-r1"]);
    await expect(nowSec(page).locator(".mp-queue .mp-pos")).toHaveText(["2nd", "3rd", "4th"]);
    await expect(job(page, "vidi-v2b-27b-r1").locator("a.run-link")).toHaveAttribute("href", runHref(QWEN_27B, "v2-r1"));
    expect(await ids(page, '[data-section="now"] .mp-ended [data-job]', "data-job")).toEqual(["vidi-v2b-27b-r2", "vidi-v2b-swift15-r5-again1"]);
    await expect(job(page, "vidi-v2b-swift15-r5-again1").locator(".job-name")).toContainText("job 2 of 2");
  });

  test("idle: nothing running, nothing queued, said plainly", async ({ page }) => {
    await patchState(page);
    await open(page, "tritus");
    await expect(nowSec(page).locator(".mp-idle")).toHaveText("Idle: nothing running, nothing queued.");
    await expect(nowSec(page).locator(".mp-idle")).toHaveAttribute("data-now", "idle");
    await expect(nowSec(page)).toContainText("Nothing queued.");
  });

  test("a queue waiting with nothing running is not idle", async ({ page }) => {
    await patchState(page, (s) => {
      const r = rowOf(s, SWIFT, "v2-r1"); r.live!.status = "queued"; r.status = "queued"; r.live!.queue = { position: 1, ahead: [] };
    });
    await open(page, "gruntus");
    await expect(nowSec(page).locator(".mp-idle")).toHaveAttribute("data-now", "queuedOnly");
    await expect(nowSec(page).locator(".mp-idle")).toHaveText("Nothing running: the queue is waiting.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("operations, against the fake dbench", () => {
  test("Stop asks first, with the safe answer focused; Keep running (or Escape) keeps it", async ({ page }) => {
    await open(page, "gruntus");
    const j = job(page, "vidi-v2b-swift15-r1");
    await j.getByRole("button", { name: "Stop" }).click();
    await expect(j.getByRole("alertdialog")).toContainText("Stop vidi-v2b-swift15-r1? It throws away the story in progress");
    await expect(j.getByRole("button", { name: "Keep running" })).toBeFocused();
    await j.getByRole("button", { name: "Keep running" }).click();
    await expect(j.getByRole("alertdialog")).toHaveCount(0);
    await j.getByRole("button", { name: "Stop" }).click();
    await page.keyboard.press("Escape");
    await expect(j.getByRole("alertdialog")).toHaveCount(0);
    await expect(j.getByRole("button", { name: "Stop" })).toBeFocused();
    await expect(j).toHaveAttribute("data-status", "running");
  });

  test("Yes, stop it: the job ends, and can be restarted, which queues a new job for the run", async ({ page }) => {
    await open(page, "gruntus");
    const j = job(page, "vidi-v2b-swift15-r1");
    await j.getByRole("button", { name: "Stop" }).click();
    await j.getByRole("button", { name: "Yes, stop it" }).click();
    const ended = nowSec(page).locator('.mp-ended [data-job="vidi-v2b-swift15-r1"]');
    await expect(ended).toHaveAttribute("data-status", "cancelled");
    await expect(nowSec(page).locator(".mp-idle")).toBeVisible();
    await ended.getByRole("button", { name: "Restart" }).click();
    await expect(nowSec(page).locator('.mp-queue [data-job="vidi-v2b-swift15-r1-again1"]')).toBeVisible();
  });

  test("Remove takes a queued job off the queue without asking", async ({ page }) => {
    await open(page, "gruntus");
    await job(page, "vidi-v2b-swift15-r2").getByRole("button", { name: "Remove" }).click();
    await expect(nowSec(page).locator('.mp-queue [data-job="vidi-v2b-swift15-r2"]')).toHaveCount(0);
    await expect(nowSec(page).locator('.mp-ended [data-job="vidi-v2b-swift15-r2"]')).toHaveAttribute("data-status", "cancelled");
  });

  test("Log shows the job's log and hides it again", async ({ page }) => {
    await open(page, "gruntus");
    const j = job(page, "vidi-v2b-swift15-r3");
    await j.getByRole("button", { name: "Log" }).click();
    await expect(j.locator("pre.log-view")).toContainText("gruntus vidi-v2b-swift15-r3: fixture log");
    await j.getByRole("button", { name: "Hide log" }).click();
    await expect(j.locator("pre.log-view")).toHaveCount(0);
  });

  test("Queue a run: starts on what the machine runs now; the new job joins the queue and the history", async ({ page }) => {
    await open(page, "gruntus");
    const form = nowSec(page).getByRole("form", { name: "Queue a run on gruntus" });
    await expect(form.getByLabel("Combination")).toHaveValue("swift15-qwen38-27b");
    await form.getByLabel("Combination").selectOption("qwen38-27b");
    await form.getByLabel("Run id").fill("v3-r1");
    await form.getByRole("button", { name: "Queue" }).click();
    await expect(form).toContainText("gruntus: job vidi-qwen38-27b-v3-r1 queued");
    await expect(nowSec(page).locator('.mp-queue [data-job="vidi-qwen38-27b-v3-r1"]')).toBeVisible();
    await expect(history(page).locator(`[data-stack="${QWEN_27B}"] tr[data-run="v3-r1"]`)).toContainText("queued");
  });

  test("Queue a run: a run id the fake refuses shows why; Queue waits for a run id", async ({ page }) => {
    await open(page, "gruntus");
    const form = nowSec(page).getByRole("form", { name: "Queue a run on gruntus" });
    await expect(form.getByRole("button", { name: "Queue" })).toBeDisabled();
    await form.getByLabel("Run id").fill("bad id!");
    await form.getByRole("button", { name: "Queue" }).click();
    await expect(form.locator(".err")).toContainText("isn't valid");
  });

  test("Remove machine asks first; Keep keeps it; Remove takes it off the list and leaves for the overview", async ({ page }) => {
    await open(page, "gruntus");
    await header(page).getByRole("button", { name: "Remove machine…" }).click();
    await expect(header(page)).toContainText("Remove gruntus from the list? (Its dbench service keeps running.)");
    await expect(header(page).getByRole("button", { name: "Keep" })).toBeFocused();
    await header(page).getByRole("button", { name: "Keep" }).click();
    await expect(header(page).getByRole("button", { name: "Remove machine…" })).toBeVisible();
    await header(page).getByRole("button", { name: "Remove machine…" }).click();
    await header(page).getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page).toHaveURL(/#\/$/);
    const machines = await (await page.request.get("/api/machines")).json() as { name: string }[];
    expect(machines.map((m) => m.name)).not.toContain("gruntus");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("history", () => {
  test("by combination, work in hand first; then by pack and version, v2 and v1 apart and labelled", async ({ page }) => {
    await open(page, "gruntus");
    expect(await ids(page, '[data-section="history"] .history-combo', "data-stack")).toEqual([SWIFT, QWEN_27B]);
    const swift = history(page).locator(`.history-combo[data-stack="${SWIFT}"]`);
    await expect(swift.locator("h3 a.combination-link")).toHaveAttribute("href", `#/vidi/c/${enc(SWIFT)}`);
    expect(await swift.locator("tbody").evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.group))).toEqual(["vidi|vidi-v2", "vidi|vidi-v1"]);
    await expect(swift.locator(".version-label")).toHaveText(["vidi · vidi-v2", "vidi · vidi-v1"]);
    await expect(swift.locator('tbody[data-group="vidi|vidi-v2"] .group-head')).toContainText("vidi-v2.0-pre1, vidi-v2.0-pre0 · 7 runs");
    expect(await swift.locator('tbody[data-group="vidi|vidi-v2"] tr[data-run]').evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.run)))
      .toEqual(["v2-r1", "v2-r2", "v2-r3", "v2-r5", "v2-r6", "v2-r4", "v2-r7"]);
    expect(await swift.locator('tbody[data-group="vidi|vidi-v1"] tr[data-run]').evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.run))).toEqual(["canvas-s-01"]);
  });

  test("each run: a link to its page, its status, its stories (live) and its score of record", async ({ page }) => {
    await open(page, "gruntus");
    const swift = history(page).locator(`.history-combo[data-stack="${SWIFT}"]`);
    const r5 = swift.locator('tr[data-run="v2-r5"]');
    await expect(r5.locator("a.run-link")).toHaveAttribute("href", runHref(SWIFT, "v2-r5"));
    await expect(r5.locator(".status-badge")).toHaveText("✓ finished · 2026-09-30 15:28 UTC");
    await expect(r5.locator(".h-score")).toHaveText("63/75");
    await expect(r5.locator(".mini-strip .live-n")).toHaveText("2/11");
    await expect(swift.locator("thead .tag-live")).toHaveText("live");
    await expect(swift.locator("thead .tag-record")).toHaveText("of record");
    await r5.locator("a.run-link").click();
    await expect(page.locator('[data-page="run"] h1 .run-id')).toHaveText("v2-r5");
  });

  test("no score of record: '—' with why, for each reason", async ({ page }) => {
    await open(page, "gruntus");
    const swift = history(page).locator(`.history-combo[data-stack="${SWIFT}"]`);
    const why = (run: string) => swift.locator(`tr[data-run="${run}"] .h-score .missing`);
    await expect(why("v2-r7")).toHaveAttribute("data-tip", /re-scored only under another suite version \(60\/75 under vidi-v2\.0-pre0\)/);
    await expect(why("v2-r1")).toHaveAttribute("data-tip", /Not finished: the run is running/);
    await expect(why("v2-r2")).toHaveAttribute("data-tip", /Not finished: the run is queued/);
    await expect(why("canvas-s-01")).toHaveAttribute("data-tip", /not re-scored under vidi-v2\.0-pre1 yet/);
    await expect(history(page).locator(`[data-stack="${QWEN_27B}"] tr[data-run="v2-r2"] .h-score .missing`)).toHaveAttribute("data-tip", /was cancelled before it finished/);
  });

  test("a re-score fault says so", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r6"); r.scores = {}; r.rescores = ["vidi-v2.0-pre1"]; });
    await open(page, "gruntus");
    await expect(history(page).locator(`[data-stack="${SWIFT}"] tr[data-run="v2-r6"] .h-score .missing`)).toHaveAttribute("data-tip", /the re-score gave no score of record/);
  });

  test("the status filter: a toggle per status with counts; its choice is in the address and survives a reload", async ({ page }) => {
    await open(page, "gruntus");
    const f = history(page).getByRole("group", { name: "Status" });
    await expect(f.getByRole("button")).toHaveText(["running 1", "queued 3", "finished 5", "cancelled 1"]);
    await f.getByRole("button", { name: "cancelled 1" }).click();
    await expect(history(page).locator(`[data-stack="${QWEN_27B}"] tr[data-run="v2-r2"]`)).toHaveCount(0);
    await expect(history(page).locator(".mp-head")).toContainText("9 of 10 runs");
    await expect(page).toHaveURL(/#\/m\/gruntus\?hide=cancelled$/);
    await page.reload();
    await expect(history(page).getByRole("group", { name: "Status" }).getByRole("button", { name: "cancelled 1" })).toHaveAttribute("aria-pressed", "false");
    await expect(history(page).locator(`[data-stack="${QWEN_27B}"] tr[data-run="v2-r2"]`)).toHaveCount(0);
    await history(page).getByRole("button", { name: "all" }).click();
    await expect(history(page).locator(`[data-stack="${QWEN_27B}"] tr[data-run="v2-r2"]`)).toHaveCount(1);
    await expect(page).toHaveURL(/#\/m\/gruntus$/);
  });

  test("everything filtered out, or no runs at all, says so", async ({ page }) => {
    await open(page, "gruntus", "?hide=running,queued,finished,cancelled");
    await expect(history(page)).toContainText("No runs with the statuses chosen.");
    await open(page, "tritus");
    await expect(history(page)).toContainText("No runs on this machine yet.");
  });

  test("another machine's page starts from its own address, not the last one's filter", async ({ page }) => {
    await open(page, "gruntus", "?hide=finished");
    await page.goto(`/#/m/macbook-air`);
    await expect(history(page).locator('tr[data-run="v2-r1"]')).toHaveCount(1);
    await expect(history(page).getByRole("group", { name: "Status" }).getByRole("button", { name: /^running/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("the history heading and columns explain themselves", async ({ page }) => {
    await open(page, "gruntus");
    await expect(history(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.history.what);
    await expect(history(page).locator("thead th .term").first()).toHaveAttribute("data-tip", GLOSSARY.historyRun.what);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("keyboard", () => {
  test("Tab reaches the running job's links and Stop; Enter opens the question", async ({ page }) => {
    await open(page, "gruntus");
    const j = job(page, "vidi-v2b-swift15-r1");
    await j.locator("a.run-link").focus();
    await page.keyboard.press("Tab");
    await expect(j.locator(".job-name")).toBeFocused();
    await expect(tip(page)).toContainText("dbench id: vidi-v2b-swift15-r1");
    await page.keyboard.press("Tab");
    await expect(j.getByRole("button", { name: "Stop" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(j.getByRole("button", { name: "Keep running" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(j).toHaveAttribute("data-status", "running");
  });
});

test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: 900 } });
  test("no sideways scroll; the queue form goes below the jobs", async ({ page }) => {
    await open(page, "gruntus");
    await expect(nowSec(page).getByRole("form")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROW);
    const jobs = await nowSec(page).locator(".mp-jobs").boundingBox();
    const form = await nowSec(page).getByRole("form").boundingBox();
    expect(form!.y).toBeGreaterThan(jobs!.y + jobs!.height - 1);
    for (const sel of ['[data-section="header"]', '[data-section="now"]', '[data-section="history"]']) {
      expect(await mp(page).locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The machines list replaces the Machines tab. App.tsx renders it in place of MachinesTab; until it does, these are
// skipped, and switch on by themselves when it does (MACHINES_INDEX_WIRED=1 forces them on).
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const INDEX_WIRED = process.env.MACHINES_INDEX_WIRED === "1" || APP.includes("<MachinesIndex");

test.describe("the machines list", () => {
  test.skip(!INDEX_WIRED, "App.tsx doesn't render <MachinesIndex> yet");
  const list = (page: Page) => page.getByRole("table", { name: "Machines" });
  const row = (page: Page, m: string) => list(page).locator(`tr[data-machine="${m}"]`);
  const openList = async (page: Page) => { await page.goto("/"); await page.getByRole("tab", { name: "Machines" }).click(); await expect(list(page)).toBeVisible(); };

  test("one row per machine: name, hardware, what it runs now, its queue", async ({ page }) => {
    await patchState(page);
    await openList(page);
    expect(await ids(page, '[data-page="machines"] tbody tr', "data-machine")).toEqual(["gruntus", "macbook-air", "quintus", "tritus"]);
    await expect(row(page, "gruntus").locator("td.hw")).toHaveText("13th Gen Intel(R) Core(TM) i9-13900F · 63 GB · NVIDIA GeForce RTX 4090 24 GB");
    await expect(row(page, "quintus").locator("td.hw")).toHaveText("Apple M5 Max · 128 GB");
    await expect(row(page, "gruntus")).toContainText("3.8-swift-1.5/27b llamacpp v2-r1 · story 3");
    await expect(row(page, "gruntus").locator("td.q")).toHaveText("3 queued");
    await expect(row(page, "tritus")).toHaveAttribute("data-state", "idle");
  });

  test("each machine, run and story run links to its page", async ({ page }) => {
    await patchState(page);
    await openList(page);
    await expect(row(page, "gruntus").locator("a.run-link")).toHaveAttribute("href", runHref(SWIFT, "v2-r1"));
    await expect(row(page, "macbook-air").locator("a.run-link")).toHaveAttribute("href", runHref(OPUS, "v2-r1"));
    await row(page, "gruntus").locator("a.machine-link").click();
    await expect(mp(page).locator("h1")).toHaveText("gruntus");
  });

  test("an unreachable machine: its error, and '—' for what can't be known", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { const q = ms.find((m) => m.name === "quintus")!; q.ok = false; q.error = "timed out"; delete q.node; });
    await openList(page);
    await expect(row(page, "quintus")).toHaveAttribute("data-state", "unreachable");
    await expect(row(page, "quintus").locator("td.hw .missing")).toHaveText("—");
    await expect(row(page, "quintus").locator("td.q .missing")).toHaveText("—");
  });

  test("adding a machine: over SSH it joins the list; when SSH can't, a box for the token", async ({ page }) => {
    await openList(page);
    const add = page.getByRole("form", { name: "Add a machine" });
    await add.getByLabel("Machine name").fill("sshbox");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(add).toContainText("sshbox added (its token read over SSH)");
    await expect(row(page, "sshbox")).toBeVisible();
    await add.getByLabel("Machine name").fill("newbox");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(add).toContainText("cat ~/.dbench/token");
    await add.getByLabel("Token").fill("pasted-token-0123456789");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(row(page, "newbox")).toBeVisible();
  });

  test.describe("at 1000 px", () => {
    test.use({ viewport: { width: NARROW, height: 900 } });
    test("no sideways scroll", async ({ page }) => {
      await patchState(page);
      await openList(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROW);
    });
  });
});
