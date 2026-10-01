import { expect, test } from "@playwright/test";

// The "live" chip is gone: no page tags a figure with it, so a finished run never reads as a live feed. Swept over
// one page of each kind, finished and running, on the fixture's data.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;
const runHref = (stack: string, run: string) => `#/vidi/r/${enc(stack)}/${enc(run)}`;
const PAGES: [string, string][] = [
  ["overview", "#/"],
  ["combination", `#/vidi/c/${enc(SWIFT)}`],
  ["finished run", runHref(SWIFT, "v2-r5")],
  ["running run", runHref(SWIFT, "v2-r1")],
  ["story", "#/vidi/s/3"],
  ["story (another)", "#/vidi/s/2"],
  ["finished story run", `${runHref(SWIFT, "v2-r5")}/s/2`],
  ["running story run", `${runHref(SWIFT, "v2-r1")}/s/3`],
  ["machine", "#/m/node-a"],
];

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

for (const [name, href] of PAGES) {
  test(`${name}: no live chip anywhere`, async ({ page }) => {
    await page.goto(`/${href}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main *").first()).toBeVisible();
    await expect(page.locator(".tag-live, .live-badge")).toHaveCount(0);
    // No element whose own text is just the word "live" (a chip), whatever its class.
    const chips = await page.locator("main *").evaluateAll((els) =>
      els.filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && /^\s*live\s*$/i.test(n.textContent ?? ""))).map((e) => e.outerHTML.slice(0, 120)));
    expect(chips).toEqual([]);
  });
}
