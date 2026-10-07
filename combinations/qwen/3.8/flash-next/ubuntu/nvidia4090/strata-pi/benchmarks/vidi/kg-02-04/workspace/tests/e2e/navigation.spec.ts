import { expect, test } from "@playwright/test";
import {
  GRID_SPACING_WORLD,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from "../../src/shared/config";
import { NAVIGATION_HINT_TEXT } from "../../src/client/canvas/NavigationHint";
import * as board from "./helpers/board";

const PIXEL_TOLERANCE = 1;

function within(value: number, target: number, tolerance = PIXEL_TOLERANCE) {
  return Math.abs(value - target) <= tolerance;
}

test.describe("workflow 1: first visit navigation", () => {
  test("TC-28 hint, TC-23 drag pans exactly, TC-24 zoom keeps the dot under the pointer", async ({
    page,
  }) => {
    await board.openBoard(page);

    // TC-28: the first-use hint is shown.
    const hint = page.getByTestId("navigation-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(NAVIGATION_HINT_TEXT);

    const centre = await board.boardCentre(page);
    const before = await board.originMarkerCentre(page);
    const metricsBefore = await board.gridMetrics(page);
    expect(metricsBefore.spacing).toBeCloseTo(GRID_SPACING_WORLD, 2);

    // TC-23: a 200 x 100 pixel drag moves the board by exactly that much.
    await board.dragBoard(page, centre, 200, 100);
    const after = await board.originMarkerCentre(page);
    expect(within(after.x - before.x, 200)).toBe(true);
    expect(within(after.y - before.y, 100)).toBe(true);

    // The dot grid moved with the board: the same dot is now under the pointer.
    const metricsAfterDrag = await board.gridMetrics(page);
    expect(
      within(
        metricsAfterDrag.offsetX,
        board.expectedGridOffset(metricsBefore.offsetX, 200, metricsBefore.spacing),
      ),
    ).toBe(true);
    expect(
      within(
        metricsAfterDrag.offsetY,
        board.expectedGridOffset(metricsBefore.offsetY, 100, metricsBefore.spacing),
      ),
    ).toBe(true);

    // TC-28: the hint is gone for the rest of the visit.
    await expect(hint).toHaveCount(0);
    await board.dragBoard(page, centre, -60, -30);
    await expect(hint).toHaveCount(0);

    // TC-24: Ctrl/Cmd + wheel zooms around the pointer; the dot stays under it.
    const metrics = await board.gridMetrics(page);
    const dot = board.nearestDot(metrics, centre.x, centre.y);
    const zoomBefore = await board.zoomLabel(page);

    await board.ctrlWheel(page, dot, -100);
    await expect
      .poll(async () => board.zoomLabel(page))
      .toBeGreaterThan(zoomBefore);
    const zoomed = await board.gridMetrics(page);
    const offset = board.distanceToNearestDot(zoomed, dot.x, dot.y);
    expect(offset.x).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(offset.y).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // Zoom back out: the same dot is still under the pointer.
    await board.ctrlWheel(page, dot, 100);
    const zoomedOut = await board.gridMetrics(page);
    const back = board.distanceToNearestDot(zoomedOut, dot.x, dot.y);
    expect(back.x).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(back.y).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // Board zoom gestures never zoom the page.
    const zoomState = await board.pageZoomState(page);
    expect(zoomState.scale).toBeCloseTo(1, 6);
  });
});

test.describe("workflow 2: limits and recovery", () => {
  test("TC-25: zooming in with + stops at 400% and disables the button", async ({ page }) => {
    await board.openBoard(page);

    const plus = page.getByTestId("zoom-in");
    const minus = page.getByTestId("zoom-out");
    const labels: number[] = [];

    for (let i = 0; i < 15; i += 1) {
      const current = await board.zoomLabel(page);
      labels.push(current);
      if (await plus.isDisabled()) break;
      await plus.click();
      // Wait for the rendered zoom to settle before acting again.
      await expect
        .poll(async () => board.zoomLabel(page), { timeout: 3000 })
        .not.toBe(current);
    }
    labels.push(await board.zoomLabel(page));

    expect(labels[0]).toBe(PERCENT);
    expect(labels[1]).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));
    expect(labels.at(-1)).toBe(Math.round(ZOOM_MAX * PERCENT));
    await expect(plus).toBeDisabled();
    await expect(minus).toBeEnabled();

    // Zooming back out re-enables the + button.
    await minus.click();
    await expect(plus).toBeEnabled();
    await expect(page.getByTestId("zoom-label")).toHaveText(
      `${Math.round(ZOOM_MAX / ZOOM_STEP_FACTOR * PERCENT)}%`,
    );
  });

  test("TC-26: Reset view returns to 100% centred on the board start point", async ({ page }) => {
    await board.openBoard(page);

    await board.setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(page.getByTestId("zoom-label")).toHaveText(
      `${Math.round(ZOOM_MAX * PERCENT)}%`,
    );

    await page.getByTestId("zoom-reset").click();

    await expect(page.getByTestId("zoom-label")).toHaveText(`${PERCENT}%`);
    const centre = await board.boardCentre(page);
    const marker = await board.originMarkerCentre(page);
    expect(within(marker.x, centre.x)).toBe(true);
    expect(within(marker.y, centre.y)).toBe(true);
  });

  test("TC-26b: Ctrl/Cmd + 0 resets the same way as the button", async ({ page }) => {
    await board.openBoard(page);
    await board.setCamera(page, { x: 12_345, y: -6_789, zoom: 2.5 });
    await page.keyboard.press("Control+0");
    await expect(page.getByTestId("zoom-label")).toHaveText(`${PERCENT}%`);
    const centre = await board.boardCentre(page);
    const marker = await board.originMarkerCentre(page);
    expect(within(marker.x, centre.x)).toBe(true);
    expect(within(marker.y, centre.y)).toBe(true);
  });
});

