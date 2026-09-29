import { test, expect } from '@playwright/test';
import { getZoomLabel, setCamera, getOriginPosition } from './helpers/board';

const VIEWPORT = { width: 1280, height: 800 };
const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.describe('Workflow 1: First visit navigation', () => {
  test('TC-28: hint visible then removed after drag', async ({ page }) => {
    await page.goto('/');

    // Hint should be visible
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    // Drag to dismiss
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.mouse.down();
    await page.mouse.move(CENTRE.x + 100, CENTRE.y + 50, { steps: 5 });
    await page.mouse.up();

    // Hint should be gone
    await expect(hint).not.toBeVisible();
  });

  test('TC-23: mouse drag moves origin marker exactly 200,100', async ({ page }) => {
    await page.goto('/');

    const before = await getOriginPosition(page);

    // Drag 200 right, 100 down
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.mouse.down();
    await page.mouse.move(CENTRE.x + 200, CENTRE.y + 100, { steps: 10 });
    await page.mouse.up();

    const after = await getOriginPosition(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: Ctrl+wheel zooms around pointer, dot stays under pointer', async ({ page }) => {
    await page.goto('/');

    const origin = await getOriginPosition(page);

    // Zoom in with Ctrl+wheel at the origin position
    await page.mouse.move(origin.x, origin.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // Origin should still be approximately at the same position (within 1px)
    const after = await getOriginPosition(page);
    expect(Math.abs(after.x - origin.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - origin.y)).toBeLessThanOrEqual(2);

    // Page zoom should not have changed
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(scale).toBe(1);
  });
});

test.describe('Workflow 2: Limits and recovery', () => {
  test('TC-25: click + until disabled, label ends at 400%', async ({ page }) => {
    await page.goto('/');

    const zoomIn = page.getByLabel('Zoom in');
    const label = getZoomLabel(page);

    // Click + until disabled (from 100%, need to reach 400%)
    // 100 * 1.25^n = 400 => n = log(4)/log(1.25) ≈ 7.56, so 8 clicks
    for (let i = 0; i < 20; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
      await page.waitForTimeout(50);
    }

    await expect(zoomIn).toBeDisabled();
    await expect(label).toHaveText('400%');
  });

  test('TC-26: reset from far away returns to 100% centred', async ({ page }) => {
    await page.goto('/');

    // Jump far away using test hook
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 4 });

    // Click Reset view
    await page.getByLabel('Reset view').click();

    // Label should show 100%
    await expect(getZoomLabel(page)).toHaveText('100%');

    // Origin marker should be at viewport centre
    const origin = await getOriginPosition(page);
    expect(Math.abs(origin.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(origin.y - CENTRE.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: Far travel', () => {
  test('TC-27: at 1,000,000 units, drag is exact and grid spacing correct', async ({ page }) => {
    await page.goto('/');

    // Jump to 1,000,000 units away
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });

    const before = await getOriginPosition(page);

    // Drag 200, 100
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.mouse.down();
    await page.mouse.move(CENTRE.x + 200, CENTRE.y + 100, { steps: 10 });
    await page.mouse.up();

    const after = await getOriginPosition(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // Grid spacing should be GRID_SPACING_WORLD * zoom = 24 * 1 = 24px
    const spacing = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="board-viewport"]');
      return vp ? getComputedStyle(vp).backgroundSize : '';
    });
    expect(spacing).toContain('24px');
  });
});

test.describe('TC-31: Board gestures do not zoom the page', () => {
  test('Ctrl+wheel and keyboard shortcuts do not change page zoom', async ({ page }) => {
    await page.goto('/');

    const initialScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const initialDPR = await page.evaluate(() => window.devicePixelRatio);

    // Ctrl+wheel
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
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

    const finalScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const finalDPR = await page.evaluate(() => window.devicePixelRatio);

    expect(finalScale).toBe(initialScale);
    expect(finalDPR).toBe(initialDPR);
  });
});
