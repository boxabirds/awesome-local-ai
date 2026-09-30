import { expect, test, type Page } from "@playwright/test";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";

const row = (page: Page, stack: string, run: string) => page.locator(`tr[data-stack="${stack}"][data-run="${run}"]`);
const machine = (page: Page, name: string) => page.locator(`section[data-machine="${name}"]`);
const cell = (page: Page, stack: string, run: string, n: number) => row(page, stack, run).locator("td").nth(n);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
});

test("each machine has one section, headed by what it runs now, with its queue in dbench's order", async ({ page }) => {
  await expect(machine(page, "gruntus")).toHaveCount(1);
  await expect(machine(page, "gruntus").locator("h2")).toContainText("running 3.8-swift-1.5/27b llamacpp v2-r1 · story 3");
  await expect(machine(page, "gruntus").locator("h2")).toContainText("3 queued");
  const runs = await machine(page, "gruntus").locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => `${(tr as HTMLElement).dataset.stack!.includes("swift-1.5") ? "swift" : "27b"} ${(tr as HTMLElement).dataset.run}`));
  expect(runs).toEqual(["swift v2-r1", "swift v2-r2", "swift v2-r3", "27b v2-r1"]);
  await expect(machine(page, "tritus").locator("h2")).toContainText("idle");
});

test("a running run: status, story of the scope with its title, time, and activity each in its own column", async ({ page }) => {
  await expect(cell(page, SWIFT, "v2-r1", 0)).toContainText("3.8-swift-1.5/27b llamacpp");
  await expect(cell(page, SWIFT, "v2-r1", 1)).toHaveText("running");
  await expect(cell(page, SWIFT, "v2-r1", 2)).toContainText("story 3 of 11");
  await expect(cell(page, SWIFT, "v2-r1", 2)).toContainText("See other people's edits live");
  await expect(cell(page, SWIFT, "v2-r1", 3)).toContainText("4 min on this story");
  await expect(cell(page, SWIFT, "v2-r1", 3)).toContainText(/run \d/);
  await expect(cell(page, SWIFT, "v2-r1", 4)).toContainText("41 calls · 12k out · tasks 1/2");
  await expect(cell(page, SWIFT, "v2-r1", 4)).toContainText("write: src/shared/protocol.ts");
});

test("stories working: one square per story in scope, against the latest build, and how many work", async ({ page }) => {
  await expect(page.getByRole("columnheader", { name: "Stories working" }).first()).toBeVisible();
  const sw = cell(page, SWIFT, "v2-r1", 5);
  await expect(sw.locator("[data-story]")).toHaveCount(11);
  await expect(sw.locator("[data-story='1']")).toHaveAttribute("data-state", "ok");
  await expect(sw.locator("[data-story='2']")).toHaveAttribute("data-state", "part"); // 9/10, reported by dbench before git
  await expect(sw.locator("[data-story='3']")).toHaveAttribute("data-state", "running");
  await expect(sw.locator("[data-story='4']")).toHaveAttribute("data-state", "unbuilt");
  await expect(sw).toContainText("1 of 11 working");
  await expect(sw.locator("[data-story='2']")).toHaveAttribute("title", /9\/10 hidden flows/);
});

test("queued runs say queued and their place on the node, in dbench's order, and nothing else", async ({ page }) => {
  await expect(cell(page, SWIFT, "v2-r2", 1)).toHaveText("queued2nd on gruntus");
  await expect(cell(page, SWIFT, "v2-r3", 1)).toContainText("3rd on gruntus");
  await expect(cell(page, QWEN_27B, "v2-r1", 1)).toContainText("4th on gruntus");
  for (const n of [2, 3, 4, 5, 6, 7, 8]) await expect(cell(page, SWIFT, "v2-r2", n)).toHaveText("—");
});

test("a story that has only just started says so instead of showing zeros", async ({ page }) => {
  const activity = cell(page, "qwen/3.8/flash-next/macos/128GB/mlxserve-pi", "v2-r1", 4);
  await expect(activity).toContainText("first numbers within a minute");
  await expect(activity).not.toContainText("0 calls");
});