test.describe("workflow 3: far travel", () => {
  test("TC-27: at 1,000,000 board units the grid still pans exactly", async ({ page }) => {
    await board.openBoard(page);

    await board.setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const centre = await board.boardCentre(page);
    const before = await board.gridMetrics(page);
    expect(before.spacing).toBeCloseTo(GRID_SPACING_WORLD, 2);
    const dot = board.nearestDot(before, centre.x, centre.y);

    await board.dragBoard(page, centre, 200, 100);

    const camera = await board.readCamera(page);
    expect(Math.abs(camera.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200))).toBeLessThan(1e-6);
    expect(Math.abs(camera.y - (-UNBOUNDED_PAN_TESTED_EXTENT - 100))).toBeLessThan(1e-6);

    const after = await board.gridMetrics(page);
    expect(after.spacing).toBeCloseTo(GRID_SPACING_WORLD * camera.zoom, 2);
    expect(within(after.offsetX, board.expectedGridOffset(before.offsetX, 200, before.spacing))).toBe(
      true,
    );
    expect(within(after.offsetY, board.expectedGridOffset(before.offsetY, 100, before.spacing))).toBe(
      true,
    );
    // The dot that was under the pointer is now exactly where the pointer moved.
    const offset = board.distanceToNearestDot(after, dot.x + 200, dot.y + 100);
    expect(offset.x).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(offset.y).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test("TC-27b: far away at ZOOM_MAX the grid spacing and the drag stay exact", async ({ page }) => {
    await board.openBoard(page);
    await board.setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });

    const centre = await board.boardCentre(page);
    const before = await board.gridMetrics(page);
    expect(before.spacing).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_MAX, 2);

    await board.dragBoard(page, centre, 200, 100);
    const camera = await board.readCamera(page);
    expect(Math.abs(camera.x - (-UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX))).toBeLessThan(1e-6);
    expect(Math.abs(camera.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX))).toBeLessThan(1e-6);

    const after = await board.gridMetrics(page);
    expect(after.spacing).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_MAX, 2);
  });

  test("TC-27c: Reset view works from the far extreme too", async ({ page }) => {
    await board.openBoard(page);
    await board.setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MIN,
    });
    await page.getByTestId("zoom-reset").click();
    await expect(page.getByTestId("zoom-label")).toHaveText(`${PERCENT}%`);
    const centre = await board.boardCentre(page);
    const marker = await board.originMarkerCentre(page);
    expect(within(marker.x, centre.x)).toBe(true);
    expect(within(marker.y, centre.y)).toBe(true);
  });
});

