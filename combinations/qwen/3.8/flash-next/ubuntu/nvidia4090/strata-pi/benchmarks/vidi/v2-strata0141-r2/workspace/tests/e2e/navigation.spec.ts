import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  NAVIGATION_HINT_TEXT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  boardSize,
  clickResetView,
  clickZoomIn,
  clickZoomOut,
  clickSettled,
  ctrlWheel,
  currentCamera,
  dragBoard,
  expectCamera,
  expectCentre,
  gridInfo,
  openBoard,
  originCentre,
  pageZoomState,
  pressWithControl,
  scrollBoard,
  setBoardCamera,
  settle,
  zoomLabelLocator,
} from './helpers/board';

/** The spec allows one pixel of slack on real-browser pixel measurements. */
const PX = 1;

function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 the navigation hint is shown on load and gone after the first pan', async ({ page }) => {
    await openBoard(page);

    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(NAVIGATION_HINT_TEXT);

    // The first pan dismisses it.
    await dragBoard(page, { x: 400, y: 300 }, { x: 460, y: 340 });
    await expect(hint).toHaveCount(0);

    // Further navigation of every kind keeps it hidden for this visit.
    await scrollBoard(page, 0, 120);
    await ctrlWheel(page, { x: 400, y: 300 }, -60);
    await pressWithControl(page, 'Equal');
    await expect(zoomLabelLocator(page)).not.toHaveText('100%');
    await expect(hint).toHaveCount(0);
  });

  test('TC-23 dragging 200 px right and 100 px down moves the board by exactly that', async ({ page }) => {
    await openBoard(page);

    const before = await originCentre(page);
    const gridBefore = await gridInfo(page);

    // Drag with an explicit mid-drag check so the Panning state is visible.
    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.move(400, 250);
    await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-panning', 'true');
    await page.mouse.move(500, 300);
    await page.mouse.up();

    await expectCentre(page, { x: before.x + 200, y: before.y + 100 }, PX);
    await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-panning', 'false');

    // The dot grid moved with the board (modulo its repeating spacing).
    const gridAfter = await gridInfo(page);
    const spacing = gridAfter.size;
    expect(mod(gridAfter.offsetX - gridBefore.offsetX, spacing)).toBeCloseTo(mod(200, spacing), 3);
    expect(mod(gridAfter.offsetY - gridBefore.offsetY, spacing)).toBeCloseTo(mod(100, spacing), 3);
    expect(gridAfter.size).toBeCloseTo(GRID_SPACING_WORLD, 6);
  });

  test('TC-15e scrolling moves the board in the scroll direction', async ({ page }) => {
    await openBoard(page);
    await page.mouse.move(640, 300);

    const before = await originCentre(page);

    await scrollBoard(page, 0, 100); // scroll down: content moves up
    await expectCentre(page, { x: before.x, y: before.y - 100 }, PX);

    const afterVertical = await originCentre(page);
    await scrollBoard(page, 60, 0); // trackpad scroll right: content moves left
    await expectCentre(page, { x: afterVertical.x - 60, y: afterVertical.y }, PX);

    // The page itself never scrolled.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('TC-24 Ctrl+wheel zooms around the pointer and never zooms the page', async ({ page }) => {
    await openBoard(page);

    await expect(zoomLabelLocator(page)).toHaveText('100%');
    const pageZoomBefore = await pageZoomState(page);

    // Hover exactly over the origin marker (a distinctive grid intersection).
    const target = await originCentre(page);
    await ctrlWheel(page, target, -120);

    await expect(zoomLabelLocator(page)).not.toHaveText('100%');
    await expectCentre(page, target, PX);

    // Zoom back out around the same pointer location.
    const target2 = await originCentre(page);
    await ctrlWheel(page, target2, 120);
    await expect(zoomLabelLocator(page)).toHaveText('100%');
    await expectCentre(page, target2, PX);

    // Board zoom only: the browser page zoom is untouched.
    const pageZoomAfter = await pageZoomState(page);
    expect(pageZoomAfter.scale).toBeCloseTo(pageZoomBefore.scale, 6);
    expect(pageZoomAfter.devicePixelRatio).toBeCloseTo(pageZoomBefore.devicePixelRatio, 6);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 zooming in with the + button stops at 400% and disables the button', async ({ page }) => {
    await openBoard(page);

    const zoomIn = page.getByTestId('zoom-in');
    for (const label of ['125%', '156%', '195%', '244%', '305%', '381%', '400%']) {
      await expect(zoomIn).toBeEnabled();
      await clickSettled(zoomIn);
      await expect(zoomLabelLocator(page)).toHaveText(label);
    }
    await expect(zoomIn).toBeDisabled();

    // Zooming back out re-enables + and the label tracks the zoom.
    await clickZoomOut(page);
    await expect(zoomLabelLocator(page)).toHaveText('320%');
    await expect(zoomIn).toBeEnabled();

    // Zoom out to the minimum: − is disabled and the label stops at 10%.
    const zoomOut = page.getByTestId('zoom-out');
    for (let i = 0; i < 30; i += 1) {
      if (await zoomOut.isDisabled()) {
        break;
      }
      await clickSettled(zoomOut);
    }
    await expect(zoomLabelLocator(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();
    await expect(zoomIn).toBeEnabled();
  });

  test('TC-26 Reset view returns to 100% with the starting point centred, from anywhere', async ({ page }) => {
    await openBoard(page);

    await setBoardCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabelLocator(page)).toHaveText('400%');

    await clickResetView(page);

    await expect(zoomLabelLocator(page)).toHaveText('100%');
    const size = await boardSize(page);
    await expectCentre(page, { x: size.width / 2, y: size.height / 2 }, PX);
  });

  test('TC-18e Ctrl+= / − / 0 zoom and reset from the keyboard', async ({ page }) => {
    await openBoard(page);

    await pressWithControl(page, 'Equal');
    await expect(zoomLabelLocator(page)).toHaveText('125%');
    await pressWithControl(page, 'Minus');
    await expect(zoomLabelLocator(page)).toHaveText('100%');

    await setBoardCamera(page, { x: 40_000, y: -25_000, zoom: 2 });
    await pressWithControl(page, 'Digit0');
    await expect(zoomLabelLocator(page)).toHaveText('100%');
    const size = await boardSize(page);
    await expectCentre(page, { x: size.width / 2, y: size.height / 2 }, PX);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 a million units from the start still pans exactly and the grid stays even', async ({ page }) => {
    await openBoard(page);

    await setBoardCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const before = await originCentre(page);
    await dragBoard(page, { x: 300, y: 200 }, { x: 500, y: 300 });
    await expectCentre(page, { x: before.x + 200, y: before.y + 100 }, PX);

    await expectCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - 200,
      y: UNBOUNDED_PAN_TESTED_EXTENT - 100,
      zoom: 1,
    });

    await expect
      .poll(async () => (await gridInfo(page)).size, { timeout: 2000 })
      .toBeCloseTo(GRID_SPACING_WORLD, 3);
    const grid = await gridInfo(page);
    const background = grid.backgroundSize.split(' ').map((part) => Number(part.replace('px', '')));
    expect(background[0]).toBeCloseTo(GRID_SPACING_WORLD, 3);
    expect(background[1]).toBeCloseTo(GRID_SPACING_WORLD, 3);

    // Panning at maximum zoom, far away, still follows the pointer one-to-one.
    await setBoardCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    const zoomedBefore = await originCentre(page);
    await dragBoard(page, { x: 300, y: 200 }, { x: 500, y: 300 });
    await expectCentre(page, { x: zoomedBefore.x + 200, y: zoomedBefore.y + 100 }, PX);
    await expect
      .poll(async () => (await gridInfo(page)).size, { timeout: 2000 })
      .toBeCloseTo(GRID_SPACING_WORLD * ZOOM_MAX, 3);

    const camera = await currentCamera(page);
    expect(camera.x).toBeGreaterThan(UNBOUNDED_PAN_TESTED_EXTENT - 1000);
  });
});

test.describe('board gestures do not zoom the page', () => {
  test('TC-31 page zoom is unchanged after every board zoom gesture', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoomState(page);

    await page.mouse.move(500, 300);
    await ctrlWheel(page, { x: 500, y: 300 }, -200);
    await ctrlWheel(page, { x: 500, y: 300 }, 200);
    await pressWithControl(page, 'Equal');
    await pressWithControl(page, 'Minus');
    await pressWithControl(page, 'Digit0');
    await clickZoomIn(page);
    await clickZoomOut(page);
    await settle(page);

    const after = await pageZoomState(page);
    expect(after.scale).toBeCloseTo(before.scale, 6);
    expect(after.devicePixelRatio).toBeCloseTo(before.devicePixelRatio, 6);

    // Only board content scaled: the controls keep their own size.
    const box = await page.getByTestId('zoom-controls').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(20);
    expect(box!.height).toBeLessThan(80);
  });
});
