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
  const now = page.locator('[data-section="now"]');
  await now.locator("a.run-link").first().click();
  await expect(page$(page, "run")).toBeVisible();
  await page.goBack();
  await now.locator("a.machine-link", { hasText: "node-a" }).click();
  await expect(page).toHaveURL(/#\/machines\/node-a$/);
  await expect(page$(page, "machine")).toBeVisible();
});

test("breadcrumbs: a story run sits under its run, which sits under its combination, under the overview", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText("Overview");
  await expect(crumbs.locator('[aria-current="page"]')).toContainText("Story 2");
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
  await page.getByRole("link", { name: "Back to runs" }).click();
  await expect(page.locator("table.combos")).toBeVisible();
});

test("a run in another pack with the same id is a different page", async ({ page }) => {
  await page.goto(`/#/todoodle/r/${enc(SWIFT)}/v2-r5`);
  await expect(page$(page, "notFound")).toBeVisible();
});

test("the tabs are links to their sections' addresses, from any page", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
  await page.getByRole("tab", { name: "Machines" }).click();
  await expect(page).toHaveURL(/#\/machines$/);
  await expect(page$(page, "machines")).toBeVisible();
  await page.getByRole("tab", { name: "Runs" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator("table.combos")).toBeVisible();
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
    await page.locator('[data-section="now"]').locator("a.machine-link", { hasText: "node-a" }).click();
    await expect(page).toHaveURL(/#\/machines\/node-a$/);
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

// Where a time bar leads: into the story run's conversation when the warehouse has it (each part at its own
// section), to the story run's page when it doesn't; a combination page's bar (a whole run) to the run's time.
test.describe("from a time bar", () => {
  const SWIFT_R5 = `/#/vidi/r/${enc(SWIFT)}/v2-r5`;
  test("the run page: a story with a conversation, part by part; one without, to its story run", async ({ page }) => {
    await page.goto(SWIFT_R5);
    const with_ = page.locator('.rp-bar-row[data-story="2"]');
    await expect(with_.locator("a.bar-link")).toHaveAttribute("data-to", "conversation");
    await expect(with_.locator('a.seg-link:has([data-seg="tools"])')).toHaveAttribute("href", new RegExp(`/v2-r5/s/2/conversation\\?kind=tool$`));
    await expect(with_.locator('a.seg-link:has([data-seg="decode"])')).toHaveAttribute("href", /\?kind=call$/);
    await expect(with_.locator('a.seg-link:has([data-seg="compaction"])')).toHaveAttribute("href", /\?kind=compaction$/);
    const without = page.locator('.rp-bar-row[data-story="1"]');
    await expect(without.locator("a.bar-link")).toHaveAttribute("data-to", "storyRun");
    await expect(without.locator("a.seg-link")).toHaveCount(0);
    await with_.locator('a.seg-link:has([data-seg="tools"])').click({ force: true });
    await expect(page$(page, "conversation")).toBeVisible();
    await expect(page$(page, "conversation").locator('.conv-chips [data-kind="tool"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page$(page, "conversation").locator('.conv-chips [data-kind="call"]')).toHaveAttribute("aria-pressed", "false");
  });

  test("the story-run page: the big bar's parts, and the conversation section's own link", async ({ page }) => {
    await page.goto(`${SWIFT_R5}/s/2`);
    await expect(page.locator('.big-bar a.seg-link:has([data-seg="tools"])')).toHaveAttribute("href", /\?kind=tool$/);
    await expect(page.locator('[data-section="conversation"] a.conversation-link')).toHaveAttribute("href", /\/s\/2\/conversation$/);
    await page.goto(`${SWIFT_R5}/s/1`);
    await expect(page.locator(".big-bar a.seg-link")).toHaveCount(0);
    await expect(page.locator('[data-section="conversation"] .conversation-link[data-to="none"] .missing')).toHaveCount(1);
  });

  test("the story page: each run's bar parts lead to that run's conversation when it has one", async ({ page }) => {
    await page.goto("/#/vidi/s/2");
    await expect(page.locator('.sp-time [data-run="v2-r5"] a.seg-link:has([data-seg="tools"])')).toHaveAttribute("href", /v2-r5\/s\/2\/conversation\?kind=tool$/);
    await expect(page.locator('.sp-time [data-run="v2-r4"] a.seg-link')).toHaveCount(0);
  });

  test("the combination page: a run's bar sums its stories, so a part goes to the run page's time", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    await expect(page.locator('.run-time-bars [data-run="v2-r5"] a.seg-link').first()).toHaveAttribute("href", /\/v2-r5\?at=time$/);
  });
});

// The pointer says what a thing does: a hand over anything that goes somewhere or does something, the ? over
// something that only explains itself on hover. A link with a hover is still a link.
test("the cursor: a hand over every link and button, even with a hover; the ? only over a hover that is nothing else", async ({ page }) => {
  await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
  await expect(page$(page, "storyRun")).toBeVisible();
  const cursor = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).cursor);
  expect(await cursor('nav.breadcrumb a.combination-link[data-tip]')).toBe("pointer");
  expect(await cursor('nav.breadcrumb a.run-link[data-tip]')).toBe("pointer");
  expect(await cursor('[data-section="header"] a.machine-link')).toBe("pointer");
  expect(await cursor('[role="tab"]')).toBe("pointer");
  expect(await cursor('.rp-header .stat .term')).toBe("help");
  await page.goto("/#/vidi/s/2");
  await expect(page$(page, "story")).toBeVisible();
  // A link wrapping a term is a link.
  expect(await cursor(".story-nav-head a")).toBe("pointer");
  expect(await cursor(".story-nav-head a .term")).toBe("pointer");
  // No link or button shows the ? on any page kind.
  for (const href of ["/#/", "/#/machines", `/#/vidi/c/${enc(SWIFT)}`, `/#/vidi/r/${enc(SWIFT)}/v2-r5`, "/#/machines/node-a", `/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2/conversation`]) {
    await page.goto(href);
    await expect(page.locator("[data-page], table.combos").first()).toBeVisible();
    const bad = await page.locator("a[href], button, [role=\"button\"]").evaluateAll((els) => els.filter((e) => getComputedStyle(e).cursor === "help").map((e) => e.outerHTML.slice(0, 120)));
    expect(bad, href).toEqual([]);
  }
});