test.describe("board viewport and page independence", () => {
  test("TC-30: the board fills the window at every zoom level and window size", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await board.openBoard(page);

    const viewport = page.viewportSize() ?? { width: 1024, height: 768 };
    expect(viewport.width).toBe(1024);
    expect(viewport.height).toBe(768);

    let box = await board.boardBox(page);
    expect(box.width).toBeCloseTo(viewport.width, 1);
    expect(box.height).toBeCloseTo(viewport.height, 1);
    // No scrollbars: the document is exactly the viewport.
    const doc = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.width);
    expect(doc.scrollHeight).toBeLessThanOrEqual(doc.height);

    for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX]) {
      await board.setCamera(page, { x: 0, y: 0, zoom });
      box = await board.boardBox(page);
      expect(box.width).toBeCloseTo(viewport.width, 1);
      expect(box.height).toBeCloseTo(viewport.height, 1);
    }

    // Resizing the window leaves the camera untouched (TC-07) and the board
    // still fills the window.
    const cameraBefore = await board.readCamera(page);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(async () => board.readCamera(page)).toEqual(cameraBefore);
    box = await board.boardBox(page);
    expect(box.width).toBeCloseTo(800, 1);
    expect(box.height).toBeCloseTo(600, 1);
  });
});

test.describe("board gestures do not zoom the page", () => {
  test("TC-31: Ctrl/Cmd wheel and Ctrl/Cmd = - 0 leave page zoom untouched", async ({ page }) => {
    await board.openBoard(page);

    const before = await board.pageZoomState(page);
    const labelBoxBefore = await page.getByTestId("zoom-label").boundingBox();
    const buttonBoxBefore = await page.getByTestId("zoom-in").boundingBox();
    expect(labelBoxBefore).toBeTruthy();
    expect(buttonBoxBefore).toBeTruthy();

    const centre = await board.boardCentre(page);
    await board.ctrlWheel(page, centre, -60);
    await expect
      .poll(async () => board.zoomLabel(page), { timeout: 3000 })
      .toBeGreaterThan(PERCENT);
    expect(await board.zoomLabel(page)).toBeLessThan(Math.round(ZOOM_MAX * PERCENT));

    await page.keyboard.press("Control+0");
    await expect(page.getByTestId("zoom-label")).toHaveText(`${PERCENT}%`);

    await page.keyboard.press("Control+=");
    await expect(page.getByTestId("zoom-label")).toHaveText(
      `${Math.round(ZOOM_STEP_FACTOR * PERCENT)}%`,
    );
    await page.keyboard.press("Control+-");
    await page.keyboard.press("Meta+=");
    await expect(page.getByTestId("zoom-label")).toHaveText(
      `${Math.round(ZOOM_STEP_FACTOR * PERCENT)}%`,
    );
    await page.keyboard.press("Control+0");

    // Board content scale was changed by the gestures, then reset again.
    const camera = await board.readCamera(page);
    expect(camera.zoom).toBe(1);
    await expect(page.getByTestId("zoom-label")).toHaveText(`${PERCENT}%`);

    const after = await board.pageZoomState(page);
    expect(after.scale).toBeCloseTo(before.scale, 6);
    expect(after.devicePixelRatio).toBeCloseTo(before.devicePixelRatio, 6);
    expect(after.innerWidth).toBe(before.innerWidth);
    expect(after.innerHeight).toBe(before.innerHeight);

    // Page text (the control label and buttons) keeps its normal size.
    const labelBoxAfter = await page.getByTestId("zoom-label").boundingBox();
    const buttonBoxAfter = await page.getByTestId("zoom-in").boundingBox();
    expect(labelBoxAfter?.height).toBeCloseTo(labelBoxBefore?.height ?? 0, 3);
    expect(labelBoxAfter?.width).toBeCloseTo(labelBoxBefore?.width ?? 0, 3);
    expect(buttonBoxAfter?.height).toBeCloseTo(buttonBoxBefore?.height ?? 0, 3);
  });

  test("plain wheel over the board pans it and never scrolls the page", async ({ page }) => {
    await board.openBoard(page);
    const before = await board.originMarkerCentre(page);

    const centre = await board.boardCentre(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(async () => {
        const marker = await board.originMarkerCentre(page);
        return marker.y;
      })
      .toBeLessThan(before.y);

    const scroll = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      scale: window.visualViewport ? window.visualViewport.scale : 1,
    }));
    expect(scroll.x).toBe(0);
    expect(scroll.y).toBe(0);
    expect(scroll.scale).toBeCloseTo(1, 6);
  });
});
