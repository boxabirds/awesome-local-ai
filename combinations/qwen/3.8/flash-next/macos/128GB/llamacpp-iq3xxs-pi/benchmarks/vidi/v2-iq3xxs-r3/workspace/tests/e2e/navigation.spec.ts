/**
 * Story 1 e2e: navigating the board in a real browser, served by `wrangler dev`.
 *
 * Beyond the numbered cases from the story test strategy (TC-23 to TC-31), the
 * suite also checks what the PRD promises directly: wheel/trackpad scrolling
 * pans, plain drags never zoom, grid spacing tracks the zoom level, resizing the
 * window keeps content anchored to the top-left of the board, the zoom control
 * is reachable and operable from the keyboard, the board shows a grabbing hand
 * while dragging, and the console stays clean.
 */
import { expect, test, type Page } from '@playwright/test';

import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';
import {
  boardCursor,
  camera,
  CENTRE,
  centreOf,
  clickUntilDisabled,
  collectConsoleProblems,
  ctrlWheel,
  DRAG,
  dragBoard,
  expectCamera,
  expectMarkerAt,
  expectPoints,
  expectZoomLabel,
  FAR,
  gridGeometry,
  installWheelProbe,
  pageZoom,
  scrollBoard,
  VIEWPORT,
  wheelObservations,
  wrap,
  type Point,
} from './helpers/board';
import { openFreshBoard } from './helpers/share';

const ORIGIN = 'origin-marker';
const FAR_MARKER = 'test-marker-far';
const STEP = 1.25;

/**
 * Console errors seen by the current test's page. One module-level array is
 * enough because Playwright runs the tests of one worker one after another.
 */
let consoleProblems: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleProblems = collectConsoleProblems(page);
  // Story 5: a board is made, not assumed. The app's own **New board** button is
  // the shortest path to a board that exists, and it is the one a person takes.
  await openFreshBoard(page);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  // The first view is the standard view: 100% with the board start centred.
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
});

test('boots with the standard view, dot grid, hint and zoom label', async ({ page }) => {
  await expect(page.getByTestId('navigation-hint')).toHaveText(
    'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
  );
  await expectZoomLabel(page, '100%');
  await expectMarkerAt(page, ORIGIN, CENTRE);

  const grid = await gridGeometry(page);
  expect(grid.spacing).toBeCloseTo(GRID_SPACING_WORLD, 6);
  expect(grid.image).toContain('radial-gradient');
  expect(consoleProblems).toEqual([]);
});

// TC-23
test('TC-23 drag moves the board exactly with the pointer', async ({ page }) => {
  const markerBefore = await centreOf(page, ORIGIN);
  const gridBefore = await gridGeometry(page);

  await dragBoard(page, { x: 500, y: 300 }, DRAG);

  await expectMarkerAt(page, ORIGIN, { x: markerBefore.x + DRAG.x, y: markerBefore.y + DRAG.y });
  await expectCamera(page, { x: -CENTRE.x - DRAG.x, y: -CENTRE.y - DRAG.y, zoom: 1 });

  // The dot grid moved with the board (modulo its tile size).
  const gridAfter = await gridGeometry(page);
  expect(gridAfter.spacing).toBeCloseTo(gridBefore.spacing, 6);
  expect(wrap(gridAfter.offsetX - gridBefore.offsetX, gridBefore.spacing)).toBeCloseTo(
    wrap(DRAG.x, gridBefore.spacing),
    4,
  );
  expect(wrap(gridAfter.offsetY - gridBefore.offsetY, gridBefore.spacing)).toBeCloseTo(
    wrap(DRAG.y, gridBefore.spacing),
    4,
  );
});

test('the board shows a grabbing hand while dragging', async ({ page }) => {
  const grabPoint = { x: 500, y: 300 };

  expect(await boardCursor(page)).toBe('grab');
  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(grabPoint.x + DRAG.x, grabPoint.y + DRAG.y, { steps: 6 });
  expect(await boardCursor(page)).toBe('grabbing');
  await page.mouse.up();
  expect(await boardCursor(page)).toBe('grab');
});

// TC-24
test('TC-24 Ctrl + wheel zooms the board and keeps the point under the pointer', async ({
  page,
}) => {
  await installWheelProbe(page);
  const anchor = await centreOf(page, ORIGIN);

  await ctrlWheel(page, anchor, -100);

  const observations = await wheelObservations(page);
  if (!observations.some((event) => event.ctrlKey)) {
    test.skip(true, 'this engine does not deliver a Ctrl-modified wheel event');
  }

  const after = await camera(page);
  expect(after.zoom).toBeGreaterThan(1);
  // Zooming in around the pointer: that board location is still under it.
  await expectMarkerAt(page, ORIGIN, anchor);
  // Page zoom is untouched (TC-31 checks the full set of gestures).
  expect((await pageZoom(page)).scale).toBe(1);

  const label = await page.getByTestId('zoom-percent').textContent();
  expect(label).toBe(`${Math.round(after.zoom * 100)}%`);
});

