import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { parseRoute } from "../shared/routes.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// The run page, section by section in reading order (header, stories, time, cost, held-out, jobs, compare,
// related), then links and keyboard. Within a section, one test per state that changes what it shows: finished and
// scored, finished and unscored, running, queued, failed, cancelled; data present or absent; a cloud model.
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

  test("failed: ✕ and the failure's reason", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5"), { status: "failed", statusNote: "agent crashed", scores: {} }));
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "header").locator('[data-fact="status"]')).toHaveText("✕ failed · agent crashed");
  });
});

test.describe("header: the score of record", () => {
  test("scored: the number, marked 'of record', when and under which suite, linked to the per-story results", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const s = section(page, "header").locator('[data-stat="scoreOfRecord"]');
    await expect(s.locator(".stat-value")).toHaveText("63/75");
    await expect(s.locator(".tag-record")).toHaveText("of record");
    await expect(s).toContainText("re-scored 2026-09-30 18:30 UTC · suite vidi-v2.0-pre1");
    await expect(s.locator("a.record-link")).toHaveAttribute("href", `${WEB}/blob/main/combinations/${SWIFT}/benchmarks/vidi/v2-r5/rescore/vidi-v2.0-pre1/per-story.md`);
    await expect(s.locator(".tag-live")).toHaveCount(0);
  });

  test("scored under an older suite: shown, and says it isn't the current suite", async ({ page }) => {
    await open(page, SWIFT, "v2-r7");
    const s = section(page, "header").locator('[data-stat="scoreOfRecord"]');
    await expect(s.locator(".stat-value")).toHaveText("60/75");
    await expect(s).toContainText("not the current suite (vidi-v2.0-pre1)");
  });

  const none: [string, string, string, string, RegExp][] = [
    ["running", SWIFT, "v2-r1", "not-finished", /Not finished: the run is running/],
    ["queued", SWIFT, "v2-r2", "not-finished", /Not finished: the run is queued/],
    ["finished, not re-scored", GUFO, "canvas-gufo-r3", "not-rescored", /Finished, but not re-scored under vidi-v2\.0-pre1 yet/],
    ["cancelled", QWEN_27B, "v2-r2", "ended-early", /was cancelled before it finished/],
  ];
  for (const [name, stack, run, reason, why] of none) {
    test(`none, ${name}: n/a, and why in words`, async ({ page }) => {
      await open(page, stack, run);
      const s = section(page, "header").locator('[data-stat="scoreOfRecord"]');
      await expect(s.locator(".na")).toHaveText("n/a");
      await expect(s.locator(".na")).toHaveAttribute("data-reason", reason);
      await expect(s.locator(".why")).toHaveText(why);
    });
  }
});

