/**
 * Story 1 · task 7 — end-to-end navigation tests.
 *
 * Run against the real app served by `wrangler dev`, in Chromium, Firefox and
 * WebKit. Pixel facts are measured from the page (marker bounding box,
 * sampled screenshot pixels); the ±1 px tolerance comes from the design's
 * "Visual alignment tolerance for e2e".
 */
import { expect, test } from '@playwright/test';
import {
  expectDotAt,
  getCamera,
  gridGeometry,
  markerPosition,
  nearestDot,
  setCamera,
  settle,
  viewportSize,
  zoomLabel,
  type Camera,
  type Point,
} from './helpers/board';
import { openFreshBoard } from './helpers/boards';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

/** Where a world point is painted on screen for the given camera. */
const project = (camera: Camera, world: Point): Point => ({
  x: (world.x - camera.x) * camera.zoom,
  y: (world.y - camera.y) * camera.zoom,
});

test('the first-use hint is shown and the first drag removes it', async ({ page }) => {
  await openFreshBoard(page);
  const hint = page.getByTestId('navigation-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

  await page.mouse.move(520, 360);
  await page.mouse.down();
  await page.mouse.move(560, 400, { steps: 6 });
  await page.mouse.up();

  await expect(hint).toHaveCount(0);
  // The hint does not come back for the rest of the visit.
  await page.mouse.move(560, 400);
  await page.mouse.down();
  await page.mouse.move(600, 420, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
});

test('TC-23: a drag of (200,100) moves the marker and the dot grid by exactly that delta', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  const viewport = await viewportSize(page);
  const cameraBefore = await getCamera(page);
  const markerBefore = await markerPosition(page);

  // Reference points well away from the origin crosshair (which is itself
  // dark) so a "dot here" reading cannot be a false positive.
  const probes: Point[] = [
    { x: 300, y: 200 },
    { x: 980, y: 180 },
    { x: 1000, y: 500 },
    { x: 240, y: 480 },
  ];
  const dotsBefore = probes.map((probe) =>
    nearestDot(cameraBefore, GRID_SPACING_WORLD, probe),
  );
  for (const dot of dotsBefore) {
    await expectDotAt(page, dot);
  }

  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(900, 400, { steps: 10 });
  await page.mouse.up();
  await settle(page);

  // Camera fact: the drag moved the camera by exactly delta / zoom.
  const camera = await getCamera(page);
  expect(camera.zoom).toBe(1);
  expect(camera.x).toBeCloseTo(cameraBefore.x - 200, 6);
  expect(camera.y).toBeCloseTo(cameraBefore.y - 100, 6);

  // Marker fact: the board followed the pointer, so the world-origin marker
  // moved with it by exactly (+200,+100), ±1 px.
  const marker = await markerPosition(page);
  expect(Math.abs(marker.x - (markerBefore.x + 200))).toBeLessThanOrEqual(1);
  expect(Math.abs(marker.y - (markerBefore.y + 100))).toBeLessThanOrEqual(1);

  // Visual fact: each dot that was under a probe moved with the board, so it
  // is still painted within 1 px of where the camera says it must be. A grid
  // that lagged, or did not move at all, would be at least 4 px away here.
  for (let index = 0; index < probes.length; index += 1) {
    const world = {
      x: dotsBefore[index].x + cameraBefore.x,
      y: dotsBefore[index].y + cameraBefore.y,
    };
    const expected = project(camera, world);
    // Keep the sample inside the page; the probes are placed so this holds.
    expect(expected.x).toBeGreaterThan(4);
    expect(expected.y).toBeGreaterThan(4);
    expect(expected.x).toBeLessThan(viewport.width - 4);
    expect(expected.y).toBeLessThan(viewport.height - 4);
    await expectDotAt(page, expected);
  }
});

test('TC-24: Ctrl + scroll zooms about the pointer and the dot under it stays put', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  const cameraBefore = await getCamera(page);
  // Aim at a dot, so the "same dot" check has something to look at.
  const pointer = nearestDot(cameraBefore, GRID_SPACING_WORLD, { x: 360, y: 220 });
  await expectDotAt(page, pointer);

  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await settle(page);

  const camera = await getCamera(page);
  expect(camera.zoom).toBeGreaterThan(2); // one wheel notch at 0.01 sensitivity
  expect(camera.zoom).toBeLessThanOrEqual(4);

  // Visual fact: a dot is still painted at the pointer, within 1 px.
  await expectDotAt(page, pointer);

  // And the browser did not zoom the page instead.
  const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(scale).toBe(1);
});

test('TC-25: the zoom-in button disables at 400% and the board stops zooming', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  await expect(zoomIn).toBeEnabled();
  await expect(zoomOut).toBeEnabled();
  expect(await zoomLabel(page)).toBe('100%');

  await zoomIn.click();
  await settle(page);
  expect(await zoomLabel(page)).toBe('125%');

  // Enough clicks to walk past the maximum, checking each state transition.
  for (let click = 0; click < 12; click += 1) {
    if (!(await zoomIn.isEnabled())) break;
    await zoomIn.click();
    await settle(page);
  }

  expect(await zoomLabel(page)).toBe('400%');
  await expect(zoomIn).toBeDisabled();
  const camera = await getCamera(page);
  expect(camera.zoom).toBe(4);

  // Clicking the disabled button (and the shortcut) changes nothing.
  await zoomIn.click({ force: true });
  await page.keyboard.press('Control+=');
  await settle(page);
  expect((await getCamera(page)).zoom).toBe(4);

  // Zooming out works again, one step at a time (400% / 1.25 = 320%).
  await zoomOut.click();
  await settle(page);
  expect(await zoomLabel(page)).toBe('320%');
  expect((await getCamera(page)).zoom).toBeCloseTo(4 / 1.25, 6);
});

