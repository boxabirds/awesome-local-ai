import { expect, test } from '@playwright/test';
import {
  FAR,
  GRID_SPACING_WORLD,
  INITIAL_CAMERA,
  PX,
  VIEWPORT,
  clickControl,
  clickUntilDisabled,
  ctrlWheelAt,
  distance,
  forceClick,
  dragBoard,
  gridTile,
  markerCentre,
  measuredCamera,
  nearestDot,
  openBoard,
  pageZoomSignals,
  readCamera,
  screenToWorld,
  setCamera,
  worldToScreen,
  zoomLabel,
} from './helpers/board';

const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Place the camera on a known view and wait for the pixels to agree. */
async function knownView(page: import('@playwright/test').Page): Promise<void> {
  await setCamera(page, INITIAL_CAMERA);
  const centre = await markerCentre(page);
  expect(centre.x).toBeCloseTo(CENTRE.x, 0);
  expect(centre.y).toBeCloseTo(CENTRE.y, 0);
  expect(await zoomLabel(page)).toBe('100%');
}

test('TC-23: dragging the empty board pans the camera by exactly the pointer delta', async ({
  page,
}) => {
  await openBoard(page);
  await knownView(page);

  const before = await readCamera(page);
  const markerBefore = await markerCentre(page);
  const gridBefore = await gridTile(page);

  const from = { x: 300, y: 200 };
  const to = { x: 500, y: 300 };
  await dragBoard(page, from, to);

  const after = await readCamera(page);
  const markerAfter = await markerCentre(page);

  // the camera moved by exactly the pointer delta in world units at this zoom
  expect(after.x).toBeCloseTo(before.x - (to.x - from.x) / before.zoom, 6);
  expect(after.y).toBeCloseTo(before.y - (to.y - from.y) / before.zoom, 6);

  // painted evidence: the marker followed the pointer by exactly the pointer delta
  expect(Math.round(markerAfter.x - markerBefore.x)).toBe(to.x - from.x);
  expect(Math.round(markerAfter.y - markerBefore.y)).toBe(to.y - from.y);

  // The dot grid is a lattice with the configured world spacing at this zoom, and it
  // translated rigidly with the board: the marker sits on a dot before and after, and
  // the lattice offset moved by exactly the drag delta modulo the tile period.
  const gridAfter = await gridTile(page);
  expect(Math.abs(gridBefore.spacing - GRID_SPACING_WORLD * before.zoom)).toBeLessThan(0.02);
  expect(Math.abs(gridAfter.spacing - gridBefore.spacing)).toBeLessThan(0.02);
  expect(distance(nearestDot(gridBefore, markerBefore), markerBefore)).toBeLessThanOrEqual(PX);
  expect(distance(nearestDot(gridAfter, markerAfter), markerAfter)).toBeLessThanOrEqual(PX);
  for (const [beforeOffset, afterOffset, moved] of [
    [gridBefore.offsetX, gridAfter.offsetX, markerAfter.x - markerBefore.x],
    [gridBefore.offsetY, gridAfter.offsetY, markerAfter.y - markerBefore.y],
  ] as const) {
    expect(
      Math.abs(
        wrapped(afterOffset - beforeOffset, gridBefore.spacing) -
          wrapped(moved, gridBefore.spacing),
      ),
    ).toBeLessThan(0.05);
  }

  // and a world point still sits under the released pointer position
  expect(distance(screenToWorld(after, to), screenToWorld(before, from))).toBeLessThanOrEqual(
    PX / before.zoom,
  );

  expect(after.zoom).toBe(before.zoom);
});

/** A difference of positions on a repeating lattice, in `[0, period)`. */
function wrapped(value: number, period: number): number {
  return ((value % period) + period) % period;
}

test('TC-24: Ctrl/Cmd + wheel zooms the board and leaves the browser page zoom alone', async ({
  page,
}) => {
  await openBoard(page);
  await knownView(page);

  const zoomBefore = await readCamera(page);
  const markerBefore = await markerCentre(page);
  const browserBefore = await pageZoomSignals(page);

  // the gesture a trackpad pinch sends on desktop: ctrl + wheel, centred on the marker
  await ctrlWheelAt(page, markerBefore, -100);

  const after = await readCamera(page);
  expect(after.zoom).toBeGreaterThan(zoomBefore.zoom);

  // the point under the pointer stayed under the pointer
  const markerAfter = await markerCentre(page);
  expect(distance(markerBefore, markerAfter)).toBeLessThanOrEqual(PX);

  // the dot lattice scaled with the camera and stays welded to it
  const tile = await gridTile(page);
  expect(Math.abs(tile.spacing - GRID_SPACING_WORLD * after.zoom)).toBeLessThan(0.02);
  const dot = nearestDot(tile, markerAfter);
  expect(distance(dot, markerAfter)).toBeLessThanOrEqual(PX);

  // the browser's own page zoom is untouched
  const browserAfter = await pageZoomSignals(page);
  expect(browserAfter.visualViewportScale).toBeCloseTo(browserBefore.visualViewportScale, 6);
  expect(browserAfter.devicePixelRatio).toBeCloseTo(browserBefore.devicePixelRatio, 6);
});

