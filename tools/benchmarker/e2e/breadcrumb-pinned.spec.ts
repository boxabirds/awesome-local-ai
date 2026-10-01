import { expect, test, type Locator, type Page } from "@playwright/test";

// The breadcrumb (Overview › combination › run › story) stays in view while its page scrolls: pinned right under the
// app's top bar, which is pinned too. MECE by what pinning can get wrong: it scrolls away; it sits under or over the
// top bar; its links can't be clicked; the page shows through it; it hides what the keyboard or an anchor brings into
// view; other pinned things slide under it; it makes the page scroll sideways.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;
const STORY_RUN = `/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`;
const NARROW = 1000, WIDE = 1440;
/** Short enough that every page is longer than the window. */
const SHORT = 500;
/** Sub-pixel layout: two edges that touch may differ by this much. */
const PIXEL = 1;

const crumbs = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });
/** The app's top bar (Benchmarker, pack, version, tabs): the page's banner, not a header inside a page. */
const topBar = (page: Page) => page.getByRole("banner");
const box = async (l: Locator) => (await l.boundingBox())!;
const toBottom = async (page: Page) => {
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
};
/** A colour's alpha, as the browser computed it: "rgb(…)" is opaque, "rgba(…, a)" says its own. */
const alphaOf = (colour: string) => (colour.startsWith("rgba") ? Number(colour.slice(colour.lastIndexOf(",") + 1, -1)) : colour === "transparent" ? 0 : 1);

async function open(page: Page, hash: string, name: string) {
  await page.goto(hash);
  await expect(page.locator(`[data-page="${name}"]`)).toBeVisible();
}

/** The breadcrumb sits right under the top bar, which is at the very top; neither covers the other. */
async function expectPinned(page: Page) {
  const bar = await box(topBar(page)), c = await box(crumbs(page));
  expect(Math.abs(bar.y)).toBeLessThanOrEqual(PIXEL);
  expect(Math.abs(c.y - (bar.y + bar.height))).toBeLessThanOrEqual(PIXEL);
  // Nothing of the page lies over either: what is drawn at the middle of each is its own.
  const own = (sel: string, b: { x: number; y: number; width: number; height: number }) =>
    page.evaluate(([s, x, y]) => !!document.elementFromPoint(x as number, y as number)?.closest(s as string), [sel, b.x + b.width / 2, b.y + b.height / 2]);
  expect(await own("nav.breadcrumb", c)).toBe(true);
  expect(await own("body header:not(main header)", bar)).toBe(true);
}

test.use({ viewport: { width: WIDE, height: SHORT } });

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test("scrolled to the bottom of a long page, the breadcrumb is still in view, under the top bar", async ({ page }) => {
  await open(page, STORY_RUN, "storyRun");
  await toBottom(page);
  await expect(crumbs(page)).toBeInViewport({ ratio: 1 });
  await expect(topBar(page)).toBeInViewport({ ratio: 1 });
  await expectPinned(page);
});

test("its links still work there: nothing lies over them", async ({ page }) => {
  await open(page, STORY_RUN, "storyRun");
  await toBottom(page);
  const link = crumbs(page).locator("a.run-link");
  const hit = await link.evaluate((a) => {
    const r = a.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("a") === a;
  });
  expect(hit).toBe(true);
  await link.click();
  await expect(page.locator('[data-page="run"] .run-id')).toHaveText("v2-r5");
});

