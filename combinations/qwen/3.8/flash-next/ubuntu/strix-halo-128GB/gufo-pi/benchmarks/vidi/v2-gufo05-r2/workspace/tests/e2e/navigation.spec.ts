import { expect, test } from '@playwright/test';

import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  ctrlWheel,
  dragBoard,
  expectNoPendingCameraFrame,
  gridStyle,
  markerCenter,
  navigationHint,
  openBoard,
  pageZoomScale,
  resetViewButton,
  setCamera,
  VIEWPORT_SIZE,
  withinTolerance,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  zoomValue,
} from './helpers/board';

/** Positive modulo, the same way the dot grid offset is computed. */
function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28: the hint shows on open and disappears after the first pan', async ({ page }) => {
    await openBoard(page);
    await expect(navigationHint(page)).toHaveText(NAVIGATION_HINT_TEXT);

    await dragBoard(page, { x: 400, y: 300 }, { x: 520, y: 360 });
    await expect(navigationHint(page)).toHaveCount(0);

    // Further navigation does not bring it back during this visit.
    await ctrlWheel(page, { x: 640, y: 400 }, -100);
    await dragBoard(page, { x: 700, y: 500 }, { x: 500, y: 420 });
    await expect(navigationHint(page)).toHaveCount(0);
  });

  test('TC-28: a reload shows the hint again', async ({ page }) => {
    await openBoard(page);
    await dragBoard(page, { x: 400, y: 300 }, { x: 500, y: 360 });
    await expect(navigationHint(page)).toHaveCount(0);

    await page.reload();
    await openBoard(page);
    await expect(navigationHint(page)).toHaveText(NAVIGATION_HINT_TEXT);
  });

  test('TC-23: dragging moves the board exactly with the pointer', async ({ page }) => {
    await openBoard(page);
    const before = await markerCenter(page);
    const gridBefore = await gridStyle(page);

    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 4 });
    await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-panning', 'true');
    const cursor = await page.getByTestId('board-viewport').evaluate((element) =>
      getComputedStyle(element).cursor,
    );
    expect(cursor).toBe('grabbing');
    await page.mouse.up();
    await expectNoPendingCameraFrame(page);
    await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-panning', 'false');

    const after = await markerCenter(page);
    expect(withinTolerance(after.x - before.x, 200)).toBe(true);
    expect(withinTolerance(after.y - before.y, 100)).toBe(true);

    // The dot grid moved with the board: its offset advanced by the drag,
    // modulo one grid cell.
    const gridAfter = await gridStyle(page);
    const spacing = gridBefore.spacingX;
    expect(
      withinTolerance(
        mod(gridAfter.offsetX - gridBefore.offsetX, spacing),
        mod(200, spacing),
        1,
      ),
    ).toBe(true);
    expect(
      withinTolerance(
        mod(gridAfter.offsetY - gridBefore.offsetY, spacing),
        mod(100, spacing),
        1,
      ),
    ).toBe(true);
  });

  test('TC-24: zooming keeps the point under the pointer in place', async ({ page }) => {
    await openBoard(page);
    const pointer = await markerCenter(page);

    await ctrlWheel(page, pointer, -200);
    expect(await zoomValue(page)).toBeGreaterThan(100);
    const zoomed = await markerCenter(page);
    expect(withinTolerance(zoomed.x, pointer.x)).toBe(true);
    expect(withinTolerance(zoomed.y, pointer.y)).toBe(true);

    await ctrlWheel(page, pointer, 200);
    const back = await markerCenter(page);
    expect(withinTolerance(back.x, pointer.x)).toBe(true);
    expect(withinTolerance(back.y, pointer.y)).toBe(true);

    // The web page itself never zoomed.
    expect(await pageZoomScale(page)).toBe(1);
  });

  test('scrolling moves the board with the scroll', async ({ page }) => {
    await openBoard(page);
    const before = await markerCenter(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await expectNoPendingCameraFrame(page);

    const after = await markerCenter(page);
    expect(withinTolerance(after.y - before.y, -100)).toBe(true);
    expect(withinTolerance(after.x - before.x, 0)).toBe(true);
    expect(await pageZoomScale(page)).toBe(1);
  });
});

