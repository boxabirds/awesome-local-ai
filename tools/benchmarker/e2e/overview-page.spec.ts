import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// The overview (plan 4.1), section by section: that it has no "Needs you" panel, count or instruction whatever the
// state (issues are tracked outside the app); the statuses a run's own pages still show (a final score pending, or no
// longer retried, with the recorded reason); "Now" (one test per machine state); the Combinations table; the glossary
// hovers; and 1000 px. The fixture's clock is the server's, but its running stories started on fixed dates, so every
// test first brings their progress up to date and makes the state it tests itself.
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
const NARROW = 1000;
const WIDE = 1440;
/** The most space between two panels of a page (styles.css's panel margin is well under it). */
const MAX_PANEL_GAP = 32;
const enc = encodeURIComponent;
const runHref = (stack: string, run: string) => `#/vidi/r/${enc(stack)}/${enc(run)}`;
const storyRunHref = (stack: string, run: string, story: string) => `${runHref(stack, run)}/s/${story}`;
const rowOf = (s: State, stack: string, runId: string) => s.rows.find((r) => r.stack === stack && r.runId === runId)!;

const overview = (page: Page) => page.locator('[data-page="overview"]');
/** Anything that would be the removed panel, an instruction to the owner, or a command to copy. */
const PANEL = '[data-section="needs"], .needs-you, .needs, .all-well, .count, [data-need], .need-command, .need-copy, .check-command';
const OWNER_WORDS = /needs you|nothing needs|do this|what to do|uv run|backfill_timing|likely cause|accounting check/i;
// The fixture's three finished runs with no score of record, by what the harness's finalize.json says (needs_person):
// VK v2-r1 is no longer retried (true), VK v2-r2 is (false), SWIFT v2-r7 doesn't say (a record from before).
const VK = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi";
const VK_MACHINE = "AMD Ryzen AI Max+ 395 128GB";
/** What a run's page used to say beside its score while its final score was owed: nothing, now. */
const finalNote = (page: Page) => page.locator('[data-page="run"] [data-final-score], [data-page="run"] .final-score-note');
/** Every machine has work, so none is idle. */
const allBusy = (s: State) => { for (const m of s.machines) m.queued = Math.max(m.queued, 1); };
/** Everything that used to raise an item at once: a silent story, a run failed an hour ago, an idle machine (the
 * fixture's node-d), a final score no longer retried (the fixture's VK v2-r1), and a failed accounting check (the
 * fixture's SWIFT v2-r1 story 1); with patchMachines, an unreachable machine too. */
const everyException = (s: State) => {
  const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 20; l.storyStartedAt = s.now - 40 * MIN;
  Object.assign(rowOf(s, SWIFT, "v2-r5"), { status: "failed", statusNote: "agent crashed" });
  Object.assign(rowOf(s, SWIFT, "v2-r5").jobs.at(-1)!, { updatedAt: s.now - HOUR, endedAt: s.now - HOUR });
};
/** The page has no panel, count, instruction or command: in what it shows, and in its tab title. */
async function expectNoPanel(page: Page) {
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /copy/i })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(OWNER_WORDS);
  expect(await page.title()).not.toMatch(/needs|\d/i);
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
// The owner's decision: issues are program bugs, tracked outside the app. The Overview is "Now" and the Combinations
// table, with nothing where the panel was.
test.describe("no Needs you: not a panel, a heading, a quiet line, a count or a gap", () => {
  test("the fixture as it is (an idle machine and a final score no longer retried): Now is the first thing on the page", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expectNoPanel(page);
    expect(await overview(page).evaluate((el) => [...el.children].map((c) => (c as HTMLElement).dataset.section ?? c.className))).toEqual(["now", "combinations"]);   // section.combinations
    const [pageBox, nowBox] = [await overview(page).boundingBox(), await now(page).boundingBox()];
    expect(Math.abs(nowBox!.y - pageBox!.y)).toBeLessThanOrEqual(1);   // no gap left above it
    await expect(page.getByRole("banner")).not.toContainText(OWNER_WORDS);
  });

  test("with every exception at once (silent, unreachable, failed, idle, not retried, accounting): still nothing; each is a status on its own page", async ({ page }) => {
    await patchState(page, everyException);
    await patchMachines(page, (ms) => { ms.push({ name: "node-e", ok: false, error: "connection refused" }); });
    await open(page);
    await expectNoPanel(page);
    // The machines' statuses are still in "Now".
    await expect(nowRow(page, "node-a").locator(".now-stuck")).toHaveText(" ⚠ no activity for 20 min");
    await expect(nowRow(page, "node-d")).toHaveAttribute("data-state", "idle");
    await expect(nowRow(page, "node-e")).toHaveAttribute("data-state", "unreachable");
  });

  test("with nothing wrong at all: no quiet line either", async ({ page }) => {
    await patchState(page, (s) => { allBusy(s); });
    await open(page);
    await expectNoPanel(page);
    await expect(overview(page)).not.toContainText("✓");
  });

  test("the header's version and status choices filter the Combinations table only", async ({ page }) => {
    await patchState(page);
    await open(page);
    await page.getByRole("group", { name: "Status" }).getByRole("button", { name: /^finished/ }).click();
    await expect(page.getByRole("table", { name: "Combinations" }).locator(`tr[data-stack="${OPUS}"]`)).toContainText("not ranked");
    await page.getByLabel("Version").selectOption("vidi-v1");
    await expectNoPanel(page);
    await expect(now(page).locator("tbody tr")).toHaveCount(4);
  });
});

