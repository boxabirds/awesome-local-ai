import { expect, test, type Page } from "@playwright/test";

// No one reading a figure cares how it was calculated. The app shows each figure under a plain label and says
// nothing about its source: not that it was re-scored, which build or suite version it came from, whether it is
// "of record", or that a live figure's record arrives later (the run's status says it is not final). Swept over one
// page of each kind, in the visible text and in every hover.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const VK = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const enc = encodeURIComponent;
const runHref = (stack: string, run: string) => `#/vidi/r/${enc(stack)}/${enc(run)}`;

const PAGES: [string, string][] = [
  ["overview", "#/"],
  ["combination", `#/vidi/c/${enc(SWIFT)}`],
  ["combination (no finished score)", `#/vidi/c/${enc(VK)}`],
  ["combination (cloud model)", `#/vidi/c/${enc(OPUS)}`],
  ["finished run", runHref(SWIFT, "v2-r5")],
  ["running run", runHref(SWIFT, "v2-r1")],
  ["run with no score", runHref(VK, "v2-r1")],
  ["story", "#/vidi/s/3"],
  ["story (another)", "#/vidi/s/2"],
  ["finished story run", `${runHref(SWIFT, "v2-r5")}/s/2`],
  ["running story run", `${runHref(SWIFT, "v2-r1")}/s/3`],
  ["machine", "#/m/node-a"],
];

const METHOD_WORDS = /re-?scor|of record|latest build|provisional|live figures|record arrives|suite version|current suite|whole suite so far, live|under the current|count calls and tokens|^live\b|\blive:|latest-build|arrives|no LLM|event log|\d recorded stor|re-?scor/im;

async function everything(page: Page): Promise<string> {
  const text = await page.locator("main").innerText();
  const tips = await page.locator("main [data-tip]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""));
  const labels = await page.locator("main [aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return [text, ...tips, ...labels].join("\n");
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

for (const [name, href] of PAGES) {
  test(`${name}: nothing about how a figure was calculated`, async ({ page }) => {
    await page.goto(`/${href}`);
    await expect(page.locator("main *").first()).toBeVisible();
    await page.waitForTimeout(300);
    const all = await everything(page);
    expect(all.match(new RegExp(METHOD_WORDS.source, "gim")) ?? []).toEqual([]);
  });
}

test("glossary: no entry explains a method", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.locator("main *").first()).toBeVisible();
  const { GLOSSARY } = await import("../shared/glossary.ts");
  const bad = Object.entries(GLOSSARY).filter(([, g]) => METHOD_WORDS.test(g.what) || METHOD_WORDS.test(g.name)).map(([k]) => k);
  expect(bad).toEqual([]);
});
