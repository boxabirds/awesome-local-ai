import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config';
import {
  boardLocator,
  clickUntilDisabled,
  ctrlWheel,
  dragBoard,
  expectClosePoints,
  modulo,
  navigationHint,
  originPoint,
  pageZoomState,
  readCamera,
  readGridStyle,
  resetButton,
  setCamera,
  expectLabelMatchesCamera,
  zoomControls,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  type Dot,
} from './helpers/board';

const CENTRE: Dot = { x: 640, y: 400 };

test.describe('workflow 1: first visit navigation', () => {
  test('hint, drag to pan, scroll to pan, zoom around the pointer', async ({ page }) => {
    await page.goto('/');

    // TC-28: the first-use hint is shown and the standard view is 100% with the
    // board's starting point centred.
    await expect(navigationHint(page)).toBeVisible();
    await expect(navigationHint(page)).toHaveText(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
    const initial = await readCamera(page);
    expect(initial.zoom).toBe(1);
    const origin = await originPoint(page);
    expectClosePoints(origin, CENTRE);

    // TC-23: dragging moves the board by exactly the pointer delta.
    const gridBeforeDrag = await readGridStyle(page);
    await dragBoard(page, origin, 200, 100);
    const afterDrag = await originPoint(page);
    expectClosePoints(afterDrag, { x: origin.x + 200, y: origin.y + 100 });
    const camAfterDrag = await readCamera(page);
    expect(camAfterDrag.x).toBeCloseTo(initial.x - 200, 3);
    expect(camAfterDrag.y).toBeCloseTo(initial.y - 100, 3);
    expect(camAfterDrag.zoom).toBe(1);

    // The grid follows the board: its on-screen spacing and dot alignment match
    // the camera after the pan.
    const grid = await readGridStyle(page);
    expect(grid.sizeX).toBeCloseTo(GRID_SPACING_WORLD * camAfterDrag.zoom, 1);
    expect(grid.posX).toBeCloseTo(modulo(-camAfterDrag.x * camAfterDrag.zoom, grid.sizeX), 1);
    expect(grid.posY).toBeCloseTo(modulo(-camAfterDrag.y * camAfterDrag.zoom, grid.sizeY), 1);
    // A dot moved with the drag: its offset within a grid cell shifted by exactly
    // the pointer delta, wrapped by one cell (the dots themselves are identical).
    expect(grid.posX).toBeCloseTo(modulo(gridBeforeDrag.posX + 200, grid.sizeX), 1);
    expect(grid.posY).toBeCloseTo(modulo(gridBeforeDrag.posY + 100, grid.sizeY), 1);

    // TC-28 (continued): the hint is gone after the first pan and stays gone.
    await expect(navigationHint(page)).toHaveCount(0);

    // pan.scroll: a plain wheel moves content opposite to the scroll direction.
    const beforeWheel = await readCamera(page);
    const markerBefore = await originPoint(page);
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(50);
    const afterWheel = await readCamera(page);
    expect(afterWheel.y).toBeCloseTo(beforeWheel.y + 100 / beforeWheel.zoom, 3);
    const markerAfter = await originPoint(page);
    expectClosePoints(markerAfter, { x: markerBefore.x, y: markerBefore.y - 100 });
    await expect(navigationHint(page)).toHaveCount(0);

    // zoom.pointer: Ctrl + wheel keeps the spot under the pointer in place.
    // (A 60-pixel wheel delta is a factor of e^0.6, comfortably inside the zoom
    // limits, so the round trip below is not clamped.)
    const target = await originPoint(page);
    const beforeZoom = await readCamera(page);
    await ctrlWheel(page, target, -60);
    const afterZoom = await readCamera(page);
    expect(afterZoom.zoom).toBeGreaterThan(beforeZoom.zoom);
    expect(afterZoom.zoom).toBeLessThan(ZOOM_MAX);
    expectClosePoints(await originPoint(page), target);
    // ...and the grid scaled with it.
    const zoomedGrid = await readGridStyle(page);
    expect(zoomedGrid.sizeX).toBeCloseTo(GRID_SPACING_WORLD * afterZoom.zoom, 1);

    // Zooming back out by the same gesture returns to the original scale.
    await ctrlWheel(page, target, 60);
    const restored = await readCamera(page);
    expect(restored.zoom).toBeCloseTo(beforeZoom.zoom, 6);
    expectClosePoints(await originPoint(page), target);
    await expectLabelMatchesCamera(page);
  });

  test('TC-31: board gestures never change the browser page zoom', async ({ page }) => {
    await page.goto('/');
    const baseline = await pageZoomState(page);
    expect(baseline.scale).toBe(1);
    const controlBefore = await zoomInButton(page).boundingBox();
    expect(controlBefore).not.toBeNull();

    await ctrlWheel(page, CENTRE, -240);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Control+0');

    await expect(zoomLabel(page)).toHaveText('100%');

    // TC-30 (browser level): a Ctrl + wheel starting on the zoom control does not
    // zoom the board either.
    const controlsBox = await zoomControls(page).boundingBox();
    expect(controlsBox).not.toBeNull();
    const cameraBeforeControls = await readCamera(page);
    await ctrlWheel(
      page,
      { x: (controlsBox?.x ?? 0) + 12, y: (controlsBox?.y ?? 0) + 12 },
      -120,
    );
    expect(await readCamera(page)).toEqual(cameraBeforeControls);

    const after = await pageZoomState(page);
    expect(after.scale).toBe(baseline.scale);
    expect(after.dpr).toBe(baseline.dpr);

    // The board UI itself keeps its size: only board content scales.
    const controlAfter = await zoomInButton(page).boundingBox();
    expect(Math.abs((controlAfter?.height ?? 0) - (controlBefore?.height ?? 0))).toBeLessThanOrEqual(1);
  });

  test('board content does not move relative to the top-left when the window is resized', async ({
    page,
  }) => {
    await page.goto('/');
    const before = await originPoint(page);
    const cameraBefore = await readCamera(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(100);
    const after = await originPoint(page);
    expectClosePoints(after, before);
    const cameraAfter = await readCamera(page);
    expect(cameraAfter).toEqual(cameraBefore);
  });
});

test.describe('workflow 2: zoom limits and recovery', () => {
  test('step to the limits with the buttons, then reset', async ({ page }) => {
    await page.goto('/');
    await expect(zoomLabel(page)).toHaveText('100%');

    // zoom.step: one click on + gives 125%, one on - returns to 100%.
    await zoomInButton(page).click();
    await expect(zoomLabel(page)).toHaveText('125%');
    await zoomOutButton(page).click();
    await expect(zoomLabel(page)).toHaveText('100%');

    // TC-25 / zoom.limits: + walks to 400% and then disables itself.
    const seen = await clickUntilDisabled(page, zoomInButton(page));
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    expect(await zoomInButton(page).getAttribute('disabled')).not.toBeNull();
    expect((await readCamera(page)).zoom).toBe(ZOOM_MAX);
    // Zooming back the other way re-enables the button.
    await zoomOutButton(page).click();
    await expect(zoomInButton(page)).toBeEnabled();
    expect(seen[seen.length - 1]).toBe('400%');

    // Zoom out to the minimum: the label stops at 10% and - is disabled.
    await clickUntilDisabled(page, zoomOutButton(page));
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MIN * 100)}%`);
    await expect(zoomOutButton(page)).toBeDisabled();
    expect((await readCamera(page)).zoom).toBe(ZOOM_MIN);
    await zoomInButton(page).click();
    await expect(zoomOutButton(page)).toBeEnabled();

    // TC-26 / view.reset: jump far away at maximum zoom, then Reset view.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    expect((await readCamera(page)).x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
    await resetButton(page).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const camera = await readCamera(page);
    expect(camera.zoom).toBe(1);
    expectClosePoints(await originPoint(page), CENTRE);
    expect(camera.x).toBeCloseTo(-CENTRE.x, 3);
    expect(camera.y).toBeCloseTo(-CENTRE.y, 3);
  });

  test('keyboard steps zoom about the centre of the board area', async ({ page }) => {
    await page.goto('/');
    const box = await boardLocator(page).boundingBox();
    expect(box).not.toBeNull();
    const centre: Dot = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };

    // World point under the centre of the board area, from the reported camera.
    const worldUnderCentre = async (): Promise<Dot> => {
      const cam = await readCamera(page);
      return { x: centre.x / cam.zoom + cam.x, y: centre.y / cam.zoom + cam.y };
    };

    const before = await worldUnderCentre();
    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).toHaveText('125%');
    const mid = await worldUnderCentre();
    // One step in keeps the centre fixed within a screen pixel.
    const tolerance = 1 / 1.25;
    expect(Math.abs(mid.x - before.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(mid.y - before.y)).toBeLessThanOrEqual(tolerance);

    await page.keyboard.press('Control+-');
    await expect(zoomLabel(page)).toHaveText('100%');
    const back = await worldUnderCentre();
    expect(back.x).toBeCloseTo(before.x, 6);
    expect(back.y).toBeCloseTo(before.y, 6);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27: at a million units the grid is even and the drag tracks the pointer', async ({
    page,
  }) => {
    await page.goto('/');
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    const before = await readCamera(page);
    expect(before.x).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
    expect(before.y).toBe(UNBOUNDED_PAN_TESTED_EXTENT);

    const gridBefore = await readGridStyle(page);
    expect(gridBefore.sizeX).toBeCloseTo(GRID_SPACING_WORLD, 6);
    expect(gridBefore.sizeY).toBeCloseTo(GRID_SPACING_WORLD, 6);

    await dragBoard(page, { x: 400, y: 300 }, 200, 100);
    const after = await readCamera(page);
    expect(after.x).toBeCloseTo(before.x - 200, 6);
    expect(after.y).toBeCloseTo(before.y - 100, 6);

    // The dots keep their spacing and stay locked to the camera: the grid moved
    // by exactly the drag distance, modulo one cell, with no drift.
    const gridAfter = await readGridStyle(page);
    expect(gridAfter.sizeX).toBeCloseTo(GRID_SPACING_WORLD * after.zoom, 6);
    expect(gridAfter.posX).toBeCloseTo(modulo(gridBefore.posX + 200, gridAfter.sizeX), 1);
    expect(gridAfter.posY).toBeCloseTo(modulo(gridBefore.posY + 100, gridAfter.sizeY), 1);

    // Zooming far from the start still works and stays crisp (scale only).
    await setCamera(page, { zoom: 2 });
    const zoomed = await readGridStyle(page);
    expect(zoomed.sizeX).toBeCloseTo(GRID_SPACING_WORLD * 2, 6);
  });
});
