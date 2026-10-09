import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  PERCENT_PER_ZOOM,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  VIEWPORT_CENTRE,
  VIEWPORT_SIZE,
  clickZoom,
  ctrlWheel,
  gotoBoard,
  dragBoard,
  expectClose,
  gridPositionPx,
  gridSpacingPx,
  hintCount,
  markerRect,
  pressShortcut,
  readCamera,
  settle,
  setCameraFarAway,
  setCameraToMaxZoom,
  stepToMaxZoom,
  zoomLabel,
  zoomLadder,
} from './helpers/board';

test('workflow 1 - first visit: hint, drag, then zoom around the pointer', async ({
  page,
}) => {
  await gotoBoard(page);

  // TC-28: the hint is there when the board opens.
  const hint = page.locator('[data-testid="navigation-hint"]');
  await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%');

  // TC-23: dragging 200 right and 100 down moves the starting point exactly that far.
  const beforeDrag = await markerRect(page);
  const spacingBefore = await gridSpacingPx(page);
  expectClose(spacingBefore, GRID_SPACING_WORLD);
  const gridBefore = await gridPositionPx(page);
  await dragBoard(page, { x: 400, y: 300 }, { x: 600, y: 400 });
  const afterDrag = await markerRect(page);
  expectClose(afterDrag.centerX, beforeDrag.centerX + 200);
  expectClose(afterDrag.centerY, beforeDrag.centerY + 100);

  // The dot grid moved with it: the grid's own offset repeats every spacing.
  const gridAfter = await gridPositionPx(page);
  const dotDelta = (after: number, before: number, spacing: number): number => {
    const raw = ((after - before) % spacing + spacing) % spacing;
    return Math.min(raw, spacing - raw);
  };
  expect(Math.max(dotDelta(gridAfter.x, gridBefore.x, spacingBefore) - (200 % spacingBefore), (200 % spacingBefore) - dotDelta(gridAfter.x, gridBefore.x, spacingBefore))).toBeLessThanOrEqual(1);
  expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD, 6);

  // TC-28 continued: the hint is gone for the rest of the visit.
  await expect(hint).toHaveCount(0);

  // TC-24: Ctrl + wheel (the event a trackpad pinch produces) keeps the spot under the
  // pointer in place, and the browser's page zoom never changes.
  const pointer = { x: 700, y: 300 };
  const cameraBefore = await readCamera(page);
  const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await ctrlWheel(page, -240, pointer);
  await expect
    .poll(async () => (await readCamera(page)).zoom, { timeout: 5000 })
    .toBeGreaterThan(cameraBefore.zoom);
  const cameraZoomed = await readCamera(page);
  const worldUnderPointer = {
    x: pointer.x / cameraBefore.zoom + cameraBefore.x,
    y: pointer.y / cameraBefore.zoom + cameraBefore.y,
  };
  const drawnAfter = {
    x: (worldUnderPointer.x - cameraZoomed.x) * cameraZoomed.zoom,
    y: (worldUnderPointer.y - cameraZoomed.y) * cameraZoomed.zoom,
  };
  expectClose(drawnAfter.x, pointer.x);
  expectClose(drawnAfter.y, pointer.y);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(scaleBefore);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // Zooming back out puts the same spot under the pointer again.
  await ctrlWheel(page, 240, pointer);
  await expect
    .poll(async () => (await readCamera(page)).zoom, { timeout: 5000 })
    .toBeLessThan(cameraZoomed.zoom);
  const cameraOut = await readCamera(page);
  const drawnOut = {
    x: (worldUnderPointer.x - cameraOut.x) * cameraOut.zoom,
    y: (worldUnderPointer.y - cameraOut.y) * cameraOut.zoom,
  };
  expectClose(drawnOut.x, pointer.x);
  expectClose(drawnOut.y, pointer.y);
  await expect(hint).toHaveCount(0);
});

test('workflow 2 - limits and recovery: zoom to the maximum, then Reset view', async ({
  page,
}) => {
  await gotoBoard(page);
  const zoomIn = page.locator('[data-testid="zoom-in"]');
  const zoomOut = page.locator('[data-testid="zoom-out"]');
  await expect(zoomOut).toBeEnabled();

  // TC-25: the label climbs one step at a time and stops at 400%, + becomes disabled.
  const ladder = zoomLadder();
  for (const [index, zoom] of ladder.entries()) {
    await clickZoom(page, 'in', zoom);
    const percent = Number.parseInt(await zoomLabel(page), 10);
    expect(percent).toBe(Math.round(zoom * PERCENT_PER_ZOOM));
    if (index === 0) {
      // TC-21 through the real app: one step up from 100% is 125%.
      expect(percent).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT_PER_ZOOM));
    }
  }
  expect(ladder[ladder.length - 1]).toBe(ZOOM_MAX);
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('400%');
  await expect(zoomIn).toBeDisabled();
  await expect(zoomOut).toBeEnabled();
  const atMax = await readCamera(page);
  expect(atMax.zoom).toBeCloseTo(ZOOM_MAX, 6);

  // Clicking the disabled button does nothing.
  await zoomIn.click({ force: true });
  expect((await readCamera(page)).zoom).toBeCloseTo(ZOOM_MAX, 6);

  // TC-26: from far away at 400%, Reset view gives 100% with the start centred.
  await setCameraToMaxZoom(page);
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('400%');
  await page.locator('[data-testid="reset-view"]').click();
  await settle(page);
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%');
  const resetCameraState = await readCamera(page);
  expect(resetCameraState.zoom).toBeCloseTo(1, 6);
  expectClose(
    resetCameraState.x,
    -VIEWPORT_SIZE.width / 2,
    0.5,
  );
  expectClose(resetCameraState.y, -VIEWPORT_SIZE.height / 2, 0.5);
  const marker = await markerRect(page);
  expectClose(marker.centerX, VIEWPORT_CENTRE.x);
  expectClose(marker.centerY, VIEWPORT_CENTRE.y);

  // Zooming back out from the maximum re-enables +.
  await zoomOut.click();
  await settle(page);
  await expect(zoomIn).toBeEnabled();
});

