import { expect, test, type Page } from "@playwright/test";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const QWEN_27B = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";

const row = (page: Page, stack: string, run: string) => page.locator(`tr:not(.detail)[data-stack="${stack}"][data-run="${run}"]`);
const machine = (page: Page, name: string) => page.locator(`section[data-machine="${name}"]`);
const cell = (page: Page, stack: string, run: string, n: number) => row(page, stack, run).locator("td").nth(n);

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/test/reset");  // the fake dbench starts from the fixture in every test
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
});

test("each machine has one section, headed by what it runs now, with its queue in dbench's order", async ({ page }) => {
  await expect(machine(page, "gruntus")).toHaveCount(1);
  await expect(machine(page, "gruntus").locator("h2")).toContainText("running 3.8-swift-1.5/27b llamacpp v2-r1 · story 3");
  await expect(machine(page, "gruntus").locator("h2")).toContainText("3 queued");
  const runs = await machine(page, "gruntus").locator("tbody tr[data-run]").evaluateAll((trs) =>
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
  // A story counts only when all its held-out tests pass: the heading says so.
  await expect(page.getByRole("columnheader", { name: "Stories passing held-out tests" }).first()).toBeVisible();
  const sw = cell(page, SWIFT, "v2-r1", 5);
  await expect(sw.locator("[data-story]")).toHaveCount(11);
  await expect(sw.locator("[data-story='1']")).toHaveAttribute("data-state", "ok");
  await expect(sw.locator("[data-story='2']")).toHaveAttribute("data-state", "part"); // 9/10, reported by dbench before git
  await expect(sw.locator("[data-story='3']")).toHaveAttribute("data-state", "running");
  await expect(sw.locator("[data-story='4']")).toHaveAttribute("data-state", "unbuilt");
  await expect(sw).toContainText("1 of 11 pass");
  await expect(sw.locator("[data-story='2']")).toHaveAttribute("title", /9\/10 hidden flows/);
});

test("queued runs say queued and their place on the node, in dbench's order, and nothing else", async ({ page }) => {
  await expect(cell(page, SWIFT, "v2-r2", 1)).toHaveText("queued2nd on gruntus");
  await expect(cell(page, SWIFT, "v2-r3", 1)).toContainText("3rd on gruntus");
  await expect(cell(page, QWEN_27B, "v2-r1", 1)).toContainText("4th on gruntus");
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) await expect(cell(page, SWIFT, "v2-r2", n)).toHaveText("—");
});

test("a story that has only just started says so instead of showing zeros", async ({ page }) => {
  const activity = cell(page, "qwen/3.8/flash-next/macos/128GB/mlxserve-pi", "v2-r1", 4);
  await expect(activity).toContainText("first numbers within a minute");
  await expect(activity).not.toContainText("0 calls");
});

test("a running story's title shows in full over up to three lines, not cut to one", async ({ page }) => {
  const title = cell(page, SWIFT, "v2-r1", 2).locator(".story-title");
  const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBeLessThanOrEqual(3);
  expect(await title.evaluate((el) => getComputedStyle(el).whiteSpace)).not.toBe("nowrap");
});

test("tokens and tok/s per run, and per story on click", async ({ page }) => {
  // gufo canvas-gufo-r3 (v1) has a recorded story with tokens and speeds in the fixture.
  await page.getByLabel("Version").selectOption("all");
  const stack = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi";
  const r = row(page, stack, "canvas-gufo-r3");
  await expect(r.locator("td.tokens")).toContainText("56k out");
  await expect(r.locator("td.tokens")).toContainText("6.3M read"); // 45,179 fresh + 6,230,043 cached
  await expect(r.locator("td.speed")).toContainText("74 tok/s"); // 55,968 output tokens over the story's 760.3 s
  await r.locator("td").first().click();
  const detail = page.locator(`tr.detail[data-stack="${stack}"][data-run="canvas-gufo-r3"]`);
  await expect(detail).toBeVisible();
  await expect(detail.locator("tbody tr").first()).toContainText("55,968");
  await expect(detail.locator("tbody tr").first()).toContainText("73.6");  // tok/s: out ÷ story time
  await expect(detail.locator("tbody tr").first()).toContainText("98.9");  // decode tok/s, where the model was timed
  await expect(detail.locator("thead")).toContainText("Held-out passing (latest build)"); // like the squares
  // A long story name wraps to three lines before it is cut.
  const name = detail.locator("tbody td.story-name").first();
  expect(await name.evaluate((el) => getComputedStyle(el).whiteSpace)).not.toBe("nowrap");
  await r.locator("td").first().click();
  await expect(detail).toHaveCount(0);
});

