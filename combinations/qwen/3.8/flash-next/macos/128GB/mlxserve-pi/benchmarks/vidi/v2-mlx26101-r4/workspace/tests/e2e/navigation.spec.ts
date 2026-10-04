import { expect, test } from '@playwright/test';

import {
  BOARD_AREA,
  DRAG_DOWN,
  DRAG_RIGHT,
  canZoomIn,
  canZoomOut,
  ctrlWheel,
  digitsFor,
  dragBoard,
  expectedGridPeriod,
  expectPixels,
  getCamera,
  gridDot,
  gridGeometry,
  hint,
  interactionState,
  nearestGridDot,
  openBoard,
  originMarker,
  originOnScreen,
  percentOf,
  resetButton,
  screenToWorld,
  setCamera,
  settled,
  wheel,
  worldLayer,
  worldToScreen,
  zoomInButton,
  zoomInUntilDisabled,
  zoomLabel,
  zoomOutButton,
  zoomOutUntilDisabled,
} from './helpers/board';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const START_POINT = { x: BOARD_AREA.width / 2, y: BOARD_AREA.height / 2 };
const DRAG_FROM = { x: 400, y: 300 };
/** One wheel notch: scrolling down moves the camera towards larger coordinates. */
const WHEEL_PAN = 120;
/** One wheel notch with Ctrl held: negative zooms in. */
const WHEEL_ZOOM = -240;
const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test('TC-28 + TC-23: the first drag moves the board exactly and dismisses the hint', async ({ page }) => {
  await openBoard(page);

  // The board opens framed on its starting point, with the hint up.
  await expect(hint(page)).toHaveText(HINT_TEXT);
  expect(await interactionState(page)).toBe('idle');
  const opening = await settled(page);
  const originBefore = await originOnScreen(page);
  expectPixels(originBefore.x, START_POINT.x, 'the board opens with its starting point centred');
  expectPixels(originBefore.y, START_POINT.y, 'the board opens with its starting point centred');
  expect((await gridGeometry(page)).period).toBeCloseTo(GRID_SPACING_WORLD, 6);

  await page.mouse.move(DRAG_FROM.x, DRAG_FROM.y);
  await page.mouse.down();
  expect(await interactionState(page)).toBe('panning');
  await page.mouse.move(DRAG_FROM.x + DRAG_RIGHT / 2, DRAG_FROM.y + DRAG_DOWN / 2, { steps: 4 });
  expect(await interactionState(page)).toBe('panning');
  await page.mouse.move(DRAG_FROM.x + DRAG_RIGHT, DRAG_FROM.y + DRAG_DOWN, { steps: 4 });
  await page.mouse.up();
  expect(await interactionState(page)).toBe('idle');

  // At zoom 1 a drag of 200/100 screen px moves the camera by 200/100 world units,
  // the other way.
  const camera = await settled(page);
  expect(camera.x).toBeCloseTo(-BOARD_AREA.width / 2 - DRAG_RIGHT, 6);
  expect(camera.y).toBeCloseTo(-BOARD_AREA.height / 2 - DRAG_DOWN, 6);
  expect(camera.zoom).toBe(1);
  expect(opening.zoom).toBe(1);

  // Content moved with the pointer by exactly the drag.
  const originAfter = await originOnScreen(page);
  expectPixels(originAfter.x - originBefore.x, DRAG_RIGHT, 'the starting point moved right');
  expectPixels(originAfter.y - originBefore.y, DRAG_DOWN, 'the starting point moved down');

  // The dot grid is drawn from the same camera: one cell per GRID_SPACING_WORLD
  // world units, and the painted offset stays inside one cell.
  const period = expectedGridPeriod(camera.zoom);
  const dot = await gridDot(page, 0, 0);
  expect(dot.x).toBeGreaterThanOrEqual(0);
  expect(dot.y).toBeGreaterThanOrEqual(0);
  expect(dot.x).toBeLessThan(period);
  expect(dot.y).toBeLessThan(period);
  expect((await gridGeometry(page)).period).toBeCloseTo(period, 6);

  // The hint is gone and stays gone for the rest of the visit.
  await expect(hint(page)).toHaveCount(0);
  await dragBoard(page, { x: 200, y: 200 }, -60, 30);
  await settled(page);
  await expect(hint(page)).toHaveCount(0);
});

