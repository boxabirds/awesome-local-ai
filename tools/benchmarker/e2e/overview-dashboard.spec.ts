import { expect, test, type Page } from "@playwright/test";

// The overview as a dashboard: observations (facts about the work), a card per machine, the series of runs, the score of
// record as a picture, then the Combinations table. Bugs of the app, the harness or the pipeline are never shown; these
// are the data's own observations.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const FAULT_WORDS = /needs you|action required|retry|retried|re-score|rescore|accounting|harness|dbench|traceback|error|crash|stack trace|run `/i;

const overview = (page: Page) => page.locator('[data-page="overview"]');

test.beforeEach(async ({ request, page }) => {
  await request.post("/api/test/reset");
  await page.goto("/");
  await expect(overview(page)).toBeVisible();
});

test.describe("observations", () => {
  test("a fact about the work, with a link: the idle machine with nothing queued", async ({ page }) => {
    const obs = overview(page).locator('[data-section="observations"]');
    await expect(obs.locator("h2")).toHaveText("Observations");
    const idle = obs.locator('li[data-kind="idle"] a');
    await expect(idle).toHaveText("node-d: idle, nothing queued");
    await expect(idle).toHaveAttribute("href", "#/machines/node-d");
  });

  test("only facts: no fault wording, no cause, no instruction", async ({ page }) => {
    await expect(overview(page).locator('[data-section="observations"]')).not.toContainText(FAULT_WORDS);
  });

  test("the observations are in the page's one reading order: first, above the machines", async ({ page }) => {
    const order = await overview(page).evaluate((el) => [...el.children].map((c) => (c as HTMLElement).dataset.section ?? c.className));
    expect(order.slice(0, 2)).toEqual(["observations", "now"]);
  });
});

test.describe("a card per machine", () => {
  const card = (page: Page, machine: string) => overview(page).locator(`.machine-card[data-machine="${machine}"]`);

  test("every machine has one, with its state word", async ({ page }) => {
    await expect(overview(page).locator(".machine-card")).toHaveCount(4);
    await expect(card(page, "node-a").locator(".card-state")).toHaveText("running");
    await expect(card(page, "node-d").locator(".card-state")).toHaveText("idle");
  });

  test("a running machine: the held-out strip of its run, where the run is in its series, and its queue", async ({ page }) => {
    const a = card(page, "node-a");
    await expect(a.locator(".card-strip .rs-sq")).toHaveCount(11);
    await expect(a.locator(".card-strip .rs-sq").first()).toHaveAttribute("data-state", "result");
    await expect(a.locator(".card-series .small")).toHaveText(/^run 1 of \d+$/);
    await expect(a.locator(".card-series .seg-run")).not.toHaveCount(0);
    await expect(a.locator(".card-queue .queue-count")).toHaveText("3 queued");
  });

  test("the queue's length is measured from finished runs of its stacks, with the basis on hover; or says no estimate yet", async ({ page }) => {
    const text = await card(page, "node-a").locator(".card-drain").innerText();
    expect(text).toMatch(/about \d+ h of work|no estimate yet/);
    await expect(card(page, "node-a").locator(".card-drain")).toHaveAttribute("data-tip", /median .* over \d+ finished runs|No finished run/);
  });

  test("an idle machine has no strip and no series bar", async ({ page }) => {
    await expect(card(page, "node-d").locator(".card-strip, .card-series")).toHaveCount(0);
  });

  test("the cards ignore the runs switch: what the machines are doing is not a result to filter", async ({ page }) => {
    await page.getByRole("group", { name: "Which runs" }).getByRole("button", { name: "Complete runs" }).click();
    await expect(overview(page).locator(".machine-card")).toHaveCount(4);
    await expect(overview(page).locator('[data-section="observations"] li[data-kind="idle"]')).toHaveCount(1);
  });
});