// TC-31
test('TC-31 board zoom gestures leave page zoom and device pixels untouched', async ({ page }) => {
  const before = await pageZoom(page);
  expect(before.scale).toBe(1);

  const anchor = await centreOf(page, ORIGIN);
  await ctrlWheel(page, anchor, -120);
  expect((await camera(page)).zoom).toBeGreaterThan(1);
  await ctrlWheel(page, anchor, 240);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');

  // The board did zoom, and ended back on the standard view.
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  await expectZoomLabel(page, '100%');
  await expectMarkerAt(page, ORIGIN, CENTRE);

  const after = await pageZoom(page);
  expect(after.scale).toBe(before.scale);
  expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
});

test('wheel scrolling moves the board in the scroll direction', async ({ page }) => {
  await installWheelProbe(page);
  const before = await camera(page);
  const markerBefore = await centreOf(page, ORIGIN);

  await scrollBoard(page, CENTRE, { x: 0, y: 100 });

  const observations = await wheelObservations(page);
  expect(observations.length).toBeGreaterThan(0);
  const deltaY = observations.reduce(
    (sum, event) => sum + deltaPixels(event.deltaY, event.deltaMode),
    0,
  );
  expect(deltaY).not.toBe(0);

  const after = await camera(page);
  expect(after.y).toBeCloseTo(before.y + deltaY, 3);

  // Content follows the scroll: the marker ends up above where it was.
  await expectMarkerAt(page, ORIGIN, { x: markerBefore.x, y: markerBefore.y - deltaY }, 2);
});

test('grid spacing follows the zoom level', async ({ page }) => {
  const anchor = await centreOf(page, ORIGIN);
  await ctrlWheel(page, anchor, -80);
  const after = await camera(page);
  expect(after.zoom).toBeGreaterThan(1);

  const grid = await gridGeometry(page);
  expect(grid.spacing).toBeCloseTo(GRID_SPACING_WORLD * after.zoom, 4);
});

// TC-25
test('TC-25 zoom buttons stop at 400% and 10% and disable themselves', async ({ page }) => {
  const zoomIn = page.getByTestId('zoom-in');
  const zoomOut = page.getByTestId('zoom-out');

  const inSteps = await clickUntilDisabled(zoomIn, 40);
  expect(inSteps).toBeGreaterThan(0);
  await expectZoomLabel(page, '400%');
  await expect(zoomIn).toBeDisabled();
  expect((await camera(page)).zoom).toBeCloseTo(ZOOM_MAX, 6);

  const outSteps = await clickUntilDisabled(zoomOut, 60);
  expect(outSteps).toBeGreaterThan(0);
  await expectZoomLabel(page, '10%');
  await expect(zoomOut).toBeDisabled();
  expect((await camera(page)).zoom).toBeCloseTo(ZOOM_MIN, 6);
  await expectMarkerAt(page, ORIGIN, CENTRE, 2); // zooming never pans off the start

  // Zooming back the other way re-enables the button.
  await expect(zoomIn).toBeEnabled();
  await zoomIn.click();
  await expectZoomLabel(page, '13%');
});

test('the zoom control is reachable and usable from the keyboard', async ({ page }) => {
  const zoomOut = page.getByTestId('zoom-out');

  const focusedTestId = async (): Promise<string | null> =>
    page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

  await zoomOut.focus();
  await expect.poll(focusedTestId).toBe('zoom-out');
  await page.keyboard.press('Enter');
  await expectCamera(page, { x: -CENTRE.x * 1.25, y: -CENTRE.y * 1.25, zoom: 1 / STEP });
  await expectZoomLabel(page, '80%');

  // Tab reaches the neighbouring controls in DOM order.
  await page.keyboard.press('Tab');
  await expect.poll(focusedTestId).toBe('zoom-in');
  await page.keyboard.press('Space');
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });

  await page.keyboard.press('Tab');
  await expect.poll(focusedTestId).toBe('reset-view');
});

