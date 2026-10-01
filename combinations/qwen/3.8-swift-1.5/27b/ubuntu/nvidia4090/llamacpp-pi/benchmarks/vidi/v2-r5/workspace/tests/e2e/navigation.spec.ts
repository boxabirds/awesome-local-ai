// tests/e2e/navigation.spec.ts
import { test, expect } from '@playwright/test';
import { getOriginMarkerPosition, getZoomLabel, setCamera, dragBoard } from './helpers/board';
import { UNBOUNDED_PAN_TESTED_EXTENT, GRID_SPACING_WORLD } from '../../src/shared/config';

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28: hint visible then removed after drag', async ({ page }) => {
    await page.goto('/');

    // Hint should be visible
    const hint = page.locator('[data-testid="navigation-hint"]');
    await expect(hint).toBeVisible();

    // Drag the board
    await dragBoard(page, 400, 400, 100, 50);

    // Hint should be gone
    await expect(hint).not.toBeVisible();
  });

  test('TC-23: drag moves origin marker by exactly (200, 100)', async ({ page }) => {
    await page.goto('/');

    // Get initial position of origin marker
    const before = await getOriginMarkerPosition(page);

    // Drag 200 right, 100 down
    await dragBoard(page, 400, 400, 200, 100);

    // Get new position
    const after = await getOriginMarkerPosition(page);

    // Should have moved by approximately (200, 100)
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: Ctrl+wheel zooms and page zoom stays 1', async ({ page }) => {
    await page.goto('/');

    // Position mouse at a specific point
    const mouseX = 400;
    const mouseY = 300;
    await page.mouse.move(mouseX, mouseY);

    // Zoom in with Ctrl+wheel
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // Check that page zoom did not change
    const visualScale = await page.evaluate(() => {
      return window.visualViewport ? window.visualViewport.scale : 1;
    });
    expect(visualScale).toBe(1);

    // Zoom label should have changed from 100%
    const label = await getZoomLabel(page);
    expect(label).not.toBe('100%');
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
    await page.goto('/');

    const zoomIn = page.locator('[data-testid="zoom-in"]');
    const label = page.locator('[data-testid="zoom-label"]');

    // Click + until disabled
    for (let i = 0; i < 15; i++) {
      const disabled = await zoomIn.evaluate(el => (el as HTMLButtonElement).disabled);
      if (disabled) break;
      await zoomIn.click();
      await page.waitForTimeout(50);
    }

    // Should be at 400% and disabled
    await expect(label).toHaveText('400%');
    const isDisabled = await zoomIn.evaluate(el => (el as HTMLButtonElement).disabled);
    expect(isDisabled).toBe(true);
  });

  test('TC-26: reset view from far away returns to 100% centred', async ({ page }) => {
    await page.goto('/');

    // Jump far away using test hook
    await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 4);

    // Verify we are at 400%
    const label = page.locator('[data-testid="zoom-label"]');
    await expect(label).toHaveText('400%');

    // Click Reset view
    await page.locator('[data-testid="reset-view"]').click();

    // Should be at 100%
    await expect(label).toHaveText('100%');

    // Origin marker should be at viewport centre
    const origin = await getOriginMarkerPosition(page);
    const viewportSize = page.viewportSize()!;
    expect(Math.abs(origin.x - viewportSize.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - viewportSize.height / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27: at 1M units drag works and grid spacing is correct', async ({ page }) => {
    await page.goto('/');

    // Jump to far away position
    await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);

    // Get origin marker position before drag
    const before = await getOriginMarkerPosition(page);

    // Drag 200, 100
    await dragBoard(page, 400, 400, 200, 100);

    // Get origin marker position after drag
    const after = await getOriginMarkerPosition(page);

    // Should have moved by exactly (200, 100)
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // Check grid spacing: at zoom 1, spacing should be GRID_SPACING_WORLD px
    const viewport = page.locator('[data-testid="board-viewport"]');
    const bgSize = await viewport.evaluate(el => getComputedStyle(el).backgroundSize);
    const parts = bgSize.split(' ');
    const w = parseFloat(parts[0]);
    expect(Math.abs(w - GRID_SPACING_WORLD)).toBeLessThanOrEqual(1);
  });
});

test.describe('TC-31: Board gestures do not zoom the page', () => {
  test('Ctrl+wheel and keys do not change page zoom', async ({ page }) => {
    await page.goto('/');

    // Get initial page zoom indicators
    const initialScale = await page.evaluate(() => {
      return window.visualViewport ? window.visualViewport.scale : 1;
    });
    const initialDPR = await page.evaluate(() => window.devicePixelRatio);

    // Ctrl+wheel over the board
    await page.mouse.move(400, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');

    // Ctrl+=
    await page.keyboard.down('Control');
    await page.keyboard.press('=');
    await page.keyboard.up('Control');

    // Ctrl+-
    await page.keyboard.down('Control');
    await page.keyboard.press('-');
    await page.keyboard.up('Control');

    // Ctrl+0
    await page.keyboard.down('Control');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');

    // Page zoom should be unchanged
    const finalScale = await page.evaluate(() => {
      return window.visualViewport ? window.visualViewport.scale : 1;
    });
    const finalDPR = await page.evaluate(() => window.devicePixelRatio);

    expect(finalScale).toBe(initialScale);
    expect(finalDPR).toBe(initialDPR);
  });
});