test.describe("series", () => {
  test("a row per series: its runs as segments, finished ones with their score, and how many are done", async ({ page }) => {
    const row = overview(page).locator(`.series-row[data-stack="${SWIFT}"][data-prefix="v2"]`);
    await expect(row).toBeVisible();
    const states = await row.locator(".seg-run").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.state));
    expect(states).toContain("running");
    expect(states).toContain("finished");
    expect(states).toContain("queued");
    await expect(row.locator(".seg-finished").first()).toHaveText(/^\d+$/);
    await expect(row.locator(".series-count")).toHaveText(/^\d+\/\d+$/);
    await expect(row.locator(".seg-run").first()).toHaveAttribute("href", /#\/vidi\/r\//);
  });

  test("the scores are colour-coded from red (0) to green (the total), in the segments and in the series' own score column", async ({ page }) => {
    const row = overview(page).locator(`.series-row[data-stack="${SWIFT}"][data-prefix="v2"]`);
    await expect(row.locator(".series-score")).toHaveText(/^\d+(\.\d)?\/75$/);
    const finished = row.locator(".seg-finished");
    const colours = await finished.evaluateAll((els) => els.map((e) => [Number(e.textContent), getComputedStyle(e).color]));
    const highest = colours.reduce((a, b) => (b[0] > a[0] ? b : a)), lowest = colours.reduce((a, b) => (b[0] < a[0] ? b : a));
    expect(highest[0]).toBeGreaterThan(lowest[0]);
    expect(highest[1]).not.toBe(lowest[1]);
    const g = (c: string) => Number(c.match(/\d+/g)![1]), r = (c: string) => Number(c.match(/\d+/g)![0]);
    expect(g(highest[1]) - r(highest[1])).toBeGreaterThan(g(lowest[1]) - r(lowest[1]));   // the higher score is greener, the lower redder
  });

  test("a series with nothing scored yet has a dash for its score", async ({ page }) => {
    await expect(overview(page).locator(".series-row .series-score", { hasText: "—" }).first()).toBeVisible();
  });

  test("a series with work in hand comes first; a segment says what it is on hover and to a screen reader", async ({ page }) => {
    await expect(overview(page).locator(".series-row").first()).toHaveAttribute("data-active", "true");
    const seg = overview(page).locator(".seg-running").first();
    await expect(seg).toHaveAttribute("aria-label", /: running, \d+ of \d+ stories/);
  });

  test("not hidden by the runs switch: a queue is not a result", async ({ page }) => {
    await page.getByRole("group", { name: "Which runs" }).getByRole("button", { name: "Complete runs" }).click();
    await expect(overview(page).locator(".series-row").first()).toBeVisible();
    await expect(overview(page).locator(".seg-queued").first()).toBeVisible();
  });
});

test.describe("the score, drawn", () => {
  test("one row per ranked combination, a dot for each run, the median and the range, with a text equivalent", async ({ page }) => {
    const plot = overview(page).locator('[data-section="scores"] svg');
    await expect(plot).toHaveAttribute("role", "img");
    await expect(plot).toHaveAttribute("aria-label", /Score by combination\. .*middle \d+ of 75/);
    const rows = plot.locator("g[data-stack]");
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    const first = rows.first();
    await expect(first.locator(".plot-median")).toHaveCount(1);
    expect(await first.locator(".plot-dot").count()).toBeGreaterThanOrEqual(1);
    await expect(first.locator(".plot-runs")).toHaveText(/^\d+ runs?$/);
    await expect(first.locator(".plot-score")).toHaveText(/^\d+(\.\d)?\/75$/);
  });

  test("it is explained in plain words above the picture: how to read it, the top, the best local, what can't be separated", async ({ page }) => {
    const words = overview(page).locator('[data-section="scores"] [data-narrative]');
    await expect(words).toContainText("Each dot is one finished run");
    await expect(words).toContainText("Further right is better.");
    await expect(words).toContainText("Highest:");
    await expect(words).toContainText(/Best of the local stacks:|are within 12 tests of each other/);
    await expect(overview(page).locator('[data-section="scores"] h2')).toHaveText(/^Score\s*out of 75 hidden tests$/);
  });

  test("each row says in a sentence what its marks are, on hover; a bracket says what can't be told apart", async ({ page }) => {
    await expect(overview(page).locator('[data-section="scores"] g[data-stack]').first()).toHaveAttribute("data-tip", /runs? scored .* out of 75\. The middle run scored .*; the lowest \d+, the highest \d+\./);
    const bracket = overview(page).locator('[data-section="scores"] .plot-close');
    if (await bracket.count()) await expect(bracket.first()).toHaveAttribute("data-tip", /^These can't be told apart yet: /);
  });

  test("a key names every mark; the scale says where it starts when it isn't 0", async ({ page }) => {
    const key = overview(page).locator('[data-section="scores"] .plot-key');
    await expect(key).toContainText("one run");
    await expect(key).toContainText("the middle run");
    await expect(key).toContainText("lowest to highest");
  });

  test("one bracket per group of neighbours, not one per pair", async ({ page }) => {
    const plot = overview(page).locator('[data-section="scores"]');
    const groups = await plot.locator(".plot-close").evaluateAll((els) => els.map((e) => (e as SVGElement).dataset.group!.split("|").length));
    for (const n of groups) expect(n).toBeGreaterThanOrEqual(2);
  });

  test("a combination's label links to its page", async ({ page }) => {
    const link = overview(page).locator('[data-section="scores"] g[data-stack] a').first();
    await expect(link).toHaveAttribute("href", /#\/vidi\/c\//);
  });

  test("the table with every figure is still there below the picture", async ({ page }) => {
    await expect(page.getByRole("table", { name: "Combinations" })).toBeVisible();
  });
});
