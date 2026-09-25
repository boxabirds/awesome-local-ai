import { test, expect } from '@playwright/test';
import { getOriginMarkerPosition, gotoBoard, setCamera } from './helpers/board';

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28: hint visible on load, then removed after drag', async ({ page }) => {
    await gotoBoard(page);
    
    // Hint should be visible
    const hint = page.locator('[data-testid="navigation-hint"]');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    // Drag to dismiss
    const viewport = page.locator('[data-testid="board-viewport"]');
    await viewport.dispatchEvent('pointerdown', { clientX: 640, clientY: 400, pointerId: 1 });
    await viewport.dispatchEvent('pointermove', { clientX: 740, clientY: 450, pointerId: 1 });
    await viewport.dispatchEvent('pointerup', { clientX: 740, clientY: 450, pointerId: 1 });

    // Hint should be gone
    await expect(hint).toBeHidden();
  });

  test('TC-23: real mouse drag moves origin marker exactly 200,100', async ({ page }) => {
    await gotoBoard(page);
    
    const before = await getOriginMarkerPosition(page);
    
    // Perform a real mouse drag: 200 right, 100 down
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 10 });
    await page.mouse.up();

    const after = await getOriginMarkerPosition(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: Ctrl+wheel over a point keeps it under pointer, page zoom unchanged', async ({ page }) => {
    await gotoBoard(page);
    
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    
    // Get the origin marker position
    const before = await getOriginMarkerPosition(page);
    
    // Ctrl+wheel at the origin marker position (zoom in)
    await page.mouse.move(before.x, before.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100); // scroll up with Ctrl = zoom in
    await page.keyboard.up('Control');
    
    const after = await getOriginMarkerPosition(page);
    
    // The point under the cursor should stay approximately in place
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    
    // Page zoom should be unchanged
    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(scaleAfter).toBe(scaleBefore);
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
    await gotoBoard(page);
    
    const zoomInBtn = page.getByLabel('Zoom in');
    
    // Click zoom in until disabled (from 100%, need to reach 400%)
    // 100 → 125 → 156.25 → 195.3125 → 244.14 → 305.18 → 381.47 → 400 (clamped)
    for (let i = 0; i < 20; i++) {
      if (await zoomInBtn.isDisabled()) break;
      await zoomInBtn.click();
    }
    
    await expect(page.getByTestId('zoom-label')).toHaveText('400%');
    await expect(zoomInBtn).toBeDisabled();
  });

  test('TC-26: jump far via test hook, zoom to 4, click Reset → 100% centred', async ({ page }) => {
    await gotoBoard(page);
    
    // Use test hook to jump far away
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 4 });
    
    // Verify we're at 400%
    await expect(page.getByTestId('zoom-label')).toHaveText('400%');
    
    // Click Reset view
    await page.getByLabel('Reset view').click();
    
    // Label should show 100%
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    
    // Origin marker should be at viewport centre
    const vpSize = page.viewportSize()!;
    const marker = await getOriginMarkerPosition(page);
    expect(Math.abs(marker.x - vpSize.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(marker.y - vpSize.height / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27: at 1,000,000 units, drag 200,100 gives exact movement and grid spacing', async ({ page }) => {
    await gotoBoard(page);
    
    // Jump far away using test hook
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });
    
    const before = await getOriginMarkerPosition(page);
    
    // Perform a drag: 200 right, 100 down
    // First pan to bring origin into view or just drag from center
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 10 });
    await page.mouse.up();
    
    const after = await getOriginMarkerPosition(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
    
    // Check grid spacing
    const gridSpacing = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="board-viewport"]')!;
      const style = window.getComputedStyle(viewport);
      return parseFloat(style.backgroundSize.split(',')[0].split(' ')[0]);
    });
    // At zoom 1, grid spacing should be 24px (GRID_SPACING_WORLD = 24)
    expect(Math.abs(gridSpacing - 24)).toBeLessThanOrEqual(0.1);
  });
});

test.describe('TC-31: Page zoom unchanged after board gestures', () => {
  test('visualViewport.scale and devicePixelRatio unchanged after Ctrl+wheel and Ctrl+=/-/0', async ({ page }) => {
    await gotoBoard(page);
    
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const dprBefore = await page.evaluate(() => window.devicePixelRatio);
    
    // Ctrl+wheel over the board
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
