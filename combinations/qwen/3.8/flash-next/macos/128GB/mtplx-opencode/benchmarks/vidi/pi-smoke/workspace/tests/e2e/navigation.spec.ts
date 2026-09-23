import { test, expect } from "@playwright/test";
import {
  originCentre,
  zoomLabel,
  setCamera,
  readCamera,
  readGridSpacingPx,
  ctrlWheel,
} from "./helpers/board";


test("TC-28 hint shows on first visit and is gone after one drag", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("navigation-hint")).toBeVisible();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("navigation-hint")).toHaveCount(0);
});

test("TC-23 mouse drag moves the board by exactly the pointer delta", async ({ page }) => {
  await page.goto("/");
  const before = await originCentre(page);
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 10 });
  await page.mouse.up();
  const after = await originCentre(page);
  expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
});

test("TC-24 + TC-31 Ctrl+wheel zooms around the pointer without page zoom", async ({
  page,
}) => {
  await page.goto("/");
  const dot = await originCentre(page);
  const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  const dprBefore = await page.evaluate(() => window.devicePixelRatio);
  const zoomBefore = (await readCamera(page)).zoom;
  // Pointer exactly over the origin crosshair.
  await ctrlWheel(page, Math.round(dot.x), Math.round(dot.y), -300);
  const cam = await readCamera(page);
  expect(cam.zoom).toBeGreaterThan(zoomBefore);
  const dot2 = await originCentre(page);
  expect(Math.abs(dot2.x - dot.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(dot2.y - dot.y)).toBeLessThanOrEqual(1);
  // Keyboard zoom shortcuts also must not touch page zoom (TC-31).
  await page.keyboard.down("Control");
  await page.keyboard.press("=");
  await page.keyboard.press("-");
  await page.keyboard.press("0");
  await page.keyboard.up("Control");
  const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  const dprAfter = await page.evaluate(() => window.devicePixelRatio);
  expect(scaleAfter).toBeCloseTo(scaleBefore, 5);
  expect(dprAfter).toBe(dprBefore);
});

test("TC-25 zoom-in clicks stop at 400% with the button disabled", async ({ page }) => {
  await page.goto("/");
  const plus = page.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 30; i++) {
    if (await plus.isDisabled()) break;
    await plus.click();
  }
  await expect(plus).toBeDisabled();
  expect(await zoomLabel(page)).toBe("400%");
});

test("TC-26 Reset view returns to 100% centred after a far jump", async ({ page }) => {
  await page.goto("/");
  await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 4 });
  await page.getByRole("button", { name: "Reset view" }).click();
  expect(await zoomLabel(page)).toBe("100%");
  const box = await originCentre(page);
  const size = page.viewportSize()!;
  expect(Math.abs(box.x - size.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - size.height / 2)).toBeLessThanOrEqual(1);
});

test("TC-27 far travel still pans exactly and keeps even grid spacing", async ({ page }) => {
  await page.goto("/");
  await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 2 });
  // Grid spacing stays GRID_SPACING_WORLD (24) * zoom (2) = 48px.
  expect(Math.abs((await readGridSpacingPx(page)) - 48)).toBeLessThanOrEqual(0.5);
  const camBefore = await readCamera(page);
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 10 });
  await page.mouse.up();
  const cam = await readCamera(page);
  // 200px right, 100px down at zoom 2 => camera shifts (-100, -50) world units.
  expect(Math.abs(cam.x - (camBefore.x - 100))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(cam.y - (camBefore.y - 50))).toBeLessThanOrEqual(0.5);
});
