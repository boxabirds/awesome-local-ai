import { expect, test, type Page } from "@playwright/test";

// Navigation across the site (specs/general/UI-IMPROVEMENTS.md, Part 1). MECE by what the reader does: pick a
// section with a tab; read the trail; go Back; keep a page's own choices across Back and sharing. Every screen a
// reader can stand on has an address, so every crumb, tab and Back has one fixed target.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;
const COMBINATION = `#/vidi/c/${enc(SWIFT)}`;
const RUN = `${COMBINATION.replace("/c/", "/r/")}/v2-r5`;
const STORY_RUN = `${RUN}/s/2`;
const CONVERSATION = `${STORY_RUN}/conversation`;
const page$ = (page: Page, name: string) => page.locator(`[data-page="${name}"]`);
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const crumbs = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });
/** The trail as text: each crumb, with its target when it is a link. */
const trail = (page: Page) => crumbs(page).evaluate((nav) =>
  [...nav.querySelectorAll("a, [aria-current]")].map((e) => (e instanceof HTMLAnchorElement ? `${e.textContent}(${e.getAttribute("href")})` : e.textContent)));
const selectedTab = (page: Page) => page.locator('[role="tab"][aria-selected="true"]');
const scrollTo = async (page: Page, y: number) => {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
};
/** Within a line of where it was: the browser rounds. */
const NEAR = 4;
/** A click as a person makes it, on something already in view: Playwright's own click first scrolls the target into
 * view, which on a pinned header moves the page, and the position to come back to is the one before the click. */
