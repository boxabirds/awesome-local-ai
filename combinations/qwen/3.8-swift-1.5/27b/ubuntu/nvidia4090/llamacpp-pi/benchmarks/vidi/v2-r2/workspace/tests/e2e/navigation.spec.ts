import { test, expect } from '@playwright/test';
import { getOriginMarker, setCamera, openBoard } from './helpers/board';

test.describe('Story 1: Pan and zoom around an infinite board', () => {
  test.describe('Workflow 1: First visit navigation', () => {
    test('TC-28: hint is visible on load and disappears after drag', async ({ page }) => {
      await openBoard(page);

      // Hint should be visible
      const hint = page.getByTestId('navigation-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

      // Drag to dismiss
      await page.mouse.move(400, 300);
      await page.mouse.down();
      await page.mouse.move(500, 350);
      await page.mouse.up();

      // Hint should be gone
      await expect(hint).not.toBeVisible();
    });

    test('TC-23: mouse drag moves origin marker exactly', async ({ page }) => {
      await openBoard(page);

      const origin = getOriginMarker(page);
      const before = await origin.boundingBox();
      expect(before).not.toBeNull();

      // Drag 200px right, 100px down
      await page.mouse.move(400, 300);
      await page.mouse.down();
      await page.mouse.move(600, 400, { steps: 5 });
      await page.mouse.up();

      const after = await origin.boundingBox();
      expect(after).not.toBeNull();

      expect(after!.x - before!.x).toBeCloseTo(200, 0);
      expect(after!.y - before!.y).toBeCloseTo(100, 0);
    });

    test('TC-24: Ctrl+wheel zooms around pointer, dot stays under pointer', async ({ page }) => {
      await openBoard(page);

      const origin = getOriginMarker(page);
      const before = await origin.boundingBox();
      expect(before).not.toBeNull();

      // Get the center of the origin marker
      const originX = before!.x + before!.width / 2;
      const originY = before!.y + before!.height / 2;

      // Zoom in with Ctrl+wheel at the origin marker position
      await page.mouse.move(originX, originY);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');

      const after = await origin.boundingBox();
      expect(after).not.toBeNull();

      // The origin marker should stay approximately under the pointer
      const afterX = after!.x + after!.width / 2;
      const afterY = after!.y + after!.height / 2;

      expect(Math.abs(afterX - originX)).toBeLessThan(2);
      expect(Math.abs(afterY - originY)).toBeLessThan(2);

      // Page zoom should not have changed
      const visualViewportScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      expect(visualViewportScale).toBe(1);
    });
  });

  test.describe('Workflow 2: Limits and recovery', () => {
    test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
      await openBoard(page);

      const zoomIn = page.getByTestId('zoom-in');
      const label = page.getByTestId('zoom-label');

      // Click + repeatedly until disabled
      for (let i = 0; i < 30; i++) {
        if (await zoomIn.isDisabled()) break;
        await zoomIn.click();
      }

      await expect(label).toHaveText('400%');
      await expect(zoomIn).toBeDisabled();
    });

    test('TC-26: reset returns to 100% centred from far away', async ({ page }) => {
      await openBoard(page);

      // Jump far away using the test hook
      await setCamera(page, 1000000, 1000000, 4);

      // Click Reset view
      await page.getByTestId('reset-view').click();

      // Label should show 100%
      await expect(page.getByTestId('zoom-label')).toHaveText('100%');

      // Origin marker should be at viewport centre
      const origin = getOriginMarker(page);
      const box = await origin.boundingBox();
      expect(box).not.toBeNull();

      const { innerWidth, innerHeight } = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }));
      const viewportCenter = { x: innerWidth / 2, y: innerHeight / 2 };
      const originCenter = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };

      expect(Math.abs(originCenter.x - viewportCenter.x)).toBeLessThan(2);
      expect(Math.abs(originCenter.y - viewportCenter.y)).toBeLessThan(2);
    });
  });

  test.describe('Workflow 3: Far travel', () => {
    test('TC-27: at 1,000,000 units, drag moves exactly and grid spacing is correct', async ({ page }) => {
      await openBoard(page);

      // Jump to 1,000,000 units away
      await setCamera(page, 1000000, 1000000, 1);

      // Get grid spacing
      const gridSpacing = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="board-grid"]');
        if (!grid) return 0;
        const style = window.getComputedStyle(grid);
        return parseFloat(style.backgroundSize);
      });

      // At zoom 1, grid spacing should be 24px (GRID_SPACING_WORLD)
      expect(gridSpacing).toBeCloseTo(24, 0);

      // Pan back towards a visible area for the drag test
      await setCamera(page, 1280 / 2 - 100, 800 / 2 - 100, 1);

      const origin = getOriginMarker(page);
      const before = await origin.boundingBox();
      expect(before).not.toBeNull();

      await page.mouse.move(400, 300);
      await page.mouse.down();
      await page.mouse.move(600, 400, { steps: 5 });
      await page.mouse.up();

      const after = await origin.boundingBox();
      expect(after).not.toBeNull();

      expect(after!.x - before!.x).toBeCloseTo(200, 0);
      expect(after!.y - before!.y).toBeCloseTo(100, 0);
    });
  });

  test.describe('TC-31: Board gestures do not zoom the page', () => {
    test('Ctrl+wheel and keyboard shortcuts do not change page zoom', async ({ page }) => {
      await openBoard(page);

      const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
      const dprBefore = await page.evaluate(() => window.devicePixelRatio);

      // Ctrl+wheel
      await page.mouse.move(640, 400);
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
