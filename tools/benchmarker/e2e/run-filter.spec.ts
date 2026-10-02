import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";

// The header's one switch, "All runs | Complete runs": on every page and tab, remembered, applied to every page's
// runs, and never to what the machines are doing now. The fixture's finished runs record two of the suite's eleven
// stories, so none is complete as it stands; `complete()` narrows their scope to what they recorded, which makes
// the scored ones complete: Swift v2-r4, v2-r5, v2-r6 and Opus run-9.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const MLX = "qwen/3.8/flash-next/macos/128GB/mlxserve-pi";
const OPUS = "reference/opus-5.5";
const COMPLETE_RUNS = 4;
const enc = encodeURIComponent;
const combinationHref = (stack: string) => `/#/vidi/c/${enc(stack)}`;
const runHref = (stack: string, run: string) => `/#/vidi/r/${enc(stack)}/${enc(run)}`;

const filter = (page: Page) => page.getByRole("group", { name: "Which runs" });
const all = (page: Page) => filter(page).getByRole("button", { name: /^All runs/ });
const complete = (page: Page) => filter(page).getByRole("button", { name: /^Complete runs/ });
const combos = (page: Page) => page.getByRole("table", { name: "Combinations" });
const hiddenLine = (page: Page) => page.locator("[data-filtered-out]");
const HIDDEN_TEXT = "This content is not visible under current filter settings. Show all";

/** Finished runs' scope narrowed to the stories they recorded, for this test only. */
async function completeRuns(page: Page) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    for (const r of s.rows) {
      if (r.status !== "finished" || r.knownGood) continue;
      const recorded = new Set(r.stories.map((st) => st.id));
      const squares = r.storiesWorking.squares.filter((q) => recorded.has(q.id));
      r.storiesWorking = { ...r.storiesWorking, scope: squares.length, squares };
    }
    await route.fulfill({ response: res, json: s });
  });
}

