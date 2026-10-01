import { test, expect } from '@playwright/test';
import { getZoomLabel, setCamera, getOriginMarkerPosition } from './helpers/board';

// Mirror of src/shared/config.ts values (E2E tests run in a separate process)
const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
const GRID_SPACING_WORLD = 24;

test.describe('Story 1: Pan and zoom around an infinite board', () => {
  test.describe('Workflow 1: First visit navigation', () => {
    test('TC-28: hint visible on load, removed after drag', async ({ page }) => {
      await page.goto('/');

      // Hint should be visible
      const hint = page.getByTestId('navigation-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

      // Drag to dismiss
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      await page.mouse.move(box.x + 400, box.y + 400);
      await page.mouse.down();
      await page.mouse.move(box.x + 500, box.y + 450, { steps: 5 });
      await page.mouse.up();

      // Hint should be gone
      await expect(hint).not.toBeVisible();
    });

    test('TC-23: drag moves origin marker exactly 200,100', async ({ page }) => {
      await page.goto('/');

      const before = await getOriginMarkerPosition(page);

      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      // Drag 200 right, 100 down
      const startX = box.x + 400;
      const startY = box.y + 400;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 200, startY + 100, { steps: 10 });
      await page.mouse.up();

      const after = await getOriginMarkerPosition(page);
      expect(after.x - before.x).toBeCloseTo(200, 0);
      expect(after.y - before.y).toBeCloseTo(100, 0);
    });

    test('TC-24: Ctrl+wheel keeps dot under pointer, page zoom unchanged', async ({ page }) => {
      await page.goto('/');

      const beforePos = await getOriginMarkerPosition(page);
      const visualViewportBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

      // Position mouse over the origin marker area and Ctrl+wheel
      await page.mouse.move(beforePos.x, beforePos.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');

      // Page zoom should remain 1
      const visualViewportAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      expect(visualViewportAfter).toBe(visualViewportBefore);

      // Zoom should have changed
      const zoomLabel = getZoomLabel(page);
      const zoomText = await zoomLabel.textContent();
      expect(zoomText).not.toBe('100%');
    });
  });

  test.describe('Workflow 2: Limits and recovery', () => {
    test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
      await page.goto('/');

      const zoomIn = page.getByTestId('zoom-in');
      const zoomLabel = getZoomLabel(page);

      // Click + until disabled (from 100%, need to reach 400%)
      // 100% * 1.25^n = 400% → n = log(4)/log(1.25) ≈ 7.56, so 8 clicks
      for (let i = 0; i < 15; i++) {
        if (await zoomIn.isDisabled()) break;
        await zoomIn.click();
        await page.waitForTimeout(50);
      }

      await expect(zoomIn).toBeDisabled();
      await expect(zoomLabel).toHaveText('400%');
    });

    test('TC-26: reset from far away returns to 100% centred', async ({ page }) => {
      await page.goto('/');

      // Jump far away using test hook
      await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 4);

      // Click Reset view
      await page.getByTestId('reset-view').click();

      // Label should show 100%
      await expect(getZoomLabel(page)).toHaveText('100%');

      // Origin marker should be at viewport centre
      const originPos = await getOriginMarkerPosition(page);
      const viewportBox = await page.getByTestId('board-viewport').boundingBox();
      if (!viewportBox) throw new Error('Viewport not found');

      const centreX = viewportBox.x + viewportBox.width / 2;
      const centreY = viewportBox.y + viewportBox.height / 2;

      expect(Math.abs(originPos.x - centreX)).toBeLessThanOrEqual(1);
      expect(Math.abs(originPos.y - centreY)).toBeLessThanOrEqual(1);
    });
  });

  test.describe('Workflow 3: Far travel', () => {
    test('TC-27: at 1M units, drag is exact and grid spacing correct', async ({ page }) => {
      await page.goto('/');

      // Jump to 1M units away
      await setCamera(page, UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);

      const before = await getOriginMarkerPosition(page);

      // Drag 200 right, 100 down
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      const startX = box.x + 400;
      const startY = box.y + 400;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 200, startY + 100, { steps: 10 });
      await page.mouse.up();

      const after = await getOriginMarkerPosition(page);
      expect(after.x - before.x).toBeCloseTo(200, 0);
      expect(after.y - before.y).toBeCloseTo(100, 0);

      // Grid spacing should be GRID_SPACING_WORLD * zoom = 24 * 1 = 24px
      const gridSpacing = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="board-viewport"]');
        if (!el) return 0;
        const style = window.getComputedStyle(el);
        const size = style.backgroundSize;
        const match = size.match(/([\d.]+)px/);
        return match ? parseFloat(match[1]) : 0;
      });
      expect(gridSpacing).toBeCloseTo(GRID_SPACING_WORLD * 1, 0);
    });
  });

  test.describe('Negative: page zoom suppression', () => {
    test('TC-31: board gestures do not change page zoom', async ({ page }) => {
      await page.goto('/');

      const dprBefore = await page.evaluate(() => window.devicePixelRatio);
      const vvBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

      // Ctrl+wheel
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');

      await page.mouse.move(box.x + 400, box.y + 400);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');

      // Ctrl+=
      await page.keyboard.down('Control');
      await page.keyboard.press('Equal');
      await page.keyboard.up('Control');

      // Ctrl+-
      await page.keyboard.down('Control');
      await page.keyboard.press('Minus');
      await page.keyboard.up('Control');

      // Ctrl+0
      await page.keyboard.down('Control');
      await page.keyboard.press('Digit0');
      await page.keyboard.up('Control');

      const dprAfter = await page.evaluate(() => window.devicePixelRatio);
      const vvAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);

      expect(dprAfter).toBe(dprBefore);
      expect(vvAfter).toBe(vvBefore);
    });
  });
});
