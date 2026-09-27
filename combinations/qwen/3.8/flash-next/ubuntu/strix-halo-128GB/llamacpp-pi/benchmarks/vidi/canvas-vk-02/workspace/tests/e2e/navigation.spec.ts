import { expect, test, type Page } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_PERCENT_SCALE,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../../src/client/canvas/camera';
import {
  boardElement,
  clickUntilDisabled,
  dragBoard,
  expectWithin,
  getCamera,
  markerCentre,
  navigationHint,
  openBoard,
  resetViewButton,
  setCamera,
  waitForRender,
  worldLayer,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  zoomWheel,
} from './helpers/board';

const PIXEL_TOLERANCE = 1;
const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/** The grid dot (multiple of GRID_SPACING_WORLD) nearest to a screen point. */
function nearestDot(camera: Camera, screen: Point): Point {
  const world = screenToWorld(camera, screen);
  return {
    x: Math.round(world.x / GRID_SPACING_WORLD) * GRID_SPACING_WORLD,
    y: Math.round(world.y / GRID_SPACING_WORLD) * GRID_SPACING_WORLD,
  };
}

/** The rendered dot grid geometry, in CSS pixels. */
function gridGeometry(page: Page) {
  return boardElement(page).evaluate((element) => {
    const style = getComputedStyle(element);
    const number = (value: string) => Number.parseFloat(value) || 0;
    return {
      sizeX: number(style.backgroundSize.split(' ')[0]),
      sizeY: number(style.backgroundSize.split(' ')[1] ?? style.backgroundSize.split(' ')[0]),
      positionX: number(style.backgroundPositionX),
      positionY: number(style.backgroundPositionY),
    };
  });
}

const mod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;

// Engines that cannot launch on this host (see global-setup.ts).
const unavailableBrowsers = (process.env.VIDI6_UNAVAILABLE_BROWSERS ?? '').split(',').filter(Boolean);

test.beforeEach(({ browserName }) => {
  test.skip(
    unavailableBrowsers.includes(browserName),
    `${browserName} cannot launch on this host (missing system libraries)`,
  );
});