test("a Claude run, whose calls and tokens are only counted at the end of a story, shows no false zeros", async ({ page }) => {
  const activity = cell(page, "reference/opus-5.5", "v2-r1", 4);
  await expect(activity).toContainText("tasks 1/2");
  await expect(activity).not.toContainText("0 calls");
  await expect(activity).not.toContainText("0k out");
});

test("a finished, scored run with its bundle can be judged, and links to its record", async ({ page }) => {
  await expect(cell(page, "reference/opus-5.5", "run-9", 1)).toContainText("finished");
  // The score is one number under a heading that carries the total.
  await expect(page.getByRole("columnheader", { name: "Score / 75" }).first()).toBeVisible();
  await expect(cell(page, "reference/opus-5.5", "run-9", 8)).toHaveText("74");
  // The link opens this run in the review, not the review's first build.
  await expect(cell(page, "reference/opus-5.5", "run-9", 9).getByRole("link", { name: "Judge →" }))
    .toHaveAttribute("href", "http://127.0.0.1:7800/review?setup=reference%2Fopus-5.5&run=run-9");
  const record = cell(page, "reference/opus-5.5", "run-9", 10).getByRole("link", { name: "record" });
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

test("all eleven columns fit at 1000 px", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const fits = await page.locator("section").evaluateAll((ss) => ss.every((s) => s.scrollWidth <= s.clientWidth + 1));
  expect(fits).toBe(true);
  // No heading or link breaks inside a word ("JUDG / E", "recor / d").
  const broken = await page.locator("thead th, .links a").evaluateAll((els) =>
    els.filter((el) => { const r = document.createRange(); r.selectNodeContents(el);
      return !/\s/.test(el.textContent!.trim()) && new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1; })
      .map((el) => el.textContent));
  expect(broken).toEqual([]);
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

test("by story: pick a story, every job's numbers for it side by side, and one job as the comparison", async ({ page }) => {
  await page.getByRole("button", { name: "By story" }).click();
  await page.getByRole("button", { name: /^1\. / }).click();
  const table = page.getByRole("table", { name: "Story 1 by job" });
  const swift = table.locator(`tr[data-stack="${SWIFT}"][data-run="v2-r1"]`);
  const opus = table.locator(`tr[data-stack="reference/opus-5.5"][data-run="run-9"]`);
  await expect(swift).toContainText("12");        // agent minutes: 720 s
  await expect(swift).toContainText("95");        // calls
  await expect(opus).toContainText("20");
  await opus.click();
  await expect(opus).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Set as comparison job" }).click();
  await expect(opus).toHaveAttribute("data-comparison", "true");
  await expect(opus.locator("td.calls")).toHaveText("20");       // the comparison keeps its own numbers
  await expect(swift.locator("td.calls")).toHaveText("475%");    // 95 calls against 20
  await expect(swift.locator("td.minutes")).toHaveText("150%");  // 12 min against 8
  // Where the comparison's value is 0 or missing a percentage means nothing: the job's own number shows.
  await expect(swift.locator("td.compactions")).toHaveText("1");
  await expect(swift.locator("td.decode")).toHaveText("101.4");
  await page.getByRole("button", { name: "Clear comparison" }).click();
  await expect(swift.locator("td.calls")).toHaveText("95");
});

test.describe("machines", () => {
  const machine = (page: Page, name: string) => page.locator(`[data-machine-card="${name}"]`);

  test("lists each machine with its hardware and installs; queue a run and it shows in Runs", async ({ page }) => {
    await page.getByRole("tab", { name: "Machines" }).click();
    const g = machine(page, "gruntus");
    await expect(g).toContainText("NVIDIA GeForce RTX 4090");
    // Jobs: running first, then the queue in its order.
    expect(await g.locator("[data-job]").evaluateAll((js) => js.map((j) => (j as HTMLElement).dataset.job)))
      .toEqual(["vidi-v2b-swift15-r1", "vidi-v2b-swift15-r2", "vidi-v2b-swift15-r3", "vidi-v2b-27b-r1", "vidi-v2b-27b-r2"]);
    // The form starts on what the machine is running now.
    await expect(g.getByLabel("Combination")).toHaveValue("swift15-qwen38-27b");
    await expect(g).toContainText("qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi");
    await g.getByLabel("Combination").selectOption("qwen38-27b");
    await g.getByLabel("Run id").fill("v3-r1");
    await g.getByRole("button", { name: "Queue" }).click();
    await expect(g).toContainText("vidi-qwen38-27b-v3-r1 queued");
    await page.getByRole("tab", { name: "Runs" }).click();
    await page.getByLabel("Version").selectOption("all");
    await expect(page.locator(`tr:not(.detail)[data-stack="${QWEN_27B}"][data-run="v3-r1"]`)).toContainText("queued");
  });

  test("stopping a running job asks first; restart resumes it; a queued one is removed without asking", async ({ page }) => {
    await page.getByRole("tab", { name: "Machines" }).click();
    const job = machine(page, "gruntus").locator('[data-job="vidi-v2b-swift15-r1"]');
    await job.getByRole("button", { name: "Stop" }).click();
    await expect(job).toContainText("throws away the story in progress");
    await job.getByRole("button", { name: "Keep running" }).click();
    await expect(job).toContainText("running");
    await job.getByRole("button", { name: "Log" }).click();
    await expect(job.locator("pre")).toContainText("fixture log");
    await job.getByRole("button", { name: "Stop" }).click();
    await job.getByRole("button", { name: "Yes, stop it" }).click();
    await expect(job).toContainText("cancelled");
    await job.getByRole("button", { name: "Restart" }).click();
    await expect(machine(page, "gruntus").locator('[data-job="vidi-v2b-swift15-r1-again1"]')).toContainText("queued");
    const queued = machine(page, "gruntus").locator('[data-job="vidi-v2b-swift15-r2"]');
    await queued.getByRole("button", { name: "Remove" }).click();
    await expect(queued).toContainText("cancelled");
  });

  test("adding a machine: its token over SSH, or, when SSH can't, the command to get it and a box to paste it", async ({ page }) => {
    await page.getByRole("tab", { name: "Machines" }).click();
    const add = page.getByRole("form", { name: "Add a machine" });
    await add.getByLabel("Machine name").fill("sshbox");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(machine(page, "sshbox")).toBeVisible();
    await add.getByLabel("Machine name").fill("newbox");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(add).toContainText("cat ~/.dbench/token");
    await add.getByLabel("Token").fill("pasted-token-0123456789");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(machine(page, "newbox")).toBeVisible();
  });

  test("setup explains how to make a machine a node", async ({ page }) => {
    await page.getByRole("tab", { name: "Setup" }).click();
    await expect(page.getByRole("heading", { name: "Make a machine a benchmark node" })).toBeVisible();
    await expect(page.getByText("dbench service-unit")).toBeVisible();
  });

  test("the server refuses changes that don't come from the page", async ({ request }) => {
    const r = await request.post("/api/jobs", { data: { node: "gruntus", installId: "qwen38-27b", pack: "benchmarks/vidi", runId: "x" } });
    expect(r.status()).toBe(403);
  });
});

test("each combination heads its runs with hours per story and held-out quality, each with a ? that explains it", async ({ page }) => {
  const head = page.locator(`tr.combo-head[data-stack="${SWIFT}"]`);
  await expect(head).toContainText("3.8-swift-1.5/27b llamacpp");
  await expect(head).toContainText(/\d+(\.\d+)? h per story/);
  await expect(head).toContainText(/held-out quality \d+%/);
  for (const q of await head.locator(".explain").all()) expect((await q.getAttribute("title"))!.length).toBeGreaterThan(40);
  // The combination's runs follow its heading.
  await expect(page.locator(`tr.combo-head[data-stack="${SWIFT}"] + tr`)).toHaveAttribute("data-stack", SWIFT);
});

test("every column heading explains itself on hover", async ({ page }) => {
  const titles = await page.locator("section[data-machine] thead th").evaluateAll((ths) => ths.map((th) => th.getAttribute("title") ?? ""));
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.filter((t) => t.length < 20)).toEqual([]);
});

test("combinations: one row each across machines, over the runs shown, sortable, every heading explained", async ({ page }) => {
  const table = page.getByRole("table", { name: "Combinations" });
  const swift = table.locator(`tr[data-stack="${SWIFT}"]`);
  await expect(swift).toContainText("3.8-swift-1.5/27b llamacpp");
  await expect(swift).toContainText("gruntus");
  await expect(swift).toContainText("1 running");
  await expect(swift).toContainText("2 queued");
  await expect(page.locator("section.combinations")).toContainText(/over the \d+ runs? shown/);
  for (const t of await table.locator("thead th").evaluateAll((ths) => ths.map((th) => th.getAttribute("title") ?? ""))) expect(t.length).toBeGreaterThan(20);
  // Sorting: a click sorts by the column, a second click reverses it; runs without a number stay last.
  const calls = async () => (await table.locator("tbody td.calls").allInnerTexts()).filter((x) => x !== "—").map(Number);
  await table.getByRole("columnheader", { name: /Calls per story/ }).click();
  const first = await calls();
  expect(first.length).toBeGreaterThan(1);
  await table.getByRole("columnheader", { name: /Calls per story/ }).click();
  expect(await calls()).toEqual([...first].reverse());
  expect([...first].toSorted((a, b) => a - b).join()).toBe([first, [...first].reverse()].find((x) => x.join() === [...first].toSorted((a, b) => a - b).join())!.join());
  await page.getByRole("button", { name: "By story" }).click();
  await expect(table).toBeVisible();   // above both views
});
