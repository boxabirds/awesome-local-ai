import { expect, test } from "@playwright/test";

// The header's search (shared/search.ts, SearchBox.tsx): / focuses it, results come back live, grouped by section
// (Combinations, Runs, Stories, Machines) and ranked inside each, with the matched text bold in context.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const enc = encodeURIComponent;

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/test/reset");
  await page.goto("/");
  await expect(page.locator("section").first()).toBeVisible();
});

test("/ focuses search from anywhere on the page", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search" });
  await expect(search).not.toBeFocused();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
});

test("/ does not steal focus from another field", async ({ page }) => {
  const pack = page.getByLabel("Pack");
  await pack.focus();
  await page.keyboard.press("/");
  await expect(pack).toBeFocused();
});

test("results come back live, grouped by section, bold on the matched text, in context", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("swift");
  const results = page.locator("#search-results");
  await expect(results).toBeVisible();
  const sections = results.locator(".search-section");
  await expect(sections).toContainText(["Combinations", "Runs", "Machines"]); // nothing in Stories matches "swift"
  const combo = results.locator(".search-group").first();
  await expect(combo.locator("mark").first()).toHaveText("swift");
  await expect(combo.getByRole("option").first().locator(".r-sub")).toContainText("vidi"); // context: the pack
});

test("clicking a result opens it and clears the search", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("v2-r1");
  await page.locator("#search-results").getByRole("option", { name: /^v2-r1/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/vidi/r/${enc(SWIFT).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/v2-r1`));
  await expect(search).toHaveValue("");
});

test("arrow keys move the selection, Enter opens it", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("node-a");
  const options = page.locator("#search-results").getByRole("option");
  const first = options.first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(first).toHaveAttribute("aria-selected", "false");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  const href = await options.nth(1).getAttribute("href");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));   // the row's own link, followed
  await expect(page.locator("#search-results")).toBeHidden();
});

test("Escape closes the results without navigating", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("swift");
  await expect(page.locator("#search-results")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#search-results")).toBeHidden();
});

test("a query that matches nothing says so", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("nonexistent-xyz-query");
  await expect(page.locator(".search-empty")).toContainText("Nothing matches");
});

test("finds a combination outside the pack currently chosen on screen", async ({ page }) => {
  await page.getByLabel("Pack").selectOption("vidi"); // ensure a specific pack is chosen, not "all"
  const search = page.getByRole("combobox", { name: "Search" });
  await search.fill("opus");
  await expect(page.locator("#search-results").getByRole("option", { name: /opus/i }).first()).toBeVisible();
});