test('TC-25: Zoom in steps by one factor per click and disables itself at the maximum', async ({
  page,
}) => {
  await openBoard(page);
  await knownView(page);

  // one click is exactly one step: 100% -> 125%
  await clickControl(page, 'Zoom in');
  expect(await zoomLabel(page)).toBe('125%');
  expect((await readCamera(page)).zoom).toBeCloseTo(1.25, 6);

  // the grid tile follows the step
  expect(Math.abs((await gridTile(page)).spacing - GRID_SPACING_WORLD * 1.25)).toBeLessThan(0.02);

  // keep clicking: the label keeps stepping and stops at 400% with a disabled attribute
  const clicks = await clickUntilDisabled(page, 'Zoom in');
  expect(await zoomLabel(page)).toBe('400%');
  expect((await readCamera(page)).zoom).toBe(4);
  expect(clicks).toBeGreaterThanOrEqual(6);
  expect(await page.getByRole('button', { name: 'Zoom in' }).isDisabled()).toBe(true);

  // negative: a disabled control cannot push past the limit
  await forceClick(page, 'Zoom in');
  expect(await zoomLabel(page)).toBe('400%');
  expect((await readCamera(page)).zoom).toBe(4);
});

test('TC-26: Reset view returns a camera a million pixels away to the known view', async ({
  page,
}) => {
  await openBoard(page);
  await knownView(page);

  await setCamera(page, { x: FAR, y: FAR, zoom: 4 });
  expect(await zoomLabel(page)).toBe('400%');

  await clickControl(page, 'Reset view');

  expect(await zoomLabel(page)).toBe('100%');
  const camera = await readCamera(page);
  expect(camera).toEqual(INITIAL_CAMERA);
  // measured from the painted marker, not only from state
  expect((await measuredCamera(page)).zoom).toBe(1);
  // the camera is the exact known view, not merely a screen that looks similar
  expect(camera.x).toBe(-VIEWPORT.width / 2);
  expect(camera.y).toBe(-VIEWPORT.height / 2);
  expect(camera.zoom).toBe(1);

  const centre = await markerCentre(page);
  expect(Math.abs(centre.x - CENTRE.x)).toBeLessThanOrEqual(PX);
  expect(Math.abs(centre.y - CENTRE.y)).toBeLessThanOrEqual(PX);
  expect(Math.abs((await gridTile(page)).spacing - GRID_SPACING_WORLD)).toBeLessThan(0.02);
});

test('TC-27: pan, zoom and reset stay consistent a million pixels away, at 1x and at 2x', async ({
  page,
}) => {
  await openBoard(page);

  for (const zoom of [1, 2]) {
    await setCamera(page, { x: FAR + 37, y: -FAR - 11, zoom });
    expect(await zoomLabel(page)).toBe(`${Math.round(zoom * 100)}%`);

    const before = await readCamera(page);
    const markerBefore = await markerCentre(page);
    const expectedMarker = worldToScreen(before, { x: 0, y: 0 });
    expect(distance(markerBefore, expectedMarker)).toBeLessThanOrEqual(PX);

    // the grid tile is the configured world spacing at this zoom
    const tile = await gridTile(page);
    expect(Math.abs(tile.spacing - GRID_SPACING_WORLD * zoom)).toBeLessThan(0.02);

    const from = { x: 400, y: 250 };
    const to = { x: 600, y: 350 };
    await dragBoard(page, from, to);

    const after = await readCamera(page);
    expect(after.x).toBeCloseTo(before.x - 200 / zoom, 6);
    expect(after.y).toBeCloseTo(before.y - 100 / zoom, 6);

    const markerAfter = await markerCentre(page);
    expect(distance(markerAfter, worldToScreen(after, { x: 0, y: 0 }))).toBeLessThanOrEqual(PX);
    expect(Math.round(markerAfter.x - markerBefore.x)).toBe(200);
    expect(Math.round(markerAfter.y - markerBefore.y)).toBe(100);

    // the same dot is still under the marker: lattice and camera share one transform
    const dotAfter = nearestDot(await gridTile(page), markerAfter);
    expect(distance(dotAfter, markerAfter)).toBeLessThanOrEqual(PX);
  }

  // reset from that far-away view brings the known view back
  await clickControl(page, 'Reset view');
  expect(await zoomLabel(page)).toBe('100%');
  expect(await readCamera(page)).toEqual(INITIAL_CAMERA);
});

test('TC-28: the first-use navigation hint appears once and never again', async ({ page }) => {
  await openBoard(page);

  const hint = page.getByTestId('navigation-hint');
  await expect(hint).toBeVisible();

  // first navigation: a plain drag on the empty board
  await dragBoard(page, { x: 300, y: 200 }, { x: 500, y: 300 });
  await expect(hint).toHaveCount(0);

  // it does not come back for further navigation
  await dragBoard(page, { x: 700, y: 400 }, { x: 650, y: 600 });
  await ctrlWheelAt(page, CENTRE, -100);
  await clickControl(page, 'Zoom out');
  await expect(hint).toHaveCount(0);

  // a click without movement never brings it back either
  await page.mouse.click(200, 200);
  await expect(hint).toHaveCount(0);
});

test('TC-31: navigation leaves the browser page zoom unchanged', async ({ page }) => {
  await openBoard(page);
  await knownView(page);

  const before = await pageZoomSignals(page);

  await ctrlWheelAt(page, { x: 400, y: 300 }, -240);
  await expect(page.getByTestId('zoom-label')).not.toHaveText('100%');

  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');

  const after = await pageZoomSignals(page);
  expect(after.visualViewportScale).toBeCloseTo(before.visualViewportScale, 6);
  expect(after.devicePixelRatio).toBeCloseTo(before.devicePixelRatio, 6);

  // the board itself is back at the known view through its own shortcuts
  expect(await readCamera(page)).toEqual(INITIAL_CAMERA);
  expect(await zoomLabel(page)).toBe('100%');
});
