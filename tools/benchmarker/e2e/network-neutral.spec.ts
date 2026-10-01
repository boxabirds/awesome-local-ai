import { expect, test, type Page } from "@playwright/test";

// The app needs each machine reachable by a name or address on a network the user trusts; which product provides
// that network is not its business. The Setup page and the Add-a-machine form (text, placeholders, hovers) name none.
// The names are put together here so that a search of the app's own files for them finds nothing.
const PRODUCT_NAMES = [["tail", "scale"], ["tail", "net"], ["magic", "dns"]].map((parts) => parts.join(""));
const NETWORK_PRODUCT = new RegExp(PRODUCT_NAMES.join("|"), "i");
/** The address range one such product hands out, as the page used to write it. */
const PRODUCT_ADDRESS = /100\.x\.y\.z/;

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/test/reset");
  await page.goto("/");
});

test("the Setup page names no network product, and still says what the network must do", async ({ page }) => {
  await tab(page, "Setup").click();
  const setup = page.locator("article.setup");
  await expect(setup.locator("h1")).toHaveText("Make a machine a benchmark node");
  const html = await setup.evaluate((el) => el.outerHTML);
  expect(html).not.toMatch(NETWORK_PRODUCT);
  expect(html).not.toMatch(PRODUCT_ADDRESS);
  // What is required, in neutral terms: reachable on a private network you trust; bound to that address, never a public one.
  await expect(setup).toContainText("private network you trust");
  await expect(setup.locator("table.access")).toContainText("Reachable from this Mac by name or address");
  await expect(setup.locator("table.access")).toContainText("SSH to the node");
  await expect(setup.locator("ol.steps-list > li")).toHaveCount(6);
  await expect(setup.locator("ol.steps-list")).toContainText("never a public one");
  await expect(setup.locator("ol.steps-list pre")).toContainText("--bind <node-address>:7717");
});

test("the Add-a-machine form names no network product", async ({ page }) => {
  await tab(page, "Machines").click();
  const add = page.getByRole("form", { name: "Add a machine" });
  await expect(add).toBeVisible();
  const html = await add.evaluate((el) => el.outerHTML);
  expect(html).not.toMatch(NETWORK_PRODUCT);
  await expect(add.getByLabel("Machine name")).toHaveAttribute("placeholder", "its name on your network, e.g. node-a");
});
