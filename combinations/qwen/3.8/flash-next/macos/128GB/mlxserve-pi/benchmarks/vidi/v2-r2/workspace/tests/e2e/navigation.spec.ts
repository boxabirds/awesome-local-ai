// End-to-end navigation of the infinite board in real browsers. The TC ids are
// the Acceptance Cases in spec/stories/001-pan-and-zoom-around-an-infinite-board/
// design.md. Run against the test build (MODE=test) so the camera can be jumped
// far away instead of dragging a million pixels.

import { test, expect, type Page } from '@playwright/test';
import type { Locator } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  VIEWPORT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  type GridGeometry,
  areaCentre,
  ctrlWheel,
  dragBoard,
  expectPixels,
  gridGeometry,
  hintLocator,
  markerCentre,
  nearestDot,
  originMarker,
  pageZoom,
  readCamera,
  resetViewButton,
  scrollBoard,
  setCamera,
  settledCamera,
  waitForCameraChange,
  watchPrevented,
  wheelLog,
  zoomInButton,
  zoomLabelChanged,
  zoomLabelLocator,
  zoomOutButton,
} from './helpers/board';
import { Screenshot } from './helpers/pixels';

/** Band of the board that pixel rows are sampled in: clear of the controls. */
const PROBE_BAND = { from: 60, to: 400 };
/** Trackpad scroll that TC-24 uses (negative is zoom in). */
const ZOOM_WHEEL_DELTA = -100;
/** The zoom multiplier ZOOM_WHEEL_DELTA produces at WHEEL_ZOOM_SENSITIVITY. */
const WHEEL_FACTOR = Math.exp(-ZOOM_WHEEL_DELTA * 0.01);
/** One stepped zoom out through the wheel: 4 * e^-0.2. */
const STEP_OUT_WHEEL_DELTA = 20;
const STEP_OUT_FACTOR = Math.exp(-STEP_OUT_WHEEL_DELTA * 0.01);

/**
 * Hold Ctrl (Cmd on macOS would be the same path) and press a key, as a real
 * keyboard shortcut: the page can only win it by calling preventDefault.
 */