test.describe('workflow 1 — first visit navigation', () => {
  test('TC-28 the navigation hint shows on first visit and disappears after the first pan', async ({ page }) => {
    await openBoard(page);
    await expect(navigationHint(page)).toBeVisible();
    await expect(navigationHint(page)).toHaveText(HINT_TEXT);

    await dragBoard(page, { x: 300, y: 300 }, { x: 420, y: 380 });
    await expect(navigationHint(page)).toHaveCount(0);

    // Stays gone for the rest of the visit.
    await dragBoard(page, { x: 600, y: 300 }, { x: 500, y: 240 });
    await expect(navigationHint(page)).toHaveCount(0);

    // Not persisted: a reload shows it again.
    await page.reload();
    await expect(navigationHint(page)).toBeVisible();
  });

  test('TC-23 dragging moves the board exactly the distance and direction the pointer moved', async ({ page }) => {
    await openBoard(page);
    const cameraBefore = await getCamera(page);
    const markerBefore = await markerCentre(page);
    const dot = nearestDot(cameraBefore, { x: 520, y: 360 });
    const dotBefore = worldToScreen(cameraBefore, dot);

    await page.mouse.move(520, 360);
    await page.mouse.down();
    await expect(boardElement(page)).toHaveAttribute('data-panning', 'true');
    await expect(boardElement(page)).toHaveCSS('cursor', 'grabbing');
    await page.mouse.move(720, 460, { steps: 8 });
    await page.mouse.up();
    await waitForRender(page);

    await expect(boardElement(page)).toHaveCSS('cursor', 'grab');

    const cameraAfter = await getCamera(page);
    const markerAfter = await markerCentre(page);
    expectWithin(markerAfter.x - markerBefore.x, 200, PIXEL_TOLERANCE, 'origin marker x');
    expectWithin(markerAfter.y - markerBefore.y, 100, PIXEL_TOLERANCE, 'origin marker y');

    // The rendered world layer and grid follow the camera exactly, so the same
    // grid dot sits 200px right and 100px down from where it started.
    expect(await worldLayer(page).evaluate((element) => element.style.transform)).toBe(
      `scale(${cameraAfter.zoom}) translate(${-cameraAfter.x}px, ${-cameraAfter.y}px)`,
    );
    const dotAfter = worldToScreen(cameraAfter, dot);
    expectWithin(dotAfter.x - dotBefore.x, 200, PIXEL_TOLERANCE, 'grid dot x');
    expectWithin(dotAfter.y - dotBefore.y, 100, PIXEL_TOLERANCE, 'grid dot y');

    const grid = await gridGeometry(page);
    expectWithin(grid.sizeX, GRID_SPACING_WORLD * cameraAfter.zoom, 0.02, 'grid spacing x');
    expectWithin(grid.sizeY, GRID_SPACING_WORLD * cameraAfter.zoom, 0.02, 'grid spacing y');
    expectWithin(grid.positionX, mod(-cameraAfter.x * cameraAfter.zoom, grid.sizeX), 0.02, 'grid phase x');
    expectWithin(grid.positionY, mod(-cameraAfter.y * cameraAfter.zoom, grid.sizeY), 0.02, 'grid phase y');
  });

  test('TC-24 zooming around the pointer keeps the dot under the pointer, and never zooms the page', async ({ page }) => {
    await openBoard(page);
    const cameraBefore = await getCamera(page);
    const dot = nearestDot(cameraBefore, { x: 500, y: 400 });
    const pointer = worldToScreen(cameraBefore, dot);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    await zoomWheel(page, pointer, -100);

    const cameraAfter = await getCamera(page);
    expect(cameraAfter.zoom).toBeGreaterThan(cameraBefore.zoom);
    const dotAfter = worldToScreen(cameraAfter, dot);
    expectWithin(dotAfter.x, pointer.x, PIXEL_TOLERANCE, 'dot under pointer x');
    expectWithin(dotAfter.y, pointer.y, PIXEL_TOLERANCE, 'dot under pointer y');

    // The rendered marker is where the camera says the board origin is.
    const marker = await markerCentre(page);
    const markerExpected = worldToScreen(cameraAfter, { x: 0, y: 0 });
    expectWithin(marker.x, markerExpected.x, PIXEL_TOLERANCE, 'marker x');
    expectWithin(marker.y, markerExpected.y, PIXEL_TOLERANCE, 'marker y');

    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(scaleAfter).toBe(scaleBefore);
    expect(scaleAfter).toBe(1);
  });

  test('TC-24 panning by scrolling moves content opposite to the scroll direction', async ({ page }) => {
    await openBoard(page);
    const before = await markerCentre(page);

    await page.mouse.move(600, 400);
    await page.mouse.wheel(0, 100);
    await waitForRender(page);

    const afterDown = await markerCentre(page);
    expectWithin(afterDown.y, before.y - 100, PIXEL_TOLERANCE, 'scroll down moves content up');

    await page.mouse.wheel(150, 0);
    await waitForRender(page);

    const afterRight = await markerCentre(page);
    expectWithin(afterRight.x, afterDown.x - 150, PIXEL_TOLERANCE, 'scroll right moves content left');
  });
});

