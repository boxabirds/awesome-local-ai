// Story 1 e2e: golden-path navigation, zoom limits and recovery, far travel, and
// the guarantee that board gestures never zoom the web page.
import { expect, test } from "@playwright/test";

import {
  GRID_SPACING_WORLD,
  NAVIGATION_HINT_TEXT,
  PERCENT,
  ZOOM_MAX,
} from "../../src/shared/config";
import {
  ctrlWheel,
  dragBoard,
  expectedGridSpacingPx,
  farAwayCamera,
  gridSpacingPx,
  hint,
  openBoard,
  originPoint,
  pageZoomMetrics,
  readCamera,
  resetButton,
  setCamera,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from "./helpers/board";

/** A screen point that sits exactly on a grid dot in the initial view. */
const ON_A_DOT = { x: 304, y: 328 };

test.describe("workflow 1: first visit navigation", () => {
  // TC-28
  test("shows the navigation hint and hides it after the first pan", async ({
    page,
  }) => {
    await openBoard(page);
    await expect(hint(page)).toBeVisible();
    expect((await hint(page).textContent())?.trim()).toBe(NAVIGATION_HINT_TEXT);

    await dragBoard(page, 40, 20);
    await expect(hint(page)).toHaveCount(0);

    // Further navigation does not bring it back during this visit.
    await ctrlWheel(page, -120);
    await dragBoard(page, -40, -20);
    await expect(hint(page)).toHaveCount(0);
  });

  // TC-23
  test("dragging 200x100 pixels moves the board exactly 200x100 pixels", async ({
    page,
  }) => {
    await openBoard(page);
    const before = await originPoint(page);

    await dragBoard(page, 200, 100, ON_A_DOT);

    const after = await originPoint(page);
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
    // Panning does not change the zoom.
    expect((await readCamera(page)).zoom).toBeCloseTo(1, 6);
    await expect(hint(page)).toHaveCount(0);
  });

  // TC-24
  test("Ctrl + wheel keeps the grid dot under the pointer", async ({
    page,
  }) => {
    await openBoard(page);
    const dot = await originPoint(page);
    await page.mouse.move(dot.x, dot.y);

    await ctrlWheel(page, -240);
    await expect(zoomLabel(page)).not.toHaveText("100%");
    let after = await originPoint(page);
    expect(Math.abs(after.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - dot.y)).toBeLessThanOrEqual(1);

    // Zoom back out: the dot is still under the pointer.
    await ctrlWheel(page, 240);
    after = await originPoint(page);
    expect(Math.abs(after.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - dot.y)).toBeLessThanOrEqual(1);
  });

  // TC-31 (page zoom must not change; asserted alongside the same gestures)
  test("board gestures leave the browser page zoom alone", async ({ page }) => {
    await openBoard(page);
    const before = await pageZoomMetrics(page);
    expect(before.scale).toBeCloseTo(1, 6);

    const dot = await originPoint(page);
    await page.mouse.move(dot.x, dot.y);
    await ctrlWheel(page, -240);
    await ctrlWheel(page, 240);

    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+-");
    await page.keyboard.press("Control+0");

    // Only the board scaled; the page did not.
    expect(await pageZoomMetrics(page)).toEqual(before);
  });
});

test.describe("workflow 2: limits and recovery", () => {
  // TC-25
  test("zooming in stops at 400% and disables the button", async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText("100%");

    for (let i = 0; i < 12; i += 1) {
      if (await zoomInButton(page).isDisabled()) break;
      await zoomInButton(page).click();
    }

    const maximum = `${Math.round(ZOOM_MAX * PERCENT)}%`;
    await expect(zoomLabel(page)).toHaveText(maximum);
    expect(await zoomInButton(page).isDisabled()).toBe(true);
    expect(await zoomOutButton(page).isDisabled()).toBe(false);

    // Zooming back out re-enables Zoom in.
    await zoomOutButton(page).click();
    await expect(zoomLabel(page)).not.toHaveText(maximum);
    expect(await zoomInButton(page).isDisabled()).toBe(false);
  });

  test("zooming out stops at 10% and disables the button", async ({ page }) => {
    await openBoard(page);
    for (let i = 0; i < 20; i += 1) {
      if (await zoomOutButton(page).isDisabled()) break;
      await zoomOutButton(page).click();
    }
    await expect(zoomLabel(page)).toHaveText("10%");
    expect(await zoomOutButton(page).isDisabled()).toBe(true);
    expect(await zoomInButton(page).isDisabled()).toBe(false);
  });

  // TC-26
  test("Reset view returns to 100% centred from far away and fully zoomed in", async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, farAwayCamera(ZOOM_MAX));

    await resetButton(page).click();

    await expect(zoomLabel(page)).toHaveText("100%");
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    const centre = { x: size.width / 2, y: size.height / 2 };
    const origin = await originPoint(page);
    expect(Math.abs(origin.x - centre.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - centre.y)).toBeLessThanOrEqual(1);
    const camera = await readCamera(page);
    expect(camera.zoom).toBeCloseTo(1, 6);
    expect(camera.x).toBeCloseTo(-centre.x, 1);
    expect(camera.y).toBeCloseTo(-centre.y, 1);
  });
});

test.describe("workflow 3: far travel", () => {
  // TC-27
  test("a million units from the start the grid is even and panning is exact", async ({
    page,
  }) => {
    await openBoard(page);
    const zoom = 1;
    await setCamera(page, farAwayCamera(zoom));

    expect(await gridSpacingPx(page)).toBeCloseTo(
      expectedGridSpacingPx(zoom),
      1,
    );
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * zoom, 1);

    const before = await originPoint(page);
    await dragBoard(page, 200, 100, ON_A_DOT);
    const after = await originPoint(page);

    // The board follows the pointer exactly even this far out.
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * zoom, 1);
  });
});

test.describe("board-owned gestures", () => {
  test("the board owns the wheel: the page never scrolls", async ({ page }) => {
    await openBoard(page);
    const before = await originPoint(page);

    await page.mouse.move(ON_A_DOT.x, ON_A_DOT.y);
    await page.mouse.wheel(0, 120);

    await expect
      .poll(() => originPoint(page).then((p) => p.y), { timeout: 5_000 })
      .toBeCloseTo(before.y - 120, 0);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual(
      [0, 0],
    );
  });
});
