import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { parseRoute } from "../shared/routes.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// The run page, section by section in reading order (header, stories, time, cost, held-out, when it ran, compare,
// related), then links and keyboard. Within a section, one test per state that changes what it shows: finished and
// scored, finished with its score pending, running, queued, failed, cancelled; data present or absent; a cloud model.
// States the fixture doesn't have are made by changing the state the page gets, for that test only.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const GUFO = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const WEB = "https://github.com/boxabirds/awesome-local-ai";
const enc = encodeURIComponent;
const runPath = (stack: string, run: string) => `/#/vidi/r/${enc(stack)}/${enc(run)}`;
const storyRunHref = (stack: string, run: string, story: string) => `#/vidi/r/${enc(stack)}/${enc(run)}/s/${story}`;
const section = (page: Page, id: string) => page.locator(`[data-page="run"] [data-section="${id}"]`);
const rowOf = (s: State, stack: string, runId: string) => s.rows.find((r) => r.stack === stack && r.runId === runId)!;
const tip = (page: Page) => page.getByRole("tooltip");

/** Serve the page a changed state for this test: the real one, passed through `change`. */
async function patchState(page: Page, change: (s: State) => void) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

async function open(page: Page, stack: string, run: string) {
  await page.goto(runPath(stack, run));
  await expect(page.locator('[data-page="run"]')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("header: identity", () => {
  test("combination, run id, machine, pack version, suite", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const h = section(page, "header");
    await expect(h.locator("h1 a.combination-link")).toHaveText("3.8-swift-1.5/27b llamacpp");
    await expect(h.locator("h1 a.combination-link")).toHaveAttribute("href", `#/vidi/c/${enc(SWIFT)}`);
    await expect(h.locator("h1 .run-id")).toHaveText("v2-r5");
    await expect(h.locator('[data-fact="machine"]')).toHaveText("node-a");
    await expect(h.locator('[data-fact="machine"] [data-tip]')).toHaveAttribute("data-tip", "Intel Core i9 + RTX 4090 64GB");
    await expect(h.locator('[data-fact="packVersion"]')).toHaveText("vidi-v2.0-pre1");
    await expect(h.locator('[data-fact="suite"]')).toHaveText("vidi-v2.0-pre1");
  });

  test("an older pack version is shown as it is", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3");
    await expect(section(page, "header").locator('[data-fact="packVersion"]')).toHaveText("vidi-v1.1");
  });

  test("a run with no record yet: the pack version is missing, with why, not blank", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    const pv = section(page, "header").locator('[data-fact="packVersion"] .missing');
    await expect(pv).toHaveText("—");
    await expect(pv).toHaveAttribute("data-tip", /no record yet/);
  });
});

test.describe("header: status", () => {
  test("finished: ✓ and when it ended", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "header").locator('[data-fact="status"]')).toHaveText("✓ finished · 2026-09-30 15:28 UTC");
  });

  test("running: ▶", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "header").locator('[data-fact="status"] .status-badge')).toHaveAttribute("data-status", "running");
    await expect(section(page, "header").locator('[data-fact="status"]')).toContainText("▶ running");
  });

  test("queued: ⏸ and its place on the machine", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "header").locator('[data-fact="status"]')).toHaveText("⏸ queued · 2nd on node-a");
  });

  test("cancelled: ⊘", async ({ page }) => {
    await open(page, QWEN_27B, "v2-r2");
    await expect(section(page, "header").locator('[data-fact="status"]')).toContainText("⊘ cancelled");
  });

  test("failed: ✕ and when, never why", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5"), { status: "failed", scores: {} }));
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "header").locator('[data-fact="status"]')).toHaveText("✕ failed · 2026-09-30 15:28 UTC");
  });
});

