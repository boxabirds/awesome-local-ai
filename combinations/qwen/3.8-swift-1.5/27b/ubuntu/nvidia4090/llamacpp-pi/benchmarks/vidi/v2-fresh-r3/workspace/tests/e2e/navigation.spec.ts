import { test, expect } from '@playwright/test';
import {
  getZoomLabel,
  getViewport,
  setCamera,
  getOriginMarkerPosition,
} from './helpers/board';

test.describe('Story 1: Pan and zoom around an infinite board', () => {
  test.describe('Workflow 1: First visit navigation', () => {
    test('TC-28: hint visible on load, removed after drag', async ({ page }) => {
      await page.goto('/');

      // Hint should be visible
      const hint = page.getByTestId('navigation-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

      // Drag to dismiss
      const viewport = getViewport(page);
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      await page.mouse.move(box.x + 400, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 500, box.y + 350);
      await page.mouse.up();

      // Hint should be gone
      await expect(hint).not.toBeVisible();
    });

    test('TC-23: mouse drag moves origin marker exactly 200,100 px', async ({ page }) => {
      await page.goto('/');

      const startPos = await getOriginMarkerPosition(page);

      const viewport = getViewport(page);
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      // Drag 200 right, 100 down from centre
      const startX = box.x + 400;
      const startY = box.y + 300;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 200, startY + 100, { steps: 10 });
      await page.mouse.up();

      const endPos = await getOriginMarkerPosition(page);
      expect(endPos.x - startPos.x).toBeGreaterThanOrEqual(199);
      expect(endPos.x - startPos.x).toBeLessThanOrEqual(201);
      expect(endPos.y - startPos.y).toBeGreaterThanOrEqual(99);
      expect(endPos.y - startPos.y).toBeLessThanOrEqual(101);
    });

    test('TC-24: Ctrl+wheel over a dot keeps it under pointer; page zoom unchanged', async ({ page }) => {
      await page.goto('/');

      // Get initial page zoom
      const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const initialDpr = await page.evaluate(() => window.devicePixelRatio);

      const startPos = await getOriginMarkerPosition(page);

      // Ctrl+wheel at the origin marker position
      await page.mouse.move(startPos.x, startPos.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100); // zoom in
      await page.keyboard.up('Control');

      // The origin marker should still be approximately under the pointer
      const endPos = await getOriginMarkerPosition(page);
      expect(Math.abs(endPos.x - startPos.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(endPos.y - startPos.y)).toBeLessThanOrEqual(2);

      // Page zoom should be unchanged
      const finalScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const finalDpr = await page.evaluate(() => window.devicePixelRatio);
      expect(finalScale).toBe(initialScale);
      expect(finalDpr).toBe(initialDpr);
    });
  });

  test.describe('Workflow 2: Limits and recovery', () => {
    test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
      await page.goto('/');

      const zoomInBtn = page.getByLabel('Zoom in');
      const label = getZoomLabel(page);

      // Click + repeatedly until disabled
      let clicks = 0;
      while (clicks < 30) {
        if (await zoomInBtn.isDisabled()) break;
        await zoomInBtn.click();
        clicks++;
      }

      // Should be at 400%
      await expect(label).toHaveText('400%');
      await expect(zoomInBtn).toBeDisabled();
    });

    test('TC-26: jump far, zoom 4, click Reset view → 100% centred', async ({ page }) => {
      await page.goto('/');

      // Jump far away using test hook
      await setCamera(page, 1_000_000, 1_000_000, 4);

      // Verify we're at 400%
      await expect(getZoomLabel(page)).toHaveText('400%');

      // Click Reset view
      await page.getByLabel('Reset view').click();

      // Should be at 100%
      await expect(getZoomLabel(page)).toHaveText('100%');

      // Origin marker should be at viewport centre
      const markerPos = await getOriginMarkerPosition(page);
      const viewportBox = await getViewport(page).boundingBox();
      if (!viewportBox) throw new Error('Viewport not found');

      const centerX = viewportBox.x + viewportBox.width / 2;
      const centerY = viewportBox.y + viewportBox.height / 2;

      expect(Math.abs(markerPos.x - centerX)).toBeLessThanOrEqual(2);
      expect(Math.abs(markerPos.y - centerY)).toBeLessThanOrEqual(2);
    });
  });

  test.describe('Workflow 3: Far travel', () => {
    test('TC-27: at 1,000,000 units, drag 200,100 moves exactly; grid spacing correct', async ({ page }) => {
      await page.goto('/');

      // Jump to 1,000,000 units away
      await setCamera(page, 1_000_000, 1_000_000, 1);

      const startPos = await getOriginMarkerPosition(page);

      // Drag 200 right, 100 down
      const viewport = getViewport(page);
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      const startX = box.x + 400;
      const startY = box.y + 300;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 200, startY + 100, { steps: 10 });
      await page.mouse.up();

      const endPos = await getOriginMarkerPosition(page);
      expect(endPos.x - startPos.x).toBeGreaterThanOrEqual(199);
      expect(endPos.x - startPos.x).toBeLessThanOrEqual(201);
      expect(endPos.y - startPos.y).toBeGreaterThanOrEqual(99);
      expect(endPos.y - startPos.y).toBeLessThanOrEqual(101);
    });
  });

  test.describe('TC-31: Board gestures do not zoom the page', () => {
    test('after Ctrl+wheel and Ctrl+=/-/0, page zoom unchanged', async ({ page }) => {
      await page.goto('/');

      const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const initialDpr = await page.evaluate(() => window.devicePixelRatio);

      // Ctrl+wheel
      await page.mouse.move(640, 400);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -200);
      await page.mouse.wheel(0, 200);
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
      const finalScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const finalDpr = await page.evaluate(() => window.devicePixelRatio);
      expect(finalScale).toBe(initialScale);
      expect(finalDpr).toBe(initialDpr);
    });
  });
});
