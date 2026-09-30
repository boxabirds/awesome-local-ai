import { expect, test, type Page } from "@playwright/test";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const GUFO = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";

const row = (page: Page, stack: string, run: string) => page.locator(`tr:not(.detail)[data-stack="${stack}"][data-run="${run}"]`);
const machine = (page: Page, name: string) => page.locator(`section[data-machine="${name}"]`);
const cell = (page: Page, stack: string, run: string, n: number) => row(page, stack, run).locator("td").nth(n);

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/test/reset");  // the fake dbench starts from the fixture in every test
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
});

test("the status filter: counts per status, cancelled hidden at first, one click to see only running; it narrows the combinations", async ({ page }) => {
  const filter = page.getByRole("group", { name: "Status" });
  const combos = page.getByRole("table", { name: "Combinations" });
  await expect(filter.getByRole("button", { name: /^running 3$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(filter.getByRole("button", { name: /^cancelled 1$/ })).toHaveAttribute("aria-pressed", "false");
  await expect(combos.locator(`tr[data-stack="${QWEN_27B}"]`)).toBeVisible();
  await filter.getByRole("button", { name: "only running" }).click();
  await expect(combos.locator(`tr[data-stack="${QWEN_27B}"]`)).toHaveCount(0);   // 27B has only queued and cancelled runs
  await expect(combos.locator(`tr[data-stack="${SWIFT}"]`)).toBeVisible();
  await page.reload(); // the choice is remembered
  await expect(filter.getByRole("button", { name: /^queued/ })).toHaveAttribute("aria-pressed", "false");
  await filter.getByRole("button", { name: "all" }).click();
  await expect(combos.locator(`tr[data-stack="${QWEN_27B}"]`)).toBeVisible();
});

test("the version filter opens on the current version and can show all", async ({ page }) => {
  await expect(page.getByLabel("Version")).toHaveValue("vidi-v2");
  const gufo = page.getByRole("table", { name: "Combinations" }).locator("tr[data-stack*='gufo-pi']");
  await expect(gufo).toHaveCount(0);
  await page.getByLabel("Version").selectOption("all");
  await expect(gufo).toBeVisible();
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

test("every column heading of the combinations explains itself on hover", async ({ page }) => {
  const titles = await page.getByRole("table", { name: "Combinations" }).locator("thead th").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-tip") ?? ""));
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.filter((t) => t.length < 20)).toEqual([]);
});

test("combinations: one row each across machines, over the runs shown, sortable, every heading explained", async ({ page }) => {
  const table = page.getByRole("table", { name: "Combinations" });
  const swift = table.locator(`tr[data-stack="${SWIFT}"]`);
  await expect(swift).toContainText("3.8-swift-1.5/27b llamacpp");
  await expect(swift).toContainText("node-a");
  await expect(swift).toContainText("1 running");
  await expect(swift).toContainText("2 queued");
  await expect(page.locator("section.combinations")).toContainText(/ranked on finished runs' scores of record under vidi-v2\.0-pre1: \d+ of the \d+ runs? shown/);
  for (const t of await table.locator("thead th").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-tip") ?? ""))) expect(t.length).toBeGreaterThan(20);
  // Sorting: a click sorts by the column, a second click reverses it; runs without a number stay last.
  const calls = async () => (await table.locator("tbody td.calls .median").allInnerTexts()).map(Number);   // "—" has no median
  await table.getByRole("columnheader", { name: /Calls per story/ }).click();
  const first = await calls();
  expect(first.length).toBeGreaterThan(1);
  await table.getByRole("columnheader", { name: /Calls per story/ }).click();
  expect(await calls()).toEqual([...first].reverse());
  expect([...first].toSorted((a, b) => a - b).join()).toBe([first, [...first].reverse()].find((x) => x.join() === [...first].toSorted((a, b) => a - b).join())!.join());
});

test("hovers show at once, on the page itself, and go when the pointer leaves", async ({ page }) => {
  const tip = page.getByRole("tooltip");
  await page.getByRole("table", { name: "Combinations" }).getByRole("columnheader", { name: /^Score/ }).hover();
  await expect(tip).toBeVisible({ timeout: 500 });
  await expect(tip).toContainText("The score of record of this combination's finished runs");
  await page.mouse.move(1, 1);
  await expect(tip).toBeHidden();
});

