import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  congruentModulo,
  ctrlWheel,
  dragBoard,
  expectedGridSpacing,
  gridGeometry,
  openBoard,
  originCentre,
  pageZoomSignals,
  readCamera,
  readZoomPercent,
  setCamera,
  waitForSettled,
} from './helpers/board';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test.describe('workflow: first visit navigation', () => {
  test('TC-28 the navigation hint is shown on load and gone after the first pan', async ({ page }) => {
    await openBoard(page);

    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(HINT_TEXT);

    await dragBoard(page, 400, 300, 60, 40);
    await expect(hint).toHaveCount(0);

    // Further navigation during the same visit never brings it back.
    await ctrlWheel(page, 500, 400, -50);
    await page.mouse.wheel(0, 100);
    await waitForSettled(page);
    await expect(hint).toHaveCount(0);
  });

  test('TC-23 a 200 x 100 pixel drag moves the board exactly that far', async ({ page }) => {
    await openBoard(page);

    const before = await originCentre(page);
    const cameraBefore = await readCamera(page);
    const gridBefore = await gridGeometry(page);

    await dragBoard(page, before.x, before.y, 200, 100);

    const after = await originCentre(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // The dot grid moved with the board: its dots are 200 px right and 100 px down.
    const gridAfter = await gridGeometry(page);
    expect(gridAfter.spacing).toBeCloseTo(gridBefore.spacing, 1);
    expect(
      congruentModulo(gridAfter.offsetX - gridBefore.offsetX, 200, gridBefore.spacing, 1),
    ).toBe(true);
    expect(
      congruentModulo(gridAfter.offsetY - gridBefore.offsetY, 100, gridBefore.spacing, 1),
    ).toBe(true);

    // The camera itself moved by exactly the pointer distance in world units at zoom 1.
    const cameraAfter = await readCamera(page);
    expect(Math.abs(cameraAfter.x - (cameraBefore.x - 200))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(cameraAfter.y - (cameraBefore.y - 100))).toBeLessThanOrEqual(1e-6);
  });

  test('TC-24 Ctrl + wheel zooms around the pointer and never zooms the page', async ({ page }) => {
    await openBoard(page);

    const signalsBefore = await pageZoomSignals(page);
    const dot = await originCentre(page);

    await ctrlWheel(page, dot.x, dot.y, -50);

    const zoomedPercent = await readZoomPercent(page);
    expect(zoomedPercent).toBeGreaterThan(100);

    const zoomed = await originCentre(page);
    expect(Math.abs(zoomed.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(zoomed.y - dot.y)).toBeLessThanOrEqual(1);

    // Zooming back out around the same pointer restores 100% with the dot in place.
    await ctrlWheel(page, dot.x, dot.y, 50);
    expect(await readZoomPercent(page)).toBe(100);
    const restored = await originCentre(page);
    expect(Math.abs(restored.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - dot.y)).toBeLessThanOrEqual(1);

    const signalsAfter = await pageZoomSignals(page);
    expect(signalsAfter).toEqual(signalsBefore);
  });

  test('pan.scroll: wheel scrolling moves the board in the scroll direction', async ({ page }) => {
    await openBoard(page);

    const before = await originCentre(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await waitForSettled(page);

    const afterVertical = await originCentre(page);
    expect(Math.abs(afterVertical.x - before.x)).toBeLessThanOrEqual(1);
    expect(afterVertical.y).toBeLessThan(before.y);
    expect(Math.abs(before.y - afterVertical.y - 100)).toBeLessThanOrEqual(1);

    await page.mouse.wheel(100, 0);
    await waitForSettled(page);

    const afterHorizontal = await originCentre(page);
    expect(afterHorizontal.x).toBeLessThan(afterVertical.x);
    expect(Math.abs(afterVertical.x - afterHorizontal.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterHorizontal.y - afterVertical.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('workflow: limits and recovery', () => {
  test('TC-25 zooming in with the button steps by 1.25x and stops at 400%', async ({ page }) => {
    await openBoard(page);

    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const labels: number[] = [];
    for (let step = 0; step < 30; step += 1) {
      if (!(await zoomIn.isEnabled())) break;
      await zoomIn.click();
      await waitForSettled(page);
      labels.push(await readZoomPercent(page));
    }

    expect(labels.length).toBeGreaterThan(3);
    expect(labels[0]).toBe(Math.round(ZOOM_STEP_FACTOR * 100));
    labels.forEach((label, index) => {
      expect(label).toBeLessThanOrEqual(Math.round(ZOOM_MAX * 100));
      if (index > 0) expect(label).toBeGreaterThanOrEqual(labels[index - 1] ?? 0);
    });
    expect(labels[labels.length - 1]).toBe(Math.round(ZOOM_MAX * 100));
    await expect(zoomIn).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled();

    // Zooming back the other way re-enables the + button.
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await waitForSettled(page);
    await expect(zoomIn).toBeEnabled();
    expect(await readZoomPercent(page)).toBeLessThan(Math.round(ZOOM_MAX * 100));
  });

  test('zooming out with the button stops at 10% and disables the button', async ({ page }) => {
    await openBoard(page);

    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    let label = 100;
    for (let step = 0; step < 40; step += 1) {
      if (!(await zoomOut.isEnabled())) break;
      await zoomOut.click();
      await waitForSettled(page);
      label = await readZoomPercent(page);
    }

    expect(label).toBe(Math.round(ZOOM_MIN * 100));
    await expect(zoomOut).toBeDisabled();

    // The grid is still evenly spaced at the minimum zoom.
    const grid = await gridGeometry(page);
    expect(grid.spacing).toBeCloseTo(expectedGridSpacing(ZOOM_MIN), 1);
  });

  test('TC-26 Reset view returns to 100% with the starting point centred', async ({ page }) => {
    await openBoard(page);

    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    expect(await readZoomPercent(page)).toBe(Math.round(ZOOM_MAX * 100));

    await page.getByRole('button', { name: 'Reset view' }).click();
    await waitForSettled(page);

    expect(await readZoomPercent(page)).toBe(100);
    const centre = await originCentre(page);
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    expect(Math.abs(centre.x - size.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - size.height / 2)).toBeLessThanOrEqual(1);
  });

  test('Ctrl/Cmd + 0 resets the view like the button', async ({ page }) => {
    await openBoard(page);

    await dragBoard(page, 640, 400, 180, -120);
    await page.keyboard.press('Control+=');
    await waitForSettled(page);
    expect(await readZoomPercent(page)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));

    await page.keyboard.press('Control+0');
    await waitForSettled(page);

    expect(await readZoomPercent(page)).toBe(100);
    const centre = await originCentre(page);
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    expect(Math.abs(centre.x - size.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - size.height / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('workflow: far travel', () => {
  test('TC-27 a million units out the grid is even and panning is still exact', async ({ page }) => {
    await openBoard(page);

    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    const before = await gridGeometry(page);
    expect(before.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);

    await dragBoard(page, 640, 400, 200, 100);

    const camera = await readCamera(page);
    expect(Math.abs(camera.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(camera.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100))).toBeLessThanOrEqual(1e-6);

    const after = await gridGeometry(page);
    expect(after.spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    expect(congruentModulo(after.offsetX - before.offsetX, 200, before.spacing, 1)).toBe(true);
    expect(congruentModulo(after.offsetY - before.offsetY, 100, before.spacing, 1)).toBe(true);

    // Zoomed all the way in, that far away, spacing is still GRID_SPACING_WORLD * zoom.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    const zoomed = await gridGeometry(page);
    expect(zoomed.spacing).toBeCloseTo(expectedGridSpacing(ZOOM_MAX), 2);

    await dragBoard(page, 640, 400, 120, -60);
    const zoomedCamera = await readCamera(page);
    expect(Math.abs(zoomedCamera.x - (UNBOUNDED_PAN_TESTED_EXTENT - 120 / ZOOM_MAX))).toBeLessThanOrEqual(
      1e-6,
    );
  });
});

test.describe('viewport resize', () => {
  test('resizing the window does not move content relative to the top-left corner', async ({ page }) => {
    await openBoard(page);

    const before = await originCentre(page);
    const initial = page.viewportSize();
    expect(initial?.width).toBeLessThan(1920);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForSettled(page);

    const after = await originCentre(page);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    // Navigation still works after a resize.
    await dragBoard(page, 900, 600, 150, 90);
    const moved = await originCentre(page);
    expect(Math.abs(moved.x - after.x - 150)).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - after.y - 90)).toBeLessThanOrEqual(1);
  });
});

test.describe('board gestures do not zoom the page', () => {
  test('the board loads without console or page errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(String(error)));

    await openBoard(page);
    await dragBoard(page, 400, 300, 80, 40);
    await ctrlWheel(page, 500, 350, -50);

    expect(problems).toEqual([]);
  });

  test('TC-31 page zoom is unchanged after every board zoom gesture', async ({ page }) => {
    await openBoard(page);

    const before = await pageZoomSignals(page);
    expect(before.visualViewportScale).toBe(1);

    await ctrlWheel(page, 640, 400, -120);
    await ctrlWheel(page, 640, 400, 60);
    await page.keyboard.press('Control+=');
    await waitForSettled(page);
    await page.keyboard.press('Control+-');
    await waitForSettled(page);
    await page.keyboard.press('Control+0');
    await waitForSettled(page);

    const after = await pageZoomSignals(page);
    expect(after).toEqual(before);

    // The board itself did respond: it is back at the standard view.
    expect(await readZoomPercent(page)).toBe(100);
    const centre = await originCentre(page);
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    expect(Math.abs(centre.x - size.width / 2)).toBeLessThanOrEqual(1);
  });

  test('scrolling over the board does not scroll the page', async ({ page }) => {
    await openBoard(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    await waitForSettled(page);

    const scroll = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(scroll.x).toBe(0);
    expect(scroll.y).toBe(0);
    expect(scroll.documentHeight).toBeLessThanOrEqual(scroll.viewportHeight);
  });
});
