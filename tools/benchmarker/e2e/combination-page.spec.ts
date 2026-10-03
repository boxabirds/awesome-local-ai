import { expect, test, type Page } from "@playwright/test";
import { GLOSSARY } from "../shared/glossary.ts";
import type { State } from "../shared/types.ts";

// The ranking on the overview and the combination page, from the fixture. Swift 1.5 has five finished runs:
// v2-r4 68, v2-r5 63, v2-r6 58 (scores of record under vidi-v2.0-pre1), v2-r7 (re-scored only under pre0, so
// pending), and v2-r9 (a partial rerun of story 2 only, knownGood: true — diagnostic, never pooled with the
// others); v2-r1 running on story 3, v2-r2 and v2-r3 queued. Story 2 of v2-r5 thought verbosely; story 1 of
// v2-r6 hung on a dev server; story 2 of v2-r6 took many small steps; story 1 of v2-r7 has no conversation profile.
// MECE by section: the overview's ranking, then the page's header, matrix cells, links, metric switch, flags,
// keyboard, time bars, tally, related, and the empty and absent states.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const GUFO = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi";
const VK = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi";   // two finished runs, neither scored
const MLX = "qwen/3.8/flash-next/macos/128GB/mlxserve-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const enc = encodeURIComponent;
const open = (page: Page, stack: string) => page.goto(`/#/vidi/c/${enc(stack)}`);
const matrix = (page: Page) => page.getByRole("table", { name: "Runs × stories" });
const cell = (page: Page, run: string, story: string) => matrix(page).locator(`tr[data-run="${run}"] td.m-cell[data-story="${story}"]`);
const rowOf = (page: Page, run: string) => matrix(page).locator(`tr[data-run="${run}"]`);
const tip = (page: Page) => page.getByRole("tooltip");
const heading = (page: Page) => page.locator('[data-page="combination"] h1');
/** One figure of the Predictability group, by its glossary term. */
const pred = (page: Page, id: string) => page.locator(`[data-group="predictability"] [data-pred="${id}"] dd`);
const show = (page: Page, metric: string) => page.getByRole("group", { name: "Show" }).getByRole("button", { name: metric, exact: true }).click();

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test.describe("overview: combinations ranked on finished runs of record", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("table.combos")).toBeVisible();
  });
  const combos = (page: Page) => page.getByRole("table", { name: "Combinations" });

  test("ranked by the score-of-record median; combinations without a finished, scored run last, saying why", async ({ page }) => {
    const order = await combos(page).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.stack));
    // Before, the pooled live figure put Swift (97%, its running run's easy stories included) above Opus.
    expect(order).toEqual([OPUS, SWIFT, QWEN_27B, VK, MLX]);
    await expect(combos(page).locator(`tr[data-stack="${QWEN_27B}"] td.score`)).toHaveText("not ranked: no finished run yet");
    await expect(combos(page).locator(`tr[data-stack="${MLX}"]`)).toHaveAttribute("data-ranked", "false");
    await expect(combos(page).getByRole("columnheader", { name: /^Score/ })).toHaveAttribute("aria-sort", "descending");
  });

  test("the score is median (range) n over finished runs of record only; an older suite's score and live runs never count", async ({ page }) => {
    const swift = combos(page).locator(`tr[data-stack="${SWIFT}"]`);
    await expect(swift.locator("td.score")).toHaveText("63 (58–68) n=3");          // v2-r7's pre0 score is not a fourth run
    await expect(swift.locator("td.pooled")).toHaveText("84%");                      // (68 + 63 + 58) / 225
    await expect(swift.locator("td.hours")).toHaveText("0.4 (0.2–0.8)");
    await expect(combos(page).locator(`tr[data-stack="${OPUS}"] td.score`)).toHaveText("74 n=1");   // one run: no range
  });

  test("runs not counted are in their own column, by why", async ({ page }) => {
    await expect(combos(page).locator(`tr[data-stack="${SWIFT}"] td.not-counted`)).toHaveText("1 running2 queued1 pending1 partial rerun");
    await expect(combos(page).locator(`tr[data-stack="${OPUS}"] td.not-counted`)).toHaveText("1 running");
    await expect(combos(page).getByRole("columnheader", { name: "Not counted" })).toHaveAttribute("data-tip", /pending \(finished, no score yet\)/);
  });

  test("small n: a note says neighbours within 12 tests can't be told apart, and names them", async ({ page }) => {
    const note = page.locator(".small-n-note");
    await expect(note).toContainText("With 5 runs or fewer, a difference of 12 tests or less can't separate two combinations.");
    await expect(note).toContainText("reference/opus-5.5 (74, n=1) and 3.8-swift-1.5/27b llamacpp (63, n=3)");
    await expect(note.locator("a.combination-link")).toHaveCount(2);
  });

  test("predictability: thinking spread and time spread per combination, each beside its amount", async ({ page }) => {
    // Swift's four finished runs. Thinking: story 2 only (v2-r7's story 1 has no profile): 12,000, 328,750, 23,500 and
    // 11,400 chars vary by 144%. Time: story 1 varies by 40%, story 2 by 84%: the median is 62%.
    const swift = combos(page).locator(`tr[data-stack="${SWIFT}"]`);
    await expect(swift.locator("td.think-spread .num")).toHaveText("144%");
    await expect(swift.locator("td.think-spread .amount")).toHaveText("18k chars");
    await expect(swift.locator("td.time-spread .num")).toHaveText("62%");
    await expect(swift.locator("td.time-spread .amount")).toHaveText("16 min");
    await expect(combos(page).getByRole("columnheader", { name: "Thinking spread" })).toHaveAttribute("data-tip", GLOSSARY.thinkingSpread.what);
    await expect(combos(page).getByRole("columnheader", { name: "Time spread" })).toHaveAttribute("data-tip", GLOSSARY.timeSpread.what);
  });

  test("predictability with fewer than three finished runs: a dash that says three are needed, and the amount still shows", async ({ page }) => {
    const opus = combos(page).locator(`tr[data-stack="${OPUS}"]`);   // one finished run; story 1 took 8 minutes
    await expect(opus.locator("td.time-spread .missing")).toHaveText("—");
    await expect(opus.locator("td.time-spread .amount")).toHaveText("8 min");
    await expect(opus.locator("td.think-spread .missing")).toHaveText("—");
    await opus.locator("td.time-spread .missing").hover();
    await expect(tip(page)).toHaveText("Needs three finished runs");
    // Two finished runs (the Vulkan stack) are not enough either; a stack with none finished has nothing to show.
    for (const stack of [VK, MLX]) await expect(combos(page).locator(`tr[data-stack="${stack}"] td.time-spread`)).toHaveText("—");
  });

  test("sorting by a spread: combinations with a figure first, the rest in ranking order", async ({ page }) => {
    await combos(page).getByRole("columnheader", { name: "Time spread" }).click();
    const order = await combos(page).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.stack));
    expect(order).toEqual([SWIFT, OPUS, QWEN_27B, VK, MLX]);
  });

  test("sorting by score reverses; unranked combinations stay last either way", async ({ page }) => {
    await combos(page).getByRole("columnheader", { name: /^Score/ }).click();
    const order = await combos(page).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.stack));
    expect(order).toEqual([SWIFT, OPUS, QWEN_27B, VK, MLX]);
  });
});