test.describe("header: the score of record", () => {
  test("scored: the number, under a plain label, linked to the per-story results", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const s = section(page, "header").locator('[data-stat="scoreOfRecord"]');
    await expect(s.locator(".stat-value .lead-n")).toHaveText("63/75");
    await expect(s.locator(".tag-record")).toHaveCount(0);
    await expect(s).not.toContainText(/re-scored|suite vidi/);
    await expect(s.locator("a.record-link")).toHaveAttribute("href", `${WEB}/blob/main/combinations/${SWIFT}/benchmarks/vidi/v2-r5/rescore/vidi-v2.0-pre1/per-story.md`);
    await expect(s.locator(".tag-live")).toHaveCount(0);
  });

  test("scored under an older suite: shown, with nothing about the suite", async ({ page }) => {
    await open(page, SWIFT, "v2-r7");
    const s = section(page, "header").locator('[data-stat="scoreOfRecord"]');
    await expect(s.locator(".stat-value .lead-n")).toHaveText("60/75");
    await expect(s).not.toContainText(/current suite|re-scored/);
  });

  test("the page leads with it: '62/75 held-out tests pass', before the run's name", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const lead = section(page, "header").locator('[data-section="lead"]');
    await expect(lead).toHaveAttribute("data-lead", "record");
    await expect(lead).toContainText("63/75 held-out tests pass");
    await expect(lead.locator(".tag-record")).toHaveCount(0);
    const first = await section(page, "header").evaluate((el) => (el.firstElementChild as HTMLElement).dataset.section);
    expect(first).toBe("lead");
  });

  test("running: its score over the stories it has finished, with no note about its source", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const lead = section(page, "header").locator('[data-section="lead"]');
    await expect(lead).toHaveAttribute("data-lead", "live");
    await expect(lead).toContainText("6/6 held-out tests pass");
    await expect(lead).not.toContainText(/so far|recorded/);
    await expect(lead.locator(".tag-live")).toHaveCount(0);
  });

  test("finished with no score of record: pending, one word, and nothing about why", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3");
    const lead = section(page, "header").locator('[data-section="lead"]');
    await expect(lead).toHaveAttribute("data-lead", "none");
    await expect(lead.locator(".na")).toHaveText("pending");
    await expect(lead.locator(".na")).toHaveAttribute("data-reason", "pending");
    await expect(lead).not.toContainText(/re-score|retr|person|machine|reason/i);
  });

  const none: [string, string, string, string][] = [
    ["queued", SWIFT, "v2-r2", "not-finished"],
    ["cancelled", QWEN_27B, "v2-r2", "ended-early"],
  ];
  for (const [name, stack, run, reason] of none) {
    test(`none, ${name}: '—', with only that the run isn't finished`, async ({ page }) => {
      await open(page, stack, run);
      const s = section(page, "header").locator('[data-section="lead"] [data-stat="scoreOfRecord"]');
      await expect(s.locator(".na")).toHaveText("—");
      await expect(s.locator(".na")).toHaveAttribute("data-reason", reason);
    });
  }
});

test.describe("header: agent time", () => {
  test("finished: summed over its stories", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const t = section(page, "header").locator('[data-stat="agentTime"]');
    await expect(t.locator(".stat-value")).toHaveText("1h31m");
    await expect(t).toContainText("over 2 stories");
    await expect(t.locator(".tag-live")).toHaveCount(0);
  });

  test("running: the finished stories' time, and the total with the running story", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const t = section(page, "header").locator('[data-stat="agentTime"]');
    await expect(t.locator(".stat-value")).toHaveText("12 min");
    await expect(t).toContainText("1 without a time");
    await expect(t.locator(".live-line")).toContainText("28 min including the running story");
    await expect(t.locator(".live-line .tag-live")).toHaveCount(0);
  });

  test("queued: missing, with why", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    const m = section(page, "header").locator('[data-stat="agentTime"] .missing');
    await expect(m).toHaveText("—");
    await expect(m).toHaveAttribute("data-tip", "Nothing yet: the run is queued.");
  });
});