// A finished run with no score of record shows its score as pending on its own pages: one word, nothing about why,
// no machine, no retries. Never an instruction, a command, or a pointer to the Overview.
test.describe("a finished run with no score of record: pending, on its own pages", () => {
  for (const [name, stack, run] of [["VK v2-r1 (its final re-score failed)", VK, "v2-r1"], ["VK v2-r2 (skipped, retried)", VK, "v2-r2"], ["SWIFT v2-r6 (re-scored with no score)", SWIFT, "v2-r6"]] as const) {
    test(`${name}: pending, and nothing else`, async ({ page }) => {
      await patchState(page, (s) => { if (run === "v2-r6") { const r = rowOf(s, stack, run); r.scores = {}; r.rescores = [SUITE]; } });
      await page.goto(runHref(stack, run));
      await expect(page.locator('[data-page="run"] h1 .run-id')).toHaveText(run);
      await expect(finalNote(page)).toHaveCount(0);
      const lead = page.locator('[data-page="run"] [data-section="lead"]');
      await expect(lead.locator(".na")).toHaveText("pending");
      await expect(lead).not.toContainText(VK_MACHINE);
      await expectNoPanel(page);
      await expect(page.locator("body")).not.toContainText(/re-score|retr|needs a person|finalize|attempt|Overview”|skipped|failed in the/i);
    });
  }

  test("the record doesn't say (one from before): its score under an older suite is shown plainly, with nothing about the suite", async ({ page }) => {
    await patchState(page);
    await page.goto(runHref(SWIFT, "v2-r7"));
    await expect(page.locator('[data-page="run"] [data-section="header"] [data-stat="scoreOfRecord"] .lead-n')).toHaveText("60/75");
    await expect(page.locator('[data-page="run"] [data-section="header"]')).not.toContainText(/current suite/);
    await expect(page.locator("body")).not.toContainText(/pending|re-score was|retr|skipped/i);
  });

  test("a scored run says nothing of it", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, VK, "v2-r1").scores[SUITE] = { passed: 60, total: 75, flaky: 0, at: "" }; rowOf(s, VK, "v2-r1").rescores = [SUITE]; });
    await page.goto(runHref(VK, "v2-r1"));
    await expect(page.locator('[data-page="run"] [data-section="lead"]')).toContainText("60/75 held-out tests pass");
    await expect(page.locator('[data-page="run"] [data-section="header"]')).not.toContainText(/pending/i);
  });

  test("where its score shows elsewhere says pending too: its combination's run list and its machine's history", async ({ page }) => {
    await patchState(page);
    await page.goto(`#/vidi/c/${enc(SWIFT)}`);
    await expect(page.locator('[data-page="combination"] tr[data-run="v2-r7"] .pending')).toHaveText("pending");
    await page.goto("#/m/node-a");
    await expect(page.locator(`[data-page="machine"] .history-combo[data-stack="${SWIFT}"] tr[data-run="v2-r7"] .h-score .pending`)).toHaveText("pending");
    await page.goto(`#/vidi/c/${enc(VK)}`);
    await page.locator('[data-page="combination"] tr[data-run="v2-r1"] .pending').hover();
    await expect(tip(page)).toHaveText(GLOSSARY.noScore.what);
    await expect(tip(page)).not.toContainText(OWNER_WORDS);
  });
});