async function pressShortcut(page: Page, key: string): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/** A real mouse click at a control's centre, bypassing actionability checks. */
async function rawClick(page: Page, control: Locator): Promise<void> {
  const box = await control.boundingBox();
  if (box === null) throw new Error('the control is not rendered');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * A pixel row that crosses a line of grid dots, so pixel sampling looks at dots
 * rather than at the empty space between two rows.
 */
function dotRow(geom: GridGeometry): number {
  const base = geom.offsetY + geom.spacing / 2;
  const row = base + Math.ceil((PROBE_BAND.from - base) / geom.spacing) * geom.spacing;
  if (row > PROBE_BAND.to) throw new Error(`no dot row between ${PROBE_BAND.from} and ${PROBE_BAND.to}`);
  return Math.round(row);
}

test.describe('first visit navigation', () => {
  // TC-28
  test('the navigation hint explains the gestures and the first one removes it', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    const hint = hintLocator(page);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    await dragBoard(page, { x: 400, y: 300 }, { x: 520, y: 380 });
    await expect(hint).toHaveCount(0);

    // it stays hidden for the rest of the visit, whatever else happens
    await scrollBoard(page, { x: 640, y: 400 }, 0, 120);
    await expect(hint).toHaveCount(0);
    await ctrlWheel(page, { x: 640, y: 400 }, ZOOM_WHEEL_DELTA, browserName);
    await settledCamera(page);
    await expect(hint).toHaveCount(0);
    await resetViewButton(page).click();
    await settledCamera(page);
    await expect(hint).toHaveCount(0);

    // a fresh page load is a new visit, so the hint comes back
    await page.reload();
    await expect(hintLocator(page)).toBeVisible();
  });

  // TC-23
  test('a mouse drag moves the board by exactly the pointer delta', async ({ page }) => {
    await page.goto('/');
    await expect(originMarker(page)).toBeVisible();
    expect(await areaCentre(page)).toEqual({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });

    const before = await markerCentre(page);
    const start = await readCamera(page);
    const geom = await gridGeometry(page);
    expect(geom.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    const dotBefore = nearestDot(geom, { x: 900, y: 300 });
    const shotBefore = await Screenshot.capture(page);
    const renderedBefore = await shotBefore.darkestNeutralNear(dotBefore.x, dotBefore.y);
    await shotBefore.close();

    await dragBoard(page, { x: 300, y: 300 }, { x: 500, y: 400 });

    // the camera moved by exactly 200 by 100 world units at 100% zoom
    const camera = await waitForCameraChange(page, start);
    expect(camera.x).toBeCloseTo(start.x - 200, 6);
    expect(camera.y).toBeCloseTo(start.y - 100, 6);
    expect(camera.zoom).toBeCloseTo(1, 9);

    // the board's start point moved with the pointer, to the pixel
    const after = await markerCentre(page);
    expectPixels(after.x - before.x, 200);
    expectPixels(after.y - before.y, 100);
    expect(camera.y).toBeCloseTo(start.y - 100, 6);
    expect(camera.zoom).toBeCloseTo(1, 9);

    // the same grid dot is still there, 200 by 100 pixels further along
    const geomAfter = await gridGeometry(page);
    expect(geomAfter.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    const dotAfter = nearestDot(geomAfter, { x: dotBefore.x + 200, y: dotBefore.y + 100 });
    expectPixels(dotAfter.x, dotBefore.x + 200);
    expectPixels(dotAfter.y, dotBefore.y + 100);

    // and it is really the same dot in the rendered pixels
    const shotAfter = await Screenshot.capture(page);
    const renderedAfter = await shotAfter.darkestNeutralNear(dotAfter.x, dotAfter.y);
    await shotAfter.close();
    // screenshots are whole device pixels, so the delta carries 2px of rounding
    expectPixels(renderedAfter.x - renderedBefore.x, 200, 2);
    expectPixels(renderedAfter.y - renderedBefore.y, 100, 2);
  });

  // TC-24
  test('Ctrl/Cmd + wheel zooms the board and keeps the point under the pointer', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    await watchPrevented(page);
    const zoomBefore = await pageZoom(page);
    const geom = await gridGeometry(page);
    const dot = nearestDot(geom, { x: 700, y: 400 });
    const before = await readCamera(page);

    await ctrlWheel(page, dot, ZOOM_WHEEL_DELTA, browserName);

    // the wheel zooms continuously, it is not a zoom step
    const camera = await waitForCameraChange(page, before);
    expect(camera.zoom).toBeCloseTo(WHEEL_FACTOR, 6);

    // the dot the pointer was over is still under it
    const geomAfter = await gridGeometry(page);
    expect(geomAfter.spacing).toBeCloseTo(GRID_SPACING_WORLD * WHEEL_FACTOR, 3);
    const dotAfter = nearestDot(geomAfter, dot);
    expectPixels(dotAfter.x, dot.x);
    expectPixels(dotAfter.y, dot.y);

    // the board consumed the gesture, so the browser does not zoom the page
    const log = await wheelLog(page);
    expect(log.filter((entry) => entry.ctrl).map((entry) => entry.prevented)).toEqual([true]);
    const zoomAfter = await pageZoom(page);
    expect(zoomAfter.scale).toBe(zoomBefore.scale);
    expect(zoomAfter.devicePixelRatio).toBe(zoomBefore.devicePixelRatio);
  });
});

test.describe('limits and recovery', () => {
  // TC-25
  test('zooming in stops at 400% and the zoom-in control is disabled', async ({ page }) => {
    await page.goto('/');
    const labels: string[] = [];
    for (let i = 0; i < 12; i++) {
      if (await zoomInButton(page).isDisabled()) break;
      await zoomInButton(page).click();
      labels.push(await zoomLabelChanged(page, labels[labels.length - 1] ?? '100%'));
    }
    expect(labels).toEqual(['125%', '156%', '195%', '244%', '305%', '381%', '400%']);
    await expect(zoomLabelLocator(page)).toHaveText('400%');
    expect(await zoomInButton(page).getAttribute('disabled')).not.toBeNull();
    expect((await settledCamera(page)).zoom).toBeCloseTo(ZOOM_MAX, 9);

    // a further real click on the disabled control does nothing
    await rawClick(page, zoomInButton(page));
    expect((await readCamera(page)).zoom).toBeCloseTo(ZOOM_MAX, 9);
    await expect(zoomLabelLocator(page)).toHaveText('400%');

    // one step back re-enables it: 4 / 1.25 is not a step, so no snapping
    await zoomOutButton(page).click();
    await expect(zoomLabelLocator(page)).toHaveText('320%');
    await expect(zoomInButton(page)).toBeEnabled();
    expect(await zoomInButton(page).getAttribute('disabled')).toBeNull();
  });

  // TC-26
  test('Reset view returns to 100% at the board start from far away', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabelLocator(page)).toHaveText('400%');

    const beforeReset = await readCamera(page);
    await resetViewButton(page).click();

    await expect(zoomLabelLocator(page)).toHaveText('100%');
    const camera = await waitForCameraChange(page, beforeReset);
    expect(camera.x).toBeCloseTo(-VIEWPORT.width / 2, 6);
    expect(camera.y).toBeCloseTo(-VIEWPORT.height / 2, 6);
    expect(camera.zoom).toBeCloseTo(1, 9);
    // the board's starting point is back at the centre of the board area
    const centre = await areaCentre(page);
    const marker = await markerCentre(page);
    expectPixels(marker.x, centre.x);
    expectPixels(marker.y, centre.y);
  });
});

