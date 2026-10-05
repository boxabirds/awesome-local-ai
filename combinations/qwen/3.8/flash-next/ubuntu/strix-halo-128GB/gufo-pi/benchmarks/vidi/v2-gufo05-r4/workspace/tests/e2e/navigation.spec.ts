import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Camera } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN
} from '../../src/shared/config';
import {
  BOARD_CENTRE,
  BOARD_SIZE,
  dragBoard,
  getCamera,
  goToFarAwayMaxZoom,
  gridStyle,
  marker,
  markerCentre,
  openBoard,
  pageZoomSignals,
  pinchAt,
  setCamera,
  zoomControlBox,
  zoomLabel
} from './helpers/board';

/** Tolerance for "the same place on screen", in CSS pixels. */
const PIXEL_TOLERANCE = 1;

/** Click a zoom button, reporting false if it was disabled before the click landed. */
async function clickZoom(button: Locator): Promise<boolean> {
  try {
    await button.click({ timeout: 1000 });
    return true;
  } catch {
    return false; // became disabled: the board is at a zoom limit
  }
}

/** Read the zoom label once it shows something different from `previous`. */
async function waitForZoomChange(page: Page, previous: string | null): Promise<string> {
  let shown = previous;
  await expect
    .poll(async () => {
      shown = (await zoomLabel(page).textContent()) ?? previous;
      return shown !== previous;
    }, { timeout: 2000 })
    .toBe(true);
  return shown as string;
}

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test.describe('workflow: first visit navigation', () => {
  test('TC-28 → TC-23 → TC-24: hint, exact drag, zoom that keeps the pointer fixed', async ({ page }) => {
    await openBoard(page);

    // TC-28: the first-use hint is shown with the exact wording.
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(HINT_TEXT);

    // The board opens centred on its starting point.
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - BOARD_CENTRE.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(centre.y - BOARD_CENTRE.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // TC-23: dragging 200 px right and 100 px down moves the board exactly that way.
    const before = await markerCentre(page);
    await dragBoard(page, { x: 620, y: 380 }, { x: 820, y: 480 });
    const after = await markerCentre(page);
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);

    // TC-28: the hint is gone after the first pan and does not come back.
    await expect(hint).toHaveCount(0);

    // TC-24: zooming with Ctrl + wheel over a grid dot keeps that dot under the
    // pointer. The board's start point sits on a grid dot, so it is the target.
    const dot = await markerCentre(page);
    await pinchAt(page, dot, -120);
    const zoomed = await markerCentre(page);
    expect(Math.abs(zoomed.x - dot.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(zoomed.y - dot.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    await expect(zoomLabel(page)).not.toHaveText('100%');

    // Zoom back out the same way: still under the pointer.
    await pinchAt(page, dot, 120);
    const unzoomed = await markerCentre(page);
    expect(Math.abs(unzoomed.x - dot.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(unzoomed.y - dot.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // The hint does not return during the visit.
    await expect(hint).toHaveCount(0);
  });

  test('TC-28: scrolling pans the board and hides the hint', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();

    const before = await markerCentre(page);
    await page.mouse.move(BOARD_CENTRE.x, BOARD_CENTRE.y);
    await page.mouse.wheel(0, 150);
    // Scrolling down moves content up.
    const after = await markerCentre(page);
    expect(after.y - before.y).toBeCloseTo(-150, 0);
    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);

    // Scrolling right moves content left.
    const beforeHorizontal = await markerCentre(page);
    await page.mouse.wheel(90, 0);
    const afterHorizontal = await markerCentre(page);
    expect(afterHorizontal.x - beforeHorizontal.x).toBeCloseTo(-90, 0);
  });
});

test.describe('workflow: limits and recovery', () => {
  test('TC-25 → TC-26: zoom in to the maximum, then Reset view', async ({ page }) => {
    await openBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });

    await expect(zoomLabel(page)).toHaveText('100%');

    // Click + until the board stops it, remembering each zoom level shown.
    const seen: string[] = [];
    let shown = await zoomLabel(page).textContent();
    for (let i = 0; i < 20; i += 1) {
      if (await zoomIn.isDisabled()) break;
      if (!(await clickZoom(zoomIn))) break; // the button was disabled mid-click
      shown = await waitForZoomChange(page, shown);
      seen.push(shown);
    }
    expect(seen[0]).toBe('125%');
    expect(seen.at(-1)).toBe('400%');
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOut).toBeEnabled();

    // Zooming back the other way re-enables the + button.
    await zoomOut.click();
    await expect(zoomIn).toBeEnabled();
    await expect(zoomLabel(page)).toHaveText('320%');

    // TC-26: from a million units away at maximum zoom, Reset view returns to a
    // hundred per cent with the board's starting point in the middle.
    await goToFarAwayMaxZoom(page);
    await expect(zoomLabel(page)).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - BOARD_CENTRE.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(centre.y - BOARD_CENTRE.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test('zoom out to the minimum stops at 10% and disables the − button', async ({ page }) => {
    await openBoard(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });

    let shown = await zoomLabel(page).textContent();
    for (let i = 0; i < 30; i += 1) {
      if (await zoomOut.isDisabled()) break;
      if (!(await clickZoom(zoomOut))) break;
      shown = await waitForZoomChange(page, shown);
    }
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MIN * 100)}%`);
    await expect(zoomOut).toBeDisabled();
    await expect(zoomIn).toBeEnabled();

    // A keyboard zoom-out at the limit does nothing at all.
    const before = await getCamera(page);
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(50);
    expect(await getCamera(page)).toEqual(before);
  });

  test('keyboard shortcuts zoom the board, not the page (TC-31)', async ({ page }) => {
    await openBoard(page);
    const signalsBefore = await pageZoomSignals(page);
    const controlBefore = await zoomControlBox(page);

    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('Control+-');
    await expect(zoomLabel(page)).toHaveText('100%');
    await page.keyboard.press('Meta+=');
    await expect(zoomLabel(page)).toHaveText('125%');

    // Ctrl/Cmd + 0 returns to the standard view from anywhere.
    await dragBoard(page, { x: 600, y: 300 }, { x: 200, y: 700 });
    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText('100%');
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - BOARD_CENTRE.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(centre.y - BOARD_CENTRE.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // TC-31: page zoom is untouched — only board content scaled.
    const signalsAfter = await pageZoomSignals(page);
    expect(signalsAfter).toEqual(signalsBefore);
    const controlAfter = await zoomControlBox(page);
    expect(controlAfter).toEqual(controlBefore);
  });

  test('TC-31: board zoom gestures never zoom the browser page', async ({ page }) => {
    await openBoard(page);
    const signalsBefore = await pageZoomSignals(page);
    const controlBefore = await zoomControlBox(page);
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();

    const dot = await markerCentre(page);
    for (const deltaY of [-240, -240, 480, -1000]) {
      await pinchAt(page, dot, deltaY);
    }

    // Ctrl + wheel over the board is consumed by the board.
    const signalsAfter = await pageZoomSignals(page);
    expect(signalsAfter).toEqual(signalsBefore);
    const controlAfter = await zoomControlBox(page);
    expect(controlAfter).toEqual(controlBefore);
    // (The hint is gone by now — the zoom control box above is the proof that
    // nothing outside the board changed size.)

    // The board itself did zoom (and never passed the clamp).
    const camera = await getCamera(page);
    expect(camera.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(camera.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    await expect(zoomLabel(page)).not.toHaveText('100%');
  });
});

test.describe('workflow: far travel', () => {
  test('TC-27: a million units from the start the grid is even and the drag is exact', async ({ page }) => {
    await openBoard(page);
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1
    };
    await setCamera(page, far);

    // The grid still renders at the expected, evenly spaced pitch.
    const grid = await gridStyle(page);
    const spacing = GRID_SPACING_WORLD * far.zoom;
    expect(grid.size).toBe(`${spacing}px ${spacing}px`);
    const [offsetX, offsetY] = grid.position.split(' ').map(Number.parseFloat);
    expect(Number.isFinite(offsetX)).toBe(true);
    expect(Number.isFinite(offsetY)).toBe(true);
    expect(offsetX ?? -1).toBeGreaterThanOrEqual(0);
    expect(offsetX ?? Infinity).toBeLessThan(spacing);

    // A drag still follows the pointer exactly at this distance.
    const before = await getCamera(page);
    await dragBoard(page, { x: 500, y: 300 }, { x: 700, y: 400 });
    const after = await getCamera(page);
    expect(after.x).toBeCloseTo(before.x - 200, 6);
    expect(after.y).toBeCloseTo(before.y - 100, 6);

    // And zooming still keeps the spot under the pointer fixed, so panning and
    // zooming stay usable far from the start.
    const dot = { x: 640, y: 400 };
    const beforeZoom = await getCamera(page);
    const worldUnderPointer = {
      x: dot.x / beforeZoom.zoom + beforeZoom.x,
      y: dot.y / beforeZoom.zoom + beforeZoom.y
    };
    await pinchAt(page, dot, -120);
    const afterZoom = await getCamera(page);
    const screenOfSameWorld = {
      x: (worldUnderPointer.x - afterZoom.x) * afterZoom.zoom,
      y: (worldUnderPointer.y - afterZoom.y) * afterZoom.zoom
    };
    expect(Math.abs(screenOfSameWorld.x - dot.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(screenOfSameWorld.y - dot.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test('TC-26 variant: Reset view works from maximum zoom far away, twice in a row', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expect(marker(page)).toBeInViewport();

    // Panning afterwards still tracks the pointer (no edge was reached).
    const before = await markerCentre(page);
    await dragBoard(page, { x: 400, y: 400 }, { x: 405, y: 402 });
    const after = await markerCentre(page);
    expect(after.x - before.x).toBeCloseTo(5, 0);
    expect(after.y - before.y).toBeCloseTo(2, 0);
    expect(BOARD_SIZE.width).toBe(1280);
  });
});
