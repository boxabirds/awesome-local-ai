import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';
import {
  ctrlWheelAt,
  dragBoard,
  gridBackgroundPosition,
  gridSpacingPx,
  originMarkerCenter,
  pageZoomState,
  setCamera,
  zoomLabelText,
} from './helpers/board';

const TOLERANCE_PX = 1;
const VIEWPORT = { width: 1280, height: 800 };
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.describe('story 1: pan and zoom around an infinite board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // --- Workflow 1: first-visit navigation -----------------------------------

  test('TC-28 navigation hint is visible on load and removed after the first drag', async ({
    page,
  }) => {
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();

    await dragBoard(page, CENTER.x, CENTER.y, 200, 100);

    await expect(hint).not.toBeVisible();
  });

  test('TC-23 dragging 200,100 screen px moves the origin exactly 200,100 px', async ({
    page,
  }) => {
    const before = await originMarkerCenter(page);
    await dragBoard(page, before.x, before.y, 200, 100);
    const after = await originMarkerCenter(page);

    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test('TC-24 Ctrl+wheel over a dot keeps it under the pointer; page zoom stays 1', async ({
    page,
  }) => {
    const dot = await originMarkerCenter(page);
    await ctrlWheelAt(page, dot.x, dot.y, 0, -100); // zoom in
    const after = await originMarkerCenter(page);

    expect(Math.abs(after.x - dot.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(after.y - dot.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect((await pageZoomState(page)).scale).toBe(1);
  });

  // --- Workflow 2: limits and recovery --------------------------------------

  test('TC-25 clicking + repeatedly reaches 400% and the + button becomes disabled', async ({
    page,
  }) => {
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 40 && !(await zoomIn.isDisabled()); i++) {
      await zoomIn.click();
      // Camera state commits on the next animation frame; give the DOM
      // (label + disabled attribute) time to catch up before the next step.
      await page.waitForTimeout(32);
    }

    await expect(zoomIn).toBeDisabled();
    await expect(page.locator('.zoom-controls__label')).toHaveText('400%');
  });

  test('TC-26 Reset view from far away returns to 100% centred on the origin', async ({
    page,
  }) => {
    // Teleport far away at max zoom (test-only hook).
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 4,
    });

    await page.getByRole('button', { name: 'Reset view' }).click();

    await expect(page.locator('.zoom-controls__label')).toHaveText('100%');
    const centre = await originMarkerCenter(page);
    expect(Math.abs(centre.x - CENTER.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(centre.y - CENTER.y)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  // --- Workflow 3: far travel ------------------------------------------------

  test('TC-27 at 1,000,000 units the board still pans exactly and the grid stays even', async ({
    page,
  }) => {
    const zoom = 1;
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom,
    });

    // The dot grid keeps its even, zoom-scaled spacing even far from the origin.
    const spacing = await gridSpacingPx(page);
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD * zoom, 6);

    // The grid shifts exactly (200,100) px (modulo the spacing) for the drag.
    const before = await gridBackgroundPosition(page);
    await dragBoard(page, CENTER.x, CENTER.y, 200, 100);
    const after = await gridBackgroundPosition(page);

    const mod = (a: number) => ((a % spacing) + spacing) % spacing;
    expect(mod(after.x - before.x)).toBeCloseTo(mod(200), 3);
    expect(mod(after.y - before.y)).toBeCloseTo(mod(100), 3);
  });

  // --- Negative case ---------------------------------------------------------

  test('TC-31 board gestures never change the browser page zoom', async ({ page }) => {
    const before = await pageZoomState(page);

    // Ctrl+wheel over the board.
    await ctrlWheelAt(page, CENTER.x, CENTER.y, 0, -100);

    // Keyboard zoom shortcuts (Ctrl + = / - / 0) — the browser's own
    // zoom shortcuts, which the app must preventDefault.
    await page.keyboard.down('Control');
    await page.keyboard.press('Equal');
    await page.keyboard.press('Minus');
    await page.keyboard.press('Digit0');
    await page.keyboard.up('Control');

    const after = await pageZoomState(page);
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);
    // The board label should read 100%: zoom-in then out then reset cancel out.
    await expect(page.locator('.zoom-controls__label')).toHaveText('100%');
  });
});