test.describe('far travel', () => {
  // TC-27: dragging a million units away behaves exactly as anywhere else
  test('dragging a million units away moves the board by exactly the delta', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    const before = await readCamera(page);
    expect(before.x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);

    const geom = await gridGeometry(page);
    expect(geom.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);

    await dragBoard(page, { x: 300, y: 300 }, { x: 500, y: 400 });

    const after = await waitForCameraChange(page, before);
    expect(after.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200, 6);
    expect(after.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100, 6);
    expect(after.zoom).toBeCloseTo(1, 9);

    // the grid keeps its spacing, with no distortion that far out
    const geomAfter = await gridGeometry(page);
    expect(geomAfter.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    const shot = await Screenshot.capture(page);
    const centres = await shot.dotCentresAlongRow(dotRow(geomAfter), 40, 700);
    await shot.close();
    expect(centres.length).toBeGreaterThan(10);
    const gaps = centres.slice(1).map((x, index) => x - centres[index]);
    expect(gaps.length).toBeGreaterThan(9);
    for (const gap of gaps) {
      expect(Math.abs(gap - GRID_SPACING_WORLD)).toBeLessThanOrEqual(1);
    }
  });

  // TC-27: at maximum zoom the grid is GRID_SPACING_WORLD * zoom pixels apart,
  // and zooming there keeps the point under the pointer fixed
  test('the rendered grid is GRID_SPACING_WORLD * zoom apart far from the origin', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    const geom = await gridGeometry(page);
    expect(geom.spacing).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_MAX, 3);

    const shot = await Screenshot.capture(page);
    const centres = await shot.dotCentresAlongRow(dotRow(geom), 40, 700);
    await shot.close();
    expect(centres.length).toBeGreaterThan(4);
    const gaps = centres.slice(1).map((x, index) => x - centres[index]);
    for (const gap of gaps) {
      expect(Math.abs(gap - GRID_SPACING_WORLD * ZOOM_MAX)).toBeLessThanOrEqual(1);
    }

    const dot = nearestDot(geom, { x: 400, y: 300 });
    const before = await readCamera(page);
    await ctrlWheel(page, dot, STEP_OUT_WHEEL_DELTA, browserName);
    const camera = await waitForCameraChange(page, before);
    expect(camera.zoom).toBeCloseTo(ZOOM_MAX * STEP_OUT_FACTOR, 6);

    const geomAfter = await gridGeometry(page);
    const dotAfter = nearestDot(geomAfter, dot);
    expectPixels(dotAfter.x, dot.x);
    expectPixels(dotAfter.y, dot.y);
  });
});

