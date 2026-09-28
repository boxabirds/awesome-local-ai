import { test, expect } from '@playwright/test';
import { getOriginMarkerPos, setCamera } from './helpers/board';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from 'src/shared/config';

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28: hint visible on load, removed after drag', async ({ page }) => {
    await page.goto('/');

    // Hint visible
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();

    // Drag the board
    const viewport = page.getByTestId('board-viewport');
    const box = await viewport.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 50, { steps: 5 });
    await page.mouse.up();

    // Hint should be gone
    await expect(hint).not.toBeVisible();
  });

  test('TC-23: mouse drag (200,100) moves origin marker exactly', async ({ page }) => {
    await page.goto('/');

    const before = await getOriginMarkerPos(page);

    const viewport = page.getByTestId('board-viewport');
    const box = await viewport.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 100, { steps: 10 });
    await page.mouse.up();

    const after = await getOriginMarkerPos(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: Ctrl+wheel over a dot keeps it under pointer, page zoom unchanged', async ({ page }) => {
    await page.goto('/');

    const before = await getOriginMarkerPos(page);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    // Zoom with Ctrl+wheel at the origin marker position
    await page.mouse.move(before.x, before.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    const after = await getOriginMarkerPos(page);
    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    // The point under the pointer should stay roughly in place (within 1px)
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    // Page zoom should be unchanged
    expect(scaleAfter).toBe(scaleBefore);
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
    await page.goto('/');

    const zoomIn = page.getByLabel('Zoom in');
    const label = page.getByTestId('zoom-label');

    // Click + until disabled
    for (let i = 0; i < 30; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
      await page.waitForTimeout(50);
    }

    await expect(zoomIn).toBeDisabled();
    await expect(label).toHaveText('400%');
  });

  test('TC-26: jump far via test hook, reset returns to 100% centred', async ({ page }) => {
    await page.goto('/');

    // Jump far away and zoom in
    await setCamera(page, -UNBOUNDED_PAN_TESTED_EXTENT, -UNBOUNDED_PAN_TESTED_EXTENT, 4);

    // Click Reset view
    const resetBtn = page.getByLabel('Reset view');
    await resetBtn.click();

    // Label should show 100%
    const label = page.getByTestId('zoom-label');
    await expect(label).toHaveText('100%');

    // Origin marker should be at viewport centre
    const markerPos = await getOriginMarkerPos(page);
    const vpBox = await page.getByTestId('board-viewport').boundingBox();
    const vpCenterX = vpBox!.x + vpBox!.width / 2;
    const vpCenterY = vpBox!.y + vpBox!.height / 2;
    expect(Math.abs(markerPos.x - vpCenterX)).toBeLessThanOrEqual(1);
    expect(Math.abs(markerPos.y - vpCenterY)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27: at 1M units, drag (200,100) exact movement', async ({ page }) => {
    await page.goto('/');

    // Jump to far position
    await setCamera(page, -UNBOUNDED_PAN_TESTED_EXTENT, -UNBOUNDED_PAN_TESTED_EXTENT, 1);

    const before = await getOriginMarkerPos(page);

    const viewport = page.getByTestId('board-viewport');
    const box = await viewport.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 100, { steps: 10 });
    await page.mouse.up();

    const after = await getOriginMarkerPos(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // Grid spacing should be GRID_SPACING_WORLD * zoom
    const viewportEl = page.getByTestId('board-viewport');
    const bgSize = await viewportEl.evaluate((el) => getComputedStyle(el).backgroundSize);
    const expected = GRID_SPACING_WORLD * 1; // zoom is 1
    const [w] = bgSize.split(' ').map(parseFloat);
    expect(Math.abs(w - expected)).toBeLessThanOrEqual(1);
  });
});

test.describe('TC-31: Board gestures do not zoom the page', () => {
  test('Ctrl+wheel and Ctrl+=/-/0 do not change page zoom', async ({ page }) => {
    await page.goto('/');

    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const dprBefore = await page.evaluate(() => window.devicePixelRatio);

    // Ctrl+wheel
    const markerPos = await getOriginMarkerPos(page);
    await page.mouse.move(markerPos.x, markerPos.y);
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