test("a Claude run, whose calls and tokens are only counted at the end of a story, shows no false zeros", async ({ page }) => {
  const activity = cell(page, "reference/opus-5.5", "v2-r1", 4);
  await expect(activity).toContainText("tasks 1/2");
  await expect(activity).not.toContainText("0 calls");
  await expect(activity).not.toContainText("0k out");
});

test("a finished, scored run with its bundle can be judged, and links to its record", async ({ page }) => {
  await expect(cell(page, "reference/opus-5.5", "run-9", 1)).toContainText("finished");
  await expect(cell(page, "reference/opus-5.5", "run-9", 6)).toContainText("vidi-v2.0-pre1 74/75");
  await expect(cell(page, "reference/opus-5.5", "run-9", 7).getByRole("link", { name: "Judge →" })).toBeVisible();
  const record = cell(page, "reference/opus-5.5", "run-9", 8).getByRole("link", { name: "record" });
  await expect(record).toHaveAttribute("href", "https://github.com/boxabirds/awesome-local-ai/tree/main/benchmarks/reference/vidi/opus-5.5/run-9");
});

test("the status filter: counts per status, cancelled hidden at first, one click to see only running", async ({ page }) => {
  const filter = page.getByRole("group", { name: "Status" });
  await expect(filter.getByRole("button", { name: /^running 3$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(filter.getByRole("button", { name: /^cancelled 1$/ })).toHaveAttribute("aria-pressed", "false");
  await expect(row(page, QWEN_27B, "v2-r2")).toHaveCount(0);

  await filter.getByRole("button", { name: /^cancelled/ }).click();
  await expect(cell(page, QWEN_27B, "v2-r2", 1)).toHaveText("cancelled");

  await filter.getByRole("button", { name: "only running" }).click();
  const statuses = await page.locator("tbody tr td:nth-child(2) .status-word").allInnerTexts();
  expect(new Set(statuses)).toEqual(new Set(["running"]));
  await page.reload(); // the choice is remembered
  await expect(filter.getByRole("button", { name: /^queued/ })).toHaveAttribute("aria-pressed", "false");
  await filter.getByRole("button", { name: "all" }).click();
  await expect(row(page, SWIFT, "v2-r2")).toBeVisible();
});

test("the version filter opens on the current version and can show all", async ({ page }) => {
  await expect(page.getByLabel("Version")).toHaveValue("vidi-v2");
  await expect(page.locator("tr[data-stack*='gufo-pi']")).toHaveCount(0);
  await page.getByLabel("Version").selectOption("all");
  await expect(row(page, "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "canvas-gufo-r3")).toBeVisible();
});

test("all nine columns fit at 1000 px", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const fits = await page.locator("section").evaluateAll((ss) => ss.every((s) => s.scrollWidth <= s.clientWidth + 1));
  expect(fits).toBe(true);
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

test("a new build reloads the page only once that build can be loaded, never onto an error page", async ({ page }) => {
  let loads = 0;
  page.on("load", () => loads++);
  let serverDown = true; // the server is restarting: the page and its script can't be fetched yet
  await page.route("**/api/state", async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    await r.fulfill({ response: res, json: { ...body, buildId: loads < 2 ? "a-newer-build" : body.buildId } });
  });
  await page.route((url) => url.pathname === "/" || url.pathname.startsWith("/assets/"), (r) =>
    serverDown && r.request().resourceType() === "fetch" ? r.abort("connectionrefused") : r.continue());
  await page.reload();
  await expect(page.locator("section").first()).toBeVisible();
  await page.waitForTimeout(12_000); // two polls see the newer build while it can't be fetched
  expect(loads).toBe(1);
  await expect(page.locator("section").first()).toBeVisible();
  serverDown = false;
  await expect.poll(() => loads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator("section").first()).toBeVisible();
});

test("a tab left in the background is not called stale, and is current as soon as it is shown", async ({ page }) => {
  const setHidden = (hidden: boolean) => page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
  await setHidden(true);
  await page.clock.fastForward(90_000);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const refetched = page.waitForRequest("**/api/state");
  await setHidden(false);
  await page.clock.fastForward(1_000);
  await refetched; // shown: it fetches at once rather than waiting for the next poll
  await expect(page.getByRole("alert")).toHaveCount(0);
});