test('TC-26: reset view recentres after a long jump at 400%', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await setCamera(page, { x: 12345, y: -9876, zoom: 4 });
  expect(await zoomLabel(page)).toBe('400%');
  const markerFar = await markerPosition(page);
  expect(Math.abs(markerFar.x)).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Reset view' }).click();
  await settle(page);

  expect(await zoomLabel(page)).toBe('100%');
  const viewport = await viewportSize(page);
  const marker = await markerPosition(page);
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  expect(Math.abs(marker.x - centre.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(marker.y - centre.y)).toBeLessThanOrEqual(1);

  const camera = await getCamera(page);
  expect(camera).toEqual({
    x: -viewport.width / 2,
    y: -viewport.height / 2,
    zoom: 1,
  });
});

test('TC-27: panning far from the origin keeps exact movement and grid spacing', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  const far = {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: -UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: 2,
  };
  await setCamera(page, far);

  // Grid fact: the spacing on screen is GRID_SPACING_WORLD * zoom.
  const grid = await gridGeometry(page);
  expect(grid.spacing).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 6);

  const probes: Point[] = [
    { x: 400, y: 250 },
    { x: 820, y: 300 },
    { x: 1040, y: 560 },
  ];
  const dotsBefore = probes.map((probe) =>
    nearestDot(far, GRID_SPACING_WORLD, probe),
  );
  for (const dot of dotsBefore) {
    await expectDotAt(page, dot);
  }

  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(840, 500, { steps: 10 });
  await page.mouse.up();
  await settle(page);

  // Camera fact: still exact 1:1 tracking at 1e6 (2x zoom halves the world
  // distance for the same pointer distance).
  const camera = await getCamera(page);
  expect(camera.zoom).toBe(2);
  expect(camera.x).toBeCloseTo(far.x - 100, 6);
  expect(camera.y).toBeCloseTo(far.y - 50, 6);

  // Visual fact: the grid is still drawn correctly that far out.
  for (let index = 0; index < probes.length; index += 1) {
    const world = {
      x: dotsBefore[index].x / far.zoom + far.x,
      y: dotsBefore[index].y / far.zoom + far.y,
    };
    const expected = project(camera, world);
    expect(expected.x).toBeGreaterThan(4);
    expect(expected.y).toBeGreaterThan(4);
    await expectDotAt(page, expected);
  }
});

test('TC-31: board gestures drive the board and never zoom or scroll the page', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  const initial = await page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(initial.scrollHeight).toBe(initial.clientHeight); // nothing to scroll
  const start = await getCamera(page);

  // Plain scroll: the board pans by the scroll delta, the page does not move.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -240);
  await settle(page);
  const panned = await getCamera(page);
  expect(panned.zoom).toBe(1);
  expect(panned.y).toBeCloseTo(start.y - 240, 6);

  // Ctrl + scroll: the board zooms around the pointer, the page does not.
  const anchor = {
    x: 640 / panned.zoom + panned.x,
    y: 400 / panned.zoom + panned.y,
  };
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -20);
  await page.keyboard.up('Control');
  await settle(page);
  const zoomed = await getCamera(page);
  expect(zoomed.zoom).toBeGreaterThan(1.2);
  expect(zoomed.zoom).toBeLessThan(1.4);
  const anchorAfter = {
    x: 640 / zoomed.zoom + zoomed.x,
    y: 400 / zoomed.zoom + zoomed.y,
  };
  expect(Math.abs(anchorAfter.x - anchor.x)).toBeLessThan(1e-6);
  expect(Math.abs(anchorAfter.y - anchor.y)).toBeLessThan(1e-6);

  // Keyboard zoom and reset, from a known camera so the steps are checkable.
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  await page.keyboard.press('Control+=');
  await settle(page);
  expect((await getCamera(page)).zoom).toBe(1.25);

  await page.keyboard.press('Control+-');
  await settle(page);
  expect((await getCamera(page)).zoom).toBe(1);

  await page.keyboard.press('Control+0');
  await settle(page);
  const viewport = await viewportSize(page);
  expect(await getCamera(page)).toEqual({
    x: -viewport.width / 2,
    y: -viewport.height / 2,
    zoom: 1,
  });

  const after = await page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
  expect(after.scale).toBe(1); // never a page zoom
  expect(after.dpr).toBe(initial.dpr);
  expect(after.scrollX).toBe(0);
  expect(after.scrollY).toBe(0); // never a page scroll
});

test('TC-30: Ctrl + scroll over the zoom control does not zoom the board', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  const cameraBefore = await getCamera(page);
  const control = page.getByTestId('zoom-controls');
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await settle(page);

  expect(await getCamera(page)).toEqual(cameraBefore);
  const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  expect(scale).toBe(1);
});