test.describe("combination page", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, SWIFT);
    await expect(page.locator('[data-page="combination"]')).toBeVisible();
  });

  test("header: breadcrumb, label and full id, machine, headline numbers of record, runs by status", async ({ page }) => {
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "#/");
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("3.8-swift-1.5/27b llamacpp");
    await expect(heading(page)).toHaveText("3.8-swift-1.5/27b llamacpp");
    await expect(page.locator(".combo-id")).toHaveText(SWIFT);
    await expect(page.locator(".combo-on")).toContainText("on node-a (Intel Core i9 + RTX 4090 64GB)");
    await expect(page.locator('[data-kpi="score"] dd')).toHaveText("63 (58–68) n=3 / 75 · pooled 84%");
    await expect(page.locator('[data-kpi="hoursPerStory"] dd')).toHaveText("0.4 (0.2–0.8)");
    await expect(page.locator('[data-kpi="outPerStory"] dd')).toHaveText("71k (63k–118k)");
    await expect(page.locator('[data-kpi="callsPerStory"] dd')).toHaveText("150 (100–177)");
    await expect(page.locator(".run-counts")).toHaveText("Runs: 5 finished (3 scored, 1 pending, 1 partial rerun) · 1 running · 2 queued");
  });

  test("predictability: thinking spread and time spread beside the amounts, and the runs they are over", async ({ page }) => {
    const group = page.locator('[data-group="predictability"]');
    await expect(group.locator("h3 .term")).toHaveText("Predictability");
    await expect(group.locator("h3 .term")).toHaveAttribute("data-tip", GLOSSARY.predictability.what);
    await expect(group.locator("dt")).toHaveText(["Thinking spread", "Thinking per story", "Time spread", "Minutes per story", "Finished runs"]);
    await expect(pred(page, "thinkingSpread")).toHaveText("144%");
    await expect(pred(page, "thinkingPerStory")).toHaveText("18k chars");
    await expect(pred(page, "timeSpread")).toHaveText("62%");
    await expect(pred(page, "minutesPerStory")).toHaveText("16");
    await expect(pred(page, "spreadRuns")).toHaveText("4");                               // v2-r4 to v2-r7; the invalid v2-r8 is not there
    for (const id of ["thinkingSpread", "thinkingPerStory", "timeSpread", "minutesPerStory", "spreadRuns"] as const) {
      await expect(page.locator(`[data-pred="${id}"] dt .term`)).toHaveAttribute("data-tip", GLOSSARY[id].what);
    }
    await page.locator('[data-pred="thinkingSpread"] dt .term').hover();
    await expect(tip(page)).toContainText("Lower means more predictable turnaround.");
  });

  test("matrix rows: in progress, then queued, then finished; each with its link, status and score of record", async ({ page }) => {
    const runs = await matrix(page).locator("tbody tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.run));
    expect(runs).toEqual(["v2-r1", "v2-r2", "v2-r3", "v2-r4", "v2-r5", "v2-r6", "v2-r7", "v2-r9"]);
    await expect(rowOf(page, "v2-r5").locator("a.run-link")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r5`);
    await expect(rowOf(page, "v2-r5").locator(".m-status")).toHaveText("✓ finished");
    await expect(rowOf(page, "v2-r5").locator(".of-record")).toHaveText("63/75");
    // Of record and live look different and say which they are.
    await expect(rowOf(page, "v2-r7").locator(".pending")).toHaveText("pending");
    await rowOf(page, "v2-r7").locator(".pending").hover();
    await expect(tip(page)).toHaveText(GLOSSARY.noScore.what);
    await expect(rowOf(page, "v2-r1").locator(".live")).toHaveText("1/2");
    await expect(rowOf(page, "v2-r1").locator(".of-record")).toHaveCount(0);
    await rowOf(page, "v2-r2").locator("td.m-score .missing").hover();
    await expect(tip(page)).toContainText("Not scored yet");
  });

  test("matrix columns: one per story in the pack; not-built stories are empty", async ({ page }) => {
    await expect(matrix(page).locator("thead th.m-story")).toHaveText(["1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12"]);
    await expect(matrix(page).locator('td.m-cell[data-state="absent"] a')).toHaveCount(0);
    await expect(rowOf(page, "v2-r4").locator('td.m-cell[data-state="absent"]')).toHaveCount(9);
    await expect(rowOf(page, "v2-r2").locator('td.m-cell[data-state="absent"]')).toHaveCount(11);
  });

  test("cells: colour is the story's held-out result, text is agent minutes; in progress and not-yet-recorded say so", async ({ page }) => {
    await expect(cell(page, "v2-r5", "2")).toContainText("80m");
    await expect(cell(page, "v2-r5", "2").locator(".sq")).toHaveClass(/q-ok/);           // 14/14
    await expect(cell(page, "v2-r4", "2").locator(".sq")).toHaveClass(/q-part/);         // 12/14
    await expect(cell(page, "v2-r1", "3")).toHaveAttribute("data-state", "building");
    await expect(cell(page, "v2-r1", "3")).toContainText("building");
    await expect(cell(page, "v2-r1", "2").locator(".v")).toHaveText("—");                // dbench reports it done; no numbers yet
    await cell(page, "v2-r1", "2").locator("a").hover();
    await expect(tip(page)).toContainText("— (no usage recorded for this story yet)");
    await expect(tip(page)).toContainText("some of its held-out tests pass (9/10)");
  });

  test("the median row: per story over finished runs; a story no finished run has shows —", async ({ page }) => {
    const med = matrix(page).locator("tfoot tr.m-median");
    await expect(med.locator('td[data-story="1"]')).toHaveText("12m");
    await expect(med.locator('td[data-story="2"]')).toHaveText("17m");
    await expect(med.locator('td[data-story="3"]')).toHaveText("—");
    await expect(med.locator('td[data-story="2"]')).toHaveAttribute("data-tip", "Story 2: median 17m over 4 finished runs");
  });

  test("every cell that has a story run links to it", async ({ page }) => {
    const links = matrix(page).locator("td.m-cell a.story-run-link");
    await expect(links).toHaveCount(12);   // 4 finished × 2 stories, the partial rerun's story 2, and the running run's 1, 2 and 3
    for (const a of await links.all()) {
      const td = a.locator("xpath=ancestor::td[1]");
      const run = await a.locator("xpath=ancestor::tr[1]").getAttribute("data-run");
      await expect(a).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/${run}/s/${await td.getAttribute("data-story")}`);
    }
    await cell(page, "v2-r6", "1").locator("a").click();
    await expect(page).toHaveURL(new RegExp(`#/vidi/r/${enc(SWIFT)}/v2-r6/s/1$`));
    await expect(page.locator('[data-page="storyRun"]')).toBeVisible();
  });

  test("the metric switch changes every cell's text, the median, the flags and the run totals; colour stays held-out", async ({ page }) => {
    const pressed = page.getByRole("group", { name: "Show" }).locator('[aria-pressed="true"]');
    await expect(pressed).toHaveText("minutes");
    await expect(rowOf(page, "v2-r5").locator("td.m-total")).toHaveText("1h31m");

    await show(page, "output tokens");
    await expect(pressed).toHaveText("output tokens");
    await expect(cell(page, "v2-r5", "2").locator(".v")).toHaveText("175k");
    await expect(matrix(page).locator('tfoot td[data-story="1"]')).toHaveText("61k");
    await expect(cell(page, "v2-r7", "1").locator(".flag")).toHaveAttribute("data-mechanism", "not recorded");

    await show(page, "tool calls");
    await expect(cell(page, "v2-r6", "2").locator(".v")).toHaveText("262");
    await expect(cell(page, "v2-r6", "2").locator(".flag")).toHaveAttribute("data-mechanism", "many small steps");
    await expect(rowOf(page, "v2-r6").locator("td.m-total")).toHaveText("354");

    await show(page, "held-out");
    await expect(cell(page, "v2-r4", "2").locator(".v")).toHaveText("12/14");
    await expect(cell(page, "v2-r4", "2").locator(".sq")).toHaveClass(/q-part/);
    await expect(rowOf(page, "v2-r4").locator("td.m-total")).toHaveText("1 of 2 pass");

    await show(page, "generated tok/s");
    await expect(cell(page, "v2-r5", "2").locator(".v")).toHaveText("36");
    await expect(cell(page, "v2-r5", "2").locator(".sq")).toHaveClass(/q-ok/);
  });

  test("flags: on each cell more than 10% from its story's median, with the mechanism and its numbers on hover", async ({ page }) => {
    const flagged = await matrix(page).locator("td.m-cell .flag").evaluateAll((fs) =>
      fs.map((f) => `${f.closest("tr")!.dataset.run}/${f.closest("td")!.dataset.story}: ${(f as HTMLElement).dataset.mechanism}`));
    expect(flagged).toEqual(["v2-r5/2: verbose thinking", "v2-r6/1: hung command", "v2-r9/2: verbose thinking"]);
    await cell(page, "v2-r5", "2").locator(".flag").hover();
    await expect(tip(page)).toContainText("+363% above the story's median minutes (17m over 4 finished runs). Mechanism: verbose thinking.");
    await expect(tip(page)).toContainText("largest thinking block 64,543 chars against 4,100 (15.7×)");
    await expect(tip(page)).toContainText("slower generation: decode 41.7 tok/s against 99.0");   // it fired too, but thinking wins
    await cell(page, "v2-r6", "1").locator(".flag").hover();
    await expect(tip(page)).toContainText("one bash call ran 780 s (52% of the story): npm run dev");
    // Below the median is flagged too, and says so.
    await show(page, "tool calls");
    await cell(page, "v2-r4", "2").locator(".flag").hover();
    await expect(tip(page)).toContainText("−30% below the story's median tool calls");
    await expect(tip(page)).toContainText("Mechanism: unexplained. None of the rules fired");
  });

  test("keyboard: arrows move between cells, skipping empty ones; Enter opens the story run; the focus ring shows", async ({ page }) => {
    const link = (run: string, story: string) => cell(page, run, story).locator("a");
    await expect(matrix(page).locator('td.m-cell a[tabindex="0"]')).toHaveCount(1);           // one tab stop for the matrix
    await link("v2-r4", "1").focus();
    await page.keyboard.press("ArrowRight");
    await expect(link("v2-r4", "2")).toBeFocused();
    await page.keyboard.press("ArrowRight");                                                  // nothing to the right: stays
    await expect(link("v2-r4", "2")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(link("v2-r5", "2")).toBeFocused();
    for (const run of ["v2-r6", "v2-r7", "v2-r9"]) { await page.keyboard.press("ArrowDown"); await expect(link(run, "2")).toBeFocused(); }
    await page.keyboard.press("ArrowDown");                                                   // the last row: stays
    await expect(link("v2-r9", "2")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(link("v2-r4", "2")).toBeFocused();
    await page.keyboard.press("ArrowUp");                                                     // the queued runs have nothing, and v2-r1 is above them
    await expect(link("v2-r1", "2")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(link("v2-r1", "3")).toBeFocused();
    await page.keyboard.press("ArrowUp");                                                     // nobody else built story 3
    await expect(link("v2-r1", "3")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(link("v2-r1", "1")).toBeFocused();
    expect(await link("v2-r1", "1").evaluate((a) => getComputedStyle(a).outlineStyle)).toBe("solid");
    await expect(matrix(page).locator('td.m-cell a[tabindex="0"]')).toHaveCount(1);
    await expect(link("v2-r1", "1")).toHaveAttribute("tabindex", "0");                       // the tab stop follows the focus
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/vidi/r/${enc(SWIFT)}/v2-r1/s/1$`));
  });

  test("where the time went: one bar per run with a breakdown, on one scale, the same segments; no accounting mark", async ({ page }) => {
    const bars = page.getByRole("figure", { name: "Where the time went, per run" });
    const runs = await bars.locator(".bar-row").evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.run));
    expect(runs).toEqual(["v2-r4", "v2-r5", "v2-r6", "v2-r7", "v2-r9"]);   // queued runs have none; v2-r1's one breakdown isn't available
    const width = (run: string) => bars.locator(`[data-run="${run}"] .bar`).evaluate((el) => el.getBoundingClientRect().width);
    expect(await width("v2-r5")).toBeGreaterThan(await width("v2-r6"));                       // 91 min against 43
    expect(await width("v2-r6")).toBeGreaterThan(await width("v2-r4"));
    await expect(bars.locator('[data-run="v2-r5"] .bar-total')).toHaveText("1h31m");
    await bars.locator('[data-run="v2-r6"] [data-seg="tools"]').hover();
    await expect(tip(page)).toContainText("Tools 18 min (43%) over 2 stories");
    await expect(bars.locator(".check-flag, .check-unchecked")).toHaveCount(0);
    await expect(bars).not.toContainText(/accounting|unchecked|⚠/i);
    await expect(bars.locator("figcaption")).toContainText("Between sessions");
  });

  test("a Claude Code combination: its bar is drawn as it is, with no mark and no word on hover", async ({ page }) => {
    await open(page, OPUS);
    const bars = page.getByRole("figure", { name: "Where the time went, per run" });
    await expect(bars.locator('[data-run="run-9"] .bar')).toBeVisible();
    await expect(bars.locator('[data-run="run-9"]')).not.toContainText(/unchecked|accounting/i);
    for (const tipText of await bars.locator("[data-tip]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""))) expect(tipText).not.toMatch(/accounting|unchecked|harness|recompute|What to do/i);
  });

  test("the mechanism tally follows the metric shown", async ({ page }) => {
    const tally = page.locator('[data-section="tally"]');
    await expect(tally.locator(".tally-line")).toHaveText(["hung command1 of 10 story runs", "verbose thinking2 of 10 story runs"]);
    await expect(tally).toContainText("3 of 10 story runs flagged on minutes");
    await show(page, "tool calls");
    await expect(tally.locator(".tally-line")).toHaveText(["verbose thinking2 of 10 story runs", "many small steps1 of 10 story runs", "unexplained2 of 10 story runs"]);
    await tally.getByText("many small steps").hover();
    await expect(tip(page)).toContainText("At least 1.5× the other runs' model calls");
  });

  test("related: each machine links to its page; no other combination of this model", async ({ page }) => {
    const related = page.locator('[data-section="related"]');
    await expect(related.locator(".related-machines li")).toHaveText(["node-a Intel Core i9 + RTX 4090 64GB"]);
    await expect(related.locator(".related-machines a.machine-link")).toHaveAttribute("href", "#/machines/node-a");
    await expect(related.locator('[data-related="none"]')).toHaveText("No other combination of qwen/3.8-swift-1.5/27b in vidi.");
  });

  test("fits at 1000 px: nothing overflows the page, and the matrix needs no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".matrix-wrap").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});

test.describe("combination page: predictability with fewer than three finished runs", () => {
  test("two finished runs: each spread is a dash saying three are needed; the amounts and the run count still show", async ({ page }) => {
    await page.route("**/api/state", async (route) => {
      const res = await route.fetch();
      const s = (await res.json()) as State;
      for (const r of s.rows) if (r.stack === SWIFT && ["v2-r6", "v2-r7"].includes(r.runId)) r.status = "failed";
      await route.fulfill({ response: res, json: s });
    });
    await open(page, SWIFT);
    for (const id of ["thinkingSpread", "timeSpread"]) {
      await expect(pred(page, id).locator(".missing")).toHaveText("—");
      await pred(page, id).locator(".missing").hover();
      await expect(tip(page)).toHaveText("Needs three finished runs");
    }
    await expect(pred(page, "thinkingPerStory")).toHaveText("10k chars");                  // 7,600 8,000 12,000 328,750
    await expect(pred(page, "minutesPerStory")).toHaveText("14");                          // 660 690 960 4,811 s
    await expect(pred(page, "spreadRuns")).toHaveText("2");
  });

  test("one finished run (Opus): no spread, its minutes per story, and no thinking figure where none was recorded", async ({ page }) => {
    await open(page, OPUS);
    await expect(pred(page, "timeSpread").locator(".missing")).toHaveAttribute("data-tip", GLOSSARY.spreadTooFewRuns.what);
    await expect(pred(page, "minutesPerStory")).toHaveText("8");
    await expect(pred(page, "thinkingPerStory").locator(".missing")).toHaveAttribute("data-tip", GLOSSARY.spreadNotRecorded.what);
    await expect(pred(page, "spreadRuns")).toHaveText("1");
  });

  test("no finished run (mlx-serve): dashes and 0 runs, and nothing about why beyond the three runs needed", async ({ page }) => {
    await open(page, MLX);
    await expect(pred(page, "spreadRuns")).toHaveText("0");
    for (const id of ["thinkingSpread", "thinkingPerStory", "timeSpread", "minutesPerStory"]) await expect(pred(page, id)).toHaveText("—");
  });
});

test.describe("combination page: empty and absent states", () => {
  test("finished but unscored (gufo, a v1 run): not ranked and why; no median to differ from; a related combination links", async ({ page }) => {
    await open(page, GUFO);
    await expect(page.locator('[data-kpi="score"] dd')).toHaveText("not ranked: 1 finished, score pending");
    await expect(page.locator('[data-kpi="hoursPerStory"] .missing')).toHaveText("—");
    await expect(page.locator(".run-counts")).toHaveText("Runs: 1 finished (0 scored, 1 pending)");
    await expect(matrix(page).locator("td.m-cell .flag")).toHaveCount(0);
    await expect(page.locator('[data-section="tally"] [data-tally="none"]')).toHaveText("No story has 2 finished runs yet, so there is no median to differ from.");
    // gufo's only run is v1, so its page is v1's; mlx-serve has no v1 run, so it isn't offered to compare with.
    await expect(page.locator(`[data-section="related"] li[data-stack="${MLX}"]`)).toHaveCount(0);
  });

  test("only a running run, nothing recorded (mlx-serve): the story being built, no time bars, no numbers of record", async ({ page }) => {
    await open(page, MLX);
    await expect(cell(page, "v2-r1", "1")).toHaveAttribute("data-state", "building");
    await expect(page.locator('[data-section="time"]')).toContainText("No run has a recorded time split yet.");
    await expect(page.locator('[data-kpi="score"] dd')).toHaveText("not ranked: no finished run yet");
    await expect(page.locator(".run-counts")).toHaveText("Runs: 1 running");
    await expect(rowOf(page, "v2-r1").locator("td.m-total .missing")).toHaveText("—");
  });

  test("only queued and cancelled runs (Qwen 3.8 27B): every cell empty, nothing to link to", async ({ page }) => {
    await open(page, QWEN_27B);
    await expect(matrix(page).locator("td.m-cell a")).toHaveCount(0);
    await expect(page.locator(".run-counts")).toHaveText("Runs: 1 queued · 1 cancelled");
    // The runs that did not finish are folded away at first; the queued run is shown, and the heading says how many are not.
    expect(await matrix(page).locator("tbody tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.status))).toEqual(["queued"]);
    await matrix(page).getByRole("button", { name: /Did not finish/ }).click();
    expect(await matrix(page).locator("tbody tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.status))).toEqual(["queued", "cancelled"]);
  });
});