test.describe('workflow 2: zoom limits and recovery', () => {
  test('TC-25: zooming in with + stops at 400% and disables the button', async ({ page }) => {
    await openBoard(page);
    expect(await zoomLabel(page)).toBe('100%');

    // The same ladder the app computes: 100% x ZOOM_STEP_FACTOR, clamped.
    const expectedLabels: number[] = [];
    let zoom = 1;
    while (zoom < ZOOM_MAX) {
      zoom = Math.min(zoom * ZOOM_STEP_FACTOR, ZOOM_MAX);
      expectedLabels.push(Math.round(zoom * 100));
    }

    for (const percent of expectedLabels) {
      await zoomInButton(page).click();
      await expect(page.getByTestId('zoom-label')).toHaveText(`${percent}%`);
    }

    await expect(zoomInButton(page)).toBeDisabled();
    expect(await zoomValue(page)).toBe(400);

    // Zooming back the other way re-enables the button.
    await zoomOutButton(page).click();
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('zooming out with − stops at 10% and disables the button', async ({ page }) => {
    await openBoard(page);
    for (let clicks = 0; clicks < 40; clicks += 1) {
      if (await zoomOutButton(page).isDisabled()) break;
      await zoomOutButton(page).click();
      // Let the camera frame render so the disabled state is up to date.
      await expectNoPendingCameraFrame(page);
    }
    await expect(zoomOutButton(page)).toBeDisabled();
    expect(await zoomValue(page)).toBe(10);

    // Zooming back the other way re-enables the button.
    await zoomInButton(page).click();
    await expectNoPendingCameraFrame(page);
    await expect(zoomOutButton(page)).toBeEnabled();
    expect(await zoomValue(page)).toBeGreaterThan(10);
  });

  test('the viewport centre stays put when using the zoom buttons', async ({ page }) => {
    await openBoard(page);
    const centre = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };
    const before = await markerCenter(page);
    // The starting point is centred at 100%, so it sits at the viewport centre.
    expect(withinTolerance(before.x, centre.x)).toBe(true);
    expect(withinTolerance(before.y, centre.y)).toBe(true);

    await zoomInButton(page).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('125%');
    await expectNoPendingCameraFrame(page);
    const after = await markerCenter(page);
    expect(withinTolerance(after.x, centre.x)).toBe(true);
    expect(withinTolerance(after.y, centre.y)).toBe(true);
  });

  test('TC-26: Reset view returns to 100% centred from far away at maximum zoom', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    expect(await zoomValue(page)).toBe(400);

    await resetViewButton(page).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');

    const centre = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };
    const marker = await markerCenter(page);
    expect(withinTolerance(marker.x, centre.x)).toBe(true);
    expect(withinTolerance(marker.y, centre.y)).toBe(true);
  });

  test('Ctrl/Cmd + 0 resets the view from the keyboard', async ({ page }) => {
    await openBoard(page);
    await dragBoard(page, { x: 400, y: 300 }, { x: 900, y: 700 });
    await zoomInButton(page).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('125%');
    await expectNoPendingCameraFrame(page);

    await page.keyboard.press('Control+0');
    await expectNoPendingCameraFrame(page);

    expect(await zoomValue(page)).toBe(100);
    const centre = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };
    const marker = await markerCenter(page);
    expect(withinTolerance(marker.x, centre.x)).toBe(true);
    expect(withinTolerance(marker.y, centre.y)).toBe(true);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27: a million units out the grid is even and drags are exact', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const before = await gridStyle(page);
    expect(withinTolerance(before.spacingX, GRID_SPACING_WORLD, 0.01)).toBe(true);
    expect(withinTolerance(before.spacingY, GRID_SPACING_WORLD, 0.01)).toBe(true);

    await dragBoard(page, { x: 300, y: 250 }, { x: 500, y: 350 });

    const after = await gridStyle(page);
    expect(withinTolerance(after.spacingX, GRID_SPACING_WORLD, 0.01)).toBe(true);
    expect(
      withinTolerance(mod(after.offsetX - before.offsetX, GRID_SPACING_WORLD), mod(200, GRID_SPACING_WORLD), 1),
    ).toBe(true);
    expect(
      withinTolerance(mod(after.offsetY - before.offsetY, GRID_SPACING_WORLD), mod(100, GRID_SPACING_WORLD), 1),
    ).toBe(true);

    // Zooming far from the start still scales the grid as GRID_SPACING_WORLD * zoom.
    const pointer = { x: 640, y: 400 };
    await ctrlWheel(page, pointer, -200);
    const zoomedOut = await gridStyle(page);
    const zoom = (await zoomValue(page)) / 100;
    expect(withinTolerance(zoomedOut.spacingX, GRID_SPACING_WORLD * zoom, 0.5)).toBe(true);

    // Reset still finds the starting point from a million units away.
    await resetViewButton(page).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    await expectNoPendingCameraFrame(page);
    const centre = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };
    const marker = await markerCenter(page);
    expect(await zoomValue(page)).toBe(100);
    expect(withinTolerance(marker.x, centre.x)).toBe(true);
    expect(withinTolerance(marker.y, centre.y)).toBe(true);
  });

  test('TC-27: the starting point can be found again after a long round trip', async ({
    page,
  }) => {
    await openBoard(page);
    const origin = await markerCenter(page);

    await setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 2,
    });
    await resetViewButton(page).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    await expectNoPendingCameraFrame(page);
    const back = await markerCenter(page);
    expect(withinTolerance(back.x, origin.x)).toBe(true);
    expect(withinTolerance(back.y, origin.y)).toBe(true);
  });
});

test.describe('board gestures never zoom the page', () => {
  test('TC-31: wheel, pinch and keyboard zoom leave page zoom untouched', async ({ page }) => {
    await openBoard(page);
    const scaleBefore = await pageZoomScale(page);
    const devicePixelRatioBefore = await page.evaluate(() => window.devicePixelRatio);
    const controlBoxBefore = await page.getByTestId('zoom-controls').boundingBox();

    await ctrlWheel(page, { x: 640, y: 400 }, -240);
    await ctrlWheel(page, { x: 640, y: 400 }, 240);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+0');
    await expectNoPendingCameraFrame(page);

    expect(await pageZoomScale(page)).toBe(scaleBefore);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(devicePixelRatioBefore);
    const controlBoxAfter = await page.getByTestId('zoom-controls').boundingBox();
    expect(controlBoxBefore).not.toBeNull();
    expect(controlBoxAfter).not.toBeNull();
    expect(Math.abs((controlBoxAfter?.height ?? 0) - (controlBoxBefore?.height ?? 0))).toBeLessThan(1);
  });

  test('keyboard shortcuts are consumed by the board', async ({ page }) => {
    await openBoard(page);
    const before = await zoomValue(page);

    await page.keyboard.press('Control+=');
    await expectNoPendingCameraFrame(page);
    expect(await zoomValue(page)).toBe(125);

    await page.keyboard.press('Control+-');
    await expectNoPendingCameraFrame(page);
    expect(await zoomValue(page)).toBe(before);
  });

  test('the board scrolls the page not at all', async ({ page }) => {
    await openBoard(page);
    const scrolled = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(300, 0);
    await expectNoPendingCameraFrame(page);
    const after = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    expect(after).toEqual(scrolled);
  });
});