// Scoring and accounting are the harness's to put right, and the app says nothing of either: no "Do this", no
// "What to do", no cause, no command, no check wording, on the page or on hover. A breakdown that failed its check
// is not available, like one never recorded.
test.describe("no page asks the owner to do anything about scoring or accounting, or says a word about the check", () => {
  const story = (page: Page) => page.locator('[data-page="storyRun"]');
  const tips = (page: Page) => page.locator("[data-tip]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? "").join("\n"));

  test("the story run whose breakdown failed its check: '—', nothing about why; its run page shows the story without a bar", async ({ page }) => {
    await patchState(page);
    await page.goto(storyRunHref(SWIFT, "v2-r1", "1"));
    await expect(story(page).locator('[data-section="time"] .rp-empty')).toContainText("No time breakdown for this story.");
    await expect(story(page)).not.toContainText(/accounting|Likely cause|What to do|recompute|harness|check/i);
    await expectNoPanel(page);
    await page.goto(runHref(SWIFT, "v2-r1"));
    await expect(page.locator('[data-page="run"] [data-section="time"] [data-story="1"] .bar')).toHaveCount(0);
    await expect(page.locator('[data-page="run"] [data-section="time"] [data-story="1"] .missing')).toHaveAttribute("data-tip", "No time breakdown for this story.");
    expect(await tips(page)).not.toMatch(/accounting|Likely cause|What to do|uv run|backfill_timing|harness/i);
  });

  test("a story run with no accounting (a cloud model), its run page and its combination page: no mark, no word, on the page or on hover", async ({ page }) => {
    await patchState(page);
    for (const href of [storyRunHref(OPUS, "run-9", "1"), runHref(OPUS, "run-9"), `#/vidi/c/${enc(OPUS)}`, `#/vidi/c/${enc(SWIFT)}`, "#/vidi/s/1"]) {
      await page.goto(href);
      await expect(page.locator("[data-page]")).toBeVisible();
      await expect(page.locator(".check-flag, .check-unchecked, .check-explain, .check-summary, [data-check]")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText(/accounting|unchecked|Likely cause|What to do|⚠ /i);
      expect(await tips(page), href).not.toMatch(/accounting|unchecked|Likely cause|What to do|uv run|backfill_timing|recompute/i);
      await expectNoPanel(page);
    }
  });

  test("a machine's page: its status is still there (idle; unreachable with the error), with nothing about scoring to do", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { const t = ms.find((m) => m.name === "node-c")!; t.ok = false; t.error = "connection refused"; delete t.node; });
    await page.goto("#/m/node-d");
    await expect(page.locator('[data-page="machine"] [data-section="now"]')).toContainText("Idle: nothing running, nothing queued.");
    await expect(page.locator('[data-page="machine"]')).not.toContainText(/needs you|do this|uv run/i);
    await page.goto("#/m/node-c");
    await expect(page.locator('[data-page="machine"] [data-fact="reach"]')).toContainText("✕ unreachable");
    await expect(page.locator('[data-page="machine"]')).not.toContainText("connection refused");
    await expect(page.locator('[data-page="machine"]')).not.toContainText(/needs you|do this|uv run/i);
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

  test("unreachable: says so, never the error; its queue can't be told", async ({ page }) => {
    await patchState(page);
    await patchMachines(page, (ms) => { const t = ms.find((m) => m.name === "node-a")!; t.ok = false; t.error = "timed out"; });
    await open(page);
    await expect(nowRow(page, "node-a")).toHaveAttribute("data-state", "unreachable");
    await expect(nowRow(page, "node-a").locator("td").first()).toHaveText("unreachable");
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
test.describe("the glossary: every heading and column explains itself", () => {
  test("Now and its columns carry their glossary definitions; nothing defines a Needs you", async ({ page }) => {
    await patchState(page);
    await open(page);
    await expect(now(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.now.what);
    await expect(now(page).locator("thead th").last()).toHaveAttribute("data-tip", GLOSSARY.queue.what);
    await expect(nowRow(page, "node-a").locator(".now-min")).toHaveAttribute("data-tip", GLOSSARY.storyMinutes.what);
    await expect(nowRow(page, "node-d").locator(".idle")).toHaveAttribute("data-tip", GLOSSARY.machineIdle.what);
    for (const [id, term] of Object.entries(GLOSSARY)) {
      expect(id).not.toMatch(/^need/);
      expect(`${term.name} ${term.what}`).not.toMatch(/needs you|what to do|the command/i);
    }
  });
});

for (const width of [WIDE, NARROW]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("no sideways scroll; Now and the ranking fit the page, one after the other with the same gap as any two panels", async ({ page }) => {
      await patchState(page, (s) => { const l = rowOf(s, SWIFT, "v2-r1").live!; l.agentMinutes = 4; l.storyStartedAt = s.now - 2 * HOUR; });
      await open(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      for (const sel of ['[data-section="now"]', "section.combinations"]) {
        const box = await overview(page).locator(sel).boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(await overview(page).locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      const [pageBox, nowBox, tableBox] = [await overview(page).boundingBox(), await now(page).boundingBox(), await overview(page).locator("section.combinations").boundingBox()];
      expect(Math.abs(nowBox!.y - pageBox!.y)).toBeLessThanOrEqual(1);
      const gap = tableBox!.y - (nowBox!.y + nowBox!.height);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(MAX_PANEL_GAP);
    });
  });
}