test.describe("header: judge, record and summary", () => {
  test("ready: Judge opens the gallery on this run; record and summary open GitHub", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const l = section(page, "header").locator('[data-section="links"]');
    await expect(l.getByRole("link", { name: "Judge →" })).toHaveAttribute("href", `http://127.0.0.1:7800/review?setup=${enc(SWIFT)}&run=v2-r5`);
    await expect(l.getByRole("link", { name: "record" })).toHaveAttribute("href", `${WEB}/tree/main/combinations/${SWIFT}/benchmarks/vidi/v2-r5`);
    await expect(l.getByRole("link", { name: "summary" })).toHaveAttribute("href", `${WEB}/blob/main/combinations/${SWIFT}/benchmarks/vidi/v2-r5/summary.md`);
  });

  test("not ready: no Judge link and nothing said of why; a running run has a record but no summary", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const l = section(page, "header").locator('[data-section="links"]');
    await expect(l.getByRole("link", { name: "Judge →" })).toHaveCount(0);
    await expect(l).not.toContainText(/Judge|waiting|bundle/);
    await expect(l.getByRole("link", { name: "record" })).toBeVisible();
    await expect(l.getByRole("link", { name: "summary" })).toHaveCount(0);
  });

  test("no record: no links, marked missing", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "header").locator('[data-section="links"] a')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("one panel: each story's held-out result and where its time went", () => {
  const rows = (page: Page) => section(page, "time").locator(".rp-bar-row");
  const squares = (page: Page) => rows(page).locator(".rs-sq");

  test("the old latest-build strip and the separate held-out panel are gone; one row per story in scope, running one marked in progress, the rest pending", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "stories")).toHaveCount(0);
    await expect(section(page, "heldout")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(11);
    const states = await rows(page).evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.story}:${(e as HTMLElement).dataset.state}`));
    expect(states.slice(0, 4)).toEqual(["1:result", "2:result", "3:building", "4:unbuilt"]);
    await expect(squares(page).nth(2)).toHaveAttribute("data-tip", "story 3: being built now");
  });

  test("a story being built or not yet built has an empty bar with a light italic grey word: in progress, pending", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const building = rows(page).nth(2), pending = rows(page).nth(3);
    await expect(building.locator(".row-state")).toHaveText("in progress");
    await expect(pending.locator(".row-state")).toHaveText("pending");
    for (const r of [building, pending]) {
      await expect(r.locator(".bar")).toHaveCount(0);
      await expect(r.locator(".rp-bar-total")).toHaveText("");
      expect(await r.locator(".row-state").evaluate((e) => [getComputedStyle(e).fontStyle, getComputedStyle(e).color])).toEqual(["italic", expect.any(String)]);
    }
    await expect(rows(page).nth(0).locator(".row-state")).toHaveCount(0);   // a recorded story has none
  });

  test("every row's square links to its story run, built or not", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const hrefs = await rows(page).locator(".rs-cell a.story-run-link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12"].map((n) => storyRunHref(SWIFT, "v2-r1", n)));
    await rows(page).nth(3).locator(".rs-cell a").click();
    await expect(page.locator('[data-page="storyRun"]')).toHaveAttribute("data-story-state", "notBuilt");
  });

  test("a story not yet built still has its title in its row", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(rows(page).nth(3).locator(".rp-bar-label")).toContainText("4.");
    expect((await rows(page).nth(3).locator(".rp-bar-label").innerText()).length).toBeGreaterThan(4);
  });

  test("each square's link has a name for a screen reader", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "time").getByRole("link", { name: "story 1: 6/6 of its own tests" })).toBeVisible();
  });

  test("every story in scope in order, coloured by that story's own result", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    expect(await rows(page).evaluateAll((ls) => ls.map((l) => [(l as HTMLElement).dataset.story, (l as HTMLElement).dataset.state]))).toEqual([
      ["1", "result"], ["2", "result"], ["3", "unbuilt"], ["4", "unbuilt"], ["5", "unbuilt"], ["7", "unbuilt"], ["8", "unbuilt"], ["9", "unbuilt"], ["10", "unbuilt"], ["11", "unbuilt"], ["12", "unbuilt"],
    ]);
    await expect(squares(page).nth(0)).toHaveClass(/q-high/);        // 6/6
    await expect(squares(page).nth(1)).toHaveClass(/q-high/);        // 14/14
    await expect(squares(page).nth(2)).toHaveClass(/rs-unbuilt/);
    await expect(section(page, "time")).not.toContainText(/→|of record|agree|differ/);
  });

  test("each square says its story's own result on hover and to a screen reader, and links to the story run", async ({ page }) => {
    await open(page, SWIFT, "v2-r4");
    const two = rows(page).nth(1);
    await expect(two.locator(".rs-sq")).toHaveAttribute("data-tip", "story 2: 12/14 of its own tests");
    await expect(two.locator(".rs-cell .sr-only")).toHaveText("story 2: 12/14 of its own tests");
    await expect(two.locator(".rs-cell a")).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r4", "2"));
    await expect(two.locator(".rs-sq")).toHaveClass(/q-mid/);                          // 86%
    await expect(squares(page).nth(2)).toHaveAttribute("data-tip", "story 3: not built yet");
  });

  test("a story whose own tests weren't recorded: outlined, says so", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5").stories[1], { ownPassed: null, ownTotal: null }));
    await open(page, SWIFT, "v2-r5");
    await expect(rows(page).nth(1)).toHaveAttribute("data-state", "noResult");
    await expect(squares(page).nth(1)).toHaveAttribute("data-tip", "story 2: no result recorded");
  });

  test("a run with no stories in scope: says so", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r2"); r.storiesWorking = { working: 0, scope: 0, squares: [] }; });
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "time").locator(".rp-empty")).toHaveText("No stories in scope are known for this run.");
  });

  test("the story name column is wide enough for long titles: up to 390 px, half as wide again as before", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await open(page, SWIFT, "v2-r5");
    const w = (await rows(page).nth(0).locator(".rp-bar-label").boundingBox())!.width;
    expect(w).toBeGreaterThanOrEqual(385);
    expect(w).toBeLessThanOrEqual(391);
  });

  test("the heading names both: held-out, and where the time went", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "time").locator("h2")).toHaveText("Held-out and where the time went");
    await expect(section(page, "time").locator("h2 .term")).toHaveCount(2);
  });
});


// ---------------------------------------------------------------------------------------------------------------
test.describe("where the time went", () => {
  test("one bar per recorded story, all on one scale", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const t = section(page, "time");
    await expect(t.locator(".bar-link")).toHaveCount(2);   // a bar for each recorded story; the other rows are pending
    const w1 = (await t.locator('[data-story="1"] .bar').boundingBox())!.width;
    const w2 = (await t.locator('[data-story="2"] .bar').boundingBox())!.width;
    expect(w1 / w2).toBeCloseTo(660 / 4811, 2);
    await expect(t.locator('[data-story="2"] .rp-bar-total')).toHaveText("1h20m");
    await expect(t.locator(".rp-head")).toContainText("one scale: the longest story, 1h20m");
  });

  test("the same segments and colours as TimeBars, each with its hover", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const bar = section(page, "time").locator('[data-story="2"] .bar');
    const segs = await bar.locator("[data-seg]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.seg));
    expect(segs).toEqual(["prefill", "decode", "compaction", "tools", "other"]);  // parts of 0 s aren't drawn
    await expect(bar.locator('[data-seg="decode"]')).toHaveClass(/seg-decode/);
    await expect(bar.locator('[data-seg="decode"]')).toHaveAttribute("data-tip", "Generation 69.8 min: 175k tokens at 42 tok/s");
    await expect(section(page, "time").locator(".legend")).toHaveCount(7);
  });

  test("a story's label opens its story run; its bar does too, unless the story's conversation is there, which the bar opens instead", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "time").locator('[data-story="1"] .rp-bar-label a.story-run-link').click();
    await expect(page).toHaveURL(new RegExp(`${storyRunHref(SWIFT, "v2-r5", "1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await page.goBack();
    await section(page, "time").locator('[data-story="1"] a.bar-link').click();
    await expect(page.locator('[data-page="storyRun"] h1')).toContainText("Story 1");
    await page.goBack();
    await section(page, "time").locator('[data-story="2"] a.bar-link').click();
    await expect(page.locator('[data-page="conversation"]')).toBeVisible();
  });

  test("a story whose breakdown failed its check (v2-r1 story 1): no bar, not available, and nothing about why; its total stays", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const row = section(page, "time").locator('[data-story="1"]');
    await expect(row.locator(".bar")).toHaveCount(0);
    await expect(row.locator(".no-split .missing")).toHaveAttribute("data-tip", "No time breakdown for this story.");
    await expect(row.locator(".rp-bar-total")).toHaveText("12 min");
    await expect(section(page, "time")).not.toContainText(/accounting|check|unchecked|⚠/i);
    await expect(section(page, "time").locator("[data-tip]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip).join(" "))).resolves.not.toMatch(/accounting|Likely cause|What to do|recompute|harness/i);
  });

  test("a cloud model: one unsplit part, and no mark of any kind", async ({ page }) => {
    await open(page, OPUS, "run-9");
    const row = section(page, "time").locator('[data-story="1"]');
    await expect(row.locator("[data-seg]")).toHaveCount(1);
    await expect(row.locator('[data-seg="modelUnsplit"]')).toBeVisible();
    await expect(row).not.toContainText(/unchecked|⚠/);
  });

  test("a recorded story without a breakdown keeps its row, with '—' and no more", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "time").locator('[data-story="2"] .no-split .missing')).toHaveText("—");
    await expect(section(page, "time").locator('[data-story="2"] .bar')).toHaveCount(0);
  });

  test("nothing recorded (a queued run): every story pending, no bar anywhere", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "time").locator(".row-state")).toHaveText(Array(11).fill("pending"));
    await expect(section(page, "time").locator(".bar")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("cost", () => {
  const stat = (page: Page, term: string) => section(page, "cost").locator(`[data-stat="${term}"] .stat-value`);

  test("run totals", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const want: [string, string][] = [
      ["outTokens", "235k"], ["inputRead", "10.0M"], ["calls", "299"], ["tokS", "43.0"], ["compactions", "3"], ["nudges", "2"],
    ];
    for (const [term, text] of want) await expect(stat(page, term), term).toHaveText(text);
    await expect(section(page, "cost").locator('[data-stat="tokS"] .term')).toHaveText("generated tok/s");
    await expect(section(page, "cost").locator(".rp-head")).toContainText("over 2 stories");
  });

  test("the engine's own speeds on one small line, not among the main figures: generation and reading", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const line = section(page, "cost").locator('[data-stat="engineSpeed"]');
    await expect(line).toHaveText("engine speed: generation 193.4 tok/s · reading —");
    await expect(section(page, "cost").locator('.stats [data-stat="decodeTokS"], .stats [data-stat="prefillTokS"]')).toHaveCount(0);
  });

  test("a total nothing measured is '—' with why, never 0", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const reading = section(page, "cost").locator('[data-stat="engineSpeed"] [data-fact="prefill"]');
    await expect(reading).toHaveText("—");
    await expect(reading.locator(".missing")).toHaveAttribute("data-tip", /timed the model on its own/);
  });

  test("zero is shown as 0", async ({ page }) => {
    await open(page, OPUS, "run-9");
    await expect(stat(page, "compactions")).toHaveText("0");
    await expect(stat(page, "nudges")).toHaveText("0");
  });

  test("a cloud model: engine speeds and drafting are 'n/a' with why, in the totals and per story, never '—'", async ({ page }) => {
    await open(page, OPUS, "run-9");
    for (const fact of ["decode", "prefill"]) {
      const n = section(page, "cost").locator(`[data-stat="engineSpeed"] [data-fact="${fact}"] .na`);
      await expect(n).toHaveText("n/a");
      await expect(n).toHaveAttribute("data-tip", "Unavailable for this cloud model");
    }
    const recorded = section(page, "cost").locator('table.story-cost tr[data-story="1"]');
    await expect(recorded.locator(".na")).toHaveCount(3);  // generation, reading, draft
    await expect(recorded.locator(".missing")).toHaveCount(0);
  });

  test("nothing recorded: every total missing, with why", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "cost").locator(".stat .missing")).toHaveCount(6);
    await expect(stat(page, "outTokens").locator(".missing")).toHaveAttribute("data-tip", "Nothing recorded yet: the run is queued.");
    await expect(section(page, "cost").locator("table")).toHaveCount(0);
  });

  test("per story: a row each, its held-out result against the latest build, its figures", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const t = section(page, "cost").locator("table.story-cost");
    const r2 = t.locator('tr[data-story="2"]');
    await expect(t.locator("tbody tr")).toHaveCount(2);
    await expect(r2.locator("td").nth(1)).toHaveText("14/14");
    await expect(r2).toContainText("1h20m");
    await expect(r2).toContainText("175,000");
    await expect(r2).toContainText("90%");
    await expect(r2).toContainText("41.7");
  });

  test("per story: every story links to its story run", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const link = section(page, "cost").locator('tr[data-story="2"] a.story-run-link');
    await expect(link).toHaveText("2. Sticky notes");
    await expect(link).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r5", "2"));
  });

  test("per story: a figure the engine didn't report is '—' with its own reason", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3");
    await expect(section(page, "cost").locator('tr[data-story="1"]')).toContainText("85%");  // draft accepted, reported
    await open(page, SWIFT, "v2-r5");
    const draft = section(page, "cost").locator('tr[data-story="1"] td').nth(10);
    await expect(draft.locator(".missing")).toHaveAttribute("data-tip", /speculative decoding/);
  });

  test("per story: a story recorded without usage says so across the row", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const r2 = section(page, "cost").locator('tr[data-story="2"]');
    await expect(r2.locator("td.no-usage")).toContainText("no usage recorded for this story");
    await expect(r2.locator("td").nth(1)).toHaveText("9/10");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------
test.describe("when it ran", () => {
  test("a run restarted on its machine: the machine, when it was first queued, when it ended; no jobs, statuses or reasons", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const r = section(page, "ran");
    await expect(r.locator('[data-row="machine"] dd')).toHaveText("node-a");
    await expect(r.locator('[data-row="queued"] dd')).toHaveText("2026-09-29 00:00 UTC");
    await expect(r.locator('[data-row="ended"] dd')).toHaveText("2026-09-30 15:28 UTC");
    await expect(r).not.toContainText(/job|restart|cancelled|stopped by|reason|dbench/i);
    await expect(page.locator('[data-page="run"] [data-section="jobs"]')).toHaveCount(0);
  });

  test("a running run: not ended", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "ran").locator('[data-row="ended"] dd')).toHaveText("not ended");
  });

  test("no job (a run known from its record alone): the machine and the record's end; when it was queued isn't known", async ({ page }) => {
    await open(page, OPUS, "run-9");
    const r = section(page, "ran");
    await expect(r.locator('[data-row="machine"] dd')).toHaveText("Apple M2 16GB");
    await expect(r.locator('[data-row="queued"] dd .missing')).toHaveAttribute("data-tip", "When it was queued isn't known.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("compare with another run", () => {
  test("the choices are this combination's other runs in this pack, never itself or another combination", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const opts = await section(page, "compare").locator("select option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(opts[0]).toBe("");
    expect(opts).toContain("v2-r1");
    expect(opts).toContain("v2-r4");
    expect(opts).not.toContain("v2-r5");
    expect(opts).not.toContain("run-9");
    expect(opts.slice(1)).toEqual(opts.slice(1).toSorted((a, b) => a.localeCompare(b, "en", { numeric: true })));
  });

  test("side by side per story: over 10% marked, under it not", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "compare").locator("select").selectOption("v2-r4");
    const c = section(page, "compare");
    await expect(c.locator(".compare-key")).toContainText("v2-r5 over v2-r4");
    const t1 = c.locator('tr[data-story="1"] [data-measure="minutes"]');
    await expect(t1).toContainText("11 min");
    await expect(t1).toContainText("12 min");
    await expect(t1.locator(".diff")).toHaveText("−4%");
    await expect(t1).not.toHaveAttribute("data-flagged", "true");
    const t2 = c.locator('tr[data-story="2"] [data-measure="minutes"]');
    await expect(t2).toHaveAttribute("data-flagged", "true");
    await expect(t2.locator(".diff.flagged")).toHaveText("+401%");
    await expect(t2.locator(".diff.flagged")).toHaveAttribute("data-tip", /more than 10%/);
  });

  test("a story only one run has: its figure against '—', unmarked", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "compare").locator("select").selectOption("v2-r1");
    const cell = section(page, "compare").locator('tr[data-story="2"] [data-measure="minutes"]');
    await expect(cell.locator(".pair-b .missing")).toHaveAttribute("data-tip", "v2-r1 has no figure for this story.");
    await expect(cell).not.toHaveAttribute("data-flagged", "true");
  });

  test("each story links to both runs' story runs", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "compare").locator("select").selectOption("v2-r4");
    const links = section(page, "compare").locator('tr[data-story="2"] a.story-run-link');
    await expect(links.nth(0)).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r5", "2"));
    await expect(links.nth(1)).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r4", "2"));
  });

  test("a run with nothing recorded: this run's figures, the other's missing", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "compare").locator("select").selectOption("v2-r2");
    await expect(section(page, "compare").locator('[data-flagged="true"]')).toHaveCount(0);
    await expect(section(page, "compare").locator('tr[data-story="1"] .pair-b .missing').first()).toHaveAttribute("data-tip", "v2-r2 hasn't recorded this story.");
  });

  test("no run chosen: asks for one", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "compare").locator("select").selectOption("");
    await expect(section(page, "compare").locator(".rp-empty")).toHaveText("Choose a run to compare with.");
  });

  test("the only run of its combination: nothing to compare with, and no selector", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3");
    await expect(section(page, "compare").locator(".rp-empty")).toHaveText("This combination has no other run in this pack to compare with.");
    await expect(section(page, "compare").locator("select")).toHaveCount(0);
  });

  test("works from the keyboard", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const select = section(page, "compare").locator("select");
    await select.focus();
    await select.selectOption("v2-r4");  // what a keyboard choice does; the select is a native one
    await expect(select).toBeFocused();
    await expect(section(page, "compare").locator(".compare-key")).toContainText("v2-r4");
    await expect(page.getByRole("combobox", { name: /^against/ })).toBeVisible();  // the select has a label
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("related runs", () => {
  test("the combination's other runs, each a link to its run page, with status and score", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const r = section(page, "related");
    await expect(r.locator('li[data-run="v2-r5"]')).toHaveCount(0);
    await expect(r.locator('li[data-run="v2-r1"]')).toContainText("running");
    await expect(r.locator('li[data-run="v2-r4"]')).toContainText("score 68/75");
    await expect(r.locator('li[data-run="v2-r2"]')).toContainText("no score");
    await r.locator('li[data-run="v2-r4"] a.run-link').click();
    await expect(page.locator('[data-page="run"] .run-id')).toHaveText("v2-r4");
  });

  test("the combination itself is one click away", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "related").locator("a.combination-link").click();
    await expect(page.locator('[data-page="combination"]')).toBeVisible();
  });

  test("the only run of its combination: says so", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3");
    await expect(section(page, "related").locator(".rp-empty")).toHaveText("This is the combination's only run in this pack.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("links and keyboard", () => {
  test("sections come in reading order: identity, outcome, time, cost, evidence, provenance", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const order = await page.locator('[data-page="run"] > [data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section));
    expect(order).toEqual(["header", "time", "cost", "ran", "compare", "related"]);
  });

  test("every heading and label with a definition takes it from the glossary", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const definitions = new Set(Object.values(GLOSSARY).map((t) => t.what));
    const tips = await page.locator('[data-page="run"] .term').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""));
    expect(tips.length).toBeGreaterThan(30);
    expect(tips.filter((t) => !definitions.has(t))).toEqual([]);
    const headings = await page.locator('[data-page="run"] h2').evaluateAll((els) => els.map((e) => e.textContent));
    expect(headings).toEqual(["Held-out and where the time went", "Cost", "When it ran", "Compare with another run", "Other runs of this combination"]);
  });

  test("every in-app link lands on the entity it names", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, SWIFT, "v2-r5");
    const hrefs = [...new Set(await page.locator('[data-page="run"] a[href^="#/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
    expect(hrefs.length).toBeGreaterThan(20);
    for (const href of hrefs) {
      await page.goto(`/${href}`);
      const route = parseRoute(href);
      if (route.page === "overview") { await expect(page.locator("table.combos"), href).toBeVisible(); continue; }
      if (route.page === "combination") { await expect(page.locator('[data-page="combination"]'), href).toBeVisible(); continue; }
      if (route.page === "machine") { await expect(page.locator('[data-page="machine"]'), href).toContainText(route.machine); continue; }
      if (route.page === "story") { await expect(page.locator('[data-page="story"]'), href).toContainText(`Story ${route.story}`); continue; }
      if (route.page === "run") {
        await expect(page.locator('[data-page="run"] .rp-header .run-id'), href).toHaveText(route.runId);
        await expect(page.locator('[data-page="run"] .rp-header a.combination-link'), href).toHaveAttribute("data-tip", route.stack);
        continue;
      }
      if (route.page === "storyRun") {
        await expect(page.locator('[data-page="storyRun"] .rp-header h1'), href).toContainText(`Story ${route.story}`);
        await expect(page.locator('[data-page="storyRun"] .breadcrumb a.run-link'), href).toHaveAttribute("data-tip", `${route.stack} · ${route.runId}`);
        continue;
      }
      if (route.page === "conversation" || route.page === "call") {
        await expect(page.locator(`[data-page="${route.page}"] .breadcrumb a.story-run-link`), href).toHaveText(`story ${Number(route.story)}`);
        continue;
      }
      throw new Error(`${href} names no page`);
    }
  });

  test("every link is reachable by keyboard and has a name, except the bars and their parts (their label is the same link)", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const bad = await page.locator('[data-page="run"] a').evaluateAll((as) => as
      .filter((a) => !a.classList.contains("bar-link") && !a.classList.contains("seg-link"))
      .filter((a) => a.getAttribute("tabindex") === "-1" || !(a.textContent ?? "").trim())
      .map((a) => a.outerHTML));
    expect(bad).toEqual([]);
    await expect(page.locator('[data-page="run"] a.bar-link[tabindex="-1"]')).toHaveCount(2);
  });

  test("a story square opens from the keyboard, with a visible focus ring", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const link = section(page, "time").locator('[data-story="2"] .rs-cell a');
    await link.focus();
    await expect(link).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-page="storyRun"] h1')).toContainText("Story 2");
  });

  test("Tab moves from the breadcrumb into the page's own links, in order", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await page.locator(".breadcrumb a").first().focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveClass(/combination-link/);   // the breadcrumb's combination
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveClass(/record-link/);        // the lead score's per-story results
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveClass(/combination-link/);   // the heading's
  });

  test("a missing number can be focused to read why", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const m = section(page, "cost").locator('[data-stat="engineSpeed"] [data-fact="prefill"] .missing');
    await m.focus();
    await expect(page.getByRole("tooltip")).toContainText("timed the model");
  });
});