test.describe("header: agent time", () => {
  test("finished: summed over its recorded stories", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const t = section(page, "header").locator('[data-stat="agentTime"]');
    await expect(t.locator(".stat-value")).toHaveText("1h31m");
    await expect(t).toContainText("over 2 recorded stories");
    await expect(t.locator(".tag-live")).toHaveCount(0);
  });

  test("running: the recorded time, and the live total marked live", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const t = section(page, "header").locator('[data-stat="agentTime"]');
    await expect(t.locator(".stat-value")).toHaveText("12 min");
    await expect(t).toContainText("1 without a time");
    await expect(t.locator(".live-line")).toContainText("28 min so far");
    await expect(t.locator(".live-line .tag-live")).toHaveText("live");
  });

  test("queued: missing, with why", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    const m = section(page, "header").locator('[data-stat="agentTime"] .missing');
    await expect(m).toHaveText("—");
    await expect(m).toHaveAttribute("data-tip", "Nothing recorded yet: the run is queued.");
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

  test("not ready: says what judging waits for; a running run has a record but no summary", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const l = section(page, "header").locator('[data-section="links"]');
    await expect(l.locator(".judge-wait")).toHaveText("Judge: waiting for scoring");
    await expect(l.getByRole("link", { name: "record" })).toBeVisible();
    await expect(l.getByRole("link", { name: "summary" })).toHaveCount(0);
  });

  test("no record: no links, marked missing", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "header").locator('[data-section="links"] a')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("story strip", () => {
  test("one square per story in scope, coloured by its held-out result, with the result on hover", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const strip = section(page, "stories");
    await expect(strip.locator("[data-story]")).toHaveCount(11);
    const states = await strip.locator("[data-story]").evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.story}:${(e as HTMLElement).dataset.state}`));
    expect(states.slice(0, 4)).toEqual(["1:ok", "2:part", "3:running", "4:unbuilt"]);
    await expect(strip.locator('[data-story="2"]')).toHaveAttribute("data-tip", "story 2: some of its held-out tests pass (9/10), against the latest build");
    await expect(strip.locator('[data-story="2"] .rp-sq')).toHaveClass(/q-part/);
    await expect(strip.locator(".rp-head")).toContainText("1 of the 2 stories built so far pass all their held-out tests · 11 in scope");
  });

  test("every square links to its story run, built or not", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const links = section(page, "stories").locator("a.story-run-link");
    const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12"].map((n) => storyRunHref(SWIFT, "v2-r1", n)));
    await section(page, "stories").locator('[data-story="4"] a').click();
    await expect(page.locator('[data-page="storyRun"]')).toHaveAttribute("data-story-state", "notBuilt");
  });

  test("each square's link has a name for a screen reader", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "stories").getByRole("link", { name: "story 1: all its held-out tests pass (6/6), against the latest build" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("where the time went", () => {
  test("one bar per recorded story, all on one scale", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const t = section(page, "time");
    await expect(t.locator(".rp-bar-row")).toHaveCount(2);
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

  test("a story's label and its bar both open its story run", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await section(page, "time").locator('[data-story="1"] a.story-run-link').click();
    await expect(page).toHaveURL(new RegExp(`${storyRunHref(SWIFT, "v2-r5", "1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await page.goBack();
    await section(page, "time").locator('[data-story="2"] a.bar-link').click();
    await expect(page.locator('[data-page="storyRun"] h1')).toContainText("Story 2");
  });

  test("a split that failed its checks is flagged with the problems", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const flag = section(page, "time").locator('[data-story="1"] .check-flag');
    await expect(flag).toHaveText("⚠");
    await expect(flag).toHaveAttribute("data-tip", /tool call t9 never ended/);
  });

  test("a cloud model: one unsplit part, marked unchecked", async ({ page }) => {
    await open(page, OPUS, "run-9");
    const row = section(page, "time").locator('[data-story="1"]');
    await expect(row.locator("[data-seg]")).toHaveCount(1);
    await expect(row.locator('[data-seg="modelUnsplit"]')).toBeVisible();
    await expect(row.locator(".check-unchecked")).toHaveText("unchecked");
  });

  test("a recorded story without a split keeps its row, saying so", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "time").locator('[data-story="2"] .no-split')).toContainText("no time split recorded");
    await expect(section(page, "time").locator('[data-story="2"] .bar')).toHaveCount(0);
  });

  test("nothing recorded: says so", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "time").locator(".rp-empty")).toHaveText("No story recorded yet: the run is queued.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("cost", () => {
  const stat = (page: Page, term: string) => section(page, "cost").locator(`[data-stat="${term}"] .stat-value`);

  test("run totals", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const want: [string, string][] = [
      ["outTokens", "235k"], ["inputRead", "10.0M"], ["calls", "299"], ["tokS", "43.0"], ["decodeTokS", "193.4"], ["compactions", "3"], ["nudges", "2"],
    ];
    for (const [term, text] of want) await expect(stat(page, term), term).toHaveText(text);
    await expect(section(page, "cost").locator(".rp-head")).toContainText("over 2 recorded stories");
  });

  test("a total nothing measured is '—' with why, never 0", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await expect(stat(page, "prefillTokS")).toHaveText("—");
    await expect(stat(page, "prefillTokS").locator(".missing")).toHaveAttribute("data-tip", /timed the model on its own/);
  });

  test("zero is shown as 0", async ({ page }) => {
    await open(page, OPUS, "run-9");
    await expect(stat(page, "compactions")).toHaveText("0");
    await expect(stat(page, "nudges")).toHaveText("0");
  });

  test("a cloud model: no model speeds, with why", async ({ page }) => {
    await open(page, OPUS, "run-9");
    await expect(stat(page, "decodeTokS").locator(".missing")).toHaveAttribute("data-tip", /cloud model/);
  });

  test("nothing recorded: every total missing, with why", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "cost").locator(".stat .missing")).toHaveCount(8);
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
test.describe("held-out", () => {
  test("live after each story, marked live; the score of record, marked of record; kept apart", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const h = section(page, "heldout");
    await expect(h.locator('[data-row="live"] .tag-live')).toHaveText("live");
    await expect(h.locator('[data-row="live"] dd')).toHaveText("story 1 6/6→story 2 20/20");
    await expect(h.locator('[data-row="live"] .live-n').first()).toHaveCSS("font-style", "italic");
    await expect(h.locator('[data-row="record"] .tag-record')).toHaveText("of record");
    await expect(h.locator('[data-row="record"] dd')).toHaveText("63/75");
    await expect(h.locator('[data-row="live"] .tag-record')).toHaveCount(0);
    await expect(h.locator('[data-row="record"] .tag-live')).toHaveCount(0);
  });

  test("each live step links to its story run", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "heldout").locator('[data-story="2"] a')).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r5", "2"));
  });

  test("live and record counting different tests: can't compare, and says why", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const a = section(page, "heldout").locator('[data-row="agreement"] dd');
    await expect(a).toHaveAttribute("data-agreement", "incomparable");
    await expect(a).toHaveText("Can't compare. Not the same tests: the live figure after story 2 counts 20 tests, the score of record 75.");
  });

  test("the same tests, the same count: they agree", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5").stories[1], { passed: 63, total: 75 }));
    await open(page, SWIFT, "v2-r5");
    const a = section(page, "heldout").locator('[data-row="agreement"] dd');
    await expect(a).toHaveAttribute("data-agreement", "agree");
    await expect(a).toHaveText("✓ they agree: 63/75");
  });

  test("the same tests, a different count: they differ, both shown", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5").stories[1], { passed: 60, total: 75 }));
    await open(page, SWIFT, "v2-r5");
    await expect(section(page, "heldout").locator('[data-row="agreement"] dd')).toHaveText("they differ: live 60/75, of record 63/75");
  });

  test("running: live so far, a missing step marked, no score of record", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    const h = section(page, "heldout");
    await expect(h.locator('[data-story="2"] .missing')).toHaveAttribute("data-tip", /before its record arrived/);
    await expect(h.locator('[data-row="record"] .na')).toHaveText("n/a");
    await expect(h.locator('[data-row="agreement"] dd')).toHaveAttribute("data-agreement", "incomparable");
  });

  test("queued: nothing yet", async ({ page }) => {
    await open(page, SWIFT, "v2-r2");
    await expect(section(page, "heldout").locator('[data-row="live"] dd')).toHaveText("No story recorded yet.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("jobs", () => {
  test("a restarted run: every job, its place, status, times and reason", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const j = section(page, "jobs");
    await expect(j.locator(".rp-head")).toContainText("restarted once: 2 jobs");
    const first = j.locator('tr[data-job="vidi-v2b-swift15-r5"]');
    const second = j.locator('tr[data-job="vidi-v2b-swift15-r5-again1"]');
    await expect(first.locator("td").nth(0)).toHaveText("job 1 of 2 for v2-r5");
    await expect(first.locator("td").nth(2)).toHaveText("node-a");
    await expect(first.locator("td").nth(3)).toHaveText("cancelled");
    await expect(first.locator("td").nth(4)).toHaveText("2026-09-29 00:00 UTC");
    await expect(first.locator("td").nth(5)).toHaveText("2026-09-29 02:46 UTC");
    await expect(first.locator("td").nth(6)).toHaveText("stopped by the operator");
    await expect(second.locator("td").nth(0)).toHaveText("job 2 of 2 for v2-r5 (restart)");
    await expect(second.locator("td").nth(3)).toHaveText("done");
    await expect(second.locator("td").nth(6)).toHaveText("none given");
  });

  test("one job: job 1 of 1, no restart", async ({ page }) => {
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "jobs").locator("tbody tr")).toHaveCount(1);
    await expect(section(page, "jobs").locator("tbody td").first()).toHaveText("job 1 of 1 for v2-r1");
    await expect(section(page, "jobs").locator(".rp-head .warn")).toHaveCount(0);
  });

  test("a job with no update time: missing, with why", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r1").jobs[0].updatedAt = null; });
    await open(page, SWIFT, "v2-r1");
    await expect(section(page, "jobs").locator("tbody td").nth(5).locator(".missing")).toHaveAttribute("data-tip", /hasn't reported/);
  });

  test("no job (a run known from its record alone): says so", async ({ page }) => {
    await open(page, OPUS, "run-9");
    await expect(section(page, "jobs").locator(".rp-empty")).toHaveText("No dbench job: this run is known from its record alone.");
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
    await expect(r.locator('li[data-run="v2-r2"]')).toContainText("no score of record");
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
    expect(order).toEqual(["header", "stories", "time", "cost", "heldout", "jobs", "compare", "related"]);
  });

  test("every heading and label with a definition takes it from the glossary", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const definitions = new Set(Object.values(GLOSSARY).map((t) => t.what));
    const tips = await page.locator('[data-page="run"] .term').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""));
    expect(tips.length).toBeGreaterThan(30);
    expect(tips.filter((t) => !definitions.has(t))).toEqual([]);
    const headings = await page.locator('[data-page="run"] h2').evaluateAll((els) => els.map((e) => e.textContent));
    expect(headings).toEqual(["Stories", "Where the time went", "Cost", "Held-out", "Jobs", "Compare with another run", "Other runs of this combination"]);
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
      throw new Error(`${href} names no page`);
    }
  });

  test("every link is reachable by keyboard and has a name, except the bars (their label is the same link)", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const bad = await page.locator('[data-page="run"] a').evaluateAll((as) => as
      .filter((a) => !a.classList.contains("bar-link"))
      .filter((a) => a.getAttribute("tabindex") === "-1" || !(a.textContent ?? "").trim())
      .map((a) => a.outerHTML));
    expect(bad).toEqual([]);
    await expect(page.locator('[data-page="run"] a.bar-link[tabindex="-1"]')).toHaveCount(2);
  });

  test("a story square opens from the keyboard, with a visible focus ring", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const link = section(page, "stories").locator('[data-story="2"] a');
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
    await expect(page.locator(":focus")).toHaveClass(/combination-link/);   // the heading's
  });

  test("a missing number can be focused to read why", async ({ page }) => {
    await open(page, SWIFT, "v2-r5");
    const m = section(page, "cost").locator('[data-stat="prefillTokS"] .missing');
    await m.focus();
    await expect(page.getByRole("tooltip")).toContainText("timed the model");
  });
});
