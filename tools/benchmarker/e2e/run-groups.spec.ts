import { expect, test, type Page } from "@playwright/test";

// Runs are in one order on every page (in progress, queued, finished, did not finish), in sections that fold away.
// The runs that did not finish start folded. One choice for the whole app, remembered in the browser.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;
const matrix = (page: Page) => page.getByRole("table", { name: "Runs × stories" });
const heads = (page: Page) => matrix(page).locator("tr.run-group-head");
const runs = (page: Page) => matrix(page).locator("tbody tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.run));
const heading = (page: Page, name: RegExp) => matrix(page).getByRole("button", { name });

test.beforeEach(async ({ request }) => { await request.post("/api/test/reset"); });

test("the combination page: In progress, Queued, Finished, each with how many, in that order", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  await expect(heads(page)).toHaveText([/In progress\s*1/, /Queued\s*2/, /Finished\s*5/]);
  expect(await runs(page)).toEqual(["v2-r1", "v2-r2", "v2-r3", "v2-r4", "v2-r5", "v2-r6", "v2-r7", "v2-r9"]);
});

test("a section folds away and back, and every heading says whether it is open", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  const finished = heading(page, /^Finished/);
  await expect(finished).toHaveAttribute("aria-expanded", "true");
  await finished.click();
  await expect(finished).toHaveAttribute("aria-expanded", "false");
  expect(await runs(page)).toEqual(["v2-r1", "v2-r2", "v2-r3"]);
  await finished.click();
  expect(await runs(page)).toHaveLength(8);
});

test("the runs that did not finish start folded", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc(QWEN_27B)}`);
  await expect(heads(page)).toHaveText([/Queued\s*1/, /Did not finish\s*1/]);
  await expect(heading(page, /^Did not finish/)).toHaveAttribute("aria-expanded", "false");
  expect(await runs(page)).toEqual(["v2-r1"]);
  await heading(page, /^Did not finish/).click();
  expect(await runs(page)).toEqual(["v2-r1", "v2-r2"]);
});

test("one choice for the whole app: folded here, folded on the machine's history and the story page, and after a reload", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  await heading(page, /^Finished/).click();
  await page.goto("/#/m/node-a");
  const history = page.locator('[data-section="history"]');
  await expect(history.getByRole("button", { name: /^Finished/ }).first()).toHaveAttribute("aria-expanded", "false");
  await expect(history.locator(`[data-stack="${SWIFT}"] tr[data-run="v2-r5"]`)).toHaveCount(0);
  await expect(history.locator(`[data-stack="${SWIFT}"] tr[data-run="v2-r1"]`)).toHaveCount(1);
  await page.goto("/#/vidi/s/1");
  await expect(page.locator('[data-page="story"] tr.run-group-head').first()).toBeVisible();
  await expect(page.locator(`[data-page="story"] tr.sp-entry[data-run="v2-r5"]`)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`[data-page="story"] tr.sp-entry[data-run="v2-r5"]`)).toHaveCount(0);
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  await expect(heading(page, /^Finished/)).toHaveAttribute("aria-expanded", "false");
});

test("the machine's history is in the same sections, running first", async ({ page }) => {
  await page.goto("/#/m/node-a");
  const swift = page.locator(`[data-section="history"] .history-combo[data-stack="${SWIFT}"]`);
  await expect(swift.locator("tr.run-group-head")).toHaveText([/In progress\s*1/, /Queued\s*2/, /Finished\s*\d+/]);
  const order = await swift.locator("tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.status));
  expect(order.indexOf("running")).toBeLessThan(order.indexOf("queued"));
  expect(order.indexOf("queued")).toBeLessThan(order.indexOf("finished"));
});

test("a run page lists the combination's other runs in the same sections; the comparison picker groups them the same way", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
  const related = page.locator('[data-page="run"]');
  await expect(related.locator(".run-group-list h3")).toHaveText([/In progress\s*1/, /Queued\s*2/, /Finished\s*\d+/]);
  const labels = await page.locator("#compare-with optgroup").evaluateAll((gs) => gs.map((g) => (g as HTMLOptGroupElement).label));
  expect(labels).toEqual(["In progress", "Queued", "Finished"]);
});

test("a page with only one kind of run has no headings to fold", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc("qwen/3.8/flash-next/macos/128GB/mlxserve-pi")}`);
  await expect(matrix(page)).toBeVisible();
  await expect(heads(page)).toHaveCount(0);
});
