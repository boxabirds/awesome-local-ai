import { test, expect } from '@playwright/test';
import { getOriginMarkerPosition, getZoomLabel, setCamera } from './helpers/board';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX, GRID_SPACING_WORLD } from '../../src/shared/config';

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28: hint visible then removed after drag', async ({ page }) => {
    await page.goto('/');
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();

    // Drag
    const viewport = page.getByTestId('board-viewport');
    const box = await viewport.boundingBox(); if (!box) throw new Error();
    await page.mouse.move(box.x + 400, box.y + 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 500);
    await page.mouse.up();

    await expect(hint).not.toBeVisible();
  });

  test('TC-23: drag 200,100 moves origin marker exactly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="origin-marker"]');

    const before = await getOriginMarkerPosition(page);

    const viewport = page.getByTestId('board-viewport');
    const box = await viewport.boundingBox(); if (!box) throw new Error();
    const startX = box.x + 600;
    const startY = box.y + 400;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY + 100);
    await page.mouse.up();
    await page.waitForTimeout(100); // Wait for rAF

    const after = await getOriginMarkerPosition(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);
  });

  test('TC-24: Ctrl+wheel zooms around pointer, no page zoom', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="origin-marker"]');

    // Position over origin marker
    const origin = await getOriginMarkerPosition(page);

    const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // Origin should still be near the pointer position
    const afterZoom = await getOriginMarkerPosition(page);
    // The origin was at the pointer, after zooming around it, it should stay near
    // (within 1px tolerance per spec)
    expect(Math.abs(afterZoom.x - origin.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterZoom.y - origin.y)).toBeLessThanOrEqual(1);

    // Page zoom should not change
    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(scaleAfter).toBe(initialScale);
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25: zoom in until + disabled at 400%', async ({ page }) => {
    await page.goto('/');

    const zoomInBtn = page.getByLabel('Zoom in');
    const zoomOutBtn = page.getByLabel('Zoom out');

    // Click zoom in until disabled
    for (let i = 0; i < 30; i++) {
      try {
        await zoomInBtn.click({ timeout: 2000 });
      } catch {
        break; // Button is disabled
      }
    }

    expect(await zoomInBtn.isDisabled()).toBe(true);
    expect(await zoomOutBtn.isEnabled()).toBe(true);
    const label = await getZoomLabel(page);
    expect(label).toBe('400%');
  });

  test('TC-26: Reset view returns to 100% centred from far away', async ({ page }) => {
    await page.goto('/');

    // Jump far away via test hook
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await page.waitForTimeout(100);

    // Click Reset view
    await page.getByLabel('Reset view').click();
    await page.waitForTimeout(100);

    const label = await getZoomLabel(page);
    expect(label).toBe('100%');

    // Origin marker should be at viewport centre
    const origin = await getOriginMarkerPosition(page);
    const viewportWidth = 1280;
    const viewportHeight = 800;
    expect(Math.abs(origin.x - viewportWidth / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - viewportHeight / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27: pan at UNBOUNDED_PAN_TESTED_EXTENT works exactly', async ({ page }) => {
    await page.goto('/');

    // Jump far away
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    await page.waitForTimeout(100);

    const before = await getOriginMarkerPosition(page);

    // Drag 200, 100
    const viewport = page.getByTestId('board-viewport');
    const box = await viewport.boundingBox(); if (!box) throw new Error();
    const startX = box.x + 600;
    const startY = box.y + 400;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY + 100);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const after = await getOriginMarkerPosition(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);
  });
});

test.describe('TC-31: No page zoom from board gestures', () => {
  test('Ctrl+wheel and keyboard shortcuts do not change page zoom', async ({ page }) => {
    await page.goto('/');

    const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const initialDPR = await page.evaluate(() => window.devicePixelRatio);

    // Ctrl+wheel
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(50);

    // Ctrl+=
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    // Ctrl+-
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(50);

    // Ctrl+0
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(50);

    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const dprAfter = await page.evaluate(() => window.devicePixelRatio);

    expect(scaleAfter).toBe(initialScale);
    expect(dprAfter).toBe(initialDPR);
  });
});