test('TC-24: Ctrl + wheel zooms around the pointer and leaves the page zoom alone', async ({ page }) => {
  await openBoard(page);
  const pointer = { x: 500, y: 340 };
  const before = await settled(page);
  const visualScaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

  await ctrlWheel(page, pointer, WHEEL_ZOOM);

  const after = await settled(page);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);

  // The board location under the pointer is still under it.
  const worldBefore = screenToWorld(before, pointer);
  const worldAfter = screenToWorld(after, pointer);
  expectPixels((worldAfter.x - worldBefore.x) * after.zoom, 0, 'the world point stayed under the pointer');
  expectPixels((worldAfter.y - worldBefore.y) * after.zoom, 0, 'the world point stayed under the pointer');

  // Grid dots sit on multiples of GRID_SPACING_WORLD in world units. Only the point
  // under the pointer stands still in a zoom, so the check for the grid is that its
  // distance from the pointer scaled by exactly the same ratio as the zoom.
  const dotWorld = {
    x: Math.round(worldBefore.x / GRID_SPACING_WORLD) * GRID_SPACING_WORLD,
    y: Math.round(worldBefore.y / GRID_SPACING_WORLD) * GRID_SPACING_WORLD,
  };
  const ratio = after.zoom / before.zoom;
  expectPixels(
    worldToScreen(after, dotWorld).x - pointer.x,
    (worldToScreen(before, dotWorld).x - pointer.x) * ratio,
    'the grid scaled away from the pointer',
  );
  expectPixels(
    worldToScreen(after, dotWorld).y - pointer.y,
    (worldToScreen(before, dotWorld).y - pointer.y) * ratio,
    'the grid scaled away from the pointer',
  );
  expectPixels((await gridGeometry(page)).period, expectedGridPeriod(after.zoom), 'the grid scaled with the zoom');

  // The page itself was not zoomed by the gesture.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(visualScaleBefore);
});

test('TC-15 (browser): plain wheel pans the board and never scrolls the page', async ({ page }) => {
  await openBoard(page);
  const before = await settled(page);
  const originBefore = await originOnScreen(page);
  const at = { x: 600, y: 400 };

  // Scrolling down moves the camera down, so the content moves up by the wheel delta.
  await wheel(page, 0, WHEEL_PAN, at);
  const afterDown = await settled(page);
  expect(afterDown.y - before.y).toBeCloseTo(WHEEL_PAN / before.zoom, 6);
  expectPixels((await originOnScreen(page)).y - originBefore.y, -WHEEL_PAN / before.zoom, 'content moved up');

  // Scrolling right moves the camera right, so the content moves left.
  await wheel(page, WHEEL_PAN, 0, at);
  const afterRight = await settled(page);
  expect(afterRight.x - afterDown.x).toBeCloseTo(WHEEL_PAN / before.zoom, 6);
  expectPixels((await originOnScreen(page)).x - originBefore.x, -WHEEL_PAN / before.zoom, 'content moved left');

  // The document never scrolled instead of the board.
  const scrolled = await page.evaluate(() => {
    const scroller = document.scrollingElement;
    return (scroller?.scrollTop ?? 0) + (scroller?.scrollLeft ?? 0);
  });
  expect(scrolled).toBe(0);
});

test('TC-25: clicking + until it is disabled ends at 400%', async ({ page }) => {
  await openBoard(page);
  await expect(zoomLabel(page)).toHaveText(percentOf(1));

  const labels = await zoomInUntilDisabled(page);

  expect(labels.length).toBeGreaterThanOrEqual(4);
  expect(labels[0]).toBe(percentOf(ZOOM_STEP_FACTOR));
  expect(labels[labels.length - 1]).toBe(percentOf(ZOOM_MAX));
  const values = labels.map((label) => Number.parseFloat(label));
  expect(values.every((value, index) => index === 0 || value > values[index - 1])).toBe(true);

  await expect(zoomInButton(page)).toBeDisabled();
  await expect(zoomOutButton(page)).toBeEnabled();
  const camera = await getCamera(page);
  expect(camera.zoom).toBe(ZOOM_MAX);
  expect(canZoomIn(camera)).toBe(false);
});

test('TC-25b: clicking - down to the minimum disables it, and + steps back by 1.25', async ({ page }) => {
  await openBoard(page);

  const labels = await zoomOutUntilDisabled(page);

  expect(labels[labels.length - 1]).toBe(percentOf(ZOOM_MIN));
  await expect(zoomOutButton(page)).toBeDisabled();
  await expect(zoomInButton(page)).toBeEnabled();
  const atMin = await getCamera(page);
  expect(atMin.zoom).toBe(ZOOM_MIN);
  expect(canZoomOut(atMin)).toBe(false);

  await zoomInButton(page).click();
  const zoomed = await settled(page);
  expect(zoomed.zoom).toBeCloseTo(ZOOM_MIN * ZOOM_STEP_FACTOR, 9);
  await expect(zoomLabel(page)).toHaveText(percentOf(ZOOM_MIN * ZOOM_STEP_FACTOR));
});