// TC-26
test('TC-26 Reset view returns to 100% with the board start centred', async ({ page }) => {
  // A million units away at 400% zoom; the far marker lands at (400, 300).
  const far = { x: FAR - 400 / ZOOM_MAX, y: FAR - 300 / ZOOM_MAX, zoom: ZOOM_MAX };
  await setCamera(page, far);
  await expectZoomLabel(page, '400%');
  await expectMarkerAt(page, FAR_MARKER, { x: 400, y: 300 });
  expect(Math.abs((await centreOf(page, ORIGIN)).x - CENTRE.x)).toBeGreaterThan(1000);

  await page.getByTestId('reset-view').click();

  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  await expectZoomLabel(page, '100%');
  await expectMarkerAt(page, ORIGIN, CENTRE);
});

// TC-27
test('TC-27 panning 1,000,000 units away still follows the pointer exactly', async ({ page }) => {
  // Put the far marker comfortably inside the viewport.
  const start = { x: FAR - 400, y: FAR - 300, zoom: 1 };
  await setCamera(page, start);
  const before = await centreOf(page, FAR_MARKER);
  expectPoints(before, { x: 400, y: 300 });

  const gridBefore = await gridGeometry(page);
  expect(gridBefore.spacing).toBeCloseTo(GRID_SPACING_WORLD, 6);
  expect(gridBefore.offsetX).toBeGreaterThanOrEqual(0);
  expect(gridBefore.offsetX).toBeLessThan(gridBefore.spacing);
  expect(gridBefore.offsetY).toBeGreaterThanOrEqual(0);
  expect(gridBefore.offsetY).toBeLessThan(gridBefore.spacing);

  await dragBoard(page, { x: 700, y: 500 }, DRAG);

  await expectMarkerAt(page, FAR_MARKER, { x: before.x + DRAG.x, y: before.y + DRAG.y });
  await expectCamera(page, { x: start.x - DRAG.x, y: start.y - DRAG.y, zoom: 1 });

  // Still no distortion at the far end.
  const gridAfter = await gridGeometry(page);
  expect(gridAfter.spacing).toBeCloseTo(GRID_SPACING_WORLD, 6);
  expect(wrap(gridAfter.offsetX - gridBefore.offsetX, gridAfter.spacing)).toBeCloseTo(
    wrap(DRAG.x, gridAfter.spacing),
    4,
  );
});

// TC-28
test('TC-28 the hint is shown on load and removed by the first drag', async ({ page }) => {
  await expect(page.getByTestId('navigation-hint')).toBeVisible();

  await dragBoard(page, { x: 300, y: 300 }, { x: 40, y: 20 });

  await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
});

test('TC-29 a click without movement moves nothing and keeps the hint', async ({ page }) => {
  await expectMarkerAt(page, ORIGIN, CENTRE);

  await page.mouse.click(600, 400);
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });

  await expectMarkerAt(page, ORIGIN, CENTRE, 0.5);
  await expect(page.getByTestId('navigation-hint')).toBeVisible();
});

test('TC-30 Ctrl + wheel over the zoom control does not zoom the board', async ({ page }) => {
  await installWheelProbe(page);

  const control = await page.getByTestId('zoom-controls').boundingBox();
  if (!control) throw new Error('zoom control missing');
  const overControl: Point = {
    x: control.x + control.width / 2,
    y: control.y + control.height / 2,
  };

  await ctrlWheel(page, overControl, -100);

  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  await expectZoomLabel(page, '100%');
  await expectMarkerAt(page, ORIGIN, CENTRE, 0.5);
  // The wheel never reaches the board surface.
  expect((await wheelObservations(page)).length).toBe(0);
});

test('resizing the window keeps content anchored to the top-left of the board', async ({
  page,
}) => {
  const before = await centreOf(page, ORIGIN);

  await page.setViewportSize({ width: VIEWPORT.width - 200, height: VIEWPORT.height - 150 });

  // The camera does not move, so neither does the content relative to the
  // top-left corner of the board area.
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  expectPoints(await centreOf(page, ORIGIN), before, 0.5);
});

test('Ctrl/Cmd shortcuts zoom around the centre and reset the view', async ({ page }) => {
  await page.keyboard.press('Control+=');
  // Zooming around the centre of the board area keeps the start centred.
  await expectCamera(page, { x: -CENTRE.x / STEP, y: -CENTRE.y / STEP, zoom: STEP });
  await expectZoomLabel(page, '125%');

  await page.keyboard.press('Control+-');
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  await expectZoomLabel(page, '100%');

  await dragBoard(page, { x: 400, y: 300 }, DRAG);
  await page.keyboard.press('Control+0');
  await expectCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  await expectMarkerAt(page, ORIGIN, CENTRE);
});

async function setCamera(page: Page, next: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((value) => {
    const api = window.__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing; build with `npm run build:test`');
    api.setCamera(value);
  }, next);
  await expectCamera(page, next);
}

function deltaPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}
