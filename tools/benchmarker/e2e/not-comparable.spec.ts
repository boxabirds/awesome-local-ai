import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// A story run marked not comparable (metrics.json's "not_comparable", with its reason in plain words): its own page
// says so once, with the reason, and compares it with nothing; every page that compares story runs works without it
// and says nothing about why; its run's own figures stand. The fixture has no such story run, so each test marks
// story 2 of Swift 1.5's v2-r5 (80 minutes against the other runs' 16 to 18) in the state the page gets.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const MARKED_RUN = "v2-r5";
const MARKED_STORY = "2";
const REASON = "This story run also built stories 3 and 4.";
const SAYS_SO = /not compared|also built/i;
const enc = encodeURIComponent;
const runHref = (run: string) => `/#/vidi/r/${enc(SWIFT)}/${enc(run)}`;
const storyRunHref = (run: string, story: string) => `${runHref(run)}/s/${story}`;
const tip = (page: Page) => page.getByRole("tooltip");

/** Serve the page the fixture's state with the story run marked (or, with `mark` false, as it is). */
async function serve(page: Page, mark = true) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    if (mark) s.rows.find((r) => r.stack === SWIFT && r.runId === MARKED_RUN)!.stories.find((st) => st.id === MARKED_STORY)!.notComparable = REASON;
    await route.fulfill({ response: res, json: s });
  });
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test.describe("the story run's own page", () => {
  test("says once that it is not compared, with the reason, where the run's conditions are; and has no comparison", async ({ page }) => {
    await serve(page);
    await page.goto(storyRunHref(MARKED_RUN, MARKED_STORY));
    const header = page.locator('[data-page="storyRun"] [data-section="header"]');
    await expect(header.locator('[data-fact="notCompared"]')).toHaveText(`Not compared with other runs: ${REASON}`);
    await expect(page.getByText(REASON)).toHaveCount(1);
    await header.locator('[data-fact="notCompared"] .term').hover();
    await expect(tip(page)).toHaveText(GLOSSARY.notCompared.what);
    // Its own record is all there; the three comparisons are not.
    await expect(header.locator('[data-fact="agentTime"]')).toHaveText("1h20m");
    for (const id of ["time", "cost", "conversation", "nav"]) await expect(page.locator(`[data-section="${id}"]`)).toBeVisible();
    for (const id of ["against", "differed", "across"]) await expect(page.locator(`[data-section="${id}"]`)).toHaveCount(0);
  });

  test("a story run without the mark says nothing of it, and is compared as ever", async ({ page }) => {
    await serve(page, false);
    await page.goto(storyRunHref(MARKED_RUN, MARKED_STORY));
    await expect(page.locator('[data-section="against"]')).toBeVisible();
    await expect(page.locator('[data-fact="notCompared"]')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(SAYS_SO);
    await expect(page.locator(`[data-section="against"] tr[data-run="v2-r4"]`)).toBeVisible();
  });
});

test.describe("pages that would have compared it: the other runs are compared without it, and nothing is said about why", () => {
  test.beforeEach(async ({ page }) => { await serve(page); });

  test("another run's story-run page: not in the Against table or its median, not offered to set beside, not in the verdicts", async ({ page }) => {
    await page.goto(storyRunHref("v2-r4", MARKED_STORY));
    const against = page.locator('[data-section="against"]');
    await expect(against.locator("tbody tr[data-run]")).toHaveCount(7);                    // eight runs, less the marked one
    await expect(against.locator(`tr[data-run="${MARKED_RUN}"]`)).toHaveCount(0);
    await expect(against.locator("tr.median-row")).toHaveAttribute("data-others", "3");   // v2-r1 (running, story 2 done), v2-r6 and v2-r7
    await expect(page.locator('[data-section="differed"] select option')).toHaveText([/^v2-r1/, /^v2-r6/, /^v2-r7/, /^v2-r9/]);
    await expect(page.locator('[data-section="across"] tr[data-this="true"] .runs-n')).toHaveText("2 other runs");
    await expect(page.locator("body")).not.toContainText(SAYS_SO);
  });

  test("the story's page: not a row of its combination, and the combination's median is over the other finished runs", async ({ page }) => {
    await page.goto(`/#/vidi/s/${MARKED_STORY}`);
    const group = page.locator(`[data-page="story"] tbody[data-stack="${SWIFT}"]`);
    await expect(group.locator("tr.sp-entry").first()).toBeVisible();
    await expect(group.locator(`tr.sp-entry[data-run="${MARKED_RUN}"]`)).toHaveCount(0);
    await expect(group.locator("tr.sp-median th")).toContainText("over 3 finished runs");
    await expect(group.locator('tr.sp-median td[data-measure="minutes"] .n-runs')).toHaveText("n=3");
    await expect(group.locator("tr.sp-not-built")).not.toContainText(MARKED_RUN);
    await expect(page.locator("body")).not.toContainText(SAYS_SO);
  });

  test("the combination page: its cell keeps its figure and its link but is not flagged or in the story's median; the spreads leave the story out", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    const matrix = page.getByRole("table", { name: "Runs × stories" });
    const cell = matrix.locator(`tr[data-run="${MARKED_RUN}"] td.m-cell[data-story="${MARKED_STORY}"]`);
    await expect(cell).toContainText("80m");
    await expect(cell.locator("a")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/${MARKED_RUN}/s/${MARKED_STORY}`);
    await expect(cell.locator(".flag")).toHaveCount(0);
    await expect(matrix.locator(`tfoot tr.m-median td[data-story="${MARKED_STORY}"]`)).toHaveAttribute("data-tip", "Story 2: median 17m over 3 finished runs");
    // Predictability: story 2 is left out, so the time spread is story 1's alone (690, 660, 1,500 and 700 s: 40%), and no
    // story is left with thinking in every run (v2-r7's story 1 has no profile).
    const pred = (id: string) => page.locator(`[data-group="predictability"] [data-pred="${id}"] dd`);
    await expect(pred("timeSpread")).toHaveText("40%");
    await expect(pred("minutesPerStory")).toHaveText("12");
    await expect(pred("thinkingSpread").locator(".missing")).toHaveAttribute("data-tip", GLOSSARY.spreadNotRecorded.what);
    await expect(pred("spreadRuns")).toHaveText("4");
    await expect(page.locator("body")).not.toContainText(SAYS_SO);
  });

  test("the run page: its totals and its story list stand; beside another run, that story has both figures and no difference", async ({ page }) => {
    await page.goto(`${runHref(MARKED_RUN)}?compare=v2-r4`);
    const compare = page.locator('[data-page="run"] [data-section="compare"]');
    const marked = compare.locator(`tr[data-story="${MARKED_STORY}"]`);
    await expect(marked.locator('td[data-measure="minutes"] .pair-a')).toHaveText("1h20m");
    await expect(marked.locator('td[data-measure="minutes"] .pair-b')).toHaveText("16 min");
    await expect(marked.locator(".diff")).toHaveCount(0);
    await expect(compare.locator('tr[data-story="1"] td[data-measure="minutes"] .diff')).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText(SAYS_SO);
  });
});

test("the run page of the marked run is the same with and without the mark, outside the comparison", async ({ page }) => {
  const textOf = async (mark: boolean) => {
    await page.unrouteAll();
    await serve(page, mark);
    await page.goto(`${runHref(MARKED_RUN)}?compare=none`);
    await expect(page.locator('[data-page="run"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-page="run"] [data-section="header"]')).toBeVisible();
    return page.locator('[data-page="run"]').innerText();
  };
  expect(await textOf(true)).toBe(await textOf(false));
});