test('TC-26: Reset view returns to 100% with the starting point centred, from far away', async ({ page }) => {
  await openBoard(page);

  const far = await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: -UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX,
  });
  await expect(zoomLabel(page)).toHaveText(percentOf(ZOOM_MAX));
  expect(Math.abs(far.x)).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
  expect(Math.abs((await originOnScreen(page)).x)).toBeGreaterThan(BOARD_AREA.width);

  await resetButton(page).click();

  await expect(zoomLabel(page)).toHaveText(percentOf(1));
  const centred = await originOnScreen(page);
  expectPixels(centred.x, START_POINT.x, 'the starting point is centred after reset');
  expectPixels(centred.y, START_POINT.y, 'the starting point is centred after reset');
  const camera = await settled(page);
  expect(camera.zoom).toBe(1);
  expect(camera.x).toBeCloseTo(-BOARD_AREA.width / 2, 6);
  expect(camera.y).toBeCloseTo(-BOARD_AREA.height / 2, 6);
});

test('TC-27: panning still works exactly at 1,000,000 world units from the start', async ({ page }) => {
  await openBoard(page);
  const before = await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: -UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: 1,
  });
  const originBefore = await originOnScreen(page);
  expect(Math.abs(before.x)).toBe(UNBOUNDED_PAN_TESTED_EXTENT);

  await dragBoard(page, { x: 640, y: 400 }, DRAG_RIGHT, DRAG_DOWN);

  const after = await settled(page);
  // 200/100 screen px at zoom 1 is exactly 200/100 world units, however far out we are.
  expect(after.x - before.x).toBeCloseTo(-DRAG_RIGHT, digitsFor(before.x));
  expect(after.y - before.y).toBeCloseTo(-DRAG_DOWN, digitsFor(before.y));
  const originAfter = await originOnScreen(page);
  expectPixels(originAfter.x - originBefore.x, DRAG_RIGHT, 'the starting point still moves with the pointer');
  expectPixels(originAfter.y - originBefore.y, DRAG_DOWN, 'the starting point still moves with the pointer');
  expect((await gridGeometry(page)).period).toBeCloseTo(expectedGridPeriod(1), 6);
});

test('TC-27b: drag and zoom still work a million units out, at both zoom limits', async ({ page }) => {
  await openBoard(page);

  for (const zoom of [ZOOM_MIN, ZOOM_MAX]) {
    const before = await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom,
    });
    const originBefore = await originOnScreen(page);
    const pointer = { x: 700, y: 500 };

    await dragBoard(page, { x: 300, y: 300 }, DRAG_RIGHT, DRAG_DOWN);

    const after = await settled(page);
    // A drag is a screen-space distance: at zoom z it is 200/z world units.
    expect(after.x - before.x).toBeCloseTo(-DRAG_RIGHT / zoom, digitsFor(before.x));
    expectPixels((await originOnScreen(page)).x - originBefore.x, DRAG_RIGHT, 'content moves with the pointer');
    expectPixels((await originOnScreen(page)).y - originBefore.y, DRAG_DOWN, 'content moves with the pointer');
    expect((await gridGeometry(page)).period).toBeCloseTo(expectedGridPeriod(zoom), 6);

    // Wheel towards the middle of the zoom range: out at the maximum, in at the minimum.
    const towardsMiddle = zoom >= ZOOM_MAX ? 1 : -1;
    await ctrlWheel(page, pointer, towardsMiddle * -WHEEL_ZOOM);
    const zoomed = await settled(page);
    if (towardsMiddle > 0) {
      expect(zoomed.zoom).toBeLessThan(zoom);
    } else {
      expect(zoomed.zoom).toBeGreaterThan(zoom);
    }
    // The board location under the pointer stayed under it.
    const wasAt = screenToWorld(after, pointer);
    const nowAt = screenToWorld(zoomed, pointer);
    expectPixels((nowAt.x - wasAt.x) * zoomed.zoom, 0, 'the point under the pointer stayed put');
    expectPixels((nowAt.y - wasAt.y) * zoomed.zoom, 0, 'the point under the pointer stayed put');
  }
});

test('TC-31: board zoom gestures never change the page zoom', async ({ page }) => {
  await openBoard(page);
  const baseline = await page.evaluate(pageMetrics);

  await ctrlWheel(page, { x: 640, y: 400 }, WHEEL_ZOOM);
  await ctrlWheel(page, { x: 640, y: 400 }, -WHEEL_ZOOM);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');
  await settled(page);

  expect(await page.evaluate(pageMetrics)).toEqual(baseline);
});