test.describe('workflow 2 — limits and recovery', () => {
  test('TC-25 zooming in with the button stops at 400% with the button disabled', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_PERCENT_SCALE}%`);

    await zoomInButton(page).click();
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE)}%`);
    await zoomOutButton(page).click();
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_PERCENT_SCALE}%`);

    await clickUntilDisabled(page, zoomInButton(page));
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE)}%`);
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();

    // Zooming back the other way re-enables the button.
    await zoomOutButton(page).click();
    await expect(zoomInButton(page)).toBeEnabled();
    await expect(zoomLabel(page)).not.toHaveText(`${Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE)}%`);
  });

  test('TC-25 zooming out with the button stops at 10% with the button disabled', async ({ page }) => {
    await openBoard(page);
    await clickUntilDisabled(page, zoomOutButton(page));
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('TC-26 Reset view returns to 100% with the board start point centred', async ({ page }) => {
    await openBoard(page);
    const box = await boardElement(page).boundingBox();
    if (!box) throw new Error('board has no bounding box');

    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE)}%`);

    await resetViewButton(page).click();
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_PERCENT_SCALE}%`);

    const marker = await markerCentre(page);
    expectWithin(marker.x, box.x + box.width / 2, PIXEL_TOLERANCE, 'origin marker centred x');
    expectWithin(marker.y, box.y + box.height / 2, PIXEL_TOLERANCE, 'origin marker centred y');
  });

  test('TC-31 keyboard Ctrl/Cmd + = / - / 0 step the zoom and reset without zooming the page', async ({ page }) => {
    await openBoard(page);
    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    const controlsBefore = await page.getByTestId('zoom-controls').boundingBox();

    await zoomWheel(page, { x: 500, y: 400 }, -100);
    const zoomedByWheel = await getCamera(page);
    expect(zoomedByWheel.zoom).toBeGreaterThan(1);
    await resetViewButton(page).click();
    await waitForRender(page);

    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE)}%`);
    await page.keyboard.press('Control+-');
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_PERCENT_SCALE}%`);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_PERCENT_SCALE}%`);

    const marker = await markerCentre(page);
    const box = await boardElement(page).boundingBox();
    if (!box) throw new Error('board has no bounding box');
    expectWithin(marker.x, box.x + box.width / 2, PIXEL_TOLERANCE, 'reset centred x');
    expectWithin(marker.y, box.y + box.height / 2, PIXEL_TOLERANCE, 'reset centred y');

    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    expect(after).toEqual(before);

    const controlsAfter = await page.getByTestId('zoom-controls').boundingBox();
    expect(controlsAfter?.width).toBeCloseTo(controlsBefore?.width ?? 0, 6);
    expect(controlsAfter?.height).toBeCloseTo(controlsBefore?.height ?? 0, 6);

    // The page itself still renders at its normal scale.
    const bodyFontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
    expect(bodyFontSize).toBe('16px');
  });
});

test.describe('workflow 3 — far travel', () => {
  test('TC-27 a million units from the start the grid is even and dragging is still exact', async ({ page }) => {
    await openBoard(page);
    const box = await boardElement(page).boundingBox();
    if (!box) throw new Error('board has no bounding box');

    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const camera = await getCamera(page);
    expect(Math.abs(camera.x)).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT, 6);
    expect(Math.abs(camera.y)).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT, 6);

    // The dot grid is still evenly spaced, and it is still attached to the board:
    // its rendered phase is the camera offset modulo the spacing.
    const grid = await gridGeometry(page);
    expectWithin(grid.sizeX, GRID_SPACING_WORLD * camera.zoom, 0.02, 'grid spacing x far away');
    expectWithin(grid.sizeY, GRID_SPACING_WORLD * camera.zoom, 0.02, 'grid spacing y far away');
    expectWithin(grid.positionX, mod(-camera.x * camera.zoom, grid.sizeX), 0.02, 'grid phase x far away');
    expectWithin(grid.positionY, mod(-camera.y * camera.zoom, grid.sizeY), 0.02, 'grid phase y far away');

    // The board origin is a million pixels away and still placed to sub-pixel
    // accuracy, with no distortion.
    const before = await markerCentre(page);
    const expectedBefore = worldToScreen(camera, { x: 0, y: 0 });
    expectWithin(before.x, expectedBefore.x, PIXEL_TOLERANCE, 'origin placed far away x');
    expectWithin(before.y, expectedBefore.y, PIXEL_TOLERANCE, 'origin placed far away y');

    await dragBoard(page, { x: 400, y: 300 }, { x: 600, y: 400 });

    const cameraAfter = await getCamera(page);
    expect(Math.abs(cameraAfter.x - (camera.x - 200))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(cameraAfter.y - (camera.y - 100))).toBeLessThanOrEqual(1e-6);

    const after = await markerCentre(page);
    expectWithin(after.x - before.x, 200, PIXEL_TOLERANCE, 'far away drag x');
    expectWithin(after.y - before.y, 100, PIXEL_TOLERANCE, 'far away drag y');

    // The grid moved with the board: its phase advanced by exactly the pan.
    const gridAfter = await gridGeometry(page);
    expectWithin(gridAfter.positionX, mod(grid.positionX + 200, gridAfter.sizeX), 0.02, 'grid phase advanced x');
    expectWithin(gridAfter.positionY, mod(grid.positionY + 100, gridAfter.sizeY), 0.02, 'grid phase advanced y');

    // Reset view still comes home.
    await resetViewButton(page).click();
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_PERCENT_SCALE}%`);
    const home = await markerCentre(page);
    expectWithin(home.x, box.x + box.width / 2, PIXEL_TOLERANCE, 'reset from far away x');
    expectWithin(home.y, box.y + box.height / 2, PIXEL_TOLERANCE, 'reset from far away y');
  });
});

test.describe('board geometry', () => {
  test('resizing the window does not move content relative to the board top-left', async ({ page }) => {
    await openBoard(page);
    await dragBoard(page, { x: 400, y: 300 }, { x: 520, y: 360 });
    const before = await markerCentre(page);
    const cameraBefore = await getCamera(page);

    await page.setViewportSize({ width: 1000, height: 700 });
    await waitForRender(page);

    const after = await markerCentre(page);
    const cameraAfter = await getCamera(page);
    expectWithin(after.x, before.x, PIXEL_TOLERANCE, 'marker stays put on resize');
    expectWithin(after.y, before.y, PIXEL_TOLERANCE, 'marker stays put on resize');
    expect(cameraAfter).toEqual(cameraBefore);
  });
});
