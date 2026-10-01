import { expect, test, type Page } from "@playwright/test";
import type { Intervention, State } from "../shared/types.ts";

// What a run's record says about the run itself, on every page that names it. The fixture's v2-r8 (Swift 1.5) is
// marked invalid: it finished fast and scored 74/75 because it read the reference build. It also has four
// interventions: story 1's watchdog killing a silent call twice, a run-wide reboot, and story 2 ended at its cap.
//
// MECE by mark, then by page:
//   invalid — struck through with the reason on hover wherever it is named (overview, combination matrix and time
//     bars, story page, run and story-run pages, machine history, the machine's now line); left out of every figure
//     (ranking, KPIs, story medians, divergence flags, the tally, against-the-combination medians, needs you); and its
//     own pages say so at the top.
//   intervened — a marker with every intervention on hover on the run page, each affected story run's page, the
//     matrix cells of the affected story runs, and the machine's history rows; never on a story run it didn't touch;
//     and a run with interventions stays in every figure.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const REASON = "read the reference build in story 2, through a clone of the repo the sandbox did not hide";
const NARROW = 1000;
const enc = encodeURIComponent;
const runUrl = (run: string) => `/#/vidi/r/${enc(SWIFT)}/${run}`;
const storyRunUrl = (run: string, story: string) => `${runUrl(run)}/s/${story}`;
const tip = (page: Page) => page.getByRole("tooltip");
const rowOf = (s: State, runId: string) => s.rows.find((r) => r.stack === SWIFT && r.runId === runId)!;
const matrix = (page: Page) => page.getByRole("table", { name: "Runs × stories" });
const mRow = (page: Page, run: string) => matrix(page).locator(`tr[data-run="${run}"]`);
const mCell = (page: Page, run: string, story: string) => mRow(page, run).locator(`td.m-cell[data-story="${story}"]`);
const strike = (page: Page, sel: ReturnType<Page["locator"]>) => sel.evaluate((el) => getComputedStyle(el).textDecorationLine);

