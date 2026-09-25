import { expect, test, type Page } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  distanceToNearestDot,
  dotNear,
  drag,
  expectNear,
  getCamera,
  openBoard,
  originMarkerCentre,
  PIXEL_TOLERANCE,
  readGrid,
  setCamera,
  zoomLabel,
} from './helpers/board';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const DRAG = { dx: 200, dy: 100 };
const WHEEL_DELTA = 100;
/** Precision for camera values read back from the page (world units). */
const CAMERA_TOLERANCE = 1e-6;

async function pageZoomState(page: Page) {
  return page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, dpr: window.devicePixelRatio }));
}

async function expectMarkerAt(page: Page, expected: { x: number; y: number }) {
  await expect
    .poll(async () => {
      const c = await originMarkerCentre(page);
      return Math.max(Math.abs(c.x - expected.x), Math.abs(c.y - expected.y));
    })
    .toBeLessThanOrEqual(PIXEL_TOLERANCE);
}

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 → TC-23 → TC-24: hint, exact drag, zoom around the pointer', async ({ page }) => {
    await openBoard(page);
    const viewport = page.viewportSize()!;

    // TC-28: hint on first load, start point in the centre at 100%.
    await expect(page.getByText(HINT)).toBeVisible();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerAt(page, { x: viewport.width / 2, y: viewport.height / 2 });

    // TC-23: drag from a grid dot by (200,100); marker and that dot move exactly.
    const markerBefore = await originMarkerCentre(page);
    const gridBefore = await readGrid(page);
    const dot = dotNear(gridBefore, { x: viewport.width / 4, y: viewport.height / 4 });
    await page.mouse.move(dot.x, dot.y);
    await page.mouse.down();
    await page.mouse.move(dot.x + DRAG.dx / 2, dot.y + DRAG.dy / 2, { steps: 5 });
    await expect(page.getByTestId('board-viewport')).toHaveCSS('cursor', 'grabbing');
    await page.mouse.move(dot.x + DRAG.dx, dot.y + DRAG.dy, { steps: 5 });
    await page.mouse.up();
    await expectMarkerAt(page, { x: markerBefore.x + DRAG.dx, y: markerBefore.y + DRAG.dy });
    const gridAfter = await readGrid(page);
    expectNear(distanceToNearestDot(gridAfter, { x: dot.x + DRAG.dx, y: dot.y + DRAG.dy }), { x: 0, y: 0 });
    await expect(page.getByTestId('board-viewport')).toHaveCSS('cursor', 'grab');

    // TC-28: hint gone after the first pan.
    await expect(page.getByText(HINT)).toHaveCount(0);

    // TC-24: Ctrl + wheel over a dot (the start point is one) keeps it under the pointer.
    const before = await pageZoomState(page);
    const target = await originMarkerCentre(page);
    await page.mouse.move(target.x, target.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -WHEEL_DELTA);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('100%');
    await expectMarkerAt(page, target);
    const zoomedGrid = await readGrid(page);
    expectNear(distanceToNearestDot(zoomedGrid, target), { x: 0, y: 0 });
    expect(await pageZoomState(page)).toEqual(before);

    // Zoom back out: the point still stays put.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, WHEEL_DELTA);
    await page.keyboard.up('Control');
    await expectMarkerAt(page, target);

    // Hint does not come back.
    await expect(page.getByText(HINT)).toHaveCount(0);
  });

  test('plain wheel scrolling pans the board in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const start = await originMarkerCentre(page);
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, WHEEL_DELTA);
    // Scroll down → content moves up.
    await expectMarkerAt(page, { x: start.x, y: start.y - WHEEL_DELTA });
    await page.mouse.wheel(WHEEL_DELTA, 0);
    // Scroll right → content moves left.
    await expectMarkerAt(page, { x: start.x - WHEEL_DELTA, y: start.y - WHEEL_DELTA });
    await expect(page.getByText(HINT)).toHaveCount(0);
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 → TC-26: zoom to the maximum, then Reset view from far away', async ({ page }) => {
    await openBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });

    // TC-25: click + until disabled.
    const labels: string[] = [];
    const MAX_CLICKS = 20;
    for (let i = 0; i < MAX_CLICKS && (await zoomIn.isEnabled()); i += 1) {
      const previous = await zoomLabel(page).textContent();
      await zoomIn.click();
      await expect(zoomLabel(page)).not.toHaveText(previous ?? '');
      labels.push((await zoomLabel(page).textContent()) ?? '');
    }
    expect(labels[0]).toBe('125%');
    expect(labels.at(-1)).toBe(`${ZOOM_MAX * 100}%`);
    await expect(zoomIn).toBeDisabled();
    await expect(zoomIn).toHaveAttribute('disabled', '');
    await expect(zoomOut).toBeEnabled();

    // One step back re-enables +.
    await zoomOut.click();
    await expect(zoomIn).toBeEnabled();

    // TC-26: jump a million units away at maximum zoom and reset.
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await expect(zoomLabel(page)).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const viewport = page.viewportSize()!;
    await expectMarkerAt(page, { x: viewport.width / 2, y: viewport.height / 2 });
  });

  test('zoom out stops at 10% and disables −', async ({ page }) => {
    await openBoard(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    const MAX_CLICKS = 20;
    for (let i = 0; i < MAX_CLICKS && (await zoomOut.isEnabled()); i += 1) {
      const previous = await zoomLabel(page).textContent();
      await zoomOut.click();
      await expect(zoomLabel(page)).not.toHaveText(previous ?? '');
    }
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();
    // Further Ctrl + wheel zoom-out does nothing.
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, WHEEL_DELTA);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).toHaveText('10%');
  });

  test.describe('at 1920x1080', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });
    test('Ctrl/Cmd + 0 resets to 100% centred', async ({ page }) => {
      await openBoard(page);
      await setCamera(page, { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 3 });
      await expect(zoomLabel(page)).toHaveText('300%');
      await page.keyboard.press('Control+0');
      await expect(zoomLabel(page)).toHaveText('100%');
      await expectMarkerAt(page, { x: 960, y: 540 });
    });
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 a million units away the grid is even and panning is exact', async ({ page }) => {
    await openBoard(page);
    const far = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    await setCamera(page, far);
    const grid = await readGrid(page);
    expect(grid.spacing).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 6);

    const viewport = page.viewportSize()!;
    const dot = dotNear(grid, { x: viewport.width / 3, y: viewport.height / 3 });
    await drag(page, dot, DRAG.dx, DRAG.dy);
    await expect
      .poll(async () => (await getCamera(page)).x)
      .toBeCloseTo(far.x - DRAG.dx / far.zoom, 6);
    const cam = await getCamera(page);
    expect(Math.abs(cam.y - (far.y - DRAG.dy / far.zoom))).toBeLessThanOrEqual(CAMERA_TOLERANCE);
    const gridAfter = await readGrid(page);
    expect(gridAfter.spacing).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 6);
    expectNear(distanceToNearestDot(gridAfter, { x: dot.x + DRAG.dx, y: dot.y + DRAG.dy }), { x: 0, y: 0 });

    // Reset still returns to the start.
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expectMarkerAt(page, { x: viewport.width / 2, y: viewport.height / 2 });
  });
});

test('TC-31 board zoom gestures and shortcuts never change the page zoom', async ({ page }) => {
  await openBoard(page);
  const before = await pageZoomState(page);
  const controlsBox = await page.getByTestId('zoom-controls').boundingBox();
  const viewport = page.viewportSize()!;

  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -WHEEL_DELTA);
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+0');
  await expect(zoomLabel(page)).toHaveText('100%');

  expect(await pageZoomState(page)).toEqual(before);
  expect(await page.getByTestId('zoom-controls').boundingBox()).toEqual(controlsBox);
});

test('Ctrl/Cmd + = and − step the zoom around the centre', async ({ page }) => {
  await openBoard(page);
  const centre = await originMarkerCentre(page);
  await page.keyboard.press('Control+Equal');
  await expect(zoomLabel(page)).toHaveText('125%');
  await expectMarkerAt(page, centre);
  await page.keyboard.press('Control+Minus');
  await expect(zoomLabel(page)).toHaveText('100%');
  await expectMarkerAt(page, centre);
});
