import { expect, test, type Page } from "@playwright/test";
import { GLOSSARY } from "../shared/glossary.ts";
import type { Intervention, State } from "../shared/types.ts";

// What a run's record says about the run itself, on every page that names it. The fixture's v2-r8 (Swift 1.5) is
// marked invalid: it finished fast and scored 74/75 because it read the reference build. Its four interventions
// (story 1's watchdog killing a silent call twice, a run-wide reboot, and story 2 ended at its cap) are given to
// v2-r5 here, since v2-r8 itself is nowhere to be seen.
//
// MECE by mark, then by page:
//   invalid — not in the app at all: no row, chip, name, count or banner on any page; its addresses are not found;
//     its figures lift nothing. The server's state has no such run (the faults feed names it instead).
//   intervened — a marker with every intervention on hover on the run page, each affected story run's page, the
//     matrix cells of the affected story runs, and the machine's history rows; never on a story run it didn't touch;
//     a run with interventions stays in every figure; and each intervention is said in the page's own words, never
//     the record's account of a harness, a bug or a fix.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const NARROW = 1000;
const enc = encodeURIComponent;
const runUrl = (run: string) => `/#/vidi/r/${enc(SWIFT)}/${run}`;
const storyRunUrl = (run: string, story: string) => `${runUrl(run)}/s/${story}`;
const tip = (page: Page) => page.getByRole("tooltip");
const rowOf = (s: State, runId: string) => s.rows.find((r) => r.stack === SWIFT && r.runId === runId)!;
const matrix = (page: Page) => page.getByRole("table", { name: "Runs × stories" });
const mRow = (page: Page, run: string) => matrix(page).locator(`tr[data-run="${run}"]`);
const mCell = (page: Page, run: string, story: string) => mRow(page, run).locator(`td.m-cell[data-story="${story}"]`);

/** v2-r8's four interventions, as the fixture's record has them. */
const FOUR: Intervention[] = [
  { at: 1790755800, story: "1", text: "interrupted a tool call silent for 600s (killed processes under the workspace)" },
  { at: 1790755830, story: "1", text: "interrupted a tool call silent for 600s (killed processes under the workspace)" },
  { at: 1790758800, story: null, text: "node-a rebooted by the operator; the run resumed at story 2" },
  { at: 1790764200, story: "2", text: "story ended by the operator at its cap" },
];
const SILENT = "a tool call silent for 600 s was interrupted";
const OTHER = "an intervention (in the run's record)";

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

