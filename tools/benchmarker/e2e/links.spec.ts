import { expect, test, type Page } from "@playwright/test";

// Cross-referencing: every mention of an entity goes to its page, every page says where it sits, and the way
// back is always there. MECE by where the link starts: overview tables, machine rows, time bars, story tables,
// breadcrumbs, and addresses typed or shared by hand.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;
const page$ = (page: Page, name: string) => page.locator(`[data-page="${name}"]`);

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/test/reset");
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
});

test("from the combinations table: a combination's name opens its page", async ({ page }) => {
  await page.locator(`table.combos tr[data-stack="${SWIFT}"] a.combination-link`).click();
  await expect(page).toHaveURL(new RegExp(`#/vidi/c/${enc(SWIFT)}$`));
  await expect(page$(page, "combination")).toBeVisible();
});

test("from the overview's Now: the running run and its machine open their pages", async ({ page }) => {
  const now = page.getByRole("table", { name: "Now" });
  await now.locator("a.run-link").first().click();
  await expect(page$(page, "run")).toBeVisible();
  await page.goBack();
  await now.locator("a.machine-link", { hasText: "node-a" }).click();
  await expect(page).toHaveURL(/#\/m\/node-a$/);
  await expect(page$(page, "machine")).toBeVisible();
});

test("breadcrumbs: a story run sits under its run, which sits under its combination, under the overview", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText("Overview");
  await expect(crumbs.locator('[aria-current="page"]')).toContainText("story 2");
  await crumbs.locator("a.run-link").click();
  await expect(page$(page, "run")).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).locator("a.combination-link").click();
  await expect(page$(page, "combination")).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Overview" }).click();
  await expect(page.locator("table.combos")).toBeVisible();
});

test("addresses by hand: a page opens directly; one that names nothing says so and links back", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
  await expect(page$(page, "run")).toBeVisible();
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/no-such-run`);
  await expect(page$(page, "notFound")).toContainText("no-such-run");
  await page.goto("/#/vidi/nonsense");
  await expect(page$(page, "notFound")).toBeVisible();
  await page.getByRole("link", { name: "Back to the overview" }).click();
  await expect(page.locator("table.combos")).toBeVisible();
});

test("a run in another pack with the same id is a different page", async ({ page }) => {
  await page.goto(`/#/todoodle/r/${enc(SWIFT)}/v2-r5`);
  await expect(page$(page, "notFound")).toBeVisible();
});

test("the tabs always go back to the overview", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
  await page.getByRole("tab", { name: "Machines" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page$(page, "machines")).toBeVisible();
});

// Runs are only compared with runs of the same pack version family: a v1 run was built against another spec
// and scored by another suite, so its stories aren't the same stories.
test.describe("comparisons stay within one version family", () => {
  test("a combination's page under v2 has no v1 run in its matrix, medians or bars", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page$(page, "combination")).toBeVisible();
    await expect(page$(page, "combination")).toContainText("v2-r5");
    await expect(page$(page, "combination")).not.toContainText("canvas-s-01");
  });

  test("a v2 story run is compared with v2 runs only", async ({ page }) => {
    await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
    await expect(page$(page, "storyRun")).toContainText("v2-r4");
    await expect(page$(page, "storyRun")).not.toContainText("canvas-s-01");
  });

  test("a v1 run's page offers only v1 runs to compare with, and says there are none", async ({ page }) => {
    await page.goto(`/#/vidi/r/${enc(SWIFT)}/canvas-s-01`);
    await expect(page$(page, "run")).toBeVisible();
    await expect(page$(page, "run")).not.toContainText("v2-r5");
  });

  test("with all versions selected, the combination page shows its newest family", async ({ page }) => {
    await page.getByLabel("Version").selectOption("all");
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page$(page, "combination")).toContainText("v2-r5");
    await expect(page$(page, "combination")).not.toContainText("canvas-s-01");
  });
});

test.describe("machine and story addresses", () => {
  test("every machine name links to its page, from the overview and from a run", async ({ page }) => {
    await page.getByRole("table", { name: "Now" }).locator("a.machine-link", { hasText: "node-a" }).click();
    await expect(page).toHaveURL(/#\/m\/node-a$/);
    await expect(page$(page, "machine")).toBeVisible();
    await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
    await page.locator('[data-fact="machine"] a.machine-link').click();
    await expect(page$(page, "machine")).toContainText("node-a");
  });

  test("a story page opens by address, and a story or machine that doesn't exist says so", async ({ page }) => {
    await page.goto("/#/vidi/s/2");
    await expect(page$(page, "story")).toBeVisible();
    await page.goto("/#/m/no-such-machine");
    await expect(page$(page, "notFound")).toContainText("no-such-machine");
    await page.goto("/#/nopack/s/2");
    await expect(page$(page, "notFound")).toBeVisible();
  });
});
