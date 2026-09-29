import { expect, test, type Page } from "@playwright/test";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";

const row = (page: Page, stack: string, run: string) => page.locator(`section[data-stack="${stack}"] tr[data-run="${run}"]`);
const cell = (page: Page, stack: string, run: string, n: number) => row(page, stack, run).locator("td").nth(n);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
});

test("the machines panel says what each node is doing, and idle ones say so", async ({ page }) => {
  const m = page.getByRole("region", { name: "Machines" });
  await expect(m.locator("[data-node='gruntus']")).toContainText("running 3.8-swift-1.5/27b llamacpp v2-r1 · story 3");
  await expect(m.locator("[data-node='gruntus']")).toContainText("3 queued");
  await expect(m.locator("[data-node='tritus']")).toContainText("idle");
  await page.setViewportSize({ width: 1000, height: 400 });
  await m.locator("[data-node='gruntus'] a").click();
  await expect(row(page, SWIFT, "v2-r1")).toBeInViewport();
});

test("a running run shows its story, live numbers and latest action", async ({ page }) => {
  const build = cell(page, SWIFT, "v2-r1", 2);
  await expect(build).toContainText("running: story 3");
  await expect(build).toContainText("4 agent-min · 41 calls · 12k out · tasks 1/2");
  await expect(build).toContainText("write: src/shared/protocol.ts");
  await expect(cell(page, SWIFT, "v2-r1", 1)).toHaveText("gruntus");
});

test("stories: recorded, reported by dbench before git, and the running one", async ({ page }) => {
  const strip = cell(page, SWIFT, "v2-r1", 3);
  await expect(strip.locator("[data-story='1']")).toHaveClass(/c-ok/);
  await expect(strip.locator("[data-story='2']")).toHaveClass(/c-part/); // 9/10 own tests, from dbench
  await expect(strip.locator("[data-story='3']")).toHaveClass(/c-run/);
  const held = cell(page, SWIFT, "v2-r1", 4);
  await expect(held).toContainText("6/6 whole suite after story 1");
  await expect(held).toContainText("story 2: 9/10 own tests");
});

test("queued runs say their place on the node and what is ahead, in dbench's order", async ({ page }) => {
  await expect(cell(page, SWIFT, "v2-r2", 2)).toContainText("queued: 2nd on gruntus");
  await expect(cell(page, SWIFT, "v2-r2", 2)).toContainText("after 3.8-swift-1.5/27b v2-r1 (running)");
  await expect(cell(page, SWIFT, "v2-r3", 2)).toContainText("queued: 3rd on gruntus");
  await expect(cell(page, QWEN_27B, "v2-r1", 2)).toContainText("queued: 4th on gruntus");
  await expect(cell(page, QWEN_27B, "v2-r1", 2)).toContainText("and 1 more");
  for (const n of [3, 4, 5, 6, 7]) await expect(cell(page, SWIFT, "v2-r2", n)).toHaveText("—");
});

test("a story that has only just started says so instead of showing zeros", async ({ page }) => {
  const build = cell(page, "qwen/3.8/flash-next/macos/128GB/mlxserve-pi", "v2-r1", 2);
  await expect(build).toContainText(/started (just now|\d+ min ago); first numbers within a minute/);
  await expect(build).not.toContainText("0 calls");
});

test("a finished, scored run with its bundle can be judged, and links to its record", async ({ page }) => {
  await expect(cell(page, "reference/opus-5.5", "run-9", 5)).toContainText("vidi-v2.0-pre1 74/75");
  await expect(cell(page, "reference/opus-5.5", "run-9", 6).getByRole("link", { name: "Judge →" })).toBeVisible();
  const record = cell(page, "reference/opus-5.5", "run-9", 7).getByRole("link", { name: "record" });
  await expect(record).toHaveAttribute("href", "https://github.com/boxabirds/awesome-local-ai/tree/main/benchmarks/reference/vidi/opus-5.5/run-9");
});

test("the version filter opens on the current version and can show all", async ({ page }) => {
  await expect(page.getByLabel("Version")).toHaveValue("vidi-v2");
  await expect(page.locator("section[data-stack*='gufo-pi']")).toHaveCount(0);
  await page.getByLabel("Version").selectOption("all");
  await expect(row(page, "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "canvas-gufo-r3")).toBeVisible();
});

test("all eight columns fit at 1000 px", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const fits = await page.locator("section").evaluateAll((ss) => ss.every((s) => s.scrollWidth <= s.clientWidth + 1));
  expect(fits).toBe(true);
  // node names stay on one line (a wrapped "gruntu / s" was the bug): count the text's line boxes
  const lines = await page.locator("td.node").evaluateAll((tds) =>
    tds.map((td) => {
      const range = document.createRange();
      range.selectNodeContents(td);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    }));
  expect(Math.max(...lines)).toBe(1);
});

test("when refreshes fail, the page greys out under a warning", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
  await page.route("**/api/state", (r) => r.abort());
  await page.clock.fastForward(25_000);
  await expect(page.getByRole("alert")).toContainText(/Stale: the last successful update was \d+ s ago/);
});

test("a page reloads itself when the server serves a newer build", async ({ page }) => {
  let reloads = 0;
  page.on("load", () => reloads++);
  await page.route("**/api/state", async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    await r.fulfill({ response: res, json: { ...body, buildId: reloads < 2 ? "a-newer-build" : body.buildId } });
  });
  await page.reload();
  await expect.poll(() => reloads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
});
