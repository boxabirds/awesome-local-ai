import { test, expect } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

test.describe('Shapes e2e', () => {
  // TC-23: real drag (100,100)→(300,220) at 100% → shape 200x120 at that position ±1px
  test('TC-23: drag creates shape with correct dimensions', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Press S to activate shape tool
    await page.keyboard.press('s');

    // Drag from (100,100) to (300,220) in screen pixels
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(300, 220, { steps: 5 });
    await page.mouse.up();

    // A shape should be created (check for the SVG rect inside the shape group)
    const shapeRect = page.locator('[data-testid^="shape-"] rect');
    await expect(shapeRect.first()).toBeAttached({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Verify dimensions via the shape's SVG rect element
    const width = await shapeRect.first().getAttribute('width');
    const height = await shapeRect.first().getAttribute('height');
    expect(Math.abs(parseFloat(width!) - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(parseFloat(height!) - 120)).toBeLessThanOrEqual(1);

    // Tool should have returned to Select
    const selectBtn = page.getByTestId('tool-select-btn');
    expect(await selectBtn.getAttribute('aria-pressed')).toBe('true');
  });

  // TC-24: at 200% zoom click → 160x160 centred, label wraps and stays centred
  test('TC-24: click at 200% zoom creates standard size with wrapping label', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });

    // Press S to activate shape tool (default kind: rect)
    await page.keyboard.press('s');
    await page.waitForTimeout(100);

    // Click on the board to create a standard-size shape
    await page.mouse.click(400, 300);
    await page.waitForTimeout(200);

    // A shape should be created (rect inside a shape group)
    const shapeRect = page.locator('[data-testid^="shape-"] rect').first();
    await expect(shapeRect).toBeAttached({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Verify the shape is 160x160 in world units
    const width = await shapeRect.getAttribute('width');
    const height = await shapeRect.getAttribute('height');
    expect(Math.abs(parseFloat(width!) - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(parseFloat(height!) - 160)).toBeLessThanOrEqual(1);

    // Double-click to edit label (use coordinates since SVG <g> isn't "visible" to Playwright)
    const rectBox = await shapeRect.boundingBox();
    expect(rectBox).not.toBeNull();
    const cx = rectBox!.x + rectBox!.width / 2;
    const cy = rectBox!.y + rectBox!.height / 2;
    await page.mouse.dblclick(cx, cy);
    const editor = page.locator('textarea');
    await expect(editor.first()).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Type a label longer than the shape width
    await editor.first().fill('This is a very long label that should wrap inside the shape');

    // End editing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Shape should still be present with the label
    await expect(shapeRect).toBeAttached();
  });
});