function pageMetrics(): { scale: number; dpr: number; innerWidth: number; innerHeight: number } {
  return {
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
}

test('TC-18 (browser): Ctrl + = / - / 0 zoom the board and leave the page alone', async ({ page }) => {
  await openBoard(page);

  await page.keyboard.press('Control+=');
  await settled(page);
  await expect(zoomLabel(page)).toHaveText(percentOf(ZOOM_STEP_FACTOR));
  const stepped = await originOnScreen(page);
  expectPixels(stepped.x, START_POINT.x, 'the board location at the centre stayed there');
  expectPixels(stepped.y, START_POINT.y, 'the board location at the centre stayed there');

  await page.keyboard.press('Control+-');
  await settled(page);
  await expect(zoomLabel(page)).toHaveText(percentOf(1));
  expect((await getCamera(page)).zoom).toBe(1);

  await setCamera(page, { x: 12_345, y: 678, zoom: 2 });
  await page.keyboard.press('Control+0');
  const reset = await settled(page);
  await expect(zoomLabel(page)).toHaveText(percentOf(1));
  expect(reset.zoom).toBe(1);
  expect(reset.x).toBeCloseTo(-BOARD_AREA.width / 2, 6);
  expect(reset.y).toBeCloseTo(-BOARD_AREA.height / 2, 6);
});

test('TC-13 (browser): only a left-drag on empty board space pans, and drags keep working', async ({ page }) => {
  await openBoard(page);
  const before = await settled(page);

  // Right button: not a pan, and nothing moved.
  await page.mouse.move(500, 500);
  await page.mouse.down({ button: 'right' });
  expect(await interactionState(page)).toBe('idle');
  await page.mouse.move(700, 700, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  expect(await getCamera(page)).toEqual(before);

  await dragBoard(page, { x: 400, y: 400 }, 80, -40);
  const afterDrag = await settled(page);
  expect(afterDrag.x - before.x).toBeCloseTo(-80, 6);
  expect(afterDrag.y - before.y).toBeCloseTo(40, 6);

  // A drag that leaves the board area still ends cleanly, thanks to pointer capture.
  await page.mouse.move(50, 50);
  await page.mouse.down();
  await page.mouse.move(-40, 620, { steps: 4 });
  await page.mouse.up();
  const afterSecond = await settled(page);
  expect(afterSecond.x - afterDrag.x).toBeCloseTo(90, 6);
  expect(afterSecond.y - afterDrag.y).toBeCloseTo(-570, 6);
  expect(await interactionState(page)).toBe('idle');

  // ... and the board can still be dragged afterwards.
  await dragBoard(page, { x: 400, y: 400 }, 20, 20);
  expect((await settled(page)).x - afterSecond.x).toBeCloseTo(-20, 6);
});

test('TC-23b: the world layer carries the camera, so content stays attached to the board', async ({ page }) => {
  await openBoard(page);
  await expect(originMarker(page)).toBeVisible();

  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  expect(await worldLayer(page).evaluate((element) => element.style.transform)).toBe('scale(1) translate(0px, 0px)');
  expectPixels((await originOnScreen(page)).x, 0, 'the starting point is at the top-left');

  await setCamera(page, { zoom: 2 });
  const camera = await settled(page);
  expect(await worldLayer(page).evaluate((element) => element.style.transform)).toBe(
    `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  );
  const marker = await originOnScreen(page);
  expectPixels(marker.x, -camera.x * camera.zoom, 'the marker follows the camera maths');
  expectPixels((await gridGeometry(page)).period, expectedGridPeriod(camera.zoom), 'the grid scaled with the zoom');

  // At 200% one world unit is two screen pixels.
  const origin = worldToScreen(camera, { x: 0, y: 0 });
  const nextUnit = worldToScreen(camera, { x: 1, y: 0 });
  expectPixels(nextUnit.x - origin.x, 2, 'one world unit is two screen pixels');

  // The nearest dot to a screen point is a whole grid cell away from the painted origin.
  const dot = await nearestGridDot(page, { x: 640, y: 400 });
  const grid = await gridGeometry(page);
  expect(Math.abs((dot.x - grid.offsetX) % grid.period)).toBeLessThanOrEqual(1e-6);
});

test('TC-30 (browser): a Ctrl + wheel over the zoom control does not zoom the board', async ({ page }) => {
  await openBoard(page);
  const before = await settled(page);
  const box = await zoomInButton(page).boundingBox();
  if (!box) throw new Error('the zoom control has no bounding box');
  const overControl = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await ctrlWheel(page, overControl, WHEEL_ZOOM);

  const after = await getCamera(page);
  expect(after).toEqual(before);
  expect(canZoomOut(after)).toBe(true);
});