/** Serve the page a changed state for this test only. */
async function patchState(page: Page, change: (s: State) => void) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    for (const r of s.rows) if (r.live?.status === "running") { r.live.agentMinutes ??= 0; r.live.storyStartedAt = s.now - r.live.agentMinutes * 60; }
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("the server carries both marks", () => {
  test("the invalid run has its reason and date; its interventions come oldest first; other runs have neither", async ({ request }) => {
    const s = (await (await request.get("/api/state")).json()) as State;
    const r8 = rowOf(s, "v2-r8");
    expect(r8.invalid).toEqual({ reason: REASON, since: "2026-09-30" });
    expect(r8.interventions.map((i) => i.story)).toEqual(["1", "1", null, "2"]);
    expect(rowOf(s, "v2-r5").invalid).toBeNull();
    expect(rowOf(s, "v2-r5").interventions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("invalid: left out of every figure", () => {
  test("overview: the ranking and its numbers are the valid runs' (v2-r8's 74 lifts nothing); counted apart, named, with why", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("table", { name: "Combinations" }).locator(`tr[data-stack="${SWIFT}"]`);
    await expect(row.locator("td.score")).toContainText("63 (58–68) n=3");
    await expect(row.locator("td.pooled")).toHaveText("84%");
    const inv = row.locator('td.not-counted [data-standing="invalid"]');
    await expect(inv).toHaveText("1 invalid (v2-r8)");
    expect(await strike(page, inv.locator(".invalid-run"))).toContain("line-through");
    await inv.hover();
    await expect(tip(page)).toContainText(`v2-r8: Invalid run: ${REASON} (marked 2026-09-30).`);
  });

  test("overview: needs you says nothing about an invalid run (it would, unmarked: the control)", async ({ page }) => {
    // A finished run with no score of record that the harness says needs a person: listed, unless it is invalid.
    const NEEDS_PERSON = { rescore: "failed" as const, reason: "no browser", version: "", packRef: "", at: "", needsPerson: true, attempts: null, lastAttemptAt: "" };
    await patchState(page, (s) => { Object.assign(rowOf(s, "v2-r8"), { scores: {}, rescores: [], finalize: NEEDS_PERSON }); });
    await page.goto("/");
    const needs = page.locator('[data-page="overview"] [data-section="needs"]');
    await expect(needs).toBeVisible();
    await expect(needs.locator('li[data-need="unscored"]', { hasText: "v2-r8" })).toHaveCount(0);
    await page.unroute("**/api/state");
    await patchState(page, (s) => { Object.assign(rowOf(s, "v2-r8"), { scores: {}, rescores: [], finalize: NEEDS_PERSON, invalid: null }); });
    await page.reload();
    await expect(needs.locator('li[data-need="unscored"]', { hasText: "v2-r8" })).toHaveCount(1);
  });

  test("overview: a running invalid run is struck through on its machine's now line", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, "v2-r1").invalid = { reason: "test", since: "" }; });
    await page.goto("/");
    const link = page.locator('[data-page="overview"] [data-section="now"] tr[data-machine="node-a"] a.run-link');
    await expect(link).toHaveAttribute("data-invalid", "true");
    expect(await strike(page, link.locator("b"))).toContain("line-through");
    expect(await strike(page, link.locator(".stack-label"))).toContain("line-through");
  });

  test("combination page: the headline numbers leave it out; it is listed apart, struck through", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page.locator('[data-kpi="score"] dd')).toHaveText("63 (58–68) n=3 / 75 · pooled 84%");
    await expect(page.locator('[data-kpi="hoursPerStory"] dd')).toHaveText("0.4 (0.2–0.8)");
    await expect(page.locator('.run-counts [data-standing="invalid"] a.run-link')).toHaveAttribute("data-invalid", "true");
  });

  test("combination matrix: its row is shown, struck through, with INVALID for a score and the reason on hover", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    const r = mRow(page, "v2-r8");
    await expect(r).toHaveAttribute("data-invalid", "true");
    expect(await strike(page, r.locator("a.run-link b"))).toContain("line-through");
    await expect(r.locator("td.m-score .invalid-tag")).toHaveText("invalid");
    await expect(r.locator("td.m-score .of-record")).toHaveCount(0);
    await r.locator("a.run-link").hover();
    await expect(tip(page)).toContainText(`Invalid run: ${REASON}`);
    await r.locator("td.m-score .invalid-tag").focus();
    await expect(tip(page)).toContainText("left out of every figure");
    await expect(mCell(page, "v2-r8", "1")).toContainText("3m");     // its numbers are shown for the record
  });

  test("combination matrix: never flagged, not in the story medians, not in the tally", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(mRow(page, "v2-r8").locator(".flag")).toHaveCount(0);   // 3m against a median of 12m
    await expect(matrix(page).locator('tfoot td[data-story="1"]')).toHaveText("12m");
    await expect(matrix(page).locator('tfoot td[data-story="1"]')).toHaveAttribute("data-tip", /over 4 finished runs/);
    await expect(page.locator('[data-section="tally"]')).toContainText("of 9 story runs");
  });

  test("combination: the time bars show it, struck through", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    const link = page.getByRole("figure", { name: "Where the time went, per run" }).locator('[data-run="v2-r8"] a.run-link');
    await expect(link).toHaveAttribute("data-invalid", "true");
  });

  test("story page: its entry is struck through, tagged invalid, never flagged; the combination's median leaves it out", async ({ page }) => {
    await page.goto("/#/vidi/s/1");
    const group = page.locator(`[data-page="story"] [data-section="combinations"] tbody[data-stack="${SWIFT}"]`);
    const e = group.locator('tr.sp-entry[data-run="v2-r8"]');
    await expect(e).toHaveAttribute("data-invalid", "true");
    expect(await strike(page, e.locator("a.run-link b"))).toContain("line-through");
    await expect(e.locator(".invalid-tag")).toHaveText("invalid");
    await expect(e.locator(".flag")).toHaveCount(0);
    await expect(group.locator("tr.sp-median")).toContainText("over 4 finished runs (invalid left out)");
    await expect(group.locator('tr.sp-median td[data-measure="minutes"]')).toContainText("n=4");
    await expect(page.locator('[data-page="story"] [data-section="time"] [data-run="v2-r8"] a.run-link')).toHaveAttribute("data-invalid", "true");
  });

  test("run page: says so at the top; no score of record, and why, naming the re-score it isn't", async ({ page }) => {
    await page.goto(runUrl("v2-r8"));
    const banner = page.locator('[data-page="run"] [data-section="invalid"]');
    await expect(banner).toContainText(`This run is invalid: ${REASON} (marked 2026-09-30).`);
    await expect(banner).toContainText("left out of every figure");
    const first = await page.locator('[data-page="run"] > *').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section ?? e.className));
    expect(first.slice(0, 2)).toEqual(["breadcrumb", "invalid"]);
    await expect(page.locator('[data-page="run"] .rp-header .na')).toHaveAttribute("data-reason", "invalid");
    await expect(page.locator('[data-page="run"] .rp-header .why')).toContainText("Its re-score, 74/75 under vidi-v2.0-pre1, is not a result");
    expect(await strike(page, page.locator('[data-page="run"] .rp-header .run-id'))).toContain("line-through");
  });

  test("a valid run's page has no banner", async ({ page }) => {
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] .rp-header')).toBeVisible();
    await expect(page.locator('[data-section="invalid"]')).toHaveCount(0);
  });

  test("a valid run's page: related runs strike the invalid one through", async ({ page }) => {
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] [data-section="related"] li[data-run="v2-r8"] a.run-link')).toHaveAttribute("data-invalid", "true");
  });

  test("story-run page: says so at the top, and the breadcrumb strikes the run through", async ({ page }) => {
    await page.goto(storyRunUrl("v2-r8", "1"));
    await expect(page.locator('[data-page="storyRun"] [data-section="invalid"]')).toContainText(`This story run belongs to an invalid run: ${REASON}`);
    await expect(page.locator('[data-page="storyRun"] .breadcrumb a.run-link')).toHaveAttribute("data-invalid", "true");
  });

  test("another run's story-run page: the invalid run is shown against it, struck through, but not in the median", async ({ page }) => {
    await page.goto(storyRunUrl("v2-r5", "1"));
    const against = page.locator('[data-page="storyRun"] [data-section="against"]');
    await expect(against.locator('tr[data-run="v2-r8"]')).toHaveAttribute("data-invalid", "true");
    await expect(against.locator('tr.median-row td[data-measure="minutes"]')).toContainText("n=4");   // v2-r4, r6, r7 and r1; not r8
  });

  test("machine page: its history row is struck through, INVALID where the score would be", async ({ page }) => {
    await page.goto("/#/m/node-a");
    const r = page.locator('[data-page="machine"] [data-section="history"] tr[data-run="v2-r8"]');
    await expect(r).toHaveAttribute("data-invalid", "true");
    expect(await strike(page, r.locator("a.run-link b"))).toContain("line-through");
    await expect(r.locator(".h-score .invalid-tag")).toHaveText("invalid");
  });

  test("keyboard: the invalid tag takes focus and shows the reason", async ({ page }) => {
    await page.goto("/#/m/node-a");
    await page.locator('[data-page="machine"] tr[data-run="v2-r8"] .invalid-tag').focus();
    await expect(tip(page)).toContainText(REASON);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("intervened: marked, and still counted", () => {
  test("run page: a marker by the status, every intervention on hover (repeats once, with how many times)", async ({ page }) => {
    await page.goto(runUrl("v2-r8"));
    const m = page.locator('[data-page="run"] [data-fact="status"] .intervened');
    await expect(m).toHaveText("✱ intervened");
    await expect(m).toHaveAttribute("data-intervened", "4");
    await m.hover();
    await expect(tip(page)).toContainText("Operator interventions (4):");
    await expect(tip(page)).toContainText("2026-09-30 08:10 UTC · story 1: interrupted a tool call silent for 600s (killed processes under the workspace) (2 times)");
    await expect(tip(page)).toContainText("2026-09-30 09:00 UTC · the run: node-a rebooted by the operator");
    await expect(tip(page)).toContainText("2026-09-30 10:30 UTC · story 2: story ended by the operator at its cap");
  });

  test("run page: the interventions section lists each, oldest first; the cost table marks the stories touched", async ({ page }) => {
    await page.goto(runUrl("v2-r8"));
    const list = page.locator('[data-page="run"] [data-section="interventions"] li');
    await expect(list).toHaveCount(3);
    expect(await list.evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.story))).toEqual(["1", "run", "2"]);
    await expect(list.first()).toContainText("(2 times)");
    await expect(page.locator('[data-page="run"] [data-section="cost"] .intervened')).toHaveCount(2);
  });

  test("run page of a run with none: no marker, no section", async ({ page }) => {
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] .rp-header')).toBeVisible();
    await expect(page.locator('[data-page="run"] .intervened')).toHaveCount(0);
    await expect(page.locator('[data-section="interventions"]')).toHaveCount(0);
  });

  test("story-run pages: only the interventions in that story; none on a story nobody touched; a run-wide one on none", async ({ page }) => {
    await page.goto(storyRunUrl("v2-r8", "1"));
    const m = page.locator('[data-page="storyRun"] .of-run .intervened');
    await expect(m).toHaveAttribute("data-intervened", "2");
    await m.hover();
    await expect(tip(page)).toContainText("Operator interventions (2):");
    await expect(tip(page)).not.toContainText("the run:");
    await page.goto(storyRunUrl("v2-r8", "2"));
    await expect(page.locator('[data-page="storyRun"] .of-run .intervened')).toHaveAttribute("data-intervened", "1");
    await page.goto(storyRunUrl("v2-r5", "1"));
    await expect(page.locator('[data-page="storyRun"] .rp-header')).toBeVisible();
    await expect(page.locator('[data-page="storyRun"] .intervened')).toHaveCount(0);
  });

  test("combination matrix: a mark in each affected cell and on the run; none elsewhere", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(mCell(page, "v2-r8", "1").locator(".intervened")).toHaveAttribute("data-intervened", "2");
    await expect(mCell(page, "v2-r8", "2").locator(".intervened")).toHaveAttribute("data-intervened", "1");
    await expect(mRow(page, "v2-r8").locator("th .intervened")).toHaveAttribute("data-intervened", "4");
    await expect(matrix(page).locator(".intervened")).toHaveCount(3);
    await mCell(page, "v2-r8", "1").locator(".intervened").hover();
    await expect(tip(page)).toContainText("story 1: interrupted a tool call silent for 600s");
  });

  test("machine page: a mark on the history row of a run with interventions; none on the others", async ({ page }) => {
    await page.goto("/#/m/node-a");
    const h = page.locator('[data-page="machine"] [data-section="history"]');
    await expect(h.locator('tr[data-run="v2-r8"] .intervened')).toHaveAttribute("data-intervened", "4");
    await expect(h.locator(".intervened")).toHaveCount(1);
  });

  test("story page: a mark on the affected story run's entry", async ({ page }) => {
    await page.goto("/#/vidi/s/2");
    await expect(page.locator(`[data-page="story"] tbody[data-stack="${SWIFT}"] tr.sp-entry[data-run="v2-r8"] .intervened`)).toHaveAttribute("data-intervened", "1");
  });

  test("a valid run with interventions stays in every figure: ranking, KPIs, median, flags; and is marked", async ({ page }) => {
    const iv: Intervention[] = [{ at: Date.parse("2026-09-30T06:00:00Z") / 1000, story: "2", text: "node-a froze; restarted by the operator" }];
    await patchState(page, (s) => { rowOf(s, "v2-r5").interventions = iv; });
    await page.goto("/");
    await expect(page.getByRole("table", { name: "Combinations" }).locator(`tr[data-stack="${SWIFT}"] td.score`)).toContainText("63 (58–68) n=3");
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page.locator('[data-kpi="score"] dd')).toHaveText("63 (58–68) n=3 / 75 · pooled 84%");
    await expect(matrix(page).locator('tfoot td[data-story="2"]')).toHaveText("17m");
    await expect(mCell(page, "v2-r5", "2").locator(".flag")).toHaveCount(1);          // still judged against the median
    await expect(mCell(page, "v2-r5", "2").locator(".intervened")).toHaveAttribute("data-intervened", "1");
    await expect(mRow(page, "v2-r5").locator(".of-record")).toHaveText("63/75");
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] .record-n')).toHaveText("63");
    await expect(page.locator('[data-page="run"] [data-fact="status"] .intervened')).toHaveAttribute("data-intervened", "1");
  });

  test("many interventions: the hover lists at most eight lines, then says how many more", async ({ page }) => {
    const iv: Intervention[] = Array.from({ length: 11 }, (_, i) => ({ at: Date.parse("2026-09-30T06:00:00Z") / 1000 + i * 60, story: String(i + 1), text: `line ${i + 1}` }));
    await patchState(page, (s) => { rowOf(s, "v2-r5").interventions = iv; });
    await page.goto(runUrl("v2-r5"));
    await page.locator('[data-page="run"] [data-fact="status"] .intervened').hover();
    await expect(tip(page)).toContainText("line 8");
    await expect(tip(page)).not.toContainText("line 9");
    await expect(tip(page)).toContainText("… and 3 more on the run page");
    await expect(page.locator('[data-page="run"] [data-section="interventions"] li')).toHaveCount(11);
  });

  test("keyboard: the marker takes focus and shows its list", async ({ page }) => {
    await page.goto(runUrl("v2-r8"));
    await page.locator('[data-page="run"] [data-fact="status"] .intervened').focus();
    await expect(tip(page)).toContainText("Operator interventions (4):");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: 900 } });
  for (const [name, url] of [["run page", runUrl("v2-r8")], ["story-run page", storyRunUrl("v2-r8", "1")], ["machine page", "/#/m/node-a"],
    ["combination page", `/#/vidi/c/${enc(SWIFT)}`], ["story page", "/#/vidi/s/2"]] as const) {
    test(`${name}: the marks fit, nothing overflows`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator("[data-page]")).toBeVisible();
      await expect(page.locator(".intervened").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const w of await page.locator(".matrix-wrap, .sp-table-wrap").all()) expect(await w.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
  }
});