test.describe('another window size', () => {
  // The second fixture size in the design (1920x1080): the board area is the
  // window, so a wider window means a different world coordinate at the top-left
  // and a different place for Reset view to centre on.
  test('a wider window pans the same and Reset view centres on its own size', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    expect(await areaCentre(page)).toEqual({ x: 960, y: 540 });

    const start = await readCamera(page);
    expect(start.x).toBeCloseTo(-960, 6); // the board starts centred for this window
    expect(start.y).toBeCloseTo(-540, 6);
    expect(start.zoom).toBeCloseTo(1, 9);

    await dragBoard(page, { x: 300, y: 300 }, { x: 500, y: 400 });
    const moved = await waitForCameraChange(page, start);
    expect(moved.x).toBeCloseTo(-1160, 6);
    expect(moved.y).toBeCloseTo(-640, 6);

    // shrinking the window leaves the world coordinate shown at the top alone
    await page.setViewportSize({ width: 1280, height: 800 });
    const resized = await settledCamera(page);
    expect(resized.x).toBeCloseTo(moved.x, 6);
    expect(resized.y).toBeCloseTo(moved.y, 6);
    expect(resized.zoom).toBeCloseTo(1, 9);

    // Reset view centres the board's starting point in the new window size
    await resetViewButton(page).click();
    const reset = await waitForCameraChange(page, resized);
    expect(reset.x).toBeCloseTo(-640, 6);
    expect(reset.y).toBeCloseTo(-400, 6);
    expect(reset.zoom).toBeCloseTo(1, 9);
    await expect(zoomLabelLocator(page)).toHaveText('100%');
    const centre = await areaCentre(page);
    const marker = await markerCentre(page);
    expectPixels(marker.x, centre.x);
    expectPixels(marker.y, centre.y);
  });
});

test.describe('the page itself is never zoomed', () => {
  // TC-31 (negative case)
  test('board gestures leave the browser page zoom alone', async ({ page, browserName }) => {
    await page.goto('/');
    const before = await pageZoom(page);

    let camera = await readCamera(page);

    await ctrlWheel(page, { x: 640, y: 400 }, ZOOM_WHEEL_DELTA, browserName);
    camera = await waitForCameraChange(page, camera);
    expect(camera.zoom).toBeCloseTo(WHEEL_FACTOR, 6);

    // the same gestures as browser page zoom shortcuts: all are ours
    await pressShortcut(page, '=');
    camera = await waitForCameraChange(page, camera);
    expect(camera.zoom).toBeCloseTo(WHEEL_FACTOR * ZOOM_STEP_FACTOR, 6);

    await pressShortcut(page, '-');
    camera = await waitForCameraChange(page, camera);
    expect(camera.zoom).toBeCloseTo(WHEEL_FACTOR, 6);

    await pressShortcut(page, '0');
    camera = await waitForCameraChange(page, camera);
    expect(camera.zoom).toBeCloseTo(1, 9);

    const after = await pageZoom(page);
    expect(after.scale).toBe(before.scale);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
    expect(after.innerWidth).toBe(before.innerWidth);
    expect(after.innerHeight).toBe(before.innerHeight);

    // nothing scaled: the screenshot still maps CSS pixels to device pixels the
    // same way, and covers the whole board area
    const shot = await Screenshot.capture(page);
    expect(shot.deviceScale).toBe(before.devicePixelRatio);
    expect(Math.round(shot.width)).toBe(VIEWPORT.width);
    expect(Math.round(shot.height)).toBe(VIEWPORT.height);
    await shot.close();
  });
});