/** v2-r5 with v2-r8's interventions. */
const intervened = (page: Page) => patchState(page, (s) => { rowOf(s, "v2-r5").interventions = FOUR; });

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("the server", () => {
  test("has no invalid run in its state, and no mark of invalidity on any run; interventions come oldest first", async ({ request }) => {
    const s = (await (await request.get("/api/state")).json()) as State;
    expect(s.rows.some((r) => r.runId === "v2-r8")).toBe(false);
    for (const r of s.rows) {
      expect(r).not.toHaveProperty("invalid");
      expect(r).not.toHaveProperty("finalize");
    }
    expect(rowOf(s, "v2-r5").interventions).toEqual([]);
    const feed = (await (await request.get("/api/faults")).json()) as { faults: { kind: string; run: string; detail: Record<string, unknown> }[] };
    const invalid = feed.faults.find((f) => f.kind === "run_invalid" && f.run === "v2-r8")!;
    expect(invalid.detail).toMatchObject({ reason: "read the reference build in story 2, through a clone of the repo the sandbox did not hide", since: "2026-09-30" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("invalid: not in the app at all", () => {
  test("overview: the ranking and its numbers are the other runs' (v2-r8's 74 lifts nothing); nothing counted apart", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("table", { name: "Combinations" }).locator(`tr[data-stack="${SWIFT}"]`);
    await expect(row.locator("td.score")).toContainText("63 (58–68) n=3");
    await expect(row.locator("td.mean")).toHaveText("84%");
    await expect(row.locator("td.not-counted")).toHaveText("1 running2 queued1 pending1 partial rerun");
    await expect(page.locator("main")).not.toContainText(/invalid|v2-r8/i);
  });

  test("combination page: not in the counts, the matrix, the time bars, the tally or the related runs", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page.locator(".run-counts")).toHaveText("Runs: 5 finished (3 scored, 1 pending, 1 partial rerun) · 1 running · 2 queued");
    await expect(mRow(page, "v2-r8")).toHaveCount(0);
    await expect(page.getByRole("figure", { name: "Where the time went, per run" }).locator('[data-run="v2-r8"]')).toHaveCount(0);
    await expect(matrix(page).locator('tfoot td[data-story="1"]')).toHaveText("12m");   // the median of the other finished runs
    await expect(page.locator('[data-page="combination"]')).not.toContainText(/invalid|v2-r8/i);
  });

  test("story page: no entry, no bar, no count; the combination's median is over the other runs", async ({ page }) => {
    await page.goto("/#/vidi/s/2");
    const group = page.locator(`[data-page="story"] tbody[data-stack="${SWIFT}"]`);
    await expect(group.locator('tr.sp-entry[data-run="v2-r8"]')).toHaveCount(0);
    await expect(group.locator("tr.sp-median")).toContainText("over 4 finished runs");
    await expect(page.locator('[data-page="story"] [data-section="time"] [data-run="v2-r8"]')).toHaveCount(0);
    await expect(page.locator('[data-page="story"]')).not.toContainText(/invalid|v2-r8/i);
  });

  test("its own addresses are not found, like any run that doesn't exist", async ({ page }) => {
    await page.goto(runUrl("v2-r8"));
    await expect(page.locator('[data-page="notFound"]')).toBeVisible();
    await expect(page.locator('[data-page="notFound"]')).toContainText("There is no run v2-r8 of");
    await page.goto(storyRunUrl("v2-r8", "1"));
    await expect(page.locator('[data-page="notFound"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/invalid/i);
  });

  test("another run's pages: not among the related runs, not against the story, not a comparison; medians over the others", async ({ page }) => {
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] [data-section="related"] li[data-run="v2-r8"]')).toHaveCount(0);
    await expect(page.locator('[data-page="run"] [data-section="compare"] option[value="v2-r8"]')).toHaveCount(0);
    await page.goto(storyRunUrl("v2-r5", "2"));
    const against = page.locator('[data-page="storyRun"] [data-section="against"]');
    await expect(against.locator('tr[data-run="v2-r8"]')).toHaveCount(0);
    await expect(against.locator("tr.median-row")).toContainText("Median of the other 4 runs");   // v2-r1, r4, r6 and r7
    await expect(page.locator('[data-page="storyRun"] [data-section="differed"] option[value="v2-r8"]')).toHaveCount(0);
    await expect(page.locator('[data-page="storyRun"] [data-section="across"]')).not.toContainText(/invalid/i);
    await expect(page.locator('[data-page="storyRun"] [data-section="nav"] li[data-run="v2-r8"]')).toHaveCount(0);
  });

  test("machine page: no history row, no job", async ({ page }) => {
    await page.goto("/#/m/node-a");
    await expect(page.locator('[data-page="machine"] [data-section="history"] tr[data-run="v2-r8"]')).toHaveCount(0);
    await expect(page.locator('[data-page="machine"]')).not.toContainText(/invalid|v2-r8/i);
  });

  test("a machine running a run the app doesn't show is busy, not idle, and names no run", async ({ page }) => {
    await patchState(page, (s) => {
      s.rows = s.rows.filter((r) => !(r.stack === SWIFT && r.runId === "v2-r1"));
      const m = s.machines.find((x) => x.node === "node-a")!; m.running = null; m.busy = true;
    });
    await page.goto("/");
    const now = page.locator('[data-page="overview"] [data-section="now"] [data-machine="node-a"]');
    await expect(now).toHaveAttribute("data-state", "running");
    await expect(now.locator(".card-state")).toHaveText("running");
    await page.goto("/#/m/node-a");
    await expect(page.locator('[data-page="machine"] [data-section="now"] .mp-busy')).toHaveText("▶ Running.");
    await expect(page.locator('[data-page="machine"] [data-section="now"] .mp-idle')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("collapsed: a stretch of stories in a row that pass none is marked, as a fact", () => {
  const collapse = (page: Page, ids: string[]) => patchState(page, (s) => { for (const st of rowOf(s, "v2-r5").stories) if (ids.includes(st.id)) st.collapsed = true; });

  test("each story of the stretch carries the mark, with what it means on hover; the others do not", async ({ page }) => {
    await collapse(page, ["2"]);
    await page.goto(runUrl("v2-r5"));
    const rows = page.locator('[data-page="run"] [data-section="stories"] tr.rp-bar-row');
    await expect(rows.locator(".collapsed-mark")).toHaveCount(1);
    const m = page.locator('[data-page="run"] [data-section="stories"] tr[data-story="2"] .collapsed-mark');
    await expect(m).toHaveText("collapsed");
    await expect(m).toHaveAttribute("data-tip", GLOSSARY.collapsed.what);
    await expect(page.locator('[data-page="run"] [data-section="stories"] tr[data-story="1"] .collapsed-mark')).toHaveCount(0);
  });

  test("a long title is cut short, never the mark (real data: stories 7, 8, 10 of Swift v2-r5 lost it)", async ({ page }) => {
    await patchState(page, (s) => { for (const st of rowOf(s, "v2-r5").stories) { st.collapsed = true; st.title = "A very long story title ".repeat(8); } });
    await page.goto(runUrl("v2-r5"));
    const cell = page.locator('[data-page="run"] [data-section="stories"] tr[data-story="2"] td.rp-bar-label');
    const mark = cell.locator(".collapsed-mark");
    await expect(mark).toHaveText("collapsed");
    const fits = await cell.evaluate((td) => {
      const m = td.querySelector(".collapsed-mark")!.getBoundingClientRect(), c = td.getBoundingClientRect();
      return m.width > 0 && m.right <= c.right + 0.5 && m.left >= c.left;
    });
    expect(fits).toBe(true);
  });

  test("the story run page says it on the story's line", async ({ page }) => {
    await collapse(page, ["2"]);
    await page.goto(storyRunUrl("v2-r5", "2"));
    await expect(page.locator('[data-page="storyRun"] .collapsed-mark')).toHaveText("collapsed");
    await page.goto(storyRunUrl("v2-r5", "1"));
    await expect(page.locator('[data-page="storyRun"] .collapsed-mark')).toHaveCount(0);
  });

  test("only a fact: no cause, no fault word, no instruction", async ({ page }) => {
    await collapse(page, ["2"]);
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('.collapsed-mark').first()).toHaveAttribute("data-tip", /^(?!.*(error|fault|bug|retry|re-run|fix|because|caused)).*$/is);
  });
});

test.describe("intervened: the mark leads to the story's conversation, filtered to its interventions", () => {
  test("a story's mark, on the run page, the story run page and the story page, goes to that story's conversation", async ({ page }) => {
    await intervened(page);
    await page.goto(`/#/vidi/r/${encodeURIComponent(SWIFT)}/v2-r5`);
    const row = page.locator('[data-page="run"] [data-section="stories"] tr', { has: page.locator(".intervened") });
    await expect(row).toHaveCount(2);
    // Story 2 has a conversation: its interventions are told there. Story 1 has none in the warehouse: its story run page.
    await expect(row.nth(0).locator("a.intervened")).toHaveAttribute("href", /\/s\/1$/);
    await expect(row.nth(1).locator("a.intervened")).toHaveAttribute("href", /\/s\/2\/conversation\?kind=intervention$/);
    await row.nth(1).locator("a.intervened").click();
    await expect(page.locator('[data-page="conversation"]')).toBeVisible();
    await expect(page).toHaveURL(/\/s\/2\/conversation\?kind=intervention$/);
  });

  test("the run's mark goes to the run page's interventions, which it scrolls to; the machine's history marks the same", async ({ page }) => {
    await intervened(page);
    await page.goto(`/#/vidi/r/${encodeURIComponent(SWIFT)}/v2-r5`);
    await expect(page.locator('[data-page="run"] [data-fact="status"] a.intervened')).toHaveAttribute("href", /\/v2-r5\?at=interventions$/);
    await page.goto("/#/m/node-a");
    const fromMachine = page.locator('[data-page="machine"] tr[data-run="v2-r5"] a.intervened');
    await expect(fromMachine).toHaveAttribute("href", /\/v2-r5\?at=interventions$/);
    await fromMachine.click();
    const section = page.locator('[data-page="run"] [data-section="interventions"]');
    await expect(section).toBeInViewport();
  });

  test("an intervention on the run page leads to that story's conversation, filtered to its interventions", async ({ page }) => {
    await intervened(page);
    await page.goto(`${runUrl("v2-r5")}?at=interventions`);
    const rows = page.locator('[data-page="run"] .intervention-list li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("a")).toHaveAttribute("href", /\/s\/1$/);                                  // no conversation
    await expect(rows.nth(1).locator("a")).toHaveCount(0);                                                       // run-wide: nowhere to go
    await expect(rows.nth(2).locator("a")).toHaveAttribute("href", /\/s\/2\/conversation\?kind=intervention$/);
  });

  test("a matrix cell's mark is inside the cell's own link: not a second link", async ({ page }) => {
    await intervened(page);
    await page.goto(`/#/vidi/c/${encodeURIComponent(SWIFT)}`);
    await expect(mCell(page, "v2-r5", "1").locator(".intervened")).not.toHaveAttribute("href", /.*/);
  });
});

test.describe("intervened: marked, and still counted", () => {
  test("run page: a marker by the status, every intervention on hover (repeats once, with how many times), in the page's words", async ({ page }) => {
    await intervened(page);
    await page.goto(runUrl("v2-r5"));
    const m = page.locator('[data-page="run"] [data-fact="status"] .intervened');
    await expect(m).toHaveText("✱ intervened");
    await expect(m).toHaveAttribute("data-intervened", "3");
    await m.hover();
    await expect(tip(page)).toContainText("Interventions (3):");
    await expect(tip(page)).toContainText(`2026-09-30 08:10 UTC · story 1: ${SILENT} (2 times)`);
    await expect(tip(page)).toContainText(`2026-09-30 09:00 UTC · the run: ${OTHER}`);
    await expect(tip(page)).toContainText(`2026-09-30 10:30 UTC · story 2: ${OTHER}`);
    await expect(tip(page)).not.toContainText(/rebooted|killed processes|operator/);
  });

  test("run page: the interventions section lists each, oldest first; the cost table marks the stories touched", async ({ page }) => {
    await intervened(page);
    await page.goto(runUrl("v2-r5"));
    const list = page.locator('[data-page="run"] [data-section="interventions"] li');
    await expect(list).toHaveCount(3);
    expect(await list.evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.story))).toEqual(["1", "run", "2"]);
    await expect(list.first()).toContainText("(2 times)");
    await expect(list.first()).toContainText(SILENT);
    await expect(page.locator('[data-page="run"] [data-section="interventions"]')).not.toContainText(/harness|rebooted|killed/i);
    await expect(page.locator('[data-page="run"] [data-section="stories"] .intervened')).toHaveCount(2);
  });

  test("an intervention the record describes as a harness bug or fix is listed as an intervention and no more", async ({ page }) => {
    const iv: Intervention[] = [
      { at: 1790755800, story: "11", text: "harness bug in the nudge stop rule, fixed and run restarted. The rule 'stop only when a nudge makes zero model calls' never fired" },
      { at: 1790755900, story: "12", text: "harness crashed at the end of the story (git diff output with a PNG byte decoded strictly; fixed in 28f0adb)" },
    ];
    await patchState(page, (s) => { rowOf(s, "v2-r5").interventions = iv; });
    await page.goto(runUrl("v2-r5"));
    const list = page.locator('[data-page="run"] [data-section="interventions"] li');
    await expect(list.nth(0)).toContainText(`story 11: ${OTHER}`);
    await expect(list.nth(1)).toContainText(`story 12: ${OTHER}`);
    await expect(page.locator("body")).not.toContainText(/harness|bug|fixed|crashed|28f0adb/);
    await page.locator('[data-page="run"] [data-fact="status"] .intervened').hover();
    await expect(tip(page)).not.toContainText(/harness|bug|fix/);
  });

  test("run page of a run with none: no marker, no section", async ({ page }) => {
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] .rp-header')).toBeVisible();
    await expect(page.locator('[data-page="run"] .intervened')).toHaveCount(0);
    await expect(page.locator('[data-section="interventions"]')).toHaveCount(0);
  });

  test("story-run pages: only the interventions in that story; none on a story nobody touched; a run-wide one on none", async ({ page }) => {
    await intervened(page);
    await page.goto(storyRunUrl("v2-r5", "1"));
    const m = page.locator('[data-page="storyRun"] .of-run .intervened');
    await expect(m).toHaveAttribute("data-intervened", "1");          // two guard firings on one silent call
    await m.hover();
    await expect(tip(page)).toContainText("Interventions (1):");
    await expect(tip(page)).not.toContainText("the run:");
    await page.goto(storyRunUrl("v2-r5", "2"));
    await expect(page.locator('[data-page="storyRun"] .of-run .intervened')).toHaveAttribute("data-intervened", "1");
    await page.goto(storyRunUrl("v2-r4", "1"));
    await expect(page.locator('[data-page="storyRun"] .rp-header')).toBeVisible();
    await expect(page.locator('[data-page="storyRun"] .intervened')).toHaveCount(0);
  });

  test("combination matrix: a mark in each affected cell and on the run; none elsewhere", async ({ page }) => {
    await intervened(page);
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(mCell(page, "v2-r5", "1").locator(".intervened")).toHaveAttribute("data-intervened", "1");
    await expect(mCell(page, "v2-r5", "2").locator(".intervened")).toHaveAttribute("data-intervened", "1");
    await expect(mRow(page, "v2-r5").locator("th .intervened")).toHaveAttribute("data-intervened", "3");
    await expect(matrix(page).locator(".intervened")).toHaveCount(3);
    await mCell(page, "v2-r5", "1").locator(".intervened").hover();
    await expect(tip(page)).toContainText(`story 1: ${SILENT}`);
  });

  test("machine page: a mark on the history row of a run with interventions; none on the others", async ({ page }) => {
    await intervened(page);
    await page.goto("/#/m/node-a");
    const h = page.locator('[data-page="machine"] [data-section="history"]');
    await expect(h.locator('tr[data-run="v2-r5"] .intervened')).toHaveAttribute("data-intervened", "3");
    await expect(h.locator(".intervened")).toHaveCount(1);
  });

  test("story page: a mark on the affected story run's entry", async ({ page }) => {
    await intervened(page);
    await page.goto("/#/vidi/s/2");
    await expect(page.locator(`[data-page="story"] tbody[data-stack="${SWIFT}"] tr.sp-entry[data-run="v2-r5"] .intervened`)).toHaveAttribute("data-intervened", "1");
  });

  test("a run with interventions stays in every figure: ranking, KPIs, median, flags; and is marked", async ({ page }) => {
    const iv: Intervention[] = [{ at: Date.parse("2026-09-30T06:00:00Z") / 1000, story: "2", text: "node-a froze; restarted by the operator" }];
    await patchState(page, (s) => { rowOf(s, "v2-r5").interventions = iv; });
    await page.goto("/");
    await expect(page.getByRole("table", { name: "Combinations" }).locator(`tr[data-stack="${SWIFT}"] td.score`)).toContainText("63 (58–68) n=3");
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page.locator('[data-kpi="score"] dd')).toHaveText("63 (58–68) n=3 / 75 · mean 63");
    await expect(matrix(page).locator('tfoot td[data-story="2"]')).toHaveText("17m");
    await expect(mCell(page, "v2-r5", "2").locator(".flag")).toHaveCount(1);          // still judged against the median
    await expect(mCell(page, "v2-r5", "2").locator(".intervened")).toHaveAttribute("data-intervened", "1");
    await expect(mRow(page, "v2-r5").locator(".of-record")).toHaveText("63/75");
    await page.goto(runUrl("v2-r5"));
    await expect(page.locator('[data-page="run"] .record-n')).toHaveText("63");
    await expect(page.locator('[data-page="run"] [data-fact="status"] .intervened')).toHaveAttribute("data-intervened", "1");
  });

  test("many interventions: the hover lists at most eight lines, then says how many more", async ({ page }) => {
    const iv: Intervention[] = Array.from({ length: 11 }, (_, i) => ({ at: Date.parse("2026-09-30T06:00:00Z") / 1000 + i * 60, story: String(i + 1), text: `interrupted a tool call silent for ${i + 1}s` }));
    await patchState(page, (s) => { rowOf(s, "v2-r5").interventions = iv; });
    await page.goto(runUrl("v2-r5"));
    await page.locator('[data-page="run"] [data-fact="status"] .intervened').hover();
    await expect(tip(page)).toContainText("a tool call silent for 8 s was interrupted");
    await expect(tip(page)).not.toContainText("silent for 9 s");
    await expect(tip(page)).toContainText("… and 3 more on the run page");
    await expect(page.locator('[data-page="run"] [data-section="interventions"] li')).toHaveCount(11);
  });

  test("keyboard: the marker takes focus and shows its list", async ({ page }) => {
    await intervened(page);
    await page.goto(runUrl("v2-r5"));
    await page.locator('[data-page="run"] [data-fact="status"] .intervened').focus();
    await expect(tip(page)).toContainText("Interventions (3):");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: 900 } });
  for (const [name, url] of [["run page", runUrl("v2-r5")], ["story-run page", storyRunUrl("v2-r5", "1")], ["machine page", "/#/m/node-a"],
    ["combination page", `/#/vidi/c/${enc(SWIFT)}`], ["story page", "/#/vidi/s/2"]] as const) {
    test(`${name}: the marks fit, nothing overflows`, async ({ page }) => {
      await intervened(page);
      await page.goto(url);
      await expect(page.locator("[data-page]")).toBeVisible();
      await expect(page.locator(".intervened").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const w of await page.locator(".matrix-wrap, .sp-table-wrap").all()) expect(await w.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
  }
});
