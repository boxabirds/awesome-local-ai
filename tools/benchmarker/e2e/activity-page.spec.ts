import { expect, test, type Page } from "@playwright/test";
import { GLOSSARY } from "../shared/glossary.ts";

// The activity report: what two combinations' thinking was spent on, by class, over the stories both ran. The fixture
// gives Swift 1.5 two runs of story 1 (so a median is taken), gufo one, a shared story 2, and a story only Swift ran.
const page$ = (page: Page) => page.locator('[data-page="activity"]');
const row = (page: Page, cls: number | string) => page$(page).locator(`tr[data-class="${cls}"]`);

test.beforeEach(async ({ request }) => { await request.post("/api/test/reset"); });

test("the tab leads to it, and the breadcrumb names it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page$(page)).toBeVisible();
  await expect(page.locator("nav.breadcrumb")).toContainText("Activity");
});

test("two combinations side by side: the classes, their characters, the ratio and each one's share", async ({ page }) => {
  await page.goto("/#/activity");
  // Swift 1.5 story 1 over two runs: weighing 1000 and 2000 -> median 1500; story 2: 800. Gufo: 500 and 1600.
  await expect(row(page, 0).locator("td").nth(1)).toHaveText("2,300");
  await expect(row(page, 0).locator("td").nth(3)).toHaveText("2,100");
  await expect(row(page, 0).locator(".act-ratio")).toHaveAttribute("data-ratio", (2100 / 2300).toFixed(2));
  // Classes are ordered by what the two spend between them, largest first.
  const names = (await page$(page).locator("tbody tr[data-class] th").allInnerTexts()).map((t) => t.toLowerCase());
  expect(names[0]).toContain("weighing and correcting");
  expect(names.at(-1)).toContain("all thinking");
});

test("only the stories both ran are counted: a story one of them alone ran cannot tilt it", async ({ page }) => {
  await page.goto("/#/activity");
  await expect(page$(page).locator('[data-fact="basis"]')).toContainText("2 stories both ran (1, 2)");
  // Swift's story 9 holds 99,999 of each class; the totals must not show it.
  await expect(row(page, "total").locator("td").nth(1)).not.toContainText("99,999");
});

test("the choice of combinations is in the address, so a link opens the same comparison", async ({ page }) => {
  await page.goto("/#/activity");
  await page.locator("#act-b").selectOption({ index: 0 });            // both sides the same combination
  const chosen = await page.locator("#act-b").inputValue();
  await expect(page).toHaveURL(/[?&]b=/);
  const after = await row(page, "total").locator("td").nth(1).innerText();
  await page.reload();
  await expect(page.locator("#act-b")).toHaveValue(chosen);
  expect(await row(page, "total").locator("td").nth(1).innerText()).toBe(after);
  // Against itself every story is shared, so the ratio is exactly one.
  await expect(row(page, "total").locator(".act-ratio")).toHaveText("1.00×");
});

test("it explains itself and judges nothing: no quality word anywhere", async ({ page }) => {
  await page.goto("/#/activity");
  await expect(page$(page).locator(".act-note")).toHaveText(GLOSSARY.thinkingActivity.what);
  await expect(page$(page)).not.toContainText(/waste|wasted|redundant|inefficient|too much|should/i);
});
