import { expect, test } from './fixtures.js';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config.js';
import {
  CENTRE,
  DRAG,
  boardArea,
  cameraState,
  clickDisabledButton,
  clickZoomInUntilDisabled,
  clickZoomOutUntilDisabled,
  ctrlWheel,
  differenceAt,
  dragBoard,
  expectMarkerAt,
  expectNear,
  expectPointNear,
  gridGeometry,
  markerCentre,
  mod,
  nearestDot,
  navigationHint,
  openBoard,
  originMarker,
  pageZoomState,
  pixelLightnessRange,
  readZoomPercent,
  resetViewButton,
  setCamera,
  shootRegion,
  wheelBoard,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  waitForRender,
} from './helpers/board.js';

/**
 * Story 1 workflows, run against the same server as production (`wrangler dev`
 * serving the built client). Pixel claims are made against the rendered page:
 * the origin marker (a world-anchored crosshair) and screenshots of the dot
 * grid are the references, because they are what a person actually sees.
 */

const DOT_REGION = 48;

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 + TC-23 the first drag moves the board and removes the hint', async ({ page }) => {
    await openBoard(page);

    // TC-28: a first-time visitor sees the hint.
    await expect(navigationHint(page)).toBeVisible();
    await expect(navigationHint(page)).toContainText(
      'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom',
    );

    const markerBefore = await originMarker(page).boundingBox();
    expect(markerBefore).not.toBeNull();

    // A dot of the grid, and proof that dots are really painted here.
    const dot = await nearestDot(page, { x: 300, y: 250 });
    const before = await shootRegion(page, dot, DOT_REGION);
    const [darkestDot, lightestBoard] = await pixelLightnessRange(page, dot, 12);
    expect(darkestDot).toBeLessThan(150);
    expect(lightestBoard).toBeGreaterThan(230);

    await dragBoard(page);

    // TC-28: the first pan removes the hint.
    await expect(navigationHint(page)).toHaveCount(0);

    // TC-23: the board moved by exactly the pointer's movement.
    const markerAfter = await originMarker(page).boundingBox();
    expect(markerAfter).not.toBeNull();
    expectNear(markerAfter!.x, markerBefore!.x + DRAG.x, 1, 'marker x after drag');
    expectNear(markerAfter!.y, markerBefore!.y + DRAG.y, 1, 'marker y after drag');
    await expectMarkerAt(page, { x: CENTRE.x + DRAG.x, y: CENTRE.y + DRAG.y });

    // The dot grid moved with it: the rendered picture is the same one, 200 px
    // right and 100 px down \u2014 and not one pixel off in either direction.
    const atDrag = await differenceAt(page, before, dot, DRAG);
    const onePixelShort = await differenceAt(page, before, dot, { x: DRAG.x - 1, y: DRAG.y });
    const onePixelOn = await differenceAt(page, before, dot, { x: DRAG.x + 1, y: DRAG.y });
    const halfADotApart = await differenceAt(page, before, dot, {
      x: DRAG.x + GRID_SPACING_WORLD / 2,
      y: DRAG.y,
    });
    expect(atDrag).toBeLessThan(1);
    expect(atDrag).toBeLessThan(onePixelShort);
    expect(atDrag).toBeLessThan(onePixelOn);
    expect(atDrag).toBeLessThan(halfADotApart);

    // ...and the dot that arrived where the picture used to be is still a dot.
    const [darkestAfter] = await pixelLightnessRange(page, { x: dot.x + DRAG.x, y: dot.y + DRAG.y }, 12);
    expect(darkestAfter).toBeLessThan(150);

    // The camera agrees with what is on screen.
    const camera = await cameraState(page);
    expectNear(camera.x, -CENTRE.x - DRAG.x, 0.001, 'camera.x after drag');
    expectNear(camera.y, -CENTRE.y - DRAG.y, 0.001, 'camera.y after drag');
    expect(camera.zoom).toBe(1);
  });

  test('TC-23b a plain wheel scrolls the board by the wheel delta', async ({ page }) => {
    await openBoard(page);
    const before = await markerCentre(page);

    const delivered = await wheelBoard(page, { x: 500, y: 300 }, 120);
    expect(Number.isFinite(delivered)).toBe(true);
    expect(delivered).not.toBe(0);

    // The board moved by exactly the delta the page received (browsers scale
    // wheel deltas by the device pixel ratio, hence measuring it).
    const after = await markerCentre(page);
    expectPointNear(after, { x: before.x, y: before.y - delivered }, 1, 'marker after wheel');
    const camera = await cameraState(page);
    expectNear(camera.y, -CENTRE.y + delivered, 0.001, 'camera.y after wheel');
  });

  test('TC-24 ctrl + wheel zooms around the pointer and leaves the page zoom alone', async ({ page }) => {
    await openBoard(page);
    const zoomStateBefore = await pageZoomState(page);

    // Zoom in on the board's origin: the location under the pointer is pinned.
    const pointer = await markerCentre(page);
    await ctrlWheel(page, pointer, -100);

    const camera = await cameraState(page);
    expect(camera.zoom).toBeGreaterThan(1);
    await expectMarkerAt(page, pointer, 1);
    await expect(zoomLabel(page)).toHaveText(`${Math.round(camera.zoom * 100)}%`);

    // The dot grid zooms with the board.
    const { spacing } = await gridGeometry(page);
    expectNear(spacing, GRID_SPACING_WORLD * camera.zoom, 0.01, 'grid spacing after zoom');

    // The page itself was never zoomed.
    const zoomStateAfter = await pageZoomState(page);
    expect(zoomStateAfter.visualViewportScale).toBe(zoomStateBefore.visualViewportScale);
    expect(zoomStateAfter.devicePixelRatio).toBe(zoomStateBefore.devicePixelRatio);
    expect(zoomStateAfter.innerWidth).toBe(zoomStateBefore.innerWidth);
    expect(zoomStateAfter.innerHeight).toBe(zoomStateBefore.innerHeight);
  });

  test('TC-30 ctrl + wheel over the zoom controls does not move the board', async ({ page }) => {
    await openBoard(page);
    const before = await cameraState(page);

    const box = await zoomLabel(page).boundingBox();
    expect(box).not.toBeNull();
    await ctrlWheel(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, -100);

    expect(await cameraState(page)).toEqual(before);
    await expectMarkerAt(page, CENTRE, 1);
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 Zoom in stops at ZOOM_MAX and is then disabled', async ({ page }) => {
    await openBoard(page);
    const clicks = await clickZoomInUntilDisabled(page);
    expect(clicks).toBeGreaterThan(1);

    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MAX * 100)}%`);
    expect(await readZoomPercent(page)).toBe(400);

    const camera = await cameraState(page);
    expectNear(camera.zoom, ZOOM_MAX, 1e-9, 'zoom after clicking in');
    // Zoom is anchored at the centre, so the origin is still in the middle.
    await expectMarkerAt(page, CENTRE, 1);

    // Clicking the disabled button does nothing.
    await clickDisabledButton(page, 'Zoom in');
    await waitForRender(page);
    expect(await cameraState(page)).toEqual(camera);
  });

  test('TC-25b Zoom out stops at ZOOM_MIN and is then disabled', async ({ page }) => {
    await openBoard(page);
    const clicks = await clickZoomOutUntilDisabled(page);
    expect(clicks).toBeGreaterThan(1);

    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(await readZoomPercent(page)).toBe(10);
    expectNear((await cameraState(page)).zoom, ZOOM_MIN, 1e-9, 'zoom after clicking out');
    await expectMarkerAt(page, CENTRE, 1);
  });

  test('TC-26 Reset view returns to the standard view from far away at ZOOM_MAX', async ({ page }) => {
    await openBoard(page);

    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT / 2,
      zoom: ZOOM_MAX,
    });
    expectNear((await cameraState(page)).zoom, ZOOM_MAX, 1e-9, 'zoom after teleport');
    const far = await markerCentre(page);
    expect(Math.abs(far.x - CENTRE.x)).toBeGreaterThan(1000);

    await resetViewButton(page).click();
    await waitForRender(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerAt(page, CENTRE, 1);
    expect(await cameraState(page)).toEqual({ x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
    const { spacing } = await gridGeometry(page);
    expectNear(spacing, GRID_SPACING_WORLD, 0.01, 'grid spacing after reset');
  });

  test('TC-26b keyboard Ctrl + 0 resets the view like the button', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 20_000, y: 40_000, zoom: 2 });
    await page.keyboard.press('Control+0');
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerAt(page, CENTRE, 1);
  });

  test('TC-18e Ctrl + = and Ctrl + - zoom one step around the centre', async ({ page }) => {
    await openBoard(page);

    await page.keyboard.press('Control+=');
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText('125%');
    expectNear((await cameraState(page)).zoom, 1.25, 1e-9, 'zoom after Ctrl + =');
    await expectMarkerAt(page, CENTRE, 1);

    await page.keyboard.press('Control+-');
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    expectNear((await cameraState(page)).zoom, 1, 1e-9, 'zoom after Ctrl + -');
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 panning a million world units from the start is exact', async ({ page }) => {
    await openBoard(page);

    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    const before = await markerCentre(page);
    // The board is a million units away and still drawn where the maths says.
    expect(before.x).toBeLessThan(-100_000);
    expect(before.y).toBeLessThan(-100_000);

    const { spacing } = await gridGeometry(page);
    expectNear(spacing, GRID_SPACING_WORLD, 0.01, 'grid spacing far from the start');

    await dragBoard(page, DRAG, { x: CENTRE.x, y: CENTRE.y });

    const after = await markerCentre(page);
    expectPointNear(after, { x: before.x + DRAG.x, y: before.y + DRAG.y }, 1, 'marker after far drag');

    const camera = await cameraState(page);
    expectNear(camera.x, UNBOUNDED_PAN_TESTED_EXTENT - DRAG.x, 0.001, 'camera.x after far drag');
    expectNear(camera.y, UNBOUNDED_PAN_TESTED_EXTENT - DRAG.y, 0.001, 'camera.y after far drag');

    // The grid still lines up with the camera a million units out.
    const far = await gridGeometry(page);
    expectNear(far.spacing, GRID_SPACING_WORLD * camera.zoom, 0.01, 'grid spacing after far drag');
    expectNear(far.offsetX, mod(-camera.x * camera.zoom, far.spacing), 0.01, 'grid phase x after far drag');
    expectNear(far.offsetY, mod(-camera.y * camera.zoom, far.spacing), 0.01, 'grid phase y after far drag');
  });

  test('TC-27b zoom and pan stay exact at the far end of the board', async ({ page }) => {
    await openBoard(page);
    const at = { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT / 2 };
    await setCamera(page, { ...at, zoom: 1 });

    await page.keyboard.press('Control+=');
    await waitForRender(page);
    // The zoom step itself moves the camera too (it is anchored at the centre),
    // so the drag is measured from where the camera got to.
    const beforeDrag = await cameraState(page);
    expectNear(beforeDrag.zoom, 1.25, 1e-9, 'zoom after Ctrl + =');

    await dragBoard(page, DRAG, { x: CENTRE.x, y: CENTRE.y });
    const camera = await cameraState(page);
    expectNear(camera.x, beforeDrag.x - DRAG.x / 1.25, 0.001, 'camera.x after drag at 125%');
    expectNear(camera.y, beforeDrag.y - DRAG.y / 1.25, 0.001, 'camera.y after drag at 125%');

    const { spacing } = await gridGeometry(page);
    expectNear(spacing, GRID_SPACING_WORLD * camera.zoom, 0.01, 'grid spacing at 125% far away');
  });
});

test.describe('page zoom is never touched', () => {
  test('TC-31 board gestures leave visual viewport scale and devicePixelRatio alone', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoomState(page);
    expect(before.visualViewportScale).toBe(1);

    await ctrlWheel(page, { x: 500, y: 300 }, -300);
    expect(await pageZoomState(page).then((state) => state.visualViewportScale)).toBe(1);
    await ctrlWheel(page, { x: 500, y: 300 }, 300);
    await page.keyboard.press('Control+=');
    await waitForRender(page);
    await page.keyboard.press('Control+-');
    await waitForRender(page);
    await page.keyboard.press('Control+0');
    await waitForRender(page);
    await dragBoard(page);

    const after = await pageZoomState(page);
    expect(after.visualViewportScale).toBe(1);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
    expect(after.innerWidth).toBe(before.innerWidth);
    expect(after.innerHeight).toBe(before.innerHeight);

    // The board did respond to those gestures: it ended up a drag away.
    const camera = await cameraState(page);
    expectNear(camera.x, -CENTRE.x - DRAG.x, 0.001, 'camera.x after the gesture run');
    expectNear(camera.y, -CENTRE.y - DRAG.y, 0.001, 'camera.y after the gesture run');
    expect(await boardArea(page).getAttribute('data-panning')).toBe('false');
  });
});
