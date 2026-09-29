import { test, expect } from '@playwright/test';
import {
  getOriginMarker,
  getViewport,
  getZoomLabel,
  getZoomInButton,
  getZoomOutButton,
  getResetButton,
  getNavigationHint,
  getMarkerScreenPos,
  getZoomPercent,
  setCamera,
  getWorldLayerData,
} from './helpers/board';
import { UNBOUNDED_PAN_TESTED_EXTENT, GRID_SPACING_WORLD, ZOOM_STEP_FACTOR, ZOOM_MAX, ZOOM_MIN } from '@shared/config';

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28: hint visible then removed after drag', async ({ page }) => {
    await page.goto('/');
    await expect(getNavigationHint(page)).toBeVisible();

    const viewport = getViewport(page);
    await viewport.dispatchEvent('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
    await viewport.dispatchEvent('pointermove', { pointerId: 1, clientX: 500, clientY: 400 });
    await viewport.dispatchEvent('pointerup', { pointerId: 1, clientX: 500, clientY: 400 });

    await expect(getNavigationHint(page)).not.toBeVisible();
  });

  test('TC-23: drag moves origin marker exactly 200,100 px', async ({ page }) => {
    await page.goto('/');
    await expect(getOriginMarker(page)).toBeVisible();

    const posBefore = await getMarkerScreenPos(page);

    // Drag 200 right, 100 down
    const startX = 400;
    const startY = 300;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY + 100);
    await page.mouse.up();

    const posAfter = await getMarkerScreenPos(page);
    expect(Math.abs(posAfter.x - posBefore.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(posAfter.y - posBefore.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: Ctrl+wheel zooms, dot stays under pointer', async ({ page }) => {
    await page.goto('/');

    const posBefore = await getMarkerScreenPos(page);
    const markerX = posBefore.x;
    const markerY = posBefore.y;

    // Move mouse to the marker position, then Ctrl+wheel to zoom in
    await page.mouse.move(markerX, markerY);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // Wait for render
    await page.waitForTimeout(100);

    const posAfter = await getMarkerScreenPos(page);
    // The marker should be at approximately the same screen position (±2px)
    expect(Math.abs(posAfter.x - markerX)).toBeLessThanOrEqual(2);
    expect(Math.abs(posAfter.y - markerY)).toBeLessThanOrEqual(2);

    // Page zoom should not have changed
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(scale).toBe(1);
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25: zoom to max, button disables', async ({ page }) => {
    await page.goto('/');
    await expect(getZoomLabel(page)).toHaveText('100%');

    // Click + many times
    for (let i = 0; i < 30; i++) {
      const zoomIn = getZoomInButton(page);
      const disabled = await zoomIn.isDisabled();
      if (disabled) break;
      await zoomIn.click();
    }

    await expect(getZoomLabel(page)).toHaveText('400%');
    await expect(getZoomInButton(page)).toBeDisabled();
  });

  test('TC-26: reset returns to 100% centred', async ({ page }) => {
    await page.goto('/');

    // Jump far away via test hook
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });

    // Click Reset view
    await getResetButton(page).click();

    await expect(getZoomLabel(page)).toHaveText('100%');

    // Origin marker should be at viewport centre
    const pos = await getMarkerScreenPos(page);
    const vp = page.viewportSize()!;
    expect(Math.abs(pos.x - vp.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(pos.y - vp.height / 2)).toBeLessThanOrEqual(2);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27: far location still pans exactly, grid spacing correct', async ({ page }) => {
    await page.goto('/');

    // Jump far away
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    // Drag 200,100
    const startX = 400;
    const startY = 300;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY + 100);
    await page.mouse.up();

    const cam = await getWorldLayerData(page);
    // Camera should have moved by exactly (-200/1, -100/1) world units
    expect(Math.abs(cam.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(cam.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100))).toBeLessThanOrEqual(1);

    // Grid spacing should be GRID_SPACING_WORLD * zoom px
    const grid = page.locator('[data-testid="board-grid"]');
    const bgSize = await grid.evaluate((el) => {
      return window.getComputedStyle(el).backgroundSize;
    });
    const expectedPx = GRID_SPACING_WORLD * cam.zoom;
    const parsed = parseFloat(bgSize);
    expect(Math.abs(parsed - expectedPx)).toBeLessThanOrEqual(1);
  });
});

test.describe('TC-31: page zoom unchanged', () => {
  test('after zoom gestures, visualViewport.scale and devicePixelRatio unchanged', async ({ page }) => {
    await page.goto('/');

    const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const initialDPR = await page.evaluate(() => window.devicePixelRatio);

    // Ctrl+wheel
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // Ctrl+=
    await page.keyboard.press('Control+=');

    // Ctrl+-
    await page.keyboard.press('Control+-');

    // Ctrl+0
    await page.keyboard.press('Control+0');

    await page.waitForTimeout(100);

    const finalScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const finalDPR = await page.evaluate(() => window.devicePixelRatio);

    expect(finalScale).toBe(initialScale);
    expect(finalDPR).toBe(initialDPR);
  });
});
