import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  PIXEL_TOLERANCE,
  drag,
  getCamera,
  gridState,
  nextFrames,
  openBoard,
  originMarkerCentre,
  pageZoomState,
  periodicDistance,
  setCamera,
  viewportCentre,
  zoomLabel,
} from './helpers/board';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const DRAG = { dx: 200, dy: 100 } as const;
/** A grid dot a few cells away from the origin, in grid cells. */
const DOT_CELLS = { x: 5, y: 3 } as const;
const WHEEL_DELTA = 100;
const MAX_CLICKS = 30;
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
const SAMPLE_DRAG_START = { x: 300, y: 250 } as const;

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 → TC-23 → TC-24: hint, exact drag, zoom around the pointer', async ({ page }) => {
    await openBoard(page);

    // TC-28: hint visible on first load.
    await expect(page.getByText(HINT)).toBeVisible();

    // Starting point is centred at 100%.
    const centre = await viewportCentre(page);
    const origin0 = await originMarkerCentre(page);
    expect(Math.abs(origin0.x - centre.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(origin0.y - centre.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // TC-23: a real mouse drag moves origin marker and grid by exactly the drag.
    const grid0 = await gridState(page);
    expect(grid0.spacing).toBe(GRID_SPACING_WORLD);
    // The origin is a grid point, so a dot sits exactly under the marker.
    expect(periodicDistance(origin0.x - grid0.dotX, grid0.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(periodicDistance(origin0.y - grid0.dotY, grid0.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    await drag(page, SAMPLE_DRAG_START, DRAG.dx, DRAG.dy);
    const origin1 = await originMarkerCentre(page);
    expect(Math.abs(origin1.x - origin0.x - DRAG.dx)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(origin1.y - origin0.y - DRAG.dy)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    const grid1 = await gridState(page);
    expect(periodicDistance(grid1.dotX - grid0.dotX - DRAG.dx, grid1.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(periodicDistance(grid1.dotY - grid0.dotY - DRAG.dy, grid1.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(periodicDistance(origin1.x - grid1.dotX, grid1.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // TC-28: the hint is gone after the first pan.
    await expect(page.getByText(HINT)).toHaveCount(0);

    // TC-24: Ctrl + wheel over a grid dot keeps that dot under the pointer.
    const before = await pageZoomState(page);
    const dot = {
      x: origin1.x + DOT_CELLS.x * GRID_SPACING_WORLD,
      y: origin1.y + DOT_CELLS.y * GRID_SPACING_WORLD,
    };
    await page.mouse.move(dot.x, dot.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -WHEEL_DELTA);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('100%');
    await nextFrames(page);

    const { zoom } = await getCamera(page);
    expect(zoom).toBeGreaterThan(1);
    const origin2 = await originMarkerCentre(page);
    const dotNow = {
      x: origin2.x + DOT_CELLS.x * GRID_SPACING_WORLD * zoom,
      y: origin2.y + DOT_CELLS.y * GRID_SPACING_WORLD * zoom,
    };
    expect(Math.abs(dotNow.x - dot.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(dotNow.y - dot.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    const grid2 = await gridState(page);
    expect(grid2.spacing).toBeCloseTo(GRID_SPACING_WORLD * zoom, 3);
    expect(periodicDistance(dot.x - grid2.dotX, grid2.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(periodicDistance(dot.y - grid2.dotY, grid2.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    await expect(zoomLabel(page)).toHaveText(`${Math.round(zoom * 100)}%`);

    // Page zoom untouched.
    expect(await pageZoomState(page)).toEqual(before);

    // Hint stays hidden for the rest of the visit.
    await expect(page.getByText(HINT)).toHaveCount(0);
  });

  test('plain wheel pans the board in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const origin0 = await originMarkerCentre(page);
    await page.mouse.move(SAMPLE_DRAG_START.x, SAMPLE_DRAG_START.y);
    await page.mouse.wheel(0, WHEEL_DELTA);
    await expect.poll(async () => (await originMarkerCentre(page)).y).toBeLessThan(origin0.y);
    const origin1 = await originMarkerCentre(page);
    expect(Math.abs(origin0.y - origin1.y - WHEEL_DELTA)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(origin1.x - origin0.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    await page.mouse.wheel(WHEEL_DELTA, 0);
    await expect.poll(async () => (await originMarkerCentre(page)).x).toBeLessThan(origin0.x);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 → TC-26: zoom in to 400%, + disables, Reset view returns to 100% centred', async ({ page }) => {
    await openBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    await zoomIn.click();
    await expect(zoomLabel(page)).toHaveText('125%');
    for (let i = 0; i < MAX_CLICKS && (await zoomIn.isEnabled()); i++) {
      const previous = await zoomLabel(page).textContent();
      await zoomIn.click();
      await expect(zoomLabel(page)).not.toHaveText(previous ?? '');
    }
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
    await expect(zoomIn).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled();

    // One step back re-enables +.
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(zoomIn).toBeEnabled();

    // TC-26: jump very far away at max zoom, then Reset view.
    await setCamera(page, { x: FAR, y: FAR, zoom: ZOOM_MAX });
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * 100}%`);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await nextFrames(page);
    const centre = await viewportCentre(page);
    const origin = await originMarkerCentre(page);
    expect(Math.abs(origin.x - centre.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(origin.y - centre.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test('zoom out stops at 10% and − disables', async ({ page }) => {
    await openBoard(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    for (let i = 0; i < MAX_CLICKS && (await zoomOut.isEnabled()); i++) {
      const previous = await zoomLabel(page).textContent();
      await zoomOut.click();
      await expect(zoomLabel(page)).not.toHaveText(previous ?? '');
    }
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units the grid is evenly spaced and panning is exact', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: FAR, y: -FAR, zoom: 1 });
    await nextFrames(page);
    const cam0 = await getCamera(page);
    const grid0 = await gridState(page);
    expect(grid0.spacing).toBe(GRID_SPACING_WORLD * cam0.zoom);

    await drag(page, SAMPLE_DRAG_START, DRAG.dx, DRAG.dy);
    const cam1 = await getCamera(page);
    expect(cam1.x).toBeCloseTo(cam0.x - DRAG.dx / cam0.zoom, 6);
    expect(cam1.y).toBeCloseTo(cam0.y - DRAG.dy / cam0.zoom, 6);
    const grid1 = await gridState(page);
    expect(grid1.spacing).toBe(GRID_SPACING_WORLD * cam1.zoom);
    expect(periodicDistance(grid1.dotX - grid0.dotX - DRAG.dx, grid1.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(periodicDistance(grid1.dotY - grid0.dotY - DRAG.dy, grid1.spacing)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // At max zoom far away the grid is still spaced exactly.
    await setCamera(page, { x: -FAR, y: FAR, zoom: ZOOM_MAX });
    await nextFrames(page);
    expect((await gridState(page)).spacing).toBe(GRID_SPACING_WORLD * ZOOM_MAX);
  });
});

test.describe('TC-31: board gestures never zoom the page', () => {
  test('Ctrl + wheel and Ctrl + = / − / 0 leave page zoom unchanged', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoomState(page);
    const controls = page.getByRole('group', { name: 'Zoom' });
    const controlsBox = await controls.boundingBox();

    // Record whether the page prevented the browser's default for each shortcut.
    await page.evaluate(() => {
      const w = window as unknown as { __prevented: boolean[] };
      w.__prevented = [];
      window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key !== 'Control') w.__prevented.push(e.defaultPrevented);
      });
    });

    await page.mouse.move(SAMPLE_DRAG_START.x, SAMPLE_DRAG_START.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -WHEEL_DELTA);
    await page.keyboard.up('Control');
    await page.getByTestId('board-viewport').focus();
    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+Digit0');
    await expect(zoomLabel(page)).toHaveText('100%');

    const prevented = await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);
    expect(prevented).toEqual([true, true, true]);
    expect(await pageZoomState(page)).toEqual(before);
    expect(await controls.boundingBox()).toEqual(controlsBox);
  });
});
