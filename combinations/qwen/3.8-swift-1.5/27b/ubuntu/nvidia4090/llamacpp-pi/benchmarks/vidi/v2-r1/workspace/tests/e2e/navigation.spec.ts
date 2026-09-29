import { test, expect } from '@playwright/test';
import { getOriginMarker, getZoomLabel, setCamera, clickResetView } from './helpers/board';
import { UNBOUNDED_PAN_TESTED_EXTENT, GRID_SPACING_WORLD } from '../../src/shared/config';

test.describe('Story 1: Pan and zoom around an infinite board', () => {

  test.describe('Workflow 1: First visit navigation', () => {

    test('TC-28: hint visible on load, removed after drag', async ({ page }) => {
      await page.goto('/');

      // Hint should be visible
      const hint = page.getByTestId('navigation-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

      // Drag to dismiss the hint
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('No bounding box');

      await page.mouse.move(box.x + 400, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 500, box.y + 350, { steps: 5 });
      await page.mouse.up();

      // Hint should be gone
      await expect(hint).not.toBeVisible();
    });

    test('TC-23: mouse drag moves origin marker by exact amount', async ({ page }) => {
      await page.goto('/');

      const origin = await getOriginMarker(page);
      const beforeBox = await origin.boundingBox();
      if (!beforeBox) throw new Error('No origin marker box');

      const beforeX = beforeBox.x + beforeBox.width / 2;
      const beforeY = beforeBox.y + beforeBox.height / 2;

      // Drag 200px right, 100px down
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('No bounding box');

      await page.mouse.move(box.x + 400, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 600, box.y + 400, { steps: 10 });
      await page.mouse.up();

      const afterBox = await origin.boundingBox();
      if (!afterBox) throw new Error('No origin marker box after drag');

      const afterX = afterBox.x + afterBox.width / 2;
      const afterY = afterBox.y + afterBox.height / 2;

      expect(Math.abs(afterX - beforeX - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(afterY - beforeY - 100)).toBeLessThanOrEqual(1);
    });

    test('TC-24: Ctrl+wheel over a dot keeps it under the pointer, page zoom unchanged', async ({ page }) => {
      await page.goto('/');

      const origin = await getOriginMarker(page);
      const beforeBox = await origin.boundingBox();
      if (!beforeBox) throw new Error('No origin marker box');

      const dotX = beforeBox.x + beforeBox.width / 2;
      const dotY = beforeBox.y + beforeBox.height / 2;

      // Get page zoom before
      const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

      // Ctrl+wheel at the origin marker position (zoom in)
      await page.mouse.move(dotX, dotY);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');

      // Check page zoom is unchanged
      const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      expect(scaleAfter).toBe(scaleBefore);

      // The origin marker should still be approximately at the same screen position
      // (within 1px since we zoomed at that point)
      const afterBox = await origin.boundingBox();
      if (!afterBox) throw new Error('No origin marker box after zoom');

      const afterX = afterBox.x + afterBox.width / 2;
      const afterY = afterBox.y + afterBox.height / 2;

      expect(Math.abs(afterX - dotX)).toBeLessThanOrEqual(1);
      expect(Math.abs(afterY - dotY)).toBeLessThanOrEqual(1);
    });
  });

  test.describe('Workflow 2: Limits and recovery', () => {

    test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
      await page.goto('/');

      const zoomIn = page.getByLabel('Zoom in');

      // Click zoom in repeatedly until disabled (from 100%, need to reach 400%)
      // 100 * 1.25^n = 400 → n = log(4)/log(1.25) ≈ 15.1, so about 16 clicks
      for (let i = 0; i < 30; i++) {
        if (await zoomIn.isDisabled()) break;
        await zoomIn.click();
        await page.waitForTimeout(10);
      }

      // Should be disabled now
      await expect(zoomIn).toBeDisabled();

      // Label should show 400%
      const label = await getZoomLabel(page);
      expect(label).toBe('400%');
    });

    test('TC-26: from far away at zoom 4, Reset view returns to 100% centred', async ({ page }) => {
      await page.goto('/');

      // Jump far away and set zoom to 4
      await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 4);

      // Click Reset view
      await clickResetView(page);

      // Label should show 100%
      const label = await getZoomLabel(page);
      expect(label).toBe('100%');

      // Origin marker should be at viewport centre
      const origin = await getOriginMarker(page);
      const originBox = await origin.boundingBox();
      if (!originBox) throw new Error('No origin marker box');

      const viewportBox = await page.getByTestId('board-viewport').boundingBox();
      if (!viewportBox) throw new Error('No viewport box');

      const originX = originBox.x + originBox.width / 2;
      const originY = originBox.y + originBox.height / 2;
      const centreX = viewportBox.x + viewportBox.width / 2;
      const centreY = viewportBox.y + viewportBox.height / 2;

      expect(Math.abs(originX - centreX)).toBeLessThanOrEqual(1);
      expect(Math.abs(originY - centreY)).toBeLessThanOrEqual(1);
    });
  });

  test.describe('Workflow 3: Far travel', () => {
    test('TC-27: at 1,000,000 units, drag is exact and grid spacing is correct', async ({ page }) => {
      await page.goto('/');

      // Jump to 1,000,000 units away
      await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1.0);

      const origin = await getOriginMarker(page);
      const beforeBox = await origin.boundingBox();
      if (!beforeBox) throw new Error('No origin marker box');

      const beforeX = beforeBox.x + beforeBox.width / 2;
      const beforeY = beforeBox.y + beforeBox.height / 2;

      // Drag 200px right, 100px down
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('No bounding box');

      await page.mouse.move(box.x + 400, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 600, box.y + 400, { steps: 10 });
      await page.mouse.up();

      const afterBox = await origin.boundingBox();
      if (!afterBox) throw new Error('No origin marker box after drag');

      const afterX = afterBox.x + afterBox.width / 2;
      const afterY = afterBox.y + afterBox.height / 2;

      expect(Math.abs(afterX - beforeX - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(afterY - beforeY - 100)).toBeLessThanOrEqual(1);

      // Check grid spacing
      const viewportEl = page.getByTestId('board-viewport');
      const bgSize = await viewportEl.evaluate((el) => {
        return getComputedStyle(el).backgroundSize;
      });
      // At zoom 1.0, spacing should be GRID_SPACING_WORLD = 24px
      expect(bgSize).toContain(String(GRID_SPACING_WORLD));
    });
  });

  test.describe('TC-31: Board gestures do not zoom the page', () => {
    test('Ctrl+wheel and Ctrl+=/-/0 do not change page zoom', async ({ page }) => {
      await page.goto('/');

      const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const dprBefore = await page.evaluate(() => window.devicePixelRatio);

      // Ctrl+wheel
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('No bounding box');

      await page.mouse.move(box.x + 400, box.y + 300);
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

      const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const dprAfter = await page.evaluate(() => window.devicePixelRatio);

      expect(scaleAfter).toBe(scaleBefore);
      expect(dprAfter).toBe(dprBefore);
    });
  });
});