const clickInPlace = (l: ReturnType<Page["locator"]>) => l.dispatchEvent("click");

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test.describe("A. the sections have addresses, and the tabs are links to them", () => {
  test("each tab opens its address: #/ is runs, machines, setup, and the pack's stories index", async ({ page }) => {
    await page.goto("/");
    await expect(tab(page, "Runs")).toHaveAttribute("href", "#/");
    await expect(tab(page, "Machines")).toHaveAttribute("href", "#/machines");
    await expect(tab(page, "Setup")).toHaveAttribute("href", "#/setup");
    await expect(tab(page, "Stories")).toHaveAttribute("href", "#/vidi/stories");
    await tab(page, "Machines").click();
    await expect(page).toHaveURL(/#\/machines$/);
    await expect(page$(page, "machines")).toBeVisible();
    await tab(page, "Stories").click();
    await expect(page).toHaveURL(/#\/vidi\/stories$/);
    await expect(page$(page, "stories")).toBeVisible();
    await tab(page, "Setup").click();
    await expect(page).toHaveURL(/#\/setup$/);
    await expect(page$(page, "setup")).toBeVisible();
    await tab(page, "Runs").click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator("table.combos")).toBeVisible();
  });

  test("#/ is runs whatever was open last: after Machines, Overview and Back both show runs", async ({ page }) => {
    await page.goto("/#/machines");
    await expect(page$(page, "machines")).toBeVisible();
    await page.goto("/#/");
    await expect(page.locator("table.combos")).toBeVisible();
    await expect(page$(page, "machines")).toHaveCount(0);
    await page.goto(`/${RUN}`);
    await crumbs(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.locator("table.combos")).toBeVisible();
  });

  test("the stories index lists the pack's stories, each a link to its page; its crumb is Overview › Stories", async ({ page }) => {
    await page.goto("/#/vidi/stories");
    const index = page$(page, "stories");
    await expect(index.locator("a.story-link")).toHaveCount(11);
    await expect(index.locator('a.story-link[href="#/vidi/s/2"]')).toContainText("Sticky notes");
    expect(await trail(page)).toEqual(["Overview(#/)", "Stories"]);
    await index.locator('a.story-link[href="#/vidi/s/2"]').click();
    await expect(page$(page, "story")).toBeVisible();
  });

  test("the selected tab is the page's section, on every page kind", async ({ page }) => {
    const cases: [string, string][] = [
      ["/#/", "Runs"], [`/${COMBINATION}`, "Runs"], [`/${RUN}`, "Runs"], [`/${STORY_RUN}`, "Runs"], [`/${CONVERSATION}`, "Runs"], [`/${CONVERSATION}/c/1`, "Runs"],
      ["/#/vidi/stories", "Stories"], ["/#/vidi/s/2", "Stories"], ["/#/machines", "Machines"], ["/#/machines/node-a", "Machines"], ["/#/setup", "Setup"],
    ];
    for (const [href, name] of cases) {
      await page.goto(href);
      await expect(selectedTab(page), href).toHaveText(name);
    }
    await page.goto("/#/vidi/nonsense");
    await expect(page$(page, "notFound")).toBeVisible();
    await expect(selectedTab(page)).toHaveCount(0);
  });

  test("a machine's old address still opens its page, under Machines; removing a machine leaves for the list", async ({ page }) => {
    await page.goto("/#/m/node-d");
    await expect(page$(page, "machine")).toContainText("node-d");
    expect(await trail(page)).toEqual(["Overview(#/)", "Machines(#/machines)", "node-d"]);
    await page.goto("/#/machines");
    await expect(page.locator('[data-page="machines"] a.machine-link').first()).toHaveAttribute("href", /^#\/machines\//);
  });
});

test.describe("B. the trail has one shape per page kind, and every level in it is a place", () => {
  test("runs: Overview › combination › run › Story N › Conversation › Call N", async ({ page }) => {
    await page.goto(`/${CONVERSATION}/c/1`);
    expect(await trail(page)).toEqual([
      "Overview(#/)", `3.8-swift-1.5/27b llamacpp(${COMBINATION})`, `v2-r5(${RUN})`, `Story 2(${STORY_RUN})`, `Conversation(${CONVERSATION})`, "Call 2",
    ]);
    await crumbs(page).getByRole("link", { name: "Story 2" }).click();
    await expect(page$(page, "storyRun")).toBeVisible();
    expect(await trail(page)).toEqual(["Overview(#/)", `3.8-swift-1.5/27b llamacpp(${COMBINATION})`, `v2-r5(${RUN})`, "Story 2"]);
  });

  test("stories: Overview › Stories › Story N; machines: Overview › Machines › name; setup and the indexes end at their section", async ({ page }) => {
    await page.goto("/#/vidi/s/2");
    expect(await trail(page)).toEqual(["Overview(#/)", "Stories(#/vidi/stories)", "Story 2"]);
    await crumbs(page).getByRole("link", { name: "Stories" }).click();
    await expect(page$(page, "stories")).toBeVisible();
    await page.goto("/#/machines/node-a");
    expect(await trail(page)).toEqual(["Overview(#/)", "Machines(#/machines)", "node-a"]);
    await crumbs(page).getByRole("link", { name: "Machines" }).click();
    await expect(page$(page, "machines")).toBeVisible();
    expect(await trail(page)).toEqual(["Overview(#/)", "Machines"]);
    await page.goto("/#/setup");
    expect(await trail(page)).toEqual(["Overview(#/)", "Setup"]);
  });

  test("the window's title is the trail, nearest first", async ({ page }) => {
    await page.goto(`/${RUN}`);
    await expect(page).toHaveTitle("v2-r5 · 3.8-swift-1.5/27b llamacpp · Benchmarker");
    await page.goto("/#/");
    await expect(page).toHaveTitle("Benchmarker");
    await page.goto("/#/machines/node-a");
    await expect(page).toHaveTitle("node-a · Machines · Benchmarker");
  });
});

test.describe("C. Back returns to where the reader was", () => {
  test.use({ viewport: { width: 1200, height: 500 } });

  test("a followed link starts at the top; Back restores the scroll position, on a page that loads its data after render too", async ({ page }) => {
    await page.goto(`/${CONVERSATION}`);
    await expect(page$(page, "conversation")).toHaveAttribute("data-backfilled", "true");
    const link = page.locator('table.turns tr[data-kind="call"] a.call-link').last();
    await link.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    expect(y).toBeGreaterThan(0);
    await clickInPlace(link);
    await expect(page$(page, "call")).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.goBack();
    await expect(page$(page, "conversation")).toHaveAttribute("data-backfilled", "true");
    await expect.poll(() => page.evaluate((v) => Math.abs(scrollY - v), y)).toBeLessThanOrEqual(NEAR);
    await page.goForward();
    await expect(page$(page, "call")).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

  test("Back from a tab returns to the page it was pressed on, at its scroll position", async ({ page }) => {
    await page.goto(`/${RUN}`);
    await expect(page$(page, "run")).toBeVisible();
    const Y = 400;
    await scrollTo(page, Y);
    await clickInPlace(tab(page, "Machines"));
    await expect(page$(page, "machines")).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.goBack();
    await expect(page$(page, "run")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Math.abs(scrollY - 400))).toBeLessThanOrEqual(NEAR);
  });
});

test.describe("D. the conversation page's choices are in its address", () => {
  const chip = (page: Page, kind: string) => page.locator(`.conv-chips [data-kind="${kind}"]`);

  test("chips, the search and the span are written to the address, replaced not pushed, and read back from it", async ({ page }) => {
    await page.goto("/");
    await page.goto(`/${CONVERSATION}`);
    await expect(page$(page, "conversation")).toHaveAttribute("data-backfilled", "true");
    await chip(page, "call").click();
    await expect(page).toHaveURL(/\?kind=tool%2Ccompaction%2Cwait%2Cmsg%2Crequest%2Ccondition$|\?kind=tool,compaction,wait,msg,request,condition$/);
    await page.getByRole("searchbox", { name: "Search the conversation" }).fill("harness");
    await expect(page).toHaveURL(/q=harness/);
    // Replaced, not pushed: Back leaves the page.
    await page.goBack();
    await expect(page).toHaveURL(/\/$|#\/$/);
    await page.goto(`/${CONVERSATION}?kind=tool&q=write&span=0-20000`);
    await expect(page$(page, "conversation")).toHaveAttribute("data-backfilled", "true");
    await expect(chip(page, "tool")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "call")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("searchbox", { name: "Search the conversation" })).toHaveValue("write");
    await expect(page.locator('[data-fact="range-filter"]')).toContainText("0.0 s to 20.0 s");
    await page.locator('[data-fact="range-filter"]').click();
    await expect(page).not.toHaveURL(/span=/);
  });

  test("Back from a call finds the narrowing still made; the call page's own way back lands on the call's row", async ({ page }) => {
    await page.goto(`/${CONVERSATION}?kind=call&q=harness`);
    await expect(page$(page, "conversation")).toHaveAttribute("data-backfilled", "true");
    await page.locator('table.turns tr[data-kind="call"] a.call-link').first().click();
    await expect(page$(page, "call")).toBeVisible();
    await page.goBack();
    await expect(chip(page, "call")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "tool")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("searchbox", { name: "Search the conversation" })).toHaveValue("harness");
    await page.goto(`/${CONVERSATION}/c/3`);
    const back = page.locator(".call-nav a.back");
    await expect(back).toHaveAttribute("href", `${CONVERSATION}?call=3`);
    await back.click();
    await expect(page.locator('table.turns tr[data-call="3"]')).toHaveAttribute("data-jumped", "true");
    await expect(page.locator('table.turns tr[data-call="3"]')).toBeInViewport();
  });
});
