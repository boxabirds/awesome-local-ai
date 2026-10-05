import { expect, test } from '@playwright/test';

import {
  FAR,
  GRID,
  HINT_TEXT,
  MAX_ZOOM,
  MIN_ZOOM,
  PIXEL_TOLERANCE,
  STEP,
  VIEWPORT,
  board,
  dragAndSettle,
  expectCamera,
  gridOffsetFor,
  gridOffsetPx,
  gridSpacingPx,
  hint,
  markerCenter,
  openBoard,
  originMarker,
  pageZoomSignals,
  readCamera,
  resetButton,
  setCamera,
  wheelAt,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  zoomToLimit,
} from './helpers/board';

const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** An empty spot away from the hint and the controls. */
const EMPTY_SPOT = { x: 420, y: 260 };

test.describe('first visit navigation', () => {
  // TC-28, TC-23, TC-24
  test('reads the hint, pans with the mouse and zooms with the pointer', async ({ page }) => {
    await openBoard(page);

    // The hint is shown when the board opens, together with the board.
    await expect(hint(page)).toBeVisible();
    expect(await hint(page).textContent()).toBe(HINT_TEXT);

    // The starting point is centred.
    const start = await markerCenter(page);
    expect(Math.abs(start.x - CENTRE.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(start.y - CENTRE.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // Dragging the empty board by 200, 100 moves it by exactly 200, 100 pixels.
    const beforeDragCamera = await readCamera(page);
    const afterDrag = await dragAndSettle(page, EMPTY_SPOT, 200, 100);
    const moved = await markerCenter(page);
    expect(Math.abs(moved.x - (start.x + 200))).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(moved.y - (start.y + 100))).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(afterDrag.x).toBeCloseTo(beforeDragCamera.x - 200, 6);
    expect(afterDrag.y).toBeCloseTo(beforeDragCamera.y - 100, 6);
    // The dot grid moved with the board: cell size is unchanged, the offset
    // is exactly where the grid sits on screen now.
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID, 3);
    const offset = await gridOffsetPx(page);
    expect(offset.x).toBeCloseTo(gridOffsetFor(-afterDrag.x * afterDrag.zoom, GRID), 3);
    expect(offset.y).toBeCloseTo(gridOffsetFor(-afterDrag.y * afterDrag.zoom, GRID), 3);

    // The first camera change dismisses the hint.
    await expect(hint(page)).toHaveCount(0);

    // Ctrl/Cmd + scroll over a dot: that dot stays under the pointer.
    const dot = await markerCenter(page);
    const zoomBefore = await readCamera(page);
    await wheelAt(page, dot, -120, { ctrlKey: true });
    await expectCamera(page, { zoom: zoomBefore.zoom * Math.exp(120 * 0.01) });
    const zoomed = await readCamera(page);
    const afterZoom = await markerCenter(page);
    expect(Math.abs(afterZoom.x - dot.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(afterZoom.y - dot.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(zoomed.zoom).toBeGreaterThan(zoomBefore.zoom);
    // The page itself did not zoom.
    expect((await pageZoomSignals(page)).scale).toBe(1);

    // A second camera change does not bring the hint back.
    await dragAndSettle(page, EMPTY_SPOT, -60, 40);
    await wheelAt(page, CENTRE, 120, { ctrlKey: true });
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(hint(page)).toHaveCount(0);
  });

  // TC-29
  test('stays put for a click without movement', async ({ page }) => {
    await openBoard(page);
    const before = await markerCenter(page);
    const beforeCamera = await readCamera(page);

    await page.mouse.move(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(100);

    const after = await markerCenter(page);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(await readCamera(page)).toEqual(beforeCamera);
    // A click is not navigation, so the hint is still there.
    await expect(hint(page)).toBeVisible();
  });
});

test.describe('zoom limits and recovery', () => {
  // TC-25
  test('reaches the maximum zoom, stops and shows the percentage', async ({ page }) => {
    await openBoard(page);

    // One click on + is 125%.
    await zoomInButton(page).click();
    await expect(zoomLabel(page)).toHaveText(`${Math.round(STEP * 100)}%`);

    // Keep clicking until the button is disabled.
    const labels = await zoomToLimit(page, 'in');
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    // The label is a whole percentage and matches the state.
    for (const label of labels) {
      expect(label).toMatch(/^\d+%$/);
      expect(Number(label.slice(0, -1))).toBeLessThanOrEqual(MAX_ZOOM * 100);
    }
    expect(await readCamera(page)).toMatchObject({ zoom: MAX_ZOOM });

    // Zooming out of the limit works again, and all the way down stops at 10 %.
    await zoomOutButton(page).click();
    await expect(zoomLabel(page)).not.toHaveText('400%');
    const down = await zoomToLimit(page, 'out');
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOutButton(page)).toBeDisabled();
    expect(await readCamera(page)).toMatchObject({ zoom: MIN_ZOOM });
    expect(down.at(-1)).toBe('10%');
    for (const label of down) {
      expect(label).toMatch(/^\d+%$/);
      expect(Number(label.slice(0, -1))).toBeGreaterThanOrEqual(MIN_ZOOM * 100);
    }
    // Zooming back in re-enables −.
    await zoomInButton(page).click();
    await expect(zoomOutButton(page)).toBeEnabled();
  });

  // TC-26
  test('returns to the starting point with Reset view', async ({ page }) => {
    await openBoard(page);

    await setCamera(page, { x: FAR, y: FAR, zoom: MAX_ZOOM });
    await expectCamera(page, { x: FAR, y: FAR, zoom: MAX_ZOOM });
    await expect(zoomLabel(page)).toHaveText('400%');
    // The board is panned away: the starting point is off screen.
    const farMarker = await markerCenter(page);
    expect(farMarker.x).toBeLessThan(0);

    await resetButton(page).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });

    const restored = await markerCenter(page);
    expect(Math.abs(restored.x - CENTRE.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(restored.y - CENTRE.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    // The dot grid is back to its unzoomed spacing.
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID, 3);
  });

  // TC-31
  test('never zooms the page itself', async ({ page }) => {
    await openBoard(page);
    const initial = await pageZoomSignals(page);

    await wheelAt(page, CENTRE, -240, { ctrlKey: true });
    await wheelAt(page, CENTRE, 240, { ctrlKey: true });
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText('100%');

    const after = await pageZoomSignals(page);
    expect(after.scale).toBe(initial.scale);
    expect(after.dpr).toBe(initial.dpr);
    expect(after.scale).toBe(1);
  });
});

test.describe('far travel', () => {
  // TC-27
  test('keeps precision and even grid one million units out', async ({ page }) => {
    await openBoard(page);

    // A camera one million board units from the start.
    await setCamera(page, { x: FAR - CENTRE.x, y: FAR - CENTRE.y, zoom: 1 });
    await expectCamera(page, { x: FAR - CENTRE.x, y: FAR - CENTRE.y, zoom: 1 });

    // The grid is evenly spaced and attached to the board.
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID, 3);
    const farOffset = await gridOffsetPx(page);
    expect(farOffset.x).toBeCloseTo(gridOffsetFor(-(FAR - CENTRE.x), GRID), 3);

    // Dragging 200, 100 moves the board by exactly that many pixels.
    const after = await dragAndSettle(page, EMPTY_SPOT, 200, 100);
    expect(after.x).toBeCloseTo(FAR - CENTRE.x - 200, 4);
    expect(after.y).toBeCloseTo(FAR - CENTRE.y - 100, 4);
    expect(after.zoom).toBe(1);

    // The grid is still evenly spaced and follows the camera.
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID, 3);
    const offset = await gridOffsetPx(page);
    expect(offset.x).toBeCloseTo(gridOffsetFor(-after.x, GRID), 3);
    expect(offset.y).toBeCloseTo(gridOffsetFor(-after.y, GRID), 3);

    // Zooming out there stays smooth and within the limits.
    await wheelAt(page, CENTRE, 200, { ctrlKey: true });
    const zoomedOut = await readCamera(page);
    expect(zoomedOut.zoom).toBeCloseTo(Math.exp(-2), 5);
    expect(zoomedOut.zoom).toBeGreaterThan(MIN_ZOOM);
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID * zoomedOut.zoom, 2);
  });
});

test('the board is one surface with a starting point marked', async ({ page }) => {
  await openBoard(page);
  await expect(board(page)).toBeVisible();
  await expect(originMarker(page)).toBeVisible();
  await expect(zoomLabel(page)).toHaveText('100%');
});
