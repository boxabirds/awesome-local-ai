import { test, expect } from '@playwright/test';
import { getOriginMarkerPosition, readZoomLabel, setCamera } from './helpers/board';
import { ZOOM_MAX, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

test.describe('First visit navigation', () => {
  test('TC-28: hint visible then removed after drag', async ({ page }) => {
    await page.goto('/');
    // Hint is visible
    await expect(page.locator('text=Drag to move around')).toBeVisible();
    // Drag to navigate
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(600, 500);
    await page.mouse.up();
    // Hint is gone
    await expect(page.locator('text=Drag to move around')).not.toBeVisible();
  });

  test('TC-23: mouse drag moves origin marker by exact pixels', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="origin-marker"]');

    const before = await getOriginMarkerPosition(page);

    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(600, 500);
    await page.mouse.up();
    await page.waitForTimeout(50);

    const after = await getOriginMarkerPosition(page);

    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: ctrl+wheel keeps grid dot under pointer', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="origin-marker"]');

    const markerBefore = await getOriginMarkerPosition(page);

    // Move pointer to marker position, then ctrl+wheel zoom at that point
    await page.mouse.move(markerBefore.x, markerBefore.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(50);

    const markerAfter = await getOriginMarkerPosition(page);

    // Origin marker should stay under the pointer where we zoomed
    expect(Math.abs(markerAfter.x - markerBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(markerAfter.y - markerBefore.y)).toBeLessThanOrEqual(1);
  });

  test('TC-31: browser zoom unchanged after gestures', async ({ page }) => {
    await page.goto('/');

    const initialScale = await page.evaluate(() => {
      return { vs: window.visualViewport?.scale ?? 1, dpr: window.devicePixelRatio };
    });

    // Ctrl+wheel zoom over board
    await page.mouse.move(400, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');

    // Ctrl+= (zoom in shortcut)
    await page.keyboard.press('Control+=');

    // Ctrl+- (zoom out shortcut)
    await page.keyboard.press('Control+-');

    // Ctrl+0 (reset shortcut)
    await page.keyboard.press('Control+0');

    await page.waitForTimeout(50);

    const afterScale = await page.evaluate(() => {
      return { vs: window.visualViewport?.scale ?? 1, dpr: window.devicePixelRatio };
    });

    expect(afterScale.vs).toBe(initialScale.vs);
    expect(afterScale.dpr).toBe(initialScale.dpr);
  });
});

test.describe('Limits and recovery', () => {
  test('TC-25: click + until disabled, label shows 400%', async ({ page }) => {
    await page.goto('/');

    // Click zoom-in many times until disabled
    for (let i = 0; i < 20; i++) {
      const btn = page.locator('button[aria-label="Zoom in"]');
      if (await btn.getAttribute('disabled') !== null) break;
      await btn.click();
    }

    await expect(page.locator('output')).toHaveText(`${Math.round(ZOOM_MAX * 100)}%`);
    await expect(page.locator('button[aria-label="Zoom in"]')).toBeDisabled();
  });

  test('TC-26: reset view returns to 100% with origin at viewport center', async ({ page }) => {
    await page.goto('/');

    // Jump far away via test hook, zoomed in
    await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);

    // Click Reset view
    await page.click('button:text("Reset view")');
    await page.waitForTimeout(50);

    const label = await readZoomLabel(page);
    expect(label).toBe(100);

    // Origin marker at viewport center ±1px
    const marker = await getOriginMarkerPosition(page);
    expect(Math.abs(marker.x - VIEWPORT_WIDTH / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(marker.y - VIEWPORT_HEIGHT / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('Far travel', () => {
  test('TC-27: at UNBOUNDED_PAN_TESTED_EXTENT, drag moves grid and marker exactly', async ({ page }) => {
    await page.goto('/');

    // Navigate far away via test hook
    await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);

    // Origin marker should be far off screen
    const before = await getOriginMarkerPosition(page);

    // Drag
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(600, 500);
    await page.mouse.up();
    await page.waitForTimeout(50);

    const after = await getOriginMarkerPosition(page);

    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });
});