// TC-27: at UNBOUNDED_PAN_TESTED_EXTENT the board still follows the pointer exactly and
// the dot grid keeps its computed spacing.
test('workflow 3 - far travel (TC-27): panning a million units out still follows the pointer', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCameraFarAway(page, 1);

  const spacing = await gridSpacingPx(page);
  expectClose(spacing, GRID_SPACING_WORLD, 0.5);

  const before = await markerRect(page);
  await dragBoard(page, { x: 500, y: 300 }, { x: 700, y: 400 });
  const after = await markerRect(page);
  expectClose(after.centerX, before.centerX + 200);
  expectClose(after.centerY, before.centerY + 100);

  // Zooming out there keeps the grid evenly spaced at GRID_SPACING_WORLD * zoom.
  await page.locator('[data-testid="zoom-out"]').click();
  await settle(page);
  const zoomedOut = await readCamera(page);
  expectClose(
    await gridSpacingPx(page),
    GRID_SPACING_WORLD * zoomedOut.zoom,
    0.5,
  );
  expect(await markerRect(page)).toBeTruthy();
});

test('board gestures never zoom the page (TC-31)', async ({ page }) => {
  await gotoBoard(page);
  const pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const textHeight = await page
    .locator('[data-testid="zoom-label"]')
    .evaluate((element) => element.getBoundingClientRect().height);

  await ctrlWheel(page, -240, { x: 640, y: 400 });
  await ctrlWheel(page, 240, { x: 640, y: 400 });
  await page.mouse.wheel(0, 120);
  await settle(page);
  await pressShortcut(page, '=');
  await pressShortcut(page, '-');
  await pressShortcut(page, '0');

  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(pixelRatio);
  expect(
    await page.locator('[data-testid="zoom-label"]').evaluate((element) =>
      element.getBoundingClientRect().height,
    ),
  ).toBeCloseTo(textHeight, 4);
  // Only board content scaled: the camera is back at the reset view.
  const camera = await readCamera(page);
  expect(camera.zoom).toBeCloseTo(1, 6);
});

// pan.scroll: plain scroll pans in the scroll direction, both axes.
test('scrolling pans the board in the scroll direction', async ({ page }) => {
  await gotoBoard(page);
  const before = await markerRect(page);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 120);
  await settle(page);
  await expect
    .poll(async () => (await markerRect(page)).centerY, { timeout: 5000 })
    .toBeLessThan(before.centerY);
  const afterVertical = await markerRect(page);
  expectClose(afterVertical.centerX, before.centerX);

  await page.mouse.wheel(90, 0);
  await settle(page);
  await expect
    .poll(async () => (await markerRect(page)).centerX, { timeout: 5000 })
    .toBeLessThan(before.centerX);
});

// zoom.step through the keyboard: Ctrl/Cmd + =, -, and 0 in a real browser.
test('keyboard shortcuts step and reset the zoom', async ({ page }) => {
  await gotoBoard(page);
  await pressShortcut(page, '=');
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('125%');
  await pressShortcut(page, '-');
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%');

  await dragBoard(page, { x: 300, y: 300 }, { x: 800, y: 600 });
  const panned = await markerRect(page);
  expect(Math.abs(panned.centerX - VIEWPORT_CENTRE.x)).toBeGreaterThan(1);
  await pressShortcut(page, '0');
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%');
  const resetMarker = await markerRect(page);
  expectClose(resetMarker.centerX, VIEWPORT_CENTRE.x);
  expectClose(resetMarker.centerY, VIEWPORT_CENTRE.y);
});

// zoom.no_page_zoom in layout terms: only board content scales.
test('the zoom control stays a fixed size while the board zooms', async ({ page }) => {
  await gotoBoard(page);
  const before = await markerRect(page);
  expect(await stepToMaxZoom(page)).toBe(ZOOM_MAX);
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('400%');
  const marker = await markerRect(page);
  // The marker itself scales with the board: 16 CSS px at 1:1 becomes 16 * zoom.
  expectClose(marker.width, before.width * ZOOM_MAX, 1);
  expect(await hintCount(page)).toBe(0);
});

// pan.unbounded: no edge and no distortion at the tested extent.
test('the board reaches UNBOUNDED_PAN_TESTED_EXTENT without an edge', async ({ page }) => {
  await gotoBoard(page);
  await setCameraFarAway(page, 1);
  const camera = await readCamera(page);
  expect(camera.x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
  expect(camera.y).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
  const before = await markerRect(page);
  await dragBoard(page, { x: 400, y: 400 }, { x: 410, y: 410 });
  const after = await markerRect(page);
  expectClose(after.centerX, before.centerX + 10);
  expectClose(after.centerY, before.centerY + 10);
});
