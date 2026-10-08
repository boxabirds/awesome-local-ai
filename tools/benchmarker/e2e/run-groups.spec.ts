import { expect, test, type Page } from "@playwright/test";

// Runs are in one order on every page that compares them (in progress, queued, finished, did not finish), in
// sections that fold away. The runs that did not finish start folded. The choice is per page kind (the combination
// pages, the story pages, the run pages), remembered in the browser: folding Finished on one combination's page
// folds it on every combination's page, and nowhere else. A machine's history is a log and has no sections.

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

test("per page kind: folded on one combination's page, folded on another's and after a reload; open on the story page", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  await heading(page, /^Finished/).click();
  await page.goto(`/#/vidi/c/${enc(QWEN_27B)}`);
  await expect(matrix(page)).toBeVisible();
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  await expect(heading(page, /^Finished/)).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(heading(page, /^Finished/)).toHaveAttribute("aria-expanded", "false");
  await page.goto("/#/vidi/s/1");
  await expect(page.locator('[data-page="story"] tr.run-group-head').first()).toBeVisible();
  await expect(page.locator(`[data-page="story"] tr.sp-entry[data-run="v2-r5"]`)).toHaveCount(1);
  // And the other way: folding on the story page leaves the run pages as they were.
  await page.locator('[data-page="story"]').getByRole("button", { name: /^Finished/ }).first().click();
  await expect(page.locator(`[data-page="story"] tr.sp-entry[data-run="v2-r5"]`)).toHaveCount(0);
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r1`);
  await expect(page.locator('[data-page="run"] .run-group-list h3').getByRole("button", { name: /^Finished/ })).toHaveAttribute("aria-expanded", "true");
});

test("the machine's history has no sections: every run on one table, the running one first, the queue last", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
  await heading(page, /^Finished/).click();
  await page.goto("/#/machines/node-a");
  const history = page.locator('[data-section="history"]');
  await expect(history.locator("tr.run-group-head, .run-group-button")).toHaveCount(0);
  await expect(history.locator(`tr[data-stack="${SWIFT}"][data-run="v2-r5"]`)).toHaveCount(1);
  const order = await history.locator("tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.status));
  expect(order[0]).toBe("running");
  expect(order.lastIndexOf("finished")).toBeLessThan(order.indexOf("queued"));
});

test("a run page lists the combination's other runs in the same sections; the comparison picker groups them the same way", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
  const related = page.locator('[data-page="run"]');
  await expect(related.locator(".run-group-list h3")).toHaveText([/In progress\s*1/, /Queued\s*2/, /Finished\s*\d+/]);
  // The picker offers this combination's runs in the same order, so the sections are runs of one kind together.
  await page.locator('[data-section="compare"]').getByRole("combobox", { name: "Add a run" }).focus();
  const statuses = await page.locator(`[data-section="compare"] [role="option"][data-stack="${SWIFT}"]`).evaluateAll((os) => os.map((o) => o.getAttribute("data-status")));
  expect(statuses.length).toBeGreaterThan(0);            // only runs with a story recorded can be compared, so in-progress and queued ones with none are not offered
  expect(statuses.join(",")).toBe([...statuses].sort((a, b) => ["running", "queued", "finished"].indexOf(a!) - ["running", "queued", "finished"].indexOf(b!)).join(","));
});

test("a page with only one kind of run has no headings to fold", async ({ page }) => {
  await page.goto(`/#/vidi/c/${enc("qwen/3.8/flash-next/macos/128GB/mlxserve-pi")}`);
  await expect(matrix(page)).toBeVisible();
  await expect(heads(page)).toHaveCount(0);
});
