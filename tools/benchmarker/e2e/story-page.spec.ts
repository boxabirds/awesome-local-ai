import { expect, test, type Locator, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { GLOSSARY } from "../shared/glossary.ts";

// The story page, section by section in reading order (header, the story list, by combination, the comparison,
// where the time went), then where every link lands, the keyboard, a narrow window, the story links on other pages,
// the page state other pages keep in their address, and the tooltip for keyboard users. Within a section, one test
// per state that changes what it shows. States the fixture lacks are made by changing the state the page gets, for
// that test only.
//
// The fixture's vidi-v2 runs: Opus (run-9 finished, v2-r1 running on story 2), Swift 1.5 (v2-r4..r7 finished, v2-r1
// running on story 3, v2-r2 and v2-r3 queued), 3.8/27b (v2-r1 queued, v2-r2 cancelled), mlx-serve (v2-r1 on story 1).

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const MLX = "qwen/3.8/flash-next/macos/128GB/mlxserve-pi";
const Q27 = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;
const storyUrl = (n: string, compare?: string) => `/#/vidi/s/${n}${compare ? `?compare=${enc(compare)}` : ""}`;
const cmpOf = (stack: string, run: string) => `${stack}|${run}`;

const page$ = (page: Page) => page.locator('[data-page="story"]');
const section = (page: Page, id: string) => page.locator(`[data-page="story"] [data-section="${id}"]`);
const group = (page: Page, stack: string) => section(page, "combinations").locator(`tbody[data-stack="${stack}"]`);
const row = (page: Page, stack: string, run: string) => group(page, stack).locator(`tr.sp-entry[data-run="${run}"]`);
const cell = (page: Page, stack: string, run: string, measure: string) => row(page, stack, run).locator(`td[data-measure="${measure}"]`);
const medianCell = (page: Page, stack: string, measure: string) => group(page, stack).locator(`tr.sp-median td[data-measure="${measure}"]`);
const bars = (page: Page) => section(page, "time");
const tip = (page: Page) => page.getByRole("tooltip");

/** Serve the page a changed state for this test: the real one, passed through `change`. */
async function patchState(page: Page, change: (s: State) => void) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

async function open(page: Page, n: string, compare?: string) {
  await page.goto(storyUrl(n, compare));
  await expect(page$(page)).toBeVisible();
  await expect(page$(page)).toHaveAttribute("data-story", n);
}

const width = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().width);

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("header", () => {
  test("the story's number and title, its pack and version, under a breadcrumb", async ({ page }) => {
    await open(page, "2");
    const h = section(page, "header");
    await expect(h.locator("h1")).toHaveText("Story 2: Sticky notes");
    await expect(h.locator(".eyebrow")).toHaveText("Story · vidi · vidi-v2");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("vidi story 2");
    await crumbs.getByRole("link", { name: "Overview" }).click();
    await expect(page.locator("table.combos")).toBeVisible();
  });

  test("held-out tests: one count when every run agrees", async ({ page }) => {
    await open(page, "1");
    await expect(section(page, "header").locator('[data-fact="tests"] .big-n')).toHaveText("6");
    await expect(section(page, "header").locator(".tests-differ")).toHaveCount(0);
  });

  test("held-out tests: counts that differ between suite versions are each shown, with how many runs", async ({ page }) => {
    await open(page, "2");
    const f = section(page, "header").locator('[data-fact="tests"]');
    await expect(f.locator(".big-n")).toHaveText("14");
    await expect(f.locator(".tests-differ")).toHaveText("in 4 runs; 10 in 2");
    await expect(f.locator(".tests-differ")).toHaveAttribute("data-tip", /14 in 4 runs, 10 in 2 runs\. Runs scored under another suite version/);
  });

  test("held-out tests not recorded by any run: — with why", async ({ page }) => {
    await open(page, "4");
    const m = section(page, "header").locator('[data-fact="tests"] .missing');
    await expect(m).toHaveText("—");
    await expect(m).toHaveAttribute("data-tip", "No run has recorded this story's held-out tests yet.");
  });

  test("how many story runs, in how many combinations, and how many runs haven't built it", async ({ page }) => {
    await open(page, "2");
    await expect(section(page, "header").locator('[data-fact="runs"]')).toContainText("7 in 2 combinations · 5 runs not built");
  });

  test("previous and next: the first story has no previous", async ({ page }) => {
    await open(page, "1");
    const nav = section(page, "header").locator('[data-fact="nav"]');
    await expect(nav.locator('[data-nav="prev"]')).toHaveText("first story");
    await expect(nav.locator('[data-nav="prev"] a')).toHaveCount(0);
    await nav.locator('[data-nav="next"] a').click();
    await expect(page$(page)).toHaveAttribute("data-story", "2");
  });

  test("previous and next: the last story has no next", async ({ page }) => {
    await open(page, "12");
    const nav = section(page, "header").locator('[data-fact="nav"]');
    await expect(nav.locator('[data-nav="next"]')).toHaveText("last story");
    await nav.locator('[data-nav="prev"] a').click();
    await expect(page$(page)).toHaveAttribute("data-story", "11");
  });

  test("previous and next skip a story the pack doesn't have (no story 6)", async ({ page }) => {
    await open(page, "5");
    await expect(section(page, "header").locator('[data-nav="next"] a')).toHaveAttribute("href", "#/vidi/s/7");
  });

  test("a story no run has built: its number, 'title not known yet', and no measures", async ({ page }) => {
    await open(page, "4");
    await expect(section(page, "header").locator("h1")).toContainText("title not known yet");
    await expect(section(page, "combinations").locator("tr.sp-entry")).toHaveCount(0);
    await expect(section(page, "time")).toContainText("No story run of this story has a recorded time split yet.");
  });

  test("a story the pack version doesn't have: says so, and the list is there to choose from", async ({ page }) => {
    await open(page, "6");
    await expect(section(page, "header").locator("h1")).toContainText("not in this pack version");
    await expect(section(page, "header").locator('[data-fact="nav"]')).toContainText("not among this pack version's stories");
    await expect(page.getByRole("navigation", { name: "Stories" }).locator("li")).toHaveCount(11);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("story list", () => {
  test("every story of the pack version, in order, with its title; the one shown is the current page", async ({ page }) => {
    await open(page, "2");
    const list = page.getByRole("navigation", { name: "Stories" });
    expect(await list.locator("li").evaluateAll((ls) => ls.map((l) => (l as HTMLElement).dataset.story))).toEqual(["1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12"]);
    await expect(list.locator('li[data-story="1"]')).toHaveText("1 Pan and zoom");
    await expect(list.locator('li[data-story="4"]')).toHaveText("4 not built yet");
    await expect(list.locator('[aria-current="page"]')).toHaveAttribute("data-story", "2");
    await expect(list.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("a story's title while only a running run has it is the live one", async ({ page }) => {
    await open(page, "3");
    await expect(page.getByRole("navigation", { name: "Stories" }).locator('li[data-story="3"]')).toHaveText("3 See other people's edits live");
  });

  test("each story links to its page; moving along changes the page, not the scroll's owner", async ({ page }) => {
    await open(page, "1");
    await page.getByRole("navigation", { name: "Stories" }).locator('li[data-story="2"] a').click();
    await expect(page).toHaveURL(/#\/vidi\/s\/2$/);
    await expect(section(page, "header").locator("h1")).toHaveText("Story 2: Sticky notes");
  });

  test("keeps the comparison: every story link carries it, and following one keeps it on", async ({ page }) => {
    const c = cmpOf(SWIFT, "v2-r4");
    await open(page, "2", c);
    const list = page.getByRole("navigation", { name: "Stories" });
    for (const n of ["1", "3", "12"]) await expect(list.locator(`li[data-story="${n}"] a`)).toHaveAttribute("href", `#/vidi/s/${n}?compare=${enc(c)}`);
    await expect(section(page, "header").locator('[data-nav="next"] a')).toHaveAttribute("href", `#/vidi/s/3?compare=${enc(c)}`);
    await list.locator('li[data-story="1"] a').click();
    await expect(page$(page)).toHaveAttribute("data-story", "1");
    await expect(section(page, "combinations").locator('.compare-note[data-compare="ok"]')).toContainText("v2-r4");
    await expect(row(page, SWIFT, "v2-r4")).toHaveAttribute("data-comparison", "true");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("by combination", () => {
  test("combinations in order: a finished run's best held-out median first, then agent time; then only running; then not built", async ({ page }) => {
    await open(page, "1");
    const stacks = await section(page, "combinations").locator("tbody[data-stack]").evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.stack));
    expect(stacks).toEqual([OPUS, SWIFT, MLX, Q27]);
  });

  test("each combination is a link to its page, with its machines", async ({ page }) => {
    await open(page, "1");
    const head = group(page, SWIFT).locator("tr.sp-group");
    await expect(head.locator("a.combination-link")).toHaveText("3.8-swift-1.5/27b llamacpp");
    await expect(head.locator("a.combination-link")).toHaveAttribute("href", `#/vidi/c/${enc(SWIFT)}`);
    await expect(head.locator("a.machine-link")).toHaveText(["gruntus"]);
    await expect(group(page, OPUS).locator("tr.sp-group a.machine-link")).toHaveText(["Apple M2 16GB", "macbook-air"]);
  });

  test("median and range over the finished runs, with n; running runs aren't in it", async ({ page }) => {
    await open(page, "1");
    await expect(group(page, SWIFT).locator("tr.sp-median th")).toContainText("over 4 finished runs");
    await expect(medianCell(page, SWIFT, "minutes")).toHaveText("12 min11 min–25 minn=4");
    await expect(medianCell(page, SWIFT, "outTokens")).toHaveText("61k55k–90kn=4");
    await expect(medianCell(page, SWIFT, "calls")).toHaveText("9188–95n=4");
    await expect(medianCell(page, SWIFT, "heldOut")).toHaveText("100%83%–100%n=4");
    await expect(medianCell(page, SWIFT, "minutes")).toHaveAttribute("data-tip", "Median 12 min, from 11 min to 25 min, over 4 finished runs.");
  });

  test("one finished run: its own value, no range, n=1", async ({ page }) => {
    await open(page, "1");
    await expect(medianCell(page, OPUS, "minutes")).toHaveText("8 minn=1");
  });

  test("no finished run: every median is — with why", async ({ page }) => {
    await open(page, "1");
    const m = medianCell(page, MLX, "minutes").locator(".missing");
    await expect(m).toHaveText("—");
    await expect(m).toHaveAttribute("data-tip", "No finished run of this combination has recorded story 1, so there is no median: running runs aren't in it.");
  });

  test("a finished run with no usage for the story: that median is — with why; held-out still has one", async ({ page }) => {
    await open(page, "2");
    await expect(medianCell(page, OPUS, "minutes").locator(".missing")).toHaveAttribute("data-tip", "No finished run of this combination recorded its agent time for this story.");
    await expect(medianCell(page, OPUS, "heldOut")).toHaveText("90%n=1");
  });

  test("the measures of a story run: every column, from the glossary", async ({ page }) => {
    await open(page, "1");
    const heads = await section(page, "combinations").locator("thead th[data-measure] > .term").allTextContents();
    expect(heads).toEqual(["Agent time", "Output tokens", "Tool calls", "Held-out", "Input tokens", "tok/s", "Decode tok/s", "Compactions", "Nudges"]);
    const values = await row(page, SWIFT, "v2-r4").locator("td[data-measure]").evaluateAll((tds) => tds.map((td) => (td.firstChild?.textContent ?? "").trim()));
    expect(values).toEqual(["12 min", "55k", "88", "6/6", "4.4M", "79.7", "102.0", "1", "0"]);
    await expect(cell(page, SWIFT, "v2-r4", "heldOut").locator(".ho")).toHaveText("6/6");
  });

  test("each run: a run link, a story-run link, its status and machine", async ({ page }) => {
    await open(page, "1");
    const r = row(page, SWIFT, "v2-r4");
    await expect(r.locator("a.run-link")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r4`);
    await expect(r.locator("a.story-run-link")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r4/s/1`);
    await expect(r.locator(".sp-run-meta")).toContainText("✓ finished · gruntus");
    await expect(row(page, SWIFT, "v2-r1").locator(".sp-run-meta")).toContainText("▶ running");
  });

  test("runs in run order: finished first, then running", async ({ page }) => {
    await open(page, "1");
    const runs = await group(page, SWIFT).locator("tr.sp-entry").evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.run));
    expect(runs).toEqual(["v2-r4", "v2-r5", "v2-r6", "v2-r7", "v2-r1"]);
  });

  test("a missing number is — with why, never 0", async ({ page }) => {
    await open(page, "1");
    const decode = cell(page, OPUS, "run-9", "decodeTokS").locator(".missing");
    await expect(decode).toHaveText("—");
    await expect(decode).toHaveAttribute("data-tip", /cloud model/);
    await expect(cell(page, OPUS, "v2-r1", "minutes").locator(".missing")).toHaveAttribute("data-tip", /record has no usage/);
  });

  test("a zero is a number: 0 nudges shows 0", async ({ page }) => {
    await open(page, "1");
    await expect(cell(page, SWIFT, "v2-r4", "nudges")).toHaveText("0");
  });

  test("held-out: the result right after the story, coloured, and the latest build's beneath it, labelled live", async ({ page }) => {
    await open(page, "2");
    const c = cell(page, SWIFT, "v2-r6", "heldOut");
    await expect(c.locator(".ho")).toHaveText("11/14");
    await expect(c.locator(".ho .sq")).toHaveClass(/q-part/);
    await expect(c.locator("[data-latest]")).toHaveText("latest 11/14");
    await expect(c.locator("[data-latest] .live-n")).toHaveAttribute("data-tip", new RegExp(`^${GLOSSARY.storyLatestBuild.what.slice(0, 20)}`));
    await expect(section(page, "combinations").locator('thead th[data-measure="heldOut"] .tag-live')).toHaveText("live");
  });

  test("a story being built: its live figures, italic and labelled live, and no record yet", async ({ page }) => {
    await open(page, "2");
    const r = row(page, OPUS, "v2-r1");
    await expect(r).toHaveAttribute("data-attempt", "building");
    await expect(r.locator(".sp-run-meta .tag-live")).toHaveText("live");
    await expect(cell(page, OPUS, "v2-r1", "minutes").locator(".live-n")).toHaveText("5 min");
    await expect(cell(page, OPUS, "v2-r1", "minutes").locator(".live-n")).toHaveAttribute("data-tip", /^Live: agent time so far/);
    await expect(cell(page, OPUS, "v2-r1", "readTokens").locator(".missing")).toHaveAttribute("data-tip", /Being built now/);
    await expect(r.locator(".sp-btn")).toHaveCount(0);   // nothing recorded to compare with
  });

  test("built by its square but not recorded yet: says so", async ({ page }) => {
    await patchState(page, (s) => {
      const r = s.rows.find((x) => x.stack === SWIFT && x.runId === "v2-r7")!;
      r.stories = r.stories.filter((x) => x.id !== "2");
    });
    await open(page, "2");
    await expect(row(page, SWIFT, "v2-r7")).toHaveAttribute("data-attempt", "unrecorded");
    await expect(row(page, SWIFT, "v2-r7").locator(".sp-run-meta")).toContainText("no record yet");
    await expect(cell(page, SWIFT, "v2-r7", "minutes").locator(".missing")).toHaveAttribute("data-tip", /record hasn't arrived yet/);
  });

  test("runs that haven't built it: each a link, with its status, and why on hover", async ({ page }) => {
    await open(page, "1");
    const nb = group(page, SWIFT).locator("tr.sp-not-built");
    await expect(nb).toContainText("Not built: v2-r2 queued · v2-r3 queued");
    await expect(nb.locator('[data-run="v2-r2"] a.run-link')).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r2`);
    await expect(nb.locator('[data-run="v2-r2"] .small[data-tip]')).toHaveAttribute("data-tip", "The run is queued: no story is built yet.");
    await expect(group(page, Q27).locator("tr.sp-not-built")).toContainText("v2-r2 cancelled");
    await expect(group(page, Q27).locator("tr.sp-median")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("the 10% divergence mark", () => {
  test("over 10% from the combination's median: flagged, above filled and below outlined, the reason on hover", async ({ page }) => {
    await open(page, "1");
    const above = cell(page, SWIFT, "v2-r6", "minutes").locator(".flag");
    await expect(above).toHaveClass(/above/);
    await expect(above).toHaveAttribute("data-tip", /^\+116% above the combination's median agent time for this story \(12 min over 4 finished runs\)\. Mechanism: /);
    const below = cell(page, SWIFT, "v2-r6", "heldOut").locator(".flag");
    await expect(below).toHaveClass(/below/);
    await expect(cell(page, SWIFT, "v2-r7", "outTokens").locator(".flag")).toHaveClass(/above/);
  });

  test("within 10%: no flag; and only the four summarised measures are ever flagged", async ({ page }) => {
    await open(page, "1");
    await expect(row(page, SWIFT, "v2-r4").locator(".flag")).toHaveCount(0);
    for (const m of ["readTokens", "tokS", "decodeTokS", "compactions", "nudges"]) await expect(section(page, "combinations").locator(`td[data-measure="${m}"] .flag`)).toHaveCount(0);
  });

  test("a running run is flagged against the finished runs' median", async ({ page }) => {
    await patchState(page, (s) => {
      s.rows.find((x) => x.stack === SWIFT && x.runId === "v2-r1")!.stories[0].usage!.agentSeconds = 3000;
    });
    await open(page, "1");
    await expect(cell(page, SWIFT, "v2-r1", "minutes").locator(".flag")).toHaveClass(/above/);
  });

  test("exactly 10% from the median is not flagged; a second more is", async ({ page }) => {
    // Swift's story 1 medians over v2-r4..r7: make them 600, 600, 660 (exactly +10%) and 600 → median 600.
    const set = (secs: number) => patchState(page, (s) => {
      const sec: Record<string, number> = { "v2-r4": 600, "v2-r5": 600, "v2-r6": secs, "v2-r7": 600 };
      for (const r of s.rows) if (r.stack === SWIFT && sec[r.runId] !== undefined) r.stories.find((x) => x.id === "1")!.usage!.agentSeconds = sec[r.runId];
    });
    await set(660);
    await open(page, "1");
    await expect(cell(page, SWIFT, "v2-r6", "minutes").locator(".flag")).toHaveCount(0);
    await page.unrouteAll();
    await set(661);
    await page.reload();
    await expect(cell(page, SWIFT, "v2-r6", "minutes").locator(".flag")).toHaveCount(1);
  });

  test("one finished run: nothing to differ from, no flag", async ({ page }) => {
    await open(page, "1");
    await expect(group(page, OPUS).locator(".flag")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("set as comparison", () => {
  const C = cmpOf(SWIFT, "v2-r4");

  test("choosing a story run: the address says so; every other run reads as a percentage of it; it stays in full", async ({ page }) => {
    await open(page, "2");
    await row(page, SWIFT, "v2-r4").getByRole("button", { name: /Set .* v2-r4 as comparison/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/vidi/s/2\\?compare=${enc(C).replace(/[|%]/g, (c) => `\\${c}`)}$`));
    await expect(row(page, SWIFT, "v2-r4")).toHaveAttribute("data-comparison", "true");
    await expect(row(page, SWIFT, "v2-r4").locator(".tag-compare")).toHaveText("comparison");
    await expect(cell(page, SWIFT, "v2-r4", "minutes")).toHaveText("16 min");
    await expect(cell(page, SWIFT, "v2-r5", "minutes").locator(".pct")).toHaveText("501%");
    await expect(cell(page, SWIFT, "v2-r5", "minutes").locator(".pct")).toHaveAttribute("data-tip", "1h20m: 501% of v2-r4's 16 min");
    await expect(section(page, "combinations").locator('.compare-note[data-compare="ok"]')).toContainText("percentages of 3.8-swift-1.5/27b llamacpp v2-r4's");
  });

  test("held-out stays a count, and the medians stay in their own units", async ({ page }) => {
    await open(page, "2", C);
    await expect(cell(page, SWIFT, "v2-r5", "heldOut").locator(".ho")).toHaveText("14/14");
    await expect(medianCell(page, SWIFT, "minutes").locator(".median")).toHaveText("17 min");
  });

  test("where the comparison's number is 0: each run shows its own, and why", async ({ page }) => {
    await open(page, "2", C);
    const own = cell(page, SWIFT, "v2-r5", "nudges").locator(".own");
    await expect(own).toHaveText("0");
    await expect(own).toHaveAttribute("data-tip", /comparison's figure is 0/);
  });

  test("where the comparison's number is missing: each run shows its own, and why", async ({ page }) => {
    await patchState(page, (s) => { s.rows.find((x) => x.stack === SWIFT && x.runId === "v2-r4")!.stories.find((x) => x.id === "2")!.usage!.decodeTokS = null; });
    await open(page, "2", C);
    await expect(cell(page, SWIFT, "v2-r5", "decodeTokS").locator(".own")).toHaveAttribute("data-tip", /comparison has no figure/);
  });

  test("survives a reload", async ({ page }) => {
    await open(page, "2");
    await row(page, SWIFT, "v2-r4").getByRole("button", { name: /as comparison/ }).click();
    await expect(row(page, SWIFT, "v2-r4")).toHaveAttribute("data-comparison", "true");
    await page.reload();
    await expect(row(page, SWIFT, "v2-r4")).toHaveAttribute("data-comparison", "true");
    await expect(cell(page, SWIFT, "v2-r5", "minutes").locator(".pct")).toHaveText("501%");
  });

  test("survives the back button: off to a run's page and back, the comparison is still on", async ({ page }) => {
    await open(page, "2");
    await row(page, SWIFT, "v2-r4").getByRole("button", { name: /as comparison/ }).click();
    await row(page, SWIFT, "v2-r5").locator("a.run-link").click();
    await expect(page.locator('[data-page="run"]')).toBeVisible();
    await page.goBack();
    await expect(row(page, SWIFT, "v2-r4")).toHaveAttribute("data-comparison", "true");
    await expect(page).toHaveURL(/\?compare=/);
  });

  test("choosing one isn't a step of its own in the history: Back leaves the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("table.combos")).toBeVisible();
    await page.goto(storyUrl("2"));
    await row(page, SWIFT, "v2-r4").getByRole("button", { name: /as comparison/ }).click();
    await row(page, SWIFT, "v2-r5").getByRole("button", { name: /as comparison/ }).click();
    await expect(row(page, SWIFT, "v2-r5")).toHaveAttribute("data-comparison", "true");
    await page.goBack();
    await expect(page.locator("table.combos")).toBeVisible();
  });

  test("clearing it: the percentages go, and so does the address's parameter", async ({ page }) => {
    await open(page, "2", C);
    await section(page, "combinations").locator(".compare-note").getByRole("button", { name: "Clear comparison" }).click();
    await expect(page).toHaveURL(/#\/vidi\/s\/2$/);
    await expect(cell(page, SWIFT, "v2-r5", "minutes")).toHaveText(/^1h20m/);
    await expect(section(page, "combinations").locator(".pct, .own")).toHaveCount(0);
    await expect(section(page, "combinations").locator("[data-comparison]")).toHaveCount(0);
  });

  test("clearing from the comparison's own row", async ({ page }) => {
    await open(page, "2", C);
    await row(page, SWIFT, "v2-r4").getByRole("button", { name: "Clear" }).click();
    await expect(page).toHaveURL(/#\/vidi\/s\/2$/);
  });

  test("a comparison that hasn't built this story: the note says so, numbers are shown as they are", async ({ page }) => {
    await open(page, "3", C);
    const note = section(page, "combinations").locator('.compare-note[data-compare="unusable"]');
    await expect(note).toContainText("v2-r4 of 3.8-swift-1.5/27b llamacpp hasn't built story 3");
    await expect(section(page, "combinations").locator(".pct")).toHaveCount(0);
  });

  test("an address naming no run, or malformed: says so", async ({ page }) => {
    await open(page, "2", cmpOf(SWIFT, "v9-nope"));
    await expect(section(page, "combinations").locator(".compare-note")).toContainText(`No run v9-nope of ${SWIFT} in this pack version.`);
    await open(page, "2", "junk");
    await expect(section(page, "combinations").locator(".compare-note")).toContainText(`"junk" doesn't name a run`);
  });

  test("a comparison from another combination works across combinations", async ({ page }) => {
    await open(page, "1", cmpOf(OPUS, "run-9"));
    await expect(cell(page, SWIFT, "v2-r4", "minutes").locator(".pct")).toHaveText("144%");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("where the time went", () => {
  test("a bar per story run, grouped by combination in the table's order, each part in the one order", async ({ page }) => {
    await open(page, "1");
    const groups = await bars(page).locator(".sp-time-group").evaluateAll((gs) => gs.map((g) => (g as HTMLElement).dataset.stack));
    expect(groups).toEqual([OPUS, SWIFT, MLX]);
    const runs = await bars(page).locator(`.sp-time-group[data-stack="${SWIFT}"] .bar-row`).evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.run));
    expect(runs).toEqual(["v2-r4", "v2-r5", "v2-r6", "v2-r7", "v2-r1"]);
    const segs = await bars(page).locator('[data-run="v2-r4"] [data-seg]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.seg));
    expect(segs).toEqual(["prefill", "decode", "compaction", "tools", "other"]);
  });

  test("one scale for every bar on the page: 25 minutes is about twice 12, in the section and in the table", async ({ page }) => {
    await open(page, "1");
    const inSection = (await width(bars(page).locator('[data-run="v2-r6"] .bar'))) / (await width(bars(page).locator('[data-run="v2-r4"] .bar')));
    const inTable = (await width(row(page, SWIFT, "v2-r6").locator(".bar"))) / (await width(row(page, SWIFT, "v2-r4").locator(".bar")));
    expect(inSection).toBeGreaterThan(1.9);
    expect(inSection).toBeLessThan(2.3);
    expect(Math.abs(inTable - inSection)).toBeLessThan(0.15);
    await expect(bars(page).locator(".sp-head")).toContainText("one scale: the longest story run, 25 min");
  });

  test("every part named and explained by the glossary, and each segment's hover explains it from the usage", async ({ page }) => {
    await open(page, "1");
    await expect(bars(page).locator("figcaption .legend")).toHaveText(["Prefill", "Generation", "Model, not split", "Compaction", "Tools", "Between sessions", "Other"]);
    await expect(bars(page).locator("figcaption .legend").first()).toHaveAttribute("data-tip", `Prefill: ${GLOSSARY.segPrefill.what}`);
    await expect(bars(page).locator('[data-run="v2-r1"] [data-seg="tools"]')).toHaveAttribute("data-tip", /^Tools .* min over 95 calls: .*the agent's tests 1\.0 \(end-to-end 1\.0\), other commands 0\.5 min$/);
    await expect(bars(page).locator('[data-run="v2-r4"] [data-seg="decode"]')).toHaveAttribute("data-tip", /^Generation \d+\.\d min: .* tokens at \d+ tok\/s$/);
  });

  test("the accounting check: a split that failed is flagged, an unchecked one says so", async ({ page }) => {
    await open(page, "1");
    await expect(bars(page).locator('[data-run="v2-r1"] .check-flag')).toHaveAttribute("data-tip", /tool call t9 never ended/);
    await expect(bars(page).locator('[data-run="run-9"] .check-unchecked')).toBeVisible();
    await expect(bars(page).locator('[data-run="v2-r4"] .check-flag, [data-run="v2-r4"] .check-unchecked')).toHaveCount(0);
  });

  test("story runs without a split are listed, with why", async ({ page }) => {
    await open(page, "1");
    await expect(bars(page).locator(`.sp-time-group[data-stack="${OPUS}"] .sp-time-without`)).toHaveText("No split: v2-r1 (recorded without one)");
    await expect(bars(page).locator(`.sp-time-group[data-stack="${MLX}"] .sp-time-without`)).toHaveText("No split: v2-r1 (being built)");
    await expect(row(page, OPUS, "v2-r1").locator("td.sp-bar .missing")).toHaveAttribute("data-tip", "No time split: The story's record has no usage.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("every link lands on its entity", () => {
  const follow = async (page: Page, link: Locator, pageName: string, text?: string) => {
    await link.click();
    await expect(page.locator(`[data-page="${pageName}"]`)).toBeVisible();
    if (text) await expect(page.locator(`[data-page="${pageName}"]`)).toContainText(text);
    await page.goBack();
    await expect(page$(page)).toBeVisible();
  };

  test("combination, run, story run and machine, from the table", async ({ page }) => {
    await open(page, "1");
    await follow(page, group(page, SWIFT).locator("tr.sp-group a.combination-link"), "combination", "v2-r5");
    await follow(page, row(page, SWIFT, "v2-r5").locator("a.run-link"), "run", "v2-r5");
    await follow(page, row(page, SWIFT, "v2-r5").locator("a.story-run-link"), "storyRun", "Story 1");
    await follow(page, row(page, SWIFT, "v2-r5").locator("a.machine-link"), "machine", "gruntus");
    await follow(page, group(page, SWIFT).locator('tr.sp-not-built [data-run="v2-r2"] a.run-link'), "run", "v2-r2");
  });

  test("combination, run, story run and machine, from the time bars", async ({ page }) => {
    await open(page, "1");
    const g = bars(page).locator(`.sp-time-group[data-stack="${SWIFT}"]`);
    await follow(page, g.locator(".sp-time-head a.combination-link"), "combination");
    await follow(page, g.locator('[data-run="v2-r6"] a.run-link'), "run", "v2-r6");
    await follow(page, g.locator('[data-run="v2-r6"] a.story-run-link'), "storyRun", "Story 1");
    await follow(page, g.locator('[data-run="v2-r6"] a.machine-link'), "machine", "gruntus");
  });

  test("the comparison note's run and machine", async ({ page }) => {
    await open(page, "2", cmpOf(SWIFT, "v2-r4"));
    const note = section(page, "combinations").locator(".compare-note");
    await follow(page, note.locator("a.run-link"), "run", "v2-r4");
    await follow(page, note.locator("a.machine-link"), "machine", "gruntus");
  });

  test("every link on the page is an entity page's address, and has a name", async ({ page }) => {
    await open(page, "2");
    const bad = await page$(page).locator("a").evaluateAll((as) => as
      .filter((a) => !/^#\/(vidi\/(c|r|s)\/|m\/|$)/.test(a.getAttribute("href") ?? "") || !(a.textContent ?? "").trim())
      .map((a) => a.outerHTML));
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("keyboard", () => {
  test("Tab goes from the breadcrumb into the story list, then the header's links", async ({ page }) => {
    await open(page, "2");
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Overview" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("1 Pan and zoom");
    await expect(page.locator(":focus")).toHaveCSS("outline-style", "solid");
    for (let i = 0; i < 11; i++) await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveClass(/tests-differ/);       // the header's note on differing counts, readable by keyboard
  });

  test("a story in the list opens with Enter", async ({ page }) => {
    await open(page, "2");
    await page.getByRole("navigation", { name: "Stories" }).locator('li[data-story="3"] a').focus();
    await page.keyboard.press("Enter");
    await expect(page$(page)).toHaveAttribute("data-story", "3");
  });

  test("set as comparison from the keyboard, with a visible focus ring", async ({ page }) => {
    await open(page, "2");
    const b = row(page, SWIFT, "v2-r4").getByRole("button", { name: /as comparison/ });
    await b.focus();
    await expect(b).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(row(page, SWIFT, "v2-r4")).toHaveAttribute("data-comparison", "true");
  });

  test("a flag's reason and a missing number's why can be read from the keyboard", async ({ page }) => {
    await open(page, "1");
    await cell(page, SWIFT, "v2-r6", "minutes").locator(".flag").focus();
    await expect(tip(page)).toContainText("above the combination's median agent time");
    await cell(page, OPUS, "run-9", "decodeTokS").locator(".missing").focus();
    await expect(tip(page)).toContainText("cloud model");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("at 1000 px", () => {
  test.use({ viewport: { width: 1000, height: 900 } });

  test("nothing overflows the page, the table needs no sideways scroll, and the story list sits above", async ({ page }) => {
    await open(page, "2", cmpOf(SWIFT, "v2-r4"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await section(page, "combinations").locator(".sp-table-wrap").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const list = await page.getByRole("navigation", { name: "Stories" }).boundingBox();
    const header = await section(page, "header").boundingBox();
    expect(list!.y + list!.height).toBeLessThanOrEqual(header!.y);
  });

  test("at 1440 px the story list is beside the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "2");
    const list = await page.getByRole("navigation", { name: "Stories" }).boundingBox();
    const header = await section(page, "header").boundingBox();
    expect(list!.x + list!.width).toBeLessThanOrEqual(header!.x);
    expect(await section(page, "combinations").locator(".sp-table-wrap").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("story links on other pages", () => {
  test("the combination matrix: each story's column heading opens the story page, keeping its title on hover", async ({ page }) => {
    await page.goto(`/#/vidi/c/${enc(SWIFT)}`);
    const th = page.locator('table.matrix thead th.m-story[data-story="2"]');
    await expect(th).toHaveAttribute("data-tip", /^Story 2: Sticky notes\. Opens the story's page/);
    await expect(th.locator("a.story-link")).toHaveAttribute("href", "#/vidi/s/2");
    await th.locator("a.story-link").click();
    await expect(page$(page)).toHaveAttribute("data-story", "2");
    // The cells still open their story runs.
    await page.goBack();
    await expect(page.locator('table.matrix tr[data-run="v2-r5"] td[data-story="2"] a.story-run-link')).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
  });

  test("the story run page: 'Around this story' links the story in every combination", async ({ page }) => {
    await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
    const nav = page.locator('[data-page="storyRun"] [data-section="nav"]');
    await expect(nav.locator('[data-row="story"] dt')).toHaveText("Story 2 in every combination");
    await nav.locator('[data-row="story"] a.story-link').click();
    await expect(page$(page)).toHaveAttribute("data-story", "2");
    await page.goBack();
    await expect(nav.locator('[data-row="siblings"] a.story-run-link').first()).toHaveAttribute("href", /\/s\/2$/);   // still the story runs
  });

  test("the run page: each story's row links to the story page beside its story-run link", async ({ page }) => {
    await page.goto(`/#/vidi/r/${enc(SWIFT)}/v2-r5`);
    const r = page.locator('[data-page="run"] [data-section="time"] .rp-bar-row[data-story="2"]');
    await expect(r.locator("a.story-run-link")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r5/s/2`);
    await expect(r.locator("a.story-link")).toHaveText("all runs");
    await r.locator("a.story-link").click();
    await expect(page$(page)).toHaveAttribute("data-story", "2");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("page state in the address, on other pages", () => {
  const show = (page: Page, metric: string) => page.getByRole("group", { name: "Show" }).getByRole("button", { name: metric, exact: true }).click();
  const combo = `/#/vidi/c/${enc(SWIFT)}`;

  test("combination page: the metric is in the address, and a reload keeps it", async ({ page }) => {
    await page.goto(combo);
    await show(page, "tool calls");
    await expect(page).toHaveURL(/\?metric=calls$/);
    await page.reload();
    await expect(page.locator("table.matrix")).toHaveAttribute("data-metric", "calls");
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button", { name: "tool calls", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("combination page: the back button comes back to the metric chosen", async ({ page }) => {
    await page.goto(combo);
    await show(page, "output tokens");
    await page.locator('table.matrix tr[data-run="v2-r5"] td[data-story="2"] a').click();
    await expect(page.locator('[data-page="storyRun"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator("table.matrix")).toHaveAttribute("data-metric", "outTokens");
  });

  test("combination page: the default metric leaves the address plain; an unknown one falls back to it", async ({ page }) => {
    await page.goto(`${combo}?metric=calls`);
    await show(page, "minutes");
    await expect(page).toHaveURL((u) => u.hash === `#/vidi/c/${enc(SWIFT)}`);
    await page.goto(`${combo}?metric=nonsense`);
    await expect(page.locator("table.matrix")).toHaveAttribute("data-metric", "minutes");
  });

  test("combination page: an address with a metric opens on it", async ({ page }) => {
    await page.goto(`${combo}?metric=heldOut`);
    await expect(page.locator("table.matrix")).toHaveAttribute("data-metric", "heldOut");
  });

  const run = `/#/vidi/r/${enc(SWIFT)}/v2-r5`;
  const compareSelect = (page: Page) => page.locator('[data-page="run"] [data-section="compare"] select');

  test("run page: the run compared with is in the address, and a reload keeps it", async ({ page }) => {
    await page.goto(run);
    await compareSelect(page).selectOption("v2-r6");
    await expect(page).toHaveURL(/\?compare=v2-r6$/);
    await page.reload();
    await expect(compareSelect(page)).toHaveValue("v2-r6");
    await expect(page.locator('[data-section="compare"] .compare-key')).toContainText("v2-r5 over v2-r6");
  });

  test("run page: the back button comes back to the run compared with", async ({ page }) => {
    await page.goto(run);
    await compareSelect(page).selectOption("v2-r7");
    await page.locator('[data-section="compare"] tr[data-story="2"] a.story-run-link').first().click();
    await expect(page.locator('[data-page="storyRun"]')).toBeVisible();
    await page.goBack();
    await expect(compareSelect(page)).toHaveValue("v2-r7");
  });

  test("run page: choosing no run is kept too; an address naming a run that isn't there says so", async ({ page }) => {
    await page.goto(run);
    await compareSelect(page).selectOption("");
    await expect(page).toHaveURL(/\?compare=none$/);
    await page.reload();
    await expect(page.locator('[data-section="compare"] .rp-empty')).toHaveText("Choose a run to compare with.");
    await page.goto(`${run}?compare=v9-nope`);
    await expect(page.locator('[data-section="compare"] .rp-empty')).toContainText("The address names v9-nope");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("tooltip, for keyboard users", () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test("Tab to something off screen: the browser scrolls it in, and its hover text shows beside it", async ({ page }) => {
    await page.goto(run());
    const target = page.locator('[data-page="run"] [data-section="cost"] [data-stat="prefillTokS"] .missing');
    await expect(target).toBeAttached();
    // Focus the tab stop just before it without scrolling, from the top of the page; then Tab, as a person would.
    await target.evaluate((el) => {
      const stops = [...document.querySelectorAll<HTMLElement>("a[href], button, select, [tabindex]")].filter((x) => x.tabIndex >= 0 && x.offsetParent !== null);
      stops[stops.indexOf(el as HTMLElement) - 1].focus({ preventScroll: true });
      scrollTo(0, 0);
    });
    expect(await target.evaluate((el) => el.getBoundingClientRect().top > innerHeight)).toBe(true);   // off screen
    await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);                                   // the browser scrolled
    await expect(tip(page)).toContainText("timed the model");
    const [t, el] = [await tip(page).boundingBox(), await target.boundingBox()];
    expect(t!.y).toBeGreaterThanOrEqual(0);
    expect(t!.y + t!.height).toBeLessThanOrEqual(600);
    expect(Math.min(Math.abs(t!.y - (el!.y + el!.height)), Math.abs(t!.y + t!.height - el!.y))).toBeLessThan(12);   // beside it
  });

  test("the tip follows its element through a scroll, and goes when the element leaves the screen", async ({ page }) => {
    await page.goto(run());
    const target = page.locator('[data-page="run"] .breadcrumb a.combination-link');
    await target.focus();
    await expect(tip(page)).toBeVisible();
    const before = (await tip(page).boundingBox())!.y;
    await page.evaluate(() => { document.documentElement.style.minHeight = "4000px"; scrollBy(0, 30); });
    await expect.poll(async () => before - (await tip(page).boundingBox())!.y).toBeGreaterThan(20);
    await page.evaluate(() => scrollBy(0, 2000));
    await expect(tip(page)).toBeHidden();
  });

  test("a hover still closes when the pointer leaves", async ({ page }) => {
    await open(page, "1");
    await cell(page, SWIFT, "v2-r6", "minutes").locator(".flag").hover();
    await expect(tip(page)).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(tip(page)).toBeHidden();
  });

  function run() { return `/#/vidi/r/${enc(SWIFT)}/v2-r5`; }
});