for (const [name, hash] of [
  ["run", `/#/vidi/r/${enc(SWIFT)}/v2-r5`], ["combination", `/#/vidi/c/${enc(SWIFT)}`], ["story", "/#/vidi/s/2"], ["machine", "/#/m/node-a"],
] as const) {
  test(`pinned on the ${name} page too`, async ({ page }) => {
    await open(page, hash, name);
    await toBottom(page);
    await expect(crumbs(page)).toBeInViewport({ ratio: 1 });
    await expectPinned(page);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme}: its background is opaque, the page's own, and the page doesn't show through`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, STORY_RUN, "storyRun");
    await toBottom(page);
    const bg = await crumbs(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(alphaOf(bg)).toBe(1);
    expect(bg).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    // Anywhere in its strip, left gutter to right, the topmost thing is the breadcrumb, not the content under it.
    const c = await box(crumbs(page));
    const y = c.y + c.height / 2;
    for (const x of [c.x + c.width - PIXEL, c.x + c.width / 2]) {
      expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest("nav.breadcrumb"), [x, y])).toBe(true);
    }
  });
}

test("a line under it only once the page has scrolled beneath it", async ({ page }) => {
  await open(page, STORY_RUN, "storyRun");
  await expect(crumbs(page)).not.toHaveAttribute("data-stuck", "true");
  await toBottom(page);
  await expect(crumbs(page)).toHaveAttribute("data-stuck", "true");
  await page.evaluate(() => scrollTo(0, 0));
  await expect(crumbs(page)).not.toHaveAttribute("data-stuck", "true");
});

test("keyboard focus on something above doesn't land under it", async ({ page }) => {
  await open(page, STORY_RUN, "storyRun");
  await toBottom(page);
  const target = page.locator('[data-section="header"] a').first();
  await target.focus();
  await expect(target).toBeInViewport({ ratio: 1 });
  const c = await box(crumbs(page)), t = await box(target);
  expect(t.y).toBeGreaterThanOrEqual(c.y + c.height);
});

test("jumping to a section doesn't put its heading under it", async ({ page }) => {
  await open(page, STORY_RUN, "storyRun");
  await toBottom(page);
  const heading = page.locator("#h-cost");
  await heading.evaluate((el) => el.scrollIntoView());
  await expect(heading).toBeInViewport({ ratio: 1 });
  const c = await box(crumbs(page)), h = await box(heading), bar = await box(topBar(page));
  expect(h.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(h.y).toBeGreaterThanOrEqual(c.y + c.height);
});

test("the story page's own pinned list stays below it, not under it", async ({ page }) => {
  await open(page, "/#/vidi/s/2", "story");
  await toBottom(page);
  const c = await box(crumbs(page)), list = await box(page.locator(".story-nav"));
  expect(list.y).toBeGreaterThanOrEqual(c.y + c.height);
});

test("a tooltip on a breadcrumb link shows over the page", async ({ page }) => {
  await open(page, STORY_RUN, "storyRun");
  await toBottom(page);
  await crumbs(page).locator("a.combination-link").hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText(SWIFT);
  const z = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).zIndex));
  expect(await z(tip)).toBeGreaterThan(await z(crumbs(page)));
  expect(await z(tip)).toBeGreaterThan(await z(topBar(page)));
});

test.describe("at 1000 px", () => {
  test.use({ viewport: { width: NARROW, height: SHORT } });
  test("pinned, the trail within the page's width, no sideways scroll", async ({ page }) => {
    await open(page, STORY_RUN, "storyRun");
    await toBottom(page);
    await expectPinned(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(NARROW);
    const c = await box(crumbs(page));
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(NARROW);
  });
});

test.describe("a trail too long for one line", () => {
  const TIGHT = 420;
  test.use({ viewport: { width: TIGHT, height: SHORT } });
  test("wraps inside the window instead of running off it, and what follows still clears it", async ({ page }) => {
    await open(page, STORY_RUN, "storyRun");
    const last = crumbs(page).locator('[aria-current="page"]');
    const c = await box(crumbs(page)), l = await box(last);
    expect(l.x + l.width).toBeLessThanOrEqual(TIGHT);
    expect(c.x + c.width).toBeLessThanOrEqual(TIGHT);
    await toBottom(page);
    await expectPinned(page);
    const heading = page.locator("#h-cost");
    await heading.evaluate((el) => el.scrollIntoView());
    const stuck = await box(crumbs(page));
    expect((await box(heading)).y).toBeGreaterThanOrEqual(stuck.y + stuck.height);
  });
});