async function open(page: Page, href = "/") {
  await page.goto(href);
  await expect(filter(page)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test("the switch is on every page and tab, two plain labels with no counts; All runs at first", async ({ page }) => {
  await completeRuns(page);
  await open(page);
  await expect(filter(page).getByRole("button")).toHaveText(["All runs", "Complete runs"]);
  await expect(all(page)).toHaveAttribute("aria-pressed", "true");
  await expect(complete(page)).toHaveAttribute("aria-pressed", "false");
  for (const tab of ["Machines", "Setup", "Stories"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(filter(page).getByRole("button")).toHaveCount(2);
  }
  for (const href of [combinationHref(SWIFT), runHref(SWIFT, "v2-r5"), `${runHref(SWIFT, "v2-r5")}/s/1`, "/#/m/node-a"]) {
    await page.goto(href);
    await expect(filter(page).getByRole("button")).toHaveCount(2);
  }
});

test("the old status chips are gone, from the header and from the machine page; an old ?hide= link still opens", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("group", { name: "Status" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "only running" })).toHaveCount(0);
  await page.goto("/#/m/node-a?hide=finished");
  await expect(page.locator('[data-page="machine"] [data-section="history"]')).toBeVisible();
  await expect(page.getByRole("group", { name: "Status" })).toHaveCount(0);
  await expect(page.locator('[data-section="history"] tr[data-run="v2-r5"]')).toHaveCount(1);  // the parameter is ignored
});

test("Complete runs narrows the Combinations table, holds on the next page, and survives a reload", async ({ page }) => {
  await completeRuns(page);
  await open(page);
  await expect(combos(page).locator(`tr[data-stack="${QWEN_27B}"]`)).toBeVisible();  // queued and cancelled runs only
  await complete(page).click();
  await expect(combos(page).locator("tbody tr")).toHaveCount(2);
  await expect(combos(page).locator(`tr[data-stack="${SWIFT}"]`)).toBeVisible();
  await expect(combos(page).locator(`tr[data-stack="${OPUS}"]`)).toBeVisible();
  await expect(combos(page).locator(`tr[data-stack="${SWIFT}"] td.not-counted`)).toHaveText("none");
  await expect(page.locator(".combinations h2")).toContainText(`${COMPLETE_RUNS} of the ${COMPLETE_RUNS} runs shown`);

  await combos(page).locator(`tr[data-stack="${SWIFT}"] a.combination-link`).click();
  const matrix = page.locator('[data-page="combination"] [data-section="matrix"]');
  await expect(matrix.locator("tr[data-run]")).toHaveCount(3);
  await expect(matrix.locator('tr[data-run="v2-r1"]')).toHaveCount(0);   // the running run
  await expect(matrix.locator('tr[data-run="v2-r9"]')).toHaveCount(0);   // the partial rerun
  await expect(page.locator("[data-counts]")).toContainText("3 finished (3 scored)");
  await expect(page.locator("[data-counts]")).not.toContainText(/running|queued|pending|partial rerun/);

  await page.reload();
  await expect(complete(page)).toHaveAttribute("aria-pressed", "true");
  await expect(matrix.locator("tr[data-run]")).toHaveCount(3);
  await all(page).click();
  await expect(matrix.locator('tr[data-run="v2-r1"]')).toHaveCount(1);
});

test("a link to a run that isn't complete: the one italic line, and Show all brings the run back for good", async ({ page }) => {
  await completeRuns(page);
  await open(page);
  await complete(page).click();
  await page.goto(runHref(SWIFT, "v2-r1"));
  await expect(page.locator('[data-page="run"]')).toHaveCount(0);
  await expect(hiddenLine(page)).toHaveText(HIDDEN_TEXT);
  await expect(hiddenLine(page).locator("em")).toBeVisible();
  await hiddenLine(page).getByRole("button", { name: "Show all" }).click();
  await expect(page.locator('[data-page="run"]')).toBeVisible();
  await expect(all(page)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator('[data-page="run"]')).toBeVisible();
});

test("the same line for a story run of such a run, a partial rerun, and a combination with no complete run", async ({ page }) => {
  await completeRuns(page);
  await open(page);
  await complete(page).click();
  for (const href of [`${runHref(SWIFT, "v2-r1")}/s/1`, runHref(SWIFT, "v2-r9"), combinationHref(MLX), combinationHref(QWEN_27B)]) {
    await page.goto(href);
    await expect(hiddenLine(page)).toHaveText(HIDDEN_TEXT);
  }
  await page.goto(runHref(SWIFT, "v2-r5"));
  await expect(page.locator('[data-page="run"]')).toBeVisible();
  await expect(hiddenLine(page)).toHaveCount(0);
});

test("a run page under Complete runs compares with complete runs only", async ({ page }) => {
  await completeRuns(page);
  await open(page, runHref(SWIFT, "v2-r5"));
  const run = page.locator('[data-page="run"]');
  await expect(run.locator('a[href$="/v2-r1"]').first()).toBeAttached();    // the running run is among the others
  await complete(page).click();
  await expect(run.locator('a[href$="/v2-r1"]')).toHaveCount(0);
  await expect(run.locator('a[href$="/v2-r4"]').first()).toBeAttached();
});

test("the story page under Complete runs lists complete runs only", async ({ page }) => {
  await completeRuns(page);
  await open(page, "/#/vidi/s/1");
  const story = page.locator('[data-page="story"]');
  await expect(story.locator(`a[href*="${enc(MLX)}"]`).first()).toBeAttached();
  await complete(page).click();
  await expect(story.locator(`a[href*="${enc(MLX)}"]`)).toHaveCount(0);
  await expect(story.locator('tr[data-run="v2-r1"]')).toHaveCount(0);
  await expect(story.locator('tr[data-run="v2-r5"]')).toHaveCount(1);
});

test("what machines are doing now is never filtered: the Machines tab and the machine page keep the running job", async ({ page }) => {
  await completeRuns(page);
  await open(page);
  await complete(page).click();
  await expect(page.locator('[data-section="now"] tr[data-machine="node-a"]')).toHaveAttribute("data-state", "running");
  await page.getByRole("tab", { name: "Machines" }).click();
  await expect(page.locator('[data-page="machines"]')).toContainText("v2-r1");

  await page.goto("/#/m/node-a");
  const mp = page.locator('[data-page="machine"]');
  await expect(mp.locator('[data-section="now"] [data-job="vidi-v2b-swift15-r1"]')).toBeVisible();
  const history = mp.locator('[data-section="history"]');
  await expect(history.locator("tr[data-run]")).toHaveCount(3);
  await expect(history.locator(".mp-head")).toContainText("3 runs");
  await expect(history.locator('tr[data-status]:not([data-status="finished"])')).toHaveCount(0);
});

test("a machine whose runs are all hidden says so in its history, and keeps its Now; one with no runs says that", async ({ page }) => {
  await completeRuns(page);
  await open(page);
  await complete(page).click();
  await page.goto("/#/m/node-c");
  const mp = page.locator('[data-page="machine"]');
  await expect(mp.locator('[data-section="now"]')).toBeVisible();
  await expect(mp.locator('[data-section="history"]').locator("[data-filtered-out]")).toHaveText(HIDDEN_TEXT);
  await page.goto("/#/m/node-d");
  await expect(page.locator('[data-page="machine"] [data-section="history"]')).toContainText("No runs on this machine yet.");
  await expect(hiddenLine(page)).toHaveCount(0);
});

test("with no complete run at all, the overview says so in place of the table, and Show all restores it", async ({ page }) => {
  await open(page);  // the fixture as it is: no run covers its scope
  await complete(page).click();
  await expect(combos(page)).toHaveCount(0);
  await expect(page.locator('[data-section="now"]')).toBeVisible();
  await expect(page.locator('[data-section="combinations"]').locator("[data-filtered-out]")).toHaveText(HIDDEN_TEXT);
  await hiddenLine(page).getByRole("button", { name: "Show all" }).click();
  await expect(combos(page)).toBeVisible();
});

test("the switch works from the keyboard", async ({ page }) => {
  await open(page);
  await complete(page).focus();
  await page.keyboard.press("Enter");
  await expect(complete(page)).toHaveAttribute("aria-pressed", "true");
});
